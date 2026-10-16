/**
 * Semantic role inference. Combines name tokens, storage type, value patterns
 * and statistics, and records a plain-English reason for every decision so
 * the user can see (and override) why a column was treated a certain way.
 *
 * Rules are ordered and the first match wins, so the specific rules
 * (coordinates, time attributes, flags, IDs, percentages, rates, money) come
 * before the generic measure/dimension fallbacks. Token sets hold canonical
 * tokens (names.tokenize) and a token may sit in several sets; rule order
 * decides which reading applies. Confidences are fixed heuristic scores.
 * The role drives additivity and the default aggregation used by KPIs and
 * charts.
 */
import type { StorageType } from "@/engine/core/types";
import type {
  Additivity,
  ColumnProfile,
  DefaultAgg,
  GeoLevel,
  NumericStats,
  PatternHit,
  SemanticRole,
} from "./types";
import { patternShare } from "./patterns";

const has = (tokens: readonly string[], set: ReadonlySet<string>): boolean => tokens.some((t) => set.has(t));

/** Name tokens that mark identifiers and codes. */
const ID_TOKENS = new Set([
  "id",
  "key",
  "code",
  "sku",
  "uuid",
  "reference",
  "awb",
  "tracking",
  "ean",
  "upc",
  "isbn",
  "gtin",
  "hsn",
  "serial",
  "ticket",
  "asin",
  "fsn",
  "barcode",
]);
/** Entities whose "<entity> number" is an identifier (order number, policy number). */
const NUMBER_ENTITY = new Set([
  "order",
  "invoice",
  "customer",
  "transaction",
  "account",
  "policy",
  "claim",
  "loan",
  "employee",
  "patient",
  "student",
  "booking",
  "ticket",
  "member",
  "product",
  "item",
  "shipment",
  "receipt",
  "bill",
  "roll",
  "admission",
  "case",
  // Places and things numbered for reference: a room number is a label, never a quantity to average.
  "room",
  "bed",
  "ward",
  "seat",
  "table",
  "gate",
  "door",
  "locker",
  "cabin",
  "berth",
  "flat",
  "house",
  "plot",
  "lot",
  "batch",
  "vehicle",
  "route",
  "platform",
  "bay",
  "slot",
  "desk",
  "counter",
  "terminal",
]);
/**
 * An entity and an ID word written as one token, as in ALL-CAPS headers that tokenize cannot split
 * ("ORDERNUMBER", "CUSTOMERID", "PRODUCTCODE").
 */
const FUSED_ID = new RegExp(`^(${[...NUMBER_ENTITY].join("|")})(id|number|num|no|code|key)$`);
/** Money-related name tokens. */
const CURRENCY_TOKENS = new Set([
  "amount",
  "price",
  "revenue",
  "sale",
  "cost",
  "gmv",
  "value",
  "fee",
  "charge",
  "discount",
  "tax",
  "gst",
  "vat",
  "profit",
  "margin",
  "spend",
  "budget",
  "salary",
  "wage",
  "ctc",
  "bonus",
  "mrr",
  "arr",
  "arpu",
  "ltv",
  "cac",
  "balance",
  "income",
  "expense",
  "payment",
  "refund",
  "cogs",
  "premium",
  "claim",
  "loan",
  "emi",
  "principal",
  "interest",
  "bill",
  "rent",
  "deposit",
  "credit",
  "debit",
  "subtotal",
  "commission",
  "payout",
  "earning",
  "turnover",
  "mrp",
  "unitprice",
  "sellingprice",
  "costprice",
  "listprice",
  "fare",
  "tuition",
  "payroll",
  "net",
  "gross",
  "total",
  "shipping",
  "freight",
  "outstanding",
  "receivable",
  "payable",
  "asset",
  "liability",
  "equity",
  "ebitda",
  "opex",
  "capex",
  "cpc",
  "cpm",
  "cpa",
  "aov",
]);
/** Per-unit or per-entity money (price, AOV, CAC, …): averaged, never summed. */
const NON_ADDITIVE_CURRENCY = new Set([
  "price",
  "unitprice",
  "sellingprice",
  "costprice",
  "listprice",
  "mrp",
  "rate",
  "average",
  "mean",
  "per",
  "arpu",
  "aov",
  "ltv",
  "cac",
  "cpc",
  "cpm",
  "cpa",
  "fare",
]);
/** Tokens that make a column a total despite a per-unit or rate token ("Total Price", "Line Amount"). */
const ADDITIVE_OVERRIDE = new Set([
  "total",
  "amount",
  "revenue",
  "sale",
  "value",
  "gmv",
  "subtotal",
  "line",
  "extended",
  "spend",
]);
/** Snapshot quantities (balances, stock, MRR): sum across items, not across time. */
const SEMI_ADDITIVE = new Set([
  "balance",
  "stock",
  "inventory",
  "onhand",
  "closing",
  "opening",
  "headcount",
  "level",
  "outstanding",
  "aum",
  "mrr",
  "arr",
  "seat",
  "snapshot",
  "receivable",
  "payable",
  "backlog",
]);
/** Ratios, averages and scores: averaged, never summed. */
const RATE_TOKENS = new Set([
  "rate",
  "ratio",
  "average",
  "mean",
  "score",
  "rating",
  "index",
  "ctr",
  "cvr",
  "roas",
  "roi",
  "yield",
  "utilization",
  "utilisation",
  "occupancy",
  "nps",
  "csat",
  "probability",
  "likelihood",
  "multiplier",
  "factor",
  "growth",
  "per",
  "star",
]);
const PERCENT_TOKENS = new Set(["percent", "pct", "share", "margin"]);
/**
 * Per-row durations, ages, scores and physical attributes: averaged. Checked
 * before QUANTITY_TOKENS in the measure fallback, so a token in both makes
 * the column non-additive. "Lead" is not here: "Leads" is a count, and a lead
 * time is caught as the pair "lead" + "time" (isLeadTime).
 */
