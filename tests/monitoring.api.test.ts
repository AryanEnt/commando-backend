import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import {
  getCommandoLifecycleState,
  salesExecutiveCanViewMonitoring,
} from "../src/lib/lifecycleVisibility.js";

const app = createApp();
const PASSWORD = "Password123!";

async function token(email: string) {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password: PASSWORD });
  return res.body.data.accessToken as string;
}

describe("live monitoring", () => {
  let dbReady = false;
  let profileId: string;
  let assignmentId: string;
  let categoryId: string;
  let itemIds: string[] = [];
  let recordId: string;
  let secondRecordId: string;

  beforeAll(async () => {
    try {
      await prisma.$connect();

      // Ensure categories exist even if seed was not re-run
      const morning = await prisma.monitoringCategory.upsert({
        where: { code: "MORNING_ROUTINE" },
        update: { isActive: true, archivedAt: null, name: "Morning Routine" },
        create: {
          code: "MORNING_ROUTINE",
          name: "Morning Routine",
          description: "Start-of-day preparation",
          sortOrder: 1,
        },
      });
      const item = await prisma.monitoringChecklistItem.upsert({
        where: {
          categoryId_code: {
            categoryId: morning.id,
            code: "PLAN_REVIEWED",
          },
        },
        update: { isActive: true, archivedAt: null },
        create: {
          categoryId: morning.id,
          code: "PLAN_REVIEWED",
          label: "Daily plan reviewed before first customer touch",
          sortOrder: 1,
        },
      });
      const item2 = await prisma.monitoringChecklistItem.upsert({
        where: {
          categoryId_code: {
            categoryId: morning.id,
            code: "CRM_UPDATED",
          },
        },
        update: { isActive: true, archivedAt: null },
        create: {
          categoryId: morning.id,
          code: "CRM_UPDATED",
          label: "CRM / pipeline updated from prior day",
          sortOrder: 2,
        },
      });

      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { displayName: "Sam Seller" },
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
      assignmentId = assignment.id;
      categoryId = morning.id;
      itemIds = [item.id, item2.id];
      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  async function ensureActiveAssignment() {
    await prisma.commandoAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "ACTIVE",
        endedAt: null,
        completionReason: null,
      },
    });
  }

  it("unit: SE cannot view monitoring during active assignment", () => {
    const during = {
      hasActiveAssignment: true,
      hasCompletedAssignment: false,
      isDuringCommando: true,
      isAfterCommando: false,
    };
    expect(salesExecutiveCanViewMonitoring(during)).toBe(false);

    const after = {
      hasActiveAssignment: false,
      hasCompletedAssignment: true,
      isDuringCommando: false,
      isAfterCommando: true,
    };
    expect(salesExecutiveCanViewMonitoring(after)).toBe(true);
  });

  it("lists configurable monitoring categories with checklist items", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .get("/api/monitoring/categories")
      .set("Authorization", `Bearer ${c}`);
    expect(res.status).toBe(200);
    expect(res.body.data.categories.length).toBeGreaterThan(0);
    const morning = res.body.data.categories.find(
      (cat: { code: string }) => cat.code === "MORNING_ROUTINE",
    );
    expect(morning).toBeTruthy();
    expect(morning.checklistItems.length).toBeGreaterThan(0);
  });

  it("admin can manage checklist categories and items", async ({ skip }) => {
    if (!dbReady) skip();
    const admin = await token("admin@commando.local");
    const code = `TEST_CAT_${Date.now()}`;
    const create = await request(app)
      .post("/api/monitoring/categories")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        code,
        name: "Test Category",
        description: "Configurable via API",
        sortOrder: 99,
      });
    expect(create.status).toBe(201);

    const item = await request(app)
      .post(`/api/monitoring/categories/${create.body.data.category.id}/items`)
      .set("Authorization", `Bearer ${admin}`)
      .send({
        code: "TEST_ITEM",
        label: "Test checklist item",
      });
    expect(item.status).toBe(201);
  });

  it("commando cannot manage checklist configuration", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .post("/api/monitoring/categories")
      .set("Authorization", `Bearer ${c}`)
      .send({
        code: "UNAUTHORIZED_CAT",
        name: "Nope",
      });
    expect(res.status).toBe(403);
  });

  it("commando creates a historical monitoring session", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .post("/api/monitoring")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        categoryId,
        observation: "Strong morning start; CRM still lagging.",
        responses: [
          { checklistItemId: itemIds[0], value: "YES" },
          { checklistItemId: itemIds[1], value: "NO" },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.record.assignmentId).toBeTruthy();
    expect(res.body.data.record.category.code).toBe("MORNING_ROUTINE");
    expect(res.body.data.record.responses).toHaveLength(2);
    recordId = res.body.data.record.id;

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityId: recordId,
        action: "MONITORING_RECORD_CREATED",
      },
    });
    expect(audit).toBeTruthy();
  });

  it("second session creates a new historical record (no overwrite)", async ({
    skip,
  }) => {
    if (!dbReady || !recordId) skip();
    const c = await token("commando@commando.local");
    const original = await prisma.liveMonitoringRecord.findUniqueOrThrow({
      where: { id: recordId },
    });

    const res = await request(app)
      .post("/api/monitoring")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        categoryId,
        observation: "Follow-up session later same day.",
        observedAt: "2026-03-08T15:00:00.000Z",
        responses: [
          { checklistItemId: itemIds[0], value: "YES" },
          { checklistItemId: itemIds[1], value: "YES" },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.record.id).not.toBe(recordId);
    secondRecordId = res.body.data.record.id;

    const still = await prisma.liveMonitoringRecord.findUniqueOrThrow({
      where: { id: recordId },
    });
    expect(still.observation).toBe(original.observation);
  });

  it("supports history list with profile and date filtering", async ({
    skip,
  }) => {
    if (!dbReady || !secondRecordId) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .get(
        `/api/monitoring?profileId=${profileId}&categoryId=${categoryId}&dateFrom=2026-03-01&dateTo=2026-03-31T23:59:59.000Z`,
      )
      .set("Authorization", `Bearer ${c}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    expect(
      res.body.data.records.every(
        (r: { salesExecutiveProfileId: string; categoryId: string }) =>
          r.salesExecutiveProfileId === profileId &&
          r.categoryId === categoryId,
      ),
    ).toBe(true);

    const detail = await request(app)
      .get(`/api/monitoring/${secondRecordId}`)
      .set("Authorization", `Bearer ${c}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.record.observation).toContain("Follow-up");
  });

  it("during Commando: SE cannot view monitoring even by id", async ({
    skip,
  }) => {
    if (!dbReady || !recordId || !assignmentId) skip();
    await ensureActiveAssignment();
    const lifecycle = await getCommandoLifecycleState(prisma, profileId);
    expect(lifecycle.isDuringCommando).toBe(true);

    const se = await token("sales@commando.local");
    // Ensure SE has MONITORING_VIEW (permission map); if seed not re-run, skip soft
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${se}`);
    if (!me.body.data.user.permissions.includes("MONITORING_VIEW")) {
      skip();
    }

    const list = await request(app)
      .get("/api/monitoring")
      .set("Authorization", `Bearer ${se}`);
    expect(list.status).toBe(200);
    expect(list.body.data.total).toBe(0);

    const detail = await request(app)
      .get(`/api/monitoring/${recordId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(detail.status).toBe(403);
  });

  it("after Commando: SE can view own monitoring history", async ({ skip }) => {
    if (!dbReady || !recordId || !assignmentId) skip();

    const se = await token("sales@commando.local");
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${se}`);
    if (!me.body.data.user.permissions.includes("MONITORING_VIEW")) {
      skip();
    }

    await ensureActiveAssignment();
    await prisma.commandoAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "COMPLETED",
        endedAt: new Date(),
        completionReason: "Phase 9 visibility test",
      },
    });

    try {
      const lifecycle = await getCommandoLifecycleState(prisma, profileId);
      expect(lifecycle.isAfterCommando).toBe(true);

      const list = await request(app)
        .get(`/api/monitoring?profileId=${profileId}`)
        .set("Authorization", `Bearer ${se}`);
      expect(list.status).toBe(200);
      expect(list.body.data.total).toBeGreaterThan(0);

      const detail = await request(app)
        .get(`/api/monitoring/${recordId}`)
        .set("Authorization", `Bearer ${se}`);
      expect(detail.status).toBe(200);
    } finally {
      await ensureActiveAssignment();
    }
  });

  it("team lead cannot create monitoring records", async ({ skip }) => {
    if (!dbReady) skip();
    const tl = await token("teamlead@commando.local");
    const res = await request(app)
      .post("/api/monitoring")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        categoryId,
        responses: [{ checklistItemId: itemIds[0], value: "YES" }],
      });
    expect(res.status).toBe(403);
  });
});
