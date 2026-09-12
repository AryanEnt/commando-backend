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

describe("sales support links", () => {
  let dbReady = false;
  let profileId: string;
  let supportUserId: string;
  let assignSupportUserId: string;
  let outsideProfileId: string;
  let categoryId: string;
  let itemId: string;
  let pausedAssignmentId: string | null = null;
  let assignedLinkId: string;
  let monitoringRecordId: string;
  let supportDisplayName: string;

  beforeAll(async () => {
    try {
      await prisma.$connect();

      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { displayName: "Sam Seller", archivedAt: null },
      });
      const support = await prisma.user.findUnique({
        where: { email: "support@commando.local" },
      });
      const alpha = await prisma.team.findFirst({
        where: { name: "Alpha Sales Team" },
      });
      if (!profile || !support || !alpha) {
        dbReady = false;
        return;
      }
      profileId = profile.id;
      supportUserId = support.id;
      supportDisplayName = `${support.firstName} ${support.lastName}`.trim();

      const supportRole = await prisma.role.findUniqueOrThrow({
        where: { code: "SALES_SUPPORT_EXECUTIVE" },
      });
      const seRole = await prisma.role.findUniqueOrThrow({
        where: { code: "SALES_EXECUTIVE" },
      });

      const assignSupport = await prisma.user.upsert({
        where: { email: "support-assign@commando.local" },
        update: {
          isActive: true,
          deletedAt: null,
          roleId: supportRole.id,
          passwordHash: await hashPassword(PASSWORD),
          firstName: "Assign",
          lastName: "Support",
        },
        create: {
          email: "support-assign@commando.local",
          firstName: "Assign",
          lastName: "Support",
          roleId: supportRole.id,
          passwordHash: await hashPassword(PASSWORD),
        },
      });
      assignSupportUserId = assignSupport.id;

      await prisma.salesSupportLink.deleteMany({
        where: {
          salesExecutiveProfileId: profileId,
          salesSupportUserId: assignSupportUserId,
        },
      });

      const beta = await prisma.team.upsert({
        where: { id: "seed-team-beta" },
        update: { name: "Beta Sales Team", archivedAt: null },
        create: {
          id: "seed-team-beta",
          name: "Beta Sales Team",
          description: "Outside-team fixture",
        },
      });

      const outsideSe = await prisma.user.upsert({
        where: { email: "sales-outside@commando.local" },
        update: {
          isActive: true,
          deletedAt: null,
          roleId: seRole.id,
          passwordHash: await hashPassword(PASSWORD),
        },
        create: {
          email: "sales-outside@commando.local",
          firstName: "Outside",
          lastName: "Seller",
          roleId: seRole.id,
          passwordHash: await hashPassword(PASSWORD),
        },
      });

      const outsideProfile = await prisma.salesExecutiveProfile.upsert({
        where: { userId: outsideSe.id },
        update: {
          displayName: "Outside Seller",
          teamId: beta.id,
          archivedAt: null,
        },
        create: {
          userId: outsideSe.id,
          teamId: beta.id,
          displayName: "Outside Seller",
          employeeCode: "SE-OUT",
        },
      });
      outsideProfileId = outsideProfile.id;

      const morning = await prisma.monitoringCategory.findFirst({
        where: { code: "MORNING_ROUTINE", isActive: true },
      });
      const item = morning
        ? await prisma.monitoringChecklistItem.findFirst({
            where: {
              categoryId: morning.id,
              code: "PLAN_REVIEWED",
              isActive: true,
            },
          })
        : null;
      if (!morning || !item) {
        dbReady = false;
        return;
      }
      categoryId = morning.id;
      itemId = item.id;

      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  async function pauseActiveAssignment() {
    const active = await prisma.commandoAssignment.findFirst({
      where: { salesExecutiveProfileId: profileId, status: "ACTIVE" },
    });
    if (!active) {
      pausedAssignmentId = null;
      return;
    }
    pausedAssignmentId = active.id;
    await prisma.commandoAssignment.update({
      where: { id: active.id },
      data: {
        status: "COMPLETED",
        endedAt: new Date(),
        completionReason: "Paused for support-link assign test",
      },
    });
  }

  async function restorePausedAssignment() {
    if (!pausedAssignmentId) return;
    await prisma.commandoAssignment.update({
      where: { id: pausedAssignmentId },
      data: {
        status: "ACTIVE",
        endedAt: null,
        completionReason: null,
      },
    });
    pausedAssignmentId = null;
  }

  it("TL can assign a sales support link", async ({ skip }) => {
    if (!dbReady) skip();
    await pauseActiveAssignment();
    try {
      const tl = await token("teamlead@commando.local");
      const res = await request(app)
        .post("/api/sales-support-links")
        .set("Authorization", `Bearer ${tl}`)
        .send({
          salesExecutiveProfileId: profileId,
          salesSupportUserId: assignSupportUserId,
          responsibilityType: "PRODUCT",
          note: "Product support for Sam",
        });
      expect(res.status).toBe(201);
      expect(res.body.data.link.isActive).toBe(true);
      expect(res.body.data.link.responsibilityType).toBe("PRODUCT");
      expect(res.body.data.link.supportUser.id).toBe(assignSupportUserId);
      expect(res.body.data.link.assignedBy).toBeTruthy();
      assignedLinkId = res.body.data.link.id;

      const audit = await prisma.auditLog.findFirst({
        where: {
          entityId: assignedLinkId,
          action: "SALES_SUPPORT_LINK_ASSIGNED",
        },
      });
      expect(audit).toBeTruthy();
    } finally {
      await restorePausedAssignment();
    }
  });

  it("duplicate active link is rejected", async ({ skip }) => {
    if (!dbReady || !assignedLinkId) skip();
    await pauseActiveAssignment();
    try {
      // Ensure link is active after prior tests
      await prisma.salesSupportLink.update({
        where: { id: assignedLinkId },
        data: { isActive: true, endedAt: null, endedById: null },
      });
      const tl = await token("teamlead@commando.local");
      const res = await request(app)
        .post("/api/sales-support-links")
        .set("Authorization", `Bearer ${tl}`)
        .send({
          salesExecutiveProfileId: profileId,
          salesSupportUserId: assignSupportUserId,
          responsibilityType: "GENERAL",
        });
      expect(res.status).toBe(409);
    } finally {
      await restorePausedAssignment();
    }
  });

  it("end preserves history and remains readable", async ({ skip }) => {
    if (!dbReady || !assignedLinkId) skip();
    await pauseActiveAssignment();
    try {
      await prisma.salesSupportLink.update({
        where: { id: assignedLinkId },
        data: { isActive: true, endedAt: null, endedById: null },
      });
      const tl = await token("teamlead@commando.local");
      const end = await request(app)
        .post(`/api/sales-support-links/${assignedLinkId}/end`)
        .set("Authorization", `Bearer ${tl}`)
        .send({ note: "Assignment completed" });
      expect(end.status).toBe(200);
      expect(end.body.data.link.isActive).toBe(false);
      expect(end.body.data.link.endedAt).toBeTruthy();
      expect(end.body.data.link.endedBy).toBeTruthy();

      const get = await request(app)
        .get(`/api/sales-support-links/${assignedLinkId}`)
        .set("Authorization", `Bearer ${tl}`);
      expect(get.status).toBe(200);
      expect(get.body.data.link.isActive).toBe(false);

      const team = await request(app)
        .get(`/api/sales-support-links/profiles/${profileId}/team`)
        .set("Authorization", `Bearer ${tl}`);
      expect(team.status).toBe(200);
      expect(
        team.body.data.history.some(
          (l: { id: string }) => l.id === assignedLinkId,
        ),
      ).toBe(true);
    } finally {
      await restorePausedAssignment();
    }
  });

  it("Commando can view team for assigned SE", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .get(`/api/sales-support-links/profiles/${profileId}/team`)
      .set("Authorization", `Bearer ${c}`);
    expect(res.status).toBe(200);
    expect(res.body.data.profile.id).toBe(profileId);
    expect(res.body.data.commando).toBeTruthy();
    expect(res.body.data.commando.email).toBe("commando@commando.local");
    expect(Array.isArray(res.body.data.activeSupport)).toBe(true);
    expect(Array.isArray(res.body.data.history)).toBe(true);
  });

  it("Commando cannot assign without an active intervention on the SE", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    await pauseActiveAssignment();
    try {
      const c = await token("commando@commando.local");
      const res = await request(app)
        .post("/api/sales-support-links")
        .set("Authorization", `Bearer ${c}`)
        .send({
          salesExecutiveProfileId: profileId,
          salesSupportUserId: assignSupportUserId,
        });
      expect(res.status).toBe(403);
    } finally {
      await restorePausedAssignment();
    }
  });

  it("TL cannot assign outside team", async ({ skip }) => {
    if (!dbReady || !outsideProfileId) skip();
    await pauseActiveAssignment();
    try {
      const tl = await token("teamlead@commando.local");
      const res = await request(app)
        .post("/api/sales-support-links")
        .set("Authorization", `Bearer ${tl}`)
        .send({
          salesExecutiveProfileId: outsideProfileId,
          salesSupportUserId: assignSupportUserId,
        });
      expect(res.status).toBe(403);
    } finally {
      await restorePausedAssignment();
    }
  });

  it("monitoring create snapshots support involvement; survives link end", async ({
    skip,
  }) => {
    if (!dbReady) skip();

    // Ensure active seed link for support@ exists
    const activeLink = await prisma.salesSupportLink.findFirst({
      where: {
        salesExecutiveProfileId: profileId,
        salesSupportUserId: supportUserId,
        isActive: true,
      },
    });
    if (!activeLink) {
      await prisma.salesSupportLink.create({
        data: {
          salesExecutiveProfileId: profileId,
          salesSupportUserId: supportUserId,
          isActive: true,
          responsibilityType: "GENERAL",
        },
      });
    }

    const c = await token("commando@commando.local");
    const create = await request(app)
      .post("/api/monitoring")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        categoryId,
        observation: "Support joined morning review",
        responses: [{ checklistItemId: itemId, value: "YES" }],
        supportInvolvement: {
          salesSupportUserIds: [supportUserId],
        },
      });
    expect(create.status).toBe(201);
    expect(create.body.data.record.supportInvolvements).toHaveLength(1);
    expect(
      create.body.data.record.supportInvolvements[0].displayNameSnapshot,
    ).toBe(supportDisplayName);
    monitoringRecordId = create.body.data.record.id;

    const link = await prisma.salesSupportLink.findFirstOrThrow({
      where: {
        salesExecutiveProfileId: profileId,
        salesSupportUserId: supportUserId,
        isActive: true,
      },
    });

    await pauseActiveAssignment();
    try {
      const tl = await token("teamlead@commando.local");
      const end = await request(app)
        .post(`/api/sales-support-links/${link.id}/end`)
        .set("Authorization", `Bearer ${tl}`)
        .send({});
      expect(end.status).toBe(200);
    } finally {
      await restorePausedAssignment();
    }

    const get = await request(app)
      .get(`/api/monitoring/${monitoringRecordId}`)
      .set("Authorization", `Bearer ${c}`);
    expect(get.status).toBe(200);
    expect(get.body.data.record.supportInvolvements).toHaveLength(1);
    expect(
      get.body.data.record.supportInvolvements[0].displayNameSnapshot,
    ).toBe(supportDisplayName);

    // Restore seed active link for other suites
    await prisma.salesSupportLink.create({
      data: {
        salesExecutiveProfileId: profileId,
        salesSupportUserId: supportUserId,
        isActive: true,
        responsibilityType: "GENERAL",
      },
    });
  });

  it("Commando can assign Sales Support on an actively intervened SE", async ({
    skip,
  }) => {
    if (!dbReady) skip();

    const me = await token("commando@commando.local");
    const perms = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${me}`);
    if (
      !perms.body.data.user.permissions.includes("SALES_SUPPORT_LINK_ASSIGN")
    ) {
      skip();
    }

    // Ensure ACTIVE intervention for Commando on this profile.
    const commando = await prisma.user.findUniqueOrThrow({
      where: { email: "commando@commando.local" },
    });
    const tl = await prisma.user.findUniqueOrThrow({
      where: { email: "teamlead@commando.local" },
    });
    const team = await prisma.team.findFirstOrThrow({
      where: { name: "Alpha Sales Team" },
    });
    let assignment = await prisma.commandoAssignment.findFirst({
      where: {
        salesExecutiveProfileId: profileId,
        commandoUserId: commando.id,
        status: "ACTIVE",
      },
    });
    if (!assignment) {
      assignment = await prisma.commandoAssignment.create({
        data: {
          salesExecutiveProfileId: profileId,
          commandoUserId: commando.id,
          teamLeadUserId: tl.id,
          teamId: team.id,
          startedAt: new Date(),
          status: "ACTIVE",
        },
      });
    }

    // Use a fresh support user so we don't collide with seed links.
    await prisma.salesSupportLink.updateMany({
      where: {
        salesExecutiveProfileId: profileId,
        salesSupportUserId: assignSupportUserId,
        isActive: true,
      },
      data: { isActive: false, endedAt: new Date() },
    });

    const res = await request(app)
      .post("/api/sales-support-links")
      .set("Authorization", `Bearer ${me}`)
      .send({
        salesExecutiveProfileId: profileId,
        salesSupportUserId: assignSupportUserId,
        responsibilityType: "PROPOSAL",
        note: "Commando-assigned proposal support",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.link.isActive).toBe(true);
    expect(res.body.data.link.salesSupportUserId).toBe(assignSupportUserId);
    expect(res.body.data.link.assignedBy.id).toBe(commando.id);

    // Cleanup so other suites stay stable.
    await prisma.salesSupportLink.update({
      where: { id: res.body.data.link.id },
      data: { isActive: false, endedAt: new Date() },
    });
  });
});
