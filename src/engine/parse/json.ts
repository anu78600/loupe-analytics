/**
 * JSON / NDJSON ingestion: arrays of records, wrapped arrays, array-of-arrays,
 * and the layouts pandas writes (to_json's default "columns" orient, "index"
 * and "split").
 *
 * Records are flattened (nested objects become dotted columns, up to four
 * levels; arrays become text) and then go through the same plan/accumulator
 * path as CSV. Columns are the union of keys across all records, in
 * first-seen order, so a field that only appears late is still kept. A list
 * of plain values is refused in words, and entries that are not records are
 * counted in the report rather than dropped silently. The whole text is
 * parsed in memory, so parse/index.ts caps the file size.
 */
import type { Dataset, IngestOptions, ParseReport } from "@/engine/core/types";
import { cleanHeaders, createAccumulator, inferPlan, type ColumnPlan } from "./builder";
import type { CellValue } from "./values";
import { newDatasetId } from "./csv";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function isRecord(v: Json): v is { [k: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Flattens nested objects into dotted keys ("customer.address.city"), at most
 * four segments deep; deeper objects and arrays of objects become JSON text,
 * arrays of primitives a ", "-joined string.
 */
function flatten(
  obj: { [k: string]: Json },
  prefix = "",
  depth = 0,
  out: Record<string, CellValue> = {},
): Record<string, CellValue> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isRecord(v) && depth < 3) flatten(v, key, depth + 1, out);
    else if (Array.isArray(v))
      out[key] = v.every((x) => typeof x !== "object" || x === null) ? v.join(", ") : JSON.stringify(v);
    else if (isRecord(v)) out[key] = JSON.stringify(v);
    else out[key] = v;
  }
  return out;
}

/** Index labels as pandas writes them: row numbers, or epoch milliseconds for a date index. */
const isIndexKey = (k: string): boolean => /^-?\d+$/.test(k);

/**
 * pandas' object-of-objects layouts as records. "columns" (to_json's default
 * for a DataFrame: {column: {index: value}}) is transposed; "index" ({index:
 * {column: value}}) is its values. Told apart by which level's keys are index
 * labels; every inner object must be flat. Null for anything else, such as a
 * single record with nested objects.
 */
function pandasFrame(root: { [k: string]: Json }): Json[] | null {
  const outer = Object.keys(root);
  const inner = Object.values(root);
  if (outer.length < 1 || !inner.every(isRecord)) return null;
  const objects = inner as Array<{ [k: string]: Json }>;
  if (!objects.every((o) => Object.values(o).every((v) => !isRecord(v) && !Array.isArray(v)))) return null;
  const innerKeys = [...new Set(objects.flatMap((o) => Object.keys(o)))];
  if (innerKeys.length && innerKeys.every(isIndexKey) && !outer.every(isIndexKey)) {
    // {column: {index: value}}: one record per index label, in the order the labels first appear.
    return innerKeys.map((k) =>
      Object.fromEntries(outer.map((c, j) => [c, (objects[j] as { [k: string]: Json })[k] ?? null])),
    );
  }
  if (outer.length > 1 && outer.every(isIndexKey)) return objects;
  return null;
}

/** What a JSON document holds: its rows, and the header when the rows are arrays (array-of-arrays). */
interface JsonTable {
  records: Json[];
  /** Column names given apart from the rows (pandas' "split" layout); the first row is data then. */
  header?: string[];
}

/**
 * Locates the records: the root array; pandas' "split" ({columns, data}) and
 * object-of-objects layouts; a well-known wrapper key (data, rows, records,
 * …); else the first property holding an array of objects or arrays. Null
 * when there is none.
 */
