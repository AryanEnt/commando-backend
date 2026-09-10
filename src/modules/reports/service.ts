import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { totalDaysUnderCommando } from "../../lib/assignmentDays.js";
import type { ListCommandoPerformanceQuery } from "./schemas.js";

function averageScore(
  scores: { scoreValue: { toNumber?: () => number } | number | string }[],
): number | null {
  if (scores.length === 0) return null;
  const values = scores.map((s) => {
    const v = s.scoreValue;
    if (typeof v === "number") return v;
    if (typeof v === "string") return Number(v);
    if (v && typeof v.toNumber === "function") return v.toNumber();
    return Number(v);
  });
  return Number(
    (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
  );
}

function assertSuperAdmin(actor: Actor): void {
  if (!isSuperAdmin(actor)) {
    throw forbidden("Only Super Admin may access reporting modules");
  }
}

type AssignmentRow = Prisma.CommandoAssignmentGetPayload<{
  include: {
    profile: {
      select: { id: true; displayName: true; teamId: true };
    };
    team: { select: { id: true; name: true } };
    commando: {
      select: { id: true; firstName: true; lastName: true; email: true };
    };
    teamLead: {
      select: { id: true; firstName: true; lastName: true; email: true };
    };
  };
}>;

async function buildRow(assignment: AssignmentRow) {
  const windowEnd = assignment.endedAt ?? new Date();
  const [commandoEvals, tlEvals, swots, eisenhowerTasks] = await Promise.all([
    prisma.performanceEvaluation.findMany({
      where: {
        archivedAt: null,
        source: "COMMANDO",
        salesExecutiveProfileId: assignment.salesExecutiveProfileId,
        OR: [
          { assignmentId: assignment.id },
          {
            assignmentId: null,
            createdById: assignment.commandoUserId,
            evaluatedAt: {
              gte: assignment.startedAt,
              lte: windowEnd,
            },
          },
        ],
      },
      orderBy: { evaluatedAt: "desc" },
      include: { scores: true },
    }),
    prisma.performanceEvaluation.findMany({
      where: {
        archivedAt: null,
        source: "TEAM_LEAD",
        salesExecutiveProfileId: assignment.salesExecutiveProfileId,
        OR: [
          { assignmentId: assignment.id },
          {
            assignmentId: null,
            evaluatedAt: {
              gte: assignment.startedAt,
              lte: windowEnd,
            },
          },
        ],
      },
      orderBy: { evaluatedAt: "desc" },
      include: { scores: true },
    }),
    prisma.swotAnalysis.findMany({
      where: {
        archivedAt: null,
        salesExecutiveProfileId: assignment.salesExecutiveProfileId,
        OR: [
          { assignmentId: assignment.id },
          {
            assignmentId: null,
            createdAt: {
              gte: assignment.startedAt,
              lte: windowEnd,
            },
          },
        ],
      },
      select: {
        id: true,
        source: true,
        assignmentId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.eisenhowerTask.findMany({
      where: {
        archivedAt: null,
        salesExecutiveProfileId: assignment.salesExecutiveProfileId,
        OR: [
          { assignmentId: assignment.id },
          {
            assignmentId: null,
            createdAt: {
              gte: assignment.startedAt,
              lte: windowEnd,
            },
          },
        ],
      },
      select: {
        id: true,
        category: true,
        status: true,
        month: true,
        assignmentId: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const linkedCommando =
    commandoEvals.find((e) => e.assignmentId === assignment.id) ??
    commandoEvals[0] ??
    null;
  const linkedTl =
    tlEvals.find((e) => e.assignmentId === assignment.id) ??
    tlEvals[0] ??
    null;

  const avgFromScores = linkedCommando
    ? averageScore(linkedCommando.scores)
    : null;
  const rating =
    linkedCommando?.rating != null
      ? Number(linkedCommando.rating)
      : avgFromScores != null
        ? Number((avgFromScores / 20).toFixed(2))
        : null;

  return {
    assignmentId: assignment.id,
    status: assignment.status,
    startedAt: assignment.startedAt,
    endedAt: assignment.endedAt,
    daysAssigned: totalDaysUnderCommando(
      assignment.startedAt,
      assignment.endedAt,
    ),
    assigned: assignment.status === "ACTIVE" ? "Active" : assignment.status,
    commando: {
      id: assignment.commando.id,
      name: `${assignment.commando.firstName} ${assignment.commando.lastName}`,
      email: assignment.commando.email,
    },
    profile: {
      id: assignment.profile.id,
      displayName: assignment.profile.displayName,
      teamId: assignment.profile.teamId,
    },
    team: assignment.team,
    teamLead: {
      id: assignment.teamLead.id,
      name: `${assignment.teamLead.firstName} ${assignment.teamLead.lastName}`,
    },
    avgScore: avgFromScores,
    avgScoreSource: avgFromScores
      ? {
          evaluationId: linkedCommando!.id,
          source: "COMMANDO" as const,
          scoreCount: linkedCommando!.scores.length,
          evaluatedAt: linkedCommando!.evaluatedAt,
        }
      : null,
    rating,
    ratingSource: linkedCommando
      ? {
          evaluationId: linkedCommando.id,
          source: "COMMANDO" as const,
          storedRating:
            linkedCommando.rating != null
              ? Number(linkedCommando.rating)
              : null,
          derivedFromAvgScore:
            linkedCommando.rating == null && avgFromScores != null,
        }
      : null,
    starRating: rating,
    tlVerdict: linkedTl?.verdict ?? null,
    tlVerdictSource: linkedTl
      ? {
          evaluationId: linkedTl.id,
          source: "TEAM_LEAD" as const,
          evaluatedAt: linkedTl.evaluatedAt,
        }
      : null,
    swot: {
      count: swots.length,
      bySource: {
        TEAM_LEAD: swots.filter((s) => s.source === "TEAM_LEAD").length,
        COMMANDO: swots.filter((s) => s.source === "COMMANDO").length,
        SALES_EXECUTIVE: swots.filter((s) => s.source === "SALES_EXECUTIVE")
          .length,
      },
      swotIds: swots.map((s) => s.id),
    },
    eisenhower: {
      count: eisenhowerTasks.length,
      byCategory: {
        DO_FIRST: eisenhowerTasks.filter((t) => t.category === "DO_FIRST")
          .length,
        SCHEDULE: eisenhowerTasks.filter((t) => t.category === "SCHEDULE")
          .length,
        DELEGATE: eisenhowerTasks.filter((t) => t.category === "DELEGATE")
          .length,
        ELIMINATE: eisenhowerTasks.filter((t) => t.category === "ELIMINATE")
          .length,
      },
      taskIds: eisenhowerTasks.map((t) => t.id),
    },
  };
}

export async function listCommandoPerformanceReport(
  actor: Actor,
  query: ListCommandoPerformanceQuery,
) {
  assertSuperAdmin(actor);

  const where: Prisma.CommandoAssignmentWhereInput = {
    AND: [
      ...(query.teamId ? [{ teamId: query.teamId }] : []),
      ...(query.profileId
        ? [{ salesExecutiveProfileId: query.profileId }]
        : []),
      ...(query.commandoUserId
        ? [{ commandoUserId: query.commandoUserId }]
        : []),
      ...(query.status ? [{ status: query.status }] : []),
      ...(query.search
        ? [
            {
              OR: [
                {
                  profile: {
                    displayName: {
                      contains: query.search,
                      mode: "insensitive" as const,
                    },
                  },
                },
                {
                  commando: {
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
                  },
                },
                {
                  team: {
                    name: {
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

  const [total, assignments] = await Promise.all([
    prisma.commandoAssignment.count({ where }),
    prisma.commandoAssignment.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: [{ status: "asc" }, { startedAt: "desc" }],
      include: {
        profile: {
          select: { id: true, displayName: true, teamId: true },
        },
        team: { select: { id: true, name: true } },
        commando: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        teamLead: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    }),
  ]);

  const rows = [];
  for (const assignment of assignments) {
    rows.push(await buildRow(assignment));
  }

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    rows,
  };
}

export async function getCommandoPerformanceReportDetail(
  actor: Actor,
  assignmentId: string,
) {
  assertSuperAdmin(actor);

  const assignment = await prisma.commandoAssignment.findFirst({
    where: { id: assignmentId },
    include: {
      profile: {
        select: { id: true, displayName: true, teamId: true },
      },
      team: { select: { id: true, name: true } },
      commando: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      teamLead: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  });
  if (!assignment) throw notFound("Assignment not found");

  const row = await buildRow(assignment);

  const evaluationIds = [
    ...(row.avgScoreSource ? [row.avgScoreSource.evaluationId] : []),
    ...(row.tlVerdictSource ? [row.tlVerdictSource.evaluationId] : []),
  ];

  const [performanceEvaluations, swotDetails, eisenhowerDetails] =
    await Promise.all([
      evaluationIds.length
        ? prisma.performanceEvaluation.findMany({
            where: { id: { in: [...new Set(evaluationIds)] } },
            include: {
              scores: true,
              createdBy: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  role: { select: { code: true } },
                },
              },
            },
          })
        : Promise.resolve([]),
      row.swot.swotIds.length
        ? prisma.swotAnalysis.findMany({
            where: { id: { in: row.swot.swotIds } },
            select: {
              id: true,
              source: true,
              strength: true,
              weakness: true,
              opportunity: true,
              threat: true,
              createdAt: true,
              createdById: true,
            },
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
      row.eisenhower.taskIds.length
        ? prisma.eisenhowerTask.findMany({
            where: { id: { in: row.eisenhower.taskIds } },
            select: {
              id: true,
              title: true,
              category: true,
              status: true,
              month: true,
              dueDate: true,
            },
            orderBy: [{ month: "desc" }, { createdAt: "desc" }],
          })
        : Promise.resolve([]),
    ]);

  return {
    ...row,
    sourceRecords: {
      performanceEvaluations: performanceEvaluations.map((e) => ({
        id: e.id,
        source: e.source,
        summary: e.summary,
        verdict: e.verdict,
        rating: e.rating != null ? Number(e.rating) : null,
        averageMetricScore: averageScore(e.scores),
        scores: e.scores.map((s) => ({
          id: s.id,
          metricCode: s.metricCode,
          metricLabel: s.metricLabel,
          scoreValue: Number(s.scoreValue),
        })),
        evaluatedAt: e.evaluatedAt,
        createdBy: e.createdBy,
      })),
      swotAnalyses: swotDetails,
      eisenhowerTasks: eisenhowerDetails,
    },
  };
}

/**
 * Operational oversight counts for Super Admin Reports hub.
 * Reuses live table counts only — no derived KPI formulas.
 */
export async function getReportsOverview(actor: Actor) {
  assertSuperAdmin(actor);
  const now = new Date();

  const [
    activeInterventions,
    completedInterventions,
    exitedInterventions,
    pendingReferrals,
    overdueActions,
    draftReviews,
    submittedReviews,
    monitoringRecords,
    teams,
    salesExecutives,
    commandos,
  ] = await Promise.all([
    prisma.commandoAssignment.count({ where: { status: "ACTIVE" } }),
    prisma.commandoAssignment.count({ where: { status: "COMPLETED" } }),
    prisma.commandoAssignment.count({ where: { status: "EXITED" } }),
    prisma.referral.count({
      where: { archivedAt: null, status: "SUBMITTED" },
    }),
    prisma.actionItem.count({
      where: {
        status: "ACTIVE",
        dueDate: { not: null, lt: now },
        archivedAt: null,
      },
    }),
    prisma.weeklyReview.count({
      where: { status: "DRAFT", archivedAt: null },
    }),
    prisma.weeklyReview.count({
      where: { status: "SUBMITTED", archivedAt: null },
    }),
    prisma.liveMonitoringRecord.count({ where: { archivedAt: null } }),
    prisma.team.count({ where: { archivedAt: null } }),
    prisma.salesExecutiveProfile.count({ where: { archivedAt: null } }),
    prisma.user.count({
      where: {
        deletedAt: null,
        isActive: true,
        role: { code: "COMMANDO_EXECUTIVE" },
      },
    }),
  ]);

  return {
    counts: {
      interventions: {
        active: activeInterventions,
        completed: completedInterventions,
        exited: exitedInterventions,
      },
      pendingReferrals,
      overdueActions,
      weeklyReviews: {
        draft: draftReviews,
        submitted: submittedReviews,
      },
      monitoringRecords,
      teams,
      salesExecutives,
      commandos,
    },
    modules: [
      {
        key: "commando-performance",
        title: "Commando performance",
        description:
          "Assignment-level coaching activity, evaluations, SWOT, and Eisenhower history.",
        href: "/reports/commando-performance",
      },
      {
        key: "sales-executives",
        title: "Sales Executives",
        description: "Profiles with current Team Lead, Commando, and intervention history.",
        href: "/profiles",
      },
      {
        key: "organization",
        title: "Organization",
        description: "Team Lead → Commando → Sales Executive structure.",
        href: "/organization",
      },
      {
        key: "audit",
        title: "Audit trail",
        description: "Immutable history of user, role, team, and workflow changes.",
        href: "/audit-logs",
      },
    ],
  };
}
