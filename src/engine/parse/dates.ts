/**
 * Date pattern detection and parsing. Ambiguous numeric dates (03/04/2025)
 * are resolved with evidence from the whole column: a value that is a real
 * date in one order only proves that order (15/04/2025 → day-first,
 * 04/15/2025 → month-first); impossible values such as 45/03/2024 prove
 * nothing.
 *
 * Results are wall-clock UTC ms. A trailing zone designator (Z, +05:30, UTC,
 * GMT, and after a time "IST" or "GMT+0530 (India Standard Time)") is
 * accepted so the value parses, but it is ignored, never applied. Two-digit
 * years pivot at 50 (00–49 → 20xx, 50–99 → 19xx).
 *
 * Month names are read in English, Spanish, Portuguese, French, German,
 * Italian, Dutch, Indonesian, the Scandinavian languages, Turkish and Polish
 * (words.ts), with the connectors those languages write ("14 de março de 2024
 * 10:22 hs.", "1er janvier 2024", "3. März 2024", "14 marca 2024"). A
 * column takes the language that explains most of its values and never mixes
 * languages (DateDetection.months, narrowed by the column builder). A time
 * may come first ("11:38 PM, September 10 2024") and a weekday is dropped
 * ("Thu, 14 Mar 2024", "jueves, 14 de marzo de 2024"). Months without a day
 * may also be written with numbers ("01.2025") and weeks as ISO weeks
 * ("2024-W12", read as their Monday); Unix times may be seconds,
 * milliseconds or microseconds.
 *
 * Column names are matched as whole tokens (profile/names.ts, the vocabulary
 * shared with role and domain rules): formats that also look like codes or
 * decimals ("2025-03", "20250315", "Mar-25", "01.2025") and numbers that may
 * encode dates need a date-like name, or values that prove it. Detection here
 * works on samples; the whole-column day/month evidence is gathered by
 * DateAccumulator (builder.ts).
 */
import { DAY_MS, isValidYmd, MONTHS_LONG, utc } from "@/engine/core/dates";
import { tokenize } from "@/engine/profile/names";
import {
  ANY_MONTH_LANGUAGE,
  includesEnglish,
  isWeekdayWord,
  languageNames,
  MONTH_LANGUAGES,
  monthWord,
} from "./words";

/** Supported layouts. "nn-nn-y" is the ambiguous DD/MM vs MM/DD family, resolved per column. */
export type DateKind =
  | "iso"
  | "ymd-slash"
  | "nn-nn-y"
  | "d-mon-y"
  | "mon-d-y"
  | "ym"
  | "mon-y"
  /** A month and a four-digit year with no day: "01.2025", "01/2025", "1-2025". */
  | "mm-y"
  /** An ISO week ("2024-W12", "2024W12", "2024-W12-3"), read as its Monday (or the day given). */
  | "iso-week"
  | "yyyymmdd"
  | "excel-serial"
  | "unix-s"
  | "unix-ms"
  | "unix-us"
  /** A time of day with no date ("20:15", "8:30 PM", "20:15:30"); stored as a time-only column. */
  | "time";

// AM/PM as "PM", "pm", "p.m." or the Spanish "p. m."; captures the a/p letter.
const AMPM = String.raw`(?:([AaPp])\.?\s?[Mm]\.?)?`;
// An hour mark after the time, as Spanish, Portuguese and German write it ("10:22 hs.", "10:22 Uhr").
const HOUR_MARK = String.raw`(?:\s*(?:hs?|hrs?|uhr)\.?)?`;
// Time zones as exports write them after a time: offsets ("+05:30", "GMT+5:30"), the usual
// abbreviations ("IST", "CEST") and JavaScript's "(India Standard Time)". Matched only to be ignored:
// the clock time stays as written. A bare offset needs two digits, so a flight's "10:22+1" (next day)
// is not taken for a zone.
const ZONE_NAMES =
  "UTC|GMT|Z|IST|EST|EDT|CST|CDT|MST|MDT|PST|PDT|AKST|AKDT|HST|AST|ADT|CET|CEST|EET|EEST|WET|WEST|BST|MSK|AEST|AEDT|ACST|ACDT|AWST|NZST|NZDT|JST|KST|HKT|SGT|PHT|WIB|ICT|PKT|NPT|SAST|BRT|ART";
