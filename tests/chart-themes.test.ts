/**
 * Chart themes (src/ui/charts/palette): the colour maths, the readability
 * checks, the presets, the generators and what a theme turns into (CSS, a
 * Power BI report theme, a saved config).
 *
 * - The checks reproduce the reference validator's figures for the built-in
 *   palette (the numbers recorded in styles/theme-dark.css and theme-light.css).
 * - Every preset passes every check in both themes, and "Loupe" is exactly
 *   the theme stylesheets' palette and gradient, so the default can't drift.
 * - Every gradient starts visibly: step 1 at ≥ 1.5:1 on the chart background.
 * - Your colours are kept exactly; the rest of the series are filled in.
 * - One colour → shades keeps the colour and its hue, and neighbouring
 *   shades stay easy to tell apart; → matching colours never fails a check,
 *   whatever colour is picked (a sweep round the colour wheel).
 * - improve() keeps hues and clears the failures it can.
 */
import { describe, expect, it } from "vitest";
import { contrast, deltaE, normaliseHex, oklch, oklchToHex } from "@/ui/charts/palette/colour";
import { checkPalette, SURFACE, type ThemeMode } from "@/ui/charts/palette/check";
import { forDark, improve, matchingFrom, rampFrom, shadesFrom, SLOTS } from "@/ui/charts/palette/generate";
import {
  DEFAULT_CHART_THEME,
  PRESETS,
  powerBiTheme,
  resolveTheme,
  sameChoice,
  sanitiseChoice,
  themeCss,
  type ChartThemeChoice,
} from "@/ui/charts/palette/themes";
import { chartThemeBootScript } from "@/ui/charts/palette/apply";
import { chartThemeSchema } from "@/engine/export/config";
import { themeTokens } from "./helpers/theme";

const MODES: ThemeMode[] = ["light", "dark"];
const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

describe("colour maths", () => {
  it("normalises hex input and rejects anything else", () => {
    expect(normaliseHex("#1D4ED8")).toBe("#1d4ed8");
    expect(normaliseHex(" 1d4ed8 ")).toBe("#1d4ed8");
    expect(normaliseHex("#abc")).toBe("#aabbcc");
    for (const bad of ["", "#12345", "red", "#ggg000", "1d4ed8ff", "rgb(0,0,0)"])
      expect(normaliseHex(bad)).toBeNull();
  });

  it("round-trips through OKLCH, and maps colours sRGB can't show onto it", () => {
    for (const hex of [
      "#000000",
      "#ffffff",
      "#1d4ed8",
      "#e11d48",
      "#0f766e",
      "#ca8a04",
      "#7c3aed",
      "#6b7280",
    ])
      expect(oklchToHex(oklch(hex))).toBe(hex);
    // A chroma far beyond sRGB keeps its lightness and hue and loses chroma.
    const wild = oklchToHex({ l: 0.6, c: 0.4, h: 150 });
    expect(wild).toMatch(/^#[0-9a-f]{6}$/);
    expect(oklch(wild).l).toBeCloseTo(0.6, 2);
    expect(hueGap(oklch(wild).h, 150)).toBeLessThan(2);
  });

  it("measures contrast and distance like the WCAG and OKLab definitions", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(deltaE("#1d4ed8", "#1d4ed8")).toBe(0);
    expect(deltaE("#000000", "#ffffff")).toBeCloseTo(100, 0);
  });
});

describe("readability checks", () => {
  it("reproduce the reference validator's figures for the built-in palette", () => {
    const loupe = PRESETS[0];
    if (!loupe) throw new Error("no presets");
    const light = checkPalette(loupe.light, "light");
    const dark = checkPalette(loupe.dark, "dark");
    // The figures recorded in the theme stylesheets (worst neighbouring ΔE: colour-blind, normal vision).
    expect([dark.worstCvd.toFixed(1), dark.worstNormal.toFixed(1)]).toEqual(["14.1", "16.7"]);
    expect([light.worstCvd.toFixed(1), light.worstNormal.toFixed(1)]).toEqual(["14.0", "16.7"]);
    expect(light.state).toBe("pass");
    expect(dark.state).toBe("pass");
  });

  it("flag neighbours that look alike, greyish colours and faint ones", () => {
    const r = checkPalette(["#1f77b4", "#2378b0", "#9a9a9a", "#f4f4f4"], "light");
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    expect(by.normal?.state).toBe("fail");
    expect(by.normal?.message).toMatch(/series 1 and series 2 are too similar/);
    expect(by.chroma?.state).toBe("warn");
    expect(by.contrast?.state).toBe("warn");
    expect(r.state).toBe("fail");
  });
});