function findRecords(root: Json): JsonTable | null {
  if (Array.isArray(root)) return { records: root };
  if (isRecord(root)) {
    const columns = root.columns;
    if (
      Array.isArray(columns) &&
      columns.every((c) => typeof c === "string" || typeof c === "number") &&
      Array.isArray(root.data) &&
      root.data.every((r) => Array.isArray(r))
    )
      return { records: root.data, header: columns.map(String) };
    const frame = pandasFrame(root);
    if (frame) return { records: frame };
    const preferred = ["data", "rows", "records", "items", "results", "values", "entries"];
    for (const key of preferred) {
      const v = root[key];
      if (Array.isArray(v)) return { records: v };
    }
    for (const v of Object.values(root))
      if (Array.isArray(v) && v.length && (isRecord(v[0] as Json) || Array.isArray(v[0])))
        return { records: v };
  }
  return null;
}

/**
 * Parses a JSON document (records array, wrapper object, a pandas layout, or
 * a single object = one row), falling back to NDJSON (one value per non-blank
 * line). Throws a user-facing error when neither works.
 */
export function parseJsonText(text: string): Json[] {
  return parseJsonTable(text).records;
}

/** parseJsonText, keeping a header given apart from the rows. */
function parseJsonTable(text: string): JsonTable {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("This file is empty: it has no rows and no columns.");
  try {
    const root = JSON.parse(trimmed) as Json;
    const recs = findRecords(root);
    if (recs) return recs;
    if (isRecord(root)) return { records: [root] };
  } catch {
    // Fall through to NDJSON.
  }
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  const out: Json[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as Json);
    } catch {
      throw new Error("This file isn't valid JSON or newline-delimited JSON.");
    }
  }
  return { records: out };
}

/**
 * Type-inference sample for one key: its values in the first 5,000 records,
 * or, when it has none there (a field that first appears later), its first
 * 5,000 values further down, so a late field is typed from real values
 * rather than read as text.
 */
function sampleValues(
  rows: ReadonlyArray<Record<string, CellValue>>,
  head: ReadonlyArray<Record<string, CellValue>>,
  key: string,
): CellValue[] {
  const first = head.map((r) => r[key] ?? null);
  if (first.some((v) => v !== null)) return first;
  const later: CellValue[] = [];
  for (let i = head.length; i < rows.length && later.length < 5000; i++) {
    const v = (rows[i] as Record<string, CellValue>)[key];
    if (v !== undefined && v !== null) later.push(v);
  }
  return later;
}

/** "[1, 2, 3, …]": the start of a list of plain values, quoted in the error message. */
function preview(values: readonly Json[]): string {
  const shown = values.slice(0, 3).map((v) => JSON.stringify(v).slice(0, 24));
  return `[${shown.join(", ")}${values.length > 3 ? ", …" : ""}]`;
}

/**
 * Builds a dataset from JSON text. An array of arrays uses its first row as
 * the header (unless the document gave the columns apart, as pandas' "split"
 * layout does); otherwise entries are flattened records, and entries that are
 * not records are left out with a note. Throws a user-facing error for a
 * document with no records or only plain values. sampleEvery/maxRows apply to
 * record positions.
 */
