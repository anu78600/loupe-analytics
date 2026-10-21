/**
 * The glossary (/glossary): every term Loupe uses, explained for someone new
 * to data, in the words the app itself uses (docs/ANALYST-STANDARDS.md, "One
 * word for each thing": rows, insights, industry, Lowest and Highest).
 *
 * - The hand-written terms below are grouped in the order a beginner learns
 *   them (basics, numbers, time, charts, analysis methods, data quality,
 *   reports and exports), each with a level, a one-line definition, why it
 *   matters, an example and where to meet it in Loupe.
 * - The chart types come from the chart catalogue (chartGlossary) and every
 *   industry's KPIs from the registry (industryGlossary), so the glossary
 *   always describes exactly what the app draws and computes.
 *
 * Examples are illustrative, worked with round numbers; none is a figure
 * from anyone's data. tests/glossary.test.ts checks the links between terms,
 * the words and the coverage of charts and industries.
 */
import { CHART_GROUPS, CHART_TYPES } from "@/engine/charts/catalogue";
import type { DomainDef, KpiFormat } from "@/registry/schema";

export type GlossaryLevel = "beginner" | "intermediate" | "advanced";

export interface GlossaryTerm {
  /** Anchor id ("term-<id>"), and the target of other terms' `related`. */
  id: string;
  term: string;
  /** Other names for the same thing, as people meet them elsewhere. */
  aka?: string[];
  level: GlossaryLevel;
  /** One sentence: what it is. */
  short: string;
  /** Why it matters and how to read it. */
  body: string;
  /** A worked example with round, made-up numbers. */
  example?: string;
  /** Where to meet it in Loupe. */
  inLoupe?: string;
  /** Ids of related terms. */
  related?: string[];
}

export type GlossarySectionId = "basics" | "numbers" | "time" | "charts" | "methods" | "quality" | "exports";

export interface GlossarySection {
  id: GlossarySectionId;
  title: string;
  /** What the section teaches, as a step of the learning path. */
  blurb: string;
  terms: GlossaryTerm[];
}

