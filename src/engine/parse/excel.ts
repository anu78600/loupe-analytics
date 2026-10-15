/**
 * XLSX/XLS ingestion with SheetJS in dense mode. Date cells are converted from
 * their raw serial + number format (not via JS Date), so no timezone can shift
 * a day, and 1904-based workbooks are honoured.
 *
 * Also reads .xlsm, .xlsb and .ods (reported as kind "xlsx"). Header detection
 * reuses sniff.detectHeader on the displayed cell text; cells then go through
 * the same plan/accumulator path as CSV, with typed values (numbers, booleans,
 * WallClockDate) instead of text. SheetJS materialises the whole sheet first,
 * which is why parse/index.ts caps workbook size.
 */
import { read, SSF, utils, type CellObject, type WorkBook } from "xlsx";
import { DAY_MS } from "@/engine/core/dates";
import type { Dataset, IngestOptions, ParseReport } from "@/engine/core/types";
import { cleanHeaders, createAccumulator, inferPlan, type ColumnPlan } from "./builder";
import { excelSerialToMs, parseDateParts, partsToMs } from "./dates";
import { detectHeader } from "./sniff";
import { type CellValue, WallClockDate } from "./values";
import { newDatasetId, type IngestProgress } from "./csv";

/** Sheet names only (bookSheets: cells are not parsed, so this is cheap). */
export function listSheets(buffer: ArrayBuffer): string[] {
  const wb = read(new Uint8Array(buffer), { type: "array", bookSheets: true });
  return wb.SheetNames;
}

/**
 * SheetJS cell → CellValue. Numbers with a date number format become
 * WallClockDate (hasTime when the serial has a fraction); strings and
 * booleans pass through; errors, stubs and empty cells are null. Exported
 * for tests.
 */
export function cellValue(cell: CellObject | undefined, date1904: boolean): CellValue {
  if (!cell) return null;
  switch (cell.t) {
    case "n": {
      const v = cell.v as number;
      if (cell.z && typeof cell.z === "string" && SSF.is_date(cell.z)) {
        const ms = excelSerialToMs(v, date1904);
        return new WallClockDate(ms, v % 1 !== 0);
      }
      return v;
    }
    case "s":
      return String(cell.v ?? "");
    case "b":
      return Boolean(cell.v);
    case "d": {
      // Not reached today: with cellDates: false SheetJS returns date cells as serials ("n"). Kept
      // correct anyway. SheetJS 0.20+ builds Date cells in UTC, so the UTC reading is the clock time
      // shown in the sheet whatever the viewer's zone; rounding to the second drops serial noise, as
      // excelSerialToMs does.
      if (cell.v instanceof Date) {
        const t = cell.v.getTime();
        if (!Number.isFinite(t)) return cellText(cell) || null;
        const ms = Math.round(t / 1000) * 1000;
        return new WallClockDate(ms, ms % DAY_MS !== 0);
      }
      // A date given as ISO text: its clock time as written, any zone ignored, like CSV dates.
      const text = String(cell.v ?? "");
      const parts = parseDateParts(text, "iso");
      const ms = parts ? partsToMs(parts, "iso", false) : NaN;
      return parts && Number.isFinite(ms) ? new WallClockDate(ms, parts.hasTime) : text || null;
    }
    default:
      return null;
  }
}

/** Displayed text (formatted `w` when present, else the raw value); used for header detection and blank-row tests. */
function cellText(cell: CellObject | undefined): string {
  if (!cell) return "";
  if (cell.w !== undefined) return String(cell.w);
  return cell.v === undefined || cell.v === null ? "" : String(cell.v);
}

/**
 * Reads one sheet (opts.sheet when it exists, else the first) into a columnar
 * dataset. Entirely blank rows are skipped, and sampleEvery/maxRows apply to
 * the remaining data rows. Never returns "needs-decision"; workbook size is
 * capped in parse/index.ts instead.
 */
