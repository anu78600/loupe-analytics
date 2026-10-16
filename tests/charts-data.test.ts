/**
 * Chart data correctness on small hand-built datasets: treemap parents and
 * stacked "Others" are evaluated from their own rows (never summed from
 * parts), partial first buckets are flagged and kept out of the peak/low
 * markers, hidden small groups are explained, RFM survives undated customers,
 * basket pairs show item values, and donuts never exceed six slices.
 */
import { describe, expect, it } from "vitest";
import type { Column, Dataset } from "@/engine/core/types";
import { DAY_MS, utc } from "@/engine/core/dates";
import type { FormatOptions } from "@/engine/core/format";
import { makeResolver } from "@/engine/kpi/context";
import { runQuery } from "@/engine/query/run";
import { binLabel } from "@/engine/query/groupby";
import type { Filter } from "@/engine/query/filter";
import { computeChartData } from "@/engine/charts/data";
import { computeBasket } from "@/engine/charts/analyses";
import { isKindCompatible } from "@/engine/charts/recommend";
import { MAX_DONUT_SLICES, type ChartMeasure, type ChartSpec } from "@/engine/charts/types";
import { Session } from "@/engine/session";

// ---------------------------------------------------------------- helpers

function dataset(columns: Column[]): Dataset {
  const first = columns[0];
  const rowCount = !first ? 0 : first.kind === "string" ? first.codes.length : first.values.length;
  return {
    id: "t",
    name: "t",
    rowCount,
    columns,
    source: { fileName: "t.csv", kind: "derived", sizeBytes: 0, isDemo: false },
  };
}
function strCol(name: string, values: Array<string | null>): Column {
  const dict: string[] = [];
  const index = new Map<string, number>();
  const codes = Int32Array.from(values, (v) => {
    if (v === null) return -1;
    let c = index.get(v);
    if (c === undefined) {
      c = dict.length;
      index.set(v, c);
      dict.push(v);
    }
    return c;
  });
  return { kind: "string", name, codes, dict };
}
const numCol = (name: string, values: number[]): Column => ({
  kind: "number",
  name,
  values: Float64Array.from(values),
  format: { integer: true, decimals: 0 },
});
const dateCol = (name: string, values: number[]): Column => ({
  kind: "date",
  name,
  values: Float64Array.from(values),
  hasTime: false,
  format: "YYYY-MM-DD",
});

const fmt: FormatOptions = { locale: "IN", currency: "INR" };
/** No mapping: measures are ad-hoc "agg:" ids and fields "col:<name>" refs. */
const resolverFor = (ds: Dataset) => makeResolver(ds, { fields: {}, scores: {}, classes: {} }, new Map());
const measure = (id: string, label = "Value"): ChartMeasure => ({
  id,
  label,
  format: "integer",
  direction: "higher",
});

function spec(overrides: Partial<ChartSpec> & Pick<ChartSpec, "kind" | "x" | "measures">): ChartSpec {
  return {
    id: "test",
    title: "Test chart",
    section: "breakdown",
    reason: "Test.",
    alternatives: [],
    size: { w: 6, h: 4 },
    priority: 1,
    modes: ["analyst"],
    source: "custom",
    ...overrides,
  };
}

const DISTINCT_CUSTOMERS = "agg:countDistinct:Customer";

// ---------------------------------------------------------------- treemap and stacked bars

