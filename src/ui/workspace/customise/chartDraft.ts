/**
 * The chart builder's logic, kept apart from its React form (ChartStudio)
 * so it can be tested on real data (tests/chart-catalogue.test.ts):
 * - columnsOf(): which of the file's columns each slot can use (dates,
 *   times of day, categories, split categories, numbers, state columns);
 * - missing(): why a chart type can't be built from this file, if it can't;
 * - newDraft() / draftFromSpec() / adapt(): a first draft for a type, a
 *   draft from an existing chart, and a draft carried over to another type;
 * - buildSpec(): the ChartSpec a draft describes, through customSpec(), or
 *   a plain sentence on what the chosen type needs instead;
 * - autoTitle(): the title a chart gets when the user doesn't name it.
 */
import type { ChartKind, ChartMeasure, ChartSection, ChartSpec, ResolvedAxis } from "@/engine/charts/types";
import { chartType, type ChartTypeInfo } from "@/engine/charts/catalogue";
import { customSpec, isKindCompatible } from "@/engine/charts/recommend";
import { askMeasure, axisFor, type AskAgg, type AskContext, type AskMeasure } from "@/engine/charts/ask";
import { fieldsOf } from "@/engine/query/expr";
import type { DatePart, TimeGrain } from "@/engine/core/dates";
import type { ColumnProfile } from "@/engine/profile/types";
import type { ContextResult } from "@/engine/session";

export type AxisChoice =
  | { type: "time"; column: string; grain: TimeGrain | "auto" }
  | { type: "part"; column: string; part: DatePart }
  | { type: "column"; column: string }
  | { type: "bins"; column: string; count: number }
  | { type: "none" };

export interface Draft {
  kind: ChartKind;
  axis: AxisChoice;
  split: string | null;
  measures: AskMeasure[];
  topN: number | null;
  /** Text as typed; a goal for a gauge or big number. */
  target: string;
  /** "" = automatic. */
  title: string;
  section: ChartSection;
  w: number;
  h: number;
}

export const GRAINS: Array<{ id: TimeGrain | "auto"; label: string }> = [
  { id: "auto", label: "Automatic" },
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
  { id: "year", label: "Year" },
];
export const PARTS: Array<{ id: DatePart; label: string }> = [
  { id: "dow", label: "Weekday" },
  { id: "hour", label: "Hour of day" },
  { id: "month", label: "Month of year" },
  { id: "dom", label: "Day of month" },
];
export const AGGS: Array<{ id: AskAgg; label: string; numeric: boolean }> = [
  { id: "sum", label: "Total", numeric: true },
  { id: "avg", label: "Average", numeric: true },
  { id: "median", label: "Median", numeric: true },
  { id: "min", label: "Lowest", numeric: true },
  { id: "max", label: "Highest", numeric: true },
  { id: "countDistinct", label: "Distinct count", numeric: false },
  { id: "count", label: "Number of rows", numeric: false },
];
export const TOPNS = [5, 10, 15, 20, 30];

/** The columns each slot of the builder can use. */
export interface Columns {
  dates: ColumnProfile[];
  times: ColumnProfile[];
  categories: ColumnProfile[];
  splits: ColumnProfile[];
  numbers: ColumnProfile[];
  states: ColumnProfile[];
}

