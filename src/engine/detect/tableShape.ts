/**
 * What a table is, when no industry fits: its shape and a plain sentence
 * saying what it holds, computed only from the profile.
 *
 * The generic fallback (detect/generic.ts) builds a different dashboard for
 * each shape, and the sentence is the generic domain's description, shown on
 * the Detect step and above the dashboard:
 * - time series: one date, and none or a few entities read on every date
 *   ("Daily readings of 4 measures at 49 locations, 1 Jan 2008 – 25 Jun 2017");
 * - panel: many entities, each read once per period ("195 countries × 20 years of 6 indicators");
 * - survey: answers on agreement, satisfaction or rating scales ("1,240 survey responses to 18 questions");
 * - labelled table: a practice table with a yes/no or class outcome column
 *   ("891 rows with a yes/no outcome (Survived: 38.4% yes)"), or a table of
 *   measurements rated on a short scale ("4,898 wines rated 3–9 on quality,
 *   with 11 measured characteristics"), the thing rated named from the file
 *   name when it gives one;
 * - event log: timestamped events, several a day, with no regular grid ("2,400 events, 1–15 May 2024, from 60 users");
 * - lookup table: one row per code and its attributes, with nothing to add up
 *   ("Lookup table: 250 countries and their attributes");
 * - plain list: anything else ("891 rows, one per passenger, with 3 measures and 4 categories");
 * - scorecard: a tall "Metric | Month | Value" sheet (profile.tall), which keeps the
 *   per-metric KPIs it already had.
 *
 * Every word and count comes from the profile: column roles, distinct counts,
 * the key and grain, the primary date and its span, and for a yes/no outcome
 * the share of yes. Nothing is read from the rows here; the generic builder
 * reads them only to find which measures move together. The one exception is
 * the noun for a rated table's rows, which comes from the file name.
 */
import type { ColumnProfile, DatasetProfile } from "@/engine/profile/types";
import { bucketLabel, formatRange, type TimeGrain } from "@/engine/core/dates";
import { formatCount } from "@/engine/core/format";
import { friendly } from "@/engine/core/labels";
import { isRowIndex } from "@/engine/profile/roles";

export type TableShapeKind =
  "timeSeries" | "panel" | "survey" | "labelled" | "eventLog" | "lookup" | "list" | "scorecard";

/** The shape's name, as the generic domain's one sub-domain is called. */
export const SHAPE_LABEL: Record<TableShapeKind, string> = {
  timeSeries: "Time series",
  panel: "Panel",
  survey: "Survey",
  labelled: "Labelled table",
  eventLog: "Event log",
  lookup: "Lookup table",
  list: "List",
  scorecard: "Scorecard",
};

/** A text question answered on an agreement, satisfaction, likelihood, frequency or quality scale. */
export interface LikertQuestion {
  column: ColumnProfile;
  /** Which scale its answers come from ("agreement", "satisfaction"…). */
  scale: string;
  /**
   * The answers, spelt as the file spells them, that make the top two boxes:
   * the two highest levels above the scale's middle that someone chose
   * ("Agree" and "Strongly agree").
   */
  favourable: string[];
  /** The scale's levels as the column spells them, lowest first (the answers it can't place are left out). */
  levels: string[];
}

/** A numeric question answered on a 0/1-to-4, 5, 7 or 10 scale. */
export interface RatingQuestion {
  column: ColumnProfile;
  min: number;
  max: number;
}

