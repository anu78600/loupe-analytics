/**
 * Columnar, typed in-memory dataset. Every column is a typed array so a
 * million-row table stays compact and aggregation loops stay fast.
 *
 * Null encodings: number/date → NaN, string → code -1, boolean → -1.
 * Dates are stored as "wall-clock UTC" epoch milliseconds: the clock time
 * written in the file is kept exactly, with no timezone shifting.
 *
 * Every column holds exactly `rowCount` entries and row i of every column is
 * the same record. String columns are dictionary-encoded: `codes[i]` indexes
 * `dict`, whose entries are unique, so equal codes mean equal strings
 * (grouping and duplicate detection rely on this). Booleans store 1/0.
 * Produced by the parsers (src/engine/parse) and the demo generators
 * (src/engine/samples); everything downstream reads this shape.
 */

export type StorageType = "number" | "date" | "string" | "boolean";

export interface NumberFormatInfo {
  /** ISO 4217 code when values carried a currency symbol or code, e.g. "INR". */
  currency?: string;
  /** Values were written with a % sign and are stored as fractions (12.5% → 0.125). */
  percent?: boolean;
  /** Every non-null value is a whole number. */
  integer: boolean;
  /**
   * Maximum observed decimals, capped at 6. For percent columns this is the
   * precision as written (12.5% → 1), not of the stored fraction. Parsers
   * inspect only the first ~20,000 values.
   */
  decimals: number;
}

/**
 * Cells the parser could not read as the column's type ("12,5x" in a number
 * column). They are stored as blank like any missing value, and kept here so
 * the data check (profile/dataCheck.ts) can point at each one and show what
 * the file said. `rows` ascend; `codes[i]` indexes `texts`, the distinct
 * original texts.
 */
export interface UnreadableCells {
  readonly rows: Int32Array;
  readonly codes: Int32Array;
  readonly texts: readonly string[];
}

