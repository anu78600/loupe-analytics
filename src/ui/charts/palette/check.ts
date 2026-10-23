/**
 * Readability checks for a chart palette, the same computable checks the
 * built-in palette was validated with (the data-viz validator, ported):
 * - lightness band: OKLCH L within the mode's band, so no series is too
 *   pale or too dark next to the others;
 * - chroma floor: OKLCH C ≥ 0.10, below which a colour reads as grey;
 * - colour-blind separation: OKLab ΔE×100 between neighbouring series under
 *   simulated protanopia and deuteranopia (Machado 2009): ≥ 8 passes, 6–8
 *   is a warning (fine with labels or tooltips), below 6 fails;
 * - normal-vision floor: the same pairs without simulation must be ≥ 15
 *   apart, or even full-colour readers struggle;
 * - contrast: each colour ≥ 3:1 against the chart background (WCAG 1.4.11);
 *   below that, values must be readable another way (tooltips, the table).
 * Neighbouring series are slots i and i + 1: charts assign colours in order
 * and never skip one, so only neighbours share an edge in a stack or legend.
 */
import { contrast, deltaE, oklch } from "./colour";

export type ThemeMode = "light" | "dark";
export type CheckState = "pass" | "warn" | "fail";

/**
 * The chart background each mode's palette is checked against: --surface-1 of
 * styles/theme-light.css and theme-dark.css (tests/chart-themes.test.ts keeps them equal).
 */
export const SURFACE: Record<ThemeMode, string> = { light: "#ffffff", dark: "#111318" };
/** OKLCH lightness band per mode for series colours. */
export const BAND: Record<ThemeMode, [number, number]> = { light: [0.43, 0.77], dark: [0.48, 0.67] };
export const CHROMA_FLOOR = 0.1;
export const CVD_TARGET = 8;
export const CVD_FLOOR = 6;
export const NORMAL_FLOOR = 15;
export const CONTRAST_MIN = 3;

export interface PaletteCheck {
  id: "band" | "chroma" | "cvd" | "normal" | "contrast";
  state: CheckState;
  /** One plain-English sentence for the user. */
  message: string;
  /** 0-based slots the message is about. */
  slots: number[];
}

export interface PaletteReport {
  mode: ThemeMode;
  checks: PaletteCheck[];
  /** The worst state of all checks. */
  state: CheckState;
  /** Worst neighbouring-pair ΔE under colour-blind simulation, and with normal vision. */
  worstCvd: number;
  worstNormal: number;
}

const slotList = (slots: number[]) => {
  const names = slots.map((s) => `series ${s + 1}`);
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

/**
 * Checks `colours` (series 1, 2, … in order) for one mode. Out-of-band
 * lightness and low chroma are warnings here: a brand colour may sit outside
 * the band and still work, which the other checks decide.
 */
export function checkPalette(colours: string[], mode: ThemeMode): PaletteReport {
  const surface = SURFACE[mode];
  const [lo, hi] = BAND[mode];
  const checks: PaletteCheck[] = [];
  const lch = colours.map(oklch);

  const pale = lch.flatMap((c, i) => (c.l > hi ? [i] : []));
  const deep = lch.flatMap((c, i) => (c.l < lo ? [i] : []));
  checks.push(
    pale.length || deep.length
      ? {
          id: "band",
          state: "warn",
          message: [
            pale.length ? `${slotList(pale)} ${pale.length === 1 ? "is" : "are"} paler` : "",
            deep.length ? `${slotList(deep)} ${deep.length === 1 ? "is" : "are"} darker` : "",
          ]
            .filter(Boolean)
            .join("; ")
            .concat(" than the rest of a balanced palette."),
          slots: [...pale, ...deep],
        }
      : { id: "band", state: "pass", message: "Every colour has a balanced lightness.", slots: [] },
  );

  const grey = lch.flatMap((c, i) => (c.c < CHROMA_FLOOR ? [i] : []));
  checks.push(
    grey.length
      ? {
          id: "chroma",
          state: "warn",
          message: `${slotList(grey)} ${grey.length === 1 ? "is" : "are"} close to grey, so ${grey.length === 1 ? "it reads" : "they read"} more like "other" than a series.`,
          slots: grey,
        }
      : {
          id: "chroma",
          state: "pass",
          message: "Every colour is vivid enough to read as a series.",
          slots: [],
        },
  );

  // Neighbouring pairs, worst first.
  let worstCvd = Infinity;
  let cvdPair: [number, number] = [0, 0];
  let worstNormal = Infinity;
  let normalPair: [number, number] = [0, 0];
  for (let i = 0; i + 1 < colours.length; i++) {
    const a = colours[i] as string;
    const b = colours[i + 1] as string;
    const cvd = Math.min(deltaE(a, b, "protan"), deltaE(a, b, "deutan"));
    if (cvd < worstCvd) [worstCvd, cvdPair] = [cvd, [i, i + 1]];
    const normal = deltaE(a, b);
    if (normal < worstNormal) [worstNormal, normalPair] = [normal, [i, i + 1]];
  }
  if (colours.length < 2) worstCvd = worstNormal = 100;
  checks.push(
    worstCvd >= CVD_TARGET
      ? {
          id: "cvd",
          state: "pass",
          message: "Neighbouring series stay distinct for colour-blind viewers.",
          slots: [],
        }
      : {
          id: "cvd",
          state: worstCvd >= CVD_FLOOR ? "warn" : "fail",
          message:
            worstCvd >= CVD_FLOOR
              ? `${slotList(cvdPair)} are close for colour-blind viewers; legends and tooltips still tell them apart.`
              : `${slotList(cvdPair)} look alike to colour-blind viewers.`,
          slots: cvdPair,
        },
  );
  checks.push(
    worstNormal >= NORMAL_FLOOR
      ? { id: "normal", state: "pass", message: "Neighbouring series are easy to tell apart.", slots: [] }
      : {
          id: "normal",
          state: "fail",
          message: `${slotList(normalPair)} are too similar to tell apart at a glance.`,
          slots: normalPair,
        },
  );

  const faint = colours.flatMap((c, i) => (contrast(c, surface) < CONTRAST_MIN ? [i] : []));
  checks.push(
    faint.length
      ? {
          id: "contrast",
          state: "warn",
          message: `${slotList(faint)} ${faint.length === 1 ? "is" : "are"} faint on the ${mode} background; values stay readable in tooltips and the table view.`,
          slots: faint,
        }
      : {
          id: "contrast",
          state: "pass",
          message: `Every colour stands out on the ${mode} background.`,
          slots: [],
        },
  );

  const rank: Record<CheckState, number> = { pass: 0, warn: 1, fail: 2 };
  const state = checks.reduce<CheckState>((w, c) => (rank[c.state] > rank[w] ? c.state : w), "pass");
  return { mode, checks, state, worstCvd, worstNormal };
}
