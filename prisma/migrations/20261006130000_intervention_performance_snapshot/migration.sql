-- Team Lead performance snapshot (SE + linked SSE) and optional supporting evidence,
-- captured when the Team Lead approves a Commando intervention request.

CREATE TYPE "SnapshotPerformanceLevel" AS ENUM ('STRONG', 'AVERAGE', 'NEEDS_ATTENTION');

CREATE TYPE "SnapshotTrend" AS ENUM ('IMPROVING', 'STABLE', 'DECLINING');

CREATE TABLE "InterventionPerformanceSnapshot" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "subjectRole" "RoleCode" NOT NULL,
    "subjectName" TEXT NOT NULL,
    "overallPerformance" "SnapshotPerformanceLevel" NOT NULL,
    "trend" "SnapshotTrend" NOT NULL,
    "insights" TEXT[],
    "note" TEXT NOT NULL,
    "salesAchieved" DECIMAL(14,2),
    "salesTarget" DECIMAL(14,2),
    "achievementPct" DECIMAL(7,2),
    "periodKind" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterventionPerformanceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InterventionSnapshotEvidence" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterventionSnapshotEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InterventionPerformanceSnapshot_subjectUserId_idx" ON "InterventionPerformanceSnapshot"("subjectUserId");
CREATE INDEX "InterventionPerformanceSnapshot_createdById_idx" ON "InterventionPerformanceSnapshot"("createdById");
CREATE UNIQUE INDEX "InterventionPerformanceSnapshot_referralId_subjectUserId_key" ON "InterventionPerformanceSnapshot"("referralId", "subjectUserId");
CREATE INDEX "InterventionSnapshotEvidence_referralId_createdAt_idx" ON "InterventionSnapshotEvidence"("referralId", "createdAt");
CREATE INDEX "InterventionSnapshotEvidence_uploadedById_idx" ON "InterventionSnapshotEvidence"("uploadedById");

ALTER TABLE "InterventionPerformanceSnapshot" ADD CONSTRAINT "InterventionPerformanceSnapshot_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InterventionPerformanceSnapshot" ADD CONSTRAINT "InterventionPerformanceSnapshot_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterventionPerformanceSnapshot" ADD CONSTRAINT "InterventionPerformanceSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterventionSnapshotEvidence" ADD CONSTRAINT "InterventionSnapshotEvidence_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InterventionSnapshotEvidence" ADD CONSTRAINT "InterventionSnapshotEvidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
