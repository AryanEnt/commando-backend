import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import {
  getCommandoLifecycleState,
  salesExecutiveCanViewCoachingSource,
} from "../src/lib/lifecycleVisibility.js";
import { totalDaysUnderCommando } from "../src/lib/assignmentDays.js";

const app = createApp();
const PASSWORD = "Password123!";

async function token(email: string) {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password: PASSWORD });
  return res.body.data.accessToken as string;
}

describe("Feedback & performance (Phase 13)", () => {
  let dbReady = false;
  let profileId: string;
  let assignmentId: string;
  let assignmentStartedAt: Date;
  let tlFeedbackId: string;
  let commandoFeedbackId: string;
  let tlEvalId: string;
  let commandoEvalId: string;
  let firstTlFeedbackBody: string;

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
      assignmentStartedAt = assignment.startedAt;

      await prisma.feedback.deleteMany({
        where: { salesExecutiveProfileId: profileId },
      });
      await prisma.performanceEvaluation.deleteMany({
        where: { salesExecutiveProfileId: profileId },
      });

      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  afterAll(async () => {
    if (!dbReady || !assignmentId) return;
    // Ensure assignment is ACTIVE for other suites
    await prisma.commandoAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "ACTIVE",
        endedAt: null,
        completionReason: null,
      },
    });
  });

  it("unit: coaching source visibility during vs after Commando", () => {
    const during = {
      hasActiveAssignment: true,
      hasCompletedAssignment: false,
      isDuringCommando: true,
      isAfterCommando: false,
    };
    expect(salesExecutiveCanViewCoachingSource("TEAM_LEAD", during)).toBe(true);
    expect(salesExecutiveCanViewCoachingSource("COMMANDO", during)).toBe(true);

    const after = {
      hasActiveAssignment: false,
      hasCompletedAssignment: true,
      isDuringCommando: false,
      isAfterCommando: true,
    };
    expect(salesExecutiveCanViewCoachingSource("TEAM_LEAD", after)).toBe(true);
    expect(salesExecutiveCanViewCoachingSource("COMMANDO", after)).toBe(true);
  });

  it("creates append-only feedback with creator, source, SE, assignment, timestamp", async ({
    skip,
  }) => {
    if (!dbReady) skip();

    const tl = await token("teamlead@commando.local");
    firstTlFeedbackBody = "TL coaching note — week 1";
    const tlRes = await request(app)
      .post("/api/feedback")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        body: firstTlFeedbackBody,
      });
    expect(tlRes.status).toBe(201);
    expect(tlRes.body.data.feedback.source).toBe("TEAM_LEAD");
    expect(tlRes.body.data.feedback.body).toBe(firstTlFeedbackBody);
    expect(tlRes.body.data.feedback.createdById).toBeTruthy();
    expect(tlRes.body.data.feedback.salesExecutiveProfileId).toBe(profileId);
    expect(tlRes.body.data.feedback.createdAt).toBeTruthy();
    tlFeedbackId = tlRes.body.data.feedback.id;

    const c = await token("commando@commando.local");
    const cRes = await request(app)
      .post("/api/feedback")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        body: "Commando field observation",
      });
    expect(cRes.status).toBe(201);
    expect(cRes.body.data.feedback.source).toBe("COMMANDO");
    expect(cRes.body.data.feedback.assignmentId).toBe(assignmentId);
    commandoFeedbackId = cRes.body.data.feedback.id;

    // Second TL note must not overwrite the first
    const tl2 = await request(app)
      .post("/api/feedback")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        body: "TL coaching note — week 2 (new record)",
      });
    expect(tl2.status).toBe(201);
    expect(tl2.body.data.feedback.id).not.toBe(tlFeedbackId);

    const original = await prisma.feedback.findUnique({
      where: { id: tlFeedbackId },
    });
    expect(original?.body).toBe(firstTlFeedbackBody);
  });

  it("during Commando: SE sees TL and Commando feedback", async ({
    skip,
  }) => {
    if (!dbReady || !tlFeedbackId || !commandoFeedbackId) skip();

    const lifecycle = await getCommandoLifecycleState(prisma, profileId);
    expect(lifecycle.isDuringCommando).toBe(true);

    const se = await token("sales@commando.local");

    const tlView = await request(app)
      .get(`/api/feedback/${tlFeedbackId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(tlView.status).toBe(200);

    const commandoView = await request(app)
      .get(`/api/feedback/${commandoFeedbackId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(commandoView.status).toBe(200);

    const list = await request(app)
      .get("/api/feedback")
      .set("Authorization", `Bearer ${se}`);
    expect(list.status).toBe(200);
    const sources = list.body.data.feedback.map(
      (f: { source: string }) => f.source,
    );
    expect(sources).toContain("TEAM_LEAD");
    expect(sources).toContain("COMMANDO");
  });

  it("SE can acknowledge Team Lead and Commando feedback", async ({ skip }) => {
    if (!dbReady || !tlFeedbackId || !commandoFeedbackId) skip();
    const se = await token("sales@commando.local");
    const c = await token("commando@commando.local");

    const blocked = await request(app)
      .post(`/api/feedback/${tlFeedbackId}/acknowledge`)
      .set("Authorization", `Bearer ${c}`);
    expect(blocked.status).toBe(403);

    const ackTl = await request(app)
      .post(`/api/feedback/${tlFeedbackId}/acknowledge`)
      .set("Authorization", `Bearer ${se}`);
    expect(ackTl.status).toBe(200);
    expect(ackTl.body.data.feedback.acknowledgedAt).toBeTruthy();

    const ackCo = await request(app)
      .post(`/api/feedback/${commandoFeedbackId}/acknowledge`)
      .set("Authorization", `Bearer ${se}`);
    expect(ackCo.status).toBe(200);
    expect(ackCo.body.data.feedback.acknowledgedAt).toBeTruthy();

    const listed = await request(app)
      .get("/api/feedback")
      .set("Authorization", `Bearer ${se}`);
    const row = listed.body.data.feedback.find(
      (f: { id: string }) => f.id === tlFeedbackId,
    );
    expect(row?.acknowledgedAt).toBeTruthy();
  });

  it("creates performance evaluations with preserved scores and source", async ({
    skip,
  }) => {
    if (!dbReady) skip();

    const tl = await token("teamlead@commando.local");
    const tlRes = await request(app)
      .post("/api/performance")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        summary: "Solid pipeline hygiene",
        verdict: "On track",
        scores: [
          {
            metricCode: "PIPELINE",
            metricLabel: "Pipeline quality",
            scoreValue: 80,
          },
          {
            metricCode: "ACTIVITY",
            metricLabel: "Activity volume",
            scoreValue: 70,
          },
        ],
      });
    expect(tlRes.status).toBe(201);
    expect(tlRes.body.data.evaluation.source).toBe("TEAM_LEAD");
    expect(tlRes.body.data.evaluation.scores).toHaveLength(2);
    expect(tlRes.body.data.evaluation.averageMetricScore).toBe(75);
    expect(tlRes.body.data.evaluation.rating).toBe(3.75);
    tlEvalId = tlRes.body.data.evaluation.id;

    const c = await token("commando@commando.local");
    const cRes = await request(app)
      .post("/api/performance")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        summary: "Field readiness improved",
        verdict: "Continue Commando",
        scores: [
          {
            metricCode: "FIELD",
            metricLabel: "Field execution",
            scoreValue: 90,
          },
          {
            metricCode: "DISCIPLINE",
            metricLabel: "Process discipline",
            scoreValue: 85,
          },
        ],
      });
    expect(cRes.status).toBe(201);
    expect(cRes.body.data.evaluation.source).toBe("COMMANDO");
    expect(cRes.body.data.evaluation.assignmentId).toBe(assignmentId);
    expect(cRes.body.data.evaluation.averageMetricScore).toBe(87.5);
    commandoEvalId = cRes.body.data.evaluation.id;

    // Historical preservation — new eval does not mutate prior
    const tl2 = await request(app)
      .post("/api/performance")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        summary: "Updated TL view — new evaluation",
        scores: [
          {
            metricCode: "PIPELINE",
            metricLabel: "Pipeline quality",
            scoreValue: 60,
          },
        ],
      });
    expect(tl2.status).toBe(201);
    expect(tl2.body.data.evaluation.id).not.toBe(tlEvalId);

    const original = await prisma.performanceEvaluation.findUnique({
      where: { id: tlEvalId },
      include: { scores: true },
    });
    expect(original?.summary).toBe("Solid pipeline hygiene");
    expect(original?.scores).toHaveLength(2);
  });

  it("during Commando: SE sees TL performance, not Commando; metrics hide Commando score", async ({
    skip,
  }) => {
    if (!dbReady || !tlEvalId || !commandoEvalId) skip();

    const se = await token("sales@commando.local");

    const tlView = await request(app)
      .get(`/api/performance/${tlEvalId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(tlView.status).toBe(200);
    expect(tlView.body.data.evaluation.source).toBe("TEAM_LEAD");

    const hidden = await request(app)
      .get(`/api/performance/${commandoEvalId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(hidden.status).toBe(403);

    const list = await request(app)
      .get("/api/performance")
      .set("Authorization", `Bearer ${se}`);
    expect(list.status).toBe(200);
    const sources = list.body.data.evaluations.map(
      (e: { source: string }) => e.source,
    );
    expect(sources).toContain("TEAM_LEAD");
    expect(sources).not.toContain("COMMANDO");

    const metrics = await request(app)
      .get("/api/performance/metrics")
      .set("Authorization", `Bearer ${se}`);
    expect(metrics.status).toBe(200);
    const m = metrics.body.data.metrics;
    expect(m.lifecycle.isDuringCommando).toBe(true);
    expect(m.currentCommandoScore.visible).toBe(false);
    expect(m.currentCommandoScore.evaluationId).toBeNull();
    expect(m.myPerformanceMetric?.source).toBe("TEAM_LEAD");
    expect(m.myPerformanceMetric?.evaluationId).toBeTruthy();
    expect(m.totalDaysUnderCommando).toBe(
      totalDaysUnderCommando(assignmentStartedAt, null),
    );
  });

  it("after Commando: SE sees both feedback and performance; Commando score traced", async ({
    skip,
  }) => {
    if (
      !dbReady ||
      !commandoFeedbackId ||
      !commandoEvalId ||
      !assignmentId
    ) {
      skip();
    }

    await prisma.commandoAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "COMPLETED",
        endedAt: new Date(),
        completionReason: "Phase 13 visibility test",
      },
    });

    const lifecycle = await getCommandoLifecycleState(prisma, profileId);
    expect(lifecycle.isAfterCommando).toBe(true);

    const se = await token("sales@commando.local");

    const fb = await request(app)
      .get(`/api/feedback/${commandoFeedbackId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(fb.status).toBe(200);
    expect(fb.body.data.feedback.source).toBe("COMMANDO");

    const fbList = await request(app)
      .get("/api/feedback")
      .set("Authorization", `Bearer ${se}`);
    expect(fbList.status).toBe(200);
    expect(
      fbList.body.data.feedback.map((f: { source: string }) => f.source),
    ).toContain("COMMANDO");

    const perf = await request(app)
      .get(`/api/performance/${commandoEvalId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(perf.status).toBe(200);
    expect(perf.body.data.evaluation.source).toBe("COMMANDO");
    expect(perf.body.data.evaluation.scores.length).toBeGreaterThan(0);

    const metrics = await request(app)
      .get("/api/performance/metrics")
      .set("Authorization", `Bearer ${se}`);
    expect(metrics.status).toBe(200);
    const m = metrics.body.data.metrics;
    expect(m.lifecycle.isAfterCommando).toBe(true);
    expect(m.currentCommandoScore.visible).toBe(true);
    expect(m.currentCommandoScore.evaluationId).toBe(commandoEvalId);
    expect(m.currentCommandoScore.source).toBe("COMMANDO");
    expect(m.currentCommandoScore.averageMetricScore).toBe(87.5);
    expect(m.currentCommandoScore.scores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricCode: "FIELD",
          scoreValue: 90,
        }),
      ]),
    );
    // Restore active assignment for other suites
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
