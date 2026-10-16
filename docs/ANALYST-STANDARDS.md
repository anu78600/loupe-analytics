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
- **Say what the chart shows.** Every chart has a takeaway: one sentence under its title, computed from its own data, that says what it shows, the way an analyst titles a slide (`chartHeadline` in `engine/charts/headline.ts`). The dashboard, the slides and the PDF report all lead with it.
  - A trend compares the first and last complete periods and names the peak ("Up 12.7% from Oct 2025 to Sep 2026, ending at its peak of ₹37.9L"). An incomplete period is never read as a fall, and a rate changes in pp.
  - A share of the total is given only for a measure that adds up: a sum, a count or a distinct count, against the total over all rows ("Apparel leads with ₹86.7L, 28% of the total"). A rate or an average is compared highest to lowest instead ("COD is highest at 16.3%; Wallet is lowest at 1.9%").
  - A stacked chart over time gives the make-up of its latest complete period. A donut gives the share its slices show. A table names its first row only. "Others" never leads.
  - Where nothing can be said honestly (fewer than two complete periods, a single number) there is no sentence.
- **Label everything.**
  - Every chart has a unit line under its title ("In ₹ · monthly"); a cohort grid's says its base ("In % of each cohort") (`chartSubtitle`).
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
- **Presentation slides** are landscape 16:9, built the way an analyst builds a deck (`export/slidePlan.ts`, `export/slides.tsx`):
  - an overview slide: the period and what the changes compare with, the headline KPIs with their changes and trends, and the key takeaways, each saying which slide shows it;
  - then each dashboard section in order, titled with the question it answers ("Where the volume comes from"), two charts a slide for presenting or four for a compact deck; a table or a cohort grid gets a slide of its own;
  - every chart leads with its takeaway, under a line saying what it is about and its unit;
  - every slide carries its number ("4 / 16") and a source line: file, rows, period and filters;
  - chart and table text is scaled up so it reads from across a room (axis labels about 18px on a 1920 × 1080 slide);
  - the Export card shows the deck in miniature and counts it before it is made. The images are 3840 × 2160 (4K), numbered so they sort in order, in one zip, or as one landscape PDF. There is no tall single image of the dashboard: a slide is what gets presented.
- **Tables in a PDF or image** show as many rows as fit, say how many more there are, and never capture scrollbars.
