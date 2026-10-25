"use client";

/**
 * The hero's product shot: the live demo's dashboard as the workspace shows it
 * today. From the lg breakpoint it has the workspace's desktop shell (the
 * sidebar rail of the four phases, and the top bar with the file and the
 * breadcrumb); below it, the phone shell (the phase over the step, the
 * phase's steps, and the bottom bar of phases). Inside: the one page's title,
 * the filter pills, the KPI cards with their trend lines, the chart cards led
 * by their takeaways, and the insights beside the charts.
 *
 * Every value is the build-time snapshot from preview-data.ts: the engine run
 * on the demo file, with the page's KPIs and charts picked by the one page's
 * own plan, so the motion only reveals real engine output. The period pill is
 * live: it switches between three snapshots (the last 12 months, 6 months,
 * 90 days) and the figures tween between them. HeroStage holds the chosen
 * period, so the figures floating beside the panel follow it.
 *
 * Its layout follows its own width (container queries on the content), as
 * the dashboard's does. With room: six KPI cards in a row, the four charts
 * and the insights in a column beside them. On a smaller laptop: the trend
 * and the share of the whole, with the insights in a row under them. On a
 * tablet: three KPI cards over the trend and the insights. On a phone: two
 * by two over the trend. So it stays about a screen tall at every size.
 *
 * The server HTML is the finished dashboard (what crawlers and visitors
 * without JavaScript read, with every figure in place); once hydrated it
 * empties and fills in the first time it scrolls into view, as the live
 * dashboard does. With reduced motion it stays finished.
 *
 * Nothing in it moves the layout: a counting figure is drawn over an
 * invisible copy of its final text, which holds the width, and every chart
 * keeps its box while it draws. Numbers animate through Framer Motion values
 * rendered as text, so a count-up updates the DOM directly instead of
 * re-rendering React on every frame.
 */
import * as React from "react";
import { animate, motion, useInView, useMotionValue, useTransform, type Transition } from "framer-motion";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  History,
  Lightbulb,
  Minus,
  Moon,
  MoreHorizontal,
  PanelLeftOpen,
  RotateCcw,
  Search,
  Settings2,
  Sun,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { currencySymbol, formatValue, type ValueFormat } from "@/engine/core/format";
import { MONTHS_SHORT } from "@/engine/core/dates";
import { cn } from "@/lib/utils";
import { LoupeMark } from "@/ui/brand/logo";
import { APP_PHASES, chipStyle, KPI_ICON, KPI_ICON_FALLBACK } from "./appShell";
import { DrawOn, EASE, useCalm, useHydrated } from "./motion";
import type {
  LandingData,
  PreviewHead,
  PreviewInsight,
  PreviewKpi,
  PreviewPresetId,
  PreviewState,
} from "./preview-data";

const FMT = { locale: "IN" as const, currency: "INR" };

/** The period's short names; the figures floating beside the panel (HeroStage) wear them. */
export const PRESET_SHORT: Record<PreviewPresetId, string> = { last12m: "12M", last6m: "6M", last90d: "90D" };

export type HeroData = Pick<LandingData, "file" | "dashboard" | "states" | "tiles">;

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

/** The categorical colours in their fixed order; the rest folded into Others take the neutral. */
const SLOT = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
  "--chart-7",
  "--chart-8",
];
const sliceColour = (other: boolean, i: number) =>
  other ? "var(--chart-other)" : `var(${SLOT[i] ?? "--chart-other"})`;

/** How far through the workspace's steps the dashboard is (the fifth of eight), for the top bar's edge. */
const ALL_STEPS = APP_PHASES.flatMap((p) => p.steps);
const DASHBOARD_PROGRESS = (ALL_STEPS.findIndex((s) => s.id === "dashboard") + 1) / ALL_STEPS.length;

/** A pill's outline, as the dashboard's filter pills draw it: a raised key on the page. */
const PILL =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-raised-control px-3 text-ui whitespace-nowrap shadow-card";

/* ------------------------------------------------------------------ */
/* Small animated primitives                                           */
/* ------------------------------------------------------------------ */

/**
 * A number that counts up from zero to `value` once `active`, written as the
 * dashboard writes it, and tweens when `value` changes. It starts at the final
 * figure, so the server HTML carries it.
 */
