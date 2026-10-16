/**
 * The chart catalogue: every chart kind Loupe draws, grouped by the question
 * it answers (after the FT Visual Vocabulary and the Data Visualisation
 * Catalogue), each with two short lines (what it shows, and the data it
 * suits best) and what it needs from the data: the kind of axis, whether a
 * second category splits the measure, and how many measures.
 *
 * The Customise step's chart gallery and builder are built from this list.
 * Whether a finished spec can be drawn is still decided by isKindCompatible
 * (recommend.ts); tests/chart-catalogue.test.ts keeps the two in step.
 */
import type { ChartKind } from "./types";

export type ChartGroup =
  | "time"
  | "compare"
  | "ranking"
  | "part"
  | "distribution"
  | "relationship"
  | "flow"
  | "geo"
  | "single"
  | "detail";

/** Gallery sections, in order, each with the question its charts answer. */
export const CHART_GROUPS: Array<{ id: ChartGroup; title: string; question: string }> = [
  { id: "time", title: "Change over time", question: "How does it move from period to period?" },
  { id: "compare", title: "Compare categories", question: "Which is bigger, and by how much?" },
  { id: "ranking", title: "Ranking", question: "Which few items make up most of it?" },
  { id: "part", title: "Part of a whole", question: "What is the total made of?" },
  { id: "distribution", title: "Distribution", question: "How are the values spread?" },
  { id: "relationship", title: "Relationships", question: "Do two things move together?" },
  { id: "flow", title: "Flow and process", question: "Where does it go next?" },
  { id: "geo", title: "Geography", question: "Where is it highest?" },
  { id: "single", title: "Single number", question: "What is the one figure to watch?" },
  { id: "detail", title: "Detail", question: "What are the exact figures?" },
];

/** What a chart's x axis is: dates, categories, numeric bands, or nothing (one value, or funnel stages). */
export type AxisNeed = "time" | "category" | "timeOrCategory" | "bins" | "none";

export interface ChartTypeInfo {
  kind: ChartKind;
  name: string;
  group: ChartGroup;
  /** First line: what the chart shows. */
  shows: string;
  /** Second line: the data it is best for. */
  bestFor: string;
  axis: AxisNeed;
  /** A second category the measure is split by: series, stack segments, flow targets or outer rings. */
  split: "none" | "optional" | "required";
  measures: { min: number; max: number };
  /** Several measures share one value axis, so they must share a unit (never two axes). */
  sameUnit?: boolean;
  /** False for analysis charts (cohorts, waterfalls…) that come with the dashboard but aren't built from columns. */
  buildable: boolean;
  /** Extra settings the builder offers. */
  options?: Array<"topN" | "target" | "datePart">;
}

