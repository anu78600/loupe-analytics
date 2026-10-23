"use client";

/**
 * Check & map's Rows view: the whole file, so the user can confirm the
 * upload is right before the dashboard, with every problem the data check
 * found (profile/dataCheck.ts). On the left, what to check: all rows, the
 * rows to check, one entry per problem found (cells that couldn't be read,
 * values that break a rule, repeated rows) and the blanks of each column;
 * picking one filters the grid to those rows. On the right, the grid with
 * problem cells tinted and explained in their tooltips.
 *
 * The page owns the views (review/useCheckViews.ts) and which one is open,
 * so the summary strip's "Rows to check" and a review-table health badge
 * can open this view on their rows.
 *
 * Each column header can hide its column from the analysis. Hidden columns
 * stay in the grid as the user's reference, dimmed, and the check leaves
 * them out: their problems neither mark cells nor count as rows to check.
 * The note naming them is one short line with the full sentence behind its
 * ⓘ (ui/primitives/reveal.tsx).
 */
import * as React from "react";
import { AlertTriangle, CheckCircle2, EyeOff, Info, Rows3 } from "lucide-react";
import type { CheckView } from "@/engine/profile/dataCheck";
import { formatCount } from "@/engine/core/format";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { Skeleton } from "@/ui/primitives/misc";
import { Brief } from "@/ui/primitives/reveal";
import { VirtualGrid } from "./VirtualGrid";
import { useFileColumns } from "./useFileColumns";

const TONE_ICON = { warning: AlertTriangle, info: Info, neutral: Rows3 } as const;
const TONE_TEXT = { warning: "text-warning", info: "text-info", neutral: "text-fg-subtle" } as const;

