import { describe, expect, it } from "vitest";
import { snapshotPeriod } from "../src/modules/referrals/snapshot.js";
import { performanceSnapshotSchema } from "../src/modules/referrals/schemas.js";
import {
  assertAllowedEvidenceUpload,
  isOwnedInterventionEvidenceKey,
} from "../src/modules/uploads/schemas.js";

const now = new Date("2026-10-06T12:00:00.000Z");

describe("snapshotPeriod", () => {
  it("uses the past 6 months when active for 6 months or more", () => {
    const period = snapshotPeriod(new Date("2025-01-01T00:00:00.000Z"), now);
    expect(period.kind).toBe("SIX_MONTHS");
    expect(period.start.toISOString().slice(0, 7)).toBe("2026-04");
    expect(period.end).toEqual(now);
  });

  it("uses all available history when active for less than 6 months", () => {
    const joined = new Date("2026-07-15T00:00:00.000Z");
    const period = snapshotPeriod(joined, now);
    expect(period.kind).toBe("ALL_HISTORY");
    expect(period.start).toEqual(joined);
  });
});

const se = {
  overallPerformance: "AVERAGE",
  trend: "DECLINING",
  insights: ["MISSING_TARGETS", "MISSING_TARGETS", "NEEDS_SUPPORT"],
  note: "Declining for two months.",
};

describe("performanceSnapshotSchema", () => {
  it("accepts a minimal SE snapshot without numbers or documents", () => {
    const parsed = performanceSnapshotSchema.parse({ salesExecutive: se });
    expect(parsed.salesExecutive.insights).toEqual(["MISSING_TARGETS", "NEEDS_SUPPORT"]);
    expect(parsed.salesSupport).toEqual([]);
    expect(parsed.evidence).toEqual([]);
  });

  it("requires performance, trend, an insight and a note", () => {
    for (const broken of [
      { ...se, overallPerformance: undefined },
      { ...se, trend: "SIDEWAYS" },
      { ...se, insights: [] },
      { ...se, note: "   " },
    ]) {
      expect(performanceSnapshotSchema.safeParse({ salesExecutive: broken }).success).toBe(false);
    }
  });

  it("keeps SE and SSE insight vocabularies separate", () => {
    expect(
      performanceSnapshotSchema.safeParse({
        salesExecutive: { ...se, insights: ["STRONG_SUPPORT"] },
      }).success,
    ).toBe(false);
    expect(
      performanceSnapshotSchema.safeParse({
        salesExecutive: se,
        salesSupport: [{ ...se, subjectUserId: "u1", insights: ["STRONG_SUPPORT"] }],
      }).success,
    ).toBe(true);
  });
});

describe("intervention evidence uploads", () => {
  it("accepts the supported document types and rejects others", () => {
    for (const [contentType, fileName] of [
      ["application/pdf", "Sales Report.pdf"],
      ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "p.xlsx"],
      ["application/vnd.ms-excel", "p.xls"],
      ["text/csv", "p.csv"],
      ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "p.docx"],
      ["application/msword", "p.doc"],
      ["image/jpeg", "p.jpg"],
      ["image/png", "p.png"],
    ]) {
      expect(() =>
        assertAllowedEvidenceUpload({ contentType: contentType!, contentLength: 1000, fileName }),
      ).not.toThrow();
    }
    expect(() =>
      assertAllowedEvidenceUpload({ contentType: "application/zip", contentLength: 10, fileName: "a.zip" }),
    ).toThrow();
    expect(() =>
      assertAllowedEvidenceUpload({ contentType: "application/pdf", contentLength: 10, fileName: "a.exe" }),
    ).toThrow();
    expect(() =>
      assertAllowedEvidenceUpload({
        contentType: "application/pdf",
        contentLength: 11 * 1024 * 1024,
        fileName: "big.pdf",
      }),
    ).toThrow();
  });

  it("only treats the uploader's own evidence keys as theirs", () => {
    expect(isOwnedInterventionEvidenceKey("interventions/evidence/tl1/x-a.pdf", "tl1")).toBe(true);
    expect(isOwnedInterventionEvidenceKey("interventions/evidence/tl2/x-a.pdf", "tl1")).toBe(false);
    expect(isOwnedInterventionEvidenceKey("interventions/evidence/tl1/../tl2/a.pdf", "tl1")).toBe(false);
  });
});
