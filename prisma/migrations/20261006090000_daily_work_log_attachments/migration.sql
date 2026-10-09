-- Screenshots / images on executive Daily Work Log entries

CREATE TABLE "DailyWorkLogAttachment" (
    "id" TEXT NOT NULL,
    "logId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyWorkLogAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DailyWorkLogAttachment_logId_createdAt_idx"
  ON "DailyWorkLogAttachment"("logId", "createdAt");

ALTER TABLE "DailyWorkLogAttachment"
  ADD CONSTRAINT "DailyWorkLogAttachment_logId_fkey"
  FOREIGN KEY ("logId") REFERENCES "DailyWorkLog"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
