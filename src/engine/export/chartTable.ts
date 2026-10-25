/**
 * A chart's numbers as a table (version 56.0): the header, the rows and the
 * format of each column, shaped per analysis type (RFM segments, cohorts,
 * basket pairs, a heatmap's matrix, a funnel, else one row per category with
 * a column per series and its row count). The chart CSV (Session.chartCsv)
 * and the Excel workbook's chart sheets (workbook.ts) both read it, so the
 * two never disagree. Computed figures are rounded to 12 significant digits,
 * so float noise from summing doesn't read as precision.
 */
import type { TimeGrain } from "@/engine/core/dates";
import type { ValueFormat } from "@/engine/core/format";
import type { ChartData } from "@/engine/charts/types";
import { roundAggregate } from "./csv";

export type TableCell = string | number | null;

export interface ChartTable {
  header: string[];
  rows: TableCell[][];
  /** Each column's format: a value format for figures, "text" for labels. */
  formats: Array<ValueFormat | "text">;
  /** A time axis: each row's period start (wall-clock ms) and the grain, so a workbook can write real dates. */
  time?: { starts: Array<number | null>; grain: TimeGrain };
}

const round = (rows: TableCell[][]) =>
  rows.map((r) => r.map((c) => (typeof c === "number" ? roundAggregate(c) : c)));

/** The table of a computed chart. */
export function chartTable(data: ChartData): ChartTable {
  const table = (header: string[], formats: ChartTable["formats"], rows: TableCell[][]): ChartTable => ({
    header,
    rows: round(rows),
    formats,
  });
  if (data.rfm)
    return table(
      [
        "Segment",
        "Customers",
        "Customer share",
        "Revenue",
        "Revenue share",
        "Average recency (days)",
        "Average frequency",
        "Average monetary value",
      ],
      ["text", "integer", "percent", "currency", "percent", "decimal", "decimal", "currency"],
      data.rfm.map((s) => [
        s.segment,
        s.customers,
        s.customerShare,
        s.revenue,
        s.revenueShare,
        s.avgRecency,
        s.avgFrequency,
        s.avgMonetary,
      ]),
    );
  if (data.cohorts) {
    const months = data.cohorts[0]?.retention.length ?? 0;
    return table(
      ["Cohort", "Customers", ...Array.from({ length: months }, (_, i) => `Month ${i}`)],
      ["text", "integer", ...Array.from({ length: months }, () => "percent" as const)],
      data.cohorts.map((c) => [c.label, c.size, ...c.retention]),
    );
  }
  if (data.basket)
    return table(
      ["Item A", "Item B", "Orders together", "Support", "Confidence A→B", "Confidence B→A", "Lift"],
      ["text", "text", "integer", "percent", "percent", "percent", "ratio"],
      data.basket.pairs.map((p) => [p.a, p.b, p.orders, p.support, p.confidenceAB, p.confidenceBA, p.lift]),
    );
  if (data.matrix && data.seriesCategories) {
    const format = data.series[0]?.format ?? "number";
    return table(
      ["", ...data.categories.map((c) => c.label)],
      ["text", ...data.categories.map(() => format)],
      data.seriesCategories.map((s, i) => [s.label, ...(data.matrix?.[i] ?? [])]),
    );
  }
  if (data.funnel)
    return table(
      ["Stage", "Value", "From previous", "From first"],
      ["text", "number", "percent", "percent"],
      data.funnel.map((f) => [f.label, f.value, f.fromPrev, f.fromFirst]),
    );
  const out = table(
    [data.axisLabel ?? "Category", ...data.series.map((s) => s.label), "Rows"],
    ["text", ...data.series.map((s) => s.format), "integer"],
    data.categories.map((c, i) => [
      c.label,
      ...data.series.map((s) => s.values[i] ?? null),
      data.rows[i] ?? null,
    ]),
  );
  if (data.grain && data.categories.every((c) => typeof c.raw === "number"))
    out.time = { starts: data.categories.map((c) => c.raw as number), grain: data.grain };
  return out;
}
