# Architecture

Loupe is a static Next.js app. All analysis happens in the browser: the UI runs on the main thread, and a stateful analysis **session** runs in a Web Worker. Nothing is uploaded.

```
 Main thread (React 19)                         Web Worker (src/workers/engine.worker.ts)
 ─────────────────────                          ─────────────────────────────────────────
 src/app, src/ui           ──Comlink calls──▶   Session (src/engine/session.ts)
 Zustand store              ◀─small results──     dataset, profile, mapping, KPI resolution,
 (src/store/workspace.ts)    (transfer for zips)   chart specs, last results
```

- The worker holds the dataset and everything derived from it. The UI only receives small results: KPI values, chart series and paged preview rows. Binary exports (zip, CSV) are transferred, not copied.
- `computeDashboard` sends KPIs first and then each chart as it finishes. It yields between charts and drops work for an older request id, so a new filter click cancels stale work.
- The store debounces recomputation (90 ms). The chart that started a cross-filter is excluded from its own filter.

## Data model (`src/engine/core/types.ts`)

Columnar and typed, so millions of cells fit in memory and scans stay fast.

| Column  | Storage                                                                          | Null  |
| ------- | -------------------------------------------------------------------------------- | ----- |
| number  | `Float64Array`                                                                   | `NaN` |
| date    | `Float64Array` of wall-clock ms stored as UTC (never shifted between time zones) | `NaN` |
| string  | `Int32Array` dictionary codes + `dict: string[]`                                 | `-1`  |
| boolean | `Int8Array` (1/0)                                                                | `-1`  |

## Pipeline

1. **Parse** (`engine/parse`). `ingestFile` dispatches to delimited, workbook or JSON readers.
   - CSV is decoded as a stream (the encoding is sniffed from the BOM or by validation), the delimiter and header row are sniffed from the first megabyte, and PapaParse reads chunks through a decoder that never splits multibyte characters.
   - Each column has an accumulator that starts typed (number, date, boolean) and degrades to text losslessly when more than 5% of values don't fit.
   - Day/month order is decided from evidence across the whole column; ambiguity is reported in the `ParseReport`.
2. **Profile** (`engine/profile`). Per column: storage, semantic role, additivity, statistics, patterns (email, phone, pincode, SKU…) and geography. Per dataset: keys and grain, hierarchies, primary date, time-series gaps, wide format, currency. `quality.ts` turns this into a health score with fixable issues.
3. **Detect** (`engine/detect`). `match.ts` scores every (field, column) pair using synonyms, an abbreviation-aware tokenizer (word order and filler words ignored), single-word fuzzy matching, role compatibility and value hints. A partial match on one distinctive word is only a hint that needs value evidence. Fields are assigned greedily one-to-one above a threshold. `detect.ts` scores each domain on:
   - **fit:** sub-domain signal coverage, or the abundance of the domain's vocabulary
   - **distinctiveness:** a column counts more when fewer industries can explain it
   - **contrast:** points are lost when a strong rival explains your distinctive columns better, and each candidate reports the deduction

   It returns the top three with evidence and grain; `tests/fixtures/detection.json` holds 75 real-world layouts with the expected result. `generic.ts` builds a fallback domain from the profile.

4. **Map** (`detect/mapping.ts`). The mapping is field → column plus value classes (field.class → raw values, matched by keywords; for example `order_status.rto` → `["RTO", "RTO Delivered"]`). User overrides always win.
5. **Resolve KPIs** (`kpi/resolve.ts`). Each KPI has ordered variants. The first variant whose fields, classes and referenced KPIs are available is used. If none is, the KPI is unavailable with a precise reason and a substitute. `selectKpis` picks 4–6 hero and up to 12 supporting KPIs.
6. **Compute** (`kpi/compute.ts`, `query/*`). Values cover the selected period and the previous period of equal length (month-aligned periods compare to the same number of months before). Sparklines, a partial-period flag and time intelligence (MTD, QTD, YTD, YoY, MoM, rolling windows, 7-day moving average for additive KPIs) are computed here too.
7. **Charts** (`charts/*`). `recommend.ts` adapts registry chart templates to the data, skipping any it can't draw (with a reason) and attaching a "why this chart" reason and compatible alternatives. `data.ts` computes series with drill-down, Top-N plus an "Others" bucket that is recomputed rather than summed, minimum-group suppression, bins, partial periods and peak annotations. `analyses.ts` holds RFM, cohorts and market basket.
8. **Insights** (`insights/insights.ts`). Generators for trend, anomaly (robust z-score on MAD), concentration, seasonality, segment gaps (rates only), drivers and Simpson's-paradox mix checks, plus caveats. Each insight carries the numbers it cites, a basis and a chart link.
9. **Export** (`export/*`). Power BI package, SQL file, DAX file, TMDL model, README, data dictionary, CSV (formula-injection guard) and config. See below.

