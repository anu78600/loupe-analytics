/**
 * Streaming column builders. A column's type is decided from a sample, then
 * values stream into typed arrays. If a typed column later meets too many
 * values that don't fit (genuinely mixed data), it degrades to text without
 * losing any original value.
 *
 * Shared by the CSV, workbook and JSON readers. inferPlan sees up to ~5,000
 * sampled rows; accumulators then receive every cell in row order and push
 * exactly one entry per row (a null marker when missing or invalid), so all
 * columns stay row-aligned. Thresholds: a type must fit ≥ 95% of sampled
 * non-null values (98% for text booleans); a typed column degrades to text
 * when more than 5% of its non-null values fail to parse. On degradation
 * every invalid cell keeps its original text (all are remembered, see
 * TypedAccumulator), while valid ones are re-rendered from the parsed value
 * ("₹1,234" → "1234", "12.5%" → "0.125").
 *
 * Blank spellings ("NA", "N/A", "-", …) are blanks only where a value must be
 * a number, a date or a yes/no: a text column keeps them as written, since
 * there they are often real values ("NA" for North America).
 *
 * Values written in other languages are read with the words in words.ts: a
 * yes/no column in one language's pair ("Sim"/"Não") keeps that pair, a
 * month-name column narrows to the language its values are written in, and a
 * column whose numbers carry scale words ("14.5 Lacs") is read at full size
 * with a note saying so.
 */
import type {
  BooleanColumn,
  Column,
  ColumnParseNote,
  DateColumn,
  DateFormatDecision,
  NumberColumn,
  StringColumn,
} from "@/engine/core/types";
import { DAY_MS, isoDate, isoDateTime } from "@/engine/core/dates";
import type { DayMonthDecision } from "./dateOrder";
import {
  type CellValue,
  detectNumberStyle,
  detectScaleWords,
  isNullToken,
  type NumberStyle,
  parseBooleanToken,
  parseNumber,
  parseScaledNumber,
  WallClockDate,
  yesNoPairOf,
  yesNoTruth,
} from "./values";
import {
  type DateKind,
  DATE_KIND_LABEL,
  describeKind,
  detectDateKind,
  isTimeOnlyColumn,
  detectNumericDateKind,
  monthLanguageEvidence,
  numericDateToMs,
  parseDateParts,
  partsToMs,
} from "./dates";
import { ANY_MONTH_LANGUAGE, foldWord, SCALE_NAMES, type YesNoPair } from "./words";

// ---------------------------------------------------------------- growable arrays

