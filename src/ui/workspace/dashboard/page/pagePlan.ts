/**
 * The plan of the one-page dashboard: what fits on a single landscape page,
 * where it sits, and the words around it. The page is laid out the way
 * analysts build a report page for an executive:
 *
 * - a sidebar of slicers (the period and the main filters) that shows what is
 *   selected ("All", "Apparel", "3 selected");
 * - a banner naming the subject ("E-commerce performance dashboard") and what
 *   it covers ("Revenue | Orders | Profitability | Fulfilment");
 * - six headline KPIs, each with an icon that says what kind of measure it is;
 * - five charts from the dashboard: the main trend across two thirds of the
 *   width, a share of the whole beside it, then three breakdowns, preferring
 *   the charts chosen for executives and charts about different things;
 * - the key insights.
 *
 * Plain data and functions, so the page in the app (OnePage.tsx), its
 * download and tests/one-page.test.ts read the same plan.
 */
import type { ChartData, ChartKind, ChartSpec } from "@/engine/charts/types";
import type { KpiFormat } from "@/registry/schema";

/**
 * Kinds that read at a glance in a small card. Grids read row by row (tables,
 * cohorts, heatmaps, calendars), flows, rings and single numbers stay on the
 * full dashboard.
 */
const PAGE_KINDS: ReadonlySet<ChartKind> = new Set<ChartKind>([
  "line",
  "area",
  "bar",
  "hbar",
  "stackedBar",
  "groupedBar",
  "stackedBar100",
  "stackedArea",
  "step",
  "lollipop",
  "donut",
  "pie",
  "treemap",
  "geoTile",
  "histogram",
  "pareto",
  "funnel",
  "waterfall",
  "scatter",
  "dumbbell",
]);

/** A share of the whole: the companion of the main trend, as on most executive pages. */
const PART_TO_WHOLE: ReadonlySet<ChartKind> = new Set<ChartKind>(["donut", "pie", "treemap"]);

/** Sections whose charts don't belong on a one-page summary. */
const OFF_PAGE_SECTIONS = new Set(["columns", "detail"]);

/** The page's charts at most: the trend and its companion, then three breakdowns. */
export const PAGE_CHARTS = 5;
/** The page's KPI tiles at most, as in a report page's KPI row. */
export const PAGE_KPIS = 6;

/** One dashboard widget, as far as the page needs it (the store's Widget). */
export interface PageWidget {
  id: string;
  kind?: ChartKind;
  hidden?: boolean;
  title?: string;
}

export interface PageChart {
  spec: ChartSpec;
  data: ChartData;
  kind: ChartKind;
  /** The user's own title from Customise, else the chart's. */
  title: string;
}

/** A chart in its place on the page's chart grid: six columns, two rows. */
export interface PlacedChart extends PageChart {
  span: number;
  /** Takes both rows (when there are only one or two charts). */
  tall: boolean;
}

/** What a chart is about, so the breakdowns cover different things. */
function subjectOf(spec: ChartSpec): string {
  const x = spec.x;
  switch (x.kind) {
    case "column":
      return `col:${x.column}`;
    case "time":
      return `time:${x.column}`;
    case "part":
      return `part:${x.part}`;
    case "bins":
      return `bins:${x.label}`;
    default:
      return "none";
  }
}

/** True when the chart draws as a chart (not a table) and reads at a glance. */
function fitsPage(kind: ChartKind, data: ChartData): boolean {
  if (!PAGE_KINDS.has(kind) || data.empty) return false;
  // Analyses that render as tables (frequently bought together, RFM outside its treemap).
  if (data.basket || (data.rfm && kind !== "treemap") || data.cohorts?.length) return false;
  return true;
}

/**
 * The page's charts, in dashboard order with the charts chosen for
 * executives first: the first chart over time leads; then the first share of
 * the whole; then up to three more, preferring charts about something not yet
 * shown. Hidden charts, empty ones, folded "other columns" charts and the
 * detail table are left out.
 */
