/**
 * Grouped expression evaluator over the columnar dataset.
 *
 * Semantics deliberately mirror the generated SQL and DAX:
 *  - SUM of no values is 0 (COALESCE), AVG/MIN/MAX of no values is blank (NaN)
 *  - division by zero or blank is blank (NULLIF / DIVIDE)
 *  - COUNT DISTINCT ignores blanks (COUNT(DISTINCT) / DISTINCTCOUNTNOBLANK)
 *  - `calc` intersects with the current context (KEEPFILTERS)
 *  - `newEntities` uses each entity's first date ignoring only date filters
 *
 * Shape: `evaluate` returns one value per group (Float64Array, NaN = blank).
 * `rows` holds the row indices in context and `groupOf[i]` is the group of
 * `rows[i]` (null = a single group). The `cache` memoises KPI refs by id, so
 * it is only valid for one rows/groupOf pair: every node that changes the row
 * set (calc, per, atLatest) evaluates its child with a fresh Map.
 * Predicates and row expressions compile once into closures over the typed
 * arrays; string tests become a lookup table indexed by dictionary code.
 * `x !== x` is the NaN (blank) test used throughout the hot loops.
 */
import type { Column } from "@/engine/core/types";
import { DAY_MS } from "@/engine/core/dates";
import { parseBooleanToken } from "@/engine/parse/values";
import { compare, type Expr, type FieldRef, type Predicate, type Reduce, type RowExpr } from "./expr";

/** Thrown by a Resolver when a FieldRef has no mapped column (or the column is gone). */
export class MissingFieldError extends Error {
  constructor(public readonly field: string) {
    super(`Field "${field}" is not mapped to a column.`);
  }
}

/** Thrown by a Resolver when a `ref` points at a KPI that did not resolve for this data. */
export class UnavailableKpiError extends Error {
  constructor(public readonly kpi: string) {
    super(`KPI "${kpi}" is not available for this data.`);
  }
}

/** Session lookups the evaluator needs; built by kpi/context.ts makeResolver. */
export interface Resolver {
  /** Column behind a FieldRef; throws MissingFieldError when unmapped. */
  column(ref: FieldRef): Column;
  /** Raw column values assigned to a value class ([] when none matched). */
  classValues(ref: FieldRef, cls: string): readonly string[];
  /** Expression for a KPI or ad-hoc measure id; throws UnavailableKpiError. */
  kpi(id: string): Expr;
}

/** `res.kpi(id)` that returns undefined instead of throwing; for lookups such as isAdditiveExpr. */
export function kpiOrUndefined(res: Resolver, id: string): Expr | undefined {
  try {
    return res.kpi(id);
  } catch {
    return undefined;
  }
}

/**
 * Period context used only by newEntities (the first-date logic). Other
 * nodes ignore it; EMPTY_SCOPE means no date filter, so every entity counts.
 */
export interface Scope {
  /**
   * Rows passing every filter except date-range filters (first-date context).
   * null = no date filter, so first dates come from the rows being evaluated.
   */
  rowsIgnoringDate: Int32Array | null;
  /** Main-grouping group id for each row in rowsIgnoringDate (-1 when outside), for dimension breakdowns. */
  ignoringDateGroups: Int32Array | null;
  /** Start of the evaluated period; -Infinity when unbounded. */
  periodStart: number;
  /**
   * Per-group period starts when grouping by time.
   * Each bucket's start, clipped to the date filter's start; when set it
   * takes precedence over periodStart.
   */
  periodStartByGroup: Float64Array | null;
}

/** No date filter: no first-date context and an unbounded period. */
export const EMPTY_SCOPE: Scope = {
  rowsIgnoringDate: null,
  ignoringDateGroups: null,
  periodStart: -Infinity,
  periodStartByGroup: null,
};

type Cache = Map<string, Float64Array>;
type RowTest = (r: number) => boolean;
type RowGet = (r: number) => number;

// ---------------------------------------------------------------- entity codes

const entityCache = new WeakMap<Column, { codes: Int32Array; card: number }>();

/**
 * Dense non-negative codes per row for any column (-1 = blank).
 * `card` is the code range: the dictionary size for strings (values absent
 * from the current rows included), 2 for booleans, the distinct count for
 * numbers and dates. Cached per Column object, so repeated distinct counts
 * and per-entity passes encode a column once.
 */
