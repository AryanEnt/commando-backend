-- CreateEnum
CREATE TYPE "SupportRoleAssignmentStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "SupportRoleAssignment" (
    "id" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT NOT NULL,
    "salesSupportUserId" TEXT NOT NULL,
    "salesSupportLinkId" TEXT,
    "assignmentId" TEXT,
    "primaryResponsibility" TEXT NOT NULL,
    "status" "SupportRoleAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "replacesId" TEXT,
    "createdById" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportRoleShouldDoItem" (
    "id" TEXT NOT NULL,
    "roleAssignmentId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportRoleShouldDoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportRoleShouldNotDoItem" (
    "id" TEXT NOT NULL,
    "roleAssignmentId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportRoleShouldNotDoItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportRoleAssignment_salesExecutiveProfileId_status_idx" ON "SupportRoleAssignment"("salesExecutiveProfileId", "status");

-- CreateIndex
CREATE INDEX "SupportRoleAssignment_salesSupportUserId_status_idx" ON "SupportRoleAssignment"("salesSupportUserId", "status");

-- CreateIndex
CREATE INDEX "SupportRoleAssignment_salesSupportLinkId_idx" ON "SupportRoleAssignment"("salesSupportLinkId");

-- CreateIndex
CREATE INDEX "SupportRoleAssignment_assignmentId_idx" ON "SupportRoleAssignment"("assignmentId");

-- CreateIndex
CREATE INDEX "SupportRoleAssignment_createdById_idx" ON "SupportRoleAssignment"("createdById");

-- CreateIndex
CREATE INDEX "SupportRoleAssignment_replacesId_idx" ON "SupportRoleAssignment"("replacesId");

-- CreateIndex
CREATE INDEX "SupportRoleAssignment_createdAt_idx" ON "SupportRoleAssignment"("createdAt");

-- CreateIndex
CREATE INDEX "SupportRoleShouldDoItem_roleAssignmentId_sortOrder_idx" ON "SupportRoleShouldDoItem"("roleAssignmentId", "sortOrder");

-- CreateIndex
CREATE INDEX "SupportRoleShouldNotDoItem_roleAssignmentId_sortOrder_idx" ON "SupportRoleShouldNotDoItem"("roleAssignmentId", "sortOrder");

-- AddForeignKey
ALTER TABLE "SupportRoleAssignment" ADD CONSTRAINT "SupportRoleAssignment_salesExecutiveProfileId_fkey" FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRoleAssignment" ADD CONSTRAINT "SupportRoleAssignment_salesSupportUserId_fkey" FOREIGN KEY ("salesSupportUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRoleAssignment" ADD CONSTRAINT "SupportRoleAssignment_salesSupportLinkId_fkey" FOREIGN KEY ("salesSupportLinkId") REFERENCES "SalesSupportLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRoleAssignment" ADD CONSTRAINT "SupportRoleAssignment_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CommandoAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRoleAssignment" ADD CONSTRAINT "SupportRoleAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRoleAssignment" ADD CONSTRAINT "SupportRoleAssignment_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "SupportRoleAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRoleShouldDoItem" ADD CONSTRAINT "SupportRoleShouldDoItem_roleAssignmentId_fkey" FOREIGN KEY ("roleAssignmentId") REFERENCES "SupportRoleAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRoleShouldNotDoItem" ADD CONSTRAINT "SupportRoleShouldNotDoItem_roleAssignmentId_fkey" FOREIGN KEY ("roleAssignmentId") REFERENCES "SupportRoleAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