export function pickPageCharts(
  widgets: readonly PageWidget[],
  specs: readonly ChartSpec[],
  charts: Readonly<Record<string, ChartData | undefined>>,
  max = PAGE_CHARTS,
): PageChart[] {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const candidates: Array<PageChart & { exec: boolean; order: number }> = [];
  widgets.forEach((w, order) => {
    const spec = byId.get(w.id);
    const data = charts[w.id];
    if (!spec || !data || w.hidden || OFF_PAGE_SECTIONS.has(spec.section)) return;
    const kind = w.kind ?? spec.kind;
    if (!fitsPage(kind, data)) return;
    candidates.push({
      spec,
      data,
      kind,
      title: w.title?.trim() || spec.title,
      exec: spec.modes.includes("executive"),
      order,
    });
  });
  // The executive choice first, each group in the user's order.
  candidates.sort((a, b) => Number(b.exec) - Number(a.exec) || a.order - b.order);

  const picked: PageChart[] = [];
  const take = (c: PageChart | undefined) => {
    if (c && !picked.includes(c)) picked.push(c);
  };
  const strip = ({ spec, data, kind, title }: PageChart & { exec: boolean; order: number }): PageChart => ({
    spec,
    data,
    kind,
    title,
  });
  const pool = candidates.map(strip);
  take(pool.find((c) => c.spec.x.kind === "time") ?? pool[0]);
  take(pool.find((c) => !picked.includes(c) && PART_TO_WHOLE.has(c.kind)));
  // Breakdowns about something new first, then any that remain.
  const seen = new Set(picked.map((c) => subjectOf(c.spec)));
  for (const c of pool) {
    if (picked.length >= max) break;
    if (picked.includes(c) || seen.has(subjectOf(c.spec))) continue;
    take(c);
    seen.add(subjectOf(c.spec));
  }
  for (const c of pool) {
    if (picked.length >= max) break;
    take(c);
  }
  return picked.slice(0, max);
}

/**
 * Places the charts on a six-column, two-row grid: the lead chart across two
 * thirds of the first row with its companion beside it, then the rest of the
 * charts shared evenly across the second row. One or two charts take both
 * rows.
 */
export function placeCharts(charts: readonly PageChart[]): PlacedChart[] {
  const n = charts.length;
  if (n === 0) return [];
  if (n === 1) return [{ ...(charts[0] as PageChart), span: 6, tall: true }];
  const rest = charts.slice(2);
  const restSpan = rest.length ? Math.floor(6 / rest.length) : 0;
  return [
    { ...(charts[0] as PageChart), span: 4, tall: n === 2 },
    { ...(charts[1] as PageChart), span: 2, tall: n === 2 },
    ...rest.map((c) => ({ ...c, span: restSpan, tall: false })),
  ];
}

/** The page's KPI tiles: the headline KPIs, topped up from the supporting ones. */
export function pageKpiIds(
  hero: readonly string[],
  supporting: readonly string[],
  max = PAGE_KPIS,
): string[] {
  return [...new Set([...hero, ...supporting])].slice(0, max);
}

/**
 * What the page covers, from its KPIs' groups in order ("Revenue | Orders |
 * Profitability | Fulfilment"); the data shape's name when the KPIs share one
 * group.
 */
export function pageSubtitle(groups: readonly string[], fallback: string): string {
  const unique = [...new Set(groups.map((g) => g.trim()).filter(Boolean))].slice(0, 4);
  return unique.length >= 2 ? unique.join(" | ") : fallback;
}

/** The page's title until the user names it: what an analyst would call the page. */
export function defaultPageTitle(industry: string, opts: { generic: boolean; roster: boolean }): string {
  if (opts.generic) return "Performance dashboard";
  return opts.roster ? `${industry} dashboard` : `${industry} performance dashboard`;
}

