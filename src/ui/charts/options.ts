"use client";

/**
 * ChartData → ECharts option. Mark specs follow the validated data-viz rules:
 * bars ≤ 24px with 4px rounded data-ends, 2px lines, ≥ 8px markers with a
 * 2px surface ring, hairline solid gridlines, selective direct labels, a legend
 * only for ≥ 2 series, never a dual axis, never a truncated bar axis.
 * Named categories are never dropped silently: their labels wrap (and many
 * bars turn horizontal) instead of being thinned or rotated. An incomplete
 * first or last period is drawn dashed and says where the data stops; colour
 * scales print their end values, and text on a coloured cell takes the ink
 * that contrasts with that cell.
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
import { isoDate, MONTHS_SHORT } from "@/engine/core/dates";

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
  /** The chart's drawing width in px when known (the card measures it); sizes category labels. */
  width?: number;
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

/**
 * Plot width in px: the measured chart width when known, else an estimate for
 * a chart `w` columns wide on the 12-column dashboard (at least half, as rows
 * are packed), with the value axis taken off. Only used to decide how many
 * characters a category label gets, so a rough figure is enough.
 */
function plotWidth(ctx: OptionContext): number {
  if (ctx.width) return Math.max(200, ctx.width - 70);
  return Math.max(260, (Math.max(6, ctx.spec.size?.w ?? 6) / 12) * 1250 - 90);
}

/**
 * A category label in at most `lines` lines of `maxChars` characters, broken
 * at spaces, the last line ending in "…" when the label doesn't fit. The full
 * label is always in the tooltip and the table view.
 */
