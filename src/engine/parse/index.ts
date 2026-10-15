/**
 * Parser entry point, called from the engine worker (session.ts): routes a
 * file to the delimited, workbook or JSON reader by extension, sniffing the
 * first bytes when the extension is unknown. Delimited files stream and can
 * return "needs-decision" for very large inputs; workbooks and JSON are read
 * whole into memory, so they have hard size caps instead.
 */
import type { IngestOptions } from "@/engine/core/types";
import { ingestDelimited, type IngestOutcome, type IngestProgress } from "./csv";
import { ingestWorkbook, listSheets } from "./excel";
import { ingestJson } from "./json";

export type { IngestOutcome, IngestProgress } from "./csv";
export { listSheets };

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
 * Unknown extensions are sniffed: a leading "{" or "[" means JSON, anything
 * else is treated as delimited text.
 */
export async function ingestFile(
  file: Blob,
  fileName: string,
  opts: IngestOptions,
  onProgress?: (p: IngestProgress) => void,
): Promise<IngestOutcome> {
  let kind = fileKindFromName(fileName);
  if (!kind) {
    const head = (await file.slice(0, 64).text()).trimStart();
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

/** Sheet names, so the session can ask which sheet to read before parsing a multi-sheet workbook. */
export async function workbookSheets(file: Blob): Promise<string[]> {
  return listSheets(await file.arrayBuffer());
}
