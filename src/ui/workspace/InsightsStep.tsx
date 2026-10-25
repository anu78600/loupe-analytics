"use client";

/**
 * Step 7, Insights, as a ranked feed (version 50.4): findings from the rules
 * engine, ranked by impact, each with its figures, its basis and the chart it
 * describes. The optional AI executive summary sits on top of the feed when
 * the AI layer is switched on.
 *
 * The page opens with the flow's StepHeader ("Analyse · Step 7 of 8", "What
 * the data says", ranked by impact for the selected period, the period's
 * dates behind the lead), with Recompute beside it and the dashboard's
 * filters in use under it as removable chips (ActiveFilters). Then:
 * - a quiet row of tabs by kind (All · Trend · Segment gap…, each with its
 *   count); an insight keeps its overall rank when the feed shows one kind
 *   (analyse/feed.ts);
 * - the feed (analyse/InsightFeed.tsx): compact cards ranked #1…n, each with
 *   its tone's icon, title, figures, impact bar and tags;
 * - from xl, the selected insight in full with its chart beside the feed, in
 *   a sticky panel (analyse/InsightDetail.tsx), chosen with a click or the
 *   arrow keys; below xl, one column with "View chart" on each card.
 *
 * Insights describe the dashboard's selection. While they are worked out for
 * a new selection the feed says so and dims (placeholders in its shape the
 * first time); a selection with no rows, or one where nothing stands out,
 * says so with what to try. Every number is the engine's, computed from the
 * data; nothing is estimated or written by a model unless the user asks for
 * the optional AI summary.
 */
import * as React from "react";
import { Lightbulb, Loader2, RefreshCw, SearchX } from "lucide-react";
import type { InsightKind } from "@/engine/insights/insights";
import { PRESET_LABEL, presetRange, type DatePreset } from "@/engine/core/periods";
import { formatRange } from "@/engine/core/dates";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/primitives/button";
import { Skeleton } from "@/ui/primitives/misc";
import { Brief } from "@/ui/primitives/reveal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/primitives/tabs";
import { ActiveFilters } from "./dashboard/FilterBar";
import { AiSummary } from "./AiSummary";
import { StepHeader } from "./flow/StepHeader";
import { FeedSkeleton, InsightCard, KIND } from "./analyse/InsightFeed";
import { DetailSkeleton, InsightDetail } from "./analyse/InsightDetail";
import { kindTabs, moveSelection, rankedFeed } from "./analyse/feed";
import { Switch } from "@/ui/primitives/switch";
import { InfoTip } from "@/ui/primitives/reveal";

/** The selected period in words: "the last 12 months (1 Oct 2025 – 30 Sep 2026)", "all your data". */
function periodWords(
  preset: DatePreset,
  custom: { from: number; to: number } | null,
  bounds: { min: number; max: number } | null,
): string {
  if (preset === "custom" && custom) return formatRange(custom.from, custom.to);
  if (preset === "all" || !bounds)
    return bounds ? `all your data (${formatRange(bounds.min, bounds.max)})` : "all your data";
  const range = presetRange(preset, bounds);
  const name = PRESET_LABEL[preset].toLowerCase();
  return `the ${name}${range ? ` (${formatRange(range.from, range.to)})` : ""}`;
}

/** The selected period in a few words, without its dates: "the last 12 months", "all your data". */
function periodName(preset: DatePreset, custom: { from: number; to: number } | null): string {
  if (preset === "custom" && custom) return formatRange(custom.from, custom.to);
  if (preset === "all") return "all your data";
  return `the ${PRESET_LABEL[preset].toLowerCase()}`;
}

