"use client";

/**
 * Accessible table twin of every chart: the same ChartData as a sortable
 * HTML table with a caption and aria-sort, for screen readers and for anyone
 * who wants the numbers. Also the only view for results that have no chart
 * form (market-basket pairs, RFM outside a treemap).
 */
import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { formatValue, type FormatOptions } from "@/engine/core/format";
import type { ChartData, ChartSpec } from "@/engine/charts/types";
import { cn } from "@/lib/utils";

type Cell = string | number | null;
interface Col {
  key: string;
  label: string;
  numeric: boolean;
  /** Formats the raw cell for display; sorting always uses the raw value. */
  render?: (v: Cell) => string;
}

/** Columns and raw rows for each ChartData shape (basket, RFM, cohort, funnel, matrix, plain series). */
function tableFor(spec: ChartSpec, data: ChartData, fmt: FormatOptions): { cols: Col[]; rows: Cell[][] } {
  const f = (format: Parameters<typeof formatValue>[1]) => (v: Cell) =>
    typeof v === "number" ? formatValue(v, format, fmt) : v === null ? "—" : String(v);
  const pct = (v: Cell) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—");
  if (data.basket) {
    return {
      cols: [
        { key: "a", label: "If they buy", numeric: false },
        { key: "b", label: "They also buy", numeric: false },
        { key: "orders", label: "Orders together", numeric: true, render: f("integer") },
        { key: "conf", label: "Confidence", numeric: true, render: pct },
        {
          key: "lift",
          label: "Lift",
          numeric: true,
          render: (v) => (typeof v === "number" ? `${v.toFixed(2)}×` : "—"),
        },
      ],
      rows: data.basket.pairs.map((p) => [p.a, p.b, p.orders, p.confidenceAB, p.lift]),
    };
  }
  if (data.rfm) {
    return {
      cols: [
        { key: "segment", label: "Segment", numeric: false },
        { key: "customers", label: "Customers", numeric: true, render: f("integer") },
        { key: "cshare", label: "% customers", numeric: true, render: pct },
        { key: "rshare", label: "% revenue", numeric: true, render: pct },
        {
          key: "recency",
          label: "Avg recency",
          numeric: true,
          render: (v) => (typeof v === "number" ? `${Math.round(v)} d` : "—"),
        },
        {
          key: "freq",
          label: "Avg orders",
          numeric: true,
          render: (v) => (typeof v === "number" ? v.toFixed(1) : "—"),
        },
        { key: "action", label: "Suggested action", numeric: false },
      ],
      rows: data.rfm.map((s) => [
        s.segment,
        s.customers,
        s.customerShare,
        s.revenueShare,
        s.avgRecency,
        s.avgFrequency,
        s.action,
      ]),
    };
  }
  if (data.cohorts) {
    const width = data.cohorts[0]?.retention.length ?? 0;
    return {
      cols: [
        { key: "cohort", label: "Cohort", numeric: false },
        { key: "size", label: "Customers", numeric: true, render: f("integer") },
        ...Array.from({ length: width }, (_, i) => ({
          key: `m${i}`,
          label: `M${i}`,
          numeric: true,
          render: pct,
        })),
      ],
      rows: data.cohorts.map((c) => [c.label, c.size, ...c.retention]),
    };
  }
  if (data.funnel) {
    return {
      cols: [
        { key: "stage", label: "Stage", numeric: false },
        { key: "value", label: "Volume", numeric: true, render: f("integer") },
        { key: "prev", label: "From previous", numeric: true, render: pct },
        { key: "first", label: "From first", numeric: true, render: pct },
      ],
      rows: data.funnel.map((s) => [s.label, s.value, s.fromPrev, s.fromFirst]),
    };
  }
  if (data.matrix && data.seriesCategories) {
    const format = spec.measures[0]?.format ?? "number";
    return {
      cols: [
        { key: "row", label: "", numeric: false },
        ...data.categories.map((c, i) => ({
          key: `c${i}`,
          label: c.label,
          numeric: true,
          render: f(format),
        })),
      ],
      rows: data.seriesCategories.map((s, i) => [s.label, ...(data.matrix?.[i] ?? [])]),
    };
  }
  const label = spec.x.kind === "none" ? "Item" : spec.x.label;
  return {
    cols: [
      { key: "cat", label, numeric: false },
      ...data.series.map((s) => ({ key: s.id, label: s.label, numeric: true, render: f(s.format) })),
      ...(data.rows.length ? [{ key: "rows", label: "Rows", numeric: true, render: f("integer") }] : []),
    ],
    rows: data.categories.map((c, i) => [
      c.label,
      ...data.series.map((s) => s.values[i] ?? null),
      ...(data.rows.length ? [data.rows[i] ?? null] : []),
    ]),
  };
}

/**
 * Renders at most `maxRows` rows (the CSV export has them all). Clicking a
 * header sorts by it: numeric columns start descending, text ascending, and
 * blanks always sort last.
 */
export function DataTable({
  spec,
  data,
  fmt,
  className,
  maxRows = 200,
  caption,
  print = false,
}: {
  spec: ChartSpec;
  data: ChartData;
  fmt: FormatOptions;
  className?: string;
  maxRows?: number;
  caption?: string;
  /** For a PDF or image: no scrollbars (they would be captured), and the cut-off said in words. */
  print?: boolean;
}) {
  const { cols, rows } = React.useMemo(() => tableFor(spec, data, fmt), [spec, data, fmt]);
  const [sort, setSort] = React.useState<{ i: number; dir: 1 | -1 } | null>(null);
  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const x = a[sort.i] ?? null;
      const y = b[sort.i] ?? null;
      // Blanks go last in both directions, so they never crowd the top of a sort.
      if (x === null) return 1;
      if (y === null) return -1;
      return (
        (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) *
        sort.dir
      );
    });
  }, [rows, sort]);
  return (
    <div className={cn("h-full", print ? "overflow-hidden" : "overflow-auto", className)}>
      <table className="w-full border-separate border-spacing-0 text-ui">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="sticky top-0 z-10 bg-surface-1">
          <tr>
            {cols.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={sort?.i === i ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                className={cn(
                  "border-b border-border px-3 py-2 font-medium text-fg-muted",
                  c.numeric ? "text-right" : "text-left",
                )}
              >
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-[6px] hover:text-fg"
                  onClick={() =>
                    setSort((s) =>
                      s?.i === i ? { i, dir: s.dir === 1 ? -1 : 1 } : { i, dir: c.numeric ? -1 : 1 },
                    )
                  }
                >
                  {c.label}
                  {sort?.i === i ? (
                    sort.dir === 1 ? (
                      <ArrowUp className="size-3" aria-hidden />
                    ) : (
                      <ArrowDown className="size-3" aria-hidden />
                    )
                  ) : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, maxRows).map((r, ri) => (
            <tr key={ri} className="transition-colors hover:bg-surface-2">
              {cols.map((c, ci) => {
                const v = r[ci] ?? null;
                return (
                  <td
                    key={c.key}
                    className={cn(
                      "border-b border-border px-3 py-1.5",
                      c.numeric ? "font-figures text-right text-fg" : "max-w-[260px] truncate text-fg",
                      ci === 0 && "font-medium",
                    )}
                    title={typeof v === "string" ? v : undefined}
                  >
                    {c.render ? c.render(v) : v === null ? "—" : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxRows ? (
        <p className="px-3 py-2 text-2xs text-fg-subtle">
          Showing {maxRows} of {rows.length} rows.{" "}
          {print ? "Every row is in the app and in this chart's CSV." : "Export CSV for all."}
        </p>
      ) : null}
    </div>
  );
}
