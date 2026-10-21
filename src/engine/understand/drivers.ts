/**
 * What moves the outcome (version 49.0): every usable column measured
 * against the outcome on the rows, strongest first, each with a plain
 * sentence carrying the numbers behind it.
 *
 * The statistic depends on the two columns, and each gives a strength from
 * 0 to 1 so they can be ranked together:
 * - a number against a numeric, scored or yes/no outcome: Pearson's r (the
 *   point-biserial r when the outcome is 0/1); strength |r|;
 * - a category (2–30 groups, each of at least five rows; smaller groups are
 *   set aside) against such an outcome: the correlation ratio
 *   η = √(SS_between ÷ SS_total);
 * - against unordered classes: η of each number across the classes, and
 *   Cramér's V for each category.
 * Left out: IDs, row indexes, free text, dates and times of day, the
 * outcome itself (hidden columns are not in the profile at all); a column
 * that is a copy of the outcome (|r| ≥ 0.97, the same values, or filled or
 * non-zero exactly where the outcome is yes), which is reported with its
 * reason instead; and, for a transaction table's money outcome, the
 * measures it is made of (prices, quantities, costs, discounts, taxes).
 *
 * Above SAMPLE_ROWS rows the columns are ranked on an evenly spaced sample;
 * every figure shown (r, η, V, the averages and rates in the sentences) is
 * then worked out again on every row for the drivers kept. Passing `rows`
 * restricts everything to those rows (the dashboard's filters), so the
 * insights describe what is on screen.
 *
 * Sentences follow the analyst standards: a true minus sign, "r = 0.44",
 * rates as percentages with one decimal, money in the file's currency.
 */
import type { Column, Dataset } from "@/engine/core/types";
import { columnByName } from "@/engine/core/types";
import { formatPlain, formatValue, type NumberLocale } from "@/engine/core/format";
import { friendly } from "@/engine/core/labels";
import { systematicSample } from "@/engine/core/stats";
import type { ColumnProfile, DatasetProfile } from "@/engine/profile/types";
import { isRowIndex } from "@/engine/profile/roles";
import { tokenize } from "@/engine/profile/names";
import type { ColumnKind, Driver, OutcomeType, Relation } from "./types";
import { positiveLabel } from "./outcome";

/** Above this many rows, columns are ranked on an evenly spaced sample (the figures shown are exact). */
export const SAMPLE_ROWS = 200_000;
/** Drivers weaker than this are not reported. */
export const MIN_STRENGTH = 0.1;
/** At most this many drivers are reported. */
export const MAX_DRIVERS = 8;
/** Columns whose link with the outcome is at least this close are copies of it, not drivers. */
export const COPY_STRENGTH = 0.97;
/** From this strength a column "moves closely with" the outcome; from CLEAR_LINK it "moves with" it; below, the link is weak. */
export const CLOSE_LINK = 0.5;
export const CLEAR_LINK = 0.3;

/**
 * How a link of this strength is worded: "moves closely with" from
 * CLOSE_LINK, "moves with" from CLEAR_LINK, null below (a weak link is never
 * said to move the outcome, let alone most).
 */
export function linkWords(strength: number): "moves closely with" | "moves with" | null {
  return strength >= CLOSE_LINK ? "moves closely with" : strength >= CLEAR_LINK ? "moves with" : null;
}

/** Groups smaller than this are set aside when groups are compared. */
export const MIN_GROUP_ROWS = 5;
/** A category with more groups than this is not compared. */
const MAX_GROUPS = 30;
/** How many columns are worked out exactly after ranking on a sample. */
const EXACT_TOP = 14;

/** The outcome read from its rows, in the form the statistics need. */
export interface OutcomeTarget {
  column: ColumnProfile;
  type: OutcomeType;
  /** Binary: 1 yes, 0 no, NaN blank. Ordinal and amount: the values. Class: unused (all NaN). */
  y: Float64Array;
  /** Class outcomes: each row's class (−1 blank) and the class labels. */
  classes: { codes: Int32Array; labels: string[] } | null;
  /** Binary: how the file spells "yes" ("Yes", "1", "Exited"). */
  positive: string;
  /**
   * Binary: what the rows that are "yes" did, as a verb phrase ("survived", "churned", "left",
   * "were approved"; outcome.ts outcomeVerb); null when the outcome has no plain wording.
   */
  verb: string | null;
  /** Ordinal: the bar of the top of the scale (7 on a scale to 10; the top two points of a 1–5 or 1–7 scale). */
  bar: number;
  /** What the outcome is called in a sentence ("survival", "churn", "quality", "sale price"). */
  noun: string;
  /** The outcome's column name read with spaces. */
  label: string;
  /** True for a money outcome of a table of transactions: the measures it is made of are left out. */
  transactional: boolean;
}

