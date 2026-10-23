"use client";

/**
 * A chart drawn straight onto a card of the Analyse phase (version 50.4): an
 * answer's chart on the Questions step, and an insight's chart in the
 * Insights step's detail panel when the dashboard has no current data for it.
 *
 * The data is computed in the worker for the filters given (a question's own
 * rows, or the dashboard's selection) under the chart's own id, so it never
 * replaces the dashboard's results for another chart. The option comes from
 * ui/charts/options.ts with the colours read from the chart tokens, and is
 * rebuilt when the theme or the chart colours change (useChartThemeKey).
 * Charts that don't draw with ECharts (tables, baskets) show their table
 * twin. Nothing here is clickable: a click on the dashboard filters it, but
 * here it would change rows the reader can't see.
 */
import * as React from "react";
import { Layers } from "lucide-react";
import type { ChartData, ChartKind, ChartSpec } from "@/engine/charts/types";
import type { Filter } from "@/engine/query/filter";
import { engine } from "@/lib/engine-client";
import { cn } from "@/lib/utils";
import { useAnimate, useChartThemeKey, useFmt } from "@/ui/common/hooks";
import { ChartSkeleton } from "@/ui/charts/ChartCard";
import { DataTable } from "@/ui/charts/DataTable";
import { EChart } from "@/ui/charts/EChart";
import { buildOption, rendersWithECharts } from "@/ui/charts/options";
import { readChartTokens } from "@/ui/charts/tokens";

/** The drawing area's width in 20 px steps, so labels fit their slots without a rebuild on every pixel. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, { width: number; height: number } | undefined] {
  const ref = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState<{ width: number; height: number } | undefined>(undefined);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const width = Math.round((entry?.contentRect.width ?? 0) / 20) * 20;
      const height = Math.round((entry?.contentRect.height ?? 0) / 20) * 20;
      if (width && height)
        setBox((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box];
}

/** Data computed for one spec and its filters, or null when it couldn't be computed. */
export function useChartData(
  spec: ChartSpec,
  filters: Filter[],
  opts?: { kind?: ChartKind; topN?: number; grain?: "day" | "week" | "month" | "quarter" },
): ChartData | null | undefined {
  const fmt = useFmt();
  const kind = opts?.kind;
  const topN = opts?.topN;
  const grain = opts?.grain;
  // Tagged with the request it answers, so a new request shows the skeleton instead of the last chart.
  const [result, setResult] = React.useState<{ key: string; data: ChartData | null } | null>(null);
  const key = React.useMemo(
    () =>
      JSON.stringify([spec.id, spec.kind, kind ?? null, topN ?? null, grain ?? null, filters, fmt.locale]),
    [spec, kind, topN, grain, filters, fmt.locale],
  );
  React.useEffect(() => {
    let live = true;
    engine()
      .previewChart(filters, { specId: spec.id, spec, kind, topN, grain }, fmt.locale)
      .then((d) => {
        if (live) setResult({ key, data: d });
      })
      .catch(() => {
        if (live) setResult({ key, data: null });
      });
    return () => {
      live = false;
    };
  }, [key, spec, filters, kind, topN, grain, fmt.locale]);
  return result?.key === key ? result.data : undefined;
}

/**
 * The chart for `data` (undefined while it is computed): the plot, its table
 * twin when asked for or when the kind is a table, its loading shape, or why
 * it is empty.
 */
export function ChartView({
  spec,
  kind,
  data,
  table = false,
  className,
}: {
  spec: ChartSpec;
  kind?: ChartKind;
  data: ChartData | null | undefined;
  table?: boolean;
  className?: string;
}) {
  const fmt = useFmt();
  const themeKey = useChartThemeKey();
  const animate = useAnimate();
  const [ref, box] = useWidth();
  const drawKind = kind ?? spec.kind;
  const width = box?.width;
  const height = box?.height;
  const option = React.useMemo(() => {
    // themeKey is a dependency only: a theme change must re-read the CSS tokens.
    void themeKey;
    if (!data || data.empty || !rendersWithECharts(drawKind, data)) return null;
    return buildOption({
      tokens: readChartTokens(),
      fmt,
      kind: drawKind,
      spec,
      data,
      animate,
      width,
      height,
    });
  }, [data, drawKind, spec, fmt, themeKey, animate, width, height]);
  const tableView = Boolean(data && !data.empty && (table || !rendersWithECharts(drawKind, data)));
  return (
    <div ref={ref} className={cn("relative min-h-0", className, tableView && "h-auto")}>
      {data === undefined ? (
        <ChartSkeleton kind={drawKind} />
      ) : !data || data.empty ? (
        <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
          <Layers className="size-5 text-fg-subtle" aria-hidden />
          <p className="max-w-xs text-ui text-fg-muted">{data?.notes[0] ?? "No data for these rows."}</p>
        </div>
      ) : tableView ? (
        <DataTable
          spec={spec}
          data={data}
          fmt={fmt}
          maxRows={50}
          caption={spec.title}
          className="max-h-72 overflow-auto"
        />
      ) : (
        <EChart
          option={option}
          resetKey={`${drawKind}-${themeKey}`}
          ariaLabel={data.altText}
          className="h-full w-full"
        />
      )}
    </div>
  );
}
