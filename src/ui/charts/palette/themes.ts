/**
 * Chart themes: what the user chose for chart colours, resolved to concrete
 * colours for both the light and the dark theme, the CSS that applies them,
 * and the Power BI report theme that carries them into the export.
 *
 * A choice is one of three kinds:
 * - a preset: fixed palettes, each passing every readability check of
 *   check.ts in both themes (tests/chart-themes.test.ts holds them to it);
 * - "custom": the user's own colours (1–8, kept exactly in the light theme),
 *   with the remaining series filled by matching colours;
 * - "single": one colour, turned into shades of itself (a gradient) or into
 *   a set of matching colours.
 * Every theme also gets a gradient (sequential ramp) from its first colour,
 * for heatmaps, cohort grids, the RFM treemap and funnels. Dark-theme
 * colours keep the light ones' hues, moved in lightness to suit the dark
 * background (generate.ts forDark).
 *
 * The built-in "Loupe" preset is the stylesheet itself (styles/theme-light.css
 * and theme-dark.css): choosing it removes any override, so the default never
 * drifts from the stylesheet.
 */
import { normaliseHex } from "./colour";
import { forDark, matchingFrom, rampFrom, shadesFrom, SLOTS } from "./generate";
import type { ThemeMode } from "./check";

export type ChartThemeChoice =
  | { kind: "preset"; id: string }
  | { kind: "custom"; colours: string[] }
  | { kind: "single"; colour: string; style: SingleStyle };
/** "shades": a gradient of the colour itself; "matching": different hues built around it. */
export type SingleStyle = "shades" | "matching";

export const DEFAULT_CHART_THEME: ChartThemeChoice = { kind: "preset", id: "loupe" };

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  light: string[];
  dark: string[];
}

/**
 * The presets, series 1 → 8 per theme. Each was designed with the generators
 * (seed hues, the order with the widest margins, improve() and forDark()),
 * then fixed here so a preset never changes under the user. "loupe" mirrors
 * --chart-1…8 of styles/theme-light.css and theme-dark.css.
 */
export const PRESETS: ThemePreset[] = [
  {
    id: "loupe",
    name: "Loupe",
    description: "The default: indigo first, then clear, balanced hues.",
    light: ["#5b5ce2", "#e57429", "#a855f7", "#db2777", "#009dde", "#348100", "#27a497", "#b8860b"],
    dark: ["#5a5be1", "#d06107", "#9d48ea", "#d31c71", "#008dc7", "#358203", "#27a598", "#a77800"],
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Blues and teals with a warm coral accent.",
    light: ["#1f6fd1", "#e0703a", "#009488", "#bd8a2c", "#6d5bd0", "#2f8a4a", "#369cd5", "#b45a83"],
    dark: ["#1e6ed0", "#cd5f27", "#139286", "#ab7912", "#6c5acf", "#2c8747", "#208cc4", "#ae547d"],
  },
  {
    id: "forest",
    name: "Forest",
    description: "Greens and earth tones: calm and natural.",
    light: ["#2a7e4e", "#7a5aa6", "#c0782b", "#0b9e90", "#a3514b", "#8a9a2c", "#497fbc", "#b08d2e"],
    dark: ["#2c8050", "#7b5ba7", "#b36c1a", "#059285", "#9c4a44", "#7c8b16", "#4379b6", "#a07d18"],
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "Warm oranges, pinks and purples.",
    light: ["#e0662c", "#6a4fa0", "#bb8c00", "#c23b6b", "#3f7fd0", "#d27c6e", "#8a4fc6", "#b8701c"],
    dark: ["#cf5718", "#7055a7", "#a77c00", "#bf3869", "#3878c9", "#be6a5d", "#894ec5", "#ae670b"],
  },
  {
    id: "vivid",
    name: "Vivid",
    description: "Bright, high-energy hues for presentations.",
    light: ["#2f6fdf", "#59a14f", "#a259c8", "#dd7a00", "#11a39a", "#cc4348", "#b98d00", "#e8689a"],
    dark: ["#2c6cdc", "#4c9342", "#9b52c0", "#c46b00", "#07968e", "#bc343c", "#a57d00", "#d25487"],
  },
  {
    id: "corporate",
    name: "Corporate",
    description: "Navy and steel blues with a few accents, for formal reports.",
    light: ["#22518f", "#dd7936", "#4d99d7", "#c75a7a", "#3d6fb5", "#8f9a2c", "#7a6cc4", "#119284"],
    dark: ["#3464a3", "#c9671f", "#3c89c6", "#bd5171", "#3d6fb5", "#808b15", "#7567be", "#129182"],
  },
  {
    id: "safe",
    name: "Colour-blind safe",
    description: "Built on the Okabe–Ito colours, with the widest colour-blind margins.",
    light: ["#0072b2", "#c58700", "#cc79a7", "#a09600", "#3c9cd0", "#d55e00", "#7a5195", "#009e73"],
    dark: ["#0474b4", "#af7800", "#b86794", "#8f8600", "#288cbf", "#c55700", "#7f559a", "#00926a"],
  },
];

