/**
 * Reads a table before anything is designed from it (version 49.0): what one
 * row is, what each column is, the outcome the table is measured by, the
 * columns that move with it, what is wrong with the data, and which
 * industry it may come from. The session builds it on loading (the base
 * profile, Loupe's choice of outcome), for the Detect step on request
 * (Session.understand) and on every configure (after role overrides, hidden
 * columns, the chosen industry and outcome); the generic dashboard and the
 * planner (plan.ts) are designed from it, and the insights reuse its
 * drivers (drivers.ts).
 *
 * - Column kinds come from the profiled role, additivity and scale (an ID, a
 *   date, an amount that adds up, a reading or a score that is averaged, a
 *   category, a place, a yes/no flag, free text), or from the user's "Read
 *   as …" correction.
 * - The outcome is the best candidate of outcome.ts, or the user's choice
 *   (a column, or none).
 * - The drivers, relations and every figure in the sentences are worked out
 *   from the rows (drivers.ts).
 * - The subject (what one row is) comes from the industry when it fits
 *   strongly, else from the key or entity column's name, the sheet name when
 *   the file name says nothing ("cleaned.xlsx"), the file name, or "row".
 * - The title is what an analyst would call the dashboard: "{Subject}
 *   {outcome} analysis" ("Wine quality analysis", "Passenger survival
 *   analysis") or, without an outcome, one read from the table's shape.
 *
 * Everything comes from the analysis profile and the rows of its columns, so
 * a hidden column is never read. Nothing is estimated.
 */
import type { Dataset } from "@/engine/core/types";
import { formatCount, formatPlain, formatValue, type NumberLocale } from "@/engine/core/format";
import { friendly } from "@/engine/core/labels";
import { formatRange } from "@/engine/core/dates";
import type { ColumnProfile, DatasetProfile } from "@/engine/profile/types";
import type { HealthReport } from "@/engine/profile/quality";
import { isRowIndex } from "@/engine/profile/roles";
import { describeTable, fileNounOf, nounOf, pluralOf } from "@/engine/detect/tableShape";
import type {
  ColumnKind,
  ColumnUnderstanding,
  DataUnderstanding,
  Driver,
  IndustryLabel,
  OutcomeType,
  OutcomeUnderstanding,
  Relation,
  SubjectUnderstanding,
} from "./types";
import {
  canBeOutcome,
  outcomeCandidates,
  outcomeNoun,
  outcomeTypeOf,
  outcomeVerb,
  positiveLabel,
  timelineOf,
} from "./outcome";
import {
  figureOf,
  linkWords,
  outcomeTarget,
  rankDrivers,
  relationsOf,
  reportedDrivers,
  type CopyNote,
  type DriverDetail,
  type OutcomeTarget,
} from "./drivers";
import { KIND_LABEL } from "./kinds";

/** At most this many alternatives are offered for the outcome. */
const MAX_ALTERNATIVES = 3;

/** The industry to label the table with, worked out by the session (detection, the chosen domain, fitOf). */
export interface IndustryInput {
  label: IndustryLabel;
  /** What one row of that industry is ("order line", "employee"), for the subject when it fits strongly. */
  entity: string;
}

export interface UnderstandOptions {
  /** undefined: Loupe chooses; null: no outcome; a column name: that column (ignored when it can't be one). */
  outcome?: string | null;
  /** Kinds the user set with "Read as …", by column. */
  kinds?: Readonly<Record<string, ColumnKind>>;
  /** The industry label, or null when none fits. */
  industry?: IndustryInput | null;
  /** The health report of the columns in use, for the issues. */
  health?: HealthReport | null;
  /** How figures in the sentences are written; INTL by default. */
  locale?: NumberLocale;
  /** The currency of money figures; the profile's by default. */
  currency?: string;
}

