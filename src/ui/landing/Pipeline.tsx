"use client";

/**
 * "How it works", played like a short film in the workspace's own four
 * phases: Prepare (Upload, Detect, Check & map), Build (Customise,
 * Dashboard), Analyse (Questions & SQL, Insights) and Share (Export). The tab
 * on the left fills like a progress bar while the stage on the right plays
 * that phase's motion graphic, drawn as the workspace draws it today. Every
 * graphic is drawn from the build-time engine snapshot (preview-data.ts): the
 * real demo file and the reading of it (what one row is, what moves the
 * outcome, with its statistics), the dashboard's real KPI cards and trend
 * with its takeaway, a question answered by the engine with its real SQL,
 * the top insight with its score, and the export formats.
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
  Check,
  Code2,
  FileSpreadsheet,
  FileText,
  Lightbulb,
  Minus,
  Pause,
  Play,
  Presentation,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LoupeMark } from "@/ui/brand/logo";
import { APP_PHASES, chipStyle, KPI_ICON, KPI_ICON_FALLBACK, type AppPhase } from "./appShell";
import { DrawOn, EASE, useCalm } from "./motion";
import type { LandingData, PreviewInsight, PreviewKpi, PreviewState } from "./preview-data";

/** How long each phase plays before the next, in ms. */
const STEP_MS = 6400;

export interface PipelineData {
  file: LandingData["file"];
  understanding: LandingData["understanding"];
  health: LandingData["health"];
  chartTypes: number;
  question: LandingData["showcase"]["question"];
  state: PreviewState;
}

/** Each phase's one line, under its name and its steps. */
const CAPTION: Record<AppPhase["id"], (d: PipelineData) => string> = {
  prepare: () => "Drop a file. Loupe reads what each row is and what moves your numbers.",
  build: (d) => `Your KPIs and charts, from ${d.chartTypes} chart types, laid out on one page.`,
  analyse: () => "Ask in plain words, with the SQL behind every answer. Insights ranked by impact.",
  share: () => "A PDF report, slides, a Power BI package, SQL and the data.",
};

/* ------------------------------------------------------------------ */
/* Shared motion                                                       */
/* ------------------------------------------------------------------ */

/** A visual's root: its children play in sequence once it is on screen. */
const ROOT: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } } };
const RISE: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
};
const POP: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 8 },
  show: { opacity: 1, scale: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 24 } },
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

