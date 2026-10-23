/**
 * Chart option rules (src/ui/charts): label ink contrast inside fills, the
 * geo-tile click value, and the label/axis choices from QA (no value on every
 * time-axis bar, no crowded value axis on horizontal bars, partial first
 * buckets, the stacked "Others" segment). Then the dashboard audit's label
 * fixes: names broken at spaces, every bar named, the year on thinned month
 * axes, 0–100% share axes, scatter axes fitted to the points, incomplete-period
 * labels kept clear of the value axis and of the peak/low markers, treemap
 * names never split letter by letter, and cell values left off cells too
 * small for them.
 */
import { describe, expect, it } from "vitest";
import {
  buildOption,
  chartSubtitle,
  wrapLabel,
  wrapWords,
  type GeoTileDatum,
  type OptionContext,
} from "@/ui/charts/options";
import { INK_DARK, inkOn, readChartTokens } from "@/ui/charts/tokens";
import type { ChartData, ChartKind, ChartSpec } from "@/engine/charts/types";
import { MODES, themeTokens } from "./helpers/theme";

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
  // Every fill a label can sit on: categorical, sequential and diverging tokens of both themes,
  // resolved as the browser computes them.
  const tokenFills = MODES.flatMap((mode) =>
    Object.entries(themeTokens(mode))
      .filter(
        ([name, value]) =>
          /^(chart-\d|chart-other|seq-\d|div-\d)$/.test(name) && /^#[0-9a-f]{6}$/i.test(value),
      )
      .map(([, value]) => value.toLowerCase()),
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

  it("leave the state codes off tiles too small to hold an 11 px label (version 39.0)", () => {
    const codes = (size: { width?: number; height?: number }) =>
      (
        seriesOf(
          buildOption({
            tokens: TOKENS,
            fmt: { locale: "IN", currency: "INR" },
            kind: "geoTile",
            spec: spec("geoTile", { geoRegion: "IN" }),
            data: data(["MH", "KA"]),
            animate: false,
            ...size,
          }) as Obj,
        )[0]?.label as Obj
      ).show;
    expect(codes({})).toBe(true);
    expect(codes({ width: 520, height: 320 })).toBe(true);
    // The one-page dashboard's short card.
    expect(codes({ width: 420, height: 150 })).toBe(false);
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

describe("nothing dropped, nothing cut (34.2)", () => {
  const monthSpec = spec("line", { x: { kind: "time", column: "Date", grain: "month", label: "Date" } });
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const monthData = data(months, {
    categories: months.map((label, i) => ({ label, raw: Date.UTC(2026, i, 1) })),
    partialLast: true,
    partialLastEnd: Date.UTC(2026, 5, 20),
  });

  it("wraps a long category name onto two lines and marks a cut with an ellipsis", () => {
    expect(wrapLabel("Net Banking", 8)).toBe("Net\nBanking");
    expect(wrapLabel("Electronics Accessories", 12)).toBe("Electronics\nAccessories");
    expect(wrapLabel("Beauty & Personal Care Essentials", 10)).toMatch(/^Beauty &\n.+…$/);
    expect(wrapLabel("Short", 10)).toBe("Short");
  });

  it("shows every named category's label, never thinned or tilted", () => {
    const labels = Array.from({ length: 8 }, (_, i) => `Payment method ${i + 1}`);
    const axis = option("bar", spec("bar"), data(labels)).xAxis as Obj;
    const label = axis.axisLabel as Obj;
    expect(label.interval).toBe(0);
    expect(label.hideOverlap).toBe(false);
    expect(label.rotate).toBeUndefined();
    expect((label.formatter as (v: string) => string)("Payment method 1")).toContain("Payment");
  });

  it("turns more than ten named columns into horizontal bars, one name per row", () => {
    const labels = Array.from({ length: 14 }, (_, i) => `State ${i + 1}`);
    const o = option("bar", spec("bar"), data(labels));
    expect((o.yAxis as Obj).type).toBe("category");
    expect((o.xAxis as Obj).type).toBe("value");
  });

  it("ends the solid line at the last complete period and dashes into the incomplete one", () => {
    const o = option("line", monthSpec, monthData);
    const [main, dashed] = seriesOf(o) as [Obj, Obj];
    const mainData = main.data as Obj[];
    expect((mainData[5] as Obj).value).toBeNull();
    expect((mainData[4] as Obj).value).not.toBeNull();
    expect(main.endLabel).toBeUndefined();
    // The helper is unnamed and silent, so tooltips and legends skip it.
    expect(dashed.name).toBeUndefined();
    expect(dashed.silent).toBe(true);
    expect((dashed.lineStyle as Obj).type).toEqual([4, 4]);
    const points = dashed.data as Array<Obj | null>;
    expect(points.slice(0, 4).every((p) => p === null)).toBe(true);
    expect(((points[5] as Obj).label as Obj).formatter).toBe("to 20 Jun");
    expect((o.grid as Obj).right).toBe(72);
  });

  it("says where a short last column stops", () => {
    const bars = seriesOf(option("bar", { ...monthSpec, kind: "bar" }, monthData))[0] as Obj;
    const last = (bars.data as Obj[])[5] as Obj;
    expect((last.label as Obj).formatter).toBe("to 20 Jun");
  });

  it("prints a colour scale's end values and fits cell text to each cell", () => {
    const o = option("geoTile", spec("geoTile", { geoRegion: "IN" }), data(["MH", "KA", "TN"]));
    expect((o.visualMap as Obj).text).toEqual(["₹3L", "₹1L"]);
    const tiles = seriesOf(o)[0]?.data as GeoTileDatum[];
    const mh = tiles.find((t) => t.code === "MH");
    const tn = tiles.find((t) => t.code === "TN");
    // The largest and smallest values sit on opposite ends of the ramp, so their text can differ;
    // each is one of the two inks, never the theme's default label colour.
    for (const t of [mh, tn]) expect(["#0b0d12", "#ffffff", "#000000"]).toContain((t?.label as Obj).color);
  });

  it("keeps the Pareto 80% label inside the plot", () => {
    const d = data(["A", "B", "C"], {
      series: [
        { id: "share", label: "Share of total", values: [0.5, 0.3, 0.2], format: "percent" },
        { id: "cumulative", label: "Cumulative share", values: [0.5, 0.8, 1], format: "percent" },
      ],
    });
    const line = seriesOf(option("pareto", spec("pareto"), d))[1] as Obj;
    expect(((line.markLine as Obj).label as Obj).position).toBe("insideEndTop");
  });

  it("leaves out cohort months no cohort has reached", () => {
    const d = data([], {
      cohorts: [
        { label: "Jan 26", cohort: 0, size: 100, retention: [1, 0.2, 0.1, null, null] },
        { label: "Feb 26", cohort: 0, size: 80, retention: [1, 0.15, null, null, null] },
      ],
    });
    const o = option("cohort", spec("cohort", { analysis: "cohort" }), d);
    expect((o.xAxis as Obj).data).toEqual(["M0", "M1", "M2"]);
  });
});

/** An option built at a measured size, as the dashboard card builds it. */
const sized = (kind: ChartKind, s: ChartSpec, d: ChartData, over: Partial<OptionContext> = {}) =>
  buildOption({
    tokens: TOKENS,
    fmt: { locale: "IN", currency: "INR" },
    kind,
    spec: s,
    data: d,
    animate: false,
    ...over,
  }) as Obj;

describe("labels that read and fit (dashboard audit)", () => {
  it("breaks a name at any space before it cuts a word", () => {
    // The old rule needed the space past a third of the line, so "Net Banking" became "Net Banki / ng".
    expect(wrapLabel("Net Banking", 9)).toBe("Net\nBanking");
    expect(wrapLabel("Credit Card", 7)).toBe("Credit\nCard");
    // Inside tiles whose width is only estimated, a word is never split at all.
    expect(wrapWords("Haircare", 4)).toBe("Haircare");
    expect(wrapWords("New Customers", 12)).toBe("New\nCustomers");
    expect(wrapWords("Home & Kitchen", 20)).toBe("Home & Kitchen");
    expect(wrapWords("Beauty & Personal Care", 8, 2)).toBe("Beauty &\nPersonal Care");
  });

  it("names every horizontal bar, sizing the names to the rows", () => {
    const labels = Array.from({ length: 12 }, (_, i) => `State number ${i + 1}`);
    const o = sized("hbar", spec("hbar"), data(labels), { width: 520, height: 260 });
    const names = (o.yAxis as Obj).axisLabel as Obj;
    expect(names.interval).toBe(0);
    expect(names.hideOverlap).toBe(false);
    expect(names.fontSize).toBeLessThanOrEqual(11);
    // A short card's names get smaller rather than dropping out.
    const short = sized("hbar", spec("hbar"), data(labels), { width: 520, height: 160 });
    const shortNames = (short.yAxis as Obj).axisLabel as Obj;
    expect(shortNames.interval).toBe(0);
    expect(shortNames.fontSize as number).toBeLessThan(11);
    expect(shortNames.fontSize as number).toBeGreaterThanOrEqual(7.5);
  });

  it("thins bar names only when the rows are too short for any legible type", () => {
    const labels = Array.from({ length: 12 }, (_, i) => `State ${i + 1}`);
    const o = sized("hbar", spec("hbar"), data(labels), { width: 520, height: 100 });
    expect(((o.yAxis as Obj).axisLabel as Obj).interval as number).toBeGreaterThan(0);
    // The values then go on the axis, not beside bars too thin to hold them.
    expect((seriesOf(o)[0] as Obj).label).toBeUndefined();
    expect(((o.xAxis as Obj).axisLabel as Obj | undefined)?.show).not.toBe(false);
  });

  it("turns named columns into bars when a name won't fit its column (a phone)", () => {
    const labels = ["COD", "Credit Card", "Net Banking", "EMI", "Debit Card", "UPI", "Wallet"];
    const phone = sized("bar", spec("bar"), data(labels), { width: 340 });
    expect((phone.yAxis as Obj).type).toBe("category");
    const desktop = sized("bar", spec("bar"), data(labels), { width: 900 });
    expect((desktop.xAxis as Obj).type).toBe("category");
  });

  it("labels every nth month and gives the first label shown in each year its year", () => {
    const cats = Array.from({ length: 24 }, (_, i) => ({ label: `m${i}`, raw: Date.UTC(2024, 9 + i, 1) }));
    const d = data(
      cats.map((c) => c.label),
      { categories: cats, grain: "month" },
    );
    const s = spec("line", { x: { kind: "time", column: "Date", grain: "month", label: "Date" } });
    const axis = (sized("line", s, d, { width: 452 }).xAxis as Obj).axisLabel as Obj;
    const step = (axis.interval as number) + 1;
    expect(step).toBeGreaterThan(1);
    expect(axis.hideOverlap).toBe(false);
    const format = axis.formatter as (v: unknown, i: number) => string;
    const texts = cats
      .map((_, i) => i)
      .filter((i) => i % step === 0)
      .map((i) => format(cats[i]?.label, i));
    expect(texts[0]).toBe("Oct 2024");
    // Every year the axis runs into is named on the first label drawn in it, however thinned.
    for (const year of ["2025", "2026"]) expect(texts.filter((t) => t.endsWith(year))).toHaveLength(1);
  });

  it("puts shares on a 0–100% axis in 20% steps: a 100% stack and a Pareto chart", () => {
    const stack = data(["Sales", "Engineering"], {
      seriesCategories: [
        { label: "Female", raw: "Female" },
        { label: "Male", raw: "Male" },
      ],
      matrix: [
        [30, 81],
        [70, 176],
      ],
    });
    const s100 = spec("stackedBar100", { series: { kind: "column", column: "Gender", label: "Gender" } });
    const axis = sized("stackedBar100", s100, stack).yAxis as Obj;
    expect(axis.interval).toBe(0.2);
    expect(axis.max).toBe(1);
    const tick = (axis.axisLabel as Obj).formatter as (v: number) => string;
    expect([0.8, 1].map(tick)).toEqual(["80%", "100%"]);
    // Its unit line says what the axis is, whatever the measure counts.
    expect(chartSubtitle(s100, stack, { locale: "IN", currency: "INR" }, "stackedBar100")).toBe(
      "In % of each column",
    );
    const pareto = data(["A", "B"], {
      series: [
        { id: "share", label: "Share of total", values: [0.6, 0.4], format: "percent" },
        { id: "cumulative", label: "Cumulative share", values: [0.6, 1], format: "percent" },
      ],
    });
    expect((sized("pareto", spec("pareto"), pareto).yAxis as Obj).interval).toBe(0.2);
  });

  it("fits a scatter's axes to its points, with room for the x axis's name", () => {
    const pts = data(["Sales", "Ops", "Finance"], {
      points: [
        { label: "Sales", x: 71.3, y: 0.47 },
        { label: "Ops", x: 73.5, y: 0.35 },
        { label: "Finance", x: 74.5, y: 0.27 },
      ],
      trendline: { slope: -0.06, intercept: 4.7, r2: 0.53 },
    });
    const s = spec("scatter", {
      measures: [
        { id: "e", label: "Engagement", format: "decimal", direction: "higher" },
        { id: "a", label: "Attrition rate", format: "percent", direction: "lower" },
      ],
    });
    const o = sized("scatter", s, pts);
    expect((o.xAxis as Obj).scale).toBe(true);
    expect((o.yAxis as Obj).scale).toBe(true);
    expect((o.grid as Obj).bottom as number).toBeGreaterThanOrEqual(24);
    expect(seriesOf(o)).toHaveLength(2);
    // No fit (every point at one x): no trendline and no "R² NaN".
    const flat = sized("scatter", s, { ...pts, trendline: { slope: NaN, intercept: NaN, r2: NaN } });
    expect(seriesOf(flat)).toHaveLength(1);
    expect(JSON.stringify(flat)).not.toContain("NaN");
  });

  it("keeps an incomplete first period's label off the value axis", () => {
    const months = ["Mar", "Apr", "May", "Jun", "Jul"];
    const d = data(months, {
      categories: months.map((label, i) => ({ label, raw: Date.UTC(2026, 2 + i, 1) })),
      grain: "month",
      partialFirst: true,
      partialFirstStart: Date.UTC(2026, 3, 1),
    });
    const s = spec("line", { x: { kind: "time", column: "Date", grain: "month", label: "Date" } });
    const dashed = seriesOf(sized("line", s, d))[1] as Obj;
    const label = ((dashed.data as Array<Obj | null>)[0] as Obj).label as Obj;
    expect(label.formatter).toBe("from 1 Apr");
    expect(label.position).not.toBe("left");
    expect(label.align).toBe("left");
  });

  it("drops an incomplete period's label where a peak or low marker needs the room", () => {
    const quarters = Array.from({ length: 12 }, (_, i) => `Q${i}`);
    const values = [2, 0, 3, 5, 8, 9, 12, 15, 18, 21, 26, 24];
    const d = data(quarters, {
      categories: quarters.map((label, i) => ({ label, raw: Date.UTC(2016, 6 + 3 * i, 1) })),
      series: [{ id: "m", label: "Exits", values, format: "integer" }],
      grain: "quarter",
      partialFirst: true,
      partialFirstStart: Date.UTC(2016, 7, 27),
      partialLast: true,
      partialLastEnd: Date.UTC(2019, 8, 25),
      annotations: [
        { index: 10, kind: "max", label: "Peak" },
        { index: 1, kind: "min", label: "Low" },
      ],
    });
    const s = spec("bar", { x: { kind: "time", column: "Exit date", grain: "quarter", label: "Exit date" } });
    const bars = (seriesOf(sized("bar", s, d, { width: 520 }))[0] as Obj).data as Obj[];
    // "Low 0" sits next to the first column and "Peak 26" next to the last: their text wins.
    expect(bars[0]?.label).toBeUndefined();
    expect(bars[11]?.label).toBeUndefined();
    // With the markers far away, the text stays.
    const clear = { ...d, annotations: [{ index: 6, kind: "max" as const, label: "Peak" }] };
    const kept = (seriesOf(sized("bar", s, clear, { width: 520 }))[0] as Obj).data as Obj[];
    expect((kept[0]?.label as Obj).formatter).toBe("from 27 Aug");
  });

  it("never splits a treemap name letter by letter", () => {
    const d = data(["Personal Care"], {
      kind: "treemap",
      tree: [
        {
          label: "Personal Care",
          value: 100,
          children: [
            { label: "Skincare", value: 60 },
            { label: "Haircare", value: 3 },
            { label: "Fragrance", value: 37 },
          ],
        },
      ],
    });
    const o = sized("treemap", spec("treemap"), d, { width: 340, height: 220 });
    const label = (seriesOf(o)[0] as Obj).label as Obj;
    expect(label.overflow).toBe("truncate");
    const format = label.formatter as (p: { name: string; value: number; data: Obj }) => string;
    for (const [name, value] of [
      ["Haircare", 3],
      ["Fragrance", 37],
      ["Skincare", 60],
    ] as const) {
      const text = format({ name, value, data: {} });
      // Either the whole word or no label at all (a tile too small for one).
      expect(text === "" || text.split("\n")[0] === name, `${name}: ${text}`).toBe(true);
    }
  });

  it("leaves numbers off cohort cells too narrow to hold them", () => {
    const cohorts = Array.from({ length: 12 }, (_, i) => ({
      label: `Cohort ${i}`,
      cohort: i,
      size: 900,
      retention: [1, ...Array.from({ length: 11 }, (_, k) => (k < 11 - i ? 0.12 : null))],
    }));
    const cohortSpec = spec("cohort", { analysis: "cohort" });
    const phone = sized("cohort", cohortSpec, data([], { cohorts }), { width: 340 });
    expect(((seriesOf(phone)[0] as Obj).label as Obj).show).toBe(false);
    const wide = sized("cohort", cohortSpec, data([], { cohorts }), { width: 1100 });
    expect(((seriesOf(wide)[0] as Obj).label as Obj).show).toBe(true);
  });
});
