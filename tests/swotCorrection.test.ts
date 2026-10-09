import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../src/lib/authorization.js";
import {
  applySwotPointCorrection,
  type QuadrantPointMap,
} from "../src/lib/swotPoints.js";
import {
  correctSwotPoint,
  correctionNewPointVisible,
} from "../src/modules/swot/service.js";

const db = vi.hoisted(() => {
  const state: {
    row: Record<string, unknown> | null;
    latestId: string | null;
    created: Record<string, unknown> | null;
    audit: Record<string, unknown> | null;
  } = { row: null, latestId: null, created: null, audit: null };

  const swotAnalysis = {
    findFirst: vi.fn(async (args: { where: { id?: string } }) => {
      if (args.where.id) return state.row;
      return state.latestId ? { id: state.latestId, versionNumber: 9 } : null;
    }),
    create: vi.fn(async () => {
      throw new Error("corrections must not create a new version");
    }),
    update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      state.created = { ...args.data, whereId: args.where.id };
      return {
        ...state.row,
        ...args.data,
        correctedBy: { id: args.data.correctedById, firstName: "Super", lastName: "Admin" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }),
  };
  const client = {
    swotAnalysis,
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(client),
  };
  return { state, client };
});

vi.mock("../src/lib/prisma.js", () => ({ prisma: db.client }));
vi.mock("../src/lib/audit.js", () => ({
  writeAuditLog: vi.fn(async (input: Record<string, unknown>) => {
    db.state.audit = input;
  }),
}));

function actor(roleCode: Actor["roleCode"]): Actor {
  return { id: `user-${roleCode}`, roleCode, permissions: [] } as unknown as Actor;
}

function points(): QuadrantPointMap {
  return {
    strength: [
      { id: "s1", text: "Strong closer", visible: true },
      { id: "s2", text: "Good follow-up", visible: false },
    ],
    weakness: [{ id: "w1", text: "Late reports", visible: false }],
    opportunity: [{ id: "o1", text: "New territory", visible: true }],
    threat: [{ id: "t1", text: "Competitor pricing", visible: false }],
  };
}

function commandoRow() {
  const p = points();
  return {
    id: "swot-1",
    subjectType: "PROFILE",
    salesExecutiveProfileId: "profile-1",
    executiveUserId: null,
    teamId: "team-1",
    assignmentId: "assignment-1",
    source: "COMMANDO",
    strength: p.strength.map((x) => x.text).join("\n"),
    weakness: p.weakness.map((x) => x.text).join("\n"),
    opportunity: p.opportunity.map((x) => x.text).join("\n"),
    threat: p.threat.map((x) => x.text).join("\n"),
    strengthPoints: p.strength,
    weaknessPoints: p.weakness,
    opportunityPoints: p.opportunity,
    threatPoints: p.threat,
    versionNumber: 3,
    supersedesId: "swot-0",
    visibleToSalesExecutive: true,
    visibleStrength: true,
    visibleWeakness: false,
    visibleOpportunity: true,
    visibleThreat: false,
    createdById: "commando-1",
    createdBy: { id: "commando-1", firstName: "Com", lastName: "Mando" },
    correctedById: null,
    correctedBy: null,
    correctedAt: null,
    correctionReason: null,
    archivedAt: null,
    profile: { id: "profile-1", displayName: "AT aayush thapa", userId: "se-1", teamId: "team-1" },
    executiveUser: null,
    team: { id: "team-1", name: "Team" },
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-01"),
  };
}

describe("applySwotPointCorrection", () => {
  it("edits only the target point and keeps its id and visibility", () => {
    const before = points();
    const result = applySwotPointCorrection(before, {
      kind: "edit",
      pointId: "s2",
      text: "  Excellent follow-up  ",
    }, false);
    expect(result?.quadrant).toBe("strength");
    expect(result?.before).toBe("Good follow-up");
    expect(result?.after).toBe("Excellent follow-up");
    expect(result?.points.strength).toEqual([
      { id: "s1", text: "Strong closer", visible: true },
      { id: "s2", text: "Excellent follow-up", visible: false },
    ]);
    expect(result?.points.weakness).toEqual(before.weakness);
    expect(result?.points.opportunity).toEqual(before.opportunity);
    expect(result?.points.threat).toEqual(before.threat);
    expect(before.strength[1].text).toBe("Good follow-up");
  });

  it("adds a point to one quadrant with the default visibility", () => {
    const result = applySwotPointCorrection(
      points(),
      { kind: "add", quadrant: "threat", text: "Market slowdown" },
      false,
      "t2",
    );
    expect(result?.points.threat).toEqual([
      { id: "t1", text: "Competitor pricing", visible: false },
      { id: "t2", text: "Market slowdown", visible: false },
    ]);
    expect(result?.points.strength).toEqual(points().strength);
  });

  it("deletes one point and leaves the rest", () => {
    const result = applySwotPointCorrection(
      points(),
      { kind: "delete", pointId: "s1" },
      false,
    );
    expect(result?.points.strength).toEqual([
      { id: "s2", text: "Good follow-up", visible: false },
    ]);
    expect(result?.before).toBe("Strong closer");
    expect(result?.after).toBeNull();
  });

  it("returns null for an unknown point", () => {
    expect(
      applySwotPointCorrection(points(), { kind: "delete", pointId: "nope" }, false),
    ).toBeNull();
  });
});

