import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog, AUDIT_ACTIONS } from "../../lib/audit.js";
import type { Actor } from "../../lib/authorization.js";
import { hasPermission, isSuperAdmin } from "../../lib/authorization.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { getActiveTeamIds } from "../../lib/scope.js";
import { assertTeamLeadOperationalWriteAllowed } from "../../lib/teamLeadLock.js";
import {
  getCommandoLifecycleState,
  salesExecutiveCanViewActionItemStatus,
} from "../../lib/lifecycleVisibility.js";
import { recordWorkspaceEvent } from "../../lib/workspaceEvents.js";
import { createPresignedGetUrl } from "../../lib/r2.js";
import {
  assertAllowedImageUpload,
  isOwnedActionItemImageKey,
} from "../uploads/schemas.js";
import type {
  AddActionItemAttachmentInput,
  CreateActionItemInput,
  ListActionItemsQuery,
  ReplaceActionItemInput,
  UpdateActionItemInput,
  UpdateActionItemSummaryInput,
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

const itemInclude = {
  profile: {
    select: { id: true, displayName: true, userId: true, teamId: true },
  },
  createdBy: userBrief,
  completedBy: userBrief,
  weeklyReview: {
    select: {
      id: true,
      weekLabel: true,
      weekStartDate: true,
      meetingDate: true,
      createdAt: true,
    },
  },
  assignment: {
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      commandoUserId: true,
    },
  },
  replaces: {
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      completedAt: true,
      expiredAt: true,
    },
  },
  replacedBy: {
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" as const },
    take: 5,
  },
};

type UserRef = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: { code: string };
};

/** Plain row type — avoids Prisma GetPayload `never` on optional relations. */
type ItemRow = {
  id: string;
  salesExecutiveProfileId: string;
  assignmentId: string | null;
  weeklyReviewId: string | null;
  title: string;
  description: string | null;
  summary: string | null;
  status: string;
  dueDate: Date | null;
  completedAt: Date | null;
  completedById: string | null;
  expiredAt: Date | null;
  replacesId: string | null;
  createdById: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  profile: {
    id: string;
    displayName: string;
    userId: string;
    teamId: string;
  };
  createdBy: UserRef;
  completedBy: UserRef | null;
  weeklyReview: {
    id: string;
    weekLabel: string;
    weekStartDate: Date;
    meetingDate: Date;
    createdAt: Date;
  } | null;
  assignment: {
    id: string;
    status: string;
    startedAt: Date;
    endedAt: Date | null;
    commandoUserId: string;
  } | null;
  replaces: {
    id: string;
    title: string;
    status: string;
    createdAt: Date;
    completedAt: Date | null;
    expiredAt: Date | null;
  } | null;
  replacedBy: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: Date;
  }>;
};

function asItemRow<T>(row: T): ItemRow {
  return row as unknown as ItemRow;
}

function asItemRows<T>(rows: T[]): ItemRow[] {
  return rows as unknown as ItemRow[];
}

type UserBrief = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
};

async function loadUsers(ids: string[]): Promise<Map<string, UserBrief>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u]));
}

function isHistoryStatus(status: string): boolean {
  return (
    status === "COMPLETED" ||
    status === "EXPIRED" ||
    status === "REPLACED" ||
    status === "CANCELLED"
  );
}

