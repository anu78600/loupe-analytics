/**
 * Encoding, delimiter and header-row detection for delimited text files.
 *
 * Runs on the first megabyte only (see csv.ts). detectHeader is also used by
 * excel.ts on the displayed text of the first sheet rows, so it must not
 * assume CSV specifics.
 */
import Papa from "papaparse";
import { detectDateKind } from "./dates";
import { isNullToken, parseNumber } from "./values";

export type TextEncodingName = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

/**
 * Detects encoding from a byte prefix: BOM first, then strict UTF-8 validation.
 * Anything that is not valid UTF-8 is read as windows-1252, which decodes every
 * byte. UTF-16 without a BOM is not recognised.
 */
export function detectEncoding(bytes: Uint8Array): TextEncodingName {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  // Drop a possibly truncated trailing multi-byte sequence before validating.
  let end = bytes.length;
  for (let back = 1; back <= 3 && end - back >= 0; back++) {
    const b = bytes[end - back] as number;
    if ((b & 0xc0) === 0xc0) {
      end = end - back;
      break;
    }
    if ((b & 0x80) === 0) break;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
    return "utf-8";
  } catch {
    return "windows-1252";
  }
}

/** Delimiters tried, in order; on an equal score the earlier one wins. */
const CANDIDATES = [",", "\t", ";", "|"] as const;

/** Most frequent value (ties → the larger value) and its share of all values; share 0 when empty. */
function mode(values: number[]): { value: number; share: number } {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount || (c === bestCount && v > best)) {
      best = v;
      bestCount = c;
    }
  }
  return { value: best, share: values.length ? bestCount / values.length : 0 };
}

/**
 * Picks the delimiter that yields the most consistent multi-field rows.
 * A ".tsv" name forces tab. Each candidate parses up to 120 rows; candidates
 * whose usual row width is under 2 fields are skipped, and "," is the fallback.
 */
export function detectDelimiter(sample: string, fileNameHint?: string): string {
  if (fileNameHint && /\.tsv$/i.test(fileNameHint)) return "\t";
  let best: { d: string; score: number } = { d: ",", score: -1 };
  for (const d of CANDIDATES) {
    const res = Papa.parse<string[]>(sample, { delimiter: d, preview: 120, skipEmptyLines: "greedy" });
    const lengths = res.data.map((r) => r.length);
    if (lengths.length === 0) continue;
    const m = mode(lengths);
    if (m.value < 2) continue;
    // Consistency matters most; more fields is a tie-breaker.
    // On this scale 10 percentage points of consistency are worth a doubling of the field count.
    const score = m.share * 10 + Math.log2(m.value);
    if (score > best.score) best = { d, score };
  }
  return best.d;
}

type CellKind = "empty" | "number" | "date" | "text";

/**
 * Coarse type of one cell for header detection. Without a column name, "date"
 * is passed so name-gated kinds ("2025-03") count as dates; numbers are tested
 * first, so eight-digit values stay numbers.
 */
function cellKind(raw: string, columnName = ""): CellKind {
  const s = raw.trim();
  if (!s || isNullToken(s)) return "empty";
  if (parseNumber(s)) return "number";
  if (detectDateKind([s], columnName || "date")) return "date";
  return "text";
}

export interface HeaderDetection {
  /**
   * Index into the given rows of the header, or of the first data row when
   * there is none; rows above it are titles or notes.
   */
  headerIndex: number;
  /** False when that row reads like data; callers name columns Column 1…N and keep the row as data. */
  hasHeader: boolean;
  /** The usual row width, or the candidate row's width if wider. */
  columnCount: number;
}

/**
 * Finds the header row: skips title/blank rows above the table, then checks
 * whether the first full-width row reads like labels rather than data.
 *
 * Looks at the first 60 rows. The candidate is the first row at least 80% as
 * wide as the usual width with at least 60% non-blank cells. It is a header
 * when ≥ 80% of its cells are text, the labels are unique (case-insensitive),
 * and some text label sits above a column whose non-blank cells in the next
 * 25 rows are ≥ 80% numbers or dates, or the body has no numbers or dates at
 * all. A candidate with no rows below it counts as a header.
 */
export function detectHeader(rows: readonly string[][]): HeaderDetection {
  const head = rows.slice(0, 60);
  if (head.length === 0) return { headerIndex: 0, hasHeader: true, columnCount: 0 };
  const width = mode(head.map((r) => r.length)).value;
  // Title and note rows above a table are usually narrower or mostly blank, so they are skipped.
  let idx = head.findIndex(
    (r) =>
      r.length >= Math.max(2, Math.ceil(width * 0.8)) &&
      r.filter((c) => c.trim()).length >= Math.ceil(width * 0.6),
  );
  if (idx < 0) idx = 0;
  const candidate = head[idx] ?? [];
  const body = head.slice(idx + 1, idx + 26);
  if (body.length === 0)
    return { headerIndex: idx, hasHeader: true, columnCount: Math.max(width, candidate.length) };

  const headerKinds = candidate.map((c) => cellKind(c));
  const distinct = new Set(candidate.map((c) => c.trim().toLowerCase())).size;
  // Share of the column below that holds numbers (dates excluded), for period labels.
  const numericBelow = (j: number): number => {
    const kinds = body.map((r) => cellKind(r[j] ?? "")).filter((k) => k !== "empty");
    return kinds.length ? kinds.filter((k) => k === "number").length / kinds.length : 0;
  };
  // Wide tables label their columns with periods ("Jan 2024", "Q1 2024", "2024"), which read as dates or
  // numbers. They still count as labels when numbers sit underneath a date-like label, or when the row's
  // years are distinct and ascending (2022, 2023, 2024), which a data row almost never is.
  const years = candidate
    .map((c) => c.trim())
    .filter((c) => /^(?:19|20)\d{2}$/.test(c))
    .map(Number);
  const yearsAscending = years.length >= 2 && years.every((y, i) => i === 0 || y > (years[i - 1] as number));
  const periodLabel = candidate.map((c, j) => {
    if (headerKinds[j] === "date") return numericBelow(j) >= 0.8;
    if (headerKinds[j] === "number")
      return yearsAscending && /^(?:19|20)\d{2}$/.test(c.trim()) && numericBelow(j) >= 0.8;
    return false;
  });
  const textCells = headerKinds.filter((k, j) => k === "text" || periodLabel[j]).length;
  let typeContrast = 0;
  for (let j = 0; j < candidate.length; j++) {
    if (periodLabel[j]) {
      typeContrast++;
      continue;
    }
    if (headerKinds[j] !== "text") continue;
    const colKinds = body.map((r) => cellKind(r[j] ?? ""));
    const nonEmpty = colKinds.filter((k) => k !== "empty");
    if (
      nonEmpty.length &&
      nonEmpty.filter((k) => k === "number" || k === "date").length / nonEmpty.length >= 0.8
    )
      typeContrast++;
  }
  const mostlyText = textCells / Math.max(1, candidate.length) >= 0.8;
  const unique = distinct === candidate.length;
  // Labels: mostly text, unique, and typed columns underneath (or no typed columns at all).
  const bodyHasTyped = candidate.some((_, j) =>
    body.some((r) => {
      const k = cellKind(r[j] ?? "");
      return k === "number" || k === "date";
    }),
  );
  const hasHeader = mostlyText && unique && (typeContrast > 0 || !bodyHasTyped);
  return { headerIndex: idx, hasHeader, columnCount: Math.max(width, candidate.length) };
}
