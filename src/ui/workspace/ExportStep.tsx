"use client";

/**
 * Step 8, Export: a gallery of the formats (version 50.4), each card led by
 * a preview of its file drawn from the dashboard as it stands (gallery/):
 *
 * - Share: the one-page dashboard, featured across the row (the page itself,
 *   drawn as it downloads: one 4K PNG or a one-page PDF, with the page's
 *   period, filters and charts named beside it); the dashboard report (PDF:
 *   cover, KPIs, numbered figures, glossary); the presentation slides
 *   (landscape 16:9 PNGs in a zip, or one PDF: an overview, then two or four
 *   charts a slide, each led by its takeaway, the deck shown and counted
 *   before it is made); and the insights (PDF).
 * - Take it further: the Power BI package (zip: semantic model, DAX, data,
 *   build guide), SQL (the file with every KPI as a view, the same SQL and DAX
 *   in colour to read, the business questions as a PDF once some were asked,
 *   and a check of every KPI query against the data in DuckDB-WASM), the data
 *   itself (cleaned CSV, data dictionary), and the dashboard's settings, saved
 *   and loaded again (no data rows).
 *
 * Since version 52.3 the page offers four choices, not eight cards: the
 * report (the one page, featured, with the full report and the insights PDF
 * one click away under "More report formats"), the slides, the data, and
 * one card "For analysts" that unfolds SQL & DAX, the Power BI package and
 * the saved settings. Nothing was removed; the rarer formats are folded.
 *
 * The page has one primary button, the featured download; every other
 * download is secondary. Each card carries a real fact about its file (pages,
 * slides, insights, views, rows), computed from the dashboard, never made up.
 * The slides and the report are the dashboard as the user left it: the KPI
 * layout and chart titles from Customise (kpiLayoutOf, exportCharts), with a
 * chart that can't be drawn now (a hidden column, a deleted KPI) left out and
 * named on the card. The Power BI package and the SQL & DAX page are built
 * from the file's own columns; when one would add a column (a date-only copy
 * of a datetime, a calculated hour or weekday), the user is asked first
 * (powerBiConsent), naming exactly the columns the built package adds. Power
 * BI, SQL and the data files cover the whole file, so the SQL check compares
 * with Loupe's whole-file values and says so.
 *
 * Since version 56.0 the data card leads with an Excel workbook: the
 * dashboard's KPIs, a sheet per chart, the rows behind them (its period and
 * filters) and the dictionary, in Excel's own formats (engine/export/
 * workbook.ts); the CSV still holds every row.
 *
 * The insights are looked for when the page opens, so their card and the
 * page's preview show them. Text is kept short: each card says what it is in
 * a few words, with the full description and notes behind it or an ⓘ
 * (ui/primitives/reveal); on a phone the page's chart list folds behind one.
 */
import * as React from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  Loader2,
  ShieldCheck,
  TriangleAlert,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatBytes, formatCount, formatValue } from "@/engine/core/format";
import { formatRange, formatDay } from "@/engine/core/dates";
import { PRESET_LABEL } from "@/engine/core/periods";
import { describeFilter } from "@/engine/query/filter";
import { compareFingerprints, fingerprintOf, parseConfig } from "@/engine/export/config";
import type { PackageManifest } from "@/engine/export/powerbi";
import { UTF8_BOM } from "@/engine/export/csv";
import { allSpecs, kpiLayoutOf, useWorkspace } from "@/store/workspace";
import { buildConfig } from "@/store/config";

// Kept where earlier code and tests read it from; it lives with the store since version 53.0.
export { buildConfig };
import { useSettings } from "@/store/settings";
import { powerBiTheme, resolveTheme } from "@/ui/charts/palette/themes";
import { engine } from "@/lib/engine-client";
import { defaultPageTitle } from "./dashboard/page/pagePlan";
import { cn, downloadBlob, exportFileName } from "@/lib/utils";
import type { VerificationResult } from "@/lib/duckdb";
import { Button } from "@/ui/primitives/button";
import { Skeleton } from "@/ui/primitives/misc";
import { Brief, ClampText, InfoTip } from "@/ui/primitives/reveal";
import { Segmented } from "@/ui/primitives/segmented";
import { Switch } from "@/ui/primitives/switch";
import { useFmt } from "@/ui/common/hooks";
import { orderByGoal } from "./dashboard/KpiCards";
import { downloadOnePage, usePageModel } from "./dashboard/page/OnePage";
import { FileIdentity } from "./FileIdentity";
import { StepHeader } from "./flow/StepHeader";
import { exportPdf, type ReportChart, type ReportInput } from "./export/report";
import { exportSlides } from "./export/slides";
import { describeSlides, planSlides, type SlideDensity } from "./export/slidePlan";
import { exportCharts, leftOutLabel, withShownTitle, type LeftOutChart } from "./export/exportCharts";
import { exportInsightsPdf, exportSqlPdf } from "./export/documents";
import { FormatBadges, GalleryCard, GallerySection } from "./export/gallery/GalleryCard";
import { PagePreview } from "./export/gallery/PagePreview";
import {
  DataPreview,
  InsightsPreview,
  ModelPreview,
  ReportPreview,
  SettingsPreview,
  SlidesPreview,
  SqlPreview,
} from "./export/gallery/previews";
import {
  modelOutline,
  packageLines,
  sqlExcerpt,
  viewCounts,
  type ModelOutline,
} from "./export/gallery/excerpts";
import { useColumnConsent, type ColumnRequest, type ProposedColumn } from "./NewColumnsDialog";

/**
 * The question for a Power BI download that would add `columns`. What
 * happens without them depends on which kinds are involved: no Date table
 * without the date-only copy, and Power BI's own date hierarchy (or "not
 * built") for chart axes.
 */
