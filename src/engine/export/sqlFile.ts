/**
 * Downloadable .sql: table DDL, one view per KPI, monthly time-intelligence views, analyses.
 *
 * Queries come from the same compiler (engine/compile/sql) as KpiMeta.sql and
 * the DuckDB verification queries, against the export-safe column names and
 * a lower-cased, quoted table name. A KPI that cannot be expressed in portable
 * SQL becomes a comment explaining why instead of a broken view.
 *
 * Laid out to be read: a short header (what it is, how to use it, what's
 * inside), a banner per section, one card per KPI (name and Loupe's value on
 * the rule, then what it means and how it is built) with the views grouped
 * by topic, queries laid out by prettySql, and the notes for other databases
 * at the end rather than in the way.
 *
 * The header claims only what is true, and is written last, from the views
 * actually written: its example query names the first headline KPI's own
 * view, and it counts the KPI views apart from the helper views other KPIs
 * build on (the in-app check verifies the KPI views). The values on the KPI
 * cards are Loupe's own figures at export time; the compiler's KPI queries
 * are checked on test data (DuckDB in the test suite; PostgreSQL 18 once during
 * development), never "against this dataset"; and the in-app "Verify in
 * browser" check runs them on the user's data in DuckDB. Day differences use
 * the compiler's portable (CAST(b AS DATE) - CAST(a AS DATE)) form here too,
 * so the RFM view runs on PostgreSQL as well.
 */
import { exportKind } from "@/engine/core/booleans";
import { formatValue } from "@/engine/core/format";
import { createTableSql, kpiQuery, quoteIdent } from "@/engine/compile/sql";
import { prettySql } from "@/engine/compile/sqlFormat";
import { isAdditiveExpr } from "@/engine/query/expr";
import { makeSqlContext } from "@/engine/kpi/context";
import { exportKpiIds, type ExportContext } from "./context";

/** Prefixes every line with "-- " (blank lines become a bare "--"). */
const comment = (text: string): string =>
  text
    .split("\n")
    .map((l) => `-- ${l}`.trimEnd())
    .join("\n");

/** What MySQL, SQL Server and BigQuery need changed (section 5). */
const DIALECT_NOTES = [
  "MySQL 8         DATE_TRUNC('month', x) → DATE_FORMAT(x, '%Y-%m-01');",
  "                (CAST(b AS DATE) - CAST(a AS DATE)) → DATEDIFF(b, a) (MySQL's minus does not count days);",
  "                PERCENTILE_CONT … WITHIN GROUP → not supported (use a window-function median);",
  "                quote identifiers with backticks (or SET sql_mode = 'ANSI_QUOTES');",
  "                VARCHAR needs a length (VARCHAR(255) or TEXT);",
  "                ORDER BY x DESC NULLS LAST → ORDER BY x IS NULL, x DESC.",
  "SQL Server      DATE_TRUNC('month', x) → DATETRUNC(month, x) (2022+) or DATEFROMPARTS(YEAR(x), MONTH(x), 1);",
  "                (CAST(b AS DATE) - CAST(a AS DATE)) → DATEDIFF(day, a, b) (dates cannot be subtracted);",
  "                EXTRACT(YEAR FROM x) → YEAR(x), EXTRACT(MONTH FROM x) → MONTH(x);",
  "                NOT COALESCE((x), FALSE) → CASE WHEN x THEN 1 ELSE 0 END = 0 (T-SQL has no boolean values);",
  "                GROUP BY 1 → repeat the grouped expression; BOOLEAN → BIT and compare with = 1;",
  "                TIMESTAMP → DATETIME2; VARCHAR → NVARCHAR(MAX); remove NULLS LAST;",
  "                PERCENTILE_CONT is a window function (… WITHIN GROUP (ORDER BY x) OVER ()).",
  "BigQuery        DATE_TRUNC('month', x) → DATE_TRUNC(x, MONTH) (TIMESTAMP_TRUNC(x, MONTH) for timestamps);",
  "                (CAST(b AS DATE) - CAST(a AS DATE)) → UNIX_DATE(CAST(b AS DATE)) - UNIX_DATE(CAST(a AS DATE))",
  "                (date minus date is an INTERVAL there, not a number of days);",
  "                PERCENTILE_CONT … WITHIN GROUP → PERCENTILE_CONT(x, 0.5) OVER ();",
  "                quote identifiers with backticks and prefix tables and views with a dataset;",
  "                write a quote inside a string as \\' (not ''); DOUBLE PRECISION → FLOAT64, VARCHAR → STRING.",
].join("\n");

