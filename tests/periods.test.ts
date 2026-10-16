/**
 * Periods, comparisons and KPI details (dashboard audit): a year-to-date
 * range is compared with the same days a year earlier; data recorded once a
 * month gets no day presets, monthly sparklines and no day windows in its
 * time intelligence; the last full month is the data's own last month when
 * the data runs to its end; how each KPI adds up is read from its
 * definition (kpiAggregation); a one-day range is one day; and rates near
 * 100% keep their decimal.
 */
import { describe, expect, it } from "vitest";
import { Session } from "@/engine/session";
import { formatRange, utc } from "@/engine/core/dates";
import { formatValue } from "@/engine/core/format";
import { cadenceGrain, presetAvailable, presetRange, type DatePreset } from "@/engine/core/periods";
import { kpiAggregation, planComparison } from "@/engine/kpi/compute";
import type { Expr } from "@/engine/query/expr";
import type { Filter } from "@/engine/query/filter";

function demo(id: string) {
  const s = new Session();
  const load = s.ingestSample(id);
  if (load.status !== "ok") throw new Error(load.status);
  const top = load.detection.candidates[0];
  if (!top) throw new Error(`${id}: not detected`);
  const ctx = s.configure({ domainId: top.domainId, numberLocale: "IN", currency: null });
  const bounds = ctx.dateBounds as { min: number; max: number; cadence?: "month" | "day" };
  const filtersFor = (preset: DatePreset): Filter[] => {
    const r = presetRange(preset, bounds);
    return r && ctx.dateColumn ? [{ kind: "dateRange", column: ctx.dateColumn, from: r.from, to: r.to }] : [];
  };
  return { s, ctx, bounds, filtersFor };
}

describe("comparisons", () => {
  it("compares year to date with the same days a year earlier", () => {
    const data = { min: utc(2024, 10, 1), max: utc(2026, 9, 30) };
    const plan = planComparison({ from: utc(2026, 1, 1), to: utc(2026, 9, 30, 23, 59, 59) }, data, true);
    expect(plan.label).toBe("vs 1 Jan – 30 Sep 2025");
    // A range ending mid-month compares with the same day a year earlier.
    const mid = planComparison(
      { from: utc(2026, 1, 1), to: utc(2026, 9, 20, 23, 59, 59) },
      { ...data, max: utc(2026, 9, 20) },
      true,
    );
    expect(mid.label).toBe("vs 1 Jan – 20 Sep 2025");
    // Any other month-aligned range still compares with the one before it.
    const half = planComparison({ from: utc(2026, 4, 1), to: utc(2026, 9, 30, 23, 59, 59) }, data, true);
    expect(half.label).toBe("vs 1 Oct 2025 – 31 Mar 2026");
  });

  it("reports the same YTD change on the cards as in the time intelligence", () => {
    const { s, ctx, filtersFor } = demo("ecommerce");
    const batch = s.kpiBatch(filtersFor("ytd"), ["net_revenue"], "IN");
    const card = batch.values[0];
    expect(card?.comparisonLabel).toBe("vs 1 Jan – 30 Sep 2025");
    const ti = s.timeIntel("net_revenue", filtersFor("ytd"));
    const yoy = ti.find((t) => t.key === "yoy")?.value;
    expect(card?.delta).toBeCloseTo(yoy as number, 9);
    expect(ctx.dateColumn).toBeTruthy();
  });
});