/** The bar of "the top of the scale" for a score from min to max: the top two points up to 7, else 7. */
export function topBar(max: number): number {
  return max <= 7 ? max - 1 : 7;
}

/** Reads the outcome column's rows; null when the column is missing or can't be read as `type`. */
export function outcomeTarget(
  ds: Dataset,
  column: ColumnProfile,
  type: OutcomeType,
  noun: string,
  transactional: boolean,
): OutcomeTarget | null {
  const col = columnByName(ds, column.name);
  if (!col) return null;
  const n = ds.rowCount;
  const y = new Float64Array(n).fill(NaN);
  let classes: OutcomeTarget["classes"] = null;
  let positive = "";
  if (type === "binary") {
    positive = positiveLabel(column, ds);
    if (col.kind === "boolean")
      for (let i = 0; i < n; i++) y[i] = col.values[i] === 1 ? 1 : col.values[i] === 0 ? 0 : NaN;
    else if (col.kind === "number") for (let i = 0; i < n; i++) y[i] = col.values[i] as number;
    else if (col.kind === "string") {
      const yes = col.dict.indexOf(positive);
      for (let i = 0; i < n; i++) {
        const c = col.codes[i] as number;
        y[i] = c < 0 ? NaN : c === yes ? 1 : 0;
      }
    } else return null;
  } else if (type === "class") {
    if (col.kind === "string") classes = { codes: col.codes, labels: [...col.dict] };
    else {
      const g = groupsOf(col, MAX_GROUPS * 2);
      if (!g) return null;
      classes = g;
    }
  } else {
    if (col.kind !== "number") return null;
    y.set(col.values);
  }
  const max = column.numeric?.max ?? 0;
  return {
    column,
    type,
    y,
    classes,
    positive,
    verb: null,
    bar: type === "ordinal" ? topBar(max) : 0,
    noun,
    label: friendly(column.name),
    transactional,
  };
}

// ---------------------------------------------------------------- columns as numbers or groups

/** Values of a number column; null for any other. */
function numbersOf(col: Column | undefined): Float64Array | null {
  return col?.kind === "number" ? col.values : null;
}

/**
 * A column as groups: each row's group (−1 blank) and the group labels, for
 * text, yes/no and whole-number code columns with at most `max` values.
 */
function groupsOf(col: Column | undefined, max = MAX_GROUPS): { codes: Int32Array; labels: string[] } | null {
  if (!col) return null;
  if (col.kind === "string")
    return col.dict.length <= max ? { codes: col.codes, labels: [...col.dict] } : null;
  if (col.kind === "boolean") {
    const codes = new Int32Array(col.values.length);
    for (let i = 0; i < codes.length; i++) codes[i] = col.values[i] === 1 ? 0 : col.values[i] === 0 ? 1 : -1;
    return { codes, labels: [col.trueLabel, col.falseLabel] };
  }
  if (col.kind === "number") {
    const index = new Map<number, number>();
    const codes = new Int32Array(col.values.length);
    for (let i = 0; i < codes.length; i++) {
      const v = col.values[i] as number;
      if (v !== v) {
        codes[i] = -1;
        continue;
      }
      let k = index.get(v);
      if (k === undefined) {
        if (index.size >= max) return null;
        k = index.size;
        index.set(v, k);
      }
      codes[i] = k;
    }
    // Labels in the codes' order; numbers as written, without trailing zeros.
    const labels: string[] = [];
    for (const [v, k] of index) labels[k] = String(Number(v.toPrecision(12)));
    return { codes, labels };
  }
  return null;
}

// ---------------------------------------------------------------- statistics over a row selection

/** Pearson r over the rows (all when `rows` is null) where both values are present. */
function pearsonOn(
  x: Float64Array,
  y: Float64Array,
  rows: ArrayLike<number> | null,
  n: number,
): { r: number; n: number } {
  let m = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  const len = rows ? rows.length : n;
  for (let k = 0; k < len; k++) {
    const i = rows ? (rows[k] as number) : k;
    const a = x[i] as number;
    const b = y[i] as number;
    if (a !== a || b !== b) continue;
    m++;
    sx += a;
    sy += b;
    sxx += a * a;
    syy += b * b;
    sxy += a * b;
  }
  if (m < 10) return { r: NaN, n: m };
  const cov = sxy - (sx * sy) / m;
  const vx = sxx - (sx * sx) / m;
  const vy = syy - (sy * sy) / m;
  if (!(vx > 0) || !(vy > 0)) return { r: NaN, n: m };
  return { r: Math.max(-1, Math.min(1, cov / Math.sqrt(vx * vy))), n: m };
}

/** One group's rows and the mean of the values over them. */
export interface GroupStat {
  label: string;
  rows: number;
  mean: number;
}

