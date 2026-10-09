import { describe, expect, it } from "vitest";
import {
  WORK_ACTIVITIES,
  resolveWorkActivity,
  workActivityLabels,
} from "../src/modules/daily-work-logs/activities.js";
import { createDailyWorkLogSchema } from "../src/modules/daily-work-logs/schemas.js";

const SE = "SALES_EXECUTIVE";

describe("WORK_ACTIVITIES", () => {
  it("lists the Sales Executive activities in order, with Sales Support mirroring them", () => {
    expect(WORK_ACTIVITIES.SALES_EXECUTIVE.map((a) => a.label)).toEqual([
      "Follow Up",
      "KrispCall",
      "Portal Upload",
      "Comment Handling",
      "Social Media Post",
      "Email to Agent",
      "Bulk SMS",
      "Daily Collection",
    ]);
    expect(WORK_ACTIVITIES.SALES_SUPPORT_EXECUTIVE).toEqual(WORK_ACTIVITIES.SALES_EXECUTIVE);
  });

  it("only Daily Collection asks for an amount", () => {
    const withAmount = WORK_ACTIVITIES.SALES_EXECUTIVE.filter((a) => a.hasAmount);
    expect(withAmount.map((a) => a.code)).toEqual(["DAILY_COLLECTION"]);
  });
});

describe("resolveWorkActivity", () => {
  it("builds the label from activity and sub item", () => {
    expect(
      resolveWorkActivity(SE, { listItem: "FOLLOW_UP", subItem: "WHATSAPP" }),
    ).toEqual({
      listItem: "FOLLOW_UP",
      subItem: "WHATSAPP",
      totalAmount: null,
      activityLabel: "Follow Up · WhatsApp",
    });
  });

  it("accepts Email to Agent without a sub item", () => {
    expect(resolveWorkActivity(SE, { listItem: "EMAIL_TO_AGENT" }).activityLabel).toBe(
      "Email to Agent",
    );
  });

  it("rejects a sub item from another activity (no stale sub items)", () => {
    expect(() =>
      resolveWorkActivity(SE, { listItem: "KRISPCALL", subItem: "WHATSAPP" }),
    ).toThrow(/doesn't belong to KrispCall/);
  });

  it("requires a sub item when the activity has them", () => {
    expect(() => resolveWorkActivity(SE, { listItem: "PORTAL_UPLOAD" })).toThrow(
      /Choose a sub item/,
    );
  });

  it("rejects a sub item for Email to Agent", () => {
    expect(() =>
      resolveWorkActivity(SE, { listItem: "EMAIL_TO_AGENT", subItem: "EA" }),
    ).toThrow(/has no sub items/);
  });

  it("requires an amount for Daily Collection and rejects it elsewhere", () => {
    expect(() =>
      resolveWorkActivity(SE, { listItem: "DAILY_COLLECTION", subItem: "IP" }),
    ).toThrow(/total amount/);
    expect(
      resolveWorkActivity(SE, {
        listItem: "DAILY_COLLECTION",
        subItem: "IP",
        totalAmount: 50000,
      }).totalAmount,
    ).toBe(50000);
    expect(() =>
      resolveWorkActivity(SE, {
        listItem: "KRISPCALL",
        subItem: "OUTGOING",
        totalAmount: 10,
      }),
    ).toThrow(/doesn't take a total amount/);
  });

  it("rejects unknown activities", () => {
    expect(() => resolveWorkActivity(SE, { listItem: "NOPE" })).toThrow(
      /Choose an activity/,
    );
  });
});

describe("workActivityLabels", () => {
  it("maps codes to labels and falls back to raw codes", () => {
    expect(workActivityLabels("PORTAL_UPLOAD", "VETASSESS")).toEqual({
      listItemLabel: "Portal Upload",
      subItemLabel: "Vetassess",
    });
    expect(workActivityLabels("LEGACY", "X")).toEqual({
      listItemLabel: "LEGACY",
      subItemLabel: "X",
    });
    expect(workActivityLabels(null, null)).toEqual({
      listItemLabel: null,
      subItemLabel: null,
    });
  });
});

describe("createDailyWorkLogSchema", () => {
  const base = { loggedAt: "2026-10-07T04:00:00.000Z" };

  it("accepts a structured entry", () => {
    const parsed = createDailyWorkLogSchema.parse({
      ...base,
      listItem: "FOLLOW_UP",
      subItem: "WHATSAPP",
      count: 15,
      timeRange: "2min - 5min",
    });
    expect(parsed.kind).toBe("LOG");
    expect(parsed.timeRange).toBe("2min - 5min");
  });

  it("requires count and start / end time for structured entries", () => {
    const result = createDailyWorkLogSchema.safeParse({ ...base, listItem: "FOLLOW_UP" });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["count", "startedAt"]));
  });

  it("accepts a structured entry with start and end time", () => {
    const parsed = createDailyWorkLogSchema.parse({
      ...base,
      listItem: "FOLLOW_UP",
      subItem: "WHATSAPP",
      count: 15,
      startedAt: "2026-10-07T03:00:00.000Z",
      endedAt: "2026-10-07T03:25:00.000Z",
    });
    expect(parsed.timeRange).toBeUndefined();
    expect(parsed.endedAt).toEqual(new Date("2026-10-07T03:25:00.000Z"));
  });

  it("rejects an end time that is not after the start time", () => {
    const result = createDailyWorkLogSchema.safeParse({
      ...base,
      listItem: "FOLLOW_UP",
      subItem: "WHATSAPP",
      count: 15,
      startedAt: "2026-10-07T03:25:00.000Z",
      endedAt: "2026-10-07T03:00:00.000Z",
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path.join("."))).toContain("endedAt");
  });

  it("rejects negative or zero counts", () => {
    for (const count of [-1, 0]) {
      expect(
        createDailyWorkLogSchema.safeParse({
          ...base,
          listItem: "KRISPCALL",
          subItem: "OUTGOING",
          count,
          timeRange: "5min - 10min",
        }).success,
      ).toBe(false);
    }
  });

  it("still accepts the older free-text entry", () => {
    expect(createDailyWorkLogSchema.safeParse({ ...base, activity: "Called 10 people" }).success).toBe(
      true,
    );
  });

  it("accepts a commitment that is only a description", () => {
    expect(
      createDailyWorkLogSchema.safeParse({
        ...base,
        kind: "COMMITMENT",
        notes: "Chase the seminar leads and upload 8 EA files",
      }).success,
    ).toBe(true);
  });

  it("requires a description on commitments", () => {
    for (const notes of [undefined, null, "   "]) {
      const result = createDailyWorkLogSchema.safeParse({
        ...base,
        kind: "COMMITMENT",
        activity: "Plan",
        notes,
      });
      expect(result.success).toBe(false);
      expect(result.error!.issues.map((i) => i.path.join("."))).toEqual(["notes"]);
    }
  });
});
