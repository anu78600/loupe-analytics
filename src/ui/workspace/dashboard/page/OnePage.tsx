"use client";

/**
 * The one-page dashboard: the dashboard as a single landscape page, laid out
 * the way analysts build a report page for an executive (version 50.3):
 *
 * - A banner with the page's title (renamable), what it covers, the dates
 *   the period spans and where the numbers come from.
 * - A bar of filter pills under it (PageFilters.tsx): the period and the main
 *   filters, "Clear all", and what the changes compare with.
 * - Six headline KPIs (PageKpi.tsx), each with an icon for its kind of
 *   measure, its value, its change and its trend as a sparkline.
 * - Four charts from the dashboard as a bento (pagePlan.ts picks and places
 *   them: the lead across two thirds of the width, its companion beside it,
 *   two breakdowns under them), each led by its takeaway (PageChart.tsx),
 *   with the key insights in a column beside them (PageInsights.tsx).
 *
 * In the app the page is live: the pills filter everything, charts have
 * tooltips and their actions on hover, the title can be renamed, and on a
 * large screen the page keeps a 16:9 shape that fits the window (it stacks
 * below lg: banner, filters, KPIs two to a row, charts, insights). The same
 * component renders off-screen at 1280 × 720 for the download
 * (exportOnePage), so the image is the page on the screen, with the pills
 * as static selections and no hover controls. Every figure is the
 * dashboard's own: nothing here computes a number.
 *
 * At 1280 × 720 the KPI row takes about 160 px and each chart row about
 * 190 px. The insights column takes a fifth of the width, which is why the
 * page holds four charts rather than five (PAGE_CHARTS says more).
 *
 * The page is never a blank area: when the industry's own KPIs or charts give
 * it nothing, or the industry explains few of the file's columns
 * (ContextResult.fit), the ones made from the other columns fill it after the
 * industry's own; the full dashboard holds those in "From your other columns".
 *
 * A dashboard designed from the data (generic, or an industry that fits few
 * columns) is titled from the data (ContextResult.understanding.title:
 * "Wine quality analysis") and its charts follow the plan's ranking
 * (ContextResult.plan): the most telling chart leads. An industry that fits
 * strongly keeps its own title and order.
 */
import * as React from "react";
import { CalendarRange } from "lucide-react";
import type { Insight } from "@/engine/insights/insights";
import type { KpiValue } from "@/engine/kpi/compute";
import type { KpiMeta } from "@/engine/session";
import { formatRange, formatDay } from "@/engine/core/dates";
import { formatCount, type FormatOptions } from "@/engine/core/format";
import { PRESET_LABEL } from "@/engine/core/periods";
import { friendly } from "@/engine/core/labels";
import { allSpecs, isRosterView, kpiLayoutOf, useWorkspace } from "@/store/workspace";
import { cn, downloadBlob, exportFileName } from "@/lib/utils";
import { useFmt } from "@/ui/common/hooks";
import { DomainIcon } from "@/ui/common/domain-icon";
import { ClampText, InfoTip } from "@/ui/primitives/reveal";
import { orderByGoal, sharedComparison } from "../KpiCards";
import { renderOffscreen } from "../../export/report";
import { PageChartCard, type ChartSource } from "./PageChart";
import { PageFilterBar } from "./PageFilters";
import { PageInsights } from "./PageInsights";
import { PageKpiTile } from "./PageKpi";
import {
  dataLed,
  defaultPageTitle,
  PAGE_CHARTS,
  pageKpiIds,
  pageSubtitle,
  pickPageCharts,
  placeCharts,
  planRank,
  yearOf,
  type PlacedChart,
} from "./pagePlan";

/** The page's size when drawn for a download (16:9); the image is three times this. */
export const PAGE_W = 1280;
export const PAGE_H = 720;

type State = ReturnType<typeof useWorkspace.getState>;

/** The workspace slices the page reads. */
type PageState = Pick<
  State,
  | "context"
  | "summary"
  | "kpiBatch"
  | "charts"
  | "widgets"
  | "customCharts"
  | "insights"
  | "datePreset"
  | "customRange"
  | "dimFilters"
  | "lastCompute"
  | "kpiLayout"
  | "extraKpis"
  | "business"
  | "kpiTargets"
