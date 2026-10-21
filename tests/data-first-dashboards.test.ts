/**
 * Dashboards designed from the data (version 49.0): the generic dashboard
 * is built around the outcome the understanding chose (src/engine/
 * understand), its charts ranked by how strongly each column moves the
 * outcome (understand/plan.ts), and an industry that fits strongly keeps its
 * template, with "What moves …" after it when a strong driver isn't charted.
 *
 * Each outcome type gets its own dashboard: a yes/no outcome's rate by what
 * moves it (Titanic), a class outcome's mix and what sets the classes apart
 * (iris), a score's distribution and what moves with it (wine, 48.1), an
 * amount of each case averaged, never summed (house prices). Every KPI
 * compiles to SQL that DuckDB agrees with, nothing that is averaged is ever
 * summed, and the demos read as they always have.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import { Session, type ContextResult } from "@/engine/session";
import type { ExportContext } from "@/engine/export/context";
import { fieldsOf, type Expr } from "@/engine/query/expr";
import { formatValue } from "@/engine/core/format";
import { close, loadIntoDuckDB, scalar } from "./helpers/duck";
import * as P from "./helpers/practice";

const connections: DuckDBConnection[] = [];
afterAll(() => connections.forEach(close));

/** A practice table loaded and configured as the given industry (the generic dashboard by default). */
async function dashboard(t: P.Practice, domainId = "generic") {
  const s = new Session();
  const load = await s.ingest(new Blob([t.csv]), t.fileName, {});
  if (load.status !== "ok") throw new Error(`${t.fileName}: ${load.status}`);
  const ctx = s.configure({ domainId, numberLocale: "INTL", currency: null });
  return { s, ctx, load };
}

const nameOf = (ctx: ContextResult, id: string) => ctx.kpis.find((k) => k.id === id)?.name;
const heroes = (ctx: ContextResult) => ctx.selection.hero.map((id) => nameOf(ctx, id));
const exportContext = (s: Session) => (s as unknown as { exportContext(): ExportContext }).exportContext();

/** Every KPI that sums a column the profile says is never added up (a rate, a price, an age, a count per case). */
function sumsOfNonAdditive(ec: ExportContext): string[] {
  const bad: string[] = [];
  const walk = (id: string, e: Expr) => {
    if ("agg" in e && e.agg === "sum")
      for (const f of fieldsOf(e.of)) {
        const column = ec.mapping.fields[f] ?? f.replace(/^col:/, "");
        const c = ec.profile.columns.find((x) => x.name === column);
        if (c && (c.additivity === "non-additive" || c.role === "rate" || c.role === "percentage"))
          bad.push(`${id} sums ${column}`);
      }
    if ("op" in e) e.args.forEach((a) => walk(id, a));
    if ("calc" in e) walk(id, e.calc);
    if ("atLatest" in e) walk(id, e.expr);
    if ("per" in e) walk(id, e.inner);
  };
  for (const r of ec.res.values()) if (r.available && r.variant) walk(r.def.id, r.variant.expr);
  return bad;
}

/** Runs the SQL of `ids` (every available KPI by default) in DuckDB; the mismatches with the engine's values. */
async function duckMismatches(s: Session, ctx: ContextResult, ids?: string[]): Promise<string[]> {
  const ec = exportContext(s);
  const table = ec.names.table.toLowerCase();
  const conn = await loadIntoDuckDB(ec.ds, table, ec.names.columns);
  connections.push(conn);
  const metas = ctx.kpis.filter((k) => k.available && k.sql && (!ids || ids.includes(k.id)));
  const values = new Map(
    s
      .kpiBatch(
        [],
        metas.map((k) => k.id),
        "INTL",
      )
      .values.map((v) => [v.id, v.value]),
  );
  const out: string[] = [];
  for (const k of metas) {
    const got = await scalar(conn, k.sql as string);
    const want = values.get(k.id) ?? NaN;
    const same =
      (Number.isNaN(got) && (want === null || Number.isNaN(want))) ||
      Math.abs(got - (want as number)) <= 1e-9 * Math.max(1, Math.abs(want as number));
    if (!same) out.push(`${k.id}: DuckDB ${got} vs engine ${want}`);
  }
  return out;
}

