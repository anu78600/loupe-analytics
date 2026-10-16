/**
 * Date helpers over "wall-clock UTC" epoch milliseconds. All arithmetic uses
 * UTC getters so a value means exactly the clock time written in the source,
 * whatever the viewer's timezone.
 *
 * Conventions: weeks are ISO (Monday start); a bucket is identified by its
 * start (`truncate`) and its end is inclusive, the last millisecond. UTC has
 * no daylight-saving shifts, so a day is always exactly DAY_MS long. Local
 * getters appear only in `todayWallClock`, on purpose. Used by every stage
 * from parsing to charts and exports.
 */

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

export const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Full weekday names, Monday first, for sentences ("Saturday is the strongest day"). */
export const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export type TimeGrain = "day" | "week" | "month" | "quarter" | "year";
export type DatePart = "dow" | "hour" | "month" | "dom";

/** Wall-clock timestamp from calendar parts. `m` is 1-based (1 = January), unlike Date.UTC. */
export function utc(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): number {
  return Date.UTC(y, m - 1, d, hh, mm, ss);
}

/** Validates a calendar date (rejects 31 Feb etc.). `m` is 1-based; years outside 1000–9999 are rejected too. */
export function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1000 || y > 9999) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

/** Midnight of t's day. Math.floor (not truncation) keeps pre-1970 negative values correct. */
export const startOfDay = (t: number): number => Math.floor(t / DAY_MS) * DAY_MS;

/** ISO week start (Monday). */
export function startOfWeek(t: number): number {
  const day = startOfDay(t);
  const dow = (new Date(day).getUTCDay() + 6) % 7;
  return day - dow * DAY_MS;
}

export function startOfMonth(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function startOfQuarter(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1);
}

export function startOfYear(t: number): number {
  return Date.UTC(new Date(t).getUTCFullYear(), 0, 1);
}

/** Start of the bucket of the given grain that contains t. */
export function truncate(t: number, grain: TimeGrain): number {
  switch (grain) {
    case "day":
      return startOfDay(t);
    case "week":
      return startOfWeek(t);
    case "month":
      return startOfMonth(t);
    case "quarter":
      return startOfQuarter(t);
    case "year":
      return startOfYear(t);
  }
}

export function addDays(t: number, n: number): number {
  return t + n * DAY_MS;
}

/**
 * Adds months, clamping the day to the target month's length
 * (31 Jan + 1 → 28/29 Feb). `n` may be negative; the time of day is kept.
 */
export function addMonths(t: number, n: number): number {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const targetY = y + Math.floor(m / 12);
  const targetM = ((m % 12) + 12) % 12;
  const dim = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
  return Date.UTC(
    targetY,
    targetM,
    Math.min(d.getUTCDate(), dim),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}

/** Start of the following bucket. Expects `t` to be a bucket start (see `truncate`). */
export function nextBucket(t: number, grain: TimeGrain): number {
  switch (grain) {
    case "day":
      return t + DAY_MS;
    case "week":
      return t + 7 * DAY_MS;
    case "month":
      return addMonths(t, 1);
    case "quarter":
      return addMonths(t, 3);
    case "year":
      return addMonths(t, 12);
  }
}

/** Last millisecond of the bucket that starts at t. */
export function endOfBucket(t: number, grain: TimeGrain): number {
  return nextBucket(truncate(t, grain), grain) - 1;
}

/** Last millisecond of t's day (an inclusive range end). */
export function endOfDay(t: number): number {
  return startOfDay(t) + DAY_MS - 1;
}

/**
 * Cyclical calendar component: dow 0 = Monday … 6 = Sunday, hour 0–23,
 * month 0 = January … 11 (0-based, unlike `utc`), dom 1–31.
 */
export function datePart(t: number, part: DatePart): number {
  const d = new Date(t);
  switch (part) {
    case "dow":
      return (d.getUTCDay() + 6) % 7;
    case "hour":
      return d.getUTCHours();
    case "month":
      return d.getUTCMonth();
    case "dom":
      return d.getUTCDate();
  }
}

/** Display label for a `datePart` value, e.g. "Mon", "09:00", "Jan". */
export function datePartLabel(part: DatePart, v: number): string {
  switch (part) {
    case "dow":
      return WEEKDAYS_SHORT[v] ?? String(v);
    case "hour":
      return `${String(v).padStart(2, "0")}:00`;
    case "month":
      return MONTHS_SHORT[v] ?? String(v);
    case "dom":
      return String(v);
  }
}

/** Whole calendar days from a to b (negative when b is earlier); the time of day is ignored. */
export const daysBetween = (a: number, b: number): number => Math.floor(b / DAY_MS) - Math.floor(a / DAY_MS);

const pad2 = (n: number): string => String(n).padStart(2, "0");

export function isoDate(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** "YYYY-MM-DD HH:mm:ss" with a space separator and no zone suffix (the value is wall-clock time). */
export function isoDateTime(t: number): string {
  const d = new Date(t);
  return `${isoDate(t)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/** "HH:mm:ss" of a wall-clock value; for a time-of-day column (ms since midnight) this is the whole value. */
export function isoTime(t: number): string {
  const d = new Date(t);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/** Display label for a bucket start. `long` adds the year to day/week labels and spells out month names. */
export function bucketLabel(t: number, grain: TimeGrain, long = false): string {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (grain) {
    case "day":
      return `${d.getUTCDate()} ${MONTHS_SHORT[m]}${long ? ` ${y}` : ""}`;
    case "week":
      return `Wk of ${d.getUTCDate()} ${MONTHS_SHORT[m]}${long ? ` ${y}` : ""}`;
    case "month":
      // "Oct 2025", never "Oct 25", which reads as the 25th of October.
      return long ? `${MONTHS_LONG[m]} ${y}` : `${MONTHS_SHORT[m]} ${y}`;
    case "quarter":
      return `Q${Math.floor(m / 3) + 1} ${y}`;
    case "year":
      return String(y);
  }
}

/** e.g. "5 Mar 2025". */
export function formatDay(t: number): string {
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Compact range that drops a repeated month/year: "3–17 Jan 2025", "3 Jan – 2 Feb 2025". */
export function formatRange(from: number, to: number): string {
  const a = new Date(from);
  const b = new Date(to);
  if (a.getUTCFullYear() === b.getUTCFullYear()) {
    if (a.getUTCMonth() === b.getUTCMonth()) {
      return `${a.getUTCDate()}–${b.getUTCDate()} ${MONTHS_SHORT[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
    }
    return `${a.getUTCDate()} ${MONTHS_SHORT[a.getUTCMonth()]} – ${formatDay(to)}`;
  }
  return `${formatDay(from)} – ${formatDay(to)}`;
}

/** Picks a readable trend grain for a span so charts hold roughly 12–60 points. */
export function autoGrain(spanDays: number): TimeGrain {
  if (spanDays <= 45) return "day";
  if (spanDays <= 200) return "week";
  if (spanDays <= 365 * 6) return "month";
  if (spanDays <= 365 * 15) return "quarter";
  return "year";
}

/** Today's date as wall-clock UTC midnight, used for "future date" checks. */
export function todayWallClock(): number {
  // Local getters on purpose: "today" is the viewer's calendar date, re-expressed on the wall-clock UTC axis.
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}
