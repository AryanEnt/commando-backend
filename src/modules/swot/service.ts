import type { Prisma, SwotSource } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import {
  assertProfileInScope,
  getActiveTeamIds,
  requireRecordAccess,
} from "../../lib/scope.js";
import {
  salesExecutiveCanViewSwot,
  swotWhereVisibleToSalesExecutive,
} from "../../lib/lifecycleVisibility.js";
import { assertTeamLeadOperationalWriteAllowed } from "../../lib/teamLeadLock.js";
import { recordWorkspaceEvent } from "../../lib/workspaceEvents.js";
import {
  flagsFromPoints,
  joinSwotPoints,
  loadQuadrantPoints,
  normalizeSwotPoints,
  pointsToJson,
  setAllPointsVisible,
  setPointVisible,
  setQuadrantPointsVisible,
  type SwotPoint,
} from "../../lib/swotPoints.js";
import type {
  CreateSwotInput,
  ListSwotQuery,
  SetSwotVisibilityInput,
} from "./schemas.js";

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

type QuadrantFlags = {
  visibleStrength: boolean;
  visibleWeakness: boolean;
  visibleOpportunity: boolean;
  visibleThreat: boolean;
};

function anyQuadrantShared(flags: QuadrantFlags): boolean {
  return (
    flags.visibleStrength ||
    flags.visibleWeakness ||
    flags.visibleOpportunity ||
    flags.visibleThreat
  );
}

function flagsFromRow(row: {
  visibleStrength?: boolean | null;
  visibleWeakness?: boolean | null;
  visibleOpportunity?: boolean | null;
  visibleThreat?: boolean | null;
  visibleToSalesExecutive?: boolean | null;
}): QuadrantFlags {
  const visibleStrength = Boolean(row.visibleStrength);
  const visibleWeakness = Boolean(row.visibleWeakness);
  const visibleOpportunity = Boolean(row.visibleOpportunity);
  const visibleThreat = Boolean(row.visibleThreat);
  // Legacy rows: overall share with no per-box flags yet
  if (
    row.visibleToSalesExecutive &&
    !visibleStrength &&
    !visibleWeakness &&
    !visibleOpportunity &&
    !visibleThreat
  ) {
    return {
      visibleStrength: true,
      visibleWeakness: true,
      visibleOpportunity: true,
      visibleThreat: true,
    };
  }
  return {
    visibleStrength,
    visibleWeakness,
    visibleOpportunity,
    visibleThreat,
  };
}

function presentPoints(points: SwotPoint[], redact: boolean) {
  const shown = redact ? points.filter((p) => p.visible) : points;
  if (redact && shown.length === 0) {
    return { text: null as string | null, points: [] as SwotPoint[] };
  }
  return {
    text: joinSwotPoints(shown),
    points: redact
      ? shown.map((p) => ({ ...p, visible: true }))
      : shown,
  };
}

