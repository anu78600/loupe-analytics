/**
 * Values a KPI can't take (version 51.4). Some figures have limits whatever
 * the business: discounts are never below zero and a discount rate never
 * above 100%. A formula that breaks one over the whole file is not measuring
 * what it says, because its columns don't fit it:
 * - a supermarket's Total includes 5% tax, so "gross sales − revenue" (price ×
 *   quantity − Total) came out at −15,379 and the Discount % at −5%;
 * - a spend list's single credit made its cost of sales −600,000.
 *
 * withKpiLimits evaluates every KPI that has `limits` in the registry over
 * all the rows. One outside its limits:
 * - when its formula is a plain sum of one column written as negative numbers
 *   (discounts entered as −5), is negated, with a caveat, like a signed ledger
 *   (kpi/ledger.ts);
 * - otherwise has that formula refused: resolveKpis skips it, so the KPI
 *   falls back to its next formula, or is unavailable and says why. The KPIs
 *   built on it follow, and the next round checks them in turn.
 * A KPI that can't be negative and is worked out as a difference that comes
 * to exactly 0 (gross sales − revenue on a file whose Total is always price ×
 * quantity) is refused too: the file records no discounts, and "Discounts 0"
 * would say it gave none.
 * The whole file is the test, not the current filter: a month of net refunds
 * is real data, but a file whose discounts add up below zero is not.
 */
import type { Dataset } from "@/engine/core/types";
import { formatValue, type NumberLocale } from "@/engine/core/format";
import type { DomainDef, KpiDef } from "@/registry/schema";
import type { Expr } from "@/engine/query/expr";
import { EMPTY_SCOPE, evaluateScalar } from "@/engine/query/evaluate";
import type { Mapping } from "@/engine/detect/mapping";
import { makeResolver } from "./context";
import type { KpiResolutionMap } from "./resolve";

/** A column whose non-zero values are at least this share negative is written as negative numbers. */
const NEGATIVE_SHARE = 0.8;
/** Rounds of checking: each refusal can expose a KPI built on the refused one. */
const MAX_ROUNDS = 4;

export interface LimitsResult {
  /** The domain with columns written as negative numbers negated where a limit showed it. */
  domain: DomainDef;
  /** "kpi/variant" → why the rows rule that formula out, for resolveKpis. */
  refused: Map<string, string>;
}

/** The field of `{ agg: "sum", of: { field } }` with no condition, else null. */
function plainSumField(e: Expr): string | null {
  return "agg" in e && e.agg === "sum" && "field" in e.of && !e.where ? e.of.field : null;
}

/** "A, B and C". */
function listOf(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * `domain` with the formulas its rows rule out refused (see the header). `resolve` resolves the KPIs
 * the way the caller does (sub-domain, hidden columns), with the refusals so far.
 */
export function withKpiLimits(
  domain: DomainDef,
  mapping: Mapping,
  ds: Dataset,
  resolve: (domain: DomainDef, refused: ReadonlyMap<string, string>) => KpiResolutionMap,
  fmt: { locale: NumberLocale; currency: string },
): LimitsResult {
  const refused = new Map<string, string>();
  if (!domain.kpis.some((k) => k.limits)) return { domain, refused };
  const all = Int32Array.from({ length: ds.rowCount }, (_, i) => i);
  let out = domain;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = resolve(out, refused);
    const resolver = makeResolver(ds, mapping, res);
    let changed = false;
    const negate = new Map<string, string>();
    for (const def of out.kpis) {
      const r = res.get(def.id);
      if (!def.limits || !r?.available || !r.variant || r.dependencyOnly) continue;
      let v: number;
      try {
        v = evaluateScalar(r.variant.expr, resolver, EMPTY_SCOPE, all);
      } catch {
        continue;
      }
      // A difference that comes to nothing (gross sales − revenue where every Total is price × quantity)
      // records no such figure: "Discounts 0" would read as a fact about the business.
      const e = r.variant.expr;
      if (def.limits.min === 0 && "op" in e && e.op === "sub" && Number.isFinite(v)) {
        let first = NaN;
        try {
          first = evaluateScalar(e.args[0], resolver, EMPTY_SCOPE, all);
        } catch {
          // An operand that can't be evaluated leaves the value to the limits below.
        }
        if (Number.isFinite(first) && first !== 0 && Math.abs(v) <= 1e-9 * Math.abs(first)) {
          refused.set(
            `${def.id}/${r.variant.id}`,
            `Unavailable: “${r.variant.label}” comes to 0 over your whole file, so it records no ${def.name.toLowerCase()}.`,
          );
          changed = true;
          continue;
        }
      }
      const { min, max } = def.limits;
      const below = min !== undefined && v < min;
      if (!Number.isFinite(v) || (!below && !(max !== undefined && v > max))) continue;
      const field = plainSumField(r.variant.expr);
      const column = field ? mapping.fields[field] : undefined;
      if (below && field && column && writtenNegative(ds, column)) {
        negate.set(`${def.id}/${r.variant.id}`, column);
        continue;
      }
      const show = (x: number) => formatValue(x, def.format, { locale: fmt.locale, currency: fmt.currency });
      const columns = [
        ...new Set(r.fieldsUsed.map((f) => mapping.fields[f]).filter((c): c is string => Boolean(c))),
      ];
      refused.set(
        `${def.id}/${r.variant.id}`,
        `Unavailable: over your whole file it comes to ${show(v)}, and ${def.name} can't be ${
          below ? `below ${show(min)}` : `above ${show(max as number)}`
        }, so ${columns.length ? listOf(columns) : "its columns"} don't fit “${r.variant.label}”.`,
      );
      changed = true;
    }
    if (negate.size) {
      out = { ...out, kpis: out.kpis.map((k) => negated(k, negate)) };
      changed = true;
    }
    if (!changed) break;
  }
  return { domain: out, refused };
}

/** True when most of a number column's non-zero values are negative. */
function writtenNegative(ds: Dataset, column: string): boolean {
  const col = ds.columns.find((c) => c.name === column);
  if (col?.kind !== "number") return false;
  let nonZero = 0;
  let negative = 0;
  for (const x of col.values) {
    if (x !== x || x === 0) continue;
    nonZero++;
    if (x < 0) negative++;
  }
  return nonZero >= 3 && negative / nonZero >= NEGATIVE_SHARE;
}

/** `k` with each variant named in `negate` summing its column times −1, and a caveat saying why. */
function negated(k: KpiDef, negate: ReadonlyMap<string, string>): KpiDef {
  if (![...negate.keys()].some((key) => key.startsWith(`${k.id}/`))) return k;
  return {
    ...k,
    variants: k.variants.map((v) => {
      const column = negate.get(`${k.id}/${v.id}`);
      const field = column ? plainSumField(v.expr) : null;
      if (!column || !field) return v;
      const note = `${column} is written as negative numbers in your file, so it is counted as a positive amount.`;
      return {
        ...v,
        expr: { agg: "sum", of: { op: "mul", args: [{ field }, { num: -1 }] } },
        caveat: [v.caveat, note].filter(Boolean).join(" "),
      };
    }),
  };
}