/** The understanding with what the dashboard builders need beyond the contract. */
export interface UnderstandingDetail {
  understanding: DataUnderstanding;
  /** The outcome read from its rows; null without one. */
  target: OutcomeTarget | null;
  /** Every column measured against the outcome, strongest first (weak ones included). */
  ranked: DriverDetail[];
  /** Columns left out of the drivers because they record the outcome (an exit date beside an exit status). */
  copies: CopyNote[];
  /** Each column's kind. */
  kinds: Map<string, ColumnKind>;
  /** The rows are cases or entities with no timeline (no date saying when each happened). */
  entity: boolean;
  /** What the rows are called in a sentence: the subject's plural when it is a plain noun ("passengers"), else "rows". */
  rowsWord: string;
}

// ---------------------------------------------------------------- kinds

/** Name words of a rating or score. */
const SCORE_WORDS = new Set(["quality", "grade", "rating", "score", "rank", "level", "star", "satisfaction"]);

/** A number on a short scale (whole or half steps from 0 or 1 up to 10) named or profiled as a score. */
function scoreLike(c: ColumnProfile): boolean {
  const n = c.numeric;
  if (c.storage !== "number" || !n || !n.halfSteps) return false;
  if (n.min < 0 || n.max > 10 || c.distinct < 3 || c.distinct > 21) return false;
  return c.tokens.some((t) => SCORE_WORDS.has(t)) || /scale/i.test(c.roleReason);
}

/**
 * Name words and stems of a level or reading that profiling left as a
 * summable number because nothing in its name said otherwise ("Humidity3pm",
 * "Sunshine", "MinTemp"): read as measurements, averaged.
 */
const LEVEL_WORDS = new Set([
  "temp",
  "temperature",
  "humidity",
  "pressure",
  "speed",
  "wind",
  "sunshine",
  "cloud",
  "visibility",
  "dew",
  "elevation",
  "altitude",
  "depth",
  "concentration",
  "aqi",
  "index",
  "density",
]);
const LEVEL_STEMS = /temp|humid|pressure|sunshine|cloud|wind|evaporation/i;
/** The low-confidence fallback of roles.ts: a number with nothing in its name to say what it is. */
const levelNamed = (c: ColumnProfile) =>
  c.role === "measure" &&
  c.additivity === "additive" &&
  c.roleConfidence <= 0.6 &&
  (c.tokens.some((t) => LEVEL_WORDS.has(t)) || LEVEL_STEMS.test(c.name));

/** A column's kind and a plain why, from its profile (the outcome and drivers are added later). */
function readKind(c: ColumnProfile, user: ColumnKind | undefined): { kind: ColumnKind; why: string } {
  if (user && user !== "outcome" && user !== "time")
    return { kind: user, why: `Set by you: read as ${KIND_LABEL[user].toLowerCase()}.` };
  const set = c.roleReason === "Set by you." ? "Set by you: " : "";
  // A column of a table of cases read again (refine.ts) says why in its own reason.
  const refined = /in a table of cases/.test(c.roleReason);
  const say = (kind: ColumnKind, why: string) => ({
    kind,
    why: refined ? c.roleReason : set ? `${set}${why.charAt(0).toLowerCase()}${why.slice(1)}` : why,
  });
  switch (c.role) {
    case "identifier":
      return isRowIndex(c)
        ? say("id", "Only numbers the rows; it says nothing about them.")
        : say("id", "A key or code naming each row or entity: counted, never added up.");
    case "datetime":
      return say("time", "Dates: the time axis.");
    case "time":
      return say("time", "A time of day: it gives the hour-of-day pattern, never a date axis.");
    case "boolean":
      return say("flag", "Two values, yes or no: read as a share.");
    case "geo":
      return say("place", "A place to group by and filter on.");
    case "text":
      return say("text", "Free text: read, not charted.");
    case "dimension":
      // A label on every row (a passenger's name) names the row: it is looked up, never grouped by.
      if (c.storage === "string" && c.unique && c.distinct > 50)
        return say("id", "A different value on every row: a label that names the row, never a group.");
      return say(
        "category",
        c.storage === "number"
          ? "A few whole-number codes: read as groups."
          : "Values to group and filter by.",
      );
    case "rate":
    case "percentage":
      return scoreLike(c)
        ? say("score", "Points on a short scale, like a rating: averaged, never added up.")
        : say("rate", "A rate or percentage: averaged, never added up.");
    case "currency":
      return c.additivity === "non-additive"
        ? say("measurement", "Money per row, such as a price: averaged, never added up.")
        : say("amount", "Money that adds up across rows.");
    case "measure":
      if (levelNamed(c))
        return say("measurement", "A reading or level by its name: averaged, never added up.");
      if (c.additivity !== "non-additive") return say("amount", "An amount that adds up across rows.");
      return scoreLike(c)
        ? say("score", "Points on a short scale, like a quality or rating: averaged, never added up.")
        : say("measurement", "A reading or level of each row: averaged, never added up.");
  }
}