describe("presets", () => {
  it("pass every check in both themes, with 8 colours each", () => {
    for (const p of PRESETS)
      for (const m of MODES) {
        expect(p[m], `${p.id} ${m}`).toHaveLength(SLOTS);
        const r = checkPalette(p[m], m);
        expect(
          r.state,
          `${p.id} ${m}: ${r.checks
            .filter((c) => c.state !== "pass")
            .map((c) => c.message)
            .join(" ")}`,
        ).toBe("pass");
      }
  });

  it("Loupe is exactly the palette and gradient of the theme stylesheets", () => {
    const loupe = resolveTheme(DEFAULT_CHART_THEME);
    for (const m of MODES) {
      const t = themeTokens(m);
      const read = (prefix: string) => Array.from({ length: SLOTS }, (_, i) => t[`${prefix}-${i + 1}`]);
      expect(read("chart")).toEqual(PRESETS.find((p) => p.id === "loupe")?.[m]);
      expect(read("seq")).toEqual(loupe[m].ramp);
      // The palette is checked against the card it is drawn on.
      expect(t["surface-1"]).toBe(SURFACE[m]);
    }
  });
});

describe("resolving a choice", () => {
  it("leaves the built-in palette alone (no CSS), and falls back to it for anything unknown", () => {
    const t = resolveTheme(DEFAULT_CHART_THEME);
    expect(t.builtIn).toBe(true);
    expect(themeCss(t)).toBe("");
    expect(resolveTheme({ kind: "preset", id: "nope" }).builtIn).toBe(true);
    expect(resolveTheme({ kind: "custom", colours: ["not a colour"] }).builtIn).toBe(true);
  });

  it("keeps your colours exactly and fills the remaining series", () => {
    const mine = ["#0b5fff", "#ff7a00", "#00a37a"];
    const t = resolveTheme({ kind: "custom", colours: mine });
    expect(t.given).toBe(3);
    expect(t.light.series.slice(0, 3)).toEqual(mine);
    expect(t.light.series).toHaveLength(SLOTS);
    expect(new Set(t.light.series).size).toBe(SLOTS);
    expect(t.dark.series).toHaveLength(SLOTS);
    // The dark theme keeps each hue.
    t.dark.series.forEach((c, i) =>
      expect(hueGap(oklch(c).h, oklch(t.light.series[i] as string).h)).toBeLessThan(3),
    );
  });

  it("gives every theme a gradient that runs from the background to strong", () => {
    const choices: ChartThemeChoice[] = [
      { kind: "preset", id: "ocean" },
      { kind: "single", colour: "#0f766e", style: "shades" },
      { kind: "custom", colours: ["#be123c"] },
    ];
    for (const choice of choices) {
      const t = resolveTheme(choice);
      for (const m of MODES) {
        const ls = t[m].ramp.map((c) => oklch(c).l);
        expect(ls).toHaveLength(8);
        for (let i = 1; i < ls.length; i++)
          if (m === "light") expect(ls[i]).toBeLessThan(ls[i - 1] as number);
          else expect(ls[i]).toBeGreaterThan(ls[i - 1] as number);
      }
    }
    // The ramp takes its hue from the colour.
    expect(hueGap(oklch(rampFrom("#1d4ed8", "light")[5] as string).h, oklch("#1d4ed8").h)).toBeLessThan(4);
  });

  it("starts every gradient where it shows on the chart background", () => {
    const bases = [
      ...PRESETS.map((p) => p.light[0] as string),
      ...Array.from({ length: 18 }, (_, k) => oklchToHex({ l: 0.6, c: 0.14, h: k * 20 })),
    ];
    for (const m of MODES) {
      expect(
        contrast(resolveTheme(DEFAULT_CHART_THEME)[m].ramp[0] as string, SURFACE[m]),
      ).toBeGreaterThanOrEqual(1.5);
      for (const base of bases)
        expect(contrast(rampFrom(base, m)[0] as string, SURFACE[m]), `${base} ${m}`).toBeGreaterThanOrEqual(
          1.5,
        );
    }
  });

  it("gives a new key whenever any colour changes, so charts redraw", () => {
    const a = resolveTheme({ kind: "custom", colours: ["#0b5fff"] });
    const b = resolveTheme({ kind: "custom", colours: ["#0b5ffe"] });
    expect(a.key).not.toBe(b.key);
    expect(resolveTheme({ kind: "custom", colours: ["#0b5fff"] }).key).toBe(a.key);
  });

  it("is quick enough to follow a colour picker", () => {
    const t0 = performance.now();
    for (const base of ["#1d4ed8", "#e11d48", "#ca8a04", "#0f766e"]) {
      resolveTheme({ kind: "custom", colours: [base, "#888888"] });
      resolveTheme({ kind: "single", colour: base, style: "matching" });
      resolveTheme({ kind: "single", colour: base, style: "shades" });
    }
    expect((performance.now() - t0) / 12).toBeLessThan(150);
  });
});

