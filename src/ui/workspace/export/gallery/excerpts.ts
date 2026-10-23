/**
 * What the Export gallery's previews show, read from the real files and the
 * charts' own numbers (version 50.4): the Power BI model's table and measures
 * from measures.dax, a few lines of kpis.sql with their line numbers, the KPI
 * views it counts, the package's files as one list, and the shape of a chart
 * for its miniature on a slide or a report page. Nothing here is made up or
 * estimated: each function reads what the engine wrote or computed, so a
 * preview is the file in miniature, never a picture of what such a file
 * usually holds.
 *
 * Pure functions, tested in tests/export-gallery.test.ts against the
 * e-commerce demo's own exports.
 */
import type { ChartData, ChartKind } from "@/engine/charts/types";
import type { PackageManifest } from "@/engine/export/powerbi";

/**
 * The model's calendar table and its first columns, as daxFile.ts names them
 * (DATE_TABLE, dateTableDax). Written out here rather than imported, so the
 * page doesn't load the DAX compiler; tests/export-gallery.test.ts holds them
 * to the generator's own names.
 */
export const DATE_TABLE = "Date";
export const DATE_TABLE_COLUMNS = ["Date", "Year", "Quarter", "Month"] as const;

/** The Power BI model in outline: its data table and its measures, as measures.dax names them. */
export interface ModelOutline {
  /** The data table's name in the model ("Orders"). */
  table: string;
  /** Every measure, in the file's order (grouped by topic, as the model's display folders). */
  measures: string[];
}

/**
 * The model's table and measures from measures.dax, whose DEFINE block adds
 * every measure as `MEASURE 'Table'[Name] = …` (daxTableName and
 * daxMeasureName quote them, doubling a quote or a bracket inside a name).
 * The TMDL model is built from the same list (buildMeasures), so these are
 * the names Power BI shows. Null when the file defines no measure.
 */
export function modelOutline(dax: string): ModelOutline | null {
  const measures: string[] = [];
  let table: string | null = null;
  for (const m of dax.matchAll(/^\s*MEASURE\s+'((?:[^']|'')+)'\[((?:[^\]]|\]\])+)\]/gm)) {
    table ??= (m[1] as string).replace(/''/g, "'");
    measures.push((m[2] as string).replace(/\]\]/g, "]"));
  }
  return table ? { table, measures } : null;
}

/** A run of lines from a file, with the number of its first line (1-based), for a code preview. */
export interface Excerpt {
  start: number;
  lines: string[];
}

/**
 * The first KPI view of kpis.sql as the file has it: the KPI's rule line
 * ("-- ── Net revenue ──── ₹5,36,54,021 ──"), its notes and the start of its
 * CREATE VIEW, `count` lines in all, numbered as in the file. A file with no
 * KPI view (every KPI unavailable) shows its table instead; one with neither,
 * its first lines.
 */
export function sqlExcerpt(sql: string, count = 12): Excerpt {
  const lines = sql.split("\n");
  const view = lines.findIndex((l) => /^CREATE VIEW "kpi_/.test(l));
  let from =
    view >= 0
      ? view
      : Math.max(
          0,
          lines.findIndex((l) => /^CREATE TABLE /.test(l)),
        );
  // Back up to the KPI's rule line above its notes, if it has one within a few lines.
  for (let i = view - 1; view >= 0 && i >= Math.max(0, view - 8); i--) {
    if (/^-- ── /.test(lines[i] as string)) {
      from = i;
      break;
    }
  }
  return { start: from + 1, lines: lines.slice(from, from + count) };
}

/**
 * The KPI views in kpis.sql: one per KPI, counted apart from the helper views
 * other KPIs build on (marked "(helper)" on their title line), so the count
 * matches what Verify checks. Monthly views and analyses don't count.
 */
export function viewCounts(sql: string): { kpis: number; helpers: number } {
  const all = [...sql.matchAll(/^CREATE VIEW "(kpi_[^"]+)"/gm)].filter(
    (m) => !/_monthly(_base)?$/.test(m[1] as string),
  ).length;
  const helpers = [...sql.matchAll(/^-- ── .+ \(helper\) ─/gm)].length;
  return { kpis: all - helpers, helpers };
}

/** A chart's shape for its miniature: a line or area over time, columns, or horizontal bars. */
export interface ChartShapeOf {
  type: "line" | "area" | "columns" | "bars";
  /** One per category, in order; null where the chart has no value (a gap in a line, no bar). */
  values: Array<number | null>;
}

const TREND: ReadonlySet<ChartKind> = new Set(["line", "area", "step", "stackedArea"]);
const COLUMNS: ReadonlySet<ChartKind> = new Set(["bar", "histogram", "groupedBar", "stackedBar", "pareto"]);
const BARS: ReadonlySet<ChartKind> = new Set(["hbar", "lollipop"]);
const STACKED: ReadonlySet<ChartKind> = new Set(["stackedArea", "stackedBar"]);

/**
 * The shape of a chart from its own numbers: a trend's line or area (the
 * stacked total for a stacked chart, else the first series), a column chart's
 * columns (the first twelve), a ranked chart's bars (the first six). A column
 * chart of more than ten named categories turns horizontal, as the chart
 * itself does (slidePlan's drawsHorizontalBars, ui/charts/options.ts). Other
 * kinds (maps, donuts, grids, funnels) have no shape here: their box stays
 * plain rather than drawing them as something they are not.
 */
export function chartShape(chart: {
  kind: ChartKind;
  data: ChartData;
  spec: { x: { kind: string } };
}): ChartShapeOf | null {
  const { kind, data } = chart;
  const n = data.categories.length;
  if (!n || !data.series.length) return null;
  const at = (i: number): number | null => {
    if (!STACKED.has(kind)) return data.series[0]?.values[i] ?? null;
    const parts = data.series
      .map((s) => s.values[i])
      .filter((v): v is number => v !== null && v !== undefined);
    return parts.length ? parts.reduce((sum, v) => sum + Math.max(0, v), 0) : null;
  };
  const values = Array.from({ length: n }, (_, i) => at(i));
  if (TREND.has(kind))
    return values.filter((v) => v !== null).length > 1
      ? { type: kind === "line" || kind === "step" ? "line" : "area", values }
      : null;
  if (BARS.has(kind) || (kind === "bar" && n > 10 && chart.spec.x.kind === "column"))
    return { type: "bars", values: values.slice(0, 6) };
  if (COLUMNS.has(kind)) return { type: "columns", values: values.slice(0, 12) };
  return null;
}

/**
 * The package's files as one list to read: top-level files one by one, each
 * folder (the semantic model) as a single line with its file count and size.
 */
export function packageLines(
  manifest: PackageManifest,
): Array<{ path: string; bytes: number; files: number }> {
  const lines = new Map<string, { path: string; bytes: number; files: number }>();
  for (const f of manifest.files) {
    const slash = f.path.indexOf("/");
    const path = slash > 0 ? `${f.path.slice(0, slash)}/` : f.path;
    const line = lines.get(path) ?? { path, bytes: 0, files: 0 };
    line.bytes += f.bytes;
    line.files += 1;
    lines.set(path, line);
  }
  return [...lines.values()];
}
