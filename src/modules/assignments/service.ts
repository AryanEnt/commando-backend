import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AUDIT_ACTIONS, writeAuditLog } from "../../lib/audit.js";
import type { Actor } from "../../lib/authorization.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import {
  assignmentScopeWhere,
  requireRecordAccess,
} from "../../lib/scope.js";
import { totalDaysUnderCommando } from "../../lib/assignmentDays.js";
import type { z } from "zod";
import type {
  createAssignmentSchema,
  endAssignmentSchema,
  listAssignmentsQuerySchema,
  transferAssignmentSchema,
} from "./schemas.js";

type CreateInput = z.infer<typeof createAssignmentSchema>;
type EndInput = z.infer<typeof endAssignmentSchema>;
type TransferInput = z.infer<typeof transferAssignmentSchema>;
type ListQuery = z.infer<typeof listAssignmentsQuerySchema>;

const ACTIVE_CONFLICT_MESSAGE =
  "This Sales Executive is already assigned to an active Commando. End or transfer the existing assignment before creating a new one.";

const assignmentInclude = {
  profile: {
    select: {
      id: true,
      displayName: true,
      userId: true,
      teamId: true,
    },
  },
  commando: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  teamLead: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  team: { select: { id: true, name: true } },
} satisfies Prisma.CommandoAssignmentInclude;

function serializeAssignment(
  assignment: Prisma.CommandoAssignmentGetPayload<{
    include: typeof assignmentInclude;
  }>,
) {
  return {
    id: assignment.id,
    salesExecutiveProfileId: assignment.salesExecutiveProfileId,
    profile: assignment.profile,
    commandoUserId: assignment.commandoUserId,
    commando: assignment.commando,
    teamLeadUserId: assignment.teamLeadUserId,
    teamLead: assignment.teamLead,
    teamId: assignment.teamId,
    team: assignment.team,
    startedAt: assignment.startedAt,
    endedAt: assignment.endedAt,
    status: assignment.status,
    completionReason: assignment.completionReason,
    outcome: assignment.outcome,
    initialProblem: assignment.initialProblem,
    interventionProvided: assignment.interventionProvided,
    improvementObserved: assignment.improvementObserved,
    remainingGaps: assignment.remainingGaps,
    finalCommandoAssessment: assignment.finalCommandoAssessment,
    finalTeamLeadView: assignment.finalTeamLeadView,
    transferredFromId: assignment.transferredFromId,
    transferReason: assignment.transferReason,
    totalDaysUnderCommando: totalDaysUnderCommando(
      assignment.startedAt,
      assignment.endedAt,
    ),
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
  };
}

async function requireCommando(userId: string) {
  const commando = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true },
    include: { role: true },
  });
  if (!commando || commando.role.code !== "COMMANDO_EXECUTIVE") {
    throw badRequest("commandoUserId must be an active Commando Executive");
  }
  return commando;
}

async function requireTeamLead(userId: string) {
  const teamLead = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true },
    include: { role: true },
  });
  if (!teamLead || teamLead.role.code !== "TEAM_LEAD") {
    throw badRequest("teamLeadUserId must be an active Team Lead");
  }
  return teamLead;
}

export async function listAssignments(actor: Actor, query: ListQuery) {
  const scope = await assignmentScopeWhere(prisma, actor);
  const where: Prisma.CommandoAssignmentWhereInput = {
    ...(scope as Prisma.CommandoAssignmentWhereInput),
    ...(query.profileId
      ? { salesExecutiveProfileId: query.profileId }
      : {}),
    ...(query.currentOnly || query.status === "ACTIVE"
      ? { status: "ACTIVE" }
      : query.status
        ? { status: query.status }
        : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.commandoAssignment.count({ where }),
    prisma.commandoAssignment.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: [{ status: "asc" }, { startedAt: "desc" }],
      include: assignmentInclude,
    }),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    assignments: rows.map(serializeAssignment),
  };
}

