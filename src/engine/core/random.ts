/**
 * Deterministic seeded PRNG (sfc32) so demo data is identical on every run.
 *
 * Used by the demo generators (src/engine/samples) and test fixtures; not
 * cryptographically secure. Determinism also needs callers to draw in a fixed
 * order: draws consumed inside engine-dependent code (e.g. Array#sort with a
 * random comparator) can differ between JavaScript engines.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    // Mix the seed into fixed non-zero constants (golden ratio, π and e hex digits, 0xdeadbeef)
    // and discard the first 15 outputs so that nearby seeds (7, 11, 13, …) quickly diverge.
    this.a = 0x9e3779b9 ^ seed;
    this.b = 0x243f6a88 ^ (seed * 31);
    this.c = 0xb7e15162 ^ (seed * 17);
    this.d = 0xdeadbeef ^ (seed * 7);
    for (let i = 0; i < 15; i++) this.next();
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniform element; `items` must be non-empty. */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Weighted pick; weights need not sum to 1. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i] ?? 0;
      if (r <= 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }

  /** Standard normal via Box–Muller. */
  normal(mean = 0, sd = 1): number {
    let u = 0;
    // next() can return exactly 0; log(0) would give an infinite sample.
    while (u === 0) u = this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Log-normal with the given median; `sigma` is the standard deviation on the log scale. */
  logNormal(median: number, sigma: number): number {
    return median * Math.exp(this.normal(0, sigma));
  }

  /** Geometric-like count ≥ 1 with the given continuation probability, capped at `max`. */
  geometric(p: number, max = 50): number {
    let n = 1;
    while (n < max && this.next() < p) n++;
    return n;
  }
}
