"use client";

/**
 * What Loupe has learned from the user's corrections, persisted to
 * localStorage ("loupe-learned") in this browser only, the way settings.ts
 * persists preferences. Nothing here is ever sent anywhere.
 *
 * Two kinds of memory:
 *  - Rules, one per kind of file. A rule is keyed by the file's header
 *    signature (each header read by tokenize() in profile/names.ts, as
 *    ColumnProfile.tokens holds it, de-duplicated and sorted) and records the
 *    corrections made on such a file: the industry and data shape chosen on
 *    Detect, field mappings and value meanings (per industry), column roles
 *    and hidden columns. A later file whose signature is the same, or shares
 *    at least SIMILAR_FILES of its headers (Jaccard), gets them back
 *    (applyRule), each column-level choice only when the file has that exact
 *    column. The session's own choices always win.
 *  - Words, taught in Check & map ("Remember 'Net Amt' as Net revenue"):
 *    extra synonyms for a field, sent with every file read so detection and
 *    mapping know them (engine/detect/learned.ts).
 *
 * Only header names and the choices made are stored, never cell values. A
 * value meaning stores the category labels the user put in it, which are the
 * user's own choices; Settings says so. Times are set in event handlers (the
 * workspace store's actions), never during render. At most MAX_RULES rules
 * and MAX_WORDS words are kept: beyond that, the ones least recently learned
 * or used go. Exported files and stored state are outside input, so both are
 * validated with zod (parseLearned, and `merge` on rehydration).
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { z } from "zod";
import { ROLE_LABEL, type Additivity, type SemanticRole } from "@/engine/profile/types";
import type { LearnedSynonym } from "@/engine/detect/learned";

/** Most rules kept; beyond this the ones least recently learned or used go. */
export const MAX_RULES = 300;
/** Most taught words kept, dropped the same way. */
export const MAX_WORDS = 300;
/** Share of header names two files must have in common (Jaccard) for a rule learned on one to apply to the other. */
export const SIMILAR_FILES = 0.8;

/** The industry and data shape chosen on Detect, with their names when learned (Settings reads them without the registry). */
export interface LearnedIndustry {
  domainId: string;
  subDomainId: string | null;
  name: string;
  /** Data shape name; null when the shape was left to detection. */
  shape: string | null;
}

/** A field mapping: the column (null = the user left the field unmapped) and the field's label. */
export interface LearnedField {
  column: string | null;
  label: string;
}

/** A value meaning: the category labels the user put in the class, and the class's label. */
export interface LearnedClass {
  values: string[];
  label: string;
}

export interface LearnedRole {
  role: SemanticRole;
  additivity?: Additivity;
}

/** The corrections learned on one kind of file. */
export interface LearnedRule {
  id: string;
  /** Normalised header names, de-duplicated and sorted (signatureOf). */
  signature: string[];
  /** Header names as written in the file the rule was last taught on, in file order. */
  columns: string[];
  /** Epoch ms when first learned. */
  learnedAt: number;
  /** Epoch ms of the last correction. */
  updatedAt: number;
  /** Epoch ms of the last time it was applied to a file; null until then. */
  usedAt: number | null;
  /** How many files it has been applied to. */
  uses: number;
  industry: LearnedIndustry | null;
  /** Industry id → field id → mapping. Field ids belong to an industry, so they are kept per industry. */
  fields: Record<string, Record<string, LearnedField>>;
  /** Industry id → "fieldId.classId" → value meaning. */
  classes: Record<string, Record<string, LearnedClass>>;
  /** Column name → role. */
  roles: Record<string, LearnedRole>;
  /** Hidden column names. */
  hidden: string[];
}

/** A word taught in Check & map: a header that means a field, for every future file. */
export interface LearnedWord {
  id: string;
  domainId: string;
  domainName: string;
  fieldId: string;
  fieldLabel: string;
  /** The header as written. */
  header: string;
  /** The header normalised (headerKey), to recognise it in later files. */
  key: string;
  learnedAt: number;
  usedAt: number | null;
  uses: number;
}

// ---------------------------------------------------------------- signatures

/** A header as Loupe reads it: its tokenize() tokens (ColumnProfile.tokens) joined by single spaces. */
export const headerKey = (tokens: readonly string[]): string => tokens.join(" ");