/** Base importance of a kind, before the outcome and the drivers lift it. */
const KIND_IMPORTANCE: Record<ColumnKind, number> = {
  id: 0.1,
  time: 0.5,
  outcome: 1,
  amount: 0.45,
  measurement: 0.35,
  rate: 0.4,
  score: 0.4,
  category: 0.35,
  place: 0.35,
  text: 0.1,
  flag: 0.3,
};

// ---------------------------------------------------------------- subject

/** File and sheet names that say nothing about what a row is. */
const GENERIC_FILE =
  /^(cleaned?|clean[\s_-]*data|data|dataset|final|output|export|sheet\d*|book\d*|untitled|copy|new|v\d+|test|train|sample|raw|file\d*|table\d*|report)$/i;

/** A file or sheet name without folder, extension, copy marks and version suffixes. */
function stemOf(name: string): string {
  return name
    .replace(/^.*[\\/]/, "")
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/\s*\(\d+\)$/, "")
    .replace(/[\s_-]+(v\d+|copy|final|new|\d+)$/i, "")
    .trim();
}

/** A noun read from a column or name that is a plain word or two (no codes, no "per"). */
const plainNoun = (s: string) =>
  /^[a-z][a-z-]*( [a-z][a-z-]*)?$/i.test(s) && !/\b(per|row|record|index|serial|entry)\b/i.test(s);

/**
 * What one row is, best first: the industry's entity when it fits strongly;
 * the key, entity or actor column's noun ("PassengerId" → passenger); the
 * time series or panel's grain ("location per day"); the sheet name when the
 * file name says nothing; the file name; else "row". A table of
 * measurements (no key, no timeline, its numbers readings or scores) calls
 * its rows samples: "wine sample". None of it depends on the outcome.
 */
function subjectOf(
  profile: DatasetProfile,
  ds: Dataset,
  industry: IndustryInput | null,
  measurements: boolean,
): SubjectUnderstanding {
  const rows = profile.rowCount;
  const make = (noun: string, source: SubjectUnderstanding["nounSource"], plural = pluralOf(noun)) => ({
    noun,
    plural,
    rowMeaning: `One row per ${noun}`,
    rows,
    nounSource: source,
  });
  if (industry && !industry.label.fit.weak && plainNoun(industry.entity))
    return make(industry.entity.toLowerCase(), "industry");
  const key =
    profile.columns.find((c) => c.unique && c.nullPct === 0 && c.role === "identifier" && !isRowIndex(c)) ??
    null;
  if (key) {
    const noun = nounOf(key);
    if (plainNoun(noun)) return make(noun.toLowerCase(), "entity column");
  }
  const shape = describeTable(profile, ds.source.fileName);
  if ((shape.kind === "timeSeries" || shape.kind === "panel") && shape.grain)
    return make(
      shape.grain,
      "entity column",
      `${pluralOf(shape.grain.split(" ")[0] as string)} ${shape.grain.split(" ").slice(1).join(" ")}`.trim(),
    );
  if (shape.kind === "eventLog" && shape.actor) return make("event", "entity column");
  // A file named "cleaned.xlsx" says nothing: the sheet ("winequality-white") may.
  const fileStem = stemOf(ds.source.fileName);
  const sheet = ds.source.sheet ? stemOf(ds.source.sheet) : "";
  const sample = (noun: string) => (measurements ? `${noun} sample` : noun);
  // Measure words ("quality", "prices") are dropped from names whatever the outcome, so the noun
  // doesn't change when the outcome does.
  const fromName = (name: string) => fileNounOf(name, "");
  if (sheet && (GENERIC_FILE.test(fileStem) || !fromName(fileStem))) {
    const noun = fromName(sheet);
    if (noun) return make(sample(noun), "sheet name");
  }
  const noun = fromName(fileStem);
  if (noun) return make(sample(noun), "file name");
  if (measurements) return make("sample", "default");
  return make("row", "default");
}