describe("data recorded once a month", () => {
  it("offers no day presets, and widens one still active to whole months", () => {
    const { bounds } = demo("saas");
    expect(bounds.cadence).toBe("month");
    expect(cadenceGrain(bounds.cadence)).toBe("month");
    expect(presetAvailable("last90d", bounds)).toBe(false);
    expect(presetAvailable("last30d", bounds)).toBe(false);
    expect(presetAvailable("last6m", bounds)).toBe(true);
    const r = presetRange("last90d", bounds);
    expect(r && new Date(r.from).getUTCDate()).toBe(1);
  });

  it("draws monthly sparklines and charts whatever the period's length", () => {
    const { s, ctx, filtersFor } = demo("saas");
    const batch = s.kpiBatch(filtersFor("last6m"), ["mrr_total"], "IN");
    expect(batch.values[0]?.sparkGrain).toBe("month");
    expect(batch.values[0]?.spark.every((p) => (p.v ?? 0) > 0)).toBe(true);
    const last = (ctx.dateBounds as { max: number }).max;
    const month: Filter[] = [
      { kind: "dateRange", column: ctx.dateColumn as string, from: last - 40 * 86_400_000, to: last },
    ];
    expect(s.kpiBatch(month, ["mrr_total"], "IN").values[0]?.sparkGrain).toBe("month");
  });

  it("has no day windows in its time intelligence, and says why", () => {
    const { s } = demo("saas");
    const ti = s.timeIntel("mrr_total", []);
    expect(ti.some((t) => /^r\d+$/.test(t.key))).toBe(false);
    const ma = ti.find((t) => t.key === "ma7");
    expect(ma?.value).toBeNull();
    expect(ma?.note).toMatch(/recorded once a month/);
    expect(ma?.basis).toBe("snapshot");
  });
});

describe("time intelligence", () => {
  it("calls the data's own last month the last full month when the data runs to its end", () => {
    const { s } = demo("ecommerce");
    const mom = s.timeIntel("net_revenue", []).find((t) => t.key === "mom");
    expect(mom?.period).toBe("September 2026 vs August 2026");
  });

  it("says why a moving average isn't offered, by how the KPI adds up", () => {
    const { s } = demo("ecommerce");
    const customers = s.timeIntel("customers", []).find((t) => t.key === "ma7");
    expect(customers?.basis).toBe("distinct");
    expect(customers?.note).toMatch(/^Not shown for distinct counts/);
    const aov = s.timeIntel("aov", []).find((t) => t.key === "ma7");
    expect(aov?.basis).toBe("ratio");
    const revenue = s.timeIntel("net_revenue", []).find((t) => t.key === "ma7");
    expect(revenue?.basis).toBe("additive");
    expect(revenue?.value).not.toBeNull();
  });
});

describe("how a KPI adds up", () => {
  const f = (field: string) => ({ field });
  const sum: Expr = { agg: "sum", of: f("amount") };
  const kpis: Record<string, Expr> = {
    revenue: sum,
    orders: { agg: "countDistinct", of: "order_id" },
    mrr: { atLatest: "month", expr: sum },
    newCustomers: { newEntities: "customer_id", date: "order_date" },
  };
  const lookup = (id: string) => kpis[id];
  it.each([
    ["a sum", sum, "additive"],
    ["a sum minus a sum", { op: "sub", args: [sum, { agg: "count" }] }, "additive"],
    ["a distinct count", kpis.orders, "distinct"],
    ["a balance on the latest date", kpis.mrr, "snapshot"],
    ["a balance scaled by 12 (ARR)", { op: "mul", args: [{ ref: "mrr" }, { num: 12 }] }, "snapshot"],
    ["new entities", kpis.newCustomers, "firstDate"],
    ["customers less new ones", { op: "sub", args: [kpis.orders, { ref: "newCustomers" }] }, "firstDate"],
    ["a ratio of sums", { op: "div", args: [sum, { ref: "orders" }] }, "ratio"],
    ["an average", { agg: "avg", of: f("amount") }, "ratio"],
    [
      "a count of entities left after a filter",
      { per: "customer_id", inner: sum, reduce: "count" },
      "distinct",
    ],
  ] as Array<[string, Expr, string]>)("reads %s as %s", (_, e, kind) => {
    expect(kpiAggregation(e, lookup)).toBe(kind);
  });
});

describe("formats", () => {
  it("writes a one-day range as that day", () => {
    expect(formatRange(utc(2026, 9, 30), utc(2026, 9, 30, 23, 59, 59))).toBe("30 Sep 2026");
    expect(formatRange(utc(2026, 9, 29), utc(2026, 9, 30))).toBe("29–30 Sep 2026");
  });

  it("keeps the decimal of rates around 100%", () => {
    const fmt = { locale: "IN" as const, currency: "INR" };
    expect(formatValue(1.004, "percent", fmt)).toBe("100.4%");
    expect(formatValue(0.997, "percent", fmt)).toBe("99.7%");
    expect(formatValue(19.41, "percent", fmt)).toBe("1,941%");
  });
});
