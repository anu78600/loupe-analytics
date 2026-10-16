/**
 * Chooses, for every KPI, the first formula variant whose fields, value
 * classes and referenced KPIs are available. When none is, the KPI is
 * reported as unavailable with exactly what is missing; it is never faked.
 *
 * A field is available when the mapping assigns it a column. A positive
 * value class (`class`) needs at least one raw value assigned; `notClass`
 * never blocks, since an empty class excludes nothing. Referenced KPIs are
 * resolved recursively and memoised; a reference cycle makes the KPI
 * unavailable instead of recursing forever.
 */
import { fieldsOf, refsOf, requiredClassesOf, type Expr } from "@/engine/query/expr";
import type { Mapping } from "@/engine/detect/mapping";
import type { DomainDef, KpiDef, KpiVariant } from "@/registry/schema";
import { isColumnId } from "./columnKpis";

export interface KpiResolution {
  def: KpiDef;
  available: boolean;
  /** The chosen variant: the first one, in registry order, with nothing missing. */
  variant?: KpiVariant;
  /** Fields the chosen variant uses (after following refs). */
  fieldsUsed: string[];
  /** Positive value classes ("field.class") the chosen variant needs, after following refs. */
  classesUsed: string[];
  /** For an unavailable KPI: what the closest variant (fewest missing items) lacks. Empty when available. */
  missingFields: string[];
  missingClasses: string[];
  missingKpis: string[];
  /** Plain-language explanation for unavailable KPIs. */
  unavailableReason?: string;
  /** Suggestion when unavailable. */
  substitute?: string;
  /**
   * Resolved only because an in-scope KPI refers to it: it belongs to another
   * sub-domain, so it is kept for evaluation, SQL and DAX but never shown or
   * selected as a KPI of this view.
   */
  dependencyOnly?: boolean;
}

export type KpiResolutionMap = Map<string, KpiResolution>;

/**
 * Resolves the domain's KPIs against the mapping. With `subDomain`, KPIs
 * tagged only for other sub-domains are left out of the result, unless an
 * in-scope KPI refers to one: then it stays, flagged `dependencyOnly`.
 * `hidden` maps a field to the column that would fill it but that the user
 * hid in Check & map, so a KPI that needs it says so instead of asking for a
 * column the file already has.
 */
export function resolveKpis(
  domain: DomainDef,
  mapping: Mapping,
  subDomain?: string,
  hidden?: ReadonlyMap<string, string>,
): KpiResolutionMap {
  const defs = new Map(domain.kpis.map((k) => [k.id, k]));
  const labels = new Map(domain.fields.map((f) => [f.id, f.label]));
  const classLabels = new Map<string, string>();
  for (const [field, list] of Object.entries(domain.valueClasses ?? {}))
    for (const c of list) classLabels.set(`${field}.${c.id}`, `${labels.get(field) ?? field} = ${c.label}`);
  const out: KpiResolutionMap = new Map();
  const visiting = new Set<string>();

  const resolve = (id: string): KpiResolution => {
    const hit = out.get(id);
    if (hit) return hit;
    const def = defs.get(id);
    if (!def) throw new Error(`Unknown KPI ${id}`);
    // Reached again while resolving its own refs: a cycle. Reported, not memoised.
    if (visiting.has(id)) {
      return {
        def,
        available: false,
        fieldsUsed: [],
        classesUsed: [],
        missingFields: [],
        missingClasses: [],
        missingKpis: [id],
        unavailableReason: "Circular definition.",
      };
    }
    visiting.add(id);
    let best: {
      missingFields: string[];
      missingClasses: string[];
      missingKpis: string[];
      variant: KpiVariant;
    } | null = null;
    let chosen: KpiResolution | null = null;
    // Registry order is preference order: the first variant with nothing
    // missing wins. Otherwise the variant missing the fewest items (earliest
    // on ties) is kept to explain what the KPI needs.
    for (const variant of def.variants) {
      const missingFields = [...fieldsOf(variant.expr)].filter((f) => !mapping.fields[f]);
      const missingClasses = [...requiredClassesOf(variant.expr)].filter((c) => !mapping.classes[c]?.length);
      const refs = [...refsOf(variant.expr)];
      const missingKpis = refs.filter((r) => !resolve(r).available);
      const cost = missingFields.length + missingClasses.length + missingKpis.length;
      if (cost === 0) {
        const fieldsUsed = new Set(fieldsOf(variant.expr));
        const classesUsed = new Set([...requiredClassesOf(variant.expr)]);
        for (const r of refs) {
          const rr = resolve(r);
          rr.fieldsUsed.forEach((f) => fieldsUsed.add(f));
          rr.classesUsed.forEach((c) => classesUsed.add(c));
        }
        chosen = {
          def,
          available: true,
          variant,
          fieldsUsed: [...fieldsUsed],
          classesUsed: [...classesUsed],
          missingFields: [],
          missingClasses: [],
          missingKpis: [],
        };
        break;
      }
      const bestCost = best
        ? best.missingFields.length + best.missingClasses.length + best.missingKpis.length
        : Infinity;
      if (cost < bestCost) best = { missingFields, missingClasses, missingKpis, variant };
    }
    visiting.delete(id);
    if (!chosen) {
      const b = best as NonNullable<typeof best>;
      const needs = [
        ...b.missingFields.map((f) => labels.get(f) ?? f),
        ...b.missingClasses.map((c) => classLabels.get(c) ?? c),
        ...b.missingKpis.map((k) => defs.get(k)?.name ?? k),
      ];
      // Suggest the other variant that misses the fewest fields (classes and refs are not counted here).
      const alternatives = def.variants
        .filter((v) => v !== b.variant)
        .map((v) => ({ v, missing: [...fieldsOf(v.expr)].filter((f) => !mapping.fields[f]) }))
        .sort((x, y) => x.missing.length - y.missing.length)[0];
      // A missing field (or the field behind a missing value class) whose column the user hid.
      const fieldOf = (cls: string) => cls.split(".")[0] ?? cls;
      const hiddenColumns = [
        ...new Set(
          [...b.missingFields, ...b.missingClasses.map(fieldOf)]
            .map((f) => hidden?.get(f))
            .filter((c): c is string => Boolean(c)),
        ),
      ];
      chosen = {
        def,
        available: false,
        fieldsUsed: [],
        classesUsed: [],
        missingFields: b.missingFields,
        missingClasses: b.missingClasses,
        missingKpis: b.missingKpis,
        unavailableReason: hiddenColumns.length
          ? `Unavailable: it needs ${hiddenColumns.map((c) => `"${c}"`).join(" and ")}, which you hid in Check & map.`
          : `Unavailable: needs ${needs.join(", ")}.`,
        substitute: hiddenColumns.length
          ? "Show the column again in Check & map to use this KPI."
          : alternatives && alternatives.missing.length
            ? `Or map ${alternatives.missing.map((f) => labels.get(f) ?? f).join(" + ")} to use "${alternatives.v.label}".`
            : // Value meanings only help when the class's field has a column to take values from.
              b.missingClasses.some((c) => mapping.fields[fieldOf(c)])
              ? "Assign the matching values in Check & map › Value meanings."
              : undefined,
      };
    }
    out.set(id, chosen);
    return chosen;
  };

  for (const k of domain.kpis) {
    if (subDomain && k.subDomains && !k.subDomains.includes(subDomain)) continue;
    resolve(k.id);
  }
  // KPIs from other sub-domains are only in the map because an in-scope KPI
  // refers to them. They stay (the evaluator, SQL and DAX all need the
  // referenced measure) but are flagged so no view lists them as its own.
  for (const r of out.values()) {
    if (subDomain && r.def.subDomains && !r.def.subDomains.includes(subDomain)) r.dependencyOnly = true;
  }
  return out;
}