## The expression language (`engine/query/expr.ts`)

A KPI is an `Expr`, compiled three ways that must agree:

- `evaluate.ts`: the in-browser evaluator, which runs over typed arrays with a shared cache per refresh
- `compile/sql.ts`: SQL that runs on DuckDB and PostgreSQL, with CTEs for per-entity, new-entity and snapshot measures
- `compile/dax.ts`: DAX measures (DIVIDE, KEEPFILTERS, DISTINCTCOUNTNOBLANK, measure branching)

| Node          | Meaning                                                                              |
| ------------- | ------------------------------------------------------------------------------------ |
| `agg`         | sum, avg, min, max, median, count, countDistinct, spanDays, with an optional `where` |
| `op`          | add, sub, mul, div (div is safe: x/0 = no value)                                     |
| `ref`         | another KPI (measure branching)                                                      |
| `calc`        | an expression evaluated under an extra filter                                        |
| `per`         | an inner measure per entity, reduced (sum/avg/count/…) with an optional `having`     |
| `newEntities` | entities whose first-ever date falls in the period                                   |
| `atLatest`    | the value on the latest snapshot date (semi-additive balances)                       |

Semantics follow SQL: SUM over nothing is 0, AVG over nothing is null, COUNT DISTINCT ignores blanks, ratios are ratio-of-sums. `tests/registry.test.ts` proves engine = SQL in DuckDB for every formula in every industry, overall and per month.

## Industry knowledge files (`src/registry`)

Each `domains/<id>.json` is validated by `schema.ts` (Zod) and `validate.ts` (references, cycles). It contains:

- **fields**: id, label, roles, synonyms, value hints, exclude tokens and a weight
- **valueClasses**: per field, ordered classes with keywords (first match wins)
- **subDomains**: business areas with the signal fields that identify them, their grain, and optionally `timeModel: "roster"`. A roster's rows are standing entities (employees, customers, products) whose date marks when they started, so Loupe opens on the whole file and makes no period comparison. Event data (the default) opens on recent activity.
- **kpis**: tier, priority, format, direction, group, ordered variants, benchmark and pitfalls, plus optional sub-domain tags
- **charts**: templates with kind, axes, measures, alternatives, sizes and layout modes
- **pitfalls**: interpretation warnings that also go into the export README

To add an industry, write the JSON, import it in `registry/index.ts`, then run `npx vitest run tests/registry.test.ts -t "<id>.json"`.

## Exports

| File                | Contents                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loupe-powerbi.zip` | `data.csv` (snake_case headers, ISO dates), `measures.dax` (Date table, measures in display folders, time intelligence, Loupe's values as comments), `*.SemanticModel/` (TMDL: model, tables, relationships, M partition), `README.md` (two setup paths, KPI check table, visual-by-visual layout), `kpis.sql`, the data dictionary and the config |
| `kpis.sql`          | CREATE TABLE, one view per KPI, monthly views with MoM and YoY (YTD for additive KPIs), RFM and cohort views, dialect notes                                                                                                                                                                                                                        |
| PDF / PNG           | Off-screen render in the light theme, rasterised at 2×                                                                                                                                                                                                                                                                                             |
| Config JSON         | Domain, mapping, value classes, roles, KPI names and targets, layout, custom charts, filters, and a dataset fingerprint; no data rows                                                                                                                                                                                                              |

There is deliberately no `.pbix`; see the README.

## Landing page

`/` is prerendered. `src/ui/landing/preview-data.ts` runs the real Session on the e-commerce demo during `next build` and passes a small snapshot to the animated hero, so every number on the page is engine output.

## Security and privacy

- **CSP** (`next.config.ts`, production): `connect-src` allows only `'self'`, jsDelivr (DuckDB) and `api.anthropic.com` (opt-in AI). Workers come from `'self'` and `blob:`.
- **AI layer** (`lib/ai.ts`): off by default. It uses your own key, kept in memory only. The payload is shown before sending and contains schema, aggregates and a masked sample.
- **Rendering**: data-derived strings in chart tooltips are HTML-escaped; everything else goes through React.
- **CSV export**: cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'`, except plain numbers and phone-like values.

## Testing

| Suite                 | Covers                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `registry.test.ts`    | Schema, references, and engine = SQL (DuckDB) for every KPI formula, overall and monthly |
| `kpi.test.ts`         | Hand-computed answers through the full pipeline                                          |
| `parse.test.ts`       | Encodings, delimiters, number styles, date order, Excel, JSON                            |
| `chart-rules.test.ts` | Spec rules for chart choice on every demo                                                |
| `perf.bench.test.ts`  | 100k-row budget (1M rows with `LOUPE_BENCH=1`)                                           |
| `changelog.test.ts`   | Version-log numbering and dates                                                          |

Other suites (equivalence, insights, chart data, AI payload, security, exports, detection, import regressions) cover specific fixes.
