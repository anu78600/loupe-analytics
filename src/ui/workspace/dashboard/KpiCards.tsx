"use client";

/**
 * KPI cards: the hero strip and the supporting grid. Each card shows the
 * value, the change versus the comparison period (coloured by whether that is
 * good for this KPI's direction), a sparkline and an optional target, and
 * opens the "How this is calculated" details when clicked.
 *
 * What the changes compare is said once, above the strip (ComparisonNote),
 * rather than on every card; a card names its own comparison only when it
 * differs from that, and every card's tooltip and accessible name carry it. Which KPIs show,
 * and in what order, is kpiLayoutOf(): the user's layout from the Customise
 * step, else the recommendation, where orderByGoal moves the heroes that
 * match the user's main goal to the front.
 */
import * as React from "react";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Minus, Target } from "lucide-react";
import type { KpiValue } from "@/engine/kpi/compute";
import type { KpiMeta } from "@/engine/session";
import { formatDelta, formatPointDelta, formatValue, isFlatChange } from "@/engine/core/format";
import { kpiLayoutOf, useWorkspace } from "@/store/workspace";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/ui/primitives/misc";
import { Tooltip } from "@/ui/primitives/tooltip";
import { Sparkline } from "@/ui/charts/Sparkline";
import { useCountUp, useFmt } from "@/ui/common/hooks";
import { kpiLabel } from "@/engine/core/labels";

const GOAL_GROUPS: Record<string, string[]> = {
  growth: ["Revenue", "Orders", "Customers", "Funnel", "Marketing", "Sales"],
  profit: ["Profitability", "Revenue", "Margin", "Cost"],
  retention: ["Customers", "Retention", "Churn", "Engagement"],
  efficiency: ["Fulfilment", "Operations", "Inventory", "Funnel", "Marketing", "Efficiency"],
};

export function orderByGoal(ids: string[], metas: Map<string, KpiMeta>, goal?: string): string[] {
  if (!goal) return ids;
  const groups = GOAL_GROUPS[goal] ?? [];
  const rank = (id: string) => {
    const g = metas.get(id)?.group ?? "";
    const i = groups.findIndex((x) => g.toLowerCase().includes(x.toLowerCase()));
    return i < 0 ? 99 : i;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b));
}

export function DeltaChip({
  meta,
  value,
  size = "md",
}: {
  meta: KpiMeta;
  value: KpiValue;
  size?: "sm" | "md";
}) {
  const fmt = useFmt();
  const pct = meta.format === "percent";
  const change = pct ? value.deltaAbs : value.delta;
  // Nothing in the selection: say so, rather than a change against an empty period.
  if (value.rows === 0) return <span className="text-2xs text-fg-subtle">No rows in this selection</span>;
  if (change === null || change === undefined || !Number.isFinite(change)) {
    return <span className="text-2xs text-fg-subtle">{value.comparisonLabel || "No comparison"}</span>;
  }
  const flat = isFlatChange(change);
  const up = change > 0;
  const good = meta.direction === "neutral" || flat ? null : up === (meta.direction === "higher");
  const tone =
    good === null
      ? "text-fg-muted bg-surface-3"
      : good
        ? "text-success bg-success-soft"
        : "text-danger bg-danger-soft";
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const text = pct ? formatPointDelta(change, fmt.locale) : formatDelta(change, fmt.locale);
  const verdict = good === null ? "" : good ? ", an improvement" : ", a deterioration";
  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-0.5 rounded-full font-medium",
        tone,
        size === "sm" ? "h-5 px-1.5 text-2xs" : "h-6 px-2 text-ui",
      )}
      aria-label={`${text} ${value.comparisonLabel}${verdict}`}
    >
      <Icon className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden />
      {text}
    </span>
  );
}