/** A file's header signature: every normalised header name, de-duplicated and sorted. Blank headers are left out. */
export function signatureOf(columns: ReadonlyArray<{ tokens: readonly string[] }>): string[] {
  return [...new Set(columns.map((c) => headerKey(c.tokens)).filter(Boolean))].sort();
}

/** Jaccard similarity of two signatures: shared header names over all header names (0 when both are empty). */
export function similarity(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const x of right) if (left.has(x)) shared++;
  const union = left.size + right.size - shared;
  return union ? shared / union : 0;
}

/**
 * The rule for a file: the one whose signature is most similar, at least
 * SIMILAR_FILES (the same signature scores 1); on a tie, the most recently
 * changed. Null when none is close enough.
 */
export function findRule(
  rules: readonly LearnedRule[],
  signature: readonly string[],
): { rule: LearnedRule; similarity: number } | null {
  let best: { rule: LearnedRule; similarity: number } | null = null;
  for (const rule of rules) {
    const s = similarity(rule.signature, signature);
    if (s < SIMILAR_FILES) continue;
    if (!best || s > best.similarity || (s === best.similarity && rule.updatedAt > best.rule.updatedAt))
      best = { rule, similarity: s };
  }
  return best;
}

// ---------------------------------------------------------------- applying

/** The choices the workspace sends to the engine (Session.configure), as far as a rule can set them. */
export interface LearnedChoices {
  domainId: string | null;
  subDomainId: string | null;
  mappingOverrides: Record<string, string | null>;
  classOverrides: Record<string, string[]>;
  roleOverrides: Record<string, LearnedRole>;
  hiddenColumns: string[];
}

/** What a rule set on a file: only what it changed, so Undo can take exactly that back. */
export interface AppliedRule {
  ruleId: string;
  industry: LearnedIndustry | null;
  mappings: Record<string, string | null>;
  classes: Record<string, string[]>;
  roles: Record<string, LearnedRole>;
  hidden: string[];
}

/** True when applying a rule changed nothing (everything in it was skipped or already so). */
export const appliedNothing = (a: AppliedRule): boolean =>
  !a.industry &&
  !Object.keys(a.mappings).length &&
  !Object.keys(a.classes).length &&
  !Object.keys(a.roles).length &&
  !a.hidden.length;

/**
 * Applies a rule to a file, the way the user's own overrides apply. The
 * session's choices win: the rule's industry only when the user has not
 * chosen one (`industryChosen`), and no mapping, value meaning or role the
 * session already sets. The industry applies only when `file.domains` knows
 * it; mappings and value meanings only those learned for the industry in
 * effect afterwards; roles, hidden columns and mappings to a column only
 * when the file has that exact column (otherwise that part is skipped).
 */
export function applyRule(
  rule: LearnedRule,
  file: { columns: readonly string[]; domains: readonly string[] },
  session: LearnedChoices & { industryChosen?: boolean },
): { choices: LearnedChoices; applied: AppliedRule } {
  const has = new Set(file.columns);
  const applied: AppliedRule = {
    ruleId: rule.id,
    industry: null,
    mappings: {},
    classes: {},
    roles: {},
    hidden: [],
  };
  let { domainId, subDomainId } = session;
  const ind = rule.industry;
  if (
    ind &&
    !session.industryChosen &&
    file.domains.includes(ind.domainId) &&
    // A learned shape of null means Auto: the same industry with detection's shape changes nothing.
    (ind.domainId !== domainId || (ind.subDomainId !== null && ind.subDomainId !== subDomainId))
  ) {
    domainId = ind.domainId;
    subDomainId = ind.subDomainId;
    applied.industry = ind;
  }
  const mappingOverrides = { ...session.mappingOverrides };
  const classOverrides = { ...session.classOverrides };
  if (domainId) {
    for (const [fieldId, f] of Object.entries(rule.fields[domainId] ?? {})) {
      if (Object.hasOwn(mappingOverrides, fieldId) || (f.column !== null && !has.has(f.column))) continue;
      mappingOverrides[fieldId] = f.column;
      applied.mappings[fieldId] = f.column;
    }
    for (const [key, c] of Object.entries(rule.classes[domainId] ?? {})) {
      if (Object.hasOwn(classOverrides, key)) continue;
      classOverrides[key] = [...c.values];
      applied.classes[key] = [...c.values];
    }
  }
  const roleOverrides = { ...session.roleOverrides };
  for (const [column, r] of Object.entries(rule.roles)) {
    if (Object.hasOwn(roleOverrides, column) || !has.has(column)) continue;
    roleOverrides[column] = { ...r };
    applied.roles[column] = { ...r };
  }
  const hiddenColumns = [...session.hiddenColumns];
  for (const column of rule.hidden) {
    if (!has.has(column) || hiddenColumns.includes(column)) continue;
    hiddenColumns.push(column);
    applied.hidden.push(column);
  }
  return {
    choices: { domainId, subDomainId, mappingOverrides, classOverrides, roleOverrides, hiddenColumns },
    applied,
  };
}

