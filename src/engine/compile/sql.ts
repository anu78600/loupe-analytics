/**
 * Expression → SQL. Output is standard SQL that runs as-is on DuckDB and
 * PostgreSQL (dialect notes cover MySQL and SQL Server). Simple KPIs compile
 * to a one-line aggregate; per-entity, first-date and closing-balance KPIs
 * compile to CTEs so every step is readable.
 *
 * How the SQL stays equal to the evaluator (tests/registry.test.ts and
 * tests/equivalence.test.ts):
 *  - KPI refs and `calc` are inlined. In plain aggregates the conditions
 *    become `CASE WHEN cond THEN x END`, so failing rows are NULL and ignored,
 *    and many conditional aggregates share one table scan.
 *  - Predicates are two-valued, as in the evaluator: `not` is written
 *    NOT COALESCE((…), FALSE), so a row whose inner test is NULL passes it.
 *  - SUM is wrapped in COALESCE(…, 0); division is `x * 1.0 / NULLIF(y, 0)`,
 *    where `* 1.0` avoids integer division on engines that truncate.
 *  - per, newEntities and atLatest become CTEs (leaf1, leaf2, …) joined to a
 *    `base` CTE that holds the simple aggregates: exactly one row overall,
 *    one row per period when trended. A period with no leaf row gets the
 *    evaluator's value over no rows (emptyValue), e.g. 0 for a per-entity sum.
 *  - Day differences (daysBetween, spanDays) are CAST(b AS DATE) -
 *    CAST(a AS DATE): whole calendar days (midnights crossed) in DuckDB and
 *    PostgreSQL alike, which is the evaluator's floor-day difference on
 *    wall-clock ms. MySQL spells it DATEDIFF(b, a), SQL Server
 *    DATEDIFF(day, a, b).
 */
import type { StorageType } from "@/engine/core/types";
import { CMP_SYMBOL, type Expr, type Predicate, type RowExpr } from "@/engine/query/expr";

/** What the compiler needs from the session; built by kpi/context.ts makeSqlContext. */
export interface SqlContext {
  /** Quoted table name. */
  table: string;
  /** Quoted column name for a field reference. */
  col(ref: string): string;
  /** Storage kind behind a field, used to spell isTrue/isFalse. */
  colType(ref: string): StorageType;
  /**
   * A yes/no field's own spellings when the file used words ("Yes"/"No"): it is
   * exported as text, so tests compare with the words (core/booleans.ts).
   */
  boolLabels?(ref: string): { true: string; false: string } | null;
  classValues(ref: string, cls: string): readonly string[];
  /** Expression behind a KPI ref; it is inlined, since SQL has no measures. */
  kpiExpr(id: string): Expr;
}

export const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;
export const quoteString = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** Numeric literal; non-integers are rounded to 15 significant digits to drop float noise (0.1 + 0.2). */
function num(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(15)));
}

/**
 * Boolean SQL condition for a predicate. Empty value lists compile to
 * `1 = 0` for in/class and `1 = 1` for notClass, matching the evaluator.
 * `in` and `class` compare text exactly (case and spaces count), as the
 * evaluator does. NOT is made two-valued like the evaluator's `!f(r)`: a
 * blank cell makes the inner test NULL, which COALESCE turns into FALSE, so
 * the row passes the NOT instead of being dropped by NOT (NULL).
 */
/** The SQL written for a condition that holds for every row, and for none. */
const ALWAYS_TRUE = "1 = 1";
const ALWAYS_FALSE = "1 = 0";

