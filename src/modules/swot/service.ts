import type { Prisma, SwotSource, SwotSubjectType } from "@prisma/client";
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
  executiveUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: { select: { code: true } },
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
    case "SALES_SUPPORT_EXECUTIVE":
      return "SALES_SUPPORT_EXECUTIVE";
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

function isSelfSource(source: SwotSource): boolean {
  return source === "SALES_EXECUTIVE" || source === "SALES_SUPPORT_EXECUTIVE";
}

function isSubjectExecutive(actor: Actor | undefined): boolean {
  return (
    actor?.roleCode === "SALES_EXECUTIVE" ||
    actor?.roleCode === "SALES_SUPPORT_EXECUTIVE"
  );
}

function inputExecutiveId(input: CreateSwotInput): string | undefined {
  return input.executiveUserId ?? input.subjectUserId;
}

function serialize(row: SwotRow, actor?: Actor) {
  const all = loadQuadrantPoints(row);
  const flags = flagsFromPoints(all);
  const own = isSelfSource(row.source);
  const redact = isSubjectExecutive(actor) && !own;
  const strength = presentPoints(all.strength, redact);
  const weakness = presentPoints(all.weakness, redact);
  const opportunity = presentPoints(all.opportunity, redact);
  const threat = presentPoints(all.threat, redact);

  const subjectName =
    row.subjectType === "PROFILE"
      ? (row.profile?.displayName ?? "Unknown profile")
      : row.executiveUser
        ? `${row.executiveUser.firstName} ${row.executiveUser.lastName}`.trim()
        : "Unknown";

  return {
    id: row.id,
    subjectType: row.subjectType as SwotSubjectType,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    executiveUserId: row.executiveUserId,
    /** @deprecated Alias of executiveUserId */
    subjectUserId: row.executiveUserId,
    profile: row.profile,
    executiveUser: row.executiveUser,
    /** @deprecated Alias of executiveUser */
    subjectUser: row.executiveUser,
    subject: {
      type: row.subjectType as "EXECUTIVE" | "PROFILE",
      id:
        row.subjectType === "PROFILE"
          ? (row.salesExecutiveProfileId ?? "")
          : (row.executiveUserId ?? ""),
      name: subjectName,
    },
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function teamLeadProfileIds(actorId: string): Promise<string[]> {
  const teamIds = await getActiveTeamIds(prisma, actorId);
  if (teamIds.length === 0) return [];
  const profiles = await prisma.salesExecutiveProfile.findMany({
    where: { teamId: { in: teamIds }, archivedAt: null },
    select: { id: true },
  });
  return profiles.map((p) => p.id);
}

async function commandoProfileIds(
  actorId: string,
  activeOnly = false,
): Promise<string[]> {
  const assignments = await prisma.commandoAssignment.findMany({
    where: {
      commandoUserId: actorId,
      ...(activeOnly ? { status: "ACTIVE" as const } : {}),
    },
    select: { salesExecutiveProfileId: true },
  });
  return [
    ...new Set(assignments.map((a) => a.salesExecutiveProfileId)),
  ];
}

async function teamLeadSupportUserIds(actorId: string): Promise<string[]> {
  const profileIds = await teamLeadProfileIds(actorId);
  if (profileIds.length === 0) return [];
  const links = await prisma.salesSupportLink.findMany({
    where: {
      salesExecutiveProfileId: { in: profileIds },
      isActive: true,
    },
    select: { salesSupportUserId: true },
  });
  return [...new Set(links.map((l) => l.salesSupportUserId))];
}

async function commandoSupportUserIds(
  actorId: string,
  activeOnly = false,
): Promise<string[]> {
  const profileIds = await commandoProfileIds(actorId, activeOnly);
  if (profileIds.length === 0) return [];
  const links = await prisma.salesSupportLink.findMany({
    where: {
      salesExecutiveProfileId: { in: profileIds },
      isActive: true,
    },
    select: { salesSupportUserId: true },
  });
  return [...new Set(links.map((l) => l.salesSupportUserId))];
}

async function assertSseInTeamLeadScope(actor: Actor, executiveUserId: string) {
  const ids = await teamLeadSupportUserIds(actor.id);
  if (!ids.includes(executiveUserId)) {
    throw forbidden("Sales Support user is outside your team support scope");
  }
}

async function assertSseInCommandoScope(
  actor: Actor,
  executiveUserId: string,
  activeOnly = true,
) {
  const ids = await commandoSupportUserIds(actor.id, activeOnly);
  if (!ids.includes(executiveUserId)) {
    throw forbidden(
      "Sales Support user is outside your assignment support scope",
    );
  }
}

async function assertCanViewSwot(actor: Actor, row: SwotRow): Promise<void> {
  if (isSuperAdmin(actor)) return;

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    if (row.subjectType === "PROFILE" && row.salesExecutiveProfileId) {
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
      return;
    }
    if (row.subjectType === "EXECUTIVE" && row.executiveUserId) {
      // SE executive: via assignment on any profile they occupy
      const seProfile = await prisma.salesExecutiveProfile.findFirst({
        where: { userId: row.executiveUserId, archivedAt: null },
        select: { id: true },
      });
      if (seProfile) {
        const assigned = await prisma.commandoAssignment.findFirst({
          where: {
            salesExecutiveProfileId: seProfile.id,
            commandoUserId: actor.id,
          },
          select: { id: true },
        });
        if (assigned) return;
      }
      // SSE executive
      await assertSseInCommandoScope(actor, row.executiveUserId, false);
      return;
    }
    throw forbidden("Record is outside your assignment scope");
  }

  if (actor.roleCode === "TEAM_LEAD") {
    if (row.subjectType === "PROFILE" && row.teamId) {
      const teamIds = await getActiveTeamIds(prisma, actor.id);
      if (!teamIds.includes(row.teamId)) {
        throw forbidden("Record is outside your team scope");
      }
      return;
    }
    if (row.subjectType === "EXECUTIVE" && row.executiveUserId) {
      const seProfile = await prisma.salesExecutiveProfile.findFirst({
        where: { userId: row.executiveUserId, archivedAt: null },
        select: { teamId: true },
      });
      if (seProfile) {
        const teamIds = await getActiveTeamIds(prisma, actor.id);
        if (teamIds.includes(seProfile.teamId)) return;
      }
      await assertSseInTeamLeadScope(actor, row.executiveUserId);
      return;
    }
    throw forbidden("Record is outside your team scope");
  }

  if (actor.roleCode === "SALES_EXECUTIVE") {
    // Person may see own Executive SWOT (visibility gated) — not Profile SWOT unless shared
    if (row.subjectType === "EXECUTIVE") {
      if (row.executiveUserId !== actor.id) {
        throw forbidden("Not allowed to access this SWOT");
      }
      if (!salesExecutiveCanViewSwot(row.source, row.visibleToSalesExecutive)) {
        throw forbidden("This SWOT is not shared with the Sales Executive yet");
      }
      return;
    }
    if (row.subjectType === "PROFILE" && row.salesExecutiveProfileId) {
      await requireRecordAccess(prisma, actor, {
        teamId: row.teamId ?? row.profile?.teamId ?? "",
        profileId: row.salesExecutiveProfileId,
        profileUserId: row.profile?.userId,
      });
      if (!salesExecutiveCanViewSwot(row.source, row.visibleToSalesExecutive)) {
        throw forbidden("This Profile SWOT is not shared with you yet");
      }
      return;
    }
    throw forbidden("Not allowed to access this SWOT");
  }

  if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    if (row.subjectType !== "EXECUTIVE" || row.executiveUserId !== actor.id) {
      throw forbidden("Not allowed to access this SWOT");
    }
    if (!salesExecutiveCanViewSwot(row.source, row.visibleToSalesExecutive)) {
      throw forbidden(
        "This SWOT is not shared with the Sales Support Executive yet",
      );
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
    throw forbidden(
      "Only Team Leads and Commandos can change subject visibility",
    );
  }

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

  await assertCanViewSwot(actor, row);

  if (actor.roleCode === "COMMANDO_EXECUTIVE" && row.subjectType === "PROFILE") {
    const assigned = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: row.salesExecutiveProfileId!,
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
}

function managerSourceFilter(
  actor: Actor,
): Prisma.SwotAnalysisWhereInput | undefined {
  if (isSuperAdmin(actor)) return undefined;
  if (
    actor.roleCode === "TEAM_LEAD" ||
    actor.roleCode === "COMMANDO_EXECUTIVE"
  ) {
    return {
      source: {
        in: [
          "TEAM_LEAD",
          "COMMANDO",
          "SALES_EXECUTIVE",
          "SALES_SUPPORT_EXECUTIVE",
        ],
      },
    };
  }
  return undefined;
}

export async function listSupportSubjectsForSwot(actor: Actor) {
  if (isSuperAdmin(actor)) {
    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        role: { code: "SALES_SUPPORT_EXECUTIVE" },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: 200,
    });
    return { subjects: users };
  }

  let userIds: string[] = [];
  if (actor.roleCode === "TEAM_LEAD") {
    userIds = await teamLeadSupportUserIds(actor.id);
  } else if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    userIds = await commandoSupportUserIds(actor.id, true);
  } else {
    throw forbidden("Not allowed to list SWOT support subjects");
  }

  if (userIds.length === 0) return { subjects: [] };

  const users = await prisma.user.findMany({
    where: {
      id: { in: userIds },
      deletedAt: null,
      isActive: true,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  return { subjects: users };
}

/** Expand profileId filter to PROFILE rows + EXECUTIVE rows for that profile's person. */
async function whereForProfileFilter(
  profileId: string,
): Promise<Prisma.SwotAnalysisWhereInput> {
  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: profileId },
    select: { id: true, userId: true },
  });
  if (!profile) {
    return { salesExecutiveProfileId: profileId, subjectType: "PROFILE" };
  }
  return {
    OR: [
      { subjectType: "PROFILE", salesExecutiveProfileId: profile.id },
      { subjectType: "EXECUTIVE", executiveUserId: profile.userId },
    ],
  };
}