/** "3 column roles" style counts. */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What a rule set, in a phrase: "industry E-commerce, 3 column roles, 1 hidden column". */
export function describeApplied(a: AppliedRule): string {
  const parts: string[] = [];
  if (a.industry)
    parts.push(`industry ${a.industry.name}${a.industry.shape ? ` (${a.industry.shape})` : ""}`);
  const n = (o: object) => Object.keys(o).length;
  if (n(a.mappings)) parts.push(count(n(a.mappings), "field mapping", "field mappings"));
  if (n(a.classes)) parts.push(count(n(a.classes), "value meaning", "value meanings"));
  if (n(a.roles)) parts.push(count(n(a.roles), "column role", "column roles"));
  if (a.hidden.length) parts.push(count(a.hidden.length, "hidden column", "hidden columns"));
  return parts.join(", ");
}

/**
 * The session's choices without what a rule set (Undo for this file). An
 * entry the user has changed since is theirs and stays; the industry goes
 * back to `detected` only while it is still the rule's.
 */
export function undoApplied(
  choices: LearnedChoices,
  applied: AppliedRule,
  detected: { domainId: string; subDomainId: string | null },
): LearnedChoices {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const drop = <T>(from: Record<string, T>, took: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(from).filter(([k, v]) => !Object.hasOwn(took, k) || !same(v, took[k])));
  const ind = applied.industry;
  // A shape learned as Auto (null) is resolved when the analysis is built, so any shape counts then.
  const stillRules =
    ind &&
    choices.domainId === ind.domainId &&
    (ind.subDomainId === null || choices.subDomainId === ind.subDomainId);
  return {
    domainId: stillRules ? detected.domainId : choices.domainId,
    subDomainId: stillRules ? detected.subDomainId : choices.subDomainId,
    mappingOverrides: drop(choices.mappingOverrides, applied.mappings),
    classOverrides: drop(choices.classOverrides, applied.classes),
    roleOverrides: drop(choices.roleOverrides, applied.roles),
    hiddenColumns: choices.hiddenColumns.filter((c) => !applied.hidden.includes(c)),
  };
}

// ---------------------------------------------------------------- learning

