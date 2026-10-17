/**
 * The words values are written with in other languages: month names
 * ("14 de março de 2024", "3. März 2024"), yes/no pairs ("Sim"/"Não",
 * "VRAI"/"FAUX") and scale words ("14.5 Lacs", "1,2 Mio. €"). Tables only,
 * one per kind with a row per language, kept apart from the parsers that read
 * them (dates.ts reads the months, values.ts the yes/no pairs and the scales),
 * so a language is added here and nowhere else.
 *
 * Words are compared folded (foldWord): lower-case, accents removed and a
 * final dot dropped, so "févr.", "Févr" and "fevr" are one word, as are "Não"
 * and "nao". A folded month word may belong to several languages ("mar" is
 * March in most of them) but never means two different months, which
 * tests/parse-world.test.ts checks; a word that did would be left out.
 */

/**
 * Lower-case, without accents (NFKD minus combining marks) and without a
 * final dot: "Févr." → "fevr". Turkish "ı" and Polish "ł" have no accent to
 * remove, so they become "i" and "l" ("Kasım" → "kasim", "Wrzesień" →
 * "wrzesien").
 */
export function foldWord(word: string): string {
  return word
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ł/g, "l")
    .replace(/\.$/, "");
}

// ---------------------------------------------------------------- month names

/** Languages whose month names are read, in the order a column's language is named in the parse report. */
export const MONTH_LANGUAGES = [
  "English",
  "Spanish",
  "Portuguese",
  "French",
  "German",
  "Italian",
  "Dutch",
  "Indonesian",
  "Swedish",
  "Danish",
  "Norwegian",
  "Turkish",
  "Polish",
] as const;
export type MonthLanguage = (typeof MONTH_LANGUAGES)[number];

/** Bit mask with every month language set (bit i = MONTH_LANGUAGES[i]). */
export const ANY_MONTH_LANGUAGE = (1 << MONTH_LANGUAGES.length) - 1;

/**
 * Month names per language, January first, folded: the full name, then the
 * abbreviations that language's software writes. French has no three-letter
 * "jun"/"jul" (juin and juillet would collide), Dutch writes "mrt" for maart,
 * German "Mär"/"Mrz" for März and "Jän" for the Austrian Jänner, Indonesian
 * the older "Nopember" too, and Polish dates use the genitive ("14 marca
 * 2024"), listed after the nominative.
 */