describe("two-level charts", () => {
  it("evaluates a treemap parent over its own rows, like a direct group query", () => {
    // c1 buys in both sub-categories of A, c4 in both of B: parents count each customer once.
    const rows: Array<[string, string, string]> = [
      ["A", "a1", "c1"],
      ["A", "a1", "c2"],
      ["A", "a2", "c1"],
      ["A", "a2", "c3"],
      ["B", "b1", "c4"],
      ["B", "b2", "c4"],
      ["B", "b2", "c5"],
    ];
    const ds = dataset([
      strCol(
        "Category",
        rows.map((r) => r[0]),
      ),
      strCol(
        "Sub",
        rows.map((r) => r[1]),
      ),
      strCol(
        "Customer",
        rows.map((r) => r[2]),
      ),
    ]);
    const resolver = resolverFor(ds);
    const data = computeChartData({
      ds,
      resolver,
      spec: spec({
        kind: "treemap",
        x: { kind: "column", column: "Category", label: "Category" },
        series: { kind: "column", column: "Sub", label: "Sub" },
        measures: [measure(DISTINCT_CUSTOMERS)],
      }),
      filters: [],
      dateColumn: null,
      fmt,
    });
    const direct = runQuery(ds, resolver, {
      filters: [],
      groupBy: [{ kind: "column", column: "Category" }],
      measures: [{ id: "m", expr: resolver.kpi(DISTINCT_CUSTOMERS) }],
    });
    const expected = new Map(direct.groups.map((g) => [g.labels[0]?.label, g.values[0]]));
    expect(data.tree?.map((n) => [n.label, n.value])).toEqual([
      ["A", 3],
      ["B", 2],
    ]);
    for (const node of data.tree ?? []) {
      expect(node.value, node.label).toBe(expected.get(node.label));
      // Summing the children would double-count the shared customers.
      const childSum = (node.children ?? []).reduce((s, c) => s + (c.value ?? 0), 0);
      expect(childSum, node.label).toBeGreaterThan(node.value as number);
    }
  });

  it("folds stacked series beyond eight into an Others segment recomputed from its rows", () => {
    // Twelve products in two regions; product p (1–12) is bought by customers
    // C1…C(13 − p), so the small products share their customers.
    const region: string[] = [];
    const product: string[] = [];
    const customer: string[] = [];
    for (const r of ["North", "South"]) {
      for (let p = 1; p <= 12; p++) {
        for (let c = 1; c <= 13 - p; c++) {
          region.push(r);
          product.push(`P${String(p).padStart(2, "0")}`);
          customer.push(`C${c}`);
        }
      }
    }
    const ds = dataset([strCol("Region", region), strCol("Product", product), strCol("Customer", customer)]);
    const resolver = resolverFor(ds);
    const data = computeChartData({
      ds,
      resolver,
      spec: spec({
        kind: "stackedBar",
        x: { kind: "column", column: "Region", label: "Region" },
        series: { kind: "column", column: "Product", label: "Product" },
        measures: [measure(DISTINCT_CUSTOMERS)],
      }),
      filters: [],
      dateColumn: null,
      fmt,
    });
    // Seven largest products plus Others: eight segments, one per palette colour.
    expect(data.seriesCategories?.map((c) => c.label)).toEqual([
      "P01",
      "P02",
      "P03",
      "P04",
      "P05",
      "P06",
      "P07",
      "Others",
    ]);
    expect(data.seriesCategories?.at(-1)?.isOthers).toBe(true);
    expect(data.series.map((s) => s.label)).toEqual(data.seriesCategories?.map((c) => c.label));
    const others = data.series.at(-1)?.values ?? [];
    // Others = distinct customers of P08–P12 per region, from the rows: C1…C5.
    const kept = ["P01", "P02", "P03", "P04", "P05", "P06", "P07"];
    const direct = runQuery(ds, resolver, {
      filters: [{ kind: "in", column: "Product", values: kept, exclude: true }],
      groupBy: [{ kind: "column", column: "Region" }],
      measures: [{ id: "m", expr: resolver.kpi(DISTINCT_CUSTOMERS) }],
    });
    const byRegion = new Map(direct.groups.map((g) => [g.labels[0]?.label, g.values[0]]));
    data.categories.forEach((c, i) => {
      expect(others[i], c.label).toBe(byRegion.get(c.label));
      expect(others[i], c.label).toBe(5);
    });
    // Summing the folded series (5 + 4 + 3 + 2 + 1) would claim 15 customers.
    expect(data.matrix?.length).toBe(8);
    expect(data.notes.some((n) => /5 smallest of 12 series are combined into Others/.test(n))).toBe(true);
  });
});

