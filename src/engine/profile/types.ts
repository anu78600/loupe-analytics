/**
 * Shapes produced by profiling (profile.ts, roles.ts, structure.ts) and read
 * by domain detection, KPI planning, charts, insights and the UI.
 *
 * Conventions: shares, confidences and `nullPct` are fractions in [0, 1], not
 * 0–100 percentages; timestamps are wall-clock UTC ms; distinct counts
 * exclude nulls.
 */
import type { StorageType } from "@/engine/core/types";
import type { TimeGrain } from "@/engine/core/dates";

/** What a column means for analysis, independent of its storage. Inferred in roles.ts; the user can override it. */
export type SemanticRole =
  | "identifier"
  | "datetime"
  | "dimension"
  | "measure"
  | "rate"
  | "currency"
  | "percentage"
  | "geo"
  | "text"
  | "boolean"
  /** A time of day without a date (a separate time column): hour-of-day patterns only, never a date. */
  | "time";

export const ROLE_LABEL: Record<SemanticRole, string> = {
  identifier: "Identifier",
  datetime: "Date/Time",
  dimension: "Dimension",
  measure: "Measure",
  rate: "Rate/Ratio",
  currency: "Currency",
  percentage: "Percentage",
  geo: "Geo",
  text: "Free text",
  boolean: "Boolean/Flag",
  time: "Time of day",
};

/**
 * additive: safe to sum in any direction. semi-additive: sum across items but
 * not across time (balances, stock levels). non-additive: never sum; average
 * instead (prices, rates, ages).
 */
export type Additivity = "additive" | "semi-additive" | "non-additive";
export type GeoLevel =
  "country" | "state" | "city" | "postal" | "latitude" | "longitude" | "region" | "address";
/** Aggregation used when a column is a value without further instruction; "none" for dates. */
export type DefaultAgg = "sum" | "avg" | "count" | "countDistinct" | "min" | "max" | "none";

/** Value patterns found in string columns (patterns.ts). "id" means a code-like token with at least two digits. */
export type PatternKind =
  | "email"
  | "phone"
  | "url"
  | "pincode"
  | "zip"
  | "id"
  | "uuid"
  | "country"
  | "state"
  | "city"
  | "latitude"
  | "longitude"
  | "year"
  | "month"
  /** A UK postcode ("BS1 4QA", "M4 5JD"). */
  | "postcode"
  /** An ISO 3166 alpha-3 country code ("IND", "bra"); a place only under a country word in the header. */
  | "countrycode";

/**
 * Where a place column's values come from: Indian, US, Brazilian, Canadian,
 * Australian or Mexican states and provinces, or countries of the world. Only
 * IN and US have a tile map (ui/charts/options.ts geoTiles); the others are
 * places to group by and filter on, never drawn as a map.
 */
export type GeoRegion = "IN" | "US" | "BR" | "CA" | "AU" | "MX" | "WORLD";

export interface PatternHit {
  kind: PatternKind;
  /** Estimated share (0–1) of non-null rows matching. Patterns overlap, so shares need not sum to 1. */
  share: number;
}

/** Exact statistics over the non-null values of a number column. */
export interface NumericStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  /** Sample standard deviation. */
  std: number;
  /** Quartiles, R type-7 interpolation. */
  q1: number;
  q3: number;
  /** Population skewness g1. */
  skew: number;
  sum: number;
  /** Values outside Tukey's fences (1.5 × IQR); 0 when the IQR is 0. */
  outliers: number;
  zeros: number;
  negatives: number;
  /** Every value is a whole number. */
  integer: boolean;
  /** Every value is a multiple of 0.5 (whole numbers included), as on a star-rating scale. */
  halfSteps: boolean;
}

export interface ValueCount {
  value: string;
  count: number;
}

export interface CategoricalStats {
  /** Up to 12 most frequent values; above 60,000 distinct values, the first-seen ones instead. */
  top: ValueCount[];
  /** All distinct values with counts when the column has at most 250 of them. */
  all?: ValueCount[];
  /** Mean characters per non-null row (frequency-weighted). */
  avgLength: number;
  maxLength: number;
}

export interface TemporalStats {
  min: number;
  max: number;
  /** Whole calendar days from min to max (0 when all values fall on one day). */
  spanDays: number;
  /**
   * Finest regular step: minute or hour when times are present; otherwise
   * year, quarter or month when every date is a period start, week when all
   * dates (more than three) share a weekday, else day.
   */
  granularity: "minute" | "hour" | TimeGrain;
  hasTime: boolean;
  distinctDays: number;
}

