import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { getActiveTeamIds } from "../../lib/scope.js";
import { assertTeamLeadOperationalWriteAllowed } from "../../lib/teamLeadLock.js";
import type {
  CreateWeeklyReviewInput,
  ListWeeklyReviewsQuery,
  UpdateWeeklyReviewInput,
} from "./schemas.js";

const reviewInclude = {
  profile: {
    select: {
      id: true,
      displayName: true,
      userId: true,
      teamId: true,
    },
  },
  createdBy: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  attendees: {
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: { select: { code: true } },
        },
      },
    },
  },
  assignment: {
    select: { id: true, status: true, startedAt: true, endedAt: true },
  },
} satisfies Prisma.WeeklyReviewInclude;

type ReviewRow = Prisma.WeeklyReviewGetPayload<{ include: typeof reviewInclude }>;

type UserBrief = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
};

async function loadUsers(ids: string[]): Promise<Map<string, UserBrief>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u]));
}

function serialize(row: ReviewRow, users: Map<string, UserBrief>, viewerId?: string) {
  const myAttendee = viewerId
    ? row.attendees.find((a) => a.userId === viewerId)
    : undefined;
  const salesExecutiveAttendee = row.attendees.find(
    (a) => a.userId === row.profile.userId,
  );

  return {
    id: row.id,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    profile: row.profile,
    assignmentId: row.assignmentId,
    assignment: row.assignment,
    commandoUserId: row.commandoUserId,
    commando: row.commandoUserId ? users.get(row.commandoUserId) ?? null : null,
    teamLeadUserId: row.teamLeadUserId,
    teamLead: users.get(row.teamLeadUserId) ?? null,
    weekLabel: row.weekLabel,
    weekStartDate: row.weekStartDate,
    meetingDate: row.meetingDate,
    performanceSummary: row.performanceSummary,
    whatWentWell: row.whatWentWell,
    improvement: row.improvement,
    nextWeekAction: row.nextWeekAction,
    status: row.status,
    submittedAt: row.submittedAt,
    createdById: row.createdById,
    createdBy: row.createdBy,
    attendees: row.attendees.map((a) => ({
      id: a.id,
      userId: a.userId,
      user: a.user,
      signedAt: a.signedAt,
      createdAt: a.createdAt,
    })),
    myStatus: myAttendee
      ? myAttendee.signedAt
        ? "SIGNED"
        : row.status === "SUBMITTED"
          ? "PENDING_SIGNATURE"
          : "DRAFT"
      : null,
    /** Whether the current viewer has signed (attendee ack). */
    signed: Boolean(myAttendee?.signedAt),
    /** Whether the Sales Executive has signed — used in manager lists. */
    salesExecutiveSigned: Boolean(salesExecutiveAttendee?.signedAt),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isEditable: row.status === "DRAFT",
  };
}

async function serializeMany(rows: ReviewRow[], viewerId?: string) {
  const userIds = rows.flatMap((r) =>
    [r.commandoUserId, r.teamLeadUserId].filter(Boolean) as string[],
  );
  const users = await loadUsers(userIds);
  return rows.map((r) => serialize(r, users, viewerId));
}

async function scopeWhere(actor: Actor): Promise<Prisma.WeeklyReviewWhereInput> {
  if (isSuperAdmin(actor)) {
    return { archivedAt: null };
  }

  switch (actor.roleCode) {
    case "COMMANDO_EXECUTIVE":
      return { archivedAt: null, commandoUserId: actor.id };
    case "TEAM_LEAD": {
      const teamIds = await getActiveTeamIds(prisma, actor.id);
      return {
        archivedAt: null,
        OR: [
          { createdById: actor.id },
          {
            status: "SUBMITTED",
            OR: [
              { teamLeadUserId: actor.id },
              { profile: { teamId: { in: teamIds } } },
            ],
          },
        ],
      };
    }
    case "SALES_EXECUTIVE": {
      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { userId: actor.id, archivedAt: null },
        select: { id: true },
      });
      if (!profile) return { id: "__none__" };
      return {
        archivedAt: null,
        salesExecutiveProfileId: profile.id,
      };
    }
    default:
      return { id: "__none__" };
  }
}

