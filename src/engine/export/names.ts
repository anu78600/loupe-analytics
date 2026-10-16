/**
 * Export naming: clean column names, a friendly table name, and collision-free measure names.
 *
 * Computed once per configure() and shared by every export (SQL, DAX, TMDL,
 * CSV headers, README, dictionary), so the same thing has the same name in
 * every file. Name clashes are checked case-insensitively because Power BI
 * and DAX names are case-insensitive.
 */
import type { Dataset } from "@/engine/core/types";
import { cleanColumnNames, type CompileNames } from "@/engine/kpi/context";
import type { DomainDef } from "@/registry/schema";

/**
 * Fact-table name from the domain's entity, naively pluralised ("order" →
 * "Orders", "policy" → "Policies"); "Data" when the entity is blank or "row".
 */
export function tableNameFor(domain: DomainDef): string {
  const entity = domain.entity.trim();
  if (!entity || entity === "row") return "Data";
  const word = entity.charAt(0).toUpperCase() + entity.slice(1);
  return /s$/.test(word) ? word : /y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`;
}

/**
 * `name` after "Total": its first letter lower-cased ("Revenue" → "Total
 * revenue"), unless its first word is an acronym or a name with capitals of
 * its own, which keeps its case ("MRR" → "Total MRR", "McDonald's" →
 * "Total McDonald's").
 */
export function totalOf(name: string): string {
  const first = name.split(/\s+/)[0] ?? "";
  const ownCapitals = /[A-Z]/.test(first.slice(1));
  return `Total ${ownCapitals ? name : `${name.charAt(0).toLowerCase()}${name.slice(1)}`}`;
}

/**
 * Names for one export run: snake_case column names, the table name, and a
 * measure name per KPI (user rename or default). A measure may share the
 * table's name (DAX tells 'Orders' from [Orders]), but not a column's, the
 * Date table's or another measure's: it then becomes "Total revenue" (or
 * "Total MRR"), as an analyst would name it, and only failing that gets a
 * number ("Revenue 2").
 */
export function compileNames(
  ds: Dataset,
  domain: DomainDef,
  renames: Record<string, string> = {},
): CompileNames {
  const table = tableNameFor(domain);
  const columns = cleanColumnNames(ds.columns.map((c) => c.name));
  const taken = new Set([...columns.values()].map((c) => c.toLowerCase()));
  // Reserved for the generated Date table.
  taken.add("date");
  const measures = new Map<string, string>();
  for (const k of domain.kpis) {
    // Square brackets are stripped: DAX uses them to delimit measure references.
    const base = (renames[k.id] ?? k.name).replace(/[[\]]/g, "").trim() || k.id;
    let name = base;
    if (taken.has(name.toLowerCase())) name = totalOf(base);
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    taken.add(name.toLowerCase());
    measures.set(k.id, name);
  }
  return { table, columns, measures };
}

/**
 * Deterministic GUID-shaped ids (stable lineage tags across re-exports of the same model).
 * Four 32-bit multiplicative hash lanes give 128 bits; the version (4) and
 * variant (a) nibbles are fixed so the result is a well-formed v4 UUID.
 * Not cryptographic: callers seed it with distinct, stable names.
 */
export function lineageTag(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let h3 = 0x9e3779b9;
  let h4 = 0x85ebca6b;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h3 = Math.imul(h3 ^ c, 0x27d4eb2d);
    h4 = Math.imul(h4 ^ c, 0x165667b1);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  const s = hex(h1) + hex(h2) + hex(h3) + hex(h4);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
}
