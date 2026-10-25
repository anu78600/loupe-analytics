/**
 * Semantic role inference. Combines name tokens, storage type, value patterns
 * and statistics, and records a plain-English reason for every decision so
 * the user can see (and override) why a column was treated a certain way.
 *
 * Rules are ordered and the first match wins, so the specific rules
 * (coordinates, time attributes, flags, IDs, percentages, money, rates) come
 * before ordinal scores and readings (a quality of 3–9, acidity, pH,
 * temperature: averaged, never summed) and then the generic measure/dimension
 * fallbacks. After every column is decided, readingsTable reads the unnamed
 * numbers of a table of measurements (no IDs, dates or amounts) as readings
 * too. Token sets hold canonical
 * tokens (names.tokenize) and a token may sit in several sets; rule order
 * decides which reading applies. Confidences are fixed heuristic scores.
 * The role drives additivity and the default aggregation used by KPIs and
 * charts.
 *
 * Tokens arrive in canonical English whatever the header's language or
 * spelling: names.tokenize folds accents, translates business words, writes
 * the token "money" for a currency mark or code ("ADR (€)", "copay_usd") and
 * keeps units and scale words as their own tokens. A few rules also read the
 * raw name, where tokens lose something that matters: a plural ("Total
 * Orders" counts orders, "Order Total" is money), "number of", or a question
 * mark.
 */
import type { StorageType } from "@/engine/core/types";
import type {
  Additivity,
  ColumnProfile,
  DefaultAgg,
  GeoLevel,
  GeoRegion,
  NumericStats,
  PatternHit,
  SemanticRole,
} from "./types";
import { patternShare } from "./patterns";
import { STATE_REGION_LABEL } from "./geo";
import { tokenize } from "./names";

const has = (tokens: readonly string[], set: ReadonlySet<string>): boolean => tokens.some((t) => set.has(t));

/** Words that keep a code-named column an amount ("Code Amount", "Reference Value"). */
const CODE_AMOUNT_WORDS = new Set([
  "amount",
  "value",
  "total",
  "price",
  "cost",
  "balance",
  "sum",
  "fee",
  "revenue",
  "sales",
]);

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
  // Standard identifiers: medical record and hospital IDs (MRN, UHID, NPI, CMS's CCN), clinical-trial
  // subject IDs (CDISC USUBJID, SUBJID), device and SIM numbers (IMEI, ICCID, MSISDN), bank codes
  // (IBAN, IFSC) and tax and social security numbers (GSTIN, SSN).
  "mrn",
  "uhid",
  "npi",
  "ccn",
  "usubjid",
  "subjid",
  "imei",
  "iccid",
  "msisdn",
  "iban",
  "ifsc",
  "gstin",
  "ssn",
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
  // A laboratory specimen's or a library item's accession number.
  "accession",
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
  // Documents of trade and logistics: a purchase or sales order, goods receipt or delivery number.
  "po",
  "so",
  "grn",
  "document",
  "material",
  "voucher",
  "contract",
  "delivery",
  "challan",
  "docket",
  "consignment",
  "container",
]);
/**
 * An entity and an ID word written as one token, as in ALL-CAPS headers that tokenize cannot split
 * ("ORDERNUMBER", "CUSTOMERID", "PRODUCTCODE"). Two-letter entities stay out: "po" + "key" is a word.
 */
const FUSED_ID = new RegExp(
  `^(${[...NUMBER_ENTITY].filter((w) => w.length > 2).join("|")})(id|number|num|no|code|key)$`,
);
/**
 * Money-related name tokens. "Value" and "total" are not here: as words they
 * are weak evidence ("Value", "Result Val", "Total Orders", "Population,
 * total"), and count as money only in a money context (VALUE_CONTEXT,
 * TOTAL_CONTEXT) or, for "total", as the whole header (numericRole).
 */
const CURRENCY_TOKENS = new Set([
  "amount",
  "price",
  "revenue",
  "sale",
  "cost",
  "gmv",
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
  // Assets under management, average daily rate and revenue per available room (hotels), and GDP:
  // always money, whatever else the header says.
  "aum",
  "adr",
  "revpar",
  "gdp",
  "worth",
  "proceed",
  // Pay and its parts: allowances (house rent allowance), deductions and the provident fund ("PF", a power
  // factor instead when every value is a fraction up to 1, see numericRole).
  "allowance",
  "deduction",
  "reimbursement",
  "stipend",
  "incentive",
  "gratuity",
  "pension",
  "arrear",
  "hra",
  "pf",
  "epf",
]);
/** The token names.tokenize writes for a currency mark or code in the header ("ADR (€)", "GDP (current US$)", "copay_usd"). */
const MONEY_MARK = "money";
/**
 * Words that make "value" money: an order, deal or portfolio value is an
 * amount, while a bare "Value" or "Result Val" is a reading of anything.
 */
const VALUE_CONTEXT = new Set([
  "order",
  "deal",
  "sale",
  "invoice",
  "contract",
  "cart",
  "basket",
  "transaction",
  "policy",
  "loan",
  "gross",
  "net",
  "portfolio",
  "property",
  "lifetime",
  "market",
  "book",
  "inventory",
  "stock",
  "goods",
  "purchase",
  "trade",
  "asset",
  "claim",
  "booking",
  "shipment",
  // A deal's or a share's close value, stock valued at opening and closing, and the values of
  // valuation, tax and customs: fair, face, resale, residual, insured, declared, taxable, assessable.
  "close",
  "closing",
  "opening",
  "pipeline",
  "fair",
  "face",
  "resale",
  "residual",
  "insured",
  "declared",
  "taxable",
  "assessable",
  "cargo",
]);
/**
 * Words that make "total" money when written in the singular: an order,
 * invoice or grand total is an amount. "Total Orders" (a plural) counts
 * orders, and "Total Stock" or "Sessions - Total" sums a quantity.
 */
const TOTAL_CONTEXT = new Set([
  "order",
  "invoice",
  "cart",
  "basket",
  "line",
  "grand",
  "sub",
  "bill",
  "transaction",
  "deal",
  "contract",
  "booking",
  "purchase",
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
  "adr",
  "revpar",
]);
/**
 * Words that say a figure is an average or a per-unit amount ("Avg Rent",
 * "Cost per Click", "Median Price"). With money they make it a per-unit
 * figure even beside a total-like word ("Average Order Value"), unlike the
 * implicit per-unit words above.
 */
const AVERAGING = new Set(["per", "average", "mean", "median"]);
/**
 * Words that make a "rate" a price: a rate per hour, day, night or room is
 * charged ("Daily Rate", "Hourly Rate", "Room Rate"), unlike an interest,
 * tax or conversion rate, which is a ratio.
 */
const PRICE_RATE_WORDS = new Set([
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "nightly",
  "room",
  "unit",
  "bill",
  "billing",
  "labour",
  "labor",
  "freight",
]);
/** Units a price is charged per ("Rate per Sq.Ft.", "Rate per Night"); "per capita" or "per 1,000" make a ratio instead. */
const CHARGE_UNITS = new Set([
  "unit",
  "item",
  "piece",
  "pcs",
  "hour",
  "day",
  "night",
  "week",
  "month",
  "sqft",
  "sqm",
  "kg",
  "tonne",
  "litre",
  "km",
  "room",
  "person",
  "head",
  "seat",
  "visit",
  "session",
  "click",
]);
/**
 * Money words that are also charged as a share of an amount: stored as
 * fractions between 0 and 1 ("Discount" 0.1) they are percentages.
 */
