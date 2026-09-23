import type { FeedbackSource, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { getActiveTeamIds } from "../../lib/scope.js";
import {
  assertCanManageSupportUser,
  supportUserIdsOnTeams,
  teamIdsForCommandoActive,
} from "../../lib/supportScope.js";
import {
  coachingSourcesVisibleToSalesExecutive,
  getCommandoLifecycleState,
  salesExecutiveCanViewCoachingSource,
} from "../../lib/lifecycleVisibility.js";
import { assertTeamLeadOperationalWriteAllowed } from "../../lib/teamLeadLock.js";
import { recordWorkspaceEvent } from "../../lib/workspaceEvents.js";
import type { CreateFeedbackInput, ListFeedbackQuery } from "./schemas.js";

const feedbackInclude = {
  profile: {
    select: { id: true, displayName: true, userId: true, teamId: true },
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
  createdBy: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: { select: { code: true } },
    },
  },
  assignment: {
    select: { id: true, status: true, startedAt: true, endedAt: true },
  },
} satisfies Prisma.FeedbackInclude;

type FeedbackRow = Prisma.FeedbackGetPayload<{ include: typeof feedbackInclude }>;

function sourceForRole(roleCode: Actor["roleCode"]): FeedbackSource {
  switch (roleCode) {
    case "TEAM_LEAD":
      return "TEAM_LEAD";
    case "COMMANDO_EXECUTIVE":
      return "COMMANDO";
    default:
      throw forbidden("Your role cannot create feedback");
  }
}

function serialize(
  row: FeedbackRow,
  acknowledgedAt: Date | null = null,
) {
  return {
    id: row.id,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    executiveUserId: row.executiveUserId,
    profile: row.profile,
    executiveUser: row.executiveUser,
    assignmentId: row.assignmentId,
    assignment: row.assignment,
    source: row.source,
    body: row.body,
    createdById: row.createdById,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    acknowledgedAt: acknowledgedAt?.toISOString() ?? null,
  };
}

function subjectOwnerUserId(row: FeedbackRow): string | null {
  return row.profile?.userId ?? row.executiveUserId ?? null;
}

async function seAcknowledgementsByFeedbackId(rows: FeedbackRow[]) {
  const map = new Map<string, Date>();
  if (rows.length === 0) return map;
  const ownerIds = [
    ...new Set(
      rows
        .map((row) => subjectOwnerUserId(row))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (ownerIds.length === 0) return map;
  const acks = await prisma.recordAcknowledgement.findMany({
    where: {
      entityType: "FEEDBACK",
      entityId: { in: rows.map((row) => row.id) },
      userId: { in: ownerIds },
    },
    select: { entityId: true, userId: true, acknowledgedAt: true },
  });
  const owners = new Map(
    rows.map((row) => [row.id, subjectOwnerUserId(row)] as const),
  );
  for (const ack of acks) {
    if (owners.get(ack.entityId) === ack.userId) {
      map.set(ack.entityId, ack.acknowledgedAt);
    }
  }
  return map;
}

async function scopeWhere(
  actor: Actor,
): Promise<Prisma.FeedbackWhereInput> {
  if (isSuperAdmin(actor)) {
    return { archivedAt: null };
  }

  switch (actor.roleCode) {
    case "TEAM_LEAD": {
      const teamIds = await getActiveTeamIds(prisma, actor.id);
      const supportIds = await supportUserIdsOnTeams(prisma, teamIds);
      return {
        archivedAt: null,
        source: "TEAM_LEAD",
        OR: [
          { profile: { teamId: { in: teamIds } } },
          ...(supportIds.length
            ? [{ executiveUserId: { in: supportIds } }]
            : []),
        ],
      };
    }
    case "COMMANDO_EXECUTIVE": {
      const assignments = await prisma.commandoAssignment.findMany({
        where: { commandoUserId: actor.id },
        select: { salesExecutiveProfileId: true },
      });
      const profileIds = [
        ...new Set(assignments.map((a) => a.salesExecutiveProfileId)),
      ];
      const teamIds = await teamIdsForCommandoActive(prisma, actor.id);
      const supportIds = await supportUserIdsOnTeams(prisma, teamIds);
      return {
        archivedAt: null,
        source: { in: ["TEAM_LEAD", "COMMANDO"] },
        OR: [
          { salesExecutiveProfileId: { in: profileIds } },
          ...(supportIds.length
            ? [{ executiveUserId: { in: supportIds } }]
            : []),
        ],
      };
    }
    case "SALES_EXECUTIVE": {
      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { userId: actor.id, archivedAt: null },
        select: { id: true },
      });
      if (!profile) return { id: "__none__" };
      const lifecycle = await getCommandoLifecycleState(prisma, profile.id);
      const sources = coachingSourcesVisibleToSalesExecutive(lifecycle);
      return {
        archivedAt: null,
        salesExecutiveProfileId: profile.id,
        source: { in: sources },
      };
    }
    case "SALES_SUPPORT_EXECUTIVE":
      return {
        archivedAt: null,
        executiveUserId: actor.id,
      };
    default:
      return { id: "__none__" };
  }
}