// ---------------------------------------------------------------- time axis

describe("time axis", () => {
  // 100 a day from 15 Jan to 30 Jun 2025: January holds only 17 days.
  const dates: number[] = [];
  for (let t = utc(2025, 1, 15); t <= utc(2025, 6, 30); t += DAY_MS) dates.push(t);
  const ds = dataset([
    dateCol("Date", dates),
    numCol(
      "Amount",
      dates.map(() => 100),
    ),
  ]);
  const chart = spec({
    kind: "bar",
    section: "trend",
    x: { kind: "time", column: "Date", grain: "month", label: "Date" },
    measures: [measure("agg:sum:Amount", "Amount")],
  });

  it("flags a first bucket that starts before the data and keeps it out of the peak/low markers", () => {
    const data = computeChartData({
      ds,
      resolver: resolverFor(ds),
      spec: chart,
      filters: [],
      dateColumn: "Date",
      fmt,
    });
    expect(data.categories[0]?.label).toBe("Jan 2025");
    expect(data.series[0]?.values[0]).toBe(1700);
    expect(data.partialFirst).toBe(true);
    expect(data.partialLast).toBeUndefined();
    expect(data.notes).toContain("January 2025 is incomplete (data starts 2025-01-15).");
    // January is the lowest bucket only because it is partial: the low marker goes to February.
    expect(data.annotations.some((a) => a.index === 0)).toBe(false);
    expect(data.annotations.find((a) => a.kind === "min")?.index).toBe(1);
  });

  it("flags a first bucket cut by the date filter", () => {
    const filters: Filter[] = [
      { kind: "dateRange", column: "Date", from: utc(2025, 3, 10), to: utc(2025, 6, 30) },
    ];
    const data = computeChartData({
      ds,
      resolver: resolverFor(ds),
      spec: chart,
      filters,
      dateColumn: "Date",
      fmt,
    });
    expect(data.partialFirst).toBe(true);
    expect(data.notes).toContain("March 2025 is incomplete (data starts 2025-03-10).");
  });
});

// ---------------------------------------------------------------- category charts

describe("category charts", () => {
  // Rows per category: A 100, B 50, C 10, D 5.
  const counts: Array<[string, number]> = [
    ["A", 100],
    ["B", 50],
    ["C", 10],
    ["D", 5],
  ];
  const ds = dataset([
    strCol(
      "Category",
      counts.flatMap(([c, n]) => Array.from({ length: n }, () => c)),
    ),
  ]);
  const x = { kind: "column", column: "Category", label: "Category" } as const;

  it("says how many small groups are hidden and why", () => {
    const data = computeChartData({
      ds,
      resolver: resolverFor(ds),
      spec: spec({ kind: "table", x, measures: [measure("agg:count:")], minGroupRows: 30 }),
      filters: [],
      dateColumn: null,
      fmt,
    });
    expect(data.categories.map((c) => c.label)).toEqual(["A", "B"]);
    expect(data.notes).toContain("2 groups with fewer than 30 rows are hidden as too small to compare.");
    expect(data.suppressed).toBe(2);
  });

  it("says when small groups are counted in Others instead", () => {
    const data = computeChartData({
      ds,
      resolver: resolverFor(ds),
      spec: spec({
        kind: "hbar",
        x,
        measures: [measure("agg:count:")],
        topN: 1,
        others: true,
        minGroupRows: 30,
      }),
      filters: [],
      dateColumn: null,
      fmt,
    });
    expect(data.categories.map((c) => c.label)).toEqual(["A", "Others"]);
    expect(data.series[0]?.values).toEqual([100, 65]);
    expect(data.notes).toContain(
      "2 groups with fewer than 30 rows are counted in Others rather than shown on their own.",
    );
  });
});

