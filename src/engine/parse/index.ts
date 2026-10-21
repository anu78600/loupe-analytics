/**
 * Parser entry point, called from the engine worker (session.ts): routes a
 * file to the delimited, workbook or JSON reader by extension, sniffing the
 * first bytes when the extension is unknown. Files that are clearly not
 * tables (a PDF, an image, a Word document) are refused with a sentence that
 * says so, before any reader sees them. Delimited files stream and can
 * return "needs-decision" for very large inputs; workbooks and JSON are read
 * whole into memory, so they have hard size caps instead.
 */
import type { Dataset, IngestOptions, ParseReport } from "@/engine/core/types";
import { ingestDelimited, type IngestOutcome, type IngestProgress } from "./csv";
import { ingestWorkbook, listDataSheets, listSheets } from "./excel";
import { ingestJson } from "./json";
import { MAX_MODEL_SHEETS } from "./limits";
import { joinSheets, modelReport, relateSheets, type SheetTable } from "./relate";
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

/**
 * The options one sheet of a joined workbook is read with. A day/month order
 * the user fixed is keyed by the joined table's column name: "Customers ·
 * Signup date" applies to that sheet's "Signup date", a plain name to any
 * sheet's column of that name.
 */
function sheetOptions(opts: IngestOptions, sheet: string): IngestOptions {
  const overrides = opts.dateOrderOverrides;
  if (!overrides) return { ...opts, sheet };
  const prefix = `${sheet} · `;
  const own: Record<string, "DMY" | "MDY"> = {};
  for (const [name, order] of Object.entries(overrides)) {
    if (name.startsWith(prefix)) own[name.slice(prefix.length)] = order;
    else if (!name.includes(" · ")) own[name] ??= order;
  }
  return { ...opts, sheet, dateOrderOverrides: own };
}

/**
 * Reads a workbook whose sheets relate (an Orders sheet with Customers and
 * Products beside it) as one table: every sheet in `sheets` is parsed,
 * parse/relate.ts finds the keys, and the lookups are left-joined onto the
 * main sheet. Returns null, having adopted nothing, when no sheet joins onto
 * another, when there are too many sheets to read them all
 * (MAX_MODEL_SHEETS) or the workbook is over the size cap: the session then
 * offers the sheet picker as before. A sheet that can't be read is left out
 * with its reason.
 */
export async function ingestWorkbookModel(
  file: Blob,
  fileName: string,
  sheets: readonly string[],
  opts: IngestOptions,
  onProgress?: (p: IngestProgress) => void,
): Promise<{ dataset: Dataset; report: ParseReport } | null> {
  if (sheets.length < 2 || sheets.length > MAX_MODEL_SHEETS || file.size > MAX_WORKBOOK_BYTES) return null;
  const started = performance.now();
  const buf = await file.arrayBuffer();
  const tables: SheetTable[] = [];
  const reports = new Map<string, ParseReport>();
  const unreadable: Array<{ sheet: string; reason: string }> = [];
  const total = buf.byteLength;
  for (const [i, sheet] of sheets.entries()) {
    // Progress over the whole workbook: sheet i covers the i-th share of the bar.
    const progress = onProgress
      ? (p: IngestProgress) =>
          onProgress({
            ...p,
            phase: p.phase === "finalizing" ? "parsing" : p.phase,
            loadedBytes: Math.round(
              ((i + p.loadedBytes / Math.max(1, p.totalBytes)) / sheets.length) * total,
            ),
            totalBytes: total,
          })
      : undefined;
    try {
      const res = await ingestWorkbook(buf, fileName, sheetOptions(opts, sheet), progress);
      tables.push({ sheet, ds: res.dataset });
      reports.set(sheet, res.report);
    } catch (e) {
      const message = (e as Error).message.replace(/\.$/, "");
      unreadable.push({ sheet, reason: message.charAt(0).toLowerCase() + message.slice(1) });
    }
  }
  onProgress?.({ phase: "joining", loadedBytes: total, totalBytes: total, rows: 0 });
  const plan = relateSheets(tables);
  if (!plan) return null;
  // Sheets that couldn't be read are left out too, in workbook order with the others.
  const order = new Map(sheets.map((s, i) => [s, i]));
  plan.left = [...plan.left, ...unreadable].sort(
    (a, b) => (order.get(a.sheet) ?? 0) - (order.get(b.sheet) ?? 0),
  );
  const { dataset, model, renames } = joinSheets(tables, plan);
  const report = modelReport(dataset, model, renames, reports, Math.round(performance.now() - started));
  return { dataset, report };
}
