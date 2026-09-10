import type { MembershipRole, Prisma, RoleCode } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import {
  AppError,
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "../../lib/errors.js";
import { hashPassword } from "../../lib/password.js";
import { AUDIT_ACTIONS, writeAuditLog } from "../../lib/audit.js";
import type {
  createSalesExecutiveSchema,
  createUserSchema,
  listUsersQuerySchema,
  updateUserRoleSchema,
  updateUserSchema,
  updateUserStatusSchema,
} from "./schemas.js";

type CreateUserInput = z.infer<typeof createUserSchema>;
type UpdateUserInput = z.infer<typeof updateUserSchema>;
type UpdateStatusInput = z.infer<typeof updateUserStatusSchema>;
type UpdateRoleInput = z.infer<typeof updateUserRoleSchema>;
type CreateSalesExecutiveInput = z.infer<typeof createSalesExecutiveSchema>;
type ListQuery = z.infer<typeof listUsersQuerySchema>;

const userPublicSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, code: true, name: true } },
} satisfies Prisma.UserSelect;

function membershipRoleFor(roleCode: RoleCode): MembershipRole {
  switch (roleCode) {
    case "TEAM_LEAD":
      return "TEAM_LEAD";
    case "SALES_EXECUTIVE":
      return "SALES_EXECUTIVE";
    case "SALES_SUPPORT_EXECUTIVE":
      return "SALES_SUPPORT_EXECUTIVE";
    default:
      return "MEMBER";
  }
}

