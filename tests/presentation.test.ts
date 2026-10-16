/**
 * Presentation rules (version 35.0): numbers in one typographic system (a
 * true minus sign, one unit per axis), dates that can't be misread ("Oct
 * 2025", the year once per year on an axis), a unit line under every chart,
 * and category colours that follow the value, not its rank in one chart.
 */
import { describe, expect, it } from "vitest";
import { formatValue } from "@/engine/core/format";
import { bucketLabel } from "@/engine/core/dates";
import { valueRanks } from "@/engine/charts/data";
import { buildOption, chartSubtitle, stableColours } from "@/ui/charts/options";
import { readChartTokens } from "@/ui/charts/tokens";
import type { Column } from "@/engine/core/types";
import type { ChartData, ChartKind, ChartSpec } from "@/engine/charts/types";

type Obj = Record<string, unknown>;
const TOKENS = readChartTokens();
const FMT = { locale: "IN" as const, currency: "INR" };

function spec(kind: ChartKind, over: Partial<ChartSpec> = {}): ChartSpec {
  return {
    id: "s",
    title: "t",
    kind,
    section: "breakdown",
    x: { kind: "column", column: "Category", label: "Category" },
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

function data(labels: string[], values: number[], over: Partial<ChartData> = {}): ChartData {
  return {
    specId: "s",
    kind: "bar",
    categories: labels.map((label) => ({ label, raw: label })),
    series: [{ id: "m", label: "Revenue", values, format: "currency" }],
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
  buildOption({ tokens: TOKENS, fmt: FMT, kind, spec: s, data: d, animate: false }) as Obj;

describe("one number system", () => {
  it("prints a true minus sign in shown numbers", () => {
    expect(formatValue(-1234, "currency", FMT)).toBe("−₹1,234");
    expect(formatValue(-0.123, "percent", FMT)).toBe("−12.3%");
    expect(formatValue(-250000, "number", { ...FMT, compact: true })).toBe("−2.5L");
  });

  it("keeps one unit on a value axis: ₹0.9L, never ₹90K beside ₹1.2L", () => {
    const o = option("bar", spec("bar"), data(["A", "B"], [90_000, 1_20_000]));
    const tick = ((o.yAxis as Obj).axisLabel as Obj).formatter as (v: number) => string;
    expect(tick(90_000)).toBe("₹0.9L");
    expect(tick(1_20_000)).toBe("₹1.2L");
    expect(tick(1_00_000)).toBe("₹1L");
    expect(tick(0)).toBe("₹0");
  });

  it("never drops a whole number's zeros", () => {
    const o = option("bar", spec("bar"), data(["A", "B"], [5_00_00_000, 10_00_00_000]));
    const tick = ((o.yAxis as Obj).axisLabel as Obj).formatter as (v: number) => string;
    expect(tick(100_00_00_000)).toBe("₹100Cr");
  });
});

describe("dates that can't be misread", () => {
  it("writes a month with its four-digit year", () => {
    expect(bucketLabel(Date.UTC(2025, 9, 1), "month")).toBe("Oct 2025");
  });

  it("puts the year on a month axis once per year", () => {
    const months = [Date.UTC(2025, 10, 1), Date.UTC(2025, 11, 1), Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1)];
    const d = data(
      months.map((t) => bucketLabel(t, "month")),
      [1, 2, 3, 4],
      { categories: months.map((t) => ({ label: bucketLabel(t, "month"), raw: t })), grain: "month" },
    );
    const s = spec("line", { x: { kind: "time", column: "Date", grain: "month", label: "Date" } });
    const label = ((option("line", s, d).xAxis as Obj).axisLabel as Obj).formatter as (
      v: string,
      i: number,
    ) => string;
    expect(months.map((_, i) => label("", i))).toEqual(["Nov 2025", "Dec", "Jan 2026", "Feb"]);
  });
});

describe("a unit line under each chart", () => {
  it("names the unit and, over time, what each point covers", () => {
    const time = spec("line", { x: { kind: "time", column: "Date", grain: "auto", label: "Date" } });
    expect(chartSubtitle(time, data(["Jan 2026"], [1], { grain: "month" }), FMT, "line")).toBe(
      "In ₹ · monthly",
    );
    const rate = spec("bar", {
      measures: [{ id: "r", label: "Rate", format: "percent", direction: "higher" }],
    });
    expect(chartSubtitle(rate, undefined, FMT, "bar")).toBe("In %");
    expect(chartSubtitle(spec("table"), undefined, FMT, "table")).toBe("");
  });
});

describe("colours that follow the value", () => {
  const col: Column = {
    kind: "string",
    name: "Category",
    codes: Int32Array.from([0, 1, 1, 2, 2, 2, 0, 1, 2]),
    dict: ["Beauty", "Apparel", "Footwear"],
  };

  it("ranks each value by its rows in the whole file", () => {
    expect([...valueRanks(col).entries()]).toEqual([
      ["Footwear", 0],
      ["Apparel", 1],
      ["Beauty", 2],
    ]);
  });

  it("gives a value the same colour whatever else is in the chart, and Others the neutral one", () => {
    const ctx = {
      tokens: TOKENS,
      fmt: FMT,
      kind: "donut" as const,
      spec: spec("donut"),
      data: data([], []),
      animate: false,
    };
    const all = stableColours(ctx, [{ rank: 0 }, { rank: 1 }, { rank: 2 }]);
    // Filtered to two values, in another order: the survivors keep their colours.
    const filtered = stableColours(ctx, [{ rank: 2 }, { rank: 1 }, { isOthers: true }]);
    expect(filtered[0]).toBe(all[2]);
    expect(filtered[1]).toBe(all[1]);
    expect(filtered[2]).toBe(TOKENS.other);
    // An item without a rank takes a free slot, never one a ranked item holds.
    const mixed = stableColours(ctx, [{}, { rank: 0 }]);
    expect(mixed[1]).toBe(TOKENS.palette[0]);
    expect(mixed[0]).not.toBe(TOKENS.palette[0]);
  });
});
