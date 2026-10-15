/**
 * Grouping keys: categorical columns, continuous time buckets, date parts and numeric bins.
 *
 * `groupOf[i]` is the group of the i-th selected row, or -1 when the row has
 * no group (blank date, blank or non-finite bin value); run compactRows
 * before evaluating so those rows drop out. Categorical groups come out in
 * first-seen row order (callers sort) and blanks get their own "(blank)"
 * group. Time keys emit every bucket between the first and last date, empty
 * ones included, so trends have no gaps.
 */
import type { Column, Dataset } from "@/engine/core/types";
import {
  bucketLabel,
  type DatePart,
  datePart,
  datePartLabel,
  nextBucket,
  type TimeGrain,
  truncate,
} from "@/engine/core/dates";
import { formatCompact, formatPlain } from "@/engine/core/format";
import type { RowExpr } from "./expr";
import { BLANK_LABEL } from "./filter";

export type GroupKey =
  /** Distinct values of a column; a date column given here is bucketed by day. */
  | { kind: "column"; column: string }
  /** Continuous buckets of `grain`, capped at 5000 buckets (rows past the cap get no group). */
  | { kind: "time"; column: string; grain: TimeGrain }
  /** Fixed calendar slots, all present even when empty: dow (0 = Monday), hour, month (0 = January), dom (1–31). */
  | { kind: "datePart"; column: string; part: DatePart }
  /** Bins over a number/date column; `edges` ascending, values beyond them fold into the end bins. */
  | { kind: "bin"; column: string; edges: number[]; format?: "number" | "currency" | "percent" }
  /** Bins over a row expression; buildGrouping needs its compiled getter in `opts.getters`. */
  | {
      kind: "binExpr";
      expr: RowExpr;
      edges: number[];
      format?: "number" | "currency" | "percent";
      label: string;
    };

export interface GroupLabel {
  label: string;
  /** Raw key: string value, bucket start ms, part index or bin index. null for the blank group. */
  raw: string | number | null;
}

export interface Grouping {
  /** Group per selected row; -1 = the row belongs to no group. */
  groupOf: Int32Array;
  G: number;
  /** For each group, one label per key. */
  labels: GroupLabel[][];
  /** Start ms of each group's time bucket when the first key buckets time, else null. */
  periodStart: Float64Array | null;
  rowCounts: Int32Array;
}

export type RowGetter = (r: number) => number;

/** Bin range label "a–b", formatted for the axis (percent bins hold fractions). */
export function binLabel(
  a: number,
  b: number,
  format: "number" | "currency" | "percent" | undefined,
): string {
  const f = (x: number) =>
    format === "percent"
      ? `${formatPlain(x * 100, Math.abs(x) < 0.1 && x !== 0 ? 1 : 0, "INTL")}%`
      : Math.abs(x) >= 1000
        ? formatCompact(x, "INTL")
        : formatPlain(x, Number.isInteger(x) ? 0 : 2, "INTL");
  return `${f(a)}–${f(b)}`;
}

function binIndex(edges: number[], v: number): number {
  // edges are ascending; bins are [e_i, e_{i+1}); last bin includes the max.
  // Values below the first edge land in bin 0 and values past the last edge in
  // the last bin, so clipped (p1–p99) edges still count every row.
  const last = edges.length - 2;
  if (v < (edges[0] as number)) return 0;
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (v >= (edges[mid] as number)) lo = mid;
    else hi = mid - 1;
  }
  return Math.min(lo, last);
}

interface SingleGrouping {
  codes: Int32Array; // per selected row, -1 = excluded (null bin values)
  G: number;
  labels: GroupLabel[];
  periodStart: Float64Array | null;
}