>;

export interface PageModel {
  title: string;
  /** True when the title is the automatic one (shown until the user names the page). */
  autoTitle: boolean;
  subtitle: string;
  industry: { name: string; icon: string; shape: string | null };
  /** True when the page is designed from the data rather than led by an industry's template. */
  dataLed: boolean;
  /** "Last 12 months", "2025", or a custom range. */
  periodLabel: string;
  /** The dates the period covers, "1 Oct 2025 – 30 Sep 2026". */
  periodRange: string | null;
  /** True when the data has a date column to choose a period by. */
  hasDates: boolean;
  /**
   * What the changes compare with, as the filter bar says it ("Change vs 1
   * Oct 2024 – 30 Sep 2025", "Change: Sep 2026 vs Sep 2025"), or why there
   * are no changes ("All employees in the file · no period comparison").
   */
  comparison: string | null;
  /** The comparison most KPIs share, so a tile says "vs prev." rather than repeating it. */
  shared: { label: string; current: string } | null;
  /** The no-change reason the bar states once, so a KPI tile doesn't repeat it. */
  sharedReason: string | undefined;
  dataTo: string | null;
  /** Dimension filters: the first four, plus any other that is set. */
  slicers: Array<{ column: string; label: string; values: string[] }>;
  kpis: Array<{ meta: KpiMeta; value: KpiValue | undefined }>;
  /** The user's targets for the KPIs on the page, by KPI id. */
  targets: Record<string, number>;
  /** A roster (one row per employee, customer…): the KPI tiles draw no trend line. */
  roster: boolean;
  charts: PlacedChart[];
  insights: Insight[];
  /** How many insights the dashboard has in all. */
  insightsTotal: number;
  /**
   * True once the insights for this selection have been looked for, so a page with none says that
   * none stood out rather than that it is still looking.
   */
  insightsReady: boolean;
  fileName: string;
  /** "28,621 of 49,037 rows" or "49,037 rows". */
  rows: string;
  isDemo: boolean;
  fmt: FormatOptions;
}

/**
 * The page from the workspace: the dashboard's own KPIs, charts and insights,
 * chosen and placed for one page. `title` is the user's name for the page.
 */
