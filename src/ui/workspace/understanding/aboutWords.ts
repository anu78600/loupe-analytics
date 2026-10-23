/**
 * The words and groupings of the story Detect tells about the data
 * (AboutData.tsx), kept as plain functions so tests/about-data.test.ts reads
 * them without the components:
 *
 * - the line saying what one row is, how many there are and the dates they span,
 *   and the overview's date tile ("Oct 2024 – Sep 2026") and kinds line;
 * - the outcome select's options: Loupe's choice, the other candidates, none;
 * - each driver's statistic as the analyst standards write it ("r = −0.31",
 *   with a true minus sign) and its direction in words;
 * - the columns grouped by kind, folded to a few chips a group on a wide table;
 * - the "Read as …" choices for a column;
 * - the problems "Before you continue" lists, or the line saying there are none;
 * - the industry as a label: its match, how many columns it explains, and
 *   whether its template leads.
 *
 * Every figure comes from the understanding the engine computed
 * (engine/understand); nothing here computes or estimates one.
 */
import type {
  ColumnKind,
  ColumnUnderstanding,
  DataUnderstanding,
  Driver,
  IndustryLabel,
  OutcomeType,
} from "@/engine/understand/types";
import { KIND_LABEL, SETTABLE_KINDS } from "@/engine/understand/kinds";
import { bucketLabel, formatRange } from "@/engine/core/dates";
import { formatCount, formatPlain, type NumberLocale } from "@/engine/core/format";
import { countOf } from "@/ui/common/words";

/** The order the kinds are listed in: what the table is measured by and its readings first, keys and free text last. */
export const KIND_ORDER: readonly ColumnKind[] = [
  "outcome",
  "time",
  "amount",
  "measurement",
  "score",
  "rate",
  "category",
  "place",
  "flag",
  "id",
  "text",
];

/** A group's heading: the kind in the plural, as a list of columns reads. */
export const KIND_GROUP: Record<ColumnKind, string> = {
  outcome: "Outcome",
  time: "Dates",
  amount: "Amounts",
  measurement: "Measurements",
  score: "Scores",
  rate: "Rates",
  category: "Categories",
  place: "Places",
  flag: "Yes/no",
  id: "IDs",
  text: "Text",
};

/** What each kind of outcome is analysed as, for the badge beside the outcome select. */
export const OUTCOME_TYPE_LABEL: Record<OutcomeType, string> = {
  binary: "Yes/no rate",
  ordinal: "Score",
  class: "Classes",
  amount: "Amount",
};

/** Above this many columns the groups fold to FOLDED_PER_GROUP chips each, with "Show all N columns". */
export const FOLD_ABOVE = 16;
/** Chips a group shows while folded. */
export const FOLDED_PER_GROUP = 6;
/** Drivers listed at most (the understanding keeps up to eight, strongest first). */
export const DRIVERS_SHOWN = 5;

/**
 * "One row per wine sample · 4,898 rows · 13 columns · Date: Jan 2023 – Oct 2025":
 * what one row is, the counts in the user's digit grouping, and the dates the rows span.
 */
export function rowLine(u: DataUnderstanding, columns: number, locale: NumberLocale): string {
  const parts = [
    u.subject.rowMeaning,
    countOf(u.subject.rows, "row", locale),
    countOf(columns, "column", locale),
  ];
  const span = timeSpan(u.time);
  if (span) parts.push(span);
  return parts.join(" · ");
}

/**
 * The dates the rows span, at the grain the dates fall on, written as the analyst standards write
 * dates ("Jan 2023 – Oct 2025", "Q1 2024 – Q2 2025", "3 Jan – 28 Feb 2025"), led by the column.
 * Null without a date column.
 */
export function timeSpan(time: DataUnderstanding["time"]): string | null {
  if (!time || !Number.isFinite(time.from) || !Number.isFinite(time.to)) return null;
  let range: string;
  if (time.grain === "day" || time.grain === "week") range = formatRange(time.from, time.to);
  else {
    const a = bucketLabel(time.from, time.grain);
    const b = bucketLabel(time.to, time.grain);
    range = a === b ? a : `${a} – ${b}`;
  }
  return `${time.column}: ${range}`;
}

/**
 * A driver's statistic as written in its sentence: "r = 0.44" for a correlation, "η = 0.53" for
 * group means, "V = 0.30" for an association, two decimals, a true minus sign for a negative r.
 */
