/**
 * Quicker ways to a brand's chart colours (version 52.0): the main colours
 * of a logo image (palette/fromImage.ts) and every colour code in a pasted
 * list (hexesIn in palette/colour.ts).
 */
import { describe, expect, it } from "vitest";
import { coloursFromPixels } from "@/ui/charts/palette/fromImage";
import { deltaE, hexesIn, hexToRgb } from "@/ui/charts/palette/colour";

/** RGBA pixels: each [hex, count] repeated, in order; "none" is a transparent pixel. */
function pixels(parts: Array<[string, number]>): Uint8ClampedArray {
  const out: number[] = [];
  for (const [hex, n] of parts)
    for (let i = 0; i < n; i++) {
      if (hex === "none") out.push(0, 0, 0, 0);
      else out.push(...hexToRgb(hex).map((x) => Math.round(x * 255)), 255);
    }
  return Uint8ClampedArray.from(out);
}

describe("colours from a logo", () => {
  it("returns the brand colours, most used first, without white, black, grey or transparency", () => {
    const logo = pixels([
      ["#ffffff", 4000],
      ["none", 2000],
      ["#111111", 900],
      ["#1d4ed8", 1500],
      ["#f59e0b", 600],
      ["#9ca3af", 300],
    ]);
    const found = coloursFromPixels(logo);
    expect(found).toHaveLength(2);
    expect(deltaE(found[0] as string, "#1d4ed8")).toBeLessThan(3);
    expect(deltaE(found[1] as string, "#f59e0b")).toBeLessThan(3);
  });

  it("counts near shades of one colour once and drops specks", () => {
    const found = coloursFromPixels(
      pixels([
        ["#1d4ed8", 1000],
        ["#1e50da", 400],
        ["#c2410c", 700],
        ["#16a34a", 5],
      ]),
    );
    expect(found).toHaveLength(2);
  });

  it("finds nothing in a black-and-white image", () => {
    expect(
      coloursFromPixels(
        pixels([
          ["#ffffff", 500],
          ["#000000", 500],
        ]),
      ),
    ).toEqual([]);
  });

  it("keeps to the number asked for", () => {
    const many = pixels(
      ["#1d4ed8", "#f59e0b", "#047857", "#be123c", "#6d28d9"].map((c) => [c, 100] as [string, number]),
    );
    expect(coloursFromPixels(many, 3)).toHaveLength(3);
  });
});

describe("colour codes in pasted text", () => {
  it("reads every code in a brand guide's list, once each", () => {
    expect(hexesIn("Navy #1D4ED8 · Gold #F59E0B, accent #fff, navy again #1d4ed8")).toEqual([
      "#1d4ed8",
      "#f59e0b",
      "#ffffff",
    ]);
  });

  it("reads codes without # only when they have a digit", () => {
    expect(hexesIn("1d4ed8 decade facade 0e7490")).toEqual(["#1d4ed8", "#0e7490"]);
  });
});
