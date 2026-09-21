import type { PerformanceSource, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../lib/audit.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { assertProfileInScope, getActiveTeamIds } from "../../lib/scope.js";
import { totalDaysUnderCommando } from "../../lib/assignmentDays.js";
import {
  getCommandoLifecycleState,
  roleCanViewCommandoPerformance,
  salesExecutiveCanViewCoachingSource,
} from "../../lib/lifecycleVisibility.js";
import { assertTeamLeadOperationalWriteAllowed } from "../../lib/teamLeadLock.js";
import type {
  CreatePerformanceInput,
  ListPerformanceQuery,
} from "./schemas.js";

const evalInclude = {
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
  scores: { orderBy: { metricCode: "asc" as const } },
} satisfies Prisma.PerformanceEvaluationInclude;

type EvalRow = Prisma.PerformanceEvaluationGetPayload<{
  include: typeof evalInclude;
}>;

function sourceForRole(roleCode: Actor["roleCode"]): PerformanceSource {
  switch (roleCode) {
    case "TEAM_LEAD":
      return "TEAM_LEAD";
    case "COMMANDO_EXECUTIVE":
      return "COMMANDO";
    default:
      throw forbidden("Your role cannot create performance evaluations");
  }
}

function averageScore(scores: { scoreValue: { toNumber?: () => number } | number | string }[]) {
  if (scores.length === 0) return null;
  const values = scores.map((s) => {
    const v = s.scoreValue;
    if (typeof v === "number") return v;
    if (typeof v === "string") return Number(v);
    if (v && typeof v.toNumber === "function") return v.toNumber();
    return Number(v);
  });
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function serialize(row: EvalRow) {
  const scores = row.scores.map((s) => ({
    id: s.id,
    metricCode: s.metricCode,
    metricLabel: s.metricLabel,
    scoreValue: Number(s.scoreValue),
    createdAt: s.createdAt,
  }));
  const computedAverage = averageScore(row.scores);
  const rating =
    row.rating != null ? Number(row.rating) : computedAverage != null
      ? Number((computedAverage / 20).toFixed(2)) // 0-100 metric → 0-5 scale
      : null;

  return {
    id: row.id,
    salesExecutiveProfileId: row.salesExecutiveProfileId,
    profile: row.profile,
    assignmentId: row.assignmentId,
    assignment: row.assignment,
    source: row.source,
    summary: row.summary,
    verdict: row.verdict,
    rating,
    scores,
    averageMetricScore: computedAverage != null
      ? Number(computedAverage.toFixed(2))
      : null,
    evaluatedAt: row.evaluatedAt,
    createdById: row.createdById,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function scopeWhere(
  actor: Actor,
): Promise<Prisma.PerformanceEvaluationWhereInput> {
  if (isSuperAdmin(actor)) {
    return { archivedAt: null };
  }

  switch (actor.roleCode) {
    case "TEAM_LEAD": {
      const teamIds = await getActiveTeamIds(prisma, actor.id);
      return {
        archivedAt: null,
        source: "TEAM_LEAD",
        profile: { teamId: { in: teamIds } },
      };
    }
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
        salesExecutiveProfileId: { in: profileIds },
        source: { in: ["TEAM_LEAD", "COMMANDO"] },
      };
    }
    case "SALES_EXECUTIVE": {
      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { userId: actor.id, archivedAt: null },
        select: { id: true },
      });
      if (!profile) return { id: "__none__" };
      const lifecycle = await getCommandoLifecycleState(prisma, profile.id);
      const sources: PerformanceSource[] = ["TEAM_LEAD"];
      if (lifecycle.isAfterCommando) sources.push("COMMANDO");
      return {
        archivedAt: null,
        salesExecutiveProfileId: profile.id,
        source: { in: sources },
      };
    }
    default:
      return { id: "__none__" };
  }
}