/** Float64 buffer that doubles when full; finish() returns a right-sized copy. */
class GrowF64 {
  buf: Float64Array;
  len = 0;
  constructor(cap = 4096) {
    this.buf = new Float64Array(cap);
  }
  push(v: number): void {
    if (this.len === this.buf.length) {
      const next = new Float64Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = v;
  }
  finish(): Float64Array {
    return this.buf.slice(0, this.len);
  }
}

/** Int32 twin of GrowF64. */
class GrowI32 {
  buf: Int32Array;
  len = 0;
  constructor(cap = 4096) {
    this.buf = new Int32Array(cap);
  }
  push(v: number): void {
    if (this.len === this.buf.length) {
      const next = new Int32Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = v;
  }
  finish(): Int32Array {
    return this.buf.slice(0, this.len);
  }
}

// ---------------------------------------------------------------- plans

/**
 * Storage decision for one column. "date" with dateKind "typed" means cells
 * arrive as WallClockDate (spreadsheets); "numeric-date" means numbers that
 * encode dates (Excel serials, Unix time). A number plan's `note` explains a
 * doubtful decimal-separator choice and goes into the column's parse note;
 * `scaled` reads scale words at full size ("14.5 Lacs"). A date plan's
 * `months` is the month-name languages the column may be written in, and its
 * `evidence` explains a reading the parse report should spell out ("01.2025"
 * as a month). A boolean plan's `words` is the other language's yes/no pair
 * its values use; English when absent.
 */
export type ColumnPlan =
  | { kind: "number"; style: NumberStyle; note?: string; scaled?: boolean }
  | { kind: "date"; dateKind: DateKind | "typed"; months?: number; evidence?: string }
  | { kind: "numeric-date"; dateKind: DateKind }
  | { kind: "boolean"; words?: YesNoPair }
  | { kind: "string" };

/**
 * Whole words (in normalizeHeader form) that mark identifiers and codes. Used
 * together with narrower phone/postal/tracking checks in inferPlan to keep
 * such numbers as text: they need their leading zeros and no arithmetic.
 */
const ID_LIKE_NAME =
  /(^|_)(id|ids|code|pin|pincode|zip|zipcode|postal|postcode|phone|mobile|contact|sku|ean|upc|isbn|gtin|hsn|account|acct|awb|tracking|invoice|no|number|ref)(_|$)/;

/**
 * Digits a double is sure to hold exactly. A number written with more is a
 * code (a card or account number, a 19-digit message ID, GA4's user_pseudo_id
 * "1197596843.1673515430"): read as a number it would change, and two codes
 * could even become one.
 */
const EXACT_DIGITS = 15;

/**
 * True when `s` is a plain number with more digits than a double holds
 * exactly and should therefore stay text: a whole number (amounts that long
 * are written with grouping, not as one run of digits), or a decimal under an
 * ID-like name (elsewhere a long decimal is a measurement's float noise,
 * "12.971598700000001", and stays a number).
 */
function tooLongForANumber(s: string, idName: boolean): boolean {
  const m = /^[+-]?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return false;
  if (`${m[1]}${m[2] ?? ""}`.replace(/^0+/, "").length <= EXACT_DIGITS) return false;
  return m[2] === undefined || idName;
}

/** snake_case form of a header for the name tests here: "OrderID" → "order_id", "Pin Code" → "pin_code". */
export function normalizeHeader(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Decides the storage plan for a column from up to a few thousand sample cells.
 * Natively typed cells (workbooks, JSON) decide first: ≥ 95% typed dates,
 * booleans or numbers. Otherwise cells are compared as text and tried as
 * booleans (English tokens, then one other language's yes/no pair), then
 * dates, then numbers, then numbers with scale words. Numeric-looking codes
 * stay text (leading zeros, phone/PIN/ZIP/tracking/barcode names, more digits
 * than a double holds); date-named numbers may become numeric dates. Anything
 * else is text. All-null samples give text.
 */
export function inferPlan(samples: readonly CellValue[], columnName: string): ColumnPlan {
  const nonNull: CellValue[] = [];
  for (const v of samples) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && isNullToken(v)) continue;
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    nonNull.push(v);
  }
  const n = nonNull.length;
  if (n === 0) return { kind: "string" };

  let nums = 0;
  let bools = 0;
  let dates = 0;
  const strs: string[] = [];
  const numVals: number[] = [];
  for (const v of nonNull) {
    if (typeof v === "number") {
      nums++;
      numVals.push(v);
    } else if (typeof v === "boolean") bools++;
    else if (v instanceof WallClockDate) dates++;
    else strs.push(String(v).trim());
  }
  if (dates / n >= 0.95) return { kind: "date", dateKind: "typed" };
  if (bools / n >= 0.95) return { kind: "boolean" };
  const norm = normalizeHeader(columnName);
  if (nums / n >= 0.95) {
    const numericDate = detectNumericDateKind(numVals, columnName);
    if (numericDate) return { kind: "numeric-date", dateKind: numericDate };
    // Only phone/postal-like integers are forced to text; other ID-like integers stay numeric
    // and are labelled identifiers later by profile/roles.ts.
    if (
      ID_LIKE_NAME.test(norm) &&
      numVals.every((x) => Number.isInteger(x)) &&
      /phone|mobile|pin|zip|postal|contact/.test(norm)
    ) {
      return { kind: "string" };
    }
    return { kind: "number", style: "dot" };
  }

  // Text-encoded values: check booleans, dates, then numbers.
  const all = nonNull.map((v) =>
    typeof v === "string" ? v.trim() : v instanceof WallClockDate ? isoDate(v.ms) : String(v),
  );
  let boolHits = 0;
  const boolTokens = new Set<string>();
  for (const s of all) {
    if (parseBooleanToken(s) !== null) {
      boolHits++;
      boolTokens.add(s.toLowerCase());
    }
  }
  // At most four distinct spellings (case-insensitive), e.g. Yes/No/Y/N.
  if (boolHits / n >= 0.98 && boolTokens.size <= 4) return { kind: "boolean" };
  // Yes/no in another language: every value one pair's words ("Sim"/"Não", "VRAI"/"FAUX").
  const words = yesNoPairOf(all);
  if (words) return { kind: "boolean", words };

  const dd = detectDateKind(all, columnName);
  if (dd) return { kind: "date", dateKind: dd.kind, months: dd.months, evidence: dd.evidence };

  const { style, note } = detectNumberStyle(all);
  let numHits = 0;
  const parsed: number[] = [];
  for (const s of all) {
    const p = parseNumber(s, style);
    if (p) {
      numHits++;
      parsed.push(p.value);
    }
  }
  if (numHits / n >= 0.95) {
    // Any value with a leading zero ("007", "0123") in an all-integer column means codes, not quantities.
    const leadingZero = all.some((s) => /^0\d+$/.test(s));
    const allInt = parsed.every((x) => Number.isInteger(x));
    if (leadingZero && allInt) return { kind: "string" };
    if (
      ID_LIKE_NAME.test(norm) &&
      allInt &&
      /phone|mobile|pin|zip|postal|contact|awb|tracking|ean|upc|isbn|gtin/.test(norm)
    ) {
      return { kind: "string" };
    }
    const numericDate = detectNumericDateKind(parsed, columnName);
    if (numericDate) return { kind: "numeric-date", dateKind: numericDate };
    // Mostly longer than a double holds exactly (EXACT_DIGITS): codes, kept as written.
    const idName = ID_LIKE_NAME.test(norm);
    if (all.filter((s) => tooLongForANumber(s, idName)).length * 2 > numHits) return { kind: "string" };
    return { kind: "number", style, note };
  }
  // Every value with a scale word ("14.5 Lacs", "₹1.2 Cr", "3.4M") beside money or a header naming the scale.
  if (detectScaleWords(all, columnName, style)) return { kind: "number", style, note, scaled: true };
  return { kind: "string" };
}

// ---------------------------------------------------------------- accumulators

/** A built column plus its optional parse note and, for text dates, the format decision shown to the user. */
export interface FinishedColumn {
  column: Column;
  note?: ColumnParseNote;
  dateDecision?: DateFormatDecision | DayMonthDecision;
}

export interface Accumulator {
  /** One cell per row, in row order. */
  push(v: CellValue): void;
  /** Rows pushed so far. */
  readonly length: number;
  /** Called once, after the last row. */
  finish(name: string): FinishedColumn;
}

/**
 * Invalid cells after which the 5% test runs on every further invalid cell, so
 * a column that turns mostly invalid degrades at once instead of at finish().
 * Below it the decision waits for the whole column. It also bounds memory (see
 * TypedAccumulator); it never limits what is remembered.
 */
const EARLY_CHECK_AFTER = 25_000;
/** More than 5% invalid among non-null values = genuinely mixed column, kept as text. */
const DEGRADE_RATIO = 0.05;

/**
 * Canonical text of a cell for string columns and invalid-value examples;
 * null for missing values and empty text, and for null tokens unless
 * `keepTokens` (a text column keeps "NA" as written). Booleans become
 * TRUE/FALSE and typed dates ISO text (with the time when present).
 */
function cellToText(v: CellValue, keepTokens = false): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" || (!keepTokens && isNullToken(t)) ? null : t;
  }
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return v.hasTime ? isoDateTime(v.ms) : isoDate(v.ms);
}

