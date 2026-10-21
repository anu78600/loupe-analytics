/**
 * Scores how well each column fits each registry field, then assigns fields to columns.
 *
 * score = name similarity (best of the field's label and synonyms, via
 * profile/names.ts: tokens with abbreviations expanded and plurals folded,
 * then exact, all-tokens or Jaro-Winkler matching) × role
 * compatibility, plus a capped bonus when the column's values contain the
 * field's value hints. A column may also match on values alone. An
 * `exclude` token in the column name multiplies a synonym's similarity by 0.3
 * unless that synonym contains the token itself. A synonym made only of
 * generic words ("total", "free", "amount") never matches on its own a column
 * that adds words it doesn't explain, unless the column's profile confirms
 * the field's kind ("Order Total" is money; "total sulfur dioxide" is a
 * reading, so no industry reads it as revenue). Pairs scoring at least
 * MATCH_THRESHOLD are assigned greedily, one to one.
 *
 * KPI names are matched here too (matchKpiNames): a measure column's header,
 * or a tall scorecard's metric name, against each KPI's name, short name and
 * aliases. Detection reads those matches as evidence of the KPI's industry.
 */
import type { ColumnProfile, DatasetProfile, SemanticRole } from "@/engine/profile/types";
import {
  GENERIC_TOKENS,
  isGenericPhrase,
  jaroWinkler,
  nameSimilarity,
  phraseTokens,
  tokenize,
} from "@/engine/profile/names";
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
 * Words a synonym can be made of and still say nothing about what a column
 * holds: names.ts's GENERIC_TOKENS ("total", "amount", "value", "net",
 * "date", "status", "type", "name"…) and a few more amount words.
 */
const GENERIC_SYNONYM_WORDS: ReadonlySet<string> = new Set([
  ...GENERIC_TOKENS,
  "free",
  "price",
  "cost",
  "sum",
  "quantity",
  "grand",
  "sub",
]);

/**
 * Words a column may add to a generic synonym without naming something else:
 * units, money marks, scale and period words, plan and actual words,
 * stopwords and the generic modifiers ("Grand Total", "Net Amount", "Total
 * (₹)", "Amount (₹ Lakh)", "YTD Cost", "Target Qty").
 */
const QUALIFYING_WORDS: ReadonlySet<string> = new Set([
  // money and scale
  "money",
  "thousand",
  "lakh",
  "crore",
  "million",
  "billion",
  // units
  "kg",
  "lb",
  "lbs",
  "gram",
  "tonne",
  "litre",
  "km",
  "mile",
  "sqft",
  "sqm",
  "cubicmetre",
  "kwh",
  "mwh",
  "kw",
  "mw",
  "gb",
  "mb",
  "tb",
  "piece",
  "percent",
  "hour",
  "minute",
  "second",
  "sec",
  "min",
  "hr",
  "utc",
  "gmt",
  "ist",
  // periods
  "day",
  "days",
  "week",
  "month",
  "year",
  "quarter",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
  "annual",
  "annualised",
  "annualized",
  "ytd",
  "mtd",
  "qtd",
  "ttm",
  "ltm",
  "fy",
  // plan and actual
  "target",
  "budget",
  "plan",
  "forecast",
  "quota",
  "actual",
  "act",
  "achievement",
  "achieved",
  "ach",
  "ly",
  "py",
  "ty",
  "cy",
  // stopwords
  "of",
  "the",
  "a",
  "an",
  "in",
  "on",
  "at",
  "by",
  "for",
  "to",
  "from",
  "and",
  "or",
  "with",
  // generic modifiers
  "net",
  "gross",
  "grand",
  "sub",
  "final",
  "total",
]);

/**
 * The column's words a synonym leaves unexplained, when the synonym is made
 * only of generic words and every one of them is in the column: "sulfur" and
 * "dioxide" for "total sulfur dioxide" against "total". Words the synonym
 * spells almost the same way (Jaro–Winkler ≥ 0.93, five letters or more),
 * qualifying words and bare numbers are explained. Empty when the synonym
 * names something specific or the column adds nothing that matters.
 */
function unexplainedWords(col: ColumnProfile, synonym: string): string[] {
  const syn = phraseTokens(synonym).filter((t) => !QUALIFYING_WORDS.has(t) || GENERIC_SYNONYM_WORDS.has(t));
  if (!syn.length || !syn.every((t) => GENERIC_SYNONYM_WORDS.has(t) || /^\d+$/.test(t))) return [];
  if (!syn.every((t) => col.tokens.includes(t))) return [];
  return col.tokens.filter(
    (t) =>
      !syn.includes(t) &&
      !QUALIFYING_WORDS.has(t) &&
      !/^\d+$/.test(t) &&
      !syn.some((s) => Math.min(s.length, t.length) >= 5 && jaroWinkler(s, t) >= 0.93),
  );
}

