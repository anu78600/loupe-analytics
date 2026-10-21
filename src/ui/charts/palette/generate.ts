/**
 * Palette generators for chart themes, all in OKLCH and all deterministic:
 * - rampFrom(): the 8-step gradient (sequential ramp) of one colour, shaped
 *   like the built-in brass ramp, used for heatmaps, cohort grids, the RFM
 *   treemap and funnels;
 * - shadesFrom(): series colours that are shades of one colour, ordered so
 *   neighbouring series sit far apart in lightness;
 * - matchingFrom(): series colours built around one or more given colours,
 *   chosen from a 12-hue wheel anchored on the first so each new series is
 *   as distinct as possible from its neighbour and from every earlier one;
 * - forDark(): the dark-theme version of light-theme colours (same hues,
 *   lightness moved into the dark band);
 * - improve(): "snap to passing": keeps every hue and moves lightness (and
 *   lifts a greyish chroma) until each colour sits in the theme's band and
 *   stands out on the background, and neighbouring series clear the
 *   colour-blind target and the normal-vision floor of check.ts, staying as
 *   close to the given colours as it can.
 */
import { BAND, CHROMA_FLOOR, CONTRAST_MIN, CVD_TARGET, NORMAL_FLOOR, SURFACE, type ThemeMode } from "./check";
import {
  contrast,
  maxChroma,
  oklab,
  oklabFromLinear,
  oklch,
  oklchToHex,
  simulateCvd,
  type Oklab,
  type Oklch,
} from "./colour";

/** Series colours per theme: charts assign them in order and never cycle (a ninth series folds into "Others"). */
export const SLOTS = 8;

// The built-in brass ramp's shape (--seq-1…8 in styles/theme-light.css and theme-dark.css,
// measured in OKLCH): lightness per step and chroma as a share of the ramp's strongest chroma.
// Step 1 sits next to the background, far enough from it to show (≥ 1.5:1 on the card).
const RAMP_L: Record<ThemeMode, number[]> = {
  light: [0.856, 0.79, 0.725, 0.66, 0.594, 0.529, 0.465, 0.4],
  dark: [0.366, 0.435, 0.505, 0.575, 0.644, 0.716, 0.785, 0.856],
};
const RAMP_C: Record<ThemeMode, number[]> = {
  light: [0.51, 0.65, 0.81, 0.93, 1, 1, 0.95, 0.84],
  dark: [0.42, 0.51, 0.61, 0.7, 0.79, 0.87, 0.94, 1],
};

/**
 * The 8-step gradient of `hex` for one theme: its hue at the built-in ramp's
 * lightness steps (light end next to the background, strong end away from
 * it), with chroma shaped the same way. A greyish colour gives a grey ramp.
 */
export function rampFrom(hex: string, mode: ThemeMode): string[] {
  const { c, h } = oklch(hex);
  const peak = Math.min(0.16, Math.max(0.03, c));
  return RAMP_L[mode].map((l, i) => oklchToHex({ l, c: peak * (RAMP_C[mode][i] as number), h }));
}

/**
 * Lightness a series colour of this hue and chroma may take in a theme: the
 * theme's band, narrowed to where it keeps 3:1 contrast with the background
 * (contrast rises with lightness at a fixed hue, so a binary search finds
 * the edge). Falls back to the band when no lightness in it reaches 3:1.
 */
export function lightnessRange(c: number, h: number, mode: ThemeMode): [number, number] {
  // A little inside the band, so rounding to #rrggbb never lands just outside it.
  const lo = BAND[mode][0] + 0.005;
  const hi = BAND[mode][1] - 0.005;
  const ok = (l: number) => contrast(oklchToHex({ l, c, h }), SURFACE[mode]) >= CONTRAST_MIN + 0.05;
  if (mode === "light") {
    if (!ok(lo)) return [lo, hi];
    let a = lo;
    let b = hi;
    for (let i = 0; i < 16; i++) {
      const m = (a + b) / 2;
      if (ok(m)) a = m;
      else b = m;
    }
    return [lo, a];
  }
  if (!ok(hi)) return [lo, hi];
  let a = lo;
  let b = hi;
  for (let i = 0; i < 16; i++) {
    const m = (a + b) / 2;
    if (ok(m)) b = m;
    else a = m;
  }
  return [b, hi];
}

