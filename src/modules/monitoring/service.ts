import { randomUUID } from "node:crypto";
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
  AddSeChecklistItemInput,
  CreateChecklistItemInput,
  CreateMonitoringCategoryInput,
  CreateMonitoringRecordInput,
  ListMonitoringQuery,
  RemoveSeTemplateItemInput,
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
      seChecklistItem: {
        select: {
          id: true,
          label: true,
          description: true,
          sortOrder: true,
          kind: true,
        },
      },
    },
    orderBy: { sortOrderSnapshot: "asc" as const },
  },
  supportInvolvements: {
    include: {
      salesSupportUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.LiveMonitoringRecordInclude;

type RecordRow = Prisma.LiveMonitoringRecordGetPayload<{
  include: typeof recordInclude;
}>;

type EffectiveItem = {
  id: string;
  checklistItemId: string | null;
  seChecklistItemId: string | null;
  label: string;
  description: string | null;
  code: string | null;
  sortOrder: number;
  sourceType: "TEMPLATE" | "CUSTOM";
};

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
      seChecklistItemId: r.seChecklistItemId,
      labelSnapshot: r.labelSnapshot,
      descriptionSnapshot: r.descriptionSnapshot,
      codeSnapshot: r.codeSnapshot,
      sortOrderSnapshot: r.sortOrderSnapshot,
      sourceType: r.sourceType,
      checklistItem: {
        id: r.checklistItemId ?? r.seChecklistItemId ?? r.id,
        code: r.codeSnapshot ?? "",
        label: r.labelSnapshot,
        sortOrder: r.sortOrderSnapshot,
        categoryId: row.categoryId,
      },
      value: r.value,
      createdAt: r.createdAt,
      isCustom: r.sourceType === "CUSTOM" || r.sourceType === "SESSION",
    })),
    supportInvolvements: row.supportInvolvements.map((s) => ({
      id: s.id,
      salesSupportUserId: s.salesSupportUserId,
      salesSupportLinkId: s.salesSupportLinkId,
      displayNameSnapshot: s.displayNameSnapshot,
      responsibilityTypeSnapshot: s.responsibilityTypeSnapshot,
      salesSupportUser: s.salesSupportUser,
      createdAt: s.createdAt,
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

async function loadProfileOrThrow(profileId: string) {
  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: profileId, archivedAt: null },
  });
  if (!profile) throw notFound("Sales executive profile not found");
  return profile;
}

/** Same write scope as createMonitoringRecord (Commando ACTIVE / TL team + lock). */
export async function assertCanCustomizeSeChecklist(
  actor: Actor,
  profileId: string,
) {
  if (isSuperAdmin(actor)) {
    throw forbidden(
      "Super Admin manages global checklists only; SE customization is not allowed",
    );
  }
  if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    actor.roleCode !== "TEAM_LEAD"
  ) {
    throw forbidden(
      "Only Commandos and Team Leads can customize SE monitoring checklists",
    );
  }

  const profile = await loadProfileOrThrow(profileId);

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
      select: { id: true },
    });
    if (!assignment) {
      throw forbidden(
        "You may only customize checklists for profiles with an active assignment to you",
      );
    }
  }

  return profile;
}

async function actorCanCustomizeSeChecklist(
  actor: Actor,
  profile: { id: string; teamId: string },
): Promise<boolean> {
  if (isSuperAdmin(actor)) return false;
  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    const assignment = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: profile.id,
        commandoUserId: actor.id,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    return Boolean(assignment);
  }
  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(profile.teamId)) return false;
    try {
      await assertTeamLeadOperationalWriteAllowed(prisma, actor, profile.id, {
        action: "MONITORING_CREATE",
      });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

async function assertCanViewSeChecklist(actor: Actor, profileId: string) {
  const profile = await loadProfileOrThrow(profileId);

  if (isSuperAdmin(actor)) return profile;

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    const assigned = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: profile.id,
        commandoUserId: actor.id,
      },
      select: { id: true },
    });
    if (!assigned) {
      throw forbidden("Profile is outside your assignment scope");
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

  if (actor.roleCode === "SALES_EXECUTIVE") {
    if (profile.userId !== actor.id) {
      throw forbidden("You may only view your own monitoring checklist");
    }
    const lifecycle = await getCommandoLifecycleState(prisma, profile.id);
    if (!salesExecutiveCanViewMonitoring(lifecycle)) {
      throw forbidden(
        "Commando monitoring is not visible during an active assignment",
      );
    }
    return profile;
  }

  throw forbidden("Not allowed to view SE monitoring checklist");
}