export const MONTH_NAMES: Readonly<Record<MonthLanguage, readonly (readonly string[])[]>> = {
  English: [
    ["january", "jan"],
    ["february", "feb"],
    ["march", "mar"],
    ["april", "apr"],
    ["may"],
    ["june", "jun"],
    ["july", "jul"],
    ["august", "aug"],
    ["september", "sept", "sep"],
    ["october", "oct"],
    ["november", "nov"],
    ["december", "dec"],
  ],
  Spanish: [
    ["enero", "ene"],
    ["febrero", "feb"],
    ["marzo", "mar"],
    ["abril", "abr"],
    ["mayo", "may"],
    ["junio", "jun"],
    ["julio", "jul"],
    ["agosto", "ago"],
    ["septiembre", "setiembre", "sept", "sep", "set"],
    ["octubre", "oct"],
    ["noviembre", "nov"],
    ["diciembre", "dic"],
  ],
  Portuguese: [
    ["janeiro", "jan"],
    ["fevereiro", "fev"],
    ["marco", "mar"],
    ["abril", "abr"],
    ["maio", "mai"],
    ["junho", "jun"],
    ["julho", "jul"],
    ["agosto", "ago"],
    ["setembro", "set"],
    ["outubro", "out"],
    ["novembro", "nov"],
    ["dezembro", "dez"],
  ],
  French: [
    ["janvier", "janv", "jan"],
    ["fevrier", "fevr", "fev"],
    ["mars", "mar"],
    ["avril", "avr"],
    ["mai"],
    ["juin"],
    ["juillet", "juil"],
    ["aout", "aou"],
    ["septembre", "sept", "sep"],
    ["octobre", "oct"],
    ["novembre", "nov"],
    ["decembre", "dec"],
  ],
  German: [
    ["januar", "janner", "jan"],
    ["februar", "feber", "feb"],
    ["marz", "mrz", "mar"],
    ["april", "apr"],
    ["mai"],
    ["juni", "jun"],
    ["juli", "jul"],
    ["august", "aug"],
    ["september", "sept", "sep"],
    ["oktober", "okt"],
    ["november", "nov"],
    ["dezember", "dez"],
  ],
  Italian: [
    ["gennaio", "gen"],
    ["febbraio", "feb"],
    ["marzo", "mar"],
    ["aprile", "apr"],
    ["maggio", "mag"],
    ["giugno", "giu"],
    ["luglio", "lug"],
    ["agosto", "ago"],
    ["settembre", "set"],
    ["ottobre", "ott"],
    ["novembre", "nov"],
    ["dicembre", "dic"],
  ],
  Dutch: [
    ["januari", "jan"],
    ["februari", "feb"],
    ["maart", "mrt"],
    ["april", "apr"],
    ["mei"],
    ["juni", "jun"],
    ["juli", "jul"],
    ["augustus", "aug"],
    ["september", "sept", "sep"],
    ["oktober", "okt"],
    ["november", "nov"],
    ["december", "dec"],
  ],
  Indonesian: [
    ["januari", "jan"],
    ["februari", "feb"],
    ["maret", "mar"],
    ["april", "apr"],
    ["mei"],
    ["juni", "jun"],
    ["juli", "jul"],
    ["agustus", "agu", "ags", "agt"],
    ["september", "sept", "sep"],
    ["oktober", "okt"],
    ["november", "nopember", "nov", "nop"],
    ["desember", "des"],
  ],
  Swedish: [
    ["januari", "jan"],
    ["februari", "feb"],
    ["mars", "mar"],
    ["april", "apr"],
    ["maj"],
    ["juni", "jun"],
    ["juli", "jul"],
    ["augusti", "aug"],
    ["september", "sept", "sep"],
    ["oktober", "okt"],
    ["november", "nov"],
    ["december", "dec"],
  ],
  Danish: [
    ["januar", "jan"],
    ["februar", "feb"],
    ["marts", "mar"],
    ["april", "apr"],
    ["maj"],
    ["juni", "jun"],
    ["juli", "jul"],
    ["august", "aug"],
    ["september", "sept", "sep"],
    ["oktober", "okt"],
    ["november", "nov"],
    ["december", "dec"],
  ],
  Norwegian: [
    ["januar", "jan"],
    ["februar", "feb"],
    ["mars", "mar"],
    ["april", "apr"],
    ["mai"],
    ["juni", "jun"],
    ["juli", "jul"],
    ["august", "aug"],
    ["september", "sept", "sep"],
    ["oktober", "okt"],
    ["november", "nov"],
    ["desember", "des"],
  ],
  Turkish: [
    ["ocak", "oca"],
    ["subat", "sub"],
    ["mart", "mar"],
    ["nisan", "nis"],
    ["mayis", "may"],
    ["haziran", "haz"],
    ["temmuz", "tem"],
    ["agustos", "agu"],
    ["eylul", "eyl"],
    ["ekim", "eki"],
    ["kasim", "kas"],
    ["aralik", "ara"],
  ],
  Polish: [
    ["styczen", "stycznia", "sty"],
    ["luty", "lutego", "lut"],
    ["marzec", "marca", "mar"],
    ["kwiecien", "kwietnia", "kwi"],
    ["maj", "maja"],
    ["czerwiec", "czerwca", "cze"],
    ["lipiec", "lipca", "lip"],
    ["sierpien", "sierpnia", "sie"],
    ["wrzesien", "wrzesnia", "wrz"],
    ["pazdziernik", "pazdziernika", "paz"],
    ["listopad", "listopada", "lis"],
    ["grudzien", "grudnia", "gru"],
  ],
};

/** A month word's month (1–12) and the languages that write it (bit mask over MONTH_LANGUAGES). */
export interface MonthWord {
  month: number;
  languages: number;
}

/** Folded month word → MonthWord. A word that two languages give different months would be dropped. */
const MONTH_WORDS: ReadonlyMap<string, MonthWord> = (() => {
  const map = new Map<string, MonthWord>();
  const clash = new Set<string>();
  MONTH_LANGUAGES.forEach((language, bit) => {
    MONTH_NAMES[language].forEach((words, i) => {
      for (const word of words.map(foldWord)) {
        const seen = map.get(word);
        if (seen && seen.month !== i + 1) clash.add(word);
        map.set(word, { month: i + 1, languages: (seen?.languages ?? 0) | (1 << bit) });
      }
    });
  });
  for (const word of clash) map.delete(word);
  return map;
})();

