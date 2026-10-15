/**
 * Column mapping (field → column) and value-class resolution (e.g. which statuses mean "cancelled").
 *
 * Classes are matched by keyword against the mapped column's distinct values
 * in registry order: a value joins the first class that matches, so a domain
 * file lists the more specific classes first (e.g. "rto" before "returned").
 * User overrides win over detection for both fields and classes.
 */
import type { DatasetProfile } from "@/engine/profile/types";
import type { DomainDef } from "@/registry/schema";
import type { FieldAssignment } from "./match";

export interface Mapping {
  /** Domain field id → column name. */
  fields: Record<string, string>;
  /** Match confidence per field (1 when set by the user). */
  scores: Record<string, number>;
  /** "field.class" → raw column values in that class. */
  classes: Record<string, string[]>;
}

/**
 * User edits from the mapping step. `fields[id] = null` unmaps a field; a
 * column name assigns it, taking the column away from any other field.
 * `classes` replaces the values of a "field.class" key.
 */
export interface MappingOverrides {
  fields?: Record<string, string | null>;
  classes?: Record<string, string[]>;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Keyword test on normalised text (lower-case, punctuation → spaces). A
 * multi-word keyword matches as a whole phrase or as the start of the value.
 */
function keywordMatches(value: string, keyword: string): boolean {
  const v = normalize(value);
  const k = normalize(keyword);
  if (!k) return false;
  if (v === k) return true;
  if (k.includes(" ")) return ` ${v} `.includes(` ${k} `) || v.startsWith(k);
  const words = v.split(" ");
  // Short keywords (cod, rto, cash) must match a whole word; longer ones may prefix a word (cancel → cancelled).
  return k.length >= 5 ? words.some((w) => w === k || w.startsWith(k)) : words.includes(k);
}

/**
 * Assigns each distinct value of a mapped column to the first matching class (priority order).
 * Every class of the field gets a key, empty when nothing matched.
 */
export function resolveClassesForField(
  domain: DomainDef,
  fieldId: string,
  values: readonly string[],
): Record<string, string[]> {
  const classes = domain.valueClasses?.[fieldId];
  const out: Record<string, string[]> = {};
  if (!classes) return out;
  for (const c of classes) out[`${fieldId}.${c.id}`] = [];
  for (const value of values) {
    for (const c of classes) {
      if (c.keywords.some((k) => keywordMatches(value, k))) {
        (out[`${fieldId}.${c.id}`] as string[]).push(value);
        break;
      }
    }
  }
  return out;
}

/**
 * Distinct values of a column as profiled: every value when the profile kept
 * them all, otherwise only the top values (rarer values are then never
 * classified); boolean columns give their example labels.
 */
export function distinctValues(profile: DatasetProfile, column: string): string[] {
  const col = profile.columns.find((c) => c.name === column);
  if (!col) return [];
  if (col.storage === "boolean") return col.examples;
  const vc = col.categorical?.all ?? col.categorical?.top ?? [];
  return vc.map((v) => v.value);
}

/**
 * Mapping from the detected assignments plus user overrides. Classes are
 * resolved after the field overrides, so remapping a status column re-derives
 * its classes; class overrides are kept only for fields that have value classes.
 */
export function buildMapping(
  domain: DomainDef,
  profile: DatasetProfile,
  assignments: readonly FieldAssignment[],
  overrides: MappingOverrides = {},
): Mapping {
  const fields: Record<string, string> = {};
  const scores: Record<string, number> = {};
  for (const a of assignments) {
    fields[a.fieldId] = a.column;
    scores[a.fieldId] = a.score;
  }
  for (const [fieldId, column] of Object.entries(overrides.fields ?? {})) {
    if (column === null) {
      delete fields[fieldId];
      delete scores[fieldId];
    } else if (profile.columns.some((c) => c.name === column)) {
      // A column can only serve one field: remove it (and its score) from any other field first.
      for (const [f, c] of Object.entries(fields)) {
        if (c === column && f !== fieldId) {
          delete fields[f];
          delete scores[f];
        }
      }
      fields[fieldId] = column;
      scores[fieldId] = 1;
    }
  }
  const classes: Record<string, string[]> = {};
  for (const fieldId of Object.keys(domain.valueClasses ?? {})) {
    const column = fields[fieldId];
    const values = column ? distinctValues(profile, column) : [];
    Object.assign(classes, resolveClassesForField(domain, fieldId, values));
  }
  for (const [key, values] of Object.entries(overrides.classes ?? {})) {
    if (key in classes || Object.keys(domain.valueClasses ?? {}).some((f) => key.startsWith(`${f}.`)))
      classes[key] = [...values];
  }
  return { fields, scores, classes };
}
