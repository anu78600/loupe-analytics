/**
 * Table-structure analysis: keys and grain, hierarchies (functional
 * dependencies between categorical columns), the primary time axis and its
 * regularity, wide-format ("Jan, Feb, Mar" columns) detection, and tall
 * scorecards ("Metric | Month | Value" rows, one metric per row).
 *
 * Called by profileDataset after the column profiles exist, and driven by
 * their roles and tokens. Every check is exact except hierarchies, which use
 * a systematic sample of up to 300,000 rows.
 */
import type { Column, Dataset, NumberColumn, StringColumn } from "@/engine/core/types";
import { DAY_MS, nextBucket, truncate, type TimeGrain } from "@/engine/core/dates";
import { systematicSample } from "@/engine/core/stats";
import type {
  ColumnProfile,
  GrainInfo,
  HierarchyInfo,
  KeyInfo,
  TallFormatInfo,
  TimeSeriesInfo,
  WideFormatInfo,
} from "./types";
import { tokenize } from "./names";

// ---------------------------------------------------------------- dense codes

export interface DenseCodes {
  /** Per-row code in [0, card). */
  codes: Int32Array;
  /**
   * Exclusive upper bound of the codes. For strings it is dict.length + 1
   * even if some entries never occur, so it can exceed the distinct count.
   */
  card: number;
}

/**
 * Maps any column to dense integer codes (nulls get their own code).
 * `rows` limits the output to those row indices, in that order. Strings reuse
 * dictionary codes (null = dict.length), booleans use 0/1 (null = 2), and
 * numbers and dates are numbered in first-seen order (NaN shares one code).
 */
export function denseCodes(col: Column, rows?: Int32Array): DenseCodes {
  const n = rows ? rows.length : col.kind === "string" ? col.codes.length : col.values.length;
  const out = new Int32Array(n);
  if (col.kind === "string") {
    const nullCode = col.dict.length;
    for (let i = 0; i < n; i++) {
      const c = col.codes[rows ? (rows[i] as number) : i] as number;
      out[i] = c < 0 ? nullCode : c;
    }
    return { codes: out, card: nullCode + 1 };
  }
  if (col.kind === "boolean") {
    for (let i = 0; i < n; i++) {
      const v = col.values[rows ? (rows[i] as number) : i] as number;
      out[i] = v < 0 ? 2 : v;
    }
    return { codes: out, card: 3 };
  }
  const map = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const v = col.values[rows ? (rows[i] as number) : i] as number;
    const key = v === v ? v : Number.NEGATIVE_INFINITY;
    let c = map.get(key);
    if (c === undefined) {
      c = map.size;
      map.set(key, c);
    }
    out[i] = c;
  }
  return { codes: out, card: map.size };
}

// ---------------------------------------------------------------- keys & grain

/** Business entities recognised in key column names, used to phrase the grain ("One row per order"). */
const ENTITY_WORDS = [
  "order",
  "invoice",
  "transaction",
  "customer",
  "product",
  "sku",
  "item",
  "line",
  "employee",
  "account",
  "user",
  "session",
  "campaign",
  "ticket",
  "patient",
  "student",
  "policy",
  "claim",
  "loan",
  "booking",
  "shipment",
  "store",
  "subscription",
  "visit",
  "event",
  "call",
  "lead",
  "deal",
  "payment",
  "return",
];

/** Entity a key column refers to: the first entity word in its name, else its remaining tokens, else the raw name. */
function entityOf(columnName: string): string {
  const toks = tokenize(columnName).filter((t) => !["id", "number", "key", "code", "no"].includes(t));
  const hit = toks.find((t) => ENTITY_WORDS.includes(t));
  return hit ?? (toks.join(" ") || columnName);
}