export function predicateSql(p: Predicate, ctx: SqlContext): string {
  // AND binds tighter than OR and `or` is always bracketed, so `and` needs no brackets.
  // Conditions that are always true or false (a value class the file doesn't have) drop out:
  // x AND TRUE is x and x OR FALSE is x, blanks included, so the query reads as it means.
  if ("and" in p) {
    const parts = p.and.map((x) => predicateSql(x, ctx));
    if (parts.includes(ALWAYS_FALSE)) return ALWAYS_FALSE;
    const kept = parts.filter((x) => x !== ALWAYS_TRUE);
    return kept.length ? kept.join(" AND ") : ALWAYS_TRUE;
  }
  if ("or" in p) {
    const parts = p.or.map((x) => predicateSql(x, ctx));
    if (parts.includes(ALWAYS_TRUE)) return ALWAYS_TRUE;
    const kept = parts.filter((x) => x !== ALWAYS_FALSE);
    return kept.length ? `(${kept.join(" OR ")})` : ALWAYS_FALSE;
  }
  if ("not" in p) {
    const inner = predicateSql(p.not, ctx);
    if (inner === ALWAYS_TRUE) return ALWAYS_FALSE;
    if (inner === ALWAYS_FALSE) return ALWAYS_TRUE;
    return `NOT COALESCE((${inner}), FALSE)`;
  }
  const c = ctx.col(p.field);
  if ("in" in p || "class" in p) {
    const values = "in" in p ? p.in : ctx.classValues(p.field, p.class);
    return values.length ? `${c} IN (${values.map(quoteString).join(", ")})` : ALWAYS_FALSE;
  }
  if ("notClass" in p) {
    const values = ctx.classValues(p.field, p.notClass);
    return values.length
      ? `(${c} IS NULL OR ${c} NOT IN (${values.map(quoteString).join(", ")}))`
      : ALWAYS_TRUE;
  }
  if ("isTrue" in p || "isFalse" in p) {
    const truthy = "isTrue" in p;
    const t = ctx.colType(p.field);
    if (t === "boolean") {
      const words = ctx.boolLabels?.(p.field);
      if (words) return `${c} = ${quoteString(truthy ? words.true : words.false)}`;
      return `${c} = ${truthy ? "TRUE" : "FALSE"}`;
    }
    if (t === "number") return `${c} = ${truthy ? 1 : 0}`;
    return truthy
      ? `LOWER(${c}) IN ('true', 'yes', 'y', 't', '1')`
      : `LOWER(${c}) IN ('false', 'no', 'n', 'f', '0')`;
  }
  if ("cmp" in p) return `${c} ${CMP_SYMBOL[p.cmp]} ${num(p.value)}`;
  if ("cmpField" in p) return `${c} ${CMP_SYMBOL[p.cmpField]} ${ctx.col(p.other)}`;
  if ("notNull" in p) return `${c} IS NOT NULL`;
  return `${c} IS NULL`;
}

/**
 * Whole calendar days from `a` to `b` (negative when `b` is earlier, NULL when
 * either is): date subtraction counts midnights crossed and ignores the time
 * of day in DuckDB and PostgreSQL, like the evaluator's floor-day difference.
 */
const dayDiff = (a: string, b: string): string => `(CAST(${b} AS DATE) - CAST(${a} AS DATE))`;

/** Row-level SQL expression, placed inside an aggregate. */
export function rowExprSql(e: RowExpr, ctx: SqlContext): string {
  if ("num" in e) return num(e.num);
  if ("field" in e) {
    // A yes/no field spelled with words counts as 1/0 (blank stays NULL), as in the evaluator.
    const words = ctx.boolLabels?.(e.field);
    const c = ctx.col(e.field);
    return words
      ? `CASE ${c} WHEN ${quoteString(words.true)} THEN 1 WHEN ${quoteString(words.false)} THEN 0 END`
      : c;
  }
  if ("daysBetween" in e) {
    const a = ctx.col(e.daysBetween[0]);
    const b = ctx.col(e.daysBetween[1]);
    // In order only: NULL when the second date is the earlier day, as in the evaluator.
    return e.inOrder
      ? `CASE WHEN CAST(${b} AS DATE) >= CAST(${a} AS DATE) THEN ${dayDiff(a, b)} END`
      : dayDiff(a, b);
  }
  const a = rowExprSql(e.args[0], ctx);
  const b = rowExprSql(e.args[1], ctx);
  switch (e.op) {
    case "add":
      return `(${a} + ${b})`;
    case "sub":
      return `(${a} - ${b})`;
    case "mul":
      return `(${a} * ${b})`;
    case "div":
      return `(${a} * 1.0 / NULLIF(${b}, 0))`;
  }
}

// ANDs conditions, bracketing any that contain an OR and don't already start
// with a bracket. A safety net: predicateSql brackets `or` itself.
const andConds = (conds: readonly string[]): string =>
  conds.map((c) => (/\sOR\s/.test(c) && !c.startsWith("(") ? `(${c})` : c)).join(" AND ");

