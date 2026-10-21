/**
 * TMDL semantic model (Power BI Project / Tabular Editor). Generates the
 * `definition` folder: database, model, a parameter for the CSV path, the
 * fact table (Power Query partition, typed columns, measures with display
 * folders and format strings), a calculated Date table and the relationship.
 *
 * TMDL is indentation-sensitive (tabs here): child properties sit one level
 * below their object and multi-line expressions deeper still. Lineage tags
 * are deterministic (names.ts) so re-exports of the same model diff cleanly.
 * It follows Power BI modelling conventions: geographic columns carry their
 * data category (so maps place them), hierarchies found in the data (Category
 * → Sub-category, Region → State → City) are built in, the date-link helper
 * is hidden, and with a Date table the automatic date tables are switched off.
 * The columns a chart's axis needs from a date (an hour of day, a weekday or
 * month of another date column; readme.ts datePartColumns) are added by the
 * Power Query partition, weekday and month names sorted by their numbers, so
 * every column the Export step asked about is really in the model.
 * The model culture follows the number locale for display, but Power Query
 * always parses data.csv as en-US: the CSV is written with dot decimals and
 * ISO dates whatever the locale. The DataFile parameter defaults to a
 * placeholder path that the user must change (the README says so).
 */
import { exportKind } from "@/engine/core/booleans";
import type { Column } from "@/engine/core/types";
import type { ColumnProfile, GeoLevel, HierarchyInfo } from "@/engine/profile/types";
import { friendlyStart } from "@/engine/core/labels";
import { buildMeasures, DATE_TABLE, dateRelColumn, dateTableDax, escapeFormatLiteral } from "./daxFile";
import type { ExportContext } from "./context";
import { lineageTag } from "./names";
import { describeModel, modelSheetCount } from "@/engine/core/model";
import { datePartColumnsFor } from "./readme";

const TAB = "\t";

/** Power BI data category for each kind of geographic column, so map visuals place it correctly. */
const DATA_CATEGORY: Partial<Record<GeoLevel, string>> = {
  country: "Country",
  state: "StateOrProvince",
  city: "City",
  postal: "PostalCode",
  latitude: "Latitude",
  longitude: "Longitude",
  address: "Address",
};

/** A hierarchy's name by what it describes; any other kind is named after its top level. */
const HIERARCHY_NAME: Partial<Record<HierarchyInfo["kind"], string>> = {
  geo: "Geography",
  product: "Product hierarchy",
  organisation: "Organisation",
};

/** Object name as TMDL wants it: bare when identifier-like, else single-quoted with '' escaping. */
function tmdlName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

// Indents every non-empty line; empty lines stay empty so no trailing tabs are emitted.
function indentBlock(text: string, tabs: number): string {
  const pad = TAB.repeat(tabs);
  return text
    .split("\n")
    .map((l) => (l.length ? pad + l : l))
    .join("\n");
}

// TMDL descriptions are "///" lines directly above the object; one sentence per line keeps them readable.
function description(text: string, tabs: number): string {
  return text
    .split(/(?<=\.)\s+/)
    .map((l) => `${TAB.repeat(tabs)}/// ${l}`)
    .join("\n");
}

/**
 * Tabular data type. Dates are always dateTime; the format string decides
 * whether a time shows. A yes/no column the file spelled with words is text
 * (core/booleans.ts), so "Yes"/"No" load as they are.
 */
function dataType(col: Column): string {
  if (exportKind(col) === "string") return "string";
  switch (col.kind) {
    case "number":
      return col.format.integer ? "int64" : "double";
    case "date":
      return "dateTime";
    case "boolean":
      return "boolean";
    default:
      return "string";
  }
}

/** Power Query (M) type used when typing the CSV columns; must agree with dataType(). */
function mType(col: Column): string {
  if (exportKind(col) === "string") return "type text";
  switch (col.kind) {
    case "number":
      return col.format.integer ? "Int64.Type" : "type number";
    case "date":
      return col.timeOnly ? "type time" : col.hasTime ? "type datetime" : "type date";
    case "boolean":
      return "type logical";
    default:
      return "type text";
  }
}

/**
 * Default aggregation for a column dragged into a visual. Only additive
 * measure/currency columns sum; IDs, prices, rates and years must not, so
 * everything else is "none".
 */
function summarizeBy(p: ColumnProfile | undefined): string {
  if (!p) return "none";
  if ((p.role === "measure" || p.role === "currency") && p.additivity === "additive") return "sum";
  return "none";
}

/** Relative path (under `<modelName>.SemanticModel/`) → file text. */
export interface TmdlFiles {
  [path: string]: string;
}

