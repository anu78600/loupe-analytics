/**
 * Deterministic number formatting for Indian (lakh/crore) and international
 * conventions. Implemented by hand rather than with Intl compact notation so
 * output is identical across browsers, Node and tests.
 *
 * Inputs are in base units: percentages as fractions (0.125 → 12.5%) and
 * money in whole currency units. Missing and non-finite values render as an
 * em dash. Used by the UI, insights and exports alike.
 */

/** IN: 12,34,567 grouping with K/L/Cr units; INTL: 1,234,567 with K/M/B/T. */
export type NumberLocale = "IN" | "INTL";
/** How formatValue renders a number; "percent" expects a fraction and "days" appends " days". */
export type ValueFormat = "currency" | "number" | "integer" | "percent" | "ratio" | "days" | "decimal";

export interface FormatOptions {
  locale: NumberLocale;
  /** ISO 4217 code; codes without a known symbol print as "XYZ ". */
  currency: string;
  /** Use short units for large values (12.3L, 4.56M); see formatValue for the thresholds. */
  compact?: boolean;
  /** Overrides the per-format default number of decimals. */
  decimals?: number;
  /** Prefix positive numbers with "+". */
  signed?: boolean;
}

/** Display prefix per ISO code; codes without a distinctive symbol keep the code plus a space ("AED "). */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  AUD: "A$",
  CAD: "C$",
  SGD: "S$",
  HKD: "HK$",
  NZD: "NZ$",
  AED: "AED ",
  SAR: "SAR ",
  ZAR: "R ",
  BRL: "R$",
  KRW: "₩",
  RUB: "₽",
  CHF: "CHF ",
  SEK: "kr ",
  NOK: "kr ",
  DKK: "kr ",
  MXN: "MX$",
  IDR: "Rp ",
  THB: "฿",
  PHP: "₱",
  VND: "₫",
  NGN: "₦",
  PKR: "Rs ",
  BDT: "৳",
  LKR: "Rs ",
  NPR: "Rs ",
  TRY: "₺",
  PLN: "zł ",
  MYR: "RM ",
};

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_SYMBOLS);

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? `${code} `;
}

const DASH = "—";

/**
 * Groups the integer digits: Indian 12,34,567 or international 1,234,567.
 * Expects bare digits (no sign or decimals).
 */