/** Lightness range shades are spread over, per theme: wide enough to tell neighbours apart. */
const SHADE_RANGE: Record<ThemeMode, [number, number]> = { light: [0.32, 0.8], dark: [0.42, 0.88] };

/**
 * Eight shades of one colour (its hue, eight evenly spaced lightness steps)
 * for one theme. Series 1 is the colour itself, its lightness pulled into
 * range; the other seven follow in the order that keeps neighbouring series
 * furthest apart (every order is tried; ties go to the order whose first
 * three series are most spread out). Chroma eases off away from the
 * colour's own lightness, as real tints and shades do. Shades suit charts
 * with a few series; check.ts reports where eight become hard to tell apart.
 */
export function shadesFrom(hex: string, mode: ThemeMode): string[] {
  const { l, c, h } = oklch(hex);
  const [lo, hi] = SHADE_RANGE[mode];
  const step = (hi - lo) / (SLOTS - 1);
  const levels = Array.from({ length: SLOTS }, (_, i) => lo + i * step);
  // The step nearest the colour's own lightness becomes the colour itself (pulled into range).
  const own = Math.min(hi, Math.max(lo, l));
  const at = levels.reduce(
    (best, v, i) => (Math.abs(v - own) < Math.abs((levels[best] as number) - own) ? i : best),
    0,
  );
  levels[at] = own;
  const rest = levels.filter((_, i) => i !== at);
  let best: number[] = [];
  let bestKey = [-1, -1, -1];
  const permute = (prefix: number[], left: number[]) => {
    if (!left.length) {
      const order = [own, ...prefix];
      let minGap = Infinity;
      let total = 0;
      for (let i = 0; i + 1 < order.length; i++) {
        const g = Math.abs((order[i] as number) - (order[i + 1] as number));
        minGap = Math.min(minGap, g);
        total += g;
      }
      const [a, b, d] = order as [number, number, number];
      const spread = Math.min(Math.abs(a - b), Math.abs(a - d), Math.abs(b - d));
      const key = [Math.round(minGap * 1000), Math.round(spread * 1000), Math.round(total * 1000)];
      if (
        key[0]! > bestKey[0]! ||
        (key[0] === bestKey[0] && (key[1]! > bestKey[1]! || (key[1] === bestKey[1] && key[2]! > bestKey[2]!)))
      ) {
        best = order;
        bestKey = key;
      }
      return;
    }
    left.forEach((v, i) => permute([...prefix, v], [...left.slice(0, i), ...left.slice(i + 1)]));
  };
  permute([], rest);
  return best.map((sl) => {
    const ease = 1 - 0.3 * Math.min(1, Math.abs(sl - l) / 0.4);
    return oklchToHex({ l: sl, c: Math.min(c * ease, maxChroma(sl, h)), h });
  });
}

/** OKLab of a colour as seen normally and under protanopia and deuteranopia, computed once. */
interface Seen {
  normal: Oklab;
  protan: Oklab;
  deutan: Oklab;
}
const seen = (hex: string): Seen => ({
  normal: oklab(hex),
  protan: oklabFromLinear(simulateCvd(hex, "protan")),
  deutan: oklabFromLinear(simulateCvd(hex, "deutan")),
});
const dist = (p: Oklab, q: Oklab) => 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
/** How well two neighbours separate, as a share of the targets: 1 = exactly at the colour-blind target and the normal-vision floor. */
const pairScore = (a: Seen, b: Seen) =>
  Math.min(
    Math.min(dist(a.protan, b.protan), dist(a.deutan, b.deutan)) / CVD_TARGET,
    dist(a.normal, b.normal) / NORMAL_FLOOR,
  );

