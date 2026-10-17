/**
 * Geographic dictionaries: Indian states/UTs (with tile-map layout), US states, countries, major cities.
 *
 * Lookups compare a normalised form (lower-case, "&" → "and", letters only,
 * so digits and punctuation are ignored). Aliases of two or three letters
 * are old or alternative codes ("or" for Odisha, "ut", "ct", "ts", "dnh"),
 * several of them also US codes, so they are matched like codes: only when
 * codes are allowed. patterns.detectStatePattern counts name hits to pick the
 * region, and a US code column containing OR, UT or CT must not read as
 * Indian.
 */

export interface StateDef {
  /** Two-letter code used for code matching and display. */
  code: string;
  name: string;
  /** Alternative spellings and old names (Orissa, Pondicherry), matched like names; two- or three-letter aliases are matched like codes. */
  aliases: string[];
  /** Tile-grid position (row, col) for the tile map. */
  tile: [number, number];
}

/** States and union territories; tile rows run roughly north → south and columns west → east. */
export const INDIA_STATES: StateDef[] = [
  {
    code: "JK",
    name: "Jammu and Kashmir",
    aliases: ["jammu & kashmir", "j&k", "j and k", "jammu kashmir"],
    tile: [0, 1],
  },
  { code: "LA", name: "Ladakh", aliases: [], tile: [0, 2] },
  { code: "PB", name: "Punjab", aliases: [], tile: [1, 1] },
  { code: "HP", name: "Himachal Pradesh", aliases: ["himachal"], tile: [1, 2] },
  { code: "CH", name: "Chandigarh", aliases: [], tile: [2, 1] },
  { code: "HR", name: "Haryana", aliases: [], tile: [2, 2] },
  { code: "UK", name: "Uttarakhand", aliases: ["uttaranchal", "ut"], tile: [2, 3] },
  { code: "AR", name: "Arunachal Pradesh", aliases: ["arunachal"], tile: [2, 7] },
  { code: "RJ", name: "Rajasthan", aliases: [], tile: [3, 1] },
  {
    code: "DL",
    name: "Delhi",
    aliases: ["new delhi", "nct of delhi", "delhi ncr", "nct delhi"],
    tile: [3, 2],
  },
  { code: "UP", name: "Uttar Pradesh", aliases: [], tile: [3, 3] },
  { code: "BR", name: "Bihar", aliases: [], tile: [3, 4] },
  { code: "SK", name: "Sikkim", aliases: [], tile: [3, 5] },
  { code: "ML", name: "Meghalaya", aliases: [], tile: [3, 6] },
  { code: "AS", name: "Assam", aliases: [], tile: [3, 7] },
  { code: "NL", name: "Nagaland", aliases: [], tile: [3, 8] },
  { code: "GJ", name: "Gujarat", aliases: [], tile: [4, 1] },
  { code: "MP", name: "Madhya Pradesh", aliases: [], tile: [4, 2] },
  { code: "CG", name: "Chhattisgarh", aliases: ["chattisgarh", "chhatisgarh", "ct"], tile: [4, 3] },
  { code: "JH", name: "Jharkhand", aliases: [], tile: [4, 4] },
  { code: "WB", name: "West Bengal", aliases: ["bengal"], tile: [4, 5] },
  { code: "TR", name: "Tripura", aliases: [], tile: [4, 6] },
  { code: "MN", name: "Manipur", aliases: [], tile: [4, 7] },
  {
    code: "DH",
    name: "Dadra and Nagar Haveli and Daman and Diu",
    aliases: ["dadra and nagar haveli", "daman and diu", "dnh", "dd", "dn"],
    tile: [5, 1],
  },
  { code: "MH", name: "Maharashtra", aliases: [], tile: [5, 2] },
  { code: "TG", name: "Telangana", aliases: ["ts", "telengana"], tile: [5, 3] },
  { code: "OD", name: "Odisha", aliases: ["orissa", "or"], tile: [5, 4] },
  { code: "MZ", name: "Mizoram", aliases: [], tile: [5, 7] },
  { code: "GA", name: "Goa", aliases: [], tile: [6, 1] },
  { code: "KA", name: "Karnataka", aliases: [], tile: [6, 2] },
  { code: "AP", name: "Andhra Pradesh", aliases: ["andhra"], tile: [6, 3] },
  { code: "LD", name: "Lakshadweep", aliases: [], tile: [7, 0] },
  { code: "KL", name: "Kerala", aliases: [], tile: [7, 2] },
  { code: "TN", name: "Tamil Nadu", aliases: ["tamilnadu"], tile: [7, 3] },
  { code: "PY", name: "Puducherry", aliases: ["pondicherry", "pondy"], tile: [7, 4] },
  {
    code: "AN",
    name: "Andaman and Nicobar Islands",
    aliases: ["andaman & nicobar", "andaman and nicobar", "a&n islands"],
    tile: [7, 7],
  },
];

