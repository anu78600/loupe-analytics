"use client";

/**
 * ChartData → ECharts option. Mark specs follow the validated data-viz rules:
 * bars ≤ 24px with 4px rounded data-ends, 2px lines, ≥ 8px markers with a
 * 2px surface ring, hairline solid gridlines, selective direct labels, a legend
 * only for ≥ 2 series, never a dual axis, never a truncated bar axis.
 *
 * Pure functions: ChartData in, plain option object out, colours already
 * resolved from ChartTokens. The analyses with bespoke data (cohort, funnel)
 * are matched on the data shape before the chart kind.
 *
 * Security: tooltips are the one place ECharts renders HTML (set as
 * innerHTML). Category, series, measure and KPI names all come from the file
 * (generic KPI names embed raw column headers), so tooltip markup is built
 * only through heading() and row(), which escape every text argument,
 * formatted values included. Labels, axis ticks, legends and the visual map
 * are drawn as plain text on the canvas (no `rich` styles are used, and the
 * SVG export escapes text nodes), so they are deliberately not HTML-escaped:
 * that would print entities such as "&amp;" on the chart.
 */
import type { EChartsCoreOption } from "echarts/core";
import { formatCount, formatValue, type FormatOptions } from "@/engine/core/format";
import type { ChartData, ChartKind, ChartSpec } from "@/engine/charts/types";
import type { KpiFormat } from "@/registry/schema";
import { INDIA_STATES, matchIndianState, matchUsState, US_STATES } from "@/engine/profile/geo";
import { inkOn, withAlpha, type ChartTokens } from "./tokens";
import { oklch, oklchToHex } from "./palette/colour";

export interface OptionContext {
  tokens: ChartTokens;
  fmt: FormatOptions;
  /** Kind to draw; may differ from spec.kind when the user picked an alternative. */
  kind: ChartKind;
  spec: ChartSpec;
  data: ChartData;
  /** Category label to emphasise (the cross-filter selection); every other mark is dimmed. */
  highlight?: string | null;
  /** False under reduced motion. */
  animate: boolean;
  /** Static rendering for exports: no animation, zoom or end labels. */
  forExport?: boolean;
}

type Obj = Record<string, unknown>;

/** Escapes text for interpolation into tooltip HTML (ECharts sets it as innerHTML). */
export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

// Compact by default (axis ticks, labels); tooltips pass compact = false for full precision.
function fv(v: number | null | undefined, format: KpiFormat, fmt: FormatOptions, compact = true): string {
  return formatValue(v ?? null, format, { ...fmt, compact });
}

function baseTooltip(t: ChartTokens): Obj {
  return {
    backgroundColor: t.tooltip,
    borderColor: t.border,
    borderWidth: 1,
    padding: [8, 11],
    textStyle: { color: t.fg, fontSize: 12, fontFamily: t.fontSans },
    extraCssText: `border-radius:10px;box-shadow:0 12px 32px -8px rgba(0,0,0,${t.dark ? 0.55 : 0.18});`,
    // Keep the tooltip within the chart's bounds instead of overflowing it.
    confine: true,
  };
}

/** Text of an ECharts param field that may be missing (silent series, markers). */
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** A tooltip value as a number for fv(); anything else (ECharts' "-" for a missing cell, arrays) is blank. */
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

// Only plain colour syntax (hex, rgb()/hsl(), names) may reach a style attribute; anything else draws no swatch.
const safeColor = (c: unknown): string =>
  typeof c === "string" && /^[#\w\s(),.%-]+$/.test(c) ? c : "transparent";

// Tooltip HTML helpers. They escape every text argument themselves, so callers
// pass raw strings straight from the data: never concatenate tooltip markup by hand.
const dot = (color: unknown) =>
  `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${safeColor(color)};margin-right:7px;"></span>`;

/** Tooltip title: escaped text, with an optional colour key before it and a warning-toned note after it. */
function heading(text: string, t: ChartTokens, opts: { color?: unknown; note?: string } = {}): string {
  const note = opts.note
    ? ` <span style="color:${t.warning};font-size:11px">· ${escapeHtml(opts.note)}</span>`
    : "";
  return `<div style="font-weight:500;margin-bottom:4px">${opts.color !== undefined ? dot(opts.color) : ""}${escapeHtml(text)}${note}</div>`;
}

/** Tooltip line: escaped label (with an optional colour key) on the left, escaped value on the right. */
function row(label: string, value: string, t: ChartTokens, color?: unknown): string {
  return `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7"><span style="color:${t.muted}">${color !== undefined ? dot(color) : ""}${escapeHtml(label)}</span><span style="font-family:${t.fontMono};font-variant-numeric:tabular-nums;color:${t.fg}">${escapeHtml(value)}</span></div>`;
}

function categoryAxis(t: ChartTokens, labels: string[], extra: Obj = {}): Obj {
  return {
    type: "category",
    data: labels,
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.label, fontSize: 11, fontFamily: t.fontSans, hideOverlap: true, margin: 10 },
    splitLine: { show: false },
    ...extra,
  };
}

/** Value axis in one format; ticks that would overlap their neighbours are dropped rather than drawn over each other. */
function valueAxis(t: ChartTokens, format: KpiFormat, fmt: FormatOptions, extra: Obj = {}): Obj {
  return {
    type: "value",
    axisLine: { show: false },
    axisTick: { show: false },
    splitNumber: 4,
    splitLine: { lineStyle: { color: t.grid, width: 1, type: "solid" } },
    axisLabel: {
      color: t.label,
      fontSize: 11,
      fontFamily: t.fontMono,
      hideOverlap: true,
      formatter: (v: number) => fv(v, format, fmt),
    },
    ...extra,
  };
}

// Tight margins measured to the outer edge of the axis labels (ECharts 6
// outerBounds*, the successor of containLabel), so long labels stay inside.
const GRID: Obj = {
  left: 6,
  right: 18,
  top: 26,
  bottom: 6,
  outerBoundsMode: "same",
  outerBoundsContain: "axisLabel",
};

function animation(ctx: OptionContext): Obj {
  if (!ctx.animate || ctx.forExport) return { animation: false };
  return {
    animation: true,
    animationDuration: 520,
    animationEasing: "cubicOut",
    animationDurationUpdate: 360,
    animationEasingUpdate: "cubicOut",
  };
}

function colorFor(ctx: OptionContext, i: number, isOthers?: boolean): string {
  if (isOthers) return ctx.tokens.other;
  return ctx.tokens.palette[i % 8] as string;
}

function dimmed(ctx: OptionContext, label: string): boolean {
  return Boolean(ctx.highlight && ctx.highlight !== label);
}

function areaGradient(color: string): Obj {
  return {
    type: "linear",
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: withAlpha(color, 0.24) },
      { offset: 1, color: withAlpha(color, 0) },
    ],
  };
}

