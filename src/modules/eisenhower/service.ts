import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { getActiveTeamIds } from "../../lib/scope.js";
import {
  getCommandoLifecycleState,
  salesExecutiveCanViewEisenhowerOwnership,
} from "../../lib/lifecycleVisibility.js";
import type {
  CreateEisenhowerTaskInput,
  EisenhowerWorkspaceQuery,
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
} satisfies Prisma.EisenhowerTaskInclude;

type TaskRow = Prisma.EisenhowerTaskGetPayload<{ include: typeof taskInclude }>;

function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Normalize Prisma `@db.Date` values that may shift across midnight in local TZ. */
function calendarMonthStart(d: Date): Date {
  const isoDay = d.toISOString().slice(0, 10);
  const [y, m] = isoDay.split("-").map(Number);
  // If the instant is late in the UTC day, prefer local calendar month for @db.Date
  const localY = d.getFullYear();
  const localM = d.getMonth();
  const utcY = d.getUTCFullYear();
  const utcM = d.getUTCMonth();
  // Prefer the date components that match a 1st-of-month stored date
  if (d.getUTCDate() === 1) {
    return new Date(Date.UTC(utcY, utcM, 1));
  }
  if (d.getDate() === 1) {
    return new Date(Date.UTC(localY, localM, 1));
  }
  return new Date(Date.UTC(y, m - 1, 1));
}

function currentMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
}

function monthLabel(d: Date): string {
  const start = calendarMonthStart(d);
  const y = start.getUTCFullYear();
  const m = String(start.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function isExpired(row: TaskRow, now = new Date()): boolean {
  if (row.status === "DONE" || row.status === "CANCELLED") return false;
  if (!row.dueDate) return false;
  return row.dueDate.getTime() < now.getTime();
}

function serialize(row: TaskRow) {
  const monthStart = calendarMonthStart(row.month);
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
    monthLabel: monthLabel(row.month),
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
      // TL matrix always visible; active Commando matrix never returned.
      return {
        archivedAt: null,
        salesExecutiveProfileId: profile.id,
        OR: [
          { assignmentId: null },
          {
            assignment: {
              status: { in: ["COMPLETED", "EXITED"] },
            },
          },
        ],
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
    const assignmentStatus = row.assignment?.status ?? null;
    if (
      !salesExecutiveCanViewEisenhowerOwnership(
        row.assignmentId,
        assignmentStatus,
      )
    ) {
      throw forbidden(
        "Commando intervention priorities are not visible while the intervention is active",
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
    // Monthly planning stays with the Team Lead even during Commando intervention.
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(row.profile.teamId)) {
      throw forbidden("Profile is outside your team scope");
    }
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

type PersonRef = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
};

function personRef(u: {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
}): PersonRef {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
  };
}

function matrixMeta(tasks: ReturnType<typeof serialize>[]) {
  if (tasks.length === 0) {
    return {
      updatedAt: null as string | Date | null,
      updatedBy: null as PersonRef | null,
    };
  }
  const latest = tasks.reduce((a, b) =>
    new Date(a.updatedAt).getTime() >= new Date(b.updatedAt).getTime() ? a : b,
  );
  return {
    updatedAt: latest.updatedAt,
    updatedBy: personRef(latest.createdBy),
  };
}

async function assertCanViewEisenhowerProfile(
  actor: Actor,
  profileId: string,
): Promise<{ id: string; teamId: string; userId: string }> {
  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: profileId, archivedAt: null },
    select: { id: true, teamId: true, userId: true },
  });
  if (!profile) throw notFound("Sales executive profile not found");

  if (isSuperAdmin(actor)) return profile;

  switch (actor.roleCode) {
    case "TEAM_LEAD": {
      const teamIds = await getActiveTeamIds(prisma, actor.id);
      if (!teamIds.includes(profile.teamId)) {
        throw forbidden("Profile is outside your team scope");
      }
      return profile;
    }
    case "COMMANDO_EXECUTIVE": {
      const any = await prisma.commandoAssignment.findFirst({
        where: {
          salesExecutiveProfileId: profile.id,
          commandoUserId: actor.id,
        },
        select: { id: true },
      });
      if (!any) {
        throw forbidden("You do not have access to this profile");
      }
      return profile;
    }
    case "SALES_EXECUTIVE": {
      if (profile.userId !== actor.id) {
        throw forbidden("You may only view your own Eisenhower workspace");
      }
      return profile;
    }
    default:
      throw forbidden("Not allowed to access Eisenhower workspace");
  }
}

