-- Start-of-day commitment an SE / SSE writes before logging Daily Work entries.

CREATE TABLE "DailyWorkCommitment" (
    "id" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT,
    "commitDate" DATE NOT NULL,
    "commitment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyWorkCommitment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyWorkCommitment_authorUserId_commitDate_key"
  ON "DailyWorkCommitment"("authorUserId", "commitDate");

CREATE INDEX "DailyWorkCommitment_salesExecutiveProfileId_commitDate_idx"
  ON "DailyWorkCommitment"("salesExecutiveProfileId", "commitDate");

ALTER TABLE "DailyWorkCommitment"
  ADD CONSTRAINT "DailyWorkCommitment_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyWorkCommitment"
  ADD CONSTRAINT "DailyWorkCommitment_salesExecutiveProfileId_fkey"
  FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