function serialize(row: SwotRow, actor?: Actor) {
  const all = loadQuadrantPoints(row);
  const flags = flagsFromPoints(all);
  const isSe = actor?.roleCode === "SALES_EXECUTIVE";
  const own = row.source === "SALES_EXECUTIVE";
  const redact = isSe && !own;
  const strength = presentPoints(all.strength, redact);
  const weakness = presentPoints(all.weakness, redact);
  const opportunity = presentPoints(all.opportunity, redact);
  const threat = presentPoints(all.threat, redact);
  return {
    id: row.id,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    profile: row.profile,
    teamId: row.teamId,
    team: row.team,
    assignmentId: row.assignmentId,
    source: row.source,
    strength: strength.text,
    weakness: weakness.text,
    opportunity: opportunity.text,
    threat: threat.text,
    strengthPoints: strength.points,
    weaknessPoints: weakness.points,
    opportunityPoints: opportunity.points,
    threatPoints: threat.points,
    versionNumber: row.versionNumber ?? 1,
    supersedesId: row.supersedesId ?? null,
    visibleToSalesExecutive: anyQuadrantShared(flags) || own,
    visibleStrength: own ? true : flags.visibleStrength,
    visibleWeakness: own ? true : flags.visibleWeakness,
    visibleOpportunity: own ? true : flags.visibleOpportunity,
    visibleThreat: own ? true : flags.visibleThreat,
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
    // Commando sees TL, Commando, and SE SWOT for assigned profiles
    return;
  }

  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(row.teamId)) {
      throw forbidden("Record is outside your team scope");
    }
    // TL sees TL, Commando, and SE SWOT for team profiles
    return;
  }

  if (actor.roleCode === "SALES_EXECUTIVE") {
    await requireRecordAccess(prisma, actor, {
      teamId: row.teamId,
      profileId: row.salesExecutiveProfileId,
      profileUserId: row.profile.userId,
    });
    if (
      !salesExecutiveCanViewSwot(row.source, row.visibleToSalesExecutive)
    ) {
      throw forbidden("This SWOT is not shared with the Sales Executive yet");
    }
    return;
  }

  throw forbidden("Not allowed to access SWOT analyses");
}

async function assertCanManageVisibility(
  actor: Actor,
  row: SwotRow,
): Promise<void> {
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for SWOT visibility");
  }
  if (
    actor.roleCode !== "TEAM_LEAD" &&
    actor.roleCode !== "COMMANDO_EXECUTIVE"
  ) {
    throw forbidden("Only Team Leads and Commandos can change SE visibility");
  }

  // Each role may only share their own source stream
  if (actor.roleCode === "TEAM_LEAD" && row.source !== "TEAM_LEAD") {
    throw forbidden(
      "Team Leads may only change visibility on Team Lead SWOT versions",
    );
  }
  if (actor.roleCode === "COMMANDO_EXECUTIVE" && row.source !== "COMMANDO") {
    throw forbidden(
      "Commandos may only change visibility on Commando SWOT versions",
    );
  }

  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(row.teamId)) {
      throw forbidden("Record is outside your team scope");
    }
    // Visibility on an existing TL SWOT is allowed during Commando —
    // creation remains locked; sharing own assessment is not operational rewrite.
    return;
  }

  const assigned = await prisma.commandoAssignment.findFirst({
    where: {
      salesExecutiveProfileId: row.salesExecutiveProfileId,
      commandoUserId: actor.id,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (!assigned) {
    throw forbidden(
      "Commando may only change visibility for actively assigned profiles",
    );
  }
}

/** Sources TL and Commando may list (cross-visible). */
function managerSourceFilter(
  actor: Actor,
): Prisma.SwotAnalysisWhereInput | undefined {
  if (isSuperAdmin(actor)) return undefined;
  if (
    actor.roleCode === "TEAM_LEAD" ||
    actor.roleCode === "COMMANDO_EXECUTIVE"
  ) {
    return {
      source: { in: ["TEAM_LEAD", "COMMANDO", "SALES_EXECUTIVE"] },
    };
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
        return {
          page: query.page,
          pageSize: query.pageSize,
          total: 0,
          items: [],
        };
      }
      scopeParts.push({ salesExecutiveProfileId: profile.id });
      scopeParts.push(swotWhereVisibleToSalesExecutive());
      if (query.source) {
        if (query.source === "SALES_EXECUTIVE") {
          scopeParts.push({ source: "SALES_EXECUTIVE" });
        } else {
          scopeParts.push({
            source: query.source,
            visibleToSalesExecutive: true,
          });
        }
      }
    } else {
      return { page: query.page, pageSize: query.pageSize, total: 0, items: [] };
    }
  }

  const sourceVis = managerSourceFilter(actor);
  if (sourceVis && actor.roleCode !== "SALES_EXECUTIVE") {
    scopeParts.push(sourceVis);
  }

  if (query.teamId) scopeParts.push({ teamId: query.teamId });
  if (query.profileId) {
    scopeParts.push({ salesExecutiveProfileId: query.profileId });
  }
  if (query.source && actor.roleCode !== "SALES_EXECUTIVE") {
    scopeParts.push({ source: query.source });
  }
  if (query.commandoUserId) {
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
    items: rows.map((row) => serialize(row, actor)),
  };
}

