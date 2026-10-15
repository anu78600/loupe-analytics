/**
 * The measure language. One expression tree drives three back-ends: the
 * in-browser evaluator, the SQL compiler and the DAX compiler, so the number
 * on screen and the exported formulas cannot drift apart.
 *
 * FieldRef is a domain field id (e.g. "order_id") resolved through the column
 * mapping, or "col:<column name>" to reference a column directly.
 *
 * Contract shared by all three back-ends (tests/registry.test.ts checks the
 * evaluator against the generated SQL in DuckDB, overall and per month):
 *  - Blank cells (NaN in number/date columns, -1 in string codes and boolean
 *    values) are skipped by every aggregate.
 *  - SUM and COUNT over no rows are 0; AVG, MIN, MAX, MEDIAN and spanDays over
 *    no rows are blank. (DAX returns BLANK for an empty SUM or COUNTROWS,
 *    which its arithmetic treats as 0.)
 *  - `div` is a safe divide: a zero or blank denominator, or a blank
 *    numerator, gives blank, never an error or Infinity.
 *  - Ratios are written as a div of two aggregates (ratio of sums), never as
 *    an average of row-level ratios.
 * Pitfall: the evaluator and SQL propagate blanks through add/sub/mul and fail
 * comparisons on them, but DAX treats BLANK as 0 in both (BLANK + 5 = 5,
 * BLANK < 5 is TRUE), so keep blank-producing operands out of arithmetic and
 * comparisons.
 * A new node type must be handled in query/evaluate.ts, compile/sql.ts,
 * compile/dax.ts, the walkers below and the Zod schema in registry/schema.ts.
 */

/** Domain field id, or "col:<column name>" for a raw column (see the header). */
export type FieldRef = string;
/** Comparison operators; `neq` renders as `<>` in SQL and DAX. */
export type Cmp = "gt" | "gte" | "lt" | "lte" | "eq" | "neq";

/**
 * Per-row scalar, used as an aggregate's `of` and as a histogram bin axis.
 * Reads number and date columns (dates as wall-clock ms) and boolean columns
 * (1/0); referencing a text column throws. Blank cells are NaN and propagate
 * through add/sub/mul; `div` by zero gives blank (SQL NULLIF, DAX DIVIDE).
 */
export type RowExpr =
  | { field: FieldRef }
  | { num: number }
  | { op: "add" | "sub" | "mul" | "div"; args: [RowExpr, RowExpr] }
  /**
   * Calendar days from the first date to the second (DATEDIFF ... DAY).
   * Counts midnights crossed (floor-day difference), so it is negative when
   * the second date is earlier; blank if either date is blank.
   */
  | { daysBetween: [FieldRef, FieldRef] };

/**
 * Row filter: an aggregate's `where` or a `calc` condition. A blank cell never
 * passes a positive test (in, class, isTrue, isFalse, cmp, cmpField, notNull);
 * only isNull, notClass and `not` can select blank rows.
 * `not` is two-valued in all three back-ends: a blank row fails the inner
 * test, so it passes `not { isTrue }` (SQL spells it NOT COALESCE((…), FALSE)
 * rather than NOT (…), which would drop the row).
 */
export type Predicate =
  /**
   * Value is one of the listed strings, matched exactly (case and spaces
   * count) by the evaluator and SQL IN, so values must match the data's
   * spelling; DAX alone ignores case. Number columns compare numerically;
   * boolean columns match their true/false labels or "true"/"false",
   * ignoring case.
   */
  | { field: FieldRef; in: string[] }
  /**
   * Value belongs to a value class (registry `valueClasses`, resolved per
   * dataset into `Mapping.classes`). An empty class matches no row.
   */
  | { field: FieldRef; class: string }
  /**
   * Value is blank or not in the class (keeps rows with no status).
   * An empty class keeps every row, which is why it is not a requirement
   * in requiredClassesOf.
   */
  | { field: FieldRef; notClass: string }
  /** Boolean column, a 1/0 number, or a text token (true/yes/y/t/1, false/no/n/f/0). */
  | { field: FieldRef; isTrue: true }
  | { field: FieldRef; isFalse: true }
  /** Number or date (wall-clock ms) compared with a constant. */
  | { field: FieldRef; cmp: Cmp; value: number }
  /** Two number/date fields of the same row compared; fails if either is blank. */
  | { field: FieldRef; cmpField: Cmp; other: FieldRef }
  | { field: FieldRef; notNull: true }
  | { field: FieldRef; isNull: true }
  | { and: Predicate[] }
  | { or: Predicate[] }
  | { not: Predicate };

/**
 * How a `per` node combines per-entity values. Blank entity values are
 * skipped (avg/min/max/median of none are blank, sum of none is 0); `count`
 * counts the entities left after `having` and never evaluates `inner`.
 */
