/**
 * The Analyse phase's own logic (version 50.4): the Questions step's thread
 * and follow-ups, its "Check this SQL on your data" comparison, and the
 * Insights step's tabs, ranks, impact bars and keyboard selection
 * (src/ui/workspace/analyse). Pure functions, so they are checked here
 * without a browser; the SQL check is also run against the real answers of
 * the e-commerce demo in native DuckDB, so moving it out of the component
 * kept it agreeing with the engine.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import {
  suggestQuestions,
  type AskContext,
  type ChartAsk,
  type SuggestedQuestion,
} from "@/engine/charts/ask";
import type { ExportContext } from "@/engine/export/context";
import type { Insight } from "@/engine/insights/insights";
import { Session, type QuestionAnswer } from "@/engine/session";
import {
  askKey,
  askedSoFar,
  focusAfterRemove,
  followUps,
  questionShape,
  threadOrder,
  type AskedQuestion,
} from "@/ui/workspace/analyse/thread";
import {
  checkVerdict,
  compareWithAnswer,
  engineKey,
  sqlStatements,
  type SqlResult,
} from "@/ui/workspace/analyse/sqlCheck";
import { impactPercent, kindTabs, moveSelection, rankedFeed } from "@/ui/workspace/analyse/feed";
import { close, loadIntoDuckDB } from "./helpers/duck";

const kpi = (id: string) => ({ kind: "kpi" as const, id });
const byChannel: ChartAsk = { measures: [kpi("revenue")], by: { kind: "column", column: "Channel" } };
const byMonth: ChartAsk = {
  measures: [kpi("revenue")],
  by: { kind: "time", column: "Date", grain: "month" },
};
const byWeekday: ChartAsk = { measures: [kpi("revenue")], by: { kind: "part", column: "Date", part: "dow" } };
const ordersByRegion: ChartAsk = { measures: [kpi("orders")], by: { kind: "column", column: "Region" } };
const totals: ChartAsk = { measures: [kpi("revenue"), kpi("orders")], by: { kind: "none" } };

const suggestions: SuggestedQuestion[] = [
  { text: "How has revenue changed month by month?", ask: byMonth, order: "desc" },
  { text: "Which channel has the highest revenue?", ask: byChannel, order: "desc" },
  { text: "How do regions compare on orders?", ask: ordersByRegion, order: "desc" },
  { text: "Which day of the week has the most revenue?", ask: byWeekday, order: "desc" },
  { text: "What are the overall revenue and orders?", ask: totals, order: "desc" },
];

const asked = (id: string, question: string, ask: ChartAsk, error?: string): AskedQuestion => ({
  id,
  question,
  ask,
  order: "desc",
  ...(error ? { error } : {}),
});

describe("the thread", () => {
  it("reads oldest first and leaves the store's newest-first list as it is", () => {
    const store = ["c", "b", "a"];
    expect(threadOrder(store)).toEqual(["a", "b", "c"]);
    expect(store).toEqual(["c", "b", "a"]);
  });

  it("keys a request by what it computes, so two phrasings count as one", () => {
    expect(askKey({ ...byChannel }, "desc")).toBe(askKey(byChannel, "desc"));
    expect(askKey(byChannel, "asc")).not.toBe(askKey(byChannel, "desc"));
    // Order only matters for a ranking.
    expect(askKey(byMonth, "asc")).toBe(askKey(byMonth, "desc"));
    expect(askKey({ ...byChannel, topN: 5 }, "desc")).not.toBe(askKey(byChannel, "desc"));
  });

  it("counts an answered question as asked, and one that couldn't be answered as not", () => {
    const so = askedSoFar([
      asked("q1", "Which channel?", byChannel),
      asked("q2", "revenue by planet", byMonth, "No"),
    ]);
    expect(so.texts.has("Which channel?")).toBe(true);
    expect(so.texts.has("revenue by planet")).toBe(false);
    expect(so.keys.has(askKey(byChannel, "desc"))).toBe(true);
  });

  it("moves focus to the exchange below a removed one, else above, else the box", () => {
    expect(focusAfterRemove(["a", "b", "c"], "b")).toBe("c");
    expect(focusAfterRemove(["a", "b", "c"], "c")).toBe("b");
    expect(focusAfterRemove(["a"], "a")).toBeNull();
    expect(focusAfterRemove(["a"], "x")).toBeNull();
  });

  it("names each suggestion's shape for its icon", () => {
    expect(questionShape(byMonth, "desc")).toBe("trend");
    expect(questionShape(byChannel, "desc")).toBe("ranking");
    expect(questionShape(byChannel, "asc")).toBe("lowest");
    expect(questionShape({ ...byChannel, topN: 10 }, "desc")).toBe("top");
    expect(questionShape(byWeekday, "desc")).toBe("weekday");
    expect(questionShape({ ...byWeekday, by: { kind: "part", column: "Date", part: "hour" } }, "desc")).toBe(
      "hour",
    );
    expect(questionShape({ ...byWeekday, by: { kind: "part", column: "Date", part: "month" } }, "desc")).toBe(
      "season",
    );
    expect(questionShape(totals, "desc")).toBe("total");
  });
});

describe("follow-up questions", () => {
  it("wait for the first answer", () => {
    expect(followUps(suggestions, [])).toEqual([]);
    expect(followUps(suggestions, [asked("q1", "revenue by planet", byMonth, "Not answered")])).toEqual([]);
  });

  it("leave out what was asked, in words or as the same request", () => {
    // The store's list is newest first.
    const out = followUps(suggestions, [
      asked("q2", "revenue per channel please", byChannel),
      asked("q1", "How has revenue changed month by month?", byMonth),
    ]);
    const texts = out.map((s) => s.text);
    expect(texts).not.toContain("How has revenue changed month by month?");
    expect(texts).not.toContain("Which channel has the highest revenue?");
  });

  it("lead with the latest answer's measure seen another way, and stop at three", () => {
    const out = followUps(suggestions, [asked("q1", "Which channel has the highest revenue?", byChannel)]);
    expect(out).toHaveLength(3);
    expect(out.map((s) => s.text)).toEqual([
      "How has revenue changed month by month?",
      "Which day of the week has the most revenue?",
      "What are the overall revenue and orders?",
    ]);
    expect(
      followUps(suggestions, [asked("q1", "Which channel has the highest revenue?", byChannel)], 2),
    ).toHaveLength(2);
  });
});

describe("checking an answer's SQL", () => {
  const answer = {
    ask: byChannel,
    keyLabel: "Channel",
    measures: [{ id: "revenue", label: "Revenue", format: "currency" as const }],
    rows: [
      { label: "Web", raw: "Web", values: [300] },
      { label: "App", raw: "App", values: [200] },
      { label: "(blank)", raw: null, values: [0] },
    ],
  };

  it("splits the SQL into statements without their comment lines", () => {
    expect(sqlStatements("-- Revenue\nSELECT 1;\n-- Orders\nSELECT 2;\n")).toEqual(["SELECT 1", "SELECT 2"]);
    expect(sqlStatements("SELECT 1")).toEqual(["SELECT 1"]);
  });

  it("reads DuckDB's group values the way the engine keys them", () => {
    const month = { ask: byMonth };
    const ms = Date.UTC(2026, 0, 1);
    expect(engineKey("2026-01-01", month)).toBe(String(ms));
    expect(engineKey(ms / 86_400_000, month)).toBe(String(ms));
    expect(engineKey(ms, month)).toBe(String(ms));
    expect(engineKey(ms * 1000, month)).toBe(String(ms));
    expect(engineKey(1, { ask: byWeekday })).toBe("0");
    expect(
      engineKey("13", { ask: { ...byWeekday, by: { kind: "part", column: "Date", part: "hour" } } }),
    ).toBe("13");
    expect(engineKey("Web", answer)).toBe("Web");
    expect(engineKey(null, answer)).toBe("null");
  });

  it("agrees when every value matches, an empty blank group aside", () => {
    const res: SqlResult = {
      columns: ["Channel", "Revenue"],
      rows: [
        ["Web", 300],
        ["App", 200.0000001],
      ],
    };
    const r = compareWithAnswer(answer, [res]);
    expect(r).toEqual({ compared: 2, problems: [] });
    expect(checkVerdict(r)).toEqual({
      status: "ok",
      message: "DuckDB returned the same answer (2 values checked).",
    });
  });

  it("names the measure and the group that differ, and a group the SQL left out", () => {
    const res: SqlResult = { columns: ["Channel", "Revenue"], rows: [["Web", 310]] };
    const r = compareWithAnswer(answer, [res]);
    expect(r.problems).toEqual(["Revenue for Web", "group App"]);
    expect(checkVerdict(r)).toEqual({
      status: "differs",
      message: "DuckDB differs on Revenue for Web, group App.",
    });
  });

  it("checks one overall row against the answer's only row", () => {
    const overall = {
      ...answer,
      ask: totals,
      keyLabel: null,
      rows: [{ label: "All", raw: null, values: [500] }],
    };
    expect(compareWithAnswer(overall, [{ columns: ["Revenue"], rows: [[500]] }])).toEqual({
      compared: 1,
      problems: [],
    });
    expect(compareWithAnswer(overall, [{ columns: ["Revenue"], rows: [[499]] }]).problems).toEqual([
      "Revenue for all rows",
    ]);
  });
});

describe("checking the demo's answers in DuckDB", async () => {
  const connections: DuckDBConnection[] = [];
  afterAll(() => connections.forEach(close));
  const s = new Session();
  const load = s.ingestSample("ecommerce");
  if (load.status !== "ok") throw new Error(load.status);
  const top = load.detection.candidates[0];
  if (!top) throw new Error("not detected");
  const ctx = s.configure({ domainId: top.domainId, numberLocale: "INTL", currency: null });
  const ec = (s as unknown as { exportContext(): ExportContext }).exportContext();
  const conn = await loadIntoDuckDB(ec.ds, ec.names.table.toLowerCase(), ec.names.columns);
  connections.push(conn);

  it("finds every suggested question's SQL agreeing with its answer", async () => {
    const asks = suggestQuestions(ctx as AskContext);
    expect(asks.length).toBeGreaterThan(3);
    let n = 0;
    for (const q of asks) {
      const a: QuestionAnswer = s.answerQuestion(
        {
          id: `q${++n}`,
          question: q.text,
          understood: q.text,
          notes: [],
          ask: q.ask,
          order: q.order,
          filters: [],
        },
        "INTL",
      );
      if (!a.sql) continue;
      const results: SqlResult[] = [];
      for (const stmt of sqlStatements(a.sql)) {
        const reader = await conn.runAndReadAll(stmt);
        const rows = reader.getRowObjectsJson() as Array<Record<string, string | number | null>>;
        const columns = reader.columnNames();
        results.push({ columns, rows: rows.map((r) => columns.map((c) => r[c] ?? null)) });
      }
      const r = compareWithAnswer(a, results);
      expect(r.problems, q.text).toEqual([]);
      expect(r.compared, q.text).toBeGreaterThan(0);
    }
  });
});

describe("the insights feed", () => {
  const insight = (
    id: string,
    kind: Insight["kind"],
    impact = 50,
  ): Pick<Insight, "id" | "kind" | "impact"> => ({
    id,
    kind,
    impact,
  });
  const ranked = [
    insight("a", "trend", 90),
    insight("b", "segment", 70),
    insight("c", "trend", 60),
    insight("d", "caveat", 40),
  ];

  it("offers All and each kind found, in the order of its best-ranked insight, with counts", () => {
    expect(kindTabs(ranked)).toEqual([
      { kind: "all", count: 4 },
      { kind: "trend", count: 2 },
      { kind: "segment", count: 1 },
      { kind: "caveat", count: 1 },
    ]);
    expect(kindTabs([])).toEqual([{ kind: "all", count: 0 }]);
  });

  it("keeps each insight's overall rank when the feed shows one kind", () => {
    expect(rankedFeed(ranked, "all").map((f) => [f.insight.id, f.rank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);
    expect(rankedFeed(ranked, "trend").map((f) => [f.insight.id, f.rank])).toEqual([
      ["a", 1],
      ["c", 3],
    ]);
  });

  it("draws the engine's own impact score, clamped for drawing only", () => {
    expect(impactPercent(72.4)).toBe(72.4);
    expect(impactPercent(130)).toBe(100);
    expect(impactPercent(-3)).toBe(0);
    expect(impactPercent(Number.NaN)).toBe(0);
  });

  it("moves the selection with the arrow keys, stopping at the ends, and jumps with Home and End", () => {
    const ids = ["a", "b", "c"];
    expect(moveSelection(ids, "a", "ArrowDown")).toBe("b");
    expect(moveSelection(ids, "c", "ArrowDown")).toBe("c");
    expect(moveSelection(ids, "b", "ArrowUp")).toBe("a");
    expect(moveSelection(ids, "a", "ArrowUp")).toBe("a");
    expect(moveSelection(ids, null, "ArrowDown")).toBe("a");
    expect(moveSelection(ids, "b", "Home")).toBe("a");
    expect(moveSelection(ids, "a", "End")).toBe("c");
    expect(moveSelection(ids, "a", "Enter")).toBeNull();
    expect(moveSelection([], "a", "ArrowDown")).toBeNull();
  });
});
