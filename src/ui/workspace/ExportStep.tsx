"use client";

/**
 * Step 8, Export. Only the exports people use, in three groups:
 *
 * - Share: the dashboard report (PDF: cover, KPIs, numbered figures,
 *   glossary), the dashboard image (PNG, every chart) and the insights (PDF).
 * - Build on it: the Power BI package (zip: semantic model, DAX, data, build
 *   guide), the SQL file (with the same SQL and DAX in colour to read, the
 *   business questions as a PDF once some were asked, and verification of
 *   every KPI query against the data in DuckDB-WASM), and the data itself
 *   (cleaned CSV, data dictionary).
 * - A settings bar to save and reload the dashboard's setup (no data rows).
 *
 * Each card says what it holds in a line and carries a real fact about it
 * (pages, charts, insights, rows), computed from the dashboard, never made up.
 * The Power BI package and the SQL & DAX page are built from the file's own
 * columns; when one would add a column (a date-only copy of a datetime, a
 * calculated hour or weekday), the user is asked first (powerBiConsent).
 * Files that are already inside the package (measures.dax, the Markdown
 * dictionary) are not offered again on their own.
 */
import * as React from "react";
import {
  BadgeCheck,
  BookText,
  CheckCircle2,
  Database,
  Download,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  Lightbulb,
  Loader2,
  Palette,
  Settings2,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatBytes, formatCount, formatValue } from "@/engine/core/format";
import { formatRange, formatDay } from "@/engine/core/dates";
import { PRESET_LABEL } from "@/engine/core/periods";
import { describeFilter } from "@/engine/query/filter";
import { compareFingerprints, fingerprintOf, parseConfig, type LoupeConfig } from "@/engine/export/config";
import type { PackageManifest } from "@/engine/export/powerbi";
import { UTF8_BOM } from "@/engine/export/csv";
import { allSpecs, stepNumber, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { powerBiTheme, resolveTheme } from "@/ui/charts/palette/themes";
import { engine } from "@/lib/engine-client";
import { cn, downloadBlob, downloadDataUrl, exportFileName } from "@/lib/utils";
import type { VerificationResult } from "@/lib/duckdb";
import { Button } from "@/ui/primitives/button";
import { Eyebrow } from "@/ui/primitives/misc";
import { useFmt } from "@/ui/common/hooks";
import { FileIdentity } from "./FileIdentity";
import { exportDashboardPng, exportPdf, type ReportChart, type ReportInput } from "./export/report";
import { exportInsightsPdf, exportSqlPdf } from "./export/documents";
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

/**
 * The charts the report and the image hold: those visible in the current
 * layout that have been computed, in dashboard order. The card counts and the
 * exports both read it, so "24 charts" is exactly what the file contains.
 */
function reportCharts(s: ReturnType<typeof useWorkspace.getState>): ReportChart[] {
  const specs = allSpecs(s);
  return s.widgets
    .filter((w) => !w.hidden && specs.find((x) => x.id === w.id)?.modes.includes(s.mode))
    .map((w) => {
      const spec = specs.find((x) => x.id === w.id);
      const data = s.charts[w.id];
      // Wider than 6 of the 12 grid columns: the PNG gives it a whole row, as the dashboard does.
      return spec && data ? { spec, data, kind: w.kind ?? spec.kind, wide: (w.w ?? spec.size.w) > 6 } : null;
    })
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
}

function useReportInput(): () => ReportInput | null {
  const fmt = useFmt();
  return React.useCallback(() => {
    const s = useWorkspace.getState();
    const ctx = s.context;
    if (!ctx || !s.summary) return null;
    const metas = new Map(ctx.kpis.map((k) => [k.id, k]));
    const values = new Map(s.kpiBatch?.values.map((v) => [v.id, v]) ?? []);
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
      hero: ctx.selection.hero
        .map((id) => ({
          meta: metas.get(id) as NonNullable<ReturnType<typeof metas.get>>,
          value: values.get(id),
        }))
        .filter((x) => x.meta),
      supporting: ctx.selection.supporting
        .map((id) => ({
          meta: metas.get(id) as NonNullable<ReturnType<typeof metas.get>>,
          value: values.get(id),
        }))
        .filter((x) => x.meta),
      insights: s.insights ?? [],
      charts: reportCharts(s),
      health: s.health,
      fmt,
    };
  }, [fmt]);
}

