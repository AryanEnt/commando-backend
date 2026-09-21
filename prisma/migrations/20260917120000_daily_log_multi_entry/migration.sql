-- Daily Log multi-entry: container + entries + DRAFT/SUBMITTED

CREATE TYPE "DailyLogStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- New entry table (dailyLogId temporarily nullable until backfill)
CREATE TABLE "DailyLogEntry" (
    "id" TEXT NOT NULL,
    "dailyLogId" TEXT NOT NULL,
    "activityTypeId" TEXT NOT NULL,
    "sessionTitle" TEXT NOT NULL,
    "observation" TEXT NOT NULL,
    "evidence" TEXT,
    "seResponse" TEXT,
    "coachingGiven" TEXT,
    "expectedChange" TEXT,
    "followUp" TEXT,
    "urgency" "EventUrgency",
    "importance" "EventImportance",
    "eisenhowerCategory" "EisenhowerCategory",
    "eisenhowerTaskId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyLogEntry_pkey" PRIMARY KEY ("id")
);

-- Add container columns to DailyLog
ALTER TABLE "DailyLog" ADD COLUMN "logDate" DATE;
ALTER TABLE "DailyLog" ADD COLUMN "status" "DailyLogStatus" NOT NULL DEFAULT 'SUBMITTED';
ALTER TABLE "DailyLog" ADD COLUMN "submittedAt" TIMESTAMP(3);

-- Backfill logDate from loggedAt (local-calendar-style: use date part of timestamp)
UPDATE "DailyLog"
SET "logDate" = DATE("loggedAt"),
    "submittedAt" = COALESCE("submittedAt", "createdAt");

-- Move each legacy session row into an entry on the same DailyLog id (temporary 1:1)
INSERT INTO "DailyLogEntry" (
  "id", "dailyLogId", "activityTypeId", "sessionTitle", "observation",
  "evidence", "seResponse", "coachingGiven", "expectedChange", "followUp",
  "sortOrder", "loggedAt", "createdById", "createdAt", "updatedAt"
)
SELECT
  'mig_' || d."id",
  d."id",
  d."activityTypeId",
  d."sessionTitle",
  d."observation",
  d."evidence",
  d."seResponse",
  d."coachingGiven",
  d."expectedChange",
  d."followUp",
  0,
  d."loggedAt",
  d."createdById",
  d."createdAt",
  d."updatedAt"
FROM "DailyLog" d;

-- Merge duplicate days: pick keeper = min(id) per (profile, logDate)
CREATE TEMP TABLE "_daily_log_keepers" AS
SELECT DISTINCT ON ("salesExecutiveProfileId", "logDate")
  "id" AS "keeperId",
  "salesExecutiveProfileId",
  "logDate"
FROM "DailyLog"
ORDER BY "salesExecutiveProfileId", "logDate", "createdAt" ASC, "id" ASC;

-- Re-point entries from duplicate logs to keeper
UPDATE "DailyLogEntry" e
SET "dailyLogId" = k."keeperId"
FROM "DailyLog" d
JOIN "_daily_log_keepers" k
  ON k."salesExecutiveProfileId" = d."salesExecutiveProfileId"
 AND k."logDate" = d."logDate"
WHERE e."dailyLogId" = d."id"
  AND d."id" <> k."keeperId";

-- Drop duplicate DailyLog shells
DELETE FROM "DailyLog" d
USING "_daily_log_keepers" k
WHERE d."salesExecutiveProfileId" = k."salesExecutiveProfileId"
  AND d."logDate" = k."logDate"
  AND d."id" <> k."keeperId";

DROP TABLE "_daily_log_keepers";

-- Drop legacy session columns / FK to ActivityType on DailyLog
ALTER TABLE "DailyLog" DROP CONSTRAINT IF EXISTS "DailyLog_activityTypeId_fkey";
ALTER TABLE "DailyLog" DROP COLUMN "activityTypeId";
ALTER TABLE "DailyLog" DROP COLUMN "sessionTitle";
ALTER TABLE "DailyLog" DROP COLUMN "observation";
ALTER TABLE "DailyLog" DROP COLUMN "evidence";
ALTER TABLE "DailyLog" DROP COLUMN "seResponse";
ALTER TABLE "DailyLog" DROP COLUMN "coachingGiven";
ALTER TABLE "DailyLog" DROP COLUMN "expectedChange";
ALTER TABLE "DailyLog" DROP COLUMN "followUp";
ALTER TABLE "DailyLog" DROP COLUMN "loggedAt";

ALTER TABLE "DailyLog" ALTER COLUMN "logDate" SET NOT NULL;

CREATE UNIQUE INDEX "DailyLog_salesExecutiveProfileId_logDate_key"
  ON "DailyLog"("salesExecutiveProfileId", "logDate");

CREATE INDEX "DailyLog_logDate_idx" ON "DailyLog"("logDate");
CREATE INDEX "DailyLog_status_idx" ON "DailyLog"("status");

CREATE UNIQUE INDEX "DailyLogEntry_eisenhowerTaskId_key" ON "DailyLogEntry"("eisenhowerTaskId");
CREATE INDEX "DailyLogEntry_dailyLogId_idx" ON "DailyLogEntry"("dailyLogId");
CREATE INDEX "DailyLogEntry_activityTypeId_idx" ON "DailyLogEntry"("activityTypeId");
CREATE INDEX "DailyLogEntry_createdById_idx" ON "DailyLogEntry"("createdById");
CREATE INDEX "DailyLogEntry_loggedAt_idx" ON "DailyLogEntry"("loggedAt");

ALTER TABLE "DailyLogEntry"
  ADD CONSTRAINT "DailyLogEntry_dailyLogId_fkey"
  FOREIGN KEY ("dailyLogId") REFERENCES "DailyLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DailyLogEntry"
  ADD CONSTRAINT "DailyLogEntry_activityTypeId_fkey"
  FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyLogEntry"
  ADD CONSTRAINT "DailyLogEntry_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
