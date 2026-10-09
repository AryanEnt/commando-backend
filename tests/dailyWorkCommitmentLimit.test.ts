import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  dailyWorkCommitment: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  dailyWorkLog: {
    count: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
  },
  salesExecutiveProfile: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("../src/lib/prisma.js", () => ({ prisma: db }));
vi.mock("../src/lib/audit.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/audit.js")>()),
  writeAuditLog: vi.fn(),
}));

import type { Actor } from "../src/lib/authorization.js";
import { PERMISSIONS } from "../src/lib/permissions.js";
import {
  createCommitmentPlan,
  createDailyWorkLog,
  saveDailyWorkCommitment,
} from "../src/modules/daily-work-logs/service.js";
import { createCommitmentPlanSchema } from "../src/modules/daily-work-logs/schemas.js";

const actor: Actor = {
  id: "user-1",
  roleCode: "SALES_SUPPORT_EXECUTIVE",
  permissions: [PERMISSIONS.DAILY_WORK_LOG_CREATE],
};

const commitment = {
  kind: "COMMITMENT" as const,
  notes: "Follow up yesterday's seminar leads",
  loggedAt: new Date(),
  tzOffsetMinutes: 0,
};

describe("one commitment per day", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.dailyWorkCommitment.findUnique.mockResolvedValue(null);
    db.dailyWorkLog.count.mockResolvedValue(0);
  });

  it("rejects a second commitment row on the same day", async () => {
    db.dailyWorkLog.count.mockResolvedValue(1);

    await expect(createDailyWorkLog(actor, commitment)).rejects.toMatchObject({
      statusCode: 409,
      message: "You've already added today's commitment",
    });
    expect(db.dailyWorkLog.create).not.toHaveBeenCalled();
  });

  it("rejects a commitment row when today's commitment note exists", async () => {
    db.dailyWorkCommitment.findUnique.mockResolvedValue({ id: "note-1" });

    await expect(createDailyWorkLog(actor, commitment)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(db.dailyWorkLog.create).not.toHaveBeenCalled();
  });

  it("rejects a commitment note when a commitment row exists today", async () => {
    db.dailyWorkLog.count.mockResolvedValue(1);

    await expect(
      saveDailyWorkCommitment(actor, { commitment: "Plan", tzOffsetMinutes: 0 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(db.dailyWorkCommitment.create).not.toHaveBeenCalled();
  });
});

describe("commitment plan", () => {
  const plan = {
    items: [
      { listItem: "FOLLOW_UP", subItem: "WHATSAPP", count: 15 },
      { listItem: "EMAIL_TO_AGENT", subItem: null, count: 4 },
    ],
    note: null,
    tzOffsetMinutes: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db.dailyWorkCommitment.findUnique.mockResolvedValue(null);
    db.dailyWorkLog.count.mockResolvedValue(0);
    db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
    db.dailyWorkLog.create.mockImplementation(async () => ({
      id: `c${db.dailyWorkLog.create.mock.calls.length}`,
    }));
    db.dailyWorkLog.findMany.mockResolvedValue([]);
  });

  it("saves every planned activity as a commitment row without a time range", async () => {
    await createCommitmentPlan(actor, plan);

    expect(db.dailyWorkLog.create).toHaveBeenCalledTimes(2);
    const rows = db.dailyWorkLog.create.mock.calls.map(([arg]) => arg.data);
    expect(rows[0]).toMatchObject({
      kind: "COMMITMENT",
      listItem: "FOLLOW_UP",
      subItem: "WHATSAPP",
      count: 15,
      activity: "Follow Up · WhatsApp",
    });
    expect(rows[1]).toMatchObject({ listItem: "EMAIL_TO_AGENT", subItem: null, count: 4 });
    expect(rows.every((r) => !("timeRange" in r))).toBe(true);
    expect(db.dailyWorkCommitment.create).not.toHaveBeenCalled();
  });

  it("stores the optional note as today's commitment note", async () => {
    await createCommitmentPlan(actor, { ...plan, note: "Also call the Pokhara leads" });
    expect(db.dailyWorkCommitment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ commitment: "Also call the Pokhara leads" }),
    });
  });

  it("rejects a plan once today's commitment exists", async () => {
    db.dailyWorkLog.count.mockResolvedValue(1);
    await expect(createCommitmentPlan(actor, plan)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(db.dailyWorkLog.create).not.toHaveBeenCalled();
  });

  it("rejects the same activity and sub item twice", async () => {
    await expect(
      createCommitmentPlan(actor, { ...plan, items: [plan.items[0]!, plan.items[0]!] }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(db.dailyWorkLog.create).not.toHaveBeenCalled();
  });

  it("needs at least one item and a target on each", () => {
    expect(createCommitmentPlanSchema.safeParse({ items: [] }).success).toBe(false);
    expect(
      createCommitmentPlanSchema.safeParse({
        items: [{ listItem: "FOLLOW_UP", subItem: "WHATSAPP" }],
      }).success,
    ).toBe(false);
  });
});
