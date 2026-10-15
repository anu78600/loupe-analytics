/**
 * Plain-language descriptions of a column, read from its profile: what kind
 * of values it holds ("Number", "Date", "Time of day", "Text"…) and what is
 * actually in it (its range or most common values, distinct count, blanks).
 * Shared by Detect's "Columns in your file" and Check & map's column table,
 * so both describe a column the same way.
 */
import { isoTime, formatDay } from "@/engine/core/dates";
import { formatPlain } from "@/engine/core/format";
import type { ColumnProfile } from "@/engine/profile/types";

/** The kind of values a column holds, in everyday words. */
export function kindLabel(c: ColumnProfile): string {
  if (c.role === "time") return "Time of day";
  switch (c.storage) {
    case "number":
      return c.numeric?.integer ? "Whole number" : "Number";
    case "date":
      return c.temporal?.hasTime ? "Date and time" : "Date";
    case "boolean":
      return "Yes / no";
    default:
      return "Text";
  }
}

/**
 * What the column actually holds: the range of a number, date or time
 * column, or the most common values of a text column, then how many values
 * are distinct and how many cells are blank.
 */
export function dataSummary(c: ColumnProfile): string {
  const parts: string[] = [];
  if (c.numeric) {
    const d = c.numeric.integer ? 0 : 2;
    parts.push(`${formatPlain(c.numeric.min, d, "INTL")} to ${formatPlain(c.numeric.max, d, "INTL")}`);
  } else if (c.temporal) {
    // A time of day is stored as a time on 1 Jan 1970: show the clock times, not that date.
    const show = (t: number) => (c.role === "time" ? isoTime(t).slice(0, 5) : formatDay(t));
    parts.push(`${show(c.temporal.min)} to ${show(c.temporal.max)}`);
  } else if (c.categorical?.top.length) {
    const top = c.categorical.top.slice(0, 3).map((v) => v.value);
    parts.push(`${top.join(", ")}${c.distinct > 3 ? "…" : ""}`);
  } else if (c.examples.length) parts.push(c.examples.slice(0, 3).join(", "));
  parts.push(`${c.distinct.toLocaleString("en-US")} distinct`);
  if (c.nullPct >= 0.005) parts.push(`${Math.round(c.nullPct * 100)}% blank`);
  return parts.join(" · ");
}
