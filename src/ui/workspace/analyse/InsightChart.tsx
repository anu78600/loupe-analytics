"use client";

/**
 * The chart an insight describes (moved out of InsightDetail in version 54.0,
 * so the feed's hover preview can draw it too): the dashboard's own chart,
 * with its spec, type and Top N as the user set them, and its data from the
 * dashboard's last refresh. A chart that isn't on the dashboard just now
 * (hidden, or not in this layout) is computed for the dashboard's selection
 * under an id of its own, so the dashboard's results stay as they are. Drawn
 * without the card's actions and clicks, and without the card's element id,
 * which focusChart looks for on the dashboard.
 */
import * as React from "react";
import type { ChartData, ChartKind, ChartSpec } from "@/engine/charts/types";
import { allSpecs, useWorkspace } from "@/store/workspace";
import { useFmt } from "@/ui/common/hooks";
import { chartSubtitle } from "@/ui/charts/options";
import { Skeleton } from "@/ui/primitives/misc";
import { ClampText } from "@/ui/primitives/reveal";
import { ChartView, useChartData } from "./AnswerChart";

/** The trend grains the dashboard sends with its charts (the business context's period). */
const GRAINS = ["day", "week", "month", "quarter"] as const;
type Grain = (typeof GRAINS)[number];
const isGrain = (v: unknown): v is Grain =>
  typeof v === "string" && (GRAINS as readonly string[]).includes(v);

/** The insight's chart: the dashboard's own data when the chart is on it, else computed for its selection. */
export function InsightChart({
  chartId,
  action,
  height,
}: {
  chartId: string;
  action: React.ReactNode;
  /** The plot's height class; the panel's "h-60" when not given. */
  height?: string;
}) {
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
    <StoredChart spec={spec} title={title} kind={widget?.kind} action={action} height={height} />
  ) : (
    <ComputedChart
      spec={spec}
      title={title}
      kind={widget?.kind}
      topN={widget?.topN}
      action={action}
      height={height}
    />
  );
}

/** The chart with the data the dashboard computed for it. */
function StoredChart({
  spec,
  title,
  kind,
  action,
  height,
}: {
  spec: ChartSpec;
  title: string;
  kind?: ChartKind;
  action: React.ReactNode;
  height?: string;
}) {
  const data = useWorkspace((s) => s.charts[spec.id]);
  return <ChartFrame spec={spec} title={title} kind={kind} data={data} action={action} height={height} />;
}

/** The chart computed for the dashboard's selection, under an id of its own. */
function ComputedChart({
  spec,
  title,
  kind,
  topN,
  action,
  height,
}: {
  spec: ChartSpec;
  title: string;
  kind?: ChartKind;
  topN?: number;
  action: React.ReactNode;
  height?: string;
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
  return <ChartFrame spec={spec} title={title} kind={kind} data={data} action={action} height={height} />;
}

/** The chart's title with the way to it on the dashboard, its takeaway and unit line, then the plot. */
function ChartFrame({
  spec,
  title,
  kind,
  data,
  action,
  height = "h-60",
}: {
  spec: ChartSpec;
  title: string;
  kind?: ChartKind;
  data: ChartData | null | undefined;
  action: React.ReactNode;
  height?: string;
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
      <ChartView spec={spec} kind={kind} data={data} className={height} />
    </figure>
  );
}