/**
 * All files of the `<modelName>.SemanticModel` folder. `symbol` is the
 * trimmed currency symbol; `modelName` is the fact-table name (powerbi.ts).
 * The Date table and relationship files exist only with a primary date.
 */
export function generateTmdl(ctx: ExportContext, symbol: string, modelName: string): TmdlFiles {
  const { ds, names, profile } = ctx;
  const table = names.table;
  const files: TmdlFiles = {};
  const root = `${modelName}.SemanticModel`;
  const culture = ctx.locale === "IN" ? "en-IN" : "en-US";

  files[`${root}/definition.pbism`] = `${JSON.stringify(
    {
      $schema:
        "https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json",
      version: "4.2",
      settings: {},
    },
    null,
    2,
  )}\n`;

  files[`${root}/definition/database.tmdl`] =
    `database ${tmdlName(modelName)}\n${TAB}compatibilityLevel: 1567\n`;

  // discourageImplicitMeasures steers report authors to the explicit measures
  // instead of implicit aggregations of raw columns.
  files[`${root}/definition/model.tmdl`] = [
    "model Model",
    `${TAB}culture: ${culture}`,
    `${TAB}defaultPowerBIDataSourceVersion: powerBI_V3`,
    `${TAB}discourageImplicitMeasures`,
    `${TAB}sourceQueryCulture: en-US`,
    `${TAB}dataAccessOptions`,
    `${TAB}${TAB}legacyRedirects`,
    `${TAB}${TAB}returnErrorValuesAsNull`,
    "",
    // With its own Date table the model needs no hidden auto date tables (Options → Auto date/time);
    // without one they stay on, as the README then relies on each date's own hierarchy.
    ...(ctx.dateColumn ? [`${TAB}annotation __PBI_TimeIntelligenceEnabled = 0`, ""] : []),
    `ref table ${tmdlName(table)}`,
    ...(ctx.dateColumn ? [`ref table ${tmdlName(DATE_TABLE)}`] : []),
    "",
  ].join("\n");

  files[`${root}/definition/expressions.tmdl`] = [
    `/// Full path to data.csv on your machine. Change it once after extracting the package.`,
    `expression DataFile = "C:\\Loupe\\data.csv" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]`,
    `${TAB}lineageTag: ${lineageTag(`${modelName}:DataFile`)}`,
    "",
    `${TAB}annotation PBI_ResultType = Text`,
    "",
  ].join("\n");

  // ---------------- fact table
  const model = ds.source.model;
  const lines: string[] = [
    // A workbook read as joined sheets is exported as that one joined table; its description says so.
    ...(model
      ? [
          description(
            `Joined in Loupe from ${modelSheetCount(model)} sheets of ${ds.source.fileName}: ${describeModel(model)}. Every ${model.fact} row is kept once.`,
            0,
          ),
        ]
      : []),
    `table ${tmdlName(table)}`,
    `${TAB}lineageTag: ${lineageTag(`${modelName}:${table}`)}`,
    "",
  ];
  for (const m of buildMeasures(ctx, symbol)) {
    lines.push(description(m.description, 1));
    lines.push(`${TAB}measure ${tmdlName(m.name)} =`);
    lines.push(indentBlock(m.expression, 3));
    lines.push(`${TAB}${TAB}formatString: ${m.format}`);
    lines.push(`${TAB}${TAB}displayFolder: ${m.folder}`);
    if (m.hidden) lines.push(`${TAB}${TAB}isHidden`);
    lines.push(`${TAB}${TAB}lineageTag: ${lineageTag(`${modelName}:measure:${m.id}`)}`);
    lines.push("");
  }
  const hidden = new Set(ctx.hiddenColumns ?? []);
  for (const col of ds.columns) {
    const clean = names.columns.get(col.name) ?? col.name;
    const p = profile.columns.find((c) => c.name === col.name);
    // A column hidden in Loupe stays in the table (it is the user's reference) but is hidden in the report view too.
    if (hidden.has(col.name))
      lines.push(
        description(
          `Hidden in Loupe: kept as a reference, not used by any measure. Source column: ${col.name}.`,
          1,
        ),
      );
    else if (p?.roleReason) lines.push(description(`${p.roleReason} Source column: ${col.name}.`, 1));
    lines.push(`${TAB}column ${tmdlName(clean)}`);
    lines.push(`${TAB}${TAB}dataType: ${dataType(col)}`);
    if (hidden.has(col.name)) lines.push(`${TAB}${TAB}isHidden`);
    if (col.kind === "date")
      lines.push(
        `${TAB}${TAB}formatString: ${col.timeOnly ? "Long Time" : col.hasTime ? "General Date" : "Long Date"}`,
      );
    else if (col.kind === "number" && p?.role === "currency")
      lines.push(`${TAB}${TAB}formatString: ${escapeFormatLiteral(symbol)}#,0.00`);
    else if (col.kind === "number" && col.format.integer) lines.push(`${TAB}${TAB}formatString: 0`);
    const category = p?.geoLevel ? DATA_CATEGORY[p.geoLevel] : undefined;
    if (category) lines.push(`${TAB}${TAB}dataCategory: ${category}`);
    lines.push(`${TAB}${TAB}lineageTag: ${lineageTag(`${modelName}:col:${clean}`)}`);
    lines.push(`${TAB}${TAB}summarizeBy: ${summarizeBy(p)}`);
    lines.push(`${TAB}${TAB}sourceColumn: ${clean}`);
    lines.push("");
    // Marks summarizeBy as a deliberate choice rather than Desktop's automatic default.
    lines.push(`${TAB}${TAB}annotation SummarizationSetBy = User`);
    lines.push("");
  }
  // A datetime primary date gets a date-only "<column>_day" copy (added in the
  // M query below): the relationship needs values that match the Date table's
  // midnight dates exactly.
  const rel = ctx.dateColumn ? dateRelColumn(ctx) : "";
  const dateClean = ctx.dateColumn ? (names.columns.get(ctx.dateColumn) ?? ctx.dateColumn) : "";
  const needsDay = Boolean(ctx.dateColumn && rel !== dateClean);
  if (needsDay) {
    lines.push(description(`Date-only copy of ${dateClean} used for the relationship to the Date table.`, 1));
    lines.push(`${TAB}column ${tmdlName(rel)}`);
    lines.push(`${TAB}${TAB}dataType: dateTime`);
    lines.push(`${TAB}${TAB}formatString: Long Date`);
    // Plumbing for the relationship: report authors slice by the Date table instead.
    lines.push(`${TAB}${TAB}isHidden`);
    lines.push(`${TAB}${TAB}lineageTag: ${lineageTag(`${modelName}:col:${rel}`)}`);
    lines.push(`${TAB}${TAB}summarizeBy: none`);
    lines.push(`${TAB}${TAB}sourceColumn: ${rel}`);
    lines.push("");
  }
  // Date parts the charts use as an axis (an hour, another date column's weekday or month): added
  // in Power Query below, so the visuals can be built straight away; none when the user said no.
  const parts = datePartColumnsFor(ctx, ctx.specs);
  for (const p of parts) {
    lines.push(description(`${p.holds} Added for the dashboard's charts.`, 1));
    lines.push(`${TAB}column ${tmdlName(p.name)}`);
    lines.push(`${TAB}${TAB}dataType: ${p.type === "number" ? "int64" : "string"}`);
    if (p.type === "number") lines.push(`${TAB}${TAB}formatString: 0`);
    lines.push(`${TAB}${TAB}lineageTag: ${lineageTag(`${modelName}:col:${p.name}`)}`);
    lines.push(`${TAB}${TAB}summarizeBy: none`);
    lines.push(`${TAB}${TAB}sourceColumn: ${p.name}`);
    if (p.sortBy) lines.push(`${TAB}${TAB}sortByColumn: ${tmdlName(p.sortBy)}`);
    lines.push("");
    lines.push(`${TAB}${TAB}annotation SummarizationSetBy = User`);
    lines.push("");
  }
  // Clean names are snake_case ASCII, so they need no escaping inside M string
  // literals or [field] access. QuoteStyle.Csv allows line breaks inside
  // quoted fields; types are parsed with the en-US culture to match the CSV.
  const typed = ds.columns.map((c) => `{"${names.columns.get(c.name) ?? c.name}", ${mType(c)}}`).join(", ");
  // Each added column is one step on the last, named as Power Query names its own ("Added …").
  const steps: Array<[string, string]> = [];
  let last = "Typed";
  if (needsDay) {
    steps.push([
      "WithDay",
      `Table.AddColumn(${last}, "${rel}", each DateTime.Date([${dateClean}]), type date)`,
    ]);
    last = "WithDay";
  }
  for (const p of parts) {
    const step = `#"Added ${p.name}"`;
    steps.push([
      step,
      `Table.AddColumn(${last}, "${p.name}", each ${p.m}, ${p.type === "number" ? "Int64.Type" : "type text"})`,
    ]);
    last = step;
  }
  const m = [
    "let",
    `    Source = Csv.Document(File.Contents(DataFile), [Delimiter=",", Columns=${ds.columns.length}, Encoding=65001, QuoteStyle=QuoteStyle.Csv]),`,
    `    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars=true]),`,
    `    Typed = Table.TransformColumnTypes(Promoted, {${typed}}, "en-US")${steps.length ? "," : ""}`,
    ...steps.map(([name, expr], i) => `    ${name} = ${expr}${i < steps.length - 1 ? "," : ""}`),
    "in",
    `    ${last}`,
  ].join("\n");
  // Hierarchies found in the data (coarse → fine), for drill-down in any visual; none that uses a hidden column.
  const hierarchyNames = new Set<string>();
  for (const h of profile.hierarchies) {
    if (h.levels.length < 2 || h.levels.some((l) => hidden.has(l) || !names.columns.has(l))) continue;
    // Names are unique in a table: a second product hierarchy is told apart by its middle level.
    const base = HIERARCHY_NAME[h.kind] ?? `${friendlyStart(h.levels[0] as string)} hierarchy`;
    let name = hierarchyNames.has(base.toLowerCase())
      ? `${base} (${friendlyStart(h.levels[1] as string)})`
      : base;
    for (let n = 2; hierarchyNames.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    hierarchyNames.add(name.toLowerCase());
    lines.push(`${TAB}hierarchy ${tmdlName(name)}`);
    lines.push(`${TAB}${TAB}lineageTag: ${lineageTag(`${modelName}:hierarchy:${h.levels.join(">")}`)}`);
    lines.push("");
    for (const level of h.levels) {
      lines.push(`${TAB}${TAB}level ${tmdlName(friendlyStart(level))}`);
      lines.push(
        `${TAB}${TAB}${TAB}lineageTag: ${lineageTag(`${modelName}:level:${h.levels.join(">")}:${level}`)}`,
      );
      lines.push(`${TAB}${TAB}${TAB}column: ${tmdlName(names.columns.get(level) as string)}`);
      lines.push("");
    }
  }
  lines.push(`${TAB}partition ${tmdlName(table)} = m`);
  lines.push(`${TAB}${TAB}mode: import`);
  lines.push(`${TAB}${TAB}source =`);
  lines.push(indentBlock(m, 4));
  lines.push("");
  lines.push(`${TAB}annotation PBI_ResultType = Table`);
  lines.push("");
  files[`${root}/definition/tables/${table}.tmdl`] = lines.join("\n");

  // ---------------- Date table
  // A calculated table. `dataCategory: Time` plus `isKey` on Date is how TMDL
  // records "Mark as date table"; calculated-table columns reference their
  // source as [Name] with isNameInferred.
  if (ctx.dateColumn) {
    const cols: Array<[string, string, string, string?]> = [
      ["Date", "dateTime", "Long Date"],
      ["Year", "int64", "0"],
      ["Quarter", "string", ""],
      ["Month Number", "int64", "0"],
      ["Month", "string", "", "Month Number"],
      ["Year Month", "string", ""],
      ["Weekday Number", "int64", "0"],
      ["Weekday", "string", "", "Weekday Number"],
      ["Day of Month", "int64", "0"],
    ];
    const d: string[] = [
      `table ${tmdlName(DATE_TABLE)}`,
      `${TAB}lineageTag: ${lineageTag(`${modelName}:Date`)}`,
      `${TAB}dataCategory: Time`,
      "",
    ];
    for (const [name, type, format, sortBy] of cols) {
      d.push(`${TAB}column ${tmdlName(name)}`);
      d.push(`${TAB}${TAB}dataType: ${type}`);
      if (name === "Date") d.push(`${TAB}${TAB}isKey`);
      if (format) d.push(`${TAB}${TAB}formatString: ${format}`);
      d.push(`${TAB}${TAB}lineageTag: ${lineageTag(`${modelName}:Date:${name}`)}`);
      d.push(`${TAB}${TAB}summarizeBy: none`);
      d.push(`${TAB}${TAB}isNameInferred`);
      d.push(`${TAB}${TAB}sourceColumn: [${name}]`);
      if (sortBy) d.push(`${TAB}${TAB}sortByColumn: ${tmdlName(sortBy)}`);
      d.push("");
    }
    d.push(`${TAB}partition ${tmdlName(DATE_TABLE)} = calculated`);
    d.push(`${TAB}${TAB}mode: import`);
    d.push(`${TAB}${TAB}source =`);
    d.push(indentBlock(dateTableDax(table, rel), 4));
    d.push("");
    files[`${root}/definition/tables/${DATE_TABLE}.tmdl`] = d.join("\n");

    files[`${root}/definition/relationships.tmdl`] = [
      `relationship ${lineageTag(`${modelName}:rel:date`)}`,
      `${TAB}fromColumn: ${tmdlName(table)}.${tmdlName(rel)}`,
      `${TAB}toColumn: ${tmdlName(DATE_TABLE)}.${tmdlName("Date")}`,
      "",
    ].join("\n");
  }
  return files;
}