export function entityCodes(col: Column): { codes: Int32Array; card: number } {
  const hit = entityCache.get(col);
  if (hit) return hit;
  let res: { codes: Int32Array; card: number };
  if (col.kind === "string") res = { codes: col.codes, card: col.dict.length };
  else if (col.kind === "boolean") {
    const codes = new Int32Array(col.values.length);
    for (let i = 0; i < codes.length; i++) {
      const v = col.values[i] as number;
      codes[i] = v < 0 ? -1 : v;
    }
    res = { codes, card: 2 };
  } else {
    const map = new Map<number, number>();
    const codes = new Int32Array(col.values.length);
    for (let i = 0; i < codes.length; i++) {
      const v = col.values[i] as number;
      if (v !== v) {
        codes[i] = -1;
        continue;
      }
      let c = map.get(v);
      if (c === undefined) {
        c = map.size;
        map.set(v, c);
      }
      codes[i] = c;
    }
    res = { codes, card: map.size };
  }
  entityCache.set(col, res);
  return res;
}

// ---------------------------------------------------------------- predicates

function isNullAt(col: Column): RowTest {
  if (col.kind === "string") {
    const c = col.codes;
    return (r) => (c[r] as number) < 0;
  }
  if (col.kind === "boolean") {
    const v = col.values;
    return (r) => (v[r] as number) < 0;
  }
  const v = col.values;
  return (r) => (v[r] as number) !== (v[r] as number);
}

/**
 * Row test behind `in`, `class` and (with `negate`) `notClass`. Text matches
 * exactly, case and spaces included, like SQL IN: class values are the
 * column's own distinct values (detect/mapping.ts), so "Delivered" and
 * "delivered" are different values (DAX alone ignores case). Boolean columns
 * match their true/false labels or "true"/"false" ignoring case, as SQL
 * compares a BOOLEAN column with a text literal by casting it, which ignores
 * case too. With `negate`, blank rows pass, mirroring SQL's `IS NULL OR NOT IN`.
 */
function membership(col: Column, values: readonly string[], negate: boolean): RowTest {
  if (col.kind === "string") {
    // Resolve the test once per dictionary entry; the row loop is then a table lookup.
    const wanted = new Set(values);
    const match = new Uint8Array(col.dict.length);
    col.dict.forEach((d, i) => {
      if (wanted.has(d)) match[i] = 1;
    });
    const codes = col.codes;
    if (negate)
      return (r) => {
        const c = codes[r] as number;
        return c < 0 || match[c] === 0;
      };
    return (r) => {
      const c = codes[r] as number;
      return c >= 0 && match[c] === 1;
    };
  }
  if (col.kind === "boolean") {
    const loose = new Set(values.map((v) => v.trim().toLowerCase()));
    const t = loose.has(col.trueLabel.toLowerCase()) || loose.has("true");
    const f = loose.has(col.falseLabel.toLowerCase()) || loose.has("false");
    const v = col.values;
    return (r) => {
      const x = v[r] as number;
      const hit = x === 1 ? t : x === 0 ? f : false;
      return negate ? x < 0 || !hit : hit;
    };
  }
  const nums = new Set(values.map(Number).filter((x) => Number.isFinite(x)));
  const v = col.values;
  return (r) => {
    const x = v[r] as number;
    const hit = x === x && nums.has(x);
    return negate ? !hit : hit;
  };
}

/**
 * isTrue/isFalse: boolean and number columns compare with 1/0; text uses the
 * same token lists as the SQL and DAX compilers; date columns never match.
 */
function truthTest(col: Column, want: 0 | 1): RowTest {
  if (col.kind === "boolean" || col.kind === "number") {
    const v = col.values;
    return (r) => (v[r] as number) === want;
  }
  if (col.kind === "string") {
    const tv = new Int8Array(col.dict.length);
    col.dict.forEach((d, i) => {
      const t = d.trim().toLowerCase();
      const b = t === "1" ? true : t === "0" ? false : parseBooleanToken(t);
      tv[i] = b === null ? -1 : b ? 1 : 0;
    });
    const codes = col.codes;
    return (r) => {
      const c = codes[r] as number;
      return c >= 0 && tv[c] === want;
    };
  }
  return () => false;
}

/** Raw values of a number or date column; throws for text and boolean columns. */
function numericValues(col: Column, ref: string): Float64Array {
  if (col.kind === "number" || col.kind === "date") return col.values;
  throw new Error(`"${col.name}" (${ref}) is not numeric.`);
}

