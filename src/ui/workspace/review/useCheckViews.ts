"use client";

/**
 * The data check's views for Check & map (profile/dataCheck.ts): all rows,
 * the rows to check, one view per problem found and one per column's
 * blanks, each with its row count. Fetched once from the worker for the
 * page, and shared by the summary strip ("Rows to check"), the review
 * table's health badges and the Rows view.
 *
 * Hidden columns are left out of the check, so the views are fetched again
 * once the worker has rebuilt without them; until then the last views are
 * dropped rather than shown for the wrong columns (null while loading).
 */
import * as React from "react";
import type { CheckView } from "@/engine/profile/dataCheck";
import { engine } from "@/lib/engine-client";
import { useWorkspace } from "@/store/workspace";

export function useCheckViews(): CheckView[] | null {
  const datasetId = useWorkspace((s) => s.summary?.id ?? "");
  // The hidden columns the worker has applied.
  const applied = useWorkspace((s) => s.context?.hiddenColumns.join("\u0000") ?? "");
  const key = `${datasetId}|${applied}`;
  const [state, setState] = React.useState<{ key: string; views: CheckView[] } | null>(null);
  React.useEffect(() => {
    if (!datasetId) return;
    let live = true;
    void engine()
      .checkViews()
      .then((views) => {
        if (live) setState({ key, views });
      });
    return () => {
      live = false;
    };
  }, [datasetId, key]);
  return state?.key === key ? state.views : null;
}