/** Conditions without the always-true ones, which filter nothing. */
const meaningful = (conds: readonly string[]): string[] => conds.filter((c) => c !== ALWAYS_TRUE);

/** True if the expression (following refs) needs CTE-style compilation. */
function isComplex(e: Expr, ctx: SqlContext, seen = new Set<string>()): boolean {
  if ("per" in e || "newEntities" in e || "atLatest" in e) return true;
  if ("ref" in e) {
    if (seen.has(e.ref)) return false;
    seen.add(e.ref);
    return isComplex(ctx.kpiExpr(e.ref), ctx, seen);
  }
  if ("op" in e) return isComplex(e.args[0], ctx, seen) || isComplex(e.args[1], ctx, seen);
  if ("calc" in e) return isComplex(e.calc, ctx, seen);
  return false;
}

/**
 * The evaluator's value for `e` over no rows, following refs: SUM, COUNT,
 * COUNT DISTINCT, newEntities and a per-entity sum or count give 0; AVG, MIN,
 * MAX, MEDIAN, spanDays and the other reduces give blank (NaN); constants and
 * arithmetic combine as in evaluate.ts (div is the safe divide). A trended
 * leaf CTE has no row for a period where nothing qualifies, so the LEFT JOIN
 * gives NULL there; leafValue substitutes this value instead.
 */
function emptyValue(e: Expr, ctx: SqlContext, path: ReadonlySet<string> = new Set()): number {
  if ("num" in e) return e.num;
  if ("agg" in e) return e.agg === "sum" || e.agg === "count" || e.agg === "countDistinct" ? 0 : NaN;
  // Registry validation rejects cyclic refs; the path guard only stops runaway recursion.
  if ("ref" in e)
    return path.has(e.ref) ? NaN : emptyValue(ctx.kpiExpr(e.ref), ctx, new Set(path).add(e.ref));
  if ("calc" in e) return emptyValue(e.calc, ctx, path);
  if ("op" in e) {
    const x = emptyValue(e.args[0], ctx, path);
    const y = emptyValue(e.args[1], ctx, path);
    switch (e.op) {
      case "add":
        return x + y;
      case "sub":
        return x - y;
      case "mul":
        return x * y;
      case "div":
        return y === 0 || y !== y || x !== x ? NaN : x / y;
    }
  }
  if ("per" in e) return e.reduce === "sum" || e.reduce === "count" ? 0 : NaN;
  if ("newEntities" in e) return 0;
  // atLatest over no rows keeps no rows, so its expression is evaluated on none.
  return emptyValue(e.expr, ctx, path);
}

/** A leaf CTE's value, `leaf.v`, wrapped in COALESCE when `e`'s value over no rows is a number rather than blank. */
function leafValue(leaf: string, e: Expr, ctx: SqlContext): string {
  const empty = emptyValue(e, ctx);
  return Number.isFinite(empty) ? `COALESCE(${leaf}.v, ${num(empty)})` : `${leaf}.v`;
}

export interface PeriodSpec {
  /** Quoted date column used for bucketing. */
  dateCol: string;
  grain: "day" | "week" | "month" | "quarter" | "year";
  /**
   * Group by this SQL expression instead of a date bucket (a category column,
   * an hour of day…), for business questions (questionSql.ts). Blank keys
   * form their own group, matched null-safely. Not supported for newEntities,
   * whose first-date semantics are per period.
   */
  keySql?: string;
}

/** Thrown when an expression can't be compiled for the requested grouping. */
export class UnsupportedGroupingError extends Error {}

/** State while compiling a complex KPI: leaf CTEs emitted so far and the simple aggregates destined for `base`. */
interface Builder {
  ctx: SqlContext;
  period: PeriodSpec | null;
  ctes: string[];
  baseCols: string[];
  leafCounter: number;
}

/** DATE_TRUNC bucket for the period grain (DuckDB and PostgreSQL spelling). */
const periodExpr = (p: PeriodSpec, col = p.dateCol): string => p.keySql ?? `DATE_TRUNC('${p.grain}', ${col})`;