function serialize(row: ItemRow, extras: Map<string, UserBrief>) {
  const commando = row.assignment
    ? (extras.get(row.assignment.commandoUserId) ?? null)
    : extras.get(row.createdById) ??
      (row.createdBy
        ? {
            id: row.createdBy.id,
            firstName: row.createdBy.firstName,
            lastName: row.createdBy.lastName,
            email: row.createdBy.email,
          }
        : null);

  return {
    id: row.id,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    profile: row.profile,
    assignmentId: row.assignmentId,
    assignment: row.assignment
      ? {
          id: row.assignment.id,
          status: row.assignment.status,
          startedAt: row.assignment.startedAt,
          endedAt: row.assignment.endedAt,
        }
      : null,
    weeklyReviewId: row.weeklyReviewId,
    weeklyReview: row.weeklyReview,
    title: row.title,
    description: row.description,
    summary: row.summary,
    status: row.status,
    dueDate: row.dueDate,
    completedAt: row.completedAt,
    completedById: row.completedById,
    completedBy: row.completedBy,
    expiredAt: row.expiredAt,
    replacesId: row.replacesId,
    replaces: row.replaces,
    replacedBy: row.replacedBy,
    createdById: row.createdById,
    createdBy: row.createdBy,
    commando,
    isActive: row.status === "ACTIVE",
    isHistory: isHistoryStatus(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function serializeMany(rows: ItemRow[]) {
  const ids = rows.flatMap((r) =>
    r.assignment ? [r.assignment.commandoUserId] : [],
  );
  const extras = await loadUsers(ids);
  return rows.map((r) => serialize(r, extras));
}

async function scopeWhere(actor: Actor): Promise<Prisma.ActionItemWhereInput> {
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
          { assignment: { commandoUserId: actor.id } },
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
      return {
        archivedAt: null,
        salesExecutiveProfileId: profile.id,
      };
    }
    default:
      return { id: "__none__" };
  }
}

async function assertCanAccess(actor: Actor, row: ItemRow): Promise<void> {
  if (isSuperAdmin(actor)) return;

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    if (row.createdById === actor.id) return;
    if (row.assignment?.commandoUserId === actor.id) return;
    const assigned = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: row.salesExecutiveProfileId,
        commandoUserId: actor.id,
      },
      select: { id: true },
    });
    if (!assigned) {
      throw forbidden("Action item is outside your assignment scope");
    }
    return;
  }

  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(row.profile.teamId)) {
      throw forbidden("Action item is outside your team scope");
    }
    return;
  }

  if (actor.roleCode === "SALES_EXECUTIVE") {
    if (row.profile.userId !== actor.id) {
      throw forbidden("You may only view your own action items");
    }
    const lifecycle = await getCommandoLifecycleState(
      prisma,
      row.salesExecutiveProfileId,
    );
    if (!salesExecutiveCanViewActionItemStatus(row.status, lifecycle)) {
      throw forbidden("You may not view this assignment");
    }
    return;
  }

  throw forbidden("Not allowed to access action items");
}

async function assertCanManage(actor: Actor, row: ItemRow): Promise<void> {
  await assertCanAccess(actor, row);
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for action items");
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
      throw forbidden("No active assignment to manage this action item");
    }
    return;
  }
  if (actor.roleCode === "TEAM_LEAD") {
    await assertTeamLeadOperationalWriteAllowed(
      prisma,
      actor,
      row.salesExecutiveProfileId,
      { action: "ACTION_ITEM_UPDATE" },
    );
    return;
  }
  throw forbidden("Only Commandos and Team Leads can manage action items");
}

/** SE may mark their own ACTIVE assignments complete; coaches keep full lifecycle. */
async function assertCanComplete(actor: Actor, row: ItemRow): Promise<void> {
  if (actor.roleCode === "SALES_EXECUTIVE") {
    await assertCanAccess(actor, row);
    if (row.profile.userId !== actor.id) {
      throw forbidden("You may only complete your own assignments");
    }
    return;
  }
  await assertCanManage(actor, row);
}

export async function listActionItems(
  actor: Actor,
  query: ListActionItemsQuery,
) {
  const scope = await scopeWhere(actor);

  const viewFilter: Prisma.ActionItemWhereInput =
    query.status
      ? { status: query.status }
      : query.view === "active"
        ? { status: "ACTIVE" }
        : query.view === "history"
          ? {
              status: {
                in: ["COMPLETED", "EXPIRED", "REPLACED", "CANCELLED"],
              },
            }
          : {};

  const where: Prisma.ActionItemWhereInput = {
    AND: [
      scope,
      viewFilter,
      ...(query.profileId
        ? [{ salesExecutiveProfileId: query.profileId }]
        : []),
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
    prisma.actionItem.count({ where }),
    prisma.actionItem.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      include: itemInclude,
    }),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    view: query.view,
    actionItems: await serializeMany(asItemRows(rows)),
  };
}

export async function getActionItem(actor: Actor, id: string) {
  const row = await prisma.actionItem.findFirst({
    where: { id, archivedAt: null },
    include: itemInclude,
  });
  if (!row) throw notFound("Action item not found");
  await assertCanAccess(actor, asItemRow(row));

  // Walk previous chain for history context
  const previous: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: Date;
    completedAt: Date | null;
    expiredAt: Date | null;
  }> = [];
  let cursor = row.replacesId;
  let guard = 0;
  while (cursor && guard < 20) {
    const prev = await prisma.actionItem.findUnique({
      where: { id: cursor },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        completedAt: true,
        expiredAt: true,
        replacesId: true,
      },
    });
    if (!prev) break;
    previous.push({
      id: prev.id,
      title: prev.title,
      status: prev.status,
      createdAt: prev.createdAt,
      completedAt: prev.completedAt,
      expiredAt: prev.expiredAt,
    });
    cursor = prev.replacesId;
    guard += 1;
  }

  const typed = asItemRow(row);
  const extras = await loadUsers(
    typed.assignment ? [typed.assignment.commandoUserId] : [],
  );

  const attachments = await prisma.actionItemAttachment.findMany({
    where: { actionItemId: row.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      uploadedBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: { select: { code: true } },
        },
      },
    },
  });

  return {
    ...serialize(typed, extras),
    previousActions: previous,
    attachments: attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      caption: a.caption,
      createdAt: a.createdAt,
      uploadedBy: a.uploadedBy,
    })),
  };
}

