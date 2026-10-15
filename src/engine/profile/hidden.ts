/**
 * Hidden columns (step 3, "Check & map"). These are columns the user keeps in
 * the file but that nothing may compute from: usually the raw columns a
 * cleaned column was built from, such as Unit_Price and the Reference_Price
 * used to correct it, kept beside Unit_Price_Clean as a reference.
 *
 * Hiding never removes data. The dataset, the data grid, the CSV export and
 * the Power BI table keep every column (Power BI marks hidden ones isHidden).
 * What changes is the profile the analysis is built from. withoutColumns()
 * drops the hidden columns from it, so these never see them: field matching,
 * the generic domain, column KPIs, chart recommendations, the filter rail,
 * insights and the question reader. The table-level facts that named a
 * hidden column (primary date and its gaps, keys and grain, hierarchies,
 * wide format) are worked out again from the columns left. The currency
 * stays as detected: a symbol in a hidden column is still evidence of the
 * file's currency.
 */
import type { Dataset } from "@/engine/core/types";
import type { DatasetProfile } from "./types";
import {
  analyseTimeSeries,
  detectHierarchies,
  detectKeysAndGrain,
  detectWideFormat,
  pickPrimaryDate,
} from "./structure";

/** `profile` without the `hidden` columns; the same object when none of them is in it. */
export function withoutColumns(
  ds: Dataset,
  profile: DatasetProfile,
  hidden: ReadonlySet<string>,
): DatasetProfile {
  if (!profile.columns.some((c) => hidden.has(c.name))) return profile;
  const columns = profile.columns.filter((c) => !hidden.has(c.name));
  const touches = (names: readonly string[]) => names.some((n) => hidden.has(n));
  // Keys and hierarchies cost a pass over the rows, so they are only redone when a hidden column was part of them.
  const keyed =
    touches(profile.grain.columns) ||
    touches(profile.keys.primary ?? []) ||
    profile.keys.candidates.some(touches) ||
    profile.keys.foreign.some((f) => hidden.has(f.column));
  const { keys, grain } = keyed ? detectKeysAndGrain(ds, columns) : profile;
  const hierarchies = profile.hierarchies.some((h) => touches(h.levels))
    ? detectHierarchies(ds, columns)
    : profile.hierarchies;
  const primaryDate =
    profile.primaryDate && !hidden.has(profile.primaryDate) ? profile.primaryDate : pickPrimaryDate(columns);
  const dateProfile = primaryDate ? columns.find((c) => c.name === primaryDate) : undefined;
  return {
    ...profile,
    columnCount: columns.length,
    columns,
    keys,
    grain,
    hierarchies,
    primaryDate,
    timeSeries:
      primaryDate === profile.primaryDate
        ? profile.timeSeries
        : dateProfile
          ? analyseTimeSeries(ds, dateProfile)
          : null,
    wide: detectWideFormat(columns),
  };
}
