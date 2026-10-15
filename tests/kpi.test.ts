/**
 * Known-answer KPI tests. A seven-order e-commerce file small enough to work
 * out by hand goes through the real pipeline (parse → profile → configure →
 * kpiBatch), and every value is compared with the hand-computed answer in the
 * comments. Also covers safe division, period comparison, new-customer logic
 * and KPIs that depend on KPIs from another business area.
 */
import { describe, expect, it } from "vitest";
import { Session } from "@/engine/session";
import { isRosterView } from "@/store/workspace";
import { utc } from "@/engine/core/dates";
import { presetRange } from "@/engine/core/periods";
import type { Filter } from "@/engine/query/filter";
import { domainSchema } from "@/registry/schema";
import { getDomain } from "@/registry";
import { resolveKpis, selectKpis } from "@/engine/kpi/resolve";
import { makeResolver } from "@/engine/kpi/context";
import { evaluateScalar, EMPTY_SCOPE } from "@/engine/query/evaluate";
import { isAdditiveExpr } from "@/engine/query/expr";
import { identityMapping, syntheticDataset } from "./helpers/synthetic";

// Order lines. Value classes come from the e-commerce registry keywords:
// RTO → rto, Cancelled → cancelled, Returned → returned, Delivered → delivered,
// Shipped → pending; payment COD → cod.
const CSV = `Order ID,Order Date,Customer ID,Quantity,Gross Amount,Discount,Net Amount,Payment Method,Order Status
O1,2025-01-05,C1,1,120,20,100,COD,Delivered
O1,2025-01-05,C1,2,50,0,50,COD,Delivered
O2,2025-01-20,C2,1,200,0,200,UPI,RTO
O3,2025-02-03,C1,1,100,20,80,UPI,Delivered
O4,2025-02-10,C3,3,120,0,120,COD,Cancelled
O5,2025-02-25,C2,1,60,0,60,Card,Returned
O6,2025-03-02,C4,2,90,10,80,COD,Delivered
O7,2025-03-15,C1,1,40,0,40,UPI,Shipped
`;

async function loadDemoFile() {
  const s = new Session();
  const load = await s.ingest(new Blob([CSV]), "orders.csv", {});
  if (load.status !== "ok") throw new Error(load.status);
  const ctx = s.configure({ domainId: "ecommerce", numberLocale: "IN", currency: null });
  const date = ctx.dateColumn as string;
  const value = (id: string, filters: Filter[] = []) => {
    const v = s.kpiBatch(filters, [id], "IN").values.find((x) => x.id === id);
    if (!v) throw new Error(`KPI ${id} is not available`);
    return v;
  };
  const range = (from: number, to: number): Filter[] => [{ kind: "dateRange", column: date, from, to }];
  return { s, ctx, value, range };
}

