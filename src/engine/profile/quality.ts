/**
 * Data Health: light trust checks even for "clean" data. Every issue states
 * what was found, how many rows, an example, and why it matters.
 *
 * Runs after profiling, on the dataset, its profile and the parse report.
 * Score = 100 − the sum of issue penalties, clamped to 0–100; grades are
 * Excellent ≥ 90, Good ≥ 75, Fair ≥ 60, else Poor. Name-based exemptions
 * (OPTIONAL, REFUNDISH, FUTURE_OK) keep expected patterns, such as blank
 * coupon codes or negative refunds, from being penalised. Checks currently
 * emit only "info" and "warning"; "critical" is not produced.
 *
 * The row-level rules behind the issues (duplicateRowsOf, issueCellTest,
 * isOptionalColumn) are exported for the data check (dataCheck.ts), which
 * marks the exact cells, so its counts always match the issues here.
 */
import type { Column, Dataset, ParseReport } from "@/engine/core/types";
import { DAY_MS, formatDay, todayWallClock } from "@/engine/core/dates";
import { formatPlain } from "@/engine/core/format";
import type { ColumnProfile, DatasetProfile } from "./types";

export type HealthSeverity = "info" | "warning" | "critical";

export interface HealthIssue {
  /** Check prefix plus column, e.g. "negative-Quantity"; `checks` match on these prefixes. */
  id: string;
  severity: HealthSeverity;
  title: string;
  detail: string;
  column?: string;
  count?: number;
  examples?: string[];
  /** Points subtracted from the 100-point score. */
  penalty: number;
}

export interface HealthReport {
  /** 0–100. */
  score: number;
  grade: "Excellent" | "Good" | "Fair" | "Poor";
  /** Sorted by severity, then by penalty. */
  issues: HealthIssue[];
  /** Pass/fail checklist derived from the issue ids. */
  checks: Array<{ id: string; label: string; passed: boolean }>;
  summary: string;
}

const fmt = (n: number) => formatPlain(n, 0, "INTL");
/** "1 row has" / "3 rows have": a count with the noun and verb that agree with it. */
const n_ = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;
/** Fraction → "12.3%", with two decimals below 1%. */
const pct = (x: number) => `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`;

/**
 * Per-row 53-bit hash over every column, built from two 32-bit lanes like
 * stats.hashString. String and boolean codes are mixed in as small integers
 * (equal codes mean equal strings, since dictionaries are unique); numbers and
 * dates by their raw IEEE-754 bits, so NaN nulls hash consistently.
 */
function rowHashes(ds: Dataset): Float64Array {
  const n = ds.rowCount;
  const h1 = new Int32Array(n).fill(0x811c9dc5 | 0);
  const h2 = new Int32Array(n).fill(0x01000193);
  const mixInt = (i: number, x: number) => {
    h1[i] = Math.imul((h1[i] as number) ^ x, 0x01000193);
    h2[i] = Math.imul((h2[i] as number) ^ (x * 31 + 7), 0x5bd1e995);
  };
  const f64 = new Float64Array(1);
  const u32 = new Uint32Array(f64.buffer);
  for (const col of ds.columns) {
    if (col.kind === "string") for (let i = 0; i < n; i++) mixInt(i, (col.codes[i] as number) + 2);
    else if (col.kind === "boolean") for (let i = 0; i < n; i++) mixInt(i, (col.values[i] as number) + 3);
    else
      for (let i = 0; i < n; i++) {
        f64[0] = col.values[i] as number;
        mixInt(i, (u32[0] as number) | 0);
        mixInt(i, (u32[1] as number) | 0);
      }
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++)
    out[i] = ((h1[i] as number) >>> 0) * 2097152 + (((h2[i] as number) >>> 0) & 0x1fffff);
  return out;
}

/**
 * For every row, the 0-based index of the first earlier row identical in
 * every column, or -1. Equal hashes are not re-verified: for a million rows
 * the chance of a false match is about 1 in 18,000.
 */
export function duplicateRowsOf(ds: Dataset): Int32Array {
  const out = new Int32Array(ds.rowCount).fill(-1);
  if (ds.rowCount < 2 || ds.columns.length === 0) return out;
  const hashes = rowHashes(ds);
  const first = new Map<number, number>();
  for (let i = 0; i < hashes.length; i++) {
    const h = hashes[i] as number;
    const f = first.get(h);
    if (f === undefined) first.set(h, i);
    else out[i] = f;
  }
  return out;
}

