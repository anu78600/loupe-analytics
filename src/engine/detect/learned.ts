/**
 * Words the user taught Loupe ("Remember 'Net Amt' as Net revenue"), as extra
 * synonyms for a registry field. The store keeps them in this browser
 * (store/learned.ts); the session receives them with each file it reads and
 * matches fields against a copy of the domains that lists them
 * (withLearnedSynonyms), so a learned header both fills its field and counts
 * as evidence for that field's industry, exactly like a synonym in the
 * registry JSON. The registry itself is never changed: every domain or field
 * that gains a word is a new object, and with no words the domains come back
 * as they are, so detection without learned words is unchanged.
 */
import type { DomainDef } from "@/registry/schema";

/** A header the user mapped to a field by hand and asked Loupe to remember for future files. */
export interface LearnedSynonym {
  domainId: string;
  fieldId: string;
  /** The header as written in the file it was learned from. */
  header: string;
}

/**
 * The domains with each learned header added to its field's synonyms (after
 * the registry's own, so they never change which registry synonym a column
 * matches best). Words for an unknown domain or field, blank headers and
 * headers the field already lists are ignored. Domains and fields without a
 * new word are the same objects as before.
 */
export function withLearnedSynonyms(
  domains: readonly DomainDef[],
  words: readonly LearnedSynonym[],
): DomainDef[] {
  if (!words.length) return [...domains];
  // Domain id → field id → headers, in the order they were taught.
  const byDomain = new Map<string, Map<string, string[]>>();
  for (const w of words) {
    const header = w.header.trim();
    if (!header) continue;
    let fields = byDomain.get(w.domainId);
    if (!fields) byDomain.set(w.domainId, (fields = new Map()));
    const list = fields.get(w.fieldId) ?? [];
    if (!list.includes(header)) list.push(header);
    fields.set(w.fieldId, list);
  }
  return domains.map((d) => {
    const extra = byDomain.get(d.id);
    if (!extra) return d;
    let changed = false;
    const fields = d.fields.map((f) => {
      const taught = extra.get(f.id);
      if (!taught) return f;
      const known = new Set([f.label, ...f.synonyms].map((s) => s.toLowerCase()));
      const add = taught.filter((h) => !known.has(h.toLowerCase()));
      if (!add.length) return f;
      changed = true;
      return { ...f, synonyms: [...f.synonyms, ...add] };
    });
    return changed ? { ...d, fields } : d;
  });
}
