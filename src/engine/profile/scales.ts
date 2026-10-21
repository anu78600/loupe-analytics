/**
 * Numbers on more than one scale: a number column whose values fall in
 * groups a power of ten apart (994 beside 0.994, 41 beside 0.041), the
 * classic sign of a lost decimal point or of a thousands separator misread
 * while the file was cleaned. The health check (quality.ts) warns about such
 * a column and the data check (dataCheck.ts) marks the values off its
 * commonest scale. Nothing is changed: which scale is right can't be proven
 * from the values, so the user fixes the source file.
 *
 * The test reads log10|x| of the non-blank, non-zero values in bins of a
 * fiftieth of a decade:
 * - groups are runs of values with no empty stretch of half a decade (×3.2)
 *   inside them; the largest group is the commonest scale;
 * - another group sits a whole power of ten (10× to 1,000,000×) from it when
 *   that power brings its median within a factor of 2 of the commonest
 *   group's median and lands at least 90% of it inside the commonest group's
 *   range (a tenth of a decade to spare). Groups at the same power are one
 *   scale;
 * - a scale counts when it holds at least 5 values and 0.5% of them, and at
 *   least 3 different values: one value repeated is a placeholder such as
 *   999, not a scale;
 * - the column is flagged when a scale is 100× or more away, or when there
 *   are two or more of them (0.99, 9.9, 99 and 994). A single group 10× away
 *   is not enough: two kinds of thing a tenfold apart (a 50 g and a 500 g
 *   pack) are common.
 *
 * Skew is not two scales: money, counts and other amounts that span several
 * powers of ten fill the stretch in between, so they form one group. A
 * column rescaled as a whole (alcohol written as 0.105 instead of 10.5) is
 * one scale too, and is not flagged: nothing in the values shows it. Which
 * columns are tested at all (readings, rates and shares, never money,
 * counts, identifiers or codes) is decided in quality.ts.
 */
import { formatPlain } from "@/engine/core/format";

/** Bins per decade of log10|x|: one bin is a factor of about 1.047. */
const BINS = 50;
/** Half a decade (×3.2) of empty bins separates two groups. */
const GAP = BINS / 2;
/** A scale needs at least this many values and this share of the column's non-zero values. */
const MIN_VALUES = 5;
const MIN_SHARE = 0.005;
/** Different values a scale needs: one value repeated is a placeholder (999, 9999), not a scale. */
const MIN_DISTINCT = 3;
/** Largest power of ten looked for (1,000,000×). */
const MAX_SHIFT = 6;
/** How far, in bins, a scale's median may sit from the commonest group's once moved by its power (×2). */
const MAX_OFFSET = Math.round(0.3 * BINS);
/** Share of a group that must land inside the commonest group's range once moved, and the slack (a tenth of a decade). */
const MIN_FIT = 0.9;
const SLACK = BINS / 10;
/** The bin of a blank or zero value. */
const NONE = -2147483648;

/** A value's bin: floor(log10|v| × BINS). For finite, non-zero values only. */
function scaleBin(v: number): number {
  return Math.floor(Math.log10(Math.abs(v)) * BINS);
}

export interface ScaleGroup {
  /** Bin ranges, inclusive, of the values on this scale. */
  ranges: Array<[number, number]>;
  /** Values on this scale. */
  count: number;
  /** Power of ten from the commonest scale: 3 is 1,000× larger, −2 is 100× smaller, 0 the commonest scale itself. */
  shift: number;
  /** The scale's median value (the lower of the middle two), from the column. */
  example: number;
  /**
   * The commonest scale's value closest to `example` moved by `shift` (0.994
   * beside 994), from the column; for the commonest scale, its own example.
   */
  match: number;
}

export interface MixedScales {
  /** The commonest scale. */
  main: ScaleGroup;
  /** The other scales, largest first. */
  off: ScaleGroup[];
  /** Values on the other scales: the rows the data check marks. */
  count: number;
}

interface Run {
  lo: number;
  hi: number;
  count: number;
}

/**
 * The scales of a number column's values, or null when they sit on one
 * scale (see the header). NaN (blank) and zero values belong to no scale.
 */