export function buildConfig(): LoupeConfig | null {
  const s = useWorkspace.getState();
  const settings = useSettings.getState();
  if (!s.summary || !s.profile || !s.domainId) return null;
  return {
    app: "loupe",
    version: 1,
    createdAt: new Date().toISOString(),
    fingerprint: fingerprintOf(
      s.summary.fileName,
      s.summary.rowCount,
      s.profile.columns.map((c) => ({ name: c.name, type: c.storage })),
    ),
    domainId: s.domainId,
    subDomainId: s.subDomainId ?? undefined,
    business: s.business,
    mappingOverrides: s.mappingOverrides,
    classOverrides: s.classOverrides,
    roleOverrides: s.roleOverrides,
    hiddenColumns: s.hiddenColumns,
    customKpis: s.customKpis,
    ...(s.kpiLayout ? { kpiLayout: s.kpiLayout } : {}),
    kpiRenames: s.kpiRenames,
    kpiTargets: s.kpiTargets,
    dashboard: {
      mode: s.mode,
      widgets: s.widgets.map((w) => ({
        id: w.id,
        kind: w.kind,
        w: w.w,
        h: w.h,
        hidden: w.hidden,
        ...(w.title ? { title: w.title } : {}),
        topN: w.topN,
      })),
      customCharts: s.customCharts,
      datePreset: s.datePreset,
      filters: s.filters(),
    },
    settings: {
      chartTheme: settings.chartTheme,
      numberLocale: settings.numberLocale,
      currency: settings.currencyOverride ?? s.context?.currency ?? "INR",
    },
  };
}

export function ExportStep() {
  const context = useWorkspace((s) => s.context);
  const summary = useWorkspace((s) => s.summary);
  if (!context || !summary) return null;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <Eyebrow>Step {stepNumber("export")} · Export</Eyebrow>
          <h1 className="mt-2 font-display text-display-sm text-fg">Take it anywhere.</h1>
          <p className="mt-2 text-ui text-fg-muted">Same numbers as the dashboard, in every file.</p>
        </div>
        <div className="flex min-w-0 flex-col items-start gap-1.5 sm:items-end">
          <FileIdentity summary={summary} size="sm" />
          <span className="inline-flex items-center gap-1.5 text-2xs text-fg-subtle">
            <ShieldCheck className="size-3.5 text-success" aria-hidden /> Made in this tab · nothing uploaded
          </span>
        </div>
      </header>

      <Section id="export-share" title="Share">
        <div className="grid gap-4 md:grid-cols-3">
          <ReportTile />
          <ImageTile />
          <InsightsTile />
        </div>
      </Section>

      <Section id="export-build" title="Build on it" className="mt-10">
        <div className="grid gap-4 lg:grid-cols-3">
          <PowerBiPanel />
          <div className="grid gap-4">
            <SqlPanel />
            <DataPanel />
          </div>
        </div>
      </Section>

      <SettingsBar />
    </div>
  );
}

/** A group of exports: a quiet label and a hairline, as the dashboard's sections. */
function Section({
  id,
  title,
  className,
  children,
}: {
  id: string;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={className}>
      <div className="mb-3 flex items-center gap-3">
        <h2 id={id} className="text-2xs font-medium tracking-[0.14em] text-fg-subtle uppercase">
          {title}
        </h2>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>
      {children}
    </section>
  );
}

/** The file type in a small pill ("PDF", "ZIP"), top right of a card. */
function TypePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border-strong px-2 py-0.5 font-mono text-[10.5px] tracking-[0.08em] text-fg-subtle uppercase">
      {children}
    </span>
  );
}

