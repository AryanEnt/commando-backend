import type { Prisma, SupportTaskStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { hasPermission, isSuperAdmin } from "../../lib/authorization.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { AUDIT_ACTIONS, writeAuditLog } from "../../lib/audit.js";
import type {
  CreateSupportTaskInput,
  ListSupportTasksQuery,
  UpdateSupportTaskInput,
  UpdateSupportTaskStatusInput,
} from "./schemas.js";

const userBrief = {
  select: {
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    role: { select: { code: true } },
  },
} as const;

const taskInclude = {
  profile: {
    select: { id: true, displayName: true, userId: true, teamId: true },
  },
  salesSupportUser: userBrief,
  assignedBy: userBrief,
  createdBy: userBrief,
  assignment: {
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      commandoUserId: true,
      teamLeadUserId: true,
      teamId: true,
    },
  },
  salesSupportLink: {
    select: { id: true, isActive: true, startedAt: true, endedAt: true },
  },
} satisfies Prisma.SupportTaskInclude;

type TaskRow = Prisma.SupportTaskGetPayload<{ include: typeof taskInclude }>;

function isOverdue(
  dueDate: Date | null,
  status: SupportTaskStatus,
  now = new Date(),
): boolean {
  if (!dueDate || status === "COMPLETED") return false;
  return dueDate.getTime() < now.getTime();
}

function serialize(row: TaskRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    dueDate: row.dueDate,
    isOverdue: isOverdue(row.dueDate, row.status),
    completedAt: row.completedAt,
    completionNotes: row.completionNotes,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    profile: row.profile,
    salesSupportUserId: row.salesSupportUserId,
    salesSupportUser: row.salesSupportUser,
    assignedById: row.assignedById,
    assignedBy: row.assignedBy,
    createdById: row.createdById,
    createdBy: row.createdBy,
    assignmentId: row.assignmentId,
    assignment: row.assignment,
    salesSupportLinkId: row.salesSupportLinkId,
    salesSupportLink: row.salesSupportLink,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Hard scope: Sales Support Executive NEVER sees another assignee's tasks.
 * Query filters cannot widen this.
 */
async function scopeWhere(actor: Actor): Promise<Prisma.SupportTaskWhereInput> {
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
          { assignedById: actor.id },
          { salesExecutiveProfileId: { in: profileIds } },
          { assignment: { commandoUserId: actor.id } },
        ],
      };
    }
    case "SALES_SUPPORT_EXECUTIVE":
      return {
        archivedAt: null,
        salesSupportUserId: actor.id,
      };
    default:
      return { id: "__none__" };
  }
}

async function assertCanAccess(actor: Actor, row: TaskRow): Promise<void> {
  if (isSuperAdmin(actor)) return;

  if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    if (row.salesSupportUserId !== actor.id) {
      throw forbidden("You may only view tasks assigned to you");
    }
    return;
  }

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    if (row.createdById === actor.id || row.assignedById === actor.id) return;
    if (row.assignment?.commandoUserId === actor.id) return;
    const assigned = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: row.salesExecutiveProfileId,
        commandoUserId: actor.id,
      },
      select: { id: true },
    });
    if (!assigned) {
      throw forbidden("Support task is outside your assignment scope");
    }
    return;
  }

  throw forbidden("Not allowed to access support tasks");
}

function viewWhere(
  query: ListSupportTasksQuery,
): Prisma.SupportTaskWhereInput {
  const now = new Date();
  const filter = query.filter;
  const view = filter ?? query.view;

  if (view === "history" || view === "historical" || view === "completed") {
    return { status: "COMPLETED" };
  }
  if (view === "overdue") {
    return {
      status: { in: ["PENDING", "IN_PROGRESS"] },
      dueDate: { lt: now },
    };
  }
  if (view === "active") {
    return { status: { in: ["PENDING", "IN_PROGRESS"] } };
  }
  return {};
}

