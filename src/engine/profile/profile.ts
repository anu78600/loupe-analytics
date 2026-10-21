/**
 * Column and dataset profiling. Exact statistics via typed-array sorts; all
 * loops are single-pass over typed arrays so 1M rows profile in about a second.
 *
 * Runs right after parsing (session adopt), before domain detection; its
 * output feeds KPIs, charts, insights and the health report. One deliberate
 * approximation bounds memory: string columns with more than 60,000 distinct
 * values use the first-seen 2,000 for top values and patterns. Distinct
 * counts are exact for every storage type.
 */
import type {
  BooleanColumn,
  Column,
  Dataset,
  DateColumn,
  NumberColumn,
  StringColumn,
} from "@/engine/core/types";
import { DAY_MS, isoDate, isoDateTime, isoTime } from "@/engine/core/dates";
import { moments, quantileSorted } from "@/engine/core/stats";
import { formatPlain } from "@/engine/core/format";
import type {
  CategoricalStats,
  ColumnProfile,
  CurrencyInfo,
  DatasetProfile,
  GeoRegion,
  NumericStats,
  PatternHit,
  TemporalStats,
  ValueCount,
} from "./types";
import { detectStatePattern, detectStringPatterns } from "./patterns";
import { inferRole, readingsTable } from "./roles";
import { nameCurrency, tokenize } from "./names";
import { detectColumnPairs } from "./pairs";
import {
  analyseTimeSeries,
  detectHierarchies,
  detectKeysAndGrain,
  detectTallFormat,
  detectWideFormat,
  pickPrimaryDate,
} from "./structure";

/** Storage-specific statistics, computed before role inference. */
interface BaseStats {
  nullCount: number;
  distinct: number;
  numeric?: NumericStats;
  categorical?: CategoricalStats;
  temporal?: TemporalStats;
  booleanStats?: { trueCount: number; falseCount: number };
  patterns: PatternHit[];
  examples: string[];
  /** Strings only: region hint from detectStatePattern. */
  stateRegion?: Exclude<GeoRegion, "WORLD">;
  /** Strings only: share of non-null rows containing a space. */
  spaceShare?: number;
}

