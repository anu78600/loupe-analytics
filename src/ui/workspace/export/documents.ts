/**
 * The SQL and insights PDFs of the Export step (2 and 3 after the dashboard
 * report), written as real text with TextPdf so queries can be copied.
 *
 * SQL queries: every business question answered in step 5 (the question,
 * how it was read, the rows used, the headline answer, the answer table and
 * its SQL), then every KPI shown on the dashboard in SQL and in DAX. The code
 * is coloured like the app's, with a key at the top.
 * Insights: the period and filters, the headline KPIs with their change
 * (percentage points for rates), then every insight in rank order with its
 * basis and, when it points at a chart, that chart drawn in the light theme
 * as a numbered figure with the chart's notes (an incomplete last month).
 * Each chart is drawn once; a later insight about it points back to the
 * figure. An insight is kept on one page with its chart.
 *
 * Nothing here computes a number: values come from the engine's answers,
 * KPI batch and chart data, formatted with the user's number format.
 */
import { formatDelta, formatPointDelta, formatValue, type FormatOptions } from "@/engine/core/format";
import type { ChartData, ChartKind, ChartSpec } from "@/engine/charts/types";
import { INSIGHT_KIND_LABEL, type Insight } from "@/engine/insights/insights";
import type { KpiValue } from "@/engine/kpi/compute";
import type { KpiMeta, QuestionAnswer } from "@/engine/session";
import { loadECharts } from "@/ui/charts/EChart";
import { buildOption, rendersWithECharts } from "@/ui/charts/options";
import { readChartTokens } from "@/ui/charts/tokens";
import { stepNumber } from "@/store/workspace";
import { TextPdf } from "./textPdf";

export interface DocMeta {
  /** Industry name, e.g. "E-commerce". */
  title: string;
  /** "Data shape · file name". */
  subtitle: string;
  fileName: string;
  isDemo: boolean;
  fmt: FormatOptions;
}

export interface SqlPdfInput extends DocMeta {
  /** Table name the SQL reads, as in the SQL export. */
  table: string;
  questions: QuestionAnswer[];
  /** KPIs on the dashboard, in display order, with their SQL. */
  kpis: KpiMeta[];
  /** Describes a filter for the "Rows used" line. */
  describe: (f: QuestionAnswer["filters"][number]) => string;
}

export interface InsightsPdfInput extends DocMeta {
  period: string;
  filters: string;
  rows: number;
  hero: Array<{ meta: KpiMeta; value?: KpiValue }>;
  insights: Insight[];
  /** Computed charts by spec id, for insights that point at one. */
  charts: Map<string, { spec: ChartSpec; data: ChartData; kind: ChartKind }>;
}

// The app's own wording for each kind of insight.
const KIND_LABEL = INSIGHT_KIND_LABEL;

/** Up to this many answer rows are printed per question. */
const MAX_ROWS = 15;

/** Width and height (px) of a chart drawn into the insights PDF. */
const FIGURE_W = 860;
const FIGURE_H = 360;

