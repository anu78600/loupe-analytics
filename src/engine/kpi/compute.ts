/**
 * KPI values for the dashboard: current period, comparison period, sparkline
 * and time-intelligence variants. All KPIs share one row selection and one
 * evaluation cache, so referenced measures are computed once.
 *
 * Comparison rules: with a date filter that starts on the 1st of a month,
 * both ends shift back by the number of calendar months the range spans
 * (Oct 2025 – Sep 2026 compares with Oct 2024 – Sep 2025; a range ending on
 * 15 Sep compares with one ending on 15 Sep a span earlier), so monthly
 * snapshots dated on the 1st and part-months compare like for like. Other
 * date filters compare with the preceding period of equal length in days.
 * With no date filter ("all time"), `value` covers all the data while
 * `current` (labelled by `currentLabel`) is the last complete month and the
 * deltas compare it with the month before; the UI shows that month's value
 * next to the change. Deltas are relative to |previous| and null when it is 0
 * or blank.
 */
import type { Dataset } from "@/engine/core/types";
import {
  addDays,
  addMonths,
  autoGrain,
  bucketLabel,
  DAY_MS,
  endOfBucket,
  endOfDay,
  formatRange,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  type TimeGrain,
  truncate,
} from "@/engine/core/dates";
import type { Expr } from "@/engine/query/expr";
import { isAdditiveExpr } from "@/engine/query/expr";
import { selectRowsCached, type Filter } from "@/engine/query/filter";
import { evaluate, kpiOrUndefined, type Resolver } from "@/engine/query/evaluate";
import { periodScope, runQuery } from "@/engine/query/run";

/** A date window, inclusive wall-clock ms at both ends, with its display label. */
export interface PeriodInfo {
  from: number;
  to: number;
  label: string;
}

export interface KpiValue {
  id: string;
  /** Value for the current selection; null when blank or not finite. */
  value: number | null;
  /**
   * The value the change compares with `previous`. Equal to `value` when a
   * date range is active; in all-time mode it is the latest complete month,
   * because `value` then covers all the data and can't be compared with a
   * single month. The UI shows it whenever `currentLabel` is set, so a delta
   * never sits under a number it doesn't describe.
   */
  current: number | null;
  /** Period of `current` when it differs from the card's period (all-time mode), e.g. "Sep 2026". */
  currentLabel?: string;
  /** Value in the comparison window (see the header for all-time mode). */
  previous: number | null;
  /** Relative change vs previous (fraction). */
  delta: number | null;
  /** Absolute change (for percent KPIs this is the point change). */
  deltaAbs: number | null;
  /**
   * "vs <range>" (plus " (partial)" when the window starts before the data),
   * "<month> vs <month>" in all-time mode, or why there is no comparison.
   */
  comparisonLabel: string;
  /** One point per sparkGrain bucket (t = bucket start ms). */
  spark: Array<{ t: number; v: number | null }>;
  sparkGrain: TimeGrain;
  /** The last spark bucket runs past the end of the data (e.g. a month in progress). */
  partialLast: boolean;
  /** Rows in the current selection. */
  rows: number;
  /** Evaluation error for this KPI (value is then null). */
  error?: string;
}

export interface KpiBatch {
  period: PeriodInfo | null;
  comparison: PeriodInfo | null;
  /**
   * The window the deltas' current values cover when it differs from
   * `period` (all time, like-for-like or no earlier data); null otherwise.
   * Insights use it so they report the same change as the cards.
   */
  current: PeriodInfo | null;
  values: KpiValue[];
}

const finite = (x: number | undefined): number | null => (x !== undefined && Number.isFinite(x) ? x : null);

/**
 * How a date column records time. "month", "quarter" and "year": every value
 * is midnight on the first day of such a period, so each row stands for the
 * whole period (monthly MRR snapshots, a P&L dated 1 Mar). "monthEnd": every
 * value is the last day of its month. "day": anything else.
 */
