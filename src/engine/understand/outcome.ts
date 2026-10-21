/**
 * The outcome: the one column a table is measured by (version 49.0).
 *
 * Practice and analysis tables are built around one column: survived or
 * not, churned or not, a wine's quality, an iris's species, a house's sale
 * price, an order line's net amount. Loupe finds it from the profile alone,
 * best first:
 * - a yes/no column (a boolean, a 0/1 number or a two-value text column)
 *   named like an outcome ("Survived", "Churn", "Attrition", "is_fraud",
 *   "RainTomorrow"), or a status whose values name one ("Active"/"Exited");
 * - a score on a short whole-number scale named like a quality, grade or
 *   rating (tableShape's ordinal rule), where the rows are things measured;
 * - unordered classes (3–12) under a class, species, label or diagnosis name;
 * - an amount: in a table of entities with no timeline (one row per house,
 *   employee, customer), a result such as a price, salary, income, charges
 *   or yield; in a table of transactions, the main money measure.
 * Practice tables put the target last, so the last column gets a bonus. In a
 * table of transactions the main money measure outranks a yes/no column
 * whose name is an everyday event (returned, cancelled, clicked), and a
 * score is a feature there, not the outcome.
 *
 * Nothing is read from the rows except to pick which of a yes/no column's
 * two text values is "yes". outcomeTarget() then reads the column's rows into
 * the form the driver statistics need (drivers.ts).
 */
import type { Dataset } from "@/engine/core/types";
import { columnByName } from "@/engine/core/types";
import { friendly } from "@/engine/core/labels";
import type { ColumnProfile, DatasetProfile } from "@/engine/profile/types";
import { isRowIndex } from "@/engine/profile/roles";
import { ATTRIBUTE_DATE } from "@/engine/detect/tableShape";
import type { ColumnKind, OutcomeType } from "./types";

/** Name words of a yes/no outcome: what a practice table is built to explain. */
const STRONG_BINARY = new Set([
  "survived",
  "survival",
  "churn",
  "churned",
  "attrition",
  "default",
  "defaulted",
  "fraud",
  "fraudulent",
  "converted",
  "conversion",
  "outcome",
  "target",
  "label",
  "class",
  "y",
  "response",
  "responded",
  "approved",
  "approval",
  "readmitted",
  "readmission",
  "diagnosis",
  "exited",
  "left",
  "disease",
  "diabete",
  "diabetes",
  "stroke",
  "death",
  "died",
  "deceased",
  "failure",
  "spam",
  "subscribed",
  "hired",
  "placed",
  "admitted",
  "attrited",
]);
/**
 * Name words of a yes/no column that is an everyday event of a transaction
 * (returned, cancelled, clicked): the outcome of a table of entities or
 * cases, but only a flag beside the money in a table of transactions.
 */
const EVENT_BINARY = new Set([
  "returned",
  "cancelled",
  "canceled",
  "clicked",
  "purchased",
  "won",
  "passed",
  "failed",
  "refunded",
  "delivered",
]);
/** Generic outcome-ish names whose values must say what the outcome is ("Status": Active/Exited). */
const STATUS_WORDS = new Set(["status", "result", "flag", "state", "event"]);
/** Values of a yes/no column that name the event an outcome counts ("Exited", "Churned", "Malignant"). */
const EVENT_VALUES = new Set([
  "exited",
  "exit",
  "left",
  "churned",
  "churn",
  "attrited",
  "attrition",
  "terminated",
  "resigned",
  "defaulted",
  "default",
  "died",
  "dead",
  "deceased",
  "fraud",
  "fraudulent",
  "converted",
  "approved",
  "rejected",
  "declined",
  "readmitted",
  "cancelled",
  "canceled",
  "returned",
  "malignant",
  "survived",
  "won",
  "lost",
  "passed",
  "failed",
  "inactive",
  "closed",
]);
/** Values read as "yes" when a two-value text column has to be read as a rate. */
const POSITIVE_VALUES = new Set([
  "yes",
  "y",
  "true",
  "t",
  "1",
  "positive",
  "pos",
  ...EVENT_VALUES,
  "spam",
  "sick",
  "disease",
  "abnormal",
  "present",
  "clicked",
  "purchased",
]);
/** Name words of an unordered class outcome. */
const CLASS_WORDS = new Set(["species", "class", "label", "target", "outcome", "diagnosis", "variety"]);
/** Name words of a score on a short scale (tableShape's ordinal rule). */
const ORDINAL_WORDS = new Set(["quality", "grade", "rating", "score", "rank", "level"]);
/** Name words of the result a table of entities is about: a price, a salary, a yield. */
const RESULT_WORDS = new Set([
  "price",
  "saleprice",
  "salary",
  "income",
  "charge",
  "yield",
  "wage",
  "earning",
  "earnings",
  "compensation",
  "revenue",
  "sale",
  "profit",
  "premium",
  "rent",
  "value",
  "cost",
]);
/** Name words of a transaction's main money measure, strongest first. */
const MONEY_MAIN = [
  "revenue",
  "sale",
  "turnover",
  "gmv",
  "net",
  "amount",
  "total",
  "value",
  "actual",
  "income",
];
/** Name words of the parts and costs of a transaction, never its main measure. */
const MONEY_PART = new Set([
  "cost",
  "discount",
  "tax",
  "gst",
  "vat",
  "fee",
  "shipping",
  "freight",
  "commission",
  "budget",
  "target",
  "plan",
  "forecast",
  "quota",
  "refund",
  "opening",
  "mrp",
  "unitprice",
]);

