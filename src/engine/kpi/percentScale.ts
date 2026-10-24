/**
 * Percentages written on another scale than an industry's formulas expect
 * (version 51.1). A template multiplies "Discount %" straight into amounts
 * (quantity × unit price × discount %), so it expects a fraction, 0.10 for
 * 10%; many files write the same discount as 10. Read as written, every
 * discount came out ten times the sale itself ("Discount % 1,119%") and the
 * revenue rebuilt from it went negative.
 *
 * A field of the registry says which scale its formulas expect (FieldDef
 * `percentScale`: 1 for fractions, 100 for points). Where the column that
 * fills it is on the other scale (its profiled percentScale, or for a plain
 * rate or measure column, its range), withPercentScales rewrites every
 * formula that reads the field before anything is computed: each use of the
 * column becomes column ÷ 100 (or × 100), and each threshold it is compared
 * with moves to the column's scale. One expression tree feeds the evaluator,
 * the SQL and the DAX, so all three change together, and the SQL and DAX
 * show the ÷ 100 openly. Each rewritten formula says so in its caveat, and
 * so do the charts whose bands read the field.
 */
import type { DatasetProfile, ColumnProfile } from "@/engine/profile/types";
import type { ChartTemplate, DomainDef } from "@/registry/schema";
import { fieldsOf, type Expr, type Predicate, type RowExpr } from "@/engine/query/expr";
import type { Mapping } from "@/engine/detect/mapping";

/** How a field's column is brought to the field's scale: ÷ 100 (points to fractions) or × 100. */
type Fix = "div" | "mul";

/**
 * The scale a column's percentages are written on: its profiled scale, or for
 * a rate or measure the range (within ±1 fractions, up to ±100 points). Undefined
 * when the column can't be a percentage or its range says neither.
 */
export function columnPercentScale(c: ColumnProfile): 1 | 100 | undefined {
  if (c.percentScale) return c.percentScale;
  const n = c.numeric;
  if (!n || !(c.role === "rate" || c.role === "percentage" || c.role === "measure")) return undefined;
  if (n.min >= -1 && n.max <= 1) return 1;
  // Above 1.5 a fraction would be a share over 150%, rare for a field that expects one; up to 100 is points.
  if (n.min >= -100 && n.max <= 100 && n.max > 1.5) return 100;
  return undefined;
}

function rowExpr(e: RowExpr, fixes: ReadonlyMap<string, Fix>): RowExpr {
  if ("field" in e) {
    const fix = fixes.get(e.field);
    return fix ? { op: fix, args: [e, { num: 100 }] } : e;
  }
  if ("op" in e) return { op: e.op, args: [rowExpr(e.args[0], fixes), rowExpr(e.args[1], fixes)] };
  return e;
}

function predicate(p: Predicate, fixes: ReadonlyMap<string, Fix>): Predicate {
  if ("and" in p) return { and: p.and.map((x) => predicate(x, fixes)) };
  if ("or" in p) return { or: p.or.map((x) => predicate(x, fixes)) };
  if ("not" in p) return { not: predicate(p.not, fixes) };
  if ("cmp" in p) {
    // The threshold is on the field's scale; the comparison reads the column as written.
    const fix = fixes.get(p.field);
    if (fix) return { ...p, value: fix === "div" ? p.value * 100 : p.value / 100 };
  }
  return p;
}

function expr(e: Expr, fixes: ReadonlyMap<string, Fix>): Expr {
  if ("agg" in e) {
    const where = e.where ? { where: predicate(e.where, fixes) } : {};
    if (e.agg === "count" || e.agg === "countDistinct" || e.agg === "spanDays") return { ...e, ...where };
    return { ...e, of: rowExpr(e.of, fixes), ...where };
  }
  if ("op" in e) return { op: e.op, args: [expr(e.args[0], fixes), expr(e.args[1], fixes)] };
  if ("calc" in e) return { calc: expr(e.calc, fixes), where: predicate(e.where, fixes) };
  if ("per" in e)
    return {
      ...e,
      inner: expr(e.inner, fixes),
      ...(e.having ? { having: { ...e.having, expr: expr(e.having.expr, fixes) } } : {}),
    };
  if ("atLatest" in e) return { ...e, expr: expr(e.expr, fixes) };
  return e;
}

/** A chart template whose binned axes read a rescaled field, with those axes rewritten. */
function chart(c: ChartTemplate, fixes: ReadonlyMap<string, Fix>): ChartTemplate {
  let changed = false;
  const out: Record<string, unknown> = { ...c };
  for (const [key, value] of Object.entries(c)) {
    if (value && typeof value === "object" && "bins" in value) {
      const axis = value as { bins: RowExpr };
      const bins = rowExpr(axis.bins, fixes);
      if (bins !== axis.bins) {
        out[key] = { ...axis, bins };
        changed = true;
      }
    }
  }
  return changed ? (out as ChartTemplate) : c;
}

/**
 * `domain` with every formula and binned chart axis that reads a percentage
 * field filled by a column on the other scale rewritten to the field's scale,
 * and a caveat on each rewritten formula. Unchanged when nothing differs.
 */
export function withPercentScales(domain: DomainDef, mapping: Mapping, profile: DatasetProfile): DomainDef {
  const fixes = new Map<string, Fix>();
  const notes = new Map<string, string>();
  for (const f of domain.fields) {
    if (!f.percentScale) continue;
    const column = mapping.fields[f.id];
    const c = column ? profile.columns.find((x) => x.name === column) : undefined;
    const actual = c ? columnPercentScale(c) : undefined;
    if (!c || !actual || actual === f.percentScale) continue;
    fixes.set(f.id, f.percentScale === 1 ? "div" : "mul");
    notes.set(
      f.id,
      f.percentScale === 1
        ? `${c.name} is written in points in your file (10 = 10%), so it is divided by 100 here.`
        : `${c.name} is written as fractions in your file (0.1 = 10%), so it is multiplied by 100 here.`,
    );
  }
  if (!fixes.size) return domain;
  return {
    ...domain,
    kpis: domain.kpis.map((k) => ({
      ...k,
      variants: k.variants.map((v) => {
        const read = [...fieldsOf(v.expr)].filter((id) => fixes.has(id));
        if (!read.length) return v;
        const caveat = [v.caveat, ...read.map((id) => notes.get(id))].filter(Boolean).join(" ");
        return { ...v, expr: expr(v.expr, fixes), caveat };
      }),
    })),
    charts: domain.charts.map((c) => chart(c, fixes)),
  };
}