/** Whether a variant's label tells the reader more than the formula already does. */
export const addsToFormula = (label: string, formula: string): boolean => {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9%÷×]+/g, " ")
      .trim();
  return !norm(formula).includes(norm(label));
};

/** Width of the comment rules. */
const RULE = 78;

/** A section banner: a double rule, the title, a double rule. */
const banner = (title: string): string =>
  [`-- ${"═".repeat(RULE - 3)}`, `-- ${title}`, `-- ${"═".repeat(RULE - 3)}`].join("\n");

/**
 * SQL view names from the measures' own names, as an analyst would name them:
 * "Net revenue" → kpi_net_revenue, "Gross margin %" → kpi_gross_margin_pct,
 * never an internal id ("kpi_yc_avg_mrp"). Lower snake case, unique; the
 * monthly views add "_monthly".
 */
export function viewNames(ids: string[], names: Map<string, string>): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const id of ids) {
    const base =
      (names.get(id) ?? id)
        .toLowerCase()
        .replace(/%/g, " pct ")
        .replace(/#/g, " num ")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || id;
    let view = `kpi_${base}`;
    for (let n = 2; used.has(view); n++) view = `kpi_${base}_${n}`;
    used.add(view);
    out.set(id, view);
  }
  return out;
}

/** A KPI card's title rule: "-- ── Net Revenue ──────── ₹5,36,54,021 ──". */
const cardRule = (title: string, right: string): string => {
  const head = `-- ── ${title} `;
  const tail = right ? ` ${right} ──` : "";
  return `${head}${"─".repeat(Math.max(3, RULE - head.length - tail.length))}${tail}`;
};

/** MySQL identifier: backtick-quoted with inner backticks doubled, since table names can contain spaces ("ledger lines"). */
const quoteMysqlIdent = (name: string): string => `\`${name.replace(/`/g, "``")}\``;

/**
 * Whole calendar days from `a` to `b` (midnights crossed), in the same
 * portable form the compiler emits for daysBetween and spanDays: it runs on
 * DuckDB and PostgreSQL alike, and the dialect notes cover the rest.
 */
const dayDiff = (a: string, b: string): string => `(CAST(${b} AS DATE) - CAST(${a} AS DATE))`;

/**
 * The aggregate of a KPI that compiles to a single SELECT, for reuse inside
 * another GROUP BY (the RFM view's monetary value). kpiQuery() emits such a
 * KPI as exactly `SELECT <aggregate> AS value\nFROM <table>`; anything else
 * (CTEs for per-entity or snapshot KPIs, or a future change of shape) returns
 * null, so the caller keeps its fallback instead of emitting broken SQL.
 * String literals and quoted names are ignored when looking for a nested
 * query, since they can contain any text.
 */
export function singleAggregate(query: string, table: string): string | null {
  const head = "SELECT ";
  const tail = ` AS value\nFROM ${table}`;
  if (!query.startsWith(head) || !query.endsWith(tail)) return null;
  const expr = query.slice(head.length, query.length - tail.length).trim();
  const code = expr.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
  if (!expr || /\b(?:SELECT|FROM|WITH)\b/i.test(code)) return null;
  return expr;
}

