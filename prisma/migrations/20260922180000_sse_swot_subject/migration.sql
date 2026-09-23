-- SSE SWOT: nullable SE profile, optional subjectUserId, optional teamId

-- Add enum value for SSE Self SWOT
ALTER TYPE "SwotSource" ADD VALUE IF NOT EXISTS 'SALES_SUPPORT_EXECUTIVE';

-- Drop FK temporarily to relax nullability
ALTER TABLE "SwotAnalysis"
  DROP CONSTRAINT IF EXISTS "SwotAnalysis_salesExecutiveProfileId_fkey";

ALTER TABLE "SwotAnalysis"
  DROP CONSTRAINT IF EXISTS "SwotAnalysis_teamId_fkey";

ALTER TABLE "SwotAnalysis"
  ALTER COLUMN "salesExecutiveProfileId" DROP NOT NULL;

ALTER TABLE "SwotAnalysis"
  ALTER COLUMN "teamId" DROP NOT NULL;

ALTER TABLE "SwotAnalysis"
  ADD COLUMN IF NOT EXISTS "subjectUserId" TEXT;

CREATE INDEX IF NOT EXISTS "SwotAnalysis_subjectUserId_source_idx"
  ON "SwotAnalysis"("subjectUserId", "source");

CREATE INDEX IF NOT EXISTS "SwotAnalysis_subjectUserId_source_versionNumber_idx"
  ON "SwotAnalysis"("subjectUserId", "source", "versionNumber");

ALTER TABLE "SwotAnalysis"
  ADD CONSTRAINT "SwotAnalysis_salesExecutiveProfileId_fkey"
  FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SwotAnalysis"
  ADD CONSTRAINT "SwotAnalysis_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SwotAnalysis"
  ADD CONSTRAINT "SwotAnalysis_subjectUserId_fkey"
  FOREIGN KEY ("subjectUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one subject reference
ALTER TABLE "SwotAnalysis"
  DROP CONSTRAINT IF EXISTS "SwotAnalysis_subject_xor_check";

ALTER TABLE "SwotAnalysis"
  ADD CONSTRAINT "SwotAnalysis_subject_xor_check"
  CHECK (
    ("salesExecutiveProfileId" IS NOT NULL AND "subjectUserId" IS NULL)
    OR
    ("salesExecutiveProfileId" IS NULL AND "subjectUserId" IS NOT NULL)
  );
