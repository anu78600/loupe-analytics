/**
 * KPIs the user builds in the Customise step: one aggregate of a column
 * (total, average, minimum, maximum, median, distinct count, or a count of
 * rows), or a ratio of two aggregates (ratio of sums, never an average of
 * ratios). They become ordinary KPI definitions with the same expression
 * language as the templates, so the evaluator, SQL and DAX all agree on them
 * and they export with every other measure.
 *
 * Like the column KPIs (kpi/columnKpis.ts), each column they read gets an
 * identity field ("uk_f_<column>") mapped to it, so resolveKpis sees the
 * field as mapped. Session.configure merges them into the domain before the
 * column KPIs, so a column the user already summarises gets no automatic KPI
 * of its own. A KPI whose column is not in the analysis (hidden, or not in
 * this file) is skipped with a reason, never computed from something else.
 *
 * Automatic names and formulas (aggregateLabel, ratioLabel) are in sentence
 * case, like the template KPIs, and read the column with spaces: "Distinct
 * customer ID" from "Customer_ID", never "Distinct Customer_ID".
 */
import { friendly } from "@/engine/core/labels";
import type { DatasetProfile } from "@/engine/profile/types";
import type { Expr } from "@/engine/query/expr";
import type { FieldDef, KpiDef, KpiFormat } from "@/registry/schema";

export const USER_KPI_PREFIX = "uk_";
/** Group the user's KPIs are listed under (also their Power BI display folder). */
export const USER_KPI_GROUP = "Your KPIs";

export type UserAgg = "sum" | "avg" | "min" | "max" | "median" | "count" | "countDistinct";

export interface UserAggregate {
  agg: UserAgg;
  /** The column aggregated; null only for "count" (rows). */
  column: string | null;
}

export interface UserKpi {
  /** "uk_" + a slug; stable, so layouts and saved configs keep pointing at it. */
  id: string;
  name: string;
  value: UserAggregate;
  /** Set for a ratio: `value` ÷ `per`, each aggregated over the same rows. */
  per?: UserAggregate;
  format: KpiFormat;
  direction: "higher" | "lower" | "neutral";
}

/** True for the id of a user-built KPI or of its identity fields. */
export const isUserKpiId = (id: string): boolean => id.startsWith(USER_KPI_PREFIX);

export const AGG_WORD: Record<UserAgg, string> = {
  sum: "Total",
  avg: "Average",
  min: "Lowest",
  max: "Highest",
  median: "Median",
  count: "Number of rows",
  countDistinct: "Distinct",
};

/** Aggregations that need a numeric column. */
const NUMERIC: ReadonlySet<UserAgg> = new Set(["sum", "avg", "min", "max", "median"]);

/** A column name that already says its aggregation, so "Total amount" never becomes "Total total amount". */
const SAYS: Partial<Record<UserAgg, RegExp>> = {
  sum: /^(total|sum)\b/i,
  avg: /^(average|avg|mean)\b/i,
  min: /^(lowest|min|minimum)\b/i,
  max: /^(highest|max|maximum)\b/i,
  median: /^median\b/i,
  countDistinct: /^(distinct|unique)\b/i,
};

/**
 * A word inside a KPI name: lower case, as KPI names are written in sentence
 * case ("Net revenue"), except acronyms and words with capitals inside them
 * (ID, GST, SKU, eMail), which keep theirs.
 */
const inName = (word: string): string =>
  /^[A-Z0-9%]{2,}$/.test(word) || /[a-z][A-Z]/.test(word) ? word : word.toLowerCase();

/** A label with its first letter capitalised, for the start of a name. */
const capitalised = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A KPI's automatic name, in sentence case with the column read with spaces:
 * "Total revenue", "Distinct customer ID" (from "Customer_ID"), "Average
 * shipping fee", "Number of rows". A column that already says the
 * aggregation keeps its own words ("Total amount").
 */
export function aggregateLabel(a: UserAggregate): string {
  if (a.agg === "count" || !a.column) return AGG_WORD.count;
  const name = friendly(a.column).split(" ").map(inName).join(" ");
  return capitalised(SAYS[a.agg]?.test(name) ? name : `${AGG_WORD[a.agg]} ${name}`);
}

/**
 * A ratio's automatic name: "Total net amount ÷ distinct order ID". The
 * second part is lower case like the rest of the name, unless it starts
 * with an acronym.
 */