export async function listSupportTasks(
  actor: Actor,
  query: ListSupportTasksQuery,
) {
  const scope = await scopeWhere(actor);

  // Sales Support cannot widen scope via salesSupportUserId filter.
  let assigneeFilter: Prisma.SupportTaskWhereInput | undefined;
  if (query.salesSupportUserId) {
    if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
      if (query.salesSupportUserId !== actor.id) {
        return {
          page: query.page,
          pageSize: query.pageSize,
          total: 0,
          tasks: [] as ReturnType<typeof serialize>[],
        };
      }
      assigneeFilter = { salesSupportUserId: actor.id };
    } else {
      assigneeFilter = { salesSupportUserId: query.salesSupportUserId };
    }
  }

  const where: Prisma.SupportTaskWhereInput = {
    AND: [
      scope,
      viewWhere(query),
      ...(query.status ? [{ status: query.status }] : []),
      ...(query.priority ? [{ priority: query.priority }] : []),
      ...(query.profileId
        ? [{ salesExecutiveProfileId: query.profileId }]
        : []),
      ...(assigneeFilter ? [assigneeFilter] : []),
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
                  description: {
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
    prisma.supportTask.count({ where }),
    prisma.supportTask.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      include: taskInclude,
    }),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    tasks: rows.map(serialize),
  };
}

export async function getSupportTask(actor: Actor, id: string) {
  const row = await prisma.supportTask.findFirst({
    where: { id, archivedAt: null },
    include: taskInclude,
  });
  if (!row) throw notFound("Support task not found");
  await assertCanAccess(actor, row);
  return serialize(row);
}

export async function createSupportTask(
  actor: Actor,
  input: CreateSupportTaskInput,
) {
  if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    throw forbidden("Sales Support Executives cannot create Commando tasks");
  }
  if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    !isSuperAdmin(actor)
  ) {
    throw forbidden("Only Commandos can create support tasks");
  }

  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: input.salesExecutiveProfileId, archivedAt: null },
  });
  if (!profile) throw notFound("Sales executive profile not found");

  const supportUser = await prisma.user.findFirst({
    where: {
      id: input.salesSupportUserId,
      deletedAt: null,
      isActive: true,
      role: { code: "SALES_SUPPORT_EXECUTIVE" },
    },
  });
  if (!supportUser) {
    throw badRequest("Assignee must be an active Sales Support Executive");
  }

  let assignmentId: string | null;
  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    const assignment = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: input.salesExecutiveProfileId,
        commandoUserId: actor.id,
        status: "ACTIVE",
      },
    });
    if (!assignment) {
      throw forbidden("No active Commando assignment for this profile");
    }
    assignmentId = assignment.id;
  } else {
    const assignment = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: input.salesExecutiveProfileId,
        status: "ACTIVE",
      },
      orderBy: { startedAt: "desc" },
    });
    assignmentId = assignment?.id ?? null;
  }

  const link = await prisma.salesSupportLink.findFirst({
    where: {
      salesExecutiveProfileId: input.salesExecutiveProfileId,
      salesSupportUserId: input.salesSupportUserId,
      isActive: true,
      endedAt: null,
    },
  });
  if (!link) {
    throw badRequest(
      "No active Sales Support link between this profile and assignee",
    );
  }

  const created = await prisma.supportTask.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      priority: input.priority,
      dueDate: input.dueDate ?? null,
      salesExecutiveProfileId: input.salesExecutiveProfileId,
      salesSupportUserId: input.salesSupportUserId,
      assignedById: actor.id,
      createdById: actor.id,
      assignmentId,
      salesSupportLinkId: link.id,
      status: "PENDING",
    },
    include: taskInclude,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: AUDIT_ACTIONS.SUPPORT_TASK_CREATED,
    entityType: "SupportTask",
    entityId: created.id,
    metadata: {
      salesSupportUserId: created.salesSupportUserId,
      salesExecutiveProfileId: created.salesExecutiveProfileId,
      priority: created.priority,
    },
  });

  return serialize(created);
}

