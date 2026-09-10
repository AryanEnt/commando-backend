import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { verifyPassword } from "../src/lib/password.js";

const app = createApp();
const PASSWORD = "Password123!";

async function login(email: string, password = PASSWORD) {
  return request(app).post("/api/auth/login").send({ email, password });
}

async function token(email: string) {
  const res = await login(email);
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@commando.local`;
}

describe("user management & sales executive onboarding API", () => {
  let adminToken: string;
  let teamId: string;

  beforeAll(async () => {
    await prisma.$connect();
    adminToken = await token("admin@commando.local");
    const team = await prisma.team.findFirstOrThrow({
      where: { name: "Alpha Sales Team", archivedAt: null },
    });
    teamId = team.id;
  });

  it("rejects unauthorized roles from creating users", async () => {
    const emails = [
      "teamlead@commando.local",
      "commando@commando.local",
      "sales@commando.local",
      "support@commando.local",
    ];
    for (const email of emails) {
      const t = await token(email);
      const res = await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${t}`)
        .send({
          firstName: "Nope",
          lastName: "User",
          email: uniqueEmail("blocked"),
          password: PASSWORD,
          roleCode: "SALES_EXECUTIVE",
        });
      expect(res.status).toBe(403);
    }
  });

  it("allows Super Admin to create a user with hashed password", async () => {
    const email = uniqueEmail("create-user");
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        firstName: "Casey",
        lastName: "Creator",
        email,
        password: PASSWORD,
        roleCode: "TEAM_LEAD",
        isActive: true,
        teamId,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user.role.code).toBe("TEAM_LEAD");
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.user.password).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.passwordHash).not.toBe(PASSWORD);
    expect(await verifyPassword(PASSWORD, stored.passwordHash)).toBe(true);

    const membership = await prisma.teamMembership.findFirst({
      where: { userId: stored.id, teamId, isActive: true, endedAt: null },
    });
    expect(membership?.roleInTeam).toBe("TEAM_LEAD");
  });

  it("rejects duplicate email and invalid role/input", async () => {
    const dup = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        firstName: "Dup",
        lastName: "User",
        email: "admin@commando.local",
        password: PASSWORD,
        roleCode: "TEAM_LEAD",
      });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/already exists/i);

    const badRole = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        firstName: "Bad",
        lastName: "Role",
        email: uniqueEmail("bad-role"),
        password: PASSWORD,
        roleCode: "NOT_A_ROLE",
      });
    expect(badRole.status).toBe(400);

    const weakPassword = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        firstName: "Weak",
        lastName: "Pass",
        email: uniqueEmail("weak"),
        password: "short",
        roleCode: "TEAM_LEAD",
      });
    expect(weakPassword.status).toBe(400);
  });

  it("onboards a Sales Executive transactionally", async () => {
    const email = uniqueEmail("se-onboard");
    const res = await request(app)
      .post("/api/users/sales-executives")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        firstName: "Sarah",
        lastName: "Williams",
        email,
        password: PASSWORD,
        teamId,
        displayName: "Sarah Williams",
        employeeCode: "SE-24",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.user.role.code).toBe("SALES_EXECUTIVE");
    expect(res.body.data.profile.displayName).toBe("Sarah Williams");
    expect(res.body.data.profile.team.id).toBe(teamId);
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: {
        role: true,
        salesExecutiveProfile: true,
        teamMemberships: {
          where: { isActive: true, endedAt: null },
        },
      },
    });
    expect(user.role.code).toBe("SALES_EXECUTIVE");
    expect(user.salesExecutiveProfile?.displayName).toBe("Sarah Williams");
    expect(user.teamMemberships[0]?.teamId).toBe(teamId);
    expect(user.teamMemberships[0]?.roleInTeam).toBe("SALES_EXECUTIVE");

    const loginRes = await login(email);
    expect(loginRes.status).toBe(200);

    const list = await request(app)
      .get("/api/profiles")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(
      list.body.data.profiles.some(
        (p: { displayName: string }) => p.displayName === "Sarah Williams",
      ),
    ).toBe(true);
  });

  it("blocks non-admin from SE onboarding and prevents duplicate SE email", async () => {
    const tl = await token("teamlead@commando.local");
    const denied = await request(app)
      .post("/api/users/sales-executives")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        firstName: "X",
        lastName: "Y",
        email: uniqueEmail("tl-se"),
        password: PASSWORD,
        teamId,
        displayName: "X Y",
      });
    expect(denied.status).toBe(403);

    const existingSe = await request(app)
      .post("/api/users/sales-executives")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        firstName: "Sam",
        lastName: "Seller",
        email: "sales@commando.local",
        password: PASSWORD,
        teamId,
        displayName: "Sam Seller",
      });
    expect(existingSe.status).toBe(409);
  });

  it("supports list filters, detail, update, status, and role guards", async () => {
    const email = uniqueEmail("lifecycle");
    const created = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        firstName: "Lane",
        lastName: "Lifecycle",
        email,
        password: PASSWORD,
        roleCode: "COMMANDO_EXECUTIVE",
        isActive: true,
      });
    expect(created.status).toBe(201);
    const userId = created.body.data.user.id as string;

    const listed = await request(app)
      .get("/api/users")
      .query({ search: "Lane", roleCode: "COMMANDO_EXECUTIVE" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.users.some((u: { id: string }) => u.id === userId)).toBe(
      true,
    );

    const detail = await request(app)
      .get(`/api/users/${userId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.user.email).toBe(email);

    const updated = await request(app)
      .patch(`/api/users/${userId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "Lana" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.user.firstName).toBe("Lana");

    const deactivated = await request(app)
      .patch(`/api/users/${userId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.user.isActive).toBe(false);

    const blockedLogin = await login(email);
    expect(blockedLogin.status).toBe(401);

    const reactivated = await request(app)
      .patch(`/api/users/${userId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isActive: true });
    expect(reactivated.status).toBe(200);
    expect((await login(email)).status).toBe(200);

    const selfRole = await request(app)
      .patch(`/api/users/${(await prisma.user.findUniqueOrThrow({ where: { email: "admin@commando.local" } })).id}/role`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ roleCode: "TEAM_LEAD" });
    expect(selfRole.status).toBe(400);

    const roleOk = await request(app)
      .patch(`/api/users/${userId}/role`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ roleCode: "TEAM_LEAD" });
    expect(roleOk.status).toBe(200);
    expect(roleOk.body.data.user.role.code).toBe("TEAM_LEAD");
  });

  it("blocks role change when SE has an active profile", async () => {
    const sales = await prisma.user.findUniqueOrThrow({
      where: { email: "sales@commando.local" },
    });
    const res = await request(app)
      .patch(`/api/users/${sales.id}/role`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ roleCode: "TEAM_LEAD" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/assignment|profile/i);
  });

  it("does not allow non-admin role or status changes", async () => {
    const tl = await token("teamlead@commando.local");
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: "support@commando.local" },
    });
    const role = await request(app)
      .patch(`/api/users/${target.id}/role`)
      .set("Authorization", `Bearer ${tl}`)
      .send({ roleCode: "SUPER_ADMIN" });
    expect(role.status).toBe(403);

    const status = await request(app)
      .patch(`/api/users/${target.id}/status`)
      .set("Authorization", `Bearer ${tl}`)
      .send({ isActive: false });
    expect(status.status).toBe(403);
  });
});
