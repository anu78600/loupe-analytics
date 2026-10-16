/**
 * Expression → DAX measures. Uses measure branching ([Net Revenue] referenced
 * by [AOV]), KEEPFILTERS so KPI conditions intersect the report's filters
 * (matching the in-app numbers), DIVIDE for safe division and
 * DISTINCTCOUNTNOBLANK so blanks are never counted as an entity.
 *
 * Other patterns: `per` iterates FILTER(VALUES(entity), …) with CALCULATE for
 * context transition; newEntities is the SQLBI new-customer pattern (first
 * date with the date filters removed, compared with the period start);
 * atLatest uses VAR __latest = MAX(date) for closing balances. VAR names
 * carry a counter (State.vars) so nested blocks in one measure never clash.
 * The tests only check that the DAX is well formed. Known differences from
 * the evaluator: BLANK acts as 0 in arithmetic and comparisons (see
 * query/expr.ts), an empty SUM or COUNTROWS is BLANK rather than 0, and DAX
 * compares text ignoring case, so `in`, `class` and `notClass` treat
 * "Delivered" and "delivered" as one value where the evaluator and SQL match
 * exactly.
 */
import type { StorageType } from "@/engine/core/types";
import { CMP_SYMBOL, type Expr, type Predicate, type RowExpr } from "@/engine/query/expr";

/** What the compiler needs from the session; built by kpi/context.ts makeDaxContext. */
export interface DaxContext {
  /** Quoted table, e.g. 'Sales'. */
  table: string;
  /** Fully qualified column for a field reference, e.g. 'Sales'[order_id]. */
  col(ref: string): string;
  /** Storage kind behind a field, used to spell isTrue/isFalse. */
  colType(ref: string): StorageType;
  /** A yes/no field's own spellings when the file used words; it is a text column in the model. */
  boolLabels?(ref: string): { true: string; false: string } | null;
  classValues(ref: string, cls: string): readonly string[];
  /** Measure reference for a KPI id, e.g. [Net Revenue]. */
  measure(id: string): string;
  /** Date column of the calendar table, e.g. 'Date'[Date]; null when none. */
  dateTableColumn: string | null;
  /** Quoted calendar table, e.g. 'Date'; null when none. */
  dateTable: string | null;
}

// DAX escaping: double " inside strings, ] inside measure and column names, ' inside table names.
export const daxString = (s: string): string => `"${s.replace(/"/g, '""')}"`;
export const daxMeasureName = (name: string): string => `[${name.replace(/]/g, "]]")}]`;
export const daxTableName = (name: string): string => `'${name.replace(/'/g, "''")}'`;
export const daxColumn = (table: string, column: string): string =>
  `${daxTableName(table)}[${column.replace(/]/g, "]]")}]`;

const num = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(15))));

function indent(s: string, by = "    "): string {
  return s
    .split("\n")
    .map((l) => by + l)
    .join("\n");
}

/** NAME ( a, b ) on one line when short, otherwise one argument per line. */
export function fn(name: string, args: string[]): string {
  const flat = `${name} ( ${args.join(", ")} )`;
  if (flat.length <= 96 && !args.some((a) => a.includes("\n"))) return flat;
  return `${name} (\n${args.map((a) => indent(a)).join(",\n")}\n)`;
}

/** Per-measure counter that keeps VAR names unique. */
interface State {
  vars: number;
}

/** A predicate as a DAX boolean plus the columns it reads (decides KEEPFILTERS vs FILTER). */
interface PredDax {
  cols: Set<string>;
  bool: string;
}

/**
 * Boolean DAX for a predicate. Empty value lists give FALSE () for in/class
 * and TRUE () for notClass, which filterArgs turns into an empty table or no
 * filter at all. DAX IN compares text ignoring case, unlike the evaluator
 * and SQL, which are exact (see the file header). NOT is two-valued, as in
 * the evaluator: a blank row that fails the inner test passes the NOT.
 */