/** Codes the selected rows by one key. */
function groupSingle(ds: Dataset, key: GroupKey, rows: Int32Array, getter?: RowGetter): SingleGrouping {
  const n = rows.length;
  const codes = new Int32Array(n);
  if (key.kind === "binExpr" || key.kind === "bin") {
    const edges = key.edges;
    let get: RowGetter;
    if (key.kind === "bin") {
      const col = ds.columns.find((c) => c.name === key.column);
      if (!col || (col.kind !== "number" && col.kind !== "date"))
        throw new Error(`Bin column "${key.column}" is not numeric.`);
      const v = col.values;
      get = (r) => v[r] as number;
    } else {
      if (!getter) throw new Error("binExpr requires a row getter.");
      get = getter;
    }
    const G = Math.max(1, edges.length - 1);
    for (let i = 0; i < n; i++) {
      const x = get(rows[i] as number);
      codes[i] = x === x && Number.isFinite(x) ? binIndex(edges, x) : -1;
    }
    const labels: GroupLabel[] = [];
    for (let g = 0; g < G; g++)
      labels.push({ label: binLabel(edges[g] as number, edges[g + 1] as number, key.format), raw: g });
    return { codes, G, labels, periodStart: null };
  }

  const col = ds.columns.find((c) => c.name === key.column) as Column | undefined;
  if (!col) throw new Error(`Unknown column "${key.column}".`);

  if (key.kind === "time" || (key.kind === "column" && col.kind === "date")) {
    if (col.kind !== "date") throw new Error(`"${key.column}" is not a date column.`);
    const grain: TimeGrain = key.kind === "time" ? key.grain : "day";
    const v = col.values;
    let min = Infinity;
    let max = -Infinity;
    const bucketOf = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x = v[rows[i] as number] as number;
      if (x !== x) {
        bucketOf[i] = NaN;
        continue;
      }
      const b = truncate(x, grain);
      bucketOf[i] = b;
      if (b < min) min = b;
      if (b > max) max = b;
    }
    if (min === Infinity)
      return { codes: codes.fill(-1), G: 0, labels: [], periodStart: new Float64Array(0) };
    const index = new Map<number, number>();
    const starts: number[] = [];
    // Every bucket from first to last, empty ones included. The 5000 cap stops
    // a stray far-off date from exploding the axis; rows beyond it get -1.
    for (let b = min; b <= max && starts.length < 5000; b = nextBucket(b, grain)) {
      index.set(b, starts.length);
      starts.push(b);
    }
    for (let i = 0; i < n; i++) {
      const b = bucketOf[i] as number;
      codes[i] = b === b ? (index.get(b) ?? -1) : -1;
    }
    return {
      codes,
      G: starts.length,
      labels: starts.map((s) => ({ label: bucketLabel(s, grain), raw: s })),
      periodStart: Float64Array.from(starts),
    };
  }

  if (key.kind === "datePart") {
    if (col.kind !== "date") throw new Error(`"${key.column}" is not a date column.`);
    const v = col.values;
    const part = key.part;
    // Fixed slots so every weekday/hour/month appears even when empty; day of
    // month is 1-based, hence the offset.
    const size = part === "dow" ? 7 : part === "hour" ? 24 : part === "month" ? 12 : 31;
    const offset = part === "dom" ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const x = v[rows[i] as number] as number;
      codes[i] = x === x ? datePart(x, part) - offset : -1;
    }
    const labels: GroupLabel[] = [];
    for (let g = 0; g < size; g++) labels.push({ label: datePartLabel(part, g + offset), raw: g + offset });
    return { codes, G: size, labels, periodStart: null };
  }

  // Categorical column
  if (col.kind === "string") {
    // Dictionary code → group id, numbered in first-seen order; slot dict.length holds blanks.
    const map = new Int32Array(col.dict.length + 1).fill(-1);
    const labels: GroupLabel[] = [];
    const cc = col.codes;
    for (let i = 0; i < n; i++) {
      const c = cc[rows[i] as number] as number;
      const slot = c < 0 ? col.dict.length : c;
      let g = map[slot] as number;
      if (g < 0) {
        g = labels.length;
        map[slot] = g;
        labels.push(
          c < 0
            ? { label: BLANK_LABEL, raw: null }
            : { label: col.dict[c] as string, raw: col.dict[c] as string },
        );
      }
      codes[i] = g;
    }
    return { codes, G: labels.length, labels, periodStart: null };
  }
  if (col.kind === "boolean") {
    const map = [-1, -1, -1];
    const labels: GroupLabel[] = [];
    for (let i = 0; i < n; i++) {
      const v = col.values[rows[i] as number] as number;
      const slot = v < 0 ? 2 : v;
      let g = map[slot] as number;
      if (g < 0) {
        g = labels.length;
        map[slot] = g;
        labels.push({
          label: v < 0 ? BLANK_LABEL : v === 1 ? col.trueLabel : col.falseLabel,
          raw: v < 0 ? null : v === 1 ? col.trueLabel : col.falseLabel,
        });
      }
      codes[i] = g;
    }
    return { codes, G: labels.length, labels, periodStart: null };
  }
  // Numeric column used as a category (e.g. year)
  const map = new Map<number, number>();
  const labels: GroupLabel[] = [];
  for (let i = 0; i < n; i++) {
    const v = col.values[rows[i] as number] as number;
    const k = v === v ? v : Number.NEGATIVE_INFINITY;
    let g = map.get(k);
    if (g === undefined) {
      g = labels.length;
      map.set(k, g);
      // Integers between 1900 and 2100 are probably years, so they print without thousands separators.
      labels.push(
        v === v
          ? {
              label: formatPlain(v, Number.isInteger(v) ? 0 : 2, "INTL").replace(
                /,/g,
                Number.isInteger(v) && v >= 1900 && v <= 2100 ? "" : ",",
              ),
              raw: v,
            }
          : { label: BLANK_LABEL, raw: null },
      );
    }
    codes[i] = g;
  }
  return { codes, G: labels.length, labels, periodStart: null };
}