export async function createActionItem(
  actor: Actor,
  input: CreateActionItemInput,
) {
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for action items");
  }
  if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    actor.roleCode !== "TEAM_LEAD"
  ) {
    throw forbidden("Only Commandos and Team Leads can create action items");
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
      action: "ACTION_ITEM_CREATE",
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
        "You may only create action items for profiles with an active assignment to you",
      );
    }
    assignmentId = assignment.id;
  }

  const created = await prisma.actionItem.create({
    data: {
      salesExecutiveProfileId: profile.id,
      assignmentId,
      title: input.title,
      description: input.description?.trim()
        ? input.description.trim()
        : null,
      dueDate: input.dueDate ?? null,
      status: "ACTIVE",
      createdById: actor.id,
    },
    include: itemInclude,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "ACTION_ITEM_CREATED",
    entityType: "ActionItem",
    entityId: created.id,
    metadata: { profileId: profile.id, assignmentId, verb: "CREATE" },
  });

  await recordWorkspaceEvent({
    salesExecutiveProfileId: profile.id,
    assignmentId,
    type: "ACTION",
    title: created.title,
    notes: created.description,
    status: "OPEN",
    urgency: "NOT_URGENT",
    importance: "IMPORTANT",
    sourceType: "ActionItem",
    sourceId: created.id,
    createdById: actor.id,
  });

  const typed = asItemRow(created);
  const extras = await loadUsers(
    typed.assignment ? [typed.assignment.commandoUserId] : [],
  );
  return serialize(typed, extras);
}

export async function updateActionItem(
  actor: Actor,
  id: string,
  input: UpdateActionItemInput,
) {
  const existing = await prisma.actionItem.findFirst({
    where: { id, archivedAt: null },
    include: itemInclude,
  });
  if (!existing) throw notFound("Action item not found");
  await assertCanManage(actor, asItemRow(existing));

  if (existing.status !== "ACTIVE") {
    throw badRequest("Only ACTIVE action items can be edited");
  }

  const updated = await prisma.actionItem.update({
    where: { id },
    data: {
      title: input.title,
      description:
        input.description === undefined
          ? undefined
          : input.description?.trim()
            ? input.description.trim()
            : null,
      summary:
        input.summary === undefined
          ? undefined
          : input.summary?.trim()
            ? input.summary.trim()
            : null,
      dueDate: input.dueDate === undefined ? undefined : input.dueDate,
    },
    include: itemInclude,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "ACTION_ITEM_UPDATED",
    entityType: "ActionItem",
    entityId: updated.id,
    metadata: { title: updated.title, verb: "UPDATE" },
  });

  const typed = asItemRow(updated);
  const extras = await loadUsers(
    typed.assignment ? [typed.assignment.commandoUserId] : [],
  );
  return serialize(typed, extras);
}

/** SE (own) or managers can set an optional summary without full edit rights. */
export async function updateActionItemSummary(
  actor: Actor,
  id: string,
  input: UpdateActionItemSummaryInput,
) {
  const existing = await prisma.actionItem.findFirst({
    where: { id, archivedAt: null },
    include: itemInclude,
  });
  if (!existing) throw notFound("Action item not found");
  const typed = asItemRow(existing);
  await assertCanAccess(actor, typed);

  if (typed.status !== "ACTIVE") {
    throw badRequest("Only ACTIVE assignments can update summary");
  }

  if (actor.roleCode === "SALES_EXECUTIVE") {
    if (typed.profile.userId !== actor.id) {
      throw forbidden("You may only update summary on your own assignments");
    }
  } else if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    actor.roleCode !== "TEAM_LEAD" &&
    !hasPermission(actor, PERMISSIONS.ACTION_ITEM_UPDATE) &&
    !isSuperAdmin(actor)
  ) {
    throw forbidden("Not allowed to update assignment summary");
  } else if (!isSuperAdmin(actor)) {
    await assertCanManage(actor, typed);
  }

  const summary =
    input.summary?.trim() ? input.summary.trim() : null;

  const updated = await prisma.actionItem.update({
    where: { id },
    // Explicit cast: generated Prisma client includes `summary` (see schema +
    // ActionItemUpdateInput). Assert so tooling with a stale client still typechecks.
    data: { summary } as Prisma.ActionItemUpdateInput,
    include: itemInclude,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "ACTION_ITEM_UPDATED",
    entityType: "ActionItem",
    entityId: updated.id,
    metadata: { verb: "SUMMARY_UPDATE" },
  });

  return getActionItem(actor, updated.id);
}

