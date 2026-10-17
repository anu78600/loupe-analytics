"use client";

/**
 * "How it works", played like a short film. Five steps take turns: the tab on
 * the left fills like a progress bar while the stage on the right plays that
 * step's motion graphic. Every graphic is drawn from the build-time engine
 * snapshot (preview-data.ts): the real demo file and its columns, its
 * detection and column mapping, the real number of chart types the builder
 * offers, and the finished dashboard's figures. Table cells that only suggest
 * rows are blank bars, never invented values.
 *
 * It plays only while on screen, holds while the pointer or keyboard focus is
 * on it, has a Pause button (WCAG 2.2.2), and doesn't advance by itself under
 * reduced motion. The tabs follow the WAI-ARIA tabs pattern (arrow keys, Home
 * and End move and select).
 *
 * Below lg the tabs sit above the stage, so every caption stays open there: a
 * caption opening and another closing would move the stage at every step.
 */
import * as React from "react";
import { AnimatePresence, motion, useInView, type Variants } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  ChartColumn,
  ChartLine,
  ChartScatter,
  Check,
  Donut,
  FileSpreadsheet,
  Filter,
  Gauge,
  GitMerge,
  Grid3x3,
  GripVertical,
  LayoutDashboard,
  LayoutGrid,
  Minus,
  Pause,
  Play,
  Radar,
  ScanSearch,
  SlidersHorizontal,
  Table,
  Upload,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { ConfidenceRing } from "@/ui/workspace/ConfidenceRing";
import { cn } from "@/lib/utils";
import { DrawOn, EASE, useCalm, useLive, useTicker } from "./motion";
import type { LandingData, PreviewKpi, PreviewState } from "./preview-data";

/** How long each step plays before the next, in ms. */
const STEP_MS = 5600;

export interface PipelineData {
  file: LandingData["file"];
  detection: LandingData["detection"];
  columns: LandingData["columns"];
  health: LandingData["health"];
  chartTypes: number;
  state: PreviewState;
}

interface StepDef {
  id: "drop" | "detect" | "map" | "customise" | "present";
  icon: LucideIcon;
  title: string;
  caption: (d: PipelineData) => string;
}

const STEPS: StepDef[] = [
  {
    id: "drop",
    icon: Upload,
    title: "Drop a file",
    caption: () => "CSV, Excel or JSON, read inside this tab.",
  },
  {
    id: "detect",
    icon: ScanSearch,
    title: "It reads the business",
    caption: () => "Industry, grain and key fields, with a confidence score.",
  },
  {
    id: "map",
    icon: GitMerge,
    title: "Check and map",
    caption: () => "Every column matched to what it means.",
  },
  {
    id: "customise",
    icon: SlidersHorizontal,
    title: "Make it yours",
    caption: (d) => `Your KPIs, your layout, ${d.chartTypes} chart types.`,
  },
  {
    id: "present",
    icon: LayoutDashboard,
    title: "Present it",
    caption: () => "KPIs, trends and insights, ready to share.",
  },
];

/* ------------------------------------------------------------------ */
/* Shared motion                                                       */
/* ------------------------------------------------------------------ */

/** A visual's root: its children play in sequence once it is on screen. */
const ROOT: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } } };
const RISE: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
};

