/**
 * Business questions (step 5): the SQL written for a question returns, in
 * DuckDB, exactly the rows the engine answers with: by category, by month,
 * by weekday and by hour, with the dashboard's filters as WHERE, for simple
 * KPIs, column aggregates, per-entity KPIs (repeat rate) and latest-balance
 * KPIs (MRR). KPIs counted by first-ever date (new customers) are listed as
 * skipped rather than approximated. Also checks how questions are read and
 * that every suggested question can be answered.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import { Session, type QuestionAnswer } from "@/engine/session";
import {
  readQuestion,
  suggestQuestions,
  type AskContext,
  type AskOrder,
  type ChartAsk,
} from "@/engine/charts/ask";
import { presetRange } from "@/engine/core/periods";
import type { Filter } from "@/engine/query/filter";
import type { ExportContext } from "@/engine/export/context";
import { close, loadIntoDuckDB } from "./helpers/duck";

const connections: DuckDBConnection[] = [];
afterAll(() => connections.forEach(close));

async function setup(sampleId: string) {
  const s = new Session();
  const load = s.ingestSample(sampleId);
  if (load.status !== "ok") throw new Error(load.status);
  const top = load.detection.candidates[0];
  if (!top) throw new Error("not detected");
  const ctx = s.configure({ domainId: top.domainId, numberLocale: "INTL", currency: null });
  const ec = (s as unknown as { exportContext(): ExportContext }).exportContext();
  const conn = await loadIntoDuckDB(ec.ds, ec.names.table.toLowerCase(), ec.names.columns);
  connections.push(conn);
  let n = 0;
  const answer = (
    ask: ChartAsk,
    filters: Filter[] = [],
    order: AskOrder = "desc",
    question = "test",
  ): QuestionAnswer =>
    s.answerQuestion(
      { id: `q${++n}`, question, understood: question, notes: [], ask, order, filters },
      "INTL",
    );
  const ask = (text: string, filters: Filter[] = []) => {
    const r = readQuestion(text, ctx as AskContext);
    return { reading: r, answer: answer(r.ask, filters, r.order, text) };
  };
  return { s, ctx, conn, answer, ask };
}

const close2 = (a: number | null, b: number | null) =>
  a === null || b === null ? a === b : Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/** A SQL key in the engine's raw form: dates → bucket ms, ISO weekday/month (1-based) → the engine's 0-based. */
function engineKey(sqlValue: unknown, a: QuestionAnswer): string {
  if (sqlValue === null || sqlValue === undefined) return "null";
  const k = a.ask.by;
  if (k.kind === "time") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(sqlValue));
    return m ? String(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : String(sqlValue);
  }
  if (k.kind === "part" && (k.part === "dow" || k.part === "month")) return String(Number(sqlValue) - 1);
  if (k.kind === "part") return String(Number(sqlValue));
  return String(sqlValue);
}