describe("donuts", () => {
  const donut = (n: number) => {
    // Category i has 10 × (n − i) rows, so the order is fixed.
    const values = Array.from({ length: n }, (_, i) =>
      Array.from({ length: 10 * (n - i) }, () => `K${i + 1}`),
    ).flat();
    const ds = dataset([strCol("Category", values)]);
    return computeChartData({
      ds,
      resolver: resolverFor(ds),
      spec: spec({
        kind: "donut",
        x: { kind: "column", column: "Category", label: "Category" },
        measures: [measure("agg:count:")],
      }),
      filters: [],
      dateColumn: null,
      fmt,
      topN: 12,
    });
  };

  it("never draws more than six slices, Others included", () => {
    const six = donut(6);
    expect(six.categories.map((c) => c.label)).toEqual(["K1", "K2", "K3", "K4", "K5", "K6"]);
    const seven = donut(7);
    expect(seven.categories.map((c) => c.label)).toEqual(["K1", "K2", "K3", "K4", "K5", "Others"]);
    // Others holds K6 and K7: 20 + 10 rows, so the slices still add up to the whole.
    expect(seven.series[0]?.values.at(-1)).toBe(30);
    expect(seven.series[0]?.values.reduce<number>((s, v) => s + (v ?? 0), 0)).toBe(280);
    expect(
      isKindCompatible(
        "donut",
        spec({
          kind: "donut",
          x: { kind: "column", column: "Category", label: "Category" },
          measures: [measure("agg:count:")],
        }),
        7,
      ),
    ).toBe(false);
    expect(MAX_DONUT_SLICES).toBe(6);
  });

  it("keeps the e-commerce payment mix at six slices, even when asked for more", () => {
    const s = new Session();
    const load = s.ingestSample("ecommerce");
    if (load.status !== "ok") throw new Error(load.status);
    const ctx = s.configure({ domainId: "ecommerce", numberLocale: "IN", currency: null });
    const mix = ctx.charts.find((c) => c.id === "payment_mix");
    expect(mix?.kind).toBe("donut");
    for (const topN of [undefined, 10]) {
      const data = s.chart([], { specId: "payment_mix", topN }, "IN");
      expect(data?.categories.length).toBeLessThanOrEqual(6);
      expect(data?.categories.at(-1)?.isOthers).toBe(true);
    }
    // The recommended spec already fits: top N plus Others stays within six slices.
    expect((mix?.topN ?? 0) + (mix?.others === false ? 0 : 1)).toBeLessThanOrEqual(6);
  });
});

// ---------------------------------------------------------------- analyses

describe("analyses", () => {
  it("returns no RFM segments, without throwing, when no customer has a dated order", () => {
    const ds = dataset([
      strCol("Customer", ["c1", "c2", "c3"]),
      dateCol("Order Date", [NaN, NaN, NaN]),
      strCol("Order ID", ["o1", "o2", "o3"]),
      numCol("Amount", [10, 20, 30]),
    ]);
    const rfm = spec({
      kind: "treemap",
      x: { kind: "none" },
      measures: [measure(DISTINCT_CUSTOMERS)],
      analysis: "rfm",
      analysisParams: {
        customer: "Customer",
        date: "Order Date",
        order: "Order ID",
        monetary: "agg:sum:Amount",
      },
    });
    const run = () =>
      computeChartData({
        ds,
        resolver: resolverFor(ds),
        spec: rfm,
        filters: [],
        dateColumn: "Order Date",
        fmt,
      });
    expect(run).not.toThrow();
    const data = run();
    expect(data.empty).toBe(true);
    expect(data.notes).toEqual(["No customers in this selection."]);
  });

  it("labels basket pairs of a numeric item column with the item values", () => {
    // Orders 1–6 hold items 501 and 502, orders 1–3 also 777; orders 7–10 hold 903 alone.
    const order: string[] = [];
    const item: number[] = [];
    for (let o = 1; o <= 10; o++) {
      const items = o <= 6 ? [501, 502, ...(o <= 3 ? [777] : [])] : [903];
      for (const it of items) {
        order.push(`O${o}`);
        item.push(it);
      }
    }
    const ds = dataset([strCol("Order ID", order), numCol("SKU", item)]);
    const out = computeBasket(ds, [], { order: "Order ID", item: "SKU" });
    const labels = new Set(out.pairs.flatMap((p) => [p.a, p.b]));
    expect(labels).toEqual(new Set(["501", "502", "777"]));
    const top = out.pairs.find((p) => p.orders === 6);
    expect([top?.a, top?.b].sort()).toEqual(["501", "502"]);
  });
});

