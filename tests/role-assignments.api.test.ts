import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/password.js";
import { ROLE_ASSIGNMENT_TEMPLATES } from "../src/modules/role-assignments/service.js";

const app = createApp();
const PASSWORD = "Password123!";

async function token(email: string) {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password: PASSWORD });
  return res.body.data.accessToken as string;
}

describe("sales support role assignments", () => {
  let dbReady = false;
  let profileId: string;
  let supportUserId: string;
  let otherSupportUserId: string;
  let otherProfileId: string;
  let roleAssignmentId: string;
  let unrelatedAssignmentId: string;
  let supersededId: string;

  beforeAll(async () => {
    try {
      await prisma.$connect();

      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { displayName: "Sam Seller" },
      });
      const support = await prisma.user.findUnique({
        where: { email: "support@commando.local" },
      });
      const team = await prisma.team.findFirst({
        where: { name: "Alpha Sales Team" },
      });
      if (!profile || !support || !team) {
        dbReady = false;
        return;
      }
      profileId = profile.id;
      supportUserId = support.id;

      const supportRole = await prisma.role.findUniqueOrThrow({
        where: { code: "SALES_SUPPORT_EXECUTIVE" },
      });
      const seRole = await prisma.role.findUniqueOrThrow({
        where: { code: "SALES_EXECUTIVE" },
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

      const otherSeUser = await prisma.user.upsert({
        where: { email: "sales2@commando.local" },
        update: {
          isActive: true,
          deletedAt: null,
          roleId: seRole.id,
          passwordHash: await hashPassword(PASSWORD),
        },
        create: {
          email: "sales2@commando.local",
          firstName: "Other",
          lastName: "Seller",
          roleId: seRole.id,
          passwordHash: await hashPassword(PASSWORD),
        },
      });

      const otherProfile = await prisma.salesExecutiveProfile.upsert({
        where: { userId: otherSeUser.id },
        update: {
          displayName: "Other Seller",
          teamId: team.id,
          archivedAt: null,
        },
        create: {
          userId: otherSeUser.id,
          teamId: team.id,
          displayName: "Other Seller",
          employeeCode: "SE-002",
        },
      });
      otherProfileId = otherProfile.id;

      // Link other SE to other support only (not primary support@)
      await prisma.salesSupportLink.deleteMany({
        where: {
          salesExecutiveProfileId: otherProfileId,
          salesSupportUserId: otherSupportUserId,
        },
      });
      await prisma.salesSupportLink.create({
        data: {
          salesExecutiveProfileId: otherProfileId,
          salesSupportUserId: otherSupportUserId,
          isActive: true,
        },
      });

      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  it("templates are served from API (not UI hard-coding)", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .get("/api/role-assignments/templates")
      .set("Authorization", `Bearer ${c}`);
    expect(res.status).toBe(200);
    expect(res.body.data.templates.primaryResponsibility).toBe(
      ROLE_ASSIGNMENT_TEMPLATES.primaryResponsibility,
    );
    expect(res.body.data.templates.shouldDo.length).toBeGreaterThan(0);
    expect(res.body.data.templates.shouldNotDo.length).toBeGreaterThan(0);
  });

  it("commando can create a role assignment with custom lists", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .post("/api/role-assignments")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        salesSupportUserId: supportUserId,
        primaryResponsibility:
          "Provide CRM and coordination support for Sam Seller.",
        shouldDo: [
          "Assist with CRM hygiene for Sam",
          "Coordinate demo follow-ups assigned by Commando",
        ],
        shouldNotDo: [
          "Do not modify Sales Executive performance scores",
          "Do not change Team Lead assessments",
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.roleAssignment.status).toBe("ACTIVE");
    expect(res.body.data.roleAssignment.shouldDo).toHaveLength(2);
    expect(res.body.data.roleAssignment.shouldNotDo).toHaveLength(2);
    expect(res.body.data.roleAssignment.salesSupportLinkId).toBeTruthy();
    roleAssignmentId = res.body.data.roleAssignment.id;
  });

  it("different Sales Executives can have different instructions", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    // Need active commando assignment for other profile — create temporary
    const commando = await prisma.user.findUniqueOrThrow({
      where: { email: "commando@commando.local" },
    });
    const tl = await prisma.user.findUniqueOrThrow({
      where: { email: "teamlead@commando.local" },
    });
    const team = await prisma.team.findFirstOrThrow({
      where: { name: "Alpha Sales Team" },
    });

    const assignment = await prisma.commandoAssignment.create({
      data: {
        salesExecutiveProfileId: otherProfileId,
        commandoUserId: commando.id,
        teamLeadUserId: tl.id,
        teamId: team.id,
        startedAt: new Date(),
        status: "ACTIVE",
      },
    });

    try {
      const c = await token("commando@commando.local");
      const res = await request(app)
        .post("/api/role-assignments")
        .set("Authorization", `Bearer ${c}`)
        .send({
          salesExecutiveProfileId: otherProfileId,
          salesSupportUserId: otherSupportUserId,
          primaryResponsibility:
            "Field logistics support for Other Seller only.",
          shouldDo: ["Handle logistics for Other Seller visits"],
          shouldNotDo: ["Do not access Sam Seller records"],
        });
      expect(res.status).toBe(201);
      expect(res.body.data.roleAssignment.primaryResponsibility).toContain(
        "Other Seller",
      );
      unrelatedAssignmentId = res.body.data.roleAssignment.id;

      const sam = await request(app)
        .get(`/api/role-assignments/${roleAssignmentId}`)
        .set("Authorization", `Bearer ${c}`);
      expect(sam.body.data.roleAssignment.primaryResponsibility).toContain(
        "Sam Seller",
      );
      expect(sam.body.data.roleAssignment.primaryResponsibility).not.toBe(
        res.body.data.roleAssignment.primaryResponsibility,
      );
    } finally {
      await prisma.commandoAssignment.delete({ where: { id: assignment.id } });
    }
  });

  it("SSE sees assigned SE and not unassigned SEs", async ({ skip }) => {
    if (!dbReady || !roleAssignmentId) skip();
    const support = await token("support@commando.local");
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${support}`);
    if (!me.body.data.user.permissions.includes("ROLE_ASSIGNMENT_VIEW")) {
      skip();
    }

    const list = await request(app)
      .get("/api/role-assignments")
      .set("Authorization", `Bearer ${support}`);
    expect(list.status).toBe(200);
    expect(
      list.body.data.roleAssignments.every(
        (r: { salesSupportUserId: string; salesExecutiveProfileId: string }) =>
          r.salesSupportUserId === supportUserId &&
          r.salesExecutiveProfileId === profileId,
      ),
    ).toBe(true);
    expect(
      list.body.data.roleAssignments.some(
        (r: { id: string }) => r.id === roleAssignmentId,
      ),
    ).toBe(true);
    expect(
      list.body.data.roleAssignments.some(
        (r: { salesExecutiveProfileId: string }) =>
          r.salesExecutiveProfileId === otherProfileId,
      ),
    ).toBe(false);

    const detail = await request(app)
      .get(`/api/role-assignments/${roleAssignmentId}`)
      .set("Authorization", `Bearer ${support}`);
    expect(detail.status).toBe(200);
  });

  it("direct API access to unrelated assignment is rejected", async ({
    skip,
  }) => {
    if (!dbReady || !unrelatedAssignmentId) skip();
    const support = await token("support@commando.local");
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${support}`);
    if (!me.body.data.user.permissions.includes("ROLE_ASSIGNMENT_VIEW")) {
      skip();
    }

    const res = await request(app)
      .get(`/api/role-assignments/${unrelatedAssignmentId}`)
      .set("Authorization", `Bearer ${support}`);
    expect(res.status).toBe(403);
  });

  it("commando edit creates historical SUPERSEDED version", async ({
    skip,
  }) => {
    if (!dbReady || !roleAssignmentId) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .patch(`/api/role-assignments/${roleAssignmentId}`)
      .set("Authorization", `Bearer ${c}`)
      .send({
        primaryResponsibility: "Updated: CRM + pipeline support for Sam.",
        shouldDo: ["Updated should-do item"],
        shouldNotDo: ["Updated should-not-do item"],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.roleAssignment.id).not.toBe(roleAssignmentId);
    expect(res.body.data.roleAssignment.status).toBe("ACTIVE");
    expect(res.body.data.roleAssignment.replacesId).toBe(roleAssignmentId);
    supersededId = roleAssignmentId;
    roleAssignmentId = res.body.data.roleAssignment.id;

    const old = await prisma.supportRoleAssignment.findUniqueOrThrow({
      where: { id: supersededId },
    });
    expect(old.status).toBe("SUPERSEDED");

    const history = await request(app)
      .get("/api/role-assignments?includeHistory=true")
      .set("Authorization", `Bearer ${c}`);
    expect(
      history.body.data.roleAssignments.some(
        (r: { id: string; status: string }) =>
          r.id === supersededId && r.status === "SUPERSEDED",
      ),
    ).toBe(true);
  });

  it("SSE cannot create or edit role assignments", async ({ skip }) => {
    if (!dbReady || !roleAssignmentId) skip();
    const support = await token("support@commando.local");
    const create = await request(app)
      .post("/api/role-assignments")
      .set("Authorization", `Bearer ${support}`)
      .send({
        salesExecutiveProfileId: profileId,
        salesSupportUserId: supportUserId,
        primaryResponsibility: "Nope",
        shouldDo: ["x"],
        shouldNotDo: ["y"],
      });
    expect(create.status).toBe(403);

    const edit = await request(app)
      .patch(`/api/role-assignments/${roleAssignmentId}`)
      .set("Authorization", `Bearer ${support}`)
      .send({ primaryResponsibility: "Nope" });
    expect(edit.status).toBe(403);
  });

  it("team lead can create role assignments without an active Commando intervention", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const tl = await token("teamlead@commando.local");
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${tl}`);
    if (!me.body.data.user.permissions.includes("ROLE_ASSIGNMENT_CREATE")) {
      skip();
    }

    // Use Other Seller so we do not disturb Sam Seller's Commando fixtures.
    await prisma.commandoAssignment.updateMany({
      where: { salesExecutiveProfileId: otherProfileId, status: "ACTIVE" },
      data: { status: "COMPLETED", endedAt: new Date() },
    });

    const res = await request(app)
      .post("/api/role-assignments")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: otherProfileId,
        salesSupportUserId: otherSupportUserId,
        primaryResponsibility:
          "Provide proposal support under Team Lead management.",
        shouldDo: ["Draft proposals as directed by Team Lead"],
        shouldNotDo: ["Do not change performance scores"],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.roleAssignment.status).toBe("ACTIVE");
    expect(res.body.data.roleAssignment.salesExecutiveProfileId).toBe(
      otherProfileId,
    );
  });

  it("SSE cannot modify Commando evaluations / TL assessments / performance", async ({
    skip,
  }) => {
    if (!dbReady) skip();
    const support = await token("support@commando.local");
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${support}`);
    const perms: string[] = me.body.data.user.permissions;
    expect(perms).not.toContain("PERFORMANCE_CREATE");
    expect(perms).not.toContain("PERFORMANCE_VIEW");
    expect(perms).not.toContain("SWOT_CREATE");
    expect(perms).not.toContain("FEEDBACK_CREATE");
    expect(perms).not.toContain("WEEKLY_REVIEW_CREATE");
    expect(perms).not.toContain("MONITORING_CREATE");
    expect(perms).not.toContain("SYNC_EVAL_CREATE");

    const swot = await request(app)
      .post("/api/swot")
      .set("Authorization", `Bearer ${support}`)
      .send({
        salesExecutiveProfileId: profileId,
        strength: "x",
        weakness: "x",
        opportunity: "x",
        threat: "x",
      });
    expect(swot.status).toBe(403);

    const sync = await request(app)
      .post("/api/sync-evaluations")
      .set("Authorization", `Bearer ${support}`)
      .send({
        salesExecutiveProfileId: profileId,
        salesSupportUserId: supportUserId,
        issue: "x",
        recommendedAction: "x",
      });
    expect(sync.status).toBe(403);

    const monitoring = await request(app)
      .post("/api/monitoring")
      .set("Authorization", `Bearer ${support}`)
      .send({
        salesExecutiveProfileId: profileId,
        categoryId: "clxxxxxxxxxxxxxxxxxxxxxxxx",
        responses: [{ checklistItemId: "clxxxxxxxxxxxxxxxxxxxxxxxx", value: "YES" }],
      });
    expect(monitoring.status).toBe(403);

    const weekly = await request(app)
      .post("/api/weekly-reviews")
      .set("Authorization", `Bearer ${support}`)
      .send({
        salesExecutiveProfileId: profileId,
        weekLabel: "x",
        weekStartDate: "2026-03-01",
        meetingDate: "2026-03-01T10:00:00.000Z",
        performanceSummary: "x",
        whatWentWell: "x",
        improvement: "x",
        nextWeekAction: "x",
      });
    expect(weekly.status).toBe(403);
  });
});
