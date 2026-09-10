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

describe("daily logs and activity types", () => {
  let dbReady = false;
  let profileId: string;
  let otherProfileId: string | undefined;
  let activityTypeId: string;
  let logId: string;

  beforeAll(async () => {
    try {
      await prisma.$connect();
      // Ensure seed activity types exist
      await prisma.activityType.upsert({
        where: { code: "COACHING_SESSION" },
        update: { isActive: true, archivedAt: null, name: "Coaching Session" },
        create: {
          code: "COACHING_SESSION",
          name: "Coaching Session",
          description: "One-to-one coaching conversation",
        },
      });

      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { displayName: "Sam Seller" },
      });
      const activityType = await prisma.activityType.findUnique({
        where: { code: "COACHING_SESSION" },
      });
      const other = await prisma.salesExecutiveProfile.findFirst({
        where: { displayName: "Other Seller" },
      });
      if (!profile || !activityType) {
        dbReady = false;
        return;
      }
      profileId = profile.id;
      activityTypeId = activityType.id;
      otherProfileId = other?.id;
      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  it("lists activity types from the database (not hardcoded)", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .get("/api/activity-types")
      .set("Authorization", `Bearer ${c}`);
    expect(res.status).toBe(200);
    expect(res.body.data.activityTypes.length).toBeGreaterThan(0);
    expect(
      res.body.data.activityTypes.some(
        (t: { code: string }) => t.code === "COACHING_SESSION",
      ),
    ).toBe(true);
  });

  it("admin can create activity types", async ({ skip }) => {
    if (!dbReady) skip();
    const admin = await token("admin@commando.local");
    const code = `TEST_TYPE_${Date.now()}`;
    const res = await request(app)
      .post("/api/activity-types")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        code,
        name: "Test Activity",
        description: "Configured via API",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.activityType.code).toBe(code);
  });

  it("commando cannot manage activity types", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .post("/api/activity-types")
      .set("Authorization", `Bearer ${c}`)
      .send({
        code: "UNAUTHORIZED_TYPE",
        name: "Nope",
      });
    expect(res.status).toBe(403);
  });

  it("commando creates daily log for assigned profile", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .post("/api/daily-logs")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        activityTypeId,
        sessionTitle: "Morning pipeline review",
        observation: "Improved discovery questions; still rushing close.",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.log.sessionTitle).toBe("Morning pipeline review");
    expect(res.body.data.log.activityType.code).toBe("COACHING_SESSION");
    expect(res.body.data.log.assignmentId).toBeTruthy();
    expect(res.body.data.log.loggedAt).toBeTruthy();
    logId = res.body.data.log.id;

    // Historical intact: second create is a new row
    const second = await request(app)
      .post("/api/daily-logs")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        activityTypeId,
        sessionTitle: "Afternoon follow-up",
        observation: "Follow-up cadence improving.",
      });
    expect(second.status).toBe(201);
    expect(second.body.data.log.id).not.toBe(logId);
  });

  it("lists recent logs with date/time/profile/activity/title", async ({
    skip,
  }) => {
    if (!dbReady || !logId) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .get("/api/daily-logs?search=pipeline")
      .set("Authorization", `Bearer ${c}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThan(0);
    const log = res.body.data.logs.find((l: { id: string }) => l.id === logId);
    expect(log).toBeTruthy();
    expect(log.profile.displayName).toBeTruthy();
    expect(log.activityType.name).toBeTruthy();
    expect(log.sessionTitle).toBeTruthy();
    expect(log.loggedAt).toBeTruthy();
  });

  it("unauthorized users cannot create or view unrelated logs", async ({
    skip,
  }) => {
    if (!dbReady || !logId) skip();
    const se = await token("sales@commando.local");
    const create = await request(app)
      .post("/api/daily-logs")
      .set("Authorization", `Bearer ${se}`)
      .send({
        salesExecutiveProfileId: profileId,
        activityTypeId,
        sessionTitle: "Nope",
        observation: "Nope",
      });
    expect(create.status).toBe(403);

    const view = await request(app)
      .get(`/api/daily-logs/${logId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(view.status).toBe(403);

    if (otherProfileId) {
      const c = await token("commando@commando.local");
      const unrelated = await request(app)
        .post("/api/daily-logs")
        .set("Authorization", `Bearer ${c}`)
        .send({
          salesExecutiveProfileId: otherProfileId,
          activityTypeId,
          sessionTitle: "Out of scope",
          observation: "Should fail",
        });
      expect(unrelated.status).toBe(403);
    }
  });

  it("detail returns historical log intact", async ({ skip }) => {
    if (!dbReady || !logId) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .get(`/api/daily-logs/${logId}`)
      .set("Authorization", `Bearer ${c}`);
    expect(res.status).toBe(200);
    expect(res.body.data.log.sessionTitle).toBe("Morning pipeline review");
  });
});
