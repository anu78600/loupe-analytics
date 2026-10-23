# Version log

Every step of building Loupe, newest first. Generated from `src/content/changelog.ts` by `npm run changelog`; the same content is on the `/changelog` page.

- **MAJOR** (`x.0`): a new capability, subsystem or page.
- **MINOR** (`x.y`): a refinement, fix or follow-up to that major version.

## Up next

1. **Redesign stage 4: the dashboard.** KPI cards with sparklines and trends, a bento grid of charts, a filter bar above the charts instead of the side rail, new chart cards with their takeaway and actions on hover, and insights beside the charts.
2. **Redesign stage 5: analysis, sharing and the landing page.** Questions as a conversation with an analyst, Insights as a ranked feed, Export as a gallery with previews, the landing page in the new look, and motion, empty and loading states polished on phones and in both themes.

## 50.2 · From file to first dashboard in one guided flow (redesign stage 3 of 5)

*Minor · 2026-10-23 09:51 UTC · Design*

Upload, Detect and Check & map now read as one guided sequence, each page opening the same way and ending with a small floating bar that always shows the next step. Upload shows the drop zone and the demos side by side, Detect tells your data's story before naming its industry, and Check & map is one review table with every fix in its row.

- Upload: a large drop zone and the six demos side by side, both in view at once, with a short “How it works” under them. Your file still never leaves the browser, and the page says so.
- Detect is now a story in five short chapters: what your data is about (with its rows, columns, dates and what it is measured by), what moves that measure, how each column is read, which industry it belongs to, and anything to fix before you continue.
- The industry choice is one card: the match and the other close matches on the left, your choice on the right, with the business details folded away until you want them.
- Check & map is one review table: a row per column with its example values, how it is read, the field it fills, what it feeds on the dashboard and any problem, each changeable in place. A row opens to say why it was read that way, with its value meanings, the advanced settings and the rows to check.
- Four tiles sum up the review (KPIs available, columns used, rows to check, data health), and each one opens the right place. The whole file, KPI availability, the industry's fields and the file report sit beside the table as views.
- Every page of the flow ends with a floating bar that shows where things stand and the next step: Review columns, then Open the dashboard (Customise stays one click away).
- On phones the review table becomes cards, and the bar sits just above the bottom bar.
- The sidebar's background now runs the full height of long pages.

Files: `src/ui/workspace/flow/StepHeader.tsx`, `src/ui/workspace/flow/FlowDock.tsx`, `src/ui/workspace/flow/Chapter.tsx`, `src/ui/workspace/flow/prepareWords.ts`, `src/ui/workspace/UploadStep.tsx`, `src/ui/workspace/DetectStep.tsx`, `src/ui/workspace/understanding/AboutData.tsx`, `src/ui/workspace/understanding/aboutWords.ts`, `src/ui/workspace/MapStep.tsx`, `src/ui/workspace/DataCheckPanel.tsx`, `src/ui/workspace/HiddenColumns.tsx`, `src/ui/workspace/review/model.ts`, `src/ui/workspace/review/ReviewTable.tsx`, `src/ui/workspace/review/RowDetails.tsx`, `src/ui/workspace/review/SummaryStrip.tsx`, `src/ui/workspace/review/FieldMapping.tsx`, `src/ui/workspace/review/ValueMeanings.tsx`, `src/ui/workspace/review/KpiAvailability.tsx`, `src/ui/workspace/shell/Sidebar.tsx`, `src/content/glossary.ts`, `docs/DESIGN.md`, `tests/prepare-flow.test.ts`, `tests/review-table.test.ts`, `tests/about-data.test.ts`

## 50.1 · A new app layout: a sidebar of phases, a slim top bar, and a bottom bar on phones (redesign stage 2 of 5)

*Minor · 2026-10-23 08:53 UTC · Design*

The workspace is laid out like a modern app. The eight steps no longer squeeze into one bar along the top: they sit in a sidebar, grouped into four phases (Prepare, Build, Analyse, Share), with a slim top bar for where you are, search and actions. On phones, a bottom bar holds the four phases.

- A sidebar on laptops and desktops lists every step under its phase, shows how far through you are, and links to the glossary and the version log. On the dashboard and Customise it narrows to icons, so the charts keep their room; one click expands or collapses it, and Loupe remembers your choice.
- A slim top bar shows where you are as a trail (your file, then the phase and the step), with a search box (Ctrl/⌘+K), start over, settings and the theme.
- On phones and tablets, a bottom bar holds the four phases within reach of your thumb, and a row under the top bar lists the steps of the current phase. A phase reopens where you left it.
- Steps that can't be opened yet stay visible, dimmed, and say why (load data first, choose an industry first).
- The search palette lists the steps under their phases, with the same icons as the sidebar.