/** Number of sorted values strictly below x (binary search). */
function lowerBound(sorted: Float64Array, x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Number of sorted values at or below x (binary search). */
function upperBound(sorted: Float64Array, x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Exact statistics from a sorted copy of the non-null values; examples are the first five distinct values. */
function numberStats(col: NumberColumn): BaseStats {
  const v = col.values;
  let nonNull = 0;
  for (let i = 0; i < v.length; i++) if (v[i] === v[i]) nonNull++;
  const sorted = new Float64Array(nonNull);
  let k = 0;
  let zeros = 0;
  let negatives = 0;
  let integer = true;
  let halfSteps = true;
  for (let i = 0; i < v.length; i++) {
    const x = v[i] as number;
    if (x !== x) continue;
    sorted[k++] = x;
    if (x === 0) zeros++;
    else if (x < 0) negatives++;
    if (integer && !Number.isInteger(x)) integer = false;
    if (halfSteps && !Number.isInteger(x * 2)) halfSteps = false;
  }
  // TypedArray#sort is numeric (unlike Array#sort), and NaNs were left out above.
  sorted.sort();
  let distinct = 0;
  for (let i = 0; i < sorted.length; i++) if (i === 0 || sorted[i] !== sorted[i - 1]) distinct++;
  const m = moments(sorted);
  const q1 = quantileSorted(sorted, 0.25);
  const q3 = quantileSorted(sorted, 0.75);
  const iqr = q3 - q1;
  // Tukey's fences, counted by binary search on the sorted copy. With IQR 0 (mostly identical
  // values) nothing is flagged, rather than every value that differs.
  const outliers =
    iqr > 0 ? lowerBound(sorted, q1 - 1.5 * iqr) + (sorted.length - upperBound(sorted, q3 + 1.5 * iqr)) : 0;
  const examples: string[] = [];
  for (let i = 0; i < v.length && examples.length < 5; i++) {
    const x = v[i] as number;
    if (x === x) {
      const s = formatPlain(x, Math.min(col.format.decimals, 4), "INTL");
      if (!examples.includes(s)) examples.push(s);
    }
  }
  return {
    nullCount: v.length - nonNull,
    distinct,
    numeric: {
      min: m.min,
      max: m.max,
      mean: m.mean,
      median: quantileSorted(sorted, 0.5),
      std: m.std,
      q1,
      q3,
      skew: m.skew,
      sum: m.sum,
      outliers,
      zeros,
      negatives,
      integer,
      halfSteps,
    },
    patterns: [],
    examples,
  };
}

/**
 * Frequencies per dictionary code, then top values, value patterns and length
 * statistics. avgLength is row-weighted; dictionary entries no row uses are skipped.
 */
function stringStats(col: StringColumn): BaseStats {
  const counts = new Int32Array(col.dict.length);
  let nulls = 0;
  const codes = col.codes;
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i] as number;
    if (c < 0) nulls++;
    else counts[c] = (counts[c] as number) + 1;
  }
  const nonNull = codes.length - nulls;
  const present: number[] = [];
  let lenSum = 0;
  let maxLength = 0;
  let spaced = 0;
  for (let c = 0; c < counts.length; c++) {
    const n = counts[c] as number;
    if (n === 0) continue;
    present.push(c);
    const s = col.dict[c] as string;
    lenSum += s.length * n;
    if (s.length > maxLength) maxLength = s.length;
    if (s.includes(" ")) spaced += n;
  }
  const distinct = present.length;
  let ordered: number[];
  if (distinct <= 60_000) ordered = present.sort((a, b) => (counts[b] as number) - (counts[a] as number));
  else {
    // Very high cardinality: frequencies are flat, so first-seen values are representative.
    ordered = present.slice(0, 2000);
  }
  const toVc = (c: number): ValueCount => ({ value: col.dict[c] as string, count: counts[c] as number });
  const top = ordered.slice(0, 12).map(toVc);
  // Pattern tests run on at most 2,000 values; detectStringPatterns extrapolates to all non-null rows.
  const sampleForPatterns = ordered.slice(0, 2000).map(toVc);
  const patterns = detectStringPatterns(sampleForPatterns, nonNull);
  const state = detectStatePattern(sampleForPatterns, nonNull);
  const examples: string[] = [];
  for (let i = 0; i < codes.length && examples.length < 5; i++) {
    const c = codes[i] as number;
    if (c >= 0 && !examples.includes(col.dict[c] as string)) examples.push(col.dict[c] as string);
  }
  return {
    nullCount: nulls,
    distinct,
    categorical: {
      top,
      all: distinct <= 250 ? ordered.map(toVc) : undefined,
      avgLength: nonNull ? lenSum / nonNull : 0,
      maxLength,
    },
    patterns,
    examples,
    stateRegion: state?.region,
    spaceShare: nonNull ? spaced / nonNull : 0,
  };
}

/**
 * Range, distinct timestamps and days, and granularity of a date column.
 * Calendar checks run once per distinct day; distinct timestamps are counted
 * exactly from a sorted copy of the non-null values (as for numbers), so
 * `distinct`, `unique` and cardinality hold for any column size.
 */