async function assertCanAccess(actor: Actor, row: FeedbackRow): Promise<void> {
  if (isSuperAdmin(actor)) return;

  if (row.executiveUserId) {
    if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
      if (row.executiveUserId !== actor.id) {
        throw forbidden("You may only view your own feedback");
      }
      return;
    }
    if (actor.roleCode === "TEAM_LEAD") {
      if (row.source !== "TEAM_LEAD") {
        throw forbidden("Team Leads may only view Team Lead feedback");
      }
      await assertCanManageSupportUser(prisma, actor, row.executiveUserId);
      return;
    }
    if (actor.roleCode === "COMMANDO_EXECUTIVE") {
      await assertCanManageSupportUser(prisma, actor, row.executiveUserId);
      return;
    }
    throw forbidden("Not allowed to access feedback");
  }

  if (!row.salesExecutiveProfileId || !row.profile) {
    throw forbidden("Not allowed to access feedback");
  }

  if (actor.roleCode === "TEAM_LEAD") {
    if (row.source !== "TEAM_LEAD") {
      throw forbidden("Team Leads may only view Team Lead feedback");
    }
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(row.profile.teamId)) {
      throw forbidden("Feedback is outside your team scope");
    }
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
      throw forbidden("Feedback is outside your assignment scope");
    }
    return;
  }

  if (actor.roleCode === "SALES_EXECUTIVE") {
    if (row.profile.userId !== actor.id) {
      throw forbidden("You may only view your own feedback");
    }
    const lifecycle = await getCommandoLifecycleState(
      prisma,
      row.salesExecutiveProfileId,
    );
    if (!salesExecutiveCanViewCoachingSource(row.source, lifecycle)) {
      throw forbidden(
        "Feedback is not visible for this Sales Executive",
      );
    }
    return;
  }

  throw forbidden("Not allowed to access feedback");
}