export async function completeActionItem(actor: Actor, id: string) {
  const existing = await prisma.actionItem.findFirst({
    where: { id, archivedAt: null },
    include: itemInclude,
  });
  if (!existing) throw notFound("Action item not found");
  await assertCanComplete(actor, asItemRow(existing));

  if (existing.status !== "ACTIVE") {
    throw badRequest("Only ACTIVE action items can be completed");
  }

  const updated = await prisma.actionItem.update({
    where: { id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      completedById: actor.id,
    },
    include: itemInclude,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "ACTION_ITEM_COMPLETED",
    entityType: "ActionItem",
    entityId: updated.id,
    metadata: { from: "ACTIVE", to: "COMPLETED", verb: "COMPLETE" },
  });

  await recordWorkspaceEvent({
    salesExecutiveProfileId: updated.salesExecutiveProfileId,
    assignmentId: updated.assignmentId,
    type: "ACTION",
    title: `Completed: ${updated.title}`,
    notes: updated.description,
    status: "COMPLETED",
    sourceType: "ActionItem",
    sourceId: updated.id,
    createdById: actor.id,
  });

  const typed = asItemRow(updated);
  const extras = await loadUsers(
    typed.assignment ? [typed.assignment.commandoUserId] : [],
  );
  return serialize(typed, extras);
}

export async function expireActionItem(actor: Actor, id: string) {
  const existing = await prisma.actionItem.findFirst({
    where: { id, archivedAt: null },
    include: itemInclude,
  });
  if (!existing) throw notFound("Action item not found");
  await assertCanManage(actor, asItemRow(existing));

  if (existing.status !== "ACTIVE") {
    throw badRequest("Only ACTIVE action items can be expired");
  }

  const updated = await prisma.actionItem.update({
    where: { id },
    data: {
      status: "EXPIRED",
      expiredAt: new Date(),
    },
    include: itemInclude,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "ACTION_ITEM_EXPIRED",
    entityType: "ActionItem",
    entityId: updated.id,
    metadata: { from: "ACTIVE", to: "EXPIRED", verb: "ARCHIVE" },
  });

  const typed = asItemRow(updated);
  const extras = await loadUsers(
    typed.assignment ? [typed.assignment.commandoUserId] : [],
  );
  return serialize(typed, extras);
}

/**
 * Replace creates a new ACTIVE item and marks the old one REPLACED.
 * Old record is never deleted.
 */
export async function replaceActionItem(
  actor: Actor,
  id: string,
  input: ReplaceActionItemInput,
) {
  const existing = await prisma.actionItem.findFirst({
    where: { id, archivedAt: null },
    include: itemInclude,
  });
  if (!existing) throw notFound("Action item not found");
  await assertCanManage(actor, asItemRow(existing));

  if (existing.status !== "ACTIVE") {
    throw badRequest("Only ACTIVE action items can be replaced");
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.actionItem.update({
      where: { id: existing.id },
      data: { status: "REPLACED" },
    });

    return tx.actionItem.create({
      data: {
        salesExecutiveProfileId: existing.salesExecutiveProfileId,
        assignmentId: existing.assignmentId,
        title: input.title,
        description: input.description?.trim()
          ? input.description.trim()
          : null,
        dueDate: input.dueDate ?? null,
        status: "ACTIVE",
        replacesId: existing.id,
        createdById: actor.id,
      },
      include: itemInclude,
    });
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "ACTION_ITEM_REPLACED",
    entityType: "ActionItem",
    entityId: created.id,
    metadata: {
      replacesId: existing.id,
      from: "ACTIVE",
      to: "REPLACED",
      verb: "REPLACE",
    },
  });

  const typed = asItemRow(created);
  const extras = await loadUsers(
    typed.assignment ? [typed.assignment.commandoUserId] : [],
  );
  return serialize(typed, extras);
}

