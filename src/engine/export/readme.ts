/**
 * README for the Power BI package, including a visual-by-visual build list matching the dashboard.
 *
 * States plainly why there is no .pbix (a browser cannot honestly produce
 * Power BI Desktop's proprietary binary) and gives two setup paths: manual
 * import (any Desktop version) and the TMDL folder (PBIP / Tabular Editor).
 * The KPI table prints Loupe's whole-file values so users can check that
 * Power BI and the SQL views reproduce them.
 *
 * Axis instructions use the Date table only where it is right: it holds whole
 * days, is related to the primary date column alone, and has Year, Quarter,
 * Month, Year Month, Weekday and Day of Month columns. Anything else (an hour
 * of day, a part of another date column) needs a calculated column on the
 * data table; `newColumnsFor` lists those so the UI can ask first, and when
 * the user declines (`ctx.noNewColumns`) the README uses Power BI's own date
 * hierarchy instead or says the visual can't be built without a column.
 */
import { formatValue } from "@/engine/core/format";
import { formatRange } from "@/engine/core/dates";
import { countsByFirstDate } from "@/engine/query/expr";
import { dateBounds } from "@/engine/kpi/compute";
import type { DatePart } from "@/engine/core/dates";
import { daxColumn } from "@/engine/compile/dax";
import type { ChartKind } from "@/registry/schema";
import type { ChartSpec } from "@/engine/charts/types";
import { DATE_TABLE, dateRelColumn } from "./daxFile";
import type { ExportContext } from "./context";

/** Closest built-in (or named AppSource) Power BI visual for each Loupe chart kind. */
const PBI_VISUAL: Record<ChartKind, string> = {
  line: "Line chart",
  area: "Area chart",
  bar: "Clustered column chart",
  hbar: "Clustered bar chart",
  stackedBar: "Stacked column chart",
  donut: "Donut chart",
  treemap: "Treemap",
  scatter: "Scatter chart",
  histogram: "Clustered column chart (bins: right-click the column → New group → Bins)",
  box: "Box and whisker (AppSource visual)",
  heatmap: "Matrix with background-colour conditional formatting",
  funnel: "Funnel",
  waterfall: "Waterfall chart",
  bullet: "Bullet chart (AppSource visual)",
  cohort: "Matrix (rows: cohort month, columns: months since first order) with conditional formatting",
  bump: "Ribbon chart",
  pareto: "Line and clustered column chart: share as columns, cumulative share as a line on the same % axis",
  geoTile: "Shape map or Filled map by state (tile maps need an AppSource visual)",
  table: "Table",
  pie: "Pie chart",
  groupedBar: "Clustered column chart (the split field in Legend)",
  stackedBar100: "100% stacked column chart",
  stackedArea: "Stacked area chart",
  step: "Line chart (Format → Lines → Stepped)",
  lollipop: "Clustered bar chart with thin bars and data labels (or a lollipop AppSource visual)",
  dumbbell: "Line chart with markers and no line, or a dumbbell AppSource visual",
  bubble: "Scatter chart with the third measure in Size",
  radar: "Radar chart (AppSource visual)",
  gauge: "Gauge (the goal as Target value)",
  sunburst: "Sunburst (AppSource visual) or Decomposition tree",
  sankey: "Sankey chart (AppSource visual)",
  calendar: "Matrix (weeks × weekdays) with background-colour conditional formatting",
  bigNumber: "Card (new card visual)",
};

/**
 * Calculated columns a date part needs on the data table in Power BI (a
 * label column plus its sort column for weekday and month); empty when the
 * Date table already has the part.
 */
export function datePartNewColumns(column: string, part: DatePart, ctx: ExportContext): string[] {
  if (column === ctx.dateColumn && part !== "hour") return [];
  const clean = ctx.names.columns.get(column) ?? column;
  switch (part) {
    case "hour":
      return [`${clean}_hour`];
    case "dow":
      return [`${clean}_weekday`, `${clean}_weekday_number`];
    case "month":
      return [`${clean}_month`, `${clean}_month_number`];
    case "dom":
      return [`${clean}_day_of_month`];
  }
}

/** A column the Power BI package would add, or tell the user to add, to their data table. */
export interface NewColumn {
  /** Name the column would have. */
  name: string;
  /** Original column it is derived from. */
  source: string;
  /** Plain-language reason, for the confirmation dialog. */
  reason: string;
  /** "dateKey": links the Date table (time intelligence); "datePart": an axis for one chart. */
  kind: "dateKey" | "datePart";
}