/**
 * Rows that repeat an earlier row (a row present three times counts twice);
 * firstExample is the 0-based index of the first repeat.
 */
function countDuplicateRows(ds: Dataset): { count: number; firstExample: number } {
  const of = duplicateRowsOf(ds);
  let count = 0;
  let firstExample = -1;
  for (let i = 0; i < of.length; i++)
    if ((of[i] as number) >= 0) {
      count++;
      if (firstExample < 0) firstExample = i;
    }
  return { count, firstExample };
}

/** Name tokens of counts that cannot be negative. */
const QTY = ["quantity", "unit", "item", "piece", "count"];
/** Columns that are legitimately blank when not applicable (a coupon, a return reason, an exit date). */
const OPTIONAL = [
  "coupon",
  "promo",
  "voucher",
  "reason",
  "comment",
  "note",
  "remark",
  "referral",
  "exit",
  "termination",
  "churn",
  "cancel",
  "cancellation",
  "return",
  "refund",
  "delivery",
  "ship",
  "shipping",
  "closed",
  "resolved",
  "end",
  "discharge",
  "secondary",
  "alternate",
  "line2",
  "middle",
  "manager",
  "parent",
];
/** Columns where negative values are expected (returns, adjustments, changes, profit). */
const REFUNDISH = [
  "return",
  "refund",
  "adjustment",
  "credit",
  "reversal",
  "chargeback",
  "change",
  "delta",
  "variance",
  "profit",
  "margin",
  "balance",
  "growth",
  "net",
  "pnl",
];
/** Dates that may legitimately lie in the future (due, expiry, planned, …). */
const FUTURE_OK = [
  "due",
  "expiry",
  "expire",
  "end",
  "maturity",
  "renewal",
  "scheduled",
  "planned",
  "forecast",
  "target",
  "next",
  "estimated",
  "eta",
  "deadline",
  "valid",
  "until",
];
/** Name tokens of coordinates ("long" is left out: "Long Position" is not a longitude). */
const LATITUDE = ["lat", "latitude"];
const LONGITUDE = ["lng", "lon", "longitude"];
/** Age units in name tokens (as names.tokenize writes them) → units per year, so the 120-year limit scales. */
const AGE_UNITS = new Map<string, { perYear: number; label: string }>([
  ...["year", "years", "yr", "yrs", "y"].map((t) => [t, { perYear: 1, label: "years" }] as const),
  ...["month", "months", "mth", "mths", "mo", "mos"].map(
    (t) => [t, { perYear: 12, label: "months" }] as const,
  ),
  ...["week", "weeks", "wk", "wks"].map((t) => [t, { perYear: 365.25 / 7, label: "weeks" }] as const),
  ...["day", "days", "d"].map((t) => [t, { perYear: 365.25, label: "days" }] as const),
  ...["hour", "hours", "hr", "hrs"].map((t) => [t, { perYear: 8766, label: "hours" }] as const),
  ...["minute", "minutes", "min", "mins"].map((t) => [t, { perYear: 525_960, label: "minutes" }] as const),
  ...["second", "seconds", "sec", "secs"].map((t) => [t, { perYear: 31_557_600, label: "seconds" }] as const),
]);

/** Count and first example of values below zero (nulls never compare below zero). */
function negatives(col: Column): { count: number; example: number } {
  if (col.kind !== "number") return { count: 0, example: NaN };
  let c = 0;
  let ex = NaN;
  for (let i = 0; i < col.values.length; i++) {
    const v = col.values[i] as number;
    if (v < 0) {
      c++;
      if (ex !== ex) ex = v;
    }
  }
  return { count: c, example: ex };
}

/** Count and first example of non-null number/date values passing `test`; example is NaN when none. */
function countWhere(col: Column, test: (v: number) => boolean): { count: number; example: number } {
  if (col.kind !== "number" && col.kind !== "date") return { count: 0, example: NaN };
  let c = 0;
  let ex = NaN;
  for (let i = 0; i < col.values.length; i++) {
    const v = col.values[i] as number;
    if (v === v && test(v)) {
      c++;
      if (ex !== ex) ex = v;
    }
  }
  return { count: c, example: ex };
}

