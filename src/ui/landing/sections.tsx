/**
 * Landing page sections (server components): hero, how it works, features,
 * industries, privacy, demo datasets, FAQ and the closing call to action.
 *
 * Every figure shown here comes from `LandingData` (preview-data.ts), which
 * the engine computes at build time. The copy may describe the product, but
 * it never states a number the engine did not produce. Counts such as
 * industries and KPIs are read from the registry, not hard-coded.
 */
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Braces,
  Cpu,
  Database,
  Eye,
  FileCheck2,
  FileDown,
  FileSpreadsheet,
  Gauge,
  Layers,
  LineChart,
  Lock,
  Play,
  ScanSearch,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Upload,
} from "lucide-react";
import { SAMPLES } from "@/engine/samples/catalog";
import { DomainIcon } from "@/ui/common/domain-icon";
import { Button } from "@/ui/primitives/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/ui/primitives/misc";
import { cn } from "@/lib/utils";
import { HeroPreview } from "./HeroPreview";
import type { LandingData } from "./preview-data";

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function SectionHeading({
  eyebrow,
  title,
  children,
  id,
}: {
  eyebrow: string;
  title: React.ReactNode;
  children?: React.ReactNode;
  id: string;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-2xs font-medium tracking-[0.14em] text-accent uppercase">{eyebrow}</p>
      <h2
        id={id}
        className="mt-3 font-display text-[36px] leading-[1.06] tracking-[-0.02em] text-fg sm:text-[46px]"
      >
        {title}
      </h2>
      {children ? (
        <p className="mx-auto mt-4 max-w-2xl text-[15.5px] leading-relaxed text-fg-muted">{children}</p>
      ) : null}
    </div>
  );
}

function Section({
  id,
  labelledBy,
  children,
  className,
}: {
  id: string;
  labelledBy: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn("scroll-mt-20 border-t border-border py-20 sm:py-28", className)}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">{children}</div>
    </section>
  );
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-card border border-border bg-bg">
      <p className="border-b border-border px-3 py-1.5 text-2xs font-medium tracking-[0.1em] text-fg-subtle uppercase">
        {label}
      </p>
      {/* Focusable so keyboard users can scroll long code. */}
      <pre
        tabIndex={0}
        aria-label={label}
        className="font-figures max-h-56 overflow-auto p-3 text-[11.5px] leading-[1.6] [overflow-wrap:anywhere] whitespace-pre-wrap text-fg-muted focus-visible:outline-offset-[-2px]"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

