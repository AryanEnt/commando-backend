import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../lib/authorization.js";
import { isSuperAdmin } from "../../lib/authorization.js";
import { badRequest, forbidden } from "../../lib/errors.js";
import { assertProfileInScope } from "../../lib/scope.js";
import { assertTeamLeadOperationalWriteAllowed } from "../../lib/teamLeadLock.js";
import { totalDaysUnderCommando } from "../../lib/assignmentDays.js";
import { AUDIT_ACTIONS, writeAuditLog } from "../../lib/audit.js";
import {
  coachingSourcesVisibleToSalesExecutive,
  getCommandoLifecycleState,
  salesExecutiveCanViewActionItemStatus,
  salesExecutiveCanViewMonitoring,
  swotWhereVisibleToSalesExecutive,
} from "../../lib/lifecycleVisibility.js";
import * as profileService from "../profiles/service.js";
import type { z } from "zod";
import type { acknowledgeSchema, createGoalSchema } from "./schemas.js";

type AcknowledgeInput = z.infer<typeof acknowledgeSchema>;
type CreateGoalInput = z.infer<typeof createGoalSchema>;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function person(user: { firstName: string; lastName: string }) {
  return `${user.firstName} ${user.lastName}`.trim();
}

export async function getIntervention(actor: Actor, profileId: string) {
  const profile = await profileService.getProfile(actor, profileId);
  const assignment = profile.currentAssignment;
  const lifecycle =
    actor.roleCode === "SALES_EXECUTIVE"
      ? await getCommandoLifecycleState(prisma, profileId)
      : null;
  const seSwotWhere =
    actor.roleCode === "SALES_EXECUTIVE"
      ? swotWhereVisibleToSalesExecutive()
      : null;
  const seCanSeeMonitoring = lifecycle
    ? salesExecutiveCanViewMonitoring(lifecycle)
    : true;

  const [
    latestReferral,
    latestSwot,
    overdueActions,
    recentMonitoring,
    latestReview,
    openSync,
    submittedReferral,
  ] = await Promise.all([
    prisma.referral.findFirst({
      where: { salesExecutiveProfileId: profileId, archivedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    prisma.swotAnalysis.findFirst({
      where: {
        salesExecutiveProfileId: profileId,
        archivedAt: null,
        ...(seSwotWhere ? seSwotWhere : {}),
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.actionItem.findMany({
      where: {
        salesExecutiveProfileId: profileId,
        status: "ACTIVE",
        dueDate: { lt: new Date() },
      },
      select: { id: true, title: true, dueDate: true },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    seCanSeeMonitoring
      ? prisma.liveMonitoringRecord.findFirst({
          where: {
            salesExecutiveProfileId: profileId,
            archivedAt: null,
            ...(assignment ? { assignmentId: assignment.id } : {}),
          },
          orderBy: { observedAt: "desc" },
        })
      : Promise.resolve(null),
    prisma.weeklyReview.findFirst({
      where: {
        salesExecutiveProfileId: profileId,
        archivedAt: null,
        status: "SUBMITTED",
      },
      orderBy: { meetingDate: "desc" },
    }),
    prisma.syncEvaluation.findFirst({
      where: {
        salesExecutiveProfileId: profileId,
        archivedAt: null,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.referral.findFirst({
      where: {
        salesExecutiveProfileId: profileId,
        archivedAt: null,
        status: { in: ["SUBMITTED", "ACKNOWLEDGED"] },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const attention: Array<{ code: string; label: string; reason: string }> = [];
  const now = Date.now();

  if (submittedReferral?.status === "SUBMITTED") {
    attention.push({
      code: "REFERRAL_AWAITING_ACK",
      label: "Referral awaiting acknowledgement",
      reason: "The Commando has not acknowledged this referral.",
    });
  }
  if (assignment && overdueActions.length > 0) {
    attention.push({
      code: "ACTIONS_OVERDUE",
      label: "Action items overdue",
      reason: `${overdueActions.length} action item${overdueActions.length === 1 ? " is" : "s are"} overdue.`,
    });
  }
  if (assignment) {
    const reviewStale =
      !latestReview ||
      now - new Date(latestReview.meetingDate).getTime() > WEEK_MS;
    if (reviewStale) {
      attention.push({
        code: "REVIEW_DUE",
        label: "Weekly review due",
        reason: "No submitted weekly review in the last 7 days.",
      });
    }
    const monitoringStale =
      !recentMonitoring ||
      now - new Date(recentMonitoring.observedAt).getTime() > WEEK_MS;
    if (monitoringStale) {
      attention.push({
        code: "MONITORING_MISSING",
        label: "Monitoring missing",
        reason: "No live monitoring recorded this week.",
      });
    }
  }

  let health: "ON_TRACK" | "NEEDS_ATTENTION" | "AT_RISK" = "ON_TRACK";
  let healthReason = "Expected intervention steps are in place.";
  if (attention.length >= 3) {
    health = "AT_RISK";
    healthReason = attention.map((a) => a.reason).join(" ");
  } else if (attention.length > 0) {
    health = "NEEDS_ATTENTION";
    healthReason = attention[0]?.reason ?? healthReason;
  }

  let nextAction = {
    label: "No immediate action",
    owner: "—",
    reason: "Nothing is currently blocking this intervention.",
  };
  if (submittedReferral?.status === "SUBMITTED") {
    nextAction = {
      label: "Acknowledge referral",
      owner: "Commando",
      reason: "The Team Lead submitted an intervention that is waiting.",
    };
  } else if (submittedReferral?.status === "ACKNOWLEDGED") {
    nextAction = {
      label: "Begin intervention",
      owner: "Commando",
      reason: "The referral is acknowledged but not yet in progress.",
    };
  } else if (assignment && overdueActions.length > 0) {
    nextAction = {
      label: "Review overdue action items",
      owner: "Commando",
      reason: `${overdueActions.length} overdue action item(s) need follow-up.`,
    };
  } else if (
    assignment &&
    (!latestReview || now - new Date(latestReview.meetingDate).getTime() > WEEK_MS)
  ) {
    nextAction = {
      label: "Complete weekly review",
      owner: "Commando",
      reason: "A weekly review is due.",
    };
  } else if (!assignment && latestReferral) {
    nextAction = {
      label: "Start Commando assignment",
      owner: "Super Admin",
      reason: "A referral exists but there is no active assignment.",
    };
  }

  return {
    profile,
    latestReferral: latestReferral
      ? {
          id: latestReferral.id,
          status: latestReferral.status,
          whySalesIsDown: latestReferral.whySalesIsDown,
          whatIsTheGap: latestReferral.whatIsTheGap,
          detailedSummaryOfGap: latestReferral.detailedSummaryOfGap,
          supportAlreadyProvided: latestReferral.supportAlreadyProvided,
          supportRequiredFromCommando:
            latestReferral.supportRequiredFromCommando,
          recommendationFocus: latestReferral.recommendationFocus,
          priority1: latestReferral.priority1,
          priority2: latestReferral.priority2,
          priority3: latestReferral.priority3,
          createdAt: latestReferral.createdAt,
        }
      : null,
    latestSwot: latestSwot
      ? {
          id: latestSwot.id,
          source: latestSwot.source,
          strength: latestSwot.strength,
          weakness: latestSwot.weakness,
          opportunity: latestSwot.opportunity,
          threat: latestSwot.threat,
          createdAt: latestSwot.createdAt,
        }
      : null,
    daysInIntervention: assignment
      ? totalDaysUnderCommando(new Date(assignment.startedAt), assignment.endedAt)
      : 0,
    health: { status: health, reason: healthReason },
    attention,
    nextAction,
    overdueActions,
    latestReview: latestReview
      ? {
          id: latestReview.id,
          weekLabel: latestReview.weekLabel,
          meetingDate: latestReview.meetingDate,
          status: latestReview.status,
        }
      : null,
    latestMonitoring: recentMonitoring
      ? {
          id: recentMonitoring.id,
          observedAt: recentMonitoring.observedAt,
        }
      : null,
    latestSync: openSync
      ? { id: openSync.id, createdAt: openSync.createdAt }
      : null,
  };
}

export async function getInterventionTimeline(actor: Actor, profileId: string) {
  await assertProfileInScope(prisma, actor, profileId);

  const lifecycle =
    actor.roleCode === "SALES_EXECUTIVE"
      ? await getCommandoLifecycleState(prisma, profileId)
      : null;
  const seSwotWhere =
    actor.roleCode === "SALES_EXECUTIVE"
      ? swotWhereVisibleToSalesExecutive()
      : null;
  const seCoachingSources = lifecycle
    ? coachingSourcesVisibleToSalesExecutive(lifecycle)
    : null;
  const seCanSeeMonitoring = lifecycle
    ? salesExecutiveCanViewMonitoring(lifecycle)
    : true;

  const [
    referrals,
    swots,
    assignments,
    logs,
    monitoring,
    reviews,
    actions,
    feedback,
    syncs,
  ] = await Promise.all([
    prisma.referral.findMany({
      where: { salesExecutiveProfileId: profileId, archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, status: true, createdAt: true, acknowledgedAt: true },
    }),
    prisma.swotAnalysis.findMany({
      where: {
        salesExecutiveProfileId: profileId,
        archivedAt: null,
        ...(seSwotWhere ? seSwotWhere : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, source: true, createdAt: true },
    }),
    prisma.commandoAssignment.findMany({
      where: { salesExecutiveProfileId: profileId },
      orderBy: { startedAt: "desc" },
      take: 20,
      include: {
        commando: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.dailyLog.findMany({
      where: { salesExecutiveProfileId: profileId, archivedAt: null },
      orderBy: { logDate: "desc" },
      take: 20,
      select: {
        id: true,
        logDate: true,
        status: true,
        submittedAt: true,
        updatedAt: true,
        _count: { select: { entries: true } },
      },
    }),
    seCanSeeMonitoring
      ? prisma.liveMonitoringRecord.findMany({
          where: { salesExecutiveProfileId: profileId, archivedAt: null },
          orderBy: { observedAt: "desc" },
          take: 20,
          select: { id: true, observedAt: true },
        })
      : Promise.resolve([]),
    prisma.weeklyReview.findMany({
      where: {
        salesExecutiveProfileId: profileId,
        archivedAt: null,
        ...(actor.roleCode === "SALES_EXECUTIVE" || actor.roleCode === "TEAM_LEAD"
          ? { status: "SUBMITTED" }
          : {}),
      },
      orderBy: { meetingDate: "desc" },
      take: 20,
      select: { id: true, weekLabel: true, status: true, meetingDate: true, submittedAt: true },
    }),
    prisma.actionItem.findMany({
      where: { salesExecutiveProfileId: profileId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, title: true, status: true, createdAt: true },
    }),
    prisma.feedback.findMany({
      where: {
        salesExecutiveProfileId: profileId,
        archivedAt: null,
        ...(seCoachingSources ? { source: { in: seCoachingSources } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, source: true, createdAt: true },
    }),
    prisma.syncEvaluation.findMany({
      where: { salesExecutiveProfileId: profileId, archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, createdAt: true },
    }),
  ]);

  const events: Array<{
    at: string;
    type: string;
    title: string;
    href?: string;
    entityId: string;
  }> = [];

  for (const r of referrals) {
    events.push({
      at: r.createdAt.toISOString(),
      type: "REFERRAL",
      title: "Team Lead submitted intervention",
      href: `/referrals/${r.id}`,
      entityId: r.id,
    });
    if (r.acknowledgedAt) {
      events.push({
        at: r.acknowledgedAt.toISOString(),
        type: "REFERRAL",
        title: "Commando acknowledged referral",
        href: `/referrals/${r.id}`,
        entityId: r.id,
      });
    }
  }
  for (const s of swots) {
    events.push({
      at: s.createdAt.toISOString(),
      type: "SWOT",
      title: `SWOT completed (${s.source.replaceAll("_", " ")})`,
      href: `/swot/${s.id}`,
      entityId: s.id,
    });
  }
  for (const a of assignments) {
    events.push({
      at: a.startedAt.toISOString(),
      type: "ASSIGNMENT",
      title: `Assignment started with ${person(a.commando)}`,
      href: `/assignments/${a.id}`,
      entityId: a.id,
    });
    if (a.endedAt) {
      events.push({
        at: a.endedAt.toISOString(),
        type: "ASSIGNMENT",
        title: `Assignment ${a.status.toLowerCase()}`,
        href: `/assignments/${a.id}`,
        entityId: a.id,
      });
    }
  }
  for (const l of logs) {
    events.push({
      at: (l.submittedAt ?? l.updatedAt ?? l.logDate).toISOString(),
      type: "COACHING",
      title: `Daily Log · ${l._count.entries} ${l._count.entries === 1 ? "activity" : "activities"} (${l.status})`,
      href: `/daily-logs/${l.id}`,
      entityId: l.id,
    });
  }
  for (const m of monitoring) {
    events.push({
      at: m.observedAt.toISOString(),
      type: "MONITORING",
      title: "Live monitoring completed",
      href: `/monitoring/${m.id}`,
      entityId: m.id,
    });
  }
  for (const r of reviews) {
    events.push({
      at: (r.submittedAt ?? r.meetingDate).toISOString(),
      type: "REVIEW",
      title: `Weekly review ${r.status === "SUBMITTED" ? "submitted" : "drafted"} (${r.weekLabel})`,
      href: `/weekly-reviews/${r.id}`,
      entityId: r.id,
    });
  }
  for (const a of actions) {
    if (
      lifecycle &&
      !salesExecutiveCanViewActionItemStatus(a.status, lifecycle)
    ) {
      continue;
    }
    events.push({
      at: a.createdAt.toISOString(),
      type: "ACTION",
      title: `Action item assigned: ${a.title}`,
      href: `/action-items/${a.id}`,
      entityId: a.id,
    });
  }
  for (const f of feedback) {
    events.push({
      at: f.createdAt.toISOString(),
      type: "FEEDBACK",
      title: `Feedback recorded (${f.source.replaceAll("_", " ")})`,
      href: `/feedback/${f.id}`,
      entityId: f.id,
    });
  }
  for (const s of syncs) {
    events.push({
      at: s.createdAt.toISOString(),
      type: "SUPPORT",
      title: "Sales Support sync evaluation recorded",
      href: `/sync-evaluations/${s.id}`,
      entityId: s.id,
    });
  }

  events.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { events: events.slice(0, 80) };
}

export async function acknowledgeRecord(actor: Actor, input: AcknowledgeInput) {
  await assertProfileInScope(prisma, actor, input.salesExecutiveProfileId);

  if (actor.roleCode === "SALES_EXECUTIVE") {
    const own = await prisma.salesExecutiveProfile.findFirst({
      where: { id: input.salesExecutiveProfileId, userId: actor.id },
    });
    if (!own) throw forbidden("You can only acknowledge your own intervention records.");
  } else if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    actor.roleCode !== "TEAM_LEAD" &&
    !isSuperAdmin(actor)
  ) {
    throw forbidden("You cannot acknowledge these records.");
  }

  const row = await prisma.recordAcknowledgement.upsert({
    where: {
      userId_entityType_entityId: {
        userId: actor.id,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    },
    update: { acknowledgedAt: new Date() },
    create: {
      userId: actor.id,
      salesExecutiveProfileId: input.salesExecutiveProfileId,
      entityType: input.entityType,
      entityId: input.entityId,
    },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: AUDIT_ACTIONS.RECORD_ACKNOWLEDGED,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: { profileId: input.salesExecutiveProfileId },
  });

  return row;
}

export async function createGoal(
  actor: Actor,
  profileId: string,
  input: CreateGoalInput,
) {
  await assertProfileInScope(prisma, actor, profileId);
  if (
    actor.roleCode !== "COMMANDO_EXECUTIVE" &&
    actor.roleCode !== "TEAM_LEAD" &&
    !isSuperAdmin(actor)
  ) {
    throw forbidden("You cannot create intervention goals.");
  }
  if (actor.roleCode === "TEAM_LEAD") {
    await assertTeamLeadOperationalWriteAllowed(prisma, actor, profileId, {
      action: "INTERVENTION_GOAL_CREATE",
    });
  }
  if (!input.title) throw badRequest("Goal is required");

  const assignment = await prisma.commandoAssignment.findFirst({
    where: { salesExecutiveProfileId: profileId, status: "ACTIVE" },
  });

  const goal = await prisma.interventionGoal.create({
    data: {
      salesExecutiveProfileId: profileId,
      assignmentId: assignment?.id ?? null,
      title: input.title,
      ownerUserId: input.ownerUserId ?? actor.id,
      targetDate: input.targetDate ?? null,
      progressNotes: input.progressNotes ?? null,
    },
  });

  await writeAuditLog({
    actorId: actor.id,
    action: AUDIT_ACTIONS.INTERVENTION_GOAL_CREATED,
    entityType: "InterventionGoal",
    entityId: goal.id,
    metadata: { profileId },
  });

  return goal;
}

export async function listGoals(actor: Actor, profileId: string) {
  await assertProfileInScope(prisma, actor, profileId);
  return prisma.interventionGoal.findMany({
    where: { salesExecutiveProfileId: profileId },
    orderBy: { createdAt: "desc" },
    include: {
      owner: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  });
}
