/**
 * CSV writer with CSV-injection protection.
 *
 * Text cells starting with = @ TAB or CR are prefixed with an apostrophe so
 * spreadsheet apps never evaluate them as formulas. Cells starting with + or -
 * are prefixed too, unless they are plain numbers or phone numbers
 * (e.g. "+91 98765 43210"), which spreadsheets don't execute. Numeric
 * columns are written raw and never altered.
 *
 * Output is RFC 4180 style: comma-separated, CRLF line endings, fields quoted
 * only when needed, dates as ISO text, booleans as TRUE/FALSE, blanks empty.
 * The guard alters the stored text, so the DuckDB verification path writes
 * unguarded CSV to compare like for like.
 */
import type { Column, Dataset } from "@/engine/core/types";
import { isoDate, isoDateTime, isoTime } from "@/engine/core/dates";

const DANGEROUS_START = /^[=@\t\r]/;
const SIGN_START = /^[+-]/;
// Digits, spaces, parentheses, dots, commas and hyphens only: a signed
// number or phone number. Nothing in this set can call a function or DDE.
const SAFE_SIGNED = /^[+-]?[\d\s().,-]+$/;

/** Prefixes a text cell with `'` when a spreadsheet could evaluate it as a formula (see file header). */
export function guardCell(value: string): string {
  if (DANGEROUS_START.test(value)) return `'${value}`;
  if (SIGN_START.test(value) && !SAFE_SIGNED.test(value)) return `'${value}`;
  return value;
}

/**
 * Quotes a field when it contains the delimiter, a quote or a line break, or
 * has leading/trailing whitespace (which some readers would otherwise trim).
 * Inner quotes are doubled.
 */
export function quoteCsv(value: string, delimiter = ","): string {
  if (value === "") return "";
  if (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r") ||
    value !== value.trim()
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Plain machine-readable number: no grouping, dot decimal, NaN → "".
 * Rounds to 15 significant digits to drop binary noise (0.1 + 0.2 is written
 * as 0.3); very small or very large magnitudes keep JS's own formatting,
 * which may use exponent notation.
 */
export function formatNumberCell(v: number): string {
  if (v !== v) return "";
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  const a = Math.abs(v);
  if (a >= 1e-6 && a < 1e15) return String(Number(v.toPrecision(15)));
  return String(v);
}

function cellText(col: Column, r: number, guard: boolean): string {
  switch (col.kind) {
    case "number":
      return formatNumberCell(col.values[r] as number);
    case "date": {
      const v = col.values[r] as number;
      if (v !== v) return "";
      return col.timeOnly ? isoTime(v) : col.hasTime ? isoDateTime(v) : isoDate(v);
    }
    case "boolean": {
      const v = col.values[r] as number;
      return v < 0 ? "" : v === 1 ? "TRUE" : "FALSE";
    }
    case "string": {
      const c = col.codes[r] as number;
      if (c < 0) return "";
      const s = col.dict[c] as string;
      return quoteCsv(guard ? guardCell(s) : s);
    }
  }
}

export interface CsvOptions {
  /** Original column name → output header. */
  headers?: Map<string, string>;
  /** Formula-injection guard for text cells; on unless explicitly false. */
  guardInjection?: boolean;
  /** Row indices to write (e.g. a filtered selection), in this order; default all rows. */
  rows?: Int32Array;
  /** Column subset by original name; output keeps dataset order, not this order. */
  columns?: readonly string[];
}

/**
 * CSV as chunks of ~50k rows (Blob-friendly; avoids one giant string).
 * The first chunk is the header row. Header names are quoted but not guarded.
 */
export function datasetToCsvChunks(ds: Dataset, opts: CsvOptions = {}, chunkRows = 50_000): string[] {
  const guard = opts.guardInjection ?? true;
  const cols = opts.columns ? ds.columns.filter((c) => opts.columns?.includes(c.name)) : [...ds.columns];
  const header = cols.map((c) => quoteCsv(opts.headers?.get(c.name) ?? c.name)).join(",");
  const chunks: string[] = [`${header}\r\n`];
  const n = opts.rows ? opts.rows.length : ds.rowCount;
  let buf: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = opts.rows ? (opts.rows[i] as number) : i;
    let line = "";
    for (let j = 0; j < cols.length; j++) {
      if (j) line += ",";
      line += cellText(cols[j] as Column, r, guard);
    }
    buf.push(line);
    if (buf.length >= chunkRows) {
      chunks.push(`${buf.join("\r\n")}\r\n`);
      buf = [];
    }
  }
  if (buf.length) chunks.push(`${buf.join("\r\n")}\r\n`);
  return chunks;
}

/** Single-string variant; prefer the chunked form for large datasets. */
export function datasetToCsv(ds: Dataset, opts: CsvOptions = {}): string {
  return datasetToCsvChunks(ds, opts).join("");
}

/**
 * Generic CSV for a small table of already-formatted values. Every string
 * cell, the header included, is always guarded: these tables carry labels
 * taken from the data (category names, segments).
 */
export function tableToCsv(
  header: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null>>,
): string {
  const line = (cells: ReadonlyArray<string | number | null>) =>
    cells
      .map((c) => (c === null ? "" : typeof c === "number" ? formatNumberCell(c) : quoteCsv(guardCell(c))))
      .join(",");
  return [line(header), ...rows.map(line)].join("\r\n") + "\r\n";
}
