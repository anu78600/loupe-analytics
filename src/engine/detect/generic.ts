/**
 * Generic / unknown-domain fallback. Builds a registry-shaped domain from the
 * profile itself (one field per column, profile-driven KPIs and charts) so the
 * normal pipeline (mapping, KPIs, SQL/DAX, exports) works for any table.
 *
 * Heuristics: additive measure columns become totals (currency first, then by
 * absolute sum), with semi-additive balances taken on the latest date when
 * there is a date; rates, percentages and non-additive measures become plain
 * averages (rates and percentages carry an "unweighted" caveat);
 * repeating identifier columns get a distinct count; boolean columns get a
 * "share true" rate; text dimensions with 2–60 values drive the breakdowns.
 * The mapping is the identity: every field is its own column, with score 1.
 * Names and titles read the headers with spaces (core/labels.ts) and count
 * "rows", the word used everywhere else in Loupe.
 */
import type { ColumnProfile, DatasetProfile } from "@/engine/profile/types";
import type { Expr } from "@/engine/query/expr";
import type { ChartTemplate, DomainDef, FieldDef, KpiDef } from "@/registry/schema";
import type { Mapping } from "./mapping";
import { averageOf, friendly, totalOf } from "@/engine/core/labels";

export const GENERIC_ID = "generic";

/** Field id from a column name: lower snake_case, "c_" prefix unless it starts with a letter, de-duplicated. */
function fieldId(name: string, used: Set<string>): string {
  let base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "col";
  if (!/^[a-z]/.test(base)) base = `c_${base}`;
  let id = base;
  let i = 2;
  while (used.has(id)) id = `${base}_${i++}`;
  used.add(id);
  return id;
}

// Totals make sense for additive and semi-additive measures; the rest can only be averaged.
const isMeasure = (c: ColumnProfile) =>
  (c.role === "measure" || c.role === "currency") && c.additivity !== "non-additive";
const isAvgOnly = (c: ColumnProfile) =>
  c.role === "rate" ||
  c.role === "percentage" ||
  ((c.role === "measure" || c.role === "currency") && c.additivity === "non-additive");

