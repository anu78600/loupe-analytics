"use client";

/**
 * KPI cards: the hero row and the compact grid of the other KPIs (version
 * 50.3). A hero card is a raised card holding the KPI's icon chip and name,
 * its value, the change against the comparison period (coloured by whether
 * that is good for this KPI's direction) with "vs prev.", a sparkline along
 * its foot and an optional target; it opens the "How this is calculated"
 * details when clicked.
 *
 * What "prev." is, is said once, in the filter bar (ComparisonNote), rather
 * than on every card; a card names its own comparison only when it differs
 * from that, and every card's tooltip and accessible name carry it, with the
 * value it is measured from. When there is no change to show (a roster, where
 * the date marks when each employee started), the reason is said once too.
 * When a change describes a narrower window than the card's number (all
 * time, or a like-for-like window), the card shows that window's own value
 * beside it: "September 2026: ₹37.9L ↗ +46.9%". A change from zero has no
 * percentage; the chip says "from 0". Sparklines are left off a roster's
 * cards: plotted by start date they would read as a trend.
 *
 * The supporting KPIs, and the KPIs from the columns the template doesn't
 * use, are one compact panel of tiles (name, value, change) divided by
 * hairlines: one row of them, measured against the panel's width, and "Show
 * all N KPIs" for the rest. Which KPIs show, and in what order, is
 * kpiLayoutOf(): the user's layout from the Customise step, else the
 * recommendation, where orderByGoal moves the heroes that match the user's
 * main goal to the front.
 */
import * as React from "react";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  ChevronDown,
  Clock,
  Gauge,
  Hash,
  Minus,
  MousePointerClick,
  Package,
  Percent,
  Receipt,
  Repeat,
  RotateCcw,
  ShoppingCart,
  Star,
  Target,
  TrendingUp,
  UserMinus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
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
import { kpiIconName, type KpiIconName } from "./page/pagePlan";

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

/** Each kind of measure's icon (the one-page view's tiles use the same names, from pagePlan). */
const KPI_ICONS: Record<KpiIconName, LucideIcon> = {
  money: Banknote,
  profit: TrendingUp,
  cost: Receipt,
  pay: Wallet,
  orders: ShoppingCart,
  people: Users,
  loss: UserMinus,
  returns: RotateCcw,
  rating: Star,
  time: Clock,
  units: Package,
  traffic: MousePointerClick,
  conversion: Target,
  retention: Repeat,
  average: Gauge,
  percent: Percent,
  count: Hash,
};

/**
 * The icon chip's colours: a soft tint of one of the chart colours mixed into
 * the card surface, the icon in that colour (tokens only, so the user's chart
 * theme recolours them as it does the charts).
 */
const chipStyle = (i: number): React.CSSProperties => ({
  background: `color-mix(in oklab, var(--chart-${(i % 8) + 1}) 14%, var(--surface-1))`,
  color: `var(--chart-${(i % 8) + 1})`,
});