/**
 * The correlation ratio of `values` across the groups of `codes`, over the
 * rows with both, setting aside groups of fewer than MIN_GROUP_ROWS rows:
 * η = √(SS_between ÷ SS_total), worked out in two passes so large values
 * don't lose precision. NaN with fewer than two groups left or no spread.
 */
function etaOn(
  codes: Int32Array,
  labels: readonly string[],
  values: Float64Array,
  rows: ArrayLike<number> | null,
  n: number,
): { eta: number; n: number; groups: GroupStat[] } {
  const G = labels.length;
  const count = new Float64Array(G);
  const sum = new Float64Array(G);
  const len = rows ? rows.length : n;
  for (let k = 0; k < len; k++) {
    const i = rows ? (rows[k] as number) : k;
    const g = codes[i] as number;
    const v = values[i] as number;
    if (g < 0 || v !== v) continue;
    count[g] = (count[g] as number) + 1;
    sum[g] = (sum[g] as number) + v;
  }
  const keep = new Uint8Array(G);
  let N = 0;
  let total = 0;
  let kept = 0;
  for (let g = 0; g < G; g++)
    if ((count[g] as number) >= MIN_GROUP_ROWS) {
      keep[g] = 1;
      kept++;
      N += count[g] as number;
      total += sum[g] as number;
    }
  const groups: GroupStat[] = [];
  for (let g = 0; g < G; g++)
    if (keep[g])
      groups.push({
        label: labels[g] as string,
        rows: count[g] as number,
        mean: (sum[g] as number) / (count[g] as number),
      });
  if (kept < 2 || N < 10) return { eta: NaN, n: N, groups };
  const grand = total / N;
  let within = 0;
  for (let k = 0; k < len; k++) {
    const i = rows ? (rows[k] as number) : k;
    const g = codes[i] as number;
    const v = values[i] as number;
    if (g < 0 || v !== v || !keep[g]) continue;
    const d = v - (sum[g] as number) / (count[g] as number);
    within += d * d;
  }
  let between = 0;
  for (let g = 0; g < G; g++)
    if (keep[g]) {
      const d = (sum[g] as number) / (count[g] as number) - grand;
      between += (count[g] as number) * d * d;
    }
  const totalSs = within + between;
  if (!(totalSs > 0)) return { eta: NaN, n: N, groups };
  return { eta: Math.sqrt(Math.min(1, between / totalSs)), n: N, groups };
}

/**
 * Cramér's V between two groupings over the rows with both, groups of
 * either under MIN_GROUP_ROWS rows set aside; also, for the sentence, the
 * class whose share differs most between two groups, and those groups.
 */
function cramerOn(
  a: { codes: Int32Array; labels: readonly string[] },
  b: { codes: Int32Array; labels: readonly string[] },
  rows: ArrayLike<number> | null,
  n: number,
): { v: number; n: number; mix: { cls: string; hi: GroupShare; lo: GroupShare } | null } {
  const A = a.labels.length;
  const B = b.labels.length;
  const table = new Float64Array(A * B);
  const len = rows ? rows.length : n;
  for (let k = 0; k < len; k++) {
    const i = rows ? (rows[k] as number) : k;
    const x = a.codes[i] as number;
    const y = b.codes[i] as number;
    if (x < 0 || y < 0) continue;
    table[x * B + y] = (table[x * B + y] as number) + 1;
  }
  const rowSum = new Float64Array(A);
  const colSum = new Float64Array(B);
  for (let x = 0; x < A; x++)
    for (let y = 0; y < B; y++) {
      rowSum[x] = (rowSum[x] as number) + (table[x * B + y] as number);
      colSum[y] = (colSum[y] as number) + (table[x * B + y] as number);
    }
  const ra = [...Array(A).keys()].filter((x) => (rowSum[x] as number) >= MIN_GROUP_ROWS);
  const cb = [...Array(B).keys()].filter((y) => (colSum[y] as number) >= MIN_GROUP_ROWS);
  if (ra.length < 2 || cb.length < 2) return { v: NaN, n: 0, mix: null };
  // Totals over the kept cells only.
  const r2 = new Map<number, number>();
  const c2 = new Map<number, number>();
  let N = 0;
  for (const x of ra)
    for (const y of cb) {
      const o = table[x * B + y] as number;
      r2.set(x, (r2.get(x) ?? 0) + o);
      c2.set(y, (c2.get(y) ?? 0) + o);
      N += o;
    }
  if (N < 10) return { v: NaN, n: N, mix: null };
  let chi = 0;
  for (const x of ra)
    for (const y of cb) {
      const e = ((r2.get(x) ?? 0) * (c2.get(y) ?? 0)) / N;
      if (e > 0) chi += ((table[x * B + y] as number) - e) ** 2 / e;
    }
  const k = Math.min(ra.length, cb.length) - 1;
  const v = k > 0 ? Math.sqrt(Math.min(1, chi / (N * k))) : NaN;
  // The class (of b) whose share differs most between two groups (of a).
  let mix: { cls: string; hi: GroupShare; lo: GroupShare } | null = null;
  let gap = -1;
  for (const y of cb) {
    let hi: GroupShare | null = null;
    let lo: GroupShare | null = null;
    for (const x of ra) {
      const rowsX = r2.get(x) ?? 0;
      if (!rowsX) continue;
      const share = (table[x * B + y] as number) / rowsX;
      if (!hi || share > hi.share) hi = { label: a.labels[x] as string, share, rows: rowsX };
      if (!lo || share < lo.share) lo = { label: a.labels[x] as string, share, rows: rowsX };
    }
    if (hi && lo && hi.share - lo.share > gap) {
      gap = hi.share - lo.share;
      mix = { cls: b.labels[y] as string, hi, lo };
    }
  }
  return { v, n: N, mix };
}

