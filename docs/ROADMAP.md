# Loupe: senior-analyst product review and staged plan

Written 25 Oct 2026, at version 52.1 (about 96,000 lines of TypeScript, 26 industry templates, 83 test files).

This file is both the review and the **prompt to implement it**. Work through it one stage at a time, in order.

---

## The prompt (read this first)

You are a senior data analyst and product engineer turning Loupe into a product businesses pay for every month. Implement the plan below.

**How to work**

1. Do **one stage at a time**, items in the order listed. When a stage is done, report what changed (before → after, with real figures) and **ask before starting the next stage**.
2. Items marked **⚠ Owner decision** change a core rule of the product, such as "no backend" or "no network calls". Ask the owner, propose the options, and wait for an answer before building.
3. Every finished item follows `CLAUDE.md`:
   - a version entry in `src/content/changelog.ts` (MAJOR for a new capability, MINOR for a fix or a follow-up);
   - tests, typecheck, lint, prettier and `npm run build` all green;
   - commit and push.
4. Keep every invariant in `CLAUDE.md`: never fabricate a number; privacy; SQL, DAX and the evaluator agree; hidden columns are never computed from; semantic tokens; named type sizes; short text on screen.
5. Prove each fix on real files: the public corpus, and the owner's own files read locally. Never copy the owner's files into the repo, and never commit `tests/zz-*`.
6. "Done when" is the acceptance test of each item. An item isn't done until it is met.

---

## Verdict in one paragraph

Loupe's engine is its moat:

- every figure is computed, compiled to SQL and DAX, and checked against DuckDB;
- the audit of 125 public files now finds no wrong figures;
- privacy is real, and the interface is polished and accessible.

But today it is a **one-session tool**. Nothing is saved, nothing is shared, and nothing refreshes. A reload loses the work. Businesses pay monthly for something they **come back to**: the same dashboard on next month's data, shared with the team, sent every Monday.

The effort has also spread wide:

- 26 industries, many of them half-fitting;
- a dozen export formats;
- four ways to view a dashboard;
- a chart-colour studio;
- a public log of 113 micro-versions.

Meanwhile the analyst basics are missing: Excel export, a pivot table, calculated columns, saved views and a forecast. The plan fixes trust first, then trims, then builds what makes people return and pay.

---

## Stage 1: Corrections (trust first, no backend)

**Done in version 52.2.** What changed from the plan:

- **1.1:** a currency chosen for a file without one is remembered for the next such file (Settings → Currency, with "Forget").
- **1.6:** without a currency mark, amounts named by year read as amounts (not counts) but carry no symbol.
- **1.9:** the audit is `npm run corpus` then `npm run audit`, against `tests/fixtures/audit-baseline.json`. The repo has no CI yet, so it runs locally.

Left over: data-led KPIs on code-like number columns ("Total date" for a yymmdd column, "Total Footnote"), and the two baseline flags.

| #   | Correction                                                                                                                                | Why it matters to an analyst                                                                                                                             | Done when                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | **No ₹ by default.** A file with no currency shows plain numbers, not ₹. The Myanmar supermarket file showed ₹.                           | A wrong currency on a client deck is an instant credibility loss.                                                                                        | A file with no currency sign or code shows no symbol until the user picks one. Indian files (₹, Rs, INR, lakh/crore) still get ₹. |
| 1.2 | **Number format from the browser.** Choose Indian (12,34,567) or international (1,234,567) from the browser's locale.                     | Global users see their own format.                                                                                                                       | The default follows `navigator.language`, and the user's choice still wins.                                                       |
| 1.3 | **Confident or data-led.** When the industry fits weakly, lead with the data-led dashboard and offer the industry as a suggestion.        | Misdetected industries give nonsense KPIs: wine read as Pharma, startup funding as Education, a survey as Project management, census data as E-commerce. | No corpus file whose industry is wrong gets that industry's KPIs as heroes. The benchmark's confidently-wrong rate does not rise. |
| 1.4 | **Reconciliation checks.** Show figures that must agree: gross − discounts = net, revenue − costs = profit, segments add up to the total. | The owner's UCI file has gross sales 93.0M, discounts 10.8M and revenue 92.8M, which don't reconcile. An analyst checks this before anything else.       | Data health lists each failed reconciliation with the gap and the columns involved. Files that reconcile show "checked".          |
| 1.5 | **The right date axis.** Prefer the transaction or issue date over attribute dates, and let the user switch the date axis.                | Lending Club's trend charts used `earliest_cr_line` (the borrower's first credit line), not `issue_d`.                                                   | Time charts use the event date of the row. A date picker on the dashboard switches the axis for every chart.                      |
| 1.6 | **Year-named columns.** In a wide table, columns named 2024 and 2025 that hold money are amounts, not integer counts.                     | The Ettlingen budget showed "Total 2025" as a count.                                                                                                     | Year headers holding money read as currency.                                                                                      |
| 1.7 | **The seven mapping-kind mismatches** left in the corpus audit (place → department, identifier → customer, and so on).                    | Each produces odd labels and charts.                                                                                                                     | The corpus audit shows 0 mapping-kind flags.                                                                                      |
| 1.8 | **Explain the health score.**                                                                                                             | "Health 91" means nothing on its own.                                                                                                                    | The score opens with its three largest deductions and how to fix each.                                                            |
| 1.9 | **Make the computation audit a permanent regression suite.** Use public, licence-safe files only.                                         | Stages 1–5 of the computation fixes must never quietly regress.                                                                                          | `npm run audit` runs in CI on the public corpus and fails on any new flag.                                                        |

