/**
 * Date pattern detection and parsing. Ambiguous numeric dates (03/04/2025)
 * are resolved with evidence from the whole column: a value that is a real
 * date in one order only proves that order (15/04/2025 → day-first,
 * 04/15/2025 → month-first); impossible values such as 45/03/2024 prove
 * nothing.
 *
 * Results are wall-clock UTC ms. A trailing zone designator (Z, +05:30, UTC,
 * GMT) is accepted so the value parses, but it is ignored, never applied.
 * Two-digit years pivot at 50 (00–49 → 20xx, 50–99 → 19xx); month names are
 * English only. Column names are matched as whole tokens (profile/names.ts):
 * formats that also look like codes, and numbers that may encode dates, need
 * a date-like name. Detection here works on samples; the whole-column
 * day/month evidence is gathered by DateAccumulator (builder.ts).
 */
import { DAY_MS, isValidYmd, MONTHS_SHORT, utc } from "@/engine/core/dates";
import { tokenize } from "@/engine/profile/names";

/** Supported layouts. "nn-nn-y" is the ambiguous DD/MM vs MM/DD family, resolved per column. */
export type DateKind =
  | "iso"
  | "ymd-slash"
  | "nn-nn-y"
  | "d-mon-y"
  | "mon-d-y"
  | "ym"
  | "mon-y"
  | "yyyymmdd"
  | "excel-serial"
  | "unix-s"
  | "unix-ms"
  /** A time of day with no date ("20:15", "8:30 PM", "20:15:30"); stored as a time-only column. */
  | "time";

// Optional time suffix shared by the patterns below: "T" or spaces, H:mm[:ss[.fff]] (fraction dropped),
// optional AM/PM, then an optional zone that is matched only so it can be ignored. Captures: h, mm, ss, am/pm.
const TIME = String.raw`(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*([AaPp][Mm])?)?\s*(?:Z|[+-]\d{2}:?\d{2}|UTC|GMT)?`;
const MONTH_NAME = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;

// Anchored patterns per text kind. "nn-nn-y" accepts / . - separators; "d-mon-y" and "mon-d-y" also take
// ordinals and commas ("3rd Jan, 2025", "Jan 3rd, 2025"), but "mon-d-y" needs a four-digit year;
// "ym" and "mon-y" have no day.
const RE: Record<Exclude<DateKind, "excel-serial" | "unix-s" | "unix-ms">, RegExp> = {
  iso: new RegExp(String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})${TIME}$`),
  "ymd-slash": new RegExp(String.raw`^(\d{4})[/.](\d{1,2})[/.](\d{1,2})${TIME}$`),
  "nn-nn-y": new RegExp(String.raw`^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})${TIME}$`),
  "d-mon-y": new RegExp(
    String.raw`^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]+${MONTH_NAME}\.?,?[\s\-/.]+(\d{4}|\d{2})${TIME}$`,
    "i",
  ),
  "mon-d-y": new RegExp(
    String.raw`^${MONTH_NAME}\.?[\s\-/.]+(\d{1,2})(?:st|nd|rd|th)?,?[\s\-/.]+(\d{4})${TIME}$`,
    "i",
  ),
  ym: /^(\d{4})[-/](\d{1,2})$/,
  "mon-y": new RegExp(String.raw`^${MONTH_NAME}\.?[\s\-/']+(\d{4}|\d{2})$`, "i"),
  yyyymmdd: /^(\d{4})(\d{2})(\d{2})$/,
  time: /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*([AaPp][Mm])?$/,
};

export const DATE_KIND_LABEL: Record<DateKind, string> = {
  iso: "YYYY-MM-DD",
  "ymd-slash": "YYYY/MM/DD",
  "nn-nn-y": "DD/MM/YYYY or MM/DD/YYYY",
  "d-mon-y": "DD Mon YYYY",
  "mon-d-y": "Mon DD, YYYY",
  ym: "YYYY-MM",
  "mon-y": "Mon YYYY",
  yyyymmdd: "YYYYMMDD",
  "excel-serial": "Excel serial date",
  "unix-s": "Unix timestamp (seconds)",
  "unix-ms": "Unix timestamp (milliseconds)",
  time: "Time of day (HH:mm)",
};

/** 1-based month from an English month name or abbreviation (first three letters decide). */
function monthFromName(name: string): number {
  const key = name.slice(0, 3).toLowerCase();
  const idx = MONTHS_SHORT.findIndex((m) => m.toLowerCase() === key);
  return idx + 1;
}