export async function getAssignment(actor: Actor, assignmentId: string) {
  const assignment = await prisma.commandoAssignment.findUnique({
    where: { id: assignmentId },
    include: assignmentInclude,
  });
  if (!assignment) throw notFound("Assignment not found");

  await requireRecordAccess(prisma, actor, {
    teamId: assignment.teamId,
    profileId: assignment.salesExecutiveProfileId,
    profileUserId: assignment.profile.userId,
    assignmentCommandoUserId: assignment.commandoUserId,
    assignmentTeamLeadUserId: assignment.teamLeadUserId,
    commandoUserId: assignment.commandoUserId,
    teamLeadUserId: assignment.teamLeadUserId,
  });

  return serializeAssignment(assignment);
}

export async function createAssignment(actor: Actor, input: CreateInput) {
  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: input.salesExecutiveProfileId, archivedAt: null },
  });
  if (!profile) throw notFound("Sales executive profile not found");

  const team = await prisma.team.findFirst({
    where: { id: input.teamId, archivedAt: null },
  });
  if (!team) throw notFound("Team not found");

  await Promise.all([
    requireCommando(input.commandoUserId),
    requireTeamLead(input.teamLeadUserId),
  ]);

  try {
    const assignment = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: string; commandoUserId: string }>
      >`
        SELECT id, "commandoUserId"
        FROM "CommandoAssignment"
        WHERE "salesExecutiveProfileId" = ${input.salesExecutiveProfileId}
          AND status = 'ACTIVE'
        FOR UPDATE
      `;
      if (locked[0]) {
        throw conflict(ACTIVE_CONFLICT_MESSAGE);
      }

      return tx.commandoAssignment.create({
        data: {
          salesExecutiveProfileId: input.salesExecutiveProfileId,
          commandoUserId: input.commandoUserId,
          teamLeadUserId: input.teamLeadUserId,
          teamId: input.teamId,
          startedAt: input.startedAt ?? new Date(),
          status: "ACTIVE",
        },
        include: assignmentInclude,
      });
    });

    await writeAuditLog({
      actorId: actor.id,
      action: AUDIT_ACTIONS.COMMANDO_ASSIGNMENT_STARTED,
      entityType: "CommandoAssignment",
      entityId: assignment.id,
      metadata: {
        profileId: assignment.salesExecutiveProfileId,
        commandoUserId: assignment.commandoUserId,
        teamLeadUserId: assignment.teamLeadUserId,
        teamId: assignment.teamId,
        verb: "ASSIGN",
      },
    });

    return serializeAssignment(assignment);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      throw conflict(ACTIVE_CONFLICT_MESSAGE);
    }
    throw err;
  }
}

export async function endAssignment(
  actor: Actor,
  assignmentId: string,
  input: EndInput,
) {
  const existing = await prisma.commandoAssignment.findUnique({
    where: { id: assignmentId },
    include: assignmentInclude,
  });
  if (!existing) throw notFound("Assignment not found");

  await requireRecordAccess(prisma, actor, {
    teamId: existing.teamId,
    profileId: existing.salesExecutiveProfileId,
    profileUserId: existing.profile.userId,
    assignmentCommandoUserId: existing.commandoUserId,
    assignmentTeamLeadUserId: existing.teamLeadUserId,
  });

  if (existing.status !== "ACTIVE") {
    throw badRequest("Only ACTIVE assignments can be ended");
  }

  const endedAt = input.endedAt ?? new Date();
  if (endedAt < existing.startedAt) {
    throw badRequest("endedAt cannot be before startedAt");
  }

  const assignment = await prisma.commandoAssignment.update({
    where: { id: assignmentId },
    data: {
      status: input.status,
      endedAt,
      completionReason: input.completionReason ?? null,
      outcome: input.outcome ?? null,
      initialProblem: input.initialProblem ?? null,
      interventionProvided: input.interventionProvided ?? null,
      improvementObserved: input.improvementObserved ?? null,
      remainingGaps: input.remainingGaps ?? null,
      finalCommandoAssessment: input.finalCommandoAssessment ?? null,
      finalTeamLeadView: input.finalTeamLeadView ?? null,
    },
    include: assignmentInclude,
  });

  await writeAuditLog({
    actorId: actor.id,
    action:
      input.status === "EXITED"
        ? AUDIT_ACTIONS.COMMANDO_ASSIGNMENT_EXITED
        : AUDIT_ACTIONS.COMMANDO_ASSIGNMENT_ENDED,
    entityType: "CommandoAssignment",
    entityId: assignment.id,
    metadata: {
      status: assignment.status,
      endedAt: assignment.endedAt,
      completionReason: assignment.completionReason,
      outcome: assignment.outcome,
      verb: "UNASSIGN",
    },
  });

  if (input.outcome) {
    await writeAuditLog({
      actorId: actor.id,
      action: AUDIT_ACTIONS.INTERVENTION_OUTCOME_RECORDED,
      entityType: "CommandoAssignment",
      entityId: assignment.id,
      metadata: { outcome: input.outcome },
    });
  }

  return serializeAssignment(assignment);
}

