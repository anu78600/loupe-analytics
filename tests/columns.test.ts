/**
 * "Your columns only": on every demo, the dashboard is built from the file's
 * own columns. Every column a KPI, chart, drill path, analysis or filter
 * reads exists in the file; computing the dashboard adds no column to the
 * dataset; and columnUsage accounts for every column of the file, once.
 */
import { describe, expect, it } from "vitest";
import { Session } from "@/engine/session";
import { SAMPLES } from "@/engine/samples/catalog";
import { columnUsage, isUsed } from "@/engine/charts/columnUsage";
import type { ResolvedAxis } from "@/engine/charts/types";

const axisColumn = (a: ResolvedAxis | undefined) =>
  a && a.kind !== "none" && a.kind !== "bins" ? a.column : undefined;

describe.each(SAMPLES.map((s) => s.id))("the %s demo uses only its own columns", (sampleId) => {
  const s = new Session();
  const load = s.ingestSample(sampleId);
  if (load.status !== "ok") throw new Error(load.status);
  const top = load.detection.candidates[0];
  if (!top) throw new Error("not detected");
  const ctx = s.configure({ domainId: top.domainId, numberLocale: "INTL", currency: null });
  const names = new Set(ctx.profile.columns.map((c) => c.name));

  it("reads no column that isn't in the file", () => {
    for (const k of ctx.kpis)
      for (const f of k.fieldsUsed) expect(names.has(f.column), `${k.id} reads ${f.column}`).toBe(true);
    for (const spec of ctx.charts) {
      const p = spec.analysisParams ?? {};
      const cols = [
        axisColumn(spec.x),
        axisColumn(spec.series),
        ...(spec.drill ?? []),
        p.customer,
        p.date,
        p.order,
        p.item,
        ...spec.measures
          .filter((m) => m.id.startsWith("agg:"))
          .map((m) => m.id.split(":").slice(2).join(":")),
      ].filter((c): c is string => Boolean(c));
      for (const c of cols) expect(names.has(c), `${spec.id} reads ${c}`).toBe(true);
    }
    if (ctx.dateColumn) expect(names.has(ctx.dateColumn)).toBe(true);
    for (const d of ctx.dimensions) expect(names.has(d.column)).toBe(true);
  });

  it("adds no column when the dashboard is computed", () => {
    const before = ctx.profile.columns.length;
    s.computeDashboard({
      filters: [],
      kpiIds: ctx.kpis.filter((k) => k.available).map((k) => k.id),
      charts: ctx.charts.map((c) => ({ specId: c.id })),
      numberLocale: "INTL",
    });
    // The dataset after computing has exactly the file's columns, in the cleaned CSV too.
    const csv = new TextDecoder().decode(s.exportCsv(false));
    const header = csv.split(/\r?\n/)[0] ?? "";
    expect(header.split(",").length).toBe(before);
  });

  it("accounts for every column once, and the dashboard uses some", () => {
    const usage = columnUsage(ctx, ctx.charts);
    expect([...usage.keys()].sort()).toEqual([...names].sort());
    expect([...usage.values()].filter(isUsed).length).toBeGreaterThan(0);
    // Every available, visible KPI shows up under each column it reads.
    for (const k of ctx.kpis.filter((x) => x.available && !x.hidden))
      for (const f of k.fieldsUsed) expect(usage.get(f.column)?.kpis).toContain(k.name);
  });
});
