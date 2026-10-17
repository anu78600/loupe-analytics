/**
 * Plan and outcome measures that belong together: a target, budget, plan,
 * forecast, quota or last-year figure beside the actual figure it is measured
 * against ("Target (₹ Lakh)" and "Achievement (₹ Lakh)", "Umsatz Plan" and
 * "Umsatz Ist", "Sales LY" and "Sales TY"). Profiling records the pairs; the
 * KPI layer (kpi/columnKpis.ts pairKpis, used by the generic fallback too)
 * turns each into attainment (actual ÷ plan, a ratio of sums) and variance
 * (actual − plan), or growth vs last year.
 *
 * The rule is deliberately strict, so a pair is only claimed where the
 * headers say so:
 * - one column carries exactly one plan word (target, budget, plan,
 *   forecast, quota, last year, or the forms tokenize translates: soll,
 *   lakshya, meta, objetivo, presupuesto…; previsto is read here);
 * - the other carries an outcome word (actual, achievement, achieved, ist,
 *   real, realizado, current, CY, TY…) or none at all;
 * - once those words are set aside, the two headers' canonical tokens
 *   (profile/names.ts tokenize, so "Rev" and "Revenue", "Umsatz" and
 *   "revenue" agree) are the same words, units and scale included, so "(₹
 *   Lakh)" never pairs with "(₹ Cr)";
 * - both are measures of one kind: amounts with amounts (money or plain
 *   numbers, as "Budget" reads as money by its name while "Actual" does
 *   not), percentages with percentages written the same way, rates with
 *   rates; two currencies seen in the values must agree.
 * Two plan columns never pair, and a column that names a comparison
 * ("Variance", "vs LY", "Growth", "Attainment") or two plan kinds ("Budget
 * LY") pairs with nothing. The plan words "plan", "goal" and "objective" also
 * name other things (a subscription plan, a football goal, a campaign
 * objective), so they pair only with a column that says "actual" or another
 * outcome word.
 */
import { tokenize } from "./names";
import type { ColumnPair, ColumnProfile } from "./types";

type PlanKind = ColumnPair["kind"];

/**
 * Canonical tokens that name a plan figure, and its kind. Translated words
 * arrive already in English (objetivo, objectif, Ziel, lakshya → target;
 * presupuesto, bajat → budget; Soll in a German header → target), so only
 * forms tokenize leaves as written are listed besides the English ones.
 */
const PLAN_WORDS: ReadonlyMap<string, PlanKind> = new Map<string, PlanKind>([
  ["target", "target"],
  ["tgt", "target"],
  ["trgt", "target"],
  ["goal", "target"],
  ["objective", "target"],
  ["soll", "target"],
  ["budget", "budget"],
  ["budgeted", "budget"],
  ["bgt", "budget"],
  ["bud", "budget"],
  ["orcado", "budget"],
  ["orcada", "budget"],
  ["presupuestado", "budget"],
  ["plan", "plan"],
  ["planned", "plan"],
  ["previsto", "plan"],
  ["prevista", "plan"],
  ["planificado", "plan"],
  ["planejado", "plan"],
  ["geplant", "plan"],
  ["forecast", "forecast"],
  ["fcst", "forecast"],
  ["projected", "forecast"],
  ["projection", "forecast"],
  ["outlook", "forecast"],
  ["prognose", "forecast"],
  ["quota", "quota"],
  ["ly", "last year"],
  ["py", "last year"],
  ["sply", "last year"],
  ["vorjahr", "last year"],
]);

/** Plan words that also name other things; they pair only with an explicit outcome word. */
const AMBIGUOUS_PLAN = new Set(["plan", "goal", "objective"]);

