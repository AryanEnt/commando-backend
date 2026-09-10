import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

describe("Phase 12 — Sales Support My Task", () => {
  let dbReady = false;
  let profileId: string;
  let supportUserId: string;
  let otherSupportUserId: string;
  let taskForSupport: string;
  let taskForOther: string;

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

      await prisma.salesSupportLink.deleteMany({
        where: {
          salesExecutiveProfileId: profileId,
          salesSupportUserId: otherSupportUserId,
        },
      });
      await prisma.salesSupportLink.create({
        data: {
          salesExecutiveProfileId: profileId,
          salesSupportUserId: otherSupportUserId,
          isActive: true,
        },
      });

      dbReady = true;
    } catch {
      dbReady = false;
    }
  }, 60_000);

  afterAll(async () => {
    if (!profileId || !otherSupportUserId) return;
    await prisma.salesSupportLink.updateMany({
      where: {
        salesExecutiveProfileId: profileId,
        salesSupportUserId: otherSupportUserId,
        isActive: true,
      },
      data: { isActive: false, endedAt: new Date() },
    });
  });

  it("commando creates task assigned to sales support", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const due = new Date();
    due.setUTCDate(due.getUTCDate() + 3);

    const res = await request(app)
      .post("/api/support-tasks")
      .set("Authorization", `Bearer ${c}`)
      .send({
        title: "P12 follow-up CRM hygiene",
        description: "Clean duplicate opportunities for Sam",
        salesExecutiveProfileId: profileId,
        salesSupportUserId: supportUserId,
        priority: "HIGH",
        dueDate: due.toISOString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.data.task.salesSupportUserId).toBe(supportUserId);
    expect(res.body.data.task.status).toBe("PENDING");
    expect(res.body.data.task.assignedById).toBeTruthy();
    expect(res.body.data.task.isOverdue).toBe(false);
    taskForSupport = res.body.data.task.id;
  });

  it("task appears for assigned sales support only", async ({ skip }) => {
    if (!dbReady || !taskForSupport) skip();
    const s = await token("support@commando.local");
    const list = await request(app)
      .get("/api/support-tasks")
      .query({ view: "active" })
      .set("Authorization", `Bearer ${s}`);
    expect(list.status).toBe(200);
    expect(
      list.body.data.tasks.some((t: { id: string }) => t.id === taskForSupport),
    ).toBe(true);

    const other = await token("support2@commando.local");
    const otherList = await request(app)
      .get("/api/support-tasks")
      .query({ view: "active" })
      .set("Authorization", `Bearer ${other}`);
    expect(otherList.status).toBe(200);
    expect(
      otherList.body.data.tasks.some(
        (t: { id: string }) => t.id === taskForSupport,
      ),
    ).toBe(false);
  });

  it("sales support cannot create Commando tasks", async ({ skip }) => {
    if (!dbReady) skip();
    const s = await token("support@commando.local");
    const res = await request(app)
      .post("/api/support-tasks")
      .set("Authorization", `Bearer ${s}`)
      .send({
        title: "Should fail",
        salesExecutiveProfileId: profileId,
        salesSupportUserId: supportUserId,
        priority: "LOW",
      });
    expect(res.status).toBe(403);
  });

  it("sales support can update status with explicit permission", async ({
    skip,
  }) => {
    if (!dbReady || !taskForSupport) skip();
    const s = await token("support@commando.local");
    const res = await request(app)
      .patch(`/api/support-tasks/${taskForSupport}/status`)
      .set("Authorization", `Bearer ${s}`)
      .send({ status: "IN_PROGRESS" });
    expect(res.status).toBe(200);
    expect(res.body.data.task.status).toBe("IN_PROGRESS");
  });

  it("sales support cannot PATCH task definition", async ({ skip }) => {
    if (!dbReady || !taskForSupport) skip();
    const s = await token("support@commando.local");
    const res = await request(app)
      .patch(`/api/support-tasks/${taskForSupport}`)
      .set("Authorization", `Bearer ${s}`)
      .send({ title: "Hacked title" });
    expect(res.status).toBe(403);
  });

  it("completed task remains in history", async ({ skip }) => {
    if (!dbReady || !taskForSupport) skip();
    const s = await token("support@commando.local");
    const done = await request(app)
      .patch(`/api/support-tasks/${taskForSupport}/status`)
      .set("Authorization", `Bearer ${s}`)
      .send({
        status: "COMPLETED",
        completionNotes: "CRM cleaned",
      });
    expect(done.status).toBe(200);
    expect(done.body.data.task.completedAt).toBeTruthy();

    const history = await request(app)
      .get("/api/support-tasks")
      .query({ view: "history" })
      .set("Authorization", `Bearer ${s}`);
    expect(history.status).toBe(200);
    expect(
      history.body.data.tasks.some(
        (t: { id: string }) => t.id === taskForSupport,
      ),
    ).toBe(true);

    const active = await request(app)
      .get("/api/support-tasks")
      .query({ view: "active" })
      .set("Authorization", `Bearer ${s}`);
    expect(
      active.body.data.tasks.some(
        (t: { id: string }) => t.id === taskForSupport,
      ),
    ).toBe(false);
  });

  it("overdue task is correctly identified", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const past = new Date();
    past.setUTCDate(past.getUTCDate() - 5);

    const res = await request(app)
      .post("/api/support-tasks")
      .set("Authorization", `Bearer ${c}`)
      .send({
        title: "P12 overdue task",
        salesExecutiveProfileId: profileId,
        salesSupportUserId: supportUserId,
        priority: "MEDIUM",
        dueDate: past.toISOString(),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.task.isOverdue).toBe(true);

    const s = await token("support@commando.local");
    const overdue = await request(app)
      .get("/api/support-tasks")
      .query({ filter: "overdue" })
      .set("Authorization", `Bearer ${s}`);
    expect(overdue.status).toBe(200);
    expect(
      overdue.body.data.tasks.some(
        (t: { id: string }) => t.id === res.body.data.task.id,
      ),
    ).toBe(true);
  });

  it("IDOR: support A cannot GET task for support B", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const created = await request(app)
      .post("/api/support-tasks")
      .set("Authorization", `Bearer ${c}`)
      .send({
        title: "P12 other support only",
        salesExecutiveProfileId: profileId,
        salesSupportUserId: otherSupportUserId,
        priority: "LOW",
      });
    expect(created.status).toBe(201);
    taskForOther = created.body.data.task.id;

    const s = await token("support@commando.local");
    const get = await request(app)
      .get(`/api/support-tasks/${taskForOther}`)
      .set("Authorization", `Bearer ${s}`);
    expect(get.status).toBe(403);

    const filterHack = await request(app)
      .get("/api/support-tasks")
      .query({
        view: "all",
        salesSupportUserId: otherSupportUserId,
      })
      .set("Authorization", `Bearer ${s}`);
    expect(filterHack.status).toBe(200);
    expect(filterHack.body.data.total).toBe(0);
    expect(
      filterHack.body.data.tasks.some(
        (t: { id: string }) => t.id === taskForOther,
      ),
    ).toBe(false);
  });

  it("old tasks remain after new tasks are created", async ({ skip }) => {
    if (!dbReady || !taskForSupport) skip();
    const s = await token("support@commando.local");
    const all = await request(app)
      .get("/api/support-tasks")
      .query({ view: "all", pageSize: 100 })
      .set("Authorization", `Bearer ${s}`);
    expect(all.status).toBe(200);
    expect(
      all.body.data.tasks.some((t: { id: string }) => t.id === taskForSupport),
    ).toBe(true);
  });

  it("related SE scope: cannot create for out-of-assignment profile", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const otherProfile = await prisma.salesExecutiveProfile.findFirst({
      where: { displayName: "Other Seller" },
    });
    if (!otherProfile) skip();

    const c = await token("commando@commando.local");
    const res = await request(app)
      .post("/api/support-tasks")
      .set("Authorization", `Bearer ${c}`)
      .send({
        title: "Out of scope",
        salesExecutiveProfileId: otherProfile!.id,
        salesSupportUserId: supportUserId,
        priority: "LOW",
      });
    expect([403, 400]).toContain(res.status);
  });
});
