/**
 * Ledgers written the way the file writes them (version 51.3). A P&L
 * template sums each class of rows (revenue, cost of sales, operating
 * expenses…) and subtracts the costs from the revenue, so it expects every
 * class as a positive amount. Files don't agree:
 * - a bank export or a signed ledger writes spending as negative numbers
 *   (−14,736 for groceries), so subtracting it added it back: the owner's
 *   own file showed an operating margin of 141% and a net margin of 163%;
 * - an accounting trial balance writes revenue as negative credits;
 * - a government "spend over £25k" list classifies only kinds of spending,
 *   where "Revenue" and "Revenue grants" mean operating spending, and read as
 *   income they gave an operating margin of −6,426%.
 *
 * withLedgerConventions reads the rows before anything is computed:
 * - Each class-filtered sum of the amount (a `calc` of `sum amount` over an
 *   account-type condition) whose rows are mostly negative (SIGNED_SHARE of
 *   the non-zero ones) is negated, so revenue and each cost count as positive
 *   amounts and refunds still net out. The formula itself changes, so the
 *   number, its SQL and its DAX agree, and its caveat says why.
 * - When the account-type column's own name says it classifies spending
 *   ("Expenditure Type", "Expense Type", "Cost Category"), no row is revenue
 *   or other income: those classes are emptied, so revenue and the margins
 *   say what they need instead of dividing by a mislabelled expense.
 * Rows that are neither income nor expense (transfers, share trades, savings,
 * opening and closing balances, capital) are left out by the registry's
 * `non_pnl` class.
 */
import type { Dataset } from "@/engine/core/types";
import type { DomainDef, KpiDef } from "@/registry/schema";
import type { Expr, Predicate } from "@/engine/query/expr";
import { compilePredicate } from "@/engine/query/evaluate";
import type { Mapping } from "@/engine/detect/mapping";
import { makeResolver } from "./context";

/** The classes of costs a P&L subtracts from revenue. */
const COST_CLASSES = new Set(["cogs", "opex", "depreciation", "interest", "tax"]);

/** A class whose non-zero rows are at least this share negative is written as negative numbers. */
export const SIGNED_SHARE = 0.8;
/** Fewer non-zero rows than this say too little about a class's sign. */
const MIN_SIGNED_ROWS = 3;

/** Header words of a column that classifies spending only. */
const SPEND_HEADER =
  /\b(expense|expenses|expenditure|expenditures|spend|spending|cost|costs|payment|payments|purchase|purchases)\b/i;

/** The class field and the amount field a P&L template reads; absent for other domains. */
function ledgerFields(domain: DomainDef): { type: string; amount: string } | null {
  const classes = domain.valueClasses?.account_type;
  if (!classes?.some((c) => c.id === "revenue")) return null;
  if (!domain.fields.some((f) => f.id === "amount")) return null;
  return { type: "account_type", amount: "amount" };
}

/** True for `{ calc: { agg: "sum", of: { field: amount } }, where: … }`, a class-filtered sum of the amount. */
function isClassSum(e: Expr, amount: string): boolean {
  if (!("calc" in e)) return false;
  const inner = e.calc;
  return (
    "agg" in inner && inner.agg === "sum" && "field" in inner.of && inner.of.field === amount && !inner.where
  );
}

/** A plain description of the rows a condition picks, for the caveat ("Operating expense rows"). */
function describe(p: Predicate, labels: ReadonlyMap<string, string>): string {
  if ("class" in p) return `${labels.get(p.class) ?? p.class} rows`;
  return "Expense rows";
}

export interface LedgerResult {
  domain: DomainDef;
  mapping: Mapping;
  /** Plain sentences on what was read differently, for the caveats and the review step. */
  notes: string[];
}