export function pageModel(s: PageState, fmt: FormatOptions, title?: string | null): PageModel | null {
  const ctx = s.context;
  if (!ctx || !s.summary) return null;
  const metas = new Map(ctx.kpis.map((k) => [k.id, k]));
  const values = new Map(s.kpiBatch?.values.map((v) => [v.id, v]) ?? []);
  const layout = kpiLayoutOf(s);
  // The user's own order stands as set; the recommended heroes follow the user's main goal.
  const hero = s.kpiLayout ? layout.hero : orderByGoal(layout.hero, metas, s.business.goal);
  const own = pageKpiIds(hero, layout.supporting);
  // An industry that fits few of the columns leaves the row short, or empty: the KPIs from the
  // other columns fill it after the industry's own.
  const fill = ctx.fit.weak;
  const kpis = (fill || !own.length ? pageKpiIds(own, layout.columns) : own)
    .map((id) => metas.get(id))
    .filter((m): m is KpiMeta => Boolean(m))
    .map((meta) => ({ meta, value: values.get(meta.id) }));
  const shape = ctx.domain.subDomains.find((x) => x.id === ctx.subDomainId)?.name ?? null;
  const roster = isRosterView(ctx);
  const year = s.datePreset === "custom" ? yearOf(s.customRange) : null;
  // Without dates there is no period to choose: every row counts, and the pill says so (as live).
  const hasDates = Boolean(ctx.dateColumn && ctx.dateBounds);
  const periodLabel = !hasDates
    ? "All rows"
    : year
      ? String(year)
      : s.datePreset === "custom" && s.customRange
        ? formatRange(s.customRange.from, s.customRange.to)
        : PRESET_LABEL[s.datePreset];
  const shared = s.kpiBatch ? sharedComparison(s.kpiBatch.values) : null;
  const filtered = new Map(
    s.dimFilters.filter((f) => f.kind === "in").map((f) => [f.column, f.kind === "in" ? f.values : []]),
  );
  const dims = ctx.dimensions;
  const shown = [...dims.slice(0, 4), ...dims.slice(4).filter((d) => filtered.has(d.column))];
  const inView = s.lastCompute?.rows;
  const targets: Record<string, number> = {};
  for (const k of kpis) {
    const t = s.kpiTargets[k.meta.id];
    if (typeof t === "number" && Number.isFinite(t)) targets[k.meta.id] = t;
  }
  return {
    title:
      title?.trim() ||
      defaultPageTitle(ctx.domain.name, {
        generic: ctx.domain.generic,
        roster,
        weak: ctx.fit.weak,
        understood: ctx.understanding?.title,
      }),
    autoTitle: !title?.trim(),
    subtitle: pageSubtitle(
      kpis.map((k) => k.meta.group),
      shape ?? ctx.domain.name,
    ),
    industry: { name: ctx.domain.name, icon: ctx.domain.icon, shape },
    dataLed: dataLed(ctx),
    periodLabel,
    periodRange: s.kpiBatch?.period?.label ?? null,
    hasDates,
    comparison: !shared
      ? null
      : !shared.changes
        ? shared.label
        : shared.current
          ? `Change: ${shared.current} ${shared.label}`
          : `Change ${shared.label}`,
    shared: shared?.changes ? { label: shared.label, current: shared.current } : null,
    // With no comparison at all (no dates), the bar says "No comparison period" once; the tiles don't
    // repeat it (DeltaChip's own words for that case).
    sharedReason: shared
      ? shared.changes
        ? undefined
        : shared.label
      : s.kpiBatch
        ? "No comparison"
        : undefined,
    dataTo: ctx.dateBounds ? formatDay(ctx.dateBounds.max) : null,
    // Named by the user's own header, as the All charts filter bar names it (FilterBar.tsx), never
    // by the field it was matched to.
    slicers: shown.map((d) => ({
      column: d.column,
      label: friendly(d.column),
      values: filtered.get(d.column) ?? [],
    })),
    kpis,
    targets,
    roster,
    charts: pageCharts(s, fill),
    insights: (s.insights ?? []).slice(0, 3),
    insightsTotal: s.insights?.length ?? 0,
    insightsReady: s.insights !== null,
    fileName: s.summary.fileName,
    rows:
      inView !== undefined && inView !== s.summary.rowCount
        ? `${formatCount(inView, fmt.locale)} of ${formatCount(s.summary.rowCount, fmt.locale)} rows`
        : `${formatCount(s.summary.rowCount, fmt.locale)} rows`,
    isDemo: s.summary.isDemo,
    fmt,
  };
}

/**
 * The page's charts, picked and placed by pagePlan.ts. When the industry's own charts give the page
 * nothing, or the industry fits few of the columns (`fill`), the charts made for the other columns
 * join them: the full dashboard holds those in "From your other columns", which pickPageCharts
 * otherwise keeps off the page. Read as breakdowns, they are picked the same way, after the
 * industry's own charts chosen for executives. A dashboard designed from the data (generic, or
 * `fill`) picks by the plan's ranking instead, so its most telling chart leads.
 */
function pageCharts(s: PageState, fill: boolean): PlacedChart[] {
  const ctx = s.context;
  const specs = allSpecs(s);
  const rank = ctx && dataLed(ctx) ? planRank(ctx.plan) : undefined;
  const own = pickPageCharts(s.widgets, specs, s.charts, PAGE_CHARTS, rank);
  if (own.length && !fill) return placeCharts(own);
  const all = specs.map((x) => (x.section === "columns" ? { ...x, section: "breakdown" as const } : x));
  return placeCharts(pickPageCharts(s.widgets, all, s.charts, PAGE_CHARTS, rank));
}

