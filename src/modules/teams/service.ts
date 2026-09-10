import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "../../lib/errors.js";
import {
  getActiveTeamIds,
  requireRecordAccess,
  teamScopeWhere,
} from "../../lib/scope.js";
import type {
  addMemberSchema,
  createTeamSchema,
  updateTeamSchema,
} from "./schemas.js";
import type { z } from "zod";

type CreateTeamInput = z.infer<typeof createTeamSchema>;
type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
type AddMemberInput = z.infer<typeof addMemberSchema>;

export async function listTeams(actor: Actor, search?: string) {
  const scope = await teamScopeWhere(prisma, actor);
  const where: Prisma.TeamWhereInput = {
    ...(scope as Prisma.TeamWhereInput),
    ...(search
      ? { name: { contains: search, mode: "insensitive" } }
      : {}),
  };

  const teams = await prisma.team.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          memberships: { where: { isActive: true, endedAt: null } },
          profiles: { where: { archivedAt: null } },
        },
      },
    },
  });

  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    archivedAt: t.archivedAt,
    memberCount: t._count.memberships,
    profileCount: t._count.profiles,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));
}

export async function getTeam(actor: Actor, teamId: string) {
  const team = await prisma.team.findFirst({
    where: { id: teamId, archivedAt: null },
  });
  if (!team) throw notFound("Team not found");

  await requireRecordAccess(prisma, actor, { teamId: team.id });

  return team;
}

export async function createTeam(actor: Actor, input: CreateTeamInput) {
  if (!isSuperAdmin(actor)) {
    throw forbidden("Only Super Admin can create teams");
  }

  const team = await prisma.team.create({
    data: {
      name: input.name,
      description: input.description ?? null,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "TEAM_CREATED",
      entityType: "Team",
      entityId: team.id,
      metadata: { name: team.name },
    },
  });

  return team;
}

export async function updateTeam(
  actor: Actor,
  teamId: string,
  input: UpdateTeamInput,
) {
  if (!isSuperAdmin(actor)) {
    throw forbidden("Only Super Admin can update teams");
  }

  const existing = await prisma.team.findFirst({
    where: { id: teamId, archivedAt: null },
  });
  if (!existing) throw notFound("Team not found");

  const team = await prisma.team.update({
    where: { id: teamId },
    data: {
      name: input.name,
      description: input.description,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "TEAM_UPDATED",
      entityType: "Team",
      entityId: team.id,
    },
  });

  return team;
}

export async function listMembers(actor: Actor, teamId: string) {
  await getTeam(actor, teamId);

  return prisma.teamMembership.findMany({
    where: { teamId },
    orderBy: [{ isActive: "desc" }, { startedAt: "desc" }],
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: { select: { code: true, name: true } },
        },
      },
    },
  });
}

export async function addMember(
  actor: Actor,
  teamId: string,
  input: AddMemberInput,
) {
  if (!isSuperAdmin(actor)) {
    throw forbidden("Only Super Admin can manage team membership");
  }

  const team = await prisma.team.findFirst({
    where: { id: teamId, archivedAt: null },
  });
  if (!team) throw notFound("Team not found");

  const user = await prisma.user.findFirst({
    where: { id: input.userId, deletedAt: null, isActive: true },
  });
  if (!user) throw notFound("User not found");

  const active = await prisma.teamMembership.findFirst({
    where: {
      teamId,
      userId: input.userId,
      isActive: true,
      endedAt: null,
    },
  });
  if (active) {
    throw conflict("User is already an active member of this team");
  }

  const membership = await prisma.teamMembership.create({
    data: {
      teamId,
      userId: input.userId,
      roleInTeam: input.roleInTeam,
      startedAt: input.startedAt ?? new Date(),
      isActive: true,
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "TEAM_MEMBER_ADDED",
      entityType: "TeamMembership",
      entityId: membership.id,
      metadata: { teamId, userId: input.userId },
    },
  });

  return membership;
}

export async function endMember(
  actor: Actor,
  teamId: string,
  membershipId: string,
  endedAt?: Date,
) {
  if (!isSuperAdmin(actor)) {
    throw forbidden("Only Super Admin can manage team membership");
  }

  const membership = await prisma.teamMembership.findFirst({
    where: { id: membershipId, teamId },
  });
  if (!membership) throw notFound("Membership not found");
  if (!membership.isActive || membership.endedAt) {
    throw badRequest("Membership is already ended");
  }

  const updated = await prisma.teamMembership.update({
    where: { id: membershipId },
    data: {
      isActive: false,
      endedAt: endedAt ?? new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "TEAM_MEMBER_ENDED",
      entityType: "TeamMembership",
      entityId: membership.id,
      metadata: { teamId },
    },
  });

  return updated;
}

export async function assertTeamManageableByLead(
  actor: Actor,
  teamId: string,
): Promise<void> {
  if (isSuperAdmin(actor)) return;
  const teamIds = await getActiveTeamIds(prisma, actor.id);
  if (!teamIds.includes(teamId)) {
    throw forbidden("Team is outside your scope");
  }
}
