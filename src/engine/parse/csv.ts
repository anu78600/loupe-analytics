/**
 * Streaming CSV/TSV ingestion. Bytes are decoded with a streaming TextDecoder
 * (so multi-byte characters split across chunks stay intact) and fed to
 * PapaParse through its stream interface, which carries partial rows and
 * quoted fields across chunk boundaries.
 *
 * Flow: sniff the first MiB (encoding, delimiter, header, up to 5,000 sample
 * rows for the column plans) → large-file check, which may return
 * "needs-decision" before reading further → stream 4 MiB slices into the
 * column accumulators → finish the columns and build the ParseReport. Blank
 * lines are skipped everywhere, so row indices count non-blank rows. Ragged
 * rows are padded with blanks or truncated to the table width.
 */
import Papa from "papaparse";
import type { Dataset, IngestOptions, LargeFileAssessment, ParseReport } from "@/engine/core/types";
import { cleanHeaders, createAccumulator, inferPlan, type Accumulator, type ColumnPlan } from "./builder";
import { detectDelimiter, detectEncoding, detectHeader, type TextEncodingName } from "./sniff";

export interface IngestProgress {
  /** "profiling" and "detecting" are reported later by the session, not by the parsers. */
  phase: "reading" | "parsing" | "finalizing" | "profiling" | "detecting";
  /** Approximate for workbooks (estimated from the row position). */
  loadedBytes: number;
  totalBytes: number;
  /** Data rows kept so far. */
  rows: number;
}

/** "needs-decision": the file is too large to load whole; re-ingest with sampleEvery, maxRows or columns. */
export type IngestOutcome =
  | { status: "ok"; dataset: Dataset; report: ParseReport }
  | { status: "needs-decision"; assessment: LargeFileAssessment };

/** Rows above which we ask the user how to proceed instead of loading everything. */
export const LARGE_ROW_LIMIT = 2_100_000;
/** File size above which we ask too, whatever the row estimate. */
export const LARGE_BYTE_LIMIT = 700 * 1024 * 1024;
/** Prefix used for sniffing and for the type-inference sample. */
const SNIFF_BYTES = 1024 * 1024;
/** Slice size read from the Blob per step while streaming. */
const CHUNK_BYTES = 4 * 1024 * 1024;

/**
 * Minimal Node-stream look-alike that PapaParse's ReadableStreamStreamer accepts.
 * Papa recognises it by `readable === true` plus `read` and `on` functions and
 * only listens to data, end and error. There is no back-pressure: each
 * emit("data") is parsed synchronously before it returns, so pause() and
 * resume() can be no-ops.
 */
class TextChunkStream {
  readonly readable = true;
  private handlers = new Map<string, Array<(arg?: unknown) => void>>();
  read(): null {
    return null;
  }
  on(event: string, fn: (arg?: unknown) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
    return this;
  }
  removeListener(event: string, fn: (arg?: unknown) => void): this {
    this.handlers.set(
      event,
      (this.handlers.get(event) ?? []).filter((h) => h !== fn),
    );
    return this;
  }
  pause(): void {}
  resume(): void {}
  emit(event: string, arg?: unknown): void {
    for (const h of [...(this.handlers.get(event) ?? [])]) h(arg);
  }
}

/** Bytes `text` takes in the file's encoding (BOM aside): 2 per UTF-16 code unit, 1 per windows-1252 character. */
function encodedLength(text: string, encoding: TextEncodingName): number {
  if (encoding === "utf-16le" || encoding === "utf-16be") return text.length * 2;
  if (encoding === "windows-1252") return text.length;
  return new TextEncoder().encode(text).length;
}

let datasetCounter = 0;
/** Base-36 timestamp plus a module counter: unique within one worker session, not globally. */
export function newDatasetId(): string {
  datasetCounter++;
  return `ds_${Date.now().toString(36)}_${datasetCounter}`;
}

/**
 * Parses a CSV/TSV Blob into a columnar dataset. Returns "needs-decision"
 * instead when the file is estimated above LARGE_ROW_LIMIT rows or is larger
 * than LARGE_BYTE_LIMIT, unless opts already sets sampleEvery, maxRows or columns.
 */