describe("one colour", () => {
  const bases = ["#1d4ed8", "#e11d48", "#0f766e", "#ca8a04", "#7c3aed", "#c2410c", "#15803d", "#0369a1"];

  it("shades keep the colour itself first, its hue throughout, and neighbours far apart", () => {
    for (const base of bases)
      for (const m of MODES) {
        const s = shadesFrom(base, m);
        expect(s).toHaveLength(SLOTS);
        const h = oklch(base).h;
        for (const c of s)
          if (oklch(c).c > 0.04) expect(hueGap(oklch(c).h, h), `${base} ${m} ${c}`).toBeLessThan(4);
        for (let i = 1; i < s.length; i++)
          expect(
            deltaE(s[i - 1] as string, s[i] as string),
            `${base} ${m} series ${i}–${i + 1}`,
          ).toBeGreaterThanOrEqual(15);
      }
    // A colour inside the range is series 1 exactly.
    expect(shadesFrom("#1d4ed8", "light")[0]).toBe("#1d4ed8");
  });

  it("matching colours never fail a check, all round the colour wheel", () => {
    for (let h = 0; h < 360; h += 20)
      for (const [l, c] of [
        [0.55, 0.15],
        [0.68, 0.12],
      ] as const) {
        const base = oklchToHex({ l, c, h });
        const t = resolveTheme({ kind: "single", colour: base, style: "matching" });
        expect(t.light.series[0]).toBe(base);
        for (const m of MODES) {
          const r = checkPalette(t[m].series, m);
          expect(
            r.checks.filter((x) => x.state === "fail").map((x) => x.message),
            `${base} ${m}`,
          ).toEqual([]);
        }
      }
  });
});

describe("improve()", () => {
  it("keeps every hue and clears what failed", () => {
    const bad = ["#1f77b4", "#2378b0", "#ff7f0e", "#ff8a1c", "#2ca02c", "#31a531"];
    expect(checkPalette(bad, "light").state).toBe("fail");
    const fixed = improve(bad, "light");
    fixed.forEach((c, i) => expect(hueGap(oklch(c).h, oklch(bad[i] as string).h)).toBeLessThan(3));
    expect(checkPalette(fixed, "light").checks.filter((c) => c.state === "fail")).toEqual([]);
  });

  it("leaves kept colours alone", () => {
    const out = improve(["#2378b0", "#1f77b4", "#ff7f0e"], "light", { keep: 1 });
    expect(out[0]).toBe("#2378b0");
  });

  it("makes dark versions that suit the dark background", () => {
    const light = matchingFrom(["#0b5fff", "#ff7a00"], "light");
    const dark = forDark(light);
    expect(checkPalette(dark, "dark").checks.find((c) => c.id === "contrast")?.state).toBe("pass");
  });
});

describe("what a theme becomes", () => {
  it("CSS that overrides tokens.css in both themes, only while <html> carries data-chart-theme", () => {
    const css = themeCss(resolveTheme({ kind: "preset", id: "forest" }));
    expect(css).toContain(':root[data-chart-theme] [data-theme="light"]');
    expect(css).toContain(':root[data-chart-theme][data-theme="dark"]');
    const forest = PRESETS.find((p) => p.id === "forest");
    expect(css).toContain(`--chart-1:${forest?.light[0]}`);
    expect(css).toContain(`--chart-1:${forest?.dark[0]}`);
    expect(css).toMatch(/--seq-8:#[0-9a-f]{6}/);
    expect(css).toContain(`--chart-spark:${forest?.dark[0]}`);
    expect(css).not.toMatch(/url\(|@import/);
  });

  it("a Power BI report theme with the light colours", () => {
    const t = resolveTheme({ kind: "preset", id: "sunset" });
    const json = JSON.parse(powerBiTheme(t)) as { name: string; dataColors: string[]; tableAccent: string };
    expect(json.name).toBe("Loupe · Sunset");
    expect(json.dataColors).toEqual(t.light.series);
    expect(json.tableAccent).toBe(t.light.series[0]);
  });

  it("a saved choice that is checked on the way in", () => {
    expect(sanitiseChoice(undefined)).toEqual(DEFAULT_CHART_THEME);
    expect(sanitiseChoice({ kind: "custom", colours: ["#ABC", "nope", 3] })).toEqual({
      kind: "custom",
      colours: ["#aabbcc"],
    });
    expect(sanitiseChoice({ kind: "single", colour: "#123456", style: "odd" })).toEqual({
      kind: "single",
      colour: "#123456",
      style: "shades",
    });
    expect(
      (sanitiseChoice({ kind: "custom", colours: Array(12).fill("#123456") }) as { colours: string[] })
        .colours,
    ).toHaveLength(8);
    expect(
      sameChoice({ kind: "custom", colours: ["#ABCDEF"] }, { kind: "custom", colours: ["#abcdef"] }),
    ).toBe(true);
    expect(chartThemeSchema.safeParse({ kind: "single", colour: "#1d4ed8", style: "matching" }).success).toBe(
      true,
    );
    expect(chartThemeSchema.safeParse({ kind: "custom", colours: ["red"] }).success).toBe(false);
  });

  it("a boot script that only accepts what applyChartTheme writes", () => {
    expect(() => new Function(chartThemeBootScript)).not.toThrow();
    expect(chartThemeBootScript).toContain("url\\(|@import|expression");
  });
});
