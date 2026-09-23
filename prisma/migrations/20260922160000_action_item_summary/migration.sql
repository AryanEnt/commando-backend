-- Optional summary on Action Items (SE / coach narrative).
ALTER TABLE "ActionItem" ADD COLUMN IF NOT EXISTS "summary" TEXT;
