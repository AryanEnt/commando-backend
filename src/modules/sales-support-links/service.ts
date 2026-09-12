import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { getActiveTeamIds } from "../../lib/scope.js";
import { assertTeamLeadOperationalWriteAllowed } from "../../lib/teamLeadLock.js";
import { AUDIT_ACTIONS, writeAuditLog } from "../../lib/audit.js";
import type {
  AssignSalesSupportLinkInput,
  EndSalesSupportLinkInput,
  ListEligibleSupportUsersQuery,
  ListSalesSupportLinksQuery,
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

const linkInclude = {
  profile: {
    select: {
      id: true,
      displayName: true,
      userId: true,
      teamId: true,
      team: { select: { id: true, name: true } },
    },
  },
  supportUser: userBrief,
  assignedBy: userBrief,
  endedBy: userBrief,
} satisfies Prisma.SalesSupportLinkInclude;

type LinkRow = Prisma.SalesSupportLinkGetPayload<{
  include: typeof linkInclude;
}>;

function serialize(row: LinkRow) {
  return {
    id: row.id,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    profile: {
      id: row.profile.id,
      displayName: row.profile.displayName,
      userId: row.profile.userId,
      teamId: row.profile.teamId,
      team: row.profile.team,
    },
    salesSupportUserId: row.salesSupportUserId,
    supportUser: row.supportUser,
    responsibilityType: row.responsibilityType,
    note: row.note,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    isActive: row.isActive,
    assignedById: row.assignedById,
    assignedBy: row.assignedBy,
    endedById: row.endedById,
    endedBy: row.endedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
): Promise<Prisma.SalesSupportLinkWhereInput> {
  if (isSuperAdmin(actor)) {
    return {};
  }

  switch (actor.roleCode) {
    case "TEAM_LEAD": {
      const teamIds = await getActiveTeamIds(prisma, actor.id);
      return { profile: { teamId: { in: teamIds } } };
    }
    case "COMMANDO_EXECUTIVE": {
      const profileIds = await assignedProfileIds(actor.id);
      return {
        OR: [
          { salesExecutiveProfileId: { in: profileIds } },
          { assignedById: actor.id },
        ],
      };
    }
    case "SALES_SUPPORT_EXECUTIVE":
      return { salesSupportUserId: actor.id };
    case "SALES_EXECUTIVE": {
      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { userId: actor.id, archivedAt: null },
        select: { id: true },
      });
      return profile
        ? { salesExecutiveProfileId: profile.id }
        : { id: "__none__" };
    }
    default:
      return { id: "__none__" };
  }
}

async function assertCanAccessLink(actor: Actor, row: LinkRow): Promise<void> {
  if (isSuperAdmin(actor)) return;

  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(row.profile.teamId)) {
      throw forbidden("Support link is outside your team scope");
    }
    return;
  }

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    if (row.assignedById === actor.id) return;
    const assigned = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: row.salesExecutiveProfileId,
        commandoUserId: actor.id,
      },
      select: { id: true },
    });
    if (!assigned) {
      throw forbidden("Support link is outside your assignment scope");
    }
    return;
  }

  if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    if (row.salesSupportUserId !== actor.id) {
      throw forbidden("You may only view your own support links");
    }
    return;
  }

  if (actor.roleCode === "SALES_EXECUTIVE") {
    if (row.profile.userId !== actor.id) {
      throw forbidden("You may only view support links for your own profile");
    }
    return;
  }

  throw forbidden("Not allowed to access sales support links");
}

async function assertCanAssign(
  actor: Actor,
  profile: { id: string; teamId: string; archivedAt: Date | null },
): Promise<void> {
  if (isSuperAdmin(actor)) return;

  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(profile.teamId)) {
      throw forbidden("Profile is outside your team scope");
    }
    await assertTeamLeadOperationalWriteAllowed(prisma, actor, profile.id, {
      action: "SALES_SUPPORT_LINK_ASSIGN",
    });
    return;
  }

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
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
        "You may only assign Sales Support for Sales Executives with an active intervention assigned to you",
      );
    }
    return;
  }

  throw forbidden(
    "Only Team Leads and Commandos can assign sales support links",
  );
}

export async function listSalesSupportLinks(
  actor: Actor,
  query: ListSalesSupportLinksQuery,
) {
  const scope = await scopeWhere(actor);

  if (
    actor.roleCode === "SALES_SUPPORT_EXECUTIVE" &&
    query.salesSupportUserId &&
    query.salesSupportUserId !== actor.id
  ) {
    return {
      page: query.page,
      pageSize: query.pageSize,
      total: 0,
      links: [] as ReturnType<typeof serialize>[],
    };
  }

  const where: Prisma.SalesSupportLinkWhereInput = {
    AND: [
      scope,
      ...(query.profileId
        ? [{ salesExecutiveProfileId: query.profileId }]
        : []),
      ...(query.salesSupportUserId
        ? [{ salesSupportUserId: query.salesSupportUserId }]
        : []),
      ...(query.isActive !== undefined ? [{ isActive: query.isActive }] : []),
    ],
  };

  const [total, rows] = await Promise.all([
    prisma.salesSupportLink.count({ where }),
    prisma.salesSupportLink.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: [{ isActive: "desc" }, { startedAt: "desc" }],
      include: linkInclude,
    }),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    links: rows.map(serialize),
  };
}