export interface TableShape {
  kind: TableShapeKind;
  /** SHAPE_LABEL[kind]. */
  label: string;
  /** The plain sentence: what the table holds, with its counts and dates. */
  description: string;
  /**
   * What one row is, as a short noun ("response", "event", "country per year")
   * for "One row per …"; null when the profile's own grain says it better.
   */
  grain: string | null;
  /** The time axis: the primary date, or a whole-number year column when there is no date. */
  period: ColumnProfile | null;
  /** The period's cadence ("day", "month", "year"…); "year" for a year column. */
  cadence: TimeGrain | "hour" | "minute" | null;
  /** Time series and panels: the entity read on every period (a location, a country). */
  entity: ColumnProfile | null;
  /** Event logs: the repeating identifier the events belong to (a user, a vehicle). */
  actor: ColumnProfile | null;
  /** Numeric measures, ranked: continuous before small codes, money first, then the most complete, then file order. */
  measures: ColumnProfile[];
  /**
   * Labelled tables: the outcome column. "ordinal" is a score on a short
   * scale (a wine's quality of 3–9) in a table of measurements: it is
   * averaged, and the share at the top of its scale is counted.
   */
  outcome: {
    column: ColumnProfile;
    kind: "binary" | "class" | "ordinal";
    positiveShare: number | null;
  } | null;
  /** Surveys: text questions on a known scale. */
  likert: LikertQuestion[];
  /** Surveys: numeric scale questions (the NPS question among them). */
  ratings: RatingQuestion[];
  /** Surveys: the 0–10 "would you recommend" question, when there is one. */
  nps: ColumnProfile | null;
  /** Lookup tables and lists: the column that is unique on every row, if any. */
  key: ColumnProfile | null;
  /**
   * Rated tables: what one row is, as a singular noun read from the file
   * name ("wine" for winequality-white.csv), for counts and the sentence;
   * null when the name gives none, and the rows are called rows.
   */
  noun: string | null;
  /**
   * The period says when each row happened, over more than one day (or one
   * year): a trend over it means something. False for a birthday or a start
   * date, and for a file stamped with a single day.
   */
  timeline: boolean;
}

// ---------------------------------------------------------------- answer scales

/**
 * Answer scales, lowest level first, each level with the spellings it is
 * written in (lower case). `middle` is the index of the neutral level; the
 * favourable answers are the two highest levels above it that are in use.
 */
