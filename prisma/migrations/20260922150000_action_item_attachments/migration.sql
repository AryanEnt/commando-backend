-- Screenshot / image attachments on Action Items (Cloudflare R2 keys).
CREATE TABLE "ActionItemAttachment" (
    "id" TEXT NOT NULL,
    "actionItemId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "caption" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionItemAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActionItemAttachment_actionItemId_createdAt_idx" ON "ActionItemAttachment"("actionItemId", "createdAt");
CREATE INDEX "ActionItemAttachment_uploadedById_idx" ON "ActionItemAttachment"("uploadedById");
CREATE INDEX "ActionItemAttachment_storageKey_idx" ON "ActionItemAttachment"("storageKey");

ALTER TABLE "ActionItemAttachment" ADD CONSTRAINT "ActionItemAttachment_actionItemId_fkey" FOREIGN KEY ("actionItemId") REFERENCES "ActionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionItemAttachment" ADD CONSTRAINT "ActionItemAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