/** Compiles a predicate into a row test (row index → passes). Blank cells fail every positive test. */
export function compilePredicate(p: Predicate, res: Resolver): RowTest {
  if ("and" in p) {
    const fs = p.and.map((x) => compilePredicate(x, res));
    return (r) => {
      for (const f of fs) if (!f(r)) return false;
      return true;
    };
  }
  if ("or" in p) {
    const fs = p.or.map((x) => compilePredicate(x, res));
    return (r) => {
      for (const f of fs) if (f(r)) return true;
      return false;
    };
  }
  if ("not" in p) {
    const f = compilePredicate(p.not, res);
    // Two-valued: a blank row that fails the inner test passes here. SQL
    // matches with NOT COALESCE((…), FALSE) and DAX's NOT is two-valued already.
    return (r) => !f(r);
  }
  const col = res.column(p.field);
  if ("in" in p) return membership(col, p.in, false);
  if ("class" in p) return membership(col, res.classValues(p.field, p.class), false);
  if ("notClass" in p) return membership(col, res.classValues(p.field, p.notClass), true);
  if ("isTrue" in p) return truthTest(col, 1);
  if ("isFalse" in p) return truthTest(col, 0);
  if ("cmp" in p) {
    const v = numericValues(col, p.field);
    const cmp = p.cmp;
    const value = p.value;
    return (r) => {
      const x = v[r] as number;
      return x === x && compare(x, cmp, value);
    };
  }
  if ("cmpField" in p) {
    const a = numericValues(col, p.field);
    const b = numericValues(res.column(p.other), p.other);
    const cmp = p.cmpField;
    return (r) => {
      const x = a[r] as number;
      const y = b[r] as number;
      return x === x && y === y && compare(x, cmp, y);
    };
  }
  if ("notNull" in p) {
    const isNull = isNullAt(col);
    return (r) => !isNull(r);
  }
  return isNullAt(col);
}

// ---------------------------------------------------------------- row expressions

/** Compiles a row expression into a getter (row index → value, NaN = blank). */
export function compileRowExpr(e: RowExpr, res: Resolver): RowGet {
  if ("num" in e) {
    const n = e.num;
    return () => n;
  }
  if ("field" in e) {
    const col = res.column(e.field);
    if (col.kind === "number" || col.kind === "date") {
      const v = col.values;
      return (r) => v[r] as number;
    }
    if (col.kind === "boolean") {
      const v = col.values;
      return (r) => {
        const x = v[r] as number;
        return x < 0 ? NaN : x;
      };
    }
    throw new Error(`"${col.name}" holds text, so it can't be used in a calculation.`);
  }
  if ("daysBetween" in e) {
    const a = numericValues(res.column(e.daysBetween[0]), e.daysBetween[0]);
    const b = numericValues(res.column(e.daysBetween[1]), e.daysBetween[1]);
    return (r) => {
      const x = a[r] as number;
      const y = b[r] as number;
      if (x !== x || y !== y) return NaN;
      return Math.floor(y / DAY_MS) - Math.floor(x / DAY_MS);
    };
  }
  const fa = compileRowExpr(e.args[0], res);
  const fb = compileRowExpr(e.args[1], res);
  switch (e.op) {
    case "add":
      return (r) => fa(r) + fb(r);
    case "sub":
      return (r) => fa(r) - fb(r);
    case "mul":
      return (r) => fa(r) * fb(r);
    case "div":
      return (r) => {
        const d = fb(r);
        return d === 0 ? NaN : fa(r) / d;
      };
  }
}

// ---------------------------------------------------------------- evaluation

const gOf = (groupOf: Int32Array | null, i: number): number => (groupOf ? (groupOf[i] as number) : 0);

