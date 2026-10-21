/**
 * Workbooks laid out as a small data model (an Orders sheet with Customers,
 * Products and Stores sheets beside it) read as one table: this module finds
 * the keys between sheets (relateSheets) and left-joins the lookup sheets
 * onto the main one (joinSheets). parse/index.ts reads the sheets and calls
 * both; when nothing relates, the workbook goes to the sheet picker as before.
 *
 * The rules are an analyst's, and deliberately strict, because a wrong join
 * silently changes every total:
 * - A lookup's key is a column whose values are unique and never blank.
 * - It matches a column of the sheet it joins onto by name, read as words
 *   (profile/names.ts tokenize: "Customer ID" = "CustomerID" = "cust_id"),
 *   or as a bare "ID"/"Code"/"Key" named after its sheet (Customers.ID =
 *   Customer ID), and by values: at least 90% of the non-blank keys must be
 *   found in the lookup.
 * - A key that repeats (many-to-many), has blanks or matches less is never
 *   joined, and the reason is reported. So are sheets with the same columns
 *   (more rows of one table, not a lookup) and keys that are only row
 *   numbers ("ID" on both sides).
 * - Lookups of lookups are joined too (Products → Categories), one level
 *   deep.
 *
 * The join keeps every row of the main sheet exactly once, in order, and its
 * columns as they are (the same column objects); each lookup adds its other
 * columns, blank where a key isn't found. Gathering works on the typed arrays
 * and dictionary codes, like the rest of the engine.
 */
import type {
  Column,
  ColumnParseNote,
  Dataset,
  DateFormatDecision,
  ParseReport,
  StringColumn,
  UnreadableCells,
} from "@/engine/core/types";
import {
  describeModel,
  modelSheetCount,
  unmatchedNotes,
  type SheetJoin,
  type WorkbookModel,
} from "@/engine/core/model";
import { tokenize } from "@/engine/profile/names";
import { uniqueName } from "./builder";
import { newDatasetId } from "./csv";

/** Share of the non-blank keys that must be found in a lookup before it is joined. */
export const MIN_KEY_COVERAGE = 0.9;

/** Levels of lookups below the main sheet: its lookups, then their lookups (a snowflake). */
const MAX_DEPTH = 2;

/** Words that make a key name generic: alone they name a row number, not a thing. */
const GENERIC_KEY_WORDS = new Set([
  "id",
  "key",
  "code",
  "number",
  "no",
  "row",
  "line",
  "index",
  "serial",
  "sr",
  "sl",
  "record",
  "entry",
  "#",
]);

/** Bare key names a lookup may give its key when the sheet names the thing (Customers.ID). */
const BARE_KEYS = new Set(["id", "key", "code", "number", "no", "name"]);

/** Words in a sheet name that don't name its entity ("Customer list", "Product master"). */
const SHEET_NOISE = new Set([
  "list",
  "master",
  "data",
  "table",
  "lookup",
  "dim",
  "dimension",
  "detail",
  "info",
  "ref",
  "reference",
  "sheet",
]);

/** One sheet as read by the workbook parser. */
export interface SheetTable {
  sheet: string;
  ds: Dataset;
}

/** A join relateSheets() found: which lookup, on which key, and the lookup row for every main-sheet row. */
export interface PlannedJoin {
  sheet: string;
  onto: string;
  /** Key column in `onto`, as named there. */
  key: string;
  /** Key column in `sheet`, as named there. */
  lookupKey: string;
  depth: number;
  /** Lookup row for each row of the main sheet; -1 for a blank or unmatched key. */
  rows: Int32Array;
  keyed: number;
  unmatched: number;
}

/** The relationships found in a workbook: the main sheet, its joins and the sheets left out with why. */
export interface ModelPlan {
  fact: string;
  joins: PlannedJoin[];
  left: Array<{ sheet: string; reason: string }>;
}

/** A column's value as a join key, row by row: trimmed text or a whole number as written; null when blank. */
type KeyReader = (row: number) => string | null;

