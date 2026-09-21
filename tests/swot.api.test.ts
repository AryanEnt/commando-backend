import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { salesExecutiveCanViewSwot } from "../src/lib/lifecycleVisibility.js";

const app = createApp();
const PASSWORD = "Password123!";

async function token(email: string) {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password: PASSWORD });
  return res.body.data.accessToken as string;
}

const body = {
  strength: "Strong product knowledge",
  weakness: "Inconsistent follow-up",
  opportunity: "Expand mid-market accounts",
  threat: "Competitor discounting",
};

describe("SWOT visibility (TL↔Commando share + SE gate)", () => {
  let dbReady = false;
  let profileId: string;
  let tlSwotId: string;
  let seSwotId: string;
  let commandoSwotId: string;

  beforeAll(async () => {
    try {
      await prisma.$connect();
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

      await prisma.swotAnalysis.deleteMany({
        where: { salesExecutiveProfileId: profileId },
      });

      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  it("unit: SE sees own always; TL/Commando only when shared", () => {
    expect(salesExecutiveCanViewSwot("SALES_EXECUTIVE", false)).toBe(true);
    expect(salesExecutiveCanViewSwot("TEAM_LEAD", false)).toBe(false);
    expect(salesExecutiveCanViewSwot("COMMANDO", false)).toBe(false);
    expect(salesExecutiveCanViewSwot("TEAM_LEAD", true)).toBe(true);
    expect(salesExecutiveCanViewSwot("COMMANDO", true)).toBe(true);
  });

  it("creates TL, SE, and Commando SWOT as separate historical rows", async ({
    skip,
  }) => {
    if (!dbReady) skip();

    // TL create is locked during ACTIVE Commando — seed a pre-intervention TL row
    const profile = await prisma.salesExecutiveProfile.findFirstOrThrow({
      where: { id: profileId },
    });
    const tlUser = await prisma.user.findFirstOrThrow({
      where: { email: "teamlead@commando.local" },
    });
    const tlRow = await prisma.swotAnalysis.create({
      data: {
        salesExecutiveProfileId: profileId,
        teamId: profile.teamId,
        source: "TEAM_LEAD",
        ...body,
        versionNumber: 1,
        visibleToSalesExecutive: false,
        createdById: tlUser.id,
      },
    });
    expect(tlRow.source).toBe("TEAM_LEAD");
    expect(tlRow.visibleToSalesExecutive).toBe(false);
    tlSwotId = tlRow.id;

    const se = await token("sales@commando.local");
    const seRes = await request(app)
      .post("/api/swot")
      .set("Authorization", `Bearer ${se}`)
      .send({
        salesExecutiveProfileId: profileId,
        ...body,
        strength: "Self-identified relationship skills",
      });
    expect(seRes.status).toBe(201);
    expect(seRes.body.data.swot.source).toBe("SALES_EXECUTIVE");
    expect(seRes.body.data.swot.visibleToSalesExecutive).toBe(true);
    seSwotId = seRes.body.data.swot.id;

    const c = await token("commando@commando.local");
    const cRes = await request(app)
      .post("/api/swot")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        ...body,
        threat: "Commando-noted process risk",
      });
    expect(cRes.status).toBe(201);
    expect(cRes.body.data.swot.source).toBe("COMMANDO");
    expect(cRes.body.data.swot.visibleToSalesExecutive).toBe(false);
    expect(cRes.body.data.swot.assignmentId).toBeTruthy();
    commandoSwotId = cRes.body.data.swot.id;
  });

  it("SE sees own SWOT only until TL/Commando share", async ({ skip }) => {
    if (!dbReady || !tlSwotId || !seSwotId || !commandoSwotId) skip();

    const se = await token("sales@commando.local");

    const selfView = await request(app)
      .get(`/api/swot/${seSwotId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(selfView.status).toBe(200);

    const tlHidden = await request(app)
      .get(`/api/swot/${tlSwotId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(tlHidden.status).toBe(403);

    const cHidden = await request(app)
      .get(`/api/swot/${commandoSwotId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(cHidden.status).toBe(403);

    const list = await request(app)
      .get("/api/swot")
      .set("Authorization", `Bearer ${se}`);
    expect(list.status).toBe(200);
    const sources = list.body.data.items.map(
      (i: { source: string }) => i.source,
    );
    expect(sources).toContain("SALES_EXECUTIVE");
    expect(sources).not.toContain("TEAM_LEAD");
    expect(sources).not.toContain("COMMANDO");
  });

  it("TL and Commando can see each other’s SWOT", async ({ skip }) => {
    if (!dbReady || !tlSwotId || !commandoSwotId) skip();

    const tl = await token("teamlead@commando.local");
    const c = await token("commando@commando.local");

    const tlSeesCommando = await request(app)
      .get(`/api/swot/${commandoSwotId}`)
      .set("Authorization", `Bearer ${tl}`);
    expect(tlSeesCommando.status).toBe(200);

    const cSeesTl = await request(app)
      .get(`/api/swot/${tlSwotId}`)
      .set("Authorization", `Bearer ${c}`);
    expect(cSeesTl.status).toBe(200);
  });

  it("TL/Commando can toggle only their own SWOT visibility", async ({
    skip,
  }) => {
    if (!dbReady || !tlSwotId || !commandoSwotId) skip();

    const tl = await token("teamlead@commando.local");
    const se = await token("sales@commando.local");
    const c = await token("commando@commando.local");

    // Commando cannot share TL SWOT
    const cOnTl = await request(app)
      .patch(`/api/swot/${tlSwotId}/visibility`)
      .set("Authorization", `Bearer ${c}`)
      .send({ visibleToSalesExecutive: true });
    expect(cOnTl.status).toBe(403);

    // TL cannot share Commando SWOT
    const tlOnC = await request(app)
      .patch(`/api/swot/${commandoSwotId}/visibility`)
      .set("Authorization", `Bearer ${tl}`)
      .send({ visibleToSalesExecutive: true });
    expect(tlOnC.status).toBe(403);

    // TL shares own SWOT
    const share = await request(app)
      .patch(`/api/swot/${tlSwotId}/visibility`)
      .set("Authorization", `Bearer ${tl}`)
      .send({
        visibleStrength: true,
        visibleWeakness: true,
        visibleOpportunity: false,
        visibleThreat: false,
      });
    expect(share.status).toBe(200);
    expect(share.body.data.swot.visibleToSalesExecutive).toBe(true);
    expect(share.body.data.swot.visibleStrength).toBe(true);
    expect(share.body.data.swot.visibleThreat).toBe(false);

    const seSeesTl = await request(app)
      .get(`/api/swot/${tlSwotId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(seSeesTl.status).toBe(200);
    expect(seSeesTl.body.data.swot.strength).toBe(body.strength);
    expect(seSeesTl.body.data.swot.threat).toBeNull();

    // Commando shares own SWOT
    const shareC = await request(app)
      .patch(`/api/swot/${commandoSwotId}/visibility`)
      .set("Authorization", `Bearer ${c}`)
      .send({ visibleToSalesExecutive: true });
    expect(shareC.status).toBe(200);

    const seSeesC = await request(app)
      .get(`/api/swot/${commandoSwotId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(seSeesC.status).toBe(200);

    const hide = await request(app)
      .patch(`/api/swot/${commandoSwotId}/visibility`)
      .set("Authorization", `Bearer ${c}`)
      .send({ visibleToSalesExecutive: false });
    expect(hide.status).toBe(200);

    const seHiddenAgain = await request(app)
      .get(`/api/swot/${commandoSwotId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(seHiddenAgain.status).toBe(403);
  });

  it("shares individual points with the Sales Executive", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const se = await token("sales@commando.local");

    const created = await request(app)
      .post("/api/swot")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        strengthPoints: [
          { text: "Closes discovery well", visible: true },
          { text: "Internal pipeline hygiene", visible: false },
        ],
        weaknessPoints: [{ text: "Late CRM notes", visible: false }],
        opportunityPoints: [{ text: "Upsell existing book", visible: true }],
        threatPoints: [
          { text: "Price war on SKU A", visible: false },
          { text: "Champion leaving", visible: true },
          { text: "Legal delay on MSA", visible: false },
        ],
      });
    expect(created.status).toBe(201);
    const id = created.body.data.swot.id as string;
    expect(created.body.data.swot.threatPoints).toHaveLength(3);

    const seView = await request(app)
      .get(`/api/swot/${id}`)
      .set("Authorization", `Bearer ${se}`);
    expect(seView.status).toBe(200);
    expect(seView.body.data.swot.strengthPoints).toHaveLength(1);
    expect(seView.body.data.swot.strengthPoints[0].text).toBe(
      "Closes discovery well",
    );
    expect(seView.body.data.swot.weakness).toBeNull();
    expect(seView.body.data.swot.threatPoints).toHaveLength(1);
    expect(seView.body.data.swot.threatPoints[0].text).toBe("Champion leaving");

    const tl = await token("teamlead@commando.local");
    const tlView = await request(app)
      .get(`/api/swot/${id}`)
      .set("Authorization", `Bearer ${tl}`);
    expect(tlView.status).toBe(200);
    expect(tlView.body.data.swot.threatPoints).toHaveLength(3);
  });

  it("super admin is read-only and can filter by source", async ({ skip }) => {
    if (!dbReady) skip();
    const admin = await token("admin@commando.local");

    const create = await request(app)
      .post("/api/swot")
      .set("Authorization", `Bearer ${admin}`)
      .send({ salesExecutiveProfileId: profileId, ...body });
    expect(create.status).toBe(403);

    const list = await request(app)
      .get(`/api/swot?source=COMMANDO&profileId=${profileId}`)
      .set("Authorization", `Bearer ${admin}`);
    expect(list.status).toBe(200);
    expect(
      list.body.data.items.every(
        (i: { source: string }) => i.source === "COMMANDO",
      ),
    ).toBe(true);
  });
});
