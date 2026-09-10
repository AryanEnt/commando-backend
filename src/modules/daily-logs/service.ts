import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { getActiveTeamIds } from "../../lib/scope.js";
import { assertTeamLeadOperationalWriteAllowed } from "../../lib/teamLeadLock.js";
import type { CreateDailyLogInput, ListDailyLogsQuery } from "./schemas.js";

const logInclude = {
  profile: {
    select: { id: true, displayName: true, userId: true, teamId: true },
  },
  activityType: {
    select: { id: true, code: true, name: true },
  },
  createdBy: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  assignment: {
    select: { id: true, status: true, startedAt: true, endedAt: true },
  },
} satisfies Prisma.DailyLogInclude;

type LogRow = Prisma.DailyLogGetPayload<{ include: typeof logInclude }>;

function serialize(row: LogRow) {
  return {
    id: row.id,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    profile: row.profile,
    activityTypeId: row.activityTypeId,
    activityType: row.activityType,
    sessionTitle: row.sessionTitle,
    observation: row.observation,
    evidence: row.evidence,
    seResponse: row.seResponse,
    coachingGiven: row.coachingGiven,
    expectedChange: row.expectedChange,
    followUp: row.followUp,
    assignmentId: row.assignmentId,
    assignment: row.assignment,
    createdById: row.createdById,
    createdBy: row.createdBy,
    loggedAt: row.loggedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function assignedProfileIds(commandoUserId: string): Promise<string[]> {
  const assignments = await prisma.commandoAssignment.findMany({
    where: { commandoUserId },
    select: { salesExecutiveProfileId: true },
  });
  return [...new Set(assignments.map((a) => a.salesExecutiveProfileId))];
}

async function scopeWhere(actor: Actor): Promise<Prisma.DailyLogWhereInput> {
  if (isSuperAdmin(actor)) {
    return { archivedAt: null };
  }
  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    const profileIds = await assignedProfileIds(actor.id);
    return {
      archivedAt: null,
      OR: [
        { createdById: actor.id },
        { salesExecutiveProfileId: { in: profileIds } },
      ],
    };
  }
  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    return {
      archivedAt: null,
      profile: { teamId: { in: teamIds } },
    };
  }
  if (actor.roleCode === "SALES_EXECUTIVE") {
    return { archivedAt: null, profile: { userId: actor.id } };
  }
  return { id: "__none__" };
}

async function assertCanAccessLog(actor: Actor, row: LogRow): Promise<void> {
  if (isSuperAdmin(actor)) return;

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    if (row.createdById === actor.id) return;
    const assigned = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: row.salesExecutiveProfileId,
        commandoUserId: actor.id,
      },
      select: { id: true },
    });
    if (!assigned) {
      throw forbidden("Log is outside your assignment scope");
    }
    return;
  }

  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(row.profile.teamId)) {
      throw forbidden("Log is outside your team scope");
    }
    return;
  }

  if (actor.roleCode === "SALES_EXECUTIVE") {
    if (row.profile.userId !== actor.id) {
      throw forbidden("You may only view your own daily logs");
    }
    return;
  }

  throw forbidden("Not allowed to access daily logs");
}

export async function listDailyLogs(actor: Actor, query: ListDailyLogsQuery) {
  const scope = await scopeWhere(actor);
  const where: Prisma.DailyLogWhereInput = {
    AND: [
      scope,
      ...(query.profileId
        ? [{ salesExecutiveProfileId: query.profileId }]
        : []),
      ...(query.activityTypeId
        ? [{ activityTypeId: query.activityTypeId }]
        : []),
      ...(query.search
        ? [
            {
              OR: [
                {
                  sessionTitle: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  observation: {
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
                  activityType: {
                    name: {
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
    prisma.dailyLog.count({ where }),
    prisma.dailyLog.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { loggedAt: "desc" },
      include: logInclude,
    }),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    logs: rows.map(serialize),
  };
}

export async function getDailyLog(actor: Actor, id: string) {
  const row = await prisma.dailyLog.findFirst({
    where: { id, archivedAt: null },
    include: logInclude,
  });
  if (!row) throw notFound("Daily log not found");
  await assertCanAccessLog(actor, row);
  return serialize(row);
}

export async function createDailyLog(actor: Actor, input: CreateDailyLogInput) {
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for daily coaching logs");
  }
  if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    actor.roleCode !== "TEAM_LEAD"
  ) {
    throw forbidden("Not allowed to create daily coaching logs");
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
      action: "DAILY_LOG_CREATE",
    });
  } else {
    const assignment = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: profile.id,
        commandoUserId: actor.id,
        status: "ACTIVE",
      },
    });
    if (!assignment) {
      throw forbidden(
        "You may only create logs for profiles with an active assignment to you",
      );
    }
    assignmentId = assignment.id;
  }

  const activityType = await prisma.activityType.findFirst({
    where: {
      id: input.activityTypeId,
      isActive: true,
      archivedAt: null,
    },
  });
  if (!activityType) {
    throw badRequest("Activity type is invalid or inactive");
  }

  const created = await prisma.dailyLog.create({
    data: {
      salesExecutiveProfileId: profile.id,
      activityTypeId: activityType.id,
      sessionTitle: input.sessionTitle,
      observation: input.observation,
      evidence: input.evidence ?? null,
      seResponse: input.seResponse ?? null,
      coachingGiven: input.coachingGiven ?? null,
      expectedChange: input.expectedChange ?? null,
      followUp: input.followUp ?? null,
      createdById: actor.id,
      assignmentId,
      loggedAt: input.loggedAt ?? new Date(),
    },
    include: logInclude,
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "DAILY_LOG_CREATED",
      entityType: "DailyLog",
      entityId: created.id,
      metadata: {
        profileId: profile.id,
        activityTypeId: activityType.id,
        assignmentId,
      },
    },
  });

  return serialize(created);
}