const SCALES: ReadonlyArray<{ id: string; middle: number; levels: readonly (readonly string[])[] }> = [
  {
    id: "agreement",
    middle: 3,
    levels: [
      ["strongly disagree", "completely disagree", "totally disagree"],
      ["disagree", "mostly disagree"],
      ["somewhat disagree", "slightly disagree", "tend to disagree"],
      ["neither agree nor disagree", "neutral", "neither", "undecided", "not sure"],
      ["somewhat agree", "slightly agree", "tend to agree"],
      ["agree", "mostly agree"],
      ["strongly agree", "completely agree", "totally agree"],
    ],
  },
  {
    id: "satisfaction",
    middle: 2,
    levels: [
      ["very dissatisfied", "extremely dissatisfied", "very unsatisfied"],
      ["dissatisfied", "unsatisfied", "somewhat dissatisfied"],
      ["neither satisfied nor dissatisfied", "neutral"],
      ["satisfied", "somewhat satisfied"],
      ["very satisfied", "extremely satisfied"],
    ],
  },
  {
    id: "likelihood",
    middle: 2,
    levels: [
      ["very unlikely", "extremely unlikely"],
      ["unlikely", "somewhat unlikely"],
      ["neither likely nor unlikely", "neutral", "not sure"],
      ["likely", "somewhat likely"],
      ["very likely", "extremely likely"],
    ],
  },
  {
    id: "frequency",
    middle: 2,
    levels: [
      ["never"],
      ["rarely", "seldom"],
      ["sometimes", "occasionally"],
      ["often", "frequently", "usually"],
      ["always", "very often"],
    ],
  },
  {
    id: "quality",
    middle: 2,
    levels: [
      ["very poor", "terrible", "very bad"],
      ["poor", "bad"],
      ["fair", "average", "okay", "ok", "neutral"],
      ["good"],
      ["very good"],
      ["excellent", "outstanding"],
    ],
  },
  {
    id: "importance",
    middle: 2,
    levels: [
      ["not at all important", "not important"],
      ["slightly important", "of little importance", "low importance"],
      ["moderately important", "somewhat important"],
      ["important"],
      ["very important", "extremely important"],
    ],
  },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The scale a text column's answers come from: at least 90% of its answers
 * (by rows) and at least three different levels on one scale. Null for
 * anything else, so a yes/no or a category column is never a question.
 */
function likertOf(c: ColumnProfile): LikertQuestion | null {
  if (c.storage !== "string" || c.distinct < 3 || c.distinct > 12) return null;
  const values = c.categorical?.all ?? c.categorical?.top ?? [];
  const answered = values.reduce((s, v) => s + v.count, 0);
  if (!answered) return null;
  let best: LikertQuestion | null = null;
  let bestCover = 0;
  for (const scale of SCALES) {
    const level = (v: string) => scale.levels.findIndex((l) => l.includes(norm(v)));
    const placed = values.filter((v) => level(v.value) >= 0);
    const cover = placed.reduce((s, v) => s + v.count, 0) / answered;
    const used = new Set(placed.map((v) => level(v.value)));
    if (cover < 0.9 || used.size < 3 || cover <= bestCover) continue;
    const ranked = [...placed].sort((a, b) => level(a.value) - level(b.value));
    const above = [...used]
      .filter((i) => i > scale.middle)
      .sort((a, b) => b - a)
      .slice(0, 2);
    bestCover = cover;
    best = {
      column: c,
      scale: scale.id,
      favourable: ranked.filter((v) => above.includes(level(v.value))).map((v) => v.value),
      levels: ranked.map((v) => v.value),
    };
  }
  return best && best.favourable.length ? best : null;
}

/** A numeric question on a scale: whole or half steps from 0 or 1 up to 4, 5, 7 or 10, three or more points used. */
function ratingOf(c: ColumnProfile): RatingQuestion | null {
  const n = c.numeric;
  if (!n || c.storage !== "number" || !n.halfSteps || c.distinct < 3) return null;
  if (c.role !== "rate" && c.role !== "measure") return null;
  if (n.min < 0 || n.min > 1 || ![4, 5, 7, 10].includes(n.max)) return null;
  return { column: c, min: n.min === 0 ? 0 : 1, max: n.max };
}

/** Words that mark a column as a question asked of people. */
const QUESTION_WORDS = new Set([
  "q",
  "question",
  "rating",
  "rate",
  "satisfaction",
  "satisfied",
  "recommend",
  "agree",
  "likely",
  "score",
  "experience",
  "nps",
  "csat",
  "feedback",
  "how",
]);
const questionLike = (c: ColumnProfile) =>
  /\?\s*(\(.*\))?\s*$/.test(c.name) || /^q\d+/i.test(c.name) || c.tokens.some((t) => QUESTION_WORDS.has(t));

/** "How likely are you to recommend us? (0–10)": the NPS question. */
const isNpsQuestion = (r: RatingQuestion) =>
  r.min === 0 &&
  r.max === 10 &&
  r.column.tokens.some((t) => t === "recommend" || t === "nps" || t === "promoter");

// ---------------------------------------------------------------- outcomes

/** Name words of a yes/no outcome in a practice table ("Survived", "Machine failure", "Churn", "is_fraud"). */
const OUTCOME_WORDS = new Set([
  "survived",
  "survival",
  "outcome",
  "target",
  "label",
  "churn",
  "churned",
  "default",
  "defaulted",
  "failure",
  "failed",
  "fraud",
  "fraudulent",
  "attrition",
  "exited",
  "converted",
  "diagnosis",
  "purchased",
  "approved",
  "admitted",
  "readmitted",
  "death",
  "died",
  "deceased",
  "disease",
  "diabetes",
  "stroke",
  "spam",
  "subscribed",
  "clicked",
  "responded",
  "passed",
  "hired",
  "placed",
  "y",
]);
/** Name words of a class outcome ("species", "class", "label"). */
const CLASS_WORDS = new Set([
  "species",
  "class",
  "label",
  "target",
  "outcome",
  "diagnosis",
  "variety",
  "category_label",
]);

/** The share of yes in a yes/no column: true ÷ (true + false), or the mean of a 0/1 number column. */
function positiveShare(c: ColumnProfile): number | null {
  if (c.booleanStats) {
    const { trueCount: t, falseCount: f } = c.booleanStats;
    return t + f > 0 ? t / (t + f) : null;
  }
  if (c.numeric && c.numeric.min >= 0 && c.numeric.max <= 1) return c.numeric.mean;
  return null;
}

/** A column of only 0 and 1 kept as numbers ("target", "Outcome" of a practice table). */
const zeroOne = (c: ColumnProfile) =>
  c.storage === "number" &&
  c.numeric?.integer === true &&
  c.numeric.min === 0 &&
  c.numeric.max === 1 &&
  c.distinct === 2;

function outcomeOf(columns: readonly ColumnProfile[]): TableShape["outcome"] {
  // The outcome usually comes last in a practice table: read the columns from the end.
  const back = [...columns].reverse();
  const binary = back.find(
    (c) => (c.role === "boolean" || zeroOne(c)) && c.tokens.some((t) => OUTCOME_WORDS.has(t)),
  );
  if (binary) return { column: binary, kind: "binary", positiveShare: positiveShare(binary) };
  const cls = back.find(
    (c) =>
      c.storage === "string" &&
      c.role === "dimension" &&
      c.distinct >= 2 &&
      c.distinct <= 20 &&
      c.nullPct < 0.05 &&
      c.tokens.some((t) => CLASS_WORDS.has(t)),
  );
  return cls ? { column: cls, kind: "class", positiveShare: null } : null;
}

/** Name words of a score on a short scale: a wine's quality, a grade, a rating. */
const ORDINAL_WORDS = new Set(["quality", "grade", "rating", "score", "rank", "level"]);

/**
 * The ordinal outcome of a table of measurements: whole numbers on a 0–10
 * scale, three to eleven of them in use, under a quality, grade or rating
 * name, filled on (nearly) every row. Read from the last column back, as
 * practice tables put the outcome last.
 */
function ordinalOf(columns: readonly ColumnProfile[]): ColumnProfile | null {
  return (
    [...columns]
      .reverse()
      .find(
        (c) =>
          c.storage === "number" &&
          (c.role === "measure" || c.role === "rate") &&
          c.numeric?.integer === true &&
          c.numeric.min >= 0 &&
          c.numeric.max <= 10 &&
          c.distinct >= 3 &&
          c.distinct <= 11 &&
          c.nullPct < 0.05 &&
          c.tokens.some((t) => ORDINAL_WORDS.has(t)),
      ) ?? null
  );
}

/**
 * The measured characteristics of a table of measurements, when it is one:
 * no date, no identifier beyond a column that only numbers the rows, at
 * least three numeric measures besides the outcome, and at least two in
 * three of them readings (averaged, never summed). Null for any other table:
 * an order list with a rating column is still an order list.
 */
function readingsOf(profile: DatasetProfile, outcome: ColumnProfile): ColumnProfile[] | null {
  const { columns } = profile;
  if (columns.some((c) => c.storage === "date")) return null;
  if (columns.some((c) => c.role === "identifier" && !isRowIndex(c))) return null;
  const measures = measuresOf(profile, new Set([outcome.name]));
  const readings = measures.filter(
    (c) => c.additivity === "non-additive" || c.role === "rate" || c.role === "percentage",
  );
  return measures.length >= 3 && readings.length * 3 >= measures.length * 2 ? measures : null;
}

/**
 * Words of a file name that say nothing about what a row is: data and file
 * words, versions, states of the file (clean, final, raw), splits (train,
 * test) and colours and other adjectives a file of one kind is often named
 * by ("white.csv" holds white wines, not "whites").
 */
const FILE_WORDS = new Set([
  "data",
  "dataset",
  "datasets",
  "db",
  "file",
  "files",
  "export",
  "exported",
  "report",
  "sample",
  "samples",
  "table",
  "sheet",
  "sheets",
  "list",
  "master",
  "final",
  "clean",
  "cleaned",
  "raw",
  "processed",
  "updated",
  "latest",
  "new",
  "old",
  "copy",
  "train",
  "training",
  "test",
  "testing",
  "valid",
  "validation",
  "full",
  "all",
  "combined",
  "merged",
  "csv",
  "xlsx",
  "xls",
  "json",
  "tsv",
  "txt",
  "white",
  "red",
  "black",
  "blue",
  "green",
  "yellow",
  "rose",
  "big",
  "small",
  "the",
  "and",
  "of",
  "for",
  "my",
  "our",
]);

/**
 * The thing a rated table's rows are, from its file name, as a lower-case
 * singular noun: "winequality-white.csv" → "wine", "WineQT.csv" → "wine".
 * Words of the outcome's own name are dropped, inside a run-together word
 * too ("winequality" without "quality"), as are file words (FILE_WORDS) and
 * anything shorter than three letters or with digits. Null when no word is
 * left ("cleaned.xlsx", "data.csv").
 */
function fileNoun(fileName: string | undefined, outcome: ColumnProfile): string | null {
  if (!fileName) return null;
  const stem = fileName.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]{1,5}$/i, "");
  const outcomeWords = outcome.name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3);
  const words = stem
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .flatMap((w) => {
      // A run-together word holding the outcome's name ("winequality") keeps what is left of it.
      const hit = outcomeWords.find((o) => w !== o && w.includes(o));
      return hit ? w.split(hit) : [w];
    })
    .filter((w) => w.length >= 3 && /^[a-z]+$/.test(w) && !FILE_WORDS.has(w) && !outcomeWords.includes(w));
  const word = words[0];
  if (!word) return null;
  // Singular, as "One row per …" and the plural for counts expect: "wines" → "wine", "classes" → "class".
  if (/[^aeiou]ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(word)) return word;
  if (/(x|z|ch|sh|ss)es$/.test(word)) return word.slice(0, -2);
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

