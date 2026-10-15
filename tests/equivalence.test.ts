/**
 * Evaluator vs SQL equivalence on small hand-built datasets, one block per
 * reviewed bug. Each case evaluates expressions with the TypeScript evaluator
 * and runs the compiled SQL in DuckDB, overall and per period, with a strict
 * comparison: a blank (NaN / NULL) only equals a blank, so a period where SQL
 * returns NULL and the evaluator 0 fails here (tests/registry.test.ts
 * tolerates that pair). Covers blank flags under `not`, the one-row overall
 * base, empty leaves in trended queries, calendar-day differences across
 * midnight, exact `in` matching, per-entity min/max over 200k entities,
 * newEntities in an "Others" bucket and by a date column, and the DAX 7-day
 * moving average.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import type {
  BooleanColumn,
  Column,
  Dataset,
  DateColumn,
  NumberColumn,
  StringColumn,
} from "@/engine/core/types";
import { endOfDay, utc } from "@/engine/core/dates";
import type { Mapping } from "@/engine/detect/mapping";
import { cleanColumnNames, makeResolver, makeSqlContext, type CompileNames } from "@/engine/kpi/context";
import type { KpiResolutionMap } from "@/engine/kpi/resolve";
import { EMPTY_SCOPE, evaluateScalar, type Resolver } from "@/engine/query/evaluate";
import type { Expr, RowExpr } from "@/engine/query/expr";
import type { Filter } from "@/engine/query/filter";
import { runQuery, type AggQuery } from "@/engine/query/run";
import { kpiQuery, type PeriodSpec, type SqlContext } from "@/engine/compile/sql";
import { timeIntelligence } from "@/engine/compile/dax";
import { close, loadIntoDuckDB } from "./helpers/duck";

// ---------------------------------------------------------------- dataset builders

function strCol(name: string, values: ReadonlyArray<string | null>): StringColumn {
  const dict: string[] = [];
  const index = new Map<string, number>();
  const codes = Int32Array.from(values, (v) => {
    if (v === null) return -1;
    let c = index.get(v);
    if (c === undefined) {
      c = dict.length;
      index.set(v, c);
      dict.push(v);
    }
    return c;
  });
  return { kind: "string", name, codes, dict };
}

const numCol = (name: string, values: ReadonlyArray<number | null>): NumberColumn => ({
  kind: "number",
  name,
  values: Float64Array.from(values, (v) => (v === null ? NaN : v)),
  format: { integer: false, decimals: 2 },
});

/** `hasTime` false loads as DATE in DuckDB, true as TIMESTAMP. */
const dateCol = (name: string, values: ReadonlyArray<number | null>, hasTime = true): DateColumn => ({
  kind: "date",
  name,
  values: Float64Array.from(values, (v) => (v === null ? NaN : v)),
  hasTime,
  format: hasTime ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD",
});

const boolCol = (name: string, values: ReadonlyArray<boolean | null>): BooleanColumn => ({
  kind: "boolean",
  name,
  values: Int8Array.from(values, (v) => (v === null ? -1 : v ? 1 : 0)),
  trueLabel: "TRUE",
  falseLabel: "FALSE",
});

const lengthOf = (c: Column): number => (c.kind === "string" ? c.codes.length : c.values.length);

function dataset(name: string, columns: Column[]): Dataset {
  const rowCount = columns[0] ? lengthOf(columns[0]) : 0;
  for (const c of columns)
    if (lengthOf(c) !== rowCount)
      throw new Error(`Column "${c.name}" has ${lengthOf(c)} rows, expected ${rowCount}.`);
  return {
    id: `eq_${name}`,
    name,
    rowCount,
    columns,
    source: { fileName: `${name}.csv`, kind: "derived", sizeBytes: 0, isDemo: false },
  };
}

// ---------------------------------------------------------------- engine and DuckDB

interface Harness {
  ds: Dataset;
  resolver: Resolver;
  sql: SqlContext;
  conn: DuckDBConnection;
}

const connections: DuckDBConnection[] = [];
afterAll(() => connections.forEach(close));

