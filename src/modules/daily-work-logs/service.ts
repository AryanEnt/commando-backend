import type { Prisma } from "@prisma/client";
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
import type {
  CreateDailyWorkLogInput,
  ListDailyWorkLogsQuery,
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

/** SSE user IDs linked to profiles on the Team Lead's teams. */
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

async function commandoProfileIds(actorId: string): Promise<string[]> {
  const assignments = await prisma.commandoAssignment.findMany({
    where: { commandoUserId: actorId, status: "ACTIVE" },
    select: { salesExecutiveProfileId: true },
  });
  return assignments.map((a) => a.salesExecutiveProfileId);
}

async function commandoSupportUserIds(actorId: string): Promise<string[]> {
  const profileIds = await commandoProfileIds(actorId);
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

async function scopeWhere(
  actor: Actor,
): Promise<Prisma.DailyWorkLogWhereInput> {
  if (isSuperAdmin(actor)) {
    return { archivedAt: null };
  }

  if (actor.roleCode === "SALES_EXECUTIVE" || actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    return { archivedAt: null, authorUserId: actor.id };
  }

  if (actor.roleCode === "TEAM_LEAD") {
    const [profileIds, supportUserIds] = await Promise.all([
      teamLeadProfileIds(actor.id),
      teamLeadSupportUserIds(actor.id),
    ]);
    return {
      archivedAt: null,
      OR: [
        { salesExecutiveProfileId: { in: profileIds } },
        { authorUserId: { in: supportUserIds } },
      ],
    };
  }

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    const [profileIds, supportUserIds] = await Promise.all([
      commandoProfileIds(actor.id),
      commandoSupportUserIds(actor.id),
    ]);
    return {
      archivedAt: null,
      OR: [
        { salesExecutiveProfileId: { in: profileIds } },
        { authorUserId: { in: supportUserIds } },
      ],
    };
  }

  return { id: "__none__" };
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

  let salesExecutiveProfileId: string | null = null;
  if (actor.roleCode === "SALES_EXECUTIVE") {
    const profile = await prisma.salesExecutiveProfile.findFirst({
      where: { userId: actor.id, archivedAt: null },
      select: { id: true },
    });
    if (!profile) {
      throw badRequest("Sales Executive profile not found for your account");
    }
    salesExecutiveProfileId = profile.id;
  }

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
