/**
 * Version 42.0, the tables analysts build:
 * - plan and outcome columns are paired (profile/pairs.ts) by a plan word
 *   (target, budget, plan, LY, Soll, presupuesto…) against an outcome word
 *   (actual, achievement, Ist, real, TY…) or none, over the same other words;
 * - each pair becomes attainment and variance KPIs, or growth vs last year
 *   (kpi/columnKpis.ts pairKpis), in the generic fallback and for columns a
 *   template doesn't read, compared like for like (rows with both figures);
 * - a tall scorecard's value column, which mixes units, is never totalled or
 *   averaged across metrics: each metric gets a KPI of its own;
 * - KPI names in headers and scorecard metrics, aliases included, count as
 *   evidence of their industry (detect/match.ts matchKpiNames).
 * Every new KPI's SQL returns the engine's value in DuckDB, overall and month
 * by month, as tests/registry.test.ts proves for the registry's KPIs.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import type { Dataset } from "@/engine/core/types";
import { Session } from "@/engine/session";
import type { ExportContext } from "@/engine/export/context";
import { profileDataset } from "@/engine/profile/profile";
import { detectColumnPairs } from "@/engine/profile/pairs";
import { tokenize } from "@/engine/profile/names";
import type { DatasetProfile, TallFormatInfo } from "@/engine/profile/types";
import { detectDomain } from "@/engine/detect/detect";
import { matchableColumns, matchCandidates, matchKpiNames, type NameToRead } from "@/engine/detect/match";
import { buildGenericDomain } from "@/engine/detect/generic";
import { resolveKpis, selectKpis } from "@/engine/kpi/resolve";
import {
  cleanColumnNames,
  makeDaxContext,
  makeResolver,
  makeSqlContext,
  type CompileNames,
} from "@/engine/kpi/context";
import { evaluateScalar, EMPTY_SCOPE } from "@/engine/query/evaluate";
import { fieldsOf, type Expr } from "@/engine/query/expr";
import { runQuery } from "@/engine/query/run";
import { kpiQuery } from "@/engine/compile/sql";
import { exprDax } from "@/engine/compile/dax";
import { DOMAINS, getDomain } from "@/registry";
import { domainSchema, type DomainDef } from "@/registry/schema";
import { validateDomainRefs } from "@/registry/validate";
import type { Mapping } from "@/engine/detect/mapping";
import { close, loadIntoDuckDB, scalar } from "./helpers/duck";
import { csvCell, parseCsv } from "./helpers/layouts";

const connections: DuckDBConnection[] = [];
afterAll(() => connections.forEach(close));

const MONTHS = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}-01`);

/** A CSV from a header row and rows of cells. */
const csvOf = (headers: string[], rows: Array<Array<string | number>>): string =>
  [headers, ...rows].map((r) => r.map((v) => csvCell(String(v))).join(",")).join("\n");

async function load(headers: string[], rows: Array<Array<string | number>>): Promise<Dataset> {
  return parseCsv(csvOf(headers, rows), "pairs");
}

/** The pairs of a table's measure columns, checking that profiling records exactly those. */
async function pairsOf(headers: string[], rows: Array<Array<string | number>>) {
  const profile = profileDataset(await load(headers, rows));
  const pairs = detectColumnPairs(profile.columns);
  expect(profile.pairs).toEqual(pairs);
  return pairs;
}