describe("e-commerce KPIs on a hand-computed file", () => {
  it("maps the columns and finds the date", async () => {
    const { ctx } = await loadDemoFile();
    expect(ctx.dateColumn).toBe("Order Date");
    expect(ctx.mapping.fields.order_status).toBe("Order Status");
    expect(ctx.mapping.classes["order_status.rto"]).toEqual(["RTO"]);
    expect(ctx.mapping.classes["payment_method.cod"]).toEqual(["COD"]);
  });

  it("computes totals, ratios and per-entity KPIs exactly", async () => {
    const { value } = await loadDemoFile();
    // Σ net amount, all rows: 100+50+200+80+120+60+80+40
    expect(value("net_sales").value).toBe(730);
    // Excluding RTO (200), cancelled (120) and returned (60)
    expect(value("net_revenue").value).toBe(350);
    expect(value("gross_sales").value).toBe(780);
    expect(value("orders").value).toBe(7);
    // O1, O3, O6, O7
    expect(value("realised_orders").value).toBe(4);
    // Ratio of sums: 350 ÷ 4, not the average of order values
    expect(value("aov").value).toBe(87.5);
    // RTO orders (O2) ÷ orders not cancelled (7 − O4)
    expect(value("rto_rate").value).toBeCloseTo(1 / 6, 12);
    // Returned (O5) ÷ delivered-or-returned (O1, O3, O6, O5)
    expect(value("return_rate").value).toBe(0.25);
    // C1 (3 orders) and C2 (2 orders) of 4 customers
    expect(value("repeat_rate").value).toBe(0.5);
    expect(value("customers").value).toBe(4);
    // COD orders O1, O4, O6 of 7
    expect(value("cod_share").value).toBeCloseTo(3 / 7, 12);
    expect(value("units").value).toBe(12);
  });

  it("counts new customers by their first-ever order, not the first in the window", async () => {
    const { value, range } = await loadDemoFile();
    // No date filter: every customer is new.
    expect(value("new_customers").value).toBe(4);
    // February: only C3 has its first order then (C1, C2 started in January).
    expect(value("new_customers", range(utc(2025, 2, 1), utc(2025, 2, 28, 23, 59, 59) + 999)).value).toBe(1);
  });

  it("compares a month with the previous month", async () => {
    const { value, range } = await loadDemoFile();
    const feb = range(utc(2025, 2, 1), utc(2025, 2, 28, 23, 59, 59) + 999);
    const orders = value("orders", feb);
    expect(orders.value).toBe(3); // O3, O4, O5
    expect(orders.previous).toBe(2); // January: O1, O2
    expect(orders.delta).toBeCloseTo(0.5, 12);
    const revenue = value("net_revenue", feb);
    expect(revenue.value).toBe(80); // only O3 is realised in February
    expect(revenue.previous).toBe(150); // January: O1 (O2 is RTO)
    expect(revenue.delta).toBeCloseTo((80 - 150) / 150, 12);
  });

  it("returns no value, never infinity or zero, when dividing by zero", async () => {
    const { value, range } = await loadDemoFile();
    // 15–25 Jan holds only O2 (RTO): no realised orders, so AOV has no value.
    const window = range(utc(2025, 1, 15), utc(2025, 1, 25, 23, 59, 59) + 999);
    expect(value("net_revenue", window).value).toBe(0);
    expect(value("aov", window).value).toBeNull();
  });
});

describe("period comparison for monthly snapshots dated on the 1st", () => {
  it("compares the last 12 snapshots with the 12 before them", async () => {
    // 24 monthly rows, Oct 2024 – Sep 2026, each dated on the 1st; 100 in year one, 150 in year two.
    const rows = ["Month,Revenue"];
    for (let i = 0; i < 24; i++) {
      const d = new Date(Date.UTC(2024, 9 + i, 1)).toISOString().slice(0, 10);
      rows.push(`${d},${i < 12 ? 100 : 150}`);
    }
    const s = new Session();
    const load = await s.ingest(new Blob([rows.join("\n")]), "monthly.csv", {});
    if (load.status !== "ok") throw new Error(load.status);
    const ctx = s.configure({ domainId: "generic", numberLocale: "IN", currency: null });
    const date = ctx.dateColumn as string;
    // The generic domain names its sum KPI after the column ("Total Revenue").
    const id = ctx.kpis.find(
      (k) => k.available && /revenue/i.test(k.name) && !/avg|average|per /i.test(k.name),
    )?.id;
    if (!id) throw new Error(`no revenue KPI among ${ctx.kpis.map((k) => k.name).join(", ")}`);
    const range = presetRange("last12m", ctx.dateBounds as { min: number; max: number });
    if (!range) throw new Error("no range");
    const batch = s.kpiBatch(
      [{ kind: "dateRange", column: date, from: range.from, to: range.to }],
      [id],
      "IN",
    );
    const v = batch.values[0];
    expect(v?.value).toBe(12 * 150);
    expect(v?.previous).toBe(12 * 100); // was 11 × 100 before the fix
    expect(batch.comparison?.from).toBe(utc(2024, 10, 1));
  });
});

describe("roster data (one row per employee)", () => {
  it("opens on the whole file and makes no period comparison", () => {
    const s = new Session();
    const load = s.ingestSample("hr");
    if (load.status !== "ok") throw new Error(load.status);
    const ctx = s.configure({ domainId: "hr", subDomainId: "employees", numberLocale: "IN", currency: null });
    expect(isRosterView(ctx)).toBe(true);
    const batch = s.kpiBatch([], ["headcount"], "IN");
    const v = batch.values.find((x) => x.id === "headcount");
    expect(batch.comparison).toBeNull();
    expect(v?.previous).toBeNull();
    expect(v?.comparisonLabel).toBe("All employees in the file · no period comparison");
    // Headcount covers everyone currently employed, not only recent hires.
    const recent = presetRange("last12m", ctx.dateBounds as { min: number; max: number });
    if (!recent) throw new Error("no range");
    const hiredLastYear = s.kpiBatch(
      [{ kind: "dateRange", column: ctx.dateColumn as string, from: recent.from, to: recent.to }],
      ["headcount"],
      "IN",
    ).values[0];
    expect(v?.value ?? 0).toBeGreaterThan(hiredLastYear?.value ?? 0);
  });

  it("keeps event data on recent activity with a comparison", () => {
    const s = new Session();
    const load = s.ingestSample("ecommerce");
    if (load.status !== "ok") throw new Error(load.status);
    const ctx = s.configure({ domainId: "ecommerce", numberLocale: "IN", currency: null });
    expect(isRosterView(ctx)).toBe(false);
  });
});

