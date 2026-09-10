import type { Prisma, ReferralStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AUDIT_ACTIONS, writeAuditLog } from "../../lib/audit.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import {
  getActiveTeamIds,
  requireRecordAccess,
} from "../../lib/scope.js";
import type { CreateReferralInput, ListReferralsQuery } from "./schemas.js";
import type {
  CreateCommandoRequestInput,
  ProvideReferralInformationInput,
  RejectReferralInput,
} from "./schemas.js";

/** Controlled lifecycle — no arbitrary jumps. */
export const REFERRAL_TRANSITIONS: Record<
  ReferralStatus,
  Partial<Record<ReferralStatus, "acknowledge" | "begin" | "complete">>
> = {
  SUBMITTED: { ACKNOWLEDGED: "acknowledge" },
  ACKNOWLEDGED: { IN_PROGRESS: "begin" },
  IN_PROGRESS: { COMPLETED: "complete" },
  COMPLETED: {},
  REJECTED: {},
};

const ACTIVE_ASSIGNMENT_OTHER_COMMANDO =
  "This Sales Executive is already assigned to another Commando. End or transfer that assignment before referring them elsewhere.";

const referralInclude = {
  profile: {
    select: {
      id: true,
      displayName: true,
      userId: true,
      teamId: true,
    },
  },
  team: { select: { id: true, name: true } },
  teamLead: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  commando: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  assignment: {
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
    },
  },
} satisfies Prisma.ReferralInclude;

type ReferralRow = Prisma.ReferralGetPayload<{ include: typeof referralInclude }>;

type TeamLeadSwotSummary = {
  id: string;
  strength: string;
  weakness: string;
  opportunity: string;
  threat: string;
  source: string;
  createdAt: Date;
};

function serialize(
  referral: ReferralRow,
  teamLeadSwot: TeamLeadSwotSummary | null = null,
) {
  return {
    id: referral.id,
    salesExecutiveProfileId: referral.salesExecutiveProfileId,
    profile: referral.profile,
    teamLeadUserId: referral.teamLeadUserId,
    teamLead: referral.teamLead,
    teamId: referral.teamId,
    team: referral.team,
    commandoUserId: referral.commandoUserId,
    commando: referral.commando,
    assignmentId: referral.assignmentId,
    assignment: referral.assignment,
    profileName: referral.profileName,
    whySalesIsDown: referral.whySalesIsDown,
    whatIsTheGap: referral.whatIsTheGap,
    detailedSummaryOfGap: referral.detailedSummaryOfGap,
    supportAlreadyProvided: referral.supportAlreadyProvided,
    supportRequiredFromCommando: referral.supportRequiredFromCommando,
    recommendationFocus: referral.recommendationFocus,
    priority1: referral.priority1,
    priority2: referral.priority2,
    priority3: referral.priority3,
    initiatedBy: referral.initiatedBy,
    requestReason: referral.requestReason,
    informationProvidedAt: referral.informationProvidedAt,
    rejectionReason: referral.rejectionReason,
    rejectedAt: referral.rejectedAt,
    status: referral.status,
    acknowledgedAt: referral.acknowledgedAt,
    acknowledgedById: referral.acknowledgedById,
    acknowledgementNote: referral.acknowledgementNote,
    completedAt: referral.completedAt,
    createdAt: referral.createdAt,
    updatedAt: referral.updatedAt,
    teamLeadSwot,
    allowedActions: allowedActionsFor(referral),
  };
}