/** Dictionary-encodes text in first-seen order; also the target when a typed column degrades. */
export class StringAccumulator implements Accumulator {
  private dict = new Map<string, number>();
  private values: string[] = [];
  private codes = new GrowI32();
  /** Values that had leading/trailing whitespace or control characters (trimmed by cellToText). */
  trimmed = 0;

  /**
   * @param blankTokens read "NA", "N/A", "-" … as blanks. Off for a text
   *   column, which keeps them as written; on for a typed column that fell
   *   back to text, whose earlier rows already read them as blanks.
   */
  constructor(private readonly blankTokens = false) {}

  get length(): number {
    return this.codes.len;
  }

  /** Appends already-normalised text (null = missing), without trimming or counting. */
  pushText(s: string | null): void {
    if (s === null) {
      this.codes.push(-1);
      return;
    }
    let code = this.dict.get(s);
    if (code === undefined) {
      code = this.values.length;
      this.dict.set(s, code);
      this.values.push(s);
    }
    this.codes.push(code);
  }

  push(v: CellValue): void {
    if (typeof v === "string" && v.length > 0) {
      const first = v.charCodeAt(0);
      const last = v.charCodeAt(v.length - 1);
      if (first <= 32 || last <= 32) this.trimmed++;
    }
    this.pushText(cellToText(v, !this.blankTokens));
  }

  finish(name: string): FinishedColumn {
    const column: StringColumn = { kind: "string", name, codes: this.codes.finish(), dict: this.values };
    const note =
      this.trimmed > 0
        ? {
            column: name,
            invalidCount: 0,
            examples: [],
            note: `Trimmed surrounding spaces in ${this.trimmed.toLocaleString("en-US")} values.`,
          }
        : undefined;
    return { column, note };
  }
}

/**
 * Shared invalid-value bookkeeping with lossless degradation to text.
 * Subclasses store exactly one slot per row and report whether the cell was
 * valid; nulls count as neither valid nor invalid, so the 5% ratio is taken
 * over non-null cells.
 *
 * Every invalid cell's original text is remembered, however many there are,
 * so falling back to text never blanks a value. The cost is 8 bytes per
 * invalid cell (its row and a code) plus each distinct invalid text once.
 * While a column stays typed it holds at most max(EARLY_CHECK_AFTER, about 5%
 * of its non-null cells) of them, because past EARLY_CHECK_AFTER it degrades
 * as soon as the invalid share passes 5%.
 */
abstract class TypedAccumulator implements Accumulator {
  /** Rows of invalid cells, ascending, and for each a code into invalidTexts. */
  private invalidRows = new GrowI32(256);
  private invalidCodes = new GrowI32(256);
  /** Distinct original texts of invalid cells in first-seen order; invalidIndex maps text → code. */
  private invalidTexts: string[] = [];
  private invalidIndex = new Map<string, number>();
  protected invalidCount = 0;
  protected validCount = 0;
  /** Once set, every further cell goes straight to this text column. */
  protected degraded: StringAccumulator | null = null;
  /** Extra sentence for the column's parse note, e.g. a doubtful decimal-separator choice. */
  protected remark?: string;

  abstract get length(): number;
  /** Stores one slot for the cell (a null marker if missing or invalid); false when invalid. */
  protected abstract pushTyped(v: CellValue): boolean;
  /** Text of the typed value stored at a row, null for a null slot; used when degrading. */
  protected abstract textAt(index: number): string | null;
  protected abstract finishTyped(name: string): FinishedColumn;

  push(v: CellValue): void {
    if (this.degraded) {
      this.degraded.push(v);
      return;
    }
    const index = this.length;
    if (!this.pushTyped(v)) {
      this.invalidCount++;
      const text = cellToText(v);
      if (text !== null) this.rememberInvalid(index, text);
      if (this.invalidCount >= EARLY_CHECK_AFTER && this.invalidShare() > DEGRADE_RATIO) this.degrade();
    }
  }

  protected rememberInvalid(row: number, text: string): void {
    let code = this.invalidIndex.get(text);
    if (code === undefined) {
      code = this.invalidTexts.length;
      this.invalidIndex.set(text, code);
      this.invalidTexts.push(text);
    }
    this.invalidRows.push(row);
    this.invalidCodes.push(code);
  }

  private invalidShare(): number {
    return this.invalidCount / (this.invalidCount + this.validCount);
  }