async function assertCanAccess(actor: Actor, row: EvalRow): Promise<void> {
  if (isSuperAdmin(actor)) return;

  if (actor.roleCode === "TEAM_LEAD") {
    if (row.source !== "TEAM_LEAD") {
      throw forbidden("Team Leads may only view Team Lead performance");
    }
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(row.profile.teamId)) {
      throw forbidden("Performance is outside your team scope");
    }
    return;
  }

  if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    const assigned = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: row.salesExecutiveProfileId,
        commandoUserId: actor.id,
      },
      select: { id: true },
    });
    if (!assigned) {
      throw forbidden("Performance is outside your assignment scope");
    }
    return;
  }

  if (actor.roleCode === "SALES_EXECUTIVE") {
    if (row.profile.userId !== actor.id) {
      throw forbidden("You may only view your own performance");
    }
    const lifecycle = await getCommandoLifecycleState(
      prisma,
      row.salesExecutiveProfileId,
    );
    if (row.source === "COMMANDO") {
      if (!roleCanViewCommandoPerformance(actor.roleCode, lifecycle)) {
        throw forbidden(
          "Commando performance is not visible during an active Commando assignment",
        );
      }
    } else if (!salesExecutiveCanViewCoachingSource(row.source, lifecycle)) {
      throw forbidden("Performance evaluation is not visible");
    }
    return;
  }

  throw forbidden("Not allowed to access performance evaluations");
}

export async function listPerformance(
  actor: Actor,
  query: ListPerformanceQuery,
) {
  const scope = await scopeWhere(actor);
  const where: Prisma.PerformanceEvaluationWhereInput = {
    AND: [
      scope,
      ...(query.profileId
        ? [{ salesExecutiveProfileId: query.profileId }]
        : []),
      ...(query.source ? [{ source: query.source }] : []),
      ...(query.search
        ? [
            {
              OR: [
                {
                  summary: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  verdict: {
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
    prisma.performanceEvaluation.count({ where }),
    prisma.performanceEvaluation.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { evaluatedAt: "desc" },
      include: evalInclude,
    }),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    evaluations: rows.map(serialize),
  };
}

export async function getPerformance(actor: Actor, id: string) {
  const row = await prisma.performanceEvaluation.findFirst({
    where: { id, archivedAt: null },
    include: evalInclude,
  });
  if (!row) throw notFound("Performance evaluation not found");
  await assertCanAccess(actor, row);
  return serialize(row);
}

export async function createPerformance(
  actor: Actor,
  input: CreatePerformanceInput,
) {
  if (isSuperAdmin(actor)) {
    throw forbidden("Super Admin is read-only for performance evaluations");
  }

  const source = sourceForRole(actor.roleCode);
  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: input.salesExecutiveProfileId, archivedAt: null },
  });
  if (!profile) throw notFound("Sales executive profile not found");

  let assignmentId: string | null = null;

  if (actor.roleCode === "TEAM_LEAD") {
    const teamIds = await getActiveTeamIds(prisma, actor.id);
    if (!teamIds.includes(profile.teamId)) {
      throw forbidden("Profile is outside your team scope");
    }
    await assertTeamLeadOperationalWriteAllowed(prisma, actor, profile.id, {
      action: "PERFORMANCE_CREATE",
    });
    const active = await prisma.commandoAssignment.findFirst({
      where: { salesExecutiveProfileId: profile.id, status: "ACTIVE" },
      select: { id: true },
    });
    assignmentId = active?.id ?? null;
  } else if (actor.roleCode === "COMMANDO_EXECUTIVE") {
    const assignment = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: profile.id,
        commandoUserId: actor.id,
        status: "ACTIVE",
      },
    });
    if (!assignment) {
      throw forbidden(
        "You may only create performance for profiles with an active assignment to you",
      );
    }
    assignmentId = assignment.id;
  }

  const avg = averageScore(
    input.scores.map((s) => ({ scoreValue: s.scoreValue })),
  );
  const rating =
    input.rating ??
    (avg != null ? Number((avg / 20).toFixed(2)) : null);

  const created = await prisma.performanceEvaluation.create({
    data: {
      salesExecutiveProfileId: profile.id,
      assignmentId,
      source,
      summary: input.summary?.trim() ? input.summary.trim() : null,
      verdict: input.verdict?.trim() ? input.verdict.trim() : null,
      rating,
      evaluatedAt: input.evaluatedAt ?? new Date(),
      createdById: actor.id,
      scores: {
        create: input.scores.map((s) => ({
          metricCode: s.metricCode,
          metricLabel: s.metricLabel,
          scoreValue: s.scoreValue,
        })),
      },
    },
    include: evalInclude,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "PERFORMANCE_EVALUATION_CREATED",
    entityType: "PerformanceEvaluation",
    entityId: created.id,
    metadata: {
      profileId: profile.id,
      source,
      assignmentId,
      rating,
      scoreCount: input.scores.length,
      verb: "CREATE",
    },
  });

  return serialize(created);
}

/**
 * Sales Executive dashboard metrics with source-aware visibility.
 */
