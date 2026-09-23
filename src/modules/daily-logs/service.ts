import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "../../lib/errors.js";
import { getActiveTeamIds } from "../../lib/scope.js";
import {
  assertCanManageSupportUser,
  supportUserIdsOnTeams,
  teamIdsForCommandoActive,
} from "../../lib/supportScope.js";
import { assertTeamLeadOperationalWriteAllowed } from "../../lib/teamLeadLock.js";
import { recordWorkspaceEvent, eisenhowerCategoryFrom } from "../../lib/workspaceEvents.js";
import type {
  CreateDailyLogEntryInput,
  CreateDailyLogInput,
  EnsureDailyLogInput,
  ListDailyLogsQuery,
  SubmitDailyLogInput,
  UpdateDailyLogEntryInput,
} from "./schemas.js";

const entryInclude = {
  activityType: {
    select: { id: true, code: true, name: true },
  },
  createdBy: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
} satisfies Prisma.DailyLogEntryInclude;

const logInclude = {
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
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  assignment: {
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      commando: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  },
  entries: {
    orderBy: [{ loggedAt: "asc" as const }, { createdAt: "asc" as const }],
    include: entryInclude,
  },
} satisfies Prisma.DailyLogInclude;

type LogRow = Prisma.DailyLogGetPayload<{ include: typeof logInclude }>;
type EntryRow = Prisma.DailyLogEntryGetPayload<{ include: typeof entryInclude }>;

/** Calendar day as UTC date-only, using local Y/M/D (matches Eisenhower month pattern). */
export function calendarDateOnly(d = new Date()): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export function parseLogDateInput(value?: string): Date {
  if (!value) return calendarDateOnly();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw badRequest("logDate must be YYYY-MM-DD");
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function serializeEntry(row: EntryRow) {
  return {
    id: row.id,
    dailyLogId: row.dailyLogId,
    activityTypeId: row.activityTypeId,
    activityType: row.activityType,
    sessionTitle: row.sessionTitle,
    observation: row.observation,
    evidence: row.evidence,
    seResponse: row.seResponse,
    coachingGiven: row.coachingGiven,
    expectedChange: row.expectedChange,
    followUp: row.followUp,
    urgency: row.urgency,
    importance: row.importance,
    eisenhowerCategory: row.eisenhowerCategory,
    eisenhowerTaskId: row.eisenhowerTaskId,
    sortOrder: row.sortOrder,
    loggedAt: row.loggedAt,
    createdById: row.createdById,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serialize(row: LogRow) {
  return {
    id: row.id,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    profile: row.profile,
    executiveUserId: row.executiveUserId,
    executiveUser: row.executiveUser,
    assignmentId: row.assignmentId,
    assignment: row.assignment,
    logDate: row.logDate,
    status: row.status,
    submittedAt: row.submittedAt,
    createdById: row.createdById,
    createdBy: row.createdBy,
    entryCount: row.entries.length,
    entries: row.entries.map(serializeEntry),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isEditable: row.status === "DRAFT",
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
    const [profileIds, teamIds] = await Promise.all([
      assignedProfileIds(actor.id),
      teamIdsForCommandoActive(prisma, actor.id),
    ]);
    const supportIds = await supportUserIdsOnTeams(prisma, teamIds);
    return {
      archivedAt: null,
      OR: [
        { createdById: actor.id },
        { salesExecutiveProfileId: { in: profileIds } },
        ...(supportIds.length > 0
          ? [{ executiveUserId: { in: supportIds } }]
          : []),
      ],
    };
  }
  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    const supportIds = await supportUserIdsOnTeams(prisma, teamIds);
    return {
      archivedAt: null,
      OR: [
        { profile: { teamId: { in: teamIds } } },
        ...(supportIds.length > 0
          ? [{ executiveUserId: { in: supportIds } }]
          : []),
      ],
    };
  }
  if (actor.roleCode === "SALES_EXECUTIVE") {
    return { archivedAt: null, profile: { userId: actor.id } };
  }
  if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    return { archivedAt: null, executiveUserId: actor.id };
  }
  return { id: "__none__" };
}

async function assertCanAccessLog(actor: Actor, row: LogRow): Promise<void> {
  if (isSuperAdmin(actor)) return;

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    if (row.createdById === actor.id) return;
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
    if (row.executiveUserId) {
      const teamIds = await teamIdsForCommandoActive(prisma, actor.id);
      const supportIds = await supportUserIdsOnTeams(prisma, teamIds);
      if (supportIds.includes(row.executiveUserId)) return;
    }
    throw forbidden("Log is outside your assignment scope");
  }

  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (row.profile && teamIds.includes(row.profile.teamId)) return;
    if (row.executiveUserId) {
      const supportIds = await supportUserIdsOnTeams(prisma, teamIds);
      if (supportIds.includes(row.executiveUserId)) return;
    }
    throw forbidden("Log is outside your team scope");
  }

  if (actor.roleCode === "SALES_EXECUTIVE") {
    if (!row.profile || row.profile.userId !== actor.id) {
      throw forbidden("You may only view your own daily logs");
    }
    return;
  }

  if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    if (row.executiveUserId !== actor.id) {
      throw forbidden("You may only view your own daily logs");
    }
    return;
  }

  throw forbidden("Not allowed to access daily logs");
}

