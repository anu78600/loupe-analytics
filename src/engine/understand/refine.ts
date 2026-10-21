/**
 * Roles read again from what the table is (version 49.0).
 *
 * Profiling decides each column's role on its own (profile/roles.ts). Some
 * readings only make sense once the table is known: in a table of cases or
 * entities with no timeline (one row per passenger, house or employee), a
 * number that profiling could only call "a summable measure" is rarely an
 * amount that adds up across the rows:
 * - a few whole-number codes under a class name ("Pclass" of 1–3) are
 *   groups: a category;
 * - a small whole-number count per row ("SibSp", "Parch", "GarageCars" of
 *   0–8) is averaged, never added up; so is one read as money only from an
 *   abbreviation in its name, with no currency mark in its values;
 * - only 0 and 1 ("SeniorCitizen") is a yes/no flag.
 * A table of transactions or readings (a primary date saying when each row
 * happened) is left as profiled, and so is every column whose role the user
 * set. The session applies this to the analysis profile (Session's
 * analysisProfile), never to the profile detection reads, so detection is
 * unchanged; each refined column's reason says why it was read again.
 */
import type { ColumnProfile, DatasetProfile } from "@/engine/profile/types";
import { timelineOf } from "./outcome";

/** Raw-name parts of a code that names a group ("Pclass", "Tier", "Grade band"). */
const CLASS_NAME = /class|tier|type|group|categor|code|band|segment|cluster|zone|division|kind/i;
/** At most this many whole-number values make a code or a small count. */
const MAX_CODES = 10;
const MAX_COUNT_VALUES = 12;
const MAX_COUNT = 20;

/** The low-confidence fallback of roles.ts: nothing in the name said what the number is. */
const fallbackMeasure = (c: ColumnProfile) =>
  c.role === "measure" && c.additivity === "additive" && c.roleConfidence <= 0.6;

/** The column read again, or null to keep it as profiled. */
function refineColumn(c: ColumnProfile): ColumnProfile | null {
  const n = c.numeric;
  if (c.storage !== "number" || !n || !n.integer || n.min < 0) return null;
  if (fallbackMeasure(c) && c.distinct === 2 && n.min === 0 && n.max === 1)
    return {
      ...c,
      role: "boolean",
      additivity: undefined,
      defaultAgg: "count",
      roleReason: "Only 0 and 1 in a table of cases: a yes/no flag, read as a share.",
    };
  if (fallbackMeasure(c) && c.distinct <= MAX_CODES && n.max <= MAX_COUNT && CLASS_NAME.test(c.name))
    return {
      ...c,
      role: "dimension",
      additivity: undefined,
      defaultAgg: "count",
      roleReason: `A few whole-number codes (${n.min}–${n.max}) under a class name in a table of cases: groups, not an amount to add up.`,
    };
  const moneyByNameOnly = c.role === "currency" && !c.currency;
  if ((fallbackMeasure(c) || moneyByNameOnly) && c.distinct <= MAX_COUNT_VALUES && n.max <= MAX_COUNT)
    return {
      ...c,
      role: "measure",
      additivity: "non-additive",
      defaultAgg: "avg",
      roleReason: `A small whole-number count per row (${n.min}–${n.max}) in a table of cases: averaged, never added up.`,
    };
  return null;
}

/**
 * `profile` with the columns of a table of cases read again (see the file
 * header), except those in `keep` (the user's role overrides). The same
 * object when nothing changes.
 */
export function refineRoles(profile: DatasetProfile, keep: ReadonlySet<string> = new Set()): DatasetProfile {
  if (timelineOf(profile) !== null) return profile;
  let changed = false;
  const columns = profile.columns.map((c) => {
    if (keep.has(c.name)) return c;
    const r = refineColumn(c);
    if (!r) return c;
    changed = true;
    return r;
  });
  return changed ? { ...profile, columns } : profile;
}
