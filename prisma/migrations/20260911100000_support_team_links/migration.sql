-- AlterTable SalesSupportLink
ALTER TABLE "SalesSupportLink" ADD COLUMN "responsibilityType" TEXT,
ADD COLUMN "note" TEXT,
ADD COLUMN "assignedById" TEXT,
ADD COLUMN "endedById" TEXT;

-- CreateIndex
CREATE INDEX "SalesSupportLink_assignedById_idx" ON "SalesSupportLink"("assignedById");

-- CreateIndex
CREATE INDEX "SalesSupportLink_endedById_idx" ON "SalesSupportLink"("endedById");

-- AddForeignKey
ALTER TABLE "SalesSupportLink" ADD CONSTRAINT "SalesSupportLink_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesSupportLink" ADD CONSTRAINT "SalesSupportLink_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "MonitoringSupportInvolvement" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "salesSupportUserId" TEXT NOT NULL,
    "salesSupportLinkId" TEXT,
    "displayNameSnapshot" TEXT NOT NULL,
    "responsibilityTypeSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringSupportInvolvement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonitoringSupportInvolvement_recordId_idx" ON "MonitoringSupportInvolvement"("recordId");

-- CreateIndex
CREATE INDEX "MonitoringSupportInvolvement_salesSupportUserId_idx" ON "MonitoringSupportInvolvement"("salesSupportUserId");

-- CreateIndex
CREATE INDEX "MonitoringSupportInvolvement_salesSupportLinkId_idx" ON "MonitoringSupportInvolvement"("salesSupportLinkId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringSupportInvolvement_recordId_salesSupportUserId_key" ON "MonitoringSupportInvolvement"("recordId", "salesSupportUserId");

-- AddForeignKey
ALTER TABLE "MonitoringSupportInvolvement" ADD CONSTRAINT "MonitoringSupportInvolvement_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "LiveMonitoringRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringSupportInvolvement" ADD CONSTRAINT "MonitoringSupportInvolvement_salesSupportUserId_fkey" FOREIGN KEY ("salesSupportUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringSupportInvolvement" ADD CONSTRAINT "MonitoringSupportInvolvement_salesSupportLinkId_fkey" FOREIGN KEY ("salesSupportLinkId") REFERENCES "SalesSupportLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