Files: `src/ui/workspace/shell/phases.ts`, `src/ui/workspace/shell/sidebarState.ts`, `src/ui/workspace/shell/Sidebar.tsx`, `src/ui/workspace/shell/TopBar.tsx`, `src/ui/workspace/shell/BottomBar.tsx`, `src/ui/workspace/Shell.tsx`, `src/ui/workspace/Workspace.tsx`, `src/ui/workspace/CommandPalette.tsx`, `src/ui/workspace/DetectStep.tsx`, `src/ui/common/providers.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `next.config.ts`, `docs/DESIGN.md`, `tests/workspace-shell.test.ts`

## 50.0 · A new look: indigo, slate and one sans voice (redesign stage 1 of 5)

*Major · 2026-10-23 07:50 UTC · Design*

The first of five redesign stages. Loupe's whole identity changes: warm paper, bronze and an editorial serif give way to cool slate surfaces, one indigo accent and bold sans-serif headings, in both the light and the dark theme, on every screen, chart, logo and icon.

- New colours everywhere: crisp cool backgrounds, white cards and one indigo accent in light; a blue-black canvas with a periwinkle accent in dark. Every text level, button, focus ring and status colour was re-checked for contrast in both themes.
- Headings are now set in Inter SemiBold at its display cut, with tight spacing, instead of the serif: one modern sans voice across the app, the landing page and the share image.
- New chart colours, indigo first, then orange, violet, rose, sky, green, teal and gold, in the order that keeps neighbouring series furthest apart for colour-blind readers (twice the margin the checks require). Gradients and heatmaps follow the indigo.
- A cleaner finish: the paper texture is gone, and the landing page's background glow is indigo and sky.
- A new logo, wordmark, browser icon and share image in the new colours and type.
- The four remaining redesign stages are listed under Planned below.

Files: `src/styles/primitives.css`, `src/styles/theme-light.css`, `src/styles/theme-dark.css`, `src/app/globals.css`, `src/app/layout.tsx`, `src/app/opengraph-image.tsx`, `src/app/icon.svg`, `src/app/favicon.ico`, `public/brand/loupe-mark-dark.svg`, `public/brand/loupe-mark-light.svg`, `public/brand/loupe-wordmark-dark.svg`, `public/brand/loupe-wordmark-light.svg`, `scripts/brand-wordmark.py`, `src/ui/charts/palette/themes.ts`, `src/ui/charts/palette/check.ts`, `src/ui/charts/tokens.ts`, `docs/DESIGN.md`, `tests/chart-themes.test.ts`, `tests/typography.test.ts`

## 49.0 · Reads your data first, then designs the dashboard from it

*Major · 2026-10-21 18:25 UTC · Feature, Data, Design, Tests*

Loupe used to start from an industry template and fill it with whatever columns matched. Now it reads the table first: what one row is, what each column is, which column the table is measured by and what moves it. The dashboard, its title and its insights are designed from that reading, and an industry's template leads only where it truly fits.

- New on the Detect step, “What this data is about”: a title for your data (“Wine quality analysis”, “Passenger survival analysis”), what one row is (“One row per wine sample”), the column it is measured by, what moves that column most, each column grouped by kind, and the main data problems.
- Loupe finds the outcome itself: a yes/no result (survived, churned, left), a score (quality 3–9), a class (a species) or an amount (a price). You can pick another column or none, and everything is rebuilt around your choice.
- What moves the outcome is computed from your rows, with the figures shown, such as which group has the highest and the lowest survival rate and what each rate is. Weak links are called weak: on your wine file, “No characteristic moves closely with quality; the strongest link is total sulfur dioxide (r = −0.17).”
- Read a column as something else from its chip (ID, category, amount, measurement, score, yes/no…), and the reading and dashboard follow.
- Dashboards without a fitting industry are now designed around the outcome for every kind of table: yes/no outcomes get the rate by what moves it most, scores their distribution and drivers, classes their mix, and prices their averages by group and a scatter, ranked by how much each chart tells.
- When an industry fits strongly, its template still leads, and a “What moves …” chart is added only where the data shows a clear driver the template doesn't already cover. All six demo dashboards are unchanged.
- When an industry fits weakly, the charts built from your data lead, unfolded.
- The dashboard's title comes from the data (“Wine quality analysis”, not “Performance dashboard”), and the name of a row comes from the sheet when the file name says nothing (cleaned.xlsx).
- Insights include what moves the outcome, worked out on the rows under your current filters.
- Small codes and counts in a table of cases are read properly: a passenger class of 1–3 is a category, and counts of relatives are averaged, never shown as money.
- Glossary: new terms for Outcome and Driver.

Files: `src/engine/understand/types.ts`, `src/engine/understand/understand.ts`, `src/engine/understand/outcome.ts`, `src/engine/understand/drivers.ts`, `src/engine/understand/plan.ts`, `src/engine/understand/whatMoves.ts`, `src/engine/understand/refine.ts`, `src/engine/understand/kinds.ts`, `src/engine/session.ts`, `src/engine/detect/generic.ts`, `src/engine/detect/tableShape.ts`, `src/engine/insights/insights.ts`, `src/engine/export/config.ts`, `src/workers/engine.worker.ts`, `src/store/workspace.ts`, `src/ui/workspace/understanding/AboutData.tsx`, `src/ui/workspace/understanding/aboutWords.ts`, `src/ui/workspace/DetectStep.tsx`, `src/ui/workspace/ExportStep.tsx`, `src/ui/workspace/dashboard/DashboardStep.tsx`, `src/ui/workspace/dashboard/page/pagePlan.ts`, `src/ui/workspace/dashboard/page/OnePage.tsx`, `src/content/glossary.ts`, `tests/understand.test.ts`, `tests/data-first-dashboards.test.ts`, `tests/helpers/practice.ts`, `tests/about-data.test.ts`, `tests/page-plan.test.ts`, `tests/generic-dashboards.test.ts`

## 48.1 · Measurement tables read honestly, and no column claimed by a word it shares

*Minor · 2026-10-21 16:52 UTC · Fix, Data, Tests*

A table of measurements, such as wine samples with their acidity, sugar, pH and quality, was read as a pharmacy file: “total sulfur dioxide” became net sales, and every reading was summed. Now readings are averaged, a column is never matched on one shared word, and such a table gets a dashboard built around its outcome.

- No more matching on one generic word: “total sulfur dioxide” is no longer net sales or room revenue, and “free sulfur dioxide” is no longer a free quantity. “Grand Total”, “Net Amount” and “Order Total” still match.
- Readings are averaged, never summed: pH, density, acidity, chlorides, sulphates, sugar, alcohol %, temperature and similar, and any column with units such as mg/L, ppm or °C. In a table of measurements with no IDs, dates or amounts, every reading is averaged. Scores such as quality 3–9 are averaged as ratings.
- Tables with an outcome (quality, grade, class, target) get a dashboard built around it: the outcome's distribution in its natural order, its average, the share rated high (“rated 7 or above”), the measures most linked to it (computed from your rows), a scatter, and a table of averages by outcome.
- Picking an industry that scored low on Detect now shows how few columns it explains, with a one-click general dashboard. The dashboard shows the same notice when an industry fits few columns, including when the choice was remembered from an earlier file, with an option to forget it.
- A dashboard is never empty: when an industry's own charts don't apply, charts built from your other columns fill the page.
- New data check, values on two scales: a column holding the same measure at two sizes (0.994 next to 994) is flagged as a probable lost decimal point, with the rows to check. Your values are never changed. The glossary explains it.
- A scatter's takeaway now says its fit is across the chart's groups (“R² 0.27 across 20 groups”), not individual rows. The Detect step no longer says “Please confirm” twice, and the one page no longer waits forever when no insight stands out.

Files: `src/engine/profile/roles.ts`, `src/engine/profile/profile.ts`, `src/engine/profile/scales.ts`, `src/engine/profile/quality.ts`, `src/engine/detect/match.ts`, `src/engine/detect/detect.ts`, `src/engine/detect/tableShape.ts`, `src/engine/detect/generic.ts`, `src/engine/kpi/columnKpis.ts`, `src/engine/charts/data.ts`, `src/engine/charts/headline.ts`, `src/engine/session.ts`, `src/ui/workspace/DetectStep.tsx`, `src/ui/workspace/industryFit.ts`, `src/ui/workspace/dashboard/FitNotice.tsx`, `src/ui/workspace/dashboard/page/OnePage.tsx`, `src/content/glossary.ts`, `tests/wine-and-measurements.test.ts`, `tests/mixed-scale.test.ts`, `tests/industry-fit.test.ts`

## 48.0 · Two themes, each designed on its own

*Major · 2026-10-21 15:07 UTC · Design, Security, Tests, Docs*

Light and dark are now two separately designed themes, built the way the best SaaS products build theirs: raw colour ramps, then each theme's own roles, then the components. Light is paper, ink and hairlines; dark shows depth with light rather than shadow. Every text level and the focus ring are tested for contrast in both.

- Light theme: a warm paper background, white raised cards with a hairline ring and a soft layered shadow, darker recessed areas, near-black text, and three clearly separate text levels (muted and subtle used to look almost the same).
- Dark theme: near-black, never pure black. Each raised level is lighter, and menus, popovers and dialogs are the lightest plane, with a subtle top highlight, so they clearly sit above the page. Grey text was rebalanced so it reads as strongly as it measures, accents used as text are softer, and status colours sit on dark, quiet tints.
- Every overlay (menus, selects, popovers, tooltips, toasts, dialogs, sheets and the command palette) now sits on its own plane, and cards inside it are flat with a border.
- One focus ring everywhere: solid, with a small gap so it stays visible on brass. In the light theme it was too faint before (1.95:1, now 4.7:1). Closing a dialog or sheet returns focus to the button that opened it.
- Quieter, more precise shape and motion. Corners follow one scale (8 px controls, 12 px cards, 16 px panels; it was 10/14/20 plus 14 hand-written sizes). Interface motion runs 120–240 ms (it was 200–400 ms), and keyboard choices don't animate.
- Hover, pressed, selected and disabled states look the same everywhere, and text on coloured chips uses its own darker or lighter shade (a green chip in light was just under 4.5:1).
- The one-page dashboard's KPI tiles are neutral cards with a small tinted icon, instead of a different colour each. The faintest heatmap and tile-map cells are now visible in both themes.
- A new test reads both themes and checks every text level, the focus ring, accent and status text on every surface, and dark surfaces getting lighter at each level, using both WCAG and APCA contrast. The chart palettes keep their colour-blind validation.

Files: `src/styles/primitives.css`, `src/styles/theme-light.css`, `src/styles/theme-dark.css`, `src/styles/tokens.css`, `src/app/globals.css`, `src/ui/primitives/`, `src/ui/charts/`, `src/ui/workspace/`, `src/ui/site/`, `src/ui/landing/`, `src/lib/utils.ts`, `src/app/brand-art.ts`, `tests/theme-contrast.test.ts`, `tests/theme-utilities.test.ts`, `docs/DESIGN.md`, `CLAUDE.md`

## 47.0 · Less text on screen, the full text one gesture away

*Major · 2026-10-21 10:36 UTC · Design, Feature*

The workspace shows much less text, especially on phones. Explanations, hints and notes are one short line, and the full text opens on hover or keyboard focus on a computer, and on a long press or a tap of the ⓘ on a phone. Nothing was removed: every sentence is still there when you want it.

- Step intros, hints, notes and “why” sentences are one short line, with the full text behind it.
- On a computer, hover over the short text or its ⓘ, or tab to it with the keyboard. On a phone, long-press the text or tap the ⓘ. Escape, a click elsewhere or moving away closes it.
- Long values (file names, chart takeaways, insight text, column samples) are cut to one or two lines and open in full the same way, only when they were actually cut.
- On phones, secondary lines (formulas, data-to dates, chart-type explanations, file details) move behind an ⓘ.
- Headings, numbers, buttons, selected values and warnings stay in view. Warnings are shorter but never hidden.
- Visible words at phone width, before → after: Settings 267 → 81, Customise › Create a chart 828 → 117, Customise › Charts 607 → 230, Customise › KPIs 535 → 263, Export 451 → 279, Questions 205 → 137.

Files: `src/ui/primitives/reveal.tsx`, `src/ui/workspace/`, `src/ui/workspace/customise/`, `src/ui/workspace/dashboard/`, `src/ui/charts/ChartCard.tsx`, `CLAUDE.md`

## 46.0 · Workbooks with several sheets, joined into one table

*Major · 2026-10-21 09:54 UTC · Feature, Data, Tests*

An Excel workbook laid out like a small data model (Orders plus Customers, Products and Stores sheets) is now analysed as one table. Loupe finds the keys between the sheets, joins the lookup sheets onto the main one, and says exactly what it did; you can still choose a single sheet.

- Keys are found even when they're spelled differently (“Customer ID”, “CustomerID”, “cust_id”), and a bare “ID” on a Stores sheet matches “Store ID”. One more level is joined too (Orders → Products → Categories).
- A sheet is joined only when its key is unique and never blank, and at least 90% of the main sheet's keys are found in it. Otherwise it is left out, and the reason is given in words.
- Every row of the main sheet is kept exactly once and in order, and its own columns are untouched. A clashing column name is prefixed with its sheet (“Customers · Region”), and rows whose key isn't found are counted.
- Detect shows what was joined (“Orders joined with Customers (on Customer ID) and Products (on Product ID)…”), with “Use one sheet instead” to go back to the sheet picker. Workbooks whose sheets don't relate work exactly as before.
- A lookup sheet's own figures, such as a product's unit cost, repeat on every order of that product, so they are averaged, never summed.
- The CSV, the SQL table and the Power BI package hold the joined table, and the Power BI README says which sheets it was joined from and on which keys. It isn't presented as a model of separate tables.

Files: `src/engine/parse/relate.ts`, `src/engine/core/model.ts`, `src/engine/parse/index.ts`, `src/engine/parse/limits.ts`, `src/engine/session.ts`, `src/engine/export/readme.ts`, `src/engine/export/tmdl.ts`, `src/engine/export/sqlFile.ts`, `src/store/workspace.ts`, `src/ui/workspace/WorkbookModelNotice.tsx`, `src/ui/workspace/DetectStep.tsx`, `src/ui/workspace/UploadStep.tsx`, `src/content/glossary.ts`, `tests/workbook-model.test.ts`

## 45.0 · Learns from your corrections, in your browser

*Major · 2026-10-21 08:06 UTC · Feature, Security, Tests*

When you correct Loupe (the industry, a column's role, a field mapping, a value meaning, or a hidden column), it remembers this in your browser and applies it to the next file with the same or very similar columns, saying so, with Undo. Only column names and your choices are stored; nothing leaves the browser.

- A file like one you've corrected before opens with your earlier choices applied, and a notice on Detect and Check & map lists them: “Using what you told Loupe last time for a file like this: industry Sales & Retail, 1 field mapping”. Undo takes them back for this file; Forget deletes the rule.
- Your choices in the current session always win. A remembered choice that names a column the new file doesn't have is skipped.
- Teach Loupe a word: when you map a column to a field by hand, you can choose “Remember ‘header’ as field for future files”. Taught words also help Loupe recognise the industry of later files.
- Settings has a new “What Loupe has learned” section. List, delete or clear what it has learned, or export it as a file and import it on another computer, so a team can share it. Malformed files are refused.
- Stored only in this browser, as column names and choices, never your data values. Demo datasets neither learn nor use anything, so they always look the same.

Files: `src/store/learned.ts`, `src/engine/detect/learned.ts`, `src/ui/workspace/LearnedNotice.tsx`, `src/ui/workspace/LearnedSettings.tsx`, `src/store/workspace.ts`, `src/engine/session.ts`, `src/workers/engine.worker.ts`, `src/ui/workspace/DetectStep.tsx`, `src/ui/workspace/MapStep.tsx`, `src/ui/workspace/SettingsSheet.tsx`, `tests/learned-rules.test.ts`

## 44.0 · Better dashboards for any other table

*Major · 2026-10-21 07:29 UTC · Feature, Tests*

When no industry fits (weather, indicators, surveys, practice datasets, logs, lookup tables), Loupe now works out what kind of table it is, says so in a plain sentence, and builds KPIs and charts that suit it, instead of generic totals.

- A plain description of the table, shown on Detect, Check & map and the dashboard: “Daily readings of 4 measures at 7 locations”, “12 countries × 10 years of 4 indicators”, “300 survey responses to 5 questions”, “400 rows with a yes/no outcome (Survived: 40.0% yes)”, “Lookup table: 120 countries and their attributes”.
- Time series and panels show levels such as temperature, prices, rates and population as their latest value, averaged across places or countries, never summed over dates.
- Surveys get responses, % favourable (top two boxes) per question, average ratings, and NPS only when there is a 0–10 “recommend” question.
- Tables with an outcome column (practice datasets) get the outcome rate or class mix, and the average of each feature by outcome.
- Event logs get events and distinct users over time, by weekday and by type. Lookup tables get breakdowns of their attributes.
- Charts suit the shape: trend, seasons, top N, distribution, a scatter of the two most correlated measures (computed from your rows), and cross-tab heatmaps.
- Every one of these KPIs compiles to SQL and DAX, and a new test checks them against DuckDB on realistic tables and on every benchmark table that no industry fits.

Files: `src/engine/detect/tableShape.ts`, `src/engine/detect/generic.ts`, `src/engine/session.ts`, `src/engine/export/dictionary.ts`, `src/ui/workspace/DetectStep.tsx`, `src/ui/workspace/MapStep.tsx`, `src/ui/workspace/dashboard/DashboardStep.tsx`, `tests/generic-dashboards.test.ts`

## 43.0 · Ten more industries

*Major · 2026-10-21 06:32 UTC · Feature, Data, Fix*

Loupe now knows 26 industries, up from 16. It recognises procurement, product analytics, project management, restaurants, energy and utilities, agriculture, non-profit, pharma, travel and media files, with their own KPIs (each proven against DuckDB), charts and glossary entries. On the real-world benchmark the right industry is named first for 81.7% of tables, and a wrong one is presented without asking for 0.4%.

- Procurement: purchase orders, goods receipts, supplier masters and spend, with total spend, average PO value, supplier on-time delivery, lead time and rejection rate.
- Project management: Jira, Asana and Monday issues, timesheets and project portfolios, with done %, lead time, sprint velocity, billable hours %, cost overrun and on-time completion.
- Product analytics: event logs, sessions, user tables and app metrics from Mixpanel, Amplitude, GA4 and similar, with active users, average DAU, D1/D7/D30 retention, bounce rate and conversion.
- Media: viewing logs, content performance, catalogues and box office, with watch time, completion rate, net subscribers and gross-to-budget multiple.
- Restaurants: bills, item lines and Swiggy/Zomato delivery orders, with average bill value, covers, spend per cover, items per bill and platform commission.
- Travel and airlines: bookings and PNRs, flight operations, route traffic and passenger surveys, with on-time performance, average delay, load factor and cancellation rate.
- Energy and utilities: meter readings, billing and collection, outages and plant generation, with collection efficiency, AT&C loss, SAIDI/SAIFI and capacity factor.
- Agriculture: crop statistics, mandi arrivals and prices, farmer procurement and dairy collection, with yield, weighted modal price, fat and SNF.
- Non-profit: donations, donors, grants and volunteers, with total raised, average gift, recurring share, lapsed donors and grant success rate.
- Pharma: pharmacy sales, medical-rep field calls, stock batches with expiry, and clinical-trial adverse events.
- Fixed: when a file had a column called “Period”, some SQL grouped by that column instead of by month.

Files: `src/registry/domains/`, `src/registry/index.ts`, `src/ui/common/domain-icon.tsx`, `src/engine/compile/sql.ts`, `tests/fixtures/detection.json`, `tests/benchmark.test.ts`

## 42.0 · Understands the tables analysts build

*Major · 2026-10-17 12:28 UTC · Feature, Data, Tests*

Loupe now recognises the tables analysts make themselves (MIS summaries, KPI scorecards, target vs achievement sheets) and tells shop and B2B sales apart from online shopping. On the real-world benchmark the right industry is named first for 80.0% of tables (up from 67.3%), and a wrong industry is presented without asking for 0.8% (down from 2.3%).

- Tall scorecards (one row per metric, such as “Metric | Month | Actual | Target”) are recognised. The Detect step offers to turn the metrics into columns, each with its own unit. Until then, no KPI adds or averages figures of different metrics together; each metric gets its own KPI instead.
- Plan and actual columns are paired (Target and Achievement, Budget and Actual, Plan and Ist, LY and TY), giving attainment, variance and growth-vs-last-year KPIs that compile to SQL and DAX like every other KPI.
- KPI names are evidence of an industry: a column or metric named GNPA, ARPU, RevPAR, OTIF, CSAT or Attrition % points to its industry. KPIs now carry the abbreviations analysts use.
- Shop, POS and B2B sales are told apart from online shopping: tills, cashiers, bills, stores, distributors and sales reps point to Sales & Retail, while shipping, couriers, COD and marketplaces point to E-commerce.
- A new Store & POS sales shape, with revenue, bills, average bill value, units per bill, sales per store and card & UPI share.
- The benchmark's floors were raised to the new scores.

Files: `src/engine/profile/structure.ts`, `src/engine/profile/pairs.ts`, `src/engine/parse/pivot.ts`, `src/engine/session.ts`, `src/engine/detect/detect.ts`, `src/engine/detect/match.ts`, `src/engine/detect/generic.ts`, `src/engine/kpi/columnKpis.ts`, `src/registry/schema.ts`, `src/registry/domains/`, `src/ui/workspace/DetectStep.tsx`, `tests/scorecard.test.ts`, `tests/pairs-and-kpi-names.test.ts`, `tests/sales-vs-ecommerce.test.ts`

## 41.0 · Reads every column, in your language and your format

*Major · 2026-10-17 11:04 UTC · Feature, Data, Tests*

Loupe now reads columns the way an analyst does, in whatever language, currency and format the file uses. On the real-world benchmark it reads 99.1% of labelled columns correctly, up from 88.8% (97.7% on the held-out tables nobody tuned against), and it names the right industry more often (67.3%, up from 63.6%) without presenting a wrong one any more often.

- Headers in Spanish, Portuguese, French, German, Italian and Hindi written in Latin letters are understood. “Receita Líquida”, “Montant”, “Betrag”, “Umsatz”, “Cidade”, “Rashi” and “Bikri” mean what they say, so those columns map to the right fields and KPIs. Accents no longer break words apart.
- A currency in the header makes a column money: “ADR (€)”, “AUM (₹ Cr)”, “Receita (R$)”, “copay_usd”. The dataset's currency is taken from it too, so a file headed “Amount (USD)” shows dollars, not rupees.
- Prices per unit (“Cost per item”, “Avg. CPC”, “₹/kg”, “GDP per capita”) are money that is averaged, never summed.
- Columns that only looked like money are read correctly: counts (“Total Orders”, “Active Loans”, “Population, total”), physical quantities (“Budget Cement (MT)”, “Net Wt (gms)”) and plain values (“Value” in a scorecard).
- 0/1 columns that are really yes/no (“Machine failure”, “settled”, “cancelled”, “no_show_flg”) are treated as yes/no, not summed. Yes/no written as Sí/No, Sim/Não, Oui/Non, Ja/Nein, Haan/Nahi and in other languages is read too, and exports keep your own words.
- IDs are told apart from counts: order, invoice and document numbers are IDs, while “# Customers”, “Number of Employees” and “tickets_created” are counts. Standard codes are recognised, such as GSTIN, IFSC, IBAN, UHID, NPI and MRN.
- Dates written with month names in 13 languages, like “14 de março de 2024” or “3. März 2024”, are read. So are dates with the time first, month-only values (“01.2025”), ISO weeks (“2024-W12”) and more Unix timestamps.
- Numbers written with a scale word are read at full size, and the parse report says so: “14.5 Lacs” is 1,450,000 and “₹1.2 Cr” is 12,000,000. This happens only where the header or the values show it's money or name the scale.
- Places beyond India and the US are recognised: the states of Brazil, Canada, Australia and Mexico, country names in other languages and three-letter country codes, UK and four-digit postcodes, and many more cities. They are places to group and filter by; the state tile map stays India and US only. A status column holding “ok” is no longer read as Oklahoma.
- Ratings, retention and progress figures are averaged as rates. Long free text (narrations, ticket subjects, comments) is read as text rather than a category.
- On the one-page dashboard, a long headline figure (such as R$607.20) now shrinks to fit its tile instead of being cut off.
- The benchmark's floors were raised to the new scores, and four new test suites cover the vocabulary, the column rules, the parser and the places.

Files: `src/engine/profile/names.ts`, `src/engine/profile/roles.ts`, `src/engine/profile/geo.ts`, `src/engine/profile/patterns.ts`, `src/engine/profile/profile.ts`, `src/engine/profile/types.ts`, `src/engine/parse/words.ts`, `src/engine/parse/dates.ts`, `src/engine/parse/values.ts`, `src/engine/parse/builder.ts`, `src/registry/domains/real_estate.json`, `src/ui/workspace/customise/chartDraft.ts`, `src/ui/workspace/dashboard/page/OnePage.tsx`, `tests/names-vocabulary.test.ts`, `tests/column-roles.test.ts`, `tests/parse-world.test.ts`, `tests/geo-places.test.ts`, `tests/header-currency.test.ts`, `tests/benchmark.test.ts`, `tests/helpers/layouts.ts`, `CLAUDE.md`

## 40.0 · A real-world benchmark for recognising data

*Major · 2026-10-17 09:28 UTC · Tests, Data, Docs*

Loupe is now measured against 265 tables analysts actually work with, from business tools, public datasets and spreadsheets analysts build themselves. Each is labelled with its industry, data shape and column roles. This shows honestly how well Loupe recognises data it was not built around, and every improvement from here is measured against it.

- 265 new table layouts in eight families: shops and marketplaces; sales and marketing; finance, banking and insurance; people and support; manufacturing, logistics and telecom; healthcare, education, hotels and property; public datasets; and analyst-made tables.
- Sources include tool exports (SAP, Tally, Zoho, QuickBooks, Salesforce, GA4, Jira, Workday, Shopify and many more) and practice datasets (Kaggle, UCI, World Bank, Microsoft's AdventureWorks, Contoso and Northwind). They also include analyst-built tables: MIS summaries, pivots, budget vs actual, scorecards, cohorts and data-warehouse tables.
- Headers come as they are written in practice: snake_case, camelCase, ALL CAPS, abbreviations, units in brackets, and Spanish, Portuguese, French, German and Hindi in Latin letters. Values use local formats such as lakh grouping, decimal commas, bracketed negatives and many date styles. All people and companies are made up.
- Each table is scored on four things: is the industry named first, is the data shape right, is each labelled column read correctly, and is a wrong industry ever presented without asking. The last is the failure that matters most.
- 40% of the tables are held out, chosen by a fixed rule rather than by their authors. Later work tunes against the rest, so the held-out score is the honest estimate for files nobody has seen.
- Tables from ten industries Loupe doesn't cover yet (procurement, product analytics, projects, restaurants, energy, non-profit, travel, pharma, media, agriculture) are scored apart: until an industry exists, the right answer is to ask.
- The starting point: industry named first 64.1% of the time (66.7% held out), shape 85.7%, column roles 87.6%, and a wrong industry presented without asking on 2.3% of tables. These scores are now floors that can only go up.
- `npm run benchmark` writes the full report, by family, split and scope with every miss, to docs/DETECTION-BENCHMARK.md. The roadmap of the next steps is on this page under Up next.

Files: `tests/benchmark.test.ts`, `tests/fixtures/benchmark/`, `tests/helpers/layouts.ts`, `tests/detect.test.ts`, `scripts/benchmark.mjs`, `docs/DETECTION-BENCHMARK.md`, `package.json`, `src/content/changelog.ts`, `CLAUDE.md`

## 39.0 · A type system that reads like a report

*Major · 2026-10-17 07:31 UTC · Design, Performance, Tests, Docs*

Loupe has a new type system. Inter, a typeface drawn for reading on screens, now sets every word and every number. The serif is kept for headings and a monospace for code only. Small text is larger, and every size, spacing and weight comes from one scale used across the app, the charts and the exports.

- Inter replaces Geist as the interface typeface. It has optical sizes: small text gets open, easy-to-read letters and headings a tighter, more refined cut, from the same font.
- Numbers are set in Inter with tabular figures, no longer in a monospace. A KPI value now reads like a figure in a finance report rather than a line of code, and a column of numbers still lines up digit for digit.
- Larger small print. Captions, hints and helper text went from 11 to 12 px, and explanatory paragraphs from 13 to 14 px. 11 px is kept for small uppercase labels and counters, and no text anywhere is smaller than that, chart labels included.
- One type scale. 36 hand-picked text sizes and 14 letter-spacings were replaced by named sizes: 11 to 16 px and up for text, and 28 to 88 px for serif headings. Each size has its own line height and spacing. Small uppercase labels now share one style everywhere.
- The serif (Instrument Serif) is used only for headings of 28 px and up, where it reads well. Smaller serif text and serif figures are now set in Inter.
- Your data appears exactly as written. In the data grid, the samples and table views, letters that are easy to confuse are drawn distinctly: I has serifs and l has a tail. Nothing is joined into a symbol, so “->” stays “->”.
- Charts: value labels and value axes use Inter, no longer the monospace. Charts redraw once the fonts have loaded, so none keeps a stand-in font. On a card too small to hold the state codes, the state tile map leaves them off; hovering still names each state.
- The SQL and insights PDFs embed Inter, with Geist Mono kept for the code.
- The report and slides follow the same rules, with no text under 12 px on a report page or 18 px on a slide.
- The KPIs' SQL and DAX page (HTML) shows values in a sans with tabular figures, and the picture shown when a link is shared sets its headline in the serif.
- Lighter loading. Inter is split into a Latin file that loads with the page and an extended file (Central European, Vietnamese, Greek) that downloads only when a page shows one of those characters. The code font loads only where code is shown. Every font is self-hosted, with its licence, and nothing is fetched from a font service.
- Layout fixes for the new sizes: date and number columns in the data grid are wide enough for a whole value, and KPI rows in Customise no longer squeeze their names on phones. The Detect step's next button keeps its height on phones, and labels that don't fit are cut short and show in full on hover.
- A test keeps the system in place: no hand-picked sizes or spacing, the serif only at heading sizes and the monospace only in code, chart text at 11 px or more, and font files that cover exactly the characters the app declares.

Files: `src/app/globals.css`, `src/app/layout.tsx`, `src/app/fonts/`, `public/fonts/`, `scripts/subset-fonts.py`, `src/lib/utils.ts`, `src/ui/primitives/`, `src/ui/charts/tokens.ts`, `src/ui/charts/options.ts`, `src/ui/common/hooks.ts`, `src/ui/workspace/export/textPdf.ts`, `src/ui/workspace/export/report.tsx`, `src/ui/workspace/export/slides.tsx`, `src/engine/export/codeHtml.ts`, `src/app/opengraph-image.tsx`, `src/ui/landing/`, `src/ui/site/`, `src/ui/workspace/`, `tests/typography.test.ts`, `tests/chart-options.test.ts`, `docs/DESIGN.md`, `docs/ANALYST-STANDARDS.md`, `CLAUDE.md`

## 38.0 · A glossary for learning the language of data

*Major · 2026-10-16 21:21 UTC · Feature, Docs, Tests*

A new Glossary page, linked from the footer, explains every word Loupe uses for someone new to data: a learning path from the basics to the KPIs of 16 industries, each term with its level, an example and where to find it in the app.

- 127 terms in a learning path: basics, numbers, time, charts, analysis methods, data quality, and reports and exports. Each says what it is, why it matters, an example with round numbers, where you meet it in Loupe, and related terms to read next.
- Every term has a level (Beginner, Intermediate or Advanced): choose Beginner and read from the top, or show every level.
- Which chart for which question: all 33 chart types Loupe draws, grouped by the question they answer, in the same words as the chart builder.
- Industry KPIs: pick one of 16 industries to see the tables Loupe recognises in it, what to watch out for in its data, and every one of its KPIs (379 in all) with its definition, formula, unit, which way is good, the data it applies to, its benchmark where one is known, and its pitfalls. These are the definitions the app computes with.
- Search across all of it at once: press / anywhere on the page. Results bring up terms, charts and every industry's KPIs together.
- Every term and industry has its own link (/glossary#term-grain, /glossary#industry-hr), so a definition can be shared.
- The footer has a new Learn column: Glossary, Data basics, Chart types and Industry KPIs.

Files: `src/content/glossary.ts`, `src/ui/site/Glossary.tsx`, `src/app/glossary/page.tsx`, `src/ui/site/SiteFooter.tsx`, `tests/glossary.test.ts`, `docs/ANALYST-STANDARDS.md`, `CLAUDE.md`

## 37.0 · A one-page dashboard, the page you present

*Major · 2026-10-16 20:20 UTC · Feature, Design, Tests, Docs*

The dashboard now opens as a single landscape page, laid out the way analysts build a report page for an executive: slicers on the left, a title banner, six headline KPIs, five key charts with their takeaways and the key insights. Download it as one 4K image or a one-page PDF.

- A sidebar of slicers: the period (with the calendar years in your data) and your main filters, each showing what is selected (“All”, “Apparel”, “3 selected”), and the file the numbers come from. Changing a slicer updates the whole page.
- A banner with the page's title (click it to rename the page), what the page covers from its KPIs (“Revenue | Orders | Profitability | Fulfilment”), the period and what the changes compare with.
- Six headline KPI tiles, each with an icon for its kind of measure, a tint from your chart colours, its value and its change.
- Five charts picked from your dashboard: the main trend across two thirds of the page with a share of the whole beside it, then three breakdowns about different things. Each is led by its one-sentence takeaway.
- Read without hovering: a short trend prints every month's value, and a donut lists its slices with their shares beside the ring, where they never overlap.
- The key insights along the foot of the page, each with the sentence that holds its numbers.
- Download page (PNG, 3840 × 2160) or PDF from the dashboard itself, or from Export, where a new One-page dashboard card shows the page in miniature with the charts it holds. The file is exactly the page on screen.
- All charts switches to the full dashboard, by section, as before. The view and the page's title are saved with your settings. On a phone the page stacks into one column.
- Charts keep one axis each: bars and a line on two different scales are never combined, because the shape they make depends on how the two scales happen to line up.

Files: `src/ui/workspace/dashboard/page/pagePlan.ts`, `src/ui/workspace/dashboard/page/OnePage.tsx`, `src/ui/workspace/dashboard/page/PageView.tsx`, `src/ui/workspace/dashboard/DashboardStep.tsx`, `src/ui/workspace/ExportStep.tsx`, `src/ui/charts/options.ts`, `src/ui/workspace/export/report.tsx`, `src/store/workspace.ts`, `src/engine/export/config.ts`, `tests/one-page.test.ts`, `docs/ANALYST-STANDARDS.md`, `CLAUDE.md`

## 36.6 · Home page: steady on phones, links that always work

*Minor · 2026-10-16 20:19 UTC · Fix, Design, Performance*

The home page no longer jumps while its figures count up on a phone, its trend lines draw end to end, every section link lands where it should, and its words match what the app does today.

- On phones the page no longer jumps while the preview's figures count up (layout shift from 0.158 to 0.001), and the menu's links land exactly on their sections.
- The preview's trend lines run all the way to the latest month; before, they stopped two thirds of the way across.
- The header's frosted glass blurs again in Chrome, Edge and Firefox.
- No sideways scrolling on 320 and 360 px phones; the header doesn't wrap between 768 and 1024 px; the “Make it yours” step fits its frame.
- Section links in the footer and the hero always scroll to their section, even when clicked twice.
- Animations pause when they are off screen, and the industries' moving rows have a Pause button.
- The words match the app: presentation slides instead of PNG, the real names of the SQL checks, limits and date formats taken from the code, and SQL and DAX claimed for KPIs only.
- The 404 page, the version log and the workspace have their own titles and social previews; there is now a favicon, an Apple touch icon and a social image.
- Without JavaScript the preview shows its real figures, and the demo links open straight on the dashboard. The version log names its time zone and lists follow-ups newest first.

Files: `src/ui/landing/HeroPreview.tsx`, `src/ui/landing/HeroStage.tsx`, `src/ui/landing/Pipeline.tsx`, `src/ui/landing/Bento.tsx`, `src/ui/landing/sections.tsx`, `src/ui/landing/motion.tsx`, `src/ui/landing/MarqueeGroup.tsx`, `src/ui/landing/preview-data.ts`, `src/ui/site/SectionLink.tsx`, `src/ui/site/SiteHeader.tsx`, `src/ui/site/SiteFooter.tsx`, `src/ui/site/CreditBar.tsx`, `src/ui/site/ChangelogTimeline.tsx`, `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/app/page.tsx`, `src/app/not-found.tsx`, `src/app/opengraph-image.tsx`, `src/app/apple-icon.tsx`, `src/app/brand-art.ts`, `src/app/favicon.ico`

## 36.5 · Exports are the dashboard as you left it

*Minor · 2026-10-16 20:18 UTC · Fix, Tests*

The slides, the report and the insights now follow your Customise choices, leave out charts that can't be drawn, and write each KPI the way the dashboard does. The SQL check ends cleanly when it can't start and says exactly what it compares.

- Slides, the report and the insights PDF follow your KPI layout and your chart titles from Customise.
- A chart that can't be drawn now (a hidden column, a deleted KPI) is left out and named on the card, instead of being exported as an error message.
- Large counts read 1.75L and 15.9Cr in every export, as on the dashboard.
- Verify stops within seconds with a clear message when DuckDB can't be downloaded, instead of spinning forever. It says it compares Loupe's whole-file values (all 49,037 rows), not the dashboard's selection, and uses your KPI names.
- Report figures no longer overlap their notes, and tables fill their space exactly.
- In the four-a-slide deck, a long horizontal bar chart gets a slide of its own so every bar keeps its name.
- The SQL file's example names a view that exists; the Power BI model builds every date column it promises; your own charts and titles appear in its README; measure names keep their acronyms (“Total MRR”).
- The report has the same “other columns” switch as the slides, and the two slide densities download under different names.
- Smaller fixes: no hidden tab stop, focus returns after the Power BI question, and the Verify table scrolls.

Files: `src/ui/workspace/ExportStep.tsx`, `src/ui/workspace/export/exportCharts.ts`, `src/ui/workspace/export/slides.tsx`, `src/ui/workspace/export/slidePlan.ts`, `src/ui/workspace/export/report.tsx`, `src/ui/common/kpiFormat.ts`, `src/ui/workspace/NewColumnsDialog.tsx`, `src/lib/duckdb.ts`, `src/engine/export/sqlFile.ts`, `src/engine/export/tmdl.ts`, `src/engine/export/readme.ts`, `src/engine/export/names.ts`, `src/engine/export/powerbi.ts`, `src/engine/export/dashboardCharts.ts`, `src/engine/session.ts`, `tests/export-fixes.test.ts`, `tests/slides.test.ts`, `tests/export.test.ts`

## 36.4 · Questions answered as asked, insights that hold up

*Minor · 2026-10-16 20:17 UTC · Fix, Tests*

A question that names a place, a status or a period is now answered for it, and a question Loupe can't fully read is refused, saying which words it couldn't read, rather than answered as a different question. Insights no longer compare things that can't be compared, and they follow your filters.

- Values, statuses and periods in a question become filters: “net revenue in Maharashtra” gives ₹50.3L, as on the dashboard; “how many orders were cancelled” counts the cancelled ones; “in 2026” and “in September 2026” narrow the rows.
- Words Loupe can't read are named and the question is refused (“nothing in your file matches ‘warehouse’…”), never quietly answered for everything.
- A KPI named in a question is read as that KPI (“average order value” is ₹2.07K, as on its card), and typing a suggested question gives the same answer as clicking it.
- The SQL check no longer reports a difference for a blank group, and a ranking with several measures returns the answer's rows.
- Insights no longer compare per-customer or per-rep KPIs across segments (where the gaps were artefacts), merge repeats about the same pair, link only a chart that shows them, and follow the filters; an empty selection says so.
- Answers reuse the chart takeaways, write money compactly and with one precision per sentence, and get a chart for lowest-first questions; every answer card has Edit.
- The step says which rows the dashboard's filters keep. The AI summary sends rates in percentage points with a true minus sign.
- The insights PDF writes numbers as the report does; the questions PDF keeps each heading with its text.
- Ask for a chart: “top 5” draws five bars without an Others bar, and words it leaves out are said.

Files: `src/engine/charts/ask.ts`, `src/engine/charts/answer.ts`, `src/engine/compile/questionSql.ts`, `src/engine/insights/insights.ts`, `src/engine/core/together.ts`, `src/engine/session.ts`, `src/ui/workspace/QuestionsStep.tsx`, `src/ui/workspace/InsightsStep.tsx`, `src/ui/workspace/AiSummary.tsx`, `src/ui/workspace/aiSummaryPayload.ts`, `src/ui/workspace/dashboard/AskChart.tsx`, `src/ui/workspace/export/documents.ts`, `src/ui/workspace/export/textPdf.ts`, `tests/questions.test.ts`, `tests/ask.test.ts`, `tests/insights.test.ts`, `tests/ai-payload.test.ts`

## 36.3 · Dashboard and charts: takeaways that never overstate

*Minor · 2026-10-16 20:16 UTC · Fix, Tests*

Chart takeaways now say only what their chart can support, KPI changes always describe the number beside them, and filters work on phones.

- Filters work on phones: a filter's list of values opens on screen.
- A chart that shows only its top groups says “lowest of the 12 shown”, and the card says what was left out, instead of naming a false lowest.
- A scatter's takeaway follows the direction of the fit (“attrition rate falls as engagement rises”); frequently-bought-together names its strongest pairing as such; a 100% stack speaks in shares.
- A KPI card's change always describes the number beside it: over all time it names the month and that month's value. Year to date is compared with the same months a year earlier.
- Monthly snapshot data (MRR) isn't offered day-based periods, and its trends aren't drawn finer than the data. KPI details say correctly whether a KPI adds up, counts distinct things, is a snapshot or is a ratio.
- Monthly axes show the year even when every other month is shown; a one-day range reads “30 Sep 2026”.
- Horizontal bars keep every name, labels wrap at spaces and treemap names no longer break mid-word.
- A renamed KPI's new name reaches chart labels and tables. A chart's PNG carries its title, takeaway, unit and source; its CSV names the axis and rounds.
- Rosters (HR): the no-comparison note is said once, there are no misleading trend lines, tenure is in years and job levels read in order.
- Wording: weekdays in full, “on 27 Sep”, “Up 1,941%”, and percentages above 100% keep their decimal. An emptied chart offers Clear filters.

Files: `src/engine/charts/headline.ts`, `src/engine/charts/data.ts`, `src/engine/charts/types.ts`, `src/engine/charts/recommend.ts`, `src/ui/charts/options.ts`, `src/ui/charts/ChartCard.tsx`, `src/ui/charts/DataTable.tsx`, `src/ui/charts/chartImage.ts`, `src/engine/core/dates.ts`, `src/engine/core/format.ts`, `src/engine/core/periods.ts`, `src/engine/query/groupby.ts`, `src/engine/kpi/compute.ts`, `src/engine/kpi/columnKpis.ts`, `src/engine/export/csv.ts`, `src/registry/domains/hr.json`, `src/ui/workspace/dashboard/KpiCards.tsx`, `src/ui/workspace/dashboard/KpiDetails.tsx`, `src/ui/workspace/dashboard/FilterRail.tsx`, `src/ui/workspace/dashboard/Inspector.tsx`, `tests/chart-headline.test.ts`, `tests/chart-options.test.ts`, `tests/charts-data.test.ts`, `tests/column-kpis.test.ts`, `tests/periods.test.ts`

## 36.2 · Check & map and Customise: titles that follow the data

*Minor · 2026-10-16 20:15 UTC · Fix, Design, Tests*

A chart's automatic title now follows its data when you edit it, charts that can no longer be drawn are flagged, and the mapping says what each change does. A KPI whose column you hid says so.

- Editing a chart's data keeps only a title you typed: change its measure or column and the automatic title, and its takeaway, follow.
- Charts that can no longer be drawn (a hidden column, a deleted KPI) are flagged in the chart list with the reason; deleting a KPI that charts use asks what to do with them.
- A KPI whose column you hid says “it needs “Order Status”, which you hid in Check & map”, instead of sending you to Value meanings.
- Blood types A+ and A− are no longer reported as misspellings of each other.
- Mapping a column that another field already uses says which field loses it, with Undo; “Used by” says what a field feeds.
- Names Loupe makes read naturally (“Distinct customer ID”, “Total net sales by product category”). Column summaries follow your number format, show percentages as % and drop separators from years and IDs.
- Rename KPIs in Customise (Enter saves); Chart colours in Customise; Undo when deleting your own chart; an edited copy keeps the original's place.
- Phone layouts fit: the tabs, the KPI planner and the column popovers; the chart builder scrolls into view. Better screen-reader names and visible focus on tabs.

Files: `src/ui/workspace/MapStep.tsx`, `src/ui/workspace/VirtualGrid.tsx`, `src/ui/workspace/columnSummary.ts`, `src/ui/workspace/customise/chartDraft.ts`, `src/ui/workspace/customise/brokenCharts.ts`, `src/ui/workspace/customise/ChartList.tsx`, `src/ui/workspace/customise/ChartStudio.tsx`, `src/ui/workspace/customise/CustomiseStep.tsx`, `src/ui/workspace/customise/KpiPlanner.tsx`, `src/ui/workspace/customise/KpiBuilder.tsx`, `src/ui/workspace/customise/KpiNameInput.tsx`, `src/ui/primitives/tabs.tsx`, `src/engine/kpi/userKpis.ts`, `src/engine/kpi/resolve.ts`, `src/engine/profile/quality.ts`, `tests/customise-charts.test.ts`, `tests/column-summary.test.ts`, `tests/data-check.test.ts`, `tests/hidden-columns.test.ts`

## 36.1 · Getting data in: no stuck loads, files read as written

*Minor · 2026-10-16 20:14 UTC · Fix, Tests*

A page-by-page check of the app found problems in loading and detection; they are fixed. Loading never gets stuck, the industry you pick on Detect takes effect, and unusual files are read correctly or refused in plain words.

- Loading never sticks on “Detecting the industry…”: progress messages that arrive after a file has loaded are ignored.
- Switching the date order (DD/MM or MM/DD) keeps everything you set (industry, hidden columns, KPI layout, your KPIs and charts, filters) and stays on the step you were on. It is offered only when the order is uncertain, and asks first when switching would blank dates.
- Changing the industry or data shape on Detect takes effect when you move on; going back with the same choice keeps your Customise layout.
- Repeated or blank column names, and Excel's trailing commas, no longer throw the header away; the renames are noted.
- Empty files, header-only files, images, PDFs and other non-tables are refused with a clear message; pandas' JSON layouts are read.
- An order file is no longer read as returns or as a product catalogue, and “NA” in a text column (North America) stays as written.
- An uncertain day/month order follows your device's time zone, not the previous file, and Detect says which order it assumed. A currency picked for one file no longer carries over to the next.
- Demo links open the requested demo (asking before replacing your own file) and can open straight on the dashboard; Back works after them.
- Start over asks first, and the page warns before a reload would lose your work. Figures that count up never show impossible values; “1 row”, “every 3rd row”, a Sampled badge, and keyboard access to the column list.

Files: `src/store/workspace.ts`, `src/store/settings.ts`, `src/ui/workspace/Workspace.tsx`, `src/ui/workspace/Shell.tsx`, `src/ui/workspace/CommandPalette.tsx`, `src/ui/workspace/UploadStep.tsx`, `src/ui/workspace/DetectStep.tsx`, `src/ui/workspace/HealthPanel.tsx`, `src/ui/workspace/confirm.tsx`, `src/ui/common/hooks.ts`, `src/ui/common/words.ts`, `src/engine/parse/sniff.ts`, `src/engine/parse/csv.ts`, `src/engine/parse/json.ts`, `src/engine/parse/excel.ts`, `src/engine/parse/index.ts`, `src/engine/parse/builder.ts`, `src/engine/parse/dateOrder.ts`, `src/engine/parse/limits.ts`, `src/engine/detect/detect.ts`, `src/engine/profile/profile.ts`, `src/engine/profile/structure.ts`, `src/engine/profile/roles.ts`, `src/engine/samples/catalog.ts`, `src/engine/core/types.ts`, `tests/upload-and-detect.test.ts`, `tests/workspace-flow.test.ts`, `tests/detect.test.ts`

## 36.0 · Presentation slides, and a takeaway on every chart

*Major · 2026-10-16 16:18 UTC · Feature, Design, Fix, Tests, Docs*

The tall dashboard image is replaced by a slide deck: landscape 16:9 slides ready to present, and the Export page tells you how many slides the dashboard takes before you download. Every chart, on the dashboard and in every export, now says in one sentence what it shows.

- Presentation slides on the Export page. The first slide is an overview: the period and what it is compared with, the headline KPIs with their changes and trends, and the key takeaways, each pointing to the slide that shows it. After it come the charts, section by section, each slide titled with the question its section answers (“Where the volume comes from”).
- Choose 2 charts a slide (large, for presenting) or 4 (a compact deck). The card shows the deck in miniature and counts it before anything is made, for example “16 slides · Overview · Trend 3 · Breakdowns 3 · Drivers & segments 8 · Detail”.
- Download the slides as numbered 4K images (3840 × 2160) in one zip, ready for PowerPoint or Keynote, or as one landscape PDF. Each slide carries its number (“4 / 16”) and a source line: file, rows, period and filters.
- On a slide, chart labels, values and table rows are drawn larger so they can be read from across a room. A table or a cohort grid gets a slide of its own.
- A takeaway on every chart, in one sentence computed from that chart's own data: under the chart's title on the dashboard, and leading the chart in the slides and the PDF report. For example “Up 12.7% from Oct 2025 to Sep 2026, ending at its peak of ₹37.9L” or “COD is highest at 16.3%; Wallet is lowest at 1.9%”.
- Takeaways never stretch the numbers. An unfinished month is never read as a fall. A share of the total is given only for figures that add up, so a rate or an average is compared highest to lowest instead. Rates change in percentage points, and “Others” never leads.
- With no comparison period (an employee roster, say), the overview says so once instead of on every card. Over all time, each card names the month its change belongs to.
- Fixed: the 100% column of a cohort grid looked blurred, and the grid's unit line said “Count” although its cells are percentages; it now says “In % of each cohort”.
- The single tall image of the whole dashboard is gone; the slides replace it.

Files: `src/engine/charts/headline.ts`, `src/engine/charts/data.ts`, `src/engine/charts/types.ts`, `src/ui/charts/ChartCard.tsx`, `src/ui/charts/options.ts`, `src/ui/charts/Sparkline.tsx`, `src/ui/workspace/export/slidePlan.ts`, `src/ui/workspace/export/slides.tsx`, `src/ui/workspace/export/report.tsx`, `src/ui/workspace/ExportStep.tsx`, `src/ui/workspace/dashboard/sections.ts`, `src/ui/workspace/dashboard/DashboardStep.tsx`, `src/ui/workspace/customise/ChartList.tsx`, `src/ui/workspace/customise/ChartStudio.tsx`, `tests/chart-headline.test.ts`, `tests/slides.test.ts`, `docs/ANALYST-STANDARDS.md`, `CLAUDE.md`

## 35.3 · A calmer, premium Export page with only the useful exports

*Minor · 2026-10-16 15:34 UTC · Design, Fix*

Export is rearranged into Share and Build on it, each export a compact card with one line of text and a real fact about the file, and the exports nobody needed separately are gone.

- Share: the dashboard report (PDF, with its page count), the dashboard image (PNG, with its chart count) and the insights (PDF), side by side, each with one line on what it holds.
- Build on it: the Power BI package as the featured card, with what's inside and three steps to use it, and after download its files and size; beside it, SQL (the KPI views, the same SQL and DAX in colour, and a one-click check that every KPI query returns the dashboard's number) and Data (cleaned CSV with your headers, data dictionary).
- Removed, because they were already inside the Power BI package or rarely used: the separate measures.dax, the Markdown dictionary, the transparent-PNG switch, the long SQL preview and the SQL lab. The questions-with-SQL PDF appears in the SQL card once you have asked questions.
- Reopening a dashboard later is a slim bar at the bottom: save the settings, load them with the same file.
- Much less text: titles, one line each, and facts such as “A4 · 18 pages”, “31 charts”, “49,037 rows · your headers”.
- Fixed: after a download, a card's contents could slide sideways and be cut off; cards now clip instead of scrolling.

Files: `src/ui/workspace/ExportStep.tsx`

## 35.2 · Check & map says which columns it left out, and why

*Minor · 2026-10-16 15:24 UTC · Feature, Fix, Tests*

“12 of 15 columns used” now opens the answer: the three columns nothing reads, each with the reason and what you can do about it. The KPI count opens the same way, and the page states what your file was read as.

- The column count in Check & map opens a breakdown: every column that isn't used, with the reason in plain words (for example “3,946 different values: too many to group or filter by”, “A second date: periods follow Date of Admission”, “An ID…”), what you could do about it, and a Hide button; the columns you hid, with Use again; and what each used column feeds (“2 KPIs · 4 charts · Date filter”).
- The KPI count opens the list of KPIs: the ones your file supports with the columns they read, and for the others, the column each still needs.
- Your columns has a filter (All · Used · Not used · Hidden), and a column that isn't used says why, right beside it. The note above the table names the unused columns.
- Under the title, one line says what the file was read as: industry and data shape, rows and columns, the date span and which date it follows, and what one row is.
- Fixed: a “Room Number” (and bed, seat, gate, batch numbers and the like) was read as a quantity, so the dashboard could show an average room number. It is now read as an ID: counted, never summed or averaged.

Files: `src/ui/workspace/MapStep.tsx`, `src/engine/charts/columnUsage.ts`, `src/engine/profile/roles.ts`, `tests/column-usage.test.ts`

## 35.1 · A Power BI model and data files built the way analysts build them

*Minor · 2026-10-16 14:28 UTC · Feature, Data, Docs, Tests*

The last round of the analyst review: the Power BI model now follows standard modelling practice, the cleaned data keeps your own column headers, the data dictionary carries what an analyst's dictionary does, and the standards behind all of this are written down for every future change.

- Power BI model: state, city, postal-code and other geographic columns carry their data category, so map visuals place them; hierarchies found in your data (Category → Sub Category → Product Name, region → state → city) are built in for drill-down; the date-only helper column used for the Date table is hidden; and with its own Date table the model turns off Power BI's automatic date tables. The README lists what the model includes.
- Cleaned data (.csv) keeps your file's own column headers; only the values are tidied (ISO dates, dot decimals). The SQL and the Power BI package keep their export names.
- Data dictionary: each column now has its business name, unit (currency, %, date…), range (lowest to highest), whether it is a key, and its allowed values when there are 12 or fewer. The Markdown version lists what each column means under the table.
- New: docs/ANALYST-STANDARDS.md writes down the conventions Loupe now follows (numbers, dates, charts, names, files, the Power BI model and the reports), each with the code that enforces it, so future changes keep to them.
- New tests: geographic data categories, uniquely named hierarchies, the hidden helper column and Auto date/time, the cleaned CSV's own headers, and the dictionary's new fields.

Files: `src/engine/export/tmdl.ts`, `src/engine/export/readme.ts`, `src/engine/export/dictionary.ts`, `src/engine/session.ts`, `src/workers/engine.worker.ts`, `src/ui/workspace/ExportStep.tsx`, `docs/ANALYST-STANDARDS.md`, `CLAUDE.md`, `tests/export.test.ts`

## 35.0 · Presented like an analyst's report

*Major · 2026-10-16 14:16 UTC · Feature, Design, Tests*

The dashboard and the PDF report now follow the conventions professional analysts use: every number in one system, dates that can't be misread, a unit under every chart, colours that stay with each category, and a PDF that reads as a report, with a cover, an executive summary that cites numbered figures, and a glossary.

- PDF report, rebuilt: a cover stating the period (“Last 12 months: 1 Oct 2025 – 30 Sep 2026”), what the changes compare with, the filters, the rows analysed, how recent the data is and the grain; the headline KPIs; an executive summary whose insights cite their figures (“Figure 3”); the supporting KPIs with their changes; numbered figures, each with its unit, notes and source line; and an appendix with a glossary of every KPI shown and the data health.
- Dashboard header: the period in view and how recent the data is (“Last 12 months: 1 Oct 2025 – 30 Sep 2026 · data to 30 Sep 2026”).
- KPI cards say what each change is measured from (“+40.5% from ₹2.23Cr”), in the app and in the report.
- Every chart has a unit line under its title (“In ₹ · monthly”, “In %”, “Count · weekly”), so a number is never read in the wrong unit.
- One unit per axis: ticks read ₹0.9L, ₹1.2L, ₹1.5L instead of mixing ₹90K and ₹1.2L.
- Dates can't be misread: a month is “Oct 2025”, never “Oct 25” (which reads as the 25th), and a month axis shows the year once per year: Oct 2025, Nov, Dec, Jan 2026.
- Negative numbers carry a true minus sign (−1.8%), as in typeset reports. The data grid and the exported files keep the plain hyphen other software reads.
- Colours follow the value: each category keeps the same colour in every chart, under every filter and in every export, chosen by how common it is in the whole file. Filtering no longer repaints the categories that remain, and Others is always grey.
- New tests: one unit per axis, the year once per year, the unit line, minus signs, and colours that survive a filter.

Files: `src/ui/workspace/export/report.tsx`, `src/ui/workspace/ExportStep.tsx`, `src/ui/charts/options.ts`, `src/ui/charts/ChartCard.tsx`, `src/ui/workspace/dashboard/DashboardStep.tsx`, `src/ui/workspace/dashboard/KpiCards.tsx`, `src/engine/charts/data.ts`, `src/engine/charts/types.ts`, `src/engine/core/format.ts`, `src/engine/core/dates.ts`, `tests/presentation.test.ts`

## 34.3 · Names and words a report would use

*Minor · 2026-10-16 14:00 UTC · Design, Fix, Tests*

The third round of the analyst review, on wording: column names read with spaces, every KPI has one name everywhere, sentences are grammatical, and every export is named the same way, as a careful analyst would name them.

- Column names read with spaces wherever Loupe writes them: chart titles, filters, questions and insights say “New order date” and “GST Amount”, not “New_order_date” or “GST_Amount”. Your file, the data grid and the exports keep your headers exactly as written.
- One name per KPI: a chart's legend and tooltip now use the same name as the KPI card (“Average order value”, not “AOV” in one place and the full name in another). KPI names are in sentence case, like the rest of the app: “Net revenue”, “Gross margin %”.
- Grammar: “New customers were 52” (not “was”), “an 85.8 pp gap”, “1 day”, “Saturday” instead of “Sat”, “How have gross sales changed…”, and “This column is…” for a single column.
- “Top 10 plus Others” is only said when there are more than ten groups; a donut's Others is a slice, not a bar; the README no longer points at an analysis note that doesn't exist.
- Filters read the same everywhere: “Category: Apparel”, “Category: not Apparel”, “Order date: 1 Jan – 31 Mar 2026”.
- Power BI: a measure that clashes with a column is named “Total revenue”, as an analyst would, never “Revenue (KPI)”; a measure may share its table's name. The 7-day measure is “Rolling 7D Avg”, in line with “Rolling 30D”.
- SQL views are named after their measures (kpi_net_revenue, kpi_gross_margin_pct, kpi_average_mrp), never after internal ids, and a rate's monthly view gives its change in percentage points.
- Export file names follow one pattern: dataset, what it is, date (for example sales-orders_dashboard-report_2026-10-16.pdf), with the same names as the files inside the Power BI package, whose folder is now named like the zip.
- One word for each thing: rows (not records), insights (not findings), industry (not domain), Custom for what you made, Average (not Avg), the chart names of the chart catalogue, and the same insight types in the app and the PDF.
- Insight advice suits any industry (“Check what happened that day: a one-off event, a bulk entry or a data error”) rather than assuming a shop.
- Small fixes: “Order #” exports as order_num (not order_no, which reads like a yes/no flag), the data dictionary's descriptions are full sentences, and the house chart theme is “Loupe”, not “Loupe · Loupe”.

Files: `src/engine/core/labels.ts`, `src/engine/core/format.ts`, `src/engine/core/dates.ts`, `src/engine/kpi/columnKpis.ts`, `src/engine/kpi/context.ts`, `src/engine/detect/generic.ts`, `src/engine/charts/recommend.ts`, `src/engine/charts/ask.ts`, `src/engine/query/filter.ts`, `src/engine/insights/insights.ts`, `src/engine/profile/roles.ts`, `src/engine/export/names.ts`, `src/engine/export/sqlFile.ts`, `src/engine/export/powerbi.ts`, `src/engine/export/readme.ts`, `src/engine/compile/dax.ts`, `src/engine/session.ts`, `src/registry/domains/ecommerce.json`, `src/registry/domains/manufacturing.json`, `src/lib/utils.ts`, `src/ui/charts/ChartCard.tsx`, `src/ui/workspace/ExportStep.tsx`, `src/ui/workspace/InsightsStep.tsx`, `src/ui/workspace/dashboard/FilterRail.tsx`, `tests/naming.test.ts`

## 34.2 · Charts that never hide or cut what they show

*Minor · 2026-10-16 13:34 UTC · Fix, Design, Tests*

The second round of the analyst review: chart labels are no longer dropped or clipped, an unfinished month no longer looks like a fall, colour scales say what their colours mean, and empty or all-zero selections say so in words instead of looking broken.

- Category names are never hidden: every label on a column chart is shown, wrapped onto two lines when it is long, and a column chart with more than ten named categories is drawn as horizontal bars, one name per row. Labels are no longer tilted. How much of a name fits is worked out from the chart's actual width.
- An unfinished period no longer reads as a drop: the line stops at the last complete month and a dashed segment runs on to the partial one, marked “to 20 Sep”. A short last column says the same.
- Colour scales (state maps, heatmaps, cohort grids) print their lowest and highest values, and the text inside each cell picks the colour that reads on that cell.
- Cohort grids end at the last month any cohort has reached, instead of showing an empty column.
- A chart whose values are all zero now says “Returns is 0 for every courier in this selection.” instead of drawing an empty plot. A KPI card with no rows in the selection shows “—” and says so, instead of a zero and a −100% change.
- A “(blank)” group with no value is left out of category charts, with a note saying how many rows that was.
- Clipping fixed: the Pareto chart's 80% label sits inside the plot, chart notes get two lines, and treemap tiles wrap long names (“New / Customers”) instead of cutting them.
- The executive layout's donut no longer stretches across the whole width with its labels at the far edges; it keeps a compact, centred shape.
- “Frequently bought together” is a full-width table, like every other table.
- The automatic charts for columns the template doesn't use are folded under “Show 8 charts”, so the dashboard leads with the charts chosen for your business. They open by themselves when an insight points at one. The supporting KPI tiles sit on an even grid.
- KPI details: the extra close button inside the panel is gone. It cleared the panel to the chart builder instead of closing it.
- Insights: “How this was found” is folded away instead of repeating the same method under every insight; in the insights PDF a repeated method points back to the first insight that gave it.
- Opening a dropdown no longer nudges the page sideways.
- Currency: “Default: INR” when nothing in the file showed a currency, “Detected” only when something did.
- PDF report and dashboard PNG: tables show as many rows as fit, say how many more there are, and no longer capture scrollbars.

Files: `src/ui/charts/options.ts`, `src/ui/charts/ChartCard.tsx`, `src/ui/charts/DataTable.tsx`, `src/engine/charts/data.ts`, `src/engine/charts/types.ts`, `src/registry/domains/ecommerce.json`, `src/ui/workspace/dashboard/DashboardStep.tsx`, `src/ui/workspace/dashboard/KpiCards.tsx`, `src/ui/workspace/dashboard/Inspector.tsx`, `src/ui/workspace/InsightsStep.tsx`, `src/ui/workspace/DetectStep.tsx`, `src/ui/workspace/SettingsSheet.tsx`, `src/ui/workspace/export/report.tsx`, `src/ui/workspace/export/documents.ts`, `src/app/globals.css`, `tests/chart-options.test.ts`, `tests/charts-data.test.ts`

## 34.1 · Numbers that agree everywhere

*Minor · 2026-10-16 13:10 UTC · Fix, Data, Tests*

A review against how professional analysts build reports found places where a number could mislead: SQL that didn't return the card's value, a question that answered from the wrong measure, rates compared in the wrong unit, and exports that said more than they held. Each is fixed, and tests now check them.

- KPI details › SQL & DAX: the SQL now returns the number on the card. It runs over the card's period and filters (written as the query's WHERE), not the whole file. A KPI that counts customers by their first-ever date can't be filtered that way; its SQL says it covers the whole file.
- Questions: “revenue” now means your Net revenue KPI (which leaves out cancelled, returned and RTO orders), so the answer adds up to the KPI card. Before, it summed the raw amount column. A KPI named for the words you used, give or take “net”, “gross” or “total”, is now preferred over a column.
- Rates change in percentage points everywhere: the insights PDF's headline table, the KPI details' YoY and MoM (40% → 42% is +2.0 pp, not +5.0%), and the Power BI measures, which are now “YoY pp” and “MoM pp” for a rate, with a format of +2.0 pp. The README tells you which one to put on each card.
- A change that shows as 0.0% is grey in the PDF report, as on the dashboard, rather than red.
- Insights PDF: each insight stays on the same page as its chart; charts are numbered (Figure 1, 2…) and drawn once, a later insight pointing back to the figure; a chart's notes (such as an incomplete last month) are printed under it; and a one-day spike no longer shows a monthly chart where it can't be seen.
- Dashboard PNG: holds every chart, not just the first eight, with wide charts across the full row. A very long dashboard is drawn at a slightly lower resolution so the image can still be made.
- Power BI without new columns: the package's SQL keeps its monthly views (SQL adds nothing to Power BI), and the README no longer promises time-intelligence measures it doesn't contain. “SQL & DAX in colour” asks the same question as measures.dax, so its DAX matches the file you get.
- README: the KPI values to check against now say which rows they cover (the whole file, with its dates), and why they can differ from the cards in Loupe. A KPI counted by first-ever date is marked, since over a whole file every customer is new.
- One description of what a row is: the dashboard, the report cover and the data dictionary now use the same wording, built from the key found in your file when it has a real one.
- CSVs for spreadsheets (cleaned data, data dictionary, a chart's data) start with a byte-order mark, so Excel shows ₹, € and accented names correctly instead of garbled characters.
- SQL queries PDF: no longer claims every answer uses a KPI definition; a question about a column uses that column's total or average.
- New tests: DuckDB returns each card's value from its SQL under a date range and a region filter; “revenue” is answered with Net revenue and adds up to the card; rates change in points in the app and in DAX; the README and package follow the column choice; the grain reads the same on the dashboard and in the dictionary.

Files: `src/engine/session.ts`, `src/engine/compile/questionSql.ts`, `src/engine/compile/dax.ts`, `src/engine/charts/ask.ts`, `src/engine/core/format.ts`, `src/engine/kpi/compute.ts`, `src/engine/query/expr.ts`, `src/engine/profile/structure.ts`, `src/engine/export/context.ts`, `src/engine/export/csv.ts`, `src/engine/export/daxFile.ts`, `src/engine/export/dictionary.ts`, `src/engine/export/powerbi.ts`, `src/engine/export/readme.ts`, `src/workers/engine.worker.ts`, `src/ui/workspace/dashboard/KpiDetails.tsx`, `src/ui/workspace/dashboard/KpiCards.tsx`, `src/ui/workspace/export/report.tsx`, `src/ui/workspace/export/documents.ts`, `src/ui/workspace/export/textPdf.ts`, `src/ui/workspace/ExportStep.tsx`, `src/ui/charts/ChartCard.tsx`, `tests/questions.test.ts`, `tests/consistency.test.ts`, `tests/export.test.ts`, `tests/honest-numbers.test.ts`

## 34.0 · Your data as you wrote it, and SQL and DAX you can read

*Major · 2026-10-16 11:28 UTC · Feature, Fix, Design, Tests*

Exports no longer change your data: a column that says Yes/No stays Yes/No. The SQL and DAX are laid out to be read, grouped by topic and coloured so the language stands apart from your own columns and values, including a new page that shows every KPI's SQL and DAX side by side. And the dashboard says each thing once, so there is far less to read.

- Fixed: yes/no columns written as words (Yes/No, Y/N…) were exported as TRUE/FALSE. The cleaned CSV, the Power BI data and model, and the SQL and DAX now keep your words, and their conditions compare with them ('Yes'), so they also run on your own table. Columns that already said TRUE/FALSE stay true/false. Dates are still written as YYYY-MM-DD on purpose, so Power BI and every database read them the same way.
- SQL laid out to be read: a long query is broken over lines, with each condition and each CASE / WHEN / THEN / END on its own line, and conditions that can never filter anything (a status your file doesn't have) are left out instead of showing as 1 = 1.
- kpis.sql: a short header with how to use it and what's inside, a banner per section, and one card per KPI with its name and Loupe's value on the title line, grouped by topic. The notes for MySQL, SQL Server and BigQuery moved to the end.
- measures.dax: the same layout, with the measures grouped by topic and the Date table clearly marked.
- Colour: SQL and DAX in the app (KPI details, Questions & SQL, the Export preview) and in the SQL PDF are coloured, with a key: blue for the language, brass for your table and columns, green for values from your data, grey for notes. The SQL PDF now also shows each KPI's DAX.
- New: “SQL & DAX in colour” (Export › SQL, and inside the Power BI package): one page, opened in any browser, with every KPI's meaning, value, SQL and DAX side by side, grouped by topic with a contents list. A plain-text editor such as Notepad can't colour the .sql and .dax files; this page can.
- Dashboard, calmer: the title and one line of facts (your file, the rows in view of the total, the columns used), with the actions beside them; what the changes compare with is said once above the KPIs instead of on every card; charts no longer repeat the rows, period and filters under their titles (it's in Why this chart); section titles stand alone; and the filter panel no longer squeezes a date range beside every period.
- Fixed: the dashboard can no longer scroll sideways, which on some window sizes cut off the left panel.
- New tests: the SQL layout only ever moves white space, for every KPI of every demo file, and DuckDB still returns the engine's value from the laid-out SQL; yes/no columns keep their words in the CSV, the model, the SQL and the DAX; the colour page is one self-contained file.

Files: `src/engine/core/booleans.ts`, `src/engine/compile/codeTokens.ts`, `src/engine/compile/sqlFormat.ts`, `src/engine/compile/sql.ts`, `src/engine/compile/dax.ts`, `src/engine/compile/questionSql.ts`, `src/engine/kpi/context.ts`, `src/engine/export/csv.ts`, `src/engine/export/tmdl.ts`, `src/engine/export/sqlFile.ts`, `src/engine/export/daxFile.ts`, `src/engine/export/codeHtml.ts`, `src/engine/export/powerbi.ts`, `src/engine/export/readme.ts`, `src/engine/session.ts`, `src/workers/engine.worker.ts`, `src/styles/tokens.css`, `src/ui/common/code.tsx`, `src/ui/workspace/dashboard/KpiDetails.tsx`, `src/ui/workspace/export/textPdf.ts`, `src/ui/workspace/export/documents.ts`, `src/ui/workspace/ExportStep.tsx`, `src/ui/workspace/dashboard/DashboardStep.tsx`, `src/ui/workspace/dashboard/KpiCards.tsx`, `src/ui/workspace/dashboard/FilterRail.tsx`, `src/ui/charts/ChartCard.tsx`, `tests/yes-no-export.test.ts`, `tests/readable-code.test.ts`, `tests/export.test.ts`, `tests/helpers/duck.ts`, `CLAUDE.md`

## 33.3 · Your file, named everywhere

*Minor · 2026-10-16 10:50 UTC · Design, Fix*

When you upload your own table, its real file name (and the sheet, for an Excel workbook) now shows in the top bar and in the Detect, Check & map and Dashboard headers, labelled “Your file”, so it can't be mistaken for the demo, which is labelled “Demo data”.

- Top bar: the file's name now comes first and shows from tablet width up, shortened to fit if it is long (hover for the full name). The “Your file” or “Demo data” label and the row count follow when there is room.
- Detect, Check & map and Dashboard: each header names the file under its title, with the same label.
- Excel workbooks show the sheet that was read next to the file name.
- To make room for the name on laptop screens, the Ctrl+K shortcut button in the top bar now appears only on wide screens; the shortcut itself works everywhere.

Files: `src/ui/workspace/FileIdentity.tsx`, `src/ui/workspace/Shell.tsx`, `src/ui/workspace/DetectStep.tsx`, `src/ui/workspace/DataCheckPanel.tsx`, `src/ui/workspace/dashboard/DashboardStep.tsx`, `src/engine/session.ts`

## 33.2 · Header links that always work

*Minor · 2026-10-16 10:50 UTC · Fix, Design*

The home page's header links (How it works, Features, Industries, Privacy, FAQ) now take you to their section every time, with a smooth scroll, and the link for the section you are reading is underlined.

- Fixed: clicking a section link a second time, after scrolling away, did nothing, because the browser saw that section was already in the address bar.
- Fixed: a scroll started from a header link could stop part-way when the phone menu closed or when “How it works” moved to its next step, because those animations briefly reset the scroll position. Both now animate without touching it.
- Fixed: on phones, the menu pushed the page down while it was open, so a tapped link landed past its section. The menu now floats over the page on a solid panel.
- Links scroll smoothly (instantly with reduced motion), stop just below the pinned header, keep the address bar in step so the link can be shared, and move keyboard focus to the section.
- The section you are reading is underlined in brass, and Version log is marked when you are on it. The Loupe logo takes the home page back to the top.

Files: `src/ui/site/SiteHeader.tsx`, `src/ui/landing/Pipeline.tsx`, `src/app/globals.css`

## 33.1 · Credits and copyright

*Minor · 2026-10-16 10:33 UTC · Design*

The site now credits its maker: a slim bar above the header reads “Crafted with curiosity · Designed & developed by Anupam Mishra · © 2026 Anupam Mishra. All rights reserved.”, and the footer carries the same copyright.

- A credit bar sits above the navigation on the home page and the version log. It scrolls away with the page while the navigation stays pinned, and on phones it keeps the name and the year.
- The footer now opens its bottom line with the copyright and the designer's name.
- The page details read by browsers and search engines name Anupam Mishra as the author and creator.
- The copyright year is taken from the latest release in the version log, so it moves forward by itself instead of being typed in.

Files: `src/content/credits.ts`, `src/ui/site/CreditBar.tsx`, `src/ui/site/SiteFooter.tsx`, `src/app/page.tsx`, `src/app/changelog/page.tsx`, `src/app/layout.tsx`

## 33.0 · A premium look and an animated home page

*Major · 2026-10-16 10:11 UTC · Feature, Design, Fix, Tests*

The home page now shows rather than tells: each section is a headline and at most one short line, and the explaining is done by motion graphics built from Loupe's real output on the demo file. The whole app gets a richer finish too: brass gradient buttons with a soft glow, a light that runs round the file drop zone, and a line under the top bar that tracks your progress.

- Hero: the headline rises into place word by word over slowly drifting colour and a fine measuring grid. The live dashboard preview tilts back in 3D and straightens as you scroll, with a brass light running round its frame; on very wide screens three of its real KPI figures float beside it.
- How it works plays like a short film in five steps: the demo file drops in, the industry is recognised with its real confidence, columns are mapped with lines drawing between them, the chart gallery cycles through its types, and the dashboard assembles itself from its real figures. It plays only while on screen, holds while you point at it or use the keyboard in it, and has a Pause button.
- Features are seven animated tiles: a KPI's real SQL and DAX type themselves out, the proof checklist ticks itself off, the category breakdown changes form (sorted bars, a donut, a treemap), a scanning light tags each column's role, the headline insight draws its trend, the export formats burst out of the package, and a request typed in words becomes its chart.
- Industries: the number of industries, KPI definitions and chart templates count up, and the industries scroll past in two endless rows that stop under the pointer.
- Privacy: an animated diagram shows your data flowing from your file into this browser tab and out as your dashboard, while the path to a server is visibly blocked.
- Less text everywhere: one headline per section, demo cards with a light that follows the pointer, shorter FAQ answers and a shorter footer. The closing section has a slowly turning lens, the Loupe mark as an instrument.
- Theme: primary buttons are a brass gradient with a soft glow and a sheen that sweeps across on hover or keyboard focus, with text contrast above 5:1 in both themes. The site header shows how far down the page you are and highlights the link under the pointer.
- Workspace: a brass light runs round the file drop zone when you hover or drag a file over it, every step has a soft glow at the top, and a line under the top bar fills as you move through the eight steps.
- Every figure in every animation is the engine's real output for the demo file, and every count comes from the industry registry or the chart catalogue; a new test checks both. With reduced motion turned on nothing loops or moves by itself and everything is shown straight away, and without JavaScript everything is shown too.
- Fix: visitors who prefer reduced motion no longer trigger a page rebuild on the home page; the dashboard preview now starts the same way on the server and in the browser.

Files: `src/ui/landing/sections.tsx`, `src/ui/landing/motion.tsx`, `src/ui/landing/HeroStage.tsx`, `src/ui/landing/Pipeline.tsx`, `src/ui/landing/Bento.tsx`, `src/ui/landing/HeroPreview.tsx`, `src/ui/landing/preview-data.ts`, `src/app/page.tsx`, `src/app/globals.css`, `src/styles/tokens.css`, `src/ui/primitives/button.tsx`, `src/ui/site/SiteHeader.tsx`, `src/ui/site/SiteFooter.tsx`, `src/ui/workspace/UploadStep.tsx`, `src/ui/workspace/Workspace.tsx`, `src/ui/workspace/Shell.tsx`, `tests/landing-data.test.ts`, `CLAUDE.md`

## 32.0 · Customise your dashboard

*Major · 2026-10-16 06:43 UTC · Feature, Design, Tests*

A new Customise step, right after Check & map, gives you full control of the dashboard: which KPIs it shows and where, which charts it shows in what order and size, and which columns each chart is built from. You can build your own KPIs and charts, choosing from 28 chart types (14 of them new), each explained in two lines: what it shows and what data it suits best.

- The workspace now has eight steps, with Customise as step 4. "Next: customise" leads there from Check & map; "Skip to dashboard" goes straight on, and Loupe still recommends a complete dashboard either way.
- KPIs tab: three lists, the headline row (up to six), supporting KPIs and KPIs from your other columns, each with its live value. Move a KPI up or down, send it to another list or take it off the dashboard, and add any KPI from "Not on the dashboard". A KPI that can't be computed says which column it needs.
- Build a KPI: summarise any column (total, average, median, lowest, highest, distinct count or number of rows), or divide one such figure by another (a ratio of totals, never an average of row ratios). Name it, choose its format and whether higher is better, and place it. It gets its own SQL and DAX, goes into the Power BI package, and the SQL check in DuckDB covers it like every other KPI. A KPI that needs a hidden or missing column, or asks to add up text, is left out and the reason is shown.
- Charts tab: every chart on the dashboard, section by section. Show or hide it, rename it, change its type (only types that can draw its data are offered, with Loupe's recommendation marked), set its width and height, move it up or down, or open it in the chart builder to change its data. Charts you made can be deleted.
- Create a chart: a gallery of 28 chart types in ten groups, one per question an analyst asks (change over time, comparing categories, ranking, part of a whole, distribution, relationships, flow, geography, a single number, exact figures), modelled on the Financial Times Visual Vocabulary and the Data Visualisation Catalogue. Each card says what the chart shows and what data it is best for, or what your file lacks for it.
- The chart builder: pick a date column and how to group it (day to year, or a part of the date such as weekday or hour), or a category; a second category to split by; one or more measures (any KPI, or any column summarised your way); and the top N, a goal, the section, width and title. A live preview shows exactly the chart you will get under the dashboard's filters. When a combination can't be drawn, it says what the type needs instead. Switching type keeps the columns and measures that still fit; the size and section follow the new type unless you set them.
- 14 new chart types: pie, grouped column, 100% stacked column, stacked area, step line, lollipop, dumbbell, bubble, radar, gauge, sunburst, Sankey, calendar heatmap and big number. They follow the same chart rules as the rest (bars start at zero, one value axis, your chart colours, a tooltip and a table view), and the Power BI README names the matching Power BI visual for each.
- Starting picks are sensible: a new chart starts on a category of words, and splits by one with a handful of values. Amounts such as a shipping fee of 0 or 49 can still be chosen, but they are never picked for you.
- Back to recommended resets KPIs and charts to Loupe's choice, with Undo. Your KPI layout, your KPIs, chart titles and charts are saved in the dashboard settings file and restored when you load it.
- Top bar: with eight steps, the step bar now fits every screen width. On narrower screens it tightens (below 1280px only the current step shows its name; the others show their number and name on hover). If it still doesn't fit, it scrolls instead of pushing the buttons off screen, and the file summary shows only what fits instead of running into the steps.
- New tests: every chart type in the gallery drafts, builds, computes and draws from the e-commerce demo; the builder explains combinations it can't draw; the new types compute what they promise (100% columns add up to 100%, a dumbbell keeps the two largest values, a big number equals its KPI); your KPIs match figures worked out by hand and in DuckDB; and layouts and your KPIs survive saving and loading the settings file.

Files: `src/ui/workspace/customise/CustomiseStep.tsx`, `src/ui/workspace/customise/KpiPlanner.tsx`, `src/ui/workspace/customise/KpiBuilder.tsx`, `src/ui/workspace/customise/ChartList.tsx`, `src/ui/workspace/customise/ChartStudio.tsx`, `src/ui/workspace/customise/chartDraft.ts`, `src/ui/workspace/customise/chartIcons.ts`, `src/engine/charts/catalogue.ts`, `src/engine/kpi/userKpis.ts`, `src/engine/charts/data.ts`, `src/engine/charts/recommend.ts`, `src/engine/charts/types.ts`, `src/registry/schema.ts`, `src/engine/session.ts`, `src/workers/engine.worker.ts`, `src/store/workspace.ts`, `src/engine/export/config.ts`, `src/engine/export/readme.ts`, `src/ui/charts/options.ts`, `src/ui/charts/echarts-setup.ts`, `src/ui/charts/ChartCard.tsx`, `src/ui/workspace/Shell.tsx`, `src/ui/workspace/Workspace.tsx`, `src/ui/workspace/MapStep.tsx`, `src/ui/workspace/ExportStep.tsx`, `src/ui/workspace/export/documents.ts`, `src/ui/workspace/dashboard/DashboardStep.tsx`, `src/ui/workspace/dashboard/KpiCards.tsx`, `src/ui/workspace/dashboard/layout.ts`, `tests/chart-catalogue.test.ts`, `tests/user-kpis.test.ts`, `tests/workspace-store.test.ts`, `tests/security.test.ts`, `README.md`, `CLAUDE.md`

## 31.0 · Choose your chart colours

*Major · 2026-10-16 04:42 UTC · Feature, Design, Tests*

A new Chart colours panel lets you pick the colours every chart, KPI sparkline, report and export uses: a ready-made palette, your own (brand) colours, or a single colour that Loupe turns into a full gradient. A live preview and a readability check show how it will look and whether every series stays easy to tell apart, including for colour-blind viewers.

- Open it from the "Colours" button on the dashboard, from Settings, or from the command palette (Ctrl+K, "Chart colours").
- Presets: Loupe (the default), Ocean, Forest, Sunset, Vivid, Corporate and Colour-blind safe. Every preset passes every readability check in both the light and the dark theme.
- Your colours: type or pick up to eight colours, say from your brand guide. They are used exactly as you gave them, and Loupe fills the remaining series with colours that go with yours. In the dark theme the same hues are adjusted in lightness so they stay readable.
- From one colour: pick a colour and choose Shades (a gradient of that colour, ordered so neighbouring series stay far apart) or Matching colours (your colour first, then hues picked to go with it). Either way Loupe also designs the colour's gradient for heatmaps, cohort grids, the customer-segment treemap and funnels.
- A pick-from-screen eyedropper (Chrome and Edge) takes a colour from anywhere on your screen, such as your logo.
- A live preview shows small charts (bars, stacked bars, lines, a donut, a heatmap) in your colours, in light or dark.
- The readability check runs the same tests the built-in palette was designed with: neighbouring series under simulated colour blindness, how distinct they are with normal vision, how vivid each colour is, and whether it stands out on the background. Improve readability moves only the lightness of your colours until the check passes, never their hues.
- Nothing changes until you press Apply, and Undo is one click away. Your choice is kept in this browser, restored before the page first paints (no flash of the old colours) and saved with your dashboard settings.
- Everything follows the colours: dashboard charts, chart previews in Ask for a chart and Questions, KPI sparklines, the PDF and PNG reports, and the cohort grid, which now uses the chart gradient instead of the interface's gold.
- Treemap sub-categories are now even lighter and darker steps of their category's colour, so no palette produces neon or muddy tiles (this also calms the default colours).
- The Power BI package now includes loupe-theme.json, a Power BI report theme with the same colours in the same order, and the package README says how to apply it.
- New tests: the readability check matches the reference validator to the decimal on the built-in palette; every preset passes in both themes; the default stays identical to the stylesheet; your colours are kept exactly; matching colours pass for colours all round the colour wheel; shades keep your colour and its hue; and Improve readability keeps hues while clearing failures.

Files: `src/ui/charts/palette/colour.ts`, `src/ui/charts/palette/check.ts`, `src/ui/charts/palette/generate.ts`, `src/ui/charts/palette/themes.ts`, `src/ui/charts/palette/apply.ts`, `src/ui/workspace/ChartColours.tsx`, `src/store/settings.ts`, `src/store/workspace.ts`, `src/ui/common/providers.tsx`, `src/ui/common/hooks.ts`, `src/app/layout.tsx`, `src/styles/tokens.css`, `src/ui/charts/ChartCard.tsx`, `src/ui/charts/Sparkline.tsx`, `src/ui/charts/options.ts`, `src/ui/charts/tokens.ts`, `src/ui/workspace/dashboard/DashboardStep.tsx`, `src/ui/workspace/dashboard/AskChart.tsx`, `src/ui/workspace/SettingsSheet.tsx`, `src/ui/workspace/CommandPalette.tsx`, `src/ui/workspace/Workspace.tsx`, `src/ui/workspace/ExportStep.tsx`, `src/engine/export/config.ts`, `src/engine/export/context.ts`, `src/engine/export/powerbi.ts`, `src/engine/export/readme.ts`, `src/engine/session.ts`, `src/workers/engine.worker.ts`, `tests/chart-themes.test.ts`

## 30.0 · Hide the columns you only keep as a reference

*Major · 2026-10-15 19:50 UTC · Feature, Data, Tests*

In Check & map you can now hide any column from the analysis. It stays in your file and on screen as your reference, but no KPI, chart, filter, insight or business question is ever computed from it. Loupe also spots raw columns that have a cleaned copy (Unit_Price beside Unit_Price_Clean, and the Reference_Price used to fix it) and offers to hide them for you.

- Every column header in Your data has an eye button that hides the column from the analysis, and Your columns has a Use switch on every row. A hidden column is dimmed and struck through, and shows its values unmarked.
- Hiding really takes the column out of every calculation: fields are matched again without it, so a template field moves to your cleaned column (gross sales then use Unit_Price_Clean instead of the raw Unit_Price with its -100 values). KPIs, charts, filters, insights, the chart builder and the questions in step 5 never see it.
- An earlier manual mapping, a filter, a chart you built or a question that names a column you then hide is never computed from it: the mapping is matched again, the filter is dropped, and the chart or question says which hidden column it needs.
- Suggestions: Loupe looks for columns that seem replaced by a cleaned copy (the same name plus Clean, New, Final, Fixed or Corrected, a name with Raw, Old or Original, a column named as a Reference, or two columns identical in every row). It suggests one only when the values also agree, and shows the evidence: how often the two match, and the problems found only in the raw one. Hide them one by one or all at once, or wave them away. Nothing is hidden unless you choose to.
- The data check and the health score leave hidden columns out, so the -100s in a raw column you replaced no longer count as rows to check or lower your score.
- Exports keep every column of your file. The Power BI model marks hidden columns as hidden, the package README lists them, and the data dictionary says which ones they are. The AI helper is not sent hidden columns at all.
- Your hidden columns are saved with your dashboard settings and restored from them; a new file starts with none hidden.
- The header of Check & map and the dashboard show how many columns you hid next to how many are used.
- New tests use a file like yours (Unit_Price with -100s, Reference_Price, Unit_Price_Clean). They check that once the raw columns are hidden nothing reads them, that gross sales equal a hand calculation, that the data check, exports and saved settings behave as described, and that ordinary column pairs are not mistaken for raw and clean copies.

Files: `src/engine/profile/hidden.ts`, `src/engine/profile/replaced.ts`, `src/engine/profile/dataCheck.ts`, `src/engine/session.ts`, `src/engine/charts/columnUsage.ts`, `src/engine/export/context.ts`, `src/engine/export/tmdl.ts`, `src/engine/export/readme.ts`, `src/engine/export/dictionary.ts`, `src/engine/export/config.ts`, `src/store/workspace.ts`, `src/ui/workspace/HiddenColumns.tsx`, `src/ui/workspace/useFileColumns.ts`, `src/ui/workspace/useColumnUsage.ts`, `src/ui/workspace/MapStep.tsx`, `src/ui/workspace/DataCheckPanel.tsx`, `src/ui/workspace/VirtualGrid.tsx`, `src/ui/workspace/ExportStep.tsx`, `src/ui/workspace/dashboard/DashboardStep.tsx`, `tests/hidden-columns.test.ts`, `tests/workspace-store.test.ts`

## 29.0 · A dashboard you can read at a glance

*Major · 2026-10-15 19:13 UTC · Design, Fix, Tests*

The dashboard's layout was redesigned so every chart has room to be read. Charts now use the full width, sit in neat rows with no gaps, never get narrower than their type needs, and their titles and labels are no longer cut off.

- Charts use the whole width: the "Build a chart" panel no longer takes a permanent column on the right. It slides in when you click a KPI, choose a chart's Customise, or press Build manually, and closes again.
- Every chart gets at least the width its type needs to stay readable (a donut's labels, a monthly trend's axis, a table's columns), measured on your screen, so nothing is squeezed into a narrow strip.
- Rows are packed for you: charts sit side by side wherever both can still be read, every row fills the full width with no holes, the cards on a row line up at the same height, and a section never ends with one chart alone stretched across the page.
- The main KPIs share one row when there is room (all six side by side), or split evenly; the smaller KPI tiles fill their rows with no empty grey slots.
- The filter panel no longer gets cut off on the left: the From and To dates now stack, so nothing in the panel is wider than it is.
- Chart titles can use two lines instead of being cut short, and the comparison line under each KPI wraps instead of ending in …
- Peak and Low labels sit on a small plate so they stay readable over lines and bars, and the low point's label goes below a line rather than on top of it.
- Donut labels line up at the card's edges with full names ("Net Banking", "Debit Card") instead of being cut.
- On a phone or narrow window every chart takes the full width.
- New tests check the packing: rows always fill the width, each chart keeps its readable width, rows are balanced, and narrow screens show one chart per row.

Files: `src/ui/workspace/dashboard/layout.ts`, `src/ui/workspace/dashboard/WidgetGrid.tsx`, `src/ui/workspace/dashboard/DashboardStep.tsx`, `src/ui/workspace/dashboard/FilterRail.tsx`, `src/ui/workspace/dashboard/KpiCards.tsx`, `src/ui/charts/ChartCard.tsx`, `src/ui/charts/options.ts`, `src/store/workspace.ts`, `tests/layout.test.ts`

## 28.0 · Export in order: dashboard, SQL, insights

*Major · 2026-10-15 18:37 UTC · Feature, Design*

The Export step now offers your three reports first, in this order: the dashboard as a PDF or image, your SQL queries as a PDF, and the insights as a PDF. The SQL and insights PDFs are new and are real text, so any query or sentence can be copied. Power BI, the SQL file, the data and the settings follow under More exports.

- Export starts with "Your reports, in this order": 1 · Dashboard (PDF report or PNG image), 2 · SQL queries, 3 · Insights.
- New SQL queries PDF: every business question from step 5 with how it was read, the rows used, the headline answer, the answer table and its SQL, then the SQL of every KPI on the dashboard.
- New insights PDF: the period and filters, the headline KPIs with their change, then every insight in order of importance, with how it was worked out and its chart.
- Both are real text, so you can select, search and copy them. They use the app's own typeface, Geist, embedded in the file (served by this site under its open licence), so ₹ and other symbols print correctly and no font is downloaded from anywhere else.
- The Power BI package, the SQL file with its check against your data, the measures, the data dictionary, the cleaned data and the saved settings are under More exports.
- With this, the workspace follows your seven steps: Upload, Detect, Check & map, Dashboard, Questions & SQL, Insights, Export. The README lists them.
- Question reading: "revenue trend by month" no longer leaves a note about the word "trend".

Files: `src/ui/workspace/export/textPdf.ts`, `src/ui/workspace/export/documents.ts`, `src/ui/workspace/ExportStep.tsx`, `src/engine/session.ts`, `src/workers/engine.worker.ts`, `src/engine/charts/ask.ts`, `public/fonts/OFL.txt`, `README.md`

## 27.0 · Business questions in SQL

*Major · 2026-10-15 18:26 UTC · Feature, Data, Tests*

A new step after the dashboard, Questions & SQL. Loupe suggests business questions about your data and you can type your own. For each one it answers from your data and writes the SQL query that returns the same answer, which you can check in your browser.

- New step 5, Questions & SQL, between Dashboard and Insights. Insights and Export are now steps 6 and 7.
- Suggested questions are built from your own KPIs and columns: how a KPI changed month by month, which category is highest, how categories compare, the top 10 items, the busiest weekday or hour, the lowest average score, and the overall totals.
- Type your own, such as "Which region has the highest revenue?", "How many invoices by region?", "Which 5 products sold the most?" or "Show me the bottom 3 sales reps by revenue". Loupe shows how it reads the question as you type.
- Each answer has a one-line headline, the answer table, a chart, and the SQL query for DuckDB and PostgreSQL, with your question and how it was read as comments at the top.
- "Check this SQL on your data" runs the query in DuckDB inside your browser and compares every value with the answer.
- Answers use the dashboard's date range and filters, or the whole file, as you choose.
- The SQL uses each KPI's own definition, including per-customer KPIs such as the repeat customer rate and balances taken on the latest date such as MRR. A KPI that counts each customer once, in the period of their first purchase (new customers), can't be written exactly per category, so the answer says so instead of approximating.
- "Add chart to dashboard" turns an answer into a chart.
- New tests prove in DuckDB that the SQL returns exactly the same rows as the answer: rankings, months, weekdays, hours, with filters, for per-customer and latest-balance KPIs, and for every suggested question.

Files: `src/engine/compile/questionSql.ts`, `src/engine/compile/sql.ts`, `src/engine/charts/ask.ts`, `src/engine/session.ts`, `src/workers/engine.worker.ts`, `src/store/workspace.ts`, `src/ui/workspace/QuestionsStep.tsx`, `src/ui/workspace/Workspace.tsx`, `src/ui/workspace/dashboard/AskChart.tsx`, `tests/questions.test.ts`

## 26.0 · Check your data before the dashboard

*Major · 2026-10-15 18:08 UTC · Feature, Fix, Data, Tests*

Steps 2 and 3 now follow your format. Detect shows what kind of data you uploaded and every column header in it. Check & map shows the whole file with every problem marked, so you can confirm the upload is right before the dashboard is built, and then check how the columns were mapped.

- Step 2 is now called Detect. Next to the industry match there is a new "Columns in your file" table: every column header, the kind of values it holds (whole number, date, time of day, text…), how Loupe reads it, and what is in it.
- "Next: check your data" opens step 3, now called Check & map. Its first tab, "Your data", shows every row of your file; cells with a problem are tinted, with the reason when you hover.
- Cells that couldn't be read as a number or a date now keep what the file said ("3x", "2025-13-45") and show it in the grid, instead of silently turning blank. They still count as blank in calculations.
- Marked problems: unreadable cells, negative quantities or prices, percentages out of range, impossible ages or coordinates, dates after today, 1 Jan 1900 placeholder dates, different spellings of the same value, discounts larger than the price, blanks in a column that is otherwise filled, and rows that repeat an earlier row.
- "What to check" lists each problem with its number of rows. Click one to see only those rows, with each row keeping its own number from your file. "Rows to check" shows all of them at once.
- The data health score and how the file was read (encoding, header row, date order) are in a "File report" tab in step 3.
- Fix: codes made of letters and digits, such as order IDs like "OD1003", were read as Indian states (OD is Odisha's code). A value with a digit is never read as a state, country or city now.
- Data health messages now say "1 row" rather than "1 rows".
- Step numbers follow the step list, so the new SQL step will renumber the later steps automatically.
- New tests: every problem is marked on the right cell, each problem's row count matches the data health check, unreadable cells keep their text (also through an unpivot), and order IDs are read as identifiers.

Files: `src/engine/profile/dataCheck.ts`, `src/engine/profile/quality.ts`, `src/engine/profile/geo.ts`, `src/engine/core/types.ts`, `src/engine/parse/builder.ts`, `src/engine/parse/unpivot.ts`, `src/engine/session.ts`, `src/workers/engine.worker.ts`, `src/store/workspace.ts`, `src/ui/workspace/DetectStep.tsx`, `src/ui/workspace/MapStep.tsx`, `src/ui/workspace/DataCheckPanel.tsx`, `src/ui/workspace/VirtualGrid.tsx`, `src/ui/workspace/columnSummary.ts`, `tests/data-check.test.ts`

## 25.0 · Ask for a chart

*Major · 2026-10-15 17:27 UTC · Feature, Design, Tests*

Say what you want to see and Loupe designs the chart: "average customer rating by city", "total sales and total profit by month", "revenue vs cost by sales rep". It reads your words against your own columns and KPIs, picks the right kind of chart, shows a live preview with the reason for its choices, and adds it to the dashboard only when you say so. You can also choose which charts to keep, hide or remove.

- New "Ask for a chart" button on the dashboard. Type a request, or click one of the examples built from your own columns.
- It understands totals, averages, medians, highest/lowest and counts; "by", "per", "with" and "across"; time words (by month, weekly, by weekday, by hour of day); "top 5"; "split by"; "A vs B"; "region or city" (it uses the first one your file has); and a chart type ("as a pie", "line", "table").
- Your words are matched to your columns and KPIs, including the template's vocabulary: "sales" finds your revenue column. Anything it can't find is quoted back to you, and nothing is made up.
- Everything it understood stays editable: each measure and how it is combined, what it is shown by, a split, the chart type and top N, with a live preview using the dashboard's filters.
- The charts follow the same rules as the rest of the dashboard: ratings, prices and percentages are averaged, never summed ("total discount" is the discount amount, not the rate); measures in different units are drawn as separate charts side by side, never on two axes; "A vs B" is a scatter; averages set aside groups of fewer than 5 rows; every choice is explained.
- "Keep or remove charts" lists every chart with a switch to show or hide it, and Remove for charts you added.
- Charts with several measures, or asked in words, open in Ask for a chart when you click "Change this chart". The side panel's chart builder now also reopens a column measure (such as "Average of Rating") correctly instead of showing an empty measure.
- New tests: requests on the sales and HR demos are read correctly, charts are designed by the rules, every designed chart computes, totals agree whatever they are broken down by, and every chart reads back into the same picks.

Files: `src/engine/charts/ask.ts`, `src/engine/charts/recommend.ts`, `src/workers/engine.worker.ts`, `src/ui/workspace/dashboard/AskChart.tsx`, `src/ui/workspace/dashboard/Inspector.tsx`, `src/ui/workspace/dashboard/DashboardStep.tsx`, `tests/ask.test.ts`, `README.md`

## 24.1 · Separate time columns

*Minor · 2026-10-15 17:09 UTC · Fix, Data, Tests*

Files that keep the date and the time in separate columns are now read as they are. A time column such as "join_time" used to show as "1899-12-30 20:15" (Excel stores a time as a fraction of a day counted from 30 December 1899) and could be treated as a date. It is now a time of day: never merged with your date column, never used as the dashboard's date, and used for charts by hour of day.

- A column of times ("20:15", "8:30 PM", "20:15:30"), Excel time cells, and times written as "1899-12-30 20:15:00", "1899-12-31 …" or "1900-01-01 …" are read as times of day, with a new role, Time of day.
- The data preview shows them as times (20:15:00), and Map columns lists them as Time of day.
- A time column is never picked as the dashboard's date, never offered as a date filter, never mapped to a template's date field, and never flagged as an "on or before 1 Jan 1900" placeholder date.
- Hour-of-day charts use your time column when the date column has no times (for example a weekday × hour heatmap reads the weekday from Order Date and the hour from Order Time). If the template has no hour chart, one is added under "From your other columns".
- In the chart builder, choosing a time column groups by hour of day.
- Exports keep it a time: HH:MM:SS in the cleaned CSV, TIME in the SQL file and the in-browser SQL check, and a time type in the Power BI model.
- New tests cover text times, Excel time cells and 1899-12-30 values, the date and time staying separate, the hour chart adding up to its KPI, and the exports.

Files: `src/engine/parse/dates.ts`, `src/engine/parse/builder.ts`, `src/engine/core/types.ts`, `src/engine/core/dates.ts`, `src/engine/profile/roles.ts`, `src/engine/profile/profile.ts`, `src/engine/profile/types.ts`, `src/engine/profile/quality.ts`, `src/engine/detect/match.ts`, `src/engine/detect/generic.ts`, `src/engine/charts/recommend.ts`, `src/engine/kpi/columnKpis.ts`, `src/engine/session.ts`, `src/engine/export/csv.ts`, `src/engine/export/sqlFile.ts`, `src/engine/export/tmdl.ts`, `src/engine/compile/sql.ts`, `src/ui/workspace/dashboard/Inspector.tsx`, `src/ui/workspace/VirtualGrid.tsx`, `src/ui/workspace/MapStep.tsx`, `tests/time-columns.test.ts`

## 24.0 · Understand any column from its data

*Major · 2026-10-15 16:53 UTC · Feature, Data, Tests*

Loupe used to build the dashboard mainly from the columns its industry template expects by name, so columns with other names, or columns the template doesn't know (a rating, a fee, your own profit figure), fed nothing. Now every measure column in your file is analysed from its data and summarised the right way, with its own KPIs and charts in a new section, "From your other columns".

- Every number column that no KPI reads now gets a KPI computed straight from your data: amounts and quantities are totalled, balances are taken on the latest date, and prices, percentages, ratings and scores are averaged (never summed).
- Each of them gets a trend over time and a breakdown by your most useful category (for example "Average Customer Rating by Region"), in a new dashboard section, "From your other columns". They never push the template's KPIs out of their places.
- A column whose values form a rating scale (1–5, 0–10, half stars) is now recognised as a rating even when its name says nothing ("Q7", "Feedback"), so it is averaged instead of added up. The reason is shown, and you can change it.
- When the template recognises a column but computes its KPI another way (for example gross profit as revenue minus cost), your own column still gets its plain total, and its definition says why.
- Map columns › Your columns now shows what each column holds: its range, its most common values, how many values are distinct and how much is blank.
- These KPIs go everywhere the others do: SQL and DAX, the Power BI package, the SQL check in your browser and the insights. Each one reads exactly one of your columns, and nothing is estimated.
- New tests: on a sales file with a rating, an unnamed 1–5 score, a fee and a profit column, each is read correctly, summarised the right way, charted, and its SQL gives the same number in DuckDB as on screen.

Files: `src/engine/kpi/columnKpis.ts`, `src/engine/kpi/resolve.ts`, `src/engine/session.ts`, `src/engine/profile/roles.ts`, `src/engine/profile/profile.ts`, `src/engine/profile/types.ts`, `src/engine/charts/types.ts`, `src/engine/charts/recommend.ts`, `src/engine/export/context.ts`, `src/engine/export/daxFile.ts`, `src/registry/schema.ts`, `src/store/workspace.ts`, `src/ui/workspace/dashboard/DashboardStep.tsx`, `src/ui/workspace/dashboard/KpiCards.tsx`, `src/ui/workspace/dashboard/KpiDetails.tsx`, `src/ui/workspace/MapStep.tsx`, `tests/column-kpis.test.ts`

## 23.0 · Your columns only

*Major · 2026-10-15 16:36 UTC · Feature, Data, Tests*

The dashboard is built strictly from the columns in your file, and you can now see it: every column shows which KPIs, charts and filters use it. Loupe never adds a column on its own. The two places that could (unpivoting a wide sheet, and a few Power BI helpers) now show exactly which columns they would add and wait for your yes; if you say no, nothing is added.

- Map columns has a "Your columns" tab: every column of your file with what it feeds (for example "17 KPIs, 14 charts" or "Not used"); hover to see the names. The header says "23 of 28 columns used · none added".
- The dashboard header says how many of your columns it uses and that no columns were added.
- Unpivoting a wide sheet now asks first, listing the two columns it would add and the period columns it would replace. "Keep my columns" leaves your data exactly as it is.
- The Power BI package and the DAX file ask before adding a column: a date-only copy of a date-time column (for Power BI's Date table) or an hour column for a chart. Saying no builds the package from your columns only: no Date table or time intelligence when that needed the copy, Power BI's own date hierarchy for month and day charts, and hour or weekday charts clearly marked as not built.
- The Power BI Date table now includes Day of Month, so day-of-month charts no longer ask you to add a calculated column.
- New setting "New columns": Ask first (default) or Never add. With Never add, Loupe skips anything that needs a new column without asking. There is no "always add".
- New tests check, on every demo, that every KPI, chart, drill path and filter reads a column that is in the file, that computing the dashboard adds no column, and that the Power BI package built without new columns contains none.

Files: `src/engine/charts/columnUsage.ts`, `src/engine/export/readme.ts`, `src/engine/export/context.ts`, `src/engine/export/daxFile.ts`, `src/engine/export/tmdl.ts`, `src/engine/parse/unpivot.ts`, `src/engine/session.ts`, `src/workers/engine.worker.ts`, `src/store/settings.ts`, `src/ui/workspace/NewColumnsDialog.tsx`, `src/ui/workspace/useColumnUsage.ts`, `src/ui/workspace/MapStep.tsx`, `src/ui/workspace/DetectStep.tsx`, `src/ui/workspace/ExportStep.tsx`, `src/ui/workspace/SettingsSheet.tsx`, `src/ui/workspace/dashboard/DashboardStep.tsx`, `tests/columns.test.ts`, `tests/export.test.ts`, `tests/import-regressions.test.ts`

## 22.0 · Every number agrees everywhere

*Major · 2026-10-15 16:19 UTC · Fix, Tests*

An audit cross-checked every number the dashboard shows against every other place the same quantity appears, on all six demos. It found places where cards, insights and charts gave different results for what looked like the same thing. One comparison rule now drives both the KPI cards and the insights, and a permanent test keeps them in agreement.

- All time: a card showed the all-time total with a change that was really last month vs the month before ("₹5.37Cr +34.2%"), while the insight said +46.9%. Cards now show the month the change describes ("September 2026: ₹37.9L, +46.9% vs September 2025"), and the insight uses the same comparison.
- Comparing with a period the data only partly covers (12 months against 9) inflated changes: the card said +57% while the insight said +25%. Both now compare like for like, only the months both periods cover, and say so.
- Data with one row per month (MRR snapshots, P&L months) had its latest month treated as unfinished, so comparisons skipped it and it was greyed out on charts. Loupe now recognises monthly, quarterly and yearly records.
- When there is no earlier data, the card and the insight both compare the latest complete month, instead of the card saying "no comparison" while an insight showed one.
- Employee lists and other rosters no longer get period insights, matching their cards.
- Orders counted under several return reasons now come with a note explaining why the bars add up to more than the total.
- Insight titles say exactly what they compare: "vs the previous 12 months", "vs the same period a year earlier" or the month's name.
- The sales demo wins new customers right up to its last month, so "New customers −100%" no longer appears.
- A new test suite checks all of this on every demo: chart totals equal their KPI cards, every insight's change equals its card's, and time-intelligence figures equal the matching date filters.

Files: `src/engine/kpi/compute.ts`, `src/engine/insights/insights.ts`, `src/engine/charts/data.ts`, `src/engine/session.ts`, `src/engine/samples/small.ts`, `src/ui/workspace/dashboard/KpiCards.tsx`, `src/ui/workspace/dashboard/KpiDetails.tsx`, `src/ui/workspace/export/report.tsx`, `src/ui/workspace/AiSummary.tsx`, `tests/consistency.test.ts`

## 21.23 · Final checks: formatted, tested, built and clicked through

*Minor · 2026-10-15 11:13 UTC · Tests, Docs*

Closed this round of work with a full set of checks. Every one passes.

- All code is formatted consistently with Prettier, and `npm run format:check` keeps it that way.
- Automated tests: 389 pass in 17 files, from KPI proofs and known answers to import, detection, charts, insights, exports, security, accessibility-relevant UI state and speed. A 1-million-row benchmark is available on request.
- Type checking and linting report no errors, and the production build prerenders every page.
- In Chrome, all six demos go through every step without errors, at desktop and phone widths and in both themes.
- Accessibility: zero WCAG 2.1 AA violations on every page and workspace step, in both themes.

Files: `.prettierrc.json`, `.prettierignore`, `package.json`, `docs/ARCHITECTURE.md`, `CLAUDE.md`, `README.md`

## 21.22 · Small polish after the final click-through

*Minor · 2026-10-15 11:13 UTC · Design, Fix*

Two details found in the last browser check.

- The current step's name (for example "Dashboard") is visible again in the step bar. It had slipped behind the highlight after the phone fix.
- Roster KPI cards carry a short note, "All employees in the file · no period comparison", instead of a long sentence on every card. The filter panel still explains how a date range works.

Files: `src/ui/workspace/Shell.tsx`, `src/engine/session.ts`, `tests/kpi.test.ts`

## 21.21 · Employee lists and other rosters are read correctly over time

*Minor · 2026-10-15 11:06 UTC · Fix, Data, Tests*

In an employee list the only date is usually Hire Date, so the default "last 12 months" quietly turned Headcount into "people hired in the last year". Business areas whose rows are standing things (employees, customers, products, subscriptions, telecom subscribers) now open on the whole file and say why there is no period comparison.

- Each business area in the industry files can be marked as "events" (orders, tickets) or "roster" (employees, customers). Six are rosters: HR employee master and attrition snapshot, e-commerce customers and products, SaaS subscription lists and telecom churn tables.
- For rosters the dashboard starts on All time, and instead of a misleading "vs last month" the KPI cards say: "Whole file: each row is an employee, so there is no earlier period to compare."
- Picking a date range still works; the filter panel explains that it keeps the people whose hire date falls in the range.
- Tests check that the HR demo's headcount covers everyone currently employed, and that event data such as orders keeps its period comparison.

Files: `src/registry/schema.ts`, `src/registry/domains/hr.json`, `src/registry/domains/ecommerce.json`, `src/registry/domains/saas.json`, `src/registry/domains/telecom.json`, `src/engine/kpi/compute.ts`, `src/engine/session.ts`, `src/store/workspace.ts`, `src/ui/workspace/dashboard/FilterRail.tsx`, `tests/kpi.test.ts`

## 21.20 · Sharper industry detection and column understanding

*Minor · 2026-10-15 11:06 UTC · Fix, Tests, Performance*

Detection now weighs the columns that only one industry would have, and column matching needs real evidence. All 75 real-world file layouts in a new test suite are recognised correctly, and the e-commerce demo no longer asks you to confirm.

- The e-commerce demo scores e-commerce 99, with Sales and Logistics at 70. Logistics used to score 96 and force a confirmation. Google Ads exports go to Marketing (99 vs 55).
- Distinctive columns (SKU, MRP, coupon for e-commerce; freight, lane, vehicle for logistics) count for more, and an industry loses points when a rival explains your distinctive columns better. Each candidate shows that deduction.
- Column names need real evidence: "injury_claim" no longer maps to paid amount, "Market Rent" to property value, or "Updated at" to first response. About 60 wrong mappings across the test layouts disappeared.
- Column roles: "Order Hour" is a time of day (not summed), "Leads" is a count (summed), "Margin %" in points is a percentage, a unique amount is never mistaken for an ID, and US state codes like OR, UT and CT are no longer read as Indian states.
- A suite of 75 layouts from real tools (Shopify, Amazon, Salesforce, Google Ads, Stripe, Tally, HR systems, hospital, logistics, loan, telecom, insurance and helpdesk exports) runs on every test. Four genuinely ambiguous layouts are expected to ask you to confirm.
- Detection is also about 6× faster on wide files.

Files: `src/engine/detect/detect.ts`, `src/engine/detect/match.ts`, `src/engine/detect/mapping.ts`, `src/engine/profile/names.ts`, `src/engine/profile/roles.ts`, `src/engine/profile/structure.ts`, `src/engine/profile/patterns.ts`, `src/engine/profile/geo.ts`, `src/registry/domains/*.json (11 files, synonyms only)`, `tests/detect.test.ts`, `tests/fixtures/detection.json`

## 21.19 · The workspace works properly on a phone

*Minor · 2026-10-15 10:44 UTC · Design, Fix*

Clicking through the workspace at phone width found that the step buttons had no names for screen readers and could get lost off the edge of the screen. These and two smaller layout issues are fixed.

- On narrow screens the step buttons show only their number, but they now still announce "Map columns", "Insights" and so on to screen readers.
- The top bar shows only the Loupe mark on phones, so all six steps fit.
- Every step opens at the top of the page (confirming on Detect used to land halfway down the dashboard).
- Supporting KPIs use two columns on phones instead of one long list.
- The full flow was re-checked at phone width and in the light theme with no errors.

Files: `src/ui/workspace/Shell.tsx`, `src/ui/workspace/Workspace.tsx`, `src/ui/workspace/dashboard/KpiCards.tsx`

## 21.18 · The workspace passes an accessibility audit

*Minor · 2026-10-15 10:41 UTC · Design, Fix*

Audited every workspace step (upload, detect, map, dashboard, insights, export) with axe-core against WCAG 2.1 AA in both themes and fixed everything it found. Every step now reports zero violations, as the home page and version log already did.

- Every step sits in one main region, so screen-reader users can jump straight to the content.
- Buttons announce the text you can see: the command-palette button includes "Ctrl K", and KPI cards read their name, value and change.
- The date presets are a proper radio group, insight titles follow the heading order, and scrollable code (SQL, DAX, the AI payload preview) can be scrolled with the keyboard.

Files: `src/ui/workspace/Workspace.tsx`, `src/ui/workspace/Shell.tsx`, `src/ui/workspace/dashboard/DashboardStep.tsx`, `src/ui/workspace/dashboard/KpiCards.tsx`, `src/ui/workspace/dashboard/FilterRail.tsx`, `src/ui/workspace/dashboard/KpiDetails.tsx`, `src/ui/workspace/InsightsStep.tsx`, `src/ui/workspace/AiSummary.tsx`

## 21.17 · Fair period comparisons and number formats that fit the data

*Minor · 2026-10-15 10:37 UTC · Fix, Data, Tests*

Checking all six demo dashboards in a real browser found three things that looked fine but were subtly wrong. All three are fixed.

- Monthly data dated on the 1st (MRR snapshots, P&L months) compared the last 12 months with only 11 earlier months, which inflated changes such as "Churned accounts +334%". Comparisons now shift by whole calendar months, so 12 months always compare with 12.
- The number format is now "Auto" by default: lakh/crore for rupee data and K/M/B for other currencies, so a dollar SaaS file shows $479K, not $4.79L. Choosing a format in Settings still overrides it.
- The B2B sales demo now wins customers gradually over two years instead of having all 180 from day one, so "New customers" reads like a real ledger (60 in the last year) instead of 0.
- The full click-through (detect, dashboard, map, insights, export) passes on all six demos in the production build with no errors. The e-commerce export check downloaded the Power BI package, SQL, PDF and PNG, and the in-browser SQL verification matched 33 of 33 KPIs.

Files: `src/engine/kpi/compute.ts`, `src/store/settings.ts`, `src/store/workspace.ts`, `src/ui/workspace/SettingsSheet.tsx`, `src/engine/samples/small.ts`, `tests/kpi.test.ts`

## 21.16 · Space-grouped numbers and period-name headers

*Minor · 2026-10-15 10:27 UTC · Fix, Data, Tests*

Fixed two file-reading gaps the import review left open.

- Numbers grouped with spaces, as in French and many European exports ("12 500,00", "1 234 567.89"), are now read as numbers instead of text.
- Wide tables whose header row is made of periods ("Region, Jan 2024, Feb 2024 …" or "Product, 2022, 2023, 2024") are recognised as having a header instead of treating it as a data row.

Files: `src/engine/parse/values.ts`, `src/engine/parse/sniff.ts`, `tests/parse.test.ts`

## 21.15 · Insights that lead with what matters, and stricter charts

*Minor · 2026-10-15 10:27 UTC · Fix, Tests*

Insights now open with the headline change and only compare segments on rates, and charts follow the design rules exactly. The demo's first insight is now "Net Revenue up 40.5% vs the previous 12 months", backed by a check that it rose in 12 of 12 months.

- Segment comparisons use rates only (RTO rate, return rate, AOV), never totals, so "COD 7.4× Net Banking" for revenue is gone.
- One scoring rule ranks every insight by relevance, size and certainty. A month-by-month consistency test decides the certainty, and related totals that moved together are mentioned inside the headline instead of as separate cards.
- A partial first month is left out, and the basis says so. Weekday patterns are skipped when data is dated once a month, and a weekday averaging zero no longer produces an absurd percentage.
- Donuts never show more than six slices (top 5 plus a recalculated "Others"), and charts only offer alternative types that suit the data.
- Treemap parents and stacked "Others" segments are calculated from the rows, not by adding up children (that would be wrong for distinct counts and rates). Small groups that are hidden or folded into Others get a note.
- A cut-short first period is flagged like the last one. RFM with no dated customers shows a clear message instead of failing, and basket pairs show product values, not internal codes.
- Renamed KPIs keep their new names in insight text, and insights never carry over from a previously loaded file.

Files: `src/engine/insights/insights.ts`, `src/engine/charts/data.ts`, `src/engine/charts/recommend.ts`, `src/engine/charts/analyses.ts`, `src/engine/charts/types.ts`, `src/engine/session.ts`, `src/engine/kpi/compute.ts`, `tests/insights.test.ts`, `tests/charts-data.test.ts`, `tests/chart-rules.test.ts`

## 21.14 · Export and workspace fixes

*Minor · 2026-10-15 10:27 UTC · Fix, Tests*

Fixed the export files and a set of workspace details found in the code review and the browser walkthrough.

- SQL file: the header now says exactly what was checked. The RFM view and day differences use standard SQL, the MySQL table name is quoted, and the dialect notes cover MySQL, SQL Server and BigQuery precisely. Every generated view is now run in DuckDB by the tests.
- Power BI package: valid DAX even with no headline KPIs, setup steps numbered without gaps, correct build steps for hour-of-day and day-of-month charts, and no clash for the helper date column.
- Clicking a state on the tile map filters correctly even when the data uses codes like "MH". "Undo" restores your previous date range. Row counts follow your number-format setting.
- Charts: no number on every bar of a time chart (only the peak and low are labelled), horizontal bar axes no longer crowd, and labels on coloured fills pick their ink by actual contrast.
- Theme switching no longer flickers or mismatches on load, numbers count up smoothly from where they are, and screen readers hear "Loupe" once.
- A saved config restores your currency and your cross-filter correctly, a new file resets the business context, and Start over really starts over.
- The AI check no longer flags "12 Markets" as an unverified "12M", and the SQL lab limits rows inside the query.

Files: `src/engine/export/sqlFile.ts`, `src/engine/export/daxFile.ts`, `src/engine/export/readme.ts`, `src/engine/export/config.ts`, `src/ui/charts/options.ts`, `src/ui/charts/ChartCard.tsx`, `src/ui/charts/tokens.ts`, `src/ui/common/theme-toggle.tsx`, `src/ui/common/hooks.ts`, `src/store/workspace.ts`, `src/lib/ai.ts`, `src/lib/duckdb.ts`, `tests/export.test.ts`, `tests/chart-options.test.ts`, `tests/lib.test.ts`, `tests/workspace-store.test.ts`

## 21.13 · Security and privacy hardening

*Minor · 2026-10-15 10:27 UTC · Security, Tests*

Closed a security hole in chart tooltips and made the optional AI payload far more anonymous.

- Chart tooltips are built as HTML. A crafted column name in an uploaded file could have run code in the page, where the optional API key is held. Every value that reaches a tooltip is now escaped, and the whole app was audited for similar risks; none remain.
- A test feeds malicious names through every chart type and the real engine, and fails if anything gets through.
- AI payload: IDs and people's names become stable pseudonyms (ID-1, ID-2 …). Emails, phone numbers, web addresses, long digit runs, street addresses, dates of birth, postal codes and coordinates are masked wherever they appear. Free text is masked. Only low-cardinality categories, numbers and dates are kept, and each column says which treatment it got.

Files: `src/ui/charts/options.ts`, `src/engine/session.ts`, `tests/security.test.ts`, `tests/ai-payload.test.ts`

## 21.12 · Files are read faithfully in more edge cases

*Minor · 2026-10-15 10:24 UTC · Fix, Data, Tests*

Fixed twelve ways a file could be misread: some silently changed numbers or dates, others lost values. Every fix has its own test that fails on the old code.

- A column of values like 0.125 or 83.125 was mistaken for European thousands and read 1000× too large. Only values that can be read one way now decide the style; anything still ambiguous is read the usual way and noted in the parse report.
- Number columns whose names merely contain "end", "dt" or "month" ("Ad Spend", "Width", "Monthly Revenue") were turned into dates. Date hints now match whole words, and Excel date numbers need a name that clearly says date.
- An impossible date such as 45/03/2024 no longer counts as evidence for day-first order.
- The demo data is now generated identically in every browser (a seeded shuffle replaced one whose result depended on the browser). The e-commerce demo now has 49,037 rows, and the home page numbers update on the next build.
- Duplicate column names always end up unique, and a column that turns to text keeps every original value, however late the odd value appears.
- Health checks: 1 Jan 1900 placeholders are flagged, coordinates are checked by column name, and ages respect units (an account age in days is not "impossible").
- Excel dates are read exactly as written, workbooks and JSON report skipped columns, UTF-16 files aren't mistaken for being twice as large, JSON fields that first appear late are kept, and unpivoted columns get names that don't clash.

Files: `src/engine/parse/values.ts`, `src/engine/parse/dates.ts`, `src/engine/parse/builder.ts`, `src/engine/parse/excel.ts`, `src/engine/parse/csv.ts`, `src/engine/parse/json.ts`, `src/engine/parse/unpivot.ts`, `src/engine/samples/builder.ts`, `src/engine/samples/ecommerce.ts`, `src/engine/profile/quality.ts`, `src/engine/profile/profile.ts`, `tests/import-regressions.test.ts`

## 21.11 · The screen, SQL and DAX now agree in every case

*Minor · 2026-10-15 10:10 UTC · Fix, Tests*

Fixed nine cases where the number on screen, the exported SQL or the Power BI DAX could disagree. The SQL is now proven to run unchanged on PostgreSQL as well as DuckDB.

- Rows with a blank flag (for example a blank "is returned") were counted on screen but dropped by the SQL. Both now count them.
- KPIs made only of per-customer or closing-balance parts produced one SQL row per data row instead of a single answer.
- Months with no qualifying customers showed 0 on screen but blank in SQL. Both now show 0.
- Day differences (such as delivery time) used a DuckDB-only function. They now use standard SQL; all 700 formulas and 14,461 monthly results also match on PostgreSQL 18.
- Category matching is now exact ("RTO" vs "rto"), the same as SQL.
- A crash with more than about 150,000 customers in one group is fixed.
- The "Others" bucket counts new customers the same way the named groups do.
- The Power BI 7-day moving average matches the app (7-day total ÷ 7).
- The automated proof is stricter: a blank only equals a blank, and every query must return exactly one answer. A new suite of 47 targeted checks guards each fix.

Files: `src/engine/compile/sql.ts`, `src/engine/compile/dax.ts`, `src/engine/query/evaluate.ts`, `src/engine/query/run.ts`, `src/engine/query/filter.ts`, `tests/equivalence.test.ts`, `tests/registry.test.ts`

## 21.10 · Accessibility pass and phone layout polish

*Minor · 2026-10-15 09:53 UTC · Design, Fix*

Ran an automated accessibility audit (axe-core, WCAG 2.1 AA) on the home page and this version log in both themes and fixed everything it found; both now report zero violations. Also tidied the home-page preview on phones.

- Slightly adjusted five colours so small text keeps at least 4.5:1 contrast even on tinted chips: dark-theme red, plus light-theme bronze, red, amber and the faintest grey.
- Links inside sentences are underlined, so they don't rely on colour alone.
- Code samples can be scrolled with the keyboard.
- Fades in the preview respect the "reduce motion" setting.
- On phones, the preview's pipeline steps wrap instead of running off the edge, and the trend chart's labels stay readable.
- Badges with an icon (such as "Watch" on insights) keep the icon beside the word instead of above it.

Files: `src/styles/tokens.css`, `src/ui/landing/sections.tsx`, `src/ui/landing/HeroPreview.tsx`, `src/ui/primitives/badge.tsx`, `docs/DESIGN.md`

## 21.9 · README, architecture and design guides, brand files

*Minor · 2026-10-15 09:47 UTC · Docs, Design*

Wrote the documentation a developer or a deploying team needs, and exported the logo as ready-to-use files.

- README: what Loupe is, install and run commands, a step-by-step guide to deploying on Vercel's free tier, how it works, how the numbers are proven, honest known limitations and next steps.
- Architecture guide: the background-thread design, the data model, every stage of the pipeline, the KPI expression language, the industry file format, exports, security and testing.
- Design guide: colours for both themes (with the colour-blindness check results), type, spacing, motion, chart rules and accessibility.
- Logo mark and wordmark as SVG files for dark and light backgrounds, with the lettering converted to shapes so they look the same everywhere.

Files: `README.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `public/brand/*.svg`

## 21.8 · Tests for exact KPI answers, chart rules and speed

*Minor · 2026-10-15 09:44 UTC · Tests, Performance*

Added three more groups of automated tests. They confirm the numbers are exactly right, the charts follow the design rules, and Loupe stays fast.

- Known answers: a seven-order file worked out by hand. The full pipeline gives exactly net revenue 350, AOV 87.5, RTO rate 1/6, repeat rate 50% and the right month-on-month changes, and shows "no value" instead of dividing by zero.
- Chart rules on all six demos: every chart states its reason, alternatives must suit the data, time is drawn as lines, areas or bars, one axis only, and no donut has more than six slices. These checks found three issues, now being fixed: a 7-slice payment donut, the donut limit itself, and some unsuitable alternatives.
- Speed: 100,000 rows are profiled in about 0.15 seconds (the target is under 3) and parsed in about 0.8 seconds. A full 23-chart dashboard for the demo computes in under half a second, and a million rows parse in about 7.4 seconds.

Files: `tests/kpi.test.ts`, `tests/chart-rules.test.ts`, `tests/perf.bench.test.ts`

## 21.7 · Every source file documented

*Minor · 2026-10-15 09:40 UTC · Docs*

All 126 source files now start with a comment saying what the file does and how it fits in, and the non-obvious functions explain themselves. Before, only 62 files had one. A careful review also turned up about 40 real issues, which are being fixed in the next steps.

- Documentation comments rose from 246 to about 1,150. Comment lines went from about 540 to 3,800.
- The core expression language, the industry-file format and the analysis session are documented in detail, so new industries and KPIs can be added safely.
- An automated check confirmed that the documentation pass changed comments only, never code.
- Issues found while reading are now being fixed: a security fix for chart tooltips, SQL that disagreed with the screen on blank values, numbers like 0.125 read as 125, columns such as "Ad Spend" read as dates, and weaker insights.

Files: `src/**/*.ts`, `src/**/*.tsx`

## 21.6 · KPIs built from other KPIs are handled correctly

*Minor · 2026-10-15 09:34 UTC · Fix*

Many KPIs are defined in terms of others, for example net revenue = gross sales − discounts. Two places treated them wrongly; both are fixed.

- Loupe now knows such KPIs can be added up across months and segments. Before, net revenue was treated like a ratio, which produced misleading insights such as "COD 7.4× Net Banking" and hid its 7-day moving average.
- When the dashboard is narrowed to one business area, KPIs from other areas that a visible KPI depends on are kept behind the scenes, so the visible KPI can always be computed and exported. In Power BI they go into a hidden "Helpers" folder.

Files: `src/engine/query/expr.ts`, `src/engine/query/evaluate.ts`, `src/engine/insights/insights.ts`, `src/engine/kpi/compute.ts`, `src/engine/kpi/resolve.ts`, `src/engine/export/daxFile.ts`, `src/engine/export/sqlFile.ts`, `src/engine/session.ts`

## 21.5 · Tests for file import

*Minor · 2026-10-15 09:30 UTC · Tests*

Added automated tests for reading files, so changes can't silently break how data is understood.

- Delimiters, encodings (including Windows-1252), European decimals and Indian digit grouping.
- Accented and Hindi text stays intact even where a large file is split into chunks.
- Dates: day-first versus month-first is decided from the whole column, the locale preference applies only when nothing proves the order, and a manual override wins.
- JSON flattening, line-delimited JSON, Excel sheets with real dates, and columns that turn to text without losing any values.

Files: `tests/parse.test.ts`, `tests/helpers/dataset.ts`

## 21.4 · Text renders at the designed sizes

*Minor · 2026-10-15 09:26 UTC · Fix, Design*

A styling helper dropped some of the design system's custom text sizes when they were combined with a colour, so parts of the workspace showed 16 px text instead of 13 px, and a few labels lost their colour. It now knows the custom sizes, corners and shadows.

- Fixes oversized text in the step bar, the date presets and the filter lists, plus a few labels that lost their colour.
- Corner radius and shadow overrides now resolve predictably.

Files: `src/lib/utils.ts`

## 21.3 · Fixed a crash when opening the dashboard

*Minor · 2026-10-15 09:25 UTC · Fix*

A click-through test in a real browser found that the dashboard crashed into an endless update loop as soon as it opened. It now opens normally.

- Each chart asked the app state for its drill-down path, and charts without one got a brand-new empty list every time. React saw that as a change and re-rendered forever. Charts now share one empty list.
- The full flow (detect → dashboard → map → insights → export) now completes without errors in a production build.

Files: `src/ui/charts/ChartCard.tsx`

## 21.2 · A guide for whoever works on the code next

*Minor · 2026-10-15 09:19 UTC · Docs*

Added CLAUDE.md, a short guide to how the project fits together, the rules that must not be broken, and how to add an industry. Future work can resume quickly and safely.

- Explains the pipeline (import → profile → detect → KPIs → charts → insights → export) and where each part lives.
- Lists the invariants: never fabricate numbers, keep data in the browser, keep the engine, SQL and DAX in agreement.
- Records the version-log rule (major and minor steps) so every future change is logged here.

Files: `CLAUDE.md`

## 21.1 · Proof extended to every fallback formula

*Minor · 2026-10-15 09:15 UTC · Tests*

Many KPIs have backup formulas for when a column is missing. The automated proof now checks every one of them against DuckDB, not just the formula used first.

- 700 KPI formulas across all 16 industries (390 primary plus 310 fallbacks) give exactly the same result in Loupe's engine and in SQL.
- 14,435 month-by-month results were compared as well, and every one matched.
- The landing page's claim "Every fallback formula checked" is now backed by this test.

Files: `tests/registry.test.ts`

## 21.0 · Landing page

*Major · 2026-10-15 09:14 UTC · Feature, Design*

Built the home page. It shows a working miniature of the dashboard whose every number comes from the real engine running on the demo data, then explains how Loupe works, what it covers and how it protects your data.

- Hero preview: watch Loupe read the file, profile 28 columns, detect e-commerce at 99% and compute the dashboard. Switch between the last 12 months, 6 months and 90 days.
- How it works: the four steps, each with a small example from the demo.
- Features: a real KPI with its SQL and DAX, the reason a chart was chosen, a column profile and an insight, all produced by the engine.
- Industries: all 16 with their KPI and chart counts read from the knowledge base, with e-commerce highlighted.
- Privacy, demo datasets (with their real sizes), straight-answer FAQ (including why there is no .pbix) and a closing call to action.
- Checked in dark and light themes at desktop and phone widths, with no sideways scrolling.

Files: `src/app/page.tsx`, `src/ui/landing/preview-data.ts`, `src/ui/landing/HeroPreview.tsx`, `src/ui/landing/sections.tsx`, `src/ui/site/SiteHeader.tsx`, `src/ui/site/SiteFooter.tsx`, `src/app/not-found.tsx`

## 20.1 · Workspace components follow React's stricter rules

*Minor · 2026-10-15 09:08 UTC · Fix, Performance*

React's new compiler rules flagged six places where the workspace updated its own state in a roundabout way. Each one now uses the recommended pattern, which avoids extra re-renders.

- Screen-size and platform checks (for example, showing ⌘K or Ctrl+K) read the browser directly instead of setting state after the first render.
- The custom date range, the large-file dialog and the KPI time-intelligence panel reset or load without cascading updates.
- Creating a custom chart generates its id only when you click, never while drawing the screen.

Files: `src/ui/workspace/Shell.tsx`, `src/ui/workspace/UploadStep.tsx`, `src/ui/workspace/dashboard/DashboardStep.tsx`, `src/ui/workspace/dashboard/FilterRail.tsx`, `src/ui/workspace/dashboard/Inspector.tsx`, `src/ui/workspace/dashboard/KpiDetails.tsx`

## 20.0 · Version log

*Major · 2026-10-15 09:05 UTC · Feature, Docs*

Added this page, so you can follow every step of the build. Each step is a major version (a new capability) or a minor version (a refinement or fix), with what changed and which files were involved.

- The /changelog page groups each major version with its minor follow-ups, shows times in your local time zone, and can show major versions only.
- An "Up next" list shows the work that is planned.
- The current version appears in the site footer and in the workspace settings; the command palette can open the log.
- CHANGELOG.md is generated from the same source with npm run changelog.
- An automated test keeps the numbering honest: newest first, no gaps, and dates never go backwards.

Files: `src/content/changelog.ts`, `src/app/changelog/page.tsx`, `src/ui/site/ChangelogTimeline.tsx`, `scripts/write-changelog.mts`, `tests/changelog.test.ts`, `CHANGELOG.md`

## 19.0 · Fifteen more industries

*Major · 2026-10-15 08:54 UTC · Feature, Data, Tests*

Added knowledge files for 15 more industries, so Loupe recognises and analyses far more kinds of business data. Every KPI is checked to give the same answer in the engine and in SQL.

- Sales & Retail, Marketing, SaaS & Subscription, Finance & Accounting, HR & People, Healthcare, Logistics & Supply Chain, Manufacturing, Banking & Lending, Education, Real Estate, Hospitality & Travel, Telecom, Insurance and Customer Support.
- 326 new KPI definitions (19–24 per industry), each with a definition, formula, direction, pitfalls and, where widely cited, an indicative benchmark.
- 12 chart templates per industry and 2–4 business areas each. For example, Healthcare covers admissions, outpatient visits, claims and bed census.
- Checked against column layouts typical of common tools (CRMs, ad platforms, HR systems, helpdesks, policy and claims registers, MRR snapshots). Most are recognised outright; a few ambiguous ones, such as a pure machine-downtime log, ask you to confirm.
- All five demo datasets for these industries are detected at 99% confidence.

Files: `src/registry/domains/*.json (15 new files)`, `src/registry/index.ts`

## 18.1 · First full type-check of the app

*Minor · 2026-10-15 08:45 UTC · Fix*

Ran the TypeScript checker across every file now that the workspace is assembled, and fixed what it found.

- Two buttons (chart CSV export and loading a saved config) returned a value from a click handler where nothing was expected; they now show the error message and stop cleanly.
- The only remaining error is a missing industry file (Education), which is still being written in parallel.

Files: `src/ui/charts/ChartCard.tsx`, `src/ui/workspace/ExportStep.tsx`

## 18.0 · Workspace page at /app

*Major · 2026-10-15 08:42 UTC · Feature*

Put every workspace step together on one page, so the app can be used end to end: upload, confirm, map, dashboard, insights and export.

- The six steps switch with a short fade; the top bar shows progress through Upload → Detect & confirm → Map columns → Dashboard → Insights → Export.
- Ctrl+K (⌘K on Mac) opens the command palette from anywhere.
- A link such as /app?sample=ecommerce opens a demo dataset straight away, so the landing page can link to a live demo.
- Problems after the upload step appear as toast messages instead of failing silently.
- Changing the number format (Indian lakh/crore or international) or the currency recomputes every label, chart description and export.

Files: `src/app/app/page.tsx`, `src/ui/workspace/Workspace.tsx`

## 17.1 · Accuracy and speed fixes in exports and the command palette

*Minor · 2026-10-15 08:41 UTC · Fix, Performance*

Corrected a privacy statement that overpromised, and stopped the command palette from slowing the dashboard down.

- The shareable config said it contained "no data". It does contain category labels used in filters and value meanings, and it now says exactly that.
- The command palette only listens for dashboard changes while it is open, so it no longer re-renders on every filter click.

Files: `src/ui/workspace/ExportStep.tsx`, `src/ui/workspace/CommandPalette.tsx`

## 17.0 · Exports, reports, command palette and settings

*Major · 2026-10-15 08:41 UTC · Feature*

Added the Export step: a Power BI package, a multi-page PDF report, a dashboard image, SQL you can verify in the browser, a data dictionary and a shareable config.

- Power BI package (.zip): a semantic model (TMDL), every KPI as a DAX measure with folders and comments, a Date table, the data as CSV, and a README with step-by-step setup and the visual layout. It honestly explains that a native .pbix file cannot be created in a browser.
- PDF report: a branded multi-page report rendered in the light theme, with KPIs, charts and insights.
- PNG export of the whole dashboard at 2× resolution, with an optional transparent background.
- SQL file with one view per KPI and notes on dialects. "Verify in browser" loads DuckDB on demand and checks each SQL result against the number on screen.
- Data dictionary (CSV or Markdown) and a config file that restores the same dashboard when loaded with the same data.
- Command palette (Ctrl/⌘+K) to jump to steps, charts and KPIs, switch layout and theme, or load demo data.
- Settings: theme, number format, currency, a privacy statement and the optional AI layer.

Files: `src/ui/workspace/ExportStep.tsx`, `src/ui/workspace/export/report.tsx`, `src/lib/duckdb.ts`, `src/engine/export/config.ts`, `src/ui/workspace/CommandPalette.tsx`, `src/ui/workspace/SettingsSheet.tsx`

## 16.1 · Reports keep their own theme

*Minor · 2026-10-15 08:37 UTC · Design, Fix*

Colours can now be scoped to one part of the page, so a PDF report renders in the light theme even when the app is dark.

- Theme colours can be applied to a single element, not only the whole page.
- Charts read their colours from the element they sit in, so exported charts match the report rather than the screen.

Files: `src/styles/tokens.css`, `src/ui/charts/tokens.ts`

## 16.0 · Optional AI layer (off by default)

*Major · 2026-10-15 08:37 UTC · Feature, Security*

Added an opt-in "bring your own Anthropic API key" feature. It can suggest the industry and write an executive summary. You see exactly what will be sent before anything leaves the browser.

- Off by default. The whole product works without it.
- Sends only the column list, aggregated numbers and a few masked sample rows, never the dataset. The exact payload is shown first and needs an explicit click to send.
- The API key is kept in memory for the open tab only. It is never saved.
- Uses Claude Opus 5.5 by default (Sonnet 5.5 and Haiku 4.5 are selectable), with structured answers checked against a schema.
- Any number in the AI summary that does not appear in the computed results is flagged as "unverified".
- Server-side refusal fallback is switched on for Opus and Sonnet requests, so a declined request can be completed by a fallback model instead of failing.

Files: `src/lib/ai.ts`, `src/ui/workspace/AiSummary.tsx`, `src/ui/workspace/DetectStep.tsx`, `src/store/settings.ts`

## 15.0 · Dashboard and insights

*Major · 2026-10-15 08:35 UTC · Feature*

Built the dashboard itself, laid out the way an analyst reads it: headline KPIs, then the trend, breakdowns, drivers and detail. The Insights step lists ranked findings, each tied to a chart.

- KPI cards: value, change versus the previous period, sparkline and an optional target. Colour shows whether the change is good or bad for that KPI.
- "How this is calculated" drawer for every KPI: plain-language definition, formula, the columns used, SQL, DAX and time intelligence (MTD, QTD, YTD, YoY, MoM, rolling).
- Filter rail: date presets or a custom range, filters on any dimension, and a summary of active filters.
- Drag-and-drop, resizable grid, with Executive, Analyst and Compact layouts.
- Chart inspector and builder to change a chart's type, measure, grouping or Top-N, or add your own chart.
- A "Not shown" panel lists every KPI and chart that could not be computed and which column it needs. Nothing is faked.
- Insights page: quantified findings ranked by impact, each with its basis and a link to the chart it refers to.

Files: `src/ui/workspace/dashboard/DashboardStep.tsx`, `src/ui/workspace/dashboard/KpiCards.tsx`, `src/ui/workspace/dashboard/KpiDetails.tsx`, `src/ui/workspace/dashboard/FilterRail.tsx`, `src/ui/workspace/dashboard/Inspector.tsx`, `src/ui/workspace/dashboard/WidgetGrid.tsx`, `src/ui/workspace/InsightsStep.tsx`

## 14.0 · Workspace flow: upload, detect, confirm, map

*Major · 2026-10-15 08:30 UTC · Feature*

Built the guided steps before the dashboard: drop a file, see what was detected and how confident Loupe is, confirm or correct the industry, then review how columns were mapped.

- Upload: a drop zone for CSV, TSV, Excel and JSON; demo datasets; a sheet picker for multi-sheet workbooks; a large-file dialog that offers sampling; designed loading and error states.
- Detect & confirm: the top three industries with confidence %, the evidence for each, and the grain ("one row per …"). The guided flow opens automatically when confidence is below 70% or the top two are within 10 points.
- "Describe your business": industry, business model, goal, reporting period and currency. Changes apply instantly.
- Data preview with a fast virtual grid, a data-health panel and a parse report. The parse report says whether dates were read as DD/MM or MM/DD, with a switch to flip it.
- Map columns: change which column fills each role, what category values mean (for example which order statuses count as RTO), column roles and KPI names. Everything regenerates instantly.

Files: `src/ui/workspace/Shell.tsx`, `src/ui/workspace/UploadStep.tsx`, `src/ui/workspace/DetectStep.tsx`, `src/ui/workspace/ConfidenceRing.tsx`, `src/ui/workspace/VirtualGrid.tsx`, `src/ui/workspace/HealthPanel.tsx`, `src/ui/workspace/MapStep.tsx`

## 13.0 · Chart system and workspace state

*Major · 2026-10-15 08:25 UTC · Feature, Design*

Built the charting layer and the app's state. Every chart follows strict visual rules and comes with a table view, a reason for its type, alternatives and export.

- Fourteen chart types: line, area, bar, horizontal bar, stacked bar, donut, treemap, heatmap, cohort grid, India and US state tile maps, scatter with trend line, histogram, Pareto and funnel.
- Visual rules: no dual axes, no 3D, no pie charts with more than six slices, bar axes always start at zero, thin bars, a hairline grid, and a legend only when there are two or more series. Colours come from the validated colour-blind-safe palette.
- Each chart card has a "Why this chart" note, alternative chart types, a table view, Top-N, and PNG, SVG and CSV export.
- Clicking a chart filters by that period, drills down a hierarchy (for example category → sub-category) or cross-filters the rest of the dashboard.
- Workspace state: steps, filters, cross-filter, drill-down, layout and debounced recomputation.

Files: `src/store/workspace.ts`, `src/ui/charts/options.ts`, `src/ui/charts/EChart.tsx`, `src/ui/charts/ChartCard.tsx`, `src/ui/charts/DataTable.tsx`, `src/ui/charts/Sparkline.tsx`, `src/ui/charts/tokens.ts`

## 12.1 · Faster, smarter recomputation

*Minor · 2026-10-15 08:19 UTC · Performance, Fix*

Made dashboard refreshes cheaper and fixed how a chart behaves when you click it to filter the others.

- KPIs are computed once per refresh instead of twice.
- The chart you click to cross-filter keeps showing all of its own bars, so you can still see what you selected against the rest.
- Loading shows clear progress phases: reading, profiling, detecting.
- Date presets (last 12 months, YTD and so on) are defined in one shared place.

Files: `src/engine/session.ts`, `src/workers/engine.worker.ts`, `src/engine/core/periods.ts`, `src/engine/parse/csv.ts`

## 12.0 · Analysis session in a background thread

*Major · 2026-10-15 08:17 UTC · Feature, Performance*

All analysis now runs in a Web Worker, a background thread of the browser tab, so the interface stays smooth even on large files. Your data still never leaves the browser.

- One analysis session holds the dataset and everything derived from it. The screen only receives small results such as KPI values and chart data.
- Charts stream in one by one, and a newer filter change cancels stale work.
- Wide tables (months as columns) can be unpivoted into rows with one click.

Files: `src/engine/session.ts`, `src/workers/engine.worker.ts`, `src/lib/engine-client.ts`, `src/engine/parse/unpivot.ts`

## 11.1 · Shared row selections

*Minor · 2026-10-15 08:13 UTC · Performance*

Filtered row sets are now cached and shared between KPIs and charts, so each filter is applied once per refresh instead of once per chart.

- The most recent filter results are remembered and reused across KPI cards, charts and period comparisons.

Files: `src/engine/query/filter.ts`, `src/engine/query/run.ts`, `src/engine/kpi/compute.ts`, `src/engine/charts/data.ts`

## 11.0 · Export generators: Power BI, SQL, dictionary, config

*Major · 2026-10-15 08:12 UTC · Feature*

Wrote the engines that produce the export files, so the KPIs on screen can be rebuilt in Power BI or any SQL database.

- Power BI package: TMDL semantic model, measures.dax (display folders, comments, a Date table, time intelligence), CSV data and a README with step-by-step setup and a visual-by-visual layout.
- SQL file: CREATE TABLE, one view per KPI, monthly trend views, an RFM view and a cohort view, with notes for DuckDB, PostgreSQL, Snowflake and BigQuery.
- Data dictionary listing every column with its type, role, statistics and the KPIs that use it.
- Shareable config with a fingerprint of the dataset, so it can only be applied to matching data.
- Currency symbols in Power BI number formats are escaped so they display literally.

Files: `src/engine/export/powerbi.ts`, `src/engine/export/tmdl.ts`, `src/engine/export/daxFile.ts`, `src/engine/export/sqlFile.ts`, `src/engine/export/readme.ts`, `src/engine/export/dictionary.ts`, `src/engine/export/config.ts`, `src/engine/export/names.ts`

## 10.1 · Self-review fixes for KPIs, charts and insights

*Minor · 2026-10-15 08:08 UTC · Fix*

Re-read the new analysis code and fixed four issues before moving on.

- The "mix shift" insight (a check for Simpson's paradox) now compares like-for-like time windows in all-time mode.
- Chart templates meant for one part of a business (for example returns) only appear when that part is in the data.
- Cohort analysis uses a safe placeholder for customers with no first order date.
- You can build ad-hoc measures on any column (sum, average, min, max, median, count, distinct count) in the chart builder.

Files: `src/engine/insights/insights.ts`, `src/engine/charts/recommend.ts`, `src/engine/charts/analyses.ts`, `src/engine/kpi/context.ts`

## 10.0 · KPI values, chart recommendations and insights

*Major · 2026-10-15 08:07 UTC · Feature*

Connected the pieces into analysis: KPI values with period comparisons, the right chart for each question, deep e-commerce analyses, and written insights. Every number is computed from the data.

- KPIs for the selected period versus the previous period of the same length, with sparklines and a warning when the latest period is incomplete.
- Time intelligence: MTD, QTD, YTD, YoY, MoM, rolling 3 and 12 months, and moving averages.
- Charts are picked by rules: a trend for time, a ranked bar for categories, a heatmap for weekday × hour, and so on. Each comes with the reason and alternatives.
- Top-N with an "Others" bucket that is recalculated, not summed (so ratios stay correct), and small groups are suppressed.
- E-commerce analyses: RFM customer segments with suggested actions, monthly retention cohorts, Pareto (80/20) and market-basket product pairs.
- Insights: trends, anomalies, concentration, seasonality, segment gaps, drivers and mix shifts, plus caveats such as orders still in transit.
- A generic fallback builds sensible KPIs and charts for data that matches no industry.

Files: `src/engine/kpi/compute.ts`, `src/engine/charts/recommend.ts`, `src/engine/charts/data.ts`, `src/engine/charts/analyses.ts`, `src/engine/insights/insights.ts`, `src/engine/detect/generic.ts`

## 9.1 · End-to-end test on demo data, health check tuned

*Minor · 2026-10-15 07:59 UTC · Tests, Fix*

Ran the whole pipeline on the 48,000-row e-commerce demo: generated in 0.3 s, profiled in 0.2 s, detected as e-commerce with 99% confidence. Tuned the data-health check to stop false warnings.

- Columns that are legitimately mostly empty (coupon code, return reason) are noted as information, not flagged as a problem.
- The "heavy tail" warning only appears for strongly skewed numbers.

Files: `src/engine/profile/quality.ts`

## 9.0 · Demo datasets

*Major · 2026-10-15 07:58 UTC · Data*

Created six realistic demo datasets that are generated the same way every time, so anyone can try Loupe without their own data. They are clearly labelled as demo data.

- D2C e-commerce: about 48,000 order lines over two years across 24 Indian states, with COD and prepaid payments, RTO, couriers, coupons, sale events and returns that rise with discounts.
- Smaller sets for B2B sales, marketing campaigns, SaaS MRR, a P&L ledger against budget, and an HR roster.

Files: `src/engine/samples/ecommerce.ts`, `src/engine/samples/small.ts`, `src/engine/samples/builder.ts`, `src/engine/samples/catalog.ts`

## 8.1 · Proof that the numbers are right

*Minor · 2026-10-15 07:51 UTC · Tests, Security*

Added an automated test that computes every e-commerce KPI twice, once with Loupe's engine and once by running the generated SQL in DuckDB, and requires the results to match.

- 64 of 64 KPIs match overall, and all 1,344 monthly values match too.
- Exports guard against spreadsheet formula injection: cells starting with =, +, -, @ or a tab are made safe.

Files: `tests/registry.test.ts`, `tests/helpers/duck.ts`, `tests/helpers/synthetic.ts`, `src/engine/export/csv.ts`

## 8.0 · KPI compilers: SQL and DAX

*Major · 2026-10-15 07:48 UTC · Feature*

Every KPI definition can now be translated into SQL and Power BI DAX that give the same answer as the on-screen number.

- SQL that runs on DuckDB and PostgreSQL, with readable common table expressions for complex KPIs.
- DAX measures that use DIVIDE for safe division, branch on other measures, and follow standard patterns for new customers and closing balances.
- Registry checks catch broken references or circular KPI definitions before they reach users.

Files: `src/engine/compile/sql.ts`, `src/engine/compile/dax.ts`, `src/registry/validate.ts`, `src/engine/kpi/context.ts`

## 7.0 · Industry detection

*Major · 2026-10-15 07:45 UTC · Feature*

Loupe can now recognise what kind of business a table describes, how sure it is, and why.

- Matches column names to known fields, handling synonyms, abbreviations (qty, amt, cust), plurals and near-spellings.
- Uses the values as evidence too, for example order statuses that include "RTO" or payment methods that include "COD".
- Scores each industry and its sub-areas (orders, returns, inventory, marketing …), then reports the top three with confidence % and evidence.
- Decides which KPIs can be computed. When a KPI can't be, it says which column is missing and suggests a substitute.

Files: `src/engine/detect/match.ts`, `src/engine/detect/mapping.ts`, `src/engine/detect/detect.ts`, `src/engine/kpi/resolve.ts`

## 6.0 · Industry knowledge base and e-commerce

*Major · 2026-10-15 07:42 UTC · Feature, Data*

Created the extensible knowledge base that describes each industry as a JSON file, and wrote the deepest one first: e-commerce with Indian specifics.

- Each industry lists its fields and their synonyms, what category values mean, its sub-areas, KPIs with definitions, formulas and benchmarks, chart templates and common pitfalls.
- E-commerce: about 55 fields and 64 KPIs, including net revenue, AOV, gross margin, COD share, RTO rate, return rate, repeat rate, new customers, delivery time and marketing and inventory KPIs.
- Indian specifics: COD, RTO, GST, pincode and city tiers, and courier performance.
- All industry files are validated against a strict schema when the app loads.

Files: `src/registry/schema.ts`, `src/registry/domains/ecommerce.json`, `src/registry/index.ts`

## 5.1 · Query engine self-review fixes

*Minor · 2026-10-15 07:37 UTC · Fix*

Fixed three small issues found while re-reading the query engine.

- Top-N rankings no longer drop the "(blank)" group.
- Bin labels (for example ₹500–₹1,000) are shared by charts and tables.
- Row calculations can measure the days between two dates, used for delivery time.

Files: `src/engine/query/run.ts`, `src/engine/query/groupby.ts`, `src/engine/query/expr.ts`

## 5.0 · Query engine

*Major · 2026-10-15 07:37 UTC · Feature*

Built the calculator behind every number: a small expression language for KPIs, plus fast filtering and grouping over the typed columns.

- KPIs are defined once as expressions (sums, averages, distinct counts, safe division, filtered measures, per-customer measures, new customers, latest snapshot).
- Ratios are always a ratio of sums, never an average of row ratios, and division by zero gives "no value" instead of an error or infinity.
- Grouping by category, by time (day to year), by weekday or hour, and by value bands.

Files: `src/engine/query/expr.ts`, `src/engine/query/filter.ts`, `src/engine/query/groupby.ts`, `src/engine/query/evaluate.ts`, `src/engine/query/run.ts`

## 4.0 · Column profiling and data health

*Major · 2026-10-15 07:31 UTC · Feature*

Loupe now studies every column: what type it is, what role it plays, how values are distributed, and how trustworthy the table is overall.

- Roles: measure, currency, percentage, dimension, identifier, date, geography, boolean and free text.
- Statistics: missing values, distinct counts, min/median/max, outliers, top values and common patterns (emails, phone numbers, pincodes, SKUs).
- Structure: primary keys, the grain of the table, hierarchies (category → sub-category), the main date, gaps in the time series, additivity, and wide tables with months as columns.
- A data-health score from 0 to 100 with specific, fixable issues.
- Recognises Indian and US states, countries and major cities for maps.

Files: `src/engine/profile/profile.ts`, `src/engine/profile/roles.ts`, `src/engine/profile/structure.ts`, `src/engine/profile/patterns.ts`, `src/engine/profile/quality.ts`, `src/engine/profile/geo.ts`, `src/engine/profile/names.ts`

## 3.0 · File import engine

*Major · 2026-10-15 07:21 UTC · Feature*

Loupe can read CSV, TSV, Excel and JSON files directly in the browser and works out their structure automatically.

- Detects the delimiter, the text encoding and the header row, and streams large files in chunks.
- Excel workbooks with a sheet picker; JSON arrays, wrapped records and line-delimited JSON, with nested fields flattened.
- Understands ₹1,23,456.50, $1,234, 12.5%, (1,234) as a negative, and European 1.234,56.
- Reads more than 20 date formats. Decides DD/MM versus MM/DD from the whole column, not one cell, and tells you which it chose.
- Stores data in compact typed columns, which keeps memory low and scans fast.
- Warns before very large files and offers to sample them.

Files: `src/engine/parse/csv.ts`, `src/engine/parse/excel.ts`, `src/engine/parse/json.ts`, `src/engine/parse/sniff.ts`, `src/engine/parse/values.ts`, `src/engine/parse/dates.ts`, `src/engine/parse/builder.ts`, `src/engine/core/types.ts`, `src/engine/core/format.ts`

## 2.0 · Design system and brand

*Major · 2026-10-15 07:08 UTC · Design*

Created Loupe's look, "quiet luxury meets precision instrument": graphite surfaces, one brass accent, an editorial serif for headlines and tabular figures for numbers.

- Colour tokens for dark (default) and light themes, with status colours that are never reused for data series.
- Chart palettes checked with a colour-vision simulator: 8 categorical colours per theme, a brass sequential scale and a diverging scale.
- Type: Instrument Serif for display, Geist for the interface, and Geist Mono with tabular figures so numbers line up.
- A 4/8 px spacing grid, radii of 10/14/20 px, soft shadows and motion that respects reduced-motion settings.
- Fifteen accessible interface components (buttons, menus, dialogs, sheets, tabs, tooltips …) built on Radix.
- The Loupe mark (a lens rim with a brass measuring arc) and wordmark.

Files: `src/styles/tokens.css`, `src/app/globals.css`, `src/ui/primitives/`, `src/ui/brand/logo.tsx`, `src/app/layout.tsx`

## 1.1 · Tooling and security configuration

*Minor · 2026-10-15 07:03 UTC · Security*

Configured strict type-checking, linting, formatting and tests, plus browser security headers that back up the privacy promise.

- TypeScript strict mode, and ESLint forbids the unsafe `any` type.
- A Content-Security-Policy that only allows network requests to this site, the DuckDB library (when you verify SQL) and the Anthropic API (only if you turn AI on).
- Kept TypeScript at 5.9 and ESLint at 9, because the Next.js lint rules do not support TypeScript 7 or ESLint 10 yet.

Files: `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `.prettierrc.json`

## 1.0 · Project foundation

*Major · 2026-10-15 06:59 UTC · Feature*

Read the product brief, chose the name Loupe, and set up the app's technical base. It is a single-page web app that runs entirely in the browser and deploys to Vercel's free tier.

- Next.js 16 and React 19 with TypeScript, styled with Tailwind CSS 4.
- Libraries for charts (ECharts), state (Zustand), validation (Zod), motion (Framer Motion), accessible components (Radix), files (PapaParse, SheetJS) and in-browser SQL (DuckDB-WASM).
- No backend, no database and no accounts, by design.

Files: `package.json`
