import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { getActiveTeamIds } from "../../lib/scope.js";
import { assertTeamLeadOperationalWriteAllowed } from "../../lib/teamLeadLock.js";
import { recordWorkspaceEvent } from "../../lib/workspaceEvents.js";
import {
  assertCanManageSupportUser,
  assertCanViewSupportUser,
  supportUserIdsOnTeams,
  teamIdsForCommandoActive,
} from "../../lib/supportScope.js";
import { createPresignedGetUrl } from "../../lib/r2.js";
import { isOwnedWeeklyReviewMinutesKey } from "../uploads/schemas.js";
import type {
  CreateWeeklyReviewInput,
  ListWeeklyReviewsQuery,
  UpdateWeeklyReviewInput,
  WeeklyReviewHubQuery,
} from "./schemas.js";
import {
  nextMonday,
  resolveWeekBounds,
  toYmd,
} from "./week.js";

const reviewInclude = {
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

function subjectUserId(row: ReviewRow): string | null {
  return row.executiveUserId ?? row.profile?.userId ?? null;
}

function subjectName(row: ReviewRow): string {
  if (row.profile?.displayName) return row.profile.displayName;
  if (row.executiveUser) {
    return `${row.executiveUser.firstName} ${row.executiveUser.lastName}`.trim();
  }
  return "Unknown";
}

function serialize(row: ReviewRow, users: Map<string, UserBrief>, viewerId?: string) {
  const myAttendee = viewerId
    ? row.attendees.find((a) => a.userId === viewerId)
    : undefined;
  const ownerId = subjectUserId(row);
  const salesExecutiveAttendee = ownerId
    ? row.attendees.find((a) => a.userId === ownerId)
    : undefined;

  return {
    id: row.id,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    executiveUserId: row.executiveUserId,
    profile: row.profile,
    executiveUser: row.executiveUser,
    subject: {
      type: row.executiveUserId
        ? ("SALES_SUPPORT_EXECUTIVE" as const)
        : ("SALES_EXECUTIVE" as const),
      id: ownerId ?? "",
      name: subjectName(row),
    },
    assignmentId: row.assignmentId,
    assignment: row.assignment,
    commandoUserId: row.commandoUserId,
    commando: row.commandoUserId ? users.get(row.commandoUserId) ?? null : null,
    teamLeadUserId: row.teamLeadUserId,
    teamLead: users.get(row.teamLeadUserId) ?? null,
    weekLabel: row.weekLabel,
    weekStartDate: row.weekStartDate,
    meetingDate: row.meetingDate,
    roomName: row.roomName,
    meetingTime: row.meetingTime,
    meetingMinutes: row.meetingMinutesKey
      ? {
          fileName: row.meetingMinutesFileName ?? "meeting-minutes",
          contentType:
            row.meetingMinutesContentType ?? "application/octet-stream",
          size: row.meetingMinutesSize,
          uploadedAt: row.meetingMinutesUploadedAt,
        }
      : null,
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

function normalizeMeetingMinutes(
  actorId: string,
  minutes:
    | {
        key: string;
        fileName: string;
        contentType: string;
        size?: number;
      }
    | null
    | undefined,
): {
  key: string;
  fileName: string;
  contentType: string;
  size?: number;
} | null {
  if (minutes == null) return null;
  if (!isOwnedWeeklyReviewMinutesKey(minutes.key, actorId)) {
    throw badRequest("Invalid meeting minutes upload key");
  }
  return minutes;
}

async function assignedProfileIds(commandoUserId: string): Promise<string[]> {
  const assignments = await prisma.commandoAssignment.findMany({
    where: { commandoUserId },
    select: { salesExecutiveProfileId: true },
  });
  return [...new Set(assignments.map((a) => a.salesExecutiveProfileId))];
}

async function resolveTeamLeadForSupportUser(
  supportUserId: string,
  commandoUserId?: string,
): Promise<string> {
  if (commandoUserId) {
    const links = await prisma.salesSupportLink.findMany({
      where: { salesSupportUserId: supportUserId, isActive: true },
      select: { salesExecutiveProfileId: true },
    });
    const profileIds = links.map((l) => l.salesExecutiveProfileId);
    if (profileIds.length > 0) {
      const assignment = await prisma.commandoAssignment.findFirst({
        where: {
          commandoUserId,
          status: "ACTIVE",
          salesExecutiveProfileId: { in: profileIds },
        },
        select: { teamLeadUserId: true },
      });
      if (assignment) return assignment.teamLeadUserId;
    }
  }

  const teamIds = (
    await prisma.teamMembership.findMany({
      where: {
        userId: supportUserId,
        isActive: true,
        endedAt: null,
      },
      select: { teamId: true },
    })
  ).map((m) => m.teamId);
  if (teamIds.length > 0) {
    const lead = await prisma.teamMembership.findFirst({
      where: {
        teamId: { in: teamIds },
        isActive: true,
        endedAt: null,
        user: { role: { code: "TEAM_LEAD" }, deletedAt: null },
      },
      select: { userId: true },
    });
    if (lead) return lead.userId;
  }

  throw badRequest(
    "Could not resolve a Team Lead for this Sales Support review",
  );
}

async function scopeWhere(actor: Actor): Promise<Prisma.WeeklyReviewWhereInput> {
  if (isSuperAdmin(actor)) {
    return { archivedAt: null };
  }

  switch (actor.roleCode) {
    case "COMMANDO_EXECUTIVE": {
      const [profileIds, teamIds] = await Promise.all([
        assignedProfileIds(actor.id),
        teamIdsForCommandoActive(prisma, actor.id),
      ]);
      const supportIds = await supportUserIdsOnTeams(prisma, teamIds);
      return {
        archivedAt: null,
        OR: [
          { commandoUserId: actor.id },
          { createdById: actor.id },
          { salesExecutiveProfileId: { in: profileIds } },
          ...(supportIds.length > 0
            ? [{ executiveUserId: { in: supportIds } }]
            : []),
        ],
      };
    }
    case "TEAM_LEAD": {
      const teamIds = await getActiveTeamIds(prisma, actor.id);
      const supportIds = await supportUserIdsOnTeams(prisma, teamIds);
      return {
        archivedAt: null,
        OR: [
          { createdById: actor.id },
          {
            status: "SUBMITTED",
            OR: [
              { teamLeadUserId: actor.id },
              { profile: { teamId: { in: teamIds } } },
              ...(supportIds.length > 0
                ? [{ executiveUserId: { in: supportIds } }]
                : []),
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
        status: "SUBMITTED",
      };
    }
    case "SALES_SUPPORT_EXECUTIVE":
      return {
        archivedAt: null,
        executiveUserId: actor.id,
        status: "SUBMITTED",
      };
    default:
      return { id: "__none__" };
  }
}

async function assertCanAccess(actor: Actor, row: ReviewRow): Promise<void> {
  if (isSuperAdmin(actor)) return;

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    if (row.commandoUserId === actor.id || row.createdById === actor.id) {
      return;
    }
    if (row.executiveUserId) {
      await assertCanViewSupportUser(prisma, actor, row.executiveUserId);
      return;
    }
    if (row.salesExecutiveProfileId) {
      const assigned = await prisma.commandoAssignment.findFirst({
        where: {
          salesExecutiveProfileId: row.salesExecutiveProfileId,
          commandoUserId: actor.id,
        },
        select: { id: true },
      });
      if (assigned) return;
    }
    throw forbidden("Review is outside your assignment scope");
  }

  if (actor.roleCode === "TEAM_LEAD") {
    if (row.createdById === actor.id) return;
    if (row.status !== "SUBMITTED") {
      throw forbidden("Draft reviews are not visible to Team Leads");
    }
    if (row.teamLeadUserId === actor.id) return;
    if (row.executiveUserId) {
      await assertCanViewSupportUser(prisma, actor, row.executiveUserId);
      return;
    }
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (row.profile && teamIds.includes(row.profile.teamId)) return;
    throw forbidden("Review is outside your team scope");
  }

  if (actor.roleCode === "SALES_EXECUTIVE") {
    if (!row.profile || row.profile.userId !== actor.id) {
      throw forbidden("You may only view your own weekly reviews");
    }
    if (row.status !== "SUBMITTED") {
      throw forbidden("This weekly review is not available yet");
    }
    return;
  }

  if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    if (row.executiveUserId !== actor.id) {
      throw forbidden("You may only view your own weekly reviews");
    }
    if (row.status !== "SUBMITTED") {
      throw forbidden("This weekly review is not available yet");
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
      ...(query.executiveUserId
        ? [{ executiveUserId: query.executiveUserId }]
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

function parseNextWeekActions(input: CreateWeeklyReviewInput): string[] {
  const nextWeekActions = [
    ...(input.nextWeekActions ?? []).map((s) => s.trim()).filter(Boolean),
  ];
  if (nextWeekActions.length === 0 && input.nextWeekAction?.trim()) {
    nextWeekActions.push(
      ...input.nextWeekAction
        .split(/\n+/)
        .map((s) => s.replace(/^[-•*\d.)\s]+/, "").trim())
        .filter(Boolean),
    );
  }
  return nextWeekActions;
}

async function createSupportWeeklyReview(
  actor: Actor,
  input: CreateWeeklyReviewInput,
) {
  const executiveUserId = input.executiveUserId!;
  const supportUser = await assertCanManageSupportUser(
    prisma,
    actor,
    executiveUserId,
  );

  let teamLeadUserId: string;
  let commandoUserId: string | null = null;
  if (actor.roleCode === "TEAM_LEAD") {
    teamLeadUserId = actor.id;
  } else {
    commandoUserId = actor.id;
    teamLeadUserId = await resolveTeamLeadForSupportUser(
      executiveUserId,
      actor.id,
    );
  }

  const nextWeekActions = parseNextWeekActions(input);
  if (nextWeekActions.length === 0) {
    throw badRequest("Add at least one next-week action");
  }

  const weekBounds = resolveWeekBounds(toYmd(input.weekStartDate));
  const existingForWeek = await prisma.weeklyReview.findFirst({
    where: {
      executiveUserId,
      archivedAt: null,
      weekStartDate: {
        gte: weekBounds.start,
        lt: nextMonday(weekBounds.start),
      },
    },
    select: { id: true, weekLabel: true },
  });
  if (existingForWeek) {
    throw badRequest(
      `A weekly review already exists for this week (${existingForWeek.weekLabel}). Open the existing review instead of creating another.`,
    );
  }

  const minutes = normalizeMeetingMinutes(actor.id, input.meetingMinutes);
  const attendeeIds = new Set<string>([
    teamLeadUserId,
    supportUser.id,
    ...(commandoUserId ? [commandoUserId] : []),
    ...(input.attendeeUserIds ?? []),
  ]);

  const created = await prisma.weeklyReview.create({
    data: {
      salesExecutiveProfileId: null,
      executiveUserId,
      assignmentId: null,
      commandoUserId,
      teamLeadUserId,
      weekLabel: input.weekLabel,
      weekStartDate: weekBounds.start,
      meetingDate: input.meetingDate,
      roomName: input.roomName,
      meetingTime: input.meetingTime,
      meetingMinutesKey: minutes?.key ?? null,
      meetingMinutesFileName: minutes?.fileName ?? null,
      meetingMinutesContentType: minutes?.contentType ?? null,
      meetingMinutesSize: minutes?.size ?? null,
      meetingMinutesUploadedAt: minutes ? new Date() : null,
      performanceSummary: input.performanceSummary,
      whatWentWell: input.whatWentWell,
      improvement: input.improvement,
      nextWeekAction: nextWeekActions.join("\n"),
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
      metadata: {
        executiveUserId,
        status: "SUBMITTED",
        verb: "CREATE",
      },
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

  if (input.executiveUserId) {
    return createSupportWeeklyReview(actor, input);
  }

  if (!input.salesExecutiveProfileId) {
    throw badRequest(
      "Provide salesExecutiveProfileId for a Sales Executive, or executiveUserId for Sales Support",
    );
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

  const nextWeekActions = [
    ...(input.nextWeekActions ?? []).map((s) => s.trim()).filter(Boolean),
  ];
  if (nextWeekActions.length === 0 && input.nextWeekAction?.trim()) {
    nextWeekActions.push(
      ...input.nextWeekAction
        .split(/\n+/)
        .map((s) => s.replace(/^[-•*\d.)\s]+/, "").trim())
        .filter(Boolean),
    );
  }
  if (nextWeekActions.length === 0) {
    throw badRequest("Add at least one next-week action");
  }
  const nextWeekActionText = nextWeekActions.join("\n");

  // Soft uniqueness: one review per SE per calendar week (by weekStartDate Monday).
  const weekBounds = resolveWeekBounds(toYmd(input.weekStartDate));
  const existingForWeek = await prisma.weeklyReview.findFirst({
    where: {
      salesExecutiveProfileId: profile.id,
      archivedAt: null,
      weekStartDate: {
        gte: weekBounds.start,
        lt: nextMonday(weekBounds.start),
      },
    },
    select: { id: true, weekLabel: true },
  });
  if (existingForWeek) {
    throw badRequest(
      `A weekly review already exists for this week (${existingForWeek.weekLabel}). Open the existing review instead of creating another.`,
    );
  }

  // Apply follow-up status updates before creating the review
  if (input.followUpActions?.length) {
    for (const item of input.followUpActions) {
      const existing = await prisma.actionItem.findFirst({
        where: {
          id: item.actionItemId,
          salesExecutiveProfileId: profile.id,
          archivedAt: null,
        },
      });
      if (!existing) continue;
      if (item.status === "COMPLETED" && existing.status === "ACTIVE") {
        await prisma.actionItem.update({
          where: { id: existing.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            completedById: actor.id,
          },
        });
        await recordWorkspaceEvent({
          salesExecutiveProfileId: profile.id,
          assignmentId: existing.assignmentId,
          type: "ACTION",
          title: `Completed: ${existing.title}`,
          notes: existing.description,
          status: "COMPLETED",
          sourceType: "ActionItem",
          sourceId: existing.id,
          createdById: actor.id,
        });
      } else if (item.status === "CANCELLED" && existing.status === "ACTIVE") {
        await prisma.actionItem.update({
          where: { id: existing.id },
          data: { status: "CANCELLED" },
        });
      }
      // ACTIVE = leave pending / still open — no write
    }
  }

  const minutes = normalizeMeetingMinutes(actor.id, input.meetingMinutes);

  const created = await prisma.weeklyReview.create({
    data: {
      salesExecutiveProfileId: profile.id,
      assignmentId,
      commandoUserId,
      teamLeadUserId,
      weekLabel: input.weekLabel,
      weekStartDate: weekBounds.start,
      meetingDate: input.meetingDate,
      roomName: input.roomName,
      meetingTime: input.meetingTime,
      meetingMinutesKey: minutes?.key ?? null,
      meetingMinutesFileName: minutes?.fileName ?? null,
      meetingMinutesContentType: minutes?.contentType ?? null,
      meetingMinutesSize: minutes?.size ?? null,
      meetingMinutesUploadedAt: minutes ? new Date() : null,
      performanceSummary: input.performanceSummary,
      whatWentWell: input.whatWentWell,
      improvement: input.improvement,
      nextWeekAction: nextWeekActionText,
      status: "SUBMITTED",
      submittedAt: new Date(),
      createdById: actor.id,
      attendees: {
        create: [...attendeeIds].map((userId) => ({ userId })),
      },
    },
    include: reviewInclude,
  });

  // Persist next-week commitments as tracked Action Items
  const weekDue = new Date(weekBounds.start);
  weekDue.setUTCDate(weekDue.getUTCDate() + 7);
  for (const title of nextWeekActions) {
    const action = await prisma.actionItem.create({
      data: {
        salesExecutiveProfileId: profile.id,
        assignmentId,
        weeklyReviewId: created.id,
        title,
        description: `From weekly review · ${created.weekLabel}`,
        dueDate: weekDue,
        status: "ACTIVE",
        createdById: actor.id,
      },
      select: { id: true, title: true },
    });
    await recordWorkspaceEvent({
      salesExecutiveProfileId: profile.id,
      assignmentId,
      type: "ACTION",
      title: action.title,
      notes: `Created from weekly review · ${created.weekLabel}`,
      status: "OPEN",
      urgency: "NOT_URGENT",
      importance: "IMPORTANT",
      sourceType: "ActionItem",
      sourceId: action.id,
      createdById: actor.id,
    });
  }

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "WEEKLY_REVIEW_CREATED",
      entityType: "WeeklyReview",
      entityId: created.id,
      metadata: {
        profileId: profile.id,
        status: "SUBMITTED",
        actionCount: nextWeekActions.length,
      },
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

  await recordWorkspaceEvent({
    salesExecutiveProfileId: profile.id,
    assignmentId,
    type: "REVIEW",
    title: `Weekly review · ${created.weekLabel}`,
    notes: created.performanceSummary,
    nextAction: created.nextWeekAction,
    status: "COMPLETED",
    occurredAt: created.meetingDate,
    sourceType: "WeeklyReview",
    sourceId: created.id,
    createdById: actor.id,
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
  if (canEditAsTl && existing.salesExecutiveProfileId) {
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
      const ownerId = existing.executiveUserId ?? existing.profile?.userId;
      if (ownerId) nextIds.add(ownerId);

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

    const minutes =
      input.meetingMinutes === undefined
        ? undefined
        : normalizeMeetingMinutes(actor.id, input.meetingMinutes);

    return tx.weeklyReview.update({
      where: { id },
      data: {
        weekLabel: input.weekLabel,
        weekStartDate: input.weekStartDate,
        meetingDate: input.meetingDate,
        roomName: input.roomName,
        meetingTime: input.meetingTime,
        ...(minutes === undefined
          ? {}
          : minutes === null
            ? {
                meetingMinutesKey: null,
                meetingMinutesFileName: null,
                meetingMinutesContentType: null,
                meetingMinutesSize: null,
                meetingMinutesUploadedAt: null,
              }
            : {
                meetingMinutesKey: minutes.key,
                meetingMinutesFileName: minutes.fileName,
                meetingMinutesContentType: minutes.contentType,
                meetingMinutesSize: minutes.size ?? null,
                meetingMinutesUploadedAt: new Date(),
              }),
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
  if (canSubmitAsTl && existing.salesExecutiveProfileId) {
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
  if (
    !attendee &&
    (existing.profile?.userId === actor.id ||
      existing.executiveUserId === actor.id)
  ) {
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

export async function getMeetingMinutesDownloadUrl(actor: Actor, id: string) {
  const existing = await prisma.weeklyReview.findFirst({
    where: { id, archivedAt: null },
    include: reviewInclude,
  });
  if (!existing) throw notFound("Weekly review not found");
  await assertCanAccess(actor, existing);

  if (!existing.meetingMinutesKey) {
    throw notFound("No meeting minutes uploaded for this review");
  }

  const expiresInSeconds = 600;
  const url = await createPresignedGetUrl({
    key: existing.meetingMinutesKey,
    fileName: existing.meetingMinutesFileName ?? undefined,
    expiresInSeconds,
  });

  return {
    url,
    fileName: existing.meetingMinutesFileName ?? "meeting-minutes",
    contentType:
      existing.meetingMinutesContentType ?? "application/octet-stream",
    expiresInSeconds,
  };
}

async function assertCanViewProfileHub(actor: Actor, profileId: string) {
  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: profileId, archivedAt: null },
    select: {
      id: true,
      displayName: true,
      userId: true,
      teamId: true,
      team: { select: { id: true, name: true } },
    },
  });
  if (!profile) throw notFound("Sales executive profile not found");

  if (isSuperAdmin(actor)) return profile;

  if (actor.roleCode === "SALES_EXECUTIVE") {
    if (profile.userId !== actor.id) {
      throw forbidden("You may only view your own weekly coaching hub");
    }
    return profile;
  }

  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(profile.teamId)) {
      throw forbidden("Profile is outside your team scope");
    }
    return profile;
  }

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    const assignment = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: profile.id,
        OR: [
          { status: "ACTIVE", commandoUserId: actor.id },
          { status: "COMPLETED", commandoUserId: actor.id },
        ],
      },
      select: { id: true },
    });
    if (!assignment) {
      throw forbidden("No Commando assignment for this profile");
    }
    return profile;
  }

  throw forbidden("Not allowed to view weekly coaching hub");
}

/**
 * Weekly Coaching Hub — aggregates one SE's week without duplicating records.
 */
export async function getWeeklyReviewHub(
  actor: Actor,
  query: WeeklyReviewHubQuery,
) {
  const profile = await assertCanViewProfileHub(actor, query.profileId);
  const week = resolveWeekBounds(query.weekStart);
  const weekEndExclusive = nextMonday(week.start);

  const [
    dailyLogs,
    monitoringRows,
    actionRows,
    eisenhowerRows,
    reviewRows,
    feedbackRows,
    swotRows,
    activeAssignment,
  ] = await Promise.all([
    prisma.dailyLog.findMany({
      where: {
        salesExecutiveProfileId: profile.id,
        archivedAt: null,
        logDate: { gte: week.start, lte: week.end },
      },
      orderBy: [{ logDate: "asc" }, { createdAt: "asc" }],
      include: {
        entries: {
          orderBy: [{ loggedAt: "asc" }, { createdAt: "asc" }],
          include: {
            activityType: {
              select: { id: true, name: true, code: true },
            },
          },
        },
      },
    }),
    prisma.liveMonitoringRecord.findMany({
      where: {
        salesExecutiveProfileId: profile.id,
        archivedAt: null,
        observedAt: { gte: week.start, lt: weekEndExclusive },
      },
      orderBy: { observedAt: "asc" },
      include: {
        category: { select: { id: true, name: true, code: true } },
        responses: { orderBy: { sortOrderSnapshot: "asc" } },
        supportInvolvements: true,
      },
    }),
    prisma.actionItem.findMany({
      where: {
        salesExecutiveProfileId: profile.id,
        archivedAt: null,
        OR: [
          { dueDate: { gte: week.start, lt: weekEndExclusive } },
          { createdAt: { gte: week.start, lt: weekEndExclusive } },
          { completedAt: { gte: week.start, lt: weekEndExclusive } },
          {
            weeklyReview: {
              weekStartDate: { gte: week.start, lt: weekEndExclusive },
            },
          },
        ],
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      include: {
        weeklyReview: {
          select: {
            id: true,
            weekLabel: true,
            weekStartDate: true,
            meetingDate: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.eisenhowerTask.findMany({
      where: {
        salesExecutiveProfileId: profile.id,
        archivedAt: null,
        OR: [
          { dueDate: { gte: week.start, lt: weekEndExclusive } },
          { createdAt: { gte: week.start, lt: weekEndExclusive } },
          {
            month: {
              gte: new Date(
                Date.UTC(week.start.getUTCFullYear(), week.start.getUTCMonth(), 1),
              ),
              lt: new Date(
                Date.UTC(
                  week.start.getUTCFullYear(),
                  week.start.getUTCMonth() + 1,
                  1,
                ),
              ),
            },
            status: { in: ["OPEN", "IN_PROGRESS"] },
          },
        ],
      },
      orderBy: [{ category: "asc" }, { createdAt: "desc" }],
      take: 80,
    }),
    prisma.weeklyReview.findMany({
      where: {
        salesExecutiveProfileId: profile.id,
        archivedAt: null,
        weekStartDate: { gte: week.start, lt: weekEndExclusive },
        // SE hub only shows submitted reviews (create already submits).
        ...(actor.roleCode === "SALES_EXECUTIVE"
          ? { status: "SUBMITTED" }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 1,
      include: reviewInclude,
    }),
    prisma.feedback.findMany({
      where: {
        salesExecutiveProfileId: profile.id,
        archivedAt: null,
        createdAt: { gte: week.start, lt: weekEndExclusive },
      },
      orderBy: { createdAt: "asc" },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: { select: { code: true } },
          },
        },
      },
      take: 50,
    }),
    prisma.swotAnalysis.findMany({
      where: {
        archivedAt: null,
        OR: [
          {
            subjectType: "PROFILE",
            salesExecutiveProfileId: profile.id,
          },
          {
            subjectType: "EXECUTIVE",
            executiveUserId: profile.userId,
          },
        ],
      },
      orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }],
      take: 6,
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: { select: { code: true } },
          },
        },
      },
    }),
    prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: profile.id,
        status: "ACTIVE",
      },
      select: {
        id: true,
        status: true,
        teamLead: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        commando: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    }),
  ]);

  const review =
    reviewRows[0] != null
      ? (
          await serializeMany([reviewRows[0]], actor.id)
        )[0]!
      : null;

  const now = new Date();
  const actions = {
    completed: actionRows.filter((a) => a.status === "COMPLETED"),
    active: actionRows.filter(
      (a) =>
        a.status === "ACTIVE" &&
        (!a.dueDate || a.dueDate >= now),
    ),
    overdue: actionRows.filter(
      (a) => a.status === "ACTIVE" && a.dueDate != null && a.dueDate < now,
    ),
    other: actionRows.filter(
      (a) =>
        a.status !== "COMPLETED" &&
        a.status !== "ACTIVE",
    ),
  };

  const checklistMissCounts = new Map<string, number>();
  for (const row of monitoringRows) {
    for (const r of row.responses) {
      if (r.value === "NO") {
        const label = r.labelSnapshot?.trim() || "Checklist item";
        checklistMissCounts.set(
          label,
          (checklistMissCounts.get(label) ?? 0) + 1,
        );
      }
    }
  }
  const checklistFocus = [...checklistMissCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const support = monitoringRows.flatMap((m) =>
    m.supportInvolvements.map((s) => ({
      monitoringId: m.id,
      observedAt: m.observedAt,
      categoryName: m.category.name,
      displayName: s.displayNameSnapshot,
      responsibility: s.responsibilityTypeSnapshot,
    })),
  );

  const attention: string[] = [];
  const draftLogs = dailyLogs.filter((l) => l.status === "DRAFT");
  if (draftLogs.length > 0) {
    attention.push(
      `${draftLogs.length} Daily Log${draftLogs.length === 1 ? "" : "s"} still in draft`,
    );
  }
  if (actions.overdue.length > 0) {
    attention.push(
      `${actions.overdue.length} action${actions.overdue.length === 1 ? "" : "s"} overdue`,
    );
  }
  for (const focus of checklistFocus.filter((f) => f.count >= 2).slice(0, 3)) {
    attention.push(
      `"${focus.label}" missed in ${focus.count} monitoring sessions`,
    );
  }
  if (!review) {
    attention.push("Weekly review not written yet for this week");
  }

  const entryCount = dailyLogs.reduce((n, l) => n + l.entries.length, 0);

  const eisenhowerByCategory = {
    DO_FIRST: eisenhowerRows.filter((t) => t.category === "DO_FIRST"),
    SCHEDULE: eisenhowerRows.filter((t) => t.category === "SCHEDULE"),
    DELEGATE: eisenhowerRows.filter((t) => t.category === "DELEGATE"),
    ELIMINATE: eisenhowerRows.filter((t) => t.category === "ELIMINATE"),
  };

  return {
    week: {
      start: week.startYmd,
      end: week.endYmd,
      label: week.label,
    },
    profile: {
      id: profile.id,
      displayName: profile.displayName,
      teamName: profile.team.name,
      teamLead: activeAssignment?.teamLead ?? null,
      commando: activeAssignment?.commando ?? null,
      interventionActive: Boolean(activeAssignment),
    },
    review,
    glance: {
      dailyLogs: dailyLogs.length,
      dailyLogEntries: entryCount,
      monitoring: monitoringRows.length,
      actions: actionRows.length,
      priorities: eisenhowerRows.length,
      feedback: feedbackRows.length,
      swot: swotRows.length,
      support: support.length,
      overdueActions: actions.overdue.length,
      draftLogs: draftLogs.length,
    },
    attention,
    checklistFocus,
    dailyLogs: dailyLogs.map((log) => ({
      id: log.id,
      logDate: log.logDate,
      status: log.status,
      entryCount: log.entries.length,
      submittedAt: log.submittedAt,
      entries: log.entries.map((e) => ({
        id: e.id,
        sessionTitle: e.sessionTitle,
        observation: e.observation,
        evidence: e.evidence,
        seResponse: e.seResponse,
        coachingGiven: e.coachingGiven,
        expectedChange: e.expectedChange,
        followUp: e.followUp,
        loggedAt: e.loggedAt,
        activityType: e.activityType,
        eisenhowerCategory: e.eisenhowerCategory,
        hasEvidence: Boolean(e.evidence?.trim()),
        hasCoaching: Boolean(e.coachingGiven?.trim()),
      })),
    })),
    monitoring: monitoringRows.map((m) => {
      const yes = m.responses.filter((r) => r.value === "YES").length;
      const total = m.responses.length;
      return {
        id: m.id,
        observedAt: m.observedAt,
        category: m.category,
        observation: m.observation,
        checklistCompleted: yes,
        checklistTotal: total,
        responses: m.responses.map((r) => ({
          id: r.id,
          label: r.labelSnapshot,
          description: r.descriptionSnapshot,
          value: r.value,
          sortOrder: r.sortOrderSnapshot,
        })),
        supportInvolvements: m.supportInvolvements.map((s) => ({
          displayName: s.displayNameSnapshot,
          responsibility: s.responsibilityTypeSnapshot,
        })),
      };
    }),
    actions: {
      completed: actions.completed.map(serializeHubAction),
      active: actions.active.map(serializeHubAction),
      overdue: actions.overdue.map(serializeHubAction),
      other: actions.other.map(serializeHubAction),
    },
    feedback: feedbackRows.map((f) => ({
      id: f.id,
      body: f.body,
      source: f.source,
      createdAt: f.createdAt,
      createdBy: f.createdBy,
    })),
    swot: swotRows.map((s) => ({
      id: s.id,
      source: s.source,
      strength: s.strength,
      weakness: s.weakness,
      opportunity: s.opportunity,
      threat: s.threat,
      strengthPoints: s.strengthPoints,
      weaknessPoints: s.weaknessPoints,
      opportunityPoints: s.opportunityPoints,
      threatPoints: s.threatPoints,
      versionNumber: s.versionNumber,
      createdAt: s.createdAt,
      createdBy: s.createdBy,
    })),
    eisenhower: eisenhowerByCategory,
    support,
  };
}

function serializeHubAction(a: {
  id: string;
  title: string;
  description: string | null;
  status: string;
  dueDate: Date | null;
  completedAt: Date | null;
  weeklyReview: {
    id: string;
    weekLabel: string;
    weekStartDate: Date;
    meetingDate: Date;
    createdAt: Date;
  } | null;
}) {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    status: a.status,
    dueDate: a.dueDate,
    completedAt: a.completedAt,
    weeklyReview: a.weeklyReview,
  };
}