export function DataCheckPanel({
  views,
  selected,
  onSelect,
}: {
  /** The check's views, null while they load. */
  views: CheckView[] | null;
  /** The open view's id ("all", "problems", "issue:…", "blank:…"). */
  selected: string;
  onSelect: (id: string) => void;
}) {
  const summary = useWorkspace((s) => s.summary);
  // Every column of the file, with the user's role changes; hidden ones included (they stay in the grid).
  const file = useFileColumns();
  const setHidden = useWorkspace((s) => s.setColumnsHidden);
  const locale = useSettings((s) => s.numberLocale);
  // The hidden columns the worker has applied: a new set changes which cells are marked.
  const applied = useWorkspace((s) => s.context?.hiddenColumns.join("\u0000") ?? "");
  const view = views?.find((v) => v.id === selected) ?? views?.[0];
  // A view about one column (its blanks, a problem in it) scrolls the grid to that column: the grid's
  // headers follow the file's order after the row numbers.
  const gridBox = React.useRef<HTMLElement>(null);
  const focusIndex = view?.column && file ? file.columns.findIndex((c) => c.name === view.column) : -1;
  const gridKey = `${view?.id ?? ""}|${applied}`;
  React.useEffect(() => {
    if (focusIndex < 0) return;
    const grid = gridBox.current?.querySelector<HTMLElement>('[role="grid"]');
    const head = grid?.querySelectorAll<HTMLElement>('[role="columnheader"]')[focusIndex + 1];
    // Past the sticky row numbers, with a little of the column before it in sight.
    if (grid && head) grid.scrollLeft = Math.max(0, head.offsetLeft - 96);
  }, [focusIndex, gridKey]);

  if (!summary || !file) return null;
  const hiddenNames = file.columns.filter((c) => file.hidden.has(c.name)).map((c) => c.name);
  const toCheck = views?.find((v) => v.id === "problems");
  const issues = views?.filter((v) => v.id.startsWith("issue:")) ?? [];
  const blanks = views?.filter((v) => v.id.startsWith("blank:")) ?? [];
  const blankOpen = Boolean(view?.id.startsWith("blank:"));

  const item = (v: CheckView) => {
    const Icon = TONE_ICON[v.tone];
    const active = view?.id === v.id;
    return (
      <li key={v.id}>
        <button
          type="button"
          onClick={() => onSelect(v.id)}
          aria-pressed={active}
          className={cn(
            "flex w-full items-start gap-2.5 rounded-control border px-3 py-2 text-left transition-colors focus-visible:focus-ring",
            active
              ? "border-border-accent bg-surface-selected"
              : "border-transparent hover:bg-surface-hover active:bg-surface-active",
          )}
        >
          <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_TEXT[v.tone])} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-ui text-fg" title={v.label}>
                {v.label}
              </span>
              <span className="font-figures shrink-0 text-xs text-fg-muted">
                {formatCount(v.rows, locale)}
              </span>
            </span>
            {v.id.startsWith("issue:") ? (
              <span className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-fg-subtle" title={v.detail}>
                {v.detail}
              </span>
            ) : null}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside aria-label="What to check" className="grid min-w-0 grid-cols-1 content-start gap-4">
        {views ? (
          <>
            <ul className="grid grid-cols-1 gap-1">
              {views.filter((v) => v.id === "all" || v.id === "problems").map(item)}
            </ul>
            {issues.length ? (
              <div>
                <p className="eyebrow mb-1 px-3 text-fg-subtle">Problems found</p>
                <ul className="grid grid-cols-1 gap-1">{issues.map(item)}</ul>
              </div>
            ) : null}
            {blanks.length ? (
              // Opened when a column's blanks were asked for (a health badge), so the choice is in sight.
              <details key={blankOpen ? "open" : "closed"} open={blankOpen} className="group">
                <summary className="eyebrow cursor-pointer rounded-control px-3 py-1.5 text-fg-subtle hover:text-fg focus-visible:focus-ring">
                  Blank cells by column ({blanks.length})
                </summary>
                <ul className="mt-1 grid grid-cols-1 gap-1">{blanks.map(item)}</ul>
              </details>
            ) : null}
          </>
        ) : (
          <div className="grid gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {toCheck && !toCheck.rows ? (
          <p className="flex items-start gap-2 px-3 text-ui text-success-text">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            Every cell was read and no rule is broken.
          </p>
        ) : null}
        {hiddenNames.length ? (
          <p className="flex items-start gap-2 px-3 text-ui text-fg-muted">
            <EyeOff className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
            <Brief
              label="About the hidden columns"
              full={`${hiddenNames.length === 1 ? "1 hidden column is" : `${hiddenNames.length} hidden columns are`} not checked: nothing computes from ${
                hiddenNames.length === 1 ? `"${hiddenNames[0]}"` : hiddenNames.map((h) => `"${h}"`).join(", ")
              }.`}
            >
              {hiddenNames.length === 1 ? "1 hidden column" : `${hiddenNames.length} hidden columns`} not
              checked.
            </Brief>
          </p>
        ) : null}
      </aside>
      <section ref={gridBox} aria-label="Your data" className="grid min-w-0 content-start gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-ui text-fg">
            {view ? (
              <>
                {view.label}
                <span className="text-fg-muted"> · {formatCount(view.rows, locale)} rows</span>
              </>
            ) : (
              "Loading…"
            )}
          </p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted" aria-label="Legend">
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded-xs border border-border bg-warning-soft" aria-hidden /> Needs a
              look (hover for why)
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded-xs border border-border bg-info-soft" aria-hidden /> Worth
              knowing
            </li>
          </ul>
        </div>
        {view ? (
          <VirtualGrid
            // A new hidden set changes which cells are marked, so the grid fetches its rows again.
            key={gridKey}
            columns={file.columns}
            view={view.id}
            total={view.rows}
            hidden={file.hidden}
            onToggleHidden={(column, hide) => setHidden([column], hide)}
            className="h-[min(680px,72vh)]"
          />
        ) : (
          <Skeleton className="h-[min(680px,72vh)] w-full" />
        )}
      </section>
    </div>
  );
}