/** Equal within floating-point noise; a blank only equals a blank. */
function same(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return !Number.isFinite(a) && !Number.isFinite(b);
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * The engine's value of each KPI against its SQL in DuckDB, overall and per
 * month of the `dateColumn` column when given, plus a well-formed DAX
 * measure; returns the engine's overall values.
 */
async function proveInDuckDb(
  ds: Dataset,
  domain: DomainDef,
  mapping: Mapping,
  ids: readonly string[],
  dateColumn?: string,
): Promise<Map<string, number>> {
  const res = resolveKpis(domain, mapping);
  const resolver = makeResolver(ds, mapping, res);
  const names: CompileNames = {
    table: "data",
    columns: cleanColumnNames(ds.columns.map((c) => c.name)),
    measures: new Map(domain.kpis.map((k) => [k.id, k.name])),
  };
  const sqlCtx = makeSqlContext(ds, mapping, res, names);
  const daxCtx = makeDaxContext(ds, mapping, res, names, { dateTable: "Date" });
  const conn = await loadIntoDuckDB(ds, "data", names.columns);
  connections.push(conn);
  const all = Int32Array.from({ length: ds.rowCount }, (_, i) => i);
  const out = new Map<string, number>();
  for (const id of ids) {
    const r = res.get(id);
    expect(r?.available, `${id} is available`).toBe(true);
    const expr = r?.variant?.expr as Expr;
    const engine = evaluateScalar(expr, resolver, EMPTY_SCOPE, all);
    const duck = await scalar(conn, kpiQuery(expr, sqlCtx));
    expect(same(engine, duck), `${id}: engine ${engine} vs DuckDB ${duck}`).toBe(true);
    const dax = exprDax(expr, daxCtx);
    expect(dax.includes("undefined"), `${id}: DAX\n${dax}`).toBe(false);
    out.set(id, engine);
    if (!dateColumn) continue;
    const monthly = (
      await conn.runAndReadAll(
        kpiQuery(expr, sqlCtx, { dateCol: `"${names.columns.get(dateColumn)}"`, grain: "month" }),
      )
    ).getRowObjectsJson() as Array<Record<string, unknown>>;
    const q = runQuery(ds, resolver, {
      filters: [],
      groupBy: [{ kind: "time", column: dateColumn, grain: "month" }],
      measures: [{ id, expr }],
      dateColumn,
    });
    const byPeriod = new Map(q.groups.map((g) => [g.labels[0]?.raw as number, g.values[0] as number]));
    let compared = 0;
    for (const row of monthly) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(row.period));
      const period = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
      if (!byPeriod.has(period)) continue;
      const s = row.value === null || row.value === undefined ? NaN : Number(row.value);
      expect(same(byPeriod.get(period) as number, s), `${id} @ ${String(row.period)}`).toBe(true);
      compared++;
    }
    expect(compared, `${id}: months compared`).toBeGreaterThan(0);
  }
  return out;
}

// ---------------------------------------------------------------- pairs

