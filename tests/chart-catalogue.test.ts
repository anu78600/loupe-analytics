/**
 * The chart catalogue (engine/charts/catalogue.ts) and the chart builder's
 * logic (ui/workspace/customise/chartDraft.ts), on a real dataset.
 *
 * - Every chart kind has one catalogue entry, in a known group, with its two
 *   short lines.
 * - Every type the builder offers drafts, builds, computes and draws from the
 *   e-commerce demo file, and an existing chart reopens as the same draft.
 * - The builder says what a type needs when a combination can't be drawn
 *   (a missing second category, too few measures, measures in two units),
 *   and switching type keeps what still fits.
 * - The new kinds compute what they promise: shares that fill a 100%
 *   column, the two largest values for a dumbbell, days for a calendar, one
 *   figure for a big number, sizes for bubbles, rings for a sunburst.
 */
import { describe, expect, it } from "vitest";
import { CHART_KINDS } from "@/registry/schema";
import { CHART_GROUPS, CHART_TYPES, chartType } from "@/engine/charts/catalogue";
import { isKindCompatible } from "@/engine/charts/recommend";
import type { ChartData } from "@/engine/charts/types";
import { Session } from "@/engine/session";
import { buildOption, rendersWithECharts } from "@/ui/charts/options";
import { readChartTokens } from "@/ui/charts/tokens";
import {
  adapt,
  buildSpec,
  columnsOf,
  draftFromSpec,
  missing,
  newDraft,
  type Draft,
} from "@/ui/workspace/customise/chartDraft";

const TOKENS = readChartTokens();
const FMT = { locale: "IN" as const, currency: "INR" };

describe("the catalogue", () => {
  it("describes every chart kind once, in a known group, in two short lines", () => {
    expect(CHART_TYPES.map((t) => t.kind).sort()).toEqual([...CHART_KINDS].sort());
    for (const t of CHART_TYPES) {
      expect(
        CHART_GROUPS.some((g) => g.id === t.group),
        t.kind,
      ).toBe(true);
      for (const line of [t.shows, t.bestFor]) {
        expect(line, t.kind).toMatch(/^[A-Z0-9].*\.$/);
        expect(line.length, `${t.kind}: ${line}`).toBeLessThanOrEqual(90);
      }
      expect(t.measures.min).toBeLessThanOrEqual(t.measures.max);
      expect(chartType(t.kind)).toBe(t);
    }
    // Every gallery section has something to build.
    for (const g of CHART_GROUPS)
      expect(
        CHART_TYPES.some((t) => t.group === g.id && t.buildable),
        g.id,
      ).toBe(true);
  });
});