function assertCanAddScreenshot(actor: Actor, row: ItemRow): void {
  if (actor.roleCode === "SALES_EXECUTIVE") {
    if (row.profile.userId !== actor.id) {
      throw forbidden("You may only add screenshots on your own assignments");
    }
    return;
  }
  if (
    actor.roleCode === "COMMANDO_EXECUTIVE" ||
    actor.roleCode === "TEAM_LEAD" ||
    hasPermission(actor, PERMISSIONS.ACTION_ITEM_UPDATE)
  ) {
    return;
  }
  throw forbidden("Not allowed to add screenshots on this assignment");
}

export async function addActionItemAttachment(
  actor: Actor,
  id: string,
  input: AddActionItemAttachmentInput,
) {
  const row = await prisma.actionItem.findFirst({
    where: { id, archivedAt: null },
    include: itemInclude,
  });
  if (!row) throw notFound("Action item not found");
  const typed = asItemRow(row);
  await assertCanAccess(actor, typed);
  assertCanAddScreenshot(actor, typed);

  if (typed.status !== "ACTIVE") {
    throw badRequest("Cannot add screenshots to a completed assignment");
  }

  try {
    assertAllowedImageUpload({
      contentType: input.contentType,
      contentLength: input.size ?? 1,
    });
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : "Invalid image");
  }

  if (!isOwnedActionItemImageKey(input.key, actor.id)) {
    throw badRequest("Invalid screenshot upload key");
  }

  await prisma.actionItemAttachment.create({
    data: {
      actionItemId: typed.id,
      storageKey: input.key,
      fileName: input.fileName.trim(),
      contentType: input.contentType,
      sizeBytes: input.size ?? null,
      caption: input.caption?.trim() || null,
      uploadedById: actor.id,
    },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: AUDIT_ACTIONS.ACTION_ITEM_ATTACHMENT_ADDED,
    entityType: "ActionItem",
    entityId: typed.id,
    metadata: {
      fileName: input.fileName.trim(),
      contentType: input.contentType,
    },
  });

  return getActionItem(actor, typed.id);
}

export async function getActionItemAttachmentUrl(
  actor: Actor,
  actionItemId: string,
  attachmentId: string,
) {
  const row = await prisma.actionItem.findFirst({
    where: { id: actionItemId, archivedAt: null },
    include: itemInclude,
  });
  if (!row) throw notFound("Action item not found");
  await assertCanAccess(actor, asItemRow(row));

  const attachment = await prisma.actionItemAttachment.findFirst({
    where: { id: attachmentId, actionItemId },
  });
  if (!attachment) throw notFound("Screenshot not found");

  const url = await createPresignedGetUrl({
    key: attachment.storageKey,
    fileName: attachment.fileName,
    expiresInSeconds: 600,
  });

  return {
    url,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    expiresInSeconds: 600,
  };
}

export async function removeActionItemAttachment(
  actor: Actor,
  actionItemId: string,
  attachmentId: string,
) {
  const row = await prisma.actionItem.findFirst({
    where: { id: actionItemId, archivedAt: null },
    include: itemInclude,
  });
  if (!row) throw notFound("Action item not found");
  const typed = asItemRow(row);
  await assertCanAccess(actor, typed);

  if (typed.status !== "ACTIVE") {
    throw badRequest("Cannot remove screenshots from a completed assignment");
  }

  const attachment = await prisma.actionItemAttachment.findFirst({
    where: { id: attachmentId, actionItemId },
  });
  if (!attachment) throw notFound("Screenshot not found");

  const isOwn = attachment.uploadedById === actor.id;
  if (isOwn) {
    // ok
  } else if (isSuperAdmin(actor)) {
    // ok
  } else if (hasPermission(actor, PERMISSIONS.ACTION_ITEM_UPDATE)) {
    await assertCanManage(actor, typed);
  } else {
    throw forbidden("You may only remove screenshots you uploaded");
  }

  await prisma.actionItemAttachment.delete({ where: { id: attachment.id } });

  await writeAuditLog({
    actorId: actor.id,
    action: AUDIT_ACTIONS.ACTION_ITEM_ATTACHMENT_REMOVED,
    entityType: "ActionItem",
    entityId: actionItemId,
    metadata: { attachmentId: attachment.id, fileName: attachment.fileName },
  });

  return getActionItem(actor, actionItemId);
}
