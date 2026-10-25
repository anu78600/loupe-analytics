"use client";

/**
 * One chart on the one-page dashboard (version 50.3), in the dashboard's chart
 * card: the title (up to two lines, never cut in one), its one-sentence
 * takeaway under it (headline.ts, clamped to two lines, whole on hover, focus
 * or a long press), and the chart.
 *
 * On the live page the card's actions appear on hover or keyboard focus, and
 * stay in view on a touch screen: the table view (every chart has one), a
 * larger view in a dialog, and a menu (in the order of the All charts menu)
 * to download it as a framed PNG or as the CSV of its numbers, customise it
 * in All charts, read the SQL and DAX of the KPIs it measures (ChartSql.tsx's
 * dialog), or hide it (the page then takes the next chart). The download
 * draws the card without them (StaticChart, at three times its size), and
 * clamps the takeaway with an ellipsis it can draw (PrintClamp).
 *
 * The live chart follows the chart colours and the theme (readChartTokens on
 * useChartThemeKey) and is laid out for its measured size.
 */
import * as React from "react";
import { toast } from "sonner";
import {
  Code2,
  EyeOff,
  FileImage,
  FileSpreadsheet,
  Maximize2,
  MoreHorizontal,
  SlidersHorizontal,
  Table2,
} from "lucide-react";
import { formatCount, type FormatOptions } from "@/engine/core/format";
import { UTF8_BOM } from "@/engine/export/csv";
import { useWorkspace } from "@/store/workspace";
import { engine } from "@/lib/engine-client";
import { cn, downloadBlob, downloadDataUrl, exportFileName } from "@/lib/utils";
import { useAnimate, useChartThemeKey, useFmt } from "@/ui/common/hooks";
import { framedChartPng } from "@/ui/charts/chartImage";
import { DataTable } from "@/ui/charts/DataTable";
import { EChart, type EChartHandle } from "@/ui/charts/EChart";
import { buildOption } from "@/ui/charts/options";
import { readChartTokens } from "@/ui/charts/tokens";
import { Button } from "@/ui/primitives/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/primitives/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/primitives/dropdown-menu";
import { ClampText } from "@/ui/primitives/reveal";
import { Tooltip } from "@/ui/primitives/tooltip";
import { StaticChart } from "../../export/report";
import { ChartSqlDialog, chartKpis } from "../ChartSql";
import type { PlacedChart } from "./pagePlan";
import { PrintClamp } from "./PrintClamp";

/** What the numbers cover, for a downloaded chart's footer: the file, the period, the filters. */
export interface ChartSource {
  fileName: string;
  periodLabel: string;
  filters: number;
}

/**
 * Runs `fn` once the chart's card is on the All charts view (it mounts a few
 * frames after the view switches), for up to about two seconds.
 */
function whenShown(id: string, fn: () => void) {
  const started = performance.now();
  const seek = () => {
    if (document.getElementById(`chart-${id}`)) fn();
    else if (performance.now() - started < 2000) requestAnimationFrame(seek);
  };
  requestAnimationFrame(seek);
}

