/**
 * Computes the data behind every chart kind, plus captions and screen-reader descriptions.
 *
 * Grouped charts go through runQuery, so "Others" is recomputed from its rows
 * and totals are evaluated, never summed. Category charts default to the top
 * 15 groups; a donut never has more than six slices (the top five and a
 * recomputed Others when there are more). Groups below a chart's minimum
 * size are never dropped silently: a note says how many and why. Stacked
 * bars draw at most eight segments, the smallest series folded into an
 * "Others" segment evaluated from its own rows, and treemap parents are
 * evaluated over their own rows, so distinct counts and ratios are never
 * summed from parts. Histogram bins are clipped at p1–p99 when outliers would
 * squash the rest, with the end bins absorbing the tails. A time axis flags an
 * incomplete first or last bucket, which the peak/low annotations then skip,
 * and is never bucketed more finely than the date column's own cadence
 * (monthly snapshots stay monthly under a 30-day filter).
 *
 * A chart that draws only its top groups says so in a note ("Showing the top
 * 12 of 24 customer states by RTO rate"), and its takeaway names the lowest
 * bar as the lowest of those shown. Two-key charts (heatmaps, stacks) order
 * their text categories naturally (L1, L2 … L10), not by first appearance,
 * and columns, lines and tables over a number column (a score of 3–9) keep
 * the numbers' order rather than ranking them by value.
 * A measure that can't be computed any more is named, with the reason.
 * Values pass through finite(), so the UI only sees numbers or null.
 */
import type { Column, Dataset } from "@/engine/core/types";
import { autoGrain, bucketLabel, DAY_MS, endOfBucket, isoDate, type TimeGrain } from "@/engine/core/dates";
import { currencySymbol, formatCount, formatValue, type FormatOptions } from "@/engine/core/format";
import { atLeastGrain, cadenceGrain } from "@/engine/core/periods";
import { friendly } from "@/engine/core/labels";
import { linearRegression, niceBins, quantileSorted } from "@/engine/core/stats";
import { isAdditiveExpr, type Expr } from "@/engine/query/expr";
import { selectRowsCached, type Filter } from "@/engine/query/filter";
import {
  compileRowExpr,
  evaluate,
  kpiOrUndefined,
  MissingFieldError,
  type Resolver,
  type Scope,
} from "@/engine/query/evaluate";
import { buildGrouping, compactRows, type GroupKey } from "@/engine/query/groupby";
import { OTHERS_LABEL, periodScope, runQuery, type ResultGroup } from "@/engine/query/run";
import { evaluateMany, dateBounds } from "@/engine/kpi/compute";
import type { ChartKind } from "@/registry/schema";
import { computeBasket, computeCohorts, computeRfm } from "./analyses";
import { chartHeadline, type HeadlineTraits } from "./headline";
import {
  MAX_DONUT_SLICES,
  type Annotation,
  type ChartCategory,
  type ChartData,
  type ChartMeasure,
  type ChartSpec,
  type ResolvedAxis,
} from "./types";

export interface DrillState {
  /** Values chosen at each drilled level, e.g. ["Apparel"] → showing sub-categories of Apparel. */
  path: string[];
}

export interface ChartDataInput {
  ds: Dataset;
  resolver: Resolver;
  spec: ChartSpec;
  filters: readonly Filter[];
  dateColumn: string | null;
  fmt: FormatOptions;
  drill?: DrillState;
  /** Overrides from the chart's settings: group count, chart kind (switcher) and time grain. */
  topN?: number;
  kind?: ChartKind;
  grain?: TimeGrain;
  /**
   * Why a measure id no longer resolves, as a whole sentence, when the caller
   * knows (a KPI the user deleted, one whose column is hidden: brokenCharts'
   * chartProblem). Without it the reason is inferred from the kind of id.
   */
  measureIssue?: (id: string) => string | undefined;
}

const finite = (x: number | undefined): number | null => (x !== undefined && Number.isFinite(x) ? x : null);

/** Most segments a stacked bar draws (one per palette colour), "Others" included. */
const MAX_STACK = 8;

/** Descending order for nullable values; blanks sort last. */
const desc = (a: number | null, b: number | null): number =>
  a === null ? (b === null ? 0 : 1) : b === null ? -1 : b - a;

/**
 * An axis's own order: time buckets, date parts and bands by their raw
 * number, text by its label with digits compared as numbers ("L2" before
 * "L10"); blanks last.
 */
function naturalOrder(a: ChartCategory, b: ChartCategory): number {
  if (a.raw === null) return b.raw === null ? 0 : 1;
  if (b.raw === null) return -1;
  if (typeof a.raw === "number" && typeof b.raw === "number") return a.raw - b.raw;
  return a.label.localeCompare(b.label, "en", { numeric: true, sensitivity: "base" });
}

/** An empty result carrying a note; also the base object the analysis results extend. */
function emptyData(spec: ChartSpec, kind: ChartKind, note: string, totalRows = 0): ChartData {
  return {
    specId: spec.id,
    kind,
    categories: [],
    series: [],
    rows: [],
    totals: [],
    annotations: [],
    caption: "",
    altText: `${spec.title}: ${note}`,
    notes: [note],
    empty: true,
    totalRows,
  };
}

/**
 * Auto grain for a time axis: from the date filter's span, else the column's
 * full span; never finer than the column's cadence (monthly snapshots bucketed
 * by week would show empty weeks between them).
 */
function spanGrain(ds: Dataset, column: string, filters: readonly Filter[]): TimeGrain {
  const df = filters.find((f) => f.kind === "dateRange" && f.column === column);
  const b = dateBounds(ds, column);
  const g =
    df && df.kind === "dateRange"
      ? autoGrain((df.to - df.from) / DAY_MS)
      : b
        ? autoGrain((b.max - b.min) / DAY_MS)
        : "month";
  return atLeastGrain(g, cadenceGrain(b?.cadence));
}

