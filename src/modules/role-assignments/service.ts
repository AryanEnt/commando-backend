import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { getActiveTeamIds } from "../../lib/scope.js";
import { assertTeamLeadOperationalWriteAllowed } from "../../lib/teamLeadLock.js";
import type {
  CreateRoleAssignmentInput,
  ListRoleAssignmentsQuery,
  UpdateRoleAssignmentInput,
} from "./schemas.js";

/** Suggested defaults — served by API so the UI is not hard-coded. */
export const ROLE_ASSIGNMENT_TEMPLATES = {
  primaryResponsibility:
    "Provide required sales support for the assigned Sales Executive.",
  shouldDo: [
    "Provide required sales support",
    "Assist with assigned sales activities",
    "Support follow-ups or coordination where assigned",
    "Coordinate with the relevant Sales Executive",
    "Complete support activities assigned through the role",
  ],
  shouldNotDo: [
    "Do not modify Sales Executive performance scores",
    "Do not change Team Lead assessments",
    "Do not modify Commando evaluations",
    "Do not perform activities outside the assigned responsibility without authorization",
  ],
} as const;

const userBrief = {
  select: {
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    role: { select: { code: true } },
  },
} as const;

const assignmentInclude = {
  profile: {
    select: {
      id: true,
      displayName: true,
      userId: true,
      teamId: true,
      team: { select: { id: true, name: true } },
    },
  },
  salesSupportUser: userBrief,
  createdBy: userBrief,
  salesSupportLink: {
    select: {
      id: true,
      isActive: true,
      startedAt: true,
      endedAt: true,
    },
  },
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
  shouldDoItems: { orderBy: { sortOrder: "asc" as const } },
  shouldNotDoItems: { orderBy: { sortOrder: "asc" as const } },
} satisfies Prisma.SupportRoleAssignmentInclude;

type Row = Prisma.SupportRoleAssignmentGetPayload<{
  include: typeof assignmentInclude;
}>;

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

function serialize(row: Row, extras: Map<string, UserBrief>) {
  const commando = row.assignment
    ? (extras.get(row.assignment.commandoUserId) ?? null)
    : null;
  const teamLead = row.assignment
    ? (extras.get(row.assignment.teamLeadUserId) ?? null)
    : null;

  return {
    id: row.id,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    profile: row.profile,
    team: row.profile.team,
    salesSupportUserId: row.salesSupportUserId,
    salesSupportUser: row.salesSupportUser,
    salesSupportLinkId: row.salesSupportLinkId,
    salesSupportLink: row.salesSupportLink,
    assignmentId: row.assignmentId,
    assignment: row.assignment
      ? {
          id: row.assignment.id,
          status: row.assignment.status,
          startedAt: row.assignment.startedAt,
          endedAt: row.assignment.endedAt,
          teamId: row.assignment.teamId,
        }
      : null,
    commando,
    teamLead,
    primaryResponsibility: row.primaryResponsibility,
    shouldDo: row.shouldDoItems.map((i) => ({
      id: i.id,
      text: i.text,
      sortOrder: i.sortOrder,
    })),
    shouldNotDo: row.shouldNotDoItems.map((i) => ({
      id: i.id,
      text: i.text,
      sortOrder: i.sortOrder,
    })),
    status: row.status,
    replacesId: row.replacesId,
    createdById: row.createdById,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function serializeMany(rows: Row[]) {
  const ids = rows.flatMap((r) =>
    r.assignment
      ? [r.assignment.commandoUserId, r.assignment.teamLeadUserId]
      : [],
  );
  const extras = await loadUsers(ids);
  return rows.map((r) => serialize(r, extras));
}

async function activeSyncedProfileIds(
  supportUserId: string,
): Promise<string[]> {
  const links = await prisma.salesSupportLink.findMany({
    where: {
      salesSupportUserId: supportUserId,
      isActive: true,
      endedAt: null,
    },
    select: { salesExecutiveProfileId: true },
  });
  return links.map((l) => l.salesExecutiveProfileId);
}

async function scopeWhere(
  actor: Actor,
  query: ListRoleAssignmentsQuery,
): Promise<Prisma.SupportRoleAssignmentWhereInput> {
  if (isSuperAdmin(actor)) {
    return {
      archivedAt: null,
      ...(query.includeHistory
        ? {}
        : { status: "ACTIVE" as const }),
    };
  }

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    const assignments = await prisma.commandoAssignment.findMany({
      where: { commandoUserId: actor.id },
      select: { salesExecutiveProfileId: true },
    });
    const profileIds = [
      ...new Set(assignments.map((a) => a.salesExecutiveProfileId)),
    ];
    return {
      archivedAt: null,
      ...(query.includeHistory ? {} : { status: "ACTIVE" as const }),
      OR: [
        { createdById: actor.id },
        { salesExecutiveProfileId: { in: profileIds } },
        { assignment: { commandoUserId: actor.id } },
      ],
    };
  }

  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    return {
      archivedAt: null,
      ...(query.includeHistory ? {} : { status: "ACTIVE" as const }),
      OR: [
        { createdById: actor.id },
        { profile: { teamId: { in: teamIds } } },
        { assignment: { teamLeadUserId: actor.id } },
      ],
    };
  }

  if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    // Only currently synced Sales Executives — never all SE profiles
    const syncedIds = await activeSyncedProfileIds(actor.id);
    if (syncedIds.length === 0) {
      return { id: "__none__" };
    }
    return {
      archivedAt: null,
      salesSupportUserId: actor.id,
      salesExecutiveProfileId: { in: syncedIds },
      // SSE sees ACTIVE for current syncs; history only when includeHistory + still synced
      ...(query.includeHistory
        ? {}
        : { status: "ACTIVE" as const }),
    };
  }

  return { id: "__none__" };
}

