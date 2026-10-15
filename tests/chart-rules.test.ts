/**
 * Chart recommendation rules from the product spec, checked on every demo
 * dataset: each chart states why it was chosen; alternatives are compatible;
 * no pie/donut has more than six slices; time is drawn as line, area or bars;
 * one axis only (measures on a shared axis share a unit); and charts that
 * can't be computed are listed with a reason instead of being faked.
 */
import { describe, expect, it } from "vitest";
import { Session } from "@/engine/session";
import { SAMPLES } from "@/engine/samples/catalog";
import { isKindCompatible } from "@/engine/charts/recommend";
import type { ChartSpec } from "@/engine/charts/types";

const categorical = (overrides: Partial<ChartSpec> = {}): ChartSpec =>
  ({
    id: "t",
    title: "t",
    kind: "bar",
    x: { kind: "column", column: "Category", label: "Category" },
    measures: [{ id: "m", label: "M", format: "currency", direction: "higher" }],
    reason: "r",
    alternatives: [],
    size: { w: 6, h: 4 },
    priority: 1,
    modes: ["executive", "analyst", "compact"],
    source: "custom",
    ...overrides,
  }) as ChartSpec;

describe("isKindCompatible", () => {
  it("never allows a pie with more than six slices", () => {
    expect(isKindCompatible("donut", categorical(), 6)).toBe(true);
    expect(isKindCompatible("donut", categorical(), 7)).toBe(false);
  });

  it("keeps lines and areas for ordered axes", () => {
    expect(isKindCompatible("line", categorical())).toBe(false);
    expect(
      isKindCompatible(
        "line",
        categorical({ x: { kind: "time", column: "Date", label: "Date", grain: "month" } as ChartSpec["x"] }),
      ),
    ).toBe(true);
  });

  it("keeps horizontal bars for named categories", () => {
    expect(isKindCompatible("hbar", categorical())).toBe(true);
    expect(
      isKindCompatible(
        "hbar",
        categorical({ x: { kind: "time", column: "Date", label: "Date", grain: "month" } as ChartSpec["x"] }),
      ),
    ).toBe(false);
  });
});

describe.each(SAMPLES.map((s) => s.id))("recommended charts on the %s demo", (sampleId) => {
  const s = new Session();
  const load = s.ingestSample(sampleId);
  if (load.status !== "ok") throw new Error(load.status);
  const top = load.detection.candidates[0];
  if (!top) throw new Error("not detected");
  const ctx = s.configure({ domainId: top.domainId, numberLocale: "IN", currency: null });

  it("recommends charts, each with a reason and compatible alternatives", () => {
    expect(ctx.charts.length).toBeGreaterThanOrEqual(4);
    for (const spec of ctx.charts) {
      expect(spec.reason.length, spec.id).toBeGreaterThan(10);
      expect(isKindCompatible(spec.kind, spec), `${spec.id} as ${spec.kind}`).toBe(true);
      for (const alt of spec.alternatives)
        expect(isKindCompatible(alt, spec), `${spec.id} alternative ${alt}`).toBe(true);
    }
  });

  it("draws time as lines, areas or bars, on one axis", () => {
    for (const spec of ctx.charts) {
      if (spec.x.kind === "time") expect(["line", "area", "bar", "stackedBar"], spec.id).toContain(spec.kind);
      if (["line", "area", "bar", "hbar", "stackedBar"].includes(spec.kind) && spec.measures.length > 1) {
        const formats = new Set(spec.measures.map((m) => m.format));
        expect(formats.size, `${spec.id} mixes ${[...formats].join(" and ")} on one axis`).toBe(1);
      }
    }
  });

  it("keeps every donut at six slices or fewer once computed", () => {
    for (const spec of ctx.charts.filter((c) => c.kind === "donut")) {
      const data = s.chart([], { specId: spec.id }, "IN");
      expect(data?.categories.length ?? 0, spec.id).toBeLessThanOrEqual(6);
    }
  });

  it("explains every chart it could not draw", () => {
    for (const skipped of ctx.skippedCharts) expect(skipped.reason.length, skipped.id).toBeGreaterThan(5);
  });
});
