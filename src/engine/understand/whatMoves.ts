/**
 * "What moves {outcome}": the charts that show the outcome against the
 * columns that move it most (version 49.0).
 *
 * Built for two dashboards whose own charts are not designed around the
 * outcome: an industry that fits strongly (its template leads and these
 * follow it, in the drivers section) and a generic dashboard of a shape that
 * keeps its own charts (a time series, a panel, a survey, an event log, a
 * table of transactions). At most MAX_CHARTS, each for a driver of strength
 * MIN_SECTION_STRENGTH or more that the dashboard doesn't already chart
 * against the outcome, strongest first:
 * - a yes/no outcome: its rate by each group of a category (sorted bars),
 *   or by bands of a number;
 * - a score: its average by each group of a category, or a number's
 *   average at each score, in the scale's order;
 * - classes: a number's average in each class, or the class mix of each
 *   group of a category (100% stacked bars);
 * - an amount: its average by each group of a category, or by bands of a
 *   number (in a table of transactions, the average per row: what the
 *   driver statistic compared).
 * The KPIs these charts show are hidden helpers (never cards of their own,
 * so the template's own rate or average keeps its card). Every definition
 * reads the file's columns through the expression AST, so each compiles to
 * SQL and DAX and exports like any other.
 */
import { averageOf, friendly } from "@/engine/core/labels";
import type { ColumnProfile } from "@/engine/profile/types";
import type { Predicate } from "@/engine/query/expr";
import type { ChartTemplate, KpiDef } from "@/registry/schema";
import type { OutcomeType } from "./types";
import type { DriverDetail } from "./drivers";

/** At most this many charts in the section. */
export const MAX_CHARTS = 3;
/** Only drivers at least this strong get a chart of their own. */
export const MIN_SECTION_STRENGTH = 0.2;

/** The outcome as the builder needs it. */
export interface WhatMovesOutcome {
  column: ColumnProfile;
  type: OutcomeType;
  /** "survival", "churn", "quality", "sale price". */
  noun: string;
  /** Binary: how "yes" is spelt. */
  positive: string;
  /** Binary: true when the column holds text (matched by value), false for a yes/no or 0/1 column. */
  text: boolean;
}

export interface WhatMovesInput {
  outcome: WhatMovesOutcome;
  /** Drivers, strongest first (understand/drivers.ts). */
  drivers: readonly DriverDetail[];
  /** Column name → its profile (the analysis profile). */
  columns: ReadonlyMap<string, ColumnProfile>;
  /** The field id that reads a column (the generic domain's own, or a new one for an industry). */
  field: (column: string) => string;
  /** Id prefix of the KPIs built here. */
  kpiPrefix: string;
  /** Id prefix of the charts built here. */
  chartPrefix: string;
  /** Columns the dashboard already charts against the outcome: their drivers get no chart here. */
  shown: ReadonlySet<string>;
  /** Restricts the charts to these sub-domains (an industry's chosen one). */
  subDomains?: string[];
  /** What the rows are called ("passengers"), for the definitions. */
  rowsWord: string;
}

/** A lower-case slug for ids. */
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "col";
const capitalise = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/** The KPI format of an average of a column: money as money, else a decimal. */
const averageFormat = (c: ColumnProfile): KpiDef["format"] =>
  c.role === "currency"
    ? "currency"
    : c.role === "percentage" && c.percentScale === 1
      ? "percent"
      : "decimal";

