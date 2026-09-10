import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();
const PASSWORD = "Password123!";

async function token(email: string) {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password: PASSWORD });
  return res.body.data.accessToken as string;
}

describe("Phase 17 — history preservation & audit trail", () => {
  let dbReady = false;
  let profileId: string;

  beforeAll(async () => {
    try {
      await prisma.$connect();
      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { displayName: "Sam Seller" },
      });
      if (!profile) {
        dbReady = false;
        return;
      }
      profileId = profile.id;
      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  it("rejects non–Super Admin from audit logs", async ({ skip }) => {
    if (!dbReady) skip();
    for (const email of [
      "teamlead@commando.local",
      "commando@commando.local",
      "sales@commando.local",
      "support@commando.local",
    ]) {
      const t = await token(email);
      const res = await request(app)
        .get("/api/audit-logs")
        .set("Authorization", `Bearer ${t}`);
      expect(res.status).toBe(403);
    }
  });

  it("Super Admin can list and filter audit logs", async ({ skip }) => {
    if (!dbReady) skip();
    const admin = await token("admin@commando.local");

    const list = await request(app)
      .get("/api/audit-logs?pageSize=10")
      .set("Authorization", `Bearer ${admin}`);
    expect(list.status).toBe(200);
    expect(list.body.data.total).toBeGreaterThan(0);
    expect(Array.isArray(list.body.data.items)).toBe(true);
    expect(list.body.data.items[0]).toMatchObject({
      action: expect.any(String),
      entityType: expect.any(String),
      createdAt: expect.any(String),
    });

    const facets = await request(app)
      .get("/api/audit-logs/facets")
      .set("Authorization", `Bearer ${admin}`);
    expect(facets.status).toBe(200);
    expect(facets.body.data.facets.actions.length).toBeGreaterThan(0);

    const detail = await request(app)
      .get(`/api/audit-logs/${list.body.data.items[0].id}`)
      .set("Authorization", `Bearer ${admin}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.auditLog.id).toBe(list.body.data.items[0].id);
  });

  it("SWOT create appends a new historical row and does not destroy prior", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const tl = await token("teamlead@commando.local");

    const first = await request(app)
      .post("/api/swot")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        strength: "History A",
        weakness: "w",
        opportunity: "o",
        threat: "t",
      });
    expect(first.status).toBe(201);
    const firstId = first.body.data.swot.id;

    const second = await request(app)
      .post("/api/swot")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        strength: "History B",
        weakness: "w",
        opportunity: "o",
        threat: "t",
      });
    expect(second.status).toBe(201);
    expect(second.body.data.swot.id).not.toBe(firstId);

    const original = await prisma.swotAnalysis.findUnique({
      where: { id: firstId },
    });
    expect(original?.strength).toBe("History A");

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: firstId, action: "SWOT_CREATED" },
    });
    expect(audit).toBeTruthy();
  });

  it("action item replace keeps the old record as REPLACED history", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");

    const created = await request(app)
      .post("/api/action-items")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        title: "Original history item",
      });
    expect(created.status).toBe(201);
    const originalId = created.body.data.actionItem.id;

    const replaced = await request(app)
      .post(`/api/action-items/${originalId}/replace`)
      .set("Authorization", `Bearer ${c}`)
      .send({ title: "Replacement history item" });
    expect(replaced.status).toBe(201);
    expect(replaced.body.data.actionItem.id).not.toBe(originalId);
    expect(replaced.body.data.actionItem.replacesId).toBe(originalId);

    const old = await prisma.actionItem.findUnique({
      where: { id: originalId },
    });
    expect(old?.status).toBe("REPLACED");
    expect(old?.title).toBe("Original history item");

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "ACTION_ITEM_REPLACED",
        entityId: replaced.body.data.actionItem.id,
      },
    });
    expect(audit?.metadata).toMatchObject({
      replacesId: originalId,
      verb: "REPLACE",
    });
  });

  it("feedback and performance creates are append-only historical records", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const tl = await token("teamlead@commando.local");

    const fb1 = await request(app)
      .post("/api/feedback")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        body: "First historical feedback",
      });
    expect(fb1.status).toBe(201);
    const fb1Id = fb1.body.data.feedback.id;

    const fb2 = await request(app)
      .post("/api/feedback")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        body: "Second historical feedback",
      });
    expect(fb2.status).toBe(201);
    expect(fb2.body.data.feedback.id).not.toBe(fb1Id);

    const still = await prisma.feedback.findUnique({ where: { id: fb1Id } });
    expect(still?.body).toBe("First historical feedback");

    const p1 = await request(app)
      .post("/api/performance")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        summary: "Eval one",
        scores: [
          {
            metricCode: "PIPELINE",
            metricLabel: "Pipeline",
            scoreValue: 70,
          },
        ],
      });
    expect(p1.status).toBe(201);
    const p1Id = p1.body.data.evaluation.id;

    const p2 = await request(app)
      .post("/api/performance")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        summary: "Eval two",
        scores: [
          {
            metricCode: "PIPELINE",
            metricLabel: "Pipeline",
            scoreValue: 80,
          },
        ],
      });
    expect(p2.status).toBe(201);
    expect(p2.body.data.evaluation.id).not.toBe(p1Id);

    const originalEval = await prisma.performanceEvaluation.findUnique({
      where: { id: p1Id },
    });
    expect(originalEval?.summary).toBe("Eval one");
  });
});