/** One pass over the rows into G slots. An empty group gives 0 for sum, count and countDistinct, NaN otherwise. */
function evalAgg(
  e: Extract<Expr, { agg: string }>,
  res: Resolver,
  rows: Int32Array,
  groupOf: Int32Array | null,
  G: number,
): Float64Array {
  const n = rows.length;
  const pred = e.where ? compilePredicate(e.where, res) : null;
  const out = new Float64Array(G);
  switch (e.agg) {
    case "count": {
      for (let i = 0; i < n; i++) {
        if (pred && !pred(rows[i] as number)) continue;
        out[gOf(groupOf, i)]++;
      }
      return out;
    }
    case "sum": {
      // Fast path: plain numeric column.
      if ("field" in e.of) {
        const col = res.column(e.of.field);
        if (col.kind === "number") {
          const v = col.values;
          for (let i = 0; i < n; i++) {
            const r = rows[i] as number;
            if (pred && !pred(r)) continue;
            const x = v[r] as number;
            if (x === x) out[gOf(groupOf, i)] += x;
          }
          return out;
        }
      }
      const get = compileRowExpr(e.of, res);
      for (let i = 0; i < n; i++) {
        const r = rows[i] as number;
        if (pred && !pred(r)) continue;
        const x = get(r);
        if (x === x) out[gOf(groupOf, i)] += x;
      }
      return out;
    }
    case "avg": {
      const get = compileRowExpr(e.of, res);
      const cnt = new Float64Array(G);
      for (let i = 0; i < n; i++) {
        const r = rows[i] as number;
        if (pred && !pred(r)) continue;
        const x = get(r);
        if (x !== x) continue;
        const g = gOf(groupOf, i);
        out[g] += x;
        cnt[g]++;
      }
      for (let g = 0; g < G; g++)
        out[g] = (cnt[g] as number) > 0 ? (out[g] as number) / (cnt[g] as number) : NaN;
      return out;
    }
    case "min":
    case "max": {
      const get = compileRowExpr(e.of, res);
      out.fill(NaN);
      const isMin = e.agg === "min";
      for (let i = 0; i < n; i++) {
        const r = rows[i] as number;
        if (pred && !pred(r)) continue;
        const x = get(r);
        if (x !== x) continue;
        const g = gOf(groupOf, i);
        const cur = out[g] as number;
        if (cur !== cur || (isMin ? x < cur : x > cur)) out[g] = x;
      }
      return out;
    }
    case "median": {
      const get = compileRowExpr(e.of, res);
      const buckets: number[][] = Array.from({ length: G }, () => []);
      for (let i = 0; i < n; i++) {
        const r = rows[i] as number;
        if (pred && !pred(r)) continue;
        const x = get(r);
        if (x === x) (buckets[gOf(groupOf, i)] as number[]).push(x);
      }
      for (let g = 0; g < G; g++) out[g] = medianOf(buckets[g] as number[]);
      return out;
    }
    case "countDistinct": {
      // Blank codes (< 0) are never counted (COUNT(DISTINCT) / DISTINCTCOUNTNOBLANK).
      // Dedup strategy by size: one bitmap over the codes for a single group,
      // a (group × code) bitmap while it fits in 16 MB, else a Set of
      // composite keys g * card + code.
      const { codes, card } = entityCodes(res.column(e.of));
      if (G === 1) {
        const seen = new Uint8Array(card);
        let c = 0;
        for (let i = 0; i < n; i++) {
          const r = rows[i] as number;
          if (pred && !pred(r)) continue;
          const k = codes[r] as number;
          if (k < 0 || seen[k]) continue;
          seen[k] = 1;
          c++;
        }
        out[0] = c;
        return out;
      }
      if (card * G <= 16_000_000) {
        const seen = new Uint8Array(card * G);
        for (let i = 0; i < n; i++) {
          const r = rows[i] as number;
          if (pred && !pred(r)) continue;
          const k = codes[r] as number;
          if (k < 0) continue;
          const g = gOf(groupOf, i);
          const key = g * card + k;
          if (!seen[key]) {
            seen[key] = 1;
            out[g]++;
          }
        }
        return out;
      }
      const seen = new Set<number>();
      for (let i = 0; i < n; i++) {
        const r = rows[i] as number;
        if (pred && !pred(r)) continue;
        const k = codes[r] as number;
        if (k < 0) continue;
        const g = gOf(groupOf, i);
        const key = g * card + k;
        if (!seen.has(key)) {
          seen.add(key);
          out[g]++;
        }
      }
      return out;
    }
    case "spanDays": {
      const v = numericValues(res.column(e.of), e.of);
      const mins = new Float64Array(G).fill(Infinity);
      const maxs = new Float64Array(G).fill(-Infinity);
      for (let i = 0; i < n; i++) {
        const r = rows[i] as number;
        if (pred && !pred(r)) continue;
        const x = v[r] as number;
        if (x !== x) continue;
        const g = gOf(groupOf, i);
        if (x < (mins[g] as number)) mins[g] = x;
        if (x > (maxs[g] as number)) maxs[g] = x;
      }
      for (let g = 0; g < G; g++) {
        const a = mins[g] as number;
        const b = maxs[g] as number;
        // Midnights crossed, like CAST(MAX AS DATE) - CAST(MIN AS DATE) in SQL and DAX DATEDIFF ... DAY.
        out[g] = a === Infinity ? NaN : Math.floor(b / DAY_MS) - Math.floor(a / DAY_MS);
      }
      return out;
    }
  }
}