/** What a change chip says when there is nothing to compare with (DeltaChip's own fallback). */
const NO_COMPARISON = "No comparison";

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
        : value.comparisonLabel || NO_COMPARISON;
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
        "tabular inline-flex shrink-0 items-center gap-0.5 rounded-full font-medium",
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
 * compare), for the note in the filter bar. When no card has a change (a
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
 * What "prev." on the cards is: "vs 1 Oct 2024 – 30 Sep 2025", or for
 * all-time cards "May 2026 vs May 2025"; with no changes at all, why ("All
 * employees in the file · no period comparison").
 */
export function ComparisonNote({
  lead = false,
  className,
}: {
  /** Standing on its own (above the cards on a narrow screen): "Change vs …", not just "vs …". */
  lead?: boolean;
  className?: string;
}) {
  const batch = useWorkspace((s) => s.kpiBatch);
  const shared = batch ? sharedComparison(batch.values) : null;
  if (!shared) return null;
  const text = !shared.changes
    ? shared.label
    : shared.current
      ? `${lead ? "Change: " : ""}${shared.current} ${shared.label}`
      : `${lead ? "Change " : ""}${shared.label}`;
  return (
    <p
      className={cn("tabular truncate text-xs text-fg-subtle", className)}
      title={shared.changes ? `The changes on the KPI cards: ${text}` : text}
    >
      {text}
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
  /** The comparison stated in the filter bar; the card repeats only one that differs. */
  shared?: { label: string; current: string; changes?: boolean } | null;
  /** A roster view: the dates mark when each entity started, so there is no trend line to draw. */
  roster?: boolean;
}) {
  const fmt = useFmt();
  // Without a date column nothing has a comparison; the period's pill says why, once.
  const undated = useWorkspace((s) => !s.context?.dateColumn);
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
  const Icon = KPI_ICONS[kpiIconName(meta)] ?? Activity;
  const changed = Boolean(value && (value.delta !== null || value.deltaAbs !== null));
  // The comparison the filter bar states ("prev."), or this card's own when it differs.
  const sameComparison =
    value?.comparisonLabel === shared?.label && (value?.currentLabel ?? "") === shared?.current;
  const from =
    value && !noRows && value.previous !== null && changed
      ? ` · from ${formatValue(value.previous, meta.format, { ...fmt, compact })}`
      : "";
  return (
    <motion.button
      type="button"
      onClick={() => select({ type: "kpi", id: meta.id })}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, type: "spring", stiffness: 380, damping: 32 }}
      className={cn(
        "group @container/kpi relative flex min-w-0 flex-col rounded-card border bg-surface-1 p-4 text-left shadow-card transition-[border-color,box-shadow] duration-fast focus-visible:focus-ring",
        // The one being inspected: an accent edge and a soft ring, drawn with the card's shadow.
        selected ? "border-accent ring-3 ring-accent-soft" : "border-border hover:border-border-hover",
      )}
      title={`${meta.name}: ${full}${value?.comparisonLabel ? ` · change ${value.currentLabel ? `${value.currentLabel} ` : ""}${value.comparisonLabel}` : ""}${from}`}
    >
      <span className="sr-only">Open details: </span>
      <span className="flex min-w-0 items-center gap-2">
        {/* The chip gives way on a narrow card, so the name keeps its room. */}
        <span
          aria-hidden
          className="hidden size-6 shrink-0 place-items-center rounded-sm @[10rem]/kpi:grid"
          style={chipStyle(index)}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-fg-muted" title={meta.name}>
          {kpiLabel(meta)}
        </span>
        {meta.caveat ? (
          <Tooltip content={meta.caveat}>
            <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-label="Has a caveat" />
          </Tooltip>
        ) : null}
      </span>
      {value ? (
        <>
          {/* The figure: 30 px from a card about 9 rem wide (six across a desktop row), 24 px on a
              phone's two-up row, where the longest values ("−₹3.13Cr", about 4.4 em) must still fit. */}
          <span
            className="font-figures mt-3 block truncate text-2xl leading-none font-semibold text-fg @[9rem]/kpi:text-3xl"
            title={full}
          >
            {display}
          </span>
          <span className="mt-2.5 flex min-h-6 flex-wrap items-center gap-x-1.5 gap-y-1">
            {/* When the change describes a narrower window than the number above (all time, like
                for like), that window's own value comes first, so the change never sits under a
                number it doesn't describe: "September 2026: ₹37.9L ↗ +46.9%". */}
            {!noRows && value.currentLabel && value.current !== null ? (
              <span className="tabular text-xs text-fg-muted">
                {value.currentLabel}:{" "}
                <span className="text-fg">
                  {formatValue(value.current, meta.format, { ...fmt, compact })}
                </span>
              </span>
            ) : null}
            <DeltaChip
              meta={meta}
              value={value}
              shared={shared?.changes ? undefined : (shared?.label ?? (undated ? NO_COMPARISON : undefined))}
            />
            {/* "prev." is said in the filter bar; a card names its own comparison only when it differs. */}
            {changed && !noRows ? (
              sameComparison ? (
                <span className="text-xs text-fg-subtle">vs prev.</span>
              ) : (
                <span className="min-w-0 truncate text-xs text-fg-subtle" title={value.comparisonLabel}>
                  {value.currentLabel ? `${value.currentLabel} ` : ""}
                  {value.comparisonLabel}
                </span>
              )
            ) : null}
          </span>
          {/* No line for a roster, nor without two points to join (no dates): the card stays compact. */}
          {noRows ||
          roster ||
          value.spark.filter((p) => p.v !== null && Number.isFinite(p.v)).length < 2 ? null : (
            <span className="-mx-1 mt-auto block pt-3">
              <Sparkline
                values={value.spark.map((p) => p.v)}
                partialLast={value.partialLast}
                label={`${meta.name} trend`}
              />
            </span>
          )}
          {progress !== null ? (
            <span className={cn("block", noRows || roster ? "mt-auto pt-3" : "mt-2")}>
              <span className="flex items-center justify-between text-xs text-fg-subtle">
                <span className="inline-flex items-center gap-1">
                  <Target className="size-3" aria-hidden /> Target{" "}
                  {formatValue(target ?? null, meta.format, { ...fmt, compact: true })}
                </span>
                <span className="tabular">{Math.round(progress * 100)}%</span>
              </span>
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-3">
                <span
                  className={cn(
                    "block h-full rounded-full",
                    (meta.direction === "lower" ? progress <= 1 : progress >= 1) ? "bg-success" : "bg-accent",
                  )}
                  style={{ width: `${Math.min(100, progress * 100)}%` }}
                />
              </span>
            </span>
          ) : null}
        </>
      ) : (
        <span className="mt-3 grid gap-2">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-9 w-full" />
        </span>
      )}
    </motion.button>
  );
}

