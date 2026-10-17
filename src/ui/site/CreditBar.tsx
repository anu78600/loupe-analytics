/**
 * The credit bar above the site header on the marketing pages: "Crafted with
 * curiosity · Designed & developed by Anupam Mishra · © <year> Anupam Mishra.
 * All rights reserved."
 *
 * A server component rendered as a sibling just before SiteHeader (not
 * inside it), so it scrolls away while the navigation stays pinned, and so
 * the version log it reads the year from stays out of the client bundle.
 * It is a landmark of its own ("Credits"), so no page content sits outside
 * one. On phones it keeps the name and the year.
 */
import { Sparkles } from "lucide-react";
import { CURRENT_RELEASE } from "@/content/changelog";
import { AUTHOR, copyrightLine } from "@/content/credits";

function Dot({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`size-1 shrink-0 rounded-full bg-accent/60 ${className}`} />;
}

export function CreditBar() {
  const year = CURRENT_RELEASE.date.slice(0, 4);
  return (
    <aside aria-label="Credits" className="border-b border-border bg-bg-subtle">
      <p className="mx-auto flex h-9 max-w-6xl items-center justify-center gap-x-2.5 px-4 text-xs text-fg-subtle sm:px-6">
        <span className="hidden items-center gap-1.5 sm:inline-flex">
          <Sparkles className="size-3 text-accent" aria-hidden />
          <span className="text-sm text-accent">Crafted with curiosity</span>
        </span>
        <Dot className="hidden sm:block" />
        <span>
          Designed &amp; developed by <span className="font-medium text-fg">{AUTHOR}</span>
        </span>
        <Dot />
        <span className="hidden md:inline">{copyrightLine(CURRENT_RELEASE.date)}</span>
        <span className="md:hidden">© {year}</span>
      </p>
    </aside>
  );
}