  private degrade(): void {
    // Replay the rows so far: invalid cells get their original text back, valid ones are
    // re-rendered from the typed value. Blank spellings stay blanks, as they were in the rows so far.
    const s = new StringAccumulator(true);
    const rows = this.invalidRows.buf;
    const codes = this.invalidCodes.buf;
    const m = this.invalidRows.len;
    let k = 0;
    for (let i = 0, n = this.length; i < n; i++) {
      if (k < m && rows[k] === i) s.pushText(this.invalidTexts[codes[k++] as number] as string);
      else s.pushText(this.textAt(i));
    }
    this.degraded = s;
    // The text column now holds every value; keep only what the note quotes.
    this.invalidRows = new GrowI32(1);
    this.invalidCodes = new GrowI32(1);
    this.invalidIndex.clear();
    this.invalidTexts = this.invalidTexts.slice(0, 3);
  }

  /** `text` followed by the remark, if any. */
  private withRemark(text: string): string {
    return this.remark ? `${text} ${this.remark}` : text;
  }

  finish(name: string): FinishedColumn {
    // Below EARLY_CHECK_AFTER the degrade decision is made only here, on the whole column's ratio.
    if (!this.degraded && this.invalidCount > 0 && this.invalidShare() > DEGRADE_RATIO) this.degrade();
    // Examples are the first three distinct invalid texts.
    const examples = this.invalidTexts.slice(0, 3);
    if (this.degraded) {
      const res = this.degraded.finish(name);
      return {
        column: res.column,
        note: {
          column: name,
          invalidCount: this.invalidCount,
          examples,
          note: this.withRemark(
            `Mixed types: ${this.invalidCount.toLocaleString("en-US")} values didn't match the dominant type, so the column was kept as text.`,
          ),
        },
      };
    }
    const res = this.finishTyped(name);
    // The column stayed typed, so its unreadable cells are blanks now: keep where they are and
    // what the file said, for the data check. Sorted because late invalidations append out of order.
    if (this.invalidRows.len > 0) {
      const m = this.invalidRows.len;
      const order = Array.from({ length: m }, (_, i) => i).sort(
        (a, b) => (this.invalidRows.buf[a] as number) - (this.invalidRows.buf[b] as number),
      );
      res.column = {
        ...res.column,
        unreadable: {
          rows: Int32Array.from(order, (i) => this.invalidRows.buf[i] as number),
          codes: Int32Array.from(order, (i) => this.invalidCodes.buf[i] as number),
          texts: [...this.invalidTexts],
        },
      };
    }
    if (this.invalidCount > 0) {
      res.note = {
        column: name,
        invalidCount: this.invalidCount,
        examples,
        note: this.withRemark(
          `${this.invalidCount.toLocaleString("en-US")} values couldn't be read and were treated as blank.`,
        ),
      };
    } else if (this.remark) {
      res.note = { column: name, invalidCount: 0, examples: [], note: this.remark };
    }
    return res;
  }
}

/**
 * Number column builder. Native numbers pass through, booleans become 1/0,
 * text is parsed in the column's NumberStyle and typed dates are invalid.
 * Format metadata: the most frequent currency if it appears on more than 30%
 * of valid values, and percent if more than half were written with %. A
 * scaled column reads "14.5 Lacs" at full size and plain numbers as written,
 * and its parse note says which scale words were read and how.
 */
export class NumberAccumulator extends TypedAccumulator {
  private values = new GrowF64();
  private currencies = new Map<string, number>();
  private percentHits = 0;
  private maxDecimals = 0;
  private allInteger = true;
  /** Scaled columns: values read with a scale word, and without one. */
  private scaledHits = 0;
  private plainHits = 0;
  /** First spelling of each scale word (folded → as written, power of ten) and the first scaled value, for the note. */
  private scaleWords = new Map<string, { written: string; exponent: number }>();
  private scaledExample = "";

  /**
   * @param styleNote why the decimal separator is in doubt (ColumnPlan note), added to the column's parse note.
   * @param scaled read scale words at full size (values.detectScaleWords).
   */
  constructor(
    private readonly style: NumberStyle,
    styleNote?: string,
    private readonly scaled = false,
  ) {
    super();
    this.remark = styleNote;
  }

  get length(): number {
    return this.values.len;
  }

  private track(v: number): void {
    if (this.allInteger && !Number.isInteger(v)) this.allInteger = false;
    // Decimal places are sampled from the first 20,000 values to keep String() off the per-cell path.
    if (this.validCount < 20_000 && !Number.isInteger(v)) {
      const frac = String(v).split(".")[1];
      if (frac) this.maxDecimals = Math.max(this.maxDecimals, Math.min(6, frac.length));
    }
  }

  protected pushTyped(v: CellValue): boolean {
    if (v === null || v === undefined) {
      this.values.push(NaN);
      return true;
    }
    if (typeof v === "number") {
      if (!Number.isFinite(v)) {
        this.values.push(NaN);
        return true;
      }
      this.values.push(v);
      this.validCount++;
      this.track(v);
      return true;
    }
    if (typeof v === "boolean") {
      this.values.push(v ? 1 : 0);
      this.validCount++;
      return true;
    }
    if (v instanceof WallClockDate) {
      this.values.push(NaN);
      return false;
    }
    const s = v.trim();
    if (isNullToken(s)) {
      this.values.push(NaN);
      return true;
    }
    const p = this.scaled ? this.readScaled(s) : parseNumber(s, this.style);
    if (!p) {
      this.values.push(NaN);
      return false;
    }
    if (p.currency) this.currencies.set(p.currency, (this.currencies.get(p.currency) ?? 0) + 1);
    if (p.percent) this.percentHits++;
    this.values.push(p.value);
    this.validCount++;
    this.track(p.value);
    return true;
  }

