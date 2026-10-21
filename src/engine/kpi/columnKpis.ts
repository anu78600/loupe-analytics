/**
 * KPIs and charts for the measure columns an industry template does not read.
 *
 * Templates know their industry's usual columns. A file often has more (a
 * "Rating", "Profit" or "Shipping Fee" the template never mentions), and
 * those used to feed nothing. columnExtras() finds every numeric measure
 * column that no available KPI reads and summarises it the way its data
 * says it should be: additive amounts and quantities are totalled, balances
 * are taken on the latest date, and prices, rates, percentages and rating
 * scales are averaged (never summed). Each gets a trend chart and a
 * breakdown by the file's most useful category, in a dashboard section of
 * its own ("From your other columns"); totals by state are a tile map of
 * every state. A roster (one row per employee or customer) gets no trend
 * chart: its date marks when each one started, so a line "over time" would
 * compare cohorts, not periods. A separate time-of-day column the template
 * doesn't chart gets an hour-of-day chart there too.
 *
 * Plan and outcome columns that belong together (profile.pairs: "Revenue
 * Budget" beside "Revenue Actual", "Sales LY" beside "Sales TY") are
 * compared too, when the template doesn't read both: attainment (actual ÷
 * plan, a ratio of sums) and variance (actual − plan), or growth vs last
 * year, built by pairKpis, which the generic fallback uses as well.
 *
 * A tall scorecard's value columns (profile.tall) hold every metric's
 * figures in their own units, so they are never totalled or averaged here.
 *
 * The results are ordinary registry-shaped definitions (fields with an
 * identity mapping, KPIs, chart templates) merged into the domain by the
 * session, so the evaluator, SQL, DAX, exports and insights treat them like
 * any other KPI. Nothing is estimated and no column is created: every
 * definition reads the file's own columns.
 */
import type { ColumnPair, ColumnProfile, DatasetProfile } from "@/engine/profile/types";
import { averageOf, friendly, totalOf } from "@/engine/core/labels";
import { tokenize } from "@/engine/profile/names";
import { isAdditiveExpr, type Expr, type Predicate, type RowExpr } from "@/engine/query/expr";
import type { Mapping } from "@/engine/detect/mapping";
import type { ChartTemplate, DomainDef, FieldDef, KpiDef } from "@/registry/schema";
import type { KpiResolutionMap } from "./resolve";

/** Id prefix of everything built here ("your column"); no registry id uses it. */
export const COLUMN_PREFIX = "yc_";
/** KPI group (and Power BI display folder) of the column KPIs. */
export const COLUMN_GROUP = "From your other columns";
/** At most this many columns get KPIs, and the first CHARTED of them get charts. */
const MAX_KPIS = 8;
const CHARTED = 4;
/** At most this many plan/outcome pairs are compared. */
const MAX_PAIRS = 4;

/** True for a KPI, field or chart id built by columnExtras. */
export const isColumnId = (id: string): boolean => id.startsWith(COLUMN_PREFIX);

export interface ColumnExtras {
  fields: FieldDef[];
  kpis: KpiDef[];
  charts: ChartTemplate[];
  /** Field id → column for the new fields (identity mapping). */
  mapping: Record<string, string>;
}

export interface ColumnExtrasInput {
  domain: DomainDef;
  mapping: Mapping;
  res: KpiResolutionMap;
  profile: DatasetProfile;
  subDomainId: string;
  /** The analysis's primary date column (original name), if any. */
  dateColumn: string | null;
}

// Name words that say which way is good news. Anything else stays neutral:
// an unknown column's direction is not guessed.
const HIGHER = new Set([
  "revenue",
  "sale",
  "profit",
  "margin",
  "income",
  "earning",
  "rating",
  "score",
  "satisfaction",
  "csat",
  "nps",
  "review",
  "star",
]);
const LOWER = new Set([
  "cost",
  "expense",
  "refund",
  "return",
  "loss",
  "delay",
  "defect",
  "complaint",
  "churn",
  "wait",
  "error",
]);

function directionOf(name: string): KpiDef["direction"] {
  const t = tokenize(name);
  if (t.some((w) => LOWER.has(w))) return "lower";
  if (t.some((w) => HIGHER.has(w))) return "higher";
  return "neutral";
}

// ---------------------------------------------------------------- plan vs actual

/** A plan/outcome pair whose two columns the analysis may read. */
export interface UsablePair {
  pair: ColumnPair;
  actual: ColumnProfile;
  target: ColumnProfile;
}