export async function getSalesSupportLink(actor: Actor, id: string) {
  const row = await prisma.salesSupportLink.findFirst({
    where: { id },
    include: linkInclude,
  });
  if (!row) throw notFound("Sales support link not found");
  await assertCanAccessLink(actor, row);
  return serialize(row);
}

export async function getTeamContext(actor: Actor, profileId: string) {
  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: profileId, archivedAt: null },
    select: {
      id: true,
      displayName: true,
      userId: true,
      teamId: true,
      team: { select: { id: true, name: true } },
    },
  });
  if (!profile) throw notFound("Sales executive profile not found");

  // Scope check via synthetic access on any link or profile ownership
  if (isSuperAdmin(actor)) {
    // ok
  } else if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(profile.teamId)) {
      throw forbidden("Profile is outside your team scope");
    }
  } else if (actor.roleCode === "COMMANDO_EXECUTIVE") {
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
  } else if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    const link = await prisma.salesSupportLink.findFirst({
      where: {
        salesExecutiveProfileId: profile.id,
        salesSupportUserId: actor.id,
      },
      select: { id: true },
    });
    if (!link) {
      throw forbidden("Profile is outside your sales support scope");
    }
  } else if (actor.roleCode === "SALES_EXECUTIVE") {
    if (profile.userId !== actor.id) {
      throw forbidden("You may only view your own support team");
    }
  } else {
    throw forbidden("Not allowed to view support team context");
  }

  const [activeSupport, history, activeAssignment] = await Promise.all([
    prisma.salesSupportLink.findMany({
      where: { salesExecutiveProfileId: profile.id, isActive: true },
      orderBy: { startedAt: "desc" },
      include: linkInclude,
    }),
    prisma.salesSupportLink.findMany({
      where: { salesExecutiveProfileId: profile.id, isActive: false },
      orderBy: { endedAt: "desc" },
      include: linkInclude,
    }),
    prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: profile.id,
        status: "ACTIVE",
      },
      select: {
        id: true,
        status: true,
        commando: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    }),
  ]);

  // SSE only sees their own rows in active/history
  let activeRows = activeSupport;
  let historyRows = history;
  if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    activeRows = activeSupport.filter(
      (l) => l.salesSupportUserId === actor.id,
    );
    historyRows = history.filter((l) => l.salesSupportUserId === actor.id);
  }

  return {
    profile: {
      id: profile.id,
      displayName: profile.displayName,
      team: profile.team,
    },
    commando: activeAssignment
      ? {
          id: activeAssignment.commando.id,
          firstName: activeAssignment.commando.firstName,
          lastName: activeAssignment.commando.lastName,
          email: activeAssignment.commando.email,
          assignmentId: activeAssignment.id,
          status: activeAssignment.status,
        }
      : null,
    activeSupport: activeRows.map(serialize),
    history: historyRows.map(serialize),
  };
}

export async function listEligibleSupportUsers(
  actor: Actor,
  query: ListEligibleSupportUsersQuery,
) {
  if (
    actor.roleCode !== "TEAM_LEAD" &&
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    !isSuperAdmin(actor)
  ) {
    throw forbidden(
      "Only Team Leads and Commandos can list eligible support users",
    );
  }

  if (query.profileId) {
    const profile = await prisma.salesExecutiveProfile.findFirst({
      where: { id: query.profileId, archivedAt: null },
      select: { id: true, teamId: true },
    });
    if (!profile) throw notFound("Sales executive profile not found");

    if (actor.roleCode === "TEAM_LEAD") {
      const teamIds = await getActiveTeamIds(prisma, actor.id);
      if (!teamIds.includes(profile.teamId)) {
        throw forbidden("Profile is outside your team scope");
      }
    }

    if (actor.roleCode === "COMMANDO_EXECUTIVE") {
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
          "You may only list support users for Sales Executives with an active intervention assigned to you",
        );
      }
    }
  }

  let excludeUserIds: string[] = [];
  if (query.profileId) {
    const active = await prisma.salesSupportLink.findMany({
      where: {
        salesExecutiveProfileId: query.profileId,
        isActive: true,
      },
      select: { salesSupportUserId: true },
    });
    excludeUserIds = active.map((l) => l.salesSupportUserId);
  }

  const where: Prisma.UserWhereInput = {
    isActive: true,
    deletedAt: null,
    role: { code: "SALES_SUPPORT_EXECUTIVE" },
    ...(excludeUserIds.length
      ? { id: { notIn: excludeUserIds } }
      : {}),
    ...(query.teamId
      ? {
          teamMemberships: {
            some: {
              teamId: query.teamId,
              isActive: true,
              endedAt: null,
            },
          },
        }
      : {}),
    ...(query.search
      ? {
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
        }
      : {}),
  };

  const users = await prisma.user.findMany({
    where,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 100,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: { select: { code: true } },
    },
  });

  return { users };
}