async function findTeamLeadSwot(
  profileId: string,
  notBefore?: Date | null,
): Promise<TeamLeadSwotSummary | null> {
  return prisma.swotAnalysis.findFirst({
    where: {
      salesExecutiveProfileId: profileId,
      source: "TEAM_LEAD",
      archivedAt: null,
      ...(notBefore
        ? { createdAt: { gte: new Date(notBefore.getTime() - 60_000) } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      strength: true,
      weakness: true,
      opportunity: true,
      threat: true,
      source: true,
      createdAt: true,
    },
  });
}

async function attachTeamLeadSwot(referral: ReferralRow) {
  const swot =
    (await findTeamLeadSwot(referral.salesExecutiveProfileId, referral.createdAt)) ??
    (await findTeamLeadSwot(referral.salesExecutiveProfileId));
  return serialize(referral, swot);
}

function allowedActionsFor(referral: {
  status: ReferralStatus;
  initiatedBy: "TEAM_LEAD" | "COMMANDO";
  informationProvidedAt: Date | null;
}): string[] {
  if (referral.status === "COMPLETED" || referral.status === "REJECTED") {
    return [];
  }

  if (referral.status === "SUBMITTED") {
    if (
      referral.initiatedBy === "COMMANDO" &&
      !referral.informationProvidedAt
    ) {
      return ["provideInformation", "reject"];
    }
    // Legacy Team Lead–initiated handoffs (deprecated)
    if (referral.initiatedBy === "TEAM_LEAD") {
      return ["acknowledge", "reject"];
    }
    return ["acknowledge", "reject"];
  }

  if (referral.status === "ACKNOWLEDGED") return ["begin"];
  if (referral.status === "IN_PROGRESS") return ["complete"];
  return [];
}

export async function referralScopeWhere(
  actor: Actor,
): Promise<Prisma.ReferralWhereInput> {
  if (isSuperAdmin(actor)) {
    return { archivedAt: null };
  }

  switch (actor.roleCode) {
    case "TEAM_LEAD": {
      const teamIds = await getActiveTeamIds(prisma, actor.id);
      return {
        archivedAt: null,
        OR: [{ teamLeadUserId: actor.id }, { teamId: { in: teamIds } }],
      };
    }
    case "COMMANDO_EXECUTIVE":
      return { archivedAt: null, commandoUserId: actor.id };
    default:
      return { id: "__none__" };
  }
}

async function assertReferralAccess(actor: Actor, referral: ReferralRow) {
  await requireRecordAccess(prisma, actor, {
    teamId: referral.teamId,
    profileId: referral.salesExecutiveProfileId,
    profileUserId: referral.profile.userId,
    teamLeadUserId: referral.teamLeadUserId,
    assignmentTeamLeadUserId: referral.teamLeadUserId,
    commandoUserId: referral.commandoUserId,
    assignmentCommandoUserId: referral.commandoUserId,
  });
}

export async function listReferrals(actor: Actor, query: ListReferralsQuery) {
  const scope = await referralScopeWhere(actor);
  const where: Prisma.ReferralWhereInput = {
    ...scope,
    ...(query.status ? { status: query.status } : {}),
    ...(query.initiatedBy ? { initiatedBy: query.initiatedBy } : {}),
    ...(query.search
      ? {
          OR: [
            { profileName: { contains: query.search, mode: "insensitive" } },
            { whySalesIsDown: { contains: query.search, mode: "insensitive" } },
            { whatIsTheGap: { contains: query.search, mode: "insensitive" } },
            {
              recommendationFocus: {
                contains: query.search,
                mode: "insensitive",
              },
            },
            {
              requestReason: {
                contains: query.search,
                mode: "insensitive",
              },
            },
            {
              profile: {
                displayName: { contains: query.search, mode: "insensitive" },
              },
            },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.referral.count({ where }),
    prisma.referral.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: "desc" },
      include: referralInclude,
    }),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    referrals: rows.map((row) => serialize(row)),
  };
}

export async function getReferral(actor: Actor, referralId: string) {
  const referral = await prisma.referral.findFirst({
    where: { id: referralId, archivedAt: null },
    include: referralInclude,
  });
  if (!referral) throw notFound("Referral not found");
  await assertReferralAccess(actor, referral);
  return attachTeamLeadSwot(referral);
}

export async function createReferral(
  _actor: Actor,
  _input: CreateReferralInput,
) {
  throw forbidden(
    "Team Leads do not send Sales Executives to Commando. Commandos must request intervention via POST /api/referrals/request.",
  );
}

type TransitionAction = "acknowledge" | "begin" | "complete";

async function transition(
  actor: Actor,
  referralId: string,
  action: TransitionAction,
  note?: string | null,
) {
  const referral = await prisma.referral.findFirst({
    where: { id: referralId, archivedAt: null },
    include: referralInclude,
  });
  if (!referral) throw notFound("Referral not found");
  await assertReferralAccess(actor, referral);

  const allowed = REFERRAL_TRANSITIONS[referral.status];
  const target = (
    Object.entries(allowed) as [ReferralStatus, TransitionAction][]
  ).find(([, a]) => a === action)?.[0];

  if (!target) {
    throw badRequest(
      `Action "${action}" is not allowed from status ${referral.status}`,
    );
  }

  // Commando (or Super Admin) performs acknowledge / begin / complete
  if (!isSuperAdmin(actor)) {
    if (actor.roleCode !== "COMMANDO_EXECUTIVE") {
      throw forbidden("Only the assigned Commando can advance this referral");
    }
    if (referral.commandoUserId !== actor.id) {
      throw forbidden("This referral is not assigned to you");
    }
  }

  if (action === "acknowledge") {
    if (
      referral.initiatedBy === "COMMANDO" &&
      !referral.informationProvidedAt
    ) {
      throw badRequest(
        "Team Lead must Approve & Provide Information before this request can proceed",
      );
    }
    const updated = await acknowledgeAndEnsureAssignment(actor, referral, note);
    return attachTeamLeadSwot(updated);
  }

  if (action === "begin") {
    const updated = await beginWithExistingAssignment(actor, referral);
    return attachTeamLeadSwot(updated);
  }

  // complete — referral handoff only; assignment stays ACTIVE until ended separately
  const updated = await prisma.referral.update({
    where: { id: referralId },
    data: {
      status: target,
      completedAt: new Date(),
    },
    include: referralInclude,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "REFERRAL_COMPLETED",
    entityType: "Referral",
    entityId: updated.id,
    metadata: {
      from: referral.status,
      to: target,
      action: "complete",
      verb: "COMPLETE",
    },
  });

  return attachTeamLeadSwot(updated);
}

type Tx = Prisma.TransactionClient;

/**
 * Ensure an ACTIVE CommandoAssignment exists for this referral's Commando + SE.
 * Acknowledge creates (or links) the assignment. Completing the referral does
 * not end the assignment — that remains a separate Complete intervention action.
 */
async function ensureActiveAssignment(
  tx: Tx,
  actor: Actor,
  referral: ReferralRow,
  via: "referral_acknowledge" | "referral_begin",
): Promise<string> {
  const locked = await tx.$queryRaw<
    Array<{ id: string; commandoUserId: string }>
  >`
    SELECT id, "commandoUserId"
    FROM "CommandoAssignment"
    WHERE "salesExecutiveProfileId" = ${referral.salesExecutiveProfileId}
      AND status = 'ACTIVE'
    FOR UPDATE
  `;

  let assignmentId = locked[0]?.id ?? null;

  if (locked[0] && locked[0].commandoUserId !== referral.commandoUserId) {
    throw conflict(ACTIVE_ASSIGNMENT_OTHER_COMMANDO);
  }

  if (assignmentId) {
    return assignmentId;
  }

  const created = await tx.commandoAssignment.create({
    data: {
      salesExecutiveProfileId: referral.salesExecutiveProfileId,
      commandoUserId: referral.commandoUserId,
      teamLeadUserId: referral.teamLeadUserId,
      teamId: referral.teamId,
      startedAt: new Date(),
      status: "ACTIVE",
    },
  });
  assignmentId = created.id;

  await writeAuditLog(
    {
      actorId: actor.id,
      action: AUDIT_ACTIONS.COMMANDO_ASSIGNMENT_STARTED,
      entityType: "CommandoAssignment",
      entityId: created.id,
      metadata: {
        profileId: referral.salesExecutiveProfileId,
        commandoUserId: referral.commandoUserId,
        teamLeadUserId: referral.teamLeadUserId,
        teamId: referral.teamId,
        via,
        referralId: referral.id,
        verb: "ASSIGN",
      },
    },
    tx,
  );

  await tx.swotAnalysis.updateMany({
    where: {
      salesExecutiveProfileId: referral.salesExecutiveProfileId,
      source: "TEAM_LEAD",
      assignmentId: null,
      archivedAt: null,
    },
    data: { assignmentId },
  });

  return assignmentId;
}

function rethrowAssignmentConflict(err: unknown): never {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  ) {
    throw conflict(ACTIVE_ASSIGNMENT_OTHER_COMMANDO);
  }
  throw err;
}

/**
 * Acknowledge referral and persist ACTIVE assignment so the SE remains in the
 * Commando workspace (profiles scope, coaching modules) after ACKNOWLEDGED.
 */
async function acknowledgeAndEnsureAssignment(
  actor: Actor,
  referral: ReferralRow,
  note?: string | null,
): Promise<ReferralRow> {
  try {
    return await prisma.$transaction(async (tx) => {
      const assignmentId = await ensureActiveAssignment(
        tx,
        actor,
        referral,
        "referral_acknowledge",
      );

      const row = await tx.referral.update({
        where: { id: referral.id },
        data: {
          status: "ACKNOWLEDGED",
          acknowledgedAt: new Date(),
          acknowledgedById: actor.id,
          acknowledgementNote: note?.trim() ? note.trim() : undefined,
          assignmentId,
        },
        include: referralInclude,
      });

      await writeAuditLog(
        {
          actorId: actor.id,
          action: "REFERRAL_ACKNOWLEDGED",
          entityType: "Referral",
          entityId: row.id,
          metadata: {
            from: referral.status,
            to: "ACKNOWLEDGED",
            action: "acknowledge",
            assignmentId,
            verb: "ACKNOWLEDGE",
          },
        },
        tx,
      );

      return row;
    });
  } catch (err) {
    rethrowAssignmentConflict(err);
  }
}

/**
 * Start coaching: move referral to IN_PROGRESS. Assignment should already exist
 * from acknowledge; ensure again as a safety net for older referrals.
 */
async function beginWithExistingAssignment(
  actor: Actor,
  referral: ReferralRow,
): Promise<ReferralRow> {
  try {
    return await prisma.$transaction(async (tx) => {
      const assignmentId = await ensureActiveAssignment(
        tx,
        actor,
        referral,
        "referral_begin",
      );

      const row = await tx.referral.update({
        where: { id: referral.id },
        data: {
          status: "IN_PROGRESS",
          assignmentId,
        },
        include: referralInclude,
      });

      await writeAuditLog(
        {
          actorId: actor.id,
          action: "REFERRAL_IN_PROGRESS",
          entityType: "Referral",
          entityId: row.id,
          metadata: {
            from: referral.status,
            to: "IN_PROGRESS",
            action: "begin",
            assignmentId,
            verb: "UPDATE",
          },
        },
        tx,
      );

      return row;
    });
  } catch (err) {
    rethrowAssignmentConflict(err);
  }
}

export async function listCommandosForReferral(actor: Actor) {
  if (
    actor.roleCode !== "TEAM_LEAD" &&
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    !isSuperAdmin(actor)
  ) {
    throw forbidden("Not allowed to list Commandos for referral");
  }

  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      role: { code: "COMMANDO_EXECUTIVE" },
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return users;
}

/**
 * Profiles a Commando may request for intervention (not currently ACTIVE under anyone).
 * Limited fields only — full workspace access begins after Team Lead approval.
 */
export async function listRequestableProfiles(actor: Actor, search?: string) {
  if (actor.roleCode !== "COMMANDO_EXECUTIVE") {
    throw forbidden("Only Commandos can browse Sales Executives to request");
  }

  const activeAssigned = await prisma.commandoAssignment.findMany({
    where: { status: "ACTIVE" },
    select: { salesExecutiveProfileId: true },
  });
  const activeIds = activeAssigned.map((a) => a.salesExecutiveProfileId);

  const pendingMine = await prisma.referral.findMany({
    where: {
      commandoUserId: actor.id,
      initiatedBy: "COMMANDO",
      status: "SUBMITTED",
      archivedAt: null,
    },
    select: { salesExecutiveProfileId: true },
  });
  const pendingIds = pendingMine.map((r) => r.salesExecutiveProfileId);

  const profiles = await prisma.salesExecutiveProfile.findMany({
    where: {
      archivedAt: null,
      id: { notIn: [...new Set([...activeIds, ...pendingIds])] },
      ...(search?.trim()
        ? {
            OR: [
              { displayName: { contains: search.trim(), mode: "insensitive" } },
              {
                team: {
                  name: { contains: search.trim(), mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    },
    take: 50,
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      displayName: true,
      employeeCode: true,
      team: { select: { id: true, name: true } },
    },
  });

  const teamIds = [...new Set(profiles.map((p) => p.team.id))];
  const teamLeads = await prisma.teamMembership.findMany({
    where: {
      teamId: { in: teamIds },
      isActive: true,
      endedAt: null,
      user: {
        deletedAt: null,
        isActive: true,
        role: { code: "TEAM_LEAD" },
      },
    },
    select: {
      teamId: true,
      user: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  });
  const leadByTeam = new Map(
    teamLeads.map((m) => [m.teamId, m.user] as const),
  );

  return profiles.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    employeeCode: p.employeeCode,
    team: p.team,
    teamLead: leadByTeam.get(p.team.id) ?? null,
  }));
}

/**
 * Commando requests temporary intervention access for an SE.
 * Team Lead remains owner; they must Approve & Provide Information next.
 */
export async function createCommandoRequest(
  actor: Actor,
  input: CreateCommandoRequestInput,
) {
  if (actor.roleCode !== "COMMANDO_EXECUTIVE") {
    throw forbidden("Only Commandos can request Sales Executives for intervention");
  }

  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: input.salesExecutiveProfileId, archivedAt: null },
  });
  if (!profile) throw notFound("Sales executive profile not found");

  const teamLead = await prisma.user.findFirst({
    where: {
      role: { code: "TEAM_LEAD" },
      deletedAt: null,
      isActive: true,
      teamMemberships: {
        some: {
          teamId: profile.teamId,
          isActive: true,
          endedAt: null,
        },
      },
    },
  });
  if (!teamLead) {
    throw badRequest("No Team Lead is assigned to this Sales Executive's team");
  }

  const activeAssignment = await prisma.commandoAssignment.findFirst({
    where: { salesExecutiveProfileId: profile.id, status: "ACTIVE" },
  });
  if (activeAssignment) {
    if (activeAssignment.commandoUserId === actor.id) {
      throw conflict("You already have an active intervention with this Sales Executive");
    }
    throw conflict(ACTIVE_ASSIGNMENT_OTHER_COMMANDO);
  }

  const pending = await prisma.referral.findFirst({
    where: {
      salesExecutiveProfileId: profile.id,
      commandoUserId: actor.id,
      initiatedBy: "COMMANDO",
      status: "SUBMITTED",
      archivedAt: null,
    },
  });
  if (pending) {
    throw conflict("You already have a pending request for this Sales Executive");
  }

  const created = await prisma.referral.create({
    data: {
      salesExecutiveProfileId: profile.id,
      teamLeadUserId: teamLead.id,
      teamId: profile.teamId,
      commandoUserId: actor.id,
      profileName: profile.displayName,
      initiatedBy: "COMMANDO",
      requestReason: input.requestReason,
      acknowledgementNote: input.note?.trim() ? input.note.trim() : null,
      whySalesIsDown: "(Pending Team Lead information)",
      whatIsTheGap: "(Pending Team Lead information)",
      detailedSummaryOfGap: "(Pending Team Lead information)",
      supportAlreadyProvided: "(Pending Team Lead information)",
      supportRequiredFromCommando: "(Pending Team Lead information)",
      recommendationFocus: "(Pending Team Lead information)",
      priority1: null,
      priority2: null,
      priority3: null,
      status: "SUBMITTED",
    },
    include: referralInclude,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: AUDIT_ACTIONS.COMMANDO_REQUEST_SUBMITTED,
    entityType: "Referral",
    entityId: created.id,
    metadata: {
      profileId: profile.id,
      teamLeadUserId: teamLead.id,
      requestReason: input.requestReason,
      initiatedBy: "COMMANDO",
      verb: "SUBMIT",
    },
  });

  return serialize(created, null);
}

/**
 * Team Lead approves a Commando request and hands over the management packet.
 * Creates/links the ACTIVE assignment — SE enters Commando intervention;
 * Team Lead operational writes become locked until intervention ends.
 */
export async function provideReferralInformation(
  actor: Actor,
  referralId: string,
  input: ProvideReferralInformationInput,
) {
  const referral = await prisma.referral.findFirst({
    where: { id: referralId, archivedAt: null },
    include: referralInclude,
  });
  if (!referral) throw notFound("Referral not found");

  if (actor.roleCode !== "TEAM_LEAD" && !isSuperAdmin(actor)) {
    throw forbidden("Only the Team Lead can Approve & Provide Information");
  }
  if (actor.roleCode === "TEAM_LEAD" && referral.teamLeadUserId !== actor.id) {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(referral.teamId)) {
      throw forbidden("This request is outside your team scope");
    }
  }

  if (referral.initiatedBy !== "COMMANDO") {
    throw badRequest("Only Commando-initiated requests use Approve & Provide Information");
  }
  if (referral.status !== "SUBMITTED" || referral.informationProvidedAt) {
    throw badRequest("This request is not waiting for Team Lead information");
  }

  const providedAt = new Date();

  try {
    const { updated, swot } = await prisma.$transaction(async (tx) => {
      const assignmentId = await ensureActiveAssignment(
        tx,
        actor,
        referral,
        "referral_acknowledge",
      );

      const row = await tx.referral.update({
        where: { id: referral.id },
        data: {
          whySalesIsDown: input.whySalesIsDown,
          whatIsTheGap: input.whatIsTheGap,
          detailedSummaryOfGap: input.detailedSummaryOfGap,
          supportAlreadyProvided: input.supportAlreadyProvided,
          supportRequiredFromCommando: input.supportRequiredFromCommando,
          recommendationFocus: input.recommendationFocus,
          priority1: input.priority1,
          priority2: input.priority2,
          priority3: input.priority3,
          informationProvidedAt: providedAt,
          status: "ACKNOWLEDGED",
          acknowledgedAt: providedAt,
          acknowledgedById: actor.id,
          assignmentId,
        },
        include: referralInclude,
      });

      const swotRow = await tx.swotAnalysis.create({
        data: {
          salesExecutiveProfileId: referral.salesExecutiveProfileId,
          teamId: referral.teamId,
          assignmentId,
          source: "TEAM_LEAD",
          strength: input.swot.strength,
          weakness: input.swot.weakness,
          opportunity: input.swot.opportunity,
          threat: input.swot.threat,
          createdById: actor.id,
        },
        select: {
          id: true,
          strength: true,
          weakness: true,
          opportunity: true,
          threat: true,
          source: true,
          createdAt: true,
        },
      });

      await writeAuditLog(
        {
          actorId: actor.id,
          action: AUDIT_ACTIONS.REFERRAL_INFORMATION_PROVIDED,
          entityType: "Referral",
          entityId: row.id,
          metadata: {
            from: "SUBMITTED",
            to: "ACKNOWLEDGED",
            assignmentId,
            profileId: referral.salesExecutiveProfileId,
            verb: "APPROVE",
          },
        },
        tx,
      );

      await writeAuditLog(
        {
          actorId: actor.id,
          action: "SWOT_CREATED",
          entityType: "SwotAnalysis",
          entityId: swotRow.id,
          metadata: {
            profileId: referral.salesExecutiveProfileId,
            source: "TEAM_LEAD",
            via: "provide_information",
          },
        },
        tx,
      );

      return { updated: row, swot: swotRow };
    });

    return serialize(updated, swot);
  } catch (err) {
    rethrowAssignmentConflict(err);
  }
}

