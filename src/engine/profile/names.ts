/**
 * Column-name normalisation shared by profiling and domain detection:
 * snake/camel/kebab splitting, abbreviation expansion, light plural folding,
 * and the name-similarity score that domain synonyms are matched with.
 *
 * Tokens are the vocabulary that role rules (roles.ts), quality checks and
 * domain synonyms (detect/match.ts) are matched against, so compare canonical
 * forms: "quantity", not "qty"; "percent", not "pct".
 */

/** Lower-case abbreviation → canonical token, applied before singularisation and compound folding. */
const ABBREVIATIONS: Record<string, string> = {
  qty: "quantity",
  qnty: "quantity",
  quantities: "quantity",
  amt: "amount",
  amnt: "amount",
  cust: "customer",
  custid: "customer",
  clnt: "client",
  emp: "employee",
  empl: "employee",
  empid: "employee",
  prod: "product",
  prd: "product",
  num: "number",
  no: "number",
  nbr: "number",
  nr: "number",
  "#": "number",
  "%": "percent",
  dt: "date",
  desc: "description",
  cat: "category",
  categ: "category",
  subcat: "subcategory",
  addr: "address",
  ph: "phone",
  tel: "phone",
  mob: "mobile",
  pin: "pincode",
  txn: "transaction",
  trx: "transaction",
  trans: "transaction",
  tran: "transaction",
  inv: "invoice",
  vch: "voucher",
  rev: "revenue",
  disc: "discount",
  pct: "percent",
  perc: "percent",
  percentage: "percent",
  avg: "average",
  val: "value",
  dept: "department",
  mgr: "manager",
  sal: "salary",
  acct: "account",
  acc: "account",
  bal: "balance",
  yr: "year",
  mth: "month",
  mnth: "month",
  wk: "week",
  qtr: "quarter",
  loc: "location",
  reg: "region",
  ctry: "country",
  cntry: "country",
  ord: "order",
  pmt: "payment",
  pymt: "payment",
  paymt: "payment",
  pay: "payment",
  ship: "shipping",
  shp: "shipping",
  shipment: "shipping",
  deliv: "delivery",
  dlv: "delivery",
  delivered: "delivery",
  refnd: "refund",
  impr: "impression",
  imps: "impression",
  clk: "click",
  conv: "conversion",
  convs: "conversion",
  sess: "session",
  cnt: "count",
  tot: "total",
  ttl: "total",
  nm: "name",
  dob: "birthdate",
  doj: "joiningdate",
  uid: "id",
  guid: "id",
  uuid: "id",
  ref: "reference",
  src: "source",
  sp: "sellingprice",
  cp: "costprice",
  uom: "unit",
};

/**
 * Two-token compounds folded into one canonical token. Folding runs twice:
 * on the raw words ("pin code", before "pin" expands to "pincode") and again
 * on the expanded, singular tokens ("sub cat" → "sub category"), so a key
 * may use either form.
 */
const COMPOUNDS: Record<string, string> = {
  "sub category": "subcategory",
  "e mail": "email",
  "zip code": "zipcode",
  "pin code": "pincode",
  "post code": "postcode",
  "postal code": "postcode",
  "first name": "firstname",
  "last name": "lastname",
  "user name": "username",
  "time stamp": "timestamp",
  "date time": "datetime",
  "mrp price": "mrp",
  "add to": "addto",
  "check out": "checkout",
  "cash on": "cashon",
  "selling price": "sellingprice",
  "cost price": "costprice",
  "list price": "listprice",
  "unit price": "unitprice",
};

/** Endings whose final "s" is kept: status, address, analysis, metrics, holidays. */
const KEEP_S = /(ss|us|is|ys|ics|ies)$/;

/** Words the plural rules would mangle: invariant "-ies" words and plurals of "-ie" words. */
const PLURAL_EXCEPTIONS: Record<string, string> = {
  series: "series",
  species: "species",
  movies: "movie",
  cookies: "cookie",
  calories: "calorie",
};

/**
 * Light plural folding for words longer than four letters: "-ies" → "-y",
 * otherwise drop a final "s" unless KEEP_S matches. PLURAL_EXCEPTIONS covers
 * the words those rules get wrong ("series", "movies").
 */
function singular(t: string): string {
  const fixed = PLURAL_EXCEPTIONS[t];
  if (fixed) return fixed;
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 4 && t.endsWith("s") && !KEEP_S.test(t)) return t.slice(0, -1);
  return t;
}

