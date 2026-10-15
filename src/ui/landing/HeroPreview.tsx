"use client";

/**
 * The landing page's instrument panel: a working miniature of the dashboard.
 *
 * It plays the product pipeline as a short sequence (read the file → profile
 * its columns → detect the industry → compute KPIs and charts). Every value is
 * the build-time snapshot from preview-data.ts, so the animation only reveals
 * real engine output. Visitors can switch the date range (12M / 6M / 90D), and
 * figures tween between snapshots. With reduced motion the panel shows its
 * final state at once.
 *
 * Numbers animate through Framer Motion values rendered as text, so a count-up
 * updates the DOM directly instead of re-rendering React on every frame.
 */
import * as React from "react";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
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
import { formatValue, type ValueFormat } from "@/engine/core/format";
import { ConfidenceRing } from "@/ui/workspace/ConfidenceRing";
import { cn } from "@/lib/utils";
import type { LandingData, PreviewKpi, PreviewPresetId, PreviewState } from "./preview-data";

const EASE = [0.22, 1, 0.36, 1] as const;
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

const PRESET_SHORT: Record<PreviewPresetId, string> = { last12m: "12M", last6m: "6M", last90d: "90D" };

/** Below this width the trend chart is drawn on a narrower canvas so its labels stay readable. */
const NARROW_QUERY = "(max-width: 640px)";
function subscribeNarrow(onChange: () => void): () => void {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const isNarrow = () => window.matchMedia(NARROW_QUERY).matches;

/* ------------------------------------------------------------------ */
/* Small animated primitives                                           */
/* ------------------------------------------------------------------ */

/** A number that tweens to `value` once `active`, formatted like the dashboard. */
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
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => formatValue(v, format, FMT));
  React.useEffect(() => {
    if (!active) return;
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 1, delay, ease: EASE });
    return () => controls.stop();
  }, [active, value, delay, reduce, mv]);
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
  const reduce = useReducedMotion();
  const max = Math.max(...values, 0) || 1;
  const min = Math.min(...values);
  // Spread the line over the full height: sparklines show shape, not magnitude.
  const norm = values.map((v) => (v - min) / (max - min || 1));
  const d = linePath(norm, 100, 26, 1);
  const color = "var(--chart-1)";
  return (
    <svg
      viewBox="-1 -2 102 30"
      preserveAspectRatio="none"
      className="h-7 w-full overflow-visible"
      aria-hidden
    >
      <motion.path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{ pathLength: active ? 1 : 0, opacity: active ? 1 : 0 }}
        transition={{ duration: reduce ? 0 : 1.1, ease: EASE, delay: reduce ? 0 : 0.25 }}
      />
    </svg>
  );
}