/** A bar that grows from the left once its visual plays. */
function GrowBar({ share, delay, className }: { share: number; delay: number; className: string }) {
  return (
    <motion.span
      className={cn("block h-full origin-left rounded-r-xs", className)}
      style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }}
      variants={{
        hidden: { scaleX: 0 },
        show: { scaleX: 1, transition: { duration: 0.8, delay, ease: EASE } },
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* 1. Prepare: the file, what it is about, what moves it               */
/* ------------------------------------------------------------------ */

function PrepareVisual({ data }: { data: PipelineData }) {
  const { file, understanding: u, health } = data;
  return (
    <Root className="grid max-w-[460px] gap-3">
      <motion.div
        variants={{
          hidden: { opacity: 0, y: -60, rotate: -6, scale: 0.92 },
          show: {
            opacity: 1,
            y: 0,
            rotate: 0,
            scale: 1,
            transition: { type: "spring", stiffness: 200, damping: 19 },
          },
        }}
        className="flex w-fit max-w-full items-center gap-3 rounded-card border border-border bg-surface-overlay px-4 py-2.5 shadow-pop"
      >
        <FileSpreadsheet className="size-5 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0">
          <span className="block truncate text-ui font-medium text-fg">{file.name}</span>
          <span className="tabular block text-xs text-fg-subtle">
            {file.rows} rows · {file.columns} columns
          </span>
        </span>
        <motion.span
          variants={{
            hidden: { scale: 0 },
            show: { scale: 1, transition: { delay: 0.55, type: "spring", stiffness: 420, damping: 20 } },
          }}
          className="grid size-5 shrink-0 place-items-center rounded-full bg-success-soft text-success"
        >
          <Check className="size-3" strokeWidth={3} aria-hidden />
        </motion.span>
      </motion.div>
      <motion.div
        variants={RISE}
        className="rounded-card border border-border bg-surface-1 px-4 py-3 shadow-card"
      >
        <p className="eyebrow text-fg-subtle">What this data is about</p>
        <p className="mt-1 text-lg leading-snug font-semibold text-fg">{u.title}</p>
        <p className="tabular text-ui text-fg-muted">
          {u.rowMeaning} · {u.dates}
        </p>
      </motion.div>
      {u.outcome && u.drivers.length ? (
        <motion.div
          variants={RISE}
          className="rounded-card border border-border bg-surface-1 px-4 py-3 shadow-card"
        >
          <p className="text-ui font-medium text-fg">What moves {u.outcome}</p>
          <ul className="mt-2.5 grid gap-2" aria-label={`What moves ${u.outcome}`}>
            {u.drivers.map((d, i) => (
              <li
                key={d.column}
                className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 text-xs"
              >
                <span className="truncate text-fg-muted">{d.column}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <GrowBar
                    share={d.strength}
                    delay={0.5 + i * 0.12}
                    className="rounded-full bg-[image:var(--accent-gradient)]"
                  />
                </span>
                <span className="tabular text-fg">
                  {d.symbol} = {d.value}
                </span>
              </li>
            ))}
          </ul>
        </motion.div>
      ) : null}
      <motion.div variants={RISE} className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success-border bg-success-soft px-2.5 py-1 text-success-text">
          <Check className="size-3" strokeWidth={2.5} aria-hidden />
          Data health <span className="tabular">{health.score}/100</span>
        </span>
        <span className="rounded-full border border-border bg-surface-1 px-2.5 py-1 text-fg-muted">
          Every column checked in Check & map
        </span>
      </motion.div>
    </Root>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Build: the KPI cards and a chart with its takeaway               */
/* ------------------------------------------------------------------ */

function Delta({ kpi }: { kpi: PreviewKpi }) {
  const Icon = kpi.change === "up" ? ArrowUpRight : kpi.change === "down" ? ArrowDownRight : Minus;
  const tone =
    kpi.tone === "good"
      ? "bg-success-soft text-success-text"
      : kpi.tone === "bad"
        ? "bg-danger-soft text-danger-text"
        : "bg-surface-3 text-fg-muted";
  return (
    <span
      className={cn(
        "tabular inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-xs font-medium",
        tone,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {kpi.deltaText}
    </span>
  );
}

function BuildVisual({ data }: { data: PipelineData }) {
  const { state } = data;
  const values = state.trend.values;
  const max = Math.max(...values, 1);
  const W = 300;
  const H = 64;
  const line = values
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${((i / Math.max(1, values.length - 1)) * W).toFixed(1)},${(H - (v / max) * H).toFixed(1)}`,
    )
    .join("");
  const gradId = `build-${React.useId().replace(/[^\w-]/g, "")}`;
  return (
    <Root className="grid max-w-[460px] gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        {state.kpis.slice(0, 4).map((k, i) => {
          const Icon = KPI_ICON[k.icon] ?? KPI_ICON_FALLBACK;
          return (
            <motion.div
              key={k.id}
              variants={POP}
              className="min-w-0 rounded-card border border-border bg-surface-1 px-3.5 py-3 shadow-card"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="grid size-5 shrink-0 place-items-center rounded-xs"
                  style={chipStyle(i)}
                >
                  <Icon className="size-3" />
                </span>
                <span className="truncate text-xs font-medium text-fg-muted">{k.name}</span>
              </span>
              <span className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="font-figures text-xl leading-none font-semibold text-fg">{k.display}</span>
                <Delta kpi={k} />
              </span>
            </motion.div>
          );
        })}
      </div>
      <motion.figure
        variants={RISE}
        className="rounded-card border border-border bg-surface-1 px-4 pt-3 pb-3.5 shadow-card"
      >
        <figcaption>
          <span className="block truncate text-ui font-medium text-fg">{state.trend.title}</span>
          {state.trend.takeaway ? (
            <span className="mt-0.5 line-clamp-2 block text-xs text-fg-muted">{state.trend.takeaway}</span>
          ) : null}
        </figcaption>
        <svg
          viewBox={`0 -4 ${W} ${H + 8}`}
          className="mt-2.5 block h-auto w-full overflow-visible"
          aria-hidden
        >
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.2} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <line x1={0} x2={W} y1={H} y2={H} stroke="var(--chart-grid)" strokeWidth={1} />
          <DrawOn box={[-4, -10, W + 8, H + 20]} transition={{ duration: 1.3, delay: 0.7, ease: EASE }}>
            <path d={`${line}L${W},${H}L0,${H}Z`} fill={`url(#${gradId})`} />
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
      </motion.figure>
    </Root>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Analyse: a question answered with its SQL, and the top insight   */
/* ------------------------------------------------------------------ */

const TONE: Record<PreviewInsight["tone"], { icon: LucideIcon; chip: string }> = {
  positive: { icon: TrendingUp, chip: "bg-success-soft text-success" },
  negative: { icon: TrendingDown, chip: "bg-danger-soft text-danger" },
  warning: { icon: TriangleAlert, chip: "bg-warning-soft text-warning" },
  neutral: { icon: Lightbulb, chip: "bg-accent-soft text-accent" },
};

function AnalyseVisual({ data }: { data: PipelineData }) {
  const q = data.question;
  const top = data.state.insights[0];
  const [sql, setSql] = React.useState(false);
  const sqlId = React.useId();
  const largest = Math.max(...(q?.rows ?? []).map((r) => r.share), 0.0001);
  const tone = top ? (TONE[top.tone] ?? TONE.neutral) : null;
  return (
    <Root className="grid max-w-[480px] gap-3">
      {q ? (
        <>
          <motion.p
            variants={RISE}
            className="ml-auto max-w-[88%] rounded-panel rounded-tr-sm bg-surface-3 px-4 py-2 text-ui text-fg"
          >
            <span className="sr-only">You asked: </span>
            {q.text}
          </motion.p>
          <motion.div variants={RISE} className="flex gap-2.5">
            <span
              aria-hidden
              className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-border bg-surface-1 shadow-card max-sm:hidden"
            >
              <LoupeMark decorative className="size-4" />
            </span>
            <div className="min-w-0 flex-1 rounded-card border border-border bg-surface-1 px-4 py-3 shadow-card">
              <p className="text-ui text-fg">{q.answer}</p>
              {sql ? (
                // Focusable, so keyboard users can scroll the query. Code wears the code face from
                // <pre> and <code> themselves.
                <pre
                  id={sqlId}
                  tabIndex={0}
                  aria-label="The SQL behind this answer"
                  className="mt-2.5 h-[104px] overflow-auto rounded-control border border-border bg-bg p-2.5 text-xs leading-relaxed whitespace-pre text-fg-muted outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
                >
                  <code>{q.sql}</code>
                </pre>
              ) : (
                <ul
                  id={sqlId}
                  className="mt-2.5 grid h-[104px] content-center gap-2"
                  aria-label={q.understood}
                >
                  {q.rows.map((r, i) => (
                    <li
                      key={r.label}
                      className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-2.5 text-xs"
                    >
                      <span className="truncate text-fg-muted">{r.label}</span>
                      <span className="h-2.5">
                        <GrowBar
                          share={r.share / largest}
                          delay={0.6 + i * 0.08}
                          className="h-full bg-[var(--chart-1)]"
                        />
                      </span>
                      <span className="font-figures text-fg">{r.display}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                aria-expanded={sql}
                aria-controls={sqlId}
                onClick={() => setSql((s) => !s)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-accent-text hover:underline focus-visible:focus-ring"
              >
                <Code2 className="size-3.5" aria-hidden />
                {sql ? "Show the answer" : "Show SQL"}
              </button>
            </div>
          </motion.div>
        </>
      ) : null}
      {top && tone ? (
        <motion.div
          variants={RISE}
          className="flex min-w-0 items-center gap-3 rounded-card border border-border bg-surface-1 px-3.5 py-2.5 shadow-card"
        >
          <span className="tabular shrink-0 text-xs font-medium text-fg-subtle">#1</span>
          <span className={cn("grid size-6 shrink-0 place-items-center rounded-full", tone.chip)}>
            <tone.icon className="size-3.5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate text-ui font-medium text-fg">{top.title}</span>
          {/* The insight's own ranking score (0–100), as the Insights feed draws it. */}
          <span
            className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-surface-3"
            title={`Impact ${Math.round(top.impact)} of 100`}
          >
            <GrowBar share={top.impact / 100} delay={1.1} className="rounded-full bg-accent" />
          </span>
        </motion.div>
      ) : null}
    </Root>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Share: the export gallery                                        */
/* ------------------------------------------------------------------ */

/** A miniature of the one-page dashboard, from the real KPI values and category shares. */
function MiniPage({ state }: { state: PreviewState }) {
  const cats = state.categories.slice(0, 4);
  const top = Math.max(...cats.map((c) => c.share), 0.0001);
  return (
    <div aria-hidden className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-1.5 rounded-sm bg-bg p-2">
      {/* Two figures on a phone's narrower card, three from sm, each whole rather than cut. */}
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
        {state.kpis.slice(0, 3).map((k, i) => (
          <span
            key={k.id}
            className={cn(
              "rounded-xs border border-border bg-surface-1 px-1.5 py-0.5",
              i === 2 && "max-sm:hidden",
            )}
          >
            <span className="font-figures block truncate text-2xs leading-4 font-semibold text-fg">
              {k.display}
            </span>
          </span>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-1.5">
        <span className="grid content-center gap-1 rounded-xs border border-border bg-surface-1 px-1.5">
          {cats.map((c, i) => (
            <span key={c.label} className="block h-1.5">
              <GrowBar share={c.share / top} delay={0.5 + i * 0.06} className="h-full bg-[var(--chart-1)]" />
            </span>
          ))}
        </span>
        <span className="grid content-center gap-1 rounded-xs border border-border bg-surface-1 px-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="block h-1 rounded-full bg-surface-3"
              style={{ width: `${90 - i * 18}%` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

const SHARE: Array<{ icon: LucideIcon; title: string; types: string }> = [
  { icon: FileText, title: "Report", types: "PDF" },
  { icon: Presentation, title: "Slides", types: "PDF · PNG" },
  { icon: Lightbulb, title: "Insights", types: "PDF" },
];
const FURTHER = ["Power BI package", "SQL", "Data dictionary", "CSV"];

function ShareVisual({ data }: { data: PipelineData }) {
  return (
    <Root className="grid max-w-[460px] gap-2.5">
      <motion.div
        variants={POP}
        className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-center gap-3.5 rounded-card border border-border-accent bg-surface-1 p-3 shadow-card"
      >
        <div className="aspect-video overflow-hidden rounded-control border border-border">
          <MiniPage state={data.state} />
        </div>
        <div className="min-w-0">
          <p className="text-ui font-medium text-fg">One-page dashboard</p>
          <p className="mt-0.5 text-xs text-fg-muted">The page as you see it, ready to send.</p>
          <span className="mt-2 inline-flex rounded-full border border-border-strong px-2 py-0.5 text-2xs font-medium text-fg-subtle">
            PNG · PDF
          </span>
        </div>
      </motion.div>
      <div className="grid grid-cols-3 gap-2.5">
        {SHARE.map((s) => (
          <motion.div
            key={s.title}
            variants={POP}
            className="min-w-0 rounded-card border border-border bg-surface-1 px-3 py-2.5 shadow-card"
          >
            <s.icon className="size-4 text-accent" aria-hidden />
            <p className="mt-1.5 truncate text-ui font-medium text-fg">{s.title}</p>
            <p className="text-2xs font-medium text-fg-subtle">{s.types}</p>
          </motion.div>
        ))}
      </div>
      <motion.div variants={RISE} className="grid gap-1.5">
        <p className="eyebrow text-fg-subtle">Take it further</p>
        <ul className="flex flex-wrap gap-1.5">
          {FURTHER.map((f) => (
            <li
              key={f}
              className="rounded-full border border-border bg-surface-1 px-2.5 py-1 text-xs text-fg"
            >
              {f}
            </li>
          ))}
        </ul>
      </motion.div>
    </Root>
  );
}

function PhaseVisual({ id, data }: { id: AppPhase["id"]; data: PipelineData }) {
  switch (id) {
    case "prepare":
      return <PrepareVisual data={data} />;
    case "build":
      return <BuildVisual data={data} />;
    case "analyse":
      return <AnalyseVisual data={data} />;
    case "share":
      return <ShareVisual data={data} />;
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
  const phase = APP_PHASES[active] ?? (APP_PHASES[0] as AppPhase);

  // The step's panel redraws as a transition, so a tap answers at once on a slow phone (INP, version 52.4).
  const [, startTransition] = React.useTransition();
  const select = (i: number, focus = false) => {
    startTransition(() => setActive(i));
    if (focus) tabs.current[i]?.focus();
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const last = APP_PHASES.length - 1;
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
        className="grid content-start gap-1.5 lg:self-center"
      >
        {APP_PHASES.map((p, i) => {
          const selected = i === active;
          return (
            <button
              key={p.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`how-tab-${p.id}`}
              aria-selected={selected}
              aria-controls="how-stage"
              tabIndex={selected ? 0 : -1}
              onClick={() => select(i)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3.5 overflow-hidden rounded-card border px-4 py-3.5 text-left transition-[background-color,border-color,box-shadow] duration-slow focus-visible:focus-ring",
                selected
                  ? "border-border-strong bg-surface-1 shadow-card"
                  : "border-transparent hover:bg-surface-hover",
              )}
            >
              <span
                className={cn(
                  "grid size-9 place-items-center rounded-control border transition-colors duration-slow",
                  selected
                    ? "border-border-accent bg-accent-soft text-accent"
                    : "border-border text-fg-subtle",
                )}
              >
                <p.icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 self-center">
                <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                  <span
                    className={cn(
                      "text-md font-medium transition-colors",
                      selected ? "text-fg" : "text-fg-muted",
                    )}
                  >
                    {p.label}
                  </span>
                  <span className="text-xs text-fg-subtle">{p.steps.map((s) => s.label).join(" · ")}</span>
                </span>
                {/* From lg the caption opens with a CSS grid-row transition, not Framer's `height: auto`,
                    which resets the scroll position to measure and so would stop a smooth scroll mid-way.
                    Below lg every caption stays open, so the stage under the tabs never moves. No caption
                    is hidden from assistive technology, so a tab's name always holds the text it shows. */}
                <span
                  className={cn(
                    "grid grid-rows-[1fr] transition-[grid-template-rows,opacity] duration-slow ease-out-quint",
                    selected ? "opacity-100" : "opacity-100 lg:grid-rows-[0fr] lg:opacity-0",
                  )}
                >
                  <span className="overflow-hidden">
                    <span className="block pt-1 text-sm text-fg-muted">{CAPTION[p.id](data)}</span>
                  </span>
                </span>
              </span>
              {selected ? (
                <span
                  aria-hidden
                  className="absolute inset-x-4 bottom-0 h-0.5 overflow-hidden rounded-full bg-border"
                >
                  {/* The fill is the timer: when its animation ends, the next phase plays. */}
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
                    onAnimationEnd={auto ? () => setActive((a) => (a + 1) % APP_PHASES.length) : undefined}
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
        aria-labelledby={`how-tab-${phase.id}`}
        className="relative isolate h-[460px] overflow-hidden rounded-panel border border-border-strong bg-bg shadow-lift sm:h-[470px]"
      >
        <div aria-hidden className="grid-lines absolute inset-0 -z-10 opacity-80" />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(70%_55%_at_50%_0%,var(--mesh-1),transparent_70%)]"
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={phase.id}
            // One column as wide as the stage: an auto column would grow to a visual's widest line.
            className="absolute inset-0 grid grid-cols-[minmax(0,1fr)] place-items-center px-4 pt-11 pb-5 sm:px-8 sm:pt-12 sm:pb-8"
            initial={{ opacity: 0, y: 16, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -12, filter: "blur(8px)" }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            <PhaseVisual id={phase.id} data={data} />
          </motion.div>
        </AnimatePresence>
        {auto ? (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2/80 px-2.5 py-1 text-xs text-fg-muted backdrop-blur transition-colors duration-fast hover:border-border-hover hover:text-fg focus-visible:focus-ring"
          >
            {paused ? <Play className="size-3" aria-hidden /> : <Pause className="size-3" aria-hidden />}
            {paused ? "Play" : "Pause"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