const has = (c: ColumnProfile, set: ReadonlySet<string>) => c.tokens.some((t) => set.has(t));

/** A yes/no column: a boolean, a 0/1 number or a text column with exactly two values. */
export function isBinaryColumn(c: ColumnProfile): boolean {
  if (c.storage === "boolean") return true;
  if (c.storage === "number")
    return c.numeric?.integer === true && c.numeric.min === 0 && c.numeric.max === 1 && c.distinct === 2;
  return c.storage === "string" && c.distinct === 2;
}

/**
 * The value of a two-value text column that counts as "yes": a yes word or
 * the event the outcome names ("Exited", "Malignant", "M" beside "B"), else
 * the rarer of the two (the event is usually the exception). Null for any
 * other column.
 */
export function positiveValue(c: ColumnProfile): string | null {
  if (c.storage !== "string" || c.distinct !== 2) return null;
  const values = c.categorical?.all ?? c.categorical?.top ?? [];
  if (values.length !== 2) return null;
  const [a, b] = values as [{ value: string; count: number }, { value: string; count: number }];
  const norm = (v: string) => v.trim().toLowerCase();
  const pair = new Set([norm(a.value), norm(b.value)]);
  if (pair.has("m") && pair.has("b")) return norm(a.value) === "m" ? a.value : b.value;
  const yesA = POSITIVE_VALUES.has(norm(a.value));
  const yesB = POSITIVE_VALUES.has(norm(b.value));
  if (yesA !== yesB) return yesA ? a.value : b.value;
  // Neither or both: the rarer value (values come most frequent first), the second on a tie.
  return a.count < b.count ? a.value : b.value;
}

/** The label of "yes" in a yes/no column, as the file spells it ("Yes", "1", "Exited", "TRUE"). */
export function positiveLabel(c: ColumnProfile, ds: Dataset): string {
  const col = columnByName(ds, c.name);
  if (col?.kind === "boolean") return col.trueLabel;
  if (col?.kind === "number") return "1";
  return positiveValue(c) ?? "yes";
}

/**
 * The primary date when it says when rows happened: a real date (not a time
 * of day), not an attribute such as a hire or birth date, over two days or
 * more. A table with one is a table of transactions or readings; one
 * without is a table of entities or cases.
 */
export function timelineOf(profile: DatasetProfile): ColumnProfile | null {
  const date = profile.primaryDate ? profile.columns.find((c) => c.name === profile.primaryDate) : undefined;
  if (!date || date.storage !== "date" || date.role !== "datetime") return null;
  if (date.tokens.some((t) => ATTRIBUTE_DATE.has(t))) return null;
  return (date.temporal?.distinctDays ?? 0) >= 2 ? date : null;
}

/** One column that could be the outcome, with its type, its score and why. */
export interface OutcomeCandidate {
  column: ColumnProfile;
  type: OutcomeType;
  score: number;
  why: string;
}

/** A short-scale whole-number score named like a quality or grade (tableShape's ordinal rule). */
function ordinalLike(c: ColumnProfile): boolean {
  const n = c.numeric;
  return (
    c.storage === "number" &&
    (c.role === "measure" || c.role === "rate") &&
    n?.integer === true &&
    n.min >= 0 &&
    n.max <= 10 &&
    c.distinct >= 3 &&
    c.distinct <= 11 &&
    c.nullPct < 0.05 &&
    has(c, ORDINAL_WORDS)
  );
}

/** The column's name as a sentence reads it. */
const named = (c: ColumnProfile) => friendly(c.name);

/**
 * Every column that could be the table's outcome, best first (see the file
 * header for the rules and their order). `kinds` are the kinds the user
 * set: a column read as an ID, text or a place is never an outcome, and one
 * read as a score is a score outcome.
 */