const SHARE_MONEY = new Set(["discount", "commission", "tax", "gst", "vat", "interest"]);
/** Beside these, "ARR" is an arrival ("ARR_DELAY", "ARR_TIME" in flight data), not annual recurring revenue. */
const ARRIVAL_WORDS = new Set([
  "delay",
  "time",
  "date",
  "hour",
  "minute",
  "flight",
  "dep",
  "departure",
  "airport",
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
/**
 * Rate words whose value is a share of a whole (clicks of impressions, rooms
 * occupied of rooms): stored as fractions between 0 and 1 they are
 * percentages. Scores, averages and multipliers (ROAS) are not shares.
 */
const SHARE_RATE_TOKENS = new Set(["rate", "ratio", "ctr", "cvr", "utilization", "utilisation", "occupancy"]);
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
 * Outcomes measured as a share of a whole: users retained of a cohort, sales
 * achieved of a target, work done of the total. Stored as fractions or as
 * points (numericRole); far above 100 the column counts something instead
 * ("Retention" of 1,200 customers).
 */
const SHARE_OUTCOME = new Set(["retention", "attainment", "progress", "completion"]);
/**
 * Ratios and scores that stay ratios beside a money word ("Average Interest
 * Rate", "Cost Ratio", "Price Index", "Revenue Growth"): never a per-unit
 * amount of money. A bare "rate" joins them unless it is a price
 * (PRICE_RATE_WORDS).
 */
const RATIO_WORDS = new Set([
  ...[...RATE_TOKENS].filter((w) => !AVERAGING.has(w) && w !== "rate"),
  ...PERCENT_TOKENS,
  ...SHARE_OUTCOME,
]);
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
  // A length of stay or service is a duration; a length of a thing, an attribute like its weight.
  "length",
]);
/**
 * Words naming a concentration, a level or a reading of something measured:
 * chemistry and food (acidity, pH, chlorides, sulphates, sulfur dioxide,
 * sugar, alcohol), medicine (glucose, cholesterol, sodium), physics
 * (temperature, pressure, viscosity, humidity) and measurement words (BMI,
 * index, ratio, level, reading). Each row holds its own reading, so the column
 * is averaged and never summed: a "Total sulfur dioxide" is how much one wine
 * holds, not an amount to add up across wines. Clear money or quantity
 * evidence (a money word, a count, a physical unit such as kg) still wins;
 * see numericRole. "pH" is read from the raw name (tokenize splits it).
 */
const MEASUREMENT_TOKENS = new Set([
  "acid",
  "acidity",
  "density",
  "chloride",
  "sulphate",
  "sulfate",
  "sulphur",
  "sulfur",
  "dioxide",
  "sugar",
  "glucose",
  "cholesterol",
  "sodium",
  "potassium",
  "calcium",
  "magnesium",
  "concentration",
  "alcohol",
  "abv",
  "viscosity",
  "temperature",
  "temp",
  "humidity",
  "pressure",
  "salinity",
  "turbidity",
  "conductivity",
  "hardness",
  "bmi",
  "index",
  "ratio",
  "level",
  "reading",
]);
/**
 * A pollutant or air-quality reading by its formula or name: NO2, NOx, SO2, O3,
 * NMHC, C6H6, PM2.5, PM10, ozone, benzene, AQI, and CO only as a formula in
 * brackets or before one ("PT08.S1(CO)", "CO(GT)"). A sensor logs a reading
 * per row: the UCI air-quality file's hourly NMHC was added up into a "total"
 * (version 51.5).
 */