/**
 * The profile's plan/outcome pairs (profile/pairs.ts) whose two columns are
 * both in the analysis profile, so a hidden column is never read, and
 * neither is a tall scorecard's value column, whose rows mix units.
 */
export function usablePairs(profile: DatasetProfile): UsablePair[] {
  const byName = new Map(profile.columns.map((c) => [c.name, c]));
  const tallValues = new Set(profile.tall?.valueColumns ?? []);
  return profile.pairs.flatMap((pair) => {
    const actual = byName.get(pair.actual);
    const target = byName.get(pair.target);
    if (!actual || !target || tallValues.has(actual.name) || tallValues.has(target.name)) return [];
    return [{ pair, actual, target }];
  });
}

/** What pairKpis needs for one pair. */
export interface PairKpiInput extends UsablePair {
  /** Field ids that read the actual and the plan column. */
  actualField: string;
  targetField: string;
  /** Field id of the analysis date column: balances are compared on the latest date. Null when there is none. */
  dateField: string | null;
  dateLabel: string;
  /** Id prefix ("yc_" for column KPIs, "" in the generic fallback). */
  prefix: string;
  /** Slugs already taken, so the ids stay unique; the new ones are added. */
  used: Set<string>;
  group: string;
  /** Tier of the first KPI (attainment or growth) and of the variance. */
  tiers: readonly [KpiDef["tier"], KpiDef["tier"]];
  priority: number;
  /** Appended to every definition (why the KPI exists). */
  why: string;
}

/**
 * How a pair is compared: sums for amounts and counts; sums on the latest
 * date for balances when there is a date; the row-by-row gap, averaged, for
 * percentages, rates and other figures that are never added up.
 */
function pairSummary(p: UsablePair, hasDate: boolean): Summary {
  const both = [p.actual, p.target];
  if (both.some((c) => c.role === "rate" || c.role === "percentage" || c.additivity === "non-additive"))
    return "average";
  if (both.some((c) => c.additivity === "semi-additive") && hasDate) return "latest";
  return "total";
}

/**
 * The KPIs that compare a pair, named the way analysts write them:
 * - amounts and counts: "{label} attainment vs {plan}" (sum of actual ÷ sum
 *   of plan, a ratio of sums shown as a percentage, blank when the plan adds
 *   up to 0, as in SQL) and "{label} variance vs {plan}" (sum of actual −
 *   sum of plan, in the actual's units); "Target attainment" and "Variance
 *   vs target" when the headers share no words;
 * - against last year: "{label} growth vs last year", (actual − LY) ÷ LY,
 *   and "{label} variance vs last year";
 * - balances, with a date: the same on the latest date that has both
 *   figures, never added across dates;
 * - percentages and rates: the variance only, as the average row-by-row gap,
 *   in percentage points ("pp") for percentages; a ratio of two rates is no
 *   attainment.
 * Every comparison reads only the rows that have both figures, so a month
 * with a target but no result yet does not count against it.
 */