const NON_ADDITIVE_MEASURE = new Set([
  "age",
  "tenure",
  "day",
  "days",
  "duration",
  "rank",
  "score",
  "rating",
  "temperature",
  "level",
  "grade",
  "percentile",
  "year",
  "tat",
  "aging",
  "ageing",
  "sla",
  "experience",
  "bmi",
  "weight",
  "height",
]);
/** "Lead time" (days between booking or order and fulfilment) is a per-row duration, unlike a count of leads. */
const isLeadTime = (t: readonly string[]): boolean => t.includes("lead") && t.includes("time");
/** Countable things: safe to sum. Also vetoes rules that would make a count a time attribute, row ID or category code. */
const QUANTITY_TOKENS = new Set([
  "quantity",
  "unit",
  "item",
  "count",
  "piece",
  "volume",
  "session",
  "click",
  "impression",
  "view",
  "visit",
  "order",
  "stock",
  "seat",
  "lead",
  "conversion",
  "install",
  "download",
  "signup",
  "subscriber",
  "user",
  "visitor",
  "pageview",
  "bounce",
  "add",
  "cart",
  "checkout",
  "purchase",
  "ticket",
  "call",
  "minute",
  "hour",
  "km",
  "mile",
  "distance",
  "trip",
  "night",
  "room",
  "bed",
  "admission",
]);
/** Names under which a few small whole numbers are category codes (tier 1–3, priority 1–5). */
const DIMENSION_CODE_TOKENS = new Set([
  "type",
  "category",
  "level",
  "tier",
  "grade",
  "class",
  "group",
  "segment",
  "zone",
  "floor",
  "priority",
  "status",
  "stage",
  "band",
  "cluster",
  "region",
  "rating",
  "star",
  "flag",
  "quarter",
  "month",
  "week",
  "weekday",
  "day",
  "hour",
  "year",
]);
/** Flag-like name tokens (is_, has_, churned, returned, …) that make a 0/1 column a boolean. */
const BOOL_TOKENS = new Set([
  "is",
  "has",
  "was",
  "flag",
  "returned",
  "cancelled",
  "canceled",
  "churned",
  "churn",
  "active",
  "converted",
  "fraud",
  "repeat",
  "new",
  "paid",
  "prepaid",
  "cod",
  "rto",
  "delivered",
  "verified",
  "promo",
  "subscribed",
  "default",
  "defaulted",
  "attrition",
  "left",
  "readmitted",
  "renewed",
]);
const GEO_LAT = new Set(["lat", "latitude"]);
const GEO_LNG = new Set(["lng", "lon", "long", "longitude"]);
const POSTAL = new Set(["pincode", "zipcode", "postcode", "zip", "postal"]);
const CITY_TOKENS = new Set(["city", "town", "district", "municipality"]);
const STATE_TOKENS = new Set(["state", "province", "territory"]);
const COUNTRY_TOKENS = new Set(["country", "nation"]);
const ADDRESS_TOKENS = new Set(["address", "street", "line1", "line2", "landmark", "locality"]);
const REGION_TOKENS = new Set(["region", "zone", "territory", "area", "market"]);
/** Words that make a name a classification rather than a place ("Market Segment", "Area Type"). */
const CLASSIFICATION_TOKENS = new Set([
  "segment",
  "type",
  "category",
  "class",
  "group",
  "tier",
  "status",
  "channel",
]);
/** Person or user name columns. */
const NAME_TOKENS = new Set(["name", "firstname", "lastname", "fullname", "username"]);
/** Free-text field names. */
const TEXT_TOKENS = new Set([
  "description",
  "comment",
  "review",
  "feedback",
  "note",
  "remark",
  "message",
  "text",
  "body",
  "summary",
  "reason",
]);

