"use client";

/**
 * KPI cards: the hero strip and the supporting grid. Each card shows the
 * value, the change versus the comparison period (coloured by whether that is
 * good for this KPI's direction), a sparkline and an optional target, and
 * opens the "How this is calculated" details when clicked.
 *
 * What the changes compare is said once, above the strip (ComparisonNote),
 * rather than on every card; a card names its own comparison only when it
 * differs from that, and every card's tooltip and accessible name carry it.
 * When there is no change to show (a roster, where the date marks when each
 * employee started), the reason is said once above the cards too. When a
 * change describes a narrower window than the card's number (all time, or a
 * like-for-like window), the card shows that window's own value beside it:
 * "September 2026: ₹37.9L ↗ +46.9%". A change from zero has no percentage;
 * the chip says "from 0". Sparklines are left off a roster's cards: plotted
 * by start date they would read as a trend. Which KPIs show, and in what
 * order, is kpiLayoutOf(): the user's layout from the Customise step, else
 * the recommendation, where orderByGoal moves the heroes that match the
 * user's main goal to the front.
 */
import * as React from "react";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Minus, Target } from "lucide-react";
import type { KpiValue } from "@/engine/kpi/compute";
import type { KpiMeta } from "@/engine/session";
import { formatDelta, formatPointDelta, formatValue, isFlatChange } from "@/engine/core/format";
import { formatKpi, kpiCompact } from "@/ui/common/kpiFormat";
import { isRosterView, kpiLayoutOf, useWorkspace } from "@/store/workspace";
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
  shared,
}: {
  meta: KpiMeta;
  value: KpiValue;
  size?: "sm" | "md";
  /** The comparison stated once above the cards: a card with no change doesn't repeat it. */
  shared?: string;
}) {
  const fmt = useFmt();
  const pct = meta.format === "percent";
  const relative = pct ? value.deltaAbs : value.delta;
  // Nothing in the selection: say so, rather than a change against an empty period.
  if (value.rows === 0) return <span className="text-xs text-fg-subtle">No rows in this selection</span>;
  // From zero a relative change has no base: the chip shows the direction and "from 0" instead of
  // a percentage (and never the comparison's dates, which read like a change in the chip's place).
  const fromZero =
    (relative === null || relative === undefined) && value.previous === 0 && value.current !== null;
  const change = fromZero ? (value.current as number) : relative;
  if (change === null || change === undefined || !Number.isFinite(change)) {
    // A comparison window with no value for this KPI, or no comparison at all (the reason why).
    const reason =
      value.previous === null && value.comparisonLabel.startsWith("vs ")
        ? "No value to compare with"
        : value.comparisonLabel || "No comparison";
    return reason === shared ? null : (
      <span className="text-xs text-fg-subtle" title={value.comparisonLabel || undefined}>
        {reason}
      </span>
    );
  }
  const flat = fromZero ? change === 0 : isFlatChange(change);
  const up = change > 0;
  const good = meta.direction === "neutral" || flat ? null : up === (meta.direction === "higher");
  // On a status tint the words take the status's text step, made for that tint (≥ 4.5:1 in both themes).
  const tone =
    good === null
      ? "text-fg-muted bg-surface-3"
      : good
        ? "text-success-text bg-success-soft"
        : "text-danger-text bg-danger-soft";
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const text = fromZero
    ? flat
      ? "No change"
      : "from 0"
    : pct
      ? formatPointDelta(change, fmt.locale)
      : formatDelta(change, fmt.locale);
  const verdict = good === null ? "" : good ? ", an improvement" : ", a deterioration";
  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-0.5 rounded-full font-medium",
        tone,
        // One chip size of text (12 px, tabular), a step taller beside a big figure.
        size === "sm" ? "h-5 px-1.5 text-xs" : "h-6 px-2 text-xs",
      )}
      aria-label={`${text} ${value.comparisonLabel}${verdict}`}
    >
      <Icon className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden />
      {text}
    </span>
  );
}

/**
 * The comparison most cards share (and, for all-time cards, the month they
 * compare), for the note above the strip. When no card has a change (a
 * roster: "All employees in the file · no period comparison"), the reason
 * they share, with `changes` false, so it is said once rather than on every card.
 */
