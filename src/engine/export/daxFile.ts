/**
 * measures.dax: a DAX-query-view script that adds every measure to the model and previews values.
 *
 * Also the single home of the measure list (buildMeasures), the Power BI
 * format strings and the Date table DAX, which tmdl.ts and readme.ts reuse,
 * so the script, the TMDL model and the README never disagree. Time
 * intelligence measures need the Date table to exist and be marked as a
 * date table; without a primary date column none are generated.
 */
import { formatValue } from "@/engine/core/format";
import {
  daxColumn,
  daxMeasureName,
  daxString,
  daxTableName,
  exprDax,
  POINTS_FORMAT,
  timeIntelligence,
  type TimeIntelMeasure,
} from "@/engine/compile/dax";
import { isAdditiveExpr } from "@/engine/query/expr";
import { makeDaxContext } from "@/engine/kpi/context";
import type { KpiFormat } from "@/registry/schema";
import { exportKpiIds, type ExportContext } from "./context";

export const DATE_TABLE = "Date";

/** Width of the comment rules in measures.dax. */
const RULE = 82;

/** Backslash-escapes each character so a currency symbol is literal in a .NET format string. */
export const escapeFormatLiteral = (s: string): string => [...s.trim()].map((ch) => `\\${ch}`).join("");

/** Power BI format string for a KPI format (no quotes, so it is safe as a raw TMDL value). */
export function pbiFormat(format: KpiFormat, currency: string, symbol: string): string {
  switch (format) {
    case "currency":
      // Rupee amounts are shown without paise; other currencies keep two decimals.
      return `${escapeFormatLiteral(symbol)}#,0${currency === "INR" ? "" : ".00"}`;
    case "percent":
      return "0.0%";
    case "integer":
      return "#,0";
    case "ratio":
      return "0.00";
    case "days":
      return "0.0";
    case "decimal":
      return "#,0.00";
    default:
      return "#,0.##";
  }
}

/**
 * Calculated Date table spanning whole calendar years (1 Jan of the first
 * year to 31 Dec of the last): DAX time intelligence needs a contiguous date
 * range that covers complete years. Weekday Number runs Monday = 1 to
 * Sunday = 7; Month and Weekday are sorted by their number columns in TMDL.
 * It is a separate calendar table, so none of its columns touch the data.
 */
export function dateTableDax(table: string, dateColumn: string): string {
  const d = daxColumn(table, dateColumn);
  return `VAR MinDate = DATE ( YEAR ( MIN ( ${d} ) ), 1, 1 )
VAR MaxDate = DATE ( YEAR ( MAX ( ${d} ) ), 12, 31 )
RETURN
    ADDCOLUMNS (
        CALENDAR ( MinDate, MaxDate ),
        "Year", YEAR ( [Date] ),
        "Quarter", "Q" & QUARTER ( [Date] ),
        "Month Number", MONTH ( [Date] ),
        "Month", FORMAT ( [Date], "MMM" ),
        "Year Month", FORMAT ( [Date], "YYYY-MM" ),
        "Weekday Number", WEEKDAY ( [Date], 2 ),
        "Weekday", FORMAT ( [Date], "ddd" ),
        "Day of Month", DAY ( [Date] )
    )`;
}

/** One model measure as written to measures.dax and the TMDL table. */
export interface MeasureDef {
  /** KPI id, or "<kpiId>__<suffix>" for a time-intelligence variant. */
  id: string;
  name: string;
  /** DAX expression; may span several lines. */
  expression: string;
  /** Display folder; a backslash nests folders ("Time intelligence\Revenue"). */
  folder: string;
  /** Power BI format string (unquoted). */
  format: string;
  description: string;
  hidden: boolean;
}

/**
 * Every measure for the model (base KPIs + time intelligence), shared by measures.dax and TMDL.
 * Base measures follow exportKpiIds() order, hidden helpers in a "Helpers"
 * folder. With a primary date, hero KPIs get every time-intelligence variant
 * and supporting KPIs only PY and the YoY change (YoY pp for a rate).
 */