/** --seq-1…8 of styles/theme-light.css and theme-dark.css, the built-in accent gradient. */
const LOUPE_RAMP: Record<ThemeMode, string[]> = {
  light: ["#c4ccff", "#aab4fd", "#929df6", "#7d87eb", "#6971db", "#585dc5", "#484bac", "#393b8e"],
  dark: ["#363b62", "#464c7e", "#575e9c", "#6971ba", "#7b85d9", "#8e99f9", "#a7b2ff", "#c3ccff"],
};

export interface ThemeColours {
  /** Series 1 → 8. */
  series: string[];
  /** Gradient steps 1 → 8; step 1 sits next to the background. */
  ramp: string[];
}

export interface ResolvedTheme {
  /** Changes whenever any colour does: the attribute value that tells charts to redraw. */
  key: string;
  name: string;
  /** The stylesheet's own palette: nothing to override. */
  builtIn: boolean;
  light: ThemeColours;
  dark: ThemeColours;
  /** Series colours the user gave ("custom"); the rest were filled in. 0 for other kinds. */
  given: number;
}

/** FNV-1a over the colours, base 36: short and stable. */
function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function themed(name: string, kind: string, light: string[], dark: string[], given = 0): ResolvedTheme {
  const first = light[0] as string;
  const lightRamp = rampFrom(first, "light");
  const darkRamp = rampFrom(first, "dark");
  const all = [...light, ...dark, ...lightRamp, ...darkRamp].join("");
  return {
    key: `${kind}-${hashOf(all)}`,
    name,
    builtIn: false,
    light: { series: light, ramp: lightRamp },
    dark: { series: dark, ramp: darkRamp },
    given,
  };
}

/** The concrete colours of a choice. An unknown preset falls back to Loupe; invalid colours are dropped. */
export function resolveTheme(choice: ChartThemeChoice): ResolvedTheme {
  if (choice.kind === "custom") {
    const given = choice.colours
      .map(normaliseHex)
      .filter((c): c is string => c !== null)
      .slice(0, SLOTS);
    if (given.length) {
      const light = matchingFrom(given, "light");
      return themed("Your colours", "custom", light, forDark(light), given.length);
    }
  } else if (choice.kind === "single") {
    const colour = normaliseHex(choice.colour);
    if (colour) {
      if (choice.style === "shades")
        return themed(
          `Shades of ${colour}`,
          "shades",
          shadesFrom(colour, "light"),
          shadesFrom(colour, "dark"),
        );
      const light = matchingFrom([colour], "light");
      return themed(`Built around ${colour}`, "matching", light, forDark(light));
    }
  } else {
    const preset = PRESETS.find((p) => p.id === choice.id);
    if (preset && preset.id !== "loupe")
      return { ...themed(preset.name, preset.id, preset.light, preset.dark) };
  }
  const loupe = PRESETS[0] as ThemePreset;
  return {
    key: "loupe",
    name: loupe.name,
    builtIn: true,
    light: { series: loupe.light, ramp: LOUPE_RAMP.light },
    dark: { series: loupe.dark, ramp: LOUPE_RAMP.dark },
    given: 0,
  };
}

