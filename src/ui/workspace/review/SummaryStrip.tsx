"use client";

/**
 * Check & map's summary strip (version 50.2): four figures that answer "is
 * this file ready?" at a glance, each opening where its answer is.
 *
 * - KPIs available (37 / 39) opens the KPIs view: which KPIs need what.
 * - Columns used (26 / 28) filters the review table to the columns nothing
 *   reads, each with the reason (or shows them all when every one is used).
 * - Rows to check (2,307) opens the Rows view on those rows.
 * - Data health (100 / 100) opens the File report.
 *
 * Each figure has a thin meter of its share, in the status colour, and one
 * caption line. The figures are tabular, so they line up and never jitter.
 */
import * as React from "react";
import { ArrowRight } from "lucide-react";
import type { CheckView } from "@/engine/profile/dataCheck";
import { formatCount } from "@/engine/core/format";
import { cn } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { useWorkspace } from "@/store/workspace";
import { Skeleton } from "@/ui/primitives/misc";
import type { ReviewRow } from "./model";

type Tone = "accent" | "success" | "warning";

const METER: Record<Tone, string> = {
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
};

function Tile({
  label,
  value,
  of,
  share,
  tone,
  caption,
  action,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  /** The whole the value is out of ("/ 39"), if any. */
  of?: React.ReactNode;
  /** 0–1 for the meter; null hides it. */
  share: number | null;
  tone: Tone;
  caption: React.ReactNode;
  /** What a click does, for screen readers ("Show the KPIs"). */
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-0 flex-col items-stretch rounded-card border border-border bg-surface-1 p-4 text-left shadow-card transition-[border-color,background-color] duration-fast hover:border-border-hover focus-visible:focus-ring active:bg-surface-active"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-fg-muted">{label}</span>
        <ArrowRight
          className="size-3.5 shrink-0 text-fg-subtle opacity-0 transition-[opacity,translate] duration-fast group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden
        />
      </span>
      <span className="mt-2 flex items-baseline gap-1">
        <span className="font-figures text-2xl font-semibold text-fg">{value}</span>
        {of !== undefined ? <span className="font-figures text-sm text-fg-subtle">/ {of}</span> : null}
      </span>
      <span
        aria-hidden
        className={cn(
          "mt-3 h-1 overflow-hidden rounded-full bg-surface-inset",
          share === null && "invisible",
        )}
      >
        <span
          className={cn("block h-full rounded-full", METER[tone])}
          style={{ width: `${Math.max(share ?? 0, share ? 0.02 : 0) * 100}%` }}
        />
      </span>
      <span className="mt-2 truncate text-xs text-fg-subtle">{caption}</span>
      <span className="sr-only">. {action}</span>
    </button>
  );
}

export function SummaryStrip({
  rows,
  views,
  onKpis,
  onColumns,
  onRows,
  onReport,
  className,
}: {
  rows: ReviewRow[] | null;
  views: CheckView[] | null;
  onKpis: () => void;
  /** Opens the review table on the columns nothing reads (or on all of them, when none). */
  onColumns: (anyUnused: boolean) => void;
  onRows: () => void;
  onReport: () => void;
  className?: string;
}) {
  const context = useWorkspace((s) => s.context);
  const health = useWorkspace((s) => s.health);
  const rowCount = useWorkspace((s) => s.summary?.rowCount ?? 0);
  const locale = useSettings((s) => s.numberLocale);
  if (!context) return null;
  const kpis = context.kpis.filter((k) => !k.hidden);
  const kpisOn = kpis.filter((k) => k.available).length;
  const kpisOff = kpis.length - kpisOn;
  const used = rows?.filter((r) => r.status === "used").length ?? 0;
  const unused = rows?.filter((r) => r.status === "unused").length ?? 0;
  const hidden = rows?.filter((r) => r.status === "hidden").length ?? 0;
  const total = rows?.length ?? 0;
  const toCheck = views?.find((v) => v.id === "problems")?.rows;
  const n = (x: number) => formatCount(x, locale);
  return (
    <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-4", className)} aria-label="Summary" role="group">
      <Tile
        label="KPIs available"
        value={kpisOn}
        of={kpis.length}
        share={kpis.length ? kpisOn / kpis.length : null}
        tone={kpisOff ? "accent" : "success"}
        caption={kpisOff ? `${kpisOff} ${kpisOff === 1 ? "needs" : "need"} a column` : "All available"}
        action="Show which KPIs need what"
        onClick={onKpis}
      />
      <Tile
        label="Columns used"
        value={used}
        of={total}
        share={total ? used / total : null}
        tone={unused ? "accent" : "success"}
        caption={
          <>
            {unused ? `${unused} not used` : "All used"}
            {hidden ? ` · ${hidden} hidden` : ""}
            {/* Said again under the table, so a phone's narrow tile can leave it out. */}
            <span className="max-sm:hidden"> · none added</span>
          </>
        }
        action={unused ? "Show the columns not used" : "Show the columns"}
        onClick={() => onColumns(unused > 0)}
      />
      {toCheck === undefined ? (
        <div className="rounded-card border border-border bg-surface-1 p-4 shadow-card">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-7 w-20" />
          <Skeleton className="mt-4 h-1 w-full" />
          <Skeleton className="mt-2 h-4 w-28" />
        </div>
      ) : (
        <Tile
          label="Rows to check"
          value={n(toCheck)}
          share={rowCount ? toCheck / rowCount : null}
          tone={toCheck ? "warning" : "success"}
          caption={toCheck ? `of ${n(rowCount)} rows` : "Nothing to check"}
          action="Show the rows"
          onClick={onRows}
        />
      )}
      <Tile
        label="Data health"
        value={health ? health.score : "—"}
        of={100}
        share={health ? health.score / 100 : null}
        tone={!health || health.score >= 90 ? "success" : health.score >= 75 ? "accent" : "warning"}
        caption={health ? health.grade : "Not scored"}
        action="Open the File report"
        onClick={onReport}
      />
    </div>
  );
}