export function mixedScales(values: Float64Array): MixedScales | null {
  const n = values.length;
  const bins = new Int32Array(n);
  let lo = Infinity;
  let hi = -Infinity;
  let used = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i] as number;
    // Number.isFinite is false for NaN, the blank sentinel.
    if (v === 0 || !Number.isFinite(v)) {
      bins[i] = NONE;
      continue;
    }
    const b = scaleBin(v);
    bins[i] = b;
    if (b < lo) lo = b;
    if (b > hi) hi = b;
    used++;
  }
  // Two groups need an empty half decade between them, so the values must span more than that.
  if (used < 2 * MIN_VALUES || hi - lo <= GAP) return null;
  const hist = new Int32Array(hi - lo + 1);
  for (let i = 0; i < n; i++) {
    const b = bins[i] as number;
    if (b !== NONE) hist[b - lo] = (hist[b - lo] as number) + 1;
  }
  const at = (b: number) => hist[b - lo] as number;

  // Groups: runs of bins with fewer than GAP empty bins between neighbours.
  const runs: Run[] = [];
  let start = NONE;
  let last = NONE;
  let count = 0;
  for (let b = lo; b <= hi; b++) {
    if (!at(b)) continue;
    if (start !== NONE && b - last > GAP) {
      runs.push({ lo: start, hi: last, count });
      start = NONE;
      count = 0;
    }
    if (start === NONE) start = b;
    last = b;
    count += at(b);
  }
  runs.push({ lo: start, hi: last, count });
  if (runs.length < 2) return null;

  /** The bin holding the median value of a set of runs. */
  const medianBin = (rs: Run[]): number => {
    const total = rs.reduce((s, r) => s + r.count, 0);
    let need = Math.ceil(total / 2);
    for (const r of rs)
      for (let b = r.lo; b <= r.hi; b++) {
        need -= at(b);
        if (need <= 0) return b;
      }
    return (rs[rs.length - 1] as Run).hi;
  };
  // The commonest scale: the largest run (the lower one on a tie).
  const main = runs.reduce((a, b) => (b.count > a.count ? b : a));
  const mainMedian = medianBin([main]);

  // Each other run moved by the power of ten that brings its median nearest the commonest group's.
  const byShift = new Map<number, Run[]>();
  for (const r of runs) {
    if (r === main) continue;
    const shift = Math.round((medianBin([r]) - mainMedian) / BINS);
    if (shift === 0 || Math.abs(shift) > MAX_SHIFT) continue;
    let inside = 0;
    for (let b = r.lo; b <= r.hi; b++) {
      const moved = b - shift * BINS;
      if (moved >= main.lo - SLACK && moved <= main.hi + SLACK) inside += at(b);
    }
    if (inside >= MIN_FIT * r.count) byShift.set(shift, [...(byShift.get(shift) ?? []), r]);
  }
  const minCount = Math.max(MIN_VALUES, MIN_SHARE * used);
  const candidates = [...byShift.entries()].filter(([shift, rs]) => {
    const total = rs.reduce((s, r) => s + r.count, 0);
    return total >= minCount && Math.abs(medianBin(rs) - shift * BINS - mainMedian) <= MAX_OFFSET;
  });
  if (!candidates.length) return null;

  // Which scale (0 = the commonest, 1… = a candidate) each bin belongs to, for the passes over the values.
  const scaleOf = new Int8Array(hist.length).fill(-1);
  for (let b = main.lo; b <= main.hi; b++) scaleOf[b - lo] = 0;
  candidates.forEach(([, rs], k) => {
    for (const r of rs) for (let b = r.lo; b <= r.hi; b++) scaleOf[b - lo] = k + 1;
  });
  const scaleAt = (i: number): number => {
    const b = bins[i] as number;
    return b === NONE ? -1 : (scaleOf[b - lo] as number);
  };
  // Different values per candidate, counted up to MIN_DISTINCT.
  const distinct = candidates.map(() => new Set<number>());
  for (let i = 0; i < n; i++) {
    const k = scaleAt(i);
    const set = k > 0 ? distinct[k - 1] : undefined;
    if (set && set.size < MIN_DISTINCT) set.add(values[i] as number);
  }
  const kept = candidates.filter((_, k) => (distinct[k] as Set<number>).size >= MIN_DISTINCT);
  // One scale 10× away is not enough on its own (see the header).
  if (!kept.length || (kept.length === 1 && Math.abs((kept[0] as [number, Run[]])[0]) < 2)) return null;

  // Every value of the commonest and the kept scales, sorted, for the examples.
  const keptIndex = new Set(kept.map((c) => candidates.indexOf(c) + 1));
  const lists = new Map<number, number[]>([[0, []]]);
  for (const k of keptIndex) lists.set(k, []);
  for (let i = 0; i < n; i++) lists.get(scaleAt(i))?.push(values[i] as number);
  const sorted = (k: number) => Float64Array.from(lists.get(k) ?? []).sort();
  const mainValues = sorted(0);
  const middle = (xs: Float64Array) => xs[(xs.length - 1) >> 1] as number;
  const mainExample = middle(mainValues);
  /** The commonest scale's value closest to `target`, by binary search. */
  const closest = (target: number): number => {
    let a = 0;
    let z = mainValues.length - 1;
    while (z - a > 1) {
      const m = (a + z) >> 1;
      if ((mainValues[m] as number) < target) a = m;
      else z = m;
    }
    const x = mainValues[a] as number;
    const y = mainValues[z] as number;
    return Math.abs(y - target) < Math.abs(x - target) ? y : x;
  };
  const off: ScaleGroup[] = kept
    .map(([shift, rs]) => {
      const example = middle(sorted(candidates.findIndex((c) => c[0] === shift) + 1));
      return {
        ranges: rs.map((r): [number, number] => [r.lo, r.hi]),
        count: rs.reduce((s, r) => s + r.count, 0),
        shift,
        example,
        match: closest(example / 10 ** shift),
      };
    })
    .sort((a, b) => b.count - a.count || a.shift - b.shift);
  return {
    main: {
      ranges: [[main.lo, main.hi]],
      count: main.count,
      shift: 0,
      example: mainExample,
      match: mainExample,
    },
    off,
    count: off.reduce((s, g) => s + g.count, 0),
  };
}

/** The scale off the commonest one that `v` sits on, or undefined (blank, zero or on the commonest scale). */
export function offScale(scales: MixedScales, v: number): ScaleGroup | undefined {
  if (v === 0 || !Number.isFinite(v)) return undefined;
  const b = scaleBin(v);
  return scales.off.find((g) => g.ranges.some(([lo, hi]) => b >= lo && b <= hi));
}

/** A shift as a factor: 3 → "1,000×", −2 → "100×". */
export function scaleFactor(shift: number): string {
  return `${formatPlain(10 ** Math.abs(shift), 0, "INTL")}×`;
}

/**
 * A value as the file holds it: up to 6 significant digits, international
 * grouping and a true minus sign ("994", "0.994", "1,215.5", "−0.04").
 */
export function valueText(v: number): string {
  const x = Number(v.toPrecision(6));
  const plain = String(Math.abs(x));
  const point = plain.indexOf(".");
  const body = plain.includes("e")
    ? plain
    : formatPlain(Math.abs(x), point < 0 ? 0 : plain.length - point - 1, "INTL");
  return x < 0 ? `−${body}` : body;
}
