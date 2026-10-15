/**
 * "Ask for a chart": the user says what they want to see, in words ("average
 * customer rating by city", "total sales and total profit by month") or by
 * picking columns, and Loupe designs the chart.
 *
 * Two steps, both pure:
 * - readAsk() turns a phrase into a ChartAsk (measures, what to show them
 *   by, an optional split, top N, a chart type) by matching words to the
 *   view's KPIs, the file's columns and the template's field synonyms ("sales"
 *   finds the column mapped as revenue). It reports what it understood and
 *   any words it could not place, and never invents a column.
 * - designAsk() turns a ChartAsk into one or more ChartSpecs following the
 *   dataviz rules: ratings and prices are averaged (never summed), measures
 *   with different units never share an axis (they become side-by-side charts,
 *   or a scatter when asked "A vs B"), categories get sorted bars with top N
 *   plus Others, time gets columns or lines, a separate time column gives the
 *   hour of day, and averages set aside groups too small to compare.
 *
 * Every number the resulting charts show is computed by the engine from the
 * user's columns, like any other chart.
 */
import type { DatePart, TimeGrain } from "@/engine/core/dates";
import { nameSimilarity, tokenize } from "@/engine/profile/names";
import type { ColumnProfile } from "@/engine/profile/types";
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
  /** Chart type the user asked for; used when it suits the data. */
  kind?: ChartKind;
  /** "A vs B": compare two measures against each other (a scatter). */
  versus?: boolean;
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
  if (asked === "count") return c.role === "identifier" ? "countDistinct" : "count";
  if (asked === "countDistinct") return "countDistinct";
  if (!numeric) {
    notes.push(`${c.name} isn't a number, so it is counted (distinct values) instead.`);
    return "countDistinct";
  }
  if (asked === "sum" && averagedOnly(c)) {
    notes.push(
      `${c.name} is a ${c.role === "currency" ? "per-unit price" : "rate or score"}, so it is averaged: adding it up would mean nothing.`,
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
    label: `${AGG_LABEL[m.agg]} ${c.name}`,
    format,
    direction: "neutral",
  };
}

// ---------------------------------------------------------------- reading a phrase

const AGG_WORDS: Array<[RegExp, AskAgg]> = [
  [/\b(total|sum of|sum|overall|cumulative)\b/, "sum"],
  [/\b(average|avg|mean)\b/, "avg"],
  [/\bmedian\b/, "median"],
  [/\b(highest|maximum|max|largest|biggest)\b/, "max"],
  [/\b(lowest|minimum|min|smallest)\b/, "min"],
  [/\b(distinct|unique)\b/, "countDistinct"],
  [/\b(number of|count of|count|how many|no\. of)\b/, "count"],
];

const KIND_WORDS: Array<[RegExp, ChartKind]> = [
  [/\b(pie|donut|doughnut)\b/, "donut"],
  [/\bhorizontal bars?\b/, "hbar"],
  [/\bstacked\b/, "stackedBar"],
  [/\b(heat ?map)\b/, "heatmap"],
  [/\bscatter\b/, "scatter"],
  [/\btree ?map\b/, "treemap"],
  [/\bmap\b/, "geoTile"],
  [/\btable\b/, "table"],
  [/\barea\b/, "area"],
  [/\blines?\b/, "line"],
  [/\b(bars?|columns?)\b/, "bar"],
];

const GRAIN_WORDS: Array<[RegExp, TimeGrain | "auto"]> = [
  [/^(daily|day|days|date|dates|each day)$/, "day"],
  [/^(weekly|week|weeks)$/, "week"],
  [/^(monthly|month|months)$/, "month"],
  [/^(quarterly|quarter|quarters)$/, "quarter"],
  [/^(yearly|annual|annually|year|years)$/, "year"],
  [/^(time|over time|trend|trends|period|periods)$/, "auto"],
];

const PART_WORDS: Array<[RegExp, DatePart]> = [
  [/^(weekday|weekdays|day of (the )?week|days of (the )?week)$/, "dow"],
  [/^(hour|hours|hour of (the )?day|time of day|hourly)$/, "hour"],
  [/^(month of (the )?year|season|seasonality)$/, "month"],
  [/^(day of (the )?month)$/, "dom"],
];

// Words that carry no meaning for the chart ("show me a chart of …").
const FILLER =
  /\b(please|show|me|i|want|wanna|need|would|like|to|see|give|get|make|create|build|draw|plot|display|view|a|an|the|my|our|chart|charts|graph|graphs|visual|visuals|visualise|visualize|diagram|for|of|what|is|are|was|were|all|data|wise)\b/g;

