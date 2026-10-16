/**
 * Streaming CSV/TSV ingestion. Bytes are decoded with a streaming TextDecoder
 * (so multi-byte characters split across chunks stay intact) and fed to
 * PapaParse through its stream interface, which carries partial rows and
 * quoted fields across chunk boundaries.
 *
 * Flow: refuse what is not a text table (an empty file, a PDF, an image or
 * other binary content) → sniff the first MiB (encoding, delimiter, header,
 * up to 5,000 sample rows for the column plans) → large-file check, which may
 * return "needs-decision" before reading further → stream 4 MiB slices into
 * the column accumulators → finish the columns and build the ParseReport, or
 * refuse a file with no data rows. Blank lines are skipped everywhere, so row
 * indices count non-blank rows. Ragged rows are padded with blanks or
 * truncated to the table width; a column with neither a header nor any value
 * (Excel's trailing commas) is left out and the report says so.
 */
import Papa from "papaparse";
import type { Column, Dataset, IngestOptions, LargeFileAssessment, ParseReport } from "@/engine/core/types";
import {
  cleanHeaders,
  createAccumulator,
  headerRenameNote,
  inferPlan,
  isEmptyColumn,
  type Accumulator,
  type ColumnPlan,
} from "./builder";
import { FIRST_ROWS_LIMIT, LARGE_BYTE_LIMIT, LARGE_ROW_LIMIT } from "./limits";
import {
  binaryKind,
  binaryMessage,
  detectDelimiter,
  detectEncoding,
  detectHeader,
  type TextEncodingName,
} from "./sniff";

export { LARGE_BYTE_LIMIT, LARGE_ROW_LIMIT };

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
 * The 0-based line of `text` on which its `index`-th non-blank row starts:
 * the sniffed row indices skip blank lines (as the parser does), but the
 * report names the line as an editor shows it. Line breaks inside quoted
 * cells are counted too.
 */
function lineOfRow(text: string, delimiter: string, index: number): number {
  const rows = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: false, preview: 5000 }).data;
  let line = 0;
  let seen = 0;
  for (const row of rows) {
    if (row.some((c) => c.trim() !== "")) {
      if (seen === index) return line;
      seen++;
    }
    line += 1 + row.reduce((n, c) => n + (c.match(/\n/g)?.length ?? 0), 0);
  }
  return index;
}

/** The header cells of a table with no data rows, quoted for the error message (the first six). */
function quoteHeaders(cells: readonly string[]): string {
  const named = cells.map((c) => c.trim()).filter(Boolean);
  return named.length > 6 ? `${named.slice(0, 6).join(", ")}, …` : named.join(", ");
}

/**
 * Parses a CSV/TSV Blob into a columnar dataset. Returns "needs-decision"
 * instead when the file is estimated above LARGE_ROW_LIMIT rows or is larger
 * than LARGE_BYTE_LIMIT, unless opts already sets sampleEvery, maxRows or columns.
 * Throws a user-facing error for an empty file, one that is not text (a PDF,
 * an image, a workbook under a .csv name) and one with no rows of data.
 */
export async function ingestDelimited(
  file: Blob,
  fileName: string,
  opts: IngestOptions,
  onProgress?: (p: IngestProgress) => void,
): Promise<IngestOutcome> {
  const started = performance.now();
  const size = file.size;
  if (size === 0) throw new Error("This file is empty: it has no rows and no columns.");

  // 1. Sniff encoding, delimiter and header from the first megabyte.
  const headBytes = new Uint8Array(await file.slice(0, Math.min(size, SNIFF_BYTES)).arrayBuffer());
  const binary = binaryKind(headBytes);
  if (binary) throw new Error(binaryMessage(binary, fileName));
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
  if (sniffRows.length === 0) throw new Error("This file has no rows: it is empty apart from blank lines.");
  const header = detectHeader(sniffRows);
  const headerRow = sniffRows[header.headerIndex] ?? [];
  const width = Math.max(header.columnCount, headerRow.length);
  const rawHeaders = Array.from({ length: width }, (_, j) => headerRow[j] ?? "");
  const names = header.hasHeader
    ? cleanHeaders(rawHeaders)
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
        // No figures here: the dialog writes them in the user's number format (one system per screen).
        reason:
          estimatedRows > LARGE_ROW_LIMIT
            ? "That is more rows than a browser tab can analyse comfortably."
            : "That is larger than a browser tab can read comfortably.",
        recommendedSampleEvery: Math.max(2, Math.ceil(estimatedRows / FIRST_ROWS_LIMIT)),
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
  if (kept === 0) {
    throw new Error(
      header.hasHeader
        ? `This file has column headers (${quoteHeaders(headerRow)}) but no rows of data under them.`
        : "This file has no rows of data.",
    );
  }
  onProgress?.({ phase: "finalizing", loadedBytes: size, totalBytes: size, rows: kept });

  // 5. Finalize columns. A column with neither a header nor a single value is an artefact of the
  // export (Excel's trailing commas), not data: it is left out and the report says so.
  const columns: Column[] = [];
  const dateFormats = [];
  const columnNotes = [];
  const skipped: string[] = [];
  const unnamedEmpty = new Set<number>();
  for (let j = 0; j < width; j++) {
    const acc = accs[j];
    const name = names[j] as string;
    if (!acc) {
      skipped.push(name);
      continue;
    }
    const fin = acc.finish(name);
    if (header.hasHeader && !(rawHeaders[j] as string).trim() && isEmptyColumn(fin.column)) {
      unnamedEmpty.add(j);
      continue;
    }
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
  else {
    const renamed = headerRenameNote(rawHeaders, names, unnamedEmpty);
    if (renamed) warnings.push(renamed);
  }
  if (unnamedEmpty.size)
    warnings.push(
      unnamedEmpty.size === 1
        ? "Left out 1 column with no header and no values (an empty column at the edge of the export)."
        : `Left out ${unnamedEmpty.size} columns with no header and no values (empty columns at the edge of the export).`,
    );
  const headerLine = lineOfRow(headText, delimiter, header.headerIndex);
  if (header.headerIndex > 0)
    warnings.push(
      `Skipped ${header.headerIndex === 1 ? "1 title row" : `${header.headerIndex} title rows`} above the table; its header is on line ${headerLine + 1}.`,
    );

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
    // The line as a text editor numbers it (blank and title lines counted), so "line 4" is line 4.
    headerRowIndex: headerLine,
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
