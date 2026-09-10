import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/password.js";

const app = createApp();
const PASSWORD = "Password123!";

async function login(email: string) {
  return request(app)
    .post("/api/auth/login")
    .send({ email, password: PASSWORD });
}

describe("auth & authorization API", () => {
  let dbReady = false;
  let salesProfileId: string | undefined;
  let otherTeamProfileId: string | undefined;
  let syncEvalForSupport: string | undefined;
  let syncEvalUnrelated: string | undefined;

  beforeAll(async () => {
    try {
      await prisma.$connect();
      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { displayName: "Sam Seller" },
      });
      salesProfileId = profile?.id;

      const otherTeam = await prisma.team.upsert({
        where: { id: "seed-team-beta" },
        update: {},
        create: {
          id: "seed-team-beta",
          name: "Beta Sales Team",
        },
      });

      const otherRole = await prisma.role.findUniqueOrThrow({
        where: { code: "SALES_EXECUTIVE" },
      });

      const passwordHash = await hashPassword(PASSWORD);
      const otherUser = await prisma.user.upsert({
        where: { email: "other-sales@commando.local" },
        update: { passwordHash },
        create: {
          email: "other-sales@commando.local",
          firstName: "Other",
          lastName: "Seller",
          passwordHash,
          roleId: otherRole.id,
        },
      });

      const otherProfile = await prisma.salesExecutiveProfile.upsert({
        where: { userId: otherUser.id },
        update: { teamId: otherTeam.id, displayName: "Other Seller" },
        create: {
          userId: otherUser.id,
          teamId: otherTeam.id,
          displayName: "Other Seller",
        },
      });
      otherTeamProfileId = otherProfile.id;

      const support = await prisma.user.findUniqueOrThrow({
        where: { email: "support@commando.local" },
      });
      const commando = await prisma.user.findUniqueOrThrow({
        where: { email: "commando@commando.local" },
      });
      const admin = await prisma.user.findUniqueOrThrow({
        where: { email: "admin@commando.local" },
      });
      const assignment = await prisma.commandoAssignment.findFirst({
        where: {
          salesExecutiveProfileId: salesProfileId,
          status: "ACTIVE",
        },
      });

      if (salesProfileId && assignment) {
        const existing = await prisma.syncEvaluation.findFirst({
          where: {
            salesExecutiveProfileId: salesProfileId,
            salesSupportUserId: support.id,
          },
        });
        if (existing) {
          syncEvalForSupport = existing.id;
        } else {
          const created = await prisma.syncEvaluation.create({
            data: {
              salesExecutiveProfileId: salesProfileId,
              salesSupportUserId: support.id,
              assignmentId: assignment.id,
              issue: "Follow-up lag",
              recommendedAction: "Daily sync call",
              createdById: commando.id,
            },
          });
          syncEvalForSupport = created.id;
        }

        const negative = await prisma.syncEvaluation.create({
          data: {
            salesExecutiveProfileId: otherProfile.id,
            salesSupportUserId: admin.id,
            issue: "Out of scope",
            recommendedAction: "Ignore",
            createdById: commando.id,
          },
        });
        syncEvalUnrelated = negative.id;
      }

      dbReady = Boolean(salesProfileId);
    } catch (err) {
      console.warn("DB not ready for integration tests:", err);
      dbReady = false;
    }
  }, 60_000);

  it("valid login returns user and token", async ({ skip }) => {
    if (!dbReady) skip();
    const res = await login("admin@commando.local");
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe("admin@commando.local");
    expect(res.body.data.user.roleCode).toBe("SUPER_ADMIN");
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.permissions.length).toBeGreaterThan(0);
  });

  it("invalid login is rejected", async ({ skip }) => {
    if (!dbReady) skip();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@commando.local", password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("unauthenticated /me is rejected", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("authenticated /me returns current user", async ({ skip }) => {
    if (!dbReady) skip();
    const loginRes = await login("teamlead@commando.local");
    const token = loginRes.body.data.accessToken as string;
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe("teamlead@commando.local");
  });

  it("logout clears session", async ({ skip }) => {
    if (!dbReady) skip();
    const loginRes = await login("commando@commando.local");
    const token = loginRes.body.data.accessToken as string;
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("unauthorized role cannot list users", async ({ skip }) => {
    if (!dbReady) skip();
    const loginRes = await login("sales@commando.local");
    const token = loginRes.body.data.accessToken as string;
    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("super admin can list users", async ({ skip }) => {
    if (!dbReady) skip();
    const loginRes = await login("admin@commando.local");
    const token = loginRes.body.data.accessToken as string;
    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.users.length).toBeGreaterThanOrEqual(5);
  });

  it("team lead can view in-scope profile", async ({ skip }) => {
    if (!dbReady || !salesProfileId) skip();
    const loginRes = await login("teamlead@commando.local");
    const token = loginRes.body.data.accessToken as string;
    const res = await request(app)
      .get(`/api/profiles/${salesProfileId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.profile.id).toBe(salesProfileId);
  });

  it("team lead cannot view out-of-scope profile", async ({ skip }) => {
    if (!dbReady || !otherTeamProfileId) skip();
    const loginRes = await login("teamlead@commando.local");
    const token = loginRes.body.data.accessToken as string;
    const res = await request(app)
      .get(`/api/profiles/${otherTeamProfileId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("sales executive cannot view another profile", async ({ skip }) => {
    if (!dbReady || !otherTeamProfileId) skip();
    const loginRes = await login("sales@commando.local");
    const token = loginRes.body.data.accessToken as string;
    const res = await request(app)
      .get(`/api/profiles/${otherTeamProfileId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("sales support can view relevant sync evaluation", async ({ skip }) => {
    if (!dbReady || !syncEvalForSupport) skip();
    const loginRes = await login("support@commando.local");
    const token = loginRes.body.data.accessToken as string;
    const res = await request(app)
      .get(`/api/sync-evaluations/${syncEvalForSupport}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("sales support cannot view unrelated sync evaluation", async ({
    skip,
  }) => {
    if (!dbReady || !syncEvalUnrelated) skip();
    const loginRes = await login("support@commando.local");
    const token = loginRes.body.data.accessToken as string;
    const res = await request(app)
      .get(`/api/sync-evaluations/${syncEvalUnrelated}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("sales executive lacks SYNC_EVAL_VIEW", async ({ skip }) => {
    if (!dbReady || !syncEvalForSupport) skip();
    const loginRes = await login("sales@commando.local");
    const token = loginRes.body.data.accessToken as string;
    const res = await request(app)
      .get(`/api/sync-evaluations/${syncEvalForSupport}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