/** Four-digit year from a written year; two-digit years pivot at 50 (00–49 → 2000s, 50–99 → 1900s). Also used by unpivot.ts. */
export function fullYear(y: string): number {
  const n = Number(y);
  if (y.length !== 2) return n;
  return n < 50 ? 2000 + n : 1900 + n;
}

/**
 * Seconds since midnight from the TIME captures; `has` is false when no time was written.
 * Null for impossible times (25:00, 13 PM). 12 AM is midnight and 12 PM is noon.
 */
function timeParts(h?: string, mi?: string, s?: string, ap?: string): { secs: number; has: boolean } | null {
  if (h === undefined) return { secs: 0, has: false };
  let hh = Number(h);
  const mm = Number(mi);
  const ss = s ? Number(s) : 0;
  if (ap) {
    const pm = ap.toLowerCase() === "pm";
    if (hh < 1 || hh > 12) return null;
    if (pm && hh < 12) hh += 12;
    if (!pm && hh === 12) hh = 0;
  }
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return { secs: hh * 3600 + mm * 60 + ss, has: true };
}

export interface DateParts {
  /** For "nn-nn-y": first and second numeric parts; otherwise month and day. */
  a: number;
  b: number;
  /** Four-digit year. */
  y: number;
  /** Seconds since midnight. */
  secs: number;
  /** A time was written, even "00:00". */
  hasTime: boolean;
}

/** Parses into parts without deciding day/month order for "nn-nn-y". */
export function parseDateParts(raw: string, kind: DateKind): DateParts | null {
  const s = raw.trim();
  switch (kind) {
    case "iso":
    case "ymd-slash": {
      const m = RE[kind].exec(s);
      if (!m) return null;
      const t = timeParts(m[4], m[5], m[6], m[7]);
      if (!t) return null;
      return { y: Number(m[1]), a: Number(m[2]), b: Number(m[3]), secs: t.secs, hasTime: t.has };
    }
    case "nn-nn-y": {
      const m = RE["nn-nn-y"].exec(s);
      if (!m) return null;
      const t = timeParts(m[4], m[5], m[6], m[7]);
      if (!t) return null;
      return { a: Number(m[1]), b: Number(m[2]), y: fullYear(m[3] as string), secs: t.secs, hasTime: t.has };
    }
    case "d-mon-y": {
      const m = RE["d-mon-y"].exec(s);
      if (!m) return null;
      const t = timeParts(m[4], m[5], m[6], m[7]);
      if (!t) return null;
      return {
        a: monthFromName(m[2] as string),
        b: Number(m[1]),
        y: fullYear(m[3] as string),
        secs: t.secs,
        hasTime: t.has,
      };
    }
    case "mon-d-y": {
      const m = RE["mon-d-y"].exec(s);
      if (!m) return null;
      const t = timeParts(m[4], m[5], m[6], m[7]);
      if (!t) return null;
      return {
        a: monthFromName(m[1] as string),
        b: Number(m[2]),
        y: Number(m[3]),
        secs: t.secs,
        hasTime: t.has,
      };
    }
    case "ym": {
      const m = RE.ym.exec(s);
      if (!m) return null;
      return { y: Number(m[1]), a: Number(m[2]), b: 1, secs: 0, hasTime: false };
    }
    case "mon-y": {
      const m = RE["mon-y"].exec(s);
      if (!m) return null;
      return { y: fullYear(m[2] as string), a: monthFromName(m[1] as string), b: 1, secs: 0, hasTime: false };
    }
    case "yyyymmdd": {
      const m = RE.yyyymmdd.exec(s);
      if (!m) return null;
      return { y: Number(m[1]), a: Number(m[2]), b: Number(m[3]), secs: 0, hasTime: false };
    }
    case "time": {
      // A time with no date sits on 1 Jan 1970, so the stored value is ms since midnight.
      const m = RE.time.exec(s);
      if (!m) return null;
      const t = timeParts(m[1], m[2], m[3], m[4]);
      if (!t) return null;
      return { y: 1970, a: 1, b: 1, secs: t.secs, hasTime: true };
    }
    default:
      return null;
  }
}

/** Converts parts (month = a, day = b unless "nn-nn-y") into wall-clock ms; NaN when invalid. */
export function partsToMs(p: DateParts, kind: DateKind, dayFirst: boolean): number {
  let month: number;
  let day: number;
  if (kind === "nn-nn-y") {
    month = dayFirst ? p.b : p.a;
    day = dayFirst ? p.a : p.b;
  } else {
    month = p.a;
    day = p.b;
  }
  if (!isValidYmd(p.y, month, day)) return NaN;
  return utc(p.y, month, day) + p.secs * 1000;
}