/** The icon in its tinted square, shared by every card. */
function TileIcon({
  icon: Icon,
  large,
}: {
  icon: React.ComponentType<{ className?: string }>;
  large?: boolean;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-[12px] border border-border-accent bg-accent-soft",
        large ? "size-12" : "size-11",
      )}
    >
      <Icon className={cn("text-accent", large ? "size-[22px]" : "size-5")} />
    </span>
  );
}

/**
 * Shared surface of the export cards: lifts a little on hover and glows
 * faintly in its corner. Clipped, not hidden: an overflow-hidden box can be
 * scrolled, so focusing a button inside slid the content under the glow.
 */
const SURFACE =
  "group relative flex flex-col overflow-clip rounded-card border border-border bg-surface-1 shadow-card transition-[border-color,box-shadow,transform] duration-200 hover:border-border-accent motion-safe:hover:-translate-y-0.5";

function CornerGlow() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -top-20 -right-20 size-48 rounded-full bg-[radial-gradient(closest-side,var(--spot),transparent)] opacity-60 transition-opacity duration-300 group-hover:opacity-100"
    />
  );
}

/**
 * One export in the Share row: icon and type, a title, one line on what it
 * holds, a fact about it, and its download button, which shows progress
 * while the file is made.
 */
function Tile({
  icon,
  type,
  title,
  line,
  fact,
  action,
  busy,
  onAction,
}: {
  icon: React.ComponentType<{ className?: string }>;
  type: string;
  title: string;
  line: string;
  fact: React.ReactNode;
  action: string;
  /** Progress text while the file is being made. */
  busy: string | null;
  onAction: () => void;
}) {
  return (
    <article className={cn(SURFACE, "p-5")}>
      <CornerGlow />
      <div className="relative flex items-start justify-between">
        <TileIcon icon={icon} />
        <TypePill>{type}</TypePill>
      </div>
      <h3 className="relative mt-4 text-[15px] font-medium tracking-[-0.01em] text-fg">{title}</h3>
      <p className="relative mt-1 text-ui leading-relaxed text-fg-muted">{line}</p>
      <p className="tabular relative mt-3 text-2xs text-fg-subtle">{fact}</p>
      <div className="relative mt-auto pt-5">
        <Button
          variant="secondary"
          className="w-full"
          onClick={onAction}
          disabled={Boolean(busy)}
          aria-label={`${action}: ${title}`}
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
          <span className="truncate">{busy ?? action}</span>
        </Button>
      </div>
    </article>
  );
}

