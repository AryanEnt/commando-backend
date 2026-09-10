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

describe("phase 25 intervention workspace", () => {
  let profileId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const profile = await prisma.salesExecutiveProfile.findFirstOrThrow({
      where: { displayName: "Sam Seller" },
    });
    profileId = profile.id;
  });

  it("returns intervention workspace for assigned commando", async () => {
    const t = await token("commando@commando.local");
    const res = await request(app)
      .get(`/api/interventions/${profileId}`)
      .set("Authorization", `Bearer ${t}`);
    expect(res.status).toBe(200);
    expect(res.body.data.profile.id).toBe(profileId);
    expect(res.body.data.health.status).toMatch(/ON_TRACK|NEEDS_ATTENTION|AT_RISK/);
    expect(res.body.data.nextAction.label).toBeTruthy();
  });

  it("returns a real timeline from records", async () => {
    const t = await token("admin@commando.local");
    const res = await request(app)
      .get(`/api/interventions/${profileId}/timeline`)
      .set("Authorization", `Bearer ${t}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.events)).toBe(true);
  });

  it("sales executive can acknowledge their own intervention", async () => {
    const t = await token("sales@commando.local");
    const res = await request(app)
      .post("/api/interventions/acknowledgements")
      .set("Authorization", `Bearer ${t}`)
      .send({
        entityType: "INTERVENTION",
        entityId: profileId,
        salesExecutiveProfileId: profileId,
      });
    expect(res.status).toBe(201);
  });

  it("sales executive cannot acknowledge another profile", async () => {
    const other = await prisma.salesExecutiveProfile.findFirst({
      where: { displayName: { not: "Sam Seller" } },
    });
    if (!other) return;
    const t = await token("sales@commando.local");
    const res = await request(app)
      .post("/api/interventions/acknowledgements")
      .set("Authorization", `Bearer ${t}`)
      .send({
        entityType: "INTERVENTION",
        entityId: other.id,
        salesExecutiveProfileId: other.id,
      });
    expect(res.status).toBe(403);
  });
});
