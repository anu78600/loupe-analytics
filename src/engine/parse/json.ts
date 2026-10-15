/**
 * JSON / NDJSON ingestion: arrays of records, wrapped arrays, or array-of-arrays.
 *
 * Records are flattened (nested objects become dotted columns, up to four
 * levels; arrays become text) and then go through the same plan/accumulator
 * path as CSV. Columns are the union of keys across all records, in
 * first-seen order, so a field that only appears late is still kept. The
 * whole text is parsed in memory, so parse/index.ts caps the file size.
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

/**
 * Locates the record array: the root array, else a well-known wrapper key
 * (data, rows, records, …), else the first property holding an array of
 * objects or arrays. Null when there is none.
 */
function findRecords(root: Json): Json[] | null {
  if (Array.isArray(root)) return root;
  if (isRecord(root)) {
    const preferred = ["data", "rows", "records", "items", "results", "values", "entries"];
    for (const key of preferred) {
      const v = root[key];
      if (Array.isArray(v)) return v;
    }
    for (const v of Object.values(root))
      if (Array.isArray(v) && v.length && (isRecord(v[0] as Json) || Array.isArray(v[0]))) return v;
  }
  return null;
}

/**
 * Parses a JSON document (records array, wrapper object, or a single object =
 * one row), falling back to NDJSON (one value per non-blank line). Throws a
 * user-facing error when neither works.
 */
export function parseJsonText(text: string): Json[] {
  const trimmed = text.trim();
  try {
    const root = JSON.parse(trimmed) as Json;
    const recs = findRecords(root);
    if (recs) return recs;
    if (isRecord(root)) return [root];
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
  return out;
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

/**
 * Builds a dataset from JSON text. An array of arrays uses its first row as
 * the header; otherwise entries are flattened records and non-object entries
 * are dropped. sampleEvery/maxRows apply to record positions.
 */
export function ingestJson(
  text: string,
  fileName: string,
  sizeBytes: number,
  opts: IngestOptions,
): { dataset: Dataset; report: ParseReport } {
  const started = performance.now();
  const records = parseJsonText(text);
  if (records.length === 0) throw new Error("The JSON file contains no records.");

  let header: string[];
  let rows: Array<Record<string, CellValue>>;
  if (Array.isArray(records[0])) {
    const [first, ...rest] = records as Json[][];
    header = cleanHeaders((first ?? []).map((h) => (h === null ? "" : String(h))));
    rows = rest.map((r) => Object.fromEntries(header.map((h, j) => [h, (r[j] ?? null) as CellValue])));
  } else {
    const keys: string[] = [];
    const seen = new Set<string>();
    rows = records.filter(isRecord).map((r) => flatten(r));
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
      warnings: header.some((h) => h.includes("."))
        ? ["Nested objects were flattened into dotted column names."]
        : [],
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
