"use client";

/**
 * Step 5, Insights: ranked findings from the rules engine, each with its
 * numbers, its basis and a link that jumps to the chart it describes. The
 * optional AI executive summary sits on top when the AI layer is switched on.
 *
 * Insights describe the dashboard's selection, said in words above them
 * ("for the last 12 months, 1 Oct 2025 – 30 Sep 2026"). While they are
 * recomputed for a new selection the list says so and is dimmed (or shows
 * placeholders the first time); a selection with no rows says that instead
 * of showing anything. Each insight keeps its overall rank when the list is
 * narrowed to one type.
 *
 * Text is kept short (version 47.0): the intro and the empty states are one
 * line with the full words behind them, each insight's body is clamped to two
 * lines, and how it was found sits behind the ⓘ beside its confidence
 * (ui/primitives/reveal: hover, focus or a long press opens them).
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
  Lightbulb,
  Loader2,
  PieChart,
  RefreshCw,
  Scale,
  Split,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { INSIGHT_KIND_LABEL, type Insight, type InsightKind } from "@/engine/insights/insights";
import { PRESET_LABEL, presetRange, type DatePreset } from "@/engine/core/periods";
import { formatRange } from "@/engine/core/dates";
import { stepNumber, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { Card } from "@/ui/primitives/card";
import { Eyebrow, Skeleton } from "@/ui/primitives/misc";
import { Brief, ClampText, InfoTip } from "@/ui/primitives/reveal";
import { ActiveFilters } from "./dashboard/FilterBar";
import { AiSummary } from "./AiSummary";

const KIND: Record<InsightKind, { label: string; icon: LucideIcon }> = {
  trend: { label: INSIGHT_KIND_LABEL.trend, icon: Activity },
  anomaly: { label: INSIGHT_KIND_LABEL.anomaly, icon: Waves },
  concentration: { label: INSIGHT_KIND_LABEL.concentration, icon: PieChart },
  seasonality: { label: INSIGHT_KIND_LABEL.seasonality, icon: CalendarRange },
  segment: { label: INSIGHT_KIND_LABEL.segment, icon: Split },
  driver: { label: INSIGHT_KIND_LABEL.driver, icon: Scale },
  mix: { label: INSIGHT_KIND_LABEL.mix, icon: Layers },
  caveat: { label: INSIGHT_KIND_LABEL.caveat, icon: AlertTriangle },
};

/** Each tone's icon chip (the icon in its fill colour on the tint) and the badge that names it. */
const TONE: Record<
  Insight["tone"],
  { label: string; chip: string; badge: "success" | "danger" | "neutral" | "warning"; icon: LucideIcon }
> = {
  positive: { label: "Positive", chip: "text-success bg-success-soft", badge: "success", icon: ArrowUpRight },
  negative: { label: "Negative", chip: "text-danger bg-danger-soft", badge: "danger", icon: ArrowDownRight },
  neutral: { label: "Note", chip: "text-fg-muted bg-surface-3", badge: "neutral", icon: CircleDot },
  warning: { label: "Watch", chip: "text-warning bg-warning-soft", badge: "warning", icon: AlertTriangle },
};

/** The selected period in words: "the last 12 months (1 Oct 2025 – 30 Sep 2026)", "all your data". */
function periodWords(
  preset: DatePreset,
  custom: { from: number; to: number } | null,
  bounds: { min: number; max: number } | null,
): string {
  if (preset === "custom" && custom) return formatRange(custom.from, custom.to);
  if (preset === "all" || !bounds)
    return bounds ? `all your data (${formatRange(bounds.min, bounds.max)})` : "all your data";
  const range = presetRange(preset, bounds);
  const name = PRESET_LABEL[preset].toLowerCase();
  return `the ${name}${range ? ` (${formatRange(range.from, range.to)})` : ""}`;
}

/** The selected period in a few words, without its dates: "the last 12 months", "all your data". */
function periodName(preset: DatePreset, custom: { from: number; to: number } | null): string {
  if (preset === "custom" && custom) return formatRange(custom.from, custom.to);
  if (preset === "all") return "all your data";
  return `the ${PRESET_LABEL[preset].toLowerCase()}`;
}

