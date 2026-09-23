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
import {
  assertCanManageSupportUser,
  assertCanViewSupportUser,
  supportUserIdsOnTeams,
  teamIdsForCommandoActive,
} from "../../lib/supportScope.js";
import { assertTeamLeadOperationalWriteAllowed } from "../../lib/teamLeadLock.js";
import { recordWorkspaceEvent } from "../../lib/workspaceEvents.js";
import type {
  AddSeChecklistItemInput,
  CreateChecklistItemInput,
  CreateMonitoringCategoryInput,
  CreateMonitoringRecordInput,
  ListMonitoringQuery,
  RemoveSeTemplateItemInput,
  SaveSeChecklistWeightsInput,
  UpdateChecklistItemInput,
  UpdateMonitoringCategoryInput,
} from "./schemas.js";
import {
  allocationStatus,
  computeWeightedScore,
  sumWeights,
} from "./scoring.js";

type ChecklistSubject =
  | { kind: "profile"; profileId: string }
  | { kind: "executive"; executiveUserId: string };

function checklistSubjectWhere(subject: ChecklistSubject) {
  return subject.kind === "profile"
    ? { salesExecutiveProfileId: subject.profileId }
    : { executiveUserId: subject.executiveUserId };
}

function checklistSubjectCreate(subject: ChecklistSubject) {
  return subject.kind === "profile"
    ? {
        salesExecutiveProfileId: subject.profileId,
        executiveUserId: null as string | null,
      }
    : {
        salesExecutiveProfileId: null as string | null,
        executiveUserId: subject.executiveUserId,
      };
}

function checklistSubjectMeta(subject: ChecklistSubject) {
  return subject.kind === "profile"
    ? { profileId: subject.profileId }
    : { executiveUserId: subject.executiveUserId };
}

function checklistSubjectEntityId(subject: ChecklistSubject) {
  return subject.kind === "profile"
    ? subject.profileId
    : subject.executiveUserId;
}

function checklistSubjectEntityType(subject: ChecklistSubject) {
  return subject.kind === "profile" ? "SalesExecutiveProfile" : "User";
}

const recordInclude = {
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
  weight: number;
  weightSource: "TEMPLATE_DEFAULT" | "SE_OVERRIDE" | "SE_CUSTOM";
};

function serialize(row: RecordRow) {
  return {
    id: row.id,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    executiveUserId: row.executiveUserId,
    profile: row.profile,
    executiveUser: row.executiveUser,
    assignmentId: row.assignmentId,
    assignment: row.assignment,
    categoryId: row.categoryId,
    category: row.category,
    observation: row.observation,
    scorePercent: row.scorePercent,
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
      weightSnapshot: r.weightSnapshot,
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
    const teamIds = await teamIdsForCommandoActive(prisma, actor.id);
    const supportIds = await supportUserIdsOnTeams(prisma, teamIds);
    return {
      archivedAt: null,
      OR: [
        { createdById: actor.id },
        { salesExecutiveProfileId: { in: profileIds } },
        ...(supportIds.length
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
        ...(supportIds.length
          ? [{ executiveUserId: { in: supportIds } }]
          : []),
      ],
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

  if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    return {
      archivedAt: null,
      executiveUserId: actor.id,
    };
  }

  return { id: "__none__" };
}

async function assertCanAccessRecord(
  actor: Actor,
  row: RecordRow,
): Promise<void> {
  if (isSuperAdmin(actor)) return;

  if (row.executiveUserId) {
    if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
      if (row.executiveUserId !== actor.id) {
        throw forbidden("You may only view your own monitoring history");
      }
      return;
    }
    if (
      actor.roleCode === "TEAM_LEAD" ||
      actor.roleCode === "COMMANDO_EXECUTIVE"
    ) {
      await assertCanViewSupportUser(prisma, actor, row.executiveUserId);
      return;
    }
    throw forbidden("Not allowed to access monitoring records");
  }

  if (!row.salesExecutiveProfileId || !row.profile) {
    throw forbidden("Not allowed to access monitoring records");
  }

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
        "Monitoring record is not visible for this Sales Executive",
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

async function assertCanCustomizeSupportChecklist(
  actor: Actor,
  executiveUserId: string,
) {
  if (isSuperAdmin(actor)) {
    throw forbidden(
      "Super Admin manages global checklists only; Support customization is not allowed",
    );
  }
  if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    actor.roleCode !== "TEAM_LEAD"
  ) {
    throw forbidden(
      "Only Commandos and Team Leads can customize Support monitoring checklists",
    );
  }
  return assertCanManageSupportUser(prisma, actor, executiveUserId);
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

async function actorCanCustomizeSupportChecklist(
  actor: Actor,
  executiveUserId: string,
): Promise<boolean> {
  if (isSuperAdmin(actor)) return false;
  if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    actor.roleCode !== "TEAM_LEAD"
  ) {
    return false;
  }
  try {
    await assertCanManageSupportUser(prisma, actor, executiveUserId);
    return true;
  } catch {
    return false;
  }
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
        "Monitoring record is not visible for this Sales Executive",
      );
    }
    return profile;
  }

  throw forbidden("Not allowed to view SE monitoring checklist");
}

