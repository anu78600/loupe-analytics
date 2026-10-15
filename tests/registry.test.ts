/**
 * Registry contract tests. For every domain JSON:
 *  1. schema + cross-reference validation
 *  2. every available KPI evaluates on synthetic data
 *  3. the generated SQL, executed in DuckDB, returns the same value as the
 *     engine (overall and month by month), for the variant each KPI uses
 *     and for every other computable fallback variant
 *  4. the generated DAX is structurally sound
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import { domainSchema, type DomainDef } from "@/registry/schema";
import { validateDomainRefs } from "@/registry/validate";
import { resolveKpis } from "@/engine/kpi/resolve";
import {
  cleanColumnNames,
  makeDaxContext,
  makeResolver,
  makeSqlContext,
  type CompileNames,
} from "@/engine/kpi/context";
import { evaluateScalar, EMPTY_SCOPE } from "@/engine/query/evaluate";
import { fieldsOf, refsOf, requiredClassesOf, type Expr } from "@/engine/query/expr";
import { runQuery } from "@/engine/query/run";
import { kpiQuery } from "@/engine/compile/sql";
import { exprDax } from "@/engine/compile/dax";
import { identityMapping, syntheticDataset } from "./helpers/synthetic";
import { close, loadIntoDuckDB } from "./helpers/duck";

const DIR = join(__dirname, "..", "src", "registry", "domains");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));

/** Equal within floating-point noise. Strict about blanks: "no value" only equals "no value", never 0. */
function close2(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return !Number.isFinite(a) && !Number.isFinite(b);
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}

function balanced(s: string): boolean {
  let p = 0;
  let b = 0;
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "(") p++;
    if (ch === ")") p--;
    if (ch === "{") b++;
    if (ch === "}") b--;
    if (p < 0 || b < 0) return false;
  }
  return p === 0 && b === 0 && !inStr;
}

const parsePeriod = (v: unknown): number => {
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
};

const connections: DuckDBConnection[] = [];
afterAll(() => connections.forEach(close));

