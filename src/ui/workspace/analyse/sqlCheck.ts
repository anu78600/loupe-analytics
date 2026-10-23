/**
 * "Check this SQL on your data": the pure half of the check each answer
 * offers on the Questions step. The answer's SQL runs in DuckDB in this tab
 * (lib/duckdb.ts, loaded on demand); these functions split the SQL into its
 * statements and compare what DuckDB returned with the engine's answer, row
 * by row and measure by measure, so a mismatch names the group and the
 * measure that differ. Moved here from QuestionsStep.tsx in version 50.4,
 * unchanged, so it can be tested without a browser.
 */
import { BLANK_LABEL } from "@/engine/query/filter";
import type { QuestionAnswer } from "@/engine/session";

/** What one statement returned (lib/duckdb runSql). */
export interface SqlResult {
  columns: string[];
  rows: Array<Array<string | number | null>>;
}

/** Where a check stands, and what it says. */
export type CheckState = { status: "idle" | "running" | "ok" | "differs" | "error"; message: string };

/** The answer's statements, without their comment lines: one per measure that needs its own query. */
export function sqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((x) =>
      x
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

/** The SQL's group value in the engine's raw form: dates → bucket ms, ISO weekday and month (1-based) → 0-based. */
export function engineKey(v: string | number | null, a: Pick<QuestionAnswer, "ask">): string {
  if (v === null) return "null";
  const by = a.ask.by;
  if (by.kind === "time") {
    if (typeof v === "number") {
      // DuckDB-WASM may hand back epoch days, milliseconds or microseconds.
      const ms = v > 1e14 ? v / 1000 : v > 1e11 ? v : v * 86_400_000;
      return String(Math.round(ms));
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    return m ? String(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : v;
  }
  if (by.kind === "part") {
    const n = Number(v);
    return String(by.part === "dow" || by.part === "month" ? n - 1 : n);
  }
  return String(v);
}

const same = (x: number | null, y: number | null) =>
  x === null || y === null ? x === y : Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));

/** Blank or zero: what a group with no rows, or an empty "(blank)" group, holds. */
const empty = (v: number | null | undefined) => v === null || v === undefined || v === 0;

/**
 * Compares DuckDB's results with the answer: every measure each statement
 * returns, for every group. A group with nothing in it, or a blank group
 * with no value, is left out of the answer, so it is not a difference.
 */
export function compareWithAnswer(
  a: Pick<QuestionAnswer, "ask" | "keyLabel" | "measures" | "rows">,
  results: readonly SqlResult[],
): { compared: number; problems: string[] } {
  const engineRows = new Map(a.rows.map((r) => [r.raw === null ? "null" : String(r.raw), r]));
  let compared = 0;
  const problems: string[] = [];
  for (const res of results) {
    const keyAt = a.keyLabel === null ? -1 : res.columns.indexOf(a.keyLabel);
    // The measures this statement returns: a measure with its own query is checked by that query.
    const here = a.measures
      .map((m, i) => ({ m, i, at: res.columns.indexOf(m.label) }))
      .filter((x) => x.at >= 0);
    const seen = new Set<string>();
    for (const row of a.keyLabel === null ? res.rows.slice(0, 1) : res.rows) {
      const raw = keyAt < 0 ? null : (row[keyAt] ?? null);
      const key = keyAt < 0 ? "null" : engineKey(raw, a);
      seen.add(key);
      const e = a.keyLabel === null ? a.rows[0] : engineRows.get(key);
      const values = here.map(({ at }) => {
        const v = row[at];
        return v === null || v === undefined ? null : Number(v);
      });
      // A group with nothing in it, or a blank group with no value, is left out of the answer.
      if (!e && values.every(empty)) continue;
      here.forEach(({ m, i }, j) => {
        compared++;
        if (!e || !same(values[j] ?? null, e.values[i] ?? null))
          problems.push(
            `${m.label} for ${raw === null ? (a.keyLabel === null ? "all rows" : BLANK_LABEL) : String(raw)}`,
          );
      });
    }
    // A group with no rows has no SQL row; the answer lists it with an empty value (0 or blank).
    if (a.keyLabel !== null)
      for (const [key, e] of engineRows)
        if (!seen.has(key) && !here.every(({ i }) => empty(e.values[i]))) problems.push(`group ${e.label}`);
  }
  return { compared, problems };
}

/** The check's verdict in words: the first three differences, or how many values agreed. */
export function checkVerdict({ compared, problems }: { compared: number; problems: string[] }): CheckState {
  return problems.length
    ? {
        status: "differs",
        message: `DuckDB differs on ${problems.slice(0, 3).join(", ")}${problems.length > 3 ? "…" : ""}.`,
      }
    : {
        status: "ok",
        message: `DuckDB returned the same answer (${compared} value${compared === 1 ? "" : "s"} checked).`,
      };
}