/** The plan is complete, scored and in the charts' order. */
function expectPlanned(ctx: ContextResult) {
  const charts = ctx.plan.filter((p) => p.type === "chart");
  expect(charts.map((p) => p.id)).toEqual(ctx.charts.map((c) => c.id));
  for (let i = 1; i < charts.length; i++)
    expect(charts[i]?.score, charts[i]?.id).toBeLessThanOrEqual(charts[i - 1]?.score as number);
  const kpis = ctx.plan.filter((p) => p.type === "kpi").map((p) => p.id);
  expect(kpis).toEqual([...ctx.selection.hero, ...ctx.selection.supporting, ...ctx.selection.columns]);
  for (const p of ctx.plan) {
    expect(p.score, p.id).toBeGreaterThanOrEqual(0);
    expect(p.score, p.id).toBeLessThanOrEqual(1);
    expect(p.why.length, p.id).toBeGreaterThan(10);
  }
}

// ---------------------------------------------------------------- a yes/no outcome

describe("a yes/no outcome: the Titanic's survival", async () => {
  const { s, ctx } = await dashboard(P.titanic());

  it("leads with the passengers, the survival rate and how many survived", () => {
    expect(heroes(ctx).slice(0, 3)).toEqual(["Passengers", "Survival rate", "Survived"]);
    expect(heroes(ctx)[3]).toBe("Average Fare");
    const batch = s.kpiBatch([], ctx.selection.hero, "INTL");
    const value = (id: string) => batch.values.find((v) => v.id === id)?.value;
    const survived = P.titanic()
      .rows.slice(1)
      .filter((r) => r[1] === 1).length;
    expect(value("records")).toBe(891);
    expect(value(ctx.selection.hero[2] as string)).toBe(survived);
    expect(value(ctx.selection.hero[1] as string)).toBeCloseTo(survived / 891, 12);
  });

  it("charts the rate by Sex, then by class, then by fare band, strongest first", () => {
    expect(ctx.charts.slice(0, 3).map((c) => c.id)).toEqual(["g_by_sex", "g_by_pclass", "g_outcome_bands"]);
    expect(ctx.charts[0]?.title).toBe("Survival rate by Sex");
    expect(ctx.charts[1]?.title).toBe("Survival rate by Pclass");
    expect(ctx.charts[2]?.title).toBe("Survival rate by Fare band");
    // A weak effect (Embarked) gets no chart of its own.
    expect(ctx.charts.some((c) => c.id === "g_by_embarked")).toBe(false);
    expect(ctx.charts.find((c) => c.id === "g_yesno_fare")?.title).toBe("Average Fare by Survived");
    for (const c of ctx.charts) expect(s.chart([], { specId: c.id }, "INTL")?.empty, c.id).toBe(false);
    expectPlanned(ctx);
  });

  it("formats only money as money", () => {
    expect(ctx.kpis.find((k) => k.name === "Average SibSp")?.format).toBe("decimal");
    expect(ctx.kpis.find((k) => k.name === "Average Fare")?.format).toBe("currency");
  });

  it("sums nothing that is averaged, and matches DuckDB", async () => {
    expect(sumsOfNonAdditive(exportContext(s))).toEqual([]);
    expect(await duckMismatches(s, ctx)).toEqual([]);
  });
});

// ---------------------------------------------------------------- insights from the same analyses