/** The live page's model, rebuilt when anything it shows changes. */
export function usePageModel(title?: string | null): PageModel | null {
  const fmt = useFmt();
  // Each slice the page reads, so it follows filters, recomputes, renames, targets and insights.
  const context = useWorkspace((s) => s.context);
  const summary = useWorkspace((s) => s.summary);
  const kpiBatch = useWorkspace((s) => s.kpiBatch);
  const charts = useWorkspace((s) => s.charts);
  const widgets = useWorkspace((s) => s.widgets);
  const customCharts = useWorkspace((s) => s.customCharts);
  const insights = useWorkspace((s) => s.insights);
  const datePreset = useWorkspace((s) => s.datePreset);
  const customRange = useWorkspace((s) => s.customRange);
  const dimFilters = useWorkspace((s) => s.dimFilters);
  const lastCompute = useWorkspace((s) => s.lastCompute);
  const kpiLayout = useWorkspace((s) => s.kpiLayout);
  const extraKpis = useWorkspace((s) => s.extraKpis);
  const business = useWorkspace((s) => s.business);
  const kpiTargets = useWorkspace((s) => s.kpiTargets);
  return React.useMemo(
    () =>
      pageModel(
        // prettier-ignore
        { context, summary, kpiBatch, charts, widgets, customCharts, insights, datePreset, customRange, dimFilters, lastCompute, kpiLayout, extraKpis, business, kpiTargets },
        fmt,
        title,
      ),
    // prettier-ignore
    [context, summary, kpiBatch, charts, widgets, customCharts, insights, datePreset, customRange, dimFilters, lastCompute, kpiLayout, extraKpis, business, kpiTargets, fmt, title],
  );
}

// ---------------------------------------------------------------- pieces