export async function ingestWorkbook(
  buffer: ArrayBuffer,
  fileName: string,
  opts: IngestOptions,
  onProgress?: (p: IngestProgress) => void,
): Promise<{ dataset: Dataset; report: ParseReport }> {
  const started = performance.now();
  const sheetNames = listSheets(buffer);
  const sheet = opts.sheet && sheetNames.includes(opts.sheet) ? opts.sheet : sheetNames[0];
  if (!sheet) throw new Error("This workbook has no sheets.");
  onProgress?.({ phase: "reading", loadedBytes: 0, totalBytes: buffer.byteLength, rows: 0 });

  // dense: rows as arrays in ws["!data"], lighter than one object per cell address. cellNF keeps
  // number formats so date cells can be recognised; cellDates: false keeps dates as raw serials.
  const wb: WorkBook = read(new Uint8Array(buffer), {
    type: "array",
    dense: true,
    cellNF: true,
    cellDates: false,
    sheets: [sheet],
  });
  const ws = wb.Sheets[sheet];
  if (!ws || !ws["!ref"]) throw new Error(`Sheet "${sheet}" is empty.`);
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);
  const range = utils.decode_range(ws["!ref"]);
  const data = (ws["!data"] ?? []) as Array<Array<CellObject | undefined> | undefined>;

  // Header detection on the first rows' displayed text (blank rows dropped, as CSV sniffing does).
  const preview: string[][] = [];
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 60); r++) {
    const row = data[r] ?? [];
    const texts: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) texts.push(cellText(row[c]));
    if (texts.some((t) => t.trim() !== "")) preview.push(texts);
  }
  const header = detectHeader(preview);
  const width = range.e.c - range.s.c + 1;
  // Map preview index back to the physical row index (preview skipped blank rows).
  let headerPhysical = range.s.r;
  {
    let seen = -1;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row = data[r] ?? [];
      let any = false;
      for (let c = range.s.c; c <= range.e.c; c++) if (cellText(row[c]).trim() !== "") any = true;
      if (any) seen++;
      if (seen === header.headerIndex) {
        headerPhysical = r;
        break;
      }
    }
  }
  const headerCells = (data[headerPhysical] ?? []).slice(range.s.c, range.e.c + 1);
  const names = header.hasHeader
    ? cleanHeaders(Array.from({ length: width }, (_, j) => cellText(headerCells[j])))
    : cleanHeaders(Array.from({ length: width }, (_, j) => `Column ${j + 1}`));
  const firstRow = header.hasHeader ? headerPhysical + 1 : headerPhysical;

  const keep = names.map((n) => (opts.columns ? opts.columns.includes(n) : true));
  // Type-inference sample: the first ~5,000 rows below the header; blank rows simply contribute nulls.
  const samples: CellValue[][] = names.map(() => []);
  for (let r = firstRow; r <= Math.min(range.e.r, firstRow + 5000); r++) {
    const row = data[r] ?? [];
    for (let j = 0; j < width; j++) (samples[j] as CellValue[]).push(cellValue(row[range.s.c + j], date1904));
  }
  const plans: ColumnPlan[] = names.map((n, j) =>
    keep[j] ? inferPlan(samples[j] as CellValue[], n) : { kind: "string" },
  );
  const accs = names.map((n, j) =>
    keep[j]
      ? createAccumulator(plans[j] as ColumnPlan, {
          preferDayFirst: opts.preferDayFirst ?? true,
          forcedOrder: opts.dateOrderOverrides?.[n],
        })
      : null,
  );

  const every = opts.sampleEvery && opts.sampleEvery > 1 ? opts.sampleEvery : 1;
  const maxRows = opts.maxRows ?? Infinity;
  let kept = 0;
  // Counts non-blank data rows; systematic sampling keeps 0, every, 2·every, …
  let dataIndex = -1;
  // Physical rows below the header, blank ones included: the progress denominator and the sampling estimate.
  const total = range.e.r - firstRow + 1;
  for (let r = firstRow; r <= range.e.r && kept < maxRows; r++) {
    const row = data[r];
    if (!row || row.every((c) => !c || c.t === "z" || cellText(c).trim() === "")) continue;
    dataIndex++;
    if (every > 1 && dataIndex % every !== 0) continue;
    for (let j = 0; j < width; j++) accs[j]?.push(cellValue(row[range.s.c + j], date1904));
    kept++;
    if (kept % 50_000 === 0)
      onProgress?.({
        phase: "parsing",
        loadedBytes: Math.round((r / Math.max(1, total)) * buffer.byteLength),
        totalBytes: buffer.byteLength,
        rows: kept,
      });
  }
  onProgress?.({
    phase: "finalizing",
    loadedBytes: buffer.byteLength,
    totalBytes: buffer.byteLength,
    rows: kept,
  });

  const columns = [];
  const dateFormats = [];
  const columnNotes = [];
  const skipped: string[] = [];
  for (let j = 0; j < width; j++) {
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
  const warnings: string[] = [];
  if (!header.hasHeader)
    warnings.push("No header row was detected, so columns were named Column 1, Column 2, …");
  if (headerPhysical > range.s.r)
    warnings.push(`Skipped ${headerPhysical - range.s.r} row(s) above the table.`);
  if (sheetNames.length > 1)
    warnings.push(`Read sheet "${sheet}" (${sheetNames.length} sheets in this workbook).`);

  // .xlsm, .xlsb and .ods are reported as "xlsx".
  const kind = /\.xls$/i.test(fileName) ? "xls" : "xlsx";
  return {
    dataset: {
      id: newDatasetId(),
      name: fileName.replace(/\.[^.]+$/, ""),
      rowCount: kept,
      columns,
      source: { fileName, kind, sizeBytes: buffer.byteLength, sheet, isDemo: false },
    },
    report: {
      fileName,
      kind,
      sizeBytes: buffer.byteLength,
      rowCount: kept,
      columnCount: columns.length,
      headerRowIndex: headerPhysical,
      headerDetected: header.hasHeader,
      sheet,
      sheets: sheetNames,
      dateFormats,
      columnNotes,
      warnings,
      sampling:
        every > 1 || Number.isFinite(maxRows)
          ? {
              strategy: every > 1 ? "systematic" : "first",
              keptRows: kept,
              estimatedTotalRows: total,
              every: every > 1 ? every : undefined,
            }
          : undefined,
      skippedColumns: skipped.length ? skipped : undefined,
      durationMs: Math.round(performance.now() - started),
    },
  };
}
