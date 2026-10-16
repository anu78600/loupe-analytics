/**
 * Footer for the marketing pages. Shows the copyright (content/credits.ts)
 * and the current version from the version log (src/content/changelog.ts) so
 * visitors can see what changed and when. Its links to the home page's
 * sections are SectionLinks, so they scroll in place there (see
 * SectionLink.tsx).
 */
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Wordmark } from "@/ui/brand/logo";
import { CURRENT_RELEASE } from "@/content/changelog";
import { AUTHOR, copyrightLine } from "@/content/credits";
import { SectionLink } from "./SectionLink";

const COLUMNS: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
  {
    title: "Product",
    links: [
      { href: "/app", label: "Open the workspace" },
      { href: "/app?sample=ecommerce&step=dashboard", label: "Live e-commerce demo" },
      { href: "/#how", label: "How it works" },
      { href: "/#industries", label: "Industries" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/#privacy", label: "Privacy" },
      { href: "/#faq", label: "FAQ" },
      { href: "/changelog", label: "Version log" },
    ],
  },
];

export function SiteFooter() {
  const version = `v${CURRENT_RELEASE.version} · ${CURRENT_RELEASE.title}`;
  return (
    <footer className="border-t border-border bg-bg-subtle">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.6fr_1fr_1fr]">
        <div className="grid content-start gap-4">
          <Wordmark />
          <p className="max-w-sm text-ui leading-relaxed text-fg-muted">
            Analyst-grade dashboards from clean data, with the working shown.
          </p>
          <p className="flex items-center gap-2 text-ui text-fg-muted">
            <ShieldCheck className="size-4 text-success" aria-hidden /> Your data never leaves your browser.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title} className="grid content-start gap-3">
            <p className="text-2xs font-medium tracking-[0.12em] text-fg-subtle uppercase">{col.title}</p>
            {col.links.map((l) => (
              <SectionLink
                key={l.href}
                href={l.href}
                className="w-fit text-ui text-fg-muted transition-colors hover:text-fg"
              >
                {l.label}
              </SectionLink>
            ))}
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-2xs text-fg-subtle sm:px-6">
          <div className="grid gap-1">
            <p className="text-fg-muted">
              {copyrightLine(CURRENT_RELEASE.date)} Designed &amp; developed by {AUTHOR}.
            </p>
            <p>
              Demo datasets are synthetic and generated in the browser. No real customers or transactions.
            </p>
          </div>
          {/* One line, cut short with an ellipsis on a phone: a pill that wraps reads as two. */}
          <Link
            href="/changelog"
            title={version}
            className="font-figures max-w-full truncate rounded-full border border-border px-2.5 py-1 transition-colors hover:border-border-accent hover:text-fg"
          >
            {version}
          </Link>
        </div>
      </div>
    </footer>
  );
}