export const GLOSSARY: GlossarySection[] = [
  {
    id: "basics",
    title: "Basics",
    blurb: "Rows, columns, KPIs and the words every dashboard uses.",
    terms: [
      {
        id: "dataset",
        term: "Dataset",
        aka: ["Table", "Data file"],
        level: "beginner",
        short: "A table of data: rows and columns, like one sheet of a spreadsheet or a CSV export.",
        body: "Everything Loupe shows starts from one dataset. It works best when every row describes one thing of the same kind (one order, one employee) and every column holds one kind of value.",
        example:
          "An export of last year's orders: one row per order line, with columns for date, product, quantity and amount.",
        inLoupe: "Upload, then Check & map › Your columns.",
        related: ["row", "column", "grain"],
      },
      {
        id: "row",
        term: "Row",
        aka: ["Record", "Line"],
        level: "beginner",
        short: "One line of the table: one order, one employee, one support ticket.",
        body: "Counting rows counts things, so it matters what one row is. Loupe always says how many rows a number covers.",
        example: "If each row is an order line, three rows can be one order of three different products.",
        related: ["grain", "count", "dataset"],
      },
      {
        id: "column",
        term: "Column",
        aka: ["Field", "Variable", "Attribute"],
        level: "beginner",
        short: "One attribute that every row has: a date, an amount, a city.",
        body: "Loupe reads each column's type (number, date, text, yes/no) and its role: a measure to add up, a category to group by, or an identifier. A column's name is its header.",
        related: ["header", "data-type", "measure", "dimension"],
      },
      {
        id: "header",
        term: "Header",
        level: "beginner",
        short: "The first row of a table, holding the column names.",
        body: "Clear headers (Order Date, Net Amount) let Loupe match columns to business fields. A file without headers gets Column 1, Column 2 and so on.",
        related: ["column", "mapping"],
      },
      {
        id: "grain",
        term: "Grain",
        aka: ["Granularity", "Level of detail"],
        level: "intermediate",
        short: "What one row stands for: “one row per order line” or “one row per employee”.",
        body: "The grain decides what can be counted. With one row per order line, counting rows counts lines, not orders; the number of orders is the distinct count of the order ID.",
        example: "An order of 3 products is 3 rows but 1 order.",
        inLoupe: "Detect says the grain it found.",
        related: ["row", "distinct-count", "unique-key"],
      },
      {
        id: "kpi",
        term: "KPI",
        aka: ["Key performance indicator"],
        level: "beginner",
        short:
          "A number chosen to show whether the business is doing well: net revenue, return rate, attrition.",
        body: "Every KPI has a definition, a formula and a direction: whether higher or lower is better. Loupe picks four to six headline KPIs for your industry and explains each one, with its SQL and DAX.",
        example: "Return rate = returned orders ÷ delivered orders. Lower is better.",
        inLoupe: "Dashboard › click a KPI card for its details.",
        related: ["metric", "direction", "headline-kpi"],
      },
      {
        id: "metric",
        term: "Metric",
        level: "beginner",
        short: "Any number you measure: a count, a total, an average, a rate.",
        body: "Every KPI is a metric, but only the few metrics you steer by are KPIs. A dashboard keeps the headline KPIs at the top and the supporting ones below.",
        related: ["kpi", "measure"],
      },
      {
        id: "headline-kpi",
        term: "Headline KPI",
        level: "beginner",
        short: "One of the four to six KPIs at the top of the dashboard: the first numbers to read.",
        body: "Loupe recommends them for your industry and data shape; you can reorder or replace them in Customise. The one-page dashboard, the slides and the report show the same ones.",
        related: ["kpi", "supporting-kpi"],
      },
      {
        id: "supporting-kpi",
        term: "Supporting KPI",
        level: "beginner",
        short: "A KPI below the headline row that explains the headline numbers.",
        body: "If net revenue is a headline KPI, average order value and discount rate support it: they say why revenue moved.",
        related: ["headline-kpi"],
      },
      {
        id: "measure",
        term: "Measure",
        aka: ["Value"],
        level: "beginner",
        short: "A number column you add up or average: amount, quantity, salary.",
        body: "Measures become KPIs and the bars and lines of charts. Some add up across rows (sales); some don't (a price, a balance).",
        related: ["dimension", "additive", "aggregation"],
      },
      {
        id: "dimension",
        term: "Dimension",
        aka: ["Category"],
        level: "beginner",
        short: "A column you group or filter by: city, channel, product category, department.",
        body: "Charts that compare categories put a dimension on one axis and a measure on the other.",
        example: "“Net revenue by state” groups the rows by state and adds up the revenue in each.",
        related: ["measure", "filter", "top-n"],
      },
      {
        id: "identifier",
        term: "Identifier",
        aka: ["ID"],
        level: "beginner",
        short: "A column that names each thing: order ID, customer ID, employee number.",
        body: "Identifiers are counted, never added up: the sum of order numbers means nothing, but the number of distinct order IDs is the number of orders.",
        related: ["distinct-count", "unique-key"],
      },
      {
        id: "data-type",
        term: "Data type",
        aka: ["Column type"],
        level: "beginner",
        short: "What a column holds: numbers, dates, text or yes/no values.",
        body: "The type decides what can be done with a column: numbers add up, dates make time axes, text becomes categories. A number stored as text has to be read as a number first.",
        related: ["column", "yes-no-column", "date-column"],
      },
      {
        id: "yes-no-column",
        term: "Yes/no column",
        aka: ["Boolean", "Flag"],
        level: "beginner",
        short: "A column with two values: Yes/No, True/False or 1/0.",
        body: "Counting the Yes values gives a count, and dividing by all the rows gives a rate. Loupe keeps your own words (Yes and No) in every export.",
        related: ["rate", "data-type"],
      },
      {
        id: "date-column",
        term: "Date column",
        level: "beginner",
        short: "A column of dates that puts rows on a time axis.",
        body: "The main date column decides the periods, the comparisons and the trends. A separate time column (20:15) is read as a time of day, never as a date.",
        related: ["period", "time-grain", "date-order"],
      },
      {
        id: "filter",
        term: "Filter",
        level: "beginner",
        short: "A rule that keeps only some rows: one city, one channel, the last 12 months.",
        body: "Every number on a filtered dashboard covers only the rows the filters keep, and Loupe says how many those are (“28,000 of 49,000 rows”).",
        related: ["slicer", "period", "cross-filter"],
      },
      {
        id: "slicer",
        term: "Slicer",
        level: "beginner",
        short: "A filter shown as a control on a report page, with its current selection in view.",
        body: "A slicer says what the page shows: All, one value, or “3 selected”.",
        inLoupe: "Dashboard › One page › the sidebar.",
        related: ["filter", "one-page-dashboard"],
      },
      {
        id: "dashboard",
        term: "Dashboard",
        level: "beginner",
        short: "A page of KPIs and charts that answers the main questions about the data at a glance.",
        body: "A good dashboard reads from top to bottom: the headline KPIs, then how they move over time, then where they come from and what drives them.",
        related: ["one-page-dashboard", "kpi"],
      },
      {
        id: "one-page-dashboard",
        term: "One-page dashboard",
        aka: ["Report page"],
        level: "beginner",
        short: "The whole dashboard on one landscape page, the way it is presented to a manager or a CEO.",
        body: "It holds the headline KPIs, five key charts with their takeaways and the key insights, with slicers down the side. Loupe opens the dashboard this way and downloads it as one image or PDF.",
        inLoupe: "Dashboard › One page › Download page.",
        related: ["dashboard", "slicer", "takeaway"],
      },
      {
        id: "takeaway",
        term: "Takeaway",
        aka: ["Chart headline"],
        level: "beginner",
        short: "The one sentence under a chart's title that says what the chart shows.",
        body: "Analysts title a slide with its conclusion, not just its subject. Loupe writes each takeaway from the chart's own numbers, and writes none when nothing can be said honestly.",
        example: "“Up 12% from January to December, ending at its peak.”",
        related: ["insight", "one-page-dashboard"],
      },
      {
        id: "insight",
        term: "Insight",
        level: "intermediate",
        short:
          "Something the data shows that is worth acting on, stated with its numbers and ranked by impact.",
        body: "Loupe looks for trends, gaps between segments, concentration, unusual days and seasonality, says how sure it is, and links each insight to a chart that shows it.",
        inLoupe: "Insights, and the strip along the foot of the one-page dashboard.",
        related: ["takeaway", "segment"],
      },
      {
        id: "business-question",
        term: "Business question",
        level: "beginner",
        short: "A question about the data in plain words: “Which region has the highest revenue?”",
        body: "Loupe answers it from your file and writes the SQL that returns the same answer. Places, statuses and periods in the question become filters; words it can't read are named, never ignored.",
        inLoupe: "Questions & SQL.",
        related: ["sql", "filter"],
      },
      {
        id: "industry",
        term: "Industry",
        aka: ["Domain", "Vertical"],
        level: "beginner",
        short: "The kind of business the data comes from: e-commerce, HR, SaaS, logistics.",
        body: "Loupe detects the industry from the column names and values, then uses that industry's KPIs, charts and words. You can change it on the Detect step.",
        inLoupe: "Detect › Industry.",
        related: ["data-shape", "mapping"],
      },
      {
        id: "data-shape",
        term: "Data shape",
        level: "intermediate",
        short:
          "Which kind of table it is within an industry: orders, returns, a product list, an employee roster.",
        body: "The shape decides the KPIs and the grain: an orders table measures sales over time, while a roster describes the people in it today.",
        related: ["industry", "roster", "grain"],
      },
      {
        id: "roster",
        term: "Roster",
        aka: ["Master list"],
        level: "intermediate",
        short:
          "A table with one row per standing thing (an employee, a customer, a product) rather than per event.",
        body: "A roster describes the current state, so there is usually no earlier period to compare with. Its dates (hire date, sign-up date) say when each row started, not when something happened.",
        example:
          "A list of all employees with their hire dates is a roster; a list of this year's hires is not.",
        related: ["data-shape", "grain"],
      },
      {
        id: "mapping",
        term: "Mapping",
        aka: ["Field mapping"],
        level: "intermediate",
        short: "Which column of your file fills which business field: “Net Amount” is the net revenue field.",
        body: "KPIs are written in business fields, so they work on any file once its columns are mapped. Loupe maps them automatically and lets you correct any of them.",
        inLoupe: "Check & map › Field mapping.",
        related: ["industry", "kpi"],
      },
    ],
  },
  {
    id: "numbers",
    title: "Numbers",
    blurb: "Totals, averages, rates and percentage points.",
    terms: [
      {
        id: "aggregation",
        term: "Aggregation",
        level: "intermediate",
        short: "Turning many rows into one number: a sum, a count, an average, the lowest or the highest.",
        body: "Every KPI and every bar of a chart is an aggregation over the rows it covers. The same column can need a different one: adding up prices is wrong, averaging them is right.",
        related: ["sum", "count", "average"],
      },
      {
        id: "sum",
        term: "Sum",
        aka: ["Total"],
        level: "beginner",
        short: "All the values added together.",
        body: "Use it for amounts that add up: sales, quantity, cost. Over no rows at all, a sum is 0.",
        example: "Sales of 100, 250 and 50 sum to 400.",
        related: ["aggregation", "additive"],
      },
      {
        id: "count",
        term: "Count",
        aka: ["Row count"],
        level: "beginner",
        short: "How many rows there are.",
        body: "Whether that is the number of orders, items or visits depends on the grain.",
        related: ["distinct-count", "grain"],
      },
      {
        id: "distinct-count",
        term: "Distinct count",
        aka: ["Unique count"],
        level: "intermediate",
        short:
          "How many different values a column has: the distinct customer IDs are the number of customers.",
        body: "Distinct counts don't add up across groups: a customer who bought in two cities counts once in each city but only once in the total. Blanks are not counted.",
        example: "Customer IDs A, B, A, C are 4 rows but 3 distinct customers.",
        related: ["count", "identifier", "non-additive"],
      },
      {
        id: "average",
        term: "Average",
        aka: ["Mean"],
        level: "beginner",
        short: "The sum divided by how many values there are.",
        body: "A few very large values pull the average up; the median is steadier then. Over no rows, an average has no value: it is blank, not 0.",
        example: "Orders of 100, 200 and 900: the average is 400.",
        related: ["median", "outlier", "weighted-average"],
      },
      {
        id: "median",
        term: "Median",
        level: "intermediate",
        short: "The middle value when they are sorted: half are below it and half above.",
        body: "Use it when a few extreme values would distort the average, as with salaries or house prices.",
        example: "For 100, 200 and 900 the median is 200, while the average is 400.",
        related: ["average", "outlier"],
      },
      {
        id: "lowest-highest",
        term: "Lowest and highest",
        aka: ["Minimum", "Maximum"],
        level: "beginner",
        short: "The smallest and the largest value.",
        body: "Loupe writes Lowest and Highest rather than Min and Max, in charts and in sentences.",
        related: ["aggregation", "outlier"],
      },
      {
        id: "ratio",
        term: "Ratio",
        level: "intermediate",
        short: "One number divided by another: revenue per order, returns per delivery.",
        body: "Loupe computes a ratio from the totals (total revenue ÷ total orders), never as an average of each row's or each group's ratio, which would give small groups too much weight.",
        example:
          "Store A: ₹900 from 3 orders. Store B: ₹100 from 1 order. Average order value is ₹1,000 ÷ 4 = ₹250, not the average of ₹300 and ₹100 (₹200).",
        related: ["weighted-average", "rate", "non-additive"],
      },
      {
        id: "rate",
        term: "Rate",
        level: "intermediate",
        short:
          "A ratio that counts something out of a whole, usually shown as a percentage: return rate, conversion rate.",
        body: "A rate needs its base: the return rate is returned orders out of delivered orders. A change in a rate is given in percentage points.",
        example: "12 returns out of 200 delivered orders is a 6% return rate.",
        related: ["percentage-point", "ratio", "conversion-rate"],
      },
      {
        id: "percentage",
        term: "Percentage",
        level: "beginner",
        short: "A share out of 100: 25% is a quarter.",
        body: "Loupe stores a percentage as a fraction (0.25) and shows it with a % sign. Each percentage keeps one decimal until it reaches 1,000%.",
        related: ["rate", "share-of-total"],
      },
      {
        id: "percentage-point",
        term: "Percentage point (pp)",
        aka: ["pp"],
        level: "intermediate",
        short: "The difference between two percentages: from 40% to 42% is +2 pp.",
        body: "Writing “+5%” for 40% → 42% would describe the change of the rate relative to itself, which confuses readers. Analysts give a change in a rate in percentage points.",
        example: "A return rate going from 8% to 6% is −2 pp (a 25% fall relative to where it was).",
        inLoupe: "KPI cards, insights, and the “YoY pp” measures in the Power BI package.",
        related: ["rate", "percent-change"],
      },
      {
        id: "percent-change",
        term: "Percentage change",
        aka: ["Growth rate", "Relative change"],
        level: "beginner",
        short: "How much a value changed compared with where it started: (new − old) ÷ old.",
        body: "From 200 to 250 is +25%. From 0 there is no percentage change, because there is nothing to divide by; Loupe shows the change “from 0” instead.",
        example: "₹2.0L to ₹2.5L is +25%.",
        related: ["absolute-change", "percentage-point"],
      },
      {
        id: "absolute-change",
        term: "Absolute change",
        level: "beginner",
        short: "The difference in the value itself: from 200 to 250 is +50.",
        body: "Absolute and percentage changes tell different stories: +50 on 200 is +25%, but +50 on 5,000 is +1%.",
        related: ["percent-change"],
      },
      {
        id: "share-of-total",
        term: "Share of total",
        aka: ["Contribution", "Mix"],
        level: "beginner",
        short: "What part of the whole one group is: Apparel is 28% of revenue.",
        body: "Only measures that add up have a share of the total. A rate or an average has none: no category “is 28% of the return rate”.",
        related: ["additive", "pareto"],
      },
      {
        id: "additive",
        term: "Additive measure",
        level: "intermediate",
        short: "A measure that adds up across groups and across time: sales, quantity, cost.",
        body: "The total is the sum of its parts, so it can be shown as shares, stacks and running totals.",
        related: ["semi-additive", "non-additive"],
      },
      {
        id: "semi-additive",
        term: "Semi-additive measure",
        aka: ["Snapshot measure"],
        level: "advanced",
        short: "A measure that adds up across groups but not across time: a balance, MRR, headcount.",
        body: "Headcount in January plus headcount in February is not the headcount of the two months. Over time you take the latest value (or the average), not the sum.",
        example: "100 employees in each month of a quarter is a headcount of 100, not 300.",
        related: ["additive", "cadence"],
      },
      {
        id: "non-additive",
        term: "Non-additive measure",
        level: "advanced",
        short: "A measure that never adds up: averages, rates, ratios, distinct counts.",
        body: "Its total has to be worked out again from the parts: the overall return rate is total returns ÷ total deliveries, not the sum or the average of each city's rate.",
        related: ["ratio", "distinct-count", "weighted-average"],
      },
      {
        id: "weighted-average",
        term: "Weighted average",
        level: "advanced",
        short: "An average in which each value counts in proportion to its size.",
        body: "A ratio of totals is a weighted average: a store with 1,000 orders weighs more than one with 10. A simple average of the stores' averages would treat them as equal.",
        related: ["ratio", "average"],
      },
      {
        id: "per-unit",
        term: "Per-unit KPI",
        aka: ["Per customer", "Per employee"],
        level: "intermediate",
        short: "A total divided by a count of things: revenue per customer, cost per hire.",
        body: "It shows efficiency rather than size, so a small business can beat a large one. Comparing it across segments needs care when one customer or employee appears in several segments.",
        related: ["ratio", "segment"],
      },
      {
        id: "compact-numbers",
        term: "Compact numbers (K, L, Cr, M)",
        level: "beginner",
        short: "Short forms for large numbers: 45.2K, ₹3.13Cr, $1.2M.",
        body: "K is a thousand. In the Indian system L (lakh) is 1,00,000 and Cr (crore) is 1,00,00,000; internationally M is a million and B a billion. Loupe writes money compactly from 1,000 and counts from 1,00,000.",
        example: "₹3,13,47,329 is ₹3.13Cr, and 1,74,867 leads are 1.75L.",
        related: ["number-grouping"],
      },
      {
        id: "number-grouping",
        term: "Number grouping",
        aka: ["Indian or international format"],
        level: "beginner",
        short: "How the digits of a number are grouped: 1,00,000 in India, 100,000 internationally.",
        body: "Choose the format in Settings; every figure in the app and its reports follows it. Exported data files keep plain numbers that other software reads.",
        related: ["compact-numbers"],
      },
      {
        id: "direction",
        term: "Direction",
        aka: ["Higher or lower is better"],
        level: "beginner",
        short: "Whether a KPI going up is good news (revenue) or bad news (the return rate).",
        body: "Loupe colours a change green when it is good for that KPI, red when it is bad, and grey when it is flat or neither.",
        related: ["kpi", "flat-change"],
      },
      {
        id: "flat-change",
        term: "Flat",
        level: "beginner",
        short: "A change too small to show: 0.0% or 0.0 pp.",
        body: "Loupe shows it in grey, never as good or bad news.",
        related: ["direction"],
      },
      {
        id: "benchmark",
        term: "Benchmark",
        level: "intermediate",
        short: "A typical range for a KPI in an industry, to judge your own figure against.",
        body: "Benchmarks vary with the market, the season and how exactly the KPI is defined, so read them as indicative, not as a rule.",
        inLoupe: "A KPI's details, where one is known; and the industry KPIs below.",
        related: ["target", "kpi"],
      },
      {
        id: "target",
        term: "Target",
        level: "beginner",
        short: "The value you aim for, such as ₹50L of revenue this month.",
        body: "Set one on a KPI and its card shows how close you are.",
        related: ["benchmark", "budget-variance"],
      },
    ],
  },
  {
    id: "time",
    title: "Time",
    blurb: "Periods, comparisons, YoY, YTD and trends.",
    terms: [
      {
        id: "period",
        term: "Period",
        level: "beginner",
        short: "The dates the numbers cover: the last 12 months, this year, a custom range.",
        body: "Every KPI and chart on the dashboard covers the same period, named at the top of the page.",
        related: ["comparison-period", "filter"],
      },
      {
        id: "comparison-period",
        term: "Comparison period",
        level: "intermediate",
        short: "The dates a change is measured against.",
        body: "For the last 12 months it is the 12 months before; for year to date it is the same months a year earlier. Loupe names it once, above the KPI cards.",
        example: "Last 12 months: Oct 2025 – Sep 2026, compared with Oct 2024 – Sep 2025.",
        related: ["yoy", "like-for-like"],
      },
      {
        id: "time-grain",
        term: "Time grain",
        aka: ["Daily", "Weekly", "Monthly"],
        level: "beginner",
        short: "How finely a trend is split: by day, week, month, quarter or year.",
        body: "Loupe picks a grain that suits the period (months for a year, days for a month), never finer than the data itself.",
        related: ["trend", "cadence"],
      },
      {
        id: "trend",
        term: "Trend",
        level: "beginner",
        short: "The overall direction of a measure over time: rising, falling or flat.",
        body: "Read a trend over complete periods: a month that is still running looks like a fall but isn't one.",
        related: ["incomplete-period", "seasonality"],
      },
      {
        id: "seasonality",
        term: "Seasonality",
        level: "intermediate",
        short: "A pattern that repeats with the calendar: festive peaks, weekend dips, year-end rushes.",
        body: "Comparing a period with the same period a year earlier (year over year) looks past it.",
        related: ["yoy", "date-part"],
      },
      {
        id: "yoy",
        term: "Year over year (YoY)",
        level: "beginner",
        short: "This period compared with the same period a year earlier.",
        body: "It takes seasonality out of the comparison: December against last December, not against November.",
        example: "₹30L this September against ₹25L last September: +20% YoY.",
        related: ["mom", "seasonality", "py"],
      },
      {
        id: "mom",
        term: "Month over month (MoM)",
        level: "beginner",
        short: "This month compared with the month before.",
        body: "It shows a turn quickly, but it is noisier than YoY because the seasons move it.",
        related: ["yoy"],
      },
      {
        id: "ytd",
        term: "Year to date (YTD)",
        aka: ["MTD", "QTD"],
        level: "beginner",
        short: "From 1 January to the latest date in the data.",
        body: "It is compared with the same days a year earlier, never with the months just before. Month to date (MTD) and quarter to date (QTD) are the same idea for a month and a quarter.",
        example: "YTD on 30 September: 1 Jan – 30 Sep this year against 1 Jan – 30 Sep last year.",
        related: ["comparison-period", "calendar-year"],
      },
      {
        id: "py",
        term: "Previous year (PY)",
        level: "beginner",
        short: "The same measure for the year before.",
        body: "In Power BI, “Revenue PY” beside “Revenue” makes the YoY change easy to read.",
        related: ["yoy", "date-table"],
      },
      {
        id: "rolling-window",
        term: "Rolling window",
        aka: ["Rolling 30 days", "Moving average"],
        level: "intermediate",
        short: "A period that moves with the latest date: the last 30 days, the last 90 days.",
        body: "A 7-day rolling average smooths out the day-to-day noise, so the trend shows through.",
        related: ["time-grain", "trend"],
      },
      {
        id: "like-for-like",
        term: "Like for like",
        level: "intermediate",
        short: "Comparing only what can fairly be compared: the same days, the same stores.",
        body: "If the data ends on 20 September, the current month is compared with the 1st to the 20th of the earlier month, not the whole of it.",
        related: ["comparison-period", "incomplete-period"],
      },
      {
        id: "incomplete-period",
        term: "Incomplete period",
        aka: ["Partial period"],
        level: "intermediate",
        short: "A period the data doesn't fully cover, such as a month that is still running.",
        body: "Its total is naturally lower, so it is never read as a fall. Loupe draws it dashed and labels where the data stops (“to 20 Sep”).",
        related: ["trend", "like-for-like"],
      },
      {
        id: "cadence",
        term: "Cadence",
        aka: ["Snapshot data"],
        level: "advanced",
        short: "How often a dataset's dates fall: every day, or once a month (monthly snapshots).",
        body: "Monthly snapshot data (MRR on the 1st of each month) can't be cut into weeks or days, so Loupe offers only the periods the data can support.",
        related: ["semi-additive", "time-grain"],
      },
      {
        id: "date-part",
        term: "Date part",
        aka: ["Day of the week", "Hour of the day"],
        level: "intermediate",
        short: "One piece of a date used as a category: the weekday, the hour, the month of the year.",
        body: "Grouping by weekday shows a weekly rhythm (busier Saturdays); grouping by hour shows the time of day people buy.",
        related: ["seasonality"],
      },
      {
        id: "calendar-year",
        term: "Calendar year",
        level: "beginner",
        short: "1 January to 31 December.",
        body: "Loupe's years and year to date are calendar years. The period slicer on the one-page dashboard lists the years in your data.",
        related: ["ytd", "slicer"],
      },
      {
        id: "date-order",
        term: "Day/month order",
        aka: ["DD/MM or MM/DD"],
        level: "intermediate",
        short: "Whether 03/04/2026 means 3 April (day first) or 4 March (month first).",
        body: "Loupe decides for the whole column from the dates that settle it (13/04 can only be 13 April). When none do, it follows your device's region and says so.",
        inLoupe: "Detect, and Check & map › File report.",
        related: ["date-column"],
      },
    ],
  },
  {
    id: "charts",
    title: "Charts",
    blurb: "Which chart answers which question, and the parts of a chart.",
    terms: [
      {
        id: "axis",
        term: "Axis",
        level: "beginner",
        short: "The scale along a chart's edge: categories or dates along one, values along the other.",
        body: "Bars start at zero on the value axis, so their lengths compare fairly. A value axis uses one unit throughout (₹0.9L, ₹1.2L, never ₹90K beside ₹1.2L).",
        related: ["dual-axis", "unit-line"],
      },
      {
        id: "series",
        term: "Series",
        level: "beginner",
        short: "One set of values drawn together: one line, or one colour of bars.",
        body: "Splitting a chart by a category gives one series per value: new and returning customers as two lines.",
        related: ["legend"],
      },
      {
        id: "legend",
        term: "Legend",
        level: "beginner",
        short: "The key that says which colour is which series.",
        body: "A chart with one series needs no legend: its title names it. A category keeps its colour in every chart.",
        related: ["series"],
      },
      {
        id: "data-label",
        term: "Data label",
        level: "beginner",
        short: "A value printed on a bar or a point.",
        body: "On a page read without hovering, labels carry the numbers. Where they would crowd each other, Loupe keeps only the ones that fit.",
        related: ["tooltip"],
      },
      {
        id: "tooltip",
        term: "Tooltip",
        level: "beginner",
        short: "The box of exact values that appears when you point at a chart.",
        body: "It shows full precision (₹3,13,47,329), while the chart shows compact numbers (₹3.13Cr).",
        related: ["data-label", "compact-numbers"],
      },
      {
        id: "unit-line",
        term: "Unit line",
        level: "beginner",
        short: "The short line under a chart's title naming its unit and grain: “In ₹ · monthly”.",
        body: "It saves the reader guessing whether the bars are rupees, counts or percentages.",
        related: ["axis", "takeaway"],
      },
      {
        id: "top-n",
        term: "Top N and Others",
        level: "intermediate",
        short: "Showing only the largest groups (the top 10) and bundling the rest as Others.",
        body: "Others is always grey and last, and never named as a leader. A chart that leaves groups out says so, and its takeaway won't name a “lowest” it can't see.",
        related: ["dimension", "pareto"],
      },
      {
        id: "drill-down",
        term: "Drill-down",
        level: "intermediate",
        short: "Clicking a bar to see its parts: from category to sub-category to product.",
        body: "Each level shows only the bar you clicked; a breadcrumb takes you back up.",
        related: ["hierarchy", "cross-filter"],
      },
      {
        id: "cross-filter",
        term: "Cross-filter",
        level: "intermediate",
        short: "Clicking a value in one chart to filter every other chart to it.",
        body: "The chart you clicked highlights the value instead of filtering itself, so the comparison stays in view.",
        related: ["filter", "drill-down"],
      },
      {
        id: "colour-scale",
        term: "Colour scale",
        level: "intermediate",
        short: "Colours that grow darker as values grow, as on a heatmap or a map of states.",
        body: "Loupe prints the values at the two ends of the scale, so a colour can be read as a number.",
        related: ["legend"],
      },
      {
        id: "dual-axis",
        term: "Dual axis",
        aka: ["Combo chart"],
        level: "advanced",
        short: "One chart with two value scales, one on each side, such as bars with a line.",
        body: "The picture depends on how the two scales happen to line up, so the lines can seem to cross or track each other by accident. Loupe never draws one; it shows the two measures side by side.",
        related: ["axis"],
      },
    ],
  },
  {
    id: "methods",
    title: "Analysis methods",
    blurb: "Cohorts, RFM, Pareto, funnels and correlation.",
    terms: [
      {
        id: "segment",
        term: "Segment",
        level: "beginner",
        short: "A group of rows that share a value: one city, one channel, one type of customer.",
        body: "Comparing segments shows where a KPI is better or worse. A segment with very few rows can look extreme by chance, so Loupe sets small groups aside.",
        related: ["dimension", "per-unit"],
      },
      {
        id: "cohort",
        term: "Cohort",
        level: "intermediate",
        short:
          "A group of customers who started in the same period: everyone whose first order was in January.",
        body: "Following each cohort month by month shows whether customers stay, and whether newer cohorts behave better than older ones.",
        related: ["retention", "churn"],
      },
      {
        id: "retention",
        term: "Retention rate",
        level: "intermediate",
        short: "The share of a group still active after some time.",
        body: "A cohort grid shows it month by month: Month-1 retention is the share who ordered again in the month after their first order.",
        example: "Of 1,000 January customers, 120 ordered again in February: 12% Month-1 retention.",
        related: ["cohort", "churn"],
      },
      {
        id: "churn",
        term: "Churn",
        level: "intermediate",
        short: "Customers, employees or revenue lost over a period.",
        body: "The churn rate is what was lost in the period ÷ what there was at its start. It mirrors retention: 5% monthly churn means 95% retained.",
        related: ["retention"],
      },
      {
        id: "rfm",
        term: "RFM segmentation",
        level: "advanced",
        short:
          "Grouping customers by Recency (how lately they bought), Frequency (how often) and Monetary value (how much).",
        body: "It finds the Champions to reward, the customers at risk to win back, and those already lost. Loupe shows each segment's share of the customers and of the revenue.",
        example: "Champions: 10% of customers, 40% of revenue.",
        related: ["segment", "pareto"],
      },
      {
        id: "pareto",
        term: "Pareto principle (80/20)",
        level: "intermediate",
        short:
          "The pattern where a few items make most of the total: about 20% of products bring about 80% of revenue.",
        body: "A Pareto chart sorts the items from the largest and draws their running share of the total.",
        related: ["concentration", "top-n"],
      },
      {
        id: "concentration",
        term: "Concentration",
        level: "intermediate",
        short: "How much of a total sits with its largest few items.",
        body: "High concentration is a risk (losing one large customer hurts) and a focus (look after the few that matter).",
        related: ["pareto"],
      },
      {
        id: "basket",
        term: "Market basket analysis",
        aka: ["Frequently bought together"],
        level: "advanced",
        short: "Finding the products bought together in the same order.",
        body: "Support is how often a pair appears; lift is how much more often than chance. Loupe names the strongest pairing and the number of orders behind it.",
        related: ["lift"],
      },
      {
        id: "lift",
        term: "Lift",
        level: "advanced",
        short: "How many times more often two things happen together than they would by chance.",
        body: "Lift above 1 means they go together; about 1, no link. A lift found in very few orders is unreliable, so read it with the order count.",
        example:
          "A lift of 3× means the pair is in the same order three times as often as if the two were unrelated.",
        related: ["basket"],
      },
      {
        id: "funnel",
        term: "Funnel",
        level: "intermediate",
        short:
          "The stages people pass through, from first contact to purchase, and how many drop off at each.",
        body: "The biggest drop between two stages is usually the best place to improve.",
        example: "10,000 visits → 1,000 carts → 200 orders: 2% of visits become orders.",
        related: ["conversion-rate"],
      },
      {
        id: "conversion-rate",
        term: "Conversion rate",
        level: "beginner",
        short: "The share of people who take the next step: visitors who buy, leads who become customers.",
        body: "Always say from what to what: “visit to order” and “cart to order” are different rates.",
        related: ["funnel", "rate"],
      },
      {
        id: "correlation",
        term: "Correlation",
        level: "intermediate",
        short: "Two measures moving together: as one rises, the other tends to rise, or to fall.",
        body: "Correlation is not causation: both may follow something else, such as the season. Test before treating one as the cause of the other.",
        related: ["r-squared", "trend-line"],
      },
      {
        id: "r-squared",
        term: "R² (R squared)",
        level: "advanced",
        short: "How closely points follow a straight line, from 0 (not at all) to 1 (exactly).",
        body: "Loupe says “move together” from 0.5, “loosely linked” from 0.2 and “no clear link” below that; whether one rises or falls as the other rises comes from the slope of the line.",
        related: ["correlation", "trend-line"],
      },
      {
        id: "trend-line",
        term: "Trend line",
        aka: ["Line of best fit", "Regression line"],
        level: "advanced",
        short: "The straight line that best fits a scatter of points.",
        body: "Its slope says how much one measure changes, on average, for each step in the other.",
        related: ["r-squared"],
      },
      {
        id: "anomaly",
        term: "Anomaly",
        aka: ["Spike"],
        level: "intermediate",
        short: "A value far from the usual, such as a day with five times the typical sales.",
        body: "Check what happened: a one-off event, a bulk order or a data error. Loupe compares each day with the median of the 28 days around it.",
        related: ["outlier"],
      },
      {
        id: "distribution",
        term: "Distribution",
        level: "intermediate",
        short: "How values are spread: mostly small with a few large ones, evenly, or in two clusters.",
        body: "A histogram counts how many rows fall in each band of values.",
        related: ["median", "outlier"],
      },
      {
        id: "mix-effect",
        term: "Mix effect",
        aka: ["Simpson's paradox"],
        level: "advanced",
        short: "When a total moves one way while its parts move the other, because the mix of parts changed.",
        body: "If cheaper products sell more, the average price falls even though every product's price rose. Loupe flags it so the headline change isn't read as like for like.",
        related: ["segment", "like-for-like"],
      },
      {
        id: "budget-variance",
        term: "Variance against budget",
        aka: ["Budget variance"],
        level: "intermediate",
        short: "The gap between actual and budget (or target): actual − budget.",
        body: "A positive variance in revenue is good news; a positive variance in cost is not, so read it with the KPI's direction.",
        related: ["target", "direction"],
      },
    ],
  },
  {
    id: "quality",
    title: "Data quality",
    blurb: "Blanks, duplicates, outliers and the health score.",
    terms: [
      {
        id: "data-health",
        term: "Data health score",
        level: "beginner",
        short: "A score out of 100 for how ready a file is for analysis.",
        body: "It counts problems such as blanks, duplicates, mixed types and inconsistent spellings, weighted by how much each matters. Problems in hidden columns don't count.",
        inLoupe: "Check & map › Data health.",
        related: ["missing-value", "duplicate", "data-cleaning"],
      },
      {
        id: "missing-value",
        term: "Missing value",
        aka: ["Blank", "Null"],
        level: "beginner",
        short: "A cell with no value.",
        body: "Blanks are left out of sums, averages and distinct counts, which can quietly lower a KPI. Words such as “NA” or “-” in a number column are read as blanks.",
        related: ["data-health"],
      },
      {
        id: "duplicate",
        term: "Duplicate row",
        level: "beginner",
        short: "A row that appears twice with exactly the same values.",
        body: "Duplicates count sales and orders twice. They often come from exporting the same data twice or joining two tables.",
        related: ["data-health", "unique-key"],
      },
      {
        id: "outlier",
        term: "Outlier",
        level: "intermediate",
        short: "A value far outside the rest, such as one order of ₹50L among orders of ₹2K.",
        body: "It may be real (a bulk order) or a mistake (a price typed in paise). It pulls the average up, which is why the median is useful.",
        related: ["median", "anomaly"],
      },
      {
        id: "inconsistent-spelling",
        term: "Inconsistent spellings",
        level: "beginner",
        short: "One value written several ways: Delhi, delhi, “New Delhi ”.",
        body: "Each spelling becomes its own group in charts and splits the true total. Fix them in the source file.",
        related: ["dimension", "data-cleaning"],
      },
      {
        id: "unique-key",
        term: "Unique key",
        aka: ["Primary key"],
        level: "intermediate",
        short:
          "A column (or a set of columns) with a different value on every row, such as an order line ID.",
        body: "It proves the grain: if the order ID repeats, each row is an order line, not an order.",
        related: ["grain", "identifier"],
      },
      {
        id: "cardinality",
        term: "Cardinality",
        level: "advanced",
        short: "How many different values a column has.",
        body: "A few values (channel) make good filters and charts; thousands (customer name) work better as identifiers or in a top-N table.",
        related: ["dimension", "identifier"],
      },
      {
        id: "hidden-column",
        term: "Hidden column",
        level: "intermediate",
        short: "A column kept in the file but taken out of the analysis.",
        body: "Hide a raw column when a cleaned copy exists, or one that would mislead. It stays in the data grid and every export, but no KPI, chart, filter or question uses it.",
        inLoupe: "Check & map › Your columns › Hide.",
        related: ["data-health", "data-cleaning"],
      },
      {
        id: "delimiter",
        term: "Delimiter",
        level: "intermediate",
        short: "The character that separates values in a text file: a comma, a semicolon, a tab or a pipe.",
        body: "European exports often use semicolons because the comma is their decimal mark. Loupe detects the delimiter itself.",
        related: ["csv"],
      },
      {
        id: "encoding",
        term: "Encoding",
        aka: ["UTF-8"],
        level: "advanced",
        short: "How the characters of a text file are stored as bytes.",
        body: "UTF-8 handles every alphabet and the ₹ sign. A file read with the wrong encoding shows garbled characters; Loupe detects the encoding.",
        related: ["bom"],
      },
      {
        id: "sampling",
        term: "Sampling",
        level: "intermediate",
        short: "Analysing a regular selection of the rows when a file is too large for the browser.",
        body: "Loupe says when it samples (“every 3rd row”) and marks the results as sampled, because the totals then cover only part of the file.",
        related: ["dataset"],
      },
      {
        id: "data-cleaning",
        term: "Data cleaning",
        level: "beginner",
        short:
          "Fixing a file before analysis: removing duplicates, dealing with blanks, making spellings consistent.",
        body: "Loupe checks a file and says what to fix, but changes nothing in your data: every export keeps your values as written.",
        related: ["data-health"],
      },
    ],
  },
  {
    id: "exports",
    title: "Reports and exports",
    blurb: "Power BI, DAX, SQL and the files you share.",
    terms: [
      {
        id: "csv",
        term: "CSV",
        aka: ["Comma-separated values"],
        level: "beginner",
        short: "A plain-text table: one row per line, with the values separated by commas.",
        body: "Every spreadsheet and database reads it. Loupe's CSVs for spreadsheets start with a byte-order mark, so Excel shows ₹ and accents correctly.",
        related: ["delimiter", "bom"],
      },
      {
        id: "xlsx",
        term: "XLSX",
        aka: ["Excel workbook"],
        level: "beginner",
        short: "An Excel file, which can hold several sheets.",
        body: "When the sheets relate (an Orders sheet with Customers and Products sheets keyed by Customer ID and Product ID), Loupe joins them into one table and says on which keys. Otherwise it reads one sheet at a time and asks which one.",
        related: ["csv"],
      },
      {
        id: "json",
        term: "JSON",
        level: "beginner",
        short: "A text format for structured data, common in app and API exports.",
        body: "A list of objects reads as a table, one row per object.",
        related: ["dataset"],
      },
      {
        id: "bom",
        term: "Byte-order mark (BOM)",
        level: "advanced",
        short: "An invisible marker at the start of a text file that says it is UTF-8.",
        body: "Excel needs it to read ₹ and accented letters in a CSV; other tools ignore it.",
        related: ["encoding", "csv"],
      },
      {
        id: "pdf-report",
        term: "PDF report",
        level: "beginner",
        short:
          "The dashboard as a document: a cover, the KPIs, an executive summary, numbered figures and a glossary.",
        body: "Each figure has its unit, its notes and its source, the way an analyst's report is laid out.",
        inLoupe: "Export › Dashboard report.",
        related: ["slides", "one-page-dashboard"],
      },
      {
        id: "slides",
        term: "Presentation slides",
        level: "beginner",
        short: "The dashboard as a deck of 16:9 slides: an overview, then two or four charts a slide.",
        body: "Each chart leads with its takeaway, and every slide carries its number and its source.",
        inLoupe: "Export › Presentation slides.",
        related: ["one-page-dashboard", "takeaway"],
      },
      {
        id: "power-bi",
        term: "Power BI",
        level: "beginner",
        short: "Microsoft's business intelligence tool for building interactive reports.",
        body: "Loupe exports a Power BI project package (a semantic model, DAX measures, your data and a build guide), not a ready-made .pbix file: Power BI Desktop opens the model and you lay out the visuals.",
        inLoupe: "Export › Power BI package.",
        related: ["semantic-model", "dax"],
      },
      {
        id: "semantic-model",
        term: "Semantic model",
        aka: ["Data model"],
        level: "advanced",
        short: "The tables, relationships and measures a Power BI report is built on.",
        body: "It turns raw columns into business terms: a Date table, KPI measures, hierarchies and hidden helper columns.",
        related: ["power-bi", "tmdl", "date-table"],
      },
      {
        id: "tmdl",
        term: "TMDL",
        aka: ["Tabular Model Definition Language"],
        level: "advanced",
        short: "Power BI's text format for a semantic model.",
        body: "Being plain text, it can be read, versioned and reviewed like code.",
        related: ["semantic-model"],
      },
      {
        id: "dax",
        term: "DAX",
        aka: ["Data Analysis Expressions"],
        level: "advanced",
        short: "The formula language of Power BI measures.",
        body: "Loupe writes every KPI in DAX as well as SQL, so the numbers in Power BI match the dashboard's.",
        example: "Return rate = DIVIDE([Returned orders], [Delivered orders])",
        related: ["measure-power-bi", "sql"],
      },
      {
        id: "measure-power-bi",
        term: "Measure (in Power BI)",
        level: "advanced",
        short: "A named DAX formula that is worked out again for whatever the report is filtered to.",
        body: "Unlike a calculated column, it is computed when the report asks for it, so one measure works for every slicer selection.",
        related: ["dax", "slicer"],
      },
      {
        id: "date-table",
        term: "Date table",
        level: "advanced",
        short: "A table with one row per day, linked to the data's dates, that powers time intelligence.",
        body: "With it, measures such as YTD, PY and YoY work in Power BI.",
        related: ["semantic-model", "ytd", "py"],
      },
      {
        id: "relationship",
        term: "Relationship",
        level: "advanced",
        short: "A link between two tables on a shared column, such as the date.",
        body: "It lets a slicer on one table filter another.",
        related: ["semantic-model", "date-table"],
      },
      {
        id: "hierarchy",
        term: "Hierarchy",
        level: "intermediate",
        short: "Columns that nest: country › state › city, or category › sub-category › product.",
        body: "It lets a chart or a report drill down one level at a time.",
        related: ["drill-down"],
      },
      {
        id: "sql",
        term: "SQL",
        aka: ["Structured Query Language"],
        level: "beginner",
        short: "The language of databases.",
        body: "Loupe writes every KPI and every answered question as SQL that runs on your own database.",
        related: ["sql-view", "duckdb", "business-question"],
      },
      {
        id: "sql-view",
        term: "SQL view",
        level: "advanced",
        short: "A saved query that behaves like a table.",
        body: "Loupe's SQL file creates one view per KPI, named after its measure (kpi_net_revenue).",
        related: ["sql"],
      },
      {
        id: "duckdb",
        term: "DuckDB",
        level: "advanced",
        short: "A fast database engine that runs inside the browser.",
        body: "Loupe uses it to run its own SQL on your data and check that every KPI query returns Loupe's number. It is downloaded only when you ask for a check.",
        inLoupe: "Export › SQL › Verify against your data.",
        related: ["sql"],
      },
      {
        id: "data-dictionary",
        term: "Data dictionary",
        level: "intermediate",
        short:
          "A document describing every column: its name, meaning, type, unit, range and how complete it is.",
        body: "It is how an analyst hands a dataset over to someone else.",
        inLoupe: "Export › Data dictionary.",
        related: ["column"],
      },
      {
        id: "settings-file",
        term: "Settings file",
        level: "intermediate",
        short:
          "A small file that saves how you set up a dashboard: the industry, the mapping, the layout and the filters.",
        body: "Load it later with the same data file to pick up where you left off. It holds no rows of data.",
        inLoupe: "Export › Save settings.",
        related: ["mapping"],
      },
    ],
  },
];

