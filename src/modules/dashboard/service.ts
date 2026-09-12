import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { forbidden } from "../../lib/errors.js";

function assertSuperAdmin(actor: Actor): void {
  if (!isSuperAdmin(actor)) {
    throw forbidden("Only Super Admin may access the control tower");
  }
}

/**
 * Super Admin Control Tower — operational governance metrics only.
 * No invented KPI formulas; all counts come from real tables.
 */
export async function getControlTower(actor: Actor) {
  assertSuperAdmin(actor);

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    activeUsers,
    inactiveUsers,
    teams,
    salesExecutives,
    activeAssignments,
    completedAssignments,
    exitedAssignments,
    pendingReferrals,
    acknowledgedReferrals,
    inProgressReferrals,
    overdueActionItems,
    draftWeeklyReviews,
    submittedWeeklyReviewsLast7d,
    monitoringLast7d,
    overdueSupportTasks,
    seWithoutProfile,
    seWithoutActiveAssignmentWithOpenReferral,
  ] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, isActive: true } }),
    prisma.user.count({ where: { deletedAt: null, isActive: false } }),
    prisma.team.count({ where: { archivedAt: null } }),
    prisma.salesExecutiveProfile.count({ where: { archivedAt: null } }),
    prisma.commandoAssignment.count({ where: { status: "ACTIVE" } }),
    prisma.commandoAssignment.count({ where: { status: "COMPLETED" } }),
    prisma.commandoAssignment.count({ where: { status: "EXITED" } }),
    prisma.referral.count({
      where: { archivedAt: null, status: "SUBMITTED" },
    }),
    prisma.referral.count({
      where: { archivedAt: null, status: "ACKNOWLEDGED" },
    }),
    prisma.referral.count({
      where: { archivedAt: null, status: "IN_PROGRESS" },
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
      where: {
        status: "SUBMITTED",
        archivedAt: null,
        submittedAt: { gte: weekAgo },
      },
    }),
    prisma.liveMonitoringRecord.count({
      where: { archivedAt: null, observedAt: { gte: weekAgo } },
    }),
    prisma.supportTask.count({
      where: {
        status: { in: ["PENDING", "IN_PROGRESS"] },
        dueDate: { not: null, lt: now },
        archivedAt: null,
      },
    }),
    prisma.user.count({
      where: {
        deletedAt: null,
        role: { code: "SALES_EXECUTIVE" },
        salesExecutiveProfile: null,
      },
    }),
    prisma.referral.count({
      where: {
        archivedAt: null,
        status: { in: ["SUBMITTED", "ACKNOWLEDGED", "IN_PROGRESS"] },
        assignmentId: null,
        profile: {
          assignments: { none: { status: "ACTIVE" } },
        },
      },
    }),
  ]);

  const alerts: Array<{
    code: string;
    severity: "info" | "warning" | "critical";
    title: string;
    reason: string;
    href: string;
    count: number;
  }> = [];

  if (seWithoutActiveAssignmentWithOpenReferral > 0) {
    alerts.push({
      code: "REFERRAL_NO_ASSIGNMENT",
      severity: "critical",
      title: "Open referrals without active assignment",
      reason: `${seWithoutActiveAssignmentWithOpenReferral} open referral${seWithoutActiveAssignmentWithOpenReferral === 1 ? "" : "s"} have no active Commando assignment.`,
      href: "/referrals",
      count: seWithoutActiveAssignmentWithOpenReferral,
    });
  }
  if (overdueActionItems > 0) {
    alerts.push({
      code: "ACTIONS_OVERDUE",
      severity: overdueActionItems >= 5 ? "critical" : "warning",
      title: "Overdue action items",
      reason: `${overdueActionItems} active action item${overdueActionItems === 1 ? " is" : "s are"} past due.`,
      href: "/reports",
      count: overdueActionItems,
    });
  }
  if (overdueSupportTasks > 0) {
    alerts.push({
      code: "SUPPORT_TASKS_OVERDUE",
      severity: "warning",
      title: "Overdue support tasks",
      reason: `${overdueSupportTasks} Sales Support task${overdueSupportTasks === 1 ? "" : "s"} overdue.`,
      href: "/reports",
      count: overdueSupportTasks,
    });
  }
  if (pendingReferrals > 0) {
    alerts.push({
      code: "REFERRALS_AWAITING_ACK",
      severity: "warning",
      title: "Referrals awaiting acknowledgement",
      reason: `${pendingReferrals} referral${pendingReferrals === 1 ? "" : "s"} submitted and waiting for Commando.`,
      href: "/referrals?status=SUBMITTED",
      count: pendingReferrals,
    });
  }
  if (seWithoutProfile > 0) {
    alerts.push({
      code: "SE_MISSING_PROFILE",
      severity: "warning",
      title: "Sales Executive accounts without profiles",
      reason: `${seWithoutProfile} SE user${seWithoutProfile === 1 ? "" : "s"} still need a business profile.`,
      href: "/users?roleCode=SALES_EXECUTIVE&profileStatus=missing",
      count: seWithoutProfile,
    });
  }
  if (draftWeeklyReviews > 0) {
    alerts.push({
      code: "REVIEWS_DRAFT",
      severity: "info",
      title: "Weekly reviews in draft",
      reason: `${draftWeeklyReviews} weekly review${draftWeeklyReviews === 1 ? "" : "s"} not yet submitted.`,
      href: "/reports",
      count: draftWeeklyReviews,
    });
  }
  if (inactiveUsers > 0) {
    alerts.push({
      code: "INACTIVE_USERS",
      severity: "info",
      title: "Inactive user accounts",
      reason: `${inactiveUsers} user account${inactiveUsers === 1 ? " is" : "s are"} deactivated.`,
      href: "/users?isActive=false",
      count: inactiveUsers,
    });
  }

  const severityRank: Record<"critical" | "warning" | "info", number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  alerts.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      b.count - a.count,
  );

  const operationalAuditActions = [
    "COMMANDO_ASSIGNMENT_STARTED",
    "COMMANDO_ASSIGNMENT_ENDED",
    "COMMANDO_ASSIGNMENT_EXITED",
    "COMMANDO_ASSIGNMENT_TRANSFERRED",
    "INTERVENTION_OUTCOME_RECORDED",
    "REFERRAL_SUBMITTED",
    "REFERRAL_ACKNOWLEDGED",
    "REFERRAL_IN_PROGRESS",
    "REFERRAL_COMPLETED",
    "COMMANDO_REQUEST_SUBMITTED",
    "REFERRAL_INFORMATION_PROVIDED",
    "REFERRAL_REJECTED",
    "WEEKLY_REVIEW_SUBMITTED",
    "SUPPORT_TASK_CREATED",
    "SUPPORT_TASK_STATUS_UPDATED",
    "ACTION_ITEM_COMPLETED",
    "ACTION_ITEM_CREATED",
    "ROLE_ASSIGNMENT_CREATED",
  ];

  const [pendingReferralRows, overdueActionRows, recentAuditRows] =
    await Promise.all([
      prisma.referral.findMany({
        where: { archivedAt: null, status: "SUBMITTED" },
        orderBy: { createdAt: "asc" },
        take: 8,
        include: {
          profile: { select: { id: true, displayName: true } },
          team: { select: { id: true, name: true } },
          commando: {
            select: { id: true, firstName: true, lastName: true },
          },
          teamLead: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
      prisma.actionItem.findMany({
        where: {
          status: "ACTIVE",
          dueDate: { not: null, lt: now },
          archivedAt: null,
        },
        orderBy: { dueDate: "asc" },
        take: 8,
        include: {
          profile: { select: { id: true, displayName: true } },
        },
      }),
      prisma.auditLog.findMany({
        where: { action: { in: operationalAuditActions } },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: {
          actor: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              role: { select: { code: true } },
            },
          },
        },
      }),
    ]);

  return {
    generatedAt: now.toISOString(),
    metrics: {
      users: {
        total: totalUsers,
        active: activeUsers,
        inactive: inactiveUsers,
      },
      teams,
      salesExecutives,
      interventions: {
        active: activeAssignments,
        completed: completedAssignments,
        exited: exitedAssignments,
      },
      referrals: {
        submitted: pendingReferrals,
        acknowledged: acknowledgedReferrals,
        inProgress: inProgressReferrals,
      },
      overdueActionItems,
      draftWeeklyReviews,
      submittedWeeklyReviewsLast7d,
      monitoringLast7d,
      overdueSupportTasks,
    },
    alerts,
    attention: {
      pendingReferrals: pendingReferralRows.map((r) => ({
        id: r.id,
        profileId: r.profile.id,
        profileName: r.profile.displayName,
        teamName: r.team.name,
        teamLead: `${r.teamLead.firstName} ${r.teamLead.lastName}`,
        commando: `${r.commando.firstName} ${r.commando.lastName}`,
        createdAt: r.createdAt,
      })),
      overdueActions: overdueActionRows.map((a) => ({
        id: a.id,
        title: a.title,
        dueDate: a.dueDate,
        profileId: a.profile.id,
        profileName: a.profile.displayName,
      })),
    },
    recentActivity: recentAuditRows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      createdAt: row.createdAt,
      actor: row.actor
        ? {
            id: row.actor.id,
            name: `${row.actor.firstName} ${row.actor.lastName}`.trim(),
            roleCode: row.actor.role.code,
          }
        : null,
      metadata: row.metadata,
    })),
  };
}

