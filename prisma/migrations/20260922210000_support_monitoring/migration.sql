-- Allow LiveMonitoringRecord / SE checklist subjects to be Sales Support (executiveUserId)
-- XOR with salesExecutiveProfileId (same pattern as DailyLog / Feedback).

-- ─── LiveMonitoringRecord ───────────────────────────────────────────────────
ALTER TABLE "LiveMonitoringRecord" ALTER COLUMN "salesExecutiveProfileId" DROP NOT NULL;
ALTER TABLE "LiveMonitoringRecord" ADD COLUMN IF NOT EXISTS "executiveUserId" TEXT;

ALTER TABLE "LiveMonitoringRecord"
  ADD CONSTRAINT "LiveMonitoringRecord_executiveUserId_fkey"
  FOREIGN KEY ("executiveUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "LiveMonitoringRecord_executiveUserId_idx"
  ON "LiveMonitoringRecord"("executiveUserId");

ALTER TABLE "LiveMonitoringRecord"
  ADD CONSTRAINT "LiveMonitoringRecord_subject_xor"
  CHECK (
    ("salesExecutiveProfileId" IS NOT NULL AND "executiveUserId" IS NULL)
    OR ("salesExecutiveProfileId" IS NULL AND "executiveUserId" IS NOT NULL)
  );

-- ─── SeMonitoringChecklistItem ──────────────────────────────────────────────
ALTER TABLE "SeMonitoringChecklistItem" ALTER COLUMN "salesExecutiveProfileId" DROP NOT NULL;
ALTER TABLE "SeMonitoringChecklistItem" ADD COLUMN IF NOT EXISTS "executiveUserId" TEXT;

ALTER TABLE "SeMonitoringChecklistItem"
  ADD CONSTRAINT "SeMonitoringChecklistItem_executiveUserId_fkey"
  FOREIGN KEY ("executiveUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "SeMonitoringChecklistItem_executiveUserId_categoryId_isActive_idx"
  ON "SeMonitoringChecklistItem"("executiveUserId", "categoryId", "isActive");

ALTER TABLE "SeMonitoringChecklistItem"
  ADD CONSTRAINT "SeMonitoringChecklistItem_subject_xor"
  CHECK (
    ("salesExecutiveProfileId" IS NOT NULL AND "executiveUserId" IS NULL)
    OR ("salesExecutiveProfileId" IS NULL AND "executiveUserId" IS NOT NULL)
  );

-- ─── SeMonitoringChecklistWeight ────────────────────────────────────────────
ALTER TABLE "SeMonitoringChecklistWeight" ALTER COLUMN "salesExecutiveProfileId" DROP NOT NULL;
ALTER TABLE "SeMonitoringChecklistWeight" ADD COLUMN IF NOT EXISTS "executiveUserId" TEXT;

ALTER TABLE "SeMonitoringChecklistWeight"
  ADD CONSTRAINT "SeMonitoringChecklistWeight_executiveUserId_fkey"
  FOREIGN KEY ("executiveUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "SeMonWeight_exec_cat_tpl_key"
  ON "SeMonitoringChecklistWeight"("executiveUserId", "categoryId", "sourceTemplateItemId");

CREATE INDEX IF NOT EXISTS "SeMonWeight_exec_cat_idx"
  ON "SeMonitoringChecklistWeight"("executiveUserId", "categoryId");

ALTER TABLE "SeMonitoringChecklistWeight"
  ADD CONSTRAINT "SeMonitoringChecklistWeight_subject_xor"
  CHECK (
    ("salesExecutiveProfileId" IS NOT NULL AND "executiveUserId" IS NULL)
    OR ("salesExecutiveProfileId" IS NULL AND "executiveUserId" IS NOT NULL)
  );