async function assertCanAccess(actor: Actor, row: ReviewRow): Promise<void> {
  if (isSuperAdmin(actor)) return;

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    if (row.commandoUserId !== actor.id) {
      throw forbidden("Review is outside your assignment scope");
    }
    return;
  }

  if (actor.roleCode === "TEAM_LEAD") {
    if (row.createdById === actor.id) return;
    if (row.status !== "SUBMITTED") {
      throw forbidden("Draft reviews are not visible to Team Leads");
    }
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (
      row.teamLeadUserId !== actor.id &&
      !teamIds.includes(row.profile.teamId)
    ) {
      throw forbidden("Review is outside your team scope");
    }
    return;
  }

  if (actor.roleCode === "SALES_EXECUTIVE") {
    if (row.profile.userId !== actor.id) {
      throw forbidden("You may only view your own weekly reviews");
    }
    return;
  }

  throw forbidden("Not allowed to access weekly reviews");
}

export async function listWeeklyReviews(
  actor: Actor,
  query: ListWeeklyReviewsQuery,
) {
  // Product rule: reviews are sent on create. Promote any legacy drafts so
  // Sales Executives see them without a second submit step.
  await prisma.weeklyReview.updateMany({
    where: { status: "DRAFT", archivedAt: null },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });

  const scope = await scopeWhere(actor);
  const where: Prisma.WeeklyReviewWhereInput = {
    AND: [
      scope,
      ...(query.status ? [{ status: query.status }] : []),
      ...(query.profileId
        ? [{ salesExecutiveProfileId: query.profileId }]
        : []),
      ...(query.search
        ? [
            {
              OR: [
                {
                  weekLabel: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  nextWeekAction: {
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

  // Sales Executives may filter drafts of their own reviews; others already
  // scoped above. Keep this guard only for unsupported roles.
  if (
    query.status === "DRAFT" &&
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    actor.roleCode !== "TEAM_LEAD" &&
    actor.roleCode !== "SALES_EXECUTIVE" &&
    !isSuperAdmin(actor)
  ) {
    return { page: query.page, pageSize: query.pageSize, total: 0, reviews: [] };
  }

  const [total, rows] = await Promise.all([
    prisma.weeklyReview.count({ where }),
    prisma.weeklyReview.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: [{ meetingDate: "desc" }, { createdAt: "desc" }],
      include: reviewInclude,
    }),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    reviews: await serializeMany(rows, actor.id),
  };
}

export async function getWeeklyReview(actor: Actor, id: string) {
  // Promote legacy draft if this record was created before auto-send.
  await prisma.weeklyReview.updateMany({
    where: { id, status: "DRAFT", archivedAt: null },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });

  const row = await prisma.weeklyReview.findFirst({
    where: { id, archivedAt: null },
    include: reviewInclude,
  });
  if (!row) throw notFound("Weekly review not found");
  await assertCanAccess(actor, row);
  const users = await loadUsers(
    [row.commandoUserId, row.teamLeadUserId].filter(Boolean) as string[],
  );
  return serialize(row, users, actor.id);
}

export async function createWeeklyReview(
  actor: Actor,
  input: CreateWeeklyReviewInput,
) {
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for weekly reviews");
  }
  if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    actor.roleCode !== "TEAM_LEAD"
  ) {
    throw forbidden("Only Commandos and Team Leads can create weekly reviews");
  }

  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: input.salesExecutiveProfileId, archivedAt: null },
  });
  if (!profile) throw notFound("Sales executive profile not found");

  let assignmentId: string | null = null;
  let commandoUserId: string | null = null;
  let teamLeadUserId: string;

  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(profile.teamId)) {
      throw forbidden("Profile is outside your team scope");
    }
    await assertTeamLeadOperationalWriteAllowed(prisma, actor, profile.id, {
      action: "WEEKLY_REVIEW_CREATE",
    });
    teamLeadUserId = actor.id;
  } else {
    const assignment = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: profile.id,
        status: "ACTIVE",
        commandoUserId: actor.id,
      },
    });
    if (!assignment) {
      throw forbidden("No active Commando assignment for this profile");
    }
    assignmentId = assignment.id;
    commandoUserId = assignment.commandoUserId;
    teamLeadUserId = assignment.teamLeadUserId;
  }

  const attendeeIds = new Set<string>([
    teamLeadUserId,
    profile.userId,
    ...(commandoUserId ? [commandoUserId] : []),
    ...(input.attendeeUserIds ?? []),
  ]);

  const created = await prisma.weeklyReview.create({
    data: {
      salesExecutiveProfileId: profile.id,
      assignmentId,
      commandoUserId,
      teamLeadUserId,
      weekLabel: input.weekLabel,
      weekStartDate: input.weekStartDate,
      meetingDate: input.meetingDate,
      performanceSummary: input.performanceSummary,
      whatWentWell: input.whatWentWell,
      improvement: input.improvement,
      nextWeekAction: input.nextWeekAction,
      status: "SUBMITTED",
      submittedAt: new Date(),
      createdById: actor.id,
      attendees: {
        create: [...attendeeIds].map((userId) => ({ userId })),
      },
    },
    include: reviewInclude,
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "WEEKLY_REVIEW_CREATED",
      entityType: "WeeklyReview",
      entityId: created.id,
      metadata: { profileId: profile.id, status: "SUBMITTED" },
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "WEEKLY_REVIEW_SUBMITTED",
      entityType: "WeeklyReview",
      entityId: created.id,
      metadata: { from: "CREATE", to: "SUBMITTED" },
    },
  });

  const users = await loadUsers(
    [created.commandoUserId, created.teamLeadUserId].filter(Boolean) as string[],
  );
  return serialize(created, users, actor.id);
}