export function acknowledgeReferral(
  actor: Actor,
  referralId: string,
  note?: string | null,
) {
  return transition(actor, referralId, "acknowledge", note);
}

export function beginReferral(actor: Actor, referralId: string) {
  return transition(actor, referralId, "begin");
}

export function completeReferral(actor: Actor, referralId: string) {
  return transition(actor, referralId, "complete");
}

/**
 * Team Lead rejects a Commando request. No intervention is created.
 */
export async function rejectReferral(
  actor: Actor,
  referralId: string,
  input: RejectReferralInput,
) {
  const referral = await prisma.referral.findFirst({
    where: { id: referralId, archivedAt: null },
    include: referralInclude,
  });
  if (!referral) throw notFound("Referral not found");
  await assertReferralAccess(actor, referral);

  if (actor.roleCode !== "TEAM_LEAD" && !isSuperAdmin(actor)) {
    throw forbidden("Only the Team Lead can reject a Commando request");
  }
  if (actor.roleCode === "TEAM_LEAD" && referral.teamLeadUserId !== actor.id) {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(referral.teamId)) {
      throw forbidden("This request is outside your team scope");
    }
  }
  if (referral.status !== "SUBMITTED") {
    throw badRequest("Only submitted requests can be rejected");
  }
  if (referral.informationProvidedAt || referral.assignmentId) {
    throw badRequest("This request has already progressed past rejection");
  }

  const rejectedAt = new Date();
  const updated = await prisma.referral.update({
    where: { id: referral.id },
    data: {
      status: "REJECTED",
      rejectionReason: input.rejectionReason,
      rejectedAt,
    },
    include: referralInclude,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: AUDIT_ACTIONS.REFERRAL_REJECTED,
    entityType: "Referral",
    entityId: updated.id,
    metadata: {
      from: "SUBMITTED",
      to: "REJECTED",
      profileId: referral.salesExecutiveProfileId,
      rejectionReason: input.rejectionReason,
      verb: "REJECT",
    },
  });

  return serialize(updated, null);
}