/** 50 states plus DC as [code, name, tile row, tile col] in a US tile-grid layout; no aliases. */
export const US_STATES: StateDef[] = [
  ["AK", "Alaska", 0, 0],
  ["ME", "Maine", 0, 10],
  ["VT", "Vermont", 1, 9],
  ["NH", "New Hampshire", 1, 10],
  ["WA", "Washington", 2, 0],
  ["ID", "Idaho", 2, 1],
  ["MT", "Montana", 2, 2],
  ["ND", "North Dakota", 2, 3],
  ["MN", "Minnesota", 2, 4],
  ["IL", "Illinois", 2, 5],
  ["WI", "Wisconsin", 2, 6],
  ["MI", "Michigan", 2, 7],
  ["NY", "New York", 2, 8],
  ["RI", "Rhode Island", 2, 9],
  ["MA", "Massachusetts", 2, 10],
  ["OR", "Oregon", 3, 0],
  ["NV", "Nevada", 3, 1],
  ["WY", "Wyoming", 3, 2],
  ["SD", "South Dakota", 3, 3],
  ["IA", "Iowa", 3, 4],
  ["IN", "Indiana", 3, 5],
  ["OH", "Ohio", 3, 6],
  ["PA", "Pennsylvania", 3, 7],
  ["NJ", "New Jersey", 3, 8],
  ["CT", "Connecticut", 3, 9],
  ["CA", "California", 4, 0],
  ["UT", "Utah", 4, 1],
  ["CO", "Colorado", 4, 2],
  ["NE", "Nebraska", 4, 3],
  ["MO", "Missouri", 4, 4],
  ["KY", "Kentucky", 4, 5],
  ["WV", "West Virginia", 4, 6],
  ["VA", "Virginia", 4, 7],
  ["MD", "Maryland", 4, 8],
  ["DE", "Delaware", 4, 9],
  ["AZ", "Arizona", 5, 1],
  ["NM", "New Mexico", 5, 2],
  ["KS", "Kansas", 5, 3],
  ["AR", "Arkansas", 5, 4],
  ["TN", "Tennessee", 5, 5],
  ["NC", "North Carolina", 5, 6],
  ["SC", "South Carolina", 5, 7],
  ["DC", "District of Columbia", 5, 8],
  ["OK", "Oklahoma", 6, 3],
  ["LA", "Louisiana", 6, 4],
  ["MS", "Mississippi", 6, 5],
  ["AL", "Alabama", 6, 6],
  ["GA", "Georgia", 6, 7],
  ["HI", "Hawaii", 7, 0],
  ["TX", "Texas", 7, 3],
  ["FL", "Florida", 7, 8],
].map(([code, name, r, c]) => ({
  code: code as string,
  name: name as string,
  aliases: [],
  tile: [r as number, c as number],
}));

/**
 * A state or province of a country Loupe has no tile map for: recognised so
 * the column reads as a place, named in its reason, never drawn as a map.
 */
export interface RegionStateDef {
  /** The code the country's own data uses (Brazil's UF, Canada Post, Australia Post). */
  code: string;
  name: string;
  /** Spellings with and without accents are both covered by norm(); these are other names. */
  aliases: string[];
}

const regionDefs = (rows: ReadonlyArray<readonly [string, string, ...string[]]>): RegionStateDef[] =>
  rows.map(([code, name, ...aliases]) => ({ code, name, aliases }));