/**
 * Columns of the hero row by how many KPIs it holds, chosen from the row's
 * own width (container queries), so its rows are always balanced: six in one
 * row when there is room, else three and three; never five and one left
 * alone on a second row.
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

/** A compact tile's narrowest width, px: a name, a value and its change chip side by side. */
const TILE_MIN = 176;

/**
 * Compact KPI tiles (name, value, change and, when it differs, the window the
 * change describes) in one panel divided by hairlines; used for the
 * supporting KPIs and the KPIs from the other columns. One row shows, as many
 * tiles as the panel's width holds; "Show all N KPIs" opens the rest.
 */
export function KpiTiles({ ids, label }: { ids: string[]; label: string }) {
  const context = useWorkspace((s) => s.context);
  const batch = useWorkspace((s) => s.kpiBatch);
  const select = useWorkspace((s) => s.select);
  const inspected = useWorkspace((s) => (s.selected?.type === "kpi" ? s.selected.id : null));
  const fmt = useFmt();
  const [all, setAll] = React.useState(false);
  // The panel's width decides how many tiles one row holds; measured as it changes.
  const [width, setWidth] = React.useState(0);
  const observer = React.useRef<ResizeObserver | null>(null);
  const measure = React.useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!node) return;
    setWidth(node.clientWidth);
    observer.current = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(Math.round(w));
    });
    observer.current.observe(node);
  }, []);
  if (!context || !ids.length) return null;
  const metas = new Map(context.kpis.map((k) => [k.id, k]));
  const values = new Map(batch?.values.map((v) => [v.id, v]) ?? []);
  // With no change on any card (a roster), the note in the bar says why once; tiles don't repeat it.
  const shared = batch ? sharedComparison(batch.values) : null;
  const noChangeReason =
    shared && !shared.changes ? shared.label : !context.dateColumn ? NO_COMPARISON : undefined;
  const perRow = width ? Math.max(1, Math.floor(width / TILE_MIN)) : 6;
  const more = ids.length > perRow;
  const shown = all || !more ? ids : ids.slice(0, perRow);
  return (
    <section
      aria-label={label}
      className="overflow-hidden rounded-card border border-border bg-surface-1 shadow-card"
    >
      {/* Each tile draws its top and left hairline; the grid is pulled up and left by one pixel, so
          the outer ones fall under the panel's own edge and only the dividers show. */}
      <div ref={measure} className="-mt-px -ml-px grid grid-cols-[repeat(auto-fit,minmax(176px,1fr))]">
        {shown.map((id) => {
          const meta = metas.get(id);
          const v = values.get(id);
          if (!meta) return null;
          return (
            <button
              key={id}
              type="button"
              onClick={() => select({ type: "kpi", id })}
              title={`${meta.name}${v?.comparisonLabel ? ` · change ${v.currentLabel ? `${v.currentLabel} ` : ""}${v.comparisonLabel}` : ""}`}
              className={cn(
                "flex min-w-0 flex-col items-start gap-1 border-t border-l border-border-subtle px-4 py-3 text-left transition-colors duration-fast focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none focus-visible:ring-inset",
                inspected === id ? "bg-surface-selected" : "hover:bg-surface-hover active:bg-surface-active",
              )}
            >
              <span className="w-full truncate text-xs font-medium text-fg-muted">{kpiLabel(meta)}</span>
              <span className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-figures max-w-full truncate text-lg leading-tight font-semibold text-fg">
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
                {v ? <DeltaChip meta={meta} value={v} size="sm" shared={noChangeReason} /> : null}
              </span>
              {/* As on the cards: the window a change describes, with its own value, when it isn't the tile's. */}
              {v && v.rows > 0 && v.currentLabel && v.current !== null ? (
                <span className="tabular w-full truncate text-xs text-fg-muted">
                  {v.currentLabel}:{" "}
                  <span className="text-fg">
                    {formatValue(v.current, meta.format, {
                      ...fmt,
                      compact: kpiCompact(meta.format, v.value),
                    })}
                  </span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {more ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((a) => !a)}
          className="flex h-9 w-full items-center justify-center gap-1.5 border-t border-border-subtle text-xs font-medium text-fg-muted transition-colors duration-fast hover:bg-surface-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none focus-visible:ring-inset active:bg-surface-active"
        >
          {all ? "Show fewer" : `Show all ${ids.length} KPIs`}
          <ChevronDown className={cn("size-3.5 transition-transform", all && "rotate-180")} aria-hidden />
        </button>
      ) : null}
    </section>
  );
}
