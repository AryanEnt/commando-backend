-- SE workspace activity events (event-based coaching / intervention log)

CREATE TYPE "WorkspaceEventType" AS ENUM (
  'MONITORING',
  'COACHING',
  'FEEDBACK',
  'DAILY_LOG',
  'REVIEW',
  'ACTION',
  'SUPPORT',
  'INTERVENTION',
  'SWOT',
  'GENERAL'
);

CREATE TYPE "EventUrgency" AS ENUM ('URGENT', 'NOT_URGENT');

CREATE TYPE "EventImportance" AS ENUM ('IMPORTANT', 'NOT_IMPORTANT');

CREATE TYPE "WorkspaceEventStatus" AS ENUM (
  'OPEN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
);

CREATE TABLE "WorkspaceEvent" (
  "id" TEXT NOT NULL,
  "salesExecutiveProfileId" TEXT NOT NULL,
  "assignmentId" TEXT,
  "type" "WorkspaceEventType" NOT NULL,
  "title" TEXT NOT NULL,
  "notes" TEXT,
  "nextAction" TEXT,
  "urgency" "EventUrgency" NOT NULL DEFAULT 'NOT_URGENT',
  "importance" "EventImportance" NOT NULL DEFAULT 'IMPORTANT',
  "status" "WorkspaceEventStatus" NOT NULL DEFAULT 'COMPLETED',
  "eisenhowerCategory" "EisenhowerCategory" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "createdById" TEXT NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkspaceEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkspaceEvent_salesExecutiveProfileId_occurredAt_idx" ON "WorkspaceEvent"("salesExecutiveProfileId", "occurredAt");
CREATE INDEX "WorkspaceEvent_salesExecutiveProfileId_type_idx" ON "WorkspaceEvent"("salesExecutiveProfileId", "type");
CREATE INDEX "WorkspaceEvent_salesExecutiveProfileId_eisenhowerCategory_idx" ON "WorkspaceEvent"("salesExecutiveProfileId", "eisenhowerCategory");
CREATE INDEX "WorkspaceEvent_assignmentId_idx" ON "WorkspaceEvent"("assignmentId");
CREATE INDEX "WorkspaceEvent_createdById_idx" ON "WorkspaceEvent"("createdById");
CREATE INDEX "WorkspaceEvent_sourceType_sourceId_idx" ON "WorkspaceEvent"("sourceType", "sourceId");
CREATE INDEX "WorkspaceEvent_archivedAt_idx" ON "WorkspaceEvent"("archivedAt");

ALTER TABLE "WorkspaceEvent" ADD CONSTRAINT "WorkspaceEvent_salesExecutiveProfileId_fkey" FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkspaceEvent" ADD CONSTRAINT "WorkspaceEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CommandoAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspaceEvent" ADD CONSTRAINT "WorkspaceEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