const ZONE = String.raw`(?:\s*(?:(?:UTC|GMT)\s*[+-]\d{1,2}(?::?\d{2})?|[+-]\d{2}(?::?\d{2})?|${ZONE_NAMES})\b)?(?:\s*\([^)]*\))?`;
// Optional time suffix shared by the patterns below: "T", spaces, a comma, a spaced hyphen or a connector
// word ("à", "a las", "às", "um", "at"), then H:mm[:ss[.fff]] (fraction dropped; after a date the hour
// may also end in "." or "h", as Italian, Danish and French write 10.22 and 10h22), AM/PM, an hour mark
// and a zone; a date with no time may still end in Z, an offset, UTC or GMT. Captures: h, mm, ss, a/p.
const TIME = String.raw`(?:(?:[T\s]+|\s*,\s*|\s+-\s+|\s+(?:at|à|às|as|a\s+las|um|alle|om)\s+)(\d{1,2})[:.h](\d{2})(?:[:.](\d{2})(?:[.,]\d+)?)?\s*${AMPM}${HOUR_MARK}${ZONE})?\s*(?:Z|[+-]\d{2}:?\d{2}|UTC|GMT)?`;
// A weekday before the date ("Thu, 14 Mar 2024", "jueves, 14 de marzo de 2024"): it repeats the date, so
// it is dropped when it is one (words.isWeekdayWord).
const WEEKDAY = /^([\p{L}\p{M}]{2,13}(?:-feira)?)\.?,?\s+(?=\S)/iu;
// A time written before the date ("11:38 PM, September 10 2024"), as some apps do. Captures h, mm, ss, a/p.
const LEAD_TIME = new RegExp(
  String.raw`^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*${AMPM}${HOUR_MARK}\s*,?\s+(?=\S)`,
  "iu",
);
// A month word: letters, with accents written either way, and an optional dot; looked up in words.ts.
const MONTH = String.raw`([\p{L}\p{M}]{3,12})\.?`;
// Ordinals after the day: English 3rd, French 1er, Spanish and Portuguese 1º.
const ORDINAL = String.raw`(?:st|nd|rd|th|er|º|°)?`;
// Spanish and Portuguese "de"/"del" between the parts ("14 de março de 2024", "marzo del 2024").
const DE = String.raw`(?:\s+del?)?`;

/** Kinds written with a month name, whose column takes one language (DateDetection.months). */
const MONTH_KINDS: ReadonlySet<DateKind> = new Set<DateKind>(["d-mon-y", "mon-d-y", "mon-y"]);

// Anchored patterns per text kind. "nn-nn-y" accepts / . - separators; "ymd-slash" also the Korean and
// Hungarian "2024. 3. 14."; "d-mon-y" and "mon-d-y" also take ordinals, commas and "de" ("3rd Jan, 2025",
// "Jan 3rd, 2025", "14 de março de 2024"), but "mon-d-y" needs a four-digit year; "ym", "mon-y" and
// "mm-y" have no day.
const RE: Record<Exclude<DateKind, "excel-serial" | "unix-s" | "unix-ms" | "unix-us">, RegExp> = {
  iso: new RegExp(String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})${TIME}$`, "iu"),
  "ymd-slash": new RegExp(String.raw`^(\d{4})[/.]\s?(\d{1,2})[/.]\s?(\d{1,2})\.?${TIME}$`, "iu"),
  "nn-nn-y": new RegExp(String.raw`^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})${TIME}$`, "iu"),
  "d-mon-y": new RegExp(
    String.raw`^(\d{1,2})${ORDINAL}\.?${DE}[\s\-/.]+${MONTH}${DE},?[\s\-/.]+(\d{4}|\d{2})${TIME}$`,
    "iu",
  ),
  "mon-d-y": new RegExp(
    String.raw`^${MONTH}[\s\-/.]+(\d{1,2})${ORDINAL}${DE},?[\s\-/.]+(\d{4})${TIME}$`,
    "iu",
  ),
  // "2024.03" too, as Chinese and some German sheets write a month; like every "ym" it needs a date name.
  ym: /^(\d{4})[-/.](\d{1,2})$/,
  "mon-y": new RegExp(String.raw`^${MONTH}${DE},?[\s\-/'’.]+(\d{4}|\d{2})$`, "iu"),
  "mm-y": /^(\d{1,2})([./-])(\d{4})$/,
  "iso-week": /^(\d{4})-?W(\d{1,2})(?:-?([1-7]))?$/i,
  yyyymmdd: /^(\d{4})(\d{2})(\d{2})$/,
  time: new RegExp(String.raw`^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*${AMPM}${HOUR_MARK}$`, "iu"),
};

