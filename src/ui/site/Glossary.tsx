"use client";

/**
 * The glossary's reader (/glossary): a learning path down the side (basics
 * first, industry KPIs last), a search over every term, chart and KPI, a
 * level filter for the general terms, and the industries' KPIs one industry
 * at a time.
 *
 * Everything shown comes from src/content/glossary.ts, which the server page
 * hands over: the hand-written terms, the chart catalogue's own words and the
 * registry's KPIs, so nothing here is made up. Each term has an anchor
 * ("#term-grain"), and an industry can be linked to ("#industry-hr"). "See
 * also" links clear the search and the level filter before jumping, so the
 * term they point to is always on the page. Press "/" to search.
 */
import * as React from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  Gauge,
  Hash,
  Lightbulb,
  Minus,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import type {
  GlossaryChart,
  GlossaryChartGroup,
  GlossaryIndustry,
  GlossaryKpi,
  GlossaryLevel,
  GlossarySection,
  GlossaryTerm,
} from "@/content/glossary";
import type { ChartKind } from "@/engine/charts/types";
import { cn } from "@/lib/utils";
import { DomainIcon } from "@/ui/common/domain-icon";
import { CHART_ICON } from "@/ui/workspace/customise/chartIcons";

type LevelFilter = "all" | GlossaryLevel;

/** The words stay in text colours (they pass contrast in both themes); a dot carries the level's colour. */
const LEVELS: Record<GlossaryLevel, { label: string; dot: string }> = {
  beginner: { label: "Beginner", dot: "bg-success" },
  intermediate: { label: "Intermediate", dot: "bg-accent" },
  advanced: { label: "Advanced", dot: "bg-info" },
};

/** KPI matches shown at most while searching, so a short word doesn't list hundreds. */
const KPI_RESULTS = 60;

/** The hash, read without setting state in an effect (and empty while rendering on the server). */
function subscribeHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** Every word of the query appears in the text (both lower-cased). */
function matches(words: string[], text: string): boolean {
  return words.every((w) => text.includes(w));
}

function LevelPill({ level }: { level: GlossaryLevel }) {
  const l = LEVELS[level];
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-fg-muted">
      <span aria-hidden className={cn("size-1.5 rounded-full", l.dot)} />
      {l.label}
    </span>
  );
}

/** One general term: what it is, why it matters, an example, where it is in Loupe, and related terms. */
function TermCard({
  term,
  names,
  onJump,
  section,
}: {
  term: GlossaryTerm;
  /** Every term's name by id, for the "See also" links. */
  names: ReadonlyMap<string, string>;
  onJump: (id: string) => void;
  /** The section's title, shown on a search result. */
  section?: string;
}) {
  return (
    <div
      id={`term-${term.id}`}
      tabIndex={-1}
      className="group scroll-mt-36 rounded-card border border-border bg-surface-1 p-4 outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
    >
      <dt className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-base font-semibold text-fg">{term.term}</span>
        <LevelPill level={term.level} />
        {section ? <span className="text-xs text-fg-subtle">· {section}</span> : null}
        <a
          href={`#term-${term.id}`}
          aria-label={`Link to ${term.term}`}
          className="ml-auto rounded-[6px] p-1 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
        >
          <Hash className="size-3.5" aria-hidden />
        </a>
      </dt>
      {term.aka?.length ? (
        <dd className="mt-0.5 text-xs text-fg-subtle">Also called {term.aka.join(", ")}</dd>
      ) : null}
      <dd className="mt-2 text-sm leading-relaxed text-fg">{term.short}</dd>
      <dd className="mt-1.5 text-sm leading-relaxed text-fg-muted">{term.body}</dd>
      {term.example ? (
        <dd className="mt-2.5 rounded-[9px] border border-border bg-surface-2 px-3 py-2 text-sm leading-relaxed text-fg-muted">
          <span className="font-medium text-fg">Example. </span>
          {term.example}
        </dd>
      ) : null}
      {term.inLoupe ? (
        <dd className="mt-2.5 flex items-start gap-1.5 text-xs leading-relaxed text-fg-subtle">
          <BookOpen className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
          <span>
            <span className="font-medium text-fg-muted">In Loupe: </span>
            {term.inLoupe}
          </span>
        </dd>
      ) : null}
      {term.related?.length ? (
        <dd className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-fg-subtle">See also</span>
          {term.related.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onJump(id)}
              className="rounded-full border border-border px-2 py-0.5 text-fg-muted transition-colors hover:border-border-accent hover:text-fg"
            >
              {names.get(id) ?? id}
            </button>
          ))}
        </dd>
      ) : null}
    </div>
  );
}