// ---------------------------------------------------------------- empty-looking charts (34.2)

describe("charts that would look broken", () => {
  const ds = dataset([
    strCol("Courier", ["DTDC", "DTDC", "Blue Dart", null, null]),
    numCol("Refund", [0, 0, 0, 0, 0]),
    numCol("Amount", [10, 25, 30, 0, 0]),
  ]);
  const resolver = resolverFor(ds);
  const chart = (measureId: string, label: string) =>
    computeChartData({
      ds,
      resolver,
      spec: spec({
        kind: "hbar",
        x: { kind: "column", column: "Courier", label: "Courier" },
        measures: [measure(measureId, label)],
      }),
      filters: [],
      dateColumn: null,
      fmt,
    });

  it("say in words when every value is zero, instead of drawing bars of no height", () => {
    const data = chart("agg:sum:Refund", "Refunds");
    expect(data.empty).toBe(true);
    expect(data.notes[0]).toBe("Refunds is 0 for every Courier in this selection.");
  });

  it("leave out a (blank) group that has no value either, and say so", () => {
    const data = chart("agg:sum:Amount", "Amount");
    expect(data.empty).toBe(false);
    expect(data.categories.map((c) => c.label)).toEqual(["DTDC", "Blue Dart"]);
    expect(data.notes).toContain("2 rows with no Courier and no value are left out.");
  });
});

// ---------------------------------------------------------------- dashboard audit

describe("what a chart says it shows (dashboard audit)", () => {
  // 24 states, each with a rate that falls with its position, and fewer rows the further down.
  const states = Array.from({ length: 24 }, (_, i) => `State ${String(i + 1).padStart(2, "0")}`);
  const rows: Array<[string, number]> = [];
  states.forEach((s, i) => {
    for (let k = 0; k < 40; k++) rows.push([s, k < 24 - i ? 1 : 0]);
  });
  const ds = dataset([
    strCol(
      "Customer State",
      rows.map((r) => r[0]),
    ),
    numCol(
      "RTO",
      rows.map((r) => r[1]),
    ),
  ]);
  const resolver = resolverFor(ds);
  const rate = {
    id: "agg:avg:RTO",
    label: "RTO rate",
    format: "percent" as const,
    direction: "lower" as const,
  };
  const chart = (over: Partial<ChartSpec>) =>
    computeChartData({
      ds,
      resolver,
      spec: spec({
        kind: "hbar",
        x: { kind: "column", column: "Customer State", label: "Customer State" },
        measures: [rate],
        ...over,
      }),
      filters: [],
      dateColumn: null,
      fmt,
    });

  it("notes a top N and calls the lowest bar the lowest of those shown", () => {
    const data = chart({ topN: 12, others: false });
    expect(data.categories).toHaveLength(12);
    expect(data.notes[0]).toBe("Showing the top 12 of 24 customer states by RTO rate.");
    expect(data.headline).toMatch(/is lowest of the 12 shown, at /);
  });

  it("says how many are folded into Others", () => {
    const data = chart({ topN: 10, others: true });
    expect(data.notes[0]).toBe(
      "Showing the top 10 of 24 customer states by RTO rate; the other 14 are combined in Others.",
    );
  });

  it("makes no such note when every group is drawn", () => {
    const data = chart({ topN: 30 });
    expect(data.notes.join(" ")).not.toContain("Showing the top");
    expect(data.headline).toMatch(/is lowest at /);
  });

  it("heads its table and CSV with the axis as drawn", () => {
    expect(chart({}).axisLabel).toBe("Customer State");
  });
});

