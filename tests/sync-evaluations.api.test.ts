import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/password.js";

const app = createApp();
const PASSWORD = "Password123!";

async function token(email: string) {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password: PASSWORD });
  return res.body.data.accessToken as string;
}

describe("sync evaluations authorization", () => {
  let dbReady = false;
  let profileId: string;
  let supportUserId: string;
  let otherSupportUserId: string;
  let evalId: string;
  let unrelatedEvalId: string;

  beforeAll(async () => {
    try {
      await prisma.$connect();
      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { displayName: "Sam Seller" },
      });
      const support = await prisma.user.findUnique({
        where: { email: "support@commando.local" },
      });
      if (!profile || !support) {
        dbReady = false;
        return;
      }
      profileId = profile.id;
      supportUserId = support.id;

      const supportRole = await prisma.role.findUniqueOrThrow({
        where: { code: "SALES_SUPPORT_EXECUTIVE" },
      });
      const otherSupport = await prisma.user.upsert({
        where: { email: "support2@commando.local" },
        update: {
          isActive: true,
          deletedAt: null,
          roleId: supportRole.id,
          passwordHash: await hashPassword(PASSWORD),
        },
        create: {
          email: "support2@commando.local",
          firstName: "Other",
          lastName: "Support",
          roleId: supportRole.id,
          passwordHash: await hashPassword(PASSWORD),
        },
      });
      otherSupportUserId = otherSupport.id;

      // Unrelated historical eval (different support) — must stay invisible to support@
      const unrelated = await prisma.syncEvaluation.create({
        data: {
          salesExecutiveProfileId: profileId,
          salesSupportUserId: otherSupportUserId,
          issue: "Unrelated support sync issue",
          recommendedAction: "Should not be visible to primary support",
          createdById: (
            await prisma.user.findUniqueOrThrow({
              where: { email: "commando@commando.local" },
            })
          ).id,
        },
      });
      unrelatedEvalId = unrelated.id;

      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  it("commando creates sync eval linked to active SE↔SSE relationship", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");

    const links = await request(app)
      .get(`/api/sync-evaluations/options/support-links?profileId=${profileId}`)
      .set("Authorization", `Bearer ${c}`);
    expect(links.status).toBe(200);
    expect(links.body.data.links.length).toBeGreaterThan(0);
    expect(
      links.body.data.links.some(
        (l: { salesSupportUserId: string }) =>
          l.salesSupportUserId === supportUserId,
      ),
    ).toBe(true);

    const res = await request(app)
      .post("/api/sync-evaluations")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        salesSupportUserId: supportUserId,
        issue: "CRM handoff notes incomplete after demos",
        recommendedAction: "Align on shared update checklist within 48h",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.evaluation.salesSupportUserId).toBe(supportUserId);
    expect(res.body.data.evaluation.assignmentId).toBeTruthy();
    expect(res.body.data.evaluation.salesSupportLinkId).toBeTruthy();
    expect(res.body.data.evaluation.commando).toBeTruthy();
    expect(res.body.data.evaluation.teamLead).toBeTruthy();
    evalId = res.body.data.evaluation.id;

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: evalId, action: "SYNC_EVAL_CREATED" },
    });
    expect(audit).toBeTruthy();
  });

  it("second create is a new historical record", async ({ skip }) => {
    if (!dbReady || !evalId) skip();
    const c = await token("commando@commando.local");
    const original = await prisma.syncEvaluation.findUniqueOrThrow({
      where: { id: evalId },
    });

    const res = await request(app)
      .post("/api/sync-evaluations")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        salesSupportUserId: supportUserId,
        issue: "Follow-up sync evaluation",
        recommendedAction: "Weekly cadence check-in",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.evaluation.id).not.toBe(evalId);

    const still = await prisma.syncEvaluation.findUniqueOrThrow({
      where: { id: evalId },
    });
    expect(still.issue).toBe(original.issue);
  });

  it("relevant sales support can list and view own evaluations only", async ({
    skip,
  }) => {
    if (!dbReady || !evalId || !unrelatedEvalId) skip();
    const support = await token("support@commando.local");

    const list = await request(app)
      .get("/api/sync-evaluations")
      .set("Authorization", `Bearer ${support}`);
    expect(list.status).toBe(200);
    expect(
      list.body.data.evaluations.every(
        (e: { salesSupportUserId: string }) =>
          e.salesSupportUserId === supportUserId,
      ),
    ).toBe(true);
    expect(
      list.body.data.evaluations.some((e: { id: string }) => e.id === evalId),
    ).toBe(true);
    expect(
      list.body.data.evaluations.some(
        (e: { id: string }) => e.id === unrelatedEvalId,
      ),
    ).toBe(false);

    const detail = await request(app)
      .get(`/api/sync-evaluations/${evalId}`)
      .set("Authorization", `Bearer ${support}`);
    expect(detail.status).toBe(200);

    const forbidden = await request(app)
      .get(`/api/sync-evaluations/${unrelatedEvalId}`)
      .set("Authorization", `Bearer ${support}`);
    expect(forbidden.status).toBe(403);
  });

  it("relevant team lead can view evaluations for their team", async ({
    skip,
  }) => {
    if (!dbReady || !evalId) skip();
    const tl = await token("teamlead@commando.local");
    const list = await request(app)
      .get(`/api/sync-evaluations?profileId=${profileId}&search=CRM`)
      .set("Authorization", `Bearer ${tl}`);
    expect(list.status).toBe(200);
    expect(list.body.data.total).toBeGreaterThan(0);

    const detail = await request(app)
      .get(`/api/sync-evaluations/${evalId}`)
      .set("Authorization", `Bearer ${tl}`);
    expect(detail.status).toBe(200);
  });

  it("team lead cannot create sync evaluations", async ({ skip }) => {
    if (!dbReady) skip();
    const tl = await token("teamlead@commando.local");
    const res = await request(app)
      .post("/api/sync-evaluations")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        salesSupportUserId: supportUserId,
        issue: "Nope",
        recommendedAction: "Nope",
      });
    expect(res.status).toBe(403);
  });

  it("sales executive cannot view sync evaluations", async ({ skip }) => {
    if (!dbReady || !evalId) skip();
    const se = await token("sales@commando.local");
    const list = await request(app)
      .get("/api/sync-evaluations")
      .set("Authorization", `Bearer ${se}`);
    expect(list.status).toBe(403);

    const detail = await request(app)
      .get(`/api/sync-evaluations/${evalId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(detail.status).toBe(403);
  });

  it("rejects create without an active SE↔SSE link", async ({ skip }) => {
    if (!dbReady) skip();
    await prisma.salesSupportLink.updateMany({
      where: {
        salesExecutiveProfileId: profileId,
        salesSupportUserId: otherSupportUserId,
        isActive: true,
      },
      data: { isActive: false, endedAt: new Date() },
    });
    const c = await token("commando@commando.local");
    const res = await request(app)
      .post("/api/sync-evaluations")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        salesSupportUserId: otherSupportUserId,
        issue: "No link exists",
        recommendedAction: "Should fail",
      });
    expect(res.status).toBe(400);
  });

  it("supports pagination", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .get("/api/sync-evaluations?page=1&pageSize=1")
      .set("Authorization", `Bearer ${c}`);
    expect(res.status).toBe(200);
    expect(res.body.data.pageSize).toBe(1);
    expect(res.body.data.evaluations.length).toBeLessThanOrEqual(1);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
  });
});
