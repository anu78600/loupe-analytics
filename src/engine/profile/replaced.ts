/**
 * Columns that look replaced by a cleaned copy. Step 3 ("Check & map") offers
 * them as columns to hide. Data cleaned in a spreadsheet usually keeps the
 * original beside the result: Unit_Price beside Unit_Price_Clean (and the
 * Reference_Price used to correct it), order_date beside NEW_ORDER_DATE,
 * amount_raw beside amount.
 *
 * Left in, the original competes with the clean column: the field matcher
 * may pick it (an exact name beats "…_Clean"), and column KPIs and charts get
 * built from both. Nothing is hidden until the user agrees. Each suggestion
 * names the column to hide, the column that replaces it and the evidence.
 *
 * Evidence, strongest first:
 * - name: the other column is this name plus a "clean" word (clean, new,
 *   final, fixed, corrected…), or this name is the other plus a "raw" word
 *   (raw, old, original, backup…);
 * - reference: this name has a reference word (reference, ref, lookup,
 *   helper) and the rest of it is part of a cleaned column's name;
 * - identical: the same value as another column in every row.
 *
 * A name alone is not enough. The two columns must also agree on at least
 * 30% of the rows where both are filled (numbers exactly, dates by day, text
 * ignoring case and outer spaces). The one exception is a name pair where
 * the original is text and the copy is typed (text dates next to their
 * parsed copy). So "Customers" next to "New_Customers", which disagree on
 * nearly every row, is left alone.
 *
 * Each column gets at most one suggestion, and a column kept as a
 * replacement is never itself suggested. Suggestions prefer a replacement
 * that nothing else replaces: Price_Raw and Price both point at Price_Clean.
 */
import type { Column, Dataset } from "@/engine/core/types";
import type { HealthReport } from "./quality";
import type { ColumnProfile, DatasetProfile } from "./types";

export interface ReplacedColumn {
  /** The column that looks replaced: the one to hide. */
  column: string;
  /** The column that replaces it, kept for the analysis. */
  keep: string;
  evidence: "name" | "reference" | "identical";
  /** Plain-English evidence, shown with the suggestion. */
  reason: string;
}

/**
 * Words that mark the cleaned version of a column. Words that are also
 * ordinary business terms ("Standard_Cost", "Price_Std" as a deviation) are
 * left out.
 */
const CLEAN = new Set([
  "clean",
  "cleaned",
  "cleansed",
  "new",
  "final",
  "fixed",
  "corrected",
  "correct",
  "updated",
  "upd",
  "revised",
  "standardised",
  "standardized",
  "normalised",
  "normalized",
  "formatted",
  "validated",
  "verified",
  "parsed",
  "v2",
]);
/**
 * Words that mark the original a cleaned column was made from. Words that
 * are also ordinary column names ("Review_Text", "Input_Tokens",
 * "Source_Amount") are left out.
 */
const RAW = new Set([
  "raw",
  "old",
  "orig",
  "original",
  "legacy",
  "unclean",
  "uncleaned",
  "dirty",
  "messy",
  "backup",
  "bak",
  "copy",
  "prev",
  "previous",
  "temp",
  "tmp",
]);
/** Words that mark a column used only as a reference for building another. */
const REFERENCE = new Set(["reference", "ref", "lookup", "helper", "aux", "auxiliary"]);

const MIN_AGREEMENT = 0.3;
/** Fewer overlapping filled rows than this is too little to judge agreement. */
const MIN_ROWS = 10;
const DAY = 86_400_000;