describe("the insights say what moves the outcome, on the rows selected", async () => {
  const t = P.titanic();
  const { s, ctx } = await dashboard(t);
  const refresh = (filters: Parameters<Session["kpiBatch"]>[0]) => {
    s.computeDashboard({
      filters,
      kpiIds: [...ctx.selection.hero, ...ctx.selection.supporting],
      charts: ctx.charts.map((c) => ({ specId: c.id })),
      numberLocale: "INTL",
    });
    return s.insights("INTL").filter((i) => i.id.startsWith("outcome-"));
  };
  const rows = t.rows.slice(1);
  const fareSplit = (keep: (r: (typeof rows)[number]) => boolean) => {
    const kept = rows.filter(keep);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const yes = avg(kept.filter((r) => r[1] === 1).map((r) => Number(r[9])));
    const no = avg(kept.filter((r) => r[1] !== 1).map((r) => Number(r[9])));
    const f = (v: number) => formatValue(v, "currency", { locale: "INTL", currency: "INR" });
    return `average ${f(yes)} Fare, against ${f(no)} for the rest`;
  };

  it("finds the strongest number on every row, linked to the chart that shows it", () => {
    const found = refresh([]);
    const fare = found.find((i) => i.id === "outcome-numeric-Fare");
    expect(fare?.title).toBe("Survival rises as Fare rises");
    expect(fare?.body).toContain(fareSplit(() => true));
    const chart = ctx.charts.find((c) => c.id === fare?.chartId);
    expect(chart?.measures.some((m) => m.id === fare?.metricId)).toBe(true);
    // At most the strongest number and the strongest category.
    expect(found.length).toBeLessThanOrEqual(2);
  });

  it("works them out again on the filtered rows, never on all rows while a filter is on", () => {
    const found = refresh([{ kind: "in", column: "Sex", values: ["female"] }]);
    const fare = found.find((i) => i.id === "outcome-numeric-Fare");
    if (fare) expect(fare.body).toContain(fareSplit((r) => r[4] === "female"));
    expect(found.every((i) => /filters/.test(i.basis))).toBe(true);
  });

  it("says nothing about drivers on too few rows", () => {
    const few = refresh([
      { kind: "in", column: "Embarked", values: ["Q"] },
      { kind: "in", column: "Sex", values: ["female"] },
    ]);
    const n = rows.filter((r) => r[11] === "Q" && r[4] === "female").length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(30);
    expect(few).toEqual([]);
  });
});

// ---------------------------------------------------------------- a class outcome

describe("a class outcome: the iris's species", async () => {
  const { s, ctx } = await dashboard(P.iris());

  it("leads with the rows and the classes, then what sets them apart most", () => {
    expect(heroes(ctx).slice(0, 2)).toEqual(["Iris samples", "Distinct species"]);
    expect(ctx.charts.slice(0, 2).map((c) => c.id)).toEqual(["g_class_petal_length", "g_class_petal_width"]);
    expect(ctx.charts.map((c) => c.id)).toEqual(expect.arrayContaining(["g_classes", "g_class_table"]));
    expect(ctx.charts.find((c) => c.id === "g_classes")?.kind).toBe("donut");
    for (const c of ctx.charts) expect(s.chart([], { specId: c.id }, "INTL")?.empty, c.id).toBe(false);
    expectPlanned(ctx);
  });

  it("sums nothing that is averaged, and matches DuckDB", async () => {
    expect(sumsOfNonAdditive(exportContext(s))).toEqual([]);
    expect(await duckMismatches(s, ctx)).toEqual([]);
  });
});

// ---------------------------------------------------------------- a score

describe("a score: the wine's quality", async () => {
  const { s, ctx } = await dashboard(P.wine());

  it("keeps the 48.1 dashboard, led by what moves with the score most", () => {
    expect(heroes(ctx)).toEqual(["Wines", "Average quality", "Share rated 7 or above", "Average alcohol"]);
    expect(ctx.charts[0]?.id).toBe("g_outcome_alcohol");
    expect(ctx.charts.map((c) => c.id)).toEqual(
      expect.arrayContaining(["g_outcome_dist", "g_outcome_density", "g_outcome_scatter", "g_outcome_table"]),
    );
    expectPlanned(ctx);
  });

  it("sums nothing, and matches DuckDB", async () => {
    expect(sumsOfNonAdditive(exportContext(s))).toEqual([]);
    expect(await duckMismatches(s, ctx)).toEqual([]);
  });
});

// ---------------------------------------------------------------- an amount of each case

