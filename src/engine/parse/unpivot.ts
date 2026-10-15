/**
 * Wide → long reshaping ("Jan, Feb, Mar" columns become Period + Value rows).
 *
 * Runs on demand when profiling found a wide layout (structure.detectWideFormat)
 * and the user accepts the suggestion. With k period columns, source row r
 * becomes output rows r·k … r·k + k − 1, one per period; the other columns are
 * repeated. The result is a new "derived" dataset with k times the rows, so
 * memory grows accordingly.
 */
import type {
  Column,
  Dataset,
  DateColumn,
  NumberColumn,
  StringColumn,
  UnreadableCells,
} from "@/engine/core/types";
import { MONTHS_SHORT, utc } from "@/engine/core/dates";
import type { WideFormatInfo } from "@/engine/profile/types";
import { uniqueName } from "./builder";
import { newDatasetId } from "./csv";
import { fullYear } from "./dates";

/**
 * First day of the period a wide header names, as wall-clock ms, or null.
 * Two-digit years pivot at 50 like the parser (dates.fullYear: "Jan 99" is
 * 1999, "FY24" is 2024). Month headers need a year ("Jan 24"); a bare "Jan"
 * gives null.
 */
function periodDate(name: string, kind: WideFormatInfo["kind"]): number | null {
  const s = name.trim().toLowerCase();
  if (kind === "date") {
    const m = /^(\d{4})[-/](\d{1,2})$/.exec(s);
    return m ? utc(Number(m[1]), Number(m[2]), 1) : null;
  }
  if (kind === "year") {
    const m = /(\d{4}|\d{2})$/.exec(s);
    if (!m) return null;
    return utc(fullYear(m[1] as string), 1, 1);
  }
  if (kind === "quarter") {
    const m = /(?:(\d{4})[\s\-_]*)?q([1-4])(?:[\s\-_]*(\d{2}|\d{4}))?/.exec(s);
    if (!m) return null;
    const yRaw = m[1] ?? m[3];
    if (!yRaw) return null;
    return utc(fullYear(yRaw), (Number(m[2]) - 1) * 3 + 1, 1);
  }
  const m = /^([a-z]{3})[a-z]*[\s\-_']*(\d{2}|\d{4})?$/.exec(s);
  if (!m) return null;
  const month = MONTHS_SHORT.findIndex((x) => x.toLowerCase() === m[1]);
  if (month < 0 || !m[2]) return null;
  return utc(fullYear(m[2]), month + 1, 1);
}

/**
 * Melts `wide.columns` into a Period (or Year) column plus a Value column.
 * Only number columns are melted. Period is a date column when every header
 * parses (see periodDate), otherwise text holding the original headers in
 * column order. Value takes the first wide column's number format. The new
 * names get a " (2)", " (3)", … suffix when a kept column already has them
 * (case-insensitively).
 */
/**
 * Names of the two columns unpivoting adds ("Year" or "Period", and "Value",
 * suffixed when a kept column already uses them). Shared with the UI so the
 * user sees exactly what would be added before agreeing.
 */
export function unpivotColumnNames(
  columnNames: string[],
  wide: WideFormatInfo,
): { period: string; value: string } {
  const used = new Set(columnNames.filter((n) => !wide.columns.includes(n)).map((n) => n.toLowerCase()));
  return {
    period: uniqueName(wide.kind === "year" ? "Year" : "Period", used),
    value: uniqueName("Value", used),
  };
}

/**
 * Unreadable cells of a kept column after unpivoting: each one repeats on the
 * k rows its source row became.
 */
function repeatUnreadable(u: UnreadableCells | undefined, k: number): UnreadableCells | undefined {
  if (!u || !u.rows.length) return undefined;
  const rows = new Int32Array(u.rows.length * k);
  const codes = new Int32Array(u.rows.length * k);
  for (let i = 0; i < u.rows.length; i++)
    for (let j = 0; j < k; j++) {
      rows[i * k + j] = (u.rows[i] as number) * k + j;
      codes[i * k + j] = u.codes[i] as number;
    }
  return { rows, codes, texts: u.texts };
}

/** Unreadable cells of the Value column: wide column j's row r lands on row r*k + j. */
function mergeUnreadable(cols: NumberColumn[], k: number): UnreadableCells | undefined {
  const cells: Array<{ row: number; text: string }> = [];
  cols.forEach((c, j) => {
    const u = c.unreadable;
    if (u)
      for (let i = 0; i < u.rows.length; i++)
        cells.push({ row: (u.rows[i] as number) * k + j, text: u.texts[u.codes[i] as number] as string });
  });
  if (!cells.length) return undefined;
  cells.sort((a, b) => a.row - b.row);
  const texts: string[] = [];
  const index = new Map<string, number>();
  const codes = Int32Array.from(cells, (c) => {
    let code = index.get(c.text);
    if (code === undefined) {
      code = texts.length;
      index.set(c.text, code);
      texts.push(c.text);
    }
    return code;
  });
  return { rows: Int32Array.from(cells, (c) => c.row), codes, texts };
}

export function unpivotDataset(ds: Dataset, wide: WideFormatInfo): Dataset {
  const wideCols = wide.columns
    .map((n) => ds.columns.find((c) => c.name === n))
    .filter((c): c is NumberColumn => c?.kind === "number");
  const idCols = ds.columns.filter((c) => !wide.columns.includes(c.name));
  const k = wideCols.length;
  const n = ds.rowCount * k;
  const out: Column[] = [];
  for (const c of idCols) {
    const unreadable = repeatUnreadable(c.unreadable, k);
    switch (c.kind) {
      case "string": {
        const codes = new Int32Array(n);
        for (let r = 0; r < ds.rowCount; r++)
          for (let j = 0; j < k; j++) codes[r * k + j] = c.codes[r] as number;
        out.push({ ...c, codes, unreadable });
        break;
      }
      case "boolean": {
        const values = new Int8Array(n);
        for (let r = 0; r < ds.rowCount; r++)
          for (let j = 0; j < k; j++) values[r * k + j] = c.values[r] as number;
        out.push({ ...c, values, unreadable });
        break;
      }
      default: {
        // Number and date columns both store Float64Array values.
        const values = new Float64Array(n);
        for (let r = 0; r < ds.rowCount; r++)
          for (let j = 0; j < k; j++) values[r * k + j] = c.values[r] as number;
        out.push({ ...c, values, unreadable } as Column);
      }
    }
  }
  const dates = wideCols.map((c) => periodDate(c.name, wide.kind));
  const { period: periodName, value: valueName } = unpivotColumnNames(
    ds.columns.map((c) => c.name),
    wide,
  );
  if (dates.every((d) => d !== null)) {
    const values = new Float64Array(n);
    for (let r = 0; r < ds.rowCount; r++) for (let j = 0; j < k; j++) values[r * k + j] = dates[j] as number;
    const col: DateColumn = {
      kind: "date",
      name: periodName,
      values,
      hasTime: false,
      format: wide.kind === "year" ? "YYYY" : "YYYY-MM",
    };
    out.push(col);
  } else {
    const codes = new Int32Array(n);
    for (let r = 0; r < ds.rowCount; r++) for (let j = 0; j < k; j++) codes[r * k + j] = j;
    const col: StringColumn = { kind: "string", name: periodName, codes, dict: wideCols.map((c) => c.name) };
    out.push(col);
  }
  const values = new Float64Array(n);
  for (let r = 0; r < ds.rowCount; r++)
    for (let j = 0; j < k; j++) values[r * k + j] = (wideCols[j] as NumberColumn).values[r] as number;
  const fmt = wideCols[0]?.format ?? { integer: false, decimals: 2 };
  out.push({
    kind: "number",
    name: valueName,
    values,
    format: fmt,
    unreadable: mergeUnreadable(wideCols, k),
  });
  return {
    id: newDatasetId(),
    name: `${ds.name} (unpivoted)`,
    rowCount: n,
    columns: out,
    source: { ...ds.source, kind: "derived" },
  };
}