/**
 * The column's own profile says it holds the kind of figure the field holds:
 * money for a money field (it profiles as currency: a money word, mark or
 * symbol), an amount that adds up for any other numeric field (not a reading
 * that is averaged), a rate for a rate field, a date for a date field, and
 * the field's own role otherwise.
 */
function kindConfirmed(field: FieldDef, col: ColumnProfile): boolean {
  const roles = field.roles as SemanticRole[];
  if (col.storage === "date") return roles.includes("datetime");
  if (roles.includes("currency")) return col.role === "currency";
  if ((col.role === "rate" || col.role === "percentage") && roles.includes(col.role)) return true;
  if (roles.includes("measure"))
    return (col.role === "measure" || col.role === "currency") && col.additivity !== "non-additive";
  return roles.includes(col.role);
}

/**
 * Most a generic synonym's name similarity may reach when it leaves words of
 * the column unexplained and the column doesn't confirm the field's kind: a
 * hint that counts only with value evidence, as for a partial match in
 * nameSimilarity.
 */
const UNEXPLAINED_GENERIC = 0.35;

/**
 * Scores one field against one column. With a name match the score is
 * name × compatibility (+ the value bonus, capped at 1); a values-only match
 * needs a bonus of at least 0.2 and scores 0.35 × compatibility + bonus, so it
 * clears MATCH_THRESHOLD only with strong value evidence.
 *
 * A synonym made only of generic words ("total", "free", "net amount") says
 * nothing about a column that adds other words: "total sulfur dioxide" is
 * not a total amount and "free sulfur dioxide" not a free quantity. Such a
 * match stays below the threshold (UNEXPLAINED_GENERIC) unless the column's
 * own profile confirms the field's kind (kindConfirmed): "Order Total" is
 * money by its profile, so it still fills a money field, while a reading of
 * sulfur dioxide never does.
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
  let confirmed: boolean | undefined;
  for (const syn of [field.label, ...field.synonyms]) {
    let s = nameSimilarity(col.tokens, syn);
    if (s > 0 && excluded.length) {
      // An excluded token disqualifies the column unless this synonym names it itself.
      const synTokens = phraseTokens(syn);
      if (excluded.some((t) => !synTokens.includes(t))) s *= 0.3;
    }
    // A generic synonym explains a column that adds other words only when the column is that kind of figure.
    if (s > UNEXPLAINED_GENERIC && unexplainedWords(col, syn).length) {
      confirmed ??= kindConfirmed(field, col);
      if (!confirmed) s = UNEXPLAINED_GENERIC;
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

// ---------------------------------------------------------------- KPI names

/**
 * Name similarity at which a header or metric name counts as a KPI's name:
 * the KPI's words with up to two unit or qualifier words beside them ("AUM
 * (₹ Cr)" for AUM, "Collection Efficiency %" for collection efficiency), never
 * one distinctive word of a longer name ("Revenue Target" is not Revenue).
 */
export const KPI_NAME_THRESHOLD = 0.75;

/** A name detection reads as a possible KPI name: a measure column's header, or a scorecard's metric. */
export interface NameToRead {
  /** Evidence key: the column's name, or "<metric column>: <metric>" for a metric name. */
  key: string;
  /** The column the name comes from. */
  column: string;
  tokens: readonly string[];
  /** A metric name read from the values of a tall scorecard's metric column. */
  metric: boolean;
}

/** One header or metric name matched to one KPI of a domain. */
export interface KpiNameMatch {
  key: string;
  column: string;
  metric: boolean;
  kpiId: string;
  /** Best similarity over the KPI's name, short name and aliases. */
  score: number;
}

/** Roles of the columns whose headers may name a KPI: a KPI is a number, so only measures can. */
const KPI_COLUMN_ROLES: ReadonlySet<SemanticRole> = new Set(["measure", "currency", "percentage", "rate"]);

/**
 * Words that say which figure a scorecard's value column holds (the value,
 * the actual, the target, last year's, the year to date, a month) rather
 * than what it measures.
 */
const LAYOUT_WORDS: ReadonlySet<string> = new Set([
  "target",
  "budget",
  "plan",
  "forecast",
  "quota",
  "ly",
  "py",
  "ty",
  "cy",
  "achievement",
  "achieved",
  "ach",
  "act",
  "ytd",
  "mtd",
  "qtd",
  "fy",
  "variance",
  "var",
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
]);

/**
 * The columns field matching reads. A tall scorecard's value columns named
 * only with layout words ("Value", "Target", "Actual", "YTD Budget", "Sep-26
 * Actual") hold the figures of every metric, so their names describe the
 * scorecard's layout, not the industry it serves: an industry with "amount"
 * and "budget" fields would otherwise claim every scorecard. Its metric names
 * are read as KPI names instead (namesToRead). A value column named for what
 * it measures ("Impressions") is still that industry's vocabulary.
 */