// ---------------------------------------------------------------- cartesian (line/area/bar/hbar/stacked/histogram/pareto)

/** True for a time bucket that the data or the date filter covers only in part: the last one, and (when flagged) the first. */
function partialBucket(data: ChartData, idx: number): boolean {
  return Boolean(
    (data.partialLast && idx === data.categories.length - 1) || (data.partialFirst && idx === 0),
  );
}

/** Shared tooltip for cartesian charts: category title (flagged when its period is partial), one row per series, then the row count. */
function axisTooltip(ctx: OptionContext): Obj {
  const { data, tokens: t, fmt } = ctx;
  return {
    ...baseTooltip(t),
    trigger: "axis",
    axisPointer: {
      type: ctx.kind === "bar" || ctx.kind === "hbar" || ctx.kind === "histogram" ? "shadow" : "line",
      lineStyle: { color: t.axis },
      shadowStyle: { color: withAlpha(t.accent, 0.06) },
    },
    formatter: (params: unknown) => {
      const list = (Array.isArray(params) ? params : [params]) as Array<{
        dataIndex: number;
        seriesIndex: number;
        color: unknown;
        seriesName: unknown;
        value: unknown;
      }>;
      const first = list[0];
      if (!first) return "";
      const idx = first.dataIndex;
      const cat = data.categories[idx];
      let html = heading(cat?.label ?? "", t, { note: partialBucket(data, idx) ? "partial" : undefined });
      for (const p of list) {
        const s = data.series[p.seriesIndex] ?? data.series[0];
        if (!s) continue;
        html += row(str(p.seriesName), fv(num(p.value), s.format, fmt, false), t, p.color);
      }
      const rows = data.rows[idx];
      if (rows !== undefined) html += row("Rows", formatCount(rows, fmt.locale), t);
      return html;
    },
  };
}

/** Legend only for two or more series. */
function legend(ctx: OptionContext, names: string[]): Obj | undefined {
  if (names.length < 2) return undefined;
  return {
    data: names,
    top: 0,
    left: 0,
    icon: "roundRect",
    itemWidth: 10,
    itemHeight: 10,
    itemGap: 14,
    textStyle: { color: ctx.tokens.muted, fontSize: 11, fontFamily: ctx.tokens.fontSans },
  };
}

/**
 * Peak / low / anomaly markers from the engine's annotations, drawn on the
 * first series only. Each carries its value ("Peak ₹12.4L"): on time axes
 * these are the only direct labels, so the extremes stay readable without a
 * number on every bar. Labels sit on a small surface-coloured plate, so they
 * stay legible where they cross a line or a neighbouring bar; on lines and
 * areas the low sits below its point, where the space is free.
 */
function markPoints(ctx: OptionContext, seriesIndex: number, isLine = false): Obj | undefined {
  if (seriesIndex !== 0 || !ctx.data.annotations.length) return undefined;
  const s = ctx.data.series[0];
  if (!s) return undefined;
  return {
    symbol: "circle",
    symbolSize: 7,
    itemStyle: { color: ctx.tokens.fg, borderColor: ctx.tokens.surface, borderWidth: 2 },
    label: {
      show: true,
      position: "top",
      distance: 8,
      color: ctx.tokens.muted,
      fontSize: 10,
      fontFamily: ctx.tokens.fontSans,
      backgroundColor: ctx.tokens.surface,
      borderColor: ctx.tokens.border,
      borderWidth: 1,
      borderRadius: 4,
      padding: [2, 5],
      formatter: (p: { name: string }) => p.name,
    },
    data: ctx.data.annotations.map((a) => {
      const word = a.kind === "max" ? "Peak" : a.kind === "min" ? "Low" : "Anomaly";
      const v = s.values[a.index] ?? null;
      return {
        name: v === null ? word : `${word} ${fv(v, s.format, ctx.fmt)}`,
        coord: [a.index, v],
        ...(isLine && a.kind === "min" ? { label: { position: "bottom" } } : {}),
      };
    }),
  };
}