/** The section's KPIs and charts; empty when no driver qualifies. */
export function whatMoves(input: WhatMovesInput): { kpis: KpiDef[]; charts: ChartTemplate[] } {
  const { outcome, kpiPrefix, chartPrefix, field } = input;
  const o = outcome.column;
  const O = field(o.name);
  const L = friendly(o.name);
  const noun = capitalise(outcome.noun);
  const picked = input.drivers
    .filter(
      (d) => d.strength >= MIN_SECTION_STRENGTH && !input.shown.has(d.column) && input.columns.has(d.column),
    )
    .slice(0, MAX_CHARTS);
  if (!picked.length) return { kpis: [], charts: [] };
  const kpis: KpiDef[] = [];
  const has = (id: string) => kpis.some((k) => k.id === id);
  const hidden = (k: Omit<KpiDef, "hidden" | "tier" | "priority" | "group" | "direction">) => {
    if (!has(k.id))
      kpis.push({
        ...k,
        hidden: true,
        tier: "detail",
        priority: 90,
        group: "What moves the outcome",
        direction: "neutral",
      });
    return k.id;
  };
  // The outcome's own measure: its rate, average or row count.
  const yes: Predicate = outcome.text ? { field: O, in: [outcome.positive] } : { field: O, isTrue: true };
  const rate = () =>
    hidden({
      id: `${kpiPrefix}rate`,
      name: `${noun} rate`,
      definition: `Share of ${input.rowsWord} where ${L} is ${outcome.positive}, out of those with a value.`,
      formula: `${capitalise(input.rowsWord)} where ${L} is ${outcome.positive} ÷ ${input.rowsWord} with a value`,
      format: "percent",
      variants: [
        {
          id: "main",
          label: `${capitalise(input.rowsWord)} where ${L} is ${outcome.positive} ÷ ${input.rowsWord} with a value`,
          expr: {
            op: "div",
            args: [
              { agg: "count", where: yes },
              { agg: "count", where: { field: O, notNull: true } },
            ],
          },
        },
      ],
    });
  const average = (c: ColumnProfile) =>
    hidden({
      id: `${kpiPrefix}avg_${slug(c.name)}`,
      name: averageOf(c.name),
      definition: `Average ${friendly(c.name)} across the ${input.rowsWord}: each row's own value, averaged, never added up.`,
      formula: `Average of ${friendly(c.name)}`,
      format: averageFormat(c),
      variants: [
        {
          id: "main",
          label: `Average of ${friendly(c.name)}`,
          expr: { agg: "avg", of: { field: field(c.name) } },
        },
      ],
    });
  const rows = () =>
    hidden({
      id: `${kpiPrefix}rows`,
      name: "Rows",
      definition: `Number of ${input.rowsWord} (rows).`,
      formula: "Count of rows",
      format: "integer",
      variants: [{ id: "main", label: "Count of rows", expr: { agg: "count" } }],
    });

  const charts: ChartTemplate[] = [];
  picked.forEach((d, i) => {
    const c = input.columns.get(d.column) as ColumnProfile;
    const D = friendly(c.name);
    const F = field(c.name);
    const base = {
      id: `${chartPrefix}${slug(c.name)}`,
      section: "drivers" as const,
      size: { w: 6, h: 4 },
      priority: 80 + i,
      reason: `What moves ${outcome.noun}: ${d.sentence}`,
      modes: ["executive", "analyst", "compact"] as ChartTemplate["modes"],
      ...(input.subDomains ? { subDomains: input.subDomains } : {}),
    };
    const bins = { bins: { field: F }, count: 10, format: "number" as const, label: `${D} band` };
    if (outcome.type === "binary") {
      const m = rate();
      charts.push(
        d.as === "category"
          ? {
              ...base,
              title: `${noun} rate by ${D}`,
              kind: "hbar",
              x: { field: F },
              measures: [m],
              topN: 10,
              others: false,
              minGroupRows: 5,
              alternatives: ["bar", "table"],
            }
          : {
              ...base,
              title: `${noun} rate by ${D} band`,
              kind: "bar",
              x: bins,
              measures: [m],
              alternatives: ["line", "table"],
            },
      );
      return;
    }
    if (outcome.type === "ordinal") {
      charts.push(
        d.as === "category"
          ? {
              ...base,
              title: `${averageOf(o.name)} by ${D}`,
              kind: "hbar",
              x: { field: F },
              measures: [average(o)],
              topN: 10,
              others: false,
              minGroupRows: 5,
              alternatives: ["bar", "table"],
            }
          : {
              ...base,
              title: `${averageOf(c.name)} by ${L}`,
              kind: "bar",
              x: { field: O },
              measures: [average(c)],
              minGroupRows: 5,
              alternatives: ["line", "table"],
            },
      );
      return;
    }
    if (outcome.type === "class") {
      charts.push(
        d.as === "category"
          ? {
              ...base,
              title: `${L} mix by ${D}`,
              kind: "stackedBar100",
              x: { field: F },
              series: { field: O },
              measures: [rows()],
              alternatives: ["stackedBar", "heatmap"],
            }
          : {
              ...base,
              title: `${averageOf(c.name)} by ${L}`,
              kind: "hbar",
              x: { field: O },
              measures: [average(c)],
              alternatives: ["bar", "table"],
            },
      );
      return;
    }
    charts.push(
      d.as === "category"
        ? {
            ...base,
            title: `${averageOf(o.name)} by ${D}`,
            kind: "hbar",
            x: { field: F },
            measures: [average(o)],
            topN: 10,
            others: false,
            minGroupRows: 5,
            alternatives: ["bar", "table"],
          }
        : {
            ...base,
            title: `${averageOf(o.name)} by ${D} band`,
            kind: "bar",
            x: bins,
            measures: [average(o)],
            alternatives: ["line", "table"],
          },
    );
  });
  return { kpis, charts };
}
