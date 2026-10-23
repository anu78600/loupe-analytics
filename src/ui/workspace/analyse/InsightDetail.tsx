"use client";

/**
 * The Insights step's detail panel (version 50.4), beside the feed from xl:
 * the selected insight in full (its rank, kind and tone, its title, its whole
 * sentence of figures, its impact and confidence, and how it was found),
 * then the chart it describes and "Open on the dashboard" (focusChart).
 *
 * The chart is the dashboard's own: its spec, its type and Top N as the user
 * set them, and its data from the dashboard's last refresh (the store's
 * charts, computed for the same selection the insights describe). A chart
 * that isn't on the dashboard just now (hidden, or not in this layout) is
 * computed for the dashboard's selection under an id of its own, so the
 * dashboard's results stay as they are. It is drawn without the card's
 * actions and clicks, and without the card's element id, which focusChart
 * looks for on the dashboard. An insight without a chart keeps its full text
 * and figures here.
 */
import * as React from "react";
import { ArrowRight, LineChart } from "lucide-react";
import type { Insight } from "@/engine/insights/insights";
import type { ChartData, ChartKind, ChartSpec } from "@/engine/charts/types";
import { allSpecs, useWorkspace } from "@/store/workspace";
import { useFmt } from "@/ui/common/hooks";
import { chartSubtitle } from "@/ui/charts/options";
import { Button } from "@/ui/primitives/button";
import { Skeleton } from "@/ui/primitives/misc";
import { ClampText } from "@/ui/primitives/reveal";
import { cn } from "@/lib/utils";
import { ChartView, useChartData } from "./AnswerChart";
import { ImpactMeter, KIND, TONE } from "./InsightFeed";
import { impactPercent } from "./feed";

/** The trend grains the dashboard sends with its charts (the business context's period). */
const GRAINS = ["day", "week", "month", "quarter"] as const;
type Grain = (typeof GRAINS)[number];
const isGrain = (v: unknown): v is Grain =>
  typeof v === "string" && (GRAINS as readonly string[]).includes(v);

export function InsightDetail({ insight, rank }: { insight: Insight; rank: number }) {
  const focusChart = useWorkspace((s) => s.focusChart);
  const tone = TONE[insight.tone];
  const kind = KIND[insight.kind];
  return (
    <section
      id="insight-detail"
      aria-labelledby="insight-detail-title"
      className="overflow-hidden rounded-card border border-border bg-surface-1 shadow-card"
    >
      <div className="p-5">
        <p className="flex items-center gap-2 text-xs text-fg-subtle">
          <span className={cn("grid size-6 place-items-center rounded-sm", tone.chip)}>
            <tone.icon className="size-3.5" aria-hidden />
          </span>
          <span className="font-figures">#{rank}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1 text-fg-muted">
            <kind.icon className="size-3.5" aria-hidden />
            {kind.label}
          </span>
          <span aria-hidden>·</span>
          <span className={tone.text}>{tone.label}</span>
        </p>
        <h2 id="insight-detail-title" className="mt-3 text-lg font-semibold text-balance text-fg">
          {insight.title}
        </h2>
        <p className="mt-1.5 text-sm text-fg-muted">{insight.body}</p>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border-subtle pt-3 text-xs">
          <dt className="text-fg-subtle">Impact</dt>
          <dt className="text-fg-subtle">Confidence</dt>
          <dd className="flex items-center gap-2 text-fg">
            <ImpactMeter impact={insight.impact} className="w-20" />
            <span className="tabular">{Math.round(impactPercent(insight.impact))} of 100</span>
          </dd>
          <dd className="text-fg first-letter:uppercase">{insight.confidence}</dd>
        </dl>
        <ClampText key={insight.basis} lines={2} className="mt-3 text-xs text-fg-subtle">
          {`How it was found: ${insight.basis}`}
        </ClampText>
      </div>
      {insight.chartId ? (
        <div className="border-t border-border-subtle p-4">
          <InsightChart
            chartId={insight.chartId}
            action={
              <Button variant="secondary" size="xs" onClick={() => focusChart(insight.chartId as string)}>
                Open on the dashboard <ArrowRight aria-hidden />
              </Button>
            }
          />
        </div>
      ) : (
        <p className="flex items-center gap-2 border-t border-border-subtle px-5 py-4 text-xs text-fg-subtle">
          <LineChart className="size-3.5 shrink-0" aria-hidden />
          No chart shows this finding; its figures are above.
        </p>
      )}
    </section>
  );
}

