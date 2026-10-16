/**
 * "Ask for a chart" and the business questions of step 5: the user says what
 * they want to see, in words ("average customer rating by city", "total
 * sales and total profit by month", "net revenue in Maharashtra in 2026") or
 * by picking columns, and Loupe designs the chart or answers the question.
 *
 * Two steps, both pure:
 * - readAsk() turns a phrase into a ChartAsk (measures, what to show them
 *   by, an optional split, top N, a chart type, and the rows it is about) by
 *   matching words to the view's KPIs, the file's columns and values, and
 *   the template's field synonyms ("sales" finds the column mapped as
 *   revenue). Whole KPI names are found first, so "average order value" is
 *   the AOV KPI rather than an average of a column, and "revenue per
 *   customer" is not "revenue by customer". A value of a category ("in
 *   Maharashtra", "cancelled") or a period ("in 2026", "in September 2026")
 *   becomes a filter. Every word is accounted for: one that is not a KPI, a
 *   column, a value, a period or a filler word is reported back as
 *   unmatched, and a question with unmatched words is not answered, because
 *   the answer would be to another question. It never invents a column, and
 *   never offers a hidden one (the profile it reads leaves them out).
 * - designAsk() turns a ChartAsk into one or more ChartSpecs following the
 *   dataviz rules: ratings and prices are averaged (never summed), measures
 *   with different units never share an axis (they become side-by-side charts,
 *   or a scatter when asked "A vs B"), categories get sorted bars with top N
 *   plus Others (just the top N when the user asked for exactly that), time
 *   gets columns or lines, a separate time column gives the hour of day, and
 *   averages set aside groups too small to compare.
 *
 * Every number the resulting charts show is computed by the engine from the
 * user's columns, like any other chart.
 */
import {
  addDays,
  addMonths,
  bucketLabel,
  endOfBucket,
  endOfDay,
  formatDay,
  formatRange,
  MONTHS_LONG,
  startOfDay,
  startOfMonth,
  truncate,
  type DatePart,
  type TimeGrain,
} from "@/engine/core/dates";
import { friendly, kpiLabel, wasWere } from "@/engine/core/labels";
import { GENERIC_TOKENS, jaroWinkler, nameSimilarity, phraseTokens, tokenize } from "@/engine/profile/names";
import type { ColumnProfile } from "@/engine/profile/types";
import type { Filter } from "@/engine/query/filter";
import type { ChartKind, KpiFormat } from "@/registry/schema";
import { customSpec, isKindCompatible, timeColumnFor } from "./recommend";
import { MAX_DONUT_SLICES, type ChartMeasure, type ChartSpec, type ResolvedAxis } from "./types";

export type AskAgg = "sum" | "avg" | "median" | "min" | "max" | "count" | "countDistinct";

/** One thing to measure: a KPI of the view, or a column aggregated one way. */
export type AskMeasure = { kind: "kpi"; id: string } | { kind: "column"; column: string; agg: AskAgg };

/** What to show the measures by. */
export type AskBy =
  | { kind: "none" }
  | { kind: "time"; column: string; grain: TimeGrain | "auto" }
  | { kind: "part"; column: string; part: DatePart }
  | { kind: "column"; column: string };

export interface ChartAsk {
  measures: AskMeasure[];
  by: AskBy;
  /** A second category, drawn as stacked segments or a heatmap. */
  split?: string;
  topN?: number;
  /** False when the user asked for exactly the top N ("top 5 products"): no "Others" bucket. */
  others?: boolean;
  /** Chart type the user asked for; used when it suits the data. */
  kind?: ChartKind;
  /** "A vs B": compare two measures against each other (a scatter). */
  versus?: boolean;
  /**
   * The rows the request names in its own words ("in Maharashtra",
   * "cancelled", "in 2026"). A question applies them on top of the
   * dashboard's filters, replacing a filter on the same column; a chart
   * can't carry them, so the Ask panel says so instead.
   */
  filters?: Filter[];
  /**
   * Words of a question nothing in the file matched (QuestionsStep sets
   * them). A question with any is not answered (Session.answerQuestion names
   * the words), also when it is answered again after a rebuild: answering
   * the rest would answer another question.
   */
  unmatched?: string[];
}

/** The parts of the analysis context asking needs (ContextResult provides them). */
export interface AskContext {
  kpis: Array<{
    id: string;
    name: string;
    short?: string;
    format: KpiFormat;
    direction: "higher" | "lower" | "neutral";
    available: boolean;
    hidden: boolean;
  }>;
  profile: { columns: ColumnProfile[] };
  domain: { fields: Array<{ id: string; label: string; synonyms: string[] }> };
  mapping: { fields: Record<string, string> };
  dateColumn: string | null;
}

export interface AskReading {
  ask: ChartAsk;
  /** Plain-language summary of what was understood, e.g. "Average Customer Rating by Region". */
  understood: string;
  /** Words that matched nothing in the file, quoted back to the user. */
  unmatched: string[];
  /** Choices made on the user's behalf ("region or city": Region was used). */
  notes: string[];
  /** The request's own filters in words: "Customer State: Maharashtra", "Order Date: September 2026". */
  filterLabels: string[];
}

export interface DesignedChart {
  spec: ChartSpec;
  /** Why this chart type, in one or two sentences. */
  why: string;
}

export interface AskDesign {
  charts: DesignedChart[];
  notes: string[];
  /** Set when nothing can be drawn, with what is missing. */
  error?: string;
}

const AGG_LABEL: Record<AskAgg, string> = {
  sum: "Total",
  avg: "Average",
  median: "Median",
  min: "Lowest",
  max: "Highest",
  count: "Rows",
  countDistinct: "Distinct",
};

/** An aggregation as a sentence names it: "not as the average you asked for". */
const AGG_ASKED: Record<AskAgg, string> = {
  sum: "total",
  avg: "average",
  median: "median",
  min: "lowest value",
  max: "highest value",
  count: "count",
  countDistinct: "distinct count",
};

const col = (ctx: AskContext, name: string) => ctx.profile.columns.find((c) => c.name === name);

/** Columns that can only be averaged: rates, percentages, scores, prices. */
const averagedOnly = (c: ColumnProfile | undefined) =>
  Boolean(c && (c.role === "rate" || c.role === "percentage" || c.additivity === "non-additive"));

/** The aggregation a column calls for when none is asked. */
export function defaultAgg(c: ColumnProfile): AskAgg {
  if (c.storage === "number" && (c.role === "measure" || c.role === "currency"))
    return c.additivity === "non-additive" ? "avg" : "sum";
  if (c.role === "rate" || c.role === "percentage") return "avg";
  if (c.role === "datetime" || c.role === "time") return "count";
  return "countDistinct";
}

/**
 * The aggregation actually used: an asked one when it makes sense for the
 * column, else the column's own, with a note saying why it changed.
 */
function fitAgg(c: ColumnProfile, asked: AskAgg | undefined, notes: string[]): AskAgg {
  const numeric = c.storage === "number" && c.role !== "identifier";
  if (!asked) return defaultAgg(c);
  if (asked === "count") {
    if (c.role === "identifier") return "countDistinct";
    // "How many units" adds the units up: counting rows would answer how many order lines there are.
    if (numeric && (c.role === "measure" || c.role === "currency") && c.additivity !== "non-additive") {
      notes.push(`${friendly(c.name)} is a quantity, so "how many" adds it up.`);
      return "sum";
    }
    return "count";
  }
  if (asked === "countDistinct") return "countDistinct";
  if (!numeric) {
    notes.push(`${friendly(c.name)} isn't a number, so it is counted (distinct values) instead.`);
    return "countDistinct";
  }
  if (asked === "sum" && averagedOnly(c)) {
    notes.push(
      `${friendly(c.name)} is a ${c.role === "currency" ? "per-unit price" : "rate or score"}, so it is averaged: adding it up would mean nothing.`,
    );
    return "avg";
  }
  return asked;
}

/** ChartMeasure for an AskMeasure: KPIs keep their own name and format; columns get "Total X", "Average X"… */
export function askMeasure(m: AskMeasure, ctx: AskContext): ChartMeasure | null {
  if (m.kind === "kpi") {
    const k = ctx.kpis.find((x) => x.id === m.id && x.available);
    return k ? { id: k.id, label: k.name, format: k.format, direction: k.direction } : null;
  }
  if (m.agg === "count") return { id: "agg:count:", label: "Rows", format: "integer", direction: "neutral" };
  const c = col(ctx, m.column);
  if (!c) return null;
  const format: KpiFormat =
    m.agg === "countDistinct"
      ? "integer"
      : c.role === "currency"
        ? "currency"
        : c.role === "percentage"
          ? c.percentScale === 1
            ? "percent"
            : "decimal"
          : m.agg === "avg" || m.agg === "median" || !c.numeric?.integer
            ? "decimal"
            : "integer";
  return {
    id: `agg:${m.agg}:${c.name}`,
    label: `${AGG_LABEL[m.agg]} ${friendly(c.name)}`,
    format,
    direction: "neutral",
  };
}

// ---------------------------------------------------------------- reading a phrase

/** One word of a request. */
interface Word {
  /** As typed, in lower case. */
  w: string;
  /** Canonical name tokens (names.tokenize); none for punctuation. */
  canon: string[];
  /** Set on the one word that stands for the whole name of a KPI. */
  kpi?: string;
  /** Taken by a filter, the chart type, top N, an aggregation or a joining word. */
  used?: boolean;
  /** A KPI word that only describes the value before it ("Enterprise customers"). */
  descriptor?: boolean;
}

/**
 * Phrases folded into one word before anything is read, in requests and in
 * KPI names alike. A date part is one idea ("day of the week"), and dropping
 * its "of the" as filler would leave "day week"; a repeated grain ("month by
 * month") is simply "by month".
 */
const REWRITES: Array<[RegExp, string]> = [
  [/\b(?:days?|weekdays?) of (?:the |a )?weeks?\b/g, " weekday "],
  [/\b(?:hours?|times?) of (?:the |a )?days?\b/g, " hourofday "],
  [/\bmonths? of (?:the |a )?years?\b/g, " monthofyear "],
  [/\bdays? of (?:the |a )?months?\b/g, " dayofmonth "],
  [/\bweek days?\b/g, " weekday "],
  [/\b(day|week|month|quarter|year)s? (?:by|on|over|to|after) (?:the )?\1s?\b/g, " by $1 "],
  [/\b(?:each|every) (day|week|month|quarter|year)\b/g, " by $1 "],
];