export async function updateWeeklyReview(
  actor: Actor,
  id: string,
  input: UpdateWeeklyReviewInput,
) {
  const existing = await prisma.weeklyReview.findFirst({
    where: { id, archivedAt: null },
    include: reviewInclude,
  });
  if (!existing) throw notFound("Weekly review not found");
  await assertCanAccess(actor, existing);

  if (existing.status !== "DRAFT") {
    throw badRequest("Submitted weekly reviews are read-only");
  }

  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for weekly reviews");
  }

  const canEditAsCommando =
    actor.roleCode === "COMMANDO_EXECUTIVE" &&
    existing.commandoUserId === actor.id;
  const canEditAsTl =
    actor.roleCode === "TEAM_LEAD" && existing.createdById === actor.id;
  if (!canEditAsCommando && !canEditAsTl) {
    throw forbidden("Only the review owner can edit this draft");
  }
  if (canEditAsTl) {
    await assertTeamLeadOperationalWriteAllowed(
      prisma,
      actor,
      existing.salesExecutiveProfileId,
      { action: "WEEKLY_REVIEW_UPDATE" },
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (input.attendeeUserIds) {
      const nextIds = new Set(input.attendeeUserIds);
      if (existing.commandoUserId) nextIds.add(existing.commandoUserId);
      nextIds.add(existing.teamLeadUserId);
      nextIds.add(existing.profile.userId);

      await tx.weeklyReviewAttendee.deleteMany({
        where: {
          weeklyReviewId: id,
          signedAt: null,
          userId: { notIn: [...nextIds] },
        },
      });

      for (const userId of nextIds) {
        await tx.weeklyReviewAttendee.upsert({
          where: {
            weeklyReviewId_userId: { weeklyReviewId: id, userId },
          },
          update: {},
          create: { weeklyReviewId: id, userId },
        });
      }
    }

    return tx.weeklyReview.update({
      where: { id },
      data: {
        weekLabel: input.weekLabel,
        weekStartDate: input.weekStartDate,
        meetingDate: input.meetingDate,
        performanceSummary: input.performanceSummary,
        whatWentWell: input.whatWentWell,
        improvement: input.improvement,
        nextWeekAction: input.nextWeekAction,
      },
      include: reviewInclude,
    });
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "WEEKLY_REVIEW_UPDATED",
      entityType: "WeeklyReview",
      entityId: updated.id,
      metadata: { status: updated.status },
    },
  });

  const users = await loadUsers(
    [updated.commandoUserId, updated.teamLeadUserId].filter(Boolean) as string[],
  );
  return serialize(updated, users, actor.id);
}