  /** A cell of a scaled column: at full size when it has a scale word, as written when it has none. */
  private readScaled(s: string): ReturnType<typeof parseNumber> {
    const scaled = parseScaledNumber(s, this.style);
    if (!scaled) {
      const plain = parseNumber(s, this.style);
      if (plain) this.plainHits++;
      return plain;
    }
    this.scaledHits++;
    const key = foldWord(scaled.word);
    if (!this.scaleWords.has(key))
      this.scaleWords.set(key, { written: scaled.word, exponent: scaled.scale.exponent });
    if (!this.scaledExample) this.scaledExample = s;
    return scaled;
  }

  /** The parse-report sentence for a scaled column, in words so it reads the same in every number system. */
  private scaleNote(): string | undefined {
    if (this.scaledHits === 0) return undefined;
    const words = [...this.scaleWords.values()]
      .slice(0, 4)
      .map((w) => `"${w.written}" as ${SCALE_NAMES[w.exponent] ?? `10^${w.exponent}`}`);
    const list =
      words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0];
    const who =
      this.plainHits === 0
        ? "Every value carries a scale word"
        : `${this.scaledHits.toLocaleString("en-US")} values carry a scale word`;
    const plain =
      this.plainHits > 0
        ? ` ${this.plainHits.toLocaleString("en-US")} ${this.plainHits === 1 ? "value" : "values"} without one ${this.plainHits === 1 ? "was" : "were"} read as written.`
        : "";
    return `${who} (such as "${this.scaledExample}"), so each was read at full size: ${list}.${plain}`;
  }

  protected textAt(i: number): string | null {
    const v = this.values.buf[i] as number;
    return v === v ? String(v) : null;
  }

  protected finishTyped(name: string): FinishedColumn {
    const scaleNote = this.scaleNote();
    if (scaleNote) this.remark = this.remark ? `${scaleNote} ${this.remark}` : scaleNote;
    let currency: string | undefined;
    let best = 0;
    for (const [code, count] of this.currencies) {
      if (count > best) {
        best = count;
        currency = code;
      }
    }
    const percent = this.percentHits > this.validCount * 0.5;
    const column: NumberColumn = {
      kind: "number",
      name,
      values: this.values.finish(),
      format: {
        currency: best > this.validCount * 0.3 ? currency : undefined,
        percent: percent || undefined,
        integer: this.allInteger,
        // Dividing by 100 added two decimals; report the precision as written (12.5% → 1).
        decimals: percent ? Math.max(0, this.maxDecimals - 2) : this.maxDecimals,
      },
    };
    return { column };
  }
}

/**
 * Boolean column builder: accepts native booleans, numeric 0/1 and boolean
 * tokens, and remembers the most common original spellings as display labels.
 * A column written in another language's yes/no pair accepts that pair's
 * words only (a column never mixes languages), so its labels stay the file's
 * own ("Sim"/"Não") and every export keeps them (core/booleans.ts).
 */
export class BooleanAccumulator extends TypedAccumulator {
  private values: number[] = [];
  /** Original spelling → count (case-sensitive; native booleans count as "TRUE"/"FALSE"). */
  private labelCounts = new Map<string, number>();

  /** @param words the other language's yes/no pair the column is written in (values.yesNoPairOf); English when absent. */
  constructor(private readonly words?: YesNoPair) {
    super();
  }

  get length(): number {
    return this.values.length;
  }

  /** true/false for a written value in the column's language, else null. */
  private truth(s: string): boolean | null {
    return this.words ? yesNoTruth(this.words, s) : parseBooleanToken(s);
  }

  /** The truth a remembered label stands for; native booleans are remembered as "TRUE"/"FALSE". */
  private labelTruth(label: string): boolean | null {
    if (label === "TRUE") return true;
    if (label === "FALSE") return false;
    return this.truth(label);
  }

  protected pushTyped(v: CellValue): boolean {
    if (v === null || v === undefined) {
      this.values.push(-1);
      return true;
    }
    if (typeof v === "boolean") {
      this.values.push(v ? 1 : 0);
      this.validCount++;
      const label = v ? "TRUE" : "FALSE";
      this.labelCounts.set(label, (this.labelCounts.get(label) ?? 0) + 1);
      return true;
    }
    if (typeof v === "number" && (v === 0 || v === 1)) {
      this.values.push(v);
      this.validCount++;
      return true;
    }
    const s = typeof v === "string" ? v.trim() : "";
    if (typeof v === "string" && isNullToken(s)) {
      this.values.push(-1);
      return true;
    }
    const b = this.truth(s);
    if (b === null) {
      this.values.push(-1);
      return false;
    }
    this.values.push(b ? 1 : 0);
    this.validCount++;
    this.labelCounts.set(s, (this.labelCounts.get(s) ?? 0) + 1);
    return true;
  }

  protected textAt(i: number): string | null {
    const v = this.values[i];
    return v === 1 ? this.label(true) : v === 0 ? this.label(false) : null;
  }