const clean = (s: string) => s.replace(FILLER, " ").replace(/\s+/g, " ").trim();

interface Match {
  score: number;
  measure?: AskMeasure;
  column?: string;
  label: string;
  /** A rate, score or price (a KPI in percent, ratio or decimal, or such a column): it can't be totalled. */
  rate?: boolean;
}

/**
 * Best KPI or column for a measure phrase ("sales", "customer rating"). When a
 * total is asked, a KPI that is a rate only wins if nothing that adds up
 * matches: "total discount" is the discount amount, not the discount rate.
 */
function matchMeasure(term: string, ctx: AskContext, asked?: AskAgg): Match | null {
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
    // A KPI wins ties with a column: it carries the template's definition and format.
    if (s >= 0.6)
      take({
        score: s + 0.01,
        measure: { kind: "kpi", id: k.id },
        label: k.name,
        rate: k.format === "percent" || k.format === "ratio" || k.format === "decimal",
      });
  }
  for (const c of ctx.profile.columns) {
    const s = nameSimilarity(c.tokens, term);
    if (s >= 0.6) take({ score: s, column: c.name, label: c.name, rate: averagedOnly(c) });
  }
  // Template vocabulary: "sales" finds the column mapped as revenue.
  for (const f of ctx.domain.fields) {
    const column = ctx.mapping.fields[f.id];
    if (!column) continue;
    const s = Math.max(...[f.label, ...f.synonyms].map((syn) => nameSimilarity(termTokens, syn)));
    if (s >= 0.6) take({ score: s - 0.02, column, label: column, rate: averagedOnly(col(ctx, column)) });
  }
  const rank = (list: Match[]) => list.sort((a, b) => b.score - a.score)[0] ?? null;
  if (asked === "sum") return rank(found.filter((m) => !m.rate)) ?? rank(found);
  return rank(found);
}

/** Best column for a "by …" phrase, or a time grain / date part. */
function matchBy(term: string, ctx: AskContext): { by: AskBy; label: string } | null {
  const t = term.trim();
  const date = ctx.dateColumn;
  for (const [re, part] of PART_WORDS) {
    if (!re.test(t)) continue;
    if (part === "hour") {
      const time = date
        ? timeColumnFor(ctx.profile, date)
        : ctx.profile.columns.find((c) => c.role === "time");
      const timeCol = time ?? (date && col(ctx, date)?.temporal?.hasTime ? col(ctx, date) : undefined);
      if (timeCol) return { by: { kind: "part", column: timeCol.name, part: "hour" }, label: "hour of day" };
      return null;
    }
    if (date) return { by: { kind: "part", column: date, part }, label: t };
    return null;
  }
  for (const [re, grain] of GRAIN_WORDS) {
    if (re.test(t) && date)
      return { by: { kind: "time", column: date, grain }, label: grain === "auto" ? "over time" : grain };
  }
  const tokens = tokenize(t);
  if (!tokens.length) return null;
  let best: { score: number; column: string } | null = null;
  const consider = (column: string, score: number) => {
    const c = col(ctx, column);
    // Numbers are measures, not categories; a time column means hour of day.
    if (!c || (c.storage === "number" && c.role !== "dimension")) return;
    if (score >= 0.6 && (!best || score > best.score)) best = { score, column };
  };
  for (const c of ctx.profile.columns) consider(c.name, nameSimilarity(c.tokens, t));
  for (const f of ctx.domain.fields) {
    const column = ctx.mapping.fields[f.id];
    if (column)
      consider(column, Math.max(...[f.label, ...f.synonyms].map((s) => nameSimilarity(tokens, s))) - 0.02);
  }
  if (!best) return null;
  const found = col(ctx, (best as { column: string }).column) as ColumnProfile;
  if (found.role === "time")
    return { by: { kind: "part", column: found.name, part: "hour" }, label: `hour of ${found.name}` };
  if (found.storage === "date")
    return { by: { kind: "time", column: found.name, grain: "auto" }, label: found.name };
  return { by: { kind: "column", column: found.name }, label: found.name };
}

/**
 * Reads a request such as "average customer rating by region or city",
 * "total sales and total profit by month", "sales vs profit by state",
 * "top 5 products by quantity" or "revenue by category split by channel".
 */
