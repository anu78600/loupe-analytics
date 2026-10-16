/**
 * SQL for a business question (step 5): "average customer rating by city",
 * "total revenue and gross profit by month", "orders by weekday". The answer
 * on screen is computed by the engine; this writes the query that returns the
 * same rows on DuckDB or PostgreSQL, against the table of the SQL export.
 *
 * Shape: one SELECT grouping by the question's key (a category column, a
 * DATE_TRUNC period, or a date part through EXTRACT), with the dashboard's
 * filters as WHERE, sorted (highest first by the first measure, or in time
 * order) and limited to the top N. Every measure is the KPI's own expression
 * (compile/sql.ts), so the numbers match the KPI cards' definitions:
 *  - simple measures (sums, counts, averages, ratios of them) share that one
 *    SELECT;
 *  - per-entity and latest-balance KPIs need CTEs, so each gets its own
 *    query (kpiQuery grouped by the same key) with the filtered rows in a
 *    `filtered` CTE;
 *  - a KPI built on each entity's first date (new customers) has no exact
 *    per-category or filtered SQL; it is listed as skipped, with why, rather
 *    than approximated.
 *
 * Conventions mirror the engine: filters are inclusive and ANDed, blanks fail
 * date ranges, "(blank)" in an "in" filter means NULL, rows without a date
 * are left out of time groupings, and weekday is ISO (1 = Monday). Proven
 * equal to the engine in DuckDB by tests/questions.test.ts.
 */
import { prettySql } from "./sqlFormat";
import { wordLabels } from "@/engine/core/booleans";
import type { Column, Dataset } from "@/engine/core/types";
import { isoDateTime, type DatePart, type TimeGrain } from "@/engine/core/dates";
import { countsByFirstDate, type Expr } from "@/engine/query/expr";
import { BLANK_LABEL, type Filter } from "@/engine/query/filter";
import {
  isComplexExpr,
  kpiQuery,
  quoteIdent,
  quoteString,
  simpleExprSql,
  UnsupportedGroupingError,
  type SqlContext,
} from "./sql";

export type QuestionKey =
  | { kind: "none" }
  | { kind: "column"; column: string }
  | { kind: "time"; column: string; grain: TimeGrain }
  | { kind: "part"; column: string; part: DatePart };

export interface QuestionMeasure {
  id: string;
  label: string;
  expr: Expr;
}

export interface QuestionSqlInput {
  question: string;
  /** Comment lines to head the SQL with instead of "Question / Read as" (the KPI card's SQL uses this). */
  header?: string[];
  /** How the question was read, e.g. "Average Customer Rating by City". */
  understood: string;
  measures: QuestionMeasure[];
  key: QuestionKey;
  /** Column heading for the key, e.g. "City", "Month", "Hour of day". */
  keyLabel: string;
  filters: readonly Filter[];
  /** Category keys only: "desc" puts the highest first, "asc" the lowest. */
  order: "desc" | "asc";
  /** Category keys only: rows to return. */
  limit?: number;
}

