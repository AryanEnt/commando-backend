-- CreateEnum
CREATE TYPE "DailyWorkEntryKind" AS ENUM ('LOG', 'COMMITMENT');

-- AlterTable
ALTER TABLE "DailyWorkLog" ADD COLUMN     "count" INTEGER,
ADD COLUMN     "kind" "DailyWorkEntryKind" NOT NULL DEFAULT 'LOG',
ADD COLUMN     "listItem" TEXT,
ADD COLUMN     "subItem" TEXT,
ADD COLUMN     "timeRange" TEXT,
ADD COLUMN     "totalAmount" DECIMAL(14,2);

-- CreateIndex
CREATE INDEX "DailyWorkLog_authorUserId_kind_loggedAt_idx" ON "DailyWorkLog"("authorUserId", "kind", "loggedAt");
