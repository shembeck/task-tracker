const TIMEZONE = process.env.APP_TIMEZONE || "America/Los_Angeles";

/** Local calendar parts for an instant in the app timezone. */
function zonedParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: get("weekday"),
  };
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function toISODate(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Parse YYYY-MM-DD as a pure calendar date (no timezone shift). */
export function parseISODate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y, month: m, day: d };
}

function addDaysISO(iso: string, days: number) {
  const { year, month, day } = parseISODate(iso);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return toISODate(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

const WEEKDAY_OFFSET: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

/** Monday of the week containing `date`, as YYYY-MM-DD in APP_TIMEZONE. */
export function weekStartFor(date: Date = new Date()): string {
  const { year, month, day, weekday } = zonedParts(date);
  const offset = WEEKDAY_OFFSET[weekday] ?? 0;
  const today = toISODate(year, month, day);
  return addDaysISO(today, -offset);
}

export function currentWeekStart() {
  return weekStartFor(new Date());
}

export function addWeeks(weekStart: string, weeks: number) {
  return addDaysISO(weekStart, weeks * 7);
}

export function weekEnd(weekStart: string) {
  return addDaysISO(weekStart, 6);
}

export function compareISODates(a: string, b: string) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export type WeekKind = "past" | "current" | "future";

export function weekKind(weekStart: string, now = new Date()): WeekKind {
  const current = weekStartFor(now);
  const cmp = compareISODates(weekStart, current);
  if (cmp < 0) return "past";
  if (cmp > 0) return "future";
  return "current";
}

export function formatWeekLabel(weekStart: string) {
  const start = parseISODate(weekStart);
  const end = parseISODate(weekEnd(weekStart));
  const fmt = (y: number, m: number, d: number) => {
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };
  const startLabel = fmt(start.year, start.month, start.day);
  const endLabel = fmt(end.year, end.month, end.day);
  const year =
    start.year === end.year ? String(start.year) : `${start.year}–${end.year}`;
  return `${startLabel} – ${endLabel}, ${year}`;
}

export function isValidWeekStart(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parseISODate(value);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Calendar date as UTC — Monday === 1
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 1;
}

/** Normalize any YYYY-MM-DD to that week's Monday. */
export function normalizeToWeekStart(iso: string) {
  const { year, month, day } = parseISODate(iso);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = utc.getUTCDay(); // 0 Sun … 6 Sat
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return addDaysISO(iso, -offset);
}

export { TIMEZONE };
