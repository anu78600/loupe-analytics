/**
 * Business questions (step 5): the SQL written for a question returns, in
 * DuckDB, exactly the rows the engine answers with: by category, by month,
 * by weekday and by hour, with the dashboard's filters as WHERE, for simple
 * KPIs, column aggregates, per-entity KPIs (repeat rate) and latest-balance
 * KPIs (MRR). KPIs counted by first-ever date (new customers) are listed as
 * skipped rather than approximated. Also checks how questions are read: a
 * value, period or status named becomes a filter (never ignored, never a
 * hidden column's), a KPI named is kept, words nothing matches are reported
 * instead of answering another question, and typing a suggested question
 * reads to the ask clicking it sends, on every demo. And that the SQL keeps
 * the answer's groups (a ranking led by a per-entity KPI, an empty blank
 * group) and the answer's sentence reads like an analyst's.
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
import { SAMPLES } from "@/engine/samples/catalog";
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
  const { s, ctx, conn, answer, ask } = await setup("sales");
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

  it("gives each KPI card the SQL that returns its number, with the card's period and filters", async () => {
    const filters: Filter[] = [...last12m, { kind: "in", column: "Region", values: ["North", "South"] }];
    const ids = ["Revenue", "Gross margin %", "Repeat customer rate", "Average invoice value"].map(kpi);
    const batch = s.kpiBatch(filters, ids, "INTL");
    for (const id of ids) {
      const card = s.kpiCardSql(id, filters);
      expect(card?.filtered, id).toBe(true);
      expect(card?.sql).toMatch(/for the rows on the card: .*Region/);
      const statements = (card?.sql ?? "")
        .split(/;\s*(?:\n|$)/)
        .map((x) =>
          x
            .split("\n")
            .filter((l) => !l.trim().startsWith("--"))
            .join("\n")
            .trim(),
        )
        .filter(Boolean);
      const rows = (await conn.runAndReadAll(statements.at(-1) as string)).getRowObjectsJson();
      const v = Object.values(rows[0] ?? {})[0];
      const value = batch.values.find((x) => x.id === id)?.value ?? null;
      expect(close2(v === null || v === undefined ? null : Number(v), value), `${id}: ${v} vs ${value}`).toBe(
        true,
      );
    }
    // New customers counts by first-ever date, which a filtered query can't reproduce: the whole-file query, said so.
    expect(s.kpiCardSql(kpi("New customers"), filters)?.filtered).toBe(false);
    // With no filter the card's SQL is the KPI's own whole-file query.
    expect(s.kpiCardSql(ids[0] as string, [])).toMatchObject({ filtered: false });
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

  it("reads 'revenue' as the Net revenue KPI, so the answer matches the KPI card", async () => {
    const { s, ctx, conn, ask } = await setup("ecommerce");
    expect(ctx.kpis.find((k) => k.id === "net_revenue")?.available, "Net revenue on the demo").toBe(true);
    const { reading, answer } = ask("Which category has the highest revenue?");
    expect(reading.ask.measures).toEqual([{ kind: "kpi", id: "net_revenue" }]);
    // Net revenue leaves out cancelled, returned and RTO orders, so the categories add up to the card.
    const card = s.kpiBatch([], ["net_revenue"], "INTL").values[0]?.value;
    expect(answer.more).toBe(0);
    const sum = answer.rows.reduce((a, r) => a + (r.values[0] ?? 0), 0);
    expect(sum).toBeCloseTo(card as number, 2);
    await expectSqlMatches(conn, answer);
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

  it("keeps a KPI whose name holds 'per', 'average' or 'value' rather than a column", () => {
    const kpi = (name: string) => (ctx.kpis.find((k) => k.name === name) as { id: string }).id;
    expect(read("average invoice value by region").ask).toEqual({
      measures: [{ kind: "kpi", id: kpi("Average invoice value") }],
      by: { kind: "column", column: "Region" },
    });
    expect(read("revenue per customer by segment").ask).toEqual({
      measures: [{ kind: "kpi", id: kpi("Revenue per customer") }],
      by: { kind: "column", column: "Customer Segment" },
    });
  });

  it("reads a value named in the question as a filter, with the column named beside it", () => {
    const r = read("What is the revenue in the South region?");
    expect(r.unmatched).toEqual([]);
    expect(r.ask.by).toEqual({ kind: "none" });
    expect(r.ask.filters).toEqual([{ kind: "in", column: "Region", values: ["South"] }]);
    expect(read("revenue for enterprise customers by region").ask).toMatchObject({
      by: { kind: "column", column: "Region" },
      filters: [{ kind: "in", column: "Customer Segment", values: ["Enterprise"] }],
    });
    expect(read("revenue for enterprise customers by region").unmatched).toEqual([]);
  });
});

/** The statements of an answer's SQL, without comment lines. */
const sqlStatements = (sql: string) =>
  sql
    .split(/;\s*(?:\n|$)/)
    .map((x) =>
      x
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);