/** A group's share of one class. */
interface GroupShare {
  label: string;
  share: number;
  rows: number;
}

/** phi between two yes/no tests over the rows where the outcome is known; NaN when either is constant. */
function phiOn(
  test: (i: number) => boolean,
  y: Float64Array,
  rows: ArrayLike<number> | null,
  n: number,
): number {
  let n11 = 0;
  let n10 = 0;
  let n01 = 0;
  let n00 = 0;
  const len = rows ? rows.length : n;
  for (let k = 0; k < len; k++) {
    const i = rows ? (rows[k] as number) : k;
    const b = y[i] as number;
    if (b !== b) continue;
    const a = test(i);
    if (a && b === 1) n11++;
    else if (a) n10++;
    else if (b === 1) n01++;
    else n00++;
  }
  const d = Math.sqrt((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00));
  return d > 0 ? (n11 * n00 - n10 * n01) / d : NaN;
}

// ---------------------------------------------------------------- candidates

/** A column measured against the outcome: as numbers or as groups. */
interface Candidate {
  c: ColumnProfile;
  as: "numeric" | "category";
  x: Float64Array | null;
  groups: { codes: Int32Array; labels: string[] } | null;
}

/** Name words of a transaction's parts and costs: never a driver of its money outcome. */
const PART_WORDS = new Set([
  "price",
  "unitprice",
  "mrp",
  "quantity",
  "qty",
  "unit",
  "cost",
  "discount",
  "tax",
  "gst",
  "vat",
  "fee",
  "shipping",
  "freight",
  "commission",
  "margin",
  "profit",
  "amount",
  "revenue",
  "sale",
  "total",
]);

/**
 * The columns that can move the outcome, read from `kinds` (understand.ts):
 * numbers (amounts, measurements, rates, scores) and groups (categories,
 * places, yes/no flags with 2–30 values). Never IDs, row indexes, text,
 * dates, times of day or the outcome; for a transaction table's money
 * outcome, never money, quantities or the other parts of a transaction.
 */
function candidatesOf(
  profile: DatasetProfile,
  ds: Dataset,
  target: OutcomeTarget,
  kinds: ReadonlyMap<string, ColumnKind>,
): Candidate[] {
  const out: Candidate[] = [];
  for (const c of profile.columns) {
    if (c.name === target.column.name || isRowIndex(c)) continue;
    const kind = kinds.get(c.name);
    if (!kind || kind === "id" || kind === "text" || kind === "time" || kind === "outcome") continue;
    if (c.distinct < 2 || c.nullPct > 0.95) continue;
    const col = columnByName(ds, c.name);
    if (!col) continue;
    const numeric = kind === "amount" || kind === "measurement" || kind === "rate" || kind === "score";
    if (numeric) {
      const x = numbersOf(col);
      if (!x) continue;
      if (target.transactional) {
        const words = c.tokens.length ? c.tokens : tokenize(c.name);
        if (kind === "amount" || c.role === "currency" || words.some((w) => PART_WORDS.has(w))) continue;
      }
      out.push({ c, as: "numeric", x, groups: null });
      continue;
    }
    if (c.distinct > MAX_GROUPS) continue;
    const groups = groupsOf(col);
    if (groups) out.push({ c, as: "category", x: null, groups });
  }
  return out;
}

// ---------------------------------------------------------------- drivers

/** The facts a driver's sentence states, kept for the insights and the tests. */
export type DriverFacts =
  /** A number against a yes/no or scored outcome: its average in the yes (or top) rows and in the rest. */
  | { kind: "split"; high: number; low: number }
  /** A number against an amount: the outcome's average in the top and bottom quarter of the number. */
  | { kind: "quarters"; top: number; bottom: number }
  /** Groups against a yes/no or numeric outcome: the outcome's rate or average in each group (≥ 5 rows), best first. */
  | { kind: "groups"; groups: GroupStat[] }
  /** A number against classes: its average in each class (≥ 5 rows), highest first. */
  | { kind: "classes"; groups: GroupStat[] }
  /** Groups against classes: the class whose share differs most, and the groups with the highest and lowest share. */
  | { kind: "mix"; cls: string; hi: GroupShare; lo: GroupShare };