async function assertCanViewSupportChecklist(
  actor: Actor,
  executiveUserId: string,
) {
  await assertCanViewSupportUser(prisma, actor, executiveUserId);
  return executiveUserId;
}

async function buildEffectiveChecklist(
  subject: ChecklistSubject,
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
  weightsConfigured: boolean;
  weightAllocation: ReturnType<typeof allocationStatus>;
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

  const subjectFilter = checklistSubjectWhere(subject);

  const [templateItems, seItems, weightOverrides] = await Promise.all([
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
        ...subjectFilter,
        categoryId: category.id,
        isActive: true,
        kind: { in: ["CUSTOM", "TEMPLATE_REMOVED"] },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.seMonitoringChecklistWeight.findMany({
      where: {
        ...subjectFilter,
        categoryId: category.id,
      },
    }),
  ]);

  const removedIds = new Set(
    seItems
      .filter(
        (i) => i.kind === "TEMPLATE_REMOVED" && i.sourceTemplateItemId != null,
      )
      .map((i) => i.sourceTemplateItemId as string),
  );

  const overrideByTemplateId = new Map(
    weightOverrides.map((w) => [w.sourceTemplateItemId, w.weight]),
  );
  const weightsConfigured = weightOverrides.length > 0;

  const templateEffective: EffectiveItem[] = templateItems
    .filter((t) => !removedIds.has(t.id))
    .map((t) => {
      const hasOverride = overrideByTemplateId.has(t.id);
      const weight = hasOverride
        ? (overrideByTemplateId.get(t.id) as number)
        : t.defaultWeight;
      return {
        id: t.id,
        checklistItemId: t.id,
        seChecklistItemId: null,
        label: t.label,
        description: null,
        code: t.code,
        sortOrder: t.sortOrder,
        sourceType: "TEMPLATE" as const,
        weight,
        weightSource: hasOverride
          ? ("SE_OVERRIDE" as const)
          : ("TEMPLATE_DEFAULT" as const),
      };
    });

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
      sourceType: "CUSTOM" as const,
      weight: c.weight,
      weightSource: "SE_CUSTOM" as const,
    }));

  const items = [...templateEffective, ...customEffective];
  const weightAllocation = allocationStatus(
    sumWeights(items.map((i) => i.weight)),
  );

  return {
    category,
    items,
    weightsConfigured,
    weightAllocation,
  };
}

export async function getEffectiveChecklist(
  actor: Actor,
  profileId: string,
  categoryId: string,
) {
  const profile = await assertCanViewSeChecklist(actor, profileId);
  const subject: ChecklistSubject = { kind: "profile", profileId: profile.id };
  const { category, items, weightsConfigured, weightAllocation } =
    await buildEffectiveChecklist(subject, categoryId);
  const canCustomize = await actorCanCustomizeSeChecklist(actor, profile);
  return {
    category,
    items,
    canCustomize,
    weightsConfigured,
    weightAllocation,
  };
}

export async function getEffectiveChecklistForExecutive(
  actor: Actor,
  executiveUserId: string,
  categoryId: string,
) {
  await assertCanViewSupportChecklist(actor, executiveUserId);
  const subject: ChecklistSubject = {
    kind: "executive",
    executiveUserId,
  };
  const { category, items, weightsConfigured, weightAllocation } =
    await buildEffectiveChecklist(subject, categoryId);
  const canCustomize = await actorCanCustomizeSupportChecklist(
    actor,
    executiveUserId,
  );
  return {
    category,
    items,
    canCustomize,
    weightsConfigured,
    weightAllocation,
  };
}

