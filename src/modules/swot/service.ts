import type { Prisma, SwotSource } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { forbidden, notFound } from "../../lib/errors.js";
import {
  assertProfileInScope,
  getActiveTeamIds,
  requireRecordAccess,
} from "../../lib/scope.js";
import {
  getCommandoLifecycleState,
  salesExecutiveCanViewSwotSource,
  swotSourcesVisibleToSalesExecutive,
} from "../../lib/lifecycleVisibility.js";
import { assertTeamLeadOperationalWriteAllowed } from "../../lib/teamLeadLock.js";
import type { CreateSwotInput, ListSwotQuery } from "./schemas.js";

const swotInclude = {
  profile: {
    select: {
      id: true,
      displayName: true,
      userId: true,
      teamId: true,
    },
  },
  team: { select: { id: true, name: true } },
  createdBy: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: { select: { code: true } },
    },
  },
} satisfies Prisma.SwotAnalysisInclude;

type SwotRow = Prisma.SwotAnalysisGetPayload<{ include: typeof swotInclude }>;

function sourceForRole(roleCode: Actor["roleCode"]): SwotSource {
  switch (roleCode) {
    case "TEAM_LEAD":
      return "TEAM_LEAD";
    case "COMMANDO_EXECUTIVE":
      return "COMMANDO";
    case "SALES_EXECUTIVE":
      return "SALES_EXECUTIVE";
    default:
      throw forbidden("Your role cannot create SWOT analyses");
  }
}

function serialize(row: SwotRow) {
  return {
    id: row.id,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    profile: row.profile,
    teamId: row.teamId,
    team: row.team,
    assignmentId: row.assignmentId,
    source: row.source,
    strength: row.strength,
    weakness: row.weakness,
    opportunity: row.opportunity,
    threat: row.threat,
    createdById: row.createdById,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function assertCanViewSwot(actor: Actor, row: SwotRow): Promise<void> {
  if (isSuperAdmin(actor)) {
    return;
  }

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    const assigned = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: row.salesExecutiveProfileId,
        commandoUserId: actor.id,
      },
      select: { id: true },
    });
    if (!assigned) {
      throw forbidden("Record is outside your assignment scope");
    }
    if (
      row.source !== "TEAM_LEAD" &&
      row.source !== "COMMANDO" &&
      row.source !== "SALES_EXECUTIVE"
    ) {
      throw forbidden("SWOT source not visible to Commando");
    }
    return;
  }

  await requireRecordAccess(prisma, actor, {
    teamId: row.teamId,
    profileId: row.salesExecutiveProfileId,
    profileUserId: row.profile.userId,
  });

  if (actor.roleCode === "SALES_EXECUTIVE") {
    const lifecycle = await getCommandoLifecycleState(
      prisma,
      row.salesExecutiveProfileId,
    );
    if (!salesExecutiveCanViewSwotSource(row.source, lifecycle)) {
      throw forbidden(
        "Commando SWOT is not visible during an active Commando assignment",
      );
    }
  }

  if (actor.roleCode === "TEAM_LEAD") {
    if (row.source !== "TEAM_LEAD") {
      throw forbidden("Team Leads may only view Team Lead SWOT records");
    }
    return;
  }

  if (actor.roleCode === "SALES_EXECUTIVE") {
    return;
  }

  throw forbidden("Not allowed to access SWOT analyses");
}

function visibilitySourceFilter(
  actor: Actor,
): Prisma.SwotAnalysisWhereInput | undefined {
  if (isSuperAdmin(actor)) return undefined;
  if (actor.roleCode === "TEAM_LEAD") {
    return { source: "TEAM_LEAD" };
  }
  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    return { source: { in: ["TEAM_LEAD", "COMMANDO", "SALES_EXECUTIVE"] } };
  }
  return undefined;
}