/** A driver with what the dashboard and the insights need beyond the contract. */
export interface DriverDetail extends Driver {
  /** "numeric": compared as numbers; "category": as groups. */
  as: "numeric" | "category";
  /** Rows the statistic was worked out on. */
  n: number;
  facts: DriverFacts;
}

/** A column left out because it is a copy of the outcome, and why. */
export interface CopyNote {
  column: string;
  reason: string;
}

/** What rankDrivers needs besides the profile and rows. */
export interface DriverOptions {
  /** Each column's kind (understand.ts). */
  kinds: ReadonlyMap<string, ColumnKind>;
  /** Restrict to these rows (the dashboard's filters); null or absent for every row. */
  rows?: Int32Array | null;
  locale?: NumberLocale;
  /** The file's currency code, for money figures. */
  currency?: string;
  /** What the rows are called in a sentence, plural ("wine samples", "passengers"); "rows" by default. */
  rowsWord?: string;
}

const RT = (s: string) => s.replace(/-/g, "−");
/** "r = 0.44", "r = −0.31". */
export const rText = (r: number) => `r = ${RT(r.toFixed(2))}`;
const etaText = (e: number) => `η = ${e.toFixed(2)}`;
const vText = (v: number) => `V = ${v.toFixed(2)}`;
const capitalise = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/** A number as the column's own figures read: money in the currency, else 0–3 decimals by size. */
export function figureOf(c: ColumnProfile, locale: NumberLocale, currency: string): (v: number) => string {
  if (c.role === "currency")
    return (v) => formatValue(v, "currency", { locale, currency: c.currency ?? currency });
  if (c.role === "percentage" && c.percentScale === 1)
    return (v) => formatValue(v, "percent", { locale, currency });
  const suffix = c.role === "percentage" ? "%" : "";
  return (v) => {
    const a = Math.abs(v);
    const decimals = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
    return `${formatValue(v, "decimal", { locale, currency, decimals })}${suffix}`;
  };
}

/** A share as a percentage with one decimal ("74.2%"). */
const pct = (v: number, locale: NumberLocale) => formatValue(v, "percent", { locale, currency: "USD" });

/**
 * Every column measured against the outcome, strongest first, with its
 * sentence and facts worked out on every selected row, and the columns left
 * out as copies of the outcome. Weak columns are kept here (the dashboard
 * ranks its features with them); the understanding reports those of
 * strength MIN_STRENGTH or more.
 */
export function rankDrivers(
  profile: DatasetProfile,
  ds: Dataset,
  target: OutcomeTarget,
  opts: DriverOptions,
): { ranked: DriverDetail[]; copies: CopyNote[] } {
  const all = opts.rows ?? null;
  const n = ds.rowCount;
  const selected = all ? all.length : n;
  const candidates = candidatesOf(profile, ds, target, opts.kinds);
  // Ranking pass: on an evenly spaced sample of the selected rows when there are many.
  let sample: Int32Array | null = all;
  if (selected > SAMPLE_ROWS) {
    const pick = systematicSample(selected, SAMPLE_ROWS);
    sample = all ? Int32Array.from(pick, (k) => all[k] as number) : pick;
  }
  const copies: CopyNote[] = [];
  // A date filled exactly where a yes/no outcome is yes records it (an exit date beside an exit status):
  // never a driver (dates aren't), but the dashboard needs to know it charts the outcome too.
  if (target.type === "binary")
    for (const c of profile.columns) {
      const col = columnByName(ds, c.name);
      if (col?.kind !== "date" || c.nullPct < 0.01 || c.name === target.column.name) continue;
      const v = col.values;
      const phi = phiOn((i) => (v[i] as number) === (v[i] as number), target.y, sample, n);
      if (Math.abs(phi) >= COPY_STRENGTH)
        copies.push({
          column: c.name,
          reason: `${friendly(c.name)} is filled only where ${target.label} is ${phi > 0 ? target.positive : `not ${target.positive}`}, so it records the outcome rather than moving it.`,
        });
    }
  const scored: Array<{ cand: Candidate; strength: number }> = [];
  for (const cand of candidates) {
    const copy = copyReason(cand, target, sample, n);
    if (copy) {
      copies.push({ column: cand.c.name, reason: copy });
      continue;
    }
    const s = strengthOf(cand, target, sample, n);
    if (Number.isFinite(s)) scored.push({ cand, strength: s });
  }
  scored.sort((a, b) => b.strength - a.strength);
  // Exact pass: the strongest columns (every one when nothing was sampled) on every selected row.
  const exact = sample === all ? scored : scored.slice(0, EXACT_TOP);
  const ranked: DriverDetail[] = [];
  for (const { cand } of exact) {
    if (sample !== all && copyReason(cand, target, all, n)) continue;
    const d = detailOf(cand, target, all, n, opts);
    if (d) ranked.push(d);
  }
  ranked.sort((a, b) => b.strength - a.strength);
  // The strongest gets "most" in its sentence, when its link is clear.
  if (ranked[0])
    ranked[0] = {
      ...ranked[0],
      sentence:
        ranked[0].strength >= CLEAR_LINK
          ? ranked[0].sentence.replace(" differs by ", " differs most by ")
          : ranked[0].sentence,
    };
  return { ranked, copies };
}

