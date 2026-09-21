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

describe("action items lifecycle", () => {
  let dbReady = false;
  let profileId: string;
  let activeId: string;
  let completedId: string;
  let expiredId: string;
  let replacedId: string;
  let replacementId: string;

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
      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  it("commando creates an ACTIVE action item", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .post("/api/action-items")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        title: "Complete discovery call prep",
        description: "Review account notes before Thursday call",
        dueDate: "2026-03-20T17:00:00.000Z",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.actionItem.status).toBe("ACTIVE");
    expect(res.body.data.actionItem.isActive).toBe(true);
    expect(res.body.data.actionItem.assignmentId).toBeTruthy();
    expect(res.body.data.actionItem.commando).toBeTruthy();
    activeId = res.body.data.actionItem.id;
  });

  it("commando can edit ACTIVE items", async ({ skip }) => {
    if (!dbReady || !activeId) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .patch(`/api/action-items/${activeId}`)
      .set("Authorization", `Bearer ${c}`)
      .send({ title: "Updated: discovery call prep" });
    expect(res.status).toBe(200);
    expect(res.body.data.actionItem.title).toContain("Updated:");
  });

  it("complete moves item to HISTORY", async ({ skip }) => {
    if (!dbReady || !activeId) skip();
    const c = await token("commando@commando.local");

    // create another for complete
    const created = await request(app)
      .post("/api/action-items")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        title: "To complete",
      });
    completedId = created.body.data.actionItem.id;

    const res = await request(app)
      .post(`/api/action-items/${completedId}/complete`)
      .set("Authorization", `Bearer ${c}`);
    expect(res.status).toBe(200);
    expect(res.body.data.actionItem.status).toBe("COMPLETED");
    expect(res.body.data.actionItem.completedAt).toBeTruthy();
    expect(res.body.data.actionItem.isHistory).toBe(true);

    const edit = await request(app)
      .patch(`/api/action-items/${completedId}`)
      .set("Authorization", `Bearer ${c}`)
      .send({ title: "should fail" });
    expect(edit.status).toBe(400);
  });

  it("expire moves item to HISTORY", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");
    const created = await request(app)
      .post("/api/action-items")
      .set("Authorization", `Bearer ${c}`)
      .send({
        salesExecutiveProfileId: profileId,
        title: "To expire",
      });
    expiredId = created.body.data.actionItem.id;

    const res = await request(app)
      .post(`/api/action-items/${expiredId}/expire`)
      .set("Authorization", `Bearer ${c}`);
    expect(res.status).toBe(200);
    expect(res.body.data.actionItem.status).toBe("EXPIRED");
    expect(res.body.data.actionItem.expiredAt).toBeTruthy();
  });

  it("replace keeps old record and creates new ACTIVE", async ({ skip }) => {
    if (!dbReady || !activeId) skip();
    const c = await token("commando@commando.local");
    const res = await request(app)
      .post(`/api/action-items/${activeId}/replace`)
      .set("Authorization", `Bearer ${c}`)
      .send({
        title: "Replacement action",
        description: "Supersedes previous prep item",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.actionItem.status).toBe("ACTIVE");
    expect(res.body.data.actionItem.replacesId).toBe(activeId);
    replacementId = res.body.data.actionItem.id;
    replacedId = activeId;

    const old = await prisma.actionItem.findUniqueOrThrow({
      where: { id: replacedId },
    });
    expect(old.status).toBe("REPLACED");
    expect(old.title).toContain("Updated:");

    const detail = await request(app)
      .get(`/api/action-items/${replacementId}`)
      .set("Authorization", `Bearer ${c}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.actionItem.previousActions.length).toBeGreaterThan(
      0,
    );
    expect(detail.body.data.actionItem.previousActions[0].id).toBe(replacedId);
  });

  it("ACTIVE and HISTORY list views are distinct", async ({ skip }) => {
    if (!dbReady) skip();
    const c = await token("commando@commando.local");

    const active = await request(app)
      .get(`/api/action-items?profileId=${profileId}&view=active`)
      .set("Authorization", `Bearer ${c}`);
    expect(active.status).toBe(200);
    expect(
      active.body.data.actionItems.every(
        (i: { status: string }) => i.status === "ACTIVE",
      ),
    ).toBe(true);
    expect(
      active.body.data.actionItems.some(
        (i: { id: string }) => i.id === replacementId,
      ),
    ).toBe(true);

    const history = await request(app)
      .get(`/api/action-items?profileId=${profileId}&view=history`)
      .set("Authorization", `Bearer ${c}`);
    expect(history.status).toBe(200);
    expect(
      history.body.data.actionItems.every((i: { status: string }) =>
        ["COMPLETED", "EXPIRED", "REPLACED", "CANCELLED"].includes(i.status),
      ),
    ).toBe(true);
    expect(
      history.body.data.actionItems.some(
        (i: { id: string }) => i.id === completedId,
      ),
    ).toBe(true);
    expect(
      history.body.data.actionItems.some(
        (i: { id: string }) => i.id === expiredId,
      ),
    ).toBe(true);
    expect(
      history.body.data.actionItems.some(
        (i: { id: string }) => i.id === replacedId,
      ),
    ).toBe(true);
  });

  it("sales executive can complete own ACTIVE items but cannot create or expire", async ({
    skip,
  }) => {
    if (!dbReady || !replacementId) skip();
    const se = await token("sales@commando.local");

    const list = await request(app)
      .get(`/api/action-items?view=active`)
      .set("Authorization", `Bearer ${se}`);
    expect(list.status).toBe(200);
    expect(
      list.body.data.actionItems.every(
        (i: { salesExecutiveProfileId: string; status: string }) =>
          i.salesExecutiveProfileId === profileId && i.status === "ACTIVE",
      ),
    ).toBe(true);

    const historyBlocked = await request(app)
      .get(`/api/action-items?view=history`)
      .set("Authorization", `Bearer ${se}`);
    expect(historyBlocked.status).toBe(403);

    const allBlocked = await request(app)
      .get(`/api/action-items?view=all`)
      .set("Authorization", `Bearer ${se}`);
    expect(allBlocked.status).toBe(403);

    const detail = await request(app)
      .get(`/api/action-items/${replacementId}`)
      .set("Authorization", `Bearer ${se}`);
    expect(detail.status).toBe(200);

    const create = await request(app)
      .post("/api/action-items")
      .set("Authorization", `Bearer ${se}`)
      .send({
        salesExecutiveProfileId: profileId,
        title: "SE cannot create",
      });
    expect(create.status).toBe(403);

    const complete = await request(app)
      .post(`/api/action-items/${replacementId}/complete`)
      .set("Authorization", `Bearer ${se}`);
    expect(complete.status).toBe(200);
    expect(complete.body.data.actionItem.status).toBe("COMPLETED");
    expect(complete.body.data.actionItem.completedById).toBeTruthy();

    const expire = await request(app)
      .post(`/api/action-items/${replacementId}/expire`)
      .set("Authorization", `Bearer ${se}`);
    expect(expire.status).toBe(403);

    const replace = await request(app)
      .post(`/api/action-items/${replacementId}/replace`)
      .set("Authorization", `Bearer ${se}`)
      .send({ title: "Nope" });
    expect(replace.status).toBe(403);
  });
});
