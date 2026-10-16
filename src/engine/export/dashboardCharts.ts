/**
 * The dashboard's charts as the Power BI package describes them: the same
 * dashboard that its loupe-config.json restores.
 *
 * The engine knows the recommended chart specs; the rest of the dashboard
 * lives in the UI and travels to the export inside the config it embeds
 * (dashboard.widgets and dashboard.customCharts, written by the Export
 * step's buildConfig). Reading the visual list from there means the README
 * and the config can never disagree:
 *
 * - the charts the user made (Ask for a chart, Build) are listed with the
 *   recommended ones, unless the engine would refuse to draw them (one names a
 *   column hidden in Check & map, or a KPI that no longer exists);
 * - each chart carries the title the user gave it in Customise, and the chart
 *   type and Top N picked for it on the dashboard.
 *
 * A config that doesn't parse (or has no dashboard) leaves the specs as they
 * are. Called from Session.exportPowerBi; tested in tests/export-fixes.test.ts.
 */
import type { ChartSpec } from "@/engine/charts/types";
import { CHART_KINDS, type ChartKind } from "@/registry/schema";
import { parseConfig } from "./config";

const KINDS = new Set<string>(CHART_KINDS);

/**
 * Whether a saved custom chart has the shape of a ChartSpec. The config's
 * customCharts are not validated when parsed (they are the app's own specs),
 * so the fields the README reads are checked here.
 */
function isChartSpec(x: unknown): x is ChartSpec {
  if (!x || typeof x !== "object") return false;
  const s = x as Partial<Record<keyof ChartSpec, unknown>>;
  return (
    typeof s.id === "string" &&
    typeof s.title === "string" &&
    typeof s.kind === "string" &&
    KINDS.has(s.kind) &&
    typeof s.x === "object" &&
    s.x !== null &&
    typeof (s.x as { kind?: unknown }).kind === "string" &&
    Array.isArray(s.measures) &&
    s.measures.every((m) => typeof (m as { id?: unknown } | null)?.id === "string") &&
    Array.isArray(s.modes)
  );
}

/**
 * `specs` (the recommended charts) plus the config's custom charts that
 * `canDraw` accepts, each under its dashboard title, chart type and Top N.
 * The caller narrows the result to the charts on the dashboard, in its order.
 */
export function dashboardCharts(
  specs: ChartSpec[],
  configJson: string,
  canDraw: (spec: ChartSpec) => boolean,
): ChartSpec[] {
  const { config } = parseConfig(configJson);
  if (!config) return specs;
  const known = new Set(specs.map((s) => s.id));
  const custom = config.dashboard.customCharts
    .filter(isChartSpec)
    .filter((s) => !known.has(s.id) && canDraw(s));
  const widgets = new Map(config.dashboard.widgets.map((w) => [w.id, w]));
  return [...specs, ...custom].map((s) => {
    const w = widgets.get(s.id);
    const title = w?.title?.trim() || s.title;
    const kind = w?.kind && KINDS.has(w.kind) ? (w.kind as ChartKind) : s.kind;
    const topN = w?.topN !== undefined && Number.isInteger(w.topN) && w.topN > 0 ? w.topN : s.topN;
    return title === s.title && kind === s.kind && topN === s.topN ? s : { ...s, title, kind, topN };
  });
}