export type Reduce = "avg" | "sum" | "count" | "median" | "min" | "max";

/**
 * Measure expression, evaluated once per group (or once overall) over the
 * rows in the current filter context.
 */
export type Expr =
  /**
   * Aggregates a row expression over the rows passing `where`, skipping
   * blank results. Median averages the two middle values for an even count,
   * like PERCENTILE_CONT(0.5).
   */
  | { agg: "sum" | "avg" | "min" | "max" | "median"; of: RowExpr; where?: Predicate }
  /** Number of rows passing `where` (COUNT(*) / COUNTROWS). */
  | { agg: "count"; where?: Predicate }
  /** Distinct non-blank values of a field among the rows passing `where`. */
  | { agg: "countDistinct"; of: FieldRef; where?: Predicate }
  /**
   * Whole days between the earliest and latest date in context.
   * Counted as midnights crossed; blank when there is no date.
   */
  | { agg: "spanDays"; of: FieldRef; where?: Predicate }
  /** Arithmetic on two measure results, group by group; `div` is the safe divide. */
  | { op: "add" | "sub" | "mul" | "div"; args: [Expr, Expr] }
  | { num: number }
  /**
   * Reference another KPI by id (measure branching).
   * SQL inlines the referenced expression, DAX references the measure by
   * name, and the evaluator caches the result per row set.
   */
  | { ref: string }
  /**
   * Evaluate an expression under an extra filter (DAX CALCULATE + KEEPFILTERS).
   * The filter intersects with the current context and never replaces it; it
   * also narrows the first-date context of any newEntities inside.
   */
  | { calc: Expr; where: Predicate }
  /**
   * Aggregate per entity, then reduce across entities (AVERAGEX(VALUES(...))).
   * Entities are the non-blank values of `per` within each group. `having`
   * drops entities whose `having.expr` is blank or fails the comparison.
   * `inner` and `having.expr` must not contain per, newEntities or atLatest
   * (even through refs): the SQL compiler throws on such nesting.
   */
  | { per: FieldRef; inner: Expr; reduce: Reduce; having?: { expr: Expr; cmp: Cmp; value: number } }
  /**
   * Entities whose first-ever date falls in the period being evaluated.
   * Counts distinct non-blank entities in context whose earliest `date`, taken
   * over rows that pass every filter except date ranges (still within the
   * dimension value when broken down by one dimension), is on or after the
   * period start. Overall, with no date filter, every entity in context counts.
   */
  | { newEntities: FieldRef; date: FieldRef }
  /**
   * Semi-additive: evaluate on the latest date present in context (closing balance).
   * Keeps only the rows on the latest non-blank `atLatest` date of each group
   * (each period when trended), ties included, then evaluates `expr` on them.
   * Like `per`, its `expr` must not nest per, newEntities or atLatest for SQL.
   */
  | { atLatest: FieldRef; expr: Expr };

export const isAgg = (e: Expr): e is Extract<Expr, { agg: string }> => "agg" in e;

/**
 * Every field referenced by an expression (not following KPI refs).
 * One structural walker serves Expr, RowExpr and Predicate, because each node
 * shape is identified by its own key; a new node type needs a branch here and
 * in the walkers below.
 */
export function fieldsOf(e: Expr | RowExpr | Predicate, out = new Set<string>()): Set<string> {
  if ("field" in e && typeof e.field === "string") out.add(e.field);
  if ("daysBetween" in e) {
    out.add(e.daysBetween[0]);
    out.add(e.daysBetween[1]);
  }
  if ("other" in e && typeof e.other === "string") out.add(e.other);
  if ("agg" in e) {
    if ("of" in e && e.of !== undefined) {
      if (typeof e.of === "string") out.add(e.of);
      else fieldsOf(e.of, out);
    }
    if (e.where) fieldsOf(e.where, out);
  }
  if ("op" in e) for (const a of e.args) fieldsOf(a as Expr, out);
  if ("calc" in e) {
    fieldsOf(e.calc, out);
    fieldsOf(e.where, out);
  }
  if ("per" in e) {
    out.add(e.per);
    fieldsOf(e.inner, out);
    if (e.having) fieldsOf(e.having.expr, out);
  }
  if ("newEntities" in e) {
    out.add(e.newEntities);
    out.add(e.date);
  }
  if ("atLatest" in e) {
    out.add(e.atLatest);
    fieldsOf(e.expr, out);
  }
  if ("and" in e) for (const p of e.and) fieldsOf(p, out);
  if ("or" in e) for (const p of e.or) fieldsOf(p, out);
  if ("not" in e) fieldsOf(e.not, out);
  return out;
}

