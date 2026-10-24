/**
 * Percentages on another scale than the formulas expect (version 51.1): a
 * discount written as 10 where the sales template multiplies by 0.10.
 *
 * The owner found "Discount % 1,119%" on a real file whose Discount_Pct holds
 * 0–30; on a second file a few stray values (110, −5) made the column read as
 * money, and revenue rebuilt from it came out at −₹100 Cr. Here:
 * - points are divided by 100 in every formula that reads the field, the
 *   figures match a direct computation, the SQL shows the ÷ 100 and DuckDB
 *   returns the engine's values, and the KPI says why in its caveat;
 * - fractions are left exactly as they were;
 * - a percentage column with a few impossible values is still a percentage in
 *   points (not money), and the data check flags the strays;
 * - a field that expects points (milk fat %) is multiplied up from fractions.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import { Session } from "@/engine/session";
import type { ExportContext } from "@/engine/export/context";
import { getDomain } from "@/registry";
import type { DatasetProfile, ColumnProfile } from "@/engine/profile/types";
import { columnPercentScale, withPercentScales } from "@/engine/kpi/percentScale";
import { close, loadIntoDuckDB, scalar } from "./helpers/duck";

const connections: DuckDBConnection[] = [];
afterAll(() => connections.forEach(close));

/** A sales file of order lines with a discount per line, written as `discount(i)`. */
function salesCsv(discount: (i: number) => number | string): {
  csv: string;
  lines: Array<[number, number, number]>;
} {
  const rows = ["Order_ID,Order_Date,Customer_ID,Region,Product_Category,Quantity,Unit_Price,Discount_Pct"];
  const lines: Array<[number, number, number]> = [];
  const regions = ["North", "South", "East", "West"];
  const cats = ["Electronics", "Fashion", "Home"];
  for (let i = 0; i < 240; i++) {
    const q = 1 + (i % 5);
    const p = 500 + ((i * 37) % 900);
    const d = discount(i);
    lines.push([q, p, typeof d === "number" ? d : Number(d)]);
    const day = 1 + (i % 28);
    const month = 1 + (Math.floor(i / 28) % 12);
    rows.push(
      `ORD-${1000 + i},2024-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")},CUST-${100 + (i % 60)},${regions[i % 4]},${cats[i % 3]},${q},${p},${d}`,
    );
  }
  return { csv: rows.join("\n"), lines };
}

async function load(csv: string) {
  const s = new Session();
  const res = await s.ingest(new Blob([csv]), "orders.csv", {});
  if (res.status !== "ok") throw new Error(res.status);
  const ctx = s.configure({ domainId: "sales", numberLocale: "INTL", currency: null });
  const batch = s.kpiBatch(
    [],
    ctx.kpis.filter((k) => k.available).map((k) => k.id),
    "INTL",
  );
  const value = (id: string) => batch.values.find((v) => v.id === id)?.value ?? null;
  return { s, ctx, value, kpi: (id: string) => ctx.kpis.find((k) => k.id === id) };
}

async function duckMismatches(s: Session): Promise<string[]> {
  const ec = (s as unknown as { exportContext(): ExportContext }).exportContext();
  const bundle = s.verificationBundle();
  const conn = await loadIntoDuckDB(ec.ds, bundle.table, ec.names.columns);
  connections.push(conn);
  const out: string[] = [];
  for (const q of bundle.queries) {
    const got = await scalar(conn, q.sql);
    const want = q.engine ?? NaN;
    const same =
      (Number.isNaN(got) && Number.isNaN(want)) || Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want));
    if (!same) out.push(`${q.id}: DuckDB ${got} vs engine ${want}`);
  }
  return out;
}

/** Discounts and revenue computed by hand from the lines, with the discount as a fraction. */
function expected(lines: Array<[number, number, number]>, scale: number) {
  let gross = 0;
  let disc = 0;
  for (const [q, p, d] of lines) {
    gross += q * p;
    disc += q * p * (d / scale);
  }
  return { gross, disc, revenue: gross - disc, pct: disc / gross };
}

