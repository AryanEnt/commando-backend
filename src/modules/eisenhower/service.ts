import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { getActiveTeamIds } from "../../lib/scope.js";
import { assertTeamLeadOperationalWriteAllowed } from "../../lib/teamLeadLock.js";
import {
  getCommandoLifecycleState,
  salesExecutiveCanViewEisenhowerMonth,
} from "../../lib/lifecycleVisibility.js";
import type {
  CreateEisenhowerTaskInput,
  ListEisenhowerQuery,
  UpdateEisenhowerStatusInput,
  UpdateEisenhowerTaskInput,
} from "./schemas.js";

const taskInclude = {
  profile: {
    select: { id: true, displayName: true, userId: true, teamId: true },
  },
  createdBy: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  assignment: {
    select: { id: true, status: true, startedAt: true, endedAt: true },
  },
} satisfies Prisma.EisenhowerTaskInclude;

type TaskRow = Prisma.EisenhowerTaskGetPayload<{ include: typeof taskInclude }>;

function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function currentMonthStart(): Date {
  const now = new Date();
  return startOfMonthUtc(now);
}

function monthLabel(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function isExpired(row: TaskRow, now = new Date()): boolean {
  if (row.status === "DONE" || row.status === "CANCELLED") return false;
  if (!row.dueDate) return false;
  return row.dueDate.getTime() < now.getTime();
}

function serialize(row: TaskRow) {
  const monthStart = startOfMonthUtc(row.month);
  const current = currentMonthStart();
  const isCurrentMonth = monthStart.getTime() === current.getTime();
  const expired = isExpired(row);

  return {
    id: row.id,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    profile: row.profile,
    assignmentId: row.assignmentId,
    assignment: row.assignment,
    month: row.month,
    monthLabel: monthLabel(monthStart),
    category: row.category,
    title: row.title,
    notes: row.notes,
    dueDate: row.dueDate,
    status: row.status,
    isExpired: expired,
    isCurrentMonth,
    isHistory: !isCurrentMonth,
    createdById: row.createdById,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function scopeWhere(
  actor: Actor,
): Promise<Prisma.EisenhowerTaskWhereInput> {
  if (isSuperAdmin(actor)) {
    return { archivedAt: null };
  }

  switch (actor.roleCode) {
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
        OR: [
          { createdById: actor.id },
          { salesExecutiveProfileId: { in: profileIds } },
        ],
      };
    }
    case "TEAM_LEAD": {
      const teamIds = await getActiveTeamIds(prisma, actor.id);
      return {
        archivedAt: null,
        profile: { teamId: { in: teamIds } },
      };
    }
    case "SALES_EXECUTIVE": {
      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { userId: actor.id, archivedAt: null },
        select: { id: true },
      });
      if (!profile) return { id: "__none__" };
      const lifecycle = await getCommandoLifecycleState(prisma, profile.id);
      if (lifecycle.isDuringCommando) {
        return {
          archivedAt: null,
          salesExecutiveProfileId: profile.id,
          month: currentMonthStart(),
        };
      }
      return {
        archivedAt: null,
        salesExecutiveProfileId: profile.id,
      };
    }
    default:
      return { id: "__none__" };
  }
}

async function assertCanAccess(actor: Actor, row: TaskRow): Promise<void> {
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
      throw forbidden("Task is outside your assignment scope");
    }
    return;
  }

  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(row.profile.teamId)) {
      throw forbidden("Task is outside your team scope");
    }
    return;
  }

  if (actor.roleCode === "SALES_EXECUTIVE") {
    if (row.profile.userId !== actor.id) {
      throw forbidden("You may only view your own Eisenhower tasks");
    }
    const lifecycle = await getCommandoLifecycleState(
      prisma,
      row.salesExecutiveProfileId,
    );
    if (
      !salesExecutiveCanViewEisenhowerMonth(
        startOfMonthUtc(row.month),
        currentMonthStart(),
        lifecycle,
      )
    ) {
      throw forbidden(
        "Eisenhower history is not visible during an active Commando assignment",
      );
    }
    return;
  }

  throw forbidden("Not allowed to access Eisenhower tasks");
}