export async function listSwot(actor: Actor, query: ListSwotQuery) {
  const scopeParts: Prisma.SwotAnalysisWhereInput[] = [{ archivedAt: null }];
  const executiveFilter = query.executiveUserId ?? query.subjectUserId;

  if (!isSuperAdmin(actor)) {
    if (actor.roleCode === "TEAM_LEAD") {
      const [teamIds, supportUserIds, profileIds] = await Promise.all([
        getActiveTeamIds(prisma, actor.id),
        teamLeadSupportUserIds(actor.id),
        teamLeadProfileIds(actor.id),
      ]);
      const seUsers = await prisma.salesExecutiveProfile.findMany({
        where: { id: { in: profileIds } },
        select: { userId: true },
      });
      const seUserIds = seUsers.map((p) => p.userId);
      scopeParts.push({
        OR: [
          { subjectType: "PROFILE", teamId: { in: teamIds } },
          {
            subjectType: "EXECUTIVE",
            executiveUserId: { in: [...seUserIds, ...supportUserIds] },
          },
        ],
      });
    } else if (actor.roleCode === "COMMANDO_EXECUTIVE") {
      const [profileIds, supportUserIds] = await Promise.all([
        commandoProfileIds(actor.id, false),
        commandoSupportUserIds(actor.id, false),
      ]);
      const seUsers = await prisma.salesExecutiveProfile.findMany({
        where: { id: { in: profileIds } },
        select: { userId: true },
      });
      const seUserIds = seUsers.map((p) => p.userId);
      scopeParts.push({
        OR: [
          {
            subjectType: "PROFILE",
            salesExecutiveProfileId: { in: profileIds },
          },
          {
            subjectType: "EXECUTIVE",
            executiveUserId: { in: [...seUserIds, ...supportUserIds] },
          },
        ],
      });
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
      scopeParts.push({
        OR: [
          { subjectType: "EXECUTIVE", executiveUserId: actor.id },
          {
            subjectType: "PROFILE",
            salesExecutiveProfileId: profile.id,
            ...swotWhereVisibleToSalesExecutive(),
          },
        ],
      });
      // Executive self always visible; manager Executive SWOT gated
      scopeParts.push({
        OR: [
          { subjectType: "EXECUTIVE", source: "SALES_EXECUTIVE" },
          {
            subjectType: "EXECUTIVE",
            ...swotWhereVisibleToSalesExecutive(),
          },
          { subjectType: "PROFILE" },
        ],
      });
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
    } else if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
      scopeParts.push({
        subjectType: "EXECUTIVE",
        executiveUserId: actor.id,
      });
      scopeParts.push(swotWhereVisibleToSalesExecutive());
      if (query.source) {
        if (query.source === "SALES_SUPPORT_EXECUTIVE") {
          scopeParts.push({ source: "SALES_SUPPORT_EXECUTIVE" });
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
  if (
    sourceVis &&
    actor.roleCode !== "SALES_EXECUTIVE" &&
    actor.roleCode !== "SALES_SUPPORT_EXECUTIVE"
  ) {
    scopeParts.push(sourceVis);
  }

  if (query.teamId) scopeParts.push({ teamId: query.teamId });
  if (query.subjectType) scopeParts.push({ subjectType: query.subjectType });
  if (query.profileId) {
    scopeParts.push(await whereForProfileFilter(query.profileId));
  }
  if (executiveFilter) {
    scopeParts.push({
      subjectType: "EXECUTIVE",
      executiveUserId: executiveFilter,
    });
  }
  if (
    query.source &&
    actor.roleCode !== "SALES_EXECUTIVE" &&
    actor.roleCode !== "SALES_SUPPORT_EXECUTIVE"
  ) {
    scopeParts.push({ source: query.source });
  }
  if (query.commandoUserId) {
    const assignments = await prisma.commandoAssignment.findMany({
      where: { commandoUserId: query.commandoUserId },
      select: { salesExecutiveProfileId: true },
    });
    const ids = assignments.map((a) => a.salesExecutiveProfileId);
    const seUsers = await prisma.salesExecutiveProfile.findMany({
      where: { id: { in: ids } },
      select: { userId: true },
    });
    scopeParts.push({
      OR: [
        {
          subjectType: "PROFILE",
          salesExecutiveProfileId: { in: ids },
        },
        {
          subjectType: "EXECUTIVE",
          executiveUserId: { in: seUsers.map((p) => p.userId) },
        },
      ],
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
        {
          executiveUser: {
            OR: [
              { firstName: { contains: query.search, mode: "insensitive" } },
              { lastName: { contains: query.search, mode: "insensitive" } },
            ],
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
      orderBy: [{ createdAt: "desc" }],
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

type PreparedPoints = {
  strengthPoints: SwotPoint[];
  weaknessPoints: SwotPoint[];
  opportunityPoints: SwotPoint[];
  threatPoints: SwotPoint[];
  flags: QuadrantFlags;
  visibleToSalesExecutive: boolean;
};

function preparePoints(
  input: CreateSwotInput,
  previous: {
    visibleToSalesExecutive?: boolean | null;
    visibleStrength?: boolean | null;
    visibleWeakness?: boolean | null;
    visibleOpportunity?: boolean | null;
    visibleThreat?: boolean | null;
  } | null,
  forceVisible: boolean,
): PreparedPoints {
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

  const shareAll = input.visibleToSalesExecutive === true;
  const strengthPoints = normalizeSwotPoints(
    input.strengthPoints,
    input.strength,
    forceVisible || shareAll || fromInput.visibleStrength,
  );
  const weaknessPoints = normalizeSwotPoints(
    input.weaknessPoints,
    input.weakness,
    forceVisible || shareAll || fromInput.visibleWeakness,
  );
  const opportunityPoints = normalizeSwotPoints(
    input.opportunityPoints,
    input.opportunity,
    forceVisible || shareAll || fromInput.visibleOpportunity,
  );
  const threatPoints = normalizeSwotPoints(
    input.threatPoints,
    input.threat,
    forceVisible || shareAll || fromInput.visibleThreat,
  );
  const flags = flagsFromPoints({
    strength: strengthPoints,
    weakness: weaknessPoints,
    opportunity: opportunityPoints,
    threat: threatPoints,
  });
  return {
    strengthPoints,
    weaknessPoints,
    opportunityPoints,
    threatPoints,
    flags,
    visibleToSalesExecutive: forceVisible || anyQuadrantShared(flags),
  };
}

async function findPreviousExecutive(
  executiveUserId: string,
  source: SwotSource,
) {
  return prisma.swotAnalysis.findFirst({
    where: {
      subjectType: "EXECUTIVE",
      executiveUserId,
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
}

async function createExecutiveSwot(opts: {
  actor: Actor;
  source: SwotSource;
  executiveUserId: string;
  teamId: string | null;
  assignmentId: string | null;
  input: CreateSwotInput;
  forceVisible: boolean;
  workspaceProfileId?: string | null;
}) {
  const previous = await findPreviousExecutive(opts.executiveUserId, opts.source);
  const prepared = preparePoints(opts.input, previous, opts.forceVisible);

  const created = await prisma.swotAnalysis.create({
    data: {
      subjectType: "EXECUTIVE",
      salesExecutiveProfileId: null,
      executiveUserId: opts.executiveUserId,
      teamId: opts.teamId,
      assignmentId: opts.assignmentId,
      source: opts.source,
      strength: joinSwotPoints(prepared.strengthPoints),
      weakness: joinSwotPoints(prepared.weaknessPoints),
      opportunity: joinSwotPoints(prepared.opportunityPoints),
      threat: joinSwotPoints(prepared.threatPoints),
      strengthPoints: pointsToJson(prepared.strengthPoints),
      weaknessPoints: pointsToJson(prepared.weaknessPoints),
      opportunityPoints: pointsToJson(prepared.opportunityPoints),
      threatPoints: pointsToJson(prepared.threatPoints),
      versionNumber: (previous?.versionNumber ?? 0) + 1,
      supersedesId: previous?.id ?? null,
      visibleToSalesExecutive: prepared.visibleToSalesExecutive,
      visibleStrength: prepared.flags.visibleStrength,
      visibleWeakness: prepared.flags.visibleWeakness,
      visibleOpportunity: prepared.flags.visibleOpportunity,
      visibleThreat: prepared.flags.visibleThreat,
      createdById: opts.actor.id,
    },
    include: swotInclude,
  });

  await writeAuditLog({
    actorId: opts.actor.id,
    action: "SWOT_CREATED",
    entityType: "SwotAnalysis",
    entityId: created.id,
    metadata: {
      source: opts.source,
      subjectType: "EXECUTIVE",
      executiveUserId: opts.executiveUserId,
      versionNumber: created.versionNumber,
      supersedesId: previous?.id ?? null,
      visibleToSalesExecutive: prepared.visibleToSalesExecutive,
      verb: "CREATE",
    },
  });

  if (opts.workspaceProfileId) {
    await recordWorkspaceEvent({
      salesExecutiveProfileId: opts.workspaceProfileId,
      assignmentId: opts.assignmentId,
      type: "SWOT",
      title: `Executive SWOT updated · Version ${created.versionNumber}`,
      notes: `Source: ${opts.source.replaceAll("_", " ")}`,
      status: "COMPLETED",
      sourceType: "SwotAnalysis",
      sourceId: created.id,
      createdById: opts.actor.id,
    });
  }

  return serialize(created, opts.actor);
}

export async function createSwot(actor: Actor, input: CreateSwotInput) {
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin has read-only access to SWOT analyses");
  }

  const source = sourceForRole(actor.roleCode);
  const executiveId = inputExecutiveId(input);

  // ── Self Executive SWOT (SE / SSE) ─────────────────────────────
  if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    if (input.subjectType === "PROFILE") {
      throw forbidden("Sales Support cannot create Profile SWOT");
    }
    if (input.salesExecutiveProfileId) {
      throw forbidden("Sales Support may only create Self Executive SWOT");
    }
    if (executiveId && executiveId !== actor.id) {
      throw forbidden("Sales Support may only create Self SWOT for themselves");
    }
    return createExecutiveSwot({
      actor,
      source: "SALES_SUPPORT_EXECUTIVE",
      executiveUserId: actor.id,
      teamId: null,
      assignmentId: null,
      input,
      forceVisible: true,
    });
  }

  if (actor.roleCode === "SALES_EXECUTIVE") {
    if (input.subjectType === "PROFILE") {
      throw forbidden("Sales Executives cannot create Profile SWOT");
    }
    const profile = await prisma.salesExecutiveProfile.findFirst({
      where: { userId: actor.id, archivedAt: null },
    });
    if (!profile) throw forbidden("No Sales Executive profile found");
    if (
      input.salesExecutiveProfileId &&
      input.salesExecutiveProfileId !== profile.id
    ) {
      throw forbidden(
        "Sales Executives may only create SWOT for themselves",
      );
    }
    if (executiveId && executiveId !== actor.id) {
      throw forbidden(
        "Sales Executives may only create SWOT for themselves",
      );
    }
    return createExecutiveSwot({
      actor,
      source: "SALES_EXECUTIVE",
      executiveUserId: actor.id,
      teamId: profile.teamId,
      assignmentId: null,
      input,
      forceVisible: true,
      workspaceProfileId: profile.id,
    });
  }

  // ── Managers: Profile SWOT is retired ──────────────────────────
  if (input.subjectType === "PROFILE") {
    throw badRequest(
      "Profile SWOT is no longer used. Create an Executive SWOT for the Sales Executive instead.",
    );
  }

  // ── Managers: EXECUTIVE SWOT about SSE / SE (by user id) ────────
  if (executiveId) {
    if (
      actor.roleCode !== "TEAM_LEAD" &&
      actor.roleCode !== "COMMANDO_EXECUTIVE"
    ) {
      throw forbidden("Only Team Leads and Commandos can create SWOT for others");
    }

    const subjectUser = await prisma.user.findFirst({
      where: {
        id: executiveId,
        deletedAt: null,
        isActive: true,
      },
      select: {
        id: true,
        role: { select: { code: true } },
        salesExecutiveProfile: {
          select: { id: true, teamId: true, archivedAt: true },
        },
      },
    });
    if (!subjectUser) throw badRequest("Executive user not found");

    if (subjectUser.role.code === "SALES_SUPPORT_EXECUTIVE") {
      if (actor.roleCode === "TEAM_LEAD") {
        await assertSseInTeamLeadScope(actor, executiveId);
      } else {
        await assertSseInCommandoScope(actor, executiveId, true);
      }
      let teamId: string | null = null;
      const profileIds =
        actor.roleCode === "TEAM_LEAD"
          ? await teamLeadProfileIds(actor.id)
          : await commandoProfileIds(actor.id, true);
      const link = await prisma.salesSupportLink.findFirst({
        where: {
          salesSupportUserId: executiveId,
          isActive: true,
          salesExecutiveProfileId: { in: profileIds },
        },
        include: { profile: { select: { teamId: true } } },
      });
      teamId = link?.profile.teamId ?? null;
      return createExecutiveSwot({
        actor,
        source,
        executiveUserId: executiveId,
        teamId,
        assignmentId: null,
        input,
        forceVisible: false,
      });
    }

    if (subjectUser.role.code === "SALES_EXECUTIVE") {
      const profile = subjectUser.salesExecutiveProfile;
      if (!profile || profile.archivedAt) {
        throw badRequest("Sales Executive has no active profile");
      }
      await assertProfileInScope(prisma, actor, profile.id);
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
        where: { salesExecutiveProfileId: profile.id, status: "ACTIVE" },
        select: { id: true },
      });
      return createExecutiveSwot({
        actor,
        source,
        executiveUserId: executiveId,
        teamId: profile.teamId,
        assignmentId: activeAssignment?.id ?? null,
        input,
        forceVisible: false,
        workspaceProfileId: profile.id,
      });
    }

    throw badRequest("SWOT subject must be a Sales Executive or Sales Support");
  }

  // ── Managers: EXECUTIVE SWOT via profile id (resolve person) ───
  if (input.salesExecutiveProfileId) {
    await assertProfileInScope(prisma, actor, input.salesExecutiveProfileId);
    const profile = await prisma.salesExecutiveProfile.findFirstOrThrow({
      where: { id: input.salesExecutiveProfileId, archivedAt: null },
    });

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
      where: { salesExecutiveProfileId: profile.id, status: "ACTIVE" },
      select: { id: true },
    });

    return createExecutiveSwot({
      actor,
      source,
      executiveUserId: profile.userId,
      teamId: profile.teamId,
      assignmentId: activeAssignment?.id ?? null,
      input,
      forceVisible: false,
      workspaceProfileId: profile.id,
    });
  }

  throw badRequest(
    "Provide subjectType PROFILE with salesExecutiveProfileId, or Executive subject via executiveUserId / salesExecutiveProfileId",
  );
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
      subjectType: updated.subjectType,
      profileId: updated.salesExecutiveProfileId,
      executiveUserId: updated.executiveUserId,
      verb: "UPDATE",
    },
  });

  return serialize(updated, actor);
}
