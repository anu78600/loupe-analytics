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
 */
import { FileIdentity } from "../FileIdentity";
import * as React from "react";
import {
  ChevronDown,
  CircleSlash,
  Columns3,
  LayoutGrid,
  Loader2,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import type { ChartSection, LayoutMode } from "@/engine/charts/types";
import { formatCount } from "@/engine/core/format";
import { allSpecs, kpiLayoutOf, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Segmented } from "@/ui/primitives/segmented";
import { Sheet, SheetContent } from "@/ui/primitives/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/ui/primitives/dialog";
import { Eyebrow } from "@/ui/primitives/misc";
import { useColumnUsage } from "../useColumnUsage";
import { AskChartButton } from "./AskChart";
import { ChartColoursButton } from "../ChartColours";
import { HealthPanel } from "../HealthPanel";
import { ActiveFilters, FilterRail } from "./FilterRail";
import { KpiStrip, KpiTiles, SupportingKpis } from "./KpiCards";
import { WidgetGrid } from "./WidgetGrid";
import { Inspector } from "./Inspector";

/** Dashboard sections in order (also the Customise step's chart groups). */
export const SECTIONS: Array<{ id: ChartSection; title: string; blurb: string }> = [
  { id: "trend", title: "Trend", blurb: "How the headline numbers move over time." },
  { id: "breakdown", title: "Breakdowns", blurb: "Where the volume comes from." },
  { id: "drivers", title: "Drivers & segments", blurb: "What explains the differences." },
  {
    id: "columns",
    title: "From your other columns",
    blurb: "Columns in your file the template doesn't use, summarised from your data.",
  },
  { id: "detail", title: "Detail", blurb: "The rows behind the totals." },
];

export function DashboardStep() {
  const context = useWorkspace((s) => s.context);
  const summary = useWorkspace((s) => s.summary);
  const mode = useWorkspace((s) => s.mode);
  const setMode = useWorkspace((s) => s.setMode);
  const computing = useWorkspace((s) => s.computing);
  const lastCompute = useWorkspace((s) => s.lastCompute);
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
  // The inspector is a slide-in panel, so the charts keep the full width: it opens when a
  // chart or KPI is picked (a KPI card, a chart's Customise) and from "Build manually".
  React.useEffect(
    () =>
      useWorkspace.subscribe((s, prev) => {
        if (s.selected && s.selected !== prev.selected) setInspectorOpen(true);
      }),
    [],
  );

  if (!context) return null;
  const columnTiles = kpiLayoutOf({ context, kpiLayout, extraKpis }).columns;
  const specs = allSpecs({ context, customCharts });
  const subName = context.domain.subDomains.find((s) => s.id === context.subDomainId)?.name;

  return (
    <div className="mx-auto grid w-full max-w-[1760px] gap-6 px-4 py-6 md:px-6 lg:grid-cols-[256px_minmax(0,1fr)]">
      <aside className="no-print hidden min-w-0 lg:block" aria-label="Dataset and filters">
        {/* Never scrolls sideways: everything in the rail fits its width. */}
        <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-x-hidden overflow-y-auto pr-1">
          <FilterRail onOpenHealth={() => setHealthOpen(true)} />
        </div>
      </aside>

      <div className="min-w-0" aria-busy={computing}>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow>Dashboard</Eyebrow>
            <h1 className="mt-1.5 truncate font-display text-[34px] leading-none text-fg">
              {context.domain.name}
              {subName && !context.domain.generic ? (
                <span className="text-fg-subtle"> · {subName}</span>
              ) : null}
            </h1>
            {summary ? <FileIdentity summary={summary} className="mt-2.5" /> : null}
            {usage ? (
              <p className="mt-2 flex items-center gap-1.5 text-2xs text-fg-subtle">
                <Columns3 className="size-3.5" aria-hidden />
                Uses {usage.used} of your {usage.total} columns ·{" "}
                {usage.hidden ? `${usage.hidden} hidden by you · ` : ""}
                {usage.derived ? "only the unpivot columns you agreed to were added" : "no columns added"}
              </p>
            ) : null}
          </div>
          <div className="no-print flex flex-wrap items-center gap-2">
            <span
              className="font-figures hidden items-center gap-1.5 text-2xs text-fg-subtle sm:inline-flex"
              aria-live="polite"
            >
              {computing ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
              {computing
                ? "Updating…"
                : lastCompute
                  ? `${formatCount(lastCompute.rows, locale)} rows · ${lastCompute.ms} ms`
                  : ""}
            </span>
            <Button variant="secondary" size="sm" className="lg:hidden" onClick={() => setFiltersOpen(true)}>
              <SlidersHorizontal aria-hidden /> Filters
            </Button>
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
        </div>
        <div className="mb-4">
          <ActiveFilters inline />
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
          return (
            <section key={sec.id} className="mt-9" aria-labelledby={`sec-${sec.id}`}>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 id={`sec-${sec.id}`} className="text-sm font-medium text-fg">
                  {sec.title} <span className="font-normal text-fg-subtle">· {sec.blurb}</span>
                </h2>
              </div>
              {tiles.length ? (
                <div className="mb-4">
                  <KpiTiles ids={tiles} label="KPIs from your other columns" />
                </div>
              ) : null}
              {visible.length ? <WidgetGrid specs={sectionSpecs} mode={mode} /> : null}
            </section>
          );
        })}
        <NotShown />
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="left" title="Filters">
          <div className="p-5">
            <FilterRail onOpenHealth={() => setHealthOpen(true)} />
          </div>
        </SheetContent>
      </Sheet>
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
        <DialogContent className="max-w-3xl">
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
    <section className="no-print mt-10 rounded-card border border-border bg-surface-1">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2 text-ui text-fg">
          <CircleSlash className="size-4 text-fg-subtle" aria-hidden />
          Not shown: {unavailable.length} KPI{unavailable.length === 1 ? "" : "s"} and{" "}
          {context.skippedCharts.length} chart{context.skippedCharts.length === 1 ? "" : "s"} can&apos;t be
          computed from this data{hidden.length ? `, ${hidden.length} hidden by you` : ""}.
        </span>
        <ChevronDown
          className={cn("size-4 text-fg-subtle transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="grid gap-5 border-t border-border px-5 py-4 md:grid-cols-2">
          {unavailable.length ? (
            <div>
              <p className="mb-2 text-2xs font-medium tracking-[0.1em] text-fg-subtle uppercase">KPIs</p>
              <ul className="grid gap-2 text-ui">
                {unavailable.map((k) =>
                  k ? (
                    <li key={k.id}>
                      <span className="text-fg">{k.name}</span>
                      <span className="block text-2xs text-fg-muted">
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
                <p className="mb-2 text-2xs font-medium tracking-[0.1em] text-fg-subtle uppercase">Charts</p>
                <ul className="grid gap-2 text-ui">
                  {context.skippedCharts.map((c) => (
                    <li key={c.id}>
                      <span className="text-fg">{c.title}</span>
                      <span className="block text-2xs text-fg-muted">{c.reason}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {hidden.length ? (
              <>
                <p className="mt-4 mb-2 text-2xs font-medium tracking-[0.1em] text-fg-subtle uppercase">
                  Hidden by you
                </p>
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
        <p className="border-t border-border px-5 py-2.5 text-2xs text-fg-subtle">
          <Badge tone="outline">Honest by design</Badge> Loupe never estimates a KPI it can&apos;t compute.
        </p>
      )}
    </section>
  );
}
