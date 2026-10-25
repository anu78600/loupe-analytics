/**
 * Auto-generated findings. Every number comes from a query over the data;
 * nothing is invented. Each insight states its basis, is ranked by impact and
 * links to the chart that shows it: a chart of the same KPI (and, for a
 * segment gap or a concentration, the same column), else none.
 *
 * Generators: trends (the selected period against its comparison period, and
 * the latest complete month against a year earlier), a Simpson's-paradox mix
 * check, segment gaps for rates and ratios, anomalies (robust z-score with
 * MAD), driver bands (from computed bin charts), what moves the outcome (the
 * strongest number and the strongest category, worked out on the selected
 * rows by understand/drivers.ts; version 49.0), concentration (top 20%
 * share), seasonality (weekday, month of year) and caveats. Each runs inside
 * `safely`, so a failing generator yields nothing instead of breaking the
 * others. All of them read the selection only: an empty one has no insights,
 * and the caveats count its own rows.
 *
 * Totals and rates. isAdditiveExpr, following KPI refs through the resolver
 * (net revenue = gross sales − discounts counts as additive), picks the totals
 * that anomalies, concentration and seasonality add up across days or items.
 * measureKind() also follows refs and separates totals (sums, counts, distinct
 * counts, new entities: they grow with the rows they cover) from rates
 * (ratios of totals, averages). Segment gaps and the mix check compare rates
 * only: between segments, a difference in a total is a share of the whole,
 * not a performance gap. Nor is a rate measured per entity across segments
 * the entities span (a customer's orders under several couriers, a rep in
 * every category; entityFields). Over time, closing balances (atLatest) are
 * levels, so only flows (revenue, orders) are scaled per day when windows
 * differ. Values compared in one sentence share a precision (core/together).
 *
 * Scoring. Every generator rates its findings with one formula, so impact
 * scores are comparable across generators:
 *
 *   impact = 100 × relevance × weight × strength × certainty      (0–100)
 *
 * - relevance (RELEVANCE): how directly the kind of finding bears on a
 *   decision. 1 for the headline trend: the lead KPI (the first hero) over
 *   the primary comparison, which is the selected period against its
 *   comparison period, else the latest complete month against a year
 *   earlier. 0.9 for other KPIs' trends and the mix check, 0.85 segment gaps,
 *   0.8 a latest month running against the period's trend, 0.75 drivers, 0.65
 *   anomalies, 0.6 concentration, 0.55 seasonality. Caveats: 0.95 for a small
 *   selection (it qualifies every other finding), 0.65 for orders still in
 *   progress.
 * - weight: hero KPI 1, supporting 0.8, detail 0.6; 1 when no KPI is involved.
 * - strength = 1 − e^(−effect / scale): 0.63 when the effect equals the scale
 *   of its generator, approaching 1 beyond it. Effect / scale: relative
 *   change / 20%, or point change / 4 pp for percent KPIs (trends); ratio − 1
 *   / 1, or point gap / 5 pp for percent KPIs (segments), times a reach factor
 *   of 0.5–1 from the share of rows in the segment to act on (1 from 25%);
 *   point gap / 5 pp (drivers); |z| / 8 (anomalies); top-20% share above an
 *   even 20% / 40 pp (concentration); weekday gap / 50% and month lift / 40%
 *   (seasonality); in-progress share / 20% (caveat). The mix check uses the
 *   row-weighted share of segments that moved against the headline; a small
 *   selection counts as 1.
 * - certainty: high 1, medium 0.85, low 0.6, shown as the confidence. Trends
 *   run a sign test over matching sub-periods (months, weeks or days): most
 *   of them moving the headline's way with p ≤ 0.05 is high, a change most
 *   sub-periods don't share is low, and too few sub-periods (or a per-entity
 *   measure, whose value depends on the window's length) is medium.
 */
import { article, wasWere } from "@/engine/core/labels";
import type { Dataset } from "@/engine/core/types";
import {
  addMonths,
  bucketLabel,
  DAY_MS,
  endOfDay,
  formatDay,
  startOfDay,
  startOfMonth,
  WEEKDAYS_LONG,
} from "@/engine/core/dates";
import { formatDelta, formatPointDelta, formatValue, type FormatOptions } from "@/engine/core/format";
import { linearRegression, median, robustSigma } from "@/engine/core/stats";
import { formatTogether } from "@/engine/core/together";
import type { Expr, Predicate } from "@/engine/query/expr";
import { fieldsOf, isAdditiveExpr, refsOf as refsOfExpr } from "@/engine/query/expr";
import { selectRowsCached, type Filter } from "@/engine/query/filter";
import { kpiOrUndefined, type Resolver } from "@/engine/query/evaluate";
import { runQuery, type ResultGroup } from "@/engine/query/run";
import { dateBounds, evaluateMany, type KpiBatch } from "@/engine/kpi/compute";
import type { ChartData, ChartSpec } from "@/engine/charts/types";
import type { KpiFormat } from "@/registry/schema";
import type { DatasetProfile } from "@/engine/profile/types";
import type { ColumnKind } from "@/engine/understand/types";
import {
  CLEAR_LINK,
  MIN_STRENGTH,
  rankDrivers,
  type DriverDetail,
  type OutcomeTarget,
} from "@/engine/understand/drivers";

export type InsightKind =
  "trend" | "anomaly" | "concentration" | "seasonality" | "segment" | "driver" | "mix" | "caveat";

/** What each kind of insight is called: one wording for the app and the insights PDF. */
export const INSIGHT_KIND_LABEL: Record<InsightKind, string> = {
  trend: "Trend",
  anomaly: "Anomaly",
  concentration: "Concentration",
  seasonality: "Seasonality",
  segment: "Segment gap",
  driver: "Driver",
  mix: "Mix effect",
  caveat: "Caveat",
};

export interface Insight {
  id: string;
  kind: InsightKind;
  title: string;
  body: string;
  tone: "positive" | "negative" | "neutral" | "warning";
  /** Ranking score, 0–100, from the formula in the file header; comparable across generators. */
  impact: number;
  /** Certainty of the finding (a factor of the impact): sample size and, for trends, a sign test. */
  confidence: "high" | "medium" | "low";
  /** KPI the insight is about. */
  metricId?: string;
  /** Chart that shows it, when one exists. */
  chartId?: string;
  /** How the numbers were derived, in one sentence. */
  basis: string;
  /**
   * The finding as 2-5 short bullet points (MAX_POINTS), each one fact with its figure ("Electronics: 30.9%",
   * "Gap: 22.0 pp"), for a reader who scans (version 54.0). Same figures as the body, never new ones.
   */
  points: string[];
  /**
   * The finding in everyday words with its numbers, one or two sentences, without analyst terms
   * (no medians, ratios or p-values): what happened, by how much, and whether it is good news.
   */
  plain: string;
}

export interface InsightKpi {
  id: string;
  /** Display name, after the user's renames. */
  name: string;
  expr: Expr;
  format: KpiFormat;
  direction: "higher" | "lower" | "neutral";
  tier: "hero" | "supporting" | "detail";
}

export interface InsightInput {
  ds: Dataset;
  resolver: Resolver;
  filters: readonly Filter[];
  dateColumn: string | null;
  /** Hero KPIs first; the first one is the lead KPI of the headline trend. */
  kpis: InsightKpi[];
  /**
   * Current KPI batch: trends take its period and comparison windows, the
   * mix check its deltas, caveats its row count.
   */
  batch: KpiBatch | null;
  /** Mapped dimension columns worth segmenting by, with display labels. */
  segments: Array<{ column: string; label: string }>;
  /** Column used for concentration (e.g. product name) and its label. */
  concentration?: { column: string; label: string };
  /** Status column and the raw values that mean "still in progress". */
  inProgress?: { column: string; values: string[] };
  /**
   * Roster data (one row per employee, customer, …): its date marks when an
   * entity started, so the time-based generators (trends, period mix,
   * anomalies, weekday patterns) would compare cohorts as if they were
   * periods. They are skipped, matching the KPI cards, which show no
   * period comparison for rosters.
   */
  roster?: boolean;
  specs: ChartSpec[];
  /** Already computed chart data, keyed by spec id (driver insights read bin charts from it). */
  chartData: Map<string, ChartData>;
  fmt: FormatOptions;
  /**
   * The table's outcome (understand/understand.ts), so what moves it can be
   * worked out on the selected rows: the analysis profile, the outcome read
   * from its rows, each column's kind and what the rows are called. Absent
   * when the table has none.
   */
  outcome?: {
    profile: DatasetProfile;
    target: OutcomeTarget;
    kinds: ReadonlyMap<string, ColumnKind>;
    rowsWord: string;
  };
}

// ---------------------------------------------------------------- scoring

type Certainty = Insight["confidence"];

/** How directly each kind of finding bears on a decision (see the header). */
const RELEVANCE = {
  /** The lead KPI over the primary comparison. */
  headline: 1,
  /** Another KPI over the primary comparison. */
  trend: 0.9,
  /** A headline change that reverses within most segments. */
  mix: 0.9,
  segment: 0.85,
  /** The latest month running against the selected period's trend. */
  momentum: 0.8,
  driver: 0.75,
  anomaly: 0.65,
  concentration: 0.6,
  seasonality: 0.55,
  /** Too few rows: qualifies every other finding, so it leads. */
  smallSelection: 0.95,
  inProgress: 0.65,
} as const;

const CERTAINTY: Record<Certainty, number> = { high: 1, medium: 0.85, low: 0.6 };

/** Saturating effect size in [0, 1): 0.63 when the effect equals its generator's scale. */
const strength = (effect: number, scale: number): number =>
  effect > 0 && scale > 0 ? 1 - Math.exp(-effect / scale) : 0;

/** The shared ranking formula (see the header), rounded to one decimal. */
function impactScore(relevance: number, weight: number, s: number, certainty: Certainty): number {
  return Math.round(1000 * relevance * weight * Math.min(1, Math.max(0, s)) * CERTAINTY[certainty]) / 10;
}

// Percent KPIs change in points rather than relative %, and hero KPIs weigh more in impact.
const isRate = (f: KpiFormat) => f === "percent";
const weight = (k: Pick<InsightKpi, "tier">) => (k.tier === "hero" ? 1 : k.tier === "supporting" ? 0.8 : 0.6);

function toneFor(direction: InsightKpi["direction"], change: number): Insight["tone"] {
  if (direction === "neutral" || change === 0) return "neutral";
  return change > 0 === (direction === "higher") ? "positive" : "negative";
}

/** "an 85.8 pp gap", "a 5.2 pp gap". */
const gapText = (pp: string) => `${article(pp)} ${pp} gap`;

/**
 * A plain verdict on a change by the KPI's direction (version 54.0): good news when it moved the way that
 * is better, worth a look when it moved the other way, nothing for a KPI that is read in context.
 */