/** Brazil's 26 states and the Federal District, with their UF codes (SP, RJ, MG…). */
export const BRAZIL_STATES: RegionStateDef[] = regionDefs([
  ["AC", "Acre"],
  ["AL", "Alagoas"],
  ["AP", "Amapá"],
  ["AM", "Amazonas"],
  ["BA", "Bahia"],
  ["CE", "Ceará"],
  ["DF", "Distrito Federal"],
  ["ES", "Espírito Santo"],
  ["GO", "Goiás"],
  ["MA", "Maranhão"],
  ["MT", "Mato Grosso"],
  ["MS", "Mato Grosso do Sul"],
  ["MG", "Minas Gerais"],
  ["PA", "Pará"],
  ["PB", "Paraíba"],
  ["PR", "Paraná"],
  ["PE", "Pernambuco"],
  ["PI", "Piauí"],
  ["RJ", "Rio de Janeiro"],
  ["RN", "Rio Grande do Norte"],
  ["RS", "Rio Grande do Sul"],
  ["RO", "Rondônia"],
  ["RR", "Roraima"],
  ["SC", "Santa Catarina"],
  ["SP", "São Paulo"],
  ["SE", "Sergipe"],
  ["TO", "Tocantins"],
]);

/** Canada's provinces and territories with their postal abbreviations. */
export const CANADA_PROVINCES: RegionStateDef[] = regionDefs([
  ["AB", "Alberta"],
  ["BC", "British Columbia", "Colombie-Britannique"],
  ["MB", "Manitoba"],
  ["NB", "New Brunswick", "Nouveau-Brunswick"],
  ["NL", "Newfoundland and Labrador", "Newfoundland"],
  ["NS", "Nova Scotia", "Nouvelle-Écosse"],
  ["NT", "Northwest Territories"],
  ["NU", "Nunavut"],
  ["ON", "Ontario"],
  ["PE", "Prince Edward Island"],
  ["QC", "Quebec"],
  ["SK", "Saskatchewan"],
  ["YT", "Yukon"],
]);

/** Australia's states and territories with their usual abbreviations (NSW, VIC, QLD…). */
export const AUSTRALIA_STATES: RegionStateDef[] = regionDefs([
  ["NSW", "New South Wales"],
  ["VIC", "Victoria"],
  ["QLD", "Queensland"],
  ["WA", "Western Australia"],
  ["SA", "South Australia"],
  ["TAS", "Tasmania"],
  ["ACT", "Australian Capital Territory"],
  ["NT", "Northern Territory"],
]);

/**
 * Mexico's 31 states and its capital, matched by name only: their ISO codes
 * (MEX, COL, GUA…) are also country codes and ordinary words. The State of
 * Mexico is matched by its full name or "Edomex", never by "México", which
 * names the country.
 */
export const MEXICO_STATES: RegionStateDef[] = regionDefs([
  ["AGU", "Aguascalientes"],
  ["BCN", "Baja California"],
  ["BCS", "Baja California Sur"],
  ["CAM", "Campeche"],
  ["CHP", "Chiapas"],
  ["CHH", "Chihuahua"],
  ["CMX", "Ciudad de México", "CDMX"],
  ["COA", "Coahuila"],
  ["COL", "Colima"],
  ["DUR", "Durango"],
  ["GUA", "Guanajuato"],
  ["GRO", "Guerrero"],
  ["HID", "Hidalgo"],
  ["JAL", "Jalisco"],
  ["MEX", "Estado de México", "Edomex"],
  ["MIC", "Michoacán"],
  ["MOR", "Morelos"],
  ["NAY", "Nayarit"],
  ["NLE", "Nuevo León"],
  ["OAX", "Oaxaca"],
  ["PUE", "Puebla"],
  ["QUE", "Querétaro"],
  ["ROO", "Quintana Roo"],
  ["SLP", "San Luis Potosí"],
  ["SIN", "Sinaloa"],
  ["SON", "Sonora"],
  ["TAB", "Tabasco"],
  ["TAM", "Tamaulipas"],
  ["TLA", "Tlaxcala"],
  ["VER", "Veracruz"],
  ["YUC", "Yucatán"],
  ["ZAC", "Zacatecas"],
]);

/**
 * Lookup key: accents folded ("São Paulo" → "sao paulo", "Málaga" → "malaga",
 * "Österreich" → "osterreich"; without this the accented letter was dropped
 * and the name never matched), lower-case, "&" → " and ", non-letters → space,
 * single-spaced and trimmed.
 */
