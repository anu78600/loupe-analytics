/**
 * Traps in the data itself (version 51.5), cleared after a file is read and
 * before anything is profiled, each with a note in the parse report:
 * - A placeholder number that means "no reading": the UCI air-quality file
 *   writes −200 for a missing measurement 8,530 times, so its "total" came out
 *   at −1.5 million; a bank's "days since last contact" writes 999 for never.
 *   A value of all nines or a round negative hundred that is the column's
 *   extreme, repeats, and sits far outside every other value is read as
 *   blank; a round negative hundred only when no other value is negative or
 *   it lies over twice their whole range away (repeated −900 payments in a
 *   ledger are amounts).
 * - Subtotal and total rows: a budget statement's "Saldo aus 1.1 und 1.2" and
 *   "Summe aus 1.3 und 1.6" are sums of rows above, so a total counted them
 *   twice. A row is left out only when its label says total (total, subtotal,
 *   Summe, Saldo, insgesamt…) and at least half of its numbers equal the sums
 *   of the rows above it, either the block since the last total or all of
 *   them.
 * - Notes at the end of the file: Lending Club's export ends with "Total
 *   amount funded in policy code 1: 46029615", which was counted as a loan. A
 *   last row (up to MAX_FOOTER of them) whose only filled cell is a sentence,
 *   in a table of at least four columns, is left out.
 */
import { unreadableAt, type Column, type Dataset, type ParseReport } from "@/engine/core/types";
import { formatPlain } from "@/engine/core/format";

/** A placeholder repeats at least this often (and at least MIN_PLACEHOLDER times). */
const PLACEHOLDER_SHARE = 0.005;
const MIN_PLACEHOLDER = 5;
/** All nines (−99, 999, 9999), or a round negative hundred (−100, −200, −1000). */
const PLACEHOLDER_TEXT = /^-?9{2,}(?:\.9+)?$|^-[1-9]00+$/;
/** A label that says the row totals others, in the languages Loupe reads. */
const TOTAL_LABEL =
  /(?:^|[^\p{L}])(?:sub-?\s?totals?|totals?|grand total|sum|totale|somme|suma|soma|totaal|subtotaal|insgesamt|saldo)(?:[^\p{L}]|$)|summe(?:[^\p{L}]|$)/iu;

/** Notes at the end of a file: at most this many rows. */
const MAX_FOOTER = 5;

const fmt = (n: number) => formatPlain(n, 0, "INTL");
/** A label shortened for a note: long statement lines would fill the screen. */
const clip = (s: string) => (s.length > 48 ? `${s.slice(0, 47).trimEnd()}…` : s);

/** The dataset and report with placeholders blanked and subtotal rows left out; unchanged when there are none. */
export function withoutTraps(
  dataset: Dataset,
  report: ParseReport,
): { dataset: Dataset; report: ParseReport } {
  const notes = [...report.columnNotes];
  let columns = dataset.columns.map((c) => {
    if (c.kind !== "number") return c;
    const hit = placeholderOf(c.values);
    if (!hit) return c;
    const values = c.values.map((x) => (x === hit.value ? NaN : x));
    const shown = hit.value < 0 ? `−${fmt(-hit.value)}` : fmt(hit.value);
    notes.push({
      column: c.name,
      invalidCount: hit.count,
      examples: [String(hit.value)],
      note: `${shown} appears ${fmt(hit.count)} times, far ${hit.value < 0 ? "below" : "above"} every other value: it marks a missing value, so it is read as blank.`,
    });
    return { ...c, values };
  });
  const totals = totalRows({ ...dataset, columns });
  const footer = footerRows({ ...dataset, columns });
  const warnings = [...report.warnings];
  let rowCount = dataset.rowCount;
  if (footer.rows.length) {
    const n = footer.rows.length;
    warnings.push(
      `Left out ${n === 1 ? "a note" : `${n} notes`} at the end of the file (“${clip(footer.labels[0] as string)}”): ${n === 1 ? "it is" : "they are"} not a row of data.`,
    );
  }
  if (totals.rows.length || footer.rows.length) {
    const drop = new Set([...totals.rows, ...footer.rows]);
    const keep = Int32Array.from({ length: rowCount }, (_, i) => i).filter((i) => !drop.has(i));
    columns = columns.map((c) => compact(c, keep));
    rowCount = keep.length;
    const n = totals.rows.length;
    if (n)
      warnings.push(
        `Left out ${n === 1 ? "1 total row" : `${fmt(n)} subtotal and total rows`} (${totals.labels
          .slice(0, 2)
          .map((l) => `“${clip(l)}”`)
          .join(
            ", ",
          )}${n > 2 ? ", …" : ""}): each is the sum of rows above it, so counting it would count those rows twice.`,
      );
  }
  if (columns.every((c, j) => c === dataset.columns[j]) && rowCount === dataset.rowCount)
    return { dataset, report };
  return {
    dataset: { ...dataset, columns, rowCount },
    report: { ...report, columnNotes: notes, warnings, rowCount },
  };
}