/** Median with the two middle values averaged (PERCENTILE_CONT(0.5)); sorts `values` in place; NaN when empty. */
function medianOf(values: number[]): number {
  if (values.length === 0) return NaN;
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2
    ? (values[mid] as number)
    : ((values[mid - 1] as number) + (values[mid] as number)) / 2;
}

/** Keeps the rows passing `test`, carrying each kept row's group id along. */
function filterBy(
  rows: Int32Array,
  groupOf: Int32Array | null,
  test: RowTest,
): { rows: Int32Array; groupOf: Int32Array | null } {
  const n = rows.length;
  const r2 = new Int32Array(n);
  const g2 = groupOf ? new Int32Array(n) : null;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const r = rows[i] as number;
    if (!test(r)) continue;
    r2[k] = r;
    if (g2 && groupOf) g2[k] = groupOf[i] as number;
    k++;
  }
  return { rows: r2.subarray(0, k), groupOf: g2 ? g2.subarray(0, k) : null };
}

/**
 * Folds per-composite values (one composite = one entity within one group)
 * into G group values. `keep` is the `having` mask; NaN values are skipped,
 * except that `count` counts every kept composite.
 */
function reduceComposites(
  reduce: Reduce,
  values: Float64Array,
  keep: Uint8Array | null,
  compGroup: Int32Array,
  G: number,
): Float64Array {
  const out = new Float64Array(G);
  const C = values.length;
  if (reduce === "sum" || reduce === "count") {
    for (let c = 0; c < C; c++) {
      if (keep && !keep[c]) continue;
      const g = compGroup[c] as number;
      if (reduce === "count") out[g]++;
      else {
        const v = values[c] as number;
        if (v === v) out[g] += v;
      }
    }
    return out;
  }
  if (reduce === "avg") {
    const cnt = new Float64Array(G);
    for (let c = 0; c < C; c++) {
      if (keep && !keep[c]) continue;
      const v = values[c] as number;
      if (v !== v) continue;
      const g = compGroup[c] as number;
      out[g] += v;
      cnt[g]++;
    }
    for (let g = 0; g < G; g++)
      out[g] = (cnt[g] as number) > 0 ? (out[g] as number) / (cnt[g] as number) : NaN;
    return out;
  }
  const buckets: number[][] = Array.from({ length: G }, () => []);
  for (let c = 0; c < C; c++) {
    if (keep && !keep[c]) continue;
    const v = values[c] as number;
    if (v === v) (buckets[compGroup[c] as number] as number[]).push(v);
  }
  for (let g = 0; g < G; g++) {
    const b = buckets[g] as number[];
    if (reduce === "median") out[g] = medianOf(b);
    else if (b.length === 0) out[g] = NaN;
    else {
      // A loop, not Math.min(...b): spreading ~150k+ values (one per entity)
      // overflows the call stack with a RangeError.
      const isMin = reduce === "min";
      let m = b[0] as number;
      for (let i = 1; i < b.length; i++) {
        const v = b[i] as number;
        if (isMin ? v < m : v > m) m = v;
      }
      out[g] = m;
    }
  }
  return out;
}

/**
 * `per` node. Every row with a non-blank entity joins a composite (group,
 * entity); `inner` and `having.expr` are evaluated once with the composites
 * as the groups of a nested evaluation, then reduceComposites folds them back
 * into G values.
 */