/** Every hand-written term by id. */
export const TERM_BY_ID: ReadonlyMap<string, GlossaryTerm> = new Map(
  GLOSSARY.flatMap((s) => s.terms).map((t) => [t.id, t]),
);

// ---------------------------------------------------------------- charts

export interface GlossaryChart {
  kind: string;
  name: string;
  shows: string;
  bestFor: string;
}

export interface GlossaryChartGroup {
  id: string;
  title: string;
  /** The question the group's charts answer. */
  question: string;
  charts: GlossaryChart[];
}

/** Every chart Loupe draws, grouped by the question it answers (the chart catalogue's own words). */
export function chartGlossary(): GlossaryChartGroup[] {
  return CHART_GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    question: g.question,
    charts: CHART_TYPES.filter((c) => c.group === g.id).map((c) => ({
      kind: c.kind,
      name: c.name,
      shows: c.shows,
      bestFor: c.bestFor,
    })),
  })).filter((g) => g.charts.length);
}

// ---------------------------------------------------------------- industries

export interface GlossaryKpi {
  id: string;
  name: string;
  short?: string;
  definition: string;
  formula: string;
  direction: "higher" | "lower" | "neutral";
  /** What kind of number it is: "Money", "Percentage", "Count"… */
  unit: string;
  /** One of the industry's headline KPIs. */
  headline: boolean;
  /** The data shapes it applies to, when not all of them. */
  shapes: string[];
  pitfalls: string[];
  /** "30%–60%. Indicative range for D2C brands…", when the registry has one. */
  benchmark?: string;
}

