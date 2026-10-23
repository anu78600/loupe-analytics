"use client";

/**
 * The features grid: seven tiles, each a title, one short line and a small
 * motion graphic in place of a paragraph.
 *
 * - The KPI's real SQL and DAX type themselves out, alternating, coloured as
 *   the workspace colours code.
 * - The proof checklist ticks itself off.
 * - The real category breakdown changes form: sorted bars, a donut, a treemap.
 * - A scanning light reads the real columns and tags how each is read, as
 *   Check & map does.
 * - The top insights, ranked as the Insights feed ranks them, each with a bar
 *   of its real impact score.
 * - The export formats burst out of the package.
 * - A request typed in words becomes the real breakdown.
 *
 * Every figure is from the build-time snapshot (preview-data.ts). Loops play
 * only while a tile is on screen and stop under reduced motion: the JavaScript
 * ones through useLive, the CSS ones (a caret, the scan, the pulse) through
 * their [data-loop] host (PauseOffscreen).
 */
import * as React from "react";
import { animate, AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  Braces,
  FileDown,
  Lightbulb,
  LineChart,
  MessageSquareText,
  Package,
  Sparkles,
  Table2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { CodeLanguage } from "@/engine/compile/codeTokens";
import { cn } from "@/lib/utils";
import { HighlightedCode } from "@/ui/common/code";
import { EASE, Reveal, Spotlight, Typewriter, useCalm, useLive, useTicker } from "./motion";
import type { LandingData, PreviewInsight, PreviewState } from "./preview-data";

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
            <span className="grid size-8 place-items-center rounded-control border border-border-accent bg-accent-soft text-accent">
              <Icon className="size-4" aria-hidden />
            </span>
            <h3 className="text-md font-medium text-fg">{title}</h3>
          </div>
          <p className="mt-2 text-sm text-fg-muted">{line}</p>
        </div>
        {children}
      </Spotlight>
    </Reveal>
  );
}

/* ------------------------------------------------------------------ */
/* SQL and DAX                                                         */
/* ------------------------------------------------------------------ */

/**
 * Code typed out once `active`, coloured as it is typed (a keyword takes its colour when it is
 * complete). The server HTML and reduced motion show it whole; assistive technology reads it whole.
 */
function TypedCode({ code, lang, active }: { code: string; lang: CodeLanguage; active: boolean }) {
  const calm = useCalm();
  // Whole in the server HTML; a replay (a new key while playing) starts empty, so it never flashes whole.
  const [count, setCount] = React.useState(() => (active && !calm ? 0 : code.length));
  React.useEffect(() => {
    if (!active || calm) return;
    const controls = animate(0, code.length, {
      duration: code.length / 260,
      ease: "linear",
      onUpdate: (v) => setCount(Math.round(v)),
    });
    return () => controls.stop();
  }, [active, calm, code]);
  const shown = calm ? code.length : count;
  return (
    <>
      <span aria-hidden>
        <HighlightedCode code={code.slice(0, shown)} lang={lang} />
        {shown < code.length ? (
          <span className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[0.15em] animate-[caret-blink_1s_steps(1)_infinite] bg-accent" />
        ) : null}
      </span>
      <span className="sr-only">{code}</span>
    </>
  );
}

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
        <span className="text-fg">= {kpi.formula}</span>
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
                  "eyebrow rounded-sm px-2 py-1 transition-colors duration-fast focus-visible:focus-ring",
                  lang === l
                    ? "bg-surface-selected text-accent-text"
                    : "text-fg-subtle hover:bg-surface-hover hover:text-fg",
                )}
              >
                {l === "sql" ? "SQL" : "DAX"}
              </button>
            ))}
          </div>
          <span className="truncate text-xs text-fg-subtle">
            {lang === "sql" ? "DuckDB · PostgreSQL" : `[${kpi.daxName}]`}
          </span>
        </div>
        {/* Focusable so keyboard users can scroll long code. The code sits in the well its colours
            are checked against (--bg-subtle), coloured as the workspace colours it (ui/common/code). */}
        <pre
          tabIndex={0}
          aria-label={`${kpi.name} in ${lang === "sql" ? "SQL" : "DAX"}`}
          className="h-[208px] overflow-auto bg-bg-subtle p-3 text-xs leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap text-fg-muted outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
        >
          <TypedCode key={chosen ? lang : `${lang}-${tick}`} code={code} lang={lang} active={live} />
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
    <ul className="grid content-center gap-1.5 text-xs">
      {parts.map((p, i) => (
        <li key={p.label} className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full" style={{ background: colourOf(p, i) }} aria-hidden />
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
        <li key={p.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-2 text-xs">
          <span className="truncate text-fg-muted">{p.label}</span>
          <span className="h-2.5 overflow-hidden rounded-r-xs">
            <motion.span
              className="block h-full origin-left rounded-r-xs bg-[var(--chart-1)]"
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
              className="absolute rounded-xs"
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
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-fg-subtle">Net revenue by category · {state.label}</span>
        {/* As wide as the longest name, so the caption beside it wraps the same way for every form. */}
        <span className="min-w-24 shrink-0 rounded-full border border-border-accent bg-accent-soft px-2 py-0.5 text-center text-accent-text">
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
            <li key={c.name} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
              <span className="truncate font-medium text-fg">{c.name}</span>
              <motion.span
                className="shrink-0 rounded-full border border-border px-2 py-0.5 text-fg-muted"
                variants={{
                  hidden: { opacity: 0, x: 8 },
                  show: { opacity: 1, x: 0, transition: { duration: 0.35, ease: EASE } },
                }}
              >
                {c.type} · {c.readAs}
              </motion.span>
            </li>
          ))}
        </motion.ul>
      </div>
      <p className="text-xs text-fg-subtle">
        Demo file health: <span className="font-figures text-fg">{health.score}/100</span> ({health.grade})
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Insight                                                             */
/* ------------------------------------------------------------------ */

const TONE: Record<PreviewInsight["tone"], { icon: LucideIcon; chip: string; label: string }> = {
  positive: { icon: TrendingUp, chip: "bg-success-soft text-success", label: "Positive" },
  negative: { icon: TrendingDown, chip: "bg-danger-soft text-danger", label: "Negative" },
  warning: { icon: TriangleAlert, chip: "bg-warning-soft text-warning", label: "Watch" },
  neutral: { icon: Lightbulb, chip: "bg-accent-soft text-accent", label: "Note" },
};

/**
 * The top findings as the Insights feed ranks them: each with its rank, its tone and a thin bar
 * of its impact, the engine's own score (0–100), never one made up for the picture.
 */
function InsightTile({ state }: { state: PreviewState }) {
  return (
    <motion.ol
      className="mt-auto grid gap-2"
      aria-label={`Top insights, ${state.label}`}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.5 }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.16, delayChildren: 0.1 } } }}
    >
      {state.insights.slice(0, 3).map((ins, i) => {
        const tone = TONE[ins.tone] ?? TONE.neutral;
        return (
          <motion.li
            key={ins.title}
            className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 rounded-card border border-border bg-surface-2/60 px-3 py-2.5"
            variants={{
              hidden: { opacity: 0, y: 10 },
              show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
            }}
          >
            <span className={cn("grid size-6 place-items-center rounded-full", tone.chip)}>
              <tone.icon className="size-3.5" aria-hidden />
              <span className="sr-only">{tone.label}: </span>
            </span>
            <span className="min-w-0">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="tabular shrink-0 text-xs font-medium text-fg-subtle">#{i + 1}</span>
                <span className="line-clamp-2 text-ui font-medium text-fg">{ins.title}</span>
              </span>
              <span
                className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-3"
                title={`Impact ${Math.round(ins.impact)} of 100`}
              >
                <motion.span
                  className="block h-full origin-left rounded-full bg-accent"
                  style={{ width: `${Math.max(0, Math.min(100, ins.impact))}%` }}
                  variants={{
                    hidden: { scaleX: 0 },
                    show: { scaleX: 1, transition: { duration: 0.8, delay: 0.2, ease: EASE } },
                  }}
                />
              </span>
            </span>
          </motion.li>
        );
      })}
    </motion.ol>
  );
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