export function columnsOf(ctx: ContextResult): Columns {
  const cols = ctx.profile.columns;
  // Categories: text, yes/no and low-cardinality numbers. Words come first, then numbers that
  // can name a group (a rating, a quantity), and amounts and ratios last: a fee of 0 or 49 can
  // still be chosen, but it is never the first pick. Within each, mapped dimensions first, then
  // by fewest values.
  const mapped = new Set(Object.values(ctx.mapping.fields));
  const rank = (c: ColumnProfile) =>
    c.storage !== "number"
      ? 0
      : c.role === "currency" || c.role === "rate" || c.role === "percentage"
        ? 2
        : 1;
  const categories = cols
    .filter(
      (c) =>
        c.storage !== "date" &&
        c.distinct >= 2 &&
        (c.storage !== "number" || c.distinct <= 30) &&
        c.role !== "text",
    )
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        Number(mapped.has(b.name)) - Number(mapped.has(a.name)) ||
        Number(a.role === "identifier") - Number(b.role === "identifier") ||
        a.distinct - b.distinct,
    );
  return {
    dates: cols.filter((c) => c.storage === "date" && c.role !== "time"),
    times: cols.filter((c) => c.role === "time"),
    categories,
    splits: categories.filter((c) => c.distinct <= 50 && c.role !== "identifier"),
    numbers: cols.filter((c) => c.storage === "number"),
    states: cols.filter(
      (c) => c.role === "geo" && c.geoLevel === "state" && (c.geoRegion === "IN" || c.geoRegion === "US"),
    ),
  };
}

/** The category a chart starts on: the template's first dimension, else the first category. */
export function firstCategory(ctx: ContextResult, cols: Columns): ColumnProfile | undefined {
  return cols.categories.find((c) => ctx.dimensions.some((d) => d.column === c.name)) ?? cols.categories[0];
}

/**
 * A second category to split by, other than `except` (the axis's own
 * column): one with a handful of words (3–8 values) reads best, then any
 * word column, then whatever is left. Null when there is none.
 */
export function splitFor(cols: Columns, except: string | null): string | null {
  const others = cols.splits.filter((c) => c.name !== except);
  return (
    (
      others.find((c) => c.storage !== "number" && c.distinct >= 3 && c.distinct <= 8) ??
      others.find((c) => c.storage !== "number") ??
      others[0]
    )?.name ?? null
  );
}

/** Why the file can't feed a chart type, or null when it can. */
export function missing(t: ChartTypeInfo, cols: Columns): string | null {
  if (t.kind === "geoTile") return cols.states.length ? null : "Needs a column of Indian or US states";
  if (t.axis === "time" && !cols.dates.length) return "Needs a date column";
  if (t.axis === "category" && !cols.categories.length) return "Needs a category column";
  if (t.axis === "timeOrCategory" && !cols.dates.length && !cols.categories.length)
    return "Needs a date or category column";
  if (t.axis === "bins" && !cols.numbers.length) return "Needs a numeric column";
  if (t.split === "required") {
    const pool = new Set([...cols.categories, ...cols.splits].map((c) => c.name));
    if (t.axis === "category" ? pool.size < 2 : !cols.splits.length) return "Needs two category columns";
  }
  return null;
}

/**
 * Kinds drawn with several series: without a second category they need this
 * many measures in one unit (isKindCompatible); with one, a single measure.
 */
export const MULTI_SERIES: Partial<Record<ChartKind, number>> = {
  stackedArea: 2,
  groupedBar: 2,
  stackedBar: 2,
  stackedBar100: 2,
  dumbbell: 2,
  radar: 3,
};

/**
 * `n` measures in one unit, for a chart without a second category: the
 * first format that enough of the headline and supporting KPIs share, else
 * as many column totals of one role (all money, all counts…). Shorter than
 * `n` when the file has nothing that fits.
 */
export function sameUnitMeasures(ctx: ContextResult, cols: Columns, n: number): AskMeasure[] {
  const kpis = [...ctx.selection.hero, ...ctx.selection.supporting]
    .map((id) => ctx.kpis.find((k) => k.id === id && k.available))
    .filter((k): k is NonNullable<typeof k> => Boolean(k));
  for (const format of new Set(kpis.map((k) => k.format))) {
    const same = kpis.filter((k) => k.format === format);
    if (same.length >= n) return same.slice(0, n).map((k) => ({ kind: "kpi", id: k.id }));
  }
  for (const role of new Set(cols.numbers.map((c) => c.role))) {
    const same = cols.numbers.filter((c) => c.role === role);
    if (same.length >= n)
      return same.slice(0, n).map((c) => ({ kind: "column", column: c.name, agg: "sum" }));
  }
  return [];
}

