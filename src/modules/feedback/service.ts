import type { FeedbackSource, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { getActiveTeamIds } from "../../lib/scope.js";
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

function serialize(row: FeedbackRow) {
  return {
    id: row.id,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    profile: row.profile,
    assignmentId: row.assignmentId,
    assignment: row.assignment,
    source: row.source,
    body: row.body,
    createdById: row.createdById,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
      return {
        archivedAt: null,
        source: "TEAM_LEAD",
        profile: { teamId: { in: teamIds } },
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
      return {
        archivedAt: null,
        salesExecutiveProfileId: { in: profileIds },
        source: { in: ["TEAM_LEAD", "COMMANDO"] },
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
    default:
      return { id: "__none__" };
  }
}

async function assertCanAccess(actor: Actor, row: FeedbackRow): Promise<void> {
  if (isSuperAdmin(actor)) return;

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

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    feedback: rows.map(serialize),
  };
}

export async function getFeedback(actor: Actor, id: string) {
  const row = await prisma.feedback.findFirst({
    where: { id, archivedAt: null },
    include: feedbackInclude,
  });
  if (!row) throw notFound("Feedback not found");
  await assertCanAccess(actor, row);
  return serialize(row);
}

export async function createFeedback(actor: Actor, input: CreateFeedbackInput) {
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for feedback");
  }

  const source = sourceForRole(actor.roleCode);
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

  return serialize(created);
}
