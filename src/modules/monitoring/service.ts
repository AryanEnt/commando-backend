import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import {
  hasPermission,
  isSuperAdmin,
} from "../../lib/authorization.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import {
  getCommandoLifecycleState,
  salesExecutiveCanViewMonitoring,
} from "../../lib/lifecycleVisibility.js";
import { getActiveTeamIds } from "../../lib/scope.js";
import { assertTeamLeadOperationalWriteAllowed } from "../../lib/teamLeadLock.js";
import type {
  CreateChecklistItemInput,
  CreateMonitoringCategoryInput,
  CreateMonitoringRecordInput,
  ListMonitoringQuery,
  UpdateChecklistItemInput,
  UpdateMonitoringCategoryInput,
} from "./schemas.js";

const recordInclude = {
  profile: {
    select: { id: true, displayName: true, userId: true, teamId: true },
  },
  category: {
    select: { id: true, code: true, name: true },
  },
  createdBy: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: { select: { code: true } },
    },
  },
  assignment: {
    select: { id: true, status: true, startedAt: true, endedAt: true },
  },
  responses: {
    include: {
      checklistItem: {
        select: {
          id: true,
          code: true,
          label: true,
          sortOrder: true,
          categoryId: true,
        },
      },
    },
    orderBy: { checklistItem: { sortOrder: "asc" as const } },
  },
} satisfies Prisma.LiveMonitoringRecordInclude;

type RecordRow = Prisma.LiveMonitoringRecordGetPayload<{
  include: typeof recordInclude;
}>;

function serialize(row: RecordRow) {
  return {
    id: row.id,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    profile: row.profile,
    assignmentId: row.assignmentId,
    assignment: row.assignment,
    categoryId: row.categoryId,
    category: row.category,
    observation: row.observation,
    createdById: row.createdById,
    createdBy: row.createdBy,
    observedAt: row.observedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    responses: row.responses.map((r) => ({
      id: r.id,
      checklistItemId: r.checklistItemId,
      checklistItem: r.checklistItem,
      value: r.value,
      createdAt: r.createdAt,
    })),
  };
}

async function assignedProfileIds(commandoUserId: string): Promise<string[]> {
  const assignments = await prisma.commandoAssignment.findMany({
    where: { commandoUserId },
    select: { salesExecutiveProfileId: true },
  });
  return [...new Set(assignments.map((a) => a.salesExecutiveProfileId))];
}

async function scopeWhere(
  actor: Actor,
): Promise<Prisma.LiveMonitoringRecordWhereInput> {
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
    const profile = await prisma.salesExecutiveProfile.findFirst({
      where: { userId: actor.id, archivedAt: null },
      select: { id: true },
    });
    if (!profile) return { id: "__none__" };

    const lifecycle = await getCommandoLifecycleState(prisma, profile.id);
    if (!salesExecutiveCanViewMonitoring(lifecycle)) {
      return { id: "__none__" };
    }

    return {
      archivedAt: null,
      salesExecutiveProfileId: profile.id,
    };
  }

  return { id: "__none__" };
}

async function assertCanAccessRecord(
  actor: Actor,
  row: RecordRow,
): Promise<void> {
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
      throw forbidden("Monitoring record is outside your assignment scope");
    }
    return;
  }

  if (actor.roleCode === "SALES_EXECUTIVE") {
    if (row.profile.userId !== actor.id) {
      throw forbidden("You may only view your own monitoring history");
    }
    const lifecycle = await getCommandoLifecycleState(
      prisma,
      row.salesExecutiveProfileId,
    );
    if (!salesExecutiveCanViewMonitoring(lifecycle)) {
      throw forbidden(
        "Commando monitoring is not visible during an active assignment",
      );
    }
    return;
  }

  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(row.profile.teamId)) {
      throw forbidden("Monitoring record is outside your team scope");
    }
    return;
  }

  throw forbidden("Not allowed to access monitoring records");
}