function evalPer(
  e: Extract<Expr, { per: string }>,
  res: Resolver,
  scope: Scope,
  rows: Int32Array,
  groupOf: Int32Array | null,
  G: number,
): Float64Array {
  const { codes, card } = entityCodes(res.column(e.per));
  const n = rows.length;
  const index = new Map<number, number>();
  const compGroupList: number[] = [];
  const subRows = new Int32Array(n);
  const subGroup = new Int32Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const r = rows[i] as number;
    const k = codes[r] as number;
    if (k < 0) continue;
    const g = gOf(groupOf, i);
    const key = g * card + k;
    let c = index.get(key);
    if (c === undefined) {
      c = compGroupList.length;
      index.set(key, c);
      compGroupList.push(g);
    }
    subRows[m] = r;
    subGroup[m] = c;
    m++;
  }
  const compGroup = Int32Array.from(compGroupList);
  const C = compGroup.length;
  const sr = subRows.subarray(0, m);
  const sg = subGroup.subarray(0, m);
  // Each composite inherits its parent group's period start. The ignoring-date
  // rows are not carried over, so a newEntities nested in `per` takes first
  // dates from the current rows only.
  const innerScope: Scope = {
    rowsIgnoringDate: null,
    ignoringDateGroups: null,
    periodStart: scope.periodStart,
    periodStartByGroup: scope.periodStartByGroup
      ? Float64Array.from(compGroup, (g) => scope.periodStartByGroup?.[g] ?? -Infinity)
      : null,
  };
  const inner =
    e.reduce === "count" ? new Float64Array(C) : evaluate(e.inner, res, innerScope, sr, sg, C, new Map());
  let keep: Uint8Array | null = null;
  if (e.having) {
    const hv = evaluate(e.having.expr, res, innerScope, sr, sg, C, new Map());
    keep = new Uint8Array(C);
    for (let c = 0; c < C; c++) {
      const v = hv[c] as number;
      keep[c] = v === v && compare(v, e.having.cmp, e.having.value) ? 1 : 0;
    }
  }
  return reduceComposites(e.reduce, inner, keep, compGroup, G);
}

/**
 * `newEntities` node. First dates come from the ignoring-date rows (kept per
 * dimension group when ignoringDateGroups is set, so "new customers by channel"
 * means first order in that channel); each distinct (group, entity) in `rows`
 * then counts when its first date is on or after the group's period start.
 * Mirrors the SQL first_seen CTE and the SQLBI new-customer DAX pattern.
 */
function evalNewEntities(
  e: Extract<Expr, { newEntities: string }>,
  res: Resolver,
  scope: Scope,
  rows: Int32Array,
  groupOf: Int32Array | null,
  G: number,
): Float64Array {
  const { codes, card } = entityCodes(res.column(e.newEntities));
  const dates = numericValues(res.column(e.date), e.date);
  const base = scope.rowsIgnoringDate ?? rows;
  const byGroup = scope.ignoringDateGroups && scope.rowsIgnoringDate ? scope.ignoringDateGroups : null;
  const slots = byGroup ? G : 1;
  const first = new Float64Array(slots * card).fill(Infinity);
  for (let i = 0; i < base.length; i++) {
    const r = base[i] as number;
    const k = codes[r] as number;
    if (k < 0) continue;
    const d = dates[r] as number;
    if (d !== d) continue;
    const s = byGroup ? (byGroup[i] as number) : 0;
    if (s < 0) continue;
    const idx = s * card + k;
    if (d < (first[idx] as number)) first[idx] = d;
  }
  const out = new Float64Array(G);
  const seen = card * G <= 16_000_000 ? new Uint8Array(card * G) : null;
  const seenSet = seen ? null : new Set<number>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as number;
    const k = codes[r] as number;
    if (k < 0) continue;
    const g = gOf(groupOf, i);
    const key = g * card + k;
    if (seen) {
      if (seen[key]) continue;
      seen[key] = 1;
    } else if (seenSet) {
      if (seenSet.has(key)) continue;
      seenSet.add(key);
    }
    const start = scope.periodStartByGroup ? (scope.periodStartByGroup[g] as number) : scope.periodStart;
    // An entity with no dated row in the base keeps first = Infinity, so it counts as new.
    const f = first[(byGroup ? g : 0) * card + k] as number;
    if (f >= start) out[g]++;
  }
  return out;
}

/**
 * `atLatest` node: per group, keeps the rows dated on the group's latest
 * non-blank date (ties included) and evaluates `expr` on them. A group with
 * no dated row keeps no rows, so a sum there is 0.
 */
