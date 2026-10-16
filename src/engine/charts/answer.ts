/**
 * The answer to a business question (step 5), in words: which rows it
 * covers and the one sentence that leads its card. Session.answerQuestion
 * computes the rows; this writes them up, from those rows only.
 *
 * - The rows: the dashboard's filters (none for "the whole file") with the
 *   question's own on top ("in Maharashtra", "in 2026"). One on a column the
 *   dashboard already filters replaces it, because the question names its
 *   own rows.
 * - The sentence, with values printed together (core/together.ts), money
 *   compact (₹50.3L):
 *   - a ranking names the leader and the runner-up; a "(blank)" group (rows
 *     with nothing in the column) never leads;
 *   - a date part names the weekday, hour or month in full, where the
 *     measure is highest and lowest ("Orders are highest on Saturday");
 *   - a trend is the chart takeaway (chartHeadline), which compares
 *     complete periods only; with fewer than two, the latest complete period
 *     is named, or the one there is, called partial;
 *   - one overall row lists each measure's value.
 */
import { formatDay, MONTHS_LONG, WEEKDAYS_LONG } from "@/engine/core/dates";
import type { FormatOptions } from "@/engine/core/format";
import { wasWere } from "@/engine/core/labels";
import { formatForSentence, formatTogether } from "@/engine/core/together";
import type { Filter } from "@/engine/query/filter";
import type { KpiFormat } from "@/registry/schema";
import { phrase, type AskBy, type AskOrder } from "./ask";
import type { ChartData } from "./types";

/** One row of an answer: its label, raw key (as in ChartCategory) and a value per measure. */
export interface AnswerRow {
  label: string;
  raw: string | number | null;
  values: Array<number | null>;
}

/**
 * The filters a question is answered with, and the dashboard's filters its
 * own replace (same column).
 */
export function questionFilters(
  base: readonly Filter[],
  own: readonly Filter[] = [],
): { filters: Filter[]; replaced: Filter[] } {
  // Answered again after a rebuild, `base` already holds the question's own filters: those aren't replaced.
  const same = (a: Filter, b: Filter) => JSON.stringify(a) === JSON.stringify(b);
  const onOwn = base.filter((f) => own.some((o) => o.column === f.column));
  return {
    filters: [...base.filter((f) => !onOwn.includes(f)), ...own],
    replaced: onOwn.filter((f) => !own.some((o) => same(o, f))),
  };
}

/**
 * Why a question with words nothing in the file matched is not answered,
 * naming the words (the first six): answering the rest would answer another
 * question ("net revenue by warehouse" is not "net revenue").
 */
export function unplacedMessage(words: readonly string[]): string {
  const shown = words.slice(0, 6).map((w) => `"${w}"`);
  const more = words.length - shown.length;
  const list =
    more > 0
      ? `${shown.join(", ")} and ${more} more`
      : shown.length > 1
        ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`
        : (shown[0] ?? "");
  return `Not answered: nothing in your file matches ${list}, and answering without ${words.length > 1 ? "them" : "it"} would answer another question. Use your KPI and column names, and values or periods as your file writes them.`;
}

/** "Saturday", "20:00", "March", "day 15": a date part named as a sentence says it. */
function partName(part: Extract<AskBy, { kind: "part" }>["part"], row: AnswerRow): string {
  const i = Number(row.raw);
  if (part === "dow") return WEEKDAYS_LONG[i] ?? row.label;
  if (part === "month") return MONTHS_LONG[i] ?? row.label;
  if (part === "dom") return `day ${row.label}`;
  return row.label;
}

const PART_AT: Record<Extract<AskBy, { kind: "part" }>["part"], string> = {
  dow: "on",
  hour: "at",
  month: "in",
  dom: "on",
};

/** The first letter in lower case, for a takeaway that follows "Net revenue: ". */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** The sentence that leads an answer; "" when the rows hold nothing to say. */
export function answerHeadline(input: {
  by: AskBy;
  order: AskOrder;
  measures: ReadonlyArray<{ label: string; format: KpiFormat }>;
  rows: readonly AnswerRow[];
  /** The computed table behind a grouped answer: its takeaway and partial periods. */
  data?: ChartData;
  /** The grouping's heading ("Customer State", "Weekday"), for an answer that is zero throughout. */
  keyLabel?: string | null;
  fmt: FormatOptions;
}): string {
  const { by, order, measures, rows, data, keyLabel, fmt } = input;
  const m0 = measures[0];
  if (!m0) return "";
  const value = (r: AnswerRow) => r.values[0] ?? null;
  if (by.kind === "none") {
    const row = rows[0];
    if (!row) return "";
    return measures
      .map((m, i) => `${m.label}: ${formatForSentence(row.values[i], m.format, fmt)}`)
      .join(" · ");
  }
  // Zero for every group (net revenue of cancelled orders): no group "has the highest" of nothing.
  if (
    rows.length &&
    rows.every((r) => value(r) === 0 || value(r) === null) &&
    rows.some((r) => value(r) === 0)
  )
    return `${m0.label} ${wasWere(m0.label) === "were" ? "are" : "is"} ${formatForSentence(0, m0.format, fmt)} for every ${phrase(keyLabel ?? "group")} in these rows.`;
  if (by.kind === "column") {
    const [a, b] = rows.filter((r) => r.raw !== null && value(r) !== null);
    if (!a) return "";
    const [va, vb] = formatTogether([value(a), b ? value(b) : null], m0.format, fmt);
    return `${a.label} has the ${order === "asc" ? "lowest" : "highest"} ${phrase(m0.label)}: ${va}${b ? `, then ${b.label} (${vb})` : ""}.`;
  }
  const withValue = rows.filter((r) => value(r) !== null);
  if (!withValue.length) return "";
  if (by.kind === "part") {
    const peak = withValue.reduce((m, r) => ((value(r) as number) > (value(m) as number) ? r : m));
    const low = withValue.reduce((m, r) => ((value(r) as number) < (value(m) as number) ? r : m));
    const [vp, vl] = formatTogether([value(peak), value(low)], m0.format, fmt);
    const at = PART_AT[by.part];
    const verb = wasWere(m0.label) === "were" ? "are" : "is";
    return `${m0.label} ${verb} highest ${at} ${partName(by.part, peak)} (${vp})${low !== peak ? ` and lowest ${at} ${partName(by.part, low)} (${vl})` : ""}.`;
  }
  // Over time: the chart's own takeaway, which never reads an incomplete period as a fall.
  if (data?.headline) return `${m0.label}: ${lowerFirst(data.headline)}`;
  const n = rows.length;
  const partial = (i: number) =>
    Boolean((data?.partialFirst && i === 0) || (data?.partialLast && i === n - 1));
  const complete = rows.filter((r, i) => value(r) !== null && !partial(i));
  const last = complete[complete.length - 1];
  const was = wasWere(m0.label);
  if (last) return `${m0.label} ${was} ${formatForSentence(value(last), m0.format, fmt)} in ${last.label}.`;
  const only = withValue[withValue.length - 1] as AnswerRow;
  const i = rows.indexOf(only);
  const grain = data?.grain ?? "period";
  const edge =
    data?.partialLast && i === n - 1 && data.partialLastEnd !== undefined
      ? ` (data to ${formatDay(data.partialLastEnd)})`
      : data?.partialFirst && i === 0 && data.partialFirstStart !== undefined
        ? ` (data from ${formatDay(data.partialFirstStart)})`
        : "";
  return `${m0.label} ${was} ${formatForSentence(value(only), m0.format, fmt)} in ${only.label}, a partial ${grain}${edge}.`;
}