/**
 * Series colours that start with `seeds` (kept exactly) and continue with
 * colours built around the first seed: its hue and 11 more at 30° steps, at
 * three lightness levels that stand out on the theme's background, with the
 * seeds' typical chroma. Each next colour is the candidate that best
 * separates from its neighbour (colour-blind target and normal-vision
 * floor), then from every colour so far. Light theme by default; forDark()
 * gives the dark one, so a series keeps its hue in both themes.
 */
export function matchingFrom(seeds: string[], mode: ThemeMode = "light"): string[] {
  const out = seeds.slice(0, SLOTS);
  if (!out.length) return out;
  const anchor = oklch(out[0] as string);
  const chromas = out.map((s) => oklch(s).c).sort((a, b) => a - b);
  const chroma = Math.min(0.16, Math.max(0.12, chromas[Math.floor(chromas.length / 2)] as number));
  const candidates: Array<{ hex: string; seen: Seen }> = [];
  for (let k = 0; k < 12; k++) {
    const h = anchor.h + k * 30;
    const [lo, hi] = lightnessRange(chroma, h, mode);
    for (const t of [0.15, 0.5, 0.85]) {
      const hex = oklchToHex({ l: lo + t * (hi - lo), c: chroma, h });
      // A hue sRGB can only show greyish at this lightness would read as "other": skip it.
      if (oklch(hex).c >= CHROMA_FLOOR + 0.005) candidates.push({ hex, seen: seen(hex) });
    }
  }
  const chosen = out.map(seen);
  while (out.length < SLOTS) {
    const prev = chosen[chosen.length - 1] as Seen;
    let best: (typeof candidates)[number] | null = null;
    let bestScore = -Infinity;
    for (const cand of candidates) {
      if (out.includes(cand.hex)) continue;
      const neighbour = Math.min(1.25, pairScore(prev, cand.seen));
      const spread = Math.min(1.5, ...chosen.map((x) => dist(x.normal, cand.seen.normal) / NORMAL_FLOOR));
      const score = neighbour * 4 + spread * 2;
      if (score > bestScore) [best, bestScore] = [cand, score];
    }
    if (!best) break;
    out.push(best.hex);
    chosen.push(best.seen);
  }
  return improve(out, mode, { keep: seeds.length });
}

/**
 * Light-theme series colours → their dark-theme versions: each keeps its
 * hue and chroma, and its lightness moves proportionally from the light
 * band into the dark band (so lighter series stay lighter), then improve()
 * fits each to the dark background and separates any neighbours the
 * narrower band brought close.
 */
export function forDark(light: string[]): string[] {
  const [l0, l1] = BAND.light;
  const [d0, d1] = BAND.dark;
  const moved = light.map((hex) => {
    const { l, c, h } = oklch(hex);
    const t = (Math.min(l1, Math.max(l0, l)) - l0) / (l1 - l0);
    return oklchToHex({ l: d0 + t * (d1 - d0), c, h });
  });
  return improve(moved, "dark");
}

/**
 * Snap to passing. The first `keep` colours are left exactly as they are
 * (a user's own colours); every other colour keeps its hue, has its chroma
 * lifted to the floor if it reads grey, and its lightness moved into the
 * range where it sits in the theme's band and stands out on the background
 * (lightnessRange). Then lightness moves in steps of 0.01–0.08 until each
 * neighbouring pair clears the colour-blind target and the normal-vision
 * floor with a little margin, or no step helps any more. A move counts when
 * it raises the pairs' total shortfall-capped score, so with several weak
 * pairs, fixing any one of them is progress (judging by the worst pair
 * alone would stall). Among the moves that help most, the one that keeps
 * the colours closest to what was given wins; colours already clear of
 * their neighbours are not touched.
 */
