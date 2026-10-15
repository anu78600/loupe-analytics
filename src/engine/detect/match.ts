/**
 * Scores how well each column fits each registry field, then assigns fields to columns.
 *
 * score = name similarity (best of the field's label and synonyms, via
 * profile/names.ts: tokens with abbreviations expanded and plurals folded,
 * then exact, all-tokens or Jaro-Winkler matching) × role
 * compatibility, plus a capped bonus when the column's values contain the
 * field's value hints. A column may also match on values alone. An
 * `exclude` token in the column name multiplies a synonym's similarity by 0.3
 * unless that synonym contains the token itself. Pairs scoring at least
 * MATCH_THRESHOLD are assigned greedily, one to one.
 */
import type { ColumnProfile, SemanticRole } from "@/engine/profile/types";
import { isGenericPhrase, nameSimilarity, phraseTokens } from "@/engine/profile/names";
import type { DomainDef, FieldDef } from "@/registry/schema";

/** A field-to-column score in [0, 1] and its parts, kept as detection evidence. */
export interface FieldScore {
  score: number;
  /** Best name similarity over the label and synonyms (after exclude penalties), before role compatibility. */
  nameScore: number;
  /** Value-hint bonus, 0–0.35. */
  valueScore: number;
  /**
   * Ranking strength, used only to order candidates: name × compatibility plus
   * the value bonus up to VALUE_TIE_CAP, not capped at 1, so value evidence
   * still separates two fields that both match the name perfectly ("Status"
   * with Vacant/Notice values: occupancy, not listing status); plus
   * LABEL_BONUS when the field's own label matches the column exactly.
   * Values-only matches rank by their score.
   */
  strength: number;
  /**
   * The best name match came from a label or synonym made only of generic
   * words ("name", "date", "status"): fine for mapping, weak evidence of
   * which industry a file belongs to.
   */
  generic: boolean;
  via: "name" | "values" | "name+values";
}

const STRINGISH: SemanticRole[] = ["identifier", "dimension", "geo", "text"];
const NUMERIC: SemanticRole[] = ["measure", "currency", "rate", "percentage"];

/**
 * How well a column's storage and inferred role suit a field's roles, 0–1:
 * 1 for a role match, 0 for impossible pairs (date vs non-date, text for a
 * numeric-only field) so they are never scored, partial credit for plausible
 * mismatches such as a numeric code used as a dimension or a 0/1 column as a flag.
 */
function compatibility(field: FieldDef, col: ColumnProfile): number {
  const roles = field.roles as SemanticRole[];
  if (roles.includes(col.role)) return 1;
  const wantsDate = roles.includes("datetime");
  const wantsNumber = roles.some((r) => NUMERIC.includes(r));
  const wantsBool = roles.includes("boolean");
  const wantsString = roles.some((r) => STRINGISH.includes(r));
  // A time of day is never a date field's column (and only a time field's, were there one).
  if (col.role === "time") return 0;
  if (col.storage === "date") return wantsDate ? 1 : 0;
  if (wantsDate) return 0;
  if (col.storage === "boolean") return wantsBool ? 1 : wantsString ? 0.5 : 0;
  if (wantsBool) {
    if (col.storage === "number" && col.numeric && col.numeric.min >= 0 && col.numeric.max <= 1) return 0.9;
    if (col.storage === "string" && col.distinct <= 3) return 0.7;
    return 0;
  }
  if (col.storage === "number") {
    if (wantsNumber) return col.role === "identifier" ? 0.4 : 0.85;
    if (roles.includes("identifier")) return col.role === "identifier" ? 1 : 0.55;
    if (wantsString) return col.role === "dimension" || col.role === "geo" ? 0.85 : 0.35;
    return 0.3;
  }
  // string column
  if (wantsNumber && !wantsString) return 0;
  if (wantsString) return 0.85;
  return 0.3;
}