export interface GlossaryIndustry {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** Registry icon name (lucide kebab-case), drawn by DomainIcon. */
  icon: string;
  /** The kinds of table Loupe recognises in this industry, with what one row is. */
  shapes: Array<{ name: string; description: string; grain: string }>;
  /** What to watch out for in this industry's data. */
  pitfalls: string[];
  groups: Array<{ name: string; kpis: GlossaryKpi[] }>;
  kpiCount: number;
}

const UNIT: Record<KpiFormat, string> = {
  currency: "Money",
  percent: "Percentage",
  integer: "Count",
  number: "Number",
  decimal: "Number",
  ratio: "Ratio",
  days: "Days",
};

/** A benchmark's bound in its KPI's units: 0.3 → "30%", 4 → "4 days", 2 → "2×". */
function bound(v: number, format: KpiFormat): string {
  const trim = (n: number) => String(Math.round(n * 10) / 10);
  switch (format) {
    case "percent":
      return `${trim(v * 100)}%`;
    case "days":
      return `${trim(v)} days`;
    case "ratio":
      return `${trim(v)}×`;
    default:
      return trim(v);
  }
}

/**
 * A benchmark as a sentence: its range in the KPI's units, then its note.
 * Money ranges are left out (a registry range carries no currency), so only
 * the note is given for them.
 */
