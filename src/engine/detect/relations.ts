/**
 * Sense checks between paired fields, read from the rows (version 51.2).
 *
 * A column's name and profile can fit a field while its values can't: a
 * supermarket's "gross income" (the margin on each sale) reads like gross
 * sales, a bank's running "balance" like the amount still owed on an
 * invoice, a loan's lifetime "total payment" like the money collected
 * against one monthly "installment". Used, they gave a Discount % of
 * −2,000%, a Settled % of −490% and a collection efficiency of 3,906%.
 *
 * The registry says which fields bound which (FieldDef `atLeast` and
 * `atMost`: gross sales ≥ net sales, owed ≤ invoiced, collected ≤ due).
 * Where both are mapped and over a fifth of the rows that have both break
 * the bound, the column found for the bounded field is not used for it, and
 * the reason is kept for the Check & map step. The user's own choice is never
 * second-guessed: a field mapped by hand is left as it is.
 */
import type { Dataset } from "@/engine/core/types";
import { columnByName } from "@/engine/core/types";
import type { DomainDef } from "@/registry/schema";
import type { Mapping } from "./mapping";

/** Over this share of rows breaking a bound, the column is not that field. */
export const BOUND_BREAK_SHARE = 0.2;
/** Fewer rows with both values than this say too little to judge. */
const MIN_ROWS = 10;

export interface RejectedMapping {
  field: string;
  column: string;
  /** One plain sentence: why the column isn't used for the field. */
  reason: string;
}

/**
 * `mapping` without the bounded fields whose columns break their bound on
 * the rows, and the reasons. Fields in `overrides` (mapped or unmapped by
 * the user) are left alone.
 */
export function checkFieldBounds(
  domain: DomainDef,
  mapping: Mapping,
  ds: Dataset,
  overrides?: Record<string, string | null>,
): { mapping: Mapping; rejected: RejectedMapping[] } {
  const rejected: RejectedMapping[] = [];
  let fields = mapping.fields;
  let scores = mapping.scores;
  const label = (id: string) => domain.fields.find((f) => f.id === id)?.label ?? id;
  for (const f of domain.fields) {
    const other = f.atLeast ?? f.atMost;
    if (!other || (overrides && f.id in overrides)) continue;
    const column = fields[f.id];
    const otherColumn = fields[other];
    if (!column || !otherColumn || column === otherColumn) continue;
    const a = columnByName(ds, column);
    const b = columnByName(ds, otherColumn);
    if (a?.kind !== "number" || b?.kind !== "number") continue;
    let both = 0;
    let broken = 0;
    for (let r = 0; r < ds.rowCount; r++) {
      const x = a.values[r] as number;
      const y = b.values[r] as number;
      if (x !== x || y !== y) continue;
      both++;
      const tol = 1e-9 * Math.max(1, Math.abs(y));
      if (f.atLeast ? x < y - tol : x > y + tol) broken++;
    }
    if (both < MIN_ROWS || broken / both <= BOUND_BREAK_SHARE) continue;
    const share = Math.round((broken / both) * 100);
    rejected.push({
      field: f.id,
      column,
      reason: `${column} is ${f.atLeast ? "below" : "above"} ${otherColumn} on ${share}% of rows, so it can't be the ${label(f.id).toLowerCase()} (which is never ${f.atLeast ? "below" : "above"} the ${label(other).toLowerCase()}).`,
    });
    fields = { ...fields };
    scores = { ...scores };
    delete fields[f.id];
    delete scores[f.id];
  }
  return { mapping: rejected.length ? { ...mapping, fields, scores } : mapping, rejected };
}
