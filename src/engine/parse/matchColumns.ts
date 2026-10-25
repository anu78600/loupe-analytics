/**
 * Next month's file read with this month's column names (version 55.0). A
 * dashboard refreshed with a new file (ui/workspace/projects) passes the
 * columns it was built on as IngestOptions.matchColumns; Session.ingest
 * compares them with the new file's (compareColumns) and reads a column that
 * was only renamed under its saved name (withColumnNames), so every chart,
 * KPI, filter and setting that names it carries over as it was. What changed
 * travels in ParseReport.matched, for the refresh report.
 *
 * A rename is taken only when it is unambiguous: the same type, and one
 * saved column and one new column that match each other and nothing else,
 * tried from the surest test to the loosest. The same spelling apart from
 * case, spaces and punctuation ("Order_Date", "order date"); the same words
 * once read (names.ts: "Amt" and "Amount", "Qty" and "Quantity"); or a close
 * spelling (Jaro-Winkler 0.9 or more, "Custmer" and "Customer"). A column is
 * never matched by its place alone: "Channel" where "Segment" used to be is
 * another column, and reading it as Segment would show wrong figures under a
 * known name. For the same reason two names that name different periods
 * ("Sales 2024", "Sales 2025"; "Jan Target", "Jun Target") never match.
 * Anything else is reported as missing or new.
 */
import type {
  Column,
  ColumnChanges,
  Dataset,
  ParseReport,
  RenameHow,
  SavedColumn,
} from "@/engine/core/types";
import { jaroWinkler, tokenize } from "@/engine/profile/names";

/** The same spelling apart from case, spaces and punctuation. */
const spelling = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
/** The same words once read (canonical tokens, in any order). */
const words = (name: string) => [...new Set(tokenize(name))].sort().join(" ");
/** The numbers, months and quarters a name holds: two names that differ in them are different columns. */
const period = (name: string) =>
  (
    name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .match(
        /\d+|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|q[1-4])\b/g,
      ) ?? []
  ).join(" ");
/** Whether a saved column and a new one may be the same column at all. */
const compatible = (a: SavedColumn, b: SavedColumn) => a.type === b.type && period(a.name) === period(b.name);

/** Compares the saved columns with a new file's, and finds the renamed ones. */
export function compareColumns(
  saved: readonly SavedColumn[],
  current: readonly SavedColumn[],
): ColumnChanges {
  const now = new Map(current.map((c) => [c.name, c]));
  const savedNames = new Set(saved.map((c) => c.name));
  const retyped: ColumnChanges["retyped"] = [];
  let same = 0;
  let lost: SavedColumn[] = [];
  for (const s of saved) {
    const c = now.get(s.name);
    if (!c) lost.push(s);
    else if (c.type === s.type) same++;
    else retyped.push({ name: s.name, was: s.type, now: c.type });
  }
  let fresh = current.filter((c) => !savedNames.has(c.name));
  const renamed: ColumnChanges["renamed"] = [];
  const take = (s: SavedColumn, c: SavedColumn, how: RenameHow) => {
    renamed.push({ from: c.name, to: s.name, how });
    lost = lost.filter((x) => x !== s);
    fresh = fresh.filter((x) => x !== c);
  };

  // Exact tests: a pair whose key matches each other's and no other column's of that type.
  for (const [how, key] of [
    ["spelling", spelling],
    ["words", words],
  ] as const) {
    for (const s of [...lost]) {
      const k = key(s.name);
      if (!k) continue;
      const matches = fresh.filter((c) => compatible(s, c) && key(c.name) === k);
      const rivals = lost.filter((o) => compatible(o, s) && key(o.name) === k);
      const only = matches[0];
      if (only && matches.length === 1 && rivals.length === 1) take(s, only, how);
    }
  }

  // A close spelling: each the other's best match, at 0.9 or more, and clearly ahead of the next best.
  const score = (a: SavedColumn, b: SavedColumn) =>
    compatible(a, b) ? jaroWinkler(spelling(a.name), spelling(b.name)) : 0;
  for (const s of [...lost]) {
    const ranked = fresh.map((c) => ({ c, v: score(s, c) })).sort((a, b) => b.v - a.v);
    const best = ranked[0];
    if (!best || best.v < 0.9 || (ranked[1]?.v ?? 0) > best.v - 0.03) continue;
    const back = lost.reduce((m, o) => Math.max(m, o === s ? 0 : score(o, best.c)), 0);
    if (back < best.v) take(s, best.c, "similar");
  }

  return { renamed, missing: lost.map((x) => x.name), added: fresh.map((x) => x.name), retyped, same };
}

/** The dataset with its renamed columns under their saved names, and the report saying so. */
export function withColumnNames(
  ds: Dataset,
  report: ParseReport,
  changes: ColumnChanges,
): { ds: Dataset; report: ParseReport } {
  const to = new Map(changes.renamed.map((r) => [r.from, r.to]));
  const name = (n: string) => to.get(n) ?? n;
  return {
    ds: to.size
      ? {
          ...ds,
          columns: ds.columns.map((c) => (to.has(c.name) ? ({ ...c, name: name(c.name) } as Column) : c)),
        }
      : ds,
    report: {
      ...report,
      dateFormats: report.dateFormats.map((d) => ({ ...d, column: name(d.column) })),
      columnNotes: report.columnNotes.map((n) => ({ ...n, column: name(n.column) })),
      matched: changes,
    },
  };
}
