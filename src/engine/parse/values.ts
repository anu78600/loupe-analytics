/**
 * Value-level parsers: null tokens, numbers with currency/percent, booleans,
 * plus the decimal-separator decision for a column (detectNumberStyle).
 *
 * Shared by type inference (builder.inferPlan, on a sample) and by the column
 * accumulators (on every cell), so they stay small and side-effect free.
 * They return null rather than throwing; the caller decides whether that
 * counts as an invalid value.
 */

/** Spellings treated as blank, compared trimmed and lower-cased (includes spreadsheet errors such as #N/A). */
const NULL_TOKENS = new Set([
  "",
  "na",
  "n/a",
  "n.a.",
  "null",
  "none",
  "nil",
  "nan",
  "-",
  "--",
  "—",
  "#n/a",
  "#null!",
  "#value!",
  "undefined",
  "?",
  "missing",
  "not available",
]);

export function isNullToken(raw: string): boolean {
  return NULL_TOKENS.has(raw.trim().toLowerCase());
}

/** Decimal separator of a column: "dot" (1,234.56 and Indian 1,23,456.78) or "comma" (1.234,56). */
export type NumberStyle = "dot" | "comma";

export interface ParsedNumber {
  /** Signed value; percentages are already divided by 100 (12.5% → 0.125). */
  value: number;
  /** ISO code when a currency symbol or code was present. */
  currency?: string;
  /** True when the text carried a % sign. */
  percent?: boolean;
}

/**
 * Lower-case currency symbols and prefixes, longer forms first so "us$" and
 * "rs." win over "$" and "rs". A bare "$" is read as USD and "¥" as JPY.
 */
const SYMBOL_TO_CODE: Array<[string, string]> = [
  ["us$", "USD"],
  ["hk$", "HKD"],
  ["nz$", "NZD"],
  ["a$", "AUD"],
  ["c$", "CAD"],
  ["s$", "SGD"],
  ["r$", "BRL"],
  ["rs.", "INR"],
  ["rs", "INR"],
  ["₹", "INR"],
  ["$", "USD"],
  ["€", "EUR"],
  ["£", "GBP"],
  ["¥", "JPY"],
  ["₩", "KRW"],
  ["₽", "RUB"],
  ["₺", "TRY"],
  ["₦", "NGN"],
  ["฿", "THB"],
  ["₱", "PHP"],
  ["₫", "VND"],
  ["৳", "BDT"],
];

/** Codes accepted as a three-letter prefix ("USD 500") or suffix ("500 usd"), case-insensitively. */
export const ISO_CURRENCY_CODES = new Set([
  "INR",
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CNY",
  "AUD",
  "CAD",
  "SGD",
  "HKD",
  "NZD",
  "AED",
  "SAR",
  "ZAR",
  "BRL",
  "KRW",
  "RUB",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "MXN",
  "IDR",
  "THB",
  "PHP",
  "VND",
  "NGN",
  "PKR",
  "BDT",
  "LKR",
  "NPR",
  "TRY",
  "PLN",
  "MYR",
]);

function matchCurrencyPrefix(s: string): { code: string; len: number } | null {
  const lower = s.toLowerCase();
  for (const [sym, code] of SYMBOL_TO_CODE) {
    if (lower.startsWith(sym)) {
      // "rs" must not swallow a word like "rsvp"; require a non-letter next.
      const next = s.charAt(sym.length);
      if (/[a-z]/i.test(sym) && /[a-z]/i.test(next)) continue;
      return { code, len: sym.length };
    }
  }
  // An ISO code must be followed by a space, digit, separator or minus ("USD500", "INR -20"), not a letter.
  const m = /^([A-Za-z]{3})(?=[\s\d.,-])/.exec(s);
  if (m && ISO_CURRENCY_CODES.has((m[1] as string).toUpperCase()))
    return { code: (m[1] as string).toUpperCase(), len: 3 };
  return null;
}

