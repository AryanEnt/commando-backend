-- Profile SWOT points can now be shared with the Sales Executive and their
-- Sales Support. Every existing Profile SWOT was written as private, so make
-- sure no legacy flag or point exposes it once sharing is enforced.
UPDATE "SwotAnalysis"
SET
  "visibleToSalesExecutive" = false,
  "visibleStrength" = false,
  "visibleWeakness" = false,
  "visibleOpportunity" = false,
  "visibleThreat" = false,
  "strengthPoints" = COALESCE(
    (SELECT jsonb_agg(p || '{"visible": false}'::jsonb)
     FROM jsonb_array_elements("strengthPoints") AS p
     WHERE jsonb_typeof(p) = 'object'),
    '[]'::jsonb
  ),
  "weaknessPoints" = COALESCE(
    (SELECT jsonb_agg(p || '{"visible": false}'::jsonb)
     FROM jsonb_array_elements("weaknessPoints") AS p
     WHERE jsonb_typeof(p) = 'object'),
    '[]'::jsonb
  ),
  "opportunityPoints" = COALESCE(
    (SELECT jsonb_agg(p || '{"visible": false}'::jsonb)
     FROM jsonb_array_elements("opportunityPoints") AS p
     WHERE jsonb_typeof(p) = 'object'),
    '[]'::jsonb
  ),
  "threatPoints" = COALESCE(
    (SELECT jsonb_agg(p || '{"visible": false}'::jsonb)
     FROM jsonb_array_elements("threatPoints") AS p
     WHERE jsonb_typeof(p) = 'object'),
    '[]'::jsonb
  )
WHERE "subjectType" = 'PROFILE'
  AND jsonb_typeof("strengthPoints") = 'array'
  AND jsonb_typeof("weaknessPoints") = 'array'
  AND jsonb_typeof("opportunityPoints") = 'array'
  AND jsonb_typeof("threatPoints") = 'array';

UPDATE "SwotAnalysis"
SET
  "visibleToSalesExecutive" = false,
  "visibleStrength" = false,
  "visibleWeakness" = false,
  "visibleOpportunity" = false,
  "visibleThreat" = false
WHERE "subjectType" = 'PROFILE';
