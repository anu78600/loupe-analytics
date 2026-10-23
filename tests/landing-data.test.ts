/**
 * The landing page's build-time snapshot (ui/landing/preview-data.ts), which
 * every animation on "/" plays back.
 *
 * - The counts it quotes come from the registry and the chart catalogue, not
 *   from typed-in numbers.
 * - The figures the hero, "How it works" and the feature tiles animate are
 *   the engine's own results: each KPI card's text is its value formatted as
 *   the dashboard's card writes it, trends and shares are finite, and shares
 *   never add up to more than the whole. Every trend period carries its start
 *   date, in order, so the axis can print the year once per year.
 * - The hero is the live demo's one-page dashboard: its six KPI tiles and its
 *   four charts as the one page's own plan picks them, each chart with the
 *   takeaway the engine wrote, and its insights with their real scores.
 * - The pieces the motion graphics need are there: three detection
 *   candidates, mapped columns, the reading of the data, the KPI's SQL and
 *   DAX to type out, a question answered with its SQL, and an insight.
 * - The app's phases and steps the preview draws (ui/landing/appShell.ts)
 *   match the workspace's own (ui/workspace/shell/phases.ts).
 */
import { describe, expect, it } from "vitest";
import { buildLandingData } from "@/ui/landing/preview-data";
import { APP_PHASES } from "@/ui/landing/appShell";
import { CHART_TYPES } from "@/engine/charts/catalogue";
import { formatValue } from "@/engine/core/format";
import { kpiCompact } from "@/ui/common/kpiFormat";
import { PHASES, STEP_ICON, stepLabel } from "@/ui/workspace/shell/phases";
import { PAGE_KPIS } from "@/ui/workspace/dashboard/page/pagePlan";
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
      expect(state.kpis.length).toBeLessThanOrEqual(PAGE_KPIS);
      for (const k of state.kpis) {
        expect(Number.isFinite(k.value)).toBe(true);
        expect(k.compact).toBe(kpiCompact(k.format, k.value));
        expect(k.display).toBe(
          formatValue(k.value as number, k.format, { locale: "IN", currency: "INR", compact: k.compact }),
        );
      }
      expect(state.trend.values.length).toBeGreaterThan(1);
      expect(state.trend.values.every(Number.isFinite)).toBe(true);
      expect(state.trend.starts).toHaveLength(state.trend.labels.length);
      expect(state.trend.starts.every((t, i, all) => t > 0 && (i === 0 || t > (all[i - 1] ?? 0)))).toBe(true);
      const shares = state.categories.reduce((a, c) => a + c.share, 0);
      expect(shares).toBeGreaterThan(0);
      expect(shares).toBeLessThanOrEqual(1 + 1e-9);
      if (state.mix) {
        const whole = state.mix.slices.reduce((a, s) => a + s.share, 0);
        expect(whole).toBeCloseTo(1, 9);
      }
      for (const ins of state.insights) {
        expect(ins.impact).toBeGreaterThanOrEqual(0);
        expect(ins.impact).toBeLessThanOrEqual(100);
      }
      expect(state.insightsTotal).toBeGreaterThanOrEqual(state.insights.length);
    }
  });

  it("shows the live demo's one page: its plan's four charts, each with its takeaway", () => {
    const state = data.states[0];
    expect(state).toBeDefined();
    if (!state) return;
    const drawn = [state.trend.id, state.mix?.id, state.categoryHead.id, state.stateHead.id].filter(Boolean);
    // Every chart the one page shows has a slot in the preview, and nothing else is drawn.
    expect([...drawn].sort()).toEqual([...data.dashboard.charts].sort());
    for (const head of [state.trend, state.mix, state.categoryHead, state.stateHead]) {
      if (head) expect(head.takeaway).toBeTruthy();
    }
    expect(data.dashboard.title).toBeTruthy();
    expect(data.dashboard.slicers.length).toBeGreaterThan(0);
  });

  it("has what each motion graphic draws", () => {
    expect(data.detection.candidates).toHaveLength(3);
    expect(data.detection.evidence.length).toBeGreaterThanOrEqual(3);
    for (const e of data.detection.evidence) expect(data.columns.some((c) => c.name === e.column)).toBe(true);
    expect(data.understanding.drivers.length).toBeGreaterThan(0);
    for (const d of data.understanding.drivers)
      expect(data.columns.some((c) => c.name === d.column)).toBe(true);
    expect(data.showcase.kpi.sql).toMatch(/SELECT/);
    expect(data.showcase.kpi.dax.length).toBeGreaterThan(0);
    expect(data.showcase.question?.sql).toMatch(/SELECT/);
    expect(data.showcase.question?.rows.length).toBeGreaterThan(0);
    expect(data.showcase.insight?.title ?? data.states[0]?.insights[0]?.title).toBeTruthy();
  });

  it("draws the workspace's own phases and steps", () => {
    expect(APP_PHASES.map((p) => p.label)).toEqual(PHASES.map((p) => p.label));
    APP_PHASES.forEach((phase, i) => {
      const own = PHASES[i];
      expect(phase.steps.map((s) => s.id)).toEqual(own?.steps);
      for (const s of phase.steps) {
        expect(s.label).toBe(stepLabel(s.id));
        expect(s.icon).toBe(STEP_ICON[s.id]);
      }
    });
  });
});
