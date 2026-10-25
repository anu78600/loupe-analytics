/**
 * A saved dashboard fitted to next month's file (version 55.0). The new file
 * is read with the saved column names (parse/matchColumns.ts), so a renamed
 * column needs nothing here; this removes what names a column the new file
 * no longer has, which would otherwise filter on nothing or draw an error:
 * the filters on it, the user's own charts that read it, the mapping and
 * role choices made for it, and the outcome, date or hidden column it was.
 * A column whose type changed keeps everything but its role choice, which was
 * made for the old type. Template KPIs and charts need no help: the engine
 * leaves out any whose column is gone and says why, and the refresh report
 * (ui/workspace/projects) lists them.
 */
import type { ColumnChanges } from "@/engine/core/types";
import type { LoupeConfig } from "./config";

export interface FittedConfig {
  config: LoupeConfig;
  /** Filters taken off because their column is missing: the column names. */
  filters: string[];
  /** The user's own charts taken off because they read a missing column: their titles. */
  charts: string[];
}

/** Whether a value names one of the columns anywhere inside it (as a name, or "col:<name>" in a KPI). */
function names(v: unknown, cols: ReadonlySet<string>): boolean {
  if (typeof v === "string") return cols.has(v) || (v.startsWith("col:") && cols.has(v.slice(4)));
  if (Array.isArray(v)) return v.some((x) => names(x, cols));
  if (v && typeof v === "object") return Object.values(v).some((x) => names(x, cols));
  return false;
}

const titleOf = (chart: unknown): string => {
  const t = (chart as { title?: unknown } | null)?.title;
  return typeof t === "string" && t.trim() ? t : "One of your charts";
};

/** The saved config with every reference to a missing column taken off, and what was taken off. */
export function fitConfig(cfg: LoupeConfig, changes: ColumnChanges): FittedConfig {
  const missing = new Set(changes.missing);
  const retyped = new Set(changes.retyped.map((r) => r.name));
  if (!missing.size && !retyped.size) return { config: cfg, filters: [], charts: [] };
  const filters = cfg.dashboard.filters.filter((f) => missing.has(f.column));
  const charts = cfg.dashboard.customCharts.filter((c) => names(c, missing));
  const { outcome, primaryDate, ...rest } = cfg;
  const config: LoupeConfig = {
    ...rest,
    // A field pointed at a missing column is matched again from the new file.
    mappingOverrides: Object.fromEntries(
      Object.entries(cfg.mappingOverrides).filter(([, column]) => column === null || !missing.has(column)),
    ),
    roleOverrides: Object.fromEntries(
      Object.entries(cfg.roleOverrides).filter(([column]) => !missing.has(column) && !retyped.has(column)),
    ),
    hiddenColumns: cfg.hiddenColumns.filter((c) => !missing.has(c)),
    // A missing outcome or date: Loupe chooses again, as it does for a config that never chose.
    ...(outcome !== undefined && !(outcome !== null && missing.has(outcome)) ? { outcome } : {}),
    ...(primaryDate && !missing.has(primaryDate) ? { primaryDate } : {}),
    dashboard: {
      ...cfg.dashboard,
      filters: cfg.dashboard.filters.filter((f) => !missing.has(f.column)),
      customCharts: cfg.dashboard.customCharts.filter((c) => !names(c, missing)),
    },
  };
  return {
    config,
    filters: [...new Set(filters.filter((f) => f.kind !== "dateRange").map((f) => f.column))],
    charts: charts.map(titleOf),
  };
}