export async function ingestDelimited(
  file: Blob,
  fileName: string,
  opts: IngestOptions,
  onProgress?: (p: IngestProgress) => void,
): Promise<IngestOutcome> {
  const started = performance.now();
  const size = file.size;

  // 1. Sniff encoding, delimiter and header from the first megabyte.
  const headBytes = new Uint8Array(await file.slice(0, Math.min(size, SNIFF_BYTES)).arrayBuffer());
  const encoding = detectEncoding(headBytes);
  let headText = new TextDecoder(encoding).decode(headBytes);
  const truncatedHead = size > SNIFF_BYTES;
  if (truncatedHead) {
    // Drop the last, probably partial, line so every sniffed row is complete.
    const lastNl = headText.lastIndexOf("\n");
    if (lastNl > 0) headText = headText.slice(0, lastNl);
  }
  const delimiter = detectDelimiter(headText, fileName);
  const sniffRows = Papa.parse<string[]>(headText, { delimiter, skipEmptyLines: "greedy" }).data;
  const header = detectHeader(sniffRows);
  const headerRow = sniffRows[header.headerIndex] ?? [];
  const width = Math.max(header.columnCount, headerRow.length);
  const names = header.hasHeader
    ? cleanHeaders(Array.from({ length: width }, (_, j) => headerRow[j] ?? ""))
    : cleanHeaders(Array.from({ length: width }, (_, j) => `Column ${j + 1}`));
  const firstDataIndex = header.hasHeader ? header.headerIndex + 1 : header.headerIndex;
  const sampleRows = sniffRows.slice(firstDataIndex, firstDataIndex + 5000);

  // 2. Large-file assessment before committing memory.
  // Rows are extrapolated from the rows per byte of the sniffed text, measured in the file's own encoding
  // (quotes, CRs and blank lines included), so UTF-16 files are not counted twice.
  const headTextBytes = encodedLength(headText, encoding);
  const sampleCount = Math.max(1, sniffRows.length - firstDataIndex);
  const estimatedRows = truncatedHead
    ? Math.max(
        sampleCount,
        Math.round((size / Math.max(1, headTextBytes)) * sniffRows.length) - firstDataIndex,
      )
    : sampleCount;
  const userChoseStrategy = Boolean(opts.sampleEvery || opts.maxRows || opts.columns);
  if (!userChoseStrategy && (estimatedRows > LARGE_ROW_LIMIT || size > LARGE_BYTE_LIMIT)) {
    return {
      status: "needs-decision",
      assessment: {
        fileName,
        sizeBytes: size,
        estimatedRows,
        columns: names,
        reason:
          estimatedRows > LARGE_ROW_LIMIT
            ? `About ${Math.round(estimatedRows / 1e5) / 10}M rows is above the ${(LARGE_ROW_LIMIT / 1e6).toFixed(1)}M rows a browser tab can analyse comfortably.`
            : `This file is ${Math.round(size / 1024 / 1024)} MB, above the in-browser comfort limit.`,
        recommendedSampleEvery: Math.max(2, Math.ceil(estimatedRows / 1_000_000)),
      },
    };
  }

  // 3. Decide column plans from the sample.
  const keep = opts.columns ? names.map((n) => opts.columns?.includes(n) ?? true) : names.map(() => true);
  const plans: ColumnPlan[] = names.map((name, j) =>
    keep[j]
      ? inferPlan(
          sampleRows.map((r) => r[j] ?? null),
          name,
        )
      : { kind: "string" },
  );
  // Day-first unless told otherwise; the app passes its number-locale setting.
  const preferDayFirst = opts.preferDayFirst ?? true;
  const accs: Array<Accumulator | null> = names.map((name, j) =>
    keep[j]
      ? createAccumulator(plans[j] as ColumnPlan, {
          preferDayFirst,
          forcedOrder: opts.dateOrderOverrides?.[name],
        })
      : null,
  );

  // 4. Stream the whole file.
  const warnings: string[] = [];
  // `physical` counts non-blank parsed rows, title and header included, matching the sniff's indices;
  // `dataRow` counts rows after the header. Sampling keeps data rows 0, every, 2·every, …
  let physical = -1;
  let dataRow = -1;
  let kept = 0;
  let ragged = 0;
  let parseErrors = 0;
  let stop = false;
  let bytesRead = 0;
  const every = opts.sampleEvery && opts.sampleEvery > 1 ? opts.sampleEvery : 1;
  const maxRows = opts.maxRows ?? Infinity;

  const stream = new TextChunkStream();
  const parsed = new Promise<void>((resolve, reject) => {
    Papa.parse<string[]>(stream as unknown as NodeJS.ReadableStream, {
      delimiter,
      skipEmptyLines: "greedy",
      chunk: (results, parser) => {
        parseErrors += results.errors.length;
        for (const row of results.data) {
          physical++;
          if (physical < firstDataIndex) continue;
          dataRow++;
          if (every > 1 && dataRow % every !== 0) continue;
          if (kept >= maxRows) {
            // abort() makes PapaParse call `complete`, which resolves `parsed`; `stop` ends the read loop.
            stop = true;
            parser.abort();
            return;
          }
          if (row.length !== width) ragged++;
          for (let j = 0; j < width; j++) {
            const acc = accs[j];
            if (acc) acc.push(row[j] ?? null);
          }
          kept++;
        }
        onProgress?.({ phase: "parsing", loadedBytes: bytesRead, totalBytes: size, rows: kept });
      },
      complete: () => resolve(),
      error: (err: Error) => reject(err),
    });
  });

  const decoder = new TextDecoder(encoding);
  for (let start = 0; start < size && !stop; start += CHUNK_BYTES) {
    const end = Math.min(size, start + CHUNK_BYTES);
    const buf = new Uint8Array(await file.slice(start, end).arrayBuffer());
    bytesRead = end;
    const text = decoder.decode(buf, { stream: end < size });
    if (text) stream.emit("data", text);
  }
  // After an early stop the parse already completed through abort(), so "end" is not emitted.
  if (!stop) {
    const tail = decoder.decode();
    if (tail) stream.emit("data", tail);
    stream.emit("end");
  }
  await parsed;
  onProgress?.({ phase: "finalizing", loadedBytes: size, totalBytes: size, rows: kept });

  // 5. Finalize columns.
  const columns = [];
  const dateFormats = [];
  const columnNotes = [];
  const skipped: string[] = [];
  for (let j = 0; j < width; j++) {
    const acc = accs[j];
    const name = names[j] as string;
    if (!acc) {
      skipped.push(name);
      continue;
    }
    const fin = acc.finish(name);
    columns.push(fin.column);
    if (fin.dateDecision) dateFormats.push(fin.dateDecision);
    if (fin.note) columnNotes.push(fin.note);
  }
  if (ragged > 0)
    warnings.push(
      `${ragged.toLocaleString("en-US")} rows had a different number of fields than the header; missing cells were left blank.`,
    );
  if (parseErrors > 0)
    warnings.push(
      `${parseErrors.toLocaleString("en-US")} rows had quoting issues; they were read as best as possible.`,
    );
  if (!header.hasHeader)
    warnings.push("No header row was detected, so columns were named Column 1, Column 2, …");
  if (header.headerIndex > 0) warnings.push(`Skipped ${header.headerIndex} title row(s) above the table.`);

  const kind = delimiter === "\t" || /\.tsv$/i.test(fileName) ? "tsv" : "csv";
  const dataset: Dataset = {
    id: newDatasetId(),
    name: fileName.replace(/\.[^.]+$/, ""),
    rowCount: kept,
    columns,
    source: { fileName, kind, sizeBytes: size, isDemo: false },
  };
  const report: ParseReport = {
    fileName,
    kind,
    sizeBytes: size,
    rowCount: kept,
    columnCount: columns.length,
    encoding,
    delimiter,
    headerRowIndex: header.headerIndex,
    headerDetected: header.hasHeader,
    dateFormats,
    columnNotes,
    warnings,
    sampling:
      every > 1 || Number.isFinite(maxRows)
        ? {
            strategy: every > 1 ? "systematic" : "first",
            keptRows: kept,
            // The larger of the sniff estimate and the data rows actually seen, so never below the rows read.
            estimatedTotalRows: Math.max(estimatedRows, dataRow + 1),
            every: every > 1 ? every : undefined,
          }
        : undefined,
    skippedColumns: skipped.length ? skipped : undefined,
    durationMs: Math.round(performance.now() - started),
  };
  return { status: "ok", dataset, report };
}