/** Insight.points never run longer than this, so they can be scanned. */
const MAX_POINTS = 5;

function verdict(k: Pick<InsightKpi, "direction">, change: number): string {
  if (k.direction === "neutral" || change === 0) return "";
  return change > 0 === (k.direction === "higher") ? " That is good news." : " That is worth a look.";
}

function chartFor(specs: ChartSpec[], predicate: (s: ChartSpec) => boolean): string | undefined {
  return specs.find(predicate)?.id;
}

/** Runs one generator; an exception means no insights from it, never a broken panel. */
function safely<T>(fn: () => T[]): T[] {
  try {
    return fn();
  } catch {
    return [];
  }
}

/** "a", "a and b", "a, b and c". */
function joinAnd(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A formatted signed change without its sign, for titles that say "up" or "down". */
const unsigned = (text: string) => text.replace(/^[+−]/, "");

/** English plural of a lower-case label: category → categories, box → boxes, product → products. */
const pluralOf = (word: string) =>
  /[^aeiou]y$/.test(word)
    ? `${word.slice(0, -1)}ies`
    : /(s|x|z|ch|sh)$/.test(word)
      ? `${word}es`
      : `${word}s`;

// ---------------------------------------------------------------- measure kinds

/** Whether a KPI can be summed across groups, following its refs (see isAdditiveExpr). */
function additive(input: Pick<InsightInput, "resolver">, k: Pick<InsightKpi, "expr">): boolean {
  return isAdditiveExpr(k.expr, (id) => kpiOrUndefined(input.resolver, id));
}

export type MeasureKind = "total" | "rate" | "constant" | "other";

/**
 * Whether a measure is a total, which grows with the rows it covers (sums,
 * counts, distinct counts, new entities, and their sums and differences), or
 * a rate, which does not (a ratio of totals, an average, a maximum). Follows
 * KPI refs through `lookup`. Anything else ("other") is neither: a span of
 * days, a product of two totals, an unresolved ref, or an average per entity
 * of a total, which grows with a segment when the entity spans segments
 * (average daily stock by category) but not when segments split the entities
 * (average spend per customer by channel).
 */
export function measureKind(
  e: Expr,
  lookup?: (id: string) => Expr | undefined,
  path: ReadonlySet<string> = new Set(),
): MeasureKind {
  if ("num" in e) return "constant";
  if ("agg" in e)
    return e.agg === "sum" || e.agg === "count" || e.agg === "countDistinct"
      ? "total"
      : e.agg === "spanDays"
        ? "other"
        : "rate";
  if ("newEntities" in e) return "total";
  if ("calc" in e) return measureKind(e.calc, lookup, path);
  if ("atLatest" in e) return measureKind(e.expr, lookup, path);
  if ("per" in e) {
    if (e.reduce === "count" || e.reduce === "sum") return "total";
    return measureKind(e.inner, lookup, path) === "total" ? "other" : "rate";
  }
  if ("ref" in e) {
    if (!lookup || path.has(e.ref)) return "other";
    const target = lookup(e.ref);
    return target ? measureKind(target, lookup, new Set(path).add(e.ref)) : "other";
  }
  if ("op" in e) {
    const a = measureKind(e.args[0], lookup, path);
    const b = measureKind(e.args[1], lookup, path);
    if (e.op === "add" || e.op === "sub")
      return a === "constant" ? b : b === "constant" ? a : a === b ? a : "other";
    if (e.op === "mul") {
      if (a === "constant") return b;
      if (b === "constant") return a;
      if (a === "rate" && b === "rate") return "rate";
      return (a === "rate" && b === "total") || (a === "total" && b === "rate") ? "total" : "other";
    }
    // div: scaling by a constant keeps the kind; total ÷ total and rate ÷ rate are rates.
    if (b === "constant") return a;
    if (a === b && (a === "total" || a === "rate")) return "rate";
    return a === "total" && b === "rate" ? "total" : "other";
  }
  return "other";
}

const kindOf = (input: Pick<InsightInput, "resolver">, k: Pick<InsightKpi, "expr">): MeasureKind =>
  measureKind(k.expr, (id) => kpiOrUndefined(input.resolver, id));

/**
 * Whether a measure is a closing balance (atLatest, e.g. MRR or stock on
 * hand), following refs and constant scaling. Across segments it is a total,
 * but over time it is a level: a longer window does not make it bigger.
 */
function isStock(resolver: Resolver, e: Expr, path: ReadonlySet<string> = new Set()): boolean {
  if ("atLatest" in e) return true;
  if ("calc" in e) return isStock(resolver, e.calc, path);
  if ("ref" in e) {
    const target = path.has(e.ref) ? undefined : kpiOrUndefined(resolver, e.ref);
    return target ? isStock(resolver, target, new Set(path).add(e.ref)) : false;
  }
  if ("op" in e) {
    const [a, b] = e.args;
    if ("num" in a) return isStock(resolver, b, path);
    if ("num" in b) return isStock(resolver, a, path);
    return (e.op === "add" || e.op === "sub") && isStock(resolver, a, path) && isStock(resolver, b, path);
  }
  return false;
}

/** A total that accumulates over time (revenue, orders), so a longer window holds more of it. */
const isFlow = (input: Pick<InsightInput, "resolver">, k: Pick<InsightKpi, "expr">) =>
  kindOf(input, k) === "total" && !isStock(input.resolver, k.expr);

/**
 * Columns a KPI's own definition filters on (where, calc and having
 * conditions, following refs): COD share tests the payment method, so its
 * gap between payment methods holds by construction.
 */
function filterColumns(
  resolver: Resolver,
  e: Expr,
  out = new Set<string>(),
  path: ReadonlySet<string> = new Set(),
): Set<string> {
  const add = (p: Predicate) => {
    for (const field of fieldsOf(p)) {
      try {
        out.add(resolver.column(field).name);
      } catch {
        // An unmapped field filters nothing on this dataset.
      }
    }
  };
  if ("agg" in e) {
    if (e.where) add(e.where);
  } else if ("calc" in e) {
    add(e.where);
    filterColumns(resolver, e.calc, out, path);
  } else if ("per" in e) {
    filterColumns(resolver, e.inner, out, path);
    if (e.having) filterColumns(resolver, e.having.expr, out, path);
  } else if ("atLatest" in e) filterColumns(resolver, e.expr, out, path);
  else if ("op" in e) for (const a of e.args) filterColumns(resolver, a, out, path);
  else if ("ref" in e && !path.has(e.ref)) {
    const target = kpiOrUndefined(resolver, e.ref);
    if (target) filterColumns(resolver, target, out, new Set(path).add(e.ref));
  }
  return out;
}

// ---------------------------------------------------------------- trends

/** A date window, inclusive wall-clock ms at both ends. */
interface DateWindow {
  from: number;
  to: number;
}

const dateFilterOn = (filters: readonly Filter[], column: string) => {
  const f = filters.find((x) => x.kind === "dateRange" && x.column === column);
  return f && f.kind === "dateRange" ? f : undefined;
};

/** The same filters with the date range on `column` replaced by `w`. */
const withDates = (filters: readonly Filter[], column: string, w: DateWindow): Filter[] => [
  ...filters.filter((f) => !(f.kind === "dateRange" && f.column === column)),
  { kind: "dateRange", column, from: w.from, to: w.to },
];

const daysIn = (w: DateWindow) => (w.to - w.from + 1) / DAY_MS;
const coveredDays = (w: DateWindow, data: DateWindow) =>
  Math.max(0, Math.min(w.to, data.to) - Math.max(w.from, data.from) + 1) / DAY_MS;

/** Whole calendar months in a window that starts on the 1st. */
function wholeMonths(w: DateWindow): number {
  let n = 0;
  while (addMonths(w.from, n + 1) - 1 <= w.to) n++;
  return n;
}

/** Change from `prev` to `cur`: relative for totals and ratios, in points for percent KPIs; null when undefined. */
function changeBetween(k: InsightKpi, cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (isRate(k.format)) return cur - prev;
  return prev !== 0 ? (cur - prev) / Math.abs(prev) : null;
}
const changeText = (k: InsightKpi, change: number, fmt: FormatOptions) =>
  isRate(k.format) ? formatPointDelta(change, fmt.locale) : formatDelta(change, fmt.locale);
/** 5% for totals and ratios, 1 point for percent KPIs. */
const isMaterial = (k: InsightKpi, change: number) => Math.abs(change) >= (isRate(k.format) ? 0.01 : 0.05);
const changeStrength = (k: InsightKpi, change: number) =>
  strength(Math.abs(change), isRate(k.format) ? 0.04 : 0.2);

/**
 * Two-sided sign test: the chance of a split at least this lopsided among `n`
 * paired sub-periods if rises and falls were equally likely (ties are left
 * out by the caller).
 */
export function signTestP(agree: number, n: number): number {
  if (n <= 0) return 1;
  const most = Math.max(agree, n - agree);
  // Sum of C(n, i) for i = most..n, walking down from C(n, n) = 1.
  let coef = 1;
  let tail = 0;
  for (let i = n; i >= most; i--) {
    tail += coef;
    coef = (coef * i) / (n - i + 1);
  }
  return Math.min(1, 2 * tail * Math.pow(0.5, n));
}

/** Sign test result over matching sub-periods. */
interface Consistency {
  agree: number;
  n: number;
  p: number;
  /** Sub-period unit: "month", "week", "day" or "2-week block". */
  unit: string;
  /** How sub-periods are paired, e.g. "the same month a year earlier". */
  match: string;
}

const MIN_SIGN_TEST = 6;
/** Consistent: most sub-periods moved the headline's way, and more lopsidedly than chance would (p ≤ 0.05). */
const isConsistent = (t: Consistency) => t.agree * 2 > t.n && t.p <= 0.05;
const certaintyOf = (t: Consistency | null): Certainty =>
  !t || t.n < MIN_SIGN_TEST ? "medium" : isConsistent(t) ? "high" : "low";
const plural = (unit: string, n: number) => `${unit}${n === 1 ? "" : "s"}`;
const pText = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);

function consistencyText(t: Consistency | null, up: boolean): string {
  if (!t || t.n === 0) return "";
  if (t.n < MIN_SIGN_TEST)
    return `Only ${t.n} matching ${plural(t.unit, t.n)} ${t.n === 1 ? "is" : "are"} fully covered by the data, too few to test whether the change is consistent.`;
  const dir = up ? "higher" : "lower";
  if (isConsistent(t)) return `It was ${dir} in ${t.agree} of ${t.n} ${plural(t.unit, t.n)} than ${t.match}.`;
  return `It was ${dir} in only ${t.agree} of ${t.n} ${plural(t.unit, t.n)} than ${t.match}, so the change is not consistent across the period.`;
}