/** Name words with their original spelling: camelCase and separators split, nothing expanded or folded (so "Unit_Price" keeps "Price"). */
function segments(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

const unique = (xs: string[]) => [...new Set(xs)];
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((w) => b.includes(w));
const quoted = (xs: string[]) => xs.map((x) => `"${x}"`).join(" and ");

/**
 * Share of the rows where both columns are filled on which they hold the
 * same value; null when their types can't be compared or fewer than
 * MIN_ROWS rows overlap.
 */
function agreement(a: Column, b: Column, rows: number): number | null {
  let both = 0;
  let same = 0;
  if (a.kind === "number" && b.kind === "number") {
    for (let r = 0; r < rows; r++) {
      const x = a.values[r] as number;
      const y = b.values[r] as number;
      if (x !== x || y !== y) continue;
      both++;
      if (Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y))) same++;
    }
  } else if (a.kind === "date" && b.kind === "date") {
    if (Boolean(a.timeOnly) !== Boolean(b.timeOnly)) return null;
    // Calendar dates agree by day (one copy may have dropped the time); times of day exactly.
    const unit = a.timeOnly ? 1 : DAY;
    for (let r = 0; r < rows; r++) {
      const x = a.values[r] as number;
      const y = b.values[r] as number;
      if (x !== x || y !== y) continue;
      both++;
      if (Math.floor(x / unit) === Math.floor(y / unit)) same++;
    }
  } else if (a.kind === "string" && b.kind === "string") {
    const norm = (s: string) => s.trim().toLowerCase();
    const da = a.dict.map(norm);
    const db = b.dict.map(norm);
    for (let r = 0; r < rows; r++) {
      const x = a.codes[r] as number;
      const y = b.codes[r] as number;
      if (x < 0 || y < 0) continue;
      both++;
      if (da[x] === db[y]) same++;
    }
  } else if (a.kind === "boolean" && b.kind === "boolean") {
    for (let r = 0; r < rows; r++) {
      const x = a.values[r] as number;
      const y = b.values[r] as number;
      if (x < 0 || y < 0) continue;
      both++;
      if (x === y) same++;
    }
  } else return null;
  return both >= MIN_ROWS ? same / both : null;
}

/** True when two columns hold the same value in every row, blanks included. */
function identical(a: Column, b: Column, rows: number): boolean {
  if (a.kind === "string" && b.kind === "string") {
    for (let r = 0; r < rows; r++) {
      const x = a.codes[r] as number;
      const y = b.codes[r] as number;
      if (x < 0 || y < 0) {
        if (x !== y && (x >= 0 || y >= 0)) return false;
      } else if (a.dict[x] !== b.dict[y]) return false;
    }
    return true;
  }
  if ((a.kind === "number" || a.kind === "date") && a.kind === b.kind) {
    for (let r = 0; r < rows; r++) {
      const x = a.values[r] as number;
      const y = b.values[r] as number;
      // NaN is the blank sentinel: two blanks are the same, a blank and a value are not.
      if (x !== y && (x === x || y === y)) return false;
    }
    return true;
  }
  if (a.kind === "boolean" && b.kind === "boolean") {
    for (let r = 0; r < rows; r++) if (a.values[r] !== b.values[r]) return false;
    return true;
  }
  return false;
}

const KIND_TEXT: Record<Column["kind"], string> = {
  number: "numbers",
  date: "dates",
  string: "text",
  boolean: "yes/no values",
};

/** "match on 87% of the rows where both have a value"; "every row" when they always agree. */
function matchText(share: number): string {
  if (share >= 1) return "match on every row where both have a value";
  if (share > 0.99) return "match on over 99% of the rows where both have a value";
  return `match on ${Math.round(share * 100)}% of the rows where both have a value`;
}

interface Candidate extends ReplacedColumn {
  rank: number;
  share: number;
}

/**
 * Columns that look replaced by another column of the file, in file order.
 * `health` supplies the problems the data check marks in each column, which
 * strengthen a suggestion when only the original has any.
 */
