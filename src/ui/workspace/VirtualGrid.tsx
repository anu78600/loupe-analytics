"use client";

/**
 * The whole file as a virtualised grid, with its problems marked (step 3).
 * Rows come from the worker's data check (profile/dataCheck.ts) in pages of
 * 200 as the user scrolls, so large datasets show without being copied to
 * the main thread. `view` picks which rows: all of them, the rows to check,
 * one issue's rows or one column's blanks; each row keeps its real row
 * number. Marked cells are tinted with the reason in their tooltip: a cell
 * that couldn't be read shows what the file said, a value that breaks a
 * rule, a probably missing value, and a row that repeats an earlier one.
 *
 * Each column header can hide its column from the analysis (the eye
 * button). A hidden column stays in the grid, dimmed and unmarked, because
 * the user keeps it as a reference; nothing computes from it.
 *
 * Browsers cap an element's height (about 33 million px, roughly a million
 * 32-px rows), so a view longer than BLOCK rows is shown one block at a time.
 */
import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, Calendar, Clock, Copy, Eye, EyeOff, Hash, ToggleLeft, Type } from "lucide-react";
import type { ColumnProfile } from "@/engine/profile/types";
import { ROLE_LABEL } from "@/engine/profile/types";
import type { CellProblem, CheckedRow } from "@/engine/profile/dataCheck";
import { engine } from "@/lib/engine-client";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/ui/primitives/tooltip";

const PAGE = 200;
const ROW_H = 32;
const BLOCK = 1_000_000;

const STORAGE_ICON = { number: Hash, date: Calendar, string: Type, boolean: ToggleLeft } as const;

const ROLE_TONE: Record<string, string> = {
  identifier: "text-info",
  datetime: "text-chart-3",
  time: "text-chart-3",
  dimension: "text-fg-muted",
  measure: "text-accent",
  currency: "text-accent",
  rate: "text-chart-4",
  percentage: "text-chart-4",
  geo: "text-chart-6",
  text: "text-fg-subtle",
  boolean: "text-chart-5",
};

/** Tint of a marked cell: warnings (couldn't be read, a broken rule, a missing value) and information. */
function problemClass(p: CellProblem | undefined): string {
  if (!p) return "";
  return p.tone === "warning" ? "bg-warning-soft" : "bg-info-soft";
}