function mapListUser(
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    role: { id: string; code: RoleCode; name: string };
    teamMemberships: Array<{
      id: string;
      roleInTeam: MembershipRole;
      isActive: boolean;
      team: { id: string; name: string };
    }>;
    salesExecutiveProfile: {
      id: string;
      displayName: string;
      archivedAt: Date | null;
      team: { id: string; name: string };
    } | null;
  },
) {
  const activeMembership = user.teamMemberships[0] ?? null;
  const profile = user.salesExecutiveProfile;
  let profileStatus: "created" | "missing" | "n_a" = "n_a";
  if (user.role.code === "SALES_EXECUTIVE") {
    profileStatus = profile && !profile.archivedAt ? "created" : "missing";
  }

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    isActive: user.isActive,
    role: user.role,
    team: activeMembership
      ? {
          id: activeMembership.team.id,
          name: activeMembership.team.name,
          membershipId: activeMembership.id,
          roleInTeam: activeMembership.roleInTeam,
        }
      : null,
    profileStatus,
    profile: profile
      ? {
          id: profile.id,
          displayName: profile.displayName,
          archivedAt: profile.archivedAt,
          team: profile.team,
        }
      : null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function resolveRole(roleCode: RoleCode) {
  const role = await prisma.role.findUnique({ where: { code: roleCode } });
  if (!role) throw badRequest("The selected role could not be found.");
  return role;
}

async function assertEmailAvailable(email: string, excludeUserId?: string) {
  const existing = await prisma.user.findFirst({
    where: {
      email,
      deletedAt: null,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { id: true, role: { select: { code: true } }, salesExecutiveProfile: { select: { id: true } } },
  });
  if (!existing) return;
  throw conflict("An account with this email already exists.");
}

async function assertTeamActive(teamId: string) {
  const team = await prisma.team.findFirst({
    where: { id: teamId, archivedAt: null },
  });
  if (!team) throw notFound("The selected team could not be found.");
  return team;
}

async function ensureTeamMembership(
  tx: Prisma.TransactionClient,
  actorId: string,
  userId: string,
  teamId: string,
  roleInTeam: MembershipRole,
) {
  const active = await tx.teamMembership.findFirst({
    where: {
      teamId,
      userId,
      isActive: true,
      endedAt: null,
    },
  });
  if (active) return active;

  const membership = await tx.teamMembership.create({
    data: {
      teamId,
      userId,
      roleInTeam,
      isActive: true,
    },
  });

  await writeAuditLog(
    {
      actorId,
      action: AUDIT_ACTIONS.TEAM_MEMBER_ADDED,
      entityType: "TeamMembership",
      entityId: membership.id,
      metadata: { teamId, userId, roleInTeam },
    },
    tx,
  );

  return membership;
}

async function revokeRefreshTokens(
  userId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  await client.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function listUsers(_actor: Actor, query: ListQuery) {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
  };

  if (query.search) {
    where.OR = [
      { email: { contains: query.search, mode: "insensitive" } },
      { firstName: { contains: query.search, mode: "insensitive" } },
      { lastName: { contains: query.search, mode: "insensitive" } },
    ];
  }
  if (query.roleCode) where.role = { code: query.roleCode };
  if (query.isActive !== undefined) where.isActive = query.isActive;
  if (query.teamId) {
    where.teamMemberships = {
      some: {
        teamId: query.teamId,
        isActive: true,
        endedAt: null,
      },
    };
  }
  if (query.profileStatus === "created") {
    where.role = { code: "SALES_EXECUTIVE" };
    where.salesExecutiveProfile = { is: { archivedAt: null } };
  } else if (query.profileStatus === "missing") {
    where.role = { code: "SALES_EXECUTIVE" };
    where.salesExecutiveProfile = { is: null };
  } else if (query.profileStatus === "n_a") {
    where.role = { code: { not: "SALES_EXECUTIVE" } };
  }

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        ...userPublicSelect,
        teamMemberships: {
          where: { isActive: true, endedAt: null },
          take: 1,
          orderBy: { startedAt: "desc" },
          select: {
            id: true,
            roleInTeam: true,
            isActive: true,
            team: { select: { id: true, name: true } },
          },
        },
        salesExecutiveProfile: {
          select: {
            id: true,
            displayName: true,
            archivedAt: true,
            team: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { [query.sort]: query.order },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    users: rows.map(mapListUser),
  };
}

export async function getUser(_actor: Actor, userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      ...userPublicSelect,
      teamMemberships: {
        where: { isActive: true, endedAt: null },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          roleInTeam: true,
          isActive: true,
          startedAt: true,
          team: { select: { id: true, name: true, description: true } },
        },
      },
      salesExecutiveProfile: {
        select: {
          id: true,
          displayName: true,
          employeeCode: true,
          archivedAt: true,
          createdAt: true,
          updatedAt: true,
          team: { select: { id: true, name: true } },
          assignments: {
            where: { status: "ACTIVE" },
            take: 1,
            orderBy: { startedAt: "desc" },
            select: {
              id: true,
              status: true,
              startedAt: true,
              commando: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!user) throw notFound("User not found");

  const activeMembership = user.teamMemberships[0] ?? null;
  const profile = user.salesExecutiveProfile;
  const currentAssignment = profile?.assignments[0] ?? null;

  let profileStatus: "created" | "missing" | "n_a" = "n_a";
  if (user.role.code === "SALES_EXECUTIVE") {
    profileStatus = profile && !profile.archivedAt ? "created" : "missing";
  }

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    isActive: user.isActive,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    team: activeMembership
      ? {
          id: activeMembership.team.id,
          name: activeMembership.team.name,
          description: activeMembership.team.description,
          membershipId: activeMembership.id,
          roleInTeam: activeMembership.roleInTeam,
          startedAt: activeMembership.startedAt,
        }
      : null,
    memberships: user.teamMemberships.map((m) => ({
      id: m.id,
      roleInTeam: m.roleInTeam,
      startedAt: m.startedAt,
      team: m.team,
    })),
    profileStatus,
    profile: profile
      ? {
          id: profile.id,
          displayName: profile.displayName,
          employeeCode: profile.employeeCode,
          archivedAt: profile.archivedAt,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
          team: profile.team,
          currentAssignment: currentAssignment
            ? {
                id: currentAssignment.id,
                status: currentAssignment.status,
                startedAt: currentAssignment.startedAt,
                commando: currentAssignment.commando,
              }
            : null,
        }
      : null,
  };
}

export async function getUserProfile(actor: Actor, userId: string) {
  const detail = await getUser(actor, userId);
  if (detail.role.code !== "SALES_EXECUTIVE") {
    throw badRequest("This user is not a Sales Executive.");
  }
  return {
    profileStatus: detail.profileStatus,
    profile: detail.profile,
  };
}

export async function createUser(actor: Actor, input: CreateUserInput) {
  if (!isSuperAdmin(actor)) {
    throw forbidden("Only Super Admin can create users");
  }

  await assertEmailAvailable(input.email);
  const role = await resolveRole(input.roleCode);

  if (input.teamId) {
    await assertTeamActive(input.teamId);
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        passwordHash,
        roleId: role.id,
        isActive: input.isActive,
      },
      select: userPublicSelect,
    });

    if (input.teamId) {
      await ensureTeamMembership(
        tx,
        actor.id,
        created.id,
        input.teamId,
        membershipRoleFor(input.roleCode),
      );
    }

    await writeAuditLog(
      {
        actorId: actor.id,
        action: AUDIT_ACTIONS.USER_CREATED,
        entityType: "User",
        entityId: created.id,
        metadata: {
          email: created.email,
          roleCode: created.role.code,
          teamId: input.teamId ?? null,
        },
      },
      tx,
    );

    return created;
  });

  return getUser(actor, user.id);
}