/**
 * Whether a KPI aggregates per entity (repeat customers, spend per customer),
 * following refs. Its value depends on the window's length, so a month of a
 * 12-month period is a different measure and can't test the period's change.
 */
function perEntity(resolver: Resolver, e: Expr, path: ReadonlySet<string> = new Set()): boolean {
  if ("per" in e) return true;
  if ("calc" in e) return perEntity(resolver, e.calc, path);
  if ("atLatest" in e) return perEntity(resolver, e.expr, path);
  if ("op" in e) return e.args.some((a) => perEntity(resolver, a, path));
  if ("ref" in e && !path.has(e.ref)) {
    const target = kpiOrUndefined(resolver, e.ref);
    return target ? perEntity(resolver, target, new Set(path).add(e.ref)) : false;
  }
  return false;
}

/**
 * The entities a KPI is measured per (following refs): the `per` field of a
 * per-entity aggregate (repeat customers) and the field a ratio divides by a
 * distinct count of (revenue per sales rep, per customer, per order).
 * Compared across segments that share those entities, such a KPI is not a
 * performance gap: a customer's orders split across couriers, and 11 reps who
 * sell every category make "revenue per rep" by category just category
 * revenue over 11.
 */
function entityFields(resolver: Resolver, e: Expr, path: ReadonlySet<string> = new Set()): string[] {
  const follow = (x: Expr): string[] => entityFields(resolver, x, path);
  /** Fields of the distinct counts an expression adds up to (its divisor's entities). */
  const counted = (x: Expr, p: ReadonlySet<string>): string[] => {
    if ("agg" in x) return x.agg === "countDistinct" ? [x.of] : [];
    if ("calc" in x) return counted(x.calc, p);
    if ("op" in x && (x.op === "add" || x.op === "sub"))
      return [...counted(x.args[0], p), ...counted(x.args[1], p)];
    if ("ref" in x && !p.has(x.ref)) {
      const target = kpiOrUndefined(resolver, x.ref);
      return target ? counted(target, new Set(p).add(x.ref)) : [];
    }
    return [];
  };
  if ("per" in e) return [e.per];
  if ("calc" in e) return follow(e.calc);
  if ("atLatest" in e) return follow(e.expr);
  if ("op" in e)
    return [...follow(e.args[0]), ...follow(e.args[1]), ...(e.op === "div" ? counted(e.args[1], path) : [])];
  if ("ref" in e && !path.has(e.ref)) {
    const target = kpiOrUndefined(resolver, e.ref);
    return target ? entityFields(resolver, target, new Set(path).add(e.ref)) : [];
  }
  return [];
}

const testBasis = (t: Consistency | null) =>
  t && t.n >= MIN_SIGN_TEST
    ? ` Consistency: sign test over ${t.n} matching ${plural(t.unit, t.n)} (${pText(t.p)}).`
    : "";

/**
 * Sign test of each KPI's direction over matching sub-periods of two windows:
 * calendar months when both start on the 1st and hold six or more whole
 * months, else blocks of whole weeks (at most 26 blocks) or, under six weeks,
 * days, counted from each window's start. Only pairs the data covers in full
 * count, and flows are compared per day so months of different lengths stay
 * comparable.
 */
function consistency(
  input: InsightInput,
  items: Array<{ k: InsightKpi; up: boolean }>,
  cur: DateWindow,
  cmp: DateWindow,
  data: DateWindow,
): Map<string, Consistency> {
  const out = new Map<string, Consistency>();
  const { ds, resolver, filters, dateColumn } = input;
  if (!dateColumn || !items.length) return out;
  const months =
    startOfMonth(cur.from) === cur.from && startOfMonth(cmp.from) === cmp.from
      ? Math.min(wholeMonths(cur), wholeMonths(cmp))
      : 0;
  let unit: string;
  let count: number;
  let block: (w: DateWindow, i: number) => DateWindow;
  if (months >= MIN_SIGN_TEST) {
    unit = "month";
    count = months;
    block = (w, i) => ({ from: addMonths(w.from, i), to: addMonths(w.from, i + 1) - 1 });
  } else {
    const days = Math.floor(Math.min(daysIn(cur), daysIn(cmp)));
    const weeks = Math.floor(days / 7);
    const size = weeks >= MIN_SIGN_TEST ? 7 * Math.ceil(weeks / 26) : 1;
    unit = size === 1 ? "day" : size === 7 ? "week" : `${size / 7}-week block`;
    count = Math.floor(days / size);
    block = (w, i) => ({ from: w.from + i * size * DAY_MS, to: w.from + (i + 1) * size * DAY_MS - 1 });
  }
  const match =
    unit === "month" && addMonths(cmp.from, 12) === cur.from
      ? "the same month a year earlier"
      : `the matching ${unit} of the comparison period`;
  const flows = new Set(items.filter(({ k }) => isFlow(input, k)).map(({ k }) => k.id));
  const measures = items.map(({ k }) => ({ id: k.id, expr: k.expr }));
  const agree = new Map<string, number>();
  const n = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const a = block(cur, i);
    const b = block(cmp, i);
    if (a.to > cur.to || b.to > cmp.to) break;
    if (a.from < data.from || b.from < data.from || a.to > data.to || b.to > data.to) continue;
    const va = evaluateMany(ds, resolver, measures, withDates(filters, dateColumn, a), dateColumn).values;
    const vb = evaluateMany(ds, resolver, measures, withDates(filters, dateColumn, b), dateColumn).values;
    for (const { k, up } of items) {
      const x = (va.get(k.id) ?? NaN) / (flows.has(k.id) ? daysIn(a) : 1);
      const y = (vb.get(k.id) ?? NaN) / (flows.has(k.id) ? daysIn(b) : 1);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x === y) continue;
      n.set(k.id, (n.get(k.id) ?? 0) + 1);
      if (x > y === up) agree.set(k.id, (agree.get(k.id) ?? 0) + 1);
    }
  }
  for (const { k } of items) {
    const nk = n.get(k.id) ?? 0;
    const ak = agree.get(k.id) ?? 0;
    out.set(k.id, { agree: ak, n: nk, p: signTestP(ak, nk), unit, match });
  }
  return out;
}

/** One KPI's change over one comparison, before folding and scoring. */
interface TrendFinding {
  k: InsightKpi;
  /** "period": the selected period against its comparison period; "month": the latest complete month. */
  comparison: "period" | "month";
  /** The latest month while a period comparison exists for the KPI (a momentum note). */
  secondary: boolean;
  change: number;
  certainty: Certainty;
  title: string;
  /** Body sentences in order; folding appends the co-moving totals. */
  sentences: string[];
  /** Insight.points and Insight.plain; folding adds the co-moving totals to the points. */
  points: string[];
  plain: string;
  basis: string;
}

/**
 * Plain-language name for the comparison window: "the previous 12 months"
 * when it directly precedes a whole-month window of the same length, "the
 * same period a year earlier" for a window shifted back by a year, otherwise
 * the window's own label ("August 2026", "1 Jan – 30 Sep 2025").
 */
function comparisonPhrase(cur: DateWindow, cmp: DateWindow, label: string): string {
  const monthsOf = (w: DateWindow) =>
    startOfMonth(w.from) === w.from && endOfDay(w.to) === w.to && startOfMonth(w.to + 1) === w.to + 1
      ? wholeMonths(w)
      : 0;
  const n = monthsOf(cur);
  if (n > 1 && monthsOf(cmp) === n && cmp.to + 1 === cur.from) return `the previous ${n} months`;
  if (n !== 1 && addMonths(cur.from, -12) === cmp.from) return "the same period a year earlier";
  return label;
}

/**
 * The selected period against its comparison period (the KPI cards'
 * windows) for each target KPI, when a date range is set. Material from a 5%
 * change (1 point for percent KPIs). Flows (totals that accumulate over time)
 * need both windows at least half covered by the data and are compared per
 * day when the covered lengths differ by more than 2% (e.g. a partial
 * comparison window); rates and closing balances compare as they are.
 * Returns the material findings and every KPI's computed change.
 */
function periodTrends(
  input: InsightInput,
  targets: InsightKpi[],
): { findings: TrendFinding[]; changes: Map<string, number> } {
  const { ds, resolver, filters, dateColumn, batch, fmt } = input;
  const changes = new Map<string, number>();
  if (!dateColumn || !batch?.period || !batch.comparison || !dateFilterOn(filters, dateColumn))
    return { findings: [], changes };
  const bounds = dateBounds(ds, dateColumn);
  if (!bounds) return { findings: [], changes };
  // Exactly the KPI cards' windows: `batch.current` when the comparison was
  // narrowed (like for like, or the latest month), so both report one change.
  const curInfo = batch.current ?? batch.period;
  const cur: DateWindow = { from: curInfo.from, to: curInfo.to };
  const cmp: DateWindow = { from: batch.comparison.from, to: batch.comparison.to };
  const data: DateWindow = { from: startOfDay(bounds.min), to: endOfDay(bounds.max) };
  const curDays = coveredDays(cur, data);
  const cmpDays = coveredDays(cmp, data);
  if (!(curDays > 0 && cmpDays > 0)) return { findings: [], changes };
  const thin = curDays < 0.5 * daysIn(cur) || cmpDays < 0.5 * daysIn(cmp);
  const perDay = Math.abs(curDays - cmpDays) > Math.max(1, 0.02 * Math.max(curDays, cmpDays));
  const measures = targets.map((k) => ({ id: k.id, expr: k.expr }));
  const now = evaluateMany(ds, resolver, measures, withDates(filters, dateColumn, cur), dateColumn).values;
  const before = evaluateMany(ds, resolver, measures, withDates(filters, dateColumn, cmp), dateColumn).values;
  const found: Array<{ k: InsightKpi; a: number; b: number; change: number; daily: boolean }> = [];
  for (const k of targets) {
    const flow = isFlow(input, k);
    if (flow && thin) continue;
    const daily = flow && perDay;
    const a = (now.get(k.id) ?? NaN) / (daily ? curDays : 1);
    const b = (before.get(k.id) ?? NaN) / (daily ? cmpDays : 1);
    const change = changeBetween(k, a, b);
    if (change === null) continue;
    changes.set(k.id, change);
    if (isMaterial(k, change)) found.push({ k, a, b, change, daily });
  }
  const tested = found.filter(({ k }) => !perEntity(resolver, k.expr));
  const tests = consistency(
    input,
    tested.map(({ k, change }) => ({ k, up: change > 0 })),
    cur,
    cmp,
    data,
  );
  const against = comparisonPhrase(cur, cmp, batch.comparison.label);
  const findings = found.map(({ k, a, b, change, daily }): TrendFinding => {
    // A day's share of a count is fractional, so per-day counts get decimals; the two values share a precision.
    const [fa, fb] = formatTogether([a, b], daily && k.format === "integer" ? "decimal" : k.format, fmt);
    const text = changeText(k, change, fmt);
    const t = tests.get(k.id) ?? null;
    const untested = perEntity(resolver, k.expr)
      ? " Not tested over sub-periods: a per-entity measure depends on the length of its window."
      : "";
    return {
      k,
      comparison: "period",
      secondary: false,
      change,
      certainty: certaintyOf(t),
      title: `${k.name} ${change > 0 ? "up" : "down"} ${unsigned(text)} vs ${against}${daily ? " (per day)" : ""}`,
      points: [
        `${curInfo.label}: ${fa}${daily ? " a day" : ""}`,
        `${batch.comparison?.label}: ${fb}${daily ? " a day" : ""}`,
        `Change: ${text}`,
        ...(t && t.n >= MIN_SIGN_TEST ? [`Held in ${t.agree} of ${t.n} ${t.unit}s`] : []),
      ],
      plain: `${k.name} went ${change > 0 ? "up" : "down"} by ${unsigned(text)}: from ${fb} to ${fa}${daily ? " a day" : ""}.${verdict(k, change)}`,
      sentences: [
        daily
          ? `${k.name} averaged ${fa} a day in ${curInfo.label}, ${text} vs ${fb} a day in ${batch.comparison?.label}; the data covers ${Math.round(curDays)} and ${Math.round(cmpDays)} days of the two periods.`
          : `${k.name} ${wasWere(k.name)} ${fa} in ${curInfo.label}, ${text} vs ${fb} in ${batch.comparison?.label}.`,
        consistencyText(t, change > 0),
      ],
      basis: `The same two periods as the KPI cards${batch.current ? " (narrowed to what the data covers in both)" : ""}${daily ? ", per day of data because the data covers the two periods unequally" : ""}.${testBasis(t)}${untested}`,
    };
  });
  return { findings, changes };
}