export function buildMeasures(ctx: ExportContext, symbol: string): MeasureDef[] {
  const daxCtx = makeDaxContext(ctx.ds, ctx.mapping, ctx.res, ctx.names, {
    dateTable: ctx.dateColumn ? DATE_TABLE : null,
  });
  const out: MeasureDef[] = [];
  const ids = exportKpiIds(ctx);
  for (const id of ids) {
    const r = ctx.res.get(id);
    if (!r?.available || !r.variant) continue;
    const name = ctx.names.measures.get(id) ?? r.def.name;
    out.push({
      id,
      name,
      expression: exprDax(r.variant.expr, daxCtx),
      folder: r.def.hidden || r.dependencyOnly ? "Helpers" : r.def.group,
      format: pbiFormat(r.def.format, ctx.currency, symbol),
      description: `${r.def.definition} Formula: ${r.def.formula}.${r.variant.caveat ? ` Caveat: ${r.variant.caveat}` : ""}`,
      hidden: Boolean(r.def.hidden || r.dependencyOnly),
    });
  }
  if (ctx.dateColumn) {
    const dateCol = daxColumn(DATE_TABLE, "Date");
    const pick = (list: TimeIntelMeasure[], keep: string[]) => list.filter((t) => keep.includes(t.suffix));
    const add = (id: string, keep: string[] | null) => {
      const r = ctx.res.get(id);
      if (!r?.available || !r.variant) return;
      const base = ctx.names.measures.get(id) ?? r.def.name;
      // Only additive KPIs get the 7-day moving average: averaging daily values of a ratio misweights days.
      const all = timeIntelligence(
        base,
        isAdditiveExpr(r.variant.expr, (k) => ctx.res.get(k)?.variant?.expr),
        dateCol,
        r.def.format === "percent",
      );
      for (const t of keep ? pick(all, keep) : all) {
        out.push({
          id: `${id}__${t.suffix}`,
          name: `${base} ${t.suffix}`,
          expression: t.expression,
          folder: `Time intelligence\\${base}`,
          format: t.points
            ? POINTS_FORMAT
            : t.percent
              ? "+0.0%;-0.0%;0.0%"
              : pbiFormat(r.def.format, ctx.currency, symbol),
          description: t.description,
          hidden: false,
        });
      }
    };
    for (const id of ctx.selection.hero) add(id, null);
    for (const id of [...ctx.selection.supporting, ...ctx.selection.columns])
      add(id, ["PY", "YoY %", "YoY pp"]);
  }
  return out;
}

/**
 * The measures.dax text, laid out to be read: a short header with numbered
 * setup steps, the Date table (commented out, to paste as a calculated
 * table), the measures grouped by topic (a banner per display folder; DAX
 * doesn't mind the order, and the model keeps buildMeasures' order), each
 * under a card with its name and Loupe's own value on the rule, then what it
 * means and its formula; and an EVALUATE ROW for side-by-side checking: the
 * hero KPIs, else the first visible measures, else the row count, so the
 * query is valid DAX whatever the dataset supports. `symbol` must already be
 * trimmed.
 */
