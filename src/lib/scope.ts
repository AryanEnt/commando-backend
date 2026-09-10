import type { PrismaClient } from "@prisma/client";
import type { Actor } from "./authorization.js";
import { isSuperAdmin } from "./authorization.js";
import { forbidden, notFound } from "./errors.js";

export type RecordAccessContext = {
  teamId?: string | null;
  profileId?: string | null;
  profileUserId?: string | null;
  commandoUserId?: string | null;
  teamLeadUserId?: string | null;
  salesSupportUserId?: string | null;
  assignmentCommandoUserId?: string | null;
  assignmentTeamLeadUserId?: string | null;
};

export async function getActiveTeamIds(
  prisma: PrismaClient,
  userId: string,
): Promise<string[]> {
  const memberships = await prisma.teamMembership.findMany({
    where: { userId, isActive: true, endedAt: null },
    select: { teamId: true },
  });
  return memberships.map((m) => m.teamId);
}

/**
 * Record-scope authorization.
 * Permission to view a resource type does NOT grant access to every record.
 */
export async function requireRecordAccess(
  prisma: PrismaClient,
  user: Actor,
  context: RecordAccessContext,
): Promise<void> {
  if (isSuperAdmin(user)) {
    return;
  }

  switch (user.roleCode) {
    case "TEAM_LEAD": {
      const teamIds = await getActiveTeamIds(prisma, user.id);
      const ok =
        (context.teamId && teamIds.includes(context.teamId)) ||
        (context.teamLeadUserId && context.teamLeadUserId === user.id) ||
        (context.assignmentTeamLeadUserId &&
          context.assignmentTeamLeadUserId === user.id);
      if (!ok) {
        throw forbidden("Record is outside your team scope");
      }
      return;
    }
    case "COMMANDO_EXECUTIVE": {
      const ok =
        context.commandoUserId === user.id ||
        context.assignmentCommandoUserId === user.id ||
        (await isAssignedCommandoToProfile(
          prisma,
          user.id,
          context.profileId,
        ));
      if (!ok) {
        throw forbidden("Record is outside your assignment scope");
      }
      return;
    }
    case "SALES_EXECUTIVE": {
      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { userId: user.id, archivedAt: null },
        select: { id: true },
      });
      if (!profile) {
        throw forbidden("No sales executive profile linked to this user");
      }
      const ok =
        context.profileId === profile.id || context.profileUserId === user.id;
      if (!ok) {
        throw forbidden("You may only access your own profile records");
      }
      return;
    }
    case "SALES_SUPPORT_EXECUTIVE": {
      const ok =
        context.salesSupportUserId === user.id ||
        (context.profileId
          ? await hasActiveSupportLink(prisma, user.id, context.profileId)
          : false);
      if (!ok) {
        throw forbidden("Record is outside your sales support scope");
      }
      return;
    }
    default:
      throw forbidden("Unknown role scope");
  }
}

export async function assertProfileInScope(
  prisma: PrismaClient,
  user: Actor,
  profileId: string,
): Promise<void> {
  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: profileId, archivedAt: null },
    select: {
      id: true,
      userId: true,
      teamId: true,
    },
  });
  if (!profile) {
    throw notFound("Sales executive profile not found");
  }

  const assignment = await prisma.commandoAssignment.findFirst({
    where: {
      salesExecutiveProfileId: profileId,
      ...(user.roleCode === "COMMANDO_EXECUTIVE"
        ? { commandoUserId: user.id }
        : {}),
    },
    orderBy: [{ status: "asc" }, { startedAt: "desc" }],
    select: {
      commandoUserId: true,
      teamLeadUserId: true,
      status: true,
    },
  });

  await requireRecordAccess(prisma, user, {
    teamId: profile.teamId,
    profileId: profile.id,
    profileUserId: profile.userId,
    assignmentCommandoUserId: assignment?.commandoUserId,
    assignmentTeamLeadUserId: assignment?.teamLeadUserId,
    salesSupportUserId: undefined,
  });
}

/** Team list/filter scope. */
export async function teamScopeWhere(
  prisma: PrismaClient,
  user: Actor,
): Promise<Record<string, unknown>> {
  if (isSuperAdmin(user)) {
    return { archivedAt: null };
  }
  if (user.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, user.id);
    return { archivedAt: null, id: { in: teamIds } };
  }
  return { id: "__none__" };
}

/** Assignment list scope — includes historical rows for the actor. */
export async function assignmentScopeWhere(
  prisma: PrismaClient,
  user: Actor,
): Promise<Record<string, unknown>> {
  if (isSuperAdmin(user)) {
    return {};
  }

  switch (user.roleCode) {
    case "TEAM_LEAD": {
      const teamIds = await getActiveTeamIds(prisma, user.id);
      return {
        OR: [{ teamId: { in: teamIds } }, { teamLeadUserId: user.id }],
      };
    }
    case "COMMANDO_EXECUTIVE":
      return { commandoUserId: user.id };
    case "SALES_EXECUTIVE": {
      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { userId: user.id },
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

async function isAssignedCommandoToProfile(
  prisma: PrismaClient,
  commandoUserId: string,
  profileId?: string | null,
): Promise<boolean> {
  if (!profileId) return false;
  const assignment = await prisma.commandoAssignment.findFirst({
    where: {
      salesExecutiveProfileId: profileId,
      commandoUserId,
    },
    select: { id: true },
  });
  return Boolean(assignment);
}

async function hasActiveSupportLink(
  prisma: PrismaClient,
  supportUserId: string,
  profileId: string,
): Promise<boolean> {
  const link = await prisma.salesSupportLink.findFirst({
    where: {
      salesSupportUserId: supportUserId,
      salesExecutiveProfileId: profileId,
      isActive: true,
      endedAt: null,
    },
    select: { id: true },
  });
  return Boolean(link);
}

/** Build Prisma where fragment for listing profiles in the actor's scope. */
export async function profileScopeWhere(
  prisma: PrismaClient,
  user: Actor,
  options?: { includeHistory?: boolean },
): Promise<Record<string, unknown>> {
  if (isSuperAdmin(user)) {
    return { archivedAt: null };
  }

  switch (user.roleCode) {
    case "TEAM_LEAD": {
      const teamIds = await getActiveTeamIds(prisma, user.id);
      return { archivedAt: null, teamId: { in: teamIds } };
    }
    case "COMMANDO_EXECUTIVE": {
      const assignments = await prisma.commandoAssignment.findMany({
        where: {
          commandoUserId: user.id,
          ...(options?.includeHistory ? {} : { status: "ACTIVE" }),
        },
        select: { salesExecutiveProfileId: true },
      });
      return {
        archivedAt: null,
        id: {
          in: assignments.map((a) => a.salesExecutiveProfileId),
        },
      };
    }
    case "SALES_EXECUTIVE":
      return { archivedAt: null, userId: user.id };
    case "SALES_SUPPORT_EXECUTIVE": {
      const links = await prisma.salesSupportLink.findMany({
        where: {
          salesSupportUserId: user.id,
          isActive: true,
          endedAt: null,
        },
        select: { salesExecutiveProfileId: true },
      });
      return {
        archivedAt: null,
        id: { in: links.map((l) => l.salesExecutiveProfileId) },
      };
    }
    default:
      return { id: "__none__" };
  }
}