/** The insight's chart: the dashboard's own data when the chart is on it, else computed for its selection. */
function InsightChart({ chartId, action }: { chartId: string; action: React.ReactNode }) {
  const context = useWorkspace((s) => s.context);
  const customCharts = useWorkspace((s) => s.customCharts);
  const widget = useWorkspace((s) => s.widgets.find((w) => w.id === chartId));
  const mode = useWorkspace((s) => s.mode);
  const spec = React.useMemo(
    () => allSpecs({ context, customCharts }).find((s) => s.id === chartId),
    [context, customCharts, chartId],
  );
  if (!spec)
    return (
      <p className="py-6 text-center text-ui text-fg-muted">This chart is no longer on the dashboard.</p>
    );
  const title = widget?.title?.trim() || spec.title;
  const onDashboard = Boolean(widget && !widget.hidden && spec.modes.includes(mode));
  return onDashboard ? (
    <StoredChart spec={spec} title={title} kind={widget?.kind} action={action} />
  ) : (
    <ComputedChart spec={spec} title={title} kind={widget?.kind} topN={widget?.topN} action={action} />
  );
}

/** The chart with the data the dashboard computed for it. */
function StoredChart({
  spec,
  title,
  kind,
  action,
}: {
  spec: ChartSpec;
  title: string;
  kind?: ChartKind;
  action: React.ReactNode;
}) {
  const data = useWorkspace((s) => s.charts[spec.id]);
  return <ChartFrame spec={spec} title={title} kind={kind} data={data} action={action} />;
}

/** The chart computed for the dashboard's selection, under an id of its own. */
function ComputedChart({
  spec,
  title,
  kind,
  topN,
  action,
}: {
  spec: ChartSpec;
  title: string;
  kind?: ChartKind;
  topN?: number;
  action: React.ReactNode;
}) {
  const filtersOf = useWorkspace((s) => s.filters);
  const preset = useWorkspace((s) => s.datePreset);
  const custom = useWorkspace((s) => s.customRange);
  const dims = useWorkspace((s) => s.dimFilters);
  const cross = useWorkspace((s) => s.crossFilter);
  const period = useWorkspace((s) => s.business.period);
  const filters = React.useMemo(() => {
    // The selection is read through filters(); these are what it is made of.
    void preset;
    void custom;
    void dims;
    void cross;
    return filtersOf();
  }, [filtersOf, preset, custom, dims, cross]);
  const own = React.useMemo(() => ({ ...spec, id: `insight_${spec.id}` }), [spec]);
  const data = useChartData(own, filters, {
    kind,
    topN,
    grain: spec.x.kind === "time" && isGrain(period) ? period : undefined,
  });
  return <ChartFrame spec={spec} title={title} kind={kind} data={data} action={action} />;
}

/** The chart's title with the way to it on the dashboard, its takeaway and unit line, then the plot. */
function ChartFrame({
  spec,
  title,
  kind,
  data,
  action,
}: {
  spec: ChartSpec;
  title: string;
  kind?: ChartKind;
  data: ChartData | null | undefined;
  action: React.ReactNode;
}) {
  const fmt = useFmt();
  const subtitle = chartSubtitle(spec, data, fmt, kind ?? spec.kind);
  return (
    <figure className="grid gap-2">
      <figcaption className="grid gap-0.5 px-1">
        <span className="flex min-w-0 items-start justify-between gap-3">
          <span className="min-w-0 pt-0.5 text-ui font-medium text-fg">
            <ClampText key={title}>{title}</ClampText>
          </span>
          <span className="shrink-0">{action}</span>
        </span>
        {data === undefined ? (
          <Skeleton className="mt-1 h-3.5 w-4/5" />
        ) : data && !data.empty && data.headline ? (
          <ClampText key={data.headline} lines={2} className="text-xs text-fg-muted">
            {data.headline}
          </ClampText>
        ) : null}
        {subtitle ? <span className="block text-xs text-fg-subtle">{subtitle}</span> : null}
      </figcaption>
      <ChartView spec={spec} kind={kind} data={data} className="h-60" />
    </figure>
  );
}

/** Placeholders in the panel's shape (the finding, then its chart) while the insights are worked out. */
export function DetailSkeleton() {
  return (
    <div aria-hidden className="overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
      <div className="grid gap-2.5 p-5">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-1 h-5 w-3/4" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-5/6" />
        <div className="mt-3 grid grid-cols-2 gap-4 border-t border-border-subtle pt-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <div className="grid gap-2 border-t border-border-subtle p-4">
        <Skeleton className="h-3.5 w-48" />
        <Skeleton className="h-3 w-64" />
        <div className="mt-2 flex h-52 items-end gap-2 px-2">
          {[38, 52, 46, 61, 58, 72, 66, 80, 74, 88].map((h, i) => (
            <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
