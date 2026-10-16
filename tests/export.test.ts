/**
 * Export files for the e-commerce demo (src/engine/export), produced through
 * the same Session the worker uses: the SQL file (portable day differences,
 * an honest header, a quoted MySQL table, views that run in DuckDB), the DAX
 * script (consecutive setup steps, a valid EVALUATE in every case, a
 * collision-free date-only column), the README's date-part mapping, the
 * Power BI zip's contents and its "no .pbix" statement, and the CSV
 * formula-injection guard.
 */
import { afterAll, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { DuckDBConnection } from "@duckdb/node-api";
import { Session } from "@/engine/session";
import type { Dataset, StringColumn, NumberColumn } from "@/engine/core/types";
import type { ExportContext } from "@/engine/export/context";
import { generateSqlFile, singleAggregate } from "@/engine/export/sqlFile";
import { dateRelColumn, generateDaxFile } from "@/engine/export/daxFile";
import { datePartSource, generateReadme } from "@/engine/export/readme";
import { generateTmdl } from "@/engine/export/tmdl";
import { datasetToCsv, guardCell, tableToCsv } from "@/engine/export/csv";
import { close, loadIntoDuckDB } from "./helpers/duck";

const session = new Session();
const load = session.ingestSample("ecommerce");
if (load.status !== "ok") throw new Error("demo did not load");
const top = load.detection.candidates[0];
if (!top) throw new Error("demo was not detected");
const ctx = session.configure({ domainId: top.domainId, numberLocale: "IN", currency: null });
// The snapshot every generator reads; private on Session, read here to derive edge cases from real data.
const exportContext = (): ExportContext =>
  (session as unknown as { exportContext(): ExportContext }).exportContext();

/** The numbers of the "//   n. …" setup steps at the top of a DAX file. */
const stepNumbers = (dax: string): number[] =>
  [...dax.matchAll(/^\/\/ {3}(\d+)\. /gm)].map((m) => Number(m[1]));
const consecutive = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

const connections: DuckDBConnection[] = [];
afterAll(() => connections.forEach(close));

describe("SQL file", () => {
  const sql = session.exportSql();

  it("uses portable day differences, never DuckDB's DATE_DIFF", () => {
    expect(sql).not.toContain("DATE_DIFF");
    expect(sql).toContain(
      `(CAST((SELECT MAX("order_date") FROM "orders") AS DATE) - CAST(last_order AS DATE)) AS recency_days`,
    );
  });

  it("claims only what is true", () => {
    expect(sql).not.toMatch(/executed against this dataset/i);
    expect(sql).not.toMatch(/runs as-is/i);
    expect(sql).toContain("Loupe's value at export");
    // Names the control as the app shows it.
    expect(sql).toMatch(/Verify against your data/);
    // Dialect notes for the portable forms.
    expect(sql).toContain("(CAST(b AS DATE) - CAST(a AS DATE)) → DATEDIFF(b, a)");
    expect(sql).toContain("(CAST(b AS DATE) - CAST(a AS DATE)) → DATEDIFF(day, a, b)");
    expect(sql).toMatch(/BigQuery {8}/);
  });

  it("quotes the table in the MySQL load hint, spaces included", () => {
    expect(sql).toContain("INTO TABLE `orders` FIELDS");
    expect(sql).toMatch(/^CREATE TABLE "orders" \($/m);
    const ec = exportContext();
    const spaced = generateSqlFile({ ...ec, names: { ...ec.names, table: "Ledger lines" } });
    expect(spaced).toContain("INTO TABLE `ledger lines` FIELDS");
    expect(spaced).toContain(`COPY "ledger lines" FROM`);
  });

  it("reuses the monetary KPI's own aggregate in the RFM view", () => {
    expect(sql).toMatch(/Monetary is .+ per customer\./);
    const rfm = sql.slice(sql.indexOf(`CREATE VIEW "rfm_customers"`));
    expect(rfm).toMatch(/COALESCE\(SUM\(CASE WHEN [\s\S]+ THEN "net_amount" END\), 0\) AS monetary/);
  });

  it("finds a simple KPI's aggregate only in the exact single-SELECT shape", () => {
    const t = `"t"`;
    expect(singleAggregate(`SELECT COALESCE(SUM("x"), 0) AS value\nFROM "t"`, t)).toBe(
      `COALESCE(SUM("x"), 0)`,
    );
    // Keywords inside string literals or quoted names are data, not a nested query.
    expect(
      singleAggregate(
        `SELECT COUNT(CASE WHEN "from" IN ('SELECT x FROM y') THEN 1 END) AS value\nFROM "t"`,
        t,
      ),
    ).toBe(`COUNT(CASE WHEN "from" IN ('SELECT x FROM y') THEN 1 END)`);
    expect(
      singleAggregate(
        `WITH base AS (\n  SELECT SUM("x") AS m1\n  FROM "t"\n)\nSELECT base.m1 AS value\nFROM base`,
        t,
      ),
    ).toBeNull();
    expect(singleAggregate(`SELECT SUM("x") AS value\nFROM "other"`, t)).toBeNull();
    expect(singleAggregate(`SELECT (SELECT MAX("x") FROM "t") AS value\nFROM "t"`, t)).toBeNull();
    expect(singleAggregate(`SELECT SUM("x") AS value\nFROM "t"\nWHERE "y" > 0`, t)).toBeNull();
  });

  it("every view runs in DuckDB, the analyses included", async () => {
    const ec = exportContext();
    const conn = await loadIntoDuckDB(ec.ds, "orders", ec.names.columns);
    connections.push(conn);
    const views = sql
      .split(/;\s*(?:\n|$)/)
      .map((s) =>
        s
          .split("\n")
          .filter((l) => !l.startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter((s) => s.startsWith("CREATE VIEW"));
    expect(views.length).toBeGreaterThan(10);
    for (const v of views) await conn.run(v);
    const segments = (
      await conn.runAndReadAll(
        `SELECT segment, COUNT(*) AS n, MIN(recency_days) AS r FROM "rfm_customers" GROUP BY 1`,
      )
    ).getRowObjectsJson();
    expect(segments.length).toBeGreaterThan(3);
    for (const s of segments) expect(Number(s.r)).toBeGreaterThanOrEqual(0);
    const cohorts = (
      await conn.runAndReadAll(`SELECT COUNT(*) AS n FROM "cohort_retention"`)
    ).getRowObjectsJson();
    expect(Number(cohorts[0]?.n)).toBeGreaterThan(0);
  });
});

describe("DAX file", () => {
  const dax = session.exportDax();

  it("has a valid EVALUATE and consecutive setup steps", () => {
    expect(dax).not.toMatch(/ROW\s*\(\s*\)/);
    expect(dax).toMatch(/^EVALUATE\n {4}ROW \(\n {8}"/m);
    // Load, the date-only column (the demo's dates carry a time), the Date table, then the measures.
    expect(stepNumbers(dax)).toEqual([1, 2, 3, 4]);
    expect(dax).toMatch(
      /\/\/ {3}2\. In Power Query add a date-only column order_date_day = DateTime\.Date\(\[order_date\]\)/,
    );
  });

  it("numbers the steps consecutively without a date column too", () => {
    const noDate = generateDaxFile({ ...exportContext(), dateColumn: null }, "₹");
    const steps = stepNumbers(noDate);
    expect(steps).toEqual(consecutive(steps.length));
    expect(steps.length).toBe(2);
    expect(noDate).not.toContain("Date table");
  });

  it("falls back to valid DAX without hero KPIs, or without any measure", () => {
    const ec = exportContext();
    const noHero = generateDaxFile({ ...ec, selection: { ...ec.selection, hero: [] } }, "₹");
    expect(noHero).not.toMatch(/ROW\s*\(\s*\)/);
    expect(noHero).toMatch(/^EVALUATE\n {4}ROW \(\n {8}"[^"]+", \[[^\]]+\]/m);
    expect(noHero).toContain("returns the first measures");

    const empty = generateDaxFile(
      {
        ...ec,
        res: new Map(),
        selection: { hero: [], supporting: [], detail: [], columns: [], unavailable: [] },
      },
      "₹",
    );
    expect(empty).not.toMatch(/ROW\s*\(\s*\)/);
    expect(empty).not.toMatch(/^DEFINE$/m);
    expect(empty).toContain(`ROW ( "Rows", COUNTROWS ( 'Orders' ) )`);
  });

  it("gives a rate's YoY and MoM change in percentage points, guarded against blanks", () => {
    const ec = exportContext();
    const rates = ctx.selection.hero.filter((id) => ec.res.get(id)?.def.format === "percent");
    expect(rates.length, "the demo has a hero rate").toBeGreaterThan(0);
    for (const id of rates) {
      const name = ec.names.measures.get(id) as string;
      expect(dax).toContain(`${name} YoY pp`);
      expect(dax).toContain(`${name} MoM pp`);
      expect(dax).not.toContain(`${name} YoY %`);
    }
    // A blank prior year gives a blank change, not the current rate.
    expect(dax).toContain(
      "IF ( NOT ISBLANK ( __current ) && NOT ISBLANK ( __previous ), ( __current - __previous ) * 100 )",
    );
    const measures = Object.entries(generateTmdl(ec, "₹", "Orders"))
      .filter(([path]) => path.endsWith(".tmdl"))
      .map(([, text]) => text)
      .join("\n");
    expect(measures).toContain("formatString: +0.0 pp;-0.0 pp;0.0 pp");
    // A total still changes relative to where it was.
    expect(dax).toContain(`${ec.names.measures.get("net_revenue")} YoY %`);
  });

  it("gives the date-only column a name no other column or measure has", () => {
    const ec = exportContext();
    expect(dateRelColumn(ec)).toBe("order_date_day");
    const taken = {
      ...ec,
      names: { ...ec.names, columns: new Map([...ec.names.columns, ["Order Date Day", "Order_Date_Day"]]) },
    };
    expect(dateRelColumn(taken)).toBe("order_date_day_2");
    expect(generateDaxFile(taken, "₹")).toContain("Orders[order_date_day_2] (*)");
    const table =
      generateTmdl(taken, "₹", "Orders")["Orders.SemanticModel/definition/tables/Orders.tmdl"] ?? "";
    expect(table).toContain(`Table.AddColumn(Typed, "order_date_day_2"`);
  });
});

describe("Power BI package", () => {
  const config = JSON.stringify({ app: "loupe", test: true });
  const pkg = session.exportPowerBi(
    config,
    ctx.charts.map((c) => c.id),
  );
  const files = unzipSync(pkg.zip);
  const text = (path: string) => strFromU8(files[`loupe-powerbi/${path}`] ?? new Uint8Array());
  const readme = text("README.md");

  it("contains the expected files and no .pbix", () => {
    const model = "Orders.SemanticModel";
    const expected = [
      "README.md",
      "data.csv",
      "measures.dax",
      "kpis.sql",
      "kpis-sql-and-dax.html",
      "data-dictionary.csv",
      "data-dictionary.md",
      "loupe-config.json",
      `${model}/definition.pbism`,
      `${model}/definition/database.tmdl`,
      `${model}/definition/model.tmdl`,
      `${model}/definition/expressions.tmdl`,
      `${model}/definition/tables/Orders.tmdl`,
      `${model}/definition/tables/Date.tmdl`,
      `${model}/definition/relationships.tmdl`,
    ].map((p) => `loupe-powerbi/${p}`);
    expect(Object.keys(files).sort()).toEqual([...expected].sort());
    expect(Object.keys(files).some((p) => p.toLowerCase().endsWith(".pbix"))).toBe(false);
    expect(pkg.manifest.files.map((f) => `loupe-powerbi/${f.path}`).sort()).toEqual([...expected].sort());
    expect(text("loupe-config.json")).toBe(config);
    expect(text("kpis.sql")).toBe(session.exportSql());
    // The README's file table names every top-level file it ships with.
    for (const f of [
      "data.csv",
      "measures.dax",
      `${model}/`,
      "kpis.sql",
      "kpis-sql-and-dax.html",
      "data-dictionary.csv",
      "data-dictionary.md",
      "loupe-config.json",
    ])
      expect(readme).toContain(`\`${f}\``);
  });

  it("says which rows its check values cover, and labels a rate's card with its change in points", () => {
    expect(readme).toMatch(
      /Values over the whole file, computed by Loupe: all [\d,]+ rows, \d{1,2} \w{3} \d{4} – \d{1,2} \w{3} \d{4}, with no filter/,
    );
    expect(readme).toContain("The cards in Loupe show the period you picked there");
    expect(readme).toContain("plus time intelligence (YTD, prior year, YoY change)");
    const ec = exportContext();
    const rate = ctx.selection.hero.find((id) => ec.res.get(id)?.def.format === "percent") as string;
    expect(readme).toContain(`[${ec.names.measures.get(rate)} YoY pp]`);
    expect(readme).toContain(`[${ec.names.measures.get("net_revenue")} YoY %]`);
  });

  it("marks a KPI counted by first-ever date, which reads oddly over the whole file", () => {
    const ec = exportContext();
    // The demo's New customers is a supporting KPI; make it a hero to see it in the check table.
    const withNew = { ...ec, selection: { ...ec.selection, hero: [...ec.selection.hero, "new_customers"] } };
    const text = generateReadme(withNew, [], "₹");
    expect(text).toMatch(/\| New customers † \|/);
    expect(text).toContain("Over the whole file every one of them is new");
    expect(readme).not.toContain("†");
  });

  it("says plainly that no .pbix is produced", () => {
    expect(readme).toContain("## Why there is no .pbix file");
    expect(readme).toMatch(/A `\.pbix` is a proprietary binary that only Power BI Desktop can write/);
  });

  it("maps hour and weekday charts to the right columns", () => {
    const heat = ctx.charts.find(
      (c) =>
        c.x.kind === "part" && c.x.part === "hour" && c.series?.kind === "part" && c.series.part === "dow",
    );
    expect(heat, "the demo has a weekday × hour chart").toBeDefined();
    const block = readme.split("\n\n").find((b) => b.includes(`. ${heat?.title}**`)) ?? "";
    // Hour: the Date table holds whole days, so a calculated column on the fact table's datetime.
    expect(block).toContain(
      "- X axis: Orders[order_date_hour] (add it to Orders as a calculated column, `order_date_hour = HOUR ( 'Orders'[order_date] )`",
    );
    // Weekday of the primary date: the Date table.
    expect(block).toContain("- Rows: Date[Weekday] (sorted by Weekday Number)");
    expect(block).not.toContain("Date[Month]");
  });

  it("maps every other date part, and parts of other date columns, correctly", () => {
    const ec = exportContext();
    expect(datePartSource("Order Date", "month", ec)).toBe("Date[Month] (sorted by Month Number)");
    // Day of Month is a column of the generated Date table, so nothing is added to the data.
    expect(datePartSource("Order Date", "dom", ec)).toBe("Date[Day of Month]");
    // The Date table follows the primary date only.
    expect(datePartSource("Ship Date", "dow", ec)).toMatch(
      /^Orders\[ship_date_weekday\] \(add calculated columns `ship_date_weekday = FORMAT \( 'Orders'\[ship_date\], "ddd" \)`/,
    );
    expect(datePartSource("Ship Date", "month", ec)).toMatch(/^Orders\[ship_date_month\]/);
    expect(datePartSource("Ship Date", "hour", ec)).toMatch(/HOUR \( 'Orders'\[ship_date\] \)/);
  });
});

describe("Power BI package without new columns", () => {
  const ids = ctx.charts.map((c) => c.id);
  const config = JSON.stringify({ app: "loupe", test: true });

  it("lists every column it would add before anything is built", () => {
    const cols = session.powerBiNewColumns(ids);
    // The date-only copy for the Date table, and an hour column for the weekday × hour chart.
    expect(cols.find((c) => c.kind === "dateKey")).toMatchObject({
      name: "order_date_day",
      source: "Order Date",
    });
    expect(cols.some((c) => c.kind === "datePart" && c.name === "order_date_hour")).toBe(true);
    // Weekday, month and day of month of the primary date come from the Date table: nothing to add.
    expect(cols.some((c) => /order_date_(weekday|month|day_of_month)/.test(c.name))).toBe(false);
    // measures.dax has no visuals, so only the Date table's helper can apply.
    expect(session.powerBiNewColumns([]).map((c) => c.name)).toEqual(["order_date_day"]);
  });

  it("adds no column when the user says no", () => {
    const yes = unzipSync(session.exportPowerBi(config, ids).zip);
    const files = unzipSync(session.exportPowerBi(config, ids, true).zip);
    const text = (path: string) => strFromU8(files[`loupe-powerbi/${path}`] ?? new Uint8Array());
    const model = "loupe-powerbi/Orders.SemanticModel/definition";
    // The data itself is identical; only the helper column, Date table and relationship are left out.
    expect(text("data.csv")).toBe(strFromU8(yes["loupe-powerbi/data.csv"] ?? new Uint8Array()));
    expect(Object.keys(files)).not.toContain(`${model}/tables/Date.tmdl`);
    expect(Object.keys(files)).not.toContain(`${model}/relationships.tmdl`);
    const table = text("Orders.SemanticModel/definition/tables/Orders.tmdl");
    expect(table).not.toContain("WithDay");
    expect(table).not.toContain("order_date_day");
    const dax = text("measures.dax");
    expect(dax).not.toContain("order_date_day");
    expect(dax).not.toContain("'Date'[Date]");
    expect(stepNumbers(dax)).toEqual(consecutive(stepNumbers(dax).length));
    const readme = text("README.md");
    expect(readme).toContain("## No new columns");
    expect(readme).not.toMatch(/calculated column|Custom Column|order_date_day/);
    expect(readme).toContain("not built: an hour of day would need a new column");
    // Only what the package holds: no time intelligence to promise or to use as a card label.
    expect(readme).not.toMatch(/plus time intelligence|YoY change as each card/);
    // SQL adds nothing to the model, so its monthly views stay whatever the answer.
    expect(text("kpis.sql")).toBe(strFromU8(yes["loupe-powerbi/kpis.sql"] ?? new Uint8Array()));
    expect(text("kpis.sql")).toMatch(/_monthly|by_month/i);
  });

  it("uses Power BI's own date hierarchy for parts it can, and says when it can't", () => {
    const ec = { ...exportContext(), noNewColumns: true };
    expect(datePartSource("Ship Date", "month", ec)).toBe(
      "Orders[ship_date] (its date hierarchy, Month level)",
    );
    expect(datePartSource("Ship Date", "dom", ec)).toBe("Orders[ship_date] (its date hierarchy, Day level)");
    expect(datePartSource("Ship Date", "dow", ec)).toMatch(/^not built: a weekday would need a new column/);
    // The Date table is a separate calendar, so its columns stay available.
    expect(datePartSource("Order Date", "dow", ec)).toBe("Date[Weekday] (sorted by Weekday Number)");
  });

  it("builds the DAX file without the helper when asked", () => {
    expect(session.exportDax()).toContain("order_date_day");
    const dax = session.exportDax(true);
    expect(dax).not.toContain("order_date_day");
    expect(dax).not.toContain("Date table");
  });
});

describe("CSV formula-injection guard", () => {
  const dangerous = ["=SUM(A1)", "+cmd", "@x", "\tcalc", "\rcalc", "-2+3"];
  const safe = ["-5", "+91 98765 43210", "(1,234)", "plain text", "4.5"];

  it("neutralises cells a spreadsheet could run, and leaves numbers and phone numbers alone", () => {
    for (const v of dangerous) expect(guardCell(v), JSON.stringify(v)).toBe(`'${v}`);
    for (const v of safe) expect(guardCell(v), v).toBe(v);
  });

  it("applies in the data CSV and in chart and dictionary tables", () => {
    const notes = [...dangerous.slice(0, 4), ...safe.slice(0, 3)];
    const note: StringColumn = {
      name: "note",
      kind: "string",
      codes: Int32Array.from(notes.keys()),
      dict: notes,
    };
    const amount: NumberColumn = {
      name: "amount",
      kind: "number",
      values: Float64Array.from([1, 2, 3, 4, -5, 6, 7]),
      format: { integer: true, decimals: 0 },
    };
    const ds: Dataset = {
      id: "csv-guard",
      name: "csv-guard",
      rowCount: notes.length,
      columns: [note, amount],
      source: { fileName: "guard.csv", kind: "csv", sizeBytes: 0, isDemo: false },
    };
    expect(datasetToCsv(ds).split("\r\n")).toEqual([
      "note,amount",
      "'=SUM(A1),1",
      "'+cmd,2",
      "'@x,3",
      "'\tcalc,4",
      "-5,-5",
      "+91 98765 43210,6",
      `"(1,234)",7`,
      "",
    ]);
    // Unguarded output (DuckDB verification) keeps the raw text.
    expect(datasetToCsv(ds, { guardInjection: false }).split("\r\n")[1]).toBe("=SUM(A1),1");
    expect(
      tableToCsv(
        ["=Label", "Value"],
        [
          ["@x", 1],
          ["-5", -5],
          ["(1,234)", null],
        ],
      ).split("\r\n"),
    ).toEqual(["'=Label,Value", "'@x,1", "-5,-5", `"(1,234)",`, ""]);
  });
});

describe("Power BI modelling conventions (35.1)", () => {
  const config = JSON.stringify({ app: "loupe", test: true });
  const ids = ctx.charts.map((c) => c.id);
  const files = unzipSync(session.exportPowerBi(config, ids).zip);
  const text = (path: string) => strFromU8(files[`loupe-powerbi/${path}`] ?? new Uint8Array());
  const table = text("Orders.SemanticModel/definition/tables/Orders.tmdl");
  const model = text("Orders.SemanticModel/definition/model.tmdl");

  it("gives geographic columns their data category, so maps place them", () => {
    expect(table).toMatch(/column customer_state\n(\t\t.*\n)*?\t\tdataCategory: StateOrProvince/);
  });

  it("hides the date-link helper and turns off the automatic date tables beside its own Date table", () => {
    expect(table).toMatch(
      /column order_date_day\n\t\tdataType: dateTime\n\t\tformatString: Long Date\n\t\tisHidden/,
    );
    expect(model).toContain("annotation __PBI_TimeIntelligenceEnabled = 0");
    // Without a Date table Power BI's own date hierarchy is the fallback, so it stays on.
    const noDate = unzipSync(session.exportPowerBi(config, ids, true).zip);
    const noDateModel = strFromU8(
      noDate["loupe-powerbi/Orders.SemanticModel/definition/model.tmdl"] ?? new Uint8Array(),
    );
    expect(noDateModel).not.toContain("__PBI_TimeIntelligenceEnabled");
  });

  it("builds in the hierarchies found in the data, each with its own name", () => {
    const ec = exportContext();
    const h = ec.profile.hierarchies.find((x) => x.levels.length >= 2);
    expect(h, "the demo has a product hierarchy").toBeDefined();
    for (const level of h?.levels ?? []) expect(table).toContain(`column: ${ec.names.columns.get(level)}`);
    const names = [...table.matchAll(/^\thierarchy (.+)$/gm)].map((m) => (m[1] as string).toLowerCase());
    expect(names.length).toBeGreaterThan(1);
    // Power BI rejects two objects of one name in a table.
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("data files as an analyst expects them (35.1)", () => {
  it("keeps the file's own headers in the cleaned CSV, and the export names for SQL", () => {
    const own = new TextDecoder().decode(session.exportCsv(true, true)).split("\r\n")[0] ?? "";
    expect(own).toContain("Order Date");
    expect(own).not.toContain("order_date");
    const forSql = new TextDecoder().decode(session.exportCsv(false)).split("\r\n")[0] ?? "";
    expect(forSql).toContain("order_date");
  });

  it("gives each column a business name, unit, range, key flag and allowed values", () => {
    const csv = session.exportDictionary("csv");
    const header = csv.split("\r\n")[0] ?? "";
    for (const h of ["Business name", "Unit", "Range", "Key", "Allowed values"]) expect(header).toContain(h);
    const md = session.exportDictionary("md");
    expect(md).toContain("| Business name |");
    expect(md).toContain("## What each column means");
    // A money column states its currency and range; a date column its first and last day.
    expect(csv).toMatch(/Net Amount,[^\r\n]*,INR,"?\d/);
  });
});