async function assertCanWriteLogSubject(
  actor: Actor,
  subject: { profileId?: string | null; executiveUserId?: string | null },
): Promise<{ assignmentId: string | null }> {
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for daily coaching logs");
  }
  if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    actor.roleCode !== "TEAM_LEAD"
  ) {
    throw forbidden("Not allowed to create daily coaching logs");
  }

  const profileId = subject.profileId ?? undefined;
  const executiveUserId = subject.executiveUserId ?? undefined;
  if (Boolean(profileId) === Boolean(executiveUserId)) {
    throw badRequest(
      "Provide exactly one of salesExecutiveProfileId or executiveUserId",
    );
  }

  if (executiveUserId) {
    await assertCanManageSupportUser(prisma, actor, executiveUserId);
    return { assignmentId: null };
  }

  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: profileId!, archivedAt: null },
    select: { id: true, teamId: true },
  });
  if (!profile) throw notFound("Sales executive profile not found");

  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(profile.teamId)) {
      throw forbidden("Profile is outside your team scope");
    }
    await assertTeamLeadOperationalWriteAllowed(prisma, actor, profile.id, {
      action: "DAILY_LOG_CREATE",
    });
    return { assignmentId: null };
  }

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
  return { assignmentId: assignment.id };
}

async function loadLog(id: string): Promise<LogRow> {
  const row = await prisma.dailyLog.findFirst({
    where: { id, archivedAt: null },
    include: logInclude,
  });
  if (!row) throw notFound("Daily log not found");
  return row;
}