// ---------------------------------------------------------------- the outcome

/**
 * The outcome, from the user's choice or the best candidate, with the other
 * candidates as alternatives (yes/no, class and score columns first; the
 * main numbers are added once the drivers are known).
 */
function chooseOutcome(
  profile: DatasetProfile,
  opts: UnderstandOptions,
): { column: ColumnProfile; type: OutcomeType; why: string; alternatives: string[] } | null {
  const candidates = outcomeCandidates(profile, opts.kinds ?? {});
  const alternatives = (skip: string) =>
    candidates
      .filter((c) => c.column.name !== skip)
      .slice(0, MAX_ALTERNATIVES)
      .map((c) => c.column.name);
  if (opts.outcome === null) return null;
  if (typeof opts.outcome === "string") {
    const chosen = profile.columns.find((c) => c.name === opts.outcome);
    const type = chosen && canBeOutcome(chosen) ? outcomeTypeOf(chosen, opts.kinds?.[chosen.name]) : null;
    if (chosen && type)
      return {
        column: chosen,
        type,
        why: `Chosen by you: the table is read around ${friendly(chosen.name)}.`,
        alternatives: alternatives(chosen.name),
      };
  }
  const best = candidates[0];
  if (!best) return null;
  return {
    column: best.column,
    type: best.type,
    why: best.why,
    alternatives: alternatives(best.column.name),
  };
}

// ---------------------------------------------------------------- sentences and title

const capitalise = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
const round2 = (v: number) => Math.round(v * 100) / 100;
/**
 * A noun phrase at the start of a title: the thing itself, without a sample
 * or a period it is read in ("wine sample" → "Wine", "account month" →
 * "Account", "PU location" → "PU location").
 */
const titleSubject = (noun: string) =>
  capitalise(noun.replace(/[ -](sample|snapshot|day|week|month|quarter|year)$/, ""));

/** What an analyst would call a dashboard of this table. */
function titleOf(
  subject: SubjectUnderstanding,
  outcome: OutcomeUnderstanding | null,
  target: OutcomeTarget | null,
  profile: DatasetProfile,
  ds: Dataset,
  entity: boolean,
  industry: IndustryInput | null,
): string {
  const named = subject.nounSource !== "default" && !/ per /.test(subject.noun);
  if (outcome && target) {
    const noun = target.noun;
    if (target.type === "amount" && !entity) {
      // A table of transactions read by its money: the industry's performance when one fits strongly.
      if (industry && !industry.label.fit.weak) return `${industry.label.name} performance`;
      const pair = profile.pairs.find((p) => p.actual === outcome.column);
      if (pair) return `${capitalise(friendly(pair.actual))} vs ${pair.kind}`;
      return `${capitalise(noun)} analysis`;
    }
    const head = named ? titleSubject(subject.noun) : "";
    // "Wine quality", never "Wine wine quality".
    const doubled = head && noun.toLowerCase().startsWith(head.toLowerCase());
    return head && !doubled ? `${head} ${noun} analysis` : `${capitalise(noun)} analysis`;
  }
  const shape = describeTable(profile, ds.source.fileName);
  const first = shape.measures[0];
  switch (shape.kind) {
    case "timeSeries":
      return first ? `${capitalise(friendly(first.name))} over time` : "Readings over time";
    case "panel":
      return shape.entity ? `${capitalise(pluralOf(nounOf(shape.entity)))} over time` : "Panel over time";
    case "survey":
      return "Survey results";
    case "eventLog":
      return shape.actor ? `${capitalise(nounOf(shape.actor))} activity over time` : "Events over time";
    case "scorecard":
      return "Scorecard";
    case "lookup":
      return `${capitalise(subject.plural)} at a glance`;
    default:
      if (named) return `${capitalise(subject.plural)} at a glance`;
      if (first) return `${capitalise(friendly(first.name))} at a glance`;
      return "Performance dashboard";
  }
}