/** Several-word plan phrases (canonical tokens), longest first: last year in its usual spellings. */
const PLAN_PHRASES: ReadonlyArray<readonly [readonly string[], PlanKind]> = [
  [["same", "period", "last", "year"], "last year"],
  [["last", "year"], "last year"],
  [["prior", "year"], "last year"],
  [["previous", "year"], "last year"],
  [["prev", "year"], "last year"],
  [["last", "fy"], "last year"],
  [["prior", "fy"], "last year"],
  [["previous", "fy"], "last year"],
  [["year", "ago"], "last year"],
  [["year", "anterior"], "last year"],
  [["year", "precedente"], "last year"],
  [["n", "1"], "last year"],
];

/** Canonical tokens that name the outcome figure. Realizado, réalisé, effettivo, Ist (in German) arrive as "actual". */
const OUTCOME_WORDS = new Set([
  "actual",
  "act",
  "achievement",
  "achieved",
  "ach",
  "achv",
  "achvd",
  "ist",
  "real",
  "realised",
  "realized",
  "current",
  "cy",
  "ty",
]);

/** Several-word outcome phrases (canonical tokens). */
const OUTCOME_PHRASES: ReadonlyArray<readonly string[]> = [
  ["this", "year"],
  ["current", "year"],
  ["this", "fy"],
  ["current", "fy"],
];

/** Words of a column that compares or derives figures rather than holding one. */
const DERIVED_WORDS = new Set([
  "variance",
  "var",
  "difference",
  "diff",
  "gap",
  "delta",
  "deviation",
  "shortfall",
  "surplus",
  "deficit",
  "excess",
  "growth",
  "change",
  "attainment",
  "vs",
  "versus",
  // "Sales v LY" compares the two.
  "v",
]);

/** Words left out when two headers' remaining words are compared. */
const IGNORED = new Set(["of", "the", "a", "an", "in", "on", "at", "by", "for", "to", "and"]);

/** Tokens that only state a unit or a scale; a label leaves them out. */
const UNIT_TOKENS = new Set(["money", "thousand", "lakh", "crore", "million", "billion"]);

/** What a header says about plans and outcomes, and the words left once those are set aside. */
interface HeaderReading {
  plans: PlanKind[];
  /** The plan words found, as canonical tokens (to tell the ambiguous ones). */
  planWords: string[];
  outcome: boolean;
  derived: boolean;
  /** The remaining canonical tokens, sorted, stopwords left out. */
  rest: string[];
}

const startsWith = (tokens: readonly string[], at: number, phrase: readonly string[]): boolean =>
  phrase.every((t, j) => tokens[at + j] === t);

/** Reads one header's canonical tokens. */
function readTokens(tokens: readonly string[]): HeaderReading {
  const out: HeaderReading = { plans: [], planWords: [], outcome: false, derived: false, rest: [] };
  for (let i = 0; i < tokens.length;) {
    const plan = PLAN_PHRASES.find(([p]) => startsWith(tokens, i, p));
    if (plan) {
      out.plans.push(plan[1]);
      out.planWords.push(plan[0].join(" "));
      i += plan[0].length;
      continue;
    }
    const outcome = OUTCOME_PHRASES.find((p) => startsWith(tokens, i, p));
    if (outcome) {
      out.outcome = true;
      i += outcome.length;
      continue;
    }
    const t = tokens[i] as string;
    const kind = PLAN_WORDS.get(t);
    if (kind) {
      out.plans.push(kind);
      out.planWords.push(t);
    } else if (OUTCOME_WORDS.has(t)) out.outcome = true;
    else if (DERIVED_WORDS.has(t)) out.derived = true;
    else if (!IGNORED.has(t)) out.rest.push(t);
    i++;
  }
  out.rest.sort();
  return out;
}

/**
 * Which measures may be compared: "amount" for money and plain numbers
 * (a "Budget" header reads as money by its name, "Actual" as a number),
 * percentages by how they are written, rates on their own.
 */
function unitOf(c: ColumnProfile): string | null {
  if (c.role === "currency" || c.role === "measure") return "amount";
  if (c.role === "percentage") return `percent:${c.percentScale ?? 100}`;
  if (c.role === "rate") return "rate";
  return null;
}