export function replacedColumns(
  ds: Dataset,
  profile: DatasetProfile,
  health: HealthReport,
): ReplacedColumn[] {
  const rows = ds.rowCount;
  // Empty columns are already ignored by every KPI and chart; they are not worth a suggestion.
  const cols = profile.columns.filter((p) => p.nullPct < 0.999 && ds.columns[p.index]);
  const data = (p: ColumnProfile) => ds.columns[p.index] as Column;
  const named = new Map(
    cols.map((p) => {
      const original = segments(p.name);
      const lower = original.map((w) => w.toLowerCase());
      // Lower-case word → its spelling in the name, so evidence quotes the user's own words.
      const spelling = new Map(lower.map((w, i) => [w, original[i] as string]));
      return [p.name, { lower, spelling }];
    }),
  );
  const problems = (name: string) =>
    health.issues.filter((i) => i.column === name && i.severity !== "info").map((i) => i.title);
  const problemText = (raw: string, keep: string): string => {
    const found = problems(raw);
    if (!found.length || problems(keep).length) return "";
    return ` The data check marks problems in "${raw}" (${found.slice(0, 2).join("; ")}) and none in "${keep}".`;
  };

  const candidates: Candidate[] = [];
  for (const r of cols) {
    const rn = named.get(r.name);
    if (!rn) continue;
    for (const c of cols) {
      if (c === r) continue;
      const cn = named.get(c.name);
      if (!cn) continue;
      const a = data(r);
      const b = data(c);

      // 1. Name: one is the other plus "clean" words, or plus "raw" words.
      const rawWords = rn.lower.filter((w) => RAW.has(w));
      const cleanWords = cn.lower.filter((w) => CLEAN.has(w));
      const baseR = unique(rn.lower.filter((w) => !RAW.has(w)));
      const baseC = unique(cn.lower.filter((w) => !CLEAN.has(w)));
      if ((rawWords.length || cleanWords.length) && baseR.length && sameSet(baseR, baseC)) {
        const share = agreement(a, b, rows);
        // Text next to its typed copy (text dates and their parsed dates) can't be compared value by value.
        const textToTyped = a.kind === "string" && (b.kind === "number" || b.kind === "date");
        if ((share !== null && share >= MIN_AGREEMENT) || (share === null && textToTyped)) {
          const added = cleanWords.length
            ? `"${c.name}" is the same name with ${quoted(cleanWords.map((w) => cn.spelling.get(w) ?? w))} added`
            : `"${r.name}" is "${c.name}" with ${quoted(rawWords.map((w) => rn.spelling.get(w) ?? w))} added`;
          const fit =
            share !== null
              ? `, and they ${matchText(share)}.`
              : `; "${r.name}" holds ${KIND_TEXT[a.kind]} and "${c.name}" ${KIND_TEXT[b.kind]}.`;
          candidates.push({
            column: r.name,
            keep: c.name,
            evidence: "name",
            reason: `${added}${fit}${problemText(r.name, c.name)}`,
            rank: 0,
            share: share ?? 0,
          });
          continue;
        }
      }

      // 2. Reference: "Reference_Price" next to a cleaned column whose name holds the rest of it.
      const refWords = rn.lower.filter((w) => REFERENCE.has(w));
      const rest = unique(rn.lower.filter((w) => !REFERENCE.has(w) && !RAW.has(w)));
      if (refWords.length && rest.length && cleanWords.length && rest.every((w) => cn.lower.includes(w))) {
        const share = agreement(a, b, rows);
        if (share !== null && share >= MIN_AGREEMENT) {
          candidates.push({
            column: r.name,
            keep: c.name,
            evidence: "reference",
            reason: `"${r.name}" is named as a reference, and it and "${c.name}" ${matchText(share)}.${problemText(r.name, c.name)}`,
            rank: 1,
            share,
          });
          continue;
        }
      }

      // 3. Identical: same type, blanks and distinct count, then every row (checked once per pair).
      if (
        r.index < c.index &&
        a.kind === b.kind &&
        r.nullCount === c.nullCount &&
        r.distinct === c.distinct &&
        identical(a, b, rows)
      ) {
        // Keep the column whose name says it is the clean one; else the one that isn't marked raw
        // or reference; else the earlier one.
        const score = (n: { lower: string[] }) =>
          (n.lower.some((w) => CLEAN.has(w)) ? 2 : 0) -
          (n.lower.some((w) => RAW.has(w) || REFERENCE.has(w)) ? 1 : 0);
        const [hide, keep] = score(cn) > score(rn) ? [r, c] : [c, r];
        candidates.push({
          column: hide.name,
          keep: keep.name,
          evidence: "identical",
          reason: `"${hide.name}" holds the same value as "${keep.name}" in every row.`,
          rank: 2,
          share: 1,
        });
      }
    }
  }

  // Strongest evidence first; among equals, a replacement that is not itself replaced, then the closer match.
  const targets = new Set(candidates.map((c) => c.column));
  candidates.sort(
    (x, y) =>
      x.rank - y.rank || (targets.has(x.keep) ? 1 : 0) - (targets.has(y.keep) ? 1 : 0) || y.share - x.share,
  );
  const hidden = new Set<string>();
  const kept = new Set<string>();
  const out: ReplacedColumn[] = [];
  for (const c of candidates) {
    if (hidden.has(c.column) || kept.has(c.column) || hidden.has(c.keep)) continue;
    hidden.add(c.column);
    kept.add(c.keep);
    out.push({ column: c.column, keep: c.keep, evidence: c.evidence, reason: c.reason });
  }
  const order = new Map(profile.columns.map((p) => [p.name, p.index]));
  return out.sort((x, y) => (order.get(x.column) ?? 0) - (order.get(y.column) ?? 0));
}