export type DateCadence = "year" | "quarter" | "month" | "monthEnd" | "day";

interface DateScan {
  min: number;
  max: number;
  cadence: DateCadence;
}

// Datasets are immutable, so one scan per date column is enough.
const scanCache = new WeakMap<Float64Array, DateScan | null>();

function scanDates(values: Float64Array): DateScan | null {
  const hit = scanCache.get(values);
  if (hit !== undefined) return hit;
  let min = Infinity;
  let max = -Infinity;
  let monthStart = true;
  let quarterStart = true;
  let yearStart = true;
  let monthEnd = true;
  let distinct = 0;
  let last = NaN;
  for (let i = 0; i < values.length; i++) {
    const x = values[i] as number;
    if (x !== x) continue;
    if (x < min) min = x;
    if (x > max) max = x;
    if (x !== last) {
      distinct++;
      last = x;
    }
    if (!monthStart && !monthEnd) continue;
    if (x % DAY_MS !== 0) {
      monthStart = quarterStart = yearStart = monthEnd = false;
      continue;
    }
    const d = new Date(x);
    if (d.getUTCDate() !== 1) monthStart = quarterStart = yearStart = false;
    else {
      if (d.getUTCMonth() % 3 !== 0) quarterStart = false;
      if (d.getUTCMonth() !== 0) yearStart = false;
    }
    if (monthEnd && new Date(x + DAY_MS).getUTCDate() !== 1) monthEnd = false;
  }
  let out: DateScan | null = null;
  if (min !== Infinity) {
    // One distinct date is a single snapshot, not evidence of a cadence.
    const cadence: DateCadence =
      distinct < 2
        ? "day"
        : yearStart
          ? "year"
          : quarterStart
            ? "quarter"
            : monthStart
              ? "month"
              : monthEnd
                ? "monthEnd"
                : "day";
    out = { min, max, cadence };
  }
  scanCache.set(values, out);
  return out;
}

/**
 * The period a date column covers over the whole dataset (filters ignored);
 * null if it has no dates. For data recorded once per month, quarter or year
 * on the first day, `max` is the end of the last period: a row dated 1 Sep
 * stands for all of September, so September is complete, not "partial", and
 * presets and comparisons line up with whole periods. Month-end data widens
 * `min` to the start of the first month in the same way. `cadence` says
 * which rule applied.
 */
export function dateBounds(
  ds: Dataset,
  column: string | null,
): { min: number; max: number; cadence: DateCadence } | null {
  if (!column) return null;
  const col = ds.columns.find((c) => c.name === column);
  if (!col || col.kind !== "date") return null;
  const scan = scanDates(col.values);
  if (!scan) return null;
  const { min, max, cadence } = scan;
  switch (cadence) {
    case "year":
      return { min, max: endOfBucket(max, "year"), cadence };
    case "quarter":
      return { min, max: endOfBucket(max, "quarter"), cadence };
    case "month":
      return { min, max: endOfBucket(max, "month"), cadence };
    case "monthEnd":
      return { min: startOfMonth(min), max: endOfDay(max), cadence };
    default:
      return { min, max, cadence };
  }
}

export { defaultPreset, presetRange, type DatePreset } from "@/engine/core/periods";

/** The same filters with the date range on `dateColumn` replaced by [from, to]. */
function replaceDate(filters: readonly Filter[], dateColumn: string, from: number, to: number): Filter[] {
  return [
    ...filters.filter((f) => !(f.kind === "dateRange" && f.column === dateColumn)),
    { kind: "dateRange", column: dateColumn, from, to },
  ];
}

/**
 * Evaluates many measures over one filtered selection with a shared cache.
 * A measure that throws (unmapped field, unavailable ref, text in arithmetic)
 * is reported in `errors` without failing the others.
 */