describe("questions that name values, periods and statuses (e-commerce)", async () => {
  const { s, ctx, conn, ask } = await setup("ecommerce");
  const date = ctx.dateColumn as string;
  const actx = ctx as AskContext;
  const card = (filters: Filter[], id = "net_revenue") =>
    s.kpiBatch(filters, [id], "INTL").values[0]?.value ?? null;
  const year2026: Filter = {
    kind: "dateRange",
    column: date,
    from: Date.UTC(2026, 0, 1),
    to: Date.UTC(2027, 0, 1) - 1,
  };

  it("answers for the value or period named, never over every row", async () => {
    const cases: Array<[string, Filter[]]> = [
      [
        "What is the net revenue in Maharashtra?",
        [{ kind: "in", column: "Customer State", values: ["Maharashtra"] }],
      ],
      ["What is net revenue for Apparel?", [{ kind: "in", column: "Category", values: ["Apparel"] }]],
      ["Net revenue where channel is Website", [{ kind: "in", column: "Channel", values: ["Website"] }]],
      ["net revenue in 2026", [year2026]],
    ];
    for (const [q, filters] of cases) {
      const { reading, answer } = ask(q);
      expect(reading.unmatched, q).toEqual([]);
      expect(reading.ask.measures, q).toEqual([{ kind: "kpi", id: "net_revenue" }]);
      expect(reading.ask.filters, q).toEqual(filters);
      expect(answer.filters, q).toEqual(filters);
      // The dashboard's Net revenue under the same filter, and the SQL agrees in DuckDB.
      expect(answer.rows[0]?.values[0] as number, q).toBeCloseTo(card(filters) as number, 2);
      expect(answer.rows[0]?.values[0] as number, q).toBeLessThan(card([]) as number);
      await expectSqlMatches(conn, answer);
    }
  });

  it("counts the status named", async () => {
    const { reading, answer } = ask("How many orders were cancelled?");
    expect(reading.ask).toEqual({
      measures: [{ kind: "kpi", id: "orders" }],
      by: { kind: "none" },
      filters: [{ kind: "in", column: "Order Status", values: ["Cancelled"] }],
    });
    expect(reading.notes).toEqual([]);
    expect(answer.rows[0]?.values[0]).toBe(card(reading.ask.filters ?? [], "orders"));
    await expectSqlMatches(conn, answer);
  });

  it("ranks within the period named", async () => {
    const { reading, answer } = ask("Which state has the highest net revenue in September 2026?");
    expect(reading.ask).toEqual({
      measures: [{ kind: "kpi", id: "net_revenue" }],
      by: { kind: "column", column: "Customer State" },
      filters: [
        { kind: "dateRange", column: date, from: Date.UTC(2026, 8, 1), to: Date.UTC(2026, 9, 1) - 1 },
      ],
    });
    await expectSqlMatches(conn, answer);
  });

  it("uses the question's period instead of the dashboard's, and says so", () => {
    const last12m: Filter = {
      kind: "dateRange",
      column: date,
      from: Date.UTC(2025, 9, 1),
      to: Date.UTC(2026, 9, 1) - 1,
    };
    const reading = readQuestion("net revenue in 2026", actx);
    const a = s.answerQuestion(
      {
        id: "p",
        question: "net revenue in 2026",
        understood: "",
        notes: [],
        ask: reading.ask,
        order: "desc",
        filters: [last12m],
      },
      "INTL",
    );
    expect(a.filters).toEqual([year2026]);
    expect(a.notes.join(" ")).toMatch(/names its own Order Date, used instead of the dashboard's/);
  });

  it("names the words it can't place instead of answering another question", () => {
    expect(readQuestion("Total net revenue by warehouse", actx).unmatched).toEqual(["warehouse"]);
    expect(readQuestion("asdkjh qwe zzz", actx).unmatched).toEqual(["asdkjh qwe zzz"]);
    expect(readQuestion("net revenue in 2024 and 2026", actx).unmatched).toEqual(["2026"]);
    const board = readQuestion(
      "I would like to understand, for the purposes of the quarterly board meeting that our chief executive officer is going to chair next Tuesday afternoon in the main conference room, which of the many different sales channels that we currently operate across the country has been generating the highest total net revenue for the business over the whole of the period covered by this particular file",
      actx,
    );
    expect(board.unmatched.length).toBeGreaterThan(0);
  });

  it("reads date parts typed in full, and the other suggested forms", () => {
    const by = (q: string) => readQuestion(q, actx).ask.by;
    expect(by("orders by day of the week")).toEqual({ kind: "part", column: date, part: "dow" });
    expect(by("net revenue by hour of the day")).toEqual({ kind: "part", column: date, part: "hour" });
    expect(by("net revenue by month of year")).toEqual({ kind: "part", column: date, part: "month" });
    expect(by("net revenue by day of month")).toEqual({ kind: "part", column: date, part: "dom" });
    expect(readQuestion("At what hour of the day is gross sales highest?", actx).ask).toEqual({
      measures: [{ kind: "kpi", id: "gross_sales" }],
      by: { kind: "part", column: date, part: "hour" },
    });
    expect(readQuestion("How do categories compare on discounts?", actx).ask).toEqual({
      measures: [{ kind: "kpi", id: "discounts" }],
      by: { kind: "column", column: "Category" },
    });
  });

  it("keeps a KPI named in the question", () => {
    expect(readQuestion("What is the average order value?", actx).ask).toEqual({
      measures: [{ kind: "kpi", id: "aov" }],
      by: { kind: "none" },
    });
    expect(readQuestion("How has net revenue changed month by month?", actx).ask).toEqual({
      measures: [{ kind: "kpi", id: "net_revenue" }],
      by: { kind: "time", column: date, grain: "month" },
    });
  });

  it("leaves an empty blank group out of the answer and of its SQL alike", async () => {
    for (const q of ["net revenue by courier", "Which courier has the lowest net revenue?"]) {
      const { answer } = ask(q);
      expect(
        answer.rows.some((r) => r.raw === null),
        q,
      ).toBe(false);
      expect(answer.sql, q).toMatch(/A blank Courier with no value is left out/);
      await expectSqlMatches(conn, answer);
    }
  });

  it("returns the answer's own groups when the first measure needs its own query", async () => {
    const { answer } = ask("repeat purchase rate and orders by state");
    expect(answer.measures.map((m) => m.id)).toEqual(["repeat_rate", "orders"]);
    const statements = sqlStatements(answer.sql);
    expect(statements).toHaveLength(1);
    const rows = (await conn.runAndReadAll(statements[0] as string)).getRowObjectsJson();
    expect(rows.map((r) => r["Customer State"])).toEqual(answer.rows.map((r) => r.label));
    await expectSqlMatches(conn, answer);
  });

  it("writes its answer the way an analyst would", () => {
    expect(ask("orders by day of the week").answer.headline).toMatch(
      /^Orders are highest on [A-Z][a-z]+day \([\d,]+\) and lowest on [A-Z][a-z]+day \([\d,]+\)\.$/,
    );
    const trend = ask("How has net revenue changed month by month?").answer.headline;
    expect(trend).toMatch(/^Net revenue: (up|down|flat)/);
    expect(trend).not.toMatch(/latest period/);
    // Money in a sentence is compact; a blank group never leads.
    expect(ask("What is the net revenue in Maharashtra?").answer.headline).toMatch(
      /^Net revenue: ₹[\d.]+[KMB]$/,
    );
    expect(ask("orders by return reason").answer.headline).not.toMatch(/^\(blank\)/);
    // Zero throughout: no group "has the highest" of nothing.
    expect(ask("net revenue by state for cancelled orders").answer.headline).toBe(
      "Net revenue is ₹0 for every customer state in these rows.",
    );
    // A split is left out of an answer, so "Read as" doesn't claim it.
    const split = readQuestion("net revenue by state split by channel", actx);
    expect(split.understood).toBe("Net revenue by Customer State");
    expect(split.notes.join(" ")).toMatch(/split by Channel is left out/);
  });

  it("never reads a value of a hidden column", () => {
    const h = new Session();
    h.ingestSample("ecommerce");
    const hctx = h.configure({
      domainId: "ecommerce",
      numberLocale: "INTL",
      currency: null,
      hiddenColumns: ["Channel"],
    });
    const r = readQuestion("Net revenue where channel is Website", hctx as AskContext);
    expect(r.ask.filters ?? []).toEqual([]);
    expect(r.unmatched.length).toBeGreaterThan(0);
  });
});

describe("typing a suggested question", () => {
  for (const sample of SAMPLES)
    it(`reads to the same request as clicking it, on ${sample.id}`, () => {
      const t = new Session();
      if (t.ingestSample(sample.id).status !== "ok") throw new Error(sample.id);
      const c = t.configure({ domainId: sample.domain, numberLocale: "INTL", currency: null }) as AskContext;
      const suggested = suggestQuestions(c);
      expect(suggested.length).toBeGreaterThan(3);
      for (const q of suggested) {
        const r = readQuestion(q.text, c);
        expect(r.unmatched, q.text).toEqual([]);
        expect(r.ask, q.text).toEqual(q.ask);
        expect(r.order, q.text).toBe(q.order);
      }
    });
});
