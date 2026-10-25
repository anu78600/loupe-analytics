/**
 * The computation audit (version 52.2): every public test file in .corpus/
 * (or the folders in LOUPE_CORPUS, separated by ";") goes through the engine
 * as the app would: detect, configure with the detected industry (or the
 * data-led dashboard below 35%), every KPI and chart over all rows. Results
 * that can't be right are flagged:
 * - a percentage outside ±100% that isn't a growth or a return, a negative
 *   share, a count that is negative or fractional, a negative revenue or cost;
 * - an average outside its column's range, a total of a column that is never
 *   summed (a rate, a percentage, a reading);
 * - a field filled by a column of another kind;
 * - a chart whose additive bars add to more than its total, whose total
 *   differs from the KPI without a note saying why, or a donut with a negative
 *   slice.
 * Each flag is a stable key (no figures), compared with
 * tests/fixtures/audit-baseline.json: a new flag fails the run, a flag no
 * longer raised is reported so the baseline can be tightened (npm run
 * audit:update). Files missing from the corpus are skipped.
 *
 * Run with npm run audit (scripts/audit.mjs); npm test skips it.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { Session } from "@/engine/session";
import { isAdditiveExpr, type Expr } from "@/engine/query/expr";

const ROOTS = (process.env.LOUPE_CORPUS ?? ".corpus").split(";").filter(Boolean);
const BASELINE = "tests/fixtures/audit-baseline.json";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (
      /\.(csv|xlsx|xls|json|tsv|txt)$/i.test(n) &&
      !/manifest\.json$/i.test(n) &&
      statSync(p).size < 30_000_000
    )
      out.push(p);
  }
  return out;
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/** The stable flags of one file: what is wrong and where, never the figures. */
async function flagsOf(path: string): Promise<string[]> {
  const f = path.replace(/^.*[\\/]/, "");
  const s = new Session();
  const blob = new Blob([readFileSync(path)]);
  let load = await s.ingest(blob, f, {});
  if (load.status === "needs-sheet") load = await s.ingest(blob, f, { sheet: load.sheets[0] });
  if (load.status === "needs-decision") load = await s.ingest(blob, f, { maxRows: 300000 });
  if (load.status !== "ok") return [`LOAD ${load.status}`];
  const top = load.detection.candidates[0];
  const domainId = top && top.confidence >= 35 ? top.domainId : "generic";
  const ctx = s.configure({ domainId, numberLocale: "INTL", currency: null });
  const avail = ctx.kpis.filter((k) => k.available);
  const batch = s.kpiBatch(
    [],
    avail.map((k) => k.id),
    "INTL",
  );
  const col = (n: string) => ctx.profile.columns.find((c) => c.name === n);
  const flags: string[] = [];
  for (const [field, column] of Object.entries(ctx.mapping.fields)) {
    const def = ctx.domain.fields.find((x) => x.id === field);
    const c = col(column);
    if (c && def && !def.roles.includes(c.role)) flags.push(`MAP ${field} → ${column}: ${c.role}`);
  }
  const valueOf = new Map<string, number>();
  for (const v of batch.values) {
    const meta = ctx.kpis.find((k) => k.id === v.id);
    if (!meta || v.value === null) continue;
    valueOf.set(v.id, v.value);
    const x = v.value;
    const name = meta.name.toLowerCase();
    const kpi = (what: string) => flags.push(`KPI ${meta.name}: ${what}`);
    if (
      meta.format === "percent" &&
      Math.abs(x) > 1.0001 &&
      !/growth|change|vs |yoy|mom|retention|attainment|roas|roi|uplift/.test(name)
    )
      kpi("percent out of range");
    if (
      meta.format === "percent" &&
      x < 0 &&
      /rate|share|%|ratio/.test(name) &&
      !/margin|growth|change|variance/.test(name)
    )
      kpi("negative share");
    if (meta.format === "integer" && (x < 0 || Math.abs(x - Math.round(x)) > 1e-6)) kpi("bad count");
    if (
      meta.format === "currency" &&
      x < 0 &&
      /revenue|sales|gmv|income|turnover|billing|spend|cost/.test(name) &&
      !/net income|profit|change/.test(name)
    )
      kpi("negative amount");
    const only = meta.fieldsUsed.length === 1 ? col(meta.fieldsUsed[0]?.column ?? "") : undefined;
    if (
      /^average |^avg /.test(name) &&
      only?.numeric &&
      (x < only.numeric.min - 1e-9 || x > only.numeric.max + 1e-9)
    )
      kpi("average outside its column");
    if (
      /^total /.test(name) &&
      (only?.additivity === "non-additive" || only?.role === "percentage" || only?.role === "rate")
    )
      kpi(`sums a ${only.role} column`);
  }
  const res = (s as unknown as { ctx: { res: Map<string, { variant?: { expr: Expr } }> } }).ctx.res;
  for (const spec of ctx.charts) {
    if (spec.analysis || spec.series) continue;
    let data;
    try {
      data = s.chart([], { specId: spec.id }, "INTL");
    } catch {
      flags.push(`CHART ${spec.title}: threw`);
      continue;
    }
    if (!data || data.empty || data.matrix || data.points || data.tree) continue;
    const notes = data.notes;
    spec.measures.forEach((m, i) => {
      const series = data.series[i];
      const total = data.totals[i];
      if (!series || total === null || total === undefined) return;
      const expr = res.get(m.id)?.variant?.expr;
      const additive = expr ? isAdditiveExpr(expr, (id) => res.get(id)?.variant?.expr) : false;
      const sum = series.values.reduce<number>((a, v) => a + (v ?? 0), 0);
      const kpi = valueOf.get(m.id);
      if (
        additive &&
        spec.x.kind !== "time" &&
        !close(sum, total) &&
        Math.abs(sum) > Math.abs(total) * 1.0001
      )
        flags.push(`CHART ${spec.title}: bars exceed the total`);
      if (kpi !== undefined && !close(total, kpi) && !notes.some((n) => /left out/.test(n)))
        flags.push(`CHART ${spec.title}: total differs from the KPI`);
      if ((spec.kind === "donut" || spec.kind === "pie") && series.values.some((v) => (v ?? 0) < 0))
        flags.push(`CHART ${spec.title}: negative slice`);
    });
  }
  return [...new Set(flags)].sort();
}

