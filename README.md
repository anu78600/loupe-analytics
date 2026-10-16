# Loupe

**Analyst-grade dashboards from clean data, with the working shown.**

Drop in a clean CSV, Excel or JSON file. Loupe profiles every column, recognises the industry (16 built in, plus a generic fallback), computes the KPIs that matter and lays them out the way an analyst reads a dashboard. Columns the industry template doesn't know still get their own KPIs and charts, and **Ask for a chart** designs a chart from a request in your own words ("average customer rating by city"). Every KPI shows its definition, formula, SQL and DAX. You can export a Power BI package, SQL, a PDF report or PNG images.

The workspace runs in eight steps:

1. **Upload** a clean CSV, TSV, Excel or JSON file.
2. **Detect** what kind of data it is, with every column header and the kind of values it holds.
3. **Check & map**: the whole file with any problem marked (unreadable cells, impossible values, repeated rows), then how the columns were mapped. Columns you keep only as a reference (say `Unit_Price` next to your `Unit_Price_Clean`) can be hidden: they stay in the file, and nothing is computed from them. Loupe suggests the raw/clean pairs it recognises.
4. **Customise**: full control of what the dashboard shows. Choose which KPIs sit in the headline row (up to six), which support it and which stay off, in your order, and build your own KPI from any column (a total, average, median, lowest, highest, distinct count, row count, or a ratio of two). Show, hide, rename, resize, reorder or retype any chart, or change the columns it uses. **Create a chart** offers 28 chart types in ten groups (change over time, comparison, ranking, part of a whole, distribution, relationships, flow, geography, a single number, exact figures), each with two lines on what it shows and what data it suits best, and a live preview.
5. **Dashboard**: KPIs and charts, plus your own charts from **Ask for a chart**. **Colours** sets the chart colours everywhere: a preset, your own brand colours, or one colour turned into a gradient, each with a live preview and a colour-blind readability check.
6. **Questions & SQL**: business questions (suggested, or in your own words), each answered from the data with the SQL query that returns the same answer, checkable in the browser.
7. **Insights**: ranked, quantified findings.
8. **Export**: the dashboard as a PDF or image, the SQL queries as a PDF, the insights as a PDF, then the Power BI package, SQL file, data and settings.

**Your data never leaves your browser.** Loupe is a static web app with no backend, no database and no accounts. Parsing and analysis run in a Web Worker in your tab, and the Content-Security-Policy blocks network access except for two opt-in features: SQL verification (downloads DuckDB-WASM from jsDelivr) and the AI layer (sends a previewed, anonymised summary to Anthropic using your own key).

- Live demo data: six synthetic datasets, including a 49k-row Indian D2C e-commerce file.
- What changed and when: the in-app **Version log** at `/changelog`, also in [CHANGELOG.md](CHANGELOG.md).

## Quick start

Requirements: **Node.js 20.9 or newer** (tested on Node 24) and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3000. Click **Explore the live demo**, or go to **Open the workspace** and drop a file.

| Command             | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `npm run dev`       | Development server with hot reload (Turbopack)                     |
| `npm run build`     | Production build; every route is prerendered as static HTML        |
| `npm start`         | Serve the production build locally                                 |
| `npm test`          | Full test suite (Vitest), including engine-vs-SQL proofs in DuckDB |
| `npm run typecheck` | TypeScript strict check                                            |
| `npm run lint`      | ESLint (Next.js + React Compiler rules)                            |
| `npm run bench`     | Performance test (`LOUPE_BENCH=1 npm run bench` adds a 1M-row run) |
| `npm run changelog` | Regenerate CHANGELOG.md from `src/content/changelog.ts`            |

## Deploy to Vercel (free tier)

The app is fully static plus client-side workers, so the free Hobby plan is enough. No environment variables are needed.

1. Push the repository to GitHub, GitLab or Bitbucket.
2. In Vercel: **Add New → Project →** import the repo. The framework preset is detected as **Next.js**; keep the defaults (build `next build`, output `.next`).
3. Click **Deploy**.

From the command line instead: `npm i -g vercel`, then run `vercel` and later `vercel --prod`.

Security headers, including the Content-Security-Policy, are set in `next.config.ts` and applied by Vercel automatically. If you add any external service, you must allow it in `connect-src` there. The CSP is part of the privacy promise.

## How it works

```
file ─▶ parse ─▶ profile ─▶ detect industry ─▶ map fields ─▶ KPIs ─▶ charts ─▶ insights ─▶ exports
        (worker)                               (editable)   (same expression → TS evaluator, SQL, DAX)
```