export const CHART_TYPES: ChartTypeInfo[] = [
  // ---------------- change over time
  {
    kind: "line",
    name: "Line",
    group: "time",
    shows: "A measure rising and falling over time.",
    bestFor: "Trends over many periods, or up to 8 series split by a category.",
    axis: "time",
    split: "optional",
    measures: { min: 1, max: 4 },
    sameUnit: true,
    buildable: true,
    options: ["datePart"],
  },
  {
    kind: "area",
    name: "Area",
    group: "time",
    shows: "A line with the space below it filled, so the volume stands out.",
    bestFor: "One measure over time where the size of the total matters.",
    axis: "time",
    split: "none",
    measures: { min: 1, max: 1 },
    buildable: true,
    options: ["datePart"],
  },
  {
    kind: "stackedArea",
    name: "Stacked area",
    group: "time",
    shows: "Layers over time that add up to the total.",
    bestFor: "How 2–6 parts build a total over time; single parts are harder to compare.",
    axis: "time",
    split: "optional",
    measures: { min: 1, max: 4 },
    sameUnit: true,
    buildable: true,
  },
  {
    kind: "step",
    name: "Step line",
    group: "time",
    shows: "Holds each value flat until it changes, then steps.",
    bestFor: "Values that jump at moments: prices, stock levels, headcount.",
    axis: "time",
    split: "optional",
    measures: { min: 1, max: 4 },
    sameUnit: true,
    buildable: true,
  },
  {
    kind: "calendar",
    name: "Calendar heatmap",
    group: "time",
    shows: "One square per day, shaded by its value.",
    bestFor: "Daily data, to spot weekday and seasonal patterns at a glance.",
    axis: "time",
    split: "none",
    measures: { min: 1, max: 1 },
    buildable: true,
  },
  {
    kind: "bump",
    name: "Bump chart",
    group: "time",
    shows: "Each item's rank in every period, as lines that cross.",
    bestFor: "How the top 5–10 items swap places over time.",
    axis: "time",
    split: "required",
    measures: { min: 1, max: 1 },
    buildable: false,
  },
  // ---------------- compare categories
  {
    kind: "bar",
    name: "Column",
    group: "compare",
    shows: "Vertical bars comparing a measure across categories or periods.",
    bestFor: "A handful of categories, or periods; bars always start at zero.",
    axis: "timeOrCategory",
    split: "none",
    measures: { min: 1, max: 4 },
    sameUnit: true,
    buildable: true,
    options: ["topN", "datePart"],
  },
  {
    kind: "hbar",
    name: "Bar",
    group: "compare",
    shows: "Horizontal bars, longest first.",
    bestFor: "Many categories or long names, and simple rankings.",
    axis: "category",
    split: "none",
    measures: { min: 1, max: 2 },
    sameUnit: true,
    buildable: true,
    options: ["topN"],
  },
  {
    kind: "groupedBar",
    name: "Grouped column",
    group: "compare",
    shows: "Bars side by side within each category.",
    bestFor: "Comparing 2–4 series, such as channels or measures, category by category.",
    axis: "timeOrCategory",
    split: "optional",
    measures: { min: 1, max: 4 },
    sameUnit: true,
    buildable: true,
    options: ["topN", "datePart"],
  },
  {
    kind: "lollipop",
    name: "Lollipop",
    group: "compare",
    shows: "A dot on a thin stem: a lighter bar chart.",
    bestFor: "Ranking many categories where the exact value matters most.",
    axis: "category",
    split: "none",
    measures: { min: 1, max: 1 },
    buildable: true,
    options: ["topN"],
  },
  {
    kind: "dumbbell",
    name: "Dumbbell",
    group: "compare",
    shows: "Two dots joined by a line for each category.",
    bestFor: "The gap between two values: two segments, plan vs actual, before vs after.",
    axis: "category",
    split: "optional",
    measures: { min: 1, max: 2 },
    sameUnit: true,
    buildable: true,
    options: ["topN"],
  },
  {
    kind: "radar",
    name: "Radar",
    group: "compare",
    shows: "Spokes around a centre, one per measure, each on its own scale.",
    bestFor: "Comparing the profile of 2–5 items across 3–8 measures.",
    axis: "category",
    split: "optional",
    measures: { min: 1, max: 8 },
    buildable: true,
  },
  {
    kind: "bullet",
    name: "Bullet",
    group: "compare",
    shows: "A bar measured against a target band.",
    bestFor: "Progress against goals in very little space.",
    axis: "category",
    split: "none",
    measures: { min: 1, max: 1 },
    buildable: false,
  },
  // ---------------- ranking
  {
    kind: "pareto",
    name: "Pareto",
    group: "ranking",
    shows: "Sorted bars with a running share of the total.",
    bestFor: "Finding the few items that make up most of the total (the 80/20 rule).",
    axis: "category",
    split: "none",
    measures: { min: 1, max: 1 },
    buildable: true,
  },
  // ---------------- part of a whole
  {
    kind: "donut",
    name: "Donut",
    group: "part",
    shows: "Slices of a ring, with the total in the middle.",
    bestFor: "2–6 parts of one total, such as payment methods.",
    axis: "category",
    split: "none",
    measures: { min: 1, max: 1 },
    buildable: true,
  },
  {
    kind: "pie",
    name: "Pie",
    group: "part",
    shows: "Slices of a circle, each sized by its share.",
    bestFor: "2–5 parts whose sizes are clearly different.",
    axis: "category",
    split: "none",
    measures: { min: 1, max: 1 },
    buildable: true,
  },
  {
    kind: "stackedBar",
    name: "Stacked column",
    group: "part",
    shows: "Each column split into the parts that make it up.",
    bestFor: "Totals and their make-up across a few categories or periods.",
    axis: "timeOrCategory",
    split: "optional",
    measures: { min: 1, max: 4 },
    sameUnit: true,
    buildable: true,
    options: ["datePart"],
  },
  {
    kind: "stackedBar100",
    name: "100% stacked column",
    group: "part",
    shows: "Every column the same height, split by share.",
    bestFor: "Comparing the mix (percentages) across categories or periods.",
    axis: "timeOrCategory",
    split: "optional",
    measures: { min: 1, max: 4 },
    sameUnit: true,
    buildable: true,
    options: ["datePart"],
  },
  {
    kind: "treemap",
    name: "Treemap",
    group: "part",
    shows: "Nested rectangles, each sized by its value.",
    bestFor: "Many parts, or a two-level breakdown like category and sub-category.",
    axis: "category",
    split: "optional",
    measures: { min: 1, max: 1 },
    buildable: true,
  },
  {
    kind: "sunburst",
    name: "Sunburst",
    group: "part",
    shows: "Rings from the centre outwards, one ring per level.",
    bestFor: "Two-level breakdowns where both levels matter.",
    axis: "category",
    split: "optional",
    measures: { min: 1, max: 1 },
    buildable: true,
  },
  {
    kind: "waterfall",
    name: "Waterfall",
    group: "part",
    shows: "How a starting value is built up or worn down, step by step.",
    bestFor: "Explaining what adds to or takes away from a total.",
    axis: "category",
    split: "none",
    measures: { min: 1, max: 1 },
    buildable: false,
  },
  // ---------------- distribution
  {
    kind: "histogram",
    name: "Histogram",
    group: "distribution",
    shows: "How many rows fall in each band of values.",
    bestFor: "The shape and spread of one numeric column, such as order value.",
    axis: "bins",
    split: "none",
    measures: { min: 1, max: 1 },
    buildable: true,
  },
  {
    kind: "box",
    name: "Box plot",
    group: "distribution",
    shows: "Median, quartiles and outliers for each group.",
    bestFor: "Comparing how spread out a measure is across groups.",
    axis: "category",
    split: "none",
    measures: { min: 1, max: 1 },
    buildable: false,
  },
  // ---------------- relationships
  {
    kind: "scatter",
    name: "Scatter",
    group: "relationship",
    shows: "One dot per item, placed by two measures.",
    bestFor: "Whether two measures move together, and which items stand out.",
    axis: "category",
    split: "none",
    measures: { min: 2, max: 2 },
    buildable: true,
  },
  {
    kind: "bubble",
    name: "Bubble",
    group: "relationship",
    shows: "A scatter whose dot size shows a third measure.",
    bestFor: "Comparing items on three measures at once.",
    axis: "category",
    split: "none",
    measures: { min: 3, max: 3 },
    buildable: true,
  },
  {
    kind: "heatmap",
    name: "Heatmap",
    group: "relationship",
    shows: "A grid of two categories, each cell shaded by its value.",
    bestFor: "Patterns between two dimensions, such as weekday by region.",
    axis: "timeOrCategory",
    split: "required",
    measures: { min: 1, max: 1 },
    buildable: true,
    options: ["datePart"],
  },
  // ---------------- flow and process
  {
    kind: "funnel",
    name: "Funnel",
    group: "flow",
    shows: "How much is left at each stage of a process, one measure per stage.",
    bestFor: "Conversion steps where each stage is a subset of the one before.",
    axis: "none",
    split: "none",
    measures: { min: 2, max: 6 },
    sameUnit: true,
    buildable: true,
  },
  {
    kind: "sankey",
    name: "Sankey",
    group: "flow",
    shows: "Bands whose width shows how much flows from one group to another.",
    bestFor: "How one breakdown splits into another, like channel into payment method.",
    axis: "category",
    split: "required",
    measures: { min: 1, max: 1 },
    buildable: true,
  },
  {
    kind: "cohort",
    name: "Cohort grid",
    group: "flow",
    shows: "The share of each starting group still active, month by month.",
    bestFor: "Retention of customers by the month they first ordered.",
    axis: "time",
    split: "none",
    measures: { min: 1, max: 1 },
    buildable: false,
  },
  // ---------------- geography
  {
    kind: "geoTile",
    name: "Tile map",
    group: "geo",
    shows: "One tile per state, shaded by its value.",
    bestFor: "Comparing Indian or US states without big states dominating.",
    axis: "category",
    split: "none",
    measures: { min: 1, max: 1 },
    buildable: true,
  },
  // ---------------- single number
  {
    kind: "bigNumber",
    name: "Big number",
    group: "single",
    shows: "One figure, large, with an optional goal.",
    bestFor: "The headline result a reader should see first.",
    axis: "none",
    split: "none",
    measures: { min: 1, max: 1 },
    buildable: true,
    options: ["target"],
  },
  {
    kind: "gauge",
    name: "Gauge",
    group: "single",
    shows: "A dial showing one value against its full scale or a goal.",
    bestFor: "A single rate or progress figure, such as a utilisation rate.",
    axis: "none",
    split: "none",
    measures: { min: 1, max: 1 },
    buildable: true,
    options: ["target"],
  },
  // ---------------- detail
  {
    kind: "table",
    name: "Table",
    group: "detail",
    shows: "Exact figures in rows and columns.",
    bestFor: "Looking up precise values rather than seeing a pattern.",
    axis: "timeOrCategory",
    split: "none",
    measures: { min: 1, max: 6 },
    buildable: true,
    options: ["topN", "datePart"],
  },
];

const BY_KIND = new Map(CHART_TYPES.map((t) => [t.kind, t]));

/** The catalogue entry of a kind. Every ChartKind has one (tests/chart-catalogue.test.ts). */
export function chartType(kind: ChartKind): ChartTypeInfo {
  return BY_KIND.get(kind) as ChartTypeInfo;
}