function predBool(p: Predicate, ctx: DaxContext): PredDax {
  if ("and" in p || "or" in p) {
    const parts = ("and" in p ? p.and : p.or).map((x) => predBool(x, ctx));
    const cols = new Set<string>();
    parts.forEach((x) => x.cols.forEach((c) => cols.add(c)));
    return { cols, bool: `( ${parts.map((x) => x.bool).join("and" in p ? " && " : " || ")} )` };
  }
  if ("not" in p) {
    const inner = predBool(p.not, ctx);
    return { cols: inner.cols, bool: `NOT ( ${inner.bool} )` };
  }
  const c = ctx.col(p.field);
  const cols = new Set([c]);
  if ("in" in p || "class" in p) {
    const values = "in" in p ? p.in : ctx.classValues(p.field, p.class);
    return { cols, bool: values.length ? `${c} IN { ${values.map(daxString).join(", ")} }` : "FALSE ()" };
  }
  if ("notClass" in p) {
    const values = ctx.classValues(p.field, p.notClass);
    return {
      cols,
      bool: values.length ? `NOT ( ${c} IN { ${values.map(daxString).join(", ")} } )` : "TRUE ()",
    };
  }
  if ("isTrue" in p || "isFalse" in p) {
    const truthy = "isTrue" in p;
    const t = ctx.colType(p.field);
    if (t === "boolean") {
      const words = ctx.boolLabels?.(p.field);
      if (words) return { cols, bool: `${c} = ${daxString(truthy ? words.true : words.false)}` };
      return { cols, bool: `${c} = ${truthy ? "TRUE ()" : "FALSE ()"}` };
    }
    if (t === "number") return { cols, bool: `${c} = ${truthy ? 1 : 0}` };
    const tokens = truthy ? ["true", "yes", "y", "t", "1"] : ["false", "no", "n", "f", "0"];
    return { cols, bool: `LOWER ( ${c} ) IN { ${tokens.map(daxString).join(", ")} }` };
  }
  if ("cmp" in p) return { cols, bool: `${c} ${CMP_SYMBOL[p.cmp]} ${num(p.value)}` };
  if ("cmpField" in p) {
    const o = ctx.col(p.other);
    return { cols: new Set([c, o]), bool: `${c} ${CMP_SYMBOL[p.cmpField]} ${o}` };
  }
  if ("notNull" in p) return { cols, bool: `NOT ISBLANK ( ${c} )` };
  return { cols, bool: `ISBLANK ( ${c} )` };
}

/**
 * CALCULATE filter arguments for a predicate.
 * A top-level AND is split into separate arguments, which CALCULATE ANDs. A
 * single-column predicate becomes KEEPFILTERS(bool), so it intersects with
 * the report's filter on that column instead of replacing it. A predicate
 * over several columns becomes FILTER(table, bool); the table is evaluated in
 * the current filter context, so that is an intersection too.
 */
export function filterArgs(p: Predicate, ctx: DaxContext): string[] {
  if ("and" in p) return p.and.flatMap((x) => filterArgs(x, ctx));
  const { cols, bool } = predBool(p, ctx);
  if (bool === "TRUE ()") return [];
  if (bool === "FALSE ()") return [`FILTER ( ${ctx.table}, FALSE () )`];
  return cols.size <= 1 ? [`KEEPFILTERS ( ${bool} )`] : [`FILTER ( ${ctx.table}, ${bool} )`];
}

/** Row-level DAX, evaluated inside SUMX/AVERAGEX/… over the table. */
export function rowExprDax(e: RowExpr, ctx: DaxContext): string {
  if ("num" in e) return num(e.num);
  if ("field" in e) {
    // A yes/no field spelled with words counts as 1/0 (blank stays BLANK), as in the evaluator.
    const words = ctx.boolLabels?.(e.field);
    const c = ctx.col(e.field);
    return words ? `SWITCH ( ${c}, ${daxString(words.true)}, 1, ${daxString(words.false)}, 0, BLANK () )` : c;
  }
  if ("daysBetween" in e) {
    // Guard blanks explicitly: DATEDIFF would treat a BLANK date as day zero.
    const a = ctx.col(e.daysBetween[0]);
    const b = ctx.col(e.daysBetween[1]);
    return `IF ( ISBLANK ( ${a} ) || ISBLANK ( ${b} ), BLANK (), DATEDIFF ( ${a}, ${b}, DAY ) )`;
  }
  const a = rowExprDax(e.args[0], ctx);
  const b = rowExprDax(e.args[1], ctx);
  switch (e.op) {
    case "add":
      return `( ${a} + ${b} )`;
    case "sub":
      return `( ${a} - ${b} )`;
    case "mul":
      return `( ${a} * ${b} )`;
    case "div":
      return fn("DIVIDE", [a, b]);
  }
}

/**
 * Aggregate → DAX. A bare column uses SUM/AVERAGE/MIN/MAX/MEDIAN, a row
 * expression the matching X iterator; `where` wraps the result in CALCULATE.
 */
