"use client";

/**
 * One chapter of a guided-flow page (version 50.2): a small eyebrow label,
 * a heading and the chapter's content, in the page's one column. Detect
 * tells the data's story in five of them (what it is about, what it is
 * measured by, its columns, its industry, what to check), so the page reads
 * top to bottom as one account rather than as a grid of boxes.
 *
 * The heading row may carry controls at its end (the outcome select, a
 * "Show all" switch); on a phone they wrap under the heading. A chapter that
 * is being read again is aria-busy, with a small spinner for the eye.
 */
import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Chapter({
  eyebrow,
  title,
  tip,
  sub,
  aside,
  busy = false,
  hero = false,
  className,
  children,
}: {
  /** The chapter's label ("Outcome", "Columns"). */
  eyebrow: React.ReactNode;
  /** The chapter's heading: what it says, in a few words. */
  title: React.ReactNode;
  /** An ⓘ beside the heading (outside it, so the heading's name stays the heading). */
  tip?: React.ReactNode;
  /** One short line under the heading. */
  sub?: React.ReactNode;
  /** Controls at the end of the heading row. */
  aside?: React.ReactNode;
  /** The chapter's content is being worked out again. */
  busy?: boolean;
  /** The page's first chapter: a display heading. */
  hero?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const titleId = React.useId();
  return (
    <section aria-labelledby={titleId} aria-busy={busy || undefined} className={cn("min-w-0", className)}>
      {/* The heading grows into the row and gives way to the controls; below 24rem they wrap under it. */}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="max-w-3xl min-w-0 flex-[1_1_24rem]">
          <p className="eyebrow flex items-center gap-2 text-fg-subtle">
            {eyebrow}
            {/* The section is aria-busy meanwhile; the spinner is only for the eye. */}
            {busy ? <Loader2 className="size-3 animate-spin text-accent" aria-hidden /> : null}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <h2
              id={titleId}
              className={cn(
                "min-w-0 text-balance text-fg",
                hero ? "font-display text-display-xs" : "text-xl font-semibold",
              )}
            >
              {title}
            </h2>
            {tip}
          </div>
          {sub ? <div className={cn("mt-1 text-fg-muted", hero ? "text-md" : "text-sm")}>{sub}</div> : null}
        </div>
        {aside ? <div className="flex min-w-0 flex-wrap items-center gap-2">{aside}</div> : null}
      </div>
      {children ? <div className={hero ? "mt-6" : "mt-5"}>{children}</div> : null}
    </section>
  );
}