/** A lower-case plural for a note ("Customer State" → "customer states", "Category" → "categories"); acronyms keep their capitals. */
function pluralNoun(label: string): string {
  const words = friendly(label)
    .split(" ")
    .map((w) => (/^[A-Z0-9%]{2,}$/.test(w) ? w : w.toLowerCase()));
  const last = words.pop() ?? "";
  const plural = /[^aeiou]y$/.test(last)
    ? `${last.slice(0, -1)}ies`
    : /(s|x|z|ch|sh)$/.test(last)
      ? `${last}es`
      : `${last}s`;
  return [...words, plural].join(" ");
}

/** A measure's name inside a sentence: "average MRP", but "RTO rate" keeps its capitals. */
function measureInSentence(label: string): string {
  const [first = "", ...rest] = label.split(" ");
  return /^[A-Z0-9%]{2,}$/.test(first) ? label : [first.toLowerCase(), ...rest].join(" ");
}

/**
 * Why a chart's measure can't be computed, naming it, in the words the
 * Customise step's chart list uses (ui/workspace/customise/brokenCharts.ts):
 * the reason the caller knows (ChartDataInput.measureIssue, a whole
 * sentence), else what the kind of id says. A KPI made in Customise ("uk_…")
 * was deleted or reads a hidden column; a KPI summarising one of the file's
 * other columns ("yc_…") goes when its column is hidden or an industry KPI
 * starts reading it; a template KPI needs a column the mapping no longer
 * gives it.
 */
function unavailableNote(missing: ChartMeasure[], known: (id: string) => string | undefined): string {
  const first = missing[0];
  const reason = first ? known(first.id) : undefined;
  if (reason) return reason;
  const names = missing.map((m) => `“${m.label}”`).join(" and ");
  if (first?.id.startsWith("uk_"))
    return `It shows ${names}, a KPI you made in Customise that was deleted or reads a column you hid in Check & map. Choose another measure, or delete this chart.`;
  if (first?.id.startsWith("yc_"))
    return `It shows ${names}, which is no longer computed: its column is hidden in Check & map, or one of the industry's KPIs now reads it. Show the column again, or delete this chart.`;
  return `It shows ${names}, which can't be computed with the current mapping. Map the columns ${missing.length > 1 ? "they need" : "it needs"} in Check & map, or delete this chart.`;
}