/** What the Export step makes (ui/workspace/ExportStep.tsx): what to share, then what to build on. */
const FORMATS = [
  "One-page dashboard",
  "PDF report",
  "Presentation slides",
  "Power BI package",
  "SQL",
  "Data dictionary",
];

function ExportTile() {
  const { ref, live } = useLive<HTMLDivElement>(0.45);
  const tick = useTicker(6000, live);
  return (
    <div ref={ref} className="relative mt-auto grid h-[224px] place-items-center">
      <div
        aria-hidden
        className="absolute size-40 rounded-full bg-[radial-gradient(circle,var(--glow-accent),transparent_70%)] blur-xl"
      />
      <span className="relative z-10 grid size-16 place-items-center rounded-panel border border-border-accent bg-surface-2 text-accent shadow-pop">
        <Package className="size-7" aria-hidden />
      </span>
      <ul key={`${tick}-${live}`} className="absolute inset-0" aria-label="Export formats">
        {FORMATS.map((f, i) => {
          const a = (i / FORMATS.length) * Math.PI * 2 - Math.PI / 2;
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          return (
            // Each label rests at its place on the orbit, set in CSS: as wide as the tile allows (so
            // the labels never leave it on a phone), and right without JavaScript, when the page's
            // <noscript> rule lifts the transforms. The burst only moves it there from the middle.
            <motion.li
              key={f}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `calc(50% + ${cos.toFixed(3)} * clamp(5.5rem, 50% - 4rem, 10.5rem))`,
                top: `calc(50% + ${(sin * 92).toFixed(1)}px)`,
              }}
              initial={{ opacity: 0, scale: 0.4, x: -cos * 120, y: -sin * 92 }}
              animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              transition={{ type: "spring", stiffness: 140, damping: 16, delay: 0.15 + i * 0.09 }}
            >
              <span className="block rounded-full border border-border-strong bg-surface-1 px-3 py-1 text-xs whitespace-nowrap text-fg shadow-card">
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
          <li key={c.label} className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-2 text-xs">
            <span className="truncate text-fg-muted">{c.label}</span>
            <span className="h-2.5 overflow-hidden rounded-r-xs">
              <motion.span
                className="block h-full origin-left rounded-r-xs bg-[var(--chart-1)]"
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
        line="How each column is read, and its health, checked first."
        className="lg:col-span-2"
        delay={0.08}
      >
        <ProfileTile columns={data.columns} health={data.health} />
      </Tile>
      <Tile
        icon={Lightbulb}
        title="Insights that cite their numbers"
        line="Ranked by impact, each with its figures and its chart."
        className="lg:col-span-2"
        delay={0.16}
      >
        {data.state.insights.length ? <InsightTile state={data.state} /> : null}
      </Tile>
      <Tile
        icon={FileDown}
        title="Exports that fit your stack"
        line="A page, a report or slides to share; Power BI and SQL to build on."
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
