import type { DailyWorkCommitment, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog, AUDIT_ACTIONS } from "../../lib/audit.js";
import type { Actor } from "../../lib/authorization.js";
import {
  hasPermission,
  isSuperAdmin,
} from "../../lib/authorization.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { getActiveTeamIds } from "../../lib/scope.js";
import {
  supportUserIdsOnTeams,
  teamIdsForCommandoActive,
} from "../../lib/supportScope.js";
import type {
  CreateDailyWorkLogInput,
  ListDailyWorkCommitmentsQuery,
  ListDailyWorkLogsQuery,
  SaveDailyWorkCommitmentInput,
  UpdateDailyWorkLogInput,
} from "./schemas.js";

const include = {
  author: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: { select: { code: true } },
    },
  },
  profile: {
    select: { id: true, displayName: true, userId: true, teamId: true },
  },
} satisfies Prisma.DailyWorkLogInclude;

type Row = Prisma.DailyWorkLogGetPayload<{ include: typeof include }>;

function serialize(row: Row) {
  return {
    id: row.id,
    authorUserId: row.authorUserId,
    author: row.author,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    profile: row.profile,
    activity: row.activity,
    notes: row.notes,
    loggedAt: row.loggedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  );
}

function endOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
}

function parseDateOnly(date: string): Date {
  const [y, m, day] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, day!, 0, 0, 0, 0));
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** YYYY-MM-DD of `at` in the author's timezone (`tzOffsetMinutes` = getTimezoneOffset()). */
function localDayKey(at: Date, tzOffsetMinutes: number): string {
  return new Date(at.getTime() - tzOffsetMinutes * MINUTE_MS)
    .toISOString()
    .slice(0, 10);
}

function localDayBounds(dayKey: string, tzOffsetMinutes: number) {
  const start = new Date(
    parseDateOnly(dayKey).getTime() + tzOffsetMinutes * MINUTE_MS,
  );
  return { start, end: new Date(start.getTime() + DAY_MS - 1) };
}

async function authorProfileId(actor: Actor): Promise<string | null> {
  if (actor.roleCode !== "SALES_EXECUTIVE") return null;
  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { userId: actor.id, archivedAt: null },
    select: { id: true },
  });
  if (!profile) {
    throw badRequest("Sales Executive profile not found for your account");
  }
  return profile.id;
}

function findCommitment(authorUserId: string, dayKey: string) {
  return prisma.dailyWorkCommitment.findUnique({
    where: {
      authorUserId_commitDate: {
        authorUserId,
        commitDate: parseDateOnly(dayKey),
      },
    },
  });
}

/** Entries dated today (author's local day) require today's commitment first. */
async function assertCommitmentIfToday(
  authorUserId: string,
  loggedAt: Date,
  tzOffsetMinutes: number,
) {
  const today = localDayKey(new Date(), tzOffsetMinutes);
  if (localDayKey(loggedAt, tzOffsetMinutes) !== today) return;
  const commitment = await findCommitment(authorUserId, today);
  if (!commitment) {
    throw badRequest("Add today's commitment before logging your work");
  }
}

/** SE profiles a Team Lead can see work logs for. */
async function teamLeadProfileIds(actorId: string): Promise<string[]> {
  const teamIds = await getActiveTeamIds(prisma, actorId);
  if (teamIds.length === 0) return [];
  const profiles = await prisma.salesExecutiveProfile.findMany({
    where: { teamId: { in: teamIds }, archivedAt: null },
    select: { id: true },
  });
  return profiles.map((p) => p.id);
}

async function linkedSupportUserIds(profileIds: string[]): Promise<string[]> {
  if (profileIds.length === 0) return [];
  const links = await prisma.salesSupportLink.findMany({
    where: {
      salesExecutiveProfileId: { in: profileIds },
      isActive: true,
    },
    select: { salesSupportUserId: true },
  });
  return links.map((l) => l.salesSupportUserId);
}