export async function getSwot(actor: Actor, id: string) {
  const row = await prisma.swotAnalysis.findFirst({
    where: { id, archivedAt: null },
    include: swotInclude,
  });
  if (!row) throw notFound("SWOT analysis not found");
  await assertCanViewSwot(actor, row);
  return serialize(row, actor);
}

export async function createSwot(actor: Actor, input: CreateSwotInput) {
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin has read-only access to SWOT analyses");
  }

  const source = sourceForRole(actor.roleCode);
  await assertProfileInScope(prisma, actor, input.salesExecutiveProfileId);

  const profile = await prisma.salesExecutiveProfile.findFirstOrThrow({
    where: { id: input.salesExecutiveProfileId, archivedAt: null },
  });

  if (actor.roleCode === "SALES_EXECUTIVE" && profile.userId !== actor.id) {
    throw forbidden(
      "Sales Executives may only create SWOT for their own profile",
    );
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

  const previous = await prisma.swotAnalysis.findFirst({
    where: {
      salesExecutiveProfileId: profile.id,
      source,
      archivedAt: null,
    },
    orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      versionNumber: true,
      visibleToSalesExecutive: true,
      visibleStrength: true,
      visibleWeakness: true,
      visibleOpportunity: true,
      visibleThreat: true,
    },
  });

  const previousFlags = previous
    ? flagsFromRow(previous)
    : {
        visibleStrength: false,
        visibleWeakness: false,
        visibleOpportunity: false,
        visibleThreat: false,
      };

  const fromInput =
    input.visibleToSalesExecutive !== undefined
      ? {
          visibleStrength: input.visibleToSalesExecutive,
          visibleWeakness: input.visibleToSalesExecutive,
          visibleOpportunity: input.visibleToSalesExecutive,
          visibleThreat: input.visibleToSalesExecutive,
        }
      : {
          visibleStrength: input.visibleStrength ?? previousFlags.visibleStrength,
          visibleWeakness: input.visibleWeakness ?? previousFlags.visibleWeakness,
          visibleOpportunity:
            input.visibleOpportunity ?? previousFlags.visibleOpportunity,
          visibleThreat: input.visibleThreat ?? previousFlags.visibleThreat,
        };

  const seAuthor = source === "SALES_EXECUTIVE";
  const shareAll = input.visibleToSalesExecutive === true;
  const strengthPoints = normalizeSwotPoints(
    input.strengthPoints,
    input.strength,
    seAuthor || shareAll || fromInput.visibleStrength,
  );
  const weaknessPoints = normalizeSwotPoints(
    input.weaknessPoints,
    input.weakness,
    seAuthor || shareAll || fromInput.visibleWeakness,
  );
  const opportunityPoints = normalizeSwotPoints(
    input.opportunityPoints,
    input.opportunity,
    seAuthor || shareAll || fromInput.visibleOpportunity,
  );
  const threatPoints = normalizeSwotPoints(
    input.threatPoints,
    input.threat,
    seAuthor || shareAll || fromInput.visibleThreat,
  );

  const flags = flagsFromPoints({
    strength: strengthPoints,
    weakness: weaknessPoints,
    opportunity: opportunityPoints,
    threat: threatPoints,
  });
  const visibleToSalesExecutive = anyQuadrantShared(flags);

  const created = await prisma.swotAnalysis.create({
    data: {
      salesExecutiveProfileId: profile.id,
      teamId: profile.teamId,
      assignmentId: activeAssignment?.id ?? null,
      source,
      strength: joinSwotPoints(strengthPoints),
      weakness: joinSwotPoints(weaknessPoints),
      opportunity: joinSwotPoints(opportunityPoints),
      threat: joinSwotPoints(threatPoints),
      strengthPoints: pointsToJson(strengthPoints),
      weaknessPoints: pointsToJson(weaknessPoints),
      opportunityPoints: pointsToJson(opportunityPoints),
      threatPoints: pointsToJson(threatPoints),
      versionNumber: (previous?.versionNumber ?? 0) + 1,
      supersedesId: previous?.id ?? null,
      visibleToSalesExecutive,
      visibleStrength: flags.visibleStrength,
      visibleWeakness: flags.visibleWeakness,
      visibleOpportunity: flags.visibleOpportunity,
      visibleThreat: flags.visibleThreat,
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
      versionNumber: created.versionNumber,
      supersedesId: previous?.id ?? null,
      visibleToSalesExecutive,
      verb: "CREATE",
    },
  });

  await recordWorkspaceEvent({
    salesExecutiveProfileId: profile.id,
    assignmentId: activeAssignment?.id ?? null,
    type: "SWOT",
    title: `SWOT updated · Version ${created.versionNumber}`,
    notes: `Source: ${source.replaceAll("_", " ")}`,
    status: "COMPLETED",
    sourceType: "SwotAnalysis",
    sourceId: created.id,
    createdById: actor.id,
  });

  return serialize(created, actor);
}

