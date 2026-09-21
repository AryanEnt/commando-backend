-- Weekly review action tracking + SWOT version lineage

ALTER TABLE "ActionItem" ADD COLUMN "weeklyReviewId" TEXT;
ALTER TABLE "ActionItem" ADD COLUMN "completedById" TEXT;

CREATE INDEX "ActionItem_weeklyReviewId_idx" ON "ActionItem"("weeklyReviewId");
CREATE INDEX "ActionItem_completedById_idx" ON "ActionItem"("completedById");

ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_weeklyReviewId_fkey" FOREIGN KEY ("weeklyReviewId") REFERENCES "WeeklyReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SwotAnalysis" ADD COLUMN "versionNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SwotAnalysis" ADD COLUMN "supersedesId" TEXT;

CREATE INDEX "SwotAnalysis_salesExecutiveProfileId_source_versionNumber_idx" ON "SwotAnalysis"("salesExecutiveProfileId", "source", "versionNumber");
CREATE INDEX "SwotAnalysis_supersedesId_idx" ON "SwotAnalysis"("supersedesId");

ALTER TABLE "SwotAnalysis" ADD CONSTRAINT "SwotAnalysis_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "SwotAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill SWOT version numbers per profile+source (oldest = 1)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "salesExecutiveProfileId", source
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "SwotAnalysis"
  WHERE "archivedAt" IS NULL
)
UPDATE "SwotAnalysis" s
SET "versionNumber" = ranked.rn
FROM ranked
WHERE s.id = ranked.id;
