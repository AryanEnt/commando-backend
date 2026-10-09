-- AlterTable
ALTER TABLE "SwotAnalysis" ADD COLUMN     "correctedAt" TIMESTAMP(3),
ADD COLUMN     "correctedById" TEXT,
ADD COLUMN     "correctionReason" TEXT;

-- AddForeignKey
ALTER TABLE "SwotAnalysis" ADD CONSTRAINT "SwotAnalysis_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
