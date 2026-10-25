/**
 * Insights a reader can follow (version 54.0): every insight carries its
 * finding as 2-5 bullet points and in plain words with its numbers, built
 * from the same figures as its sentence. Checked on four demos, with the
 * dashboard's default period as the app computes it.
 */
import { describe, expect, it } from "vitest";
import { Session } from "@/engine/session";
import { defaultPreset, presetRange } from "@/engine/kpi/compute";
import type { Filter } from "@/engine/query/filter";

function insightsOf(sample: string) {
  const session = new Session();
  const load = session.ingestSample(sample);
  if (load.status !== "ok") throw new Error(load.status);
  const ctx = session.configure({ domainId: sample, numberLocale: "IN", currency: null });
  const range = ctx.dateBounds ? presetRange(defaultPreset(ctx.dateBounds), ctx.dateBounds) : null;
  const filters: Filter[] =
    range && ctx.dateColumn
      ? [{ kind: "dateRange", column: ctx.dateColumn, from: range.from, to: range.to }]
      : [];
  session.kpiBatch(filters, [...ctx.selection.hero, ...ctx.selection.supporting], "IN");
  for (const spec of ctx.charts) session.chart(filters, { specId: spec.id }, "IN");
  return session.insights("IN");
}

describe.each(["ecommerce", "sales", "saas", "hr"])("the %s demo's insights", (sample) => {
  const insights = insightsOf(sample);

  it("each come as 2-5 bullet points and in plain words", () => {
    expect(insights.length).toBeGreaterThan(0);
    for (const i of insights) {
      expect(i.points.length, i.id).toBeGreaterThanOrEqual(2);
      expect(i.points.length, i.id).toBeLessThanOrEqual(5);
      for (const p of i.points) expect(p.trim(), i.id).not.toBe("");
      expect(i.plain.length, i.id).toBeGreaterThan(20);
      for (const text of [...i.points, i.plain])
        expect(text, i.id).not.toMatch(/NaN|undefined|Infinity|\[object/);
    }
  });

  it("keep analyst statistics out of the plain words", () => {
    for (const i of insights) expect(i.plain, i.id).not.toMatch(/\(r = |\bR²|median and MAD|p = /);
  });
});

describe("a trend in plain words", () => {
  it("says the change, both figures, and whether it is good news", () => {
    const trend = insightsOf("ecommerce").find((i) => i.kind === "trend");
    expect(trend?.plain).toMatch(
      /went (up|down) by .+: from .+ to .+\.( That is (good news|worth a look)\.)?$/,
    );
    expect(trend?.points.some((p) => /^Change: /.test(p))).toBe(true);
  });
});