/** The master-detail view's width (Tailwind's xl), read from the screen and kept in step with it. */
const WIDE = "(min-width: 1280px)";
const subscribeWide = (onChange: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};
function useWide(): boolean {
  return React.useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

export function InsightsStep() {
  const insights = useWorkspace((s) => s.insights);
  const loading = useWorkspace((s) => s.insightsLoading);
  const computing = useWorkspace((s) => s.computing);
  const rows = useWorkspace((s) => s.lastCompute?.rows ?? null);
  const bounds = useWorkspace((s) => s.context?.dateBounds ?? null);
  const load = useWorkspace((s) => s.loadInsights);
  const preset = useWorkspace((s) => s.datePreset);
  const custom = useWorkspace((s) => s.customRange);
  const filtered = useWorkspace(
    (s) => s.dimFilters.length > 0 || s.crossFilter !== null || s.datePreset === "custom",
  );
  const clearFilters = useWorkspace((s) => s.clearFilters);
  const setPreset = useWorkspace((s) => s.setDatePreset);
  const aiEnabled = useSettings((s) => s.ai.enabled);
  const wide = useWide();
  const [kind, setKind] = React.useState<InsightKind | "all">("all");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!insights && !loading) void load();
  }, [insights, loading, load]);
  // Insights wait for the dashboard's refresh: until they match the selection they are being worked on.
  const updating = loading || computing || insights === null;
  const noRows = !updating && rows === 0;
  const all = insights ?? [];
  const tabs = kindTabs(all);
  // A kind that has gone (after a recompute) falls back to all of them.
  const activeKind = tabs.some((t) => t.kind === kind) ? kind : "all";
  const feed = rankedFeed(all, activeKind);
  // The selection follows the feed: the chosen insight while it is shown, else the first.
  const selected = feed.find((f) => f.insight.id === selectedId) ?? feed[0] ?? null;

  const onFeedKey = (e: React.KeyboardEvent) => {
    if (!wide || !(e.target instanceof HTMLElement) || !e.target.matches("[data-select]")) return;
    const next = moveSelection(
      feed.map((f) => f.insight.id),
      selected?.insight.id ?? null,
      e.key,
    );
    if (!next) return;
    e.preventDefault();
    setSelectedId(next);
    // The focus follows the selection, onto the card's title once it is the Tab stop.
    requestAnimationFrame(() => {
      const el = document.getElementById(`insight-select-${next}`);
      el?.focus();
      el?.scrollIntoView({ block: "nearest" });
    });
  };

  const period = periodName(preset, custom);
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-8 md:px-6">
      <StepHeader
        step="insights"
        title="What the data says"
        lead={`Ranked by impact, for ${period}.`}
        leadFull={`Ranked by impact. Every number below was computed from your data for ${periodWords(preset, custom, bounds)}, with the filters shown; nothing is estimated or written by a model unless you ask for the optional AI summary.`}
        aside={
          <Button variant="secondary" onClick={() => void load()} disabled={updating}>
            {updating ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}{" "}
            Recompute
          </Button>
        }
      >
        <div className="mt-3 empty:hidden">
          <ActiveFilters inline />
        </div>
      </StepHeader>
      <p className="sr-only" aria-live="polite">
        {updating
          ? "Updating insights for this selection…"
          : noRows
            ? "No rows match the current filters."
            : ""}
      </p>
      {noRows ? (
        <EmptyState
          icon={<SearchX className="size-5" aria-hidden />}
          title="No rows match the current filters"
          lead="Remove a filter or widen the date range."
          full="There is nothing to find in an empty selection. Remove a filter or widen the date range to see insights."
          actions={
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : updating && !all.length ? (
        // Placeholders in the page's own shape: the tab row, the feed and, from xl, the panel.
        <div aria-busy="true">
          <div aria-hidden className="mb-5 flex h-9 items-center gap-6 border-b border-border px-3">
            <Skeleton className="h-3.5 w-10" />
            <Skeleton className="h-3.5 w-14" />
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-16" />
          </div>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <FeedSkeleton />
            <div className="hidden xl:block">
              <DetailSkeleton />
            </div>
          </div>
        </div>
      ) : !all.length ? (
        <EmptyState
          icon={<Lightbulb className="size-5" aria-hidden />}
          title="Nothing stands out for this selection"
          lead="Widen the date range or remove filters, then recompute."
          full="Insights need enough history and volume to be meaningful: a trend needs several periods, a gap between groups needs enough rows in each. Widen the date range or remove filters, then recompute."
          actions={
            preset !== "all" || filtered ? (
              <>
                {preset !== "all" && bounds ? (
                  <Button variant="secondary" size="sm" onClick={() => setPreset("all")}>
                    Use all your data
                  </Button>
                ) : null}
                {filtered ? (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : null}
              </>
            ) : null
          }
        />
      ) : (
        <>
          {aiEnabled && !updating ? <AiSummary insights={all} /> : null}
          <Tabs value={activeKind} onValueChange={(v) => setKind(v as InsightKind | "all")}>
            {/* A quiet row of the kinds found, each with its count; it scrolls sideways when it can't fit. The
                analyst's switch for the chart on hover sits at its end (version 54.0). */}
            <div className="mb-5 flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-2">
              {tabs.length > 2 ? (
                <TabsList
                  aria-label="Insight type"
                  className="flex min-w-0 flex-1 [scrollbar-width:none] overflow-x-auto max-sm:-mx-4 max-sm:w-[calc(100%+2rem)] max-sm:[mask-image:linear-gradient(to_right,var(--bg)_calc(100%-2.5rem),transparent)] max-sm:px-4"
                >
                  {tabs.map((t) => (
                    <TabsTrigger key={t.kind} value={t.kind} className="shrink-0">
                      {t.kind === "all" ? "All" : KIND[t.kind].label}
                      <span className="tabular text-xs font-normal text-fg-subtle">{t.count}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              ) : null}
              <ChartOnHoverSwitch />
            </div>
            <TabsContent value={activeKind} tabIndex={-1}>
              {updating ? (
                <p className="mb-3 flex items-center gap-2 text-xs text-fg-muted">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> Updating for this selection…
                </p>
              ) : null}
              <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
                <ol
                  aria-label="Insights, highest impact first"
                  aria-busy={updating}
                  onKeyDown={onFeedKey}
                  className={cn(
                    "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 transition-opacity duration-base",
                    updating ? "opacity-disabled" : "",
                  )}
                >
                  {feed.map(({ insight, rank }) => (
                    <InsightCard
                      key={insight.id}
                      insight={insight}
                      rank={rank}
                      selectable={wide}
                      selected={selected?.insight.id === insight.id}
                      onSelect={() => setSelectedId(insight.id)}
                    />
                  ))}
                </ol>
                {wide && selected ? (
                  <aside
                    aria-label="The selected insight"
                    className={cn(
                      "sticky top-20 max-h-[calc(100dvh-6.5rem)] min-w-0 overflow-y-auto rounded-card transition-opacity duration-base",
                      updating ? "opacity-disabled" : "",
                    )}
                  >
                    <InsightDetail insight={selected.insight} rank={selected.rank} />
                  </aside>
                ) : null}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

/** A friendly stand-in for the feed: what happened, and what to try. */
function EmptyState({
  icon,
  title,
  lead,
  full,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  lead: string;
  full: string;
  actions?: React.ReactNode;
}) {
  return (
    <div
      data-insights-empty
      className="flex flex-col items-center rounded-card border border-dashed border-border-strong px-6 py-14 text-center"
    >
      <span className="grid size-11 place-items-center rounded-full bg-surface-3 text-fg-muted">{icon}</span>
      <h2 className="mt-4 text-md font-semibold text-fg">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-fg-muted">
        <Brief full={full}>{lead}</Brief>
      </p>
      {actions ? <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * "Chart on hover" (version 54.0): for analysts, hovering or focusing an insight shows the chart it
 * describes beside it (analyse/InsightPeek.tsx). Off by default; the same switch is in Settings.
 */
function ChartOnHoverSwitch() {
  const on = useSettings((s) => s.insightChartOnHover);
  const setOn = useSettings((s) => s.setInsightChartOnHover);
  return (
    <label className="flex shrink-0 items-center gap-2 pb-2 text-ui text-fg-muted">
      <Switch checked={on} onCheckedChange={setOn} />
      Chart on hover
      <InfoTip label="About the chart on hover">
        For analysts: hover or focus an insight to see the chart it describes beside it, to check its figures
        against the picture.
      </InfoTip>
    </label>
  );
}
