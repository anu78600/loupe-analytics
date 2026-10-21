/**
 * The two themes (version 48.0), each designed on its own terms, held to the
 * contrast they were designed for. Tokens come from src/styles (theme-light.css,
 * theme-dark.css, primitives.css) with their aliases resolved, as the browser
 * computes them; tests/helpers/theme.ts holds the maths (WCAG 2 and APCA).
 *
 * Per theme, on every plane text sits on (canvas, surface-1/2/3 and the
 * overlay plane):
 * - primary text ≥ 12:1 and |Lc| ≥ 90, muted ≥ 7:1 and |Lc| ≥ 60, subtle
 *   ≥ 4.5:1 and |Lc| ≥ 45, each text level at least 7 OKLCH L from the next,
 *   and disabled text still readable (≥ 3:1) but below subtle;
 * - the focus colour ≥ 3:1 against every plane; accent text ≥ 4.5:1 on the
 *   canvas, the card, the overlay and its tint; the accent's own ink ≥ 4.5:1
 *   on it (at rest, hovered, pressed); each status text ≥ 4.5:1 on its tint
 *   and on the card, and the fills too while chips set text in them; every
 *   code colour ≥ 4.5:1 in the code well;
 * - states: hover at least 3 OKLCH L off every plane, pressed and selected
 *   each stronger, with muted (and on hover subtle) text still readable;
 * - controls: the well (--surface-inset) below every plane it sits on, the
 *   raised key (--surface-raised-control) ≥ 4 L out of it, a raised button
 *   never darker than its plane, and labels ≥ 7:1;
 * - depth: dark planes lighter at each level (≥ 1.5 L a step, the overlay
 *   ≥ 3 L above surface-2); light cards lighter than the canvas and wells
 *   darker;
 * - the sequential ramp's first step visible on the card (≥ 1.5:1).
 * And the structure that keeps it true: both themes define the same names,
 * every alias resolves, primitives are hex a minifier can't shorten (ECharts
 * and inkOn read #rrggbb), components never name a primitive, and the social
 * image reads the same dark colours.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { darkColours } from "@/app/brand-art";
import {
  apca,
  lightness,
  MODES,
  primitives,
  solid,
  themeDeclarations,
  themeTokens,
  wcag,
  type Mode,
} from "./helpers/theme";

const PLANES = ["bg", "surface-1", "surface-2", "surface-3", "surface-overlay"] as const;
const STATUSES = ["success", "warning", "danger", "info"] as const;

/** A theme's tokens as solid colours: anything translucent is laid over surface-1, where it usually sits. */
function solids(mode: Mode) {
  const t = themeTokens(mode);
  const card = solid(t["surface-1"] as string);
  return (name: string) => {
    const value = t[name];
    if (value === undefined) throw new Error(`--${name} is missing from the ${mode} theme`);
    return solid(value, card);
  };
}