/** The placeholder of a number column (see the header), or null. */
function placeholderOf(values: Float64Array): { value: number; count: number } | null {
  let n = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of values) {
    if (x !== x) continue;
    n++;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  if (n < 20) return null;
  for (const v of [lo, hi]) {
    if (!PLACEHOLDER_TEXT.test(String(v))) continue;
    let count = 0;
    let restLo = Infinity;
    let restHi = -Infinity;
    for (const x of values) {
      if (x !== x) continue;
      if (x === v) count++;
      else {
        if (x < restLo) restLo = x;
        if (x > restHi) restHi = x;
      }
    }
    if (count < MIN_PLACEHOLDER || count / n < PLACEHOLDER_SHARE || restLo > restHi) continue;
    // Far outside the rest: the gap to the nearest other value is over a quarter of their whole range. A
    // round negative hundred must also be the column's only negative, or lie over twice that range away:
    // a ledger's repeated −900 payments are amounts, a sensor's −200 among readings of 0–12 is not.
    const gap = v === lo ? restLo - v : v - restHi;
    const range = Math.max(restHi - restLo, 1e-9);
    const nines = /^-?9+(?:\.9+)?$/.test(String(v));
    if (gap > 0.25 * range && (nines || restLo >= 0 || gap > 2 * range)) return { value: v, count };
  }
  return null;
}

/** Rows that total others (see the header), in file order, with their labels. */
function totalRows(ds: Dataset): { rows: number[]; labels: string[] } {
  const numbers = ds.columns.filter((c) => c.kind === "number");
  const texts = ds.columns.filter((c) => c.kind === "string");
  const rows: number[] = [];
  const labels: string[] = [];
  if (!numbers.length || !texts.length || ds.rowCount < 3) return { rows, labels };
  const block = new Float64Array(numbers.length);
  const all = new Float64Array(numbers.length);
  let blockRows = 0;
  let allRows = 0;
  const near = (v: number, sum: number) => Math.abs(v - sum) <= 1e-6 * Math.max(1, Math.abs(sum)) + 0.0051;
  // At least half of the row's numbers must equal the sums, and one of them be more than nothing: a
  // published statement's own arithmetic is sometimes off in a column (Ettlingen's 2024 "Saldo").
  const sums = (s: Float64Array, r: number) => {
    let matched = 0;
    let compared = 0;
    for (let k = 0; k < numbers.length; k++) {
      const v = (numbers[k] as Extract<Column, { kind: "number" }>).values[r] as number;
      if (v !== v) continue;
      compared++;
      if (near(v, s[k] as number) && s[k] !== 0) matched++;
    }
    return matched > 0 && matched * 2 >= compared;
  };
  for (let r = 0; r < ds.rowCount; r++) {
    const label = labelAt(texts, r);
    if (label && ((blockRows >= 2 && sums(block, r)) || (allRows >= 2 && sums(all, r)))) {
      rows.push(r);
      labels.push(label);
      block.fill(0);
      blockRows = 0;
      continue;
    }
    for (let k = 0; k < numbers.length; k++) {
      const v = (numbers[k] as Extract<Column, { kind: "number" }>).values[r] as number;
      if (v !== v) continue;
      block[k] = (block[k] as number) + v;
      all[k] = (all[k] as number) + v;
    }
    blockRows++;
    allRows++;
  }
  return { rows, labels };
}

