"use client";

/**
 * The one-page dashboard's insights (version 50.3), in a column beside the
 * charts rather than a strip under them: the dashboard's top findings, each
 * with its tone (a rise, a fall, something to watch, a note), its title and
 * the sentence that holds its figures. Live, a finding linked to a chart has
 * "View chart": a chart on the page is outlined where it sits, any other is
 * opened in All charts; the column's header leads to every insight.
 *
 * The title keeps to one line and the sentence with the figures to four:
 * the column is narrow, and four lines hold a sentence with both of its
 * periods ("… +40.5% vs ₹2.23Cr in 1 Oct 2024 – 30 Sep 2025."), which the
 * download, with no hover to open the rest, needs whole. Live, a cut text
 * opens whole on hover, focus or a long press (ClampText). Below lg the
 * column follows the charts as a list. Every figure is the insight's own.
 */
import * as React from "react";
import {
  ArrowRight,
  Lightbulb,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Insight } from "@/engine/insights/insights";
import { useWorkspace } from "@/store/workspace";
import { cn } from "@/lib/utils";
import { ClampText } from "@/ui/primitives/reveal";
import { PrintClamp } from "./PrintClamp";

const TONE: Record<Insight["tone"], { icon: LucideIcon; chip: string; label: string }> = {
  positive: { icon: TrendingUp, chip: "bg-success-soft text-success", label: "Positive" },
  negative: { icon: TrendingDown, chip: "bg-danger-soft text-danger", label: "Negative" },
  warning: { icon: TriangleAlert, chip: "bg-warning-soft text-warning", label: "Watch" },
  neutral: { icon: Lightbulb, chip: "bg-accent-soft text-accent", label: "Note" },
};

/** The first sentence of an insight's explanation, where its numbers are. */
export function firstSentence(text: string): string {
  const t = text.trim();
  return /^.+?[.!?](?=\s|$)/.exec(t)?.[0] ?? t;
}

export function PageInsights({
  insights,
  total,
  ready,
  live,
  onPage,
  onShow,
}: {
  insights: Insight[];
  /** How many insights the dashboard has in all (the column shows the top few). */
  total: number;
  /** True once the insights for this selection have been looked for. */
  ready: boolean;
  live: boolean;
  /** The ids of the charts on the page, so "View chart" can point at one in place. */
  onPage: ReadonlySet<string>;
  /** Outlines a chart on the page. */
  onShow: (id: string) => void;
}) {
  const focusChart = useWorkspace((s) => s.focusChart);
  const setStep = useWorkspace((s) => s.setStep);
  const list = React.useRef<HTMLOListElement>(null);
  // Live, on a short window, the list scrolls inside the column: its foot fades while there is more
  // below, so a cut line reads as "more" rather than as a fault. Set from the observer and the
  // scroll, never in the effect itself.
  const [more, setMore] = React.useState(false);
  React.useEffect(() => {
    const el = list.current;
    if (!el || !live) return;
    const check = () => setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener("scroll", check, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", check);
    };
  }, [live, insights]);
  return (
    <aside
      data-card="insights"
      aria-labelledby="page-insights-title"
      className="flex min-h-0 min-w-0 flex-col rounded-card border border-border bg-surface-1 shadow-card"
    >
      <header className="flex min-w-0 items-center gap-2 px-4 pt-3 pb-1">
        <Lightbulb className="size-4 shrink-0 text-accent" aria-hidden />
        <h3 id="page-insights-title" className="text-md font-medium text-fg">
          Insights
        </h3>
        {live && total ? (
          // Every insight, with how each was found, is a step of its own.
          <button
            type="button"
            onClick={() => setStep("insights")}
            className="tabular ml-auto inline-flex shrink-0 items-center gap-1 rounded-xs text-xs font-medium text-fg-muted outline-none hover:text-fg focus-visible:focus-ring"
          >
            {total > insights.length ? `All ${total}` : "Details"}
            <ArrowRight className="size-3" aria-hidden />
          </button>
        ) : total > insights.length ? (
          <span className="tabular ml-auto shrink-0 text-xs text-fg-subtle">
            Top {insights.length} of {total}
          </span>
        ) : null}
      </header>
      {insights.length ? (
        <ol
          ref={list}
          className={cn(
            "min-h-0 flex-1 px-4",
            live ? "overflow-y-auto" : "overflow-hidden",
            more && "[mask-image:linear-gradient(to_bottom,var(--bg)_calc(100%-2.5rem),transparent)]",
          )}
        >
          {insights.map((ins) => {
            const tone = TONE[ins.tone];
            const chart = ins.chartId;
            return (
              <li key={ins.id} className="flex gap-3 border-b border-border-subtle py-3 last:border-b-0">
                <span
                  className={cn("mt-px grid size-6 shrink-0 place-items-center rounded-full", tone.chip)}
                  title={tone.label}
                >
                  <tone.icon className="size-3.5" aria-hidden />
                  <span className="sr-only">{tone.label}: </span>
                </span>
                <div className="min-w-0 flex-1">
                  {live ? (
                    <>
                      <ClampText key={ins.title} className="text-ui font-medium text-fg">
                        {ins.title}
                      </ClampText>
                      {/* Clamped at four lines rather than ClampText's two (tailwind-merge keeps the last). */}
                      <ClampText
                        key={ins.plain}
                        lines={2}
                        className="mt-0.5 line-clamp-4 text-xs text-fg-muted"
                      >
                        {firstSentence(ins.plain)}
                      </ClampText>
                    </>
                  ) : (
                    <>
                      <p className="truncate text-ui font-medium text-fg">{ins.title}</p>
                      <PrintClamp
                        text={firstSentence(ins.plain)}
                        lines={4}
                        className="mt-0.5 text-xs text-fg-muted"
                      />
                    </>
                  )}
                  {live && chart ? (
                    <button
                      type="button"
                      onClick={() => (onPage.has(chart) ? onShow(chart) : focusChart(chart))}
                      className="mt-1 inline-flex items-center gap-1 rounded-xs text-xs font-medium text-accent-text outline-none hover:underline focus-visible:focus-ring"
                    >
                      View chart
                      <ArrowRight className="size-3" aria-hidden />
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="flex-1 px-4 py-3 text-ui text-fg-subtle">
          {live && !ready ? "Finding the key insights…" : "No insights stood out for this selection."}
        </p>
      )}
    </aside>
  );
}
