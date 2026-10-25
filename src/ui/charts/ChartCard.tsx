"use client";

/**
 * One dashboard chart (restyled in version 50.3): a raised card whose header
 * carries the title, the drill breadcrumb and the chart's one-sentence
 * takeaway (headline.ts, computed from this data) with its unit line; the
 * body is the chart or its table twin.
 *
 * The actions appear when the card is hovered or holds focus (and stay while
 * one of their menus is open): "Why this chart", the table view, expand (the
 * chart large in a dialog, still clickable) and the menu, which holds the
 * chart type, Top N, the downloads (PNG/SVG/CSV), customise (the inspector),
 * the SQL and DAX of the measures it shows, and hide/delete. On a touch
 * screen, where nothing hovers, they are always shown; they never print.
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
 *
 * A PNG download is framed like a slide (title, takeaway, unit line, then
 * the source and slice under the plot; chartImage.ts), so it says what it
 * shows once it leaves the app. An empty chart offers to clear the filters
 * when filters are what emptied it.
 *
 * The takeaway is up to two lines and the first note one line; when either
 * is cut, hover, focus or a long press opens it in full (ClampText,
 * ui/primitives/reveal.tsx), so its figures are never lost. Further notes
 * are behind the ⓘ beside the first.
 */
import * as React from "react";
import {
  ChevronRight,
  Code2,
  Download,
  EyeOff,
  FileImage,
  FileSpreadsheet,
  Info,
  Layers,
  Maximize2,
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
import { UTF8_BOM } from "@/engine/export/csv";
import { CHART_TYPES } from "@/engine/charts/catalogue";
import { defaultPreset, PRESET_LABEL } from "@/engine/core/periods";
import { isRosterView, useWorkspace, type Widget } from "@/store/workspace";
import { engine } from "@/lib/engine-client";
import { cn, downloadBlob, downloadDataUrl, exportFileName } from "@/lib/utils";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/primitives/dialog";
import { Segmented } from "@/ui/primitives/segmented";
import { Skeleton } from "@/ui/primitives/misc";
import { ClampText, InfoTip } from "@/ui/primitives/reveal";
import { chartGlossaryHref, GlossaryLink } from "@/ui/common/GlossaryLink";
import { useAnimate, useChartThemeKey, useFmt } from "@/ui/common/hooks";
import { EChart, type ChartClick, type EChartHandle } from "./EChart";
import { DataTable } from "./DataTable";
import { buildOption, chartSubtitle, rendersWithECharts, type GeoTileDatum } from "./options";
import { readChartTokens } from "./tokens";
import { framedChartPng } from "./chartImage";
import { deleteWithUndo } from "@/ui/workspace/customise/ChartList";
import { chartProblem } from "@/ui/workspace/customise/brokenCharts";
import { ChartSqlDialog, chartKpis } from "@/ui/workspace/dashboard/ChartSql";

/**
 * Each chart kind's name, taken from the chart catalogue, so the switcher,
 * the builder and the catalogue page never call one chart two things.
 */
export const KIND_LABEL = Object.fromEntries(CHART_TYPES.map((t) => [t.kind, t.name])) as Record<
  ChartKind,
  string
>;

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

type Box = { width: number; height: number };

/**
 * A chart area's size in 20 px steps, so category labels get the characters
 * (and bar names the rows) their slots hold, without the option being rebuilt
 * on every pixel of a resize. Set in the observer's callback.
 */
function useBox(): [React.RefObject<HTMLDivElement | null>, Box | undefined] {
  const ref = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState<Box | undefined>(undefined);
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
  const chartRef = React.useRef<EChartHandle>(null);
  const [bodyRef, box] = useBox();
  const [tableView, setTableView] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [sqlOpen, setSqlOpen] = React.useState(false);
  const kind = widget.kind ?? spec.kind;
  // Fall back to a shared constant: a fresh `[]` would be a new snapshot on every read and loop forever.
  const drillPath = useWorkspace((s) => s.drill[spec.id] ?? NO_DRILL);
  const highlight = useWorkspace((s) => s.highlight === spec.id);
  const selected = useWorkspace((s) => s.selected?.type === "chart" && s.selected.id === spec.id);
  const updateWidget = useWorkspace((s) => s.updateWidget);
  const drillUp = useWorkspace((s) => s.drillUp);
  const select = useWorkspace((s) => s.select);
  const removeChart = useWorkspace((s) => s.removeChart);
  const context = useWorkspace((s) => s.context);
  const caption = useCaption(data, fmt.locale);

  const drillLevel = drillPath.length;
  const subtitle = chartSubtitle(spec, data, fmt, kind);
  const drawn = Boolean(data && !data.empty && rendersWithECharts(kind, data));

  // Charts export from ECharts' own canvas on the card's surface colour;
  // table views are rasterised from the DOM (html-to-image, loaded on demand).
  // Single charts follow the export naming: "{dataset}_{chart title}_{date}.{ext}".
  const fileName = (ext: string, suffix = "") =>
    exportFileName(useWorkspace.getState().summary?.name, `${chartTitle}${suffix}`, ext);
  // The plot (or the table view) framed like a slide: title, takeaway and unit above it, the file
  // and the slice of it the chart shows below it.
  const exportPng = async (transparent: boolean) => {
    const name = fileName("png", transparent ? " transparent" : "");
    const tokens = readChartTokens();
    const background = transparent ? undefined : tokens.surface;
    let image: string | null = null;
    if (drawn && chartRef.current && !tableView) {
      image = chartRef.current.toPng({ transparent, background: tokens.surface });
    } else if (bodyRef.current) {
      const { toPng } = await import("html-to-image");
      image = await toPng(bodyRef.current, { pixelRatio: 2, backgroundColor: background });
    }
    if (!image) return;
    const file = useWorkspace.getState().summary?.fileName;
    try {
      const framed = await framedChartPng({
        image,
        scale: 2,
        title: drillPath.length
          ? `${chartTitle.replace(/ by [^›]+$/, "")} · ${drillPath.join(" › ")}`
          : chartTitle,
        headline: data && !data.empty ? data.headline : undefined,
        subtitle: subtitle || undefined,
        footer: `Source: ${file ? `${file} · ` : ""}${caption}`,
        tokens,
        background,
      });
      downloadDataUrl(framed, name);
    } catch {
      // The plot on its own is still worth having if the frame can't be drawn.
      downloadDataUrl(image, name);
    }
  };

  const exportSvg = async () => {
    const svg = await chartRef.current?.toSvg();
    if (svg) downloadBlob(svg, fileName("svg"), "image/svg+xml");
    else toast.error("SVG export is available for chart views, not tables.");
  };

  // The worker builds the CSV from this chart's last computed data (current filters, drill and top N).
  const exportCsv = async () => {
    const csv = await engine().chartCsv(spec.id);
    if (!csv) {
      toast.error("Nothing to export yet.");
      return;
    }
    // The byte-order mark makes Excel read the file as UTF-8, so labels with ₹ or accents stay intact.
    downloadBlob(UTF8_BOM + csv, fileName("csv"), "text/csv;charset=utf-8");
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
  const tableOnly = Boolean(data && !rendersWithECharts(kind, data));
  const notes = data?.notes ?? [];
  const hasSql = context ? chartKpis(spec, context.kpis).length > 0 : false;

  return (
    <section
      id={`chart-${spec.id}`}
      aria-labelledby={`chart-title-${spec.id}`}
      className={cn(
        "group/card relative flex h-full min-h-0 flex-col rounded-card border bg-surface-1 shadow-card transition-[border-color,box-shadow] duration-base",
        selected ? "border-border-accent" : "border-border",
        highlight && "border-accent shadow-[0_0_0_4px_var(--accent-soft)]",
      )}
    >
      <header className="flex items-start gap-2 px-4 pt-3.5 pb-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {drillLevel ? (
              <>
                <button
                  type="button"
                  onClick={() => drillUp(spec.id, drillLevel)}
                  className="shrink-0 rounded-xs text-md text-fg-subtle hover:text-fg focus-visible:focus-ring"
                  aria-label="Back to top level"
                >
                  {chartTitle.replace(/ by .+$/, "")}
                </button>
                <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
              </>
            ) : null}
            {/* One line; the whole title on hover, focus or a long press when it is cut. */}
            <h3 id={`chart-title-${spec.id}`} className="min-w-0 text-md font-medium text-fg">
              <ClampText key={title}>{drillLevel ? drillPath.join(" › ") : title}</ClampText>
            </h3>
            {spec.source === "custom" ? (
              <Badge tone="accent" className="shrink-0">
                Custom
              </Badge>
            ) : null}
          </div>
          {/* What the chart says (its takeaway, computed from this data), then the unit: the title
              says what the chart is about, this line what it shows. Two lines; when it is cut, hover,
              focus or a long press shows it whole. Keyed by the sentence, so a new one (after a
              filter) is measured afresh. */}
          {data?.headline && !data.empty ? (
            <ClampText key={data.headline} lines={2} className="mt-0.5 text-ui text-fg-muted">
              {data.headline}
            </ClampText>
          ) : null}
          {subtitle ? <p className="mt-1 text-xs text-fg-subtle">{subtitle}</p> : null}
        </div>
        {/* On hover or focus (and while one of their menus is open); always on a touch screen. */}
        <div className="no-print -mt-0.5 -mr-1.5 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-fast group-focus-within/card:opacity-100 group-hover/card:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(pointer:coarse)]:opacity-100">
          <Popover>
            <Tooltip content="Why this chart">
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Why this chart">
                  <Info aria-hidden />
                </Button>
              </PopoverTrigger>
            </Tooltip>
            <PopoverContent align="end" className="w-80">
              <WhyThisChart spec={spec} widget={widget} caption={caption} categorical={categorical} />
            </PopoverContent>
          </Popover>
          <Tooltip content={tableView ? "Show chart" : "Show as table"}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-pressed={tableView}
              aria-label="Show as table"
              onClick={() => setTableView((v) => !v)}
              disabled={!data || tableOnly}
            >
              <Table2 aria-hidden />
            </Button>
          </Tooltip>
          <Tooltip content="Expand">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Expand chart"
              onClick={() => setExpanded(true)}
            >
              <Maximize2 aria-hidden />
            </Button>
          </Tooltip>
          <DropdownMenu>
            <Tooltip content="More">
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Chart actions">
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent className="max-h-(--radix-dropdown-menu-content-available-height) min-w-56 overflow-y-auto">
              {kinds.length > 1 ? (
                <>
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
                          <span className="ml-auto pl-3 text-xs text-fg-subtle">recommended</span>
                        ) : null}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                </>
              ) : null}
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
              <DropdownMenuLabel>Download</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => void exportPng(false)}>
                <FileImage aria-hidden /> PNG (2×)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportPng(true)}>
                <FileImage aria-hidden /> PNG, transparent
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportSvg()} disabled={!drawn}>
                <Download aria-hidden /> SVG
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportCsv()}>
                <FileSpreadsheet aria-hidden /> CSV of this chart
              </DropdownMenuItem>
              {editable || hasSql ? <DropdownMenuSeparator /> : null}
              {editable ? (
                <DropdownMenuItem onSelect={() => select({ type: "chart", id: spec.id })}>
                  <SlidersHorizontal aria-hidden /> Customise
                </DropdownMenuItem>
              ) : null}
              {hasSql ? (
                <DropdownMenuItem onSelect={() => setSqlOpen(true)}>
                  <Code2 aria-hidden /> SQL and DAX
                </DropdownMenuItem>
              ) : null}
              {editable ? (
                // Deleting one of the user's own charts can be undone from its toast, back in place.
                <DropdownMenuItem
                  onSelect={() =>
                    spec.source === "custom" ? deleteWithUndo(spec.id, chartTitle) : removeChart(spec.id)
                  }
                >
                  <EyeOff aria-hidden /> {spec.source === "custom" ? "Delete chart" : "Hide chart"}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div ref={bodyRef} className="relative min-h-0 flex-1 px-3 pb-2">
        <ChartBody
          spec={spec}
          kind={kind}
          data={data}
          title={chartTitle}
          table={tableView}
          box={box}
          chartRef={chartRef}
        />
      </div>
      {notes.length && data && !data.empty ? (
        <ChartNotes notes={notes} className="border-t px-4 py-1.5" />
      ) : null}
      {expanded ? (
        <ExpandedChart
          spec={spec}
          kind={kind}
          data={data}
          title={title}
          chartTitle={chartTitle}
          subtitle={subtitle}
          table={tableView}
          onOpenChange={setExpanded}
        />
      ) : null}
      {hasSql ? (
        <ChartSqlDialog spec={spec} title={chartTitle} open={sqlOpen} onOpenChange={setSqlOpen} />
      ) : null}
    </section>
  );
}