1. **Import** (`src/engine/parse`): streaming CSV with encoding, delimiter and header detection; Excel with a sheet picker; JSON and NDJSON. Numbers understand ₹1,23,456.50, (1,234), 12.5% and 1.234,56. Day/month order is decided from the whole column; when the column is ambiguous, you're told which order was used and can switch it.
2. **Profile** (`src/engine/profile`): types, semantic roles, statistics, patterns, keys and grain, hierarchies, time gaps, additivity, wide-format detection, and a 0–100 data-health score.
3. **Detect** (`src/engine/detect`): scores 16 industry knowledge files (`src/registry/domains/*.json`) and shows the top three with confidence and evidence. It asks you to confirm when the top score is below 70% or the top two are within 10 points.
4. **KPIs** (`src/engine/kpi`, `src/engine/query`, `src/engine/compile`): one expression language compiled three ways (in-browser evaluator, SQL and DAX) with SQL-like semantics: ratios are ratio-of-sums and division by zero gives "no value". A KPI that can't be computed says which column it needs.
5. **Charts and insights** (`src/engine/charts`, `src/engine/insights`): rule-based chart choice with a stated reason and alternatives; e-commerce RFM, cohorts, Pareto and basket analysis; ranked insights that cite their numbers.
6. **Exports** (`src/engine/export`): Power BI package (TMDL semantic model, DAX measures with folders and a Date table, CSV, README), SQL views, data dictionary, CSV with formula-injection protection, a shareable config, a PDF report and PNG.

More detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DESIGN.md](docs/DESIGN.md). Contributor conventions are in [CLAUDE.md](CLAUDE.md).

## Trust and testing

- `tests/registry.test.ts` runs **every KPI formula in all 16 industries**, 700 formulas including fallbacks. Each one goes through Loupe's engine and through the generated SQL in DuckDB, and the two must agree exactly (a blank only equals a blank) overall and for every month: over 14,000 comparisons. The same SQL was also verified once on PostgreSQL 18 during development.
- `tests/equivalence.test.ts` covers the edge cases where screen, SQL and DAX could disagree: blank flags, empty months, day differences across midnight and very large groups.
- Known-answer tests (`tests/kpi.test.ts`) check KPIs against values worked out by hand. Import tests cover encodings, number styles, date-order decisions, Excel and JSON. Further suites cover chart rules (no pie over six slices, one axis, a reason for every chart), insights, exports, security (no HTML injection through column names) and AI-payload anonymisation.
- In a real browser (Chrome, production build): all six demo datasets go through every step without errors, every export downloads, and "Verify in browser" matches 33 of 33 KPI queries on the e-commerce demo.
- Accessibility: axe-core reports zero WCAG 2.1 AA violations on the home page, the version log and every workspace step, in both themes.
- Performance (Node, build machine): 100,000 rows parse in about 0.8 s and profile in about 0.15 s (budget: 3 s). 1,000,000 rows (91 MB) parse in about 7.4 s and profile in about 1 s.

## Known limitations

- **No .pbix file.** A .pbix is a proprietary binary that only Power BI Desktop writes. Loupe exports a Power BI _package_ instead; its README walks through two paths (about five minutes in any Power BI Desktop). The PBIP/TMDL path follows Microsoft's published format but has not been opened in every Power BI Desktop release. If Desktop reports a schema error, the manual path always works.
- **The dashboard PDF is made of images.** Its pages are rendered to high-resolution images, so its text isn't selectable or searchable. The SQL and insights PDFs are real text, with the Geist typeface embedded (SIL Open Font Licence, `public/fonts/OFL.txt`).
- **SQL verification needs the internet once.** "Verify in browser" downloads DuckDB-WASM (a 34–39 MB WebAssembly file, compressed in transit) from jsDelivr the first time. On networks that block it, the SQL can still be downloaded and run elsewhere.
- **Size limits depend on the device's memory.** CSV is comfortable to about 2.1 million rows or 700 MB, beyond which Loupe offers sampling. Excel is limited to 150 MB and JSON to 250 MB.
- **Dates are wall-clock.** Times are read exactly as written and never shifted between time zones.
- **Detection is heuristic.** Ambiguous files ask you to confirm, and you can always pick the industry and remap any column yourself.
- **Clean data only.** Loupe flags problems (health score) and can unpivot wide tables, but it is not a data-cleaning tool and doesn't join multiple files.
- **The AI layer** is optional and off by default. It runs in the browser with your Anthropic API key, which is kept in memory for the tab only.
- `npm audit` reports advisories in development-only tooling (via `eslint-config-next`); none ship to the browser.

## Next steps

- Open the PBIP/TMDL output in current Power BI Desktop releases and keep a reference project in the repo.
- Selectable text in the dashboard PDF report as well.
- Optional local persistence of workspaces (IndexedDB), still without any server.
- Multi-file models (fact plus dimension tables) and more industry packs and locales.

## Project layout

```
src/app          routes: / (landing), /app (workspace), /changelog
src/engine       pure TypeScript analysis engine (parse, profile, detect, kpi, query, compile, charts, insights, export, session)
src/registry     industry knowledge files (JSON) and their Zod schema
src/workers      the Web Worker that hosts the engine
src/ui           design-system primitives, charts, workspace, landing and site components
src/content      the version log
tests            Vitest suites (DuckDB-backed SQL proofs, known answers, rules, performance)
```