export function InsightsStep() {
  const insights = useWorkspace((s) => s.insights);
  const loading = useWorkspace((s) => s.insightsLoading);
  const computing = useWorkspace((s) => s.computing);
  const rows = useWorkspace((s) => s.lastCompute?.rows ?? null);
  const bounds = useWorkspace((s) => s.context?.dateBounds ?? null);
  const load = useWorkspace((s) => s.loadInsights);
  const preset = useWorkspace((s) => s.datePreset);
  const custom = useWorkspace((s) => s.customRange);
  const aiEnabled = useSettings((s) => s.ai.enabled);
  const [kind, setKind] = React.useState<InsightKind | "all">("all");
  React.useEffect(() => {
    if (!insights && !loading) void load();
  }, [insights, loading, load]);
  // Insights wait for the dashboard's refresh: until they match the selection they are being worked on.
  const updating = loading || computing || insights === null;
  const noRows = !updating && rows === 0;
  const kinds = [...new Set((insights ?? []).map((i) => i.kind))];
  const shown = (insights ?? []).filter((i) => kind === "all" || i.kind === kind);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Step {stepNumber("insights")} · Insights</Eyebrow>
          <h1 className="mt-2 font-display text-display-sm text-fg">What the data says</h1>
          {/* The period stays in view (it is the selection); the rest of the promise is behind it. */}
          <p className="mt-2 max-w-2xl text-sm text-fg-muted">
            <Brief
              label="About these insights"
              full={`Ranked by impact. Every number below was computed from your data for ${periodWords(preset, custom, bounds)}, with the filters below; nothing is estimated or written by a model unless you ask for the optional AI summary.`}
            >
              Ranked by impact, for {periodName(preset, custom)}.
            </Brief>
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={updating}>
          {updating ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />} Recompute
        </Button>
      </div>
      <div className="mb-4">
        <ActiveFilters inline />
      </div>
      <p className="sr-only" aria-live="polite">
        {updating
          ? "Updating insights for this selection…"
          : noRows
            ? "No rows match the current filters."
            : ""}
      </p>
      {updating && insights?.length ? (
        <p className="mb-3 flex items-center gap-2 text-xs text-fg-muted">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Updating for this selection…
        </p>
      ) : null}
      {kinds.length > 1 && !noRows ? (
        <div className="mb-5 flex flex-wrap gap-1.5" role="tablist" aria-label="Insight type">
          {(["all", ...kinds] as Array<InsightKind | "all">).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                "h-7 rounded-full border px-3 text-xs font-medium transition-colors",
                kind === k
                  ? "border-border-accent bg-surface-selected text-fg"
                  : "border-border text-fg-muted hover:border-border-hover hover:bg-surface-hover hover:text-fg",
              )}
            >
              {k === "all" ? `All · ${insights?.length ?? 0}` : KIND[k].label}
            </button>
          ))}
        </div>
      ) : null}
      {aiEnabled && insights?.length && !updating && !noRows ? <AiSummary insights={insights} /> : null}
      {noRows ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <Lightbulb className="size-6 text-fg-subtle" aria-hidden />
          <p className="text-md font-medium text-fg">No rows match the current filters.</p>
          <p className="max-w-md text-sm text-fg-muted">
            <Brief full="There is nothing to find in an empty selection. Remove a filter or widen the date range to see insights.">
              Remove a filter or widen the date range.
            </Brief>
          </p>
        </Card>
      ) : updating && !insights?.length ? (
        <div className="grid gap-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-card" />
          ))}
        </div>
      ) : shown.length ? (
        <ol
          className={cn("grid gap-3 transition-opacity", updating ? "opacity-disabled" : "")}
          aria-busy={updating}
        >
          {shown.map((i) => (
            // The overall rank, also when the list shows one type of insight.
            <InsightCard key={i.id} insight={i} rank={(insights ?? []).indexOf(i) + 1} />
          ))}
        </ol>
      ) : (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <Lightbulb className="size-6 text-fg-subtle" aria-hidden />
          <p className="text-md font-medium text-fg">No insights stand out for this selection.</p>
          <p className="max-w-md text-sm text-fg-muted">
            <Brief full="Insights need enough history and volume to be meaningful. Widen the date range or remove filters, then recompute.">
              Widen the date range or remove filters.
            </Brief>
          </p>
        </Card>
      )}
    </div>
  );
}

function InsightCard({ insight, rank }: { insight: Insight; rank: number }) {
  const focusChart = useWorkspace((s) => s.focusChart);
  const k = KIND[insight.kind];
  const tone = TONE[insight.tone];
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(rank, 12) * 0.035, type: "spring", stiffness: 380, damping: 34 }}
    >
      <Card className="flex gap-4 p-5">
        <div className="flex flex-col items-center gap-2">
          <span className={cn("grid size-9 place-items-center rounded-control", tone.chip)}>
            <k.icon className="size-4" aria-hidden />
          </span>
          <span className="font-figures text-2xs text-fg-subtle" aria-label={`Rank ${rank}`}>
            #{rank}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="outline">{k.label}</Badge>
            <Badge tone={tone.badge}>
              <tone.icon aria-hidden />
              {tone.label}
            </Badge>
            {/* On a phone the confidence joins the method behind the ⓘ, so the badges keep to one line. */}
            <Badge tone="neutral" className="hidden sm:inline-flex">
              {insight.confidence} confidence
            </Badge>
            {/* The method is the same for many insights; it sits behind the ⓘ rather than repeated on each. */}
            <InfoTip label="How this was found">
              <span className="font-medium">How this was found</span> ({insight.confidence} confidence):{" "}
              {insight.basis}
            </InfoTip>
          </div>
          <h2 className="mt-2.5 text-md font-medium text-fg">{insight.title}</h2>
          <ClampText key={insight.body} lines={2} className="mt-1 text-sm leading-relaxed text-fg-muted">
            {insight.body}
          </ClampText>
          {insight.chartId ? (
            <div className="mt-3 flex justify-end">
              <Button size="xs" variant="outline" onClick={() => focusChart(insight.chartId as string)}>
                View chart
              </Button>
            </div>
          ) : null}
        </div>
      </Card>
    </motion.li>
  );
}
