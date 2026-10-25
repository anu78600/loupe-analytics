"use client";

/**
 * Step 4, Dashboard. Two views: the one-page view (PageView) and every chart
 * by section (FullDashboard), redesigned in version 50.3:
 *
 * - the header: the industry, one quiet line of facts (the file below lg,
 *   where the breadcrumb doesn't name it; the period; the rows in view; the
 *   columns used; the rest behind an ⓘ) and the toolbar (the view, the
 *   layout, Colours, and "Ask for a chart", the page's primary). Since
 *   version 52.0 the layout is a menu that says what each mode shows and how
 *   many charts, and "Build it yourself" sits in the menu beside "Ask for a
 *   chart", the two ways to add a chart;
 * - the filter bar (FilterBar), sticky under the top bar from lg, in place of
 *   the 256 px filter rail, so the charts get the width back;
 * - the hero KPIs with sparklines, then the other KPIs as one compact panel
 *   (KpiCards);
 * - the charts in the order analysts read them (trend → breakdowns → drivers
 *   & segments → other columns → detail), each section headed by an eyebrow
 *   and a hairline with its ⓘ, packed into full rows (WidgetGrid);
 * - the insights beside the charts: a sticky column from a content width of
 *   about 1536 px, a strip of the top three above the charts below that
 *   (DashboardInsights);
 * - the inspector and chart builder in a slide-in panel (so the charts keep
 *   the full width), "Ask for a chart" (AskChart.tsx), the data-health
 *   report, and the "Not shown" panel, which lists every KPI or chart that
 *   could not be computed and what it needs, and restores hidden charts.
 *
 * The automatic charts for the columns the template doesn't use start folded
 * when the dashboard has charts of its own, and open by themselves when an
 * insight's "View chart" points at one of them. When the industry explains
 * few of the file's columns, both views open with the fit notice
 * (FitNotice), and the charts from the other columns lead, unfolded.
 *
 * The inspector and the data-health dialog open from state; the primitives
 * give focus back to whatever opened them (a KPI card, a chart's menu). The
 * health report opens on itself rather than on its first ⓘ (the Dialog
 * primitive's `initialFocus`).
 */
import { FileIdentity } from "../FileIdentity";
import * as React from "react";
import {
  CalendarRange,
  ChevronDown,
  CircleSlash,
  LayoutGrid,
  Loader2,
  MoreHorizontal,
  Palette,
  Plus,
} from "lucide-react";
import type { LayoutMode } from "@/engine/charts/types";
import { formatCount } from "@/engine/core/format";
import { formatDay } from "@/engine/core/dates";
import { allSpecs, kpiLayoutOf, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Sheet, SheetContent } from "@/ui/primitives/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitives/dialog";
import { Brief, ClampText, InfoTip } from "@/ui/primitives/reveal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/primitives/dropdown-menu";

import { useColumnUsage } from "../useColumnUsage";
import { AskChartButton } from "./AskChart";
import { ChartColoursButton, useChartColoursPanel } from "../ChartColours";
import { HealthPanel } from "../HealthPanel";
import { FilterBar } from "./FilterBar";
import { ComparisonNote, KpiStrip, KpiTiles, SupportingKpis } from "./KpiCards";
import { WidgetGrid } from "./WidgetGrid";
import { Inspector } from "./Inspector";
import { SECTIONS } from "./sections";
import { FitNotice } from "./FitNotice";
import { InsightsColumn, InsightsStrip, useDashboardInsights } from "./DashboardInsights";
import { PageView, ViewToggle } from "./page/PageView";
import { dataLed } from "./page/pagePlan";

/** True when the chart being focused (focusChart) is one of the automatic charts for other columns. */
function inColumnsSection(s: ReturnType<typeof useWorkspace.getState>): boolean {
  const id = s.highlight;
  return Boolean(id && allSpecs(s).find((x) => x.id === id)?.section === "columns");
}

/** The dashboard step: the one-page view (PageView), or every chart by section. */
export function DashboardStep() {
  const view = useWorkspace((s) => s.dashView);
  const hasContext = useWorkspace((s) => Boolean(s.context));
  if (!hasContext) return null;
  return view === "page" ? <PageView /> : <FullDashboard />;
}