export function VirtualGrid({
  columns,
  view = "all",
  total,
  hidden,
  onToggleHidden,
  className,
}: {
  /** The file's columns in file order (the worker returns cells in this order). */
  columns: ColumnProfile[];
  /** Data-check view id; see DataCheck.views(). */
  view?: string;
  /** Rows in the view. */
  total: number;
  /** Columns hidden from the analysis: shown dimmed, with "Hidden" in the header. */
  hidden?: ReadonlySet<string>;
  /** Adds the hide/show button to each column header. */
  onToggleHidden?: (column: string, hide: boolean) => void;
  className?: string;
}) {
  const parent = React.useRef<HTMLDivElement>(null);
  const pages = React.useRef(new Map<number, CheckedRow[]>());
  const pending = React.useRef(new Set<number>());
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  const [block, setBlock] = React.useState(0);
  const blocks = Math.max(1, Math.ceil(total / BLOCK));
  const offset = Math.min(block, blocks - 1) * BLOCK;
  const rowCount = Math.max(0, Math.min(BLOCK, total - offset));
  // Room for the name (plus the hide button when there is one) and for the role line under it
  // ("Currency · non-additive"), so neither wraps.
  const button = onToggleHidden ? 26 : 0;
  const widths = React.useMemo(
    () =>
      columns.map((c) => {
        const role =
          ROLE_LABEL[c.role].length +
          (c.additivity && c.additivity !== "additive" ? c.additivity.length + 3 : 0);
        const wanted = Math.max(c.name.length * 7.4 + 54 + button, role * 6.4 + 46);
        return Math.min(260 + button, Math.max(110 + button, wanted));
      }),
    [columns, button],
  );
  const totalWidth = 72 + widths.reduce((a, b) => a + b, 0);

  React.useEffect(() => {
    pages.current.clear();
    pending.current.clear();
    force();
  }, [columns, view, total, offset]);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parent.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();

  React.useEffect(() => {
    const needed = new Set(items.map((i) => Math.floor(i.index / PAGE)));
    for (const p of needed) {
      if (pages.current.has(p) || pending.current.has(p)) continue;
      pending.current.add(p);
      void engine()
        .checkRows(view, offset + p * PAGE, PAGE)
        .then((res) => {
          pages.current.set(p, res.rows);
          pending.current.delete(p);
          force();
        })
        .catch(() => {
          // Leave the page unloaded so the next scroll retries it.
          pending.current.delete(p);
        });
    }
  }, [items, view, offset]);

  const rowAt = (index: number): CheckedRow | undefined =>
    pages.current.get(Math.floor(index / PAGE))?.[index % PAGE];

  return (
    // min-w-0: inside a grid or flex layout the table's full width must scroll here, not widen the page.
    <div className={cn("flex min-h-0 min-w-0 flex-col gap-2", className)}>
      {blocks > 1 ? (
        <label className="flex items-center gap-2 text-2xs text-fg-muted">
          Showing
          <select
            className="rounded-control border border-border bg-surface-2 px-2 py-1 text-ui text-fg"
            value={Math.min(block, blocks - 1)}
            onChange={(e) => setBlock(Number(e.target.value))}
          >
            {Array.from({ length: blocks }, (_, b) => (
              <option key={b} value={b}>
                rows {(b * BLOCK + 1).toLocaleString("en-US")}–
                {Math.min(total, (b + 1) * BLOCK).toLocaleString("en-US")}
              </option>
            ))}
          </select>
          of {total.toLocaleString("en-US")}
        </label>
      ) : null}
      <div
        ref={parent}
        className="relative min-h-0 flex-1 overflow-auto rounded-card border border-border bg-surface-1"
        role="grid"
        aria-rowcount={rowCount + 1}
        aria-colcount={columns.length + 1}
      >
        <div style={{ width: totalWidth, minWidth: "100%" }}>
          <div className="sticky top-0 z-20 flex border-b border-border-strong bg-surface-2" role="row">
            <div
              className="sticky left-0 z-10 w-[72px] shrink-0 border-r border-border bg-surface-2 px-3 py-2 text-2xs text-fg-subtle"
              role="columnheader"
            >
              Row
            </div>
            {columns.map((c, j) => {
              const Icon = c.role === "time" ? Clock : STORAGE_ICON[c.storage];
              const off = hidden?.has(c.name) ?? false;
              return (
                <div
                  key={c.name}
                  style={{ width: widths[j] }}
                  className={cn("shrink-0 border-r border-border px-3 py-1.5", off && "bg-surface-3")}
                  role="columnheader"
                >
                  <div className="flex items-start justify-between gap-1">
                    <p
                      className={cn(
                        "truncate text-ui font-medium",
                        off ? "text-fg-subtle line-through" : "text-fg",
                      )}
                      title={c.name}
                    >
                      {c.name}
                    </p>
                    {onToggleHidden ? (
                      <Tooltip
                        content={
                          off
                            ? "Use this column in the analysis again"
                            : "Hide from the analysis: it stays in your file and here, but no KPI, chart, filter or question uses it"
                        }
                      >
                        <button
                          type="button"
                          onClick={() => onToggleHidden(c.name, !off)}
                          aria-pressed={off}
                          aria-label={
                            off ? `Use ${c.name} in the analysis again` : `Hide ${c.name} from the analysis`
                          }
                          className="-mt-0.5 -mr-1.5 grid size-6 shrink-0 place-items-center rounded-[6px] text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none"
                        >
                          {off ? (
                            <Eye className="size-3.5" aria-hidden />
                          ) : (
                            <EyeOff className="size-3.5" aria-hidden />
                          )}
                        </button>
                      </Tooltip>
                    ) : null}
                  </div>
                  {off ? (
                    <p className="mt-0.5 inline-flex items-center gap-1 text-2xs text-fg-muted">
                      <EyeOff className="size-3" aria-hidden />
                      Hidden · not used
                    </p>
                  ) : (
                    <Tooltip content={`${ROLE_LABEL[c.role]} · ${c.roleReason}`}>
                      <p className={cn("mt-0.5 inline-flex items-center gap-1 text-2xs", ROLE_TONE[c.role])}>
                        <Icon className="size-3" aria-hidden />
                        {ROLE_LABEL[c.role]}
                        {c.additivity && c.additivity !== "additive" ? (
                          <span className="text-fg-subtle">· {c.additivity}</span>
                        ) : null}
                      </p>
                    </Tooltip>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {items.map((it) => {
              const row = rowAt(it.index);
              const byColumn = new Map<number, CellProblem>();
              for (const p of row?.problems ?? []) if (!byColumn.has(p.column)) byColumn.set(p.column, p);
              const dup = row?.duplicateOf;
              return (
                <div
                  key={it.key}
                  role="row"
                  aria-rowindex={it.index + 2}
                  className="absolute left-0 flex w-full border-b border-border text-ui hover:bg-surface-2"
                  style={{ height: ROW_H, transform: `translateY(${it.start}px)` }}
                >
                  <div
                    role="rowheader"
                    className={cn(
                      "font-figures sticky left-0 z-[1] flex w-[72px] shrink-0 items-center gap-1 border-r border-border px-3 py-1.5 text-2xs",
                      dup !== undefined ? "bg-warning-soft text-warning" : "bg-surface-1 text-fg-subtle",
                    )}
                    title={dup !== undefined ? `Same as row ${dup + 1} in every column.` : undefined}
                  >
                    {row ? row.index + 1 : offset + it.index + 1}
                    {dup !== undefined ? (
                      <Copy className="size-3" aria-label={`repeats row ${dup + 1}`} />
                    ) : null}
                  </div>
                  {columns.map((c, j) => {
                    const v = row?.cells[j];
                    const off = hidden?.has(c.name) ?? false;
                    // A hidden column is the user's reference only: dimmed, never marked.
                    const problem = off ? undefined : byColumn.get(j);
                    return (
                      <div
                        key={c.name}
                        role="gridcell"
                        style={{ width: widths[j] }}
                        className={cn(
                          "flex shrink-0 items-center gap-1 truncate border-r border-border px-3 py-1.5",
                          c.storage === "number" ? "font-figures justify-end" : "",
                          v === null || off ? "text-fg-subtle" : "text-fg",
                          v === null ? "italic" : "",
                          off ? "bg-surface-2" : problemClass(problem),
                        )}
                        title={problem ? problem.note : (v ?? undefined)}
                      >
                        {row === undefined ? (
                          <span className="skeleton inline-block h-3 w-3/4 rounded" />
                        ) : (
                          <>
                            {problem?.kind === "unreadable" ? (
                              <AlertTriangle className="size-3 shrink-0 text-warning" aria-hidden />
                            ) : null}
                            <span className="truncate">{v === null ? "blank" : v}</span>
                            {/* The reason, for screen readers (the tooltip is mouse-only). */}
                            {problem ? <span className="sr-only">. {problem.note}</span> : null}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