export async function updateSupportTask(
  actor: Actor,
  id: string,
  input: UpdateSupportTaskInput,
) {
  const row = await prisma.supportTask.findFirst({
    where: { id, archivedAt: null },
    include: taskInclude,
  });
  if (!row) throw notFound("Support task not found");
  await assertCanAccess(actor, row);

  if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    throw forbidden(
      "Sales Support cannot edit task definitions; use status update instead",
    );
  }

  if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    !isSuperAdmin(actor)
  ) {
    throw forbidden("Not allowed to update support tasks");
  }

  if (
    actor.roleCode === "COMMANDO_EXECUTIVE" &&
    !hasPermission(actor, PERMISSIONS.SALES_SUPPORT_TASK_UPDATE)
  ) {
    throw forbidden("Missing permission to update support tasks");
  }

  const nextAssignee = input.salesSupportUserId;
  let nextLinkId = row.salesSupportLinkId;

  if (nextAssignee && nextAssignee !== row.salesSupportUserId) {
    const supportUser = await prisma.user.findFirst({
      where: {
        id: nextAssignee,
        deletedAt: null,
        isActive: true,
        role: { code: "SALES_SUPPORT_EXECUTIVE" },
      },
    });
    if (!supportUser) {
      throw badRequest("Assignee must be an active Sales Support Executive");
    }
    const link = await prisma.salesSupportLink.findFirst({
      where: {
        salesExecutiveProfileId: row.salesExecutiveProfileId,
        salesSupportUserId: nextAssignee,
        isActive: true,
        endedAt: null,
      },
    });
    if (!link) {
      throw badRequest(
        "No active Sales Support link between this profile and new assignee",
      );
    }
    nextLinkId = link.id;
  }

  const nextStatus = input.status ?? row.status;
  const completing =
    nextStatus === "COMPLETED" && row.status !== "COMPLETED";
  const reopening =
    nextStatus !== "COMPLETED" && row.status === "COMPLETED";

  const updated = await prisma.supportTask.update({
    where: { id: row.id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(nextAssignee ? { salesSupportUserId: nextAssignee } : {}),
      ...(nextLinkId !== undefined ? { salesSupportLinkId: nextLinkId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.completionNotes !== undefined
        ? { completionNotes: input.completionNotes }
        : {}),
      ...(completing ? { completedAt: new Date() } : {}),
      ...(reopening ? { completedAt: null } : {}),
    },
    include: taskInclude,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: AUDIT_ACTIONS.SUPPORT_TASK_UPDATED,
    entityType: "SupportTask",
    entityId: updated.id,
    metadata: { fields: Object.keys(input) },
  });

  return serialize(updated);
}

export async function updateSupportTaskStatus(
  actor: Actor,
  id: string,
  input: UpdateSupportTaskStatusInput,
) {
  const row = await prisma.supportTask.findFirst({
    where: { id, archivedAt: null },
    include: taskInclude,
  });
  if (!row) throw notFound("Support task not found");
  await assertCanAccess(actor, row);

  if (!hasPermission(actor, PERMISSIONS.SALES_SUPPORT_TASK_STATUS_UPDATE)) {
    throw forbidden("Missing permission to update support task status");
  }

  if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    if (row.salesSupportUserId !== actor.id) {
      throw forbidden("You may only update status on tasks assigned to you");
    }
  }

  const completing =
    input.status === "COMPLETED" && row.status !== "COMPLETED";
  const reopening =
    input.status !== "COMPLETED" && row.status === "COMPLETED";

  const updated = await prisma.supportTask.update({
    where: { id: row.id },
    data: {
      status: input.status,
      ...(input.completionNotes !== undefined
        ? { completionNotes: input.completionNotes }
        : {}),
      ...(completing ? { completedAt: new Date() } : {}),
      ...(reopening ? { completedAt: null } : {}),
    },
    include: taskInclude,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: AUDIT_ACTIONS.SUPPORT_TASK_STATUS_UPDATED,
    entityType: "SupportTask",
    entityId: updated.id,
    metadata: {
      from: row.status,
      to: updated.status,
    },
  });

  return serialize(updated);
}