export async function submitWeeklyReview(actor: Actor, id: string) {
  const existing = await prisma.weeklyReview.findFirst({
    where: { id, archivedAt: null },
    include: reviewInclude,
  });
  if (!existing) throw notFound("Weekly review not found");
  await assertCanAccess(actor, existing);

  if (existing.status !== "DRAFT") {
    throw badRequest("Only draft reviews can be submitted");
  }

  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for weekly reviews");
  }

  const canSubmitAsCommando =
    actor.roleCode === "COMMANDO_EXECUTIVE" &&
    existing.commandoUserId === actor.id;
  const canSubmitAsTl =
    actor.roleCode === "TEAM_LEAD" && existing.createdById === actor.id;
  if (!canSubmitAsCommando && !canSubmitAsTl) {
    throw forbidden("Only the review owner can submit this review");
  }
  if (canSubmitAsTl) {
    await assertTeamLeadOperationalWriteAllowed(
      prisma,
      actor,
      existing.salesExecutiveProfileId,
      { action: "WEEKLY_REVIEW_SUBMIT" },
    );
  }

  const updated = await prisma.weeklyReview.update({
    where: { id },
    data: {
      status: "SUBMITTED",
      submittedAt: new Date(),
    },
    include: reviewInclude,
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "WEEKLY_REVIEW_SUBMITTED",
      entityType: "WeeklyReview",
      entityId: updated.id,
      metadata: { from: "DRAFT", to: "SUBMITTED" },
    },
  });

  const users = await loadUsers(
    [updated.commandoUserId, updated.teamLeadUserId].filter(Boolean) as string[],
  );
  return serialize(updated, users, actor.id);
}

export async function acknowledgeWeeklyReview(actor: Actor, id: string) {
  const existing = await prisma.weeklyReview.findFirst({
    where: { id, archivedAt: null },
    include: reviewInclude,
  });
  if (!existing) throw notFound("Weekly review not found");
  await assertCanAccess(actor, existing);

  if (existing.status !== "SUBMITTED") {
    throw badRequest("Only submitted reviews can be acknowledged");
  }

  // Prefer attendee row; if missing for the SE owner, create it so they can sign.
  let attendee = existing.attendees.find((a) => a.userId === actor.id);
  if (!attendee && existing.profile.userId === actor.id) {
    attendee = await prisma.weeklyReviewAttendee.upsert({
      where: {
        weeklyReviewId_userId: {
          weeklyReviewId: id,
          userId: actor.id,
        },
      },
      update: {},
      create: { weeklyReviewId: id, userId: actor.id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: { select: { code: true } },
          },
        },
      },
    });
  }
  if (!attendee) {
    throw forbidden("You are not an attendee on this weekly review");
  }
  if (attendee.signedAt) {
    throw badRequest("You have already acknowledged this review");
  }

  await prisma.weeklyReviewAttendee.update({
    where: { id: attendee.id },
    data: { signedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "WEEKLY_REVIEW_ACKNOWLEDGED",
      entityType: "WeeklyReview",
      entityId: existing.id,
      metadata: { attendeeId: attendee.id },
    },
  });

  const refreshed = await prisma.weeklyReview.findFirstOrThrow({
    where: { id },
    include: reviewInclude,
  });
  const users = await loadUsers(
    [refreshed.commandoUserId, refreshed.teamLeadUserId].filter(
      Boolean,
    ) as string[],
  );
  return serialize(refreshed, users, actor.id);
}