// Serial 0 of the 1900 date system. Using 30 Dec 1899 (not 31 Dec) absorbs Excel's phantom
// 29 Feb 1900, so serials from 61 (1 Mar 1900) on are exact; earlier ones come out a day early.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/**
 * Excel serial day number (fraction = time of day) to wall-clock ms.
 * 1904-system workbooks are shifted by 1,462 days.
 */
export function excelSerialToMs(serial: number, date1904 = false): number {
  const days = date1904 ? serial + 1462 : serial;
  // Round to the nearest second to undo floating-point noise in fractional days.
  return EXCEL_EPOCH + Math.round(days * 86400) * 1000;
}

export interface DateDetection {
  kind: DateKind;
  /** Share (0–1) of the samples that parse to a valid date under `kind`. */
  matchRate: number;
  /** At least one matching sample carried a time. */
  hasTime: boolean;
}

/**
 * Name tokens that make a date reading plausible for values that also look
 * like codes ("yyyymmdd", "ym", "mon-y"). Whole tokens from names.tokenize
 * (camelCase and snake_case split, "Dt"/"DOB" expanded, plurals folded), so
 * "Spend", "Vendor", "Width" and "Monthly Revenue" don't count. Raw and
 * expanded spellings are both listed.
 */
const DATE_HINT_TOKENS = new Set([
  "date",
  "dt",
  "datetime",
  "timestamp",
  "ts",
  "time",
  "day",
  "period",
  "month",
  "cohort",
  "created",
  "updated",
  "modified",
  "joined",
  "hired",
  "dob",
  "birth",
  "birthdate",
  "birthday",
  "doj",
  "joiningdate",
  "start",
  "end",
  "expiry",
  "expire",
  "expires",
  "due",
  "shipped",
  "delivered",
  "delivery",
  "ordered",
  "placed",
  "signup",
  "since",
]);
/** Tokens that name a date outright: required before numbers are read as Excel serials (see detectNumericDateKind). */
const DATE_TOKENS = new Set([
  "date",
  "dt",
  "datetime",
  "timestamp",
  "ts",
  "dob",
  "birthdate",
  "birthday",
  "doj",
  "joiningdate",
  "epoch",
]);
/** Event stamps that API exports fill with Unix time ("created": 1712345678); trusted for the Unix ranges only. */
const STAMP_TOKENS = new Set(["created", "updated", "modified", "deleted"]);

/** "created_at", "updatedAt": "at" after another word. */
const endsWithAt = (tokens: readonly string[]): boolean =>
  tokens.length > 1 && tokens[tokens.length - 1] === "at";

/** True when a whole token of the column name suggests a date or period (DATE_HINT_TOKENS, or a final "at"). */
export function hasDateNameHint(columnName: string): boolean {
  const tokens = tokenize(columnName);
  return endsWithAt(tokens) || tokens.some((t) => DATE_HINT_TOKENS.has(t));
}

/**
 * Detects the dominant date pattern in a sample of non-null strings.
 * A kind qualifies when ≥ 95% of samples parse to a valid date (either
 * day/month order for "nn-nn-y"); the highest rate wins and ties go to the
 * earlier kind. Values that are also common as codes need a date-like column
 * name (hasDateNameHint): "ym" ("2025-03"), "yyyymmdd" ("20250315") and
 * "mon-y" with a two-digit year ("Mar-25", which may also mean 25 March).
 * "mon-y" with a four-digit year ("Dec-2015") is unambiguous and needs none.
 */
export function detectDateKind(samples: readonly string[], columnName: string): DateDetection | null {
  if (samples.length === 0) return null;
  const nameHint = hasDateNameHint(columnName);
  const kinds: DateKind[] = nameHint
    ? ["iso", "ymd-slash", "nn-nn-y", "d-mon-y", "mon-d-y", "ym", "mon-y", "yyyymmdd", "time"]
    : ["iso", "ymd-slash", "nn-nn-y", "d-mon-y", "mon-d-y", "mon-y", "time"];
  let best: DateDetection | null = null;
  for (const kind of kinds) {
    let ok = 0;
    let withTime = 0;
    for (const s of samples) {
      if (kind === "mon-y" && !nameHint && !/\d{4}$/.test(s.trim())) continue;
      const p = parseDateParts(s, kind);
      if (!p) continue;
      // Validate with either order for ambiguous dates.
      const valid =
        kind === "nn-nn-y"
          ? !Number.isNaN(partsToMs(p, kind, true)) || !Number.isNaN(partsToMs(p, kind, false))
          : !Number.isNaN(partsToMs(p, kind, false));
      if (valid) {
        ok++;
        if (p.hasTime) withTime++;
      }
    }
    const rate = ok / samples.length;
    if (rate >= 0.95 && (!best || rate > best.matchRate))
      best = { kind, matchRate: rate, hasTime: withTime > 0 };
  }
  return best;
}