/** Lower-case words separated by single spaces, padded with a space at each end for whole-word tests. */
const asWords = (s: string): string =>
  ` ${s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

/**
 * Bonus from the column's values: the share of rows whose value equals or
 * contains a hint (case-insensitive) × 0.4, capped at 0.35. Hints under five
 * characters (cod, upi, 4g, ups) must appear as a whole word, as for
 * value-class keywords in mapping.ts: as substrings they fire inside codes and
 * longer words ("sub_…eF4gH5…", "premium"). Uses the full value counts when
 * the profile has them, else the top values.
 */
function valueHintScore(field: FieldDef, col: ColumnProfile): number {
  if (!field.valueHints || !col.categorical) return 0;
  const values = col.categorical.all ?? col.categorical.top;
  if (!values.length) return 0;
  const hints = field.valueHints.map((h) => {
    const lower = h.toLowerCase();
    return { lower, word: lower.length < 5 ? asWords(lower) : null };
  });
  let hitRows = 0;
  let total = 0;
  let distinctHits = 0;
  for (const v of values) {
    total += v.count;
    const lower = v.value.toLowerCase();
    let words: string | null = null;
    const hit = hints.some((h) => {
      if (lower === h.lower) return true;
      if (h.word === null) return lower.includes(h.lower);
      words ??= asWords(lower);
      return words.includes(h.word);
    });
    if (hit) {
      hitRows += v.count;
      distinctHits++;
    }
  }
  if (!total) return 0;
  const share = hitRows / total;
  // Need at least two different recognised values to count as evidence.
  // A single recognised value still counts when it covers 90% of rows.
  if (distinctHits < 2 && share < 0.9) return 0;
  return Math.min(0.35, share * 0.4);
}

/**
 * Ranking bonus for a column named exactly like the field's label rather than
 * one of its later synonyms: of two columns that both match perfectly, the one
 * called "market_segment" beats "customer_type" for the market segment field.
 * Smaller than the rank's weight term between a core and a minor field, so a
 * minor field's label ("Customer name") cannot take a column from a core field
 * that lists the same words as a synonym.
 */
const LABEL_BONUS = 0.05;
/**
 * Most of the value bonus that counts towards ranking: value evidence breaks
 * ties between perfect name matches, but beyond this, wider hint coverage
 * says more about the hint list than about the column.
 */
const VALUE_TIE_CAP = 0.2;

/**
 * Scores one field against one column. With a name match the score is
 * name × compatibility (+ the value bonus, capped at 1); a values-only match
 * needs a bonus of at least 0.2 and scores 0.35 × compatibility + bonus, so it
 * clears MATCH_THRESHOLD only with strong value evidence.
 */
export function scoreField(field: FieldDef, col: ColumnProfile): FieldScore {
  const compat = compatibility(field, col);
  if (compat === 0)
    return { score: 0, nameScore: 0, valueScore: 0, strength: 0, generic: false, via: "name" };
  const excludeSet = field.exclude?.length ? new Set(field.exclude.flatMap((e) => phraseTokens(e))) : null;
  const excluded = excludeSet ? col.tokens.filter((t) => excludeSet.has(t)) : [];
  let nameScore = 0;
  let bestSynonym = "";
  let labelBest = false;
  for (const syn of [field.label, ...field.synonyms]) {
    let s = nameSimilarity(col.tokens, syn);
    if (s > 0 && excluded.length) {
      // An excluded token disqualifies the column unless this synonym names it itself.
      const synTokens = phraseTokens(syn);
      if (excluded.some((t) => !synTokens.includes(t))) s *= 0.3;
    }
    if (s > nameScore) {
      nameScore = s;
      bestSynonym = syn;
      labelBest = syn === field.label;
    }
    if (nameScore >= 1) break;
  }
  const valueScore = valueHintScore(field, col);
  let score: number;
  let strength: number;
  let via: FieldScore["via"] = "name";
  if (nameScore > 0 && valueScore > 0) {
    score = Math.min(1, nameScore * compat + valueScore);
    strength = nameScore * compat + Math.min(VALUE_TIE_CAP, valueScore);
    via = "name+values";
  } else if (nameScore > 0) score = strength = nameScore * compat;
  else if (valueScore >= 0.2) {
    score = strength = 0.35 * compat + valueScore;
    via = "values";
  } else score = strength = 0;
  if (labelBest && nameScore >= 1) strength += LABEL_BONUS;
  return {
    score,
    nameScore,
    valueScore,
    strength,
    generic: via === "name" && isGenericPhrase(bestSynonym),
    via,
  };
}

export interface FieldAssignment {
  fieldId: string;
  column: string;
  score: number;
  via: FieldScore["via"];
}

/** A field-column pair that cleared MATCH_THRESHOLD, before the one-to-one assignment. */
export interface MatchCandidate extends FieldAssignment {
  /** Field weight, 0–5. */
  weight: number;
  /** Uncapped strength × (1 + 4% per weight point): the assignment order. */
  rank: number;
  /** Matched by name only, through a generic-only synonym (FieldScore.generic). */
  generic: boolean;
}

/** Minimum score for a field-column pair to be considered at all. */
export const MATCH_THRESHOLD = 0.55;

/**
 * Every field-column pair scoring at least MATCH_THRESHOLD, best rank first.
 * Columns that are at least 99.9% blank are skipped. The rank multiplies the
 * uncapped strength by 1 + 4% per weight point, so on close scores value
 * evidence and then the more important field come first. Detection also reads
 * this list directly: it says which columns a domain could explain at all,
 * whichever field ends up assigned.
 */
export function matchCandidates(domain: DomainDef, columns: readonly ColumnProfile[]): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  for (const f of domain.fields) {
    for (const c of columns) {
      if (c.nullPct >= 0.999) continue;
      const s = scoreField(f, c);
      if (s.score >= MATCH_THRESHOLD) {
        candidates.push({
          fieldId: f.id,
          column: c.name,
          score: s.score,
          via: s.via,
          weight: f.weight,
          rank: s.strength * (1 + f.weight * 0.04),
          generic: s.generic,
        });
      }
    }
  }
  return candidates.sort((a, b) => b.rank - a.rank);
}

/**
 * Greedy one-to-one assignment of fields to columns in matchCandidates
 * order; the returned score is the capped, unweighted one.
 */
export function assignFields(domain: DomainDef, columns: readonly ColumnProfile[]): FieldAssignment[] {
  return assignCandidates(matchCandidates(domain, columns));
}

/** The one-to-one assignment step of assignFields, for callers that already have the candidates. */
export function assignCandidates(candidates: readonly MatchCandidate[]): FieldAssignment[] {
  const usedFields = new Set<string>();
  const usedCols = new Set<string>();
  const out: FieldAssignment[] = [];
  for (const c of candidates) {
    if (usedFields.has(c.fieldId) || usedCols.has(c.column)) continue;
    usedFields.add(c.fieldId);
    usedCols.add(c.column);
    out.push({ fieldId: c.fieldId, column: c.column, score: c.score, via: c.via });
  }
  return out;
}