// ---------------------------------------------------------------- periods and entities

/** A whole-number year column standing in for a date ("Year" of 2010–2019): a panel's period. */
function yearColumn(columns: readonly ColumnProfile[]): ColumnProfile | null {
  return (
    columns.find(
      (c) =>
        c.storage === "number" &&
        c.numeric?.integer === true &&
        c.numeric.min >= 1800 &&
        c.numeric.max <= 2200 &&
        c.distinct >= 2 &&
        c.nullPct < 0.05 &&
        c.tokens.some((t) => t === "year" || t === "yr"),
    ) ?? null
  );
}

/** Columns that can name what is read on every period: places, ids and labels, never a measure or a date. */
const entityLike = (c: ColumnProfile) =>
  (c.role === "geo" || c.role === "identifier" || c.role === "dimension") &&
  !c.unique &&
  c.distinct >= 2 &&
  c.nullPct < 0.05 &&
  c.geoLevel !== "latitude" &&
  c.geoLevel !== "longitude";

/**
 * The entity read on every period: the other half of a (period, entity) key
 * when the profile found one, else the column whose values times the
 * periods come closest to the row count (between 30% and 110% of it, so a
 * sparse panel still counts but a column that repeats within a period does
 * not). Places beat ids, which beat labels.
 */
function entityOf(profile: DatasetProfile, period: ColumnProfile): ColumnProfile | null {
  const { columns, grain, rowCount } = profile;
  if (grain.columns.length === 2 && grain.columns.includes(period.name)) {
    const other = columns.find((c) => c.name !== period.name && grain.columns.includes(c.name));
    if (other && entityLike(other)) return other;
  }
  const rank = (c: ColumnProfile) => (c.role === "geo" ? 0 : c.role === "identifier" ? 1 : 2);
  const fit = (c: ColumnProfile) => rowCount / (c.distinct * Math.max(1, period.distinct));
  return (
    columns
      .filter((c) => c !== period && entityLike(c) && fit(c) >= 0.3 && fit(c) <= 1.1)
      .sort((a, b) => rank(a) - rank(b) || Math.abs(1 - fit(a)) - Math.abs(1 - fit(b)))[0] ?? null
  );
}