async function assertCanManage(actor: Actor, row: TaskRow): Promise<void> {
  await assertCanAccess(actor, row);
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for Eisenhower tasks");
  }
  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    const active = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: row.salesExecutiveProfileId,
        commandoUserId: actor.id,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (!active && row.createdById !== actor.id) {
      throw forbidden("No active assignment to manage this task");
    }
    return;
  }
  if (actor.roleCode === "TEAM_LEAD") {
    await assertTeamLeadOperationalWriteAllowed(
      prisma,
      actor,
      row.salesExecutiveProfileId,
      { action: "EISENHOWER_UPDATE" },
    );
    return;
  }
  throw forbidden("Only Commandos and Team Leads can manage Eisenhower tasks");
}

export async function createEisenhowerTask(
  actor: Actor,
  input: CreateEisenhowerTaskInput,
) {
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for Eisenhower tasks");
  }
  if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    actor.roleCode !== "TEAM_LEAD"
  ) {
    throw forbidden("Only Commandos and Team Leads can create Eisenhower tasks");
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
      action: "EISENHOWER_CREATE",
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
        "You may only create tasks for profiles with an active assignment to you",
      );
    }
    assignmentId = assignment.id;
  }

  const created = await prisma.eisenhowerTask.create({
    data: {
      salesExecutiveProfileId: profile.id,
      assignmentId,
      month: input.month,
      category: input.category,
      title: input.title,
      notes: input.notes?.trim() ? input.notes.trim() : null,
      dueDate: input.dueDate ?? null,
      status: input.status ?? "OPEN",
      createdById: actor.id,
    },
    include: taskInclude,
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "EISENHOWER_TASK_CREATED",
      entityType: "EisenhowerTask",
      entityId: created.id,
      metadata: {
        profileId: profile.id,
        month: monthLabel(input.month),
        category: input.category,
      },
    },
  });

  return serialize(created);
}