/** SSE user IDs on the Team Lead's teams or linked to their SEs. */
async function teamLeadSupportUserIds(actorId: string): Promise<string[]> {
  const [teamIds, profileIds] = await Promise.all([
    getActiveTeamIds(prisma, actorId),
    teamLeadProfileIds(actorId),
  ]);
  const [onTeams, linked] = await Promise.all([
    supportUserIdsOnTeams(prisma, teamIds),
    linkedSupportUserIds(profileIds),
  ]);
  return [...new Set([...onTeams, ...linked])];
}

async function commandoProfileIds(actorId: string): Promise<string[]> {
  const assignments = await prisma.commandoAssignment.findMany({
    where: { commandoUserId: actorId, status: "ACTIVE" },
    select: { salesExecutiveProfileId: true },
  });
  return assignments.map((a) => a.salesExecutiveProfileId);
}

/** SSE user IDs on the Commando's active teams or linked to their assigned SEs. */
async function commandoSupportUserIds(actorId: string): Promise<string[]> {
  const [teamIds, profileIds] = await Promise.all([
    teamIdsForCommandoActive(prisma, actorId),
    commandoProfileIds(actorId),
  ]);
  const [onTeams, linked] = await Promise.all([
    supportUserIdsOnTeams(prisma, teamIds),
    linkedSupportUserIds(profileIds),
  ]);
  return [...new Set([...onTeams, ...linked])];
}

/** `null` = unrestricted (Super Admin). Otherwise records must match one list. */
type AuthorScope = { profileIds: string[]; authorUserIds: string[] } | null;

async function authorScope(actor: Actor): Promise<AuthorScope> {
  if (isSuperAdmin(actor)) return null;

  if (
    actor.roleCode === "SALES_EXECUTIVE" ||
    actor.roleCode === "SALES_SUPPORT_EXECUTIVE"
  ) {
    return { profileIds: [], authorUserIds: [actor.id] };
  }

  if (actor.roleCode === "TEAM_LEAD") {
    const [profileIds, authorUserIds] = await Promise.all([
      teamLeadProfileIds(actor.id),
      teamLeadSupportUserIds(actor.id),
    ]);
    return { profileIds, authorUserIds };
  }

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    const [profileIds, authorUserIds] = await Promise.all([
      commandoProfileIds(actor.id),
      commandoSupportUserIds(actor.id),
    ]);
    return { profileIds, authorUserIds };
  }

  return { profileIds: [], authorUserIds: [] };
}

function scopeOr(scope: NonNullable<AuthorScope>) {
  return [
    { salesExecutiveProfileId: { in: scope.profileIds } },
    { authorUserId: { in: scope.authorUserIds } },
  ];
}

async function scopeWhere(
  actor: Actor,
): Promise<Prisma.DailyWorkLogWhereInput> {
  const scope = await authorScope(actor);
  if (!scope) return { archivedAt: null };
  return { archivedAt: null, OR: scopeOr(scope) };
}

async function assertCanViewRow(actor: Actor, row: Row) {
  if (isSuperAdmin(actor)) return;
  if (row.authorUserId === actor.id) return;

  if (actor.roleCode === "TEAM_LEAD") {
    if (row.salesExecutiveProfileId) {
      const ids = await teamLeadProfileIds(actor.id);
      if (ids.includes(row.salesExecutiveProfileId)) return;
    }
    const supportIds = await teamLeadSupportUserIds(actor.id);
    if (supportIds.includes(row.authorUserId)) return;
    throw forbidden("Work log is outside your team scope");
  }

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    if (row.salesExecutiveProfileId) {
      const ids = await commandoProfileIds(actor.id);
      if (ids.includes(row.salesExecutiveProfileId)) return;
    }
    const supportIds = await commandoSupportUserIds(actor.id);
    if (supportIds.includes(row.authorUserId)) return;
    throw forbidden("Work log is outside your assignment scope");
  }

  throw forbidden("Not allowed to view this work log");
}

function assertCanAuthor(actor: Actor) {
  if (
    actor.roleCode !== "SALES_EXECUTIVE" &&
    actor.roleCode !== "SALES_SUPPORT_EXECUTIVE"
  ) {
    throw forbidden("Only Sales Executives and Sales Support can create work logs");
  }
  if (!hasPermission(actor, PERMISSIONS.DAILY_WORK_LOG_CREATE)) {
    throw forbidden("Not allowed to create daily work logs");
  }
}