/**
 * A stored or saved choice (localStorage, a config file) made safe: unknown
 * shapes become the default, colours are normalised, at most 8 are kept.
 */
export function sanitiseChoice(input: unknown): ChartThemeChoice {
  if (!input || typeof input !== "object") return DEFAULT_CHART_THEME;
  const o = input as Record<string, unknown>;
  if (o.kind === "preset" && typeof o.id === "string" && PRESETS.some((p) => p.id === o.id))
    return { kind: "preset", id: o.id };
  if (o.kind === "custom" && Array.isArray(o.colours)) {
    const colours = o.colours
      .map((c) => (typeof c === "string" ? normaliseHex(c) : null))
      .filter((c): c is string => c !== null)
      .slice(0, SLOTS);
    if (colours.length) return { kind: "custom", colours };
  }
  if (o.kind === "single" && typeof o.colour === "string") {
    const colour = normaliseHex(o.colour);
    if (colour) return { kind: "single", colour, style: o.style === "matching" ? "matching" : "shades" };
  }
  return DEFAULT_CHART_THEME;
}

/** True when two choices give the same colours. */
export function sameChoice(a: ChartThemeChoice, b: ChartThemeChoice): boolean {
  return JSON.stringify(sanitiseChoice(a)) === JSON.stringify(sanitiseChoice(b));
}

/** CSS custom properties for one theme's colours (the names the theme stylesheets define). */
function declarations(c: ThemeColours): string {
  return [
    ...c.series.map((v, i) => `--chart-${i + 1}:${v}`),
    ...c.ramp.map((v, i) => `--seq-${i + 1}:${v}`),
    `--chart-spark:${c.series[0]}`,
  ].join(";");
}

/**
 * The stylesheet that applies a theme: the chart colours of the theme
 * stylesheets (styles/theme-dark.css, theme-light.css) redefined for the
 * dark theme (the default) and the light one, wherever either is set: on
 * <html> or on an element that forces a theme, such as the light report
 * rendered for a PDF. The selectors carry one more attribute than the theme
 * stylesheets', so they win whatever the order of the stylesheets, and only
 * apply while <html> carries data-chart-theme. Empty for the built-in palette.
 */
export function themeCss(theme: ResolvedTheme): string {
  if (theme.builtIn) return "";
  const dark = `:root[data-chart-theme],:root[data-chart-theme][data-theme="dark"],:root[data-chart-theme] [data-theme="dark"]`;
  const light = `:root[data-chart-theme][data-theme="light"],:root[data-chart-theme] [data-theme="light"]`;
  return `${dark}{${declarations(theme.dark)}}\n${light}{${declarations(theme.light)}}\n`;
}

/**
 * A Power BI report theme (JSON) with the light theme's colours: the series
 * colours as dataColors, the first as table accent, and the gradient's ends
 * and middle as the minimum, centre and maximum of colour scales. Applied in
 * Power BI Desktop with View → Themes → Browse for themes.
 */
export function powerBiTheme(theme: ResolvedTheme): string {
  const { series, ramp } = theme.light;
  return `${JSON.stringify(
    {
      // "Loupe" alone for the house theme, never "Loupe · Loupe".
      name: theme.name === "Loupe" ? "Loupe" : `Loupe · ${theme.name}`,
      dataColors: series,
      background: "#FFFFFF",
      foreground: "#14171C",
      tableAccent: series[0],
      minimum: ramp[1],
      center: ramp[4],
      maximum: ramp[7],
    },
    null,
    2,
  )}\n`;
}
