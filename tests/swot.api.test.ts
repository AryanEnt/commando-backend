import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import {
  getCommandoLifecycleState,
  salesExecutiveCanViewSwotSource,
} from "../src/lib/lifecycleVisibility.js";

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

describe("SWOT lifecycle visibility", () => {
  let dbReady = false;
  let profileId: string;
  let assignmentId: string;
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
      assignmentId = assignment.id;

      await prisma.swotAnalysis.deleteMany({
        where: { salesExecutiveProfileId: profileId },
      });

      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  it("unit: SE cannot view Commando source during active assignment", () => {
    const during = {
      hasActiveAssignment: true,
      hasCompletedAssignment: true,
      isDuringCommando: true,
      isAfterCommando: false,
    };
    expect(salesExecutiveCanViewSwotSource("TEAM_LEAD", during)).toBe(true);
    expect(salesExecutiveCanViewSwotSource("SALES_EXECUTIVE", during)).toBe(
      true,
    );
    expect(salesExecutiveCanViewSwotSource("COMMANDO", during)).toBe(false);

    const after = {
      hasActiveAssignment: false,
      hasCompletedAssignment: true,
      isDuringCommando: false,
      isAfterCommando: true,
    };
    expect(salesExecutiveCanViewSwotSource("COMMANDO", after)).toBe(true);
  });

  it("creates TL, SE, and Commando SWOT as separate historical rows", async ({
    skip,
  }) => {
    if (!dbReady) skip();

    const tl = await token("teamlead@commando.local");
    const tlRes = await request(app)
      .post("/api/swot")
      .set("Authorization", `Bearer ${tl}`)
      .send({ salesExecutiveProfileId: profileId, ...body });
    expect(tlRes.status).toBe(201);
    expect(tlRes.body.data.swot.source).toBe("TEAM_LEAD");
    tlSwotId = tlRes.body.data.swot.id;

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
    expect(cRes.body.data.swot.assignmentId).toBeTruthy();
    commandoSwotId = cRes.body.data.swot.id;

    // Creating again adds another row (no overwrite)
    const tl2 = await request(app)
      .post("/api/swot")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        ...body,
        strength: "Updated TL view — new record",
      });
    expect(tl2.status).toBe(201);
    expect(tl2.body.data.swot.id).not.toBe(tlSwotId);

    const stillOriginal = await prisma.swotAnalysis.findUnique({
      where: { id: tlSwotId },
    });
    expect(stillOriginal?.strength).toBe("Strong product knowledge");
  });

  it("during Commando: SE can read TL + self, but not Commando SWOT by id", async ({
    skip,
  }) => {
    if (!dbReady || !tlSwotId || !seSwotId || !commandoSwotId) skip();
    const lifecycle = await getCommandoLifecycleState(prisma, profileId);
    expect(lifecycle.isDuringCommando).toBe(true);

    const se = await token("sales@commando.local");

    const tlView = await request(app)
      .get(`/api/swot/${tlSwotId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(tlView.status).toBe(200);

    const selfView = await request(app)
      .get(`/api/swot/${seSwotId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(selfView.status).toBe(200);

    const hidden = await request(app)
      .get(`/api/swot/${commandoSwotId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(hidden.status).toBe(403);

    const list = await request(app)
      .get("/api/swot")
      .set("Authorization", `Bearer ${se}`);
    expect(list.status).toBe(200);
    const sources = list.body.data.items.map(
      (i: { source: string }) => i.source,
    );
    expect(sources).toContain("TEAM_LEAD");
    expect(sources).toContain("SALES_EXECUTIVE");
    expect(sources).not.toContain("COMMANDO");
  });

  it("after Commando: SE can read Commando SWOT", async ({ skip }) => {
    if (!dbReady || !commandoSwotId || !assignmentId) skip();

    await prisma.commandoAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "COMPLETED",
        endedAt: new Date(),
        completionReason: "Phase 6 visibility test",
      },
    });

    const lifecycle = await getCommandoLifecycleState(prisma, profileId);
    expect(lifecycle.isAfterCommando).toBe(true);

    const se = await token("sales@commando.local");
    const view = await request(app)
      .get(`/api/swot/${commandoSwotId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(view.status).toBe(200);
    expect(view.body.data.swot.source).toBe("COMMANDO");

    const list = await request(app)
      .get("/api/swot")
      .set("Authorization", `Bearer ${se}`);
    expect(
      list.body.data.items.some(
        (i: { source: string }) => i.source === "COMMANDO",
      ),
    ).toBe(true);

    // Restore active assignment for other suites
    await prisma.commandoAssignment.update({
      where: { id: assignmentId },
      data: {
        status: "ACTIVE",
        endedAt: null,
        completionReason: null,
      },
    });
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

  it("commando can view Team Lead SWOT", async ({ skip }) => {
    if (!dbReady || !tlSwotId) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .get(`/api/swot/${tlSwotId}`)
      .set("Authorization", `Bearer ${c}`);
    expect(res.status).toBe(200);
    expect(res.body.data.swot.source).toBe("TEAM_LEAD");
  });
});