/** Name words of a date that marks an attribute of the row (a birthday, a start date), not when it happened. */
const ATTRIBUTE_DATE = new Set([
  "dob",
  "birth",
  "born",
  "joined",
  "join",
  "hire",
  "hired",
  "start",
  "valid",
  "until",
  "expiry",
  "expires",
  "opened",
  "founded",
  "established",
  "launch",
  "release",
]);

/** Words for the one an event belongs to, preferred when several repeating ids exist. */
const ACTOR_WORDS = new Set([
  "user",
  "customer",
  "account",
  "session",
  "device",
  "member",
  "player",
  "driver",
  "vehicle",
  "patient",
  "employee",
  "visitor",
  "client",
  "machine",
  "sensor",
  "host",
  "ip",
]);

// ---------------------------------------------------------------- words

/** The noun a column names, lower case and singular: "Country Name" → "country", "user_id" → "user". */
export function nounOf(c: ColumnProfile): string {
  const drop = new Set(["id", "name", "code", "key", "no", "number", "num", "nr", "sg", "cd", "nm"]);
  // Words split at separators and at case changes ("PULocationID" → PU, Location, ID); acronyms keep
  // their capitals, other words are lower-cased.
  const words = c.name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w && !drop.has(w.toLowerCase()))
    .map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase()));
  return words.length ? words.join(" ") : friendly(c.name).toLowerCase();
}

/** "country" → "countries", "box" → "boxes", "PU location" → "PU locations"; "1 country" stays singular. */
export function pluralOf(noun: string, n = 2): string {
  if (n === 1) return noun;
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  return `${noun}s`;
}

const count = (n: number) => formatCount(n, "INTL");
const counted = (n: number, noun: string) => `${count(n)} ${pluralOf(noun, n)}`;

/** The cadence as a sentence starts it: "Daily", "Monthly"… */
const CADENCE_WORD: Record<NonNullable<TableShape["cadence"]>, string> = {
  minute: "Timestamped",
  hour: "Hourly",
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  quarter: "Quarterly",
  year: "Yearly",
};
/** One period of the cadence, as a noun: "day", "month"… */
export const CADENCE_NOUN: Record<NonNullable<TableShape["cadence"]>, string> = {
  minute: "timestamp",
  hour: "hour",
  day: "day",
  week: "week",
  month: "month",
  quarter: "quarter",
  year: "year",
};