export async function updateUser(
  actor: Actor,
  userId: string,
  input: UpdateUserInput,
) {
  if (!isSuperAdmin(actor)) {
    throw forbidden("Only Super Admin can update users");
  }

  const existing = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, email: true },
  });
  if (!existing) throw notFound("User not found");

  if (input.email && input.email !== existing.email) {
    await assertEmailAvailable(input.email, userId);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
      },
      select: userPublicSelect,
    });

    await writeAuditLog(
      {
        actorId: actor.id,
        action: AUDIT_ACTIONS.USER_UPDATED,
        entityType: "User",
        entityId: user.id,
        metadata: {
          fields: Object.keys(input),
          emailChanged: Boolean(input.email && input.email !== existing.email),
        },
      },
      tx,
    );

    return user;
  });

  return getUser(actor, updated.id);
}

export async function changeUserStatus(
  actor: Actor,
  userId: string,
  input: UpdateStatusInput,
) {
  if (!isSuperAdmin(actor)) {
    throw forbidden("Only Super Admin can change user status");
  }
  if (actor.id === userId) {
    throw badRequest("You cannot change your own account status.");
  }

  const existing = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, isActive: true, email: true },
  });
  if (!existing) throw notFound("User not found");
  if (existing.isActive === input.isActive) {
    return getUser(actor, userId);
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { isActive: input.isActive },
    });

    if (!input.isActive) {
      await revokeRefreshTokens(userId, tx);
    }

    await writeAuditLog(
      {
        actorId: actor.id,
        action: input.isActive
          ? AUDIT_ACTIONS.USER_ACTIVATED
          : AUDIT_ACTIONS.USER_DEACTIVATED,
        entityType: "User",
        entityId: userId,
        metadata: { email: existing.email, isActive: input.isActive },
      },
      tx,
    );
  });

  return getUser(actor, userId);
}

async function assertRoleChangeAllowed(
  userId: string,
  fromRole: RoleCode,
  toRole: RoleCode,
) {
  if (fromRole === toRole) return;

  if (fromRole === "SALES_EXECUTIVE") {
    const activeAssignment = await prisma.commandoAssignment.findFirst({
      where: {
        status: "ACTIVE",
        profile: { userId },
      },
      select: { id: true },
    });
    if (activeAssignment) {
      throw conflict(
        "This user has an active Sales Executive assignment. Resolve the active assignment before changing their role.",
      );
    }

    const profile = await prisma.salesExecutiveProfile.findFirst({
      where: { userId, archivedAt: null },
      select: { id: true },
    });
    if (profile) {
      throw conflict(
        "This user has a Sales Executive profile. Archive or resolve the profile before changing their role.",
      );
    }
  }

  if (fromRole === "COMMANDO_EXECUTIVE") {
    const active = await prisma.commandoAssignment.findFirst({
      where: { commandoUserId: userId, status: "ACTIVE" },
      select: { id: true },
    });
    if (active) {
      throw conflict(
        "This user has an active Commando assignment. End the assignment before changing their role.",
      );
    }
  }

  if (fromRole === "TEAM_LEAD") {
    const active = await prisma.commandoAssignment.findFirst({
      where: { teamLeadUserId: userId, status: "ACTIVE" },
      select: { id: true },
    });
    if (active) {
      throw conflict(
        "This user is the Team Lead on an active assignment. Resolve the assignment before changing their role.",
      );
    }
  }

  if (fromRole === "SALES_SUPPORT_EXECUTIVE") {
    const active = await prisma.salesSupportLink.findFirst({
      where: {
        salesSupportUserId: userId,
        isActive: true,
        endedAt: null,
      },
      select: { id: true },
    });
    if (active) {
      throw conflict(
        "This user has an active Sales Support link. End the support link before changing their role.",
      );
    }
  }
}