export async function transferAssignment(
  actor: Actor,
  assignmentId: string,
  input: TransferInput,
) {
  const existing = await prisma.commandoAssignment.findUnique({
    where: { id: assignmentId },
    include: assignmentInclude,
  });
  if (!existing) throw notFound("Assignment not found");

  await requireRecordAccess(prisma, actor, {
    teamId: existing.teamId,
    profileId: existing.salesExecutiveProfileId,
    profileUserId: existing.profile.userId,
    assignmentCommandoUserId: existing.commandoUserId,
    assignmentTeamLeadUserId: existing.teamLeadUserId,
  });

  if (existing.status !== "ACTIVE") {
    throw badRequest("Only ACTIVE assignments can be transferred");
  }
  if (input.newCommandoUserId === existing.commandoUserId) {
    throw badRequest("Choose a different Commando for the transfer.");
  }

  await requireCommando(input.newCommandoUserId);
  const teamLeadUserId = input.teamLeadUserId ?? existing.teamLeadUserId;
  await requireTeamLead(teamLeadUserId);

  const effectiveAt = input.effectiveAt ?? new Date();
  if (effectiveAt < existing.startedAt) {
    throw badRequest(
      "effectiveAt cannot be before the current assignment started",
    );
  }

  try {
    const next = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "CommandoAssignment"
        WHERE "salesExecutiveProfileId" = ${existing.salesExecutiveProfileId}
          AND status = 'ACTIVE'
        FOR UPDATE
      `;

      await tx.commandoAssignment.update({
        where: { id: existing.id },
        data: {
          status: "COMPLETED",
          endedAt: effectiveAt,
          completionReason: input.reason,
          transferReason: input.reason,
        },
      });

      return tx.commandoAssignment.create({
        data: {
          salesExecutiveProfileId: existing.salesExecutiveProfileId,
          commandoUserId: input.newCommandoUserId,
          teamLeadUserId,
          teamId: existing.teamId,
          startedAt: effectiveAt,
          status: "ACTIVE",
          transferredFromId: existing.id,
          transferReason: input.reason,
        },
        include: assignmentInclude,
      });
    });

    await writeAuditLog({
      actorId: actor.id,
      action: AUDIT_ACTIONS.COMMANDO_ASSIGNMENT_TRANSFERRED,
      entityType: "CommandoAssignment",
      entityId: next.id,
      metadata: {
        fromAssignmentId: existing.id,
        fromCommandoUserId: existing.commandoUserId,
        toCommandoUserId: input.newCommandoUserId,
        reason: input.reason,
        verb: "ASSIGN",
      },
    });

    return serializeAssignment(next);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      throw conflict(ACTIVE_CONFLICT_MESSAGE);
    }
    throw err;
  }
}