const norm = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A place name never contains a digit. Without this check norm() would turn
 * codes such as "OD1003" or "KA-01" into "od" or "ka" and match a state.
 */
const hasDigit = (s: string): boolean => /\d/.test(s);

/** A short single-word alias such as "or" or "dnh": an old code, not a name. */
const isCodeAlias = (normalised: string): boolean => /^[a-z]{2,3}$/.test(normalised);

/** Normalised name and long aliases (and, optionally, the lower-case code and short aliases) → state. */
function buildLookup<T extends RegionStateDef>(states: readonly T[], includeCodes: boolean): Map<string, T> {
  const m = new Map<string, T>();
  for (const s of states) {
    m.set(norm(s.name), s);
    for (const a of s.aliases) {
      const k = norm(a);
      if (includeCodes || !isCodeAlias(k)) m.set(k, s);
    }
    if (includeCodes) m.set(s.code.toLowerCase(), s);
  }
  return m;
}

const INDIA_LOOKUP = buildLookup(INDIA_STATES, true);
const INDIA_NAME_LOOKUP = buildLookup(INDIA_STATES, false);
const US_LOOKUP = buildLookup(US_STATES, true);
const US_NAME_LOOKUP = buildLookup(US_STATES, false);

/** Matches a name or long alias, or (when allowCodes) a code or short alias such as "ut", "ct", "or". */
export function matchIndianState(value: string, allowCodes = true): StateDef | undefined {
  if (hasDigit(value)) return undefined;
  return (allowCodes ? INDIA_LOOKUP : INDIA_NAME_LOOKUP).get(norm(value));
}

/** Matches a full name or (when allowCodes) a USPS code. */
export function matchUsState(value: string, allowCodes = true): StateDef | undefined {
  if (hasDigit(value)) return undefined;
  return (allowCodes ? US_LOOKUP : US_NAME_LOOKUP).get(norm(value));
}

/** Countries whose states or provinces Loupe recognises; only IN and US also have a tile map. */
export type StateRegion = "IN" | "US" | "BR" | "CA" | "AU" | "MX";

/** Every state region, in the order ties are broken (India first, as before). */
export const STATE_REGIONS: readonly StateRegion[] = ["IN", "US", "BR", "CA", "AU", "MX"];

/** What a region's states are called in a reason: "Indian states", "Canadian provinces". */
export const STATE_REGION_LABEL: Record<StateRegion, string> = {
  IN: "Indian states",
  US: "US states",
  BR: "Brazilian states",
  CA: "Canadian provinces",
  AU: "Australian states",
  MX: "Mexican states",
};

// Lookups for the regions without tile maps. Mexico's codes stay out (see MEXICO_STATES).
const OTHER_LOOKUP = {
  BR: { all: buildLookup(BRAZIL_STATES, true), names: buildLookup(BRAZIL_STATES, false) },
  CA: { all: buildLookup(CANADA_PROVINCES, true), names: buildLookup(CANADA_PROVINCES, false) },
  AU: { all: buildLookup(AUSTRALIA_STATES, true), names: buildLookup(AUSTRALIA_STATES, false) },
  MX: { all: buildLookup(MEXICO_STATES, false), names: buildLookup(MEXICO_STATES, false) },
};

/** A state or province of `region` by name or alias, or (when allowCodes) by its code. */
export function matchRegionState(
  value: string,
  region: StateRegion,
  allowCodes = true,
): RegionStateDef | undefined {
  if (region === "IN") return matchIndianState(value, allowCodes);
  if (region === "US") return matchUsState(value, allowCodes);
  if (hasDigit(value)) return undefined;
  const lookup = OTHER_LOOKUP[region];
  return (allowCodes ? lookup.all : lookup.names).get(norm(value));
}

