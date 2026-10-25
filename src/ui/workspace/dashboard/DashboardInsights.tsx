"use client";

/**
 * The dashboard's insights beside its charts (version 50.3), in the "All
 * charts" view: from a content width of about 1536 px a sticky column
 * (InsightsColumn) next to the sections, and below that a strip of the top
 * three above the first section (InsightsStrip), side by side from md and
 * scrolling sideways on a phone. Both link to the Insights step ("All
 * insights").
 *
 * Each insight shows its tone's icon, a one-line title and its figures
 * clamped to two lines (the whole text on hover, focus or a long press, from
 * ui/primitives/reveal), and "View chart" when it describes a chart
 * (focusChart scrolls to it and outlines it). Every number is the rules
 * engine's, computed from the data; nothing here writes a figure.
 *
 * The insights are asked for once per computed selection, as the one-page
 * view asks for them (useDashboardInsights, called once by the dashboard and
 * handed to both places, so one request serves the two).
 */
import * as React from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleDot,
  type LucideIcon,
} from "lucide-react";
import type { Insight } from "@/engine/insights/insights";
import { useWorkspace } from "@/store/workspace";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/ui/primitives/misc";
import { ClampText } from "@/ui/primitives/reveal";

/** Each tone's icon and its chip (the icon in the status colour on the status tint), as the Insights step draws them. */
const TONE: Record<Insight["tone"], { icon: LucideIcon; chip: string; label: string }> = {
  positive: { icon: ArrowUpRight, chip: "text-success bg-success-soft", label: "Positive" },
  negative: { icon: ArrowDownRight, chip: "text-danger bg-danger-soft", label: "Negative" },
  neutral: { icon: CircleDot, chip: "text-fg-muted bg-surface-3", label: "Note" },
  warning: { icon: AlertTriangle, chip: "text-warning bg-warning-soft", label: "Watch" },
};

export interface DashboardInsightsState {
  insights: Insight[] | null;
  /** Being worked out for the current selection (or not asked for yet). */
  updating: boolean;
  /** The selection holds no rows, so there is nothing to find. */
  noRows: boolean;
}

/** The insights for the current selection, asked for once per computed selection. */
export function useDashboardInsights(): DashboardInsightsState {
  const insights = useWorkspace((s) => s.insights);
  const loading = useWorkspace((s) => s.insightsLoading);
  const load = useWorkspace((s) => s.loadInsights);
  const lastCompute = useWorkspace((s) => s.lastCompute);
  const computing = useWorkspace((s) => s.computing);
  // Asked for once per computed selection, so a load that finds none doesn't ask again in a loop.
  const asked = React.useRef<unknown>(undefined);
  React.useEffect(() => {
    if (insights || loading || !lastCompute || asked.current === lastCompute) return;
    asked.current = lastCompute;
    void load();
  }, [insights, loading, lastCompute, load]);
  const updating = loading || computing || insights === null;
  return { insights, updating, noRows: !updating && lastCompute?.rows === 0 };
}