/** Why this chart was chosen, the slice it shows, its measures and what a click on it does. */
function WhyThisChart({
  spec,
  widget,
  caption,
  categorical,
}: {
  spec: ChartSpec;
  widget: Widget;
  caption: string;
  categorical: boolean;
}) {
  return (
    <>
      <p className="eyebrow text-fg-subtle">Why this chart</p>
      <p className="mt-1.5 text-sm leading-relaxed text-fg">{spec.reason}</p>
      <GlossaryLink href={chartGlossaryHref(widget.kind ?? spec.kind)} className="mt-1.5" />
      {/* The slice this chart shows, kept here rather than under every chart's title. */}
      <p className="mt-2 text-xs text-fg-muted">Showing: {caption}</p>
      {spec.measures.length ? (
        <p className="mt-2 text-xs text-fg-muted">
          Measures: {spec.measures.map((m) => m.label).join(", ")}
          {spec.topN
            ? ` · Top ${widget.topN ?? spec.topN}${spec.others ? " + Others (recomputed, not summed)" : ""}`
            : ""}
        </p>
      ) : null}
      {spec.drill ? (
        <p className="mt-1 text-xs text-fg-muted">Click a bar to drill: {spec.drill.join(" › ")}.</p>
      ) : categorical ? (
        <p className="mt-1 text-xs text-fg-muted">Click a bar to filter every chart by it.</p>
      ) : null}
    </>
  );
}