export function readAsk(text: string, ctx: AskContext): AskReading {
  const notes: string[] = [];
  const unmatched: string[] = [];
  let s = ` ${text.toLowerCase().replace(/[?!.;:"']/g, " ")} `;

  let kind: ChartKind | undefined;
  for (const [re, k] of KIND_WORDS) {
    if (re.test(s)) {
      kind = k;
      s = s.replace(re, " ");
      break;
    }
  }
  let topN: number | undefined;
  const top = /\b(?:top|best|first)\s+(\d{1,3})\b/.exec(s);
  if (top) {
    topN = Math.min(50, Math.max(3, Number(top[1])));
    s = s.replace(top[0], " ");
  }
  // "top 5 products by quantity": the category comes first, the measure after "by".
  const leadingCategory = Boolean(top) && /^\s*[a-z]/.test(s);

  // Split off the split ("split by", "broken down by", "stacked by") and the "by" part.
  let splitTerm: string | undefined;
  const splitRe =
    /\b(?:split by|broken down by|break(?:ing)? down by|stacked by|coloured by|colored by|segmented by)\b(.*)$/;
  const sm = splitRe.exec(s);
  if (sm) {
    splitTerm = clean(sm[1] ?? "");
    s = s.slice(0, sm.index);
  }
  let measurePart = s;
  let byPart = "";
  const byRe = /\b(?:by|per|across|for each|for every|in each|grouped by|with|over|within)\b/;
  const bm = byRe.exec(s);
  if (bm) {
    measurePart = s.slice(0, bm.index);
    byPart = s.slice(bm.index + bm[0].length);
    // "over time" / "over the months": keep the time words.
    if (bm[0] === "over") byPart = byPart.trim() || "time";
  } else {
    // "monthly sales", "sales trend", "sales over time" without "by".
    const timeWord = /\b(daily|weekly|monthly|quarterly|yearly|annual|trend|over time)\b/.exec(s);
    if (timeWord) {
      byPart = timeWord[1] as string;
      measurePart = s.replace(timeWord[0], " ");
    }
  }
  if (leadingCategory && byPart) [measurePart, byPart] = [byPart, measurePart];

  // "A vs B": two measures compared against each other.
  let versus = false;
  if (/\b(vs|versus|against|compared to|compared with)\b/.test(measurePart)) {
    versus = true;
    measurePart = measurePart.replace(/\b(vs|versus|against|compared to|compared with)\b/g, " and ");
  }

  const measures: AskMeasure[] = [];
  const labels: string[] = [];
  for (const raw of measurePart.split(/\band\b|,|&|\+/)) {
    let phrase = raw;
    let agg: AskAgg | undefined;
    for (const [re, a] of AGG_WORDS) {
      if (re.test(phrase)) {
        agg = a;
        phrase = phrase.replace(re, " ");
        break;
      }
    }
    const term = clean(phrase);
    if (!term) {
      if (agg === "count") {
        measures.push({ kind: "column", column: "", agg: "count" });
        labels.push("Rows");
      }
      continue;
    }
    const m = matchMeasure(term, ctx, agg);
    if (!m) {
      unmatched.push(term);
      continue;
    }
    if (m.measure && (!agg || agg === "sum")) {
      measures.push(m.measure);
      labels.push(m.label);
      if (agg === "sum" && m.rate)
        notes.push(`${m.label} is a rate, so it is shown as defined: it can't be totalled.`);
      continue;
    }
    const c = m.column ? col(ctx, m.column) : undefined;
    if (!c) {
      // A KPI matched but a different aggregation was asked: use the KPI as defined.
      if (m.measure) {
        measures.push(m.measure);
        labels.push(m.label);
        notes.push(
          `${m.label} is one of your KPIs, so it is shown exactly as defined. To take the ${AGG_LABEL[agg ?? "avg"].toLowerCase()} of a column instead, pick the column under Measure.`,
        );
      }
      continue;
    }
    const a = fitAgg(c, agg, notes);
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
      if (!tokenize(term).every((t) => c.tokens.includes(t)))
        notes.push(`"${term}" was read as your ${sameKpi.name} KPI (the ${c.name} column).`);
      continue;
    }
    measures.push({ kind: "column", column: c.name, agg: a });
    labels.push(a === "count" ? "Rows" : `${AGG_LABEL[a]} ${c.name}`);
    if (m.label !== c.name || !tokenize(term).every((t) => c.tokens.includes(t)))
      notes.push(`"${term}" was read as your ${c.name} column.`);
  }

  // "region or city": the first that exists wins; the others are mentioned.
  let by: AskBy = { kind: "none" };
  let byLabel = "";
  let split: string | undefined;
  const byTerms = clean(byPart)
    .split(/\band\b|,/)
    .map((x) => x.trim())
    .filter(Boolean);
  const pick = (term: string): { by: AskBy; label: string } | null => {
    const options = term
      .split(/\bor\b/)
      .map((x) => x.trim())
      .filter(Boolean);
    for (const [i, o] of options.entries()) {
      const r = matchBy(o, ctx);
      if (r) {
        if (options.length > 1)
          notes.push(
            `You said ${options.map((x) => `"${x}"`).join(" or ")}: ${r.label} is used${i ? " (the first wasn't found)" : ""}. Switch it under "By".`,
          );
        return r;
      }
    }
    unmatched.push(term);
    return null;
  };
  const first = byTerms[0] ? pick(byTerms[0]) : null;
  if (first) {
    by = first.by;
    byLabel = first.label;
  }
  const second = splitTerm ?? byTerms[1];
  if (second) {
    const r = pick(second);
    if (r?.by.kind === "column") split = r.by.column;
  }

  const ask: ChartAsk = {
    measures,
    by,
    ...(split ? { split } : {}),
    ...(topN ? { topN } : {}),
    ...(kind ? { kind } : {}),
    ...(versus ? { versus } : {}),
  };
  const what = labels.length ? labels.join(versus ? " vs " : " and ") : "Nothing to measure yet";
  const understood = `${what}${byLabel ? (by.kind === "time" && byLabel === "over time" ? " over time" : ` by ${byLabel}`) : ""}${split ? `, split by ${split}` : ""}`;
  return { ask, understood, unmatched, notes };
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

