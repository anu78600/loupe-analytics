"use client";

/**
 * One dashboard chart: header (title, drill breadcrumb, caption of rows,
 * period and filters), the chart or its table twin, and the toolbar: "why
 * this chart" popover, alternative kinds, table toggle, Top N, PNG/SVG/CSV
 * export and hide/delete.
 *
 * Clicks: on a time axis they set a custom date range for that bucket (a
 * zoom on a long time chart offers the same); the toast's Undo restores the
 * exact period that was active before. On a category they drill down while
 * the spec has levels left, otherwise they cross-filter every other chart
 * (the source chart highlights instead of filtering itself); a tile-map click
 * filters on the data's own spelling of the state. Analysis charts (RFM,
 * cohort, basket, funnel) and "Others" are not clickable. Data arrives
 * through the workspace store; this component only renders it and
 * dispatches store actions.
 */
import * as React from "react";
import {
  BarChart3,
  ChevronRight,
  Download,
  EyeOff,
  FileImage,
  FileSpreadsheet,
  Info,
  Layers,
  MoreHorizontal,
  SlidersHorizontal,
  Table2,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import type { ChartData, ChartKind, ChartSpec } from "@/engine/charts/types";
import { isKindCompatible } from "@/engine/charts/recommend";
import { bucketLabel, endOfBucket, formatRange, isoDate } from "@/engine/core/dates";
import { formatCount, type NumberLocale } from "@/engine/core/format";
import { PRESET_LABEL } from "@/engine/core/periods";
import { useWorkspace, type Widget } from "@/store/workspace";
import { engine } from "@/lib/engine-client";
import { cn, downloadBlob, downloadDataUrl, slugify } from "@/lib/utils";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Tooltip } from "@/ui/primitives/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/primitives/popover";
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
import { Skeleton } from "@/ui/primitives/misc";
import { useAnimate, useChartThemeKey, useFmt } from "@/ui/common/hooks";
import { EChart, type ChartClick, type EChartHandle } from "./EChart";
import { DataTable } from "./DataTable";
import { buildOption, rendersWithECharts, type GeoTileDatum } from "./options";
import { readChartTokens } from "./tokens";

/** User-facing name of each chart kind (kind menus and labels). */
export const KIND_LABEL: Record<ChartKind, string> = {
  line: "Line",
  area: "Area",
  bar: "Columns",
  hbar: "Bars",
  stackedBar: "Stacked columns",
  donut: "Donut",
  treemap: "Treemap",
  scatter: "Scatter",
  histogram: "Histogram",
  box: "Box plot",
  heatmap: "Heatmap",
  funnel: "Funnel",
  waterfall: "Waterfall",
  bullet: "Bullet",
  cohort: "Cohort heatmap",
  bump: "Bump",
  pareto: "Pareto",
  geoTile: "Tile map",
  table: "Table",
  pie: "Pie",
  groupedBar: "Grouped columns",
  stackedBar100: "100% stacked columns",
  stackedArea: "Stacked area",
  step: "Step line",
  lollipop: "Lollipop",
  dumbbell: "Dumbbell",
  bubble: "Bubble",
  radar: "Radar",
  gauge: "Gauge",
  sunburst: "Sunburst",
  sankey: "Sankey",
  calendar: "Calendar heatmap",
  bigNumber: "Big number",
};

const TOPN = [5, 10, 15, 20];

/**
 * Kinds whose marks aren't plain categories of the x column (points placed
 * by two measures, polygons, flows, rings, single figures): no Top N menu
 * and no click-to-filter.
 */
const NOT_CATEGORICAL = new Set<ChartKind>([
  "scatter",
  "bubble",
  "radar",
  "sankey",
  "sunburst",
  "gauge",
  "bigNumber",
]);

/** Stable empty drill path for charts that are not drilled into (see the selector below). */
const NO_DRILL: string[] = [];

