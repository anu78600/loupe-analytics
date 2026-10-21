/**
 * Generic / unknown-domain fallback. Builds a registry-shaped domain from the
 * profile itself (one field per column, profile-driven KPIs and charts) so the
 * normal pipeline (mapping, KPIs, SQL/DAX, exports) works for any table.
 *
 * The dashboard follows what the table is (detect/tableShape.ts, whose
 * sentence becomes the domain's description and whose shape names its one
 * sub-domain):
 * - time series and panels: entities and periods counted; each level (a
 *   temperature, a price, a rate, a population) read on the latest period,
 *   averaged across the entities reported then, and averaged for its trend,
 *   never added across dates; amounts that add up totalled; a panel reads
 *   every measure on the latest period and shows each entity's latest value;
 * - surveys: responses, % favourable (the top two boxes) per scale question,
 *   the average of each rating, and NPS when a 0–10 "recommend" question
 *   exists; a chart of the answers to each of the first questions;
 * - labelled practice tables: the outcome rate (or each class's share), the
 *   average of each feature, the rate by category and by bands of the first
 *   feature;
 * - tables of measurements rated on a short scale (a wine's quality of 3–9):
 *   the rows, named from the file name ("Wines"), the average score, the
 *   share at the top of the scale with the bar in its name ("Share rated 7
 *   or above"), and the characteristics ranked by how closely each moves
 *   with the score (Pearson r, read from the rows): the closest one's
 *   average, the score distribution, the three closest by score, a scatter
 *   of the closest against the score and a table of the four closest, every
 *   axis in the scale's order and nothing summed;
 * - event logs: events and the distinct ids they belong to, by weekday;
 * - lookups and plain lists: the totals, averages and distinct counts below.
 * Every shape gets a breakdown of its main category, the spread of its main
 * measure, a scatter of the two measures that move together most closely
 * (read from the rows, when the dataset is passed) and a heatmap of two
 * categories (a panel's entities across its years when it has one category).
 *
 * Elsewhere, additive measure columns become totals (currency first, then by
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
 *
 * genericFill lends these charts to an industry's dashboard when its
 * template builds fewer than three (an industry chosen for a file it hardly
 * fits): the generic dashboard of the columns the template doesn't read,
 * with ids of its own, in the "From your other columns" section.
 */
import type { ColumnProfile, DatasetProfile } from "@/engine/profile/types";
import { columnByName, type Dataset } from "@/engine/core/types";
import { pearson, systematicSample } from "@/engine/core/stats";
import {
  fieldsOf,
  isAdditiveExpr,
  refsOf,
  type Expr,
  type Predicate,
  type RowExpr,
} from "@/engine/query/expr";
import type { AxisDef, ChartTemplate, DomainDef, FieldDef, KpiDef } from "@/registry/schema";
import type { Mapping } from "./mapping";
import { averageOf, friendly, totalOf } from "@/engine/core/labels";
import { COLUMN_GROUP, COLUMN_PREFIX, pairKpis, usablePairs } from "@/engine/kpi/columnKpis";
import type { KpiResolutionMap } from "@/engine/kpi/resolve";
import { withoutColumns } from "@/engine/profile/hidden";
import { CADENCE_NOUN, describeTable, nounOf, pluralOf, type TableShape } from "./tableShape";

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
/** Group of the plan-against-outcome KPIs (attainment, variance, growth). */
const PAIR_GROUP = "Plan vs actual";

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

/**
 * Name words of a level: a reading that is never added across dates (a
 * temperature, a price, an index, a population), whatever the column's
 * additivity says about adding it across rows of one date.
 */
const LEVEL_TOKENS = new Set([
  "temp",
  "temperature",
  "humidity",
  "pressure",
  "price",
  "index",
  "level",
  "speed",
  "wind",
  "score",
  "rating",
  "population",
  "nav",
  "close",
  "open",
  "high",
  "low",
  "min",
  "max",
  "minimum",
  "maximum",
  "average",
  "avg",
  "mean",
  "median",
  "rate",
  "ratio",
  "yield",
  "density",
  "interest",
  "visibility",
  "dew",
  "cloud",
  "elevation",
  "altitude",
  "depth",
  "concentration",
  "aqi",
]);
/** The same stems inside a fused or abbreviated header ("Humidity3pm", "MinTemp"). */
const LEVEL_STEMS = /temp|humid|pressure|popul|price|index|speed|wind/i;

/** A reading of a level, never summed across dates: not additive, a rate, or named like one. */
function isLevel(c: ColumnProfile): boolean {
  return (
    c.additivity !== "additive" ||
    c.role === "rate" ||
    c.role === "percentage" ||
    c.tokens.some((t) => LEVEL_TOKENS.has(t)) ||
    LEVEL_STEMS.test(c.name)
  );
}

/** How an average of a column is shown: money as money, percentages as stored, anything else with decimals. */
function averageFormat(c: ColumnProfile): KpiDef["format"] {
  if (c.role === "percentage") return c.percentScale === 100 ? "decimal" : "percent";
  return c.role === "currency" ? "currency" : "decimal";
}

/** How a sum of a column is shown. */
const sumFormat = (c: ColumnProfile): KpiDef["format"] =>
  c.role === "currency" ? "currency" : c.numeric?.integer ? "integer" : "number";

const capitalise = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
/** "Average GDP" → "average GDP" inside a name; a leading acronym keeps its capitals. */
const lowerFirst = (s: string) => (/^[A-Z0-9]{2,}/.test(s) ? s : `${s.charAt(0).toLowerCase()}${s.slice(1)}`);

/** Above this many rows, correlations are read from an evenly spaced sample of rows. */
const CORRELATION_SAMPLE = 200_000;

/**
 * The two measures that move together most closely across rows: the largest
 * |Pearson r| among the first ten candidates, over the rows that have both.
 * Pairs that are the same figure twice (|r| above 0.9995, a total beside its
 * copy) say nothing and are passed over. Null when no pair has ten rows.
 */
function mostCorrelated(
  ds: Dataset,
  cols: readonly ColumnProfile[],
): { a: ColumnProfile; b: ColumnProfile; r: number } | null {
  const sample = ds.rowCount > CORRELATION_SAMPLE ? systematicSample(ds.rowCount, CORRELATION_SAMPLE) : null;
  const series = cols.slice(0, 10).flatMap((c) => {
    const col = columnByName(ds, c.name);
    if (col?.kind !== "number") return [];
    const v = col.values;
    return [{ c, v: sample ? Float64Array.from(sample, (i) => v[i] as number) : v }];
  });
  let best: { a: ColumnProfile; b: ColumnProfile; r: number } | null = null;
  for (let i = 0; i < series.length; i++)
    for (let j = i + 1; j < series.length; j++) {
      const x = series[i] as (typeof series)[number];
      const y = series[j] as (typeof series)[number];
      const { r, n } = pearson(x.v, y.v);
      if (!Number.isFinite(r) || n < 10 || Math.abs(r) > 0.9995) continue;
      if (!best || Math.abs(r) > Math.abs(best.r)) best = { a: x.c, b: y.c, r };
    }
  return best;
}

