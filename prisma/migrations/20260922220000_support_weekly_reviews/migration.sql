-- Weekly reviews for Sales Support (executiveUserId), XOR with SE profile.

ALTER TABLE "WeeklyReview" ALTER COLUMN "salesExecutiveProfileId" DROP NOT NULL;
ALTER TABLE "WeeklyReview" ADD COLUMN IF NOT EXISTS "executiveUserId" TEXT;

ALTER TABLE "WeeklyReview"
  ADD CONSTRAINT "WeeklyReview_executiveUserId_fkey"
  FOREIGN KEY ("executiveUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "WeeklyReview_executiveUserId_idx"
  ON "WeeklyReview"("executiveUserId");

ALTER TABLE "WeeklyReview"
  ADD CONSTRAINT "WeeklyReview_subject_xor"
  CHECK (
    ("salesExecutiveProfileId" IS NOT NULL AND "executiveUserId" IS NULL)
    OR ("salesExecutiveProfileId" IS NULL AND "executiveUserId" IS NOT NULL)
  );