/** Evaluator and SQL contexts over `ds` (fields as "col:<name>"), plus the same rows loaded into DuckDB as "data". */
async function harness(ds: Dataset, classes: Record<string, string[]> = {}): Promise<Harness> {
  const mapping: Mapping = { fields: {}, scores: {}, classes };
  const res: KpiResolutionMap = new Map();
  const names: CompileNames = {
    table: "data",
    columns: cleanColumnNames(ds.columns.map((c) => c.name)),
    measures: new Map(),
  };
  const conn = await loadIntoDuckDB(ds, "data", names.columns);
  connections.push(conn);
  return { ds, resolver: makeResolver(ds, mapping, res), sql: makeSqlContext(ds, mapping, res, names), conn };
}

/** One shared harness per dataset, created on first use, so each block loads DuckDB once. */
function sharedHarness(ds: Dataset, classes?: Record<string, string[]>): () => Promise<Harness> {
  let h: Promise<Harness> | null = null;
  return () => (h ??= harness(ds, classes));
}

type Row = Record<string, unknown>;

async function rowsOf(conn: DuckDBConnection, sql: string): Promise<Row[]> {
  return (await conn.runAndReadAll(sql)).getRowObjectsJson() as Row[];
}

const valueOf = (row: Row | undefined): number =>
  row?.value === null || row?.value === undefined ? NaN : Number(row.value);

/** Bucket start (wall-clock ms) of a DuckDB period such as "2024-03-01 00:00:00". */
const parsePeriod = (v: unknown): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
};