export interface RoleDecision {
  role: SemanticRole;
  /** Fixed heuristic score per rule (0.6–0.97). */
  confidence: number;
  /** Plain-English explanation shown to the user. */
  reason: string;
  additivity?: Additivity;
  geoLevel?: GeoLevel;
  geoRegion?: "IN" | "US" | "WORLD";
  percentScale?: 1 | 100;
  defaultAgg: DefaultAgg;
}

interface RoleInput {
  name: string;
  tokens: string[];
  storage: StorageType;
  rowCount: number;
  nonNull: number;
  distinct: number;
  numeric?: NumericStats;
  /** Strings only: mean length per non-null row. */
  avgLength?: number;
  patterns: PatternHit[];
  /** Dominant currency found in the values (number columns). */
  currencyFormat?: string;
  /** Values were written with a % sign and are stored as fractions. */
  percentFormat?: boolean;
  /** Region suggested by detectStatePattern (strings). */
  stateRegion?: "IN" | "US";
  /** Strings only: share of non-null rows containing a space (sentences vs codes). */
  spaceShare?: number;
  /** Dates only: the column holds times of day without a date (DateColumn.timeOnly). */
  timeOnly?: boolean;
}

/**
 * Default aggregation per role: identifiers count distinct; measures and money
 * sum unless non-additive (then average); semi-additive still defaults to sum,
 * as it is additive across items; rates and percentages average; dates none;
 * everything else counts rows.
 */
function aggFor(role: SemanticRole, additivity?: Additivity): DefaultAgg {
  switch (role) {
    case "identifier":
      return "countDistinct";
    case "datetime":
    case "time":
      return "none";
    case "measure":
    case "currency":
      return additivity === "non-additive" ? "avg" : "sum";
    case "rate":
    case "percentage":
      return "avg";
    default:
      return "count";
  }
}

function decide(
  role: SemanticRole,
  confidence: number,
  reason: string,
  extra: Partial<RoleDecision> = {},
): RoleDecision {
  return { role, confidence, reason, defaultAgg: aggFor(role, extra.additivity), ...extra };
}

/**
 * True when the raw name uses `word` in the singular as a whole word ("Order Hour", "hour_of_day",
 * "WeekNum"). Tokens are singularised, so this reads the raw name: a plural ("Training Hours")
 * names a duration or count, not a position on the calendar or clock.
 */
