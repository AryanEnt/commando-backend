-- Allow DailyLog / Feedback subjects to be Sales Support (executiveUserId)
-- XOR with salesExecutiveProfileId (same pattern as SWOT Executive subjects).

ALTER TABLE "DailyLog" ALTER COLUMN "salesExecutiveProfileId" DROP NOT NULL;
ALTER TABLE "DailyLog" ADD COLUMN IF NOT EXISTS "executiveUserId" TEXT;

ALTER TABLE "DailyLog"
  ADD CONSTRAINT "DailyLog_executiveUserId_fkey"
  FOREIGN KEY ("executiveUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "DailyLog_executiveUserId_logDate_key"
  ON "DailyLog"("executiveUserId", "logDate");

CREATE INDEX IF NOT EXISTS "DailyLog_executiveUserId_idx"
  ON "DailyLog"("executiveUserId");

ALTER TABLE "DailyLog"
  ADD CONSTRAINT "DailyLog_subject_xor"
  CHECK (
    ("salesExecutiveProfileId" IS NOT NULL AND "executiveUserId" IS NULL)
    OR ("salesExecutiveProfileId" IS NULL AND "executiveUserId" IS NOT NULL)
  );

ALTER TABLE "Feedback" ALTER COLUMN "salesExecutiveProfileId" DROP NOT NULL;
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "executiveUserId" TEXT;

ALTER TABLE "Feedback"
  ADD CONSTRAINT "Feedback_executiveUserId_fkey"
  FOREIGN KEY ("executiveUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Feedback_executiveUserId_source_idx"
  ON "Feedback"("executiveUserId", "source");

ALTER TABLE "Feedback"
  ADD CONSTRAINT "Feedback_subject_xor"
  CHECK (
    ("salesExecutiveProfileId" IS NOT NULL AND "executiveUserId" IS NULL)
    OR ("salesExecutiveProfileId" IS NULL AND "executiveUserId" IS NOT NULL)
  );