/**
 * Line, area, bar, hbar, stacked bar, histogram and pareto. A single value
 * axis in the first series' format; pareto puts share bars and the cumulative
 * line on the same 0–100% axis rather than a second axis.
 */
function cartesian(ctx: OptionContext): EChartsCoreOption {
  const { data, tokens: t, fmt, kind } = ctx;
  const labels = data.categories.map((c) => c.label);
  const fmt0 = data.series[0]?.format ?? "number";
  const horizontal = kind === "hbar";
  const isLine = kind === "line" || kind === "area";
  const many = labels.length > 14;
  // Time and date-part axes get the engine's peak/low markers instead of a value on every bar.
  const timeAxis = ctx.spec.x.kind === "time" || ctx.spec.x.kind === "part";
  // Direct value labels only where they stay legible: plain bars of one series, few of
  // them, and never on a time axis, where they crowd each other and the peak/low markers.
  const barsLabelled =
    !isLine &&
    kind !== "stackedBar" &&
    !timeAxis &&
    labels.length <= (horizontal ? 15 : 12) &&
    data.series.length === 1;
  const series: Obj[] = [];

  if (kind === "pareto") {
    const share = data.series[0];
    const cum = data.series[1];
    if (share)
      series.push({
        type: "bar",
        name: share.label,
        data: share.values,
        barMaxWidth: 22,
        itemStyle: { color: t.palette[0], borderRadius: [4, 4, 0, 0] },
      });
    if (cum)
      series.push({
        type: "line",
        name: cum.label,
        data: cum.values,
        symbol: "circle",
        symbolSize: 6,
        showSymbol: false,
        lineStyle: { width: 2, color: t.palette[1] },
        itemStyle: { color: t.palette[1], borderColor: t.surface, borderWidth: 2 },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: t.subtle, width: 1, type: "solid" },
          label: { color: t.muted, fontSize: 10, formatter: "80%" },
          data: [{ yAxis: 0.8 }],
        },
      });
    return {
      ...animation(ctx),
      grid: { ...GRID, top: 34 },
      legend: legend(ctx, [share?.label ?? "", cum?.label ?? ""]),
      tooltip: axisTooltip(ctx),
      xAxis: categoryAxis(t, labels, { axisLabel: { show: false } }),
      yAxis: valueAxis(t, "percent", fmt, { max: 1 }),
      series,
      aria: { enabled: true, label: { description: data.altText } },
    };
  }

  if (kind === "stackedBar" && data.matrix && data.seriesCategories) {
    // At most eight coloured segments (one per palette colour, never cycled) plus the
    // engine's "Others" segment in the neutral colour; only the top segment gets rounded ends.
    const segments = data.seriesCategories
      .map((sc, row) => ({ sc, row }))
      .filter(({ sc, row }) => sc.isOthers || row < 8);
    segments.forEach(({ sc, row }, i) => {
      series.push({
        type: "bar",
        name: sc.label,
        stack: "total",
        data: (data.matrix?.[row] ?? []).map((v) => v ?? 0),
        barMaxWidth: 24,
        itemStyle: {
          color: colorFor(ctx, i, sc.isOthers),
          borderColor: t.surface,
          borderWidth: 1,
          borderRadius: i === segments.length - 1 ? [4, 4, 0, 0] : 0,
        },
        emphasis: { focus: "series" },
      });
    });
  } else {
    const stacked = kind === "stackedBar";
    data.series.forEach((s, i) => {
      const color = colorFor(ctx, i);
      // Per-point styling: "Others" in the neutral colour; points outside the
      // cross-filter selection and an incomplete first or last period are faded.
      const values = s.values.map((v, idx) => {
        const cat = data.categories[idx];
        const partialPoint = partialBucket(data, idx);
        const fade = (cat && dimmed(ctx, cat.label)) || partialPoint;
        const base: Obj = { value: v };
        if (cat?.isOthers) base.itemStyle = { color: t.other, opacity: fade ? 0.35 : 1 };
        else if (fade) base.itemStyle = { opacity: partialPoint && isLine ? 0.55 : 0.35 };
        return base;
      });
      if (isLine) {
        series.push({
          type: "line",
          name: s.label,
          data: values,
          smooth: 0.15,
          symbol: "circle",
          symbolSize: 8,
          showSymbol: labels.length <= 2,
          lineStyle: { width: 2, color, cap: "round", join: "round" },
          itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
          areaStyle: kind === "area" ? { color: areaGradient(color) } : undefined,
          emphasis: { focus: "series" },
          endLabel:
            data.series.length === 1 && !ctx.forExport
              ? {
                  show: true,
                  color: t.fg,
                  fontSize: 11,
                  fontFamily: t.fontMono,
                  distance: 6,
                  formatter: (p: { value: number | Obj }) =>
                    fv(
                      typeof p.value === "number" ? p.value : ((p.value as Obj)?.value as number),
                      s.format,
                      fmt,
                    ),
                }
              : undefined,
          markPoint: markPoints(ctx, i, true),
        });
      } else {
        series.push({
          type: "bar",
          name: s.label,
          data: values,
          stack: stacked ? "total" : undefined,
          barMaxWidth: horizontal ? 20 : 24,
          barCategoryGap: kind === "histogram" ? 2 : "32%",
          itemStyle: {
            color,
            borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
            borderColor: stacked ? t.surface : undefined,
            borderWidth: stacked ? 1 : 0,
          },
          label: barsLabelled
            ? {
                show: true,
                position: horizontal ? "right" : "top",
                distance: 6,
                color: t.muted,
                fontSize: 10.5,
                fontFamily: t.fontMono,
                formatter: (p: { value: number | Obj }) =>
                  fv(
                    typeof p.value === "number" ? p.value : ((p.value as Obj)?.value as number),
                    s.format,
                    fmt,
                  ),
              }
            : undefined,
          emphasis: { focus: data.series.length > 1 ? "series" : "self" },
          markPoint: kind === "bar" && timeAxis ? markPoints(ctx, i) : undefined,
          animationDelay: (idx: number) => idx * 14,
        });
      }
    });
  }

  const names = series.map((s) => s.name as string);
  const longCats = horizontal && labels.some((l) => l.length > 18);
  const catAxis = categoryAxis(
    t,
    labels,
    horizontal
      ? {
          inverse: true,
          axisLabel: {
            color: t.label,
            fontSize: 11,
            fontFamily: t.fontSans,
            width: longCats ? 140 : 120,
            overflow: "truncate",
          },
        }
      : {
          boundaryGap: !isLine,
          axisLabel: {
            color: t.label,
            fontSize: 11,
            fontFamily: t.fontSans,
            hideOverlap: true,
            rotate: many && !isLine && ctx.spec.x.kind === "column" ? 30 : 0,
          },
        },
  );
  // Only percentage lines may start above zero (scale: true); bars and areas
  // always keep a zero baseline, since a truncated axis exaggerates differences.
  // Horizontal bars sit in narrow cards, where compact ticks ("₹20L", "₹40L"…)
  // run into each other: when every bar is labelled the axis only repeats those
  // values, so its labels and gridlines go; otherwise it keeps three ticks.
  const valExtra: Obj =
    isLine && !(kind === "area") && fmt0 === "percent"
      ? { scale: true }
      : horizontal
        ? barsLabelled
          ? { axisLabel: { show: false }, splitLine: { show: false } }
          : { splitNumber: 3 }
        : {};
  const valAxis = valueAxis(t, fmt0, fmt, valExtra);
  return {
    ...animation(ctx),
    grid: {
      ...GRID,
      top: names.length > 1 ? 34 : GRID.top,
      right: horizontal ? 52 : isLine && data.series.length === 1 ? 54 : 18,
    },
    legend: legend(ctx, names),
    tooltip: axisTooltip(ctx),
    xAxis: horizontal ? valAxis : catAxis,
    yAxis: horizontal ? catAxis : valAxis,
    // Wheel/drag zoom on long line charts; on a time axis ChartCard offers the zoomed range as a date filter.
    dataZoom: isLine && labels.length > 30 && !ctx.forExport ? [{ type: "inside", throttle: 60 }] : undefined,
    series,
    aria: { enabled: true, label: { description: data.altText } },
  };
}

