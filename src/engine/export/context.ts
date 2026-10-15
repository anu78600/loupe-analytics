/**
 * The snapshot every export generator reads from (built by
 * Session.exportContext() inside the worker). Generators read only this
 * object plus small arguments such as the currency symbol, never dashboard
 * filters or UI state: exports always describe the whole file.
 */
import type { Dataset } from "@/engine/core/types";
import type { NumberLocale } from "@/engine/core/format";
import type { DatasetProfile } from "@/engine/profile/types";
import type { Mapping } from "@/engine/detect/mapping";
import type { KpiResolutionMap, KpiSelection } from "@/engine/kpi/resolve";
import type { CompileNames } from "@/engine/kpi/context";
import type { ChartSpec } from "@/engine/charts/types";
import type { DomainDef } from "@/registry/schema";

export interface ExportContext {
  ds: Dataset;
  /** Profile with the user's role overrides applied. */
  profile: DatasetProfile;
  domain: DomainDef;
  subDomain?: { id: string; name: string };
  mapping: Mapping;
  res: KpiResolutionMap;
  selection: KpiSelection;
  /** Chart specs to describe; the Power BI export narrows them to the visible dashboard. */
  specs: ChartSpec[];
  /** Export-safe table, column and measure names (see names.ts). */
  names: CompileNames;
  /**
   * Original name of the primary date column the Power BI Date table relates
   * to; null when there is none, or when relating it would need a new column
   * the user declined (see `dateTableSkipped`).
   */
  dateColumn: string | null;
  /**
   * The user chose not to add columns. Generators then never create or
   * instruct creating a column: no date-only helper (so no Date table when
   * the date has a time of day) and no calculated columns in the README.
   */
  noNewColumns?: boolean;
  /** Primary date column whose Date table was left out because it needed a new column. */
  dateTableSkipped?: string;
  currency: string;
  locale: NumberLocale;
  /** Engine values over the full dataset, used as verification comments. */
  kpiValues: Map<string, number | null>;
  /** Export date, YYYY-MM-DD (UTC). */
  generatedAt: string;
}

/**
 * KPIs to export, in display order: hero, supporting, your-column KPIs, detail (helpers needed by refs included).
 * In practice every other available KPI is appended after the selection, so
 * any hidden helper a measure references is always defined. Unavailable KPIs
 * are dropped.
 */
export function exportKpiIds(ctx: ExportContext): string[] {
  const order = [
    ...ctx.selection.hero,
    ...ctx.selection.supporting,
    ...ctx.selection.columns,
    ...ctx.selection.detail,
  ];
  const avail = new Set([...ctx.res.values()].filter((r) => r.available).map((r) => r.def.id));
  // Include hidden helpers referenced by exported measures.
  for (const r of ctx.res.values()) if (r.available && !order.includes(r.def.id)) order.push(r.def.id);
  return order.filter((id) => avail.has(id));
}
