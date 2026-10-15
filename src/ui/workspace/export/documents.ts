/**
 * The SQL and insights PDFs of the Export step (2 and 3 after the dashboard
 * report), written as real text with TextPdf so queries can be copied.
 *
 * SQL queries: every business question answered in step 5 (the question,
 * how it was read, the rows used, the headline answer, the answer table and
 * its SQL), then the SQL definition of every KPI shown on the dashboard.
 * Insights: the period and filters, the headline KPIs with their change,
 * then every insight in rank order with its basis and, when it points at a
 * chart, that chart drawn in the light theme.
 *
 * Nothing here computes a number: values come from the engine's answers,
 * KPI batch and chart data, formatted with the user's number format.
 */
import { formatDelta, formatValue, type FormatOptions } from "@/engine/core/format";
import type { ChartData, ChartKind, ChartSpec } from "@/engine/charts/types";
import type { Insight } from "@/engine/insights/insights";
import type { KpiValue } from "@/engine/kpi/compute";
import type { KpiMeta, QuestionAnswer } from "@/engine/session";
import { loadECharts } from "@/ui/charts/EChart";
import { buildOption, rendersWithECharts } from "@/ui/charts/options";
import { readChartTokens } from "@/ui/charts/tokens";
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

const KIND_LABEL: Record<Insight["kind"], string> = {
  trend: "Trend",
  anomaly: "Anomaly",
  concentration: "Concentration",
  seasonality: "Seasonality",
  segment: "Segment",
  driver: "Driver",
  mix: "Mix",
  caveat: "Caveat",
};

/** Up to this many answer rows are printed per question. */
const MAX_ROWS = 15;

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
    "Each answer below was computed by Loupe from your data, and the query under it returns the same values: it uses each KPI's own definition, with the same rows. You can check any of them in the app (Questions & SQL › Check this SQL on your data).",
    { tone: "muted", size: 9 },
  );

  doc.heading("1. Your business questions");
  if (!input.questions.length)
    doc.paragraph(
      "No questions were asked yet. Ask them in step 5, Questions & SQL: every answered question is added to this document with its query.",
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

  doc.heading("2. KPI definitions in SQL");
  doc.paragraph("The KPIs on your dashboard, each as one query over the whole file.", {
    tone: "muted",
    size: 9,
  });
  withSql.forEach((k, i) => {
    if (i) doc.divider();
    doc.heading(k.name, 3);
    doc.paragraph(k.definition, { tone: "muted", size: 9, after: 1 });
    doc.paragraph(`Formula: ${k.formula}${k.caveat ? `. ${k.caveat}` : ""}`, { tone: "subtle", size: 8.5 });
    doc.code(k.sql as string);
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
        value?.delta !== null && value?.delta !== undefined
          ? formatDelta(value.delta, input.fmt.locale)
          : "—",
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
  for (const [i, ins] of input.insights.entries()) {
    if (i) doc.divider();
    onProgress?.(`Writing insight ${i + 1} of ${input.insights.length}…`);
    doc.heading(`${i + 1}. ${ins.title}`, 3);
    doc.paragraph(`${KIND_LABEL[ins.kind]} · ${ins.confidence} confidence`, {
      tone: "subtle",
      size: 8,
      after: 1,
    });
    doc.paragraph(ins.body, { after: 1.5 });
    doc.paragraph(`Basis: ${ins.basis}`, { tone: "muted", size: 8.5 });
    const chart = ins.chartId ? input.charts.get(ins.chartId) : undefined;
    if (chart) {
      const png = await chartPng(chart, input.fmt);
      if (png) doc.figure(chart.spec.title, png, 860 / 360);
    }
  }
  doc.space(2);
  doc.paragraph(
    "Every number here is computed from your data by Loupe; nothing is estimated. Insights are ranked by how much they matter: the size of the effect, how reliable it is and how important the KPI is.",
    { tone: "subtle", size: 8.5 },
  );
  doc.finish(fileName);
}
