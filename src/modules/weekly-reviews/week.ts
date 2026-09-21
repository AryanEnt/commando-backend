/** Calendar-week helpers (Monday–Sunday, UTC date-only). */

/** Parse YYYY-MM-DD as UTC midnight. */
export function parseYmd(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error("Invalid date");
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday (UTC) of the week containing the given date. */
export function mondayOfWeek(d: Date): Date {
  const utc = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = utc.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  utc.setUTCDate(utc.getUTCDate() + diff);
  return utc;
}

export function sundayOfWeek(monday: Date): Date {
  const end = new Date(monday);
  end.setUTCDate(end.getUTCDate() + 6);
  return end;
}

export function formatWeekLabel(monday: Date, sunday: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  };
  const yOpts: Intl.DateTimeFormatOptions = { ...opts, year: "numeric" };
  const a = monday.toLocaleDateString("en-US", opts);
  const b = sunday.toLocaleDateString("en-US", yOpts);
  return `Week of ${a} – ${b}`;
}

export function resolveWeekBounds(weekStartYmd?: string) {
  const base = weekStartYmd
    ? parseYmd(weekStartYmd)
    : mondayOfWeek(new Date());
  const start = mondayOfWeek(base);
  const end = sundayOfWeek(start);
  return {
    start,
    end,
    startYmd: toYmd(start),
    endYmd: toYmd(end),
    label: formatWeekLabel(start, end),
  };
}

/** Exclusive end = Monday of next week (for DateTime ranges). */
export function nextMonday(monday: Date): Date {
  const n = new Date(monday);
  n.setUTCDate(n.getUTCDate() + 7);
  return n;
}