export function outcomeCandidates(
  profile: DatasetProfile,
  kinds: Readonly<Record<string, ColumnKind>> = {},
): OutcomeCandidate[] {
  const transactional = timelineOf(profile) !== null;
  const last = profile.columns[profile.columns.length - 1];
  const out: OutcomeCandidate[] = [];
  const plan = new Set(profile.pairs.map((p) => p.target));
  for (const c of profile.columns) {
    const kind = kinds[c.name];
    if (kind === "id" || kind === "text" || kind === "place" || kind === "time") continue;
    if (c.role === "identifier" || c.role === "text" || c.role === "datetime" || c.role === "time") continue;
    if (c.nullPct > 0.5 || c.distinct < 2) continue;
    const bonus = c === last ? 2 : 0;
    const where = c === last ? " It is the last column, where practice tables put what they predict." : "";
    if (isBinaryColumn(c)) {
      const strong = has(c, STRONG_BINARY);
      const event = has(c, EVENT_BINARY);
      const values = (c.categorical?.all ?? []).map((v) => v.value.trim().toLowerCase());
      const eventValue = values.some((v) => EVENT_VALUES.has(v)) && has(c, STATUS_WORDS);
      // RainTomorrow: what happens next, the classic weather target.
      const next = c.tokens.includes("tomorrow");
      if (strong || next) {
        out.push({
          column: c,
          type: "binary",
          score: 10 + bonus,
          why: `${named(c)} is a yes/no column named like an outcome, so the table is read as the rate of yes.${where}`,
        });
        continue;
      }
      if (event || eventValue) {
        out.push({
          column: c,
          type: "binary",
          score: (transactional ? 7 : 8) + bonus,
          why: eventValue
            ? `${named(c)} has two values, one of them an outcome (${positiveValue(c) ?? "yes"}), so the table is read as how often it happens.${where}`
            : `${named(c)} is a yes/no column named after an event, so the table is read as how often it happens.${where}`,
        });
        continue;
      }
    }
    if (kind === "score" || ordinalLike(c)) {
      out.push({
        column: c,
        type: "ordinal",
        score: (transactional ? 3 : 6) + bonus,
        why: `${named(c)} is a score on a short ${c.numeric ? `${c.numeric.min}–${c.numeric.max} ` : ""}scale, so the table is read as what goes with a higher or lower score.${where}`,
      });
      continue;
    }
    if (
      c.storage === "string" &&
      (c.role === "dimension" || kind === "category") &&
      c.distinct >= 3 &&
      c.distinct <= 12 &&
      c.nullPct < 0.05 &&
      has(c, CLASS_WORDS)
    ) {
      out.push({
        column: c,
        type: "class",
        score: 6 + bonus,
        why: `${named(c)} labels each row with one of ${c.distinct} classes, so the table is read as what sets the classes apart.${where}`,
      });
      continue;
    }
    if (c.storage !== "number" || !c.numeric) continue;
    if (c.role !== "currency" && c.role !== "measure") continue;
    if (kind && kind !== "amount" && kind !== "measurement") continue;
    if (plan.has(c.name) || has(c, MONEY_PART)) continue;
    if (!transactional && has(c, RESULT_WORDS)) {
      out.push({
        column: c,
        type: "amount",
        score: 6.5 + bonus,
        why: `${named(c)} is the result each row is measured by (a price, a salary, a yield) in a table of cases with no timeline, so the table is read as what goes with a higher or lower ${named(c)}.${where}`,
      });
      continue;
    }
    if (transactional && c.role === "currency" && c.additivity !== "non-additive") {
      const rank = MONEY_MAIN.findIndex((w) => c.tokens.includes(w));
      out.push({
        column: c,
        type: "amount",
        // Revenue or sales first, then a net figure, an amount or a total; any other money last.
        score: 9 - (rank < 0 ? MONEY_MAIN.length : rank) * 0.1,
        why: `${named(c)} is the main money figure of a table of transactions, so the table is read as what it adds up to and what moves it.`,
      });
    }
  }
  // Money ties: the larger total leads.
  const sum = (c: ColumnProfile) => Math.abs(c.numeric?.sum ?? 0);
  return out.sort((a, b) => b.score - a.score || sum(b.column) - sum(a.column));
}

/** The type a column is analysed as when the user chooses it as the outcome. */
export function outcomeTypeOf(c: ColumnProfile, kind?: ColumnKind): OutcomeType | null {
  if (isBinaryColumn(c)) return "binary";
  if (kind === "score" || ordinalLike(c)) return "ordinal";
  if (c.storage === "string" && c.distinct >= 3 && c.distinct <= 30) return "class";
  if (c.storage === "number" && c.numeric && c.distinct >= 3) {
    // A short whole-number scale reads as a score; anything else as an amount.
    const n = c.numeric;
    if (n.integer && n.min >= 0 && n.max <= 10 && c.distinct <= 11) return "ordinal";
    return "amount";
  }
  return null;
}

