-- AlterEnum
CREATE TYPE "ReferralInitiatedBy" AS ENUM ('TEAM_LEAD', 'COMMANDO');

-- AlterTable
ALTER TABLE "Referral" ADD COLUMN "initiatedBy" "ReferralInitiatedBy" NOT NULL DEFAULT 'TEAM_LEAD';
ALTER TABLE "Referral" ADD COLUMN "requestReason" TEXT;
ALTER TABLE "Referral" ADD COLUMN "informationProvidedAt" TIMESTAMP(3);
