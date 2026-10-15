"use client";

/**
 * Bridge from CSS design tokens to ECharts. Canvas rendering cannot use CSS
 * variables, so colours are resolved to concrete values when an option is
 * built and must be re-read after a theme change (see useThemeKey). The
 * categorical palette is the colour-blind-validated --chart-1…8 set.
 * inkOn() picks the colour of a label drawn inside a fill by WCAG contrast,
 * never below 4.5:1.
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
  fontSans: string;
  fontMono: string;
}

// Used during server rendering and for any token the stylesheet does not define.
const FALLBACK_DARK: ChartTokens = {
  dark: true,
  palette: ["#b98b3d", "#3c79d1", "#33a998", "#7057ba", "#317f38", "#35a0cc", "#bf5914", "#934b98"],
  other: "#4a4f57",
  seq: ["#3a2a10", "#4f3912", "#6c4c10", "#866222", "#a17833", "#bd8f44", "#d9a755", "#f6c16b"],
  div: ["#86b6ef", "#4d84d6", "#2b4f80", "#30343b", "#7a5a25", "#b88a3e", "#e9c27e"],
  grid: "#1f2329",
  axis: "#2e333a",
  label: "#8a9099",
  fg: "#edeef0",
  muted: "#9ba1a9",
  subtle: "#7d838c",
  surface: "#121418",
  surface2: "#171a1f",
  border: "rgba(255,255,255,0.12)",
  tooltip: "#1a1d22",
  accent: "#d6b47a",
  success: "#3fb68b",
  danger: "#e5484d",
  warning: "#e8833a",
  fontSans: "Geist, ui-sans-serif, system-ui, sans-serif",
  fontMono: "Geist Mono, ui-monospace, monospace",
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
    fontSans: `${cs.getPropertyValue("--font-geist-sans").trim() || "Geist"}, ui-sans-serif, system-ui, sans-serif`,
    fontMono: `${cs.getPropertyValue("--font-geist-mono").trim() || "Geist Mono"}, ui-monospace, monospace`,
  };
}

/** WCAG AA contrast for normal-size text: the floor for any label drawn inside a fill. */
export const LABEL_MIN_CONTRAST = 4.5;

// Label inks for text inside a fill. These are canvas colours, not theme
// tokens: the right ink depends on the fill behind the label, not on the theme.
/** Warm near-black that sits well on the brass ramps. */
export const INK_DARK = "#14110a";
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
 * warm ink or white, whichever contrasts more with the fill. Around a relative
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