  /** Most frequent spelling seen for this truth value; else the partner of the other value's ("No" → "Yes"), else "TRUE"/"FALSE". */
  private label(truthy: boolean): string {
    const seen = this.spelling(truthy);
    if (seen !== null) return seen;
    // A column that only ever says "No" still gets a "Yes" of its own spelling, so its labels, the
    // conditions written for it and the profile never show a TRUE the file does not use. A column in
    // another language gets its pair's word ("Não" → "Sim").
    const other = this.spelling(!truthy);
    if (other === null) return truthy ? "TRUE" : "FALSE";
    if (!this.words || other === "TRUE" || other === "FALSE") return partnerLabel(other);
    return inCaseOf(truthy ? this.words.yesLabel : this.words.noLabel, other);
  }

  /** Most frequent spelling seen for this truth value; null when there is none. */
  private spelling(truthy: boolean): string | null {
    let best: string | null = null;
    let count = 0;
    for (const [label, c] of this.labelCounts) {
      if (this.labelTruth(label) === truthy && c > count) {
        best = label;
        count = c;
      }
    }
    return best;
  }

  protected finishTyped(name: string): FinishedColumn {
    const column: BooleanColumn = {
      kind: "boolean",
      name,
      values: Int8Array.from(this.values),
      trueLabel: this.label(true),
      falseLabel: this.label(false),
    };
    return { column };
  }
}

/** Yes ↔ No, Y ↔ N, True ↔ False, T ↔ F, written in the same case as `label` (YES → NO, yes → no). */
function partnerLabel(label: string): string {
  const pairs: Record<string, string> = {
    yes: "no",
    no: "yes",
    y: "n",
    n: "y",
    true: "false",
    false: "true",
    t: "f",
    f: "t",
  };
  const other = pairs[label.toLowerCase()] ?? (parseBooleanToken(label) ? "false" : "true");
  return inCaseOf(other, label);
}

/** `word` in the case `like` is written in: all capitals (NÃO → SIM), a capital first (Não → Sim) or lower case. */
function inCaseOf(word: string, like: string): string {
  if (like === like.toUpperCase()) return word.toUpperCase();
  if (like[0] === like[0]?.toUpperCase()) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  return word.toLowerCase();
}

/**
 * Date column builder for every flavour: typed spreadsheet cells ("typed"),
 * numeric encodings (`numeric`), unambiguous text patterns, and ambiguous
 * "nn-nn-y" text, whose parts are buffered until finish() so the day/month
 * order can be decided from the whole column.
 */
export class DateAccumulator extends TypedAccumulator {
  private ms = new GrowF64();
  /** Ambiguous "nn/nn/yyyy": parts kept until the whole column has been seen. */
  private partA: GrowI32 | null = null;
  private partB: GrowI32 | null = null;
  private partY: GrowI32 | null = null;
  /** Seconds since midnight. Null rows have partA = -1. */
  private partS: GrowI32 | null = null;
  /**
   * Rows that are real dates only day-first (first part above 12, e.g. 15/04/2025): proof of day-first.
   * Impossible values such as 45/03/2024 are rejected on arrival and prove nothing.
   */
  private firstGt12 = 0;
  /** Rows that are real dates only month-first (second part above 12, e.g. 04/15/2025): proof of month-first. */
  private secondGt12 = 0;
  /** First value of each kind, quoted in the evidence text. */
  private firstExample = "";
  private secondExample = "";
  private hasTime = false;
  /** Month-name languages the column may still be written in; each value's month word narrows it, so languages never mix. */
  private months: number;
  /** The plan's explanation for the parse report ("01.2025" read as a month). */
  private readonly evidence?: string;

  /**
   * @param numeric values are numbers encoding `kind` (Excel serial, Unix time).
   * @param preferDayFirst fallback order when no value proves either order.
   * @param forcedOrder user override; skips the evidence entirely.
   * @param read the plan's month-name languages and evidence (ColumnPlan "date").
   */
  constructor(
    private readonly kind: DateKind | "typed",
    private readonly numeric: boolean,
    private readonly preferDayFirst: boolean,
    private readonly forcedOrder?: "DMY" | "MDY",
    read: { months?: number; evidence?: string } = {},
  ) {
    super();
    this.months = read.months || ANY_MONTH_LANGUAGE;
    this.evidence = read.evidence;
    if (kind === "nn-nn-y") {
      this.partA = new GrowI32();
      this.partB = new GrowI32();
      this.partY = new GrowI32();
      this.partS = new GrowI32();
    }
  }

  get length(): number {
    return this.partA ? this.partA.len : this.ms.len;
  }

  private pushNull(): void {
    if (this.partA) {
      this.partA.push(-1);
      this.partB?.push(-1);
      this.partY?.push(-1);
      this.partS?.push(0);
    } else this.ms.push(NaN);
  }