function dateStats(col: DateColumn): BaseStats {
  const v = col.values;
  let min = Infinity;
  let max = -Infinity;
  let nulls = 0;
  const days = new Set<number>();
  const present = new Float64Array(v.length);
  let k = 0;
  let anyMinute = false;
  let allMonthStart = true;
  let allQuarterStart = true;
  let allYearStart = true;
  const dows = new Int32Array(7);
  for (let i = 0; i < v.length; i++) {
    const x = v[i] as number;
    if (x !== x) {
      nulls++;
      continue;
    }
    if (x < min) min = x;
    if (x > max) max = x;
    const day = Math.floor(x / DAY_MS);
    if (!days.has(day)) {
      days.add(day);
      const d = new Date(day * DAY_MS);
      const dom = d.getUTCDate();
      const mon = d.getUTCMonth();
      if (dom !== 1) {
        allMonthStart = false;
        allQuarterStart = false;
        allYearStart = false;
      } else {
        if (mon % 3 !== 0) allQuarterStart = false;
        if (mon !== 0) allYearStart = false;
      }
      dows[(d.getUTCDay() + 6) % 7]++;
    }
    present[k++] = x;
    if (!anyMinute && col.hasTime && x % 3_600_000 !== 0) anyMinute = true;
  }
  const nonNull = v.length - nulls;
  // TypedArray#sort is numeric; nulls were left out above.
  const sorted = present.subarray(0, k).sort();
  let distinct = 0;
  for (let i = 0; i < sorted.length; i++) if (i === 0 || sorted[i] !== sorted[i - 1]) distinct++;
  // Times present: minute if any value is off the hour, else hour. Date-only: the coarsest period whose
  // starts hold every date (needs two or more days), else week when more than three days all share a
  // weekday, else day.
  let granularity: TemporalStats["granularity"] = "day";
  if (col.hasTime) granularity = anyMinute ? "minute" : "hour";
  else if (days.size > 1 && allYearStart) granularity = "year";
  else if (days.size > 1 && allQuarterStart) granularity = "quarter";
  else if (days.size > 1 && allMonthStart) granularity = "month";
  else if (days.size > 3 && Math.max(...dows) === days.size) granularity = "week";
  const examples: string[] = [];
  for (let i = 0; i < v.length && examples.length < 5; i++) {
    const x = v[i] as number;
    if (x === x) {
      const s = col.timeOnly ? isoTime(x) : col.hasTime ? isoDateTime(x) : isoDate(x);
      if (!examples.includes(s)) examples.push(s);
    }
  }
  return {
    nullCount: nulls,
    distinct,
    temporal: nonNull
      ? {
          min,
          max,
          spanDays: Math.floor(max / DAY_MS) - Math.floor(min / DAY_MS),
          granularity,
          hasTime: col.hasTime,
          distinctDays: days.size,
        }
      : undefined,
    patterns: [],
    examples,
  };
}

function booleanStats(col: BooleanColumn): BaseStats {
  let t = 0;
  let f = 0;
  let nulls = 0;
  for (let i = 0; i < col.values.length; i++) {
    const x = col.values[i] as number;
    if (x === 1) t++;
    else if (x === 0) f++;
    else nulls++;
  }
  return {
    nullCount: nulls,
    distinct: (t > 0 ? 1 : 0) + (f > 0 ? 1 : 0),
    booleanStats: { trueCount: t, falseCount: f },
    patterns: [],
    // Only the values the column holds: a column that only says "No" never shows a "Yes" (or TRUE).
    examples: [...(t > 0 ? [col.trueLabel] : []), ...(f > 0 ? [col.falseLabel] : [])],
  };
}

/** Profiles one column: storage statistics, name tokens and the inferred role. */
export function profileColumn(col: Column, index: number, rowCount: number): ColumnProfile {
  const base =
    col.kind === "number"
      ? numberStats(col)
      : col.kind === "string"
        ? stringStats(col)
        : col.kind === "date"
          ? dateStats(col)
          : booleanStats(col);
  const tokens = tokenize(col.name);
  const nonNull = rowCount - base.nullCount;
  const decision = inferRole({
    name: col.name,
    tokens,
    storage: col.kind,
    rowCount,
    nonNull,
    distinct: base.distinct,
    numeric: base.numeric,
    avgLength: base.categorical?.avgLength,
    patterns: base.patterns,
    currencyFormat: col.kind === "number" ? col.format.currency : undefined,
    percentFormat: col.kind === "number" ? col.format.percent : undefined,
    stateRegion: base.stateRegion,
    spaceShare: base.spaceShare,
    timeOnly: col.kind === "date" && col.timeOnly === true,
  });
  return {
    name: col.name,
    index,
    storage: col.kind,
    role: decision.role,
    roleConfidence: decision.confidence,
    roleReason: decision.reason,
    additivity: decision.additivity,
    defaultAgg: decision.defaultAgg,
    geoLevel: decision.geoLevel,
    geoRegion: decision.geoRegion,
    currency: col.kind === "number" ? col.format.currency : undefined,
    percentScale: decision.percentScale,
    nullCount: base.nullCount,
    nullPct: rowCount ? base.nullCount / rowCount : 0,
    distinct: base.distinct,
    cardinality: nonNull ? base.distinct / nonNull : 0,
    unique: nonNull > 0 && base.distinct === nonNull,
    numeric: base.numeric,
    categorical: base.categorical,
    temporal: base.temporal,
    booleanStats: base.booleanStats,
    patterns: base.patterns,
    tokens,
    examples: base.examples,
  };
}