function DeltaChip({ kpi }: { kpi: PreviewKpi }) {
  const Icon = kpi.change === "up" ? ArrowUpRight : kpi.change === "down" ? ArrowDownRight : Minus;
  const tone =
    kpi.tone === "good"
      ? "text-success bg-success-soft"
      : kpi.tone === "bad"
        ? "text-danger bg-danger-soft"
        : "text-fg-muted bg-surface-3";
  const meaning =
    kpi.tone === "good" ? "an improvement" : kpi.tone === "bad" ? "a deterioration" : "no clear change";
  return (
    <span
      className={cn(
        "font-figures inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium",
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
  const reduce = useReducedMotion();
  return (
    <div className="grid min-w-0 gap-1.5 rounded-card border border-border bg-surface-2/60 p-3">
      <p className="truncate text-2xs font-medium tracking-[0.1em] text-fg-subtle uppercase">{kpi.name}</p>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <p className="font-figures text-[21px] leading-none font-medium tracking-[-0.02em] text-fg">
          <span aria-hidden>
            <TweenNumber value={kpi.value ?? 0} format={kpi.format} active={active} delay={index * 0.08} />
          </span>
          <span className="sr-only">{kpi.display}</span>
        </p>
        <motion.span
          initial={false}
          animate={{ opacity: active ? 1 : 0, y: active ? 0 : 4 }}
          transition={reduce ? { duration: 0 } : { duration: 0.4, delay: active ? 0.6 + index * 0.08 : 0 }}
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

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * exp;
}

function TrendChart({ state, active }: { state: PreviewState; active: boolean }) {
  const reduce = useReducedMotion();
  const { values, labels, display, peak, partialLast } = state.trend;
  const [hover, setHover] = React.useState<number | null>(null);
  // SVG text scales with the viewBox: a narrower canvas on phones keeps axis labels near 10 px.
  const narrow = React.useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  const W = narrow ? 320 : 560;
  const H = narrow ? 150 : 168;
  const max = niceMax(Math.max(...values, 0) * 1.08);
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
  const ticks = [0, 1 / 3, 2 / 3, 1].map((f) => f * max);
  // Label every k-th period counted back from the latest, so the last label never collides with its neighbour.
  const labelEvery = Math.max(1, Math.ceil(n / (narrow ? 4 : 6)));
  const gradId = React.useId().replace(/:/g, "");

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
        <span className="font-figures shrink-0 text-2xs text-fg-subtle">by {state.trend.grain}</span>
      </figcaption>
      <div className="relative">
        <svg
          viewBox={`-46 -10 ${W + 58} ${H + 32}`}
          className="h-auto w-full overflow-visible"
          role="img"
          aria-label={`Peak ${display[peak]} in ${labels[peak]}`}
        >
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text
                x={-10}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                className="font-figures"
                fontSize={10.5}
                fill="var(--chart-label)"
              >
                {formatValue(t, "currency", FMT)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            (n - 1 - i) % labelEvery === 0 ? (
              <text
                key={i}
                x={x(i)}
                y={H + 18}
                textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                fontSize={10.5}
                fill="var(--chart-label)"
              >
                {l.replace(/^Wk of /, "")}
              </text>
            ) : null,
          )}
          <motion.path
            d={area}
            fill={`url(#${gradId})`}
            initial={false}
            animate={{ opacity: active ? 1 : 0 }}
            transition={{ duration: reduce ? 0 : 0.8, delay: reduce ? 0 : 0.5 }}
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
            transition={{ duration: reduce ? 0 : 1.3, ease: EASE }}
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
              transition={{ delay: reduce ? 0 : 1.2 }}
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
                  delay: hover === null && !reduce ? 1.2 : 0,
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
        {active && n > 0 ? (
          <div
            className={cn(
              "pointer-events-none absolute top-0 rounded-[8px] border border-border-strong bg-[var(--chart-tooltip)] px-2 py-1 shadow-pop",
              // Keep the tooltip inside the chart near either edge.
              shown / Math.max(1, n - 1) > 0.8
                ? "-translate-x-full"
                : shown / Math.max(1, n - 1) < 0.2
                  ? ""
                  : "-translate-x-1/2",
            )}
            style={{ left: `${((x(shown) + 46) / (W + 58)) * 100}%` }}
          >
            <p className="font-figures text-[11px] font-medium whitespace-nowrap text-fg">{display[shown]}</p>
            <p className="text-[10px] whitespace-nowrap text-fg-muted">
              {hover === null ? "Peak · " : ""}
              {labels[shown]}
              {partialLast && shown === n - 1 ? " (partial)" : ""}
            </p>
          </div>
        ) : null}
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Category bars and state tiles                                       */
/* ------------------------------------------------------------------ */

function CategoryBars({ state, active }: { state: PreviewState; active: boolean }) {
  const reduce = useReducedMotion();
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
            <span className="truncate text-fg-muted" title={c.label}>
              {c.label}
            </span>
            <span className="relative h-2.5 overflow-hidden rounded-r-[4px] bg-surface-3/60">
              <motion.span
                className="absolute inset-y-0 left-0 rounded-r-[4px] bg-[var(--chart-1)]"
                initial={false}
                animate={{ width: active ? `${(c.share / max) * 100}%` : "0%" }}
                transition={{ duration: reduce ? 0 : 0.9, delay: reduce ? 0 : 0.35 + i * 0.07, ease: EASE }}
              />
            </span>
            <span className="font-figures w-14 text-right text-[11.5px] text-fg">
              {active ? c.display : ""}
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
  const reduce = useReducedMotion();
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
          <span className="font-figures text-2xs font-normal text-fg-subtle">
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
                className={cn("aspect-square rounded-[3px]", t && "border border-border")}
              />
            );
          }
          const step = Math.min(8, Math.max(1, Math.ceil(s.intensity * 8)));
          return (
            <motion.span
              key={k}
              title={`${s.name}: ${s.display}`}
              className="aspect-square rounded-[3px]"
              style={{ background: `var(--seq-${step})` }}
              initial={false}
              animate={{ opacity: active ? 1 : 0.12, scale: active ? 1 : 0.85 }}
              transition={{ duration: reduce ? 0 : 0.5, delay: reduce ? 0 : 0.4 + (k % cols) * 0.035 }}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-fg-subtle" aria-hidden>
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
  const reduce = useReducedMotion();
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
            transition={
              reduce ? { duration: 0 } : { duration: 0.45, delay: active ? 1.1 + i * 0.15 : 0, ease: EASE }
            }
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", color)} aria-hidden />
            <div className="min-w-0">
              <p className="text-ui font-medium text-fg">{ins.title}</p>
              <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-fg-muted">{ins.body}</p>
            </div>
          </motion.li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function HeroPreview({
  data,
}: {
  data: Pick<LandingData, "file" | "detection" | "columns" | "states" | "tiles">;
}) {
  const reduce = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });
  const [stage, setStage] = React.useState(0);
  const [presetIndex, setPresetIndex] = React.useState(0);
  const state = data.states[presetIndex] ?? data.states[0];

  // Run the pipeline sequence once, when the panel first scrolls into view.
  React.useEffect(() => {
    if (!inView) return;
    const timers = STAGE_AT.map((at, i) => window.setTimeout(() => setStage(i + 1), reduce ? 0 : at));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [inView, reduce]);

  const rows = useMotionValue(0);
  const rowsText = useTransform(rows, (v) => formatValue(v, "integer", { locale: "IN", currency: "INR" }));
  const totalRows = Number(data.file.rows.replace(/[^\d]/g, ""));
  React.useEffect(() => {
    if (stage < 1) return;
    if (reduce) {
      rows.set(totalRows);
      return;
    }
    const c = animate(rows, totalRows, { duration: 0.6, ease: EASE });
    return () => c.stop();
  }, [stage, reduce, rows, totalRows]);

  if (!state) return null;
  const computed = stage >= 4;
  const detected = stage >= 3;

  return (
    <div ref={ref} className="relative">
      {/* Brass glow behind the panel */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-10 -top-16 bottom-0 -z-10 bg-[radial-gradient(60%_55%_at_50%_20%,var(--mesh-1),transparent_70%)]"
      />
      <motion.div
        role="figure"
        aria-label="Preview of a Loupe dashboard computed from the demo e-commerce dataset"
        initial={reduce ? false : { opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE, delay: 0.15 }}
        className="overflow-hidden rounded-panel border border-border-strong bg-surface-1 shadow-lift"
      >
        {/* Title bar: file, pipeline stage, date range */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2 text-ui">
            <FileSpreadsheet className="size-4 shrink-0 text-accent" aria-hidden />
            <span className="truncate font-medium text-fg">{data.file.name}</span>
            <span className="font-figures hidden shrink-0 text-2xs text-fg-subtle sm:inline">
              <motion.span>{rowsText}</motion.span> rows · {data.file.columns} columns
            </span>
          </div>
          <ol
            className="order-3 flex w-full flex-wrap items-center gap-1 text-2xs sm:order-none sm:ml-auto sm:w-auto sm:flex-nowrap"
            aria-label="Pipeline progress"
          >
            {STAGES.map((label, i) => {
              const done = stage > i + 1 || (computed && i === STAGES.length - 1);
              const current = stage === i + 1 && !done;
              return (
                <li key={label} className="flex items-center gap-1">
                  {i ? (
                    <span
                      aria-hidden
                      className={cn(
                        "hidden h-px w-4 sm:block",
                        stage > i ? "bg-accent/60" : "bg-border-strong",
                      )}
                    />
                  ) : null}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors duration-300",
                      done
                        ? "border-transparent bg-accent-soft text-accent"
                        : current
                          ? "border-border-accent text-fg"
                          : "border-border text-fg-subtle",
                    )}
                    aria-current={current ? "step" : undefined}
                  >
                    {done ? (
                      <Check className="size-3" aria-hidden />
                    ) : current ? (
                      <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
                    ) : null}
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
          <div
            role="group"
            aria-label="Date range"
            className="ml-auto flex items-center rounded-control border border-border bg-surface-2 p-0.5 sm:ml-0"
          >
            {data.states.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={i === presetIndex}
                title={s.label}
                onClick={() => setPresetIndex(i)}
                className={cn(
                  "font-figures rounded-[7px] px-2 py-0.5 text-2xs transition-colors",
                  i === presetIndex
                    ? "bg-surface-3 text-fg shadow-[0_0_0_1px_var(--border-strong)]"
                    : "text-fg-subtle hover:text-fg",
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
                {detected ? (
                  <ConfidenceRing value={data.detection.confidence} size={92} label="match" />
                ) : (
                  <div className="size-[92px] rounded-full border-[6px] border-surface-3" aria-hidden />
                )}
              </div>
              <motion.div
                className="min-w-0"
                initial={false}
                animate={{ opacity: detected ? 1 : 0.15 }}
                transition={{ duration: 0.5 }}
              >
                <p className="text-2xs font-medium tracking-[0.12em] text-fg-subtle uppercase">Detected</p>
                <p className="font-display text-[26px] leading-tight text-fg">{data.detection.domain}</p>
                <p className="text-ui text-fg-muted">
                  {data.detection.subDomain} · one row per {data.detection.grain}
                </p>
              </motion.div>
            </div>
            <div className="hidden lg:block">
              <p className="mb-2 flex items-baseline justify-between text-2xs font-medium tracking-[0.12em] text-fg-subtle uppercase">
                Columns profiled
                <span className="font-figures tracking-normal normal-case">
                  {stage >= 2 ? data.columns.length : 0}
                </span>
              </p>
              <ul className="mask-fade-b grid max-h-[248px] gap-px overflow-hidden" aria-label="Column roles">
                {data.columns.map((c, i) => (
                  <motion.li
                    key={c.name}
                    className="flex items-center justify-between gap-3 rounded-[6px] px-1.5 py-[3px] text-[11.5px]"
                    initial={false}
                    animate={{ opacity: stage >= 2 ? 1 : 0, x: stage >= 2 ? 0 : -6 }}
                    transition={{ duration: 0.25, delay: stage >= 2 && !reduce ? i * 0.032 : 0 }}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ background: ROLE_DOT[c.role] ?? "var(--fg-subtle)" }}
                        aria-hidden
                      />
                      <span className="font-figures truncate text-fg">{c.name}</span>
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
              <p className="font-figures text-2xs text-fg-subtle">
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