/** The reported drivers: strength MIN_STRENGTH or more, at most MAX_DRIVERS, as the contract has them. */
export function reportedDrivers(ranked: readonly DriverDetail[]): Driver[] {
  return ranked
    .filter((d) => d.strength >= MIN_STRENGTH)
    .slice(0, MAX_DRIVERS)
    .map(({ column, strength, direction, method, value, sentence }) => ({
      column,
      strength,
      direction,
      method,
      value,
      sentence,
    }));
}

/** Why a column is a copy of the outcome rather than something that moves it; null when it isn't one. */
function copyReason(
  cand: Candidate,
  t: OutcomeTarget,
  rows: ArrayLike<number> | null,
  n: number,
): string | null {
  const L = friendly(cand.c.name);
  const O = t.label;
  if (t.type === "binary") {
    // Filled, or non-zero, exactly where the outcome is yes: it records the outcome (an exit date, churned MRR).
    const col = cand.x;
    const codes = cand.groups?.codes;
    if (cand.c.nullPct >= 0.01) {
      const filled = col
        ? (i: number) => (col[i] as number) === (col[i] as number)
        : (i: number) => (codes?.[i] ?? -1) >= 0;
      const phi = phiOn(filled, t.y, rows, n);
      if (Math.abs(phi) >= COPY_STRENGTH)
        return `${L} is filled only where ${O} is ${phi > 0 ? t.positive : "not " + t.positive}, so it records the outcome rather than moving it.`;
    }
    if (col && (cand.c.numeric?.zeros ?? 0) > 0) {
      const phi = phiOn(
        (i) => (col[i] as number) !== 0 && (col[i] as number) === (col[i] as number),
        t.y,
        rows,
        n,
      );
      if (Math.abs(phi) >= COPY_STRENGTH)
        return `${L} is non-zero exactly where ${O} is ${phi > 0 ? t.positive : "not " + t.positive}, so it records the outcome rather than moving it.`;
    }
  }
  if (t.type === "class") {
    if (cand.groups && t.classes) {
      const { v } = cramerOn(cand.groups, t.classes, rows, n);
      if (v >= COPY_STRENGTH)
        return `${L} holds the same classes as ${O} (${vText(v)}), so it is left out of what moves it.`;
    }
    return null;
  }
  if (cand.x) {
    const { r } = pearsonOn(cand.x, t.y, rows, n);
    if (Math.abs(r) >= COPY_STRENGTH)
      return `${L} is a copy of ${O} (${rText(r)}), so it is left out of what moves it.`;
  } else if (cand.groups) {
    const { eta } = etaOn(cand.groups.codes, cand.groups.labels, t.y, rows, n);
    if (eta >= COPY_STRENGTH)
      return `${L} spells out ${O} (${etaText(eta)}), so it is left out of what moves it.`;
  }
  return null;
}

/** The ranking statistic alone (no facts): |r|, η or V; NaN when it can't be worked out. */
function strengthOf(cand: Candidate, t: OutcomeTarget, rows: ArrayLike<number> | null, n: number): number {
  if (t.type === "class") {
    if (!t.classes) return NaN;
    if (cand.x) return etaOn(t.classes.codes, t.classes.labels, cand.x, rows, n).eta;
    if (cand.groups) return cramerOn(cand.groups, t.classes, rows, n).v;
    return NaN;
  }
  if (cand.x) return Math.abs(pearsonOn(cand.x, t.y, rows, n).r);
  if (cand.groups) return etaOn(cand.groups.codes, cand.groups.labels, t.y, rows, n).eta;
  return NaN;
}