/** Trailing ISO code (optionally after a space) or a single-character symbol ("500€"). */
function matchCurrencySuffix(s: string): { code: string; len: number } | null {
  const m = /[\s]?([A-Za-z]{3})$/.exec(s);
  if (m && ISO_CURRENCY_CODES.has((m[1] as string).toUpperCase()))
    return { code: (m[1] as string).toUpperCase(), len: m[0].length };
  const last = s.slice(-1);
  for (const [sym, code] of SYMBOL_TO_CODE) {
    if (sym.length === 1 && last === sym) return { code, len: 1 };
  }
  return null;
}

// Patterns for the unsigned body left once signs, currency and % are peeled off. DOT_STYLE allows 2- or
// 3-digit groups so Indian 1,23,456.78 passes; it does not check group consistency, so "1,50" reads as 150.
// COMMA_STYLE needs 3-digit dot groups (1.234.567,89). SCIENTIFIC (1.5e6, dot decimal) is accepted in both.
const DOT_STYLE = /^(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?$|^\.\d+$/;
const COMMA_STYLE = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$|^,\d+$/;
const SCIENTIFIC = /^\d+(?:\.\d+)?e[+-]?\d+$/i;
// Space-grouped thousands (12 500,00 in French and other European locales, 1 234 567.89 elsewhere). A space
// is never a decimal separator, so the remaining mark is the decimal whatever the column's style.
const SPACE_GROUPED = /^\d{1,3}(?: \d{3})+(?:[.,]\d+)?$/;

/**
 * Parses "₹1,23,456.50", "(1,234)", "12.5%", "USD 500", "1.234,56" (comma style), "12 500,00"
 * (space-grouped, any style) and "Rs. 500/-".
 *
 * Peels off, in order: accounting parentheses, a leading sign (ASCII "-" or
 * U+2212), a currency prefix and a sign after it, the Indian "/-" suffix, "%",
 * a currency suffix, and a trailing minus ("500-", as some ERP exports write
 * negatives). Each minus toggles the sign, so "(-5)" is +5. Returns null when
 * the remaining body is not a number in `style`.
 */
export function parseNumber(raw: string, style: NumberStyle = "dot"): ParsedNumber | null {
  // Normalise no-break, narrow no-break and thin spaces (common in exported reports) to plain spaces.
  let s = raw.replace(/[   ]/g, " ").trim();
  if (!s) return null;
  let neg = false;
  let percent = false;
  let currency: string | undefined;

  if (s.startsWith("(") && s.endsWith(")")) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  if (s[0] === "-" || s[0] === "−") {
    neg = !neg;
    s = s.slice(1).trim();
  } else if (s[0] === "+") {
    s = s.slice(1).trim();
  }
  const pre = matchCurrencyPrefix(s);
  if (pre) {
    currency = pre.code;
    s = s.slice(pre.len).trim();
    if (s[0] === "-" || s[0] === "−") {
      neg = !neg;
      s = s.slice(1).trim();
    }
  }
  if (s.endsWith("/-")) s = s.slice(0, -2).trim();
  if (s.endsWith("%")) {
    percent = true;
    s = s.slice(0, -1).trim();
  }
  if (!currency) {
    const suf = matchCurrencySuffix(s);
    if (suf) {
      currency = suf.code;
      s = s.slice(0, -suf.len).trim();
    }
  }
  if (s.endsWith("-") && s.length > 1) {
    neg = !neg;
    s = s.slice(0, -1).trim();
  }
  if (!s) return null;

  let normalized: string;
  if (SCIENTIFIC.test(s)) normalized = s;
  else if (SPACE_GROUPED.test(s)) normalized = s.replace(/ /g, "").replace(",", ".");
  else if (style === "dot") {
    if (!DOT_STYLE.test(s)) return null;
    normalized = s.replace(/,/g, "");
  } else {
    if (!COMMA_STYLE.test(s)) return null;
    normalized = s.replace(/\./g, "").replace(",", ".");
  }
  const v = Number(normalized);
  if (!Number.isFinite(v)) return null;
  const signed = neg ? -v : v;
  return { value: percent ? signed / 100 : signed, currency, percent: percent || undefined };
}

/** A column's decimal separator, with a parse-report remark when the values left room for doubt. */
export interface NumberStyleDecision {
  style: NumberStyle;
  /** Set when no value settled the style, the values contradicted each other, or the choice went against the dot default without a value proving it. */
  note?: string;
}

/**
 * What one value says about the separators, from its digits, dots and commas only. "dot"/"comma": readable
 * in that style only. "lone-dot"/"lone-comma": one separator after 1–3 digits (no leading zero) and before
 * exactly three, so "1.234" may be 1.234 or 1234. "plain"/"plain-long": no separator, under / from four digits.
 */
type SeparatorEvidence = "dot" | "comma" | "lone-dot" | "lone-comma" | "plain" | "plain-long" | null;

function separatorEvidence(s: string): SeparatorEvidence {
  if (/^\d+$/.test(s)) return /^[1-9]\d{3,}$/.test(s) ? "plain-long" : "plain";
  // Both separators (the last one is the decimal) or repeated group separators ("1,234,567", Indian "12,34,567").
  if (/^\d{1,3}(?:,\d{2,3})+\.\d+$/.test(s) || /^\d{1,3}(?:,\d{2,3}){2,}$/.test(s)) return "dot";
  if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(s) || /^\d{1,3}(?:\.\d{3}){2,}$/.test(s)) return "comma";
  const m = /^(\d*)([.,])(\d+)$/.exec(s);
  if (!m) return null;
  const [, int = "", sep, frac = ""] = m;
  if (frac.length === 3 && /^[1-9]\d{0,2}$/.test(int)) return sep === "." ? "lone-dot" : "lone-comma";
  // Anything else can only be a decimal separator: a leading zero ("0.125" is never a thousands group),
  // four or more digits before it, or other than three digits after it.
  return sep === "." ? "dot" : "comma";
}