/**
 * Spelling-variant key: lower-cased, runs of spaces, dots, underscores and
 * hyphens → one space, other punctuation removed (Unicode-aware), trimmed.
 * "New-Delhi", "new delhi" and "New Delhi." share a key.
 *
 * Signs are read as words first, because they change the meaning: "A+" and
 * "A-" are different blood groups, "<5" and ">5" different bands, "-5" is not
 * "5". A minus is a hyphen at the end of the value (after its letters or
 * digits) or one before a number with nothing in front of it; a hyphen inside
 * a name ("New-Delhi", "18-25") stays a separator.
 */
export function normalizeCategory(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\+/g, " plus ")
    .replace(/−|-(?=[^\p{L}\p{N}]*$)|(?<![\p{L}\p{N}])-(?=\d)/gu, " minus ")
    .replace(/≤/g, " at most ")
    .replace(/≥/g, " at least ")
    .replace(/</g, " under ")
    .replace(/>/g, " over ")
    .replace(/[\s._-]+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();
}

/** True when the column's name marks a field that only applies to some rows (OPTIONAL), so blanks are expected. */
export function isOptionalColumn(p: ColumnProfile): boolean {
  return p.tokens.some((t) => OPTIONAL.includes(t));
}

/** Units per year for an age column, from its name ("Account Age (days)"); years when none is given. */
function ageUnit(p: ColumnProfile): { perYear: number; label: string } {
  return AGE_UNITS.get(p.tokens.find((t) => AGE_UNITS.has(t)) ?? "year") ?? { perYear: 1, label: "years" };
}

/** The coordinate limit a column's name or geo level implies (90 or 180), or 0. */
function coordinateLimit(p: ColumnProfile): number {
  const isLatitude = p.geoLevel === "latitude" || p.tokens.some((t) => LATITUDE.includes(t));
  const isLongitude = p.geoLevel === "longitude" || p.tokens.some((t) => LONGITUDE.includes(t));
  return isLatitude ? 90 : isLongitude ? 180 : 0;
}

/** The first currency "discount" column and the first gross/subtotal/total currency column, if both exist. */
function discountPricePair(cols: ColumnProfile[]): { disc: ColumnProfile; gross: ColumnProfile } | null {
  const disc = cols.find(
    (c) => c.storage === "number" && c.tokens.includes("discount") && c.role === "currency",
  );
  const gross = cols.find(
    (c) =>
      c.storage === "number" &&
      c.role === "currency" &&
      (c.tokens.includes("gross") ||
        c.tokens.includes("subtotal") ||
        (c.tokens.includes("total") && !c.tokens.includes("discount"))),
  );
  return disc && gross ? { disc, gross } : null;
}

/** Start of 2 Jan 1900: anything earlier is a placeholder date (01/01/1900, Excel's serials 0 and 1). */
const PLACEHOLDER_END = Date.UTC(1900, 0, 2);

/**
 * The row-level rule behind a value issue: which cell of which column it
 * flags, and a short note for that cell. The same tests as assessHealth, so
 * a data check's count for an issue equals the issue's count. Null for
 * issues that aren't about values in a column (duplicates, blanks, unreadable
 * cells, gaps), which the data check handles itself.
 */