describe("an amount of each case: a house's sale price", async () => {
  const { s, ctx } = await dashboard(P.housePrices());

  it("averages the price and gives its median, never its total", () => {
    expect(heroes(ctx)).toEqual(["Houses", "Average SalePrice", "Median SalePrice", "Average GrLivArea"]);
    for (const k of ctx.kpis.filter((x) => x.available)) expect(k.name, k.id).not.toMatch(/^Total /);
    const prices = P.housePrices()
      .rows.slice(1)
      .map((r) => r[8] as number)
      .sort((a, b) => a - b);
    const batch = s.kpiBatch([], ctx.selection.hero, "INTL");
    const value = (name: string) =>
      batch.values.find((v) => v.id === ctx.kpis.find((k) => k.name === name)?.id)?.value;
    expect(value("Average SalePrice")).toBeCloseTo(prices.reduce((a, b) => a + b, 0) / prices.length, 6);
    const mid = prices.length / 2;
    expect(value("Median SalePrice")).toBeCloseTo(
      ((prices[mid - 1] as number) + (prices[mid] as number)) / 2,
      6,
    );
    expect(ctx.domain.description).toBe("1,460 houses, with 4 measures and 3 categories");
  });

  it("charts the price against what moves it, strongest first, and its spread", () => {
    expect(ctx.charts[0]).toMatchObject({
      id: "g_outcome_scatter",
      kind: "scatter",
      title: "GrLivArea vs SalePrice",
    });
    expect(ctx.charts.map((c) => c.id)).toEqual(
      expect.arrayContaining(["g_by_neighborhood", "g_hist", "g_table"]),
    );
    expect(ctx.charts.find((c) => c.id === "g_by_neighborhood")?.title).toBe(
      "Average SalePrice by Neighborhood",
    );
    for (const c of ctx.charts) expect(s.chart([], { specId: c.id }, "INTL")?.empty, c.id).toBe(false);
    expectPlanned(ctx);
  });

  it("sums nothing that is averaged, and matches DuckDB", async () => {
    expect(sumsOfNonAdditive(exportContext(s))).toEqual([]);
    expect(await duckMismatches(s, ctx)).toEqual([]);
  });
});

// ---------------------------------------------------------------- an industry chosen

