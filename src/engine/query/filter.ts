/**
 * Global/cross filters (column-level) and row selection.
 *
 * Filters address raw column names (not domain field ids) and are ANDed. A
 * filter on a missing column, or of the wrong kind for its column, is ignored
 * rather than emptying the dashboard. Bounds are inclusive. Blank cells fail
 * dateRange and range filters; "in" filters reach blanks through BLANK_LABEL.
 */
import { friendly } from "@/engine/core/labels";
import type { Column, Dataset } from "@/engine/core/types";

export type Filter =
  /** Inclusive wall-clock ms on a date column; `to` is usually an end-of-day timestamp. */
  | { kind: "dateRange"; column: string; from: number; to: number }
  /** Cell labels as produced by cellLabel; `exclude` inverts the test, so blanks pass unless "(blank)" is listed. */
  | { kind: "in"; column: string; values: string[]; exclude?: boolean }
  /** Inclusive numeric bounds on a number or date column; an omitted side is open. */
  | { kind: "range"; column: string; min?: number; max?: number };

/** Label of a blank cell in group keys and "in" filters. */
export const BLANK_LABEL = "(blank)";

type RowTest = (r: number) => boolean;

function columnIndex(ds: Dataset): Map<string, Column> {
  const m = new Map<string, Column>();
  for (const c of ds.columns) m.set(c.name, c);
  return m;
}

/**
 * Label used for a raw cell in group keys and filters.
 * Numbers and dates use String(value) (dates as raw ms), so "in" filters on
 * them must carry that exact spelling.
 */
export function cellLabel(col: Column, r: number): string {
  switch (col.kind) {
    case "string": {
      const c = col.codes[r] as number;
      return c < 0 ? BLANK_LABEL : (col.dict[c] as string);
    }
    case "boolean": {
      const v = col.values[r] as number;
      return v < 0 ? BLANK_LABEL : v === 1 ? col.trueLabel : col.falseLabel;
    }
    default: {
      const v = col.values[r] as number;
      return v === v ? String(v) : BLANK_LABEL;
    }
  }
}

function compileFilter(col: Column, f: Filter): RowTest {
  if (f.kind === "dateRange") {
    if (col.kind !== "date") return () => true;
    const v = col.values;
    const from = f.from;
    const to = f.to;
    return (r) => {
      const x = v[r] as number;
      return x >= from && x <= to;
    };
  }
  if (f.kind === "range") {
    if (col.kind !== "number" && col.kind !== "date") return () => true;
    const v = col.values;
    const min = f.min ?? -Infinity;
    const max = f.max ?? Infinity;
    return (r) => {
      const x = v[r] as number;
      return x >= min && x <= max;
    };
  }
  const wanted = new Set(f.values);
  const exclude = Boolean(f.exclude);
  if (col.kind === "string") {
    // Fast path: decide once per dictionary entry instead of labelling every row.
    const match = new Uint8Array(col.dict.length + 1);
    col.dict.forEach((d, i) => {
      if (wanted.has(d)) match[i] = 1;
    });
    const blank = wanted.has(BLANK_LABEL) ? 1 : 0;
    const codes = col.codes;
    return (r) => {
      const c = codes[r] as number;
      const hit = c < 0 ? blank : (match[c] as number);
      return exclude ? hit === 0 : hit === 1;
    };
  }
  return (r) => {
    const hit = wanted.has(cellLabel(col, r));
    return exclude ? !hit : hit;
  };
}

/**
 * Row indices passing all filters. `skip`, when given, drops every filter it
 * returns true for (used to evaluate "ignoring the date filter" and for charts
 * that must not filter themselves when cross-filtering). Rows come back in
 * ascending order; with no applicable filter, every row is returned.
 */
export function selectRows(
  ds: Dataset,
  filters: readonly Filter[],
  skip?: (f: Filter) => boolean,
): Int32Array {
  const cols = columnIndex(ds);
  const tests: RowTest[] = [];
  for (const f of filters) {
    if (skip?.(f)) continue;
    const col = cols.get(f.column);
    if (!col) continue;
    tests.push(compileFilter(col, f));
  }
  const n = ds.rowCount;
  if (tests.length === 0) {
    const all = new Int32Array(n);
    for (let i = 0; i < n; i++) all[i] = i;
    return all;
  }
  const out = new Int32Array(n);
  let k = 0;
  const t = tests.length;
  outer: for (let r = 0; r < n; r++) {
    for (let j = 0; j < t; j++) if (!(tests[j] as RowTest)(r)) continue outer;
    out[k++] = r;
  }
  return out.slice(0, k);
}

const selectionCache = new WeakMap<Dataset, Map<string, Int32Array>>();

/**
 * Memoised selection keyed by the filter list. `ignoreDate` drops date-range
 * filters (first-date context). Small LRU per dataset; arrays are read-only.
 * The key is the JSON of the filter list, so order matters, and `ignoreDate`
 * drops every dateRange filter, not only the primary date column's. The
 * returned array is shared between callers: never mutate it.
 */
export function selectRowsCached(ds: Dataset, filters: readonly Filter[], ignoreDate = false): Int32Array {
  const key = `${ignoreDate ? "nodate|" : ""}${JSON.stringify(filters)}`;
  let cache = selectionCache.get(ds);
  if (!cache) {
    cache = new Map();
    selectionCache.set(ds, cache);
  }
  const hit = cache.get(key);
  // Map keeps insertion order: re-insert on a hit, evict the oldest key past 12 entries.
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const rows = selectRows(ds, filters, ignoreDate ? (f) => f.kind === "dateRange" : undefined);
  cache.set(key, rows);
  if (cache.size > 12) cache.delete(cache.keys().next().value as string);
  return rows;
}

/** Short human-readable text for a filter chip (first three values, then "+N"). */
export function describeFilter(f: Filter, fmtDate: (t: number) => string): string {
  // One form everywhere ("Category: Apparel", "Order date: 1 Oct – 31 Dec 2025"), the column read with spaces.
  const col = friendly(f.column);
  if (f.kind === "dateRange") return `${col}: ${fmtDate(f.from)} – ${fmtDate(f.to)}`;
  if (f.kind === "range") return `${col}: ${f.min ?? "−∞"} – ${f.max ?? "∞"}`;
  const vals =
    f.values.length > 3 ? `${f.values.slice(0, 3).join(", ")} +${f.values.length - 3}` : f.values.join(", ");
  return `${col}: ${f.exclude ? "not " : ""}${vals}`;
}