function Banner({
  model,
  live,
  onRename,
}: {
  model: PageModel;
  live: boolean;
  onRename?: (title: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const span = model.periodRange ?? (model.hasDates ? model.periodLabel : "All rows");
  const scope = [model.rows, model.dataTo ? `data to ${model.dataTo}` : null].filter(Boolean).join(" · ");
  const source = [model.fileName, model.isDemo ? "demo data, not real" : null].filter(Boolean).join(" · ");
  return (
    <header className="flex min-w-0 flex-wrap items-center justify-between gap-x-8 gap-y-3">
      <div className="flex min-w-0 flex-[1_1_360px] items-center gap-3">
        {/* The industry's mark; a page designed from the data takes a plain chart mark instead. */}
        <span
          className="grid size-10 shrink-0 place-items-center rounded-control border border-border-accent bg-accent-soft"
          title={
            model.dataLed
              ? undefined
              : [model.industry.name, model.industry.shape].filter(Boolean).join(" · ")
          }
        >
          <DomainIcon
            name={model.dataLed ? "bar-chart" : model.industry.icon}
            className="size-5 text-accent"
          />
        </span>
        <div className="min-w-0 flex-1">
          {/* Display type at its smallest size; leading-tight, because truncate clips at the line box
              and would cut descenders. Below lg the live page stacks, so the title wraps there. */}
          {onRename && editing ? (
            <input
              autoFocus
              defaultValue={model.autoTitle ? "" : model.title}
              placeholder={model.title}
              aria-label="Page title"
              onBlur={(e) => {
                onRename(e.currentTarget.value);
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditing(false);
              }}
              className="w-full rounded-control border border-border-accent bg-surface-1 px-2 font-display text-display-xs leading-tight text-fg outline-none"
            />
          ) : onRename ? (
            // The page's one heading: its title, which is also the button that renames it.
            <h1 className="min-w-0">
              <button
                type="button"
                onClick={() => setEditing(true)}
                title="Rename this page"
                className="block max-w-full rounded-control text-left font-display text-display-xs leading-tight text-fg transition-colors duration-fast outline-none hover:text-accent-text focus-visible:focus-ring lg:truncate"
              >
                {model.title}
              </button>
            </h1>
          ) : (
            <h1 className="truncate font-display text-display-xs leading-tight text-fg">{model.title}</h1>
          )}
          {live ? (
            <ClampText key={model.subtitle} className="mt-0.5 text-ui text-fg-muted">
              {model.subtitle}
            </ClampText>
          ) : (
            <p className="mt-0.5 truncate text-ui text-fg-muted">{model.subtitle}</p>
          )}
        </div>
      </div>
      {/* The dates the period spans, and where the numbers come from, as a report page's header says. */}
      <div
        className={cn(
          "min-w-0 leading-snug",
          live ? "max-sm:w-full sm:text-right" : "max-w-[40%] text-right",
        )}
      >
        <p
          className={cn(
            "tabular flex items-center gap-1.5 text-ui font-medium text-fg",
            live ? "sm:justify-end" : "justify-end",
          )}
        >
          <CalendarRange className="size-3.5 shrink-0 text-accent" aria-hidden />
          {span}
          {/* On a phone the source line is hidden: it is here. */}
          {live ? (
            <InfoTip label="About this data" className="font-normal sm:hidden">
              <span className="block font-medium">{model.fileName}</span>
              <span className="tabular block">{model.rows}</span>
              {model.dataTo ? <span className="block">Data to {model.dataTo}</span> : null}
              {model.isDemo ? <span className="block">Demo data: not real</span> : null}
            </InfoTip>
          ) : null}
        </p>
        <p className="tabular mt-0.5 truncate text-xs text-fg-muted">{scope}</p>
        {live ? (
          <ClampText key={source} className="text-xs text-fg-subtle max-sm:hidden">
            {source}
          </ClampText>
        ) : (
          <p className="truncate text-xs text-fg-subtle">{source}</p>
        )}
      </div>
    </header>
  );
}

/**
 * The chart area with no chart on the page, so it is never a blank area: while the dashboard is
 * still being computed it says so, and otherwise that there is no chart to show (every chart, and
 * why any is missing, is under All charts).
 */
function NoCharts({ live }: { live: boolean }) {
  const waiting = useWorkspace((s) => live && (s.computing || !s.lastCompute));
  return (
    <p
      className={cn(
        "col-span-full row-span-2 grid place-items-center rounded-card border border-dashed border-border bg-surface-1 p-6 text-center text-ui text-fg-muted",
        live && "min-h-[200px]",
      )}
    >
      {waiting ? "Drawing the charts…" : "No chart to show for this selection."}
    </p>
  );
}

/** How long a chart stays outlined after an insight's "View chart" points at it. */
const FLASH_MS = 1600;

/**
 * The page. `live` in the app (pills filter, charts have tooltips and actions,
 * the title can be renamed); otherwise drawn once at PAGE_W × PAGE_H for the
 * download.
 */
export function OnePage({
  model,
  live,
  onRename,
}: {
  model: PageModel;
  live: boolean;
  onRename?: (title: string) => void;
}) {
  const [flash, setFlash] = React.useState<string | null>(null);
  const n = Math.max(1, model.kpis.length);
  const onPage = new Set(model.charts.map((c) => c.spec.id));
  const source: ChartSource = {
    fileName: model.fileName,
    periodLabel: model.periodLabel,
    filters: model.slicers.filter((s) => s.values.length).length,
  };
  // An insight's chart on the page is brought into view and outlined for a moment.
  const show = (id: string) => {
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document
      .getElementById(`page-chart-${id}`)
      ?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "nearest" });
    setFlash(id);
    window.setTimeout(() => setFlash((f) => (f === id ? null : f)), FLASH_MS);
  };
  // Live on a large screen, the 16:9 page fits the window's height less --page-chrome, the room
  // above and below it: the top bar, the toolbar and the padding, 140 px (more while PageView shows
  // the fit notice). The charts' row never gets less than 400 px, so on a short window (1280 × 800)
  // the page grows a little past 16:9 rather than squeezing a chart until its legend overlaps it.
  return (
    <div
      data-page
      className={cn(
        "font-sans text-fg",
        live
          ? "flex flex-col gap-4 lg:mx-auto lg:grid lg:aspect-video lg:w-[min(100%,max(960px,calc((100dvh_-_var(--page-chrome,140px))*16/9)))] lg:grid-rows-[auto_auto_auto_minmax(400px,1fr)] lg:gap-3"
          : "grid grid-rows-[auto_auto_auto_minmax(0,1fr)] gap-3 bg-bg p-4",
      )}
      style={live ? undefined : { width: PAGE_W, height: PAGE_H }}
    >
      <Banner model={model} live={live} onRename={live ? onRename : undefined} />
      <PageFilterBar
        periodLabel={model.periodLabel}
        slicers={model.slicers}
        comparison={model.comparison}
        live={live}
      />
      <section
        aria-label="Headline KPIs"
        className={cn(
          "grid gap-3",
          live
            ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(var(--n),minmax(0,1fr))]"
            : "grid-cols-[repeat(var(--n),minmax(0,1fr))]",
        )}
        style={{ "--n": n } as React.CSSProperties}
      >
        {model.kpis.map((k, i) => (
          <PageKpiTile
            key={k.meta.id}
            meta={k.meta}
            value={k.value}
            index={i}
            fmt={model.fmt}
            shared={model.shared}
            sharedReason={model.sharedReason}
            roster={model.roster}
            target={model.targets[k.meta.id]}
          />
        ))}
      </section>
      {/* The charts as a bento, the insights in a column beside them (a fifth of the width). */}
      <div
        className={cn(
          "min-w-0",
          live
            ? "flex flex-col gap-3 lg:grid lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_clamp(240px,21%,340px)]"
            : "grid min-h-0 grid-cols-[minmax(0,1fr)_clamp(240px,21%,340px)] gap-3",
        )}
      >
        <div
          className={cn(
            "grid min-w-0 gap-3",
            live
              ? "sm:grid-cols-2 lg:min-h-0 lg:grid-cols-6 lg:grid-rows-2"
              : "min-h-0 grid-cols-6 grid-rows-2",
          )}
        >
          {model.charts.length ? (
            model.charts.map((c) => (
              <PageChartCard
                key={c.spec.id}
                chart={c}
                live={live}
                fmt={model.fmt}
                source={source}
                flash={flash === c.spec.id}
              />
            ))
          ) : (
            <NoCharts live={live} />
          )}
        </div>
        <PageInsights
          insights={model.insights}
          total={model.insightsTotal}
          ready={model.insightsReady}
          live={live}
          onPage={onPage}
          onShow={show}
        />
      </div>
    </div>
  );
}

