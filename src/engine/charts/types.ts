/**
 * Chart contracts between the engine and the UI. A ChartSpec is a registry
 * template resolved against the mapped columns (recommend.ts), so its axes
 * name raw columns, not field ids. ChartData is what data.ts computes for a
 * spec under the current filters; series values are finite numbers or null.
 */
import type { DatePart, TimeGrain } from "@/engine/core/dates";
import type { RowExpr } from "@/engine/query/expr";
import type { ChartKind, KpiFormat } from "@/registry/schema";

export type { ChartKind };

/**
 * Most slices a donut may show, "Others" included (product rule). recommend.ts
 * narrows donut templates to it and data.ts enforces it on every computation.
 */
export const MAX_DONUT_SLICES = 6;
export type LayoutMode = "executive" | "analyst" | "compact";
/** "columns": charts of measure columns the industry template doesn't read (kpi/columnKpis). */
export type ChartSection = "trend" | "breakdown" | "drivers" | "detail" | "columns";

/** A chart axis bound to raw columns. */
export type ResolvedAxis =
  /** "auto" picks the grain from the filtered date span when the data is computed. */
  | { kind: "time"; column: string; grain: TimeGrain | "auto"; label: string }
  | { kind: "column"; column: string; label: string }
  | { kind: "part"; column: string; part: DatePart; label: string }
  /** Histogram bands over a row expression; `count` is the target number of bins. */
  | { kind: "bins"; expr: RowExpr; count: number; format: "number" | "currency" | "percent"; label: string }
  | { kind: "none" };

export interface ChartMeasure {
  /** KPI id, or an ad-hoc "agg:<agg>:<column>" id. */
  id: string;
  label: string;
  format: KpiFormat;
  direction: "higher" | "lower" | "neutral";
}

/** Inputs of the special analyses: raw column names, except `monetary`, which is a KPI id. */
export interface AnalysisParams {
  customer?: string;
  date?: string;
  order?: string;
  item?: string;
  /** Display word for the item level, "product" or "SKU". */
  itemLabel?: string;
  monetary?: string;
}

export interface ChartSpec {
  id: string;
  title: string;
  kind: ChartKind;
  section: ChartSection;
  x: ResolvedAxis;
  series?: ResolvedAxis;
  measures: ChartMeasure[];
  analysis?: "rfm" | "cohort" | "basket" | "pareto" | "funnel";
  analysisParams?: AnalysisParams;
  topN?: number;
  /** Fold the groups beyond topN into a recomputed "Others" bucket. */
  others?: boolean;
  /** Groups with fewer rows are set aside as too small to compare (folded into Others when there is one). */
  minGroupRows?: number;
  /** Hierarchy (column names) for drill-down, starting at the x column. */
  drill?: string[];
  /** "Why this chart", including any adaptation made to fit the data. */
  reason: string;
  /** Other kinds offered in the switcher (the current kind excluded). */
  alternatives: ChartKind[];
  /** Grid units on a 12-column layout. */
  size: { w: number; h: number };
  /** Lower comes first within its section. */
  priority: number;
  /** Layout modes in which the chart is shown. */
  modes: LayoutMode[];
  source: "domain" | "generic" | "custom";
  /** Set when a state-level tile map can be drawn. */
  geoRegion?: "IN" | "US";
  /**
   * A goal in the measure's own units, set in the chart builder: the full
   * scale of a gauge, and the progress line under a big number.
   */
  target?: number;
}

export interface ChartCategory {
  label: string;
  /** Raw group key (value, bucket start ms, part or bin index); null for blanks, "__others__" for Others. */
  raw: string | number | null;
  isOthers?: boolean;
  /**
   * The value's rank by row count in the whole file (0 = most rows), for
   * text and yes/no columns. Colours follow it, so a value keeps its colour
   * in every chart and under every filter.
   */
  rank?: number;
}

export interface ChartSeries {
  id: string;
  label: string;
  /** Aligned with ChartData.categories; null = blank. */
  values: Array<number | null>;
  format: KpiFormat;
}

export interface Annotation {
  /** Index into ChartData.categories. */
  index: number;
  kind: "max" | "min" | "anomaly";
  label: string;
}