---

## Stage 2: Trim the extravagant (focus)

**Done in version 52.4.** What changed from the plan:

- **2.1:** the core six are fixed in `src/registry/core.ts`. Their KPI sets weren't re-reviewed in this stage.
- **2.2:** "Data" is CSV and the dictionary until the Excel export lands (3.3).
- **2.4:** each action appears in at most two places from 1024 px. The quick menu holds help, search, theme and settings, plus two chart actions. The hallway test is for the owner to run.
- **2.6:** all 115 versions fall in one month, so the highlights lead with each month's new capabilities. The quick menu's version dot links to the page, not to one highlight.
- **2.7:** on a 4× slower CPU over mid-range 4G, page load (LCP) took 1.0–1.8 s and taps answered (INP) in 80–136 ms, over five runs. Before: 230–340 ms, from the hero's period menu.

Rule: **simplify, hide or freeze before deleting.** Delete only code that becomes dead.

| #   | What is extravagant                                                                                                                                        | Decision                                                                                                                                                                                                       | Done when                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 2.1 | **26 industry templates.** Breadth over depth: each needs its fields, KPIs, charts, detection and benchmark upkeep, and weak fits mislead (1.3).           | **Focus on 6 core industries**, polished end to end: E-commerce/D2C, B2B sales, Finance & P&L, Marketing, SaaS subscriptions and HR. The other 20 stay, labelled **Beta**, and lean on the data-led dashboard. | The detect step labels Beta industries. The core six each have reviewed KPI sets and demo data.        |
| 2.2 | **A dozen export formats:** Power BI package, SQL, DAX, dictionary, CSV, config, dashboard PDF, text PDFs, 4K slide PNGs, slide PDF, one-page PNG and PDF. | **Four user-facing choices:** Report (PDF), Slides (PPTX/PDF), Data (Excel/CSV), and For analysts (SQL · DAX · Power BI, under one card).                                                                      | The export gallery shows 4 cards. Nothing is lost; the analyst formats sit under "For analysts".       |
| 2.3 | **Four ways to view a dashboard:** one page, all charts, and Executive/Analyst/Compact.                                                                    | **Two views:** Overview (the one page) and All charts, with a density switch (Comfortable/Compact). Executive becomes Overview.                                                                                | The toolbar shows one view switch and one density switch. Saved configs map old modes to the new ones. |
| 2.4 | **Overlapping navigation:** sidebar, top bar, bottom bar, flow dock, command palette and the quick menu.                                                   | Give each one job. Sidebar: where you are. Command palette: everything by name. Quick menu: help and account only, with no step shortcuts. Flow dock: the next step only.                                      | No action appears in more than two places. A five-user hallway test finds every action.                |
| 2.5 | **The chart-colour studio:** presets, your colours, one colour, logo extraction and a colour-blind tuner.                                                  | **Freeze.** The presets show first; the rest sits under "Advanced".                                                                                                                                            | The default panel shows the presets and Apply. Advanced is one click away.                             |
| 2.6 | **A public log of 113 micro-versions** (51.1, 51.2…).                                                                                                      | Users see **monthly "What's new" highlights**. The detailed log stays, collapsed, for the curious.                                                                                                             | `/changelog` opens on highlights. The version dot in the quick menu links to the latest highlight.     |
| 2.7 | **Landing-page motion.**                                                                                                                                   | Keep the hero, cut the loops to the ones that explain the product, and set a speed budget.                                                                                                                     | LCP < 2.0 s and INP < 200 ms on a mid-range phone.                                                     |
| 2.8 | **The 1,400-line glossary** as a separate destination.                                                                                                     | Keep it, but surface each term **where it is used** (ⓘ links), not as a page to browse.                                                                                                                        | Every ⓘ on a KPI or chart links to its glossary entry.                                                 |