export function sharedComparison(
  values: readonly KpiValue[],
): { label: string; current: string; changes?: boolean } | null {
  const counts = new Map<string, number>();
  for (const v of values)
    if ((v.delta !== null || v.deltaAbs !== null) && v.comparisonLabel) {
      const key = `${v.currentLabel ?? ""}\u0000${v.comparisonLabel}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) {
    const [current = "", label = ""] = top[0].split("\u0000");
    return { label, current, changes: true };
  }
  const reasons = new Map<string, number>();
  for (const v of values)
    if (v.comparisonLabel && v.rows > 0)
      reasons.set(v.comparisonLabel, (reasons.get(v.comparisonLabel) ?? 0) + 1);
  const reason = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
  return reason ? { label: reason[0], current: "", changes: false } : null;
}

/**
 * "Change vs 1 Jan – 31 Dec 2024", or for all-time cards "Change: May 2026
 * vs May 2025"; with no changes at all, why ("All employees in the file · no
 * period comparison").
 */
export function ComparisonNote() {
  const batch = useWorkspace((s) => s.kpiBatch);
  const shared = batch ? sharedComparison(batch.values) : null;
  if (!shared) return null;
  return (
    <p className="text-xs text-fg-subtle">
      {!shared.changes
        ? shared.label
        : shared.current
          ? `Change: ${shared.current} ${shared.label}`
          : `Change ${shared.label}`}
    </p>
  );
}

export function KpiCard({
  meta,
  value,
  index,
  shared,
  roster = false,
}: {
  meta: KpiMeta;
  value: KpiValue | undefined;
  index: number;
  /** The comparison stated above the strip; the card repeats only one that differs. */
  shared?: { label: string; current: string; changes?: boolean } | null;
  /** A roster view: the dates mark when each entity started, so there is no trend line to draw. */
  roster?: boolean;
}) {
  const fmt = useFmt();
  const target = useWorkspace((s) => s.kpiTargets[meta.id]);
  const select = useWorkspace((s) => s.select);
  const selected = useWorkspace((s) => s.selected?.type === "kpi" && s.selected.id === meta.id);
  const shown = useCountUp(value?.value ?? null);
  // The shared KPI rule (ui/common/kpiFormat, as the slides and the report write KPIs), decided once
  // from the card's own value: the count-up never flips units mid-way, and the figures under it (its
  // window's value, the "from" base) keep the units of the number above them.
  const compact = kpiCompact(meta.format, value?.value);
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
        "group @container/kpi relative flex min-w-0 flex-col rounded-card border bg-surface-1 p-4 text-left shadow-card transition-[border-color,box-shadow] duration-fast",
        // The one being inspected: an accent edge and a soft ring, drawn with the card's shadow.
        selected ? "border-accent ring-3 ring-accent-soft" : "border-border hover:border-border-hover",
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
          {/* The hero figure, sized by the card's own width (the longest values, "−₹3.13Cr", are about
              4.4 em): 24 px on a narrow card, 30 px from six across a desktop strip, 36 px on wide cards. */}
          <p
            className="font-figures mt-2.5 truncate text-2xl leading-none font-semibold text-fg @[8.5rem]/kpi:text-3xl @[14rem]/kpi:text-4xl"
            title={full}
          >
            {display}
          </p>
          <div className="mt-2.5 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
            {/* When the change describes a narrower window than the number above (all time, like
                for like), that window's own value comes first, so the change never sits under a
                number it doesn't describe: "September 2026: ₹37.9L ↗ +46.9% from ₹25.8L". */}
            {!noRows && value.currentLabel && value.current !== null ? (
              <span className="tabular text-xs text-fg-muted">
                {value.currentLabel}:{" "}
                <span className="text-fg">
                  {formatValue(value.current, meta.format, { ...fmt, compact })}
                </span>
              </span>
            ) : null}
            <DeltaChip meta={meta} value={value} shared={shared?.changes ? undefined : shared?.label} />
            {/* What the change is measured from. */}
            {!noRows && value.previous !== null && value.delta !== null ? (
              <span className="tabular text-xs text-fg-subtle">
                from {formatValue(value.previous, meta.format, { ...fmt, compact })}
              </span>
            ) : null}
            {/* The comparison is said once above the strip; a card names its own only when it differs. */}
            {(value.delta !== null || value.deltaAbs !== null) &&
            (value.comparisonLabel !== shared?.label || (value.currentLabel ?? "") !== shared?.current) ? (
              <span className="line-clamp-2 text-xs text-fg-subtle" title={value.comparisonLabel}>
                {value.currentLabel ? `${value.currentLabel} ` : ""}
                {value.comparisonLabel}
              </span>
            ) : null}
          </div>
          {noRows || roster ? null : (
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
              <div className="flex items-center justify-between text-xs text-fg-subtle">
                <span className="inline-flex items-center gap-1">
                  <Target className="size-3" aria-hidden /> Target{" "}
                  {formatValue(target ?? null, meta.format, { ...fmt, compact: true })}
                </span>
                <span className="tabular">{Math.round(progress * 100)}%</span>
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
  const roster = isRosterView(context);
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
            <KpiCard key={id} meta={meta} value={values.get(id)} index={i} shared={shared} roster={roster} />
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
  // With no change on any card (a roster), the note above the cards says why once; tiles don't repeat it.
  const shared = batch ? sharedComparison(batch.values) : null;
  const noChangeReason = shared && !shared.changes ? shared.label : undefined;
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
            className="flex min-w-0 flex-col items-start gap-1 rounded-card border border-border bg-surface-1 px-3.5 py-3 text-left shadow-card transition-colors duration-fast hover:border-border-hover"
          >
            {/* Up to two lines, so a longer name ("Customer LTV (historical)") isn't cut off; the figures
                then sit at the foot, level with the rest of the row. */}
            <span className="line-clamp-2 w-full text-ui font-medium text-fg-muted" title={meta.name}>
              {meta.name}
            </span>
            <span className="font-figures mt-auto max-w-full truncate pt-0.5 text-xl leading-tight font-medium text-fg">
              {v ? (
                v.rows === 0 ? (
                  "—"
                ) : (
                  formatKpi(v.value, meta.format, fmt)
                )
              ) : (
                <Skeleton className="h-5 w-16" />
              )}
            </span>
            {/* As on the cards: the window a change describes, with its own value, when it isn't the tile's. */}
            {v && v.rows > 0 && v.currentLabel && v.current !== null ? (
              <span className="tabular w-full truncate text-xs text-fg-muted">
                {v.currentLabel}:{" "}
                <span className="text-fg">
                  {formatValue(v.current, meta.format, { ...fmt, compact: kpiCompact(meta.format, v.value) })}
                </span>
              </span>
            ) : null}
            {v ? <DeltaChip meta={meta} value={v} size="sm" shared={noChangeReason} /> : null}
          </button>
        );
      })}
    </section>
  );
}