export function evaluateMany(
  ds: Dataset,
  res: Resolver,
  measures: ReadonlyArray<{ id: string; expr: Expr }>,
  filters: readonly Filter[],
  dateColumn: string | null,
): { values: Map<string, number>; errors: Map<string, string>; rows: number } {
  const rows = selectRowsCached(ds, filters);
  const { periodStart, rowsIgnoringDate } = periodScope(ds, filters, dateColumn);
  const scope = { periodStart, rowsIgnoringDate, ignoringDateGroups: null, periodStartByGroup: null };
  const cache = new Map<string, Float64Array>();
  const values = new Map<string, number>();
  const errors = new Map<string, string>();
  for (const m of measures) {
    try {
      values.set(m.id, evaluate(m.expr, res, scope, rows, null, 1, cache)[0] as number);
    } catch (e) {
      errors.set(m.id, (e as Error).message);
    }
  }
  return { values, errors, rows: rows.length };
}

export interface ComputeKpiInput {
  ds: Dataset;
  resolver: Resolver;
  /** KPI id and expression; deltas are relative for every KPI (the UI derives point changes from deltaAbs). */
  measures: ReadonlyArray<{ id: string; expr: Expr }>;
  filters: readonly Filter[];
  dateColumn: string | null;
  /**
   * When set, no comparison is made and this text becomes the comparison
   * label (used for roster data, where the date marks when an entity
   * started, so any period comparison would compare two cohorts, not two
   * periods).
   */
  noComparisonReason?: string;
}

/** Calendar months touched by [from, to], both inclusive: Oct 2025 – 1 Sep 2026 spans 12. */
function monthsSpanned(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1;
}

/**
 * The two windows a KPI change compares, decided once per batch so the KPI
 * cards and the insights always report the same change.
 *
 * - `current` is the window of the value being compared. It equals the
 *   selected period unless the comparison had to be narrowed; the UI then
 *   shows that window's value beside the change (`KpiValue.currentLabel`).
 * - `comparison` is the earlier window, or null with `label` saying why.
 */
export interface ComparisonPlan {
  current: PeriodInfo | null;
  comparison: PeriodInfo | null;
  label: string;
}

const COMPLETE_SLACK = DAY_MS; // a month ending within a day of the data counts as complete

/**
 * The latest calendar month fully inside `within` and the data, compared with
 * the same month a year earlier when the data covers it (no seasonality),
 * otherwise the month before. Used for "all time" and for ranges that have no
 * earlier data to compare with.
 */
function latestMonthPlan(
  within: { from: number; to: number },
  data: { min: number; max: number },
): ComparisonPlan {
  const lo = Math.max(within.from, startOfDay(data.min));
  const hi = Math.min(within.to, endOfDay(data.max));
  let month = startOfMonth(hi);
  if (endOfBucket(month, "month") > hi + COMPLETE_SLACK) month = addMonths(month, -1);
  if (month < lo) return { current: null, comparison: null, label: "Not enough history to compare" };
  const current: PeriodInfo = {
    from: month,
    to: endOfBucket(month, "month"),
    label: bucketLabel(month, "month", true),
  };
  const covered = (m: number) => m >= startOfDay(data.min);
  const yearAgo = addMonths(month, -12);
  const before = covered(yearAgo) ? yearAgo : covered(addMonths(month, -1)) ? addMonths(month, -1) : null;
  if (before === null) return { current, comparison: null, label: "Not enough history to compare" };
  const comparison: PeriodInfo = {
    from: before,
    to: endOfBucket(before, "month"),
    label: bucketLabel(before, "month", true),
  };
  return { current, comparison, label: `vs ${comparison.label}` };
}

/**
 * Comparison rules (see the file header):
 * - A selected range compares with the same range shifted back by the
 *   calendar months it spans (or by its length in days when it doesn't start
 *   on the 1st).
 * - If the data starts well inside that earlier window (after its first
 *   month, or its first 10% of days), both windows shrink to the part the
 *   data covers in both ("like for like"), so a 12-month period is never
 *   compared with 9 months of data.
 * - With no earlier data at all, or no date filter ("all time"), the latest
 *   complete month is compared (latestMonthPlan).
 */