/** The SQL queries PDF: business questions with their answers and SQL, then each KPI's SQL. */
export async function exportSqlPdf(input: SqlPdfInput, fileName: string): Promise<void> {
  const doc = await TextPdf.create({
    title: "SQL queries",
    subtitle: input.subtitle,
    fileName: input.fileName,
    isDemo: input.isDemo,
  });
  doc.heading("SQL queries", 1);
  doc.paragraph(`${input.title} · ${input.subtitle}`, { tone: "muted", after: 3 });
  const withSql = input.kpis.filter((k) => k.sql);
  doc.facts([
    ["File", input.fileName],
    ["Table", `"${input.table}", as created by the SQL export (Export › SQL file)`],
    [
      "Runs on",
      "DuckDB and PostgreSQL as written; the SQL file lists the changes for MySQL, SQL Server and BigQuery.",
    ],
    [
      "Contents",
      `${input.questions.length} business question${input.questions.length === 1 ? "" : "s"} and ${withSql.length} KPI definition${withSql.length === 1 ? "" : "s"}`,
    ],
  ]);
  doc.paragraph(
    "Each answer below was computed by Loupe from your data, and the query under it returns the same values: the same definitions (a KPI's own, or a column's total or average) over the same rows. You can check any of them in the app (Questions & SQL › Check this SQL on your data).",
    { tone: "muted", size: 9 },
  );
  doc.codeLegend();

  doc.heading("1. Your business questions");
  if (!input.questions.length)
    doc.paragraph(
      `No questions were asked yet. Ask them in step ${stepNumber("questions")}, Questions & SQL: every answered question is added to this document with its query.`,
      { tone: "muted" },
    );
  // Oldest first, as they were asked.
  [...input.questions].reverse().forEach((q, i) => {
    if (i) doc.divider();
    doc.heading(`Q${i + 1}. ${q.question}`, 3);
    doc.facts([
      ["Read as", q.understood],
      ["Rows used", q.filters.length ? q.filters.map(input.describe).join("; ") : "every row of the file"],
    ]);
    for (const n of q.notes) doc.paragraph(n, { tone: "subtle", size: 8.5, after: 1 });
    if (q.error) {
      doc.paragraph(q.error, { tone: "warning" });
      return;
    }
    if (q.headline) doc.callout(q.headline);
    const headers = [...(q.keyLabel !== null ? [q.keyLabel] : []), ...q.measures.map((m) => m.label)];
    const rows = q.rows
      .slice(0, MAX_ROWS)
      .map((r) => [
        ...(q.keyLabel !== null ? [r.label] : []),
        ...r.values.map((v, j) => formatValue(v, q.measures[j]?.format ?? "number", input.fmt)),
      ]);
    doc.table(
      headers,
      rows,
      headers.map((_, j) => (q.keyLabel !== null ? j > 0 : true)),
    );
    const more = q.more + Math.max(0, q.rows.length - MAX_ROWS);
    if (more)
      doc.paragraph(`${more} more ${more === 1 ? "group" : "groups"} not printed.`, {
        tone: "subtle",
        size: 8.5,
      });
    if (q.sql) doc.code(q.sql, "SQL");
    for (const s of q.skipped)
      doc.paragraph(`No SQL for ${s.label}: ${s.reason}`, { tone: "subtle", size: 8.5 });
  });

  doc.heading("2. KPI definitions in SQL and DAX");
  doc.paragraph(
    "The KPIs on your dashboard: each as one SQL query over the whole file, and as a Power BI measure.",
    {
      tone: "muted",
      size: 9,
    },
  );
  withSql.forEach((k, i) => {
    if (i) doc.divider();
    doc.heading(k.name, 3);
    doc.paragraph(k.definition, { tone: "muted", size: 9, after: 1 });
    doc.paragraph(`Formula: ${k.formula}${k.caveat ? `. ${k.caveat}` : ""}`, { tone: "subtle", size: 8.5 });
    doc.code(k.sql as string, "SQL");
    if (k.dax) doc.code(`${k.daxName} =\n${k.dax}`, "DAX measure", "dax");
  });
  doc.finish(fileName);
}

/** Renders one chart off-screen in the light theme and returns it as a PNG, or null when it isn't drawn with ECharts. */
async function chartPng(
  chart: { spec: ChartSpec; data: ChartData; kind: ChartKind },
  fmt: FormatOptions,
  width = 860,
  height = 360,
): Promise<string | null> {
  if (chart.data.empty || !rendersWithECharts(chart.kind, chart.data)) return null;
  const echarts = await loadECharts();
  const host = document.createElement("div");
  host.dataset.theme = "light";
  Object.assign(host.style, {
    position: "fixed",
    left: "-30000px",
    top: "0",
    width: `${width}px`,
    height: `${height}px`,
  });
  document.body.appendChild(host);
  try {
    const option = buildOption({
      tokens: readChartTokens(host),
      fmt,
      kind: chart.kind,
      spec: chart.spec,
      data: chart.data,
      animate: false,
      forExport: true,
      width,
    });
    if (!option) return null;
    const inst = echarts.default.init(host, undefined, {
      renderer: "canvas",
      devicePixelRatio: 2,
      width,
      height,
    });
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 3000);
      inst.on("finished", () => {
        clearTimeout(t);
        resolve();
      });
      inst.setOption(option);
    });
    const background = getComputedStyle(host).getPropertyValue("--surface-1").trim() || "#ffffff";
    const url = inst.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: background });
    inst.dispose();
    return url;
  } finally {
    host.remove();
  }
}

