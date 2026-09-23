/**
 * Weighted monitoring score helpers.
 * N/A is excluded from the denominator; remaining weights normalize to 100%.
 */

export type ScoreResponse = {
  value: string;
  weight: number;
};

export type WeightedScoreResult = {
  scorePercent: number | null;
  applicableWeight: number;
  earnedWeight: number;
  totalWeight: number;
};

export function sumWeights(weights: number[]): number {
  return weights.reduce((sum, w) => sum + (Number.isFinite(w) ? w : 0), 0);
}

export function allocationStatus(totalActiveWeight: number): {
  total: number;
  remaining: number;
  over: number;
  isComplete: boolean;
} {
  const total = Math.round(totalActiveWeight);
  const remaining = Math.max(0, 100 - total);
  const over = Math.max(0, total - 100);
  return {
    total,
    remaining,
    over,
    isComplete: total === 100,
  };
}

export function computeWeightedScore(
  responses: ScoreResponse[],
): WeightedScoreResult {
  const totalWeight = sumWeights(responses.map((r) => r.weight));
  const applicable = responses.filter(
    (r) => r.value.toUpperCase() !== "NA" && r.weight > 0,
  );
  const applicableWeight = sumWeights(applicable.map((r) => r.weight));
  if (applicableWeight <= 0) {
    return {
      scorePercent: null,
      applicableWeight: 0,
      earnedWeight: 0,
      totalWeight,
    };
  }

  const earnedWeight = sumWeights(
    applicable
      .filter((r) => r.value.toUpperCase() === "YES")
      .map((r) => r.weight),
  );

  const scorePercent =
    Math.round((earnedWeight / applicableWeight) * 1000) / 10;

  return {
    scorePercent,
    applicableWeight,
    earnedWeight,
    totalWeight,
  };
}

/** Evenly distribute 100 across n items (remainder on the first items). */
export function distributeEvenWeights(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(100 / count);
  const rem = 100 % count;
  return Array.from({ length: count }, (_, i) => base + (i < rem ? 1 : 0));
}
