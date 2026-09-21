-- AlterTable
ALTER TABLE "WeeklyReview" ADD COLUMN "roomName" TEXT,
ADD COLUMN "meetingTime" TEXT,
ADD COLUMN "meetingMinutesKey" TEXT,
ADD COLUMN "meetingMinutesFileName" TEXT,
ADD COLUMN "meetingMinutesContentType" TEXT,
ADD COLUMN "meetingMinutesSize" INTEGER,
ADD COLUMN "meetingMinutesUploadedAt" TIMESTAMP(3);
