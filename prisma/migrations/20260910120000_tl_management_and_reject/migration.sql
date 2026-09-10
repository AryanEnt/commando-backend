-- AlterEnum
ALTER TYPE "ReferralStatus" ADD VALUE 'REJECTED';

-- AlterTable: Team Lead weekly reviews may have no Commando
ALTER TABLE "WeeklyReview" ALTER COLUMN "commandoUserId" DROP NOT NULL;

-- AlterTable: Commando request rejection
ALTER TABLE "Referral" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
ALTER TABLE "Referral" ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3);
