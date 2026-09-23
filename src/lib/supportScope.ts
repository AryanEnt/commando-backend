import type { PrismaClient } from "@prisma/client";
import type { Actor } from "./authorization.js";
import { isSuperAdmin } from "./authorization.js";
import { forbidden, notFound } from "./errors.js";
import { getActiveTeamIds } from "./scope.js";

const supportUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: { select: { code: true } },
} as const;

export type SupportUserBrief = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: { code: string };
};

/** Active Sales Support user IDs on the given teams. */
export async function supportUserIdsOnTeams(
  prisma: PrismaClient,
  teamIds: string[],
): Promise<string[]> {
  if (teamIds.length === 0) return [];
  const rows = await prisma.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      role: { code: "SALES_SUPPORT_EXECUTIVE" },
      teamMemberships: {
        some: {
          teamId: { in: teamIds },
          isActive: true,
          endedAt: null,
        },
      },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function teamIdsForCommandoActive(
  prisma: PrismaClient,
  commandoUserId: string,
): Promise<string[]> {
  const assignments = await prisma.commandoAssignment.findMany({
    where: { commandoUserId, status: "ACTIVE" },
    select: { teamId: true },
  });
  return [...new Set(assignments.map((a) => a.teamId))];
}

/**
 * TL/Commando may manage a Sales Support user when that user is an active
 * member of a team in the manager's operational scope (not only when linked).
 */
export async function assertCanManageSupportUser(
  prisma: PrismaClient,
  actor: Actor,
  supportUserId: string,
): Promise<SupportUserBrief> {
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for Sales Support operational records");
  }
  if (
    actor.roleCode !== "TEAM_LEAD" &&
    actor.roleCode !== "COMMANDO_EXECUTIVE"
  ) {
    throw forbidden("Not allowed to manage this Sales Support user");
  }

  const supportUser = await prisma.user.findFirst({
    where: {
      id: supportUserId,
      isActive: true,
      deletedAt: null,
      role: { code: "SALES_SUPPORT_EXECUTIVE" },
    },
    select: supportUserSelect,
  });
  if (!supportUser) {
    throw notFound("Sales Support Executive not found");
  }

  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (teamIds.length === 0) {
      throw forbidden("Sales Support user is outside your team scope");
    }
    const onTeam = await prisma.teamMembership.findFirst({
      where: {
        userId: supportUserId,
        teamId: { in: teamIds },
        isActive: true,
        endedAt: null,
      },
      select: { id: true },
    });
    if (!onTeam) {
      throw forbidden("Sales Support user is outside your team scope");
    }
    return supportUser;
  }

  const teamIds = await teamIdsForCommandoActive(prisma, actor.id);
  if (teamIds.length === 0) {
    throw forbidden(
      "Sales Support user is outside your active intervention team scope",
    );
  }
  const onTeam = await prisma.teamMembership.findFirst({
    where: {
      userId: supportUserId,
      teamId: { in: teamIds },
      isActive: true,
      endedAt: null,
    },
    select: { id: true },
  });
  if (!onTeam) {
    throw forbidden(
      "Sales Support user is outside your active intervention team scope",
    );
  }
  return supportUser;
}

export async function assertCanViewSupportUser(
  prisma: PrismaClient,
  actor: Actor,
  supportUserId: string,
): Promise<void> {
  if (isSuperAdmin(actor)) return;
  if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    if (actor.id !== supportUserId) {
      throw forbidden("Not allowed to access this Sales Support user");
    }
    return;
  }
  await assertCanManageSupportUser(prisma, actor, supportUserId);
}