function axisFor(by: AskBy): ResolvedAxis {
  switch (by.kind) {
    case "time":
      return { kind: "time", column: by.column, grain: by.grain, label: by.column };
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
      return { kind: "column", column: by.column, label: by.column };
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
      notes.push(`Nothing to show it by was given, so it is shown over time (${ctx.dateColumn}).`);
    } else {
      const d = defaultCategory(ctx);
      if (!d)
        return {
          charts: [],
          notes,
          error: "Choose what to show it by: a category, a date or the hour of day.",
        };
      by = { kind: "column", column: d.name };
      notes.push(`Nothing to show it by was given, so it is shown by ${d.name}.`);
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
    const series =
      split && m === 1 && (x.kind === "column" || x.kind === "time" || x.kind === "part")
        ? axisFor({ kind: "column", column: split.name })
        : undefined;
    if (split && !series && charts.length === 0)
      notes.push(`Splitting by ${split.name} needs a single measure, so the split was left out.`);

    let kind: ChartKind;
    let why: string;
    if (scatter) {
      kind = "scatter";
      why = `Each ${xCol?.name ?? "category"} is a point: ${g[0]?.cm.label} across, ${g[1]?.cm.label} up, so you can see whether they move together.`;
    } else if (series) {
      kind = allAdditive ? "stackedBar" : "heatmap";
      why = allAdditive
        ? `Stacked columns: each ${xLabel} split by ${split?.name}, adding up to the total.`
        : `An average can't be stacked, so a heatmap shows it for every ${xLabel} × ${split?.name} pair.`;
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
      why = `${xCol?.name} holds states, so a tile map shows where it comes from.`;
    } else {
      kind = m <= 2 ? "hbar" : "bar";
      why =
        m === 1
          ? `Sorted bars, largest first${avg ? " (an average, so it is compared, never added up)" : ""}, top ${ask.topN ?? 10} plus Others.`
          : `Grouped bars in the same unit, one colour per measure, top ${ask.topN ?? 10} by the first.`;
    }

    const draft = customSpec({
      id: newId(),
      title: "",
      kind,
      x,
      ...(series ? { series } : {}),
      measures: g.map((p) => p.cm),
      ...(x.kind === "column" ? { topN: ask.topN ?? 10, others: !scatter } : {}),
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
        title: series ? `${title}, split by ${split?.name}` : title,
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
  if (score && (geo ?? cat))
    out.push(`average ${score.name.toLowerCase()} by ${(geo ?? cat)?.name.toLowerCase()}`);
  if (money.length >= 2 && ctx.dateColumn)
    out.push(`total ${money[0]?.name.toLowerCase()} and total ${money[1]?.name.toLowerCase()} by month`);
  if (kpi && cat) out.push(`${kpi.name.toLowerCase()} by ${cat.name.toLowerCase()}`);
  if (kpi && (time || ctx.profile.columns.find((c) => c.name === ctx.dateColumn)?.temporal?.hasTime))
    out.push(`${kpi.name.toLowerCase()} by hour of day`);
  else if (kpi && ctx.dateColumn) out.push(`${kpi.name.toLowerCase()} by weekday`);
  return [...new Set(out)].slice(0, 4);
}
