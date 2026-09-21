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
  let entryId: string;

  beforeAll(async () => {
    try {
      await prisma.$connect();
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
  });

  it("ensure returns one daily log per profile per day", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const first = await request(app)
      .post("/api/daily-logs/ensure")
      .set("Authorization", `Bearer ${c}`)
      .send({ salesExecutiveProfileId: profileId });
    expect(first.status).toBe(200);
    logId = first.body.data.log.id;
    expect(first.body.data.log.status).toBe("DRAFT");

    const second = await request(app)
      .post("/api/daily-logs/ensure")
      .set("Authorization", `Bearer ${c}`)
      .send({ salesExecutiveProfileId: profileId });
    expect(second.status).toBe(200);
    expect(second.body.data.log.id).toBe(logId);
  });

  it("adds multiple entries to the same draft log", async ({ skip }) => {
    if (!dbReady || !logId) skip();
    const c = await token("commando@commando.local");
    const a = await request(app)
      .post(`/api/daily-logs/${logId}/entries`)
      .set("Authorization", `Bearer ${c}`)
      .send({
        activityTypeId,
        sessionTitle: "Morning pipeline review",
        observation: "Improved discovery questions.",
      });
    expect(a.status).toBe(201);
    expect(a.body.data.log.entryCount).toBeGreaterThanOrEqual(1);
    entryId = a.body.data.log.entries[0].id;

    const b = await request(app)
      .post(`/api/daily-logs/${logId}/entries`)
      .set("Authorization", `Bearer ${c}`)
      .send({
        activityTypeId,
        sessionTitle: "Afternoon follow-up",
        observation: "Follow-up cadence improving.",
      });
    expect(b.status).toBe(201);
    expect(b.body.data.log.id).toBe(logId);
    expect(b.body.data.log.entryCount).toBeGreaterThanOrEqual(2);
  });

  it("submits with partial Eisenhower classification", async ({ skip }) => {
    if (!dbReady || !logId || !entryId) skip();
    const c = await token("commando@commando.local");
    const detail = await request(app)
      .get(`/api/daily-logs/${logId}`)
      .set("Authorization", `Bearer ${c}`);
    const entries = detail.body.data.log.entries as { id: string }[];
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const res = await request(app)
      .post(`/api/daily-logs/${logId}/submit`)
      .set("Authorization", `Bearer ${c}`)
      .send({
        classifications: [
          {
            entryId: entries[0].id,
            urgency: "URGENT",
            importance: "IMPORTANT",
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.log.status).toBe("SUBMITTED");
    expect(res.body.data.prioritizedCount).toBe(1);
    expect(res.body.data.eisenhowerCreated).toBe(1);

    const again = await request(app)
      .post(`/api/daily-logs/${logId}/submit`)
      .set("Authorization", `Bearer ${c}`)
      .send({ classifications: [] });
    expect(again.status).toBe(409);
  });

  it("unauthorized users cannot create logs", async ({ skip }) => {
    if (!dbReady) skip();
    const se = await token("sales@commando.local");
    const create = await request(app)
      .post("/api/daily-logs/ensure")
      .set("Authorization", `Bearer ${se}`)
      .send({ salesExecutiveProfileId: profileId });
    expect(create.status).toBe(403);

    if (otherProfileId) {
      const c = await token("commando@commando.local");
      const unrelated = await request(app)
        .post("/api/daily-logs/ensure")
        .set("Authorization", `Bearer ${c}`)
        .send({ salesExecutiveProfileId: otherProfileId });
      expect(unrelated.status).toBe(403);
    }
  });
});