export function pairKpis(input: PairKpiInput): KpiDef[] {
  const { pair, actual, target, actualField: a, targetField: t, dateField } = input;
  const how = pairSummary(input, Boolean(dateField));
  const A = friendly(actual.name);
  const T = friendly(target.name);
  const ly = pair.kind === "last year";
  const subject = pair.label;
  const kindWord = pair.kind;
  const base = slug(`${subject || "all"} ${kindWord}`, input.used);
  const both: Predicate = {
    and: [
      { field: a, notNull: true },
      { field: t, notNull: true },
    ],
  };
  const latest = how === "latest" ? dateField : null;
  // Balances: the latest date among the rows that have both figures (the filter applies first).
  const scope = (e: Expr): Expr => ({ calc: latest ? { atLatest: latest, expr: e } : e, where: both });
  const sumA: Expr = { agg: "sum", of: { field: a } };
  const sumT: Expr = { agg: "sum", of: { field: t } };
  // Beating a sales target or quota is good news; a rate's target is as often a ceiling (an NPA ratio,
  // a churn rate), so rates keep the direction their name gives, if any.
  let direction = directionOf(actual.name);
  if (direction === "neutral" && how !== "average" && (pair.kind === "target" || pair.kind === "quota"))
    direction = "higher";
  const suffix = latest ? " (latest)" : "";
  const onLatest = latest
    ? ` Taken on the latest ${input.dateLabel} that has both figures: it is a balance, so it is not added across dates.`
    : "";
  const rows = "over the rows that have both figures, so a row with only one of them is left out";
  const varianceName = `${subject ? `${subject} variance` : "Variance"} vs ${kindWord}`;
  // Neutral wording: above the plan is good news for sales and bad news for costs.
  const above = `Above 0 means ${A} is higher than ${T}.`;
  const out: KpiDef[] = [];

  if (how === "average") {
    // Percentages stored as fractions (0.12) become points, so the gap reads in pp either way.
    const pct = actual.role === "percentage";
    const gap: RowExpr = { op: "sub", args: [{ field: a }, { field: t }] };
    const of: RowExpr = pct && actual.percentScale === 1 ? { op: "mul", args: [gap, { num: 100 }] } : gap;
    out.push({
      id: `${input.prefix}var_${base}`,
      name: `${varianceName}${pct ? " (pp)" : ""}`,
      definition: `The average gap between ${A} and ${T}, row by row (${A} − ${T})${pct ? ", in percentage points" : ""}, ${rows}. ${above}${input.why}`,
      formula: `Average of (${A} − ${T})${pct ? ", in pp" : ""}`,
      format: actual.role === "currency" ? "currency" : "decimal",
      direction,
      tier: input.tiers[1],
      priority: input.priority + 1,
      group: input.group,
      variants: [
        {
          id: "main",
          label: `Average of (${A} − ${T})`,
          expr: { agg: "avg", of, where: both },
          caveat: "A simple average of row gaps; each row counts once, whatever its size.",
        },
      ],
    });
    return out;
  }

  const ratio: Expr = ly
    ? { op: "div", args: [{ op: "sub", args: [sumA, sumT] }, sumT] }
    : { op: "div", args: [sumA, sumT] };
  const ratioName = ly
    ? `${subject ? `${subject} growth` : "Growth"} vs last year`
    : subject
      ? `${subject} attainment vs ${kindWord}`
      : `${kindWord.charAt(0).toUpperCase()}${kindWord.slice(1)} attainment`;
  const ratioFormula = ly ? `(Sum of ${A} − sum of ${T}) ÷ sum of ${T}` : `Sum of ${A} ÷ sum of ${T}`;
  out.push({
    id: `${input.prefix}${ly ? "growth" : "attain"}_${base}`,
    name: `${ratioName}${suffix}`,
    definition: ly
      ? `How much ${A} changed from ${T}: (sum of ${A} − sum of ${T}) ÷ sum of ${T}, ${rows}. Blank when ${T} adds up to 0.${onLatest}${input.why}`
      : `${A} as a share of ${T}: the sum of ${A} ÷ the sum of ${T}, a ratio of sums, ${rows}. Blank when ${T} adds up to 0.${onLatest}${input.why}`,
    formula: ratioFormula,
    format: "percent",
    direction,
    tier: input.tiers[0],
    priority: input.priority,
    group: input.group,
    variants: [{ id: "main", label: ratioFormula, expr: scope(ratio) }],
  });
  const money = actual.role === "currency" || target.role === "currency";
  const whole = Boolean(actual.numeric?.integer && target.numeric?.integer);
  out.push({
    id: `${input.prefix}var_${base}`,
    name: `${varianceName}${suffix}`,
    definition: `${A} minus ${T}: the sum of ${A} − the sum of ${T}, ${rows}. ${above}${onLatest}${input.why}`,
    formula: `Sum of ${A} − sum of ${T}`,
    format: money ? "currency" : whole ? "integer" : "number",
    direction,
    tier: input.tiers[1],
    priority: input.priority + 1,
    group: input.group,
    variants: [
      { id: "main", label: `Sum of ${A} − sum of ${T}`, expr: scope({ op: "sub", args: [sumA, sumT] }) },
    ],
  });
  return out;
}

/**
 * A chart title in sentence case, as titles are written: "Average MRP by
 * customer state", not "Average MRP by Customer State". The first word keeps
 * its capital; other capitalised words are lowered, while acronyms and
 * mixed-case words (MRP, GST, Q7, iOS) keep their spelling.
 */
function sentenceCase(title: string): string {
  return title
    .split(" ")
    .map((w, i) =>
      i === 0 ? `${w.charAt(0).toUpperCase()}${w.slice(1)}` : /^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w,
    )
    .join(" ");
}

