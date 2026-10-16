/**
 * Yes/no columns leave Loupe as the file wrote them (core/booleans.ts).
 *
 * A sales file with Return_Flag = Yes/No (no order status, so the return
 * KPIs read the flag) and Is_Gift = TRUE/FALSE:
 * - the exported CSV keeps "Yes"/"No" and "TRUE"/"FALSE" exactly;
 * - the Power BI model and the SQL table declare Return_Flag as text and
 *   Is_Gift as true/false, so both load the CSV as it is;
 * - the SQL and DAX conditions compare Return_Flag with 'Yes'/"Yes", and the
 *   SQL still returns the engine's value for every KPI in DuckDB.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import { Session } from "@/engine/session";
import type { ExportContext } from "@/engine/export/context";
import { generateTmdl } from "@/engine/export/tmdl";
import { close, loadIntoDuckDB, scalar } from "./helpers/duck";

function csv(): string {
  const rows = ["Order_ID,Order_Date,Customer_ID,Quantity,Net_Sales,Return_Flag,Is_Gift"];
  for (let i = 0; i < 400; i++) {
    const month = String((i % 12) + 1).padStart(2, "0");
    const day = String((i % 27) + 1).padStart(2, "0");
    const returned = i % 7 === 0;
    rows.push(
      [
        `ORD-${5000 + i}`,
        `2025-${month}-${day}`,
        `C-${100 + (i % 90)}`,
        (i % 3) + 1,
        300 + ((i * 53) % 1700),
        returned ? "Yes" : "No",
        i % 5 === 0 ? "TRUE" : "FALSE",
      ].join(","),
    );
  }
  return rows.join("\n");
}

const connections: DuckDBConnection[] = [];
afterAll(() => connections.forEach(close));

describe("yes/no columns in exports", async () => {
  const s = new Session();
  const load = await s.ingest(new Blob([csv()]), "returns.csv", {});
  if (load.status !== "ok") throw new Error(load.status);
  s.configure({ domainId: "ecommerce", numberLocale: "INTL", currency: null });
  const ec = (s as unknown as { exportContext(): ExportContext }).exportContext();
  const name = (original: string) => ec.names.columns.get(original) ?? original;

  it("writes the CSV exactly as the file had it", () => {
    const lines = new TextDecoder().decode(s.exportCsv()).trim().split(/\r?\n/);
    const header = (lines[0] as string).split(",");
    const flag = header.indexOf(name("Return_Flag"));
    const gift = header.indexOf(name("Is_Gift"));
    const flags = new Set(lines.slice(1).map((l) => l.split(",")[flag]));
    const gifts = new Set(lines.slice(1).map((l) => l.split(",")[gift]));
    expect(flags).toEqual(new Set(["Yes", "No"]));
    expect(gifts).toEqual(new Set(["TRUE", "FALSE"]));
  });

  it("declares words as text and TRUE/FALSE as true/false, in Power BI and SQL", () => {
    const tmdl = Object.values(generateTmdl(ec, "₹", ec.names.table)).join("\n");
    expect(tmdl).toMatch(new RegExp(`column ${name("Return_Flag")}\\s+dataType: string`));
    expect(tmdl).toMatch(new RegExp(`column ${name("Is_Gift")}\\s+dataType: boolean`));
    const sql = s.exportSql();
    expect(sql).toMatch(new RegExp(`"${name("Return_Flag")}" VARCHAR`));
    expect(sql).toMatch(new RegExp(`"${name("Is_Gift")}" BOOLEAN`));
  });

  it("compares with the words in SQL and DAX, and DuckDB agrees with the engine", async () => {
    const bundle = s.verificationBundle();
    const flagTests = bundle.queries.filter((q) => q.sql.includes(`"${name("Return_Flag")}" = 'Yes'`));
    expect(flagTests.length).toBeGreaterThan(0);
    expect(s.exportDax()).toContain(`[${name("Return_Flag")}] = "Yes"`);
    const conn = await loadIntoDuckDB(ec.ds, bundle.table, ec.names.columns);
    connections.push(conn);
    for (const q of bundle.queries) {
      if (typeof q.engine !== "number" || !Number.isFinite(q.engine)) continue;
      const got = await scalar(conn, q.sql);
      expect(Math.abs(got - q.engine), `${q.id}: DuckDB ${got} vs engine ${q.engine}`).toBeLessThan(1e-6);
    }
  });
});
