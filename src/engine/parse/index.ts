/**
 * Parser entry point, called from the engine worker (session.ts): routes a
 * file to the delimited, workbook or JSON reader by extension, sniffing the
 * first bytes when the extension is unknown. Files that are clearly not
 * tables (a PDF, an image, a Word document) are refused with a sentence that
 * says so, before any reader sees them. Delimited files stream and can
 * return "needs-decision" for very large inputs; workbooks and JSON are read
 * whole into memory, so they have hard size caps instead.
 */
import type { IngestOptions } from "@/engine/core/types";
import { ingestDelimited, type IngestOutcome, type IngestProgress } from "./csv";
import { ingestWorkbook, listDataSheets, listSheets } from "./excel";
import { ingestJson } from "./json";
import { binaryKind, binaryMessage } from "./sniff";

export type { IngestOutcome, IngestProgress } from "./csv";
export { listSheets };

/** Extensions of files that hold no table Loupe can read, named in the refusal. */
const NOT_A_TABLE: Record<string, string> = {
  pdf: "a PDF",
  doc: "a Word document",
  docx: "a Word document",
  ppt: "a PowerPoint deck",
  pptx: "a PowerPoint deck",
  png: "an image",
  jpg: "an image",
  jpeg: "an image",
  gif: "an image",
  webp: "an image",
  svg: "an image",
  zip: "a zip archive",
  gz: "a compressed archive",
  rar: "a compressed archive",
  "7z": "a compressed archive",
  parquet: "a Parquet file",
  sqlite: "a database file",
  db: "a database file",
};

/** The formats Loupe reads, for refusals. */
const SUPPORTED = "CSV, TSV, TXT, Excel (.xlsx, .xls, .xlsm, .xlsb, .ods) or JSON";

export type DetectedFileKind = "delimited" | "workbook" | "json";

/** SheetJS parses the whole workbook in memory; larger files are refused with a "save as CSV" hint. */
const MAX_WORKBOOK_BYTES = 150 * 1024 * 1024;
/** JSON is read into one string and parsed whole. */
const MAX_JSON_BYTES = 250 * 1024 * 1024;

/** Reader family by extension (.txt, .tab and .psv count as delimited); null when unknown. */
export function fileKindFromName(name: string): DetectedFileKind | null {
  const lower = name.toLowerCase();
  if (/\.(csv|tsv|txt|tab|psv)$/.test(lower)) return "delimited";
  if (/\.(xlsx|xlsm|xlsb|xls|ods)$/.test(lower)) return "workbook";
  if (/\.(json|ndjson|jsonl)$/.test(lower)) return "json";
  return null;
}

/**
 * Reads any supported file into a columnar dataset (runs inside the worker).
 * Known non-table types (PDF, images, Word, archives) are refused in words.
 * Other unknown extensions are sniffed: binary content is refused, a leading
 * "{" or "[" means JSON, and anything else is treated as delimited text.
 */
export async function ingestFile(
  file: Blob,
  fileName: string,
  opts: IngestOptions,
  onProgress?: (p: IngestProgress) => void,
): Promise<IngestOutcome> {
  let kind = fileKindFromName(fileName);
  if (!kind) {
    const ext = /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? "";
    const what = NOT_A_TABLE[ext];
    if (what) throw new Error(`This is ${what}, not a table. Loupe reads ${SUPPORTED} files.`);
    if (file.size === 0) throw new Error("This file is empty: it has no rows and no columns.");
    const bytes = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
    const binary = binaryKind(bytes);
    if (binary) throw new Error(binaryMessage(binary, fileName));
    const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart();
    kind = head.startsWith("{") || head.startsWith("[") ? "json" : "delimited";
  }
  if (kind === "delimited") return ingestDelimited(file, fileName, opts, onProgress);
  if (kind === "workbook") {
    if (file.size > MAX_WORKBOOK_BYTES) {
      throw new Error(
        `This workbook is ${Math.round(file.size / 1024 / 1024)} MB. Spreadsheets above ${MAX_WORKBOOK_BYTES / 1024 / 1024} MB can't be read reliably in a browser; save the sheet as CSV and upload that instead.`,
      );
    }
    const buf = await file.arrayBuffer();
    const res = await ingestWorkbook(buf, fileName, opts, onProgress);
    return { status: "ok", ...res };
  }
  if (file.size > MAX_JSON_BYTES) {
    throw new Error(
      `JSON files above ${MAX_JSON_BYTES / 1024 / 1024} MB aren't supported in the browser; please convert to CSV.`,
    );
  }
  const text = await file.text();
  return { status: "ok", ...ingestJson(text, fileName, file.size, opts) };
}

/**
 * The sheets worth offering, so the session can ask which one to read before
 * parsing a multi-sheet workbook: empty sheets are left out (listDataSheets),
 * so a workbook with one filled sheet is read without asking.
 */
export async function workbookSheets(file: Blob): Promise<string[]> {
  return listDataSheets(await file.arrayBuffer());
}