async function ensureSeWeightSnapshot(
  subject: ChecklistSubject,
  categoryId: string,
  actorId: string,
) {
  const existing = await prisma.seMonitoringChecklistWeight.count({
    where: { ...checklistSubjectWhere(subject), categoryId },
  });
  if (existing > 0) return;

  const { items } = await buildEffectiveChecklist(subject, categoryId);
  const templateItems = items.filter(
    (i) => i.sourceType === "TEMPLATE" && i.checklistItemId,
  );
  if (templateItems.length === 0) return;

  await prisma.$transaction(async (tx) => {
    for (const item of templateItems) {
      await tx.seMonitoringChecklistWeight.create({
        data: {
          ...checklistSubjectCreate(subject),
          categoryId,
          sourceTemplateItemId: item.checklistItemId as string,
          weight: item.weight,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId,
        action: "SE_MONITORING_CHECKLIST_WEIGHTS_SNAPSHOTTED",
        entityType: checklistSubjectEntityType(subject),
        entityId: checklistSubjectEntityId(subject),
        metadata: {
          ...checklistSubjectMeta(subject),
          categoryId,
          note: "Copied admin template default weights into subject-specific config",
          itemCount: templateItems.length,
        },
      },
    });
  });
}

async function addChecklistItemForSubject(
  actor: Actor,
  subject: ChecklistSubject,
  input: AddSeChecklistItemInput,
) {
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
        weight: 0,
        weightSource: "SE_CUSTOM" as const,
      },
      persisted: false as const,
    };
  }

  await ensureSeWeightSnapshot(subject, category.id, actor.id);

  const created = await prisma.seMonitoringChecklistItem.create({
    data: {
      ...checklistSubjectCreate(subject),
      categoryId: category.id,
      kind: "CUSTOM",
      label: input.label,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? 0,
      weight: 0,
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
        ...checklistSubjectMeta(subject),
        categoryId: category.id,
        label: created.label,
        kind: created.kind,
        weight: 0,
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
      weight: created.weight,
      weightSource: "SE_CUSTOM" as const,
    },
    persisted: true as const,
  };
}

export async function addSeChecklistItem(
  actor: Actor,
  profileId: string,
  input: AddSeChecklistItemInput,
) {
  await assertCanCustomizeSeChecklist(actor, profileId);
  return addChecklistItemForSubject(
    actor,
    { kind: "profile", profileId },
    input,
  );
}

export async function addSeChecklistItemForExecutive(
  actor: Actor,
  executiveUserId: string,
  input: AddSeChecklistItemInput,
) {
  await assertCanCustomizeSupportChecklist(actor, executiveUserId);
  return addChecklistItemForSubject(
    actor,
    { kind: "executive", executiveUserId },
    input,
  );
}

async function upsertWeightRow(
  tx: Prisma.TransactionClient,
  subject: ChecklistSubject,
  categoryId: string,
  checklistItemId: string,
  weight: number,
) {
  if (subject.kind === "profile") {
    await tx.seMonitoringChecklistWeight.upsert({
      where: {
        salesExecutiveProfileId_categoryId_sourceTemplateItemId: {
          salesExecutiveProfileId: subject.profileId,
          categoryId,
          sourceTemplateItemId: checklistItemId,
        },
      },
      create: {
        salesExecutiveProfileId: subject.profileId,
        executiveUserId: null,
        categoryId,
        sourceTemplateItemId: checklistItemId,
        weight,
      },
      update: { weight },
    });
    return;
  }
  await tx.seMonitoringChecklistWeight.upsert({
    where: {
      executiveUserId_categoryId_sourceTemplateItemId: {
        executiveUserId: subject.executiveUserId,
        categoryId,
        sourceTemplateItemId: checklistItemId,
      },
    },
    create: {
      salesExecutiveProfileId: null,
      executiveUserId: subject.executiveUserId,
      categoryId,
      sourceTemplateItemId: checklistItemId,
      weight,
    },
    update: { weight },
  });
}

