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
 * Rows whose hash matches an earlier row's (a row present three times counts
 * twice); firstExample is the 0-based index of the first repeat. Equal hashes
 * are not re-verified: for a million rows the chance of a false match is
 * about 1 in 18,000.
 */
function countDuplicateRows(ds: Dataset): { count: number; firstExample: number } {
  if (ds.rowCount < 2 || ds.columns.length === 0) return { count: 0, firstExample: -1 };
  const hashes = rowHashes(ds);
  const seen = new Set<number>();
  let dups = 0;
  let firstExample = -1;
  for (let i = 0; i < hashes.length; i++) {
    const h = hashes[i] as number;
    if (seen.has(h)) {
      dups++;
      if (firstExample < 0) firstExample = i;
    } else seen.add(h);
  }
  return { count: dups, firstExample };
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
 */
function normalizeCategory(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s._-]+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();
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
      title: `${fmt(dup.count)} exact duplicate rows`,
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
          detail: `${fmt(neg.count)} rows have values below zero (e.g. ${formatPlain(neg.example, 2, "INTL")}). ${isQty ? "Quantities" : "Unit prices"} can't be negative; if these are returns, record them in a separate column so sales totals stay correct.`,
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
          detail: `${fmt(p.numeric.negatives)} rows are below zero. These are often refunds or adjustments; totals will net them off. Check this is intended.`,
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
            detail: `${fmt(over.count)} values exceed ${limit === 1 ? "1.0 (100%)" : "100"}, e.g. ${formatPlain(over.example, 2, "INTL")}. ${p.tokens.includes("discount") ? "A discount above 100% means the item was paid for by the store." : "Check the unit (fraction vs points)."}`,
            column: p.name,
            count: over.count,
            penalty: 5,
          });
        }
      }
      // Ages: below 0 or above 120 years, in the unit the name gives ("Account Age (days)" may reach 43,830);
      // no unit token means years.
      if (p.tokens.includes("age")) {
        const unit = AGE_UNITS.get(p.tokens.find((t) => AGE_UNITS.has(t)) ?? "year") ?? {
          perYear: 1,
          label: "years",
        };
        const max = 120 * unit.perYear;
        const bad = countWhere(col, (v) => v < 0 || v > max);
        if (bad.count > 0)
          issues.push({
            id: `age-${p.name}`,
            severity: "warning",
            title: `Impossible ages in "${p.name}"`,
            detail: `${fmt(bad.count)} values are below 0 or above 120 years${unit.perYear === 1 ? "" : ` (${fmt(max)} ${unit.label})`}.`,
            column: p.name,
            count: bad.count,
            penalty: 4,
          });
      }
      // Coordinates, judged by name: roles.ts only gives the latitude/longitude roles when every value is in
      // range, so a column named like a coordinate that holds impossible values is a plain measure by now.
      const isLatitude = p.geoLevel === "latitude" || p.tokens.some((t) => LATITUDE.includes(t));
      const isLongitude = p.geoLevel === "longitude" || p.tokens.some((t) => LONGITUDE.includes(t));
      const lim = isLatitude ? 90 : isLongitude ? 180 : 0;
      if (lim) {
        const bad = countWhere(col, (v) => Math.abs(v) > lim);
        if (bad.count > 0)
          issues.push({
            id: `geo-${p.name}`,
            severity: "warning",
            title: `Out-of-range coordinates in "${p.name}"`,
            detail: `${fmt(bad.count)} values exceed ±${lim}.`,
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
          detail: `${fmt(fut.count)} rows are dated after today (latest ${formatDay(p.temporal.max)}). They may be data-entry errors and will inflate recent-period KPIs.`,
          column: p.name,
          count: fut.count,
          penalty: 6,
        });
      }
      // On or before 1 Jan 1900 (any time that day), so a literal 1900-01-01 placeholder counts, as do
      // Excel's serials 0 and 1 (30 and 31 Dec 1899).
      const placeholderEnd = Date.UTC(1900, 0, 2);
      if (p.temporal.min < placeholderEnd) {
        const old = countWhere(col, (v) => v < placeholderEnd);
        issues.push({
          id: `ancient-${p.name}`,
          severity: "warning",
          title: `Dates on or before 1 Jan 1900 in "${p.name}"`,
          detail: `${fmt(old.count)} rows, often a placeholder such as 01/01/1900.`,
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
      const optional = p.tokens.some((t) => OPTIONAL.includes(t));
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
  if (disc && gross) {
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
          detail: `${fmt(c)} rows have "${disc.name}" greater than "${gross.name}", which implies a negative selling price.`,
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