/**
 * Detects numeric date encodings (Excel serials, Unix timestamps). Plenty of
 * amounts fall in these ranges, so a period or event word ("Month", "Start",
 * "Shipped") is not enough:
 * - Excel serials need a name that says date outright (DATE_TOKENS or a final
 *   "at": "Order Date", "DOB", "created_at"), ≥ 98% of values in 20,000–80,000
 *   (1954–2119), and fractions that could be a time of day: when every
 *   fraction has at most two decimals and some are not quarter days (.25,
 *   .5, .75), the values are written like money (13:00 would be .5416…).
 * - Unix time also accepts event stamps ("created", "updated"), with ≥ 98% of
 *   values integer seconds 9e8–2.2e9 or milliseconds 9e11–2.2e12 (mid-1998
 *   to 2039).
 */
export function detectNumericDateKind(values: readonly number[], columnName: string): DateKind | null {
  if (values.length === 0) return null;
  const tokens = tokenize(columnName);
  const named = endsWithAt(tokens) || tokens.some((t) => DATE_TOKENS.has(t));
  if (!named && !tokens.some((t) => STAMP_TOKENS.has(t))) return null;
  let serial = 0;
  let fractional = 0;
  let cents = 0;
  let offQuarter = 0;
  let unixS = 0;
  let unixMs = 0;
  for (const v of values) {
    if (v >= 20000 && v <= 80000) {
      serial++;
      if (!Number.isInteger(v)) {
        fractional++;
        if (Math.abs(v * 100 - Math.round(v * 100)) < 1e-6) {
          cents++;
          if (Math.abs(v * 4 - Math.round(v * 4)) > 1e-9) offQuarter++;
        }
      }
    } else if (Number.isInteger(v) && v >= 9e8 && v <= 2.2e9) unixS++;
    else if (Number.isInteger(v) && v >= 9e11 && v <= 2.2e12) unixMs++;
  }
  const n = values.length;
  const moneyLike = fractional > 0 && cents === fractional && offQuarter > 0;
  if (named && serial / n >= 0.98 && !moneyLike) return "excel-serial";
  if (unixS / n >= 0.98) return "unix-s";
  if (unixMs / n >= 0.98) return "unix-ms";
  return null;
}

/**
 * Numeric encoding to ms; NaN for non-numeric kinds. Excel serials use the
 * 1900 system here. Unix timestamps are true UTC instants and are kept as
 * their UTC clock time, consistent with the wall-clock convention.
 */
export function numericDateToMs(v: number, kind: DateKind): number {
  if (kind === "excel-serial") return excelSerialToMs(v);
  if (kind === "unix-s") return v * 1000;
  if (kind === "unix-ms") return v;
  return NaN;
}

/** Human-readable format label for the parse report, e.g. "DD/MM/YYYY HH:mm". */
export function describeKind(kind: DateKind, dayFirst: boolean, hasTime: boolean): string {
  if (kind === "time") return DATE_KIND_LABEL.time;
  let base = DATE_KIND_LABEL[kind];
  if (kind === "nn-nn-y") base = dayFirst ? "DD/MM/YYYY" : "MM/DD/YYYY";
  return hasTime && !["ym", "mon-y"].includes(kind) ? `${base} HH:mm` : base;
}

/**
 * Days a time-only value lands on when a tool stores a time as a date-time:
 * Excel's serial 0 (30 Dec 1899) and the 31 Dec 1899 some exporters use,
 * 1 Jan 1900 (SQL Server's time → datetime) and 1 Jan 1970 (Unix epoch).
 */
const TIME_ONLY_DAYS = new Set([Date.UTC(1899, 11, 30), Date.UTC(1899, 11, 31), Date.UTC(1900, 0, 1), 0]);

/**
 * True when every value of a date column sits on one of TIME_ONLY_DAYS and at
 * least one has a time of day: the column holds times, and its "date" is an
 * artefact of the tool that wrote it (the 1899-12-30 20:15 of an Excel time
 * cell). A real date column never has all its rows on those days.
 */
export function isTimeOnlyColumn(values: Float64Array): boolean {
  let any = false;
  let timed = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    if (v !== v) continue;
    any = true;
    const day = Math.floor(v / DAY_MS) * DAY_MS;
    if (!TIME_ONLY_DAYS.has(day)) return false;
    if (v !== day) timed = true;
  }
  return any && timed;
}

export { DAY_MS };
