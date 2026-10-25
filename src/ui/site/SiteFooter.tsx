/**
 * Footer for the marketing pages. Shows the copyright (content/credits.ts)
 * and the current version from the version log (src/content/changelog.ts) so
 * visitors can see what changed and when. Its links to the home page's
 * sections are SectionLinks, so they scroll in place there (see
 * SectionLink.tsx). The Learn column leads into the glossary (/glossary),
 * and the Trust column ends with "Send feedback" (the feedback dialog).
 */
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Wordmark } from "@/ui/brand/logo";
import { CURRENT_RELEASE } from "@/content/changelog";
import { AUTHOR, copyrightLine } from "@/content/credits";
import { SectionLink } from "./SectionLink";
import { FeedbackLink } from "@/ui/common/feedback/FeedbackLink";

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
    title: "Learn",
    links: [
      { href: "/glossary", label: "Glossary" },
      { href: "/glossary#basics", label: "Data basics" },
      { href: "/glossary#charts", label: "Chart types" },
      { href: "/glossary#industries", label: "Industry KPIs" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/#privacy", label: "Privacy" },
      { href: "/#faq", label: "FAQ" },
      { href: "/changelog", label: "What's new" },
    ],
  },
];

export function SiteFooter() {
  const version = `v${CURRENT_RELEASE.version} · ${CURRENT_RELEASE.title}`;
  return (
    <footer className="border-t border-border bg-bg-subtle">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-3 sm:px-6 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="grid content-start gap-4">
          <Wordmark />
          <p className="max-w-sm text-sm leading-relaxed text-fg-muted">
            Analyst-grade dashboards from clean data, with the working shown.
          </p>
          <p className="flex items-center gap-2 text-ui text-fg-muted">
            <ShieldCheck className="size-4 text-success" aria-hidden /> Your data never leaves your browser.
          </p>
        </div>
        {COLUMNS.map((col) => (
          // On a phone each link is a full 44 px row to tap; from sm the list is set closer.
          <nav key={col.title} aria-label={col.title} className="grid content-start sm:gap-3">
            <p className="eyebrow mb-1 text-fg-subtle sm:mb-0">{col.title}</p>
            {col.links.map((l) => (
              <SectionLink
                key={l.href}
                href={l.href}
                className="flex min-h-11 w-fit items-center text-ui text-fg-muted transition-colors duration-fast hover:text-fg sm:min-h-0"
              >
                {l.label}
              </SectionLink>
            ))}
            {/* Trust ends with the way to tell us about a problem or an idea (it opens the feedback dialog). */}
            {col.title === "Trust" ? (
              <FeedbackLink className="flex min-h-11 w-fit items-center rounded-sm text-left text-ui text-fg-muted transition-colors duration-fast hover:text-fg focus-visible:focus-ring sm:min-h-0" />
            ) : null}
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-fg-subtle sm:px-6">
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
            className="max-w-full truncate rounded-full border border-border px-2.5 py-1 transition-colors duration-fast hover:border-border-hover hover:text-fg"
          >
            {version}
          </Link>
        </div>
      </div>
    </footer>
  );
}
