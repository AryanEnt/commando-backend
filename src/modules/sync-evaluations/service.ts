import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { getActiveTeamIds } from "../../lib/scope.js";
import type {
  CreateSyncEvaluationInput,
  ListSyncEvaluationsQuery,
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

const evalInclude = {
  profile: {
    select: { id: true, displayName: true, userId: true, teamId: true },
  },
  salesSupportUser: userBrief,
  createdBy: userBrief,
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
  salesSupportLink: {
    select: {
      id: true,
      isActive: true,
      startedAt: true,
      endedAt: true,
    },
  },
} satisfies Prisma.SyncEvaluationInclude;

type EvalRow = Prisma.SyncEvaluationGetPayload<{ include: typeof evalInclude }>;

type UserBrief = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role?: { code: string };
};

async function loadUsers(ids: string[]): Promise<Map<string, UserBrief>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: { select: { code: true } },
    },
  });
  return new Map(users.map((u) => [u.id, u]));
}

function serialize(row: EvalRow, extras: Map<string, UserBrief>) {
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
    issue: row.issue,
    recommendedAction: row.recommendedAction,
    createdById: row.createdById,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function serializeMany(rows: EvalRow[]) {
  const ids = rows.flatMap((r) =>
    r.assignment
      ? [r.assignment.commandoUserId, r.assignment.teamLeadUserId]
      : [],
  );
  const extras = await loadUsers(ids);
  return rows.map((r) => serialize(r, extras));
}

async function scopeWhere(
  actor: Actor,
): Promise<Prisma.SyncEvaluationWhereInput> {
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
        OR: [
          { profile: { teamId: { in: teamIds } } },
          { assignment: { teamLeadUserId: actor.id } },
          { assignment: { teamId: { in: teamIds } } },
        ],
      };
    }
    case "SALES_SUPPORT_EXECUTIVE":
      return {
        archivedAt: null,
        salesSupportUserId: actor.id,
      };
    default:
      return { id: "__none__" };
  }
}

async function assertCanAccess(actor: Actor, row: EvalRow): Promise<void> {
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
      throw forbidden("Sync evaluation is outside your assignment scope");
    }
    return;
  }

  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    const ok =
      teamIds.includes(row.profile.teamId) ||
      (row.assignment &&
        (row.assignment.teamLeadUserId === actor.id ||
          teamIds.includes(row.assignment.teamId)));
    if (!ok) {
      throw forbidden("Sync evaluation is outside your team scope");
    }
    return;
  }

  if (actor.roleCode === "SALES_SUPPORT_EXECUTIVE") {
    if (row.salesSupportUserId !== actor.id) {
      throw forbidden("You may only view evaluations linked to you");
    }
    return;
  }

  throw forbidden("Not allowed to access sync evaluations");
}

export async function listSupportLinksForProfile(
  actor: Actor,
  profileId: string,
) {
  if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    !isSuperAdmin(actor)
  ) {
    throw forbidden("Only Commandos can list support links for evaluation");
  }

  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: profileId, archivedAt: null },
  });
  if (!profile) throw notFound("Sales executive profile not found");

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    const assignment = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: profileId,
        commandoUserId: actor.id,
        status: "ACTIVE",
      },
    });
    if (!assignment) {
      throw forbidden("No active assignment for this profile");
    }
  }

  const links = await prisma.salesSupportLink.findMany({
    where: {
      salesExecutiveProfileId: profileId,
      isActive: true,
      endedAt: null,
    },
    include: {
      supportUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: { select: { code: true } },
        },
      },
    },
    orderBy: { startedAt: "desc" },
  });

  return links.map((link) => ({
    id: link.id,
    salesExecutiveProfileId: link.salesExecutiveProfileId,
    salesSupportUserId: link.salesSupportUserId,
    supportUser: link.supportUser,
    startedAt: link.startedAt,
    isActive: link.isActive,
  }));
}

export async function listSyncEvaluations(
  actor: Actor,
  query: ListSyncEvaluationsQuery,
) {
  const scope = await scopeWhere(actor);
  const where: Prisma.SyncEvaluationWhereInput = {
    AND: [
      scope,
      ...(query.profileId
        ? [{ salesExecutiveProfileId: query.profileId }]
        : []),
      ...(query.salesSupportUserId
        ? [{ salesSupportUserId: query.salesSupportUserId }]
        : []),
      ...(query.search
        ? [
            {
              OR: [
                {
                  issue: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  recommendedAction: {
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
    prisma.syncEvaluation.count({ where }),
    prisma.syncEvaluation.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: "desc" },
      include: evalInclude,
    }),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    evaluations: await serializeMany(rows),
  };
}

export async function getSyncEvaluation(actor: Actor, id: string) {
  const row = await prisma.syncEvaluation.findFirst({
    where: { id, archivedAt: null },
    include: evalInclude,
  });
  if (!row) throw notFound("Sync evaluation not found");
  await assertCanAccess(actor, row);
  const extras = await loadUsers(
    row.assignment
      ? [row.assignment.commandoUserId, row.assignment.teamLeadUserId]
      : [],
  );
  return serialize(row, extras);
}

export async function createSyncEvaluation(
  actor: Actor,
  input: CreateSyncEvaluationInput,
) {
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for sync evaluations");
  }
  if (actor.roleCode !== "COMMANDO_EXECUTIVE") {
    throw forbidden("Only Commandos can create sync evaluations");
  }

  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: input.salesExecutiveProfileId, archivedAt: null },
  });
  if (!profile) throw notFound("Sales executive profile not found");

  const assignment = await prisma.commandoAssignment.findFirst({
    where: {
      salesExecutiveProfileId: profile.id,
      commandoUserId: actor.id,
      status: "ACTIVE",
    },
  });
  if (!assignment) {
    throw forbidden(
      "You may only create sync evaluations for profiles with an active assignment to you",
    );
  }
  const assignmentId = assignment.id;

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
      "No active Sales Executive ↔ Sales Support relationship for this pair",
    );
  }

  const created = await prisma.syncEvaluation.create({
    data: {
      salesExecutiveProfileId: profile.id,
      salesSupportUserId: supportUser.id,
      salesSupportLinkId: link.id,
      assignmentId,
      issue: input.issue,
      recommendedAction: input.recommendedAction,
      createdById: actor.id,
    },
    include: evalInclude,
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "SYNC_EVAL_CREATED",
      entityType: "SyncEvaluation",
      entityId: created.id,
      metadata: {
        profileId: profile.id,
        salesSupportUserId: supportUser.id,
        assignmentId,
        salesSupportLinkId: link.id,
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
