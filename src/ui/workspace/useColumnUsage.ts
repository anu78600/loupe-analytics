"use client";

/**
 * The column-usage summary for the current analysis (engine/charts/
 * columnUsage over the recommended and user-built charts), shared by Check &
 * map's review table ("Feeds", the summary strip and the "none added" note)
 * and the dashboard header's "Uses N of your M columns" line. `derived` is true after an unpivot the user agreed to,
 * the only way the dataset can hold columns that weren't in the file.
 * Hidden columns (step 3) are counted in `total` and `hidden`, never in
 * `used`: the analysis profile leaves them out.
 */
import * as React from "react";
import { useWorkspace } from "@/store/workspace";
import { columnUsage, isUsed, type ColumnUse } from "@/engine/charts/columnUsage";

export interface ColumnUsageSummary {
  /** Each column in use → what it feeds. */
  usage: Map<string, ColumnUse>;
  /** Columns that feed at least one KPI, chart or filter. */
  used: number;
  /** Every column of the file, hidden ones included. */
  total: number;
  /** Columns the user hid in step 3. */
  hidden: number;
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
    const hidden = context.hiddenColumns.length;
    return { usage, used, total: usage.size + hidden, hidden, derived };
  }, [context, custom, derived]);
}