/** The month a written month name or abbreviation stands for ("févr." → February), or null. */
export function monthWord(word: string): MonthWord | null {
  return MONTH_WORDS.get(foldWord(word)) ?? null;
}

/** The languages in a mask, in table order: "Spanish", "Spanish or Portuguese"; "" when none. */
export function languageNames(mask: number): string {
  const names = MONTH_LANGUAGES.filter((_, bit) => mask & (1 << bit));
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** True when the mask includes English, the reading Loupe has always had (no note needed). */
export const includesEnglish = (mask: number): boolean => (mask & 1) !== 0;

/**
 * Weekday names written before a date by long date formats ("Thursday, March
 * 14, 2024", "jueves, 14 de marzo de 2024", "Donnerstag, 14. März 2024") and
 * by RFC 2822 and JavaScript ("Thu, 14 Mar 2024"), folded. Full names in
 * English, Spanish, Portuguese, French, German, Italian and Dutch, whose
 * spreadsheets write them in long dates; abbreviations in English only, since
 * Spanish, French and Italian shorten Tuesday to "mar", which is also March.
 * Portuguese names are listed without their "-feira".
 */
const WEEKDAYS: ReadonlySet<string> = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "mon",
  "tue",
  "tues",
  "wed",
  "thu",
  "thur",
  "thurs",
  "fri",
  "sat",
  "sun",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
  "domingo",
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
  "montag",
  "dienstag",
  "mittwoch",
  "donnerstag",
  "freitag",
  "samstag",
  "sonnabend",
  "sonntag",
  "lunedi",
  "martedi",
  "mercoledi",
  "giovedi",
  "venerdi",
  "sabato",
  "domenica",
  "maandag",
  "dinsdag",
  "woensdag",
  "donderdag",
  "vrijdag",
  "zaterdag",
  "zondag",
]);

/** True for a weekday name or English abbreviation ("Thu", "jeudi", "quinta-feira"). */
export function isWeekdayWord(word: string): boolean {
  return WEEKDAYS.has(foldWord(word).replace(/-feira$/, ""));
}

// ---------------------------------------------------------------- yes/no words

/**
 * One language's words for yes and no (or true and false), folded, with the
 * spellings used for a value the column never writes. English (yes/no, y/n,
 * true/false) is read by values.parseBooleanToken, which the SQL and DAX
 * compilers mirror; these pairs only decide how a column is stored, and a
 * column takes one pair for all its values (values.yesNoPairOf).
 */
export interface YesNoPair {
  /** Who writes it, for tests and notes. */
  language: string;
  yes: readonly string[];
  no: readonly string[];
  yesLabel: string;
  noLabel: string;
}

/**
 * Single letters (S/N, O/N, J/N) are left out: "N" and "S" are also north
 * and south. Excel writes TRUE and FALSE in the workbook's language when it
 * saves a CSV (VERDADERO, VRAI, WAHR…), hence the true/false rows. Words are
 * written as the language writes them and folded once here, so Korean, which
 * NFKD splits into letters, compares like any other.
 */