export async function listDailyLogs(actor: Actor, query: ListDailyLogsQuery) {
  const scope = await scopeWhere(actor);
  const where: Prisma.DailyLogWhereInput = {
    AND: [
      scope,
      ...(query.profileId
        ? [{ salesExecutiveProfileId: query.profileId }]
        : []),
      ...(query.executiveUserId
        ? [{ executiveUserId: query.executiveUserId }]
        : []),
      ...(query.status ? [{ status: query.status }] : []),
      ...(query.dateFrom || query.dateTo
        ? [
            {
              logDate: {
                ...(query.dateFrom
                  ? { gte: parseLogDateInput(query.dateFrom) }
                  : {}),
                ...(query.dateTo
                  ? { lte: parseLogDateInput(query.dateTo) }
                  : {}),
              },
            },
          ]
        : []),
      ...(query.search
        ? [
            {
              OR: [
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
                      {
                        email: {
                          contains: query.search,
                          mode: "insensitive" as const,
                        },
                      },
                    ],
                  },
                },
                {
                  entries: {
                    some: {
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
                      ],
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
      orderBy: [{ logDate: "desc" }, { createdAt: "desc" }],
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
  const row = await loadLog(id);
  await assertCanAccessLog(actor, row);
  return serialize(row);
}

/** Previous-day (and older) DRAFT logs that still need submission. */
export async function listAttentionDailyLogs(
  actor: Actor,
  opts: { profileId?: string; executiveUserId?: string },
) {
  const hasProfile = Boolean(opts.profileId);
  const hasExecutive = Boolean(opts.executiveUserId);
  if (hasProfile === hasExecutive) {
    throw badRequest("Provide exactly one of profileId or executiveUserId");
  }

  const scope = await scopeWhere(actor);
  const today = calendarDateOnly();
  const rows = await prisma.dailyLog.findMany({
    where: {
      AND: [
        scope,
        {
          archivedAt: null,
          ...(opts.profileId
            ? { salesExecutiveProfileId: opts.profileId }
            : {}),
          ...(opts.executiveUserId
            ? { executiveUserId: opts.executiveUserId }
            : {}),
          status: "DRAFT",
          logDate: { lt: today },
        },
      ],
    },
    orderBy: { logDate: "desc" },
    include: logInclude,
  });
  return { logs: rows.map(serialize) };
}

/**
 * Get or create today's (or given day's) DRAFT Daily Log for the SE or Support subject.
 * Never creates a second log for the same subject + date.
 */
export async function ensureDailyLog(actor: Actor, input: EnsureDailyLogInput) {
  const { assignmentId } = await assertCanWriteLogSubject(actor, {
    profileId: input.salesExecutiveProfileId,
    executiveUserId: input.executiveUserId,
  });
  const logDate = parseLogDateInput(input.logDate);

  const subjectWhere = input.salesExecutiveProfileId
    ? { salesExecutiveProfileId: input.salesExecutiveProfileId }
    : { executiveUserId: input.executiveUserId! };

  const existing = await prisma.dailyLog.findFirst({
    where: {
      ...subjectWhere,
      logDate,
      archivedAt: null,
    },
    include: logInclude,
  });
  if (existing) {
    await assertCanAccessLog(actor, existing);
    return serialize(existing);
  }

  try {
    const created = await prisma.dailyLog.create({
      data: {
        salesExecutiveProfileId: input.salesExecutiveProfileId ?? null,
        executiveUserId: input.executiveUserId ?? null,
        assignmentId,
        logDate,
        status: "DRAFT",
        createdById: actor.id,
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
          profileId: input.salesExecutiveProfileId ?? null,
          executiveUserId: input.executiveUserId ?? null,
          logDate: logDate.toISOString().slice(0, 10),
        },
      },
    });
    return serialize(created);
  } catch (err) {
    // Race: unique constraint — re-fetch
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      const again = await prisma.dailyLog.findFirst({
        where: {
          ...subjectWhere,
          logDate,
          archivedAt: null,
        },
        include: logInclude,
      });
      if (again) return serialize(again);
    }
    throw err;
  }
}

export async function addDailyLogEntry(
  actor: Actor,
  logId: string,
  input: CreateDailyLogEntryInput,
) {
  const log = await loadLog(logId);
  await assertCanAccessLog(actor, log);
  await assertCanWriteLogSubject(actor, {
    profileId: log.salesExecutiveProfileId,
    executiveUserId: log.executiveUserId,
  });

  if (log.status !== "DRAFT") {
    throw badRequest("Submitted daily logs are read-only");
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

  const sortOrder = log.entries.length;
  await prisma.dailyLogEntry.create({
    data: {
      dailyLogId: log.id,
      activityTypeId: activityType.id,
      sessionTitle: input.sessionTitle,
      observation: input.observation,
      evidence: input.evidence ?? null,
      seResponse: input.seResponse ?? null,
      coachingGiven: input.coachingGiven ?? null,
      expectedChange: input.expectedChange ?? null,
      followUp: input.followUp ?? null,
      sortOrder,
      loggedAt: input.loggedAt ?? new Date(),
      createdById: actor.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "DAILY_LOG_ENTRY_CREATED",
      entityType: "DailyLog",
      entityId: log.id,
      metadata: { sessionTitle: input.sessionTitle },
    },
  });

  return serialize(await loadLog(logId));
}

export async function updateDailyLogEntry(
  actor: Actor,
  logId: string,
  entryId: string,
  input: UpdateDailyLogEntryInput,
) {
  const log = await loadLog(logId);
  await assertCanAccessLog(actor, log);
  await assertCanWriteLogSubject(actor, {
    profileId: log.salesExecutiveProfileId,
    executiveUserId: log.executiveUserId,
  });

  if (log.status !== "DRAFT") {
    throw badRequest("Submitted daily logs are read-only");
  }

  const entry = log.entries.find((e) => e.id === entryId);
  if (!entry) throw notFound("Daily log entry not found");

  if (input.activityTypeId) {
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
  }

  await prisma.dailyLogEntry.update({
    where: { id: entryId },
    data: {
      activityTypeId: input.activityTypeId,
      sessionTitle: input.sessionTitle,
      observation: input.observation,
      evidence: input.evidence,
      seResponse: input.seResponse,
      coachingGiven: input.coachingGiven,
      expectedChange: input.expectedChange,
      followUp: input.followUp,
      loggedAt: input.loggedAt,
    },
  });

  return serialize(await loadLog(logId));
}

export async function deleteDailyLogEntry(
  actor: Actor,
  logId: string,
  entryId: string,
) {
  const log = await loadLog(logId);
  await assertCanAccessLog(actor, log);
  await assertCanWriteLogSubject(actor, {
    profileId: log.salesExecutiveProfileId,
    executiveUserId: log.executiveUserId,
  });

  if (log.status !== "DRAFT") {
    throw badRequest("Submitted daily logs are read-only");
  }

  const entry = log.entries.find((e) => e.id === entryId);
  if (!entry) throw notFound("Daily log entry not found");

  await prisma.dailyLogEntry.delete({ where: { id: entryId } });
  return serialize(await loadLog(logId));
}

/**
 * Submit Daily Log with optional Eisenhower classifications.
 * Only classified SE entries become Eisenhower tasks (all four quadrants).
 * Support subjects store urgency/importance/category without creating tasks.
 * Unclassified entries remain in history only.
 */
export async function submitDailyLog(
  actor: Actor,
  logId: string,
  input: SubmitDailyLogInput,
) {
  const log = await loadLog(logId);
  await assertCanAccessLog(actor, log);
  await assertCanWriteLogSubject(actor, {
    profileId: log.salesExecutiveProfileId,
    executiveUserId: log.executiveUserId,
  });

  if (log.status === "SUBMITTED") {
    throw conflict("Daily log is already submitted");
  }
  if (log.entries.length === 0) {
    throw badRequest("Add at least one activity before submitting");
  }

  const entryIds = new Set(log.entries.map((e) => e.id));
  const seen = new Set<string>();
  for (const c of input.classifications) {
    if (!entryIds.has(c.entryId)) {
      throw badRequest("Classification references an unknown entry");
    }
    if (seen.has(c.entryId)) {
      throw badRequest("Each entry can only be classified once");
    }
    seen.add(c.entryId);
  }

  const classMap = new Map(
    input.classifications.map((c) => [c.entryId, c] as const),
  );

  let eisenhowerCreated = 0;

  await prisma.$transaction(async (tx) => {
    // Re-check status inside transaction
    const locked = await tx.dailyLog.findFirst({
      where: { id: logId, archivedAt: null },
      include: { entries: true },
    });
    if (!locked) throw notFound("Daily log not found");
    if (locked.status === "SUBMITTED") {
      throw conflict("Daily log is already submitted");
    }

    for (const entry of locked.entries) {
      const cls = classMap.get(entry.id);
      if (!cls) {
        await tx.dailyLogEntry.update({
          where: { id: entry.id },
          data: {
            urgency: null,
            importance: null,
            eisenhowerCategory: null,
          },
        });
        continue;
      }

      if (entry.eisenhowerTaskId) {
        // Already linked — keep classification, skip create
        await tx.dailyLogEntry.update({
          where: { id: entry.id },
          data: {
            urgency: cls.urgency,
            importance: cls.importance,
          },
        });
        continue;
      }

      const category = eisenhowerCategoryFrom(cls.urgency, cls.importance);

      // Support subjects: store classification only (no EisenhowerTask)
      if (!locked.salesExecutiveProfileId) {
        await tx.dailyLogEntry.update({
          where: { id: entry.id },
          data: {
            urgency: cls.urgency,
            importance: cls.importance,
            eisenhowerCategory: category,
          },
        });
        continue;
      }

      const notes = [entry.observation, entry.followUp]
        .filter(Boolean)
        .join("\n\n");

      const now = new Date();
      const month = new Date(
        Date.UTC(now.getFullYear(), now.getMonth(), 1),
      );

      const task = await tx.eisenhowerTask.create({
        data: {
          salesExecutiveProfileId: locked.salesExecutiveProfileId,
          assignmentId: locked.assignmentId,
          month,
          category,
          title: entry.sessionTitle.trim().slice(0, 240),
          notes: notes ? notes.slice(0, 10000) : null,
          status: "OPEN",
          createdById: actor.id,
        },
        select: { id: true },
      });

      await tx.dailyLogEntry.update({
        where: { id: entry.id },
        data: {
          urgency: cls.urgency,
          importance: cls.importance,
          eisenhowerCategory: category,
          eisenhowerTaskId: task.id,
        },
      });
      eisenhowerCreated += 1;

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "EISENHOWER_TASK_CREATED",
          entityType: "EisenhowerTask",
          entityId: task.id,
          metadata: {
            profileId: locked.salesExecutiveProfileId,
            category,
            via: "DAILY_LOG_SUBMIT",
            dailyLogEntryId: entry.id,
          },
        },
      });
    }

    await tx.dailyLog.update({
      where: { id: logId },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "DAILY_LOG_SUBMITTED",
        entityType: "DailyLog",
        entityId: logId,
        metadata: {
          entryCount: locked.entries.length,
          prioritizedCount: input.classifications.length,
          eisenhowerCreated,
        },
      },
    });
  });

  // Workspace events for SE entries only (outside txn is OK for timeline)
  const refreshed = await loadLog(logId);
  if (refreshed.salesExecutiveProfileId) {
    for (const entry of refreshed.entries) {
      await recordWorkspaceEvent({
        salesExecutiveProfileId: refreshed.salesExecutiveProfileId,
        assignmentId: refreshed.assignmentId,
        type: "DAILY_LOG",
        title: entry.sessionTitle,
        notes: entry.observation,
        urgency: entry.urgency ?? undefined,
        importance: entry.importance ?? undefined,
        sourceType: "DailyLogEntry",
        sourceId: entry.id,
        createdById: actor.id,
      });
    }
  }

  return {
    log: serialize(refreshed),
    eisenhowerCreated,
    prioritizedCount: input.classifications.length,
  };
}

/**
 * Legacy create: ensure today's draft + add one entry (no Eisenhower until submit).
 * Keeps old clients working without urgency/importance.
 */
export async function createDailyLog(actor: Actor, input: CreateDailyLogInput) {
  const log = await ensureDailyLog(actor, {
    salesExecutiveProfileId: input.salesExecutiveProfileId,
    executiveUserId: input.executiveUserId,
  });
  return addDailyLogEntry(actor, log.id, {
    activityTypeId: input.activityTypeId,
    sessionTitle: input.sessionTitle,
    observation: input.observation,
    evidence: input.evidence,
    seResponse: input.seResponse,
    coachingGiven: input.coachingGiven,
    expectedChange: input.expectedChange,
    followUp: input.followUp,
    loggedAt: input.loggedAt,
  });
}