/**
 * Each measure's Pearson r with `target` across the rows that have both,
 * strongest link (largest |r|) first, file order on ties. Measures with fewer
 * than ten such rows, or no spread, are left out, and so is a copy of the
 * target (|r| above 0.9995). Above CORRELATION_SAMPLE rows an evenly spaced
 * sample is read.
 */
function correlations(
  ds: Dataset,
  target: ColumnProfile,
  cols: readonly ColumnProfile[],
): Array<{ c: ColumnProfile; r: number }> {
  const sample = ds.rowCount > CORRELATION_SAMPLE ? systematicSample(ds.rowCount, CORRELATION_SAMPLE) : null;
  const pick = (v: Float64Array) => (sample ? Float64Array.from(sample, (i) => v[i] as number) : v);
  const t = columnByName(ds, target.name);
  if (t?.kind !== "number") return [];
  const y = pick(t.values);
  return cols
    .flatMap((c) => {
      const col = columnByName(ds, c.name);
      if (col?.kind !== "number") return [];
      const { r, n } = pearson(pick(col.values), y);
      return Number.isFinite(r) && n >= 10 && Math.abs(r) <= 0.9995 ? [{ c, r }] : [];
    })
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}

/** A correlation as analysts write it: two decimals and a true minus sign ("r = −0.31"). */
const rText = (r: number) => `r = ${r.toFixed(2).replace("-", "−")}`;

/** Name words of a score where a higher value is better (a wine's quality, a grade, a rating). */
const BETTER_HIGHER = new Set(["quality", "grade", "rating", "score"]);

/** The fallback domain, its identity mapping, and what the table is. */
export interface GenericDomain {
  domain: DomainDef;
  mapping: Mapping;
  /** The table's shape and its plain description (detect/tableShape.ts). */
  shape: TableShape;
}

/**
 * Builds the fallback domain and its identity mapping from a dataset profile.
 * `ds`, when given, is read only to find the two measures that move together
 * most closely (the scatter chart); every other choice comes from the profile.
 * Pass the analysis profile, so a hidden column is never read.
 */