/** The period's span as analysts write it: "1 Jan 2008 – 25 Jun 2017", "Oct 2024 – Sep 2026", "2010 – 2019". */
function spanOf(period: ColumnProfile, cadence: TableShape["cadence"]): string {
  if (period.storage === "number") {
    const n = period.numeric;
    return n ? (n.min === n.max ? String(n.min) : `${n.min} – ${n.max}`) : "";
  }
  const t = period.temporal;
  if (!t) return "";
  if (cadence === "month" || cadence === "quarter" || cadence === "year") {
    const a = bucketLabel(t.min, cadence);
    const b = bucketLabel(t.max, cadence);
    return a === b ? a : `${a} – ${b}`;
  }
  return formatRange(t.min, t.max);
}

/** "Revenue" for one measure, "Revenue and Cost" for two, "4 measures" for more. */
function measuresPhrase(ms: readonly ColumnProfile[], noun = "measure"): string {
  if (ms.length === 1) return friendly((ms[0] as ColumnProfile).name);
  if (ms.length === 2)
    return `${friendly((ms[0] as ColumnProfile).name)} and ${friendly((ms[1] as ColumnProfile).name)}`;
  return counted(ms.length, noun);
}

// ---------------------------------------------------------------- the shape

/** Measure-like numeric columns a dashboard can summarise, money first, then the most complete. */
function measuresOf(profile: DatasetProfile, exclude: ReadonlySet<string>): ColumnProfile[] {
  const tallValues = new Set(profile.tall?.valueColumns ?? []);
  return profile.columns
    .filter(
      (c) =>
        c.storage === "number" &&
        Boolean(c.numeric) &&
        (c.role === "measure" || c.role === "currency" || c.role === "rate" || c.role === "percentage") &&
        c.distinct > 1 &&
        c.nullPct < 0.95 &&
        !tallValues.has(c.name) &&
        !exclude.has(c.name),
    )
    .map((c, i) => ({ c, i }))
    .sort(
      (a, b) =>
        // Continuous figures (ten or more values) before small codes and counts, money first, then the most complete.
        (b.c.distinct >= 10 ? 1 : 0) - (a.c.distinct >= 10 ? 1 : 0) ||
        (b.c.role === "currency" ? 1 : 0) - (a.c.role === "currency" ? 1 : 0) ||
        Math.round(a.c.nullPct * 10) - Math.round(b.c.nullPct * 10) ||
        a.i - b.i,
    )
    .map((x) => x.c);
}

/**
 * Classifies the table and words its description, from the profile alone;
 * `fileName`, when given, only names what a rated table's rows are ("wine").
 */