/** The insights PDF: period and filters, headline KPIs, then every insight with its basis and chart. */
export async function exportInsightsPdf(
  input: InsightsPdfInput,
  fileName: string,
  onProgress?: (s: string) => void,
): Promise<void> {
  const doc = await TextPdf.create({
    title: "Insights",
    subtitle: input.subtitle,
    fileName: input.fileName,
    isDemo: input.isDemo,
  });
  doc.heading("Insights", 1);
  doc.paragraph(`${input.title} · ${input.subtitle}`, { tone: "muted", after: 3 });
  doc.facts([
    ["Period", input.period],
    ["Filters", input.filters],
    ["Rows analysed", input.rows.toLocaleString("en-US")],
    [
      "Found",
      `${input.insights.length} insight${input.insights.length === 1 ? "" : "s"}, most important first`,
    ],
  ]);

  if (input.hero.length) {
    doc.heading("Headline KPIs");
    doc.table(
      ["KPI", "Value", "Change", "Compared with"],
      input.hero.map(({ meta, value }) => [
        meta.name,
        formatValue(value?.value ?? null, meta.format, input.fmt),
        // A rate moves in percentage points (40% → 42% is +2.0 pp), as on the dashboard's cards.
        meta.format === "percent"
          ? formatPointDelta(value?.deltaAbs, input.fmt.locale)
          : formatDelta(value?.delta, input.fmt.locale),
        value?.comparisonLabel ?? "—",
      ]),
      [false, true, true, false],
      [0.3, 0.18, 0.12, 0.4],
    );
  }

  doc.heading("What the data says");
  if (!input.insights.length)
    doc.paragraph("No insights stood out for this selection. Try a longer period or fewer filters.", {
      tone: "muted",
    });
  // Figure numbers by chart id: each chart is drawn once, and a later insight points back to it.
  const figures = new Map<string, number>();
  // The first insight to give each basis; a later one with the same method points back to it.
  const bases = new Map<string, number>();
  for (const [i, ins] of input.insights.entries()) {
    onProgress?.(`Writing insight ${i + 1} of ${input.insights.length}…`);
    const linked = ins.chartId ? input.charts.get(ins.chartId) : undefined;
    // A one-day spike or dip can't be seen on a weekly or monthly chart, so it gets no chart rather than the wrong one.
    const chart = linked && !(ins.kind === "anomaly" && linked.data.grain !== "day") ? linked : undefined;
    const earlier = chart && ins.chartId ? figures.get(ins.chartId) : undefined;
    const png = chart && earlier === undefined ? await chartPng(chart, input.fmt, FIGURE_W, FIGURE_H) : null;
    const number = figures.size + 1;
    const caption = chart ? `Figure ${number}. ${chart.spec.title}` : "";
    const title = `${i + 1}. ${ins.title}`;
    const kind = `${KIND_LABEL[ins.kind]} · ${ins.confidence} confidence`;
    const firstWith = bases.get(ins.basis);
    if (firstWith === undefined) bases.set(ins.basis, i + 1);
    const basis = firstWith === undefined ? `Basis: ${ins.basis}` : `Basis: as for insight ${firstWith}.`;
    const see = chart && earlier !== undefined ? `Chart: Figure ${earlier} above (${chart.spec.title}).` : "";
    const notes = png && chart ? chart.data.notes.map((n) => `Note: ${n}`) : [];
    const height =
      doc.measureHeading(title, 3) +
      doc.measureParagraph(kind, { size: 8, after: 1 }) +
      doc.measureParagraph(ins.body, { after: 1.5 }) +
      doc.measureParagraph(basis, { size: 8.5 }) +
      (see ? doc.measureParagraph(see, { size: 8.5 }) : 0) +
      (png ? doc.measureFigure(caption, FIGURE_W / FIGURE_H) : 0) +
      notes.reduce((h, n) => h + doc.measureParagraph(n, { size: 8, after: 1 }), 0);
    // The rule between insights is left out at the top of a new page.
    if (!doc.keep(height + (i ? 4 : 0)) && i) doc.divider();
    doc.heading(title, 3);
    doc.paragraph(kind, { tone: "subtle", size: 8, after: 1 });
    doc.paragraph(ins.body, { after: 1.5 });
    doc.paragraph(basis, { tone: "muted", size: 8.5 });
    if (see) doc.paragraph(see, { tone: "subtle", size: 8.5 });
    if (png && chart && ins.chartId) {
      figures.set(ins.chartId, number);
      doc.figure(caption, png, FIGURE_W / FIGURE_H);
      for (const n of notes) doc.paragraph(n, { tone: "subtle", size: 8, after: 1 });
    }
  }
  doc.space(2);
  doc.paragraph(
    "Every number here is computed from your data by Loupe; nothing is estimated. Insights are ranked by how much they matter: the size of the effect, how reliable it is and how important the KPI is.",
    { tone: "subtle", size: 8.5 },
  );
  doc.finish(fileName);
}