/** Number of rows, written for a sentence. */
const rowsText = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "row" : "rows"}`;

/**
 * A key reader for a column that can hold keys: text, or whole numbers that
 * aren't money or a percentage. Dates and yes/no columns are never keys.
 */
function keyReader(col: Column): KeyReader | null {
  if (col.kind === "string") {
    const keys = col.dict.map((s) => {
      const t = s.trim();
      return t === "" ? null : t;
    });
    const codes = col.codes;
    return (r) => {
      const c = codes[r] as number;
      return c < 0 ? null : (keys[c] ?? null);
    };
  }
  if (col.kind === "number" && col.format.integer && !col.format.currency && !col.format.percent) {
    const values = col.values;
    return (r) => {
      const v = values[r] as number;
      return v !== v ? null : String(v);
    };
  }
  return null;
}

/** A column that may hold keys pointing at a lookup, in a sheet joined (or to be joined) onto the main one. */
interface ParentColumn {
  sheet: string;
  name: string;
  tokens: string;
  /** Reads the key on each row of the main sheet. */
  read: KeyReader;
}

/** A sheet's key-capable columns, read on the main sheet's rows through `via` (main row → sheet row). */
function parentColumns(t: SheetTable, via?: Int32Array, skip?: string): ParentColumn[] {
  const out: ParentColumn[] = [];
  for (const col of t.ds.columns) {
    if (col.name === skip) continue;
    const base = keyReader(col);
    if (!base) continue;
    const tokens = tokenize(col.name);
    // A bare "ID" or "Row #" names a row number, not the thing a lookup describes.
    if (!tokens.some((w) => !GENERIC_KEY_WORDS.has(w))) continue;
    const read: KeyReader = via
      ? (r) => {
          const m = via[r] as number;
          return m < 0 ? null : base(m);
        }
      : base;
    out.push({ sheet: t.sheet, name: col.name, tokens: tokens.join(" "), read });
  }
  return out;
}

/** The words a sheet name gives its entity: "Customer list" → "customer". */
function sheetWords(sheet: string): string[] {
  const words = tokenize(sheet);
  const kept = words.filter((w) => !SHEET_NOISE.has(w));
  return kept.length ? kept : words;
}

/** Whether a lookup column's name matches a parent key: the same words, or a bare "ID" named by its sheet. */
function namesMatch(parent: ParentColumn, lookupTokens: string[], sheet: string): boolean {
  const own = lookupTokens.join(" ");
  if (own === parent.tokens) return true;
  if (lookupTokens.length !== 1 || !BARE_KEYS.has(lookupTokens[0] as string)) return false;
  return [...sheetWords(sheet), ...lookupTokens].join(" ") === parent.tokens;
}

/** Whether a key's name says it is one ("Customer ID", "SKU code"), preferred over a match on a plain attribute. */
const keyLike = (tokens: string) => tokens.split(" ").some((w) => GENERIC_KEY_WORDS.has(w) || w === "sku");

/** A lookup column checked as a key: its row per key, or why it can't be one. */
type LookupKey = { index: Map<string, number> } | { problem: string };

function lookupKey(t: SheetTable, col: Column, read: KeyReader): LookupKey {
  const index = new Map<string, number>();
  let blanks = 0;
  let repeated: string | null = null;
  for (let r = 0; r < t.ds.rowCount; r++) {
    const k = read(r);
    if (k === null) blanks++;
    else if (!index.has(k)) index.set(k, r);
    else repeated ??= k;
  }
  if (blanks)
    return {
      problem: `${col.name} is blank on ${rowsText(blanks)} of ${t.sheet}, so its rows can't all be matched`,
    };
  if (repeated !== null) {
    let times = 0;
    for (let r = 0; r < t.ds.rowCount; r++) if (read(r) === repeated) times++;
    return {
      problem: `${col.name} isn't unique in ${t.sheet} ("${repeated}" is on ${rowsText(times)}), so joining would repeat rows`,
    };
  }
  return { index };
}

/** Outcome of trying one lookup against the columns of one sheet. */
type Attempt =
  | { ok: true; join: Omit<PlannedJoin, "depth">; coverage: number; keyish: boolean }
  | { ok: false; reason: string; keyish: boolean };

/**
 * Lookup `t` against `parents` (the key-capable columns of one sheet, read
 * on the main sheet's rows): the best key pair that passes every rule, else
 * the reason the most key-like name-match failed; null when no name matches.
 */
