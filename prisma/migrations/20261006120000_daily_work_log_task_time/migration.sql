-- Task start / end time and computed total on executive Daily Work Log entries

ALTER TABLE "DailyWorkLog"
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "endedAt" TIMESTAMP(3),
  ADD COLUMN "durationMinutes" INTEGER;

ALTER TABLE "DailyWorkLog"
  ADD CONSTRAINT "DailyWorkLog_task_time_check"
  CHECK (
    ("startedAt" IS NULL AND "endedAt" IS NULL AND "durationMinutes" IS NULL)
    OR (
      "startedAt" IS NOT NULL
      AND "endedAt" IS NOT NULL
      AND "endedAt" > "startedAt"
      AND "durationMinutes" IS NOT NULL
      AND "durationMinutes" > 0
    )
  );
