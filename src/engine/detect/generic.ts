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
 * Plan and outcome columns (profile.pairs: "Target" and "Achievement",
 * "Sales LY" and "Sales TY") get attainment and variance KPIs, or growth vs
 * last year (kpi/columnKpis.ts pairKpis); the first pair's attainment is a
 * hero.
 *
 * A tall scorecard (profile.tall: "Metric | Month | Value | Target") holds a
 * different metric, in its own unit, on each row, so its value columns are
 * never totalled or averaged across rows. Each metric gets a KPI of its own
 * instead: the main value where the metric column names it, on the latest
 * period when there is one, averaged when several rows (branches, regions)
 * share that period, and charts follow those KPIs. Turning the metrics into
 * columns (parse/pivot.ts) does the rest.
 *
 * The mapping is the identity: every field is its own column, with score 1.
 * Names and titles read the headers with spaces (core/labels.ts) and count
 * "rows", the word used everywhere else in Loupe.
 */
import type { ColumnProfile, DatasetProfile } from "@/engine/profile/types";
import type { Expr } from "@/engine/query/expr";
import type { ChartTemplate, DomainDef, FieldDef, KpiDef } from "@/registry/schema";
import type { Mapping } from "./mapping";
import { averageOf, friendly, totalOf } from "@/engine/core/labels";
import { pairKpis, usablePairs } from "@/engine/kpi/columnKpis";

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

/** At most this many scorecard metrics get KPIs, the first SCORECARD_HEROES of them as heroes. */
const SCORECARD_METRICS = 24;
const SCORECARD_HEROES = 5;
/** At most this many plan/outcome pairs are compared. */
const MAX_PAIRS = 4;

/** A tall scorecard as the analysis profile still has it (no hidden column is read). */
interface Scorecard {
  metric: ColumnProfile;
  value: ColumnProfile;
  metrics: readonly string[];
  /** The period column among the scorecard's id columns, if there is one. */
  period: ColumnProfile | undefined;
  /** The id column that tells several rows of one metric and period apart (a branch), if any. */
  entity: ColumnProfile | undefined;
}

/**
 * Reads profile.tall against the analysis profile: the metric column and the
 * first value column still in it, the period among the id columns, and,
 * when the rows outnumber metrics × periods, the id column with the most
 * values as the entity the metric is reported for. Null when the metric
 * column or every value column is hidden.
 */
function scorecardOf(profile: DatasetProfile): Scorecard | null {
  const tall = profile.tall;
  if (!tall) return null;
  const byName = new Map(profile.columns.map((c) => [c.name, c]));
  const metric = byName.get(tall.metricColumn);
  const value = tall.valueColumns.map((n) => byName.get(n)).find((c) => c !== undefined);
  if (!metric || !value || !tall.metrics.length) return null;
  const ids = tall.idColumns.map((n) => byName.get(n)).filter((c): c is ColumnProfile => c !== undefined);
  const period = ids.find((c) => c.role === "datetime" && c.storage === "date");
  const periods = Math.max(1, period?.distinct ?? 1);
  const entity =
    profile.rowCount > tall.metrics.length * periods
      ? ids.filter((c) => c !== period && c.distinct > 1).sort((a, b) => b.distinct - a.distinct)[0]
      : undefined;
  return { metric, value, metrics: tall.metrics, period, entity };
}

/**
 * One KPI per scorecard metric: the main value column on the rows whose
 * metric column names that metric, taken on the latest period that metric
 * has (the filter applies first, so a metric reported quarterly still shows
 * its last quarter). A metric with one row per period shows that row's value;
 * where several rows share a period (one per branch) they are averaged, each
 * counting once, and the name says so: adding them up is only right for some
 * metrics, and the value column alone can't tell which. Shown as plain
 * numbers, since the unit is in the metric's name, not in the column.
 */