export interface QuestionSql {
  /** The query (or queries) with a comment header; "" when no measure could be written. */
  sql: string;
  /** Measures without SQL, and why. */
  skipped: Array<{ label: string; reason: string }>;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** A wall-clock timestamp literal, to the millisecond (end-of-day bounds are …23:59:59.999). */
function tsLiteral(ms: number): string {
  return `TIMESTAMP '${isoDateTime(ms)}.${pad(((ms % 1000) + 1000) % 1000, 3)}'`;
}

const numLiteral = (n: number) => String(Number(n.toPrecision(15)));

/** Expression of the question's key. Weekday is ISO (1 = Monday … 7 = Sunday); months and days are 1-based. */
function keySql(key: Exclude<QuestionKey, { kind: "none" }>, ctx: SqlContext): string {
  const c = ctx.col(`col:${key.column}`);
  if (key.kind === "column") return c;
  if (key.kind === "time") return `DATE_TRUNC('${key.grain}', ${c})`;
  switch (key.part) {
    case "dow":
      return `EXTRACT(ISODOW FROM ${c})`;
    case "hour":
      return `EXTRACT(HOUR FROM ${c})`;
    case "month":
      return `EXTRACT(MONTH FROM ${c})`;
    case "dom":
      return `EXTRACT(DAY FROM ${c})`;
  }
}

/** One filter as a condition, with the engine's semantics (filter.ts); null when it doesn't apply. */
function filterSql(f: Filter, col: Column | undefined, ctx: SqlContext): string | null {
  if (!col) return null;
  const c = ctx.col(`col:${f.column}`);
  if (f.kind === "dateRange") {
    if (col.kind !== "date") return null;
    return `${c} BETWEEN ${tsLiteral(f.from)} AND ${tsLiteral(f.to)}`;
  }
  if (f.kind === "range") {
    if (col.kind !== "number" && col.kind !== "date") return null;
    const lit = (v: number) => (col.kind === "date" ? tsLiteral(v) : numLiteral(v));
    const parts = [
      ...(f.min !== undefined ? [`${c} >= ${lit(f.min)}`] : []),
      ...(f.max !== undefined ? [`${c} <= ${lit(f.max)}`] : []),
    ];
    return parts.length ? parts.join(" AND ") : null;
  }
  // "in": labels as filter.ts cellLabel writes them.
  const blank = f.values.includes(BLANK_LABEL);
  const labels = f.values.filter((v) => v !== BLANK_LABEL);
  const literal = (label: string): string | null => {
    switch (col.kind) {
      case "string":
        return quoteString(label);
      case "boolean":
        // A column of words is text in the exported table, so it compares with the words.
        if (wordLabels(col))
          return label === col.trueLabel || label === col.falseLabel ? quoteString(label) : null;
        return label === col.trueLabel ? "TRUE" : label === col.falseLabel ? "FALSE" : null;
      case "date":
        return Number.isFinite(Number(label)) ? tsLiteral(Number(label)) : null;
      default:
        return Number.isFinite(Number(label)) ? numLiteral(Number(label)) : null;
    }
  };
  const list = labels.map(literal).filter((x): x is string => x !== null);
  const inList = list.length ? `${c} IN (${list.join(", ")})` : null;
  if (!f.exclude) {
    if (inList && blank) return `(${inList} OR ${c} IS NULL)`;
    return inList ?? (blank ? `${c} IS NULL` : "1 = 0");
  }
  if (inList)
    return blank
      ? `(${c} IS NOT NULL AND ${c} NOT IN (${list.join(", ")}))`
      : `(${c} IS NULL OR ${c} NOT IN (${list.join(", ")}))`;
  return blank ? `${c} IS NOT NULL` : null;
}

/** True when `e` (following refs) counts entities by their first date, which grouped or filtered SQL can't mirror. */
function usesFirstDates(e: Expr, ctx: SqlContext): boolean {
  return countsByFirstDate(e, (id) => ctx.kpiExpr(id));
}

/** SQL for one business question; see the file header for the shape and rules. */
export function questionSql(input: QuestionSqlInput, ds: Dataset, ctx: SqlContext): QuestionSql {
  const cols = new Map(ds.columns.map((c) => [c.name, c]));
  const where = input.filters
    .map((f) => filterSql(f, cols.get(f.column), ctx))
    .filter((x): x is string => Boolean(x));
  const key = input.key;
  // Time and date-part groupings leave out rows without a date, as the engine does.
  if (key.kind === "time" || key.kind === "part") where.push(`${ctx.col(`col:${key.column}`)} IS NOT NULL`);
  const keyExpr = key.kind === "none" ? null : keySql(key, ctx);
  const keyAlias = quoteIdent(input.keyLabel);
  const ordered = key.kind === "column";
  const orderBy = ordered
    ? `ORDER BY 2 ${input.order === "asc" ? "ASC" : "DESC"} NULLS LAST`
    : keyExpr
      ? "ORDER BY 1"
      : "";
  const limit = ordered && input.limit ? `LIMIT ${input.limit}` : "";

  const skipped: QuestionSql["skipped"] = [];
  const simple: QuestionMeasure[] = [];
  const complex: QuestionMeasure[] = [];
  for (const m of input.measures) {
    const firstDates = usesFirstDates(m.expr, ctx);
    if (firstDates && (key.kind !== "time" || where.length > 1)) {
      skipped.push({
        label: m.label,
        reason:
          "It counts each entity once, in the period of its first-ever date, which a per-category or filtered query can't reproduce exactly. The KPI's own SQL is in the SQL file.",
      });
      continue;
    }
    if (isComplexExpr(m.expr, ctx)) complex.push(m);
    else simple.push(m);
  }

  const statements: string[] = [];
  if (simple.length) {
    const select = [
      ...(keyExpr ? [`${keyExpr} AS ${keyAlias}`] : []),
      ...simple.map((m) => `${simpleExprSql(m.expr, ctx)} AS ${quoteIdent(m.label)}`),
    ];
    statements.push(
      [
        `SELECT ${select.join(",\n       ")}`,
        `FROM ${ctx.table}`,
        ...(where.length ? [`WHERE ${where.join("\n  AND ")}`] : []),
        ...(keyExpr ? ["GROUP BY 1"] : []),
        ...(orderBy ? [orderBy] : []),
        ...(limit ? [limit] : []),
      ].join("\n") + ";",
    );
  }
  for (const m of complex) {
    // The filtered rows become a CTE so every part of the KPI (base and leaves) reads the same rows.
    const filtered = where.length
      ? `filtered AS (\n  SELECT * FROM ${ctx.table}\n  WHERE ${where.join("\n    AND ")}\n)`
      : "";
    const fctx: SqlContext = where.length ? { ...ctx, table: "filtered" } : ctx;
    try {
      const inner =
        key.kind === "none"
          ? kpiQuery(m.expr, fctx)
          : key.kind === "time"
            ? kpiQuery(m.expr, fctx, { dateCol: ctx.col(`col:${key.column}`), grain: key.grain }, false)
            : kpiQuery(m.expr, fctx, { dateCol: "", grain: "day", keySql: keyExpr as string }, false);
      const merged = filtered
        ? inner.startsWith("WITH ")
          ? `WITH ${filtered},\n${inner.slice(5)}`
          : `WITH ${filtered}\n${inner}`
        : inner;
      const indented = merged.replace(/\n/g, "\n  ");
      statements.push(
        [
          `-- ${m.label}: computed per entity or on the latest date, so it has its own query`,
          `SELECT ${keyExpr ? `period AS ${keyAlias}, ` : ""}value AS ${quoteIdent(m.label)}`,
          `FROM (\n  ${indented}\n) AS q`,
          ...(keyExpr
            ? [ordered ? `ORDER BY 2 ${input.order === "asc" ? "ASC" : "DESC"} NULLS LAST` : "ORDER BY 1"]
            : []),
          ...(limit ? [limit] : []),
        ].join("\n") + ";",
      );
    } catch (e) {
      skipped.push({
        label: m.label,
        reason:
          e instanceof UnsupportedGroupingError
            ? e.message
            : "Its SQL couldn't be written for this question.",
      });
    }
  }
  if (!statements.length) return { sql: "", skipped };
  const header = [
    ...(input.header
      ? input.header.map((l) => `-- ${l}`)
      : [`-- Question: ${input.question.replace(/\s+/g, " ").trim()}`, `-- Read as: ${input.understood}`]),
    "-- Runs on DuckDB and PostgreSQL against the table from the SQL export.",
    ...(key.kind === "part" && key.part === "dow" ? ["-- Weekday: 1 = Monday … 7 = Sunday."] : []),
    ...skipped.map((s) => `-- Not in SQL: ${s.label}. ${s.reason}`),
  ];
  return { sql: `${header.join("\n")}\n\n${statements.map((st) => prettySql(st)).join("\n\n")}`, skipped };
}