function ChartCard({ chart, group }: { chart: GlossaryChart; group?: string }) {
  const Icon = CHART_ICON[chart.kind as ChartKind];
  return (
    <div className="flex gap-3 rounded-card border border-border bg-surface-1 p-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-[9px] border border-border-accent bg-accent-soft text-accent">
        {Icon ? <Icon className="size-4" aria-hidden /> : null}
      </span>
      <div className="min-w-0">
        <p className="text-md font-medium text-fg">
          {chart.name}
          {group ? <span className="font-normal text-fg-subtle"> · {group}</span> : null}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-fg-muted">{chart.shows}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-fg-subtle">
          <span className="font-medium text-fg-muted">Best for: </span>
          {chart.bestFor}
        </p>
      </div>
    </div>
  );
}

/** Which way is good: the words in text colour, the arrow in the success colour. */
const DIRECTION = {
  higher: { label: "Higher is better", Icon: ArrowUpRight, icon: "text-success" },
  lower: { label: "Lower is better", Icon: ArrowDownRight, icon: "text-success" },
  neutral: { label: "Read in context", Icon: Minus, icon: "text-fg-subtle" },
} as const;

/** One industry KPI: its definition, formula, unit, direction, where it applies, benchmark and pitfalls. */
function KpiCard({ kpi, industry }: { kpi: GlossaryKpi; industry?: string }) {
  const d = DIRECTION[kpi.direction];
  return (
    <article id={`kpi-${kpi.id}`} className="rounded-card border border-border bg-surface-1 p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="text-base font-semibold text-fg">
          {kpi.name}
          {kpi.short && !kpi.name.includes(kpi.short) ? (
            <span className="ml-1.5 text-sm font-normal text-fg-subtle">({kpi.short})</span>
          ) : null}
        </h4>
        <div className="flex flex-wrap gap-1.5">
          {industry ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-fg-muted">
              {industry}
            </span>
          ) : null}
          {kpi.headline ? (
            <span className="rounded-full border border-border-accent bg-accent-soft px-2 py-0.5 text-xs font-medium text-fg">
              Headline KPI
            </span>
          ) : null}
          <span className="inline-flex items-center gap-0.5 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-fg-muted">
            <d.Icon className={cn("size-3", d.icon)} aria-hidden />
            {d.label}
          </span>
        </div>
      </header>
      <p className="mt-2 text-sm leading-relaxed text-fg">{kpi.definition}</p>
      {/* Each term and its description sit directly in the list, as screen readers expect of a <dl>. */}
      <dl className="mt-3 grid gap-2 text-xs leading-relaxed text-fg-subtle">
        <div className="rounded-[9px] border border-border bg-surface-2 px-3 py-2">
          <dt className="font-medium text-fg-muted">Formula</dt>
          <dd className="mt-0.5 text-sm text-fg">{kpi.formula}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="font-medium text-fg-muted">Unit:</dt>
          <dd>{kpi.unit}</dd>
        </div>
        {kpi.shapes.length ? (
          <div className="flex gap-1">
            <dt className="font-medium text-fg-muted">Applies to:</dt>
            <dd>{kpi.shapes.join(", ")}</dd>
          </div>
        ) : null}
        {kpi.benchmark ? (
          <div>
            <dt className="flex items-center gap-1.5 font-medium text-fg-muted">
              <Gauge className="size-3.5 shrink-0 text-info" aria-hidden /> Benchmark
            </dt>
            <dd className="mt-0.5 pl-5">{kpi.benchmark}</dd>
          </div>
        ) : null}
        {kpi.pitfalls.length ? (
          <div>
            <dt className="flex items-center gap-1.5 font-medium text-fg-muted">
              <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden /> Watch out
            </dt>
            {kpi.pitfalls.map((p) => (
              <dd key={p} className="mt-0.5 pl-5">
                {p}
              </dd>
            ))}
          </div>
        ) : null}
      </dl>
    </article>
  );
}

