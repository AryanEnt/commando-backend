-- Extend SupportTaskStatus for accept / block workflow
ALTER TYPE "SupportTaskStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED';
ALTER TYPE "SupportTaskStatus" ADD VALUE IF NOT EXISTS 'BLOCKED';

-- SupportTask detail / block fields
ALTER TABLE "SupportTask" ADD COLUMN IF NOT EXISTS "purpose" TEXT;
ALTER TABLE "SupportTask" ADD COLUMN IF NOT EXISTS "blockedReason" TEXT;
ALTER TABLE "SupportTask" ADD COLUMN IF NOT EXISTS "blockedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupportTask_salesSupportLinkId_idx" ON "SupportTask"("salesSupportLinkId");

-- CreateTable
CREATE TABLE IF NOT EXISTS "SupportTaskShouldDoItem" (
    "id" TEXT NOT NULL,
    "supportTaskId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTaskShouldDoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SupportTaskShouldNotDoItem" (
    "id" TEXT NOT NULL,
    "supportTaskId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTaskShouldNotDoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SupportTaskProgressNote" (
    "id" TEXT NOT NULL,
    "supportTaskId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTaskProgressNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SupportTaskAssignmentEvent" (
    "id" TEXT NOT NULL,
    "supportTaskId" TEXT NOT NULL,
    "fromSupportUserId" TEXT,
    "toSupportUserId" TEXT NOT NULL,
    "salesSupportLinkId" TEXT,
    "reason" TEXT,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTaskAssignmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupportTaskShouldDoItem_supportTaskId_sortOrder_idx" ON "SupportTaskShouldDoItem"("supportTaskId", "sortOrder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupportTaskShouldNotDoItem_supportTaskId_sortOrder_idx" ON "SupportTaskShouldNotDoItem"("supportTaskId", "sortOrder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupportTaskProgressNote_supportTaskId_createdAt_idx" ON "SupportTaskProgressNote"("supportTaskId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupportTaskProgressNote_createdById_idx" ON "SupportTaskProgressNote"("createdById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupportTaskAssignmentEvent_supportTaskId_createdAt_idx" ON "SupportTaskAssignmentEvent"("supportTaskId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupportTaskAssignmentEvent_changedById_idx" ON "SupportTaskAssignmentEvent"("changedById");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "SupportTaskShouldDoItem" ADD CONSTRAINT "SupportTaskShouldDoItem_supportTaskId_fkey" FOREIGN KEY ("supportTaskId") REFERENCES "SupportTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SupportTaskShouldNotDoItem" ADD CONSTRAINT "SupportTaskShouldNotDoItem_supportTaskId_fkey" FOREIGN KEY ("supportTaskId") REFERENCES "SupportTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SupportTaskProgressNote" ADD CONSTRAINT "SupportTaskProgressNote_supportTaskId_fkey" FOREIGN KEY ("supportTaskId") REFERENCES "SupportTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SupportTaskProgressNote" ADD CONSTRAINT "SupportTaskProgressNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SupportTaskAssignmentEvent" ADD CONSTRAINT "SupportTaskAssignmentEvent_supportTaskId_fkey" FOREIGN KEY ("supportTaskId") REFERENCES "SupportTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SupportTaskAssignmentEvent" ADD CONSTRAINT "SupportTaskAssignmentEvent_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
