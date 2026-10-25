/**
 * Colour maths for chart themes, on #rrggbb strings:
 * - sRGB ↔ OKLab ↔ OKLCH (Björn Ottosson's OKLab, the space the palette
 *   checks and generators work in, because equal steps there look equal);
 * - gamut mapping: an OKLCH colour sRGB can't show keeps its lightness and
 *   hue and loses chroma until it fits;
 * - colour-vision-deficiency simulation (Machado, Oliveira & Fernandes 2009,
 *   severity 1.0, the model the check thresholds are calibrated to);
 * - OKLab ΔE (Euclidean distance ×100) and WCAG contrast.
 * Pure and unit-tested (tests/chart-themes.test.ts); check.ts holds the
 * thresholds and themes.ts the generators built on these.
 */

/** sRGB channels, 0–1. */
export type Rgb = [number, number, number];
/** OKLab: lightness 0–1 and the two opponent axes. */
export type Oklab = [number, number, number];
/** OKLCH: lightness 0–1, chroma (0 to about 0.37 in sRGB) and hue in degrees. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}
export type CvdKind = "protan" | "deutan" | "tritan";

/**
 * "#abc", "abc", "#AABBCC" or "aabbcc" (outer spaces allowed) → "#aabbcc";
 * null for anything else. The one door user input goes through, so no NaN
 * ever reaches the maths below.
 */
export function normaliseHex(input: string): string | null {
  const m = /^\s*#?([0-9a-f]{3}|[0-9a-f]{6})\s*$/i.exec(input);
  if (!m) return null;
  const h = (m[1] as string).toLowerCase();
  return `#${h.length === 3 ? [...h].map((c) => c + c).join("") : h}`;
}

/**
 * Every colour code in a piece of text, in order and without repeats, so a
 * list copied from a brand guide ("Navy #1D4ED8 · Gold #F59E0B") can be
 * pasted whole. A code without "#" counts only when it has a digit, so words
 * such as "decade" or "facade" are never read as colours.
 */
export function hexesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(#)?\b([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    if (!m[1] && !/\d/.test(m[2] as string)) continue;
    const hex = normaliseHex(m[2] as string);
    if (hex && !out.includes(hex)) out.push(hex);
  }
  return out;
}

/** #rrggbb → sRGB 0–1. Call with normalised hex only. */
export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1, 7), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** sRGB 0–1 (clamped) → #rrggbb. */
export function rgbToHex(rgb: Rgb): string {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** Linear-light sRGB of a #rrggbb colour. */
export function linearRgb(hex: string): Rgb {
  return hexToRgb(hex).map(toLinear) as Rgb;
}

export function oklabFromLinear([r, g, b]: Rgb): Oklab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Linear sRGB of an OKLab colour; channels outside 0–1 mean it is out of gamut. */
export function linearFromOklab([L, a, b]: Oklab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function oklab(hex: string): Oklab {
  return oklabFromLinear(linearRgb(hex));
}

export function oklch(hex: string): Oklch {
  const [l, a, b] = oklab(hex);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return { l, c: Math.hypot(a, b), h: h < 0 ? h + 360 : h };
}

const labOf = ({ l, c, h }: Oklch): Oklab => {
  const r = (h * Math.PI) / 180;
  return [l, c * Math.cos(r), c * Math.sin(r)];
};
const fits = (rgb: Rgb) => rgb.every((v) => v >= -1e-6 && v <= 1 + 1e-6);

/**
 * OKLCH → #rrggbb. Lightness is clamped to 0–1; a colour sRGB can't show
 * keeps its lightness and hue and drops chroma (binary search) until it fits.
 */
export function oklchToHex(colour: Oklch): string {
  const l = Math.min(1, Math.max(0, colour.l));
  const h = ((colour.h % 360) + 360) % 360;
  let c = Math.max(0, colour.c);
  let rgb = linearFromOklab(labOf({ l, c, h }));
  if (!fits(rgb)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(linearFromOklab(labOf({ l, c: mid, h })))) lo = mid;
      else hi = mid;
    }
    c = lo;
    rgb = linearFromOklab(labOf({ l, c, h }));
  }
  return rgbToHex(rgb.map((v) => toGamma(Math.min(1, Math.max(0, v)))) as Rgb);
}

/** Highest chroma sRGB can show at this lightness and hue. */
export function maxChroma(l: number, h: number): number {
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (fits(linearFromOklab(labOf({ l, c: mid, h })))) lo = mid;
    else hi = mid;
  }
  return lo;
}

// Machado, Oliveira & Fernandes (2009) dichromacy transforms at severity 1.0, on linear RGB.
const MACHADO: Record<CvdKind, [Rgb, Rgb, Rgb]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** Linear RGB of `hex` as a viewer with this colour-vision deficiency sees it. */
export function simulateCvd(hex: string, kind: CvdKind): Rgb {
  const [r, g, b] = linearRgb(hex);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return MACHADO[kind].map(([x, y, z]) => clamp(x * r + y * g + z * b)) as Rgb;
}

/** OKLab distance ×100 between two colours, as seen with normal vision or the given deficiency. */
export function deltaE(a: string, b: string, kind?: CvdKind): number {
  const p = oklabFromLinear(kind ? simulateCvd(a, kind) : linearRgb(a));
  const q = oklabFromLinear(kind ? simulateCvd(b, kind) : linearRgb(b));
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** WCAG relative luminance (0–1). */
export function luminance(hex: string): number {
  const [r, g, b] = linearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1–21) between two colours, in either order. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
