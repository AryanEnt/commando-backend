import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

export const SWOT_POINT_QUADRANTS = [
  "strength",
  "weakness",
  "opportunity",
  "threat",
] as const;

export type SwotPointQuadrant = (typeof SWOT_POINT_QUADRANTS)[number];

export type SwotPoint = {
  id: string;
  text: string;
  visible: boolean;
};

export type QuadrantPointMap = Record<SwotPointQuadrant, SwotPoint[]>;

const POINTS_FIELD: Record<
  SwotPointQuadrant,
  "strengthPoints" | "weaknessPoints" | "opportunityPoints" | "threatPoints"
> = {
  strength: "strengthPoints",
  weakness: "weaknessPoints",
  opportunity: "opportunityPoints",
  threat: "threatPoints",
};

export function splitSwotText(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*\d+[.)]\s*/, "")
        .replace(/^\s*[-*•]\s*/, "")
        .trim(),
    )
    .filter(Boolean);
  return lines.length > 0 ? lines : text.trim() ? [text.trim()] : [];
}

export function parseSwotPoints(raw: unknown): SwotPoint[] {
  if (!Array.isArray(raw)) return [];
  const points: SwotPoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const text = typeof rec.text === "string" ? rec.text.trim() : "";
    if (!text) continue;
    points.push({
      id:
        typeof rec.id === "string" && rec.id.trim()
          ? rec.id.trim()
          : randomUUID(),
      text,
      visible: Boolean(rec.visible),
    });
  }
  return points;
}

export function textToSwotPoints(text: string, visible: boolean): SwotPoint[] {
  return splitSwotText(text).map((line) => ({
    id: randomUUID(),
    text: line,
    visible,
  }));
}

export function normalizeSwotPoints(
  input: Array<{ id?: string; text: string; visible?: boolean }> | undefined,
  fallbackText: string | undefined,
  defaultVisible: boolean,
): SwotPoint[] {
  if (input && input.length > 0) {
    return input
      .map((p) => ({
        id: p.id?.trim() || randomUUID(),
        text: p.text.trim(),
        visible: p.visible ?? defaultVisible,
      }))
      .filter((p) => p.text.length > 0);
  }
  if (fallbackText?.trim()) {
    return textToSwotPoints(fallbackText, defaultVisible);
  }
  return [];
}

export function joinSwotPoints(points: SwotPoint[]): string {
  return points.map((p) => p.text).join("\n");
}

export function pointsToJson(
  points: SwotPoint[],
): Prisma.InputJsonValue {
  return points.map((p) => ({
    id: p.id,
    text: p.text,
    visible: p.visible,
  }));
}

export function emptyQuadrantPoints(): QuadrantPointMap {
  return {
    strength: [],
    weakness: [],
    opportunity: [],
    threat: [],
  };
}

export function loadQuadrantPoints(
  row: {
    strength: string;
    weakness: string;
    opportunity: string;
    threat: string;
    strengthPoints?: unknown;
    weaknessPoints?: unknown;
    opportunityPoints?: unknown;
    threatPoints?: unknown;
    visibleStrength?: boolean | null;
    visibleWeakness?: boolean | null;
    visibleOpportunity?: boolean | null;
    visibleThreat?: boolean | null;
    visibleToSalesExecutive?: boolean | null;
    source?: string;
  },
): QuadrantPointMap {
  const own = row.source === "SALES_EXECUTIVE";
  const overall =
    Boolean(row.visibleToSalesExecutive) &&
    !row.visibleStrength &&
    !row.visibleWeakness &&
    !row.visibleOpportunity &&
    !row.visibleThreat;
  const result = emptyQuadrantPoints();
  for (const q of SWOT_POINT_QUADRANTS) {
    const jsonPoints = parseSwotPoints(row[POINTS_FIELD[q]]);
    if (jsonPoints.length > 0) {
      result[q] = own
        ? jsonPoints.map((p) => ({ ...p, visible: true }))
        : jsonPoints;
      continue;
    }
    const flagKey = (
      {
        strength: "visibleStrength",
        weakness: "visibleWeakness",
        opportunity: "visibleOpportunity",
        threat: "visibleThreat",
      } as const
    )[q];
    const visible = own || Boolean(row[flagKey]) || overall;
    result[q] = textToSwotPoints(row[q] ?? "", visible);
  }
  return result;
}

export function flagsFromPoints(points: QuadrantPointMap): {
  visibleStrength: boolean;
  visibleWeakness: boolean;
  visibleOpportunity: boolean;
  visibleThreat: boolean;
} {
  return {
    visibleStrength: points.strength.some((p) => p.visible),
    visibleWeakness: points.weakness.some((p) => p.visible),
    visibleOpportunity: points.opportunity.some((p) => p.visible),
    visibleThreat: points.threat.some((p) => p.visible),
  };
}

export function setAllPointsVisible(
  points: QuadrantPointMap,
  visible: boolean,
): QuadrantPointMap {
  const next = emptyQuadrantPoints();
  for (const q of SWOT_POINT_QUADRANTS) {
    next[q] = points[q].map((p) => ({ ...p, visible }));
  }
  return next;
}

export function setQuadrantPointsVisible(
  points: QuadrantPointMap,
  quadrant: SwotPointQuadrant,
  visible: boolean,
): QuadrantPointMap {
  return {
    ...points,
    [quadrant]: points[quadrant].map((p) => ({ ...p, visible })),
  };
}

export function setPointVisible(
  points: QuadrantPointMap,
  quadrant: SwotPointQuadrant,
  id: string,
  visible: boolean,
): QuadrantPointMap | null {
  const idx = points[quadrant].findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const list = points[quadrant].slice();
  list[idx] = { ...list[idx], visible };
  return { ...points, [quadrant]: list };
}