export async function listMonitoringCategories(
  actor: Actor,
  includeInactive: boolean,
) {
  const canManage = hasPermission(
    actor,
    PERMISSIONS.MONITORING_CHECKLIST_MANAGE,
  );
  const where =
    canManage && includeInactive
      ? {}
      : { isActive: true, archivedAt: null };

  const categories = await prisma.monitoringCategory.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      checklistItems: {
        where:
          canManage && includeInactive
            ? {}
            : { isActive: true, archivedAt: null },
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      },
    },
  });

  return categories;
}

export async function createMonitoringCategory(
  actor: Actor,
  input: CreateMonitoringCategoryInput,
) {
  if (!hasPermission(actor, PERMISSIONS.MONITORING_CHECKLIST_MANAGE)) {
    throw forbidden("Not allowed to manage monitoring checklists");
  }

  const existing = await prisma.monitoringCategory.findUnique({
    where: { code: input.code },
  });
  if (existing) throw conflict("Monitoring category code already exists");

  const created = await prisma.monitoringCategory.create({
    data: {
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    },
    include: { checklistItems: true },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "MONITORING_CATEGORY_CREATED",
      entityType: "MonitoringCategory",
      entityId: created.id,
      metadata: { code: created.code },
    },
  });

  return created;
}

export async function updateMonitoringCategory(
  actor: Actor,
  id: string,
  input: UpdateMonitoringCategoryInput,
) {
  if (!hasPermission(actor, PERMISSIONS.MONITORING_CHECKLIST_MANAGE)) {
    throw forbidden("Not allowed to manage monitoring checklists");
  }

  const existing = await prisma.monitoringCategory.findUnique({ where: { id } });
  if (!existing) throw notFound("Monitoring category not found");

  const updated = await prisma.monitoringCategory.update({
    where: { id },
    data: {
      name: input.name,
      description: input.description,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      archivedAt:
        input.archivedAt === undefined ? undefined : input.archivedAt,
    },
    include: {
      checklistItems: { orderBy: { sortOrder: "asc" } },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "MONITORING_CATEGORY_UPDATED",
      entityType: "MonitoringCategory",
      entityId: updated.id,
      metadata: {
        isActive: updated.isActive,
        archivedAt: updated.archivedAt,
      },
    },
  });

  return updated;
}

export async function createChecklistItem(
  actor: Actor,
  categoryId: string,
  input: CreateChecklistItemInput,
) {
  if (!hasPermission(actor, PERMISSIONS.MONITORING_CHECKLIST_MANAGE)) {
    throw forbidden("Not allowed to manage monitoring checklists");
  }

  const category = await prisma.monitoringCategory.findFirst({
    where: { id: categoryId, archivedAt: null },
  });
  if (!category) throw notFound("Monitoring category not found");

  const existing = await prisma.monitoringChecklistItem.findUnique({
    where: {
      categoryId_code: { categoryId, code: input.code },
    },
  });
  if (existing) throw conflict("Checklist item code already exists in category");

  const created = await prisma.monitoringChecklistItem.create({
    data: {
      categoryId,
      code: input.code,
      label: input.label,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "MONITORING_CHECKLIST_ITEM_CREATED",
      entityType: "MonitoringChecklistItem",
      entityId: created.id,
      metadata: { categoryId, code: created.code },
    },
  });

  return created;
}

export async function updateChecklistItem(
  actor: Actor,
  id: string,
  input: UpdateChecklistItemInput,
) {
  if (!hasPermission(actor, PERMISSIONS.MONITORING_CHECKLIST_MANAGE)) {
    throw forbidden("Not allowed to manage monitoring checklists");
  }

  const existing = await prisma.monitoringChecklistItem.findUnique({
    where: { id },
  });
  if (!existing) throw notFound("Checklist item not found");

  const updated = await prisma.monitoringChecklistItem.update({
    where: { id },
    data: {
      label: input.label,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      archivedAt:
        input.archivedAt === undefined ? undefined : input.archivedAt,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "MONITORING_CHECKLIST_ITEM_UPDATED",
      entityType: "MonitoringChecklistItem",
      entityId: updated.id,
      metadata: {
        isActive: updated.isActive,
        archivedAt: updated.archivedAt,
      },
    },
  });

  return updated;
}