function evalAtLatest(
  e: Extract<Expr, { atLatest: string }>,
  res: Resolver,
  scope: Scope,
  rows: Int32Array,
  groupOf: Int32Array | null,
  G: number,
  cache: Cache,
): Float64Array {
  const dates = numericValues(res.column(e.atLatest), e.atLatest);
  const latest = new Float64Array(G).fill(-Infinity);
  for (let i = 0; i < rows.length; i++) {
    const d = dates[rows[i] as number] as number;
    if (d !== d) continue;
    const g = gOf(groupOf, i);
    if (d > (latest[g] as number)) latest[g] = d;
  }
  const n = rows.length;
  const r2 = new Int32Array(n);
  const g2 = groupOf ? new Int32Array(n) : null;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const r = rows[i] as number;
    const g = gOf(groupOf, i);
    if ((dates[r] as number) !== (latest[g] as number)) continue;
    r2[k] = r;
    if (g2) g2[k] = g;
    k++;
  }
  // The parent's cache belongs to the parent's rows; the child gets a fresh one.
  void cache;
  return evaluate(
    e.expr,
    res,
    { ...scope, rowsIgnoringDate: null, ignoringDateGroups: null },
    r2.subarray(0, k),
    g2 ? g2.subarray(0, k) : null,
    G,
    new Map(),
  );
}

/**
 * Evaluates an expression for G groups. `groupOf[i]` is the group of `rows[i]` (null = one group).
 * Share `cache` only between calls over the same rows and groupOf: it memoises KPI refs by id.
 */
export function evaluate(
  e: Expr,
  res: Resolver,
  scope: Scope,
  rows: Int32Array,
  groupOf: Int32Array | null,
  G: number,
  cache: Cache = new Map(),
): Float64Array {
  if ("num" in e) return new Float64Array(G).fill(e.num);
  if ("ref" in e) {
    const hit = cache.get(e.ref);
    if (hit) return hit;
    const v = evaluate(res.kpi(e.ref), res, scope, rows, groupOf, G, cache);
    cache.set(e.ref, v);
    return v;
  }
  if ("op" in e) {
    const a = evaluate(e.args[0], res, scope, rows, groupOf, G, cache);
    const b = evaluate(e.args[1], res, scope, rows, groupOf, G, cache);
    const out = new Float64Array(G);
    for (let g = 0; g < G; g++) {
      const x = a[g] as number;
      const y = b[g] as number;
      switch (e.op) {
        case "add":
          out[g] = x + y;
          break;
        case "sub":
          out[g] = x - y;
          break;
        case "mul":
          out[g] = x * y;
          break;
        case "div":
          // Safe divide (SQL NULLIF, DAX DIVIDE): blank for a zero or blank denominator or a blank numerator.
          out[g] = y === 0 || y !== y || x !== x ? NaN : x / y;
          break;
      }
    }
    return out;
  }
  if ("agg" in e) return evalAgg(e, res, rows, groupOf, G);
  if ("calc" in e) {
    // KEEPFILTERS semantics: narrow the rows already in context instead of
    // re-selecting from the table. The ignoring-date rows are narrowed too, so
    // first dates inside honour the condition; refs inside see fewer rows,
    // hence the fresh cache below.
    const test = compilePredicate(e.where, res);
    const f = filterBy(rows, groupOf, test);
    let innerScope = scope;
    if (scope.rowsIgnoringDate) {
      const base = scope.rowsIgnoringDate;
      const groups = scope.ignoringDateGroups;
      const keepRows: number[] = [];
      const keepGroups: number[] = [];
      for (let i = 0; i < base.length; i++) {
        const r = base[i] as number;
        if (!test(r)) continue;
        keepRows.push(r);
        if (groups) keepGroups.push(groups[i] as number);
      }
      innerScope = {
        ...scope,
        rowsIgnoringDate: Int32Array.from(keepRows),
        ignoringDateGroups: groups ? Int32Array.from(keepGroups) : null,
      };
    }
    return evaluate(e.calc, res, innerScope, f.rows, f.groupOf, G, new Map());
  }
  if ("per" in e) return evalPer(e, res, scope, rows, groupOf, G);
  if ("newEntities" in e) return evalNewEntities(e, res, scope, rows, groupOf, G);
  return evalAtLatest(e, res, scope, rows, groupOf, G, cache);
}

/** Scalar convenience wrapper. */
export function evaluateScalar(e: Expr, res: Resolver, scope: Scope, rows: Int32Array): number {
  return evaluate(e, res, scope, rows, null, 1)[0] as number;
}