/**
 * Organization structure for governance:
 * Team → Team Lead(s) → Sales Executives (with current Commando if any)
 */
export async function getOrganizationStructure(actor: Actor) {
  assertSuperAdmin(actor);

  const teams = await prisma.team.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    include: {
      memberships: {
        where: { isActive: true, endedAt: null },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              isActive: true,
              role: { select: { code: true, name: true } },
            },
          },
        },
      },
      profiles: {
        where: { archivedAt: null },
        orderBy: { displayName: "asc" },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              isActive: true,
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
            },
          },
        },
      },
    },
  });

  return {
    teams: teams.map((team) => {
      const teamLeads = team.memberships
        .filter((m) => m.roleInTeam === "TEAM_LEAD")
        .map((m) => ({
          membershipId: m.id,
          roleInTeam: m.roleInTeam,
          user: m.user,
        }));
      const support = team.memberships
        .filter((m) => m.roleInTeam === "SALES_SUPPORT_EXECUTIVE")
        .map((m) => ({
          membershipId: m.id,
          roleInTeam: m.roleInTeam,
          user: m.user,
        }));
      const otherMembers = team.memberships
        .filter(
          (m) =>
            m.roleInTeam !== "TEAM_LEAD" &&
            m.roleInTeam !== "SALES_SUPPORT_EXECUTIVE" &&
            m.roleInTeam !== "SALES_EXECUTIVE",
        )
        .map((m) => ({
          membershipId: m.id,
          roleInTeam: m.roleInTeam,
          user: m.user,
        }));

      return {
        id: team.id,
        name: team.name,
        description: team.description,
        teamLeads,
        salesSupport: support,
        otherMembers,
        salesExecutives: team.profiles.map((p) => {
          const active = p.assignments[0] ?? null;
          return {
            id: p.id,
            displayName: p.displayName,
            employeeCode: p.employeeCode,
            user: p.user,
            currentAssignment: active
              ? {
                  id: active.id,
                  status: active.status,
                  startedAt: active.startedAt,
                  commando: active.commando,
                  teamLead: active.teamLead,
                }
              : null,
          };
        }),
      };
    }),
  };
}
