"use client";

/**
 * Insights made easy to read (version 54.0).
 *
 * InsightPoints: an insight's bullet points (Insight.points), one fact with
 * its figure each, for the feed card and the detail panel.
 *
 * InsightPeek: for analysts who switch it on (Settings › Insights, or the
 * switch beside the insight tabs), hovering or focusing an insight shows the
 * chart it describes beside it (InsightChart), so the figures can be checked
 * against the picture without leaving the list. Off by default, and off for
 * an insight with no chart. The chart is the dashboard's own, for the same
 * selection.
 */
import * as React from "react";
import { HoverCard } from "radix-ui";
import type { Insight } from "@/engine/insights/insights";
import { useSettings } from "@/store/settings";
import { cn } from "@/lib/utils";
import { InsightChart } from "./InsightChart";

export function InsightPoints({
  points,
  max,
  className,
}: {
  points: readonly string[];
  /** Shows at most this many (the feed card shows three). */
  max?: number;
  className?: string;
}) {
  const shown = max ? points.slice(0, max) : points;
  if (!shown.length) return null;
  return (
    <ul className={cn("grid gap-1 text-sm text-fg-muted", className)}>
      {shown.map((p) => (
        <li key={p} className="flex gap-2">
          <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-fg-subtle" />
          <span className="min-w-0">{p}</span>
        </li>
      ))}
    </ul>
  );
}

/** The insight's chart beside it on hover or focus, when the analyst has it switched on. */
export function InsightPeek({ insight, children }: { insight: Insight; children: React.ReactElement }) {
  const on = useSettings((s) => s.insightChartOnHover);
  if (!on || !insight.chartId) return children;
  return (
    <HoverCard.Root openDelay={350} closeDelay={120}>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="right"
          align="start"
          sideOffset={12}
          collisionPadding={16}
          className="z-50 w-[min(30rem,calc(100vw-2rem))] rounded-card border border-border bg-surface-overlay p-3 shadow-pop"
        >
          <InsightChart chartId={insight.chartId} action={null} height="h-52" />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