describe("a discount written in points (10 = 10%)", async () => {
  const { csv, lines } = salesCsv((i) => [0, 5, 10, 15, 20, 30][i % 6] as number);
  const { s, ctx, value, kpi } = await load(csv);
  const want = expected(lines, 100);

  it("is read as a percentage in points", () => {
    const c = ctx.profile.columns.find((x) => x.name === "Discount_Pct");
    expect(c).toMatchObject({ role: "percentage", percentScale: 100 });
  });

  it("is divided by 100 in every formula, so the figures are right", () => {
    expect(value("discount_rate")).toBeCloseTo(want.pct, 9);
    expect(value("discount_rate")).toBeLessThan(1);
    expect(value("discounts")).toBeCloseTo(want.disc, 6);
    expect(value("revenue")).toBeCloseTo(want.revenue, 6);
    expect(value("revenue")).toBeGreaterThan(0);
  });

  it("shows the ÷ 100 in its SQL and DAX, and says why", () => {
    // The safe divide each back-end uses for `div`: NULLIF in SQL, DIVIDE in DAX.
    expect(kpi("discounts")?.sql).toContain('"discount_pct" * 1.0 / NULLIF(100, 0)');
    expect(kpi("discounts")?.dax).toContain("DIVIDE ( 'Sales'[discount_pct], 100 )");
    expect(kpi("discounts")?.caveat).toMatch(/Discount_Pct is written in points in your file \(10 = 10%\)/);
  });

  it("matches DuckDB for every KPI", async () => {
    expect(await duckMismatches(s)).toEqual([]);
  });
});

describe("a discount written as fractions (0.10 = 10%)", async () => {
  const { csv, lines } = salesCsv((i) => [0, 0.05, 0.1, 0.15, 0.2, 0.3][i % 6] as number);
  const { value, kpi } = await load(csv);
  const want = expected(lines, 1);

  it("is used as written", () => {
    expect(value("discount_rate")).toBeCloseTo(want.pct, 9);
    expect(value("revenue")).toBeCloseTo(want.revenue, 6);
    expect(kpi("discounts")?.sql).not.toMatch(/\/ 100/);
    expect(kpi("discounts")?.caveat ?? "").not.toMatch(/written in points/);
  });
});

describe("a discount in points with a few impossible values (110, −5)", async () => {
  const { csv } = salesCsv((i) =>
    i === 7 ? 110 : i === 19 ? -5 : ([0, 5, 10, 15, 20, 30][i % 6] as number),
  );
  const { s, ctx, value } = await load(csv);

  it("is still a percentage in points, never money", () => {
    const c = ctx.profile.columns.find((x) => x.name === "Discount_Pct");
    expect(c).toMatchObject({ role: "percentage", percentScale: 100, additivity: "non-additive" });
    expect(value("discount_rate")).toBeLessThan(1);
    expect(value("revenue")).toBeGreaterThan(0);
  });

  it("is flagged by the data check", () => {
    const issues = ctx.health.issues.filter((i) => i.column === "Discount_Pct");
    expect(issues.length).toBeGreaterThan(0);
    void s;
  });
});

describe("the scale of a column", () => {
  const col = (role: ColumnProfile["role"], min: number, max: number, percentScale?: 1 | 100) =>
    ({ name: "x", role, percentScale, numeric: { min, max } }) as unknown as ColumnProfile;

  it("comes from the profile, or from a rate's range", () => {
    expect(columnPercentScale(col("percentage", 0, 30, 100))).toBe(100);
    expect(columnPercentScale(col("percentage", 0, 0.3, 1))).toBe(1);
    expect(columnPercentScale(col("rate", 0, 0.9))).toBe(1);
    expect(columnPercentScale(col("rate", 0, 85))).toBe(100);
    expect(columnPercentScale(col("rate", 0, 1.2))).toBeUndefined();
    expect(columnPercentScale(col("currency", 0, 30))).toBeUndefined();
  });

  it("is multiplied up for a field that expects points (milk fat %)", () => {
    const domain = getDomain("agriculture");
    if (!domain) throw new Error("no agriculture domain");
    const profile = {
      columns: [col("percentage", 0.03, 0.06, 1)].map((c) => ({ ...c, name: "Fat" })),
    } as unknown as DatasetProfile;
    const mapping = { fields: { fat_pct: "Fat" }, scores: {}, classes: {} };
    const out = withPercentScales(domain, mapping, profile);
    const avg = out.kpis
      .find((k) => k.id === "avg_fat")
      ?.variants.find((v) => JSON.stringify(v.expr).includes("fat_pct"));
    expect(JSON.stringify(avg?.expr)).toContain('{"op":"mul","args":[{"field":"fat_pct"},{"num":100}]}');
    expect(avg?.caveat).toMatch(/Fat is written as fractions in your file/);
  });
});