export async function assignSalesSupportLink(
  actor: Actor,
  input: AssignSalesSupportLinkInput,
) {
  if (
    actor.roleCode !== "TEAM_LEAD" &&
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    !isSuperAdmin(actor)
  ) {
    throw forbidden(
      "Only Team Leads and Commandos can assign sales support links",
    );
  }

  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: input.salesExecutiveProfileId },
  });
  if (!profile || profile.archivedAt) {
    throw notFound("Sales executive profile not found");
  }

  await assertCanAssign(actor, profile);

  const supportUser = await prisma.user.findFirst({
    where: {
      id: input.salesSupportUserId,
      isActive: true,
      deletedAt: null,
      role: { code: "SALES_SUPPORT_EXECUTIVE" },
    },
  });
  if (!supportUser) {
    throw badRequest("Sales Support Executive is invalid or inactive");
  }

  const existing = await prisma.salesSupportLink.findFirst({
    where: {
      salesExecutiveProfileId: profile.id,
      salesSupportUserId: supportUser.id,
      isActive: true,
    },
  });
  if (existing) {
    throw conflict(
      "An active sales support link already exists for this Sales Executive and Support user",
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const link = await tx.salesSupportLink.create({
      data: {
        salesExecutiveProfileId: profile.id,
        salesSupportUserId: supportUser.id,
        responsibilityType: input.responsibilityType ?? null,
        note: input.note?.trim() ? input.note.trim() : null,
        assignedById: actor.id,
        startedAt: new Date(),
        isActive: true,
      },
      include: linkInclude,
    });

    await writeAuditLog(
      {
        actorId: actor.id,
        action: AUDIT_ACTIONS.SALES_SUPPORT_LINK_ASSIGNED,
        entityType: "SalesSupportLink",
        entityId: link.id,
        metadata: {
          salesExecutiveProfileId: profile.id,
          salesSupportUserId: supportUser.id,
          responsibilityType: link.responsibilityType,
        },
      },
      tx,
    );

    return link;
  });

  return serialize(created);
}

export async function endSalesSupportLink(
  actor: Actor,
  id: string,
  input: EndSalesSupportLinkInput = {},
) {
  if (
    actor.roleCode !== "TEAM_LEAD" &&
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    !isSuperAdmin(actor)
  ) {
    throw forbidden(
      "Only Team Leads and Commandos can end sales support links",
    );
  }

  const existing = await prisma.salesSupportLink.findFirst({
    where: { id },
    include: linkInclude,
  });
  if (!existing) throw notFound("Sales support link not found");
  if (!existing.isActive) {
    throw badRequest("Sales support link is already ended");
  }

  await assertCanAssign(actor, {
    id: existing.profile.id,
    teamId: existing.profile.teamId,
    archivedAt: null,
  });

  const activeTaskCount = await prisma.supportTask.count({
    where: {
      salesSupportLinkId: existing.id,
      archivedAt: null,
      status: { in: ["PENDING", "ACCEPTED", "IN_PROGRESS", "BLOCKED"] },
    },
  });
  if (activeTaskCount > 0) {
    throw badRequest(
      `This Support assignment has ${activeTaskCount} active task${activeTaskCount === 1 ? "" : "s"}. Reassign or complete them before ending the assignment.`,
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const link = await tx.salesSupportLink.update({
      where: { id: existing.id },
      data: {
        isActive: false,
        endedAt: new Date(),
        endedById: actor.id,
        ...(input.note !== undefined
          ? {
              note: input.note?.trim()
                ? input.note.trim()
                : existing.note,
            }
          : {}),
      },
      include: linkInclude,
    });

    await writeAuditLog(
      {
        actorId: actor.id,
        action: AUDIT_ACTIONS.SALES_SUPPORT_LINK_ENDED,
        entityType: "SalesSupportLink",
        entityId: link.id,
        metadata: {
          salesExecutiveProfileId: link.salesExecutiveProfileId,
          salesSupportUserId: link.salesSupportUserId,
        },
      },
      tx,
    );

    return link;
  });

  return serialize(updated);
}
