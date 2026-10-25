/**
 * Figures that can't be, and figures that say nothing (version 51.4), each
 * rebuilt from a real file the computation audit ran:
 * - A KPI's limits (registry `limits`, kpi/limits.ts): a supermarket's Total
 *   includes 5% tax, so "gross sales − revenue" made discounts −15,379 and
 *   Discount % −5%. That formula is refused, and the KPI says why. Discounts
 *   written as negative numbers are counted as positive instead.
 * - A spend list's lone credit made cost of sales −600,000: refused too.
 * - Discounts worked out as gross sales − revenue on a till file whose Total
 *   is always price × quantity came to 0: the file records no discounts, so
 *   the KPI says so instead of "Discounts $0".
 * - A formula that is constant by construction (kpi/resolve.ts): with no
 *   cost-of-sales lines, gross margin was revenue ÷ revenue, always 100%. It
 *   now says it needs cost of sales.
 * Every KPI still shown matches DuckDB.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import { Session } from "@/engine/session";
import type { ExportContext } from "@/engine/export/context";
import { close, loadIntoDuckDB, scalar } from "./helpers/duck";

const connections: DuckDBConnection[] = [];
afterAll(() => connections.forEach(close));

async function load(csv: string, domainId: string, name = "data.csv") {
  const s = new Session();
  const res = await s.ingest(new Blob([csv]), name, {});
  if (res.status !== "ok") throw new Error(res.status);
  const ctx = s.configure({ domainId, numberLocale: "INTL", currency: "USD" });
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

describe("a Total that includes tax (the Myanmar supermarket)", async () => {
  const rows = ["Invoice ID,Date,Branch,Unit price,Quantity,Total"];
  for (let i = 0; i < 120; i++) {
    const price = 10 + (i % 40);
    const qty = 1 + (i % 5);
    rows.push(`INV-${i},${date(i)},${"ABC"[i % 3]},${price},${qty},${(price * qty * 1.05).toFixed(4)}`);
  }
  const { s, kpi } = await load(rows.join("\n"), "sales", "supermarket.csv");

  it("doesn't show negative discounts, and says why", () => {
    expect(kpi("discounts")?.available).toBe(false);
    expect(kpi("discounts")?.unavailableReason).toMatch(/can't be below \$0/);
    expect(kpi("discounts")?.unavailableReason).toMatch(/Unit price/);
    expect(kpi("discount_rate")?.available).toBe(false);
  });

  it("matches DuckDB for every KPI still shown", async () => {
    expect(await duckMismatches(s)).toEqual([]);
  });
});

describe("discounts written as negative numbers", async () => {
  const rows = ["Invoice ID,Date,Customer,Gross Amount,Discount Amount,Net Amount"];
  let disc = 0;
  for (let i = 0; i < 90; i++) {
    const gross = 100 + ((i * 29) % 500);
    const d = i % 3 ? Math.round(gross * 0.1) : 0;
    disc += d;
    rows.push(`INV-${i},${date(i)},C${i % 15},${gross},${-d},${gross - d}`);
  }
  const { s, value, kpi } = await load(rows.join("\n"), "sales", "invoices.csv");

  it("counts them as positive discounts", () => {
    expect(value("discounts")).toBeCloseTo(disc, 6);
    expect(kpi("discounts")?.caveat).toMatch(/written as negative numbers/);
  });

  it("matches DuckDB for every KPI", async () => {
    expect(await duckMismatches(s)).toEqual([]);
  });
});

describe("a Total that is always price × quantity", async () => {
  const rows = ["Invoice ID,Date,Branch,Unit price,Quantity,Total"];
  for (let i = 0; i < 120; i++) {
    const price = 10 + (i % 40);
    const qty = 1 + (i % 5);
    rows.push(`INV-${i},${date(i)},${"ABC"[i % 3]},${price},${qty},${price * qty}`);
  }
  const { kpi } = await load(rows.join("\n"), "sales", "till.csv");

  it("shows no “Discounts 0”: the file records no discounts", () => {
    expect(kpi("discounts")?.available).toBe(false);
    expect(kpi("discounts")?.unavailableReason).toMatch(/comes to 0 over your whole file/);
    expect(kpi("discount_rate")?.available).toBe(false);
  });
});

describe("no discount data at all", async () => {
  const rows = ["Order ID,Order Date,Customer ID,Product,Amount"];
  for (let i = 0; i < 120; i++) rows.push(`O-${i},${date(i)},C${i % 30},P${i % 8},${20 + ((i * 17) % 300)}`);
  const { kpi, value } = await load(rows.join("\n"), "ecommerce", "orders.csv");

  it("shows no “Discounts 0”: it says what it needs", () => {
    expect(value("discounts")).toBeNull();
    expect(kpi("discounts")?.unavailableReason).toMatch(/needs Discount/);
    expect(kpi("discount_rate")?.available).toBe(false);
  });
});

describe("a ledger with no cost-of-sales lines", async () => {
  const rows = ["Date,Account,Account Type,Amount"];
  for (let i = 0; i < 36; i++) {
    rows.push(`${date(i)},Consulting,Revenue,${1000 + ((i * 37) % 400)}`);
    rows.push(`${date(i)},Rent,Operating expense,${300 + ((i * 11) % 100)}`);
  }
  const { kpi } = await load(rows.join("\n"), "finance", "ledger.csv");

  it("shows no gross margin of 100%: it says it needs cost of sales", () => {
    expect(kpi("gross_margin")?.available).toBe(false);
    expect(kpi("gross_margin")?.unavailableReason).toMatch(/Cost of sales/);
    expect(kpi("gross_profit")?.caveat).toMatch(/gross profit equals revenue/);
  });
});

describe("cost of sales that comes to less than zero", async () => {
  const rows = ["Date,Supplier,Account Type,Amount"];
  for (let i = 0; i < 40; i++)
    rows.push(`${date(i)},Supplier ${i % 7},Operating expense,${25000 + ((i * 131) % 9000)}`);
  rows.push(`2024-06-15,Supplier 2,Cost of sales,-600000`);
  rows.push(`2024-07-15,Customer 1,Revenue,900000`);
  const { kpi } = await load(rows.join("\n"), "finance", "spend.csv");

  it("is refused, and so is the gross margin built on it", () => {
    expect(kpi("cogs")?.available).toBe(false);
    expect(kpi("cogs")?.unavailableReason).toMatch(/−\$600,000.*can't be below \$0/);
    expect(kpi("gross_margin")?.available).toBe(false);
  });
});
