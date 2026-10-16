/**
 * Glossary ("/glossary"): every term Loupe uses, explained for beginners, in
 * a learning path from the basics to each industry's KPIs. The content lives
 * in src/content/glossary.ts (hand-written terms, the chart catalogue and the
 * registry's KPIs); this page lays it out and hands it to the reader
 * (ui/site/Glossary.tsx), which adds search, the level filter and the
 * industry picker.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpenText, ChartNoAxesCombined, GraduationCap, Layers } from "lucide-react";
import { chartGlossary, GLOSSARY, industryGlossary } from "@/content/glossary";
import { DOMAINS } from "@/registry";
import { CreditBar } from "@/ui/site/CreditBar";
import { Glossary } from "@/ui/site/Glossary";
import { SiteFooter } from "@/ui/site/SiteFooter";
import { SiteHeader } from "@/ui/site/SiteHeader";

export const metadata: Metadata = {
  title: "Glossary",
  description:
    "Every data and dashboard term explained for beginners: basics, numbers, time, charts, analysis methods, data quality and exports, plus the KPIs of 16 industries with their formulas.",
};

export const dynamic = "force-static";

export default function GlossaryPage() {
  const industries = industryGlossary(DOMAINS);
  const chartGroups = chartGlossary();
  const terms = GLOSSARY.reduce((a, s) => a + s.terms.length, 0);
  const charts = chartGroups.reduce((a, g) => a + g.charts.length, 0);
  const kpis = industries.reduce((a, i) => a + i.kpiCount, 0);
  const stats = [
    { icon: BookOpenText, label: "Terms explained", value: terms },
    { icon: ChartNoAxesCombined, label: "Chart types", value: charts },
    { icon: Layers, label: "Industry KPIs", value: kpis },
    { icon: GraduationCap, label: "Industries", value: industries.length },
  ];
  return (
    <>
      <CreditBar />
      <SiteHeader />
      <main id="main" className="relative isolate">
        <div aria-hidden className="mesh absolute inset-x-0 top-0 -z-10 h-[420px] opacity-70" />
        <div className="mx-auto max-w-6xl px-4 pt-14 pb-24 sm:px-6 sm:pt-20">
          <p className="text-2xs font-medium tracking-[0.14em] text-accent uppercase">Glossary</p>
          <h1 className="mt-3 max-w-3xl font-display text-[44px] leading-[1.02] tracking-[-0.025em] text-fg sm:text-[60px]">
            Learn the language of data.
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-fg-muted">
            Every word Loupe uses, explained in plain English: what it means, why it matters, an example, and
            where you meet it in the app. Start with the basics and work down, or jump to the KPIs of your
            industry.
          </p>

          <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-card border border-border bg-surface-1 p-4">
                <dt className="flex items-center gap-1.5 text-2xs text-fg-subtle">
                  <s.icon className="size-3.5" aria-hidden /> {s.label}
                </dt>
                <dd className="font-figures mt-1 text-[22px] text-fg">{s.value}</dd>
              </div>
            ))}
          </dl>

          <section
            aria-labelledby="how-to-use"
            className="mt-6 rounded-panel border border-border bg-surface-1 p-5"
          >
            <h2 id="how-to-use" className="text-[15px] font-medium text-fg">
              How to use this page
            </h2>
            <ul className="mt-3 grid gap-2.5 text-ui leading-relaxed text-fg-muted md:grid-cols-3">
              <li>
                <span className="text-fg">New to data?</span> Choose <span className="text-fg">Beginner</span>{" "}
                and read the learning path from the top: each step builds on the one before.
              </li>
              <li>
                <span className="text-fg">Looking for one word?</span> Press{" "}
                <kbd className="font-figures">/</kbd> and search: terms, charts and every industry&apos;s KPIs
                come up together.
              </li>
              <li>
                <span className="text-fg">Learning your industry?</span> Pick it under Industry KPIs for each
                KPI&apos;s formula, which way is good, and what to watch out for.
              </li>
            </ul>
          </section>

          <Glossary sections={GLOSSARY} chartGroups={chartGroups} industries={industries} />

          <div className="mt-16 rounded-panel border border-border-accent bg-surface-1 p-6 sm:p-8">
            <h2 className="font-display text-[28px] leading-tight text-fg">Put the words to work</h2>
            <p className="mt-2 max-w-xl text-ui leading-relaxed text-fg-muted">
              Open a demo or your own file: every KPI card, chart and insight in Loupe uses the words on this
              page, with its working shown.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/app?sample=ecommerce&step=dashboard"
                className="inline-flex items-center gap-2 rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg hover:bg-accent-strong"
              >
                Explore a live demo <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link
                href="/app"
                className="inline-flex items-center gap-2 rounded-control border border-border-strong px-4 py-2.5 text-sm text-fg hover:border-border-accent"
              >
                Open the workspace
              </Link>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