/**
 * Makes the page's file from the workspace as it stands: finds the insights
 * first if they haven't been, then draws and saves the page as
 * {dataset}_one-page-dashboard_{date}.png or .pdf.
 */
export async function downloadOnePage(format: "png" | "pdf", fmt: FormatOptions): Promise<void> {
  if (!useWorkspace.getState().insights) await useWorkspace.getState().loadInsights();
  const s = useWorkspace.getState();
  const model = pageModel(s, fmt, s.pageTitle);
  if (!model) throw new Error("There is no dashboard to draw yet.");
  const base = exportFileName(s.summary?.name, "one-page-dashboard", format).replace(/\.(png|pdf)$/, "");
  await exportOnePage(model, format, base);
}

/**
 * Draws the page once, off-screen in the light theme, and saves it: a 16:9
 * PNG at three times the page size (3840 × 2160), or one landscape PDF page.
 * `baseName` is the file name without its extension.
 */
export async function exportOnePage(
  model: PageModel,
  format: "png" | "pdf",
  baseName: string,
): Promise<void> {
  const { host, cleanup } = await renderOffscreen(<OnePage model={model} live={false} />, PAGE_W);
  try {
    const node = host.querySelector<HTMLElement>("[data-page]");
    if (!node) throw new Error("The page couldn't be laid out.");
    const { toBlob, toJpeg } = await import("html-to-image");
    // The light theme's page colour (the page's own background token), under anything transparent.
    const background = getComputedStyle(node).backgroundColor;
    if (format === "png") {
      const blob = await toBlob(node, { pixelRatio: 3, backgroundColor: background });
      if (!blob) throw new Error("The page couldn't be drawn.");
      downloadBlob(blob, `${baseName}.png`);
    } else {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ unit: "pt", format: [960, 540], orientation: "landscape", compress: true });
      pdf.setProperties({ title: model.title, subject: model.subtitle, creator: "Loupe" });
      const img = await toJpeg(node, { pixelRatio: 3, quality: 0.92, backgroundColor: background });
      pdf.addImage(img, "JPEG", 0, 0, 960, 540, undefined, "FAST");
      pdf.save(`${baseName}.pdf`);
    }
  } finally {
    cleanup();
  }
}