/**
 * Dataset currency, by strength of evidence: symbols or codes in the values
 * (the code found in most columns), a currency word or symbol in a money
 * column's name, Indian vs US geography, and finally the caller's hint (INR
 * by default).
 */
export function detectCurrency(cols: ColumnProfile[], hint = "INR"): CurrencyInfo {
  const tally = new Map<string, number>();
  for (const c of cols) if (c.currency) tally.set(c.currency, (tally.get(c.currency) ?? 0) + 1);
  if (tally.size) {
    const [code] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0] as [string, number];
    return { code, source: "Currency symbols found in the values", confidence: 0.95 };
  }
  // The header's own currency ("Amount (USD)", "Price (₹)", "Fare in Euros"): tokenize folds every mark
  // into the one token "money", so names.ts reads which currency it is from the raw name.
  for (const c of cols) {
    if (c.role !== "currency" && c.role !== "measure") continue;
    const code = nameCurrency(c.name);
    if (code) return { code, source: `Column name "${c.name}"`, confidence: 0.85 };
  }
  const geoIN = cols.some(
    (c) => c.geoRegion === "IN" || c.patterns.some((p) => p.kind === "pincode" && p.share > 0.8),
  );
  const geoUS = cols.some((c) => c.geoRegion === "US");
  if (geoIN && !geoUS)
    return { code: "INR", source: "Indian states, cities or PIN codes in the data", confidence: 0.7 };
  if (geoUS && !geoIN) return { code: "USD", source: "US states in the data", confidence: 0.65 };
  return {
    code: hint,
    source: "No currency evidence; using your default. Change it in Settings.",
    confidence: 0.3,
  };
}

/**
 * Profiles every column, then the table as a whole: a table of measurements
 * reads its unnamed numbers as readings (roles.ts readingsTable), then keys
 * and grain, hierarchies, the primary date and its gaps, wide format and
 * currency.
 * Deterministic apart from durationMs.
 */
export function profileDataset(ds: Dataset, opts: { currencyHint?: string } = {}): DatasetProfile {
  const started = performance.now();
  const profiled = ds.columns.map((c, i) => profileColumn(c, i, ds.rowCount));
  // A table of measurements (no IDs, dates or amounts) reads its unnamed numbers as readings, averaged.
  // Periods laid out as columns (Jan, Feb, …) hold one measure over time, which may well add up.
  const wide = detectWideFormat(profiled);
  const columns = wide ? profiled : readingsTable(profiled);
  const { keys, grain } = detectKeysAndGrain(ds, columns);
  const hierarchies = detectHierarchies(ds, columns);
  const primaryDate = pickPrimaryDate(columns);
  const pdProfile = primaryDate ? columns.find((c) => c.name === primaryDate) : undefined;
  const timeSeries = pdProfile ? analyseTimeSeries(ds, pdProfile) : null;
  return {
    datasetId: ds.id,
    rowCount: ds.rowCount,
    columnCount: ds.columns.length,
    columns,
    keys,
    grain,
    hierarchies,
    primaryDate,
    timeSeries,
    wide,
    tall: detectTallFormat(ds, columns),
    pairs: detectColumnPairs(columns),
    currency: detectCurrency(columns, opts.currencyHint),
    durationMs: Math.round(performance.now() - started),
  };
}