export async function listMonitoringRecords(
  actor: Actor,
  query: ListMonitoringQuery,
) {
  const scope = await scopeWhere(actor);

  const dateFilter: Prisma.LiveMonitoringRecordWhereInput = {};
  if (query.dateFrom || query.dateTo) {
    dateFilter.observedAt = {
      ...(query.dateFrom ? { gte: query.dateFrom } : {}),
      ...(query.dateTo ? { lte: query.dateTo } : {}),
    };
  }

  const where: Prisma.LiveMonitoringRecordWhereInput = {
    AND: [
      scope,
      ...(query.profileId
        ? [{ salesExecutiveProfileId: query.profileId }]
        : []),
      ...(query.categoryId ? [{ categoryId: query.categoryId }] : []),
      ...(Object.keys(dateFilter).length ? [dateFilter] : []),
      ...(query.search
        ? [
            {
              OR: [
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
                  category: {
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
    prisma.liveMonitoringRecord.count({ where }),
    prisma.liveMonitoringRecord.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { observedAt: "desc" },
      include: recordInclude,
    }),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    records: rows.map(serialize),
  };
}

export async function getMonitoringRecord(actor: Actor, id: string) {
  const row = await prisma.liveMonitoringRecord.findFirst({
    where: { id, archivedAt: null },
    include: recordInclude,
  });
  if (!row) throw notFound("Monitoring record not found");
  await assertCanAccessRecord(actor, row);
  return serialize(row);
}

export async function createMonitoringRecord(
  actor: Actor,
  input: CreateMonitoringRecordInput,
) {
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for live monitoring");
  }
  if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    actor.roleCode !== "TEAM_LEAD"
  ) {
    throw forbidden("Only Commandos and Team Leads can create live monitoring records");
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
      action: "MONITORING_CREATE",
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
        "You may only create monitoring for profiles with an active assignment to you",
      );
    }
    assignmentId = assignment.id;
  }

  const category = await prisma.monitoringCategory.findFirst({
    where: {
      id: input.categoryId,
      isActive: true,
      archivedAt: null,
    },
  });
  if (!category) {
    throw badRequest("Monitoring category is invalid or inactive");
  }

  const itemIds = [...new Set(input.responses.map((r) => r.checklistItemId))];
  if (itemIds.length !== input.responses.length) {
    throw badRequest("Duplicate checklist item responses are not allowed");
  }

  const items = await prisma.monitoringChecklistItem.findMany({
    where: {
      id: { in: itemIds },
      categoryId: category.id,
      isActive: true,
      archivedAt: null,
    },
  });
  if (items.length !== itemIds.length) {
    throw badRequest(
      "All checklist responses must reference active items in the selected category",
    );
  }

  const created = await prisma.liveMonitoringRecord.create({
    data: {
      salesExecutiveProfileId: profile.id,
      assignmentId,
      categoryId: category.id,
      observation: input.observation?.trim()
        ? input.observation.trim()
        : null,
      createdById: actor.id,
      observedAt: input.observedAt ?? new Date(),
      responses: {
        create: input.responses.map((r) => ({
          checklistItemId: r.checklistItemId,
          value: r.value,
        })),
      },
    },
    include: recordInclude,
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "MONITORING_RECORD_CREATED",
      entityType: "LiveMonitoringRecord",
      entityId: created.id,
      metadata: {
        profileId: profile.id,
        categoryId: category.id,
        assignmentId,
        responseCount: input.responses.length,
      },
    },
  });

  return serialize(created);
}