/** "<rows> rows · <period> · <n> filters · grain: <x>", so every chart states the slice it shows. Rows follow the number-format setting. */
function useCaption(data: ChartData | undefined, locale: NumberLocale): string {
  const preset = useWorkspace((s) => s.datePreset);
  const custom = useWorkspace((s) => s.customRange);
  const dims = useWorkspace((s) => s.dimFilters.length + (s.crossFilter ? 1 : 0));
  const grain = useWorkspace((s) => s.context?.grainLabel ?? "");
  const period = preset === "custom" && custom ? formatRange(custom.from, custom.to) : PRESET_LABEL[preset];
  const parts = [period, dims ? `${dims} filter${dims > 1 ? "s" : ""}` : "No filters"];
  if (data && !data.empty) parts.unshift(`${formatCount(data.totalRows, locale)} rows`);
  return `${parts.join(" · ")}${grain ? ` · ${grain.replace(/^One row per /i, "grain: ")}` : ""}`;
}

/** `data` undefined = not computed yet (skeleton). `editable` false hides the inspector and hide/delete actions. */
export function ChartCard({
  spec,
  widget,
  data,
  editable = true,
}: {
  spec: ChartSpec;
  widget: Widget;
  data?: ChartData;
  editable?: boolean;
}) {
  const fmt = useFmt();
  // The user's own title from the Customise step, else the spec's.
  const chartTitle = widget.title?.trim() || spec.title;
  // Changes with the light/dark theme and with the chart colours.
  const themeKey = useChartThemeKey();
  const animate = useAnimate();
  const chartRef = React.useRef<EChartHandle>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [tableView, setTableView] = React.useState(false);
  // Range from a zoom on a time chart, offered as a "Filter to …" button instead of being applied straight away.
  const [zoomRange, setZoomRange] = React.useState<{ from: number; to: number } | null>(null);
  const kind = widget.kind ?? spec.kind;
  // Fall back to a shared constant: a fresh `[]` would be a new snapshot on every read and loop forever.
  const drillPath = useWorkspace((s) => s.drill[spec.id] ?? NO_DRILL);
  const crossFilter = useWorkspace((s) => s.crossFilter);
  const highlight = useWorkspace((s) => s.highlight === spec.id);
  const selected = useWorkspace((s) => s.selected?.type === "chart" && s.selected.id === spec.id);
  const updateWidget = useWorkspace((s) => s.updateWidget);
  const setCrossFilter = useWorkspace((s) => s.setCrossFilter);
  const drillDown = useWorkspace((s) => s.drillDown);
  const drillUp = useWorkspace((s) => s.drillUp);
  const select = useWorkspace((s) => s.select);
  const setDatePreset = useWorkspace((s) => s.setDatePreset);
  const removeChart = useWorkspace((s) => s.removeChart);
  const caption = useCaption(data, fmt.locale);

  const drillLevel = drillPath.length;
  const canDrill = Boolean(spec.drill && drillLevel < (spec.drill?.length ?? 0) - 1);
  // The column clicks refer to: the drilled level's column, else the x column.
  const currentColumn =
    spec.drill && drillLevel
      ? (spec.drill[drillLevel] as string)
      : spec.x.kind === "column"
        ? spec.x.column
        : null;
  // When this chart is the cross-filter source it keeps all categories and highlights the chosen one.
  const sourceHighlight = crossFilter && crossFilter.sourceId === spec.id ? crossFilter.value : null;

  const option = React.useMemo(() => {
    if (!data || data.empty || !rendersWithECharts(kind, data)) return null;
    // themeKey is a dependency only: a theme change must re-read the CSS tokens below.
    void themeKey;
    return buildOption({
      tokens: readChartTokens(),
      fmt,
      kind,
      spec,
      data,
      highlight: sourceHighlight,
      animate,
    });
  }, [data, kind, spec, fmt, themeKey, sourceHighlight, animate]);

  // Sets a date range picked on this chart. Undo puts back exactly the period
  // that was active before (named preset or custom range), not "all time".
  const applyRange = (range: { from: number; to: number }, message: string) => {
    const before = useWorkspace.getState();
    const previous = { preset: before.datePreset, range: before.customRange ?? undefined };
    setDatePreset("custom", range);
    toast(message, {
      action: { label: "Undo", onClick: () => setDatePreset(previous.preset, previous.range) },
    });
  };

  const onClick = (p: ChartClick) => {
    if (!data) return;
    // A calendar cell is one day (sent as YYYY-MM-DD text): it becomes the date range.
    if (kind === "calendar") {
      const day = Array.isArray(p.data) ? p.data[0] : undefined;
      const hit = data.categories.find((c) => typeof c.raw === "number" && isoDate(c.raw) === day);
      if (hit && typeof hit.raw === "number")
        applyRange(
          { from: hit.raw, to: endOfBucket(hit.raw, "day") },
          `Filtered to ${bucketLabel(hit.raw, "day", true)}`,
        );
      return;
    }
    if (NOT_CATEGORICAL.has(kind)) return;
    const cat = data.categories[p.dataIndex];
    // A time bucket becomes the global date range (whole bucket, start to end).
    if (spec.x.kind === "time" && cat && typeof cat.raw === "number" && data.grain) {
      applyRange(
        { from: cat.raw, to: endOfBucket(cat.raw, data.grain) },
        `Filtered to ${bucketLabel(cat.raw, data.grain, true)}`,
      );
      return;
    }
    if (data.rfm || data.cohorts || data.basket || data.funnel) return;
    let label: string | undefined;
    if (kind === "geoTile") {
      // Tiles are laid out per state, so dataIndex is a grid position, not a
      // category. A tile with data carries the data's own spelling of its state
      // ("MH" for Maharashtra), which is what the filter must compare; a tile
      // without data has nothing to filter to.
      label = (p.data as Partial<GeoTileDatum> | undefined)?.category;
    } else {
      if (cat?.isOthers) return;
      label = cat?.label ?? p.name;
    }
    if (!currentColumn || !label || label === "Others") return;
    if (canDrill) drillDown(spec.id, label);
    else setCrossFilter(spec.id, currentColumn, label);
  };

  // Charts export from ECharts' own canvas on the card's surface colour;
  // table views are rasterised from the DOM (html-to-image, loaded on demand).
  const exportPng = async (transparent: boolean) => {
    const name = `${slugify(chartTitle)}${transparent ? "-transparent" : ""}.png`;
    if (option && chartRef.current && !tableView) {
      const bg = readChartTokens().surface;
      const url = chartRef.current.toPng({ transparent, background: bg });
      if (url) downloadDataUrl(url, name);
      return;
    }
    if (bodyRef.current) {
      const { toPng } = await import("html-to-image");
      const url = await toPng(bodyRef.current, {
        pixelRatio: 2,
        backgroundColor: transparent ? undefined : readChartTokens().surface,
      });
      downloadDataUrl(url, name);
    }
  };

  const exportSvg = async () => {
    const svg = await chartRef.current?.toSvg();
    if (svg) downloadBlob(svg, `${slugify(chartTitle)}.svg`, "image/svg+xml");
    else toast.error("SVG export is available for chart views, not tables.");
  };

  // The worker builds the CSV from this chart's last computed data (current filters, drill and top N).
  const exportCsv = async () => {
    const csv = await engine().chartCsv(spec.id);
    if (!csv) {
      toast.error("Nothing to export yet.");
      return;
    }
    downloadBlob(csv, `${slugify(chartTitle)}.csv`, "text/csv;charset=utf-8");
  };

  const categoryCount = data?.categories.length;
  // Recommended kind first, then de-duplicated alternatives that suit this spec and category count.
  const kinds = [spec.kind, ...spec.alternatives]
    .filter((k, i, a) => a.indexOf(k) === i)
    .filter((k) => isKindCompatible(k, spec, categoryCount));
  // Plain category charts get the Top N menu and click-to-filter.
  const categorical = spec.x.kind === "column" && !spec.analysis && !NOT_CATEGORICAL.has(kind);
  // While drilled, drop the " by <dimension>" suffix and show the drill path instead.
  const title = drillLevel
    ? `${chartTitle.replace(/ by [^›]+$/, "")} · ${drillPath.join(" › ")}`
    : chartTitle;
  const showTable = tableView || (data && !rendersWithECharts(kind, data));
  const notes = data?.notes ?? [];

  return (
    <section
      id={`chart-${spec.id}`}
      aria-labelledby={`chart-title-${spec.id}`}
      className={cn(
        "group/card relative flex h-full min-h-0 flex-col rounded-card border bg-surface-1 shadow-card transition-[border-color,box-shadow] duration-300",
        selected ? "border-border-accent" : "border-border",
        highlight && "border-accent shadow-[0_0_0_4px_var(--accent-soft)]",
      )}
    >
      <header className="flex items-start gap-2 px-4 pt-3.5 pb-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            {drillLevel ? (
              <button
                type="button"
                onClick={() => drillUp(spec.id, drillLevel)}
                className="text-ui text-fg-subtle hover:text-fg"
                aria-label="Back to top level"
              >
                {chartTitle.replace(/ by .+$/, "")}
              </button>
            ) : null}
            {drillLevel ? <ChevronRight className="size-3 text-fg-subtle" aria-hidden /> : null}
            {/* Two lines before an ellipsis, so a title is read rather than guessed. */}
            <h3
              id={`chart-title-${spec.id}`}
              className="line-clamp-2 min-w-0 text-[13.5px] leading-snug font-medium tracking-[-0.005em] break-words text-fg"
              title={title}
            >
              {drillLevel ? drillPath.join(" › ") : title}
            </h3>
            {spec.source === "custom" ? <Badge tone="accent">Custom</Badge> : null}
          </div>
          <p className="mt-0.5 truncate text-2xs text-fg-subtle" title={caption}>
            {caption}
          </p>
        </div>
        <div className="no-print flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity md:opacity-60 md:group-focus-within/card:opacity-100 md:group-hover/card:opacity-100">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Why this chart">
                <Info aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <p className="text-2xs font-medium tracking-[0.1em] text-fg-subtle uppercase">Why this chart</p>
              <p className="mt-1.5 text-ui leading-relaxed text-fg">{spec.reason}</p>
              {spec.measures.length ? (
                <p className="mt-2 text-2xs text-fg-muted">
                  Measures: {spec.measures.map((m) => m.label).join(", ")}
                  {spec.topN
                    ? ` · Top ${widget.topN ?? spec.topN}${spec.others ? " + Others (recomputed, not summed)" : ""}`
                    : ""}
                </p>
              ) : null}
              {spec.drill ? (
                <p className="mt-1 text-2xs text-fg-muted">Click a bar to drill: {spec.drill.join(" › ")}.</p>
              ) : categorical ? (
                <p className="mt-1 text-2xs text-fg-muted">Click a bar to filter every chart by it.</p>
              ) : null}
            </PopoverContent>
          </Popover>
          {kinds.length > 1 ? (
            <DropdownMenu>
              <Tooltip content="Alternatives">
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Switch chart type">
                    <BarChart3 aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent>
                <DropdownMenuLabel>Chart type</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={kind}
                  onValueChange={(v) =>
                    updateWidget(spec.id, { kind: v === spec.kind ? undefined : (v as ChartKind) })
                  }
                >
                  {kinds.map((k) => (
                    <DropdownMenuRadioItem key={k} value={k}>
                      {KIND_LABEL[k]}
                      {k === spec.kind ? (
                        <span className="ml-auto pl-3 text-2xs text-fg-subtle">recommended</span>
                      ) : null}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Tooltip content={showTable ? "Show chart" : "Show as table"}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-pressed={tableView}
              aria-label="Toggle table view"
              onClick={() => setTableView((v) => !v)}
              disabled={!data || (!!data && !rendersWithECharts(kind, data))}
            >
              <Table2 aria-hidden />
            </Button>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Chart actions">
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-56">
              {categorical ? (
                <>
                  <DropdownMenuLabel>Show top</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={String(widget.topN ?? spec.topN ?? 15)}
                    onValueChange={(v) => updateWidget(spec.id, { topN: Number(v) })}
                  >
                    {TOPN.map((n) => (
                      <DropdownMenuRadioItem key={n} value={String(n)}>
                        Top {n}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuLabel>Export</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => void exportPng(false)}>
                <FileImage aria-hidden /> PNG (2×)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportPng(true)}>
                <FileImage aria-hidden /> PNG, transparent
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportSvg()} disabled={!option}>
                <Download aria-hidden /> SVG
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportCsv()}>
                <FileSpreadsheet aria-hidden /> CSV of this chart
              </DropdownMenuItem>
              {editable ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => select({ type: "chart", id: spec.id })}>
                    <SlidersHorizontal aria-hidden /> Edit in inspector
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => removeChart(spec.id)}>
                    <EyeOff aria-hidden /> {spec.source === "custom" ? "Delete chart" : "Hide chart"}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div ref={bodyRef} className="relative min-h-0 flex-1 px-3 pb-2">
        {!data ? (
          <ChartSkeleton kind={kind} />
        ) : data.empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <Layers className="size-5 text-fg-subtle" aria-hidden />
            <p className="text-ui text-fg-muted">{data.notes[0] ?? "No data for the current filters."}</p>
          </div>
        ) : showTable ? (
          <DataTable spec={spec} data={data} fmt={fmt} caption={chartTitle} />
        ) : (
          <EChart
            ref={chartRef}
            option={option}
            resetKey={`${kind}-${themeKey}-${drillLevel}`}
            ariaLabel={data.altText}
            onClick={onClick}
            onZoom={
              spec.x.kind === "time"
                ? (a, b) => {
                    const from = data.categories[a]?.raw;
                    const to = data.categories[b]?.raw;
                    if (typeof from === "number" && typeof to === "number" && data.grain)
                      setZoomRange({ from, to: endOfBucket(to, data.grain) });
                  }
                : undefined
            }
          />
        )}
        {zoomRange ? (
          <div className="absolute top-1 right-4 z-10">
            <Button
              size="xs"
              variant="secondary"
              onClick={() => {
                applyRange(zoomRange, `Filtered to ${formatRange(zoomRange.from, zoomRange.to)}`);
                setZoomRange(null);
              }}
            >
              <ZoomIn aria-hidden /> Filter to {formatRange(zoomRange.from, zoomRange.to)}
            </Button>
          </div>
        ) : null}
      </div>
      {notes.length && data && !data.empty ? (
        <footer className="border-t border-border px-4 py-1.5">
          <p className="truncate text-2xs text-fg-subtle" title={notes.join(" ")}>
            {notes[0]}
          </p>
        </footer>
      ) : null}
    </section>
  );
}

/** Loading placeholder shaped like the chart kind (ring, horizontal bars, or columns). */
export function ChartSkeleton({ kind }: { kind: ChartKind }) {
  if (kind === "donut")
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="size-36 rounded-full" />
      </div>
    );
  if (kind === "hbar")
    return (
      <div className="flex h-full flex-col justify-center gap-2.5 px-2">
        {[92, 76, 64, 51, 40, 28].map((w) => (
          <Skeleton key={w} className="h-3" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  return (
    <div className="flex h-full items-end gap-1.5 px-2 pb-4">
      {[38, 52, 46, 61, 58, 72, 66, 80, 74, 88, 79, 92].map((h, i) => (
        <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}