const sameWords = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((t, i) => t === b[i]);

/** Two measures that may be compared: one kind of unit, and no two different currencies in the values. */
function compatible(a: ColumnProfile, b: ColumnProfile): boolean {
  const u = unitOf(a);
  if (u === null || u !== unitOf(b)) return false;
  return !(a.currency && b.currency && a.currency !== b.currency);
}

/**
 * The words the two headers share, as the actual column writes them: each of
 * its words is kept when its own tokens are among the shared ones (units and
 * scale aside), so "Umsatz Ist (€)" gives "Umsatz" and "Target (₹ Lakh)"
 * with "Achievement (₹ Lakh)" gives "" (they share only the unit).
 */
function sharedLabel(header: string, rest: readonly string[]): string {
  const wanted = new Map<string, number>();
  for (const t of rest) if (!UNIT_TOKENS.has(t)) wanted.set(t, (wanted.get(t) ?? 0) + 1);
  const words = header
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-–—/|:,;()[\]{}]+/)
    .filter(Boolean);
  const kept: string[] = [];
  for (const w of words) {
    const own = tokenize(w);
    const hit = own.find((t) => (wanted.get(t) ?? 0) > 0);
    if (hit === undefined) continue;
    wanted.set(hit, (wanted.get(hit) ?? 0) - 1);
    kept.push(w);
  }
  return kept.join(" ").trim();
}

/** Candidate measure columns: numbers with a measure-like role that are not entirely blank. */
const isMeasure = (c: ColumnProfile): boolean =>
  c.storage === "number" &&
  (c.role === "measure" || c.role === "currency" || c.role === "percentage" || c.role === "rate") &&
  c.nullPct < 1;

/**
 * The plan/outcome pairs among the measure columns, strongest first: pairs
 * whose actual column says so explicitly ("Revenue Actual") before those
 * whose actual column is bare ("Revenue"), then pairs with a label, then in
 * column order. Each plan column pairs with at most one actual column; an
 * actual column may be measured against several plans (budget and last
 * year), one per kind.
 */
export function detectColumnPairs(cols: readonly ColumnProfile[]): ColumnPair[] {
  const read = cols.filter(isMeasure).map((c) => ({ c, r: readTokens(c.tokens) }));
  const plans = read.filter(({ r }) => r.plans.length === 1 && !r.outcome && !r.derived);
  const actuals = read.filter(({ r }) => r.plans.length === 0 && !r.derived);
  const found: Array<{ pair: ColumnPair; explicit: boolean; actual: number; target: number }> = [];
  for (const p of plans) {
    const kind = p.r.plans[0] as PlanKind;
    const ambiguous = AMBIGUOUS_PLAN.has(p.r.planWords[0] as string);
    const options = actuals.filter(
      (a) =>
        sameWords(a.r.rest, p.r.rest) &&
        (a.r.outcome || !ambiguous) &&
        compatible(a.c, p.c) &&
        // One plan of each kind per actual column: a second "Revenue Goal" beside "Revenue Target" is not paired.
        !found.some((f) => f.pair.actual === a.c.name && f.pair.kind === kind),
    );
    // An explicit outcome word beats a bare header; otherwise the first column wins.
    const best = options.find((a) => a.r.outcome) ?? options[0];
    if (!best) continue;
    found.push({
      pair: { actual: best.c.name, target: p.c.name, label: sharedLabel(best.c.name, best.r.rest), kind },
      explicit: best.r.outcome,
      actual: best.c.index,
      target: p.c.index,
    });
  }
  return found
    .sort(
      (a, b) =>
        Number(b.explicit) - Number(a.explicit) ||
        Number(b.pair.label !== "") - Number(a.pair.label !== "") ||
        a.actual - b.actual ||
        a.target - b.target,
    )
    .map((f) => f.pair);
}
