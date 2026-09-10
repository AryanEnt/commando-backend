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
  let reviewId: string;
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

  it("commando creates a draft weekly review", async ({ skip }) => {
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
    expect(res.body.data.review.status).toBe("DRAFT");
    expect(res.body.data.review.isEditable).toBe(true);
    expect(res.body.data.review.attendees.length).toBeGreaterThanOrEqual(3);
    reviewId = res.body.data.review.id;

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityId: reviewId,
        action: "WEEKLY_REVIEW_CREATED",
      },
    });
    expect(audit).toBeTruthy();
  });

  it("commando can edit draft before submission", async ({ skip }) => {
    if (!dbReady || !reviewId) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .patch(`/api/weekly-reviews/${reviewId}`)
      .set("Authorization", `Bearer ${c}`)
      .send({
        nextWeekAction: "Updated: close two mid-funnel deals.",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.review.nextWeekAction).toContain("Updated:");
  });

  it("team lead cannot see draft reviews", async ({ skip }) => {
    if (!dbReady || !reviewId) skip();
    const tl = await token("teamlead@commando.local");
    const res = await request(app)
      .get(`/api/weekly-reviews/${reviewId}`)
      .set("Authorization", `Bearer ${tl}`);
    expect(res.status).toBe(403);
  });

  it("sales executive cannot see draft reviews", async ({ skip }) => {
    if (!dbReady || !reviewId) skip();
    const se = await token("sales@commando.local");
    const res = await request(app)
      .get(`/api/weekly-reviews/${reviewId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(res.status).toBe(403);
  });

  it("commando submits review and it becomes read-only", async ({ skip }) => {
    if (!dbReady || !reviewId) skip();
    const c = await token("commando@commando.local");
    const submit = await request(app)
      .post(`/api/weekly-reviews/${reviewId}/submit`)
      .set("Authorization", `Bearer ${c}`);
    expect(submit.status).toBe(200);
    expect(submit.body.data.review.status).toBe("SUBMITTED");
    expect(submit.body.data.review.isEditable).toBe(false);
    expect(submit.body.data.review.submittedAt).toBeTruthy();
    submittedId = reviewId;

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityId: submittedId,
        action: "WEEKLY_REVIEW_SUBMITTED",
      },
    });
    expect(audit).toBeTruthy();

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
        performanceSummary: "Next week notes",
        whatWentWell: "Continued momentum",
        improvement: "Forecast accuracy",
        nextWeekAction: "Prepare QBR deck",
      });
    expect(next.status).toBe(201);
    expect(next.body.data.review.id).not.toBe(submittedId);

    const still = await prisma.weeklyReview.findUniqueOrThrow({
      where: { id: submittedId },
    });
    expect(still.performanceSummary).toBe(original.performanceSummary);
    expect(still.status).toBe("SUBMITTED");
  });

  it("team lead cannot create or submit", async ({ skip }) => {
    if (!dbReady) skip();
    const tl = await token("teamlead@commando.local");
    const create = await request(app)
      .post("/api/weekly-reviews")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        weekLabel: "nope",
        weekStartDate: "2026-03-02",
        meetingDate: "2026-03-06T10:00:00.000Z",
        performanceSummary: "x",
        whatWentWell: "x",
        improvement: "x",
        nextWeekAction: "x",
      });
    expect(create.status).toBe(403);
  });
});
