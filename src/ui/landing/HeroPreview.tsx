"use client";

/**
 * The landing page's instrument panel: a working miniature of the dashboard.
 *
 * It plays the product pipeline as a short sequence (read the file → profile
 * its columns → detect the industry → compute KPIs and charts). Every value is
 * the build-time snapshot from preview-data.ts, so the animation only reveals
 * real engine output. Visitors can switch the date range (12M / 6M / 90D), and
 * figures tween between snapshots. HeroStage holds the chosen range, so the
 * figures floating beside the panel follow it.
 *
 * The server HTML is the finished panel (what crawlers and visitors without
 * JavaScript read, with every figure in place); once hydrated it rewinds and
 * plays from the start, out of sight while the panel fades in. With reduced
 * motion it stays finished.
 *
 * Nothing in it moves the layout: a counting figure is drawn over an invisible
 * copy of its final text, which holds the width, and the stage pills keep a
 * slot for their icon. Numbers animate through Framer Motion values rendered
 * as text, so a count-up updates the DOM directly instead of re-rendering
 * React on every frame.
 */
import * as React from "react";
import { animate, motion, useInView, useMotionValue, useTransform, type Transition } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  FileSpreadsheet,
  Lightbulb,
  Minus,
  TrendingUp,
} from "lucide-react";
import { currencySymbol, formatValue, type ValueFormat } from "@/engine/core/format";
import { MONTHS_SHORT } from "@/engine/core/dates";
import { ConfidenceRing } from "@/ui/workspace/ConfidenceRing";
import { cn } from "@/lib/utils";
import { DrawOn, EASE, useCalm, useHydrated } from "./motion";
import type { LandingData, PreviewKpi, PreviewPresetId, PreviewState } from "./preview-data";

const FMT = { locale: "IN" as const, currency: "INR", compact: true };

/** Pipeline stages shown in the title bar; index 0 means "not started". */
const STAGES = ["Read", "Profile", "Detect", "Compute"] as const;
/** When each stage starts, in ms after the panel enters the viewport. */
const STAGE_AT = [0, 450, 1500, 2150];

const ROLE_DOT: Record<string, string> = {
  Measure: "var(--chart-1)",
  Currency: "var(--chart-1)",
  Dimension: "var(--chart-2)",
  "Date/Time": "var(--chart-3)",
  Geo: "var(--chart-6)",
  Identifier: "var(--fg-subtle)",
  "Free text": "var(--fg-subtle)",
};

/** The date-range switch's short labels; the floating figures (HeroStage) wear them too. */
export const PRESET_SHORT: Record<PreviewPresetId, string> = { last12m: "12M", last6m: "6M", last90d: "90D" };

/**
 * Below Tailwind's sm breakpoint the trend chart is drawn on a narrower canvas, so on a phone it
 * keeps its height and shows fewer, wider-spaced labels. Its box takes the matching aspect ratio
 * from CSS, so the switch after hydration never changes its height.
 */
const NARROW_QUERY = "(max-width: 639.98px)";
function subscribeNarrow(onChange: () => void): () => void {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const isNarrow = () => window.matchMedia(NARROW_QUERY).matches;

/** A reveal's transition while showing; hiding (the rewind after hydration) and reduced motion are instant. */
function reveal(on: boolean, calm: boolean, t: Transition): Transition {
  return on && !calm ? t : { duration: 0 };
}

/* ------------------------------------------------------------------ */
/* Small animated primitives                                           */
/* ------------------------------------------------------------------ */

/**
 * A number that counts up from zero to `value` once `active`, formatted like
 * the dashboard, and tweens when `value` changes. It starts at the final
 * figure, so the server HTML carries it.
 */
function TweenNumber({
  value,
  format,
  active,
  delay = 0,
}: {
  value: number;
  format: ValueFormat;
  active: boolean;
  delay?: number;
}) {
  const calm = useCalm();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => formatValue(v, format, FMT));
  React.useEffect(() => {
    if (!active) {
      mv.set(0);
      return;
    }
    if (calm) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 1, delay, ease: EASE });
    return () => controls.stop();
  }, [active, value, delay, calm, mv]);
  return <motion.span>{text}</motion.span>;
}

function linePath(values: number[], w: number, h: number, max: number): string {
  if (values.length < 2) return "";
  const step = w / (values.length - 1);
  return values
    .map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join("");
}

