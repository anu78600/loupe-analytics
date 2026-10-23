/**
 * The type system (version 39.0, one sans voice since 50.0; docs/DESIGN.md
 * "Type"): Inter for the interface and figures, and semibold at its display
 * optical size for headings (font-display), Geist Mono for code, and one
 * scale of named sizes in globals.css. These checks keep components on it: no
 * hand-picked pixel sizes or letter-spacing, the display face only at display
 * sizes, monospace only for
 * code, chart text no smaller than 11 px, and the self-hosted font files
 * present and cut to the ranges the layout declares.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(name)) out.push(path.replace(/\\/g, "/"));
  }
  return out;
}

const UI = [...sources("src/ui"), ...sources("src/app")];

/**
 * Fixed-size canvases drawn to images for export: the dashboard report pages
 * and the 16:9 slides are laid out in exact pixels at one size, so they may
 * size text in pixels (in the three families all the same). Everything else
 * uses the scale.
 */
const FIXED_CANVAS = new Set([
  "src/ui/workspace/export/report.tsx",
  "src/ui/workspace/export/slides.tsx",
  // The wordmark is artwork: its size and spacing are measured against the mark beside it.
  "src/ui/brand/logo.tsx",
]);

/** Every Tailwind class string in a file with its line number, for messages. */
function classLines(path: string): { line: number; text: string }[] {
  return read(path)
    .split("\n")
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => !/^\s*(\/\/|\*|\/\*)/.test(text));
}