async function saveChecklistWeightsForSubject(
  actor: Actor,
  subject: ChecklistSubject,
  input: SaveSeChecklistWeightsInput,
) {
  const category = await prisma.monitoringCategory.findFirst({
    where: {
      id: input.categoryId,
      isActive: true,
      archivedAt: null,
    },
    select: { id: true, name: true },
  });
  if (!category) {
    throw badRequest("Monitoring category is invalid or inactive");
  }

  await ensureSeWeightSnapshot(subject, category.id, actor.id);

  const { items: effectiveItems } = await buildEffectiveChecklist(
    subject,
    category.id,
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

  if (input.items.length !== effectiveItems.length) {
    throw badRequest(
      "Weight update must include every active checklist item for this category",
    );
  }

  const seen = new Set<string>();
  const changes: Array<{
    label: string;
    from: number;
    to: number;
  }> = [];

  for (const row of input.items) {
    if (row.checklistItemId) {
      const key = `t:${row.checklistItemId}`;
      if (seen.has(key)) {
        throw badRequest("Duplicate template item in weight update");
      }
      seen.add(key);
      const item = templateById.get(row.checklistItemId);
      if (!item) {
        throw badRequest(
          "Weight update references a template item that is not on this checklist",
        );
      }
      if (item.weight !== row.weight) {
        changes.push({ label: item.label, from: item.weight, to: row.weight });
      }
    } else if (row.seChecklistItemId) {
      const key = `c:${row.seChecklistItemId}`;
      if (seen.has(key)) {
        throw badRequest("Duplicate custom item in weight update");
      }
      seen.add(key);
      const item = customById.get(row.seChecklistItemId);
      if (!item) {
        throw badRequest(
          "Weight update references a custom item that is not on this checklist",
        );
      }
      if (item.weight !== row.weight) {
        changes.push({ label: item.label, from: item.weight, to: row.weight });
      }
    }
  }

  for (const item of effectiveItems) {
    const key =
      item.sourceType === "TEMPLATE"
        ? `t:${item.checklistItemId}`
        : `c:${item.seChecklistItemId}`;
    if (!seen.has(key)) {
      throw badRequest(
        `Missing weight for checklist item "${item.label}". Include every active item.`,
      );
    }
  }

  const total = sumWeights(input.items.map((i) => i.weight));
  const allocation = allocationStatus(total);
  if (!allocation.isComplete) {
    if (allocation.remaining > 0) {
      throw badRequest(
        `Active checklist weights must total 100%. Currently ${allocation.total}% — ${allocation.remaining}% remaining.`,
      );
    }
    throw badRequest(
      `Active checklist weights must total 100%. Currently ${allocation.total}% — ${allocation.over}% over allocation.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    for (const row of input.items) {
      if (row.checklistItemId) {
        await upsertWeightRow(
          tx,
          subject,
          category.id,
          row.checklistItemId,
          row.weight,
        );
      } else if (row.seChecklistItemId) {
        await tx.seMonitoringChecklistItem.update({
          where: { id: row.seChecklistItemId },
          data: { weight: row.weight },
        });
      }
    }

    const activeTemplateIds = effectiveItems
      .filter((i) => i.checklistItemId)
      .map((i) => i.checklistItemId as string);
    await tx.seMonitoringChecklistWeight.deleteMany({
      where: {
        ...checklistSubjectWhere(subject),
        categoryId: category.id,
        sourceTemplateItemId: { notIn: activeTemplateIds },
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "SE_MONITORING_CHECKLIST_WEIGHTS_UPDATED",
        entityType: checklistSubjectEntityType(subject),
        entityId: checklistSubjectEntityId(subject),
        metadata: {
          ...checklistSubjectMeta(subject),
          categoryId: category.id,
          categoryName: category.name,
          totalWeight: allocation.total,
          changes,
        },
      },
    });
  });

  if (subject.kind === "profile") {
    return getEffectiveChecklist(actor, subject.profileId, category.id);
  }
  return getEffectiveChecklistForExecutive(
    actor,
    subject.executiveUserId,
    category.id,
  );
}

export async function saveSeChecklistWeights(
  actor: Actor,
  profileId: string,
  input: SaveSeChecklistWeightsInput,
) {
  await assertCanCustomizeSeChecklist(actor, profileId);
  return saveChecklistWeightsForSubject(
    actor,
    { kind: "profile", profileId },
    input,
  );
}

export async function saveSeChecklistWeightsForExecutive(
  actor: Actor,
  executiveUserId: string,
  input: SaveSeChecklistWeightsInput,
) {
  await assertCanCustomizeSupportChecklist(actor, executiveUserId);
  return saveChecklistWeightsForSubject(
    actor,
    { kind: "executive", executiveUserId },
    input,
  );
}

async function removeChecklistItemForSubject(
  actor: Actor,
  subject: ChecklistSubject,
  itemId: string,
) {
  const item = await prisma.seMonitoringChecklistItem.findFirst({
    where: {
      id: itemId,
      ...checklistSubjectWhere(subject),
      kind: "CUSTOM",
      isActive: true,
    },
  });
  if (!item) {
    throw notFound("Custom checklist item not found");
  }

  await ensureSeWeightSnapshot(subject, item.categoryId, actor.id);

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
        ...checklistSubjectMeta(subject),
        categoryId: updated.categoryId,
        label: updated.label,
      },
    },
  });

  return updated;
}

export async function removeSeChecklistItem(
  actor: Actor,
  profileId: string,
  itemId: string,
) {
  await assertCanCustomizeSeChecklist(actor, profileId);
  return removeChecklistItemForSubject(
    actor,
    { kind: "profile", profileId },
    itemId,
  );
}

export async function removeSeChecklistItemForExecutive(
  actor: Actor,
  executiveUserId: string,
  itemId: string,
) {
  await assertCanCustomizeSupportChecklist(actor, executiveUserId);
  return removeChecklistItemForSubject(
    actor,
    { kind: "executive", executiveUserId },
    itemId,
  );
}

async function removeTemplateItemForSubject(
  actor: Actor,
  subject: ChecklistSubject,
  input: RemoveSeTemplateItemInput,
) {
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

  await ensureSeWeightSnapshot(subject, input.categoryId, actor.id);

  const subjectFilter = checklistSubjectWhere(subject);

  const activeRemoval = await prisma.seMonitoringChecklistItem.findFirst({
    where: {
      ...subjectFilter,
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
      ...subjectFilter,
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
          ...checklistSubjectCreate(subject),
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

  await prisma.seMonitoringChecklistWeight.deleteMany({
    where: {
      ...subjectFilter,
      categoryId: input.categoryId,
      sourceTemplateItemId: input.templateItemId,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "SE_MONITORING_TEMPLATE_ITEM_REMOVED",
      entityType: "SeMonitoringChecklistItem",
      entityId: row.id,
      metadata: {
        ...checklistSubjectMeta(subject),
        categoryId: input.categoryId,
        templateItemId: input.templateItemId,
        note: "Removed from subject checklist config; global template unchanged",
      },
    },
  });

  return row;
}

export async function removeTemplateItemFromSe(
  actor: Actor,
  profileId: string,
  input: RemoveSeTemplateItemInput,
) {
  await assertCanCustomizeSeChecklist(actor, profileId);
  return removeTemplateItemForSubject(
    actor,
    { kind: "profile", profileId },
    input,
  );
}

export async function removeTemplateItemFromExecutive(
  actor: Actor,
  executiveUserId: string,
  input: RemoveSeTemplateItemInput,
) {
  await assertCanCustomizeSupportChecklist(actor, executiveUserId);
  return removeTemplateItemForSubject(
    actor,
    { kind: "executive", executiveUserId },
    input,
  );
}

async function restoreTemplateItemForSubject(
  actor: Actor,
  subject: ChecklistSubject,
  input: RemoveSeTemplateItemInput,
) {
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
      ...checklistSubjectWhere(subject),
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
        ...checklistSubjectMeta(subject),
        categoryId: input.categoryId,
        templateItemId: input.templateItemId,
        deactivatedRemovals: result.count,
      },
    },
  });

  return { restored: result.count > 0, count: result.count };
}

export async function restoreTemplateItemForSe(
  actor: Actor,
  profileId: string,
  input: RemoveSeTemplateItemInput,
) {
  await assertCanCustomizeSeChecklist(actor, profileId);
  return restoreTemplateItemForSubject(
    actor,
    { kind: "profile", profileId },
    input,
  );
}

export async function restoreTemplateItemForExecutive(
  actor: Actor,
  executiveUserId: string,
  input: RemoveSeTemplateItemInput,
) {
  await assertCanCustomizeSupportChecklist(actor, executiveUserId);
  return restoreTemplateItemForSubject(
    actor,
    { kind: "executive", executiveUserId },
    input,
  );
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

/**
 * Permanently delete a category unused by monitoring sessions.
 * If sessions exist, soft-archive (deactivate) instead so history stays intact.
 */
export async function deleteMonitoringCategory(actor: Actor, id: string) {
  if (!hasPermission(actor, PERMISSIONS.MONITORING_CHECKLIST_MANAGE)) {
    throw forbidden("Not allowed to manage monitoring checklists");
  }

  const existing = await prisma.monitoringCategory.findUnique({
    where: { id },
  });
  if (!existing) throw notFound("Monitoring category not found");

  const sessionCount = await prisma.liveMonitoringRecord.count({
    where: { categoryId: id },
  });

  if (sessionCount > 0) {
    const updated = await prisma.monitoringCategory.update({
      where: { id },
      data: { isActive: false, archivedAt: new Date() },
      include: {
        checklistItems: { orderBy: { sortOrder: "asc" } },
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "MONITORING_CATEGORY_ARCHIVED",
        entityType: "MonitoringCategory",
        entityId: updated.id,
        metadata: { reason: "delete_requested_with_history", sessionCount },
      },
    });
    return {
      deleted: false as const,
      archived: true as const,
      category: updated,
      message: `This checklist was used in ${sessionCount} monitoring session(s), so it was deactivated instead of permanently deleted.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.seMonitoringChecklistWeight.deleteMany({
      where: { categoryId: id },
    });
    await tx.seMonitoringChecklistItem.deleteMany({
      where: { categoryId: id },
    });
    await tx.monitoringChecklistItem.deleteMany({
      where: { categoryId: id },
    });
    await tx.monitoringCategory.delete({ where: { id } });
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "MONITORING_CATEGORY_DELETED",
      entityType: "MonitoringCategory",
      entityId: id,
      metadata: { code: existing.code, name: existing.name },
    },
  });

  return {
    deleted: true as const,
    archived: false as const,
    category: null,
    message: "Checklist deleted",
  };
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
      defaultWeight: input.defaultWeight ?? 0,
      isActive: input.isActive ?? true,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "MONITORING_CHECKLIST_ITEM_CREATED",
      entityType: "MonitoringChecklistItem",
      entityId: created.id,
      metadata: {
        categoryId,
        code: created.code,
        defaultWeight: created.defaultWeight,
      },
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
      defaultWeight: input.defaultWeight,
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
        defaultWeight: updated.defaultWeight,
        previousDefaultWeight: existing.defaultWeight,
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
      ...(query.executiveUserId
        ? [{ executiveUserId: query.executiveUserId }]
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

  if (input.executiveUserId) {
    await assertCanManageSupportUser(prisma, actor, input.executiveUserId);
    const subject: ChecklistSubject = {
      kind: "executive",
      executiveUserId: input.executiveUserId,
    };

    if (!input.responses.length) {
      throw badRequest("At least one checklist response is required");
    }

    const {
      category,
      items: effectiveItems,
      weightAllocation,
    } = await buildEffectiveChecklist(subject, input.categoryId);

    if (!weightAllocation.isComplete) {
      if (weightAllocation.remaining > 0) {
        throw badRequest(
          `This Support checklist weights must total 100% before monitoring. Currently ${weightAllocation.total}% — ${weightAllocation.remaining}% remaining. Open Customize Checklist to allocate weights.`,
        );
      }
      throw badRequest(
        `This Support checklist weights must total 100% before monitoring. Currently ${weightAllocation.total}% — ${weightAllocation.over}% over allocation. Open Customize Checklist to fix weights.`,
      );
    }

    const responseCreates = buildResponseCreates(input, effectiveItems);

    const scored = computeWeightedScore(
      responseCreates.map((r) => ({
        value: r.value as string,
        weight: (r.weightSnapshot as number) ?? 0,
      })),
    );

    const created = await prisma.$transaction(async (tx) => {
      const record = await tx.liveMonitoringRecord.create({
        data: {
          salesExecutiveProfileId: null,
          executiveUserId: input.executiveUserId,
          assignmentId: null,
          categoryId: category.id,
          observation: input.observation?.trim()
            ? input.observation.trim()
            : null,
          scorePercent: scored.scorePercent,
          createdById: actor.id,
          observedAt: input.observedAt ?? new Date(),
          responses: {
            create: responseCreates,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "MONITORING_RECORD_CREATED",
          entityType: "LiveMonitoringRecord",
          entityId: record.id,
          metadata: {
            executiveUserId: input.executiveUserId,
            categoryId: category.id,
            assignmentId: null,
            responseCount: input.responses.length,
            supportInvolvementCount: 0,
            scorePercent: scored.scorePercent,
          },
        },
      });

      return tx.liveMonitoringRecord.findUniqueOrThrow({
        where: { id: record.id },
        include: recordInclude,
      });
    });

    // Support subjects have no SE profile — skip workspace dual-write.
    return serialize(created);
  }

  if (!input.salesExecutiveProfileId) {
    throw badRequest("Missing monitoring subject");
  }

  const profile = await loadProfileOrThrow(input.salesExecutiveProfileId);
  const subject: ChecklistSubject = {
    kind: "profile",
    profileId: profile.id,
  };

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

  const {
    category,
    items: effectiveItems,
    weightAllocation,
  } = await buildEffectiveChecklist(subject, input.categoryId);

  if (!weightAllocation.isComplete) {
    if (weightAllocation.remaining > 0) {
      throw badRequest(
        `This SE's checklist weights must total 100% before monitoring. Currently ${weightAllocation.total}% — ${weightAllocation.remaining}% remaining. Open Customize Checklist to allocate weights.`,
      );
    }
    throw badRequest(
      `This SE's checklist weights must total 100% before monitoring. Currently ${weightAllocation.total}% — ${weightAllocation.over}% over allocation. Open Customize Checklist to fix weights.`,
    );
  }

  const responseCreates = buildResponseCreates(input, effectiveItems);

  const scored = computeWeightedScore(
    responseCreates.map((r) => ({
      value: r.value as string,
      weight: (r.weightSnapshot as number) ?? 0,
    })),
  );

  const created = await prisma.$transaction(async (tx) => {
    const record = await tx.liveMonitoringRecord.create({
      data: {
        salesExecutiveProfileId: profile.id,
        executiveUserId: null,
        assignmentId,
        categoryId: category.id,
        observation: input.observation?.trim()
          ? input.observation.trim()
          : null,
        scorePercent: scored.scorePercent,
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
          scorePercent: scored.scorePercent,
        },
      },
    });

    return tx.liveMonitoringRecord.findUniqueOrThrow({
      where: { id: record.id },
      include: recordInclude,
    });
  });

  if (created.salesExecutiveProfileId) {
    await recordWorkspaceEvent({
      salesExecutiveProfileId: created.salesExecutiveProfileId,
      assignmentId: created.assignmentId,
      type: "MONITORING",
      title: `Monitoring · ${created.category?.name ?? "Session"}`,
      notes: created.observation,
      status: "COMPLETED",
      occurredAt: created.observedAt,
      sourceType: "LiveMonitoringRecord",
      sourceId: created.id,
      createdById: actor.id,
    });
  }

  return serialize(created);
}

function buildResponseCreates(
  input: CreateMonitoringRecordInput,
  effectiveItems: EffectiveItem[],
): Prisma.MonitoringChecklistResponseCreateWithoutRecordInput[] {
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

  return input.responses.map((r, index) => {
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
          "Checklist response references a template item that is inactive, removed for this subject, or not in the category",
        );
      }
      return {
        checklistItemId: item.checklistItemId,
        seChecklistItemId: null,
        labelSnapshot: item.label,
        descriptionSnapshot: item.description,
        codeSnapshot: item.code,
        sortOrderSnapshot: item.sortOrder,
        weightSnapshot: item.weight,
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
          "Checklist response references an inactive or unknown custom item for this category",
        );
      }
      return {
        checklistItemId: null,
        seChecklistItemId: item.seChecklistItemId,
        labelSnapshot: item.label,
        descriptionSnapshot: item.description,
        codeSnapshot: null,
        sortOrderSnapshot: item.sortOrder,
        weightSnapshot: item.weight,
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
      weightSnapshot: 0,
      sourceType: "SESSION",
      value: r.value,
    };
  });
}