  protected pushTyped(v: CellValue): boolean {
    if (v === null || v === undefined) {
      this.pushNull();
      return true;
    }
    if (v instanceof WallClockDate) {
      // A typed date cannot join a column that buffers DD/MM parts, so it counts as invalid there.
      if (this.partA) {
        this.pushNull();
        return false;
      }
      this.ms.push(v.ms);
      if (v.hasTime || v.ms % 86_400_000 !== 0) this.hasTime = true;
      this.validCount++;
      return true;
    }
    if (this.numeric && typeof v === "number") {
      const t = numericDateToMs(v, this.kind as DateKind);
      if (!Number.isFinite(t)) {
        this.ms.push(NaN);
        return false;
      }
      if (t % 86_400_000 !== 0) this.hasTime = true;
      this.ms.push(t);
      this.validCount++;
      return true;
    }
    const s = typeof v === "string" ? v.trim() : String(v);
    if (isNullToken(s)) {
      this.pushNull();
      return true;
    }
    if (this.numeric) {
      // Numeric dates written as text ("45123" in a CSV).
      const p = parseNumber(s);
      const t = p ? numericDateToMs(p.value, this.kind as DateKind) : NaN;
      this.ms.push(t);
      if (t === t) {
        this.validCount++;
        if (t % 86_400_000 !== 0) this.hasTime = true;
        return true;
      }
      return false;
    }
    if (this.kind === "typed") {
      this.ms.push(NaN);
      return false;
    }
    const parts = parseDateParts(s, this.kind, this.months);
    if (!parts) {
      this.pushNull();
      return false;
    }
    if (this.partA && this.partB && this.partY && this.partS) {
      const dayFirst = !Number.isNaN(partsToMs(parts, "nn-nn-y", true));
      const monthFirst = !Number.isNaN(partsToMs(parts, "nn-nn-y", false));
      // Impossible in both orders (45/03/2024, 31/02/2025): invalid whichever order is chosen, so it
      // is rejected now, keeping its text, and is no evidence for either order.
      if (!dayFirst && !monthFirst) {
        this.pushNull();
        return false;
      }
      if (parts.hasTime) this.hasTime = true;
      // Counted valid for now: a value that exists in one order only is counted invalid in
      // finishTyped if the other order is chosen.
      this.partA.push(parts.a);
      this.partB.push(parts.b);
      this.partY.push(parts.y);
      this.partS.push(parts.secs);
      if (dayFirst && !monthFirst) {
        this.firstGt12++;
        if (!this.firstExample) this.firstExample = s;
      } else if (monthFirst && !dayFirst) {
        this.secondGt12++;
        if (!this.secondExample) this.secondExample = s;
      }
      this.validCount++;
      return true;
    }
    if (parts.hasTime) this.hasTime = true;
    const t = partsToMs(parts, this.kind, false);
    this.ms.push(t);
    if (t === t) {
      // A month word that only some of the column's languages write settles the column on them.
      if (parts.languages) this.months = parts.languages;
      this.validCount++;
      return true;
    }
    return false;
  }

  protected textAt(i: number): string | null {
    if (this.partA && this.partB && this.partY) {
      // Re-rendered as "a/b/y" in the original order; any time of day is dropped.
      const a = this.partA.buf[i] as number;
      if (a < 0) return null;
      return `${a}/${this.partB.buf[i]}/${this.partY.buf[i]}`;
    }
    const v = this.ms.buf[i] as number;
    return v === v ? isoDateTime(v) : null;
  }

  protected finishTyped(name: string): FinishedColumn {
    if (!(this.partA && this.partB && this.partY && this.partS)) {
      const values = this.ms.finish();
      // A column of times ("20:15", or Excel time cells that arrive as 30 Dec 1899 20:15) keeps only
      // its time of day: it is never mixed with a date, and never becomes the dashboard's date.
      if (this.kind === "time" || isTimeOnlyColumn(values)) {
        for (let i = 0; i < values.length; i++) {
          const v = values[i] as number;
          if (v === v) values[i] = ((v % DAY_MS) + DAY_MS) % DAY_MS;
        }
        const label = DATE_KIND_LABEL.time;
        return {
          column: { kind: "date", name, values, hasTime: true, timeOnly: true, format: label },
          dateDecision:
            this.kind === "typed"
              ? undefined
              : { column: name, format: label, evidence: "Unambiguous pattern.", ambiguous: false },
        };
      }
      const label = this.kind === "typed" ? "Spreadsheet date" : describeKind(this.kind, false, this.hasTime);
      const column: DateColumn = {
        kind: "date",
        name,
        values,
        hasTime: this.hasTime,
        format: label,
      };
      // Month names say their language once the whole column has narrowed it; other readings that need
      // explaining ("01.2025" as a month) carry the plan's evidence.
      const evidence = monthLanguageEvidence(this.months) ?? this.evidence ?? "Unambiguous pattern.";
      return {
        column,
        dateDecision:
          this.kind === "typed" ? undefined : { column: name, format: label, evidence, ambiguous: false },
      };
    }
    // Resolve day/month order from whole-column evidence. A manual override wins; one-sided
    // evidence decides; no evidence falls back to the caller's preference and is flagged ambiguous
    // so the user is told; conflicting evidence takes the majority (ties → day-first) and blanks
    // the minority rows.
    let dayFirst: boolean;
    let evidence: string;
    let ambiguous = false;
    if (this.forcedOrder) {
      dayFirst = this.forcedOrder === "DMY";
      evidence = "Set manually.";
    } else if (this.firstGt12 > 0 && this.secondGt12 === 0) {
      dayFirst = true;
      evidence = `${this.firstGt12.toLocaleString("en-US")} values have a first part above 12 (e.g. ${this.firstExample}), so the first part must be the day.`;
    } else if (this.secondGt12 > 0 && this.firstGt12 === 0) {
      dayFirst = false;
      evidence = `${this.secondGt12.toLocaleString("en-US")} values have a second part above 12 (e.g. ${this.secondExample}), so the second part must be the day.`;
    } else if (this.firstGt12 === 0 && this.secondGt12 === 0) {
      dayFirst = this.preferDayFirst;
      ambiguous = true;
      // The preference comes from where the user is (the app passes the device's region), never
      // from an earlier file, so the same file always reads the same way.
      evidence = dayFirst
        ? "No date has a day above 12, so the order can't be proven. Assumed day first (DD/MM), as dates are written where you are."
        : "No date has a day above 12, so the order can't be proven. Assumed month first (MM/DD), as dates are written where you are.";
    } else {
      dayFirst = this.firstGt12 >= this.secondGt12;
      evidence = `Conflicting evidence: ${this.firstGt12} values look day-first and ${this.secondGt12} look month-first. Chose the majority; the minority rows were set to blank.`;
    }
    const n = this.partA.len;
    const out = new Float64Array(n);
    let invalidAfter = 0;
    for (let i = 0; i < n; i++) {
      const a = this.partA.buf[i] as number;
      if (a < 0) {
        out[i] = NaN;
        continue;
      }
      const t = partsToMs(
        {
          a,
          b: this.partB.buf[i] as number,
          y: this.partY.buf[i] as number,
          secs: this.partS.buf[i] as number,
          hasTime: false,
        },
        "nn-nn-y",
        dayFirst,
      );
      out[i] = t;
      if (t !== t) {
        invalidAfter++;
        // Only real in the other day/month order: remembered so the data check can show it.
        this.rememberInvalid(i, this.textAt(i) ?? "");
      }
    }
    // Rows that exist only in the other order become invalid here, after finish() has decided whether
    // to degrade, so they show in the note's count but never turn the column into text.
    if (invalidAfter > 0) this.invalidCount += invalidAfter;
    const label = describeKind("nn-nn-y", dayFirst, this.hasTime);
    const column: DateColumn = { kind: "date", name, values: out, hasTime: this.hasTime, format: label };
    const dateDecision: DayMonthDecision = {
      column: name,
      format: label,
      evidence,
      ambiguous,
      alternative: describeKind("nn-nn-y", !dayFirst, this.hasTime),
      // The dates real only in the order chosen are the ones the other order cannot read.
      blankIfSwitched: dayFirst ? this.firstGt12 : this.secondGt12,
    };
    return { column, dateDecision };
  }
}