/** Sparkline in the series colour; good/bad status is carried by the delta chip, not the line. */
function Sparkline({ values, active }: { values: number[]; active: boolean }) {
  const calm = useCalm();
  const max = Math.max(...values, 0) || 1;
  const min = Math.min(...values);
  // Spread the line over the full height: sparklines show shape, not magnitude.
  const norm = values.map((v) => (v - min) / (max - min || 1));
  const d = linePath(norm, 100, 26, 1);
  return (
    <svg
      viewBox="-1 -2 102 30"
      preserveAspectRatio="none"
      className="h-7 w-full overflow-visible"
      aria-hidden
    >
      {/* The stroke keeps its width however far the tile stretches the line. */}
      <DrawOn
        box={[-4, -8, 110, 44]}
        drawn={active}
        transition={reveal(active, calm, { duration: 1.1, ease: EASE, delay: 0.25 })}
      >
        <path
          d={d}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </DrawOn>
    </svg>
  );
}

function DeltaChip({ kpi }: { kpi: PreviewKpi }) {
  const Icon = kpi.change === "up" ? ArrowUpRight : kpi.change === "down" ? ArrowDownRight : Minus;
  const tone =
    kpi.tone === "good"
      ? "text-success-text bg-success-soft"
      : kpi.tone === "bad"
        ? "text-danger-text bg-danger-soft"
        : "text-fg-muted bg-surface-3";
  const meaning =
    kpi.tone === "good" ? "an improvement" : kpi.tone === "bad" ? "a deterioration" : "no clear change";
  return (
    <span
      className={cn(
        "font-figures inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        tone,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {kpi.deltaText}
      <span className="sr-only">, {meaning}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* KPI tiles                                                           */
/* ------------------------------------------------------------------ */

function KpiTile({
  kpi,
  active,
  index,
  comparison,
}: {
  kpi: PreviewKpi;
  active: boolean;
  index: number;
  comparison: string;
}) {
  const calm = useCalm();
  return (
    <div className="grid min-w-0 content-start gap-1.5 rounded-card border border-border bg-surface-2/60 p-3">
      {/* Names wrap rather than truncate; on phones every name keeps two lines, so the figures line up. */}
      <p className="eyebrow min-h-8 text-fg-subtle sm:min-h-0">{kpi.name}</p>
      {/* On phones the change sits under the figure; from sm there is room beside it. */}
      <div className="flex flex-col items-start gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-x-2">
        <p className="font-figures text-xl leading-none font-medium whitespace-nowrap text-fg">
          {/* The count runs over an invisible copy of the final figure, which holds the width. */}
          <span aria-hidden className="relative inline-block">
            <span className="invisible">{kpi.display}</span>
            <span className="absolute inset-y-0 left-0">
              <TweenNumber value={kpi.value ?? 0} format={kpi.format} active={active} delay={index * 0.08} />
            </span>
          </span>
          <span className="sr-only">{kpi.display}</span>
        </p>
        <motion.span
          initial={false}
          animate={{ opacity: active ? 1 : 0, y: active ? 0 : 4 }}
          transition={reveal(active, calm, { duration: 0.4, delay: 0.6 + index * 0.08 })}
          title={`vs ${comparison}`}
        >
          <DeltaChip kpi={kpi} />
        </motion.span>
      </div>
      <Sparkline values={kpi.spark} active={active} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Trend chart                                                         */
/* ------------------------------------------------------------------ */

/**
 * Round ticks from zero in steps of 1, 2, 2.5 or 5 × 10ⁿ (about a quarter of
 * the largest value): ₹0, ₹10L … ₹50L rather than thirds of a rounded maximum
 * (₹16.7L, ₹33.3L). The top leaves about 15% above the largest value, so the
 * line stays clear of the tooltip at the top of the chart.
 */
function niceTicks(largest: number): number[] {
  if (!(largest > 0)) return [0, 1];
  const raw = largest / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  const count = Math.max(1, Math.ceil((largest * 1.15) / step));
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

const UNITS: Array<[number, string]> = [
  [1e7, "Cr"],
  [1e5, "L"],
  [1e3, "K"],
];

/**
 * Money axis labels in the one unit the top tick needs ("₹0, ₹10L … ₹40L",
 * never "₹90K" beside "₹1.2L"), as the dashboard's charts print them
 * (axisTicks in ui/charts/options.ts).
 */
function axisLabeller(top: number): (v: number) => string {
  const sym = currencySymbol(FMT.currency);
  const unit = UNITS.find(([u]) => top >= u * 0.9995);
  if (!unit) return (v) => formatValue(v, "currency", FMT);
  const [size, suffix] = unit;
  return (v) => {
    if (v === 0) return `${sym}0`;
    const scaled = v / size;
    const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    const fixed = scaled.toFixed(digits);
    const text = digits ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
    return `${sym}${text}${suffix}`;
  };
}

/**
 * A time-axis label that gives the year once per year: "Nov 2025", "Jan 2026",
 * "Mar" for months; "6 Jul 2026", "3 Aug" for weeks.
 */
function timeLabel(start: number, grain: string, withYear: boolean, fallback: string): string {
  if (!(start > 0)) return fallback.replace(/^Wk of /, "");
  const d = new Date(start);
  const month = MONTHS_SHORT[d.getUTCMonth()] ?? "";
  const base = grain === "month" ? month : `${d.getUTCDate()} ${month}`;
  return withYear ? `${base} ${d.getUTCFullYear()}` : base;
}

/**
 * The trend chart's margins round the plot, in the SVG's units: room on the left for the value
 * labels and a little above for the top one. The labels themselves are HTML laid over the SVG, at
 * the type scale's caption size: SVG text would shrink with the drawing (to about 8 px in the
 * panel's width at 1440 px), below the 11 px floor every chart keeps.
 */
const PAD = { left: 52, top: 10, right: 12, bottom: 4 };

function TrendChart({ state, active }: { state: PreviewState; active: boolean }) {
  const calm = useCalm();
  const { values, labels, starts, display, peak, partialLast, grain } = state.trend;
  const [hover, setHover] = React.useState<number | null>(null);
  const narrow = React.useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  const W = narrow ? 320 : 560;
  const H = narrow ? 150 : 168;
  // The whole drawing, margins included: its proportions are the aspect ratios in the class below.
  const VW = W + PAD.left + PAD.right;
  const VH = H + PAD.top + PAD.bottom;
  /** A point's place across and down the drawing, as a percentage, for the HTML laid over it. */
  const across = (px: number) => ((px + PAD.left) / VW) * 100;
  const down = (py: number) => ((py + PAD.top) / VH) * 100;
  const ticks = niceTicks(Math.max(...values, 0));
  const max = ticks[ticks.length - 1] ?? 1;
  const tickText = axisLabeller(max);
  const n = values.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2);
  const y = (v: number) => H - (v / max) * H;
  // A partial last period is drawn dashed so a drop at the end isn't misread as a decline.
  const solid = partialLast ? values.slice(0, -1) : values;
  const solidPath = solid.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const dashedPath =
    partialLast && n >= 2
      ? `M${x(n - 2).toFixed(1)},${y(values[n - 2] ?? 0).toFixed(1)}L${x(n - 1).toFixed(1)},${y(values[n - 1] ?? 0).toFixed(1)}`
      : "";
  const area =
    n > 1
      ? `${values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")}L${W},${H}L0,${H}Z`
      : "";
  // Label every k-th period counted back from the latest, so the last label never collides with its neighbour.
  const labelEvery = Math.max(1, Math.ceil(n / (narrow ? 4 : 6)));
  const shownTicks = labels.map((_, i) => i).filter((i) => (n - 1 - i) % labelEvery === 0);
  const yearOf = (i: number) => new Date(starts[i] ?? 0).getUTCFullYear();
  const gradId = `trend-${React.useId().replace(/[^\w-]/g, "")}`;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  };
  const shown = hover ?? peak;

  return (
    <figure className="grid min-w-0 gap-2" aria-label={`${state.trend.title}, ${state.label}`}>
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="truncate text-ui font-medium text-fg">{state.trend.title}</span>
        <span className="shrink-0 text-xs text-fg-subtle">by {grain}</span>
      </figcaption>
      <div className="relative">
        {/* Its CSS ratio matches the viewBox at each width, so its height is right before hydration. */}
        <svg
          viewBox={`${-PAD.left} ${-PAD.top} ${VW} ${VH}`}
          className="block aspect-[384/164] h-auto w-full overflow-visible sm:aspect-[624/182]"
          role="img"
          aria-label={`Peak ${display[peak]} in ${labels[peak]}`}
        >
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
          ))}
          <motion.path
            d={area}
            fill={`url(#${gradId})`}
            initial={false}
            animate={{ opacity: active ? 1 : 0 }}
            transition={reveal(active, calm, { duration: 0.8, delay: 0.5 })}
          />
          <motion.path
            d={solidPath}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            initial={false}
            animate={{ pathLength: active ? 1 : 0 }}
            transition={reveal(active, calm, { duration: 1.3, ease: EASE })}
          />
          {dashedPath ? (
            <motion.path
              d={dashedPath}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth={2}
              strokeDasharray="4 4"
              initial={false}
              animate={{ opacity: active ? 1 : 0 }}
              transition={reveal(active, calm, { delay: 1.2 })}
            />
          ) : null}
          {active && n > 0 ? (
            <g>
              {hover !== null ? (
                <line x1={x(shown)} x2={x(shown)} y1={0} y2={H} stroke="var(--chart-axis)" strokeWidth={1} />
              ) : null}
              <motion.circle
                cx={x(shown)}
                cy={y(values[shown] ?? 0)}
                r={4.5}
                fill="var(--chart-1)"
                stroke="var(--surface-1)"
                strokeWidth={2}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{
                  delay: hover === null && !calm ? 1.2 : 0,
                  type: "spring",
                  stiffness: 400,
                  damping: 22,
                }}
              />
            </g>
          ) : null}
          <rect
            x={0}
            y={-10}
            width={W}
            height={H + 10}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {/* Value labels, right-aligned a little left of the plot and centred on their gridlines. */}
        {ticks.map((t) => (
          <span
            key={t}
            aria-hidden
            className="tabular pointer-events-none absolute -translate-y-1/2 pr-2 text-xs whitespace-nowrap text-[var(--chart-label)]"
            style={{ right: `${100 - across(0)}%`, top: `${down(y(t))}%` }}
          >
            {tickText(t)}
          </span>
        ))}
        {active && n > 0 ? (
          <div
            className={cn(
              "pointer-events-none absolute top-0 rounded-control border border-border-strong bg-[var(--chart-tooltip)] px-2 py-1 shadow-pop",
              // Keep the tooltip inside the chart near either edge.
              shown / Math.max(1, n - 1) > 0.8
                ? "-translate-x-full"
                : shown / Math.max(1, n - 1) < 0.2
                  ? ""
                  : "-translate-x-1/2",
            )}
            style={{ left: `${across(x(shown))}%` }}
          >
            <p className="font-figures text-xs font-medium whitespace-nowrap text-fg">{display[shown]}</p>
            <p className="text-xs whitespace-nowrap text-fg-muted">
              {hover === null ? "Peak · " : ""}
              {labels[shown]}
              {partialLast && shown === n - 1 ? " (partial)" : ""}
            </p>
          </div>
        ) : null}
      </div>
      {/* Period labels in a row of their own under the plot, the end ones flush with its edges. */}
      <div aria-hidden className="relative -mt-1 h-4.5">
        {shownTicks.map((i, k) => {
          const prev = shownTicks[k - 1];
          const withYear = prev === undefined || yearOf(prev) !== yearOf(i);
          return (
            <span
              key={i}
              className={cn(
                "absolute top-0 text-xs whitespace-nowrap text-[var(--chart-label)]",
                i === 0 ? "" : i === n - 1 ? "-translate-x-full" : "-translate-x-1/2",
              )}
              style={{ left: `${across(x(i))}%` }}
            >
              {timeLabel(starts[i] ?? 0, grain, withYear, labels[i] ?? "")}
            </span>
          );
        })}
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Category bars and state tiles                                       */
/* ------------------------------------------------------------------ */

function CategoryBars({ state, active }: { state: PreviewState; active: boolean }) {
  const calm = useCalm();
  const max = Math.max(...state.categories.map((c) => c.share), 0.0001);
  return (
    <figure
      className="grid min-w-0 content-start gap-3"
      aria-label={`Net revenue by category, ${state.label}`}
    >
      <figcaption className="text-ui font-medium text-fg">Net revenue by category</figcaption>
      <ul className="grid gap-2.5">
        {state.categories.map((c, i) => (
          <li
            key={c.label}
            className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-2.5 text-ui"
          >
            {/* Category names wrap to a second line rather than lose their end. */}
            <span className="leading-tight text-fg-muted">{c.label}</span>
            <span className="relative h-2.5 overflow-hidden rounded-r-xs bg-surface-3/60">
              <motion.span
                className="absolute inset-y-0 left-0 rounded-r-xs bg-[var(--chart-1)]"
                initial={false}
                animate={{ width: active ? `${(c.share / max) * 100}%` : "0%" }}
                transition={reveal(active, calm, { duration: 0.9, delay: 0.35 + i * 0.07, ease: EASE })}
              />
            </span>
            {/* Hidden, not removed, until computed: its line sets the row's height either way. */}
            <span className={cn("font-figures w-14 text-right text-xs text-fg", !active && "invisible")}>
              {c.display}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function StateTiles({
  state,
  tiles,
  active,
}: {
  state: PreviewState;
  tiles: LandingData["tiles"];
  active: boolean;
}) {
  const calm = useCalm();
  const byPos = new Map(state.states.map((s) => [`${s.row}:${s.col}`, s]));
  const outline = new Map(tiles.map((t) => [`${t.row}:${t.col}`, t]));
  const rows = 8;
  const cols = 9;
  const top = [...state.states].sort((a, b) => b.intensity - a.intensity)[0];
  return (
    <figure
      className="grid content-start gap-3"
      aria-label={`Net revenue by state, ${state.label}. Highest: ${top?.name ?? ""} ${top?.display ?? ""}`}
    >
      <figcaption className="flex items-baseline justify-between gap-2 text-ui font-medium text-fg">
        By state
        {top ? (
          <span className="text-xs font-normal text-fg-subtle">
            Top: {top.code} {top.display}
          </span>
        ) : null}
      </figcaption>
      <div
        className="grid w-full max-w-[220px] gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: rows * cols }, (_, k) => {
          const pos = `${Math.floor(k / cols)}:${k % cols}`;
          const s = byPos.get(pos);
          if (!s) {
            // States with no orders still draw a faint tile, so the outline of India stays legible.
            const t = outline.get(pos);
            return (
              <span
                key={k}
                title={t ? `${t.name}: no orders` : undefined}
                className={cn("aspect-square rounded-xs", t && "border border-border")}
              />
            );
          }
          const step = Math.min(8, Math.max(1, Math.ceil(s.intensity * 8)));
          return (
            <motion.span
              key={k}
              title={`${s.name}: ${s.display}`}
              className="aspect-square rounded-xs"
              style={{ background: `var(--seq-${step})` }}
              initial={false}
              animate={{ opacity: active ? 1 : 0.12, scale: active ? 1 : 0.85 }}
              transition={reveal(active, calm, { duration: 0.5, delay: 0.4 + (k % cols) * 0.035 })}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-2 text-xs text-fg-subtle" aria-hidden>
        Low
        <span className="flex h-1.5 w-20 overflow-hidden rounded-full">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <span key={i} className="flex-1" style={{ background: `var(--seq-${i})` }} />
          ))}
        </span>
        High
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Insights                                                            */
/* ------------------------------------------------------------------ */

function InsightList({ state, active }: { state: PreviewState; active: boolean }) {
  const calm = useCalm();
  return (
    <ul className="grid gap-2.5" aria-label="Insights">
      {state.insights.slice(0, 2).map((ins, i) => {
        const Icon =
          ins.tone === "positive"
            ? TrendingUp
            : ins.tone === "warning" || ins.tone === "negative"
              ? AlertTriangle
              : Lightbulb;
        const color =
          ins.tone === "positive"
            ? "text-success"
            : ins.tone === "negative"
              ? "text-danger"
              : ins.tone === "warning"
                ? "text-warning"
                : "text-accent";
        return (
          <motion.li
            key={ins.title}
            className="flex gap-2.5 rounded-card border border-border bg-surface-2/60 p-3"
            initial={false}
            animate={{ opacity: active ? 1 : 0, y: active ? 0 : 6 }}
            transition={reveal(active, calm, { duration: 0.45, delay: 1.1 + i * 0.15, ease: EASE })}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", color)} aria-hidden />
            <div className="min-w-0">
              <p className="text-ui font-medium text-fg">{ins.title}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{ins.body}</p>
            </div>
          </motion.li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Detection ring                                                      */
/* ------------------------------------------------------------------ */

/**
 * The detection ring as plain markup, for the server HTML: ConfidenceRing
 * counts up from 0 and so would print "0%" to crawlers and to visitors
 * without JavaScript. Same geometry and colours, without the motion.
 */
function StillRing({ value, size, label }: { value: number; size: number; label: string }) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = value >= 70 ? "var(--accent)" : value >= 50 ? "var(--warning)" : "var(--danger)";
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${Math.round(value)}% ${label}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-figures text-3xl leading-none font-semibold text-fg">
          {Math.round(value)}
          <span className="text-md font-medium text-fg-muted">%</span>
        </span>
        <span className="eyebrow mt-1 text-fg-subtle">{label}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function HeroPreview({
  data,
  presetIndex,
  onPresetChange,
}: {
  data: Pick<LandingData, "file" | "detection" | "columns" | "states" | "tiles">;
  /** The chosen date range (an index into data.states); HeroStage holds it. */
  presetIndex: number;
  onPresetChange: (index: number) => void;
}) {
  const calm = useCalm();
  const hydrated = useHydrated();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });
  const [stage, setStage] = React.useState(0);
  const state = data.states[presetIndex] ?? data.states[0];
  // The server HTML (crawlers, no JavaScript) and reduced motion get the finished panel at once.
  const shown = !hydrated || calm ? STAGES.length : stage;

  // Run the pipeline sequence once, when the panel first scrolls into view.
  React.useEffect(() => {
    if (!inView || calm) return;
    const timers = STAGE_AT.map((at, i) => window.setTimeout(() => setStage(i + 1), at));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [inView, calm]);

  const totalRows = Number(data.file.rows.replace(/[^\d]/g, ""));
  const rows = useMotionValue(totalRows);
  const rowsText = useTransform(rows, (v) => formatValue(v, "integer", { locale: "IN", currency: "INR" }));
  const read = shown >= 1;
  React.useEffect(() => {
    if (!read) {
      rows.set(0);
      return;
    }
    if (calm || !hydrated) {
      rows.set(totalRows);
      return;
    }
    const c = animate(rows, totalRows, { duration: 0.6, ease: EASE });
    return () => c.stop();
  }, [read, calm, hydrated, rows, totalRows]);

  if (!state) return null;
  const computed = shown >= 4;
  const detected = shown >= 3;
  const profiled = shown >= 2;

  return (
    <div ref={ref} className="relative">
      {/* Accent glow behind the panel */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-10 -top-16 bottom-0 -z-10 bg-[radial-gradient(60%_55%_at_50%_20%,var(--mesh-1),transparent_70%)]"
      />
      <motion.div
        data-reveal
        role="figure"
        aria-label="Preview of a Loupe dashboard computed from the demo e-commerce dataset"
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE, delay: 0.15 }}
        className="overflow-hidden rounded-panel border border-border-strong bg-surface-1 shadow-lift"
      >
        {/* Title bar: file, pipeline stage, date range */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2 text-ui">
            <FileSpreadsheet className="size-4 shrink-0 text-accent" aria-hidden />
            <span className="truncate font-medium text-fg">{data.file.name}</span>
            <span className="tabular hidden shrink-0 text-xs text-fg-subtle sm:inline">
              <motion.span>{rowsText}</motion.span> rows · {data.file.columns} columns
            </span>
          </div>
          <ol
            className="order-3 flex w-full flex-wrap items-center gap-1 text-xs sm:order-none sm:ml-auto sm:w-auto sm:flex-nowrap"
            aria-label="Pipeline progress"
          >
            {STAGES.map((label, i) => {
              const done = shown > i + 1 || (computed && i === STAGES.length - 1);
              const current = shown === i + 1 && !done;
              return (
                <li key={label} className="flex items-center gap-1">
                  {i ? (
                    <span
                      aria-hidden
                      className={cn(
                        "hidden h-px w-4 sm:block",
                        shown > i ? "bg-accent/60" : "bg-border-strong",
                      )}
                    />
                  ) : null}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors duration-slow",
                      done
                        ? "border-transparent bg-accent-soft text-accent-text"
                        : current
                          ? "border-border-accent text-fg"
                          : "border-border text-fg-subtle",
                    )}
                    aria-current={current ? "step" : undefined}
                  >
                    {/* The icon's slot is always there, so a pill never changes width as it fills. */}
                    <span aria-hidden className="grid size-3 shrink-0 place-items-center">
                      {done ? (
                        <Check className="size-3" />
                      ) : current ? (
                        <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                      ) : null}
                    </span>
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
          <div
            role="group"
            aria-label="Date range"
            className="ml-auto flex items-center gap-0.5 rounded-control border border-border bg-surface-inset p-0.5 sm:ml-0"
          >
            {data.states.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={i === presetIndex}
                // The full name, after the visible one so speech input ("click 12M") still matches.
                aria-label={`${PRESET_SHORT[s.id]} (${s.label})`}
                title={s.label}
                onClick={() => onPresetChange(i)}
                className={cn(
                  // The Segmented control's raised key on a sunken track.
                  "rounded-sm border px-2 py-px text-xs transition-colors duration-fast focus-visible:focus-ring",
                  i === presetIndex
                    ? "border-border-strong bg-surface-raised-control text-fg shadow-card"
                    : "border-transparent text-fg-subtle hover:bg-surface-hover hover:text-fg",
                )}
              >
                {PRESET_SHORT[s.id]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* Left rail: detection and column profile */}
          <aside className="grid content-start gap-4 border-b border-border p-4 lg:border-r lg:border-b-0">
            <div className="flex items-center gap-4 lg:grid lg:justify-items-start lg:gap-3">
              <div className="relative size-[92px] shrink-0">
                {!hydrated ? (
                  <StillRing value={data.detection.confidence} size={92} label="match" />
                ) : detected ? (
                  <ConfidenceRing value={data.detection.confidence} size={92} label="match" />
                ) : (
                  <div className="size-[92px] rounded-full border-[6px] border-surface-3" aria-hidden />
                )}
              </div>
              <motion.div
                className="min-w-0"
                initial={false}
                animate={{ opacity: detected ? 1 : 0.15 }}
                transition={reveal(detected, calm, { duration: 0.5 })}
              >
                <p className="eyebrow text-fg-subtle">Detected</p>
                <p className="font-display text-display-xs text-fg">{data.detection.domain}</p>
                <p className="text-ui text-fg-muted">
                  {data.detection.subDomain} · one row per {data.detection.grain}
                </p>
              </motion.div>
            </div>
            <div className="hidden lg:block">
              <p className="eyebrow mb-2 flex items-baseline justify-between text-fg-subtle">
                Columns profiled
                <span className="font-figures tracking-normal">{profiled ? data.columns.length : 0}</span>
              </p>
              <ul className="mask-fade-b grid max-h-[248px] gap-px overflow-hidden" aria-label="Column roles">
                {data.columns.map((c, i) => (
                  <motion.li
                    key={c.name}
                    className="flex items-center justify-between gap-3 rounded-sm px-1.5 py-[3px] text-xs"
                    initial={false}
                    animate={{ opacity: profiled ? 1 : 0, x: profiled ? 0 : -6 }}
                    transition={reveal(profiled, calm, { duration: 0.25, delay: i * 0.032 })}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ background: ROLE_DOT[c.role] ?? "var(--fg-subtle)" }}
                        aria-hidden
                      />
                      <span className="truncate text-fg">{c.name}</span>
                    </span>
                    <span className="shrink-0 text-fg-subtle">{c.role}</span>
                  </motion.li>
                ))}
              </ul>
            </div>
          </aside>

          {/* Main: KPIs, trend, breakdowns, insights */}
          <div className="grid min-w-0 gap-4 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-ui text-fg-muted">
                <span className="font-medium text-fg">{state.label}</span> · {state.periodLabel}
              </p>
              <p className="text-xs text-fg-subtle">
                vs {state.comparisonLabel} · {state.rows} rows
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
              {state.kpis.map((k, i) => (
                <KpiTile key={k.id} kpi={k} active={computed} index={i} comparison={state.comparisonLabel} />
              ))}
            </div>
            <div className="grid gap-5 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <TrendChart key={state.id} state={state} active={computed} />
              <CategoryBars state={state} active={computed} />
            </div>
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
              <div className="hidden md:block">
                <StateTiles state={state} tiles={data.tiles} active={computed} />
              </div>
              <InsightList state={state} active={computed} />
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