export function Hero({ data }: { data: LandingData }) {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <div aria-hidden className="mesh grain absolute inset-0 -z-10" />
      <div className="mx-auto max-w-6xl px-4 pt-14 pb-20 sm:px-6 sm:pt-24">
        <div className="mx-auto max-w-4xl text-center">
          <Link
            href="#privacy"
            className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface-1/70 px-3 py-1 text-ui text-fg-muted transition-colors hover:border-border-accent hover:text-fg"
          >
            <ShieldCheck className="size-3.5 text-success" aria-hidden />
            Your data never leaves your browser
          </Link>
          <h1
            id="hero-title"
            className="mt-7 font-display text-[44px] leading-[1.02] tracking-[-0.025em] text-fg sm:text-[64px] lg:text-display-lg"
          >
            Analyst-grade dashboards, <em className="text-accent">with the working shown.</em>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[16.5px] leading-relaxed text-fg-muted sm:text-[17.5px]">
            Drop in a clean CSV, Excel or JSON file. Loupe profiles every column, recognises your industry and
            computes the KPIs that matter. Each one comes with its formula, SQL and DAX, so you can check a
            number before you present it.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Button asChild variant="primary" size="lg">
              <Link href="/app">
                Open the workspace <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/app?sample=ecommerce">
                <Play aria-hidden /> Explore the live demo
              </Link>
            </Button>
          </div>
          <ul className="mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-ui text-fg-subtle">
            <li>No sign-up, no upload</li>
            <li className="tabular">
              {data.registry.domains} industries · {data.registry.kpis} KPI definitions
            </li>
            <li>Power BI, SQL, PDF &amp; PNG export</li>
          </ul>
        </div>
        <div className="mt-14 sm:mt-20">
          {/* Only what the panel renders crosses into the client bundle. */}
          <HeroPreview
            data={{
              file: data.file,
              detection: data.detection,
              columns: data.columns,
              states: data.states,
              tiles: data.tiles,
            }}
          />
          <p className="mt-4 text-center text-2xs text-fg-subtle">
            Every figure above was computed by Loupe&apos;s engine from the bundled demo dataset: synthetic
            order lines from an Indian D2C brand.{" "}
            <Link
              href="/app?sample=ecommerce"
              className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
            >
              Open it live
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

export function HowItWorks({ data }: { data: LandingData }) {
  const steps = [
    {
      icon: Upload,
      title: "Drop a clean table",
      text: "CSV, TSV, Excel (any sheet) or JSON. Delimiter, encoding, header row and date format are detected for you, and DD/MM vs MM/DD is decided from the whole column, not a single cell.",
      visual: (
        <div className="grid grid-cols-1 gap-1.5">
          {[
            { name: data.file.name, meta: `${data.file.rows} rows` },
            { name: "Q3 ledger.xlsx", meta: "4 sheets · pick one" },
            { name: "events.ndjson", meta: "nested fields flattened" },
          ].map((f) => (
            <div
              key={f.name}
              className="flex min-w-0 items-center justify-between gap-3 rounded-[8px] border border-border bg-bg px-2.5 py-1.5 text-[11.5px]"
            >
              <span className="flex min-w-0 items-center gap-2 text-fg">
                <FileSpreadsheet className="size-3.5 shrink-0 text-accent" aria-hidden />
                <span className="truncate">{f.name}</span>
              </span>
              <span className="shrink-0 text-fg-subtle">{f.meta}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      icon: ScanSearch,
      title: "Confirm what it found",
      text: "Loupe names the industry with a confidence score and the evidence behind it. Below 70%, or when two industries are within 10 points, it asks you before building anything.",
      visual: (
        <div className="grid gap-2">
          {data.detection.candidates.map((c, i) => (
            <div
              key={c.name}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[11.5px]"
            >
              <span className={cn("truncate", i === 0 ? "text-fg" : "text-fg-muted")}>{c.name}</span>
              <span className="font-figures text-fg-muted">{c.confidence}%</span>
              <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <span
                  className={cn("block h-full rounded-full", i === 0 ? "bg-accent" : "bg-fg-subtle/50")}
                  style={{ width: `${c.confidence}%` }}
                />
              </span>
            </div>
          ))}
        </div>
      ),
    },
    {
      icon: SlidersHorizontal,
      title: "Adjust anything",
      text: "Remap a column, say which statuses count as RTO, change a role or rename a KPI. The dashboard regenerates instantly, and you can describe your business in your own terms.",
      visual: (
        <div className="grid gap-2 text-[11.5px]">
          <div className="flex items-center justify-between gap-2 rounded-[8px] border border-border bg-bg px-2.5 py-1.5">
            <span className="font-figures text-fg">Order Status</span>
            <ArrowRight className="size-3 text-fg-subtle" aria-hidden />
            <span className="text-fg-muted">Order status</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {["RTO", "Cancelled", "Returned", "Delivered"].map((v, i) => (
              <span
                key={v}
                className={cn(
                  "rounded-full border px-2 py-0.5",
                  i === 0 ? "border-border-accent bg-accent-soft text-accent" : "border-border text-fg-muted",
                )}
              >
                {v}
              </span>
            ))}
          </div>
        </div>
      ),
    },
    {
      icon: FileDown,
      title: "Present and export",
      text: "Headline KPIs, then trend, breakdowns, drivers and detail, the order analysts read. Take it further as a Power BI package, SQL, a PDF report or a PNG.",
      visual: (
        <div className="font-figures grid gap-1.5 text-[11.5px]">
          {["loupe-powerbi.zip", "measures.dax", "kpis.sql", "report.pdf"].map((f) => (
            <div
              key={f}
              className="flex items-center gap-2 rounded-[8px] border border-border bg-bg px-2.5 py-1.5 text-fg-muted"
            >
              <FileCheck2 className="size-3.5 text-success" aria-hidden /> {f}
            </div>
          ))}
        </div>
      ),
    },
  ];
  return (
    <Section id="how" labelledBy="how-title">
      <SectionHeading
        id="how-title"
        eyebrow="How it works"
        title="From file to finished dashboard in four steps"
      >
        No templates to fill in and no formulas to write. Loupe does the first pass of an analyst&apos;s work
        and shows you every decision so you can change it.
      </SectionHeading>
      <ol className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className="flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface-1 p-5 shadow-card"
          >
            <div className="flex items-center justify-between">
              <span className="flex size-9 items-center justify-center rounded-control border border-border-accent bg-accent-soft text-accent">
                <s.icon className="size-4" aria-hidden />
              </span>
              <span className="font-figures text-2xs text-fg-subtle">0{i + 1}</span>
            </div>
            <div>
              <h3 className="text-[15px] font-medium text-fg">{s.title}</h3>
              <p className="mt-1.5 text-ui leading-relaxed text-fg-muted">{s.text}</p>
            </div>
            <div className="mt-auto rounded-card border border-border bg-surface-2/50 p-3">{s.visual}</div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Features (bento)                                                    */
/* ------------------------------------------------------------------ */

function FeatureCard({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface-1 p-6 shadow-card",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <Icon className="size-4 text-accent" aria-hidden />
        <h3 className="text-[15px] font-medium text-fg">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export function Features({ data }: { data: LandingData }) {
  const { kpi, chart, insight } = data.showcase;
  const topCategories = (data.states[0]?.categories ?? []).slice(0, 4);
  const profiled = ["Order Date", "Net Amount", "Payment Method", "Pincode", "Customer ID"]
    .map((name) => data.columns.find((c) => c.name === name))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  return (
    <Section id="features" labelledBy="features-title">
      <SectionHeading
        id="features-title"
        eyebrow="Features"
        title="The judgement of an analyst, made inspectable"
      >
        Every choice Loupe makes, whether a KPI, a chart type or an insight, comes with its reasoning. The
        examples below come straight from the demo dataset.
      </SectionHeading>
      <div className="mt-14 grid gap-4 lg:grid-cols-6">
        <FeatureCard icon={Braces} title="Every KPI shows its working" className="lg:col-span-4">
          <p className="text-ui leading-relaxed text-fg-muted">
            <span className="font-medium text-fg">{kpi.name}</span>: {kpi.definition}{" "}
            <span className="font-figures text-fg">= {kpi.formula}</span>. Ratios are always a ratio of sums,
            never an average of row ratios, and division by zero returns no value instead of a misleading
            number.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <CodeBlock label="SQL · DuckDB / PostgreSQL" code={kpi.sql} />
            <CodeBlock label={`DAX · [${kpi.daxName}]`} code={kpi.dax} />
          </div>
        </FeatureCard>
        <FeatureCard icon={BadgeCheck} title="Proven, not promised" className="lg:col-span-2">
          <p className="text-ui leading-relaxed text-fg-muted">
            Every KPI definition is tested: Loupe&apos;s engine and the generated SQL, run in DuckDB, must
            agree to the decimal, overall and month by month. On your own data,{" "}
            <span className="text-fg">Verify in browser</span> repeats the check.
          </p>
          <ul className="grid gap-2 text-ui text-fg-muted">
            {[
              "Engine value equals the SQL result in DuckDB",
              "Checked for the whole period and for every month",
              "Every fallback formula checked, not just the first",
              "DAX checked for well-formed structure",
            ].map((c) => (
              <li key={c} className="flex items-start gap-2">
                <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                {c}
              </li>
            ))}
          </ul>
          <dl className="mt-auto grid grid-cols-2 gap-3">
            <div className="rounded-card border border-border bg-surface-2/50 p-3">
              <dt className="text-2xs text-fg-subtle">KPI definitions</dt>
              <dd className="font-figures mt-1 text-[22px] text-fg">{data.registry.kpis}</dd>
            </div>
            <div className="rounded-card border border-border bg-surface-2/50 p-3">
              <dt className="text-2xs text-fg-subtle">Chart templates</dt>
              <dd className="font-figures mt-1 text-[22px] text-fg">{data.registry.charts}</dd>
            </div>
          </dl>
        </FeatureCard>
        <FeatureCard icon={Table2} title="Every column, profiled" className="lg:col-span-2">
          <p className="text-ui leading-relaxed text-fg-muted">
            Type, role, distribution, patterns, keys, grain, hierarchies, time gaps and additivity, plus a
            data-health score with fixable issues.
          </p>
          <ul className="mt-auto grid gap-1.5 text-[11.5px]">
            {profiled.map((c) => (
              <li
                key={c.name}
                className="flex items-center justify-between gap-3 rounded-[8px] border border-border bg-bg px-2.5 py-1.5"
              >
                <span className="font-figures truncate text-fg">{c.name}</span>
                <span className="shrink-0 text-fg-subtle">
                  {c.type} · {c.role}
                </span>
              </li>
            ))}
          </ul>
          <p className="font-figures text-2xs text-fg-subtle">
            Demo data health: {data.health.score}/100 ({data.health.grade})
          </p>
        </FeatureCard>
        <FeatureCard icon={LineChart} title="Charts chosen for a reason" className="lg:col-span-2">
          <p className="text-ui leading-relaxed text-fg-muted">
            <span className="font-medium text-fg">{chart.title}.</span> &ldquo;{chart.reason}&rdquo;
          </p>
          <ul className="grid gap-1.5" aria-label={`${chart.title}, last 12 months`}>
            {topCategories.map((c) => (
              <li key={c.label} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-[11.5px]">
                <span className="truncate text-fg-muted">{c.label}</span>
                <span
                  className="h-2 rounded-r-[4px] bg-[var(--chart-1)]"
                  style={{ width: `${(c.share / (topCategories[0]?.share || 1)) * 100}%` }}
                />
                <span className="font-figures text-fg">{c.display}</span>
              </li>
            ))}
          </ul>
          <ul className="mt-auto flex flex-wrap gap-1.5 text-[11.5px] text-fg-muted">
            {[
              "No dual axes",
              "No 3D",
              "No pies over six slices",
              "Bars start at zero",
              "Colour-blind-safe palette",
              "Table view for every chart",
            ].map((r) => (
              <li key={r} className="rounded-full border border-border px-2 py-0.5">
                {r}
              </li>
            ))}
          </ul>
        </FeatureCard>
        <FeatureCard icon={Sparkles} title="Insights that cite their numbers" className="lg:col-span-2">
          {insight ? (
            <div className="rounded-card border border-border bg-surface-2/50 p-3">
              <p className="text-ui font-medium text-fg">{insight.title}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">{insight.body}</p>
              <p className="mt-2 text-2xs text-fg-subtle">Basis: {insight.basis}</p>
            </div>
          ) : null}
          <p className="mt-auto text-ui leading-relaxed text-fg-muted">
            Trends, anomalies, concentration, seasonality, segment gaps and mix shifts, ranked by impact and
            linked to the chart they come from.
          </p>
        </FeatureCard>
        <FeatureCard icon={Gauge} title="Built for the way you present" className="lg:col-span-3">
          <p className="text-ui leading-relaxed text-fg-muted">
            Executive, Analyst and Compact layouts. Drag and resize any card, filter by date or any dimension,
            click a bar to cross-filter, drill from category to sub-category, and set a target on any KPI.
          </p>
        </FeatureCard>
        <FeatureCard icon={Layers} title="Exports that fit your stack" className="lg:col-span-3">
          <p className="text-ui leading-relaxed text-fg-muted">
            A Power BI package (semantic model, DAX measures with folders, a Date table and a step-by-step
            README), SQL views per KPI, a branded PDF report, PNG images, a data dictionary and a config that
            rebuilds the same dashboard.
          </p>
        </FeatureCard>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Industries                                                          */
/* ------------------------------------------------------------------ */

export function Industries({ data }: { data: LandingData }) {
  const flagship = data.registry.list.find((d) => d.flagship);
  const others = data.registry.list.filter((d) => !d.flagship);
  return (
    <Section id="industries" labelledBy="industries-title">
      <SectionHeading
        id="industries-title"
        eyebrow="Industries"
        title={`${data.registry.domains} industries, one standard of rigour`}
      >
        Each industry is a knowledge file of fields, synonyms, KPI definitions, benchmarks, chart templates
        and pitfalls. Anything else gets a generic dashboard built from your columns.
      </SectionHeading>
      {flagship ? (
        <div className="mt-14 grid gap-6 rounded-panel border border-border-accent bg-surface-1 p-6 shadow-card sm:p-8 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-card border border-border-accent bg-accent-soft text-accent">
                <DomainIcon name={flagship.icon} className="size-5" />
              </span>
              <div>
                <p className="text-2xs font-medium tracking-[0.12em] text-accent uppercase">
                  Deepest coverage
                </p>
                <h3 className="font-display text-[30px] leading-tight text-fg">{flagship.name}</h3>
              </div>
            </div>
            <p className="mt-4 text-[15px] leading-relaxed text-fg-muted">
              {flagship.tagline}. Built for Indian D2C brands and marketplace sellers, with cash on delivery,
              return to origin, GST, pincode tiers and courier performance treated as first-class concepts.
            </p>
            <p className="font-figures mt-4 text-ui text-fg-subtle">
              {flagship.kpis} KPIs · {flagship.charts} chart templates · {flagship.areas.length} business
              areas
            </p>
          </div>
          <div className="grid content-start gap-4">
            <div>
              <p className="text-2xs font-medium tracking-[0.12em] text-fg-subtle uppercase">
                Indian specifics
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {["COD share", "RTO rate", "GST", "Pincode & city tier", "Courier SLA", "Delivery days"].map(
                  (t) => (
                    <li
                      key={t}
                      className="rounded-full border border-border-accent bg-accent-soft px-2.5 py-1 text-ui text-accent"
                    >
                      {t}
                    </li>
                  ),
                )}
              </ul>
            </div>
            <div>
              <p className="text-2xs font-medium tracking-[0.12em] text-fg-subtle uppercase">Analyses</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {[
                  "RFM segments",
                  "Cohort retention",
                  "Pareto 80/20",
                  "Market basket",
                  "Price bands",
                  "Discount vs returns",
                  "Seasonality heatmap",
                ].map((t) => (
                  <li key={t} className="rounded-full border border-border px-2.5 py-1 text-ui text-fg-muted">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-2xs font-medium tracking-[0.12em] text-fg-subtle uppercase">
                Business areas
              </p>
              <p className="mt-2 text-ui leading-relaxed text-fg-muted">{flagship.areas.join(" · ")}</p>
            </div>
          </div>
        </div>
      ) : null}
      <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {others.map((d) => (
          <li
            key={d.id}
            className="flex gap-3.5 rounded-panel border border-border bg-surface-1 p-5 transition-colors hover:border-border-strong"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-border bg-surface-2 text-fg-muted">
              <DomainIcon name={d.icon} className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[15px] font-medium text-fg">{d.name}</h3>
              <p className="mt-1 line-clamp-2 text-ui leading-relaxed text-fg-muted">{d.tagline}</p>
              <p className="font-figures mt-2 text-2xs text-fg-subtle">
                {d.kpis} KPIs · {d.charts} charts
              </p>
            </div>
          </li>
        ))}
        <li className="flex gap-3.5 rounded-panel border border-dashed border-border-strong p-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-border bg-surface-2 text-fg-muted">
            <Database className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-medium text-fg">Anything else</h3>
            <p className="mt-1 text-ui leading-relaxed text-fg-muted">
              A generic dashboard built from your columns&apos; roles: totals, trends, breakdowns and
              distributions.
            </p>
          </div>
        </li>
      </ul>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Privacy                                                             */
/* ------------------------------------------------------------------ */

export function Privacy() {
  const points = [
    {
      icon: Cpu,
      title: "Computed on your device",
      text: "Files are parsed and analysed in a background thread of this browser tab. There is no server to receive them and no account to sign in to.",
    },
    {
      icon: Lock,
      title: "Enforced, not just promised",
      text: "The site's Content-Security-Policy only allows connections to this site, the DuckDB library (when you choose to verify SQL) and Anthropic's API (only if you switch AI on).",
    },
    {
      icon: Eye,
      title: "AI is opt-in and transparent",
      text: "Off by default. When you enable it with your own key, you see the exact payload first: schema, aggregates and a few masked rows. Never the dataset.",
    },
    {
      icon: ShieldCheck,
      title: "Safe to share",
      text: "CSV exports neutralise spreadsheet formulas, so a cell starting with =, +, − or @ can't run code when a colleague opens the file in Excel.",
    },
  ];
  return (
    <Section id="privacy" labelledBy="privacy-title" className="relative overflow-hidden">
      <div className="grid items-start gap-12 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <p className="text-2xs font-medium tracking-[0.14em] text-accent uppercase">Privacy</p>
          <h2
            id="privacy-title"
            className="mt-3 font-display text-[36px] leading-[1.06] tracking-[-0.02em] text-fg sm:text-[46px]"
          >
            Your data never leaves your browser.
          </h2>
          <p className="mt-4 text-[15.5px] leading-relaxed text-fg-muted">
            Customer lists, revenue and salaries are exactly the data that shouldn&apos;t be uploaded to yet
            another tool. So Loupe doesn&apos;t upload anything. It is a static web page; the analysis runs
            where your file already is.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2 text-ui" aria-label="Data flow">
            <span className="flex items-center gap-2 rounded-control border border-border bg-surface-1 px-3 py-2 text-fg">
              <FileSpreadsheet className="size-4 text-accent" aria-hidden /> Your file
            </span>
            <ArrowRight className="size-4 text-fg-subtle" aria-hidden />
            <span className="flex items-center gap-2 rounded-control border border-border-accent bg-accent-soft px-3 py-2 text-accent">
              <Cpu className="size-4" aria-hidden /> This browser tab
            </span>
            <ArrowRight className="size-4 text-fg-subtle" aria-hidden />
            <span className="flex items-center gap-2 rounded-control border border-border bg-surface-1 px-3 py-2 text-fg">
              <LineChart className="size-4 text-accent" aria-hidden /> Your dashboard
            </span>
          </div>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {points.map((p) => (
            <li key={p.title} className="rounded-panel border border-border bg-surface-1 p-5">
              <p.icon className="size-5 text-success" aria-hidden />
              <h3 className="mt-3 text-[15px] font-medium text-fg">{p.title}</h3>
              <p className="mt-1.5 text-ui leading-relaxed text-fg-muted">{p.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Demo datasets                                                       */
/* ------------------------------------------------------------------ */

export function Samples({ data }: { data: LandingData }) {
  const iconOf = (domainId: string) => data.registry.list.find((d) => d.id === domainId)?.icon ?? "database";
  return (
    <Section id="demo" labelledBy="demo-title">
      <SectionHeading id="demo-title" eyebrow="Try it" title="Start with demo data">
        Six realistic, synthetic datasets, generated in your browser the same way every time. No real
        customers, transactions or employees.
      </SectionHeading>
      <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SAMPLES.map((s) => (
          <li key={s.id}>
            <Link
              href={`/app?sample=${s.id}`}
              className={cn(
                "group flex h-full flex-col gap-3 rounded-panel border bg-surface-1 p-5 transition-[border-color,transform] duration-300 hover:-translate-y-0.5",
                s.flagship ? "border-border-accent" : "border-border hover:border-border-strong",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex size-9 items-center justify-center rounded-control border border-border bg-surface-2 text-fg-muted group-hover:text-accent">
                  <DomainIcon name={iconOf(s.domain)} className="size-4" />
                </span>
                {s.flagship ? (
                  <span className="rounded-full border border-border-accent bg-accent-soft px-2 py-0.5 text-2xs text-accent">
                    Flagship
                  </span>
                ) : null}
              </div>
              <div>
                <h3 className="text-[15px] font-medium text-fg">{s.name}</h3>
                <p className="mt-1 text-ui leading-relaxed text-fg-muted">{s.description}</p>
              </div>
              <p className="mt-auto flex items-center justify-between text-2xs text-fg-subtle">
                <span className="font-figures">
                  {data.samples[s.id]
                    ? `${data.samples[s.id]?.rows} rows · ${data.samples[s.id]?.columns} columns`
                    : s.approxRows}
                </span>
                <span className="flex items-center gap-1 text-fg-muted transition-colors group-hover:text-accent">
                  Open <ArrowRight className="size-3" aria-hidden />
                </span>
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

const FAQ: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "Is my data uploaded anywhere?",
    a: "No. Loupe is a static web page. Your file is read and analysed by a background thread in your own browser tab, and nothing is sent to a server. The only optional network calls are loading the DuckDB library when you choose to verify SQL, and the AI layer if you switch it on with your own API key. Both are opt-in, and the site's security policy blocks everything else.",
  },
  {
    q: "Can Loupe export a .pbix file?",
    a: "No. A .pbix is a proprietary binary that only Power BI Desktop can write, and no browser tool can produce one honestly. Instead, Loupe exports a Power BI package: a semantic model in TMDL, every KPI as a DAX measure with display folders and comments, a Date table, your data as CSV and a README. Following the README in any Power BI Desktop takes about five minutes; the README also lists the KPI values to check against.",
  },
  {
    q: "How large a file can it handle?",
    a: "It depends on your device's memory. CSV files of a few hundred thousand rows are comfortable. Above about 2.1 million rows or 700 MB, Loupe offers to sample the file before loading. Excel workbooks are limited to 150 MB and JSON to 250 MB; save larger sheets as CSV.",
  },
  {
    q: "What if it detects the wrong industry?",
    a: "Change it with one click, or describe your business (industry, model, goal, reporting period, currency). When confidence is below 70%, or the top two industries are within 10 points, Loupe asks you before building the dashboard. You can also remap any column, decide what category values mean and rename KPIs. Everything regenerates instantly.",
  },
  {
    q: "How do I know the numbers are right?",
    a: 'Each KPI opens a "How this is calculated" panel with its definition, formula, the columns used, SQL and DAX, plus the grain, filters and period it was computed over. Ratios are always computed as a ratio of sums. If a KPI needs a column you don\'t have, Loupe says so instead of guessing. On the Export step, "Verify in browser" runs the generated SQL in DuckDB and compares every result.',
  },
  {
    q: "Do I need an AI key?",
    a: "No. Detection, KPIs, charts and insights all come from a deterministic rules engine, so the same file always gives the same dashboard. The AI layer is an optional extra (a second opinion on the industry and a written summary), and it is billed to your own Anthropic API key.",
  },
  {
    q: "Which formats are supported?",
    a: "CSV, TSV and other delimited text (comma, semicolon, tab, pipe), Excel .xlsx, .xlsm and .xls (with a sheet picker), JSON arrays, wrapped JSON and line-delimited JSON (.ndjson, .jsonl). Encodings, header rows, number styles such as ₹1,23,456 and 1.234,56, and over 20 date formats are detected automatically.",
  },
  {
    q: "Does it clean messy data?",
    a: "Loupe is built for clean tables: one header row and one record per row. It flags what it finds, such as missing values, duplicates, mixed types, outliers and gaps in dates, with a data-health score. It can unpivot wide tables (months as columns), but heavy cleaning belongs in your source system or a data-prep tool.",
  },
];

export function Faq() {
  return (
    <Section id="faq" labelledBy="faq-title">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
        <div>
          <p className="text-2xs font-medium tracking-[0.14em] text-accent uppercase">FAQ</p>
          <h2
            id="faq-title"
            className="mt-3 font-display text-[36px] leading-[1.06] tracking-[-0.02em] text-fg sm:text-[46px]"
          >
            Straight answers
          </h2>
          <p className="mt-4 text-[15.5px] leading-relaxed text-fg-muted">
            What Loupe does, what it doesn&apos;t, and where the limits are. Every change is listed in the{" "}
            <Link
              href="/changelog"
              className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
            >
              version log
            </Link>
            .
          </p>
        </div>
        <Accordion type="single" collapsible className="border-t border-border">
          {FAQ.map((f, i) => (
            <AccordionItem key={f.q} value={`faq-${i}`}>
              <AccordionTrigger>{f.q}</AccordionTrigger>
              <AccordionContent>{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Closing call to action                                              */
/* ------------------------------------------------------------------ */

export function ClosingCta() {
  return (
    <section aria-labelledby="cta-title" className="relative isolate overflow-hidden border-t border-border">
      <div aria-hidden className="mesh grain absolute inset-0 -z-10 opacity-80" />
      <div className="mx-auto max-w-4xl px-4 py-24 text-center sm:px-6 sm:py-32">
        <h2
          id="cta-title"
          className="font-display text-[40px] leading-[1.04] tracking-[-0.02em] text-fg sm:text-[56px]"
        >
          Bring a table. Leave with a dashboard <em className="text-accent">you can defend.</em>
        </h2>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Button asChild variant="primary" size="lg">
            <Link href="/app">
              Open the workspace <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href="/app?sample=ecommerce">
              <Play aria-hidden /> Explore the live demo
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
