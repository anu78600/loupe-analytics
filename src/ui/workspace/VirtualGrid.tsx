"use client";

/**
 * Virtualised data preview. Rows are fetched from the worker in pages of 200
 * as the user scrolls, so large datasets preview without being copied to the
 * main thread. Headers show each column's storage type.
 */
import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Calendar, Hash, ToggleLeft, Type } from "lucide-react";
import type { ColumnProfile } from "@/engine/profile/types";
import { ROLE_LABEL } from "@/engine/profile/types";
import { engine } from "@/lib/engine-client";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/ui/primitives/tooltip";

const PAGE = 200;
const ROW_H = 32;

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

export function VirtualGrid({
  columns,
  rowCount,
  className,
}: {
  columns: ColumnProfile[];
  rowCount: number;
  className?: string;
}) {
  const parent = React.useRef<HTMLDivElement>(null);
  const pages = React.useRef(new Map<number, Array<Array<string | null>>>());
  const pending = React.useRef(new Set<number>());
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  const widths = React.useMemo(
    () => columns.map((c) => Math.min(260, Math.max(110, c.name.length * 7.4 + 54))),
    [columns],
  );
  const totalWidth = 64 + widths.reduce((a, b) => a + b, 0);

  React.useEffect(() => {
    pages.current.clear();
    pending.current.clear();
    force();
  }, [columns, rowCount]);

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
        .rows(p * PAGE, PAGE)
        .then((rows) => {
          pages.current.set(p, rows);
          pending.current.delete(p);
          force();
        });
    }
  }, [items]);

  const cell = (index: number): Array<string | null> | undefined =>
    pages.current.get(Math.floor(index / PAGE))?.[index % PAGE];

  return (
    <div
      ref={parent}
      className={cn("relative overflow-auto rounded-card border border-border bg-surface-1", className)}
      role="grid"
      aria-rowcount={rowCount + 1}
      aria-colcount={columns.length}
    >
      <div style={{ width: totalWidth, minWidth: "100%" }}>
        <div className="sticky top-0 z-20 flex border-b border-border-strong bg-surface-2" role="row">
          <div
            className="sticky left-0 z-10 w-16 shrink-0 border-r border-border bg-surface-2 px-3 py-2 text-2xs text-fg-subtle"
            role="columnheader"
          >
            #
          </div>
          {columns.map((c, j) => {
            const Icon = STORAGE_ICON[c.storage];
            return (
              <div
                key={c.name}
                style={{ width: widths[j] }}
                className="shrink-0 border-r border-border px-3 py-1.5"
                role="columnheader"
              >
                <p className="truncate text-ui font-medium text-fg" title={c.name}>
                  {c.name}
                </p>
                <Tooltip content={`${ROLE_LABEL[c.role]} · ${c.roleReason}`}>
                  <p className={cn("mt-0.5 inline-flex items-center gap-1 text-2xs", ROLE_TONE[c.role])}>
                    <Icon className="size-3" aria-hidden />
                    {ROLE_LABEL[c.role]}
                    {c.additivity && c.additivity !== "additive" ? (
                      <span className="text-fg-subtle">· {c.additivity}</span>
                    ) : null}
                  </p>
                </Tooltip>
              </div>
            );
          })}
        </div>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {items.map((it) => {
            const row = cell(it.index);
            return (
              <div
                key={it.key}
                role="row"
                aria-rowindex={it.index + 2}
                className="absolute left-0 flex w-full border-b border-border text-ui hover:bg-surface-2"
                style={{ height: ROW_H, transform: `translateY(${it.start}px)` }}
              >
                <div className="font-figures sticky left-0 w-16 shrink-0 border-r border-border bg-surface-1 px-3 py-1.5 text-2xs text-fg-subtle">
                  {it.index + 1}
                </div>
                {columns.map((c, j) => {
                  const v = row?.[j];
                  return (
                    <div
                      key={c.name}
                      role="gridcell"
                      style={{ width: widths[j] }}
                      className={cn(
                        "shrink-0 truncate border-r border-border px-3 py-1.5",
                        c.storage === "number" ? "font-figures text-right" : "",
                        v === null ? "text-fg-subtle italic" : "text-fg",
                      )}
                      title={v ?? undefined}
                    >
                      {row === undefined ? (
                        <span className="skeleton inline-block h-3 w-3/4 rounded" />
                      ) : v === null ? (
                        "blank"
                      ) : (
                        v
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
  );
}