export const DATE_KIND_LABEL: Record<DateKind, string> = {
  iso: "YYYY-MM-DD",
  "ymd-slash": "YYYY/MM/DD",
  "nn-nn-y": "DD/MM/YYYY or MM/DD/YYYY",
  "d-mon-y": "DD Mon YYYY",
  "mon-d-y": "Mon DD, YYYY",
  ym: "YYYY-MM",
  "mon-y": "Mon YYYY",
  "mm-y": "MM/YYYY",
  "iso-week": "YYYY-Www (ISO week)",
  yyyymmdd: "YYYYMMDD",
  "excel-serial": "Excel serial date",
  "unix-s": "Unix timestamp (seconds)",
  "unix-ms": "Unix timestamp (milliseconds)",
  "unix-us": "Unix timestamp (microseconds)",
  time: "Time of day (HH:mm)",
};

/** Years a month written "MM.YYYY" may have; outside them "01.2525" stays a number. */
const MONTH_YEAR_MIN = 1900;
const MONTH_YEAR_MAX = 2100;

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
    const pm = ap.toLowerCase() === "p";
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
  /** Month-name kinds: the languages (bit mask over MONTH_LANGUAGES) whose word for the month was written. */
  languages?: number;
}

/** Month and languages of a month word, provided one of `months` (a language mask) writes it. */
function month(word: string, months: number): { a: number; languages: number } | null {
  const w = monthWord(word);
  return w && w.languages & months ? { a: w.month, languages: w.languages & months } : null;
}

/**
 * The parse-report sentence for month names in another language ("…with
 * month names in Spanish."), from the languages a column's month words leave
 * open; undefined while English is one of them, the reading Loupe has always
 * had.
 */
export function monthLanguageEvidence(months: number): string | undefined {
  return months && !includesEnglish(months)
    ? `Unambiguous pattern, with month names in ${languageNames(months)}.`
    : undefined;
}

/** Calendar parts of ISO week `w` of year `y`, day `d` (1 = Monday); null when the year has no such week. */
function isoWeekParts(y: number, w: number, d: number): DateParts | null {
  if (w < 1 || w > 53) return null;
  // Week 1 is the one holding 4 January; its Monday may fall in December.
  const jan4 = utc(y, 1, 4);
  const monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
  const start = monday + (w - 1) * 7 * DAY_MS;
  // Week 53 exists only when its Thursday is still in the same year.
  if (new Date(start + 3 * DAY_MS).getUTCFullYear() !== y) return null;
  const t = new Date(start + (d - 1) * DAY_MS);
  return { y: t.getUTCFullYear(), a: t.getUTCMonth() + 1, b: t.getUTCDate(), secs: 0, hasTime: false };
}