/** A random id with a prefix ("lr_" rules, "lw_" words). */
function newId(prefix: string, now: number): string {
  return `${prefix}${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** A rule with nothing in it yet, for a file with this signature and these columns. */
export function newRule(signature: readonly string[], columns: readonly string[], now: number): LearnedRule {
  return {
    id: newId("lr_", now),
    signature: [...signature],
    columns: [...columns],
    learnedAt: now,
    updatedAt: now,
    usedAt: null,
    uses: 0,
    industry: null,
    fields: {},
    classes: {},
    roles: {},
    hidden: [],
  };
}

/** True when a rule holds no correction (it is then not kept). */
export const isEmptyRule = (r: LearnedRule): boolean =>
  !r.industry &&
  !Object.values(r.fields).some((f) => Object.keys(f).length) &&
  !Object.values(r.classes).some((c) => Object.keys(c).length) &&
  !Object.keys(r.roles).length &&
  !r.hidden.length;

/** Records the industry choice; null when the user went back to what detection found. */
export const teachIndustry = (r: LearnedRule, industry: LearnedIndustry | null): LearnedRule => ({
  ...r,
  industry,
});

/** Records a field mapping for an industry; null forgets it (the field is matched automatically again). */
export function teachField(
  r: LearnedRule,
  domainId: string,
  fieldId: string,
  f: LearnedField | null,
): LearnedRule {
  const fields = { ...r.fields[domainId] };
  if (f) fields[fieldId] = f;
  else delete fields[fieldId];
  const all = { ...r.fields, [domainId]: fields };
  if (!Object.keys(fields).length) delete all[domainId];
  return { ...r, fields: all };
}

/** Records a value meaning for an industry. */
export const teachClass = (r: LearnedRule, domainId: string, key: string, c: LearnedClass): LearnedRule => ({
  ...r,
  classes: { ...r.classes, [domainId]: { ...r.classes[domainId], [key]: { ...c, values: [...c.values] } } },
});

/** Records a column's role; null forgets it (back to the detected role). */
export function teachRole(r: LearnedRule, column: string, role: LearnedRole | null): LearnedRule {
  const roles = { ...r.roles };
  if (role) roles[column] = role;
  else delete roles[column];
  return { ...r, roles };
}

/** Records columns hidden, or shown again. */
export const teachHidden = (r: LearnedRule, columns: readonly string[], hidden: boolean): LearnedRule => ({
  ...r,
  hidden: hidden ? [...new Set([...r.hidden, ...columns])] : r.hidden.filter((c) => !columns.includes(c)),
});

/** When a rule or word was last learned or used: what the size cap keeps the newest of. */
const touched = (x: { learnedAt: number; usedAt: number | null; updatedAt?: number }): number =>
  Math.max(x.learnedAt, x.updatedAt ?? 0, x.usedAt ?? 0);

/** Newest first, without empty rules, at most `max`. */
export function keepRules(rules: readonly LearnedRule[], max = MAX_RULES): LearnedRule[] {
  return rules
    .filter((r) => !isEmptyRule(r))
    .sort((a, b) => touched(b) - touched(a))
    .slice(0, max);
}

/** The rules with `rule` added or replacing the one with its id; an empty rule is removed. */
export function withRule(rules: readonly LearnedRule[], rule: LearnedRule, max = MAX_RULES): LearnedRule[] {
  return keepRules([rule, ...rules.filter((r) => r.id !== rule.id)], max);
}

/** Newest first, at most `max`. */
export function keepWords(words: readonly LearnedWord[], max = MAX_WORDS): LearnedWord[] {
  return [...words].sort((a, b) => touched(b) - touched(a)).slice(0, max);
}

/** Same word: same field of the same industry, same header (ignoring case). */
const sameWord = (a: LearnedWord, b: Pick<LearnedWord, "domainId" | "fieldId" | "header">) =>
  a.domainId === b.domainId && a.fieldId === b.fieldId && a.header.toLowerCase() === b.header.toLowerCase();

/** The words with `word` added; teaching a known word again only refreshes its time. */
export function withWord(words: readonly LearnedWord[], word: LearnedWord, max = MAX_WORDS): LearnedWord[] {
  const old = words.find((w) => sameWord(w, word));
  const next = old ? { ...old, learnedAt: Math.max(old.learnedAt, word.learnedAt) } : word;
  return keepWords([next, ...words.filter((w) => w !== old)], max);
}

/** The words as the engine takes them (extra field synonyms). */
export const synonymsOf = (words: readonly LearnedWord[]): LearnedSynonym[] =>
  words.map((w) => ({ domainId: w.domainId, fieldId: w.fieldId, header: w.header }));

/** Records that a rule was applied to a file. */
export const markRuleUsed = (rules: readonly LearnedRule[], id: string, now: number): LearnedRule[] =>
  rules.map((r) => (r.id === id ? { ...r, usedAt: now, uses: r.uses + 1 } : r));

/** Records that a file has a header matching these words (by headerKey). */
export const markWordsUsed = (
  words: readonly LearnedWord[],
  keys: ReadonlySet<string>,
  now: number,
): LearnedWord[] => words.map((w) => (keys.has(w.key) ? { ...w, usedAt: now, uses: w.uses + 1 } : w));

// ---------------------------------------------------------------- reading back

/** "Order ID, Order Date, Net Amount…": the first few headers of the file a rule was learned on. */
export function columnsPreview(columns: readonly string[], max = 3): string {
  return columns.slice(0, max).join(", ") + (columns.length > max ? "…" : "");
}

/**
 * A rule in words, for Settings: what it does, part by part
 * (["E-commerce (Returns & refunds)", "Net Amount → Net revenue", "Discount as Measure", "Notes hidden"]).
 */
export function describeRule(r: LearnedRule): string[] {
  const parts: string[] = [];
  if (r.industry) parts.push(`${r.industry.name}${r.industry.shape ? ` (${r.industry.shape})` : ""}`);
  for (const fields of Object.values(r.fields))
    for (const f of Object.values(fields))
      parts.push(f.column === null ? `${f.label} left unmapped` : `${f.column} → ${f.label}`);
  for (const classes of Object.values(r.classes))
    for (const c of Object.values(classes))
      parts.push(`${c.label}: ${c.values.length ? c.values.join(", ") : "none"}`);
  for (const [column, role] of Object.entries(r.roles)) parts.push(`${column} as ${ROLE_LABEL[role.role]}`);
  if (r.hidden.length) parts.push(`${r.hidden.join(", ")} hidden`);
  return parts;
}

// ---------------------------------------------------------------- export and import

/** Longest header, label or value accepted from a file. */
const TEXT = 500;
const text = z.string().max(TEXT);
/** Names that would reach an object's prototype if used as a record key. */
const notReserved = (k: string) => k !== "__proto__" && k !== "constructor" && k !== "prototype";
/** A header used as a record key or list entry. */
const key = z.string().min(1).max(TEXT).refine(notReserved, "reserved name");
/** An industry, shape, field or value-class id ("fieldId.classId"). */
const idText = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{1,120}$/)
  .refine(notReserved, "reserved name");
const time = z.number().int().nonnegative();
const roleSchema = z.object({
  role: z.enum(Object.keys(ROLE_LABEL) as [SemanticRole, ...SemanticRole[]]),
  additivity: z.enum(["additive", "semi-additive", "non-additive"]).optional(),
});

const ruleSchema = z.object({
  id: z.string().regex(/^lr_[a-z0-9_]{1,60}$/),
  signature: z.array(text).max(5000),
  columns: z.array(text).max(5000),
  learnedAt: time,
  updatedAt: time,
  usedAt: time.nullable(),
  uses: time,
  industry: z
    .object({ domainId: idText, subDomainId: idText.nullable(), name: text, shape: text.nullable() })
    .nullable(),
  fields: z.record(idText, z.record(idText, z.object({ column: text.nullable(), label: text }))),
  classes: z.record(idText, z.record(idText, z.object({ values: z.array(text).max(5000), label: text }))),
  roles: z.record(key, roleSchema),
  hidden: z.array(key).max(5000),
});

const wordSchema = z.object({
  id: z.string().regex(/^lw_[a-z0-9_]{1,60}$/),
  domainId: idText,
  domainName: text,
  fieldId: idText,
  fieldLabel: text,
  header: key,
  key: text,
  learnedAt: time,
  usedAt: time.nullable(),
  uses: time,
});

const fileSchema = z.object({
  app: z.literal("loupe"),
  kind: z.literal("learned"),
  version: z.literal(1),
  exportedAt: z.string().max(64).optional(),
  rules: z.array(ruleSchema).max(MAX_RULES * 4),
  words: z.array(wordSchema).max(MAX_WORDS * 4),
});

/** What Loupe has learned, as a JSON file a team can share (header names and choices only). */
export function exportLearned(
  rules: readonly LearnedRule[],
  words: readonly LearnedWord[],
  now: number,
): string {
  return JSON.stringify(
    { app: "loupe", kind: "learned", version: 1, exportedAt: new Date(now).toISOString(), rules, words },
    null,
    2,
  );
}

/**
 * Reads an exported file. Anything malformed (not JSON, not a Loupe
 * learned-rules file, a wrong field anywhere) is rejected whole, with a
 * reason; nothing is half-imported.
 */
export function parseLearned(
  json: string,
): { ok: true; rules: LearnedRule[]; words: LearnedWord[] } | { ok: false; error: string } {
  let raw: unknown;
  // zod quietly drops a "__proto__" key from a record; such a file is malformed, so it is refused here.
  let reserved = false;
  try {
    raw = JSON.parse(json, (k, v: unknown) => {
      if (k === "__proto__") reserved = true;
      return v;
    });
  } catch {
    return { ok: false, error: "That file isn't JSON." };
  }
  const parsed = fileSchema.safeParse(raw);
  if (reserved || !parsed.success) {
    const issue = parsed.success ? undefined : parsed.error.issues[0];
    const where = issue?.path.length ? ` (at ${issue.path.join(".")})` : "";
    return { ok: false, error: `That isn't a Loupe file of learned rules${where}.` };
  }
  return { ok: true, rules: parsed.data.rules as LearnedRule[], words: parsed.data.words as LearnedWord[] };
}

