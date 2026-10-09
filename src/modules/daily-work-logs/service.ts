import { Prisma, type DailyWorkCommitment } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog, AUDIT_ACTIONS } from "../../lib/audit.js";
import type { Actor } from "../../lib/authorization.js";
import {
  hasPermission,
  isSuperAdmin,
} from "../../lib/authorization.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { createPresignedGetUrl, isR2Configured } from "../../lib/r2.js";
import { getActiveTeamIds } from "../../lib/scope.js";
import {
  commandoReadableProfileIds,
  commandoWritableProfileIds,
} from "../../lib/commandoAccess.js";
import {
  supportUserIdsOnTeams,
  teamIdsForCommandoActive,
} from "../../lib/supportScope.js";
import {
  assertAllowedImageUpload,
  isOwnedDailyWorkLogImageKey,
} from "../uploads/schemas.js";
import {
  resolveWorkActivity,
  workActivitiesForRole,
  workActivityLabels,
} from "./activities.js";
import {
  MAX_DAILY_WORK_LOG_ATTACHMENTS,
  type CreateCommitmentPlanInput,
  type CreateDailyWorkLogInput,
  type DailyWorkLogAttachmentInput,
  type ListDailyWorkCommitmentsQuery,
  type ListDailyWorkLogsQuery,
  type SaveDailyWorkCommitmentInput,
  type UpdateDailyWorkLogInput,
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
  attachments: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.DailyWorkLogInclude;

type Row = Prisma.DailyWorkLogGetPayload<{ include: typeof include }>;

const ATTACHMENT_URL_TTL_SECONDS = 3600;

async function attachmentUrl(storageKey: string): Promise<string | null> {
  if (!isR2Configured()) return null;
  try {
    return await createPresignedGetUrl({
      key: storageKey,
      expiresInSeconds: ATTACHMENT_URL_TTL_SECONDS,
    });
  } catch {
    return null;
  }
}

async function serialize(row: Row) {
  return {
    id: row.id,
    authorUserId: row.authorUserId,
    author: row.author,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    profile: row.profile,
    kind: row.kind,
    activity: row.activity,
    listItem: row.listItem,
    subItem: row.subItem,
    ...workActivityLabels(row.listItem, row.subItem),
    count: row.count,
    timeRange: row.timeRange,
    totalAmount: row.totalAmount === null ? null : Number(row.totalAmount),
    notes: row.notes,
    loggedAt: row.loggedAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationMinutes: row.durationMinutes,
    attachments: await Promise.all(
      row.attachments.map(async (a) => ({
        id: a.id,
        fileName: a.fileName,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
        url: await attachmentUrl(a.storageKey),
        createdAt: a.createdAt,
      })),
    ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAttachmentRows(
  actor: Actor,
  attachments: DailyWorkLogAttachmentInput[] | undefined,
) {
  return (attachments ?? []).map((a) => {
    try {
      assertAllowedImageUpload({
        contentType: a.contentType,
        contentLength: a.size ?? 1,
      });
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : "Invalid image");
    }
    if (!isOwnedDailyWorkLogImageKey(a.key, actor.id)) {
      throw badRequest("Invalid screenshot upload key");
    }
    return {
      storageKey: a.key,
      fileName: a.fileName.trim(),
      contentType: a.contentType,
      sizeBytes: a.size ?? null,
    };
  });
}

/**
 * Prisma data for the task time window. `undefined` leaves stored values
 * untouched; both `null` clears them. Schemas guarantee a valid pair.
 */
function taskTimeData(input: {
  startedAt?: Date | null;
  endedAt?: Date | null;
}): {
  startedAt?: Date | null;
  endedAt?: Date | null;
  durationMinutes?: number | null;
} {
  if (input.startedAt === undefined && input.endedAt === undefined) return {};
  if (!input.startedAt || !input.endedAt) {
    return { startedAt: null, endedAt: null, durationMinutes: null };
  }
  return {
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMinutes: Math.round(
      (input.endedAt.getTime() - input.startedAt.getTime()) / MINUTE_MS,
    ),
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

/** YYYY-MM-DD of `at` in the author's timezone (`tzOffsetMinutes` = getTimezoneOffset()). */
function localDayKey(at: Date, tzOffsetMinutes: number): string {
  return new Date(at.getTime() - tzOffsetMinutes * MINUTE_MS)
    .toISOString()
    .slice(0, 10);
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

/** A saved commitment note or at least one commitment row on the author's local day. */
async function hasCommitmentForDay(
  authorUserId: string,
  dayKey: string,
  tzOffsetMinutes: number,
): Promise<boolean> {
  if (await findCommitment(authorUserId, dayKey)) return true;
  const start = new Date(
    parseDateOnly(dayKey).getTime() + tzOffsetMinutes * MINUTE_MS,
  );
  const end = new Date(start.getTime() + 24 * 60 * MINUTE_MS);
  const rows = await prisma.dailyWorkLog.count({
    where: {
      authorUserId,
      kind: "COMMITMENT",
      archivedAt: null,
      loggedAt: { gte: start, lt: end },
    },
  });
  return rows > 0;
}

/** Entries dated today (author's local day) require today's commitment first. */
async function assertCommitmentIfToday(
  authorUserId: string,
  loggedAt: Date,
  tzOffsetMinutes: number,
) {
  const today = localDayKey(new Date(), tzOffsetMinutes);
  if (localDayKey(loggedAt, tzOffsetMinutes) !== today) return;
  if (!(await hasCommitmentForDay(authorUserId, today, tzOffsetMinutes))) {
    throw badRequest("Add today's commitment before logging your work");
  }
}

function roundAmount(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
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

/** Active assignments plus SEs handed off within the view-only window. */
async function commandoProfileIds(actorId: string): Promise<string[]> {
  return commandoReadableProfileIds(prisma, actorId);
}

/** SSE user IDs on the Commando's active teams or linked to their assigned SEs. */
async function commandoSupportUserIds(actorId: string): Promise<string[]> {
  const [teamIds, profileIds] = await Promise.all([
    teamIdsForCommandoActive(prisma, actorId),
    commandoWritableProfileIds(prisma, actorId),
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
  const and: Prisma.DailyWorkLogWhereInput[] = [scope, { kind: query.kind }];

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
    logs: await Promise.all(rows.map(serialize)),
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

  const isCommitment = input.kind === "COMMITMENT";
  const notes = input.notes?.trim() ? input.notes.trim() : null;
  // Commitments are a free-text description only.
  const resolved =
    !isCommitment && input.listItem
      ? resolveWorkActivity(actor.roleCode, {
          listItem: input.listItem,
          subItem: input.subItem,
          totalAmount: input.totalAmount,
        })
      : null;
  const activity = isCommitment
    ? (notes ?? "").slice(0, 500)
    : (resolved?.activityLabel ?? input.activity?.trim() ?? "");
  if (!activity) {
    throw badRequest(
      isCommitment ? "Describe what you plan to do" : "Activity is required",
    );
  }

  // Commitments are always for the author's current day.
  const loggedAt = isCommitment ? new Date() : input.loggedAt;
  if (isCommitment) {
    const today = localDayKey(loggedAt, input.tzOffsetMinutes);
    if (await hasCommitmentForDay(actor.id, today, input.tzOffsetMinutes)) {
      throw conflict("You've already added today's commitment");
    }
  } else {
    await assertCommitmentIfToday(actor.id, loggedAt, input.tzOffsetMinutes);
  }
  const salesExecutiveProfileId = await authorProfileId(actor);
  const attachmentRows = toAttachmentRows(actor, input.attachments);

  const created = await prisma.dailyWorkLog.create({
    data: {
      authorUserId: actor.id,
      salesExecutiveProfileId,
      kind: input.kind,
      activity,
      listItem: resolved?.listItem ?? null,
      subItem: resolved?.subItem ?? null,
      count: resolved ? (input.count ?? null) : null,
      timeRange: resolved ? input.timeRange?.trim() || null : null,
      totalAmount: roundAmount(resolved?.totalAmount ?? null),
      notes,
      loggedAt,
      ...(isCommitment ? {} : taskTimeData(input)),
      ...(attachmentRows.length > 0
        ? { attachments: { create: attachmentRows } }
        : {}),
    },
    include,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: isCommitment
      ? AUDIT_ACTIONS.DAILY_WORK_COMMITMENT_SAVED
      : AUDIT_ACTIONS.DAILY_WORK_LOG_CREATED,
    entityType: "DailyWorkLog",
    entityId: created.id,
    metadata: {
      kind: created.kind,
      activity: created.activity,
      listItem: created.listItem,
      subItem: created.subItem,
      count: created.count,
      loggedAt: created.loggedAt.toISOString(),
      durationMinutes: created.durationMinutes,
      salesExecutiveProfileId,
      attachments: attachmentRows.length,
    },
  });

  return serialize(created);
}

/** Today's commitment as one or more planned activities; locked once added. */
export async function createCommitmentPlan(
  actor: Actor,
  input: CreateCommitmentPlanInput,
) {
  assertCanAuthor(actor);

  const seen = new Set<string>();
  const items = input.items.map((item) => {
    const resolved = resolveWorkActivity(actor.roleCode, item);
    const key = `${resolved.listItem}:${resolved.subItem ?? ""}`;
    if (seen.has(key)) {
      throw badRequest(`${resolved.activityLabel} is listed twice`);
    }
    seen.add(key);
    return { ...resolved, count: item.count };
  });

  const now = new Date();
  const today = localDayKey(now, input.tzOffsetMinutes);
  if (await hasCommitmentForDay(actor.id, today, input.tzOffsetMinutes)) {
    throw conflict("You've already added today's commitment");
  }
  const salesExecutiveProfileId = await authorProfileId(actor);
  const note = input.note?.trim() || null;

  let result: { ids: string[]; commitment: DailyWorkCommitment | null };
  try {
    result = await prisma.$transaction(async (tx) => {
      const commitment = note
        ? await tx.dailyWorkCommitment.create({
            data: {
              authorUserId: actor.id,
              salesExecutiveProfileId,
              commitDate: parseDateOnly(today),
              commitment: note,
            },
          })
        : null;
      const ids: string[] = [];
      for (const [index, item] of items.entries()) {
        const row = await tx.dailyWorkLog.create({
          data: {
            authorUserId: actor.id,
            salesExecutiveProfileId,
            kind: "COMMITMENT",
            activity: item.activityLabel,
            listItem: item.listItem,
            subItem: item.subItem,
            count: item.count,
            totalAmount: roundAmount(item.totalAmount),
            // Lists are newest first; staggering keeps the order the author picked.
            loggedAt: new Date(now.getTime() - index),
          },
          select: { id: true },
        });
        ids.push(row.id);
      }
      return { ids, commitment };
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw conflict("You've already added today's commitment");
    }
    throw err;
  }

  const rows = await prisma.dailyWorkLog.findMany({
    where: { id: { in: result.ids } },
    include,
    orderBy: { loggedAt: "desc" },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: AUDIT_ACTIONS.DAILY_WORK_COMMITMENT_SAVED,
    entityType: "DailyWorkLog",
    entityId: result.ids[0]!,
    metadata: {
      kind: "COMMITMENT",
      commitDate: today,
      items: items.map((i) => ({
        listItem: i.listItem,
        subItem: i.subItem,
        count: i.count,
      })),
      note: Boolean(note),
      salesExecutiveProfileId,
    },
  });

  return {
    logs: await Promise.all(rows.map(serialize)),
    commitment: result.commitment ? serializeCommitment(result.commitment) : null,
  };
}

export function listWorkActivityOptions(actor: Actor) {
  if (!hasPermission(actor, PERMISSIONS.DAILY_WORK_LOG_VIEW)) {
    throw forbidden("Not allowed to view daily work logs");
  }
  return { activities: workActivitiesForRole(actor.roleCode) };
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
  if (row.kind === "COMMITMENT") {
    throw badRequest("Commitments are locked once added and can't be changed");
  }
  if (input.loggedAt) {
    await assertCommitmentIfToday(actor.id, input.loggedAt, input.tzOffsetMinutes);
  }

  const structuredChange =
    input.listItem !== undefined ||
    input.subItem !== undefined ||
    input.totalAmount !== undefined;
  // A new activity resets the sub item and amount unless they are sent with it.
  const resolved = structuredChange
    ? resolveWorkActivity(actor.roleCode, {
        listItem: input.listItem ?? row.listItem ?? "",
        subItem:
          input.subItem !== undefined
            ? input.subItem
            : input.listItem !== undefined
              ? null
              : row.subItem,
        totalAmount:
          input.totalAmount !== undefined
            ? input.totalAmount
            : input.listItem !== undefined
              ? null
              : row.totalAmount === null
                ? null
                : Number(row.totalAmount),
      })
    : null;

  const removeIds = (input.removeAttachmentIds ?? []).filter((id) =>
    row.attachments.some((a) => a.id === id),
  );
  const attachmentRows = toAttachmentRows(actor, input.attachments);
  if (
    row.attachments.length - removeIds.length + attachmentRows.length >
    MAX_DAILY_WORK_LOG_ATTACHMENTS
  ) {
    throw badRequest(
      `An entry can have at most ${MAX_DAILY_WORK_LOG_ATTACHMENTS} screenshots`,
    );
  }

  const updated = await prisma.dailyWorkLog.update({
    where: { id: row.id },
    data: {
      activity: resolved
        ? resolved.activityLabel
        : input.activity !== undefined
          ? input.activity.trim()
          : undefined,
      ...(resolved
        ? {
            listItem: resolved.listItem,
            subItem: resolved.subItem,
            totalAmount: roundAmount(resolved.totalAmount),
          }
        : {}),
      count: input.count,
      timeRange:
        input.timeRange === undefined ? undefined : input.timeRange?.trim() || null,
      notes:
        input.notes === undefined
          ? undefined
          : input.notes?.trim()
            ? input.notes.trim()
            : null,
      loggedAt: input.loggedAt,
      ...taskTimeData(input),
      ...(removeIds.length > 0 || attachmentRows.length > 0
        ? {
            attachments: {
              ...(removeIds.length > 0
                ? { deleteMany: { id: { in: removeIds } } }
                : {}),
              ...(attachmentRows.length > 0
                ? { create: attachmentRows }
                : {}),
            },
          }
        : {}),
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
      listItem: updated.listItem,
      subItem: updated.subItem,
      count: updated.count,
      loggedAt: updated.loggedAt.toISOString(),
      durationMinutes: updated.durationMinutes,
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
  if (row.kind === "COMMITMENT") {
    throw badRequest("Commitments are locked once added and can't be deleted");
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

/** Create today's commitment; it cannot be changed once saved. */
export async function saveDailyWorkCommitment(
  actor: Actor,
  input: SaveDailyWorkCommitmentInput,
) {
  assertCanAuthor(actor);

  const commitment = input.commitment.trim();
  if (!commitment) throw badRequest("Commitment is required");

  const today = localDayKey(new Date(), input.tzOffsetMinutes);
  if (await hasCommitmentForDay(actor.id, today, input.tzOffsetMinutes)) {
    throw badRequest("Today's commitment is already saved and cannot be changed");
  }

  const salesExecutiveProfileId = await authorProfileId(actor);
  const commitDate = parseDateOnly(today);
  let saved: DailyWorkCommitment;
  try {
    saved = await prisma.dailyWorkCommitment.create({
      data: {
        authorUserId: actor.id,
        salesExecutiveProfileId,
        commitDate,
        commitment,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw badRequest(
        "Today's commitment is already saved and cannot be changed",
      );
    }
    throw err;
  }

  await writeAuditLog({
    actorId: actor.id,
    action: AUDIT_ACTIONS.DAILY_WORK_COMMITMENT_SAVED,
    entityType: "DailyWorkCommitment",
    entityId: saved.id,
    metadata: { commitDate: today },
  });

  return serializeCommitment(saved);
}
