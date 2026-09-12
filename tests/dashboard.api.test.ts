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

describe("Super Admin Control Tower", () => {
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$connect();
      const admin = await prisma.user.findFirst({
        where: { email: "admin@commando.local", deletedAt: null },
      });
      dbReady = Boolean(admin);
    } catch {
      dbReady = false;
    }
  });

  it("rejects non–Super Admin from control tower", async ({ skip }) => {
    if (!dbReady) skip();

    for (const email of [
      "teamlead@commando.local",
      "commando@commando.local",
      "sales@commando.local",
      "support@commando.local",
    ]) {
      const t = await token(email);
      const res = await request(app)
        .get("/api/dashboard/control-tower")
        .set("Authorization", `Bearer ${t}`);
      expect(res.status).toBe(403);
    }
  });

  it("rejects non–Super Admin from organization structure", async ({
    skip,
  }) => {
    if (!dbReady) skip();

    const t = await token("teamlead@commando.local");
    const res = await request(app)
      .get("/api/dashboard/organization")
      .set("Authorization", `Bearer ${t}`);
    expect(res.status).toBe(403);
  });

  it("rejects non–Super Admin from reports overview", async ({ skip }) => {
    if (!dbReady) skip();

    const t = await token("commando@commando.local");
    const res = await request(app)
      .get("/api/reports/overview")
      .set("Authorization", `Bearer ${t}`);
    expect(res.status).toBe(403);
  });

  it("Super Admin receives control tower metrics and alerts", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const admin = await token("admin@commando.local");

    const res = await request(app)
      .get("/api/dashboard/control-tower")
      .set("Authorization", `Bearer ${admin}`);

    expect(res.status).toBe(200);
    expect(res.body.data.metrics.users).toMatchObject({
      total: expect.any(Number),
      active: expect.any(Number),
      inactive: expect.any(Number),
    });
    expect(res.body.data.metrics.teams).toEqual(expect.any(Number));
    expect(res.body.data.metrics.salesExecutives).toEqual(expect.any(Number));
    expect(res.body.data.metrics.interventions).toMatchObject({
      active: expect.any(Number),
      completed: expect.any(Number),
      exited: expect.any(Number),
    });
    expect(Array.isArray(res.body.data.alerts)).toBe(true);
    expect(res.body.data.attention).toMatchObject({
      pendingReferrals: expect.any(Array),
      overdueActions: expect.any(Array),
    });
    expect(typeof res.body.data.generatedAt).toBe("string");
    expect(Array.isArray(res.body.data.recentActivity)).toBe(true);
    expect(res.body.data.recentActivity.length).toBeLessThanOrEqual(8);
  });

  it("Super Admin receives organization structure", async ({ skip }) => {
    if (!dbReady) skip();
    const admin = await token("admin@commando.local");

    const res = await request(app)
      .get("/api/dashboard/organization")
      .set("Authorization", `Bearer ${admin}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.teams)).toBe(true);
    if (res.body.data.teams.length > 0) {
      const team = res.body.data.teams[0];
      expect(team).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        teamLeads: expect.any(Array),
        salesExecutives: expect.any(Array),
      });
    }
  });

  it("Super Admin receives reports overview without invented KPIs", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const admin = await token("admin@commando.local");

    const res = await request(app)
      .get("/api/reports/overview")
      .set("Authorization", `Bearer ${admin}`);

    expect(res.status).toBe(200);
    expect(res.body.data.counts.interventions).toMatchObject({
      active: expect.any(Number),
      completed: expect.any(Number),
      exited: expect.any(Number),
    });
    expect(Array.isArray(res.body.data.modules)).toBe(true);
    expect(res.body.data.modules.some((m: { key: string }) => m.key === "commando-performance")).toBe(
      true,
    );
  });
});