function namesPosition(name: string, word: string): boolean {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`).test(spaced);
}

/** Role of a number column; rules in priority order, first match wins. */
function numericRole(x: RoleInput): RoleDecision {
  const t = x.tokens;
  const s = x.numeric;
  const cardinality = x.nonNull ? x.distinct / x.nonNull : 0;
  const integer = s?.integer ?? false;
  const min = s?.min ?? NaN;
  const max = s?.max ?? NaN;

  // Coordinates and postal codes: a name plus a plausible value range.
  if (has(t, GEO_LAT) && min >= -90 && max <= 90)
    return decide("geo", 0.92, "Name says latitude and values are within ±90.", { geoLevel: "latitude" });
  if (has(t, GEO_LNG) && min >= -180 && max <= 180)
    return decide("geo", 0.92, "Name says longitude and values are within ±180.", { geoLevel: "longitude" });
  if (has(t, POSTAL) && integer && min >= 10000 && max <= 999999)
    return decide("geo", 0.9, "Postal code by name with 5–6 digit values.", { geoLevel: "postal" });

  // Calendar positions (year, month, quarter, week, hour of day) say when, not how much. Week and hour
  // need the singular word in the raw name ("Training Hours" is a duration to sum, since "hour" is also a
  // quantity token) and no rate or count word ("Calls per Hour", "Hour Count").
  if (integer) {
    if (t.includes("year") && min >= 1900 && max <= 2100)
      return decide("dimension", 0.9, "Year values (1900–2100) treated as a time attribute, not a quantity.");
    if (t.includes("month") && min >= 1 && max <= 12)
      return decide("dimension", 0.88, "Month numbers 1–12 are a time attribute.");
    if (t.includes("quarter") && min >= 1 && max <= 4)
      return decide("dimension", 0.88, "Quarter numbers 1–4 are a time attribute.");
    const rateOrCount = t.some((x) => x === "per" || x === "count" || x === "total" || x === "quantity");
    if (
      min >= 0 &&
      !rateOrCount &&
      ((max <= 53 && namesPosition(x.name, "week")) || (max <= 23 && namesPosition(x.name, "hour")))
    ) {
      return decide(
        "dimension",
        0.8,
        "Calendar position number (week or hour of day), treated as a time attribute.",
      );
    }
  }

  // 0/1 with a flag-like name is a boolean; without such a name a 0/1 column continues as a number.
  const binary = integer && min >= 0 && max <= 1 && x.distinct <= 2;
  if (binary && (has(t, BOOL_TOKENS) || t[0] === "is" || t[0] === "has")) {
    return decide("boolean", 0.9, "Only 0/1 values with a flag-like name.");
  }

  // Identifier by name, provided the values vary like keys (over 30% distinct or more than 50 values).
  const idByName =
    has(t, ID_TOKENS) || (t.includes("number") && has(t, NUMBER_ENTITY)) || t.some((x) => FUSED_ID.test(x));
  if (integer && idByName && (cardinality > 0.3 || x.distinct > 50)) {
    return decide(
      "identifier",
      0.9,
      "ID-like name with many distinct whole numbers; never summed or averaged.",
    );
  }
  // A row number: unique, null-free whole numbers forming a near-gapless run (span ≤ 1.05 × rows),
  // unless the name says money or quantity.
  if (
    integer &&
    x.distinct === x.nonNull &&
    x.nonNull === x.rowCount &&
    x.rowCount > 20 &&
    s &&
    max - min + 1 <= x.rowCount * 1.05 &&
    !has(t, CURRENCY_TOKENS) &&
    !has(t, QUANTITY_TOKENS)
  ) {
    return decide("identifier", 0.72, "Unique, sequential whole numbers look like a row ID.");
  }

  // A % sign in the values wins (the parser stored fractions). Otherwise a percent-like name decides and the
  // range gives the scale: within ±1 = fractions, within ±100 = points. A bare "Margin" above 1 is left to
  // the currency rule, since "margin" is also a money token; "Margin %" or "Margin Pct" stays a percentage.
  if (x.percentFormat)
    return decide("percentage", 0.95, "Values were written with a % sign.", {
      additivity: "non-additive",
      percentScale: 1,
    });
  const percentByName = has(t, PERCENT_TOKENS) && !has(t, new Set(["amount", "value", "total"]));
  if (percentByName && s && min >= -1 && max <= 1)
    return decide("percentage", 0.86, "Percentage by name, stored as fractions (0–1).", {
      additivity: "non-additive",
      percentScale: 1,
    });
  if (percentByName && s && min >= -100 && max <= 100 && (!t.includes("margin") || t.includes("percent"))) {
    return decide("percentage", 0.82, "Percentage by name, stored as points (0–100).", {
      additivity: "non-additive",
      percentScale: 100,
    });
  }
  // Rates, averages and scores are never summed; a fractional 0–1 "rate"/"ratio" is shown as a percentage.
  if (has(t, RATE_TOKENS) && !has(t, ADDITIVE_OVERRIDE)) {
    if (s && min >= 0 && max <= 1 && !integer && (t.includes("rate") || t.includes("ratio"))) {
      return decide("percentage", 0.8, "A rate stored as a fraction between 0 and 1.", {
        additivity: "non-additive",
        percentScale: 1,
      });
    }
    return decide("rate", 0.82, "Rate, average or score by name: averaged with weights, never summed.", {
      additivity: "non-additive",
    });
  }

  // Money: additive by default, semi-additive for balances/snapshots, non-additive for per-unit prices
  // unless a total-like token overrides. Confidence is highest when symbol and name agree. An explicit
  // quantity or count word outranks a money word ("Refund Quantity", "Quantity (- Refund)") unless the
  // values carry a currency symbol.
  const currencyByName = has(t, CURRENCY_TOKENS) && !t.includes("quantity") && !t.includes("count");
  if (x.currencyFormat || currencyByName) {
    let additivity: Additivity = "additive";
    let why = x.currencyFormat
      ? `Currency symbol (${x.currencyFormat}) in the values.`
      : "The name says it is money (amount, price, revenue…).";
    if (has(t, SEMI_ADDITIVE)) {
      additivity = "semi-additive";
      why += " A balance/snapshot: add across items, not across time.";
    } else if (has(t, NON_ADDITIVE_CURRENCY) && !has(t, ADDITIVE_OVERRIDE)) {
      additivity = "non-additive";
      why += " A per-unit price: use a weighted average, never a sum.";
    }
    return decide("currency", x.currencyFormat && currencyByName ? 0.95 : 0.85, why, { additivity });
  }

  // At most 10 distinct whole numbers under a category-like name (tier, priority, rating) are codes.
  if (integer && x.distinct <= 10 && has(t, DIMENSION_CODE_TOKENS) && !has(t, QUANTITY_TOKENS)) {
    return decide("dimension", 0.7, "A small set of whole-number codes, treated as categories.");
  }

  // A rating or score read from the values alone ("Q7", "Feedback", "Stars given"): whole or half steps
  // from 0 or 1 up to exactly 5, 7 or 10, with at least three points of the scale in use. Summing such a
  // column is meaningless, so it is averaged; quantity, snapshot and duration names were decided above
  // or below by name, and the reason tells the user how to change it if it is really a count.
  if (
    s &&
    x.nonNull >= 20 &&
    s.halfSteps &&
    min >= 0 &&
    min <= 1 &&
    (max === 5 || max === 7 || max === 10) &&
    x.distinct >= 3 &&
    !has(t, QUANTITY_TOKENS) &&
    !has(t, SEMI_ADDITIVE)
  ) {
    return decide(
      "rate",
      0.62,
      `Values form a ${min}–${max} scale, like a rating or score: averaged, never summed. If it is really a count, set the role to Measure.`,
      { additivity: "non-additive" },
    );
  }

  // Fallback: a measure. Additivity comes from the name (snapshots → semi, per-row durations/ages/scores →
  // non); confidence drops to 0.6 when no name token supports the guess.
  let additivity: Additivity = "additive";
  let why = has(t, QUANTITY_TOKENS)
    ? "A count or quantity: safe to sum."
    : "Numeric values: treated as a summable measure.";
  if (has(t, SEMI_ADDITIVE)) {
    additivity = "semi-additive";
    why = "A stock/level snapshot: add across items, take the latest value over time.";
  } else if (has(t, NON_ADDITIVE_MEASURE) || isLeadTime(t)) {
    additivity = "non-additive";
    why = "A per-row duration, age or score: average it, don't sum it.";
  }
  return decide("measure", has(t, QUANTITY_TOKENS) || additivity !== "additive" ? 0.82 : 0.6, why, {
    additivity,
  });
}

/** Role of a string column: value patterns first, then names, then length and cardinality. */
function stringRole(x: RoleInput): RoleDecision {
  const t = x.tokens;
  const p = x.patterns;
  const cardinality = x.nonNull ? x.distinct / x.nonNull : 0;
  const avgLen = x.avgLength ?? 0;

  // Emails and phone numbers are personal data: identifiers to count people, not categories to group by.
  if (patternShare(p, "email") >= 0.8)
    return decide("identifier", 0.95, "Email addresses (personal data); used to count people, not to group.");
  if (patternShare(p, "url") >= 0.8) return decide("text", 0.9, "Web addresses.");
  if (
    patternShare(p, "phone") >= 0.8 &&
    (has(t, new Set(["phone", "mobile", "contact"])) || cardinality > 0.5)
  ) {
    return decide("identifier", 0.9, "Phone numbers (personal data).");
  }
  if (has(t, POSTAL) && (patternShare(p, "pincode") >= 0.8 || patternShare(p, "zip") >= 0.8)) {
    return decide("geo", 0.95, "Postal codes by name and 5–6 digit pattern.", {
      geoLevel: "postal",
      geoRegion: patternShare(p, "pincode") >= 0.8 ? "IN" : "US",
    });
  }
  // States and countries: 60% recognised values, or 30% when the name agrees. A city-like name alone is
  // enough for cities; otherwise half the values must be known cities.
  const stateShare = patternShare(p, "state");
  if (stateShare >= 0.6 || (has(t, STATE_TOKENS) && stateShare >= 0.3)) {
    return decide(
      "geo",
      stateShare >= 0.85 ? 0.95 : 0.8,
      `${Math.round(stateShare * 100)}% of values are recognised ${x.stateRegion === "US" ? "US" : "Indian"} states.`,
      {
        geoLevel: "state",
        geoRegion: x.stateRegion ?? "IN",
      },
    );
  }
  const countryShare = patternShare(p, "country");
  if (countryShare >= 0.6 || (has(t, COUNTRY_TOKENS) && countryShare >= 0.3)) {
    return decide("geo", 0.9, `${Math.round(countryShare * 100)}% of values are recognised countries.`, {
      geoLevel: "country",
      geoRegion: "WORLD",
    });
  }
  const cityShare = patternShare(p, "city");
  if (has(t, CITY_TOKENS) || cityShare >= 0.5) {
    return decide(
      "geo",
      has(t, CITY_TOKENS) ? 0.88 : 0.75,
      has(t, CITY_TOKENS) ? "City by name." : `${Math.round(cityShare * 100)}% of values are known cities.`,
      { geoLevel: "city" },
    );
  }
  if (has(t, ADDRESS_TOKENS)) return decide("text", 0.8, "Street address text.", { geoLevel: "address" });
  // A region word with a classification word is a segment, not a place ("Market Segment", "Zone Type").
  if (has(t, REGION_TOKENS) && !has(t, CLASSIFICATION_TOKENS) && x.distinct <= 60)
    return decide("geo", 0.72, "Sales region or zone.", { geoLevel: "region" });

  // Identifiers: by name (more than 50 distinct values), UUIDs, or mostly unique code-like values.
  const idByName =
    has(t, ID_TOKENS) || (t.includes("number") && has(t, NUMBER_ENTITY)) || t.some((x) => FUSED_ID.test(x));
  if (idByName && x.distinct > 50)
    return decide("identifier", 0.9, "ID-like name with many distinct values; counted, never summed.");
  if (patternShare(p, "uuid") >= 0.9) return decide("identifier", 0.95, "UUID values.");
  if (patternShare(p, "id") >= 0.9 && cardinality >= 0.5 && x.distinct > 50)
    return decide("identifier", 0.8, "Code-like values that are mostly unique.");

  // Free text: a text-like name with values over 15 characters on average, values over 60 characters,
  // or over 30 characters when mostly unique and mostly containing spaces (sentences, not codes).
  if (has(t, TEXT_TOKENS) && avgLen > 15) return decide("text", 0.85, "Descriptive free text.");
  if (avgLen > 60 || (avgLen > 30 && cardinality > 0.6 && (x.spaceShare ?? 0) > 0.7))
    return decide("text", 0.8, "Long, mostly unique sentences.");

  if (has(t, NAME_TOKENS) && cardinality > 0.3 && x.distinct > 50) {
    return decide(
      "dimension",
      0.65,
      "Names with many distinct values; usable for top-N lists, not broad breakdowns.",
    );
  }
  return decide(
    "dimension",
    x.distinct <= 50 ? 0.82 : 0.68,
    x.distinct <= 50
      ? `${x.distinct} distinct ${x.distinct === 1 ? "value" : "values"}, used as categories.`
      : "Text values used as categories.",
  );
}

/** Entry point: booleans and dates map straight to their roles; numbers and strings go through the rule lists. */
export function inferRole(x: RoleInput): RoleDecision {
  if (x.storage === "boolean") return decide("boolean", 0.97, "True/false values.");
  if (x.storage === "date" && x.timeOnly)
    return decide(
      "time",
      0.95,
      "Times of day with no date (a separate time column): used for hour-of-day patterns, never as a date.",
    );
  if (x.storage === "date") return decide("datetime", 0.97, "Dates/times.");
  if (x.storage === "number") return numericRole(x);
  return stringRole(x);
}

/**
 * Re-derive aggregation defaults when a user overrides the role.
 * Unless `additivity` is given: rates and percentages become non-additive,
 * measure and currency keep the inferred additivity (or additive), and other
 * roles drop it. geoLevel, geoRegion and percentScale are kept as inferred.
 */
export function applyRoleOverride(
  profile: ColumnProfile,
  role: SemanticRole,
  additivity?: Additivity,
): ColumnProfile {
  const add =
    additivity ??
    (role === "rate" || role === "percentage"
      ? "non-additive"
      : role === "measure" || role === "currency"
        ? (profile.additivity ?? "additive")
        : undefined);
  return {
    ...profile,
    role,
    additivity: add,
    defaultAgg: aggFor(role, add),
    roleConfidence: 1,
    roleReason: "Set by you.",
  };
}
