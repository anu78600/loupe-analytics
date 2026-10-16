/**
 * Readable SQL and DAX (compile/sqlFormat.ts, compile/codeTokens.ts,
 * export/codeHtml.ts and the layout of kpis.sql and measures.dax).
 *
 * - prettySql changes white space only: for every KPI of every demo file the
 *   tokens are the same, in order; it is idempotent; and the laid-out lines
 *   stay within reach of the width.
 * - The laid-out SQL is what the verification runs, and DuckDB still returns
 *   the engine's value for every KPI of the e-commerce demo.
 * - The tokenizer gives back its input exactly and tells the language from
 *   the user's names and values, in SQL and in DAX.
 * - kpis.sql and measures.dax have one heading per topic, and the HTML page
 *   is one self-contained file with every KPI in colour.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import { Session } from "@/engine/session";
import type { ExportContext } from "@/engine/export/context";
import { SAMPLES } from "@/engine/samples/catalog";
import { tokenize } from "@/engine/compile/codeTokens";
import { kpiQuery, quoteIdent } from "@/engine/compile/sql";
import { prettySql, SQL_WIDTH } from "@/engine/compile/sqlFormat";
import { makeSqlContext } from "@/engine/kpi/context";
import { generateCodeHtml } from "@/engine/export/codeHtml";
import { close, loadIntoDuckDB, scalar } from "./helpers/duck";

const words = (sql: string) =>
  tokenize(sql, "sql")
    .filter((t) => t.kind !== "space")
    .map((t) => t.text);

const connections: DuckDBConnection[] = [];
afterAll(() => connections.forEach(close));

describe("prettySql", () => {
  for (const sample of SAMPLES) {
    it(`only moves white space, for every KPI of ${sample.id}`, () => {
      const s = new Session();
      s.ingestSample(sample.id);
      s.configure({ domainId: sample.domain, numberLocale: "IN", currency: null });
      const ec = (s as unknown as { exportContext(): ExportContext }).exportContext();
      const ctx = { ...makeSqlContext(ec.ds, ec.mapping, ec.res, ec.names), table: quoteIdent("t") };
      let checked = 0;
      for (const r of ec.res.values()) {
        if (!r.available || !r.variant) continue;
        let raw: string;
        try {
          raw = kpiQuery(r.variant.expr, ctx);
        } catch {
          continue;
        }
        const pretty = prettySql(raw);
        expect(words(pretty), r.def.id).toEqual(words(raw));
        expect(prettySql(pretty), r.def.id).toBe(pretty);
        for (const line of pretty.split("\n"))
          expect(line.length, `${r.def.id}: ${line}`).toBeLessThanOrEqual(SQL_WIDTH + 30);
        checked++;
      }
      expect(checked).toBeGreaterThan(5);
    });
  }

  it("lays a long filtered ratio out over lines, CASE parts on their own", () => {
    const raw = `SELECT (COUNT(DISTINCT CASE WHEN ("s" IS NULL OR "s" NOT IN ('Cancelled')) AND ("s" IS NULL OR "s" NOT IN ('Returned')) THEN "id" END) * 1.0 / NULLIF(COUNT(DISTINCT "id"), 0)) AS value\nFROM "t"`;
    const pretty = prettySql(raw);
    expect(pretty.split("\n").length).toBeGreaterThan(6);
    expect(pretty).toMatch(/^\s+WHEN \("s" IS NULL OR "s" NOT IN \('Cancelled'\)\)$/m);
    expect(pretty).toMatch(/^\s+AND \("s" IS NULL OR "s" NOT IN \('Returned'\)\)$/m);
    expect(pretty).toMatch(/^\s+THEN "id"$/m);
    expect(pretty).toMatch(/^\s+\/ NULLIF\(COUNT\(DISTINCT "id"\), 0\)$/m);
    expect(pretty.endsWith(`) AS value\nFROM "t"`)).toBe(true);
    // A line that already fits is left exactly as it was.
    expect(prettySql(`SELECT COUNT(*) AS value\nFROM "t"`)).toBe(`SELECT COUNT(*) AS value\nFROM "t"`);
  });

  it("is what the verification runs, and DuckDB still agrees with the engine", async () => {
    const s = new Session();
    s.ingestSample("ecommerce");
    s.configure({ domainId: "ecommerce", numberLocale: "IN", currency: null });
    const ec = (s as unknown as { exportContext(): ExportContext }).exportContext();
    const bundle = s.verificationBundle();
    expect(bundle.queries.some((q) => q.sql.includes("\n    WHEN "))).toBe(true);
    const conn = await loadIntoDuckDB(ec.ds, bundle.table, ec.names.columns);
    connections.push(conn);
    for (const q of bundle.queries) {
      if (typeof q.engine !== "number" || !Number.isFinite(q.engine)) continue;
      const got = await scalar(conn, q.sql);
      const tol = Math.max(1e-6, Math.abs(q.engine) * 1e-9);
      expect(Math.abs(got - q.engine), `${q.id}: DuckDB ${got} vs engine ${q.engine}`).toBeLessThan(tol);
    }
  });
});

describe("tokenize", () => {
  it("gives back its input and tells the language from the user's names and values", () => {
    const sql = `SELECT COUNT(DISTINCT "order_id") AS value -- note\nFROM "orders" WHERE "status" = 'Returned' AND x > 1.5`;
    const t = tokenize(sql, "sql");
    expect(t.map((x) => x.text).join("")).toBe(sql);
    const kind = (text: string) => t.find((x) => x.text === text)?.kind;
    expect(kind("SELECT")).toBe("keyword");
    expect(kind("COUNT")).toBe("function");
    expect(kind(`"order_id"`)).toBe("name");
    expect(kind(`'Returned'`)).toBe("string");
    expect(kind("1.5")).toBe("number");
    expect(kind("-- note")).toBe("comment");

    const dax = `VAR x = CALCULATE ( [Net Revenue], 'Orders'[return_flag] = "Yes" ) // why\nRETURN x`;
    const d = tokenize(dax, "dax");
    expect(d.map((x) => x.text).join("")).toBe(dax);
    const dk = (text: string) => d.find((x) => x.text === text)?.kind;
    expect(dk("VAR")).toBe("keyword");
    expect(dk("CALCULATE")).toBe("function");
    expect(dk("[Net Revenue]")).toBe("name");
    expect(dk("'Orders'")).toBe("name");
    expect(dk("[return_flag]")).toBe("name");
    expect(dk(`"Yes"`)).toBe("string");
    expect(dk("// why")).toBe("comment");
  });
});

describe("the readable files", () => {
  const s = new Session();
  s.ingestSample("ecommerce");
  s.configure({ domainId: "ecommerce", numberLocale: "IN", currency: null });
  const ec = (s as unknown as { exportContext(): ExportContext }).exportContext();

  it("give each topic one heading in kpis.sql and measures.dax", () => {
    const sql = s.exportSql();
    expect(sql).toMatch(/^-- 1 · TABLE$/m);
    expect(sql).toMatch(/^-- 5 · OTHER DATABASES$/m);
    expect(sql.indexOf("Dialect") === -1 || sql.indexOf("5 · OTHER DATABASES") < sql.indexOf("MySQL 8")).toBe(
      true,
    );
    const dax = s.exportDax();
    for (const text of [sql, dax]) {
      const topics = [...text.matchAll(/^(?:--| {4}\/\/) ([A-Z][A-Z &/]+)$/gm)].map((m) => m[1]);
      expect(topics.length).toBeGreaterThan(2);
      expect(new Set(topics).size).toBe(topics.length);
    }
  });

  it("puts every KPI's SQL and DAX in one self-contained, coloured page", () => {
    const html = generateCodeHtml(ec, "₹");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/<script|<link|https?:\/\//i);
    expect(html).toContain("Your table and columns");
    expect(html).toContain(`<span class="n">&quot;net_amount&quot;</span>`);
    expect(html).toContain(`<span class="k">SELECT</span>`);
    expect(html).toContain("Net Revenue");
    const cards = (html.match(/<section class="kpi"/g) ?? []).length;
    expect(cards).toBeGreaterThan(10);
  });
});