/** `domain` and `mapping` adjusted to how the file writes its ledger; unchanged for other domains. */
export function withLedgerConventions(domain: DomainDef, mapping: Mapping, ds: Dataset): LedgerResult {
  const fields = ledgerFields(domain);
  const typeColumn = fields ? mapping.fields[fields.type] : undefined;
  if (!fields || !typeColumn || !mapping.fields[fields.amount]) return { domain, mapping, notes: [] };
  const notes: string[] = [];

  // A spend list: its category column names kinds of spending, so none of its rows is income.
  let out = mapping;
  if (SPEND_HEADER.test(typeColumn.replace(/[_-]+/g, " "))) {
    const classes = { ...mapping.classes };
    let cleared = false;
    for (const id of ["revenue", "other_income"]) {
      const key = `${fields.type}.${id}`;
      if (classes[key]?.length) {
        classes[key] = [];
        cleared = true;
      }
    }
    if (cleared) {
      out = { ...mapping, classes };
      notes.push(
        `${typeColumn} classifies kinds of spending, so none of its rows is counted as revenue (in a spend list, “Revenue” means operating spending).`,
      );
    }
  }

  // Each class-filtered sum: negated where its rows are mostly negative. Every condition the template sums
  // the amount over is read once from the rows, before any is decided.
  const res = makeResolver(ds, out, new Map());
  const amount = res.column(fields.amount);
  if (amount.kind !== "number") return { domain, mapping: out, notes };
  const labels = new Map((domain.valueClasses?.[fields.type] ?? []).map((c) => [c.id, c.label]));
  const conditions = new Map<string, Predicate>();
  const collect = (e: Expr): void => {
    if (isClassSum(e, fields.amount)) {
      const where = (e as Extract<Expr, { calc: Expr }>).where;
      conditions.set(JSON.stringify(where), where);
      return;
    }
    if ("op" in e) e.args.forEach(collect);
    else if ("calc" in e) collect((e as Extract<Expr, { calc: Expr }>).calc);
    else if ("per" in e) collect(e.inner);
    else if ("atLatest" in e) collect(e.expr);
  };
  for (const k of domain.kpis) for (const v of k.variants) collect(v.expr);
  const stats = new Map<string, { nonZero: number; negative: number; sum: number }>();
  for (const [key, where] of conditions) {
    let test: (r: number) => boolean;
    try {
      test = compilePredicate(where, res);
    } catch {
      continue;
    }
    const st = { nonZero: 0, negative: 0, sum: 0 };
    for (let r = 0; r < ds.rowCount; r++) {
      const x = amount.values[r] as number;
      if (x !== x || x === 0 || !test(r)) continue;
      st.nonZero++;
      st.sum += x;
      if (x < 0) st.negative++;
    }
    stats.set(key, st);
  }
  const mostlyNegative = (key: string): boolean => {
    const st = stats.get(key);
    return Boolean(st && st.nonZero >= MIN_SIGNED_ROWS && st.negative / st.nonZero >= SIGNED_SHARE);
  };
  // A signed ledger: one of its cost classes is written as negative numbers. Its remaining rows ("all but
  // revenue") then follow the same convention even when a few unclassified receipts among them keep them
  // from being mostly negative, as on a cash-flow statement.
  const signed = [...conditions].some(
    ([key, p]) => "class" in p && COST_CLASSES.has(p.class) && mostlyNegative(key),
  );
  const verdict = new Map<string, boolean>();
  const why = new Map<string, string>();
  for (const [key, where] of conditions) {
    const remainder = key.includes('"notClass":"revenue"');
    const flip = mostlyNegative(key) || (signed && remainder && (stats.get(key)?.sum ?? 0) < 0);
    verdict.set(key, flip);
    if (!flip) continue;
    const note = `${describe(where, labels)} are written as negative numbers in your file, so they are counted as positive amounts.`;
    why.set(key, note);
    if (!notes.includes(note)) notes.push(note);
  }
  /** Conditions negated in the formula being rewritten, for its caveat. */
  let used = new Set<string>();
  const negated = (where: Predicate): boolean => {
    const key = JSON.stringify(where);
    const flip = verdict.get(key) ?? false;
    if (flip) used.add(key);
    return flip;
  };
  const rewrite = (e: Expr): Expr => {
    if (isClassSum(e, fields.amount)) {
      const where = (e as Extract<Expr, { calc: Expr }>).where;
      if (!negated(where)) return e;
      return {
        calc: { agg: "sum", of: { op: "mul", args: [{ field: fields.amount }, { num: -1 }] } },
        where,
      };
    }
    if ("op" in e) return { op: e.op, args: [rewrite(e.args[0]), rewrite(e.args[1])] };
    if ("calc" in e) {
      const c = e as Extract<Expr, { calc: Expr }>;
      return { calc: rewrite(c.calc), where: c.where };
    }
    if ("per" in e) return { ...e, inner: rewrite(e.inner) };
    if ("atLatest" in e) return { ...e, expr: rewrite(e.expr) };
    return e;
  };
  let changed = false;
  const kpis: KpiDef[] = domain.kpis.map((k) => ({
    ...k,
    variants: k.variants.map((v) => {
      used = new Set();
      const expr = rewrite(v.expr);
      if (expr === v.expr) return v;
      changed = true;
      const said = [...used].map((key) => why.get(key)).filter((x): x is string => Boolean(x));
      return { ...v, expr, caveat: [v.caveat, ...said].filter(Boolean).join(" ") };
    }),
  }));
  return { domain: changed ? { ...domain, kpis } : domain, mapping: out, notes };
}
