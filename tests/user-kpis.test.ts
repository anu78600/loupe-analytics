/**
 * KPIs the user builds in the Customise step (engine/kpi/userKpis.ts),
 * through Session.configure on a sales file.
 *
 * - Every aggregate (total, average, median, lowest, highest, distinct
 *   count, rows) and a ratio of totals computes the value worked out by
 *   hand, and its generated SQL returns the same value in DuckDB.
 * - DAX is written for each, and each joins the export's measures.
 * - One that names a text column for a total, a hidden column, or a column
 *   not in the file is left out with its reason; nothing else is computed
 *   in its place.
 * - A column the user summarises gets no automatic column KPI as well, and
 *   the KPIs' identity fields never reach the mapping screen.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import { Session, type ContextRequest } from "@/engine/session";
import type { ExportContext } from "@/engine/export/context";
import type { UserKpi } from "@/engine/kpi/userKpis";
import { close, loadIntoDuckDB, scalar } from "./helpers/duck";

const CITIES = ["Pune", "Delhi", "Mumbai", "Chennai", "Kolkata"];

function csv(): {
  text: string;
  revenue: number[];
  cost: number[];
  rating: Array<number | null>;
  city: string[];
} {
  const rows = ["Invoice No,Invoice Date,City,Quantity,Revenue,Cost,Rating,Notes"];
  const revenue: number[] = [];
  const cost: number[] = [];
  const rating: Array<number | null> = [];
  const city: string[] = [];
  for (let i = 0; i < 240; i++) {
    const r = 500 + ((i * 41) % 700);
    const c = Math.round(r * 0.6);
    const rt = i % 9 === 0 ? null : ((i * 3) % 5) + 1;
    revenue.push(r);
    cost.push(c);
    rating.push(rt);
    city.push(CITIES[i % 5] as string);
    rows.push(
      [
        `INV-${1000 + i}`,
        `2025-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
        CITIES[i % 5],
        (i % 4) + 1,
        r,
        c,
        rt ?? "",
        `note ${i % 7}`,
      ].join(","),
    );
  }
  return { text: rows.join("\n"), revenue, cost, rating, city };
}

const KPIS: UserKpi[] = [
  {
    id: "uk_revenue",
    name: "My revenue",
    value: { agg: "sum", column: "Revenue" },
    format: "currency",
    direction: "higher",
  },
  {
    id: "uk_rating",
    name: "Average rating",
    value: { agg: "avg", column: "Rating" },
    format: "decimal",
    direction: "higher",
  },
  {
    id: "uk_median_cost",
    name: "Median cost",
    value: { agg: "median", column: "Cost" },
    format: "currency",
    direction: "lower",
  },
  {
    id: "uk_top_sale",
    name: "Largest sale",
    value: { agg: "max", column: "Revenue" },
    format: "currency",
    direction: "higher",
  },
  {
    id: "uk_cities",
    name: "Cities",
    value: { agg: "countDistinct", column: "City" },
    format: "integer",
    direction: "higher",
  },
  {
    id: "uk_rows",
    name: "Invoices",
    value: { agg: "count", column: null },
    format: "integer",
    direction: "higher",
  },
  {
    id: "uk_cost_share",
    name: "Cost share",
    value: { agg: "sum", column: "Cost" },
    per: { agg: "sum", column: "Revenue" },
    format: "percent",
    direction: "lower",
  },
  // Can't be built: a total of text, and a column the file doesn't have.
  {
    id: "uk_notes",
    name: "Total notes",
    value: { agg: "sum", column: "Notes" },
    format: "number",
    direction: "neutral",
  },
  {
    id: "uk_ghost",
    name: "Ghost",
    value: { agg: "sum", column: "Discount" },
    format: "number",
    direction: "neutral",
  },
];

const connections: DuckDBConnection[] = [];
afterAll(() => connections.forEach(close));

describe("KPIs the user builds", async () => {
  const data = csv();
  const s = new Session();
  const load = await s.ingest(new Blob([data.text]), "invoices.csv", {});
  if (load.status !== "ok") throw new Error(load.status);
  const req: ContextRequest = { domainId: "sales", numberLocale: "INTL", currency: null };
  const plain = s.configure(req);
  const ctx = s.configure({ ...req, customKpis: KPIS });
  const values = new Map(
    s
      .previewKpis(
        [],
        KPIS.map((k) => k.id),
      )
      .values.map((v) => [v.id, v.value]),
  );
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const rated = data.rating.filter((r): r is number => r !== null);
  const sortedCost = [...data.cost].sort((a, b) => a - b);

  it("computes each one from the column, as worked out by hand", () => {
    expect(values.get("uk_revenue")).toBeCloseTo(sum(data.revenue), 6);
    expect(values.get("uk_rating")).toBeCloseTo(sum(rated) / rated.length, 9);
    expect(values.get("uk_median_cost")).toBeCloseTo(
      (sortedCost[119] as number) / 2 + (sortedCost[120] as number) / 2,
      9,
    );
    expect(values.get("uk_top_sale")).toBe(Math.max(...data.revenue));
    expect(values.get("uk_cities")).toBe(5);
    expect(values.get("uk_rows")).toBe(240);
    // A ratio of totals, not an average of row ratios.
    expect(values.get("uk_cost_share")).toBeCloseTo(sum(data.cost) / sum(data.revenue), 12);
  });

  it("leaves out what it can't compute, saying why", () => {
    const why = new Map(ctx.customKpiIssues.map((x) => [x.id, x.reason]));
    expect(why.get("uk_notes")).toMatch(/"Notes" holds text, so it can't be added up/);
    expect(why.get("uk_ghost")).toMatch(/needs the column "Discount", which is hidden or not in this file/);
    expect(ctx.kpis.some((k) => k.id === "uk_notes" || k.id === "uk_ghost")).toBe(false);
    // A hidden column is the same as a missing one.
    const hidden = s.configure({ ...req, customKpis: KPIS, hiddenColumns: ["Cost"] });
    expect(hidden.customKpiIssues.map((x) => x.id)).toEqual(
      expect.arrayContaining(["uk_median_cost", "uk_cost_share"]),
    );
    s.configure({ ...req, customKpis: KPIS });
  });

  it("writes SQL that DuckDB agrees with, and DAX for each", async () => {
    const mine = ctx.kpis.filter((k) => k.id.startsWith("uk_"));
    expect(mine).toHaveLength(7);
    for (const k of mine) {
      expect(k.sql, k.id).toBeTruthy();
      expect(k.dax, k.id).toBeTruthy();
      expect(k.group).toBe("Your KPIs");
    }
    const ec = (s as unknown as { exportContext(): ExportContext }).exportContext();
    const bundle = s.verificationBundle();
    const conn = await loadIntoDuckDB(ec.ds, bundle.table, ec.names.columns);
    connections.push(conn);
    const ours = bundle.queries.filter((q) => q.id.startsWith("uk_"));
    expect(ours).toHaveLength(7);
    for (const q of ours) {
      const got = await scalar(conn, q.sql);
      expect(
        Math.abs(got - (q.engine as number)),
        `${q.id}: DuckDB ${got} vs engine ${q.engine}`,
      ).toBeLessThan(1e-6);
    }
    // They export with the other measures.
    expect(s.exportDax()).toContain("Cost share");
  });

  it("takes over the columns it reads, without leaking internals", () => {
    // Without the user's KPI, Rating gets an automatic average; with it, it doesn't get a second one.
    expect(plain.kpis.some((k) => k.id === "yc_avg_rating")).toBe(true);
    expect(ctx.kpis.some((k) => k.id === "yc_avg_rating")).toBe(false);
    expect(ctx.domain.fields.some((f) => f.id.startsWith("uk_"))).toBe(false);
    expect(Object.keys(ctx.mapping.fields).some((f) => f.startsWith("uk_"))).toBe(false);
  });
});