function Root({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      className={cn("w-full", className)}
      variants={ROOT}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.3 }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Drop a file                                                      */
/* ------------------------------------------------------------------ */

function DropVisual({ data }: { data: PipelineData }) {
  const cols = data.columns.slice(0, 4);
  return (
    <Root className="max-w-[460px]">
      <div className="relative rounded-card border border-dashed border-border-accent bg-accent-soft px-5 pt-6 pb-6">
        <motion.div
          variants={{
            hidden: { opacity: 0, y: -80, rotate: -8, scale: 0.9 },
            show: {
              opacity: 1,
              y: 0,
              rotate: 0,
              scale: 1,
              transition: { type: "spring", stiffness: 200, damping: 19 },
            },
          }}
          className="mx-auto flex w-fit max-w-full items-center gap-3 rounded-card border border-border-strong bg-surface-2 px-4 py-3 shadow-pop"
        >
          <FileSpreadsheet className="size-5 shrink-0 text-accent" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-ui font-medium text-fg">{data.file.name}</span>
            <span className="tabular block text-xs text-fg-subtle">
              {data.file.rows} rows · {data.file.columns} columns
            </span>
          </span>
        </motion.div>
        <div className="mx-auto mt-5 h-1 w-full max-w-[240px] overflow-hidden rounded-full bg-surface-3">
          <motion.div
            className="h-full origin-left rounded-full bg-[image:var(--accent-gradient)]"
            variants={{
              hidden: { scaleX: 0 },
              show: { scaleX: 1, transition: { duration: 1.1, delay: 0.5, ease: EASE } },
            }}
          />
        </div>
      </div>
      {/* The file's real column names; the cells are placeholders that suggest rows, not values. A
          phone shows three columns, so each name is read whole rather than cut short. */}
      <motion.div
        className="mt-4 overflow-hidden rounded-card border border-border bg-surface-2/70"
        variants={{
          hidden: { opacity: 0, y: 12 },
          show: { opacity: 1, y: 0, transition: { delay: 1.45, duration: 0.5, ease: EASE } },
        }}
      >
        <div className="grid grid-cols-3 border-b border-border sm:grid-cols-4">
          {cols.map((c, i) => (
            <span
              key={c.name}
              className={cn("truncate px-3 py-2 text-xs font-medium text-fg", i === 3 && "max-sm:hidden")}
            >
              {c.name}
            </span>
          ))}
        </div>
        {[0, 1, 2, 3].map((r) => (
          <motion.div
            key={r}
            className="grid grid-cols-3 sm:grid-cols-4"
            variants={{
              hidden: { opacity: 0, x: -10 },
              show: { opacity: 1, x: 0, transition: { delay: 1.65 + r * 0.1, duration: 0.4 } },
            }}
          >
            {cols.map((c, i) => (
              <span key={c.name} className={cn("px-3 py-2", i === 3 && "max-sm:hidden")}>
                <span
                  className="block h-1.5 rounded-full bg-surface-3"
                  style={{ width: `${40 + ((r * 7 + i * 13) % 50)}%` }}
                />
              </span>
            ))}
          </motion.div>
        ))}
      </motion.div>
    </Root>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Detect                                                           */
/* ------------------------------------------------------------------ */

function DetectVisual({ data }: { data: PipelineData }) {
  const { detection } = data;
  return (
    <Root className="grid max-w-[480px] gap-6">
      {/* On the narrowest phones the ring and the name shrink, so the name keeps to one line. */}
      <div className="flex items-center gap-4 sm:gap-5">
        <div className="shrink-0 max-[379.98px]:[zoom:0.8]">
          <ConfidenceRing value={detection.confidence} size={118} label="match" />
        </div>
        <motion.div variants={RISE} className="min-w-0">
          <p className="eyebrow text-fg-subtle">Detected</p>
          <p className="font-display text-display-xs text-fg sm:text-display-sm">{detection.domain}</p>
          <p className="text-ui text-fg-muted">
            {detection.subDomain} · one row per {detection.grain}
          </p>
        </motion.div>
      </div>
      <div className="grid gap-3">
        {detection.candidates.map((c, i) => (
          <motion.div
            key={c.name}
            variants={RISE}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 text-ui"
          >
            <span className={i === 0 ? "text-fg" : "text-fg-muted"}>{c.name}</span>
            <span className="font-figures text-xs text-fg-muted">{c.confidence}%</span>
            <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <motion.span
                className={cn(
                  "block h-full origin-left rounded-full",
                  i === 0 ? "bg-[image:var(--accent-gradient)]" : "bg-fg-subtle/50",
                )}
                style={{ width: `${c.confidence}%` }}
                variants={{
                  hidden: { scaleX: 0 },
                  show: { scaleX: 1, transition: { duration: 0.9, delay: 0.45 + i * 0.12, ease: EASE } },
                }}
              />
            </span>
          </motion.div>
        ))}
      </div>
    </Root>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Check and map                                                    */
/* ------------------------------------------------------------------ */

const ROW = 36;
const GAP = 10;

function MapVisual({ data }: { data: PipelineData }) {
  const pairs = data.detection.evidence.slice(0, 5);
  const n = pairs.length;
  // Each column lands in another row on the right, so the lines cross as a real mapping does.
  const slotOf = pairs.map((_, i) => (i + 2) % n);
  const bySlot = Array.from({ length: n }, (_, j) => pairs[slotOf.indexOf(j)]);
  const yOf = (k: number) => k * (ROW + GAP) + ROW / 2;
  const height = n * ROW + (n - 1) * GAP;
  return (
    <Root className="grid max-w-[500px] gap-5">
      <div className="grid grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-start">
        <div className="grid" style={{ gap: GAP }}>
          {pairs.map((p) => (
            <motion.span
              key={p.column}
              variants={RISE}
              className="flex items-center truncate rounded-[9px] border border-border-strong bg-surface-2 px-3 text-xs font-medium text-fg"
              style={{ height: ROW }}
            >
              {p.column}
            </motion.span>
          ))}
        </div>
        <svg viewBox={`0 0 64 ${height}`} width={64} height={height} aria-hidden className="overflow-visible">
          {pairs.map((p, i) => {
            const y1 = yOf(i);
            const y2 = yOf(slotOf[i] ?? i);
            return (
              <motion.path
                key={p.column}
                d={`M0,${y1} C32,${y1} 32,${y2} 64,${y2}`}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1.5}
                strokeLinecap="round"
                variants={{
                  hidden: { pathLength: 0, opacity: 0 },
                  show: {
                    pathLength: 1,
                    opacity: 0.8,
                    transition: { duration: 0.7, delay: 0.7 + i * 0.16, ease: EASE },
                  },
                }}
              />
            );
          })}
        </svg>
        <div className="grid" style={{ gap: GAP }}>
          {bySlot.map((p) =>
            p ? (
              <motion.span
                key={p.field}
                variants={RISE}
                className="flex items-center justify-between gap-2 rounded-[9px] border border-border bg-surface-1 px-3 text-xs text-fg-muted"
                style={{ height: ROW }}
              >
                <span className="truncate">{p.field}</span>
                <motion.span
                  variants={{
                    hidden: { scale: 0, opacity: 0 },
                    show: {
                      scale: 1,
                      opacity: 1,
                      transition: {
                        delay: 1.25 + pairs.indexOf(p) * 0.16,
                        type: "spring",
                        stiffness: 420,
                        damping: 20,
                      },
                    },
                  }}
                  className="grid size-4 shrink-0 place-items-center rounded-full bg-success-soft text-success"
                >
                  <Check className="size-2.5" strokeWidth={3} aria-hidden />
                </motion.span>
              </motion.span>
            ) : null,
          )}
        </div>
      </div>
      <motion.div variants={RISE} className="flex flex-wrap items-center gap-2 text-ui">
        <span className="rounded-full border border-border-accent bg-accent-soft px-3 py-1 text-accent">
          Data health <span className="font-figures">{data.health.score}/100</span>
        </span>
        <span className="rounded-full border border-border px-3 py-1 text-fg-muted">
          <span className="font-figures">{data.columns.length}</span> columns profiled
        </span>
      </motion.div>
    </Root>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Make it yours                                                    */
/* ------------------------------------------------------------------ */

const GALLERY: Array<{ icon: LucideIcon; name: string }> = [
  { icon: ChartLine, name: "Line" },
  { icon: ChartColumn, name: "Column" },
  { icon: Donut, name: "Donut" },
  { icon: ChartScatter, name: "Scatter" },
  { icon: Grid3x3, name: "Heatmap" },
  { icon: Waypoints, name: "Sankey" },
  { icon: Radar, name: "Radar" },
  { icon: Gauge, name: "Gauge" },
  { icon: LayoutGrid, name: "Treemap" },
  { icon: CalendarDays, name: "Calendar heatmap" },
  { icon: Filter, name: "Funnel" },
  { icon: Table, name: "Table" },
];

function CustomiseVisual({ data }: { data: PipelineData }) {
  const { ref, live } = useLive<HTMLDivElement>(0.3);
  const tick = useTicker(720, live);
  const picked = tick % GALLERY.length;
  // The KPI order shuffles every few beats, as it would when dragged into place.
  const names = data.state.kpis.slice(0, 3).map((k) => k.name);
  const turn = Math.floor(tick / 3) % Math.max(1, names.length);
  const order = names.map((_, i) => names[(i + turn) % names.length] as string);
  return (
    // Flat tiles keep the whole visual, with its third KPI row, inside the stage and clear of the Pause button.
    <Root className="grid max-w-[480px] gap-4">
      <div ref={ref} className="grid grid-cols-4 gap-2.5">
        {GALLERY.map((g, i) => {
          const on = i === picked;
          return (
            <motion.span
              key={g.name}
              variants={{
                hidden: { opacity: 0, scale: 0.8 },
                show: { opacity: 1, scale: 1, transition: { duration: 0.4, ease: EASE } },
              }}
              className={cn(
                "grid aspect-[5/2] place-items-center rounded-card border transition-[border-color,background-color,color,box-shadow] duration-300",
                on
                  ? "border-border-accent bg-accent-soft text-accent shadow-[0_0_0_4px_var(--accent-soft)]"
                  : "border-border bg-surface-2/70 text-fg-subtle",
              )}
              aria-hidden
            >
              <g.icon className="size-5" />
            </motion.span>
          );
        })}
      </div>
      <motion.div variants={RISE} className="flex items-center justify-between gap-3 text-ui">
        <span className="text-fg-muted">
          <span className="font-figures text-fg">{data.chartTypes}</span> chart types, each explained
        </span>
        {/* As wide as the longest name, so the pill doesn't move as the names change. */}
        <span className="min-w-36 shrink-0 rounded-full border border-border-accent bg-accent-soft px-3 py-1 text-center text-accent">
          {GALLERY[picked]?.name}
        </span>
      </motion.div>
      <motion.ul variants={RISE} className="grid gap-1.5" aria-label="Your headline KPIs">
        {order.map((name) => (
          <motion.li
            key={name}
            layout
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="flex items-center gap-2 rounded-[9px] border border-border bg-surface-2/70 px-3 py-2 text-ui text-fg"
          >
            <GripVertical className="size-3.5 text-fg-subtle" aria-hidden />
            {name}
          </motion.li>
        ))}
      </motion.ul>
    </Root>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Present it                                                       */
/* ------------------------------------------------------------------ */

function Delta({ kpi }: { kpi: PreviewKpi }) {
  const Icon = kpi.change === "up" ? ArrowUpRight : kpi.change === "down" ? ArrowDownRight : Minus;
  const tone =
    kpi.tone === "good"
      ? "bg-success-soft text-success"
      : kpi.tone === "bad"
        ? "bg-danger-soft text-danger"
        : "bg-surface-3 text-fg-muted";
  return (
    <span
      className={cn(
        "font-figures inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
        tone,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {kpi.deltaText}
    </span>
  );
}

function PresentVisual({ data }: { data: PipelineData }) {
  const { state } = data;
  const values = state.trend.values;
  const max = Math.max(...values, 1);
  const W = 300;
  const H = 92;
  const line = values
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${((i / Math.max(1, values.length - 1)) * W).toFixed(1)},${(H - (v / max) * H).toFixed(1)}`,
    )
    .join("");
  const cats = state.categories.slice(0, 4);
  const top = Math.max(...cats.map((c) => c.share), 0.0001);
  return (
    <Root className="grid max-w-[500px] gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        {state.kpis.slice(0, 4).map((k, i) => (
          <motion.div
            key={k.id}
            variants={{
              hidden: { opacity: 0, scale: 0.9, y: 10 },
              show: {
                opacity: 1,
                scale: 1,
                y: 0,
                transition: { type: "spring", stiffness: 260, damping: 22 },
              },
            }}
            // On a phone two cards are enough: with four, the wrapped names and changes push the
            // visual past the stage and under the Pause button.
            className={cn(
              "rounded-card border border-border bg-surface-2/80 px-3.5 py-3",
              i >= 2 && "max-sm:hidden",
            )}
          >
            <p className="eyebrow text-fg-subtle">{k.name}</p>
            <p className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <span className="font-figures text-xl leading-none font-medium text-fg">{k.display}</span>
              <Delta kpi={k} />
            </p>
          </motion.div>
        ))}
      </div>
      <motion.div
        variants={RISE}
        className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4 rounded-card border border-border bg-surface-2/80 p-3.5"
      >
        <figure className="min-w-0" aria-label={`${state.trend.title}, ${state.label}`}>
          <figcaption className="truncate text-xs text-fg-subtle">{state.trend.title}</figcaption>
          <svg viewBox={`0 -4 ${W} ${H + 8}`} className="mt-2 h-auto w-full overflow-visible" aria-hidden>
            <DrawOn box={[-4, -10, W + 8, H + 20]} transition={{ duration: 1.4, delay: 0.7, ease: EASE }}>
              <path
                d={line}
                fill="none"
                stroke="var(--chart-1)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </DrawOn>
          </svg>
        </figure>
        <ul className="grid content-center gap-2" aria-label={`Net revenue by category, ${state.label}`}>
          {cats.map((c, i) => (
            <li key={c.label} className="grid gap-1 text-xs">
              {/* The name may wrap; the figure keeps its place at the end. */}
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 text-fg-muted">{c.label}</span>
                <span className="font-figures shrink-0 text-fg">{c.display}</span>
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <motion.span
                  className="block h-full origin-left rounded-full bg-[var(--chart-1)]"
                  style={{ width: `${(c.share / top) * 100}%` }}
                  variants={{
                    hidden: { scaleX: 0 },
                    show: { scaleX: 1, transition: { duration: 0.8, delay: 0.9 + i * 0.1, ease: EASE } },
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
      </motion.div>
    </Root>
  );
}

function StepVisual({ id, data }: { id: StepDef["id"]; data: PipelineData }) {
  switch (id) {
    case "drop":
      return <DropVisual data={data} />;
    case "detect":
      return <DetectVisual data={data} />;
    case "map":
      return <MapVisual data={data} />;
    case "customise":
      return <CustomiseVisual data={data} />;
    case "present":
      return <PresentVisual data={data} />;
  }
}

/* ------------------------------------------------------------------ */
/* The player                                                          */
/* ------------------------------------------------------------------ */

export function Pipeline({ data }: { data: PipelineData }) {
  const reduce = useCalm();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35 });
  const [active, setActive] = React.useState(0);
  const [held, setHeld] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const tabs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const auto = !reduce;
  const playing = auto && inView && !held && !paused;
  const step = STEPS[active] ?? STEPS[0];

  const select = (i: number, focus = false) => {
    setActive(i);
    if (focus) tabs.current[i]?.focus();
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const last = STEPS.length - 1;
    const to =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? i === last
          ? 0
          : i + 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? i === 0
            ? last
            : i - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (to === null) return;
    e.preventDefault();
    select(to, true);
  };

  return (
    <div
      ref={ref}
      className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-8"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      <div
        role="tablist"
        aria-label="How Loupe works"
        aria-orientation="vertical"
        className="grid content-start gap-1.5"
      >
        {STEPS.map((s, i) => {
          const selected = i === active;
          return (
            <button
              key={s.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`how-tab-${s.id}`}
              aria-selected={selected}
              aria-controls="how-stage"
              tabIndex={selected ? 0 : -1}
              onClick={() => select(i)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3.5 overflow-hidden rounded-card border px-4 py-3.5 text-left transition-[background-color,border-color,box-shadow] duration-300",
                selected
                  ? "border-border-strong bg-surface-1 shadow-card"
                  : "border-transparent hover:bg-surface-1/60",
              )}
            >
              <span
                className={cn(
                  "grid size-9 place-items-center rounded-control border transition-colors duration-300",
                  selected
                    ? "border-border-accent bg-accent-soft text-accent"
                    : "border-border text-fg-subtle",
                )}
              >
                <s.icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 self-center">
                <span className="flex items-baseline gap-2.5">
                  <span className="font-figures text-2xs text-fg-subtle">0{i + 1}</span>
                  <span
                    className={cn(
                      "text-md font-medium transition-colors",
                      selected ? "text-fg" : "text-fg-muted",
                    )}
                  >
                    {s.title}
                  </span>
                </span>
                {/* From lg the caption opens with a CSS grid-row transition, not Framer's `height: auto`,
                    which resets the scroll position to measure and so would stop a smooth scroll mid-way.
                    Below lg every caption stays open, so the stage under the tabs never moves. No caption
                    is hidden from assistive technology, so a tab's name always holds the text it shows. */}
                <span
                  className={cn(
                    "grid grid-rows-[1fr] transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-out-quint)]",
                    selected ? "opacity-100" : "opacity-100 lg:grid-rows-[0fr] lg:opacity-0",
                  )}
                >
                  <span className="overflow-hidden">
                    <span className="block pt-1 text-sm text-fg-muted">{s.caption(data)}</span>
                  </span>
                </span>
              </span>
              {selected ? (
                <span
                  aria-hidden
                  className="absolute inset-x-4 bottom-0 h-0.5 overflow-hidden rounded-full bg-border"
                >
                  {/* The fill is the timer: when its animation ends, the next step plays. */}
                  <span
                    className="block h-full origin-left bg-[image:var(--accent-gradient)]"
                    style={
                      auto
                        ? {
                            animation: `progress-fill ${STEP_MS}ms linear both`,
                            animationPlayState: playing ? "running" : "paused",
                          }
                        : { transform: "scaleX(1)" }
                    }
                    onAnimationEnd={auto ? () => setActive((a) => (a + 1) % STEPS.length) : undefined}
                  />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        id="how-stage"
        role="tabpanel"
        aria-labelledby={`how-tab-${step.id}`}
        className="relative isolate h-[440px] overflow-hidden rounded-panel border border-border-strong bg-surface-1 shadow-lift sm:h-[460px]"
      >
        <div aria-hidden className="grid-lines absolute inset-0 -z-10 opacity-80" />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(70%_55%_at_50%_0%,var(--mesh-1),transparent_70%)]"
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step.id}
            // One column as wide as the stage: an auto column would grow to a visual's widest line.
            className="absolute inset-0 grid grid-cols-[minmax(0,1fr)] place-items-center p-5 sm:p-8"
            initial={{ opacity: 0, y: 16, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -12, filter: "blur(8px)" }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            <StepVisual id={step.id} data={data} />
          </motion.div>
        </AnimatePresence>
        {auto ? (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2/80 px-2.5 py-1 text-xs text-fg-muted backdrop-blur transition-colors hover:text-fg"
          >
            {paused ? <Play className="size-3" aria-hidden /> : <Pause className="size-3" aria-hidden />}
            {paused ? "Play" : "Pause"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