/** True when the column can be an outcome at all: not an ID, a row index, a date or free text. */
export function canBeOutcome(c: ColumnProfile): boolean {
  if (c.role === "identifier" || c.role === "datetime" || c.role === "time" || c.role === "text")
    return false;
  return !isRowIndex(c) && c.distinct >= 2;
}

// ---------------------------------------------------------------- words

/** Outcome names as an analyst says them in a title: survived → survival, exited → exit. */
const NOUN_LEXICON: Record<string, string> = {
  survived: "survival",
  survival: "survival",
  churn: "churn",
  churned: "churn",
  attrition: "attrition",
  attrited: "attrition",
  left: "attrition",
  default: "default",
  defaulted: "default",
  exited: "exit",
  exit: "exit",
  converted: "conversion",
  conversion: "conversion",
  approved: "approval",
  approval: "approval",
  readmitted: "readmission",
  readmission: "readmission",
  fraud: "fraud",
  fraudulent: "fraud",
  responded: "response",
  response: "response",
  subscribed: "subscription",
  purchased: "purchase",
  clicked: "click",
  returned: "return",
  cancelled: "cancellation",
  canceled: "cancellation",
  passed: "pass",
  failed: "failure",
  hired: "hiring",
  placed: "placement",
  admitted: "admission",
  died: "mortality",
  death: "mortality",
  deceased: "mortality",
  won: "win",
  terminated: "exit",
  resigned: "exit",
};
/**
 * What the rows that are "yes" did, as a verb phrase after "{share} of
 * {rows}": survived, churned, left (attrition), defaulted, were approved.
 */
const VERB_LEXICON: Record<string, string> = {
  survived: "survived",
  survival: "survived",
  churn: "churned",
  churned: "churned",
  attrition: "left",
  attrited: "left",
  left: "left",
  default: "defaulted",
  defaulted: "defaulted",
  exited: "exited",
  exit: "exited",
  converted: "converted",
  conversion: "converted",
  approved: "were approved",
  approval: "were approved",
  readmitted: "were readmitted",
  readmission: "were readmitted",
  fraud: "were fraudulent",
  fraudulent: "were fraudulent",
  responded: "responded",
  response: "responded",
  subscribed: "subscribed",
  purchased: "purchased",
  clicked: "clicked",
  returned: "were returned",
  cancelled: "were cancelled",
  canceled: "were cancelled",
  passed: "passed",
  failed: "failed",
  failure: "failed",
  hired: "were hired",
  placed: "were placed",
  admitted: "were admitted",
  died: "died",
  death: "died",
  deceased: "died",
  terminated: "were terminated",
  resigned: "resigned",
};

/** Name words that say nothing about what the outcome is ("Status", "Target", "y"). */
const GENERIC_NAMES = new Set([
  "status",
  "result",
  "flag",
  "state",
  "outcome",
  "target",
  "label",
  "class",
  "y",
  "is",
  "event",
]);

/**
 * What the rows whose outcome is yes did, read from the column's name when
 * "yes" is spelt yes, true or 1 ("Survived" → "survived", "Churn" →
 * "churned", "Attrition" → "left"), or from the value when a status names
 * the event ("Exited" → "exited"); null when there is no plain wording, and
 * a sentence then says "{column} is {yes} on …" instead.
 */
export function outcomeVerb(c: ColumnProfile, positive: string): string | null {
  const v = positive.trim().toLowerCase();
  if (/^(yes|y|true|t|1)$/.test(v)) {
    for (const t of c.tokens.filter((x) => !GENERIC_NAMES.has(x)))
      if (VERB_LEXICON[t]) return VERB_LEXICON[t] as string;
    return null;
  }
  return VERB_LEXICON[v] ?? null;
}

/**
 * What the outcome is called in a title and a rate's name, lower case:
 * "Survived" → "survival", "Churn" → "churn", "SalePrice" → "sale price",
 * "Status" with Exited → "exit", "quality" → "quality". Acronyms keep their
 * capitals.
 */
export function outcomeNoun(c: ColumnProfile, type: OutcomeType, positive?: string | null): string {
  const text = friendly(c.name)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase()))
    .join(" ");
  if (type !== "binary") return text || c.name;
  // A yes/no outcome is named by the event it counts: survived → survival, a Status of "Exited" → exit.
  const words = c.tokens.filter((t) => !GENERIC_NAMES.has(t));
  for (const t of words) if (NOUN_LEXICON[t]) return NOUN_LEXICON[t] as string;
  if (!words.length && positive) {
    const v = positive.trim().toLowerCase();
    if (NOUN_LEXICON[v]) return NOUN_LEXICON[v] as string;
    if (EVENT_VALUES.has(v)) return v;
  }
  return text || c.name;
}