/**
 * Builds the grouping for up to two keys. With two keys and `dense`, every
 * combination is kept (heatmaps need empty cells); otherwise only seen ones.
 * Keys beyond the second are ignored, and periodStart comes from the first
 * key only, so a time key must come first. With `dense` the composite id is
 * firstCode * (second key's G) + secondCode; otherwise ids follow first-seen order.
 */
export function buildGrouping(
  ds: Dataset,
  keys: readonly GroupKey[],
  rows: Int32Array,
  opts: { dense?: boolean; getters?: Array<RowGetter | undefined> } = {},
): Grouping {
  const n = rows.length;
  if (keys.length === 0) {
    return { groupOf: new Int32Array(n), G: 1, labels: [[]], periodStart: null, rowCounts: Int32Array.of(n) };
  }
  const parts = keys.map((k, i) => groupSingle(ds, k, rows, opts.getters?.[i]));
  let groupOf: Int32Array;
  let G: number;
  let labels: GroupLabel[][];
  let periodStart: Float64Array | null = null;
  if (parts.length === 1) {
    const p = parts[0] as SingleGrouping;
    groupOf = p.codes;
    G = p.G;
    labels = p.labels.map((l) => [l]);
    periodStart = p.periodStart;
  } else {
    const [a, b] = parts as [SingleGrouping, SingleGrouping];
    groupOf = new Int32Array(n);
    if (opts.dense) {
      G = a.G * b.G;
      for (let i = 0; i < n; i++) {
        const x = a.codes[i] as number;
        const y = b.codes[i] as number;
        groupOf[i] = x < 0 || y < 0 ? -1 : x * b.G + y;
      }
      labels = [];
      for (let x = 0; x < a.G; x++)
        for (let y = 0; y < b.G; y++) labels.push([a.labels[x] as GroupLabel, b.labels[y] as GroupLabel]);
      if (a.periodStart) {
        periodStart = new Float64Array(G);
        for (let x = 0; x < a.G; x++)
          for (let y = 0; y < b.G; y++) periodStart[x * b.G + y] = a.periodStart[x] as number;
      }
    } else {
      const map = new Map<number, number>();
      labels = [];
      const starts: number[] = [];
      for (let i = 0; i < n; i++) {
        const x = a.codes[i] as number;
        const y = b.codes[i] as number;
        if (x < 0 || y < 0) {
          groupOf[i] = -1;
          continue;
        }
        const k = x * b.G + y;
        let g = map.get(k);
        if (g === undefined) {
          g = labels.length;
          map.set(k, g);
          labels.push([a.labels[x] as GroupLabel, b.labels[y] as GroupLabel]);
          if (a.periodStart) starts.push(a.periodStart[x] as number);
        }
        groupOf[i] = g;
      }
      G = labels.length;
      if (a.periodStart) periodStart = Float64Array.from(starts);
    }
  }
  const rowCounts = new Int32Array(G);
  for (let i = 0; i < n; i++) {
    const g = groupOf[i] as number;
    if (g >= 0) rowCounts[g] = (rowCounts[g] as number) + 1;
  }
  return { groupOf, G, labels, periodStart, rowCounts };
}

/** Drops rows whose group is -1 so evaluators only see valid groups. Returns the inputs as-is when nothing is dropped. */
export function compactRows(
  rows: Int32Array,
  groupOf: Int32Array,
): { rows: Int32Array; groupOf: Int32Array } {
  let k = 0;
  for (let i = 0; i < groupOf.length; i++) if ((groupOf[i] as number) >= 0) k++;
  if (k === groupOf.length) return { rows, groupOf };
  const r2 = new Int32Array(k);
  const g2 = new Int32Array(k);
  k = 0;
  for (let i = 0; i < groupOf.length; i++) {
    const g = groupOf[i] as number;
    if (g < 0) continue;
    r2[k] = rows[i] as number;
    g2[k++] = g;
  }
  return { rows: r2, groupOf: g2 };
}
