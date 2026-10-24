/**
 * Columns used for the wrong kind of figure (version 51.2), each rebuilt from
 * a real file the computation audit ran: 125 public datasets and the owner's
 * own files.
 *
 * - A rate never fills an amount: Superstore's Discount of 0.2 filled
 *   "discount amount", so "Discounts given" was $1,561 (the rates added up)
 *   and Discount % 0.07%. It now fills Discount %, and the discounts are
 *   rebuilt from the sales: about 20%, matching DuckDB.
 * - A header naming a rate heads an amount ("Tax 5%" holds the tax charged),
 *   and a code by name is a label ("Budget Ref" holding fiscal years 23–26
 *   added up to a "budget" of 632,921).
 * - A column whose values break its field's bound is not used for it: a
 *   supermarket's "gross income" (the margin) is below its "Total" on every
 *   row, so it is not gross sales; a bank's running balance is above the
 *   transaction on most rows, so it is not the amount owed. A field the user
 *   mapped by hand is kept as they chose.
 * - A column of changes ("Solar cons change TWh") fills no amount field.
 * - The e-commerce template rebuilds discounts from a discount % (Northwind).
 */
import { afterAll, describe, expect, it } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import { Session } from "@/engine/session";
import type { ExportContext } from "@/engine/export/context";
import { getDomain } from "@/registry";
import { scoreField, MATCH_THRESHOLD } from "@/engine/detect/match";
import type { ColumnProfile } from "@/engine/profile/types";
import { close, loadIntoDuckDB, scalar } from "./helpers/duck";

const connections: DuckDBConnection[] = [];
afterAll(() => connections.forEach(close));

async function load(
  csv: string,
  domainId: string,
  name = "data.csv",
  mappingOverrides?: Record<string, string | null>,
) {
  const s = new Session();
  const res = await s.ingest(new Blob([csv]), name, {});
  if (res.status !== "ok") throw new Error(res.status);
  const ctx = s.configure({ domainId, numberLocale: "INTL", currency: null, mappingOverrides });
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
    if (!(
      (Number.isNaN(got) && Number.isNaN(want)) ||
      Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want))
    ))
      out.push(`${q.id}: DuckDB ${got} vs engine ${want}`);
  }
  return out;
}

const date = (i: number) =>
  `2024-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`;

describe("a discount rate (Superstore)", async () => {
  const rows = ["Order ID,Order Date,Customer ID,Region,Category,Sales,Quantity,Discount,Profit"];
  const lines: Array<[number, number]> = [];
  for (let i = 0; i < 240; i++) {
    const sales = 50 + ((i * 53) % 900);
    const d = [0, 0.1, 0.2, 0.3, 0.5, 0][i % 6] as number;
    lines.push([sales, d]);
    rows.push(
      `CA-${2000 + i},${date(i)},CU-${i % 70},${["East", "West", "Central", "South"][i % 4]},${["Furniture", "Technology", "Office"][i % 3]},${sales},${1 + (i % 4)},${d},${(sales * 0.12).toFixed(2)}`,
    );
  }
  const { s, ctx, value, kpi } = await load(rows.join("\n"), "sales", "superstore.csv");

  it("fills Discount %, never the discount amount", () => {
    expect(ctx.mapping.fields.discount_pct).toBe("Discount");
    expect(ctx.mapping.fields.discount_amount).toBeUndefined();
  });

  it("rebuilds the discounts from the sales, so Discount % is right", () => {
    let gross = 0;
    let disc = 0;
    for (const [sales, d] of lines) {
      gross += sales / (1 - d);
      disc += (sales * d) / (1 - d);
    }
    expect(value("discounts")).toBeCloseTo(disc, 6);
    expect(value("discount_rate")).toBeCloseTo(disc / gross, 9);
    expect(value("discount_rate")).toBeGreaterThan(0.05);
    expect(kpi("discounts")?.variantLabel).toMatch(/discount %/i);
  });

  it("matches DuckDB for every KPI", async () => {
    expect(await duckMismatches(s)).toEqual([]);
  });
});

