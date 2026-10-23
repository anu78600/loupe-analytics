"use client";

/**
 * The Export gallery's frame (version 50.4): a group of formats under a quiet
 * eyebrow, and the card each format sits in. A card opens with its preview
 * (the file in miniature, drawn from the real dashboard, previews.tsx and
 * PagePreview.tsx), then its title with the file types it makes, one line on
 * what it holds (the full text behind it, ui/primitives/reveal), a fact about
 * it, its options, and its download action at the foot.
 *
 * Three layouts:
 * - "stack": the preview above the text, in the gallery's grid (three to a
 *   row from xl, two from sm; a card left alone on a row of two takes the
 *   row, its preview beside its text);
 * - "featured": the one-page dashboard, the whole row wide, with the preview
 *   beside the text from lg (above it below lg);
 * - "wide": the settings file closing the page, a narrow preview beside the
 *   text from md, with its actions at the end of the line from xl.
 *
 * The preview's stage is a size container, so a drawing can be sized by its
 * stage (cqw, cqh) and stays in proportion from a phone to a wide screen.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { Brief } from "@/ui/primitives/reveal";

/** A group of formats: a quiet label and a hairline, as the dashboard's sections. */
export function GallerySection({
  id,
  title,
  className,
  children,
}: {
  id: string;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={className}>
      <div className="mb-4 flex items-center gap-3">
        <h2 id={id} className="eyebrow text-fg-subtle">
          {title}
        </h2>
        <span aria-hidden className="h-px flex-1 bg-border-subtle" />
      </div>
      {children}
    </section>
  );
}

/** The file types a card makes ("PNG", "PDF"), as small pills: labels in the eyebrow style, not code. */
export function FormatBadges({ formats }: { formats: readonly string[] }) {
  return (
    <ul aria-label="File types" className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      {formats.map((f) => (
        <li
          key={f}
          className="eyebrow rounded-full border border-border-strong px-2 py-0.5 whitespace-nowrap text-fg-subtle"
        >
          {f}
        </li>
      ))}
    </ul>
  );
}

type Layout = "stack" | "featured" | "wide";

/*
 * Beside the text, a stage is as tall as its row, stretched to it. The row's
 * least height is set on the card, never on the stage: a size container
 * whose height came from its own min-height would resolve its cqh as 0 in
 * Chrome, and the previews size themselves by it.
 */
const STAGE: Record<Layout, string> = {
  stack: "aspect-video border-b",
  featured: "aspect-video border-b lg:aspect-auto lg:border-r lg:border-b-0",
  wide: "aspect-[2/1] border-b md:aspect-auto md:border-r md:border-b-0",
};

const GRID: Record<Layout, string> = {
  stack: "flex flex-col",
  featured: "flex flex-col lg:grid lg:min-h-[340px] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]",
  wide: "flex flex-col md:grid md:min-h-[176px] md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]",
};

/**
 * A stacked card left alone on the last row of a two-column grid (sm to xl)
 * takes the whole row with its preview beside its text, rather than a
 * preview twice as tall as its neighbours'.
 */
const ALONE = {
  grid: "sm:max-xl:col-span-2 sm:max-xl:grid sm:max-xl:min-h-[240px] sm:max-xl:grid-cols-2",
  stage: "sm:max-xl:aspect-auto sm:max-xl:border-r sm:max-xl:border-b-0",
};

export function GalleryCard({
  layout = "stack",
  alone = false,
  stage = "well",
  title,
  line,
  full,
  formats,
  preview,
  fact,
  children,
  actions,
  className,
}: {
  layout?: Layout;
  /** A stacked card alone on its row between sm and xl (ALONE). */
  alone?: boolean;
  /**
   * What the preview stands on: "well", the sunken well code and data sit in;
   * "paper", for the files drawn as white paper, the same well in light and a
   * lighter tray in dark, so the paper doesn't glare against near-black.
   */
  stage?: "well" | "paper";
  title: string;
  /** What it holds, in a few words. */
  line: string;
  /** The whole description behind `line`. */
  full?: React.ReactNode;
  formats: readonly string[];
  /** The file in miniature (decorative: the text says what it holds). */
  preview: React.ReactNode;
  /** A real fact about the file: pages, slides, rows. */
  fact?: React.ReactNode;
  /** Options and notes, between the text and the action. */
  children?: React.ReactNode;
  /** The download buttons. */
  actions: React.ReactNode;
  className?: string;
}) {
  const id = React.useId();
  const featured = layout === "featured";
  return (
    <article
      aria-labelledby={id}
      className={cn(
        "group relative min-w-0 overflow-clip rounded-card border bg-surface-1 shadow-card",
        "transition-[border-color,box-shadow,translate] duration-base ease-out-quint hover:shadow-lift motion-safe:hover:-translate-y-0.5",
        featured ? "border-border-accent" : "border-border hover:border-border-hover",
        GRID[layout],
        alone && ALONE.grid,
        className,
      )}
    >
      <div
        className={cn(
          "[container-type:size] relative overflow-hidden border-border-subtle bg-bg-subtle",
          stage === "paper" && "dark:bg-surface-2",
          STAGE[layout],
          alone && ALONE.stage,
        )}
      >
        {preview}
      </div>
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          featured ? "p-5 sm:p-6 xl:p-8" : "p-5",
          // The settings card reads as one line from xl: its text, then its actions at the end.
          layout === "wide" &&
            "md:justify-center xl:flex-row xl:items-center xl:justify-between xl:gap-8 xl:px-8",
        )}
      >
        <div className="min-w-0">
          <div
            className={cn("flex items-start justify-between gap-3", layout === "wide" && "xl:justify-start")}
          >
            <h3 id={id} className={cn("min-w-0 font-medium text-fg", featured ? "text-xl" : "text-md")}>
              {title}
            </h3>
            <FormatBadges formats={formats} />
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            {full ? (
              <Brief label={`About ${title}`} full={full}>
                {line}
              </Brief>
            ) : (
              line
            )}
          </p>
          {fact ? <div className="tabular mt-2 text-xs text-fg-subtle">{fact}</div> : null}
          {children ? <div className="mt-4 grid min-w-0 gap-3">{children}</div> : null}
        </div>
        <div
          className={cn(
            "mt-auto flex flex-wrap items-center gap-2",
            featured ? "pt-6" : "pt-5",
            layout === "wide" && "md:mt-0 xl:shrink-0 xl:pt-0",
          )}
        >
          {actions}
        </div>
      </div>
    </article>
  );
}