function powerBiConsent(
  columns: Array<ProposedColumn & { kind: "dateKey" | "datePart" }>,
  what: string,
): ColumnRequest {
  const n = columns.length;
  const noDateTable = columns.some((c) => c.kind === "dateKey");
  const parts = columns.some((c) => c.kind === "datePart");
  return {
    title: n === 1 ? `Add 1 column in the ${what}?` : `Add ${n} columns in the ${what}?`,
    intro: `Everything else is built from your own columns. ${n === 1 ? "This column is" : "These columns are"} only added inside Power BI; your file and Loupe's numbers stay the same either way.`,
    columns,
    ifNo: [
      noDateTable
        ? "There is no Date table, so no time-intelligence measures (YTD, prior year, moving averages); every KPI measure is still included."
        : "",
      parts
        ? "Charts by month or day of month use Power BI's own date hierarchy, and charts by hour or weekday are listed as not built."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    yesLabel: n === 1 ? "Add the column" : `Add ${n} columns`,
    noLabel: "Don't add, use my columns only",
  };
}

type WorkspaceState = ReturnType<typeof useWorkspace.getState>;

/**
 * The charts the slides and the report draw (exportCharts): those visible in
 * the current layout, in dashboard order, under their Customise titles, less
 * any that can't be drawn now, which are returned as `leftOut` with the
 * reason. The cards' counts and the exports both read it, so "24 charts" is
 * exactly what the file contains.
 */
function reportCharts(s: Pick<WorkspaceState, "widgets" | "charts" | "mode" | "context" | "customCharts">): {
  charts: ReportChart[];
  leftOut: LeftOutChart[];
} {
  return exportCharts({ widgets: s.widgets, specs: allSpecs(s), charts: s.charts, mode: s.mode });
}

/** reportCharts() for the current dashboard, kept current for a card's counts. */
function useReportCharts(): { charts: ReportChart[]; leftOut: LeftOutChart[] } {
  const widgets = useWorkspace((s) => s.widgets);
  const charts = useWorkspace((s) => s.charts);
  const mode = useWorkspace((s) => s.mode);
  const context = useWorkspace((s) => s.context);
  const customCharts = useWorkspace((s) => s.customCharts);
  return React.useMemo(
    () => reportCharts({ widgets, charts, mode, context, customCharts }),
    [widgets, charts, mode, context, customCharts],
  );
}

/** How many headline KPIs the report's cover and the slides' overview show (the dashboard's layout). */
function useHeroCount(): number {
  return useWorkspace((s) => kpiLayoutOf(s).hero.length);
}

/** The automatic charts of the "From your other columns" section, which the slides and report leave out unless asked. */
const isColumnChart = (c: { spec: { section: string } }) => c.spec.section === "columns";

function useReportInput(): () => ReportInput | null {
  const fmt = useFmt();
  return React.useCallback(() => {
    const s = useWorkspace.getState();
    const ctx = s.context;
    if (!ctx || !s.summary) return null;
    const metas = new Map(ctx.kpis.map((k) => [k.id, k]));
    const values = new Map(s.kpiBatch?.values.map((v) => [v.id, v]) ?? []);
    // The KPIs the dashboard shows, in its order: the user's layout from Customise, else the
    // recommendation with the heroes that match the main goal first (as the KPI strip orders them).
    const layout = kpiLayoutOf(s);
    const heroIds = s.kpiLayout ? layout.hero : orderByGoal(layout.hero, metas, s.business.goal);
    const kpis = (ids: string[]) =>
      ids.flatMap((id) => {
        const meta = metas.get(id);
        return meta ? [{ meta, value: values.get(id) }] : [];
      });
    const dims = s.filters().filter((f) => f.kind !== "dateRange");
    return {
      title: ctx.domain.name,
      subtitle: `${ctx.domain.subDomains.find((x) => x.id === ctx.subDomainId)?.name ?? ""} · ${s.summary.fileName}`,
      fileName: s.summary.fileName,
      isDemo: s.summary.isDemo,
      period:
        s.datePreset === "custom" && s.customRange
          ? formatRange(s.customRange.from, s.customRange.to)
          : (s.kpiBatch?.period?.label ?? PRESET_LABEL[s.datePreset]),
      // The preset's own name beside its dates ("Last 12 months: …"); none for a custom range or all time.
      periodName: s.datePreset === "custom" || s.datePreset === "all" ? null : PRESET_LABEL[s.datePreset],
      comparison: s.kpiBatch?.comparison?.label ?? null,
      dataTo: ctx.dateBounds ? formatDay(ctx.dateBounds.max) : null,
      filters: dims.length ? dims.map((f) => describeFilter(f, formatDay)).join("; ") : "None",
      rows: s.lastCompute?.rows ?? s.summary.rowCount,
      grain: ctx.grainLabel,
      generatedAt: formatDay(Date.now()),
      hero: kpis(heroIds),
      supporting: kpis(layout.supporting),
      insights: s.insights ?? [],
      charts: reportCharts(s).charts,
      health: s.health,
      fmt,
    };
  }, [fmt]);
}

export function ExportStep() {
  const context = useWorkspace((s) => s.context);
  const summary = useWorkspace((s) => s.summary);
  const loadInsights = useWorkspace((s) => s.loadInsights);
  const insightsMissing = useWorkspace((s) => s.insights === null);
  // The insights are looked for as the page opens (and again after a rebuild clears them), so the
  // page's preview and the insights card show them; a download still finds them first if it must.
  React.useEffect(() => {
    if (insightsMissing) void loadInsights();
  }, [insightsMissing, loadInsights]);
  if (!context || !summary) return null;
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-8 pb-12 md:px-8 md:pt-10">
      <StepHeader
        step="export"
        className="mb-8"
        title="Take it anywhere"
        lead="Reports and Excel show your view; CSV and SQL, every row."
        leadFull="The one page, the report, the slides, the insights and the Excel workbook show the dashboard as you see it, with its period and filters; Power BI, SQL and the CSV cover the whole file."
        aside={
          // Capped, so a long file or sheet name truncates (whole on hover or a long press) rather
          // than widening the page: the viewport less its gutters on a phone, 24rem beside the heading.
          <div className="flex max-w-[calc(100vw-2rem)] min-w-0 flex-col items-start gap-1.5 sm:max-w-sm sm:items-end">
            <FileIdentity summary={summary} size="sm" />
            <span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
              <ShieldCheck className="size-3.5 text-success" aria-hidden />
              <Brief
                label="Where the files are made"
                full="Every file is made in this tab. Nothing is uploaded."
              >
                Nothing uploaded
              </Brief>
            </span>
          </div>
        }
      />

      <GallerySection id="export-report" title="Report">
        <div className="grid gap-4">
          <OnePageCard />
          <MoreFormats label="More report formats" count={2}>
            <ReportCard />
            <InsightsCard />
          </MoreFormats>
        </div>
      </GallerySection>

      <GallerySection id="export-slides-data" title="Slides and data" className="mt-12">
        <div className="grid gap-5 sm:grid-cols-2">
          <SlidesCard />
          <DataCard />
        </div>
      </GallerySection>

      <GallerySection id="export-analysts" title="For analysts" className="mt-12">
        <AnalystFormats />
      </GallerySection>
    </div>
  );
}

/**
 * Formats kept one click away (version 52.3): a quiet button that unfolds the cards it holds, so the page
 * leads with the four choices most people need.
 */