export function statLabel(d: Pick<Driver, "method" | "value">, locale: NumberLocale): string {
  const symbol = d.method === "correlation" ? "r" : d.method === "group-means" ? "η" : "V";
  const shown = formatPlain(Math.abs(d.value), 2, locale);
  const negative = d.value < 0 && Number(Math.abs(d.value).toFixed(2)) !== 0;
  return `${symbol} = ${negative ? "−" : ""}${shown}`;
}

/** Which way the outcome moves with the driver, in words for screen readers and the row's name. */
export function directionWords(d: Pick<Driver, "column" | "direction">, outcome: string): string {
  if (d.direction === "up") return `${outcome} rises with ${d.column}`;
  if (d.direction === "down") return `${outcome} falls as ${d.column} rises`;
  return `${outcome} differs across ${d.column}`;
}

/** A driver's bar width: its strength (0–1, comparable across methods) as a whole percentage. */
export function strengthPct(strength: number): number {
  if (!Number.isFinite(strength)) return 0;
  return Math.round(Math.min(1, Math.max(0, strength)) * 100);
}

/** One option of the outcome select. `value` is "auto", "none" or "col:<column>". */
export interface OutcomeOption {
  value: string;
  label: string;
  hint?: string;
}

/** The select's value for the store's outcome: undefined is Loupe's choice, null none. */
export function outcomeValue(chosen: string | null | undefined): string {
  return chosen === undefined ? "auto" : chosen === null ? "none" : `col:${chosen}`;
}

/** The store's outcome for a value of the select (the inverse of outcomeValue). */
export function outcomeFromValue(value: string): string | null | undefined {
  if (value === "auto") return undefined;
  if (value === "none") return null;
  return value.startsWith("col:") ? value.slice(4) : undefined;
}

/**
 * The outcome select's options, "No outcome" aside (it is always offered, after a separator):
 *
 * - Loupe's choice ("auto"): named by its column while it is in effect; once the user picked
 *   another column or none, "Let Loupe choose", since its choice is read again then;
 * - then every other candidate, best first: the current outcome's alternatives, and the outcome
 *   and alternatives Loupe found when the file loaded (`remembered`), so a column picked away from
 *   stays on offer. Only columns the reading still has (not hidden) are offered.
 */
export function outcomeOptions(
  u: DataUnderstanding,
  chosen: string | null | undefined,
  remembered: readonly string[],
): OutcomeOption[] {
  const present = new Set(u.columns.map((c) => c.name));
  const auto = chosen === undefined ? (u.outcome?.column ?? null) : null;
  const options: OutcomeOption[] = [
    chosen === undefined
      ? { value: "auto", label: auto ?? "None found", hint: "Loupe's choice" }
      : { value: "auto", label: "Let Loupe choose" },
  ];
  const seen = new Set<string>(auto ? [auto] : []);
  const candidates = [
    ...(typeof chosen === "string" ? [chosen] : []),
    ...(u.outcome?.alternatives ?? []),
    ...remembered,
  ];
  for (const name of candidates) {
    if (seen.has(name) || !present.has(name)) continue;
    seen.add(name);
    options.push({ value: `col:${name}`, label: name });
  }
  return options;
}

/** A group of columns of one kind, most important first. `more` counts the chips folded away. */
export interface KindGroup {
  kind: ColumnKind;
  label: string;
  columns: ColumnUnderstanding[];
  more: number;
}

/**
 * The columns grouped by kind in KIND_ORDER, the most important first within a group (file order
 * breaks ties). With `perGroup`, each group keeps that many chips and counts the rest in `more`.
 */
