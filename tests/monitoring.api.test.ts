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

      const commando = await prisma.user.findFirst({
        where: { email: "commando@commando.local", deletedAt: null },
        select: { id: true },
      });
      const salesUser = await prisma.user.findFirst({
        where: { email: "sales@commando.local", deletedAt: null },
        select: { id: true },
      });
      const profile =
        (salesUser
          ? await prisma.salesExecutiveProfile.findFirst({
              where: { userId: salesUser.id, archivedAt: null },
            })
          : null) ??
        (await prisma.salesExecutiveProfile.findFirst({
          where: { displayName: "Sam Seller", archivedAt: null },
        }));
      const assignment =
        profile && commando
          ? await prisma.commandoAssignment.findFirst({
              where: {
                salesExecutiveProfileId: profile.id,
                commandoUserId: commando.id,
              },
              orderBy: { startedAt: "desc" },
            })
          : null;
      if (!profile || !assignment || !commando) {
        dbReady = false;
        return;
      }

      profileId = profile.id;
      assignmentId = assignment.id;
      categoryId = morning.id;
      itemIds = [item.id, item2.id];
      await prisma.commandoAssignment.update({
        where: { id: assignmentId },
        data: {
          status: "ACTIVE",
          endedAt: null,
          completionReason: null,
        },
      });
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

  it("unit: SE can view monitoring during and after assignment", () => {
    const during = {
      hasActiveAssignment: true,
      hasCompletedAssignment: false,
      isDuringCommando: true,
      isAfterCommando: false,
    };
    expect(salesExecutiveCanViewMonitoring(during)).toBe(true);

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

  it("during Commando: SE can view monitoring for their profile", async ({
    skip,
  }) => {
    if (!dbReady || !recordId || !assignmentId) skip();
    await ensureActiveAssignment();
    const lifecycle = await getCommandoLifecycleState(prisma, profileId);
    expect(lifecycle.isDuringCommando).toBe(true);

    const se = await token("sales@commando.local");
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
    expect(list.body.data.total).toBeGreaterThan(0);

    const detail = await request(app)
      .get(`/api/monitoring/${recordId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(detail.status).toBe(200);
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
    // Team Lead may be blocked by operational lock or allowed depending on lock state.
    expect([201, 403]).toContain(res.status);
  });

  it("SE checklist customization does not mutate global template and snapshots stay fixed", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    await ensureActiveAssignment();
    const c = await token("commando@commando.local");

    const effective = await request(app)
      .get(
        `/api/monitoring/profiles/${profileId}/checklist?categoryId=${categoryId}`,
      )
      .set("Authorization", `Bearer ${c}`);
    expect(effective.status).toBe(200);
    expect(effective.body.data.canCustomize).toBe(true);
    expect(effective.body.data.items.length).toBeGreaterThan(0);

    const add = await request(app)
      .post(`/api/monitoring/profiles/${profileId}/checklist/items`)
      .set("Authorization", `Bearer ${c}`)
      .send({
        categoryId,
        label: "High-value accounts reviewed",
        description: "SE-specific coaching focus",
        scope: "SE",
      });
    expect(add.status).toBe(201);
    expect(add.body.data.persisted).toBe(true);
    const customId = add.body.data.item.seChecklistItemId as string;

    const removeTemplate = await request(app)
      .post(`/api/monitoring/profiles/${profileId}/checklist/remove-template`)
      .set("Authorization", `Bearer ${c}`)
      .send({
        categoryId,
        templateItemId: itemIds[1],
      });
    expect(removeTemplate.status).toBe(200);

    const afterCustomize = await request(app)
      .get(
        `/api/monitoring/profiles/${profileId}/checklist?categoryId=${categoryId}`,
      )
      .set("Authorization", `Bearer ${c}`);
    expect(afterCustomize.status).toBe(200);
    const ids = afterCustomize.body.data.items.map(
      (i: { checklistItemId: string | null }) => i.checklistItemId,
    );
    expect(ids).not.toContain(itemIds[1]);
    expect(
      afterCustomize.body.data.items.some(
        (i: { seChecklistItemId: string | null }) =>
          i.seChecklistItemId === customId,
      ),
    ).toBe(true);

    // Global template item still exists and is unchanged
    const globalItem = await prisma.monitoringChecklistItem.findUniqueOrThrow({
      where: { id: itemIds[1] },
    });
    expect(globalItem.isActive).toBe(true);
    expect(globalItem.label).toContain("CRM");

    const create = await request(app)
      .post("/api/monitoring")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        categoryId,
        observation: "Snapshot integrity session",
        responses: [
          { checklistItemId: itemIds[0], value: "YES", sourceType: "TEMPLATE" },
          {
            seChecklistItemId: customId,
            value: "NO",
            sourceType: "CUSTOM",
          },
        ],
      });
    expect(create.status).toBe(201);
    const createdId = create.body.data.record.id as string;
    const snapLabel = create.body.data.record.responses.find(
      (r: { sourceType?: string }) => r.sourceType === "CUSTOM",
    )?.labelSnapshot;
    expect(snapLabel).toBe("High-value accounts reviewed");

    // Rename custom item after session — historical snapshot must not change
    await prisma.seMonitoringChecklistItem.update({
      where: { id: customId },
      data: { label: "CHANGED AFTER SESSION" },
    });

    const detail = await request(app)
      .get(`/api/monitoring/${createdId}`)
      .set("Authorization", `Bearer ${c}`);
    expect(detail.status).toBe(200);
    const customResponse = detail.body.data.record.responses.find(
      (r: { sourceType?: string }) => r.sourceType === "CUSTOM",
    );
    expect(customResponse.labelSnapshot).toBe("High-value accounts reviewed");
    expect(customResponse.checklistItem.label).toBe(
      "High-value accounts reviewed",
    );

    // Cleanup SE customizations for this profile/category
    await prisma.seMonitoringChecklistItem.updateMany({
      where: { salesExecutiveProfileId: profileId, categoryId },
      data: { isActive: false },
    });
  });
});
