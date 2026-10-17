/**
 * Version log ("/changelog"): every step of building Loupe, as MAJOR.MINOR
 * versions. Content lives in src/content/changelog.ts; this page only lays it out.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, GitCommitVertical, Milestone, Wrench } from "lucide-react";
import { CURRENT_RELEASE, PLANNED, RELEASES } from "@/content/changelog";
import { ChangelogTimeline } from "@/ui/site/ChangelogTimeline";
import { SiteFooter } from "@/ui/site/SiteFooter";
import { CreditBar } from "@/ui/site/CreditBar";
import { SiteHeader } from "@/ui/site/SiteHeader";

export const metadata: Metadata = {
  title: "Version log",
  description:
    "Every step of building Loupe, versioned: major versions add a capability, minor versions refine or fix one.",
};

export const dynamic = "force-static";

export default function ChangelogPage() {
  const majors = RELEASES.filter((r) => r.kind === "major").length;
  const minors = RELEASES.length - majors;
  return (
    <>
      <CreditBar />
      <SiteHeader />
      <main id="main" className="relative isolate">
        <div aria-hidden className="mesh absolute inset-x-0 top-0 -z-10 h-[420px] opacity-70" />
        <div className="mx-auto max-w-3xl px-4 pt-14 pb-24 sm:px-6 sm:pt-20">
          <p className="eyebrow text-accent">Version log</p>
          <h1 className="mt-3 font-display text-display-md text-fg sm:text-display-lg">
            Every step, logged.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-fg-muted">
            Loupe is built one step at a time, and each step gets a version number. The newest version is at
            the top. Each entry says what changed in plain language, then lists the files involved for
            developers.
          </p>

          <dl className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="rounded-card border border-border bg-surface-1 p-4">
              <dt className="flex items-center gap-1.5 text-xs text-fg-subtle">
                <GitCommitVertical className="size-3.5" aria-hidden /> Current version
              </dt>
              <dd className="font-figures mt-1 text-2xl font-medium text-fg">v{CURRENT_RELEASE.version}</dd>
            </div>
            <div className="rounded-card border border-border bg-surface-1 p-4">
              <dt className="flex items-center gap-1.5 text-xs text-fg-subtle">
                <Milestone className="size-3.5" aria-hidden /> Major versions
              </dt>
              <dd className="font-figures mt-1 text-2xl font-medium text-fg">{majors}</dd>
            </div>
            <div className="rounded-card border border-border bg-surface-1 p-4">
              <dt className="flex items-center gap-1.5 text-xs text-fg-subtle">
                <Wrench className="size-3.5" aria-hidden /> Minor versions
              </dt>
              <dd className="font-figures mt-1 text-2xl font-medium text-fg">{minors}</dd>
            </div>
          </dl>

          <section
            aria-labelledby="how-versions"
            className="mt-8 rounded-panel border border-border bg-surface-1 p-5"
          >
            <h2 id="how-versions" className="text-md font-medium text-fg">
              How to read the numbers
            </h2>
            <ul className="mt-3 grid gap-2.5 text-sm leading-relaxed text-fg-muted">
              <li>
                <span className="font-medium text-fg">MAJOR</span> (the first number, as in{" "}
                <span className="font-figures text-fg">18.0</span>): a new capability, subsystem or page, such
                as the dashboard or the Power BI export.
              </li>
              <li>
                <span className="font-medium text-fg">MINOR</span> (the second number, as in{" "}
                <span className="font-figures text-fg">18.1</span>): a refinement, fix or follow-up to that
                major version. It starts again at 1 after each major.
              </li>
            </ul>
          </section>

          {PLANNED.length ? (
            <section
              aria-labelledby="planned"
              className="mt-4 rounded-panel border border-dashed border-border-strong p-5"
            >
              <h2 id="planned" className="text-md font-medium text-fg">
                Up next
              </h2>
              <ol className="mt-3 grid gap-2.5">
                {PLANNED.map((p, i) => (
                  <li key={p.title} className="grid grid-cols-[1.5rem_1fr] gap-2 text-sm leading-relaxed">
                    <span className="font-figures text-fg-subtle">{i + 1}.</span>
                    <span>
                      <span className="text-fg">{p.title}.</span>{" "}
                      <span className="text-fg-muted">{p.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <div className="mt-12">
            <ChangelogTimeline releases={RELEASES} />
          </div>

          <div className="mt-14 flex flex-wrap gap-3">
            <Link
              href="/app"
              className="inline-flex items-center gap-2 rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg hover:bg-accent-strong"
            >
              Open the workspace <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-control border border-border-strong px-4 py-2.5 text-sm text-fg hover:border-border-accent"
            >
              Back to the home page
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