const POLLUTANT =
  /(?:^|[^a-z0-9])(?:no2|nox|so2|o3|nmhc|c6h6|pm\s?2[.,_]?5|pm10|h2s|nh3|ozone|benzene|aqi)(?:[^a-z0-9]|$)|\(co\)|^co\s*\(/i;
/** "pH" as a word of the raw name ("pH", "soil_pH", "PH Level"); its values must also lie within 0–14. */
const PH_WORD = /(?:^|[^a-z])ph(?:[^a-z]|$)/i;
/**
 * Units of a concentration or a reading in the raw name: mg/L, g/dL, ppm,
 * ppb, mmHg, mmol, µg, degrees (°C, °F, "deg C"). Physical units of an
 * amount (kg, litres, kWh) are not here: they measure a quantity.
 */
const MEASUREMENT_UNIT =
  /\bm?g\s*\/\s*(?:d?l|dm[3³]|m[3³]|100\s*g)\b|\bppm\b|\bppb\b|°|\bmm\s*hg\b|\bmmol\b|µ|μ|\bdeg(?:rees?)?\s*[cf]\b|\bcelsius\b|\bfahrenheit\b|\bkelvin\b/i;
/**
 * Names of an ordinal score: whole numbers on a short scale ("quality" of
 * 3–9, a grade of 0–10) are points on that scale, averaged, never summed.
 * "Rating" and "score" are read as rates earlier (RATE_TOKENS); a grade or
 * level with at most ten codes stays a category (DIMENSION_CODE_TOKENS).
 */
const ORDINAL_SCORE_TOKENS = new Set(["quality", "grade", "rating", "score", "rank", "level"]);
/** Durations and ages: values of 1–10 under them count years or days, never points on a rating scale. */
const DURATION_TOKENS = new Set([
  "age",
  "tenure",
  "duration",
  "experience",
  "length",
  "day",
  "days",
  "year",
  "tat",
  "aging",
  "ageing",
  "sla",
]);
/** "Lead time" (days between booking or order and fulfilment) is a per-row duration, unlike a count of leads. */
const isLeadTime = (t: readonly string[]): boolean => t.includes("lead") && t.includes("time");
/** Countable things: safe to sum. Also vetoes rules that would make a count a time attribute, row ID or category code. */
const QUANTITY_TOKENS = new Set([
  "quantity",
  // Nights stayed and reorder points are counts and quantities, never calendar positions or codes (51.x
  // corpus: "stays_in_week_nights", "reorderLevel"; version 52.2).
  "night",
  "reorder",
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
/**
 * Things counted one by one. In the plural with whole numbers they name a
 * count ("Active Loans", "Total Orders", "Code Redemptions", "tickets_created"),
 * never an ID and, without a money mark or amount word, never money.
 */
const COUNTABLE = new Set([
  "order",
  "booking",
  "reservation",
  "transaction",
  "invoice",
  "bill",
  "payment",
  "loan",
  "credit",
  "claim",
  "policy",
  "ticket",
  "customer",
  "client",
  "employee",
  "user",
  "visitor",
  "member",
  "subscriber",
  "patient",
  "student",
  "account",
  "case",
  // Events, interactions and items, counted the same way.
  "event",
  "redemption",
  "recipient",
  "session",
  "click",
  "impression",
  "view",
  "visit",
  "lead",
  "conversion",
  "install",
  "download",
  "signup",
  "call",
  "trip",
  "admission",
  "unit",
  "item",
  "piece",
  "product",
  "shipment",
  "delivery",
  "store",
  "complaint",
  "application",
  "request",
  "incident",
  "enquiry",
  "inquiry",
  "referral",
  "registration",
  "appointment",
  "vote",
  "review",
  // Subscriber and staff flows: net adds, activations, connections, hires.
  "add",
  "addition",
  "activation",
  "connection",
  "subscription",
  "hire",
]);
/**
 * Entities whose bare name heads a column of their identifiers ("Order",
 * "Invoice", "Billing Document", "Material", "Ticket"): SAP, ERP and helpdesk
 * exports name the key column after the entity alone. Money nouns (bill,
 * loan, claim, payment) are left out, since alone they usually head an amount.
 */
const ENTITY_ID_NOUNS = new Set([
  "order",
  "invoice",
  "document",
  "material",
  "ticket",
  "customer",
  "account",
  "transaction",
  "booking",
  "shipment",
  "delivery",
  "receipt",
  "voucher",
  "po",
  "contract",
  "case",
  "member",
  "product",
  "item",
  "employee",
  "patient",
  "student",
  "admission",
  "roll",
  "batch",
  "lot",
  "plot",
  "route",
  "vehicle",
  "room",
  "bed",
  "terminal",
  "policy",
]);
/** Words that name a kind of document or entity without making it a quantity ("Sales Order", "Billing Document"). */
const ENTITY_QUALIFIERS = new Set([
  "billing",
  "sale",
  "purchase",
  "service",
  "work",
  "job",
  "sap",
  "parent",
  "master",
  "original",
  "internal",
  "external",
  "source",
]);
/**
 * Physical units, as names.tokenize writes them (it folds gms to gram, MT to
 * tonne, ltrs to litre, sq ft to sqft). A column measured in one is a
 * quantity, not money ("Budget Cement (MT)", "Net Wt (gms)", "Net Absorption
 * (mn sq ft)"), unless the unit is a denominator ("Rate per Sq.Ft.", "Price/kg").
 */
const PHYSICAL_UNITS = new Set([
  "gram",
  "kg",
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
  // Data sizes: a "Data Allowance (GB)" is a quantity of data.
  "gb",
  "mb",
  "tb",
]);
/**
 * A time unit in brackets is a column's own unit ("Credit Period (days)",
 * "Overtime (hrs)"). Elsewhere "hour" and "day" usually name a time of day
 * ("Peak Hour Charge", "Total day charge"), so only the plural "days" counts
 * unbracketed ("Days Sales Outstanding").
 */
const TIME_UNIT_IN_BRACKETS = /\((?:in\s+)?(?:hrs?|hours?|mins?|minutes?|days?|secs?|seconds?)\)/i;
/** A physical unit written as a denominator: "per sq ft", "/kg", "per tonne". */
const PER_PHYSICAL_UNIT =
  /(?:\/|\bper\b)\s*(?:sq\.?\s*(?:ft|m)\b|kgs?\b|gms?\b|grams?\b|tonnes?\b|tons?\b|mt\b|lit(?:re|er)s?\b|ltrs?\b|kms?\b|miles?\b|m3\b|m³|cu\.?\s*m\b|kwh\b)/i;
/**
 * Physical quantities and durations that, as the head of a name, say what
 * is measured: "Net Weight", "Sales Volume" and "Loan Amount Term" are not
 * money, while "Volume Discount" and "Weight Charge" are.
 */
const MEASURED_HEADS = new Set([
  "weight",
  "volume",
  "distance",
  "length",
  "height",
  "width",
  "depth",
  "mass",
  "temperature",
  "term",
  "tenure",
  "duration",
]);
/** Units, scales and marks that trail a name ("Loan Tenure (months)", "Revenue (₹ Cr)"), skipped to find its head. */
const TRAILING_TOKENS = new Set([
  MONEY_MARK,
  "million",
  "billion",
  "thousand",
  "lakh",
  "crore",
  "number",
  "day",
  "days",
  "week",
  "month",
  "year",
  "hour",
  "minute",
  "second",
]);
/** The head noun of a name: its last word before any trailing unit, scale or mark. */
const headNoun = (t: readonly string[]): string =>
  [...t].reverse().find((w) => !TRAILING_TOKENS.has(w) && !PHYSICAL_UNITS.has(w)) ?? "";
/** Scale words: a count written in millions or lakhs ("Net Adds (Mn)") need not be whole. */
const SCALE_TOKENS = new Set(["million", "billion", "thousand", "lakh", "crore"]);
/** Names under which a few small whole numbers are category codes (tier 1–3, priority 1–5). */
/**
 * A numbered till, store or machine ("register" 1–5, "Store" 1–45): a label for where something happened,
 * never a figure to add up or a 1–5 rating (version 52.2: a grocery file's register was averaged as a score).
 */
const NUMBERED_PLACE_TOKENS = new Set([
  "register",
  "till",
  "counter",
  "lane",
  "terminal",
  "kiosk",
  "desk",
  "machine",
  "gate",
  "store",
  "outlet",
  "branch",
]);
/**
 * Names of an organisation, not a place: "Department" holding "DE" and "Defra" is not 67% Delaware
 * (version 52.2). Such a column is geography only when nearly all its values are places.
 */
const ORGANISATION_TOKENS = new Set([
  "department",
  "dept",
  "agency",
  "ministry",
  "directorate",
  "division",
  "organisation",
  "organization",
  "entity",
  "team",
  "supplier",
  "vendor",
  "company",
]);
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
/**
 * States and past participles that say whether something happened to the
 * row ("Cancelled", "Settled", "Viewed", "Certified"). Any other word ending
 * in "-ed" reads the same way (isParticiple); "Termd" is HR shorthand for
 * terminated.
 */
const STATE_FLAG_WORDS = new Set([
  "cancelled",
  "canceled",
  "settled",
  "viewed",
  "certified",
  "abandoned",
  "churned",
  "terminated",
  "termd",
]);
/** Events a row either had or didn't ("Machine failure", "Work accident", "Promotion"). */
const EVENT_FLAG_WORDS = new Set([
  "failure",
  "accident",
  "promotion",
  "default",
  "fraud",
  "defect",
  "churn",
  "exit",
  "attrition",
]);
/**
 * Flag words and their abbreviations ("no_show_flg", "Default Indicator"),
 * and words naming the state of something rather than an amount: 0/1 under
 * them is a flag even beside a money word ("Credit History", "Payment Status").
 */
const STATE_HEAD_WORDS = new Set(["status", "history", "flag", "indicator"]);
/** Verbs that open a yes/no question used as a header ("Did purchase", "Are you a member"). */
const QUESTION_VERBS = new Set([
  "is",
  "has",
  "was",
  "did",
  "does",
  "do",
  "are",
  "were",
  "can",
  "will",
  "have",
]);
// Latitude and longitude, with the misspellings and Spanish forms found in real files.
const GEO_LAT = new Set(["lat", "latitude", "lattitude", "latitud"]);
const GEO_LNG = new Set(["lng", "lon", "long", "longitude", "longtitude", "longitud"]);
const POSTAL = new Set(["pincode", "zipcode", "postcode", "zip", "postal"]);
/** Settlements and local areas: a short-valued text column named after one is a place, known or not. */
const CITY_TOKENS = new Set(["city", "town", "village", "district", "county", "municipality"]);
/** State-level names whose values must be recognised states ("state" also means a condition). */
const STATE_TOKENS = new Set(["state", "province", "territory"]);
/** State-level names that are places whatever their values: a province is never a condition. */
const PROVINCE_TOKENS = new Set(["province"]);
/** Names of a condition or an outcome: never a place, even when a value looks like one ("Status: OK"). */
const STATUS_TOKENS = new Set(["status", "stage", "condition", "result", "outcome"]);
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
  // Bank-statement narrations, email and ticket subjects, and the action taken as an engineer wrote it up.
  "narration",
  "subject",
  "action",
  "observation",
  "finding",
]);
/**
 * Text fields usually filled from a list: a handful of reasons or
 * resolutions repeated down the column are categories to group by, and only
 * varied values are free text.
 */
const PICKED_TEXT_TOKENS = new Set(["reason", "resolution"]);
/** Work items whose name or title is written as a sentence ("Ticket name", "Issue Title"), unlike a product's. */
const WORK_ITEMS = new Set([
  "ticket",
  "issue",
  "incident",
  "task",
  "request",
  "bug",
  "story",
  "problem",
  "complaint",
]);
const TITLE_TOKENS = new Set(["name", "title", "subject"]);

/** The reason of the low-confidence fallback: a number with nothing in its name to say what it is. */
const SUMMABLE_FALLBACK_REASON = "Numeric values: treated as a summable measure.";
/** The reason given to a concentration, level or reading named by its header (MEASUREMENT_TOKENS). */
const MEASUREMENT_REASON =
  "A concentration, level or reading by name: each row's own value, averaged, never summed.";
/** The reason of the row-number rule: unique, sequential whole numbers. */
const ROW_ID_REASON = "Unique, sequential whole numbers look like a row ID.";
/** Why readingsTable makes a fallback measure non-additive. */
const OBSERVATION_REASON =
  "A table of measurements (no IDs, dates or amounts): each value is a reading, so it is averaged, never summed.";

export interface RoleDecision {
  role: SemanticRole;
  /** Fixed heuristic score per rule (0.6–0.97). */
  confidence: number;
  /** Plain-English explanation shown to the user. */
  reason: string;
  additivity?: Additivity;
  geoLevel?: GeoLevel;
  /** Only IN and US get a tile map; charts check that, so other regions are places to group by. */
  geoRegion?: GeoRegion;
  percentScale?: 1 | 100;
  defaultAgg: DefaultAgg;
}

/** What profiling knows about a column when its role is inferred (profile.ts profileColumn). */
export interface RoleInput {
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
  stateRegion?: Exclude<GeoRegion, "WORLD">;
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

/** Lower-case words of the raw name, accents folded and camelCase split ("TotalOrders" → total, orders). */
function rawWords(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * True when the raw name uses a word of `set` in the plural ("Active Loans",
 * "Code Redemptions", "tickets_created"). Tokens are singular, so the raw
 * words are read. Each is tokenised alone, so a translated or fused plural
 * counts too; "-ss", "-us" and "-is" endings (address, status, analysis)
 * are not plurals.
 */
function pluralOf(name: string, set: ReadonlySet<string>): boolean {
  return rawWords(name).some((w) => {
    if (w.length < 4 || !w.endsWith("s") || /(ss|us|is)$/.test(w)) return false;
    const last = tokenize(w).at(-1);
    if (last === undefined) return false;
    // tokenize leaves plurals of four letters alone ("adds"), so their "s" is dropped here.
    return set.has(last.endsWith("s") ? last.slice(0, -1) : last);
  });
}

/** "Number of Employees", "No. of Orders", "Count of Leads", "# Customers": the name says it counts. */
function countPhrase(name: string): boolean {
  return /^\s*#\s*[a-z]/i.test(name) || /\b(number|no|num|nos|count|qty) of\b/.test(rawWords(name).join(" "));
}

/**
 * The name says the column counts things: a count phrase, the word "count",
 * or a countable noun in the plural, unless an explicit ID word ends the
 * name ("users_id"). "Orders (#)" counts too: the plural outweighs the "#".
 */
function countByName(name: string, t: readonly string[]): boolean {
  if (countPhrase(name) || t.includes("count")) return true;
  return pluralOf(name, COUNTABLE) && !ID_TOKENS.has(t.at(-1) ?? "");
}

/**
 * An entity's bare name, perhaps qualified ("Order", "Material", "Billing
 * Document", "Sales Order"). The raw header must name the entity, not an
 * event: "DELIVERED" tokenises to "delivery" but counts what was delivered.
 */
function entityNamed(t: readonly string[], name: string): boolean {
  const last = t.at(-1);
  return (
    last !== undefined &&
    ENTITY_ID_NOUNS.has(last) &&
    t.every((w) => ENTITY_ID_NOUNS.has(w) || ENTITY_QUALIFIERS.has(w)) &&
    !isParticiple(rawWords(name).at(-1) ?? "")
  );
}

/** A bare "No.", "Number", "Nr" or "#": a reference number. */
const bareNumber = (t: readonly string[]): boolean => t.length > 0 && t.every((w) => w === "number");

/** A past participle or "-ed" adjective of five letters or more ("Viewed", "Exited"), not a "-eed" word (speed). */
const isParticiple = (w: string): boolean => w.length >= 5 && w.endsWith("ed") && !w.endsWith("eed");

/**
 * A yes/no question used as a header: written with a question mark
 * ("¿En inventario?", "Repeat buyer?") or opening with a verb ("Did
 * purchase"). A question asking how many or which is not yes/no.
 */
function yesNoQuestion(name: string, t: readonly string[]): boolean {
  const n = name.trim();
  if (/^[¿¡\s]*(?:(?:how|what|which|when|where|who|why|wie)\b|cu[aá]nt|quant|combien)/i.test(n)) return false;
  return n.endsWith("?") || n.startsWith("¿") || QUESTION_VERBS.has(t[0] ?? "");
}

/**
 * Why a column of only 0 and 1 is a yes/no flag, or null. The name must say
 * so: a yes/no question, a state word (even beside a money word: "Credit
 * History"), a flag word, an event ("Machine failure") or a state or past
 * participle ("Cancelled", "Viewed", "Termd"). Otherwise a quantity, count,
 * money or rate word keeps it a number: 0/1 "Units Shipped" counts units.
 */
function flagReason(name: string, t: readonly string[], counted: boolean): string | null {
  if (yesNoQuestion(name, t)) return "Only 0 and 1 under a yes/no question: a flag.";
  if (has(t, STATE_HEAD_WORDS)) return "Only 0 and 1 under a status or flag name: a flag, not an amount.";
  const amountWord =
    counted ||
    has(t, QUANTITY_TOKENS) ||
    has(t, CURRENCY_TOKENS) ||
    has(t, RATE_TOKENS) ||
    has(t, PERCENT_TOKENS) ||
    t.includes(MONEY_MARK) ||
    t.includes("value") ||
    t.includes("total");
  if (amountWord) return null;
  if (has(t, EVENT_FLAG_WORDS)) return "Only 0 and 1 under the name of an event: whether it happened.";
  if (t.some((w) => STATE_FLAG_WORDS.has(w) || isParticiple(w)))
    return "Only 0 and 1 under a name saying whether something happened: a flag.";
  return null;
}

/**
 * A "rate" charged per period or unit ("Daily Rate", "Hourly Rate", "Room
 * Rate", "Rate per Sq.Ft."): a price, unless its values are fractions (a
 * daily interest rate).
 */
function rateIsPrice(t: readonly string[], name: string, max: number): boolean {
  const i = t.indexOf("rate");
  if (i < 0 || !(max > 1)) return false;
  const near = [t[i - 1], t[i + 1]];
  if (near.some((w) => w !== undefined && PRICE_RATE_WORDS.has(w))) return true;
  return (t[i + 1] === "per" && CHARGE_UNITS.has(t[i + 2] ?? "")) || PER_PHYSICAL_UNIT.test(name);
}

/** A plural or explicit duration ("Completion Time", "Retention Days"): never a share of a whole. */
const namesDuration = (name: string, t: readonly string[]): boolean =>
  t.includes("time") ||
  t.includes("duration") ||
  /\b(days|weeks|months|years|hours|hrs|minutes|mins|seconds|secs)\b/.test(rawWords(name).join(" "));

/**
 * Additivity of a quantity measured in a unit, from its name: per-row
 * durations, ages and attributes are non-additive (a "Days Sales
 * Outstanding" is averaged although "outstanding" is a snapshot word), other
 * snapshots semi-additive.
 */
function measureAdditivity(t: readonly string[]): Additivity {
  if (has(t, NON_ADDITIVE_MEASURE) || isLeadTime(t) || has(t, AVERAGING)) return "non-additive";
  if (has(t, SEMI_ADDITIVE)) return "semi-additive";
  return "additive";
}

/**
 * The column is measured in a physical unit or a duration rather than money:
 * a unit token that isn't a denominator, the plural "days", or a time unit in
 * brackets. A unit after "per" or "/" is a denominator ("Price/kg", "Rate per
 * Sq.Ft.", "₹/sq ft/month"); one before it is the column's own ("Sales
 * (kg/month)").
 */
function measuredInUnit(t: readonly string[], name: string): boolean {
  const cut = name.search(/\/|\bper\b/i);
  const numerator = cut >= 0 ? new Set(tokenize(name.slice(0, cut))) : null;
  const ownUnit = (w: string, i: number) =>
    (PHYSICAL_UNITS.has(w) || w === "days") && t[i - 1] !== "per" && (numerator === null || numerator.has(w));
  return t.some(ownUnit) || TIME_UNIT_IN_BRACKETS.test(cut >= 0 ? name.slice(0, cut) : name);
}

/** Role of a number column; rules in priority order, first match wins. */
function numericRole(x: RoleInput): RoleDecision {
  const t = x.tokens;
  const s = x.numeric;
  const cardinality = x.nonNull ? x.distinct / x.nonNull : 0;
  const integer = s?.integer ?? false;
  const min = s?.min ?? NaN;
  const max = s?.max ?? NaN;
  const counted = countByName(x.name, t);
  // Money words: the money tokens ("arr" only away from flight words, "pf" only above 1, since a power
  // factor is a fraction), plus "value" in a money context and "total" beside a singular money noun
  // ("Order Total", not "Total Orders").
  const arrival = has(t, ARRIVAL_WORDS);
  const moneyWords = t.filter(
    (w) => CURRENCY_TOKENS.has(w) && !(w === "arr" && arrival) && !(w === "pf" && !(max > 1)),
  );
  // A header that is only "Total" (or a grand or sub total, perhaps with a scale) names a row's amount, as
  // in order, invoice and POS exports; "Total Orders" and "Population, total" say what is totalled instead.
  const bareTotal =
    t.includes("total") &&
    t.every((w) => w === "total" || w === "grand" || w === "sub" || w === MONEY_MARK || SCALE_TOKENS.has(w));
  const weakMoney =
    bareTotal ||
    (t.includes("value") && has(t, VALUE_CONTEXT)) ||
    (t.includes("total") && has(t, TOTAL_CONTEXT) && !pluralOf(x.name, TOTAL_CONTEXT));
  const moneyNamed = moneyWords.length > 0 || weakMoney;
  const moneyMarked = t.includes(MONEY_MARK);

  // Coordinates and postal codes: a name plus a plausible value range.
  if (has(t, GEO_LAT) && min >= -90 && max <= 90)
    return decide("geo", 0.92, "Name says latitude and values are within ±90.", { geoLevel: "latitude" });
  if (has(t, GEO_LNG) && min >= -180 && max <= 180)
    return decide("geo", 0.92, "Name says longitude and values are within ±180.", { geoLevel: "longitude" });
  // Postal codes kept as numbers have 4 digits (Australia, New Zealand, Belgium, Austria, Switzerland, the
  // Nordics), 5 (the US, Germany, France) or 6 (India). Beside a money or count word the postal word means
  // something else ("Postal Charges", "Postal Votes").
  if (has(t, POSTAL) && integer && min >= 1000 && max <= 999999 && !moneyNamed && !moneyMarked && !counted)
    return decide("geo", 0.9, "Postal code by name with 4–6 digit values.", { geoLevel: "postal" });

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
    // Nights stayed are a count, not a week's position ("stays_in_week_nights", version 52.2).
    const rateOrCount = t.some(
      (x) => x === "per" || x === "count" || x === "total" || x === "quantity" || x === "night",
    );
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

  // 0/1 with a flag-like name is a boolean; without such a name a 0/1 column continues as a number. Beyond
  // the flag tokens, a column holding both 0 and 1 is a flag when its name says so (flagReason).
  const binary = integer && min >= 0 && max <= 1 && x.distinct <= 2;
  if (binary && (has(t, BOOL_TOKENS) || t[0] === "is" || t[0] === "has")) {
    return decide("boolean", 0.9, "Only 0/1 values with a flag-like name.");
  }
  const flag = binary && min === 0 && max === 1 ? flagReason(x.name, t, counted) : null;
  if (flag) return decide("boolean", 0.85, flag);

  // Identifier by name, provided the values vary like keys (over 30% distinct or more than 50 values). A
  // count is never an ID: "# Customers", "Number of Employees" and "Code Redemptions" count things.
  const keyLike = cardinality > 0.3 || x.distinct > 50;
  const idByName =
    !counted &&
    (has(t, ID_TOKENS) || (t.includes("number") && has(t, NUMBER_ENTITY)) || t.some((w) => FUSED_ID.test(w)));
  if (integer && idByName && keyLike) {
    return decide(
      "identifier",
      0.9,
      "ID-like name with many distinct whole numbers; never summed or averaged.",
    );
  }
  // A code by name over a few whole numbers ("Budget Ref" holding fiscal years 23–26, "Fund Code"): a label to
  // group rows by, never money, even beside a money word. Read as money, a ledger's budget references added
  // up to a "budget" of 632,921.
  if (
    integer &&
    idByName &&
    !keyLike &&
    x.distinct <= 12 &&
    cardinality <= 0.25 &&
    !has(t, CODE_AMOUNT_WORDS)
  ) {
    return decide(
      "dimension",
      0.8,
      "A code by name over a few whole numbers: a label to group by, never added up.",
    );
  }
  // An entity's bare name over large whole numbers ("Order", "Invoice", "Billing Document", "Material") heads
  // the key column of an ERP or helpdesk export; in the plural ("Orders") it counts them instead.
  if (
    integer &&
    keyLike &&
    min >= 1000 &&
    !counted &&
    (entityNamed(t, x.name) || bareNumber(t)) &&
    !pluralOf(x.name, ENTITY_ID_NOUNS)
  ) {
    return decide(
      "identifier",
      0.85,
      "Named after an entity, over many distinct large whole numbers: its reference numbers, never summed.",
    );
  }
  // An explicit ID word over values that aren't whole ("user_pseudo_id", a code that holds a decimal point).
  if (!integer && keyLike && t.includes("id") && !counted)
    return decide(
      "identifier",
      0.85,
      "ID by name with many distinct values: a code, never summed or averaged.",
    );
  // A row number: unique, null-free whole numbers forming a near-gapless run (span ≤ 1.05 × rows),
  // unless the name says money or quantity.
  if (
    integer &&
    x.distinct === x.nonNull &&
    x.nonNull === x.rowCount &&
    x.rowCount > 20 &&
    s &&
    max - min + 1 <= x.rowCount * 1.05 &&
    !moneyNamed &&
    !t.includes("value") &&
    !t.includes("total") &&
    !has(t, QUANTITY_TOKENS)
  ) {
    return decide("identifier", 0.72, ROW_ID_REASON);
  }

  // A % sign in the values wins (the parser stored fractions). Otherwise a percent-like name decides and the
  // range gives the scale: within ±1 = fractions, within ±100 = points. A bare "Margin" above 1 is left to
  // the currency rule, since "margin" is also a money token; "Margin %" or "Margin Pct" stays a percentage.
  if (x.percentFormat)
    return decide("percentage", 0.95, "Values were written with a % sign.", {
      additivity: "non-additive",
      percentScale: 1,
    });
  // A header naming the rate itself ("Tax 5%", "GST @ 18%", "VAT 20%") heads the amount charged at that rate,
  // not a percentage: Myanmar's "Tax 5%" holds the tax on each sale, 0.51–49.65.
  const percentByName =
    has(t, PERCENT_TOKENS) && !has(t, new Set(["amount", "value", "total"])) && !/\d\s*%/.test(x.name);
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
  // Named a percentage, with the middle half of its values in points but a few impossible ones beside them
  // ("Discount_Pct" of 0–30 with a stray 110 or −5): still points. Read as money instead, its values were
  // summed as rupees and multiplied into revenue as whole numbers; the data check flags the strays.
  if (
    percentByName &&
    s &&
    s.q1 >= 0 &&
    s.q3 <= 100 &&
    s.q3 > 1 &&
    (!t.includes("margin") || t.includes("percent"))
  ) {
    return decide(
      "percentage",
      0.74,
      "Percentage by name, stored as points (0–100); a few values fall outside 0–100.",
      { additivity: "non-additive", percentScale: 100 },
    );
  }
  // Money, strongest evidence first. Additive by default, semi-additive for balances and snapshots,
  // non-additive per unit or on average: an explicit averaging word or a price rate always, an implicit
  // per-unit word ("Price") unless a total-like word overrides ("Total Price").
  const priceRate = rateIsPrice(t, x.name, max);
  const perUnit = has(t, AVERAGING) || priceRate;
  const money = (why: string, confidence: number): RoleDecision => {
    let additivity: Additivity = "additive";
    let reason = why;
    if (has(t, SEMI_ADDITIVE)) {
      additivity = "semi-additive";
      reason += " A balance/snapshot: add across items, not across time.";
    } else if (perUnit || (has(t, NON_ADDITIVE_CURRENCY) && !has(t, ADDITIVE_OVERRIDE))) {
      additivity = "non-additive";
      reason += " A per-unit price: use a weighted average, never a sum.";
    }
    return decide("currency", confidence, reason, { additivity });
  };
  // A currency symbol in the values, or a currency mark or code in the header ("ADR (€)", "AUM (₹ Cr)",
  // "GDP per capita (current US$)"). An explicit quantity or count word outranks a mark in the header
  // ("Refund Quantity", "Number of Orders (USD)" is a count), but not a symbol in the values.
  const explicitCount = t.includes("quantity") || t.includes("count") || countPhrase(x.name);
  if (x.currencyFormat)
    return money(
      `Currency symbol (${x.currencyFormat}) in the values.`,
      moneyNamed || moneyMarked ? 0.95 : 0.85,
    );
  if (moneyMarked && !explicitCount)
    return money("The name marks it as money (a currency sign or code).", 0.9);

  // A physical unit or a duration makes a money-worded column a quantity ("Budget Cement (MT)", "Net Wt
  // (gms)", "Net Absorption (mn sq ft)", "Credit Period (days)") and an index a meter reading ("Index relevé
  // (m³)"), unless the unit is a denominator: "Price/kg" is money per kilogram.
  if ((moneyNamed || t.includes("index")) && measuredInUnit(t, x.name)) {
    return moneyNamed
      ? decide("measure", 0.8, "Measured in a physical unit or in days, so a quantity, not money.", {
          additivity: measureAdditivity(t),
        })
      : decide("measure", 0.8, "A meter reading in a physical unit: add across meters, not across time.", {
          additivity: "semi-additive",
        });
  }

  // A discount, tax or commission rate stored as fractions of 0–1 ("Discount" 0.1) is a percentage.
  if (
    moneyWords.length > 0 &&
    moneyWords.every((w) => SHARE_MONEY.has(w)) &&
    !weakMoney &&
    s &&
    min >= 0 &&
    max <= 1 &&
    !integer
  ) {
    return decide(
      "percentage",
      0.8,
      "A discount, tax or commission rate stored as fractions (0–1), not an amount.",
      {
        additivity: "non-additive",
        percentScale: 1,
      },
    );
  }

  // Money per unit or on average ("Cost per item", "Avg. CPC", "Daily Rate"): currency, averaged and never
  // summed, rather than a rate. A ratio or score beside the money word keeps it a rate ("Average Interest
  // Rate", "Price Index"), and a count of payments per month stays a count.
  const ratio = has(t, RATIO_WORDS) || (t.includes("rate") && !priceRate);
  if ((moneyNamed || priceRate) && perUnit && !ratio && !counted)
    return money(
      priceRate && !moneyNamed
        ? "A rate charged per period or unit is a price."
        : "The name says it is money per unit or on average.",
      0.85,
    );

  // Rates, averages and scores are never summed; a fractional 0–1 share ("rate", "ratio", or a rate
  // abbreviation such as CTR) is shown as a percentage, so a CTR of 0.12 reads 12%, not 0.12. A share of a
  // whole by name (retention, attainment, completion) is a percentage: fractions up to 1.5 and points up to
  // 200, since attainment over target and net revenue retention pass 100%. Above that, or as a plural or a
  // duration, it counts or times something instead ("Retention" of 1,200 customers, "Completion Time").
  const shareOutcome =
    has(t, SHARE_OUTCOME) &&
    !counted &&
    !namesDuration(x.name, t) &&
    s !== undefined &&
    min >= 0 &&
    max <= 200;
  if (shareOutcome && !has(t, RATE_TOKENS)) {
    return max <= 1.5
      ? decide(
          "percentage",
          0.8,
          "A share of a whole (retention, attainment, completion) stored as fractions (1 = 100%).",
          {
            additivity: "non-additive",
            percentScale: 1,
          },
        )
      : decide(
          "percentage",
          0.78,
          "A share of a whole (retention, attainment, completion) stored as points (100 = 100%).",
          {
            additivity: "non-additive",
            percentScale: 100,
          },
        );
  }
  if (has(t, RATE_TOKENS) && !has(t, ADDITIVE_OVERRIDE)) {
    if (s && min >= 0 && max <= 1 && !integer && (has(t, SHARE_RATE_TOKENS) || shareOutcome)) {
      return decide("percentage", 0.8, "A rate stored as a fraction between 0 and 1.", {
        additivity: "non-additive",
        percentScale: 1,
      });
    }
    return decide("rate", 0.82, "Rate, average or score by name: averaged with weights, never summed.", {
      additivity: "non-additive",
    });
  }

  // Money by name. An explicit quantity or count word outranks a money word ("Refund Quantity", "Quantity
  // (- Refund)"), and so does a count in the plural with no amount word ("Active Loans", "Claims", "Net
  // Adds"): over whole numbers, or fractions when written in millions or lakhs. "Net" and "gross" qualify
  // counts as readily as money. A physical quantity or a duration as the head noun is not money either
  // ("Net Weight", "Sales Volume", "Loan Amount Term").
  const pluralCount =
    (integer || has(t, SCALE_TOKENS)) &&
    counted &&
    moneyWords.every((w) => COUNTABLE.has(w) || w === "net" || w === "gross") &&
    !weakMoney;
  if (moneyNamed && !explicitCount && !pluralCount && !MEASURED_HEADS.has(headNoun(t)))
    return money("The name says it is money (amount, price, revenue…).", 0.85);

  // A numbered register, till or store: a label, never a figure or a rating.
  // In the plural ("Outlets Billed", "Stores") the name counts them instead.
  const placesCounted =
    /\b(registers|tills|counters|lanes|terminals|kiosks|desks|machines|gates|stores|outlets|branches)\b/i.test(
      x.name,
    );
  if (
    integer &&
    has(t, NUMBERED_PLACE_TOKENS) &&
    !has(t, QUANTITY_TOKENS) &&
    !counted &&
    !moneyNamed &&
    !placesCounted
  ) {
    return decide("dimension", 0.75, "A numbered register, store or machine: a label, not a figure.");
  }
  // At most 10 distinct whole numbers under a category-like name (tier, priority, rating) are codes.
  if (integer && x.distinct <= 10 && has(t, DIMENSION_CODE_TOKENS) && !has(t, QUANTITY_TOKENS) && !counted) {
    return decide("dimension", 0.7, "A small set of whole-number codes, treated as categories.");
  }

  // A rating or score read from the values alone ("Q7", "Feedback", "Stars given"): whole or half steps
  // from 0 or 1 up to exactly 5, 7 or 10, with at least three points of the scale in use. Summing such a
  // column is meaningless, so it is averaged; quantity, count, snapshot and duration names were decided
  // above or below by name ("length_of_service" of 1–10 counts years), and the reason tells the user how
  // to change it if it is really a count.
  if (
    s &&
    x.nonNull >= 20 &&
    s.halfSteps &&
    min >= 0 &&
    min <= 1 &&
    (max === 5 || max === 7 || max === 10) &&
    x.distinct >= 3 &&
    !has(t, QUANTITY_TOKENS) &&
    !has(t, SEMI_ADDITIVE) &&
    !has(t, DURATION_TOKENS) &&
    !counted
  ) {
    return decide(
      "rate",
      0.62,
      `Values form a ${min}–${max} scale, like a rating or score: averaged, never summed. If it is really a count, set the role to Measure.`,
      { additivity: "non-additive" },
    );
  }

  // A count, a quantity, a physical unit of an amount (kg, litres, kWh) or a snapshot word other than a
  // level or reading ("Stock Level", "Inventory") says the column holds an amount: no measurement or
  // score word below overrides that.
  const amountNamed =
    counted ||
    has(t, QUANTITY_TOKENS) ||
    measuredInUnit(t, x.name) ||
    t.some((w) => SEMI_ADDITIVE.has(w) && w !== "level" && w !== "reading");

  // An ordinal score: whole numbers on a short scale (0–10) with few values, named like a quality,
  // grade, rank or level ("quality" of 3–9). Points on a scale are averaged; their sum means nothing.
  if (
    s &&
    integer &&
    min >= 0 &&
    max <= 10 &&
    x.distinct >= 3 &&
    x.distinct <= 11 &&
    has(t, ORDINAL_SCORE_TOKENS) &&
    !amountNamed
  ) {
    return decide(
      "measure",
      0.75,
      `Whole numbers on a ${min}–${max} scale under a name like a quality or grade: an ordinal score, averaged, never summed.`,
      { additivity: "non-additive" },
    );
  }

  // A concentration, level or reading by name or unit ("Residual sugar", "pH", "Chlorides (g/L)",
  // "Temperature (°C)", "NO2(GT)"): each row's own reading, averaged, never summed.
  const ph = PH_WORD.test(x.name) && s !== undefined && min >= 0 && max <= 14;
  if (
    !amountNamed &&
    (has(t, MEASUREMENT_TOKENS) || ph || MEASUREMENT_UNIT.test(x.name) || POLLUTANT.test(x.name))
  ) {
    return decide("measure", 0.8, MEASUREMENT_REASON, { additivity: "non-additive" });
  }

  // Fallback: a measure. Additivity comes from the name (snapshots → semi, per-row durations/ages/scores →
  // non); confidence drops to 0.6 when no name token supports the guess.
  let additivity: Additivity = "additive";
  const quantity = has(t, QUANTITY_TOKENS) || counted;
  let why = quantity ? "A count or quantity: safe to sum." : SUMMABLE_FALLBACK_REASON;
  if (has(t, SEMI_ADDITIVE)) {
    additivity = "semi-additive";
    why = "A stock/level snapshot: add across items, take the latest value over time.";
  } else if (has(t, NON_ADDITIVE_MEASURE) || isLeadTime(t)) {
    additivity = "non-additive";
    why = "A per-row duration, age or score: average it, don't sum it.";
  }
  return decide("measure", quantity || additivity !== "additive" ? 0.82 : 0.6, why, {
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
  // A status, stage or outcome is never a place, even when a value looks like one ("ok" is Oklahoma's code).
  const condition = has(t, STATUS_TOKENS);
  const pct = (share: number) => `${Math.round(share * 100)}%`;

  // Postal codes, checked before addresses so "Default Address Zip" holding "LS6 2DU" is a postcode: Indian
  // PIN, US ZIP or UK postcode values under a postal or address name, then a postal name over short codes
  // in a format Loupe doesn't check (Canada's "K1A 0B1", the Dutch "1012 AB", Brazil's CEP "01310-100").
  const pin = patternShare(p, "pincode");
  const zip = patternShare(p, "zip");
  const ukPostcode = patternShare(p, "postcode");
  const postalNamed = has(t, POSTAL) && !condition && !has(t, CLASSIFICATION_TOKENS);
  if ((postalNamed || has(t, ADDRESS_TOKENS)) && Math.max(pin, zip, ukPostcode) >= 0.8) {
    const region: GeoRegion | undefined = pin >= 0.8 ? "IN" : zip >= 0.8 ? "US" : undefined;
    const kind = pin >= 0.8 ? "Indian PIN codes" : zip >= 0.8 ? "US ZIP codes" : "UK postcodes";
    return decide("geo", 0.95, `Postal codes: the values are ${kind}.`, {
      geoLevel: "postal",
      ...(region ? { geoRegion: region } : {}),
    });
  }
  if (postalNamed && avgLen >= 3 && avgLen <= 10)
    return decide("geo", 0.8, "Postal codes by name, with short code values.", { geoLevel: "postal" });

  if (!condition) {
    // States and provinces: 60% recognised values, or 30% when the name agrees, named after their country.
    const stateShare = patternShare(p, "state");
    // An organisation's name ("Department": "DE", "Defra") is a place only when nearly every value is one.
    const organisation = has(t, ORGANISATION_TOKENS);
    if (
      (stateShare >= 0.6 || (has(t, STATE_TOKENS) && stateShare >= 0.3)) &&
      (!organisation || stateShare >= 0.95)
    ) {
      const region = x.stateRegion;
      return decide(
        "geo",
        stateShare >= 0.85 ? 0.95 : 0.8,
        `${pct(stateShare)} of values are recognised ${region ? STATE_REGION_LABEL[region] : "states"}.`,
        { geoLevel: "state", ...(region ? { geoRegion: region } : {}) },
      );
    }
    // Countries: names in any language, or ISO alpha-3 codes ("IND", "bra") under a country word in the
    // header, since codes alone are also words ("CAN", "PER").
    const countryNamed = has(t, COUNTRY_TOKENS);
    const countryShare = Math.max(
      patternShare(p, "country"),
      countryNamed ? patternShare(p, "countrycode") : 0,
    );
    if (
      (countryShare >= 0.6 || (countryNamed && countryShare >= 0.3)) &&
      (!organisation || countryShare >= 0.95)
    ) {
      return decide("geo", 0.9, `${pct(countryShare)} of values are recognised countries.`, {
        geoLevel: "country",
        geoRegion: "WORLD",
      });
    }
    // Places named by their header: a city, town, village, district, county or municipality (or a
    // province, one level up) is a place even when Loupe doesn't know the values, provided they are short
    // and the name doesn't classify ("City Tier" and "City_Category" are categories). Without the name,
    // half the values must be known cities.
    const placeNamed = avgLen <= 40 && !has(t, CLASSIFICATION_TOKENS);
    const cityWord = placeNamed ? t.find((w) => CITY_TOKENS.has(w)) : undefined;
    const cityShare = patternShare(p, "city");
    if (cityWord || cityShare >= 0.5) {
      return decide(
        "geo",
        cityWord ? 0.88 : 0.75,
        cityWord
          ? `${cityWord.charAt(0).toUpperCase()}${cityWord.slice(1)} by name.`
          : `${pct(cityShare)} of values are known cities.`,
        { geoLevel: "city" },
      );
    }
    if (placeNamed && has(t, PROVINCE_TOKENS))
      return decide("geo", 0.8, "Province by name: a state-level place.", { geoLevel: "state" });
  }
  if (has(t, ADDRESS_TOKENS)) return decide("text", 0.8, "Street address text.", { geoLevel: "address" });
  // A region word with a classification word is a segment, not a place ("Market Segment", "Zone Type").
  if (has(t, REGION_TOKENS) && !has(t, CLASSIFICATION_TOKENS) && !condition && x.distinct <= 60)
    return decide("geo", 0.72, "Sales region or zone.", { geoLevel: "region" });

  // Identifiers by name (more than 50 distinct values): an ID word, an entity's number, a bare "No." or
  // "#", or an entity's bare name over code-like values ("Material", "Order"). Never a name, title or
  // text field ("Ticket name"), nor values written as sentences: IDs have no spaces.
  const titled =
    has(t, TEXT_TOKENS) || has(t, PICKED_TEXT_TOKENS) || has(t, NAME_TOKENS) || has(t, TITLE_TOKENS);
  const sentences = (x.spaceShare ?? 0) > 0.5 && avgLen > 20;
  const idByName =
    !titled &&
    !sentences &&
    (has(t, ID_TOKENS) ||
      (t.includes("number") && has(t, NUMBER_ENTITY)) ||
      t.some((w) => FUSED_ID.test(w)) ||
      bareNumber(t) ||
      (entityNamed(t, x.name) && patternShare(p, "id") >= 0.8));
  if (idByName && x.distinct > 50)
    return decide("identifier", 0.9, "ID-like name with many distinct values; counted, never summed.");
  if (patternShare(p, "uuid") >= 0.9) return decide("identifier", 0.95, "UUID values.");

  // Free text: a text-like name ("Comments", "Narration", "Action Taken", "Ticket name") over values of more
  // than 15 characters, or a reason or resolution whose values vary (a handful of reasons repeated down the
  // column is a dimension); values over 60 characters; or over 30 when mostly unique and mostly with spaces
  // (sentences, not codes).
  const textNamed = has(t, TEXT_TOKENS) || (has(t, WORK_ITEMS) && has(t, TITLE_TOKENS));
  const fewCategories = x.distinct <= 30 && cardinality < 0.3;
  if (avgLen > 15 && (textNamed || (has(t, PICKED_TEXT_TOKENS) && !fewCategories)))
    return decide("text", 0.85, "Descriptive free text.");
  // Mostly unique codes are identifiers, unless the name says they classify ("Type", "Category").
  if (patternShare(p, "id") >= 0.9 && cardinality >= 0.5 && x.distinct > 50 && !has(t, CLASSIFICATION_TOKENS))
    return decide("identifier", 0.8, "Code-like values that are mostly unique.");
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

/** Words of a header that only numbers the rows ("Id", "Index", "Unnamed: 0", "#"). */
const ROW_INDEX_TOKENS = new Set([
  "id",
  "index",
  "idx",
  "row",
  "number",
  "serial",
  "unnamed",
  "sr",
  "sno",
  "no",
  "#",
]);

/**
 * An identifier that only numbers the rows: unique, and either a run of whole
 * numbers (the row-number rule) or named only with index words ("Id",
 * "Index", "Unnamed: 0", "#"). It says nothing about what the rows are.
 */
export const isRowIndex = (c: ColumnProfile): boolean =>
  c.role === "identifier" &&
  c.unique &&
  (c.roleReason === ROW_ID_REASON || c.tokens.every((w) => ROW_INDEX_TOKENS.has(w) || /^\d+$/.test(w)));

/** A measure that reached the low-confidence fallback: nothing in its name says what it holds. */
const isSummableFallback = (c: ColumnProfile): boolean =>
  c.role === "measure" && c.additivity === "additive" && c.roleReason === SUMMABLE_FALLBACK_REASON;

/**
 * A measure saying the table holds amounts: money, a named count or quantity,
 * a snapshot, or a fallback measured in a physical unit of an amount or
 * named after things counted one by one.
 */
function extensive(c: ColumnProfile): boolean {
  if (c.role === "currency") return true;
  if (c.role !== "measure" || c.additivity === "non-additive") return false;
  if (!isSummableFallback(c)) return true;
  return c.tokens.some(
    (w) => PHYSICAL_UNITS.has(w) || QUANTITY_TOKENS.has(w) || COUNTABLE.has(w) || w === "population",
  );
}

/**
 * A table of measurements: no identifier (beyond a column that only numbers
 * the rows), no date, at least four numeric measures, and none of them money,
 * a count, a quantity or another amount (a wine-quality or iris table, lab
 * results). Each row is one thing measured, so its numbers are readings:
 * every measure that only reached the summable fallback is made non-additive
 * (averaged, never summed). Measures named as readings already are
 * (MEASUREMENT_TOKENS). Any other table is returned unchanged. Runs once per
 * profile, after every column's role (profile.ts profileDataset).
 */
export function readingsTable(columns: ColumnProfile[]): ColumnProfile[] {
  if (columns.some((c) => c.storage === "date")) return columns;
  if (columns.some((c) => c.role === "identifier" && !isRowIndex(c))) return columns;
  const measures = columns.filter(
    (c) =>
      c.storage === "number" &&
      (c.role === "measure" || c.role === "currency" || c.role === "rate" || c.role === "percentage"),
  );
  if (measures.length < 4 || measures.some(extensive)) return columns;
  return columns.map((c) =>
    isSummableFallback(c)
      ? {
          ...c,
          additivity: "non-additive",
          defaultAgg: "avg",
          roleConfidence: 0.7,
          roleReason: OBSERVATION_REASON,
        }
      : c,
  );
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
