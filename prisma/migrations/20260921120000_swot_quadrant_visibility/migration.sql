-- Per-quadrant SE sharing (Strengths / Weaknesses / Opportunities / Threats)
ALTER TABLE "SwotAnalysis" ADD COLUMN "visibleStrength" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SwotAnalysis" ADD COLUMN "visibleWeakness" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SwotAnalysis" ADD COLUMN "visibleOpportunity" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SwotAnalysis" ADD COLUMN "visibleThreat" BOOLEAN NOT NULL DEFAULT false;

-- Existing fully-shared rows keep all four boxes visible
UPDATE "SwotAnalysis"
SET
  "visibleStrength" = true,
  "visibleWeakness" = true,
  "visibleOpportunity" = true,
  "visibleThreat" = true
WHERE "visibleToSalesExecutive" = true;