export async function setSwotVisibility(
  actor: Actor,
  id: string,
  input: SetSwotVisibilityInput,
) {
  const row = await prisma.swotAnalysis.findFirst({
    where: { id, archivedAt: null },
    include: swotInclude,
  });
  if (!row) throw notFound("SWOT analysis not found");
  await assertCanManageVisibility(actor, row);

  let points = loadQuadrantPoints(row);
  if (input.point) {
    const next = setPointVisible(
      points,
      input.point.quadrant,
      input.point.id,
      input.point.visible,
    );
    if (!next) throw badRequest("SWOT point not found");
    points = next;
  } else if (input.visibleToSalesExecutive !== undefined) {
    points = setAllPointsVisible(points, input.visibleToSalesExecutive);
  } else {
    if (input.visibleStrength !== undefined) {
      points = setQuadrantPointsVisible(
        points,
        "strength",
        input.visibleStrength,
      );
    }
    if (input.visibleWeakness !== undefined) {
      points = setQuadrantPointsVisible(
        points,
        "weakness",
        input.visibleWeakness,
      );
    }
    if (input.visibleOpportunity !== undefined) {
      points = setQuadrantPointsVisible(
        points,
        "opportunity",
        input.visibleOpportunity,
      );
    }
    if (input.visibleThreat !== undefined) {
      points = setQuadrantPointsVisible(points, "threat", input.visibleThreat);
    }
  }

  const flags = flagsFromPoints(points);
  const visibleToSalesExecutive = anyQuadrantShared(flags);

  const updated = await prisma.swotAnalysis.update({
    where: { id },
    data: {
      visibleToSalesExecutive,
      visibleStrength: flags.visibleStrength,
      visibleWeakness: flags.visibleWeakness,
      visibleOpportunity: flags.visibleOpportunity,
      visibleThreat: flags.visibleThreat,
      strengthPoints: pointsToJson(points.strength),
      weaknessPoints: pointsToJson(points.weakness),
      opportunityPoints: pointsToJson(points.opportunity),
      threatPoints: pointsToJson(points.threat),
    },
    include: swotInclude,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "SWOT_VISIBILITY_UPDATED",
    entityType: "SwotAnalysis",
    entityId: updated.id,
    metadata: {
      visibleToSalesExecutive,
      ...flags,
      source: updated.source,
      profileId: updated.salesExecutiveProfileId,
      verb: "UPDATE",
    },
  });

  return serialize(updated, actor);
}