/**
 * Every column the package would add to the user's data table for these
 * charts: the date-only helper that relates the Date table (added by the
 * package itself) and the calculated columns the README asks for. Empty
 * means the package uses only the file's own columns.
 */
export function newColumnsFor(ctx: ExportContext, specs: ChartSpec[]): NewColumn[] {
  const out: NewColumn[] = [];
  const seen = new Set<string>();
  const add = (name: string, source: string, reason: string, kind: NewColumn["kind"]) => {
    if (seen.has(name)) return;
    seen.add(name);
    out.push({ name, source, reason, kind });
  };
  if (ctx.dateColumn) {
    const rel = dateRelColumn(ctx);
    const clean = ctx.names.columns.get(ctx.dateColumn) ?? ctx.dateColumn;
    if (rel && rel !== clean)
      add(
        rel,
        ctx.dateColumn,
        `a date-only copy of ${ctx.dateColumn} (it has a time of day), so Power BI's Date table and time intelligence (YTD, prior year) can link to it`,
        "dateKey",
      );
  }
  for (const s of specs) {
    for (const axis of [s.x, s.series]) {
      if (axis?.kind !== "part") continue;
      for (const name of datePartNewColumns(axis.column, axis.part, ctx))
        add(name, axis.column, `for the chart "${s.title}" (${axis.label} of ${axis.column})`, "datePart");
    }
  }
  return out;
}

/**
 * Where a date part (hour, weekday, day of month, month of a date column)
 * comes from in Power BI, as "<column> (how to get it)". Weekday and month of
 * the primary date are Date-table columns; day of month needs a column added
 * to the Date table; an hour (the Date table holds whole days) and every part
 * of another date column need calculated columns on the fact table.
 */
export function datePartSource(column: string, part: DatePart, ctx: ExportContext): string {
  const table = ctx.names.table;
  const clean = ctx.names.columns.get(column) ?? column;
  const src = daxColumn(table, clean);
  if (column === ctx.dateColumn) {
    if (part === "dow") return `${DATE_TABLE}[Weekday] (sorted by Weekday Number)`;
    if (part === "month") return `${DATE_TABLE}[Month] (sorted by Month Number)`;
    if (part === "dom") return `${DATE_TABLE}[Day of Month]`;
  }
  if (ctx.noNewColumns) {
    // The user chose not to add columns: use what Power BI derives on its own (the
    // auto date hierarchy), or say plainly that the visual needs a column.
    if (part === "month") return `${table}[${clean}] (its date hierarchy, Month level)`;
    if (part === "dom") return `${table}[${clean}] (its date hierarchy, Day level)`;
    return `not built: ${part === "hour" ? "an hour of day" : "a weekday"} would need a new column, and you chose not to add columns`;
  }
  switch (part) {
    case "hour":
      return `${table}[${clean}_hour] (add it to ${table} as a calculated column, \`${clean}_hour = HOUR ( ${src} )\`; the Date table holds whole days, so it has no hours)`;
    case "dow":
      return `${table}[${clean}_weekday] (add calculated columns \`${clean}_weekday = FORMAT ( ${src}, "ddd" )\` and \`${clean}_weekday_number = WEEKDAY ( ${src}, 2 )\`, and sort the first by the second)`;
    case "month":
      return `${table}[${clean}_month] (add calculated columns \`${clean}_month = FORMAT ( ${src}, "MMM" )\` and \`${clean}_month_number = MONTH ( ${src} )\`, and sort the first by the second)`;
    case "dom":
      return `${table}[${clean}_day_of_month] (add it as a calculated column, \`${clean}_day_of_month = DAY ( ${src} )\`)`;
  }
}

/** Build instruction for a visual's axis, using the export names and, where it applies, the Date table. */
function axisText(spec: ChartSpec, ctx: ExportContext): string {
  const col = (name: string) => `${ctx.names.table}[${ctx.names.columns.get(name) ?? name}]`;
  switch (spec.x.kind) {
    case "time":
      if (!ctx.dateColumn) return `X axis: ${col(spec.x.column)} at month level (its date hierarchy)`;
      return spec.x.column === ctx.dateColumn
        ? `X axis: ${DATE_TABLE}[Year Month] (or the Date hierarchy at month level)`
        : `X axis: ${col(spec.x.column)} at month level (its own date hierarchy: the Date table follows the primary date, not this column)`;
    case "column":
      return `Axis / category: ${col(spec.x.column)}`;
    case "part":
      return `X axis: ${datePartSource(spec.x.column, spec.x.part, ctx)}`;
    case "bins":
      return `X axis: bins of ${spec.x.label} (New group → Bins)`;
    case "none":
      // The line after this one says how to build an analysis; anything else is a single value.
      return spec.analysis === "rfm" || spec.analysis === "cohort" || spec.analysis === "basket"
        ? "Axis: set by the analysis (next line)"
        : "No axis: one value for the whole selection";
  }
}