/** One insight: its tone's chip, the title on one line, the figures on two, and the way to its chart. */
function InsightItem({ insight, className }: { insight: Insight; className?: string }) {
  const focusChart = useWorkspace((s) => s.focusChart);
  const tone = TONE[insight.tone];
  return (
    <div className={cn("flex min-w-0 gap-3", className)}>
      <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-control", tone.chip)}>
        <tone.icon className="size-3.5" aria-hidden />
        <span className="sr-only">{tone.label}:</span>
      </span>
      <div className="min-w-0 flex-1">
        <ClampText key={insight.title} className="text-ui font-medium text-fg">
          {insight.title}
        </ClampText>
        <ClampText key={insight.plain} lines={2} className="mt-0.5 text-xs text-fg-muted">
          {insight.plain}
        </ClampText>
        {insight.chartId ? (
          <button
            type="button"
            onClick={() => focusChart(insight.chartId as string)}
            className="mt-1.5 inline-flex items-center gap-1 rounded-xs text-xs font-medium text-accent-text underline-offset-2 hover:underline focus-visible:focus-ring"
          >
            View chart
            <ArrowRight className="size-3" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** "All insights", to the Insights step. */
function AllInsightsLink() {
  const setStep = useWorkspace((s) => s.setStep);
  return (
    <button
      type="button"
      onClick={() => setStep("insights")}
      className="inline-flex shrink-0 items-center gap-1 rounded-xs text-xs font-medium text-accent-text underline-offset-2 hover:underline focus-visible:focus-ring"
    >
      All insights
      <ArrowRight className="size-3" aria-hidden />
    </button>
  );
}

/** What stands in for the list: placeholders the first time, or why there is nothing. */
function Placeholder({ state, rows }: { state: DashboardInsightsState; rows: number }) {
  if (state.noRows) return <p className="text-xs text-fg-muted">No rows match the current filters.</p>;
  if (state.updating && !state.insights?.length)
    return (
      <div className="grid gap-4" aria-busy="true">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-7 shrink-0 rounded-control" />
            <div className="grid flex-1 gap-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  return <p className="text-xs text-fg-muted">No insights stand out for this selection.</p>;
}

/** The insights in a sticky column beside the charts (wide screens). */
export function InsightsColumn({ state, className }: { state: DashboardInsightsState; className?: string }) {
  const list = state.noRows ? [] : (state.insights ?? []);
  return (
    <aside aria-labelledby="dash-insights" className={cn("min-w-0", className)}>
      {/* Under the top bar and the filter bar (56 + 56 px), with the page's gap. */}
      <div className="sticky top-32 flex max-h-[calc(100dvh-9rem)] flex-col overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <h2 id="dash-insights" className="text-md font-medium text-fg">
            Insights
          </h2>
          <AllInsightsLink />
        </div>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto transition-opacity duration-base",
            state.updating && list.length ? "opacity-disabled" : "",
          )}
          aria-busy={state.updating}
        >
          {list.length ? (
            <ol className="divide-y divide-border-subtle">
              {list.map((i) => (
                <li key={i.id} className="px-4 py-3.5">
                  <InsightItem insight={i} />
                </li>
              ))}
            </ol>
          ) : (
            <div className="px-4 py-4">
              <Placeholder state={state} rows={4} />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

/** The strip's columns from md: as many as it has insights, so one or two fill the width. */
const STRIP_COLS: Record<number, string> = { 1: "md:grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3" };

/** The top three insights in a strip above the charts (narrower screens). */
export function InsightsStrip({ state, className }: { state: DashboardInsightsState; className?: string }) {
  const list = state.noRows ? [] : (state.insights ?? []).slice(0, 3);
  return (
    <section aria-labelledby="dash-insights-strip" className={className}>
      <div className="mb-3 flex items-center gap-3">
        <h2 id="dash-insights-strip" className="eyebrow text-fg-subtle">
          Insights
        </h2>
        <span aria-hidden className="h-px flex-1 bg-border-subtle" />
        <AllInsightsLink />
      </div>
      {list.length ? (
        // One panel divided by hairlines from md; a row of cards to swipe through on a phone.
        <ol
          className={cn(
            "flex snap-x snap-mandatory [scrollbar-width:none] gap-3 overflow-x-auto max-md:-mx-4 max-md:px-4 md:grid md:gap-0 md:divide-x md:divide-border-subtle md:overflow-hidden md:rounded-card md:border md:border-border md:bg-surface-1 md:shadow-card",
            STRIP_COLS[list.length],
            "transition-opacity duration-base",
            state.updating ? "opacity-disabled" : "",
          )}
          aria-busy={state.updating}
        >
          {list.map((i) => (
            <li
              key={i.id}
              className="w-[85%] shrink-0 snap-start p-4 max-md:rounded-card max-md:border max-md:border-border max-md:bg-surface-1 max-md:shadow-card md:w-auto"
            >
              <InsightItem insight={i} />
            </li>
          ))}
        </ol>
      ) : (
        <div className="rounded-card border border-border bg-surface-1 px-4 py-3.5 shadow-card">
          <Placeholder state={state} rows={1} />
        </div>
      )}
    </section>
  );
}
