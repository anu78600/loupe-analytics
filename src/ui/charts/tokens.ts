"use client";

/**
 * Bridge from CSS design tokens to ECharts. Canvas rendering cannot use CSS
 * variables, so colours are resolved to concrete values when an option is
 * built and must be re-read after a theme or chart-colour change (see
 * useChartThemeKey). The categorical palette is --chart-1…8: the
 * colour-blind-validated built-in set, or the user's chart theme
 * (ui/charts/palette).
 * inkOn() picks the colour of a label drawn inside a fill by WCAG contrast,
 * never below 4.5:1.
 * Chart text uses the interface face (Inter) for words and figures alike, as
 * the type system does: a canvas can't switch on tabular numerals, but a value
 * label or an axis tick stands on its own, so nothing needs to line up.
 */

/** Chart colours and chrome read from the live CSS tokens, so charts follow the active theme. */
export interface ChartTokens {
  dark: boolean;
  palette: string[];
  other: string;
  seq: string[];
  div: string[];
  grid: string;
  axis: string;
  label: string;
  fg: string;
  muted: string;
  subtle: string;
  surface: string;
  surface2: string;
  border: string;
  tooltip: string;
  accent: string;
  success: string;
  danger: string;
  warning: string;
  /**
   * Opacity of the marks a selection leaves out (cross-filtering): --chart-dim, lower in dark
   * (a faded colour still glows on dark) than on light.
   */
  dim: number;
  /** The interface face for words: titles, axis names, categories, legends. */
  fontSans: string;
  /** The face for figures (value labels, value axes, tooltip values): the same Inter. */
  fontFigures: string;
}

// Used during server rendering and for any token the stylesheet does not define: the dark theme
// (styles/theme-dark.css) with its aliases resolved, as getComputedStyle reports them.
const FALLBACK_DARK: ChartTokens = {
  dark: true,
  palette: ["#5a5be1", "#d06107", "#9d48ea", "#d31c71", "#008dc7", "#358203", "#27a598", "#a77800"],
  other: "#4a4e56",
  seq: ["#363b62", "#464c7e", "#575e9c", "#6971ba", "#7b85d9", "#8e99f9", "#a7b2ff", "#c3ccff"],
  div: ["#86b6ef", "#4d84d6", "#2b4f80", "#30333b", "#7a3d12", "#c26a2c", "#f0a46b"],
  grid: "#1e2026",
  axis: "#30333b",
  label: "#9b9fa7",
  fg: "#edeff3",
  muted: "#bbbec5",
  subtle: "#9b9fa7",
  surface: "#111318",
  surface2: "#171a1f",
  border: "rgba(255,255,255,0.13)",
  tooltip: "#25282e",
  accent: "#8995f4",
  success: "#3fb68b",
  danger: "#f06a6d",
  warning: "#e8833a",
  dim: 0.3,
  fontSans: "Inter, ui-sans-serif, system-ui, sans-serif",
  fontFigures: "Inter, ui-sans-serif, system-ui, sans-serif",
};

/**
 * Resolves the tokens via getComputedStyle on `el` (default <html>). `dark`
 * comes from the nearest data-theme ancestor. Call it when building an
 * option, never once at module load, or theme switches are missed.
 */
export function readChartTokens(el?: HTMLElement | null): ChartTokens {
  if (typeof window === "undefined") return FALLBACK_DARK;
  const host = el ?? document.documentElement;
  const cs = getComputedStyle(host);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const themed = host.closest<HTMLElement>("[data-theme]") ?? document.documentElement;
  const dark = themed.dataset.theme !== "light";
  // next/font's generated family names, then the extended-Latin subset for any character the first lacks.
  const families = [
    cs.getPropertyValue("--font-inter").trim(),
    cs.getPropertyValue("--font-inter-ext").trim(),
  ];
  const sans = `${families.filter(Boolean).join(", ") || "Inter"}, ui-sans-serif, system-ui, sans-serif`;
  return {
    dark,
    palette: Array.from({ length: 8 }, (_, i) => v(`--chart-${i + 1}`, FALLBACK_DARK.palette[i] as string)),
    other: v("--chart-other", FALLBACK_DARK.other),
    seq: Array.from({ length: 8 }, (_, i) => v(`--seq-${i + 1}`, FALLBACK_DARK.seq[i] as string)),
    div: Array.from({ length: 7 }, (_, i) => v(`--div-${i + 1}`, FALLBACK_DARK.div[i] as string)),
    grid: v("--chart-grid", FALLBACK_DARK.grid),
    axis: v("--chart-axis", FALLBACK_DARK.axis),
    label: v("--chart-label", FALLBACK_DARK.label),
    fg: v("--fg", FALLBACK_DARK.fg),
    muted: v("--fg-muted", FALLBACK_DARK.muted),
    subtle: v("--fg-subtle", FALLBACK_DARK.subtle),
    surface: v("--surface-1", FALLBACK_DARK.surface),
    surface2: v("--surface-2", FALLBACK_DARK.surface2),
    border: v("--border-strong", FALLBACK_DARK.border),
    tooltip: v("--chart-tooltip", FALLBACK_DARK.tooltip),
    accent: v("--accent", FALLBACK_DARK.accent),
    success: v("--success", FALLBACK_DARK.success),
    danger: v("--danger", FALLBACK_DARK.danger),
    warning: v("--warning", FALLBACK_DARK.warning),
    dim: opacity(cs.getPropertyValue("--chart-dim"), FALLBACK_DARK.dim),
    fontSans: sans,
    fontFigures: sans,
  };
}

/** A number token (an opacity, 0–1) read from CSS, or the fallback when it is missing or not a fraction. */
function opacity(value: string, fallback: number): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

/** WCAG AA contrast for normal-size text: the floor for any label drawn inside a fill. */
export const LABEL_MIN_CONTRAST = 4.5;

// Label inks for text inside a fill. These are canvas colours, not theme
// tokens: the right ink depends on the fill behind the label, not on the theme.
/** Blue-black that sits well on the indigo ramps. */
export const INK_DARK = "#0b0d12";
export const INK_LIGHT = "#ffffff";
/** Last resort for mid-tone fills, where neither ink above reaches 4.5:1. */
export const INK_BLACK = "#000000";

/** WCAG relative luminance (0–1) of a #rrggbb colour; null for any other syntax. */
export function relativeLuminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1] as string, 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** WCAG contrast ratio (1–21) between two relative luminances, in either order. */
export function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Label colour for text inside a coloured fill (treemap tiles, funnel stages),
 * chosen by the actual contrast ratios rather than a luminance cut-off: the
 * dark ink or white, whichever contrasts more with the fill. Around a relative
 * luminance of 0.18 neither reaches 4.5:1; pure black then does (when white
 * falls short of 4.5:1, black always clears about 4.58:1), so a label never
 * drops below AA. Non-hex input returns the theme foreground.
 */
export function inkOn(hex: string, tokens: ChartTokens): string {
  const fill = relativeLuminance(hex);
  if (fill === null) return tokens.fg;
  const dark = contrastRatio(fill, relativeLuminance(INK_DARK) as number);
  const light = contrastRatio(fill, 1);
  if (Math.max(dark, light) >= LABEL_MIN_CONTRAST) return dark >= light ? INK_DARK : INK_LIGHT;
  return INK_BLACK;
}

/** `#rrggbb` → `rgba(…, alpha)`. Any other format (rgba(), 3-digit hex, names) is returned unchanged, without the alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1] as string, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
