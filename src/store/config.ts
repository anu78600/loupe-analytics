/**
 * The dashboard's settings as a LoupeConfig (engine/export/config): every
 * choice made on the file (industry, mapping, roles, hidden columns, KPIs,
 * layout, filters, colours) and none of its rows. Export › "Reopen this
 * dashboard later" downloads it, and since version 53.0 every saved project
 * keeps it (ui/workspace/projects), so it lives with the store rather than in
 * the export step.
 */
import { fingerprintOf, type LoupeConfig } from "@/engine/export/config";
import { useWorkspace } from "./workspace";
import { useSettings } from "./settings";

/** The current dashboard's config; null before an industry is chosen. */
export function buildConfig(): LoupeConfig | null {
  const s = useWorkspace.getState();
  const settings = useSettings.getState();
  if (!s.summary || !s.profile || !s.domainId) return null;
  return {
    app: "loupe",
    version: 1,
    createdAt: new Date().toISOString(),
    fingerprint: fingerprintOf(
      s.summary.fileName,
      s.summary.rowCount,
      s.profile.columns.map((c) => ({ name: c.name, type: c.storage })),
    ),
    domainId: s.domainId,
    subDomainId: s.subDomainId ?? undefined,
    business: s.business,
    mappingOverrides: s.mappingOverrides,
    classOverrides: s.classOverrides,
    roleOverrides: s.roleOverrides,
    // Only a choice the user made: without it, Loupe chooses the outcome again when the config is applied.
    ...(s.outcome !== undefined ? { outcome: s.outcome } : {}),
    // The date chosen with "Dates by", when one was.
    ...(s.primaryDate ? { primaryDate: s.primaryDate } : {}),
    hiddenColumns: s.hiddenColumns,
    customKpis: s.customKpis,
    ...(s.kpiLayout ? { kpiLayout: s.kpiLayout } : {}),
    kpiRenames: s.kpiRenames,
    kpiTargets: s.kpiTargets,
    dashboard: {
      mode: s.mode,
      view: s.dashView,
      ...(s.pageTitle ? { pageTitle: s.pageTitle } : {}),
      widgets: s.widgets.map((w) => ({
        id: w.id,
        kind: w.kind,
        w: w.w,
        h: w.h,
        hidden: w.hidden,
        ...(w.title ? { title: w.title } : {}),
        topN: w.topN,
      })),
      customCharts: s.customCharts,
      datePreset: s.datePreset,
      filters: s.filters(),
    },
    settings: {
      chartTheme: settings.chartTheme,
      numberLocale: settings.numberLocale,
      currency: settings.currencyOverride ?? s.context?.currency ?? "",
    },
  };
}
