/**
 * Why one of the user's own charts can't be drawn any more, for the
 * Customise step's chart list, and which charts use a KPI the user is about
 * to delete. Kept apart from the React lists so it can be tested on real
 * data (tests/customise-charts.test.ts).
 *
 * A custom chart keeps the column names and KPI ids it was built from.
 * Recommended charts are rebuilt by the engine on every change, so they
 * never point at something gone; a custom chart can: a column hidden in
 * Check & map (or missing from this file), a KPI the user deleted, or one
 * the current mapping can't compute. The engine refuses to draw such a
 * chart (Session.chart); the list says so beside it, with the reason.
 */
import type { ChartSpec } from "@/engine/charts/types";
import { specColumns } from "@/engine/charts/columnUsage";
import { friendly } from "@/engine/core/labels";
import { isUserKpiId, type UserKpi } from "@/engine/kpi/userKpis";
import type { ContextResult } from "@/engine/session";

/** The slice of the analysis this needs (ContextResult satisfies it). */
export type ChartCheckContext = Pick<ContextResult, "kpis" | "mapping" | "hiddenColumns" | "profile">;

/** "Channel", "Channel and Courier", "Channel, Courier and State". */
function list(names: string[]): string {
  const shown = names.map(friendly);
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : (shown[0] ?? "");
}

/**
 * Why a chart can't be drawn now, in one sentence, or null when it can.
 * Only the user's own charts are checked (see the file header). Hidden
 * columns come first, as the easiest to put right.
 */
export function chartProblem(
  spec: ChartSpec,
  ctx: ChartCheckContext,
  userKpis: ReadonlyArray<Pick<UserKpi, "id" | "name" | "value" | "per">>,
): string | null {
  if (spec.source !== "custom") return null;
  const hiddenSet = new Set(ctx.hiddenColumns);
  const inAnalysis = new Set(ctx.profile.columns.map((c) => c.name));
  const columns = [
    ...specColumns(spec, (ref) => (ref.startsWith("col:") ? ref.slice(4) : ctx.mapping.fields[ref])),
  ];
  const hidden = columns.filter((c) => hiddenSet.has(c));
  if (hidden.length)
    return `It uses ${list(hidden)}, which you hid in Check & map. Show ${hidden.length > 1 ? "them" : "it"} again there, or delete this chart.`;
  const missing = columns.filter((c) => !inAnalysis.has(c));
  if (missing.length)
    return `It uses ${list(missing)}, which ${missing.length > 1 ? "aren't" : "isn't"} in this file.`;
  for (const m of spec.measures) {
    if (m.id.startsWith("agg:")) continue;
    const meta = ctx.kpis.find((k) => k.id === m.id);
    if (meta?.available) continue;
    if (isUserKpiId(m.id)) {
      const own = userKpis.find((k) => k.id === m.id);
      if (!own)
        return `It shows “${m.label}”, a KPI you deleted. Choose another measure, or delete this chart.`;
      const reads = [own.value.column, own.per?.column].filter((c): c is string => Boolean(c));
      const gone = reads.filter((c) => hiddenSet.has(c));
      if (gone.length)
        return `It shows “${own.name}”, which reads ${list(gone)}: you hid ${gone.length > 1 ? "them" : "it"} in Check & map.`;
      return `It shows “${own.name}”, which can't be computed with this file.`;
    }
    const why = meta?.unavailableReason?.replace(/^Unavailable:\s*/, "").replace(/\.$/, "");
    return meta
      ? `It shows “${meta.name}”, which can't be computed with the current mapping${why ? ` (it ${why})` : ""}.`
      : `It shows “${m.label}”, which isn't a KPI of this industry.`;
  }
  return null;
}

/** The charts that show a KPI: as a measure, or as the money measure of an analysis (RFM). */
export function chartsUsingKpi(charts: readonly ChartSpec[], kpiId: string): ChartSpec[] {
  return charts.filter((c) => c.measures.some((m) => m.id === kpiId) || c.analysisParams?.monetary === kpiId);
}