/** Every chart, by section, under the filter bar, with the insights beside them and the inspector. */
function FullDashboard() {
  const context = useWorkspace((s) => s.context);
  const mode = useWorkspace((s) => s.mode);
  const computing = useWorkspace((s) => s.computing);
  const select = useWorkspace((s) => s.select);
  const health = useWorkspace((s) => s.health);
  const customCharts = useWorkspace((s) => s.customCharts);
  const kpiLayout = useWorkspace((s) => s.kpiLayout);
  const extraKpis = useWorkspace((s) => s.extraKpis);
  const insights = useDashboardInsights();
  const [inspectorOpen, setInspectorOpen] = React.useState(false);
  const [healthOpen, setHealthOpen] = React.useState(false);
  // The automatic charts for columns the template doesn't use start folded: the dashboard leads
  // with the charts chosen for the business, and these are one click away. They open by themselves
  // when an insight's "View chart" points at one of them.
  const [columnsOpen, setColumnsOpen] = React.useState(() => inColumnsSection(useWorkspace.getState()));
  // The inspector is a slide-in panel, so the charts keep the full width: it opens when a
  // chart or KPI is picked (a KPI card, a chart's Customise) and from "Build manually".
  React.useEffect(
    () =>
      useWorkspace.subscribe((s, prev) => {
        if (s.selected && s.selected !== prev.selected) setInspectorOpen(true);
        if (s.highlight !== prev.highlight && inColumnsSection(s)) setColumnsOpen(true);
      }),
    [],
  );

  if (!context) return null;
  const columnTiles = kpiLayoutOf({ context, kpiLayout, extraKpis }).columns;
  const specs = allSpecs({ context, customCharts });
  // Charts of the dashboard's own in this mode (trend, breakdowns, drivers). Without any, or with an
  // industry that explains few of the columns (context.fit.weak, where the data-led charts are planned
  // first), the charts for the other columns lead, unfolded.
  const ownCharts =
    !context.fit.weak &&
    specs.some((x) => x.section !== "columns" && x.section !== "detail" && x.modes.includes(mode));

  return (
    // overflow-x: clip, so nothing inside can make the page scroll sideways (clip, unlike hidden,
    // keeps the filter bar's sticky position working). The container query measures the content
    // width beside the sidebar, which decides where the insights go. Whatever is scrolled into view
    // (a chart from "View chart", a control reached with Tab) stops below the top bar and, from lg,
    // the sticky filter bar, never under them.
    <div
      className="@container/dash relative w-full overflow-x-clip [&_*]:scroll-mt-28 lg:[&_*]:scroll-mt-32"
      aria-busy={computing}
    >
      <div className="mx-auto w-full max-w-[1760px] px-4 pt-6 md:px-6">
        <FitNotice className="mb-5" />
        <DashboardHeader
          onBuild={() => {
            select(null);
            setInspectorOpen(true);
          }}
        />
      </div>

      <FilterBar onOpenHealth={() => setHealthOpen(true)} />

      <div className="mx-auto grid w-full max-w-[1760px] items-start gap-6 px-4 pt-3 pb-12 md:px-6 @[96rem]/dash:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {/* Below lg the bar has no room for what the changes compare with; it sits above the cards. */}
          <ComparisonNote lead className="mb-2.5 lg:hidden" />
          <div className="grid gap-3">
            <KpiStrip />
            {mode !== "executive" ? <SupportingKpis /> : null}
          </div>
          <InsightsStrip state={insights} className="mt-8 @[96rem]/dash:hidden" />
          {SECTIONS.map((sec) => {
            const sectionSpecs = specs.filter((s) => s.section === sec.id);
            const visible = sectionSpecs.filter((s) => s.modes.includes(mode));
            // The your-columns section also carries its KPI tiles, so it shows even without charts.
            const tiles = sec.id === "columns" ? columnTiles : [];
            if (!visible.length && !tiles.length) return null;
            const foldable = sec.id === "columns" && visible.length > 0 && ownCharts;
            return (
              <section key={sec.id} className="mt-8" aria-labelledby={`sec-${sec.id}`}>
                {/* An eyebrow and a hairline; what the section is for is behind its ⓘ. */}
                <div className="mb-3 flex min-h-7 items-center gap-2">
                  <h2 id={`sec-${sec.id}`} className="eyebrow text-fg-subtle">
                    {sec.title}
                  </h2>
                  <InfoTip label={`About ${sec.title}`}>{sec.blurb}</InfoTip>
                  <span aria-hidden className="ml-1 h-px flex-1 bg-border-subtle" />
                  {foldable ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-expanded={columnsOpen}
                      aria-controls="sec-columns-charts"
                      onClick={() => setColumnsOpen((o) => !o)}
                    >
                      {columnsOpen
                        ? "Hide charts"
                        : `Show ${visible.length} chart${visible.length === 1 ? "" : "s"}`}
                      <ChevronDown
                        className={cn("transition-transform", columnsOpen && "rotate-180")}
                        aria-hidden
                      />
                    </Button>
                  ) : null}
                </div>
                {tiles.length ? (
                  <div className="mb-3">
                    <KpiTiles ids={tiles} label="KPIs from your other columns" />
                  </div>
                ) : null}
                {visible.length && (!foldable || columnsOpen) ? (
                  <div id={foldable ? "sec-columns-charts" : undefined}>
                    <WidgetGrid specs={sectionSpecs} mode={mode} />
                  </div>
                ) : null}
              </section>
            );
          })}
          <NotShown />
        </div>
        <InsightsColumn state={insights} className="hidden @[96rem]/dash:block" />
      </div>

      <Sheet
        open={inspectorOpen}
        onOpenChange={(o) => {
          setInspectorOpen(o);
          if (!o) select(null);
        }}
      >
        <SheetContent side="right" title="Inspector">
          <div className="p-5">
            <Inspector />
          </div>
        </SheetContent>
      </Sheet>
      <Dialog open={healthOpen} onOpenChange={setHealthOpen}>
        {/* The health report is read rather than filled in: it opens on itself, not on its first ⓘ. */}
        <DialogContent className="max-w-3xl" initialFocus="content">
          <DialogHeader>
            <DialogTitle>Data health</DialogTitle>
            <DialogDescription>Light trust checks run on every load, even for clean data.</DialogDescription>
          </DialogHeader>
          {health ? <HealthPanel health={health} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The title (the industry, and the data's shape beside it), one quiet line of
 * facts, and the toolbar. On a phone the secondary facts sit behind the ⓘ.
 */
function DashboardHeader({ onBuild }: { onBuild: () => void }) {
  const context = useWorkspace((s) => s.context);
  const summary = useWorkspace((s) => s.summary);
  const computing = useWorkspace((s) => s.computing);
  const lastCompute = useWorkspace((s) => s.lastCompute);
  const period = useWorkspace((s) => s.kpiBatch?.period?.label);
  const locale = useSettings((s) => s.numberLocale);
  const usage = useColumnUsage();
  if (!context) return null;
  const subName = context.domain.subDomains.find((s) => s.id === context.subDomainId)?.name;
  const grain = context.grainLabel;
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-1">
      <div className="min-w-0 flex-[1_1_360px]">
        {/* leading-tight, not the display size's own line: truncate clips at the line box. */}
        <h1 className="flex min-w-0 items-baseline gap-x-3 font-display text-display-xs leading-tight text-fg">
          {/* A dashboard designed from the data (no industry, or one that fits few columns) is titled from
              the data, as the one page titles it ("Wine quality analysis"), not "Generic". */}
          <span className="truncate">
            {dataLed(context) ? context.understanding.title : context.domain.name}
          </span>
          {/* The data shape beside the industry, smaller and in the interface voice. */}
          {subName && !context.domain.generic ? (
            <span className="hidden truncate font-sans text-lg font-normal text-fg-subtle sm:inline">
              {subName}
            </span>
          ) : null}
        </h1>
        {/* Below lg the breadcrumb doesn't name the file, so it heads the facts. */}
        {summary ? <FileIdentity summary={summary} size="sm" className="mt-2 max-w-full lg:hidden" /> : null}
        {/* One quiet line, the facts parted by dots. */}
        <div className="tabular mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-subtle">
          {/* With no industry, what the table is ("Daily readings of 4 measures at 49 locations, …"). */}
          {context.domain.generic ? (
            <ClampText key={context.domain.description} className="w-full min-w-0 text-fg-muted">
              {context.domain.description}
            </ClampText>
          ) : null}
          {/* The period in view: its dates (its name is on the period's pill in the filter bar). */}
          {period ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarRange className="size-3.5" aria-hidden />
              {period}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-2" aria-live="polite">
            {period ? <Dot /> : null}
            {computing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            {computing
              ? "Updating…"
              : lastCompute && summary
                ? lastCompute.rows === summary.rowCount
                  ? `All ${formatCount(summary.rowCount, locale)} rows`
                  : `${formatCount(lastCompute.rows, locale)} of ${formatCount(summary.rowCount, locale)} rows`
                : ""}
          </span>
          {usage ? (
            <span className="hidden items-center gap-2 sm:inline-flex">
              <Dot />
              {usage.used} of {usage.total} columns used
            </span>
          ) : null}
          {/* The rest: what one row is, how recent the data is, hidden columns (and, on a phone, the
              columns used). */}
          <InfoTip label="More about this data">
            <span className="grid gap-1">
              {grain ? <span>{grain}</span> : null}
              {context.dateBounds ? <span>Data to {formatDay(context.dateBounds.max)}</span> : null}
              {usage ? (
                <span>
                  {usage.used} of {usage.total} columns used
                  {usage.hidden ? ` · ${usage.hidden} hidden by you` : ""}
                  {usage.derived ? " · unpivot columns added" : ""}
                </span>
              ) : null}
              {summary?.isDemo ? <span>Demo data, generated for the example.</span> : null}
            </span>
          </InfoTip>
        </div>
      </div>
      <div className="no-print flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <ViewToggle />
        {/* On a phone the layout, the builder and the colours share one menu, so the toolbar is one row. */}
        <div className="hidden flex-wrap items-center gap-2 sm:flex">
          <LayoutMenu />
          <ChartColoursButton />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="icon-sm"
              className="size-8 sm:hidden"
              aria-label="More dashboard options"
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-52">
            <LayoutItems />
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onBuild}>
              <Plus aria-hidden /> Build it yourself
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useChartColoursPanel.getState().setOpen(true)}>
              <Palette aria-hidden /> Chart colours
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="ml-auto flex sm:ml-0">
          <AskChartButton className="sm:rounded-r-none" />
          {/* The other way to add a chart, joined to the first; on a phone it is in the menu above. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="primary"
                size="sm"
                className="hidden rounded-l-none border-l border-accent-fg/25 px-2 sm:inline-flex"
                aria-label="More ways to add a chart"
              >
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Add a chart</DropdownMenuLabel>
              <DropdownMenuItem onSelect={onBuild} className="items-start">
                <Plus aria-hidden className="mt-0.5" />
                <span className="grid gap-0.5">
                  <span>Build it yourself</span>
                  <span className="text-xs text-fg-muted">Choose the chart, the measure and the axis.</span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
    </header>
  );
}

/** The layout modes, each with what it shows: the headline charts (Executive), every chart (Analyst), or shorter cards (Compact). */
const LAYOUTS: Array<{ value: LayoutMode; label: string; what: string }> = [
  { value: "executive", label: "Executive", what: "The headline charts and main KPIs, for a quick read." },
  { value: "analyst", label: "Analyst", what: "Every chart and KPI, at full size." },
  { value: "compact", label: "Compact", what: "The key charts in shorter cards, so more fit on screen." },
];

/** Charts each layout mode shows: the dashboard's charts not hidden whose spec lists that mode. */
function useModeCounts(): Record<LayoutMode, number> | null {
  const context = useWorkspace((s) => s.context);
  const customCharts = useWorkspace((s) => s.customCharts);
  const widgets = useWorkspace((s) => s.widgets);
  return React.useMemo(() => {
    if (!context) return null;
    const specs = new Map(allSpecs({ context, customCharts }).map((x) => [x.id, x]));
    const count = (m: LayoutMode) =>
      widgets.filter((w) => !w.hidden && specs.get(w.id)?.modes.includes(m)).length;
    return { executive: count("executive"), analyst: count("analyst"), compact: count("compact") };
  }, [context, customCharts, widgets]);
}

/** The layout modes as menu items: each with what it shows and how many charts. */
function LayoutItems() {
  const mode = useWorkspace((s) => s.mode);
  const setMode = useWorkspace((s) => s.setMode);
  const counts = useModeCounts();
  return (
    <>
      <DropdownMenuLabel>Layout</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as LayoutMode)}>
        {LAYOUTS.map((l) => (
          <DropdownMenuRadioItem key={l.value} value={l.value} className="items-start">
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="flex items-baseline justify-between gap-3">
                {l.label}
                {counts ? (
                  <span className="tabular text-xs text-fg-subtle">
                    {counts[l.value]} chart{counts[l.value] === 1 ? "" : "s"}
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-fg-muted">{l.what}</span>
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

/** The layout as one button naming the mode in use, opening the modes with what each shows. */
function LayoutMenu() {
  const mode = useWorkspace((s) => s.mode);
  const label = LAYOUTS.find((l) => l.value === mode)?.label ?? "Analyst";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" aria-label={`Layout: ${label}`}>
          <LayoutGrid aria-hidden />
          {label}
          <ChevronDown aria-hidden className="text-fg-subtle" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <LayoutItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The quiet separator between the header's facts. */
function Dot() {
  return (
    <span aria-hidden className="text-fg-disabled">
      ·
    </span>
  );
}

function NotShown() {
  const context = useWorkspace((s) => s.context);
  const widgets = useWorkspace((s) => s.widgets);
  const updateWidget = useWorkspace((s) => s.updateWidget);
  const [open, setOpen] = React.useState(false);
  if (!context) return null;
  const unavailable = context.selection.unavailable
    .map((id) => context.kpis.find((k) => k.id === id))
    .filter(Boolean);
  const hidden = widgets.filter((w) => w.hidden);
  const total = unavailable.length + context.skippedCharts.length + hidden.length;
  if (!total) return null;
  return (
    <section className="no-print mt-10 rounded-card border border-border bg-surface-1 shadow-card">
      <button
        type="button"
        className={cn(
          "flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors duration-fast hover:bg-surface-hover",
          open ? "rounded-t-card" : "rounded-card",
        )}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2 text-ui text-fg">
          <CircleSlash className="size-4 text-fg-subtle" aria-hidden />
          {/* Short; why (they can't be computed from this data) is said when the panel opens. */}
          Not shown: {unavailable.length} KPI{unavailable.length === 1 ? "" : "s"} and{" "}
          {context.skippedCharts.length} chart{context.skippedCharts.length === 1 ? "" : "s"}
          {hidden.length ? `, ${hidden.length} hidden by you` : ""}
        </span>
        <ChevronDown
          className={cn("size-4 text-fg-subtle transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="grid gap-5 border-t border-border-subtle px-5 py-4 md:grid-cols-2">
          {unavailable.length ? (
            <div>
              <p className="eyebrow mb-2 text-fg-subtle">KPIs</p>
              <ul className="grid gap-2 text-ui">
                {unavailable.map((k) =>
                  k ? (
                    <li key={k.id}>
                      <span className="text-fg">{k.name}</span>
                      <span className="block text-xs text-fg-muted">
                        {k.unavailableReason} {k.substitute}
                      </span>
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          ) : null}
          <div>
            {context.skippedCharts.length ? (
              <>
                <p className="eyebrow mb-2 text-fg-subtle">Charts</p>
                <ul className="grid gap-2 text-ui">
                  {context.skippedCharts.map((c) => (
                    <li key={c.id}>
                      <span className="text-fg">{c.title}</span>
                      <span className="block text-xs text-fg-muted">{c.reason}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {hidden.length ? (
              <>
                <p className="eyebrow mt-4 mb-2 text-fg-subtle">Hidden by you</p>
                <div className="flex flex-wrap gap-1.5">
                  {hidden.map((w) => (
                    <Button
                      key={w.id}
                      size="xs"
                      variant="outline"
                      onClick={() => updateWidget(w.id, { hidden: false })}
                    >
                      <LayoutGrid aria-hidden /> Restore{" "}
                      {context.charts.find((c) => c.id === w.id)?.title ?? w.id}
                    </Button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {!open ? null : (
        <p className="border-t border-border-subtle px-5 py-2.5 text-xs text-fg-subtle">
          <Badge tone="outline">Honest by design</Badge>{" "}
          <Brief
            label="Why these aren't shown"
            full={`${unavailable.length} KPI${unavailable.length === 1 ? "" : "s"} and ${context.skippedCharts.length} chart${context.skippedCharts.length === 1 ? "" : "s"} can't be computed from this data. Loupe never estimates a KPI it can't compute.`}
          >
            Loupe never estimates a KPI it can&apos;t compute.
          </Brief>
        </p>
      )}
    </section>
  );
}