// ---------------------------------------------------------------- donut

/** Donut with the total in the hole; "Others" slices use the neutral colour. */
function donut(ctx: OptionContext): EChartsCoreOption {
  const { data, tokens: t, fmt } = ctx;
  const s = data.series[0];
  const total = (s?.values ?? []).reduce<number>((a, v) => a + (v ?? 0), 0);
  const format = s?.format ?? "number";
  const items = data.categories.map((c, i) => ({
    name: c.label,
    value: s?.values[i] ?? 0,
    itemStyle: { color: colorFor(ctx, i, c.isOthers), opacity: dimmed(ctx, c.label) ? 0.35 : 1 },
  }));
  return {
    ...animation(ctx),
    tooltip: {
      ...baseTooltip(t),
      trigger: "item",
      formatter: (p: { name: unknown; value: unknown; percent: unknown; color: unknown }) =>
        `${heading(str(p.name), t, { color: p.color })}${row(s?.label ?? "Value", fv(num(p.value), format, fmt, false), t)}${row("Share", typeof p.percent === "number" ? `${p.percent.toFixed(1)}%` : "", t)}`,
    },
    graphic: [
      {
        type: "text",
        left: "center",
        top: "44%",
        style: {
          text: fv(total, format, fmt),
          fill: t.fg,
          fontSize: 18,
          fontWeight: 600,
          fontFamily: t.fontSans,
          textAlign: "center",
        },
      },
      {
        type: "text",
        left: "center",
        top: "56%",
        style: { text: "total", fill: t.subtle, fontSize: 11, fontFamily: t.fontSans, textAlign: "center" },
      },
    ],
    series: [
      {
        type: "pie",
        radius: ["50%", "70%"],
        center: ["50%", "52%"],
        padAngle: 1.5,
        itemStyle: { borderRadius: 4, borderColor: t.surface, borderWidth: 2 },
        // Labels line up at the card's edges, where there is the most room, and long names wrap
        // onto a second line instead of being cut ("Net Banking", "Debit Card").
        label: {
          show: true,
          color: t.muted,
          fontSize: 11,
          fontFamily: t.fontSans,
          formatter: (p: { name: string; percent: number }) => `${p.name}\n${p.percent.toFixed(0)}%`,
          lineHeight: 15,
          alignTo: "edge",
          edgeDistance: 8,
          overflow: "break",
        },
        labelLine: { length: 10, length2: 0, maxSurfaceAngle: 80, lineStyle: { color: t.axis } },
        labelLayout: { hideOverlap: false, moveOverlap: "shiftY" },
        data: items,
        emphasis: { scale: true, scaleSize: 4 },
      },
    ],
    aria: { enabled: true, label: { description: data.altText } },
  };
}