/**
 * Simple aggregate → SQL aggregate expression (with CASE for conditions).
 * `conds` are the enclosing calc conditions; rows failing them (or `where`)
 * become NULL inside the aggregate, which every SQL aggregate ignores.
 */
function aggSql(e: Extract<Expr, { agg: string }>, conds: string[], ctx: SqlContext): string {
  const all = meaningful([...conds, ...(e.where ? [predicateSql(e.where, ctx)] : [])]);
  const when = all.length ? andConds(all) : "";
  const wrap = (x: string) => (when ? `CASE WHEN ${when} THEN ${x} END` : x);
  switch (e.agg) {
    case "sum":
      return `COALESCE(SUM(${wrap(rowExprSql(e.of, ctx))}), 0)`;
    case "avg":
      return `AVG(${wrap(rowExprSql(e.of, ctx))})`;
    case "min":
      return `MIN(${wrap(rowExprSql(e.of, ctx))})`;
    case "max":
      return `MAX(${wrap(rowExprSql(e.of, ctx))})`;
    case "median":
      return `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${wrap(rowExprSql(e.of, ctx))})`;
    case "count":
      return when ? `COUNT(CASE WHEN ${when} THEN 1 END)` : "COUNT(*)";
    case "countDistinct":
      return `COUNT(DISTINCT ${wrap(ctx.col(e.of))})`;
    case "spanDays": {
      const d = wrap(ctx.col(e.of));
      return dayDiff(`MIN(${d})`, `MAX(${d})`);
    }
  }
}

/** Compiles an expression that only contains simple aggregates into one SELECT-list expression. */
function simpleSql(e: Expr, conds: string[], ctx: SqlContext): string {
  if ("num" in e) return num(e.num);
  if ("agg" in e) return aggSql(e, conds, ctx);
  // A ref is inlined under the current conditions, like a measure under CALCULATE.
  if ("ref" in e) return simpleSql(ctx.kpiExpr(e.ref), conds, ctx);
  if ("calc" in e) return simpleSql(e.calc, [...conds, predicateSql(e.where, ctx)], ctx);
  if ("op" in e) {
    const a = simpleSql(e.args[0], conds, ctx);
    const b = simpleSql(e.args[1], conds, ctx);
    switch (e.op) {
      case "add":
        return `(${a} + ${b})`;
      case "sub":
        return `(${a} - ${b})`;
      case "mul":
        return `(${a} * ${b})`;
      case "div":
        return `(${a} * 1.0 / NULLIF(${b}, 0))`;
    }
  }
  throw new Error("simpleSql called on a complex expression");
}

/** Outer aggregate over the per-entity values `v`, mirroring Reduce (count ignores `v`). */
const REDUCE_SQL: Record<string, (v: string) => string> = {
  avg: (v) => `AVG(${v})`,
  sum: (v) => `COALESCE(SUM(${v}), 0)`,
  count: () => "COUNT(*)",
  median: (v) => `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${v})`,
  min: (v) => `MIN(${v})`,
  max: (v) => `MAX(${v})`,
};

