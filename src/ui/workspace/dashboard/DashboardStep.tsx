"use client";

/**
 * Step 4, Dashboard. Filter rail on the left; the hero KPI strip and the
 * supporting KPIs; then charts in the order analysts read them (trend →
 * breakdowns → drivers & segments → detail); Executive, Analyst and Compact
 * layouts; the inspector and chart builder (a slide-in panel, so the charts
 * keep the full width; WidgetGrid packs them into full rows); "Ask
 * for a chart", which designs charts from a request in the user's words and
 * lets them keep or remove any chart (AskChart.tsx); the line saying how
 * many of the file's columns are used; and the "Not shown" panel, which
 * lists every KPI or chart that could not be computed and what it needs.
 *
 * Little text on screen: on a phone the header's secondary facts (data to,
 * columns used) sit behind an ⓘ, what each section is for is behind the ⓘ
 * beside its title, and long reasons are clamped, with the full text behind
 * hover, a long press or the ⓘ (ui/primitives/reveal.tsx).
 *
 * The phone's Filters sheet opens from its own trigger. The inspector and the
 * data-health dialog open from state; the primitives give focus back to
 * whatever opened them (a KPI card, a chart's menu). The health report opens
 * on itself rather than on its first ⓘ (the Dialog primitive's `initialFocus`).
 *
 * When the industry explains few of the file's columns, both views open with
 * the fit notice (FitNotice), and when its template draws no chart of its own
 * on this data, the charts from the other columns are not folded away: the
 * dashboard leads with them.
 */
