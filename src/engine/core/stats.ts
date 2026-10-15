/**
 * Small, dependency-free statistics helpers used across profiling and insights.
 *
 * Conventions: NaN is the null marker and is skipped by every aggregate here
 * (quantileSorted excepted, which expects clean input). Too little data gives
 * NaN rather than an exception (moments reports std and skew as 0 instead),
 * so check results with `x === x` or Number.isFinite before using them.
 */

/**
 * Quantile of an ascending-sorted array (linear interpolation, R type 7).
 * Input must be NaN-free; q in [0, 1]; NaN when empty.
 */
export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0] as number;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

/** Mean of the non-NaN values; NaN when there are none. */
export function mean(values: ArrayLike<number>): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    if (v === v) {
      s += v;
      n++;
    }
  }
  return n ? s / n : NaN;
}

/** Median of the non-NaN values (works on a copy; the input is not reordered); NaN when empty. */
export function median(values: number[]): number {
  const clean = values.filter((v) => v === v).sort((a, b) => a - b);
  return quantileSorted(clean, 0.5);
}

/**
 * Median absolute deviation scaled to be a consistent σ estimator.
 * 1.4826 makes MAD match σ for normal data. Returns 0 when more than half the
 * values equal the median, so guard divisions by it.
 */
export function robustSigma(values: number[]): number {
  const med = median(values);
  const dev = values.filter((v) => v === v).map((v) => Math.abs(v - med));
  return 1.4826 * median(dev);
}

export interface Moments {
  /** Count of non-NaN values. */
  n: number;
  /** NaN when n = 0 (as are min and max). */
  mean: number;
  /** Sample standard deviation (n − 1 denominator); 0 when n ≤ 1. */
  std: number;
  /** Population skewness g1; 0 when n ≤ 2 or the values are constant. */
  skew: number;
  min: number;
  max: number;
  /** 0 when n = 0. */
  sum: number;
}

/** One-pass moments (Welford with third-moment extension). NaN values are skipped. */
export function moments(values: ArrayLike<number>): Moments {
  let n = 0;
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const x = values[i] as number;
    if (x !== x) continue;
    const n1 = n;
    n++;
    const delta = x - m1;
    const deltaN = delta / n;
    const term1 = delta * deltaN * n1;
    m1 += deltaN;
    m3 += term1 * deltaN * (n - 2) - 3 * deltaN * m2;
    m2 += term1;
    sum += x;
    if (x < min) min = x;
    if (x > max) max = x;
  }
  const variance = n > 1 ? m2 / (n - 1) : 0;
  const skew = n > 2 && m2 > 0 ? (Math.sqrt(n) * m3) / Math.pow(m2, 1.5) : 0;
  return {
    n,
    mean: n ? m1 : NaN,
    std: Math.sqrt(variance),
    skew,
    min: n ? min : NaN,
    max: n ? max : NaN,
    sum,
  };
}

/**
 * Pearson correlation over rows where both values are present.
 * r is NaN below 3 pairs or when either side is constant.
 */
export function pearson(x: ArrayLike<number>, y: ArrayLike<number>): { r: number; n: number } {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  const len = Math.min(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const a = x[i] as number;
    const b = y[i] as number;
    if (a !== a || b !== b) continue;
    n++;
    sx += a;
    sy += b;
    sxx += a * a;
    syy += b * b;
    sxy += a * b;
  }
  if (n < 3) return { r: NaN, n };
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (vx <= 0 || vy <= 0) return { r: NaN, n };
  return { r: cov / Math.sqrt(vx * vy), n };
}

export interface Regression {
  slope: number;
  intercept: number;
  /** Coefficient of determination, clamped at 0; NaN when y is constant. */
  r2: number;
  /** Complete (x, y) pairs used. */
  n: number;
}

/**
 * Ordinary least squares y = slope·x + intercept over complete pairs.
 * slope, intercept and r2 are NaN with fewer than 2 pairs or a constant x.
 */
export function linearRegression(x: ArrayLike<number>, y: ArrayLike<number>): Regression {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const a = x[i] as number;
    const b = y[i] as number;
    if (a !== a || b !== b) continue;
    n++;
    sx += a;
    sy += b;
    sxx += a * a;
    sxy += a * b;
    syy += b * b;
  }
  const denom = n * sxx - sx * sx;
  if (n < 2 || denom === 0) return { slope: NaN, intercept: NaN, r2: NaN, n };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const ssTot = syy - (sy * sy) / n;
  const ssRes = syy - intercept * sy - slope * sxy;
  return { slope, intercept, r2: ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : NaN, n };
}

/** "Nice" rounded step for axis-like bins: 1, 2, 2.5 or 5 × 10^k. Returns 1 for a non-positive or NaN range. */
export function niceStep(range: number, targetSteps: number): number {
  if (!(range > 0)) return 1;
  const raw = range / Math.max(1, targetSteps);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const frac = raw / pow;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  return nice * pow;
}

/**
 * Bin edges with nice boundaries covering [min, max].
 * The last edge is strictly greater than max, so half-open bins
 * [edge_i, edge_i+1) include max. Capped at about 200 edges; a degenerate
 * range (max ≤ min, or NaN) gives [min, min + 1].
 */
export function niceBins(min: number, max: number, target = 12): number[] {
  if (!(max > min)) return [min, min + 1];
  const step = niceStep(max - min, target);
  const start = Math.floor(min / step) * step;
  const edges: number[] = [];
  for (let e = start; e <= max + step * 0.5 && edges.length < 200; e += step) {
    // toPrecision(12) strips the drift that repeated `+= step` accumulates (0.30000000000000004).
    edges.push(Number(e.toPrecision(12)));
  }
  if ((edges[edges.length - 1] as number) <= max)
    edges.push(Number(((edges[edges.length - 1] as number) + step).toPrecision(12)));
  return edges;
}

/**
 * Deterministic systematic sample of indices (every k-th) capped at maxSize.
 * Indices are ascending and unique; all rows when n ≤ maxSize. The step
 * n / maxSize may be fractional, so each gap is either ⌊step⌋ or ⌈step⌉.
 */
export function systematicSample(n: number, maxSize: number): Int32Array {
  if (n <= maxSize) {
    const all = new Int32Array(n);
    for (let i = 0; i < n; i++) all[i] = i;
    return all;
  }
  const out = new Int32Array(maxSize);
  const step = n / maxSize;
  for (let i = 0; i < maxSize; i++) out[i] = Math.floor(i * step);
  return out;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Relative change with a safe zero baseline.
 * Returns a fraction (0.12 = +12%), or NaN when either value is missing or
 * previous is 0. Dividing by |previous| keeps the sign meaningful for a
 * negative baseline (−100 → −50 is +50%).
 */
export function pctChange(current: number, previous: number): number {
  if (!(previous === previous) || !(current === current) || previous === 0) return NaN;
  return (current - previous) / Math.abs(previous);
}

/**
 * 53-bit-ish string hash (two FNV-1a lanes) for duplicate detection keys.
 * Exactly 53 bits: all 32 of the first lane and the low 21 of the second, so
 * the result is a safe integer. The second lane uses MurmurHash2's multiplier.
 * Hashes UTF-16 code units; not cryptographic.
 */
export function hashString(s: string, seed = 0): number {
  let h1 = 0x811c9dc5 ^ seed;
  let h2 = 0x01000193 ^ (seed * 7);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0) * 2097152 + ((h2 >>> 0) & 0x1fffff);
}