export function improve(colours: string[], mode: ThemeMode, opts: { keep?: number } = {}): string[] {
  const keep = Math.min(colours.length, opts.keep ?? 0);
  const start = colours.map(oklch);
  const lch: Oklch[] = start.map((s, i) => {
    if (i < keep) return { ...s };
    const c =
      s.c < CHROMA_FLOOR + 0.01 ? Math.max(s.c, Math.min(CHROMA_FLOOR + 0.01, maxChroma(s.l, s.h))) : s.c;
    const [lo, hi] = lightnessRange(c, s.h, mode);
    let l = Math.min(hi, Math.max(lo, s.l));
    // Where sRGB can't show the floor chroma at that lightness, take the nearest lightness in range that can.
    if (c >= CHROMA_FLOOR && maxChroma(l, s.h) < CHROMA_FLOOR + 0.005) {
      const steps = Array.from({ length: 41 }, (_, k) => lo + (k / 40) * (hi - lo));
      const vivid = steps.filter((x) => maxChroma(x, s.h) >= CHROMA_FLOOR + 0.005);
      if (vivid.length) l = vivid.reduce((b, x) => (Math.abs(x - l) < Math.abs(b - l) ? x : b));
    }
    return { l, c, h: s.h };
  });
  const range = lch.map((s, i) =>
    i < keep ? ([s.l, s.l] as [number, number]) : lightnessRange(s.c, s.h, mode),
  );
  let hexes = lch.map((s, i) => (i < keep ? (colours[i] as string) : oklchToHex(s)));
  let looks = hexes.map(seen);
  if (colours.length < 2) return hexes;
  const GOAL = 1.06;
  const worstPair = (s: Seen[]) => {
    let w = Infinity;
    for (let i = 0; i + 1 < s.length; i++) w = Math.min(w, pairScore(s[i] as Seen, s[i + 1] as Seen));
    return w;
  };
  // Each pair counts up to the goal: progress on any weak pair raises the total.
  const total = (s: Seen[]) => {
    let t = 0;
    for (let i = 0; i + 1 < s.length; i++) t += Math.min(GOAL, pairScore(s[i] as Seen, s[i + 1] as Seen));
    return t;
  };
  for (let round = 0; round < 300; round++) {
    if (worstPair(looks) >= GOAL) break;
    const current = total(looks);
    let best: { i: number; l: number; score: number; drift: number } | null = null;
    for (let i = keep; i < lch.length; i++) {
      // Only a colour in a pair below the goal is worth moving.
      const weak =
        (i > 0 && pairScore(looks[i - 1] as Seen, looks[i] as Seen) < GOAL) ||
        (i + 1 < looks.length && pairScore(looks[i] as Seen, looks[i + 1] as Seen) < GOAL);
      if (!weak) continue;
      const s = lch[i] as Oklch;
      const [lo, hi] = range[i] as [number, number];
      for (const d of [-0.08, -0.05, -0.03, -0.01, 0.01, 0.03, 0.05, 0.08]) {
        const l = Math.min(hi, Math.max(lo, s.l + d));
        if (Math.abs(l - s.l) < 1e-9) continue;
        const hex = oklchToHex({ ...s, l });
        // sRGB can't hold some hues' chroma at every lightness: a move that would make the colour read grey is skipped.
        if (s.c >= CHROMA_FLOOR && oklch(hex).c < CHROMA_FLOOR) continue;
        const trial = looks.slice();
        trial[i] = seen(hex);
        const score = total(trial);
        const drift = Math.abs(l - (start[i] as Oklch).l);
        if (
          !best ||
          score > best.score + 1e-9 ||
          (Math.abs(score - best.score) <= 1e-9 && drift < best.drift)
        )
          best = { i, l, score, drift };
      }
    }
    if (!best || best.score <= current + 1e-9) break;
    (lch[best.i] as Oklch).l = best.l;
    hexes = lch.map((s, i) => (i < keep ? (colours[i] as string) : oklchToHex(s)));
    looks = hexes.map(seen);
  }
  return hexes;
}