/** The chart's notes: the first on one line (in full on hover, focus or a long press), the rest behind the ⓘ. */
function ChartNotes({ notes, className }: { notes: string[]; className?: string }) {
  return (
    <footer className={cn("border-border-subtle", className)}>
      <div className="flex items-center gap-1.5">
        <ClampText key={notes[0]} className="min-w-0 flex-1 text-xs leading-relaxed text-fg-subtle">
          {notes[0]}
        </ClampText>
        {notes.length > 1 ? (
          <InfoTip label={`All ${notes.length} notes`}>
            <span className="grid gap-1">
              {notes.map((n) => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </InfoTip>
        ) : null}
      </div>
    </footer>
  );
}

/**
 * The chart, its table twin, its loading shape or why it is empty; and the
 * clicks on it (date ranges, drill-down, cross-filter). Drawn on the card and,
 * larger, in the expanded view, each at its own size.
 */
function ChartBody({
  spec,
  kind,
  data,
  title,
  table,
  box,
  chartRef,
}: {
  spec: ChartSpec;
  kind: ChartKind;
  data?: ChartData;
  /** The chart's title, the table view's caption. */
  title: string;
  table: boolean;
  box?: Box;
  chartRef?: React.Ref<EChartHandle>;
}) {
  const fmt = useFmt();
  // Changes with the light/dark theme and with the chart colours.
  const themeKey = useChartThemeKey();
  const animate = useAnimate();
  // Range from a zoom on a time chart, offered as a "Filter to …" button instead of being applied straight away.
  const [zoomRange, setZoomRange] = React.useState<{ from: number; to: number } | null>(null);
  const drillPath = useWorkspace((s) => s.drill[spec.id] ?? NO_DRILL);
  const crossFilter = useWorkspace((s) => s.crossFilter);
  const setCrossFilter = useWorkspace((s) => s.setCrossFilter);
  const drillDown = useWorkspace((s) => s.drillDown);
  const setDatePreset = useWorkspace((s) => s.setDatePreset);
  const context = useWorkspace((s) => s.context);
  const userKpis = useWorkspace((s) => s.customKpis);
  const clearFilters = useWorkspace((s) => s.clearFilters);
  // Whether clearing the filters would change what the chart is computed over: a dimension or
  // cross-filter, or a period other than the one a fresh dashboard opens on.
  const filtered = useWorkspace(
    (s) =>
      s.dimFilters.length > 0 ||
      s.crossFilter !== null ||
      s.datePreset !== (isRosterView(s.context) ? "all" : defaultPreset(s.context?.dateBounds ?? null)),
  );
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
  const width = box?.width;
  const height = box?.height;

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
      width,
      height,
    });
  }, [data, kind, spec, fmt, themeKey, sourceHighlight, animate, width, height]);

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

  if (!data) return <ChartSkeleton kind={kind} />;
  if (data.empty) {
    // Why one of the user's own charts can't be drawn (a hidden or missing column, a deleted KPI),
    // in the same words as the Customise step's chart list.
    const problem = context && spec.source === "custom" ? chartProblem(spec, context, userKpis) : null;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
        <Layers className="size-5 text-fg-subtle" aria-hidden />
        <p className="text-ui text-fg-muted">
          {problem ?? data.notes[0] ?? "No data for the current filters."}
        </p>
        {/* When filters (or a narrower period) emptied it, the way back is one click. */}
        {filtered && !problem ? (
          <Button size="xs" variant="secondary" className="mt-2" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>
    );
  }
  if (table || !rendersWithECharts(kind, data))
    return <DataTable spec={spec} data={data} fmt={fmt} caption={title} />;
  return (
    <>
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
    </>
  );
}

