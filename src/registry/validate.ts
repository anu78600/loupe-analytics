/**
 * Cross-reference checks the Zod schema can't express (fields, classes, KPI refs, KPI aliases, chart
 * measures, cycles).
 *
 * Returns human-readable problems, empty when the domain is consistent.
 * index.ts logs them but still loads the domain; tests/registry.test.ts
 * fails on any of them.
 */
import type { AxisDef, DomainDef } from "./schema";
import { classesOf, fieldsOf, refsOf, type RowExpr } from "@/engine/query/expr";
import { normalizedName } from "@/engine/profile/names";

/** Field ids an axis references. */
function axisFields(a: AxisDef | undefined): string[] {
  if (!a) return [];
  if ("time" in a) return [a.time];
  if ("field" in a) return [a.field];
  if ("part" in a) return [a.of];
  if ("bins" in a) return [...fieldsOf(a.bins as RowExpr)];
  return [];
}

/**
 * Checks one parsed domain: unknown or duplicate ids, value classes (class and
 * notClass) that don't exist, KPI aliases that name another KPI, chart fields
 * and measures, sub-domain names, and KPI reference cycles across all variants.
 */
export function validateDomainRefs(d: DomainDef): string[] {
  const problems: string[] = [];
  const fieldIds = new Set(d.fields.map((f) => f.id));
  const kpiIds = new Set(d.kpis.map((k) => k.id));
  const classIds = new Set<string>();
  for (const [field, classes] of Object.entries(d.valueClasses ?? {})) {
    if (!fieldIds.has(field)) problems.push(`valueClasses references unknown field "${field}"`);
    for (const c of classes) classIds.add(`${field}.${c.id}`);
  }
  const seenFields = new Set<string>();
  for (const f of d.fields) {
    if (seenFields.has(f.id)) problems.push(`duplicate field id "${f.id}"`);
    seenFields.add(f.id);
    for (const other of [f.atLeast, f.atMost])
      if (other !== undefined && (!fieldIds.has(other) || other === f.id))
        problems.push(`field ${f.id} is bounded by unknown field "${other}"`);
  }
  const seenKpis = new Set<string>();
  for (const k of d.kpis) {
    if (seenKpis.has(k.id)) problems.push(`duplicate KPI id "${k.id}"`);
    seenKpis.add(k.id);
    for (const v of k.variants) {
      for (const f of fieldsOf(v.expr))
        if (!fieldIds.has(f)) problems.push(`KPI ${k.id}/${v.id} uses unknown field "${f}"`);
      for (const c of classesOf(v.expr))
        if (!classIds.has(c)) problems.push(`KPI ${k.id}/${v.id} uses unknown value class "${c}"`);
      for (const r of refsOf(v.expr)) {
        if (!kpiIds.has(r)) problems.push(`KPI ${k.id}/${v.id} references unknown KPI "${r}"`);
        if (r === k.id) problems.push(`KPI ${k.id} references itself`);
      }
    }
  }
  // A KPI alias is evidence that a column or scorecard metric is that KPI (detect/match.ts), so one
  // that also names another KPI of the domain would point two ways. Compared as tokenised names, so
  // "Occupancy %" and "occupancy percent" are one name.
  const named = new Map<string, string>();
  for (const k of d.kpis)
    for (const n of [k.name, ...(k.short ? [k.short] : [])]) named.set(normalizedName(n), k.id);
  for (const k of d.kpis)
    for (const a of k.aliases ?? []) {
      const key = normalizedName(a);
      const other = named.get(key);
      if (other && other !== k.id) problems.push(`KPI ${k.id} alias "${a}" names KPI "${other}"`);
      else named.set(key, k.id);
    }
  const subIds = new Set(d.subDomains.map((s) => s.id));
  for (const s of d.subDomains)
    for (const sig of s.signals)
      if (!fieldIds.has(sig)) problems.push(`sub-domain ${s.id} signal "${sig}" is not a field`);
  for (const k of d.kpis)
    for (const s of k.subDomains ?? [])
      if (!subIds.has(s)) problems.push(`KPI ${k.id} lists unknown sub-domain "${s}"`);
  const chartIds = new Set<string>();
  for (const c of d.charts) {
    if (chartIds.has(c.id)) problems.push(`duplicate chart id "${c.id}"`);
    chartIds.add(c.id);
    for (const m of c.measures)
      if (!kpiIds.has(m)) problems.push(`chart ${c.id} measure "${m}" is not a KPI`);
    for (const f of [
      ...axisFields(c.x),
      ...axisFields(c.series),
      ...(c.drill ?? []),
      ...(c.requires ?? []),
    ]) {
      if (!fieldIds.has(f)) problems.push(`chart ${c.id} uses unknown field "${f}"`);
    }
    for (const s of c.subDomains ?? [])
      if (!subIds.has(s)) problems.push(`chart ${c.id} lists unknown sub-domain "${s}"`);
  }
  // Depth-first search over the KPI ref graph (refs of every variant): reaching
  // a KPI that is still on the current path closes a cycle.
  const graph = new Map(d.kpis.map((k) => [k.id, new Set(k.variants.flatMap((v) => [...refsOf(v.expr)]))]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      problems.push(`KPI reference cycle: ${[...path, id].join(" → ")}`);
      return;
    }
    visiting.add(id);
    for (const next of graph.get(id) ?? []) visit(next, [...path, id]);
    visiting.delete(id);
    done.add(id);
  };
  for (const id of graph.keys()) visit(id, []);
  return problems;
}
