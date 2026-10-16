/**
 * The landing page's build-time snapshot (ui/landing/preview-data.ts), which
 * every animation on "/" plays back.
 *
 * - The counts it quotes come from the registry and the chart catalogue, not
 *   from typed-in numbers.
 * - The figures the hero, "How it works" and the feature tiles animate are
 *   the engine's own results: each KPI card's text is its value formatted,
 *   trends and shares are finite, and shares never add up to more than the
 *   whole. Every trend period carries its start date, in order, so the axis
 *   can print the year once per year.
 * - The pieces the motion graphics need are there: three detection
 *   candidates, mapped columns to draw lines between, the KPI's SQL and DAX
 *   to type out, and an insight to show.
 */
import { describe, expect, it } from "vitest";
import { buildLandingData } from "@/ui/landing/preview-data";
import { CHART_TYPES } from "@/engine/charts/catalogue";
import { formatValue } from "@/engine/core/format";
import { DOMAINS } from "@/registry";

describe("the landing page snapshot", () => {
  const data = buildLandingData();

  it("quotes counts from the registry and the chart catalogue", () => {
    expect(data.registry.domains).toBe(DOMAINS.length);
    expect(data.registry.kpis).toBe(DOMAINS.reduce((n, d) => n + d.kpis.length, 0));
    expect(data.registry.charts).toBe(DOMAINS.reduce((n, d) => n + d.charts.length, 0));
    expect(data.chartTypes).toBe(CHART_TYPES.filter((t) => t.buildable).length);
    expect(data.columns).toHaveLength(data.file.columns);
  });

  it("animates the engine's own figures", () => {
    expect(data.states.length).toBeGreaterThan(0);
    for (const state of data.states) {
      expect(state.kpis.length).toBeGreaterThanOrEqual(3);
      for (const k of state.kpis) {
        expect(Number.isFinite(k.value)).toBe(true);
        expect(k.display).toBe(
          formatValue(k.value as number, k.format, { locale: "IN", currency: "INR", compact: true }),
        );
      }
      expect(state.trend.values.length).toBeGreaterThan(1);
      expect(state.trend.values.every(Number.isFinite)).toBe(true);
      expect(state.trend.starts).toHaveLength(state.trend.labels.length);
      expect(state.trend.starts.every((t, i, all) => t > 0 && (i === 0 || t > (all[i - 1] ?? 0)))).toBe(true);
      const shares = state.categories.reduce((a, c) => a + c.share, 0);
      expect(shares).toBeGreaterThan(0);
      expect(shares).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("has what each motion graphic draws", () => {
    expect(data.detection.candidates).toHaveLength(3);
    expect(data.detection.evidence.length).toBeGreaterThanOrEqual(3);
    for (const e of data.detection.evidence) expect(data.columns.some((c) => c.name === e.column)).toBe(true);
    expect(data.showcase.kpi.sql).toMatch(/SELECT/);
    expect(data.showcase.kpi.dax.length).toBeGreaterThan(0);
    expect(data.showcase.insight?.title ?? data.states[0]?.insights[0]?.title).toBeTruthy();
  });
});