describe("names that say what a column is", async () => {
  const rows = ["Invoice ID,Date,Branch,Unit price,Quantity,Tax 5%,Total,Budget Ref"];
  for (let i = 0; i < 120; i++) {
    const net = (10 + (i % 40)) * (1 + (i % 5));
    rows.push(
      `INV-${i},${date(i)},${"ABC"[i % 3]},${10 + (i % 40)},${1 + (i % 5)},${(net * 0.05).toFixed(4)},${(net * 1.05).toFixed(4)},${[26, 26, 25, 24][i % 4]}`,
    );
  }
  const { ctx } = await load(rows.join("\n"), "sales", "branch.csv");
  const col = (n: string) => ctx.profile.columns.find((c) => c.name === n);

  it("reads “Tax 5%” as the tax charged, an amount that adds up", () => {
    expect(col("Tax 5%")).toMatchObject({ role: "currency", additivity: "additive" });
  });

  it("reads “Budget Ref” of 23–26 as a code, never money", () => {
    expect(col("Budget Ref")?.role).toBe("dimension");
    expect(Object.values(ctx.mapping.fields)).not.toContain("Budget Ref");
  });
});

describe("values that break a field's bound", async () => {
  // A supermarket file: "gross income" is the margin on each sale, always below its Total.
  const shop = ["Invoice ID,Date,Branch,Unit price,Quantity,gross income,Total"];
  for (let i = 0; i < 100; i++) {
    const net = (20 + (i % 30)) * (1 + (i % 4));
    shop.push(
      `750-${i},${date(i)},${"ABC"[i % 3]},${20 + (i % 30)},${1 + (i % 4)},${(net * 0.05).toFixed(2)},${(net * 1.05).toFixed(2)}`,
    );
  }

  it("doesn't use gross income as gross sales, and says why", async () => {
    const { ctx } = await load(shop.join("\n"), "sales", "supermarket.csv");
    expect(ctx.mapping.fields.gross_amount).toBeUndefined();
    expect(ctx.rejectedMappings).toEqual([
      expect.objectContaining({
        field: "gross_amount",
        column: "gross income",
        reason: expect.stringMatching(/below Total on 100% of rows/),
      }),
    ]);
  });

  it("keeps a field the user mapped by hand", async () => {
    const { ctx } = await load(shop.join("\n"), "sales", "supermarket.csv", { gross_amount: "gross income" });
    expect(ctx.mapping.fields.gross_amount).toBe("gross income");
    expect(ctx.rejectedMappings).toEqual([]);
  });

  it("doesn't use a running bank balance as the amount owed", async () => {
    const bank = ["Invoice No,Invoice Date,Customer,Amount,Balance"];
    let balance = 25000;
    for (let i = 0; i < 120; i++) {
      const amount = 100 + ((i * 37) % 2000);
      balance += i % 3 ? amount : -amount;
      bank.push(`INV-${i},${date(i)},C${i % 20},${amount},${balance}`);
    }
    const { ctx } = await load(bank.join("\n"), "finance", "bank.csv");
    expect(ctx.mapping.fields.outstanding).toBeUndefined();
    expect(ctx.rejectedMappings.map((r) => r.field)).toContain("outstanding");
  });
});

describe("kinds that never fill an amount field", () => {
  const col = (name: string, tokens: string[], role: ColumnProfile["role"]) =>
    ({
      name,
      tokens,
      role,
      storage: "number",
      distinct: 200,
      nullPct: 0,
      numeric: { min: 0, max: 0.8 },
    }) as unknown as ColumnProfile;

  it("a rate or share", () => {
    const field = getDomain("sales")?.fields.find((f) => f.id === "discount_amount");
    if (!field) throw new Error("no field");
    expect(scoreField(field, col("Discount", ["discount"], "percentage")).score).toBe(0);
  });

  it("a column of changes", () => {
    const field = getDomain("energy_utilities")?.fields.find((f) => f.id === "solar_mwh");
    if (!field) throw new Error("no field");
    const change = scoreField(
      field,
      col("solar_cons_change_twh", ["solar", "consumption", "change", "twh"], "measure"),
    );
    expect(change.score).toBeLessThan(MATCH_THRESHOLD);
    const level = scoreField(field, col("solar_electricity", ["solar", "electricity"], "measure"));
    expect(level.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });
});

describe("e-commerce discounts from a discount % (Northwind)", async () => {
  const rows = ["orderID,orderDate,productID,unitPrice,quantity,discount"];
  let disc = 0;
  for (let i = 0; i < 150; i++) {
    const p = 10 + (i % 25);
    const q = 1 + (i % 9);
    const d = [0, 0.05, 0.1, 0.15, 0.2, 0.25][i % 6] as number;
    disc += p * q * d;
    rows.push(`${10248 + Math.floor(i / 3)},${date(i)},${i % 40},${p},${q},${d}`);
  }
  const { value, ctx } = await load(rows.join("\n"), "ecommerce", "order_details.csv");

  it("rebuilds discounts as quantity × unit price × discount %", () => {
    expect(ctx.mapping.fields.discount_pct).toBe("discount");
    expect(value("discounts")).toBeCloseTo(disc, 6);
  });
});