async function buildEffectiveChecklist(
  profileId: string,
  categoryId: string,
): Promise<{
  category: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    sortOrder: number;
  };
  items: EffectiveItem[];
}> {
  const category = await prisma.monitoringCategory.findFirst({
    where: {
      id: categoryId,
      isActive: true,
      archivedAt: null,
    },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      sortOrder: true,
    },
  });
  if (!category) {
    throw badRequest("Monitoring category is invalid or inactive");
  }

  const [templateItems, seItems] = await Promise.all([
    prisma.monitoringChecklistItem.findMany({
      where: {
        categoryId: category.id,
        isActive: true,
        archivedAt: null,
      },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
    prisma.seMonitoringChecklistItem.findMany({
      where: {
        salesExecutiveProfileId: profileId,
        categoryId: category.id,
        isActive: true,
        kind: { in: ["CUSTOM", "TEMPLATE_REMOVED"] },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const removedIds = new Set(
    seItems
      .filter(
        (i) => i.kind === "TEMPLATE_REMOVED" && i.sourceTemplateItemId != null,
      )
      .map((i) => i.sourceTemplateItemId as string),
  );

  const templateEffective: EffectiveItem[] = templateItems
    .filter((t) => !removedIds.has(t.id))
    .map((t) => ({
      id: t.id,
      checklistItemId: t.id,
      seChecklistItemId: null,
      label: t.label,
      description: null,
      code: t.code,
      sortOrder: t.sortOrder,
      sourceType: "TEMPLATE",
    }));

  const customEffective: EffectiveItem[] = seItems
    .filter((i) => i.kind === "CUSTOM")
    .map((c) => ({
      id: c.id,
      checklistItemId: null,
      seChecklistItemId: c.id,
      label: c.label ?? "",
      description: c.description,
      code: null,
      sortOrder: c.sortOrder,
      sourceType: "CUSTOM",
    }));

  return {
    category,
    items: [...templateEffective, ...customEffective],
  };
}

export async function getEffectiveChecklist(
  actor: Actor,
  profileId: string,
  categoryId: string,
) {
  const profile = await assertCanViewSeChecklist(actor, profileId);
  const { category, items } = await buildEffectiveChecklist(
    profile.id,
    categoryId,
  );
  const canCustomize = await actorCanCustomizeSeChecklist(actor, profile);
  return { category, items, canCustomize };
}

export async function addSeChecklistItem(
  actor: Actor,
  profileId: string,
  input: AddSeChecklistItemInput,
) {
  await assertCanCustomizeSeChecklist(actor, profileId);

  const category = await prisma.monitoringCategory.findFirst({
    where: {
      id: input.categoryId,
      isActive: true,
      archivedAt: null,
    },
    select: { id: true },
  });
  if (!category) {
    throw badRequest("Monitoring category is invalid or inactive");
  }

  if (input.scope === "SESSION") {
    const sortOrder = input.sortOrder ?? 0;
    return {
      item: {
        id: randomUUID(),
        checklistItemId: null,
        seChecklistItemId: null,
        label: input.label,
        description: input.description ?? null,
        code: null,
        sortOrder,
        sourceType: "SESSION" as const,
      },
      persisted: false as const,
    };
  }

  const created = await prisma.seMonitoringChecklistItem.create({
    data: {
      salesExecutiveProfileId: profileId,
      categoryId: category.id,
      kind: "CUSTOM",
      label: input.label,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? 0,
      isActive: true,
      createdById: actor.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "SE_MONITORING_CHECKLIST_ITEM_ADDED",
      entityType: "SeMonitoringChecklistItem",
      entityId: created.id,
      metadata: {
        profileId,
        categoryId: category.id,
        label: created.label,
        kind: created.kind,
      },
    },
  });

  return {
    item: {
      id: created.id,
      checklistItemId: null,
      seChecklistItemId: created.id,
      label: created.label ?? input.label,
      description: created.description,
      code: null,
      sortOrder: created.sortOrder,
      sourceType: "CUSTOM" as const,
    },
    persisted: true as const,
  };
}

export async function removeSeChecklistItem(
  actor: Actor,
  profileId: string,
  itemId: string,
) {
  await assertCanCustomizeSeChecklist(actor, profileId);

  const item = await prisma.seMonitoringChecklistItem.findFirst({
    where: {
      id: itemId,
      salesExecutiveProfileId: profileId,
      kind: "CUSTOM",
      isActive: true,
    },
  });
  if (!item) {
    throw notFound("SE custom checklist item not found");
  }

  const updated = await prisma.seMonitoringChecklistItem.update({
    where: { id: item.id },
    data: { isActive: false },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "SE_MONITORING_CHECKLIST_ITEM_REMOVED",
      entityType: "SeMonitoringChecklistItem",
      entityId: updated.id,
      metadata: {
        profileId,
        categoryId: updated.categoryId,
        label: updated.label,
      },
    },
  });

  return updated;
}

export async function removeTemplateItemFromSe(
  actor: Actor,
  profileId: string,
  input: RemoveSeTemplateItemInput,
) {
  await assertCanCustomizeSeChecklist(actor, profileId);

  const templateItem = await prisma.monitoringChecklistItem.findFirst({
    where: {
      id: input.templateItemId,
      categoryId: input.categoryId,
      isActive: true,
      archivedAt: null,
    },
  });
  if (!templateItem) {
    throw badRequest(
      "Template checklist item is invalid or not in the selected category",
    );
  }

  const activeRemoval = await prisma.seMonitoringChecklistItem.findFirst({
    where: {
      salesExecutiveProfileId: profileId,
      categoryId: input.categoryId,
      kind: "TEMPLATE_REMOVED",
      sourceTemplateItemId: input.templateItemId,
      isActive: true,
    },
  });
  if (activeRemoval) {
    return activeRemoval;
  }

  const inactiveRemoval = await prisma.seMonitoringChecklistItem.findFirst({
    where: {
      salesExecutiveProfileId: profileId,
      categoryId: input.categoryId,
      kind: "TEMPLATE_REMOVED",
      sourceTemplateItemId: input.templateItemId,
      isActive: false,
    },
  });

  const row = inactiveRemoval
    ? await prisma.seMonitoringChecklistItem.update({
        where: { id: inactiveRemoval.id },
        data: { isActive: true },
      })
    : await prisma.seMonitoringChecklistItem.create({
        data: {
          salesExecutiveProfileId: profileId,
          categoryId: input.categoryId,
          kind: "TEMPLATE_REMOVED",
          sourceTemplateItemId: input.templateItemId,
          label: null,
          description: null,
          sortOrder: 0,
          isActive: true,
          createdById: actor.id,
        },
      });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "SE_MONITORING_TEMPLATE_ITEM_REMOVED",
      entityType: "SeMonitoringChecklistItem",
      entityId: row.id,
      metadata: {
        profileId,
        categoryId: input.categoryId,
        templateItemId: input.templateItemId,
        note: "Removed from SE checklist config; global template unchanged",
      },
    },
  });

  return row;
}

export async function restoreTemplateItemForSe(
  actor: Actor,
  profileId: string,
  input: RemoveSeTemplateItemInput,
) {
  await assertCanCustomizeSeChecklist(actor, profileId);

  const templateItem = await prisma.monitoringChecklistItem.findFirst({
    where: {
      id: input.templateItemId,
      categoryId: input.categoryId,
    },
    select: { id: true },
  });
  if (!templateItem) {
    throw badRequest(
      "Template checklist item is invalid or not in the selected category",
    );
  }

  const result = await prisma.seMonitoringChecklistItem.updateMany({
    where: {
      salesExecutiveProfileId: profileId,
      categoryId: input.categoryId,
      kind: "TEMPLATE_REMOVED",
      sourceTemplateItemId: input.templateItemId,
      isActive: true,
    },
    data: { isActive: false },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "SE_MONITORING_TEMPLATE_ITEM_RESTORED",
      entityType: "MonitoringChecklistItem",
      entityId: input.templateItemId,
      metadata: {
        profileId,
        categoryId: input.categoryId,
        templateItemId: input.templateItemId,
        deactivatedRemovals: result.count,
      },
    },
  });

  return { restored: result.count > 0, count: result.count };
}

export async function listMonitoringCategories(
  actor: Actor,
  query: {
    includeInactive?: boolean;
    search?: string;
    page: number;
    pageSize: number;
    catalog?: boolean;
  },
) {
  const canManage = hasPermission(
    actor,
    PERMISSIONS.MONITORING_CHECKLIST_MANAGE,
  );
  const includeInactive = Boolean(query.includeInactive && canManage);

  const where: Prisma.MonitoringCategoryWhereInput = {
    ...(includeInactive ? {} : { isActive: true, archivedAt: null }),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" } },
            { name: { contains: query.search, mode: "insensitive" } },
            { description: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const pageSize = query.catalog
    ? Math.min(query.pageSize || 100, 100)
    : query.pageSize;
  const page = query.catalog ? 1 : query.page;
  const skip = (page - 1) * pageSize;

  const [total, categories] = await Promise.all([
    prisma.monitoringCategory.count({ where }),
    prisma.monitoringCategory.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      skip,
      take: pageSize,
      include: {
        checklistItems: {
          where: includeInactive
            ? {}
            : { isActive: true, archivedAt: null },
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  return {
    categories,
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
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

  const profile = await loadProfileOrThrow(input.salesExecutiveProfileId);

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

  if (!input.responses.length) {
    throw badRequest("At least one checklist response is required");
  }

  const { category, items: effectiveItems } = await buildEffectiveChecklist(
    profile.id,
    input.categoryId,
  );

  const templateById = new Map(
    effectiveItems
      .filter((i) => i.sourceType === "TEMPLATE" && i.checklistItemId)
      .map((i) => [i.checklistItemId as string, i]),
  );
  const customById = new Map(
    effectiveItems
      .filter((i) => i.sourceType === "CUSTOM" && i.seChecklistItemId)
      .map((i) => [i.seChecklistItemId as string, i]),
  );

  const seenTemplate = new Set<string>();
  const seenCustom = new Set<string>();

  const responseCreates: Prisma.MonitoringChecklistResponseCreateWithoutRecordInput[] =
    input.responses.map((r, index) => {
      const inferred: "TEMPLATE" | "CUSTOM" | "SESSION" =
        r.sourceType ??
        (r.seChecklistItemId
          ? "CUSTOM"
          : r.checklistItemId
            ? "TEMPLATE"
            : "SESSION");

      if (inferred === "TEMPLATE") {
        if (!r.checklistItemId) {
          throw badRequest("Template responses require checklistItemId");
        }
        if (seenTemplate.has(r.checklistItemId)) {
          throw badRequest("Duplicate checklist item responses are not allowed");
        }
        seenTemplate.add(r.checklistItemId);
        const item = templateById.get(r.checklistItemId);
        if (!item) {
          throw badRequest(
            "Checklist response references a template item that is inactive, removed for this SE, or not in the category",
          );
        }
        return {
          checklistItemId: item.checklistItemId,
          seChecklistItemId: null,
          labelSnapshot: item.label,
          descriptionSnapshot: item.description,
          codeSnapshot: item.code,
          sortOrderSnapshot: item.sortOrder,
          sourceType: "TEMPLATE",
          value: r.value,
        };
      }

      if (inferred === "CUSTOM") {
        if (!r.seChecklistItemId) {
          throw badRequest("Custom responses require seChecklistItemId");
        }
        if (seenCustom.has(r.seChecklistItemId)) {
          throw badRequest("Duplicate checklist item responses are not allowed");
        }
        seenCustom.add(r.seChecklistItemId);
        const item = customById.get(r.seChecklistItemId);
        if (!item) {
          throw badRequest(
            "Checklist response references an inactive or unknown SE custom item for this category",
          );
        }
        return {
          checklistItemId: null,
          seChecklistItemId: item.seChecklistItemId,
          labelSnapshot: item.label,
          descriptionSnapshot: item.description,
          codeSnapshot: null,
          sortOrderSnapshot: item.sortOrder,
          sourceType: "CUSTOM",
          value: r.value,
        };
      }

      if (!r.label?.trim()) {
        throw badRequest("Session-only items require a label");
      }
      return {
        checklistItemId: null,
        seChecklistItemId: null,
        labelSnapshot: r.label.trim(),
        descriptionSnapshot: r.description?.trim()
          ? r.description.trim()
          : null,
        codeSnapshot: null,
        sortOrderSnapshot: r.sortOrder ?? index,
        sourceType: "SESSION",
        value: r.value,
      };
    });

  const created = await prisma.$transaction(async (tx) => {
    const record = await tx.liveMonitoringRecord.create({
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
          create: responseCreates,
        },
      },
    });

    const supportIds =
      input.supportInvolvement?.none === true
        ? []
        : [
            ...new Set(input.supportInvolvement?.salesSupportUserIds ?? []),
          ];

    if (supportIds.length > 0) {
      const activeLinks = await tx.salesSupportLink.findMany({
        where: {
          salesExecutiveProfileId: profile.id,
          salesSupportUserId: { in: supportIds },
          isActive: true,
        },
        include: {
          supportUser: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });
      const linkByUser = new Map(
        activeLinks.map((l) => [l.salesSupportUserId, l]),
      );

      for (const userId of supportIds) {
        const link = linkByUser.get(userId);
        if (!link) {
          throw badRequest(
            "Support involvement must reference a Sales Support user with an active link to this Sales Executive",
          );
        }
        await tx.monitoringSupportInvolvement.create({
          data: {
            recordId: record.id,
            salesSupportUserId: link.salesSupportUserId,
            salesSupportLinkId: link.id,
            displayNameSnapshot: `${link.supportUser.firstName} ${link.supportUser.lastName}`.trim(),
            responsibilityTypeSnapshot: link.responsibilityType,
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "MONITORING_RECORD_CREATED",
        entityType: "LiveMonitoringRecord",
        entityId: record.id,
        metadata: {
          profileId: profile.id,
          categoryId: category.id,
          assignmentId,
          responseCount: input.responses.length,
          supportInvolvementCount: supportIds.length,
        },
      },
    });

    return tx.liveMonitoringRecord.findUniqueOrThrow({
      where: { id: record.id },
      include: recordInclude,
    });
  });

  return serialize(created);
}
