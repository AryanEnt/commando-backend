-- Repair incomplete monitoring weight migration (index name collision / partial apply).
-- Safe to run when the original migration was recorded but columns/table are missing.

ALTER TABLE "MonitoringChecklistItem"
  ADD COLUMN IF NOT EXISTS "defaultWeight" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "SeMonitoringChecklistItem"
  ADD COLUMN IF NOT EXISTS "weight" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "LiveMonitoringRecord"
  ADD COLUMN IF NOT EXISTS "scorePercent" DOUBLE PRECISION;

ALTER TABLE "MonitoringChecklistResponse"
  ADD COLUMN IF NOT EXISTS "weightSnapshot" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "SeMonitoringChecklistWeight" (
    "id" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "sourceTemplateItemId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeMonitoringChecklistWeight_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SeMonWeight_profile_cat_tpl_key"
  ON "SeMonitoringChecklistWeight"("salesExecutiveProfileId", "categoryId", "sourceTemplateItemId");

CREATE INDEX IF NOT EXISTS "SeMonWeight_profile_cat_idx"
  ON "SeMonitoringChecklistWeight"("salesExecutiveProfileId", "categoryId");

CREATE INDEX IF NOT EXISTS "SeMonWeight_tpl_idx"
  ON "SeMonitoringChecklistWeight"("sourceTemplateItemId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SeMonitoringChecklistWeight_salesExecutiveProfileId_fkey'
  ) THEN
    ALTER TABLE "SeMonitoringChecklistWeight"
      ADD CONSTRAINT "SeMonitoringChecklistWeight_salesExecutiveProfileId_fkey"
      FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SeMonitoringChecklistWeight_categoryId_fkey'
  ) THEN
    ALTER TABLE "SeMonitoringChecklistWeight"
      ADD CONSTRAINT "SeMonitoringChecklistWeight_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "MonitoringCategory"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SeMonitoringChecklistWeight_sourceTemplateItemId_fkey'
  ) THEN
    ALTER TABLE "SeMonitoringChecklistWeight"
      ADD CONSTRAINT "SeMonitoringChecklistWeight_sourceTemplateItemId_fkey"
      FOREIGN KEY ("sourceTemplateItemId") REFERENCES "MonitoringChecklistItem"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Drop any truncated/colliding leftover index names from the failed first attempt
DROP INDEX IF EXISTS "SeMonitoringChecklistWeight_salesExecutiveProfileId_categoryId_";

-- Evenly distribute defaults only where still all-zero for a category's active items
WITH ranked AS (
  SELECT
    i."id",
    i."categoryId",
    ROW_NUMBER() OVER (
      PARTITION BY i."categoryId"
      ORDER BY i."sortOrder" ASC, i."label" ASC
    ) AS rn,
    COUNT(*) OVER (PARTITION BY i."categoryId") AS cnt,
    SUM(i."defaultWeight") OVER (PARTITION BY i."categoryId") AS weight_sum
  FROM "MonitoringChecklistItem" i
  WHERE i."isActive" = true AND i."archivedAt" IS NULL
),
weights AS (
  SELECT
    "id",
    (100 / "cnt") + CASE WHEN "rn" <= (100 % "cnt") THEN 1 ELSE 0 END AS w
  FROM ranked
  WHERE "cnt" > 0 AND "weight_sum" = 0
)
UPDATE "MonitoringChecklistItem" AS i
SET "defaultWeight" = w."w"
FROM weights w
WHERE i."id" = w."id";