function aggDax(e: Extract<Expr, { agg: string }>, ctx: DaxContext, st: State): string {
  // A bare column takes SUM/AVERAGE…; a yes/no column of words is text, so it goes through the X form.
  const plain =
    "of" in e && typeof e.of === "object" && "field" in e.of && !ctx.boolLabels?.(e.of.field)
      ? ctx.col(e.of.field)
      : null;
  let core: string;
  switch (e.agg) {
    case "sum":
      core = plain ? fn("SUM", [plain]) : fn("SUMX", [ctx.table, rowExprDax(e.of, ctx)]);
      break;
    case "avg":
      core = plain ? fn("AVERAGE", [plain]) : fn("AVERAGEX", [ctx.table, rowExprDax(e.of, ctx)]);
      break;
    case "min":
      core = plain ? fn("MIN", [plain]) : fn("MINX", [ctx.table, rowExprDax(e.of, ctx)]);
      break;
    case "max":
      core = plain ? fn("MAX", [plain]) : fn("MAXX", [ctx.table, rowExprDax(e.of, ctx)]);
      break;
    case "median":
      core = plain ? fn("MEDIAN", [plain]) : fn("MEDIANX", [ctx.table, rowExprDax(e.of, ctx)]);
      break;
    case "count":
      core = fn("COUNTROWS", [ctx.table]);
      break;
    case "countDistinct":
      core = fn("DISTINCTCOUNTNOBLANK", [ctx.col(e.of)]);
      break;
    case "spanDays": {
      const d = ctx.col(e.of);
      const n = ++st.vars;
      core = `VAR __first${n} = MIN ( ${d} )\nVAR __last${n} = MAX ( ${d} )\nRETURN\n    IF ( ISBLANK ( __first${n} ), BLANK (), DATEDIFF ( __first${n}, __last${n}, DAY ) )`;
      break;
    }
  }
  if (!e.where) return core;
  const args = filterArgs(e.where, ctx);
  return args.length ? fn("CALCULATE", [core, ...args]) : core;
}

/** Iterator for each Reduce; `count` is COUNTROWS and is handled separately. */
const REDUCE_X: Record<string, string> = {
  avg: "AVERAGEX",
  sum: "SUMX",
  median: "MEDIANX",
  min: "MINX",
  max: "MAXX",
};

/** Measure expression for an Expr; `st` numbers the VARs within one measure. */
export function exprDax(e: Expr, ctx: DaxContext, st: State = { vars: 0 }): string {
  if ("num" in e) return num(e.num);
  // Measure branching: reference the KPI's own measure instead of inlining it.
  if ("ref" in e) return ctx.measure(e.ref);
  if ("agg" in e) return aggDax(e, ctx, st);
  if ("op" in e) {
    const a = exprDax(e.args[0], ctx, st);
    const b = exprDax(e.args[1], ctx, st);
    switch (e.op) {
      case "add":
        return `( ${a} + ${b} )`;
      case "sub":
        return `( ${a} - ${b} )`;
      case "mul":
        return `( ${a} * ${b} )`;
      case "div":
        return fn("DIVIDE", [a, b]);
    }
  }
  if ("calc" in e) {
    const args = filterArgs(e.where, ctx);
    const inner = exprDax(e.calc, ctx, st);
    return args.length ? fn("CALCULATE", [inner, ...args]) : inner;
  }
  if ("per" in e) {
    // Iterate the visible non-blank entities that pass `having`; CALCULATE
    // turns each entity row into a filter (context transition) so the inner
    // measure is evaluated per entity.
    const ent = ctx.col(e.per);
    const conds = [`NOT ISBLANK ( ${ent} )`];
    if (e.having)
      conds.push(
        `CALCULATE ( ${exprDax(e.having.expr, ctx, st)} ) ${CMP_SYMBOL[e.having.cmp]} ${num(e.having.value)}`,
      );
    const table = fn("FILTER", [fn("VALUES", [ent]), conds.join(" && ")]);
    if (e.reduce === "count") return fn("COUNTROWS", [table]);
    return fn(REDUCE_X[e.reduce] as string, [table, fn("CALCULATE", [exprDax(e.inner, ctx, st)])]);
  }
  if ("newEntities" in e) {
    // SQLBI new-customer pattern: an entity is new when its first date, with
    // the date filters removed but every other filter kept, is on or after the
    // period start (the calendar's first visible date, else the earliest
    // visible fact date).
    const ent = ctx.col(e.newEntities);
    const d = ctx.col(e.date);
    const n = ++st.vars;
    const removers = [
      ctx.dateTable ? `REMOVEFILTERS ( ${ctx.dateTable} )` : null,
      `REMOVEFILTERS ( ${d} )`,
    ].filter(Boolean) as string[];
    const start = ctx.dateTableColumn ? `MIN ( ${ctx.dateTableColumn} )` : `MIN ( ${d} )`;
    return `VAR __periodStart${n} = ${start}\nRETURN\n    ${fn("COUNTROWS", [
      fn("FILTER", [
        fn("VALUES", [ent]),
        `NOT ISBLANK ( ${ent} )\n    && ${fn("CALCULATE", [`MIN ( ${d} )`, ...removers])} >= __periodStart${n}`,
      ]),
    ]).replace(/\n/g, "\n    ")}`;
  }
  // Closing balance: evaluate on the latest visible date. The `snap = __latest`
  // filter replaces any filter on that column, but __latest lies inside it.
  const snap = ctx.col(e.atLatest);
  const n = ++st.vars;
  return `VAR __latest${n} = MAX ( ${snap} )\nRETURN\n    ${fn("CALCULATE", [exprDax(e.expr, ctx, st), `${snap} = __latest${n}`]).replace(/\n/g, "\n    ")}`;
}