/** The comparison most cards share (and, for all-time cards, the month they compare), for the note above the strip. */
export function sharedComparison(values: readonly KpiValue[]): { label: string; current: string } | null {
  const counts = new Map<string, number>();
  for (const v of values)
    if ((v.delta !== null || v.deltaAbs !== null) && v.comparisonLabel) {
      const key = `${v.currentLabel ?? ""}\u0000${v.comparisonLabel}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const [current = "", label = ""] = top[0].split("\u0000");
  return { label, current };
}

/** "Change vs 1 Jan – 31 Dec 2024", or for all-time cards "Change: May 2026 vs May 2025". */
export function ComparisonNote() {
  const batch = useWorkspace((s) => s.kpiBatch);
  const shared = batch ? sharedComparison(batch.values) : null;
  if (!shared) return null;
  return (
    <p className="text-2xs text-fg-subtle">
      {shared.current ? `Change: ${shared.current} ${shared.label}` : `Change ${shared.label}`}
    </p>
  );
}

export function KpiCard({
  meta,
  value,
  index,
  shared,
}: {
  meta: KpiMeta;
  value: KpiValue | undefined;
  index: number;
  /** The comparison stated above the strip; the card repeats only one that differs. */
  shared?: { label: string; current: string } | null;
}) {
  const fmt = useFmt();
  const target = useWorkspace((s) => s.kpiTargets[meta.id]);
  const select = useWorkspace((s) => s.select);
  const selected = useWorkspace((s) => s.selected?.type === "kpi" && s.selected.id === meta.id);
  const shown = useCountUp(value?.value ?? null);
  const compact =
    meta.format === "currency" || (meta.format !== "percent" && Math.abs(value?.value ?? 0) >= 100000);
  // With no rows in the selection there is nothing to measure: "—", not a total of zero.
  const noRows = value?.rows === 0;
  const display = noRows ? "—" : formatValue(shown, meta.format, { ...fmt, compact });
  const full = noRows ? "No rows in this selection" : formatValue(value?.value ?? null, meta.format, fmt);
  const progress =
    target && value?.value !== null && value?.value !== undefined ? value.value / target : null;
  return (
    <motion.button
      type="button"
      onClick={() => select({ type: "kpi", id: meta.id })}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, type: "spring", stiffness: 380, damping: 32 }}
      className={cn(
        "group relative flex min-w-0 flex-col rounded-card border bg-surface-1 p-4 text-left shadow-card transition-[border-color,box-shadow] duration-200 hover:border-border-accent",
        selected ? "border-accent shadow-[0_0_0_3px_var(--accent-soft)]" : "border-border",
      )}
      title={`${meta.name}: ${full}${value?.comparisonLabel ? ` · change ${value.currentLabel ? `${value.currentLabel} ` : ""}${value.comparisonLabel}` : ""}`}
    >
      <span className="sr-only">Open details: </span>
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-ui font-medium text-fg-muted" title={meta.name}>
          {kpiLabel(meta)}
        </p>
        {meta.caveat ? (
          <Tooltip content={meta.caveat}>
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-warning" aria-label="Has a caveat" />
          </Tooltip>
        ) : null}
      </div>
      {value ? (
        <>
          <p
            className="tabular mt-2 truncate text-[26px] leading-none font-semibold tracking-[-0.025em] text-fg md:text-[28px]"
            title={full}
          >
            {display}
          </p>
          <div className="mt-2.5 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
            <DeltaChip meta={meta} value={value} />
            {/* The comparison is said once above the strip; a card names its own only when it differs. */}
            {(value.delta !== null || value.deltaAbs !== null) &&
            (value.comparisonLabel !== shared?.label || (value.currentLabel ?? "") !== shared?.current) ? (
              <span className="line-clamp-2 text-2xs text-fg-subtle" title={value.comparisonLabel}>
                {value.currentLabel ? `${value.currentLabel} ` : ""}
                {value.comparisonLabel}
              </span>
            ) : null}
          </div>
          {noRows ? null : (
            <div className="-mx-1 mt-3">
              <Sparkline
                values={value.spark.map((p) => p.v)}
                partialLast={value.partialLast}
                label={`${meta.name} trend`}
              />
            </div>
          )}
          {progress !== null ? (
            <div className="mt-2">
              <div className="flex items-center justify-between text-2xs text-fg-subtle">
                <span className="inline-flex items-center gap-1">
                  <Target className="size-3" aria-hidden /> Target{" "}
                  {formatValue(target ?? null, meta.format, { ...fmt, compact: true })}
                </span>
                <span className="font-figures">{Math.round(progress * 100)}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
                <div
                  className={cn(
                    "h-full rounded-full",
                    (meta.direction === "lower" ? progress <= 1 : progress >= 1) ? "bg-success" : "bg-accent",
                  )}
                  style={{ width: `${Math.min(100, progress * 100)}%` }}
                />
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-2 grid gap-2">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}
    </motion.button>
  );
}

/**
 * Columns of the hero strip by how many KPIs it holds, chosen from the
 * strip's own width (container queries), so its rows are always balanced:
 * six in one row when there is room, else three and three; never five and
 * one left alone on a second row.
 */
const STRIP_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 @md:grid-cols-2",
  3: "grid-cols-1 @2xl:grid-cols-3",
  4: "grid-cols-2 @4xl:grid-cols-4",
  5: "grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-5",
  6: "grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-6",
};

export function KpiStrip() {
  const context = useWorkspace((s) => s.context);
  const batch = useWorkspace((s) => s.kpiBatch);
  const goal = useWorkspace((s) => s.business.goal);
  const own = useWorkspace((s) => s.kpiLayout);
  const extra = useWorkspace((s) => s.extraKpis);
  if (!context) return null;
  const metas = new Map(context.kpis.map((k) => [k.id, k]));
  const values = new Map(batch?.values.map((v) => [v.id, v]) ?? []);
  const hero = kpiLayoutOf({ context, kpiLayout: own, extraKpis: extra }).hero;
  // The user's own order stands as set; the recommended heroes follow the user's main goal.
  const ids = own ? hero : orderByGoal(hero, metas, goal);
  const shared = batch ? sharedComparison(batch.values) : null;
  if (!ids.length) return null;
  return (
    <div className="@container">
      <section
        aria-label="Key performance indicators"
        className={cn("grid gap-3", STRIP_COLS[ids.length] ?? STRIP_COLS[6])}
      >
        {ids.map((id, i) => {
          const meta = metas.get(id);
          return meta ? (
            <KpiCard key={id} meta={meta} value={values.get(id)} index={i} shared={shared} />
          ) : null;
        })}
      </section>
    </div>
  );
}

export function SupportingKpis() {
  const context = useWorkspace((s) => s.context);
  const own = useWorkspace((s) => s.kpiLayout);
  const extra = useWorkspace((s) => s.extraKpis);
  if (!context) return null;
  const ids = kpiLayoutOf({ context, kpiLayout: own, extraKpis: extra }).supporting;
  return <KpiTiles ids={ids} label="Supporting KPIs" />;
}

/** Compact KPI tiles (value, change and its window); used for supporting KPIs and the your-column KPIs. */
export function KpiTiles({ ids, label }: { ids: string[]; label: string }) {
  const context = useWorkspace((s) => s.context);
  const batch = useWorkspace((s) => s.kpiBatch);
  const select = useWorkspace((s) => s.select);
  const fmt = useFmt();
  if (!context || !ids.length) return null;
  const metas = new Map(context.kpis.map((k) => [k.id, k]));
  const values = new Map(batch?.values.map((v) => [v.id, v]) ?? []);
  return (
    <section
      aria-label={label}
      // Tiles of one width on an even grid, so a short last row doesn't stretch its tiles.
      className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2"
    >
      {ids.map((id) => {
        const meta = metas.get(id);
        const v = values.get(id);
        if (!meta) return null;
        return (
          <button
            key={id}
            type="button"
            onClick={() => select({ type: "kpi", id })}
            title={
              v?.comparisonLabel
                ? `Change ${v.currentLabel ? `${v.currentLabel} ` : ""}${v.comparisonLabel}`
                : meta.name
            }
            className="flex min-w-0 flex-col items-start gap-1 rounded-card border border-border bg-surface-1 px-3.5 py-3 text-left transition-colors hover:border-border-accent hover:bg-surface-2"
          >
            <span className="w-full truncate text-2xs text-fg-muted" title={meta.name}>
              {meta.name}
            </span>
            <span className="tabular truncate text-base font-semibold tracking-[-0.01em] text-fg">
              {v ? (
                v.rows === 0 ? (
                  "—"
                ) : (
                  formatValue(v.value, meta.format, {
                    ...fmt,
                    compact: meta.format !== "percent" && meta.format !== "ratio",
                  })
                )
              ) : (
                <Skeleton className="h-5 w-16" />
              )}
            </span>
            {v ? <DeltaChip meta={meta} value={v} size="sm" /> : null}
          </button>
        );
      })}
    </section>
  );
}