// ---------------------------------------------------------------- treemap (incl. RFM)

/**
 * Colours of a category's sub-category tiles: the category's colour, then
 * steps of 0.055 OKLCH lightness either side of it (0, +1, −1, +2, …), with
 * chroma easing off a little per step and lightness kept inside a readable
 * band. Perceptual steps keep siblings apart in any chart theme without the
 * neon or muddy tiles an HSL saturation ramp gives some hues.
 */
function childShades(parent: string, n: number, dark: boolean): string[] {
  const { l, c, h } = oklch(parent);
  const [lo, hi] = dark ? [0.42, 0.8] : [0.38, 0.82];
  return Array.from({ length: n }, (_, k) => {
    const step = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2);
    return oklchToHex({
      l: Math.min(hi, Math.max(lo, l + step * 0.055)),
      c: c * Math.max(0.6, 1 - 0.08 * Math.abs(step)),
      h,
    });
  });
}

/**
 * Treemap of categories (with optional children), or of RFM segments: area
 * = customers, colour = revenue share on the sequential ramp. ECharts'
 * click-to-zoom, roaming and breadcrumb are turned off.
 */
function treemap(ctx: OptionContext): EChartsCoreOption {
  const { data, tokens: t, fmt } = ctx;
  const format = data.series[0]?.format ?? ctx.spec.measures[0]?.format ?? "number";
  let nodes: Obj[];
  if (data.rfm) {
    // Ramp steps 1–7 scaled to the largest segment's share; step 0 sits too close to the background.
    const maxShare = Math.max(...data.rfm.map((s) => s.revenueShare), 0.0001);
    nodes = data.rfm.map((s) => {
      const step = Math.min(7, Math.max(1, Math.round((s.revenueShare / maxShare) * 6) + 1));
      const color = t.seq[step] as string;
      return {
        name: s.segment,
        value: s.customers,
        revenueShare: s.revenueShare,
        itemStyle: { color, opacity: dimmed(ctx, s.segment) ? 0.35 : 1 },
        label: { color: inkOn(color, t) },
      };
    });
  } else {
    nodes = (data.tree ?? []).map((n, i) => {
      const color = colorFor(ctx, i, n.label === "Others");
      // The largest sub-category keeps the category's own colour; the rest step lighter and darker.
      const kids = [...(n.children ?? [])].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
      const shades = childShades(color, kids.length, t.dark);
      const shadeOf = new Map(kids.map((c, k) => [c.label, shades[k] as string]));
      return {
        name: n.label,
        value: n.value ?? 0,
        itemStyle: { color, opacity: dimmed(ctx, n.label) ? 0.35 : 1 },
        label: { color: inkOn(color, t) },
        children: n.children?.map((c) => {
          const shade = shadeOf.get(c.label) ?? color;
          return {
            name: c.label,
            value: c.value ?? 0,
            itemStyle: { color: shade },
            label: { color: inkOn(shade, t) },
          };
        }),
      };
    });
  }
  return {
    ...animation(ctx),
    tooltip: {
      ...baseTooltip(t),
      trigger: "item",
      formatter: (p: { name: unknown; value: unknown; treePathInfo?: Array<{ name: unknown }> }) => {
        const path = (p.treePathInfo ?? [])
          .map((x) => str(x.name))
          .filter(Boolean)
          .join(" › ");
        let html = heading(path || str(p.name), t);
        if (data.rfm) {
          const seg = data.rfm.find((s) => s.segment === p.name);
          if (seg) {
            html += row(
              "Customers",
              `${formatCount(seg.customers, fmt.locale)} (${(seg.customerShare * 100).toFixed(1)}%)`,
              t,
            );
            html += row("Revenue share", `${(seg.revenueShare * 100).toFixed(1)}%`, t);
            html += row("Avg recency", `${Math.round(seg.avgRecency)} days`, t);
            html += row("Avg orders", seg.avgFrequency.toFixed(1), t);
          }
          return html;
        }
        return html + row(ctx.spec.measures[0]?.label ?? "Value", fv(num(p.value), format, fmt, false), t);
      },
    },
    series: [
      {
        type: "treemap",
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: "100%",
        height: "100%",
        top: 0,
        left: 0,
        squareRatio: 1.2,
        label: {
          show: true,
          fontFamily: t.fontSans,
          fontSize: 11.5,
          formatter: (p: { name: string; value: number; data: Obj }) =>
            data.rfm
              ? `${p.name}\n${(((p.data.revenueShare as number) ?? 0) * 100).toFixed(0)}% revenue`
              : `${p.name}\n${fv(p.value, format, fmt)}`,
          lineHeight: 16,
          overflow: "truncate",
        },
        upperLabel: { show: false },
        levels: [
          { itemStyle: { borderColor: t.surface, borderWidth: 2, gapWidth: 2, borderRadius: 4 } },
          // Sub-category tiles carry their own colours (childShades).
          { itemStyle: { borderColor: t.surface, borderWidth: 1, gapWidth: 1, borderRadius: 3 } },
        ],
        data: nodes,
      },
    ],
    aria: { enabled: true, label: { description: data.altText } },
  };
}

