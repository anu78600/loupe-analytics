/**
 * What a refresh with a new file changed (version 55.0), for the report shown
 * once it is done (RefreshReport.tsx): the file, its rows and how far its
 * data runs, against the project's last; its columns against the saved
 * dashboard's (renamed, missing, new, of another type); and which of the
 * dashboard's KPIs and charts it kept, with the reason for any it couldn't.
 * Built from the project as it was (ProjectRecord.shown) and the analysis of
 * the new file; names and counts only, no figures.
 */
import type { ColumnChanges } from "@/engine/core/types";
import type { SkippedChart } from "@/engine/charts/recommend";
import type { KpiMeta } from "@/engine/session";
import type { ProjectRecord } from "./db";

export interface RefreshReport {
  projectName: string;
  fileName: string;
  previousFileName: string;
  rows: number;
  previousRows: number;
  /** The latest date in the data now and before, when known. */
  dataTo: number | null;
  previousDataTo: number | null;
  changes: ColumnChanges;
  /** Filters taken off because their column is missing: the column names. */
  filters: string[];
  /** The user's own charts taken off because they read a missing column. */
  ownCharts: string[];
  /** Null for a project saved before version 55.0, which didn't note its KPIs and charts. */
  kpis: { kept: number; total: number; lost: Array<{ name: string; reason: string }> } | null;
  charts: { kept: number; total: number; lost: Array<{ name: string; reason: string }> } | null;
  /** The project as it was, for "Undo". */
  previous: ProjectRecord;
}

/** The analysis of the new file, as the workspace holds it after the dashboard is applied. */
export interface RefreshedState {
  fileName: string;
  rows: number;
  dataTo: number | null;
  kpis: readonly KpiMeta[];
  customKpiIssues: ReadonlyArray<{ id: string; reason: string }>;
  /** The KPIs on the dashboard now (hero and supporting). */
  layout: readonly string[];
  /** The charts on the dashboard now. */
  charts: readonly string[];
  skippedCharts: readonly SkippedChart[];
}

const NOT_SHOWN = "Not on the dashboard for this file.";

export function buildRefreshReport(
  previous: ProjectRecord,
  changes: ColumnChanges,
  fitted: { filters: string[]; charts: string[] },
  now: RefreshedState,
): RefreshReport {
  const shown = previous.shown;
  const onPage = new Set(now.layout);
  const kpiReason = (id: string) =>
    now.kpis.find((k) => k.id === id)?.unavailableReason ??
    now.customKpiIssues.find((k) => k.id === id)?.reason ??
    NOT_SHOWN;
  const drawn = new Set(now.charts);
  const ownLost = new Set(fitted.charts);
  const chartReason = (id: string, title: string) =>
    now.skippedCharts.find((c) => c.id === id)?.reason ??
    (ownLost.has(title) ? "It reads a column the new file doesn't have." : NOT_SHOWN);
  return {
    projectName: previous.name,
    fileName: now.fileName,
    previousFileName: previous.fileName,
    rows: now.rows,
    previousRows: previous.rows,
    dataTo: now.dataTo,
    previousDataTo: shown?.dataTo ?? null,
    changes,
    filters: fitted.filters,
    ownCharts: fitted.charts,
    kpis: shown
      ? {
          kept: shown.kpis.filter((k) => onPage.has(k.id)).length,
          total: shown.kpis.length,
          lost: shown.kpis
            .filter((k) => !onPage.has(k.id))
            .map((k) => ({ name: k.name, reason: kpiReason(k.id) })),
        }
      : null,
    charts: shown
      ? {
          kept: shown.charts.filter((c) => drawn.has(c.id)).length,
          total: shown.charts.length,
          lost: shown.charts
            .filter((c) => !drawn.has(c.id))
            .map((c) => ({ name: c.title, reason: chartReason(c.id, c.title) })),
        }
      : null,
    previous,
  };
}

/** True when the refresh changed nothing but the rows: same columns, everything kept. */
export function nothingChanged(r: RefreshReport): boolean {
  const c = r.changes;
  return (
    !c.renamed.length &&
    !c.missing.length &&
    !c.added.length &&
    !c.retyped.length &&
    !r.filters.length &&
    !r.ownCharts.length &&
    !r.kpis?.lost.length &&
    !r.charts?.lost.length
  );
}
