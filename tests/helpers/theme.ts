/**
 * The design tokens of each theme as the browser resolves them, for the theme
 * tests: src/styles/theme-light.css or theme-dark.css, with every var() alias
 * followed through to primitives.css. Also the colour maths the tests grade
 * them with (WCAG 2 contrast, APCA Lc, OKLCH lightness, alpha compositing),
 * written out here rather than imported from the app, so a test doesn't grade
 * the code with itself.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Mode = "light" | "dark";
export const MODES: Mode[] = ["light", "dark"];

/** A stylesheet from src/styles without its comments (they quote values and figures). */
function readStyles(file: string): string {
  return readFileSync(join(process.cwd(), "src", "styles", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The custom properties declared in some CSS, by name without the dashes, values on one line. */
function declarations(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of css.matchAll(/--([\w-]+):\s*([^;]+);/g))
    if (name && value) out[name] = value.replace(/\s+/g, " ").trim();
  return out;
}

/** The --base-* primitives (and --base-white), unresolved: every one is a literal value. */
export function primitives(): Record<string, string> {
  return declarations(readStyles("primitives.css"));
}

/** One theme file's own declarations, aliases left as written. */
export function themeDeclarations(mode: Mode): Record<string, string> {
  return declarations(readStyles(`theme-${mode}.css`));
}

/**
 * One theme's tokens with every var() resolved (as the browser computes them on
 * an element of that theme). An alias that points at nothing is left as var(…),
 * which the tests catch.
 */
export function themeTokens(mode: Mode): Record<string, string> {
  const all = { ...primitives(), ...themeDeclarations(mode) };
  const resolve = (value: string, depth = 0): string =>
    depth > 8
      ? value
      : value.replace(/var\(--([\w-]+)\)/g, (whole, name: string) =>
          all[name] === undefined ? whole : resolve(all[name] as string, depth + 1),
        );
  const out: Record<string, string> = {};
  for (const name of Object.keys(themeDeclarations(mode))) out[name] = resolve(all[name] as string);
  return out;
}

type Rgba = { rgb: [number, number, number]; a: number };

/** "#rrggbb", "#rgb", "rgb(r g b / a)" or "rgba(r, g, b, a)" → 0–255 channels and alpha; null otherwise. */
export function parseColour(value: string): Rgba | null {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = (hex[1] as string).length === 3 ? [...(hex[1] as string)].map((c) => c + c).join("") : hex[1];
    const n = parseInt(h as string, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a: 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+))?\s*\)$/.exec(v);
  if (rgb) return { rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])], a: rgb[4] ? Number(rgb[4]) : 1 };
  return null;
}

const toHex = (rgb: number[]) =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** A colour as the solid #rrggbb it shows: translucent values are laid over `under` (a solid colour). */
export function solid(value: string, under = "#000000"): string {
  const c = parseColour(value);
  if (!c) throw new Error(`Not a colour: ${value}`);
  if (c.a >= 1) return toHex(c.rgb);
  const base = parseColour(under);
  if (!base) throw new Error(`Not a colour: ${under}`);
  return toHex(c.rgb.map((ch, i) => ch * c.a + (base.rgb[i] as number) * (1 - c.a)));
}

const channels = (hex: string) => (parseColour(hex) as Rgba).rgb.map((c) => c / 255);
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG 2 relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1–21, either order. */
export function wcag(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/**
 * APCA Lc (APCA-W3 0.0.98G-4g) of `text` on `background`: about 0–106 for
 * dark text on light, about 0 to −108 for light text on dark. Tests compare
 * the absolute value.
 */
export function apca(text: string, background: string): number {
  const y = (hex: string) => {
    const [r, g, b] = channels(hex) as [number, number, number];
    const v = 0.2126729 * r ** 2.4 + 0.7151522 * g ** 2.4 + 0.072175 * b ** 2.4;
    return v < 0.022 ? v + (0.022 - v) ** 1.414 : v;
  };
  const yt = y(text);
  const yb = y(background);
  if (Math.abs(yb - yt) < 0.0005) return 0;
  if (yb > yt) {
    const s = (yb ** 0.56 - yt ** 0.57) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  const s = (yb ** 0.65 - yt ** 0.62) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}

/** OKLCH lightness ×100 (0–100), the scale the design talks in ("7 L apart"). */
export function lightness(hex: string): number {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 100 * (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s);
}