export function planComparison(
  period: { from: number; to: number },
  data: { min: number; max: number },
  explicitRange: boolean,
): ComparisonPlan {
  if (!explicitRange) return latestMonthPlan(period, data);
  const len = period.to - period.from + 1;
  const monthAligned = startOfMonth(period.from) === period.from;
  const span = monthAligned ? monthsSpanned(period.from, period.to) : 0;
  const back = (t: number) => (span >= 1 ? addMonths(t, -span) : t - len);
  const forward = (t: number) => (span >= 1 ? addMonths(t, span) : t + len);
  const toIsMonthEnd = endOfDay(period.to) >= endOfBucket(period.to, "month");
  const prevFrom = back(period.from);
  const shiftedTo =
    span >= 1 && toIsMonthEnd
      ? endOfBucket(addMonths(startOfMonth(period.to), -span), "month")
      : back(period.to);
  const prevTo = Math.min(shiftedTo, period.from - 1);
  const dataStart = startOfDay(data.min);
  if (prevTo < dataStart) return latestMonthPlan(period, data);
  // The earlier window counts as covered when the data starts in its first
  // month (month windows) or within its first 10% (day windows): the first
  // record arriving on the 5th doesn't mean days 1–4 are missing.
  const covered = span >= 1 ? startOfMonth(data.min) <= prevFrom : dataStart <= prevFrom + 0.1 * len;
  if (covered) {
    const comparison: PeriodInfo = { from: prevFrom, to: prevTo, label: formatRange(prevFrom, prevTo) };
    return { current: null, comparison, label: `vs ${comparison.label}` };
  }
  // Like for like: only the part of both windows that the data covers.
  const curFrom = Math.max(period.from, forward(dataStart));
  const comparison: PeriodInfo = { from: dataStart, to: prevTo, label: formatRange(dataStart, prevTo) };
  const current: PeriodInfo = { from: curFrom, to: period.to, label: formatRange(curFrom, period.to) };
  return { current, comparison, label: `vs ${comparison.label} (like for like)` };
}

/** KPI cards for the current filters: values, comparison window, deltas and sparklines. */
export function computeKpis(input: ComputeKpiInput): KpiBatch {
  const { ds, resolver, measures, filters, dateColumn } = input;
  const bounds = dateBounds(ds, dateColumn);
  const dateFilter = dateColumn
    ? filters.find((f) => f.kind === "dateRange" && f.column === dateColumn)
    : undefined;
  if (!dateColumn || !bounds) return finish(input, null, null, "", null, null, bounds);

  const explicit = Boolean(dateFilter && dateFilter.kind === "dateRange");
  const range =
    dateFilter && dateFilter.kind === "dateRange"
      ? { from: dateFilter.from, to: dateFilter.to }
      : { from: bounds.min, to: bounds.max };
  const period: PeriodInfo = { ...range, label: formatRange(range.from, range.to) };
  if (input.noComparisonReason)
    return finish(input, period, null, input.noComparisonReason, null, null, bounds);

  const plan = planComparison(range, bounds, explicit);
  const prev = plan.comparison
    ? evaluateMany(
        ds,
        resolver,
        measures,
        replaceDate(filters, dateColumn, plan.comparison.from, plan.comparison.to),
        dateColumn,
      )
    : null;
  const base = plan.current
    ? evaluateMany(
        ds,
        resolver,
        measures,
        replaceDate(filters, dateColumn, plan.current.from, plan.current.to),
        dateColumn,
      )
    : null;
  return finish(input, period, plan.comparison, plan.label, prev, base, bounds, plan.current ?? undefined);
}

/**
 * Shared tail of computeKpis: evaluates the current selection, builds the
 * sparklines and assembles the KpiValues. `deltaBase`, when given, replaces
 * the current value as the base of the deltas, and `currentWindow` is the
 * window it covers (named on the cards as `currentLabel`).
 */
