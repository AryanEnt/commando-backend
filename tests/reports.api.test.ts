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

describe("Phase 16 — Super Admin reporting", () => {
  let dbReady = false;
  let assignmentId: string;
  let profileId: string;

  beforeAll(async () => {
    try {
      await prisma.$connect();
      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { displayName: "Sam Seller" },
      });
      const assignment = await prisma.commandoAssignment.findFirst({
        where: { salesExecutiveProfileId: profile?.id },
        orderBy: { startedAt: "desc" },
      });
      if (!profile || !assignment) {
        dbReady = false;
        return;
      }
      profileId = profile.id;
      assignmentId = assignment.id;
      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  it("rejects non–Super Admin from Commando performance report", async ({
    skip,
  }) => {
    if (!dbReady) skip();

    for (const email of [
      "teamlead@commando.local",
      "commando@commando.local",
      "sales@commando.local",
      "support@commando.local",
    ]) {
      const t = await token(email);
      const res = await request(app)
        .get("/api/reports/commando-performance")
        .set("Authorization", `Bearer ${t}`);
      expect(res.status).toBe(403);
    }
  });

  it("Super Admin can list report with filters, search, pagination", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const admin = await token("admin@commando.local");

    const list = await request(app)
      .get(`/api/reports/commando-performance?page=1&pageSize=10&profileId=${profileId}`)
      .set("Authorization", `Bearer ${admin}`);
    expect(list.status).toBe(200);
    expect(list.body.data.total).toBeGreaterThan(0);
    expect(Array.isArray(list.body.data.rows)).toBe(true);

    const row = list.body.data.rows[0];
    expect(row).toMatchObject({
      assignmentId: expect.any(String),
      commando: expect.objectContaining({ name: expect.any(String) }),
      profile: expect.objectContaining({ displayName: expect.any(String) }),
      assigned: expect.any(String),
      swot: expect.objectContaining({ count: expect.any(Number), swotIds: expect.any(Array) }),
      eisenhower: expect.objectContaining({
        count: expect.any(Number),
        taskIds: expect.any(Array),
      }),
    });
    // Avg. Score is null or a number — never invented without scores
    expect(
      row.avgScore === null || typeof row.avgScore === "number",
    ).toBe(true);
    if (row.avgScore != null) {
      expect(row.avgScoreSource?.evaluationId).toBeTruthy();
      expect(row.avgScoreSource?.scoreCount).toBeGreaterThan(0);
    }
  });

  it("Super Admin can open detail with source record traceability", async ({
    skip,
  }) => {
    if (!dbReady || !assignmentId) skip();
    const admin = await token("admin@commando.local");

    const detail = await request(app)
      .get(`/api/reports/commando-performance/${assignmentId}`)
      .set("Authorization", `Bearer ${admin}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.report.assignmentId).toBe(assignmentId);
    expect(detail.body.data.report.sourceRecords).toBeTruthy();
    expect(
      Array.isArray(detail.body.data.report.sourceRecords.performanceEvaluations),
    ).toBe(true);
    expect(
      Array.isArray(detail.body.data.report.sourceRecords.swotAnalyses),
    ).toBe(true);
    expect(
      Array.isArray(detail.body.data.report.sourceRecords.eisenhowerTasks),
    ).toBe(true);
  });

  it("SWOT list remains read-only for Super Admin with source filters", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const admin = await token("admin@commando.local");

    const create = await request(app)
      .post("/api/swot")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        salesExecutiveProfileId: profileId,
        strength: "x",
        weakness: "y",
        opportunity: "z",
        threat: "w",
      });
    expect(create.status).toBe(403);

    const list = await request(app)
      .get(`/api/swot?profileId=${profileId}&source=COMMANDO`)
      .set("Authorization", `Bearer ${admin}`);
    expect(list.status).toBe(200);
    expect(
      list.body.data.items.every(
        (i: { source: string }) => i.source === "COMMANDO",
      ),
    ).toBe(true);
  });
});
