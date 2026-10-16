/**
 * "Ask for a chart" (engine/charts/ask): phrases are read against the demo's
 * own KPIs, columns and the template's vocabulary, and the designed charts
 * follow the dataviz rules: averages for rates and scores (even when a total
 * is asked), separate charts for different units, a scatter for "A vs B",
 * stacked columns for a split, top N (without Others when the user asks for
 * the top N), a category with a period drawn over time and split, and a note
 * for every choice made on the user's behalf. Every designed chart computes,
 * and a single additive measure adds up to its overall value.
 */
import { describe, expect, it } from "vitest";
import { Session } from "@/engine/session";
import { askExamples, askFromSpec, designAsk, readAsk, type AskContext } from "@/engine/charts/ask";
import type { ChartData } from "@/engine/charts/types";

function setup(sampleId: string) {
  const s = new Session();
  const load = s.ingestSample(sampleId);
  if (load.status !== "ok") throw new Error(load.status);
  const top = load.detection.candidates[0];
  if (!top) throw new Error("not detected");
  const ctx = s.configure({ domainId: top.domainId, numberLocale: "INTL", currency: null });
  let n = 0;
  const design = (text: string) => {
    const reading = readAsk(text, ctx as AskContext);
    return { reading, ...designAsk(reading.ask, ctx as AskContext, () => `ask_${++n}`) };
  };
  const compute = (spec: Parameters<typeof s.chart>[1]["spec"]): ChartData | null =>
    s.chart([], { specId: spec?.id as string, spec }, "INTL");
  return { s, ctx, design, compute };
}

const total = (d: ChartData | null) => d?.series[0]?.values.reduce<number>((a, b) => a + (b ?? 0), 0) ?? NaN;

