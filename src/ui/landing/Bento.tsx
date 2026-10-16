"use client";

/**
 * The features grid: seven tiles, each a title, one short line and a small
 * motion graphic in place of a paragraph.
 *
 * - The KPI's real SQL and DAX type themselves out, alternating.
 * - The proof checklist ticks itself off.
 * - The real category breakdown changes form: sorted bars, a donut, a treemap.
 * - A scanning light reads the real columns and tags their roles.
 * - The real headline insight, over its real trend.
 * - The export formats burst out of the package.
 * - A request typed in words becomes the real breakdown.
 *
 * Every figure is from the build-time snapshot (preview-data.ts). Loops play
 * only while a tile is on screen and stop under reduced motion: the JavaScript
 * ones through useLive, the CSS ones (a caret, the scan, the pulse) through
 * their [data-loop] host (PauseOffscreen).
 */
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  Braces,
  Database,
  FileDown,
  LineChart,
  MessageSquareText,
  Package,
  Sparkles,
  Table2,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DrawOn, EASE, Reveal, Spotlight, Typewriter, useLive, useTicker } from "./motion";
import type { LandingData, PreviewState } from "./preview-data";

export interface BentoData {
  showcase: LandingData["showcase"];
  state: PreviewState;
  columns: LandingData["columns"];
  health: LandingData["health"];
}

type Part = { label: string; share: number; display: string };

/** The real categories' shares of the total, the largest five plus everything else as Others. */
function partsOf(state: PreviewState): Part[] {
  const top = state.categories.slice(0, 5);
  const rest = Math.max(0, 1 - top.reduce((a, c) => a + c.share, 0));
  return rest > 0.004 ? [...top, { label: "Others", share: rest, display: "" }] : top;
}

const SLICE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const colourOf = (p: Part, i: number) =>
  p.label === "Others" ? "var(--chart-other)" : (SLICE[i] ?? "var(--chart-other)");

/* ------------------------------------------------------------------ */
/* Tile shell                                                          */
/* ------------------------------------------------------------------ */

function Tile({
  icon: Icon,
  title,
  line,
  className,
  delay = 0,
  children,
}: {
  icon: LucideIcon;
  title: string;
  line: string;
  className?: string;
  delay?: number;
  children: React.ReactNode;
}) {
  return (
    <Reveal className={cn("min-w-0", className)} delay={delay} amount={0.2}>
      <Spotlight className="flex h-full min-w-0 flex-col gap-5 overflow-hidden rounded-panel border border-border bg-surface-1 p-6 shadow-card">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-[9px] border border-border-accent bg-accent-soft text-accent">
              <Icon className="size-4" aria-hidden />
            </span>
            <h3 className="text-[15px] font-medium text-fg">{title}</h3>
          </div>
          <p className="mt-2 text-ui text-fg-muted">{line}</p>
        </div>
        {children}
      </Spotlight>
    </Reveal>
  );
}

/* ------------------------------------------------------------------ */
/* SQL and DAX                                                         */
/* ------------------------------------------------------------------ */