export async function listEisenhowerTasks(
  actor: Actor,
  query: ListEisenhowerQuery,
) {
  const scope = await scopeWhere(actor);

  // SE during Commando: reject historical month query bypasses
  if (actor.roleCode === "SALES_EXECUTIVE" && query.month) {
    const profile = await prisma.salesExecutiveProfile.findFirst({
      where: { userId: actor.id, archivedAt: null },
      select: { id: true },
    });
    if (profile) {
      const lifecycle = await getCommandoLifecycleState(prisma, profile.id);
      if (
        !salesExecutiveCanViewEisenhowerMonth(
          startOfMonthUtc(query.month),
          currentMonthStart(),
          lifecycle,
        )
      ) {
        throw forbidden(
          "Eisenhower history is not visible during an active Commando assignment",
        );
      }
    }
  }

  const where: Prisma.EisenhowerTaskWhereInput = {
    AND: [
      scope,
      ...(query.profileId
        ? [{ salesExecutiveProfileId: query.profileId }]
        : []),
      ...(query.month ? [{ month: query.month }] : []),
      ...(query.category ? [{ category: query.category }] : []),
      ...(query.status ? [{ status: query.status }] : []),
      ...(query.search
        ? [
            {
              OR: [
                {
                  title: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  notes: {
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
    prisma.eisenhowerTask.count({ where }),
    prisma.eisenhowerTask.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: [{ month: "desc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      include: taskInclude,
    }),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    currentMonth: monthLabel(currentMonthStart()),
    tasks: rows.map(serialize),
  };
}

export async function getEisenhowerMatrix(
  actor: Actor,
  query: { profileId?: string; month?: Date },
) {
  const month = query.month ?? currentMonthStart();

  if (actor.roleCode === "SALES_EXECUTIVE") {
    const profile = await prisma.salesExecutiveProfile.findFirst({
      where: { userId: actor.id, archivedAt: null },
      select: { id: true },
    });
    if (profile) {
      const lifecycle = await getCommandoLifecycleState(prisma, profile.id);
      if (
        !salesExecutiveCanViewEisenhowerMonth(
          startOfMonthUtc(month),
          currentMonthStart(),
          lifecycle,
        )
      ) {
        throw forbidden(
          "Eisenhower history is not visible during an active Commando assignment",
        );
      }
    }
  }

  const scope = await scopeWhere(actor);
  const where: Prisma.EisenhowerTaskWhereInput = {
    AND: [
      scope,
      { month },
      ...(query.profileId
        ? [{ salesExecutiveProfileId: query.profileId }]
        : []),
    ],
  };

  const rows = await prisma.eisenhowerTask.findMany({
    where,
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    include: taskInclude,
  });

  const tasks = rows.map(serialize);
  const byCategory = {
    DO_FIRST: tasks.filter((t) => t.category === "DO_FIRST"),
    SCHEDULE: tasks.filter((t) => t.category === "SCHEDULE"),
    DELEGATE: tasks.filter((t) => t.category === "DELEGATE"),
    ELIMINATE: tasks.filter((t) => t.category === "ELIMINATE"),
  };

  return {
    month: monthLabel(month),
    isCurrentMonth: month.getTime() === currentMonthStart().getTime(),
    byCategory,
    tasks,
  };
}

export async function getEisenhowerTask(actor: Actor, id: string) {
  const row = await prisma.eisenhowerTask.findFirst({
    where: { id, archivedAt: null },
    include: taskInclude,
  });
  if (!row) throw notFound("Eisenhower task not found");
  await assertCanAccess(actor, row);
  return serialize(row);
}

export async function updateEisenhowerTask(
  actor: Actor,
  id: string,
  input: UpdateEisenhowerTaskInput,
) {
  const existing = await prisma.eisenhowerTask.findFirst({
    where: { id, archivedAt: null },
    include: taskInclude,
  });
  if (!existing) throw notFound("Eisenhower task not found");
  await assertCanManage(actor, existing);

  // Never move a historical month's task into another month in a destructive way —
  // month changes are allowed only as an explicit field update on the same record.
  if (
    input.month &&
    startOfMonthUtc(existing.month).getTime() !== input.month.getTime() &&
    startOfMonthUtc(existing.month).getTime() < currentMonthStart().getTime()
  ) {
    throw badRequest(
      "Historical monthly tasks cannot be moved to a different month; create a new task instead",
    );
  }

  const updated = await prisma.eisenhowerTask.update({
    where: { id },
    data: {
      category: input.category,
      title: input.title,
      notes:
        input.notes === undefined
          ? undefined
          : input.notes?.trim()
            ? input.notes.trim()
            : null,
      dueDate: input.dueDate === undefined ? undefined : input.dueDate,
      month: input.month,
    },
    include: taskInclude,
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "EISENHOWER_TASK_UPDATED",
      entityType: "EisenhowerTask",
      entityId: updated.id,
      metadata: { category: updated.category, title: updated.title },
    },
  });

  return serialize(updated);
}

export async function updateEisenhowerTaskStatus(
  actor: Actor,
  id: string,
  input: UpdateEisenhowerStatusInput,
) {
  const existing = await prisma.eisenhowerTask.findFirst({
    where: { id, archivedAt: null },
    include: taskInclude,
  });
  if (!existing) throw notFound("Eisenhower task not found");
  await assertCanManage(actor, existing);

  if (existing.status === input.status) {
    return serialize(existing);
  }

  const updated = await prisma.eisenhowerTask.update({
    where: { id },
    data: { status: input.status },
    include: taskInclude,
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "EISENHOWER_TASK_STATUS_UPDATED",
      entityType: "EisenhowerTask",
      entityId: updated.id,
      metadata: { from: existing.status, to: input.status },
    },
  });

  return serialize(updated);
}