/** Lower-case country names plus common short forms (uk, usa, uae); "georgia" is also a US state. */
export const COUNTRIES = [
  "afghanistan",
  "albania",
  "algeria",
  "andorra",
  "angola",
  "argentina",
  "armenia",
  "australia",
  "austria",
  "azerbaijan",
  "bahamas",
  "bahrain",
  "bangladesh",
  "barbados",
  "belarus",
  "belgium",
  "belize",
  "benin",
  "bhutan",
  "bolivia",
  "bosnia and herzegovina",
  "botswana",
  "brazil",
  "brunei",
  "bulgaria",
  "burkina faso",
  "burundi",
  "cambodia",
  "cameroon",
  "canada",
  "chad",
  "chile",
  "china",
  "colombia",
  "congo",
  "costa rica",
  "croatia",
  "cuba",
  "cyprus",
  "czech republic",
  "czechia",
  "denmark",
  "djibouti",
  "dominican republic",
  "ecuador",
  "egypt",
  "el salvador",
  "estonia",
  "eswatini",
  "ethiopia",
  "fiji",
  "finland",
  "france",
  "gabon",
  "gambia",
  "georgia",
  "germany",
  "ghana",
  "greece",
  "guatemala",
  "guinea",
  "guyana",
  "haiti",
  "honduras",
  "hong kong",
  "hungary",
  "iceland",
  "india",
  "indonesia",
  "iran",
  "iraq",
  "ireland",
  "israel",
  "italy",
  "ivory coast",
  "jamaica",
  "japan",
  "jordan",
  "kazakhstan",
  "kenya",
  "kuwait",
  "kyrgyzstan",
  "laos",
  "latvia",
  "lebanon",
  "lesotho",
  "liberia",
  "libya",
  "liechtenstein",
  "lithuania",
  "luxembourg",
  "madagascar",
  "malawi",
  "malaysia",
  "maldives",
  "mali",
  "malta",
  "mauritania",
  "mauritius",
  "mexico",
  "moldova",
  "monaco",
  "mongolia",
  "montenegro",
  "morocco",
  "mozambique",
  "myanmar",
  "namibia",
  "nepal",
  "netherlands",
  "new zealand",
  "nicaragua",
  "niger",
  "nigeria",
  "north korea",
  "north macedonia",
  "norway",
  "oman",
  "pakistan",
  "panama",
  "papua new guinea",
  "paraguay",
  "peru",
  "philippines",
  "poland",
  "portugal",
  "qatar",
  "romania",
  "russia",
  "rwanda",
  "saudi arabia",
  "senegal",
  "serbia",
  "seychelles",
  "sierra leone",
  "singapore",
  "slovakia",
  "slovenia",
  "somalia",
  "south africa",
  "south korea",
  "korea",
  "spain",
  "sri lanka",
  "sudan",
  "suriname",
  "sweden",
  "switzerland",
  "syria",
  "taiwan",
  "tajikistan",
  "tanzania",
  "thailand",
  "togo",
  "trinidad and tobago",
  "tunisia",
  "turkey",
  "turkiye",
  "turkmenistan",
  "uganda",
  "ukraine",
  "united arab emirates",
  "uae",
  "united kingdom",
  "uk",
  "great britain",
  "england",
  "scotland",
  "wales",
  "united states",
  "united states of america",
  "usa",
  "us",
  "america",
  "uruguay",
  "uzbekistan",
  "venezuela",
  "vietnam",
  "yemen",
  "zambia",
  "zimbabwe",
];
/**
 * Country names as files from other countries write them: the country's own
 * name and the French, German, Spanish, Portuguese and Italian names analysts
 * meet most (accents are folded by norm(), so "España" is "espana").
 */
const COUNTRY_LOCAL_NAMES = [
  "deutschland",
  "allemagne",
  "alemania",
  "alemanha",
  "germania",
  "belgique",
  "belgie",
  "belgien",
  "belgica",
  "espana",
  "espagne",
  "spanien",
  "spagna",
  "espanha",
  "brasil",
  "bresil",
  "brasilien",
  "italia",
  "italie",
  "italien",
  "osterreich",
  "autriche",
  "schweiz",
  "suisse",
  "svizzera",
  "suiza",
  "nederland",
  "niederlande",
  "pays bas",
  "paises bajos",
  "polska",
  "pologne",
  "polen",
  "mexique",
  "mexiko",
  "turkiye",
  "turquie",
  "turkei",
  "turquia",
  "sverige",
  "suede",
  "schweden",
  "suecia",
  "norge",
  "norvege",
  "norwegen",
  "noruega",
  "danmark",
  "danemark",
  "dinamarca",
  "suomi",
  "finlande",
  "finnland",
  "irlande",
  "irland",
  "royaume uni",
  "reino unido",
  "grossbritannien",
  "etats unis",
  "estados unidos",
  "vereinigte staaten",
  "eeuu",
  "chine",
  "inde",
  "indien",
  "japon",
  "russie",
  "russland",
  "rusia",
  "argentine",
  "argentinien",
  "chili",
  "perou",
  "colombie",
  "kolumbien",
  "maroc",
  "marruecos",
  "marokko",
  "egypte",
  "egipto",
  "agypten",
  "grece",
  "griechenland",
  "grecia",
  "tchequie",
  "tschechien",
  "republica checa",
  "hongrie",
  "ungarn",
  "hungria",
  "roumanie",
  "rumanien",
  "rumania",
  "croatie",
  "kroatien",
  "croacia",
  "hrvatska",
];