function binEdges(
  ds: Dataset,
  resolver: Resolver,
  axis: Extract<ResolvedAxis, { kind: "bins" }>,
  rows: Int32Array,
): { edges: number[]; clipped: boolean } {
  const get = compileRowExpr(axis.expr, resolver);
  const vals: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const v = get(rows[i] as number);
    if (Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return { edges: [0, 1], clipped: false };
  const sorted = Float64Array.from(vals).sort();
  const min = sorted[0] as number;
  const max = sorted[sorted.length - 1] as number;
  // Clip extreme tails so a few outliers don't squash every other bin.
  // Applies when p1–p99 spans less than half the full range; the outer edges
  // are then widened to the min and max so the end bins hold the tails.
  const lo = quantileSorted(sorted, 0.01);
  const hi = quantileSorted(sorted, 0.99);
  const clipped = hi - lo < (max - min) * 0.5;
  const edges = niceBins(clipped ? lo : min, clipped ? hi : max, axis.count);
  if (clipped) {
    edges[0] = Math.min(edges[0] as number, min);
    edges[edges.length - 1] = Math.max(edges[edges.length - 1] as number, max);
  }
  return { edges, clipped };
}

/**
 * GroupKey for a resolved axis; bin edges are computed from the selected
 * rows. A grain asked for (the dashboard's trend grain) is still never finer
 * than the date column's cadence; a calendar's day cells are the exception.
 */
function axisKey(
  ds: Dataset,
  resolver: Resolver,
  axis: ResolvedAxis,
  filters: readonly Filter[],
  rows: Int32Array,
  fmt: FormatOptions,
  grain?: TimeGrain,
  exactGrain = false,
): { key: GroupKey | null; grain?: TimeGrain; note?: string } {
  switch (axis.kind) {
    case "time": {
      const asked = grain ?? (axis.grain === "auto" ? spanGrain(ds, axis.column, filters) : axis.grain);
      const g = exactGrain ? asked : atLeastGrain(asked, cadenceGrain(dateBounds(ds, axis.column)?.cadence));
      return { key: { kind: "time", column: axis.column, grain: g }, grain: g };
    }
    case "column":
      return { key: { kind: "column", column: axis.column } };
    case "part":
      return { key: { kind: "datePart", column: axis.column, part: axis.part } };
    case "bins": {
      const { edges, clipped } = binEdges(ds, resolver, axis, rows);
      return {
        key: {
          kind: "binExpr",
          expr: axis.expr,
          edges,
          format: axis.format,
          label: axis.label,
          // Money bands carry the currency ("₹0–₹1K") and every band the user's number units.
          labels: { currencySymbol: currencySymbol(fmt.currency), locale: fmt.locale },
        },
        note: clipped ? "The first and last bands include the extreme 1% of values." : undefined,
      };
    }
    case "none":
      return { key: null };
  }
}

/** Axes with a natural order, where peak and low annotations make sense. */
const ORDINAL = new Set(["time", "part", "bins"]);

/** Kinds that read the spec's second category (its split): segments, side-by-side series, lines, rings, flows. */
const SPLIT_KINDS = new Set<ChartKind>([
  "heatmap",
  "stackedBar",
  "treemap",
  "groupedBar",
  "stackedBar100",
  "stackedArea",
  "line",
  "area",
  "step",
  "dumbbell",
  "radar",
  "sunburst",
  "sankey",
]);
/** Of those, the kinds drawn with one series per split value (a line, bar, segment or polygon each). */
const SERIES_FROM_SPLIT = new Set<ChartKind>([
  "stackedBar",
  "groupedBar",
  "stackedBar100",
  "stackedArea",
  "line",
  "area",
  "step",
  "dumbbell",
  "radar",
]);
/** Split kinds that keep only their largest split values: a dumbbell compares exactly two, a radar stays legible with five. */
const KEEP_LARGEST: Partial<Record<ChartKind, number>> = { dumbbell: 2, radar: 5 };
/** Category charts that keep every group (no default top N). */
const KEEP_ALL = new Set<ChartKind>(["table", "scatter", "bubble", "geoTile", "pareto"]);
/**
 * Kinds that read a category axis left to right or top to bottom: on a
 * number column (a score, a class number) their groups keep the numbers'
 * order. Sorted bars, donuts and the rest keep ranking by value.
 */
const IN_AXIS_ORDER = new Set<ChartKind>(["bar", "line", "area", "step", "table"]);

/** True when `column` holds numbers, so its values have an order of their own. */
const numberColumn = (ds: Dataset, column: string): boolean =>
  ds.columns.some((c) => c.name === column && c.kind === "number");

/**
 * The stacked "Others" segment: `expr` per x group over the rows whose series
 * value is not in `keep`, evaluated from those rows the way runQuery
 * evaluates its Others group, so distinct counts and ratios stay correct.
 * Returns one value per entry of `xRaws` (null when blank or absent).
 */
function othersByX(
  ds: Dataset,
  resolver: Resolver,
  filters: readonly Filter[],
  dateColumn: string | null,
  xKey: GroupKey,
  seriesKey: GroupKey,
  keep: ReadonlySet<string>,
  expr: Expr,
  xRaws: ReadonlyArray<string | number | null>,
): Array<number | null> {
  const selected = selectRowsCached(ds, filters);
  const getter = (k: GroupKey) => (k.kind === "binExpr" ? compileRowExpr(k.expr, resolver) : undefined);
  const gx = buildGrouping(ds, [xKey], selected, { getters: [getter(xKey)] });
  const gs = buildGrouping(ds, [seriesKey], selected, { getters: [getter(seriesKey)] });
  const kept = gs.labels.map((l) => keep.has(String(l[0]?.raw)));
  const groupOf = new Int32Array(selected.length);
  for (let i = 0; i < selected.length; i++) {
    const xg = gx.groupOf[i] as number;
    const sg = gs.groupOf[i] as number;
    groupOf[i] = xg < 0 || sg < 0 || kept[sg] ? -1 : xg;
  }
  const compact = compactRows(selected, groupOf);
  // Same period context as runQuery: a time bucket starts at its own start or the filter's, whichever is later.
  const { periodStart, rowsIgnoringDate } = periodScope(ds, filters, dateColumn);
  const scope: Scope = {
    periodStart,
    rowsIgnoringDate,
    ignoringDateGroups: null,
    periodStartByGroup: gx.periodStart
      ? Float64Array.from(gx.periodStart, (t) => Math.max(t, periodStart))
      : null,
  };
  const values = evaluate(expr, resolver, scope, compact.rows, compact.groupOf, gx.G, new Map());
  const byRaw = new Map(gx.labels.map((l, g) => [String(l[0]?.raw), values[g] as number]));
  return xRaws.map((r) => finite(byRaw.get(String(r))));
}

/**
 * Data for one chart under the current filters, drill path and settings
 * overrides, with its takeaway (chartHeadline): the share of a total is only
 * offered for a measure that adds up, which is decided here from its
 * definition, since the chart data alone can't tell a sum from an average.
 */
export function computeChartData(input: ChartDataInput): ChartData {
  const groups: { info?: HeadlineTraits["groups"] } = {};
  let data: ChartData;
  try {
    data = chartDataFor(input, groups);
  } catch (e) {
    // A column the chart reads isn't in this file at all (a layout saved from another file):
    // say which, rather than "Field col:… is not mapped".
    if (!(e instanceof MissingFieldError)) throw e;
    const raw = e.field.startsWith("col:");
    const name = friendly(e.field.replace(/^col:/, ""));
    return emptyData(
      input.spec,
      input.kind ?? input.spec.kind,
      raw
        ? `It uses ${name}, which isn't in this file. Delete this chart, or load the file it was made for.`
        : `It needs ${name}, which isn't mapped to a column. Map it in Check & map, or delete this chart.`,
    );
  }
  const first = input.spec.measures[0];
  const expr = first ? kpiOrUndefined(input.resolver, first.id) : undefined;
  const headline = chartHeadline(input.spec, data, input.fmt, {
    additive: expr ? isAdditiveExpr(expr, (id) => kpiOrUndefined(input.resolver, id)) : false,
    distinct: expr ? countsDistinct(expr, input.resolver) : false,
    groups: groups.info,
  });
  if (headline) data.headline = headline;
  return data;
}

/**
 * The chart's data. `out.info` is set when the chart draws only some of its
 * axis's groups, for the takeaway (chartHeadline) to qualify what it claims.
 */
function chartDataFor(input: ChartDataInput, out: { info?: HeadlineTraits["groups"] }): ChartData {
  const { ds, resolver, spec, dateColumn, fmt } = input;
  const kind = input.kind ?? spec.kind;
  const filters: Filter[] = [...input.filters];
  let x = spec.x;

  // Drill-down: move one level down the hierarchy and filter by the chosen parents.
  if (spec.drill && input.drill && input.drill.path.length) {
    const level = Math.min(input.drill.path.length, spec.drill.length - 1);
    for (let i = 0; i < level; i++)
      filters.push({ kind: "in", column: spec.drill[i] as string, values: [input.drill.path[i] as string] });
    const column = spec.drill[level] as string;
    x = { kind: "column", column, label: friendly(column) };
  }

  const measures = spec.measures.map((m) => {
    try {
      return { id: m.id, expr: resolver.kpi(m.id) };
    } catch {
      return null;
    }
  });
  if (measures.some((m) => m === null))
    return emptyData(
      spec,
      kind,
      unavailableNote(
        spec.measures.filter((_, i) => measures[i] === null),
        (id) => input.measureIssue?.(id),
      ),
    );
  const ms = measures as Array<{ id: string; expr: ReturnType<Resolver["kpi"]> }>;
  const notes: string[] = [];

  // ---------------- analyses
  if (spec.analysis === "cohort" && spec.analysisParams?.customer && spec.analysisParams.date) {
    const { cohorts, notes: n } = computeCohorts(ds, filters, {
      customer: spec.analysisParams.customer,
      date: spec.analysisParams.date,
    });
    const total = selectRowsCached(ds, filters).length;
    if (!cohorts.length) return emptyData(spec, kind, "No cohorts in this selection.", total);
    return {
      ...emptyData(spec, kind, ""),
      empty: false,
      cohorts,
      categories: cohorts.map((c) => ({ label: c.label, raw: c.cohort })),
      notes: n,
      totalRows: total,
      altText: `Cohort retention heatmap for ${cohorts.length} monthly cohorts. Month-1 retention ranges from ${pctText(cohorts, 1, "min")} to ${pctText(cohorts, 1, "max")}.`,
    };
  }
  if (
    spec.analysis === "rfm" &&
    spec.analysisParams?.customer &&
    spec.analysisParams.date &&
    spec.analysisParams.monetary
  ) {
    const out = computeRfm(ds, resolver, filters, dateColumn, {
      customer: spec.analysisParams.customer,
      date: spec.analysisParams.date,
      order: spec.analysisParams.order,
      monetary: spec.analysisParams.monetary,
    });
    if (!out.segments.length) return emptyData(spec, kind, "No customers in this selection.");
    const top = out.segments[0];
    return {
      ...emptyData(spec, kind, ""),
      empty: false,
      rfm: out.segments,
      categories: out.segments.map((s) => ({ label: s.segment, raw: s.segment })),
      series: [
        {
          id: "customers",
          label: "Customers",
          values: out.segments.map((s) => s.customers),
          format: "integer",
        },
      ],
      notes: out.notes,
      totalRows: out.customers,
      altText: `RFM segmentation of ${out.customers} customers into ${out.segments.length} segments. ${top ? `${top.segment} hold ${(top.revenueShare * 100).toFixed(0)}% of revenue from ${(top.customerShare * 100).toFixed(0)}% of customers.` : ""}`,
    };
  }
  if (spec.analysis === "basket" && spec.analysisParams?.order && spec.analysisParams.item) {
    const out = computeBasket(ds, filters, {
      order: spec.analysisParams.order,
      item: spec.analysisParams.item,
    });
    return {
      ...emptyData(spec, kind, out.pairs.length ? "" : "No product pairs reach the minimum support."),
      empty: out.pairs.length === 0,
      basket: {
        pairs: out.pairs,
        level: spec.analysisParams.itemLabel ?? "product",
        orders: out.orders,
        multiItemOrders: out.multiItemOrders,
      },
      notes: out.notes,
      totalRows: out.orders,
      altText: `Table of the ${out.pairs.length} product pairs most often bought together, ranked by lift.`,
    };
  }
  if (spec.analysis === "funnel") {
    const ev = evaluateMany(ds, resolver, ms, filters, dateColumn);
    const values = ms.map((m) => finite(ev.values.get(m.id)));
    const first = values[0] ?? null;
    const funnel = spec.measures.map((m, i) => ({
      label: m.label,
      value: values[i] ?? null,
      fromPrev: i > 0 && values[i - 1] ? (values[i] ?? 0) / (values[i - 1] as number) : null,
      fromFirst: i > 0 && first ? (values[i] ?? 0) / first : null,
    }));
    return {
      ...emptyData(spec, kind, ""),
      empty: values.every((v) => v === null),
      funnel,
      categories: funnel.map((f) => ({ label: f.label, raw: f.label })),
      series: [{ id: "stage", label: "Stage volume", values, format: "integer" }],
      totalRows: ev.rows,
      altText: `Funnel with ${funnel.length} stages: ${funnel.map((f) => `${f.label} ${formatValue(f.value, "integer", fmt)}`).join(", ")}.`,
    };
  }

  // ---------------- one value (big number, gauge): the measure over every row in the selection
  if (x.kind === "none" && (kind === "bigNumber" || kind === "gauge")) {
    const ev = evaluateMany(ds, resolver, ms.slice(0, 1), filters, dateColumn);
    const m = spec.measures[0];
    const value = finite(ev.values.get(m?.id ?? ""));
    const format = m?.format ?? "number";
    const label = m?.label ?? "Value";
    return {
      ...emptyData(spec, kind, value === null ? "No value for the current filters." : ""),
      empty: value === null,
      categories: [{ label, raw: m?.id ?? "value" }],
      series: [{ id: m?.id ?? "value", label, values: [value], format }],
      rows: [ev.rows],
      totals: [value],
      totalRows: ev.rows,
      altText: `${label}: ${formatValue(value, format, fmt)}${spec.target !== undefined ? `, against a goal of ${formatValue(spec.target, format, fmt)}` : ""}.`,
    };
  }

  // ---------------- grouped charts
  const selected = selectRowsCached(ds, filters);
  if (selected.length === 0) return emptyData(spec, kind, "No rows match the current filters.");
  // A calendar has one cell per day, whatever grain the dashboard uses.
  const calendar = kind === "calendar";
  const xk = axisKey(ds, resolver, x, filters, selected, fmt, calendar ? "day" : input.grain, calendar);
  if (!xk.key) return emptyData(spec, kind, "This chart has no axis.");
  if (xk.note) notes.push(xk.note);
  const keys: GroupKey[] = [xk.key];
  let seriesKey: GroupKey | null = null;
  if (spec.series && SPLIT_KINDS.has(kind)) {
    const sk = axisKey(ds, resolver, spec.series, filters, selected, fmt);
    if (sk.key) {
      keys.push(sk.key);
      seriesKey = sk.key;
    }
    if (sk.note) notes.push(sk.note);
  }
  const isTwoKey = keys.length === 2;
  // Category charts default to the top 15 groups; tables, scatters, tile maps
  // and Pareto charts keep every group. Donuts fold the rest into Others by
  // default so the slices still add up to the whole, and never show more than
  // MAX_DONUT_SLICES slices, Others included, whatever top N was asked for.
  const categorical = x.kind === "column" && !isTwoKey;
  const donut = categorical && (kind === "donut" || kind === "pie");
  // A radar compares a few items' profiles: five polygons at most.
  let topN =
    input.topN ?? spec.topN ?? (categorical && !KEEP_ALL.has(kind) ? (kind === "radar" ? 5 : 15) : undefined);
  if (donut) topN = Math.min(topN || MAX_DONUT_SLICES, MAX_DONUT_SLICES);
  const minRows = spec.minGroupRows;
  const query = (n: number | undefined) =>
    runQuery(ds, resolver, {
      filters,
      groupBy: keys,
      measures: ms,
      dense: kind === "heatmap",
      dateColumn,
      topN: categorical && n ? { n, rankBy: 0, others: spec.others ?? donut, minRows } : undefined,
    });
  let q = query(topN);
  // Six slices plus Others would be seven: show the top five and a recomputed Others instead.
  if (donut && q.groups.length > MAX_DONUT_SLICES) q = query(MAX_DONUT_SLICES - 1);
  let groups: ResultGroup[] = q.groups;
  // Without topN, runQuery keeps first-seen order: sort by the first measure here.
  if (categorical && !topN)
    groups = [...groups].sort((a, b) => desc(finite(a.values[0]), finite(b.values[0])));
  // runQuery only applies the minimum group size with a top N; without one it is applied (and counted) here.
  let suppressed = q.suppressed;
  if (categorical && minRows && !topN) {
    const kept = groups.filter((g) => g.rows >= minRows);
    suppressed += groups.length - kept.length;
    groups = kept;
  }
  // A number column on the axis (a score of 3–9, a class of 1–3) drawn as columns, a line or a table reads
  // in its own order, like bands, rather than ranked by value; Others and blanks stay last.
  if (categorical && IN_AXIS_ORDER.has(kind) && x.kind === "column" && numberColumn(ds, x.column))
    groups = [...groups].sort(
      (a, b) =>
        Number(Boolean(a.isOthers)) - Number(Boolean(b.isOthers)) ||
        naturalOrder(
          { label: a.labels[0]?.label ?? "", raw: a.labels[0]?.raw ?? null },
          { label: b.labels[0]?.label ?? "", raw: b.labels[0]?.raw ?? null },
        ),
    );
  if (suppressed) {
    // With an Others bucket the small groups are folded into it; otherwise they are left out.
    const where = groups.some((g) => g.isOthers)
      ? "counted in Others rather than shown on their own"
      : "hidden as too small to compare";
    notes.push(
      `${suppressed} group${suppressed > 1 ? "s" : ""} with fewer than ${minRows} rows ${suppressed > 1 ? "are" : "is"} ${where}.`,
    );
  }
  // A "(blank)" group (rows with nothing in the axis column) whose measures are blank or zero too
  // adds a label with no bar: it is left out, and the note says so. One with a value stays.
  if (categorical && x.kind === "column") {
    const empty = (g: ResultGroup) =>
      g.labels[0]?.raw === null && !g.isOthers && g.values.every((v) => !Number.isFinite(v) || v === 0);
    const blank = groups.find(empty);
    if (blank) {
      groups = groups.filter((g) => g !== blank);
      notes.push(
        `${formatCount(blank.rows, fmt.locale)} row${blank.rows === 1 ? "" : "s"} with no ${x.label} and no value ${blank.rows === 1 ? "is" : "are"} left out.`,
      );
    }
  }
  // A top N (or groups too small to compare) leaves some of the axis's values out, or folds them
  // into Others. Count them: the note says how many are shown, and the takeaway never calls the
  // lowest bar drawn the lowest overall.
  if (categorical && x.kind === "column" && (topN || suppressed)) {
    const shown = groups.filter((g) => !g.isOthers && g.labels[0]?.raw !== null).length;
    const all = buildGrouping(ds, [xk.key], selected).labels.filter((l) => l[0]?.raw !== null).length;
    if (shown < all) {
      // runQuery ranks by the first measure, so the groups drawn are its highest.
      out.info = { shown, total: all, rankedByValue: true };
      // More groups qualified than were drawn: the top N cut them (groups too small to compare
      // have a note of their own).
      if (all - suppressed > shown) {
        const others = groups.some((g) => g.isOthers);
        notes.unshift(
          `Showing the top ${shown} of ${all} ${pluralNoun(x.label)} by ${measureInSentence(spec.measures[0]?.label ?? "value")}${others ? `; the other ${all - shown} are combined in Others` : ""}.`,
        );
      }
    }
  }
  const folded = groups.find((g) => g.isOthers)?.foldedGroups;

  const data: ChartData = {
    specId: spec.id,
    kind,
    categories: [],
    series: [],
    rows: [],
    totals: q.totals.map((t) => finite(t)),
    annotations: [],
    grain: xk.grain,
    suppressed: suppressed || undefined,
    folded,
    caption: "",
    altText: "",
    notes,
    empty: groups.length === 0,
    totalRows: q.totalRows,
    ...(x.kind !== "none" ? { axisLabel: x.label } : {}),
  };

  if (isTwoKey) {
    // Rows = series key, columns = x key.
    const xCats: ChartCategory[] = [];
    const yCats: ChartCategory[] = [];
    const xIdx = new Map<string, number>();
    const yIdx = new Map<string, number>();
    for (const g of groups) {
      const a = g.labels[0];
      const b = g.labels[1];
      if (!a || !b) continue;
      const ka = String(a.raw);
      const kb = String(b.raw);
      if (!xIdx.has(ka)) {
        xIdx.set(ka, xCats.length);
        xCats.push({ label: a.label, raw: a.raw });
      }
      if (!yIdx.has(kb)) {
        yIdx.set(kb, yCats.length);
        yCats.push({ label: b.label, raw: b.raw });
      }
    }
    // Groups come in the order rows first show them (L1, L4, L2…): both axes are put in their
    // natural order instead, periods and bands by time and size, text with its numbers read as
    // numbers (L2 before L10).
    xCats.sort(naturalOrder);
    yCats.sort(naturalOrder);
    xCats.forEach((c, i) => xIdx.set(String(c.raw), i));
    yCats.forEach((c, i) => yIdx.set(String(c.raw), i));
    const matrix: Array<Array<number | null>> = yCats.map(() => xCats.map(() => null));
    for (const g of groups) {
      const xi = xIdx.get(String(g.labels[0]?.raw));
      const yi = yIdx.get(String(g.labels[1]?.raw));
      if (xi === undefined || yi === undefined) continue;
      (matrix[yi] as Array<number | null>)[xi] = finite(g.values[0]);
    }
    data.categories = xCats;
    data.seriesCategories = yCats;
    data.matrix = matrix;
    if (kind === "treemap" || kind === "sunburst") {
      // A parent's value is the measure over the parent's own rows (one query
      // on the parent key), never the sum of its children: distinct customers
      // or a ratio don't add up across sub-categories.
      const pq = runQuery(ds, resolver, { filters, groupBy: [xk.key], measures: ms, dateColumn });
      const parentValue = new Map(pq.groups.map((g) => [String(g.labels[0]?.raw), finite(g.values[0])]));
      const parents = new Map<
        string,
        { label: string; value: number | null; children: Array<{ label: string; value: number | null }> }
      >();
      for (const g of groups) {
        const key = String(g.labels[0]?.raw);
        const node = parents.get(key) ?? {
          label: g.labels[0]?.label ?? "",
          value: parentValue.get(key) ?? null,
          children: [],
        };
        node.children.push({ label: g.labels[1]?.label ?? "", value: finite(g.values[0]) });
        parents.set(key, node);
      }
      data.tree = [...parents.values()].sort((a, b) => desc(a.value, b.value));
    }
    const measure = ms[0];
    const fromSplit = SERIES_FROM_SPLIT.has(kind);
    const keepLargest = KEEP_LARGEST[kind];
    if (fromSplit && keepLargest && seriesKey && measure && yCats.length > keepLargest) {
      // A dumbbell compares exactly two values and a radar stays legible with five: keep the largest
      // split values (each ranked by its own value over every x) and say which were left out.
      const rank = runQuery(ds, resolver, { filters, groupBy: [seriesKey], measures: [measure], dateColumn });
      const size = new Map(rank.groups.map((g) => [String(g.labels[0]?.raw), finite(g.values[0])]));
      const keep = yCats
        .map((y, yi) => ({ y, yi, v: size.get(String(y.raw)) ?? null }))
        .sort((a, b) => desc(a.v, b.v))
        .slice(0, keepLargest);
      data.seriesCategories = keep.map((k) => k.y);
      data.matrix = keep.map((k) => matrix[k.yi] as Array<number | null>);
      notes.push(
        `Showing the ${keepLargest} largest of ${yCats.length} ${spec.series?.kind === "column" ? spec.series.label : "series"}: ${keep.map((k) => k.y.label).join(" and ")}.`,
      );
    } else if (fromSplit && seriesKey && measure && yCats.length > MAX_STACK) {
      // Keep the largest series (each ranked by its own value over every x)
      // and fold the rest into one Others segment evaluated from its rows.
      const rank = runQuery(ds, resolver, { filters, groupBy: [seriesKey], measures: [measure], dateColumn });
      const size = new Map(rank.groups.map((g) => [String(g.labels[0]?.raw), finite(g.values[0])]));
      const keep = yCats
        .map((y, yi) => ({ y, yi, v: size.get(String(y.raw)) ?? null }))
        .sort((a, b) => desc(a.v, b.v))
        .slice(0, MAX_STACK - 1);
      const othersRow = othersByX(
        ds,
        resolver,
        filters,
        dateColumn,
        xk.key,
        seriesKey,
        new Set(keep.map((k) => String(k.y.raw))),
        measure.expr,
        xCats.map((c) => c.raw),
      );
      data.seriesCategories = [
        ...keep.map((k) => k.y),
        { label: OTHERS_LABEL, raw: "__others__", isOthers: true },
      ];
      data.matrix = [...keep.map((k) => matrix[k.yi] as Array<number | null>), othersRow];
      notes.push(
        `The ${yCats.length - keep.length} smallest of ${yCats.length} series are combined into ${OTHERS_LABEL}, computed from their own rows.`,
      );
    }
    if (fromSplit) {
      const format = spec.measures[0]?.format ?? "number";
      data.series = (data.seriesCategories ?? []).map((y, yi) => ({
        id: String(y.raw),
        label: y.label,
        values: data.matrix?.[yi] ?? [],
        format,
      }));
    }
  } else {
    data.categories = groups.map((g) => ({
      label: g.labels[0]?.label ?? "",
      raw: g.labels[0]?.raw ?? null,
      isOthers: g.isOthers,
    }));
    data.rows = groups.map((g) => g.rows);
    data.series = spec.measures.map((m, j) => ({
      id: m.id,
      label: m.label,
      values: groups.map((g) => finite(g.values[j])),
      format: m.format,
    }));
    if (kind === "treemap" || kind === "sunburst")
      data.tree = groups.map((g) => ({ label: g.labels[0]?.label ?? "", value: finite(g.values[0]) }));
    if ((kind === "scatter" || kind === "bubble") && spec.measures.length >= 2) {
      data.points = groups.map((g) => ({
        label: g.labels[0]?.label ?? "",
        x: finite(g.values[0]),
        y: finite(g.values[1]),
        ...(kind === "bubble" ? { size: finite(g.values[2]) } : {}),
      }));
      const pts = data.points.filter((p) => p.x !== null && p.y !== null);
      data.trendline =
        pts.length >= 3
          ? linearRegression(
              pts.map((p) => p.x as number),
              pts.map((p) => p.y as number),
            )
          : null;
    }
    if (kind === "pareto" || spec.analysis === "pareto") {
      // Shares are taken over every group returned; only the first 40 are drawn.
      const vals = data.series[0]?.values ?? [];
      const total = vals.reduce<number>((s, v) => s + (v ?? 0), 0);
      if (total > 0) {
        const share = vals.map((v) => (v ?? 0) / total);
        const cum: number[] = [];
        share.reduce((s, v, i) => ((cum[i] = s + v), s + v), 0);
        const itemsForEighty = cum.findIndex((c) => c >= 0.8) + 1;
        const topCount = Math.max(1, Math.round(vals.length * 0.2));
        data.pareto = { topShare: cum[topCount - 1] ?? 0, itemsForEighty, itemCount: vals.length, topCount };
        data.series = [
          { id: "share", label: "Share of total", values: share, format: "percent" },
          { id: "cumulative", label: "Cumulative share", values: cum, format: "percent" },
        ];
        const keep = Math.min(vals.length, 40);
        data.categories = data.categories.slice(0, keep);
        data.series = data.series.map((s) => ({ ...s, values: s.values.slice(0, keep) }));
        if (vals.length > keep)
          notes.push(
            `Showing the top ${keep} of ${vals.length} items; the cumulative line accounts for all of them.`,
          );
      }
    }
    // A distinct count over groups that overlap (an order with lines under two
    // return reasons is counted under both) makes the bars add up to more than
    // the distinct total. Say so, with both numbers, so it doesn't read as an error.
    const only = ms[0];
    if (
      x.kind === "column" &&
      ms.length === 1 &&
      only &&
      data.series.length === 1 &&
      countsDistinct(only.expr, resolver)
    ) {
      const groupsTotal = (data.series[0]?.values ?? []).reduce<number>((a, v) => a + (v ?? 0), 0);
      const overall = evaluateMany(
        ds,
        resolver,
        [{ id: "t", expr: only.expr }],
        filters,
        dateColumn,
      ).values.get("t");
      if (overall !== undefined && Number.isFinite(overall) && groupsTotal > overall + 0.5) {
        const f = (v: number) => formatValue(v, "integer", fmt);
        notes.push(
          `Some items fall under more than one ${x.label}, so the bars add up to ${f(groupsTotal)} while the distinct total is ${f(overall)}.`,
        );
      }
    }
    if (x.kind === "time" && xk.grain) {
      // Same rule as the KPI sparklines: a bucket is incomplete when the data
      // (or the date filter) ends more than a day before its natural end, or
      // starts more than a day after its start; day buckets never are.
      const first = data.categories[0]?.raw;
      const last = data.categories[data.categories.length - 1]?.raw;
      const bounds = dateBounds(ds, x.column);
      const df = filters.find((f) => f.kind === "dateRange" && f.column === x.column);
      const dataStart = Math.max(
        bounds?.min ?? -Infinity,
        df && df.kind === "dateRange" ? df.from : -Infinity,
      );
      const dataEnd = Math.min(bounds?.max ?? Infinity, df && df.kind === "dateRange" ? df.to : Infinity);
      if (typeof first === "number" && xk.grain !== "day" && dataStart > first + DAY_MS) {
        data.partialFirst = true;
        data.partialFirstStart = dataStart;
        notes.push(
          `${bucketLabel(first, xk.grain, true)} is incomplete (data starts ${isoDate(dataStart)}).`,
        );
      }
      if (typeof last === "number" && xk.grain !== "day" && dataEnd < endOfBucket(last, xk.grain) - DAY_MS) {
        data.partialLast = true;
        data.partialLastEnd = dataEnd;
        notes.push(`${bucketLabel(last, xk.grain, true)} is incomplete (data ends ${isoDate(dataEnd)}).`);
      }
    }
    if (ORDINAL.has(x.kind) && data.series[0])
      data.annotations = peakAnnotations(
        data.series[0].values,
        data.categories,
        fmt,
        data.series[0].format,
        data.partialFirst,
        data.partialLast,
      );
  }

  // Every value zero or blank (returns in a selection of delivered orders): bars of no height and a
  // flat line read as a broken chart, so the card says it in words. The values stay for the table.
  const all = data.matrix ? data.matrix.flat() : data.series.flatMap((s) => s.values);
  if (
    !data.empty &&
    data.categories.length &&
    kind !== "scatter" &&
    kind !== "bubble" &&
    all.every((v) => v === null || v === 0)
  ) {
    const what = spec.measures.length === 1 ? (spec.measures[0]?.label ?? "This measure") : "Every measure";
    const per =
      x.kind === "time"
        ? (data.grain ?? "period")
        : x.kind === "part"
          ? x.label.toLowerCase()
          : x.kind === "none"
            ? "group"
            : x.label;
    data.empty = true;
    notes.unshift(
      all.some((v) => v === 0)
        ? `${what} is 0 for every ${per} in this selection.`
        : `${what} has no value in this selection.`,
    );
  }

  // Colours follow each value's rank in the whole file (see valueRanks).
  if (x.kind === "column") rankCategories(ds, x.column, data.categories);
  if (spec.series?.kind === "column") rankCategories(ds, spec.series.column, data.seriesCategories);

  data.altText = describe(spec, data, fmt);
  return data;
}

const RANKS = new WeakMap<Column, Map<string, number>>();

/**
 * Each value of a text or yes/no column ranked by its rows over the whole
 * file (ties in first-seen order), computed once per column. Chart colours
 * follow these ranks rather than a chart's own sort, so filtering never
 * repaints the values that remain.
 */
export function valueRanks(col: Column): Map<string, number> {
  const cached = RANKS.get(col);
  if (cached) return cached;
  const ranks = new Map<string, number>();
  if (col.kind === "string") {
    const counts = new Float64Array(col.dict.length);
    for (const c of col.codes) if (c >= 0) counts[c] = (counts[c] ?? 0) + 1;
    [...counts.keys()]
      .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || a - b)
      .forEach((code, i) => ranks.set(col.dict[code] as string, i));
  } else if (col.kind === "boolean") {
    let yes = 0;
    let no = 0;
    for (const v of col.values) {
      if (v === 1) yes++;
      else if (v === 0) no++;
    }
    const order = yes >= no ? [col.trueLabel, col.falseLabel] : [col.falseLabel, col.trueLabel];
    order.forEach((label, i) => ranks.set(label, i));
  }
  RANKS.set(col, ranks);
  return ranks;
}