/** Measures to start with: the headline KPIs, then the supporting ones, then column totals. */
export function startingMeasures(ctx: ContextResult, cols: Columns, n: number): AskMeasure[] {
  const ids = [...ctx.selection.hero, ...ctx.selection.supporting].filter((id) =>
    ctx.kpis.some((k) => k.id === id && k.available),
  );
  const out: AskMeasure[] = ids.slice(0, n).map((id) => ({ kind: "kpi", id }));
  for (const c of cols.numbers) {
    if (out.length >= n) break;
    out.push({ kind: "column", column: c.name, agg: "sum" });
  }
  while (out.length < n) out.push({ kind: "column", column: "", agg: "count" });
  return out;
}

/** The dashboard section a chart starts in: Trend along time, Detail for a table, else Breakdowns. */
function sectionFor(kind: ChartKind, axis: AxisChoice): ChartSection {
  return axis.type === "time" ? "trend" : kind === "table" ? "detail" : "breakdown";
}

/** The size a chart starts at: wide types full width, single figures a third, the rest half. */
function sizeFor(kind: ChartKind): { w: number; h: number } {
  const wide = kind === "table" || kind === "calendar" || kind === "sankey";
  return {
    w: wide ? 12 : kind === "bigNumber" || kind === "gauge" ? 4 : 6,
    h: kind === "bigNumber" ? 3 : 4,
  };
}

/** A first draft of a chart type, from the file's columns. */
export function newDraft(kind: ChartKind, ctx: ContextResult, cols: Columns): Draft {
  const t = chartType(kind);
  const date = cols.dates.find((c) => c.name === ctx.dateColumn) ?? cols.dates[0];
  const cat = kind === "geoTile" ? cols.states[0] : firstCategory(ctx, cols);
  let axis: AxisChoice = { type: "none" };
  if (t.axis === "time" && date)
    axis = { type: "time", column: date.name, grain: kind === "calendar" ? "day" : "auto" };
  else if (t.axis === "category" && cat) axis = { type: "column", column: cat.name };
  else if (t.axis === "timeOrCategory")
    axis = date
      ? { type: "time", column: date.name, grain: "auto" }
      : cat
        ? { type: "column", column: cat.name }
        : axis;
  else if (t.axis === "bins" && cols.numbers[0])
    axis = { type: "bins", column: cols.numbers[0].name, count: 12 };
  const splitColumn = splitFor(cols, "column" in axis ? axis.column : null);
  // A kind drawn with several series starts split by a category (one measure) when the file has
  // one, else with enough measures in one unit; any other kind splits only when it must.
  const series = MULTI_SERIES[kind];
  const sameUnit = series && !splitColumn ? sameUnitMeasures(ctx, cols, series) : [];
  const split = t.split === "required" || (series && splitColumn) ? splitColumn : null;
  const count = kind === "histogram" ? 1 : t.measures.min;
  const measures =
    kind === "histogram"
      ? [{ kind: "column", column: "", agg: "count" } as AskMeasure]
      : sameUnit.length
        ? sameUnit
        : startingMeasures(ctx, cols, count);
  return {
    kind,
    axis,
    split,
    measures,
    topN: null,
    target: "",
    title: "",
    section: sectionFor(kind, axis),
    ...sizeFor(kind),
  };
}