export async function listDailyWorkLogs(
  actor: Actor,
  query: ListDailyWorkLogsQuery,
) {
  if (!hasPermission(actor, PERMISSIONS.DAILY_WORK_LOG_VIEW)) {
    throw forbidden("Not allowed to view daily work logs");
  }

  const scope = await scopeWhere(actor);
  const and: Prisma.DailyWorkLogWhereInput[] = [scope];

  if (query.authorUserId) {
    and.push({ authorUserId: query.authorUserId });
  }
  if (query.profileId) {
    and.push({ salesExecutiveProfileId: query.profileId });
  }

  if (query.date) {
    const day = parseDateOnly(query.date);
    and.push({
      loggedAt: { gte: startOfUtcDay(day), lte: endOfUtcDay(day) },
    });
  } else {
    if (query.dateFrom) {
      and.push({ loggedAt: { gte: query.dateFrom } });
    }
    if (query.dateTo) {
      and.push({ loggedAt: { lte: query.dateTo } });
    }
  }

  if (query.search?.trim()) {
    const q = query.search.trim();
    and.push({
      OR: [
        { activity: { contains: q, mode: "insensitive" } },
        { notes: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.DailyWorkLogWhereInput = { AND: and };
  const skip = (query.page - 1) * query.pageSize;

  const [total, rows] = await Promise.all([
    prisma.dailyWorkLog.count({ where }),
    prisma.dailyWorkLog.findMany({
      where,
      include,
      orderBy: [{ loggedAt: "desc" }, { createdAt: "desc" }],
      skip,
      take: query.pageSize,
    }),
  ]);

  return {
    logs: rows.map(serialize),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getDailyWorkLog(actor: Actor, id: string) {
  if (!hasPermission(actor, PERMISSIONS.DAILY_WORK_LOG_VIEW)) {
    throw forbidden("Not allowed to view daily work logs");
  }

  const row = await prisma.dailyWorkLog.findFirst({
    where: { id, archivedAt: null },
    include,
  });
  if (!row) throw notFound("Daily work log not found");
  await assertCanViewRow(actor, row);
  return serialize(row);
}

export async function createDailyWorkLog(
  actor: Actor,
  input: CreateDailyWorkLogInput,
) {
  assertCanAuthor(actor);

  const activity = input.activity.trim();
  if (!activity) throw badRequest("Activity is required");

  await assertCommitmentIfToday(actor.id, input.loggedAt, input.tzOffsetMinutes);
  const salesExecutiveProfileId = await authorProfileId(actor);

  const created = await prisma.dailyWorkLog.create({
    data: {
      authorUserId: actor.id,
      salesExecutiveProfileId,
      activity,
      notes: input.notes?.trim() ? input.notes.trim() : null,
      loggedAt: input.loggedAt,
    },
    include,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: AUDIT_ACTIONS.DAILY_WORK_LOG_CREATED,
    entityType: "DailyWorkLog",
    entityId: created.id,
    metadata: {
      activity: created.activity,
      loggedAt: created.loggedAt.toISOString(),
      salesExecutiveProfileId,
    },
  });

  return serialize(created);
}

export async function updateDailyWorkLog(
  actor: Actor,
  id: string,
  input: UpdateDailyWorkLogInput,
) {
  const row = await prisma.dailyWorkLog.findFirst({
    where: { id, archivedAt: null },
    include,
  });
  if (!row) throw notFound("Daily work log not found");

  if (row.authorUserId !== actor.id) {
    throw forbidden("You can only edit your own work logs");
  }
  if (!hasPermission(actor, PERMISSIONS.DAILY_WORK_LOG_CREATE)) {
    throw forbidden("Not allowed to update daily work logs");
  }
  if (input.loggedAt) {
    await assertCommitmentIfToday(actor.id, input.loggedAt, input.tzOffsetMinutes);
  }

  const updated = await prisma.dailyWorkLog.update({
    where: { id: row.id },
    data: {
      activity:
        input.activity !== undefined ? input.activity.trim() : undefined,
      notes:
        input.notes === undefined
          ? undefined
          : input.notes?.trim()
            ? input.notes.trim()
            : null,
      loggedAt: input.loggedAt,
    },
    include,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: AUDIT_ACTIONS.DAILY_WORK_LOG_UPDATED,
    entityType: "DailyWorkLog",
    entityId: updated.id,
    metadata: {
      activity: updated.activity,
      loggedAt: updated.loggedAt.toISOString(),
    },
  });

  return serialize(updated);
}

export async function deleteDailyWorkLog(actor: Actor, id: string) {
  const row = await prisma.dailyWorkLog.findFirst({
    where: { id, archivedAt: null },
  });
  if (!row) throw notFound("Daily work log not found");

  if (row.authorUserId !== actor.id) {
    throw forbidden("You can only delete your own work logs");
  }
  if (!hasPermission(actor, PERMISSIONS.DAILY_WORK_LOG_CREATE)) {
    throw forbidden("Not allowed to delete daily work logs");
  }

  const updated = await prisma.dailyWorkLog.update({
    where: { id: row.id },
    data: { archivedAt: new Date() },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: AUDIT_ACTIONS.DAILY_WORK_LOG_DELETED,
    entityType: "DailyWorkLog",
    entityId: updated.id,
    metadata: {
      activity: row.activity,
      loggedAt: row.loggedAt.toISOString(),
    },
  });

  return { id: updated.id, archived: true };
}

function serializeCommitment(row: DailyWorkCommitment) {
  return {
    id: row.id,
    authorUserId: row.authorUserId,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    commitDate: row.commitDate.toISOString().slice(0, 10),
    commitment: row.commitment,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listDailyWorkCommitments(
  actor: Actor,
  query: ListDailyWorkCommitmentsQuery,
) {
  if (!hasPermission(actor, PERMISSIONS.DAILY_WORK_LOG_VIEW)) {
    throw forbidden("Not allowed to view daily work logs");
  }

  const scope = await authorScope(actor);
  const and: Prisma.DailyWorkCommitmentWhereInput[] = [
    {
      commitDate: {
        gte: parseDateOnly(query.dateFrom),
        lte: parseDateOnly(query.dateTo),
      },
    },
  ];
  if (scope) and.push({ OR: scopeOr(scope) });
  if (query.authorUserId) and.push({ authorUserId: query.authorUserId });
  if (query.profileId) and.push({ salesExecutiveProfileId: query.profileId });

  const rows = await prisma.dailyWorkCommitment.findMany({
    where: { AND: and },
    orderBy: { commitDate: "desc" },
  });
  return { commitments: rows.map(serializeCommitment) };
}

/** Create or edit today's commitment; editable only until today's first entry. */
export async function saveDailyWorkCommitment(
  actor: Actor,
  input: SaveDailyWorkCommitmentInput,
) {
  assertCanAuthor(actor);

  const commitment = input.commitment.trim();
  if (!commitment) throw badRequest("Commitment is required");

  const today = localDayKey(new Date(), input.tzOffsetMinutes);
  const existing = await findCommitment(actor.id, today);
  if (existing) {
    const { start, end } = localDayBounds(today, input.tzOffsetMinutes);
    const entriesToday = await prisma.dailyWorkLog.count({
      where: {
        authorUserId: actor.id,
        archivedAt: null,
        loggedAt: { gte: start, lte: end },
      },
    });
    if (entriesToday > 0) {
      throw badRequest(
        "Today's commitment is locked once you have logged work for the day",
      );
    }
  }

  const salesExecutiveProfileId = await authorProfileId(actor);
  const commitDate = parseDateOnly(today);
  const saved = await prisma.dailyWorkCommitment.upsert({
    where: { authorUserId_commitDate: { authorUserId: actor.id, commitDate } },
    create: {
      authorUserId: actor.id,
      salesExecutiveProfileId,
      commitDate,
      commitment,
    },
    update: { commitment },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: AUDIT_ACTIONS.DAILY_WORK_COMMITMENT_SAVED,
    entityType: "DailyWorkCommitment",
    entityId: saved.id,
    metadata: { commitDate: today, edited: Boolean(existing) },
  });

  return serializeCommitment(saved);
}