export function ratioLabel(top: UserAggregate, bottom: UserAggregate): string {
  const [first = "", ...rest] = aggregateLabel(bottom).split(" ");
  return `${aggregateLabel(top)} ÷ ${[inName(first), ...rest].join(" ")}`;
}

/** A slug for ids: lower-case letters, digits and underscores, never empty. */
export function slugOf(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "kpi"
  );
}

/**
 * Definitions, identity fields and their mapping for the user's KPIs, plus
 * the ones that can't be built and why. `profile` is the analysis profile
 * (hidden columns left out).
 */
export function userKpiExtras(
  kpis: readonly UserKpi[],
  profile: DatasetProfile,
  /** The current mapping (field → column): a column that already serves a field reuses it. */
  mapped: Readonly<Record<string, string>> = {},
): {
  fields: FieldDef[];
  kpis: KpiDef[];
  mapping: Record<string, string>;
  skipped: Array<{ id: string; reason: string }>;
} {
  const out = {
    fields: [] as FieldDef[],
    kpis: [] as KpiDef[],
    mapping: {} as Record<string, string>,
    skipped: [] as Array<{ id: string; reason: string }>,
  };
  const fieldFor = new Map<string, string>(Object.entries(mapped).map(([f, c]) => [c, f]));
  const used = new Set<string>(Object.keys(mapped));
  const field = (column: string): string => {
    const known = fieldFor.get(column);
    if (known) return known;
    let id = `${USER_KPI_PREFIX}f_${slugOf(column)}`;
    for (let n = 2; used.has(id); n++) id = `${USER_KPI_PREFIX}f_${slugOf(column)}_${n}`;
    used.add(id);
    fieldFor.set(column, id);
    const role = profile.columns.find((c) => c.name === column)?.role ?? "measure";
    out.fields.push({ id, label: friendly(column), roles: [role], synonyms: [], weight: 1 });
    out.mapping[id] = column;
    return id;
  };
  // Why an aggregate can't be built here, or null when it can.
  const problem = (a: UserAggregate): string | null => {
    if (a.agg === "count") return null;
    if (!a.column) return "it has no column to summarise";
    const col = profile.columns.find((c) => c.name === a.column);
    if (!col) return `it needs the column "${a.column}", which is hidden or not in this file`;
    if (NUMERIC.has(a.agg) && col.storage !== "number")
      return `"${a.column}" holds ${col.storage === "date" ? "dates" : "text"}, so it can't be ${a.agg === "sum" ? "added up" : "averaged or ranked"}`;
    return null;
  };
  const expr = (a: UserAggregate): Expr =>
    a.agg === "count" || !a.column
      ? { agg: "count" }
      : a.agg === "countDistinct"
        ? { agg: "countDistinct", of: field(a.column) }
        : { agg: a.agg, of: { field: field(a.column) } };
  const seen = new Set<string>();
  kpis.forEach((k, i) => {
    if (!/^uk_[a-z0-9_]+$/.test(k.id) || seen.has(k.id)) {
      out.skipped.push({ id: k.id, reason: "its id is not valid or is used twice" });
      return;
    }
    seen.add(k.id);
    const why = problem(k.value) ?? (k.per ? problem(k.per) : null);
    if (why) {
      out.skipped.push({ id: k.id, reason: `"${k.name}" can't be computed: ${why}.` });
      return;
    }
    const top = aggregateLabel(k.value);
    const bottom = k.per ? aggregateLabel(k.per) : "";
    const formula = k.per ? ratioLabel(k.value, k.per) : top;
    out.kpis.push({
      id: k.id,
      name: k.name.trim() || formula,
      definition: k.per
        ? `${top} divided by ${bottom.charAt(0).toLowerCase()}${bottom.slice(1)}, each over the rows in the selection (a ratio of totals, not an average of row ratios). Built by you.`
        : `${top} over the rows in the selection${k.value.agg === "countDistinct" ? ", blanks not counted" : ""}. Built by you.`,
      formula,
      format: k.format,
      direction: k.direction,
      tier: "detail",
      priority: 200 + i,
      group: USER_KPI_GROUP,
      variants: [
        {
          id: "main",
          label: formula,
          expr: k.per ? { op: "div", args: [expr(k.value), expr(k.per)] } : expr(k.value),
        },
      ],
    });
  });
  return out;
}
