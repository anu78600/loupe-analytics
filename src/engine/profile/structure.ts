/**
 * Table-structure analysis: keys and grain, hierarchies (functional
 * dependencies between categorical columns), the primary time axis and its
 * regularity, and wide-format ("Jan, Feb, Mar" columns) detection.
 *
 * Called by profileDataset after the column profiles exist, and driven by
 * their roles and tokens. Every check is exact except hierarchies, which use
 * a systematic sample of up to 300,000 rows.
 */
import type { Column, Dataset } from "@/engine/core/types";
import { DAY_MS, nextBucket, truncate, type TimeGrain } from "@/engine/core/dates";
import { systematicSample } from "@/engine/core/stats";
import type {
  ColumnProfile,
  GrainInfo,
  HierarchyInfo,
  KeyInfo,
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
 * The grain as shown everywhere (dashboard, report cover, data dictionary):
 * the detected key when the file has a meaningful one ("One row per order"),
 * else the template's assumption (`templateGrain`, "order line"), else the
 * detected fallback. A key that only numbers the rows ("Row ID") says nothing
 * about what a row is, so it gives way to the template.
 */
export function grainLabel(grain: GrainInfo, templateGrain?: string): string {
  const rowNumber = /^One row per (row|record|index|serial|entry|s ?no|sr|sl)$/i.test(grain.description);
  if (grain.confidence >= 0.8 && !rowNumber) return grain.description;
  return templateGrain ? `One row per ${templateGrain}` : grain.description;
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