/** The chosen industry: what its data looks like, what to watch out for, and every KPI by group. */
function IndustryPanel({ industry }: { industry: GlossaryIndustry }) {
  return (
    <div id={`industry-${industry.id}`} className="scroll-mt-36">
      <div className="rounded-panel border border-border bg-surface-1 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-[12px] border border-border-accent bg-accent-soft">
            <DomainIcon name={industry.icon} className="size-5 text-accent" />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-display-xs text-fg">{industry.name}</h3>
            <p className="mt-0.5 text-sm text-fg-muted">{industry.tagline}</p>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-fg-muted">{industry.description}</p>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <p className="eyebrow text-fg-subtle">Tables Loupe recognises</p>
            <ul className="mt-2 grid gap-2">
              {industry.shapes.map((s) => (
                <li key={s.name} className="text-sm leading-relaxed">
                  <span className="font-medium text-fg">{s.name}</span>
                  <span className="text-fg-subtle"> · one row per {s.grain}</span>
                  <span className="block text-xs text-fg-subtle">{s.description}</span>
                </li>
              ))}
            </ul>
          </div>
          {industry.pitfalls.length ? (
            <div>
              <p className="eyebrow flex items-center gap-1.5 text-fg-subtle">
                <TriangleAlert className="size-3.5 text-warning" aria-hidden /> Watch out in {industry.name}
              </p>
              <ul className="mt-2 grid list-disc gap-1.5 pl-4 text-sm leading-relaxed text-fg-muted marker:text-fg-subtle">
                {industry.pitfalls.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        {/* The groups at a glance, each a jump to its KPIs. */}
        <nav aria-label={`${industry.name} KPI groups`} className="mt-5 flex flex-wrap gap-1.5">
          {industry.groups.map((g) => (
            <a
              key={g.name}
              href={`#group-${industry.id}-${slug(g.name)}`}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-border-accent hover:text-fg"
            >
              {g.name} <span className="font-figures text-fg-subtle">{g.kpis.length}</span>
            </a>
          ))}
        </nav>
      </div>
      {industry.groups.map((g) => (
        <section
          key={g.name}
          id={`group-${industry.id}-${slug(g.name)}`}
          aria-label={`${industry.name}: ${g.name}`}
          className="mt-8 scroll-mt-36"
        >
          <h4 className="mb-3 flex items-baseline gap-2 text-lg font-semibold text-fg">
            {g.name}
            <span className="font-figures text-xs font-normal text-fg-subtle">{g.kpis.length} KPIs</span>
          </h4>
          <div className="grid gap-3 md:grid-cols-2">
            {g.kpis.map((k) => (
              <KpiCard key={k.id} kpi={k} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** A step of the learning path, in the side navigation. */
interface Step {
  id: string;
  title: string;
  blurb: string;
  count: number;
}

export function Glossary({
  sections,
  chartGroups,
  industries,
}: {
  sections: GlossarySection[];
  chartGroups: GlossaryChartGroup[];
  industries: GlossaryIndustry[];
}) {
  const names = React.useMemo(
    () => new Map(sections.flatMap((s) => s.terms.map((t) => [t.id, t.term] as const))),
    [sections],
  );
  const [query, setQuery] = React.useState("");
  const [level, setLevel] = React.useState<LevelFilter>("all");
  const [picked, setPicked] = React.useState<string | null>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const hash = React.useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => "",
  );
  const fromHash = /^#industry-(.+)$/.exec(hash)?.[1];
  const industryId =
    picked ?? (industries.some((i) => i.id === fromHash) ? (fromHash as string) : industries[0]?.id);
  const industry = industries.find((i) => i.id === industryId) ?? industries[0];
  const kpiTotal = industries.reduce((a, i) => a + i.kpiCount, 0);
  const chartTotal = chartGroups.reduce((a, g) => a + g.charts.length, 0);

  // "/" starts a search from anywhere on the page, as on most documentation sites.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // What the search looks in, lower-cased once.
  const index = React.useMemo(
    () => ({
      terms: sections.flatMap((s) =>
        s.terms.map((t) => ({
          section: s.title,
          term: t,
          text: [t.term, ...(t.aka ?? []), t.short, t.body, t.example ?? ""].join(" ").toLowerCase(),
        })),
      ),
      charts: chartGroups.flatMap((g) =>
        g.charts.map((c) => ({
          group: g.title,
          chart: c,
          text: [c.name, c.shows, c.bestFor].join(" ").toLowerCase(),
        })),
      ),
      kpis: industries.flatMap((i) =>
        i.groups.flatMap((g) =>
          g.kpis.map((k) => ({
            industry: i.name,
            kpi: k,
            text: [k.name, k.short ?? "", k.definition, k.formula, g.name, i.name].join(" ").toLowerCase(),
          })),
        ),
      ),
    }),
    [sections, chartGroups, industries],
  );

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = words.length > 0;
  const results = searching
    ? {
        terms: index.terms.filter(
          (x) => matches(words, x.text) && (level === "all" || x.term.level === level),
        ),
        charts: index.charts.filter((x) => matches(words, x.text)),
        kpis: index.kpis.filter((x) => matches(words, x.text)),
      }
    : null;
  const resultCount = results ? results.terms.length + results.charts.length + results.kpis.length : 0;

  const steps: Step[] = [
    ...sections.map((s) => ({
      id: s.id,
      title: s.title,
      blurb: s.blurb,
      count: s.terms.length + (s.id === "charts" ? chartTotal : 0),
    })),
    {
      id: "industries",
      title: "Industry KPIs",
      blurb: `Every KPI of ${industries.length} industries, with its formula.`,
      count: kpiTotal,
    },
  ];

  /** Clears the search and the level, then brings a term into view (its card exists again by then). */
  const jumpTo = (id: string) => {
    setQuery("");
    setLevel("all");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.getElementById(`term-${id}`);
        if (!el) return;
        const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
        el.focus({ preventScroll: true });
        // Keep Next's history state: replacing it with null breaks Back.
        history.replaceState(history.state, "", `#term-${id}`);
      }),
    );
  };

  const pickIndustry = (id: string) => {
    setPicked(id);
    history.replaceState(history.state, "", `#industry-${id}`);
  };

  // The industry tabs move with the arrow keys, Home and End.
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (i + 1) % industries.length
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (i - 1 + industries.length) % industries.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? industries.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    const target = industries[next];
    if (!target) return;
    pickIndustry(target.id);
    document.getElementById(`tab-${target.id}`)?.focus();
  };

  return (
    <div className="mt-12 grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-12">
      {/* The learning path: the order to read the glossary in, with how much each step holds. */}
      <nav aria-label="Learning path" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <p className="eyebrow text-fg-subtle">Learning path</p>
        <ol className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:grid lg:gap-1 lg:overflow-visible">
          {steps.map((s, i) => (
            <li key={s.id} className="shrink-0">
              <a
                href={`#${s.id}`}
                onClick={() => setQuery("")}
                className="group flex items-start gap-2.5 rounded-[10px] border border-border px-3 py-2 transition-colors hover:border-border-accent hover:bg-surface-1 lg:border-transparent"
              >
                <span className="font-figures mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-border-strong text-2xs text-fg-muted group-hover:border-accent group-hover:text-accent">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="flex items-baseline gap-1.5 text-ui font-medium whitespace-nowrap text-fg">
                    {s.title}
                    <span className="font-figures text-xs font-normal text-fg-subtle">{s.count}</span>
                  </span>
                  <span className="mt-0.5 hidden text-xs text-fg-subtle lg:block">{s.blurb}</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="min-w-0">
        {/* Search and level, kept in reach while scrolling on wider screens (on a phone it would cover the page). */}
        <div className="z-10 -mx-1 mb-8 flex flex-wrap items-center gap-3 rounded-panel border border-border bg-bg/90 p-2 px-1 backdrop-blur-[10px] sm:px-2 md:sticky md:top-16">
          <label className="relative min-w-0 flex-[1_1_260px]">
            <span className="sr-only">Search the glossary</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
              aria-hidden
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${steps.reduce((a, s) => a + s.count, 0)} terms, charts and KPIs`}
              className="h-10 w-full rounded-control border border-border bg-surface-1 pr-16 pl-9 text-ui text-fg outline-none placeholder:text-fg-subtle focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-ring [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                aria-label="Clear the search"
                className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-[7px] text-fg-subtle hover:bg-surface-3 hover:text-fg"
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded-[5px] border border-border px-1.5 font-sans text-2xs text-fg-subtle">
                /
              </kbd>
            )}
          </label>
          <div role="group" aria-label="Level" className="flex flex-wrap gap-1">
            {(["all", "beginner", "intermediate", "advanced"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={level === l}
                onClick={() => setLevel(l)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition-colors",
                  level === l
                    ? "border-border-accent bg-accent-soft text-fg"
                    : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                )}
              >
                {l === "all" ? "All levels" : LEVELS[l].label}
              </button>
            ))}
          </div>
        </div>

        {results ? (
          <div aria-live="polite">
            <p className="text-ui text-fg">
              <span className="font-figures font-medium">{resultCount}</span>{" "}
              {resultCount === 1 ? "result" : "results"} for “{query.trim()}”
            </p>
            {resultCount === 0 ? (
              <p className="mt-4 rounded-panel border border-dashed border-border-strong p-6 text-sm text-fg-muted">
                Nothing matches. Try a shorter word, or browse the learning path on the left.
              </p>
            ) : null}
            {results.terms.length ? (
              <section aria-label="Terms" className="mt-6">
                <h2 className="eyebrow mb-3 text-fg-subtle">Terms</h2>
                <dl className="grid gap-3 md:grid-cols-2">
                  {results.terms.map((x) => (
                    <TermCard
                      key={x.term.id}
                      term={x.term}
                      names={names}
                      section={x.section}
                      onJump={jumpTo}
                    />
                  ))}
                </dl>
              </section>
            ) : null}
            {results.charts.length ? (
              <section aria-label="Charts" className="mt-8">
                <h2 className="eyebrow mb-3 text-fg-subtle">Charts</h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {results.charts.map((x) => (
                    <ChartCard key={x.chart.kind} chart={x.chart} group={x.group} />
                  ))}
                </div>
              </section>
            ) : null}
            {results.kpis.length ? (
              <section aria-label="Industry KPIs" className="mt-8">
                <h2 className="eyebrow mb-3 text-fg-subtle">
                  Industry KPIs
                  {results.kpis.length > KPI_RESULTS ? (
                    <span className="ml-2 text-xs font-normal tracking-normal normal-case">
                      the first {KPI_RESULTS} of {results.kpis.length}: add a word to narrow it
                    </span>
                  ) : null}
                </h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {results.kpis.slice(0, KPI_RESULTS).map((x) => (
                    <KpiCard key={`${x.industry}-${x.kpi.id}`} kpi={x.kpi} industry={x.industry} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <>
            {sections.map((s, n) => {
              const terms = s.terms.filter((t) => level === "all" || t.level === level);
              const charts = s.id === "charts" && level === "all" ? chartGroups : [];
              if (!terms.length && !charts.length) return null;
              return (
                <section key={s.id} id={s.id} aria-labelledby={`h-${s.id}`} className="mb-16 scroll-mt-36">
                  <div className="flex items-baseline gap-3">
                    <span className="font-figures text-sm font-medium text-accent">
                      {String(n + 1).padStart(2, "0")}
                    </span>
                    <h2 id={`h-${s.id}`} className="font-display text-display-xs text-fg sm:text-display-sm">
                      {s.title}
                    </h2>
                  </div>
                  <p className="mt-2 text-base text-fg-muted">{s.blurb}</p>
                  {terms.length ? (
                    <dl className="mt-6 grid gap-3 md:grid-cols-2">
                      {terms.map((t) => (
                        <TermCard key={t.id} term={t} names={names} onJump={jumpTo} />
                      ))}
                    </dl>
                  ) : null}
                  {charts.length ? (
                    <div className="mt-10">
                      <h3 className="flex items-center gap-2 text-lg font-semibold text-fg">
                        <Lightbulb className="size-4 text-accent" aria-hidden /> Which chart for which
                        question
                      </h3>
                      <p className="mt-1 text-sm text-fg-muted">
                        Every chart Loupe draws, grouped by the question it answers.
                      </p>
                      {charts.map((g) => (
                        <div key={g.id} className="mt-6">
                          <p className="text-base font-semibold text-fg">
                            {g.title} <span className="font-normal text-fg-subtle">· {g.question}</span>
                          </p>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            {g.charts.map((c) => (
                              <ChartCard key={c.kind} chart={c} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}

            <section id="industries" aria-labelledby="h-industries" className="scroll-mt-36">
              <div className="flex items-baseline gap-3">
                <span className="font-figures text-sm font-medium text-accent">
                  {String(sections.length + 1).padStart(2, "0")}
                </span>
                <h2 id="h-industries" className="font-display text-display-xs text-fg sm:text-display-sm">
                  Industry KPIs
                </h2>
              </div>
              <p className="mt-2 max-w-2xl text-base leading-relaxed text-fg-muted">
                Every KPI Loupe computes, industry by industry: what it means, its formula, which way is good,
                and what to watch out for. These are the same definitions the app uses on your data.
              </p>
              <div role="tablist" aria-label="Industry" className="mt-6 flex flex-wrap gap-2">
                {industries.map((i, n) => {
                  const on = i.id === industry?.id;
                  return (
                    <button
                      key={i.id}
                      id={`tab-${i.id}`}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      aria-controls="industry-panel"
                      tabIndex={on ? 0 : -1}
                      onClick={() => pickIndustry(i.id)}
                      onKeyDown={(e) => onTabKey(e, n)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                        on
                          ? "border-border-accent bg-accent-soft text-fg"
                          : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                      )}
                    >
                      <DomainIcon
                        name={i.icon}
                        className={cn("size-3.5", on ? "text-accent" : "text-fg-subtle")}
                      />
                      {i.name}
                      <span className="font-figures text-fg-muted">{i.kpiCount}</span>
                    </button>
                  );
                })}
              </div>
              <div
                id="industry-panel"
                role="tabpanel"
                aria-labelledby={industry ? `tab-${industry.id}` : undefined}
                className="mt-6"
              >
                {industry ? <IndustryPanel industry={industry} /> : null}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
