/**
 * The headline KPIs as the optional AI executive summary receives them
 * (AiSummary.tsx), written exactly as the dashboard's cards write them, so
 * every figure the model may quote is one the user can see: the value
 * (formatKpi: ₹3.13Cr, 42.3%), the change with a true minus sign, in
 * percentage points for a rate (+0.4 pp, never "+0.8%"), the value it is
 * measured from, and what it is compared with. Pure, so tests can check it
 * in node.
 */
import { formatDelta, formatPointDelta, type FormatOptions } from "@/engine/core/format";
import type { KpiValue } from "@/engine/kpi/compute";
import type { KpiFormat } from "@/registry/schema";
import { formatKpi } from "@/ui/common/kpiFormat";

/** One KPI line of the summary payload. */
export interface SummaryKpi {
  name: string;
  value: string;
  /** "+40.5%", "−1.0 pp"; null without a comparison. */
  change: string | null;
  /** The value the change is measured from, written like `value`. */
  from: string | null;
  comparison: string;
}

/** The hero KPIs' lines, in the cards' order. `metas` carries each KPI's display name and format. */
export function summaryKpis(
  values: readonly KpiValue[],
  metas: ReadonlyArray<{ id: string; name: string; format: KpiFormat }>,
  heroIds: readonly string[],
  fmt: FormatOptions,
): SummaryKpi[] {
  const byId = new Map(metas.map((m) => [m.id, m]));
  return values
    .filter((v) => heroIds.includes(v.id))
    .map((v) => {
      const m = byId.get(v.id);
      const format: KpiFormat = m?.format ?? "number";
      const rate = format === "percent";
      const hasChange = rate ? Number.isFinite(v.deltaAbs ?? NaN) : Number.isFinite(v.delta ?? NaN);
      return {
        name: m?.name ?? v.id,
        value: formatKpi(v.value, format, fmt),
        // A rate moves in percentage points (40% → 42% is +2.0 pp), as on the cards.
        change: hasChange
          ? rate
            ? formatPointDelta(v.deltaAbs, fmt.locale)
            : formatDelta(v.delta, fmt.locale)
          : null,
        from: hasChange && v.previous !== null ? formatKpi(v.previous, format, fmt) : null,
        comparison: v.currentLabel
          ? `${v.currentLabel} ${v.comparisonLabel} (the value is the all-time total)`
          : v.comparisonLabel,
      };
    });
}
