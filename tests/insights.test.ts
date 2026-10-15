/**
 * Insight generation: ranking (the headline trend leads), segment gaps only
 * for rates and ratios, guards against undefined ratios (a weekday that
 * averages zero) and partial months, KPI renames in the text, and insights
 * after a reload never reading the previous dataset's dashboard. Demo
 * figures are never hard-coded: expectations are derived from the engine's
 * own KPI batch, so the tests survive changes to the demo generator.
 */
import { describe, expect, it } from "vitest";
import type { Column, Dataset } from "@/engine/core/types";
import { addDays, DAY_MS, utc } from "@/engine/core/dates";
import { formatDelta } from "@/engine/core/format";
import { defaultPreset, presetRange } from "@/engine/core/periods";
import { isAdditiveExpr, type Expr } from "@/engine/query/expr";
import type { Filter } from "@/engine/query/filter";
import { makeResolver } from "@/engine/kpi/context";
import { resolveKpis } from "@/engine/kpi/resolve";
import {
  generateInsights,
  measureKind,
  signTestP,
  type InsightInput,
  type InsightKpi,
} from "@/engine/insights/insights";
import { Session, type ContextRequest } from "@/engine/session";
import { getDomain } from "@/registry";

// ---------------------------------------------------------------- helpers

function dataset(columns: Column[]): Dataset {
  const rowCount = columns[0]
    ? "codes" in columns[0]
      ? columns[0].codes.length
      : columns[0].values.length
    : 0;
  return {
    id: "t",
    name: "t",
    rowCount,
    columns,
    source: { fileName: "t.csv", kind: "derived", sizeBytes: 0, isDemo: false },
  };
}
const dateCol = (name: string, values: number[]): Column => ({
  kind: "date",
  name,
  values: Float64Array.from(values),
  hasTime: false,
  format: "YYYY-MM-DD",
});
const numCol = (name: string, values: number[]): Column => ({
  kind: "number",
  name,
  values: Float64Array.from(values),
  format: { integer: false, decimals: 2 },
});

/** Input for generateInsights over a hand-built dataset: no mapping, no batch, every column addressed as col:<name>. */
function input(ds: Dataset, kpis: InsightKpi[], dateColumn: string): InsightInput {
  return {
    ds,
    resolver: makeResolver(ds, { fields: {}, scores: {}, classes: {} }, new Map()),
    filters: [],
    dateColumn,
    kpis,
    batch: null,
    segments: [],
    specs: [],
    chartData: new Map(),
    fmt: { locale: "IN", currency: "INR" },
  };
}

/** The e-commerce demo with the dashboard's default preset computed, as the app does before showing insights. */
function demo(extra: Partial<ContextRequest> = {}) {
  const session = new Session();
  const load = session.ingestSample("ecommerce");
  if (load.status !== "ok") throw new Error(load.status);
  const ctx = session.configure({ domainId: "ecommerce", numberLocale: "IN", currency: null, ...extra });
  if (!ctx.dateColumn || !ctx.dateBounds) throw new Error("no date column");
  const range = presetRange(defaultPreset(ctx.dateBounds), ctx.dateBounds);
  const filters: Filter[] = range
    ? [{ kind: "dateRange", column: ctx.dateColumn, from: range.from, to: range.to }]
    : [];
  const batch = session.kpiBatch(filters, [...ctx.selection.hero, ...ctx.selection.supporting], "IN");
  for (const spec of ctx.charts) session.chart(filters, { specId: spec.id }, "IN");
  return { session, ctx, batch, filters, insights: session.insights("IN") };
}

// ---------------------------------------------------------------- ranking and segment gaps

describe("insights on the e-commerce demo", () => {
  const { ctx, batch, insights } = demo();
  const lead = ctx.selection.hero[0] as string;

  it("leads with the headline trend: the lead KPI over the selected period vs its comparison period", () => {
    expect(defaultPreset(ctx.dateBounds)).toBe("last12m");
    const first = insights[0];
    expect(first?.kind).toBe("trend");
    expect(first?.metricId).toBe(lead);
    expect(first?.id).toBe(`trend-period-${lead}`);
    // Same windows and number as the KPI card, and the change is consistent month by month.
    const delta = batch.values.find((v) => v.id === lead)?.delta as number;
    expect(Math.abs(delta)).toBeGreaterThan(0.05);
    expect(first?.title).toContain(formatDelta(delta, "IN").replace(/^[+−]/, ""));
    expect(first?.confidence).toBe("high");
    const agree = /It was (?:higher|lower) in (\d+) of 12 months than the same month a year earlier\./.exec(
      first?.body ?? "",
    );
    expect(Number(agree?.[1])).toBeGreaterThanOrEqual(10);
    // It outranks every segment comparison.
    for (const i of insights.filter((x) => x.kind === "segment"))
      expect(first?.impact ?? 0).toBeGreaterThan(i.impact);
  });

  it("compares segments on rates and ratios only, never on totals", () => {
    const domain = getDomain("ecommerce");
    if (!domain) throw new Error("no domain");
    const res = resolveKpis(domain, ctx.mapping, ctx.subDomainId);
    const lookup = (id: string): Expr | undefined => res.get(id)?.variant?.expr;
    const segments = insights.filter((i) => i.kind === "segment");
    expect(segments.length).toBeGreaterThan(0);
    // A difference in revenue, orders or customers between payment methods is a share, not a gap.
    for (const total of [
      "net_revenue",
      "gross_sales",
      "orders",
      "customers",
      "new_customers",
      "units",
      "gross_profit",
    ]) {
      expect(
        segments.some((i) => i.metricId === total),
        total,
      ).toBe(false);
    }
    expect(insights.some((i) => /^(Net Revenue|Orders|Customers|New customers): /.test(i.title))).toBe(false);
    for (const i of segments) {
      const expr = lookup(i.metricId as string) as Expr;
      expect(isAdditiveExpr(expr, lookup), i.title).toBe(false);
      expect(measureKind(expr, lookup), i.title).toBe("rate");
    }
  });

  it("scores on the shared 0–100 scale and states a basis for every insight", () => {
    for (const i of insights) {
      expect(i.impact).toBeGreaterThan(0);
      expect(i.impact).toBeLessThanOrEqual(100);
      expect(i.basis.length).toBeGreaterThan(10);
    }
    expect([...insights].sort((a, b) => b.impact - a.impact).map((i) => i.id)).toEqual(
      insights.map((i) => i.id),
    );
  });
});