export function PageChartCard({
  chart,
  live,
  fmt,
  source,
  flash = false,
}: {
  chart: PlacedChart;
  live: boolean;
  fmt: FormatOptions;
  source: ChartSource;
  /** Briefly outlined, after an insight's "View chart" pointed at it. */
  flash?: boolean;
}) {
  const id = chart.spec.id;
  const titleId = `page-chart-title-${id}`;
  const [table, setTable] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [sqlOpen, setSqlOpen] = React.useState(false);
  // The definitions of the KPIs the chart measures, when it measures any (the All charts dialog).
  const hasSql = useWorkspace((s) => (s.context ? chartKpis(chart.spec, s.context.kpis).length > 0 : false));
  const handle = React.useRef<EChartHandle>(null);
  const body = React.useRef<HTMLDivElement>(null);
  const headline = chart.data.headline;
  const fileName = (ext: string) => exportFileName(useWorkspace.getState().summary?.name, chart.title, ext);

  const customise = () => {
    const ws = useWorkspace.getState();
    ws.focusChart(id);
    // The inspector belongs to All charts: the chart is picked once that view is on screen.
    whenShown(id, () => useWorkspace.getState().select({ type: "chart", id }));
  };
  const hide = () => {
    const { updateWidget } = useWorkspace.getState();
    updateWidget(id, { hidden: true });
    toast(`"${chart.title}" is hidden`, {
      description: "The page shows the next chart. All charts lists it under Not shown.",
      action: { label: "Undo", onClick: () => useWorkspace.getState().updateWidget(id, { hidden: false }) },
    });
  };
  // Framed as the dashboard's chart downloads are (chartImage.ts): the title and takeaway above the
  // plot, what it covers under it.
  const png = async () => {
    const tokens = readChartTokens();
    let image: string | null = null;
    if (!table) image = handle.current?.toPng({ background: tokens.surface }) ?? null;
    else if (body.current) {
      const { toPng } = await import("html-to-image");
      image = await toPng(body.current, { pixelRatio: 2, backgroundColor: tokens.surface });
    }
    if (!image) return void toast.error("The chart isn't drawn yet.");
    const filters = source.filters
      ? `${source.filters} filter${source.filters === 1 ? "" : "s"}`
      : "No filters";
    const footer = `Source: ${source.fileName} · ${formatCount(chart.data.totalRows, fmt.locale)} rows · ${source.periodLabel} · ${filters}`;
    try {
      const framed = await framedChartPng({
        image,
        scale: 2,
        title: chart.title,
        headline: headline || undefined,
        footer,
        tokens,
        background: tokens.surface,
      });
      downloadDataUrl(framed, fileName("png"));
    } catch {
      // The plot on its own is still worth having if the frame can't be drawn.
      downloadDataUrl(image, fileName("png"));
    }
  };
  // The worker writes the CSV from this chart's last computed data (current filters and top N).
  const csv = async () => {
    const text = await engine().chartCsv(id);
    if (!text) return void toast.error("Nothing to download yet.");
    // The byte-order mark makes Excel read the file as UTF-8, so ₹ and accents stay intact.
    downloadBlob(UTF8_BOM + text, fileName("csv"), "text/csv;charset=utf-8");
  };

  return (
    <section
      data-card="chart"
      id={live ? `page-chart-${id}` : undefined}
      aria-labelledby={titleId}
      className={cn(
        "group/card flex min-h-0 min-w-0 flex-col rounded-card border bg-surface-1 shadow-card transition-[border-color,box-shadow] duration-base",
        flash ? "border-accent shadow-[0_0_0_4px_var(--accent-soft)]" : "border-border",
        live
          ? // Stacked below lg; from lg in its place on the page's grid (two thirds, a third, a half).
            cn(
              "h-80 lg:[grid-column:span_var(--span)/span_var(--span)] lg:[grid-row:span_var(--rows)/span_var(--rows)] lg:h-auto",
              chart.span >= 4 && "sm:col-span-2",
            )
          : "[grid-column:span_var(--span)/span_var(--span)] [grid-row:span_var(--rows)/span_var(--rows)]",
      )}
      style={{ "--span": chart.span, "--rows": chart.tall ? 2 : 1 } as React.CSSProperties}
    >
      <header className="px-4 pt-3">
        <div className="flex min-w-0 items-start gap-2">
          <h3
            id={titleId}
            className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug font-medium text-fg"
            title={chart.title}
          >
            {chart.title}
          </h3>
          {live ? (
            // Out of the way until the card is hovered or focused; always there on a touch screen,
            // and while one of its menus is open.
            <div className="-my-1 -mr-2 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-fast group-focus-within/card:opacity-100 group-hover/card:opacity-100 has-[[data-state=open]]:opacity-100 [@media(pointer:coarse)]:opacity-100">
              <Tooltip content={table ? "Show the chart" : "Show as a table"}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Table view"
                  aria-pressed={table}
                  onClick={() => setTable((t) => !t)}
                >
                  <Table2 aria-hidden />
                </Button>
              </Tooltip>
              <Tooltip content="Expand">
                <Button variant="ghost" size="icon-sm" aria-label="Expand" onClick={() => setExpanded(true)}>
                  <Maximize2 aria-hidden />
                </Button>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`More for ${chart.title}`}>
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                {/* In the order of the All charts menu (ChartCard), so the two read alike. */}
                <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuLabel>Download</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => void png()}>
                    <FileImage aria-hidden /> PNG image
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void csv()}>
                    <FileSpreadsheet aria-hidden /> CSV of this chart
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={customise}>
                    <SlidersHorizontal aria-hidden /> Customise
                  </DropdownMenuItem>
                  {hasSql ? (
                    <DropdownMenuItem onSelect={() => setSqlOpen(true)}>
                      <Code2 aria-hidden /> SQL and DAX
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onSelect={hide}>
                    <EyeOff aria-hidden /> Hide chart
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
        {headline ? (
          live ? (
            // Keyed by the sentence, so a new one (after a filter) is measured afresh.
            <ClampText key={headline} lines={2} className="mt-0.5 text-xs text-fg-muted">
              {headline}
            </ClampText>
          ) : (
            <PrintClamp text={headline} lines={2} className="mt-0.5 text-xs text-fg-muted" />
          )
        ) : null}
      </header>
      <div ref={body} className="relative mx-3 mt-1 mb-2.5 min-h-0 flex-1">
        <div className="absolute inset-0">
          {!live ? (
            <StaticChart
              chart={{ spec: chart.spec, data: chart.data, kind: chart.kind }}
              fmt={fmt}
              pixelRatio={3}
              presentation
            />
          ) : table ? (
            <DataTable spec={chart.spec} data={chart.data} fmt={fmt} caption={chart.title} />
          ) : (
            <LiveChart chart={chart} handle={handle} />
          )}
        </div>
      </div>
      {live && hasSql ? (
        <ChartSqlDialog spec={chart.spec} title={chart.title} open={sqlOpen} onOpenChange={setSqlOpen} />
      ) : null}
      {live ? (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle>{chart.title}</DialogTitle>
              {headline ? <DialogDescription>{headline}</DialogDescription> : null}
            </DialogHeader>
            {/* The chart keeps the card surface its palettes are checked against, inside the overlay. */}
            <div className="h-[min(62dvh,560px)] rounded-card border border-border bg-surface-1 p-3">
              {table ? (
                <DataTable spec={chart.spec} data={chart.data} fmt={fmt} caption={chart.title} />
              ) : (
                <LiveChart chart={chart} />
              )}
            </div>
            <div className="flex justify-end">
              <Button size="sm" variant="secondary" onClick={() => setTable((t) => !t)} aria-pressed={table}>
                <Table2 aria-hidden /> {table ? "Show the chart" : "Show as a table"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}

/** A live chart: tooltips, the theme's colours, laid out for its measured size. */
function LiveChart({ chart, handle }: { chart: PlacedChart; handle?: React.Ref<EChartHandle> }) {
  const fmt = useFmt();
  const themeKey = useChartThemeKey();
  const animate = useAnimate();
  const ref = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Rounded to 20 px, so a resize redraws the chart only when its labels could change.
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round((entry?.contentRect.width ?? 0) / 20) * 20;
      const h = Math.round((entry?.contentRect.height ?? 0) / 20) * 20;
      if (w && h)
        setSize((prev) => (prev && prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const option = React.useMemo(() => {
    // themeKey is a dependency only: a theme change must re-read the CSS tokens.
    void themeKey;
    return buildOption({
      tokens: readChartTokens(),
      fmt,
      kind: chart.kind,
      spec: chart.spec,
      data: chart.data,
      animate,
      width: size?.width,
      height: size?.height,
      // Read without hovering: values on the points of a short trend, a donut's shares in a legend.
      presentation: true,
    });
  }, [chart, fmt, themeKey, animate, size]);
  return (
    <div ref={ref} className="h-full w-full">
      <EChart
        ref={handle}
        option={option}
        resetKey={`${chart.kind}-${themeKey}`}
        ariaLabel={chart.data.altText}
      />
    </div>
  );
}