/** Builds the fallback domain and its identity mapping from a dataset profile. */
export function buildGenericDomain(profile: DatasetProfile): { domain: DomainDef; mapping: Mapping } {
  const used = new Set<string>();
  const idOf = new Map<string, string>();
  const fields: FieldDef[] = profile.columns.map((c) => {
    const id = fieldId(c.name, used);
    idOf.set(c.name, id);
    return {
      id,
      label: friendly(c.name),
      roles: [c.role],
      synonyms: [c.name, c.name.toLowerCase()],
      weight: 1,
    };
  });
  const fid = (c: ColumnProfile) => idOf.get(c.name) as string;
  const date = profile.primaryDate ? profile.columns.find((c) => c.name === profile.primaryDate) : undefined;
  const measures = profile.columns
    .filter((c) => isMeasure(c) && c.numeric && c.nullPct < 0.95)
    .sort(
      (a, b) =>
        (b.role === "currency" ? 1 : 0) - (a.role === "currency" ? 1 : 0) ||
        Math.abs(b.numeric?.sum ?? 0) - Math.abs(a.numeric?.sum ?? 0),
    );
  const averages = profile.columns.filter((c) => isAvgOnly(c) && c.nullPct < 0.95);
  const ids = profile.columns
    .filter((c) => c.role === "identifier" && c.distinct > 1)
    .sort((a, b) => b.distinct - a.distinct);
  const dims = profile.columns
    .filter(
      (c) =>
        (c.role === "dimension" || c.role === "geo") &&
        c.storage === "string" &&
        c.distinct >= 2 &&
        c.distinct <= 60 &&
        c.nullPct < 0.5,
    )
    .sort((a, b) => a.distinct - b.distinct);
  const flags = profile.columns.filter((c) => c.role === "boolean");
  // A separate time-of-day column (never a date): it gives the hour-of-day pattern.
  const timeOfDay = profile.columns.find((c) => c.role === "time" && c.nullPct < 0.95);

  const kpis: KpiDef[] = [];
  const kpi = (k: Omit<KpiDef, "variants"> & { expr: Expr; caveat?: string }) => {
    const { expr, caveat, ...rest } = k;
    kpis.push({ ...rest, variants: [{ id: "main", label: k.formula, expr, ...(caveat ? { caveat } : {}) }] });
  };
  kpi({
    // The id stays "records" so saved settings keep working; the name is the app's word.
    id: "records",
    name: "Rows",
    definition: "Number of rows in the selection.",
    formula: "Count of rows",
    format: "integer",
    direction: "neutral",
    tier: "hero",
    priority: 1,
    group: "Volume",
    expr: { agg: "count" },
  });
  ids.slice(0, 2).forEach((c, i) => {
    // A unique id's distinct count would just repeat Rows.
    if (c.unique) return;
    kpi({
      id: `distinct_${fid(c)}`,
      name: `Distinct ${friendly(c.name)}`,
      definition: `Number of different ${friendly(c.name)} values.`,
      formula: `Count of distinct ${friendly(c.name)}`,
      format: "integer",
      direction: "neutral",
      tier: i === 0 ? "hero" : "supporting",
      priority: 3 + i,
      group: "Volume",
      expr: { agg: "countDistinct", of: fid(c) },
    });
  });
  measures.slice(0, 5).forEach((c, i) => {
    const sid = `total_${fid(c)}`;
    if (c.additivity === "semi-additive" && date) {
      kpi({
        id: sid,
        name: `${friendly(c.name)} (latest)`,
        definition: `${friendly(c.name)} on the latest date in the selection; it is a balance, so it is not added across dates.`,
        formula: `Sum of ${friendly(c.name)} on the latest ${friendly(date.name)}`,
        format: c.role === "currency" ? "currency" : "number",
        direction: "neutral",
        tier: i < 2 ? "hero" : "supporting",
        priority: 2 + i,
        group: "Measures",
        expr: { atLatest: fid(date), expr: { agg: "sum", of: { field: fid(c) } } },
      });
      return;
    }
    kpi({
      id: sid,
      name: totalOf(c.name),
      definition: `Sum of ${friendly(c.name)} across the selection.`,
      formula: `Sum of ${friendly(c.name)}`,
      format: c.role === "currency" ? "currency" : c.numeric?.integer ? "integer" : "number",
      direction: "higher",
      tier: i < 2 ? "hero" : "supporting",
      priority: 2 + i,
      group: "Measures",
      expr: { agg: "sum", of: { field: fid(c) } },
    });
    if (i === 0) {
      kpi({
        id: `avg_${fid(c)}_per_record`,
        name: `${friendly(c.name)} per row`,
        definition: `Average ${friendly(c.name)} per row (total ÷ rows).`,
        formula: `Sum of ${friendly(c.name)} ÷ rows`,
        format: c.role === "currency" ? "currency" : "decimal",
        direction: "higher",
        tier: "hero",
        priority: 4,
        group: "Measures",
        expr: { op: "div", args: [{ ref: sid }, { ref: "records" }] },
      });
    }
  });
  averages.slice(0, 4).forEach((c, i) => {
    kpi({
      id: `avg_${fid(c)}`,
      name: averageOf(c.name),
      definition: `Simple average of ${friendly(c.name)} across rows.`,
      formula: `Average of ${friendly(c.name)}`,
      format:
        c.role === "percentage"
          ? c.percentScale === 100
            ? "decimal"
            : "percent"
          : c.role === "currency"
            ? "currency"
            : "decimal",
      direction: "neutral",
      tier: "supporting",
      priority: 10 + i,
      group: "Averages",
      expr: { agg: "avg", of: { field: fid(c) } },
      caveat:
        c.role === "rate" || c.role === "percentage"
          ? "Unweighted average of row-level rates; if the underlying counts exist, a ratio of their sums is more accurate."
          : undefined,
    });
  });
  flags.slice(0, 3).forEach((c, i) => {
    kpi({
      id: `rate_${fid(c)}`,
      name: `${friendly(c.name)} rate`,
      definition: `Share of rows where ${friendly(c.name)} is true.`,
      formula: `Rows where ${friendly(c.name)} is true ÷ rows with a value`,
      format: "percent",
      direction: "neutral",
      tier: "supporting",
      priority: 15 + i,
      group: "Flags",
      expr: {
        op: "div",
        args: [
          { agg: "count", where: { field: fid(c), isTrue: true } },
          { agg: "count", where: { field: fid(c), notNull: true } },
        ],
      },
    });
  });

  const primary = kpis.find((k) => k.id.startsWith("total_")) ?? kpis[0];
  const primaryId = primary?.id ?? "records";
  const primaryName = primary?.name ?? "Rows";
  const charts: ChartTemplate[] = [];
  const chart = (c: ChartTemplate) => charts.push(c);
  if (date) {
    chart({
      id: "g_trend",
      title: `${primaryName} over time`,
      kind: "area",
      section: "trend",
      x: { time: fid(date) },
      measures: [primaryId],
      reason: `A date column (${friendly(date.name)}) and a measure: a line over time shows the trend.`,
      alternatives: ["line", "bar"],
      size: { w: 8, h: 4 },
      priority: 1,
    });
    const second =
      kpis.find((k) => k.id.startsWith("total_") && k.id !== primaryId) ??
      kpis.find((k) => k.id === "records");
    if (second)
      chart({
        id: "g_trend2",
        title: `${second.name} over time`,
        kind: second.id === "records" ? "bar" : "line",
        section: "trend",
        x: { time: fid(date) },
        measures: [second.id],
        reason: "A second measure on its own axis (never a dual-axis chart).",
        alternatives: ["line", "area", "bar"],
        size: { w: 4, h: 4 },
        priority: 2,
      });
    chart({
      id: "g_weekday",
      title: "Rows by weekday",
      kind: "bar",
      section: "drivers",
      x: { part: "dow", of: fid(date) },
      measures: ["records"],
      reason: "Day-of-week pattern: columns in calendar order reveal weekly seasonality.",
      alternatives: ["line"],
      size: { w: 4, h: 4 },
      priority: 5,
    });
  }
  if (timeOfDay && !date?.temporal?.hasTime) {
    chart({
      id: "g_hour",
      title: `Rows by hour of ${friendly(timeOfDay.name)}`,
      kind: "bar",
      section: "drivers",
      x: { part: "hour", of: fid(timeOfDay) },
      measures: ["records"],
      reason: `${friendly(timeOfDay.name)} holds times of day: columns by hour show when activity peaks.`,
      alternatives: ["line"],
      size: { w: 4, h: 4 },
      priority: 6,
    });
  }
  dims.slice(0, 3).forEach((d, i) => {
    // IN/US states get a tile map; otherwise sorted bars, or a donut for a small (≤ 6 values) non-first dimension.
    const small = d.distinct <= 6;
    chart({
      id: `g_by_${fid(d)}`,
      title: `${primaryName} by ${friendly(d.name)}`,
      kind:
        d.geoLevel === "state" && (d.geoRegion === "IN" || d.geoRegion === "US")
          ? "geoTile"
          : small && i > 0
            ? "donut"
            : "hbar",
      section: "breakdown",
      x: { field: fid(d) },
      measures: [primaryId],
      topN: 10,
      others: true,
      reason:
        small && i > 0
          ? `Part-to-whole with ${d.distinct} categories: a donut reads at a glance.`
          : `A category (${friendly(d.name)}) and a measure: sorted bars${d.distinct > 10 ? ", top 10 plus Others" : ""}.`,
      alternatives: ["hbar", "bar", "treemap", "donut"],
      size: { w: i === 0 ? 6 : 4, h: 5 },
      priority: 1 + i,
    });
  });
  const firstMeasure = measures[0];
  if (firstMeasure) {
    chart({
      id: "g_hist",
      title: `Distribution of ${friendly(firstMeasure.name)}`,
      kind: "histogram",
      section: "drivers",
      x: {
        bins: { field: fid(firstMeasure) },
        count: 14,
        format: firstMeasure.role === "currency" ? "currency" : "number",
        label: `${friendly(firstMeasure.name)} band`,
      },
      measures: ["records"],
      reason: "One numeric column's spread: a histogram of value bands.",
      alternatives: ["bar"],
      size: { w: 6, h: 4 },
      priority: 2,
    });
  }
  if (measures.length >= 2 && dims[0]) {
    const a = measures[0] as ColumnProfile;
    const b = measures[1] as ColumnProfile;
    chart({
      id: "g_scatter",
      title: `${friendly(a.name)} vs ${friendly(b.name)} by ${friendly(dims[0].name)}`,
      kind: "scatter",
      section: "drivers",
      x: { field: fid(dims[0]) },
      measures: [`total_${fid(a)}`, `total_${fid(b)}`],
      reason: "Two measures per category: a scatter with a trendline shows whether they move together.",
      alternatives: ["table"],
      size: { w: 6, h: 4 },
      priority: 3,
    });
  }
  if (dims.length >= 2) {
    const [r, c] = [dims[0] as ColumnProfile, dims[1] as ColumnProfile];
    if (r.distinct <= 12 && c.distinct <= 24)
      chart({
        id: "g_heatmap",
        title: `${primaryName}: ${friendly(r.name)} × ${friendly(c.name)}`,
        kind: "heatmap",
        section: "drivers",
        x: { field: fid(c) },
        series: { field: fid(r) },
        measures: [primaryId],
        reason: "Two categories and one measure: a heatmap shows where values concentrate.",
        alternatives: ["stackedBar"],
        size: { w: 8, h: 5 },
        priority: 4,
      });
  }
  if (dims[0]) {
    chart({
      id: "g_table",
      title: `Detail by ${friendly(dims[0].name)}`,
      kind: "table",
      section: "detail",
      x: { field: fid(dims[0]) },
      measures: kpis
        .filter((k) => k.tier !== "detail")
        .slice(0, 5)
        .map((k) => k.id),
      topN: 25,
      others: false,
      reason: "Several measures per category: a sortable table.",
      alternatives: ["hbar"],
      size: { w: 12, h: 6 },
      priority: 1,
    });
  }

  const domain: DomainDef = {
    id: GENERIC_ID,
    name: "Generic (profile-driven)",
    tagline: "Any table: KPIs and charts built from the data's own structure",
    description:
      "Used when no industry fits. KPIs and charts come from the profile: measures, dimensions, dates and flags.",
    icon: "table",
    entity: "row",
    fields,
    valueClasses: {},
    // The schema needs one sub-domain with at least one signal; the first field is a placeholder.
    subDomains: [
      {
        id: "table",
        name: "Table",
        description: "Any tabular data.",
        signals: fields.slice(0, 1).map((f) => f.id),
        grain: profile.grain.description,
      },
    ],
    kpis,
    charts,
    pitfalls: [
      "No industry was confirmed, so KPIs are structural (totals, counts, averages) rather than business definitions.",
      "Averages of rate or percentage columns are unweighted; confirm an industry or rebuild the rate from its parts.",
    ],
  };
  const mapping: Mapping = {
    fields: Object.fromEntries(profile.columns.map((c) => [idOf.get(c.name) as string, c.name])),
    scores: Object.fromEntries(profile.columns.map((c) => [idOf.get(c.name) as string, 1])),
    classes: {},
  };
  return { domain, mapping };
}