/** Gives categories of a text or yes/no column their whole-file rank (valueRanks). */
function rankCategories(ds: Dataset, column: string, cats: ChartCategory[] | undefined): void {
  const col = ds.columns.find((c) => c.name === column);
  if (!col || !cats || (col.kind !== "string" && col.kind !== "boolean")) return;
  const ranks = valueRanks(col);
  for (const c of cats) {
    const r = c.isOthers ? undefined : ranks.get(c.label);
    if (r !== undefined) c.rank = r;
  }
}

/** Lowest or highest retention at a month offset across cohorts, as a percentage. */
function pctText(
  cohorts: Array<{ retention: Array<number | null> }>,
  offset: number,
  which: "min" | "max",
): string {
  const vals = cohorts
    .map((c) => c.retention[offset])
    .filter((v): v is number => v !== null && v !== undefined);
  if (!vals.length) return "n/a";
  const v = which === "min" ? Math.min(...vals) : Math.max(...vals);
  return `${(v * 100).toFixed(1)}%`;
}

/** Peak and low markers for an ordinal axis; needs four usable points and skips an incomplete first or last bucket. */
function peakAnnotations(
  values: Array<number | null>,
  cats: ChartCategory[],
  fmt: FormatOptions,
  format: ChartData["series"][number]["format"],
  partialFirst?: boolean,
  partialLast?: boolean,
): Annotation[] {
  const usable = values
    .map((v, i) => ({ v, i }))
    .filter(
      (x) => x.v !== null && !(partialFirst && x.i === 0) && !(partialLast && x.i === values.length - 1),
    ) as Array<{ v: number; i: number }>;
  if (usable.length < 4) return [];
  const max = usable.reduce((a, b) => (b.v > a.v ? b : a));
  const min = usable.reduce((a, b) => (b.v < a.v ? b : a));
  const out: Annotation[] = [
    {
      index: max.i,
      kind: "max",
      label: `Peak ${formatValue(max.v, format, { ...fmt, compact: true })} · ${cats[max.i]?.label ?? ""}`,
    },
  ];
  if (min.i !== max.i)
    out.push({
      index: min.i,
      kind: "min",
      label: `Low ${formatValue(min.v, format, { ...fmt, compact: true })} · ${cats[min.i]?.label ?? ""}`,
    });
  return out;
}