describe("plan and outcome columns", () => {
  const rows = (n: number, f: (i: number) => Array<string | number>) =>
    Array.from({ length: n }, (_, i) => f(i));

  it("pairs a plan word with an outcome word, or none, over the same other words", async () => {
    expect(
      await pairsOf(
        ["Sales Officer", "Month", "Target (₹ Lakh)", "Achievement (₹ Lakh)"],
        rows(48, (i) => [`SO ${i % 4}`, MONTHS[i % 12] as string, 20 + (i % 4) * 5, 18 + (i % 7)]),
      ),
    ).toEqual([{ actual: "Achievement (₹ Lakh)", target: "Target (₹ Lakh)", label: "", kind: "target" }]);
    expect(
      await pairsOf(
        ["Cost Centre", "Revenue Budget", "Revenue Actual"],
        rows(40, (i) => [`CC${i % 5}`, 5000 + i * 10, 4800 + i * 13]),
      ),
    ).toEqual([{ actual: "Revenue Actual", target: "Revenue Budget", label: "Revenue", kind: "budget" }]);
    // German controlling: "Ist" is the actual in a German header, "Plan" the plan.
    expect(
      await pairsOf(
        ["Filiale", "Monat", "Umsatz Plan (€)", "Umsatz Ist (€)"],
        rows(36, (i) => [`F${i % 3}`, MONTHS[i % 12] as string, 300 + i, 290 + i * 2]),
      ),
    ).toEqual([{ actual: "Umsatz Ist (€)", target: "Umsatz Plan (€)", label: "Umsatz", kind: "plan" }]);
    expect(
      await pairsOf(
        ["Store", "Sales LY", "Sales TY"],
        rows(30, (i) => [`S${i % 6}`, 70 + i, 80 + i]),
      ),
    ).toEqual([{ actual: "Sales TY", target: "Sales LY", label: "Sales", kind: "last year" }]);
    expect(
      await pairsOf(
        ["Comercial", "Ventas Presupuesto", "Ventas Real"],
        rows(30, (i) => [`C${i % 5}`, 100 + i, 95 + i * 2]),
      ),
    ).toEqual([{ actual: "Ventas Real", target: "Ventas Presupuesto", label: "Ventas", kind: "budget" }]);
    // A P&L: one actual measured against the budget and last year.
    expect(
      await pairsOf(
        ["Line Item", "Month", "Actual", "Budget", "PY"],
        rows(60, (i) => [
          `Item ${i % 5}`,
          MONTHS[i % 12] as string,
          1000 + i * 37,
          1100 + i * 31,
          900 + i * 29,
        ]),
      ),
    ).toEqual([
      { actual: "Actual", target: "Budget", label: "", kind: "budget" },
      { actual: "Actual", target: "PY", label: "", kind: "last year" },
    ]);
  });

  it("never pairs two plans, different units, derived columns or an ordinary table", async () => {
    expect(
      await pairsOf(
        ["Region", "Budget", "Forecast"],
        rows(30, (i) => [`R${i % 3}`, 10 + i, 12 + i]),
      ),
    ).toEqual([]);
    // Lakh against crore, money against a percentage, dollars against euros.
    expect(
      await pairsOf(
        ["Rep", "Target (₹ Lakh)", "Achievement (₹ Cr)"],
        rows(30, (i) => [`R${i % 3}`, 10 + i, 1 + i]),
      ),
    ).toEqual([]);
    expect(
      await pairsOf(
        ["Rep", "Target", "Achievement"],
        rows(30, (i) => [`R${i % 3}`, `₹${1000 + i}`, `${90 + (i % 9)}%`]),
      ),
    ).toEqual([]);
    expect(
      await pairsOf(
        ["Rep", "Target", "Achievement"],
        rows(30, (i) => [`R${i % 3}`, `$${1000 + i}`, `€${950 + i}`]),
      ),
    ).toEqual([]);
    // A variance or comparison column pairs with nothing; the plain pair still does.
    expect(
      await pairsOf(
        ["Rep", "Target", "Achievement", "Variance", "Achievement vs Target", "Budget LY"],
        rows(30, (i) => [`R${i % 3}`, 100 + (i % 7) * 5, 90 + (i % 5) * 4, -10, 0.9, 80 + (i % 4) * 3]),
      ),
    ).toEqual([{ actual: "Achievement", target: "Target", label: "", kind: "target" }]);
    // "Plan" also names a subscription plan, so it needs an explicit outcome word.
    expect(
      await pairsOf(
        ["Account", "Plan Amount", "Amount"],
        rows(30, (i) => [`A${i}`, 99, 99 + (i % 3)]),
      ),
    ).toEqual([]);
    expect(
      await pairsOf(
        ["Account", "Plan Amount", "Actual Amount"],
        rows(30, (i) => [`A${i}`, 99, 99 + (i % 3)]),
      ),
    ).toEqual([{ actual: "Actual Amount", target: "Plan Amount", label: "Amount", kind: "plan" }]);
    expect(
      await pairsOf(
        ["Order ID", "Order Date", "Category", "Amount", "Quantity", "Discount"],
        rows(50, (i) => [
          `O${1000 + i}`,
          MONTHS[i % 12] as string,
          `Cat ${i % 4}`,
          100 + i,
          1 + (i % 3),
          i % 5,
        ]),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------- pair KPIs

describe("attainment, variance and growth", () => {
  /** Target vs achievement by sales officer and month; the last three months have no achievement yet. */
  const officers = ["Ravi", "Asha", "Imran", "Neha"];
  const targetRows = MONTHS.flatMap((m, i) =>
    officers.map(
      (o, j) => [o, m, 20 + j * 5, i < 9 ? 18 + j * 5 + (i % 4) * 0.5 : ""] as Array<string | number>,
    ),
  );
  const targetHeaders = ["Sales Officer", "Month", "Target (₹ Lakh)", "Achievement (₹ Lakh)"];

  it("compares target and achievement like for like in the generic fallback, the attainment a hero", async () => {
    const ds = await load(targetHeaders, targetRows);
    const profile = profileDataset(ds);
    const { domain, mapping } = buildGenericDomain(profile);
    const attain = domain.kpis.find((k) => k.name === "Target attainment");
    const variance = domain.kpis.find((k) => k.name === "Variance vs target");
    expect(attain).toMatchObject({ format: "percent", tier: "hero", direction: "higher" });
    expect(variance).toMatchObject({ format: "currency" });
    expect(attain?.definition).toMatch(/rows that have both figures/);
    const values = await proveInDuckDb(
      ds,
      domain,
      mapping,
      [attain?.id as string, variance?.id as string],
      "Month",
    );
    // Only the months with an achievement count: the target of the last three is not held against it.
    const both = targetRows.filter((r) => r[3] !== "");
    const sumT = both.reduce((s, r) => s + Number(r[2]), 0);
    const sumA = both.reduce((s, r) => s + Number(r[3]), 0);
    expect(values.get(attain?.id as string)).toBeCloseTo(sumA / sumT, 12);
    expect(values.get(variance?.id as string)).toBeCloseTo(sumA - sumT, 9);
    // The dashboard's selection puts it among the heroes.
    expect(selectKpis(resolveKpis(domain, mapping)).hero).toContain(attain?.id);
  });

  it("is blank when the plan adds up to 0, as in SQL", async () => {
    const ds = await load(
      targetHeaders,
      targetRows.map((r) => [r[0] as string, r[1] as string, 0, r[3] as string | number]),
    );
    const { domain, mapping } = buildGenericDomain(profileDataset(ds));
    const attain = domain.kpis.find((k) => k.name === "Target attainment");
    const values = await proveInDuckDb(ds, domain, mapping, [attain?.id as string]);
    expect(Number.isNaN(values.get(attain?.id as string))).toBe(true);
  });

  it("measures growth vs last year, balances on the latest date and rates in pp", async () => {
    const branches = ["Andheri", "Baner", "Kothrud", "Vashi"];
    const rows = MONTHS.flatMap((m, i) =>
      branches.map(
        (b, j) =>
          [b, m, 100 + i, 98 + i + j, 3, 2.5 + j * 0.25, 50 + i, 55 + i + j] as Array<string | number>,
      ),
    );
    const ds = await load(
      [
        "Branch",
        "Month",
        "AUM Target (₹ Cr)",
        "AUM Actual (₹ Cr)",
        "GNPA % Target",
        "GNPA % Actual",
        "Sales LY",
        "Sales TY",
      ],
      rows,
    );
    const { domain, mapping } = buildGenericDomain(profileDataset(ds));
    const byName = (n: string) => domain.kpis.find((k) => k.name === n);
    const aum = byName("AUM attainment vs target (latest)");
    const aumGap = byName("AUM variance vs target (latest)");
    const gnpa = byName("GNPA % variance vs target (pp)");
    const growth = byName("Sales growth vs last year");
    const salesGap = byName("Sales variance vs last year");
    expect([aum, aumGap, gnpa, growth, salesGap].every(Boolean)).toBe(true);
    // A ratio of two rates is no attainment: percentages get the gap only.
    expect(byName("GNPA % attainment vs target")).toBeUndefined();
    expect(gnpa).toMatchObject({ format: "decimal" });
    expect(growth).toMatchObject({ format: "percent" });
    const ids = [aum, aumGap, gnpa, growth, salesGap].map((k) => k?.id as string);
    const values = await proveInDuckDb(ds, domain, mapping, ids, "Month");
    const last = rows.filter((r) => r[1] === MONTHS[11]);
    const sum = (rs: typeof rows, i: number) => rs.reduce((s, r) => s + Number(r[i]), 0);
    // The balance on the latest month only, never added across months.
    expect(values.get(aum?.id as string)).toBeCloseTo(sum(last, 3) / sum(last, 2), 12);
    expect(values.get(aumGap?.id as string)).toBeCloseTo(sum(last, 3) - sum(last, 2), 9);
    // The average row-by-row gap, already in points.
    expect(values.get(gnpa?.id as string)).toBeCloseTo((sum(rows, 5) - sum(rows, 4)) / rows.length, 12);
    expect(values.get(growth?.id as string)).toBeCloseTo((sum(rows, 7) - sum(rows, 6)) / sum(rows, 6), 12);
    expect(values.get(salesGap?.id as string)).toBeCloseTo(sum(rows, 7) - sum(rows, 6), 9);
  });

  it("compares the columns a template doesn't, in their own section, and matches DuckDB", async () => {
    const s = new Session();
    const loaded = await s.ingest(
      new Blob([
        csvOf(
          ["Department", "Month", "Payroll Budget (₹ Lakh)", "Payroll Actual (₹ Lakh)"],
          MONTHS.flatMap((m, i) =>
            ["Sales", "Ops", "Tech"].map((d, j) => [d, m, 40 + j * 10, 38 + j * 10 + (i % 5)]),
          ),
        ),
      ]),
      "payroll.csv",
      {},
    );
    if (loaded.status !== "ok") throw new Error(loaded.status);
    const ctx = s.configure({ domainId: "hr", numberLocale: "INTL", currency: null });
    const attain = ctx.kpis.find((k) => k.id.startsWith("yc_attain_"));
    const variance = ctx.kpis.find((k) => k.id.startsWith("yc_var_"));
    expect(attain?.name).toBe("Payroll attainment vs budget");
    expect(variance?.name).toBe("Payroll variance vs budget");
    expect(attain?.definition).toMatch(/template doesn't compare/);
    expect(ctx.selection.columns).toEqual(expect.arrayContaining([attain?.id, variance?.id]));
    expect(ctx.selection.hero).not.toContain(attain?.id);
    const ec = (s as unknown as { exportContext(): ExportContext }).exportContext();
    const bundle = s.verificationBundle();
    const conn = await loadIntoDuckDB(ec.ds, bundle.table, ec.names.columns);
    connections.push(conn);
    for (const q of bundle.queries.filter((x) => x.id === attain?.id || x.id === variance?.id)) {
      const got = await scalar(conn, q.sql);
      expect(same(got, q.engine as number), `${q.id}: DuckDB ${got} vs engine ${q.engine}`).toBe(true);
    }
  });

  it("never reads a hidden plan column", async () => {
    const s = new Session();
    const loaded = await s.ingest(new Blob([csvOf(targetHeaders, targetRows)]), "targets.csv", {});
    if (loaded.status !== "ok") throw new Error(loaded.status);
    const shown = s.configure({ domainId: "generic", numberLocale: "INTL", currency: null });
    expect(shown.kpis.some((k) => k.name === "Target attainment")).toBe(true);
    const hidden = s.configure({
      domainId: "generic",
      numberLocale: "INTL",
      currency: null,
      hiddenColumns: ["Target (₹ Lakh)"],
    });
    expect(hidden.kpis.some((k) => k.name === "Target attainment" || k.name === "Variance vs target")).toBe(
      false,
    );
    expect(hidden.kpis.flatMap((k) => k.fieldsUsed.map((f) => f.column))).not.toContain("Target (₹ Lakh)");
  });
});

// ---------------------------------------------------------------- tall scorecards

describe("tall scorecards: no number mixes units", () => {
  const tallOf = (p: DatasetProfile, info: Omit<TallFormatInfo, "suggestion">): DatasetProfile => ({
    ...p,
    tall: { ...info, suggestion: "" },
  });
  /** Every expression of the KPI reads the value column only under a filter to one metric. */
  const filteredToOneMetric = (e: Expr, value: string, metric: string): boolean =>
    !fieldsOf(e).has(value) ||
    ("calc" in e &&
      "field" in e.where &&
      e.where.field === metric &&
      "in" in e.where &&
      e.where.in.length === 1);

  it("gives each metric its own KPI and never totals or averages the value columns", async () => {
    const metrics = ["Revenue (₹ Cr)", "EBITDA %", "Headcount"];
    const rows = MONTHS.flatMap((m, i) =>
      metrics.map((k, j) => [
        m,
        k,
        [120 + i * 3, 18 + (i % 4), 450 + i * 5][j] as number,
        [125, 20, 460][j] as number,
      ]),
    );
    const ds = await load(["Month", "Metric", "Actual", "Target"], rows);
    const base = profileDataset(ds);
    const profile = tallOf(base, {
      metricColumn: "Metric",
      metrics,
      valueColumns: ["Actual", "Target"],
      idColumns: ["Month"],
    });
    const { domain, mapping } = buildGenericDomain(profile);
    const value = Object.entries(mapping.fields).find(([, c]) => c === "Actual")?.[0] as string;
    const target = Object.entries(mapping.fields).find(([, c]) => c === "Target")?.[0] as string;
    const metric = Object.entries(mapping.fields).find(([, c]) => c === "Metric")?.[0] as string;
    // One KPI per metric, named as the scorecard names it; nothing sums, averages or pairs the value columns.
    const perMetric = domain.kpis.filter((k) => k.id.startsWith("metric_"));
    expect(perMetric.map((k) => k.name)).toEqual(metrics);
    for (const k of domain.kpis)
      for (const v of k.variants) {
        expect(filteredToOneMetric(v.expr, value, metric), `${k.id} reads Actual unfiltered`).toBe(true);
        expect(filteredToOneMetric(v.expr, target, metric), `${k.id} reads Target unfiltered`).toBe(true);
      }
    expect(base.pairs.length).toBe(1);
    expect(domain.kpis.some((k) => k.group === "Plan vs actual")).toBe(false);
    // Charts follow the metrics: no donut, no weekday count of metric rows.
    expect(domain.charts.find((c) => c.id === "g_trend")?.measures).toEqual([perMetric[0]?.id]);
    expect(domain.charts.some((c) => c.kind === "donut" || c.id === "g_weekday")).toBe(false);
    const values = await proveInDuckDb(
      ds,
      domain,
      mapping,
      perMetric.map((k) => k.id),
      "Month",
    );
    // The latest month's own value.
    expect(values.get(perMetric[0]?.id as string)).toBe(120 + 11 * 3);
    expect(values.get(perMetric[2]?.id as string)).toBe(450 + 11 * 5);
  });

  it("averages a metric over branches and says so", async () => {
    const metrics = ["GNPA %", "Collection Efficiency %"];
    const branches = ["Andheri", "Baner", "Vashi"];
    const rows = MONTHS.flatMap((m, i) =>
      branches.flatMap((b, j) => metrics.map((k, x) => [b, m, k, x ? 95 + j : 2 + j * 0.5 + (i % 2) * 0.1])),
    );
    const ds = await load(["Branch", "Month", "Metric", "Value"], rows);
    const profile = tallOf(profileDataset(ds), {
      metricColumn: "Metric",
      metrics,
      valueColumns: ["Value"],
      idColumns: ["Branch", "Month"],
    });
    const { domain, mapping } = buildGenericDomain(profile);
    const perMetric = domain.kpis.filter((k) => k.id.startsWith("metric_"));
    expect(perMetric.map((k) => k.name)).toEqual(["Average GNPA %", "Average Collection Efficiency %"]);
    expect(perMetric[0]?.definition).toMatch(/averaged over the Branch rows/);
    // A breakdown by branch, not by the metric column.
    expect(domain.charts.some((c) => "field" in c.x && mapping.fields[c.x.field] === "Metric")).toBe(false);
    const values = await proveInDuckDb(
      ds,
      domain,
      mapping,
      perMetric.map((k) => k.id),
      "Month",
    );
    expect(values.get(perMetric[0]?.id as string)).toBeCloseTo((2.1 + 2.6 + 3.1) / 3, 12);
  });

  it("keeps a session's KPIs off a scorecard's value column", async () => {
    const metrics: Array<[string, number]> = [
      ["Subscriber Base", 1_200_000],
      ["ARPU", 182],
      ["Churn %", 2.1],
      ["MOU", 640],
    ];
    const rows = MONTHS.flatMap((m, i) =>
      ["Mumbai", "Delhi", "Gujarat"].flatMap((c, j) =>
        metrics.map(([k, v]) => [c, m, k, Number((v * (1 + i * 0.01 + j * 0.05)).toFixed(2)), v]),
      ),
    );
    const s = new Session();
    const loaded = await s.ingest(
      new Blob([csvOf(["Circle", "Month", "Metric", "Value", "Target"], rows)]),
      "scorecard.csv",
      {},
    );
    if (loaded.status !== "ok") throw new Error(loaded.status);
    expect(loaded.profile.tall?.valueColumns).toEqual(expect.arrayContaining(["Value", "Target"]));
    for (const domainId of ["generic", loaded.detection.candidates[0]?.domainId ?? "generic"]) {
      const ctx = s.configure({ domainId, numberLocale: "INTL", currency: null });
      for (const k of ctx.kpis.filter((x) => x.available)) {
        const cols = k.fieldsUsed.map((f) => f.column);
        if (k.id.startsWith("yc_") || domainId === "generic")
          expect(
            !cols.includes("Value") && !cols.includes("Target") ? true : cols.includes("Metric"),
            `${domainId}: ${k.id} reads a value column across metrics`,
          ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------- KPI names as evidence

describe("KPI names as evidence of an industry", () => {
  const names = (...headers: string[]): NameToRead[] =>
    headers.map((h) => ({ key: h, column: h, tokens: tokenize(h), metric: false }));
  const kpiFor = (domainId: string, header: string): string | undefined =>
    matchKpiNames(getDomain(domainId) as DomainDef, names(header))[0]?.kpiId;

  it("reads the names and abbreviations analysts use", () => {
    const cases: Array<[string, string, string]> = [
      ["banking", "GNPA %", "npa_rate"],
      ["banking", "PAR 30", "par_30"],
      ["banking", "CE %", "collection_efficiency"],
      ["banking", "AUM (₹ Cr)", "outstanding_total"],
      ["telecom", "ARPU", "arpu"],
      ["telecom", "MOU", "mou_per_sub"],
      ["telecom", "Churn %", "churn_rate"],
      ["hospitality", "ADR", "adr"],
      ["hospitality", "RevPAR", "revpar"],
      ["hospitality", "Occupancy %", "occupancy"],
      ["hr", "Attrition %", "attrition_rate"],
      ["hr", "Monthly Attrition %", "attrition_rate"],
      ["hr", "Headcount", "headcount"],
      ["logistics", "OTIF %", "perfect_order_rate"],
      ["manufacturing", "OEE", "oee"],
      ["manufacturing", "FPY", "first_pass_yield"],
      ["support", "CSAT", "csat_pct"],
      ["support", "FRT", "avg_first_response"],
      ["marketing", "ROAS", "roas"],
      ["marketing", "CTR", "ctr"],
      ["marketing", "CPL", "cpl"],
      ["saas", "MRR", "mrr_total"],
      ["saas", "NRR", "nrr"],
      ["insurance", "Loss Ratio %", "loss_ratio"],
      ["finance", "DSO", "avg_days_to_pay"],
    ];
    for (const [domain, header, kpi] of cases)
      expect(kpiFor(domain, header), `${domain}: ${header}`).toBe(kpi);
  });

  it("needs the KPI's own words, with only units, periods or plan words beside them", () => {
    expect(kpiFor("saas", "New SB Accounts Opened")).toBeUndefined();
    expect(kpiFor("hospitality", "Bed Occupancy %")).toBeUndefined();
    expect(kpiFor("healthcare", "Bed Occupancy %")).toBe("bed_occupancy");
    expect(kpiFor("banking", "GNPA % Target")).toBe("npa_rate");
    expect(kpiFor("finance", "Revenue Target")).toBeUndefined();
  });

  it("points a summary of KPI columns to its industry and says why", async () => {
    const branches = ["Andheri", "Baner", "Kothrud", "Vashi"];
    const rows = MONTHS.flatMap((m, i) =>
      branches.map((b, j) => [
        j < 2 ? "West" : "Central",
        b,
        m,
        (4 + i * 0.3 + j).toFixed(2),
        (120 + i * 2 + j * 10).toFixed(1),
        (2.1 + ((i + j) % 5) * 0.2).toFixed(2),
        (96 + ((i * j) % 4)).toFixed(1),
      ]),
    );
    const profile = profileDataset(
      await load(
        [
          "Region",
          "Branch",
          "Month",
          "Disbursement (₹ Cr)",
          "AUM (₹ Cr)",
          "GNPA %",
          "Collection Efficiency %",
        ],
        rows,
      ),
    );
    const top = detectDomain(DOMAINS, profile).candidates[0];
    expect(top?.domainId).toBe("banking");
    const kpis = top?.evidence.filter((e) => e.fieldId.startsWith("kpi:")) ?? [];
    expect(kpis.map((e) => e.column)).toEqual(
      expect.arrayContaining(["GNPA %", "Collection Efficiency %", "AUM (₹ Cr)"]),
    );
    expect(kpis.find((e) => e.column === "GNPA %")).toMatchObject({
      fieldLabel: "Gross NPA ratio (KPI)",
      via: "name",
    });
  });

  it("points a tall scorecard to its industry by its metric names", async () => {
    const scorecard = async (metrics: string[], ids: string[]) => {
      const rows = MONTHS.flatMap((m, i) =>
        ["North", "South"].flatMap((r) => metrics.map((k, j) => [r, m, k, 10 + i + j, 12 + j])),
      );
      const p = profileDataset(await load(["Unit Name", "Month", "Metric", "Value", "Target"], rows));
      // Set by hand, so this test reads detection, whatever structure.ts decides.
      const profile: DatasetProfile = {
        ...p,
        tall: {
          metricColumn: "Metric",
          metrics,
          valueColumns: ["Value", "Target"],
          idColumns: ids,
          suggestion: "",
        },
      };
      return { profile, detection: detectDomain(DOMAINS, profile) };
    };
    const telecom = await scorecard(["Subscriber Base", "ARPU", "Churn %", "MOU"], ["Unit Name", "Month"]);
    expect(telecom.detection.candidates[0]?.domainId).toBe("telecom");
    expect(telecom.detection.candidates[0]?.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ column: "Metric: ARPU", via: "values" })]),
    );
    const hotel = await scorecard(["Occupancy %", "ADR", "RevPAR", "Rooms Revenue"], ["Unit Name", "Month"]);
    expect(hotel.detection.candidates[0]?.domainId).toBe("hospitality");
    // The value columns say how the sheet is laid out, so no industry's fields claim them.
    expect(matchableColumns(telecom.profile).map((c) => c.name)).not.toContain("Value");
    const finance = getDomain("finance") as DomainDef;
    expect(
      matchCandidates(finance, matchableColumns(telecom.profile)).some((c) =>
        ["Value", "Target"].includes(c.column),
      ),
    ).toBe(false);
    // A value column named for what it measures is still the industry's vocabulary.
    const named: DatasetProfile = {
      ...telecom.profile,
      tall: { ...(telecom.profile.tall as TallFormatInfo), valueColumns: ["Value", "Target", "Unit Name"] },
    };
    expect(matchableColumns(named).map((c) => c.name)).toEqual(["Unit Name", "Month", "Metric"]);
  });

  it("reads an HR summary as HR", async () => {
    const rows = MONTHS.flatMap((m, i) =>
      ["Sales", "Ops", "Tech", "Finance"].map((d, j) => [
        m,
        d,
        120 + j * 30 + i,
        3 + (i % 3),
        2 + (j % 3),
        ((2 + (j % 3)) / (120 + j * 30)) * 100,
      ]),
    );
    const profile = profileDataset(
      await load(["Month", "Department", "Headcount", "Joiners", "Leavers", "Attrition %"], rows),
    );
    expect(detectDomain(DOMAINS, profile).candidates[0]?.domainId).toBe("hr");
  });
});

// ---------------------------------------------------------------- aliases

describe("KPI aliases", () => {
  it("are part of the schema and never name another KPI of the domain", () => {
    const banking = getDomain("banking") as DomainDef;
    expect(banking.kpis.find((k) => k.id === "npa_rate")?.aliases).toContain("GNPA");
    expect(domainSchema.safeParse({ ...banking, kpis: [{ ...banking.kpis[0], aliases: [7] }] }).success).toBe(
      false,
    );
    const clash: DomainDef = {
      ...banking,
      kpis: banking.kpis.map((k) =>
        k.id === "loans" ? { ...k, aliases: [...(k.aliases ?? []), "GNPA %"] } : k,
      ),
    };
    expect(validateDomainRefs(clash)).toContain('KPI loans alias "GNPA %" names KPI "npa_rate"');
    for (const d of DOMAINS) expect(validateDomainRefs(d), d.id).toEqual([]);
  });

  // Sales and e-commerce keep their own aliases beside the signals that tell a shop from an online store.
  it("name the KPIs of every other industry the way analysts write them", () => {
    for (const d of DOMAINS) {
      if (d.id === "sales" || d.id === "ecommerce") continue;
      expect(d.kpis.filter((k) => k.aliases?.length).length, d.id).toBeGreaterThanOrEqual(10);
    }
  });
});