export async function listSwot(actor: Actor, query: ListSwotQuery) {
  const scopeParts: Prisma.SwotAnalysisWhereInput[] = [{ archivedAt: null }];

  if (!isSuperAdmin(actor)) {
    if (actor.roleCode === "TEAM_LEAD") {
      const teamIds = await getActiveTeamIds(prisma, actor.id);
      scopeParts.push({ teamId: { in: teamIds } });
    } else if (actor.roleCode === "COMMANDO_EXECUTIVE") {
      const assignments = await prisma.commandoAssignment.findMany({
        where: { commandoUserId: actor.id },
        select: { salesExecutiveProfileId: true },
      });
      const profileIds = [
        ...new Set(assignments.map((a) => a.salesExecutiveProfileId)),
      ];
      scopeParts.push({ salesExecutiveProfileId: { in: profileIds } });
    } else if (actor.roleCode === "SALES_EXECUTIVE") {
      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { userId: actor.id, archivedAt: null },
        select: { id: true },
      });
      if (!profile) {
        return { page: query.page, pageSize: query.pageSize, total: 0, items: [] };
      }
      const lifecycle = await getCommandoLifecycleState(prisma, profile.id);
      const allowed = swotSourcesVisibleToSalesExecutive(lifecycle);
      // Reject query.source bypass for hidden Commando SWOT during active cycle
      if (query.source && !allowed.includes(query.source)) {
        return {
          page: query.page,
          pageSize: query.pageSize,
          total: 0,
          items: [],
        };
      }
      scopeParts.push({ salesExecutiveProfileId: profile.id });
      scopeParts.push({
        source: query.source ? query.source : { in: allowed },
      });
    } else {
      return { page: query.page, pageSize: query.pageSize, total: 0, items: [] };
    }
  }

  const sourceVis = visibilitySourceFilter(actor);
  if (sourceVis && actor.roleCode !== "SALES_EXECUTIVE") {
    scopeParts.push(sourceVis);
  }

  if (query.teamId) scopeParts.push({ teamId: query.teamId });
  if (query.profileId) {
    scopeParts.push({ salesExecutiveProfileId: query.profileId });
  }
  // SE source already applied above; other roles honor query.source
  if (query.source && actor.roleCode !== "SALES_EXECUTIVE") {
    scopeParts.push({ source: query.source });
  }
  if (query.commandoUserId) {
    // Filter SWOT linked to profiles currently/historically assigned to this Commando
    const assignments = await prisma.commandoAssignment.findMany({
      where: { commandoUserId: query.commandoUserId },
      select: { salesExecutiveProfileId: true },
    });
    scopeParts.push({
      salesExecutiveProfileId: {
        in: assignments.map((a) => a.salesExecutiveProfileId),
      },
    });
  }
  if (query.search) {
    scopeParts.push({
      OR: [
        { strength: { contains: query.search, mode: "insensitive" } },
        { weakness: { contains: query.search, mode: "insensitive" } },
        { opportunity: { contains: query.search, mode: "insensitive" } },
        { threat: { contains: query.search, mode: "insensitive" } },
        {
          profile: {
            displayName: { contains: query.search, mode: "insensitive" },
          },
        },
      ],
    });
  }

  const where: Prisma.SwotAnalysisWhereInput = { AND: scopeParts };

  const [total, rows] = await Promise.all([
    prisma.swotAnalysis.count({ where }),
    prisma.swotAnalysis.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: "desc" },
      include: swotInclude,
    }),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    items: rows.map(serialize),
  };
}

export async function getSwot(actor: Actor, id: string) {
  const row = await prisma.swotAnalysis.findFirst({
    where: { id, archivedAt: null },
    include: swotInclude,
  });
  if (!row) throw notFound("SWOT analysis not found");
  await assertCanViewSwot(actor, row);
  return serialize(row);
}

export async function createSwot(actor: Actor, input: CreateSwotInput) {
  // Super Admin is read-only for SWOT
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin has read-only access to SWOT analyses");
  }

  const source = sourceForRole(actor.roleCode);
  await assertProfileInScope(prisma, actor, input.salesExecutiveProfileId);

  const profile = await prisma.salesExecutiveProfile.findFirstOrThrow({
    where: { id: input.salesExecutiveProfileId, archivedAt: null },
  });

  if (actor.roleCode === "SALES_EXECUTIVE" && profile.userId !== actor.id) {
    throw forbidden("Sales Executives may only create SWOT for their own profile");
  }

  if (actor.roleCode === "TEAM_LEAD") {
    await assertTeamLeadOperationalWriteAllowed(prisma, actor, profile.id, {
      action: "SWOT_CREATE",
    });
  }

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    const assignment = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: profile.id,
        commandoUserId: actor.id,
        status: "ACTIVE",
      },
    });
    if (!assignment) {
      throw forbidden(
        "Commando may only create SWOT for actively assigned profiles",
      );
    }
  }

  const activeAssignment = await prisma.commandoAssignment.findFirst({
    where: {
      salesExecutiveProfileId: profile.id,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  // Always insert a new historical row — never overwrite
  const created = await prisma.swotAnalysis.create({
    data: {
      salesExecutiveProfileId: profile.id,
      teamId: profile.teamId,
      assignmentId: activeAssignment?.id ?? null,
      source,
      strength: input.strength,
      weakness: input.weakness,
      opportunity: input.opportunity,
      threat: input.threat,
      createdById: actor.id,
    },
    include: swotInclude,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "SWOT_CREATED",
    entityType: "SwotAnalysis",
    entityId: created.id,
    metadata: {
      source,
      profileId: profile.id,
      assignmentId: activeAssignment?.id ?? null,
      verb: "CREATE",
    },
  });

  return serialize(created);
}