/**
 * Decides whether a column writes decimals with "." or "," (1.234,56), from
 * the samples' digits, dots and commas. In order of strength:
 * 1. Values that read one way only: both separators, repeated group
 *    separators, a leading zero ("0.125"), four or more digits before a lone
 *    separator, or other than three digits after it. The majority wins (ties
 *    → dot) and contradicting values get a note.
 * 2. How the values are distributed, when only "1.234"-shaped values remain:
 *    whole numbers of four or more digits mean thousands are not grouped, so
 *    a lone separator is the decimal mark; whole numbers next to lone values
 *    ending in 0 ("980" with "2.500") fit thousands grouping but no decimal
 *    format (that would write "980.000", or "2.5").
 * 3. Otherwise "." is the decimal point, with a note. A comma choice that no
 *    single value proves gets a note too.
 */
export function detectNumberStyle(samples: readonly string[]): NumberStyleDecision {
  let dot = 0;
  let comma = 0;
  let loneDot = 0;
  let loneComma = 0;
  let loneZero = 0;
  let plain = 0;
  let plainLong = 0;
  /** First sample of each kind, quoted in the notes; loneDigits is the first lone value's digits and separator. */
  const ex = { dot: "", comma: "", lone: "", loneDigits: "", zero: "", plain: "", long: "" };
  for (const raw of samples) {
    // The number's own digits and separators: a leading label such as "Rs." or "kr." (but not the dot of
    // ".5") and trailing text are dropped before anything else but digits, dots and commas.
    const s = raw
      .replace(/^\D*?(?=[.,]?\d)/, "")
      .replace(/\D+$/, "")
      .replace(/[^\d.,]/g, "");
    const e = s ? separatorEvidence(s) : null;
    const text = raw.trim();
    if (e === "dot" || e === "comma") {
      if (e === "dot") dot++;
      else comma++;
      if (!ex[e]) ex[e] = text;
    } else if (e === "lone-dot" || e === "lone-comma") {
      if (e === "lone-dot") loneDot++;
      else loneComma++;
      if (!ex.lone) {
        ex.lone = text;
        ex.loneDigits = s;
      }
      if (s.endsWith("0")) {
        loneZero++;
        if (!ex.zero) ex.zero = text;
      }
    } else if (e === "plain" || e === "plain-long") {
      plain++;
      if (!ex.plain) ex.plain = text;
      if (e === "plain-long") {
        plainLong++;
        if (!ex.long) ex.long = text;
      }
    }
  }

  // Distribution evidence, used when one kind of lone separator appears: it is the decimal mark if long
  // whole numbers go ungrouped, a group separator if whole numbers sit next to lone values ending in 0.
  const sep = loneDot ? "." : ",";
  let fromLone: NumberStyle | null = null;
  if (loneDot > 0 !== loneComma > 0) {
    const decimal = plainLong > 0;
    const grouping = plain > 0 && loneZero > 0;
    if (decimal !== grouping) fromLone = decimal === (sep === ".") ? "dot" : "comma";
  }
  const name = (style: NumberStyle) =>
    style === "dot" ? '"." as the decimal point' : '"," as the decimal comma';
  /** The first lone value read in `style` (from its digits if the full text doesn't parse). */
  const reading = (style: NumberStyle) =>
    parseNumber(ex.lone, style)?.value ?? parseNumber(ex.loneDigits, style)?.value;

  if (dot || comma) {
    const style: NumberStyle = comma > dot ? "comma" : "dot";
    if (dot && comma) {
      return {
        style,
        note: `Mixed decimal separators: ${dot.toLocaleString("en-US")} sampled values only fit "." as the decimal point (e.g. "${ex.dot}") and ${comma.toLocaleString("en-US")} only fit "," (e.g. "${ex.comma}"). Read with ${name(style)}, the majority; values written the other way couldn't be read.`,
      };
    }
    if (fromLone && fromLone !== style) {
      return {
        style,
        note: `Read with ${name(style)} because of values such as "${style === "dot" ? ex.dot : ex.comma}", though values such as "${ex.lone}" look written the other way. Check this column.`,
      };
    }
    return { style };
  }
  if (!loneDot && !loneComma) return { style: "dot" };
  if (fromLone === "dot") return { style: "dot" };
  if (fromLone === "comma") {
    const why =
      sep === "."
        ? `whole numbers such as "${ex.plain}" next to values such as "${ex.zero}" fit "." as a thousands separator, not as a decimal point`
        : `whole numbers such as "${ex.long}" are written without thousands separators, so "," is the decimal comma`;
    return {
      style: "comma",
      note: `No single value settles the decimal separator, but ${why}: "${ex.lone}" was read as ${reading("comma")}. Check this column.`,
    };
  }
  return {
    style: "dot",
    note: `Values such as "${ex.lone}" could mean ${reading("dot")} or ${reading("comma")}, depending on whether "." or "," marks decimals, and nothing in the column settles it; read with "." as the decimal point. Check this column.`,
  };
}

// "1"/"0" are not tokens: such text columns parse as numbers, and roles.ts gives 0/1
// columns with flag-like names the boolean role.
const TRUE_TOKENS = new Set(["true", "yes", "y", "t"]);
const FALSE_TOKENS = new Set(["false", "no", "n", "f"]);

/** true/false for a recognised token (case-insensitive, trimmed), else null. */
export function parseBooleanToken(raw: string): boolean | null {
  const t = raw.trim().toLowerCase();
  if (TRUE_TOKENS.has(t)) return true;
  if (FALSE_TOKENS.has(t)) return false;
  return null;
}

/**
 * Marker for dates that arrive already typed (Excel cells, sample generators).
 * In practice only excel.ts creates them; the demo generators write wall-clock
 * numbers directly through SampleBuilder. `ms` is wall-clock UTC ms and
 * `hasTime` says the source carried a time of day.
 */
export class WallClockDate {
  constructor(
    public readonly ms: number,
    public readonly hasTime: boolean = false,
  ) {}
}

/**
 * One raw cell as handed to the builders: text from CSV, typed values from
 * workbooks and JSON. null/undefined mean missing.
 */
export type CellValue = string | number | boolean | WallClockDate | null | undefined;