export function generateDaxFile(ctx: ExportContext, symbol: string): string {
  const measures = buildMeasures(ctx, symbol);
  const table = daxTableName(ctx.names.table);
  const fmt = { locale: ctx.locale, currency: ctx.currency };
  const rel = dateRelColumn(ctx);
  const dateClean = ctx.dateColumn ? (ctx.names.columns.get(ctx.dateColumn) ?? ctx.dateColumn) : "";

  // What the EVALUATE at the end returns: base measures only (no time intelligence), hero KPIs first.
  const visible = measures.filter((m) => !m.hidden && !m.id.includes("__"));
  const hero = ctx.selection.hero
    .map((id) => visible.find((m) => m.id === id))
    .filter((m): m is MeasureDef => Boolean(m));
  const shown = hero.length ? hero : visible.slice(0, 6);
  const evaluated = hero.length ? "the hero KPIs" : shown.length ? "the first measures" : "the row count";

  // Numbered from what applies to this dataset, so the steps always count 1, 2, 3…
  const steps: string[][] = [[`Load data.csv as a table named ${ctx.names.table} (see README.md).`]];
  if (ctx.dateColumn) {
    if (rel !== dateClean)
      steps.push([
        `In Power Query add a date-only column ${rel} = DateTime.Date([${dateClean}]), type Date (README, Path A).`,
      ]);
    steps.push([
      "Modeling → New table → paste the Date table below (without the leading //), then",
      `Table tools → Mark as date table → Date, and relate ${DATE_TABLE}[Date] (1) → ${ctx.names.table}[${rel}] (*).`,
    ]);
  }
  steps.push([
    "Open DAX query view, paste this whole file, Run, then click “Update model: Add new measures”.",
  ]);

  const lines: string[] = [];
  const rule = (ch: string, indent = "") => `${indent}// ${ch.repeat(RULE - indent.length - 3)}`;
  lines.push(rule("═"));
  lines.push(`// LOUPE · DAX measures for ${ctx.ds.source.fileName}`);
  lines.push(rule("═"));
  lines.push(
    `// ${ctx.domain.name}${ctx.subDomain ? ` › ${ctx.subDomain.name}` : ""} · generated ${ctx.generatedAt}`,
  );
  lines.push("//");
  lines.push("// How to use (Power BI Desktop, any recent version)");
  steps.forEach(([first, ...rest], i) => {
    lines.push(`//   ${i + 1}. ${first}`);
    for (const l of rest) lines.push(`//      ${l}`);
  });
  lines.push("//");
  lines.push(`// The EVALUATE at the end returns ${evaluated}, to compare with Loupe's value on each`);
  lines.push("// measure's title line. Display folders and formats come with the TMDL model (semantic-model");
  lines.push("// folder), or can be set by hand.");
  lines.push("");
  if (ctx.dateColumn) {
    lines.push(rule("═"));
    lines.push("// DATE TABLE · Modeling → New table, then paste these lines without the leading //");
    lines.push(rule("═"));
    lines.push(`// ${DATE_TABLE} =`);
    for (const l of dateTableDax(ctx.names.table, rel).split("\n")) lines.push(`// ${l}`);
    lines.push("");
  }
  // DEFINE needs at least one definition, so it is left out when there is no measure at all.
  if (measures.length) {
    lines.push(rule("═"));
    lines.push("// MEASURES");
    lines.push(rule("═"));
    lines.push("DEFINE");
  }
  // Grouped by topic, in the order each first appears; DAX resolves measures in any order.
  const folders = [...new Set(measures.map((m) => m.folder))];
  const grouped = [...measures].sort((a, b) => folders.indexOf(a.folder) - folders.indexOf(b.folder));
  let folder = "";
  for (const m of grouped) {
    if (m.folder !== folder) {
      folder = m.folder;
      lines.push("");
      lines.push(`    // ${folder.replace(/\\/g, " › ").toUpperCase()}`);
    }
    const v = ctx.kpiValues.get(m.id);
    const r = ctx.res.get(m.id);
    const value = v !== undefined && r ? formatValue(v, r.def.format, fmt) : "";
    const head = `    // ── ${m.name} `;
    const tail = value ? ` ${value} ──` : "";
    lines.push("");
    lines.push(`${head}${"─".repeat(Math.max(3, RULE - head.length - tail.length))}${tail}`);
    if (r) {
      lines.push(`    // ${r.def.definition}`);
      lines.push(`    // Formula: ${r.def.formula}`);
      if (r.variant?.caveat) lines.push(`    // Caveat: ${r.variant.caveat}`);
    } else lines.push(`    // ${m.description}`);
    const expr = m.expression.split("\n");
    if (expr.length === 1) lines.push(`    MEASURE ${table}${daxMeasureName(m.name)} = ${expr[0]}`);
    else {
      lines.push(`    MEASURE ${table}${daxMeasureName(m.name)} =`);
      for (const l of expr) lines.push(`        ${l}`);
    }
  }
  lines.push("");
  lines.push("EVALUATE");
  if (shown.length) {
    lines.push(
      `    ROW (\n${shown.map((m) => `        ${daxString(m.name)}, ${daxMeasureName(m.name)}`).join(",\n")}\n    )`,
    );
  } else {
    // ROW needs at least one name/value pair; the row count is always defined.
    lines.push(`    // Loupe row count: ${formatValue(ctx.ds.rowCount, "integer", fmt)}`);
    lines.push(`    ROW ( "Rows", COUNTROWS ( ${table} ) )`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Column used for the Date relationship: the primary date column itself, or,
 * when it has a time of day, a date-only copy named "<column>_day". If that
 * name is already a column or a measure (compared case-insensitively, as
 * Power BI does), "_day_2", "_day_3"… is used instead. "" without a date.
 */
export function dateRelColumn(ctx: ExportContext): string {
  if (!ctx.dateColumn) return "";
  const clean = ctx.names.columns.get(ctx.dateColumn) ?? ctx.dateColumn;
  const col = ctx.ds.columns.find((c) => c.name === ctx.dateColumn);
  if (!(col && col.kind === "date" && col.hasTime)) return clean;
  const taken = new Set(
    [...ctx.names.columns.values(), ...ctx.names.measures.values()].map((n) => n.toLowerCase()),
  );
  let name = `${clean}_day`;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${clean}_day_${i}`;
  return name;
}