/** The complete kpis.sql text, used standalone and inside the Power BI package. */
export function generateSqlFile(ctx: ExportContext): string {
  const { ds, names, res, domain } = ctx;
  const sql = makeSqlContext(ds, ctx.mapping, res, names);
  const tableName = names.table.toLowerCase();
  const table = quoteIdent(tableName);
  const sqlCtx = { ...sql, table };
  const dateClean = ctx.dateColumn ? names.columns.get(ctx.dateColumn) : undefined;
  const fmt = { locale: ctx.locale, currency: ctx.currency };
  const parts: string[] = [];

  // 1. Table
  const cols = ds.columns.map((c) => ({
    name: names.columns.get(c.name) ?? c.name,
    type: exportKind(c),
    hasTime: c.kind === "date" ? c.hasTime : false,
    timeOnly: c.kind === "date" && c.timeOnly === true,
    integer: c.kind === "number" ? c.format.integer : false,
  }));
  parts.push(`${banner("1 · TABLE")}\n${createTableSql(table, cols)}`);
  parts.push(
    comment(
      [
        "Load data.csv from the Power BI package (header row, ISO dates, CRLF line endings):",
        `  DuckDB:     COPY ${table} FROM 'data.csv' (HEADER);`,
        `  PostgreSQL: \\copy ${table} FROM 'data.csv' WITH (FORMAT csv, HEADER true)`,
        `  MySQL:      LOAD DATA LOCAL INFILE 'data.csv' INTO TABLE ${quoteMysqlIdent(tableName)} FIELDS TERMINATED BY ',' ENCLOSED BY '"' LINES TERMINATED BY '\\r\\n' IGNORE 1 LINES;`,
        "              MySQL loads a blank cell as 0 or '' rather than NULL; where that matters, read the",
        "              column into a variable and SET col = NULLIF(@col, '').",
      ].join("\n"),
    ),
  );

  // 2. KPI views
  parts.push(banner("2 · KPIs"));
  // Grouped by topic, in the order each topic first appears, so related KPIs sit together.
  const ids = exportKpiIds(ctx);
  const topics = [...new Set(ids.map((id) => res.get(id)?.def.group ?? "Other"))];
  ids.sort(
    (a, b) =>
      topics.indexOf(res.get(a)?.def.group ?? "Other") - topics.indexOf(res.get(b)?.def.group ?? "Other"),
  );
  const views = viewNames(ids, names.measures);
  // Views as written: KPI views by id, and how many helper views other KPIs build on.
  const written = new Set<string>();
  let helpers = 0;
  let topic = "";
  for (const id of ids) {
    const r = res.get(id);
    if (!r?.available || !r.variant) continue;
    const name = names.measures.get(id) ?? r.def.name;
    const view = quoteIdent(views.get(id) ?? `kpi_${id}`);
    let body: string;
    try {
      body = prettySql(kpiQuery(r.variant.expr, sqlCtx, null));
    } catch (e) {
      parts.push(comment(`${name}: not expressible in portable SQL (${(e as Error).message})`));
      continue;
    }
    const helper = Boolean(r.def.hidden || r.dependencyOnly);
    if (helper) helpers++;
    else written.add(id);
    const v = ctx.kpiValues.get(id);
    const group = r.def.group ?? "Other";
    if (group !== topic) {
      topic = group;
      parts.push(comment(group.toUpperCase()));
    }
    parts.push(
      `${cardRule(
        `${name}${helper ? " (helper)" : ""}`,
        v !== undefined ? formatValue(v, r.def.format, fmt) : "",
      )}\n${comment(
        [
          r.def.definition,
          `Formula: ${r.def.formula}`,
          addsToFormula(r.variant.label, r.def.formula) ? `Built from: ${r.variant.label}` : "",
          r.variant.caveat ? `Caveat: ${r.variant.caveat}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      )}\nCREATE VIEW ${view} AS\n${body};`,
    );
  }

  // 3. Monthly time intelligence
  if (dateClean) {
    parts.push(
      `${banner("3 · MONTHLY")}\n${comment(
        `Month by month on ${dateClean}, with the change vs last month and vs the same month last year\n(and the year to date for KPIs that add up). LAG(value, 12) assumes every month is present.`,
      )}`,
    );
    const heroish = [...ctx.selection.hero, ...ctx.selection.supporting.slice(0, 6)];
    // The same names as the KPI views above, with "_monthly".
    const monthlyViews = viewNames(exportKpiIds(ctx), names.measures);
    for (const id of heroish) {
      const r = res.get(id);
      if (!r?.available || !r.variant) continue;
      let monthly: string;
      try {
        // No ORDER BY inside the view (SQL Server rejects it); the window functions below order by period.
        monthly = prettySql(
          kpiQuery(r.variant.expr, sqlCtx, { dateCol: quoteIdent(dateClean), grain: "month" }, false),
        );
      } catch {
        continue;
      }
      const viewName = monthlyViews.get(id) ?? `kpi_${id}`;
      const base = quoteIdent(`${viewName}_monthly_base`);
      // A rate changes in percentage points (0.42 vs 0.40 is +0.02), as on the cards and in DAX.
      const rate = r.def.format === "percent";
      const change = (lag: string, which: "mom" | "yoy") =>
        rate
          ? `value - ${lag} AS ${which}_change_pp`
          : `(value - ${lag}) * 1.0 / NULLIF(${lag}, 0) AS ${which}_change`;
      const additive = isAdditiveExpr(r.variant.expr, (k) => res.get(k)?.variant?.expr);
      parts.push(
        `${cardRule(`${names.measures.get(id) ?? r.def.name}, monthly`, "")}\nCREATE VIEW ${base} AS\n${monthly};\n\nCREATE VIEW ${quoteIdent(`${viewName}_monthly`)} AS\nSELECT\n  period,\n  value,\n  LAG(value) OVER (ORDER BY period) AS previous_month,\n  ${change("LAG(value) OVER (ORDER BY period)", "mom")},\n  LAG(value, 12) OVER (ORDER BY period) AS same_month_last_year,\n  ${change("LAG(value, 12) OVER (ORDER BY period)", "yoy")}${
          additive
            ? ",\n  SUM(value) OVER (PARTITION BY EXTRACT(YEAR FROM period) ORDER BY period) AS ytd"
            : ""
        }\nFROM ${base};${additive ? "" : `\n${comment("YTD is omitted: this KPI is a ratio, so a running sum would be wrong. Recompute it from YTD numerator and denominator instead.")}`}`,
      );
    }
  }

  // 4. Analyses
  const analyses = parts.length;
  const rfm = ctx.specs.find((s) => s.analysis === "rfm")?.analysisParams;
  if (rfm?.customer && rfm.date) {
    const c = quoteIdent(names.columns.get(rfm.customer) ?? rfm.customer);
    const d = quoteIdent(names.columns.get(rfm.date) ?? rfm.date);
    const o = rfm.order ? quoteIdent(names.columns.get(rfm.order) ?? rfm.order) : null;
    // Monetary: the monetary KPI's own aggregate, grouped per customer, when it
    // compiles to a single SELECT; otherwise (CTE-based KPI, compile failure,
    // no monetary KPI) the row count, and the view's comment says so.
    const moneyR = rfm.monetary ? res.get(rfm.monetary) : undefined;
    const moneyName = moneyR ? (names.measures.get(moneyR.def.id) ?? moneyR.def.name) : null;
    let money: string | null = null;
    if (moneyR?.available && moneyR.variant) {
      try {
        money = singleAggregate(kpiQuery(moneyR.variant.expr, sqlCtx), table);
      } catch {
        money = null;
      }
    }
    const moneyNote = money
      ? `Monetary is ${moneyName} per customer.`
      : moneyName
        ? `Monetary is the row count: ${moneyName} needs several query steps, so it cannot be grouped per customer here.`
        : "Monetary is the row count: no revenue KPI is available.";
    parts.push(
      `${cardRule("Customer segments (RFM)", "")}\n${comment(`Quintile scores; matches Loupe's recency × frequency grid. ${moneyNote}`)}\nCREATE VIEW ${quoteIdent("rfm_customers")} AS\nWITH per_customer AS (\n  SELECT ${c} AS customer,\n         MAX(${d}) AS last_order,\n         ${o ? `COUNT(DISTINCT ${o})` : "COUNT(*)"} AS frequency,\n         ${money ?? "COUNT(*)"} AS monetary\n  FROM ${table}\n  WHERE ${c} IS NOT NULL\n  GROUP BY ${c}\n),\nscored AS (\n  SELECT *,\n         ${dayDiff("last_order", `(SELECT MAX(${d}) FROM ${table})`)} AS recency_days,\n         NTILE(5) OVER (ORDER BY last_order) AS r_score,\n         NTILE(5) OVER (ORDER BY frequency) AS f_score,\n         NTILE(5) OVER (ORDER BY monetary) AS m_score\n  FROM per_customer\n)\nSELECT *,\n  CASE\n    WHEN r_score >= 4 AND f_score >= 4 THEN 'Champions'\n    WHEN r_score >= 3 AND f_score >= 3 THEN 'Loyal Customers'\n    WHEN r_score >= 4 AND f_score >= 2 THEN 'Potential Loyalists'\n    WHEN r_score = 5 AND f_score = 1 THEN 'New Customers'\n    WHEN r_score = 4 AND f_score = 1 THEN 'Promising'\n    WHEN r_score = 3 AND f_score >= 2 THEN 'Need Attention'\n    WHEN r_score = 3 AND f_score = 1 THEN 'About to Sleep'\n    WHEN r_score = 1 AND f_score >= 5 THEN 'Can''t Lose Them'\n    WHEN r_score <= 2 AND f_score >= 3 THEN 'At Risk'\n    WHEN r_score = 2 THEN 'Hibernating'\n    ELSE 'Lost'\n  END AS segment\nFROM scored;\n${comment("NTILE breaks ties arbitrarily; Loupe gives tied values the same score, so a few boundary customers can differ.")}`,
    );
  }
  const cohort = ctx.specs.find((s) => s.analysis === "cohort")?.analysisParams;
  if (cohort?.customer && cohort.date) {
    const c = quoteIdent(names.columns.get(cohort.customer) ?? cohort.customer);
    const d = quoteIdent(names.columns.get(cohort.date) ?? cohort.date);
    parts.push(
      `${cardRule("Monthly cohort retention", "")}\nCREATE VIEW ${quoteIdent("cohort_retention")} AS\nWITH first_order AS (\n  SELECT ${c} AS customer, DATE_TRUNC('month', MIN(${d})) AS cohort_month\n  FROM ${table} WHERE ${c} IS NOT NULL GROUP BY ${c}\n),\nactivity AS (\n  SELECT DISTINCT ${c} AS customer, DATE_TRUNC('month', ${d}) AS active_month\n  FROM ${table} WHERE ${c} IS NOT NULL\n),\ncohort_size AS (\n  SELECT cohort_month, COUNT(*) AS customers FROM first_order GROUP BY cohort_month\n)\nSELECT f.cohort_month,\n       (EXTRACT(YEAR FROM a.active_month) - EXTRACT(YEAR FROM f.cohort_month)) * 12\n         + EXTRACT(MONTH FROM a.active_month) - EXTRACT(MONTH FROM f.cohort_month) AS months_since_first,\n       COUNT(*) AS active_customers,\n       COUNT(*) * 1.0 / MAX(s.customers) AS retention\nFROM first_order f\nJOIN activity a ON a.customer = f.customer\nJOIN cohort_size s ON s.cohort_month = f.cohort_month\nGROUP BY 1, 2;`,
    );
  }
  if (parts.length > analyses) parts.splice(analyses, 0, banner("4 · ANALYSES"));

  // 5. Other databases
  parts.push(
    `${banner("5 · OTHER DATABASES")}\n${comment(
      ["DuckDB          As written.", "PostgreSQL 12+  As written.", DIALECT_NOTES].join("\n"),
    )}`,
  );

  // The header, last, so it describes the views as written: the example is the first headline
  // KPI's own view (renamed KPIs keep their names), and helper views are counted apart.
  const example = [...ctx.selection.hero, ...ids].find((id) => written.has(id));
  const kpiViews = `${written.size} ${written.size === 1 ? "view" : "views"}, one per KPI`;
  const helperViews = helpers ? `, plus ${helpers} ${helpers === 1 ? "helper view" : "helper views"}` : "";
  parts.unshift(
    [
      banner(`LOUPE · SQL for ${ds.source.fileName}`),
      comment(
        [
          `${domain.name}${ctx.subDomain ? ` › ${ctx.subDomain.name}` : ""} · ${ds.rowCount.toLocaleString("en-US")} rows · generated ${ctx.generatedAt}`,
          "",
          "How to use",
          `  1. Run section 1 to create the table, then load data.csv into it (commands below it).`,
          example
            ? `  2. Query any KPI view: SELECT * FROM ${quoteIdent(views.get(example) ?? `kpi_${example}`)};  (one view per KPI)`
            : "  2. Query the table directly: no KPI could be written as a view for this file.",
          "  3. Runs as written on DuckDB and PostgreSQL; section 5 lists the changes for other databases.",
          "",
          "Contents",
          "  1 · Table              the schema Loupe detected",
          `  2 · KPIs               ${kpiViews}, grouped by topic${helperViews}`,
          ...(dateClean
            ? ["  3 · Monthly            month by month, with change vs last month and last year"]
            : []),
          "  4 · Analyses           customer segments and retention, where the data allows",
          "  5 · Other databases    MySQL, SQL Server and BigQuery",
          "",
          "The figure on each KPI's title line is Loupe's value at export, over the whole file (not a",
          "result of these queries). Loupe's tests check that its SQL returns its own values in DuckDB,",
          "overall and by month, on test data; in the app, Export › SQL › Verify against your data",
          "runs these KPI queries on your data and compares every result.",
          ...(helpers
            ? [
                "",
                "A view marked (helper) is a building block that other KPIs reference; it is not a KPI on",
                "the dashboard, so the in-app check doesn't list it.",
              ]
            : []),
          "",
          "Ratios are ratios of sums (never averages of ratios), and NULLIF(denominator, 0) makes an",
          "empty denominator return NULL instead of an error.",
        ].join("\n"),
      ),
    ].join("\n"),
  );
  return `${parts.join("\n\n")}\n`;
}
