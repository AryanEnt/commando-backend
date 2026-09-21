-- SE visibility gate for SWOT (TL/Commando/Admin always see; SE only when true)
ALTER TABLE "SwotAnalysis" ADD COLUMN "visibleToSalesExecutive" BOOLEAN NOT NULL DEFAULT false;

-- Self-assessments remain visible to the SE who authored them
UPDATE "SwotAnalysis"
SET "visibleToSalesExecutive" = true
WHERE "source" = 'SALES_EXECUTIVE';