function MoreFormats({
  label,
  count,
  columns = "sm:grid-cols-2",
  children,
}: {
  label: string;
  count: number;
  columns?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return (
    <div className="grid gap-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex w-fit items-center gap-1.5 rounded-control px-2 py-1 text-ui font-medium text-accent-text transition-colors duration-fast hover:bg-surface-hover focus-visible:focus-ring"
      >
        <ChevronDown
          className={cn("size-4 transition-transform duration-fast", open && "rotate-180")}
          aria-hidden
        />
        {open ? `Hide ${label.toLowerCase()}` : `${label} (${count})`}
      </button>
      {open ? (
        <div id={id} className={cn("grid gap-5", columns)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * "For analysts": one card for the formats an analyst takes elsewhere: every KPI as SQL and DAX (and
 * checked in DuckDB), the Power BI project package, and the dashboard's settings to reopen it later.
 */
function AnalystFormats() {
  return (
    <div className="grid gap-4 rounded-card border border-border bg-surface-1 p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-md font-medium text-fg">SQL, DAX and Power BI</h3>
          <p className="mt-1 text-ui text-fg-muted">
            <Brief
              label="About the analyst formats"
              full="Every KPI written as SQL and as DAX, the same queries checked against your data, a Power BI project package (semantic model, measures, data and a build guide), and this dashboard's settings to load again later. All cover the whole file."
            >
              Every KPI as SQL and DAX, a Power BI project, and your settings.
            </Brief>
          </p>
        </div>
        <FormatBadges formats={["SQL", "DAX", "PBIP", "JSON"]} />
      </div>
      <MoreFormats label="Show the files" count={3} columns="sm:grid-cols-2 xl:grid-cols-3">
        <SqlCard />
        <PowerBiCard />
        <SettingsCard />
      </MoreFormats>
    </div>
  );
}

/** A download button's icon: the arrow, or a spinner while its file is made. */
function DownloadIcon({ busy }: { busy: boolean }) {
  return busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />;
}

/**
 * The switch that adds the automatic charts of the "From your other columns"
 * section to the slides or the report; off by default, as they are folded
 * away on the dashboard.
 */
function ColumnsSwitch({
  count,
  checked,
  onCheckedChange,
  what,
}: {
  count: number;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  /** "slides" or "report", for the switch's accessible name. */
  what: string;
}) {
  const label =
    count === 1
      ? "Include the chart from your other columns"
      : `Include the ${count} charts from your other columns`;
  return (
    <label className="flex items-center gap-2 text-xs text-fg-muted">
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={`${label} in the ${what}`} />
      {label}
    </label>
  );
}

/**
 * Which charts a file leaves out and why: charts on the dashboard that can't
 * be drawn now (one uses a column hidden in Check & map or a KPI that was
 * deleted, or has nothing to draw for this selection). The count stays in
 * view; three are named, with the reason, behind its ⓘ.
 */
function LeftOutNote({ charts, className }: { charts: LeftOutChart[]; className?: string }) {
  if (!charts.length) return null;
  return (
    <p className={cn("flex items-center gap-1.5 text-xs font-medium text-fg-muted", className)}>
      <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden />
      {leftOutLabel(charts.length)}
      <InfoTip label="Which charts are left out, and why">
        <ul className="grid gap-1">
          {charts.slice(0, 3).map((c) => (
            <li key={c.id}>
              <span className="font-medium">{c.title}</span>: {c.why}
            </li>
          ))}
          {charts.length > 3 ? <li>and {charts.length - 3} more</li> : null}
        </ul>
      </InfoTip>
    </p>
  );
}

/** One count on the featured card ("6 KPIs"), the figure above its word; a skeleton until it is known. */
function Count({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="min-w-0 rounded-control border border-border-subtle bg-surface-2 px-3 py-2">
      {value === null ? (
        <Skeleton className="my-1 h-5 w-6 rounded-sm" />
      ) : (
        <p className="font-figures text-lg leading-tight font-semibold text-fg">{value}</p>
      )}
      <p className="truncate text-xs text-fg-subtle">{label}</p>
    </div>
  );
}

/**
 * The one-page dashboard, the featured share: the dashboard on one landscape
 * page (title, filter pills, headline KPIs, four charts with their takeaways,
 * the key insights beside them) as one 4K image or a one-page PDF, previewed
 * as it downloads. It shows the dashboard's current period and filters, and
 * is exactly the page in the dashboard's one-page view.
 */
function OnePageCard() {
  const fmt = useFmt();
  const title = useWorkspace((s) => s.pageTitle);
  const setStep = useWorkspace((s) => s.setStep);
  const setView = useWorkspace((s) => s.setDashView);
  const model = usePageModel(title);
  const [busy, setBusy] = React.useState<"png" | "pdf" | null>(null);
  if (!model) return null;
  const filters = model.slicers.filter((s) => s.values.length).length;
  const pageMeta = `${model.periodLabel}${filters ? ` · ${filters} filter${filters === 1 ? "" : "s"}` : " · no filters"}`;
  const chartList = model.charts.map((c, i) => (
    <li key={c.spec.id} className="flex min-w-0 gap-1.5">
      <span className="tabular w-3 shrink-0 text-fg-subtle">{i + 1}</span>
      <ClampText className="min-w-0">{c.title}</ClampText>
    </li>
  ));
  const run = async (format: "png" | "pdf") => {
    setBusy(format);
    try {
      await downloadOnePage(format, fmt);
      toast.success(format === "png" ? "Page downloaded as an image" : "Page downloaded as a PDF");
    } catch (e) {
      toast.error(`The page couldn't be made: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <GalleryCard
      layout="featured"
      stage="paper"
      title="One-page dashboard"
      line="Your dashboard on one landscape page."
      full={`The whole story on one landscape page: the headline KPIs, ${model.charts.length === 1 ? "the key chart" : `${model.charts.length} key charts`} with their takeaways, and the key insights.`}
      formats={["PNG", "PDF"]}
      preview={<PagePreview model={model} />}
      fact={
        <Brief
          label="About the page's format"
          full="One image, 3840 × 2160 (4K), or a one-page landscape PDF, with the dashboard's current period and filters."
        >
          A 4K image or a one-page PDF.
        </Brief>
      }
      actions={
        <>
          <Button
            variant="primary"
            size="lg"
            className="max-sm:w-full"
            onClick={() => void run("png")}
            disabled={Boolean(busy)}
          >
            <DownloadIcon busy={busy === "png"} />
            Download page
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="max-sm:w-full"
            onClick={() => void run("pdf")}
            disabled={Boolean(busy)}
            aria-label="As PDF: One-page dashboard"
          >
            {busy === "pdf" ? <Loader2 className="animate-spin" aria-hidden /> : <FileText aria-hidden />}
            As PDF
          </Button>
        </>
      }
    >
      {/* The page's own title and selection; the way to it wraps under them when they need the room. */}
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1.5 border-t border-border-subtle pt-4">
        <div className="min-w-0 grow basis-56">
          <ClampText key={model.title} className="text-ui font-medium text-fg">
            {model.title}
          </ClampText>
          <ClampText key={pageMeta} className="tabular mt-0.5 text-xs text-fg-subtle">
            {pageMeta}
          </ClampText>
        </div>
        <button
          type="button"
          onClick={() => {
            setView("page");
            setStep("dashboard");
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-xs text-xs font-medium text-accent-text outline-none hover:underline focus-visible:focus-ring"
        >
          See it on the dashboard
          <ArrowUpRight className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Count value={model.kpis.length} label={model.kpis.length === 1 ? "KPI" : "KPIs"} />
        <Count value={model.charts.length} label={model.charts.length === 1 ? "chart" : "charts"} />
        <Count
          value={model.insightsReady ? model.insights.length : null}
          label={model.insights.length === 1 ? "insight" : "insights"}
        />
      </div>
      {model.charts.length ? (
        <>
          {/* The charts by name from sm up; on a phone, their count with the names behind the ⓘ. */}
          <ol className="hidden gap-1 text-xs text-fg-muted sm:grid" aria-label="Charts on the page">
            {chartList}
          </ol>
          <p className="flex items-center gap-1.5 text-xs text-fg-muted sm:hidden">
            Charts on the page
            <InfoTip label="Charts on the page">
              <ol className="grid gap-1">{chartList}</ol>
            </InfoTip>
          </p>
        </>
      ) : null}
    </GalleryCard>
  );
}

/**
 * Dashboard report: the analyst's PDF (cover, KPIs, summary, numbered
 * figures, glossary). The automatic charts for other columns (folded on the
 * dashboard) stay out unless asked for, as in the slides.
 */
function ReportCard() {
  const build = useReportInput();
  const summary = useWorkspace((s) => s.summary);
  const loadInsights = useWorkspace((s) => s.loadInsights);
  const heroes = useHeroCount();
  const { charts, leftOut } = useReportCharts();
  const [withColumns, setWithColumns] = React.useState(false);
  const columnCharts = charts.filter(isColumnChart).length;
  const drawn = withColumns ? charts : charts.filter((c) => !isColumnChart(c));
  // Cover, two figures a page, appendix: the same count exportPdf lays out.
  const pages = 2 + Math.ceil(drawn.length / 2);
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = async () => {
    setBusy("Preparing…");
    try {
      if (!useWorkspace.getState().insights) await loadInsights();
      const input = build();
      if (!input) return;
      await exportPdf(
        { ...input, charts: withColumns ? input.charts : input.charts.filter((c) => !isColumnChart(c)) },
        exportFileName(summary?.name, "dashboard-report", "pdf"),
        setBusy,
      );
      toast.success("Dashboard report downloaded");
    } catch (e) {
      toast.error(`The PDF couldn't be made: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <GalleryCard
      stage="paper"
      title="Dashboard report"
      line="Cover, KPIs, numbered figures, glossary."
      full="An analyst's report: a cover with the period and the headline KPIs, an executive summary, every chart as a numbered figure with its takeaway, and a glossary of the KPIs."
      formats={["PDF"]}
      preview={<ReportPreview kpis={heroes} pages={pages} charts={drawn} />}
      fact={`A4 · ${pages} pages`}
      actions={
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => void run()}
          disabled={Boolean(busy)}
          aria-label="Download PDF: Dashboard report"
        >
          <DownloadIcon busy={Boolean(busy)} />
          <span className="truncate">{busy ?? "Download PDF"}</span>
        </Button>
      }
    >
      {columnCharts ? (
        <ColumnsSwitch
          count={columnCharts}
          checked={withColumns}
          onCheckedChange={setWithColumns}
          what="report"
        />
      ) : null}
      <LeftOutNote charts={leftOut.filter((c) => withColumns || c.section !== "columns")} />
    </GalleryCard>
  );
}

/**
 * Presentation slides: the dashboard as landscape 16:9 images (two or four
 * charts a slide, each led by its takeaway), with the deck previewed and
 * counted before it is made, as PNGs in a zip or one PDF. The automatic
 * charts for other columns (folded on the dashboard) stay out unless asked
 * for.
 */
function SlidesCard() {
  const build = useReportInput();
  const summary = useWorkspace((s) => s.summary);
  const loadInsights = useWorkspace((s) => s.loadInsights);
  const heroes = useHeroCount();
  const [density, setDensity] = React.useState<SlideDensity>(2);
  const [withColumns, setWithColumns] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const { charts: all, leftOut } = useReportCharts();
  const columnCharts = all.filter(isColumnChart).length;
  const slides = React.useMemo(
    () => planSlides(withColumns ? all : all.filter((c) => !isColumnChart(c)), density),
    [all, withColumns, density],
  );
  const deck = describeSlides(slides);
  const run = async (format: "png" | "pdf") => {
    setBusy("Preparing…");
    try {
      // The overview's takeaways are the insights: found first if they haven't been yet.
      if (!useWorkspace.getState().insights) await loadInsights();
      const input = build();
      if (!input) return;
      // Each density has its own name, so a presenting deck and a compact one can sit side by side.
      const artefact = `slides-${density}-per-slide`;
      const base = exportFileName(summary?.name, artefact, format).replace(/\.(png|pdf)$/, "");
      await exportSlides(input, slides, format, base, setBusy);
      toast.success(
        format === "png"
          ? `${slides.length} slides downloaded as images`
          : `${slides.length} slides downloaded as a PDF`,
      );
    } catch (e) {
      toast.error(`The slides couldn't be made: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <GalleryCard
      stage="paper"
      title="Presentation slides"
      line="16:9 slides, a takeaway on every chart."
      full="Landscape 16:9 slides with a takeaway on every chart, ready for PowerPoint, Keynote or a screen. Each image is 3840 × 2160 (4K), numbered in order, opening with the headline KPIs and key takeaways."
      formats={["PNG", "PDF"]}
      preview={<SlidesPreview slides={slides} kpis={heroes} />}
      fact={
        <span className="flex min-w-0 items-baseline gap-1">
          <span className="shrink-0 font-medium text-fg-muted">{slides.length} slides</span>
          <ClampText key={deck} className="min-w-0">
            · {deck}
          </ClampText>
        </span>
      }
      actions={
        <>
          <Button
            variant="secondary"
            className="min-w-0 flex-1 px-3"
            onClick={() => void run("png")}
            disabled={Boolean(busy)}
            aria-label="Download slides as images"
          >
            <DownloadIcon busy={Boolean(busy)} />
            <span className="truncate">{busy ?? "Download slides"}</span>
          </Button>
          <Button
            variant="secondary"
            className="px-3"
            onClick={() => void run("pdf")}
            disabled={Boolean(busy)}
            aria-label="As PDF: Presentation slides"
          >
            <FileText aria-hidden /> As PDF
          </Button>
        </>
      }
    >
      <Segmented<"2" | "4">
        ariaLabel="Charts per slide"
        size="sm"
        className="w-fit"
        value={String(density) as "2" | "4"}
        onChange={(v) => setDensity(v === "4" ? 4 : 2)}
        options={[
          { value: "2", title: "2 charts a slide, for presenting", label: "2 charts a slide" },
          { value: "4", title: "4 charts a slide, compact", label: "4 charts a slide" },
        ]}
      />
      {columnCharts ? (
        <ColumnsSwitch
          count={columnCharts}
          checked={withColumns}
          onCheckedChange={setWithColumns}
          what="slides"
        />
      ) : null}
      <LeftOutNote charts={leftOut.filter((c) => withColumns || c.section !== "columns")} />
    </GalleryCard>
  );
}

/** Insights: what the data says, ranked, with the chart that shows it where there is one. */
function InsightsCard({ alone }: { alone?: boolean }) {
  const build = useReportInput();
  const summary = useWorkspace((s) => s.summary);
  const insights = useWorkspace((s) => s.insights);
  const loadInsights = useWorkspace((s) => s.loadInsights);
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = async () => {
    setBusy("Finding insights…");
    try {
      if (!useWorkspace.getState().insights) await loadInsights();
      const input = build();
      if (!input) return;
      const s = useWorkspace.getState();
      // Every computed chart, so an insight can show its chart even when it is hidden in this
      // layout; each under the title the dashboard gives it (the user's own from Customise).
      const charts = new Map(
        allSpecs(s)
          .filter((sp) => s.charts[sp.id])
          .map((sp) => {
            const w = s.widgets.find((x) => x.id === sp.id);
            return [
              sp.id,
              {
                spec: withShownTitle(sp, w),
                data: s.charts[sp.id] as NonNullable<(typeof s.charts)[string]>,
                kind: w?.kind ?? sp.kind,
              },
            ];
          }),
      );
      await exportInsightsPdf(
        {
          title: input.title,
          subtitle: input.subtitle,
          fileName: input.fileName,
          isDemo: input.isDemo,
          fmt: input.fmt,
          period: input.period,
          filters: input.filters,
          rows: input.rows,
          hero: input.hero,
          insights: input.insights,
          charts,
        },
        exportFileName(summary?.name, "insights", "pdf"),
        setBusy,
      );
      toast.success("Insights downloaded");
    } catch (e) {
      toast.error(`The insights PDF couldn't be made: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <GalleryCard
      alone={alone}
      stage="paper"
      title="Insights"
      line="Ranked findings, each with its chart."
      full="What the data says, ranked by impact, each with the chart that shows it where there is one."
      formats={["PDF"]}
      preview={<InsightsPreview insights={insights} />}
      fact={
        insights
          ? insights.length
            ? `${insights.length} ${insights.length === 1 ? "insight" : "insights"}, ranked`
            : "Nothing stands out for this selection"
          : "Finding insights…"
      }
      actions={
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => void run()}
          disabled={Boolean(busy)}
          aria-label="Download PDF: Insights"
        >
          <DownloadIcon busy={Boolean(busy)} />
          <span className="truncate">{busy ?? "Download PDF"}</span>
        </Button>
      }
    />
  );
}

/** What the Power BI package holds, before it is made (afterwards the real file list replaces it). */
const PACKAGE_PARTS = [
  "Semantic model (TMDL)",
  "Every KPI as a DAX measure",
  "Your data (CSV)",
  "Date table and time intelligence",
  "SQL views",
  "Data dictionary",
  "Your chart colours as a theme",
  "Step-by-step build guide",
];

/** Using the package, in the README's own first steps (Path A). */
const PACKAGE_STEPS = [
  { title: "Unzip it", line: "One folder, named like the zip, holds everything." },
  { title: "Load data.csv", line: "Get data → Text/CSV in Power BI Desktop." },
  { title: "Paste measures.dax", line: "DAX query view → Run. The README has the rest." },
];

/**
 * The Power BI package. It describes the dashboard as laid out, the user's
 * own charts included (the engine reads their specs, titles and chart types
 * from the config the package embeds, and leaves out any it couldn't draw).
 * The package is built first and the question names exactly the columns it
 * adds; nothing is saved until the user answers, and "no" builds it again
 * without them. The preview is the model's diagram, its table and measures
 * read from the package's own measures.dax.
 */
function PowerBiCard() {
  const [busy, setBusy] = React.useState(false);
  const [manifest, setManifest] = React.useState<PackageManifest | null>(null);
  // The model's outline from measures.dax: undefined while it is read, null when it has no measure.
  const [outline, setOutline] = React.useState<ModelOutline | null | undefined>(undefined);
  const summary = useWorkspace((s) => s.summary);
  const context = useWorkspace((s) => s.context);
  const consent = useColumnConsent();
  React.useEffect(() => {
    let live = true;
    engine()
      .exportDax()
      .then(
        (dax) => {
          if (live) setOutline(modelOutline(dax));
        },
        () => {
          if (live) setOutline(null);
        },
      );
    return () => {
      live = false;
    };
  }, [context]);
  const generate = async (opener: HTMLElement) => {
    const cfg = buildConfig();
    if (!cfg) return;
    setBusy(true);
    try {
      const s = useWorkspace.getState();
      const specs = allSpecs(s);
      const visible = s.widgets
        .filter((w) => !w.hidden && specs.find((x) => x.id === w.id)?.modes.includes(s.mode))
        .map((w) => w.id);
      // The chart colours travel as a Power BI report theme, so the report can match the dashboard.
      const theme = resolveTheme(useSettings.getState().chartTheme);
      // The zip and the folder inside it share one name, so an unzipped package says what it is.
      const zipName = exportFileName(summary?.name, "powerbi-package", "zip");
      const build = (noNewColumns: boolean) =>
        engine().exportPowerBi(
          JSON.stringify(cfg, null, 2),
          visible,
          noNewColumns,
          { name: theme.name, json: powerBiTheme(theme) },
          zipName.replace(/\.zip$/, ""),
        );
      let out = await build(false);
      const extra = out.manifest.newColumns;
      // Focus comes back to this button when the question closes, once it is enabled again.
      const add = await consent.ask(powerBiConsent(extra, "Power BI package"), opener);
      if (add === null) return;
      if (!add && extra.length) out = await build(true);
      downloadBlob(new Blob([out.zip as BlobPart], { type: "application/zip" }), zipName);
      setManifest(out.manifest);
      toast.success(
        extra.length && !add
          ? "Power BI package downloaded · no columns added"
          : "Power BI package downloaded",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <GalleryCard
      title="Power BI package"
      line="Rebuild this dashboard in Power BI Desktop."
      full="Everything to rebuild this dashboard in Power BI Desktop in about five minutes. A project package, not a .pbix: only Power BI Desktop can write that file. Built from your columns; you're asked before anything is added."
      formats={["ZIP"]}
      preview={
        <ModelPreview
          outline={outline}
          columns={summary?.columnCount ?? 0}
          dates={Boolean(context?.dateColumn)}
        />
      }
      fact={
        manifest ? (
          <span className="inline-flex items-center gap-1.5 text-fg-muted">
            <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden />
            <span className="tabular">
              Downloaded: {manifest.files.length} files, {formatBytes(manifest.totalBytes)}
            </span>
            <InfoTip label="The package's files">
              <ul className="grid gap-1">
                {packageLines(manifest).map((f) => (
                  <li key={f.path} className="flex justify-between gap-4">
                    <span>
                      {f.path}
                      {f.files > 1 ? ` · ${f.files} files` : ""}
                    </span>
                    <span className="tabular shrink-0">{formatBytes(f.bytes)}</span>
                  </li>
                ))}
              </ul>
            </InfoTip>
          </span>
        ) : (
          <Brief
            label="What the package holds"
            full={
              <ul className="grid gap-1">
                {PACKAGE_PARTS.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            }
          >
            Model, measures, data and a build guide
          </Brief>
        )
      }
      actions={
        <Button
          variant="secondary"
          className="w-full"
          onClick={(e) => void generate(e.currentTarget)}
          disabled={busy}
          aria-label="Download package: Power BI package"
        >
          <DownloadIcon busy={busy} /> Download package
        </Button>
      }
    >
      {consent.dialog}
      {/* Each step by name; how to do it behind its ⓘ (the README has every step in full). */}
      <ol className="grid gap-1.5" aria-label="How to use it">
        {PACKAGE_STEPS.map((step, i) => (
          <li key={step.title} className="flex items-center gap-2.5">
            <span className="font-figures grid size-5 shrink-0 place-items-center rounded-full border border-border-accent bg-accent-soft text-2xs font-medium text-accent-text">
              {i + 1}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-ui text-fg">
              {step.title}
              <InfoTip label={`How to: ${step.title}`}>{step.line}</InfoTip>
            </span>
          </li>
        ))}
      </ol>
    </GalleryCard>
  );
}

/**
 * SQL: the file (every KPI as a view), the same SQL and DAX in colour to read
 * in a browser, the business questions as a PDF once some were asked, and a
 * check that every KPI query returns Loupe's own value over the whole file in
 * DuckDB (the views have no period or filter, so neither has the check). The
 * preview is the file's first KPI view.
 */
function SqlCard() {
  const fmt = useFmt();
  const summary = useWorkspace((s) => s.summary);
  const context = useWorkspace((s) => s.context);
  const questions = useWorkspace((s) => s.questions);
  const consent = useColumnConsent();
  const [sql, setSql] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<VerificationResult[] | null>(null);
  const [pdfBusy, setPdfBusy] = React.useState(false);
  React.useEffect(() => {
    void engine().exportSql().then(setSql);
  }, [context]);
  const views = sql ? viewCounts(sql) : null;
  const excerpt = React.useMemo(() => (sql ? sqlExcerpt(sql) : null), [sql]);
  const wholeFile = `Loupe's whole-file values (${formatCount(summary?.rowCount ?? 0, fmt.locale)} rows)`;
  // The page's DAX is measures.dax, so it asks the same question about the Date table's helper column.
  const downloadHtml = async () => {
    try {
      const extra = await engine().powerBiNewColumns([]);
      const add = await consent.ask(powerBiConsent(extra, "SQL & DAX page"));
      if (add === null) return;
      downloadBlob(
        await engine().exportCodeHtml(!add),
        exportFileName(summary?.name, "kpis-sql-and-dax", "html"),
        "text/html;charset=utf-8",
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const downloadQuestions = async () => {
    if (!context || !summary) return;
    setPdfBusy(true);
    try {
      const { hero, supporting, columns } = context.selection;
      const kpis = [...hero, ...supporting, ...columns]
        .map((id) => context.kpis.find((k) => k.id === id))
        .filter((k): k is NonNullable<typeof k> => Boolean(k?.available && k.sql));
      const sub = context.domain.subDomains.find((x) => x.id === context.subDomainId)?.name ?? "";
      await exportSqlPdf(
        {
          title: context.domain.name,
          subtitle: `${sub ? `${sub} · ` : ""}${summary.fileName}`,
          fileName: summary.fileName,
          isDemo: summary.isDemo,
          fmt,
          table: await engine().sqlTableName(),
          questions,
          kpis,
          describe: (f) => describeFilter(f, formatDay),
        },
        exportFileName(summary.name, "questions-and-sql", "pdf"),
      );
      toast.success("Questions and SQL downloaded");
    } catch (e) {
      toast.error(`The PDF couldn't be made: ${(e as Error).message}`);
    } finally {
      setPdfBusy(false);
    }
  };
  const verify = async () => {
    setResults(null);
    setStatus("Preparing…");
    try {
      const bundle = await engine().verificationBundle();
      const { verifySql } = await import("@/lib/duckdb");
      const r = await verifySql(bundle, setStatus);
      setResults(r);
      const ok = r.filter((x) => x.match).length;
      toast[ok === r.length ? "success" : "warning"](`${ok} of ${r.length} KPI queries match ${wholeFile}`);
    } catch (e) {
      const err = e as Error;
      // DuckDB out of reach says so in its own words; anything else is a start-up failure.
      toast.error(
        err.name === "DuckDbUnavailableError" ? err.message : `DuckDB couldn't start: ${err.message}`,
      );
    } finally {
      setStatus(null);
    }
  };
  const fmtKpi = (id: string, v: number | null) =>
    formatValue(v, context?.kpis.find((x) => x.id === id)?.format ?? "number", fmt);
  const matched = results?.filter((r) => r.match).length ?? 0;
  return (
    <GalleryCard
      title="SQL"
      line="Every KPI as a view you can run."
      full="kpis.sql holds every KPI as a SQL view over your whole file, with the same SQL and DAX in colour to read in a browser. Verify runs each query on your data in DuckDB, in this tab, and compares it with Loupe's value."
      formats={questions.length ? ["SQL", "HTML", "PDF"] : ["SQL", "HTML"]}
      preview={<SqlPreview excerpt={excerpt} />}
      fact={
        views
          ? `${views.kpis} ${views.kpis === 1 ? "view" : "views"}, one per KPI${
              views.helpers ? ` + ${views.helpers} ${views.helpers === 1 ? "helper" : "helpers"}` : ""
            }`
          : "Writing…"
      }
      actions={
        <>
          <Button
            variant="secondary"
            className="min-w-0 flex-1 px-3"
            disabled={!sql}
            onClick={() =>
              sql && downloadBlob(sql, exportFileName(summary?.name, "kpis", "sql"), "application/sql")
            }
            aria-label="Download .sql: KPI views"
          >
            <Download aria-hidden /> Download .sql
          </Button>
          <Button
            variant="secondary"
            className="px-3"
            onClick={() => void downloadHtml()}
            aria-label="Download .html: SQL and DAX in colour"
          >
            <Download aria-hidden /> In colour
          </Button>
        </>
      }
    >
      {consent.dialog}
      {results ? (
        <details className="group/v">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xs text-xs text-fg-muted outline-none select-none focus-visible:focus-ring">
            {matched === results.length ? (
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
            ) : (
              <XCircle className="size-4 shrink-0 text-danger" aria-hidden />
            )}
            <span className="tabular min-w-0">
              {matched} of {results.length} KPI queries match · whole file
            </span>
            <span className="ml-auto shrink-0 text-fg-subtle underline-offset-2 group-open/v:hidden hover:underline">
              Details
            </span>
          </summary>
          <p className="mt-2 text-xs text-fg-subtle">Compared with {wholeFile}.</p>
          {/* Scrolls in its own box, so a long list never pushes the rest of the page away. */}
          <div
            className="mt-2 max-h-64 overflow-y-auto"
            // Focusable, so the list can be scrolled from the keyboard (the global focus ring shows it).
            tabIndex={0}
            role="region"
            aria-label="Each KPI query's result"
          >
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-1 text-left text-fg-subtle">
                <tr>
                  <th className="py-1 font-medium">KPI</th>
                  <th className="py-1 pl-3 text-right font-medium">Loupe (whole file)</th>
                  <th className="py-1 pl-3 text-right font-medium">DuckDB</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id} className="border-t border-border-subtle">
                    <td className="py-1 pr-2 text-fg">{r.name}</td>
                    <td className="font-figures py-1 pl-3 text-right text-fg">{fmtKpi(r.id, r.engine)}</td>
                    <td
                      className={cn(
                        "font-figures py-1 pl-3 text-right",
                        r.match ? "text-fg" : "text-danger-text",
                      )}
                      title={r.error}
                    >
                      {r.error ? "error" : fmtKpi(r.id, r.duckdb)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="-ml-2 w-fit"
          onClick={() => void verify()}
          disabled={Boolean(status)}
        >
          {status ? <Loader2 className="animate-spin" aria-hidden /> : <BadgeCheck aria-hidden />}
          {status ?? "Verify against your data"}
        </Button>
      )}
      {questions.length ? (
        <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
          <div className="min-w-0">
            <p className="truncate text-ui text-fg">Your questions with their SQL</p>
            <p className="tabular truncate text-xs text-fg-subtle">
              {questions.length} {questions.length === 1 ? "question" : "questions"} answered
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void downloadQuestions()}
            disabled={pdfBusy}
            aria-label=".pdf: Your questions with their SQL"
          >
            <DownloadIcon busy={pdfBusy} /> .pdf
          </Button>
        </div>
      ) : null}
    </GalleryCard>
  );
}

/** Data: the cleaned file (your headers, tidied values) and what each column means. */
function DataCard({ alone }: { alone?: boolean }) {
  const summary = useWorkspace((s) => s.summary);
  const profile = useWorkspace((s) => s.profile);
  const viewRows = useWorkspace((s) => s.lastCompute?.rows ?? null);
  const locale = useSettings((s) => s.numberLocale);
  const reportInput = useReportInput();
  const { charts } = useReportCharts();
  const [making, setMaking] = React.useState(false);
  const [rows, setRows] = React.useState<Array<Array<string | null>> | null>(null);
  // The first rows of the data, as the data grid shows them, under the file's own headers.
  React.useEffect(() => {
    let live = true;
    engine()
      .rows(0, 6)
      .then(
        (r) => {
          if (live) setRows(r);
        },
        () => {
          if (live) setRows([]);
        },
      );
    return () => {
      live = false;
    };
  }, [summary]);
  const name = (artefact: string, ext: string) => exportFileName(summary?.name, artefact, ext);
  // CSVs start with the byte-order mark so Excel reads them as UTF-8 (₹ and accents intact).
  const data = async () => {
    try {
      // Your headers as written: this file is for you, not for the SQL or Power BI package.
      const bytes = await engine().exportCsv(true, true);
      downloadBlob(
        new Blob([UTF8_BOM, bytes as BlobPart], { type: "text/csv;charset=utf-8" }),
        name("data", "csv"),
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const dictionary = async () => {
    try {
      downloadBlob(
        UTF8_BOM + (await engine().exportDictionary("csv")),
        name("data-dictionary", "csv"),
        "text/csv;charset=utf-8",
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  // The dashboard as a workbook: its KPIs and charts as shown, the rows behind them, the dictionary.
  const excel = async () => {
    const input = reportInput();
    const s = useWorkspace.getState();
    const ctx = s.context;
    if (!input || !ctx) return;
    setMaking(true);
    try {
      const roster = ctx.domain.subDomains.find((x) => x.id === ctx.subDomainId)?.timeModel === "roster";
      const title =
        s.pageTitle?.trim() ||
        defaultPageTitle(ctx.domain.name, {
          generic: ctx.domain.generic,
          roster,
          weak: ctx.fit.weak,
          understood: ctx.understanding?.title,
        });
      const facts = [
        { label: "Period", value: input.periodName ? `${input.periodName}: ${input.period}` : input.period },
        ...(input.comparison ? [{ label: "Compared with", value: input.comparison }] : []),
        { label: "Filters", value: input.filters },
        ...(input.dataTo ? [{ label: "Data to", value: input.dataTo }] : []),
        { label: "File", value: input.isDemo ? `${input.fileName} (demo data)` : input.fileName },
        { label: "Made", value: input.generatedAt },
      ];
      const bytes = await engine().exportXlsx({
        filters: s.filters(),
        kpis: [...input.hero, ...input.supporting].map(({ meta }) => ({
          id: meta.id,
          name: meta.name,
          format: meta.format,
          definition: meta.definition,
          ...(meta.unavailableReason ? { unavailableReason: meta.unavailableReason } : {}),
        })),
        charts: input.charts.map((c) => ({ id: c.spec.id, title: c.spec.title })),
        title,
        subtitle: input.subtitle,
        facts,
        numberLocale: locale,
      });
      downloadBlob(
        new Blob([bytes as BlobPart], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        name("dashboard", "xlsx"),
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMaking(false);
    }
  };
  if (!summary) return null;
  const headers = profile?.columns.map((c) => c.name) ?? [];
  return (
    <GalleryCard
      alone={alone}
      title="Excel and data"
      line="Your dashboard in Excel, or every cleaned row."
      full="An Excel workbook with the dashboard's KPIs, a sheet of values for each chart, the rows behind them (the dashboard's period and filters) and the data dictionary, in Excel's own number and date formats. Or the whole cleaned file as a CSV, with your own headers, and the dictionary on its own."
      formats={["XLSX", "CSV"]}
      // Only when the headers and the rows line up (the same columns, in the same order).
      preview={
        <DataPreview headers={headers} rows={rows && rows[0]?.length === headers.length ? rows : null} />
      }
      fact={`Excel: ${charts.length} chart${charts.length === 1 ? "" : "s"}, ${formatCount(viewRows ?? summary.rowCount, locale)} rows · CSV: all ${formatCount(summary.rowCount, locale)}`}
      actions={
        <>
          <Button
            variant="secondary"
            className="min-w-0 flex-1 px-3"
            onClick={() => void excel()}
            disabled={making}
            aria-label=".xlsx: Excel workbook"
          >
            <DownloadIcon busy={making} /> Excel
          </Button>
          <Button
            variant="secondary"
            className="min-w-0 flex-1 px-3"
            onClick={() => void data()}
            aria-label=".csv: Cleaned data"
          >
            <Download aria-hidden /> CSV
          </Button>
          <Button
            variant="secondary"
            className="min-w-0 flex-1 px-3"
            onClick={() => void dictionary()}
            aria-label=".csv: Data dictionary"
          >
            <Download aria-hidden /> Dictionary
          </Button>
        </>
      }
    />
  );
}

/** What the settings file remembers, in the dashboard's own words: the facts its preview lists. */
function useSettingsFacts(): Array<{ label: string; value: string }> {
  const context = useWorkspace((s) => s.context);
  const widgets = useWorkspace((s) => s.widgets);
  const customCharts = useWorkspace((s) => s.customCharts);
  const mode = useWorkspace((s) => s.mode);
  const datePreset = useWorkspace((s) => s.datePreset);
  const customRange = useWorkspace((s) => s.customRange);
  const filters = useWorkspace((s) => s.dimFilters.length);
  const chartTheme = useSettings((s) => s.chartTheme);
  return React.useMemo(() => {
    if (!context) return [];
    const shape = context.domain.subDomains.find((x) => x.id === context.subDomainId)?.name;
    // The charts the dashboard shows now, counted as Customise counts them.
    const specs = allSpecs({ context, customCharts });
    const shown = widgets.filter(
      (w) => !w.hidden && specs.find((x) => x.id === w.id)?.modes.includes(mode),
    ).length;
    const period =
      datePreset === "custom" && customRange
        ? formatRange(customRange.from, customRange.to)
        : PRESET_LABEL[datePreset];
    return [
      { label: "Industry", value: [context.domain.name, shape].filter(Boolean).join(" · ") },
      { label: "Charts", value: `${shown} on the dashboard` },
      {
        label: "Period",
        value: `${period} · ${filters ? `${filters} filter${filters === 1 ? "" : "s"}` : "no filters"}`,
      },
      { label: "Colours", value: resolveTheme(chartTheme).name },
    ];
  }, [context, widgets, customCharts, mode, datePreset, customRange, filters, chartTheme]);
}

/** Save the dashboard's setup (no data rows) and load it again with the same file. */
function SettingsCard() {
  const applyConfig = useWorkspace((s) => s.applyConfig);
  const summary = useWorkspace((s) => s.summary);
  const profile = useWorkspace((s) => s.profile);
  const facts = useSettingsFacts();
  const input = React.useRef<HTMLInputElement>(null);
  const download = () => {
    const cfg = buildConfig();
    if (!cfg) return;
    downloadBlob(
      JSON.stringify(cfg, null, 2),
      exportFileName(summary?.name, "loupe-config", "json"),
      "application/json",
    );
  };
  const load = async (file: File | undefined) => {
    if (!file || !summary || !profile) return;
    const { config, error } = parseConfig(await file.text());
    if (!config) {
      toast.error(error ?? "That isn't a Loupe settings file");
      return;
    }
    const check = compareFingerprints(
      config.fingerprint,
      fingerprintOf(
        summary.fileName,
        summary.rowCount,
        profile.columns.map((c) => ({ name: c.name, type: c.storage })),
      ),
    );
    if (!check.ok) {
      toast.error(`These settings were made for a different file. ${check.problems.slice(0, 2).join(" ")}`);
      return;
    }
    await applyConfig(config);
    toast.success(check.exact ? "Dashboard restored" : `Dashboard restored. ${check.problems[0] ?? ""}`);
  };
  return (
    <GalleryCard
      layout="wide"
      title="Reopen this dashboard later"
      line="Settings only, no data rows."
      full="Save the dashboard's settings: the industry, your column choices, KPIs, charts, period, filters and colours. Load them with the same file to pick up where you left off. No data rows are inside."
      formats={["JSON"]}
      preview={<SettingsPreview items={facts} />}
      actions={
        <>
          <Button variant="secondary" onClick={download}>
            <Download aria-hidden /> Save settings
          </Button>
          <Button variant="ghost" onClick={() => input.current?.click()}>
            <Upload aria-hidden /> Load
          </Button>
          {/* Reached through the Load button, so it takes no tab stop of its own. */}
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            tabIndex={-1}
            aria-label="Load Loupe settings"
            onChange={(e) => void load(e.target.files?.[0])}
          />
        </>
      }
    />
  );
}