function CodeTile({ kpi }: { kpi: LandingData["showcase"]["kpi"] }) {
  const { ref, live } = useLive<HTMLDivElement>(0.4);
  const tick = useTicker(9000, live);
  const [chosen, setChosen] = React.useState<"sql" | "dax" | null>(null);
  const lang = chosen ?? (tick % 2 === 0 ? "sql" : "dax");
  const code = lang === "sql" ? kpi.sql : kpi.dax;
  return (
    <div ref={ref} data-loop className="grid min-w-0 gap-3">
      <p className="text-ui text-fg-muted">
        <span className="font-medium text-fg">{kpi.name}</span>{" "}
        <span className="font-figures text-fg">= {kpi.formula}</span>
      </p>
      <div className="min-w-0 overflow-hidden rounded-card border border-border bg-bg">
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5">
          <div className="flex gap-1" role="group" aria-label="Show the query in">
            {(["sql", "dax"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => setChosen(l)}
                className={cn(
                  "rounded-[7px] px-2 py-0.5 text-2xs font-medium tracking-[0.08em] uppercase transition-colors",
                  lang === l ? "bg-accent-soft text-accent" : "text-fg-subtle hover:text-fg",
                )}
              >
                {l === "sql" ? "SQL" : "DAX"}
              </button>
            ))}
          </div>
          <span className="font-figures truncate text-2xs text-fg-subtle">
            {lang === "sql" ? "DuckDB · PostgreSQL" : `[${kpi.daxName}]`}
          </span>
        </div>
        {/* Focusable so keyboard users can scroll long code. */}
        <pre
          tabIndex={0}
          aria-label={`${kpi.name} in ${lang === "sql" ? "SQL" : "DAX"}`}
          className="font-figures h-[208px] overflow-auto p-3 text-[11.5px] leading-[1.65] [overflow-wrap:anywhere] whitespace-pre-wrap text-fg-muted focus-visible:outline-offset-[-2px]"
        >
          <code>
            <Typewriter
              key={chosen ? lang : `${lang}-${tick}`}
              text={code}
              active={live}
              charsPerSecond={260}
            />
          </code>
        </pre>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Proof checklist                                                     */
/* ------------------------------------------------------------------ */

const CHECKS = [
  "Engine and SQL agree to the decimal",
  "Checked for every month, not just the total",
  "Every fallback formula, not just the first",
  "Run again on your own data, in the browser",
];

function ProofTile() {
  return (
    <motion.ul
      className="mt-auto grid gap-2.5"
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.5 }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.28, delayChildren: 0.2 } } }}
    >
      {CHECKS.map((c) => (
        <motion.li
          key={c}
          className="flex items-center gap-3 rounded-card border border-border bg-surface-2/60 px-3 py-2.5 text-ui text-fg"
          variants={{ hidden: { opacity: 0.35 }, show: { opacity: 1, transition: { duration: 0.3 } } }}
        >
          <svg viewBox="0 0 20 20" className="size-5 shrink-0" aria-hidden>
            <circle cx="10" cy="10" r="9" fill="var(--success-soft)" />
            <motion.path
              d="M6 10.4l2.6 2.6L14 7.6"
              fill="none"
              stroke="var(--success)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              variants={{
                hidden: { pathLength: 0 },
                show: { pathLength: 1, transition: { duration: 0.45, ease: EASE } },
              }}
            />
          </svg>
          {c}
        </motion.li>
      ))}
    </motion.ul>
  );
}

/* ------------------------------------------------------------------ */
/* One breakdown, three forms                                          */
/* ------------------------------------------------------------------ */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  i: number;
}

/** Splits the rectangle in two at the halfway sum, along its longer side, and recurses. */
function layoutTreemap(values: number[], x: number, y: number, w: number, h: number, idx: number[]): Box[] {
  if (idx.length === 1) return [{ x, y, w, h, i: idx[0] as number }];
  const total = idx.reduce((a, i) => a + (values[i] ?? 0), 0) || 1;
  let acc = 0;
  let k = 0;
  while (k < idx.length - 1 && acc + (values[idx[k] as number] ?? 0) <= total / 2) {
    acc += values[idx[k] as number] ?? 0;
    k++;
  }
  if (k === 0) {
    acc = values[idx[0] as number] ?? 0;
    k = 1;
  }
  const f = acc / total;
  const [a, b] = [idx.slice(0, k), idx.slice(k)];
  return w >= h
    ? [...layoutTreemap(values, x, y, w * f, h, a), ...layoutTreemap(values, x + w * f, y, w * (1 - f), h, b)]
    : [
        ...layoutTreemap(values, x, y, w, h * f, a),
        ...layoutTreemap(values, x, y + h * f, w, h * (1 - f), b),
      ];
}

