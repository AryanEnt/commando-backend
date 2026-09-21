import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import {
  getCommandoLifecycleState,
  roleCanViewCommandoPerformance,
  salesExecutiveCanViewActionItemStatus,
  salesExecutiveCanViewCoachingSource,
  salesExecutiveCanViewEisenhowerMonth,
  salesExecutiveCanViewEisenhowerOwnership,
  salesExecutiveCanViewMonitoring,
  salesExecutiveCanViewSwotSource,
} from "../src/lib/lifecycleVisibility.js";

const app = createApp();
const PASSWORD = "Password123!";
const FAKE_ID = "clxxxxxxxxxxxxxxxxxxxxxxxxx";

async function token(email: string) {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password: PASSWORD });
  return res.body.data.accessToken as string;
}

describe("Phase 14 — lifecycle visibility & unauthorized access", () => {
  let dbReady = false;
  let profileId: string;
  let assignmentId: string;
  let tlSwotId: string;
  let seSwotId: string;
  let commandoSwotId: string;
  let tlFeedbackId: string;
  let commandoFeedbackId: string;
  let tlPerfId: string;
  let commandoPerfId: string;
  let monitoringId: string;
  let completedActionId: string;
  let activeActionId: string;
  let historyEisenhowerId: string;
  let currentEisenhowerId: string;
  let draftReviewId: string;
  let submittedReviewId: string;

  beforeAll(async () => {
    try {
      await prisma.$connect();
      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { displayName: "Sam Seller" },
      });
      const assignment = await prisma.commandoAssignment.findFirst({
        where: {
          salesExecutiveProfileId: profile?.id,
          status: "ACTIVE",
        },
      });
      if (!profile || !assignment) {
        dbReady = false;
        return;
      }
      profileId = profile.id;
      assignmentId = assignment.id;

      // Ensure ACTIVE for during-Commando attack tests
      await prisma.commandoAssignment.update({
        where: { id: assignmentId },
        data: {
          status: "ACTIVE",
          endedAt: null,
          completionReason: null,
        },
      });

      const tl = await token("teamlead@commando.local");
      const se = await token("sales@commando.local");
      const c = await token("commando@commando.local");

      const swotBody = {
        salesExecutiveProfileId: profileId,
        strength: "P14 strength",
        weakness: "P14 weakness",
        opportunity: "P14 opportunity",
        threat: "P14 threat",
      };

      const tlSwot = await request(app)
        .post("/api/swot")
        .set("Authorization", `Bearer ${tl}`)
        .send(swotBody);
      tlSwotId = tlSwot.body.data?.swot?.id;

      const seSwot = await request(app)
        .post("/api/swot")
        .set("Authorization", `Bearer ${se}`)
        .send({ ...swotBody, strength: "SE self SWOT" });
      seSwotId = seSwot.body.data?.swot?.id;

      const cSwot = await request(app)
        .post("/api/swot")
        .set("Authorization", `Bearer ${c}`)
        .send({ ...swotBody, threat: "Commando SWOT secret" });
      commandoSwotId = cSwot.body.data?.swot?.id;

      const tlFb = await request(app)
        .post("/api/feedback")
        .set("Authorization", `Bearer ${tl}`)
        .send({
          salesExecutiveProfileId: profileId,
          body: "TL feedback visible",
        });
      tlFeedbackId = tlFb.body.data?.feedback?.id;

      const cFb = await request(app)
        .post("/api/feedback")
        .set("Authorization", `Bearer ${c}`)
        .send({
          salesExecutiveProfileId: profileId,
          body: "Commando feedback secret",
        });
      commandoFeedbackId = cFb.body.data?.feedback?.id;

      const scores = [
        {
          metricCode: "PIPELINE",
          metricLabel: "Pipeline",
          scoreValue: 88,
        },
      ];
      const tlPerf = await request(app)
        .post("/api/performance")
        .set("Authorization", `Bearer ${tl}`)
        .send({
          salesExecutiveProfileId: profileId,
          summary: "TL perf",
          scores,
        });
      tlPerfId = tlPerf.body.data?.evaluation?.id;

      const cPerf = await request(app)
        .post("/api/performance")
        .set("Authorization", `Bearer ${c}`)
        .send({
          salesExecutiveProfileId: profileId,
          summary: "Commando perf secret",
          scores: [
            {
              metricCode: "FIELD",
              metricLabel: "Field",
              scoreValue: 95,
            },
          ],
        });
      commandoPerfId = cPerf.body.data?.evaluation?.id;

      const category = await prisma.monitoringCategory.findFirst({
        where: { code: "MORNING_ROUTINE", isActive: true },
        include: {
          checklistItems: { where: { isActive: true }, take: 1 },
        },
      });
      if (category?.checklistItems[0]) {
        const mon = await request(app)
          .post("/api/monitoring")
          .set("Authorization", `Bearer ${c}`)
          .send({
            salesExecutiveProfileId: profileId,
            categoryId: category.id,
            observation: "Hidden during",
            responses: [
              {
                checklistItemId: category.checklistItems[0].id,
                value: "YES",
              },
            ],
          });
        monitoringId = mon.body.data?.record?.id;
      }

      const activeAi = await request(app)
        .post("/api/action-items")
        .set("Authorization", `Bearer ${c}`)
        .send({
          salesExecutiveProfileId: profileId,
          title: "P14 active action",
        });
      activeActionId = activeAi.body.data?.actionItem?.id;

      const histAi = await request(app)
        .post("/api/action-items")
        .set("Authorization", `Bearer ${c}`)
        .send({
          salesExecutiveProfileId: profileId,
          title: "P14 history action",
        });
      completedActionId = histAi.body.data?.actionItem?.id;
      if (completedActionId) {
        await request(app)
          .post(`/api/action-items/${completedActionId}/complete`)
          .set("Authorization", `Bearer ${c}`);
      }

      const now = new Date();
      const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      const priorMonthDate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
      );
      const priorMonth = `${priorMonthDate.getUTCFullYear()}-${String(priorMonthDate.getUTCMonth() + 1).padStart(2, "0")}`;

      const curEi = await request(app)
        .post("/api/eisenhower")
        .set("Authorization", `Bearer ${c}`)
        .send({
          salesExecutiveProfileId: profileId,
          month: currentMonth,
          category: "DO_FIRST",
          title: "P14 current month task",
        });
      currentEisenhowerId = curEi.body.data?.task?.id;

      const histEi = await request(app)
        .post("/api/eisenhower")
        .set("Authorization", `Bearer ${c}`)
        .send({
          salesExecutiveProfileId: profileId,
          month: priorMonth,
          category: "SCHEDULE",
          title: "P14 history month task",
        });
      historyEisenhowerId = histEi.body.data?.task?.id;

      const draft = await request(app)
        .post("/api/weekly-reviews")
        .set("Authorization", `Bearer ${c}`)
        .send({
          salesExecutiveProfileId: profileId,
          weekLabel: "P14-draft",
          weekStartDate: "2026-09-01T00:00:00.000Z",
          meetingDate: "2026-09-05T12:00:00.000Z",
          performanceSummary: "Draft only",
          whatWentWell: "x",
          improvement: "y",
          nextWeekAction: "z",
        });
      draftReviewId = draft.body.data?.review?.id;

      const submitted = await request(app)
        .post("/api/weekly-reviews")
        .set("Authorization", `Bearer ${c}`)
        .send({
          salesExecutiveProfileId: profileId,
          weekLabel: "P14-submitted",
          weekStartDate: "2026-08-25T00:00:00.000Z",
          meetingDate: "2026-08-29T12:00:00.000Z",
          performanceSummary: "Submitted review",
          whatWentWell: "a",
          improvement: "b",
          nextWeekAction: "c",
        });
      submittedReviewId = submitted.body.data?.review?.id;
      if (submittedReviewId) {
        await request(app)
          .post(`/api/weekly-reviews/${submittedReviewId}/submit`)
          .set("Authorization", `Bearer ${c}`);
      }

      dbReady = Boolean(
        tlSwotId &&
          seSwotId &&
          commandoSwotId &&
          tlFeedbackId &&
          commandoFeedbackId &&
          tlPerfId &&
          commandoPerfId &&
          activeActionId &&
          completedActionId &&
          currentEisenhowerId &&
          historyEisenhowerId,
      );
    } catch {
      dbReady = false;
    }
  });

  afterAll(async () => {
    if (!assignmentId) return;
    await prisma.commandoAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "ACTIVE",
        endedAt: null,
        completionReason: null,
      },
    });
  });

  it("unit: SE visibility policies during vs after", () => {
    const during = {
      hasActiveAssignment: true,
      hasCompletedAssignment: false,
      isDuringCommando: true,
      isAfterCommando: false,
    };
    const after = {
      hasActiveAssignment: false,
      hasCompletedAssignment: true,
      isDuringCommando: false,
      isAfterCommando: true,
    };

    expect(salesExecutiveCanViewSwotSource("COMMANDO", during)).toBe(false);
    expect(salesExecutiveCanViewSwotSource("COMMANDO", after)).toBe(true);
    expect(salesExecutiveCanViewCoachingSource("COMMANDO", during)).toBe(true);
    expect(salesExecutiveCanViewCoachingSource("COMMANDO", after)).toBe(true);
    expect(salesExecutiveCanViewMonitoring(during)).toBe(true);
    expect(salesExecutiveCanViewMonitoring(after)).toBe(true);
    expect(salesExecutiveCanViewActionItemStatus("COMPLETED", during)).toBe(
      false,
    );
    expect(salesExecutiveCanViewActionItemStatus("COMPLETED", after)).toBe(
      true,
    );
    expect(roleCanViewCommandoPerformance("TEAM_LEAD", after)).toBe(false);
    expect(roleCanViewCommandoPerformance("SALES_EXECUTIVE", during)).toBe(
      false,
    );
    expect(roleCanViewCommandoPerformance("SALES_EXECUTIVE", after)).toBe(true);

    const current = new Date(Date.UTC(2026, 8, 1));
    const prior = new Date(Date.UTC(2026, 7, 1));
    // Month helper retained for transitional callers; ownership is the SE rule.
    expect(
      salesExecutiveCanViewEisenhowerMonth(prior, current, during),
    ).toBe(false);
    expect(
      salesExecutiveCanViewEisenhowerMonth(prior, current, after),
    ).toBe(true);
    expect(salesExecutiveCanViewEisenhowerOwnership(null, null)).toBe(true);
    expect(salesExecutiveCanViewEisenhowerOwnership("a1", "ACTIVE")).toBe(
      false,
    );
    expect(salesExecutiveCanViewEisenhowerOwnership("a1", "COMPLETED")).toBe(
      true,
    );
    expect(salesExecutiveCanViewEisenhowerOwnership("a1", "EXITED")).toBe(
      true,
    );
  });

  it("during: SE cannot retrieve still-hidden Commando records by ID", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const lifecycle = await getCommandoLifecycleState(prisma, profileId);
    expect(lifecycle.isDuringCommando).toBe(true);

    const se = await token("sales@commando.local");

    expect(
      (
        await request(app)
          .get(`/api/swot/${commandoSwotId}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get(`/api/feedback/${commandoFeedbackId}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/performance/${commandoPerfId}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(403);
    if (monitoringId) {
      expect(
        (
          await request(app)
            .get(`/api/monitoring/${monitoringId}`)
            .set("Authorization", `Bearer ${se}`)
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await request(app)
          .get(`/api/action-items/${completedActionId}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get(`/api/eisenhower/${historyEisenhowerId}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(403);
  });

  it("during: SE can retrieve permitted records by ID", async ({ skip }) => {
    if (!dbReady) skip();
    const se = await token("sales@commando.local");

    expect(
      (
        await request(app)
          .get(`/api/swot/${tlSwotId}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/swot/${seSwotId}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/feedback/${tlFeedbackId}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/performance/${tlPerfId}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/action-items/${activeActionId}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/eisenhower/${currentEisenhowerId}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(200);
    if (submittedReviewId) {
      expect(
        (
          await request(app)
            .get(`/api/weekly-reviews/${submittedReviewId}`)
            .set("Authorization", `Bearer ${se}`)
        ).status,
      ).toBe(200);
    }
  });

  it("during: query/filter bypasses do not leak Commando data", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const se = await token("sales@commando.local");

    for (const path of [
      "/api/swot?source=COMMANDO",
      "/api/feedback?source=COMMANDO",
      "/api/performance?source=COMMANDO",
    ]) {
      const res = await request(app)
        .get(path)
        .set("Authorization", `Bearer ${se}`);
      expect(res.status).toBe(200);
      const rows =
        res.body.data.items ??
        res.body.data.feedback ??
        res.body.data.evaluations ??
        [];
      expect(rows).toHaveLength(0);
    }

    expect(
      (
        await request(app)
          .get("/api/action-items?view=history")
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get("/api/action-items?view=all")
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get("/api/action-items?status=COMPLETED")
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(403);

    const prior = new Date();
    prior.setUTCMonth(prior.getUTCMonth() - 1);
    const priorLabel = `${prior.getUTCFullYear()}-${String(prior.getUTCMonth() + 1).padStart(2, "0")}`;
    expect(
      (
        await request(app)
          .get(`/api/eisenhower?month=${priorLabel}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get(`/api/eisenhower/matrix?month=${priorLabel}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(403);

    const metrics = await request(app)
      .get("/api/performance/metrics")
      .set("Authorization", `Bearer ${se}`);
    expect(metrics.status).toBe(200);
    expect(metrics.body.data.metrics.currentCommandoScore.visible).toBe(false);
    expect(metrics.body.data.metrics.currentCommandoScore.evaluationId).toBeNull();
  });

  it("during: guessed / foreign IDs do not leak", async ({ skip }) => {
    if (!dbReady) skip();
    const se = await token("sales@commando.local");

    for (const path of [
      `/api/swot/${FAKE_ID}`,
      `/api/feedback/${FAKE_ID}`,
      `/api/performance/${FAKE_ID}`,
      `/api/monitoring/${FAKE_ID}`,
      `/api/action-items/${FAKE_ID}`,
      `/api/eisenhower/${FAKE_ID}`,
    ]) {
      const res = await request(app)
        .get(path)
        .set("Authorization", `Bearer ${se}`);
      expect([403, 404]).toContain(res.status);
    }
  });

  it("Team Lead cannot access Commando coaching records or metrics", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const tl = await token("teamlead@commando.local");

    expect(
      (
        await request(app)
          .get(`/api/swot/${commandoSwotId}`)
          .set("Authorization", `Bearer ${tl}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get(`/api/feedback/${commandoFeedbackId}`)
          .set("Authorization", `Bearer ${tl}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get(`/api/performance/${commandoPerfId}`)
          .set("Authorization", `Bearer ${tl}`)
      ).status,
    ).toBe(403);

    const metrics = await request(app)
      .get(`/api/performance/metrics?profileId=${profileId}`)
      .set("Authorization", `Bearer ${tl}`);
    expect(metrics.status).toBe(200);
    expect(metrics.body.data.metrics.currentCommandoScore.visible).toBe(false);
    expect(metrics.body.data.metrics.currentCommandoScore.evaluationId).toBeNull();
  });

  it("Sales Support cannot access coaching / SWOT / performance APIs", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const support = await token("support@commando.local");

    for (const path of [
      "/api/swot",
      "/api/feedback",
      "/api/performance",
      "/api/monitoring",
      "/api/action-items",
      "/api/eisenhower",
      "/api/daily-logs",
      "/api/weekly-reviews",
    ]) {
      const res = await request(app)
        .get(path)
        .set("Authorization", `Bearer ${support}`);
      expect(res.status).toBe(403);
    }

    expect(
      (
        await request(app)
          .get(`/api/swot/${commandoSwotId}`)
          .set("Authorization", `Bearer ${support}`)
      ).status,
    ).toBe(403);
  });

  it("Super Admin is read-only on coaching writes", async ({ skip }) => {
    if (!dbReady) skip();
    const admin = await token("admin@commando.local");

    expect(
      (
        await request(app)
          .post("/api/feedback")
          .set("Authorization", `Bearer ${admin}`)
          .send({
            salesExecutiveProfileId: profileId,
            body: "SA should not write",
          })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/performance")
          .set("Authorization", `Bearer ${admin}`)
          .send({
            salesExecutiveProfileId: profileId,
            scores: [
              {
                metricCode: "X",
                metricLabel: "X",
                scoreValue: 1,
              },
            ],
          })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/action-items")
          .set("Authorization", `Bearer ${admin}`)
          .send({
            salesExecutiveProfileId: profileId,
            title: "SA write blocked",
          })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/eisenhower")
          .set("Authorization", `Bearer ${admin}`)
          .send({
            salesExecutiveProfileId: profileId,
            month: "2026-09",
            category: "DO_FIRST",
            title: "SA write blocked",
          })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/swot")
          .set("Authorization", `Bearer ${admin}`)
          .send({
            salesExecutiveProfileId: profileId,
            strength: "a",
            weakness: "b",
            opportunity: "c",
            threat: "d",
          })
      ).status,
    ).toBe(403);

    // Read still allowed
    expect(
      (
        await request(app)
          .get(`/api/performance/${commandoPerfId}`)
          .set("Authorization", `Bearer ${admin}`)
      ).status,
    ).toBe(200);
  });

  it("after Commando: previously hidden records become visible to SE", async ({
    skip,
  }) => {
    if (!dbReady) skip();

    await prisma.commandoAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "COMPLETED",
        endedAt: new Date(),
        completionReason: "Phase 14 after-visibility",
      },
    });

    const lifecycle = await getCommandoLifecycleState(prisma, profileId);
    expect(lifecycle.isAfterCommando).toBe(true);

    const se = await token("sales@commando.local");

    expect(
      (
        await request(app)
          .get(`/api/swot/${commandoSwotId}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/feedback/${commandoFeedbackId}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/performance/${commandoPerfId}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/action-items/${completedActionId}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/eisenhower/${historyEisenhowerId}`)
          .set("Authorization", `Bearer ${se}`)
      ).status,
    ).toBe(200);
    if (monitoringId) {
      expect(
        (
          await request(app)
            .get(`/api/monitoring/${monitoringId}`)
            .set("Authorization", `Bearer ${se}`)
        ).status,
      ).toBe(200);
    }

    const history = await request(app)
      .get("/api/action-items?view=history")
      .set("Authorization", `Bearer ${se}`);
    expect(history.status).toBe(200);
    expect(
      history.body.data.actionItems.some(
        (i: { id: string }) => i.id === completedActionId,
      ),
    ).toBe(true);

    const metrics = await request(app)
      .get("/api/performance/metrics")
      .set("Authorization", `Bearer ${se}`);
    expect(metrics.status).toBe(200);
    expect(metrics.body.data.metrics.currentCommandoScore.visible).toBe(true);
    expect(metrics.body.data.metrics.currentCommandoScore.evaluationId).toBe(
      commandoPerfId,
    );

    // Restore for other suites
    await prisma.commandoAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "ACTIVE",
        endedAt: null,
        completionReason: null,
      },
    });
  });
});