/**
 * The latest complete month in the selection against the same month a year
 * earlier (else the month before) for each target KPI. A month is complete
 * when the data, and the date filter, cover it from its first day to its
 * last, so a partial first or last month is never used. Months before the
 * selected range are read too (back to 24 months before its end), like the
 * KPI cards' comparison window, so the year-ago months exist. Material from
 * 5% (1 point for percent KPIs) or a clear linear trend over the last 6–12
 * complete months (R² > 0.5, not computed for percent KPIs). Year-on-year
 * changes get a sign test over those months, each against the same month a
 * year earlier. When the KPI also has a period comparison, the month is only
 * reported if it runs against it.
 */
function monthTrends(
  input: InsightInput,
  targets: InsightKpi[],
  periodChange: ReadonlyMap<string, number>,
): TrendFinding[] {
  const { ds, resolver, filters, dateColumn, fmt } = input;
  if (!dateColumn) return [];
  const bounds = dateBounds(ds, dateColumn);
  if (!bounds) return [];
  const df = dateFilterOn(filters, dateColumn);
  const from = df ? startOfMonth(Math.min(addMonths(df.from, -12), addMonths(df.to, -23))) : -Infinity;
  const q = runQuery(ds, resolver, {
    filters: df ? withDates(filters, dateColumn, { from, to: df.to }) : [...filters],
    groupBy: [{ kind: "time", column: dateColumn, grain: "month" }],
    measures: targets.map((k) => ({ id: k.id, expr: k.expr })),
    dateColumn,
  });
  const dataStart = startOfDay(Math.max(bounds.min, from));
  const dataEnd = endOfDay(Math.min(bounds.max, df ? df.to : Infinity));
  const startOf = (g: ResultGroup) => g.labels[0]?.raw as number;
  const isComplete = (g: ResultGroup) =>
    startOf(g) >= dataStart && endOfDay(addMonths(startOf(g), 1) - 1) <= dataEnd;
  const complete = q.groups.filter(isComplete);
  if (complete.length < 3) return [];
  const excluded: string[] = [];
  const firstGroup = q.groups[0];
  const lastGroup = q.groups[q.groups.length - 1];
  if (firstGroup && startOf(firstGroup) < dataStart)
    excluded.push(`the partial first month (${bucketLabel(startOf(firstGroup), "month", true)})`);
  if (lastGroup && lastGroup !== firstGroup && !isComplete(lastGroup))
    excluded.push(`the incomplete last month (${bucketLabel(startOf(lastGroup), "month", true)})`);
  const basis = `Complete calendar months only${excluded.length ? `; ${joinAnd(excluded)} ${excluded.length > 1 ? "are" : "is"} excluded` : ""}.`;
  const out: TrendFinding[] = [];
  targets.forEach((k, j) => {
    const series = complete
      .map((g) => ({ t: startOf(g), v: g.values[j] as number }))
      .filter((p) => Number.isFinite(p.v));
    const inSelection = series.filter((p) => !df || p.t >= df.from);
    const last = inSelection[inSelection.length - 1];
    if (!last || series.length < 3) return;
    const yearAgo = series.find((p) => p.t === addMonths(last.t, -12));
    const prev = series.find((p) => p.t === addMonths(last.t, -1));
    const yoyChange = yearAgo ? changeBetween(k, last.v, yearAgo.v) : null;
    const yoy = yoyChange !== null;
    const base = yoy ? yearAgo : prev;
    const change = yoy ? yoyChange : prev ? changeBetween(k, last.v, prev.v) : null;
    if (!base || change === null) return;
    // Linear trend over the last 6–12 complete months (percent KPIs move in points, so none for them).
    const window = series.filter((p) => p.t <= last.t).slice(-12);
    let slope: { perMonth: number; r2: number } | null = null;
    if (window.length >= 6 && !isRate(k.format)) {
      const reg = linearRegression(
        window.map((_, i) => i),
        window.map((p) => p.v),
      );
      const meanV = window.reduce((s, p) => s + p.v, 0) / window.length;
      if (reg.r2 > 0.5 && meanV !== 0) slope = { perMonth: reg.slope / Math.abs(meanV), r2: reg.r2 };
    }
    if (!isMaterial(k, change) && !slope) return;
    // With a period comparison for this KPI, the latest month is news only when it runs against it.
    const pc = periodChange.get(k.id);
    const secondary = pc !== undefined;
    if (secondary && isMaterial(k, pc) && pc > 0 === change > 0) return;
    let test: Consistency | null = null;
    if (yoy) {
      let agree = 0;
      let n = 0;
      for (const p of window) {
        const before = series.find((x) => x.t === addMonths(p.t, -12));
        if (!before || before.v === p.v) continue;
        n++;
        if (p.v > before.v === change > 0) agree++;
      }
      test = { agree, n, p: signTestP(agree, n), unit: "month", match: "the same month a year earlier" };
    }
    const slopeAgrees = slope !== null && slope.perMonth > 0 === change > 0;
    const certainty: Certainty =
      test && test.n >= MIN_SIGN_TEST ? certaintyOf(test) : yoy || slopeAgrees ? "medium" : "low";
    const [fLast, fBase] = formatTogether([last.v, base.v], k.format, fmt);
    const text = changeText(k, change, fmt);
    const lastLabel = bucketLabel(last.t, "month", true);
    const baseLabel = bucketLabel(base.t, "month", true);
    out.push({
      k,
      comparison: "month",
      secondary,
      change,
      certainty,
      title: yoy
        ? `${k.name} ${change > 0 ? "up" : "down"} ${unsigned(text)} year on year in ${lastLabel}`
        : `${k.name} ${change > 0 ? "up" : "down"} ${unsigned(text)} in ${lastLabel} vs ${baseLabel}`,
      points: [
        `${lastLabel}: ${fLast}`,
        `${baseLabel}: ${fBase}`,
        `Change: ${text}`,
        ...(slope
          ? [
              `Trend over ${window.length} months: ${slope.perMonth > 0 ? "up" : "down"} about ${unsigned(formatDelta(slope.perMonth, fmt.locale))} a month`,
            ]
          : []),
        ...(test && test.n >= MIN_SIGN_TEST ? [`Held in ${test.agree} of ${test.n} months`] : []),
      ],
      plain: `${k.name} went ${change > 0 ? "up" : "down"} by ${unsigned(text)}: from ${fBase} in ${baseLabel} to ${fLast} in ${lastLabel}.${verdict(k, change)}`,
      sentences: [
        `${k.name} ${wasWere(k.name)} ${fLast} in ${lastLabel}, ${text} vs ${baseLabel} (${fBase}).`,
        consistencyText(test, change > 0),
        slope
          ? `Over the last ${window.length} complete months the trend is ${slope.perMonth > 0 ? "upward" : "downward"}, about ${unsigned(formatDelta(slope.perMonth, fmt.locale))} of the average per month (R² ${slope.r2.toFixed(2)}).`
          : "",
        secondary && pc !== undefined && isMaterial(k, pc)
          ? `This runs against the ${changeText(k, pc, fmt)} change over the selected period.`
          : "",
      ],
      basis: `${basis}${testBasis(test)}`,
    });
  });
  return out;
}

/**
 * Totals that moved the same way as the first material total of the same
 * comparison are one story (revenue, orders and units all up): they are
 * named in that insight with their own changes instead of getting their own.
 */
function foldCoMovers(input: InsightInput, findings: TrendFinding[]): TrendFinding[] {
  const totals = findings.filter((f) => isMaterial(f.k, f.change) && kindOf(input, f.k) === "total");
  const anchor = totals[0];
  if (!anchor) return findings;
  const movers = totals.slice(1).filter((f) => f.change > 0 === anchor.change > 0);
  if (!movers.length) return findings;
  const named = movers.slice(0, 4).map((f) => `${f.k.name} ${changeText(f.k, f.change, input.fmt)}`);
  const more = movers.length - named.length;
  if (more) named.push(`${more} other ${more > 1 ? "totals" : "total"}`);
  anchor.sentences.push(`${joinAnd(named)} moved the same way.`);
  if (anchor.points.length < MAX_POINTS) anchor.points.push(`Moved the same way: ${joinAnd(named)}`);
  return findings.filter((f) => !movers.includes(f));
}

/**
 * Trends for up to eight hero/supporting KPIs: the period comparison and the
 * latest complete month (see periodTrends and monthTrends). The lead KPI's
 * primary comparison is the headline; co-moving totals are folded into it.
 */