/** A draft that starts from an existing chart, for editing. */
export function draftFromSpec(
  spec: ChartSpec,
  widget: { w: number; h: number; title?: string } | undefined,
  ctx: ContextResult,
): Draft {
  const x = spec.x;
  const binColumn = (): string => {
    if (x.kind !== "bins") return "";
    const ref = [...fieldsOf(x.expr)][0] ?? "";
    return ref.startsWith("col:") ? ref.slice(4) : (ctx.mapping.fields[ref] ?? "");
  };
  const axis: AxisChoice =
    x.kind === "time"
      ? { type: "time", column: x.column, grain: x.grain }
      : x.kind === "part"
        ? { type: "part", column: x.column, part: x.part }
        : x.kind === "column"
          ? { type: "column", column: x.column }
          : x.kind === "bins"
            ? { type: "bins", column: binColumn(), count: x.count }
            : { type: "none" };
  const measures: AskMeasure[] = spec.measures.map((m) => {
    if (!m.id.startsWith("agg:")) return { kind: "kpi", id: m.id };
    const [, agg, ...rest] = m.id.split(":");
    return { kind: "column", agg: agg as AskAgg, column: rest.join(":") };
  });
  return {
    kind: spec.kind,
    axis,
    split: spec.series?.kind === "column" ? spec.series.column : null,
    measures,
    topN: spec.topN ?? null,
    target: spec.target !== undefined ? String(spec.target) : "",
    title: widget?.title?.trim() || spec.title,
    section: spec.section,
    w: widget?.w ?? spec.size.w,
    h: widget?.h ?? spec.size.h,
  };
}

export const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The automatic title: what is measured, and by what. */
export function autoTitle(d: Draft, measures: ChartMeasure[]): string {
  const names = measures.map((m) => m.label);
  const first = names[0] ?? "Value";
  const by =
    d.axis.type === "time"
      ? "over time"
      : d.axis.type === "part"
        ? `by ${lower(PARTS.find((p) => d.axis.type === "part" && p.id === d.axis.part)?.label ?? "part")}`
        : d.axis.type === "column"
          ? `by ${d.axis.column}`
          : "";
  switch (d.kind) {
    case "bigNumber":
    case "gauge":
      return first;
    case "funnel":
      return `Funnel: ${names.join(" → ")}`;
    case "histogram":
      return d.axis.type === "bins" ? `Distribution of ${d.axis.column}` : "Distribution";
    case "scatter":
    case "bubble":
      return `${names[0] ?? ""} vs ${lower(names[1] ?? "")}${d.axis.type === "column" ? ` by ${d.axis.column}` : ""}${d.kind === "bubble" && names[2] ? `, sized by ${lower(names[2])}` : ""}`;
    case "sankey":
      return d.axis.type === "column" && d.split ? `${first} from ${d.axis.column} to ${d.split}` : first;
    case "radar":
      return d.split ? `${first} ${by} and ${d.split}` : `Profile ${by}: ${names.join(", ")}`;
    default:
      return `${names.join(" and ")} ${by}${d.split ? ` and ${d.split}` : ""}`.trim();
  }
}

