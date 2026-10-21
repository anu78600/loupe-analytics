/**
 * A workbook read as a small data model: one main (fact) sheet with lookup
 * sheets joined onto it by their keys (parse/relate.ts finds the keys and
 * builds the joined table). This module holds only the description of what
 * was joined and the words that say so, with no parser imports, so the UI,
 * the parse report and the exports can all name the join the same way.
 */

/** One lookup sheet joined onto the analysed table. */
export interface SheetJoin {
  /** The lookup sheet. */
  sheet: string;
  /** The sheet it hangs off: the main sheet, or (one level more, a snowflake) another lookup. */
  onto: string;
  /** The key column in `onto`, named as in that sheet. */
  key: string;
  /** The matching column in `sheet` (unique and never blank there), named as in that sheet. */
  lookupKey: string;
  /** Columns this join added to the analysed table, by their names there. */
  columns: string[];
  /** Rows of the analysed table whose key isn't in `sheet` (blank keys not counted); their added columns are blank. */
  unmatched: number;
  /** Rows of the analysed table that had a key to look up. */
  keyed: number;
}

/** A workbook analysed as one table: the main sheet with its lookup sheets joined on. */
export interface WorkbookModel {
  /** The main sheet: every one of its rows is kept exactly once. */
  fact: string;
  /** Lookup sheets in the order they were joined (direct lookups first, then their own lookups). */
  joins: SheetJoin[];
  /** Sheets that weren't joined, with the reason, in workbook order. */
  left: Array<{ sheet: string; reason: string }>;
}

/** "A", "A and B", "A, B and C". */
function series(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Customer ID", or "Customer ID = ID" when the lookup names its key differently. */
function keyText(j: SheetJoin): string {
  return j.key.toLowerCase() === j.lookupKey.toLowerCase() ? j.key : `${j.key} = ${j.lookupKey}`;
}

/**
 * What was joined, in one clause: "Orders joined with Customers (on Customer
 * ID) and Products (on Product ID)", with "; Products with Categories (on
 * Category ID)" for a lookup's own lookups.
 */
export function describeModel(model: WorkbookModel): string {
  const groups = new Map<string, SheetJoin[]>();
  for (const j of model.joins) groups.set(j.onto, [...(groups.get(j.onto) ?? []), j]);
  return [...groups]
    .map(
      ([onto, joins]) =>
        `${onto} ${onto === model.fact ? "joined with" : "with"} ${series(joins.map((j) => `${j.sheet} (on ${keyText(j)})`))}`,
    )
    .join("; ");
}

/** Sheets in the analysed table: the main sheet and every joined lookup. */
export function modelSheetCount(model: WorkbookModel): number {
  return model.joins.length + 1;
}

/** Short label beside the file name: "Orders + 2 sheets". */
export function modelLabel(model: WorkbookModel): string {
  const n = model.joins.length;
  return `${model.fact} + ${n} ${n === 1 ? "sheet" : "sheets"}`;
}

/**
 * One sentence per join with keys it couldn't find, for the parse report:
 * "12 rows have a Customer ID that isn't in Customers; their Customers
 * columns are blank." Counts are written en-US like the parser's other notes.
 */
export function unmatchedNotes(model: WorkbookModel): string[] {
  return model.joins
    .filter((j) => j.unmatched > 0)
    .map((j) => {
      const one = j.unmatched === 1;
      return `${j.unmatched.toLocaleString("en-US")} ${one ? "row has" : "rows have"} a ${j.key} that isn't in ${j.sheet}; ${one ? "its" : "their"} ${j.sheet} columns are blank.`;
    });
}
