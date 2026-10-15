"use client";

/**
 * Step 5, Insights: ranked findings from the rules engine, each with its
 * numbers, its basis and a link that jumps to the chart it describes. The
 * optional AI executive summary sits on top when the AI layer is switched on.
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
import type { Insight, InsightKind } from "@/engine/insights/insights";
import { PRESET_LABEL } from "@/engine/core/periods";
import { formatRange } from "@/engine/core/dates";
import { stepNumber, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { Card } from "@/ui/primitives/card";
import { Eyebrow, Skeleton } from "@/ui/primitives/misc";
import { ActiveFilters } from "./dashboard/FilterRail";
import { AiSummary } from "./AiSummary";

const KIND: Record<InsightKind, { label: string; icon: LucideIcon }> = {
  trend: { label: "Trend", icon: Activity },
  anomaly: { label: "Anomaly", icon: Waves },
  concentration: { label: "Concentration", icon: PieChart },
  seasonality: { label: "Seasonality", icon: CalendarRange },
  segment: { label: "Segment gap", icon: Split },
  driver: { label: "Driver", icon: Scale },
  mix: { label: "Mix effect", icon: Layers },
  caveat: { label: "Caveat", icon: AlertTriangle },
};

const TONE: Record<Insight["tone"], { label: string; className: string; icon: LucideIcon }> = {
  positive: { label: "Positive", className: "text-success bg-success-soft", icon: ArrowUpRight },
  negative: { label: "Negative", className: "text-danger bg-danger-soft", icon: ArrowDownRight },
  neutral: { label: "Note", className: "text-fg-muted bg-surface-3", icon: CircleDot },
  warning: { label: "Watch", className: "text-warning bg-warning-soft", icon: AlertTriangle },
};

export function InsightsStep() {
  const insights = useWorkspace((s) => s.insights);
  const loading = useWorkspace((s) => s.insightsLoading);
  const load = useWorkspace((s) => s.loadInsights);
  const preset = useWorkspace((s) => s.datePreset);
  const custom = useWorkspace((s) => s.customRange);
  const aiEnabled = useSettings((s) => s.ai.enabled);
  const [kind, setKind] = React.useState<InsightKind | "all">("all");
  React.useEffect(() => {
    if (!insights && !loading) void load();
  }, [insights, loading, load]);
  const kinds = [...new Set((insights ?? []).map((i) => i.kind))];
  const shown = (insights ?? []).filter((i) => kind === "all" || i.kind === kind);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Step {stepNumber("insights")} · Insights</Eyebrow>
          <h1 className="mt-2 font-display text-display-sm text-fg">What the data says</h1>
          <p className="mt-2 max-w-2xl text-ui text-fg-muted">
            Ranked by impact. Every number below was computed from your data for{" "}
            {preset === "custom" && custom
              ? formatRange(custom.from, custom.to)
              : PRESET_LABEL[preset].toLowerCase()}
            ; nothing is estimated or written by a model unless you ask for the optional AI summary.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />} Recompute
        </Button>
      </div>
      <div className="mb-4">
        <ActiveFilters inline />
      </div>
      {kinds.length > 1 ? (
        <div className="mb-5 flex flex-wrap gap-1.5" role="tablist" aria-label="Insight type">
          {(["all", ...kinds] as Array<InsightKind | "all">).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                "h-7 rounded-full border px-3 text-2xs font-medium transition-colors",
                kind === k
                  ? "border-border-accent bg-accent-soft text-fg"
                  : "border-border text-fg-muted hover:text-fg",
              )}
            >
              {k === "all" ? `All · ${insights?.length ?? 0}` : KIND[k].label}
            </button>
          ))}
        </div>
      ) : null}
      {aiEnabled && insights?.length ? <AiSummary insights={insights} /> : null}
      {loading && !insights ? (
        <div className="grid gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-card" />
          ))}
        </div>
      ) : shown.length ? (
        <ol className="grid gap-3">
          {shown.map((i, idx) => (
            <InsightCard key={i.id} insight={i} index={idx} />
          ))}
        </ol>
      ) : (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <Lightbulb className="size-6 text-fg-subtle" aria-hidden />
          <p className="text-sm text-fg">No material findings for this selection.</p>
          <p className="max-w-md text-ui text-fg-muted">
            Insights need enough history and volume to be meaningful. Widen the date range or remove filters,
            then recompute.
          </p>
        </Card>
      )}
    </div>
  );
}

function InsightCard({ insight, index }: { insight: Insight; index: number }) {
  const focusChart = useWorkspace((s) => s.focusChart);
  const k = KIND[insight.kind];
  const tone = TONE[insight.tone];
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.035, type: "spring", stiffness: 380, damping: 34 }}
    >
      <Card className="flex gap-4 p-5">
        <div className="flex flex-col items-center gap-2">
          <span className={cn("grid size-9 place-items-center rounded-[10px]", tone.className)}>
            <k.icon className="size-4" aria-hidden />
          </span>
          <span className="font-figures text-2xs text-fg-subtle" aria-label={`Rank ${index + 1}`}>
            #{index + 1}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="outline">{k.label}</Badge>
            <Badge className={tone.className}>
              <tone.icon aria-hidden />
              {tone.label}
            </Badge>
            <Badge tone="neutral">{insight.confidence} confidence</Badge>
          </div>
          <h2 className="mt-2 text-[15px] leading-snug font-medium text-fg">{insight.title}</h2>
          <p className="mt-1.5 text-ui leading-relaxed text-fg-muted">{insight.body}</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-2xs text-fg-subtle">Basis: {insight.basis}</p>
            {insight.chartId ? (
              <Button size="xs" variant="outline" onClick={() => focusChart(insight.chartId as string)}>
                View chart
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
    </motion.li>
  );
}