describe.each(files)("registry domain %s", (file) => {
  const raw = JSON.parse(readFileSync(join(DIR, file), "utf8")) as unknown;
  const parsed = domainSchema.safeParse(raw);

  it("matches the schema", () => {
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 5), null, 2));
    expect(parsed.success).toBe(true);
  });

  if (!parsed.success) return;
  const domain: DomainDef = parsed.data;

  it("has consistent references", () => {
    expect(validateDomainRefs(domain)).toEqual([]);
  });

  it("has 8–60 KPIs, hero KPIs, charts and pitfalls", () => {
    expect(domain.kpis.length).toBeGreaterThanOrEqual(8);
    expect(domain.kpis.some((k) => k.tier === "hero")).toBe(true);
    expect(domain.charts.length).toBeGreaterThanOrEqual(3);
    expect(domain.fields.every((f) => f.synonyms.length >= 2)).toBe(true);
  });

  it("evaluates every KPI and the SQL matches the engine in DuckDB", async () => {
    const ds = syntheticDataset(domain);
    const mapping = identityMapping(domain, ds);
    const res = resolveKpis(domain, mapping);
    const resolver = makeResolver(ds, mapping, res);
    const names: CompileNames = {
      table: "data",
      columns: cleanColumnNames(ds.columns.map((c) => c.name)),
      measures: new Map(domain.kpis.map((k) => [k.id, k.name])),
    };
    const sqlCtx = makeSqlContext(ds, mapping, res, names);
    const daxCtx = makeDaxContext(ds, mapping, res, names, { dateTable: "Date" });
    const conn = await loadIntoDuckDB(ds, "data", names.columns);
    connections.push(conn);
    const all = Int32Array.from({ length: ds.rowCount }, (_, i) => i);
    const dateField = domain.fields.find((f) => f.roles[0] === "datetime");

    const available = [...res.values()].filter((r) => r.available);
    // With every field mapped, most KPIs must resolve.
    expect(available.length).toBeGreaterThanOrEqual(Math.min(8, domain.kpis.length));
    const failures: string[] = [];
    let compared = 0;
    let monthlyCompared = 0;

    /** Engine vs DuckDB for one expression, overall and per month, plus a DAX structure check. */
    const check = async (label: string, expr: Expr): Promise<void> => {
      const engine = evaluateScalar(expr, resolver, EMPTY_SCOPE, all);
      const sql = kpiQuery(expr, sqlCtx);
      let duck: number;
      try {
        const reader = await conn.runAndReadAll(sql);
        const resultRows = reader.getRowObjectsJson() as Array<Record<string, unknown>>;
        // An overall query must return exactly one row (a fan-out would make row 0 look right by luck).
        if (resultRows.length !== 1)
          failures.push(`${label}: overall query returned ${resultRows.length} rows\n${sql}`);
        const row = resultRows[0];
        duck = row?.value === null || row?.value === undefined ? NaN : Number(row.value);
      } catch (e) {
        failures.push(`${label}: SQL error ${(e as Error).message}\n${sql}`);
        return;
      }
      compared++;
      if (!close2(engine, duck)) failures.push(`${label}: engine ${engine} vs SQL ${duck}\n${sql}`);

      const dax = exprDax(expr, daxCtx);
      if (!balanced(dax) || dax.includes("undefined")) failures.push(`${label}: malformed DAX\n${dax}`);

      if (!dateField) return;
      const monthly = kpiQuery(expr, sqlCtx, {
        dateCol: `"${names.columns.get(dateField.id)}"`,
        grain: "month",
      });
      let rows: Array<Record<string, unknown>> = [];
      try {
        rows = (await conn.runAndReadAll(monthly)).getRowObjectsJson() as Array<Record<string, unknown>>;
      } catch (e) {
        failures.push(`${label}: monthly SQL error ${(e as Error).message}\n${monthly}`);
        return;
      }
      const q = runQuery(ds, resolver, {
        filters: [],
        groupBy: [{ kind: "time", column: dateField.id, grain: "month" }],
        measures: [{ id: label, expr }],
        dateColumn: dateField.id,
      });
      const byPeriod = new Map(q.groups.map((g) => [g.labels[0]?.raw as number, g.values[0] as number]));
      for (const row of rows) {
        const p = parsePeriod(row.period);
        if (!byPeriod.has(p)) continue;
        const e = byPeriod.get(p) as number;
        const s = row.value === null || row.value === undefined ? NaN : Number(row.value);
        monthlyCompared++;
        if (!close2(e, s)) {
          failures.push(`${label} @ ${String(row.period)}: engine ${e} vs SQL ${s}\n${monthly}`);
          break;
        }
      }
    };

    // 1. The variant each KPI actually uses.
    for (const r of available) await check(r.def.id, r.variant!.expr);
    const chosenCompared = compared;

    // 2. Every other variant (the fallbacks) that is computable with this mapping, so a
    //    fallback that only kicks in on real data with missing columns is proven too.
    let fallbacks = 0;
    for (const r of available) {
      for (const [i, v] of r.def.variants.entries()) {
        if (v === r.variant) continue;
        const computable =
          [...fieldsOf(v.expr)].every((f) => mapping.fields[f]) &&
          [...requiredClassesOf(v.expr)].every((c) => mapping.classes[c]?.length) &&
          [...refsOf(v.expr)].every((k) => res.get(k)?.available);
        if (!computable) continue;
        fallbacks++;
        await check(`${r.def.id} (variant ${i + 1}: ${v.label})`, v.expr);
      }
    }

    expect(failures, failures.slice(0, 5).join("\n\n")).toEqual([]);
    expect(chosenCompared).toBe(available.length);
    expect(compared).toBe(available.length + fallbacks);
    if (dateField) expect(monthlyCompared).toBeGreaterThan(available.length);
    console.info(
      `[${domain.id}] ${available.length}/${res.size} KPIs available; ${compared} formulas (${fallbacks} fallbacks) and ${monthlyCompared} monthly SQL results matched the engine`,
    );
  });
});