describe("correctionNewPointVisible", () => {
  it("shows new points only on an SE / SSE's own User SWOT", () => {
    expect(correctionNewPointVisible({ subjectType: "EXECUTIVE", source: "SALES_EXECUTIVE" })).toBe(true);
    expect(correctionNewPointVisible({ subjectType: "EXECUTIVE", source: "SALES_SUPPORT_EXECUTIVE" })).toBe(true);
    expect(correctionNewPointVisible({ subjectType: "EXECUTIVE", source: "TEAM_LEAD" })).toBe(false);
    expect(correctionNewPointVisible({ subjectType: "PROFILE", source: "COMMANDO" })).toBe(false);
    expect(correctionNewPointVisible({ subjectType: "PROFILE", source: "SALES_EXECUTIVE" })).toBe(false);
  });
});

describe("correctSwotPoint", () => {
  beforeEach(() => {
    db.state.row = commandoRow();
    db.state.latestId = "swot-1";
    db.state.created = null;
    db.state.audit = null;
  });

  it.each([
    "COMMANDO_EXECUTIVE",
    "TEAM_LEAD",
    "SALES_EXECUTIVE",
    "SALES_SUPPORT_EXECUTIVE",
  ] as const)("rejects %s with 403", async (role) => {
    await expect(
      correctSwotPoint(actor(role), "swot-1", { kind: "delete", pointId: "s1" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(db.state.created).toBeNull();
  });

  it("rejects correcting an older version", async () => {
    db.state.latestId = "swot-2";
    await expect(
      correctSwotPoint(actor("SUPER_ADMIN"), "swot-1", {
        kind: "edit",
        pointId: "s1",
        text: "Changed",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(db.state.created).toBeNull();
  });

  it("refuses to empty a quadrant", async () => {
    await expect(
      correctSwotPoint(actor("SUPER_ADMIN"), "swot-1", { kind: "delete", pointId: "w1" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("updates the same version in place, keeping source, author and version", async () => {
    const result = await correctSwotPoint(
      actor("SUPER_ADMIN"),
      "swot-1",
      { kind: "edit", pointId: "s2", text: "Excellent follow-up" },
      "  Typo from Commando  ",
    );
    const data = db.state.created!;
    expect(data.whereId).toBe("swot-1");
    expect(data).not.toHaveProperty("source");
    expect(data).not.toHaveProperty("createdById");
    expect(data).not.toHaveProperty("versionNumber");
    expect(data).not.toHaveProperty("supersedesId");
    expect(data.correctedById).toBe("user-SUPER_ADMIN");
    expect(data.correctionReason).toBe("Typo from Commando");
    expect(result.id).toBe("swot-1");
    expect(result.source).toBe("COMMANDO");
    expect(result.createdById).toBe("commando-1");
    expect(result.versionNumber).toBe(3);
    expect(data.strengthPoints).toEqual([
      { id: "s1", text: "Strong closer", visible: true },
      { id: "s2", text: "Excellent follow-up", visible: false },
    ]);
    expect(data.weaknessPoints).toEqual(points().weakness);
    expect(data.opportunityPoints).toEqual(points().opportunity);
    expect(data.threatPoints).toEqual(points().threat);
    expect(data.visibleStrength).toBe(true);
    expect(data.visibleWeakness).toBe(false);

    expect(db.state.audit).toMatchObject({
      action: "SWOT_CORRECTED",
      metadata: {
        operation: "edit",
        quadrant: "strength",
        pointId: "s2",
        before: "Good follow-up",
        after: "Excellent follow-up",
        reason: "Typo from Commando",
      },
    });
    expect(result.isCurrentVersion).toBe(true);
    expect(result.correctedById).toBe("user-SUPER_ADMIN");
  });

  it("adds a hidden point to a Commando SWOT", async () => {
    await correctSwotPoint(actor("SUPER_ADMIN"), "swot-1", {
      kind: "add",
      quadrant: "opportunity",
      text: "Cross-sell to existing clients",
    });
    const added = (db.state.created!.opportunityPoints as Array<{ text: string; visible: boolean }>)[1];
    expect(added).toMatchObject({ text: "Cross-sell to existing clients", visible: false });
    expect(db.state.created!.correctionReason).toBeNull();
  });
});