const KIND_NAME: Partial<Record<ChartKind, string>> = {
  line: "Line chart",
  area: "Area chart",
  bar: "Column chart",
  hbar: "Bar chart",
  stackedBar: "Stacked column chart",
  donut: "Donut chart",
  treemap: "Treemap",
  scatter: "Scatter plot",
  histogram: "Histogram",
  heatmap: "Heatmap",
  pareto: "Pareto chart",
  geoTile: "Tile map",
  table: "Table",
  pie: "Pie chart",
  groupedBar: "Grouped column chart",
  stackedBar100: "100% stacked column chart",
  stackedArea: "Stacked area chart",
  step: "Step line chart",
  lollipop: "Lollipop chart",
  dumbbell: "Dumbbell chart",
  bubble: "Bubble chart",
  radar: "Radar chart",
  sunburst: "Sunburst chart",
  sankey: "Sankey diagram",
  calendar: "Calendar heatmap",
};

/** Plain-language summary for screen readers and the chart's table view. */
export function describe(spec: ChartSpec, data: ChartData, fmt: FormatOptions): string {
  if (data.empty) return `${spec.title}: no data for the current filters.`;
  const name = KIND_NAME[data.kind] ?? "Chart";
  const s = data.series[0];
  if (!s || !data.categories.length) return `${name} of ${spec.title}.`;
  const f = (v: number | null) => formatValue(v, s.format, { ...fmt, compact: true });
  const pairs = data.categories
    .map((c, i) => ({ c, v: s.values[i] ?? null }))
    .filter((p) => p.v !== null) as Array<{ c: ChartCategory; v: number }>;
  if (!pairs.length) return `${name} of ${spec.title}: no values.`;
  if (spec.x.kind === "time" || spec.x.kind === "part" || spec.x.kind === "bins") {
    const max = pairs.reduce((a, b) => (b.v > a.v ? b : a));
    const min = pairs.reduce((a, b) => (b.v < a.v ? b : a));
    const first = pairs[0] as { c: ChartCategory; v: number };
    const last = pairs[pairs.length - 1] as { c: ChartCategory; v: number };
    return `${name} of ${s.label} from ${first.c.label} to ${last.c.label}. Highest ${f(max.v)} (${max.c.label}), lowest ${f(min.v)} (${min.c.label}), latest ${f(last.v)}.`;
  }
  const sorted = [...pairs].sort((a, b) => b.v - a.v);
  const top = sorted
    .slice(0, 3)
    .map((p) => `${p.c.label} ${f(p.v)}`)
    .join(", ");
  return `${name} of ${s.label} across ${pairs.length} ${spec.x.kind === "column" ? spec.x.label : "groups"}. Top: ${top}.${pairs.some((p) => p.c.label === OTHERS_LABEL) ? " Remaining groups are combined as Others." : ""}`;
}

/** True when the measure is a distinct count (directly, or through refs and filters). */
function countsDistinct(e: Expr, resolver: Resolver, depth = 0): boolean {
  if (depth > 8) return false;
  if ("agg" in e) return e.agg === "countDistinct";
  if ("calc" in e) return countsDistinct(e.calc, resolver, depth + 1);
  if ("ref" in e) {
    try {
      return countsDistinct(resolver.kpi(e.ref), resolver, depth + 1);
    } catch {
      return false;
    }
  }
  return false;
}
