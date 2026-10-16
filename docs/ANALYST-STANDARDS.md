# Analyst standards

Loupe's output is read the way an analyst's work is read: by managers, finance teams and other analysts, often outside the app. These are the conventions it follows, and every change should keep to them. Each rule names the code that enforces it.

## Numbers

- **Every figure is computed from the data.** Nothing is estimated or typed in (see the invariants in `CLAUDE.md`).
- **One number system.** Shown numbers use the user's grouping (Indian lakh/crore or international), a true minus sign (−1.8%), and compact units for money from 1,000 and counts from 1,00,000 (`engine/core/format.ts`). The data grid and exported files keep the plain hyphen that other software reads.
- **One unit per axis.** A value axis uses the unit its largest value needs: ₹0.9L, ₹1.2L, ₹1.5L, never ₹90K beside ₹1.2L (`axisTicks` in `ui/charts/options.ts`).
- **Rates change in percentage points.** 40% → 42% is +2.0 pp, never +5.0%: on cards, in insights, in the KPI details, in DAX (`YoY pp`, `MoM pp`) and in the SQL monthly views (`*_change_pp`).
- **A change states its base.** A KPI card says what it is measured from ("+40.5% from ₹2.23Cr"), and the comparison period is named once above the cards.
- **Flat is neutral.** A change that prints as 0.0% or 0.0 pp is grey, never good or bad news (`isFlatChange`).
- **Say which rows.** Anything showing a number says which rows it covers: the period and filters on screen; the whole file, with its dates, in the Power BI README.

## Dates

- A month is "Oct 2025", never "Oct 25" (`bucketLabel`). An axis shows the year once per year: Oct 2025, Nov, Dec, Jan 2026 (`timeTick`).
- Sentences spell weekdays in full ("Saturday"), and say "1 day", not "1 days".
- An incomplete first or last period is drawn dashed and labelled with where the data stops ("to 20 Sep"). It is never drawn as a fall.
- The dashboard header and the report cover give the period, the comparison period and how recent the data is ("data to 30 Sep 2026").

## Charts

- Follow the data-viz rules in `ui/charts/options.ts`:
  - no dual axes;
  - bars start at zero;
  - a legend only for two or more series;
  - a table view for every chart.
- **Label everything.**
  - Every chart has a unit line under its title ("In ₹ · monthly") (`chartSubtitle`).
  - Named categories are never thinned or tilted: labels wrap to two lines, and more than ten named columns turn into horizontal bars (`wrapLabel`).
  - Colour scales print their end values.
- **Colour follows the value.** A category keeps its colour in every chart, under every filter and in every export, chosen by how common it is in the whole file (`valueRanks`, `stableColours`). "Others" is always the neutral grey and comes last.
- **Text on a fill uses the ink that contrasts with that fill** (`inkOn`, `seqInk`).
- **Say it in words when a chart would look broken:**
  - "Refunds is 0 for every courier in this selection";
  - a "(blank)" group with no value is left out, with a note;
  - "Top 10 plus Others" is only claimed when there are more than ten groups.

## Names and wording

- **Readable column names.** Column names read with spaces wherever Loupe writes them: "New order date", not "New_order_date" (`engine/core/labels.ts`). The file, the grid and the exports keep the headers as written.
- **One name per KPI.** A KPI has one display name on cards, legends, axes and tooltips (`kpiLabel`). KPI names are in sentence case: "Net revenue", "Gross margin %".
- **One word for each thing:**
  - rows (not records);
  - insights (not findings);
  - industry (not domain);
  - Custom (for what the user made);
  - Average (not Avg);
  - Lowest and Highest (not Min and Max);
  - chart names from the chart catalogue.
- **Grammar comes from the words.** Generated sentences agree with the KPI's name ("New customers were", "Net revenue was", `wasWere`) and take "a" or "an" as said ("an 85.8 pp gap", `article`).
- **Filters.** Filters read "Column: value" everywhere (`describeFilter`).
- **Neutral advice.** Insight advice fits any industry. Don't assume a shop.

## Files

- **One name pattern.** Every download is named `{dataset}_{artefact}_{YYYY-MM-DD}.{ext}` (`exportFileName`). Artefact names match the files inside the Power BI package, whose folder is named like the zip.
- **CSVs for spreadsheets** start with a UTF-8 byte-order mark, so Excel reads ₹ and accents correctly. The Power BI package's `data.csv` does not.
- **The user's data as written:**
  - Yes/No stays Yes/No;
  - the cleaned CSV keeps the file's own headers;
  - dates are written as ISO (YYYY-MM-DD) on purpose.
- **SQL views** are named after their measures (`kpi_net_revenue`, `kpi_gross_margin_pct`), never after internal ids (`viewNames`).
- **Power BI measures:**
  - a measure that clashes with a column is named "Total revenue", never "Revenue (KPI)";
  - time-intelligence suffixes are MTD, QTD, YTD, PY, YoY %/pp, PM, MoM %/pp, Rolling 30D, Rolling 90D and Rolling 7D Avg.
- **The Power BI model:**
  - geographic columns carry their data category;
  - detected hierarchies are built in;
  - the date-link helper is hidden;
  - with a Date table, Auto date/time is off.
- **The data dictionary** gives, for each column:
  - the column as written, its business name and its export name;
  - its type, role, unit and range, and whether it is a key;
  - its allowed values (for 12 or fewer);
  - how complete it is, with examples and a description.

## Reports

- **The PDF report reads like an analyst's report:**
  - a cover: period, comparison, filters, rows, data up to, grain;
  - the headline KPIs;
  - an executive summary whose insights cite their figures;
  - the supporting KPIs with their changes;
  - numbered figures, each with its unit, notes and source;
  - an appendix with a glossary of every KPI shown and the data health.
- **The insights PDF:**
  - keeps each insight on one page with its chart;
  - numbers figures and draws each chart only once;
  - prints a chart's notes under it;
  - never shows a monthly chart for a one-day event;
  - writes a method that repeats as "as for insight n".
- **The dashboard PNG** holds every chart, with wide charts across the full width.
- **Tables in a PDF or image** show as many rows as fit, say how many more there are, and never capture scrollbars.
