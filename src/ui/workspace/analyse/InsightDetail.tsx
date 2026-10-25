"use client";

/**
 * The Insights step's detail panel (version 50.4), beside the feed from xl:
 * the selected insight: its rank, kind and tone, its title, then since
 * version 54.0 its bullet points and the finding in plain words with its
 * numbers, with the analyst's detail folded below (the whole sentence of
 * figures, impact and confidence, how it was found); then the chart it
 * describes (InsightChart) and "Open on the dashboard" (focusChart).
 *
 * The chart is the dashboard's own: its spec, its type and Top N as the user
 * set them, and its data from the dashboard's last refresh (the store's
 * charts, computed for the same selection the insights describe). A chart
 * that isn't on the dashboard just now (hidden, or not in this layout) is
 * computed for the dashboard's selection under an id of its own, so the
 * dashboard's results stay as they are. It is drawn without the card's
 * actions and clicks, and without the card's element id, which focusChart
 * looks for on the dashboard. An insight without a chart keeps its full text
 * and figures here.
 */
import * as React from "react";
import { ArrowRight, LineChart } from "lucide-react";
import type { Insight } from "@/engine/insights/insights";
import { useWorkspace } from "@/store/workspace";
import { Button } from "@/ui/primitives/button";
import { Skeleton } from "@/ui/primitives/misc";
import { cn } from "@/lib/utils";
import { InsightChart } from "./InsightChart";
import { InsightPoints } from "./InsightPeek";
import { ImpactMeter, KIND, TONE } from "./InsightFeed";
import { impactPercent } from "./feed";

export function InsightDetail({ insight, rank }: { insight: Insight; rank: number }) {
  const focusChart = useWorkspace((s) => s.focusChart);
  const tone = TONE[insight.tone];
  const kind = KIND[insight.kind];
  return (
    <section
      id="insight-detail"
      aria-labelledby="insight-detail-title"
      className="overflow-hidden rounded-card border border-border bg-surface-1 shadow-card"
    >
      <div className="p-5">
        <p className="flex items-center gap-2 text-xs text-fg-subtle">
          <span className={cn("grid size-6 place-items-center rounded-sm", tone.chip)}>
            <tone.icon className="size-3.5" aria-hidden />
          </span>
          <span className="font-figures">#{rank}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1 text-fg-muted">
            <kind.icon className="size-3.5" aria-hidden />
            {kind.label}
          </span>
          <span aria-hidden>·</span>
          <span className={tone.text}>{tone.label}</span>
        </p>
        <h2 id="insight-detail-title" className="mt-3 text-lg font-semibold text-balance text-fg">
          {insight.title}
        </h2>
        <InsightPoints points={insight.points} className="mt-3" />
        <div className="mt-4 rounded-control bg-surface-2 px-3.5 py-3">
          <p className="eyebrow text-fg-subtle">In plain words</p>
          <p className="mt-1 text-sm leading-relaxed text-fg">{insight.plain}</p>
        </div>
        {/* What an analyst checks: the full sentence, how strong and how sure, and how it was found. */}
        <details className="group mt-4 border-t border-border-subtle pt-3">
          <summary className="cursor-pointer list-none text-xs font-medium text-fg-muted marker:hidden hover:text-fg focus-visible:focus-ring">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="transition-transform duration-fast group-open:rotate-90">
                ›
              </span>
              For analysts: the full finding and how it was found
            </span>
          </summary>
          <p className="mt-2 text-sm text-fg-muted">{insight.body}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-fg-subtle">Impact</dt>
            <dt className="text-fg-subtle">Confidence</dt>
            <dd className="flex items-center gap-2 text-fg">
              <ImpactMeter impact={insight.impact} className="w-20" />
              <span className="tabular">{Math.round(impactPercent(insight.impact))} of 100</span>
            </dd>
            <dd className="text-fg first-letter:uppercase">{insight.confidence}</dd>
          </dl>
          <p className="mt-3 text-xs text-fg-subtle">{`How it was found: ${insight.basis}`}</p>
        </details>
      </div>
      {insight.chartId ? (
        <div className="border-t border-border-subtle p-4">
          <InsightChart
            chartId={insight.chartId}
            action={
              <Button variant="secondary" size="xs" onClick={() => focusChart(insight.chartId as string)}>
                Open on the dashboard <ArrowRight aria-hidden />
              </Button>
            }
          />
        </div>
      ) : (
        <p className="flex items-center gap-2 border-t border-border-subtle px-5 py-4 text-xs text-fg-subtle">
          <LineChart className="size-3.5 shrink-0" aria-hidden />
          No chart shows this finding; its figures are above.
        </p>
      )}
    </section>
  );
}

/** Placeholders in the panel's shape (the finding, then its chart) while the insights are worked out. */
export function DetailSkeleton() {
  return (
    <div aria-hidden className="overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
      <div className="grid gap-2.5 p-5">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-1 h-5 w-3/4" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-5/6" />
        <div className="mt-3 grid grid-cols-2 gap-4 border-t border-border-subtle pt-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <div className="grid gap-2 border-t border-border-subtle p-4">
        <Skeleton className="h-3.5 w-48" />
        <Skeleton className="h-3 w-64" />
        <div className="mt-2 flex h-52 items-end gap-2 px-2">
          {[38, 52, 46, 61, 58, 72, 66, 80, 74, 88].map((h, i) => (
            <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
