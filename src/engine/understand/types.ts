/**
 * What Loupe understands about a table before it designs anything (version
 * 49.0): the data-first contract between the engine and the interface.
 *
 * Loupe used to start from an industry template and fill it with whatever
 * columns matched. Now it reads the table first: what one row is, what each
 * column is (an ID, a date, an outcome, an amount that adds up, a reading
 * that is averaged, a category, a place), which columns move with the
 * outcome, and what is wrong with the data. The industry is a label on top
 * of that, used only where its KPIs fit the columns. The dashboard is then
 * planned from the analyses the data can support, ranked by how much each
 * tells (plan.ts), and the insights come from the same analyses.
 *
 * Everything here is computed from the rows and the profile; no figure is
 * estimated. Corrections the user makes (the outcome, a column's kind) are
 * passed back through ContextRequest and win over what Loupe inferred.
 */

/** What a column is, in the words an analyst would use. */
export type ColumnKind =
  /** A key or code that names a row or an entity: counted, never summed or averaged. */
  | "id"
  /** A date or date-time: the time axis. */
  | "time"
  /** What the table is measured by: quality, churned, survived, sales. Chosen by understandData. */
  | "outcome"
  /** An amount that adds up across rows: sales, units, cost, hours. Totalled. */
  | "amount"
  /** A reading or level: pH, temperature, density, price per unit, age. Averaged, never summed. */
  | "measurement"
  /** A rate, share or percentage. Averaged with weights where possible. */
  | "rate"
  /** A rating or ordinal score: quality 3–9, satisfaction 1–5. Averaged; also a natural grouping. */
  | "score"
  /** A category to group and filter by. */
  | "category"
  /** A place: country, state, city, postcode, coordinates. */
  | "place"
  /** Free text: comments, descriptions. */
  | "text"
  /** A yes/no flag. */
  | "flag";

export interface ColumnUnderstanding {
  name: string;
  kind: ColumnKind;
  /** How much this column matters to the analysis, 0–1 (outcome and strong drivers high, IDs and text low). */
  importance: number;
  /** One plain sentence: why Loupe reads it this way. */
  why: string;
}

/** The kind of outcome, which decides the analyses built around it. */
export type OutcomeType =
  /** Two values (yes/no, survived, churned): analysed as a rate. */
  | "binary"
  /** An ordered score (quality 3–9, grade A–E, rating 1–5): distribution, average, share at the high end. */
  | "ordinal"
  /** Unordered classes (species, segment): mix and differences between classes. */
  | "class"
  /** A continuous amount that is the result (sales, revenue, price, yield): total or average, trend and drivers. */
  | "amount";

export interface OutcomeUnderstanding {
  column: string;
  type: OutcomeType;
  /** One plain sentence: why this column is the outcome. */
  why: string;
  /** Other columns that could be the outcome, best first, for the user to switch to. */
  alternatives: string[];
}

/** A column that moves with the outcome, computed from the rows. */
export interface Driver {
  column: string;
  /**
   * Strength 0–1, comparable across methods: |Pearson r| for a numeric
   * column against a numeric, ordinal or yes/no (0/1) outcome; the
   * correlation ratio η for a category against one; Cramér's V for a
   * category against unordered classes; η of the column across the classes
   * for a numeric column against them.
   */
  strength: number;
  /** Which way the outcome moves as the column rises (numeric) or across its groups (category). */
  direction: "up" | "down" | "mixed";
  method: "correlation" | "group-means" | "association";
  /** The statistic itself, signed where it has a sign: r, η or V. */
  value: number;
  /** A plain sentence with the numbers: "Wines rated 7 or above average 11.4% alcohol, against 10.3% for the rest." */
  sentence: string;
}

/** Two measures that move together strongly (|r| ≥ 0.5), not counting the outcome. */
export interface Relation {
  a: string;
  b: string;
  r: number;
}

export interface SubjectUnderstanding {
  /** What one row is, singular and plural: "wine sample" / "wine samples", "order line" / "order lines". */
  noun: string;
  plural: string;
  /** "One row per wine sample". */
  rowMeaning: string;
  rows: number;
  /** Where the noun came from, for the explanation. */
  nounSource: "industry" | "entity column" | "file name" | "sheet name" | "outcome" | "default";
}

export interface IndustryLabel {
  id: string;
  name: string;
  confidence: number;
  /** How much of the table the industry explains (Session's fit): weak means its template must not lead. */
  fit: { mapped: number; columns: number; weak: boolean };
}

/** Loupe's reading of a table, shown on Detect as "What this data is about". */
export interface DataUnderstanding {
  subject: SubjectUnderstanding;
  columns: ColumnUnderstanding[];
  outcome: OutcomeUnderstanding | null;
  /** Strongest first; at most 8. Empty without an outcome. */
  drivers: Driver[];
  /** Strongest first; at most 5. */
  relations: Relation[];
  time: {
    column: string;
    from: number;
    to: number;
    grain: "day" | "week" | "month" | "quarter" | "year";
  } | null;
  /** The most important data-health problems, in plain words, at most 3. */
  issues: string[];
  /** The industry as a label on top of the reading, or null when none fits. */
  industry: IndustryLabel | null;
  /**
   * What an analyst would call a dashboard of this data, read from it:
   * "Wine quality analysis", "Passenger survival analysis", "Customer churn
   * analysis". The one page uses it when no industry fits strongly.
   */
  title: string;
  /** Two to four plain sentences: what this data is about, what it is measured by, what moves it. */
  sentences: string[];
}

/** Where a planned analysis came from. */
export type AnalysisSource = "data" | "industry";

/** One planned KPI or chart with its rank: the plan the dashboard is built from. */
export interface PlannedAnalysis {
  /** A KPI id or a chart spec id in the ContextResult. */
  id: string;
  type: "kpi" | "chart";
  source: AnalysisSource;
  /** Higher first. Documented in plan.ts. */
  score: number;
  /** One plain sentence: why it is on the dashboard ("Alcohol is the measure most linked to quality, r = 0.44"). */
  why: string;
}