export const YES_NO_PAIRS: readonly YesNoPair[] = [
  { language: "Spanish or Italian", yes: ["sí"], no: ["no"], yesLabel: "Sí", noLabel: "No" },
  { language: "Portuguese", yes: ["sim"], no: ["não"], yesLabel: "Sim", noLabel: "Não" },
  { language: "French", yes: ["oui"], no: ["non"], yesLabel: "Oui", noLabel: "Non" },
  { language: "German", yes: ["ja"], no: ["nein"], yesLabel: "Ja", noLabel: "Nein" },
  { language: "Dutch", yes: ["ja"], no: ["nee"], yesLabel: "Ja", noLabel: "Nee" },
  { language: "Swedish or Danish", yes: ["ja"], no: ["nej"], yesLabel: "Ja", noLabel: "Nej" },
  { language: "Norwegian", yes: ["ja"], no: ["nei"], yesLabel: "Ja", noLabel: "Nei" },
  { language: "Hindi", yes: ["haan", "han"], no: ["nahi", "nahin"], yesLabel: "Haan", noLabel: "Nahi" },
  { language: "Indonesian or Malay", yes: ["ya"], no: ["tidak"], yesLabel: "Ya", noLabel: "Tidak" },
  { language: "Turkish", yes: ["evet"], no: ["hayır"], yesLabel: "Evet", noLabel: "Hayır" },
  { language: "Polish", yes: ["tak"], no: ["nie"], yesLabel: "Tak", noLabel: "Nie" },
  { language: "Russian", yes: ["да"], no: ["нет"], yesLabel: "Да", noLabel: "Нет" },
  { language: "Chinese", yes: ["是"], no: ["否"], yesLabel: "是", noLabel: "否" },
  { language: "Japanese", yes: ["はい"], no: ["いいえ"], yesLabel: "はい", noLabel: "いいえ" },
  { language: "Korean", yes: ["예", "네"], no: ["아니오", "아니요"], yesLabel: "예", noLabel: "아니오" },
  { language: "Spanish", yes: ["verdadero"], no: ["falso"], yesLabel: "Verdadero", noLabel: "Falso" },
  { language: "Portuguese", yes: ["verdadeiro"], no: ["falso"], yesLabel: "Verdadeiro", noLabel: "Falso" },
  { language: "Italian", yes: ["vero"], no: ["falso"], yesLabel: "Vero", noLabel: "Falso" },
  { language: "French", yes: ["vrai"], no: ["faux"], yesLabel: "Vrai", noLabel: "Faux" },
  { language: "German", yes: ["wahr"], no: ["falsch"], yesLabel: "Wahr", noLabel: "Falsch" },
  { language: "Dutch", yes: ["waar"], no: ["onwaar"], yesLabel: "Waar", noLabel: "Onwaar" },
].map((pair) => ({ ...pair, yes: pair.yes.map(foldWord), no: pair.no.map(foldWord) }));

// ---------------------------------------------------------------- scale words

/** A scale word written after a number: its power of ten, and whether it is weak (see SCALE_WORDS). */
export interface ScaleWord {
  exponent: number;
  /** Also a unit, size or grade ("5K", "2B", "12 L", "3 mm"): read as a scale only beside money. */
  weak: boolean;
  /** Spelt out in full ("million", "Lakhs", "Milliarden"), not abbreviated. */
  full: boolean;
}

/**
 * Scale words by power of ten: [exponent, full words, strong abbreviations,
 * weak words]. Strong abbreviations mean a scale and nothing else ("Cr",
 * "Mn", "Mio.", "Mrd.", "LPA" for lakhs per annum); weak ones are also units,
 * sizes or codes (K, M, MM, B, L, T, the Portuguese and Spanish mil/mi/bi)
 * and count only beside money (values.detectScaleWords).
 */
const SCALES: ReadonlyArray<[number, readonly string[], readonly string[], readonly string[]]> = [
  [3, ["thousand", "thousands", "tausend"], ["tsd"], ["k", "mil"]],
  [5, ["lakh", "lakhs", "lac", "lacs"], ["lpa"], ["l"]],
  [
    6,
    ["million", "millions", "millionen", "millones", "milhoes", "milioni"],
    ["mn", "mln", "mio"],
    ["m", "mm", "mi", "mill"],
  ],
  [7, ["crore", "crores"], ["cr", "crs"], []],
  [
    9,
    ["billion", "billions", "milliard", "milliards", "milliarden", "bilhoes", "miliardi"],
    ["bn", "mrd", "mld"],
    ["b", "bi", "md", "mds"],
  ],
  [12, ["trillion", "trillions"], ["tn", "trn"], ["t"]],
];

/** Folded scale word → ScaleWord. */
export const SCALE_WORDS: ReadonlyMap<string, ScaleWord> = new Map(
  SCALES.flatMap(([exponent, full, strong, weak]) => [
    ...full.map((w): [string, ScaleWord] => [w, { exponent, weak: false, full: true }]),
    ...strong.map((w): [string, ScaleWord] => [w, { exponent, weak: false, full: false }]),
    ...weak.map((w): [string, ScaleWord] => [w, { exponent, weak: true, full: false }]),
  ]),
);

/** How the parse report names each power of ten, in words so it reads the same in every number system. */
export const SCALE_NAMES: Readonly<Record<number, string>> = {
  3: "thousands",
  5: "lakhs (hundred thousands)",
  6: "millions",
  7: "crores (ten millions)",
  9: "billions",
  12: "trillions",
};