/** Lower snake_case slug for ids, unique within `used`. */
function slug(name: string, used: Set<string>): string {
  let base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "col";
  if (!/^[a-z]/.test(base)) base = `c_${base}`;
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}_${i}`;
  used.add(id);
  return id;
}

/** How a column is summarised, decided from its profile. */
type Summary = "total" | "latest" | "average";

function summaryOf(c: ColumnProfile, hasDate: boolean): Summary {
  if (c.role === "rate" || c.role === "percentage" || c.additivity === "non-additive") return "average";
  if (c.additivity === "semi-additive" && hasDate) return "latest";
  return "total";
}

const isCandidate = (c: ColumnProfile) =>
  c.storage === "number" &&
  Boolean(c.numeric) &&
  (c.role === "measure" || c.role === "currency" || c.role === "rate" || c.role === "percentage") &&
  c.nullPct < 0.95 &&
  c.distinct > 1;

/**
 * The best category to break the column KPIs down by: a text dimension or
 * place with 3–30 values (2 when nothing else), preferring columns the
 * template mapped, then places, then fewer values.
 */
function breakdownColumn(profile: DatasetProfile, mapped: Set<string>): ColumnProfile | undefined {
  const dims = profile.columns.filter(
    (c) =>
      (c.role === "dimension" || c.role === "geo") &&
      c.storage === "string" &&
      c.distinct >= 2 &&
      c.distinct <= 30 &&
      c.nullPct < 0.5 &&
      c.geoLevel !== "postal",
  );
  const score = (c: ColumnProfile) =>
    (c.distinct >= 3 ? 4 : 0) + (mapped.has(c.name) ? 2 : 0) + (c.role === "geo" ? 1 : 0);
  return dims.sort((a, b) => score(b) - score(a) || a.distinct - b.distinct)[0];
}

/**
 * KPIs and charts for the measure columns no available KPI of the view reads.
 * Ranked money first, then averaged scores and rates, then by size of total;
 * empty when the template already covers every measure column.
 */
export function columnExtras(input: ColumnExtrasInput): ColumnExtras {
  const { domain, mapping, res, profile, subDomainId, dateColumn } = input;
  // Columns an available KPI reads, and among them those the template's own KPIs read: generic charts
  // lent to a thin dashboard (detect/generic.ts genericFill) read columns too, but never compare a plan
  // with its outcome, so the pairs below still are.
  const read = new Set<string>();
  const readByTemplate = new Set<string>();
  for (const r of res.values()) {
    if (!r.available || r.dependencyOnly) continue;
    for (const f of r.fieldsUsed) {
      const col = f.startsWith("col:") ? f.slice(4) : mapping.fields[f];
      if (!col) continue;
      read.add(col);
      if (!isColumnId(r.def.id)) readByTemplate.add(col);
    }
  }
  const rank = (c: ColumnProfile) =>
    c.role === "currency" ? 0 : c.role === "rate" || c.role === "percentage" ? 1 : 2;
  // A tall scorecard's value columns hold every metric's figures, each in its own unit: a total or an
  // average of one would add percentages to rupees, so they get none (parse/pivot.ts gives each metric
  // a column of its own instead).
  const tallValues = new Set(profile.tall?.valueColumns ?? []);
  const columns = profile.columns
    .filter((c) => isCandidate(c) && !read.has(c.name) && c.name !== dateColumn && !tallValues.has(c.name))
    .sort((a, b) => rank(a) - rank(b) || Math.abs(b.numeric?.sum ?? 0) - Math.abs(a.numeric?.sum ?? 0))
    .slice(0, MAX_KPIS);
  const out: ColumnExtras = { fields: [], kpis: [], charts: [], mapping: {} };

  // Reuse the template's field when it already maps a column; otherwise add an identity field.
  const used = new Set<string>();
  const fieldFor = new Map<string, string>(Object.entries(mapping.fields).map(([f, c]) => [c, f]));
  const field = (c: ColumnProfile): string => {
    const known = fieldFor.get(c.name);
    if (known) return known;
    const id = `${COLUMN_PREFIX}f_${slug(c.name, used)}`;
    out.fields.push({ id, label: friendly(c.name), roles: [c.role], synonyms: [], weight: 1 });
    out.mapping[id] = c.name;
    fieldFor.set(c.name, id);
    return id;
  };
  const date = dateColumn ? profile.columns.find((c) => c.name === dateColumn) : undefined;
  const mapped = new Set(Object.values(mapping.fields));
  const dim = breakdownColumn(profile, mapped);
  const kpiSlugs = new Set<string>();
  // On a roster (one row per employee or customer) the date says when each one started: a chart
  // "over time" would compare hiring cohorts, not periods, so none is drawn.
  const roster = domain.subDomains.find((s) => s.id === subDomainId)?.timeModel === "roster";
  // Totals by state read well as a tile map of every state; averages are compared, so they get sorted bars.
  const tileMap = Boolean(
    dim && dim.geoLevel === "state" && (dim.geoRegion === "IN" || dim.geoRegion === "US"),
  );

  columns.forEach((c, i) => {
    const how = summaryOf(c, Boolean(date));
    const f = field(c);
    const s = slug(c.name, kpiSlugs);
    const id = `${COLUMN_PREFIX}${how === "average" ? "avg" : how}_${s}`;
    const money = c.role === "currency";
    const pctFormat: KpiDef["format"] = c.percentScale === 100 ? "decimal" : "percent";
    const format: KpiDef["format"] =
      c.role === "percentage"
        ? pctFormat
        : money
          ? "currency"
          : how === "average"
            ? "decimal"
            : c.numeric?.integer
              ? "integer"
              : "number";
    let expr: Expr;
    let name: string;
    let definition: string;
    let formula: string;
    let caveat: string | undefined;
    // Titles and sentences read the header with spaces ("GST_Amount" → "GST Amount").
    const label = friendly(c.name);
    const dateLabel = date ? friendly(date.name) : "";
    if (how === "average") {
      expr = { agg: "avg", of: { field: f } };
      name = averageOf(c.name);
      definition = `Average ${label} across the rows in the selection (blank cells are left out).`;
      formula = `Average of ${label}`;
      if (c.role === "rate" || c.role === "percentage")
        caveat = "A simple average of row values; each row counts once, whatever its size.";
    } else if (how === "latest" && date) {
      expr = { atLatest: field(date), expr: { agg: "sum", of: { field: f } } };
      name = `${label} (latest)`;
      definition = `${label} on the latest ${dateLabel} in the selection; it is a balance, so it is not added across dates.`;
      formula = `Sum of ${label} on the latest ${dateLabel}`;
    } else {
      expr = { agg: "sum", of: { field: f } };
      name = totalOf(c.name);
      definition = `Sum of ${label} across the rows in the selection.`;
      formula = `Sum of ${label}`;
    }
    // Say why the column has its own KPI: the template either doesn't know it, or
    // recognises it but computes its KPIs another way (e.g. profit as revenue − cost).
    const known = domain.fields.find((fl) => mapping.fields[fl.id] === c.name);
    const why =
      domain.id === "generic"
        ? ""
        : known
          ? ` The ${domain.name} template reads ${label} as "${known.label}" but computes its own KPIs another way, so this is the plain total or average of your column.`
          : ` The ${domain.name} template doesn't use ${label}, so Loupe summarises it straight from your file.`;
    out.kpis.push({
      id,
      name,
      definition: `${definition}${why}`,
      formula,
      format,
      direction: directionOf(c.name),
      tier: "detail",
      priority: 100 + i,
      group: COLUMN_GROUP,
      variants: [{ id: "main", label: formula, expr, ...(caveat ? { caveat } : {}) }],
    });
    if (i >= CHARTED) return;
    const avg = how === "average";
    if (date && !roster)
      out.charts.push({
        id: `${COLUMN_PREFIX}trend_${s}`,
        title: sentenceCase(`${name} over time`),
        kind: how === "total" ? "bar" : "line",
        section: "columns",
        x: { time: field(date) },
        measures: [id],
        reason: avg
          ? `${label} is averaged, so a line shows how the average moves; it is never summed.`
          : `${label} adds up over time: one column per period.`,
        alternatives: how === "total" ? ["line", "area"] : ["bar"],
        size: { w: 6, h: 4 },
        priority: 1 + i * 2,
        subDomains: [subDomainId],
        modes: ["analyst", "compact"],
      });
    if (dim) {
      const map = !avg && tileMap;
      out.charts.push({
        id: `${COLUMN_PREFIX}by_${s}`,
        title: sentenceCase(`${name} by ${friendly(dim.name)}`),
        kind: map ? "geoTile" : "hbar",
        section: "columns",
        x: { field: field(dim) },
        measures: [id],
        // A map shows every state (a top 10 would leave the rest blank); bars keep the top 10 plus Others.
        ...(map ? {} : { topN: 10, others: true }),
        // An average over a handful of rows is noise; those groups are set aside, as everywhere else.
        ...(avg ? { minGroupRows: 5 } : {}),
        // "Top 10 plus Others" only where there are more than ten groups to fold.
        reason: avg
          ? `Average ${label} for each ${friendly(dim.name)}, sorted, so the highest and lowest stand out. Groups with fewer than 5 rows are set aside.`
          : map
            ? `Where ${label} comes from: a tile map of every state, shaded by its total, so regional patterns show at a glance.`
            : `Where ${label} comes from: sorted bars by ${friendly(dim.name)}${dim.distinct > 10 ? ", top 10 plus Others" : ""}.`,
        alternatives: avg ? ["hbar", "bar", "table"] : ["hbar", "bar", "treemap", "table"],
        size: { w: 6, h: 4 },
        priority: 2 + i * 2,
        subDomains: [subDomainId],
        modes: ["analyst", "compact"],
      });
    }
  });

  // Plan and outcome columns the template doesn't compare (it may read one of them, as revenue say):
  // attainment and variance, ahead of the plain totals in the section.
  const pairSlugs = new Set<string>();
  usablePairs(profile)
    .filter((p) => !(readByTemplate.has(p.actual.name) && readByTemplate.has(p.target.name)))
    .slice(0, MAX_PAIRS)
    .forEach((p, j) => {
      const A = friendly(p.actual.name);
      const T = friendly(p.target.name);
      out.kpis.push(
        ...pairKpis({
          ...p,
          actualField: field(p.actual),
          targetField: field(p.target),
          dateField: date ? field(date) : null,
          dateLabel: date ? friendly(date.name) : "",
          prefix: COLUMN_PREFIX,
          used: pairSlugs,
          group: COLUMN_GROUP,
          tiers: ["detail", "detail"],
          priority: 90 + j * 2,
          why:
            domain.id === "generic"
              ? ""
              : ` The ${domain.name} template doesn't compare ${A} with ${T}, so Loupe does it straight from your file.`,
        }),
      );
    });
  hourOfDay(input, out, field);
  return out;
}