/** Monotone order of group means for numeric codes (Pclass 1, 2, 3): "up", "down" or "mixed". */
function orderOf(groups: readonly GroupStat[], numericCodes: boolean): Driver["direction"] {
  if (!numericCodes || groups.length < 2) return "mixed";
  const byValue = [...groups].sort((a, b) => Number(a.label) - Number(b.label));
  let up = true;
  let down = true;
  for (let i = 1; i < byValue.length; i++) {
    const d = (byValue[i] as GroupStat).mean - (byValue[i - 1] as GroupStat).mean;
    if (d < 0) up = false;
    if (d > 0) down = false;
  }
  return up && !down ? "up" : down && !up ? "down" : "mixed";
}

/** The driver with its exact statistic, sentence and facts over `rows`; null when it can't be worked out. */
function detailOf(
  cand: Candidate,
  t: OutcomeTarget,
  rows: Int32Array | null,
  n: number,
  opts: DriverOptions,
): DriverDetail | null {
  const locale = opts.locale ?? "INTL";
  const currency = opts.currency ?? "INR";
  const L = friendly(cand.c.name);
  const O = t.label;
  const noun = capitalise(t.noun);
  const each = opts.rowsWord ?? "rows";
  const fig = figureOf(cand.c, locale, currency);
  const outFig = figureOf(t.column, locale, currency);
  const base = { column: cand.c.name, as: cand.as } as const;

  if (t.type === "class") {
    const cls = t.classes;
    if (!cls) return null;
    if (cand.x) {
      const { eta, n: m, groups } = etaOn(cls.codes, cls.labels, cand.x, rows, n);
      if (!Number.isFinite(eta)) return null;
      const sorted = [...groups].sort((a, b) => b.mean - a.mean);
      const hi = sorted[0] as GroupStat;
      const lo = sorted[sorted.length - 1] as GroupStat;
      return {
        ...base,
        strength: eta,
        direction: "mixed",
        method: "group-means",
        value: eta,
        n: m,
        facts: { kind: "classes", groups: sorted },
        sentence: `${capitalise(L)} averages ${fig(hi.mean)} for ${hi.label}, against ${fig(lo.mean)} for ${lo.label} (${etaText(eta)}).`,
      };
    }
    if (!cand.groups) return null;
    const { v, n: m, mix } = cramerOn(cand.groups, cls, rows, n);
    if (!Number.isFinite(v) || !mix) return null;
    return {
      ...base,
      strength: v,
      direction: "mixed",
      method: "association",
      value: v,
      n: m,
      facts: { kind: "mix", cls: mix.cls, hi: mix.hi, lo: mix.lo },
      sentence: `The ${O} mix differs by ${L} (${vText(v)}): ${mix.cls} makes up ${pct(mix.hi.share, locale)} of ${mix.hi.label} rows, against ${pct(mix.lo.share, locale)} of ${mix.lo.label} rows.`,
    };
  }

  if (cand.x) {
    const x = cand.x;
    const { r, n: m } = pearsonOn(x, t.y, rows, n);
    if (!Number.isFinite(r)) return null;
    const direction: Driver["direction"] = r > 0 ? "up" : r < 0 ? "down" : "mixed";
    const common = {
      ...base,
      strength: Math.abs(r),
      direction,
      method: "correlation" as const,
      value: r,
      n: m,
    };
    if (t.type === "amount") {
      const { top, bottom } = quartersOf(x, t.y, rows, n);
      if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
      return {
        ...common,
        facts: { kind: "quarters", top, bottom },
        sentence: `${noun} ${r >= 0 ? "rises" : "falls"} with ${L} (${rText(r)}): the top quarter by ${L} averages ${outFig(top)}, against ${outFig(bottom)} for the bottom quarter.`,
      };
    }
    // Yes/no and scored outcomes: the column's average in the yes (or top-of-scale) rows against the rest.
    const inTop = t.type === "binary" ? (v: number) => v === 1 : (v: number) => v >= t.bar;
    let hs = 0;
    let hn = 0;
    let ls = 0;
    let ln = 0;
    const len = rows ? rows.length : n;
    for (let k = 0; k < len; k++) {
      const i = rows ? (rows[k] as number) : k;
      const a = x[i] as number;
      const b = t.y[i] as number;
      if (a !== a || b !== b) continue;
      if (inTop(b)) {
        hs += a;
        hn++;
      } else {
        ls += a;
        ln++;
      }
    }
    if (!hn || !ln) return null;
    const high = hs / hn;
    const low = ls / ln;
    const who =
      t.type === "binary"
        ? t.verb
          ? `${capitalise(each)} who ${t.verb}`
          : `${capitalise(each)} with ${O} = ${t.positive}`
        : `${capitalise(each)} rated ${formatPlain(t.bar, 0, locale)} or above on ${O}`;
    return {
      ...common,
      facts: { kind: "split", high, low },
      sentence: `${who} average ${fig(high)} ${L}, against ${fig(low)} for the rest (${rText(r)}).`,
    };
  }

  if (!cand.groups) return null;
  const { eta, n: m, groups } = etaOn(cand.groups.codes, cand.groups.labels, t.y, rows, n);
  if (!Number.isFinite(eta)) return null;
  const sorted = [...groups].sort((a, b) => b.mean - a.mean);
  const hi = sorted[0] as GroupStat;
  const lo = sorted[sorted.length - 1] as GroupStat;
  const direction = orderOf(groups, cand.c.storage === "number");
  const common = { ...base, strength: eta, direction, method: "group-means" as const, value: eta, n: m };
  if (t.type === "binary") {
    const sentence =
      sorted.length === 2
        ? `${noun} differs by ${L}: ${hi.label} ${pct(hi.mean, locale)}, ${lo.label} ${pct(lo.mean, locale)}.`
        : `${noun} is highest where ${L} is ${hi.label} (${pct(hi.mean, locale)}) and lowest where it is ${lo.label} (${pct(lo.mean, locale)}).`;
    return { ...common, facts: { kind: "groups", groups: sorted }, sentence };
  }
  return {
    ...common,
    facts: { kind: "groups", groups: sorted },
    sentence: `${noun} averages ${outFig(hi.mean)} where ${L} is ${hi.label}, against ${outFig(lo.mean)} where it is ${lo.label} (${etaText(eta)}).`,
  };
}