describe.skipIf(!process.env.LOUPE_AUDIT)("computation audit", () => {
  it("raises no flag that the baseline doesn't list", { timeout: 14_400_000 }, async () => {
    const roots = ROOTS.filter((r) => existsSync(r));
    expect(roots.length, "No corpus: run npm run corpus first, or set LOUPE_CORPUS").toBeGreaterThan(0);
    const found: Record<string, string[]> = {};
    for (const root of roots)
      for (const path of walk(root)) {
        const key = relative(root, path).replace(/\\/g, "/");
        try {
          found[key] = await flagsOf(path);
        } catch (e) {
          found[key] = [`ERROR ${(e as Error).message.slice(0, 80)}`];
        }
      }
    const baseline: Record<string, string[]> = existsSync(BASELINE)
      ? JSON.parse(readFileSync(BASELINE, "utf8"))
      : {};
    if (process.env.LOUPE_AUDIT_UPDATE) {
      const next = { ...baseline };
      for (const [k, v] of Object.entries(found))
        if (v.length) next[k] = v;
        else delete next[k];
      writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    }
    const added: string[] = [];
    const cleared: string[] = [];
    for (const [file, flags] of Object.entries(found)) {
      const known = new Set(baseline[file] ?? []);
      for (const f of flags) if (!known.has(f)) added.push(`${file}: ${f}`);
      for (const f of known) if (!flags.includes(f)) cleared.push(`${file}: ${f}`);
    }
    const total = Object.values(found).reduce((a, f) => a + f.length, 0);
    console.log(
      `Audit: ${Object.keys(found).length} files, ${total} flags, ${added.length} new, ${cleared.length} no longer raised.`,
    );
    if (cleared.length)
      console.log(`No longer raised (tighten with npm run audit:update):\n  ${cleared.join("\n  ")}`);
    if (!process.env.LOUPE_AUDIT_UPDATE) expect(added).toEqual([]);
  });
});