/** Two to four plain sentences: what the data is, what it is measured by, what moves it most. */
function sentencesOf(
  profile: DatasetProfile,
  subject: SubjectUnderstanding,
  columns: readonly ColumnUnderstanding[],
  target: OutcomeTarget | null,
  drivers: readonly Driver[],
  relations: readonly Relation[],
  time: DataUnderstanding["time"],
  locale: NumberLocale,
  currency: string,
  measurements: boolean,
): string[] {
  const out: string[] = [];
  const count = (n: number) => formatCount(n, locale);
  const rowsText =
    / per /.test(subject.noun) || subject.noun === "row"
      ? `${count(subject.rows)} ${subject.rows === 1 ? "row" : "rows"}${subject.noun === "row" ? "" : `, one per ${subject.noun}`}`
      : `${count(subject.rows)} ${subject.rows === 1 ? subject.noun : subject.plural}`;
  const measured = columns.filter(
    (c) => c.kind === "measurement" || c.kind === "amount" || c.kind === "rate" || c.kind === "score",
  ).length;
  const groups = columns.filter(
    (c) => c.kind === "category" || c.kind === "place" || c.kind === "flag",
  ).length;
  const parts = [
    measured ? `${count(measured)} ${measured === 1 ? "measure" : "measures"}` : "",
    groups ? `${count(groups)} ${groups === 1 ? "category" : "categories"}` : "",
  ].filter(Boolean);
  const span = time ? `, ${formatRange(time.from, time.to)}` : "";
  out.push(`${rowsText}${parts.length ? `, with ${parts.join(" and ")}` : ""}${span}.`);
  if (target) {
    const c = target.column;
    const O = friendly(c.name);
    if (target.type === "binary") {
      const yes = target.y.reduce((s, v) => (v === 1 ? s + 1 : s), 0);
      const known = target.y.reduce((s, v) => (v === v ? s + 1 : s), 0);
      const each = plainNoun(subject.noun) ? subject.plural : "rows";
      const share = formatValue(yes / known, "percent", { locale, currency });
      if (known)
        out.push(
          target.verb
            ? `${share} of ${each} ${target.verb} (${count(yes)} of ${count(known)}).`
            : `${O} is ${target.positive} on ${share} of ${each} (${count(yes)} of ${count(known)}).`,
        );
    } else if (target.type === "ordinal" && c.numeric) {
      const known = target.y.reduce((s, v) => (v === v ? s + 1 : s), 0);
      const top = target.y.reduce((s, v) => (v >= target.bar ? s + 1 : s), 0);
      if (known)
        out.push(
          `Rated on ${O}, ${formatPlain(c.numeric.min, 0, locale)}–${formatPlain(c.numeric.max, 0, locale)}; ${formatValue(top / known, "percent", { locale, currency })} are ${formatPlain(target.bar, 0, locale)} or above.`,
        );
    } else if (target.type === "class" && target.classes) {
      const counts = new Map<number, number>();
      let known = 0;
      for (const k of target.classes.codes)
        if (k >= 0) {
          counts.set(k, (counts.get(k) ?? 0) + 1);
          known++;
        }
      const [big, size] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [-1, 0];
      if (known && big >= 0)
        out.push(
          `Labelled by ${O}: ${count(counts.size)} classes, the largest ${target.classes.labels[big]} (${formatValue(size / known, "percent", { locale, currency })}).`,
        );
    } else if (target.type === "amount") {
      const fig = figureOf(c, locale, currency);
      let sum = 0;
      let known = 0;
      for (const v of target.y)
        if (v === v) {
          sum += v;
          known++;
        }
      if (known)
        out.push(
          c.additivity === "non-additive" || c.role !== "currency" || target.transactional === false
            ? `Measured by ${O}: ${fig(sum / known)} on average.`
            : `Measured by ${O}: ${fig(sum)} in total.`,
        );
    }
  }
  const top = drivers[0];
  if (!target) {
    // Nothing to be measured by: say so, and what moves together instead, when anything does.
    const pair = relations[0];
    out.push(
      pair
        ? `No column stands out as what the table is measured by; ${friendly(pair.a)} and ${friendly(pair.b)} move together most (r = ${pair.r.toFixed(2).replace("-", "−")}).`
        : "No column stands out as what the table is measured by.",
    );
  }
  if (top && target) {
    const second = drivers[1];
    const stat = (d: Driver) =>
      d.method === "correlation"
        ? `r = ${d.value.toFixed(2).replace("-", "−")}`
        : d.method === "association"
          ? `V = ${d.value.toFixed(2)}`
          : `η = ${d.value.toFixed(2)}`;
    // Worded by strength: a weak link is never said to move the outcome.
    const words = linkWords(top.strength);
    const next =
      second && linkWords(second.strength) ? `, then ${friendly(second.column)} (${stat(second)})` : "";
    out.push(
      words
        ? `${capitalise(friendly(top.column))} ${words} ${target.noun} (${stat(top)})${next}.`
        : `No ${measurements ? "characteristic" : "column"} moves closely with ${target.noun}; the strongest link is ${friendly(top.column)} (${stat(top)}).`,
    );
  }
  return out.slice(0, 4);
}

