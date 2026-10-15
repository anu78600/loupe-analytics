/**
 * Chart option rules (src/ui/charts): label ink contrast inside fills, the
 * geo-tile click value, and the label/axis choices from QA (no value on every
 * time-axis bar, no crowded value axis on horizontal bars, partial first
 * buckets, the stacked "Others" segment).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildOption, type GeoTileDatum } from "@/ui/charts/options";
import { INK_DARK, inkOn, readChartTokens } from "@/ui/charts/tokens";
import type { ChartData, ChartKind, ChartSpec } from "@/engine/charts/types";

type Obj = Record<string, unknown>;
const TOKENS = readChartTokens();

/** WCAG contrast, written out here rather than imported, so the test does not grade the code with itself. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;

describe("label ink inside fills", () => {
  // Every fill a label can sit on: categorical, sequential and diverging tokens of both themes.
  const css = readFileSync(join(__dirname, "..", "src", "styles", "tokens.css"), "utf8");
  const tokenFills = [...css.matchAll(/--(?:chart-\d|chart-other|seq-\d|div-\d):\s*(#[0-9a-f]{6})/gi)].map(
    (m) => (m[1] as string).toLowerCase(),
  );
  const greys = Array.from({ length: 256 }, (_, v) => hex(v, v, v));
  const grid: string[] = [];
  for (let r = 0; r < 256; r += 15)
    for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 15) grid.push(hex(r, g, b));

  it("reads the theme fills", () => {
    // 8 categorical + other + 8 sequential + 7 diverging, in each of the two themes.
    expect(tokenFills.length).toBe(48);
  });

  it.each([
    ["design-token fills", tokenFills],
    ["the fallback palette", [...TOKENS.palette, ...TOKENS.seq, ...TOKENS.div, TOKENS.other]],
    ["every grey", greys],
    ["an RGB grid", grid],
  ])("reaches 4.5:1 on %s", (_, fills) => {
    for (const fill of fills) expect(contrast(inkOn(fill, TOKENS), fill), fill).toBeGreaterThanOrEqual(4.5);
  });

  it("no longer puts white on mid-tone brass", () => {
    // The old 0.36 luminance cut-off gave white here at about 3.1:1.
    expect(contrast("#ffffff", "#b98b3d")).toBeLessThan(3.2);
    expect(inkOn("#b98b3d", TOKENS)).toBe(INK_DARK);
    expect(inkOn("#fbf1e0", TOKENS)).toBe(INK_DARK);
    expect(inkOn("#3a2a10", TOKENS)).toBe("#ffffff");
    expect(inkOn("rgb(1, 2, 3)", TOKENS)).toBe(TOKENS.fg);
  });
});

function spec(kind: ChartKind, over: Partial<ChartSpec> = {}): ChartSpec {
  return {
    id: "s",
    title: "t",
    kind,
    section: "breakdown",
    x: { kind: "column", column: "State", label: "State" },
    measures: [{ id: "m", label: "Revenue", format: "currency", direction: "higher" }],
    reason: "r",
    alternatives: [],
    size: { w: 6, h: 4 },
    priority: 1,
    modes: ["analyst"],
    source: "domain",
    ...over,
  };
}

function data(labels: string[], over: Partial<ChartData> = {}): ChartData {
  return {
    specId: "s",
    kind: "bar",
    categories: labels.map((label) => ({ label, raw: label })),
    series: [
      {
        id: "m",
        label: "Revenue",
        values: labels.map((_, i) => 1_00_000 * (labels.length - i)),
        format: "currency",
      },
    ],
    rows: labels.map(() => 10),
    totals: [null],
    annotations: [],
    caption: "",
    altText: "",
    notes: [],
    empty: false,
    totalRows: 10 * labels.length,
    ...over,
  };
}

const option = (kind: ChartKind, s: ChartSpec, d: ChartData) =>
  buildOption({
    tokens: TOKENS,
    fmt: { locale: "IN", currency: "INR" },
    kind,
    spec: s,
    data: d,
    animate: false,
  }) as Obj;
const seriesOf = (o: Obj) => o.series as Obj[];

describe("geo tiles", () => {
  it("carry the data's own spelling of each state, which is what a click filters on", () => {
    const o = option("geoTile", spec("geoTile", { geoRegion: "IN" }), data(["MH", "karnataka", "Atlantis"]));
    const tiles = seriesOf(o)[0]?.data as GeoTileDatum[];
    const mh = tiles.find((t) => t.code === "MH");
    expect(mh?.name).toBe("Maharashtra");
    expect(mh?.category).toBe("MH");
    expect(tiles.find((t) => t.code === "KA")?.category).toBe("karnataka");
    // A state without data has nothing to filter to.
    expect(tiles.find((t) => t.code === "TN")?.category).toBeUndefined();
  });
});

describe("labels and axes", () => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const timeSpec = spec("bar", { x: { kind: "time", column: "Date", grain: "month", label: "Date" } });
  const timeData = data(months, {
    categories: months.map((label, i) => ({ label, raw: Date.UTC(2024, i, 1) })),
    annotations: [
      { index: 0, kind: "max", label: "Peak" },
      { index: 5, kind: "min", label: "Low" },
    ],
  });

  it("time-axis bars keep only the peak and low markers, with their values", () => {
    const bar = seriesOf(option("bar", timeSpec, timeData))[0] as Obj;
    expect(bar.label).toBeUndefined();
    const names = ((bar.markPoint as Obj).data as Obj[]).map((d) => d.name);
    expect(names).toEqual(["Peak ₹6L", "Low ₹1L"]);
  });

  it("category bars still carry a value on each bar", () => {
    const bar = seriesOf(option("bar", spec("bar"), data(["A", "B", "C"])))[0] as Obj;
    expect((bar.label as Obj | undefined)?.show).toBe(true);
  });

  it("labelled horizontal bars drop the value axis labels; unlabelled ones keep few ticks", () => {
    const labelled = option("hbar", spec("hbar"), data(["A", "B", "C", "D"]));
    expect(((labelled.xAxis as Obj).axisLabel as Obj).show).toBe(false);
    const many = option("hbar", spec("hbar"), data(Array.from({ length: 20 }, (_, i) => `Group ${i + 1}`)));
    const axis = many.xAxis as Obj;
    expect(axis.splitNumber).toBe(3);
    expect((axis.axisLabel as Obj).hideOverlap).toBe(true);
    expect((seriesOf(many)[0] as Obj).label).toBeUndefined();
  });

  it("fades a partial first bucket and flags it in the tooltip", () => {
    const o = option("bar", timeSpec, { ...timeData, partialFirst: true });
    const first = ((seriesOf(o)[0] as Obj).data as Obj[])[0] as Obj;
    expect((first.itemStyle as Obj).opacity).toBe(0.35);
    const html = ((o.tooltip as Obj).formatter as (p: unknown) => string)([
      { dataIndex: 0, seriesIndex: 0, seriesName: "Revenue", value: 1, color: "#000000" },
    ]);
    expect(html).toContain("partial");
  });

  it("draws the engine's stacked Others segment in the neutral colour", () => {
    const d = data(["A", "B"], {
      seriesCategories: [
        ...Array.from({ length: 8 }, (_, i) => ({ label: `S${i + 1}`, raw: `S${i + 1}` })),
        { label: "Others", raw: "__others__", isOthers: true },
      ],
      matrix: Array.from({ length: 9 }, () => [1, 2]),
    });
    const series = seriesOf(
      option(
        "stackedBar",
        spec("stackedBar", { series: { kind: "column", column: "Seg", label: "Seg" } }),
        d,
      ),
    );
    expect(series).toHaveLength(9);
    expect(series.map((s) => s.name)).toContain("Others");
    expect(((series[8] as Obj).itemStyle as Obj).color).toBe(TOKENS.other);
  });
});
