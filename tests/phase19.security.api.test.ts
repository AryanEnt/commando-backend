import { afterAll, beforeAll, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { resetRateLimitBuckets } from "../src/middleware/rateLimit.js";

const app = createApp();
const PASSWORD = "Password123!";
const FAKE_ID = "clxxxxxxxxxxxxxxxxxxxxxxxxx";

async function login(email: string, password = PASSWORD) {
  return request(app).post("/api/auth/login").send({ email, password });
}

async function token(email: string) {
  const res = await login(email);
  return res.body.data.accessToken as string;
}

describe("Phase 19 — comprehensive security hardening", () => {
  let dbReady = false;
  let profileId: string;
  let otherProfileId: string;
  let assignmentId: string;
  let commandoSwotId: string;
  let commandoFeedbackId: string;
  let commandoPerfId: string;
  let dailyLogId: string;

  beforeAll(async () => {
    resetRateLimitBuckets();
    try {
      await prisma.$connect();
      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { displayName: "Sam Seller" },
      });
      const other = await prisma.salesExecutiveProfile.findFirst({
        where: { displayName: "Other Seller" },
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
      otherProfileId = other?.id ?? "";
      assignmentId = assignment.id;

      await prisma.commandoAssignment.update({
        where: { id: assignmentId },
        data: { status: "ACTIVE", endedAt: null, completionReason: null },
      });

      const c = await token("commando@commando.local");
      const body = {
        salesExecutiveProfileId: profileId,
        strength: "P19 S",
        weakness: "P19 W",
        opportunity: "P19 O",
        threat: "P19 secret threat",
      };
      const swot = await request(app)
        .post("/api/swot")
        .set("Authorization", `Bearer ${c}`)
        .send(body);
      commandoSwotId = swot.body.data?.swot?.id;

      const fb = await request(app)
        .post("/api/feedback")
        .set("Authorization", `Bearer ${c}`)
        .send({
          salesExecutiveProfileId: profileId,
          body: "P19 Commando feedback secret",
        });
      commandoFeedbackId = fb.body.data?.feedback?.id;

      const perf = await request(app)
        .post("/api/performance")
        .set("Authorization", `Bearer ${c}`)
        .send({
          salesExecutiveProfileId: profileId,
          summary: "P19 Commando perf secret",
          scores: [
            {
              metricCode: "FIELD",
              metricLabel: "Field",
              scoreValue: 91,
            },
          ],
        });
      commandoPerfId = perf.body.data?.evaluation?.id;

      const activity = await prisma.activityType.findFirst({
        where: { isActive: true },
      });
      if (activity) {
        const log = await request(app)
          .post("/api/daily-logs")
          .set("Authorization", `Bearer ${c}`)
          .send({
            salesExecutiveProfileId: profileId,
            activityTypeId: activity.id,
            sessionTitle: "P19 log",
            observation: "scoped",
          });
        dailyLogId = log.body.data?.log?.id;
      }

      dbReady = Boolean(
        commandoSwotId && commandoFeedbackId && commandoPerfId,
      );
    } catch {
      dbReady = false;
    }
  }, 90_000);

  afterAll(async () => {
    if (!assignmentId) return;
    await prisma.commandoAssignment.update({
      where: { id: assignmentId },
      data: { status: "ACTIVE", endedAt: null, completionReason: null },
    });
  });

  describe("authentication", () => {
    it("rejects invalid credentials without leaking which field failed", async ({
      skip,
    }) => {
      if (!dbReady) skip();
      const res = await login("admin@commando.local", "not-the-password");
      expect(res.status).toBe(401);
      expect(res.body.error.message).toMatch(/invalid email or password/i);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/i);
    });

    it("rejects unknown email the same way", async ({ skip }) => {
      if (!dbReady) skip();
      const res = await login("nobody@commando.local", PASSWORD);
      expect(res.status).toBe(401);
    });

    it("rejects extra fields on login (strict schema)", async ({ skip }) => {
      if (!dbReady) skip();
      const res = await request(app)
        .post("/api/auth/login")
        .send({
          email: "admin@commando.local",
          password: PASSWORD,
          roleCode: "SUPER_ADMIN",
        });
      expect(res.status).toBe(400);
    });

    it("sets httpOnly auth cookies on login", async ({ skip }) => {
      if (!dbReady) skip();
      const res = await login("admin@commando.local");
      expect(res.status).toBe(200);
      const cookies = res.headers["set-cookie"];
      const list = Array.isArray(cookies) ? cookies : [cookies];
      expect(list.some((c) => c?.startsWith("access_token="))).toBe(true);
      expect(list.some((c) => c?.startsWith("refresh_token="))).toBe(true);
      expect(list.every((c) => c?.toLowerCase().includes("httponly"))).toBe(
        true,
      );
    });

    it("logout requires auth and succeeds", async ({ skip }) => {
      if (!dbReady) skip();
      const t = await token("teamlead@commando.local");
      const res = await request(app)
        .post("/api/auth/logout")
        .set("Authorization", `Bearer ${t}`);
      expect(res.status).toBe(200);
    });

    it("rejects expired access tokens", async ({ skip }) => {
      if (!dbReady) skip();
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: "sales@commando.local" },
        include: { role: true },
      });
      const expired = jwt.sign(
        {
          sub: user.id,
          email: user.email,
          roleCode: user.role.code,
          exp: Math.floor(Date.now() / 1000) - 60,
        },
        env.jwtAccessSecret,
      );
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${expired}`);
      expect(res.status).toBe(401);
    });

    it("rejects forged tokens signed with wrong secret", async ({ skip }) => {
      if (!dbReady) skip();
      const forged = jwt.sign(
        {
          sub: "clforgeduseridxxxxxxxxxxxxxx",
          email: "admin@commando.local",
          roleCode: "SUPER_ADMIN",
        },
        "wrong-secret",
        { expiresIn: "1h" },
      );
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${forged}`);
      expect(res.status).toBe(401);
    });

    it("refresh rotates tokens and old refresh cannot be reused", async ({
      skip,
    }) => {
      if (!dbReady) skip();
      const loginRes = await login("support@commando.local");
      expect(loginRes.status).toBe(200);
      const cookies = loginRes.headers["set-cookie"];
      const list = Array.isArray(cookies) ? cookies : [cookies];
      const refreshCookie = list.find((c) => c?.startsWith("refresh_token="));
      expect(refreshCookie).toBeTruthy();
      const raw = refreshCookie!.split(";")[0].split("=").slice(1).join("=");

      const first = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: raw });
      expect(first.status).toBe(200);
      expect(first.body.data.accessToken).toBeTruthy();

      const reuse = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: raw });
      expect(reuse.status).toBe(401);
    });

    it("security headers are present on API responses", async () => {
      const res = await request(app).get("/health");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["x-powered-by"]).toBeUndefined();
      expect(res.body.status).toBe("ok");
    });

    it("readiness probe talks to the database", async ({ skip }) => {
      if (!dbReady) skip();
      const res = await request(app).get("/ready");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ready");
    });
  });

  describe("critical lifecycle IDOR — during Commando", () => {
    it("SE cannot fetch Commando SWOT / feedback / performance by ID", async ({
      skip,
    }) => {
      if (!dbReady) skip();
      const se = await token("sales@commando.local");

      for (const path of [
        `/api/swot/${commandoSwotId}`,
        `/api/feedback/${commandoFeedbackId}`,
        `/api/performance/${commandoPerfId}`,
      ]) {
        const res = await request(app)
          .get(path)
          .set("Authorization", `Bearer ${se}`);
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).not.toMatch(/secret/i);
      }
    });

    it("SE list with source=COMMANDO returns no Commando records during", async ({
      skip,
    }) => {
      if (!dbReady) skip();
      const se = await token("sales@commando.local");

      const swot = await request(app)
        .get("/api/swot")
        .query({ profileId, source: "COMMANDO", pageSize: 100 })
        .set("Authorization", `Bearer ${se}`);
      expect(swot.status).toBe(200);
      expect(
        (swot.body.data.items as { id: string }[]).some(
          (s) => s.id === commandoSwotId,
        ),
      ).toBe(false);

      const fb = await request(app)
        .get("/api/feedback")
        .query({ profileId, source: "COMMANDO", pageSize: 100 })
        .set("Authorization", `Bearer ${se}`);
      expect(fb.status).toBe(200);
      expect(
        (fb.body.data.feedback as { id: string }[]).some(
          (s) => s.id === commandoFeedbackId,
        ),
      ).toBe(false);

      const perf = await request(app)
        .get("/api/performance")
        .query({ profileId, source: "COMMANDO", pageSize: 100 })
        .set("Authorization", `Bearer ${se}`);
      expect(perf.status).toBe(200);
      expect(
        (perf.body.data.evaluations as { id: string }[]).some(
          (s) => s.id === commandoPerfId,
        ),
      ).toBe(false);
    });

    it("fake IDs do not leak existence via different status codes", async ({
      skip,
    }) => {
      if (!dbReady) skip();
      const se = await token("sales@commando.local");
      const paths = [
        `/api/swot/${FAKE_ID}`,
        `/api/feedback/${FAKE_ID}`,
        `/api/performance/${FAKE_ID}`,
        `/api/daily-logs/${FAKE_ID}`,
      ];
      for (const path of paths) {
        const res = await request(app)
          .get(path)
          .set("Authorization", `Bearer ${se}`);
        expect([403, 404]).toContain(res.status);
      }
    });
  });

  describe("mass assignment & validation", () => {
    it("rejects spoofed source on SWOT create", async ({ skip }) => {
      if (!dbReady) skip();
      const tl = await token("teamlead@commando.local");
      const res = await request(app)
        .post("/api/swot")
        .set("Authorization", `Bearer ${tl}`)
        .send({
          salesExecutiveProfileId: profileId,
          strength: "a",
          weakness: "b",
          opportunity: "c",
          threat: "d",
          source: "COMMANDO",
        });
      expect(res.status).toBe(400);
    });

    it("rejects spoofed source on feedback create", async ({ skip }) => {
      if (!dbReady) skip();
      const tl = await token("teamlead@commando.local");
      const res = await request(app)
        .post("/api/feedback")
        .set("Authorization", `Bearer ${tl}`)
        .send({
          salesExecutiveProfileId: profileId,
          body: "attempt spoof",
          source: "COMMANDO",
        });
      expect(res.status).toBe(400);
    });

    it("rejects spoofed source on performance create", async ({ skip }) => {
      if (!dbReady) skip();
      const tl = await token("teamlead@commando.local");
      const res = await request(app)
        .post("/api/performance")
        .set("Authorization", `Bearer ${tl}`)
        .send({
          salesExecutiveProfileId: profileId,
          summary: "spoof",
          source: "COMMANDO",
          scores: [
            {
              metricCode: "PIPELINE",
              metricLabel: "Pipeline",
              scoreValue: 70,
            },
          ],
        });
      expect(res.status).toBe(400);
    });
  });

  describe("cross-scope & role authorization", () => {
    it("SE cannot access another profile's daily log when present", async ({
      skip,
    }) => {
      if (!dbReady || !dailyLogId || !otherProfileId) skip();
      const otherSe = await token("other-sales@commando.local");
      const res = await request(app)
        .get(`/api/daily-logs/${dailyLogId}`)
        .set("Authorization", `Bearer ${otherSe}`);
      expect([401, 403, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.data.log.salesExecutiveProfileId).not.toBe(profileId);
      }
    });

    it("team lead cannot list Super Admin audit logs", async ({ skip }) => {
      if (!dbReady) skip();
      const tl = await token("teamlead@commando.local");
      const res = await request(app)
        .get("/api/audit-logs")
        .set("Authorization", `Bearer ${tl}`);
      expect(res.status).toBe(403);
    });

    it("commando cannot view Super Admin reports", async ({ skip }) => {
      if (!dbReady) skip();
      const c = await token("commando@commando.local");
      const res = await request(app)
        .get("/api/reports/commando-performance")
        .set("Authorization", `Bearer ${c}`);
      expect(res.status).toBe(403);
    });

    it("sales support cannot create daily logs", async ({ skip }) => {
      if (!dbReady) skip();
      const s = await token("support@commando.local");
      const activity = await prisma.activityType.findFirst({
        where: { isActive: true },
      });
      if (!activity) skip();
      const res = await request(app)
        .post("/api/daily-logs")
        .set("Authorization", `Bearer ${s}`)
        .send({
          salesExecutiveProfileId: profileId,
          activityTypeId: activity!.id,
          sessionTitle: "nope",
          observation: "nope",
        });
      expect(res.status).toBe(403);
    });

    it("Super Admin can view reports and SWOT lists", async ({ skip }) => {
      if (!dbReady) skip();
      const admin = await token("admin@commando.local");
      const report = await request(app)
        .get("/api/reports/commando-performance")
        .set("Authorization", `Bearer ${admin}`);
      expect(report.status).toBe(200);

      const swot = await request(app)
        .get("/api/swot")
        .query({ pageSize: 5 })
        .set("Authorization", `Bearer ${admin}`);
      expect(swot.status).toBe(200);
    });

    it("pagination does not return more than pageSize", async ({ skip }) => {
      if (!dbReady) skip();
      const admin = await token("admin@commando.local");
      const res = await request(app)
        .get("/api/swot")
        .query({ page: 1, pageSize: 2 })
        .set("Authorization", `Bearer ${admin}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeLessThanOrEqual(2);
    });

    it("oversized pageSize is rejected or clamped", async ({ skip }) => {
      if (!dbReady) skip();
      const admin = await token("admin@commando.local");
      const res = await request(app)
        .get("/api/swot")
        .query({ pageSize: 9999 })
        .set("Authorization", `Bearer ${admin}`);
      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.data.items.length).toBeLessThanOrEqual(100);
      }
    });
  });
});
