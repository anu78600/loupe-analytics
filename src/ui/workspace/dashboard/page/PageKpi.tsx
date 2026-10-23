"use client";

/**
 * A headline KPI on the one-page dashboard (version 50.3), drawn the way the
 * dashboard's KPI cards are: the name with a small icon chip for the kind of
 * measure, the value large in the figures face, the change as a soft badge
 * coloured by whether it is good for this KPI ("vs prev." after it), the
 * target's progress where one is set, and the trend as a sparkline along the
 * foot. A roster has no sparkline: plotted by start date it would read as a
 * trend (as KpiCards decides). The same tile is drawn live and in the
 * download, so it holds no hover-only text: the full name and value are in
 * its tooltip and its accessible name.
 *
 * Nothing here computes a figure: the value, the change and the trend are the
 * dashboard's own (KpiValue), written by the shared KPI rule (formatKpi).
 */
import * as React from "react";
import {
  Activity,
  Banknote,
  Clock,
  Gauge,
  Hash,
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
import { formatValue, type FormatOptions } from "@/engine/core/format";
import { kpiLabel } from "@/engine/core/labels";
import { cn } from "@/lib/utils";
import { formatKpi } from "@/ui/common/kpiFormat";
import { Sparkline } from "@/ui/charts/Sparkline";
import { DeltaChip } from "../KpiCards";
import { changeCaption, kpiIconName, showsChange, type KpiIconName } from "./pagePlan";

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
 * A tint of one of the chart colours, mixed into the card surface (tokens
 * only): the KPI icons' chips, enough to tell the tiles apart at a glance
 * without a colour per card that would mean nothing.
 */
export const tint = (i: number, pct: number) =>
  `color-mix(in oklab, var(--chart-${(i % 8) + 1}) ${pct}%, var(--surface-1))`;

export function PageKpiTile({
  meta,
  value,
  index,
  fmt,
  shared,
  sharedReason,
  roster,
  target,
}: {
  meta: KpiMeta;
  value: KpiValue | undefined;
  index: number;
  fmt: FormatOptions;
  /** The comparison most tiles share (said once, in the filter bar). */
  shared: { label: string; current: string } | null;
  /** The no-change reason the filter bar states once (the tile then says nothing in its place). */
  sharedReason?: string;
  /** A roster view: no trend line to draw. */
  roster: boolean;
  /** The user's target for this KPI, when one is set. */
  target?: number;
}) {
  const Icon = KPI_ICONS[kpiIconName(meta)] ?? Activity;
  const v = value?.value ?? null;
  const noRows = value?.rows === 0;
  // Written as on the dashboard's cards, the slides and the report (formatKpi).
  const shown = noRows ? "—" : formatKpi(v, meta.format, fmt);
  // A headline figure is never cut short: past seven characters the size steps down with the
  // length, so "R$607.07" or "CHF 1.23M" fits the tile as "₹3.13Cr" does.
  const fit = Math.min(1, 7.5 / Math.max(7.5, shown.length));
  const change = value ? showsChange(value, meta.format === "percent") : false;
  // No change to show and its reason said once in the filter bar (DeltaChip's words for it): the
  // tile keeps no empty line for it.
  const silent =
    !!value &&
    !change &&
    value.rows > 0 &&
    (value.previous === null && value.comparisonLabel.startsWith("vs ")
      ? "No value to compare with"
      : value.comparisonLabel || "No comparison") === sharedReason;
  const caption = value && change ? changeCaption(value, shared) : null;
  // A trend needs two points at least; without one (no date column) the tile keeps no room for it.
  const points = !roster && !noRows && value ? value.spark.map((p) => p.v) : [];
  const spark = points.filter((v) => v !== null && Number.isFinite(v)).length >= 2 ? points : null;
  const progress = target && v !== null ? v / target : null;
  const full = noRows ? "No rows in this selection" : formatValue(v, meta.format, fmt);
  const comparison = value?.comparisonLabel
    ? ` · change ${value.currentLabel ? `${value.currentLabel} ` : ""}${value.comparisonLabel}`
    : "";
  return (
    <div
      data-card="kpi"
      className="@container/kpi flex min-w-0 flex-col rounded-card border border-border bg-surface-1 p-4 shadow-card"
      title={`${meta.name}: ${full}${comparison}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="grid size-6 shrink-0 place-items-center rounded-sm"
          style={{ background: tint(index, 14), color: `var(--chart-${(index % 8) + 1})` }}
        >
          <Icon className="size-3.5" aria-hidden />
        </span>
        <p className="min-w-0 truncate text-ui font-medium text-fg-muted">{kpiLabel(meta)}</p>
      </div>
      {/* 30 px once the tile holds 8.5rem (the download's and a laptop's six across), a step down on the
          narrower tiles of a small laptop, where "₹3.13Cr" would otherwise be cut. */}
      <p className="font-figures mt-2.5 truncate text-2xl leading-none font-semibold text-fg @[8.5rem]/kpi:text-3xl">
        <span style={fit < 1 ? { fontSize: `${fit.toFixed(3)}em` } : undefined}>{shown}</span>
      </p>
      {value && !silent ? (
        // A flex row, so the line is the badge's own height rather than the body's line height. The
        // badge never gives way; a caption too long to sit beside it ("in 1 Oct – 31 Dec 2025", when
        // the change describes a narrower window than the value) takes the line under it instead.
        <div className="mt-2 flex min-h-5 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {/* The badge keeps its size; a reason in its place ("No value to compare with") is cut instead. */}
          <span className={change ? "flex shrink-0 whitespace-nowrap" : "flex min-w-0 [&>span]:truncate"}>
            <DeltaChip meta={meta} value={value} size="sm" shared={sharedReason} />
          </span>
          {caption ? (
            <span className="min-w-0 truncate text-xs leading-5 text-fg-subtle">{caption}</span>
          ) : null}
        </div>
      ) : null}
      {progress !== null && target ? (
        <div className="mt-2.5">
          <div className="flex items-center justify-between gap-2 text-xs text-fg-subtle">
            <span className="inline-flex min-w-0 items-center gap-1 truncate">
              <Target className="size-3 shrink-0" aria-hidden />
              Target {formatValue(target, meta.format, { ...fmt, compact: true })}
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
      {spark ? (
        // Along the foot of the tile, full bleed within its padding; the sparkline's own colour is
        // the chart theme's spark token.
        <div className="-mx-1 mt-auto pt-2.5">
          <Sparkline
            values={spark}
            partialLast={value?.partialLast}
            height={26}
            className="h-6.5"
            label={`${meta.name} trend`}
          />
        </div>
      ) : null}
    </div>
  );
}
