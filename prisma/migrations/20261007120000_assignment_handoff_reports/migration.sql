-- Commando handoff reports (SE + each linked SSE) required when an assignment is
-- ended, with optional supporting documents. Visible to Team Lead / Super Admin.

CREATE TABLE "AssignmentHandoffReport" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "subjectRole" "RoleCode" NOT NULL,
    "subjectName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "salesAchieved" DECIMAL(14,2),
    "salesTarget" DECIMAL(14,2),
    "achievementPct" DECIMAL(7,2),
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentHandoffReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssignmentHandoffAttachment" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentHandoffAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssignmentHandoffReport_assignmentId_subjectUserId_key" ON "AssignmentHandoffReport"("assignmentId", "subjectUserId");
CREATE INDEX "AssignmentHandoffReport_subjectUserId_idx" ON "AssignmentHandoffReport"("subjectUserId");
CREATE INDEX "AssignmentHandoffReport_createdById_idx" ON "AssignmentHandoffReport"("createdById");
CREATE UNIQUE INDEX "AssignmentHandoffAttachment_storageKey_key" ON "AssignmentHandoffAttachment"("storageKey");
CREATE INDEX "AssignmentHandoffAttachment_reportId_createdAt_idx" ON "AssignmentHandoffAttachment"("reportId", "createdAt");
CREATE INDEX "AssignmentHandoffAttachment_uploadedById_idx" ON "AssignmentHandoffAttachment"("uploadedById");

ALTER TABLE "AssignmentHandoffReport" ADD CONSTRAINT "AssignmentHandoffReport_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CommandoAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentHandoffReport" ADD CONSTRAINT "AssignmentHandoffReport_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssignmentHandoffReport" ADD CONSTRAINT "AssignmentHandoffReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssignmentHandoffAttachment" ADD CONSTRAINT "AssignmentHandoffAttachment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AssignmentHandoffReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentHandoffAttachment" ADD CONSTRAINT "AssignmentHandoffAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