/** Greedy left-to-right compound folding: a token consumed by a compound is not reused for the next pair. */
function foldCompounds(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const compound = COMPOUNDS[`${tokens[i]} ${tokens[i + 1] ?? ""}`];
    if (compound) {
      out.push(compound);
      i++;
    } else out.push(tokens[i] as string);
  }
  return out;
}

/**
 * "OrderDate" → ["order","date"]; "cust_ID" → ["customer","id"]; "Discount %" → ["discount","percent"].
 * Steps: isolate % and #, split camelCase and acronym boundaries
 * ("HTTPServer" → http, server), lower-case, split on anything
 * non-alphanumeric, fold compounds, expand abbreviations, singularise, then
 * fold compounds again ("Pin Code" → ["pincode"], "Sub Cat" → ["subcategory"]).
 */
export function tokenize(name: string): string[] {
  const spaced = name
    .replace(/%/g, " % ")
    .replace(/#/g, " # ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
  const raw = foldCompounds(spaced.split(/[^a-z0-9%#]+/).filter(Boolean));
  return foldCompounds(raw.map((t) => ABBREVIATIONS[t] ?? t).map(singular));
}

/** A token list prepared for nameSimilarity: its joined forms and its content words (stopwords removed). */
interface PreparedName {
  tokens: readonly string[];
  joined: string;
  compact: string;
  content: readonly string[];
  contentSet: ReadonlySet<string>;
}

function prepare(tokens: readonly string[]): PreparedName {
  const c = content(tokens);
  return { tokens, joined: tokens.join(" "), compact: tokens.join(""), content: c, contentSet: new Set(c) };
}

const phraseCache = new Map<string, PreparedName>();
const columnCache = new WeakMap<readonly string[], PreparedName>();

/** A registry phrase tokenised and prepared once; dropped wholesale past 50,000 phrases. */
function preparedPhrase(phrase: string): PreparedName {
  let p = phraseCache.get(phrase);
  if (!p) {
    if (phraseCache.size >= 50_000) phraseCache.clear();
    p = prepare(tokenize(phrase));
    phraseCache.set(phrase, p);
  }
  return p;
}

/** A column's token list prepared once per array (ColumnProfile.tokens is compared with every synonym). */
function preparedTokens(tokens: readonly string[]): PreparedName {
  let p = columnCache.get(tokens);
  if (!p) {
    p = prepare(tokens);
    columnCache.set(tokens, p);
  }
  return p;
}

/**
 * tokenize, memoised: registry labels and synonyms are compared against every
 * column of every upload, so each is tokenised once. The result is shared, so
 * it is read-only.
 */
export function phraseTokens(phrase: string): readonly string[] {
  return preparedPhrase(phrase).tokens;
}

/** Canonical tokens joined by single spaces. */
export function normalizedName(name: string): string {
  return tokenize(name).join(" ");
}

/** Jaro–Winkler similarity in [0, 1], with the standard 0.1 prefix bonus over up to 4 characters. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (!la || !lb) return 0;
  const window = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array<boolean>(la).fill(false);
  const mb = new Array<boolean>(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(lb - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (mb[j] || a[i] !== b[j]) continue;
      ma[i] = true;
      mb[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue;
    while (!mb[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / la + m / lb + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, la, lb); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Function words ignored when comparing token sets, so "date of admission" matches "admission date". */
const STOPWORDS: ReadonlySet<string> = new Set([
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
]);

/**
 * Tokens that qualify a name without saying what it is about: ID and label
 * words, time words, generic measures and states, and units. A partial match
 * needs a shared token outside this set and may only leave out tokens from
 * it, so "Market Rent" never reaches "market value" and "Loan Status" never
 * reaches "bad loan" on one shared word. Bare numbers ("Address Line 1")
 * count as generic too (isGeneric).
 */
export const GENERIC_TOKENS: ReadonlySet<string> = new Set([
  "id",
  "number",
  "code",
  "key",
  "name",
  "title",
  "label",
  "reference",
  "date",
  "time",
  "datetime",
  "timestamp",
  "day",
  "days",
  "week",
  "month",
  "year",
  "quarter",
  "hour",
  "minute",
  "period",
  "amount",
  "value",
  "total",
  "count",
  "average",
  "rate",
  "percent",
  "ratio",
  "score",
  "level",
  "type",
  "status",
  "category",
  "class",
  "group",
  "kind",
  "description",
  "detail",
  "info",
  "data",
  "new",
  "current",
  "last",
  "first",
  "final",
  "actual",
  "gross",
  "net",
  "is",
  "has",
  "was",
  "flag",
  "kg",
  "kgs",
  "lb",
  "lbs",
  "mt",
  "km",
  "kms",
  "inr",
  "usd",
  "eur",
  "gbp",
  "utc",
  "gmt",
  "ist",
  "sec",
  "min",
  "mins",
  "hr",
  "hrs",
  "gb",
  "mb",
]);

/** True for GENERIC_TOKENS and bare numbers. */
const isGeneric = (t: string): boolean => GENERIC_TOKENS.has(t) || /^\d+$/.test(t);

/** True when every word of the phrase, stopwords aside, is generic ("name", "date", "total amount"). */
export function isGenericPhrase(phrase: string): boolean {
  return preparedPhrase(phrase).content.every(isGeneric);
}

/** Tokens without stopwords; all of them when nothing else is left ("to", "from" as whole names). */
function content(tokens: readonly string[]): readonly string[] {
  const kept = tokens.filter((t) => !STOPWORDS.has(t));
  return kept.length ? kept : [...tokens];
}

/**
 * Similarity between a column name and a synonym phrase, in [0, 1].
 * Exact token match > every synonym word present > one word spelt almost the
 * same way > partial overlap, which reaches detect/match.ts's MATCH_THRESHOLD
 * (0.55) only when the column is the synonym minus generic words.
 *
 * Scores, with stopwords ("of", "at") ignored from the containment step on:
 * 1 identical tokens; 0.97 identical once spaces are removed ("order id" vs
 * "orderid"); 0.95 the same words in another order or apart from stopwords
 * ("Date of Admission" vs "admission date", "Created" vs "created at"); 0.92
 * minus 0.07 per extra column word (floor 0.62) when
 * every synonym word is present, but only 0.6 when a one-word synonym meets a
 * column that adds a distinctive word, which usually names a different
 * concept ("Freight Cost" vs "cost", "Campaign status" vs "status",
 * "Customer Country" vs "customer"); 0.8 when the only difference is one word
 * spelt almost the same way ("fulfilment" vs "fulfillment": Jaro–Winkler ≥
 * 0.93, both at least 5 letters, so a shared prefix such as "customer" in
 * "Customer City" vs "customer type" is not enough); 0.6 when the column is
 * the synonym without some of its GENERIC_TOKENS ("Courier" vs "courier
 * name"); 0.35 when they share a non-generic word but otherwise differ, a
 * hint that only counts together with value evidence ("Market Rent" vs
 * "market value"); otherwise 0.
 */
export function nameSimilarity(columnTokens: readonly string[], synonym: string): number {
  const syn = preparedPhrase(synonym);
  if (syn.tokens.length === 0 || columnTokens.length === 0) return 0;
  const col = preparedTokens(columnTokens);
  if (col.joined === syn.joined) return 1;
  if (col.compact === syn.compact) return 0.97;
  const s = syn.content;
  const c = col.content;
  const synSet = syn.contentSet;
  const missing = s.filter((t) => !col.contentSet.has(t));
  const extra = c.filter((t) => !synSet.has(t));
  if (missing.length === 0) {
    if (extra.length === 0) return 0.95;
    // A one-word synonym only just clears the threshold against a column that adds a distinctive
    // word, so a synonym naming the whole phrase wins and the column counts as weak evidence.
    if (s.length === 1 && extra.some((t) => !isGeneric(t))) return 0.6;
    return Math.max(0.62, 0.92 - extra.length * 0.07);
  }
  if (missing.length === 1 && extra.length === 1) {
    const a = missing[0] as string;
    const b = extra[0] as string;
    if (Math.min(a.length, b.length) >= 5 && jaroWinkler(a, b) >= 0.93) return 0.8;
  }
  // Partial overlap: a shared distinctive word is a hint, not a match, because the words that differ
  // usually change the meaning ("injury claim" vs "claim paid"). Only a column that is the synonym
  // minus generic qualifiers ("Invoice" vs "invoice number") is close enough to count.
  if (!c.some((t) => synSet.has(t) && !isGeneric(t))) return 0;
  if (extra.length === 0 && missing.every(isGeneric)) return 0.6;
  return 0.35;
}

/** True when the name contains any of `tokens`, which must be in canonical form (see tokenize). */
export function hasToken(columnName: string, ...tokens: string[]): boolean {
  const t = new Set(tokenize(columnName));
  return tokens.some((x) => t.has(x));
}