/** Expression of the chosen variant; throws when the KPI is unavailable. */
export function exprForKpi(res: KpiResolutionMap, id: string): Expr {
  const r = res.get(id);
  if (!r || !r.available || !r.variant) throw new Error(`KPI ${id} unavailable`);
  return r.variant.expr;
}

/** KPI ids per dashboard slot. */
export interface KpiSelection {
  hero: string[];
  supporting: string[];
  detail: string[];
  /** KPIs built from measure columns the template doesn't read (kpi/columnKpis), shown in their own section. */
  columns: string[];
  /** Visible hero and supporting KPIs that cannot be computed (listed with their reason). */
  unavailable: string[];
}

/**
 * Picks 4–6 hero KPIs and up to 12 supporting KPIs from what is available.
 * Lower `priority` ranks first and hidden KPIs are never shown. Heroes beyond
 * six move to the front of supporting; fewer than four heroes are topped up
 * from supporting, then detail; supporting beyond 12 spill into detail.
 * KPIs built from the file's other measure columns go to `columns` only.
 */
export function selectKpis(res: KpiResolutionMap): KpiSelection {
  const visible = [...res.values()].filter((r) => !r.def.hidden && !r.dependencyOnly);
  const sorted = visible.filter((r) => r.available).sort((a, b) => a.def.priority - b.def.priority);
  // Column KPIs never take a template KPI's slot; they have a section of their own.
  const columns = sorted.filter((r) => isColumnId(r.def.id)).map((r) => r.def.id);
  const avail = sorted.filter((r) => !isColumnId(r.def.id));
  let hero = avail.filter((r) => r.def.tier === "hero").map((r) => r.def.id);
  let supporting = avail.filter((r) => r.def.tier === "supporting").map((r) => r.def.id);
  const detail = avail.filter((r) => r.def.tier === "detail").map((r) => r.def.id);
  if (hero.length > 6) {
    supporting = [...hero.slice(6), ...supporting];
    hero = hero.slice(0, 6);
  }
  while (hero.length < 4 && supporting.length) hero.push(supporting.shift() as string);
  while (hero.length < 4 && detail.length) hero.push(detail.shift() as string);
  const unavailable = visible.filter((r) => !r.available && r.def.tier !== "detail").map((r) => r.def.id);
  return {
    hero,
    supporting: supporting.slice(0, 12),
    detail: [...supporting.slice(12), ...detail],
    columns,
    unavailable,
  };
}
