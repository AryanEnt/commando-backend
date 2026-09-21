-- Numbered SWOT points with per-item SE visibility
ALTER TABLE "SwotAnalysis" ADD COLUMN "strengthPoints" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "SwotAnalysis" ADD COLUMN "weaknessPoints" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "SwotAnalysis" ADD COLUMN "opportunityPoints" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "SwotAnalysis" ADD COLUMN "threatPoints" JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE "SwotAnalysis"
SET
  "strengthPoints" = CASE
    WHEN length(trim("strength")) = 0 THEN '[]'::jsonb
    ELSE jsonb_build_array(jsonb_build_object(
      'id', md5(id || ':strength'),
      'text', "strength",
      'visible', (
        "source" = 'SALES_EXECUTIVE'
        OR "visibleStrength" = true
        OR (
          "visibleToSalesExecutive" = true
          AND "visibleStrength" = false
          AND "visibleWeakness" = false
          AND "visibleOpportunity" = false
          AND "visibleThreat" = false
        )
      )
    ))
  END,
  "weaknessPoints" = CASE
    WHEN length(trim("weakness")) = 0 THEN '[]'::jsonb
    ELSE jsonb_build_array(jsonb_build_object(
      'id', md5(id || ':weakness'),
      'text', "weakness",
      'visible', (
        "source" = 'SALES_EXECUTIVE'
        OR "visibleWeakness" = true
        OR (
          "visibleToSalesExecutive" = true
          AND "visibleStrength" = false
          AND "visibleWeakness" = false
          AND "visibleOpportunity" = false
          AND "visibleThreat" = false
        )
      )
    ))
  END,
  "opportunityPoints" = CASE
    WHEN length(trim("opportunity")) = 0 THEN '[]'::jsonb
    ELSE jsonb_build_array(jsonb_build_object(
      'id', md5(id || ':opportunity'),
      'text', "opportunity",
      'visible', (
        "source" = 'SALES_EXECUTIVE'
        OR "visibleOpportunity" = true
        OR (
          "visibleToSalesExecutive" = true
          AND "visibleStrength" = false
          AND "visibleWeakness" = false
          AND "visibleOpportunity" = false
          AND "visibleThreat" = false
        )
      )
    ))
  END,
  "threatPoints" = CASE
    WHEN length(trim("threat")) = 0 THEN '[]'::jsonb
    ELSE jsonb_build_array(jsonb_build_object(
      'id', md5(id || ':threat'),
      'text', "threat",
      'visible', (
        "source" = 'SALES_EXECUTIVE'
        OR "visibleThreat" = true
        OR (
          "visibleToSalesExecutive" = true
          AND "visibleStrength" = false
          AND "visibleWeakness" = false
          AND "visibleOpportunity" = false
          AND "visibleThreat" = false
        )
      )
    ))
  END;
