/**
 * Landing page sections: hero, how it works, features, industries, privacy,
 * demo datasets, FAQ and the closing call to action.
 *
 * Words are kept to a headline and a short line per section; the rest is
 * shown in motion: the hero's words rise into place over a drifting aurora,
 * the product shot straightens as it scrolls in (HeroStage), "How it works"
 * plays as a short film (Pipeline), the features are animated tiles (Bento),
 * industries scroll past, and data visibly flows from file to dashboard
 * without reaching a server. The ambient motion is CSS (globals.css), so it
 * starts with the first paint and stops under reduced motion; each section is
 * a [data-loop] host, so its loops also hold still while it is off screen
 * (PauseOffscreen in motion.tsx).
 *
 * Every figure comes from `LandingData` (preview-data.ts), which the engine
 * computes at build time, or from the engine's own constants (the large-file
 * limits, the date formats it reads). The copy may describe the product, but
 * it never states a number the engine or the registry did not produce.
 */
import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Cpu,
  Eye,
  FileDown,
  FileSpreadsheet,
  Layers,
  LineChart,
  Lock,
  Play,
  Server,
  ShieldCheck,
  X,
} from "lucide-react";
import { formatBytes } from "@/engine/core/format";
import { LARGE_BYTE_LIMIT, LARGE_ROW_LIMIT } from "@/engine/parse/csv";
import { DATE_KIND_LABEL } from "@/engine/parse/dates";
import { SAMPLES } from "@/engine/samples/catalog";
import { DomainIcon } from "@/ui/common/domain-icon";
import { Button } from "@/ui/primitives/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/ui/primitives/misc";
import { SectionLink } from "@/ui/site/SectionLink";
import { cn } from "@/lib/utils";
import { Bento } from "./Bento";
import { HeroStage } from "./HeroStage";
import { MarqueeGroup } from "./MarqueeGroup";
import { CountUp, Reveal, Spotlight } from "./motion";
import { Pipeline } from "./Pipeline";
import type { LandingData } from "./preview-data";

/** A demo dataset opened straight on its finished dashboard. */
const demoHref = (id: string) => `/app?sample=${id}&step=dashboard`;

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

/** Splits a line into words that rise into place one after another (`word-rise` in globals.css). */
function Words({ text, from = 0, gradient = false }: { text: string; from?: number; gradient?: boolean }) {
  const words = text.split(" ");
  return words.map((w, i) => (
    <React.Fragment key={`${w}-${i}`}>
      <span
        className={cn("word-rise inline-block", gradient && "text-gradient-accent ink-pad")}
        style={{ "--i": from + i } as React.CSSProperties}
      >
        {w}
      </span>
      {i < words.length - 1 ? " " : null}
    </React.Fragment>
  ));
}