describe("two-key charts keep their axes' natural order", () => {
  it("orders levels L1, L2 … L10, not as rows first show them", () => {
    const levels = ["L1", "L10", "L4", "L2", "L3", "L1", "L4"];
    const genders = ["Male", "Female", "Male", "Female", "Male", "Female", "Male"];
    const ds = dataset([
      strCol("Level", levels),
      strCol("Gender", genders),
      numCol("Salary", [1, 2, 3, 4, 5, 6, 7]),
    ]);
    const data = computeChartData({
      ds,
      resolver: resolverFor(ds),
      spec: spec({
        kind: "heatmap",
        x: { kind: "column", column: "Level", label: "Level" },
        series: { kind: "column", column: "Gender", label: "Gender" },
        measures: [measure("agg:avg:Salary")],
      }),
      filters: [],
      dateColumn: null,
      fmt,
    });
    expect(data.categories.map((c) => c.label)).toEqual(["L1", "L2", "L3", "L4", "L10"]);
    expect(data.seriesCategories?.map((c) => c.label)).toEqual(["Female", "Male"]);
    // Each cell is still its own level's value (rows = genders, columns = levels).
    expect(data.matrix?.[1]?.[0]).toBe(1); // Male, L1
    expect(data.matrix?.[1]?.[3]).toBe(5); // Male, L4: the average of 3 and 7
    expect(data.matrix?.[0]?.[4]).toBe(2); // Female, L10
  });
});

describe("a measure that can't be computed any more", () => {
  const ds = dataset([strCol("Channel", ["A", "B"]), numCol("Amount", [1, 2])]);
  const run = (measureIssue?: (id: string) => string | undefined) =>
    computeChartData({
      ds,
      resolver: resolverFor(ds),
      spec: spec({
        kind: "bar",
        x: { kind: "column", column: "Channel", label: "Channel" },
        measures: [{ id: "uk_margin", label: "My margin", format: "currency", direction: "higher" }],
      }),
      filters: [],
      dateColumn: null,
      fmt,
      measureIssue,
    });

  it("is named, with why, in the Customise list's words", () => {
    const data = run();
    expect(data.empty).toBe(true);
    expect(data.notes[0]).toMatch(/^It shows “My margin”, a KPI you made in Customise that was deleted/);
    // The caller's own reason, when it knows it, is used as it is.
    const known = "It shows “My margin”, a KPI you deleted. Choose another measure, or delete this chart.";
    expect(run(() => known).notes[0]).toBe(known);
  });

  it("says which column a chart reads when the file doesn't have it", () => {
    const data = computeChartData({
      ds,
      resolver: resolverFor(ds),
      spec: spec({
        kind: "bar",
        x: { kind: "column", column: "Channel", label: "Channel" },
        measures: [measure("agg:sum:Discount")],
      }),
      filters: [],
      dateColumn: null,
      fmt,
    });
    expect(data.notes[0]).toBe(
      "It uses Discount, which isn't in this file. Delete this chart, or load the file it was made for.",
    );
  });
});

