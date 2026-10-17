/**
 * Tall → wide reshaping for scorecards: rows of "Metric | Month | Value"
 * become one column per metric ("Gross NPA %", "ARPU"), the reverse of
 * unpivot.ts.
 *
 * Runs on demand when profiling found a tall scorecard
 * (structure.detectTallFormat) and the user accepts the suggestion. The
 * result is a new "derived" dataset with one row per combination of the id
 * columns, in the order the file first has them, and one number column per
 * metric and value column: the main value under the metric's own name, the
 * others as "Metric (Target)". Each new column is then profiled from its own
 * name and values, so "Gross NPA %" reads as a percentage and "Advances (₹
 * Cr)" as money.
 *
 * Nothing is added up, averaged or made up. A combination with no row for a
 * metric is blank, and a metric that never has a figure in a value column
 * gets no column for it. When the file has a metric twice for the same
 * combination (one id column too few, say two sections of one sheet), the
 * second goes on a row of its own, so every figure lands in exactly one cell;
 * pairing them in file order keeps a section's figures together. Rows
 * without a metric name, and headings with no figures, are left out and
 * counted in the plan.
 */
import { unreadableAt } from "@/engine/core/types";
import type {
  Column,
  Dataset,
  NumberColumn,
  NumberFormatInfo,
  StringColumn,
  UnreadableCells,
} from "@/engine/core/types";
import { denseCodes, listOf, tupleCodes } from "@/engine/profile/structure";
import type { TallFormatInfo } from "@/engine/profile/types";
import { uniqueName } from "./builder";
import { newDatasetId } from "./csv";

/** One column pivoting adds: its name, and the metric and value column its figures come from. */
export interface PivotColumn {
  name: string;
  metric: string;
  value: string;
}

/** What pivoting does, shown before the user agrees (Detect) and reported after (the parse report). */
export interface PivotPlan {
  /** Rows of the pivoted table. */
  rows: number;
  /** The columns it adds, in order: each metric's main value, then each other value column's. */
  columns: PivotColumn[];
  /** The id columns, kept as they are. */
  kept: string[];
  /**
   * The file's other columns, which the pivoted table leaves out: the metric
   * and value columns, and any that describe one metric (a unit, a KPI
   * category) or one row (a remark, a status).
   */
  removed: string[];
  /** A column holding each metric's unit ("%", "₹ Cr"), written into the new names; null when there is none. */
  unitColumn: string | null;
  /** Rows that repeat a metric for the same id values; each repeat got a row of its own. */
  repeats: number;
  /** Rows left out: without a metric name, or a heading that has no figures. */
  skipped: number;
  /** Figures on those rows (a row without a metric name can still hold one). */
  lostFigures: number;
}

/** Everything both the plan and the pivot need, worked out once per call. */
interface Layout {
  plan: PivotPlan;
  ids: Column[];
  values: NumberColumn[];
  /** Metric position per source row; -1 when the row is left out. */
  posOfRow: Int32Array;
  /** Output row per source row; -1 when the row is left out. */
  outRow: Int32Array;
  /** The first source row of each output row, whose id values the output row takes. */
  firstRow: Int32Array;
  /** New column index per (value column, metric) as `v * metrics + pos`; -1 when that pair has no figure. */
  columnOf: Int32Array;
}

/** Headings of a column that gives each metric's unit ("Unit", "UOM", "Unit of measure"). */
const UNIT_HEADING =
  /^(?:units?|uom|unit of measure(?:ment)?|measure(?:ment)? units?|(?:kpi|metric) units?)$/i;

/**
 * The unit of each metric from a column like "Unit" or "UOM" that holds one
 * value per metric, or null when there is no such column.
 */
