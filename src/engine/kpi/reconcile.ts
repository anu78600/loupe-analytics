/**
 * Totals that must add up (version 52.2). An analyst's first check on a new
 * file: does gross sales − discounts give revenue, does revenue − cost of
 * sales give gross profit? When a file holds each figure in a column of its
 * own, its own figures can disagree, and every margin built on them is then
 * in doubt. The owner's UCI file reads gross sales 93.0M (quantity × unit
 * price), discounts 10.8M (from the discount %) and revenue 92.8M (its amount
 * column): 93.0M − 10.8M is 82.2M, not 92.8M.
 *
 * reconcile tests each identity whose three KPIs are available and computed
 * independently: when one side is built from the other (discounts as gross −
 * revenue, revenue as gross sales), or the result reads only the columns the
 * other two read (revenue rebuilt from quantity, price and discount %), the
 * identity holds by construction and says nothing, so it is left out. Each result is evaluated over the whole
 * file and passes within RECONCILE_TOLERANCE of the larger side.
 */
import type { Dataset } from "@/engine/core/types";
import { refsOf } from "@/engine/query/expr";
import { EMPTY_SCOPE, evaluateScalar, type Resolver } from "@/engine/query/evaluate";
import type { Mapping } from "@/engine/detect/mapping";
import type { KpiResolutionMap } from "./resolve";

/** A total passes when its gap is at most this share of the larger side (rounding in the file). */
export const RECONCILE_TOLERANCE = 0.005;

/** `left − right = result`, by KPI id; the first identity with a result KPI available is tested. */
const IDENTITIES: ReadonlyArray<{ left: string; right: string; result: string }> = [
  { left: "gross_sales", right: "discounts", result: "revenue" },
  { left: "gross_sales", right: "discounts", result: "net_sales" },
  { left: "revenue", right: "cogs", result: "gross_profit" },
  { left: "revenue", right: "total_expenses", result: "net_income" },
];

export interface Reconciliation {
  id: string;
  /** KPI names: left − right = result. */
  left: string;
  right: string;
  result: string;
  /** left − right, and the result KPI, over the whole file. */
  expected: number;
  actual: number;
  ok: boolean;
  /** The file's columns the three figures read, in order. */
  columns: string[];
}

/** True when KPI `id` is computed from `other`, directly or through its refs. */
function dependsOn(res: KpiResolutionMap, id: string, other: string, seen = new Set<string>()): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  const expr = res.get(id)?.variant?.expr;
  if (!expr) return false;
  for (const r of refsOf(expr)) if (r === other || dependsOn(res, r, other, seen)) return true;
  return false;
}

/** The identities of the dashboard that can be tested, each checked over every row. */
export function reconcile(
  ds: Dataset,
  res: KpiResolutionMap,
  resolver: Resolver,
  mapping: Mapping,
): Reconciliation[] {
  const all = Int32Array.from({ length: ds.rowCount }, (_, i) => i);
  const value = (id: string): number | null => {
    const expr = res.get(id)?.variant?.expr;
    if (!expr) return null;
    try {
      const v = evaluateScalar(expr, resolver, EMPTY_SCOPE, all);
      return Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  };
  const out: Reconciliation[] = [];
  const tested = new Set<string>();
  for (const { left, right, result } of IDENTITIES) {
    const ids = [left, right, result];
    if (!ids.every((id) => res.get(id)?.available)) continue;
    const key = `${left}|${right}`;
    if (tested.has(key)) continue;
    // A side built from another holds by construction: nothing to test.
    if (ids.some((a) => ids.some((b) => a !== b && dependsOn(res, a, b)))) continue;
    const columnsOf = (id: string) => (res.get(id)?.fieldsUsed ?? []).map((f) => mapping.fields[f] ?? f);
    // A result read only from the columns of the other two (revenue rebuilt from quantity, price and
    // discount %) agrees by construction too.
    const sides = new Set([...columnsOf(left), ...columnsOf(right)]);
    if (columnsOf(result).every((c) => sides.has(c))) continue;
    const [l, r, actual] = ids.map(value);
    if (l == null || r == null || actual == null) continue;
    tested.add(key);
    const expected = l - r;
    const scale = Math.max(Math.abs(expected), Math.abs(actual), 1);
    const columns = [...new Set(ids.flatMap(columnsOf))];
    out.push({
      id: `${left}-${right}-${result}`,
      left: res.get(left)?.def.name ?? left,
      right: res.get(right)?.def.name ?? right,
      result: res.get(result)?.def.name ?? result,
      expected,
      actual,
      ok: Math.abs(actual - expected) <= RECONCILE_TOLERANCE * scale,
      columns,
    });
  }
  return out;
}