// ---------------------------------------------------------------- the understanding

/** Loupe's reading of a table with the detail the dashboard builders need; see the file header. */
export function understandDetailed(
  profile: DatasetProfile,
  ds: Dataset,
  opts: UnderstandOptions = {},
): UnderstandingDetail {
  const locale = opts.locale ?? "INTL";
  const currency = opts.currency ?? profile.currency.code;
  const user = opts.kinds ?? {};
  const read = new Map(profile.columns.map((c) => [c.name, readKind(c, user[c.name])]));
  const kinds = new Map([...read].map(([name, r]) => [name, r.kind]));
  const timeline = timelineOf(profile);
  const entity = timeline === null;

  const chosen = chooseOutcome(profile, opts);
  let target: OutcomeTarget | null = null;
  if (chosen) {
    const positive = chosen.type === "binary" ? positiveLabel(chosen.column, ds) : null;
    target = outcomeTarget(
      ds,
      chosen.column,
      chosen.type,
      outcomeNoun(chosen.column, chosen.type, positive),
      chosen.type === "amount" && !entity,
    );
    if (target && positive !== null) target.verb = outcomeVerb(chosen.column, positive);
  }
  const outcome: OutcomeUnderstanding | null =
    chosen && target
      ? { column: chosen.column.name, type: chosen.type, why: chosen.why, alternatives: chosen.alternatives }
      : null;
  if (outcome) kinds.set(outcome.column, "outcome");

  // A table of measurements: no key and no timeline, and at least three numbers, two in three of them
  // readings or scores. Read from the columns alone, never from the outcome.
  const numbers = profile.columns.filter((c) => c.storage === "number" && !isRowIndex(c));
  const readings = numbers.filter((c) => {
    const k = read.get(c.name)?.kind;
    return k === "measurement" || k === "score";
  });
  const measurements =
    entity &&
    !profile.columns.some((c) => c.role === "identifier" && !isRowIndex(c)) &&
    readings.length >= 3 &&
    readings.length * 3 >= numbers.length * 2;
  const subject = subjectOf(profile, ds, opts.industry ?? null, measurements);
  const rowsWord = plainNoun(subject.noun) ? subject.plural : "rows";

  let ranked: DriverDetail[] = [];
  let copies: CopyNote[] = [];
  if (target)
    ({ ranked, copies } = rankDrivers(profile, ds, target, {
      kinds,
      locale,
      currency,
      // "Wine samples rated 7 or above …", but "Rows with RainTomorrow = Yes …" for a compound noun.
      rowsWord,
    }));
  const drivers = reportedDrivers(ranked);
  // Alternatives: the other yes/no, class and score columns first, then the main numbers, strongest
  // link first, as amounts to read the table around instead.
  if (outcome) {
    for (const d of ranked) {
      if (outcome.alternatives.length >= MAX_ALTERNATIVES) break;
      const c = profile.columns.find((x) => x.name === d.column);
      if (
        !c ||
        d.as !== "numeric" ||
        c.distinct < 10 ||
        !canBeOutcome(c) ||
        outcome.alternatives.includes(c.name)
      )
        continue;
      outcome.alternatives.push(c.name);
    }
  }
  const strength = new Map(drivers.map((d) => [d.column, d]));
  const copied = new Map(copies.map((c) => [c.column, c.reason]));

  const columns: ColumnUnderstanding[] = profile.columns.map((c) => {
    const r = read.get(c.name) as { kind: ColumnKind; why: string };
    if (outcome?.column === c.name) return { name: c.name, kind: "outcome", importance: 1, why: outcome.why };
    const copy = copied.get(c.name);
    if (copy) return { name: c.name, kind: r.kind, importance: 0.15, why: `${r.why} ${copy}` };
    const d = strength.get(c.name);
    if (d)
      return {
        name: c.name,
        kind: r.kind,
        importance: round2(Math.min(0.95, 0.35 + 0.6 * d.strength)),
        why: `${r.why} ${d.sentence}`,
      };
    let importance: number = KIND_IMPORTANCE[r.kind];
    if (r.kind === "id" && isRowIndex(c)) importance = 0.05;
    if (r.kind === "time" && c.name !== profile.primaryDate) importance = c.role === "time" ? 0.2 : 0.3;
    // With an outcome, a column that doesn't move it matters less.
    if (outcome && r.kind !== "time" && r.kind !== "id" && r.kind !== "text") importance *= 0.7;
    return { name: c.name, kind: r.kind, importance: round2(importance), why: r.why };
  });

  const date = profile.primaryDate ? profile.columns.find((c) => c.name === profile.primaryDate) : undefined;
  const time: DataUnderstanding["time"] =
    date?.storage === "date" && date.role === "datetime" && date.temporal
      ? {
          column: date.name,
          from: date.temporal.min,
          to: date.temporal.max,
          grain:
            date.temporal.granularity === "minute" || date.temporal.granularity === "hour"
              ? "day"
              : date.temporal.granularity,
        }
      : null;

  const measures = profile.columns.filter(
    (c) =>
      c.name !== outcome?.column &&
      c.storage === "number" &&
      (kinds.get(c.name) === "amount" ||
        kinds.get(c.name) === "measurement" ||
        kinds.get(c.name) === "rate" ||
        kinds.get(c.name) === "score"),
  );
  const relations = relationsOf(ds, measures);
  const health = opts.health?.issues ?? [];
  const issues = [
    ...health.filter((i) => i.severity !== "info"),
    ...health.filter((i) => i.severity === "info"),
  ]
    .slice(0, 3)
    .map((i) => i.title);
  const understanding: DataUnderstanding = {
    subject,
    columns,
    outcome,
    drivers,
    relations,
    time,
    issues,
    industry: opts.industry?.label ?? null,
    title: titleOf(subject, outcome, target, profile, ds, entity, opts.industry ?? null),
    sentences: sentencesOf(
      profile,
      subject,
      columns,
      target,
      drivers,
      relations,
      time,
      locale,
      currency,
      measurements,
    ),
  };
  return { understanding, target, ranked, copies, kinds, entity, rowsWord };
}

/** Loupe's reading of a table; see the file header. */
export function understandData(
  profile: DatasetProfile,
  ds: Dataset,
  opts: UnderstandOptions = {},
): DataUnderstanding {
  return understandDetailed(profile, ds, opts).understanding;
}