/** Compiles any expression into a SQL expression over CTE columns; complex leaves become CTEs. */
function buildExpr(e: Expr, conds: string[], b: Builder): string {
  const { ctx, period } = b;
  if ("num" in e) return num(e.num);
  if ("ref" in e) return buildExpr(ctx.kpiExpr(e.ref), conds, b);
  if ("calc" in e) return buildExpr(e.calc, [...conds, predicateSql(e.where, ctx)], b);
  if ("op" in e) {
    const x = buildExpr(e.args[0], conds, b);
    const y = buildExpr(e.args[1], conds, b);
    switch (e.op) {
      case "add":
        return `(${x} + ${y})`;
      case "sub":
        return `(${x} - ${y})`;
      case "mul":
        return `(${x} * ${y})`;
      case "div":
        return `(${x} * 1.0 / NULLIF(${y}, 0))`;
    }
  }
  if ("agg" in e) {
    // Simple aggregates become columns of the shared base CTE (one table scan).
    const alias = `m${b.baseCols.length + 1}`;
    b.baseCols.push(`${aggSql(e, conds, ctx)} AS ${alias}`);
    return `base.${alias}`;
  }
  const leaf = `leaf${++b.leafCounter}`;
  // Inside a leaf CTE the enclosing calc conditions go into WHERE rather than
  // CASE: every aggregate in the leaf sees only those rows, as in the evaluator.
  const kept = meaningful(conds);
  const where = kept.length ? andConds(kept) : "";
  if ("per" in e) {
    // Inner query: one row per entity (per period when trended) holding the
    // inner measure, with HAVING dropping entities; the outer query reduces them.
    const ent = ctx.col(e.per);
    const inner = e.reduce === "count" ? "1" : simpleOrThrow(e.inner, ctx);
    const having = e.having
      ? `${simpleOrThrow(e.having.expr, ctx)} ${CMP_SYMBOL[e.having.cmp]} ${num(e.having.value)}`
      : "";
    // Inside the subquery the bucket is named loupe_period: a user column called "Period" would
    // otherwise be what GROUP BY period binds to, and the KPI would be grouped by it instead.
    const pSel = period ? `${periodExpr(period)} AS loupe_period, ` : "";
    const pGroup = period ? "loupe_period, " : "";
    b.ctes.push(
      `${leaf} AS (\n  SELECT ${period ? "loupe_period AS period, " : ""}${REDUCE_SQL[e.reduce]?.("v")} AS v\n  FROM (\n    SELECT ${pSel}${ent} AS entity, ${inner} AS v\n    FROM ${ctx.table}\n    WHERE ${ent} IS NOT NULL${where ? ` AND ${where}` : ""}\n    GROUP BY ${pGroup}${ent}${having ? `\n    HAVING ${having}` : ""}\n  ) per_entity${period ? "\n  GROUP BY loupe_period" : ""}\n)`,
    );
    // A period with no qualifying entity has no leaf row: a sum or count of no entities is 0.
    return leafValue(leaf, e, ctx);
  }
  if ("newEntities" in e) {
    if (period?.keySql)
      throw new UnsupportedGroupingError(
        "It counts each entity once, in the period of its first date, so it has no per-category SQL.",
      );
    // first_seen: each entity's first date among the rows passing the
    // conditions. Trended, an entity counts in the period of its first date;
    // overall there is no date filter, so every entity counts. COALESCE (via
    // leafValue) covers periods with no new entity, which have no leaf row to join.
    const ent = ctx.col(e.newEntities);
    const d = ctx.col(e.date);
    b.ctes.push(
      `${leaf} AS (\n  -- Each entity counts once, in the period of its first-ever date\n  SELECT ${period ? `${periodExpr(period, "first_date")} AS period, ` : ""}COUNT(*) AS v\n  FROM (\n    SELECT ${ent}, MIN(${d}) AS first_date\n    FROM ${ctx.table}\n    WHERE ${ent} IS NOT NULL${where ? ` AND ${where}` : ""}\n    GROUP BY ${ent}\n  ) first_seen${period ? "\n  GROUP BY 1" : ""}\n)`,
    );
    return leafValue(leaf, e, ctx);
  }
  // atLatest: evaluate on the latest date (per period) only.
  // DENSE_RANK() = 1 keeps every row tied on the latest date; the conditions
  // apply before ranking, so "latest" means latest among matching rows. A
  // period with no dated matching row has no leaf row, and the expression
  // then takes its value over no rows (0 for a sum or count).
  const snap = ctx.col(e.atLatest);
  const innerSql = simpleOrThrow(e.expr, ctx, ["snap_rank = 1"]);
  const partition = period ? `PARTITION BY ${periodExpr(period)} ` : "";
  b.ctes.push(
    `${leaf} AS (\n  -- Semi-additive: only rows on the latest date${period ? " of each period" : ""}\n  SELECT ${period ? "loupe_period AS period, " : ""}${innerSql} AS v\n  FROM (\n    SELECT *, ${period ? `${periodExpr(period)} AS loupe_period, ` : ""}DENSE_RANK() OVER (${partition}ORDER BY ${snap} DESC NULLS LAST) AS snap_rank\n    FROM ${ctx.table}\n    WHERE ${snap} IS NOT NULL${where ? ` AND ${where}` : ""}\n  ) latest${period ? "\n  GROUP BY loupe_period" : ""}\n)`,
  );
  return leafValue(leaf, e, ctx);
}

