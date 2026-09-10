-- Phase 25: one active Commando per SE + intervention fields

CREATE TYPE "InterventionOutcome" AS ENUM (
  'IMPROVED',
  'PARTIALLY_IMPROVED',
  'NOT_IMPROVED',
  'CONTINUED_MONITORING',
  'OTHER'
);

CREATE TYPE "InterventionGoalStatus" AS ENUM (
  'OPEN',
  'IN_PROGRESS',
  'MET',
  'NOT_MET'
);

ALTER TABLE "CommandoAssignment"
  ADD COLUMN "outcome" "InterventionOutcome",
  ADD COLUMN "initialProblem" TEXT,
  ADD COLUMN "interventionProvided" TEXT,
  ADD COLUMN "improvementObserved" TEXT,
  ADD COLUMN "remainingGaps" TEXT,
  ADD COLUMN "finalCommandoAssessment" TEXT,
  ADD COLUMN "finalTeamLeadView" TEXT,
  ADD COLUMN "transferredFromId" TEXT,
  ADD COLUMN "transferReason" TEXT;

ALTER TABLE "CommandoAssignment"
  ADD CONSTRAINT "CommandoAssignment_transferredFromId_fkey"
  FOREIGN KEY ("transferredFromId") REFERENCES "CommandoAssignment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "commando_assignment_one_active"
  ON "CommandoAssignment" ("salesExecutiveProfileId")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "Referral"
  ADD COLUMN "priority1" TEXT,
  ADD COLUMN "priority2" TEXT,
  ADD COLUMN "priority3" TEXT,
  ADD COLUMN "acknowledgedById" TEXT,
  ADD COLUMN "acknowledgementNote" TEXT;

ALTER TABLE "Referral"
  ADD CONSTRAINT "Referral_acknowledgedById_fkey"
  FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Referral_acknowledgedById_idx" ON "Referral"("acknowledgedById");

ALTER TABLE "DailyLog"
  ADD COLUMN "evidence" TEXT,
  ADD COLUMN "seResponse" TEXT,
  ADD COLUMN "coachingGiven" TEXT,
  ADD COLUMN "expectedChange" TEXT,
  ADD COLUMN "followUp" TEXT;

CREATE TABLE "InterventionGoal" (
  "id" TEXT NOT NULL,
  "salesExecutiveProfileId" TEXT NOT NULL,
  "assignmentId" TEXT,
  "title" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "targetDate" DATE,
  "status" "InterventionGoalStatus" NOT NULL DEFAULT 'OPEN',
  "progressNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InterventionGoal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InterventionGoal_salesExecutiveProfileId_status_idx"
  ON "InterventionGoal"("salesExecutiveProfileId", "status");
CREATE INDEX "InterventionGoal_assignmentId_idx" ON "InterventionGoal"("assignmentId");
CREATE INDEX "InterventionGoal_ownerUserId_idx" ON "InterventionGoal"("ownerUserId");

ALTER TABLE "InterventionGoal"
  ADD CONSTRAINT "InterventionGoal_salesExecutiveProfileId_fkey"
  FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterventionGoal"
  ADD CONSTRAINT "InterventionGoal_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "CommandoAssignment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InterventionGoal"
  ADD CONSTRAINT "InterventionGoal_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "RecordAcknowledgement" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "salesExecutiveProfileId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RecordAcknowledgement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecordAcknowledgement_userId_entityType_entityId_key"
  ON "RecordAcknowledgement"("userId", "entityType", "entityId");
CREATE INDEX "RecordAcknowledgement_salesExecutiveProfileId_idx"
  ON "RecordAcknowledgement"("salesExecutiveProfileId");
CREATE INDEX "RecordAcknowledgement_entityType_entityId_idx"
  ON "RecordAcknowledgement"("entityType", "entityId");

ALTER TABLE "RecordAcknowledgement"
  ADD CONSTRAINT "RecordAcknowledgement_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecordAcknowledgement"
  ADD CONSTRAINT "RecordAcknowledgement_salesExecutiveProfileId_fkey"
  FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