function finish(
  input: ComputeKpiInput,
  period: PeriodInfo | null,
  comparison: PeriodInfo | null,
  comparisonLabel: string,
  prev: ReturnType<typeof evaluateMany> | null,
  deltaBase: ReturnType<typeof evaluateMany> | null,
  bounds: { min: number; max: number } | null,
  currentWindow?: PeriodInfo,
): KpiBatch {
  const { ds, resolver, measures, filters, dateColumn } = input;
  const cur = evaluateMany(ds, resolver, measures, filters, dateColumn);
  const base = deltaBase ?? cur;

  // Sparklines: one grouped query for every KPI.
  let spark = new Map<string, Array<{ t: number; v: number | null }>>();
  let sparkGrain: TimeGrain = "month";
  let partialLast = false;
  if (dateColumn && period) {
    const spanDays = (period.to - period.from) / DAY_MS;
    sparkGrain = autoGrain(spanDays);
    const ok = measures.filter((m) => !cur.errors.has(m.id));
    if (ok.length) {
      const q = runQuery(ds, resolver, {
        filters: [...filters],
        groupBy: [{ kind: "time", column: dateColumn, grain: sparkGrain }],
        measures: ok.map((m) => ({ id: m.id, expr: m.expr })),
        dateColumn,
      });
      spark = new Map(
        ok.map((m, j) => [
          m.id,
          q.groups.map((g) => ({ t: g.labels[0]?.raw as number, v: finite(g.values[j]) })),
        ]),
      );
      const lastBucket = q.groups[q.groups.length - 1]?.labels[0]?.raw as number | undefined;
      const dataEnd = bounds ? Math.min(period.to, bounds.max) : period.to;
      // Partial when the data stops more than a day before the last bucket's
      // natural end; a day bucket is never flagged.
      if (lastBucket !== undefined && sparkGrain !== "day") {
        const bucketEnd =
          truncate(dataEnd, sparkGrain) === lastBucket ? endOfBucketSafe(lastBucket, sparkGrain) : dataEnd;
        partialLast = dataEnd < bucketEnd - DAY_MS;
      }
    }
  }

  const values: KpiValue[] = measures.map((m) => {
    const value = finite(cur.values.get(m.id));
    const current = finite(base.values.get(m.id));
    const previous = prev ? finite(prev.values.get(m.id)) : null;
    const deltaAbs = current !== null && previous !== null ? current - previous : null;
    const delta =
      current !== null && previous !== null && previous !== 0
        ? (current - previous) / Math.abs(previous)
        : null;
    return {
      id: m.id,
      value,
      current,
      ...(deltaBase && currentWindow ? { currentLabel: currentWindow.label } : {}),
      previous,
      delta,
      deltaAbs,
      comparisonLabel,
      spark: spark.get(m.id) ?? [],
      sparkGrain,
      partialLast,
      rows: cur.rows,
      error: cur.errors.get(m.id),
    };
  });
  return { period, comparison, current: currentWindow ?? null, values };
}

/** Last millisecond of the bucket that starts at `start`. */
function endOfBucketSafe(start: number, grain: TimeGrain): number {
  switch (grain) {
    case "week":
      return start + 7 * DAY_MS - 1;
    case "month":
      return addMonths(start, 1) - 1;
    case "quarter":
      return addMonths(start, 3) - 1;
    case "year":
      return addMonths(start, 12) - 1;
    default:
      return start + DAY_MS - 1;
  }
}

export interface TimeIntelValue {
  key: string;
  label: string;
  value: number | null;
  period: string;
  /** A relative change (0.12 → +12.0%). */
  percent?: boolean;
  /** A change in percentage points, the difference of two rates (0.012 → +1.2 pp). */
  points?: boolean;
  note?: string;
}