function SectionHeading({
  eyebrow,
  title,
  line,
  id,
}: {
  eyebrow: string;
  title: React.ReactNode;
  line?: string;
  id: string;
}) {
  return (
    <Reveal className="mx-auto max-w-3xl text-center">
      <p className="text-2xs font-medium tracking-[0.16em] text-accent uppercase">{eyebrow}</p>
      <h2
        id={id}
        className="mt-4 font-display text-[38px] leading-[1.04] tracking-[-0.025em] text-fg sm:text-[54px]"
      >
        {title}
      </h2>
      {line ? (
        <p className="mx-auto mt-4 max-w-xl text-[15.5px] leading-relaxed text-fg-muted">{line}</p>
      ) : null}
    </Reveal>
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
      data-loop
      className={cn("relative scroll-mt-20 py-24 sm:py-32", className)}
    >
      {/* A hairline that fades out at both ends, instead of a hard rule between sections. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--border-strong),transparent)]"
      />
      <div className="mx-auto max-w-6xl px-4 sm:px-6">{children}</div>
    </section>
  );
}

/** Drifting colour fields, a measuring grid and film grain (all decorative CSS). */
function Atmosphere({ grid = true }: { grid?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {grid ? <div className="grid-lines absolute inset-0" /> : null}
      <span className="aurora-blob top-[-12%] left-[4%] h-[440px] w-[620px] animate-[aurora-a_19s_ease-in-out_infinite] bg-[var(--mesh-1)]" />
      <span className="aurora-blob top-[2%] right-[-4%] h-[420px] w-[560px] animate-[aurora-b_23s_ease-in-out_infinite] bg-[var(--mesh-2)]" />
      <span className="aurora-blob top-[40%] left-[32%] h-[380px] w-[520px] animate-[aurora-c_27s_ease-in-out_infinite] bg-[var(--mesh-3)]" />
      <div className="grain absolute inset-0" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

export function Hero({ data }: { data: LandingData }) {
  const proof = [
    { icon: ShieldCheck, label: "No sign-up, no upload" },
    { icon: Layers, label: `${data.registry.domains} industries built in` },
    { icon: FileDown, label: "Power BI · SQL · PDF · Slides" },
  ];
  return (
    <section aria-labelledby="hero-title" data-loop className="relative isolate overflow-hidden">
      <Atmosphere />
      <div className="mx-auto max-w-6xl px-4 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-28">
        <div className="mx-auto max-w-4xl text-center">
          <SectionLink
            href="#privacy"
            className="word-rise inline-flex items-center gap-2.5 rounded-full border border-border-strong bg-surface-1/70 px-3.5 py-1.5 text-ui text-fg-muted backdrop-blur transition-colors hover:border-border-accent hover:text-fg"
            style={{ "--i": 0 } as React.CSSProperties}
          >
            <span className="relative flex size-2" aria-hidden>
              <span className="absolute inset-0 animate-[ping-soft_2.2s_ease-out_infinite] rounded-full bg-success" />
              <span className="relative size-2 rounded-full bg-success" />
            </span>
            Runs entirely in your browser
          </SectionLink>
          <h1
            id="hero-title"
            className="mt-8 font-display text-[46px] leading-[1.02] tracking-[-0.03em] text-fg sm:text-[72px] lg:text-[88px] lg:leading-[0.98]"
          >
            <Words text="Analyst-grade dashboards," from={1} />
            <br className="hidden sm:block" />{" "}
            <em>
              <Words text="with the working shown." from={4} gradient />
            </em>
          </h1>
          <p
            className="word-rise mx-auto mt-7 max-w-xl text-[17px] leading-relaxed text-fg-muted sm:text-[18px]"
            style={{ "--i": 9 } as React.CSSProperties}
          >
            Drop in a file. Get the KPIs, each with its SQL and DAX, plus the charts and insights.
          </p>
          <div
            className="word-rise mt-10 flex flex-wrap justify-center gap-3"
            style={{ "--i": 10 } as React.CSSProperties}
          >
            <Button asChild variant="primary" size="lg">
              <Link href="/app">
                Open the workspace <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg" className="backdrop-blur">
              <Link href={demoHref("ecommerce")}>
                <Play aria-hidden /> Explore the live demo
              </Link>
            </Button>
          </div>
          <ul
            className="word-rise mt-9 flex flex-wrap justify-center gap-x-6 gap-y-2.5 text-ui text-fg-subtle"
            style={{ "--i": 11 } as React.CSSProperties}
          >
            {proof.map((p) => (
              <li key={p.label} className="flex items-center gap-2">
                <p.icon className="size-3.5 text-accent" aria-hidden />
                {p.label}
              </li>
            ))}
          </ul>
        </div>
        {/* Only what the panel renders crosses into the client bundle. */}
        <HeroStage
          data={{
            file: data.file,
            detection: data.detection,
            columns: data.columns,
            states: data.states,
            tiles: data.tiles,
          }}
        />
        <p className="mt-5 text-center text-2xs text-fg-subtle">
          Live engine output from the bundled demo file: synthetic orders from an Indian D2C brand.{" "}
          <Link
            href={demoHref("ecommerce")}
            className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
          >
            Open it live
          </Link>
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

export function HowItWorks({ data }: { data: LandingData }) {
  const state = data.states[0];
  if (!state) return null;
  return (
    <Section id="how" labelledBy="how-title">
      <SectionHeading id="how-title" eyebrow="How it works" title="From a file to a finished dashboard" />
      <Reveal className="mt-14" amount={0.15}>
        <Pipeline
          data={{
            file: data.file,
            detection: data.detection,
            columns: data.columns,
            health: data.health,
            chartTypes: data.chartTypes,
            state,
          }}
        />
      </Reveal>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Features                                                            */
/* ------------------------------------------------------------------ */

export function Features({ data }: { data: LandingData }) {
  const state = data.states[0];
  if (!state) return null;
  return (
    <Section id="features" labelledBy="features-title">
      <SectionHeading
        id="features-title"
        eyebrow="Features"
        title={
          <>
            The judgement of an analyst, <em className="text-gradient-accent ink-pad">made inspectable.</em>
          </>
        }
      />
      <div className="mt-14">
        <Bento data={{ showcase: data.showcase, state, columns: data.columns, health: data.health }} />
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Industries                                                          */
/* ------------------------------------------------------------------ */

type Domain = LandingData["registry"]["list"][number];

function IndustryPill({ d }: { d: Domain }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 rounded-full border px-4 py-2.5 text-sm whitespace-nowrap",
        d.flagship ? "border-border-accent bg-accent-soft text-fg" : "border-border bg-surface-1 text-fg",
      )}
    >
      <DomainIcon name={d.icon} className="size-4 text-accent" />
      {d.name}
      {/* Muted, not subtle: on the flagship's brass tint the subtle ink falls below 4.5:1. */}
      <span className="font-figures text-2xs text-fg-muted">{d.kpis} KPIs</span>
      {d.flagship ? (
        <span className="rounded-full bg-[image:var(--accent-gradient)] px-2 py-0.5 text-[10px] font-medium text-accent-fg">
          Flagship
        </span>
      ) : null}
    </span>
  );
}

/** An endless row: the items twice over, the second copy hidden from assistive technology. */
function Marquee({
  items,
  reverse = false,
  seconds,
}: {
  items: Domain[];
  reverse?: boolean;
  seconds: number;
}) {
  const row = (copy: boolean) => (
    <ul aria-hidden={copy || undefined} className="flex shrink-0 gap-3 pr-3">
      {items.map((d) => (
        <li key={d.id}>
          <IndustryPill d={d} />
        </li>
      ))}
    </ul>
  );
  return (
    <div className="marquee overflow-hidden py-1">
      <div
        className="marquee-track"
        data-reverse={reverse ? "" : undefined}
        style={{ "--marquee-duration": `${seconds}s` } as React.CSSProperties}
      >
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}

export function Industries({ data }: { data: LandingData }) {
  const list = data.registry.list;
  const half = Math.ceil(list.length / 2);
  const stats = [
    { value: data.registry.domains, label: "Industries" },
    { value: data.registry.kpis, label: "KPI definitions" },
    { value: data.registry.charts, label: "Chart templates" },
  ];
  return (
    <Section id="industries" labelledBy="industries-title" className="overflow-hidden">
      <SectionHeading
        id="industries-title"
        eyebrow="Industries"
        title={
          <>
            Built for your industry. <em className="text-gradient-accent ink-pad">One standard of rigour.</em>
          </>
        }
      />
      <Reveal>
        <dl className="mx-auto mt-14 grid max-w-3xl grid-cols-3 gap-3 sm:gap-6">
          {stats.map((s) => (
            <div
              key={s.label}
              className="flex flex-col-reverse items-center rounded-panel border border-border bg-surface-1/60 px-2 py-5 text-center sm:py-7"
            >
              <dt className="mt-1 text-2xs text-fg-muted sm:text-ui">{s.label}</dt>
              <dd className="font-display text-[38px] leading-none text-fg sm:text-[60px]">
                <CountUp value={s.value} />
              </dd>
            </div>
          ))}
        </dl>
      </Reveal>
      <MarqueeGroup className="mt-12 sm:-mx-6">
        <Marquee items={list.slice(0, half)} seconds={52} />
        <Marquee items={list.slice(half)} reverse seconds={58} />
      </MarqueeGroup>
      <p className="mt-8 text-center text-ui text-fg-muted">
        Anything else gets a dashboard built from its own columns.
      </p>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Privacy                                                             */
/* ------------------------------------------------------------------ */

function FlowNode({
  icon: Icon,
  label,
  tone = "plain",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone?: "plain" | "focus" | "blocked";
}) {
  return (
    // Narrower on small phones (20% of the screen, 64–84px), so the row of three fits a 320px screen.
    <div className="flex w-[clamp(64px,20vw,84px)] shrink-0 flex-col items-center gap-2 text-center sm:w-[100px]">
      <span
        className={cn(
          "relative grid size-14 place-items-center rounded-[16px] border sm:size-16",
          tone === "focus"
            ? "border-border-accent bg-accent-soft text-accent shadow-[0_0_40px_-8px_var(--glow-accent)]"
            : tone === "blocked"
              ? "border-dashed border-border-strong bg-surface-2 text-fg-subtle"
              : "border-border-strong bg-surface-2 text-fg shadow-card",
        )}
      >
        {tone === "focus" ? <span aria-hidden className="beam-ring" /> : null}
        <Icon className="size-6" aria-hidden />
      </span>
      <span
        className={cn(
          "text-[12px] sm:text-ui",
          tone === "blocked" ? "text-fg-subtle line-through" : "text-fg",
        )}
      >
        {label}
      </span>
    </div>
  );
}

/** A hairline with brass dots travelling along it (decorative). */
function Connector() {
  return (
    <div
      aria-hidden
      // At the height of the icons' centres (the nodes are top-aligned; their labels wrap unevenly).
      className="relative mt-7 h-px min-w-3 flex-1 bg-[linear-gradient(90deg,var(--border-strong),var(--border-accent))] sm:mt-8"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="absolute inset-0 animate-[flow-x_2.4s_linear_infinite]"
          style={{ animationDelay: `${i * 0.8}s` }}
        >
          <span className="absolute top-1/2 left-0 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_10px_var(--glow-accent)]" />
        </span>
      ))}
    </div>
  );
}

function FlowDiagram() {
  return (
    <div
      data-loop
      className="relative overflow-hidden rounded-panel border border-border-strong bg-surface-1 px-3 py-8 shadow-lift sm:px-6 sm:py-10"
    >
      <div aria-hidden className="grid-lines absolute inset-0 opacity-70" />
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(50%_60%_at_50%_70%,var(--mesh-1),transparent_70%)]"
      />
      <div className="relative flex flex-col items-center">
        <FlowNode icon={Server} label="A server" tone="blocked" />
        <div aria-hidden className="relative my-3 h-16 w-px border-l border-dashed border-danger/60">
          <span className="absolute inset-0 animate-[flow-up-blocked_2.8s_ease-in_infinite]">
            <span className="absolute bottom-0 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-accent" />
          </span>
          <span className="absolute top-1/2 left-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-danger/40 bg-danger-soft text-danger">
            <X className="size-3.5" />
          </span>
        </div>
        <div className="flex w-full items-start gap-1.5 sm:gap-3">
          <FlowNode icon={FileSpreadsheet} label="Your file" />
          <Connector />
          <FlowNode icon={Cpu} label="This browser tab" tone="focus" />
          <Connector />
          <FlowNode icon={LineChart} label="Your dashboard" />
        </div>
      </div>
      <p className="sr-only">
        Your file goes into this browser tab and comes out as your dashboard. Nothing is sent to a server.
      </p>
    </div>
  );
}

export function Privacy() {
  const points = [
    { icon: Cpu, label: "Computed on your device" },
    { icon: Lock, label: "Enforced by the page's security policy" },
    { icon: Eye, label: "AI off unless you switch it on" },
    { icon: ShieldCheck, label: "Formula-safe CSV exports" },
  ];
  return (
    <Section id="privacy" labelledBy="privacy-title">
      {/* One column that may shrink below its content's width: an auto column would grow to the
          flow diagram's minimum and push the page sideways on a 320px phone. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-12 lg:grid-cols-[1fr_1.15fr]">
        <Reveal>
          <p className="text-2xs font-medium tracking-[0.16em] text-accent uppercase">Privacy</p>
          <h2
            id="privacy-title"
            className="mt-4 font-display text-[38px] leading-[1.04] tracking-[-0.025em] text-fg sm:text-[54px]"
          >
            Your data <em className="text-gradient-accent ink-pad">never leaves</em> your browser.
          </h2>
          <p className="mt-4 text-[15.5px] leading-relaxed text-fg-muted">
            No server to receive it. No account to sign in to.
          </p>
          <ul className="mt-8 grid gap-2.5 sm:grid-cols-2">
            {points.map((p) => (
              <li
                key={p.label}
                className="flex items-center gap-2.5 rounded-card border border-border bg-surface-1/70 px-3.5 py-3 text-ui text-fg"
              >
                <p.icon className="size-4 shrink-0 text-success" aria-hidden />
                {p.label}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.1}>
          <FlowDiagram />
        </Reveal>
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
      <SectionHeading
        id="demo-title"
        eyebrow="Try it"
        title="Start with demo data"
        line="Synthetic, generated in your browser, the same every time."
      />
      <Reveal className="mt-14" amount={0.15}>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SAMPLES.map((s) => (
            <Spotlight
              key={s.id}
              as="li"
              className={cn(
                "rounded-panel border bg-surface-1 transition-[border-color,transform] duration-300 hover:-translate-y-1",
                s.flagship ? "border-border-accent" : "border-border hover:border-border-strong",
              )}
            >
              <Link href={demoHref(s.id)} className="group flex h-full flex-col gap-4 rounded-panel p-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="grid size-10 place-items-center rounded-[12px] border border-border bg-surface-2 text-fg-muted transition-colors group-hover:border-border-accent group-hover:text-accent">
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
                  <p className="mt-1 line-clamp-2 text-ui leading-relaxed text-fg-muted">{s.description}</p>
                </div>
                <p className="mt-auto flex items-center justify-between text-2xs text-fg-subtle">
                  <span className="font-figures">
                    {data.samples[s.id]
                      ? `${data.samples[s.id]?.rows} rows · ${data.samples[s.id]?.columns} columns`
                      : s.approxRows}
                  </span>
                  <span className="flex items-center gap-1 text-fg-muted transition-colors group-hover:text-accent">
                    Open{" "}
                    <ArrowRight
                      className="size-3 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                </p>
              </Link>
            </Spotlight>
          ))}
        </ul>
      </Reveal>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

/** "2.1 million rows or 700 MB": the point where the parser asks how to read a file (engine/parse/csv.ts). */
const LARGE_FILE = `${(LARGE_ROW_LIMIT / 1e6).toLocaleString("en-GB", { maximumFractionDigits: 1 })} million rows or ${formatBytes(LARGE_BYTE_LIMIT)}`;
/** The date and time layouts the parser recognises (engine/parse/dates.ts). */
const DATE_FORMATS = Object.keys(DATE_KIND_LABEL).length;

const FAQ: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "Is my data uploaded anywhere?",
    a: "No. Your file is read and analysed inside this browser tab, and the site's security policy blocks sending it anywhere. The only optional connections are the DuckDB library (if you verify SQL) and the AI layer (if you switch it on with your own key).",
  },
  {
    q: "Can Loupe export a .pbix file?",
    a: "No: only Power BI Desktop can write a .pbix. Loupe exports a Power BI package instead (the model, every KPI as a DAX measure, a Date table, your data and a README) that opens in Power BI Desktop in about five minutes.",
  },
  {
    q: "How large a file can it handle?",
    a: `A few hundred thousand rows are comfortable on most laptops. Above about ${LARGE_FILE}, Loupe offers to sample the file first.`,
  },
  {
    q: "What if it detects the wrong industry?",
    a: "Change it with one click, or describe your business. When it isn't sure, it asks before building anything, and every mapping can be changed later.",
  },
  {
    q: "How do I know the numbers are right?",
    a: "Every KPI shows its definition, formula, columns, SQL and DAX. If a column is missing it says so instead of guessing. “Verify against your data” (Export › SQL) and “Check this SQL on your data” (Questions & SQL) run the SQL in DuckDB inside your browser and compare every result with the numbers on screen.",
  },
  {
    q: "Do I need an AI key?",
    a: "No. Everything comes from a deterministic engine, so the same file always gives the same dashboard. AI is an optional extra on your own Anthropic key.",
  },
  {
    q: "Which formats are supported?",
    a: `CSV, TSV and other delimited text, Excel (.xlsx, .xlsm, .xls) and JSON, including line-delimited JSON. Encodings, number styles such as ₹1,23,456 and ${DATE_FORMATS} date and time formats are detected automatically.`,
  },
];

export function Faq() {
  return (
    <Section id="faq" labelledBy="faq-title">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
        <Reveal>
          <p className="text-2xs font-medium tracking-[0.16em] text-accent uppercase">FAQ</p>
          <h2
            id="faq-title"
            className="mt-4 font-display text-[38px] leading-[1.04] tracking-[-0.025em] text-fg sm:text-[54px]"
          >
            Straight answers
          </h2>
          <p className="mt-4 text-[15.5px] leading-relaxed text-fg-muted">
            Every change is in the{" "}
            <Link
              href="/changelog"
              className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
            >
              version log
            </Link>
            .
          </p>
        </Reveal>
        <Reveal delay={0.08}>
          <Accordion type="single" collapsible className="border-t border-border">
            {FAQ.map((f, i) => (
              <AccordionItem key={f.q} value={`faq-${i}`}>
                <AccordionTrigger>{f.q}</AccordionTrigger>
                <AccordionContent>{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Closing call to action                                              */
/* ------------------------------------------------------------------ */

/** One layer of the lens: a full-size SVG on the 200-unit grid, turning when given a spin. */
function LensLayer({ spin, children }: { spin?: string; children: React.ReactNode }) {
  return (
    <div className={cn("absolute inset-0", spin)}>
      <svg viewBox="0 0 200 200" className="size-full overflow-visible">
        {children}
      </svg>
    </div>
  );
}

/**
 * The Loupe lens as a slow instrument: a ticked bezel and a brass arc turning
 * round a glowing focus. Each turning ring is an HTML layer of its own: a CSS
 * rotation of an SVG group is restyled and laid out every frame, a layer's is
 * only composited.
 */
function LensOrb({ className }: { className?: string }) {
  const ticks = Array.from({ length: 72 }, (_, i) => (i / 72) * Math.PI * 2);
  return (
    <div aria-hidden data-loop className={cn("relative", className)}>
      <div className="absolute inset-[12%] rounded-full bg-[radial-gradient(circle,var(--glow-accent),transparent_68%)] blur-2xl" />
      <LensLayer spin="animate-[spin-slow_60s_linear_infinite]">
        {ticks.map((a, i) => (
          <line
            key={i}
            x1={100 + Math.cos(a) * 90}
            y1={100 + Math.sin(a) * 90}
            x2={100 + Math.cos(a) * (i % 6 === 0 ? 81 : 86)}
            y2={100 + Math.sin(a) * (i % 6 === 0 ? 81 : 86)}
            stroke="var(--border-strong)"
            strokeWidth={i % 6 === 0 ? 1.4 : 1}
          />
        ))}
      </LensLayer>
      <LensLayer spin="animate-[spin-slow_14s_linear_infinite_reverse]">
        <circle cx={100} cy={100} r={70} fill="none" stroke="var(--border-strong)" strokeDasharray="2 7" />
        <path
          d="M100 30a70 70 0 0 1 66 46"
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      </LensLayer>
      <LensLayer spin="animate-[spin-slow_24s_linear_infinite]">
        <circle cx={100} cy={100} r={52} fill="none" stroke="var(--accent)" strokeOpacity={0.3} />
        <circle cx={100} cy={48} r={3} fill="var(--accent-strong)" />
      </LensLayer>
      <LensLayer>
        <circle cx={100} cy={100} r={16} fill="var(--accent)" />
      </LensLayer>
      {/* The focus's pulse, the size of the focus (32 of 200 units). */}
      <span className="absolute top-1/2 left-1/2 size-[16%] -translate-x-1/2 -translate-y-1/2 animate-[ping-soft_2.6s_ease-out_infinite] rounded-full bg-accent" />
      <LensLayer>
        <circle cx={108} cy={92} r={4} fill="var(--fg)" fillOpacity={0.5} />
      </LensLayer>
    </div>
  );
}

export function ClosingCta() {
  return (
    <section aria-labelledby="cta-title" data-loop className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--border-strong),transparent)]"
      />
      <Atmosphere grid={false} />
      <div className="mx-auto max-w-4xl px-4 py-24 text-center sm:px-6 sm:py-32">
        <LensOrb className="mx-auto mb-10 size-36 sm:size-44" />
        <Reveal>
          <h2
            id="cta-title"
            className="font-display text-[42px] leading-[1.02] tracking-[-0.025em] text-fg sm:text-[64px]"
          >
            Bring a table. Leave with a dashboard{" "}
            <em className="text-gradient-accent ink-pad">you can defend.</em>
          </h2>
        </Reveal>
        <Reveal delay={0.12}>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button asChild variant="primary" size="lg">
              <Link href="/app">
                Open the workspace <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href={demoHref("ecommerce")}>
                <Play aria-hidden /> Explore the live demo
              </Link>
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