/** Lower case, punctuation as spaces, "&" as "and", then REWRITES: the form names and requests are compared in. */
function normalise(text: string): string {
  let s = ` ${text.toLowerCase()} `
    .replace(/[‘’]/g, "'")
    .replace(/'s\b/g, "")
    .replace(/[?!.;:"'`()[\]{}]/g, " ")
    .replace(/&/g, " and ")
    .replace(/[,+]/g, (m) => ` ${m} `)
    .replace(/\s+/g, " ");
  for (const [re, to] of REWRITES) s = s.replace(re, to);
  return s.replace(/\s+/g, " ");
}

const toWords = (s: string): Word[] =>
  s
    .split(" ")
    .filter(Boolean)
    .map((w) => ({ w, canon: tokenize(w) }));

/** A name's canonical tokens, read like a request, so the two compare word for word. */
const canonOf = (text: string): string[] => toWords(normalise(text)).flatMap((w) => w.canon);

/** Not yet taken, and not a KPI's name. */
const live = (w: Word | undefined): w is Word => Boolean(w && !w.used && !w.kpi);

/**
 * Where the live words from `i` spell `seq` (canonical tokens), the index
 * after them, else -1. Punctuation inside a name ("Kurta – Black") is passed
 * over.
 */
function canonAt(words: readonly Word[], i: number, seq: readonly string[]): number {
  let k = 0;
  let j = i;
  while (k < seq.length) {
    const w = words[j];
    if (!live(w)) return -1;
    if (w.canon.length) {
      if (k + w.canon.length > seq.length) return -1;
      for (let x = 0; x < w.canon.length; x++) if (w.canon[x] !== seq[k + x]) return -1;
      k += w.canon.length;
    } else if (k === 0) return -1;
    j++;
  }
  return j;
}

/** Where the live words from `i` are `seq` as typed ("a|b" accepts either), the index after them, else -1. */
function seqAt(words: readonly Word[], i: number, seq: readonly string[]): number {
  for (let k = 0; k < seq.length; k++) {
    const w = words[i + k];
    if (!live(w) || !(seq[k] as string).split("|").includes(w.w)) return -1;
  }
  return i + seq.length;
}

/** The first place at or after `from` where one of `seqs` starts, with the index after it. */
function findSeq(
  words: readonly Word[],
  seqs: ReadonlyArray<readonly string[]>,
  from = 0,
): { at: number; end: number } | null {
  for (let i = from; i < words.length; i++)
    for (const seq of seqs) {
      const end = seqAt(words, i, seq);
      if (end >= 0) return { at: i, end };
    }
  return null;
}

/** Words that start the "by" part: "revenue by region", "orders per month", "sales across channels". */
const BY_SEQS = [
  ["grouped", "by"],
  ["for", "each|every"],
  ["in", "each"],
  ["by"],
  ["per"],
  ["across"],
  ["with"],
  ["over"],
  ["within"],
];
/** Words that start a split: "revenue by month split by channel". */
const SPLIT_SEQS = [
  ["split|stacked|coloured|colored|segmented", "by"],
  ["broken|break|breaking", "down", "by"],
];
/** "A vs B": two measures compared with each other. */
const VS_SEQS = [["vs|versus|against"], ["compared", "to|with"]];
/** Words that join measures, or groupings. */
const JOINERS = new Set(["and", ",", "+"]);
/** After these, a word names what to group by, so it is never read as a value or a one-word KPI. */
const BY_LIKE = new Set(["by", "per", "across", "each", "every"]);
/** Words skipped when looking at the word before another. */
const ARTICLES = new Set(["the", "a", "an"]);
/** Words that put a value or a period in front of the rows ("in Maharashtra", "for 2026", "where …"). */
const PREP = new Set([
  "in",
  "for",
  "from",
  "at",
  "on",
  "within",
  "during",
  "where",
  "with",
  "among",
  "of",
  "to",
  "over",
  "since",
  "whose",
  "when",
]);
/** Words between a column and its value: "where channel is Website", "state = Kerala". */
const LINK = new Set(["is", "=", "equals", "equal", "was", "are", "were", "of"]);
/** A grain without "by": "monthly sales", "sales trend". */
const TIME_WORDS = new Set([
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
  "annual",
  "annually",
  "trend",
  "trends",
]);
/** What "count of rows" counts. */
const ROW_WORDS = new Set(["row", "rows", "record", "records", "entry", "entries", "line", "lines"]);

/** Aggregation words; the first entry found in a measure decides (a distinct count before a plain count). */
const AGG_WORDS: Array<[string[], AskAgg]> = [
  [["total|overall|cumulative"], "sum"],
  [["sum"], "sum"],
  [["average|avg|mean"], "avg"],
  [["median"], "median"],
  [["highest|maximum|max|largest|biggest"], "max"],
  [["lowest|minimum|min|smallest"], "min"],
  [["distinct|unique"], "countDistinct"],
  [["number|count|no", "of"], "count"],
  [["count"], "count"],
  [["how", "many"], "count"],
];

const KIND_WORDS: Array<[string[], ChartKind]> = [
  [["pie|donut|doughnut"], "donut"],
  [["horizontal", "bar|bars"], "hbar"],
  [["stacked"], "stackedBar"],
  [["heatmap|heatmaps"], "heatmap"],
  [["heat", "map|maps"], "heatmap"],
  [["scatter"], "scatter"],
  [["treemap"], "treemap"],
  [["tree", "map|maps"], "treemap"],
  [["map|maps"], "geoTile"],
  [["table"], "table"],
  [["area"], "area"],
  [["line|lines"], "line"],
  [["bar|bars|column|columns"], "bar"],
];

const GRAIN_WORDS: Array<[RegExp, TimeGrain | "auto"]> = [
  [/^(daily|day|days|date|dates|each day)$/, "day"],
  [/^(weekly|week|weeks)$/, "week"],
  [/^(monthly|month|months)$/, "month"],
  [/^(quarterly|quarter|quarters)$/, "quarter"],
  [/^(yearly|annual|annually|year|years)$/, "year"],
  [/^(time|over time|trend|trends|period|periods)$/, "auto"],
];

// Tested on the words as typed, before fillers are dropped: "day of the week" needs its "of".
const PART_WORDS: Array<[RegExp, DatePart]> = [
  [/^(weekday|weekdays|day of (the )?week|days of (the )?week)$/, "dow"],
  [/^(hour|hours|hourofday|hour of (the )?day|time of (the )?day|hourly)$/, "hour"],
  [/^(monthofyear|month of (the )?year|season|seasonality)$/, "month"],
  [/^(dayofmonth|day of (the )?month)$/, "dom"],
];

const PART_LABEL: Record<DatePart, string> = {
  dow: "weekday",
  hour: "hour of day",
  month: "month of year",
  dom: "day of month",
};

/**
 * Words that carry no meaning for the chart or the question ("show me a
 * chart of …", "how has … changed"). They are never reported as unmatched.
 */
const FILLER = new Set(
  (
    "please show me i want wanna need would like to see give get make create build draw plot display view " +
    "a an the my our chart charts graph graphs visual visuals visualise visualize diagram for of what is are " +
    "was were all data wise trend trends which who whom how much many do does did done has have had there " +
    "their we us you your tell list find know compare compared comparing comparison change changed changes " +
    "changing evolve evolved evolving move moved look looking been be being in on at from into it its this " +
    "that these those can could should let so far currently ever any also just both then than as if about up " +
    "out when where during among breakdown distribution split doing performing perform performed sell sold " +
    "selling buy bought made earn earned generate generated generating bring brought brings or and by per " +
    "across with over within whose since may might must will shall kindly"
  ).split(" "),
);

/** Chart words that are also everyday nouns ("product line", "sales area"): a question takes them only next to "chart" or after "as a". */
const AMBIGUOUS_KINDS = new Set([
  "line",
  "lines",
  "bar",
  "bars",
  "column",
  "columns",
  "area",
  "map",
  "maps",
  "table",
  "stacked",
]);
const CHART_NOUNS = new Set(["chart", "charts", "graph", "graphs", "plot", "diagram", "visual", "view"]);
const CHART_LEADS = new Set(["as", "a", "an", "into", "using", "show", "draw", "plot"]);

/** Values a category may hold that are everyday words, not something to filter on. */
const NOT_VALUES = new Set([
  "other",
  "others",
  "none",
  "na",
  "null",
  "unknown",
  "total",
  "all",
  "yes",
  "no",
  "true",
  "false",
  "blank",
  "day",
  "week",
  "month",
  "quarter",
  "year",
  "time",
  "date",
  "top",
  "new",
]);

/** ID-like words a match may leave out without changing what is measured ("courier name" is Courier). */
const SAFE = new Set([
  "id",
  "number",
  "code",
  "key",
  "name",
  "title",
  "label",
  "reference",
  "info",
  "detail",
  "data",
]);

interface Match {
  score: number;
  measure?: AskMeasure;
  column?: string;
  label: string;
  /** A rate, score or price (a KPI in percent, ratio or decimal, or such a column): it can't be totalled. */
  rate?: boolean;
  /** Canonical tokens of the name that matched, to tell which words of the request it accounts for. */
  covers: readonly string[];
}

// Words that qualify a measure without changing what it is: "Net revenue" is the revenue a business
// reports, so a request for "revenue" means that KPI rather than a raw amount column.
const QUALIFIERS = new Set(["net", "gross", "total", "overall", "all"]);

/**
 * True when a KPI's name is the words asked plus only qualifiers ("Net revenue"
 * for "revenue", "Gross sales (GMV)" for "sales"); a bracketed acronym is ignored.
 */
function qualifiedName(name: string, termTokens: readonly string[]): boolean {
  const words = tokenize(name.replace(/\([^)]*\)/g, " "));
  const asked = new Set(termTokens);
  return termTokens.every((t) => words.includes(t)) && words.every((w) => asked.has(w) || QUALIFIERS.has(w));
}

/**
 * Best KPI or column for a measure phrase ("sales", "customer rating"). When a
 * total is asked, a KPI that is a rate only wins if nothing that adds up
 * matches: "total discount" is the discount amount, not the discount rate.
 */
function matchMeasureOnce(term: string, ctx: AskContext, asked?: AskAgg): Match | null {
  const termTokens = tokenize(term);
  if (!termTokens.length) return null;
  const found: Match[] = [];
  const take = (m: Match) => found.push(m);
  for (const k of ctx.kpis) {
    if (!k.available || k.hidden) continue;
    const s = Math.max(
      nameSimilarity(tokenize(k.name), term),
      k.short ? nameSimilarity(tokenize(k.short), term) : 0,
    );
    // A KPI named for the words asked plus only a qualifier ("revenue" → Net revenue, "profit" →
    // Gross profit) beats a column found through a template synonym: the KPI applies the business
    // rules (no cancelled or returned orders), so the answer matches the KPI card. "Revenue per
    // sales rep" is another measure, so "sales" doesn't qualify for it. Closer names rank first.
    const score = qualifiedName(k.name, termTokens) ? Math.max(s, 0.981 + 0.015 * s) : s;
    // A KPI wins ties with a column: it carries the template's definition and format.
    if (score >= 0.6)
      take({
        score: score + 0.01,
        measure: { kind: "kpi", id: k.id },
        label: k.name,
        rate: k.format === "percent" || k.format === "ratio" || k.format === "decimal",
        covers: [...tokenize(k.name), ...(k.short ? tokenize(k.short) : [])],
      });
  }
  for (const c of ctx.profile.columns) {
    const s = nameSimilarity(c.tokens, term);
    if (s >= 0.6) take({ score: s, column: c.name, label: c.name, rate: averagedOnly(c), covers: c.tokens });
  }
  // Template vocabulary: "sales" finds the column mapped as revenue.
  for (const f of ctx.domain.fields) {
    const column = ctx.mapping.fields[f.id];
    if (!column || !col(ctx, column)) continue;
    let best = 0;
    let covers: readonly string[] = [];
    for (const syn of [f.label, ...f.synonyms]) {
      const s = nameSimilarity(termTokens, syn);
      if (s > best) {
        best = s;
        covers = phraseTokens(syn);
      }
    }
    if (best >= 0.6)
      take({ score: best - 0.02, column, label: column, rate: averagedOnly(col(ctx, column)), covers });
  }
  const rank = (list: Match[]) => list.sort((a, b) => b.score - a.score)[0] ?? null;
  if (asked === "sum") return rank(found.filter((m) => !m.rate)) ?? rank(found);
  // "Average discount" is the average of the Discount column: a KPI that totals it can't be averaged.
  if (asked === "avg" || asked === "median" || asked === "min" || asked === "max") {
    const numeric = (m: Match) => {
      const c = m.column ? col(ctx, m.column) : undefined;
      return Boolean(c && c.storage === "number" && c.role !== "identifier" && c.role !== "dimension");
    };
    return rank(found.filter(numeric)) ?? rank(found);
  }
  return rank(found);
}

/** Best column for a "by …" phrase, or a time grain / date part, with the name's tokens. */
function matchByOnce(
  term: string,
  ctx: AskContext,
): { by: AskBy; label: string; covers: readonly string[] } | null {
  const t = term.trim();
  const all = tokenize(t);
  const date = ctx.dateColumn;
  for (const [re, part] of PART_WORDS) {
    if (!re.test(t)) continue;
    if (part === "hour") {
      const time = date
        ? timeColumnFor(ctx.profile, date)
        : ctx.profile.columns.find((c) => c.role === "time");
      const timeCol = time ?? (date && col(ctx, date)?.temporal?.hasTime ? col(ctx, date) : undefined);
      if (timeCol)
        return {
          by: { kind: "part", column: timeCol.name, part: "hour" },
          label: PART_LABEL.hour,
          covers: all,
        };
      return null;
    }
    if (date) return { by: { kind: "part", column: date, part }, label: PART_LABEL[part], covers: all };
    return null;
  }
  for (const [re, grain] of GRAIN_WORDS) {
    if (re.test(t) && date)
      return {
        by: { kind: "time", column: date, grain },
        label: grain === "auto" ? "over time" : grain,
        covers: all,
      };
  }
  if (!all.length) return null;
  let best: { score: number; column: string; covers: readonly string[] } | null = null;
  const consider = (column: string, score: number, covers: readonly string[]) => {
    const c = col(ctx, column);
    // Numbers are measures, not categories; a time column means hour of day.
    if (!c || (c.storage === "number" && c.role !== "dimension")) return;
    if (score >= 0.6 && (!best || score > best.score)) best = { score, column, covers };
  };
  for (const c of ctx.profile.columns) consider(c.name, nameSimilarity(c.tokens, t), c.tokens);
  for (const f of ctx.domain.fields) {
    const column = ctx.mapping.fields[f.id];
    if (!column) continue;
    let s = 0;
    let covers: readonly string[] = [];
    for (const syn of [f.label, ...f.synonyms]) {
      const x = nameSimilarity(all, syn);
      if (x > s) {
        s = x;
        covers = phraseTokens(syn);
      }
    }
    consider(column, s - 0.02, covers);
  }
  if (!best) return null;
  const { column, covers } = best as { column: string; covers: readonly string[] };
  const found = col(ctx, column) as ColumnProfile;
  if (found.role === "time")
    return {
      by: { kind: "part", column: found.name, part: "hour" },
      label: `hour of ${friendly(found.name)}`,
      covers,
    };
  if (found.storage === "date")
    return { by: { kind: "time", column: found.name, grain: "auto" }, label: friendly(found.name), covers };
  return { by: { kind: "column", column: found.name }, label: friendly(found.name), covers };
}

/**
 * The phrase with plural words made singular ("sales reps" → "sales rep"),
 * for a second try when the first finds nothing: column names are mostly
 * singular and the name matcher doesn't fold every plural.
 */
function singular(term: string): string {
  return term
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

function matchMeasure(term: string, ctx: AskContext, asked?: AskAgg): Match | null {
  return (
    matchMeasureOnce(term, ctx, asked) ??
    (singular(term) !== term ? matchMeasureOnce(singular(term), ctx, asked) : null)
  );
}

function matchBy(term: string, ctx: AskContext): ReturnType<typeof matchByOnce> {
  return matchByOnce(term, ctx) ?? (singular(term) !== term ? matchByOnce(singular(term), ctx) : null);
}

/**
 * The words of a phrase a match doesn't account for: not in the matched
 * name (allowing one letter's slip, "revenu"), not filler and not an ID-like
 * word. "net revenue apparel" matched to Net revenue leaves "apparel".
 */
function uncovered(words: readonly string[], covers: readonly string[]): string[] {
  const named = new Set(covers);
  // Words the name folds into one token ("unit price" is the column UnitPrice's "unitprice").
  const compounds = tokenize(words.join(" ")).filter((t) => named.has(t));
  const near = (t: string) =>
    named.has(t) ||
    SAFE.has(t) ||
    compounds.some((c) => c !== t && c.includes(t)) ||
    (t.length >= 5 && covers.some((c) => c.length >= 5 && jaroWinkler(c, t) >= 0.93));
  // A short plural the name matcher keeps ("reps") counts as its singular ("rep").
  const placed = (w: string) => tokenize(w).every(near) || tokenize(singular(w)).every(near);
  return words.filter((w) => !FILLER.has(w) && !placed(w));
}

/**
 * The best measure for some words, and the words it leaves unplaced. The
 * words as typed are tried, then without filler, then (for up to eight
 * words) the longest run of them that matches in full: in "net revenue
 * apparel", Net revenue is found and "apparel" is reported, rather than the
 * whole being stretched over a column's synonym.
 */
function matchTerm(
  words: readonly string[],
  ctx: AskContext,
  asked?: AskAgg,
): { m: Match | null; rest: string[] } {
  const content = words.filter((w) => !FILLER.has(w));
  if (!content.length) return { m: null, rest: [] };
  let whole: { m: Match; rest: string[] } | null = null;
  for (const t of content.length === words.length ? [content] : [[...words], content]) {
    const m = matchMeasure(t.join(" "), ctx, asked);
    if (!m) continue;
    const rest = uncovered(t, m.covers);
    if (!rest.length) return { m, rest };
    whole ??= { m, rest };
  }
  if (content.length <= 8)
    for (let len = content.length - 1; len >= 1; len--) {
      let best: { m: Match; at: number } | null = null;
      for (let at = 0; at + len <= content.length; at++) {
        const span = content.slice(at, at + len);
        // A run of only generic words ("net", "total amount") says too little to name a measure.
        if (span.flatMap((w) => tokenize(w)).every((t) => GENERIC_TOKENS.has(t))) continue;
        const m = matchMeasure(span.join(" "), ctx, asked);
        if (m && !uncovered(span, m.covers).length && (!best || m.score > best.m.score)) best = { m, at };
      }
      if (best) return { m: best.m, rest: [...content.slice(0, best.at), ...content.slice(best.at + len)] };
    }
  return whole ?? { m: null, rest: content };
}

// ---------------------------------------------------------------- KPI names, periods and values

interface KpiPhrase {
  id: string;
  canon: string[];
}

const kpiPhraseCache = new WeakMap<AskContext["kpis"], KpiPhrase[]>();

/**
 * Every name a KPI goes by, as canonical tokens, longest first: its name, the
 * name without a bracket ("Gross sales"), a bracketed acronym ("GMV") and its
 * short name ("AOV").
 */
function kpiPhrases(ctx: AskContext): KpiPhrase[] {
  const cached = kpiPhraseCache.get(ctx.kpis);
  if (cached) return cached;
  const out: KpiPhrase[] = [];
  for (const k of ctx.kpis) {
    if (!k.available || k.hidden) continue;
    const names = new Set([k.name, k.name.replace(/\([^)]*\)/g, " "), ...(k.short ? [k.short] : [])]);
    for (const m of k.name.matchAll(/\(([A-Z0-9]{2,})\)/g)) names.add(m[1] as string);
    for (const n of names) {
      const canon = canonOf(n);
      if (canon.length) out.push({ id: k.id, canon });
    }
  }
  out.sort((a, b) => b.canon.length - a.canon.length);
  kpiPhraseCache.set(ctx.kpis, out);
  return out;
}

const columnPhraseCache = new WeakMap<readonly ColumnProfile[], string[][]>();

/**
 * True when the words [i, j) sit inside a longer column name written out in
 * full: "opening mrr" is the Opening MRR column, not the MRR KPI with an
 * extra word.
 */
function insideColumnName(words: readonly Word[], i: number, j: number, ctx: AskContext): boolean {
  let names = columnPhraseCache.get(ctx.profile.columns);
  if (!names) {
    names = ctx.profile.columns.map((c) => canonOf(c.name)).filter((n) => n.length >= 2);
    columnPhraseCache.set(ctx.profile.columns, names);
  }
  for (const n of names)
    for (let a = Math.max(0, i - n.length + 1); a <= i; a++) {
      const b = canonAt(words, a, n);
      if (b >= j && b - a > j - i) return true;
    }
  return false;
}

/** The word before `i`, passing over articles ("by the region"). */
function before(words: readonly Word[], i: number): Word | undefined {
  let j = i - 1;
  while (j >= 0 && ARTICLES.has((words[j] as Word).w)) j--;
  return words[j];
}

/**
 * True when the word at `i` names a grouping: it follows "by", "per" or
 * "across", or "top 10" ("top 10 customers by revenue").
 */
function afterBy(words: readonly Word[], i: number): boolean {
  const prev = before(words, i)?.w ?? "";
  if (BY_LIKE.has(prev)) return true;
  const at = words.indexOf(before(words, i) as Word);
  return /^\d{1,3}$/.test(prev) && /^(top|best|first|bottom|worst|which)$/.test(words[at - 1]?.w ?? "");
}

/**
 * Whole KPI names, folded into one word each (longest first), before any
 * other reading: "average order value" is the AOV KPI, not an average of the
 * order value column, and the "per" of "revenue per customer" is not a "by".
 * A one-word name right after "by" is left alone ("revenue by customer"
 * groups by the customer column, even with a Customers KPI); a longer one is
 * the measure of "top 5 products by average order value".
 */
function foldKpis(words: Word[], ctx: AskContext): Word[] {
  let out = words;
  for (const p of kpiPhrases(ctx))
    for (let i = 0; i < out.length; i++) {
      // "net revenue" with only a Revenue KPI: the whole phrase is matched later, where the
      // template's synonyms can tell whether "net" changes what is measured.
      // So is "average discount": a column is averaged, which a total KPI can't be.
      if (
        p.canon.length === 1 &&
        (afterBy(out, i) ||
          /^(net|gross|average|avg|mean|median|minimum|maximum|min|max|lowest|highest)$/.test(
            out[i - 1]?.w ?? "",
          ))
      )
        continue;
      const j = canonAt(out, i, p.canon);
      if (j < 0 || insideColumnName(out, i, j, ctx)) continue;
      const kpiWord: Word = {
        w: out
          .slice(i, j)
          .map((x) => x.w)
          .join(" "),
        canon: [],
        kpi: p.id,
      };
      out = [...out.slice(0, i), kpiWord, ...out.slice(j)];
    }
  return out;
}

const MONTH_WORDS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const GRAIN_OF: Record<string, TimeGrain> = {
  day: "day",
  days: "day",
  week: "week",
  weeks: "week",
  month: "month",
  months: "month",
  quarter: "quarter",
  quarters: "quarter",
  year: "year",
  years: "year",
};

interface Period {
  from: number;
  to: number;
  label: string;
  /** A whole calendar period ("2026", "Q3 2026", "September 2026") has its grain. */
  grain?: TimeGrain;
  /** How a relative or incomplete period was read, for the notes. */
  note?: string;
}

const yearAt = (w: Word | undefined): number | null =>
  live(w) && /^(?:19|20)\d{2}$/.test(w.w) ? Number(w.w) : null;

/**
 * A period named at `i`: a year ("2026"), a month with or without its year
 * ("September 2026", "in Sep"), a quarter ("Q3 2026"), this or last
 * year/quarter/month/week, the last N days/weeks/months/years, or year to
 * date. Relative periods count back from the latest date in the data, as the
 * dashboard's presets do, and say so in a note. A month or quarter without a
 * year needs a word such as "in" before it ("may" is also a verb).
 */
function periodAt(
  words: readonly Word[],
  i: number,
  bounds: { min: number; max: number } | null,
): { end: number; period: Period } | null {
  const w = words[i];
  if (!live(w)) return null;
  const prep = PREP.has(before(words, i)?.w ?? "");
  const y = yearAt(w);
  if (y !== null)
    return {
      end: i + 1,
      period: { from: Date.UTC(y, 0, 1), to: Date.UTC(y + 1, 0, 1) - 1, label: String(y), grain: "year" },
    };
  const month = (yr: number, m: number): Period => ({
    from: Date.UTC(yr, m, 1),
    to: Date.UTC(yr, m + 1, 1) - 1,
    label: `${MONTHS_LONG[m]} ${yr}`,
    grain: "month",
  });
  // The latest year with that month (or quarter) in the data.
  const latestYear = (m: number) => {
    if (!bounds) return null;
    const last = new Date(bounds.max);
    const yr = m > last.getUTCMonth() ? last.getUTCFullYear() - 1 : last.getUTCFullYear();
    return Date.UTC(yr, m + 1, 1) - 1 < bounds.min ? null : yr;
  };
  const m = MONTH_WORDS[w.w];
  if (m !== undefined) {
    const yy = yearAt(words[i + 1]);
    if (yy !== null) return { end: i + 2, period: month(yy, m) };
    const yr = prep ? latestYear(m) : null;
    if (yr === null) return null;
    return {
      end: i + 1,
      period: {
        ...month(yr, m),
        note: `"${w.w}" was read as ${MONTHS_LONG[m]} ${yr}, the latest ${MONTHS_LONG[m]} in your data.`,
      },
    };
  }
  const q = /^q([1-4])$/.exec(w.w);
  if (q) {
    const first = (Number(q[1]) - 1) * 3;
    const quarter = (yr: number): Period => ({
      from: Date.UTC(yr, first, 1),
      to: Date.UTC(yr, first + 3, 1) - 1,
      label: `Q${q[1]} ${yr}`,
      grain: "quarter",
    });
    const yy = yearAt(words[i + 1]);
    if (yy !== null) return { end: i + 2, period: quarter(yy) };
    const yr = prep ? latestYear(first + 2) : null;
    if (yr === null) return null;
    return {
      end: i + 1,
      period: { ...quarter(yr), note: `"${w.w}" was read as Q${q[1]} ${yr}, the latest one in your data.` },
    };
  }
  if (!bounds) return null;
  const latest = `the latest date in your data is ${formatDay(bounds.max)}`;
  // "this year", "last month", "previous quarter".
  const unit = GRAIN_OF[words[i + 1]?.w ?? ""];
  if (unit && unit !== "day" && live(words[i + 1]) && /^(this|current|last|previous|prior)$/.test(w.w)) {
    const current = truncate(bounds.max, unit);
    const start = /^(this|current)$/.test(w.w) ? current : truncate(current - 1, unit);
    const label =
      unit === "year" || unit === "quarter" || unit === "month"
        ? bucketLabel(start, unit, true)
        : `the week of ${formatDay(start)}`;
    return {
      end: i + 2,
      period: {
        from: start,
        to: endOfBucket(start, unit),
        label,
        grain: unit,
        note: `"${w.w} ${words[i + 1]?.w}" was read as ${label}: ${latest}.`,
      },
    };
  }
  // "last 12 months", "past 30 days".
  const n = /^\d{1,3}$/.test(words[i + 1]?.w ?? "") ? Number(words[i + 1]?.w) : NaN;
  const nUnit = GRAIN_OF[words[i + 2]?.w ?? ""];
  if (
    /^(last|past|previous|trailing)$/.test(w.w) &&
    n > 0 &&
    nUnit &&
    nUnit !== "quarter" &&
    live(words[i + 1]) &&
    live(words[i + 2])
  ) {
    const to = endOfDay(bounds.max);
    const from =
      nUnit === "day"
        ? addDays(startOfDay(bounds.max), -(n - 1))
        : nUnit === "week"
          ? addDays(startOfDay(bounds.max), -(7 * n - 1))
          : startOfMonth(addMonths(bounds.max, -(nUnit === "year" ? 12 * n : n) + 1));
    const shown = Math.max(from, startOfDay(bounds.min));
    const label = `${w.w} ${n} ${words[i + 2]?.w} (${formatRange(shown, to)})`;
    return {
      end: i + 3,
      period: {
        from,
        to,
        label,
        note: `"${label.split(" (")[0]}" counts back from the latest date in your data (${formatDay(bounds.max)}).`,
      },
    };
  }
  // "year to date", "ytd".
  if (w.w === "ytd" || (w.w === "year" && words[i + 1]?.w === "to" && words[i + 2]?.w === "date")) {
    const from = truncate(bounds.max, "year");
    return {
      end: w.w === "ytd" ? i + 1 : i + 3,
      period: {
        from,
        to: endOfDay(bounds.max),
        label: `year to date (${formatRange(from, endOfDay(bounds.max))})`,
        note: `Year to date runs to the latest date in your data (${formatDay(bounds.max)}).`,
      },
    };
  }
  return null;
}

interface ValuePhrase {
  column: string;
  value: string;
  canon: string[];
  distinct: number;
}

const valueCache = new WeakMap<readonly ColumnProfile[], ValuePhrase[]>();

/**
 * The values of the text categories a request can filter on (dimensions and
 * places, from the profile, so never a hidden column), longest names first.
 * Numbers, single letters and everyday words ("All", "Other") are left out.
 */
function valuePhrases(ctx: AskContext): ValuePhrase[] {
  const cols = ctx.profile.columns;
  const cached = valueCache.get(cols);
  if (cached) return cached;
  const out: ValuePhrase[] = [];
  for (const c of cols) {
    if (c.storage !== "string" || (c.role !== "dimension" && c.role !== "geo")) continue;
    for (const { value } of c.categorical?.all ?? c.categorical?.top ?? []) {
      const canon = canonOf(value);
      const one = canon.length === 1 ? (canon[0] as string) : null;
      if (
        !canon.length ||
        canon.every((t) => /^\d+$/.test(t)) ||
        (one !== null && (one.length < 2 || FILLER.has(one) || NOT_VALUES.has(one)))
      )
        continue;
      out.push({ column: c.name, value, canon, distinct: c.distinct });
    }
  }
  out.sort((a, b) => b.canon.length - a.canon.length);
  valueCache.set(cols, out);
  return out;
}

/** The column some words name, read as a "by" would read them; null when they name none. */
function columnNamed(words: readonly Word[], ctx: AskContext): string | null {
  if (!words.length || !words.every((w) => live(w) && w.canon.length && !FILLER.has(w.w))) return null;
  const r = matchBy(words.map((w) => w.w).join(" "), ctx);
  return r?.by.kind === "column" ? r.by.column : null;
}

/**
 * Periods and category values named in the request become filters, and
 * their words are taken: "in Maharashtra", "for Apparel", "where channel is
 * Website", "cancelled", "in September 2026", "last 12 months". A value
 * after "by" names a grouping instead; one without a word such as "in"
 * before it is taken only when it isn't also the name of a measure. When a
 * value is in two columns, the one named next to it wins, else the coarser.
 */
function takeFilters(
  words: Word[],
  ctx: AskContext,
  notes: string[],
  unmatched: string[],
): { filters: Filter[]; labels: string[]; grain?: TimeGrain } {
  const filters: Filter[] = [];
  const labels: string[] = [];
  let grain: TimeGrain | undefined;
  const take = (from: number, to: number) => {
    for (let j = from; j < to; j++) (words[j] as Word).used = true;
  };
  /** Takes the word such as "in" before `i` (and the articles after it). */
  const takePrep = (i: number) => {
    let j = i - 1;
    while (j >= 0 && ARTICLES.has((words[j] as Word).w)) j--;
    if (j >= 0 && live(words[j]) && PREP.has((words[j] as Word).w)) take(j, i);
  };

  // Periods.
  const date = ctx.dateColumn;
  const dc = date ? col(ctx, date) : undefined;
  const bounds = dc?.temporal ? { min: dc.temporal.min, max: dc.temporal.max } : null;
  const periods: Array<{ period: Period; words: string }> = [];
  if (date)
    for (let i = 0; i < words.length; i++) {
      const p = periodAt(words, i, bounds);
      if (!p) continue;
      periods.push({
        period: p.period,
        words: words
          .slice(i, p.end)
          .map((w) => w.w)
          .join(" "),
      });
      take(i, p.end);
      takePrep(i);
    }
  if (date && periods.length) {
    // Periods that touch or overlap read as one ("2025 and 2026", "this year vs last year"); two
    // apart can't be one filter, so the later one is reported.
    const sorted = [...periods].sort((a, b) => a.period.from - b.period.from);
    const span = { ...(sorted[0] as (typeof sorted)[number]).period };
    const parts = [span.label];
    let apart = false;
    for (const p of sorted.slice(1)) {
      if (p.period.from <= span.to + 1) {
        span.to = Math.max(span.to, p.period.to);
        parts.push(p.period.label);
      } else {
        apart = true;
        unmatched.push(p.words);
      }
    }
    if (apart)
      notes.push(
        "Name one period, or periods next to each other: to compare periods far apart, ask by year or by month.",
      );
    filters.push({ kind: "dateRange", column: date, from: span.from, to: span.to });
    labels.push(`${friendly(date)}: ${parts.join(" and ")}`);
    for (const p of periods) if (p.period.note) notes.push(p.period.note);
    // A period the data doesn't reach answers with no rows: say why before the answer does.
    if (bounds && (span.to < bounds.min || span.from > bounds.max))
      notes.push(
        `Your data runs from ${formatDay(bounds.min)} to ${formatDay(bounds.max)}, so ${parts.join(" and ")} has no rows.`,
      );
    // Two or more whole periods of one grain are compared with each other: by that grain.
    const grains = new Set(periods.map((p) => p.period.grain));
    const only = [...grains][0];
    if (periods.length > 1 && !apart && grains.size === 1 && only) grain = only;
  }

  // Values of categories.
  const phrases = valuePhrases(ctx);
  const values = new Map<string, string[]>();
  for (let i = 0; i < words.length; i++) {
    if (!live(words[i]) || afterBy(words, i)) continue;
    let end = -1;
    let hits: ValuePhrase[] = [];
    for (const p of phrases) {
      if (end >= 0 && p.canon.length < (hits[0] as ValuePhrase).canon.length) break;
      const j = canonAt(words, i, p.canon);
      if (j < 0) continue;
      end = j;
      hits.push(p);
    }
    if (end < 0 || insideColumnName(words, i, end, ctx)) continue;
    // The column named next to the value: "Apparel category", "where channel is Website".
    const after = (c: string) => {
      for (let n = Math.min(3, words.length - end); n >= 1; n--)
        if (columnNamed(words.slice(end, end + n), ctx) === c) return n;
      return 0;
    };
    const ahead = (c: string) => {
      let k = i;
      while (k > 0 && live(words[k - 1]) && LINK.has((words[k - 1] as Word).w)) k--;
      for (let n = 3; n >= 1; n--)
        if (k - n >= 0 && columnNamed(words.slice(k - n, k), ctx) === c) return { from: k - n, to: i };
      return null;
    };
    const named = hits.filter((h) => after(h.column) || ahead(h.column));
    if (named.length) hits = named;
    const columns = [...new Set(hits.map((h) => h.column))];
    const hit = [...hits].sort((a, b) => a.distinct - b.distinct)[0] as ValuePhrase;
    const text = words
      .slice(i, end)
      .map((w) => w.w)
      .join(" ");
    const prepBefore = PREP.has(before(words, i)?.w ?? "");
    const n = after(hit.column);
    const a = ahead(hit.column);
    // A bare word that also names a measure (a KPI, or a column of numbers: "revenue", "sales") is
    // that measure, not a value. A date column is no measure ("delivered" is a status, not Delivery Date).
    if (!prepBefore && !n && !a) {
      const m = matchMeasure(text, ctx);
      const c = m?.column ? col(ctx, m.column) : undefined;
      const measure =
        m?.measure || (c && c.storage === "number" && c.role !== "identifier" && c.role !== "dimension");
      if (m && measure && m.score >= 0.8 && !uncovered(text.split(" "), m.covers).length) continue;
    }
    take(i, end);
    if (n) take(end, end + n);
    if (a) {
      take(a.from, a.to);
      takePrep(a.from);
    } else takePrep(i);
    // "Enterprise customers": a one-word KPI name right after the value describes it (the rows are
    // the Enterprise segment's), so it isn't a second thing to measure.
    if (
      words[end + n]?.kpi &&
      kpiPhrases(ctx).some((p) => p.id === words[end + n]?.kpi && p.canon.length === 1)
    )
      (words[end + n] as Word).descriptor = true;
    if (columns.length > 1)
      notes.push(
        `"${text}" is a value of ${columns.map(friendly).join(" and ")}: ${friendly(hit.column)} was used.`,
      );
    const list = values.get(hit.column) ?? [];
    if (!list.includes(hit.value)) list.push(hit.value);
    values.set(hit.column, list);
    i = end - 1;
  }
  for (const [column, vals] of values) {
    filters.push({ kind: "in", column, values: vals });
    labels.push(`${friendly(column)}: ${vals.join(", ")}`);
  }
  return { filters, labels, ...(grain ? { grain } : {}) };
}

/** Splits words at the live words `isSep` accepts (and at "vs" phrases when `vs` is set). */
function splitWords(
  words: readonly Word[],
  isSep: (w: Word) => boolean,
  vs = false,
): { parts: Word[][]; versus: boolean } {
  const parts: Word[][] = [[]];
  let versus = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as Word;
    const v = vs ? VS_SEQS.map((s) => seqAt(words, i, s)).find((e) => e >= 0) : undefined;
    if (v !== undefined) {
      versus = true;
      parts.push([]);
      i = v - 1;
      continue;
    }
    if (live(w) && isSep(w)) {
      parts.push([]);
      continue;
    }
    (parts[parts.length - 1] as Word[]).push(w);
  }
  return { parts: parts.filter((p) => p.length), versus };
}

/** The words not yet taken (a KPI's name included, unless it only describes a value), as typed. */
const untaken = (words: readonly Word[]) => words.filter((w) => !w.used && !w.descriptor).map((w) => w.w);

/** Text of words for a message: as typed, without what was taken or is filler. */
const said = (words: readonly Word[]) =>
  words
    .filter((w) => !w.descriptor && (w.kpi || (!w.used && !FILLER.has(w.w))))
    .map((w) => w.w)
    .join(" ");

/**
 * True when a chart-type word at `i` is part of a column's name, or of a
 * template word for one ("product line", "sales area"), or names a column
 * right after "by", so it is not a chart type.
 */
function partOfName(words: readonly Word[], i: number, ctx: AskContext): boolean {
  const t = (words[i] as Word).canon[0];
  if (!t) return false;
  const near = [words[i - 1], words[i + 1]].filter((w): w is Word => live(w)).flatMap((w) => w.canon);
  if (
    ctx.profile.columns.some(
      (c) =>
        c.tokens.includes(t) &&
        (near.some((x) => x !== t && c.tokens.includes(x)) || (c.tokens.length === 1 && afterBy(words, i))),
    )
  )
    return true;
  return Boolean(
    (i > 0 && columnNamed(words.slice(i - 1, i + 1), ctx)) || columnNamed(words.slice(i, i + 2), ctx),
  );
}

/**
 * True when a chart word at `i` is meant as a chart type in a question:
 * "pie", "heatmap" always; an everyday noun such as "line" or "table" only
 * next to "chart" ("line chart") or after "as a" ("as a table").
 */
function chartWordInQuestion(words: readonly Word[], i: number, end: number): boolean {
  if (!AMBIGUOUS_KINDS.has((words[i] as Word).w)) return true;
  return CHART_NOUNS.has(words[end]?.w ?? "") || CHART_LEADS.has(words[i - 1]?.w ?? "");
}

export interface ReadOptions {
  /** Reading a business question (step 5) rather than a chart request: the notes speak to that page. */
  question?: boolean;
}

/**
 * Reads a request such as "average customer rating by region or city",
 * "total sales and total profit by month", "sales vs profit by state",
 * "top 5 products by quantity", "revenue by category split by channel" or
 * "net revenue in Maharashtra in 2026".
 */
export function readAsk(text: string, ctx: AskContext, opts: ReadOptions = {}): AskReading {
  const notes: string[] = [];
  const unmatched: string[] = [];
  const words = foldKpis(toWords(normalise(text)), ctx);

  // Top N: "top 5 products by quantity" (the category comes first) or "revenue of the top 5 products".
  let topN: number | undefined;
  let topAt = -1;
  let topEnd = -1;
  for (let i = 0; i < words.length && topAt < 0; i++) {
    const end = seqAt(words, i, ["top|best|first"]);
    const n = Number(words[i + 1]?.w);
    if (end < 0 || !live(words[i + 1]) || !/^\d{1,3}$/.test(words[i + 1]?.w ?? "")) continue;
    topN = Math.min(50, Math.max(3, n));
    topAt = i;
    topEnd = i + 2;
    (words[i] as Word).used = true;
    (words[i + 1] as Word).used = true;
  }

  // The chart type: the first kind named, unless the word belongs to a column's name ("product line").
  let kind: ChartKind | undefined;
  for (const [seq, k] of KIND_WORDS) {
    for (let i = 0; i < words.length && !kind; i++) {
      const end = seqAt(words, i, seq);
      if (end < 0 || (seq.length === 1 && partOfName(words, i, ctx))) continue;
      if (opts.question && !chartWordInQuestion(words, i, end)) continue;
      // "stacked by" starts a split; the split is read below.
      if (k === "stackedBar" && words[end]?.w === "by") continue;
      kind = k;
      for (let j = i; j < end; j++) (words[j] as Word).used = true;
    }
    if (kind) break;
  }

  const { filters, labels: filterLabels, grain: periodGrain } = takeFilters(words, ctx, notes, unmatched);

  // The split ends the request; the "by" part follows the first "by" (or "per", "across"…).
  let body = words;
  let splitPart: Word[] = [];
  const sp = findSeq(words, SPLIT_SEQS);
  if (sp) {
    splitPart = words.slice(sp.end);
    body = words.slice(0, sp.at);
  }
  let measurePart = body;
  let byPart: Word[] = [];
  const bm = findSeq(body, BY_SEQS);
  // "net revenue split by channel over time": the "by" part follows the split.
  const late = bm ? null : findSeq(splitPart, BY_SEQS);
  if (late) {
    const over = splitPart[late.at]?.w === "over";
    byPart = splitPart.slice(late.end);
    splitPart = splitPart.slice(0, late.at);
    if (over && !byPart.some((w) => w.kpi || (live(w) && !FILLER.has(w.w))))
      byPart = [{ w: "time", canon: ["time"] }];
  } else if (bm) {
    measurePart = body.slice(0, bm.at);
    byPart = body.slice(bm.end);
    // "over time" / "over the months": the time words; a bare "over" means over time.
    if (body[bm.at]?.w === "over" && !byPart.some((w) => w.kpi || (live(w) && !FILLER.has(w.w))))
      byPart = [{ w: "time", canon: ["time"] }];
    // "top 5 products by quantity": the category sits between "top 5" and "by".
    if (topAt >= 0 && topAt < bm.at && !body.slice(topEnd, bm.at).some((w) => w.kpi)) {
      byPart = body.slice(topEnd, bm.at);
      measurePart = [...body.slice(0, topAt), ...body.slice(bm.end)];
    }
  } else if (topAt >= 0 && topAt < body.length) {
    // "net revenue of the top 5 products".
    measurePart = body.slice(0, topAt);
    byPart = body.slice(topEnd);
  } else {
    // "monthly sales", "sales trend", "sales over time" without "by".
    const tw = body.findIndex((w) => live(w) && TIME_WORDS.has(w.w));
    if (tw >= 0) {
      const t = (body[tw] as Word).w;
      // "trend" means over time; it is also a filler word elsewhere, so it is translated here.
      byPart = [{ w: t === "trend" || t === "trends" ? "time" : t, canon: [] }];
      measurePart = body.filter((_, i) => i !== tw);
    }
  }

  // Measures: "A and B", "A, B", "A vs B".
  const { parts: terms, versus } = splitWords(measurePart, (w) => JOINERS.has(w.w), true);
  const measures: AskMeasure[] = [];
  const labels: string[] = [];
  const addKpi = (id: string, agg: AskAgg | undefined) => {
    const k = ctx.kpis.find((x) => x.id === id);
    if (!k) return;
    const rate = k.format === "percent" || k.format === "ratio" || k.format === "decimal";
    measures.push({ kind: "kpi", id });
    labels.push(k.name);
    if (agg === "sum" && rate)
      notes.push(`${k.name} is a rate, so it is shown as defined: it can't be totalled.`);
    // "How many orders" is the Orders KPI itself; an average of a rate is the rate. Otherwise say why the
    // KPI's own definition is used rather than the aggregation asked.
    else if (agg && agg !== "sum" && !(agg === "count" && k.format === "integer") && !(agg === "avg" && rate))
      notes.push(
        opts.question
          ? `${k.name} is one of your KPIs, so it is shown as defined, not as the ${AGG_ASKED[agg]} you asked for.`
          : `${k.name} is one of your KPIs, so it is shown exactly as defined. To take the ${AGG_ASKED[agg]} of a column instead, pick the column under Measure.`,
      );
  };
  for (const term of terms) {
    let agg: AskAgg | undefined;
    for (const [seq, a] of AGG_WORDS)
      for (let i = 0; i < term.length; i++) {
        const end = seqAt(term, i, seq);
        if (end < 0) continue;
        agg ??= a;
        for (let j = i; j < end; j++) (term[j] as Word).used = true;
      }
    // A KPI word that only describes a value ("Enterprise customers") comes last: the other is measured.
    const kpiWords = [
      ...term.filter((w) => w.kpi && !w.descriptor),
      ...term.filter((w) => w.kpi && w.descriptor),
    ];
    const rest = term.filter(live).map((w) => w.w);
    const content = rest.filter((w) => !FILLER.has(w));
    if (kpiWords.length) {
      // One measure per phrase: a second KPI name without "and" is reported rather than guessed.
      const [first, ...extra] = kpiWords;
      addKpi((first as Word).kpi as string, agg);
      const unplaced = [...extra.filter((w) => !w.descriptor).map((w) => w.w), ...content];
      if (unplaced.length) unmatched.push(unplaced.join(" "));
      continue;
    }
    if (!content.length || content.every((w) => ROW_WORDS.has(w))) {
      if (agg === "count" || content.length) {
        measures.push({ kind: "column", column: "", agg: "count" });
        labels.push("Rows");
      }
      continue;
    }
    const { m, rest: left } = matchTerm(rest, ctx, agg);
    if (left.length) unmatched.push(left.join(" "));
    if (!m) continue;
    if (m.measure?.kind === "kpi") {
      addKpi(m.measure.id, agg);
      continue;
    }
    const c = m.column ? col(ctx, m.column) : undefined;
    if (!c) continue;
    const a = fitAgg(c, agg, notes);
    const termText = content.join(" ");
    // A KPI named like the column ("Revenue" for the Revenue column) is the same total with the
    // template's definition and format, so it is used instead of a new "Total Revenue".
    const sameKpi =
      a === "sum"
        ? ctx.kpis.find(
            (k) =>
              k.available &&
              !k.hidden &&
              k.format !== "percent" &&
              k.format !== "ratio" &&
              nameSimilarity(tokenize(k.name), c.name) >= 0.95,
          )
        : undefined;
    if (sameKpi) {
      measures.push({ kind: "kpi", id: sameKpi.id });
      labels.push(sameKpi.name);
      if (!tokenize(termText).every((t) => c.tokens.includes(t)))
        notes.push(`"${termText}" was read as your ${sameKpi.name} KPI (the ${friendly(c.name)} column).`);
      continue;
    }
    measures.push({ kind: "column", column: c.name, agg: a });
    labels.push(a === "count" ? "Rows" : `${AGG_LABEL[a]} ${friendly(c.name)}`);
    if (m.label !== c.name || !tokenize(termText).every((t) => c.tokens.includes(t)))
      notes.push(`"${termText}" was read as your ${friendly(c.name)} column.`);
  }

  // What to show it by: "region or city" takes the first that exists, and mentions the others.
  const pick = (ws: Word[]) => {
    const options = splitWords(ws, (w) => w.w === "or").parts.filter((o) => said(o));
    for (const [i, o] of options.entries()) {
      const typed = untaken(o);
      const content = typed.filter((w) => !FILLER.has(w));
      for (const t of content.length === typed.length ? [typed] : [typed, content]) {
        const r = matchBy(t.join(" "), ctx);
        if (!r) continue;
        const left = uncovered(t, r.covers);
        if (left.length) unmatched.push(left.join(" "));
        if (options.length > 1)
          notes.push(
            `You said ${options.map((x) => `"${said(x)}"`).join(" or ")}: ${r.label} is used${i ? " (the first wasn't found)" : ""}. Switch it under "By".`,
          );
        return r;
      }
    }
    if (options.length) unmatched.push(said(ws));
    return null;
  };
  let by: AskBy = { kind: "none" };
  let byLabel = "";
  let split: string | undefined;
  const byTerms = splitWords(byPart, (w) => JOINERS.has(w.w) || w.w === "by").parts.filter((t) => said(t));
  const first = byTerms[0] ? pick(byTerms[0]) : null;
  if (first) {
    by = first.by;
    byLabel = first.label;
  }
  // "net revenue this year vs last year": the periods named are compared, so they are the grouping.
  if (by.kind === "none" && periodGrain && ctx.dateColumn && !byTerms.length) {
    by = { kind: "time", column: ctx.dateColumn, grain: periodGrain };
    byLabel = periodGrain;
  }
  const secondWords = splitPart.length ? splitPart : byTerms[1];
  const second = secondWords && said(secondWords) ? pick(secondWords) : null;
  if (second?.by.kind === "column") split = second.by.column;
  else if (second) {
    // "by courier and month": a period with a category. A chart shows it over time, split by the
    // category; a question answers one grouping, and says which was left out.
    if (!opts.question && second.by.kind !== "none" && by.kind === "column") {
      split = by.column;
      by = second.by;
      notes.push(`Shown by ${second.label}, split by ${friendly(split)}.`);
      byLabel = second.label;
    } else
      notes.push(
        opts.question
          ? `Questions are answered by one grouping at a time, so "${second.label}" was left out: ask for a chart on the dashboard to see both.`
          : `Only one of the two can be a time or date part, so "${second.label}" was left out.`,
      );
  }
  for (const extra of byTerms.slice(splitPart.length ? 1 : 2))
    notes.push(`Only two groupings fit in one chart, so "${said(extra)}" was left out.`);

  const ask: ChartAsk = {
    measures,
    by,
    ...(split ? { split } : {}),
    ...(topN ? { topN, others: false } : {}),
    ...(kind ? { kind } : {}),
    ...(versus ? { versus } : {}),
    ...(filters.length ? { filters } : {}),
  };
  const what = labels.length ? labels.join(versus ? " vs " : " and ") : "Nothing to measure yet";
  const understood = `${what}${byLabel ? (by.kind === "time" && byLabel === "over time" ? " over time" : ` by ${byLabel}`) : ""}${split ? `, split by ${friendly(split)}` : ""}`;
  return { ask, understood, unmatched: [...new Set(unmatched.filter(Boolean))], notes, filterLabels };
}

// ---------------------------------------------------------------- designing the chart

/** Unit family: measures of different families never share an axis. */
function unitOf(m: AskMeasure, cm: ChartMeasure, ctx: AskContext): string {
  if (m.kind === "column" && (m.agg === "avg" || m.agg === "median" || m.agg === "min" || m.agg === "max")) {
    const c = col(ctx, m.column);
    // An average of a score or rate is on its own scale (1–5, %): it gets a chart of its own.
    if (c && (c.role === "rate" || c.role === "percentage")) return `scale:${c.name}`;
  }
  if (cm.format === "currency") return "currency";
  if (cm.format === "percent" || cm.format === "ratio") return "share";
  if (cm.format === "days") return "days";
  return "number";
}

const additive = (m: AskMeasure) =>
  m.kind === "kpi" || m.agg === "sum" || m.agg === "count" || m.agg === "countDistinct";

/** Most useful category to show measures by when none was asked and there is no date. */
function defaultCategory(ctx: AskContext): ColumnProfile | undefined {
  return ctx.profile.columns
    .filter(
      (c) =>
        (c.role === "dimension" || c.role === "geo") &&
        c.storage === "string" &&
        c.distinct >= 2 &&
        c.distinct <= 30,
    )
    .sort((a, b) => (b.distinct >= 3 ? 1 : 0) - (a.distinct >= 3 ? 1 : 0) || a.distinct - b.distinct)[0];
}

export function axisFor(by: AskBy): ResolvedAxis {
  switch (by.kind) {
    case "time":
      return { kind: "time", column: by.column, grain: by.grain, label: friendly(by.column) };
    case "part":
      return {
        kind: "part",
        column: by.column,
        part: by.part,
        label:
          by.part === "dow"
            ? "Weekday"
            : by.part === "hour"
              ? "Hour of day"
              : by.part === "month"
                ? "Month"
                : "Day of month",
      };
    case "column":
      return { kind: "column", column: by.column, label: friendly(by.column) };
    case "none":
      return { kind: "none" };
  }
}

/**
 * Designs the chart(s) for an ask. `newId` gives each chart a fresh id.
 * Returns an error instead of charts when there is nothing to measure or
 * nothing to show it by.
 */
export function designAsk(ask: ChartAsk, ctx: AskContext, newId: () => string): AskDesign {
  const notes: string[] = [];
  const pairs = ask.measures
    .map((m) => ({ m, cm: askMeasure(m, ctx) }))
    .filter((p): p is { m: AskMeasure; cm: ChartMeasure } => Boolean(p.cm));
  if (!pairs.length) return { charts: [], notes, error: "Choose at least one thing to measure." };

  let by = ask.by;
  if (by.kind === "none") {
    if (ctx.dateColumn) {
      by = { kind: "time", column: ctx.dateColumn, grain: "auto" };
      notes.push(`Nothing to show it by was given, so it is shown over time (${friendly(ctx.dateColumn)}).`);
    } else {
      const d = defaultCategory(ctx);
      if (!d)
        return {
          charts: [],
          notes,
          error: "Choose what to show it by: a category, a date or the hour of day.",
        };
      by = { kind: "column", column: d.name };
      notes.push(`Nothing to show it by was given, so it is shown by ${friendly(d.name)}.`);
    }
  }
  const x = axisFor(by);
  const xLabel = "label" in x ? x.label : "";
  const xCol = col(ctx, by.column);
  const split =
    ask.split && ask.split !== (by.kind === "column" ? by.column : "") ? col(ctx, ask.split) : undefined;
  const geoState =
    xCol?.geoLevel === "state" && (xCol.geoRegion === "IN" || xCol.geoRegion === "US")
      ? xCol.geoRegion
      : undefined;

  // Groups that may share one axis.
  const groups: Array<typeof pairs> = [];
  if (ask.versus && pairs.length === 2 && x.kind === "column") groups.push(pairs);
  else {
    const byUnit = new Map<string, typeof pairs>();
    for (const p of pairs) {
      const u = unitOf(p.m, p.cm, ctx);
      byUnit.set(u, [...(byUnit.get(u) ?? []), p]);
    }
    for (const g of byUnit.values()) for (let i = 0; i < g.length; i += 4) groups.push(g.slice(i, i + 4));
    if (byUnit.size > 1)
      notes.push(
        `${[...byUnit.values()].map((g) => g.map((p) => p.cm.label).join(" and ")).join(" and ")} are on different scales, so they are drawn as separate charts side by side, never on two axes.`,
      );
    if (ask.versus && pairs.length === 2 && x.kind !== "column")
      notes.push(
        "A comparison of two measures needs a category to plot each point; showing them side by side instead.",
      );
  }

  const charts: DesignedChart[] = [];
  for (const g of groups) {
    const m = g.length;
    const allAdditive = g.every((p) => additive(p.m));
    const avg = !allAdditive;
    const scatter = ask.versus && m === 2 && x.kind === "column";
    // "Top 5 products" means those five: an Others bar would dwarf them and answer another question.
    const others = !scatter && ask.others !== false;
    const series =
      split && m === 1 && (x.kind === "column" || x.kind === "time" || x.kind === "part")
        ? axisFor({ kind: "column", column: split.name })
        : undefined;
    if (split && !series && charts.length === 0)
      notes.push(`Splitting by ${friendly(split.name)} needs a single measure, so the split was left out.`);

    let kind: ChartKind;
    let why: string;
    if (scatter) {
      kind = "scatter";
      why = `Each ${xCol?.name ?? "category"} is a point: ${g[0]?.cm.label} across, ${g[1]?.cm.label} up, so you can see whether they move together.`;
    } else if (series) {
      kind = allAdditive ? "stackedBar" : "heatmap";
      why = allAdditive
        ? `Stacked columns: each ${xLabel} split by ${friendly(split?.name ?? "")}, adding up to the total.`
        : `An average can't be stacked, so a heatmap shows it for every ${xLabel} × ${friendly(split?.name ?? "")} pair.`;
    } else if (x.kind === "time") {
      kind = m === 1 && allAdditive ? "bar" : "line";
      why =
        kind === "bar"
          ? "A total per period: one column per period, starting at zero."
          : m > 1
            ? "Several measures in the same unit over time: one line each, on one axis."
            : "An average over time: a line shows how it moves.";
    } else if (x.kind === "part") {
      kind = "bar";
      why = `One column per ${x.label.toLowerCase()}, in order, so the pattern through the ${x.part === "hour" ? "day" : x.part === "dow" ? "week" : "year"} shows.`;
    } else if (m === 1 && geoState && allAdditive) {
      kind = "geoTile";
      why = `${friendly(xCol?.name ?? "")} holds states, so a tile map shows where it comes from.`;
    } else {
      kind = m <= 2 ? "hbar" : "bar";
      why =
        m === 1
          ? `Sorted bars, largest first${avg ? " (an average, so it is compared, never added up)" : ""}${(xCol?.distinct ?? Infinity) > (ask.topN ?? 10) ? `, top ${ask.topN ?? 10}${others ? " plus Others" : ""}` : ""}.`
          : `Grouped bars in the same unit, one colour per measure, top ${ask.topN ?? 10} by the first.`;
    }

    const draft = customSpec({
      id: newId(),
      title: "",
      kind,
      x,
      ...(series ? { series } : {}),
      measures: g.map((p) => p.cm),
      ...(x.kind === "column" ? { topN: ask.topN ?? 10, others } : {}),
    });
    if (geoState) draft.geoRegion = geoState;
    // Honour the type the user asked for when it suits the data; otherwise say why not.
    if (ask.kind && ask.kind !== kind) {
      if (
        isKindCompatible(ask.kind, draft) &&
        !(ask.kind === "donut" && (avg || (xCol?.distinct ?? 99) > MAX_DONUT_SLICES))
      )
        draft.kind = ask.kind;
      else if (charts.length === 0)
        notes.push(
          `A ${ask.kind === "geoTile" ? "map" : ask.kind} doesn't suit this data, so ${kind === "hbar" ? "sorted bars are" : `a ${kind} chart is`} used instead.`,
        );
    }
    const alternatives = (
      [
        "hbar",
        "bar",
        "line",
        "area",
        "stackedBar",
        "donut",
        "treemap",
        "table",
        "heatmap",
        "scatter",
      ] as ChartKind[]
    ).filter(
      (k) =>
        k !== draft.kind &&
        isKindCompatible(k, draft) &&
        !(k === "donut" && avg) &&
        !(k === "treemap" && avg),
    );
    const names = g.map((p) => p.cm.label).join(scatter ? " vs " : " and ");
    const title =
      x.kind === "time"
        ? `${names} over time`
        : x.kind === "part"
          ? `${names} by ${xLabel.toLowerCase()}`
          : `${names} by ${xLabel}`;
    charts.push({
      spec: {
        ...draft,
        title: series ? `${title}, split by ${friendly(split?.name ?? "")}` : title,
        reason: `${why} Asked by you.`,
        alternatives,
        ...(avg && x.kind === "column" ? { minGroupRows: 5 } : {}),
      },
      why,
    });
  }
  if (charts.some((c) => c.spec.minGroupRows))
    notes.push("Groups with fewer than 5 rows are set aside: an average of a handful of rows is noise.");
  return { charts, notes };
}

const AGG_ID = /^agg:(sum|avg|median|min|max|count|countDistinct):(.*)$/;

/**
 * The ask that would design `spec`, so an existing chart (asked, built or
 * recommended) can be changed in the Ask panel. Null for charts an ask can't
 * express (histogram bins, analyses).
 */
export function askFromSpec(spec: ChartSpec): ChartAsk | null {
  if (spec.analysis) return null;
  let by: AskBy;
  switch (spec.x.kind) {
    case "time":
      by = { kind: "time", column: spec.x.column, grain: spec.x.grain };
      break;
    case "part":
      by = { kind: "part", column: spec.x.column, part: spec.x.part };
      break;
    case "column":
      by = { kind: "column", column: spec.x.column };
      break;
    default:
      return null;
  }
  const measures: AskMeasure[] = spec.measures.map((m) => {
    const a = AGG_ID.exec(m.id);
    return a ? { kind: "column", column: a[2] as string, agg: a[1] as AskAgg } : { kind: "kpi", id: m.id };
  });
  return {
    measures,
    by,
    ...(spec.series?.kind === "column" ? { split: spec.series.column } : {}),
    ...(spec.topN ? { topN: spec.topN } : {}),
    ...(spec.x.kind === "column" && spec.others === false && spec.kind !== "scatter"
      ? { others: false }
      : {}),
    kind: spec.kind,
    ...(spec.kind === "scatter" ? { versus: true } : {}),
  };
}

/**
 * Example requests built from this file's own columns and KPIs, so every
 * suggestion can actually be drawn. At most four.
 */
export function askExamples(ctx: AskContext): string[] {
  const out: string[] = [];
  const cat = defaultCategory(ctx);
  const geo = ctx.profile.columns.find(
    (c) => c.role === "geo" && c.storage === "string" && c.distinct >= 3 && c.distinct <= 60,
  );
  const kpi = ctx.kpis.find((k) => k.available && !k.hidden);
  const money = ctx.profile.columns.filter((c) => c.role === "currency" && c.additivity !== "non-additive");
  const score = ctx.profile.columns.find((c) => c.role === "rate");
  const time = ctx.profile.columns.find((c) => c.role === "time");
  if (score && (geo ?? cat)) out.push(`average ${phrase(score.name)} by ${phrase((geo ?? cat)?.name ?? "")}`);
  if (money.length >= 2 && ctx.dateColumn)
    out.push(`total ${phrase(money[0]?.name ?? "")} and total ${phrase(money[1]?.name ?? "")} by month`);
  if (kpi && cat) out.push(`${kpi.name.toLowerCase()} by ${phrase(cat.name)}`);
  if (kpi && (time || ctx.profile.columns.find((c) => c.name === ctx.dateColumn)?.temporal?.hasTime))
    out.push(`${kpi.name.toLowerCase()} by hour of day`);
  else if (kpi && ctx.dateColumn) out.push(`${kpi.name.toLowerCase()} by weekday`);
  return [...new Set(out)].slice(0, 4);
}

// ---------------------------------------------------------------- business questions (step 5)

/** "highest first" or "lowest first" for a ranking question. */
export type AskOrder = "desc" | "asc";

export interface QuestionReading extends AskReading {
  order: AskOrder;
}

const HIGH = /\b(highest|most|largest|biggest|best|top|maximum|max|greatest|leading)\b/;
const LOW = /\b(lowest|least|smallest|worst|fewest|bottom|minimum|min)\b/;
const RANK =
  "(?:highest|most|largest|biggest|best|top|maximum|max|greatest|leading|lowest|least|smallest|worst|fewest|bottom|minimum|min)";
const VERBS =
  "(?:has|have|had|is|are|was|were|got|gets|get|made|makes|make|sold|sells|sell|selling|brings|brought|bring|generated|generates|generate|generating|earns?|earned|earning|drives?|drove|driving|contributes?|contributed|did|does|do|with|shows?)";

/**
 * Reads a business question by turning its phrasing into the request
 * grammar of readAsk:
 * - "Which city has the highest average rating?" → "average rating by city",
 *   highest first;
 * - "Which 5 products sold the most?" → top 5 products by the view's first
 *   KPI;
 * - "At what hour of the day is gross sales highest?" → "gross sales by hour
 *   of day";
 * - "How do categories compare on discounts?" → "discounts by categories";
 * - "What is / What are / Show me …" are dropped; "How many X by Y" counts X;
 * - "lowest", "least", "bottom 5" sort lowest first.
 * Without any "by", the question is about the whole selection (one row).
 * Values and periods it names ("in Maharashtra", "in 2026") are filters.
 */
export function readQuestion(text: string, ctx: AskContext): QuestionReading {
  let s = ` ${text.toLowerCase().replace(/[?!]/g, " ").replace(/\s+/g, " ")} `;
  const order: AskOrder = LOW.test(s) && !HIGH.test(s) ? "asc" : "desc";
  let topN: number | undefined;
  // "which 5 products …" / "top 5 …" / "bottom 3 …"
  const n = /\b(?:which|top|bottom|best|worst|first)\s+(\d{1,3})\b/.exec(s);
  if (n) topN = Math.min(50, Math.max(1, Number(n[1])));
  // "sold the most" / "is highest" with no measure named: the view's first KPI.
  const firstKpi = ctx.kpis.find((k) => k.available && !k.hidden);
  const measureOr = (m: string) =>
    m
      .split(" ")
      .filter(Boolean)
      .some((w) => !FILLER.has(w))
      ? m
      : firstKpi
        ? kpiLabel(firstKpi).toLowerCase()
        : "rows";
  const rankWords = new RegExp(`\\b${RANK}\\b`, "g");
  // "At what hour of the day is gross sales highest?"
  const at =
    /^\s*(?:at|on|in|during)\s+(?:what|which)\s+(hours? of (?:the )?day|times? of (?:the )?day|hours?|day of (?:the )?week|weekdays?|day of (?:the )?month|month of (?:the )?year)\s+(?:is|are|was|were|do|does|did)\s+(.*?)\s*$/.exec(
      s,
    );
  // "How do categories compare on discounts?"
  const compare =
    /^\s*how\s+(?:do|does|did)\s+(?:the\s+)?(.+?)\s+compare\s+(?:on|in|by|for|across|with)\s+(.+?)\s*$/.exec(
      s,
    );
  // "Which <category> has the highest <measure>"
  const which = new RegExp(
    `\\b(?:which|what|who)\\s+(?:\\d{1,3}\\s+)?([a-z][a-z0-9 _/&'-]*?)\\s+${VERBS}\\s+(?:the\\s+)?${RANK}\\b\\s*(.*)$`,
  ).exec(s);
  if (at) s = ` ${measureOr((at[2] as string).replace(rankWords, " "))} by ${at[1]} `;
  else if (compare) s = ` ${measureOr(compare[2] as string)} by ${compare[1]} `;
  else if (which) s = ` ${measureOr((which[2] as string).trim())} by ${(which[1] as string).trim()} `;
  else
    s = s
      .replace(/^\s*(?:what|how)\s+(?:is|are|was|were|has|have|did)\s+(?:the\s+)?/, " ")
      .replace(/\b(?:are there|do we have|did we get|were there|have we got)\b/g, " ")
      // "bottom 5 X by Y" is read like "top 5 X by Y" (readAsk's grammar), sorted lowest first.
      .replace(/\b(?:bottom|worst)\s+(\d{1,3})\b/g, "top $1")
      .replace(/\b(?:highest|lowest|most|least)\b/g, " ");
  const reading = readAsk(s, ctx, { question: true });
  const ask: ChartAsk = { ...reading.ask, ...(topN ? { topN } : {}) };
  const notes = [...reading.notes];
  // "Read as" says what is answered: one grouping, without the split the note explains.
  const understood = ask.split
    ? reading.understood.replace(`, split by ${friendly(ask.split)}`, "")
    : reading.understood;
  // An answer is one grouping; the split is kept for "Add chart to dashboard", which can draw it.
  if (ask.split)
    notes.push(
      `Answers are by one grouping, so the split by ${friendly(ask.split)} is left out here; "Add chart to dashboard" draws it split.`,
    );
  return { ...reading, ask, understood, notes, order };
}

/**
 * A KPI or column name inside a sentence: read with spaces ("customer_state" →
 * "customer state"), each word lower-case except acronyms (AOV, GMV, MRR, GST),
 * also in brackets ("gross sales (GMV)").
 */
export function phrase(name: string): string {
  return friendly(name)
    .split(" ")
    .map((w) => (/^\(?[A-Z0-9%]{2,}\)?$/.test(w) ? w : w.toLowerCase()))
    .join(" ");
}

/** Plural of a lower-case noun phrase's last word: category → categories, region → regions, box → boxes. */
function plural(noun: string): string {
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(noun)) return `${noun}es`;
  return `${noun}s`;
}