function trendInsights(input: InsightInput): Insight[] {
  const { specs } = input;
  const targets = input.kpis.filter((k) => k.tier !== "detail").slice(0, 8);
  if (!targets.length || !input.dateColumn) return [];
  const { findings: period, changes } = periodTrends(input, targets);
  // With a date range the KPI cards compare the range (periodTrends uses the
  // same windows), so single-month "year on year" findings would put a second,
  // different change next to the card's. They only run in all-time mode,
  // where the cards themselves compare the latest complete month.
  const ranged = Boolean(
    input.dateColumn && dateFilterOn(input.filters, input.dateColumn) && input.batch?.comparison,
  );
  const month = ranged ? [] : monthTrends(input, targets, changes);
  const lead = targets[0]?.id;
  const all = [
    ...foldCoMovers(input, period),
    ...foldCoMovers(
      input,
      month.filter((f) => !f.secondary),
    ),
    ...month.filter((f) => f.secondary),
  ];
  return all.map((f) => ({
    id: `trend-${f.comparison}-${f.k.id}`,
    kind: "trend" as const,
    title: f.title,
    body: f.sentences.filter(Boolean).join(" "),
    points: f.points,
    plain: f.plain,
    tone: toneFor(f.k.direction, f.change),
    impact: impactScore(
      f.secondary ? RELEVANCE.momentum : f.k.id === lead ? RELEVANCE.headline : RELEVANCE.trend,
      weight(f.k),
      changeStrength(f.k, f.change),
      f.certainty,
    ),
    confidence: f.certainty,
    metricId: f.k.id,
    chartId: chartFor(specs, timeChartOf(input, f.k.id)),
    basis: f.basis,
  }));
}

/** True when a chart is drawn by the date part `part`, on its axis or as its split (a weekday × hour heatmap). */
const byPart = (s: ChartSpec, part: "dow" | "month") =>
  (s.x.kind === "part" && s.x.part === part) || (s.series?.kind === "part" && s.series.part === part);

/** A chart of `kpiId` over the primary date: what a trend, an anomaly or a monthly peak points at. */
const timeChartOf = (input: Pick<InsightInput, "dateColumn">, kpiId: string) => (s: ChartSpec) =>
  s.x.kind === "time" && s.x.column === input.dateColumn && s.measures.some((m) => m.id === kpiId);

// ---------------------------------------------------------------- anomalies

/**
 * Day-level spikes and dips in the first additive, non-percent hero KPI:
 * robust z = (value − median) / (1.4826 × MAD) over the previous 28 days,
 * flagged at |z| ≥ 4 when the day is also at least 50% off the median.
 * Needs 60 days; reports up to three, at least five days apart.
 */
function anomalyInsights(input: InsightInput): Insight[] {
  const { ds, resolver, filters, dateColumn, kpis, fmt, specs } = input;
  if (!dateColumn) return [];
  const k = kpis.find((x) => x.tier === "hero" && additive(input, x) && x.format !== "percent");
  if (!k) return [];
  const q = runQuery(ds, resolver, {
    filters: [...filters],
    groupBy: [{ kind: "time", column: dateColumn, grain: "day" }],
    measures: [{ id: k.id, expr: k.expr }],
    dateColumn,
  });
  // Day buckets are continuous; an empty day is a real zero for an additive measure.
  const series = q.groups.map((g) => ({ t: g.labels[0]?.raw as number, v: (g.values[0] as number) || 0 }));
  if (series.length < 60) return [];
  const found: Array<{ t: number; v: number; med: number; z: number }> = [];
  for (let i = 28; i < series.length; i++) {
    const window = series.slice(i - 28, i).map((p) => p.v);
    const med = median(window);
    const sigma = robustSigma(window);
    if (!(sigma > 0) || !(med > 0)) continue;
    const p = series[i] as { t: number; v: number };
    const z = (p.v - med) / sigma;
    if (Math.abs(z) >= 4 && Math.abs(p.v - med) / med >= 0.5) found.push({ t: p.t, v: p.v, med, z });
  }
  found.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const picked: typeof found = [];
  for (const a of found) {
    if (picked.length >= 3) break;
    if (picked.some((p) => Math.abs(p.t - a.t) < 5 * DAY_MS)) continue;
    picked.push(a);
  }
  return picked.map((a) => {
    const ratio = a.v / a.med;
    const spike = a.v > a.med;
    const [fDay, fMedian] = formatTogether([a.v, a.med], k.format, fmt);
    return {
      id: `anomaly-${k.id}-${a.t}`,
      kind: "anomaly" as const,
      title: `Unusual ${spike ? "spike" : "dip"} in ${k.name} on ${formatDay(a.t)}`,
      points: [
        `${formatDay(a.t)}: ${fDay}`,
        `A typical day: ${fMedian}`,
        spike ? `${ratio.toFixed(1)}× the usual` : `${Math.round((1 - ratio) * 100)}% below the usual`,
      ],
      plain: spike
        ? `On ${formatDay(a.t)}, ${inSentence(k.name)} was ${fDay}, about ${ratio.toFixed(1)} times a normal day (${fMedian}). Check what happened that day.`
        : `On ${formatDay(a.t)}, ${inSentence(k.name)} was ${fDay}, ${Math.round((1 - ratio) * 100)}% below a normal day (${fMedian}). Check what happened that day.`,
      body: `${k.name} ${wasWere(k.name)} ${fDay} on ${formatDay(a.t)}, ${spike ? `${ratio.toFixed(1)}× the typical day` : `${Math.round((1 - ratio) * 100)}% below a typical day`} (28-day median ${fMedian}). ${spike ? "Check what happened that day: a one-off event, a bulk entry or a data error." : "Check what happened that day: an interruption, a one-off event or missing data."}`,
      tone: spike ? ("neutral" as const) : ("warning" as const),
      impact: impactScore(RELEVANCE.anomaly, weight(k), strength(Math.abs(a.z), 8), "medium"),
      confidence: "medium" as const,
      metricId: k.id,
      chartId: chartFor(specs, timeChartOf(input, k.id)),
      basis: "Robust z-score against the previous 28 days (median and MAD), flagged at |z| ≥ 4.",
    };
  });
}

// ---------------------------------------------------------------- concentration

/**
 * Share of an additive KPI (a currency hero first) delivered by the top 20%
 * of items, and how many items make up 80%. Needs at least 10 items;
 * negative values count as 0.
 */
function concentrationInsights(input: InsightInput): Insight[] {
  const { ds, resolver, filters, dateColumn, kpis, fmt, specs, concentration } = input;
  if (!concentration) return [];
  const k =
    kpis.find((x) => x.tier === "hero" && additive(input, x) && x.format === "currency") ??
    kpis.find((x) => additive(input, x));
  if (!k) return [];
  const q = runQuery(ds, resolver, {
    filters: [...filters],
    groupBy: [{ kind: "column", column: concentration.column }],
    measures: [{ id: k.id, expr: k.expr }],
    dateColumn,
  });
  const vals = q.groups.map((g) => Math.max(0, (g.values[0] as number) || 0)).sort((a, b) => b - a);
  const n = vals.length;
  if (n < 10) return [];
  const total = vals.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return [];
  const topCount = Math.max(1, Math.round(n * 0.2));
  const topShare = vals.slice(0, topCount).reduce((s, v) => s + v, 0) / total;
  let cum = 0;
  let forEighty = 0;
  for (const v of vals) {
    cum += v;
    forEighty++;
    if (cum / total >= 0.8) break;
  }
  const top1 = (vals[0] as number) / total;
  const label = concentration.label.toLowerCase();
  const count = (x: number) => formatValue(x, "integer", fmt);
  const sameItems = (s: ChartSpec) =>
    s.x.kind === "column" && s.x.column === concentration.column && s.measures.some((m) => m.id === k.id);
  return [
    {
      id: `concentration-${concentration.column}`,
      kind: "concentration",
      title: `Top 20% of ${pluralOf(label)} drive ${Math.round(topShare * 100)}% of ${k.name}`,
      points: [
        `Top ${count(topCount)} of ${count(n)} ${pluralOf(label)}: ${(topShare * 100).toFixed(0)}% of ${k.name}`,
        `${count(forEighty)} ${pluralOf(label)} make up 80%`,
        `The largest one: ${(top1 * 100).toFixed(1)}%`,
      ],
      plain:
        topShare >= 0.7
          ? `Most of ${inSentence(k.name)} comes from a few ${pluralOf(label)}: the top ${count(topCount)} of ${count(n)} bring ${(topShare * 100).toFixed(0)}%. If one of them slips, the total feels it.`
          : `${k.name} is spread out: the top ${count(topCount)} of ${count(n)} ${pluralOf(label)} bring ${(topShare * 100).toFixed(0)}%, so no single one carries the total.`,
      body: `${count(topCount)} of ${count(n)} ${pluralOf(label)} account for ${(topShare * 100).toFixed(0)}% of ${k.name}; ${count(forEighty)} ${pluralOf(label)} make up 80%. The single largest contributes ${(top1 * 100).toFixed(1)}%.${topShare >= 0.7 ? ` High concentration means a problem with a few of them hits ${k.name} hard.` : " It is reasonably spread, which limits dependence on any one item."}`,
      tone: topShare >= 0.7 ? "warning" : "neutral",
      impact: impactScore(RELEVANCE.concentration, weight(k), strength(topShare - 0.2, 0.4), "high"),
      confidence: "high",
      metricId: k.id,
      // The chart of these items by this KPI: a Pareto first, else any chart of them; never another column's.
      chartId:
        chartFor(specs, (s) => (s.kind === "pareto" || s.analysis === "pareto") && sameItems(s)) ??
        chartFor(specs, sameItems),
      basis: `Ranked ${count(n)} ${pluralOf(label)} by ${k.name} in the current selection.`,
    },
  ];
}

// ---------------------------------------------------------------- seasonality

/**
 * Weekday rhythm (average per calendar day, at least 56 days, rows on at
 * least half of them) and month-of-year peak (per-day average by calendar
 * month, pooled across years) for an additive hero KPI, preferring a
 * non-currency one such as orders. A weekday averaging zero or less (a closed
 * day) has no meaningful ratio, so it is named and the gap is measured
 * against the quietest weekday with activity.
 */