/** The last rows of the file that are notes, not data (see the header), with their text. */
function footerRows(ds: Dataset): { rows: number[]; labels: string[] } {
  const rows: number[] = [];
  const labels: string[] = [];
  if (ds.columns.length < 4) return { rows, labels };
  for (let r = ds.rowCount - 1; r >= Math.max(1, ds.rowCount - MAX_FOOTER); r--) {
    const filled: string[] = [];
    for (const c of ds.columns) {
      const text = unreadableAt(c.unreadable, r);
      if (text !== undefined) filled.push(text);
      else if (c.kind === "string") {
        const code = c.codes[r] as number;
        if (code >= 0) filled.push(c.dict[code] as string);
      } else if (c.kind === "boolean" ? c.values[r] !== -1 : c.values[r] === c.values[r]) filled.push("");
      if (filled.length > 1) break;
    }
    // One filled cell holding a sentence ("Total amount funded in policy code 1: 46029615", "Source: Eurostat").
    const note = filled.length === 1 ? (filled[0] as string).trim() : "";
    if (!/\p{L}/u.test(note) || note.split(/\s+/).length < 2) break;
    rows.push(r);
    labels.unshift(note);
  }
  return { rows, labels };
}

/** The first text cell of row `r` whose words say it totals others. */
function labelAt(texts: readonly Column[], r: number): string | null {
  for (const c of texts) {
    if (c.kind !== "string") continue;
    const code = c.codes[r] as number;
    const s = code >= 0 ? (c.dict[code] as string) : "";
    if (s && TOTAL_LABEL.test(s)) return s;
  }
  return null;
}

/** `c` with only the rows in `keep`; a text column keeps only the values still used. */
function compact(c: Column, keep: Int32Array): Column {
  const unreadable = c.unreadable && remapUnreadable(c.unreadable, keep);
  const base = { ...c, unreadable };
  if (!unreadable) delete base.unreadable;
  switch (c.kind) {
    case "number":
    case "date":
      return {
        ...base,
        kind: c.kind,
        values: Float64Array.from(keep, (i) => c.values[i] as number),
      } as Column;
    case "boolean":
      return {
        ...base,
        kind: "boolean",
        values: Int8Array.from(keep, (i) => c.values[i] as number),
      } as Column;
    case "string": {
      const remap = new Map<number, number>();
      const dict: string[] = [];
      const codes = Int32Array.from(keep, (i) => {
        const code = c.codes[i] as number;
        if (code < 0) return -1;
        let next = remap.get(code);
        if (next === undefined) {
          next = dict.length;
          dict.push(c.dict[code] as string);
          remap.set(code, next);
        }
        return next;
      });
      return { ...base, kind: "string", codes, dict } as Column;
    }
  }
}

/** Unreadable cells of the kept rows, renumbered; undefined when none is left. */
function remapUnreadable(u: NonNullable<Column["unreadable"]>, keep: Int32Array) {
  const index = new Map<number, number>();
  keep.forEach((row, i) => index.set(row, i));
  const rows: number[] = [];
  const codes: number[] = [];
  u.rows.forEach((row, i) => {
    const at = index.get(row);
    if (at === undefined) return;
    rows.push(at);
    codes.push(u.codes[i] as number);
  });
  return rows.length
    ? { rows: Int32Array.from(rows), codes: Int32Array.from(codes), texts: u.texts }
    : undefined;
}