const COUNTRY_SET = new Set([...COUNTRIES, ...COUNTRY_LOCAL_NAMES]);

export function isCountry(value: string): boolean {
  return !hasDigit(value) && COUNTRY_SET.has(norm(value));
}

/**
 * ISO 3166-1 alpha-3 codes, the codes statistical and warehouse tables use
 * (World Bank, IMF, Olist exports). Many are also everyday words ("CAN",
 * "PER", "AND"), so a column counts as countries by its codes only under a
 * country word in the header (roles.ts).
 */
const ISO3_CODES = new Set(
  (
    "AFG ALA ALB DZA ASM AND AGO AIA ATA ATG ARG ARM ABW AUS AUT AZE BHS BHR BGD BRB BLR BEL BLZ BEN BMU BTN " +
    "BOL BES BIH BWA BVT BRA IOT BRN BGR BFA BDI CPV KHM CMR CAN CYM CAF TCD CHL CHN CXR CCK COL COM COG COD " +
    "COK CRI CIV HRV CUB CUW CYP CZE DNK DJI DMA DOM ECU EGY SLV GNQ ERI EST SWZ ETH FLK FRO FJI FIN FRA GUF " +
    "PYF ATF GAB GMB GEO DEU GHA GIB GRC GRL GRD GLP GUM GTM GGY GIN GNB GUY HTI HMD VAT HND HKG HUN ISL IND " +
    "IDN IRN IRQ IRL IMN ISR ITA JAM JPN JEY JOR KAZ KEN KIR PRK KOR KWT KGZ LAO LVA LBN LSO LBR LBY LIE LTU " +
    "LUX MAC MDG MWI MYS MDV MLI MLT MHL MTQ MRT MUS MYT MEX FSM MDA MCO MNG MNE MSR MAR MOZ MMR NAM NRU NPL " +
    "NLD NCL NZL NIC NER NGA NIU NFK MKD MNP NOR OMN PAK PLW PSE PAN PNG PRY PER PHL PCN POL PRT PRI QAT REU " +
    "ROU RUS RWA BLM SHN KNA LCA MAF SPM VCT WSM SMR STP SAU SEN SRB SYC SLE SGP SXM SVK SVN SLB SOM ZAF SGS " +
    "SSD ESP LKA SDN SUR SJM SWE CHE SYR TWN TJK TZA THA TLS TGO TKL TON TTO TUN TUR TKM TCA TUV UGA UKR ARE " +
    "GBR USA UMI URY UZB VUT VEN VNM VGB VIR WLF ESH YEM ZMB ZWE XKX"
  ).split(" "),
);

/** An ISO alpha-3 country code, in either case ("IND", "bra"). */
export function isCountryCode(value: string): boolean {
  const v = value.trim();
  return v.length === 3 && ISO3_CODES.has(v.toUpperCase());
}