/** True when `e` (following refs) needs CTEs: per-entity, first-date or latest-date parts. */
export const isComplexExpr = (e: Expr, ctx: SqlContext): boolean => isComplex(e, ctx);

/** A simple expression as one SELECT-list SQL expression (throws on per, newEntities and atLatest). */
export const simpleExprSql = (e: Expr, ctx: SqlContext): string => simpleOrThrow(e, ctx);

/** Compiles a sub-expression that must be simple: a per's inner/having or an atLatest's expr. */
function simpleOrThrow(e: Expr, ctx: SqlContext, conds: string[] = []): string {
  if (isComplex(e, ctx)) throw new Error("Nested per-entity expressions are not supported in SQL export.");
  return simpleSql(e, conds, ctx);
}

/**
 * Full query returning exactly one row (overall, even on an empty table) or
 * one row per period. Periods are DATE_TRUNC buckets of `period.dateCol` over
 * the whole table, so rows with a NULL date form their own NULL period;
 * `orderBy` sorts by period.
 */
export function kpiQuery(e: Expr, ctx: SqlContext, period: PeriodSpec | null = null, orderBy = true): string {
  if (!isComplex(e, ctx)) {
    const value = simpleSql(e, [], ctx);
    if (!period) return `SELECT ${value} AS value\nFROM ${ctx.table}`;
    return `SELECT ${periodExpr(period)} AS period, ${value} AS value\nFROM ${ctx.table}\nGROUP BY 1${orderBy ? "\nORDER BY 1" : ""}`;
  }
  const b: Builder = { ctx, period, ctes: [], baseCols: [], leafCounter: 0 };
  const value = buildExpr(e, [], b);
  const leaves = b.ctes.map((_, i) => `leaf${i + 1}`);
  // Overall, base must be exactly one row. Aggregates without GROUP BY give
  // one row even on an empty table; with no aggregate at all (only per,
  // newEntities or atLatest leaves) base reads no table, because
  // `SELECT 1 FROM t` would give one row per table row, or none.
  const baseSel = period
    ? [`${periodExpr(period)} AS period`, ...b.baseCols]
    : b.baseCols.length
      ? b.baseCols
      : ["1 AS one"];
  const baseFrom = period
    ? `\n  FROM ${ctx.table}\n  GROUP BY 1`
    : b.baseCols.length
      ? `\n  FROM ${ctx.table}`
      : "";
  const base = `base AS (\n  SELECT ${baseSel.join(",\n         ")}${baseFrom}\n)`;
  // Trended, LEFT JOIN keeps periods that have no leaf row; overall, each leaf is a single row.
  // A category key can be blank, so its groups are matched null-safely.
  const eq = period?.keySql ? "IS NOT DISTINCT FROM" : "=";
  const joins = leaves
    .map((l) => (period ? `LEFT JOIN ${l} ON ${l}.period ${eq} base.period` : `CROSS JOIN ${l}`))
    .join("\n");
  return `WITH ${[base, ...b.ctes].join(",\n")}\nSELECT ${period ? "base.period, " : ""}${value} AS value\nFROM base\n${joins}${period && orderBy ? "\nORDER BY 1" : ""}`;
}

/**
 * CREATE TABLE for the export. `table` is inserted as given, so pass it
 * quoted. Integer number columns become BIGINT, other numbers DOUBLE
 * PRECISION, dates TIMESTAMP when they carry a time of day and DATE otherwise,
 * and time-of-day columns TIME.
 */
export function createTableSql(
  table: string,
  columns: Array<{
    name: string;
    type: StorageType;
    hasTime?: boolean;
    timeOnly?: boolean;
    integer?: boolean;
  }>,
): string {
  const type = (c: (typeof columns)[number]) =>
    c.type === "number"
      ? c.integer
        ? "BIGINT"
        : "DOUBLE PRECISION"
      : c.type === "date"
        ? c.timeOnly
          ? "TIME"
          : c.hasTime
            ? "TIMESTAMP"
            : "DATE"
        : c.type === "boolean"
          ? "BOOLEAN"
          : "VARCHAR";
  return `CREATE TABLE ${table} (\n${columns.map((c) => `  ${quoteIdent(c.name)} ${type(c)}`).join(",\n")}\n);`;
}
