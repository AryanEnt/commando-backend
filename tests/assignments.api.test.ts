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

async function token(email: string) {
  const res = await login(email);
  return res.body.data.accessToken as string;
}

describe("teams, profiles, assignments", () => {
  let dbReady = false;
  let teamId: string;
  let teamLeadId: string;
  let commandoId: string;
  let createdProfileId: string | undefined;
  let createdAssignmentId: string | undefined;
  let historicalAssignmentId: string | undefined;
  let salesUserForCreate: string | undefined;

  beforeAll(async () => {
    try {
      await prisma.$connect();
      const team = await prisma.team.findFirst({
        where: { name: "Alpha Sales Team" },
      });
      const teamLead = await prisma.user.findUnique({
        where: { email: "teamlead@commando.local" },
      });
      const commando = await prisma.user.findUnique({
        where: { email: "commando@commando.local" },
      });
      if (!team || !teamLead || !commando) {
        dbReady = false;
        return;
      }
      teamId = team.id;
      teamLeadId = teamLead.id;
      commandoId = commando.id;

      const role = await prisma.role.findUniqueOrThrow({
        where: { code: "SALES_EXECUTIVE" },
      });
      const passwordHash = await hashPassword(PASSWORD);
      const user = await prisma.user.upsert({
        where: { email: "phase4-sales@commando.local" },
        update: { passwordHash, roleId: role.id, isActive: true },
        create: {
          email: "phase4-sales@commando.local",
          firstName: "Phase",
          lastName: "Four",
          passwordHash,
          roleId: role.id,
        },
      });
      salesUserForCreate = user.id;

      const existingProfile = await prisma.salesExecutiveProfile.findUnique({
        where: { userId: user.id },
      });
      if (existingProfile) {
        await prisma.commandoAssignment.deleteMany({
          where: { salesExecutiveProfileId: existingProfile.id },
        });
        await prisma.salesExecutiveProfile.delete({
          where: { id: existingProfile.id },
        });
      }

      dbReady = true;
    } catch (err) {
      console.warn(err);
      dbReady = false;
    }
  }, 60_000);

  it("creates a sales executive profile", async ({ skip }) => {
    if (!dbReady || !salesUserForCreate) skip();
    const adminToken = await token("admin@commando.local");
    const res = await request(app)
      .post("/api/profiles")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        userId: salesUserForCreate,
        teamId,
        displayName: "Phase Four Seller",
        employeeCode: "SE-P4",
      });
    expect(res.status).toBe(201);
    createdProfileId = res.body.data.profile.id;
    expect(res.body.data.profile.displayName).toBe("Phase Four Seller");
  });

  it("unauthorized user cannot create profile", async ({ skip }) => {
    if (!dbReady) skip();
    const tlToken = await token("teamlead@commando.local");
    const res = await request(app)
      .post("/api/profiles")
      .set("Authorization", `Bearer ${tlToken}`)
      .send({
        userId: salesUserForCreate,
        teamId,
        displayName: "Nope",
      });
    expect(res.status).toBe(403);
  });

  it("assigns Commando to profile", async ({ skip }) => {
    if (!dbReady || !createdProfileId) skip();
    const adminToken = await token("admin@commando.local");
    const res = await request(app)
      .post("/api/assignments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        salesExecutiveProfileId: createdProfileId,
        commandoUserId: commandoId,
        teamLeadUserId: teamLeadId,
        teamId,
      });
    expect(res.status).toBe(201);
    createdAssignmentId = res.body.data.assignment.id;
    expect(res.body.data.assignment.status).toBe("ACTIVE");
    expect(res.body.data.assignment.totalDaysUnderCommando).toBeGreaterThanOrEqual(
      1,
    );

    const duplicate = await request(app)
      .post("/api/assignments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        salesExecutiveProfileId: createdProfileId,
        commandoUserId: commandoId,
        teamLeadUserId: teamLeadId,
        teamId,
      });
    expect(duplicate.status).toBe(409);
  });

  it("unauthorized role cannot create assignment", async ({ skip }) => {
    if (!dbReady || !createdProfileId) skip();
    const salesToken = await token("sales@commando.local");
    const res = await request(app)
      .post("/api/assignments")
      .set("Authorization", `Bearer ${salesToken}`)
      .send({
        salesExecutiveProfileId: createdProfileId,
        commandoUserId: commandoId,
        teamLeadUserId: teamLeadId,
        teamId,
      });
    expect(res.status).toBe(403);
  });

  it("ends assignment and preserves history", async ({ skip }) => {
    if (!dbReady || !createdAssignmentId || !createdProfileId) skip();
    const adminToken = await token("admin@commando.local");
    const endRes = await request(app)
      .post(`/api/assignments/${createdAssignmentId}/end`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "COMPLETED",
        completionReason: "Phase 4 test completion",
      });
    expect(endRes.status).toBe(200);
    expect(endRes.body.data.assignment.status).toBe("COMPLETED");
    expect(endRes.body.data.assignment.endedAt).toBeTruthy();
    historicalAssignmentId = endRes.body.data.assignment.id;

    const historyRes = await request(app)
      .get(`/api/assignments?profileId=${createdProfileId}&status=COMPLETED`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(historyRes.status).toBe(200);
    expect(
      historyRes.body.data.assignments.some(
        (a: { id: string }) => a.id === historicalAssignmentId,
      ),
    ).toBe(true);

    // Create a new active assignment — historical row must remain
    const next = await request(app)
      .post("/api/assignments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        salesExecutiveProfileId: createdProfileId,
        commandoUserId: commandoId,
        teamLeadUserId: teamLeadId,
        teamId,
      });
    expect(next.status).toBe(201);
    createdAssignmentId = next.body.data.assignment.id;

    const stillThere = await prisma.commandoAssignment.findUnique({
      where: { id: historicalAssignmentId },
    });
    expect(stillThere?.status).toBe("COMPLETED");
  });

  it("team change does not alter historical assignment teamId", async ({
    skip,
  }) => {
    if (!dbReady || !createdProfileId || !historicalAssignmentId) skip();
    const adminToken = await token("admin@commando.local");
    const beta = await prisma.team.upsert({
      where: { id: "seed-team-beta" },
      update: { name: "Beta Sales Team" },
      create: { id: "seed-team-beta", name: "Beta Sales Team" },
    });

    const before = await prisma.commandoAssignment.findUniqueOrThrow({
      where: { id: historicalAssignmentId },
    });

    const patch = await request(app)
      .patch(`/api/profiles/${createdProfileId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ teamId: beta.id });
    expect(patch.status).toBe(200);
    expect(patch.body.data.profile.teamId).toBe(beta.id);

    const after = await prisma.commandoAssignment.findUniqueOrThrow({
      where: { id: historicalAssignmentId },
    });
    expect(after.teamId).toBe(before.teamId);
    expect(after.teamId).not.toBe(beta.id);

    // restore profile team for other tests
    await prisma.salesExecutiveProfile.update({
      where: { id: createdProfileId },
      data: { teamId },
    });
  });

  it("sales executive cannot access unrelated assignment", async ({ skip }) => {
    if (!dbReady || !createdAssignmentId) skip();
    const salesToken = await token("sales@commando.local");
    const res = await request(app)
      .get(`/api/assignments/${createdAssignmentId}`)
      .set("Authorization", `Bearer ${salesToken}`);
    expect(res.status).toBe(403);
  });

  it("lists current assignments for scoped team lead", async ({ skip }) => {
    if (!dbReady) skip();
    const tlToken = await token("teamlead@commando.local");
    const res = await request(app)
      .get("/api/assignments?currentOnly=true")
      .set("Authorization", `Bearer ${tlToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.assignments)).toBe(true);
  });
});
