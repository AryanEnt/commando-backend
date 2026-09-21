import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { getActiveTeamIds } from "../../lib/scope.js";
import { assertTeamLeadOperationalWriteAllowed } from "../../lib/teamLeadLock.js";
import { eisenhowerCategoryFrom } from "../../lib/workspaceEvents.js";
import type {
  CreateWorkspaceEventInput,
  ListWorkspaceEventsQuery,
} from "./schemas.js";

const eventInclude = {
  profile: {
    select: { id: true, displayName: true, userId: true, teamId: true },
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
} satisfies Prisma.WorkspaceEventInclude;

type EventRow = Prisma.WorkspaceEventGetPayload<{
  include: typeof eventInclude;
}>;

function serialize(row: EventRow) {
  return {
    id: row.id,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    profile: row.profile,
    assignmentId: row.assignmentId,
    assignment: row.assignment,
    type: row.type,
    title: row.title,
    notes: row.notes,
    nextAction: row.nextAction,
    urgency: row.urgency,
    importance: row.importance,
    status: row.status,
    eisenhowerCategory: row.eisenhowerCategory,
    occurredAt: row.occurredAt,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    createdById: row.createdById,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    href: sourceHref(row.sourceType, row.sourceId, row.type),
  };
}

function sourceHref(
  sourceType: string | null,
  sourceId: string | null,
  _type: string,
): string | null {
  if (sourceType && sourceId) {
    switch (sourceType) {
      case "ActionItem":
        return `/action-items/${sourceId}`;
      case "Feedback":
        return `/feedback/${sourceId}`;
      case "DailyLog":
        return `/daily-logs/${sourceId}`;
      case "LiveMonitoringRecord":
        return `/monitoring/${sourceId}`;
      case "WeeklyReview":
        return `/weekly-reviews/${sourceId}`;
      case "SupportTask":
        return `/my-tasks/${sourceId}`;
      case "SwotAnalysis":
        return `/swot/${sourceId}`;
      default:
        break;
    }
  }
  return null;
}

async function assertCanViewProfile(
  actor: Actor,
  profileId: string,
): Promise<{
  id: string;
  teamId: string;
}> {
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
        throw forbidden("You can only view your own workspace events");
      }
      return profile;
    }
    default:
      throw forbidden("You do not have access to workspace events");
  }
}

async function resolveAssignmentId(
  actor: Actor,
  profileId: string,
): Promise<string | null> {
  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    const assignment = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: profileId,
        commandoUserId: actor.id,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    return assignment?.id ?? null;
  }
  const active = await prisma.commandoAssignment.findFirst({
    where: { salesExecutiveProfileId: profileId, status: "ACTIVE" },
    select: { id: true },
  });
  return active?.id ?? null;
}

function rangeStart(range: ListWorkspaceEventsQuery["range"]): Date | null {
  const now = new Date();
  if (range === "all") return null;
  if (range === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (range === "week") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - 7);
    return d;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function listWorkspaceEvents(
  actor: Actor,
  query: ListWorkspaceEventsQuery,
) {
  await assertCanViewProfile(actor, query.profileId);

  const from = rangeStart(query.range);
  const where: Prisma.WorkspaceEventWhereInput = {
    archivedAt: null,
    salesExecutiveProfileId: query.profileId,
    ...(query.type ? { type: query.type } : {}),
    ...(query.eisenhowerCategory
      ? { eisenhowerCategory: query.eisenhowerCategory }
      : {}),
    ...(from ? { occurredAt: { gte: from } } : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: "insensitive" } },
            { notes: { contains: query.search, mode: "insensitive" } },
            { nextAction: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.workspaceEvent.count({ where }),
    prisma.workspaceEvent.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { occurredAt: "desc" },
      include: eventInclude,
    }),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    events: rows.map(serialize),
  };
}

export async function createWorkspaceEvent(
  actor: Actor,
  input: CreateWorkspaceEventInput,
) {
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for workspace events");
  }
  if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    actor.roleCode !== "TEAM_LEAD"
  ) {
    throw forbidden("Only Commandos and Team Leads can create workspace events");
  }

  const profile = await assertCanViewProfile(
    actor,
    input.salesExecutiveProfileId,
  );

  if (actor.roleCode === "TEAM_LEAD") {
    await assertTeamLeadOperationalWriteAllowed(prisma, actor, profile.id, {
      action: "WORKSPACE_EVENT_CREATE",
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
        "You may only create events for profiles with an active assignment to you",
      );
    }
  }

  const assignmentId = await resolveAssignmentId(actor, profile.id);
  const urgency = input.urgency;
  const importance = input.importance;
  const eisenhowerCategory = eisenhowerCategoryFrom(urgency, importance);
  const createLinked =
    input.createLinkedRecord ??
    (input.type === "ACTION" || input.type === "FEEDBACK");

  let sourceType: string | null = null;
  let sourceId: string | null = null;

  if (createLinked && input.type === "ACTION") {
    const action = await prisma.actionItem.create({
      data: {
        salesExecutiveProfileId: profile.id,
        assignmentId,
        title: input.title,
        description: input.notes?.trim() || input.nextAction?.trim() || null,
        status: input.status === "COMPLETED" ? "COMPLETED" : "ACTIVE",
        completedAt: input.status === "COMPLETED" ? new Date() : null,
        createdById: actor.id,
      },
      select: { id: true },
    });
    sourceType = "ActionItem";
    sourceId = action.id;
    await writeAuditLog({
      actorId: actor.id,
      action: "ACTION_ITEM_CREATED",
      entityType: "ActionItem",
      entityId: action.id,
      metadata: {
        profileId: profile.id,
        via: "WORKSPACE_EVENT",
      },
    });
  }

  if (createLinked && input.type === "FEEDBACK") {
    const source =
      actor.roleCode === "TEAM_LEAD" ? "TEAM_LEAD" : "COMMANDO";
    const feedback = await prisma.feedback.create({
      data: {
        salesExecutiveProfileId: profile.id,
        assignmentId,
        source,
        body: [input.title, input.notes].filter(Boolean).join("\n\n"),
        createdById: actor.id,
      },
      select: { id: true },
    });
    sourceType = "Feedback";
    sourceId = feedback.id;
    await writeAuditLog({
      actorId: actor.id,
      action: "FEEDBACK_CREATED",
      entityType: "Feedback",
      entityId: feedback.id,
      metadata: { profileId: profile.id, via: "WORKSPACE_EVENT" },
    });
  }

  // Matrix placement is done by the client via /api/eisenhower (Add Event)
  // or by domain services (daily logs). This endpoint records timeline + links.
  const created = await prisma.workspaceEvent.create({
    data: {
      salesExecutiveProfileId: profile.id,
      assignmentId,
      type: input.type,
      title: input.title,
      notes: input.notes?.trim() ? input.notes.trim() : null,
      nextAction: input.nextAction?.trim() ? input.nextAction.trim() : null,
      urgency,
      importance,
      status: input.status,
      eisenhowerCategory,
      occurredAt: input.occurredAt ?? new Date(),
      sourceType,
      sourceId,
      createdById: actor.id,
    },
    include: eventInclude,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "WORKSPACE_EVENT_CREATED",
    entityType: "WorkspaceEvent",
    entityId: created.id,
    metadata: {
      profileId: profile.id,
      type: input.type,
      sourceType,
      sourceId,
      eisenhowerCategory,
    },
  });

  return serialize(created);
}
