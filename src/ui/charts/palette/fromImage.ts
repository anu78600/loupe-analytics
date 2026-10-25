/**
 * Brand colours from an image (version 52.0): a logo or a page of a brand
 * guide that the user picks in "Your colours". The image is read in the
 * browser, on a canvas, and never leaves it.
 *
 * coloursFromPixels groups the pixels by colour (in OKLab, so near shades of
 * one colour fall together) and returns the most used, most prominent first,
 * each far enough from the ones before it to tell apart. White, black and
 * greys are left out, since a logo's background and lettering are rarely the
 * brand colour and make poor chart series; transparent pixels are too. A
 * colour must cover at least MIN_SHARE of the coloured pixels, so the
 * anti-aliased edge of a letter is never a series of its own.
 */
import { oklab, oklchToHex, rgbToHex, type Oklab } from "./colour";

/** The image is drawn at most this many pixels wide or high: plenty to find a logo's colours. */
const SIDE = 96;
/** Below this chroma a pixel is white, black or grey. */
const MIN_CHROMA = 0.04;
/** A colour must cover at least this share of the coloured pixels. */
const MIN_SHARE = 0.015;
/** Two colours closer than this (OKLab distance) count as one. */
const MIN_DISTANCE = 0.09;

/** The main colours of RGBA pixel data, most used first; at most `max`. */
export function coloursFromPixels(data: ArrayLike<number>, max = 6): string[] {
  const buckets = new Map<string, { n: number; l: number; a: number; b: number }>();
  const seen = new Map<number, Oklab | null>();
  let total = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if ((data[i + 3] as number) < 128) continue;
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;
    const packed = (r << 16) | (g << 8) | b;
    let lab = seen.get(packed);
    if (lab === undefined) {
      const c = oklab(rgbToHex([r / 255, g / 255, b / 255]));
      lab = Math.hypot(c[1], c[2]) < MIN_CHROMA ? null : c;
      seen.set(packed, lab);
    }
    if (!lab) continue;
    total++;
    const key = `${Math.round(lab[0] / 0.06)}:${Math.round(lab[1] / 0.03)}:${Math.round(lab[2] / 0.03)}`;
    const k = buckets.get(key) ?? { n: 0, l: 0, a: 0, b: 0 };
    k.n++;
    k.l += lab[0];
    k.a += lab[1];
    k.b += lab[2];
    buckets.set(key, k);
  }
  const picked: Oklab[] = [];
  const out: string[] = [];
  for (const k of [...buckets.values()].sort((x, y) => y.n - x.n)) {
    if (out.length >= max || k.n < MIN_SHARE * total) break;
    const c: Oklab = [k.l / k.n, k.a / k.n, k.b / k.n];
    if (picked.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < MIN_DISTANCE)) continue;
    picked.push(c);
    out.push(
      oklchToHex({
        l: c[0],
        c: Math.hypot(c[1], c[2]),
        h: ((Math.atan2(c[2], c[1]) * 180) / Math.PI + 360) % 360,
      }),
    );
  }
  return out;
}

/** The main colours of an image file (PNG, JPEG, WebP, GIF or SVG), read in the browser. */
export async function coloursFromImage(file: Blob, max = 6): Promise<string[]> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // An SVG without a size of its own reports 0: it is drawn at the full side.
    const w = img.naturalWidth || SIDE;
    const h = img.naturalHeight || SIDE;
    const scale = Math.min(1, SIDE / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return coloursFromPixels(ctx.getImageData(0, 0, canvas.width, canvas.height).data, max);
  } finally {
    URL.revokeObjectURL(url);
  }
}
