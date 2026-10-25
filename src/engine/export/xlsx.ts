/**
 * A small Excel (.xlsx) writer (version 56.0): sheets of typed cells with
 * native number formats, a bold header with frozen panes and filter buttons,
 * and set column widths, zipped as Office Open XML that Excel, Google Sheets,
 * Numbers and LibreOffice open. Written here rather than with SheetJS, whose
 * free edition writes no cell styles, so headers couldn't be bold or frozen.
 *
 * Numbers stay numbers and dates stay dates (Excel serial days), so a sum or
 * a pivot in Excel works on them; the format only changes how they look
 * ("#,##0", "0.0%", ISO dates, the currency symbol). Text is written as
 * inline strings, which Excel never reads as a formula, so values starting
 * with "=" need no guard here (unlike a CSV). Rows come from an iterator and
 * are zipped as they are written (fflate's streaming Zip), so a sheet of a
 * million rows is never one string in memory.
 */
import { Zip, ZipDeflate } from "fflate";

/** How a cell looks: text styles, and number formats for numbers and dates. */
export type XlsxStyle =
  | "text"
  | "header"
  | "title"
  | "subtitle"
  | "label"
  | "note"
  | "integer"
  | "decimal"
  | "ratio"
  | "percent"
  | "days"
  | "currency"
  /** A relative change, signed, with a true minus: "+10.7%", "−3.2%". */
  | "change"
  /** A change in percentage points, signed: "+1.4 pp". */
  | "points"
  | "date"
  | "datetime"
  | "time"
  | "month"
  | "year";

export type XlsxValue = string | number | boolean | null | undefined;
/** A cell: a value in its column's style, or a value with its own. */
export type XlsxCell = XlsxValue | { v: XlsxValue; s: XlsxStyle };

export interface XlsxSheet {
  name: string;
  /** Column widths in characters. */
  widths: readonly number[];
  /** The style of each column's plain values (default "text"). */
  styles?: ReadonlyArray<XlsxStyle | undefined>;
  /** The rows, produced on demand. */
  rows: Iterable<readonly XlsxCell[]>;
  /** A table's header row (1-based) and width: frozen below it, with filter buttons over the table. */
  table?: { headerRow: number; columns: number };
}

/** Excel's largest row number: a sheet holds at most this many rows, its header included. */
export const XLSX_MAX_ROWS = 1_048_576;
const MS_PER_DAY = 86_400_000;
/** 1 Jan 1970 as an Excel serial day (the 1900 date system). */
const EPOCH = 25_569;

/** A wall-clock date (ms, stored as UTC) as an Excel serial day, the time as its fraction. */
export const excelDate = (ms: number): number => ms / MS_PER_DAY + EPOCH;
/** A time of day (ms since midnight) as Excel's fraction of a day. */
export const excelTime = (ms: number): number => ms / MS_PER_DAY;

const quoted = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** The number format of each number style; the currency's symbol leads its amounts. */
function numberFormats(currencySymbol: string): Record<string, string> {
  const sym = currencySymbol.trim();
  return {
    integer: "#,##0",
    decimal: "#,##0.00",
    ratio: "0.00",
    percent: "0.0%",
    days: '#,##0.0" days"',
    currency: sym ? `${quoted(currencySymbol)}#,##0.00` : "#,##0.00",
    change: '+0.0%;"−"0.0%;0.0%',
    points: '+0.0" pp";"−"0.0" pp";0.0" pp"',
    date: "yyyy-mm-dd",
    datetime: "yyyy-mm-dd hh:mm",
    time: "hh:mm",
    month: "mmm yyyy",
    year: "yyyy",
  };
}

/** Fonts, fills and borders of the text styles: [font, fill, border]. */
const TEXT_STYLES: Record<string, [number, number, number]> = {
  text: [0, 0, 0],
  header: [1, 2, 1],
  title: [2, 0, 0],
  subtitle: [3, 0, 0],
  label: [1, 0, 0],
  note: [4, 0, 0],
};
const STYLE_ORDER: XlsxStyle[] = [
  "text",
  "header",
  "title",
  "subtitle",
  "label",
  "note",
  "integer",
  "decimal",
  "ratio",
  "percent",
  "days",
  "currency",
  "change",
  "points",
  "date",
  "datetime",
  "time",
  "month",
  "year",
];
const STYLE_INDEX = new Map(STYLE_ORDER.map((s, i) => [s, i]));