export function groupDigits(intDigits: string, locale: NumberLocale): string {
  if (intDigits.length <= 3) return intDigits;
  if (locale === "INTL") return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const last3 = intDigits.slice(-3);
  const rest = intDigits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/** Fixed decimals with locale grouping and no units, e.g. "-1,23,456.70". */
export function formatPlain(value: number, decimals: number, locale: NumberLocale): string {
  if (!Number.isFinite(value)) return DASH;
  const neg = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [int = "0", frac] = fixed.split(".");
  const body = groupDigits(int, locale) + (frac ? `.${frac}` : "");
  // A tiny negative that rounds to zero prints "0", never "-0".
  return neg && Number(fixed) !== 0 ? `-${body}` : body;
}

interface CompactUnit {
  value: number;
  suffix: string;
}

const IN_UNITS: CompactUnit[] = [
  { value: 1e7, suffix: "Cr" },
  { value: 1e5, suffix: "L" },
  { value: 1e3, suffix: "K" },
];
const INTL_UNITS: CompactUnit[] = [
  { value: 1e12, suffix: "T" },
  { value: 1e9, suffix: "B" },
  { value: 1e6, suffix: "M" },
  { value: 1e3, suffix: "K" },
];

/**
 * 3-significant-figure compact form: 4.56Cr, 12.3L, 45.2K / 1.23M.
 * Trailing zeros are dropped ("2L", not "2.00L"); values under the smallest
 * unit (about 1,000) fall back to formatPlain.
 */
export function formatCompact(value: number, locale: NumberLocale): string {
  if (!Number.isFinite(value)) return DASH;
  const abs = Math.abs(value);
  const units = locale === "IN" ? IN_UNITS : INTL_UNITS;
  for (const u of units) {
    // Promote values that would round up to 1000 of the smaller unit: 999,600 → "1M", not "1000K".
    if (abs >= u.value * 0.9995) {
      const scaled = abs / u.value;
      const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      let text = scaled.toFixed(decimals);
      if (decimals > 0) text = text.replace(/\.?0+$/, "");
      // Large crore values keep grouping (e.g. 1,234Cr).
      if (scaled >= 1000) text = groupDigits(Math.round(scaled).toString(), locale);
      return `${value < 0 ? "−" : ""}${text}${u.suffix}`;
    }
  }
  const decimals = abs >= 100 || Number.isInteger(value) ? 0 : abs >= 10 ? 1 : 2;
  return formatPlain(value, decimals, locale);
}

/**
 * Formats a value for display. Default decimals: currency 0 at ≥ 1,000 or for
 * integers (else 2); percent 1 below 1,000% (else 0), so rates around 100%
 * keep their decimal (NRR 100.4% vs 99.7%); number 0 for integers, 1
 * at ≥ 100, else 2; ratio and decimal 2; days 1. With `compact`, currency
 * switches to short units from 1,000 and number/integer from 100,000 (one
 * lakh). `signed` adds "+" to positive values only.
 */
export function formatValue(
  value: number | null | undefined,
  format: ValueFormat,
  opts: FormatOptions,
): string {
  // Shown numbers carry a true minus sign (−), as typeset reports do; the data grid and the
  // exported files keep the plain hyphen-minus that other software reads.
  const out = formatValueText(value, format, opts);
  return out.startsWith("-") ? `−${out.slice(1)}` : out;
}

function formatValueText(value: number | null | undefined, format: ValueFormat, opts: FormatOptions): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  const sign = opts.signed && value > 0 ? "+" : "";
  switch (format) {
    case "currency": {
      const sym = currencySymbol(opts.currency);
      const abs = Math.abs(value);
      const neg = value < 0 ? "-" : "";
      if (opts.compact && abs >= 1000) return `${sign}${neg}${sym}${formatCompact(abs, opts.locale)}`;
      const decimals = opts.decimals ?? (abs >= 1000 || Number.isInteger(value) ? 0 : 2);
      return `${sign}${neg}${sym}${formatPlain(abs, decimals, opts.locale)}`;
    }
    case "percent": {
      const pct = value * 100;
      // Rates near 100% (net revenue retention, occupancy) move by tenths: "100%" beside "+0.4 pp
      // from 100%" says nothing. Only four-figure percentages drop the decimal.
      const decimals = opts.decimals ?? (Math.abs(pct) >= 1000 ? 0 : 1);
      return `${sign}${formatPlain(pct, decimals, opts.locale)}%`;
    }
    case "ratio":
      return `${sign}${formatPlain(value, opts.decimals ?? 2, opts.locale)}`;
    case "days": {
      const body = formatPlain(value, opts.decimals ?? 1, opts.locale);
      return `${sign}${body} ${body === "1" ? "day" : "days"}`;
    }
    case "integer":
      if (opts.compact && Math.abs(value) >= 100000) return `${sign}${formatCompact(value, opts.locale)}`;
      return `${sign}${formatPlain(value, 0, opts.locale)}`;
    case "decimal":
      return `${sign}${formatPlain(value, opts.decimals ?? 2, opts.locale)}`;
    case "number":
    default: {
      if (opts.compact && Math.abs(value) >= 100000) return `${sign}${formatCompact(value, opts.locale)}`;
      const decimals = opts.decimals ?? (Number.isInteger(value) ? 0 : Math.abs(value) >= 100 ? 1 : 2);
      return `${sign}${formatPlain(value, decimals, opts.locale)}`;
    }
  }
}

/**
 * Formats a relative change (fraction) as a signed percentage, e.g. +12.4%.
 * Uses a true minus sign (−, U+2212) and prints "0.0%" when the change rounds to zero.
 */
export function formatDelta(delta: number | null | undefined, locale: NumberLocale = "INTL"): string {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return DASH;
  const pct = delta * 100;
  const decimals = Math.abs(pct) >= 100 ? 0 : 1;
  const body = formatPlain(Math.abs(pct), decimals, locale);
  if (Number(Math.abs(pct).toFixed(decimals)) === 0) return "0.0%";
  return `${pct > 0 ? "+" : "−"}${body}%`;
}

/**
 * Percentage-point change for rate KPIs (e.g. +1.2 pp).
 * `diff` is a difference of two fractions (0.012 → +1.2 pp).
 */
export function formatPointDelta(diff: number | null | undefined, locale: NumberLocale = "INTL"): string {
  if (diff === null || diff === undefined || !Number.isFinite(diff)) return DASH;
  const pp = diff * 100;
  const body = formatPlain(Math.abs(pp), 1, locale);
  if (Number(Math.abs(pp).toFixed(1)) === 0) return "0.0 pp";
  return `${pp > 0 ? "+" : "−"}${body} pp`;
}

/**
 * True when a change (relative, or a difference of fractions) shows as 0.0%
 * or 0.0 pp. A flat change is drawn neutral, never as good or bad news.
 */
export function isFlatChange(change: number): boolean {
  return Math.abs(change) < 0.0005;
}

export function formatCount(n: number, locale: NumberLocale): string {
  return formatPlain(n, 0, locale);
}

/** Binary units: 1 KB = 1,024 bytes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}