/** True when no (a, b) code pair repeats, i.e. the two columns together form a key. */
function pairUnique(a: DenseCodes, b: DenseCodes): boolean {
  const seen = new Set<number>();
  const n = a.codes.length;
  for (let i = 0; i < n; i++) {
    const k = (a.codes[i] as number) * b.card + (b.codes[i] as number);
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

/** Roles that can identify a row: IDs and labels, and dates paired with a label. Never measures, flags or free text. */
const KEY_ROLES = new Set(["identifier", "dimension", "geo", "datetime"]);

/**
 * Finds a primary key and describes the grain. A single-column key is a
 * unique, null-free identifier, label or geo column, or a date-only column
 * (one row per day or month); identifiers rank first, then id-like names,
 * and a date comes last. A unique measure such as a float amount is unique
 * by accident, so it never becomes a key, and neither does a timestamp with a
 * time of day. Only when no single key exists are pairs of up to 8
 * identifier/dimension/date/geo columns (under 5% nulls, none unique on its
 * own, so a pair is a minimal key) tried.
 */
export function detectKeysAndGrain(ds: Dataset, cols: ColumnProfile[]): { keys: KeyInfo; grain: GrainInfo } {
  const n = ds.rowCount;
  const keyable = (c: ColumnProfile) =>
    KEY_ROLES.has(c.role) && !(c.role === "datetime" && c.temporal?.hasTime);
  const singles = cols.filter((c) => c.unique && c.nullCount === 0 && n > 1 && keyable(c));
  const rank = (c: ColumnProfile) =>
    (c.role === "identifier" ? 2 : 0) +
    (c.tokens.some((t) => ["id", "number", "key", "code"].includes(t)) ? 1 : 0) -
    (c.role === "datetime" ? 1 : 0);
  singles.sort((a, b) => rank(b) - rank(a));

  const foreign = cols
    .filter((c) => c.role === "identifier" && !c.unique && c.distinct > 1)
    .map((c) => ({ column: c.name, entity: entityOf(c.name) }));

  const candidates: string[][] = singles.map((c) => [c.name]);
  let primary: string[] | null = singles[0] ? [singles[0].name] : null;

  if (!primary && n > 1) {
    const pool = cols
      .filter((c) => KEY_ROLES.has(c.role) && c.distinct > 1 && c.nullPct < 0.05 && !c.unique)
      .sort(
        (a, b) =>
          (b.role === "identifier" ? 1 : 0) - (a.role === "identifier" ? 1 : 0) || b.distinct - a.distinct,
      )
      .slice(0, 8);
    const codes = new Map<string, DenseCodes>();
    const get = (name: string): DenseCodes => {
      let d = codes.get(name);
      if (!d) {
        const col = ds.columns.find((c) => c.name === name) as Column;
        d = denseCodes(col);
        codes.set(name, d);
      }
      return d;
    };
    for (let i = 0; i < pool.length && candidates.length < 3; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const a = pool[i] as ColumnProfile;
        const b = pool[j] as ColumnProfile;
        // Pigeonhole: fewer non-null value combinations than rows cannot be unique, so skip the scan.
        if (a.distinct * b.distinct < n) continue;
        if (pairUnique(get(a.name), get(b.name))) candidates.push([a.name, b.name]);
      }
    }
    primary = candidates[0] ?? null;
  }

  let grain: GrainInfo;
  if (primary && primary.length === 1) {
    const e = entityOf(primary[0] as string);
    grain = { columns: primary, description: `One row per ${e}`, confidence: 0.9 };
  } else if (primary && primary.length === 2) {
    const [a, b] = primary as [string, string];
    const ea = entityOf(a);
    const eb = entityOf(b);
    const aCol = cols.find((c) => c.name === a);
    const bCol = cols.find((c) => c.name === b);
    let description = `One row per ${ea} × ${eb}`;
    if (aCol?.role === "datetime" || bCol?.role === "datetime") {
      const dim = aCol?.role === "datetime" ? eb : ea;
      description = `One row per ${dim} per date`;
    } else if (
      ["order", "invoice", "transaction"].includes(ea) &&
      ["product", "sku", "item", "line"].includes(eb)
    ) {
      description = `One row per ${ea} line (${ea} × ${eb})`;
    } else if (
      ["order", "invoice", "transaction"].includes(eb) &&
      ["product", "sku", "item", "line"].includes(ea)
    ) {
      description = `One row per ${eb} line (${eb} × ${ea})`;
    }
    grain = { columns: primary, description, confidence: 0.8 };
  } else {
    grain = {
      columns: [],
      description: "No unique key found: each row is likely an event or transaction line",
      confidence: 0.35,
    };
  }
  return { keys: { primary, candidates, foreign }, grain };
}

/**
 * The grain as shown everywhere (Detect, dashboard, report cover, data
 * dictionary): the detected key when the file has a meaningful one ("One row
 * per order"), else the template's assumption (`templateGrain`, "order
 * line"), else the detected fallback. A key that only numbers the rows ("Row
 * ID", or "Column 1" in a file without headers) says nothing about what a row
 * is, so it gives way to the template; without one it is named as the
 * column that is unique ("Each row has its own Row ID"), never "One row per
 * row".
 */
export function grainLabel(grain: GrainInfo, templateGrain?: string): string {
  const rowNumber = /^One row per (row|record|index|serial|entry|s ?no|sr|sl|column \d+)$/i.test(
    grain.description,
  );
  if (grain.confidence >= 0.8 && !rowNumber) return grain.description;
  if (templateGrain) return `One row per ${templateGrain}`;
  const [key] = grain.columns;
  return rowNumber && grain.columns.length === 1 && key ? `Each row has its own ${key}` : grain.description;
}

// ---------------------------------------------------------------- hierarchies

// Name tokens that classify a hierarchy; geo wins first, then product, then organisation.
const PRODUCT_TOKENS = [
  "category",
  "subcategory",
  "product",
  "brand",
  "sku",
  "item",
  "department",
  "class",
  "segment",
  "family",
  "line",
  "type",
];
const ORG_TOKENS = ["department", "team", "division", "manager", "unit", "branch", "office", "function"];

/**
 * Finds drill-down chains among string dimension/geo columns (2–50,000
 * distinct values, under 20% nulls, first 14 such columns). Parent → child
 * when the parent has fewer distinct values and each child value maps to a
 * single parent in ≥ 98% of sampled rows. Returns up to 6 maximal chains,
 * coarse to fine.
 */
export function detectHierarchies(ds: Dataset, cols: ColumnProfile[]): HierarchyInfo[] {
  const pool = cols
    .filter(
      (c) =>
        c.storage === "string" &&
        (c.role === "dimension" || c.role === "geo") &&
        c.distinct >= 2 &&
        c.distinct <= 50_000 &&
        c.nullPct < 0.2,
    )
    .slice(0, 14);
  if (pool.length < 2) return [];
  const rows = systematicSample(ds.rowCount, 300_000);
  const codes = new Map<string, DenseCodes>();
  for (const c of pool) codes.set(c.name, denseCodes(ds.columns[c.index] as Column, rows));

  const edges = new Map<string, Set<string>>();
  const purityOf = new Map<string, number>();
  for (const parent of pool) {
    for (const child of pool) {
      // A parent must have fewer distinct values than its child, which also keeps the edge graph acyclic.
      if (parent === child || parent.distinct >= child.distinct) continue;
      const pc = codes.get(parent.name) as DenseCodes;
      const cc = codes.get(child.name) as DenseCodes;
      const firstParent = new Int32Array(cc.card).fill(-1);
      // Count rows per (child, parent) majority by tracking first-seen parent and mismatches.
      // Mismatches are counted against the first-seen parent, not the true majority, so the
      // resulting purity is a lower bound (a conservative test).
      let mismatches = 0;
      for (let i = 0; i < rows.length; i++) {
        const c = cc.codes[i] as number;
        const p = pc.codes[i] as number;
        const f = firstParent[c] as number;
        if (f < 0) firstParent[c] = p;
        else if (f !== p) mismatches++;
      }
      const purity = 1 - mismatches / rows.length;
      if (purity >= 0.98) {
        const set = edges.get(parent.name) ?? new Set<string>();
        set.add(child.name);
        edges.set(parent.name, set);
        purityOf.set(`${parent.name}>${child.name}`, purity);
      }
    }
  }
  if (edges.size === 0) return [];

  const hasParent = new Set<string>();
  for (const kids of edges.values()) for (const k of kids) hasParent.add(k);
  const chains: string[][] = [];
  const walk = (node: string, path: string[]) => {
    const kids = [...(edges.get(node) ?? [])];
    // Only follow direct steps (skip edges implied by transitivity).
    const direct = kids.filter((k) => !kids.some((other) => other !== k && edges.get(other)?.has(k)));
    if (direct.length === 0) {
      if (path.length >= 2) chains.push(path);
      return;
    }
    for (const k of direct) walk(k, [...path, k]);
  };
  for (const root of edges.keys()) if (!hasParent.has(root)) walk(root, [root]);

  // Longest first; drop any chain whose levels all appear in a longer one.
  const unique = chains
    .sort((a, b) => b.length - a.length)
    .filter((c, i, all) => !all.slice(0, i).some((longer) => c.every((x) => longer.includes(x))))
    .slice(0, 6);

  return unique.map((levels) => {
    const profiles = levels.map((l) => cols.find((c) => c.name === l) as ColumnProfile);
    let purity = 1;
    for (let i = 0; i < levels.length - 1; i++)
      purity = Math.min(purity, purityOf.get(`${levels[i]}>${levels[i + 1]}`) ?? 1);
    const kind: HierarchyInfo["kind"] = profiles.some((p) => p.role === "geo")
      ? "geo"
      : profiles.some((p) => p.tokens.some((t) => PRODUCT_TOKENS.includes(t)))
        ? "product"
        : profiles.some((p) => p.tokens.some((t) => ORG_TOKENS.includes(t)))
          ? "organisation"
          : "other";
    return { levels, purity, kind };
  });
}

// ---------------------------------------------------------------- time axis

// Name tokens that make a date column more (order, transaction) or less (ship, birth, exit) likely to be
// the main time axis.
const PRIMARY_DATE_HINTS = [
  "order",
  "transaction",
  "invoice",
  "sale",
  "booking",
  "created",
  "event",
  "date",
  "purchase",
  "placed",
  "visit",
  "admission",
  "posting",
  "txn",
  "period",
  "month",
  "day",
  "timestamp",
  "datetime",
];
const SECONDARY_DATE_HINTS = [
  "ship",
  "shipping",
  "delivery",
  "dispatch",
  "return",
  "refund",
  "birth",
  "birthdate",
  "dob",
  "hire",
  "joining",
  "joiningdate",
  "exit",
  "termination",
  "due",
  "expiry",
  "end",
  "close",
  "closed",
  "updated",
  "modified",
  "resolved",
  "discharge",
  "maturity",
  "signup",
];

/**
 * Picks the main time axis among datetime columns. Score = 2 × fill rate,
 * + 1.5 for an event-like name, − 1.6 for a secondary-date name, + up to 0.5
 * for covering a year of distinct days; earlier columns win near-ties.
 */
export function pickPrimaryDate(cols: ColumnProfile[]): string | null {
  const dates = cols.filter((c) => c.role === "datetime" && c.temporal && c.temporal.spanDays >= 0);
  if (dates.length === 0) return null;
  const score = (c: ColumnProfile) => {
    let s = (1 - c.nullPct) * 2;
    if (c.tokens.some((t) => PRIMARY_DATE_HINTS.includes(t))) s += 1.5;
    if (c.tokens.some((t) => SECONDARY_DATE_HINTS.includes(t))) s -= 1.6;
    s += Math.min(1, (c.temporal?.distinctDays ?? 0) / 365) * 0.5;
    return s - c.index * 0.01;
  };
  return [...dates].sort((a, b) => score(b) - score(a))[0]?.name ?? null;
}

/**
 * Counts empty buckets between the first and last date at the column's
 * granularity (sub-daily data is checked by day, daily data spanning more
 * than 3 years by week). Regular when at most 2% of buckets are empty; the 5
 * longest gaps are reported. Iteration stops after 20,000 buckets.
 */
export function analyseTimeSeries(ds: Dataset, profile: ColumnProfile): TimeSeriesInfo | null {
  const col = ds.columns[profile.index];
  if (!col || col.kind !== "date" || !profile.temporal) return null;
  const t = profile.temporal;
  let grain: TimeGrain;
  if (t.granularity === "minute" || t.granularity === "hour" || t.granularity === "day") grain = "day";
  else grain = t.granularity;
  if (grain === "day" && t.spanDays > 3 * 365) grain = "week";

  const present = new Set<number>();
  const v = col.values;
  for (let i = 0; i < v.length; i++) {
    const x = v[i] as number;
    if (x === x) present.add(truncate(x, grain));
  }
  const gaps: Array<{ from: number; to: number; periods: number }> = [];
  let periods = 0;
  let missing = 0;
  let runStart = -1;
  let runLen = 0;
  const start = truncate(t.min, grain);
  const end = truncate(t.max, grain);
  // The last bucket always holds the max date, so every gap run is closed inside the loop
  // (unless the 20,000-bucket cap cuts it short).
  for (let b = start; b <= end && periods < 20_000; b = nextBucket(b, grain)) {
    periods++;
    if (!present.has(b)) {
      missing++;
      if (runStart < 0) runStart = b;
      runLen++;
    } else if (runStart >= 0) {
      gaps.push({ from: runStart, to: b - 1, periods: runLen });
      runStart = -1;
      runLen = 0;
    }
  }
  gaps.sort((a, b) => b.periods - a.periods);
  return {
    column: profile.name,
    granularity: grain,
    periods,
    missingPeriods: missing,
    regular: periods > 0 && missing / periods <= 0.02,
    gaps: gaps.slice(0, 5),
    from: t.min,
    to: t.max,
  };
}

// ---------------------------------------------------------------- wide format

// Period-like column names: months with an optional year ("Jan", "January 2024", "Mar-25", "Sept."),
// quarters ("Q1", "2024 Q1", "Q3-24"), years ("2024", "FY24") and "YYYY-MM". MONTH_RE accepts only month
// names and their usual abbreviations, so words that start like a month ("Market", "Junior", "Mayor")
// are not periods.
const MONTH_RE =
  /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:[\s\-_']*(\d{2}|\d{4}))?$/i;
const QUARTER_RE = /^(?:(\d{4})[\s\-_]*)?q([1-4])(?:[\s\-_]*(\d{2}|\d{4}))?$/i;
const YEAR_RE = /^(?:fy[\s\-_]?)?((?:19|20)\d{2}|\d{2})$/i;
const YM_RE = /^(\d{4})[-/](\d{1,2})$/;

/** Period kind of a column name, or null. A bare two-digit number is not a year (needs "FY" or 19xx/20xx). */
export function wideKind(name: string): WideFormatInfo["kind"] | null {
  const s = name.trim();
  if (MONTH_RE.test(s)) return "month";
  if (QUARTER_RE.test(s)) return "quarter";
  if (YM_RE.test(s)) return "date";
  if (YEAR_RE.test(s) && (/^fy/i.test(s) || /^(19|20)\d{2}$/.test(s))) return "year";
  return null;
}

/**
 * Wide format = at least 3 numeric columns of one period kind; the kind with
 * the most columns wins. All other columns become id columns.
 */
export function detectWideFormat(cols: ColumnProfile[]): WideFormatInfo | null {
  const numeric = cols.filter((c) => c.storage === "number");
  const byKind = new Map<WideFormatInfo["kind"], string[]>();
  for (const c of numeric) {
    const k = wideKind(c.name);
    if (k) byKind.set(k, [...(byKind.get(k) ?? []), c.name]);
  }
  let best: { kind: WideFormatInfo["kind"]; cols: string[] } | null = null;
  for (const [kind, names] of byKind)
    if (names.length >= 3 && (!best || names.length > best.cols.length)) best = { kind, cols: names };
  if (!best) return null;
  const idColumns = cols.filter((c) => !best.cols.includes(c.name)).map((c) => c.name);
  return {
    columns: best.cols,
    idColumns,
    kind: best.kind,
    suggestion: `${best.cols.length} ${best.kind === "date" ? "period" : best.kind} columns (${best.cols.slice(0, 3).join(", ")}…) hold the same measure. Unpivot them into one "${best.kind === "year" ? "Year" : "Period"}" column and one "Value" column so trends and totals work correctly.`,
  };
}

export { DAY_MS };

// ---------------------------------------------------------------- tall scorecards

/** More distinct names than this are things (products, people), not the metrics of one scorecard. */
const MAX_METRICS = 200;

/** A set of words written as lines of space-separated words, so a long vocabulary stays readable. */
function wordSet(...lines: string[]): ReadonlySet<string> {
  return new Set(lines.join(" ").split(/\s+/).filter(Boolean));
}

/**
 * Words that head a scorecard's metric column: "Metric", "KPI", "Measure",
 * "Indicator", "Parameter", "Particulars" (the heading of an Indian MIS),
 * "Attribute" and "Variable" (what Power Query's unpivot and pandas' melt call
 * it), and the same in German, Spanish, Portuguese and French.
 */
const METRIC_HEADS = wordSet(
  "metric metrics kpi kpis measure measures indicator indicators parameter parameters particular",
  "particulars attribute variable kennzahl kennzahlen indicador indicadores indicateur indicateurs",
  "metrica metricas parametro parametros mesure mesures",
);
/** Two-word headings of a metric column, as tokens: "Line item", "Key figure". */
const METRIC_HEAD_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["line", "item"],
  ["key", "figure"],
];
/**
 * Words that make a heading name something about each metric rather than the
 * metric itself ("KPI Category", "Metric Unit", "Indicator Code", "Unit of
 * Measure"), or its figure ("Measure Value").
 */
const METRIC_QUALIFIERS = wordSet(
  "unit uom category type group class code id number owner weight weightage status section",
  "perspective area frequency polarity direction source formula definition target value threshold",
  "benchmark level rank order sequence family theme pillar dimension date month year period",
);
/**
 * Headings of columns that name the things a metric is measured for (a
 * branch, a product, a department) or sort them (a type, a status): such a
 * column is never read as the metric column from its values alone.
 */
const ENTITY_HEADS = wordSet(
  "branch store outlet shop region zone area territory circle department team division product",
  "category subcategory customer client city state country channel segment brand sku vendor supplier",
  "employee name plant warehouse hotel property hospital school campaign source account ledger",
  "company partner dealer distributor agent rep officer manager project course programme program model",
  "type class status stage reason mode method head group line unit site location office facility ward",
);

/**
 * Words of the columns that hold a scorecard's figures: the figure itself
 * ("Value", "Actual", "Achievement", "Result"), what it is measured against
 * ("Target", "Budget", "Plan", "LY", "Benchmark"), the period to date ("MTD",
 * "YTD", "QTD") and the comparison ("Variance", "vs LY"), including the
 * German, Spanish, Portuguese and Hindi words names.ts reads ("Ist", "Soll",
 * "Meta", "Real", "Lakshya").
 */
const VALUE_WORDS = wordSet(
  "value actual actuals target budget plan planned forecast goal objective quota ly py cy ty lytd mtd",
  "ytd qtd ftd wtd variance var achievement achieved ach achv achmt numerator denominator benchmark",
  "norm baseline prior previous last current figure result reading observed estimate projection",
  "projected soll ist meta real realizado previsto presupuesto objetivo vs",
);
/** What a figure is measured against: never the main value while an outcome column exists. */
const PLAN_WORDS = wordSet(
  "target budget plan planned forecast goal objective quota ly py lytd prior previous last benchmark",
  "norm baseline standard estimate projection projected soll meta previsto presupuesto objetivo",
);
/** A comparison worked out from two figures ("Variance", "Var %", "Growth vs LY"). */
const DERIVED_WORDS = wordSet("variance var diff difference gap deviation delta change growth vs");
/** Words of an achievement share ("Ach %", "% Achieved"): derived when beside a percent sign. */
const ACHIEVEMENT_WORDS = wordSet("ach achv achmt achievement achieved attainment");
/** The parts a rate is worked out from. */
const COMPONENT_WORDS = wordSet("numerator denominator");
/** Cumulative figures: the period to date, after the period's own figure. */
const TO_DATE_WORDS = wordSet("ytd qtd cumulative cum");

/** Percentages, ratios and rates: a "%" or one of these words makes a metric a proportion. */
const RATIO_WORDS = wordSet(
  "percent ratio rate share yield efficiency utilisation utilization occupancy conversion churn",
  "attrition growth yoy mom cagr compliance coverage penetration retention accuracy per ctr cvr roi",
  "roe roa roce nim casa absenteeism productivity",
);
/** Durations: days, hours, turnaround and handling times. */
const DURATION_WORDS = wordSet(
  "day days hour hours hr hrs minute minutes mins second seconds tat aht frt alos duration tenure",
  "downtime uptime turnaround mttr mtbf",
);
/** Money: a currency mark (tokenize writes "money") or a word that is money in a KPI's name. */
const MONEY_WORDS = wordSet(
  "money revenue sale sales income profit cost expense spend price ebitda ebit pat pbt cash collection",
  "disbursement deposit advance loan aum arpu arpa adr revpar trevpar goppar aov atv abv gmv mrr arr",
  "cac ltv premium salary payroll fee turnover capex opex cogs margin outstanding receivable payable",
  "debt interest npa gnpa nnpa eps commission billing",
);
/** Counts: explicit count words, and the things scorecards count. */
const COUNT_WORDS = wordSet(
  "number count nos headcount footfall subscriber customer account user employee visitor visit",
  "admission patient ticket complaint call order transaction connection lead case incident accident",
  "defect room cover booking enrolment enrollment student joiner exit hire policy claim install",
  "download session click impression dau mau wau",
);
/** Scores and indices. */
const SCORE_WORDS = wordSet("score index rating nps csat ces star grade");
/** Physical units ("Data traffic (TB)", "Steel (MT)", "Energy (kWh)"). */
const PHYSICAL_WORDS = wordSet(
  "kg tonne ton mt litre liter kl kwh mwh mw kw km sqft sqm tb gb mb gram metre meter",
);
/** Scale words, as written and as names.ts reads them ("Cr", "crore", "Mn", "lakh"). */
const SCALE_WORDS = wordSet("lakh lakhs lac lacs crore crores cr million mn billion bn thousand");
/** Words that say how a figure is summarised ("Average ticket size", "Total deposits"). */
const SUMMARY_WORDS = wordSet("average avg mean median total");
/** Acronyms and terms that only ever name a KPI. */
const KPI_TERMS = wordSet(
  "kpi npa gnpa nnpa casa par dpd nim roa roe roce roi ebitda ebit pat pbt eps cagr arpu arpa mou adr",
  "revpar trevpar goppar aov atv abv upt gmv mrr arr nrr grr cac ltv nps csat ces fcr aht frt sla tat",
  "otif oee fpy mtbf mttr alos ctr cpc cpm cpl cpa roas dau mau wau headcount footfall dso dpo dio",
  "opex capex cogs ppm yoy mom occupancy attrition churn absenteeism utilisation utilization",
);
/** Other things a scorecard measures: they make a name read as a measure, but not as a KPI on their own. */
const MEASURE_NOUNS = wordSet(
  "output production volume quantity traffic usage consumption backlog inventory stock sold attendance",
  "mortality infection readmission scrap rejection rework energy fuel emission waste throughput",
  "dispatch recovery",
);

/** A unit of measure on its own ("kg", "Pcs", "Nos.", "Ltr", "%", "₹"): the value of a UOM column, not a metric. */
const UNIT_VALUE =
  /^(?:kgs?|g|gms?|grams?|mg|ml|l|ltrs?|litres?|liters?|pcs|pc|pieces?|nos|no|units?|each|ea|box(?:es)?|packs?|pkts?|bags?|cases?|sets?|pairs?|dozens?|doz|mt|tons?|tonnes?|m|cm|mm|km|ft|sqft|sqm|inch(?:es)?|%|₹|rs|inr|usd|\$|hrs?|hours?|mins?|minutes?|days?|count|#)\.?$/i;

/** A code written without spaces, its parts joined by "_", "." or ":" ("actions:lead", "fb_pixel_purchase"). */
const CODE_VALUE = /^[\p{L}\p{N}]+(?:[_.:][\p{L}\p{N}]+)+$/u;

/** Roles of a column that can name a metric on each row. */
const METRIC_ROLES = wordSet("dimension text identifier");
/** Roles of a number column that holds figures. */
const FIGURE_ROLES = wordSet("measure currency percentage rate");
/** Words that make a number column a period ("Year" 2024, "Month" 4, "Week" 12), not a figure. */
const PERIOD_WORDS = wordSet("year yr month mth quarter qtr week wk day period fy date");
/** Words of row-number headings ("S.No", "Sl. No.", "Sr No", "Row", "#"). */
const ROW_NUMBER_WORDS = wordSet("s sl sr sno slno srno serial row index seq sequence");
/** Words of columns that say something about one row rather than which row it is (a RAG status, a remark). */
const ROW_NOTE_WORDS = wordSet(
  "status rag remark remarks comment comments note notes trend flag colour color direction polarity",
  "health signal",
);

/**
 * A text's words, lower case and without accents, both as written and as
 * tokenize reads them. The written words keep what tokenize reads otherwise:
 * an acronym it splits ("RevPAR" → revenue, par), a period to date it
 * expands ("QTD" → quantity) and a heading it translates as something else
 * ("Indicador" → flag).
 */
function wordsOf(text: string): Set<string> {
  const written = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return new Set([...written, ...tokenize(text)]);
}

function hasAny(words: ReadonlySet<string>, set: ReadonlySet<string>): boolean {
  for (const w of words) if (set.has(w)) return true;
  return false;
}

/** What a metric's name says about it. */
interface MetricReading {
  /** The kind of quantity it names, or null when its name doesn't say. */
  unit: "ratio" | "duration" | "money" | "count" | "score" | "physical" | null;
  /** It carries a unit or a KPI's own wording: "%", "(₹ Cr)", "ratio", "No. of", "Average", "ARPU". */
  strong: boolean;
  /** It names something measured, if only with a business noun ("Revenue", "Accounts"). */
  broad: boolean;
}

/**
 * Reads a metric's name: "Gross NPA %" is a ratio, "Advances (₹ Cr)" money,
 * "Subscribers (Mn)" a count, "Average length of stay (days)" a duration.
 * Department or product names such as "Sales" or "Accounts" read as measured
 * things only in the broad sense, so a column of them never passes for a
 * column of KPIs on its values alone.
 */
function readMetric(name: string): MetricReading {
  const w = wordsOf(name);
  const unit: MetricReading["unit"] =
    name.includes("%") || hasAny(w, RATIO_WORDS)
      ? "ratio"
      : hasAny(w, DURATION_WORDS)
        ? "duration"
        : /[₹$€£¥]/.test(name) || hasAny(w, MONEY_WORDS)
          ? "money"
          : name.includes("#") || hasAny(w, COUNT_WORDS)
            ? "count"
            : hasAny(w, SCORE_WORDS)
              ? "score"
              : hasAny(w, PHYSICAL_WORDS)
                ? "physical"
                : null;
  const strong =
    /[%#₹$€£¥]/.test(name) ||
    w.has("percent") ||
    w.has("money") ||
    w.has("number") ||
    w.has("count") ||
    w.has("nos") ||
    hasAny(w, SCALE_WORDS) ||
    hasAny(w, PHYSICAL_WORDS) ||
    hasAny(w, RATIO_WORDS) ||
    hasAny(w, DURATION_WORDS) ||
    hasAny(w, SCORE_WORDS) ||
    hasAny(w, SUMMARY_WORDS) ||
    hasAny(w, KPI_TERMS);
  const broad = strong || hasAny(w, MONEY_WORDS) || hasAny(w, COUNT_WORDS) || hasAny(w, MEASURE_NOUNS);
  return { unit, strong, broad };
}

/**
 * How a heading reads: "metric" when it names a scorecard's metric column
 * ("Metric", "KPI name", "Particulars", "Line item", "Kennzahl"), "entity"
 * when it names the things metrics are measured for (a branch, a product, a
 * department), else "other". A heading about each metric ("KPI Category",
 * "Indicator Code") is not the metric itself.
 */
function headingKind(c: ColumnProfile): "metric" | "entity" | "other" {
  const words = wordsOf(c.name);
  const t = c.tokens;
  const pair = METRIC_HEAD_PAIRS.some(([a, b]) => t.some((x, i) => x === a && t[i + 1] === b));
  if ((pair || hasAny(words, METRIC_HEADS)) && !hasAny(words, METRIC_QUALIFIERS)) return "metric";
  return hasAny(words, ENTITY_HEADS) ? "entity" : "other";
}

/** A text column that may name a metric on each row, with what its heading and values say. */
interface MetricCandidate {
  profile: ColumnProfile;
  heading: "metric" | "entity" | "other";
  /** Share of its distinct values that read as KPIs by their own wording (MetricReading.strong). */
  strongShare: number;
  /** Share of its distinct values that name something measured (MetricReading.broad). */
  broadShare: number;
  /** How many kinds of quantity its values name (percentages, money, counts, durations…). */
  units: number;
}

/**
 * A first look from the profile alone, so most tables cost nothing more: a
 * text column of 2–200 names (not numbers, codes or periods, at most 10%
 * blank) whose heading names metrics, or whose values read as KPIs of at
 * least two kinds under a heading that doesn't name things.
 */
function metricCandidate(c: ColumnProfile): MetricCandidate | null {
  if (c.storage !== "string" || !METRIC_ROLES.has(c.role)) return null;
  const all = c.categorical?.all;
  if (!all || c.distinct < 2 || c.distinct > MAX_METRICS || c.nullPct > 0.1) return null;
  if ((c.categorical?.avgLength ?? 0) > 80) return null;
  if (c.patterns.some((p) => p.kind === "id" && p.share > 0.5)) return null;
  const heading = headingKind(c);
  if (heading === "entity") return null;
  const values = all.map((v) => v.value);
  if (values.filter((v) => /\p{L}{2}/u.test(v)).length < values.length * 0.8) return null;
  // Periods ("Apr-24", "Q1", "FY25") are a wide table's headers melted into rows, units ("kg", "pcs",
  // "Nos") a unit-of-measure column, and codes ("actions:lead", "fb_pixel_purchase") a tool's names for
  // its events: none of them names metrics the way a scorecard does.
  if (values.filter((v) => wideKind(v) !== null).length >= values.length * 0.5) return null;
  if (values.filter((v) => UNIT_VALUE.test(v.trim())).length >= values.length * 0.5) return null;
  if (values.filter((v) => CODE_VALUE.test(v.trim())).length >= values.length * 0.5) return null;
  const readings = values.map(readMetric);
  const units = new Set(readings.map((r) => r.unit).filter((u) => u !== null)).size;
  const strongShare = readings.filter((r) => r.strong).length / readings.length;
  const broadShare = readings.filter((r) => r.broad).length / readings.length;
  if (heading !== "metric" && !(strongShare >= 0.5 && units >= 2)) return null;
  return { profile: c, heading, strongShare, broadShare, units };
}

/** True for a number column headed like a row number ("S.No", "Sl. No.", "#", "Row"). */
function isRowNumber(c: ColumnProfile, words: ReadonlySet<string>): boolean {
  return (
    c.storage === "number" &&
    (hasAny(words, ROW_NUMBER_WORDS) || (c.tokens.length === 1 && c.tokens[0] === "number"))
  );
}

/**
 * True for a number column headed only by period words ("Year", "Month No",
 * "FY", "Week Number"): it says which period a row is for. "Sales per Day" is
 * a figure.
 */
function periodNumber(c: ColumnProfile): boolean {
  return (
    c.tokens.some((t) => PERIOD_WORDS.has(t)) &&
    c.tokens.every(
      (t) => PERIOD_WORDS.has(t) || ["number", "financial", "fiscal"].includes(t) || /^\d+$/.test(t),
    )
  );
}

/**
 * The value columns in the order the scorecard reads them: the figure itself
 * first ("Actual", "Value", "Achievement", "MTD"), then any other plain
 * figure ("Rate"), the period to date ("YTD Actual"), the parts of a rate
 * ("Numerator"), comparisons ("Variance", "Ach %") and last what the figure
 * is measured against ("Target", "Budget", "LY"); file order breaks ties.
 */
function orderValues(values: readonly ColumnProfile[]): ColumnProfile[] {
  const rank = (c: ColumnProfile): number => {
    const w = wordsOf(c.name);
    if (hasAny(w, PLAN_WORDS)) return 5;
    if (hasAny(w, DERIVED_WORDS) || (w.has("percent") && hasAny(w, ACHIEVEMENT_WORDS))) return 4;
    if (hasAny(w, COMPONENT_WORDS)) return 3;
    if (hasAny(w, TO_DATE_WORDS)) return 2;
    return hasAny(w, VALUE_WORDS) ? 0 : 1;
  };
  return [...values].sort((a, b) => rank(a) - rank(b) || a.index - b.index);
}

/**
 * Dense codes of each row's tuple of values over `parts` (dense codes of
 * columns over the same rows), numbered in first-seen order; with no parts
 * every row has code 0. Also used by parse/pivot.ts to group a scorecard's
 * rows.
 */
export function tupleCodes(parts: readonly DenseCodes[], n: number): DenseCodes {
  let codes = new Int32Array(n);
  let card = 1;
  for (const p of parts) {
    const map = new Map<number, number>();
    const next = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      // Fewer than n tuples so far times the column's codes: far below 2^53, so the key is exact.
      const k = (codes[i] as number) * p.card + (p.codes[i] as number);
      let c = map.get(k);
      if (c === undefined) {
        c = map.size;
        map.set(k, c);
      }
      next[i] = c;
    }
    codes = next;
    card = Math.max(1, map.size);
  }
  return { codes, card };
}

/** True when, over the rows marked in `keep`, each `key` code goes with one `col` code (a functional dependency). */
function dependsOn(key: DenseCodes, col: DenseCodes, keep: Uint8Array): boolean {
  const first = new Int32Array(key.card).fill(-1);
  for (let i = 0; i < keep.length; i++) {
    if (!keep[i]) continue;
    const k = key.codes[i] as number;
    const v = col.codes[i] as number;
    const f = first[k] as number;
    if (f < 0) first[k] = v;
    else if (f !== v) return false;
  }
  return true;
}

/** True when at least 3 in 4 metrics appear between half and twice as often as the median one, as in a grid. */
function balanced(counts: readonly number[]): boolean {
  const sorted = [...counts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] as number;
  return counts.filter((c) => c >= median / 2 && c <= median * 2).length >= counts.length * 0.75;
}

/** "A", "A and B", "A, B and C": names in a sentence (also used by the pivot's report and dialog). */
export function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The plain-English suggestion shown on Detect, like WideFormatInfo.suggestion. */
function tallSuggestion(
  metrics: readonly string[],
  values: readonly string[],
  rowsBy: readonly string[],
): string {
  const shown = `${metrics
    .slice(0, 3)
    .map((m) => `"${m}"`)
    .join(", ")}${metrics.length > 3 ? "…" : ""}`;
  const where =
    values.length === 1
      ? `the "${values[0]}" column`
      : values.length <= 3
        ? `the ${listOf(values.map((v) => `"${v}"`))} columns`
        : `"${values[0]}" and ${values.length - 1} other value columns`;
  const rows = rowsBy.length ? `, one row per ${listOf(rowsBy)},` : "";
  return `Each row holds one of ${metrics.length} metrics (${shown}) in ${where}, each in its own unit, so a total across rows would mean nothing. Turn the metrics into columns${rows} so each keeps its own unit.`;
}

/**
 * Reads the table as a tall scorecard with `cand` as its metric column, or
 * returns null. Every other column is sorted into:
 * - value columns: figures (numbers with a measure role), except one that
 *   only describes each metric ("Weightage"), which goes with the metric;
 * - id columns: the periods and entities each row is for, which, with the
 *   metric, tell the rows apart (checked on the data: the fewest such columns
 *   that do, plus any that follow from them, such as a branch's region);
 * - columns pivoting leaves out: those about each metric (a unit, a KPI
 *   category: one value per metric) and about each row (a remark, a RAG
 *   status), and row numbers.
 * Then it decides. A heading that names metrics ("Metric", "KPI") is enough
 * with metric names that read as measures and value columns named like a
 * scorecard's ("Value", "Actual", "Target"), or with metric names of two or
 * more kinds of unit, as long as the figures sit in a few columns (at most
 * eight, or mostly named like a scorecard's); its metrics may repeat
 * unevenly (monthly beside quarterly ones). Otherwise the values must carry
 * it alone: most read as
 * KPIs by their own wording, they name two kinds of unit, the value columns
 * are named like a scorecard's, each metric repeats about as often as the
 * others, and the rows form a grid: the id columns with the metric identify
 * every row, and each combination of id values holds at least half the
 * metrics. A table whose metrics never repeat (one period's flash report)
 * needs the heading and three or more metrics.
 */
function readTall(ds: Dataset, cols: readonly ColumnProfile[], cand: MetricCandidate): TallFormatInfo | null {
  const n = ds.rowCount;
  const metric = cand.profile;
  const mcol = ds.columns[metric.index] as StringColumn;
  const mCard = mcol.dict.length;
  const codesOf = new Map<ColumnProfile, DenseCodes>();
  const code = (c: ColumnProfile): DenseCodes => {
    let d = codesOf.get(c);
    if (!d) {
      d = denseCodes(ds.columns[c.index] as Column);
      codesOf.set(c, d);
    }
    return d;
  };
  // One value of `c` per metric (rows without a metric name aside).
  const perMetric = (c: ColumnProfile): boolean => {
    const d = code(c);
    const first = new Int32Array(mCard).fill(-1);
    for (let i = 0; i < n; i++) {
      const m = mcol.codes[i] as number;
      if (m < 0) continue;
      const v = d.codes[i] as number;
      const f = first[m] as number;
      if (f < 0) first[m] = v;
      else if (f !== v) return false;
    }
    return true;
  };

  const valueCands: ColumnProfile[] = [];
  const idCands: ColumnProfile[] = [];
  for (const c of cols) {
    if (c === metric) continue;
    const words = wordsOf(c.name);
    if (isRowNumber(c, words)) continue;
    if (c.storage === "number" && FIGURE_ROLES.has(c.role) && !periodNumber(c)) {
      // A figure, unless it holds one number per metric under a heading that isn't a figure's ("Weightage").
      if (c.distinct <= 1 || hasAny(words, VALUE_WORDS) || !perMetric(c)) valueCands.push(c);
    } else if (c.role !== "text" && (c.distinct <= 1 || !perMetric(c))) {
      // Free text (remarks) and columns that describe each metric (unit, category) are not ids.
      idCands.push(c);
    }
  }
  if (!valueCands.length) return null;

  // Metrics with at least one figure, in the order the file first names them: a heading row with no
  // figures ("ASSET QUALITY") is not a metric.
  const valueCols = valueCands.map((c) => ds.columns[c.index] as NumberColumn);
  const figured = new Uint8Array(mCard);
  const firstRow = new Int32Array(mCard).fill(-1);
  for (let i = 0; i < n; i++) {
    const m = mcol.codes[i] as number;
    if (m < 0) continue;
    if ((firstRow[m] as number) < 0) firstRow[m] = i;
    if (!figured[m])
      for (const v of valueCols) {
        const x = v.values[i] as number;
        if (x === x) {
          figured[m] = 1;
          break;
        }
      }
  }
  const metricCodes: number[] = [];
  for (let m = 0; m < mCard; m++) if (figured[m]) metricCodes.push(m);
  metricCodes.sort((a, b) => (firstRow[a] as number) - (firstRow[b] as number));
  if (metricCodes.length < 2) return null;
  const keep = new Uint8Array(n);
  const counts = new Int32Array(mCard);
  let kept = 0;
  for (let i = 0; i < n; i++) {
    const m = mcol.codes[i] as number;
    if (m >= 0 && figured[m]) {
      keep[i] = 1;
      counts[m] = (counts[m] as number) + 1;
      kept++;
    }
  }
  const repeats = kept > metricCodes.length;
  if (!repeats && metricCodes.length < 3) return null;
  const even = !repeats || balanced(metricCodes.map((m) => counts[m] as number));

  // Id columns. A column unique on every row of a table whose metrics repeat numbers the rows (an entry
  // ID), unless it is a date: a reading's timestamp is still the row it belongs to.
  const pool = idCands.filter((c) => !(repeats && c.unique && c.nullCount === 0 && c.role !== "datetime"));
  const mCodes = denseCodes(mcol);
  const uniqueWith = (set: readonly ColumnProfile[]): boolean => {
    const t = tupleCodes([...set.map(code), mCodes], n);
    const seen = new Uint8Array(t.card);
    for (let i = 0; i < n; i++) {
      if (!keep[i]) continue;
      const k = t.codes[i] as number;
      if (seen[k]) return false;
      seen[k] = 1;
    }
    return true;
  };
  const rowNote = (c: ColumnProfile) => hasAny(wordsOf(c.name), ROW_NOTE_WORDS);
  const unique = uniqueWith(pool);
  // Whether the rows form a grid: each combination of id values holds most of the metrics, as a
  // scorecard's period and branch do. A table unique on many columns at once (a transaction log, whose
  // rows differ in their time, customer and amount) has about one row per combination instead.
  let grid = false;
  let ids: ColumnProfile[];
  let rowsBy: ColumnProfile[];
  if (unique) {
    // The fewest columns that still tell the rows apart, dropping the least id-like first (a row's
    // status, then plain labels, then entities, dates last); coarser columns go before finer ones.
    const idRank = (c: ColumnProfile): number =>
      rowNote(c)
        ? 0
        : c.role === "datetime" || hasAny(wordsOf(c.name), PERIOD_WORDS)
          ? 3
          : c.role === "identifier" || c.role === "geo" || headingKind(c) === "entity"
            ? 2
            : 1;
    let key = [...pool];
    for (const c of [...pool].sort((a, b) => idRank(a) - idRank(b) || a.distinct - b.distinct)) {
      const without = key.filter((x) => x !== c);
      if (uniqueWith(without)) key = without;
    }
    const keyCodes = tupleCodes(key.map(code), n);
    // Columns that follow from the key come along (a branch's region); those that vary row by row don't.
    ids = pool.filter((c) => key.includes(c) || dependsOn(keyCodes, code(c), keep));
    rowsBy = key;
    const seenKey = new Uint8Array(keyCodes.card);
    let combinations = 0;
    for (let i = 0; i < n; i++) {
      const k = keyCodes.codes[i] as number;
      if (keep[i] && !seenKey[k]) {
        seenKey[k] = 1;
        combinations++;
      }
    }
    grid = kept >= combinations * metricCodes.length * 0.5;
  } else {
    ids = pool.filter((c) => !rowNote(c));
    rowsBy = ids.filter((c) => c.distinct > 1);
  }

  const valueNamedCount = valueCands.filter((c) => hasAny(wordsOf(c.name), VALUE_WORDS)).length;
  const valueNamed = valueNamedCount > 0;
  // A scorecard holds its figures in a few columns, most of them named like a scorecard's. Many other
  // measures beside one typed by a column ("Results" by "Result indicator" in an ads export) make a wide
  // table of measures instead.
  const fewFigures = valueCands.length <= 8 || valueNamedCount >= valueCands.length / 2;
  const byHeading =
    cand.heading === "metric" && fewFigures && ((cand.broadShare >= 0.5 && valueNamed) || cand.units >= 2);
  const byValues =
    repeats &&
    even &&
    grid &&
    cand.heading === "other" &&
    cand.strongShare >= 0.5 &&
    cand.units >= 2 &&
    valueNamed;
  if (!byHeading && !byValues) return null;

  const metrics = metricCodes.map((m) => mcol.dict[m] as string);
  const values = orderValues(valueCands).map((c) => c.name);
  return {
    metricColumn: metric.name,
    metrics,
    valueColumns: values,
    idColumns: ids.map((c) => c.name),
    suggestion: tallSuggestion(
      metrics,
      values,
      rowsBy.map((c) => c.name),
    ),
  };
}

/**
 * A tall "one row per metric" scorecard (types.TallFormatInfo), or null: a
 * text column names a metric on each row ("Metric", "KPI", "Particulars", or
 * values that read as KPIs: "Gross NPA %", "ARPU", "Occupancy"), number
 * columns hold its figures ("Value", "Actual", "Target", "LY", "YTD") and the
 * other columns say which period or entity a row is for. Strict, because a
 * scorecard's figures are never added up across metrics: an ordinary table
 * with a "Category" and an "Amount" column is not one, and neither is a
 * department's sales against target. A wide table (months as columns) is not
 * read as tall: unpivoting it comes first and gives the rows this reads.
 * Candidate metric columns are tried strongest first, at most three.
 */
export function detectTallFormat(ds: Dataset, cols: readonly ColumnProfile[]): TallFormatInfo | null {
  if (ds.rowCount < 2 || cols.length < 2 || detectWideFormat([...cols])) return null;
  // A heading that names metrics first; then names that read as measures, the shortest first, so "KPI"
  // wins over "KPI Description" (which describes each one in a sentence).
  const candidates = cols
    .map(metricCandidate)
    .filter((c): c is MetricCandidate => c !== null)
    .sort(
      (a, b) =>
        Number(b.heading === "metric") - Number(a.heading === "metric") ||
        Number(b.broadShare >= 0.5) - Number(a.broadShare >= 0.5) ||
        (a.profile.categorical?.avgLength ?? 0) - (b.profile.categorical?.avgLength ?? 0) ||
        b.broadShare - a.broadShare,
    );
  for (const cand of candidates.slice(0, 3)) {
    const tall = readTall(ds, cols, cand);
    if (tall) return tall;
  }
  return null;
}