/** parseDateParts without a leading time. */
function parseBody(s: string, kind: DateKind, months: number): DateParts | null {
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
      const mon = m && month(m[2] as string, months);
      if (!m || !mon) return null;
      const t = timeParts(m[4], m[5], m[6], m[7]);
      if (!t) return null;
      return { ...mon, b: Number(m[1]), y: fullYear(m[3] as string), secs: t.secs, hasTime: t.has };
    }
    case "mon-d-y": {
      const m = RE["mon-d-y"].exec(s);
      const mon = m && month(m[1] as string, months);
      if (!m || !mon) return null;
      const t = timeParts(m[4], m[5], m[6], m[7]);
      if (!t) return null;
      return { ...mon, b: Number(m[2]), y: Number(m[3]), secs: t.secs, hasTime: t.has };
    }
    case "ym": {
      const m = RE.ym.exec(s);
      if (!m) return null;
      return { y: Number(m[1]), a: Number(m[2]), b: 1, secs: 0, hasTime: false };
    }
    case "mon-y": {
      const m = RE["mon-y"].exec(s);
      const mon = m && month(m[1] as string, months);
      if (!m || !mon) return null;
      return { ...mon, y: fullYear(m[2] as string), b: 1, secs: 0, hasTime: false };
    }
    case "mm-y": {
      const m = RE["mm-y"].exec(s);
      if (!m) return null;
      const y = Number(m[3]);
      if (y < MONTH_YEAR_MIN || y > MONTH_YEAR_MAX) return null;
      return { y, a: Number(m[1]), b: 1, secs: 0, hasTime: false };
    }
    case "iso-week": {
      const m = RE["iso-week"].exec(s);
      return m ? isoWeekParts(Number(m[1]), Number(m[2]), Number(m[3] ?? 1)) : null;
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

/**
 * Parses into parts without deciding day/month order for "nn-nn-y". `months`
 * limits the languages month names are read in (bit mask over
 * MONTH_LANGUAGES; every language by default). A time written before the date
 * is taken as the value's time (a value with a time on both sides is not a
 * date), and a weekday before it is dropped.
 */
export function parseDateParts(raw: string, kind: DateKind, months = ANY_MONTH_LANGUAGE): DateParts | null {
  let s = raw.trim();
  let lead: { secs: number; has: boolean } | null = null;
  if (kind !== "time") {
    const l = LEAD_TIME.exec(s);
    if (l) {
      lead = timeParts(l[1], l[2], l[3], l[4]);
      if (!lead) return null;
      s = s.slice(l[0].length);
    }
  }
  let p = parseBody(s, kind, months);
  if (!p && kind !== "time") {
    const w = WEEKDAY.exec(s);
    if (w && isWeekdayWord(w[1] as string)) p = parseBody(s.slice(w[0].length), kind, months);
  }
  if (!p || !lead) return p;
  return p.hasTime ? null : { ...p, secs: lead.secs, hasTime: true };
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
  /**
   * Month-name kinds: the languages (bit mask over MONTH_LANGUAGES) whose
   * month words explain the most samples. Values in other languages are not
   * read, so a column never mixes languages.
   */
  months?: number;
  /** Why the values were read this way, for the parse report, when "Unambiguous pattern." would not say enough. */
  evidence?: string;
}

/**
 * Name tokens that make a date reading plausible for values that also look
 * like codes or decimals ("yyyymmdd", "ym", "mon-y", "mm-y"). Whole tokens from
 * names.tokenize (camelCase and snake_case split, "Dt"/"DOB" expanded, plurals
 * folded, other languages translated), so "Spend", "Vendor", "Width" and
 * "Monthly Revenue" don't count. Raw and expanded spellings are both listed,
 * and so are the date and period words of other languages, in case a header
 * reaches here untranslated ("Fecha", "Monat", "Mes", "Competência").
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
  "fecha",
  "datum",
  "mes",
  "monat",
  "mois",
  "mese",
  "maand",
  "periodo",
  "periode",
  "competencia",
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
  "fecha",
  "datum",
]);
/**
 * Words API exports put on Unix times ("created": 1712345678, Mixpanel's
 * "time", "unix_time"); trusted for the Unix ranges only, since 20,000–80,000
 * is a common amount but billions of whole seconds rarely are.
 */
const STAMP_TOKENS = new Set([
  "created",
  "updated",
  "modified",
  "deleted",
  "time",
  "unix",
  "unixtime",
  "posix",
]);
/**
 * Words that make a stamp-named number something else: an amount ("Time
 * Deposit Amount"), a count, or the ID of who did it ("created_by", "Created
 * User ID"), all of which may fall in the Unix range.
 */
const NOT_A_STAMP = new Set([
  "amount",
  "value",
  "price",
  "cost",
  "revenue",
  "sale",
  "balance",
  "deposit",
  "loan",
  "payment",
  "fee",
  "salary",
  "spend",
  "budget",
  "profit",
  "income",
  "expense",
  "money",
  "total",
  "sum",
  "count",
  "quantity",
  "number",
  "id",
  "code",
  "key",
  "by",
  "user",
  "customer",
  "account",
  "phone",
  "mobile",
]);
/**
 * Words that say a column holds months or calendar periods. Values such as
 * "01.2025" and "2024.03" are also decimals, so they are read as months only
 * under one of these: the wider DATE_HINT_TOKENS include event words ("Start
 * Rate", "Due", "Time") whose decimals would otherwise become dates.
 */
const MONTH_HINT_TOKENS = new Set([
  "month",
  "period",
  "date",
  "dt",
  "cohort",
  "fecha",
  "datum",
  "mes",
  "monat",
  "mois",
  "mese",
  "maand",
  "periodo",
  "periode",
  "competencia",
]);
/** Words that make values such as "1/2025" a numbered code (invoice 1 of 2025) rather than a month. */
const CODE_TOKENS = new Set([
  "id",
  "number",
  "code",
  "key",
  "reference",
  "invoice",
  "bill",
  "batch",
  "lot",
  "serial",
  "version",
  "release",
  "build",
  "voucher",
  "receipt",
  "ticket",
  "order",
  "document",
  "folio",
  "case",
  "claim",
  "policy",
  "account",
]);

/** "created_at", "updatedAt": "at" after another word. */
const endsWithAt = (tokens: readonly string[]): boolean =>
  tokens.length > 1 && tokens[tokens.length - 1] === "at";

/** True when a whole token of the column name suggests a date or period (DATE_HINT_TOKENS, or a final "at"). */
export function hasDateNameHint(columnName: string): boolean {
  const tokens = tokenize(columnName);
  return endsWithAt(tokens) || tokens.some((t) => DATE_HINT_TOKENS.has(t));
}

/** True when a whole token of the column name says it holds months or periods (MONTH_HINT_TOKENS). */
function hasMonthNameHint(columnName: string): boolean {
  return tokenize(columnName).some((t) => MONTH_HINT_TOKENS.has(t));
}

/**
 * Month-only values written MM.YYYY, MM/YYYY or MM-YYYY ("01.2025"). "01.2025"
 * is also the decimal 1.2025, so the reading needs proof: a name that says
 * months (for "." values; any date-like name for "/" and "-", which are no
 * decimals) with ≥ 95% of values valid, or, without one, every value a month
 * 1–12 and a year 1900–2100 with one separator, at least one zero-padded
 * month (a decimal is never written "01.2025") or two different months (a
 * column of prices near 1.2 has one), and no code word in the name ("Invoice
 * No" 1/2025).
 */
function detectMonthYear(
  samples: readonly string[],
  columnName: string,
  dateHint: boolean,
): DateDetection | null {
  let ok = 0;
  let padded = false;
  const months = new Set<number>();
  const separators = new Set<string>();
  let example = "";
  for (const raw of samples) {
    const s = raw.trim();
    const m = RE["mm-y"].exec(s);
    const p = m && parseBody(s, "mm-y", 0);
    if (!m || !p || p.a < 1 || p.a > 12) continue;
    ok++;
    months.add(p.a);
    separators.add(m[2] as string);
    if ((m[1] as string).length === 2 && (m[1] as string)[0] === "0") padded = true;
    if (!example) example = s;
  }
  const rate = ok / samples.length;
  if (!example) return null;
  const nameHint = separators.has(".") ? hasMonthNameHint(columnName) : dateHint;
  if (!nameHint) {
    const tokens = tokenize(columnName);
    if (
      rate < 1 ||
      separators.size !== 1 ||
      !(padded || months.size >= 2) ||
      tokens.some((t) => CODE_TOKENS.has(t))
    )
      return null;
  } else if (rate < 0.95) return null;
  const p = parseBody(example, "mm-y", 0) as DateParts;
  const decimal = separators.has(".") ? ", not as decimal numbers" : "";
  const why = nameHint
    ? `the column's name says it holds ${separators.has(".") ? "months or periods" : "dates or periods"}`
    : "every value has a month from 1 to 12 and a four-digit year";
  return {
    kind: "mm-y",
    matchRate: rate,
    hasTime: false,
    evidence: `Values such as "${example}" were read as a month and a year (${MONTHS_LONG[p.a - 1]} ${p.y})${decimal}: ${why}.`,
  };
}

/**
 * Detects the dominant date pattern in a sample of non-null strings.
 * A kind qualifies when ≥ 95% of samples parse to a valid date (either
 * day/month order for "nn-nn-y"); the highest rate wins and ties go to the
 * earlier kind. Month names count in the one language (or languages, while
 * the values can't tell them apart) that reads the most samples. Values that
 * are also common as codes need a date-like column name (hasDateNameHint):
 * "ym" ("2025-03"), "yyyymmdd" ("20250315") and "mon-y" with a two-digit year
 * ("Mar-25", which may also mean 25 March). "mon-y" with a four-digit year
 * ("Dec-2015") and ISO weeks ("2024-W12") are unambiguous and need none;
 * "mm-y" ("01.2025") has its own proof (detectMonthYear).
 */
export function detectDateKind(samples: readonly string[], columnName: string): DateDetection | null {
  if (samples.length === 0) return null;
  const nameHint = hasDateNameHint(columnName);
  const monthHint = hasMonthNameHint(columnName);
  const kinds: DateKind[] = nameHint
    ? ["iso", "ymd-slash", "nn-nn-y", "d-mon-y", "mon-d-y", "ym", "mon-y", "iso-week", "yyyymmdd", "time"]
    : ["iso", "ymd-slash", "nn-nn-y", "d-mon-y", "mon-d-y", "mon-y", "iso-week", "time"];
  let best: DateDetection | null = null;
  for (const kind of kinds) {
    let ok = 0;
    let withTime = 0;
    // Valid samples per month language, so the column reads in the language that explains most of them.
    const perLanguage = MONTH_KINDS.has(kind) ? MONTH_LANGUAGES.map(() => 0) : null;
    for (const s of samples) {
      if (kind === "mon-y" && !nameHint && !/\d{4}$/.test(s.trim())) continue;
      // "2024.03" is also a decimal: a month only under a name that says months (MONTH_HINT_TOKENS).
      if (kind === "ym" && !monthHint && s.includes(".")) continue;
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
        if (perLanguage && p.languages)
          perLanguage.forEach((_, bit) => {
            if ((p.languages as number) & (1 << bit)) perLanguage[bit] = (perLanguage[bit] as number) + 1;
          });
      }
    }
    let months: number | undefined;
    if (perLanguage) {
      const most = Math.max(...perLanguage);
      months = perLanguage.reduce(
        (mask, count, bit) => (most > 0 && count === most ? mask | (1 << bit) : mask),
        0,
      );
      ok = most;
    }
    const rate = ok / samples.length;
    if (rate >= 0.95 && (!best || rate > best.matchRate))
      best = {
        kind,
        matchRate: rate,
        hasTime: withTime > 0,
        months,
        evidence: months === undefined ? undefined : monthLanguageEvidence(months),
      };
  }
  const monthYear = detectMonthYear(samples, columnName, nameHint);
  if (monthYear && (!best || monthYear.matchRate > best.matchRate)) best = monthYear;
  // "2024.03" is also the decimal 2024.03: say why it was read as a month.
  if (best?.kind === "ym") {
    for (const raw of samples) {
      const s = raw.trim();
      const p = /^\d{4}\.\d{1,2}$/.test(s) ? parseBody(s, "ym", 0) : null;
      if (!p || p.a < 1 || p.a > 12) continue;
      best.evidence = `Values such as "${s}" were read as a year and a month (${MONTHS_LONG[p.a - 1]} ${p.y}), not as decimal numbers: the column's name says it holds months or periods.`;
      break;
    }
  }
  return best;
}

