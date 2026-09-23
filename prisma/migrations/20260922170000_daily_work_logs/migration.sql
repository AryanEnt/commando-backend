-- Executive Daily Work Logs (SE + SSE self-reported work)
-- Separate from Commando DailyLog coaching journals.

CREATE TABLE "DailyWorkLog" (
    "id" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT,
    "activity" TEXT NOT NULL,
    "notes" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyWorkLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DailyWorkLog_authorUserId_loggedAt_idx"
  ON "DailyWorkLog"("authorUserId", "loggedAt");

CREATE INDEX "DailyWorkLog_salesExecutiveProfileId_loggedAt_idx"
  ON "DailyWorkLog"("salesExecutiveProfileId", "loggedAt");

CREATE INDEX "DailyWorkLog_loggedAt_idx"
  ON "DailyWorkLog"("loggedAt");

ALTER TABLE "DailyWorkLog"
  ADD CONSTRAINT "DailyWorkLog_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyWorkLog"
  ADD CONSTRAINT "DailyWorkLog_salesExecutiveProfileId_fkey"
  FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