export function describeTable(profile: DatasetProfile, fileName?: string): TableShape {
  const { columns, rowCount } = profile;
  const rows = count(rowCount);
  const date = profile.primaryDate
    ? (columns.find((c) => c.name === profile.primaryDate && c.storage === "date" && c.role === "datetime") ??
      null)
    : null;
  const base: TableShape = {
    kind: "list",
    label: SHAPE_LABEL.list,
    description: "",
    grain: null,
    period: null,
    cadence: null,
    entity: null,
    actor: null,
    measures: [],
    outcome: null,
    likert: [],
    ratings: [],
    nps: null,
    key: null,
    noun: null,
    timeline: false,
  };
  const make = (kind: TableShapeKind, rest: Partial<TableShape>): TableShape => ({
    ...base,
    ...rest,
    kind,
    label: SHAPE_LABEL[kind],
  });

  // A tall scorecard keeps its own KPIs: one per metric.
  const tall = profile.tall;
  if (tall) {
    const byName = new Map(columns.map((c) => [c.name, c]));
    const ids = tall.idColumns.map((n) => byName.get(n)).filter((c): c is ColumnProfile => Boolean(c));
    const period = ids.find((c) => c.storage === "date") ?? null;
    const cadence = period?.temporal ? cadenceOf(period) : null;
    const entity = ids.find((c) => c !== period && c.distinct > 1) ?? null;
    const by = [
      period && cadence ? `${counted(period.distinct, CADENCE_NOUN[cadence])}` : null,
      entity ? counted(entity.distinct, nounOf(entity)) : null,
    ].filter(Boolean);
    return make("scorecard", {
      description: `Scorecard of ${counted(tall.metrics.length, "metric")}${by.length ? ` over ${by.join(" and ")}` : ""}${period && cadence ? `, ${spanOf(period, cadence)}` : ""}`,
      period,
      cadence,
      entity,
    });
  }

  // Survey: answers on known scales.
  const likert = columns.map(likertOf).filter((q): q is LikertQuestion => q !== null);
  const ratings = columns.map(ratingOf).filter((q): q is RatingQuestion => q !== null);
  const numericMeasures = measuresOf(profile, new Set());
  const askedRatings = ratings.filter((r) => questionLike(r.column));
  const survey =
    likert.length >= 2 ||
    (likert.length >= 1 && likert.length + ratings.length >= 3) ||
    (askedRatings.length >= 3 && ratings.length * 2 >= numericMeasures.length) ||
    (askedRatings.length >= 2 && likert.length >= 1);
  if (survey) {
    const questions = new Set([
      ...likert.map((q) => q.column.name),
      ...ratings.map((q) => q.column.name),
      ...columns.filter((c) => /\?\s*(\(.*\))?\s*$/.test(c.name)).map((c) => c.name),
    ]);
    const nps = ratings.find(isNpsQuestion)?.column ?? null;
    return make("survey", {
      description: `${rows} survey ${pluralOf("response", rowCount)} to ${counted(questions.size, "question")}${date?.temporal ? `, ${formatRange(date.temporal.min, date.temporal.max)}` : ""}`,
      grain: "response",
      period: date,
      timeline: Boolean(date && (date.temporal?.distinctDays ?? 0) >= 2),
      cadence: date ? cadenceOf(date) : null,
      likert,
      ratings,
      nps,
      measures: measuresOf(profile, questions),
    });
  }

  // A practice table: a yes/no or class outcome to predict.
  const outcome = outcomeOf(columns);
  // The key: a unique identifier first, else a unique label (a name).
  const key =
    columns.find((c) => c.unique && c.nullPct === 0 && c.role === "identifier") ??
    columns.find((c) => c.unique && c.nullPct === 0 && c.storage === "string" && c.role === "dimension") ??
    null;
  if (outcome) {
    const measures = measuresOf(profile, new Set([outcome.column.name]));
    const name = friendly(outcome.column.name);
    const share = outcome.positiveShare;
    const description =
      outcome.kind === "binary"
        ? `${rows} ${pluralOf("row", rowCount)} with a yes/no outcome (${name}${share === null ? "" : `: ${(share * 100).toFixed(1)}% yes`})`
        : `${rows} ${pluralOf("row", rowCount)} labelled by ${name} (${counted(outcome.column.distinct, "class")})`;
    return make("labelled", {
      description,
      outcome,
      measures,
      key,
      period: date,
      timeline: Boolean(date && (date.temporal?.distinctDays ?? 0) >= 2),
    });
  }

  // A table of measurements rated on a short scale: a wine's quality, a student's grade.
  const ordinal = ordinalOf(columns);
  const readings = ordinal ? readingsOf(profile, ordinal) : null;
  if (ordinal?.numeric && readings) {
    const noun = fileNoun(fileName, ordinal);
    const name = friendly(ordinal.name);
    const on = /^[A-Z0-9]{2,}/.test(name) ? name : `${name.charAt(0).toLowerCase()}${name.slice(1)}`;
    return make("labelled", {
      description: `${rows} ${pluralOf(noun ?? "row", rowCount)} rated ${ordinal.numeric.min}–${ordinal.numeric.max} on ${on}, with ${counted(readings.length, "measured characteristic")}`,
      outcome: { column: ordinal, kind: "ordinal", positiveShare: null },
      measures: readings,
      key,
      noun,
      // Each row is one thing measured and rated: a wine, or an item when the file name doesn't say.
      grain: noun ?? "rated item",
    });
  }

  const measures = measuresOf(profile, new Set());
  const realMeasures = measures.filter((c) => c.role === "currency" || c.additivity !== "non-additive");
  // Facts about the date: whether it says when rows happened, and how they fall on it.
  const attributeDate = Boolean(date?.tokens.some((t) => ATTRIBUTE_DATE.has(t)));
  const dated = Boolean(date && !attributeDate && (date.temporal?.distinctDays ?? 0) >= 2);
  // Timestamps to the minute: events as they happened, not readings on a grid.
  const stamped = Boolean(dated && date?.temporal?.hasTime && date.temporal.granularity === "minute");
  const actor = actorOf(columns);
  const eventLike =
    dated && (stamped || (rowCount / Math.max(1, date?.distinct ?? 1) > 1.2 && actor !== null));

  // A lookup table: one row per code, with attributes and nothing to add up, and no stream of events.
  if (key && realMeasures.length === 0 && !eventLike) {
    const g = /^One row per (.+)$/.exec(profile.grain.description)?.[1];
    const noun = g && !/^(row|record|index|serial|entry)$/i.test(g) ? g : nounOf(key);
    return make("lookup", {
      description: `Lookup table: ${counted(rowCount, noun)} and their attributes`,
      key,
      measures,
    });
  }

  // Time: a date that says when rows happened, or a whole-number year column when there is no date.
  const year = date ? null : yearColumn(columns);
  const period = dated ? date : year;
  if (period) {
    const cadence: TableShape["cadence"] = year ? "year" : cadenceOf(period);
    const unit = CADENCE_NOUN[cadence ?? "day"];
    const periods = period.distinct;
    const span = spanOf(period, cadence);
    const perPeriod = rowCount / periods;
    const entity = measures.length ? entityOf(profile, period) : null;
    const timed = { period, cadence, measures, timeline: true };
    if (entity && periods >= 3 && !(stamped && perPeriod <= 1.2)) {
      if (periods >= entity.distinct)
        return make("timeSeries", {
          ...timed,
          description: `${CADENCE_WORD[cadence ?? "day"]} readings of ${measuresPhrase(measures)} at ${counted(entity.distinct, nounOf(entity))}, ${span}`,
          grain: `${nounOf(entity)} per ${unit}`,
          entity,
        });
      const indicator = entity.geoLevel === "country" ? "indicator" : "measure";
      return make("panel", {
        ...timed,
        description: `${counted(entity.distinct, nounOf(entity))} × ${counted(periods, unit)} of ${measuresPhrase(measures, indicator)}, ${span}`,
        grain: `${nounOf(entity)} per ${unit}`,
        entity,
      });
    }
    if (measures.length && periods >= 3 && perPeriod <= 1.2 && !stamped) {
      // Readings of a level (a temperature, a price, a rate) or figures that add up (sales).
      const levels = measures.some((c) => c.additivity !== "additive");
      return make("timeSeries", {
        ...timed,
        description: `${CADENCE_WORD[cadence ?? "day"]} ${levels ? "readings of" : "figures for"} ${measuresPhrase(measures)}, ${span}`,
        grain: unit,
      });
    }
    // Several rows on a date, or timestamps to the minute: events.
    if (date && (stamped || perPeriod > 1.2))
      return make("eventLog", {
        ...timed,
        description: `${counted(rowCount, "event")}, ${span}${actor ? `, from ${counted(actor.distinct, nounOf(actor))}` : ""}`,
        grain: "event",
        actor,
      });
  }

  // Anything else: a plain list.
  const dims = columns.filter(
    (c) =>
      (c.role === "dimension" || c.role === "geo") && c.storage === "string" && !c.unique && c.distinct >= 2,
  );
  const g = /^One row per (.+)$/.exec(profile.grain.description)?.[1];
  const each =
    profile.grain.confidence >= 0.8 && g && !/^(row|record|index|serial|entry)$/i.test(g)
      ? `, one per ${g}`
      : "";
  const parts = [
    measures.length ? counted(measures.length, "measure") : null,
    dims.length ? counted(dims.length, "category") : null,
  ].filter(Boolean);
  return make("list", {
    description: `${rows} ${pluralOf("row", rowCount)}${each}${parts.length ? `, with ${parts.join(" and ")}` : ""}${date?.temporal ? `, ${formatRange(date.temporal.min, date.temporal.max)}` : ""}`,
    period: date,
    cadence: date ? cadenceOf(date) : null,
    measures,
    key,
    timeline: dated,
  });
}

/** A date column's cadence: its granularity, minute and hour included. */
function cadenceOf(c: ColumnProfile): TableShape["cadence"] {
  return c.temporal?.granularity ?? "day";
}

/** The repeating identifier events belong to: an actor word in its name first, then the most values. */
function actorOf(columns: readonly ColumnProfile[]): ColumnProfile | null {
  const ids = columns.filter(
    (c) => c.role === "identifier" && !c.unique && c.distinct > 1 && c.nullPct < 0.5,
  );
  const named = (c: ColumnProfile) => (c.tokens.some((t) => ACTOR_WORDS.has(t)) ? 1 : 0);
  return ids.sort((a, b) => named(b) - named(a) || b.distinct - a.distinct)[0] ?? null;
}