async function assertCanAccess(actor: Actor, row: Row): Promise<void> {
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
      throw forbidden("Role assignment is outside your assignment scope");
    }
    return;
  }

  if (actor.roleCode === "TEAM_LEAD") {
    if (row.createdById === actor.id) return;
    if (row.assignment?.teamLeadUserId === actor.id) return;
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (row.profile.teamId && teamIds.includes(row.profile.teamId)) return;
    throw forbidden("Role assignment is outside your team scope");
  }

  if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    if (row.salesSupportUserId !== actor.id) {
      throw forbidden("You may only view your own role assignments");
    }
    const synced = await activeSyncedProfileIds(actor.id);
    if (!synced.includes(row.salesExecutiveProfileId)) {
      throw forbidden(
        "You may only view role assignments for currently synced Sales Executives",
      );
    }
    return;
  }

  throw forbidden("Not allowed to access role assignments");
}

export function getRoleAssignmentTemplates() {
  return ROLE_ASSIGNMENT_TEMPLATES;
}

export async function listRoleAssignments(
  actor: Actor,
  query: ListRoleAssignmentsQuery,
) {
  const scope = await scopeWhere(actor, query);
  const where: Prisma.SupportRoleAssignmentWhereInput = {
    AND: [
      scope,
      ...(query.profileId
        ? [{ salesExecutiveProfileId: query.profileId }]
        : []),
      ...(query.salesSupportUserId
        ? [{ salesSupportUserId: query.salesSupportUserId }]
        : []),
      ...(query.status ? [{ status: query.status }] : []),
      ...(query.search
        ? [
            {
              OR: [
                {
                  primaryResponsibility: {
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
    prisma.supportRoleAssignment.count({ where }),
    prisma.supportRoleAssignment.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: "desc" },
      include: assignmentInclude,
    }),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    roleAssignments: await serializeMany(rows),
  };
}

export async function getRoleAssignment(actor: Actor, id: string) {
  const row = await prisma.supportRoleAssignment.findFirst({
    where: { id, archivedAt: null },
    include: assignmentInclude,
  });
  if (!row) throw notFound("Role assignment not found");
  await assertCanAccess(actor, row);
  const extras = await loadUsers(
    row.assignment
      ? [row.assignment.commandoUserId, row.assignment.teamLeadUserId]
      : [],
  );
  return serialize(row, extras);
}

async function resolveLinkAndAssignment(
  actor: Actor,
  profileId: string,
  salesSupportUserId: string,
) {
  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: profileId, archivedAt: null },
  });
  if (!profile) throw notFound("Sales executive profile not found");

  const supportUser = await prisma.user.findFirst({
    where: {
      id: salesSupportUserId,
      isActive: true,
      deletedAt: null,
      role: { code: "SALES_SUPPORT_EXECUTIVE" },
    },
  });
  if (!supportUser) {
    throw badRequest("Sales Support Executive is invalid or inactive");
  }

  const link = await prisma.salesSupportLink.findFirst({
    where: {
      salesExecutiveProfileId: profile.id,
      salesSupportUserId: supportUser.id,
      isActive: true,
      endedAt: null,
    },
  });
  if (!link) {
    throw badRequest(
      "No active Sales Executive ↔ Sales Support sync relationship for this pair",
    );
  }

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    const assignment = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: profile.id,
        commandoUserId: actor.id,
        status: "ACTIVE",
      },
    });
    if (!assignment) {
      throw forbidden(
        "You may only create role assignments for profiles with an active assignment to you",
      );
    }
    return { profile, supportUser, link, assignmentId: assignment.id };
  }

  if (actor.roleCode === "TEAM_LEAD") {
    await assertTeamLeadOperationalWriteAllowed(prisma, actor, profile.id, {
      action: "ROLE_ASSIGNMENT_WRITE",
    });
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(profile.teamId)) {
      throw forbidden(
        "You may only create role assignments for Sales Executives on your teams",
      );
    }
    // Optional link to any current intervention for history; not required.
    const activeIntervention = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: profile.id,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    return {
      profile,
      supportUser,
      link,
      assignmentId: activeIntervention?.id ?? null,
    };
  }

  throw forbidden("Only Team Leads and Commandos can create role assignments");
}