export interface TimeIntelMeasure {
  suffix: string;
  expression: string;
  /** A relative change, formatted as a percentage. */
  percent: boolean;
  /** A change in percentage points (the difference of two rates, × 100). */
  points?: boolean;
  description: string;
}

/** Power BI format string for a change in percentage points (2.3 → "+2.3 pp"). */
export const POINTS_FORMAT = "+0.0 pp;-0.0 pp;0.0 pp";

/**
 * The change of a rate between [m] and an earlier [prev], in percentage points
 * (42% vs 40% is 2.0); blank when either is blank, as subtracting a blank would
 * return the current rate as the change.
 */
function pointsChange(m: string, prev: string): string {
  return `VAR __current = ${m}\nVAR __previous = ${prev}\nRETURN\n    IF ( NOT ISBLANK ( __current ) && NOT ISBLANK ( __previous ), ( __current - __previous ) * 100 )`;
}

/**
 * Standard time-intelligence variants for a base measure (needs a marked Date table).
 * YoY % and MoM % reference [<base> PY] and [<base> PM] by name, so those
 * variants must be emitted under exactly those names. A `rate` (a percent
 * KPI) gets YoY pp and MoM pp instead: the change in percentage points, as
 * Loupe's cards show it, not a relative change. The 7-day moving average
 * (additive measures only) divides the trailing seven days' total by 7, like
 * the in-app value (kpi/compute.ts, "ma7"), so a day with no rows counts as
 * zero; AVERAGEX over the dates would skip such days and overstate the average.
 */
export function timeIntelligence(
  base: string,
  additive: boolean,
  dateCol: string,
  rate = false,
): TimeIntelMeasure[] {
  const m = daxMeasureName(base);
  const py = daxMeasureName(`${base} PY`);
  const pm = daxMeasureName(`${base} PM`);
  const out: TimeIntelMeasure[] = [
    {
      suffix: "MTD",
      expression: fn("TOTALMTD", [m, dateCol]),
      percent: false,
      description: "Month to date.",
    },
    {
      suffix: "QTD",
      expression: fn("TOTALQTD", [m, dateCol]),
      percent: false,
      description: "Quarter to date.",
    },
    { suffix: "YTD", expression: fn("TOTALYTD", [m, dateCol]), percent: false, description: "Year to date." },
    {
      suffix: "PY",
      expression: fn("CALCULATE", [m, fn("SAMEPERIODLASTYEAR", [dateCol])]),
      percent: false,
      description: "Same period last year.",
    },
    rate
      ? {
          suffix: "YoY pp",
          expression: pointsChange(m, py),
          percent: false,
          points: true,
          description: "Change vs same period last year, in percentage points.",
        }
      : {
          suffix: "YoY %",
          expression: fn("DIVIDE", [`${m} - ${py}`, py]),
          percent: true,
          description: "Change vs same period last year.",
        },
    {
      suffix: "PM",
      expression: fn("CALCULATE", [m, fn("DATEADD", [dateCol, "-1", "MONTH"])]),
      percent: false,
      description: "Previous month.",
    },
    rate
      ? {
          suffix: "MoM pp",
          expression: pointsChange(m, pm),
          percent: false,
          points: true,
          description: "Change vs previous month, in percentage points.",
        }
      : {
          suffix: "MoM %",
          expression: fn("DIVIDE", [`${m} - ${pm}`, pm]),
          percent: true,
          description: "Change vs previous month.",
        },
    {
      suffix: "Rolling 30D",
      expression: fn("CALCULATE", [m, fn("DATESINPERIOD", [dateCol, `MAX ( ${dateCol} )`, "-30", "DAY"])]),
      percent: false,
      description: "Trailing 30 days.",
    },
    {
      suffix: "Rolling 90D",
      expression: fn("CALCULATE", [m, fn("DATESINPERIOD", [dateCol, `MAX ( ${dateCol} )`, "-90", "DAY"])]),
      percent: false,
      description: "Trailing 90 days.",
    },
  ];
  if (additive) {
    out.push({
      suffix: "7D Moving Avg",
      expression: fn("DIVIDE", [
        fn("CALCULATE", [m, fn("DATESINPERIOD", [dateCol, `MAX ( ${dateCol} )`, "-7", "DAY"])]),
        "7",
      ]),
      percent: false,
      description: "Average daily value over the trailing 7 days (the 7-day total divided by 7).",
    });
  }
  return out;
}