/** The kinds of measure a KPI tile's icon tells apart. */
export type KpiIconName =
  | "money"
  | "profit"
  | "cost"
  | "pay"
  | "orders"
  | "people"
  | "loss"
  | "returns"
  | "rating"
  | "time"
  | "units"
  | "traffic"
  | "conversion"
  | "retention"
  | "average"
  | "percent"
  | "count";

/** Name patterns, most specific first: a "Return rate" is a return before it is a rate. */
const ICON_RULES: ReadonlyArray<[RegExp, KpiIconName]> = [
  // A return on spend is a yield, not goods coming back.
  [/\b(roas|roi|return on)\b/, "profit"],
  [/\b(retention|renewals?|repeat)\b/, "retention"],
  [/\b(churn|attrition|exits?|leavers?|lost)\b/, "loss"],
  [/\b(returns?|rto|refunds?|cancel(?:led|lations?)?|reversals?)\b/, "returns"],
  [/\b(rating|score|satisfaction|nps|csat|quality|review)\b/, "rating"],
  [/\b(conversions?|ctr|click.?through|win rate|close rate|funnel)\b/, "conversion"],
  [/\b(profit|margin|ebitda|contribution)\b/, "profit"],
  [/\b(salary|salaries|payroll|wages?|compensation|pay)\b/, "pay"],
  [/\b(cost|costs|spend|expenses?|discounts?|cac|fees?|shipping)\b/, "cost"],
  [/\b(days?|time|tenure|duration|hours?|delay|lead time|age)\b/, "time"],
  [/\b(average|avg|aov|per|arpu|arpa|mean)\b/, "average"],
  [/\b(revenue|sales|gmv|income|turnover|billing|mrr|arr|bookings?|value|amount)\b/, "money"],
  [/\b(orders?|transactions?|invoices?|purchases?|deals?|tickets?)\b/, "orders"],
  [
    /\b(customers?|clients?|users?|accounts?|subscribers?|members?|patients?|students?|employees?|headcount|staff|leads?|visitors?|people)\b/,
    "people",
  ],
  [/\b(units?|quantity|qty|items?|volume|stock|inventory|products?|skus?)\b/, "units"],
  [/\b(impressions?|views?|sessions?|visits?|traffic|clicks?|reach)\b/, "traffic"],
];

/** The icon for a KPI tile, from its name and, failing that, its format. */
export function kpiIconName(meta: { name: string; group?: string; format: KpiFormat }): KpiIconName {
  const text = meta.name.toLowerCase();
  for (const [re, icon] of ICON_RULES) if (re.test(text)) return icon;
  const group = (meta.group ?? "").toLowerCase();
  for (const [re, icon] of ICON_RULES) if (re.test(group)) return icon;
  switch (meta.format) {
    case "currency":
      return "money";
    case "percent":
      return "percent";
    case "days":
      return "time";
    default:
      return "count";
  }
}

/** What a slicer shows: "All", the value, two values, or "3 selected" (as a report page's slicer does). */
export function slicerValue(values: readonly string[] | undefined): string {
  if (!values?.length) return "All";
  if (values.length <= 2) return values.join(", ");
  return `${values.length} selected`;
}

/** The calendar years the data covers, newest first, for the period slicer. */
export function yearsIn(bounds: { min: number; max: number }): number[] {
  const first = new Date(bounds.min).getUTCFullYear();
  const last = new Date(bounds.max).getUTCFullYear();
  const years: number[] = [];
  for (let y = last; y >= first; y--) years.push(y);
  return years;
}

/** A calendar year as a date range: 1 January to the last millisecond of 31 December. */
export function yearRange(year: number): { from: number; to: number } {
  return { from: Date.UTC(year, 0, 1), to: Date.UTC(year, 11, 31, 23, 59, 59, 999) };
}

/** The year a range covers exactly, if it is one calendar year (so the slicer can say "2025"). */
export function yearOf(range: { from: number; to: number } | null | undefined): number | null {
  if (!range) return null;
  const y = new Date(range.from).getUTCFullYear();
  const r = yearRange(y);
  return range.from === r.from && Math.abs(range.to - r.to) < 1000 ? y : null;
}
