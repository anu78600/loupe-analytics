"use client";

/**
 * The column-usage summary for the current analysis (engine/charts/
 * columnUsage over the recommended and user-built charts), shared by the
 * mapping step's "Used by" column and the dashboard header's "Uses N of your
 * M columns" line. `derived` is true after an unpivot the user agreed to,
 * the only way the dataset can hold columns that weren't in the file.
 */
import * as React from "react";
import { useWorkspace } from "@/store/workspace";
import { columnUsage, isUsed, type ColumnUse } from "@/engine/charts/columnUsage";

export interface ColumnUsageSummary {
  usage: Map<string, ColumnUse>;
  used: number;
  total: number;
  derived: boolean;
}

export function useColumnUsage(): ColumnUsageSummary | null {
  const context = useWorkspace((s) => s.context);
  const custom = useWorkspace((s) => s.customCharts);
  const derived = useWorkspace((s) => s.summary?.kind === "derived");
  return React.useMemo(() => {
    if (!context) return null;
    const usage = columnUsage(context, [...context.charts, ...custom]);
    const used = [...usage.values()].filter(isUsed).length;
    return { usage, used, total: usage.size, derived };
  }, [context, custom, derived]);
}
