-- Screenshot / image attachments on Sales Support tasks (Cloudflare R2 keys).
CREATE TABLE "SupportTaskAttachment" (
    "id" TEXT NOT NULL,
    "supportTaskId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "caption" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTaskAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportTaskAttachment_supportTaskId_createdAt_idx" ON "SupportTaskAttachment"("supportTaskId", "createdAt");
CREATE INDEX "SupportTaskAttachment_uploadedById_idx" ON "SupportTaskAttachment"("uploadedById");
CREATE INDEX "SupportTaskAttachment_storageKey_idx" ON "SupportTaskAttachment"("storageKey");

ALTER TABLE "SupportTaskAttachment" ADD CONSTRAINT "SupportTaskAttachment_supportTaskId_fkey" FOREIGN KEY ("supportTaskId") REFERENCES "SupportTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTaskAttachment" ADD CONSTRAINT "SupportTaskAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
