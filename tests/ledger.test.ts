/**
 * Ledgers read the way the file writes them (version 51.3), each rebuilt from
 * a real file the computation audit ran:
 * - A signed ledger or bank export writes spending as negative numbers, so
 *   subtracting it added it back (the owner's file: operating margin 141%).
 *   Each cost class written negative is now counted as a positive amount, and
 *   so is the rest of a signed ledger's spending (Melbourne's cash flow).
 * - A trial balance writes revenue as negative credits.
 * - Transfers, share trades, savings and balances are neither income nor
 *   expense, so they are left out of the expenses.
 * - A spend list's "Expenditure Type" of "Revenue" is operating spending, not
 *   income (a UK department's operating margin read −6,426%).
 * - A P&L written with positive costs is left exactly as it was.
 * Every rewrite changes the formula, so DuckDB agrees with the engine.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import { Session } from "@/engine/session";
import type { ExportContext } from "@/engine/export/context";
import { close, loadIntoDuckDB, scalar } from "./helpers/duck";

const connections: DuckDBConnection[] = [];
afterAll(() => connections.forEach(close));

async function load(csv: string, name = "ledger.csv") {
  const s = new Session();
  const res = await s.ingest(new Blob([csv]), name, {});
  if (res.status !== "ok") throw new Error(res.status);
  const ctx = s.configure({ domainId: "finance", numberLocale: "INTL", currency: null });
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

/** A ledger of revenue, cost of sales and operating expenses, each class signed as `sign` says. */
function ledger(sign: { revenue: 1 | -1; costs: 1 | -1 }, extra: string[] = []) {
  const rows = ["Date,Account,Account Type,Amount"];
  const sums = { revenue: 0, cogs: 0, opex: 0 };
  for (let i = 0; i < 36; i++) {
    const r = 1000 + ((i * 37) % 400);
    const c = 300 + ((i * 11) % 100);
    const o = 200 + ((i * 7) % 80);
    sums.revenue += r;
    sums.cogs += c;
    sums.opex += o;
    rows.push(`${date(i)},Sales,Revenue,${sign.revenue * r}`);
    rows.push(`${date(i)},Materials,Cost of sales,${sign.costs * c}`);
    rows.push(`${date(i)},Rent,Operating expense,${sign.costs * o}`);
  }
  return { csv: [...rows, ...extra].join("\n"), sums };
}

describe("a signed ledger (spending written as negative numbers)", async () => {
  const { csv, sums } = ledger({ revenue: 1, costs: -1 });
  const { s, value, kpi } = await load(csv);

  it("counts each cost as a positive amount, so the margins are real", () => {
    expect(value("revenue")).toBeCloseTo(sums.revenue, 6);
    expect(value("cogs")).toBeCloseTo(sums.cogs, 6);
    expect(value("opex")).toBeCloseTo(sums.opex, 6);
    expect(value("total_expenses")).toBeCloseTo(sums.cogs + sums.opex, 6);
    expect(value("operating_margin")).toBeCloseTo((sums.revenue - sums.cogs - sums.opex) / sums.revenue, 9);
    expect(value("operating_margin")).toBeLessThan(1);
  });

  it("says why on the figure", () => {
    expect(kpi("cogs")?.caveat).toMatch(/written as negative numbers/);
  });

  it("matches DuckDB for every KPI", async () => {
    expect(await duckMismatches(s)).toEqual([]);
  });
});

describe("a trial balance (revenue written as negative credits)", async () => {
  const { csv, sums } = ledger({ revenue: -1, costs: 1 });
  const { s, value } = await load(csv, "trial_balance.csv");

  it("counts revenue as a positive amount", () => {
    expect(value("revenue")).toBeCloseTo(sums.revenue, 6);
    expect(value("total_expenses")).toBeCloseTo(sums.cogs + sums.opex, 6);
    expect(value("net_margin")).toBeGreaterThan(0);
  });

  it("matches DuckDB for every KPI", async () => {
    expect(await duckMismatches(s)).toEqual([]);
  });
});

describe("rows that are neither income nor expense", async () => {
  const moves = [
    "2024-03-01,Brokerage,Trade,-5000",
    "2024-04-01,To savings,Transfer,-8000",
    "2024-05-01,Opening,Opening balance,25000",
  ];
  const { csv, sums } = ledger({ revenue: 1, costs: -1 }, moves);
  const { value } = await load(csv);

  it("leaves transfers, trades and balances out of the expenses", () => {
    expect(value("total_expenses")).toBeCloseTo(sums.cogs + sums.opex, 6);
    expect(value("revenue")).toBeCloseTo(sums.revenue, 6);
  });
});

describe("a signed ledger's remaining spending", async () => {
  // Unclassified payments with a few receipts among them, as on a cash-flow statement.
  const other = Array.from(
    { length: 12 },
    (_, i) => `${date(i)},Payments to suppliers,Operating activities,${i % 4 ? -900 : 400}`,
  );
  const { csv, sums } = ledger({ revenue: 1, costs: -1 }, other);
  const { s, value } = await load(csv, "cash_flow.csv");

  it("follows the ledger's convention, so expenses stay positive", () => {
    expect(value("total_expenses")).toBeCloseTo(sums.cogs + sums.opex + 9 * 900 - 3 * 400, 6);
    expect(value("net_margin")).toBeLessThan(1);
  });

  it("matches DuckDB for every KPI", async () => {
    expect(await duckMismatches(s)).toEqual([]);
  });
});

describe("a spend list", async () => {
  const rows = ["Date,Supplier,Expenditure Type,Amount"];
  for (let i = 0; i < 60; i++)
    rows.push(
      `${date(i)},Supplier ${i % 9},${["Revenue", "Revenue grants", "Professional services"][i % 3]},${25000 + ((i * 131) % 9000)}`,
    );
  const { ctx, kpi } = await load(rows.join("\n"), "spend_over_25k.csv");

  it("counts no row as revenue, so no margin divides by spending", () => {
    expect(ctx.mapping.fields.account_type).toBe("Expenditure Type");
    expect(kpi("revenue")?.available).toBe(false);
    expect(kpi("operating_margin")?.available).toBe(false);
  });
});

describe("a P&L written with positive costs", async () => {
  const { csv, sums } = ledger({ revenue: 1, costs: 1 });
  const { value, ctx } = await load(csv);

  it("is left as it was", () => {
    expect(value("total_expenses")).toBeCloseTo(sums.cogs + sums.opex, 6);
    expect(value("operating_margin")).toBeCloseTo((sums.revenue - sums.cogs - sums.opex) / sums.revenue, 9);
    expect(ctx.kpis.some((k) => /negative numbers/.test(k.caveat ?? ""))).toBe(false);
  });
});