describe("sign test", () => {
  it("matches the binomial tails", () => {
    expect(signTestP(12, 12)).toBeCloseTo(2 / 4096, 10);
    expect(signTestP(10, 12)).toBeCloseTo((2 * (1 + 12 + 66)) / 4096, 10);
    // Two-sided: a lopsided split the other way is just as unlikely, but the generator only trusts agreement.
    expect(signTestP(2, 12)).toBeCloseTo(signTestP(10, 12), 10);
    expect(signTestP(0, 0)).toBe(1);
  });
});

// ---------------------------------------------------------------- guards

describe("weekday rhythm", () => {
  it("names a weekday that averages zero instead of dividing by it", () => {
    // Twelve weeks from Monday 6 Jan 2025: 10 orders a weekday, 15 on Saturday, none on Sunday.
    const dates: number[] = [];
    for (let d = 0; d < 84; d++) {
      const t = addDays(utc(2025, 1, 6), d);
      const dow = d % 7; // 0 = Monday
      const n = dow === 6 ? 0 : dow === 5 ? 15 : 10;
      for (let i = 0; i < n; i++) dates.push(t);
    }
    const ds = dataset([dateCol("Order Date", dates)]);
    const orders: InsightKpi = {
      id: "orders",
      name: "Orders",
      expr: { agg: "count" },
      format: "integer",
      direction: "higher",
      tier: "hero",
    };
    const out = generateInsights(input(ds, [orders], "Order Date"));
    const dow = out.find((i) => i.id === "seasonality-dow-orders");
    expect(dow?.title).toBe("Sat is the strongest day for Orders");
    expect(dow?.body).toContain("brings 50% more orders than an average Mon");
    expect(dow?.body).toContain("Sun averages 0");
    for (const i of out) expect(`${i.title} ${i.body}`, i.id).not.toMatch(/\d{4,}%|Infinity|NaN/);
  });
});

describe("monthly trend", () => {
  it("leaves out a partial first month", () => {
    // Daily revenue from 20 Jan to 31 Jul 2025: a huge partial January, then
    // 100 × month number per day (Feb = 1 … Jul = 6), a clean upward line.
    const dates: number[] = [];
    const amounts: number[] = [];
    for (let t = utc(2025, 1, 20); t <= utc(2025, 7, 31); t += DAY_MS) {
      const month = new Date(t).getUTCMonth(); // 0 = January
      dates.push(t);
      amounts.push(month === 0 ? 5000 : 100 * month);
    }
    const ds = dataset([dateCol("Date", dates), numCol("Amount", amounts)]);
    const revenue: InsightKpi = {
      id: "revenue",
      name: "Revenue",
      expr: { agg: "sum", of: { field: "col:Amount" } },
      format: "currency",
      direction: "higher",
      tier: "hero",
    };
    const trend = generateInsights(input(ds, [revenue], "Date")).find(
      (i) => i.kind === "trend" && i.metricId === "revenue",
    );
    // The regression runs over February to July only; with January it would cover 7 months.
    expect(trend?.body).toContain("Over the last 6 complete months the trend is upward");
    expect(trend?.basis).toContain("the partial first month (January 2025) is excluded");
    // July (31 × 600) against June (30 × 500): +24.0%.
    expect(trend?.title).toBe("Revenue up 24.0% in July 2025 vs June 2025");
  });
});

// ---------------------------------------------------------------- session wiring

describe("insights through the session", () => {
  it("use the user's KPI names", () => {
    const { insights } = demo({ kpiRenames: { net_revenue: "Sales after returns" } });
    const about = insights.filter((i) => i.metricId === "net_revenue");
    expect(about.length).toBeGreaterThan(0);
    for (const i of about) {
      expect(`${i.title} ${i.body}`).toContain("Sales after returns");
      expect(`${i.title} ${i.body}`).not.toContain("Net Revenue");
    }
  });

  it("forget the previous dataset's dashboard after a new load", () => {
    const { session, ctx } = demo();
    // The last two hours of the e-commerce data: a handful of rows, which raises the small-selection caveat.
    const end = ctx.dateBounds?.max as number;
    const filters: Filter[] = [
      { kind: "dateRange", column: ctx.dateColumn as string, from: end - 2 * 3_600_000, to: end },
    ];
    expect(session.rowCount(filters)).toBeGreaterThan(0);
    expect(session.rowCount(filters)).toBeLessThan(100);
    session.kpiBatch(filters, ctx.selection.hero, "IN");
    expect(session.insights("IN").some((i) => i.id === "caveat-small")).toBe(true);
    // Load another demo: no dashboard has been computed for it yet.
    const load = session.ingestSample("sales");
    if (load.status !== "ok") throw new Error(load.status);
    session.configure({
      domainId: load.detection.candidates[0]?.domainId ?? "sales",
      numberLocale: "IN",
      currency: null,
    });
    expect(session.insights("IN").some((i) => i.id === "caveat-small")).toBe(false);
  });
});