/** A suggested business question, with the ask that answers it. */
export interface SuggestedQuestion {
  text: string;
  ask: ChartAsk;
  order: AskOrder;
}

/**
 * Business questions about this file, built only from its own KPIs and
 * columns so every one can be answered: a trend, a ranking by the main
 * category, a comparison, top items, a weekday or hour pattern, the lowest
 * average of a score, and the overall totals. At most eight. Each reads back
 * through readQuestion to the same ask, so typing a suggestion gives the
 * answer clicking it does (tests/questions.test.ts checks every demo).
 */
export function suggestQuestions(ctx: AskContext): SuggestedQuestion[] {
  const out: SuggestedQuestion[] = [];
  const kpis = ctx.kpis.filter((k) => k.available && !k.hidden);
  const [k1, k2] = kpis;
  const cats = ctx.profile.columns
    .filter(
      (c) =>
        (c.role === "dimension" || c.role === "geo") &&
        c.storage === "string" &&
        c.distinct >= 3 &&
        c.distinct <= 30 &&
        c.nullPct < 0.5 &&
        c.geoLevel !== "postal",
    )
    .sort((a, b) => a.distinct - b.distinct);
  const items = ctx.profile.columns.find(
    (c) => c.role === "dimension" && c.storage === "string" && c.distinct > 30 && c.distinct <= 5000,
  );
  const date = ctx.dateColumn;
  const time = ctx.profile.columns.find((c) => c.role === "time");
  const hourCol = time?.name ?? (date && col(ctx, date)?.temporal?.hasTime ? date : undefined);
  const score = ctx.profile.columns.find((c) => c.role === "rate" && c.storage === "number");
  const kpi = (k: { id: string }): AskMeasure => ({ kind: "kpi", id: k.id });
  const add = (text: string, ask: ChartAsk, order: AskOrder = "desc") => out.push({ text, ask, order });

  if (k1 && date)
    add(
      `How ${wasWere(kpiLabel(k1)) === "were" ? "have" : "has"} ${phrase(kpiLabel(k1))} changed month by month?`,
      {
        measures: [kpi(k1)],
        by: { kind: "time", column: date, grain: "month" },
      },
    );
  // Rankings list the top 10, the default, so their asks name no top N.
  if (k1 && cats[0])
    add(`Which ${phrase(cats[0].name)} has the highest ${phrase(kpiLabel(k1))}?`, {
      measures: [kpi(k1)],
      by: { kind: "column", column: cats[0].name },
    });
  if (k2 && (cats[1] ?? cats[0]))
    add(`How do ${plural(phrase((cats[1] ?? cats[0])?.name ?? ""))} compare on ${phrase(kpiLabel(k2))}?`, {
      measures: [kpi(k2)],
      by: { kind: "column", column: (cats[1] ?? cats[0])?.name ?? "" },
    });
  if (k1 && items)
    add(`What are the top 10 ${plural(phrase(items.name))} by ${phrase(kpiLabel(k1))}?`, {
      measures: [kpi(k1)],
      by: { kind: "column", column: items.name },
      topN: 10,
      others: false,
    });
  if (k1 && date)
    add(`Which day of the week has the most ${phrase(kpiLabel(k1))}?`, {
      measures: [kpi(k1)],
      by: { kind: "part", column: date, part: "dow" },
    });
  if (k1 && hourCol)
    add(`At what hour of the day is ${phrase(kpiLabel(k1))} highest?`, {
      measures: [kpi(k1)],
      by: { kind: "part", column: hourCol, part: "hour" },
    });
  if (score && cats[0]) {
    // A KPI named "Average <score>" is the template's own average: the question means it.
    const named = canonOf(`average ${score.name}`).join(" ");
    const own = kpiPhrases(ctx).find((p) => p.canon.join(" ") === named);
    add(
      `Which ${phrase(cats[0].name)} has the lowest average ${phrase(score.name)}?`,
      {
        measures: [own ? { kind: "kpi", id: own.id } : { kind: "column", column: score.name, agg: "avg" }],
        by: { kind: "column", column: cats[0].name },
      },
      "asc",
    );
  }
  if (k1 && k2)
    add(`What are the overall ${phrase(kpiLabel(k1))} and ${phrase(kpiLabel(k2))}?`, {
      measures: [kpi(k1), kpi(k2)],
      by: { kind: "none" },
    });
  return out.slice(0, 8);
}