import { FileIdentity } from "../FileIdentity";
import * as React from "react";
import {
  CalendarRange,
  ChevronDown,
  CircleSlash,
  Columns3,
  LayoutGrid,
  Loader2,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import type { LayoutMode } from "@/engine/charts/types";
import { formatCount } from "@/engine/core/format";
import { formatDay } from "@/engine/core/dates";
import { PRESET_LABEL } from "@/engine/core/periods";
import { allSpecs, kpiLayoutOf, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Segmented } from "@/ui/primitives/segmented";
import { Sheet, SheetContent, SheetTrigger } from "@/ui/primitives/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitives/dialog";
import { Brief, ClampText, InfoTip } from "@/ui/primitives/reveal";

import { useColumnUsage } from "../useColumnUsage";
import { AskChartButton } from "./AskChart";
import { ChartColoursButton } from "../ChartColours";
import { HealthPanel } from "../HealthPanel";
import { ActiveFilters, FilterRail } from "./FilterRail";
import { ComparisonNote, KpiStrip, KpiTiles, SupportingKpis } from "./KpiCards";
import { WidgetGrid } from "./WidgetGrid";
import { Inspector } from "./Inspector";
import { SECTIONS } from "./sections";
import { FitNotice } from "./FitNotice";
import { PageView, ViewToggle } from "./page/PageView";

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

/** Every chart, by section, with the filter rail, the inspector and the layout modes. */
function FullDashboard() {
  const context = useWorkspace((s) => s.context);
  const summary = useWorkspace((s) => s.summary);
  const mode = useWorkspace((s) => s.mode);
  const setMode = useWorkspace((s) => s.setMode);
  const computing = useWorkspace((s) => s.computing);
  const lastCompute = useWorkspace((s) => s.lastCompute);
  const period = useWorkspace((s) => s.kpiBatch?.period?.label);
  const preset = useWorkspace((s) => s.datePreset);
  const locale = useSettings((s) => s.numberLocale);
  const select = useWorkspace((s) => s.select);
  const health = useWorkspace((s) => s.health);
  const customCharts = useWorkspace((s) => s.customCharts);
  const kpiLayout = useWorkspace((s) => s.kpiLayout);
  const extraKpis = useWorkspace((s) => s.extraKpis);
  const usage = useColumnUsage();
  const [filtersOpen, setFiltersOpen] = React.useState(false);
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
  const subName = context.domain.subDomains.find((s) => s.id === context.subDomainId)?.name;
  // Charts of the dashboard's own in this mode (trend, breakdowns, drivers). Without any (an industry
  // that explains few of the columns), the charts for the other columns lead, unfolded.
  const ownCharts = specs.some(
    (x) => x.section !== "columns" && x.section !== "detail" && x.modes.includes(mode),
  );

  return (
    // overflow-x: clip, so nothing inside can make the page scroll sideways and push the rail off the
    // left edge (clip, unlike hidden, keeps the rail's sticky position working).
    <div className="mx-auto grid w-full max-w-[1760px] gap-6 overflow-x-clip px-4 py-6 md:px-6 lg:grid-cols-[256px_minmax(0,1fr)]">
      <aside className="no-print hidden min-w-0 lg:block" aria-label="Dataset and filters">
        {/* Never scrolls sideways: everything in the rail fits its width. The padding (pulled back
            on the left) keeps room for a control's focus ring, which the scroll box would clip. */}
        <div className="sticky top-20 -ml-1.5 max-h-[calc(100dvh-6rem)] overflow-x-hidden overflow-y-auto py-1 pr-1 pl-1.5">
          <FilterRail onOpenHealth={() => setHealthOpen(true)} />
        </div>
      </aside>

      <div className="min-w-0" aria-busy={computing}>
        <FitNotice className="mb-5" />
        {/* Two levels only: the title, then one quiet line of facts; the actions sit to the right. */}
        <header className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 flex-[1_1_380px]">
            {/* leading-tight, not the display size's own 1.08: truncate clips at the line box, which
                would cut the serif's descenders. */}
            <h1 className="truncate font-display text-display-sm leading-tight text-fg">
              {context.domain.name}
              {/* The data shape sits beside the industry, smaller and in the interface face (the serif is
                  for display sizes only), so the line fits next to the actions. */}
              {subName && !context.domain.generic ? (
                <span className="ml-3 font-sans text-lg text-fg-subtle">{subName}</span>
              ) : null}
            </h1>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-subtle">
              {/* With no industry, what the table is ("Daily readings of 4 measures at 49 locations, …"). */}
              {/* One line; the whole description on hover, focus or a long press. */}
              {context.domain.generic ? (
                <ClampText key={context.domain.description} className="max-w-full min-w-0 text-fg-muted">
                  {context.domain.description}
                </ClampText>
              ) : null}
              {summary ? <FileIdentity summary={summary} size="sm" className="max-w-full" /> : null}
              {/* The period in view, and how recent the data is, as a report's header states them (on a
                  phone, how recent is behind the ⓘ at the end of the line). */}
              {period ? (
                <span className="tabular inline-flex items-center gap-1.5">
                  <CalendarRange className="size-3.5" aria-hidden />
                  {preset !== "custom" && preset !== "all" ? `${PRESET_LABEL[preset]}: ` : ""}
                  {period}
                  {context.dateBounds ? (
                    <span className="hidden sm:inline">{` · data to ${formatDay(context.dateBounds.max)}`}</span>
                  ) : null}
                </span>
              ) : null}
              <span className="tabular inline-flex items-center gap-1.5" aria-live="polite">
                {computing ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                {computing
                  ? "Updating…"
                  : lastCompute && summary
                    ? lastCompute.rows === summary.rowCount
                      ? `all ${formatCount(summary.rowCount, locale)} rows`
                      : `${formatCount(lastCompute.rows, locale)} of ${formatCount(summary.rowCount, locale)} rows in view`
                    : ""}
              </span>
              {usage ? (
                <span className="hidden items-center gap-1.5 sm:inline-flex">
                  <Columns3 className="size-3.5" aria-hidden />
                  {usage.used} of {usage.total} columns used
                  {usage.hidden ? ` · ${usage.hidden} hidden by you` : ""}
                  {usage.derived ? " · unpivot columns added" : ""}
                </span>
              ) : null}
              {/* On a phone the secondary facts above are here. */}
              {context.dateBounds || usage ? (
                <InfoTip label="More about this data" className="sm:hidden">
                  {context.dateBounds ? (
                    <span className="block">Data to {formatDay(context.dateBounds.max)}</span>
                  ) : null}
                  {usage ? (
                    <span className="block">
                      {usage.used} of {usage.total} columns used
                      {usage.hidden ? ` · ${usage.hidden} hidden by you` : ""}
                      {usage.derived ? " · unpivot columns added" : ""}
                    </span>
                  ) : null}
                </InfoTip>
              ) : null}
            </div>
          </div>
          <div className="no-print flex flex-wrap items-center gap-2">
            <ViewToggle />
            {/* The sheet's own trigger, so focus comes back to this button when it closes. */}
            <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
              <SheetTrigger asChild>
                <Button variant="secondary" size="sm" className="lg:hidden">
                  <SlidersHorizontal aria-hidden /> Filters
                </Button>
              </SheetTrigger>
              <SheetContent side="left" title="Filters">
                <div className="p-5">
                  <FilterRail inSheet onOpenHealth={() => setHealthOpen(true)} />
                </div>
              </SheetContent>
            </Sheet>
            <Segmented<LayoutMode>
              ariaLabel="Layout mode"
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: "executive", label: "Executive" },
                { value: "analyst", label: "Analyst" },
                { value: "compact", label: "Compact" },
              ]}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                select(null);
                setInspectorOpen(true);
              }}
            >
              <Plus aria-hidden /> Build manually
            </Button>
            <ChartColoursButton />
            <AskChartButton />
          </div>
        </header>
        <div className="mb-3 flex min-h-5 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <ActiveFilters inline />
          <span className="ml-auto">
            <ComparisonNote />
          </span>
        </div>
        <div className="grid gap-4">
          <KpiStrip />
          {mode !== "executive" ? <SupportingKpis /> : null}
        </div>
        {SECTIONS.map((sec) => {
          const sectionSpecs = specs.filter((s) => s.section === sec.id);
          const visible = sectionSpecs.filter((s) => s.modes.includes(mode));
          // The your-columns section also carries its KPI tiles, so it shows even without charts.
          const tiles = sec.id === "columns" ? columnTiles : [];
          if (!visible.length && !tiles.length) return null;
          const foldable = sec.id === "columns" && visible.length > 0 && ownCharts;
          return (
            <section key={sec.id} className="mt-10" aria-labelledby={`sec-${sec.id}`}>
              {/* A title and a hairline; what the section is for is behind its ⓘ, not more text to read. */}
              <div className="mb-3 flex items-center gap-3">
                <span className="flex items-center gap-1.5">
                  <h2 id={`sec-${sec.id}`} className="text-md font-medium text-fg">
                    {sec.title}
                  </h2>
                  <InfoTip label={`About ${sec.title}`}>{sec.blurb}</InfoTip>
                </span>
                <span aria-hidden className="h-px flex-1 bg-border-subtle" />
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
                <div className="mb-4">
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
