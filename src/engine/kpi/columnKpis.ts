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
 * its own ("From your other columns"). A separate time-of-day column the
 * template doesn't chart gets an hour-of-day chart there too.
 *
 * The results are ordinary registry-shaped definitions (fields with an
 * identity mapping, KPIs, chart templates) merged into the domain by the
 * session, so the evaluator, SQL, DAX, exports and insights treat them like
 * any other KPI. Nothing is estimated and no column is created: every
 * definition reads one column of the file.
 */
import type { ColumnProfile, DatasetProfile } from "@/engine/profile/types";
import { tokenize } from "@/engine/profile/names";
import { isAdditiveExpr, type Expr } from "@/engine/query/expr";
import type { Mapping } from "@/engine/detect/mapping";
import type { ChartTemplate, DomainDef, FieldDef, KpiDef } from "@/registry/schema";
import type { KpiResolutionMap } from "./resolve";

/** Id prefix of everything built here ("your column"); no registry id uses it. */
export const COLUMN_PREFIX = "yc_";
/** KPI group (and Power BI display folder) of the column KPIs. */
export const COLUMN_GROUP = "From your columns";
/** At most this many columns get KPIs, and the first CHARTED of them get charts. */
const MAX_KPIS = 8;
const CHARTED = 4;

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
  const read = new Set<string>();
  for (const r of res.values()) {
    if (!r.available || r.dependencyOnly) continue;
    for (const f of r.fieldsUsed) {
      const col = f.startsWith("col:") ? f.slice(4) : mapping.fields[f];
      if (col) read.add(col);
    }
  }
  const rank = (c: ColumnProfile) =>
    c.role === "currency" ? 0 : c.role === "rate" || c.role === "percentage" ? 1 : 2;
  const columns = profile.columns
    .filter((c) => isCandidate(c) && !read.has(c.name) && c.name !== dateColumn)
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
    out.fields.push({ id, label: c.name, roles: [c.role], synonyms: [], weight: 1 });
    out.mapping[id] = c.name;
    fieldFor.set(c.name, id);
    return id;
  };
  const date = dateColumn ? profile.columns.find((c) => c.name === dateColumn) : undefined;
  const mapped = new Set(Object.values(mapping.fields));
  const dim = breakdownColumn(profile, mapped);
  const kpiSlugs = new Set<string>();

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
    if (how === "average") {
      expr = { agg: "avg", of: { field: f } };
      name = `Average ${c.name}`;
      definition = `Average ${c.name} across the rows in the selection (blank cells are left out).`;
      formula = `Average of ${c.name}`;
      if (c.role === "rate" || c.role === "percentage")
        caveat = "A simple average of row values; each row counts once, whatever its size.";
    } else if (how === "latest" && date) {
      expr = { atLatest: field(date), expr: { agg: "sum", of: { field: f } } };
      name = `${c.name} (latest)`;
      definition = `${c.name} on the latest ${date.name} in the selection; it is a balance, so it is not added across dates.`;
      formula = `Sum of ${c.name} on the latest ${date.name}`;
    } else {
      expr = { agg: "sum", of: { field: f } };
      name = `Total ${c.name}`;
      definition = `Sum of ${c.name} across the rows in the selection.`;
      formula = `Sum of ${c.name}`;
    }
    // Say why the column has its own KPI: the template either doesn't know it, or
    // recognises it but computes its KPIs another way (e.g. profit as revenue − cost).
    const known = domain.fields.find((fl) => mapping.fields[fl.id] === c.name);
    const why =
      domain.id === "generic"
        ? ""
        : known
          ? ` The ${domain.name} template reads ${c.name} as "${known.label}" but computes its own KPIs another way, so this is the plain total or average of your column.`
          : ` The ${domain.name} template doesn't use ${c.name}, so Loupe summarises it straight from your file.`;
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
    if (date)
      out.charts.push({
        id: `${COLUMN_PREFIX}trend_${s}`,
        title: `${name} over time`,
        kind: how === "total" ? "bar" : "line",
        section: "columns",
        x: { time: field(date) },
        measures: [id],
        reason: avg
          ? `${c.name} is averaged, so a line shows how the average moves; it is never summed.`
          : `${c.name} adds up over time: one column per period.`,
        alternatives: how === "total" ? ["line", "area"] : ["bar"],
        size: { w: 6, h: 4 },
        priority: 1 + i * 2,
        subDomains: [subDomainId],
        modes: ["analyst", "compact"],
      });
    if (dim)
      out.charts.push({
        id: `${COLUMN_PREFIX}by_${s}`,
        title: `${name} by ${dim.name}`,
        // Totals by state read well as a tile map; averages are compared, so they get sorted bars.
        kind:
          !avg && dim.geoLevel === "state" && (dim.geoRegion === "IN" || dim.geoRegion === "US")
            ? "geoTile"
            : "hbar",
        section: "columns",
        x: { field: field(dim) },
        measures: [id],
        topN: 10,
        others: true,
        // An average over a handful of rows is noise; those groups are set aside, as everywhere else.
        ...(avg ? { minGroupRows: 5 } : {}),
        reason: avg
          ? `Average ${c.name} for each ${dim.name}, sorted, so the highest and lowest stand out. Groups with fewer than 5 rows are set aside.`
          : `Where ${c.name} comes from: sorted bars by ${dim.name}, top 10 plus Others.`,
        alternatives: avg ? ["hbar", "bar", "table"] : ["hbar", "bar", "treemap", "table"],
        size: { w: 6, h: 4 },
        priority: 2 + i * 2,
        subDomains: [subDomainId],
        modes: ["analyst", "compact"],
      });
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
    title: `${measure.def.name} by hour of ${time.name}`,
    kind: "bar",
    section: "columns",
    x: { part: "hour", of: field(time) },
    measures: [measure.def.id],
    reason: `${time.name} holds times of day in a column of its own: columns by hour show when activity peaks. It is never mixed with the date.`,
    alternatives: ["line"],
    size: { w: 6, h: 4 },
    priority: 0,
    subDomains: [subDomainId],
    modes: ["analyst", "compact"],
  });
}