describe("the type scale", () => {
  it("is used instead of hand-picked pixel sizes", () => {
    const offenders: string[] = [];
    for (const path of UI) {
      if (FIXED_CANVAS.has(path)) continue;
      for (const { line, text } of classLines(path))
        for (const m of text.matchAll(/\btext-\[\d[\d.]*(px|rem|em)\]/g))
          offenders.push(`${path}:${line} ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("carries its own letter-spacing, so components don't set their own", () => {
    const offenders: string[] = [];
    for (const path of UI) {
      if (FIXED_CANVAS.has(path)) continue;
      for (const { line, text } of classLines(path))
        for (const m of text.matchAll(/\btracking-\[[^\]]+\]/g)) offenders.push(`${path}:${line} ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("is known to the class merger, so a size never cancels a colour", () => {
    for (const size of [
      "text-2xs",
      "text-xs",
      "text-ui",
      "text-sm",
      "text-md",
      "text-base",
      "text-display-xs",
      "text-display-sm",
      "text-display-md",
      "text-display",
      "text-display-lg",
      "text-display-xl",
    ])
      expect(cn(size, "text-fg-muted")).toBe(`${size} text-fg-muted`);
    expect(cn("text-2xs", "text-sm")).toBe("text-sm");
    expect(cn("text-display-sm", "text-display-xl")).toBe("text-display-xl");
  });

  it("defines every size it names, with a line height", () => {
    const css = read("src/app/globals.css");
    for (const size of ["2xs", "xs", "ui", "sm", "md", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl"]) {
      expect(css, size).toMatch(new RegExp(`--text-${size}:`));
      expect(css, size).toMatch(new RegExp(`--text-${size}--line-height:`));
    }
    for (const size of ["xs", "sm", "md", "", "lg", "xl"].map((s) => (s ? `display-${s}` : "display")))
      expect(css, size).toMatch(new RegExp(`--text-${size}--letter-spacing:`));
  });
});

describe("the families", () => {
  it("set the display face only at display sizes", () => {
    const offenders: string[] = [];
    for (const path of UI) {
      if (FIXED_CANVAS.has(path)) continue;
      for (const { line, text } of classLines(path))
        if (/\bfont-display\b/.test(text) && !/\btext-display(-[a-z]+)?\b/.test(text))
          offenders.push(`${path}:${line}`);
    }
    expect(offenders).toEqual([]);
  });

  it("keep monospace for code", () => {
    // Code views (SQL, DAX, the AI request's payload) are the only places for Geist Mono; figures
    // use .font-figures, which is Inter with tabular numerals.
    const allowed = new Set(["src/ui/common/code.tsx", "src/ui/workspace/AiSummary.tsx"]);
    const offenders = UI.filter((path) => !allowed.has(path) && /\bfont-mono\b/.test(read(path)));
    expect(offenders).toEqual([]);
    const css = read("src/app/globals.css");
    // Tailwind's base sets <kbd> in the monospace; keys are interface text.
    expect(/\bkbd\s*\{([^}]*)\}/.exec(css)?.[1] ?? "").toContain("var(--font-sans)");
    const figures = /\.font-figures\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(figures).toContain("var(--font-sans)");
    expect(figures).toContain("tabular-nums");
  });

  it("are the self-hosted files the layout loads", () => {
    const layout = read("src/app/layout.tsx");
    for (const m of layout.matchAll(/["']\.\/fonts\/([^"']+)["']/g)) {
      const file = m[1] as string;
      expect(existsSync(join(ROOT, "src", "app", "fonts", file)), file).toBe(true);
    }
    // Every face is a file in the repo: no package or host supplies one.
    expect(layout).not.toMatch(/from "geist|next\/font\/google/);
    // Every font file is shipped with its licence.
    for (const dir of ["src/app/fonts", "public/fonts"]) {
      const names = readdirSync(join(ROOT, dir));
      for (const family of new Set(names.filter((n) => /\.(woff2|ttf)$/.test(n)).map((n) => n.split("-")[0])))
        expect(names, `${dir}: ${family}`).toContain(`${family}-OFL.txt`);
    }
  });

  it("are cut to the same character ranges the layout declares", () => {
    const layout = read("src/app/layout.tsx");
    const script = read("scripts/subset-fonts.py");
    const split = (list: string) =>
      list
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);
    // The script's LATIN and LATIN_EXT constants, written as adjacent Python string literals.
    const fromScript = (name: string) =>
      split(
        (new RegExp(`^${name} = \\(?\\s*((?:"[^"]*"\\s*)+)`, "m").exec(script)?.[1] ?? "")
          .replace(/"\s*"/g, "")
          .replace(/"/g, ""),
      );
    // The layout's two unicode-range declarations, Latin first.
    const declared = [...layout.matchAll(/prop: "unicode-range",\s*value:\s*"([^"]+)"/g)].map((m) =>
      split(m[1] as string),
    );
    expect(declared).toHaveLength(2);
    expect(declared[0]?.length).toBeGreaterThan(5);
    expect(declared[0]).toEqual(fromScript("LATIN"));
    expect(declared[1]).toEqual(fromScript("LATIN_EXT"));
  });

  it("embed in the exports from files that exist", () => {
    const files = [
      ...read("src/ui/workspace/export/textPdf.ts").matchAll(/"\/fonts\/([^"]+\.ttf)"/g),
      ...read("src/app/opengraph-image.tsx").matchAll(/brandFont\("([^"]+)"\)/g),
    ].map((m) => m[1] as string);
    expect(files).toContain("Inter-Regular.ttf");
    for (const file of files) expect(existsSync(join(ROOT, "public", "fonts", file)), file).toBe(true);
  });
});

describe("chart text", () => {
  it("is never smaller than 11 px, bar the calendar's weekday letters", () => {
    const source = read("src/ui/charts/options.ts").split("\n");
    const small = source
      .map((text, i) => ({ text, line: i + 1 }))
      .filter(({ text }) => [...text.matchAll(/fontSize: (\d+(?:\.\d+)?)\b/g)].some((m) => Number(m[1]) < 11))
      .filter(({ text }) => !text.includes("dayLabel"))
      .map(({ line, text }) => `options.ts:${line} ${text.trim()}`);
    expect(small).toEqual([]);
  });

  it("sets figures in the interface face, not a monospace", () => {
    const tokens = read("src/ui/charts/tokens.ts");
    expect(tokens).not.toMatch(/fontMono|geist/i);
    expect(read("src/ui/charts/options.ts")).not.toMatch(/fontMono/);
  });
});