/** Original text of an unreadable cell at `row`, or undefined when the cell was read fine. */
export function unreadableAt(u: UnreadableCells | undefined, row: number): string | undefined {
  if (!u) return undefined;
  let lo = 0;
  let hi = u.rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = u.rows[mid] as number;
    if (r === row) return u.texts[u.codes[mid] as number];
    if (r < row) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

interface ColumnBase {
  readonly name: string;
  /** Typed columns only: cells that couldn't be read and are stored as blank. */
  readonly unreadable?: UnreadableCells;
}

export interface NumberColumn extends ColumnBase {
  readonly kind: "number";
  readonly values: Float64Array;
  readonly format: NumberFormatInfo;
}

export interface DateColumn extends ColumnBase {
  readonly kind: "date";
  /** Wall-clock UTC epoch ms; NaN = null. */
  readonly values: Float64Array;
  /** At least one value carried a time of day (written in the source, even 00:00, or off midnight). */
  readonly hasTime: boolean;
  /**
   * A time of day with no calendar date ("20:15", an Excel time cell): values
   * are ms since midnight (wall clock on 1 Jan 1970). Never a date axis, date
   * filter or period; used for hour-of-day patterns. See parse/builder.ts.
   */
  readonly timeOnly?: boolean;
  /** Human-readable source format, e.g. "DD/MM/YYYY HH:mm". */
  readonly format: string;
}

export interface StringColumn extends ColumnBase {
  readonly kind: "string";
  /** Per-row index into `dict`; -1 = null. */
  readonly codes: Int32Array;
  /** Unique values in first-seen order. */
  readonly dict: readonly string[];
}

export interface BooleanColumn extends ColumnBase {
  readonly kind: "boolean";
  /** 1 = true, 0 = false, -1 = null. */
  readonly values: Int8Array;
  /** Display labels: the most common original spellings (e.g. "Yes"/"No"), else "TRUE"/"FALSE". */
  readonly trueLabel: string;
  readonly falseLabel: string;
}

export type Column = NumberColumn | DateColumn | StringColumn | BooleanColumn;

/**
 * "xlsx" also covers .xlsm, .xlsb and .ods workbooks; "sample" is a generated
 * demo dataset; "derived" is built in-app from another dataset (e.g. unpivot).
 */
export type FileKind = "csv" | "tsv" | "xlsx" | "xls" | "json" | "sample" | "derived";

export interface DatasetSource {
  fileName: string;
  kind: FileKind;
  sizeBytes: number;
  /** Workbooks only: the sheet that was read. */
  sheet?: string;
  /** Demo datasets only: the catalogue id (see src/engine/samples/catalog.ts). */
  sampleId?: string;
  isDemo: boolean;
}

export interface Dataset {
  /** Parsers generate a fresh id (newDatasetId); each demo dataset has a fixed id. */
  readonly id: string;
  readonly name: string;
  readonly rowCount: number;
  readonly columns: readonly Column[];
  readonly source: DatasetSource;
}

/**
 * Parser message about one column: values that could not be read (blanked, or
 * the reason the column fell back to text), or an informational note such as
 * trimmed whitespace, which has invalidCount 0.
 */
export interface ColumnParseNote {
  column: string;
  invalidCount: number;
  /** Up to three original invalid values. */
  examples: string[];
  note: string;
}

/** How a text date column was read, shown to the user so a wrong guess can be corrected. */
export interface DateFormatDecision {
  column: string;
  format: string;
  /** Plain-language explanation of the evidence used. */
  evidence: string;
  /** No value proved the day/month order, so the locale preference decided. */
  ambiguous: boolean;
  /**
   * The alternative order when the day/month order was ambiguous. Set for
   * every DD/MM vs MM/DD decision, including proven and conflicting ones.
   */
  alternative?: string;
}

export interface ParseReport {
  fileName: string;
  kind: FileKind;
  sizeBytes: number;
  rowCount: number;
  columnCount: number;
  /** Delimited files only. */
  encoding?: string;
  /** Delimited files only. */
  delimiter?: string;
  /**
   * 0-based header row (or first data row when no header was found).
   * Delimited files give the 0-based line of the file (blank lines counted);
   * workbooks use the physical sheet row.
   */
  headerRowIndex: number;
  /** False when the top row read like data and columns were named Column 1, Column 2, … */
  headerDetected: boolean;
  sheet?: string;
  sheets?: string[];
  dateFormats: DateFormatDecision[];
  columnNotes: ColumnParseNote[];
  warnings: string[];
  /**
   * Present only when rows were sampled (`every`) or capped (`first`), i.e.
   * the dataset is not the whole file. estimatedTotalRows is approximate.
   */
  sampling?: {
    strategy: "first" | "systematic";
    keptRows: number;
    estimatedTotalRows: number;
    every?: number;
  };
  /** Columns left out via IngestOptions.columns (reported by every reader). */
  skippedColumns?: string[];
  durationMs: number;
}

export interface IngestOptions {
  /** Sheet to read for multi-sheet workbooks. */
  sheet?: string;
  /** Keep only these columns (large-file mode). Matched against cleaned header names. */
  columns?: string[];
  /** Keep every n-th data row (large-file mode systematic sample): rows 0, n, 2n, …; values ≤ 1 keep all. */
  sampleEvery?: number;
  /** Stop after this many data rows. Counts kept rows, i.e. after sampleEvery. */
  maxRows?: number;
  /**
   * Day/month order preference when the whole column is ambiguous. The
   * parsers default to day-first; the app passes its number-locale setting.
   */
  preferDayFirst?: boolean;
  /** Explicit day/month order overrides chosen by the user, by column. */
  dateOrderOverrides?: Record<string, "DMY" | "MDY">;
}

/**
 * Returned instead of a dataset when a delimited file looks too large to load
 * whole; the user then picks a systematic sample, the first rows or a subset
 * of columns, and the file is ingested again with those IngestOptions.
 */
export interface LargeFileAssessment {
  fileName: string;
  sizeBytes: number;
  /** Extrapolated from the first megabyte, so approximate. */
  estimatedRows: number;
  columns: string[];
  reason: string;
  /** Sampling step that keeps roughly a million rows (at least 2). */
  recommendedSampleEvery: number;
}

/** True for the NaN null marker used by number and date columns. */
export const isNullNumber = (v: number): boolean => v !== v; // NaN check without a call

export function columnByName(ds: Dataset, name: string): Column | undefined {
  return ds.columns.find((c) => c.name === name);
}
