-- CreateTable
CREATE TABLE "DailyLogEntryAttachment" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "caption" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyLogEntryAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyLogEntryAttachment_entryId_createdAt_idx" ON "DailyLogEntryAttachment"("entryId", "createdAt");

-- CreateIndex
CREATE INDEX "DailyLogEntryAttachment_uploadedById_idx" ON "DailyLogEntryAttachment"("uploadedById");

-- CreateIndex
CREATE INDEX "DailyLogEntryAttachment_storageKey_idx" ON "DailyLogEntryAttachment"("storageKey");

-- AddForeignKey
ALTER TABLE "DailyLogEntryAttachment" ADD CONSTRAINT "DailyLogEntryAttachment_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "DailyLogEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLogEntryAttachment" ADD CONSTRAINT "DailyLogEntryAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