export function ingestJson(
  text: string,
  fileName: string,
  sizeBytes: number,
  opts: IngestOptions,
): { dataset: Dataset; report: ParseReport } {
  const started = performance.now();
  const table = parseJsonTable(text);
  const records = table.records;
  if (records.length === 0) throw new Error("This JSON file has no records: its list of rows is empty.");
  const warnings: string[] = [];

  let header: string[];
  let rows: Array<Record<string, CellValue>>;
  if (Array.isArray(records[0])) {
    const arrays = records.filter((r): r is Json[] => Array.isArray(r));
    const [first, ...rest] = table.header ? [table.header, ...arrays] : arrays;
    header = cleanHeaders((first ?? []).map((h) => (h === null ? "" : String(h))));
    rows = rest.map((r) => Object.fromEntries(header.map((h, j) => [h, (r[j] ?? null) as CellValue])));
  } else {
    const keys: string[] = [];
    const seen = new Set<string>();
    const objects = records.filter(isRecord);
    if (objects.length === 0)
      throw new Error(
        `This JSON is a list of plain values (${preview(records)}), not a table. Loupe reads a list of records, one object per row, such as [{"date": "2025-01-01", "sales": 120}, …].`,
      );
    const others = records.length - objects.length;
    if (others > 0)
      warnings.push(
        `Left out ${others.toLocaleString("en-US")} ${others === 1 ? "entry that is" : "entries that are"} not a record (a plain value or a list) among the ${records.length.toLocaleString("en-US")} entries.`,
      );
    rows = objects.map((r) => flatten(r));
    // Column set = keys of every record, so a field that first appears late is kept.
    for (const r of rows) {
      for (const k of Object.keys(r)) {
        if (!seen.has(k)) {
          seen.add(k);
          keys.push(k);
        }
      }
    }
    header = keys;
  }
  if (header.length === 0)
    throw new Error("This JSON file's records have no fields, so there are no columns.");
  if (rows.length === 0)
    throw new Error(
      `This JSON file has column names (${header.slice(0, 6).join(", ")}) but no rows of data.`,
    );
  const every = opts.sampleEvery && opts.sampleEvery > 1 ? opts.sampleEvery : 1;
  const maxRows = opts.maxRows ?? Infinity;
  // `names` are display names; values are still looked up by the keys in `header`, so record keys
  // that differ only in case ("id" vs "ID") stay distinct columns.
  const names = cleanHeaders(header);
  const keep = names.map((n) => (opts.columns ? opts.columns.includes(n) : true));
  const head = rows.slice(0, 5000);
  const plans: ColumnPlan[] = header.map((h, j) =>
    keep[j] ? inferPlan(sampleValues(rows, head, h), names[j] as string) : { kind: "string" },
  );
  const accs = plans.map((p, j) =>
    keep[j]
      ? createAccumulator(p, {
          preferDayFirst: opts.preferDayFirst ?? true,
          forcedOrder: opts.dateOrderOverrides?.[names[j] as string],
        })
      : null,
  );
  let kept = 0;
  for (let i = 0; i < rows.length && kept < maxRows; i++) {
    if (every > 1 && i % every !== 0) continue;
    const r = rows[i] as Record<string, CellValue>;
    for (let j = 0; j < header.length; j++) accs[j]?.push(r[header[j] as string] ?? null);
    kept++;
  }
  const columns = [];
  const dateFormats = [];
  const columnNotes = [];
  const skipped: string[] = [];
  for (let j = 0; j < header.length; j++) {
    const acc = accs[j];
    if (!acc) {
      skipped.push(names[j] as string);
      continue;
    }
    const fin = acc.finish(names[j] as string);
    columns.push(fin.column);
    if (fin.dateDecision) dateFormats.push(fin.dateDecision);
    if (fin.note) columnNotes.push(fin.note);
  }
  return {
    dataset: {
      id: newDatasetId(),
      name: fileName.replace(/\.[^.]+$/, ""),
      rowCount: kept,
      columns,
      source: { fileName, kind: "json", sizeBytes, isDemo: false },
    },
    report: {
      fileName,
      kind: "json",
      sizeBytes,
      rowCount: kept,
      columnCount: columns.length,
      headerRowIndex: 0,
      headerDetected: true,
      dateFormats,
      columnNotes,
      warnings: [
        ...(header.some((h) => h.includes("."))
          ? ["Nested objects were flattened into dotted column names."]
          : []),
        ...warnings,
      ],
      sampling:
        every > 1 || Number.isFinite(maxRows)
          ? {
              strategy: every > 1 ? "systematic" : "first",
              keptRows: kept,
              estimatedTotalRows: rows.length,
              every: every > 1 ? every : undefined,
            }
          : undefined,
      skippedColumns: skipped.length ? skipped : undefined,
      durationMs: Math.round(performance.now() - started),
    },
  };
}