/**
 * README.md text. `specs` are the dashboard's visible charts in layout order;
 * they become visuals 2…n after the KPI-card row. `symbol` is the trimmed
 * currency symbol.
 */
export function generateReadme(ctx: ExportContext, specs: ChartSpec[], symbol: string): string {
  const { names, ds, domain } = ctx;
  const fmt = { locale: ctx.locale, currency: ctx.currency };
  const rel = ctx.dateColumn ? dateRelColumn(ctx) : null;
  const hero = ctx.selection.hero.map((id) => ctx.res.get(id)).filter((r) => r?.available);
  const out: string[] = [];
  out.push(`# Power BI package · ${ds.source.fileName}`);
  out.push("");
  out.push(
    `Generated by Loupe on ${ctx.generatedAt}. Domain: **${domain.name}${ctx.subDomain ? ` › ${ctx.subDomain.name}` : ""}**. ${ds.rowCount.toLocaleString("en-US")} rows, ${ds.columns.length} columns.`,
  );
  out.push("");
  out.push("## Why there is no .pbix file");
  out.push("");
  out.push(
    "A `.pbix` is a proprietary binary that only Power BI Desktop can write. A web page can't produce one honestly, so this package gives you everything needed to rebuild the dashboard in a few minutes: the cleaned data, every measure in DAX, a TMDL semantic model, and a visual-by-visual build list.",
  );
  out.push("");
  out.push("## What's inside");
  out.push("");
  out.push("| File | Purpose |");
  out.push("| --- | --- |");
  out.push(
    `| \`data.csv\` | Cleaned data. Snake_case headers, ISO dates (YYYY-MM-DD), dot decimals, UTF-8. Text cells that could run as spreadsheet formulas are prefixed with an apostrophe. |`,
  );
  out.push(
    `| \`measures.dax\` | Every KPI as a DAX measure${ctx.dateColumn ? ", plus time intelligence (YTD, prior year, YoY change)" : ""}. Paste into DAX query view. |`,
  );
  out.push(
    `| \`${names.table}.SemanticModel/\` | TMDL semantic model (tables, column types, measures with display folders and formats${ctx.dateColumn ? ", Date table, relationship" : ""}). |`,
  );
  out.push("| `kpis.sql` | The same KPIs in SQL (views), for a warehouse or DuckDB. |");
  out.push(
    "| `kpis-sql-and-dax.html` | Every KPI's SQL and DAX side by side, in colour, to read in a browser. |",
  );
  out.push("| `data-dictionary.csv` | Every column: type, semantic role, additivity, completeness. |");
  out.push("| `data-dictionary.md` | The same dictionary as a readable table. |");
  out.push("| `loupe-config.json` | Reload this exact dashboard in Loupe with the same file. |");
  if (ctx.reportTheme)
    out.push(
      `| \`loupe-theme.json\` | Your chart colours (${ctx.reportTheme.name}) as a Power BI report theme. |`,
    );
  out.push("");
  if (ctx.dateTableSkipped) {
    out.push("## No new columns");
    out.push("");
    out.push(
      `You chose not to add columns. Relating Power BI's Date table to \`${ctx.dateTableSkipped}\` needs a date-only copy of it (the column has a time of day), so this package has no Date table and no time-intelligence measures (YTD, prior year, moving averages). Every KPI measure is included, and trend visuals use \`${ctx.dateTableSkipped}\` directly.`,
    );
    out.push("");
  }
  if (ctx.hiddenColumns?.length) {
    const one = ctx.hiddenColumns.length === 1;
    const list = ctx.hiddenColumns.map((c) => `\`${ctx.names.columns.get(c) ?? c}\``).join(", ");
    out.push("## Hidden columns");
    out.push("");
    out.push(
      `You hid ${list} in Loupe. ${one ? "It stays" : "They stay"} in \`data.csv\` and the table as your reference, but no measure reads ${one ? "it" : "them"}, and the model marks ${one ? "it" : "them"} hidden so ${one ? "it stays" : "they stay"} out of the report's field list.`,
    );
    out.push("");
  }
  if (ctx.reportTheme) {
    out.push("## Colours");
    out.push("");
    out.push(
      `\`loupe-theme.json\` carries the chart colours you chose in Loupe (${ctx.reportTheme.name}). In Power BI Desktop: **View → Themes → Browse for themes**, pick \`loupe-theme.json\`, and every visual uses the same series colours, in the same order, with the same gradient for colour scales.`,
    );
    out.push("");
  }
  out.push("## Path A: any Power BI Desktop (about 5 minutes)");
  out.push("");
  out.push(
    `1. **Get data → Text/CSV →** \`data.csv\` → **Transform Data**. Rename the query to \`${names.table}\`. Check the column types match the data dictionary (dates as Date or Date/Time, amounts as Decimal), then **Close & Apply**.`,
  );
  if (ctx.dateColumn && rel) {
    const clean = names.columns.get(ctx.dateColumn) ?? ctx.dateColumn;
    if (rel !== clean)
      out.push(
        `2. In Power Query, add a date-only column: **Add Column → Custom Column**, name \`${rel}\`, formula \`DateTime.Date([${clean}])\`, type Date.`,
      );
    else out.push("2. (No extra column needed: the date column has no time component.)");
    out.push(
      `3. **Modeling → New table**, paste the Date table from the top of \`measures.dax\` (remove the leading \`//\`). Then **Table tools → Mark as date table → ${DATE_TABLE}**.`,
    );
    out.push(
      `4. **Model view:** drag \`${DATE_TABLE}[Date]\` onto \`${names.table}[${rel}]\` (one-to-many, single direction).`,
    );
    out.push(
      "5. **DAX query view:** paste all of `measures.dax`, click **Run**, then **Update model: Add new measures**. The result grid shows the hero KPIs; compare with the table below.",
    );
    out.push(
      "6. Build the visuals listed under *Dashboard layout*. Slice dates with the Date table, not the fact table's date column, so time intelligence works.",
    );
  } else {
    out.push(
      "2. **DAX query view:** paste all of `measures.dax`, Run, then **Update model: Add new measures**.",
    );
    out.push("3. Build the visuals listed under *Dashboard layout*.");
  }
  out.push("");
  out.push("## Path B: Power BI Project (PBIP) or Tabular Editor");
  out.push("");
  out.push(
    `The \`${names.table}.SemanticModel/definition\` folder is a TMDL model. Before opening it, set the \`DataFile\` parameter in \`expressions.tmdl\` to the full path of \`data.csv\`.`,
  );
  out.push("");
  out.push(
    "- **Tabular Editor 2/3:** File → Open → From Folder → select the `definition` folder, then deploy or save to your model.",
  );
  out.push(
    `- **Power BI Desktop with PBIP enabled** (Options → Preview features → *Power BI Project (.pbip) save option* and *Store semantic model using TMDL format*): save any report as \`.pbip\`, close Desktop, replace its \`*.SemanticModel/definition\` folder with this one, then reopen.`,
  );
  out.push(
    "- If Desktop reports a schema error (the PBIP format still changes between releases), Path A always works.",
  );
  out.push("");
  out.push("## KPI values to check against");
  out.push("");
  // Say which rows the values cover: the cards in Loupe show the period picked there, not the whole file.
  const spanColumn = ctx.dateColumn ?? ctx.dateTableSkipped ?? null;
  const span = spanColumn ? dateBounds(ctx.ds, spanColumn) : null;
  out.push(
    `Values over the whole file, computed by Loupe: all ${ctx.ds.rowCount.toLocaleString("en-US")} rows${span ? `, ${formatRange(span.min, span.max)}` : ""}, with no filter. That is what each measure returns in Power BI before any slicer, and what the SQL views return. The cards in Loupe show the period you picked there, so they can differ: filter the report to the same dates to compare.`,
  );
  out.push("");
  out.push("| KPI | Value | Formula |");
  out.push("| --- | --- | --- |");
  const lookup = (id: string) => ctx.res.get(id)?.variant?.expr;
  let firstDated = false;
  for (const r of hero) {
    if (!r) continue;
    const v = ctx.kpiValues.get(r.def.id);
    const mark = r.variant && countsByFirstDate(r.variant.expr, lookup) ? " †" : "";
    if (mark) firstDated = true;
    out.push(
      `| ${names.measures.get(r.def.id) ?? r.def.name}${mark} | ${formatValue(v ?? null, r.def.format, fmt)} | ${r.def.formula} |`,
    );
  }
  if (firstDated) {
    out.push("");
    out.push(
      "† Counts each customer (or other entity) once, in the period of their first-ever date. Over the whole file every one of them is new, so read it with a date slicer: it then matches the card in Loupe for the same period.",
    );
  }
  out.push("");
  out.push("## Dashboard layout (visual by visual)");
  out.push("");
  out.push(
    `**Row 1: KPI cards.** One **Card (new)** per measure: ${hero.map((r) => `\`[${names.measures.get(r?.def.id ?? "") ?? r?.def.name}]\``).join(", ")}.${
      ctx.dateColumn
        ? ` Add the matching YoY change as each card's reference label: ${hero
            .map((r) => {
              const name = names.measures.get(r?.def.id ?? "") ?? r?.def.name;
              return `\`[${name} ${r?.def.format === "percent" ? "YoY pp" : "YoY %"}]\``;
            })
            .join(", ")} (a rate changes in percentage points).`
        : ""
    }`,
  );
  out.push("");
  specs.forEach((s, i) => {
    out.push(`**${i + 2}. ${s.title}**`);
    out.push(`- Visual: ${PBI_VISUAL[s.kind]}`);
    out.push(`- ${axisText(s, ctx)}`);
    if (s.series && s.series.kind === "column")
      out.push(`- Legend / rows: ${names.table}[${names.columns.get(s.series.column) ?? s.series.column}]`);
    if (s.series && s.series.kind === "part")
      out.push(`- Rows: ${datePartSource(s.series.column, s.series.part, ctx)}`);
    out.push(`- Values: ${s.measures.map((m) => `[${names.measures.get(m.id) ?? m.label}]`).join(", ")}`);
    if (s.topN)
      out.push(
        `- Filter: Top N = ${s.topN} by ${names.measures.get(s.measures[0]?.id ?? "") ?? s.measures[0]?.label}${s.others ? ` (Loupe also shows an "Others" ${s.kind === "donut" || s.kind === "pie" ? "slice" : s.kind === "treemap" ? "tile" : "bar"}; in Power BI use a group or leave it out)` : ""}`,
      );
    if (s.minGroupRows)
      out.push(
        `- Hide groups with fewer than ${s.minGroupRows} rows (visual-level filter on a row count) to avoid small-sample noise.`,
      );
    if (s.analysis === "rfm")
      out.push(
        "- Build from the `rfm_customers` SQL view or a calculated table; segment logic is in `kpis.sql`.",
      );
    if (s.analysis === "cohort")
      out.push("- Build from the `cohort_retention` SQL view (cohort_month × months_since_first).");
    if (s.analysis === "basket")
      out.push("- Product pairs need a self-join; compute in SQL or Python and load as a separate table.");
    out.push(`- Why: ${s.reason}`);
    out.push("");
  });
  out.push("## Notes");
  out.push("");
  out.push(
    `- Currency symbol in formats: ${symbol}. Number grouping follows the model culture (${ctx.locale === "IN" ? "en-IN lakh/crore" : "en-US"}).`,
  );
  out.push(
    "- Ratio measures (AOV, rates, margins) are ratios of sums. They recompute correctly at every level of a visual; never set them to Sum.",
  );
  out.push("- Numeric columns that are prices, rates or IDs are set to *Don't summarize* in the model.");
  // What the TMDL model sets up for the report author (Path B), in the words a Power BI user knows.
  const hierarchies = ctx.profile.hierarchies.filter(
    (h) =>
      h.levels.length >= 2 &&
      h.levels.every((l) => ctx.names.columns.has(l) && !(ctx.hiddenColumns ?? []).includes(l)),
  );
  if (hierarchies.length)
    out.push(
      `- The model includes drill-down hierarchies: ${hierarchies
        .map((h) => h.levels.map((l) => `\`${names.columns.get(l)}\``).join(" → "))
        .join("; ")}.`,
    );
  if (ctx.profile.columns.some((c) => c.geoLevel))
    out.push(
      "- Geographic columns carry their data category (state, city, postal code…), so map visuals place them.",
    );
  if (ctx.dateColumn)
    out.push(
      "- *Auto date/time* is off in the model: it has its own Date table, so Power BI doesn't add a hidden date table per date column.",
    );
  for (const p of domain.pitfalls.slice(0, 4)) out.push(`- ${p}`);
  out.push("");
  return out.join("\n");
}