export function issueCellTest(
  issue: HealthIssue,
  ds: Dataset,
  profile: DatasetProfile,
): { column: string; test: (row: number) => boolean; note: (row: number) => string } | null {
  const byName = (name: string | undefined) => profile.columns.find((c) => c.name === name);
  const values = (p: ColumnProfile | undefined): Float64Array | null => {
    const col = p ? ds.columns[p.index] : undefined;
    return col && (col.kind === "number" || col.kind === "date") ? col.values : null;
  };
  const prefix = issue.id.slice(0, issue.id.indexOf("-") + 1);
  if (issue.id === "discount-over-price") {
    const pair = discountPricePair(profile.columns);
    const d = values(pair?.disc);
    const g = values(pair?.gross);
    if (!pair || !d || !g) return null;
    return {
      column: pair.disc.name,
      test: (r) => {
        const dv = d[r] as number;
        const gv = g[r] as number;
        return dv === dv && gv === gv && gv >= 0 && dv > gv + 1e-9;
      },
      note: () => `Larger than "${pair.gross.name}" on this row, which means a negative selling price.`,
    };
  }
  const p = byName(issue.column);
  if (!p) return null;
  const v = values(p);
  switch (prefix) {
    case "negative-":
      return v ? { column: p.name, test: (r) => (v[r] as number) < 0, note: () => "Below zero." } : null;
    case "pct-": {
      const limit = p.percentScale === 100 ? 100 : 1;
      return v
        ? {
            column: p.name,
            test: (r) => (v[r] as number) > limit || (v[r] as number) < -limit,
            note: () => `Outside ${limit === 1 ? "−100% to 100%" : "−100 to 100"}.`,
          }
        : null;
    }
    case "age-": {
      const max = 120 * ageUnit(p).perYear;
      return v
        ? {
            column: p.name,
            test: (r) => (v[r] as number) < 0 || (v[r] as number) > max,
            note: () => "An age below 0 or above 120 years.",
          }
        : null;
    }
    case "geo-": {
      const lim = coordinateLimit(p);
      return v && lim
        ? { column: p.name, test: (r) => Math.abs(v[r] as number) > lim, note: () => `Beyond ±${lim}.` }
        : null;
    }
    case "future-": {
      const today = todayWallClock() + DAY_MS;
      return v
        ? { column: p.name, test: (r) => (v[r] as number) >= today, note: () => "Dated after today." }
        : null;
    }
    case "ancient-":
      return v
        ? {
            column: p.name,
            test: (r) => (v[r] as number) < PLACEHOLDER_END,
            note: () => "On or before 1 Jan 1900, often a placeholder for a missing date.",
          }
        : null;
    case "variants-": {
      // The most common spelling of each group is taken as the right one; the others are flagged.
      const col = ds.columns[p.index];
      if (!col || col.kind !== "string" || !p.categorical?.all) return null;
      const count = new Map(p.categorical.all.map((x) => [x.value, x.count]));
      const best = new Map<string, string>();
      for (const x of p.categorical.all) {
        const k = normalizeCategory(x.value);
        if (!k) continue;
        const cur = best.get(k);
        if (cur === undefined || x.count > (count.get(cur) ?? 0)) best.set(k, x.value);
      }
      const canonical = new Map<number, string>();
      col.dict.forEach((value, code) => {
        const k = normalizeCategory(value);
        const b = best.get(k);
        if (k && b !== undefined && b !== value) canonical.set(code, b);
      });
      return {
        column: p.name,
        test: (r) => canonical.has(col.codes[r] as number),
        note: (r) =>
          `Spelled differently from "${canonical.get(col.codes[r] as number) ?? ""}", the usual spelling.`,
      };
    }
    default:
      return null;
  }
}