export function wrapLabel(text: string, maxChars: number, lines = 2): string {
  const limit = Math.max(3, maxChars);
  if (text.length <= limit) return text;
  const out: string[] = [];
  let rest = text.trim();
  while (rest && out.length < lines) {
    if (rest.length <= limit) {
      out.push(rest);
      rest = "";
      break;
    }
    const cut = rest.lastIndexOf(" ", limit);
    const at = cut > limit / 3 ? cut : limit;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) {
    const last = out[out.length - 1] ?? "";
    out[out.length - 1] = `${last.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
  }
  return out.join("\n");
}

/** "20 Dec": the day an incomplete period is cut at. */
function shortDay(t: number): string {
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/**
 * Text colour for a label on a sequential-scale cell: the ramp step that fills
 * it (cells use seq[1…7], as seqVisualMap does), then the ink that contrasts
 * with that step.
 */
function seqInk(t: ChartTokens, v: number, min: number, max: number): string {
  const steps = t.seq.slice(1);
  const hi = max > min ? max : min + 1;
  const pos = Math.min(1, Math.max(0, (v - min) / (hi - min)));
  return inkOn(steps[Math.round(pos * (steps.length - 1))] as string, t);
}

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

/** Bar-like kinds, whose axis pointer shades the hovered category. */
const SHADOW_POINTER = new Set<ChartKind>([
  "bar",
  "hbar",
  "histogram",
  "groupedBar",
  "stackedBar100",
  "lollipop",
]);

/** Sum of a category's parts (blanks as zero), the 100% of a 100% stacked column. */
function columnTotal(data: ChartData, idx: number): number {
  if (data.matrix) return data.matrix.reduce((s, r) => s + Math.max(0, r[idx] ?? 0), 0);
  return data.series.reduce((s, x) => s + Math.max(0, x.values[idx] ?? 0), 0);
}

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
      type: SHADOW_POINTER.has(ctx.kind) ? "shadow" : "line",
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
      // A 100% stack is drawn in shares; the tooltip gives each part's share and its value.
      const total = ctx.kind === "stackedBar100" ? columnTotal(data, idx) : 0;
      for (const p of list) {
        // Helper series (lollipop stems) carry no name and repeat a value already listed.
        if (!str(p.seriesName)) continue;
        const s =
          data.series[p.seriesIndex] ??
          data.series.find((x) => x.label === str(p.seriesName)) ??
          data.series[0];
        if (!s) continue;
        const value = s.values[idx] ?? null;
        html += row(
          str(p.seriesName),
          ctx.kind === "stackedBar100"
            ? `${total ? `${(((value ?? 0) / total) * 100).toFixed(1)}%` : "—"} · ${fv(value, s.format, fmt, false)}`
            : fv(value, s.format, fmt, false),
          t,
          p.color,
        );
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

/** "to 20 Dec" for an incomplete last period, "from 3 Jan" for an incomplete first one. */
function partialText(data: ChartData, idx: number): string {
  if (idx === 0 && data.partialFirst && data.partialFirstStart !== undefined)
    return `from ${shortDay(data.partialFirstStart)}`;
  if (data.partialLastEnd !== undefined) return `to ${shortDay(data.partialLastEnd)}`;
  return "partial";
}

/**
 * The dashed helper series for one line: null everywhere except the segment
 * from the last complete period into the incomplete one (and the first, when
 * flagged), with a hollow point and "to 20 Dec" at the incomplete end.
 * Silent and unnamed: tooltips (which read the engine's values) and legends
 * skip it.
 */
function partialSegments(ctx: OptionContext, values: Obj[], color: string, kind: ChartKind): Obj {
  const { data, tokens: t } = ctx;
  const n = values.length;
  const point = (idx: number, end: boolean): Obj | null => {
    const v = values[idx]?.value;
    if (v === null || v === undefined) return null;
    if (!end) return { value: v, symbol: "none" };
    return {
      value: v,
      symbol: "circle",
      symbolSize: 7,
      itemStyle: { color: t.surface, borderColor: color, borderWidth: 2 },
      label: {
        show: true,
        position: idx === 0 ? "left" : "right",
        distance: 6,
        color: t.subtle,
        fontSize: 10,
        fontFamily: t.fontSans,
        formatter: partialText(data, idx),
      },
    };
  };
  const seg = values.map((_, idx) => {
    if (data.partialLast && idx === n - 1) return point(idx, true);
    if (data.partialLast && idx === n - 2) return point(idx, false);
    if (data.partialFirst && idx === 0) return point(idx, true);
    if (data.partialFirst && idx === 1) return point(idx, false);
    return null;
  });
  return {
    type: "line",
    data: seg,
    silent: true,
    showSymbol: true,
    step: kind === "step" ? "end" : undefined,
    lineStyle: { width: 2, color, type: [4, 4], cap: "round" },
    itemStyle: { color },
    areaStyle: kind === "area" ? { color: areaGradient(color), opacity: 0.5 } : undefined,
    tooltip: { show: false },
    emphasis: { disabled: true },
    z: 1,
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
  const percent = kind === "stackedBar100";
  const fmt0 = percent ? "percent" : (data.series[0]?.format ?? "number");
  // Named categories need room for their names: more than ten columns turn into horizontal bars
  // (one name per row) rather than losing labels to overlap or tilting them.
  const named = ctx.spec.x.kind === "column";
  const horizontal =
    kind === "hbar" || kind === "lollipop" || (kind === "bar" && named && labels.length > 10);
  // Named categories and value ranges ("0%–2.5%") each need their label; dates and date parts don't.
  const everyLabel = named || ctx.spec.x.kind === "bins";
  const isLine = kind === "line" || kind === "area" || kind === "step" || kind === "stackedArea";
  // Series drawn from a split carry their split value's "Others" flag in seriesCategories.
  const othersSeries = (i: number) => Boolean(data.matrix && data.seriesCategories?.[i]?.isOthers);
  // A 100% stack shows each part as its share of the column.
  const share = (v: number | null, idx: number) => {
    if (!percent) return v;
    const total = columnTotal(data, idx);
    return total ? (v ?? 0) / total : null;
  };
  // Time and date-part axes get the engine's peak/low markers instead of a value on every bar.
  const timeAxis = ctx.spec.x.kind === "time" || ctx.spec.x.kind === "part";
  // Direct value labels only where they stay legible: plain bars of one series, few of
  // them, and never on a time axis, where they crowd each other and the peak/low markers.
  const barsLabelled =
    !isLine &&
    kind !== "stackedBar" &&
    !percent &&
    !timeAxis &&
    labels.length <= (horizontal ? 15 : 12) &&
    data.series.length === 1;
  const series: Obj[] = [];
  // Dashed segments into incomplete periods, appended after the named series.
  const helpers: Obj[] = [];

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
          // Inside the plot, above the line's end, so the narrow right margin doesn't cut it off.
          label: { color: t.muted, fontSize: 10, formatter: "80%", position: "insideEndTop" },
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

  if ((kind === "stackedBar" || percent) && data.matrix && data.seriesCategories) {
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
        data: (data.matrix?.[row] ?? []).map((v, idx) => share(v, idx) ?? 0),
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
    const stacked = kind === "stackedBar" || percent;
    // Stacked areas add up per period, so their parts are never split into solid and dashed pieces.
    const dashEnds = kind !== "stackedArea" && labels.length >= 3;
    data.series.forEach((s, i) => {
      const color = colorFor(ctx, i, othersSeries(i));
      // Per-point styling: "Others" in the neutral colour; points outside the
      // cross-filter selection and an incomplete first or last period are faded.
      const values = s.values.map((v, idx) => {
        const cat = data.categories[idx];
        const partialPoint = partialBucket(data, idx);
        const fade = (cat && dimmed(ctx, cat.label)) || partialPoint;
        const base: Obj = { value: share(v, idx) };
        if (cat?.isOthers) base.itemStyle = { color: t.other, opacity: fade ? 0.35 : 1 };
        else if (fade) base.itemStyle = { opacity: partialPoint && isLine ? 0.55 : 0.35 };
        // A faded single-series column says why it is short: the period isn't over in the data.
        if (partialPoint && kind === "bar" && data.series.length === 1 && v !== null)
          base.label = {
            show: true,
            position: "top",
            distance: 6,
            color: t.subtle,
            fontSize: 10,
            fontFamily: t.fontSans,
            formatter: partialText(data, idx),
          };
        return base;
      });
      if (isLine) {
        // An incomplete first or last period isn't drawn as part of the solid line: the line stops at
        // the last complete period and a dashed helper series (added after every named series, so
        // tooltips keep their order; unnamed, so tooltips and legends skip it) runs on to it.
        const dashed = dashEnds && (data.partialLast || data.partialFirst);
        if (dashed) helpers.push(partialSegments(ctx, values, color, kind));
        series.push({
          type: "line",
          name: s.label,
          data: dashed
            ? values.map((p, idx) => (partialBucket(data, idx) ? { ...p, value: null } : p))
            : values,
          // A step line holds each value until the next change; a stacked area layers its series.
          smooth: kind === "step" ? false : 0.15,
          step: kind === "step" ? "end" : undefined,
          stack: kind === "stackedArea" ? "total" : undefined,
          symbol: "circle",
          symbolSize: 8,
          showSymbol: labels.length <= 2,
          lineStyle: { width: kind === "stackedArea" ? 1.5 : 2, color, cap: "round", join: "round" },
          itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
          areaStyle:
            kind === "area"
              ? { color: areaGradient(color) }
              : kind === "stackedArea"
                ? { color: withAlpha(color, t.dark ? 0.5 : 0.55) }
                : undefined,
          emphasis: { focus: "series" },
          // The value at the end of the line, unless the line now ends before an incomplete period.
          endLabel:
            data.series.length === 1 && !ctx.forExport && !(dashed && data.partialLast)
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
      } else if (kind === "lollipop") {
        // A thin stem (silent, unnamed, so tooltips and legends skip it) and a dot at the value.
        series.push({
          type: "bar",
          data: values,
          barWidth: 2,
          silent: true,
          itemStyle: { color: withAlpha(color, 0.5), borderRadius: 1 },
          animationDelay: (idx: number) => idx * 14,
        });
        series.push({
          type: "line",
          name: s.label,
          data: values,
          symbol: "circle",
          symbolSize: 11,
          showSymbol: true,
          lineStyle: { opacity: 0 },
          itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
          label: barsLabelled
            ? {
                show: true,
                position: "right",
                distance: 8,
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
          emphasis: { scale: 1.25 },
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

  series.push(...helpers);
  const names = series.map((s) => s.name as string).filter(Boolean);
  const longCats = horizontal && labels.some((l) => l.length > 18);
  // Every named category keeps its label, wrapped to two lines of what its slot can hold; dates and
  // date parts are regular, so thinning them (every other month) loses nothing.
  const slotChars = Math.floor((plotWidth(ctx) / Math.max(1, labels.length) - 8) / 6.2);
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
          axisLabel: everyLabel
            ? {
                color: t.label,
                fontSize: 11,
                fontFamily: t.fontSans,
                interval: 0,
                hideOverlap: false,
                lineHeight: 13,
                formatter: (v: unknown) => wrapLabel(str(v), slotChars),
              }
            : { color: t.label, fontSize: 11, fontFamily: t.fontSans, hideOverlap: true },
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
  const valAxis = valueAxis(t, fmt0, fmt, percent ? { ...valExtra, max: 1 } : valExtra);
  return {
    ...animation(ctx),
    grid: {
      ...GRID,
      top: names.length > 1 ? 34 : GRID.top,
      // Room on the right for a line's end label, or for "to 20 Sep" after an incomplete last period.
      right: horizontal
        ? 52
        : isLine && data.partialLast && kind !== "stackedArea"
          ? 72
          : isLine && data.series.length === 1
            ? 54
            : 18,
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

/** Donut with the total in the hole, or (`pie`) a full pie; "Others" slices use the neutral colour. */
function donut(ctx: OptionContext, pie = false): EChartsCoreOption {
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
    graphic: pie
      ? undefined
      : [
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
            style: {
              text: "total",
              fill: t.subtle,
              fontSize: 11,
              fontFamily: t.fontSans,
              textAlign: "center",
            },
          },
        ],
    series: [
      {
        type: "pie",
        // In a wide card the ring and its labels keep to a centred box: labels sit at the box's
        // edges, near their slices, instead of at the far ends of the card.
        ...(ctx.width && ctx.width > 720 ? { left: "center", width: 600 } : {}),
        radius: pie ? ["0%", "68%"] : ["50%", "70%"],
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
            html += row("Average recency", `${Math.round(seg.avgRecency)} days`, t);
            html += row("Average orders", seg.avgFrequency.toFixed(1), t);
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
          // A long name wraps inside its tile ("New / Customers") rather than being cut; lines that
          // don't fit a short tile are dropped with an ellipsis.
          overflow: "break",
          lineOverflow: "truncate",
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
    // The scale's end values, so a colour reads as a number (ECharts prints none without them).
    text: [fv(max, format, fmt), fv(min, format, fmt)],
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
        // Each value's label takes the ink that reads on its cell's colour.
        data: cells.map(([x, y, v]) =>
          v === null ? [x, y, "-"] : { value: [x, y, v], label: { color: seqInk(t, v, min, max) } },
        ),
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
  // Up to the last month any cohort has reached: a trailing column no cohort has reached yet would be empty.
  const width = rows.reduce((w, r) => {
    let last = -1;
    r.retention.forEach((v, i) => {
      if (v !== null) last = i;
    });
    return Math.max(w, last + 1);
  }, 0);
  const xs = Array.from({ length: width }, (_, i) => `M${i}`);
  const ys = rows.map((r) => `${r.label} · ${formatCount(r.size, fmt.locale)}`);
  const cells: Array<[number, number, number | string]> = [];
  let max = 0;
  rows.forEach((r, yi) =>
    r.retention.slice(0, width).forEach((v, xi) => {
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
            : typeof v === "number"
              ? { value: [x, y, v], label: { color: seqInk(t, v, 0, max || 1) } }
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
  /** The state code's ink, chosen to read on the tile's colour. */
  label?: Obj;
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
      ...(v && v.value !== null ? { label: { color: seqInk(t, v.value, min, max) } } : {}),
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
    size?: number | null;
  }>;
  const mx = ctx.spec.measures[0];
  const my = ctx.spec.measures[1];
  const ms = ctx.spec.measures[2];
  const bubble = ctx.kind === "bubble";
  // Bubble areas, not radii, follow the third measure (a square root), from 8 to 42 px across.
  const maxSize = Math.max(0, ...(data.points ?? []).map((p) => p.size ?? 0));
  const sizeOf = (v: number | null | undefined) =>
    v === null || v === undefined || v <= 0 || maxSize <= 0 ? 7 : 8 + 34 * Math.sqrt(v / maxSize);
  const series: Obj[] = [
    {
      type: "scatter",
      name: data.categories.length ? "Groups" : "Points",
      data: pts.map((p) => ({
        value: [p.x, p.y],
        name: p.label,
        size: (p as { size?: number | null }).size ?? null,
        symbolSize: bubble ? sizeOf((p as { size?: number | null }).size) : 11,
        itemStyle: { opacity: dimmed(ctx, p.label) ? 0.3 : bubble ? 0.72 : 0.9 },
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
  if (data.trendline && pts.length >= 3 && !bubble) {
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
      formatter: (p: { name: unknown; value: unknown; data?: { size?: unknown } }) => {
        const [x, y] = Array.isArray(p.value) ? (p.value as unknown[]) : [];
        return `${heading(str(p.name), t)}${row(mx?.label ?? "x", fv(num(x), mx?.format ?? "number", fmt, false), t)}${row(my?.label ?? "y", fv(num(y), my?.format ?? "number", fmt, false), t)}${bubble ? row(ms?.label ?? "Size", fv(num(p.data?.size), ms?.format ?? "number", fmt, false), t) : ""}`;
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

// ---------------------------------------------------------------- dumbbell

/**
 * Two dots per category joined by a line: the two measures (or the two
 * split values) side by side, so the gap reads at a glance. The joining line
 * is a stacked pair of bars: an invisible one up to the smaller value, then a
 * thin one spanning the gap; both are silent, so tooltips and clicks go to
 * the dots. Dots don't encode length, so the axis fits the data instead of
 * starting at zero.
 */
function dumbbell(ctx: OptionContext): EChartsCoreOption {
  const { data, tokens: t, fmt } = ctx;
  const labels = data.categories.map((c) => c.label);
  const [a, b] = data.series;
  const format = a?.format ?? "number";
  const lo = labels.map((_, i) => {
    const x = a?.values[i] ?? null;
    const y = b?.values[i] ?? null;
    return x === null || y === null ? null : Math.min(x, y);
  });
  const gap = labels.map((_, i) => {
    const x = a?.values[i] ?? null;
    const y = b?.values[i] ?? null;
    return x === null || y === null ? null : Math.abs(x - y);
  });
  const dots = (s: (typeof data.series)[number] | undefined, i: number): Obj => ({
    type: "line",
    name: s?.label ?? "",
    data: (s?.values ?? []).map((v, idx) => {
      const cat = data.categories[idx];
      return { value: v, itemStyle: cat && dimmed(ctx, cat.label) ? { opacity: 0.35 } : undefined };
    }),
    symbol: "circle",
    symbolSize: 12,
    showSymbol: true,
    lineStyle: { opacity: 0 },
    itemStyle: { color: colorFor(ctx, i), borderColor: t.surface, borderWidth: 2 },
    emphasis: { scale: 1.25 },
    z: 3,
  });
  return {
    ...animation(ctx),
    grid: { ...GRID, top: 34, right: 24 },
    legend: legend(ctx, [a?.label ?? "", b?.label ?? ""]),
    tooltip: {
      ...baseTooltip(t),
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: withAlpha(t.accent, 0.06) } },
      formatter: (params: unknown) => {
        const first = (Array.isArray(params) ? params : [params])[0] as { dataIndex: number } | undefined;
        if (!first) return "";
        const i = first.dataIndex;
        const va = a?.values[i] ?? null;
        const vb = b?.values[i] ?? null;
        return `${heading(labels[i] ?? "", t)}${row(a?.label ?? "", fv(va, format, fmt, false), t, colorFor(ctx, 0))}${row(b?.label ?? "", fv(vb, format, fmt, false), t, colorFor(ctx, 1))}${va !== null && vb !== null ? row("Gap", fv(Math.abs(va - vb), format, fmt, false), t) : ""}`;
      },
    },
    xAxis: valueAxis(t, format, fmt, { scale: true, splitNumber: 4 }),
    yAxis: categoryAxis(t, labels, {
      inverse: true,
      axisLabel: { color: t.label, fontSize: 11, fontFamily: t.fontSans, width: 130, overflow: "truncate" },
    }),
    series: [
      { type: "bar", stack: "gap", data: lo, silent: true, barWidth: 3, itemStyle: { color: "transparent" } },
      {
        type: "bar",
        stack: "gap",
        data: gap,
        silent: true,
        barWidth: 3,
        itemStyle: { color: t.axis, borderRadius: 2 },
      },
      dots(a, 0),
      dots(b, 1),
    ],
    aria: { enabled: true, label: { description: data.altText } },
  };
}

// ---------------------------------------------------------------- radar

/**
 * Radar. With several measures, each spoke is a measure on its own scale (0
 * to its largest value) and each polygon a category; with a split, each
 * spoke is a category on one shared scale and each polygon a split value.
 * Values below zero set the spoke's minimum.
 */
function radar(ctx: OptionContext): EChartsCoreOption {
  const { data, tokens: t, fmt } = ctx;
  const split = Boolean(data.matrix && data.seriesCategories);
  // Spokes and polygons for both layouts: [spoke][polygon] values with each spoke's format.
  const spokes = split
    ? data.categories.map((c) => ({ name: c.label, format: data.series[0]?.format ?? "number" }))
    : data.series.map((s) => ({ name: s.label, format: s.format }));
  const polygons = split
    ? data.series.map((s, i) => ({ name: s.label, values: s.values, others: othersAt(data, i) }))
    : data.categories.map((c, ci) => ({
        name: c.label,
        values: data.series.map((s) => s.values[ci] ?? null),
        others: Boolean(c.isOthers),
      }));
  const all = polygons.flatMap((p) => p.values).filter((v): v is number => v !== null);
  const sharedMax = Math.max(0, ...all);
  const indicator = spokes.map((sp, k) => {
    const vals = polygons.map((p) => p.values[k]).filter((v): v is number => v !== null && v !== undefined);
    const max = split ? sharedMax : Math.max(0, ...vals);
    const min = Math.min(0, ...vals);
    return { name: sp.name, max: max > min ? max * 1.08 : min + 1, min };
  });
  return {
    ...animation(ctx),
    legend: {
      ...(legend(
        ctx,
        polygons.map((p) => p.name),
      ) ?? {}),
      show: polygons.length > 1,
    },
    tooltip: {
      ...baseTooltip(t),
      trigger: "item",
      formatter: (p: { name: unknown; value: unknown; color: unknown }) => {
        const vals = Array.isArray(p.value) ? (p.value as unknown[]) : [];
        return `${heading(str(p.name), t, { color: p.color })}${spokes.map((sp, k) => row(sp.name, fv(num(vals[k]), sp.format, fmt, false), t)).join("")}`;
      },
    },
    radar: {
      indicator,
      center: ["50%", polygons.length > 1 ? "56%" : "52%"],
      radius: "66%",
      splitNumber: 4,
      axisName: { color: t.label, fontSize: 11, fontFamily: t.fontSans },
      splitLine: { lineStyle: { color: t.grid } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: t.axis } },
    },
    series: [
      {
        type: "radar",
        symbol: "circle",
        symbolSize: 5,
        data: polygons.map((p, i) => {
          const color = colorFor(ctx, i, p.others);
          return {
            name: p.name,
            value: p.values.map((v) => v ?? 0),
            lineStyle: { color, width: 2 },
            itemStyle: { color },
            areaStyle: { color: withAlpha(color, 0.14) },
          };
        }),
      },
    ],
    aria: { enabled: true, label: { description: data.altText } },
  };
}

/** True when series `i` of a split chart is the engine's "Others" group. */
function othersAt(data: ChartData, i: number): boolean {
  return Boolean(data.seriesCategories?.[i]?.isOthers);
}

// ---------------------------------------------------------------- gauge

/** A round number at or above `v` (1, 2, 2.5 or 5 × a power of ten), the scale of a gauge with no goal. */
function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = [1, 2, 2.5, 5, 10].find((k) => k * p >= v) ?? 10;
  return n * p;
}

/**
 * Gauge: one value on a 240° arc. The scale runs to the goal when one is set
 * (with a tick at the goal once the value passes it), to 100% for a
 * percentage, and otherwise to a round number above the value, which the
 * caption names, so the arc never implies a goal that wasn't given.
 */
function gauge(ctx: OptionContext): EChartsCoreOption {
  const { data, tokens: t, fmt } = ctx;
  const s = data.series[0];
  const v = s?.values[0] ?? null;
  const format = s?.format ?? "number";
  const target = ctx.spec.target;
  const value = v ?? 0;
  const max =
    target !== undefined && target > 0
      ? Math.max(target, value)
      : format === "percent"
        ? Math.max(1, value)
        : niceCeil(Math.abs(value));
  const caption =
    target !== undefined && target > 0
      ? `${target ? `${((value / target) * 100).toFixed(0)}% of the ${fv(target, format, fmt)} goal` : ""}`
      : format === "percent"
        ? (s?.label ?? "")
        : `${s?.label ?? ""} · scale to ${fv(max, format, fmt)}`;
  const arc = { startAngle: 210, endAngle: -30, min: 0, max, center: ["50%", "58%"], radius: "86%" };
  const series: Obj[] = [
    {
      type: "gauge",
      ...arc,
      progress: { show: true, width: 14, roundCap: true, itemStyle: { color: t.palette[0] } },
      axisLine: { roundCap: true, lineStyle: { width: 14, color: [[1, t.grid]] } },
      pointer: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      anchor: { show: false },
      title: { show: true, offsetCenter: [0, "34%"], color: t.muted, fontSize: 12, fontFamily: t.fontSans },
      detail: {
        valueAnimation: !ctx.forExport,
        offsetCenter: [0, "2%"],
        color: t.fg,
        fontSize: 26,
        fontWeight: 600,
        fontFamily: t.fontSans,
        formatter: () => fv(v, format, fmt),
      },
      data: [{ value: Math.max(0, Math.min(max, value)), name: caption }],
    },
  ];
  // The goal as a short tick across the arc when the value has gone past it.
  if (target !== undefined && target > 0 && target < max)
    series.push({
      type: "gauge",
      ...arc,
      progress: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      anchor: { show: false },
      title: { show: false },
      detail: { show: false },
      pointer: {
        show: true,
        icon: "rect",
        length: "16%",
        width: 3,
        offsetCenter: [0, "-80%"],
        itemStyle: { color: t.fg },
      },
      data: [{ value: target }],
      silent: true,
    });
  return {
    ...animation(ctx),
    tooltip: {
      ...baseTooltip(t),
      trigger: "item",
      formatter: () =>
        `${heading(s?.label ?? "", t)}${row("Value", fv(v, format, fmt, false), t)}${target !== undefined ? row("Goal", fv(target, format, fmt, false), t) : ""}`,
    },
    series,
    aria: { enabled: true, label: { description: data.altText } },
  };
}

// ---------------------------------------------------------------- big number

/**
 * One figure, large (compact form), with the measure's name and its exact
 * value under it; with a goal, a progress bar and the share of the goal.
 * Drawn with ECharts graphics, so it exports like every other chart.
 */
function bigNumber(ctx: OptionContext): EChartsCoreOption {
  const { data, tokens: t, fmt } = ctx;
  const s = data.series[0];
  const v = s?.values[0] ?? null;
  const format = s?.format ?? "number";
  const target = ctx.spec.target;
  const progress = target !== undefined && target > 0 && v !== null ? v / target : null;
  // Laid out in the group's own coordinates around x = 0; the group itself is centred in the card.
  const W = 240;
  const text = (y: number, value: string, fill: string, fontSize: number, fontWeight = 400): Obj => ({
    type: "text",
    x: 0,
    y,
    style: {
      text: value,
      fill,
      fontSize,
      fontWeight,
      fontFamily: t.fontSans,
      align: "center",
      verticalAlign: "top",
    },
  });
  const children: Obj[] = [
    text(0, fv(v, format, fmt), t.fg, 44, 600),
    text(58, `${s?.label ?? ""} · ${fv(v, format, fmt, false)}`, t.muted, 12),
  ];
  if (progress !== null && target !== undefined) {
    children.push(
      { type: "rect", x: -W / 2, y: 88, shape: { width: W, height: 6, r: 3 }, style: { fill: t.grid } },
      {
        type: "rect",
        x: -W / 2,
        y: 88,
        shape: { width: W * Math.max(0, Math.min(1, progress)), height: 6, r: 3 },
        style: { fill: t.palette[0] },
      },
      text(102, `${(progress * 100).toFixed(0)}% of the ${fv(target, format, fmt)} goal`, t.subtle, 11),
    );
  }
  return {
    ...animation(ctx),
    graphic: [{ type: "group", left: "center", top: "middle", children }],
    aria: { enabled: true, label: { description: data.altText } },
  };
}

// ---------------------------------------------------------------- sunburst

/**
 * Sunburst: categories on the inner ring in the series colours ("Others" in
 * the neutral colour), their split values on the outer ring in lighter and
 * darker steps of the parent's colour (childShades, as in the treemap).
 */
function sunburst(ctx: OptionContext): EChartsCoreOption {
  const { data, tokens: t, fmt } = ctx;
  const format = data.series[0]?.format ?? ctx.spec.measures[0]?.format ?? "number";
  const nodes = (data.tree ?? []).map((n, i) => {
    const color = colorFor(ctx, i, n.label === "Others");
    const kids = [...(n.children ?? [])].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const shades = childShades(color, kids.length, t.dark);
    return {
      name: n.label,
      value: n.value ?? 0,
      itemStyle: { color, opacity: dimmed(ctx, n.label) ? 0.35 : 1 },
      label: { color: inkOn(color, t) },
      children: kids.map((c, k) => ({
        name: c.label,
        value: c.value ?? 0,
        itemStyle: { color: shades[k] },
        label: { color: inkOn(shades[k] as string, t) },
      })),
    };
  });
  const total = nodes.reduce((sum, n) => sum + (n.value ?? 0), 0);
  return {
    ...animation(ctx),
    tooltip: {
      ...baseTooltip(t),
      trigger: "item",
      formatter: (p: { value: unknown; treePathInfo?: Array<{ name: unknown }> }) => {
        const path = (p.treePathInfo ?? [])
          .map((x) => str(x.name))
          .filter(Boolean)
          .join(" › ");
        const v = num(p.value);
        return `${heading(path, t)}${row(ctx.spec.measures[0]?.label ?? "Value", fv(v, format, fmt, false), t)}${total > 0 && v !== null ? row("Share of total", `${((v / total) * 100).toFixed(1)}%`, t) : ""}`;
      },
    },
    series: [
      {
        type: "sunburst",
        radius: ["16%", "94%"],
        center: ["50%", "52%"],
        sort: undefined,
        nodeClick: false,
        itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
        label: { fontSize: 10.5, fontFamily: t.fontSans, minAngle: 12, overflow: "truncate", width: 70 },
        levels: [{}, { r0: "16%", r: "56%" }, { r0: "56%", r: "94%", label: { minAngle: 9 } }],
        data: nodes,
      },
    ],
    aria: { enabled: true, label: { description: data.altText } },
  };
}

// ---------------------------------------------------------------- sankey

/**
 * Sankey from the x categories (left) into the split values (right): band
 * width is the measure. Left nodes take the series colours and their bands
 * a tint of the same; right nodes are neutral, so colour follows where a
 * flow comes from. Blank and negative cells are left out (a flow can't be
 * negative), with a note. Node names carry a side marker so the same label
 * on both sides stays two nodes; labels and tooltips drop it.
 */
function sankey(ctx: OptionContext): EChartsCoreOption {
  const { data, tokens: t, fmt } = ctx;
  const format = ctx.spec.measures[0]?.format ?? "number";
  const left = data.categories.map((c) => `L\u241F${c.label}`);
  const right = (data.seriesCategories ?? []).map((c) => `R\u241F${c.label}`);
  const plain = (name: unknown) => str(name).replace(/^[LR]\u241F/, "");
  const links: Obj[] = [];
  (data.matrix ?? []).forEach((row, yi) =>
    row.forEach((v, xi) => {
      if (v === null || !(v > 0)) return;
      links.push({
        source: left[xi],
        target: right[yi],
        value: v,
        lineStyle: { color: withAlpha(colorFor(ctx, xi, data.categories[xi]?.isOthers), 0.32) },
      });
    }),
  );
  const nodes = [
    ...left.map((name, i) => ({
      name,
      itemStyle: { color: colorFor(ctx, i, data.categories[i]?.isOthers), borderColor: t.surface },
    })),
    ...right.map((name) => ({ name, itemStyle: { color: t.subtle, borderColor: t.surface } })),
  ];
  return {
    ...animation(ctx),
    tooltip: {
      ...baseTooltip(t),
      trigger: "item",
      formatter: (p: {
        dataType?: string;
        name: unknown;
        value: unknown;
        data?: { source?: unknown; target?: unknown };
      }) =>
        p.dataType === "edge"
          ? `${heading(`${plain(p.data?.source)} → ${plain(p.data?.target)}`, t)}${row(ctx.spec.measures[0]?.label ?? "Value", fv(num(p.value), format, fmt, false), t)}`
          : `${heading(plain(p.name), t)}${row(ctx.spec.measures[0]?.label ?? "Value", fv(num(p.value), format, fmt, false), t)}`,
    },
    series: [
      {
        type: "sankey",
        left: 120,
        right: 120,
        top: 8,
        bottom: 8,
        nodeWidth: 12,
        nodeGap: 8,
        draggable: false,
        layoutIterations: 32,
        emphasis: { focus: "adjacency" },
        label: {
          color: t.muted,
          fontSize: 11,
          fontFamily: t.fontSans,
          width: 110,
          overflow: "truncate",
          formatter: (p: { name: string }) => plain(p.name),
        },
        levels: [
          { depth: 0, label: { position: "left" } },
          { depth: 1, label: { position: "right" } },
        ],
        data: nodes,
        links,
      },
    ],
    aria: { enabled: true, label: { description: data.altText } },
  };
}

// ---------------------------------------------------------------- calendar

/**
 * Calendar heatmap: one cell per day on a week-by-weekday grid, shaded on
 * the sequential ramp; one calendar per year, the latest two. Dates go to
 * ECharts as YYYY-MM-DD text, never as timestamps, so the wall-clock day is
 * never shifted by the viewer's time zone.
 */
function calendar(ctx: OptionContext): EChartsCoreOption {
  const { data, tokens: t, fmt } = ctx;
  const s = data.series[0];
  const format = s?.format ?? "number";
  const days = data.categories
    .map((c, i) => (typeof c.raw === "number" ? { day: isoDate(c.raw), v: s?.values[i] ?? null } : null))
    .filter((d): d is { day: string; v: number | null } => d !== null && d.v !== null);
  const years = [...new Set(days.map((d) => d.day.slice(0, 4)))].sort().slice(-2);
  const vals = days.map((d) => d.v as number);
  const min = vals.length ? Math.min(...vals) : 0;
  const max = vals.length ? Math.max(...vals) : 1;
  // Room in pixels, not a share of the height: 26px above each year for its month labels (a share
  // clipped them on short cards) and 30px below the last for the colour scale; two years split
  // the height at the middle.
  const boxes =
    years.length > 1
      ? [
          { top: 26, bottom: "53%" },
          { top: "58%", bottom: 30 },
        ]
      : [{ top: 26, bottom: 30 }];
  return {
    ...animation(ctx),
    tooltip: {
      ...baseTooltip(t),
      trigger: "item",
      formatter: (p: { value: unknown }) => {
        const [day, v] = Array.isArray(p.value) ? (p.value as unknown[]) : [];
        return `${heading(str(day), t)}${row(s?.label ?? "Value", fv(num(v), format, fmt, false), t)}`;
      },
    },
    visualMap: seqVisualMap(t, min, max, format, fmt),
    calendar: years.map((y, i) => ({
      range: y,
      ...boxes[i],
      left: 34,
      right: 10,
      cellSize: ["auto", "auto"],
      splitLine: { show: false },
      itemStyle: { color: t.surface2, borderColor: t.surface, borderWidth: 2 },
      yearLabel: { show: years.length > 1, color: t.label, fontSize: 11, fontFamily: t.fontSans, margin: 22 },
      monthLabel: { color: t.label, fontSize: 10, fontFamily: t.fontSans },
      dayLabel: { firstDay: 1, nameMap: ["S", "M", "T", "W", "T", "F", "S"], color: t.label, fontSize: 9 },
    })),
    series: years.map((y, i) => ({
      type: "heatmap",
      coordinateSystem: "calendar",
      calendarIndex: i,
      data: days.filter((d) => d.day.startsWith(y)).map((d) => [d.day, d.v]),
      itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 2 },
    })),
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
    case "pie":
      return donut(ctx, true);
    case "dumbbell":
      return dumbbell(ctx);
    case "radar":
      return radar(ctx);
    case "gauge":
      return gauge(ctx);
    case "bigNumber":
      return bigNumber(ctx);
    case "sunburst":
      return sunburst(ctx);
    case "sankey":
      return sankey(ctx);
    case "calendar":
      return calendar(ctx);
    case "bubble":
      return scatter(ctx);
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
