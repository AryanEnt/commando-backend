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

describe("eisenhower matrix", () => {
  let dbReady = false;
  let profileId: string;
  let taskId: string;
  let priorMonthTaskId: string;

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

  it("commando creates tasks in four categories for a month", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const month = "2026-03";

    for (const category of [
      "DO_FIRST",
      "SCHEDULE",
      "DELEGATE",
      "ELIMINATE",
    ] as const) {
      const res = await request(app)
        .post("/api/eisenhower")
        .set("Authorization", `Bearer ${c}`)
        .send({
          salesExecutiveProfileId: profileId,
          month,
          category,
          title: `${category} task for March`,
          notes: `Notes for ${category}`,
          dueDate: "2026-03-15T12:00:00.000Z",
        });
      expect(res.status).toBe(201);
      expect(res.body.data.task.category).toBe(category);
      expect(res.body.data.task.monthLabel).toBe("2026-03");
      expect(res.body.data.task.assignmentId).toBeTruthy();
      if (category === "DO_FIRST") taskId = res.body.data.task.id;
    }

    const matrix = await request(app)
      .get(`/api/eisenhower/matrix?profileId=${profileId}&month=${month}`)
      .set("Authorization", `Bearer ${c}`);
    expect(matrix.status).toBe(200);
    expect(matrix.body.data.byCategory.DO_FIRST.length).toBeGreaterThan(0);
    expect(matrix.body.data.byCategory.SCHEDULE.length).toBeGreaterThan(0);
    expect(matrix.body.data.byCategory.DELEGATE.length).toBeGreaterThan(0);
    expect(matrix.body.data.byCategory.ELIMINATE.length).toBeGreaterThan(0);
  });

  it("commando can edit and update status", async ({ skip }) => {
    if (!dbReady || !taskId) skip();
    const c = await token("commando@commando.local");

    const edit = await request(app)
      .patch(`/api/eisenhower/${taskId}`)
      .set("Authorization", `Bearer ${c}`)
      .send({ title: "Updated DO_FIRST title", notes: "Revised notes" });
    expect(edit.status).toBe(200);
    expect(edit.body.data.task.title).toBe("Updated DO_FIRST title");

    const status = await request(app)
      .post(`/api/eisenhower/${taskId}/status`)
      .set("Authorization", `Bearer ${c}`)
      .send({ status: "DONE" });
    expect(status.status).toBe(200);
    expect(status.body.data.task.status).toBe("DONE");
  });

  it("previous months remain as history and are not overwritten", async ({
    skip,
  }) => {
    if (!dbReady || !taskId) skip();
    const c = await token("commando@commando.local");
    const original = await prisma.eisenhowerTask.findUniqueOrThrow({
      where: { id: taskId },
    });

    const prior = await request(app)
      .post("/api/eisenhower")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        month: "2026-02",
        category: "SCHEDULE",
        title: "February history task",
        notes: "Must remain intact",
      });
    expect(prior.status).toBe(201);
    priorMonthTaskId = prior.body.data.task.id;
    expect(prior.body.data.task.isHistory).toBe(true);

    const still = await prisma.eisenhowerTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    expect(still.title).toBe(original.title);
    expect(still.status).toBe("DONE");

    const moveHistory = await request(app)
      .patch(`/api/eisenhower/${priorMonthTaskId}`)
      .set("Authorization", `Bearer ${c}`)
      .send({ month: "2026-04" });
    expect(moveHistory.status).toBe(400);
  });

  it("filters by profile, month, category, status", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .get(
        `/api/eisenhower?profileId=${profileId}&month=2026-03&category=DO_FIRST&status=DONE`,
      )
      .set("Authorization", `Bearer ${c}`);
    expect(res.status).toBe(200);
    expect(res.body.data.tasks.length).toBeGreaterThan(0);
    expect(
      res.body.data.tasks.every(
        (t: {
          salesExecutiveProfileId: string;
          monthLabel: string;
          category: string;
          status: string;
        }) =>
          t.salesExecutiveProfileId === profileId &&
          t.monthLabel === "2026-03" &&
          t.category === "DO_FIRST" &&
          t.status === "DONE",
      ),
    ).toBe(true);
  });

  it("sales executive is read-only and never receives active Commando tasks", async ({
    skip,
  }) => {
    if (!dbReady || !taskId) skip();
    const se = await token("sales@commando.local");

    const list = await request(app)
      .get(`/api/eisenhower?profileId=${profileId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(list.status).toBe(200);
    // Active Commando-owned tasks must not be returned to the SE
    expect(
      list.body.data.tasks.some((t: { id: string }) => t.id === taskId),
    ).toBe(false);
    expect(
      list.body.data.tasks.every(
        (t: {
          assignmentId: string | null;
          assignment: { status: string } | null;
        }) =>
          t.assignmentId == null ||
          t.assignment?.status === "COMPLETED" ||
          t.assignment?.status === "EXITED",
      ),
    ).toBe(true);

    const create = await request(app)
      .post("/api/eisenhower")
      .set("Authorization", `Bearer ${se}`)
      .send({
        salesExecutiveProfileId: profileId,
        month: "2026-03",
        category: "DO_FIRST",
        title: "SE should not create",
      });
    expect(create.status).toBe(403);

    const edit = await request(app)
      .patch(`/api/eisenhower/${taskId}`)
      .set("Authorization", `Bearer ${se}`)
      .send({ title: "Nope" });
    expect(edit.status).toBe(403);

    const status = await request(app)
      .post(`/api/eisenhower/${taskId}/status`)
      .set("Authorization", `Bearer ${se}`)
      .send({ status: "OPEN" });
    expect(status.status).toBe(403);
  });

  it("active Commando Eisenhower tasks hidden from SE", async ({
    skip,
  }) => {
    if (!dbReady || !priorMonthTaskId) skip();
    const c = await token("commando@commando.local");
    await request(app)
      .post(`/api/eisenhower/${priorMonthTaskId}/status`)
      .set("Authorization", `Bearer ${c}`)
      .send({ status: "DONE" });

    const detail = await request(app)
      .get(`/api/eisenhower/${priorMonthTaskId}`)
      .set("Authorization", `Bearer ${c}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.task.status).toBe("DONE");
    expect(detail.body.data.task.monthLabel).toBe("2026-02");

    const se = await token("sales@commando.local");
    const seView = await request(app)
      .get(`/api/eisenhower/${priorMonthTaskId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(seView.status).toBe(403);

    const workspace = await request(app)
      .get(`/api/eisenhower/workspace?profileId=${profileId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(workspace.status).toBe(200);
    expect(workspace.body.data.commando.state).toBe("LOCKED");
    expect(workspace.body.data.commando.tasks).toBeNull();
    expect(workspace.body.data.teamLead.availability).toBe("AVAILABLE");
  });
});