describe("every buildable type, from the e-commerce demo", () => {
  const s = new Session();
  s.ingestSample("ecommerce");
  const ctx = s.configure({ domainId: "ecommerce", numberLocale: "IN", currency: null });
  const cols = columnsOf(ctx);
  const draw = (d: Draft, id: string): ChartData => {
    const out = buildSpec(d, ctx, id);
    expect(out.problem, `${d.kind}: ${out.problem}`).toBeNull();
    const spec = out.spec as NonNullable<typeof out.spec>;
    expect(isKindCompatible(d.kind, spec), d.kind).toBe(true);
    const data = s.chart([], { specId: spec.id, spec }, "IN") as ChartData;
    expect(data.empty, `${d.kind}: ${data.notes.join(" ")}`).toBe(false);
    if (rendersWithECharts(d.kind, data))
      expect(
        buildOption({ tokens: TOKENS, fmt: FMT, kind: d.kind, spec, data, animate: false }),
        d.kind,
      ).not.toBeNull();
    return data;
  };

  for (const t of CHART_TYPES.filter((x) => x.buildable)) {
    it(`${t.name}: drafts, builds, computes and draws`, () => {
      expect(missing(t, cols), t.kind).toBeNull();
      const d = newDraft(t.kind, ctx, cols);
      draw(d, `t_${t.kind}`);
      // Reopening a built chart gives back the same chart.
      const spec = buildSpec(d, ctx, `t_${t.kind}`).spec as NonNullable<ReturnType<typeof buildSpec>["spec"]>;
      const again = draftFromSpec(spec, undefined, ctx);
      expect(buildSpec(again, ctx, spec.id).spec).toEqual(spec);
    });
  }

  it("says what a type needs when the combination can't be drawn", () => {
    const sankey = newDraft("sankey", ctx, cols);
    expect(buildSpec({ ...sankey, split: null }, ctx, "x").problem).toMatch(/needs a second category/);
    const bubble = newDraft("bubble", ctx, cols);
    expect(buildSpec({ ...bubble, measures: bubble.measures.slice(0, 2) }, ctx, "x").problem).toMatch(
      /needs 3 measures/,
    );
    const grouped = newDraft("groupedBar", ctx, cols);
    const mixed: Draft = {
      ...grouped,
      split: null,
      measures: [
        { kind: "column", column: cols.numbers.find((c) => c.role === "currency")?.name ?? "", agg: "sum" },
        { kind: "column", column: "", agg: "count" },
      ],
    };
    expect(buildSpec(mixed, ctx, "x").problem).toMatch(/different units/);
  });

  it("starts on word categories, and never splits by an amount or by the axis itself", () => {
    const amount = (name: string | null) => {
      const c = ctx.profile.columns.find((x) => x.name === name);
      return (
        c?.storage === "number" && (c.role === "currency" || c.role === "rate" || c.role === "percentage")
      );
    };
    // The demo's shipping fee (0 or 49) is a category the user can still pick, but only after the rest.
    expect(cols.categories.some((c) => amount(c.name))).toBe(true);
    const firstAmount = cols.categories.findIndex((c) => amount(c.name));
    expect(cols.categories.slice(firstAmount).every((c) => amount(c.name))).toBe(true);
    expect(cols.categories[0]?.storage).not.toBe("number");
    for (const kind of ["sankey", "radar", "stackedBar", "dumbbell"] as const) {
      const d = newDraft(kind, ctx, cols);
      expect(d.split, kind).not.toBeNull();
      expect(amount(d.split), kind).toBe(false);
      expect(d.split, kind).not.toBe("column" in d.axis ? d.axis.column : null);
    }
    // Switching type keeps the axis; a split that would repeat it moves to another column.
    const to = newDraft("sankey", ctx, cols).split as string;
    const moved = adapt(
      { ...newDraft("bar", ctx, cols), axis: { type: "column", column: to } },
      "sankey",
      ctx,
      cols,
    );
    expect(moved.axis).toEqual({ type: "column", column: to });
    expect(moved.split).not.toBeNull();
    expect(moved.split).not.toBe(to);
    expect(buildSpec(moved, ctx, "x").problem).toBeNull();
  });

  it("keeps what still fits when the type changes", () => {
    const line = newDraft("line", ctx, cols);
    const bars = adapt(line, "bar", ctx, cols);
    expect(bars.axis).toEqual(line.axis);
    const donut = adapt(
      { ...newDraft("stackedBar", ctx, cols), split: cols.splits[0]?.name ?? null },
      "donut",
      ctx,
      cols,
    );
    expect(donut.split).toBeNull();
    const bubble = adapt(newDraft("scatter", ctx, cols), "bubble", ctx, cols);
    expect(bubble.measures).toHaveLength(3);
    expect(buildSpec(bubble, ctx, "x").problem).toBeNull();
    // Size and section follow the new type, unless the user chose them.
    const radar = newDraft("radar", ctx, cols);
    const calendar = adapt(radar, "calendar", ctx, cols);
    expect([calendar.w, calendar.section]).toEqual([12, "trend"]);
    const chosen = adapt({ ...radar, w: 8, section: "detail" }, "calendar", ctx, cols);
    expect([chosen.w, chosen.section]).toEqual([8, "detail"]);
  });

  it("computes what each new kind promises", () => {
    const split = cols.splits.find((c) => c.distinct > 2)?.name as string;
    // 100% stacked: every column's parts add up to the whole.
    const hundred = draw(
      {
        ...newDraft("stackedBar100", ctx, cols),
        split,
        measures: newDraft("stackedBar100", ctx, cols).measures.slice(0, 1),
      },
      "p",
    );
    const spec100 = buildSpec(
      {
        ...newDraft("stackedBar100", ctx, cols),
        split,
        measures: newDraft("stackedBar100", ctx, cols).measures.slice(0, 1),
      },
      ctx,
      "p",
    ).spec;
    const option = buildOption({
      tokens: TOKENS,
      fmt: FMT,
      kind: "stackedBar100",
      spec: spec100 as NonNullable<typeof spec100>,
      data: hundred,
      animate: false,
    }) as {
      series: Array<{ data: number[] }>;
    };
    const sums = hundred.categories.map((_, i) => option.series.reduce((a, x) => a + (x.data[i] ?? 0), 0));
    for (const sum of sums) if (sum > 0) expect(sum).toBeCloseTo(1, 6);
    // Dumbbell with a split: the two largest values, and a note saying so.
    const dumb = draw(
      {
        ...newDraft("dumbbell", ctx, cols),
        split,
        measures: newDraft("dumbbell", ctx, cols).measures.slice(0, 1),
      },
      "d",
    );
    expect(dumb.series).toHaveLength(2);
    expect(dumb.notes.join(" ")).toMatch(/Showing the 2 largest/);
    // Calendar: one bucket per day.
    expect(draw(newDraft("calendar", ctx, cols), "c").grain).toBe("day");
    // Big number: one figure, equal to the KPI card.
    const big = newDraft("bigNumber", ctx, cols);
    const value = draw(big, "b").series[0]?.values[0];
    const kpi = big.measures[0];
    if (kpi?.kind === "kpi") {
      const card = s.previewKpis([], [kpi.id]).values[0]?.value;
      expect(value).toBeCloseTo(card as number, 6);
    }
    // Bubble points carry a size; a sunburst with a second level has rings.
    expect(draw(newDraft("bubble", ctx, cols), "u").points?.some((p) => typeof p.size === "number")).toBe(
      true,
    );
    const sun = draw({ ...newDraft("sunburst", ctx, cols), split }, "s");
    expect(sun.tree?.some((n) => (n.children?.length ?? 0) > 0)).toBe(true);
  });
});