export function groupColumns(columns: readonly ColumnUnderstanding[], perGroup = Infinity): KindGroup[] {
  const order = new Map(columns.map((c, i) => [c.name, i]));
  const groups: KindGroup[] = [];
  for (const kind of KIND_ORDER) {
    const of = columns
      .filter((c) => c.kind === kind)
      .sort((a, b) => b.importance - a.importance || (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
    if (!of.length) continue;
    const shown = of.slice(0, perGroup);
    groups.push({ kind, label: KIND_GROUP[kind], columns: shown, more: of.length - shown.length });
  }
  return groups;
}

/** The kinds a column's "Read as …" menu lists; the current one first when it can't be set there (a date, the outcome). */
export function readAsKinds(
  current: ColumnKind,
): Array<{ kind: ColumnKind; label: string; settable: boolean }> {
  const settable = SETTABLE_KINDS.map((kind) => ({ kind, label: KIND_LABEL[kind], settable: true }));
  return SETTABLE_KINDS.includes(current)
    ? settable
    : [{ kind: current, label: KIND_LABEL[current], settable: false }, ...settable];
}

/**
 * The date tile of Detect's overview: the dates the rows span, short enough for a tile
 * ("Oct 2024 – Sep 2026"; the days only within one month, "3–28 Jan 2025"), and the column they
 * come from. Null without a date column.
 */
export function dateTile(time: DataUnderstanding["time"]): { value: string; caption: string } | null {
  if (!time || !Number.isFinite(time.from) || !Number.isFinite(time.to)) return null;
  const fine = time.grain === "day" || time.grain === "week";
  const a = bucketLabel(time.from, fine ? "month" : time.grain);
  const b = bucketLabel(time.to, fine ? "month" : time.grain);
  // Within one month the month alone says too little: the days, as the analyst standards write them.
  const value = a !== b ? `${a} – ${b}` : fine ? formatRange(time.from, time.to) : a;
  return { value, caption: time.column };
}

/** "in 7 kinds": how many kinds the columns are read as (the groups of the Columns chapter). */
export function kindsLine(columns: readonly ColumnUnderstanding[]): string {
  const kinds = new Set(columns.map((c) => c.kind)).size;
  return `in ${kinds} ${kinds === 1 ? "kind" : "kinds"}`;
}

/** One problem in "Before you continue": the reading's words, with the health check's detail when known. */
export interface IssueRow {
  title: string;
  detail: string | null;
  severity: "info" | "warning" | "critical";
  column: string | null;
}

/**
 * The problems "Before you continue" lists: the reading's own (at most three, most serious first),
 * each with the detail, severity and column of the health check it came from (matched by its
 * title); one the report doesn't hold stays a warning with no detail.
 */
export function issueRows(
  issues: readonly string[],
  health: ReadonlyArray<{
    title: string;
    detail: string;
    severity: IssueRow["severity"];
    column?: string;
  }>,
): IssueRow[] {
  return issues.slice(0, 3).map((title) => {
    const h = health.find((i) => i.title === title);
    return {
      title,
      detail: h?.detail ?? null,
      severity: h?.severity ?? "warning",
      column: h?.column ?? null,
    };
  });
}

/** The positive line when nothing needs a look: "No problems found in 49,037 rows". */
export function noProblemsLine(rows: number, locale: NumberLocale): string {
  return `No problems found in ${countOf(rows, "row", locale)}`;
}

/** The industry as a label on the reading: its name, a short detail and the full reason. */
export interface IndustryWords {
  name: string;
  /** "92% match · explains 9 of 12 columns", or what the dashboard is built from instead. */
  detail: string;
  /** "Explains 9 of 12 columns", for a card that shows the match beside it; null without an industry. */
  explains: string | null;
  /** The industry explains few of the columns, so the data-led charts lead (shown in the warning tone). */
  weak: boolean;
  /** The whole explanation, behind the label's ⓘ. */
  full: string;
}

/**
 * The industry label in words. `domainId` is the industry chosen on Detect: the general dashboard
 * assumes none; otherwise the understanding's label names the chosen (or detected) industry, or
 * null when none fits.
 */
export function industryWords(
  industry: IndustryLabel | null,
  domainId: string | null,
  locale: NumberLocale,
): IndustryWords {
  if (domainId === "generic")
    return {
      name: "No industry",
      detail: "designed from the columns",
      explains: null,
      weak: false,
      full: "You chose the general dashboard: it is designed from the columns themselves, with no industry's KPIs assumed.",
    };
  if (!industry)
    return {
      name: "No industry fits",
      detail: "designed from the columns",
      explains: null,
      weak: false,
      full: "No industry matches these columns well enough to lead, so the dashboard is designed from the columns themselves. Pick an industry below if one fits.",
    };
  const { mapped, columns, weak } = industry.fit;
  const explains =
    mapped === 0
      ? `explains none of ${countOf(columns, "column", locale)}`
      : `explains ${formatCount(mapped, locale)} of ${countOf(columns, "column", locale)}`;
  return {
    name: industry.name,
    detail: `${industry.confidence}% match · ${explains}`,
    explains: `${explains.charAt(0).toUpperCase()}${explains.slice(1)}`,
    weak,
    full: weak
      ? `${industry.name} scores ${industry.confidence}% and ${explains}: too few to lead. The dashboard is designed from the data, with ${industry.name}'s KPIs where they fit.`
      : `${industry.name} scores ${industry.confidence}% and ${explains}, so its KPIs and charts lead the dashboard.`,
  };
}