/** Value classes referenced by an expression, as "field.class" (both class and notClass; used by validation). */
export function classesOf(e: Expr | Predicate, out = new Set<string>()): Set<string> {
  if ("class" in e && "field" in e) out.add(`${e.field}.${e.class}`);
  if ("notClass" in e && "field" in e) out.add(`${e.field}.${e.notClass}`);
  if ("agg" in e && e.where) classesOf(e.where, out);
  if ("op" in e) for (const a of e.args) if (!("field" in a)) classesOf(a as Expr, out);
  if ("calc" in e) {
    classesOf(e.calc, out);
    classesOf(e.where, out);
  }
  if ("per" in e) {
    classesOf(e.inner, out);
    if (e.having) classesOf(e.having.expr, out);
  }
  if ("atLatest" in e) classesOf(e.expr, out);
  if ("and" in e) for (const p of e.and) classesOf(p, out);
  if ("or" in e) for (const p of e.or) classesOf(p, out);
  if ("not" in e) classesOf(e.not, out);
  return out;
}

/** Positive class requirements ("class", not "notClass") — these must resolve to at least one value. */
export function requiredClassesOf(e: Expr | Predicate, out = new Set<string>()): Set<string> {
  if ("class" in e && "field" in e) out.add(`${e.field}.${e.class}`);
  if ("agg" in e && e.where) requiredClassesOf(e.where, out);
  if ("op" in e) for (const a of e.args) if (!("field" in a)) requiredClassesOf(a as Expr, out);
  if ("calc" in e) {
    requiredClassesOf(e.calc, out);
    requiredClassesOf(e.where, out);
  }
  if ("per" in e) {
    requiredClassesOf(e.inner, out);
    if (e.having) requiredClassesOf(e.having.expr, out);
  }
  if ("atLatest" in e) requiredClassesOf(e.expr, out);
  if ("and" in e) for (const p of e.and) requiredClassesOf(p, out);
  if ("or" in e) for (const p of e.or) requiredClassesOf(p, out);
  if ("not" in e) requiredClassesOf(e.not, out);
  return out;
}

/** KPI ids referenced directly by an expression (one level; callers recurse through the registry). */
export function refsOf(e: Expr, out = new Set<string>()): Set<string> {
  if ("ref" in e) out.add(e.ref);
  if ("op" in e) for (const a of e.args) refsOf(a, out);
  if ("calc" in e) refsOf(e.calc, out);
  if ("per" in e) {
    refsOf(e.inner, out);
    if (e.having) refsOf(e.having.expr, out);
  }
  if ("atLatest" in e) refsOf(e.expr, out);
  return out;
}

/**
 * True when the measure can be summed across groups (time buckets or
 * segments) and still give the overall value: sums and counts, their sums and
 * differences, and those scaled by a constant (Σ k·x = k·Σx). Ratios,
 * averages, distinct counts, per-entity, new-entity and snapshot measures are
 * not. A bare constant is not either: k added per group would be counted G times.
 *
 * Pass `lookup` to follow `ref`s (measure branching, e.g. net revenue = gross
 * sales − discounts as two refs); without it a ref counts as non-additive.
 * Cycles are cut per path, so a ref used twice (a − a) is still followed.
 */
export function isAdditiveExpr(
  e: Expr,
  lookup?: (id: string) => Expr | undefined,
  path: ReadonlySet<string> = new Set(),
): boolean {
  if ("agg" in e) return e.agg === "sum" || e.agg === "count";
  if ("calc" in e) return isAdditiveExpr(e.calc, lookup, path);
  if ("ref" in e) {
    if (!lookup || path.has(e.ref)) return false;
    const target = lookup(e.ref);
    return target ? isAdditiveExpr(target, lookup, new Set(path).add(e.ref)) : false;
  }
  if ("op" in e) {
    const [a, b] = e.args;
    if (e.op === "add" || e.op === "sub")
      return isAdditiveExpr(a, lookup, path) && isAdditiveExpr(b, lookup, path);
    if (e.op === "mul")
      return (
        ("num" in a && isAdditiveExpr(b, lookup, path)) || ("num" in b && isAdditiveExpr(a, lookup, path))
      );
    // Dividing by a non-zero constant is scaling; dividing by a measure makes a ratio.
    return "num" in b && b.num !== 0 && isAdditiveExpr(a, lookup, path);
  }
  // num on its own, per, newEntities and atLatest.
  return false;
}

/** SQL and DAX spelling of each comparison operator. */
export const CMP_SYMBOL: Record<Cmp, string> = { gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "=", neq: "<>" };

/** Applies a comparison; callers screen out NaN first so blanks never match. */
export function compare(a: number, cmp: Cmp, b: number): boolean {
  switch (cmp) {
    case "gt":
      return a > b;
    case "gte":
      return a >= b;
    case "lt":
      return a < b;
    case "lte":
      return a <= b;
    case "eq":
      return a === b;
    case "neq":
      return a !== b;
  }
}