export function matchableColumns(profile: DatasetProfile): readonly ColumnProfile[] {
  const values = new Set(profile.tall?.valueColumns ?? []);
  if (!values.size) return profile.columns;
  const layout = (c: ColumnProfile) =>
    values.has(c.name) &&
    c.tokens.every((t) => LAYOUT_WORDS.has(t) || GENERIC_TOKENS.has(t) || /^\d+$/.test(t));
  return profile.columns.filter((c) => !layout(c));
}

/**
 * The names a file offers as KPI names: the header of every measure column
 * that is not almost entirely blank (a scorecard's value columns aside, see
 * matchableColumns) and, when the profile found a tall scorecard whose metric
 * column is still in the profile (not hidden), each of its metric names.
 */
export function namesToRead(profile: DatasetProfile): NameToRead[] {
  const out: NameToRead[] = matchableColumns(profile)
    .filter((c) => c.storage === "number" && KPI_COLUMN_ROLES.has(c.role) && c.nullPct < 0.999)
    .map((c) => ({ key: c.name, column: c.name, tokens: c.tokens, metric: false }));
  const tall = profile.tall;
  if (tall && profile.columns.some((c) => c.name === tall.metricColumn))
    for (const m of tall.metrics)
      out.push({
        key: `${tall.metricColumn}: ${m}`,
        column: tall.metricColumn,
        tokens: tokenize(m),
        metric: true,
      });
  return out;
}

/**
 * Words a header may add to a KPI's name and still name that KPI: the
 * generic ones (units, currency, scale, "average", "total", "%"), periods
 * ("Monthly Attrition %", "YTD Revenue"), plan and outcome words ("GNPA %
 * Target", "ARPU LY") and stopwords.
 */
const KPI_QUALIFIERS: ReadonlySet<string> = new Set([
  "target",
  "budget",
  "plan",
  "forecast",
  "quota",
  "ly",
  "py",
  "ty",
  "cy",
  "achievement",
  "achieved",
  "ach",
  "act",
  "monthly",
  "annual",
  "annualised",
  "annualized",
  "yearly",
  "quarterly",
  "weekly",
  "daily",
  "ytd",
  "mtd",
  "qtd",
  "ttm",
  "ltm",
  "opening",
  "closing",
  "of",
  "the",
  "a",
  "an",
  "in",
  "on",
  "at",
  "by",
  "for",
  "to",
  "from",
  "and",
  "with",
]);

/**
 * True when every word of the header is a word of the phrase, a qualifier
 * (KPI_QUALIFIERS, GENERIC_TOKENS, a bare number) or another spelling of one
 * of the phrase's words ("utilization" for "utilisation"). nameSimilarity
 * forgives up to two extra words of any kind; a KPI name must not, since an
 * extra distinctive word names something else ("New SB Accounts Opened" is
 * not SaaS's new accounts, "Bed Occupancy %" not a hotel's occupancy).
 */
function addsOnlyQualifiers(header: readonly string[], phrase: string): boolean {
  const own = phraseTokens(phrase);
  return header.every(
    (t) =>
      own.includes(t) ||
      KPI_QUALIFIERS.has(t) ||
      GENERIC_TOKENS.has(t) ||
      /^\d+$/.test(t) ||
      own.some((o) => Math.min(o.length, t.length) >= 5 && jaroWinkler(o, t) >= 0.93),
  );
}

/**
 * The domain's KPIs whose name, short name or an alias the given names match
 * (similarity at least KPI_NAME_THRESHOLD, adding only qualifier words),
 * assigned one to one, best match first: a KPI explains one name and a name
 * evidences one KPI. Hidden helper KPIs and phrases made only of generic
 * words are not read.
 */
export function matchKpiNames(domain: DomainDef, names: readonly NameToRead[]): KpiNameMatch[] {
  if (!names.length) return [];
  const found: KpiNameMatch[] = [];
  for (const k of domain.kpis) {
    if (k.hidden) continue;
    const phrases = [k.name, ...(k.short ? [k.short] : []), ...(k.aliases ?? [])].filter(
      (p) => !isGenericPhrase(p),
    );
    for (const n of names) {
      let best = 0;
      for (const p of phrases) {
        const s = nameSimilarity(n.tokens, p);
        if (s > best && (s >= 1 || addsOnlyQualifiers(n.tokens, p))) best = s;
        if (best >= 1) break;
      }
      if (best >= KPI_NAME_THRESHOLD)
        found.push({ key: n.key, column: n.column, metric: n.metric, kpiId: k.id, score: best });
    }
  }
  found.sort((a, b) => b.score - a.score);
  const usedKpis = new Set<string>();
  const usedNames = new Set<string>();
  const out: KpiNameMatch[] = [];
  for (const m of found) {
    if (usedKpis.has(m.kpiId) || usedNames.has(m.key)) continue;
    usedKpis.add(m.kpiId);
    usedNames.add(m.key);
    out.push(m);
  }
  return out;
}
