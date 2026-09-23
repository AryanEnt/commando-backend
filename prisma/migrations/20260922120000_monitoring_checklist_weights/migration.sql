-- SE-specific monitoring checklist weights + historical weight/score snapshots
-- NOTE: Index names must stay under Postgres' 63-char limit (avoid truncated collisions).

ALTER TABLE "MonitoringChecklistItem"
  ADD COLUMN "defaultWeight" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "SeMonitoringChecklistItem"
  ADD COLUMN "weight" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "LiveMonitoringRecord"
  ADD COLUMN "scorePercent" DOUBLE PRECISION;

ALTER TABLE "MonitoringChecklistResponse"
  ADD COLUMN "weightSnapshot" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "SeMonitoringChecklistWeight" (
    "id" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "sourceTemplateItemId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeMonitoringChecklistWeight_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeMonWeight_profile_cat_tpl_key"
  ON "SeMonitoringChecklistWeight"("salesExecutiveProfileId", "categoryId", "sourceTemplateItemId");

CREATE INDEX "SeMonWeight_profile_cat_idx"
  ON "SeMonitoringChecklistWeight"("salesExecutiveProfileId", "categoryId");

CREATE INDEX "SeMonWeight_tpl_idx"
  ON "SeMonitoringChecklistWeight"("sourceTemplateItemId");

ALTER TABLE "SeMonitoringChecklistWeight"
  ADD CONSTRAINT "SeMonitoringChecklistWeight_salesExecutiveProfileId_fkey"
  FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SeMonitoringChecklistWeight"
  ADD CONSTRAINT "SeMonitoringChecklistWeight_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "MonitoringCategory"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SeMonitoringChecklistWeight"
  ADD CONSTRAINT "SeMonitoringChecklistWeight_sourceTemplateItemId_fkey"
  FOREIGN KEY ("sourceTemplateItemId") REFERENCES "MonitoringChecklistItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Evenly distribute default weights across existing active template items per category
WITH ranked AS (
  SELECT
    i."id",
    i."categoryId",
    ROW_NUMBER() OVER (
      PARTITION BY i."categoryId"
      ORDER BY i."sortOrder" ASC, i."label" ASC
    ) AS rn,
    COUNT(*) OVER (PARTITION BY i."categoryId") AS cnt
  FROM "MonitoringChecklistItem" i
  WHERE i."isActive" = true AND i."archivedAt" IS NULL
),
weights AS (
  SELECT
    "id",
    (100 / "cnt") + CASE WHEN "rn" <= (100 % "cnt") THEN 1 ELSE 0 END AS w
  FROM ranked
  WHERE "cnt" > 0
)
UPDATE "MonitoringChecklistItem" AS i
SET "defaultWeight" = w."w"
FROM weights w
WHERE i."id" = w."id";