export async function getPerformanceMetrics(actor: Actor, profileId?: string) {
  let targetProfileId = profileId;

  if (actor.roleCode === "SALES_EXECUTIVE") {
    const profile = await prisma.salesExecutiveProfile.findFirst({
      where: { userId: actor.id, archivedAt: null },
      select: { id: true },
    });
    if (!profile) throw notFound("Sales executive profile not found");
    targetProfileId = profile.id;
  } else if (!targetProfileId) {
    throw notFound("profileId is required");
  }

  const profile = await prisma.salesExecutiveProfile.findFirst({
    where: { id: targetProfileId, archivedAt: null },
    select: { id: true, displayName: true, userId: true, teamId: true },
  });
  if (!profile) throw notFound("Sales executive profile not found");

  // Same profile scope as the SE workspace itself (team membership OR
  // assignment ownership). Do not use a narrower team-only check here —
  // that caused metrics 403 while the profile page loaded successfully.
  await assertProfileInScope(prisma, actor, profile.id);

  const lifecycle = await getCommandoLifecycleState(prisma, profile.id);
  // Align with list/get: Team Leads never see Commando performance;
  // SE only after Commando; Commando/SA within other scope checks.
  const showCommando = roleCanViewCommandoPerformance(
    actor.roleCode,
    lifecycle,
  );

  const assignments = await prisma.commandoAssignment.findMany({
    where: { salesExecutiveProfileId: profile.id },
    orderBy: { startedAt: "asc" },
  });
  const totalDays = assignments.reduce(
    (sum, a) => sum + totalDaysUnderCommando(a.startedAt, a.endedAt),
    0,
  );
  const activeAssignment = assignments.find((a) => a.status === "ACTIVE");

  const [latestCommando, latestTeamLead, latestVisible] = await Promise.all([
    showCommando
      ? prisma.performanceEvaluation.findFirst({
          where: {
            salesExecutiveProfileId: profile.id,
            source: "COMMANDO",
            archivedAt: null,
          },
          orderBy: { evaluatedAt: "desc" },
          include: evalInclude,
        })
      : Promise.resolve(null),
    prisma.performanceEvaluation.findFirst({
      where: {
        salesExecutiveProfileId: profile.id,
        source: "TEAM_LEAD",
        archivedAt: null,
      },
      orderBy: { evaluatedAt: "desc" },
      include: evalInclude,
    }),
    prisma.performanceEvaluation.findFirst({
      where: {
        salesExecutiveProfileId: profile.id,
        archivedAt: null,
        source: showCommando
          ? { in: ["TEAM_LEAD", "COMMANDO"] }
          : "TEAM_LEAD",
      },
      orderBy: { evaluatedAt: "desc" },
      include: evalInclude,
    }),
  ]);

  const currentCommando = latestCommando ? serialize(latestCommando) : null;
  const myMetric = latestVisible ? serialize(latestVisible) : null;
  const teamLeadMetric = latestTeamLead ? serialize(latestTeamLead) : null;

  return {
    profile,
    lifecycle: {
      isDuringCommando: lifecycle.isDuringCommando,
      isAfterCommando: lifecycle.isAfterCommando,
    },
    totalDaysUnderCommando: totalDays,
    activeAssignmentId: activeAssignment?.id ?? null,
    currentCommandoScore: currentCommando
      ? {
          evaluationId: currentCommando.id,
          source: currentCommando.source,
          rating: currentCommando.rating,
          averageMetricScore: currentCommando.averageMetricScore,
          evaluatedAt: currentCommando.evaluatedAt,
          scores: currentCommando.scores,
          visible: true,
        }
      : {
          evaluationId: null,
          source: "COMMANDO" as const,
          rating: null,
          averageMetricScore: null,
          evaluatedAt: null,
          scores: [],
          visible: showCommando,
          hiddenReason: showCommando
            ? null
            : "Hidden during active Commando assignment",
        },
    myPerformanceMetric: myMetric
      ? {
          evaluationId: myMetric.id,
          source: myMetric.source,
          rating: myMetric.rating,
          averageMetricScore: myMetric.averageMetricScore,
          verdict: myMetric.verdict,
          evaluatedAt: myMetric.evaluatedAt,
          scores: myMetric.scores,
        }
      : null,
    teamLeadPerformance: teamLeadMetric
      ? {
          evaluationId: teamLeadMetric.id,
          source: teamLeadMetric.source,
          rating: teamLeadMetric.rating,
          averageMetricScore: teamLeadMetric.averageMetricScore,
          evaluatedAt: teamLeadMetric.evaluatedAt,
        }
      : null,
  };
}