describe.each(MODES)("the %s theme", (mode) => {
  const c = solids(mode);

  it.each([
    ["fg", 12, 90],
    ["fg-muted", 7, 60],
    ["fg-subtle", 4.5, 45],
  ] as const)("sets --%s at ≥ %s:1 and |Lc| ≥ %s on every plane", (token, ratio, lc) => {
    for (const plane of PLANES) {
      expect(wcag(c(token), c(plane)), `${token} on ${plane}`).toBeGreaterThanOrEqual(ratio);
      expect(Math.abs(apca(c(token), c(plane))), `${token} on ${plane} (APCA)`).toBeGreaterThanOrEqual(lc);
    }
  });

  it("keeps the text levels at least 7 OKLCH L apart", () => {
    const levels = ["fg", "fg-muted", "fg-subtle", "fg-disabled"].map((t) => lightness(c(t)));
    for (let i = 1; i < levels.length; i++)
      expect(
        Math.abs((levels[i] as number) - (levels[i - 1] as number)),
        `level ${i} to ${i + 1}`,
      ).toBeGreaterThanOrEqual(7);
  });

  it("keeps disabled text readable (≥ 3:1) and below subtle", () => {
    for (const plane of PLANES) {
      const disabled = wcag(c("fg-disabled"), c(plane));
      expect(disabled, plane).toBeGreaterThanOrEqual(3);
      expect(disabled, plane).toBeLessThan(wcag(c("fg-subtle"), c(plane)));
    }
  });

  it("draws the focus ring at ≥ 3:1 against every plane", () => {
    for (const plane of ["bg-subtle", ...PLANES])
      expect(wcag(c("focus"), c(plane)), plane).toBeGreaterThanOrEqual(3);
    // Until every control draws --focus, some still ring themselves with --accent-ring.
    for (const plane of ["bg", "surface-1", "surface-2"])
      expect(
        wcag(solid(themeTokens(mode)["accent-ring"] as string, c(plane)), c(plane)),
        plane,
      ).toBeGreaterThanOrEqual(3);
  });

  it("keeps accent text and the accent's ink readable", () => {
    // The selected tint too: a chosen pill sets its label in accent text (the glossary's levels).
    for (const plane of ["bg", "surface-1", "surface-overlay", "accent-soft", "surface-selected"])
      expect(wcag(c("accent-text"), c(plane)), plane).toBeGreaterThanOrEqual(4.5);
    for (const fill of ["accent", "accent-hover", "accent-active"])
      expect(wcag(c("accent-fg"), c(fill)), fill).toBeGreaterThanOrEqual(4.5);
  });

  it.each(STATUSES)("keeps --%s-text readable on its tint and on the card", (status) => {
    expect(wcag(c(`${status}-text`), c(`${status}-soft`))).toBeGreaterThanOrEqual(4.5);
    expect(wcag(c(`${status}-text`), c("surface-1"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the fills readable as text on their own tints, as chips still set them", () => {
    for (const fill of ["accent", ...STATUSES])
      expect(wcag(c(fill), c(`${fill}-soft`)), fill).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every code colour at ≥ 4.5:1 on the code well (--bg-subtle)", () => {
    for (const kind of ["keyword", "function", "name", "string", "number", "comment"])
      expect(wcag(c(`code-${kind}`), c("bg-subtle")), kind).toBeGreaterThanOrEqual(4.5);
  });

  /** A token laid over a plane: translucent state layers and control surfaces sit on whatever holds them. */
  const over = (token: string, plane: string) => solid(themeTokens(mode)[token] as string, c(plane));

  it("makes hover, pressed and selected visible on every plane, and keeps text readable on them", () => {
    for (const plane of ["bg", "surface-1", "surface-2", "surface-overlay"]) {
      const step = (token: string) => Math.abs(lightness(c(plane)) - lightness(over(token, plane)));
      // A highlighted row in a menu or the command palette shows at a glance (light's 4 % ink was 2.7 L).
      expect(step("surface-hover"), `hover on ${plane}`).toBeGreaterThanOrEqual(3);
      expect(step("surface-active"), `pressed on ${plane}`).toBeGreaterThan(step("surface-hover") + 1.5);
      expect(step("surface-selected"), `selected on ${plane}`).toBeGreaterThan(step("surface-hover"));
      for (const state of ["surface-hover", "surface-active", "surface-selected"])
        expect(
          wcag(c("fg-muted"), over(state, plane)),
          `muted on ${state} over ${plane}`,
        ).toBeGreaterThanOrEqual(4.5);
      expect(
        wcag(c("fg-subtle"), over("surface-hover", plane)),
        `subtle on hover over ${plane}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("sets a control's well into every plane and raises its key out of it", () => {
    for (const plane of ["bg", "surface-1", "surface-2", "surface-overlay"]) {
      const well = over("surface-inset", plane);
      const key = solid(themeTokens(mode)["surface-raised-control"] as string, well);
      const button = over("surface-raised-control", plane);
      expect(lightness(well), `the well below ${plane}`).toBeLessThan(lightness(c(plane)));
      expect(lightness(key) - lightness(well), `the key out of its well on ${plane}`).toBeGreaterThanOrEqual(
        4,
      );
      expect(lightness(button), `a raised button never sunk into ${plane}`).toBeGreaterThanOrEqual(
        lightness(c(plane)),
      );
      expect(wcag(c("fg"), key), `the key's label on ${plane}`).toBeGreaterThanOrEqual(7);
      expect(wcag(c("fg"), button), `a raised button's label on ${plane}`).toBeGreaterThanOrEqual(7);
      expect(wcag(c("fg-subtle"), well), `an option's label in the well on ${plane}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("starts the sequential ramp visibly on the card", () => {
    expect(wcag(c("seq-1"), c("surface-1"))).toBeGreaterThanOrEqual(1.5);
    const ls = Array.from({ length: 8 }, (_, i) => lightness(c(`seq-${i + 1}`)));
    // Low to high: lighter to darker on paper, darker to lighter on graphite.
    for (let i = 1; i < ls.length; i++)
      if (mode === "light") expect(ls[i]).toBeLessThan(ls[i - 1] as number);
      else expect(ls[i]).toBeGreaterThan(ls[i - 1] as number);
  });
});

describe("depth", () => {
  it("raises each dark plane at least 1.5 L above the last, the overlay clearly the lightest", () => {
    const c = solids("dark");
    const ls = PLANES.map((p) => lightness(c(p)));
    for (let i = 1; i < ls.length; i++)
      expect(
        (ls[i] as number) - (ls[i - 1] as number),
        `${PLANES[i - 1]} → ${PLANES[i]}`,
      ).toBeGreaterThanOrEqual(1.5);
    expect(ls[4] as number).toBeGreaterThanOrEqual((ls[2] as number) + 3);
    // The sunken tint is deeper than the canvas, and nothing is pure black.
    expect(lightness(c("bg-subtle"))).toBeLessThan(ls[0] as number);
    expect(c("bg-subtle")).not.toBe("#000000");
  });

  it("puts light cards above the paper and wells below it", () => {
    const c = solids("light");
    expect(lightness(c("surface-1"))).toBeGreaterThan(lightness(c("bg")));
    expect(lightness(c("bg-subtle"))).toBeLessThan(lightness(c("bg")));
    expect(c("surface-overlay")).toBe("#ffffff");
  });
});

describe("the token structure", () => {
  it("defines the same names in both themes", () => {
    const light = Object.keys(themeDeclarations("light")).sort();
    const dark = Object.keys(themeDeclarations("dark")).sort();
    expect(light).toEqual(dark);
    // The names components and the brief rely on.
    for (const name of [
      "surface-overlay",
      "surface-hover",
      "surface-active",
      "surface-selected",
      "surface-raised-control",
      "surface-inset",
      "fg-disabled",
      "border-subtle",
      "border-hover",
      "focus",
      "accent-text",
      "accent-hover",
      "accent-active",
      "accent-strong",
      "accent-deep",
      "chart-dim",
      ...STATUSES.flatMap((s) => [s, `${s}-text`, `${s}-soft`, `${s}-border`]),
    ])
      expect(light, name).toContain(name);
  });

  it("resolves every alias, and gives charts plain hex", () => {
    for (const mode of MODES) {
      const t = themeTokens(mode);
      for (const [name, value] of Object.entries(t)) expect(value, `${mode} --${name}`).not.toContain("var(");
      // ECharts reads these through getComputedStyle, and inkOn() reads #rrggbb only.
      const chart = Object.keys(t).filter((n) =>
        /^(chart-\d|chart-other|chart-grid|chart-axis|seq-\d|div-\d)$/.test(n),
      );
      expect(chart.length).toBe(8 + 1 + 2 + 8 + 7);
      for (const name of chart) expect(t[name], `${mode} --${name}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("writes primitives as #rrggbb that a minifier can't shorten", () => {
    const p = primitives();
    expect(Object.keys(p).length).toBe(1 + 6 * 12 * 2);
    for (const [name, value] of Object.entries(p)) {
      expect(name).toMatch(/^base-(white|[a-z]+-(dark-)?([1-9]|1[0-2]))$/);
      expect(value, name).toMatch(/^#[0-9a-f]{6}$/);
      if (name !== "base-white") expect(value, name).not.toMatch(/^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/);
    }
  });

  it("keeps primitives out of components", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(process.cwd(), dir))) {
        const path = join(dir, name);
        if (statSync(join(process.cwd(), path)).isDirectory()) walk(path);
        else if (/\.(tsx?|css)$/.test(name)) files.push(path.replace(/\\/g, "/"));
      }
    };
    walk("src/ui");
    walk("src/app");
    // A primitive can only be reached through var() (no utility maps one), in CSS or an arbitrary value.
    const offenders = files.filter((f) =>
      /var\(\s*--base-/.test(readFileSync(join(process.cwd(), f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("gives the social image the dark theme's resolved colours", () => {
    const colour = darkColours();
    const dark = themeTokens("dark");
    for (const name of ["bg", "fg", "fg-muted", "accent"]) expect(colour(name)).toBe(dark[name]);
    // Translucent tokens arrive in the renderer's rgba() form.
    expect(colour("accent-soft")).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/);
    expect(colour("border-strong")).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/);
    expect(() => colour("no-such-token")).toThrow(/missing/);
  });
});