export interface RfmSegment {
  segment: string;
  customers: number;
  customerShare: number;
  /** Sum of the monetary KPI over the segment's customers. */
  revenue: number;
  revenueShare: number;
  /** Mean days from each customer's last order to the latest order in the selection. */
  avgRecency: number;
  avgFrequency: number;
  avgMonetary: number;
  /** Suggested next step for the segment. */
  action: string;
}

export interface CohortRow {
  /** Month start (ms) of the customers' first-ever order. */
  cohort: number;
  label: string;
  /** Customers in the cohort. */
  size: number;
  /** Retention by months since first order; null = not yet observable. */
  retention: Array<number | null>;
}

/** Two items bought in the same order. */
export interface BasketPair {
  a: string;
  b: string;
  /** Orders containing both items. */
  orders: number;
  /** Share of all orders containing both. */
  support: number;
  /** Share of orders with `a` that also contain `b` (confidenceBA is the reverse). */
  confidenceAB: number;
  confidenceBA: number;
  /** Observed co-occurrence ÷ what independence predicts; above 1 = bought together more than chance. */
  lift: number;
}

export interface ChartData {
  specId: string;
  kind: ChartKind;
  categories: ChartCategory[];
  /**
   * Second-axis labels (heatmap rows, stacked segments, treemap children).
   * A stacked bar with more than eight series ends with an "Others" entry
   * (raw "__others__", isOthers) whose row is evaluated from its own rows.
   */
  seriesCategories?: ChartCategory[];
  series: ChartSeries[];
  /** Heatmap / two-level values: matrix[row][col]. */
  matrix?: Array<Array<number | null>>;
  /**
   * Treemap nodes. With children, a parent's value is the measure evaluated
   * over the parent's own rows, not the sum of its children (distinct counts
   * and ratios don't add up).
   */
  tree?: Array<{
    label: string;
    value: number | null;
    children?: Array<{ label: string; value: number | null }>;
  }>;
  /** Scatter points: one per category, x = first measure, y = second; a bubble's size is the third. */
  points?: Array<{ label: string; x: number | null; y: number | null; size?: number | null }>;
  /** Least-squares fit of the scatter points (needs at least three). */
  trendline?: { slope: number; intercept: number; r2: number } | null;
  /** Row count per category. */
  rows: number[];
  /** One per measure, evaluated over all grouped rows (not summed from categories). */
  totals: Array<number | null>;
  annotations: Annotation[];
  /** Grain actually used on a time axis. */
  grain?: TimeGrain;
  /** The last time bucket ends after the data or the date filter does; it is excluded from peak/low annotations. */
  partialLast?: boolean;
  /** With partialLast: the last day the data (or the date filter) covers, as wall-clock ms ("to 20 Dec"). */
  partialLastEnd?: number;
  /** The first time bucket starts before the data or the date filter does; it is excluded from peak/low annotations. */
  partialFirst?: boolean;
  /** With partialFirst: the first day the data (or the date filter) covers ("from 3 Jan"). */
  partialFirstStart?: number;
  /** Groups set aside for having fewer than minGroupRows rows: hidden, or folded into Others when there is one (a note says which). */
  suppressed?: number;
  /** Groups folded into "Others". */
  folded?: number;
  rfm?: RfmSegment[];
  cohorts?: CohortRow[];
  basket?: { pairs: BasketPair[]; level: string; orders: number; multiItemOrders: number };
  pareto?: { topShare: number; itemsForEighty: number; itemCount: number; topCount: number };
  funnel?: Array<{ label: string; value: number | null; fromPrev: number | null; fromFirst: number | null }>;
  caption: string;
  /**
   * What the chart says, in one sentence computed from this data
   * (charts/headline.ts): shown under the chart's title and leading each
   * figure in the slides and the PDF report. Absent when nothing can be said.
   */
  headline?: string;
  /**
   * The name of the category axis as drawn: the x axis's label, or the
   * drilled level's column while drilled into. The table view and the
   * chart's CSV head their first column with it. Absent for charts without
   * a category axis (a single number, the analyses with columns of their own).
   */
  axisLabel?: string;
  /** Plain-language summary for screen readers. */
  altText: string;
  /** Caveats about the data behind the chart (clipped bands, hidden groups, partial period...). */
  notes: string[];
  empty: boolean;
  totalRows: number;
}