/**
 * Time-intelligence variants as of the end of the selected period.
 * Each value is a fresh evaluation over its own window with the other
 * filters kept, never a sum of daily values, so ratios stay correct: MTD,
 * QTD and YTD up to the end of `asOf`'s day; YTD against the same span a year
 * earlier; MoM between the two full months before `asOf`'s month; rolling
 * 7/30/90 calendar days ending on `asOf`. The 7-day moving average (rolling
 * 7-day value ÷ 7) is offered only for additive measures. For a `rate` (a
 * percent KPI) the YoY and MoM changes are differences in percentage points,
 * as on the KPI cards: 40% → 42% is +2.0 pp, not +5.0%.
 */
export function computeTimeIntel(
  ds: Dataset,
  resolver: Resolver,
  expr: Expr,
  filters: readonly Filter[],
  dateColumn: string,
  asOf: number,
  rate = false,
): TimeIntelValue[] {
  const others = filters.filter((f) => !(f.kind === "dateRange" && f.column === dateColumn));
  const at = (from: number, to: number) =>
    finite(
      evaluateMany(
        ds,
        resolver,
        [{ id: "x", expr }],
        [...others, { kind: "dateRange", column: dateColumn, from, to }],
        dateColumn,
      ).values.get("x"),
    );
  const end = endOfDay(asOf);
  const day = startOfDay(asOf);
  const out: TimeIntelValue[] = [];
  const mtd = at(startOfMonth(asOf), end);
  const qtd = at(startOfQuarter(asOf), end);
  const ytd = at(startOfYear(asOf), end);
  out.push({ key: "mtd", label: "Month to date", value: mtd, period: formatRange(startOfMonth(asOf), end) });
  out.push({
    key: "qtd",
    label: "Quarter to date",
    value: qtd,
    period: formatRange(startOfQuarter(asOf), end),
  });
  out.push({ key: "ytd", label: "Year to date", value: ytd, period: formatRange(startOfYear(asOf), end) });
  const pyFrom = addMonths(startOfYear(asOf), -12);
  const pyTo = addMonths(end, -12);
  const ytdPy = at(pyFrom, pyTo);
  out.push({
    key: "ytd_py",
    label: "YTD same period last year",
    value: ytdPy,
    period: formatRange(pyFrom, pyTo),
  });
  // A rate's change is its difference in points; anything else changes relative to where it was.
  const change = (cur: number | null, prev: number | null) =>
    cur === null || prev === null
      ? null
      : rate
        ? cur - prev
        : prev !== 0
          ? (cur - prev) / Math.abs(prev)
          : null;
  const kind = rate ? { points: true } : { percent: true };
  out.push({
    key: "yoy",
    label: "YoY change (YTD)",
    value: change(ytd, ytdPy),
    period: "YTD vs same period last year",
    ...kind,
  });
  const lastMonthFrom = addMonths(startOfMonth(asOf), -1);
  const prevMonthFrom = addMonths(startOfMonth(asOf), -2);
  const lm = at(lastMonthFrom, startOfMonth(asOf) - 1);
  const pm = at(prevMonthFrom, lastMonthFrom - 1);
  out.push({
    key: "mom",
    label: "MoM change (last full month)",
    value: change(lm, pm),
    period: `${bucketLabel(lastMonthFrom, "month", true)} vs ${bucketLabel(prevMonthFrom, "month", true)}`,
    ...kind,
  });
  for (const n of [7, 30, 90]) {
    out.push({
      key: `r${n}`,
      label: `Rolling ${n} days`,
      value: at(addDays(day, -(n - 1)), end),
      period: formatRange(addDays(day, -(n - 1)), end),
    });
  }
  if (isAdditiveExpr(expr, (id) => kpiOrUndefined(resolver, id))) {
    const r7 = out.find((x) => x.key === "r7")?.value ?? null;
    out.push({
      key: "ma7",
      label: "7-day moving average",
      value: r7 === null ? null : r7 / 7,
      period: "Average daily value, trailing 7 days",
    });
  } else {
    out.push({
      key: "ma7",
      label: "7-day moving average",
      value: null,
      period: "—",
      note: "Not shown for ratios: averaging daily ratios misweights days. Use the rolling 7-day value instead.",
    });
  }
  return out;
}