describe("additivity follows KPI references", () => {
  it("treats net revenue (built from refs) as additive and AOV as a ratio", () => {
    const domain = getDomain("ecommerce");
    if (!domain) throw new Error("no ecommerce domain");
    const ds = syntheticDataset(domain, 300, 5);
    const res = resolveKpis(domain, identityMapping(domain, ds));
    const lookup = (id: string) => res.get(id)?.variant?.expr;
    const expr = (id: string) => {
      const e = lookup(id);
      if (!e) throw new Error(`${id} unavailable`);
      return e;
    };
    expect(isAdditiveExpr(expr("net_revenue"), lookup)).toBe(true);
    expect(isAdditiveExpr(expr("net_revenue"))).toBe(false); // without a lookup, refs can't be followed
    expect(isAdditiveExpr(expr("aov"), lookup)).toBe(false);
    expect(isAdditiveExpr(expr("rto_rate"), lookup)).toBe(false);
    expect(isAdditiveExpr({ op: "mul", args: [{ num: 0.18 }, { agg: "sum", of: { field: "x" } }] })).toBe(
      true,
    );
    expect(isAdditiveExpr({ op: "add", args: [{ num: 5 }, { agg: "sum", of: { field: "x" } }] })).toBe(false);
  });
});

describe("sub-domain scoping keeps dependencies", () => {
  const domain = domainSchema.parse({
    id: "scope_test",
    name: "Scope test",
    tagline: "t",
    description: "d",
    icon: "database",
    entity: "row",
    fields: [
      { id: "amount", label: "Amount", roles: ["currency"], synonyms: ["amount", "value"], weight: 1 },
      { id: "units", label: "Units", roles: ["measure"], synonyms: ["units", "qty"], weight: 1 },
      { id: "day", label: "Day", roles: ["datetime"], synonyms: ["day", "date"], weight: 1 },
    ],
    subDomains: [
      { id: "sales", name: "Sales", description: "d", signals: ["amount"], grain: "row" },
      { id: "stock", name: "Stock", description: "d", signals: ["units"], grain: "row" },
    ],
    kpis: [
      {
        id: "total_units",
        name: "Total units",
        definition: "d",
        formula: "Σ units",
        format: "integer",
        direction: "higher",
        tier: "hero",
        priority: 1,
        group: "Stock",
        subDomains: ["stock"],
        variants: [{ id: "v1", label: "Sum", expr: { agg: "sum", of: { field: "units" } } }],
      },
      {
        id: "price_per_unit",
        name: "Price per unit",
        definition: "d",
        formula: "Σ amount ÷ total units",
        format: "currency",
        direction: "neutral",
        tier: "hero",
        priority: 2,
        group: "Sales",
        subDomains: ["sales"],
        variants: [
          {
            id: "v1",
            label: "Ratio",
            expr: { op: "div", args: [{ agg: "sum", of: { field: "amount" } }, { ref: "total_units" }] },
          },
        ],
      },
    ],
    charts: [],
    pitfalls: ["p"],
  });

  it("keeps an out-of-scope dependency for evaluation but never lists it", () => {
    const ds = syntheticDataset(domain, 200, 3);
    const mapping = identityMapping(domain, ds);
    const res = resolveKpis(domain, mapping, "sales");
    expect(res.get("price_per_unit")?.available).toBe(true);
    expect(res.get("total_units")?.dependencyOnly).toBe(true);
    const sel = selectKpis(res);
    expect([...sel.hero, ...sel.supporting, ...sel.detail]).not.toContain("total_units");
    const resolver = makeResolver(ds, mapping, res);
    const all = Int32Array.from({ length: ds.rowCount }, (_, i) => i);
    const value = evaluateScalar(res.get("price_per_unit")!.variant!.expr, resolver, EMPTY_SCOPE, all);
    expect(Number.isFinite(value)).toBe(true);
  });
});
