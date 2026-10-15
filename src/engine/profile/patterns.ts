/**
 * Value-pattern detectors evaluated on distinct values weighted by frequency.
 *
 * Profiling passes the most frequent distinct values (up to 2,000) with their
 * row counts, so each test runs once per distinct value. Patterns overlap (a
 * six-digit PIN is also "id"-like), so each kind gets an independent share.
 * roles.ts turns these shares into semantic roles.
 */
import type { PatternHit, PatternKind, ValueCount } from "./types";
import { isCountry, isKnownCity, matchIndianState, matchUsState } from "./geo";

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const URL = /^(https?:\/\/|www\.)[^\s]+$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Indian PIN code: six digits, not starting with 0. */
const PINCODE = /^[1-9]\d{5}$/;
/** US ZIP or ZIP+4. */
const ZIP = /^\d{5}(-\d{4})?$/;
/**
 * Code-like token: 3–40 characters of letters, digits and -_/#.:, starting
 * alphanumeric, with at least two digits.
 */
const ID_LIKE = /^(?=.*\d.*\d)[A-Za-z0-9][A-Za-z0-9\-_/#.:]{2,39}$/;
const MONTH_NAMES = new Set([
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "january",
  "february",
  "march",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

/**
 * Indian mobile number (optional +91, 91 or 0 prefix; ten digits starting 6–9)
 * or any international number written with "+" and 8–14 digits. Spaces,
 * dashes, dots and parentheses are ignored.
 */
function isPhone(v: string): boolean {
  const digits = v.replace(/[\s\-().]/g, "");
  if (/^(\+?91|0)?[6-9]\d{9}$/.test(digits)) return true;
  return /^\+\d{8,14}$/.test(digits);
}

export interface StatePatternDetail {
  /** Matching rows / all non-null rows; not extrapolated from the covered values. */
  share: number;
  region: "IN" | "US";
}

/**
 * Share of non-null rows that name a state of the more likely region, or null
 * when none match. Full names and long aliases decide the region because
 * two-letter codes overlap between India and the US (short aliases such as
 * "or", "ut" and "ct" count as codes, see geo.ts); without name evidence the
 * region with more total hits wins (ties → India), so a US code column with
 * OR, UT and CT reads as US.
 */
export function detectStatePattern(
  values: readonly ValueCount[],
  nonNull: number,
): StatePatternDetail | null {
  let inHits = 0;
  let usHits = 0;
  let inNameHits = 0;
  let usNameHits = 0;
  for (const { value, count } of values) {
    if (matchIndianState(value)) inHits += count;
    if (matchUsState(value)) usHits += count;
    if (matchIndianState(value, false)) inNameHits += count;
    if (matchUsState(value, false)) usNameHits += count;
  }
  if (!nonNull) return null;
  // Full names decide the region; two-letter codes are ambiguous between IN and US.
  const region: "IN" | "US" =
    inNameHits > usNameHits ? "IN" : usNameHits > inNameHits ? "US" : inHits >= usHits ? "IN" : "US";
  const share = (region === "IN" ? inHits : usHits) / nonNull;
  return share > 0 ? { share, region } : null;
}

/**
 * Shares (0..1 of non-null rows) of each pattern in a string column.
 * `values` should be the most frequent distinct values with their counts.
 * Kinds under 5% are dropped; the rest are sorted by share, highest first.
 */
export function detectStringPatterns(values: readonly ValueCount[], nonNull: number): PatternHit[] {
  if (!nonNull || values.length === 0) return [];
  const tally = new Map<PatternKind, number>();
  const add = (k: PatternKind, c: number) => tally.set(k, (tally.get(k) ?? 0) + c);
  let covered = 0;
  for (const { value, count } of values) {
    covered += count;
    const v = value.trim();
    if (EMAIL.test(v)) add("email", count);
    else if (URL.test(v)) add("url", count);
    else if (UUID.test(v)) add("uuid", count);
    if (PINCODE.test(v)) add("pincode", count);
    else if (ZIP.test(v)) add("zip", count);
    if (isPhone(v)) add("phone", count);
    if (ID_LIKE.test(v) && !/\s/.test(v)) add("id", count);
    if (isCountry(v)) add("country", count);
    if (isKnownCity(v)) add("city", count);
    if (MONTH_NAMES.has(v.toLowerCase())) add("month", count);
    if (/^(19|20)\d{2}$/.test(v)) add("year", count);
  }
  const state = detectStatePattern(values, nonNull);
  if (state) tally.set("state", state.share * nonNull);
  // Scale shares from the covered sample up to all non-null rows.
  // (State is the exception: its share is already relative to all non-null rows.)
  const scale = covered > 0 ? 1 / covered : 0;
  const hits: PatternHit[] = [];
  for (const [kind, count] of tally) {
    const share = kind === "state" ? count / nonNull : count * scale;
    if (share >= 0.05) hits.push({ kind, share: Math.min(1, share) });
  }
  return hits.sort((a, b) => b.share - a.share);
}

/** Share for one kind; 0 when absent (including kinds dropped below 5%). */
export function patternShare(hits: readonly PatternHit[], kind: PatternKind): number {
  return hits.find((h) => h.kind === kind)?.share ?? 0;
}