/** Accumulator for a plan; `forcedOrder` only matters for text dates. */
export function createAccumulator(
  plan: ColumnPlan,
  opts: { preferDayFirst: boolean; forcedOrder?: "DMY" | "MDY" },
): Accumulator {
  switch (plan.kind) {
    case "number":
      return new NumberAccumulator(plan.style, plan.note, plan.scaled);
    case "boolean":
      return new BooleanAccumulator(plan.words);
    case "date":
      return new DateAccumulator(plan.dateKind, false, opts.preferDayFirst, opts.forcedOrder, {
        months: plan.months,
        evidence: plan.evidence,
      });
    case "numeric-date":
      return new DateAccumulator(plan.dateKind, true, opts.preferDayFirst);
    case "string":
      return new StringAccumulator();
  }
}

/**
 * `name`, or the first of "name (2)", "name (3)", … that is not in `used`
 * (lower-cased names); the result is added to `used`.
 */
export function uniqueName(name: string, used: Set<string>): string {
  let candidate = name;
  for (let k = 2; used.has(candidate.toLowerCase()); k++) candidate = `${name} (${k})`;
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Makes header names unique (case-insensitively) and non-empty.
 * Collapses whitespace and line breaks and names blanks "Column N" (1-based
 * position). The first occurrence of each name written in the file keeps it;
 * repeats and blanks then take the first free " (2)", " (3)", … suffix, so a
 * suffix never collides with a real header: ["A", "A", "A (2)"] becomes
 * ["A", "A (3)", "A (2)"].
 */
export function cleanHeaders(raw: readonly (string | null | undefined)[]): string[] {
  const names = raw.map((h) =>
    String(h ?? "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
  const used = new Set<string>();
  const keep = names.map((name) => {
    const key = name.toLowerCase();
    if (!name || used.has(key)) return false;
    used.add(key);
    return true;
  });
  return names.map((name, i) => (keep[i] ? name : uniqueName(name || `Column ${i + 1}`, used)));
}

/**
 * The parse-report sentence for headers cleanHeaders had to rename: repeats
 * ("Amount" twice → "Amount (2)") and blank header cells ("Column 2"), so the
 * user can see why a column is not called what the file says. Null when every
 * header was kept. `skip` marks positions left out of the dataset.
 */
export function headerRenameNote(
  raw: readonly (string | null | undefined)[],
  names: readonly string[],
  skip: ReadonlySet<number> = new Set(),
): string | null {
  const repeated: string[] = [];
  const blank: string[] = [];
  raw.forEach((h, i) => {
    if (skip.has(i)) return;
    const written = String(h ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const name = names[i] as string;
    if (!written) blank.push(`"${name}"`);
    else if (name !== written) repeated.push(`"${written}" → "${name}"`);
  });
  const parts: string[] = [];
  if (repeated.length)
    parts.push(
      `repeated headers were numbered (${repeated.slice(0, 4).join(", ")}${repeated.length > 4 ? ", …" : ""})`,
    );
  if (blank.length)
    parts.push(
      `${blank.length === 1 ? "a column with no header was" : `${blank.length} columns with no header were`} named ${blank.slice(0, 4).join(", ")}${blank.length > 4 ? ", …" : ""}`,
    );
  if (!parts.length) return null;
  const text = parts.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** True for a column with no value in any row (a blank string column, or numbers or dates that are all blank). */
export function isEmptyColumn(col: Column): boolean {
  if (col.kind === "string") return col.codes.every((c) => c < 0);
  if (col.kind === "boolean") return col.values.every((v) => v < 0);
  return col.values.every((v) => v !== v);
}