export function buildGenericDomain(profile: DatasetProfile, ds?: Dataset): GenericDomain {
  // The file name only names what a rated table's rows are ("winequality-white.csv": wines).
  const shape = describeTable(profile, ds?.source.fileName);
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
  const label = (c: ColumnProfile) => friendly(c.name);
  const date = profile.primaryDate ? profile.columns.find((c) => c.name === profile.primaryDate) : undefined;
  // A tall scorecard's value columns hold a different metric, in its own unit, on each row: a total or
  // an average across rows would add percentages to rupees, so they feed only the per-metric KPIs.
  const scorecard = scorecardOf(profile);
  const tallValues = new Set(profile.tall?.valueColumns ?? []);
  // The outcome and the survey's questions have KPIs of their own; they are no plain measure or category.
  const special = new Set<string>([
    ...(shape.outcome ? [shape.outcome.column.name] : []),
    ...shape.likert.map((q) => q.column.name),
    ...shape.ratings.map((q) => q.column.name),
  ]);
  const measures = profile.columns
    .filter(
      (c) => isMeasure(c) && c.numeric && c.nullPct < 0.95 && !tallValues.has(c.name) && !special.has(c.name),
    )
    .sort(
      (a, b) =>
        (b.role === "currency" ? 1 : 0) - (a.role === "currency" ? 1 : 0) ||
        Math.abs(b.numeric?.sum ?? 0) - Math.abs(a.numeric?.sum ?? 0),
    );
  const averages = profile.columns.filter(
    (c) => isAvgOnly(c) && c.nullPct < 0.95 && !tallValues.has(c.name) && !special.has(c.name),
  );
  const ids = profile.columns
    .filter((c) => c.role === "identifier" && c.distinct > 1)
    .sort((a, b) => b.distinct - a.distinct);
  const entity = shape.entity;
  const timeShaped = (shape.kind === "timeSeries" || shape.kind === "panel") && shape.period !== null;
  // A breakdown by the metric column would put one metric's KPI against the others' empty bars; the
  // entity of a time series or panel gets a breakdown of its own, first.
  const dims = profile.columns
    .filter(
      (c) =>
        (c.role === "dimension" || c.role === "geo") &&
        c.storage === "string" &&
        c.distinct >= 2 &&
        c.distinct <= 60 &&
        c.nullPct < 0.5 &&
        c.name !== profile.tall?.metricColumn &&
        !special.has(c.name) &&
        !(timeShaped && c === entity),
    )
    .sort((a, b) => a.distinct - b.distinct);
  const flags = profile.columns.filter((c) => c.role === "boolean" && !special.has(c.name));
  // A separate time-of-day column (never a date): it gives the hour-of-day pattern.
  const timeOfDay = profile.columns.find((c) => c.role === "time" && c.nullPct < 0.95);
  // A table of measurements rated on a short scale (a wine's quality of 3–9): what its rows are ("wine",
  // from the file name, or rows), and its characteristics ranked by how closely each moves with the
  // score across the rows, read from the data. Without the rows they keep their order and no r is quoted.
  const ordinal =
    shape.kind === "labelled" && shape.outcome?.kind === "ordinal" ? shape.outcome.column : null;
  const rowNoun = ordinal ? shape.noun : null;
  const linked = ordinal && ds ? correlations(ds, ordinal, shape.measures) : [];
  const features = ordinal
    ? [...linked.map((x) => x.c), ...shape.measures.filter((c) => !linked.some((x) => x.c === c))]
    : shape.measures;

  const kpis: KpiDef[] = [];
  const has = (id: string) => kpis.some((k) => k.id === id);
  const kpi = (k: Omit<KpiDef, "variants"> & { expr: Expr; caveat?: string }) => {
    const { expr, caveat, ...rest } = k;
    kpis.push({ ...rest, variants: [{ id: "main", label: k.formula, expr, ...(caveat ? { caveat } : {}) }] });
  };
  const rateCaveat = (c: ColumnProfile) =>
    c.role === "rate" || c.role === "percentage"
      ? "Unweighted average of row-level rates; if the underlying counts exist, a ratio of their sums is more accurate."
      : undefined;
  /** "Average <column>" over the selection, added once (the scatter and the trends read it too). */
  const ensureAverage = (c: ColumnProfile, tier: KpiDef["tier"] = "detail", priority = 60): string => {
    const id = `avg_${fid(c)}`;
    if (!has(id))
      kpi({
        id,
        name: averageOf(c.name),
        definition: `Simple average of ${label(c)} across rows.`,
        formula: `Average of ${label(c)}`,
        format: averageFormat(c),
        direction: "neutral",
        tier,
        priority,
        group: "Averages",
        expr: { agg: "avg", of: { field: fid(c) } },
        caveat: rateCaveat(c),
      });
    return id;
  };

  kpi({
    // The id stays "records" so saved settings keep working; the name is the app's word, or the shape's.
    id: "records",
    name:
      shape.kind === "survey"
        ? "Responses"
        : shape.kind === "eventLog"
          ? "Events"
          : rowNoun
            ? capitalise(pluralOf(rowNoun))
            : "Rows",
    definition:
      shape.kind === "survey"
        ? "Number of survey responses (rows) in the selection."
        : shape.kind === "eventLog"
          ? "Number of events (rows) in the selection."
          : rowNoun
            ? `Number of ${pluralOf(rowNoun)} (rows) in the selection.`
            : "Number of rows in the selection.",
    formula: "Count of rows",
    format: "integer",
    direction: "neutral",
    // In a time series or a panel the entities and periods say more than the row count.
    tier: timeShaped ? "supporting" : "hero",
    priority: 1,
    group: "Volume",
    expr: { agg: "count" },
  });
  if (scorecard) scorecardKpis(scorecard, fid).forEach((k) => kpis.push(k));

  if (timeShaped) {
    // Time series and panels: how many entities and periods, then each measure the way a reading is
    // read. A level (a temperature, a price, a rate, a population) is taken on the latest period,
    // averaged across the entities reported then, and averaged over the selection for the trend; it
    // is never added across dates. Amounts that add up (sales, rainfall) are totalled. In a panel
    // every measure is read on the latest period.
    const period = shape.period as ColumnProfile;
    const P = fid(period);
    const unit = CADENCE_NOUN[shape.cadence ?? "day"];
    const when = label(period);
    const dated = period.storage === "date";
    if (entity)
      kpi({
        id: `distinct_${fid(entity)}`,
        name: capitalise(pluralOf(nounOf(entity))),
        definition: `Number of different ${label(entity)} values in the selection.`,
        formula: `Count of distinct ${label(entity)}`,
        format: "integer",
        direction: "neutral",
        tier: "hero",
        priority: 2,
        group: "Volume",
        expr: { agg: "countDistinct", of: fid(entity) },
      });
    kpi({
      id: `periods_${P}`,
      name: capitalise(pluralOf(unit)),
      definition: `Number of different ${when} values in the selection: the ${pluralOf(unit)} it covers.`,
      formula: `Count of distinct ${when}`,
      format: "integer",
      direction: "neutral",
      tier: shape.kind === "panel" ? "hero" : "supporting",
      priority: 3,
      group: "Volume",
      expr: { agg: "countDistinct", of: P },
    });
    const across = entity ? `, averaged across the ${pluralOf(nounOf(entity))} reported then` : "";
    shape.measures.slice(0, 24).forEach((c, i) => {
      const L = label(c);
      const tier: KpiDef["tier"] = i < 2 ? "hero" : i < 4 ? "supporting" : "detail";
      if (shape.kind === "panel" || isLevel(c)) {
        // A balance in a time series adds up across the entities of one date, never across dates.
        const semi = shape.kind === "timeSeries" && c.additivity === "semi-additive";
        kpi({
          id: `latest_${fid(c)}`,
          name: entity && !semi ? `Latest ${lowerFirst(averageOf(c.name))}` : `Latest ${L}`,
          definition: semi
            ? `${L} on the latest ${when} in the selection, summed: it is a balance, so it is not added across dates.`
            : `${L} on the latest ${when} in the selection${across}. A level is never added across dates${dated ? "; the card compares it with the period before" : ""}.`,
          formula: `${semi ? "Sum" : "Average"} of ${L} on the latest ${when}`,
          format: semi ? sumFormat(c) : averageFormat(c),
          direction: "neutral",
          tier,
          priority: 4 + i,
          group: "Latest",
          expr: {
            atLatest: P,
            expr: semi ? { agg: "sum", of: { field: fid(c) } } : { agg: "avg", of: { field: fid(c) } },
          },
          caveat:
            entity && !semi
              ? "A simple average across entities; each counts once, whatever its size."
              : undefined,
        });
        ensureAverage(c, i < 4 ? "supporting" : "detail", 30 + i);
        return;
      }
      kpi({
        id: `total_${fid(c)}`,
        name: totalOf(c.name),
        definition: `Sum of ${L} across the selection: an amount that adds up across dates${entity ? ` and ${pluralOf(nounOf(entity))}` : ""}.`,
        formula: `Sum of ${L}`,
        format: sumFormat(c),
        direction: "neutral",
        tier,
        priority: 4 + i,
        group: "Measures",
        expr: { agg: "sum", of: { field: fid(c) } },
      });
    });
  }

  if (shape.kind === "survey") {
    // Surveys: the top two boxes of each scale question, the average of each rating, and the Net
    // Promoter Score when a 0–10 "would you recommend" question exists.
    if (shape.nps) {
      const N = fid(shape.nps);
      kpi({
        id: `nps_${N}`,
        name: "Net promoter score (NPS)",
        short: "NPS",
        definition: `Promoters (answers of 9 or 10 to ${label(shape.nps)}) minus detractors (0 to 6), as a share of the rows that answered it, × 100: from −100 to +100.`,
        formula: "(Promoters − detractors) ÷ answers × 100",
        format: "decimal",
        direction: "higher",
        tier: "hero",
        priority: 2,
        group: "Survey",
        expr: {
          op: "mul",
          args: [
            { num: 100 },
            {
              op: "div",
              args: [
                {
                  op: "sub",
                  args: [
                    { agg: "count", where: { field: N, cmp: "gte", value: 9 } },
                    { agg: "count", where: { field: N, cmp: "lte", value: 6 } },
                  ],
                },
                { agg: "count", where: { field: N, notNull: true } },
              ],
            },
          ],
        },
      });
    }
    shape.likert.slice(0, 12).forEach((q, i) => {
      const Q = label(q.column);
      const F = fid(q.column);
      const top = q.favourable.map((v) => `"${v}"`).join(" or ");
      kpi({
        id: `fav_${F}`,
        name: `${Q}: % favourable`,
        definition: `Share of the answers to ${Q} that are ${top} (the top two boxes), out of the rows that answered it.`,
        formula: `Answers of ${top} ÷ answers`,
        format: "percent",
        direction: "higher",
        tier: i < 3 ? "hero" : i < 9 ? "supporting" : "detail",
        priority: 3 + i,
        group: "Survey",
        expr: {
          op: "div",
          args: [
            { agg: "count", where: { field: F, in: q.favourable } },
            { agg: "count", where: { field: F, notNull: true } },
          ],
        },
      });
    });
    shape.ratings
      .filter((r) => r.column !== shape.nps)
      .slice(0, 8)
      .forEach((r, i) => {
        const Q = label(r.column);
        kpi({
          id: `avg_${fid(r.column)}`,
          name: averageOf(r.column.name),
          definition: `Average answer to ${Q}, on its ${r.min}–${r.max} scale, over the rows that answered it.`,
          formula: `Average of ${Q}`,
          format: "decimal",
          direction: "higher",
          tier: i < 2 && shape.likert.length < 2 ? "hero" : i < 8 ? "supporting" : "detail",
          priority: 15 + i,
          group: "Survey",
          expr: { agg: "avg", of: { field: fid(r.column) } },
        });
      });
  }

  if (shape.kind === "labelled" && shape.outcome) {
    // A practice table: how often the outcome happens, and the average of each feature (each row is
    // one case, so features are averaged, never added up).
    const o = shape.outcome.column;
    const O = fid(o);
    const L = label(o);
    if (shape.outcome.kind === "binary") {
      kpi({
        id: `rate_${O}`,
        name: `${L} rate`,
        definition: `Share of rows where ${L} is yes (true or 1), out of the rows with a value.`,
        formula: `Rows where ${L} is yes ÷ rows with a value`,
        format: "percent",
        direction: "neutral",
        tier: "hero",
        priority: 2,
        group: "Outcome",
        expr: {
          op: "div",
          args: [
            { agg: "count", where: { field: O, isTrue: true } },
            { agg: "count", where: { field: O, notNull: true } },
          ],
        },
      });
      kpi({
        id: `yes_${O}`,
        name: `${L}: yes`,
        definition: `Number of rows where ${L} is yes (true or 1).`,
        formula: `Count of rows where ${L} is yes`,
        format: "integer",
        direction: "neutral",
        tier: "supporting",
        priority: 3,
        group: "Outcome",
        expr: { agg: "count", where: { field: O, isTrue: true } },
      });
    } else if (shape.outcome.kind === "ordinal" && o.numeric) {
      // A score on a short scale: its average, and how many reach the top of the scale. The bar is named
      // in the KPI: the top two points of a 1–5 or 1–7 scale, 7 and above on a scale up to 10.
      const { min, max } = o.numeric;
      const topTwo = max <= 7;
      const bar = topTwo ? max - 1 : 7;
      const direction: KpiDef["direction"] = o.tokens.some((t) => BETTER_HIGHER.has(t))
        ? "higher"
        : "neutral";
      const rowsWord = rowNoun ? pluralOf(rowNoun) : "rows";
      const scale = topTwo
        ? `the top two points of its ${min}–${max} scale`
        : `the top of a scale that runs to 10 (the values here run ${min}–${max})`;
      const reaching: Predicate = { field: O, cmp: "gte", value: bar };
      kpi({
        id: `avg_${O}`,
        name: averageOf(o.name),
        definition: `Average ${L} of the ${rowsWord} in the selection, on its ${min}–${max} scale. A score is averaged, never added up.`,
        formula: `Average of ${L}`,
        format: "decimal",
        direction,
        tier: "hero",
        priority: 2,
        group: "Outcome",
        expr: { agg: "avg", of: { field: O } },
      });
      kpi({
        id: `top_${O}`,
        name: `Share rated ${bar} or above`,
        definition: `Share of the ${rowsWord} whose ${L} is ${bar} or above, out of those with a ${L}: ${scale}.`,
        formula: `${capitalise(rowsWord)} with a ${L} of ${bar} or above ÷ ${rowsWord} with a ${L}`,
        format: "percent",
        direction,
        tier: "hero",
        priority: 3,
        group: "Outcome",
        expr: {
          op: "div",
          args: [
            { agg: "count", where: reaching },
            { agg: "count", where: { field: O, notNull: true } },
          ],
        },
      });
      kpi({
        id: `topn_${O}`,
        name: `Rated ${bar} or above`,
        definition: `Number of ${rowsWord} whose ${L} is ${bar} or above: ${scale}.`,
        formula: `Count of ${rowsWord} with a ${L} of ${bar} or above`,
        format: "integer",
        direction,
        tier: "supporting",
        priority: 4,
        group: "Outcome",
        expr: { agg: "count", where: reaching },
      });
    } else {
      kpi({
        id: `classes_${O}`,
        name: `Distinct ${L}`,
        definition: `Number of different ${L} values (classes) in the selection.`,
        formula: `Count of distinct ${L}`,
        format: "integer",
        direction: "neutral",
        tier: "supporting",
        priority: 3,
        group: "Outcome",
        expr: { agg: "countDistinct", of: O },
      });
      const slugs = new Set<string>();
      (o.categorical?.top ?? []).slice(0, 4).forEach((v, i) =>
        kpi({
          id: `share_${O}_${fieldId(v.value, slugs)}`,
          name: `Share of ${v.value}`,
          definition: `Share of rows whose ${L} is "${v.value}", out of the rows with a value.`,
          formula: `Rows where ${L} is "${v.value}" ÷ rows with a value`,
          format: "percent",
          direction: "neutral",
          tier: i < 2 ? "hero" : "supporting",
          priority: 2 + i,
          group: "Outcome",
          expr: {
            op: "div",
            args: [
              { agg: "count", where: { field: O, in: [v.value] } },
              { agg: "count", where: { field: O, notNull: true } },
            ],
          },
        }),
      );
    }
    // A rated table's characteristics come ranked by how closely each moves with the score: the closest
    // is a hero, the next three (charted by score) support it.
    features.slice(0, 12).forEach((c, i) => {
      const link = ordinal && i === 0 ? linked[0] : undefined;
      kpi({
        id: `avg_${fid(c)}`,
        name: averageOf(c.name),
        definition: ordinal
          ? `Average ${label(c)} across the ${rowNoun ? pluralOf(rowNoun) : "rows"} in the selection. Each row is one ${rowNoun ?? "case"} measured, so a characteristic is averaged, not added up.${link ? ` Of the measured characteristics, ${label(c)} moves most closely with ${L} (${rText(link.r)}).` : ""}`
          : `Average ${label(c)} across the rows in the selection. Each row is one case, so a feature is averaged, not added up.`,
        formula: `Average of ${label(c)}`,
        format: averageFormat(c),
        direction: "neutral",
        tier: ordinal
          ? i === 0
            ? "hero"
            : i < 4
              ? "supporting"
              : "detail"
          : i < 2
            ? "hero"
            : i < 6
              ? "supporting"
              : "detail",
        priority: ordinal && i === 0 ? 5 : 6 + i,
        group: "Features",
        expr: { agg: "avg", of: { field: fid(c) } },
        caveat: rateCaveat(c),
      });
    });
  }

  if (!timeShaped && shape.kind !== "labelled") {
    // Lists, event logs, lookups, scorecards and a survey's other columns: totals of the measures
    // that add up, averages of the rest, distinct counts of repeating ids.
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
        format: sumFormat(c),
        direction: "higher",
        tier: i < 2 ? "hero" : "supporting",
        priority: 2 + i,
        group: "Measures",
        expr: { agg: "sum", of: { field: fid(c) } },
      });
      if (i === 0) {
        kpi({
          id: `avg_${fid(c)}_per_record`,
          name: `${friendly(c.name)} per ${shape.kind === "eventLog" ? "event" : "row"}`,
          definition: `Average ${friendly(c.name)} per ${shape.kind === "eventLog" ? "event" : "row"} (total ÷ rows).`,
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
    averages.slice(0, 4).forEach((c, i) => ensureAverage(c, "supporting", 10 + i));
  }

  if (shape.kind === "lookup")
    // A lookup table's attributes: how many regions, groups or types it spans.
    dims.slice(0, 2).forEach((d, i) =>
      kpi({
        id: `distinct_${fid(d)}`,
        name: capitalise(pluralOf(nounOf(d))),
        definition: `Number of different ${label(d)} values in the selection.`,
        formula: `Count of distinct ${label(d)}`,
        format: "integer",
        direction: "neutral",
        tier: i === 0 ? "hero" : "supporting",
        priority: 5 + i,
        group: "Volume",
        expr: { agg: "countDistinct", of: fid(d) },
      }),
    );

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
        group: PAIR_GROUP,
        tiers: j === 0 ? ["hero", "supporting"] : ["supporting", "supporting"],
        priority: j === 0 ? 2 : 20 + j * 2,
        why: "",
      }).forEach((k) => kpis.push(k)),
    );

  // ------------------------------------------------------------ charts
  const byId = (id: string) => kpis.find((k) => k.id === id);
  const lookup = (id: string) => byId(id)?.variants[0]?.expr;
  const adds = (id: string) => {
    const e = lookup(id);
    return e ? isAdditiveExpr(e, lookup) : false;
  };
  // The measure the trend and the breakdowns show: a time series's first measure (its average when it
  // is a level), a survey's first scale question, a practice table's outcome rate, events counted;
  // otherwise the scorecard's first metric, the largest total, else the row count.
  const first = shape.measures[0];
  const shaped =
    timeShaped && first
      ? [`avg_${fid(first)}`, `total_${fid(first)}`]
      : shape.kind === "survey"
        ? [
            shape.likert[0] ? `fav_${fid(shape.likert[0].column)}` : "",
            shape.nps ? `nps_${fid(shape.nps)}` : "",
            ...shape.ratings.map((r) => `avg_${fid(r.column)}`),
          ]
        : shape.kind === "labelled" && shape.outcome?.kind === "binary"
          ? [`rate_${fid(shape.outcome.column)}`]
          : ordinal
            ? [`avg_${fid(ordinal)}`]
            : shape.kind === "eventLog" || shape.kind === "labelled"
              ? ["records"]
              : [];
  const primary =
    shaped.map(byId).find(Boolean) ??
    kpis.find((k) => k.id.startsWith("metric_")) ??
    kpis.find((k) => k.id.startsWith("total_")) ??
    kpis[0];
  const primaryId = primary?.id ?? "records";
  const primaryName = primary?.name ?? "Rows";
  const primaryAdds = adds(primaryId);
  // A scorecard's metrics are values at a point in time, never parts of a whole: no donuts, lines not areas.
  const levels = Boolean(scorecard) || !primaryAdds;
  const charts: ChartTemplate[] = [];
  const chart = (c: ChartTemplate) => charts.push(c);
  // A trend needs a date that says when rows happened (never a birthday or a single day's stamp).
  if (date && shape.kind !== "lookup" && (shape.timeline || scorecard)) {
    chart({
      id: "g_trend",
      title: `${primaryName} over time`,
      kind: levels ? "line" : primaryId === "records" ? "bar" : "area",
      section: "trend",
      x: { time: fid(date) },
      measures: [primaryId],
      reason: scorecard
        ? `${primaryName} on each ${friendly(date.name)}: a line shows how the metric moves.`
        : levels
          ? `${primaryName} is an average or a rate, so a line shows how it moves; it is never summed over time.`
          : `A date column (${friendly(date.name)}) and a measure that adds up: the trend over time.`,
      alternatives: levels ? ["bar"] : ["line", "bar"],
      size: { w: 8, h: 4 },
      priority: 1,
    });
    const nextMeasure = shape.measures.find((c) => c !== first);
    // A time series's second measure; rows over time say nothing when each period has one row.
    const second = scorecard
      ? kpis.find((k) => k.id.startsWith("metric_") && k.id !== primaryId)
      : timeShaped
        ? nextMeasure
          ? (byId(`avg_${fid(nextMeasure)}`) ?? byId(`total_${fid(nextMeasure)}`))
          : undefined
        : (kpis.find((k) => k.id.startsWith("total_") && k.id !== primaryId) ??
          (primaryId !== "records" ? byId("records") : undefined));
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
    // A year or more of readings: the months of the year side by side show the seasonal pattern.
    const span = date.temporal?.spanDays ?? 0;
    const fine = shape.cadence === "day" || shape.cadence === "week" || shape.cadence === "month";
    if (timeShaped && span >= 365 && fine)
      chart({
        id: "g_season",
        title: `${primaryName} by month of year`,
        kind: levels ? "line" : "bar",
        section: "drivers",
        x: { part: "month", of: fid(date) },
        measures: [primaryId],
        reason: `Every year's ${levels ? "readings" : "figures"} together, January to December: the seasonal pattern.`,
        alternatives: levels ? ["bar"] : ["line"],
        size: { w: 6, h: 4 },
        priority: 1,
      });
    // Rows by weekday mean something for events and plain lists, not for readings, answers or metrics.
    if (shape.kind === "eventLog" || shape.kind === "list")
      chart({
        id: "g_weekday",
        title: `${byId("records")?.name ?? "Rows"} by weekday`,
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
      title: `${byId("records")?.name ?? "Rows"} by hour of ${friendly(timeOfDay.name)}`,
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

  // Breakdowns: a time series or panel by its entity first (a panel on each entity's latest period),
  // then the categories.
  const breakdowns = [...(timeShaped && entity ? [entity] : []), ...dims];
  breakdowns.slice(0, 3).forEach((d, i) => {
    const latest = shape.kind === "panel" && d === entity && first ? byId(`latest_${fid(first)}`) : undefined;
    const m = latest ?? primary;
    const id = m?.id ?? "records";
    const name = m?.name ?? "Rows";
    const additive = adds(id);
    // A class outcome is shown as each category's mix of classes.
    if (shape.kind === "labelled" && shape.outcome?.kind === "class" && d !== entity) {
      chart({
        id: `g_by_${fid(d)}`,
        title: `${label(shape.outcome.column)} mix by ${label(d)}`,
        kind: "stackedBar100",
        section: "breakdown",
        x: { field: fid(d) },
        series: { field: fid(shape.outcome.column) },
        measures: ["records"],
        reason: `How the ${pluralOf(nounOf(shape.outcome.column))} split within each ${label(d)}: each column adds up to 100%.`,
        alternatives: ["stackedBar", "heatmap"],
        size: { w: 6, h: 5 },
        priority: 1 + i,
      });
      return;
    }
    // IN/US states get a tile map; otherwise sorted bars, or a donut for a small (≤ 6 values) non-first
    // dimension of a measure that adds up, never for an average, a rate or a scorecard metric.
    const small = d.distinct <= 6 && additive && !scorecard;
    const map =
      d.geoLevel === "state" && (d.geoRegion === "IN" || d.geoRegion === "US") && additive && !scorecard;
    chart({
      id: `g_by_${fid(d)}`,
      title: `${name} by ${friendly(d.name)}`,
      kind: map ? "geoTile" : small && i > 0 ? "donut" : "hbar",
      section: "breakdown",
      x: { field: fid(d) },
      measures: [id],
      topN: 10,
      others: additive,
      // An average over a handful of rows is noise; those groups are set aside, as everywhere else.
      ...(additive || d === entity ? {} : { minGroupRows: 5 }),
      reason:
        small && i > 0
          ? `Part-to-whole with ${d.distinct} categories: a donut reads at a glance.`
          : latest
            ? `Each ${nounOf(d)} on its latest ${CADENCE_NOUN[shape.cadence ?? "day"]}: sorted bars${d.distinct > 10 ? ", the top 10" : ""}.`
            : `A category (${friendly(d.name)}) and a measure: sorted bars${d.distinct > 10 ? (additive ? ", top 10 plus Others" : ", the top 10") : ""}.`,
      alternatives: additive ? ["hbar", "bar", "treemap", "donut"] : ["hbar", "bar", "table"],
      size: { w: i === 0 ? 6 : 4, h: 5 },
      priority: 1 + i,
    });
  });

  // A survey's answers, question by question.
  shape.likert.slice(0, 3).forEach((q, i) =>
    chart({
      id: `g_answers_${fid(q.column)}`,
      title: `Answers to ${label(q.column)}`,
      kind: "hbar",
      section: "breakdown",
      x: { field: fid(q.column) },
      measures: ["records"],
      reason: `How the ${pluralOf("response")} spread across the ${q.levels.length} answers on the ${q.scale} scale.`,
      alternatives: ["bar", "donut", "table"],
      size: { w: 4, h: 4 },
      priority: 4 + i,
    }),
  );
  if (shape.kind === "labelled" && shape.outcome?.kind === "class") {
    // Each class's average of the first features: what sets the classes apart.
    const o = shape.outcome.column;
    shape.measures.slice(0, 2).forEach((c, i) =>
      chart({
        id: `g_class_${fid(c)}`,
        title: `${averageOf(c.name)} by ${label(o)}`,
        kind: "hbar",
        section: "breakdown",
        x: { field: fid(o) },
        measures: [ensureAverage(c)],
        reason: `How ${label(c)} differs between the ${pluralOf(nounOf(o))}: sorted bars of each one's average.`,
        alternatives: ["bar", "table"],
        size: { w: 4, h: 4 },
        priority: 5 + i,
      }),
    );
    if (first && dims.length < 2)
      chart({
        id: "g_heatmap",
        title: `${label(o)} × ${label(first)} band`,
        kind: "heatmap",
        section: "drivers",
        x: { bins: { field: fid(first) }, count: 10, format: "number", label: `${label(first)} band` },
        series: { field: fid(o) },
        measures: ["records"],
        reason: `Where each ${nounOf(o)} sits on ${label(first)}: rows counted by class and band.`,
        alternatives: ["stackedBar"],
        size: { w: 8, h: 5 },
        priority: 4,
      });
    chart({
      id: "g_classes",
      title: `${byId("records")?.name ?? "Rows"} by ${label(shape.outcome.column)}`,
      kind: shape.outcome.column.distinct <= 6 ? "donut" : "hbar",
      section: "breakdown",
      x: { field: fid(shape.outcome.column) },
      measures: ["records"],
      reason: `How many rows carry each ${nounOf(shape.outcome.column)}: a balanced table has classes of similar size.`,
      alternatives: ["hbar", "bar", "table"],
      size: { w: 4, h: 4 },
      priority: 0,
    });
  }
  if (ordinal) {
    // A rated table: how the scores spread, then what moves with the score. Every axis is the score
    // itself, read in the scale's order (3, 4 … 9), and every measure is a count or an average.
    const O = fid(ordinal);
    const L = label(ordinal);
    const each = rowNoun ? pluralOf(rowNoun) : "rows";
    chart({
      id: "g_outcome_dist",
      title: `${byId("records")?.name ?? "Rows"} by ${L}`,
      kind: "bar",
      section: "breakdown",
      x: { field: O },
      measures: ["records"],
      reason: `How many ${each} sit at each ${L} score, in the scale's order.`,
      alternatives: ["line", "table"],
      size: { w: 6, h: 4 },
      priority: 0,
    });
    linked.slice(0, 3).forEach(({ c, r }, i) =>
      chart({
        id: `g_outcome_${fid(c)}`,
        title: `${averageOf(c.name)} by ${L}`,
        kind: "bar",
        section: "drivers",
        x: { field: O },
        measures: [ensureAverage(c)],
        minGroupRows: 5,
        reason: `${i === 0 ? `Of the measured characteristics, ${label(c)} moves most closely with ${L}` : `${label(c)} is among the characteristics that move most closely with ${L}`} (${rText(r)} across the ${each}): its average at each ${L} score, in the scale's order. Scores held by fewer than 5 ${each} are set aside.`,
        alternatives: ["line", "table"],
        size: { w: 6, h: 4 },
        priority: 1 + i,
      }),
    );
    const top = linked[0];
    if (top) {
      // One point per row when a key names each and there are few enough to read; otherwise one point
      // per band of the characteristic, at its average characteristic and average score.
      const key = shape.key && profile.rowCount <= 5000 ? shape.key : null;
      chart({
        id: "g_outcome_scatter",
        title: `${capitalise(label(top.c))} vs ${L}`,
        kind: "scatter",
        section: "drivers",
        x: key
          ? { field: fid(key) }
          : { bins: { field: fid(top.c) }, count: 24, format: "number", label: `${label(top.c)} band` },
        measures: [ensureAverage(top.c), `avg_${O}`],
        reason: key
          ? `Each point is one ${rowNoun ?? "row"}: its ${label(top.c)} against its ${L} (${rText(top.r)}); a trendline shows the link.`
          : `Each point is a band of ${label(top.c)} values, at its average ${label(top.c)} and average ${L} (${rText(top.r)} across the ${each}); a trendline shows the link.`,
        alternatives: ["table"],
        size: { w: 6, h: 4 },
        priority: 4,
      });
    }
    const profiled = linked.slice(0, 4);
    if (profiled.length >= 2)
      chart({
        id: "g_outcome_table",
        title: `Measured characteristics by ${L}`,
        kind: "table",
        section: "detail",
        x: { field: O },
        measures: profiled.map(({ c }) => ensureAverage(c)),
        others: false,
        reason: `The average of the ${profiled.length} characteristics that move most closely with ${L}, at each ${L} score.`,
        alternatives: ["bar"],
        size: { w: 12, h: 5 },
        priority: 0,
      });
  }

  // The spread of the main measure (a survey's first rating). A rated table shows the spread of its
  // scores instead (g_outcome_dist).
  const rating = shape.kind === "survey" ? shape.ratings[0] : undefined;
  const spread = shape.kind === "survey" ? rating?.column : (first ?? measures[0] ?? averages[0]);
  if (spread && !ordinal) {
    chart({
      id: "g_hist",
      title: `Distribution of ${label(spread)}`,
      kind: "histogram",
      section: "drivers",
      x: {
        bins: { field: fid(spread) },
        // A rating gets one band per point of its scale.
        count: rating ? Math.max(2, rating.max - rating.min) : 14,
        format:
          spread.role === "currency"
            ? "currency"
            : spread.role === "percentage" && spread.percentScale === 1
              ? "percent"
              : "number",
        label: `${label(spread)} band`,
      },
      measures: ["records"],
      reason: "One numeric column's spread: a histogram of value bands.",
      alternatives: ["bar"],
      size: { w: 6, h: 4 },
      priority: 2,
    });
  }
  // A practice table's outcome rate across the bands of its first feature.
  if (shape.kind === "labelled" && shape.outcome?.kind === "binary" && first) {
    const rate = `rate_${fid(shape.outcome.column)}`;
    chart({
      id: "g_outcome_bands",
      title: `${byId(rate)?.name ?? "Outcome rate"} by ${label(first)} band`,
      kind: "bar",
      section: "drivers",
      x: { bins: { field: fid(first) }, count: 10, format: "number", label: `${label(first)} band` },
      measures: [rate],
      reason: `How often ${label(shape.outcome.column)} is yes in each band of ${label(first)}.`,
      alternatives: ["line"],
      size: { w: 6, h: 4 },
      priority: 3,
    });
  }

  // The two measures that move together most closely, one point per entity, row or category.
  const pointCol =
    timeShaped && entity && entity.distinct >= 5
      ? entity
      : shape.key && profile.rowCount <= 5000
        ? shape.key
        : [...dims].filter((d) => d.distinct >= 5).sort((a, b) => b.distinct - a.distinct)[0];
  // Continuous figures only (ten or more values): a 0/1 flag or a small code has no cloud to read. A
  // survey's ratings count, being what it asked.
  const continuous = shape.measures.filter((c) => c.distinct >= 10);
  const candidates =
    shape.kind === "survey" ? [...shape.ratings.map((r) => r.column), ...continuous] : continuous;
  const pair = ds && pointCol && candidates.length >= 2 ? mostCorrelated(ds, candidates) : null;
  if (pair && pointCol) {
    const each = pointCol === shape.key ? `row (one ${nounOf(pointCol)})` : nounOf(pointCol);
    chart({
      id: "g_scatter",
      title: `${label(pair.a)} vs ${label(pair.b)}${pointCol === shape.key ? "" : ` by ${label(pointCol)}`}`,
      kind: "scatter",
      section: "drivers",
      x: { field: fid(pointCol) },
      measures: [ensureAverage(pair.a), ensureAverage(pair.b)],
      reason: `Of the numeric columns, ${label(pair.a)} and ${label(pair.b)} move together most closely across the rows (r = ${pair.r.toFixed(2)}). Each point is one ${each}; a trendline shows the link.`,
      alternatives: ["table"],
      size: { w: 6, h: 4 },
      priority: 3,
    });
  }

  // Where values concentrate: two categories, or a panel's entities across its years.
  if (charts.some((c) => c.id === "g_heatmap")) {
    // A class outcome's bands already have it.
  } else if (dims.length >= 2) {
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
  } else if (shape.kind === "panel" && entity && shape.period && entity.distinct <= 40 && first) {
    const avg = byId(`avg_${fid(first)}`);
    if (avg)
      chart({
        id: "g_heatmap",
        title: `${avg.name}: ${label(entity)} × ${label(shape.period)}`,
        kind: "heatmap",
        section: "drivers",
        x: { field: fid(shape.period) },
        series: { field: fid(entity) },
        measures: [avg.id],
        reason: `Each ${nounOf(entity)} across the ${pluralOf(CADENCE_NOUN[shape.cadence ?? "year"])}: a heatmap shows who is high or low, and when.`,
        alternatives: ["table"],
        size: { w: 8, h: 5 },
        priority: 4,
      });
  }
  const tableAxis = timeShaped && entity ? entity : dims[0];
  if (tableAxis) {
    chart({
      id: "g_table",
      title: `Detail by ${friendly(tableAxis.name)}`,
      kind: "table",
      section: "detail",
      x: { field: fid(tableAxis) },
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
    description: shape.description,
    icon: "table",
    // A rated table's rows are named after what they are ("wine"), as the exports name the table.
    entity: rowNoun ?? "row",
    fields,
    valueClasses: {},
    // The schema needs one sub-domain with at least one signal; the first field is a placeholder. Its
    // name is the table's shape and its grain what one row is, as the dashboard and Detect show them.
    subDomains: [
      {
        id: "table",
        name: shape.label,
        description: shape.description,
        signals: fields.slice(0, 1).map((f) => f.id),
        grain: shape.grain ?? "row",
      },
    ],
    kpis,
    charts,
    pitfalls: [
      "No industry was confirmed, so KPIs are structural (totals, counts, averages) rather than business definitions.",
      "Averages of rate or percentage columns are unweighted; confirm an industry or rebuild the rate from its parts.",
      ...(timeShaped
        ? [
            "Levels (temperatures, prices, rates, populations) are read on the latest period or averaged; they are never added up across dates.",
          ]
        : []),
      ...(shape.kind === "survey"
        ? [
            "% favourable counts the top two answers above the middle of each scale; blank answers are left out.",
          ]
        : []),
      ...(shape.kind === "labelled" && !ordinal
        ? ["The outcome rate describes the rows in the table; it says nothing about what causes the outcome."]
        : []),
      ...(ordinal
        ? [
            `The characteristics are ranked by how closely each moves with ${friendly(ordinal.name)} across the rows (Pearson r); that says nothing about what causes a score.`,
          ]
        : []),
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
  return { domain, mapping, shape };
}

// ---------------------------------------------------------------- filling a thin industry dashboard

/** Where each section of the generic dashboard comes, once its charts share the columns section of another. */
const SECTION_ORDER: Record<ChartTemplate["section"], number> = {
  trend: 0,
  breakdown: 1,
  drivers: 2,
  detail: 3,
  columns: 4,
};

/** Id prefix of the generic charts, KPIs and fields that fill a thin industry dashboard (a kind of column extra). */
export const FILL_PREFIX = `${COLUMN_PREFIX}g_`;

/** What genericFill adds to an industry's domain: registry-shaped definitions and their identity mapping. */
export interface GenericFill {
  fields: FieldDef[];
  kpis: KpiDef[];
  charts: ChartTemplate[];
  /** Field id → column, for the new fields. */
  mapping: Record<string, string>;
}

/** What genericFill reads: the analysis profile and rows, and what the industry's template already reads. */
export interface GenericFillInput {
  profile: DatasetProfile;
  ds: Dataset;
  domain: DomainDef;
  mapping: Mapping;
  res: KpiResolutionMap;
  subDomainId: string;
}

/** A row expression with every field id renamed. */
function renameRow(e: RowExpr, f: (id: string) => string): RowExpr {
  if ("field" in e) return { field: f(e.field) };
  if ("op" in e) return { op: e.op, args: [renameRow(e.args[0], f), renameRow(e.args[1], f)] };
  if ("daysBetween" in e) return { daysBetween: [f(e.daysBetween[0]), f(e.daysBetween[1])] };
  return e;
}

/** A row filter with every field id renamed. */
function renamePredicate(p: Predicate, f: (id: string) => string): Predicate {
  if ("and" in p) return { and: p.and.map((q) => renamePredicate(q, f)) };
  if ("or" in p) return { or: p.or.map((q) => renamePredicate(q, f)) };
  if ("not" in p) return { not: renamePredicate(p.not, f) };
  if ("cmpField" in p) return { ...p, field: f(p.field), other: f(p.other) };
  return { ...p, field: f(p.field) };
}

/** A measure expression with every field id and KPI ref renamed. */
function renameExpr(e: Expr, f: (id: string) => string, r: (id: string) => string): Expr {
  const where = (p: Predicate | undefined) => (p ? { where: renamePredicate(p, f) } : {});
  if ("agg" in e) {
    if (e.agg === "count") return { agg: "count", ...where(e.where) };
    if (e.agg === "countDistinct" || e.agg === "spanDays")
      return { agg: e.agg, of: f(e.of), ...where(e.where) };
    return { agg: e.agg, of: renameRow(e.of, f), ...where(e.where) };
  }
  if ("op" in e) return { op: e.op, args: [renameExpr(e.args[0], f, r), renameExpr(e.args[1], f, r)] };
  if ("ref" in e) return { ref: r(e.ref) };
  if ("calc" in e) return { calc: renameExpr(e.calc, f, r), where: renamePredicate(e.where, f) };
  if ("per" in e)
    return {
      per: f(e.per),
      inner: renameExpr(e.inner, f, r),
      reduce: e.reduce,
      ...(e.having ? { having: { ...e.having, expr: renameExpr(e.having.expr, f, r) } } : {}),
    };
  if ("newEntities" in e) return { newEntities: f(e.newEntities), date: f(e.date) };
  if ("atLatest" in e) return { atLatest: f(e.atLatest), expr: renameExpr(e.expr, f, r) };
  return e;
}

/** A chart axis with every field id renamed. */
function renameAxis(a: AxisDef, f: (id: string) => string): AxisDef {
  if ("time" in a) return { ...a, time: f(a.time) };
  if ("field" in a) return { field: f(a.field) };
  if ("part" in a) return { ...a, of: f(a.of) };
  if ("bins" in a) return { ...a, bins: renameRow(a.bins, f) };
  return a;
}

/**
 * The generic dashboard's charts for the columns an industry's template
 * doesn't read, for a template that builds too few charts of its own (an
 * industry chosen for a file it hardly fits: Pharma on a table of wine
 * measurements). The columns that no available template KPI reads (the date
 * axis kept, as any chart may share it) are read as a table of their own
 * (buildGenericDomain): a rated table's score distribution and what moves
 * with the score, a time series's trend, a list's breakdowns. Its charts and
 * the KPIs they show join the industry's domain with FILL_PREFIX ids (column
 * extras, so they have the dashboard's "From your other columns" section and
 * never take a template KPI's slot) and fields mapped one to one to their
 * columns. Nothing is estimated: every definition reads the file's columns.
 * Empty when those columns make no chart.
 */
export function genericFill(input: GenericFillInput): GenericFill {
  const { profile, ds, domain, mapping, res, subDomainId } = input;
  const empty: GenericFill = { fields: [], kpis: [], charts: [], mapping: {} };
  const read = new Set<string>();
  for (const x of res.values()) {
    if (!x.available || x.dependencyOnly) continue;
    for (const fid of x.fieldsUsed) {
      const col = fid.startsWith("col:") ? fid.slice(4) : mapping.fields[fid];
      if (col && col !== profile.primaryDate) read.add(col);
    }
  }
  const rest = withoutColumns(ds, profile, read);
  if (!rest.columns.length) return empty;
  const g = buildGenericDomain(rest, ds);
  if (!g.domain.charts.length) return empty;
  // The KPIs the charts show and the table's own headline KPIs, and the ones those refer to.
  const byId = new Map(g.domain.kpis.map((k) => [k.id, k]));
  const needed = new Set<string>();
  const need = (id: string) => {
    const k = byId.get(id);
    if (!k || needed.has(id)) return;
    needed.add(id);
    for (const v of k.variants) refsOf(v.expr).forEach(need);
  };
  g.domain.charts.forEach((c) => c.measures.forEach(need));
  // Plans against outcomes are the column KPIs' to compare (kpi/columnKpis.ts), with ids of their own.
  g.domain.kpis.filter((k) => k.tier === "hero" && k.group !== PAIR_GROUP).forEach((k) => need(k.id));
  const field = (id: string) => `${FILL_PREFIX}f_${id}`;
  const kpiId = (id: string) => `${FILL_PREFIX}${id}`;
  const why = ` The ${domain.name} template doesn't use these columns, so Loupe reads them as a table of their own.`;
  const used = new Set<string>();
  g.domain.charts.forEach((c) => {
    for (const a of [c.x, ...(c.series ? [c.series] : [])]) {
      if ("time" in a) used.add(a.time);
      else if ("field" in a) used.add(a.field);
      else if ("part" in a) used.add(a.of);
      else if ("bins" in a) fieldsOf(a.bins).forEach((x) => used.add(x));
    }
  });
  for (const id of needed)
    for (const v of byId.get(id)?.variants ?? []) fieldsOf(v.expr).forEach((x) => used.add(x));
  return {
    fields: g.domain.fields
      .filter((x) => used.has(x.id))
      .map((x) => ({ ...x, id: field(x.id), synonyms: [] })),
    mapping: Object.fromEntries(
      [...used].flatMap((id) => {
        const column = g.mapping.fields[id];
        return column ? [[field(id), column]] : [];
      }),
    ),
    kpis: g.domain.kpis
      .filter((k) => needed.has(k.id))
      .map((k) => ({
        ...k,
        id: kpiId(k.id),
        definition: `${k.definition}${why}`,
        group: COLUMN_GROUP,
        variants: k.variants.map((v) => ({ ...v, expr: renameExpr(v.expr, field, kpiId) })),
      })),
    charts: g.domain.charts.map((c) => ({
      ...c,
      id: kpiId(c.id),
      section: "columns" as const,
      x: renameAxis(c.x, field),
      ...(c.series ? { series: renameAxis(c.series, field) } : {}),
      measures: c.measures.map(kpiId),
      // One section now: the table's own order of sections is kept within it (trend, breakdown, drivers, detail).
      priority: SECTION_ORDER[c.section] * 10 + c.priority,
      subDomains: [subDomainId],
      // With the template this thin, these are the dashboard's main charts in every layout.
      modes: ["executive", "analyst", "compact"],
    })),
  };
}