/** Strict equality for measure values: a blank only equals a blank. */
function same(a: number, b: number): boolean {
  if (a !== a || b !== b) return a !== a && b !== b;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

const allRows = (ds: Dataset): Int32Array => Int32Array.from({ length: ds.rowCount }, (_, i) => i);

/** Engine vs SQL over the whole table: the query must return exactly one row, holding the engine's value. */
async function expectOverall(h: Harness, label: string, expr: Expr): Promise<number> {
  const engine = evaluateScalar(expr, h.resolver, EMPTY_SCOPE, allRows(h.ds));
  const sql = kpiQuery(expr, h.sql);
  const rows = await rowsOf(h.conn, sql);
  expect(rows.length, `${label}: rows returned by\n${sql}`).toBe(1);
  const duck = valueOf(rows[0]);
  expect(same(engine, duck), `${label}: engine ${engine} vs SQL ${duck}\n${sql}`).toBe(true);
  return engine;
}

/**
 * Engine (runQuery by time bucket) vs SQL (kpiQuery by period) for every
 * period both have; returns the engine's values by bucket start.
 */
async function expectTrended(
  h: Harness,
  label: string,
  expr: Expr,
  dateColumn: string,
  grain: PeriodSpec["grain"] = "month",
): Promise<Map<number, number>> {
  const sql = kpiQuery(expr, h.sql, { dateCol: h.sql.col(`col:${dateColumn}`), grain });
  const rows = await rowsOf(h.conn, sql);
  const q = runQuery(h.ds, h.resolver, {
    filters: [],
    groupBy: [{ kind: "time", column: dateColumn, grain }],
    measures: [{ id: label, expr }],
    dateColumn,
  });
  const engine = new Map(q.groups.map((g) => [g.labels[0]?.raw as number, g.values[0] as number]));
  let compared = 0;
  for (const row of rows) {
    const p = parsePeriod(row.period);
    if (!engine.has(p)) continue;
    compared++;
    const e = engine.get(p) as number;
    const s = valueOf(row);
    expect(same(e, s), `${label} @ ${String(row.period)}: engine ${e} vs SQL ${s}\n${sql}`).toBe(true);
  }
  expect(compared, `${label}: periods compared`).toBeGreaterThan(0);
  return engine;
}

const FEB = utc(2024, 2, 1);
const MAR = utc(2024, 3, 1);
const sumOf = (column: string): Expr => ({ agg: "sum", of: { field: `col:${column}` } });

// ---------------------------------------------------------------- 1. not

describe("`not` over blank flags", () => {
  // Rows 2 and 4 have blank flags. The evaluator keeps them under `not`
  // (two-valued), so SQL must as well instead of dropping NOT (NULL).
  const ds = dataset("flags", [
    dateCol("order_date", [
      utc(2024, 1, 5, 9),
      utc(2024, 1, 6, 10),
      utc(2024, 1, 7, 11),
      utc(2024, 2, 3, 12),
      utc(2024, 2, 4, 13),
      utc(2024, 2, 5, 14),
    ]),
    strCol("account", ["A", "B", "C", "A", "D", "E"]),
    numCol("amount", [10, 20, 30, 40, 50, 60]),
    boolCol("returned", [true, false, null, true, null, false]),
    strCol("churned", ["yes", "no", null, "Yes", null, "n"]),
  ]);
  const cases: Array<[string, Expr, number]> = [
    [
      "sum, boolean flag",
      { calc: sumOf("amount"), where: { not: { field: "col:returned", isTrue: true } } },
      20 + 30 + 50 + 60,
    ],
    ["count, text flag", { agg: "count", where: { not: { field: "col:churned", isTrue: true } } }, 4],
    [
      "distinct count, not inside and",
      {
        agg: "countDistinct",
        of: "col:account",
        where: {
          and: [
            { field: "col:amount", cmp: "gt", value: 0 },
            { not: { field: "col:churned", isTrue: true } },
          ],
        },
      },
      4,
    ],
    [
      "nested not",
      {
        agg: "count",
        where: {
          not: {
            or: [{ field: "col:returned", isFalse: true }, { not: { field: "col:churned", isTrue: true } }],
          },
        },
      },
      2,
    ],
    [
      "per-entity leaf under not",
      {
        calc: { per: "col:account", inner: sumOf("amount"), reduce: "sum" },
        where: { not: { field: "col:returned", isTrue: true } },
      },
      20 + 30 + 50 + 60,
    ],
  ];

  const get = sharedHarness(ds);

  it.each(cases)("%s: SQL keeps blank rows, overall and per month", async (label, expr, expected) => {
    const h = await get();
    expect(await expectOverall(h, label, expr)).toBe(expected);
    await expectTrended(h, label, expr, "order_date");
  });
});

// ---------------------------------------------------------------- 2. one-row overall base

describe("overall query with only per-entity, first-date or closing-balance leaves", () => {
  const build = (name: string, n: number) =>
    dataset(name, [
      dateCol(
        "order_date",
        Array.from({ length: n }, (_, i) => utc(2024, 1 + (i % 3), 1 + i, 8 + (i % 10))),
      ),
      strCol(
        "customer",
        Array.from({ length: n }, (_, i) => `C${i % 4}`),
      ),
      numCol(
        "amount",
        Array.from({ length: n }, (_, i) => 5 * (i + 1)),
      ),
    ]);
  const perSum: Expr = { per: "col:customer", inner: sumOf("amount"), reduce: "sum" };
  const exprs: Array<[string, Expr]> = [
    ["per avg", { per: "col:customer", inner: sumOf("amount"), reduce: "avg" }],
    ["per count", { per: "col:customer", inner: { agg: "count" }, reduce: "count" }],
    ["newEntities", { newEntities: "col:customer", date: "col:order_date" }],
    ["atLatest sum", { atLatest: "col:order_date", expr: sumOf("amount") }],
    [
      "per / newEntities",
      { op: "div", args: [perSum, { newEntities: "col:customer", date: "col:order_date" }] },
    ],
  ];

  const populated = sharedHarness(build("populated", 12));
  const empty = sharedHarness(build("empty", 0));

  it.each(exprs)("%s: exactly one row on a populated table", async (label, expr) => {
    await expectOverall(await populated(), label, expr);
  });

  it.each(exprs)("%s: exactly one row on an empty table", async (label, expr) => {
    await expectOverall(await empty(), label, expr);
  });
});

// ---------------------------------------------------------------- 3. empty leaves when trended

describe("trended query with a month where no entity or row qualifies", () => {
  // February has rows, but no customer, no snapshot date and no "open" status,
  // so every leaf CTE lacks a February row and the LEFT JOIN gives NULL.
  const ds = dataset("gaps", [
    dateCol("order_date", [
      utc(2024, 1, 10, 9),
      utc(2024, 1, 20, 10),
      utc(2024, 2, 10, 11),
      utc(2024, 2, 20, 12),
      utc(2024, 3, 10, 13),
      utc(2024, 3, 20, 14),
    ]),
    strCol("customer", ["A", "B", null, null, "A", "C"]),
    numCol("amount", [10, 20, 30, 40, 50, 60]),
    dateCol(
      "snapshot",
      [utc(2024, 1, 31), utc(2024, 1, 31), null, null, utc(2024, 3, 31), utc(2024, 3, 31)],
      false,
    ),
    strCol("status", ["open", "closed", "closed", "closed", "open", "open"]),
  ]);
  const perSum: Expr = { per: "col:customer", inner: sumOf("amount"), reduce: "sum" };
  // [label, expression, February value in the evaluator (NaN = blank)]
  const cases: Array<[string, Expr, number]> = [
    ["per sum", perSum, 0],
    ["per count", { per: "col:customer", inner: { agg: "count" }, reduce: "count" }, 0],
    [
      "per count with having",
      {
        per: "col:customer",
        inner: { agg: "count" },
        reduce: "count",
        having: { expr: sumOf("amount"), cmp: "gt", value: 15 },
      },
      0,
    ],
    ["per avg stays blank", { per: "col:customer", inner: sumOf("amount"), reduce: "avg" }, NaN],
    ["atLatest sum", { atLatest: "col:snapshot", expr: sumOf("amount") }, 0],
    [
      "atLatest distinct count",
      { atLatest: "col:snapshot", expr: { agg: "countDistinct", of: "col:customer" } },
      0,
    ],
    [
      "atLatest avg stays blank",
      { atLatest: "col:snapshot", expr: { agg: "avg", of: { field: "col:amount" } } },
      NaN,
    ],
    [
      "per count under calc",
      {
        calc: { per: "col:customer", inner: { agg: "count" }, reduce: "count" },
        where: { field: "col:status", in: ["open"] },
      },
      0,
    ],
    ["sum + per sum", { op: "add", args: [sumOf("amount"), perSum] }, 70],
    ["per sum / count", { op: "div", args: [perSum, { agg: "count" }] }, 0],
  ];

  const get = sharedHarness(ds);

  it.each(cases)("%s: SQL gives the evaluator's empty value", async (label, expr, feb) => {
    const h = await get();
    const engine = await expectTrended(h, label, expr, "order_date");
    expect(same(engine.get(FEB) as number, feb), `${label}: February is ${engine.get(FEB)}`).toBe(true);
    await expectOverall(h, label, expr);
  });
});

// ---------------------------------------------------------------- 4. day differences

describe("daysBetween and spanDays across midnight", () => {
  const ds = dataset("days", [
    dateCol("start_at", [
      utc(2024, 1, 1, 23, 30),
      utc(2024, 1, 2, 0, 30),
      utc(2024, 1, 5, 12),
      utc(2024, 2, 1, 23, 59),
      null,
      utc(2024, 2, 10, 0, 1),
    ]),
    dateCol("end_at", [
      utc(2024, 1, 2, 0, 30),
      utc(2024, 1, 1, 23, 30),
      utc(2024, 1, 5, 18),
      utc(2024, 2, 3, 0, 1),
      utc(2024, 2, 5, 10),
      utc(2024, 2, 9, 23, 59),
    ]),
    dateCol(
      "start_day",
      [utc(2024, 1, 1), utc(2024, 1, 2), utc(2024, 1, 5), utc(2024, 2, 1), null, utc(2024, 2, 10)],
      false,
    ),
    strCol("leg", ["a", "a", "b", "b", "c", "c"]),
  ]);
  const gap: RowExpr = { daysBetween: ["col:start_at", "col:end_at"] };
  // Calendar days per row: 1 (an hour, across midnight), -1, 0, 2 (25 hours), blank, -1 (2 minutes, backwards).
  const cases: Array<[string, Expr, number]> = [
    ["sum", { agg: "sum", of: gap }, 1],
    ["avg", { agg: "avg", of: gap }, 0.2],
    ["min", { agg: "min", of: gap }, -1],
    ["max", { agg: "max", of: gap }, 2],
    ["median", { agg: "median", of: gap }, 0],
    ["DATE minus TIMESTAMP", { agg: "sum", of: { daysBetween: ["col:start_day", "col:end_at"] } }, 1],
    ["spanDays", { agg: "spanDays", of: "col:start_at" }, 40],
    [
      "spanDays over one hour across midnight",
      { agg: "spanDays", of: "col:start_at", where: { field: "col:leg", in: ["a"] } },
      1,
    ],
    ["spanDays of a DATE column", { agg: "spanDays", of: "col:start_day" }, 40],
  ];
  const get = sharedHarness(ds);

  it.each(cases)("%s: counts calendar days with portable date arithmetic", async (label, expr, expected) => {
    const h = await get();
    const sql = kpiQuery(expr, h.sql);
    // PostgreSQL has no DATE_DIFF; date subtraction works in DuckDB and PostgreSQL.
    expect(sql).not.toMatch(/DATE_DIFF/i);
    expect(sql).toMatch(/CAST\(.+ AS DATE\) - CAST\(.+ AS DATE\)/);
    expect(same(await expectOverall(h, label, expr), expected)).toBe(true);
    await expectTrended(h, label, expr, "start_at");
  });
});

// ---------------------------------------------------------------- 5. in / class

describe("`in` and value classes with case variants in the data", () => {
  const ds = dataset("status", [
    dateCol("order_date", [
      utc(2024, 1, 3),
      utc(2024, 1, 4),
      utc(2024, 1, 5),
      utc(2024, 2, 6),
      utc(2024, 2, 7),
      utc(2024, 2, 8),
    ]),
    strCol("status", ["Delivered", "delivered", " Delivered", "DELIVERED ", "Returned", null]),
    numCol("amount", [1, 2, 4, 8, 16, 32]),
    boolCol("paid", [true, false, true, null, false, true]),
  ]);
  const classes = { "col:status.delivered": ["Delivered", "delivered"] };
  const cases: Array<[string, Expr, number]> = [
    ["in, one spelling", { agg: "count", where: { field: "col:status", in: ["Delivered"] } }, 1],
    ["in, leading space kept", { agg: "count", where: { field: "col:status", in: [" Delivered"] } }, 1],
    [
      "in, two values",
      {
        agg: "sum",
        of: { field: "col:amount" },
        where: { field: "col:status", in: ["delivered", "Returned"] },
      },
      2 + 16,
    ],
    [
      "class",
      { agg: "sum", of: { field: "col:amount" }, where: { field: "col:status", class: "delivered" } },
      1 + 2,
    ],
    [
      "notClass keeps other spellings and blanks",
      { agg: "count", where: { field: "col:status", notClass: "delivered" } },
      4,
    ],
    // Booleans compare as SQL casts the literal: "TRUE" and "true" both mean true.
    ["boolean in TRUE", { agg: "count", where: { field: "col:paid", in: ["TRUE"] } }, 3],
    ["boolean in true", { agg: "count", where: { field: "col:paid", in: ["true"] } }, 3],
  ];

  const get = sharedHarness(ds, classes);

  it.each(cases)("%s: evaluator matches exactly, like SQL IN", async (label, expr, expected) => {
    const h = await get();
    expect(await expectOverall(h, label, expr)).toBe(expected);
    await expectTrended(h, label, expr, "order_date");
  });
});

// ---------------------------------------------------------------- 6. many entities

describe("per-entity min and max over 200,000 entities in one group", () => {
  const n = 200_000;
  const amounts = Array.from({ length: n }, (_, i) => ((i * 7919) % 100_003) - 50_000);
  const ds = dataset("many", [
    numCol(
      "entity",
      Array.from({ length: n }, (_, i) => i),
    ),
    numCol("amount", amounts),
  ]);
  const get = sharedHarness(ds);

  it.each(["min", "max"] as const)("reduce %s does not overflow the call stack", async (reduce) => {
    const h = await get();
    const expr: Expr = { per: "col:entity", inner: sumOf("amount"), reduce };
    let expected = amounts[0] as number;
    for (const a of amounts) expected = reduce === "min" ? Math.min(expected, a) : Math.max(expected, a);
    expect(await expectOverall(h, reduce, expr)).toBe(expected);
  });
});

// ---------------------------------------------------------------- 7. run.ts: Others and date keys

describe("newEntities in grouped queries", () => {
  // March is the analysis period. Customers X and Q ordered before March in
  // channels that stay in the top two (A, B), then in folded channels C and
  // D in March: new to Others, though not new overall. Y ordered in C in
  // February, so it is not new to Others. E has one March row, below minRows.
  const rows: Array<[string, string, number]> = [
    ["A", "X", utc(2024, 1, 10, 10)],
    ["A", "R", utc(2024, 1, 20, 11)],
    ["C", "Y", utc(2024, 2, 10, 12)],
    ["B", "Q", utc(2024, 2, 20, 13)],
    ["A", "W", utc(2024, 3, 2, 9)],
    ["A", "W", utc(2024, 3, 3, 10)],
    ["A", "R", utc(2024, 3, 4, 11)],
    ["B", "S", utc(2024, 3, 2, 12)],
    ["B", "S", utc(2024, 3, 10, 13)],
    ["B", "T", utc(2024, 3, 11, 14)],
    ["C", "X", utc(2024, 3, 5, 15)],
    ["C", "P", utc(2024, 3, 6, 16)],
    ["D", "Y", utc(2024, 3, 7, 17)],
    ["D", "Q", utc(2024, 3, 8, 18)],
    ["E", "Z", utc(2024, 3, 9, 19)],
  ];
  const ds = dataset("channels", [
    strCol(
      "channel",
      rows.map((r) => r[0]),
    ),
    strCol(
      "customer",
      rows.map((r) => r[1]),
    ),
    dateCol(
      "order_date",
      rows.map((r) => r[2]),
    ),
  ]);
  const march: Filter = {
    kind: "dateRange",
    column: "order_date",
    from: MAR,
    to: endOfDay(utc(2024, 3, 31)),
  };
  const newCustomers: Expr = { newEntities: "col:customer", date: "col:order_date" };
  const measures: AggQuery["measures"] = [
    { id: "rows", expr: { agg: "count" } },
    { id: "new", expr: newCustomers },
    {
      id: "new_share",
      expr: { op: "div", args: [newCustomers, { agg: "countDistinct", of: "col:customer" }] },
    },
  ];

  const get = sharedHarness(ds);
  // Top two channels by March rows (A, B); C and D fold by rank, E (one row) by minRows.
  const byChannel = (h: Harness) => {
    const q = runQuery(ds, h.resolver, {
      filters: [march],
      groupBy: [{ kind: "column", column: "channel" }],
      measures,
      dateColumn: "order_date",
      topN: { n: 2, rankBy: 0, others: true, minRows: 2 },
    });
    return { q, byLabel: new Map(q.groups.map((g) => [g.labels[0]?.label, g])) };
  };

  it("evaluates Others with the folded channels' first-date context", async () => {
    const h = await get();
    const { byLabel } = byChannel(h);
    expect([...byLabel.keys()]).toEqual(["A", "B", "Others"]);
    expect(byLabel.get("A")?.values[1]).toBe(1); // W; R first ordered in A in January
    expect(byLabel.get("B")?.values[1]).toBe(2); // S, T

    // Others must equal the same measures over the folded channels as one selection.
    const merged = runQuery(ds, h.resolver, {
      filters: [march, { kind: "in", column: "channel", values: ["C", "D", "E"] }],
      groupBy: [],
      measures,
      dateColumn: "order_date",
    });
    expect(merged.totals).toEqual([5, 4, 0.8]); // X, P, Q, Z are new to C/D/E; Y is not
    const others = byLabel.get("Others");
    expect(others?.values).toEqual(merged.totals);

    // And SQL agrees: first dates within C, D and E, new customers in March.
    await h.conn.run(
      `CREATE TABLE others_t AS SELECT * FROM data WHERE ${h.sql.col("col:channel")} IN ('C', 'D', 'E')`,
    );
    const sql = kpiQuery(
      newCustomers,
      { ...h.sql, table: '"others_t"' },
      { dateCol: h.sql.col("col:order_date"), grain: "month" },
    );
    const marchRow = (await rowsOf(h.conn, sql)).find((r) => parsePeriod(r.period) === MAR);
    expect(valueOf(marchRow)).toBe(others?.values[1]);
  });

  it("counts groups set aside by minRows among those folded into Others", async () => {
    const { q, byLabel } = byChannel(await get());
    const others = byLabel.get("Others");
    expect(q.suppressed).toBe(1);
    expect(others?.rows).toBe(5);
    expect(others?.foldedGroups).toBe(3); // C, D and E
  });

  it("treats a column key on a date column as day buckets, not as a dimension", async () => {
    const h = await get();
    const query = (groupBy: AggQuery["groupBy"]) =>
      runQuery(ds, h.resolver, {
        filters: [march],
        groupBy,
        measures: [{ id: "new", expr: newCustomers }],
        dateColumn: "order_date",
      });
    const byColumn = query([{ kind: "column", column: "order_date" }]);
    const byDay = query([{ kind: "time", column: "order_date", grain: "day" }]);
    const values = (q: ReturnType<typeof query>) =>
      new Map(q.groups.map((g) => [g.labels[0]?.raw as number, g.values[0] as number]));
    const engine = values(byColumn);
    expect(engine).toEqual(values(byDay));
    // W first ordered on 2 March, so it is not new again on 3 March.
    expect(engine.get(utc(2024, 3, 3))).toBe(0);

    // SQL counts each customer on the day of its first-ever order.
    const sql = kpiQuery(newCustomers, h.sql, { dateCol: h.sql.col("col:order_date"), grain: "day" });
    let compared = 0;
    for (const row of await rowsOf(h.conn, sql)) {
      const p = parsePeriod(row.period);
      if (!engine.has(p)) continue;
      compared++;
      expect(valueOf(row), `new customers on ${String(row.period)}`).toBe(engine.get(p));
    }
    expect(compared).toBe(engine.size);

    // Others over day buckets is one merged period from its earliest bucket:
    // here that equals the sum of the folded days' new customers (T on 11 March).
    const top = runQuery(ds, h.resolver, {
      filters: [march],
      groupBy: [{ kind: "column", column: "order_date" }],
      measures: [{ id: "new", expr: newCustomers }],
      dateColumn: "order_date",
      topN: { n: 3, rankBy: 0, others: true },
    });
    const kept = new Set(top.groups.filter((g) => !g.isOthers).map((g) => g.labels[0]?.raw as number));
    const foldedSum = [...engine].filter(([day]) => !kept.has(day)).reduce((s, [, v]) => s + v, 0);
    const othersGroup = top.groups.find((g) => g.isOthers);
    expect(othersGroup?.values[0]).toBe(foldedSum);
    expect(foldedSum).toBe(1);
  });
});

// ---------------------------------------------------------------- 8. DAX moving average

describe("DAX 7-day moving average", () => {
  it("divides the trailing 7-day total by 7 rather than averaging the days that have data", () => {
    const ma = timeIntelligence("Sales", true, "'Date'[Date]").find((t) => t.suffix === "7D Moving Avg");
    expect(ma?.expression).not.toContain("AVERAGEX");
    expect(ma?.expression.replace(/\s+/g, " ")).toBe(
      "DIVIDE ( CALCULATE ( [Sales], DATESINPERIOD ( 'Date'[Date], MAX ( 'Date'[Date] ), -7, DAY ) ), 7 )",
    );
    // Non-additive measures get no moving average at all.
    expect(timeIntelligence("Margin", false, "'Date'[Date]").some((t) => t.suffix === "7D Moving Avg")).toBe(
      false,
    );
  });
});