function attempt(
  t: SheetTable,
  parents: ParentColumn[],
  parentSheet: SheetTable,
  rowCount: number,
): Attempt | null {
  const lookupCols = t.ds.columns.map((col) => ({ col, tokens: tokenize(col.name) }));
  // More rows of the same table (one sheet per month, say) share their columns; that is no lookup.
  const parentNames = new Set(parentSheet.ds.columns.map((c) => tokenize(c.name).join(" ")));
  const shared = lookupCols.filter((c) => parentNames.has(c.tokens.join(" "))).length;
  const sameLayout = shared >= 2 && shared / lookupCols.length >= 0.8;
  let best: Attempt | null = null;
  const better = (a: Attempt) => {
    if (!best) return true;
    if (a.ok !== best.ok) return a.ok;
    if (a.keyish !== best.keyish) return a.keyish;
    return a.ok && best.ok ? a.coverage > best.coverage : false;
  };
  const keys = new Map<Column, LookupKey>();
  for (const p of parents)
    for (const { col, tokens } of lookupCols) {
      if (!namesMatch(p, tokens, t.sheet)) continue;
      const read = keyReader(col);
      if (!read) continue;
      const keyish = keyLike(p.tokens);
      if (sameLayout) {
        const a: Attempt = {
          ok: false,
          keyish,
          reason: `it has the same columns as ${parentSheet.sheet}, so it reads as more rows of one table, not a lookup`,
        };
        if (better(a)) best = a;
        continue;
      }
      let key = keys.get(col);
      if (!key) {
        key = lookupKey(t, col, read);
        keys.set(col, key);
      }
      if ("problem" in key) {
        const a: Attempt = { ok: false, keyish, reason: key.problem };
        if (better(a)) best = a;
        continue;
      }
      const rows = new Int32Array(rowCount).fill(-1);
      let keyed = 0;
      let unmatched = 0;
      for (let r = 0; r < rowCount; r++) {
        const k = p.read(r);
        if (k === null) continue;
        keyed++;
        const m = key.index.get(k);
        if (m === undefined) unmatched++;
        else rows[r] = m;
      }
      const coverage = keyed ? (keyed - unmatched) / keyed : 0;
      const a: Attempt =
        keyed && coverage >= MIN_KEY_COVERAGE
          ? {
              ok: true,
              keyish,
              coverage,
              join: {
                sheet: t.sheet,
                onto: p.sheet,
                key: p.name,
                lookupKey: col.name,
                rows,
                keyed,
                unmatched,
              },
            }
          : {
              ok: false,
              keyish,
              reason: keyed
                ? `only ${Math.floor(coverage * 100)}% of the ${p.name} values in ${p.sheet} are in it (${Math.round(MIN_KEY_COVERAGE * 100)}% needed)`
                : `${p.name} is blank on every row of ${p.sheet}`,
            };
      if (better(a)) best = a;
    }
  return best;
}

/** A sheet that can be the main one: it has a calendar date and a measure (a number that isn't a key). */
function factLike(ds: Dataset): boolean {
  const date = ds.columns.some((c) => c.kind === "date" && !c.timeOnly);
  const measure = ds.columns.some(
    (c) => c.kind === "number" && !tokenize(c.name).some((w) => GENERIC_KEY_WORDS.has(w) || w === "year"),
  );
  return date && measure;
}

/** The joins with `fact` as the main sheet, level by level, and why each other sheet stayed out. */
function planFor(fact: SheetTable, tables: SheetTable[]): ModelPlan {
  const rowCount = fact.ds.rowCount;
  const joins: PlannedJoin[] = [];
  const refusals = new Map<string, string>();
  const joined = new Set([fact.sheet]);
  // Sheets at the current level, each with its rows on the main sheet (none for the main sheet).
  let level: Array<{ t: SheetTable; via?: Int32Array; skip?: string }> = [{ t: fact }];
  for (let depth = 1; depth <= MAX_DEPTH + 1 && level.length; depth++) {
    const next: typeof level = [];
    for (const { t: parent, via, skip } of level) {
      const parents = parentColumns(parent, via, skip);
      if (!parents.length) continue;
      for (const t of tables) {
        if (joined.has(t.sheet)) continue;
        const a = attempt(t, parents, parent, rowCount);
        if (!a) continue;
        if (!a.ok) {
          if (!refusals.has(t.sheet)) refusals.set(t.sheet, a.reason);
          continue;
        }
        if (depth > MAX_DEPTH) {
          // Found, but one level too deep: that says more than any earlier near-miss.
          refusals.set(
            t.sheet,
            `it links to ${parent.sheet}, which is already two steps from ${fact.sheet}; Loupe joins lookups at most two steps away`,
          );
          continue;
        }
        joined.add(t.sheet);
        joins.push({ ...a.join, depth });
        next.push({ t, via: a.join.rows, skip: a.join.lookupKey });
      }
    }
    level = next;
  }
  const left = tables
    .filter((t) => !joined.has(t.sheet))
    .map((t) => ({
      sheet: t.sheet,
      reason:
        refusals.get(t.sheet) ?? `no column matches one in ${fact.sheet} or its lookups, by name and values`,
    }));
  return { fact: fact.sheet, joins, left };
}