function stylesXml(currencySymbol: string): string {
  const formats = numberFormats(currencySymbol);
  const custom = Object.entries(formats);
  const numFmtId = new Map(custom.map(([k], i) => [k, 164 + i]));
  const xfs = STYLE_ORDER.map((s) => {
    const [font, fill, border] = TEXT_STYLES[s] ?? [0, 0, 0];
    const fmt = numFmtId.get(s) ?? 0;
    return `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${fmt ? ' applyNumberFormat="1"' : ""} applyFont="1" applyFill="1" applyBorder="1"/>`;
  });
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="${custom.length}">${custom
      .map(([k, code]) => `<numFmt numFmtId="${numFmtId.get(k)}" formatCode="${esc(code)}"/>`)
      .join("")}</numFmts>` +
    `<fonts count="5">` +
    `<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
    `<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
    `<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>` +
    `<font><sz val="11"/><color rgb="FF595959"/><name val="Calibri"/><family val="2"/></font>` +
    `<font><i/><sz val="10"/><color rgb="FF595959"/><name val="Calibri"/><family val="2"/></font>` +
    `</fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border><left/><right/><top/><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

// Characters XML 1.0 can't hold (control characters, lone surrogates) are dropped.
const BAD_XML =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
function esc(s: string): string {
  return s
    .replace(BAD_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Column letters: 0 → A, 25 → Z, 26 → AA. */
export function columnLetters(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const NUMBER_STYLES = new Set<XlsxStyle>(STYLE_ORDER.slice(STYLE_ORDER.indexOf("integer")));
/** Excel's longest cell text. */
const MAX_TEXT = 32_767;

function cellXml(ref: string, cell: XlsxCell, columnStyle: XlsxStyle): string {
  const own = cell !== null && typeof cell === "object";
  const v = own ? cell.v : cell;
  const style = own ? cell.s : columnStyle;
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return `<c r="${ref}" s="${STYLE_INDEX.get(style) ?? 0}"><v>${v}</v></c>`;
  }
  if (typeof v === "boolean") return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
  // Text in a number column keeps the plain text style.
  const textStyle = NUMBER_STYLES.has(style) ? 0 : (STYLE_INDEX.get(style) ?? 0);
  const text = esc(v.length > MAX_TEXT ? v.slice(0, MAX_TEXT) : v);
  return `<c r="${ref}" s="${textStyle}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

/**
 * Sheet names Excel accepts: no []:*?/\, at most 31 characters (a longer one is cut at a word, with
 * "…"; the full title heads the sheet), unique in the workbook (any case).
 */
export function sheetNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base =
      raw
        .replace(/[[\]:*?/\\]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^'+|'+$/g, "") || "Sheet";
    const fit = (room: number) => {
      if (base.length <= room) return base;
      const cut = base.slice(0, room - 1);
      const space = cut.lastIndexOf(" ");
      return `${(space > room / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
    };
    let name = fit(31);
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${fit(31 - ` (${k})`.length)} (${k})`;
    used.add(name.toLowerCase());
    return name;
  });
}

const enc = new TextEncoder();

/** The workbook as .xlsx bytes. `currencySymbol` leads every "currency" cell ("₹", "$", "CHF "). */
export function xlsxWorkbook(sheets: readonly XlsxSheet[], currencySymbol = ""): Uint8Array {
  const out: Uint8Array[] = [];
  const zip = new Zip((err, data) => {
    if (err) throw err;
    out.push(data);
  });
  const add = (path: string, text: string) => {
    const f = new ZipDeflate(path, { level: 6 });
    zip.add(f);
    f.push(enc.encode(text), true);
  };
  const names = sheetNames(sheets.map((s) => s.name));
  const filters: string[] = [];

  sheets.forEach((sheet, i) => {
    const f = new ZipDeflate(`xl/worksheets/sheet${i + 1}.xml`, { level: 6 });
    zip.add(f);
    const t = sheet.table;
    const pane = t
      ? `<pane ySplit="${t.headerRow}" topLeftCell="A${t.headerRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${t.headerRow + 1}" sqref="A${t.headerRow + 1}"/>`
      : "";
    const cols = sheet.widths
      .map(
        (w, c) =>
          `<col min="${c + 1}" max="${c + 1}" width="${Math.max(4, Math.min(80, w)).toFixed(1)}" customWidth="1"/>`,
      )
      .join("");
    f.push(
      enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheetViews><sheetView${i === 0 ? ' tabSelected="1"' : ""} workbookViewId="0">${pane}</sheetView></sheetViews>` +
          `<sheetFormatPr defaultRowHeight="15"/>` +
          (cols ? `<cols>${cols}</cols>` : "") +
          `<sheetData>`,
      ),
    );
    const styles = sheet.styles ?? [];
    let r = 0;
    let buf: string[] = [];
    for (const row of sheet.rows) {
      if (r >= XLSX_MAX_ROWS) break;
      r++;
      let cells = "";
      for (let c = 0; c < row.length; c++)
        cells += cellXml(`${columnLetters(c)}${r}`, row[c] as XlsxCell, styles[c] ?? "text");
      buf.push(`<row r="${r}">${cells}</row>`);
      // Flushed every few thousand rows, so the sheet is never one string.
      if (buf.length >= 2000) {
        f.push(enc.encode(buf.join("")));
        buf = [];
      }
    }
    let tail = `${buf.join("")}</sheetData>`;
    if (t && r > t.headerRow && t.columns > 0) {
      const ref = `A${t.headerRow}:${columnLetters(t.columns - 1)}${r}`;
      tail += `<autoFilter ref="${ref}"/>`;
      const abs = `$A$${t.headerRow}:$${columnLetters(t.columns - 1)}$${r}`;
      filters.push(
        `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(`'${(names[i] ?? "").replace(/'/g, "''")}'!${abs}`)}</definedName>`,
      );
    }
    f.push(enc.encode(`${tail}</worksheet>`), true);
  });

  add("xl/styles.xml", stylesXml(currencySymbol));
  add(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<bookViews><workbookView activeTab="0"/></bookViews>` +
      `<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
      (filters.length ? `<definedNames>${filters.join("")}</definedNames>` : "") +
      `</workbook>`,
  );
  add(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      names
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("") +
      `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
  );
  add(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  );
  add(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      names
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("") +
      `</Types>`,
  );
  zip.end();

  const bytes = new Uint8Array(out.reduce((s, b) => s + b.length, 0));
  let off = 0;
  for (const b of out) {
    bytes.set(b, off);
    off += b.length;
  }
  return bytes;
}