function seasonalityInsights(input: InsightInput): Insight[] {
  const { ds, resolver, filters, dateColumn, kpis, fmt, specs } = input;
  if (!dateColumn) return [];
  const k =
    kpis.find((x) => x.tier === "hero" && additive(input, x) && x.format !== "currency") ??
    kpis.find((x) => x.tier === "hero" && additive(input, x));
  if (!k) return [];
  const out: Insight[] = [];
  const f = (v: number) => formatValue(v, k.format, { ...fmt, compact: true });
  const daily = runQuery(ds, resolver, {
    filters: [...filters],
    groupBy: [{ kind: "time", column: dateColumn, grain: "day" }],
    measures: [{ id: k.id, expr: k.expr }],
    dateColumn,
  });
  // Weekday rhythm needs daily data: with monthly or weekly rows every value
  // lands on whichever weekday the period starts, a pattern of the file, not
  // the business. At least half the calendar days must carry rows.
  const activeDays = daily.groups.filter((g) => g.rows > 0).length;
  if (daily.groups.length >= 56 && activeDays * 2 >= daily.groups.length) {
    const sums = new Array<number>(7).fill(0);
    const counts = new Array<number>(7).fill(0);
    for (const g of daily.groups) {
      const t = g.labels[0]?.raw as number;
      const dow = (new Date(t).getUTCDay() + 6) % 7;
      sums[dow] = (sums[dow] as number) + ((g.values[0] as number) || 0);
      counts[dow] = (counts[dow] as number) + 1;
    }
    const avg = sums.map((s, i) => s / Math.max(1, counts[i] as number));
    const mean = avg.reduce((a, b) => a + b, 0) / 7;
    const days = avg.map((v, i) => ({ v, i }));
    const active = days.filter((d) => d.v > 0);
    const idle = days.filter((d) => !(d.v > 0));
    const max = active.reduce<{ v: number; i: number } | null>((a, b) => (!a || b.v > a.v ? b : a), null);
    const min = active.reduce<{ v: number; i: number } | null>((a, b) => (!a || b.v < a.v ? b : a), null);
    const gap = max && min && max.i !== min.i ? (max.v - min.v) / min.v : 0;
    if (mean > 0 && max && min && gap >= 0.15) {
      // Sentences name the day in full ("Saturday"), as a report would.
      const maxDay = WEEKDAYS_LONG[max.i];
      const minDay = WEEKDAYS_LONG[min.i];
      const idleText = idle.length
        ? ` ${joinAnd(idle.map((d) => `${WEEKDAYS_LONG[d.i]} averages ${f(d.v)}`))}, so the gap is measured against the quietest day with activity.`
        : "";
      out.push({
        id: `seasonality-dow-${k.id}`,
        kind: "seasonality",
        title: `${maxDay} is the strongest day for ${k.name}`,
        points: [
          `Best day: ${maxDay}, ${f(max.v)} on average`,
          `Quietest day: ${minDay}, ${f(min.v)}`,
          `${maxDay} is ${Math.round(gap * 100)}% higher`,
        ],
        plain: `${maxDay}s bring about ${Math.round(gap * 100)}% more ${inSentence(k.name)} than ${minDay}s (${f(max.v)} against ${f(min.v)} a day on average). Plan staff and stock around it.`,
        body: `An average ${maxDay} brings ${Math.round(gap * 100)}% more ${inSentence(k.name)} than an average ${minDay}.${idleText} Plan capacity and timing around this weekly rhythm.`,
        tone: "neutral",
        impact: impactScore(
          RELEVANCE.seasonality,
          weight(k),
          strength(gap, 0.5),
          daily.groups.length >= 120 ? "high" : "medium",
        ),
        confidence: daily.groups.length >= 120 ? "high" : "medium",
        metricId: k.id,
        // A weekday chart (or a weekday heatmap) of this same KPI; another measure's would show another rhythm.
        chartId: chartFor(specs, (s) => s.measures.some((m) => m.id === k.id) && byPart(s, "dow")),
        basis: `Average per calendar day over ${daily.groups.length} days${idle.length ? "; weekdays averaging zero or less are left out of the ratio" : ""}.`,
      });
    }
  }
  if (daily.groups.length >= 56) {
    // Month-of-year peak when at least two full years are present.
    // The test used: every calendar month has at least 40 days of data, so
    // each month occurs in two or more years.
    const months = new Array<number>(12).fill(0);
    const monthDays = new Array<number>(12).fill(0);
    for (const g of daily.groups) {
      const m = new Date(g.labels[0]?.raw as number).getUTCMonth();
      months[m] = (months[m] as number) + ((g.values[0] as number) || 0);
      monthDays[m] = (monthDays[m] as number) + 1;
    }
    if (monthDays.every((d) => d >= 40)) {
      const perDay = months.map((s, i) => s / (monthDays[i] as number));
      const meanM = perDay.reduce((a, b) => a + b, 0) / 12;
      const peak = perDay.indexOf(Math.max(...perDay));
      const lift = meanM > 0 ? (perDay[peak] as number) / meanM - 1 : 0;
      if (lift >= 0.2) {
        const name = bucketLabel(Date.UTC(2020, peak, 1), "month", true).replace(" 2020", "");
        out.push({
          id: `seasonality-month-${k.id}`,
          kind: "seasonality",
          title: `${name} runs ${Math.round(lift * 100)}% above an average month`,
          points: [
            `Peak month: ${name}`,
            `${Math.round(lift * 100)}% above an average month`,
            "Repeats across the years in the data",
          ],
          plain: `${name} is usually the busiest month: about ${Math.round(lift * 100)}% more ${inSentence(k.name)} a day than an average month.`,
          body: `Across the years in the data, ${name} averages ${Math.round(lift * 100)}% more ${inSentence(k.name)} per day than the yearly mean, a recurring peak worth planning for.`,
          tone: "neutral",
          impact: impactScore(RELEVANCE.seasonality, weight(k), strength(lift, 0.4), "medium"),
          confidence: "medium",
          metricId: k.id,
          chartId:
            chartFor(specs, (s) => s.measures.some((m) => m.id === k.id) && byPart(s, "month")) ??
            chartFor(specs, timeChartOf(input, k.id)),
          basis: "Average per day by calendar month, pooled across years.",
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- segment gaps

/**
 * Widest gap of each rate KPI (a ratio or average, never a total) across the
 * values of a segment column. A segment needs max(30, 2% of rows) rows and
 * there must be 2–40 of them; material from a 1.3× ratio (percent KPIs: 1.4×
 * and 3 points). A KPI is not compared on a segment column its own
 * definition filters on (COD share by payment method), nor on one its
 * entities span (see entityFields: a customer counted under several
 * couriers, a rep under every category), which holds when the segments'
 * distinct counts of the entity add up to over 110% of the whole. Keeps the
 * strongest gap per KPI, then one insight per pair of segments: a second KPI
 * with the same two extremes is named in the first.
 */
function segmentInsights(input: InsightInput): Insight[] {
  const { ds, resolver, filters, dateColumn, kpis, segments, fmt, specs } = input;
  const rateKpis = kpis.filter((k) => k.tier !== "detail" && kindOf(input, k) === "rate").slice(0, 8);
  const ownFilters = new Map(rateKpis.map((k) => [k.id, filterColumns(resolver, k.expr)]));
  const entities = new Map(rateKpis.map((k) => [k.id, [...new Set(entityFields(resolver, k.expr))]]));
  const spanCache = new Map<string, boolean>();
  /** True when the entities of `field` sit in more than one segment of `column`. */
  const spans = (field: string, column: string): boolean => {
    const key = `${field}|${column}`;
    let hit = spanCache.get(key);
    if (hit === undefined) {
      const q = runQuery(ds, resolver, {
        filters: [...filters],
        groupBy: [{ kind: "column", column }],
        measures: [{ id: "entities", expr: { agg: "countDistinct", of: field } }],
        dateColumn,
      });
      const sum = q.groups.reduce(
        (s, g) => s + (Number.isFinite(g.values[0]) ? (g.values[0] as number) : 0),
        0,
      );
      const whole = q.totals[0] ?? NaN;
      hit = Number.isFinite(whole) && whole > 0 && sum > 1.1 * whole;
      spanCache.set(key, hit);
    }
    return hit;
  };
  const out: Insight[] = [];
  /** The two segments each insight compares, and its sentence for a merged pair. */
  const pairs = new Map<string, { column: string; a: string; b: string; also: string; point: string }>();
  for (const seg of segments.slice(0, 6)) {
    const ks = rateKpis.filter(
      (k) =>
        !ownFilters.get(k.id)?.has(seg.column) &&
        !(entities.get(k.id) ?? []).some((field) => {
          try {
            return spans(field, seg.column);
          } catch {
            // A field this dataset doesn't map can't be checked: leave the KPI out rather than risk the artefact.
            return true;
          }
        }),
    );
    if (!ks.length) continue;
    const q = runQuery(ds, resolver, {
      filters: [...filters],
      groupBy: [{ kind: "column", column: seg.column }],
      measures: ks.map((k) => ({ id: k.id, expr: k.expr })),
      dateColumn,
    });
    const total = q.totalRows;
    const eligible = q.groups.filter(
      (g) => g.labels[0]?.raw !== null && g.rows >= Math.max(30, total * 0.02),
    );
    if (eligible.length < 2 || eligible.length > 40) continue;
    ks.forEach((k, j) => {
      const pts = eligible
        .map((g) => ({ label: g.labels[0]?.label ?? "", v: g.values[j] as number, rows: g.rows }))
        .filter((p) => Number.isFinite(p.v));
      if (pts.length < 2) return;
      const hi = pts.reduce((a, b) => (b.v > a.v ? b : a));
      const lo = pts.reduce((a, b) => (b.v < a.v ? b : a));
      if (hi.label === lo.label) return;
      const pct = isRate(k.format);
      const gapAbs = hi.v - lo.v;
      const ratio = lo.v > 0 ? hi.v / lo.v : Infinity;
      const material = pct ? gapAbs >= 0.03 && ratio >= 1.4 : ratio >= 1.3;
      if (!material) return;
      // Printed together, so both carry one precision ("₹663 to ₹2.71K", never "₹662.75 to ₹2.71K").
      const [fLo, fHi] = formatTogether([lo.v, hi.v], k.format, fmt);
      // The gap a reader works out from the two rates as printed: 1.9% to 7.1% is 5.2 pp.
      const shownGap = Math.round(hi.v * 1000) / 1000 - Math.round(lo.v * 1000) / 1000;
      // The segment to act on: the worse one, or for a neutral KPI the smaller of the two.
      const worse = k.direction === "lower" ? hi : lo;
      const focus = k.direction === "neutral" ? (hi.rows <= lo.rows ? hi : lo) : worse;
      const reach = 0.5 + 0.5 * Math.min(1, focus.rows / Math.max(1, total) / 0.25);
      const gapStrength = pct ? strength(gapAbs, 0.05) : strength(Number.isFinite(ratio) ? ratio - 1 : 10, 1);
      const confidence: Certainty = Math.min(hi.rows, lo.rows) >= 200 ? "high" : "medium";
      const id = `segment-${k.id}-${seg.column}`;
      const between = `${fLo} (${lo.label}) to ${fHi} (${hi.label})`;
      pairs.set(id, {
        column: seg.column,
        a: hi.label,
        b: lo.label,
        also: `${k.name} runs from ${between} as well.`,
        point: `${k.name} too: ${between}`,
      });
      out.push({
        id,
        kind: "segment",
        title: `${k.name}: ${hi.label} ${Number.isFinite(ratio) && ratio < 50 ? `${ratio.toFixed(1)}×` : "far above"} ${lo.label}`,
        points: [
          `Highest: ${hi.label}, ${fHi}`,
          `Lowest: ${lo.label}, ${fLo}`,
          pct
            ? `Gap: ${formatPointDelta(shownGap, fmt.locale).replace(/^\+/, "")}`
            : Number.isFinite(ratio) && ratio < 50
              ? `${hi.label} is ${ratio.toFixed(1)}× ${lo.label}`
              : `${hi.label} is far above ${lo.label}`,
          ...(k.direction !== "neutral" ? [`Look first at: ${worse.label}`] : []),
        ],
        plain: `${k.name} is ${fHi} for ${hi.label} but only ${fLo} for ${lo.label}.${k.direction !== "neutral" ? ` ${worse.label} is where to look first.` : ""}`,
        body: `Across ${segmentsWord(seg.label)}, ${inSentence(k.name)} ranges from ${between}${pct ? `, ${gapText(formatPointDelta(shownGap, fmt.locale).replace(/^\+/, ""))}` : ""}.${k.direction !== "neutral" ? ` ${worse.label} is the segment to look at first.` : ""}`,
        tone: k.direction === "neutral" ? "neutral" : "warning",
        impact: impactScore(RELEVANCE.segment, weight(k), gapStrength * reach, confidence),
        confidence,
        metricId: k.id,
        chartId: chartFor(
          specs,
          (s) => s.x.kind === "column" && s.x.column === seg.column && s.measures.some((m) => m.id === k.id),
        ),
        basis: `Each segment has at least ${Math.max(30, Math.round(total * 0.02))} rows; the ratio is recomputed per segment, never averaged.`,
      });
    });
  }
  // Keep the strongest gap per KPI.
  const best = new Map<string, Insight>();
  for (const i of out) {
    const cur = best.get(i.metricId ?? i.id);
    if (!cur || i.impact > cur.impact) best.set(i.metricId ?? i.id, i);
  }
  // One insight per pair of segments: "Electronics vs Supplies" on two KPIs is one story, told once.
  const kept: Insight[] = [];
  const byPair = new Map<string, Insight>();
  for (const i of [...best.values()].sort((a, b) => b.impact - a.impact)) {
    const p = pairs.get(i.id);
    const key = p ? `${p.column}|${[p.a, p.b].sort().join("|")}` : i.id;
    const lead = byPair.get(key);
    if (lead && p) {
      lead.body = `${lead.body} ${p.also}`;
      // Bullets stay few enough to scan: the sentence names every KPI, the points at most five.
      if (lead.points.length < MAX_POINTS) lead.points.push(p.point);
      continue;
    }
    byPair.set(key, i);
    kept.push(i);
  }
  return kept;
}

/**
 * A segment column's label as the plural a sentence needs: "categories",
 * "payment methods"; a label with alternatives ("Region / territory") uses
 * the first. Acronyms keep their capitals ("SKUs").
 */
function segmentsWord(label: string): string {
  const first = (label.split(/\s*\/\s*/)[0] ?? label).trim();
  const words = first.split(" ").map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase()));
  return pluralOf(words.join(" "));
}

/** A KPI's name inside a sentence: "return rate", but "RTO rate" and "MRR" keep their capitals. */
function inSentence(name: string): string {
  const [first = "", ...rest] = name.split(" ");
  return /^[A-Z0-9%]{2,}$/.test(first) ? name : [first.toLowerCase(), ...rest].join(" ");
}

// ---------------------------------------------------------------- drivers (ordinal bands)

/**
 * A percent measure on a binned axis that moves almost monotonically (at most
 * one step against the direction) across bands of 30+ rows, by at least 2
 * points from the first band to the last.
 */
function driverInsights(input: InsightInput): Insight[] {
  const { specs, chartData, fmt, kpis } = input;
  const out: Insight[] = [];
  for (const spec of specs) {
    if (spec.x.kind !== "bins" || spec.measures.length !== 1) continue;
    const m = spec.measures[0];
    if (!m || m.format !== "percent") continue;
    const data = chartData.get(spec.id);
    if (!data || data.empty) continue;
    const pts = data.categories
      .map((c, i) => ({ c, v: data.series[0]?.values[i] ?? null, rows: data.rows[i] ?? 0 }))
      .filter((p) => p.v !== null && p.rows >= 30) as Array<{
      c: { label: string };
      v: number;
      rows: number;
    }>;
    if (pts.length < 3) continue;
    let ups = 0;
    for (let i = 1; i < pts.length; i++)
      if ((pts[i] as { v: number }).v > (pts[i - 1] as { v: number }).v) ups++;
    const first = pts[0] as { c: { label: string }; v: number };
    const last = pts[pts.length - 1] as { c: { label: string }; v: number };
    const monotone = ups >= pts.length - 2 || ups <= 1;
    const gap = last.v - first.v;
    if (!monotone || Math.abs(gap) < 0.02) continue;
    const f = (v: number) => formatValue(v, "percent", fmt);
    const kpi = kpis.find((k) => k.id === m.id);
    const confidence: Certainty = pts.length >= 5 ? "high" : "medium";
    out.push({
      id: `driver-${spec.id}`,
      kind: "driver",
      title: `${m.label} ${gap > 0 ? "rises" : "falls"} with ${spec.x.label.toLowerCase()}`,
      points: [
        `${first.c.label}: ${f(first.v)}`,
        `${last.c.label}: ${f(last.v)}`,
        `Change: ${formatPointDelta(gap, fmt.locale)} across ${pts.length} bands`,
      ],
      plain: `As ${spec.x.label.toLowerCase()} goes up, ${inSentence(m.label)} goes ${gap > 0 ? "up" : "down"}: from ${f(first.v)} to ${f(last.v)}. It is a link, not proof of cause.`,
      body: `${m.label} moves from ${f(first.v)} at ${first.c.label} to ${f(last.v)} at ${last.c.label} (${formatPointDelta(gap, fmt.locale)}), consistently across ${pts.length} bands. This is a correlation; test before treating it as cause.`,
      tone: gap > 0 === (m.direction === "lower") ? "warning" : "neutral",
      impact: impactScore(
        RELEVANCE.driver,
        kpi ? weight(kpi) : weight({ tier: "supporting" }),
        strength(Math.abs(gap), 0.05),
        confidence,
      ),
      confidence,
      metricId: m.id,
      chartId: spec.id,
      basis: "Bands with at least 30 rows; rate recomputed per band.",
    });
  }
  return out;
}

// ---------------------------------------------------------------- what moves the outcome

/** Fewer selected rows than this say too little about what moves the outcome. */
const MIN_DRIVER_ROWS = 30;

/** The columns a measure reads, following its KPI refs through the resolver. */
function measureColumns(
  input: Pick<InsightInput, "resolver">,
  id: string,
  out = new Set<string>(),
): Set<string> {
  const seen = new Set<string>();
  const visit = (k: string) => {
    if (seen.has(k)) return;
    seen.add(k);
    const e = kpiOrUndefined(input.resolver, k);
    if (!e) return;
    for (const f of fieldsOf(e))
      try {
        out.add(input.resolver.column(f).name);
      } catch {
        // An unmapped field reads no column.
      }
    for (const r of refsOfExpr(e)) visit(r);
  };
  visit(id);
  return out;
}

/** The columns a chart reads: its axes and, through the resolver, its measures' fields. */
function chartColumns(input: Pick<InsightInput, "resolver">, spec: ChartSpec): Set<string> {
  const out = new Set<string>();
  for (const a of [spec.x, spec.series]) {
    if (!a) continue;
    if (a.kind === "time" || a.kind === "column" || a.kind === "part") out.add(a.column);
    if (a.kind === "bins")
      for (const f of fieldsOf(a.expr))
        try {
          out.add(input.resolver.column(f).name);
        } catch {
          // An unmapped bin field reads no column.
        }
  }
  for (const m of spec.measures) measureColumns(input, m.id, out);
  return out;
}

/**
 * What moves the outcome on the selected rows: the strongest number and the
 * strongest category (strength 0.1 or more), each with its sentence and the
 * chart that sets it against the outcome, when one exists (the chart's
 * measure of the outcome is the insight's metric). Under filters it is
 * worked out on the filtered rows only (understand/drivers.ts with the
 * selection), and skipped below MIN_DRIVER_ROWS rows; groups of fewer than
 * five rows are never compared. The money of a table of transactions gets
 * none: its own KPIs compare it (segment gaps, concentration).
 */
function outcomeDriverInsights(input: InsightInput, selected: Int32Array): Insight[] {
  const o = input.outcome;
  // The money of a table of transactions is compared by its own KPIs (segment gaps, concentration):
  // an average per row by category would mix how many lines a group has with how big each is.
  if (!o || o.target.transactional || selected.length < MIN_DRIVER_ROWS) return [];
  const filtered = selected.length < input.ds.rowCount;
  const { ranked } = rankDrivers(o.profile, input.ds, o.target, {
    kinds: o.kinds,
    rows: filtered ? selected : null,
    locale: input.fmt.locale,
    currency: input.fmt.currency,
    rowsWord: o.rowsWord,
  });
  const strongest = (as: DriverDetail["as"]) => ranked.find((d) => d.as === as && d.strength >= MIN_STRENGTH);
  const outcome = o.target.column.name;
  const noun = o.target.noun.charAt(0).toUpperCase() + o.target.noun.slice(1);
  return [strongest("numeric"), strongest("category")]
    .filter((d): d is DriverDetail => d !== undefined)
    .map((d) => {
      const certainty: Certainty = d.n >= 300 ? "high" : d.n >= 100 ? "medium" : "low";
      const spec = input.specs.find((s) => {
        const cols = chartColumns(input, s);
        return cols.has(d.column) && cols.has(outcome);
      });
      // The chart's measure that reads the outcome is the insight's metric.
      const metric =
        spec?.measures.find((m) => measureColumns(input, m.id).has(outcome)) ?? spec?.measures[0];
      const D = d.column.replace(/[_\s]+/g, " ").trim();
      const title =
        o.target.type === "class"
          ? `${D} sets the ${o.target.label} apart`
          : d.as === "numeric"
            ? `${noun} ${d.direction === "down" ? "falls" : "rises"} as ${D} rises`
            : `${noun} differs ${d.strength >= CLEAR_LINK ? "most " : ""}by ${D}`;
      const rows = formatValue(d.n, "integer", input.fmt);
      return {
        id: `outcome-${d.as}-${d.column}`,
        kind: "driver" as const,
        title,
        body: `${d.sentence} This is a link across the rows, not proof of cause; test it before acting on it.`,
        // The sentence without its statistic ("(r = 0.21)"), which an everyday reader doesn't need.
        points: [
          d.sentence.replace(/\s*\((?:r|η|V|Cramér)[^)]*\)/g, "").replace(/\.$/, ""),
          `Based on ${rows} rows`,
          "A link, not proof of cause",
        ],
        plain: `${d.sentence.replace(/\s*\((?:r|η|V|Cramér)[^)]*\)/g, "")} It is a link, not proof of cause.`,
        tone: "neutral" as const,
        impact: impactScore(RELEVANCE.driver, 1, strength(d.strength, 0.3), certainty),
        confidence: certainty,
        ...(spec && metric ? { chartId: spec.id, metricId: metric.id } : {}),
        basis: filtered
          ? `Worked out on the ${rows} rows that pass the filters, with every figure recomputed on them.`
          : `Worked out on all ${rows} rows with both values.`,
      };
    });
}

// ---------------------------------------------------------------- mix shift (Simpson's paradox check)

/**
 * For up to two non-percent hero rate KPIs (e.g. average order value) whose
 * headline delta is at least 2%: if most of the row-weighted segments (30+
 * rows in both periods, at least three) moved the other way, the headline is
 * flagged as a mix effect. Totals are left out: they have no mix effect.
 */
function mixInsights(input: InsightInput): Insight[] {
  const { ds, resolver, filters, dateColumn, kpis, segments, batch, fmt } = input;
  if (!batch?.comparison || !dateColumn || !batch.period) return [];
  const out: Insight[] = [];
  const rateKpis = kpis
    .filter((k) => k.tier === "hero" && kindOf(input, k) === "rate" && k.format !== "percent")
    .slice(0, 2);
  const seg = segments.find((s) => s.label.toLowerCase().includes("categor")) ?? segments[0];
  if (!seg) return [];
  const prevFilters: Filter[] = [
    ...filters.filter((f) => !(f.kind === "dateRange" && f.column === dateColumn)),
    { kind: "dateRange", column: dateColumn, from: batch.comparison.from, to: batch.comparison.to },
  ];
  for (const k of rateKpis) {
    const value = batch.values.find((v) => v.id === k.id);
    if (!value || value.delta === null || Math.abs(value.delta) < 0.02) continue;
    // In all-time mode the KPI delta compares two months; recompute both sides of the same windows here.
    const hasDateFilter = filters.some((f) => f.kind === "dateRange" && f.column === dateColumn);
    const curFilters: Filter[] = hasDateFilter
      ? [...filters]
      : [
          ...filters,
          {
            kind: "dateRange",
            column: dateColumn,
            from: batch.comparison.to + 1,
            to: addMonths(batch.comparison.from, 2) - 1,
          },
        ];
    const cur = runQuery(ds, resolver, {
      filters: curFilters,
      groupBy: [{ kind: "column", column: seg.column }],
      measures: [{ id: k.id, expr: k.expr }],
      dateColumn,
    });
    const prev = runQuery(ds, resolver, {
      filters: prevFilters,
      groupBy: [{ kind: "column", column: seg.column }],
      measures: [{ id: k.id, expr: k.expr }],
      dateColumn,
    });
    const prevMap = new Map(prev.groups.map((g) => [g.labels[0]?.label, g]));
    const curTotal = cur.groups.reduce((s, g) => s + g.rows, 0);
    const prevTotal = prev.groups.reduce((s, g) => s + g.rows, 0);
    if (!curTotal || !prevTotal) continue;
    let against = 0;
    let withWeight = 0;
    let movedAgainst = 0;
    let counted = 0;
    let biggestShift: { label: string; from: number; to: number } | null = null;
    for (const g of cur.groups) {
      const p = prevMap.get(g.labels[0]?.label);
      if (!p || g.rows < 30 || p.rows < 30) continue;
      const a = g.values[0] as number;
      const b = p.values[0] as number;
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      counted++;
      const w = g.rows / curTotal;
      if (Math.sign(a - b) !== Math.sign(value.delta) && a !== b) {
        against += w;
        movedAgainst++;
      } else withWeight += w;
      const shift = g.rows / curTotal - p.rows / prevTotal;
      if (!biggestShift || Math.abs(shift) > Math.abs(biggestShift.to - biggestShift.from))
        biggestShift = { label: g.labels[0]?.label ?? "", from: p.rows / prevTotal, to: g.rows / curTotal };
    }
    if (counted >= 3 && against > withWeight && biggestShift) {
      out.push({
        id: `mix-${k.id}`,
        kind: "mix",
        title: `${k.name} ${value.delta > 0 ? "rose" : "fell"} overall, but not within most ${segmentsWord(seg.label)}`,
        points: [
          `Overall: ${formatDelta(value.delta, fmt.locale)}`,
          `Went the other way in ${movedAgainst} of ${counted} ${segmentsWord(seg.label)}`,
          `${biggestShift.label}: ${(biggestShift.from * 100).toFixed(1)}% → ${(biggestShift.to * 100).toFixed(1)}% of rows`,
        ],
        plain: `${k.name} ${value.delta > 0 ? "rose" : "fell"} overall, but in most ${segmentsWord(seg.label)} it went the other way. The overall change comes from the mix (${biggestShift.to > biggestShift.from ? "more" : "fewer"} ${biggestShift.label} rows), not from each one changing.`,
        body: `${k.name} changed ${formatDelta(value.delta, fmt.locale)} overall, yet it moved the other way in ${movedAgainst} of ${counted} ${segmentsWord(seg.label)}. The mix shifted: ${biggestShift.label} went from ${(biggestShift.from * 100).toFixed(1)}% to ${(biggestShift.to * 100).toFixed(1)}% of rows. Treat the headline change as a mix effect (Simpson's paradox), not a like-for-like change.`,
        tone: "warning",
        impact: impactScore(RELEVANCE.mix, weight(k), against / (against + withWeight), "medium"),
        confidence: "medium",
        metricId: k.id,
        basis: `Compared ${batch.period.label} with ${batch.comparison.label} within each ${seg.label.toLowerCase()} (segments with 30+ rows in both periods).`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- caveats

/** Fewest recent rows the in-progress share is given for: below it the share is a handful of rows. */
const MIN_RECENT_ROWS = 20;

/**
 * Caveats about the selection itself, computed from its rows only. Rows
 * still in progress: among the selected rows dated in the data's last 21
 * days (at least 20 of them), the share whose status is still pending, raised
 * only when return/RTO/refund KPIs exist, since those rates are understated
 * until the rows settle. And a warning for a selection under 100 rows.
 */
function caveatInsights(input: InsightInput, selected: Int32Array): Insight[] {
  const { ds, dateColumn, inProgress, kpis } = input;
  const out: Insight[] = [];
  if (inProgress && dateColumn && inProgress.values.length) {
    const bounds = dateBounds(ds, dateColumn);
    const statusCol = ds.columns.find((c) => c.name === inProgress.column);
    const dateCol = ds.columns.find((c) => c.name === dateColumn);
    if (bounds && statusCol?.kind === "string" && dateCol?.kind === "date") {
      const set = new Set(inProgress.values);
      // Recent in the data, not in the selection: an old period has settled, so it raises nothing.
      const since = startOfDay(bounds.max) - 20 * DAY_MS;
      let open = 0;
      let recent = 0;
      for (const r of selected) {
        const d = dateCol.values[r] as number;
        if (!(d >= since)) continue;
        recent++;
        const c = statusCol.codes[r] as number;
        if (c >= 0 && set.has(statusCol.dict[c] as string)) open++;
      }
      const hasReturnKpis = kpis.some((k) => /return|rto|refund/.test(k.id));
      if (open > 0 && recent >= MIN_RECENT_ROWS && hasReturnKpis) {
        out.push({
          id: "caveat-in-transit",
          kind: "caveat",
          title: "Recent return and RTO rates are understated",
          points: [
            `${Math.round((open / recent) * 100)}% of recent rows still in progress`,
            `Since ${formatDay(since)}`,
            "Return and RTO rates will rise as they settle",
          ],
          plain: `About ${Math.round((open / recent) * 100)}% of the last three weeks' rows haven't finished yet, so recent return and RTO rates look lower than they will be.`,
          body: `${Math.round((open / recent) * 100)}% of the ${formatValue(recent, "integer", input.fmt)} selected rows dated from ${formatDay(since)} (the data's last three weeks) are still in progress (${inProgress.values.slice(0, 3).join(", ")}). Some will become returns or RTO, so judge those rates on periods that have fully settled.`,
          tone: "warning",
          impact: impactScore(RELEVANCE.inProgress, 1, strength(open / recent, 0.2), "high"),
          confidence: "high",
          basis:
            "Share of the selected rows dated within 21 days of the latest date whose status is still in progress.",
        });
      }
    }
  }
  const rows = selected.length;
  if (rows > 0 && rows < 100) {
    out.push({
      id: "caveat-small",
      kind: "caveat",
      title: "Small selection",
      points: [`Only ${rows} rows selected`, "Percentages can swing on a few rows"],
      plain: `Only ${rows} rows match your filters, so treat percentages with care, or widen the filters.`,
      body: `Only ${rows} rows match the current filters. Percentages can swing widely on a few rows; widen the filters before drawing conclusions.`,
      tone: "warning",
      impact: impactScore(RELEVANCE.smallSelection, 1, 1, "high"),
      confidence: "high",
      basis: "Row count of the current selection.",
    });
  }
  return out;
}

/**
 * Runs every generator and keeps the 14 with the highest impact (ties keep
 * generator order). An empty selection gets none: insights describe the
 * selection, and a caveat about rows outside it would read as one about it
 * (the Insights step says that no rows match instead).
 */
export function generateInsights(input: InsightInput): Insight[] {
  const selected = selectRowsCached(input.ds, input.filters);
  if (!selected.length) return [];
  const timeBased = !input.roster;
  const all = [
    ...(timeBased ? safely(() => trendInsights(input)) : []),
    ...(timeBased ? safely(() => mixInsights(input)) : []),
    ...safely(() => segmentInsights(input)),
    ...(timeBased ? safely(() => anomalyInsights(input)) : []),
    ...safely(() => concentrationInsights(input)),
    ...(timeBased ? safely(() => seasonalityInsights(input)) : []),
    ...safely(() => driverInsights(input)),
    ...safely(() => outcomeDriverInsights(input, selected)),
    ...safely(() => caveatInsights(input, selected)),
  ];
  // A band chart's driver insight says less than the outcome's own driver insight on the same chart;
  // a segment gap of the outcome's own rate or average by a column already says what its category driver
  // insight would.
  const outcomeCharts = new Set(
    all.filter((i) => i.id.startsWith("outcome-") && i.chartId).map((i) => i.chartId),
  );
  const outcome = input.outcome?.target.column.name;
  const gapBy = (column: string) =>
    all.some(
      (i) =>
        i.kind === "segment" &&
        i.id.endsWith(`-${column}`) &&
        i.metricId !== undefined &&
        outcome !== undefined &&
        measureColumns(input, i.metricId).has(outcome),
    );
  return all
    .filter((i) => !(i.id.startsWith("driver-") && i.chartId && outcomeCharts.has(i.chartId)))
    .filter((i) => !(i.id.startsWith("outcome-category-") && gapBy(i.id.slice("outcome-category-".length))))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 14);
}