export async function listFeedback(actor: Actor, query: ListFeedbackQuery) {
  const scope = await scopeWhere(actor);
  const where: Prisma.FeedbackWhereInput = {
    AND: [
      scope,
      ...(query.profileId
        ? [{ salesExecutiveProfileId: query.profileId }]
        : []),
      ...(query.executiveUserId
        ? [{ executiveUserId: query.executiveUserId }]
        : []),
      ...(query.source ? [{ source: query.source }] : []),
      ...(query.search
        ? [
            {
              OR: [
                {
                  body: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  profile: {
                    displayName: {
                      contains: query.search,
                      mode: "insensitive" as const,
                    },
                  },
                },
                {
                  executiveUser: {
                    OR: [
                      {
                        firstName: {
                          contains: query.search,
                          mode: "insensitive" as const,
                        },
                      },
                      {
                        lastName: {
                          contains: query.search,
                          mode: "insensitive" as const,
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ]
        : []),
    ],
  };

  const [total, rows] = await Promise.all([
    prisma.feedback.count({ where }),
    prisma.feedback.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: "desc" },
      include: feedbackInclude,
    }),
  ]);

  const acks = await seAcknowledgementsByFeedbackId(rows);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    feedback: rows.map((row) => serialize(row, acks.get(row.id) ?? null)),
  };
}

export async function getFeedback(actor: Actor, id: string) {
  const row = await prisma.feedback.findFirst({
    where: { id, archivedAt: null },
    include: feedbackInclude,
  });
  if (!row) throw notFound("Feedback not found");
  await assertCanAccess(actor, row);
  const acks = await seAcknowledgementsByFeedbackId([row]);
  return serialize(row, acks.get(row.id) ?? null);
}

export async function createFeedback(actor: Actor, input: CreateFeedbackInput) {
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for feedback");
  }

  const source = sourceForRole(actor.roleCode);

  if (input.executiveUserId) {
    await assertCanManageSupportUser(prisma, actor, input.executiveUserId);
    const created = await prisma.feedback.create({
      data: {
        executiveUserId: input.executiveUserId,
        salesExecutiveProfileId: null,
        assignmentId: null,
        source,
        body: input.body,
        createdById: actor.id,
      },
      include: feedbackInclude,
    });

    await writeAuditLog({
      actorId: actor.id,
      action: "FEEDBACK_CREATED",
      entityType: "Feedback",
      entityId: created.id,
      metadata: {
        executiveUserId: input.executiveUserId,
        source,
        verb: "CREATE",
      },
    });

    return serialize(created, null);
  }

  if (!input.salesExecutiveProfileId) {
    throw badRequest("Missing feedback subject");
  }

  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: input.salesExecutiveProfileId, archivedAt: null },
  });
  if (!profile) throw notFound("Sales executive profile not found");

  let assignmentId: string | null = null;

  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(profile.teamId)) {
      throw forbidden("Profile is outside your team scope");
    }
    await assertTeamLeadOperationalWriteAllowed(prisma, actor, profile.id, {
      action: "FEEDBACK_CREATE",
    });
    const active = await prisma.commandoAssignment.findFirst({
      where: { salesExecutiveProfileId: profile.id, status: "ACTIVE" },
      select: { id: true },
    });
    assignmentId = active?.id ?? null;
  } else if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    const assignment = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: profile.id,
        commandoUserId: actor.id,
        status: "ACTIVE",
      },
    });
    if (!assignment) {
      throw forbidden(
        "You may only create feedback for profiles with an active assignment to you",
      );
    }
    assignmentId = assignment.id;
  }

  const created = await prisma.feedback.create({
    data: {
      salesExecutiveProfileId: profile.id,
      assignmentId,
      source,
      body: input.body,
      createdById: actor.id,
    },
    include: feedbackInclude,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "FEEDBACK_CREATED",
    entityType: "Feedback",
    entityId: created.id,
    metadata: { profileId: profile.id, source, assignmentId, verb: "CREATE" },
  });

  await recordWorkspaceEvent({
    salesExecutiveProfileId: profile.id,
    assignmentId,
    type: "FEEDBACK",
    title: created.body.slice(0, 120),
    notes: created.body,
    status: "COMPLETED",
    sourceType: "Feedback",
    sourceId: created.id,
    createdById: actor.id,
  });

  return serialize(created, null);
}

export async function acknowledgeFeedback(actor: Actor, id: string) {
  const row = await prisma.feedback.findFirst({
    where: { id, archivedAt: null },
    include: feedbackInclude,
  });
  if (!row) throw notFound("Feedback not found");
  await assertCanAccess(actor, row);

  if (
    actor.roleCode !== "SALES_EXECUTIVE" &&
    actor.roleCode !== "SALES_SUPPORT_EXECUTIVE"
  ) {
    throw forbidden("Only the subject can acknowledge this feedback");
  }

  const ownerId = subjectOwnerUserId(row);
  if (!ownerId || ownerId !== actor.id) {
    throw forbidden("You may only acknowledge your own feedback");
  }
  if (row.createdById === actor.id) {
    throw forbidden("You cannot acknowledge your own note");
  }
  if (!row.salesExecutiveProfileId) {
    // Acknowledgements table still requires profileId — Support skip ack storage for now
    throw forbidden(
      "Acknowledgement is not available for Sales Support feedback yet",
    );
  }

  const acknowledgement = await prisma.recordAcknowledgement.upsert({
    where: {
      userId_entityType_entityId: {
        userId: actor.id,
        entityType: "FEEDBACK",
        entityId: row.id,
      },
    },
    update: { acknowledgedAt: new Date() },
    create: {
      userId: actor.id,
      salesExecutiveProfileId: row.salesExecutiveProfileId,
      entityType: "FEEDBACK",
      entityId: row.id,
    },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "FEEDBACK_ACKNOWLEDGED",
    entityType: "Feedback",
    entityId: row.id,
    metadata: {
      profileId: row.salesExecutiveProfileId,
      source: row.source,
      verb: "ACKNOWLEDGE",
    },
  });

  return serialize(row, acknowledgement.acknowledgedAt);
}
