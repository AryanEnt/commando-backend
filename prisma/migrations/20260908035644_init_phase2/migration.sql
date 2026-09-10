-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('SUPER_ADMIN', 'TEAM_LEAD', 'COMMANDO_EXECUTIVE', 'SALES_EXECUTIVE', 'SALES_SUPPORT_EXECUTIVE');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXITED');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('SUBMITTED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SwotSource" AS ENUM ('TEAM_LEAD', 'COMMANDO', 'SALES_EXECUTIVE');

-- CreateEnum
CREATE TYPE "WeeklyReviewStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "EisenhowerCategory" AS ENUM ('DO_FIRST', 'SCHEDULE', 'DELEGATE', 'ELIMINATE');

-- CreateEnum
CREATE TYPE "EisenhowerTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActionItemStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED', 'REPLACED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FeedbackSource" AS ENUM ('TEAM_LEAD', 'COMMANDO');

-- CreateEnum
CREATE TYPE "PerformanceSource" AS ENUM ('TEAM_LEAD', 'COMMANDO');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('TEAM_LEAD', 'SALES_EXECUTIVE', 'SALES_SUPPORT_EXECUTIVE', 'MEMBER');

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" "RoleCode" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "roleId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleInTeam" "MembershipRole" NOT NULL DEFAULT 'MEMBER',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesExecutiveProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "employeeCode" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesExecutiveProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesSupportLink" (
    "id" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT NOT NULL,
    "salesSupportUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesSupportLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandoAssignment" (
    "id" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT NOT NULL,
    "commandoUserId" TEXT NOT NULL,
    "teamLeadUserId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "completionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommandoAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT NOT NULL,
    "teamLeadUserId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "commandoUserId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "profileName" TEXT NOT NULL,
    "whySalesIsDown" TEXT NOT NULL,
    "whatIsTheGap" TEXT NOT NULL,
    "detailedSummaryOfGap" TEXT NOT NULL,
    "supportAlreadyProvided" TEXT NOT NULL,
    "supportRequiredFromCommando" TEXT NOT NULL,
    "recommendationFocus" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'SUBMITTED',
    "acknowledgedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwotAnalysis" (
    "id" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "source" "SwotSource" NOT NULL,
    "strength" TEXT NOT NULL,
    "weakness" TEXT NOT NULL,
    "opportunity" TEXT NOT NULL,
    "threat" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SwotAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyLog" (
    "id" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "activityTypeId" TEXT NOT NULL,
    "sessionTitle" TEXT NOT NULL,
    "observation" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyReview" (
    "id" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "commandoUserId" TEXT NOT NULL,
    "teamLeadUserId" TEXT NOT NULL,
    "weekLabel" TEXT NOT NULL,
    "weekStartDate" DATE NOT NULL,
    "meetingDate" TIMESTAMP(3) NOT NULL,
    "performanceSummary" TEXT NOT NULL,
    "whatWentWell" TEXT NOT NULL,
    "improvement" TEXT NOT NULL,
    "nextWeekAction" TEXT NOT NULL,
    "status" "WeeklyReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyReviewAttendee" (
    "id" TEXT NOT NULL,
    "weeklyReviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyReviewAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncEvaluation" (
    "id" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT NOT NULL,
    "salesSupportUserId" TEXT NOT NULL,
    "salesSupportLinkId" TEXT,
    "assignmentId" TEXT,
    "issue" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EisenhowerTask" (
    "id" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "month" DATE NOT NULL,
    "category" "EisenhowerCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "EisenhowerTaskStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EisenhowerTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringChecklistItem" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveMonitoringRecord" (
    "id" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "categoryId" TEXT NOT NULL,
    "observation" TEXT,
    "createdById" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveMonitoringRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringChecklistResponse" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "checklistItemId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringChecklistResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ActionItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "replacesId" TEXT,
    "createdById" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "source" "FeedbackSource" NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceEvaluation" (
    "id" TEXT NOT NULL,
    "salesExecutiveProfileId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "source" "PerformanceSource" NOT NULL,
    "summary" TEXT,
    "verdict" TEXT,
    "rating" DECIMAL(3,2),
    "createdById" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceScore" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "metricCode" TEXT NOT NULL,
    "metricLabel" TEXT NOT NULL,
    "scoreValue" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Team_archivedAt_idx" ON "Team"("archivedAt");

-- CreateIndex
CREATE INDEX "Team_name_idx" ON "Team"("name");

-- CreateIndex
CREATE INDEX "TeamMembership_teamId_isActive_idx" ON "TeamMembership"("teamId", "isActive");

-- CreateIndex
CREATE INDEX "TeamMembership_userId_isActive_idx" ON "TeamMembership"("userId", "isActive");

-- CreateIndex
CREATE INDEX "TeamMembership_startedAt_idx" ON "TeamMembership"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalesExecutiveProfile_userId_key" ON "SalesExecutiveProfile"("userId");

-- CreateIndex
CREATE INDEX "SalesExecutiveProfile_teamId_idx" ON "SalesExecutiveProfile"("teamId");

-- CreateIndex
CREATE INDEX "SalesExecutiveProfile_archivedAt_idx" ON "SalesExecutiveProfile"("archivedAt");

-- CreateIndex
CREATE INDEX "SalesExecutiveProfile_displayName_idx" ON "SalesExecutiveProfile"("displayName");

-- CreateIndex
CREATE INDEX "SalesSupportLink_salesExecutiveProfileId_isActive_idx" ON "SalesSupportLink"("salesExecutiveProfileId", "isActive");

-- CreateIndex
CREATE INDEX "SalesSupportLink_salesSupportUserId_isActive_idx" ON "SalesSupportLink"("salesSupportUserId", "isActive");

-- CreateIndex
CREATE INDEX "CommandoAssignment_salesExecutiveProfileId_status_idx" ON "CommandoAssignment"("salesExecutiveProfileId", "status");

-- CreateIndex
CREATE INDEX "CommandoAssignment_commandoUserId_status_idx" ON "CommandoAssignment"("commandoUserId", "status");

-- CreateIndex
CREATE INDEX "CommandoAssignment_teamLeadUserId_status_idx" ON "CommandoAssignment"("teamLeadUserId", "status");

-- CreateIndex
CREATE INDEX "CommandoAssignment_teamId_idx" ON "CommandoAssignment"("teamId");

-- CreateIndex
CREATE INDEX "CommandoAssignment_startedAt_idx" ON "CommandoAssignment"("startedAt");

-- CreateIndex
CREATE INDEX "CommandoAssignment_endedAt_idx" ON "CommandoAssignment"("endedAt");

-- CreateIndex
CREATE INDEX "Referral_salesExecutiveProfileId_idx" ON "Referral"("salesExecutiveProfileId");

-- CreateIndex
CREATE INDEX "Referral_teamLeadUserId_idx" ON "Referral"("teamLeadUserId");

-- CreateIndex
CREATE INDEX "Referral_commandoUserId_idx" ON "Referral"("commandoUserId");

-- CreateIndex
CREATE INDEX "Referral_teamId_idx" ON "Referral"("teamId");

-- CreateIndex
CREATE INDEX "Referral_assignmentId_idx" ON "Referral"("assignmentId");

-- CreateIndex
CREATE INDEX "Referral_status_idx" ON "Referral"("status");

-- CreateIndex
CREATE INDEX "Referral_createdAt_idx" ON "Referral"("createdAt");

-- CreateIndex
CREATE INDEX "SwotAnalysis_salesExecutiveProfileId_source_idx" ON "SwotAnalysis"("salesExecutiveProfileId", "source");

-- CreateIndex
CREATE INDEX "SwotAnalysis_teamId_idx" ON "SwotAnalysis"("teamId");

-- CreateIndex
CREATE INDEX "SwotAnalysis_assignmentId_idx" ON "SwotAnalysis"("assignmentId");

-- CreateIndex
CREATE INDEX "SwotAnalysis_createdById_idx" ON "SwotAnalysis"("createdById");

-- CreateIndex
CREATE INDEX "SwotAnalysis_createdAt_idx" ON "SwotAnalysis"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityType_code_key" ON "ActivityType"("code");

-- CreateIndex
CREATE INDEX "ActivityType_isActive_idx" ON "ActivityType"("isActive");

-- CreateIndex
CREATE INDEX "DailyLog_salesExecutiveProfileId_idx" ON "DailyLog"("salesExecutiveProfileId");

-- CreateIndex
CREATE INDEX "DailyLog_assignmentId_idx" ON "DailyLog"("assignmentId");

-- CreateIndex
CREATE INDEX "DailyLog_activityTypeId_idx" ON "DailyLog"("activityTypeId");

-- CreateIndex
CREATE INDEX "DailyLog_createdById_idx" ON "DailyLog"("createdById");

-- CreateIndex
CREATE INDEX "DailyLog_loggedAt_idx" ON "DailyLog"("loggedAt");

-- CreateIndex
CREATE INDEX "WeeklyReview_salesExecutiveProfileId_idx" ON "WeeklyReview"("salesExecutiveProfileId");

-- CreateIndex
CREATE INDEX "WeeklyReview_assignmentId_idx" ON "WeeklyReview"("assignmentId");

-- CreateIndex
CREATE INDEX "WeeklyReview_commandoUserId_idx" ON "WeeklyReview"("commandoUserId");

-- CreateIndex
CREATE INDEX "WeeklyReview_teamLeadUserId_idx" ON "WeeklyReview"("teamLeadUserId");

-- CreateIndex
CREATE INDEX "WeeklyReview_status_idx" ON "WeeklyReview"("status");

-- CreateIndex
CREATE INDEX "WeeklyReview_weekStartDate_idx" ON "WeeklyReview"("weekStartDate");

-- CreateIndex
CREATE INDEX "WeeklyReview_meetingDate_idx" ON "WeeklyReview"("meetingDate");

-- CreateIndex
CREATE INDEX "WeeklyReview_createdById_idx" ON "WeeklyReview"("createdById");

-- CreateIndex
CREATE INDEX "WeeklyReviewAttendee_userId_idx" ON "WeeklyReviewAttendee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyReviewAttendee_weeklyReviewId_userId_key" ON "WeeklyReviewAttendee"("weeklyReviewId", "userId");

-- CreateIndex
CREATE INDEX "SyncEvaluation_salesExecutiveProfileId_idx" ON "SyncEvaluation"("salesExecutiveProfileId");

-- CreateIndex
CREATE INDEX "SyncEvaluation_salesSupportUserId_idx" ON "SyncEvaluation"("salesSupportUserId");

-- CreateIndex
CREATE INDEX "SyncEvaluation_assignmentId_idx" ON "SyncEvaluation"("assignmentId");

-- CreateIndex
CREATE INDEX "SyncEvaluation_createdById_idx" ON "SyncEvaluation"("createdById");

-- CreateIndex
CREATE INDEX "SyncEvaluation_createdAt_idx" ON "SyncEvaluation"("createdAt");

-- CreateIndex
CREATE INDEX "EisenhowerTask_salesExecutiveProfileId_month_idx" ON "EisenhowerTask"("salesExecutiveProfileId", "month");

-- CreateIndex
CREATE INDEX "EisenhowerTask_assignmentId_idx" ON "EisenhowerTask"("assignmentId");

-- CreateIndex
CREATE INDEX "EisenhowerTask_category_idx" ON "EisenhowerTask"("category");

-- CreateIndex
CREATE INDEX "EisenhowerTask_status_idx" ON "EisenhowerTask"("status");

-- CreateIndex
CREATE INDEX "EisenhowerTask_createdById_idx" ON "EisenhowerTask"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringCategory_code_key" ON "MonitoringCategory"("code");

-- CreateIndex
CREATE INDEX "MonitoringCategory_isActive_idx" ON "MonitoringCategory"("isActive");

-- CreateIndex
CREATE INDEX "MonitoringCategory_sortOrder_idx" ON "MonitoringCategory"("sortOrder");

-- CreateIndex
CREATE INDEX "MonitoringChecklistItem_categoryId_isActive_idx" ON "MonitoringChecklistItem"("categoryId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringChecklistItem_categoryId_code_key" ON "MonitoringChecklistItem"("categoryId", "code");

-- CreateIndex
CREATE INDEX "LiveMonitoringRecord_salesExecutiveProfileId_idx" ON "LiveMonitoringRecord"("salesExecutiveProfileId");

-- CreateIndex
CREATE INDEX "LiveMonitoringRecord_assignmentId_idx" ON "LiveMonitoringRecord"("assignmentId");

-- CreateIndex
CREATE INDEX "LiveMonitoringRecord_categoryId_idx" ON "LiveMonitoringRecord"("categoryId");

-- CreateIndex
CREATE INDEX "LiveMonitoringRecord_createdById_idx" ON "LiveMonitoringRecord"("createdById");

-- CreateIndex
CREATE INDEX "LiveMonitoringRecord_observedAt_idx" ON "LiveMonitoringRecord"("observedAt");

-- CreateIndex
CREATE INDEX "MonitoringChecklistResponse_checklistItemId_idx" ON "MonitoringChecklistResponse"("checklistItemId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringChecklistResponse_recordId_checklistItemId_key" ON "MonitoringChecklistResponse"("recordId", "checklistItemId");

-- CreateIndex
CREATE INDEX "ActionItem_salesExecutiveProfileId_status_idx" ON "ActionItem"("salesExecutiveProfileId", "status");

-- CreateIndex
CREATE INDEX "ActionItem_assignmentId_idx" ON "ActionItem"("assignmentId");

-- CreateIndex
CREATE INDEX "ActionItem_createdById_idx" ON "ActionItem"("createdById");

-- CreateIndex
CREATE INDEX "ActionItem_dueDate_idx" ON "ActionItem"("dueDate");

-- CreateIndex
CREATE INDEX "ActionItem_replacesId_idx" ON "ActionItem"("replacesId");

-- CreateIndex
CREATE INDEX "Feedback_salesExecutiveProfileId_source_idx" ON "Feedback"("salesExecutiveProfileId", "source");

-- CreateIndex
CREATE INDEX "Feedback_assignmentId_idx" ON "Feedback"("assignmentId");

-- CreateIndex
CREATE INDEX "Feedback_createdById_idx" ON "Feedback"("createdById");

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- CreateIndex
CREATE INDEX "PerformanceEvaluation_salesExecutiveProfileId_source_idx" ON "PerformanceEvaluation"("salesExecutiveProfileId", "source");

-- CreateIndex
CREATE INDEX "PerformanceEvaluation_assignmentId_idx" ON "PerformanceEvaluation"("assignmentId");

-- CreateIndex
CREATE INDEX "PerformanceEvaluation_createdById_idx" ON "PerformanceEvaluation"("createdById");

-- CreateIndex
CREATE INDEX "PerformanceEvaluation_evaluatedAt_idx" ON "PerformanceEvaluation"("evaluatedAt");

-- CreateIndex
CREATE INDEX "PerformanceScore_evaluationId_idx" ON "PerformanceScore"("evaluationId");

-- CreateIndex
CREATE INDEX "PerformanceScore_metricCode_idx" ON "PerformanceScore"("metricCode");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_idx" ON "Notification"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesExecutiveProfile" ADD CONSTRAINT "SalesExecutiveProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesExecutiveProfile" ADD CONSTRAINT "SalesExecutiveProfile_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesSupportLink" ADD CONSTRAINT "SalesSupportLink_salesExecutiveProfileId_fkey" FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesSupportLink" ADD CONSTRAINT "SalesSupportLink_salesSupportUserId_fkey" FOREIGN KEY ("salesSupportUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandoAssignment" ADD CONSTRAINT "CommandoAssignment_salesExecutiveProfileId_fkey" FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandoAssignment" ADD CONSTRAINT "CommandoAssignment_commandoUserId_fkey" FOREIGN KEY ("commandoUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandoAssignment" ADD CONSTRAINT "CommandoAssignment_teamLeadUserId_fkey" FOREIGN KEY ("teamLeadUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandoAssignment" ADD CONSTRAINT "CommandoAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_salesExecutiveProfileId_fkey" FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_teamLeadUserId_fkey" FOREIGN KEY ("teamLeadUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_commandoUserId_fkey" FOREIGN KEY ("commandoUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CommandoAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwotAnalysis" ADD CONSTRAINT "SwotAnalysis_salesExecutiveProfileId_fkey" FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwotAnalysis" ADD CONSTRAINT "SwotAnalysis_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwotAnalysis" ADD CONSTRAINT "SwotAnalysis_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_salesExecutiveProfileId_fkey" FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CommandoAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReview" ADD CONSTRAINT "WeeklyReview_salesExecutiveProfileId_fkey" FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReview" ADD CONSTRAINT "WeeklyReview_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CommandoAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReview" ADD CONSTRAINT "WeeklyReview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReviewAttendee" ADD CONSTRAINT "WeeklyReviewAttendee_weeklyReviewId_fkey" FOREIGN KEY ("weeklyReviewId") REFERENCES "WeeklyReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReviewAttendee" ADD CONSTRAINT "WeeklyReviewAttendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncEvaluation" ADD CONSTRAINT "SyncEvaluation_salesExecutiveProfileId_fkey" FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncEvaluation" ADD CONSTRAINT "SyncEvaluation_salesSupportUserId_fkey" FOREIGN KEY ("salesSupportUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncEvaluation" ADD CONSTRAINT "SyncEvaluation_salesSupportLinkId_fkey" FOREIGN KEY ("salesSupportLinkId") REFERENCES "SalesSupportLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncEvaluation" ADD CONSTRAINT "SyncEvaluation_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CommandoAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncEvaluation" ADD CONSTRAINT "SyncEvaluation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EisenhowerTask" ADD CONSTRAINT "EisenhowerTask_salesExecutiveProfileId_fkey" FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EisenhowerTask" ADD CONSTRAINT "EisenhowerTask_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CommandoAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EisenhowerTask" ADD CONSTRAINT "EisenhowerTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringChecklistItem" ADD CONSTRAINT "MonitoringChecklistItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MonitoringCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveMonitoringRecord" ADD CONSTRAINT "LiveMonitoringRecord_salesExecutiveProfileId_fkey" FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveMonitoringRecord" ADD CONSTRAINT "LiveMonitoringRecord_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CommandoAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveMonitoringRecord" ADD CONSTRAINT "LiveMonitoringRecord_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MonitoringCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveMonitoringRecord" ADD CONSTRAINT "LiveMonitoringRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringChecklistResponse" ADD CONSTRAINT "MonitoringChecklistResponse_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "LiveMonitoringRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringChecklistResponse" ADD CONSTRAINT "MonitoringChecklistResponse_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "MonitoringChecklistItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_salesExecutiveProfileId_fkey" FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CommandoAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "ActionItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_salesExecutiveProfileId_fkey" FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CommandoAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceEvaluation" ADD CONSTRAINT "PerformanceEvaluation_salesExecutiveProfileId_fkey" FOREIGN KEY ("salesExecutiveProfileId") REFERENCES "SalesExecutiveProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceEvaluation" ADD CONSTRAINT "PerformanceEvaluation_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CommandoAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceEvaluation" ADD CONSTRAINT "PerformanceEvaluation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceScore" ADD CONSTRAINT "PerformanceScore_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "PerformanceEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