function scorecardKpis(s: Scorecard, fid: (c: ColumnProfile) => string): KpiDef[] {
  const used = new Set<string>();
  const V = friendly(s.value.name);
  const M = friendly(s.metric.name);
  const latest = s.period ? `, on the latest ${friendly(s.period.name)}` : "";
  return s.metrics.slice(0, SCORECARD_METRICS).map((m, i) => {
    const inner: Expr = { agg: "avg", of: { field: fid(s.value) } };
    const expr: Expr = {
      calc: s.period ? { atLatest: fid(s.period), expr: inner } : inner,
      where: { field: fid(s.metric), in: [m] },
    };
    const formula = `${s.entity ? "Average of " : ""}${V} where ${M} is "${m}"${latest}`;
    const definition = s.entity
      ? `${V} where ${M} is "${m}"${latest}, averaged over the ${friendly(s.entity.name)} rows, each counting once. The rows mix metrics in different units, so each metric is read on its own; turn the metrics into columns to total the ones that add up.`
      : `${V} where ${M} is "${m}"${latest}. The rows mix metrics in different units, so each metric is read on its own.`;
    return {
      id: `metric_${fieldId(m, used)}`,
      name: s.entity ? averageOf(m) : m,
      definition,
      formula,
      format: "number",
      direction: "neutral",
      tier: i < SCORECARD_HEROES ? "hero" : i < SCORECARD_HEROES + 12 ? "supporting" : "detail",
      priority: 2 + i,
      group: "Scorecard",
      variants: [
        {
          id: "main",
          label: formula,
          expr,
          ...(s.entity
            ? { caveat: "A simple average across rows; each counts once, whatever its size." }
            : {}),
        },
      ],
    };
  });
}

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
  // A tall scorecard's value columns hold a different metric, in its own unit, on each row: a total or
  // an average across rows would add percentages to rupees, so they feed only the per-metric KPIs.
  const scorecard = scorecardOf(profile);
  const tallValues = new Set(profile.tall?.valueColumns ?? []);
  const measures = profile.columns
    .filter((c) => isMeasure(c) && c.numeric && c.nullPct < 0.95 && !tallValues.has(c.name))
    .sort(
      (a, b) =>
        (b.role === "currency" ? 1 : 0) - (a.role === "currency" ? 1 : 0) ||
        Math.abs(b.numeric?.sum ?? 0) - Math.abs(a.numeric?.sum ?? 0),
    );
  const averages = profile.columns.filter((c) => isAvgOnly(c) && c.nullPct < 0.95 && !tallValues.has(c.name));
  const ids = profile.columns
    .filter((c) => c.role === "identifier" && c.distinct > 1)
    .sort((a, b) => b.distinct - a.distinct);
  // A breakdown by the metric column would put one metric's KPI against the others' empty bars.
  const dims = profile.columns
    .filter(
      (c) =>
        (c.role === "dimension" || c.role === "geo") &&
        c.storage === "string" &&
        c.distinct >= 2 &&
        c.distinct <= 60 &&
        c.nullPct < 0.5 &&
        c.name !== profile.tall?.metricColumn,
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
  if (scorecard) scorecardKpis(scorecard, fid).forEach((k) => kpis.push(k));
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
  // Plan against outcome: attainment and variance (or growth vs last year), the first pair's attainment
  // among the heroes, since it is what a target or budget sheet is kept for.
  const pairSlugs = new Set<string>();
  usablePairs(profile)
    .slice(0, MAX_PAIRS)
    .forEach((p, j) =>
      pairKpis({
        ...p,
        actualField: fid(p.actual),
        targetField: fid(p.target),
        dateField: date ? fid(date) : null,
        dateLabel: date ? friendly(date.name) : "",
        prefix: "",
        used: pairSlugs,
        group: "Plan vs actual",
        tiers: j === 0 ? ["hero", "supporting"] : ["supporting", "supporting"],
        priority: j === 0 ? 2 : 20 + j * 2,
        why: "",
      }).forEach((k) => kpis.push(k)),
    );

  // The scorecard's first metric leads the charts; otherwise the largest total, else the row count.
  const primary =
    kpis.find((k) => k.id.startsWith("metric_")) ?? kpis.find((k) => k.id.startsWith("total_")) ?? kpis[0];
  const primaryId = primary?.id ?? "records";
  const primaryName = primary?.name ?? "Rows";
  // A scorecard's metrics are values at a point in time, never parts of a whole: no donuts, lines not areas.
  const levels = Boolean(scorecard);
  const charts: ChartTemplate[] = [];
  const chart = (c: ChartTemplate) => charts.push(c);
  if (date) {
    chart({
      id: "g_trend",
      title: `${primaryName} over time`,
      kind: levels ? "line" : "area",
      section: "trend",
      x: { time: fid(date) },
      measures: [primaryId],
      reason: levels
        ? `${primaryName} on each ${friendly(date.name)}: a line shows how the metric moves.`
        : `A date column (${friendly(date.name)}) and a measure: a line over time shows the trend.`,
      alternatives: levels ? ["bar"] : ["line", "bar"],
      size: { w: 8, h: 4 },
      priority: 1,
    });
    const second = levels
      ? kpis.find((k) => k.id.startsWith("metric_") && k.id !== primaryId)
      : (kpis.find((k) => k.id.startsWith("total_") && k.id !== primaryId) ??
        kpis.find((k) => k.id === "records"));
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
    // A scorecard's rows are metrics, not events, so counting them by weekday would mean nothing.
    if (!levels)
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
    // IN/US states get a tile map; otherwise sorted bars, or a donut for a small (≤ 6 values) non-first
    // dimension, unless the measure is a scorecard metric, which is no part of a whole.
    const small = d.distinct <= 6 && !levels;
    chart({
      id: `g_by_${fid(d)}`,
      title: `${primaryName} by ${friendly(d.name)}`,
      kind:
        d.geoLevel === "state" && (d.geoRegion === "IN" || d.geoRegion === "US") && !levels
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
      ...(profile.tall
        ? [
            "Each row holds a different metric in its own unit, so nothing adds or averages the value columns across metrics; each metric is read on its own.",
          ]
        : []),
    ],
  };
  const mapping: Mapping = {
    fields: Object.fromEntries(profile.columns.map((c) => [idOf.get(c.name) as string, c.name])),
    scores: Object.fromEntries(profile.columns.map((c) => [idOf.get(c.name) as string, 1])),
    classes: {},
  };
  return { domain, mapping };
}
