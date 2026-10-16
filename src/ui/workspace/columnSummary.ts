/**
 * Plain-language descriptions of a column, read from its profile: what kind
 * of values it holds ("Number", "Date", "Time of day", "Text"…) and what is
 * actually in it (its range or most common values, distinct count, blanks).
 * Shared by Detect's "Columns in your file" and Check & map's column table,
 * so both describe a column the same way.
 *
 * Numbers follow the number-format setting (Indian 3,21,000 or international
 * 321,000) with a true minus sign; percentages read as percentages ("0% to
 * 23%", whether stored as fractions or points); years, IDs and postal codes
 * are written as they are, without separators ("2003", not "2,003").
 */
import { isoTime, formatDay } from "@/engine/core/dates";
import { formatCount, formatPlain, formatValue, type NumberLocale } from "@/engine/core/format";
import type { ColumnProfile } from "@/engine/profile/types";
import { useSettings } from "@/store/settings";

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

/** True for numbers that are labels rather than amounts: years, IDs and postal codes keep their digits as written. */
function writtenAsIs(c: ColumnProfile): boolean {
  const n = c.numeric;
  if (!n?.integer) return false;
  return (
    c.role === "identifier" ||
    c.geoLevel === "postal" ||
    (c.tokens.includes("year") && n.min >= 1000 && n.max <= 9999)
  );
}

/** One end of a number column's range, as the column's kind of number reads. */
function numberText(c: ColumnProfile, v: number, locale: NumberLocale): string {
  if (writtenAsIs(c)) return String(v).replace(/^-/, "−");
  if (c.role === "percentage")
    // Stored as fractions (0.23) or as points (23): either way it reads "23%".
    return formatValue(c.percentScale === 100 ? v / 100 : v, "percent", { locale, currency: "" });
  const text = formatPlain(v, c.numeric?.integer ? 0 : 2, locale);
  return text.startsWith("-") ? `−${text.slice(1)}` : text;
}

/**
 * What the column actually holds: the range of a number, date or time
 * column, or the most common values of a text column, then how many values
 * are distinct and how many cells are blank. `locale` is the number format
 * to write it in; it defaults to the current setting.
 */
export function dataSummary(
  c: ColumnProfile,
  locale: NumberLocale = useSettings.getState().numberLocale,
): string {
  const parts: string[] = [];
  // A range of one value is that value ("2003", not "2003 to 2003").
  const range = (from: string, to: string) => (from === to ? from : `${from} to ${to}`);
  if (c.numeric) {
    parts.push(range(numberText(c, c.numeric.min, locale), numberText(c, c.numeric.max, locale)));
  } else if (c.temporal) {
    // A time of day is stored as a time on 1 Jan 1970: show the clock times, not that date.
    const show = (t: number) => (c.role === "time" ? isoTime(t).slice(0, 5) : formatDay(t));
    parts.push(range(show(c.temporal.min), show(c.temporal.max)));
  } else if (c.categorical?.top.length) {
    const top = c.categorical.top.slice(0, 3).map((v) => v.value);
    parts.push(`${top.join(", ")}${c.distinct > 3 ? "…" : ""}`);
  } else if (c.examples.length) parts.push(c.examples.slice(0, 3).join(", "));
  parts.push(`${formatCount(c.distinct, locale)} distinct`);
  if (c.nullPct >= 0.005) parts.push(`${Math.round(c.nullPct * 100)}% blank`);
  return parts.join(" · ");
}
