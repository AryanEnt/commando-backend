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

const fields = {
  whySalesIsDown: "Pipeline conversion dropped this quarter",
  whatIsTheGap: "Discovery calls are shallow",
  detailedSummaryOfGap:
    "SE is skipping qualification and jumping to demos too early.",
  supportAlreadyProvided: "Weekly 1:1 and call shadowing",
  supportRequiredFromCommando: "Structured discovery coaching and roleplay",
  recommendationFocus: "Discovery framework and talk-track discipline",
};

describe("referral lifecycle", () => {
  let dbReady = false;
  let profileId: string;
  let commandoId: string;
  let referralId: string;

  beforeAll(async () => {
    try {
      await prisma.$connect();
      const profile = await prisma.salesExecutiveProfile.findFirst({
        where: { displayName: "Sam Seller" },
      });
      const commando = await prisma.user.findUnique({
        where: { email: "commando@commando.local" },
      });
      if (!profile || !commando) {
        dbReady = false;
        return;
      }
      profileId = profile.id;
      commandoId = commando.id;

      // Ensure Team Lead can create a handoff — clear leftover ACTIVE interventions
      await prisma.commandoAssignment.updateMany({
        where: { salesExecutiveProfileId: profileId, status: "ACTIVE" },
        data: { status: "COMPLETED", endedAt: new Date() },
      });
      await prisma.salesSupportLink.updateMany({
        where: { salesExecutiveProfileId: profileId, isActive: true },
        data: { isActive: false, endedAt: new Date() },
      });

      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  it("rejects Team Lead initiated send-to-Commando", async ({ skip }) => {
    if (!dbReady) skip();
    const tl = await token("teamlead@commando.local");
    const res = await request(app)
      .post("/api/referrals")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        commandoUserId: commandoId,
        profileName: "Sam Seller",
        ...fields,
        priority1: "Discovery quality",
        priority2: "Qualification discipline",
        priority3: "Talk-track consistency",
        swot: {
          strength: "Strong product knowledge",
          weakness: "Shallow discovery",
          opportunity: "Rebuild qualification habit",
          threat: "Continued pipeline leakage",
        },
      });
    expect(res.status).toBe(403);
  });

  it("commando request → TL provide → begin → complete leaves assignment ACTIVE", async ({
    skip,
  }) => {
    if (!dbReady) skip();

    await prisma.commandoAssignment.updateMany({
      where: { salesExecutiveProfileId: profileId, status: "ACTIVE" },
      data: { status: "COMPLETED", endedAt: new Date() },
    });

    const c = await token("commando@commando.local");
    const created = await request(app)
      .post("/api/referrals/request")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        requestReason: "Need structured discovery coaching",
      });
    expect(created.status).toBe(201);
    expect(created.body.data.referral.initiatedBy).toBe("COMMANDO");
    referralId = created.body.data.referral.id;

    const tl = await token("teamlead@commando.local");
    const provided = await request(app)
      .post(`/api/referrals/${referralId}/provide-information`)
      .set("Authorization", `Bearer ${tl}`)
      .send({
        ...fields,
        priority1: "Discovery quality",
        priority2: "Qualification discipline",
        priority3: "Talk-track consistency",
        swot: {
          strength: "Strong product knowledge",
          weakness: "Shallow discovery",
          opportunity: "Rebuild qualification habit",
          threat: "Continued pipeline leakage",
        },
      });
    expect(provided.status).toBe(200);
    expect(provided.body.data.referral.status).toBe("ACKNOWLEDGED");
    expect(provided.body.data.referral.assignment?.status).toBe("ACTIVE");
    expect(provided.body.data.referral.teamLeadSwot).toMatchObject({
      strength: "Strong product knowledge",
      weakness: "Shallow discovery",
    });

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityId: referralId,
        action: "REFERRAL_INFORMATION_PROVIDED",
      },
    });
    expect(audit).toBeTruthy();
  });

  it("rejects invalid / skipped status transitions", async ({ skip }) => {
    if (!dbReady || !referralId) skip();
    const c = await token("commando@commando.local");
    // Already ACKNOWLEDGED after provide — cannot acknowledge again
    const ackAgain = await request(app)
      .post(`/api/referrals/${referralId}/acknowledge`)
      .set("Authorization", `Bearer ${c}`);
    expect(ackAgain.status).toBe(400);

    const completeEarly = await request(app)
      .post(`/api/referrals/${referralId}/complete`)
      .set("Authorization", `Bearer ${c}`);
    expect(completeEarly.status).toBe(400);
  });

  it("team lead cannot acknowledge (wrong role)", async ({ skip }) => {
    if (!dbReady || !referralId) skip();
    const tl = await token("teamlead@commando.local");
    const res = await request(app)
      .post(`/api/referrals/${referralId}/acknowledge`)
      .set("Authorization", `Bearer ${tl}`);
    expect(res.status).toBe(403);
  });

  it("sales executive cannot view referral", async ({ skip }) => {
    if (!dbReady || !referralId) skip();
    const se = await token("sales@commando.local");
    const res = await request(app)
      .get(`/api/referrals/${referralId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(res.status).toBe(403);
  });

  it("commando begins → completes handoff while assignment stays ACTIVE", async ({
    skip,
  }) => {
    if (!dbReady || !referralId) skip();
    const c = await token("commando@commando.local");

    const detail = await request(app)
      .get(`/api/referrals/${referralId}`)
      .set("Authorization", `Bearer ${c}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.referral.status).toBe("ACKNOWLEDGED");
    expect(detail.body.data.referral.assignment?.status).toBe("ACTIVE");
    const assignmentId = detail.body.data.referral.assignmentId as string;

    // SE must remain in Commando profile scope
    const profiles = await request(app)
      .get("/api/profiles")
      .set("Authorization", `Bearer ${c}`);
    expect(profiles.status).toBe(200);
    expect(
      profiles.body.data.profiles.some(
        (p: { id: string }) => p.id === profileId,
      ),
    ).toBe(true);

    const begin = await request(app)
      .post(`/api/referrals/${referralId}/begin`)
      .set("Authorization", `Bearer ${c}`);
    expect(begin.status).toBe(200);
    expect(begin.body.data.referral.status).toBe("IN_PROGRESS");
    expect(begin.body.data.referral.assignmentId).toBe(assignmentId);
    expect(begin.body.data.referral.assignment?.status).toBe("ACTIVE");
    expect(begin.body.data.referral.teamLeadSwot?.strength).toBe(
      "Strong product knowledge",
    );

    const complete = await request(app)
      .post(`/api/referrals/${referralId}/complete`)
      .set("Authorization", `Bearer ${c}`);
    expect(complete.status).toBe(200);
    expect(complete.body.data.referral.status).toBe("COMPLETED");
    expect(complete.body.data.referral.completedAt).toBeTruthy();

    // Completing the referral must NOT end the ACTIVE assignment
    const stillActive = await prisma.commandoAssignment.findFirst({
      where: {
        id: assignmentId,
        status: "ACTIVE",
      },
    });
    expect(stillActive).toBeTruthy();

    const audits = await prisma.auditLog.findMany({
      where: {
        entityId: referralId,
        action: {
          in: [
            "REFERRAL_INFORMATION_PROVIDED",
            "REFERRAL_IN_PROGRESS",
            "REFERRAL_COMPLETED",
          ],
        },
      },
    });
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it("team lead can view own referral and status", async ({ skip }) => {
    if (!dbReady || !referralId) skip();
    const tl = await token("teamlead@commando.local");
    const detail = await request(app)
      .get(`/api/referrals/${referralId}`)
      .set("Authorization", `Bearer ${tl}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.referral.status).toBe("COMPLETED");

    const list = await request(app)
      .get("/api/referrals?status=COMPLETED&search=Sam")
      .set("Authorization", `Bearer ${tl}`);
    expect(list.status).toBe(200);
    expect(
      list.body.data.referrals.some((r: { id: string }) => r.id === referralId),
    ).toBe(true);
  });

  it("does not allow acknowledge after completion", async ({ skip }) => {
    if (!dbReady || !referralId) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .post(`/api/referrals/${referralId}/acknowledge`)
      .set("Authorization", `Bearer ${c}`);
    expect(res.status).toBe(400);
  });

  it("rejects referral submit without SWOT", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .post("/api/referrals/request")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        // missing requestReason
      });
    expect(res.status).toBe(400);
  });

  it("rejects Team Lead create while ACTIVE assignment exists", async ({
    skip,
  }) => {
    if (!dbReady) skip();

    const admin = await token("admin@commando.local");
    const team = await prisma.team.findFirst({
      where: { name: "Alpha Sales Team" },
    });
    const teamLead = await prisma.user.findUnique({
      where: { email: "teamlead@commando.local" },
    });
    if (!team || !teamLead) {
      skip();
      return;
    }

    const existingActive = await prisma.commandoAssignment.findFirst({
      where: { salesExecutiveProfileId: profileId, status: "ACTIVE" },
    });
    if (!existingActive) {
      const created = await request(app)
        .post("/api/assignments")
        .set("Authorization", `Bearer ${admin}`)
        .send({
          salesExecutiveProfileId: profileId,
          commandoUserId: commandoId,
          teamLeadUserId: teamLead.id,
          teamId: team.id,
        });
      expect(created.status).toBe(201);
    }

    const tl = await token("teamlead@commando.local");
    const res = await request(app)
      .post("/api/referrals")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        commandoUserId: commandoId,
        profileName: "Sam Seller",
        ...fields,
        priority1: "A",
        priority2: "B",
        priority3: "C",
        swot: {
          strength: "S",
          weakness: "W",
          opportunity: "O",
          threat: "T",
        },
      });
    expect(res.status).toBe(403);
  });
});

describe("commando request → TL provide information → lock", () => {
  let dbReady = false;
  let profileId: string;
  let requestReferralId: string;

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

      // Clear leftover ACTIVE assignments / pending Commando requests for a clean run
      await prisma.commandoAssignment.updateMany({
        where: { salesExecutiveProfileId: profileId, status: "ACTIVE" },
        data: { status: "COMPLETED", endedAt: new Date() },
      });
      await prisma.referral.updateMany({
        where: {
          salesExecutiveProfileId: profileId,
          initiatedBy: "COMMANDO",
          status: "SUBMITTED",
        },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  it("commando can request an SE and TL can approve & provide information", async ({
    skip,
  }) => {
    if (!dbReady) skip();

    await prisma.salesSupportLink.updateMany({
      where: { salesExecutiveProfileId: profileId, isActive: true },
      data: { isActive: false, endedAt: new Date() },
    });

    const c = await token("commando@commando.local");
    const options = await request(app)
      .get("/api/referrals/options/requestable-profiles")
      .set("Authorization", `Bearer ${c}`);
    expect(options.status).toBe(200);
    expect(
      options.body.data.profiles.some((p: { id: string }) => p.id === profileId),
    ).toBe(true);

    const created = await request(app)
      .post("/api/referrals/request")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        requestReason: "Need structured discovery coaching for this SE",
        note: "Please share current SWOT and priorities",
      });
    expect(created.status).toBe(201);
    expect(created.body.data.referral.initiatedBy).toBe("COMMANDO");
    expect(created.body.data.referral.status).toBe("SUBMITTED");
    expect(created.body.data.referral.allowedActions).not.toContain(
      "provideInformation",
    );
    expect(created.body.data.referral.allowedActions).not.toContain("reject");
    requestReferralId = created.body.data.referral.id;

    // Commando cannot acknowledge before information is provided
    const earlyAck = await request(app)
      .post(`/api/referrals/${requestReferralId}/acknowledge`)
      .set("Authorization", `Bearer ${c}`);
    expect(earlyAck.status).toBe(400);

    const tl = await token("teamlead@commando.local");
    const provided = await request(app)
      .post(`/api/referrals/${requestReferralId}/provide-information`)
      .set("Authorization", `Bearer ${tl}`)
      .send({
        ...fields,
        priority1: "Discovery quality",
        priority2: "Follow-up discipline",
        priority3: "Pipeline hygiene",
        swot: {
          strength: "Product knowledge",
          weakness: "Follow-up lag",
          opportunity: "Rebuild cadence",
          threat: "Lost deals",
        },
      });
    expect(provided.status).toBe(200);
    expect(provided.body.data.referral.status).toBe("ACKNOWLEDGED");
    expect(provided.body.data.referral.informationProvidedAt).toBeTruthy();
    expect(provided.body.data.referral.assignment?.status).toBe("ACTIVE");

    // Team Lead operational SWOT create is locked during ACTIVE intervention
    const locked = await request(app)
      .post("/api/swot")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        strength: "Should fail",
        weakness: "Should fail",
        opportunity: "Should fail",
        threat: "Should fail",
      });
    expect(locked.status).toBe(403);

    // Closing referral handoff must NOT end the assignment
    const begun = await request(app)
      .post(`/api/referrals/${requestReferralId}/begin`)
      .set("Authorization", `Bearer ${c}`);
    expect(begun.status).toBe(200);

    const closed = await request(app)
      .post(`/api/referrals/${requestReferralId}/complete`)
      .set("Authorization", `Bearer ${c}`);
    expect(closed.status).toBe(200);
    expect(closed.body.data.referral.status).toBe("COMPLETED");
    expect(closed.body.data.referral.assignment?.status).toBe("ACTIVE");

    const assignmentId = closed.body.data.referral.assignment.id as string;
    const ended = await request(app)
      .post(`/api/assignments/${assignmentId}/end`)
      .set("Authorization", `Bearer ${c}`)
      .send({
        status: "COMPLETED",
        completionReason: "Intervention finished in test",
      });
    expect(ended.status).toBe(200);

    // After intervention ends, Team Lead can write again
    const unlocked = await request(app)
      .post("/api/swot")
      .set("Authorization", `Bearer ${tl}`)
      .send({
        salesExecutiveProfileId: profileId,
        strength: "Resumed ownership strength",
        weakness: "Resumed ownership weakness",
        opportunity: "Resumed ownership opportunity",
        threat: "Resumed ownership threat",
      });
    expect(unlocked.status).toBe(201);
  });

  it("requires Team Lead SWOT for assigned Sales Support", async ({ skip }) => {
    if (!dbReady) skip();

    const support = await prisma.user.findUnique({
      where: { email: "support@commando.local" },
    });
    if (!support) skip();

    await prisma.commandoAssignment.updateMany({
      where: { salesExecutiveProfileId: profileId, status: "ACTIVE" },
      data: { status: "COMPLETED", endedAt: new Date() },
    });
    await prisma.salesSupportLink.updateMany({
      where: { salesExecutiveProfileId: profileId, isActive: true },
      data: { isActive: false, endedAt: new Date() },
    });
    await prisma.salesSupportLink.create({
      data: {
        salesExecutiveProfileId: profileId,
        salesSupportUserId: support.id,
        isActive: true,
      },
    });

    const c = await token("commando@commando.local");
    const created = await request(app)
      .post("/api/referrals/request")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        requestReason: "Need support-side SWOT on the packet",
      });
    expect(created.status).toBe(201);
    const id = created.body.data.referral.id as string;

    const pending = await request(app)
      .get(`/api/referrals/${id}`)
      .set("Authorization", `Bearer ${c}`);
    expect(pending.status).toBe(200);
    expect(pending.body.data.referral.assignedSupport).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: support.id }),
      ]),
    );

    const packet = {
      ...fields,
      priority1: "Discovery quality",
      priority2: "Qualification discipline",
      priority3: "Talk-track consistency",
      swot: {
        strength: "Strong product knowledge",
        weakness: "Shallow discovery",
        opportunity: "Rebuild qualification habit",
        threat: "Continued pipeline leakage",
      },
    };

    const tl = await token("teamlead@commando.local");
    const missing = await request(app)
      .post(`/api/referrals/${id}/provide-information`)
      .set("Authorization", `Bearer ${tl}`)
      .send(packet);
    expect(missing.status).toBe(400);

    const provided = await request(app)
      .post(`/api/referrals/${id}/provide-information`)
      .set("Authorization", `Bearer ${tl}`)
      .send({
        ...packet,
        supportSwot: [
          {
            executiveUserId: support.id,
            strength: "Reliable follow-through",
            weakness: "Slow proposal turnaround",
            opportunity: "Own pricing playbook",
            threat: "SE wait time grows",
          },
        ],
      });
    expect(provided.status).toBe(200);
    expect(provided.body.data.referral.teamLeadSupportSwot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executiveUserId: support.id,
          strength: "Reliable follow-through",
          weakness: "Slow proposal turnaround",
        }),
      ]),
    );
  });
});