export interface ColumnProfile {
  name: string;
  /** Position in Dataset.columns. */
  index: number;
  storage: StorageType;
  role: SemanticRole;
  /** Heuristic 0–1 score (1 after a user override), not a probability. */
  roleConfidence: number;
  /** Plain-English reason shown to the user. */
  roleReason: string;
  /** Set for measure-like roles (measure, currency, rate, percentage). */
  additivity?: Additivity;
  defaultAgg: DefaultAgg;
  geoLevel?: GeoLevel;
  geoRegion?: GeoRegion;
  /** ISO code from currency symbols in the values (number columns only). */
  currency?: string;
  /** For percentages: 1 when stored as fractions (0.12), 100 when stored as points (12). */
  percentScale?: 1 | 100;
  nullCount: number;
  /** Fraction (0–1) of rows that are null, despite the name. */
  nullPct: number;
  /** Distinct non-null values (exact for every storage type, including large date columns). */
  distinct: number;
  /** distinct / non-null rows (0–1). */
  cardinality: number;
  /** Every non-null value is distinct (nulls allowed). */
  unique: boolean;
  numeric?: NumericStats;
  categorical?: CategoricalStats;
  temporal?: TemporalStats;
  booleanStats?: { trueCount: number; falseCount: number };
  /** String columns only; empty for other storage types. */
  patterns: PatternHit[];
  /** Normalised name tokens (names.tokenize), the vocabulary that role and domain rules match. */
  tokens: string[];
  /** Up to five distinct display values in row order (booleans: their two labels). */
  examples: string[];
}

export interface KeyInfo {
  /** One unique column, else a unique pair; null when neither exists. */
  primary: string[] | null;
  /** Every single-column key, else the unique pairs found. */
  candidates: string[][];
  /** Repeating identifier columns and the entity each probably refers to (from its name). */
  foreign: Array<{ column: string; entity: string }>;
}

export interface GrainInfo {
  /** Key columns that identify a row; empty when no key was found. */
  columns: string[];
  /** e.g. "One row per order line (order × product)". */
  description: string;
  confidence: number;
}

export interface HierarchyInfo {
  /** Coarse → fine, e.g. Region → State → City. */
  levels: string[];
  /** Lowest parent-consistency share along the chain (0–1, at least 0.98). */
  purity: number;
  kind: "geo" | "product" | "organisation" | "other";
}

export interface TimeSeriesInfo {
  column: string;
  /** Bucket used for the gap check (daily data spanning more than 3 years is checked weekly). */
  granularity: TimeGrain;
  /** Buckets from the first to the last date, inclusive (capped at 20,000). */
  periods: number;
  missingPeriods: number;
  /** At most 2% of buckets are empty. */
  regular: boolean;
  /** Up to 5 longest runs of empty buckets; `to` is the last millisecond before data resumes. */
  gaps: Array<{ from: number; to: number; periods: number }>;
  /** Raw min and max timestamps, not bucket-aligned. */
  from: number;
  to: number;
}

export interface WideFormatInfo {
  /** Numeric columns whose names are periods (Jan, Q1 2024, FY24, 2024-03 …). */
  columns: string[];
  /** All other columns, repeated per period when unpivoting. */
  idColumns: string[];
  kind: "month" | "quarter" | "year" | "date";
  suggestion: string;
}

/**
 * A tall scorecard: one row per metric (per period or entity), the metric's
 * name in one column and its figure in one or more value columns, as in an
 * MIS or board-pack sheet ("Metric | Month | Actual | Target"). Values of
 * different metrics are in different units, so they are never added or
 * averaged together; turning the metrics into columns (parse/pivot.ts) gives
 * each its own column. Found by structure.detectTallFormat.
 */
export interface TallFormatInfo {
  /** The column naming the metric on each row ("Metric", "KPI", "Particulars"). */
  metricColumn: string;
  /** The metric names, in first-seen order. */
  metrics: string[];
  /** Numeric columns holding the figures ("Value", "Actual", "Target", "LY"); the first is the main one. */
  valueColumns: string[];
  /** Columns that say which period or entity a row is for, kept as the rows of the pivoted table. */
  idColumns: string[];
  suggestion: string;
}

/**
 * Two measures that belong together as plan and outcome: a target, budget,
 * plan, forecast or quota beside the actual figure it is measured against
 * ("Target (₹ Lakh)" and "Achievement (₹ Lakh)", "Umsatz Plan" and "Umsatz
 * Ist"). Found by pairs.detectColumnPairs; attainment and variance KPIs are
 * built from them.
 */
export interface ColumnPair {
  /** The outcome column. */
  actual: string;
  /** The plan column it is measured against. */
  target: string;
  /** What the pair measures, from the words the two headers share ("Revenue", "Umsatz"). */
  label: string;
  /** Which kind of plan: "target", "budget", "plan", "forecast", "quota" or "last year". */
  kind: "target" | "budget" | "plan" | "forecast" | "quota" | "last year";
}

export interface CurrencyInfo {
  code: string;
  /** Where the code came from, in plain English. */
  source: string;
  confidence: number;
}

export interface DatasetProfile {
  datasetId: string;
  rowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
  keys: KeyInfo;
  grain: GrainInfo;
  hierarchies: HierarchyInfo[];
  /** Name of the main time-axis column. */
  primaryDate: string | null;
  /** Gap analysis of primaryDate. */
  timeSeries: TimeSeriesInfo | null;
  wide: WideFormatInfo | null;
  /** A tall "one row per metric" scorecard, when the table is one. */
  tall: TallFormatInfo | null;
  /** Plan and outcome measures that belong together. */
  pairs: ColumnPair[];
  /** Dataset-level display currency. */
  currency: CurrencyInfo;
  durationMs: number;
}
