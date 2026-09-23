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

describe("weekly reviews", () => {
  let dbReady = false;
  let profileId: string;
  let submittedId: string;

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

  it("commando creates a weekly review already submitted", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .post("/api/weekly-reviews")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        weekLabel: `2026-W-TEST-${Date.now()}`,
        weekStartDate: "2026-03-02",
        meetingDate: "2026-03-06T10:00:00.000Z",
        performanceSummary: "Steady pipeline progress this week.",
        whatWentWell: "Strong discovery calls.",
        improvement: "Need tighter follow-up cadence.",
        nextWeekAction: "Book three strategic account reviews.",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.review.status).toBe("SUBMITTED");
    expect(res.body.data.review.isEditable).toBe(false);
    expect(res.body.data.review.submittedAt).toBeTruthy();
    expect(res.body.data.review.attendees.length).toBeGreaterThanOrEqual(3);
    submittedId = res.body.data.review.id;

    const createdAudit = await prisma.auditLog.findFirst({
      where: {
        entityId: submittedId,
        action: "WEEKLY_REVIEW_CREATED",
      },
    });
    expect(createdAudit).toBeTruthy();

    const submittedAudit = await prisma.auditLog.findFirst({
      where: {
        entityId: submittedId,
        action: "WEEKLY_REVIEW_SUBMITTED",
      },
    });
    expect(submittedAudit).toBeTruthy();

    const edit = await request(app)
      .patch(`/api/weekly-reviews/${submittedId}`)
      .set("Authorization", `Bearer ${c}`)
      .send({ improvement: "Should not overwrite history" });
    expect(edit.status).toBe(400);
  });

  it("team lead can view submitted review read-only", async ({ skip }) => {
    if (!dbReady || !submittedId) skip();
    const tl = await token("teamlead@commando.local");
    const res = await request(app)
      .get(`/api/weekly-reviews/${submittedId}`)
      .set("Authorization", `Bearer ${tl}`);
    expect(res.status).toBe(200);
    expect(res.body.data.review.status).toBe("SUBMITTED");

    const list = await request(app)
      .get("/api/weekly-reviews")
      .set("Authorization", `Bearer ${tl}`);
    expect(list.status).toBe(200);
    expect(
      list.body.data.reviews.every(
        (r: { status: string }) => r.status === "SUBMITTED",
      ),
    ).toBe(true);
  });

  it("sales executive can view and acknowledge own submitted review", async ({
    skip,
  }) => {
    if (!dbReady || !submittedId) skip();
    const se = await token("sales@commando.local");
    const view = await request(app)
      .get(`/api/weekly-reviews/${submittedId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(view.status).toBe(200);
    expect(view.body.data.review.signed).toBe(false);
    expect(view.body.data.review.myStatus).toBe("PENDING_SIGNATURE");

    const ack = await request(app)
      .post(`/api/weekly-reviews/${submittedId}/acknowledge`)
      .set("Authorization", `Bearer ${se}`);
    expect(ack.status).toBe(200);
    expect(ack.body.data.review.signed).toBe(true);
    expect(ack.body.data.review.myStatus).toBe("SIGNED");

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityId: submittedId,
        action: "WEEKLY_REVIEW_ACKNOWLEDGED",
      },
    });
    expect(audit).toBeTruthy();

    const again = await request(app)
      .post(`/api/weekly-reviews/${submittedId}/acknowledge`)
      .set("Authorization", `Bearer ${se}`);
    expect(again.status).toBe(400);
  });

  it("never overwrites historical reviews — new week is a new record", async ({
    skip,
  }) => {
    if (!dbReady || !submittedId) skip();
    const c = await token("commando@commando.local");
    const original = await prisma.weeklyReview.findUniqueOrThrow({
      where: { id: submittedId },
    });

    const next = await request(app)
      .post("/api/weekly-reviews")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        weekLabel: `2026-W-NEXT-${Date.now()}`,
        weekStartDate: "2026-03-09",
        meetingDate: "2026-03-13T10:00:00.000Z",
        performanceSummary: "Next week notes.",
        whatWentWell: "Momentum.",
        improvement: "Pipeline hygiene.",
        nextWeekAction: "Close one deal.",
      });
    expect(next.status).toBe(201);
    expect(next.body.data.review.id).not.toBe(submittedId);
    expect(next.body.data.review.status).toBe("SUBMITTED");

    const stillThere = await prisma.weeklyReview.findUniqueOrThrow({
      where: { id: submittedId },
    });
    expect(stillThere.performanceSummary).toBe(original.performanceSummary);
  });
});

describe("SSE weekly reviews", () => {
  let dbReady = false;
  let supportUserId: string;

  beforeAll(async () => {
    try {
      await prisma.$connect();
      const support = await prisma.user.findUnique({
        where: { email: "support@commando.local" },
      });
      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { displayName: "Sam Seller" },
      });
      if (!support || !profile) {
        dbReady = false;
        return;
      }
      supportUserId = support.id;
      const existingMembership = await prisma.teamMembership.findFirst({
        where: { teamId: profile.teamId, userId: support.id },
      });
      if (existingMembership) {
        await prisma.teamMembership.update({
          where: { id: existingMembership.id },
          data: { isActive: true, endedAt: null },
        });
      } else {
        await prisma.teamMembership.create({
          data: {
            teamId: profile.teamId,
            userId: support.id,
            roleInTeam: "SALES_SUPPORT_EXECUTIVE",
            isActive: true,
          },
        });
      }
      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  it("TL can create a weekly review for an in-scope SSE", async ({ skip }) => {
    if (!dbReady) skip();
    const tl = await token("teamlead@commando.local");
    const weekStart = `2026-04-${String(6 + (Date.now() % 20)).padStart(2, "0")}`;
    const res = await request(app)
      .post("/api/weekly-reviews")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        executiveUserId: supportUserId,
        weekLabel: `SSE-WR-${Date.now()}`,
        weekStartDate: weekStart,
        meetingDate: "2026-04-10T10:00:00.000Z",
        roomName: "Support room",
        meetingTime: "10:00",
        performanceSummary: "Support coverage was steady.",
        whatWentWell: "Fast task turnaround.",
        improvement: "Tighter SE updates.",
        nextWeekActions: ["Sync with assigned SE daily"],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.review.executiveUserId).toBe(supportUserId);
    expect(res.body.data.review.salesExecutiveProfileId).toBeNull();
    expect(res.body.data.review.subject.type).toBe("SALES_SUPPORT_EXECUTIVE");
    expect(res.body.data.review.status).toBe("SUBMITTED");

    const list = await request(app)
      .get(`/api/weekly-reviews?executiveUserId=${supportUserId}`)
      .set("Authorization", `Bearer ${tl}`);
    expect(list.status).toBe(200);
    expect(
      list.body.data.reviews.some((r: { id: string }) => r.id === res.body.data.review.id),
    ).toBe(true);

    const sse = await token("support@commando.local");
    const view = await request(app)
      .get(`/api/weekly-reviews/${res.body.data.review.id}`)
      .set("Authorization", `Bearer ${sse}`);
    expect(view.status).toBe(200);
  });
});