/**
 * The outcome's average over the rows in the top quarter of `x` (x at or
 * above its third quartile) and the bottom quarter (at or below the first),
 * over the rows with both values. Quartiles interpolate (R type 7), like
 * the profile's.
 */
function quartersOf(
  x: Float64Array,
  y: Float64Array,
  rows: ArrayLike<number> | null,
  n: number,
): { top: number; bottom: number } {
  const xs: number[] = [];
  const len = rows ? rows.length : n;
  for (let k = 0; k < len; k++) {
    const i = rows ? (rows[k] as number) : k;
    const a = x[i] as number;
    const b = y[i] as number;
    if (a === a && b === b) xs.push(a);
  }
  if (xs.length < 8) return { top: NaN, bottom: NaN };
  xs.sort((a, b) => a - b);
  const q = (p: number) => {
    const h = (xs.length - 1) * p;
    const lo = Math.floor(h);
    return (
      (xs[lo] as number) + (h - lo) * ((xs[Math.min(lo + 1, xs.length - 1)] as number) - (xs[lo] as number))
    );
  };
  const q1 = q(0.25);
  const q3 = q(0.75);
  let ts = 0;
  let tn = 0;
  let bs = 0;
  let bn = 0;
  for (let k = 0; k < len; k++) {
    const i = rows ? (rows[k] as number) : k;
    const a = x[i] as number;
    const b = y[i] as number;
    if (a !== a || b !== b) continue;
    if (a >= q3) {
      ts += b;
      tn++;
    }
    if (a <= q1) {
      bs += b;
      bn++;
    }
  }
  return { top: tn ? ts / tn : NaN, bottom: bn ? bs / bn : NaN };
}

// ---------------------------------------------------------------- relations

/**
 * Pairs of measures (not the outcome) that move together closely: |r| of
 * 0.5 or more, strongest first, at most five. The first twelve measures are
 * compared; above SAMPLE_ROWS rows on a sample, then the pairs kept are
 * worked out again on every row. The same figure twice (|r| above 0.9995)
 * says nothing and is passed over.
 */
export function relationsOf(ds: Dataset, measures: readonly ColumnProfile[]): Relation[] {
  const n = ds.rowCount;
  const sample = n > SAMPLE_ROWS ? systematicSample(n, SAMPLE_ROWS) : null;
  const series = measures.slice(0, 12).flatMap((c) => {
    const x = numbersOf(columnByName(ds, c.name));
    return x ? [{ c, x }] : [];
  });
  const found: Array<{ a: (typeof series)[number]; b: (typeof series)[number]; r: number }> = [];
  for (let i = 0; i < series.length; i++)
    for (let j = i + 1; j < series.length; j++) {
      const a = series[i] as (typeof series)[number];
      const b = series[j] as (typeof series)[number];
      const { r } = pearsonOn(a.x, b.x, sample, n);
      if (Number.isFinite(r) && Math.abs(r) >= 0.5 && Math.abs(r) <= 0.9995) found.push({ a, b, r });
    }
  found.sort((p, q) => Math.abs(q.r) - Math.abs(p.r));
  return found
    .slice(0, 5)
    .map(({ a, b, r }) => ({ a: a.c.name, b: b.c.name, r: sample ? pearsonOn(a.x, b.x, null, n).r : r }))
    .filter((x) => Math.abs(x.r) >= 0.5 && Math.abs(x.r) <= 0.9995)
    .sort((p, q) => Math.abs(q.r) - Math.abs(p.r));
}