/**
 * "<KPI> by hour of <time column>" for a separate time-of-day column, when
 * the template has no hour-of-day chart of its own. The measure is the
 * view's leading additive KPI (a count or a total), so the hours add up to it.
 */
function hourOfDay(input: ColumnExtrasInput, out: ColumnExtras, field: (c: ColumnProfile) => string): void {
  const { domain, res, profile, subDomainId } = input;
  const time = profile.columns.find((c) => c.role === "time" && c.nullPct < 0.95);
  if (!time) return;
  // Same rule as recommendCharts: an untagged template belongs to the first sub-domain.
  const inView = (t: { subDomains?: string[] }) =>
    t.subDomains ? t.subDomains.includes(subDomainId) : domain.subDomains[0]?.id === subDomainId;
  const hourAxis = (a: unknown) => Boolean(a && typeof a === "object" && "part" in a && a.part === "hour");
  if (domain.charts.some((t) => inView(t) && (hourAxis(t.x) || hourAxis(t.series)))) return;
  const tierRank = { hero: 0, supporting: 1, detail: 2 } as const;
  const lookup = (id: string) => res.get(id)?.variant?.expr;
  const measure = [...res.values()]
    .filter((r) => r.available && r.variant && !r.def.hidden && !r.dependencyOnly && !isColumnId(r.def.id))
    .sort((a, b) => tierRank[a.def.tier] - tierRank[b.def.tier] || a.def.priority - b.def.priority)
    .find((r) => isAdditiveExpr(r.variant?.expr as Expr, lookup));
  if (!measure) return;
  out.charts.push({
    id: `${COLUMN_PREFIX}hour_${slug(time.name, new Set())}`,
    title: sentenceCase(`${measure.def.name} by hour of ${friendly(time.name)}`),
    kind: "bar",
    section: "columns",
    x: { part: "hour", of: field(time) },
    measures: [measure.def.id],
    reason: `${friendly(time.name)} holds times of day in a column of its own: columns by hour show when activity peaks. It is never mixed with the date.`,
    alternatives: ["line"],
    size: { w: 6, h: 4 },
    priority: 0,
    subDomains: [subDomainId],
    modes: ["analyst", "compact"],
  });
}