function TweenNumber({
  value,
  format,
  compact,
  active,
  delay = 0,
}: {
  value: number;
  format: ValueFormat;
  compact: boolean;
  active: boolean;
  delay?: number;
}) {
  const calm = useCalm();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => formatValue(v, format, { ...FMT, compact }));
  React.useEffect(() => {
    if (!active) {
      mv.set(0);
      return;
    }
    if (calm) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.9, delay, ease: EASE });
    return () => controls.stop();
  }, [active, value, delay, calm, mv]);
  return <motion.span>{text}</motion.span>;
}

/**
 * A KPI's trend under its figure, as the dashboard's card draws it: the line in the spark colour
 * over a soft fill, a running last period dashed, and the latest point marked. The marker is HTML
 * over the drawing, which stretches to the card's width and would squash a circle.
 */
function Sparkline({
  values,
  partialLast,
  active,
  delay,
}: {
  values: Array<number | null>;
  partialLast: boolean;
  active: boolean;
  delay: number;
}) {
  const calm = useCalm();
  const gradId = `spark-${React.useId().replace(/[^\w-]/g, "")}`;
  const pts = values
    .map((v, i) => ({ i, v }))
    .filter((p): p is { i: number; v: number } => p.v !== null && Number.isFinite(p.v));
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  if (!last || !prev) return null;
  const W = 120;
  const H = 30;
  const pad = 3;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || Math.abs(max) || 1;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * W;
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);
  const solid = partialLast ? pts.slice(0, -1) : pts;
  const first = solid[0] ?? last;
  const end = solid[solid.length - 1] ?? last;
  const line = solid.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(2)},${y(p.v).toFixed(2)}`).join("");
  const area = `${line}L${x(end.i).toFixed(2)},${H}L${x(first.i).toFixed(2)},${H}Z`;
  const draw = reveal(active, calm, { duration: 1, ease: EASE, delay });
  return (
    <span className="relative mt-auto block pt-2.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-8 w-full overflow-visible"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-spark)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--chart-spark)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <DrawOn box={[-2, -4, W + 4, H + 8]} drawn={active} transition={draw}>
          <path d={area} fill={`url(#${gradId})`} />
          <path
            d={line}
            fill="none"
            stroke="var(--chart-spark)"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {partialLast ? (
            <path
              d={`M${x(prev.i)},${y(prev.v)}L${x(last.i)},${y(last.v)}`}
              fill="none"
              stroke="var(--chart-spark)"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              opacity={0.7}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </DrawOn>
      </svg>
      <motion.span
        aria-hidden
        className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--chart-spark)] shadow-[0_0_0_1.5px_var(--surface-1)]"
        style={{ left: `${(x(last.i) / W) * 100}%`, top: `calc(0.625rem + ${(y(last.v) / H) * 2}rem)` }}
        initial={false}
        animate={{ opacity: active ? 1 : 0 }}
        transition={reveal(active, calm, { duration: 0.3, delay: delay + 0.9 })}
      />
    </span>
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
        "tabular inline-flex h-6 shrink-0 items-center gap-0.5 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        tone,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {kpi.deltaText}
      <span className="sr-only">, {meaning}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* KPI cards                                                           */
/* ------------------------------------------------------------------ */

function KpiCard({
  kpi,
  index,
  active,
  comparison,
}: {
  kpi: PreviewKpi;
  index: number;
  active: boolean;
  comparison: string;
}) {
  const calm = useCalm();
  const Icon = KPI_ICON[kpi.icon] ?? KPI_ICON_FALLBACK;
  return (
    <div
      className={cn(
        "@container/kpi flex min-w-0 flex-col rounded-card border border-border bg-surface-1 p-3.5 shadow-card",
        // A phone shows two by two and a tablet one row of three; all six from a laptop's width.
        index >= 4 && "hidden @min-[56rem]/main:flex",
        index === 3 && "@min-[40rem]/main:hidden @min-[56rem]/main:flex",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {/* The chip gives way on a narrow card, so the name keeps its room. */}
        <span
          aria-hidden
          className="hidden size-6 shrink-0 place-items-center rounded-sm @min-[8rem]/kpi:grid"
          style={chipStyle(index)}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-fg-muted">{kpi.name}</span>
      </span>
      <span className="font-figures mt-2.5 block text-2xl leading-none font-semibold whitespace-nowrap text-fg @min-[8rem]/kpi:text-3xl">
        {/* The count runs over an invisible copy of the final figure, which holds the width. */}
        <span aria-hidden className="relative inline-block">
          <span className="invisible">{kpi.display}</span>
          <span className="absolute inset-y-0 left-0">
            <TweenNumber
              value={kpi.value ?? 0}
              format={kpi.format}
              compact={kpi.compact}
              active={active}
              delay={index * 0.06}
            />
          </span>
        </span>
        <span className="sr-only">{kpi.display}</span>
      </span>
      <motion.span
        className="mt-2 flex min-h-6 flex-wrap items-center gap-x-1.5 gap-y-1"
        initial={false}
        animate={{ opacity: active ? 1 : 0 }}
        transition={reveal(active, calm, { duration: 0.4, delay: 0.55 + index * 0.06 })}
        title={`vs ${comparison}`}
      >
        <DeltaChip kpi={kpi} />
        {/* On a narrow card the chip says it alone, rather than wrap the comparison under it. */}
        <span className="hidden text-xs text-fg-subtle @min-[8rem]/kpi:inline">vs prev.</span>
      </motion.span>
      <Sparkline
        values={kpi.spark}
        partialLast={kpi.partialLast}
        active={active}
        delay={0.2 + index * 0.06}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chart cards                                                         */
/* ------------------------------------------------------------------ */

/** A chart card as the dashboard draws one: the title, the takeaway that carries its figures, then the chart. */
function ChartCard({
  head,
  className,
  children,
}: {
  head: PreviewHead;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <figure
      className={cn(
        "flex min-w-0 flex-col rounded-card border border-border bg-surface-1 px-4 pt-3 pb-3.5 shadow-card",
        className,
      )}
    >
      <figcaption className="min-w-0">
        <span className="block truncate text-md font-medium text-fg">{head.title}</span>
        {head.takeaway ? (
          <span className="mt-0.5 line-clamp-2 block text-ui text-fg-muted">{head.takeaway}</span>
        ) : null}
      </figcaption>
      <div className="mt-3 flex min-h-0 flex-1 flex-col justify-center">{children}</div>
    </figure>
  );
}

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
 * the type scale's caption size: SVG text would shrink with the drawing, below the 11 px floor
 * every chart keeps.
 */
const PAD = { left: 52, top: 10, right: 12, bottom: 4 };

function TrendChart({ state, active }: { state: PreviewState; active: boolean }) {
  const calm = useCalm();
  const { values, labels, starts, display, peak, partialFirst, partialLast, grain } = state.trend;
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
  const pt = (i: number) => `${x(i).toFixed(1)},${y(values[i] ?? 0).toFixed(1)}`;
  // A period cut short by the range or by the end of the data is drawn dashed, so a dip at either
  // end isn't misread as a fall.
  const from = partialFirst && n > 2 ? 1 : 0;
  const to = partialLast && n > 2 ? n - 2 : n - 1;
  const solidPath = values
    .slice(from, to + 1)
    .map((_, k) => `${k ? "L" : "M"}${pt(from + k)}`)
    .join("");
  const dashed = [
    from === 1 ? `M${pt(0)}L${pt(1)}` : "",
    to === n - 2 ? `M${pt(n - 2)}L${pt(n - 1)}` : "",
  ].join("");
  const area = n > 1 ? `${values.map((_, i) => `${i ? "L" : "M"}${pt(i)}`).join("")}L${W},${H}L0,${H}Z` : "";
  // Label every k-th period counted back from the latest, so the last label never collides with its
  // neighbour: about four on a phone, six wider. Both rows are drawn and CSS shows the one that fits,
  // so the server HTML (and a page without JavaScript) is right on a phone too.
  const labelsEvery = (count: number) => {
    const every = Math.max(1, Math.ceil(n / count));
    return labels.map((_, i) => i).filter((i) => (n - 1 - i) % every === 0);
  };
  const yearOf = (i: number) => new Date(starts[i] ?? 0).getUTCFullYear();
  const gradId = `trend-${React.useId().replace(/[^\w-]/g, "")}`;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  };
  const shown = hover ?? peak;
  const partialAt = (i: number) => (partialFirst && i === 0) || (partialLast && i === n - 1);

  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="relative">
        {/* Its CSS ratio matches the viewBox at each width, so its height is right before hydration.
            Before then a phone draws the wider canvas stretched to that box (rather than letterboxed),
            so the gridlines still meet the HTML labels laid over them. */}
        <svg
          viewBox={`${-PAD.left} ${-PAD.top} ${VW} ${VH}`}
          preserveAspectRatio="none"
          className="block aspect-[384/164] h-auto w-full overflow-visible sm:aspect-[624/182]"
          role="img"
          aria-label={`${state.trend.title}, ${state.label}: peak ${display[peak]} in ${labels[peak]}`}
        >
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
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
            transition={reveal(active, calm, { duration: 1.2, ease: EASE, delay: 0.15 })}
          />
          {dashed ? (
            <motion.path
              d={dashed}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth={2}
              strokeDasharray="4 4"
              initial={false}
              animate={{ opacity: active ? 0.75 : 0 }}
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
            aria-hidden
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
              {partialAt(shown) ? " (partial)" : ""}
            </p>
          </div>
        ) : null}
      </div>
      {/* Period labels in a row of their own under the plot, the end ones flush with its edges. */}
      {[
        { every: labelsEvery(4), className: "sm:hidden" },
        { every: labelsEvery(6), className: "max-sm:hidden" },
      ].map((row) => (
        <div key={row.className} aria-hidden className={cn("relative h-4.5", row.className)}>
          {row.every.map((i, k) => {
            const prev = row.every[k - 1];
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
      ))}
    </div>
  );
}

/** The share of the whole as a donut: the total in its centre, each slice's share in the legend. */
function MixDonut({ mix, active }: { mix: NonNullable<PreviewState["mix"]>; active: boolean }) {
  const calm = useCalm();
  const r = 40;
  const c = 2 * Math.PI * r;
  // Where each slice starts, as a share of the ring.
  const starts = mix.slices.map((_, i) => mix.slices.slice(0, i).reduce((a, s) => a + s.share, 0));
  return (
    <div className="flex min-w-0 items-center gap-4">
      <div className="relative size-28 shrink-0">
        <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
          {mix.slices.map((s, i) => {
            // A sliver of the card's surface between neighbouring slices.
            const len = Math.max(0, s.share * c - 1.5);
            return (
              <motion.circle
                key={s.label}
                cx={50}
                cy={50}
                r={r}
                fill="none"
                stroke={sliceColour(s.other, i)}
                strokeWidth={15}
                strokeDashoffset={-(starts[i] ?? 0) * c}
                initial={false}
                animate={{ strokeDasharray: active ? `${len} ${c}` : `0 ${c}` }}
                transition={reveal(active, calm, { duration: 0.7, delay: 0.3 + i * 0.07, ease: EASE })}
              />
            );
          })}
        </svg>
        <span className="absolute inset-0 grid place-content-center text-center">
          <span className="font-figures text-lg leading-none font-semibold text-fg">{mix.total}</span>
          <span className="mt-1 text-xs text-fg-subtle">total</span>
        </span>
      </div>
      <ul className="grid min-w-0 flex-1 gap-1 text-xs">
        {mix.slices.map((s, i) => (
          <li key={s.label} className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ background: sliceColour(s.other, i) }}
            />
            <span className="truncate text-fg-muted">{s.label}</span>
            <span className="tabular ml-auto shrink-0 text-fg">{Math.round(s.share * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A ranked breakdown as sorted bars, the names beside them and the values at their ends. */
function Bars({ items, active }: { items: PreviewState["categories"]; active: boolean }) {
  const calm = useCalm();
  const max = Math.max(...items.map((c) => c.share), 0.0001);
  return (
    <ul className="grid gap-2">
      {items.map((c, i) => (
        <li
          key={c.label}
          className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_auto] items-center gap-2.5 text-xs"
        >
          <span className="truncate text-right text-fg-muted">{c.label}</span>
          <span className="relative h-3">
            <motion.span
              className="absolute inset-y-0 left-0 rounded-r-xs bg-[var(--chart-1)]"
              initial={false}
              animate={{ width: active ? `${(c.share / max) * 100}%` : "0%" }}
              transition={reveal(active, calm, { duration: 0.8, delay: 0.35 + i * 0.06, ease: EASE })}
            />
          </span>
          {/* Hidden, not removed, until drawn: its line sets the row's height either way. */}
          <span className={cn("font-figures w-12 text-right text-fg", !active && "invisible")}>
            {c.display}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The states as a tile map in the sequential ramp, with the leaders named beside it. */
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
  const ranked = [...state.states].sort((a, b) => b.intensity - a.intensity);
  const lowest = ranked[ranked.length - 1];
  const highest = ranked[0];
  return (
    <div className="flex min-w-0 items-center gap-5">
      <div
        aria-hidden
        className="grid w-full max-w-44 shrink-0 gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: rows * cols }, (_, k) => {
          const pos = `${Math.floor(k / cols)}:${k % cols}`;
          const s = byPos.get(pos);
          if (!s) {
            // States with no orders still draw a faint tile, so the outline of India stays legible.
            const t = outline.get(pos);
            return <span key={k} className={cn("aspect-square rounded-xs", t && "border border-border")} />;
          }
          const step = Math.min(8, Math.max(1, Math.ceil(s.intensity * 8)));
          return (
            <motion.span
              key={k}
              title={`${s.name}: ${s.display}`}
              className="aspect-square rounded-xs"
              style={{ background: `var(--seq-${step})` }}
              initial={false}
              animate={{ opacity: active ? 1 : 0.12 }}
              transition={reveal(active, calm, { duration: 0.5, delay: 0.4 + (k % cols) * 0.035 })}
            />
          );
        })}
      </div>
      <div className="grid min-w-0 flex-1 content-center gap-3">
        <ol className="grid gap-1.5 text-xs" aria-label="Highest states">
          {ranked.slice(0, 4).map((s) => (
            <li key={s.code} className="flex min-w-0 items-baseline justify-between gap-2">
              <span className="truncate text-fg-muted">{s.name}</span>
              <span className="font-figures shrink-0 text-fg">{s.display}</span>
            </li>
          ))}
        </ol>
        {lowest && highest ? (
          <div aria-hidden className="flex items-center gap-2 text-xs text-fg-subtle">
            <span className="tabular">{lowest.display}</span>
            <span className="flex h-1.5 min-w-10 flex-1 overflow-hidden rounded-full">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <span key={i} className="flex-1" style={{ background: `var(--seq-${i})` }} />
              ))}
            </span>
            <span className="tabular">{highest.display}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Insights                                                            */
/* ------------------------------------------------------------------ */

const TONE: Record<PreviewInsight["tone"], { icon: LucideIcon; chip: string; label: string }> = {
  positive: { icon: TrendingUp, chip: "bg-success-soft text-success", label: "Positive" },
  negative: { icon: TrendingDown, chip: "bg-danger-soft text-danger", label: "Negative" },
  warning: { icon: TriangleAlert, chip: "bg-warning-soft text-warning", label: "Watch" },
  neutral: { icon: Lightbulb, chip: "bg-accent-soft text-accent", label: "Note" },
};

/** The first sentence of an insight's explanation, where its numbers are. */
function firstSentence(text: string): string {
  const t = text.trim();
  return /^.+?[.!?](?=\s|$)/.exec(t)?.[0] ?? t;
}

/**
 * The insights beside the charts (a column when there is room, a row of three under them
 * otherwise): each finding's tone, its title and the sentence that holds its figures.
 */
function Insights({ state, active }: { state: PreviewState; active: boolean }) {
  const calm = useCalm();
  return (
    <section
      aria-label="Insights"
      className="hidden min-w-0 flex-col rounded-card border border-border bg-surface-1 shadow-card @min-[40rem]/main:flex"
    >
      <header className="flex min-w-0 items-center gap-2 px-4 pt-3 pb-1">
        <Lightbulb className="size-4 shrink-0 text-accent" aria-hidden />
        <span className="text-md font-medium text-fg">Insights</span>
        {state.insightsTotal > state.insights.length ? (
          <span className="tabular ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-medium text-fg-muted">
            All {state.insightsTotal}
            <ArrowRight className="size-3" aria-hidden />
          </span>
        ) : null}
      </header>
      <ol className="grid gap-x-5 px-4 @min-[40rem]/main:grid-cols-3 @min-[68rem]/main:grid-cols-1">
        {state.insights.map((ins, i) => {
          const tone = TONE[ins.tone] ?? TONE.neutral;
          return (
            <motion.li
              key={`${state.id}-${ins.title}`}
              className="flex min-w-0 gap-3 border-b border-border-subtle py-3 last:border-b-0 @min-[40rem]/main:border-b-0 @min-[68rem]/main:border-b @min-[68rem]/main:last:border-b-0"
              initial={false}
              animate={{ opacity: active ? 1 : 0 }}
              transition={reveal(active, calm, { duration: 0.45, delay: 0.9 + i * 0.15, ease: EASE })}
            >
              <span className={cn("mt-px grid size-6 shrink-0 place-items-center rounded-full", tone.chip)}>
                <tone.icon className="size-3.5" aria-hidden />
                <span className="sr-only">{tone.label}: </span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-ui font-medium text-fg">{ins.title}</p>
                <p className="mt-0.5 line-clamp-3 text-xs text-fg-muted @min-[68rem]/main:line-clamp-4">
                  {firstSentence(ins.body)}
                </p>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The workspace's shell                                               */
/* ------------------------------------------------------------------ */

/** The sidebar rail (from lg): the steps by phase, the dashboard current, the glossary and log below. */
function Rail() {
  return (
    <div aria-hidden className="hidden w-16 shrink-0 flex-col border-r border-border bg-surface-1 lg:flex">
      <div className="flex h-14 shrink-0 items-center justify-center border-b border-border">
        <LoupeMark className="size-7" decorative />
      </div>
      <div className="flex-1 px-3 py-3">
        {APP_PHASES.map((phase, p) => (
          <div key={phase.id} className={cn(p > 0 && "mt-3")}>
            {/* On the rail the phases are told apart by a short rule instead of their names. */}
            {p > 0 ? <span className="mx-auto mb-3 block h-px w-6 bg-border-strong" /> : null}
            <div className="grid gap-0.5">
              {phase.steps.map((s) => {
                const current = s.id === "dashboard";
                return (
                  <span
                    key={s.id}
                    title={s.label}
                    className={cn(
                      "relative grid h-9 place-items-center rounded-control",
                      current ? "bg-surface-selected text-accent-text" : "text-fg-muted",
                    )}
                  >
                    {current ? (
                      <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" />
                    ) : null}
                    <s.icon className="size-4" />
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="grid shrink-0 gap-0.5 border-t border-border p-3 text-fg-muted">
        {[BookOpen, History, PanelLeftOpen].map((Icon, i) => (
          <span key={i} className="grid h-9 place-items-center">
            <Icon className="size-4" />
          </span>
        ))}
      </div>
    </div>
  );
}

/** The top bar: the file and the breadcrumb to the step from lg; the phase over the step below it. */
function TopBar({ file }: { file: HeroData["file"] }) {
  return (
    <div className="relative flex h-14 items-center gap-3 border-b border-border bg-bg/85 px-4 lg:px-5">
      <span aria-hidden className="shrink-0 lg:hidden">
        <LoupeMark className="size-6" decorative />
      </span>
      <div className="min-w-0 lg:hidden">
        <p className="eyebrow truncate text-fg-subtle">Build</p>
        <p className="truncate text-sm leading-5 font-semibold text-fg">Dashboard</p>
      </div>
      <ol aria-label="Breadcrumb" className="hidden min-w-0 flex-1 items-center gap-1.5 text-ui lg:flex">
        <li className="flex min-w-0 items-center gap-2">
          <Database aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
          <span className="truncate font-medium text-fg">{file.name}</span>
          <span className="inline-flex shrink-0 items-center rounded-full border border-border-accent bg-accent-soft px-2 text-xs leading-5 font-medium text-accent-text">
            Demo data
          </span>
        </li>
        <li aria-hidden className="shrink-0 text-fg-disabled">
          <ChevronRight className="size-3.5" />
        </li>
        <li className="shrink-0 text-fg-muted">Build</li>
        <li aria-hidden className="shrink-0 text-fg-disabled">
          <ChevronRight className="size-3.5" />
        </li>
        <li className="shrink-0 font-medium text-fg">Dashboard</li>
      </ol>
      <div aria-hidden className="ml-auto flex shrink-0 items-center gap-1 text-fg-muted">
        <span className="hidden h-8 w-48 items-center gap-2 rounded-control border border-border bg-surface-raised-control px-2.5 text-ui text-fg-subtle shadow-card xl:flex">
          <Search className="size-3.5 shrink-0" />
          Search
        </span>
        <span className="grid size-8 place-items-center xl:hidden">
          <Search className="size-4" />
        </span>
        <span className="hidden size-8 place-items-center lg:grid">
          <RotateCcw className="size-4" />
        </span>
        <span className="hidden size-8 place-items-center lg:grid">
          <Settings2 className="size-4" />
        </span>
        <span className="hidden size-8 place-items-center lg:grid">
          <Moon className="size-4 dark:hidden" />
          <Sun className="hidden size-4 dark:block" />
        </span>
        <span className="grid size-8 place-items-center lg:hidden">
          <MoreHorizontal className="size-4" />
        </span>
      </div>
      {/* How far through the steps the dashboard is, as the top bar's edge shows it (the scale property, so the
          page's no-JavaScript rule, which lifts transforms, leaves it be). */}
      <span
        aria-hidden
        className="absolute inset-x-0 -bottom-px h-px origin-left bg-[image:var(--accent-gradient)]"
        style={{ scale: `${DASHBOARD_PROGRESS} 1` }}
      />
    </div>
  );
}

/** Below lg: the phase's steps under the top bar, Customise done and the dashboard current. */
function PhoneSteps() {
  const build = APP_PHASES.find((p) => p.id === "build");
  return (
    <div aria-hidden className="flex gap-2 border-b border-border px-4 py-2 lg:hidden">
      {build?.steps.map((s) => {
        const current = s.id === "dashboard";
        const Icon = current ? s.icon : Check;
        return (
          <span
            key={s.id}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-ui font-medium",
              current
                ? "border-border-accent bg-accent-soft text-accent-text"
                : "border-border bg-surface-1 text-fg-muted",
            )}
          >
            <Icon className={cn("size-3.5", !current && "text-success")} />
            {s.label}
          </span>
        );
      })}
    </div>
  );
}

/** Below lg: the bottom bar of the four phases, Build current. */
function BottomBar() {
  return (
    <div
      aria-hidden
      className="grid grid-cols-4 border-t border-border bg-surface-1 px-2 pt-1.5 pb-2 lg:hidden"
    >
      {APP_PHASES.map((p) => {
        const current = p.id === "build";
        return (
          <span key={p.id} className="flex flex-col items-center gap-0.5">
            <span
              className={cn(
                "grid h-7 w-12 place-items-center rounded-full",
                current ? "bg-surface-selected text-accent-text" : "text-fg-muted",
              )}
            >
              <p.icon className="size-4" />
            </span>
            <span className={cn("text-2xs font-medium", current ? "text-fg" : "text-fg-muted")}>
              {p.label}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

/**
 * The period pill: live, it switches the whole preview between the three snapshots. A native select
 * styled as the pill (version 52.4): the menu it replaced spent 110-200 ms of script on a mid-range
 * phone just opening, past the 200 ms a tap may take to answer (INP); the phone's own picker opens at
 * once, and the preview's redraw runs as a transition, so the tap paints first.
 */
function PeriodPill({
  states,
  state,
  onChange,
}: {
  states: PreviewState[];
  state: PreviewState;
  onChange: (index: number) => void;
}) {
  const [, startTransition] = React.useTransition();
  const id = React.useId();
  return (
    <span
      className={cn(PILL, "group relative hover:border-border-hover has-[select:focus-visible]:focus-ring")}
    >
      <CalendarRange className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
      <span className="text-fg-muted" aria-hidden>
        Period
      </span>
      <span aria-hidden className="text-fg-subtle">
        ·
      </span>
      <span className="font-medium text-fg" aria-hidden>
        {state.label}
      </span>
      <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
      <label htmlFor={id} className="sr-only">
        Period
      </label>
      <select
        id={id}
        value={state.id}
        onChange={(e) => {
          const i = states.findIndex((s) => s.id === e.target.value);
          if (i >= 0) startTransition(() => onChange(i));
        }}
        className="absolute inset-0 size-full cursor-pointer appearance-none rounded-full opacity-0 outline-none"
      >
        {states.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export function HeroPreview({
  data,
  icon,
  presetIndex,
  onPresetChange,
}: {
  data: HeroData;
  /** The industry's mark on the page's title (rendered on the server, so its icon set stays there). */
  icon: React.ReactNode;
  /** The chosen period (an index into data.states); HeroStage holds it. */
  presetIndex: number;
  onPresetChange: (index: number) => void;
}) {
  const calm = useCalm();
  const hydrated = useHydrated();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.1 });
  const state = data.states[presetIndex] ?? data.states[0];
  // The server HTML (crawlers, no JavaScript) and reduced motion get the finished dashboard at
  // once; after hydration it fills in the first time it scrolls into view.
  const active = !hydrated || calm || inView;
  if (!state) return null;
  const { dashboard, file } = data;
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
        aria-label={`Preview of the Loupe workspace: the ${dashboard.title} the engine builds from the demo file ${file.name}`}
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE, delay: 0.15 }}
        className="flex overflow-hidden rounded-panel border border-border-strong bg-bg text-left shadow-lift"
      >
        <Rail />
        <div className="@container/main flex min-w-0 flex-1 flex-col">
          <TopBar file={file} />
          <PhoneSteps />
          <div className="grid min-w-0 gap-3.5 p-3 sm:p-4 lg:p-5">
            {/* The page's title and the period it covers. */}
            <div className="flex min-w-0 items-center justify-between gap-x-6 gap-y-2">
              <div className="flex min-w-0 items-center gap-3">
                <span className="hidden size-10 shrink-0 place-items-center rounded-control border border-border-accent bg-accent-soft text-accent @min-[40rem]/main:grid">
                  {icon}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-lg leading-tight font-semibold text-fg @min-[40rem]/main:font-display @min-[40rem]/main:text-display-xs @min-[40rem]/main:leading-tight">
                    {dashboard.title}
                  </p>
                  <p className="mt-0.5 truncate text-ui text-fg-muted">{dashboard.subtitle}</p>
                </div>
              </div>
              <div className="hidden min-w-0 shrink-0 text-right leading-snug @min-[56rem]/main:block">
                <p className="tabular flex items-center justify-end gap-1.5 text-ui font-medium text-fg">
                  <CalendarRange className="size-3.5 shrink-0 text-accent" aria-hidden />
                  {state.periodLabel}
                </p>
                <p className="tabular mt-0.5 text-xs text-fg-muted">
                  {state.rows} of {file.rows} rows · data to {dashboard.dataTo}
                </p>
              </div>
            </div>

            {/* The filter pills: the period (live), then one per main column, named by the file's headers. */}
            <div className="flex min-w-0 items-center gap-4">
              {/* Padded inside its clip, so the period pill's focus ring isn't cut at the edge. */}
              <div className="-m-1 flex min-w-0 flex-1 items-center gap-2 overflow-hidden mask-r-from-85% p-1 @min-[56rem]/main:mask-none">
                <PeriodPill states={data.states} state={state} onChange={onPresetChange} />
                {/* Two column pills until the row has room for all four beside the comparison; on a
                    phone the row runs on under the fade, as the dashboard's scrolls sideways. */}
                {dashboard.slicers.map((s, i) => (
                  <span
                    key={s}
                    aria-hidden
                    className={cn(PILL, i >= 2 && "hidden @min-[68rem]/main:inline-flex")}
                  >
                    <span className="text-fg-muted">{s}</span>
                    <span className="text-fg-subtle">·</span>
                    <span className="font-medium text-fg">All</span>
                    <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
                  </span>
                ))}
              </div>
              <span className="tabular hidden shrink-0 text-xs text-fg-subtle @min-[56rem]/main:block">
                Change vs {state.comparisonLabel}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 @min-[40rem]/main:grid-cols-3 @min-[56rem]/main:grid-cols-6 @min-[56rem]/main:gap-3">
              {state.kpis.map((k, i) => (
                <KpiCard key={k.id} kpi={k} index={i} active={active} comparison={state.comparisonLabel} />
              ))}
            </div>

            {/* The charts, with the insights in a column beside them when there is room. */}
            <div className="grid min-w-0 gap-3 @min-[68rem]/main:grid-cols-[minmax(0,1fr)_17rem]">
              <div className="grid min-w-0 grid-cols-1 gap-3 @min-[40rem]/main:grid-cols-2 @min-[56rem]/main:grid-cols-6">
                <ChartCard
                  head={state.trend}
                  className={cn(
                    "@min-[40rem]/main:col-span-2",
                    state.mix ? "@min-[56rem]/main:col-span-4" : "@min-[56rem]/main:col-span-6",
                  )}
                >
                  <TrendChart key={state.id} state={state} active={active} />
                </ChartCard>
                {state.mix ? (
                  <ChartCard
                    head={state.mix}
                    className="hidden @min-[56rem]/main:col-span-2 @min-[56rem]/main:flex"
                  >
                    <MixDonut mix={state.mix} active={active} />
                  </ChartCard>
                ) : null}
                <ChartCard
                  head={state.categoryHead}
                  className="hidden @min-[68rem]/main:col-span-3 @min-[68rem]/main:flex"
                >
                  <Bars items={state.categories} active={active} />
                </ChartCard>
                <ChartCard
                  head={state.stateHead}
                  className="hidden @min-[68rem]/main:col-span-3 @min-[68rem]/main:flex"
                >
                  <StateTiles state={state} tiles={data.tiles} active={active} />
                </ChartCard>
              </div>
              <Insights state={state} active={active} />
            </div>
          </div>
          <BottomBar />
        </div>
      </motion.div>
    </div>
  );
}