/** Major cities, lower-case, including old and alternate names (bangalore/bengaluru, gurgaon/gurugram). */
export const INDIAN_CITIES = [
  "mumbai",
  "delhi",
  "new delhi",
  "bengaluru",
  "bangalore",
  "hyderabad",
  "ahmedabad",
  "chennai",
  "kolkata",
  "pune",
  "surat",
  "jaipur",
  "lucknow",
  "kanpur",
  "nagpur",
  "indore",
  "thane",
  "bhopal",
  "visakhapatnam",
  "vizag",
  "patna",
  "vadodara",
  "ghaziabad",
  "ludhiana",
  "agra",
  "nashik",
  "faridabad",
  "meerut",
  "rajkot",
  "varanasi",
  "srinagar",
  "aurangabad",
  "dhanbad",
  "amritsar",
  "navi mumbai",
  "allahabad",
  "prayagraj",
  "ranchi",
  "howrah",
  "coimbatore",
  "jabalpur",
  "gwalior",
  "vijayawada",
  "jodhpur",
  "madurai",
  "raipur",
  "kota",
  "guwahati",
  "chandigarh",
  "solapur",
  "mysuru",
  "mysore",
  "tiruchirappalli",
  "bareilly",
  "aligarh",
  "tiruppur",
  "gurgaon",
  "gurugram",
  "moradabad",
  "jalandhar",
  "bhubaneswar",
  "salem",
  "warangal",
  "thiruvananthapuram",
  "trivandrum",
  "bhiwandi",
  "saharanpur",
  "noida",
  "greater noida",
  "dehradun",
  "kochi",
  "cochin",
  "jammu",
  "mangaluru",
  "mangalore",
  "udaipur",
  "bhavnagar",
  "jamnagar",
  "ujjain",
  "siliguri",
  "jhansi",
  "nellore",
  "belagavi",
  "belgaum",
  "ajmer",
  "gaya",
  "kozhikode",
  "calicut",
  "tirunelveli",
  "goa",
  "panaji",
  "puducherry",
  "pondicherry",
  "shimla",
  "imphal",
  "shillong",
  "agartala",
  "aizawl",
  "kohima",
  "itanagar",
  "gangtok",
  "durgapur",
  "asansol",
  "hubli",
  "dharwad",
  "vellore",
  "thrissur",
  "kolhapur",
  "sangli",
  "bikaner",
  "haridwar",
  "rishikesh",
  "mathura",
  "gorakhpur",
  "cuttack",
  "rourkela",
  "bokaro",
  "jamshedpur",
  "bilaspur",
  "durg",
  "bhilai",
  "kakinada",
  "guntur",
  "tirupati",
  "anand",
  "gandhinagar",
  "hisar",
  "panipat",
  "karnal",
  "rohtak",
  "sonipat",
  "bathinda",
  "patiala",
];
export const WORLD_CITIES = [
  "new york",
  "los angeles",
  "chicago",
  "houston",
  "phoenix",
  "philadelphia",
  "san antonio",
  "san diego",
  "dallas",
  "austin",
  "san francisco",
  "seattle",
  "boston",
  "denver",
  "atlanta",
  "miami",
  "washington",
  "toronto",
  "vancouver",
  "montreal",
  "london",
  "manchester",
  "birmingham",
  "paris",
  "berlin",
  "munich",
  "hamburg",
  "madrid",
  "barcelona",
  "rome",
  "milan",
  "amsterdam",
  "brussels",
  "vienna",
  "zurich",
  "geneva",
  "stockholm",
  "oslo",
  "copenhagen",
  "helsinki",
  "dublin",
  "lisbon",
  "prague",
  "warsaw",
  "budapest",
  "athens",
  "istanbul",
  "moscow",
  "dubai",
  "abu dhabi",
  "doha",
  "riyadh",
  "tel aviv",
  "cairo",
  "lagos",
  "nairobi",
  "johannesburg",
  "cape town",
  "singapore",
  "hong kong",
  "shanghai",
  "beijing",
  "shenzhen",
  "tokyo",
  "osaka",
  "seoul",
  "bangkok",
  "jakarta",
  "manila",
  "kuala lumpur",
  "ho chi minh city",
  "hanoi",
  "sydney",
  "melbourne",
  "brisbane",
  "perth",
  "auckland",
  "mexico city",
  "sao paulo",
  "rio de janeiro",
  "buenos aires",
  "lima",
  "bogota",
  "santiago",
  "karachi",
  "lahore",
  "dhaka",
  "colombo",
  "kathmandu",
];
/**
 * More cities analysts' files name: the large cities of Brazil, Spain, France,
 * Germany, Italy, the UK, the US, Canada, Australia, Mexico and other markets,
 * in English and local spellings (accents folded by norm()). Cities that are
 * also everyday words or first names (Reading, Nice, Charlotte) stay out, so
 * a column of words never passes for a list of places.
 */
