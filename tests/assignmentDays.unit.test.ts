import { describe, expect, it } from "vitest";
import { totalDaysUnderCommando } from "../src/lib/assignmentDays.js";

describe("totalDaysUnderCommando", () => {
  it("counts inclusive calendar days for active assignment", () => {
    const started = new Date("2026-09-01T10:00:00.000Z");
    const now = new Date("2026-09-08T12:00:00.000Z");
    expect(totalDaysUnderCommando(started, null, now)).toBe(8);
  });

  it("uses endedAt when assignment completed", () => {
    const started = new Date("2026-09-01T10:00:00.000Z");
    const ended = new Date("2026-09-05T18:00:00.000Z");
    const now = new Date("2026-09-20T12:00:00.000Z");
    expect(totalDaysUnderCommando(started, ended, now)).toBe(5);
  });

  it("returns 1 for same-day start and end", () => {
    const started = new Date("2026-09-08T08:00:00.000Z");
    const ended = new Date("2026-09-08T20:00:00.000Z");
    expect(totalDaysUnderCommando(started, ended)).toBe(1);
  });
});