describe("an industry that fits strongly keeps its template, then what moves the outcome", () => {
  it("adds the churn rate by a strong driver no telecom chart shows", async () => {
    const t = P.telco();
    const first = await dashboard(t);
    const top = first.load.detection.candidates[0]?.domainId as string;
    const { s, ctx } = await dashboard(t, top);
    expect(ctx.fit.weak).toBe(false);
    const ids = ctx.charts.map((c) => c.id);
    const moves = ctx.charts.filter((c) => c.id.startsWith("yc_wm_"));
    expect(moves.length).toBeGreaterThanOrEqual(1);
    expect(moves.length).toBeLessThanOrEqual(3);
    expect(moves.map((c) => c.title)).toContain("Churn rate by TotalCharges band");
    // After every chart of the template's, in the drivers section.
    const lastTemplate = Math.max(...ctx.charts.map((c, i) => (c.id.startsWith("yc_") ? -1 : i)));
    for (const c of moves) {
      expect(ids.indexOf(c.id)).toBeGreaterThan(lastTemplate);
      expect(c.section).toBe("drivers");
    }
    // Its KPIs are hidden helpers: no card of their own, but SQL that DuckDB agrees with.
    const helpers = ctx.kpis.filter((k) => k.id.startsWith("yc_wm_"));
    expect(helpers.length).toBeGreaterThan(0);
    for (const k of helpers) {
      expect(k.hidden, k.id).toBe(true);
      expect(k.sql, k.id).toBeTruthy();
      expect(k.dax, k.id).toBeTruthy();
    }
    expect(
      await duckMismatches(
        s,
        ctx,
        helpers.map((k) => k.id),
      ),
    ).toEqual([]);
    const rate = s.kpiBatch([], ["yc_wm_rate"], "INTL").values[0]?.value;
    const churned = t.rows.slice(1).filter((r) => r[13] === "Yes").length;
    expect(rate).toBeCloseTo(churned / (t.rows.length - 1), 12);
    expectPlanned(ctx);
  });

  it("adds them to HR when the table fits it strongly", async () => {
    const { s, ctx } = await dashboard(P.hrAttrition(1470, true), "hr");
    expect(ctx.fit.weak).toBe(false);
    const moves = ctx.charts.filter((c) => c.id.startsWith("yc_wm_"));
    expect(moves.map((c) => c.title)).toContain("Attrition rate by BusinessTravel");
    // Overtime moves attrition too, but the HR template already charts it.
    expect(moves.some((c) => /OverTime/.test(c.title))).toBe(false);
    for (const c of moves) expect(s.chart([], { specId: c.id }, "INTL")?.empty, c.id).toBe(false);
    expect(sumsOfNonAdditive(exportContext(s))).toEqual([]);
  });

  it("lets the data lead when HR fits weakly (no hire date or status column)", async () => {
    const { s, ctx } = await dashboard(P.hrAttrition(), "hr");
    expect(ctx.fit.weak).toBe(true);
    // The charts designed around attrition come first, the strongest driver leading.
    expect(ctx.charts[0]?.id.startsWith("yc_g_")).toBe(true);
    expect(ctx.charts[0]?.title).toBe("Attrition rate by OverTime");
    expect(ctx.plan.filter((p) => p.type === "chart")[0]?.source).toBe("data");
    expectPlanned(ctx);
    expect(await duckMismatches(s, ctx)).toEqual([]);
  });

  it("adds nothing to the sales demo, whose outcome is the money of its transactions", () => {
    const s = new Session();
    s.ingestSample("sales");
    const ctx = s.configure({ domainId: "sales", numberLocale: "INTL", currency: null });
    expect(ctx.understanding.outcome).toMatchObject({ column: "Revenue", type: "amount" });
    expect(ctx.charts.some((c) => c.id.startsWith("yc_wm_") || c.id.startsWith("yc_g_"))).toBe(false);
  });
});

// ---------------------------------------------------------------- the demos

describe("the demos read as they always have", () => {
  it("keeps the e-commerce demo's charts in their order", () => {
    const s = new Session();
    s.ingestSample("ecommerce");
    const ctx = s.configure({ domainId: "ecommerce", numberLocale: "INTL", currency: null });
    expect(ctx.charts.map((c) => c.id)).toEqual([
      "trend_revenue",
      "trend_aov",
      "new_vs_returning",
      "trend_orders",
      "revenue_by_category",
      "revenue_by_state",
      "payment_mix",
      "channel_mix",
      "category_treemap",
      "rto_by_payment",
      "rto_by_state",
      "return_rate_by_category",
      "orders_heatmap",
      "courier_rto",
      "courier_delivery",
      "cohort_retention",
      "rfm_segments",
      "pareto_products",
      "basket_pairs",
      "price_bands",
      "discount_vs_returns",
      "return_reasons",
      "yc_trend_mrp",
      "yc_by_mrp",
      "yc_trend_unit_price",
      "yc_by_unit_price",
      "yc_trend_gst_amount",
      "yc_by_gst_amount",
      "yc_trend_shipping_fee",
      "yc_by_shipping_fee",
      "top_products",
    ]);
    expect(ctx.understanding.title).toBe("E-commerce performance");
    expectPlanned(ctx);
  });

  it("adds neither data-led charts nor a What moves section to any demo", async () => {
    const { SAMPLES } = await import("@/engine/samples");
    for (const sample of SAMPLES) {
      const s = new Session();
      s.ingestSample(sample.id);
      const ctx = s.configure({ domainId: sample.domain, numberLocale: "INTL", currency: null });
      expect(
        ctx.charts.filter((c) => c.id.startsWith("yc_wm_") || c.id.startsWith("yc_g_")).map((c) => c.id),
        sample.id,
      ).toEqual([]);
    }
  });
});
