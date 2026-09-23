-- Separate Executive SWOT (person) vs Profile SWOT (workspace).
-- subjectType + executiveUserId replace subjectUserId semantics for person subjects.

-- 1) Enum
DO $$ BEGIN
  CREATE TYPE "SwotSubjectType" AS ENUM ('EXECUTIVE', 'PROFILE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2) Add subjectType (temporary default for backfill)
ALTER TABLE "SwotAnalysis"
  ADD COLUMN IF NOT EXISTS "subjectType" "SwotSubjectType";

-- 3) Rename subjectUserId → executiveUserId (if present)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'SwotAnalysis' AND column_name = 'subjectUserId'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'SwotAnalysis' AND column_name = 'executiveUserId'
  ) THEN
    ALTER TABLE "SwotAnalysis" RENAME COLUMN "subjectUserId" TO "executiveUserId";
  END IF;
END $$;

ALTER TABLE "SwotAnalysis"
  ADD COLUMN IF NOT EXISTS "executiveUserId" TEXT;

-- Drop old XOR check if present
ALTER TABLE "SwotAnalysis" DROP CONSTRAINT IF EXISTS "SwotAnalysis_subject_xor";
ALTER TABLE "SwotAnalysis" DROP CONSTRAINT IF EXISTS "SwotAnalysis_subject_xor_check";

-- 4) Classify existing rows

-- Already person-scoped (former SSE subjectUserId / executiveUserId set)
UPDATE "SwotAnalysis"
SET "subjectType" = 'EXECUTIVE'
WHERE "executiveUserId" IS NOT NULL
  AND "subjectType" IS NULL;

-- Intervention / management-packet Team Lead SWOT → PROFILE
-- Heuristic: TEAM_LEAD SWOT created near a referral's informationProvidedAt for same profile
UPDATE "SwotAnalysis" s
SET "subjectType" = 'PROFILE'
FROM "Referral" r
WHERE s."subjectType" IS NULL
  AND s."source" = 'TEAM_LEAD'
  AND s."salesExecutiveProfileId" IS NOT NULL
  AND s."salesExecutiveProfileId" = r."salesExecutiveProfileId"
  AND r."informationProvidedAt" IS NOT NULL
  AND s."createdAt" >= (r."informationProvidedAt" - INTERVAL '2 minutes')
  AND s."createdAt" <= (r."informationProvidedAt" + INTERVAL '2 minutes');

-- Also treat TEAM_LEAD SWOT that already had assignmentId at create-time
-- and sits on a referral that provided information as PROFILE (broader safety net)
UPDATE "SwotAnalysis" s
SET "subjectType" = 'PROFILE'
WHERE s."subjectType" IS NULL
  AND s."source" = 'TEAM_LEAD'
  AND s."salesExecutiveProfileId" IS NOT NULL
  AND s."assignmentId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "Referral" r
    WHERE r."salesExecutiveProfileId" = s."salesExecutiveProfileId"
      AND r."informationProvidedAt" IS NOT NULL
      AND r."assignmentId" = s."assignmentId"
  );

-- Remaining profile-tied rows that are person assessments → EXECUTIVE
-- Copy person id from profile.userId and clear profile FK
UPDATE "SwotAnalysis" s
SET
  "subjectType" = 'EXECUTIVE',
  "executiveUserId" = p."userId",
  "salesExecutiveProfileId" = NULL
FROM "SalesExecutiveProfile" p
WHERE s."subjectType" IS NULL
  AND s."salesExecutiveProfileId" IS NOT NULL
  AND s."salesExecutiveProfileId" = p."id"
  AND s."source" IN ('SALES_EXECUTIVE', 'SALES_SUPPORT_EXECUTIVE', 'TEAM_LEAD', 'COMMANDO');

-- Any leftover with profile id only → PROFILE (safe default for unknown TL packet rows)
UPDATE "SwotAnalysis"
SET "subjectType" = 'PROFILE'
WHERE "subjectType" IS NULL
  AND "salesExecutiveProfileId" IS NOT NULL
  AND "executiveUserId" IS NULL;

-- Any leftover with executiveUserId only
UPDATE "SwotAnalysis"
SET "subjectType" = 'EXECUTIVE'
WHERE "subjectType" IS NULL
  AND "executiveUserId" IS NOT NULL;

-- Fail closed: should not happen; mark as EXECUTIVE if somehow still null with no refs
-- (will be caught by NOT NULL + check below after cleanup)

-- 5) Enforce NOT NULL subjectType
ALTER TABLE "SwotAnalysis"
  ALTER COLUMN "subjectType" SET NOT NULL;

-- 6) Indexes
DROP INDEX IF EXISTS "SwotAnalysis_subjectUserId_source_idx";
DROP INDEX IF EXISTS "SwotAnalysis_subjectUserId_source_versionNumber_idx";

CREATE INDEX IF NOT EXISTS "SwotAnalysis_executiveUserId_source_idx"
  ON "SwotAnalysis"("executiveUserId", "source");

CREATE INDEX IF NOT EXISTS "SwotAnalysis_executiveUserId_source_versionNumber_idx"
  ON "SwotAnalysis"("executiveUserId", "source", "versionNumber");

CREATE INDEX IF NOT EXISTS "SwotAnalysis_subjectType_salesExecutiveProfileId_source_idx"
  ON "SwotAnalysis"("subjectType", "salesExecutiveProfileId", "source");

CREATE INDEX IF NOT EXISTS "SwotAnalysis_subjectType_executiveUserId_source_idx"
  ON "SwotAnalysis"("subjectType", "executiveUserId", "source");

-- 7) FK for executiveUserId (rename constraint if needed)
ALTER TABLE "SwotAnalysis" DROP CONSTRAINT IF EXISTS "SwotAnalysis_subjectUserId_fkey";

DO $$ BEGIN
  ALTER TABLE "SwotAnalysis"
    ADD CONSTRAINT "SwotAnalysis_executiveUserId_fkey"
    FOREIGN KEY ("executiveUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 8) Subject XOR check
ALTER TABLE "SwotAnalysis" DROP CONSTRAINT IF EXISTS "SwotAnalysis_subject_type_xor";
ALTER TABLE "SwotAnalysis"
  ADD CONSTRAINT "SwotAnalysis_subject_type_xor" CHECK (
    (
      "subjectType" = 'EXECUTIVE'
      AND "executiveUserId" IS NOT NULL
      AND "salesExecutiveProfileId" IS NULL
    )
    OR
    (
      "subjectType" = 'PROFILE'
      AND "salesExecutiveProfileId" IS NOT NULL
      AND "executiveUserId" IS NULL
    )
  );