describe("asking the sales demo", () => {
  const { ctx, design, compute } = setup("sales");

  it("reads 'total sales and total profit by month' as one same-unit chart over time", () => {
    const { reading, charts, notes } = design("I want total sales and total profit by month");
    expect(reading.unmatched).toEqual([]);
    // "sales" is the template's word for the Revenue (INR) column.
    // "sales" is the template's word for the Revenue column, which has a Revenue KPI of the same name.
    expect(reading.notes.join(" ")).toMatch(/"sales" was read as your Revenue KPI \(the Revenue column\)/);
    expect(reading.understood).toBe("Revenue and Gross profit by month");
    expect(charts).toHaveLength(1);
    const spec = charts[0]?.spec;
    expect(spec?.x).toMatchObject({ kind: "time", grain: "month" });
    expect(spec?.measures).toHaveLength(2);
    expect(spec?.kind).toBe("line");
    expect(notes).toEqual([]);
    const data = compute(spec);
    expect(data?.empty).toBeFalsy();
    expect(data?.series).toHaveLength(2);
  });

  it("never totals a rate: 'total discount' is the amount, 'total discount %' stays a rate", () => {
    expect(design("total discount by region").reading.understood).toBe("Discounts given by Region");
    const rate = design("total discount % by region");
    expect(rate.charts[0]?.spec.measures[0]?.id).toBe("discount_rate");
    expect(rate.reading.notes.join(" ")).toMatch(
      /is a rate, so it is shown as defined: it can't be totalled/,
    );
  });

  it("averages a score column, sorted, with small groups set aside", () => {
    const { reading, charts } = design("total unit price by region");
    const spec = charts[0]?.spec;
    expect(spec?.measures[0]?.id).toBe("agg:avg:Unit Price");
    expect(reading.notes.join(" ")).toMatch(/averaged: adding it up would mean nothing/);
    expect(spec?.kind).toBe("hbar");
    expect(spec?.minGroupRows).toBe(5);
    expect(compute(spec)?.empty).toBeFalsy();
  });

  it("draws measures with different units as separate charts, never on two axes", () => {
    const { charts, notes } = design("quantity and revenue by category");
    expect(charts).toHaveLength(2);
    expect(notes.join(" ")).toMatch(/different scales, so they are drawn as separate charts/);
    for (const c of charts) expect(c.spec.measures).toHaveLength(1);
  });

  it("makes a scatter for 'A vs B by category'", () => {
    const { charts } = design("revenue vs cost by sales rep");
    expect(charts).toHaveLength(1);
    expect(charts[0]?.spec.kind).toBe("scatter");
    expect(charts[0]?.spec.measures).toHaveLength(2);
    expect(compute(charts[0]?.spec)?.empty).toBeFalsy();
  });

  it("handles top N, a split and 'or'", () => {
    const top5 = design("top 5 products by quantity").charts[0]?.spec;
    expect(top5?.x).toMatchObject({ kind: "column", column: "Product" });
    expect(top5?.topN).toBe(5);

    const split = design("revenue by category split by customer segment").charts[0]?.spec;
    expect(split?.series).toMatchObject({ kind: "column", column: "Customer Segment" });
    expect(split?.kind).toBe("stackedBar");
    expect(compute(split)?.empty).toBeFalsy();

    const either = design("revenue by city or region");
    expect(either.charts[0]?.spec.x).toMatchObject({ kind: "column", column: "Region" });
    expect(either.reading.notes.join(" ")).toMatch(/"city" or "region": Region is used/);
  });

  it("adds up to the same total whatever it is broken down by", () => {
    const { charts } = design("total quantity by region");
    const spec = charts[0]?.spec;
    expect(spec?.measures[0]?.id).toBe("agg:sum:Quantity");
    const byRegion = total(compute(spec));
    const byCategory = total(compute(design("total quantity by category").charts[0]?.spec));
    expect(byRegion).toBeGreaterThan(0);
    expect(byRegion).toBeCloseTo(byCategory, 6);
  });

  it("says which words it couldn't place, and never invents a column", () => {
    const { reading, charts, error } = design("average happiness by galaxy");
    expect(reading.unmatched).toEqual(expect.arrayContaining(["happiness", "galaxy"]));
    expect(charts).toEqual([]);
    expect(error).toMatch(/at least one thing to measure/);
  });

  it("honours a chart type that suits the data, and explains when it doesn't", () => {
    expect(design("revenue by customer segment as a pie").charts[0]?.spec.kind).toBe("donut");
    const pie = design("average discount by product pie");
    expect(pie.charts[0]?.spec.kind).not.toBe("donut");
    expect(pie.notes.join(" ")).toMatch(/doesn't suit this data/);
  });

  it("reads any chart back into its picks, so it can be changed and redesigned the same way", () => {
    for (const q of [
      "total sales and total profit by month",
      "total unit price by region",
      "revenue vs cost by sales rep",
      "revenue by category split by customer segment",
    ]) {
      const spec = design(q).charts[0]?.spec;
      const back = spec ? askFromSpec(spec) : null;
      expect(back, q).not.toBeNull();
      const again = designAsk(back as NonNullable<typeof back>, ctx as AskContext, () => "again").charts[0]
        ?.spec;
      expect(
        again?.measures.map((m) => m.id),
        q,
      ).toEqual(spec?.measures.map((m) => m.id));
      expect(again?.x, q).toEqual(spec?.x);
      expect(again?.kind, q).toBe(spec?.kind);
    }
  });

  it("suggests requests built from this file's columns only", () => {
    const examples = askExamples(ctx as AskContext);
    expect(examples.length).toBeGreaterThan(0);
    for (const e of examples) {
      const d = design(e);
      expect(d.reading.unmatched, e).toEqual([]);
      expect(d.charts.length, e).toBeGreaterThan(0);
    }
  });
});

describe("asking the e-commerce demo", () => {
  const { ctx, design, compute } = setup("ecommerce");

  it("shows just the top N when the user asks for the top N, without an Others bar", () => {
    const { charts } = design("top 5 products by units");
    const spec = charts[0]?.spec;
    expect(spec?.topN).toBe(5);
    expect(spec?.others).toBe(false);
    expect(charts[0]?.why).not.toMatch(/Others/);
    const data = compute(spec);
    expect(data?.categories.some((c) => c.isOthers)).toBe(false);
    expect(data?.categories).toHaveLength(5);
    // The same chart read back keeps "no Others".
    expect(askFromSpec(spec as NonNullable<typeof spec>)?.others).toBe(false);
    // Without "top N" the long tail is still summed as Others.
    expect(design("units by product").charts[0]?.spec.others).toBe(true);
  });

  it("draws a category with a period over time, split by the category, and says so", () => {
    const { reading, charts } = design("net revenue by courier and month");
    expect(reading.unmatched).toEqual([]);
    expect(reading.ask.by).toMatchObject({ kind: "time", grain: "month" });
    expect(reading.ask.split).toBe("Courier");
    expect(reading.notes.join(" ")).toMatch(/Shown by month, split by Courier/);
    expect(charts[0]?.spec.series).toMatchObject({ kind: "column", column: "Courier" });
  });

  it("reports a value it can't put on a chart, and keeps whole KPI names", () => {
    const r = readAsk("net revenue by state in maharashtra", ctx as AskContext);
    expect(r.unmatched).toEqual([]);
    expect(r.filterLabels).toEqual(["Customer State: Maharashtra"]);
    expect(readAsk("average order value by channel", ctx as AskContext).ask.measures).toEqual([
      { kind: "kpi", id: "aov" },
    ]);
    // "average discount" averages the Discount column: the Discounts KPI is a total.
    expect(readAsk("average discount by brand", ctx as AskContext).ask.measures).toEqual([
      { kind: "column", column: "Discount", agg: "avg" },
    ]);
  });
});

describe("asking the HR demo", () => {
  const { design, compute } = setup("hr");

  it("averages a rating by department", () => {
    const { reading, charts } = design("average performance rating by department");
    expect(reading.unmatched).toEqual([]);
    const spec = charts[0]?.spec;
    expect(spec?.x).toMatchObject({ kind: "column", column: "Department" });
    const data = compute(spec);
    for (const v of data?.series[0]?.values ?? []) if (v !== null) expect(v).toBeLessThanOrEqual(5);
  });
});