export async function changeUserRole(
  actor: Actor,
  userId: string,
  input: UpdateRoleInput,
) {
  if (!isSuperAdmin(actor)) {
    throw forbidden("Only Super Admin can change user roles");
  }
  if (actor.id === userId) {
    throw badRequest("You cannot change your own role.");
  }

  const existing = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: { role: true },
  });
  if (!existing) throw notFound("User not found");

  await assertRoleChangeAllowed(
    userId,
    existing.role.code,
    input.roleCode,
  );

  if (existing.role.code === input.roleCode) {
    return getUser(actor, userId);
  }

  const nextRole = await resolveRole(input.roleCode);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { roleId: nextRole.id },
    });

    await revokeRefreshTokens(userId, tx);

    await writeAuditLog(
      {
        actorId: actor.id,
        action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
        entityType: "User",
        entityId: userId,
        metadata: {
          fromRole: existing.role.code,
          toRole: input.roleCode,
        },
      },
      tx,
    );
  });

  return getUser(actor, userId);
}

/**
 * Transactional Sales Executive onboarding:
 * User (SALES_EXECUTIVE) → TeamMembership → SalesExecutiveProfile
 */
export async function createSalesExecutive(
  actor: Actor,
  input: CreateSalesExecutiveInput,
) {
  if (!isSuperAdmin(actor)) {
    throw forbidden("Only Super Admin can create Sales Executives");
  }

  const existing = await prisma.user.findFirst({
    where: { email: input.email, deletedAt: null },
    include: {
      role: true,
      salesExecutiveProfile: true,
    },
  });

  if (existing) {
    if (existing.role.code === "SALES_EXECUTIVE") {
      if (existing.salesExecutiveProfile) {
        throw conflict(
          "This user already has a Sales Executive profile. Open the existing profile instead.",
        );
      }
      throw conflict(
        "A Sales Executive account with this email already exists. Create a profile for that user from Profiles, or use a different email.",
      );
    }
    throw conflict(
      "An account with this email already exists with a different role. Use role management if an authorized role change is required.",
    );
  }

  const team = await assertTeamActive(input.teamId);
  const role = await resolveRole("SALES_EXECUTIVE");
  const passwordHash = await hashPassword(input.password);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash,
          roleId: role.id,
          isActive: input.isActive,
        },
        select: userPublicSelect,
      });

      await ensureTeamMembership(
        tx,
        actor.id,
        user.id,
        team.id,
        "SALES_EXECUTIVE",
      );

      const profile = await tx.salesExecutiveProfile.create({
        data: {
          userId: user.id,
          teamId: team.id,
          displayName: input.displayName,
          employeeCode: input.employeeCode ?? null,
        },
        include: {
          team: { select: { id: true, name: true } },
        },
      });

      await writeAuditLog(
        {
          actorId: actor.id,
          action: AUDIT_ACTIONS.USER_CREATED,
          entityType: "User",
          entityId: user.id,
          metadata: {
            email: user.email,
            roleCode: "SALES_EXECUTIVE",
            via: "sales_executive_onboarding",
          },
        },
        tx,
      );

      await writeAuditLog(
        {
          actorId: actor.id,
          action: AUDIT_ACTIONS.SALES_EXECUTIVE_PROFILE_CREATED,
          entityType: "SalesExecutiveProfile",
          entityId: profile.id,
          metadata: {
            userId: user.id,
            teamId: team.id,
            displayName: profile.displayName,
          },
        },
        tx,
      );

      await writeAuditLog(
        {
          actorId: actor.id,
          action: AUDIT_ACTIONS.SALES_EXECUTIVE_CREATED,
          entityType: "User",
          entityId: user.id,
          metadata: {
            profileId: profile.id,
            teamId: team.id,
            displayName: profile.displayName,
          },
        },
        tx,
      );

      // Keep PROFILE_CREATED for continuity with existing profile audit trail.
      await writeAuditLog(
        {
          actorId: actor.id,
          action: AUDIT_ACTIONS.PROFILE_CREATED,
          entityType: "SalesExecutiveProfile",
          entityId: profile.id,
          metadata: { via: "sales_executive_onboarding" },
        },
        tx,
      );

      return { user, profile };
    });

    const detail = await getUser(actor, result.user.id);
    return {
      user: detail,
      profile: {
        id: result.profile.id,
        displayName: result.profile.displayName,
        employeeCode: result.profile.employeeCode,
        team: result.profile.team,
      },
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      throw conflict("An account with this email already exists.");
    }
    throw badRequest(
      "Unable to create the Sales Executive. No changes were saved.",
    );
  }
}