/**
 * Finds how a workbook's sheets relate. Every sheet is tried as the main one;
 * the one that reaches the most lookups wins, then one with a date and a
 * measure, then the one with the most rows. Returns null when no sheet joins
 * onto another, so the workbook goes to the sheet picker as before.
 */
export function relateSheets(tables: SheetTable[]): ModelPlan | null {
  if (tables.length < 2) return null;
  let best: { plan: ModelPlan; fact: boolean; rows: number } | null = null;
  for (const t of tables) {
    const plan = planFor(t, tables);
    if (!plan.joins.length) continue;
    const cand = { plan, fact: factLike(t.ds), rows: t.ds.rowCount };
    if (
      !best ||
      cand.plan.joins.length > best.plan.joins.length ||
      (cand.plan.joins.length === best.plan.joins.length &&
        (cand.fact !== best.fact ? cand.fact : cand.rows > best.rows))
    )
      best = cand;
  }
  return best?.plan ?? null;
}

/** Unreadable cells of a lookup column on the joined rows: each joined row takes its lookup row's cell. */
function gatherUnreadable(u: UnreadableCells | undefined, rows: Int32Array): UnreadableCells | undefined {
  if (!u || !u.rows.length) return undefined;
  const at = new Map<number, number>();
  for (let i = 0; i < u.rows.length; i++) at.set(u.rows[i] as number, u.codes[i] as number);
  const outRows: number[] = [];
  const outCodes: number[] = [];
  for (let r = 0; r < rows.length; r++) {
    const code = at.get(rows[r] as number);
    if (code === undefined) continue;
    outRows.push(r);
    outCodes.push(code);
  }
  return outRows.length
    ? { rows: Int32Array.from(outRows), codes: Int32Array.from(outCodes), texts: u.texts }
    : undefined;
}

/**
 * A lookup column on the joined rows: row r takes lookup row `rows[r]`, blank
 * when -1. Text keeps only the values that appear, in first-seen order, so
 * the dictionary stays the column's distinct values.
 */
function gather(col: Column, rows: Int32Array, name: string): Column {
  const n = rows.length;
  const unreadable = gatherUnreadable(col.unreadable, rows);
  const extra = unreadable ? { unreadable } : {};
  switch (col.kind) {
    case "number":
    case "date": {
      const values = new Float64Array(n);
      for (let r = 0; r < n; r++) {
        const m = rows[r] as number;
        values[r] = m < 0 ? NaN : (col.values[m] as number);
      }
      return col.kind === "number"
        ? { kind: "number", name, values, format: col.format, ...extra }
        : {
            kind: "date",
            name,
            values,
            hasTime: col.hasTime,
            format: col.format,
            ...(col.timeOnly ? { timeOnly: true } : {}),
            ...extra,
          };
    }
    case "boolean": {
      const values = new Int8Array(n);
      for (let r = 0; r < n; r++) {
        const m = rows[r] as number;
        values[r] = m < 0 ? -1 : (col.values[m] as number);
      }
      return {
        kind: "boolean",
        name,
        values,
        trueLabel: col.trueLabel,
        falseLabel: col.falseLabel,
        ...extra,
      };
    }
    case "string": {
      const remap = new Int32Array(col.dict.length).fill(-1);
      const dict: string[] = [];
      const codes = new Int32Array(n);
      for (let r = 0; r < n; r++) {
        const m = rows[r] as number;
        const c = m < 0 ? -1 : (col.codes[m] as number);
        if (c < 0) {
          codes[r] = -1;
          continue;
        }
        if (remap[c] === -1) {
          remap[c] = dict.length;
          dict.push(col.dict[c] as string);
        }
        codes[r] = remap[c] as number;
      }
      const out: StringColumn = { kind: "string", name, codes, dict, ...extra };
      return out;
    }
  }
}

/**
 * Left-joins the planned lookups onto the main sheet. The main sheet's rows
 * and columns are kept as they are; each lookup adds its columns but its key,
 * named as in its sheet, or "Customers · Segment" when the name is taken.
 * `renames` maps each added column back to its sheet and original name.
 */
