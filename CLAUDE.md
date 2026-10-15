# Loupe: guide for working in this repo

Loupe turns a clean table (CSV/TSV/XLSX/JSON) into an analyst-grade dashboard. It profiles every column, detects the industry, computes KPIs (each also compiled to SQL and DAX), recommends charts, writes insights and exports a Power BI package, SQL, PDF and PNG. **Everything runs in the browser**: no backend, no database, no accounts.

Next.js-version notes live in @AGENTS.md (written by `next dev`; keep it).

## Commands

```bash
npm run dev          # http://localhost:3000 (Turbopack)
npm run build        # production build; must pass before a step is called done
npm run typecheck    # tsc --noEmit (strict)
npm run lint         # eslint . (React Compiler rules are on, see Gotchas)
npm test             # vitest; tests/registry.test.ts runs every KPI against DuckDB
npm run changelog    # regenerate CHANGELOG.md from src/content/changelog.ts
```

## Version log: every step gets a version (owner's standing rule)

- Each step of work adds an entry at the top of `src/content/changelog.ts` (shown at `/changelog`).
- **MAJOR `x.0`**: a new capability, subsystem or page. **MINOR `x.y`**: a refinement, fix or follow-up to the current major, counting from 1.
- `date` is the UTC completion time (`date -u +%Y-%m-%dT%H:%M:%SZ`). Write `summary` and `changes` for a non-developer; put paths in `files`.
- Remove the matching item from `PLANNED` when it ships, then run `npm run changelog`. `tests/changelog.test.ts` enforces ordering, numbering and dates.

## Architecture (pipeline order)

| Stage    | Where                                                      | Notes                                                                                                                                                                                     |
| -------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parse    | `src/engine/parse`                                         | Streaming CSV (encoding, delimiter, header sniffing), Excel, JSON. Columnar typed storage. Whole-column DD/MM vs MM/DD decision.                                                          |
| Profile  | `src/engine/profile`                                       | Types, semantic roles, stats, patterns, keys/grain, hierarchies, gaps, additivity, wide format; `quality.ts` = health score.                                                              |
| Detect   | `src/engine/detect`                                        | Field matching (synonyms, abbreviations, Jaro-Winkler, value hints), domain confidence, generic fallback.                                                                                 |
| KPIs     | `src/engine/kpi`, `src/engine/query`, `src/engine/compile` | One expression AST (`query/expr.ts`) → TS evaluator, SQL, DAX. `kpi/columnKpis.ts` covers columns the template doesn't read.                                                              |
| Charts   | `src/engine/charts`                                        | Template adaptation with reasons/alternatives; RFM, cohorts, basket, Pareto; `ask.ts` reads requests in words into charts.                                                                |
| Insights | `src/engine/insights`                                      | Ranked, quantified, chart-linked; never invents numbers.                                                                                                                                  |
| Export   | `src/engine/export`, `src/ui/workspace/export`             | Power BI package (TMDL + DAX + CSV + README), SQL, dictionary, CSV, config; PDFs: dashboard as images (`report.tsx`), SQL and insights as text (`textPdf.ts`, Geist from `public/fonts`). |
| Session  | `src/engine/session.ts` + `src/workers/engine.worker.ts`   | Stateful session inside a Web Worker (Comlink); UI gets small results only.                                                                                                               |
| Registry | `src/registry`                                             | One JSON per industry, validated by Zod (`schema.ts`) and `validate.ts`.                                                                                                                  |
| UI       | `src/app`, `src/ui`                                        | `/` landing (prerendered from real engine output), `/app` workspace, `/changelog`. State: `src/store`.                                                                                    |

## Invariants: do not break these

- **Never fabricate a number.** Every figure shown or exported is computed from the data. Unavailable KPIs say what column they need; they are never estimated. The landing page uses build-time engine output (`src/ui/landing/preview-data.ts`), not typed-in figures.
- **Privacy.** No network calls except: DuckDB-WASM from jsDelivr (on demand, SQL verification) and the opt-in AI layer (`src/lib/ai.ts`, user's own key, visible payload, never the raw dataset). The CSP in `next.config.ts` enforces this. Don't add analytics, fonts from CDNs or other hosts.
- **Data model.** Number/date columns are `Float64Array` with `NaN` = null. Dates are wall-clock ms stored as UTC, never shifted between time zones. A separate time column ("20:15", Excel time cells) is a date column with `timeOnly: true` holding ms since midnight (role `time`): never a date axis, filter or period, and never merged with the date column. String columns are `Int32Array` dictionary codes (`-1` = null).
- **Expression semantics mirror SQL** so the evaluator, SQL and DAX agree: SUM over nothing = 0, AVG over nothing = null, x/0 = null, COUNT DISTINCT ignores blanks, ratios are ratio-of-sums. A change to `evaluate.ts`, `sql.ts` or `dax.ts` must keep `tests/registry.test.ts` green, because that test proves equality in DuckDB for every KPI and fallback variant, overall and monthly.
- **No `.pbix` claims.** The Power BI export is a project package and the UI/README say so.

## Adding or changing an industry

Edit or add `src/registry/domains/<id>.json`, import it in `src/registry/index.ts`, then run `npx vitest run tests/registry.test.ts -t "<id>.json"`. Hero KPIs are 4–6 per sub-domain. A KPI that refs another may be scoped to other sub-domains; the referenced KPI is then kept as a hidden helper (`dependencyOnly` in `kpi/resolve.ts`). Mark sub-domains whose rows are standing entities (employees, customers, products) with `"timeModel": "roster"`. Detection changes must keep `tests/detect.test.ts` (75 real-world layouts) green.

## Conventions

- TypeScript strict, no `any`. Every file starts with a `/** … */` header (after `"use client"`), saying what it does and how it fits. Add JSDoc to non-obvious exports. Comments explain _why_ and use British spelling (analyse, colour, behaviour).
- Styling uses semantic tokens only (`bg-surface-1`, `text-fg-muted`, `border-border`, `var(--chart-1)`…), defined in `src/styles/tokens.css`, both themes. No raw colours.
- Charts follow the dataviz rules in `src/ui/charts/options.ts`: no dual axes, bars start at zero, legend only for 2+ series, colour-blind-validated palette, a table view for every chart.
- Accessibility: keyboard reachable, visible focus, `aria-*` on custom widgets, reduced motion respected.

## Gotchas

- Next 16.4 / React 19.3 / Tailwind 4 (CSS-first `@theme` in `globals.css`). TypeScript is pinned to 5.9 and ESLint to 9, because the Next lint config doesn't support TS 7 or ESLint 10.
- React Compiler lint rules are errors: no synchronous `setState` in effects (use a keyed child, `useSyncExternalStore`, or set state in a subscription callback) and no `Date.now()` during render.
- Windows + Git Bash: prefix scripts that pass `/paths` with `MSYS_NO_PATHCONV=1`.
- Demo datasets (`src/engine/samples`) are deterministic. Changing a generator changes the landing page numbers on the next build.