function Legend({ parts }: { parts: Part[] }) {
  return (
    <ul className="grid content-center gap-1.5 text-[11px]">
      {parts.map((p, i) => (
        <li key={p.label} className="flex min-w-0 items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-[3px]"
            style={{ background: colourOf(p, i) }}
            aria-hidden
          />
          <span className="truncate text-fg-muted">{p.label}</span>
          <span className="font-figures ml-auto shrink-0 text-fg">{Math.round(p.share * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}

function MorphBars({ parts }: { parts: Part[] }) {
  const named = parts.filter((p) => p.label !== "Others");
  const top = Math.max(...named.map((p) => p.share), 0.0001);
  return (
    <ul className="grid h-full content-center gap-2">
      {named.map((p, i) => (
        <li
          key={p.label}
          className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-2 text-[11px]"
        >
          <span className="truncate text-fg-muted">{p.label}</span>
          <span className="h-2.5 overflow-hidden rounded-r-[4px]">
            <motion.span
              className="block h-full origin-left rounded-r-[4px] bg-[var(--chart-1)]"
              style={{ width: `${(p.share / top) * 100}%` }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.7, delay: i * 0.06, ease: EASE }}
            />
          </span>
          <span className="font-figures text-fg">{p.display}</span>
        </li>
      ))}
    </ul>
  );
}

function MorphDonut({ parts }: { parts: Part[] }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  // Where each slice starts, as a share of the ring.
  const starts = parts.map((_, i) => parts.slice(0, i).reduce((a, p) => a + p.share, 0));
  return (
    <div className="grid h-full grid-cols-[132px_minmax(0,1fr)] items-center gap-4">
      <svg viewBox="0 0 120 120" className="size-[132px] -rotate-90" aria-hidden>
        {parts.map((p, i) => {
          // A 2px gap of surface between neighbouring slices.
          const len = Math.max(0, p.share * c - 2);
          const offset = -(starts[i] ?? 0) * c;
          return (
            <motion.circle
              key={p.label}
              cx={60}
              cy={60}
              r={r}
              fill="none"
              stroke={colourOf(p, i)}
              strokeWidth={20}
              strokeDashoffset={offset}
              initial={{ strokeDasharray: `0 ${c}` }}
              animate={{ strokeDasharray: `${len} ${c}` }}
              transition={{ duration: 0.8, delay: i * 0.08, ease: EASE }}
            />
          );
        })}
      </svg>
      <Legend parts={parts} />
    </div>
  );
}

function MorphTreemap({ parts }: { parts: Part[] }) {
  const boxes = layoutTreemap(
    parts.map((p) => p.share),
    0,
    0,
    100,
    100,
    parts.map((_, i) => i),
  );
  return (
    <div className="grid h-full grid-cols-[132px_minmax(0,1fr)] items-center gap-4">
      <div className="relative size-[132px]" aria-hidden>
        {boxes.map((b, k) => {
          const p = parts[b.i] as Part;
          return (
            <motion.span
              key={p.label}
              className="absolute rounded-[4px]"
              style={{
                left: `calc(${b.x}% + 1px)`,
                top: `calc(${b.y}% + 1px)`,
                width: `calc(${b.w}% - 2px)`,
                height: `calc(${b.h}% - 2px)`,
                background: colourOf(p, b.i),
              }}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: k * 0.07, ease: EASE }}
            />
          );
        })}
      </div>
      <Legend parts={parts} />
    </div>
  );
}

const FORMS = ["Sorted bars", "Donut", "Treemap"] as const;

function MorphTile({ state }: { state: PreviewState }) {
  const { ref, live } = useLive<HTMLDivElement>(0.45);
  const tick = useTicker(3400, live);
  const form = FORMS[tick % FORMS.length] ?? FORMS[0];
  const parts = partsOf(state);
  return (
    <div ref={ref} className="mt-auto grid gap-3">
      <div className="flex items-center justify-between gap-2 text-2xs">
        <span className="text-fg-subtle">Net revenue by category · {state.label}</span>
        <span className="rounded-full border border-border-accent bg-accent-soft px-2 py-0.5 text-accent">
          {form}
        </span>
      </div>
      <div className="relative h-[176px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={form}
            className="absolute inset-0"
            initial={{ opacity: 0, filter: "blur(6px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(6px)" }}
            transition={{ duration: 0.35 }}
          >
            {form === "Donut" ? (
              <MorphDonut parts={parts} />
            ) : form === "Treemap" ? (
              <MorphTreemap parts={parts} />
            ) : (
              <MorphBars parts={parts} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Column profile                                                      */
/* ------------------------------------------------------------------ */

function ProfileTile({
  columns,
  health,
}: {
  columns: LandingData["columns"];
  health: LandingData["health"];
}) {
  const picks = ["Order Date", "Net Amount", "Payment Method", "Customer State", "Customer ID"]
    .map((name) => columns.find((c) => c.name === name))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  const list = picks.length >= 4 ? picks : columns.slice(0, 5);
  return (
    <div data-loop className="relative mt-auto grid gap-3">
      <div className="relative overflow-hidden rounded-card border border-border bg-bg">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-10 animate-[scan-down_3.6s_linear_infinite] bg-[linear-gradient(180deg,transparent,var(--accent-soft),transparent)]"
        />
        <motion.ul
          className="grid divide-y divide-border"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.5 }}
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.18, delayChildren: 0.2 } } }}
        >
          {list.map((c) => (
            <li key={c.name} className="flex items-center justify-between gap-3 px-3 py-2 text-[11.5px]">
              <span className="font-figures truncate text-fg">{c.name}</span>
              <motion.span
                className="shrink-0 rounded-full border border-border px-2 py-0.5 text-fg-muted"
                variants={{
                  hidden: { opacity: 0, x: 8 },
                  show: { opacity: 1, x: 0, transition: { duration: 0.35, ease: EASE } },
                }}
              >
                {c.type} · {c.role}
              </motion.span>
            </li>
          ))}
        </motion.ul>
      </div>
      <p className="text-2xs text-fg-subtle">
        Demo file health: <span className="font-figures text-fg">{health.score}/100</span> ({health.grade})
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Insight                                                             */
/* ------------------------------------------------------------------ */

function InsightTile({ state, title }: { state: PreviewState; title: string }) {
  const values = state.trend.values;
  const max = Math.max(...values, 1);
  const W = 260;
  const H = 84;
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * W, H - (v / max) * H] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  return (
    <motion.div
      className="mt-auto grid gap-3 rounded-card border border-border bg-surface-2/60 p-4"
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.5 }}
    >
      <p className="flex gap-2.5 text-ui font-medium text-fg">
        <TrendingUp className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        {title}
      </p>
      <div data-loop className="relative">
        <svg
          viewBox={`-4 -6 ${W + 8} ${H + 12}`}
          className="block h-auto w-full overflow-visible"
          aria-hidden
        >
          <DrawOn box={[-8, -12, W + 16, H + 24]} transition={{ duration: 1.4, ease: EASE }}>
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
          {last ? (
            <motion.circle
              cx={last[0]}
              cy={last[1]}
              r={4}
              fill="var(--chart-1)"
              variants={{
                hidden: { scale: 0 },
                show: { scale: 1, transition: { delay: 1.3, type: "spring" } },
              }}
            />
          ) : null}
        </svg>
        {last ? (
          // The pulse is an HTML layer over the end point, the size of the dot: a CSS loop on an
          // SVG shape is restyled and laid out every frame, a layer's is only composited.
          <span
            aria-hidden
            className="absolute aspect-square -translate-x-1/2 -translate-y-1/2 animate-[ping-soft_2.2s_ease-out_infinite] rounded-full bg-[var(--chart-1)]"
            style={{
              left: `${((last[0] + 4) / (W + 8)) * 100}%`,
              top: `${((last[1] + 6) / (H + 12)) * 100}%`,
              width: `${(8 / (W + 8)) * 100}%`,
            }}
          />
        ) : null}
      </div>
      <p className="text-2xs text-fg-subtle">
        From the chart: {state.trend.title} · {state.label}
      </p>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

/** What the Export step makes (ui/workspace/ExportStep.tsx), by its names there. */
const FORMATS = [
  "Power BI package",
  "SQL",
  "PDF report",
  "Presentation slides",
  "Data dictionary",
  "Settings file",
];

function ExportTile() {
  const { ref, live } = useLive<HTMLDivElement>(0.45);
  const tick = useTicker(6000, live);
  // The orbit is as wide as the tile allows, so the labels never leave it on a phone.
  const [width, setWidth] = React.useState(480);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  const rx = Math.max(90, Math.min(170, width / 2 - 64));
  return (
    <div ref={ref} className="relative mt-auto grid h-[210px] place-items-center">
      <div
        aria-hidden
        className="absolute size-40 rounded-full bg-[radial-gradient(circle,var(--glow-accent),transparent_70%)] blur-xl"
      />
      <span className="relative z-10 grid size-16 place-items-center rounded-[18px] border border-border-accent bg-surface-2 text-accent shadow-pop">
        <Package className="size-7" aria-hidden />
      </span>
      <ul key={`${tick}-${live}`} className="absolute inset-0" aria-label="Export formats">
        {FORMATS.map((f, i) => {
          const a = (i / FORMATS.length) * Math.PI * 2 - Math.PI / 2;
          return (
            <motion.li
              key={f}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
              initial={{ opacity: 0, scale: 0.4, x: 0, y: 0 }}
              animate={{ opacity: 1, scale: 1, x: Math.cos(a) * rx, y: Math.sin(a) * 78 }}
              transition={{ type: "spring", stiffness: 140, damping: 16, delay: 0.15 + i * 0.09 }}
            >
              <span className="block rounded-full border border-border-strong bg-surface-1 px-3 py-1 text-2xs whitespace-nowrap text-fg shadow-card">
                {f}
              </span>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ask for a chart                                                     */
/* ------------------------------------------------------------------ */

const REQUEST = "net revenue by category";

function AskTile({ state }: { state: PreviewState }) {
  const { ref, live } = useLive<HTMLDivElement>(0.45);
  const tick = useTicker(8000, live);
  const cats = state.categories.slice(0, 4);
  const top = Math.max(...cats.map((c) => c.share), 0.0001);
  const typed = REQUEST.length / 18;
  return (
    <div ref={ref} data-loop className="mt-auto grid gap-4">
      <div className="flex items-center gap-2.5 rounded-card border border-border-strong bg-bg px-3.5 py-2.5 text-ui text-fg">
        <Sparkles className="size-4 shrink-0 text-accent" aria-hidden />
        <Typewriter key={`${tick}-${live}`} text={REQUEST} active={live} charsPerSecond={18} />
      </div>
      <ul
        key={`${tick}-${live}`}
        className="grid gap-2"
        aria-label={`Net revenue by category, ${state.label}`}
      >
        {cats.map((c, i) => (
          <li
            key={c.label}
            className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-2 text-[11px]"
          >
            <span className="truncate text-fg-muted">{c.label}</span>
            <span className="h-2.5 overflow-hidden rounded-r-[4px]">
              <motion.span
                className="block h-full origin-left rounded-r-[4px] bg-[var(--chart-1)]"
                style={{ width: `${(c.share / top) * 100}%` }}
                initial={{ scaleX: live ? 0 : 1 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.7, delay: live ? typed + 0.2 + i * 0.08 : 0, ease: EASE }}
              />
            </span>
            <span className="font-figures text-fg">{c.display}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The grid                                                            */
/* ------------------------------------------------------------------ */

export function Bento({ data }: { data: BentoData }) {
  const insight = data.showcase.insight?.title ?? data.state.insights[0]?.title ?? "";
  return (
    <div className="grid gap-4 lg:grid-cols-6">
      <Tile
        icon={Braces}
        title="Every KPI shows its working"
        line="The formula, SQL and DAX behind every KPI."
        className="lg:col-span-4"
      >
        <CodeTile kpi={data.showcase.kpi} />
      </Tile>
      <Tile
        icon={BadgeCheck}
        title="Proven, not promised"
        line="Tested against DuckDB for every KPI."
        className="lg:col-span-2"
        delay={0.08}
      >
        <ProofTile />
      </Tile>
      <Tile
        icon={LineChart}
        title="Charts chosen for a reason"
        line="The right form for the data, with the reason why."
        className="lg:col-span-2"
      >
        <MorphTile state={data.state} />
      </Tile>
      <Tile
        icon={Table2}
        title="Every column profiled"
        line="Type, role and data health, checked first."
        className="lg:col-span-2"
        delay={0.08}
      >
        <ProfileTile columns={data.columns} health={data.health} />
      </Tile>
      <Tile
        icon={Database}
        title="Insights that cite their numbers"
        line="Ranked by impact and linked to their chart."
        className="lg:col-span-2"
        delay={0.16}
      >
        {insight ? <InsightTile state={data.state} title={insight} /> : null}
      </Tile>
      <Tile
        icon={FileDown}
        title="Exports that fit your stack"
        line="Power BI, SQL, a PDF report and presentation slides."
        className="lg:col-span-3"
      >
        <ExportTile />
      </Tile>
      <Tile
        icon={MessageSquareText}
        title="Ask for a chart"
        line="Describe it in words, and Loupe draws it."
        className="lg:col-span-3"
        delay={0.08}
      >
        <AskTile state={data.state} />
      </Tile>
    </div>
  );
}