/** True when a name says a number may be a Unix time: a stamp word, or "at" on its own, and nothing that makes it an amount or an ID. */
function isStampName(tokens: readonly string[]): boolean {
  const stamped = tokens.some((t) => STAMP_TOKENS.has(t)) || (tokens.length === 1 && tokens[0] === "at");
  return stamped && !tokens.some((t) => NOT_A_STAMP.has(t));
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
 * - Unix time also accepts stamp words ("created", "updated", "time", "unix",
 *   "at" on its own; not beside an amount, count or ID word), with ≥ 98% of
 *   values seconds 9e8–2.2e9 (fractions allowed, as Slack's "ts" and
 *   Python's time() write them), or whole milliseconds 9e11–2.2e12 or
 *   microseconds 9e14–2.2e15 (mid-1998 to 2039; GA4 writes microseconds).
 */
export function detectNumericDateKind(values: readonly number[], columnName: string): DateKind | null {
  if (values.length === 0) return null;
  const tokens = tokenize(columnName);
  const named = endsWithAt(tokens) || tokens.some((t) => DATE_TOKENS.has(t));
  if (!named && !isStampName(tokens)) return null;
  let serial = 0;
  let fractional = 0;
  let cents = 0;
  let offQuarter = 0;
  let unixS = 0;
  let unixMs = 0;
  let unixUs = 0;
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
    } else if (v >= 9e8 && v <= 2.2e9) unixS++;
    else if (Number.isInteger(v) && v >= 9e11 && v <= 2.2e12) unixMs++;
    else if (Number.isInteger(v) && v >= 9e14 && v <= 2.2e15) unixUs++;
  }
  const n = values.length;
  const moneyLike = fractional > 0 && cents === fractional && offQuarter > 0;
  if (named && serial / n >= 0.98 && !moneyLike) return "excel-serial";
  if (unixS / n >= 0.98) return "unix-s";
  if (unixMs / n >= 0.98) return "unix-ms";
  if (unixUs / n >= 0.98) return "unix-us";
  return null;
}

/**
 * Numeric encoding to ms; NaN for non-numeric kinds. Excel serials use the
 * 1900 system here. Unix timestamps are true UTC instants and are kept as
 * their UTC clock time, consistent with the wall-clock convention; fractions
 * of a millisecond (from fractional seconds or microseconds) are rounded.
 */
export function numericDateToMs(v: number, kind: DateKind): number {
  if (kind === "excel-serial") return excelSerialToMs(v);
  if (kind === "unix-s") return Math.round(v * 1000);
  if (kind === "unix-ms") return v;
  if (kind === "unix-us") return Math.round(v / 1000);
  return NaN;
}

/** Human-readable format label for the parse report, e.g. "DD/MM/YYYY HH:mm". */
export function describeKind(kind: DateKind, dayFirst: boolean, hasTime: boolean): string {
  if (kind === "time") return DATE_KIND_LABEL.time;
  let base = DATE_KIND_LABEL[kind];
  if (kind === "nn-nn-y") base = dayFirst ? "DD/MM/YYYY" : "MM/DD/YYYY";
  return hasTime && !["ym", "mon-y", "mm-y", "iso-week"].includes(kind) ? `${base} HH:mm` : base;
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