describe("time axes follow the data's cadence", () => {
  // Monthly snapshots: one row per account per month, dated on the 1st.
  const months = Array.from({ length: 12 }, (_, i) => utc(2025, 10 + i, 1));
  const ds = dataset([
    dateCol(
      "Month",
      months.flatMap((m) => [m, m]),
    ),
    numCol(
      "MRR",
      months.flatMap((_, i) => [100 + i, 50 + i]),
    ),
  ]);
  it("never buckets monthly snapshots more finely than a month, whatever the filter's span", () => {
    const last = months[months.length - 1] as number;
    const data = computeChartData({
      ds,
      resolver: resolverFor(ds),
      spec: spec({
        kind: "line",
        section: "trend",
        x: { kind: "time", column: "Month", grain: "auto", label: "Month" },
        measures: [measure("agg:sum:MRR")],
      }),
      filters: [{ kind: "dateRange", column: "Month", from: last - 60 * DAY_MS, to: last + 29 * DAY_MS }],
      dateColumn: "Month",
      fmt,
      grain: "week",
    });
    expect(data.grain).toBe("month");
    expect(
      data.categories.every((c) => typeof c.raw === "number" && new Date(c.raw).getUTCDate() === 1),
    ).toBe(true);
  });

  it("gives week labels their year when the weeks run into a second year", () => {
    const days = [utc(2025, 12, 1), utc(2025, 12, 20), utc(2026, 1, 10), utc(2026, 2, 1)];
    const wds = dataset([dateCol("Date", days), numCol("Amount", [1, 2, 3, 4])]);
    const data = computeChartData({
      ds: wds,
      resolver: resolverFor(wds),
      spec: spec({
        kind: "bar",
        section: "trend",
        x: { kind: "time", column: "Date", grain: "week", label: "Date" },
        measures: [measure("agg:sum:Amount")],
      }),
      filters: [],
      dateColumn: "Date",
      fmt,
    });
    expect(data.categories[0]?.label).toBe("Wk of 1 Dec 2025");
    expect(data.categories[data.categories.length - 1]?.label).toBe("Wk of 26 Jan 2026");
  });
});

describe("band labels", () => {
  it("carry the currency on money bands and one number of decimals per band", () => {
    expect(binLabel(0, 1000, "currency", { currencySymbol: "₹", locale: "IN" })).toBe("₹0–₹1K");
    expect(binLabel(100000, 200000, "currency", { currencySymbol: "₹", locale: "IN" })).toBe("₹1L–₹2L");
    expect(binLabel(0, 0.05, "percent")).toBe("0%–5%");
    expect(binLabel(0.025, 0.05, "percent")).toBe("2.5%–5.0%");
    expect(binLabel(1, 2, "number")).toBe("1–2");
  });
});

describe("the session's chart outputs", () => {
  it("heads a chart's CSV with its axis and rounds the float noise of sums", () => {
    const s = new Session();
    const load = s.ingestSample("ecommerce");
    if (load.status !== "ok") throw new Error(load.status);
    const top = load.detection.candidates[0];
    if (!top) throw new Error("not detected");
    const ctx = s.configure({ domainId: top.domainId, numberLocale: "IN", currency: null });
    const spec = ctx.charts.find((c) => c.id === "revenue_by_state");
    if (!spec) throw new Error("no state chart");
    s.chart([], { specId: spec.id }, "IN");
    const [header, first] = s.chartCsv(spec.id).split("\r\n");
    expect(header).toBe("Customer State,Net revenue,Rows");
    // At most two decimals for money summed over thousands of rows ("5028010.51000001" before).
    expect(first).toMatch(/^[^,]+,\d+(\.\d{1,2})?,\d+$/);
  });

  it("calls a renamed KPI by its new name in every chart that shows it", () => {
    const s = new Session();
    const load = s.ingestSample("ecommerce");
    if (load.status !== "ok") throw new Error(load.status);
    const top = load.detection.candidates[0];
    if (!top) throw new Error("not detected");
    const ctx = s.configure({
      domainId: top.domainId,
      numberLocale: "IN",
      currency: null,
      kpiRenames: { net_revenue: "Sales" },
    });
    const uses = ctx.charts.filter((c) => c.measures.some((m) => m.id === "net_revenue"));
    expect(uses.length).toBeGreaterThan(2);
    for (const c of uses) expect(c.measures.find((m) => m.id === "net_revenue")?.label, c.id).toBe("Sales");
    expect(ctx.charts.find((c) => c.id === "trend_revenue")?.title).toBe("Sales over time");
    const table = s.chart([], { specId: "top_products" }, "IN");
    expect(table?.series.map((x) => x.label)).toContain("Sales");
  });
});