function metricUnits(
  ds: Dataset,
  tall: TallFormatInfo,
  metric: StringColumn,
  posOf: Int32Array,
): { column: string; units: string[] } | null {
  const skip = new Set([tall.metricColumn, ...tall.valueColumns, ...tall.idColumns]);
  for (const col of ds.columns) {
    if (col.kind !== "string" || skip.has(col.name) || !UNIT_HEADING.test(col.name.trim())) continue;
    const units = new Array<string | null>(tall.metrics.length).fill(null);
    let consistent = true;
    for (let r = 0; r < ds.rowCount && consistent; r++) {
      const code = metric.codes[r] as number;
      const pos = code < 0 ? -1 : (posOf[code] as number);
      const u = col.codes[r] as number;
      if (pos < 0 || u < 0) continue;
      const text = (col.dict[u] as string).trim();
      const seen = units[pos];
      if (seen === null) units[pos] = text;
      else if (seen !== text) consistent = false;
    }
    if (consistent) return { column: col.name, units: units.map((u) => u ?? "") };
  }
  return null;
}

/** Lower-case words and unit signs of a name: "Gross NPA%" → gross, npa, %; "(₹ Cr)" → ₹, cr. */
function unitWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[%#₹$€£¥]/g, (sign) => ` ${sign} `)
    .split(/[^\p{L}\p{N}%#₹$€£¥]+/u)
    .filter(Boolean);
}

/**
 * "Gross NPA" with unit "%" → "Gross NPA (%)", unless the name already says
 * it ("Gross NPA %", "Advances (₹ Cr)"). Compared word by word, so a unit "M"
 * is not found inside "Members".
 */
function withUnit(metric: string, unit: string): string {
  const words = unitWords(metric);
  const own = unitWords(unit);
  if (!own.length || own.every((w) => words.includes(w))) return metric;
  return `${metric} (${unit})`;
}

function layout(ds: Dataset, tall: TallFormatInfo): Layout {
  const byName = (name: string) => ds.columns.find((c) => c.name === name);
  const metric = byName(tall.metricColumn);
  if (metric?.kind !== "string")
    throw new Error(`No text column "${tall.metricColumn}" to turn into columns.`);
  const values = tall.valueColumns.map(byName).filter((c): c is NumberColumn => c?.kind === "number");
  if (!values.length) throw new Error("No value columns to turn into columns.");
  const ids = tall.idColumns.map(byName).filter((c): c is Column => c !== undefined);
  const n = ds.rowCount;
  const k = tall.metrics.length;

  // Metric position per dictionary code: dictionary entries are unique, so each metric has one code.
  const wanted = new Map(tall.metrics.map((m, i) => [m, i]));
  const posOf = new Int32Array(metric.dict.length).fill(-1);
  metric.dict.forEach((s, code) => {
    const p = wanted.get(s);
    if (p !== undefined) posOf[code] = p;
  });

  // One output row per combination of id values, in first-seen order; a metric that comes again for
  // the same combination goes on that combination's next row.
  const key = tupleCodes(
    ids.map((c) => denseCodes(c)),
    n,
  ).codes;
  const rowsOfKey = new Map<number, number[]>();
  const times = new Map<number, number>();
  const posOfRow = new Int32Array(n).fill(-1);
  const outRow = new Int32Array(n).fill(-1);
  const first: number[] = [];
  let repeats = 0;
  let skipped = 0;
  let lostFigures = 0;
  for (let r = 0; r < n; r++) {
    const code = metric.codes[r] as number;
    const pos = code < 0 ? -1 : (posOf[code] as number);
    if (pos < 0) {
      skipped++;
      for (const v of values) if ((v.values[r] as number) === (v.values[r] as number)) lostFigures++;
      continue;
    }
    const kk = key[r] as number;
    // Exact: kk < n and pos < k.
    const slot = kk * k + pos;
    const occ = times.get(slot) ?? 0;
    times.set(slot, occ + 1);
    if (occ > 0) repeats++;
    let list = rowsOfKey.get(kk);
    if (!list) {
      list = [];
      rowsOfKey.set(kk, list);
    }
    if (list.length <= occ) {
      list.push(first.length);
      first.push(r);
    }
    posOfRow[r] = pos;
    outRow[r] = list[occ] as number;
  }

  // A (value column, metric) pair becomes a column only when it has a figure, or a cell the file had but
  // that couldn't be read: an all-blank column would only stand in the way.
  const figured = new Uint8Array(values.length * k);
  values.forEach((v, j) => {
    for (let r = 0; r < n; r++) {
      const pos = posOfRow[r] as number;
      if (pos >= 0 && (v.values[r] as number) === (v.values[r] as number)) figured[j * k + pos] = 1;
    }
    const u = v.unreadable;
    if (u)
      for (const r of u.rows) {
        const pos = posOfRow[r] as number;
        if (pos >= 0) figured[j * k + pos] = 1;
      }
  });

  const unit = metricUnits(ds, tall, metric, posOf);
  const display = tall.metrics.map((m, p) => withUnit(m, unit?.units[p] ?? ""));
  const used = new Set(ids.map((c) => c.name.toLowerCase()));
  const columnOf = new Int32Array(values.length * k).fill(-1);
  const columns: PivotColumn[] = [];
  values.forEach((v, j) => {
    for (let p = 0; p < k; p++) {
      if (!figured[j * k + p]) continue;
      const base = j === 0 ? (display[p] as string) : `${display[p] as string} (${v.name})`;
      columnOf[j * k + p] = columns.length;
      columns.push({ name: uniqueName(base, used), metric: tall.metrics[p] as string, value: v.name });
    }
  });

  const kept = ids.map((c) => c.name);
  const plan: PivotPlan = {
    rows: first.length,
    columns,
    kept,
    removed: ds.columns.map((c) => c.name).filter((name) => !kept.includes(name)),
    unitColumn: unit?.column ?? null,
    repeats,
    skipped,
    lostFigures,
  };
  return { plan, ids, values, posOfRow, outRow, firstRow: Int32Array.from(first), columnOf };
}

/**
 * What pivoting `tall` would do to `ds`: the rows it makes, the columns it
 * adds (exact names) and leaves out, and the rows it can't place. Shared by
 * the consent dialog on Detect and the parse report, so the user sees what
 * will happen before agreeing.
 */
export function pivotPlan(ds: Dataset, tall: TallFormatInfo): PivotPlan {
  return layout(ds, tall).plan;
}

/** Unreadable cells of a kept column on the output rows (each output row takes its first source row's cell). */
function pickUnreadable(u: UnreadableCells | undefined, rows: Int32Array): UnreadableCells | undefined {
  if (!u || !u.rows.length) return undefined;
  const at: number[] = [];
  const codes: number[] = [];
  const index = new Map<string, number>();
  const texts: string[] = [];
  // `rows` ascend (an output row is made by a later source row than the one before), so `at` does too.
  rows.forEach((r, i) => {
    const text = unreadableAt(u, r);
    if (text === undefined) return;
    let code = index.get(text);
    if (code === undefined) {
      code = texts.length;
      index.set(text, code);
      texts.push(text);
    }
    at.push(i);
    codes.push(code);
  });
  return at.length ? { rows: Int32Array.from(at), codes: Int32Array.from(codes), texts } : undefined;
}

/** A kept column on the output rows: each takes the values of its first source row. */
function takeRows(c: Column, rows: Int32Array): Column {
  const unreadable = pickUnreadable(c.unreadable, rows);
  switch (c.kind) {
    case "string":
      return { ...c, codes: Int32Array.from(rows, (r) => c.codes[r] as number), unreadable };
    case "boolean":
      return { ...c, values: Int8Array.from(rows, (r) => c.values[r] as number), unreadable };
    case "date":
      return { ...c, values: Float64Array.from(rows, (r) => c.values[r] as number), unreadable };
    case "number":
      return { ...c, values: Float64Array.from(rows, (r) => c.values[r] as number), unreadable };
  }
}

/**
 * Number format of a new metric column, from its own figures: whole numbers
 * or the decimals written. A "%" sign belongs to cells rather than columns:
 * the parser stored those cells as fractions and marked the value column a
 * percentage when most cells had one, so a metric whose figures are all
 * fractions in such a column was written with the sign too. A currency mark
 * is not carried over: the value column holds several units, so a mark that
 * covered most of its cells may not cover this metric's; the metric's own
 * name ("Advances (₹ Cr)") says when it is money.
 */
function formatOf(values: Float64Array, source: NumberFormatInfo): NumberFormatInfo {
  let integer = true;
  let decimals = 0;
  let any = false;
  let fractions = true;
  for (const x of values) {
    if (x !== x) continue;
    any = true;
    if (Math.abs(x) > 1.5) fractions = false;
    if (!Number.isInteger(x)) {
      integer = false;
      const frac = String(x).split(".")[1];
      if (frac) decimals = Math.max(decimals, Math.min(6, frac.length));
    }
  }
  const percent = source.percent === true && any && fractions && !integer;
  return percent ? { integer, decimals: Math.max(0, decimals - 2), percent: true } : { integer, decimals };
}

/**
 * Turns `tall`'s metrics into columns (see the file header): the id columns
 * first, as in the file, then one number column per PivotPlan column. The
 * result is a new derived dataset; `ds` is not changed.
 */
export function pivotDataset(ds: Dataset, tall: TallFormatInfo): Dataset {
  const L = layout(ds, tall);
  const n = ds.rowCount;
  const k = tall.metrics.length;
  const m = L.plan.rows;
  const out: Column[] = L.ids.map((c) => takeRows(c, L.firstRow));
  const cells = L.plan.columns.map(() => new Float64Array(m).fill(NaN));
  // Unreadable cells of each new column, gathered from its value column's.
  const unread: Array<Array<{ row: number; text: string }>> = L.plan.columns.map(() => []);
  L.values.forEach((v, j) => {
    for (let r = 0; r < n; r++) {
      const pos = L.posOfRow[r] as number;
      if (pos < 0) continue;
      const col = L.columnOf[j * k + pos] as number;
      if (col >= 0) (cells[col] as Float64Array)[L.outRow[r] as number] = v.values[r] as number;
    }
    const u = v.unreadable;
    if (u)
      u.rows.forEach((r, i) => {
        const pos = L.posOfRow[r] as number;
        const col = pos < 0 ? -1 : (L.columnOf[j * k + pos] as number);
        if (col >= 0)
          (unread[col] as Array<{ row: number; text: string }>).push({
            row: L.outRow[r] as number,
            text: u.texts[u.codes[i] as number] as string,
          });
      });
  });
  L.plan.columns.forEach((c, i) => {
    const values = cells[i] as Float64Array;
    const source = L.values.find((v) => v.name === c.value) as NumberColumn;
    out.push({
      kind: "number",
      name: c.name,
      values,
      format: formatOf(values, source.format),
      unreadable: unreadableFrom(unread[i] as Array<{ row: number; text: string }>),
    });
  });
  return {
    id: newDatasetId(),
    name: `${ds.name} (pivoted)`,
    rowCount: m,
    columns: out,
    source: { ...ds.source, kind: "derived" },
  };
}

/** UnreadableCells from (row, text) pairs, rows ascending. */
function unreadableFrom(cells: Array<{ row: number; text: string }>): UnreadableCells | undefined {
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

/** "1 row", "12 rows": like the parser's notes, in plain digits whatever the user's number format. */
const countOf = (count: number, noun: string) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? noun : `${noun}s`}`;

/**
 * The parse report's sentence for a pivot: what was turned into what, and
 * anything the user should know (units written into names, repeats given
 * rows of their own, rows left out and the figures on them).
 */
export function pivotSummary(plan: PivotPlan, tall: TallFormatInfo): string {
  const parts = [
    `Turned the ${countOf(tall.metrics.length, "metric")} in "${tall.metricColumn}" into ${countOf(plan.columns.length, "column")}, on ${countOf(plan.rows, "row")}.`,
  ];
  if (plan.unitColumn) parts.push(`Each metric's unit from "${plan.unitColumn}" is in its column's name.`);
  if (plan.repeats)
    parts.push(
      `${countOf(plan.repeats, "row")} repeated a metric already given for the same ${plan.kept.length ? listOf(plan.kept) : "table"}, so each repeat got a row of its own.`,
    );
  if (plan.skipped)
    parts.push(
      `${countOf(plan.skipped, "row")} without a metric name or without figures ${plan.skipped === 1 ? "was" : "were"} left out${plan.lostFigures ? `, with ${countOf(plan.lostFigures, "figure")} on them` : ""}.`,
    );
  return parts.join(" ");
}
