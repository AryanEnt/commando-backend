import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import {
  assertProfileInScope,
  profileScopeWhere,
} from "../../lib/scope.js";
import { totalDaysUnderCommando } from "../../lib/assignmentDays.js";
import type { z } from "zod";
import type {
  createProfileSchema,
  listProfilesQuerySchema,
  updateProfileSchema,
} from "./schemas.js";

type CreateProfileInput = z.infer<typeof createProfileSchema>;
type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
type ListQuery = z.infer<typeof listProfilesQuerySchema>;

function mapAssignmentSummary(
  assignment: {
    id: string;
    startedAt: Date;
    endedAt: Date | null;
    status: string;
    completionReason: string | null;
    commandoUserId: string;
    teamLeadUserId: string;
    teamId: string;
    commando: { id: string; firstName: string; lastName: string; email: string };
    teamLead: { id: string; firstName: string; lastName: string; email: string };
    team: { id: string; name: string };
  } | null,
) {
  if (!assignment) return null;
  return {
    id: assignment.id,
    status: assignment.status,
    startedAt: assignment.startedAt,
    endedAt: assignment.endedAt,
    completionReason: assignment.completionReason,
    teamId: assignment.teamId,
    team: assignment.team,
    commando: assignment.commando,
    teamLead: assignment.teamLead,
    totalDaysUnderCommando: totalDaysUnderCommando(
      assignment.startedAt,
      assignment.endedAt,
    ),
  };
}

export async function listProfiles(actor: Actor, query: ListQuery) {
  const scope = await profileScopeWhere(prisma, actor, {
    includeHistory: query.includeHistory,
  });
  const where: Prisma.SalesExecutiveProfileWhereInput = {
    ...(scope as Prisma.SalesExecutiveProfileWhereInput),
    ...(query.teamId ? { teamId: query.teamId } : {}),
    ...(query.search
      ? {
          OR: [
            { displayName: { contains: query.search, mode: "insensitive" } },
            { employeeCode: { contains: query.search, mode: "insensitive" } },
            {
              user: {
                OR: [
                  { email: { contains: query.search, mode: "insensitive" } },
                  {
                    firstName: { contains: query.search, mode: "insensitive" },
                  },
                  { lastName: { contains: query.search, mode: "insensitive" } },
                ],
              },
            },
          ],
        }
      : {}),
  };

  const [total, profiles] = await Promise.all([
    prisma.salesExecutiveProfile.count({ where }),
    prisma.salesExecutiveProfile.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { displayName: "asc" },
      include: {
        team: { select: { id: true, name: true } },
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        assignments: {
          where: { status: "ACTIVE" },
          take: 1,
          orderBy: { startedAt: "desc" },
          include: {
            commando: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            teamLead: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            team: { select: { id: true, name: true } },
          },
        },
      },
    }),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    profiles: profiles.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      employeeCode: p.employeeCode,
      teamId: p.teamId,
      team: p.team,
      user: p.user,
      currentAssignment: mapAssignmentSummary(p.assignments[0] ?? null),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
  };
}

export async function getProfile(actor: Actor, profileId: string) {
  await assertProfileInScope(prisma, actor, profileId);

  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: profileId },
    include: {
      team: { select: { id: true, name: true } },
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
      assignments: {
        orderBy: { startedAt: "desc" },
        include: {
          commando: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          teamLead: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          team: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!profile) throw notFound("Sales executive profile not found");

  const current = profile.assignments.find((a) => a.status === "ACTIVE") ?? null;
  const history = profile.assignments.filter((a) => a.status !== "ACTIVE");

  return {
    id: profile.id,
    displayName: profile.displayName,
    employeeCode: profile.employeeCode,
    teamId: profile.teamId,
    team: profile.team,
    user: profile.user,
    archivedAt: profile.archivedAt,
    currentAssignment: mapAssignmentSummary(current),
    assignmentHistory: history.map((a) => mapAssignmentSummary(a)),
    totalDaysUnderCommando: current
      ? totalDaysUnderCommando(current.startedAt, current.endedAt)
      : history[0]
        ? totalDaysUnderCommando(history[0].startedAt, history[0].endedAt)
        : 0,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export async function createProfile(actor: Actor, input: CreateProfileInput) {
  if (!isSuperAdmin(actor)) {
    throw forbidden("Only Super Admin can create profiles");
  }

  const user = await prisma.user.findFirst({
    where: { id: input.userId, deletedAt: null },
    include: { role: true, salesExecutiveProfile: true },
  });
  if (!user) throw notFound("User not found");
  if (user.role.code !== "SALES_EXECUTIVE") {
    throw conflict("Profile user must have SALES_EXECUTIVE role");
  }
  if (user.salesExecutiveProfile) {
    throw conflict("User already has a sales executive profile");
  }

  const team = await prisma.team.findFirst({
    where: { id: input.teamId, archivedAt: null },
  });
  if (!team) throw notFound("Team not found");

  const profile = await prisma.salesExecutiveProfile.create({
    data: {
      userId: input.userId,
      teamId: input.teamId,
      displayName: input.displayName,
      employeeCode: input.employeeCode ?? null,
    },
    include: {
      team: { select: { id: true, name: true } },
      user: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "PROFILE_CREATED",
      entityType: "SalesExecutiveProfile",
      entityId: profile.id,
    },
  });

  return profile;
}

export async function updateProfile(
  actor: Actor,
  profileId: string,
  input: UpdateProfileInput,
) {
  if (!isSuperAdmin(actor)) {
    throw forbidden("Only Super Admin can update profiles");
  }

  const existing = await prisma.salesExecutiveProfile.findFirst({
    where: { id: profileId },
  });
  if (!existing) throw notFound("Sales executive profile not found");

  if (input.teamId) {
    const team = await prisma.team.findFirst({
      where: { id: input.teamId, archivedAt: null },
    });
    if (!team) throw notFound("Team not found");
  }

  // Changing profile.teamId does NOT rewrite historical CommandoAssignment.teamId
  const profile = await prisma.salesExecutiveProfile.update({
    where: { id: profileId },
    data: {
      teamId: input.teamId,
      displayName: input.displayName,
      employeeCode: input.employeeCode,
      archivedAt: input.archivedAt === undefined ? undefined : input.archivedAt,
    },
    include: {
      team: { select: { id: true, name: true } },
      user: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "PROFILE_UPDATED",
      entityType: "SalesExecutiveProfile",
      entityId: profile.id,
      metadata: {
        teamChanged:
          input.teamId !== undefined && input.teamId !== existing.teamId,
        previousTeamId: existing.teamId,
        newTeamId: profile.teamId,
      },
    },
  });

  return profile;
}