---

## Stage 3: Missing analyst essentials (browser-only, no backend)

**In progress.** 3.1 is done in version 53.0: projects are kept in IndexedDB, reopen on reload, and are listed in Recent projects with .loupe download and import. A table reshaped in the app (unpivoted) reopens from its source file, so the unpivot must be done again.

3.2 is done in version 55.0: "Refresh with new data" (a project's menu, a file dropped on its row, the quick menu or the command palette) reads the new file against the dashboard's columns. A renamed column is read under its saved name when the match is unambiguous (same spelling, same words or a close spelling, never by position and never across periods). What names a missing column is taken off, and a report lists the renamed, missing, new and retyped columns and the KPIs and charts not kept, with Undo.

3.3 is done in version 56.0: the Excel workbook (Export › Excel and data) holds a Summary of the KPIs (value, and the change with the figures it runs from and to), one sheet per chart, the Data behind the dashboard and the Dictionary, in native number and date formats. It is written by Loupe's own .xlsx writer (engine/export/xlsx.ts) and opens in Excel without repair; tests read it back and check its KPI values, chart values and the Data sheet's revenue total against the dashboard.

3.4 is done in version 57.0: Export › Presentation slides › PowerPoint makes a .pptx of the same deck, in which every title, takeaway, KPI and figure is an editable text box and every card a shape, at the place the slide draws it, and each chart or table is a picture with its alt text. It is written by Loupe's own .pptx writer (engine/export/pptx.ts, no new dependency) and was checked by opening it in PowerPoint and drawing its slides back. Native, data-editable charts are not part of it.

| #    | Missing feature                                                                                                                                                                                                        | Why                                                                                                                                                          | Done when                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 3.1  | **Save and reopen work.** Projects (dataset + dashboard) are saved in the browser (IndexedDB/OPFS), and the upload page lists recent projects. A project can also be exported and imported as a `.loupe` file.         | **The biggest gap.** Today a reload loses the data and the dashboard. Export › "Reopen this dashboard later" saves and loads the settings, but not the data. | Reload → the same dashboard in under 2 s. `.loupe` round-trips exactly. Storage use is shown and clearable.                          |
| 3.2  | **Refresh with next month's file.** Apply a saved dashboard to a new file with the same columns, with a report of what changed (new, missing and renamed columns).                                                     | Recurring reporting is why people pay monthly.                                                                                                               | Dropping a matching file on a project keeps every chart, KPI, filter and colour, and the report lists the differences.               |
| 3.3  | **Excel export (.xlsx):** KPIs, each chart's table, the filtered data and the dictionary, with native number formats.                                                                                                  | Business users live in Excel; the Power BI package is niche.                                                                                                 | The file opens in Excel and Google Sheets with formats intact, and its totals equal the dashboard's.                                 |
| 3.4  | **Editable PowerPoint (.pptx)**, not only slide images.                                                                                                                                                                | Decks get edited before every meeting.                                                                                                                       | Each slide has editable titles and text, and the charts are images or native charts.                                                 |
| 3.5  | **Pivot table explorer:** rows, columns and values, with totals, % of total and sorting, and export.                                                                                                                   | The analyst's first tool after a dashboard.                                                                                                                  | Any pivot matches DuckDB for the same query, and it exports to Excel.                                                                |
| 3.6  | **One comparison switch:** previous period, same period last year, or custom, for every card and chart. Today year-on-year appears only inside a KPI's details.                                                        | Seasonal businesses compare with last year.                                                                                                                  | Switching updates every delta, its label and the export.                                                                             |
| 3.7  | **Forecast**, explainable and clearly labelled as a projection: seasonal naive or ETS, with a range, only with 24 or more periods. **⚠ Owner decision:** a forecast is an estimate, so it must never mix with actuals. | Planning needs a forward view.                                                                                                                               | A separate dashed series and band, labelled "Projection", never added to totals and never in a KPI value. A backtest error is shown. |
| 3.8  | **Calculated columns** (row formulas), bands and date parts, compiled to SQL and DAX like KPIs.                                                                                                                        | Real data always needs one more column (margin per line, age band).                                                                                          | A calculated column works in filters, charts, KPIs and every export, and passes the DuckDB equality test.                            |
| 3.9  | **Saved views:** named filter sets ("North region, Q3"), with one-click switching.                                                                                                                                     | Teams look at the same cuts every week.                                                                                                                      | Views save with the project and appear in export file names.                                                                         |
| 3.10 | **Chart annotations:** events such as "Campaign launched, 3 Mar" on time charts.                                                                                                                                       | They explain the spike before anyone asks.                                                                                                                   | Annotations show on charts, in the PDF report and in the slides.                                                                     |
| 3.11 | **Significance on insights.** An insight says "significant" only after a test, and warns about small samples.                                                                                                          | Stops analysts presenting noise as findings.                                                                                                                 | Each comparison insight carries its test, and an insight from fewer than N rows says so.                                             |
| 3.12 | **Join two files** (orders + customers) on a key, not only sheets of one workbook.                                                                                                                                     | Most real questions span two tables.                                                                                                                         | A join preview shows the match rate. Unmatched rows are counted, never dropped silently.                                             |
| 3.13 | **Targets and budgets set in the app**, per KPI and per period, with progress. They exist partly today.                                                                                                                | Targets turn a dashboard into management.                                                                                                                    | Targets are set on a card, show on its chart and are exported.                                                                       |

---

## Stage 4: Bigger and live data

| #   | Missing feature                                                                           | Note                                                                             |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 4.1 | **Large files and Parquet** through DuckDB-WASM as the engine above about 2 million rows. | Browser-only, so it keeps the privacy model. DuckDB is already loaded on demand. |
| 4.2 | **Google Sheets / Excel Online connector**, using the user's own sign-in in the browser.  | **⚠ Owner decision:** the CSP gains Google and Microsoft hosts.                  |
| 4.3 | **Database connectors** (Postgres, MySQL, BigQuery, Snowflake).                           | **⚠ Owner decision:** needs a backend or a small local agent.                    |
| 4.4 | **Scheduled refresh.**                                                                    | **⚠ Owner decision:** needs a backend (Stage 5).                                 |

---

## Stage 5: The SaaS platform (⚠ owner decision: introduces a backend)

| #   | Missing feature                                                                                             | Why                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 5.1 | **Accounts and workspaces** (email link, Google sign-in), with roles (owner, editor, viewer).               | Teams, not single users, pay.                                                                     |
| 5.2 | **End-to-end encrypted sync:** projects encrypted in the browser, so the server stores only ciphertext.     | Keeps the "your data never leaves you" promise, a real selling point against Power BI and Looker. |
| 5.3 | **Share links:** view-only, expiring, optionally password-protected; plus embeds.                           | The dashboard is consumed by people who never upload.                                             |
| 5.4 | **Comments and mentions** on charts and KPIs.                                                               | Discussion stays with the number.                                                                 |
| 5.5 | **Scheduled reports** (email, Slack) and **KPI alerts** (threshold and anomaly).                            | The Monday report is the habit that retains customers.                                            |
| 5.6 | **Billing:** Free (local projects), Pro (sync, sharing, schedules) and Team (roles, comments), with limits. | Revenue.                                                                                          |
| 5.7 | **Enterprise:** SSO/SAML, audit log, data residency, DPA.                                                   | Larger contracts.                                                                                 |

---

## Stage 6: Go to market and operations

| #   | Missing                                                                                                                       | Note                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 6.1 | **Pricing page** and plan comparison.                                                                                         | Linked from the landing page and the quick menu.                                                   |
| 6.2 | **Help centre** organised by task ("refresh a monthly report"), an onboarding checklist and a first-run tour.                 | The glossary explains words; users need tasks.                                                     |
| 6.3 | **Product analytics and error reports**, opt-in and privacy-preserving (no data values, no file names).                       | **⚠ Owner decision:** today's rule forbids analytics. Without any signal, the product can't learn. |
| 6.4 | **Legal:** privacy policy, terms and DPA.                                                                                     | Required before charging.                                                                          |
| 6.5 | **Support:** an in-app ticket form and inbox (replacing mailto), and a status page.                                           | Response times, a record of issues.                                                                |
| 6.6 | **Market choice:** India-first (₹, lakh/crore, GST) or global (USD, international formats), and interface languages to match. | **⚠ Owner decision:** it sets the defaults in 1.1 and 1.2 and the pricing currency.                |

---

## Owner decisions to settle before Stage 4

1. **A backend, or not?** Hosting region, and whether sync is end-to-end encrypted.
2. **Telemetry policy:** none, opt-in aggregate, or opt-out.
3. **Target market:** India SMB first, or global.
4. **The six core industries:** confirm or change the list in 2.1.
5. **Pricing:** plans, limits and currency.
6. **Forecasts:** allowed as labelled projections?