export function benchmarkText(
  b: { low?: number; high?: number; note: string } | undefined,
  format: KpiFormat,
): string | undefined {
  if (!b) return undefined;
  const range =
    format === "currency"
      ? ""
      : b.low !== undefined && b.high !== undefined
        ? // Days say their unit once ("4–7 days"); percentages and multiples keep a sign on each bound.
          format === "days"
          ? `${bound(b.low, "number")}–${bound(b.high, format)}`
          : `${bound(b.low, format)}–${bound(b.high, format)}`
        : b.high !== undefined
          ? `Up to ${bound(b.high, format)}`
          : b.low !== undefined
            ? `${bound(b.low, format)} or more`
            : "";
  return range ? `${range}. ${b.note}` : b.note;
}

/**
 * Every industry's KPIs, grouped as the registry groups them, with each
 * KPI's definition, formula, direction, unit, the data shapes it applies to,
 * what to watch out for and any benchmark. Helper measures (hidden in the
 * registry) are left out.
 */
export function industryGlossary(domains: readonly DomainDef[]): GlossaryIndustry[] {
  return domains.map((d) => {
    const shapeName = new Map(d.subDomains.map((s) => [s.id, s.name]));
    const kpis = d.kpis.filter((k) => !k.hidden);
    const groups: Array<{ name: string; kpis: GlossaryKpi[] }> = [];
    for (const k of kpis) {
      let group = groups.find((g) => g.name === k.group);
      if (!group) {
        group = { name: k.group, kpis: [] };
        groups.push(group);
      }
      group.kpis.push({
        id: k.id,
        name: k.name,
        ...(k.short ? { short: k.short } : {}),
        definition: k.definition,
        formula: k.formula,
        direction: k.direction,
        unit: UNIT[k.format] ?? "Number",
        headline: k.tier === "hero",
        shapes:
          k.subDomains && k.subDomains.length < d.subDomains.length
            ? k.subDomains.map((id) => shapeName.get(id) ?? id)
            : [],
        pitfalls: k.pitfalls ?? [],
        ...(k.benchmark ? { benchmark: benchmarkText(k.benchmark, k.format) } : {}),
      });
    }
    return {
      id: d.id,
      name: d.name,
      tagline: d.tagline,
      description: d.description,
      icon: d.icon,
      shapes: d.subDomains.map((s) => ({ name: s.name, description: s.description, grain: s.grain })),
      pitfalls: d.pitfalls ?? [],
      groups,
      kpiCount: kpis.length,
    };
  });
}