/**
 * The chart large, in a dialog: its title, takeaway and unit line, a switch
 * between the chart and its table, the chart itself (clickable as on the
 * card) on the chart surface its palettes are checked against, and its notes.
 */
function ExpandedChart({
  spec,
  kind,
  data,
  title,
  chartTitle,
  subtitle,
  table,
  onOpenChange,
}: {
  spec: ChartSpec;
  kind: ChartKind;
  data?: ChartData;
  title: string;
  chartTitle: string;
  subtitle: string;
  table: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [view, setView] = React.useState<"chart" | "table">(table ? "table" : "chart");
  const [ref, box] = useBox();
  const tableOnly = Boolean(data && !rendersWithECharts(kind, data));
  const notes = data && !data.empty ? data.notes : [];
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(88dvh,880px)] max-w-[min(1280px,calc(100vw-32px))] flex-col gap-3 p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-lg">{title}</DialogTitle>
          {data?.headline && !data.empty ? (
            <DialogDescription>{data.headline}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">The chart, large.</DialogDescription>
          )}
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-fg-subtle">{subtitle}</p>
          {!tableOnly && data && !data.empty ? (
            <Segmented<"chart" | "table">
              ariaLabel="Show as"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: "chart", label: "Chart" },
                { value: "table", label: "Table" },
              ]}
            />
          ) : null}
        </div>
        <div
          ref={ref}
          className="relative min-h-0 flex-1 overflow-auto rounded-card border border-border-subtle bg-surface-1 p-3"
        >
          <ChartBody
            spec={spec}
            kind={kind}
            data={data}
            title={chartTitle}
            table={view === "table"}
            box={box}
          />
        </div>
        {notes.length ? <ChartNotes notes={notes} /> : null}
      </DialogContent>
    </Dialog>
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
