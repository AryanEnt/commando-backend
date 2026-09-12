-- SE-specific monitoring checklist customization + session response snapshots

CREATE TABLE "SeMonitoringChecklistItem" (
    "id" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceTemplateItemId" TEXT,
    "label" TEXT,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeMonitoringChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SeMonitoringChecklistItem_salesExecutiveProfileId_categoryId_isActive_idx"
  ON "SeMonitoringChecklistItem"("salesExecutiveProfileId", "categoryId", "isActive");
CREATE INDEX "SeMonitoringChecklistItem_sourceTemplateItemId_idx"
  ON "SeMonitoringChecklistItem"("sourceTemplateItemId");
CREATE INDEX "SeMonitoringChecklistItem_createdById_idx"
  ON "SeMonitoringChecklistItem"("createdById");

ALTER TABLE "SeMonitoringChecklistItem"
  ADD CONSTRAINT "SeMonitoringChecklistItem_salesExecutiveProfileId_fkey"
  FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SeMonitoringChecklistItem"
  ADD CONSTRAINT "SeMonitoringChecklistItem_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "MonitoringCategory"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SeMonitoringChecklistItem"
  ADD CONSTRAINT "SeMonitoringChecklistItem_sourceTemplateItemId_fkey"
  FOREIGN KEY ("sourceTemplateItemId") REFERENCES "MonitoringChecklistItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SeMonitoringChecklistItem"
  ADD CONSTRAINT "SeMonitoringChecklistItem_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Snapshot fields on responses (historical integrity)
ALTER TABLE "MonitoringChecklistResponse"
  ADD COLUMN "seChecklistItemId" TEXT,
  ADD COLUMN "labelSnapshot" TEXT,
  ADD COLUMN "descriptionSnapshot" TEXT,
  ADD COLUMN "codeSnapshot" TEXT,
  ADD COLUMN "sortOrderSnapshot" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'TEMPLATE';

-- Backfill snapshots from live template items before relaxing FK
UPDATE "MonitoringChecklistResponse" AS r
SET
  "labelSnapshot" = i."label",
  "codeSnapshot" = i."code",
  "sortOrderSnapshot" = i."sortOrder",
  "sourceType" = 'TEMPLATE'
FROM "MonitoringChecklistItem" AS i
WHERE r."checklistItemId" = i."id"
  AND r."labelSnapshot" IS NULL;

-- Safety fallback for any orphan rows
UPDATE "MonitoringChecklistResponse"
SET "labelSnapshot" = COALESCE("labelSnapshot", 'Checklist item')
WHERE "labelSnapshot" IS NULL;

ALTER TABLE "MonitoringChecklistResponse"
  ALTER COLUMN "labelSnapshot" SET NOT NULL;

-- Drop unique that blocked optional checklistItemId / custom items
ALTER TABLE "MonitoringChecklistResponse"
  DROP CONSTRAINT IF EXISTS "MonitoringChecklistResponse_recordId_checklistItemId_key";

ALTER TABLE "MonitoringChecklistResponse"
  ALTER COLUMN "checklistItemId" DROP NOT NULL;

CREATE INDEX "MonitoringChecklistResponse_seChecklistItemId_idx"
  ON "MonitoringChecklistResponse"("seChecklistItemId");
CREATE INDEX "MonitoringChecklistResponse_recordId_idx"
  ON "MonitoringChecklistResponse"("recordId");

ALTER TABLE "MonitoringChecklistResponse"
  ADD CONSTRAINT "MonitoringChecklistResponse_seChecklistItemId_fkey"
  FOREIGN KEY ("seChecklistItemId") REFERENCES "SeMonitoringChecklistItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