/**
 * SE-facing (and manager) workspace payload:
 * - Team Lead matrix (always for SE)
 * - Commando matrix (locked for SE while ACTIVE; contents never returned)
 * - Intervention history (completed/exited only for SE matrix access)
 */
export async function getEisenhowerWorkspace(
  actor: Actor,
  query: EisenhowerWorkspaceQuery,
) {
  await assertCanViewEisenhowerProfile(actor, query.profileId);
  const isSe = actor.roleCode === "SALES_EXECUTIVE";
  const lifecycle = await getCommandoLifecycleState(prisma, query.profileId);

  const assignments = await prisma.commandoAssignment.findMany({
    where: { salesExecutiveProfileId: query.profileId },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      commando: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      _count: { select: { eisenhowerTasks: true } },
    },
  });

  const numbered = assignments.map((a, index) => ({
    ...a,
    interventionNumber: index + 1,
  }));

  const activeAssignment =
    numbered.find((a) => a.status === "ACTIVE") ?? null;

  const scope = await scopeWhere(actor);

  const tlRows = await prisma.eisenhowerTask.findMany({
    where: {
      AND: [
        scope,
        { salesExecutiveProfileId: query.profileId },
        { assignmentId: null },
      ],
    },
    orderBy: [{ month: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
    include: taskInclude,
  });
  const teamLeadTasks = tlRows.map(serialize);
  const teamLeadMeta = matrixMeta(teamLeadTasks);

  let selectedAssignmentId = query.assignmentId ?? null;
  if (selectedAssignmentId) {
    const selected = numbered.find((a) => a.id === selectedAssignmentId);
    if (!selected) throw notFound("Intervention not found");
    // SE requesting ACTIVE assignment: do not throw — return LOCKED below
    // with no matrix contents.
  } else if (!isSe && activeAssignment) {
    selectedAssignmentId = activeAssignment.id;
  } else {
    const latestFinalized = [...numbered]
      .reverse()
      .find((a) => a.status === "COMPLETED" || a.status === "EXITED");
    if (latestFinalized) selectedAssignmentId = latestFinalized.id;
    else if (!isSe && activeAssignment) {
      selectedAssignmentId = activeAssignment.id;
    }
  }

  type CommandoState = "LOCKED" | "AVAILABLE" | "EMPTY";
  let commandoState: CommandoState = "EMPTY";
  let commandoTasks: ReturnType<typeof serialize>[] | null = null;
  let commandoAssignmentPayload: {
    id: string;
    interventionNumber: number;
    status: string;
    startedAt: Date;
    endedAt: Date | null;
    commando: PersonRef;
  } | null = null;
  let lockedMessage: string | null = null;

  const selectedForLock =
    selectedAssignmentId != null
      ? numbered.find((a) => a.id === selectedAssignmentId)
      : null;
  const shouldLockActiveForSe =
    isSe &&
    ((activeAssignment && !query.assignmentId) ||
      (selectedForLock?.status === "ACTIVE"));

  if (shouldLockActiveForSe) {
    const locked = selectedForLock?.status === "ACTIVE"
      ? selectedForLock
      : activeAssignment!;
    commandoState = "LOCKED";
    lockedMessage =
      "These intervention priorities are locked while your Commando is actively managing them. They become available when the intervention ends.";
    commandoAssignmentPayload = {
      id: locked.id,
      interventionNumber: locked.interventionNumber,
      status: locked.status,
      startedAt: locked.startedAt,
      endedAt: locked.endedAt,
      commando: personRef(locked.commando),
    };
    // Never return ACTIVE Commando task rows to the SE
    commandoTasks = null;
  } else if (selectedAssignmentId) {
    const selected = numbered.find((a) => a.id === selectedAssignmentId)!;
    const canReveal =
      !isSe ||
      selected.status === "COMPLETED" ||
      selected.status === "EXITED";

    if (!canReveal) {
      commandoState = "LOCKED";
      lockedMessage =
        "These intervention priorities are locked while your Commando is actively managing them. They become available when the intervention ends.";
      commandoAssignmentPayload = {
        id: selected.id,
        interventionNumber: selected.interventionNumber,
        status: selected.status,
        startedAt: selected.startedAt,
        endedAt: selected.endedAt,
        commando: personRef(selected.commando),
      };
      commandoTasks = null;
    } else {
      const rows = await prisma.eisenhowerTask.findMany({
        where: {
          AND: [
            scope,
            { salesExecutiveProfileId: query.profileId },
            { assignmentId: selected.id },
          ],
        },
        orderBy: [
          { month: "desc" },
          { updatedAt: "desc" },
          { createdAt: "desc" },
        ],
        include: taskInclude,
      });
      commandoTasks = rows.map(serialize);
      commandoState = rows.length > 0 ? "AVAILABLE" : "EMPTY";
      commandoAssignmentPayload = {
        id: selected.id,
        interventionNumber: selected.interventionNumber,
        status: selected.status,
        startedAt: selected.startedAt,
        endedAt: selected.endedAt,
        commando: personRef(selected.commando),
      };
    }
  }

  const commandoMeta = matrixMeta(commandoTasks ?? []);

  const interventionHistory = numbered
    .filter((a) => a.status === "COMPLETED" || a.status === "EXITED")
    .map((a) => ({
      assignmentId: a.id,
      interventionNumber: a.interventionNumber,
      status: a.status,
      startedAt: a.startedAt,
      endedAt: a.endedAt,
      commando: personRef(a.commando),
      taskCount: a._count.eisenhowerTasks,
      hasEisenhower: a._count.eisenhowerTasks > 0,
      canViewMatrix: true,
    }))
    .reverse();

  const activeIntervention = activeAssignment
    ? {
        id: activeAssignment.id,
        interventionNumber: activeAssignment.interventionNumber,
        status: activeAssignment.status,
        startedAt: activeAssignment.startedAt,
        endedAt: activeAssignment.endedAt,
        commando: personRef(activeAssignment.commando),
      }
    : null;

  /** Filter options for each Commando cycle (active + completed), newest first. */
  const commandoOptions = [...numbered]
    .reverse()
    .map((a) => {
      const name =
        `${a.commando.firstName} ${a.commando.lastName}`.trim() || "Commando";
      return {
        assignmentId: a.id,
        interventionNumber: a.interventionNumber,
        status: a.status,
        startedAt: a.startedAt,
        endedAt: a.endedAt,
        commando: personRef(a.commando),
        label: `${name} (Commando)`,
        lockedForViewer: isSe && a.status === "ACTIVE",
        hasEisenhower: a._count.eisenhowerTasks > 0,
        canViewMatrix: !(isSe && a.status === "ACTIVE"),
      };
    });

  const latestFocus:
    | "TEAM_LEAD"
    | "COMMANDO"
    | "TEAM_LEAD_WITH_LOCKED_COMMANDO" =
    isSe && activeAssignment
      ? "TEAM_LEAD_WITH_LOCKED_COMMANDO"
      : isSe && commandoState === "AVAILABLE"
        ? "COMMANDO"
        : actor.roleCode === "COMMANDO_EXECUTIVE" && activeAssignment
          ? "COMMANDO"
          : "TEAM_LEAD";

  return {
    profileId: query.profileId,
    lifecycle: {
      isDuringCommando: lifecycle.isDuringCommando,
      isAfterCommando: lifecycle.isAfterCommando,
      hasActiveAssignment: lifecycle.hasActiveAssignment,
      hasCompletedAssignment: lifecycle.hasCompletedAssignment,
    },
    latestFocus,
    activeIntervention,
    teamLead: {
      owner: "TEAM_LEAD" as const,
      label: "Team Lead Priorities",
      availability: "AVAILABLE" as const,
      tasks: teamLeadTasks,
      updatedAt: teamLeadMeta.updatedAt,
      updatedBy: teamLeadMeta.updatedBy,
    },
    commando: {
      owner: "COMMANDO" as const,
      label: "Commando Priorities",
      state: commandoState,
      lockedMessage,
      assignment: commandoAssignmentPayload,
      tasks: commandoTasks,
      updatedAt: commandoMeta.updatedAt,
      updatedBy: commandoMeta.updatedBy,
    },
    commandoOptions,
    interventionHistory,
  };
}