/** Imported rules and words added to the current ones: an imported rule replaces one with its id; words merge. */
export function mergeLearned(
  current: { rules: readonly LearnedRule[]; words: readonly LearnedWord[] },
  incoming: { rules: readonly LearnedRule[]; words: readonly LearnedWord[] },
): { rules: LearnedRule[]; words: LearnedWord[] } {
  const ids = new Set(incoming.rules.map((r) => r.id));
  const rules = keepRules([...incoming.rules, ...current.rules.filter((r) => !ids.has(r.id))]);
  let words = [...current.words];
  for (const w of incoming.words) {
    const old = words.find((x) => sameWord(x, w));
    words = old
      ? words.map((x) => (x === old ? { ...old, uses: Math.max(old.uses, w.uses) } : x))
      : [...words, w];
  }
  return { rules, words: keepWords(words) };
}

/** Stored state is outside input too (an older version, a hand edit): every entry that fails the schema is dropped. */
function sanitise(persisted: unknown): { rules: LearnedRule[]; words: LearnedWord[] } {
  const p = (persisted ?? {}) as { rules?: unknown; words?: unknown };
  const list = <T>(v: unknown, schema: z.ZodType): T[] =>
    Array.isArray(v) ? v.filter((x) => schema.safeParse(x).success).map((x) => x as T) : [];
  return {
    rules: keepRules(list<LearnedRule>(p.rules, ruleSchema)),
    words: keepWords(list<LearnedWord>(p.words, wordSchema)),
  };
}

