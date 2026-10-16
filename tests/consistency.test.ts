/**
 * Cross-checks that every number the dashboard shows agrees with every other
 * place the same quantity appears, on all six demos, for "all time" and
 * "last 12 months":
 *  - additive KPIs (sums and counts, following refs) equal the total of every
 *    chart that breaks them down (all segments, treemap branches, "Others");
 *  - a distinct count whose groups overlap carries a note with both numbers;
 *  - the KPI drawer's YTD and rolling-30-day values equal the KPI under the
 *    matching date filter;
 *  - every trend insight reports exactly its KPI card's change;
 *  - a card whose change covers a narrower window than its value names that
 *    window (currentLabel), so no change sits under a number it doesn't describe.
 */
import { describe, expect, it } from "vitest";
import { Session } from "@/engine/session";
import { SAMPLES } from "@/engine/samples/catalog";
import { presetRange, type DatePreset } from "@/engine/core/periods";
import type { Filter } from "@/engine/query/filter";
import { isAdditiveExpr, type Expr } from "@/engine/query/expr";
import type { ChartData } from "@/engine/charts/types";

const near = (a: number, b: number, tol = 1e-6) =>
  Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

function chartTotal(d: ChartData): number {
  if (d.tree?.length) return d.tree.reduce((a, t) => a + (t.value ?? 0), 0);
  if (d.matrix?.length) return d.matrix.flat().reduce<number>((a, b) => a + (b ?? 0), 0);
  return d.series.reduce((a, s) => a + s.values.reduce<number>((x, y) => x + (y ?? 0), 0), 0);
}

type ResMap = Map<string, { variant?: { expr: Expr } }>;

describe.each(SAMPLES.map((s) => s.id))("the %s demo reconciles everywhere", (sampleId) => {
  const s = new Session();
  const load = s.ingestSample(sampleId);
  if (load.status !== "ok") throw new Error(load.status);
  const top = load.detection.candidates[0];
  if (!top) throw new Error("not detected");
  const ctx = s.configure({ domainId: top.domainId, numberLocale: "INTL", currency: null });
  // The resolution map is internal to the session; read it for additivity checks only.
  const res = (s as unknown as { ctx: { res: ResMap } }).ctx.res;
  const lookup = (id: string) => res.get(id)?.variant?.expr;
  const ids = ctx.kpis.filter((k) => k.available).map((k) => k.id);
  const filterFor = (p: DatePreset): Filter[] => {
    if (!ctx.dateColumn || !ctx.dateBounds) return [];
    const r = presetRange(p, ctx.dateBounds);
    return r ? [{ kind: "dateRange", column: ctx.dateColumn, from: r.from, to: r.to }] : [];
  };

  it.each(["all", "last12m"] as DatePreset[])("charts total to their KPI cards (%s)", (preset) => {
    const filters = filterFor(preset);
    const val = new Map(s.kpiBatch(filters, ids, "INTL").values.map((v) => [v.id, v.value]));
    for (const spec of ctx.charts) {
      if (spec.analysis || spec.measures.length !== 1) continue;
      const id = spec.measures[0]?.id as string;
      const card = val.get(id);
      const e = lookup(id);
      if (card === undefined || card === null || !e) continue;
      const data = s.chart(filters, { specId: spec.id, topN: 500 }, "INTL");
      if (!data || data.empty) continue;
      const total = chartTotal(data);
      if (isAdditiveExpr(e, lookup)) {
        expect(near(total, card), `${spec.id} totals ${total} but the ${id} card is ${card}`).toBe(true);
      } else if (
        spec.x.kind === "column" &&
        JSON.stringify(e).startsWith('{"agg":"countDistinct"') &&
        total > card + 0.5
      ) {
        expect(
          data.notes.some((n) => /more than one/.test(n)),
          `${spec.id} adds up to ${total} vs ${card} distinct without saying why`,
        ).toBe(true);
      }
    }
  });

  it.each(["all", "last12m"] as DatePreset[])("insights report the cards' changes (%s)", (preset) => {
    const filters = filterFor(preset);
    const batch = s.kpiBatch(filters, ids, "INTL");
    const insights = s.insights("INTL");
    for (const ins of insights.filter((i) => i.kind === "trend" && i.metricId)) {
      const v = batch.values.find((x) => x.id === ins.metricId);
      if (!v) continue;
      const m = /(up|down) ([\d.,]+)( pp|%)/.exec(ins.title);
      if (!m) continue;
      const shown = Number((m[2] as string).replace(/,/g, "")) * (m[1] === "down" ? -1 : 1);
      const card = (m[3] === " pp" ? (v.deltaAbs ?? NaN) : (v.delta ?? NaN)) * 100;
      expect(Number.isFinite(card), `"${ins.title}" has no matching card change`).toBe(true);
      expect(
        Math.abs(card - shown) <= Math.max(0.051, Math.abs(card) * 0.006),
        `"${ins.title}" vs card ${card.toFixed(2)}`,
      ).toBe(true);
    }
    for (const v of batch.values) {
      if (v.value === null || v.delta === null) continue;
      // The change either describes the card's own value or names the window it does describe.
      if (v.current !== v.value) expect(v.currentLabel, `${v.id} change has no window label`).toBeTruthy();
    }
  });

  it("time intelligence equals the matching date filters", () => {
    if (!ctx.dateColumn) return;
    for (const id of ctx.selection.hero) {
      const ti = s.timeIntel(id, []);
      for (const [key, preset] of [
        ["ytd", "ytd"],
        ["r30", "last30d"],
      ] as const) {
        const t = ti.find((x) => x.key === key);
        const kpi = s.kpiBatch(filterFor(preset), [id], "INTL").values[0]?.value ?? null;
        if (t?.value == null || kpi === null) continue;
        expect(near(t.value, kpi), `${id} ${key} ${t.value} vs filter ${kpi}`).toBe(true);
      }
    }
  });

  it("gives a rate's YoY change in percentage points, as its card does", () => {
    if (!ctx.dateColumn) return;
    for (const k of ctx.kpis.filter((x) => x.available && x.format === "percent")) {
      const ti = s.timeIntel(k.id, []);
      const yoy = ti.find((x) => x.key === "yoy");
      expect(yoy, k.id).toMatchObject({ points: true });
      expect(yoy?.percent, k.id).toBeUndefined();
      const ytd = ti.find((x) => x.key === "ytd")?.value ?? null;
      const py = ti.find((x) => x.key === "ytd_py")?.value ?? null;
      if (ytd !== null && py !== null) expect(near(yoy?.value as number, ytd - py), k.id).toBe(true);
    }
  });
});

describe("monthly snapshots dated on the 1st", () => {
  it("count the latest month as complete", () => {
    const s = new Session();
    const load = s.ingestSample("saas");
    if (load.status !== "ok") throw new Error(load.status);
    const ctx = s.configure({ domainId: "saas", numberLocale: "INTL", currency: null });
    const b = ctx.dateBounds as { max: number };
    // Data's last row is dated 1 Sep 2026; it stands for all of September.
    expect(new Date(b.max).toISOString().slice(0, 10)).toBe("2026-09-30");
    const batch = s.kpiBatch([], ["mrr_total"], "INTL");
    expect(batch.current?.label).toBe("September 2026");
  });
});