/** Runs every health check. `report`, when given, adds the parser's mixed-type notes. */
export function assessHealth(ds: Dataset, profile: DatasetProfile, report?: ParseReport): HealthReport {
  const issues: HealthIssue[] = [];
  const n = ds.rowCount;
  const cols = profile.columns;
  const colOf = (p: ColumnProfile) => ds.columns[p.index] as Column;

  // 1. Exact duplicate rows: a warning above 1% of rows (penalty 6 + 1 per percent, max 15), else info (2).
  const dup = countDuplicateRows(ds);
  if (dup.count > 0) {
    const rate = dup.count / n;
    issues.push({
      id: "duplicates",
      severity: rate > 0.01 ? "warning" : "info",
      title: n_(dup.count, "exact duplicate row", "exact duplicate rows"),
      detail: `${pct(rate)} of rows are identical in every column to an earlier row (first at row ${fmt(dup.firstExample + 1)}). If they are double-loaded records, totals such as revenue and units are overstated by roughly the same share.`,
      count: dup.count,
      penalty: Math.min(15, rate > 0.01 ? 6 + rate * 100 : 2),
    });
  }

  // 2. Mixed types reported during parsing (informational notes such as trimming have invalidCount 0).
  for (const note of report?.columnNotes ?? []) {
    if (note.invalidCount <= 0) continue;
    issues.push({
      id: `mixed-${note.column}`,
      severity: note.invalidCount / Math.max(1, n) > 0.01 ? "warning" : "info",
      title: `Mixed values in "${note.column}"`,
      detail: `${note.note}${note.examples.length ? ` Examples: ${note.examples.map((e) => `"${e}"`).join(", ")}.` : ""}`,
      column: note.column,
      count: note.invalidCount,
      examples: note.examples,
      penalty: Math.min(4, 1 + (note.invalidCount / Math.max(1, n)) * 100),
    });
  }

  for (const p of cols) {
    const col = colOf(p);
    // 3. Impossible or suspicious values. Negative quantities and unit prices are errors unless the name
    // suggests returns or adjustments; negative additive amounts are only informational (refunds net off).
    if (p.storage === "number" && p.numeric) {
      const isQty = p.tokens.some((t) => QTY.includes(t));
      const refundish = p.tokens.some((t) => REFUNDISH.includes(t));
      if (
        p.numeric.negatives > 0 &&
        !refundish &&
        (isQty || (p.role === "currency" && p.additivity === "non-additive"))
      ) {
        const neg = negatives(col);
        issues.push({
          id: `negative-${p.name}`,
          severity: "warning",
          title: `Negative ${isQty ? "quantities" : "prices"} in "${p.name}"`,
          detail: `${n_(neg.count, "row has a value", "rows have values")} below zero (e.g. ${formatPlain(neg.example, 2, "INTL")}). ${isQty ? "Quantities" : "Unit prices"} can't be negative; if these are returns, record them in a separate column so sales totals stay correct.`,
          column: p.name,
          count: neg.count,
          penalty: 5,
        });
      } else if (
        p.numeric.negatives > 0 &&
        p.role === "currency" &&
        !refundish &&
        p.additivity === "additive"
      ) {
        issues.push({
          id: `negative-${p.name}`,
          severity: "info",
          title: `Negative amounts in "${p.name}"`,
          detail: `${n_(p.numeric.negatives, "row is", "rows are")} below zero. These are often refunds or adjustments; totals will net them off. Check this is intended.`,
          column: p.name,
          count: p.numeric.negatives,
          penalty: 1,
        });
      }
      // Out of range for the column's scale (fractions ±1, points ±100), in either direction.
      if (p.role === "percentage") {
        const limit = p.percentScale === 100 ? 100 : 1;
        const over = countWhere(col, (v) => v > limit || v < -limit);
        if (over.count > 0) {
          issues.push({
            id: `pct-range-${p.name}`,
            severity: "warning",
            title: `Percentages above 100% in "${p.name}"`,
            detail: `${n_(over.count, "value exceeds", "values exceed")} ${limit === 1 ? "1.0 (100%)" : "100"}, e.g. ${formatPlain(over.example, 2, "INTL")}. ${p.tokens.includes("discount") ? "A discount above 100% means the item was paid for by the store." : "Check the unit (fraction vs points)."}`,
            column: p.name,
            count: over.count,
            penalty: 5,
          });
        }
      }
      // Ages: below 0 or above 120 years, in the unit the name gives ("Account Age (days)" may reach 43,830);
      // no unit token means years.
      if (p.tokens.includes("age")) {
        const unit = ageUnit(p);
        const max = 120 * unit.perYear;
        const bad = countWhere(col, (v) => v < 0 || v > max);
        if (bad.count > 0)
          issues.push({
            id: `age-${p.name}`,
            severity: "warning",
            title: `Impossible ages in "${p.name}"`,
            detail: `${n_(bad.count, "value is", "values are")} below 0 or above 120 years${unit.perYear === 1 ? "" : ` (${fmt(max)} ${unit.label})`}.`,
            column: p.name,
            count: bad.count,
            penalty: 4,
          });
      }
      // Coordinates, judged by name: roles.ts only gives the latitude/longitude roles when every value is in
      // range, so a column named like a coordinate that holds impossible values is a plain measure by now.
      const lim = coordinateLimit(p);
      if (lim) {
        const bad = countWhere(col, (v) => Math.abs(v) > lim);
        if (bad.count > 0)
          issues.push({
            id: `geo-${p.name}`,
            severity: "warning",
            title: `Out-of-range coordinates in "${p.name}"`,
            detail: `${n_(bad.count, "value exceeds", "values exceed")} ±${lim}.`,
            column: p.name,
            count: bad.count,
            penalty: 3,
          });
      }
      // Heavy tail: over 5% Tukey outliers and |skew| > 1.5 in a measure. Informational, no penalty.
      if (
        (p.role === "measure" || p.role === "currency") &&
        n >= 50 &&
        p.numeric.outliers / n > 0.05 &&
        Math.abs(p.numeric.skew) > 1.5
      ) {
        issues.push({
          id: `outliers-${p.name}`,
          severity: "info",
          title: `Heavy tail in "${p.name}"`,
          detail: `${fmt(p.numeric.outliers)} values (${pct(p.numeric.outliers / n)}) sit outside the IQR fences. Averages will be pulled by them; the median (${formatPlain(p.numeric.median, 2, "INTL")}) describes a typical row better.`,
          column: p.name,
          count: p.numeric.outliers,
          penalty: 0,
        });
      }
    }
    // Time-of-day columns sit on 1 Jan 1970 by construction: no future or placeholder dates to check.
    if (p.storage === "date" && p.temporal && p.role !== "time") {
      const futureOk = p.tokens.some((t) => FUTURE_OK.includes(t));
      // Start of tomorrow on the wall-clock axis, from the viewer's local date: today itself is fine.
      const today = todayWallClock() + DAY_MS;
      if (!futureOk && p.temporal.max >= today) {
        const fut = countWhere(col, (v) => v >= today);
        issues.push({
          id: `future-${p.name}`,
          severity: "warning",
          title: `Future dates in "${p.name}"`,
          detail: `${n_(fut.count, "row is", "rows are")} dated after today (latest ${formatDay(p.temporal.max)}). They may be data-entry errors and will inflate recent-period KPIs.`,
          column: p.name,
          count: fut.count,
          penalty: 6,
        });
      }
      // On or before 1 Jan 1900 (any time that day), so a literal 1900-01-01 placeholder counts, as do
      // Excel's serials 0 and 1 (30 and 31 Dec 1899).
      if (p.temporal.min < PLACEHOLDER_END) {
        const old = countWhere(col, (v) => v < PLACEHOLDER_END);
        issues.push({
          id: `ancient-${p.name}`,
          severity: "warning",
          title: `Dates on or before 1 Jan 1900 in "${p.name}"`,
          detail: `${n_(old.count, "row", "rows")}, often a placeholder such as 01/01/1900.`,
          column: p.name,
          count: old.count,
          penalty: 3,
        });
      }
    }
    // 4. Constant and empty columns. "Empty" means ≥ 99.9% blank; over 50% blank is a warning unless the
    // name marks a field that only applies to some rows (OPTIONAL).
    if (p.nullPct >= 0.999) {
      issues.push({
        id: `empty-${p.name}`,
        severity: "info",
        title: `"${p.name}" is empty`,
        detail: "Every value is blank. It is ignored by KPIs and charts.",
        column: p.name,
        penalty: 1,
      });
    } else if (p.distinct === 1 && n > 1) {
      issues.push({
        id: `constant-${p.name}`,
        severity: "info",
        title: `"${p.name}" has a single value`,
        detail: `Every row is "${p.examples[0] ?? ""}". It can't explain differences, so it is left out of breakdowns.`,
        column: p.name,
        penalty: 0.5,
      });
    } else if (p.nullPct > 0.5) {
      const optional = isOptionalColumn(p);
      issues.push({
        id: `nulls-${p.name}`,
        severity: optional ? "info" : "warning",
        title: `"${p.name}" is ${optional ? "often blank" : "mostly blank"}`,
        detail: optional
          ? `${pct(p.nullPct)} of rows are blank, which is expected for a field that only applies to some rows (filled for ${pct(1 - p.nullPct)}).`
          : `${pct(p.nullPct)} of values are missing. KPIs that need this column only describe the ${pct(1 - p.nullPct)} of rows where it is filled.`,
        column: p.name,
        count: p.nullCount,
        penalty: optional ? 0 : 3,
      });
    }
    // 5. Category spelling variants (needs the full value list, i.e. at most 250 distinct values).
    if (p.storage === "string" && (p.role === "dimension" || p.role === "geo") && p.categorical?.all) {
      const groups = new Map<string, string[]>();
      for (const v of p.categorical.all) {
        const k = normalizeCategory(v.value);
        if (!k) continue;
        groups.set(k, [...(groups.get(k) ?? []), v.value]);
      }
      const variants = [...groups.values()].filter((g) => g.length > 1);
      if (variants.length) {
        const ex = variants[0] as string[];
        issues.push({
          id: `variants-${p.name}`,
          severity: "warning",
          title: `Inconsistent spellings in "${p.name}"`,
          detail: `${variants.length} value${variants.length > 1 ? "s appear" : " appears"} in several spellings, e.g. ${ex
            .slice(0, 3)
            .map((x) => `"${x}"`)
            .join(", ")}. Breakdowns will split them into separate bars.`,
          column: p.name,
          count: variants.length,
          examples: ex.slice(0, 3),
          penalty: Math.min(5, 2 + variants.length * 0.5),
        });
      }
    }
  }

  // 6. Discount larger than price on the same row: the first currency "discount" column against the
  // first gross/subtotal/total currency column.
  const pair = discountPricePair(cols);
  if (pair) {
    const { disc, gross } = pair;
    const d = colOf(disc);
    const g = colOf(gross);
    if (d.kind === "number" && g.kind === "number") {
      let c = 0;
      for (let i = 0; i < n; i++) {
        const dv = d.values[i] as number;
        const gv = g.values[i] as number;
        if (dv === dv && gv === gv && gv >= 0 && dv > gv + 1e-9) c++;
      }
      if (c > 0)
        issues.push({
          id: "discount-over-price",
          severity: "warning",
          title: `Discount larger than the price`,
          detail: `${n_(c, "row has", "rows have")} "${disc.name}" greater than "${gross.name}", which implies a negative selling price.`,
          column: disc.name,
          count: c,
          penalty: 5,
        });
    }
  }

  // 7. Gaps in the time axis: a warning above 5% empty periods (penalty 2 + 20 × share, max 6), else info.
  const ts = profile.timeSeries;
  if (ts && ts.missingPeriods > 0) {
    const share = ts.missingPeriods / Math.max(1, ts.periods);
    const g = ts.gaps[0];
    issues.push({
      id: "date-gaps",
      severity: share > 0.05 ? "warning" : "info",
      title: `${fmt(ts.missingPeriods)} ${ts.granularity}s with no data`,
      detail: `In "${ts.column}", ${pct(share)} of ${ts.granularity}s between ${formatDay(ts.from)} and ${formatDay(ts.to)} have no rows${g ? `; the longest gap is ${fmt(g.periods)} ${ts.granularity}s from ${formatDay(g.from)}` : ""}. Trends will show these as zero.`,
      count: ts.missingPeriods,
      penalty: share > 0.05 ? Math.min(6, 2 + share * 20) : 0.5,
    });
  }

  if (n < 100) {
    issues.push({
      id: "small-sample",
      severity: "info",
      title: "Small dataset",
      detail: `Only ${fmt(n)} rows. Percentages and averages can swing a lot from a handful of records; treat segment comparisons with care.`,
      penalty: 1,
    });
  }

  const penalty = issues.reduce((s, i) => s + i.penalty, 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const grade = score >= 90 ? "Excellent" : score >= 75 ? "Good" : score >= 60 ? "Fair" : "Poor";
  issues.sort((a, b) => {
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    return rank[a.severity] - rank[b.severity] || b.penalty - a.penalty;
  });
  // Checklist: a check fails on any matching issue, except "ranges", "completeness" and "continuity",
  // which ignore info-level issues.
  const checks = [
    { id: "duplicates", label: "No duplicate rows", passed: !issues.some((i) => i.id === "duplicates") },
    { id: "types", label: "Consistent value types", passed: !issues.some((i) => i.id.startsWith("mixed-")) },
    {
      id: "ranges",
      label: "Values within possible ranges",
      passed: !issues.some(
        (i) => /^(negative|pct-range|age|geo|discount-over)/.test(i.id) && i.severity !== "info",
      ),
    },
    {
      id: "dates",
      label: "No future or placeholder dates",
      passed: !issues.some((i) => /^(future|ancient)/.test(i.id)),
    },
    {
      id: "completeness",
      label: "Columns mostly filled",
      passed: !issues.some((i) => i.id.startsWith("nulls-") && i.severity === "warning"),
    },
    {
      id: "categories",
      label: "Consistent category spellings",
      passed: !issues.some((i) => i.id.startsWith("variants-")),
    },
    {
      id: "continuity",
      label: "Continuous time axis",
      passed: !issues.some((i) => i.id === "date-gaps" && i.severity === "warning"),
    },
  ];
  const warnings = issues.filter((i) => i.severity !== "info").length;
  const summary =
    warnings === 0
      ? "No material problems found. The data looks ready for analysis."
      : `${warnings} issue${warnings > 1 ? "s" : ""} worth reviewing before you rely on totals and rates.`;
  return { score, grade, issues, checks, summary };
}