// ---------------------------------------------------------------- heatmap / cohort / geo tiles

/** Horizontal continuous colour legend on the sequential ramp, minus the step closest to the background; a flat range is widened to avoid a zero span. */
function seqVisualMap(
  t: ChartTokens,
  min: number,
  max: number,
  format: KpiFormat,
  fmt: FormatOptions,
  show = true,
): Obj {
  return {
    type: "continuous",
    min,
    max: max > min ? max : min + 1,
    show,
    orient: "horizontal",
    left: "center",
    bottom: 0,
    itemWidth: 10,
    itemHeight: 140,
    calculable: false,
    textGap: 8,
    textStyle: { color: t.label, fontSize: 10, fontFamily: t.fontMono },
    formatter: (v: number) => fv(v, format, fmt),
    inRange: { color: t.seq.slice(1) },
  };
}

/** Two-dimension heatmap from data.matrix (rows = seriesCategories); in-cell labels only up to 96 cells. */
function heatmap(ctx: OptionContext): EChartsCoreOption {
  const { data, tokens: t, fmt } = ctx;
  const format = ctx.spec.measures[0]?.format ?? "number";
  const xs = data.categories.map((c) => c.label);
  const ys = (data.seriesCategories ?? []).map((c) => c.label);
  const cells: Array<[number, number, number | null]> = [];
  let min = Infinity;
  let max = -Infinity;
  (data.matrix ?? []).forEach((rowVals, yi) =>
    rowVals.forEach((v, xi) => {
      cells.push([xi, yi, v]);
      if (v !== null) {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }),
  );
  const showLabels = xs.length * ys.length <= 96;
  return {
    ...animation(ctx),
    grid: {
      left: 6,
      right: 10,
      top: 8,
      bottom: 44,
      outerBoundsMode: "same",
      outerBoundsContain: "axisLabel",
    },
    tooltip: {
      ...baseTooltip(t),
      trigger: "item",
      formatter: (p: { value: [number, number, unknown] }) =>
        `${heading(`${ys[p.value[1]] ?? ""} · ${xs[p.value[0]] ?? ""}`, t)}${row(ctx.spec.measures[0]?.label ?? "Value", fv(num(p.value[2]), format, fmt, false), t)}`,
    },
    xAxis: categoryAxis(t, xs, { splitArea: { show: false }, axisLine: { show: false } }),
    yAxis: categoryAxis(t, ys, { axisLine: { show: false } }),
    visualMap: seqVisualMap(t, Number.isFinite(min) ? min : 0, Number.isFinite(max) ? max : 1, format, fmt),
    series: [
      {
        type: "heatmap",
        // "-" is ECharts' marker for a missing value: the cell stays empty instead of reading as 0.
        data: cells.map(([x, y, v]) => [x, y, v === null ? "-" : v]),
        itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
        label: showLabels
          ? {
              show: true,
              fontSize: 10,
              fontFamily: t.fontMono,
              formatter: (p: { value: [number, number, number | string] }) =>
                typeof p.value[2] === "number" ? fv(p.value[2], format, fmt) : "",
            }
          : { show: false },
        emphasis: { itemStyle: { borderColor: t.fg, borderWidth: 1 } },
      },
    ],
    aria: { enabled: true, label: { description: data.altText } },
  };
}

/**
 * Cohort retention grid: one row per first-order month (label · size), one
 * column per month since. Month 0 is 100% by definition, so it gets a fixed
 * accent tint and is left out of the colour scale; null cells (not yet
 * observable) stay empty.
 */
function cohort(ctx: OptionContext): EChartsCoreOption {
  const { data, tokens: t, fmt } = ctx;
  const rows = data.cohorts ?? [];
  const width = rows[0]?.retention.length ?? 0;
  const xs = Array.from({ length: width }, (_, i) => `M${i}`);
  const ys = rows.map((r) => `${r.label} · ${formatCount(r.size, fmt.locale)}`);
  const cells: Array<[number, number, number | string]> = [];
  let max = 0;
  rows.forEach((r, yi) =>
    r.retention.forEach((v, xi) => {
      cells.push([xi, yi, v === null ? "-" : v]);
      if (v !== null && xi > 0) max = Math.max(max, v);
    }),
  );
  return {
    ...animation(ctx),
    grid: {
      left: 6,
      right: 10,
      top: 8,
      bottom: 44,
      outerBoundsMode: "same",
      outerBoundsContain: "axisLabel",
    },
    tooltip: {
      ...baseTooltip(t),
      trigger: "item",
      formatter: (p: { value: [number, number, number | string] }) => {
        const r = rows[p.value[1]];
        const v = p.value[2];
        return `${heading(`${r?.label ?? ""} cohort · month ${p.value[0]}`, t)}${row("Still ordering", typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "not yet observable", t)}${row("Cohort size", r ? formatCount(r.size, fmt.locale) : "", t)}`;
      },
    },
    xAxis: categoryAxis(t, xs, { position: "top", axisLine: { show: false } }),
    yAxis: categoryAxis(t, ys, { inverse: true, axisLine: { show: false } }),
    visualMap: {
      ...seqVisualMap(t, 0, max || 1, "percent", fmt),
      dimension: 2,
      // Month 0 (always 100%) sits outside the scale: it takes the gradient's strongest step, so it follows the chart colours.
      outOfRange: { color: [withAlpha(t.seq[7] as string, 0.85)] },
    },
    series: [
      {
        type: "heatmap",
        data: cells.map(([x, y, v]) =>
          x === 0
            ? { value: [x, y, v], itemStyle: { color: withAlpha(t.seq[7] as string, t.dark ? 0.32 : 0.22) } }
            : [x, y, v],
        ),
        itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
        label: {
          show: true,
          fontSize: 10,
          fontFamily: t.fontMono,
          formatter: (p: { value: [number, number, number | string] }) =>
            typeof p.value[2] === "number" ? `${Math.round(p.value[2] * 100)}%` : "",
        },
      },
    ],
    aria: { enabled: true, label: { description: data.altText } },
  };
}

/** One state tile in the geo-tile series data (also what ECharts hands back as `data` on a click). */
export interface GeoTileDatum {
  /** [column, row, value]; "-" marks a state without data. */
  value: [number, number, number | "-"];
  /** Canonical state name, shown in the tooltip. */
  name: string;
  code: string;
  /**
   * The data's own label for this state ("MH", "maharashtra"): the raw cell
   * value of the state column, which is what a click must filter on, since the
   * canonical name may not occur in the file at all. Absent without data.
   */
  category?: string;
  itemStyle: Obj;
}

/**
 * Tile-grid map of Indian (default) or US states drawn as a heatmap: each
 * state has a fixed grid tile. Category labels are matched to states by name,
 * code or alias; states without data are drawn in the surface colour.
 */
function geoTiles(ctx: OptionContext): EChartsCoreOption {
  const { data, tokens: t, fmt } = ctx;
  const region = ctx.spec.geoRegion ?? "IN";
  const states = region === "US" ? US_STATES : INDIA_STATES;
  const match = region === "US" ? matchUsState : matchIndianState;
  const format = data.series[0]?.format ?? "number";
  const values = new Map<string, { value: number | null; label: string }>();
  data.categories.forEach((c, i) => {
    const st = match(c.label);
    if (st) values.set(st.code, { value: data.series[0]?.values[i] ?? null, label: c.label });
  });
  const maxRow = Math.max(...states.map((s) => s.tile[0]));
  const maxCol = Math.max(...states.map((s) => s.tile[1]));
  let min = Infinity;
  let max = -Infinity;
  for (const v of values.values())
    if (v.value !== null) {
      min = Math.min(min, v.value);
      max = Math.max(max, v.value);
    }
  const cells = states.map((s): GeoTileDatum => {
    const v = values.get(s.code);
    return {
      value: [s.tile[1], s.tile[0], v?.value ?? "-"],
      name: s.name,
      code: s.code,
      category: v?.label,
      itemStyle: v ? { opacity: dimmed(ctx, v.label) ? 0.35 : 1 } : { color: t.surface2 },
    };
  });
  return {
    ...animation(ctx),
    grid: { left: 0, right: 0, top: 4, bottom: 40 },
    tooltip: {
      ...baseTooltip(t),
      trigger: "item",
      formatter: (p: { data?: Partial<GeoTileDatum> }) => {
        const v = p.data?.value?.[2];
        return `${heading(str(p.data?.name), t)}${row(ctx.spec.measures[0]?.label ?? "Value", typeof v === "number" ? fv(v, format, fmt, false) : "No data", t)}`;
      },
    },
    xAxis: { type: "category", data: Array.from({ length: maxCol + 1 }, (_, i) => String(i)), show: false },
    yAxis: {
      type: "category",
      data: Array.from({ length: maxRow + 1 }, (_, i) => String(i)),
      show: false,
      inverse: true,
    },
    visualMap: seqVisualMap(t, Number.isFinite(min) ? min : 0, Number.isFinite(max) ? max : 1, format, fmt),
    series: [
      {
        type: "heatmap",
        data: cells,
        itemStyle: { borderColor: t.surface, borderWidth: 3, borderRadius: 5 },
        label: {
          show: true,
          fontSize: 10,
          fontWeight: 500,
          fontFamily: t.fontSans,
          formatter: (p: { data: { code: string } }) => p.data.code,
        },
        emphasis: { itemStyle: { borderColor: t.fg, borderWidth: 1 } },
      },
    ],
    aria: { enabled: true, label: { description: data.altText } },
  };
}

// ---------------------------------------------------------------- scatter

/** Groups as points (x = first measure, y = second), names shown up to 14 points, plus the engine's trendline with R² when there are at least 3 points. */
function scatter(ctx: OptionContext): EChartsCoreOption {
  const { data, tokens: t, fmt } = ctx;
  const pts = (data.points ?? []).filter((p) => p.x !== null && p.y !== null) as Array<{
    label: string;
    x: number;
    y: number;
  }>;
  const mx = ctx.spec.measures[0];
  const my = ctx.spec.measures[1];
  const series: Obj[] = [
    {
      type: "scatter",
      name: data.categories.length ? "Groups" : "Points",
      data: pts.map((p) => ({
        value: [p.x, p.y],
        name: p.label,
        itemStyle: { opacity: dimmed(ctx, p.label) ? 0.3 : 0.9 },
      })),
      symbolSize: 11,
      itemStyle: { color: t.palette[0], borderColor: t.surface, borderWidth: 2 },
      label: {
        show: pts.length <= 14,
        position: "right",
        color: t.muted,
        fontSize: 10,
        fontFamily: t.fontSans,
        formatter: (p: { name: string }) => (p.name.length > 18 ? `${p.name.slice(0, 17)}…` : p.name),
      },
      labelLayout: { hideOverlap: true },
    },
  ];
  if (data.trendline && pts.length >= 3) {
    const xs = pts.map((p) => p.x);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const tl = data.trendline;
    series.push({
      type: "line",
      name: `Trend (R² ${tl.r2.toFixed(2)})`,
      data: [
        [lo, tl.intercept + tl.slope * lo],
        [hi, tl.intercept + tl.slope * hi],
      ],
      symbol: "none",
      lineStyle: { color: t.subtle, width: 1.5 },
      silent: true,
      endLabel: { show: true, color: t.subtle, fontSize: 10, formatter: `R² ${tl.r2.toFixed(2)}` },
    });
  }
  return {
    ...animation(ctx),
    grid: { ...GRID, right: 60, top: 22 },
    tooltip: {
      ...baseTooltip(t),
      trigger: "item",
      formatter: (p: { name: unknown; value: unknown }) => {
        const [x, y] = Array.isArray(p.value) ? (p.value as unknown[]) : [];
        return `${heading(str(p.name), t)}${row(mx?.label ?? "x", fv(num(x), mx?.format ?? "number", fmt, false), t)}${row(my?.label ?? "y", fv(num(y), my?.format ?? "number", fmt, false), t)}`;
      },
    },
    xAxis: valueAxis(t, mx?.format ?? "number", fmt, {
      name: mx?.label,
      nameLocation: "middle",
      nameGap: 26,
      nameTextStyle: { color: t.label, fontSize: 11 },
      splitLine: { show: false },
      axisLine: { show: true, lineStyle: { color: t.axis } },
    }),
    yAxis: valueAxis(t, my?.format ?? "number", fmt, {
      name: my?.label,
      nameTextStyle: { color: t.label, fontSize: 11, align: "left" },
    }),
    series,
    aria: { enabled: true, label: { description: data.altText } },
  };
}

// ---------------------------------------------------------------- funnel

/** Funnel in stage order (never re-sorted by value), coloured down the sequential ramp from its strongest end, labelled with volume and step conversion. */
function funnel(ctx: OptionContext): EChartsCoreOption {
  const { data, tokens: t, fmt } = ctx;
  const stages = data.funnel ?? [];
  const ramp = [t.seq[7], t.seq[6], t.seq[5], t.seq[4], t.seq[3], t.seq[2]];
  return {
    ...animation(ctx),
    tooltip: {
      ...baseTooltip(t),
      trigger: "item",
      formatter: (p: { dataIndex: number }) => {
        const s = stages[p.dataIndex];
        if (!s) return "";
        return `${heading(s.label, t)}${row("Volume", fv(s.value, "integer", fmt, false), t)}${s.fromPrev !== null ? row("From previous stage", `${(s.fromPrev * 100).toFixed(1)}%`, t) : ""}${s.fromFirst !== null ? row("From first stage", `${(s.fromFirst * 100).toFixed(2)}%`, t) : ""}`;
      },
    },
    series: [
      {
        type: "funnel",
        sort: "none",
        gap: 3,
        left: "8%",
        right: "8%",
        top: 6,
        bottom: 6,
        minSize: "14%",
        label: {
          show: true,
          position: "inside",
          fontFamily: t.fontSans,
          fontSize: 11,
          formatter: (p: { dataIndex: number }) => {
            const s = stages[p.dataIndex];
            return s
              ? `${s.label}\n${fv(s.value, "integer", fmt)}${s.fromPrev !== null ? ` · ${(s.fromPrev * 100).toFixed(0)}%` : ""}`
              : "";
          },
        },
        itemStyle: { borderColor: t.surface, borderWidth: 1, borderRadius: 4 },
        data: stages.map((s, i) => {
          const c = ramp[i % ramp.length] as string;
          return {
            name: s.label,
            value: s.value ?? 0,
            itemStyle: { color: c },
            label: { color: inkOn(c, t) },
          };
        }),
      },
    ],
    aria: { enabled: true, label: { description: data.altText } },
  };
}

/** The ECharts option for a chart, or null when there is nothing to draw (empty data, or a table view). */
export function buildOption(ctx: OptionContext): EChartsCoreOption | null {
  if (ctx.data.empty) return null;
  if (ctx.data.cohorts) return cohort(ctx);
  if (ctx.data.funnel) return funnel(ctx);
  switch (ctx.kind) {
    case "donut":
      return donut(ctx);
    case "treemap":
      return treemap(ctx);
    case "heatmap":
      return heatmap(ctx);
    case "geoTile":
      return geoTiles(ctx);
    case "scatter":
      return scatter(ctx);
    case "table":
      return null;
    default:
      return cartesian(ctx);
  }
}

/**
 * True when the kind renders through ECharts (tables render as HTML).
 * Market-basket results are always a table, and RFM is only drawable as a treemap.
 */
export function rendersWithECharts(kind: ChartKind, data: ChartData): boolean {
  if (data.basket) return false;
  if (kind === "table") return false;
  if (data.rfm && kind !== "treemap") return false;
  return true;
}