// ---------------------------------------------------------------- the store

interface LearnedState {
  rules: LearnedRule[];
  words: LearnedWord[];
  /** Adds or replaces a rule (by id); an empty rule is removed instead. */
  saveRule: (rule: LearnedRule) => void;
  removeRule: (id: string) => void;
  /** Records that a rule was applied to a file. `now` comes from the caller's event handler. */
  ruleUsed: (id: string, now: number) => void;
  /** Teaches a word. `now` comes from the caller's event handler. */
  addWord: (word: Omit<LearnedWord, "id" | "learnedAt" | "usedAt" | "uses">, now: number) => void;
  removeWord: (id: string) => void;
  /** Records that a file has headers matching these word keys. */
  wordsSeen: (keys: ReadonlySet<string>, now: number) => void;
  clearAll: () => void;
  /** Imports an exported file, adding to what is here; a malformed file changes nothing. */
  importJson: (json: string) => { ok: true; rules: number; words: number } | { ok: false; error: string };
}

export const useLearned = create<LearnedState>()(
  persist(
    (set, get) => ({
      rules: [],
      words: [],
      saveRule: (rule) => set((s) => ({ rules: withRule(s.rules, rule) })),
      removeRule: (id) => set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),
      ruleUsed: (id, now) => set((s) => ({ rules: markRuleUsed(s.rules, id, now) })),
      addWord: (word, now) =>
        set((s) => ({
          words: withWord(s.words, { ...word, id: newId("lw_", now), learnedAt: now, usedAt: null, uses: 0 }),
        })),
      removeWord: (id) => set((s) => ({ words: s.words.filter((w) => w.id !== id) })),
      wordsSeen: (keys, now) => {
        if (get().words.some((w) => keys.has(w.key)))
          set((s) => ({ words: markWordsUsed(s.words, keys, now) }));
      },
      clearAll: () => set({ rules: [], words: [] }),
      importJson: (json) => {
        const res = parseLearned(json);
        if (!res.ok) return res;
        set((s) => mergeLearned(s, res));
        return { ok: true, rules: res.rules.length, words: res.words.length };
      },
    }),
    {
      name: "loupe-learned",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ rules: s.rules, words: s.words }),
      merge: (persisted, current) => ({ ...current, ...sanitise(persisted) }),
    },
  ),
);