export async function createRoleAssignment(
  actor: Actor,
  input: CreateRoleAssignmentInput,
) {
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for role assignments");
  }
  if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    actor.roleCode !== "TEAM_LEAD"
  ) {
    throw forbidden(
      "Only Team Leads and Commandos can create role assignments",
    );
  }

  const { profile, supportUser, link, assignmentId } =
    await resolveLinkAndAssignment(
      actor,
      input.salesExecutiveProfileId,
      input.salesSupportUserId,
    );

  const created = await prisma.$transaction(async (tx) => {
    const existingActive = await tx.supportRoleAssignment.findMany({
      where: {
        salesExecutiveProfileId: profile.id,
        salesSupportUserId: supportUser.id,
        status: "ACTIVE",
        archivedAt: null,
      },
    });

    for (const old of existingActive) {
      await tx.supportRoleAssignment.update({
        where: { id: old.id },
        data: { status: "SUPERSEDED" },
      });
    }

    return tx.supportRoleAssignment.create({
      data: {
        salesExecutiveProfileId: profile.id,
        salesSupportUserId: supportUser.id,
        salesSupportLinkId: link.id,
        assignmentId,
        primaryResponsibility: input.primaryResponsibility,
        status: "ACTIVE",
        replacesId: existingActive[0]?.id ?? null,
        createdById: actor.id,
        shouldDoItems: {
          create: input.shouldDo.map((text, index) => ({
            text,
            sortOrder: index,
          })),
        },
        shouldNotDoItems: {
          create: input.shouldNotDo.map((text, index) => ({
            text,
            sortOrder: index,
          })),
        },
      },
      include: assignmentInclude,
    });
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "ROLE_ASSIGNMENT_CREATED",
      entityType: "SupportRoleAssignment",
      entityId: created.id,
      metadata: {
        profileId: profile.id,
        salesSupportUserId: supportUser.id,
        supersededCount: created.replacesId ? 1 : 0,
      },
    },
  });

  const extras = await loadUsers(
    created.assignment
      ? [
          created.assignment.commandoUserId,
          created.assignment.teamLeadUserId,
        ]
      : [],
  );
  return serialize(created, extras);
}

/**
 * Edits create a new ACTIVE version and supersede the previous one —
 * historical records remain intact.
 */
export async function updateRoleAssignment(
  actor: Actor,
  id: string,
  input: UpdateRoleAssignmentInput,
) {
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for role assignments");
  }
  if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    actor.roleCode !== "TEAM_LEAD"
  ) {
    throw forbidden("Only Team Leads and Commandos can edit role assignments");
  }

  const existing = await prisma.supportRoleAssignment.findFirst({
    where: { id, archivedAt: null },
    include: assignmentInclude,
  });
  if (!existing) throw notFound("Role assignment not found");
  await assertCanAccess(actor, existing);

  if (existing.status !== "ACTIVE") {
    throw badRequest("Only ACTIVE role assignments can be edited");
  }

  if (actor.roleCode === "TEAM_LEAD") {
    await assertTeamLeadOperationalWriteAllowed(
      prisma,
      actor,
      existing.salesExecutiveProfileId,
      { action: "ROLE_ASSIGNMENT_WRITE" },
    );
  }

  if (
    actor.roleCode === "COMMANDO_EXECUTIVE" &&
    existing.assignment?.commandoUserId !== actor.id &&
    existing.createdById !== actor.id
  ) {
    const assigned = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: existing.salesExecutiveProfileId,
        commandoUserId: actor.id,
        status: "ACTIVE",
      },
    });
    if (!assigned) {
      throw forbidden("Not allowed to edit this role assignment");
    }
  }

  const shouldDo =
    input.shouldDo ?? existing.shouldDoItems.map((i) => i.text);
  const shouldNotDo =
    input.shouldNotDo ?? existing.shouldNotDoItems.map((i) => i.text);
  const primaryResponsibility =
    input.primaryResponsibility ?? existing.primaryResponsibility;

  const created = await prisma.$transaction(async (tx) => {
    await tx.supportRoleAssignment.update({
      where: { id: existing.id },
      data: { status: "SUPERSEDED" },
    });

    return tx.supportRoleAssignment.create({
      data: {
        salesExecutiveProfileId: existing.salesExecutiveProfileId,
        salesSupportUserId: existing.salesSupportUserId,
        salesSupportLinkId: existing.salesSupportLinkId,
        assignmentId: existing.assignmentId,
        primaryResponsibility,
        status: "ACTIVE",
        replacesId: existing.id,
        createdById: actor.id,
        shouldDoItems: {
          create: shouldDo.map((text, index) => ({
            text,
            sortOrder: index,
          })),
        },
        shouldNotDoItems: {
          create: shouldNotDo.map((text, index) => ({
            text,
            sortOrder: index,
          })),
        },
      },
      include: assignmentInclude,
    });
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "ROLE_ASSIGNMENT_UPDATED",
      entityType: "SupportRoleAssignment",
      entityId: created.id,
      metadata: {
        replacesId: existing.id,
        profileId: existing.salesExecutiveProfileId,
      },
    },
  });

  const extras = await loadUsers(
    created.assignment
      ? [
          created.assignment.commandoUserId,
          created.assignment.teamLeadUserId,
        ]
      : [],
  );
  return serialize(created, extras);
}
