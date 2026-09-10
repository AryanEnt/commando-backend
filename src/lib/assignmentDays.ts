/** Inclusive calendar days from start through end (or today if still active). */
export function totalDaysUnderCommando(
  startedAt: Date,
  endedAt: Date | null | undefined,
  now: Date = new Date(),
): number {
  const end = endedAt ?? now;
  const startUtc = Date.UTC(
    startedAt.getUTCFullYear(),
    startedAt.getUTCMonth(),
    startedAt.getUTCDate(),
  );
  const endUtc = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate(),
  );
  return Math.max(0, Math.floor((endUtc - startUtc) / 86_400_000) + 1);
}