/** The spec a draft describes, or why the chosen type can't draw it. */
export function buildSpec(
  d: Draft,
  ctx: ContextResult,
  id: string,
): { spec: ChartSpec | null; problem: string | null } {
  const t = chartType(d.kind);
  const actx = ctx as unknown as AskContext;
  const measures = d.measures
    .map((m) => askMeasure(m.kind === "column" && m.agg === "count" ? { ...m, column: "" } : m, actx))
    .filter((m): m is ChartMeasure => m !== null);
  if (measures.length < d.measures.length) return { spec: null, problem: "Choose what each measure is." };
  const col = (name: string) => ctx.profile.columns.find((c) => c.name === name);
  let x: ResolvedAxis;
  switch (d.axis.type) {
    case "time":
      x = axisFor({ kind: "time", column: d.axis.column, grain: d.axis.grain });
      break;
    case "part":
      x = axisFor({ kind: "part", column: d.axis.column, part: d.axis.part });
      break;
    case "column":
      x = axisFor({ kind: "column", column: d.axis.column });
      break;
    case "bins": {
      const c = col(d.axis.column);
      x = {
        kind: "bins",
        expr: { field: `col:${d.axis.column}` },
        count: d.axis.count,
        format:
          c?.role === "currency"
            ? "currency"
            : c?.role === "percentage" && c.percentScale === 1
              ? "percent"
              : "number",
        label: d.axis.column,
      };
      break;
    }
    default:
      x = { kind: "none" };
  }
  if ("column" in d.axis && !d.axis.column) return { spec: null, problem: "Choose a column for the axis." };
  const target = Number(d.target.replace(/[,\s]/g, ""));
  const axisColumn = "column" in d.axis ? d.axis.column : null;
  const spec = customSpec({
    id,
    title: d.title.trim() || autoTitle(d, measures),
    kind: d.kind,
    x,
    series: d.split ? axisFor({ kind: "column", column: d.split }) : undefined,
    measures,
    topN: d.topN ?? undefined,
    others: d.kind === "donut" || d.kind === "pie" ? true : undefined,
    section: d.section,
    size: { w: d.w, h: d.h },
    target: d.target.trim() && Number.isFinite(target) ? target : undefined,
    geoRegion:
      d.kind === "geoTile" && axisColumn
        ? (col(axisColumn)?.geoRegion as "IN" | "US" | undefined)
        : undefined,
    analysis: d.kind === "funnel" ? "funnel" : undefined,
  });
  if (isKindCompatible(d.kind, spec)) return { spec, problem: null };
  // Say what the type needs, most specific first.
  const n = measures.length;
  const { min, max } = t.measures;
  const splitMax = d.split ? 1 : max;
  const name = t.name.toLowerCase();
  let problem = `A ${name} can't draw this combination; try another type from the gallery.`;
  const several = MULTI_SERIES[d.kind];
  if (t.split === "required" && !d.split) problem = `A ${name} needs a second category.`;
  else if (several && !d.split && n < several)
    problem = `A ${name} needs a second category to split by, or ${several} or more measures in the same unit.`;
  else if (d.split && n > 1)
    problem = "With a second category, use one measure (each category value becomes a series).";
  else if (n < min || n > splitMax)
    problem = `A ${t.name.toLowerCase()} needs ${min === splitMax ? min : `${min} to ${splitMax}`} measure${splitMax === 1 ? "" : "s"}.`;
  else if (t.sameUnit && new Set(measures.map((m) => m.format)).size > 1)
    problem =
      "These measures are in different units (money, counts, percentages). One chart shares one axis, so choose measures in the same unit, or make two charts.";
  else if ((d.kind === "donut" || d.kind === "pie") && d.split)
    problem = "A donut or pie shows one category; remove the second category.";
  return { spec: null, problem };
}

/**
 * Switching type keeps what still fits (the axis, the split, the measures up
 * to the new type's limits). The size and section follow the new type, unless
 * the user changed them from what the old type started with (or the chart
 * already had them on the dashboard): then they stay.
 */
export function adapt(d: Draft, kind: ChartKind, ctx: ContextResult, cols: Columns): Draft {
  const t = chartType(kind);
  const fresh = newDraft(kind, ctx, cols);
  const axisFits =
    (t.axis === "time" && (d.axis.type === "time" || d.axis.type === "part")) ||
    (t.axis === "category" && d.axis.type === "column") ||
    (t.axis === "timeOrCategory" && d.axis.type !== "bins" && d.axis.type !== "none") ||
    (t.axis === "bins" && d.axis.type === "bins") ||
    (t.axis === "none" && d.axis.type === "none");
  const axis = kind === "geoTile" || kind === "calendar" ? fresh.axis : axisFits ? d.axis : fresh.axis;
  // Keep the split unless it is now the axis's own column; a type that starts split gets one that isn't.
  const axisColumn = "column" in axis ? axis.column : null;
  const kept = d.split && d.split !== axisColumn ? d.split : null;
  const split = t.split === "none" ? null : (kept ?? (fresh.split ? splitFor(cols, axisColumn) : null));
  const max = split ? 1 : t.measures.max;
  let measures = d.measures.slice(0, max);
  if (measures.length < t.measures.min) measures = [...measures, ...fresh.measures.slice(measures.length)];
  const sized = d.w !== sizeFor(d.kind).w || d.h !== sizeFor(d.kind).h;
  const placed = d.section !== sectionFor(d.kind, d.axis);
  return {
    ...d,
    kind,
    axis,
    split,
    measures,
    section: placed ? d.section : sectionFor(kind, axis),
    ...(sized ? { w: d.w, h: d.h } : sizeFor(kind)),
  };
}