const MORE_CITIES = [
  // Brazil
  "curitiba",
  "belo horizonte",
  "porto alegre",
  "campinas",
  "salvador",
  "fortaleza",
  "recife",
  "brasilia",
  "manaus",
  "belem",
  "goiania",
  "florianopolis",
  "sorocaba",
  // Spain and Portugal
  "sevilla",
  "seville",
  "valencia",
  "malaga",
  "bilbao",
  "zaragoza",
  "alicante",
  "granada",
  "palma",
  "benidorm",
  "porto",
  // France and Belgium
  "lyon",
  "marseille",
  "bordeaux",
  "lille",
  "toulouse",
  "nantes",
  "strasbourg",
  "montpellier",
  "rennes",
  "annecy",
  "antwerp",
  "anvers",
  "ghent",
  "bruxelles",
  // Germany, Austria, Switzerland
  "frankfurt",
  "cologne",
  "koln",
  "stuttgart",
  "dusseldorf",
  "dortmund",
  "essen",
  "leipzig",
  "dresden",
  "hannover",
  "nuremberg",
  "nurnberg",
  "bremen",
  "munchen",
  "wien",
  "salzburg",
  "graz",
  "basel",
  "bern",
  "lausanne",
  // Italy
  "milano",
  "roma",
  "turin",
  "torino",
  "naples",
  "napoli",
  "florence",
  "firenze",
  "bologna",
  "genoa",
  "genova",
  "venice",
  "venezia",
  // UK and Ireland
  "leeds",
  "glasgow",
  "edinburgh",
  "liverpool",
  "bristol",
  "sheffield",
  "cardiff",
  "belfast",
  "newcastle",
  "nottingham",
  "leicester",
  "coventry",
  "bradford",
  "brighton",
  "oxford",
  "cambridge",
  "cork",
  // US and Canada
  "las vegas",
  "portland",
  "detroit",
  "minneapolis",
  "nashville",
  "orlando",
  "tampa",
  "baltimore",
  "pittsburgh",
  "cleveland",
  "columbus",
  "indianapolis",
  "kansas city",
  "st louis",
  "sacramento",
  "san jose",
  "salt lake city",
  "raleigh",
  "new orleans",
  "honolulu",
  "calgary",
  "ottawa",
  "edmonton",
  "winnipeg",
  "halifax",
  // Australia and New Zealand
  "adelaide",
  "canberra",
  "gold coast",
  "hobart",
  "wellington",
  "christchurch",
  // Mexico and Latin America
  "guadalajara",
  "monterrey",
  "puebla",
  "tijuana",
  "cancun",
  "medellin",
  "cali",
  "quito",
  "guayaquil",
  "caracas",
  "montevideo",
  "asuncion",
  "panama city",
  // Netherlands, Nordics, Central Europe
  "rotterdam",
  "the hague",
  "utrecht",
  "eindhoven",
  "gothenburg",
  "malmo",
  "bergen",
  "aarhus",
  "krakow",
  "wroclaw",
  "gdansk",
  // Middle East, Africa and Asia
  "sharjah",
  "jeddah",
  "kuwait city",
  "muscat",
  "manama",
  "casablanca",
  "accra",
  "addis ababa",
  "dar es salaam",
  "kampala",
  "kigali",
  "durban",
  "pretoria",
  "taipei",
  "guangzhou",
  "chengdu",
  "hangzhou",
  "wuhan",
  "busan",
  "yokohama",
  "kyoto",
  "nagoya",
  "chiang mai",
  "penang",
  "cebu",
  "surabaya",
  "bandung",
];

const CITY_SET = new Set([...INDIAN_CITIES, ...WORLD_CITIES, ...MORE_CITIES]);

/** Membership in either city list; some entries are also states or countries (Delhi, Goa, Singapore). */
export function isKnownCity(value: string): boolean {
  return !hasDigit(value) && CITY_SET.has(norm(value));
}

/** Canonical Indian state name for display/joins; returns the input when unknown. */
export function canonicalIndianState(value: string): string {
  return matchIndianState(value)?.name ?? value;
}