/** Dashboard report: the analyst's PDF (cover, KPIs, summary, numbered figures, glossary). */
function ReportTile() {
  const build = useReportInput();
  const summary = useWorkspace((s) => s.summary);
  const loadInsights = useWorkspace((s) => s.loadInsights);
  // Cover, two figures a page, appendix: the same count exportPdf lays out.
  const pages = useWorkspace((s) => 2 + Math.ceil(reportCharts(s).length / 2));
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = async () => {
    setBusy("Preparing…");
    try {
      if (!useWorkspace.getState().insights) await loadInsights();
      const input = build();
      if (!input) return;
      await exportPdf(input, exportFileName(summary?.name, "dashboard-report", "pdf"), setBusy);
      toast.success("Dashboard report downloaded");
    } catch (e) {
      toast.error(`The PDF couldn't be made: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Tile
      icon={FileText}
      type="PDF"
      title="Dashboard report"
      line="Cover, KPIs, numbered figures, glossary."
      fact={`A4 · ${pages} pages`}
      action="Download PDF"
      busy={busy}
      onAction={() => void run()}
    />
  );
}

/** Dashboard image: every chart in one picture, for a slide or an email. */
function ImageTile() {
  const build = useReportInput();
  const summary = useWorkspace((s) => s.summary);
  const charts = useWorkspace((s) => reportCharts(s).length);
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = async () => {
    const input = build();
    if (!input) return;
    setBusy("Rendering…");
    try {
      const url = await exportDashboardPng(input, false);
      downloadDataUrl(url, exportFileName(summary?.name, "dashboard", "png"));
      toast.success("Dashboard image downloaded");
    } catch (e) {
      toast.error(`The image couldn't be made: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Tile
      icon={FileImage}
      type="PNG"
      title="Dashboard image"
      line="Every chart in one high-resolution picture."
      fact={`${charts} ${charts === 1 ? "chart" : "charts"} · light theme`}
      action="Download PNG"
      busy={busy}
      onAction={() => void run()}
    />
  );
}

/** Insights: what the data says, ranked, each with its chart. */
function InsightsTile() {
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
      // Every computed chart, so an insight can show its chart even when it is hidden in this layout.
      const charts = new Map(
        allSpecs(s)
          .filter((sp) => s.charts[sp.id])
          .map((sp) => [
            sp.id,
            {
              spec: sp,
              data: s.charts[sp.id] as NonNullable<(typeof s.charts)[string]>,
              kind: s.widgets.find((w) => w.id === sp.id)?.kind ?? sp.kind,
            },
          ]),
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
    <Tile
      icon={Lightbulb}
      type="PDF"
      title="Insights"
      line="What the data says, ranked, each with its chart."
      fact={
        insights
          ? `${insights.length} ${insights.length === 1 ? "insight" : "insights"}`
          : "Found and ranked on download"
      }
      action="Download PDF"
      busy={busy}
      onAction={() => void run()}
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
 * The package's files as one list to read: top-level files one by one, each
 * folder (the semantic model) as a single line with its file count and size.
 */
function packageLines(manifest: PackageManifest): Array<{ path: string; bytes: number; files: number }> {
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

/** The featured export: the Power BI package. */
function PowerBiPanel() {
  const [busy, setBusy] = React.useState(false);
  const [manifest, setManifest] = React.useState<PackageManifest | null>(null);
  const summary = useWorkspace((s) => s.summary);
  const consent = useColumnConsent();
  const generate = async () => {
    const cfg = buildConfig();
    if (!cfg) return;
    setBusy(true);
    try {
      const s = useWorkspace.getState();
      const specs = allSpecs(s).filter((x) => x.source !== "custom");
      const visible = s.widgets
        .filter((w) => !w.hidden && specs.find((x) => x.id === w.id)?.modes.includes(s.mode))
        .map((w) => w.id);
      const extra = await engine().powerBiNewColumns(visible);
      const add = await consent.ask(powerBiConsent(extra, "Power BI package"));
      if (add === null) return;
      // The chart colours travel as a Power BI report theme, so the report can match the dashboard.
      const theme = resolveTheme(useSettings.getState().chartTheme);
      // The zip and the folder inside it share one name, so an unzipped package says what it is.
      const zipName = exportFileName(summary?.name, "powerbi-package", "zip");
      const out = await engine().exportPowerBi(
        JSON.stringify(cfg, null, 2),
        visible,
        !add,
        { name: theme.name, json: powerBiTheme(theme) },
        zipName.replace(/\.zip$/, ""),
      );
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
    <article className={cn(SURFACE, "border-border-accent p-6 lg:col-span-2")}>
      <CornerGlow />
      {consent.dialog}
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <TileIcon icon={FileArchive} large />
          <div>
            <h3 className="text-[17px] font-medium tracking-[-0.01em] text-fg">Power BI package</h3>
            <p className="mt-1 text-ui leading-relaxed text-fg-muted">
              Everything to rebuild this dashboard in Power BI Desktop in about five minutes.
            </p>
          </div>
        </div>
        <TypePill>ZIP</TypePill>
      </div>

      {manifest ? (
        <div className="relative mt-5 rounded-card border border-border bg-surface-2/60">
          <p className="flex items-center gap-1.5 border-b border-border px-3.5 py-2 text-2xs text-fg-muted">
            <CheckCircle2 className="size-3.5 text-success" aria-hidden /> Downloaded: {manifest.files.length}{" "}
            files, {formatBytes(manifest.totalBytes)} compressed
          </p>
          <ul className="grid gap-x-6 px-3.5 py-2 sm:grid-cols-2">
            {packageLines(manifest).map((f) => (
              <li key={f.path} className="flex items-center justify-between gap-3 py-1 text-2xs">
                <span className="font-figures truncate text-fg" title={f.path}>
                  {f.path}
                  {f.files > 1 ? <span className="text-fg-subtle"> · {f.files} files</span> : null}
                </span>
                <span className="font-figures shrink-0 text-fg-subtle">{formatBytes(f.bytes)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul className="relative mt-5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {PACKAGE_PARTS.map((t) => (
            <li key={t} className="flex items-center gap-2 text-ui text-fg">
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
              {t}
            </li>
          ))}
        </ul>
      )}

      <ol className="relative mt-6 grid gap-3 sm:grid-cols-3" aria-label="How to use it">
        {PACKAGE_STEPS.map((step, i) => (
          <li key={step.title} className="rounded-[12px] border border-border bg-surface-2/60 p-3.5">
            <span className="font-figures grid size-6 place-items-center rounded-full border border-border-accent bg-accent-soft text-2xs text-accent">
              {i + 1}
            </span>
            <p className="mt-2.5 text-ui font-medium text-fg">{step.title}</p>
            <p className="mt-0.5 text-2xs leading-relaxed text-fg-subtle">{step.line}</p>
          </li>
        ))}
      </ol>

      <div className="relative mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-6">
        <Button variant="primary" size="lg" onClick={() => void generate()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />} Download
          package
        </Button>
        <p className="max-w-xs text-2xs leading-relaxed text-fg-subtle">
          A project package, not a .pbix: only Power BI Desktop can write that file. Built from your columns;
          you&apos;re asked before anything is added.
        </p>
      </div>
    </article>
  );
}

/** A file row inside a panel: what it is, a fact, and its download. */
function FileRow({
  icon: Icon,
  title,
  fact,
  action,
  onAction,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  fact: React.ReactNode;
  action: string;
  onAction: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <Icon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-ui text-fg">{title}</p>
          <p className="tabular truncate text-2xs text-fg-subtle">{fact}</p>
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={onAction}
        disabled={disabled}
        aria-label={`${action}: ${title}`}
      >
        <Download aria-hidden /> {action}
      </Button>
    </div>
  );
}

/** A side panel in "Build on it": icon, title and type, then its files. */
function Panel({
  icon,
  title,
  type,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  type: string;
  children: React.ReactNode;
}) {
  return (
    <article className={cn(SURFACE, "p-5")}>
      <CornerGlow />
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <TileIcon icon={icon} />
          <h3 className="text-[15px] font-medium tracking-[-0.01em] text-fg">{title}</h3>
        </div>
        <TypePill>{type}</TypePill>
      </div>
      <div className="relative mt-3 divide-y divide-border">{children}</div>
    </article>
  );
}

/**
 * SQL: the file (every KPI as a view), the same SQL and DAX in colour to read
 * in a browser, the business questions as a PDF once some were asked, and a
 * check that every KPI query returns the dashboard's number in DuckDB.
 */
function SqlPanel() {
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
  // One view per KPI: monthly views and analyses don't count.
  const views = sql
    ? [...sql.matchAll(/^CREATE VIEW "(kpi_[^"]+)"/gm)].filter(
        (m) => !/_monthly(_base)?$/.test(m[1] as string),
      ).length
    : 0;
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
      toast[ok === r.length ? "success" : "warning"](`${ok} of ${r.length} KPI queries match the dashboard`);
    } catch (e) {
      toast.error(`DuckDB couldn't start: ${(e as Error).message}`);
    } finally {
      setStatus(null);
    }
  };
  const fmtKpi = (id: string, v: number | null) =>
    formatValue(v, context?.kpis.find((x) => x.id === id)?.format ?? "number", fmt);
  const matched = results?.filter((r) => r.match).length ?? 0;
  return (
    <Panel icon={FileCode2} title="SQL" type="SQL">
      {consent.dialog}
      <FileRow
        icon={Database}
        title="KPI views"
        fact={sql ? `${views} ${views === 1 ? "view" : "views"}, one per KPI` : "Writing…"}
        action=".sql"
        disabled={!sql}
        onAction={() =>
          sql && downloadBlob(sql, exportFileName(summary?.name, "kpis", "sql"), "application/sql")
        }
      />
      <FileRow
        icon={Palette}
        title="SQL and DAX in colour"
        fact="To read in a browser"
        action=".html"
        onAction={() => void downloadHtml()}
      />
      {questions.length ? (
        <FileRow
          icon={FileText}
          title="Your questions with their SQL"
          fact={`${questions.length} ${questions.length === 1 ? "question" : "questions"} answered`}
          action=".pdf"
          disabled={pdfBusy}
          onAction={() => void downloadQuestions()}
        />
      ) : null}
      <div className="pt-3">
        {results ? (
          <details className="group/v">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-2xs text-fg-muted select-none">
              {matched === results.length ? (
                <CheckCircle2 className="size-4 text-success" aria-hidden />
              ) : (
                <XCircle className="size-4 text-danger" aria-hidden />
              )}
              <span>
                {matched} of {results.length} KPI queries return the dashboard&apos;s numbers
              </span>
              <span className="ml-auto text-fg-subtle underline-offset-2 group-open/v:hidden hover:underline">
                Details
              </span>
            </summary>
            <table className="mt-2 w-full text-2xs">
              <thead className="text-left text-fg-subtle">
                <tr>
                  <th className="py-1 font-medium">KPI</th>
                  <th className="py-1 text-right font-medium">Dashboard</th>
                  <th className="py-1 text-right font-medium">DuckDB</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-1 pr-2 text-fg">{r.name}</td>
                    <td className="font-figures py-1 text-right text-fg">{fmtKpi(r.id, r.engine)}</td>
                    <td
                      className={cn("font-figures py-1 text-right", r.match ? "text-fg" : "text-danger")}
                      title={r.error}
                    >
                      {r.error ? "error" : fmtKpi(r.id, r.duckdb)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="-ml-2"
            onClick={() => void verify()}
            disabled={Boolean(status)}
          >
            {status ? <Loader2 className="animate-spin" aria-hidden /> : <BadgeCheck aria-hidden />}
            {status ?? "Verify against your data"}
          </Button>
        )}
      </div>
    </Panel>
  );
}

/** Data: the cleaned file (your headers, tidied values) and what each column means. */
function DataPanel() {
  const summary = useWorkspace((s) => s.summary);
  const locale = useSettings((s) => s.numberLocale);
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
  if (!summary) return null;
  return (
    <Panel icon={FileSpreadsheet} title="Data" type="CSV">
      <FileRow
        icon={FileSpreadsheet}
        title="Cleaned data"
        fact={`${formatCount(summary.rowCount, locale)} rows · your headers`}
        action=".csv"
        onAction={() => void data()}
      />
      <FileRow
        icon={BookText}
        title="Data dictionary"
        fact={`${summary.columnCount} columns described`}
        action=".csv"
        onAction={() => void dictionary()}
      />
    </Panel>
  );
}

/** Save the dashboard's setup (no data rows) and load it again with the same file. */
function SettingsBar() {
  const applyConfig = useWorkspace((s) => s.applyConfig);
  const summary = useWorkspace((s) => s.summary);
  const profile = useWorkspace((s) => s.profile);
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
    <section
      aria-label="Dashboard settings"
      className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-card border border-border bg-surface-1 px-5 py-4"
    >
      <div className="flex min-w-0 items-center gap-3">
        <TileIcon icon={Settings2} />
        <div className="min-w-0">
          <p className="text-ui font-medium text-fg">Reopen this dashboard later</p>
          <p className="text-2xs text-fg-subtle">
            Save its settings, then load them with the same file. No data rows are inside.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={download}>
          <Download aria-hidden /> Save settings
        </Button>
        <Button size="sm" variant="ghost" onClick={() => input.current?.click()}>
          <Upload aria-hidden /> Load
        </Button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          aria-label="Load Loupe settings"
          onChange={(e) => void load(e.target.files?.[0])}
        />
      </div>
    </section>
  );
}
