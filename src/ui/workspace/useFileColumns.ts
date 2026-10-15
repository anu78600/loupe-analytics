"use client";

/**
 * Every column of the file, in file order, as step 3 lists them (the data
 * grid and "Your columns"). A column in use comes from the analysis profile,
 * so it carries the user's role changes; a hidden column, which the analysis
 * profile leaves out, comes from the profile detected on loading.
 *
 * `hidden` follows the store, so a column dims the moment the user hides it,
 * while the worker is still rebuilding the analysis without it.
 */
import * as React from "react";
import type { ColumnProfile } from "@/engine/profile/types";
import { useWorkspace } from "@/store/workspace";

export interface FileColumns {
  columns: ColumnProfile[];
  hidden: ReadonlySet<string>;
}

export function useFileColumns(): FileColumns | null {
  const detected = useWorkspace((s) => s.profile);
  const analysed = useWorkspace((s) => s.context?.profile);
  const hiddenList = useWorkspace((s) => s.hiddenColumns);
  return React.useMemo(() => {
    if (!detected) return null;
    const inUse = new Map((analysed?.columns ?? []).map((c) => [c.name, c]));
    return {
      columns: detected.columns.map((c) => inUse.get(c.name) ?? c),
      hidden: new Set(hiddenList),
    };
  }, [detected, analysed, hiddenList]);
}
