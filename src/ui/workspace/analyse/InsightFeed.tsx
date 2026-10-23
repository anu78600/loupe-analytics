"use client";

/**
 * The Insights step's ranked feed (version 50.4): compact cards ranked #1…n
 * by the rules engine's impact score, each with its tone's icon, its title,
 * its figures in a sentence clamped to two lines (the whole of it on hover,
 * focus or a long press), a thin impact bar drawing the engine's own 0–100
 * score, and its tags (kind, tone, confidence) kept small, with how it was
 * found behind the ⓘ.
 *
 * From xl the feed is the master list of a master-detail view: a card's
 * title is the button that selects it (its chart shows in the panel beside
 * the feed, analyse/InsightDetail.tsx), and the arrow keys, Home and End move
 * the selection, which the focus follows (only the selected card is a Tab
 * stop). Below xl there is no panel: the feed is one column and each card
 * keeps its "View chart", which opens the chart on the dashboard.
 *
 * Every figure here is the engine's, computed from the data; nothing is
 * written or estimated in the interface.
 */
import * as React from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  CircleDot,
  Layers,
  PieChart,
  Scale,
  Split,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { INSIGHT_KIND_LABEL, type Insight, type InsightKind } from "@/engine/insights/insights";
import { useWorkspace } from "@/store/workspace";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/primitives/button";
import { Skeleton } from "@/ui/primitives/misc";
import { ClampText, InfoTip } from "@/ui/primitives/reveal";
import { impactPercent } from "./feed";

/** Each kind's name and icon. */
export const KIND: Record<InsightKind, { label: string; icon: LucideIcon }> = {
  trend: { label: INSIGHT_KIND_LABEL.trend, icon: Activity },
  anomaly: { label: INSIGHT_KIND_LABEL.anomaly, icon: Waves },
  concentration: { label: INSIGHT_KIND_LABEL.concentration, icon: PieChart },
  seasonality: { label: INSIGHT_KIND_LABEL.seasonality, icon: CalendarRange },
  segment: { label: INSIGHT_KIND_LABEL.segment, icon: Split },
  driver: { label: INSIGHT_KIND_LABEL.driver, icon: Scale },
  mix: { label: INSIGHT_KIND_LABEL.mix, icon: Layers },
  caveat: { label: INSIGHT_KIND_LABEL.caveat, icon: AlertTriangle },
};

/** Each tone's name, icon, chip (the icon in its fill colour on the tint) and text colour, as the dashboard draws them. */
export const TONE: Record<Insight["tone"], { label: string; icon: LucideIcon; chip: string; text: string }> =
  {
    positive: {
      label: "Positive",
      icon: ArrowUpRight,
      chip: "text-success bg-success-soft",
      text: "text-success-text",
    },
    negative: {
      label: "Negative",
      icon: ArrowDownRight,
      chip: "text-danger bg-danger-soft",
      text: "text-danger-text",
    },
    neutral: { label: "Note", icon: CircleDot, chip: "text-fg-muted bg-surface-3", text: "text-fg-muted" },
    warning: {
      label: "Watch",
      icon: AlertTriangle,
      chip: "text-warning bg-warning-soft",
      text: "text-warning-text",
    },
  };

/** The engine's impact score as a thin bar, read out as "Impact 72 of 100". */
export function ImpactMeter({ impact, className }: { impact: number; className?: string }) {
  const value = Math.round(impactPercent(impact));
  return (
    <span
      role="meter"
      aria-label="Impact"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={`${value} of 100`}
      title={`Impact ${value} of 100`}
      className={cn("block h-1 w-14 shrink-0 overflow-hidden rounded-full bg-surface-3", className)}
    >
      <span className="block h-full rounded-full bg-accent" style={{ width: `${value}%` }} />
    </span>
  );
}

/** The card's small print: kind, tone and (from sm) confidence, with how it was found behind the ⓘ. */
function Tags({ insight }: { insight: Insight }) {
  const tone = TONE[insight.tone];
  return (
    <span className="relative z-10 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-fg-subtle">
      <span className="text-fg-muted">{KIND[insight.kind].label}</span>
      <span aria-hidden>·</span>
      <span className={tone.text}>{tone.label}</span>
      <span aria-hidden className="max-sm:hidden">
        ·
      </span>
      <span className="max-sm:hidden">{insight.confidence} confidence</span>
      <InfoTip label="How this was found">
        <span className="font-medium">How this was found</span> ({insight.confidence} confidence):{" "}
        {insight.basis}
      </InfoTip>
    </span>
  );
}

export function InsightCard({
  insight,
  rank,
  selectable,
  selected,
  onSelect,
}: {
  insight: Insight;
  rank: number;
  /** From xl: the title selects the card, and the chart shows beside the feed. */
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const focusChart = useWorkspace((s) => s.focusChart);
  const tone = TONE[insight.tone];
  return (
    <motion.li
      data-insight
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(rank, 10) * 0.03, duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      <article
        aria-labelledby={`insight-title-${insight.id}`}
        className={cn(
          "relative flex gap-3.5 rounded-card border bg-surface-1 p-4 shadow-card transition-[border-color,background-color] duration-fast",
          selectable && selected
            ? "border-border-accent bg-[image:linear-gradient(var(--surface-selected),var(--surface-selected))]"
            : "border-border",
          selectable && !selected && "hover:border-border-hover",
        )}
      >
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <span className={cn("grid size-8 place-items-center rounded-control", tone.chip)}>
            <tone.icon className="size-4" aria-hidden />
          </span>
          <span aria-hidden className="font-figures text-xs text-fg-subtle">
            #{rank}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 id={`insight-title-${insight.id}`} className="text-md font-medium text-pretty text-fg">
            <span className="sr-only">
              Rank {rank}, {tone.label}:{" "}
            </span>
            {selectable ? (
              // The whole card answers the click (the button's box covers it); the controls inside sit above it.
              <button
                type="button"
                id={`insight-select-${insight.id}`}
                data-select
                tabIndex={selected ? 0 : -1}
                aria-current={selected ? "true" : undefined}
                aria-controls="insight-detail"
                onClick={onSelect}
                className="text-left outline-none after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:after:shadow-[var(--shadow-focus)]"
              >
                {insight.title}
              </button>
            ) : (
              insight.title
            )}
          </h2>
          {/* Two lines; below xl the rest opens on hover, focus or a long press, and from xl in the panel. */}
          <ClampText key={insight.body} lines={2} className="mt-1 text-sm text-fg-muted">
            {insight.body}
          </ClampText>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <ImpactMeter impact={insight.impact} />
            <Tags insight={insight} />
            {!selectable && insight.chartId ? (
              <Button
                size="xs"
                variant="outline"
                className="relative z-10 ml-auto"
                onClick={() => focusChart(insight.chartId as string)}
              >
                View chart
              </Button>
            ) : null}
          </div>
        </div>
      </article>
    </motion.li>
  );
}

/** Placeholders in the shape of the feed's cards, while the insights are worked out. */
export function FeedSkeleton({ count = 5 }: { count?: number }) {
  return (
    <ol aria-hidden className="grid gap-3">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex gap-3.5 rounded-card border border-border bg-surface-1 p-4 shadow-card">
          <div className="flex flex-col items-center gap-1.5">
            <Skeleton className="size-8" />
            <Skeleton className="h-3 w-5" />
          </div>
          <div className="grid flex-1 content-start gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-2/3" />
            <div className="mt-1.5 flex items-center gap-3">
              <Skeleton className="h-1 w-14 rounded-full" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