/** Runs every statement of the answer's SQL and checks each returned value against the engine's row. */
async function expectSqlMatches(conn: DuckDBConnection, a: QuestionAnswer) {
  expect(a.sql, a.understood).not.toBe("");
  const statements = a.sql
    .split(/;\s*(?:\n|$)/)
    .map((x) =>
      x
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
  const engine = new Map(a.rows.map((r) => [r.raw === null ? "null" : String(r.raw), r]));
  let compared = 0;
  for (const stmt of statements) {
    const rows = (await conn.runAndReadAll(stmt)).getRowObjectsJson() as Array<Record<string, unknown>>;
    if (a.keyLabel === null) {
      const row = rows[0] ?? {};
      a.measures.forEach((m, i) => {
        if (!(m.label in row)) return;
        const v = row[m.label];
        expect(
          close2(v === null ? null : Number(v), a.rows[0]?.values[i] ?? null),
          `${a.understood}: ${m.label}`,
        ).toBe(true);
        compared++;
      });
      continue;
    }
    // SQL has no row for a group without data (a weekday with no invoices); the engine lists it
    // with its empty value (0 for sums and counts, blank otherwise). Every other group must match.
    const sqlKeys = new Set(rows.map((row) => engineKey(row[a.keyLabel as string], a)));
    for (const [key, e] of engine)
      if (!sqlKeys.has(key))
        expect(
          e.values.every((v) => v === null || v === 0),
          `${a.understood}: engine group ${key} missing from SQL`,
        ).toBe(true);
    for (const row of rows) {
      const key = engineKey(row[a.keyLabel], a);
      const e = engine.get(key);
      expect(e, `${a.understood}: SQL group ${key} not in the engine's answer`).toBeDefined();
      a.measures.forEach((m, i) => {
        if (!(m.label in row)) return;
        const v = row[m.label];
        expect(
          close2(v === null ? null : Number(v), e?.values[i] ?? null),
          `${a.understood}: ${m.label} at ${key}`,
        ).toBe(true);
        compared++;
      });
    }
  }
  expect(compared, `${a.understood}: nothing compared`).toBeGreaterThan(0);
}

describe("questions on the sales demo", async () => {
  const { ctx, conn, answer, ask } = await setup("sales");
  const kpi = (name: string) => ctx.kpis.find((k) => k.name === name && k.available)?.id as string;
  const last12m: Filter[] = (() => {
    const r = ctx.dateColumn && ctx.dateBounds ? presetRange("last12m", ctx.dateBounds) : null;
    return r && ctx.dateColumn ? [{ kind: "dateRange", column: ctx.dateColumn, from: r.from, to: r.to }] : [];
  })();

  it("answers a ranking question in words, and its SQL returns the same rows", async () => {
    const { reading, answer: a } = ask("Which region has the highest revenue?");
    expect(reading.understood).toBe("Revenue by Region");
    expect(a.headline).toMatch(/has the highest revenue/);
    await expectSqlMatches(conn, a);
  });

  it("matches by month, by weekday, with filters, and for a column average", async () => {
    await expectSqlMatches(
      conn,
      answer({
        measures: [{ kind: "kpi", id: kpi("Revenue") }],
        by: { kind: "time", column: ctx.dateColumn as string, grain: "month" },
      }),
    );
    await expectSqlMatches(
      conn,
      answer({
        measures: [{ kind: "kpi", id: kpi("Invoices") }],
        by: { kind: "part", column: ctx.dateColumn as string, part: "dow" },
      }),
    );
    await expectSqlMatches(
      conn,
      answer(
        {
          measures: [
            { kind: "kpi", id: kpi("Revenue") },
            { kind: "kpi", id: kpi("Gross margin %") },
          ],
          by: { kind: "column", column: "Category" },
          topN: 100,
        },
        [...last12m, { kind: "in", column: "Region", values: ["North", "South"] }],
      ),
    );
    await expectSqlMatches(
      conn,
      answer(
        {
          measures: [{ kind: "column", column: "Discount %", agg: "avg" }],
          by: { kind: "column", column: "Product" },
          topN: 100,
        },
        [],
        "asc",
      ),
    );
  });

  it("matches a per-customer KPI by category, and skips new customers with the reason", async () => {
    const repeat = kpi("Repeat customer rate");
    const a = answer({
      measures: [
        { kind: "kpi", id: repeat },
        { kind: "kpi", id: kpi("New customers") },
      ],
      by: { kind: "column", column: "Region" },
      topN: 100,
    });
    expect(a.skipped.map((x) => x.label)).toEqual(["New customers"]);
    expect(a.sql).toMatch(/Not in SQL: New customers/);
    await expectSqlMatches(conn, a);
  });

  it("answers a whole-file question with one row", async () => {
    const { answer: a } = ask("What is the total revenue and gross profit?");
    expect(a.keyLabel).toBeNull();
    expect(a.rows).toHaveLength(1);
    await expectSqlMatches(conn, a);
  });

  it("can answer every suggested question", async () => {
    const suggested = suggestQuestions(ctx as AskContext);
    expect(suggested.length).toBeGreaterThan(3);
    for (const q of suggested) {
      const a = answer(q.ask, [], q.order, q.text);
      expect(a.error, q.text).toBeUndefined();
      expect(a.rows.length, q.text).toBeGreaterThan(0);
      if (a.sql) await expectSqlMatches(conn, a);
    }
  });
});

describe("questions on the SaaS and e-commerce demos", async () => {
  it("matches a latest-balance KPI (MRR) by plan", async () => {
    const { ctx, conn, answer } = await setup("saas");
    const mrr = ctx.kpis.find(
      (k) => k.available && /MRR/.test(k.name) && !/new|expansion|churn|contraction/i.test(k.name),
    );
    expect(mrr, "an MRR KPI").toBeDefined();
    await expectSqlMatches(
      conn,
      answer({
        measures: [{ kind: "kpi", id: mrr?.id as string }],
        by: { kind: "column", column: "Plan" },
        topN: 100,
      }),
    );
  });

  it("matches by hour of day", async () => {
    const { ctx, conn, answer } = await setup("ecommerce");
    const k = ctx.kpis.find((x) => x.available && !x.hidden);
    await expectSqlMatches(
      conn,
      answer({
        measures: [{ kind: "kpi", id: k?.id as string }],
        by: { kind: "part", column: ctx.dateColumn as string, part: "hour" },
      }),
    );
  });
});

describe("reading business questions", async () => {
  const s = new Session();
  const load = s.ingestSample("sales");
  if (load.status !== "ok") throw new Error(load.status);
  const ctx = s.configure({
    domainId: "sales",
    numberLocale: "INTL",
    currency: null,
  }) as unknown as AskContext;
  const read = (q: string) => readQuestion(q, ctx);

  it("turns question phrasing into a request", () => {
    expect(read("Which category has the lowest gross margin %?")).toMatchObject({
      order: "asc",
      understood: "Gross margin % by Category",
    });
    expect(read("Which 5 products sold the most?").ask).toMatchObject({
      topN: 5,
      by: { kind: "column", column: "Product" },
    });
    expect(read("How many invoices by region?").understood).toBe("Invoices by Region");
    expect(read("What is the revenue trend?").ask.by.kind).toBe("time");
    expect(read("Show me the bottom 3 sales reps by revenue").ask).toMatchObject({
      topN: 3,
      by: { kind: "column", column: "Sales Rep" },
    });
    expect(read("Show me the bottom 3 sales reps by revenue").order).toBe("asc");
  });
});
