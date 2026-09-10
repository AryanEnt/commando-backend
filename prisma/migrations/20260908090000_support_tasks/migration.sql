-- CreateEnum
CREATE TYPE "SupportTaskPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "SupportTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "SupportTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "SupportTaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "SupportTaskStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completionNotes" TEXT,
    "salesExecutiveProfileId" TEXT NOT NULL,
    "salesSupportUserId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "assignmentId" TEXT,
    "salesSupportLinkId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportTask_salesSupportUserId_status_idx" ON "SupportTask"("salesSupportUserId", "status");

-- CreateIndex
CREATE INDEX "SupportTask_salesExecutiveProfileId_status_idx" ON "SupportTask"("salesExecutiveProfileId", "status");

-- CreateIndex
CREATE INDEX "SupportTask_assignedById_idx" ON "SupportTask"("assignedById");

-- CreateIndex
CREATE INDEX "SupportTask_createdById_idx" ON "SupportTask"("createdById");

-- CreateIndex
CREATE INDEX "SupportTask_assignmentId_idx" ON "SupportTask"("assignmentId");

-- CreateIndex
CREATE INDEX "SupportTask_dueDate_idx" ON "SupportTask"("dueDate");

-- CreateIndex
CREATE INDEX "SupportTask_createdAt_idx" ON "SupportTask"("createdAt");

-- AddForeignKey
ALTER TABLE "SupportTask" ADD CONSTRAINT "SupportTask_salesExecutiveProfileId_fkey" FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTask" ADD CONSTRAINT "SupportTask_salesSupportUserId_fkey" FOREIGN KEY ("salesSupportUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTask" ADD CONSTRAINT "SupportTask_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTask" ADD CONSTRAINT "SupportTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTask" ADD CONSTRAINT "SupportTask_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CommandoAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTask" ADD CONSTRAINT "SupportTask_salesSupportLinkId_fkey" FOREIGN KEY ("salesSupportLinkId") REFERENCES "SalesSupportLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