export function joinSheets(
  tables: SheetTable[],
  plan: ModelPlan,
): { dataset: Dataset; model: WorkbookModel; renames: Map<string, { sheet: string; column: string }> } {
  const bySheet = new Map(tables.map((t) => [t.sheet, t]));
  const fact = bySheet.get(plan.fact);
  if (!fact) throw new Error(`Sheet "${plan.fact}" wasn't read.`);
  const columns: Column[] = [...fact.ds.columns];
  const used = new Set(columns.map((c) => c.name.toLowerCase()));
  const renames = new Map<string, { sheet: string; column: string }>();
  // Where each sheet's columns landed, so a lookup of a lookup names its key as the joined table does.
  const joins: SheetJoin[] = [];
  for (const j of plan.joins) {
    const t = bySheet.get(j.sheet);
    if (!t) continue;
    const added: string[] = [];
    for (const col of t.ds.columns) {
      if (col.name === j.lookupKey) continue;
      const name = uniqueName(used.has(col.name.toLowerCase()) ? `${t.sheet} · ${col.name}` : col.name, used);
      columns.push(gather(col, j.rows, name));
      renames.set(name, { sheet: t.sheet, column: col.name });
      added.push(name);
    }
    joins.push({
      sheet: j.sheet,
      onto: j.onto,
      key: j.key,
      lookupKey: j.lookupKey,
      columns: added,
      unmatched: j.unmatched,
      keyed: j.keyed,
    });
  }
  const model: WorkbookModel = { fact: plan.fact, joins, left: plan.left };
  return {
    dataset: {
      id: newDatasetId(),
      name: fact.ds.name,
      rowCount: fact.ds.rowCount,
      columns,
      source: { ...fact.ds.source, sheet: plan.fact, model },
    },
    model,
    renames,
  };
}

/** The parser's own "Read sheet …" line, replaced by the join summary. */
const READ_SHEET = /^Read sheet "/;

/**
 * The parse report of the joined table: the main sheet's report, with the
 * join said first (what joined on which key, rows whose key wasn't found,
 * sheets left out and why), then each lookup's own notes under its new
 * column names. A lookup column's unreadable cells are counted on the joined
 * rows, as the data check shows them.
 */
export function modelReport(
  dataset: Dataset,
  model: WorkbookModel,
  renames: Map<string, { sheet: string; column: string }>,
  reports: Map<string, ParseReport>,
  durationMs: number,
): ParseReport {
  const factReport = reports.get(model.fact);
  if (!factReport) throw new Error(`Sheet "${model.fact}" wasn't read.`);
  // Each lookup column's new name, by sheet and original name.
  const newName = new Map<string, string>();
  for (const [name, from] of renames) newName.set(`${from.sheet}\u0000${from.column}`, name);
  const dateFormats: DateFormatDecision[] = [...factReport.dateFormats];
  const columnNotes: ColumnParseNote[] = [...factReport.columnNotes];
  const lookupWarnings: string[] = [];
  for (const j of model.joins) {
    const r = reports.get(j.sheet);
    if (!r) continue;
    const named = (column: string) => newName.get(`${j.sheet}\u0000${column}`);
    for (const d of r.dateFormats) {
      const name = named(d.column);
      if (name) dateFormats.push({ ...d, column: name });
    }
    for (const note of r.columnNotes) {
      const name = named(note.column);
      // Counts of unreadable cells were of the lookup's rows; they are recounted below on the joined rows.
      if (name && note.invalidCount === 0) columnNotes.push({ ...note, column: name });
    }
    for (const w of r.warnings) if (!READ_SHEET.test(w)) lookupWarnings.push(`${j.sheet}: ${w}`);
  }
  for (const col of dataset.columns) {
    const u = col.unreadable;
    if (!renames.has(col.name) || !u?.rows.length) continue;
    const count = u.rows.length;
    columnNotes.push({
      column: col.name,
      invalidCount: count,
      examples: [...new Set(Array.from(u.codes.subarray(0, 50), (c) => u.texts[c] as string))].slice(0, 3),
      note: `${count.toLocaleString("en-US")} ${count === 1 ? "value" : "values"} couldn't be read and ${count === 1 ? "was" : "were"} treated as blank.`,
    });
  }
  const sheets = modelSheetCount(model);
  return {
    ...factReport,
    rowCount: dataset.rowCount,
    columnCount: dataset.columns.length,
    sheet: model.fact,
    dateFormats,
    columnNotes,
    warnings: [
      `Joined ${describeModel(model)}: ${sheets} sheets, ${rowsText(dataset.rowCount)}. Every ${model.fact} row is kept once.`,
      ...unmatchedNotes(model),
      ...model.left.map((l) => `Not joined: ${l.sheet}, because ${l.reason}.`),
      ...factReport.warnings.filter((w) => !READ_SHEET.test(w)),
      ...lookupWarnings,
    ],
    durationMs,
  };
}
