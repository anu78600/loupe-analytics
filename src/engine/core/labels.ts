/**
 * Column names as people read them. A file's headers are often written for a
 * machine ("New_order_date", "customer_ids", "GST_Amount"); titles, filters,
 * questions and insights show them with spaces instead. The header itself is
 * never changed: data views, mappings and exports keep it as written, and
 * every lookup still uses the real name.
 */

/**
 * "New_order_date" → "New order date", "GST_Amount" → "GST Amount": underscores
 * and runs of white space become one space. Each word keeps its own case, so
 * acronyms (GST, SKU, ID) survive; use it inside a sentence or a title.
 */
export function friendly(name: string): string {
  const out = name.replace(/[_\s]+/g, " ").trim();
  return out || name;
}

/**
 * friendly(), with the first letter capitalised when the name is written in
 * lower case ("customer_ids" → "Customer ids"), for the start of a label.
 */
export function friendlyStart(name: string): string {
  const out = friendly(name);
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/**
 * "Total <column>", without doubling a word the name already starts with:
 * "Total Amount" stays "Total Amount" rather than "Total Total Amount".
 */
export function totalOf(name: string): string {
  const label = friendly(name);
  return /^(total|sum)\b/i.test(label) ? label : `Total ${label}`;
}

/** "Average <column>", without doubling it ("Avg Price" → "Avg Price", not "Average Avg Price"). */
export function averageOf(name: string): string {
  const label = friendly(name);
  return /^(average|avg|mean)\b/i.test(label) ? label : `Average ${label}`;
}

/**
 * A KPI's one display name: its name without a trailing bracketed short form
 * ("Gross sales (GMV)" → "Gross sales"). Cards, legends, axes and tooltips
 * all use it, so a measure is never "GMV" in one place and "Gross sales" in
 * another; the full name stays in definitions and exports.
 */
export function kpiLabel(k: { name: string; short?: string }): string {
  return k.short ? k.name.replace(` (${k.short})`, "") : k.name;
}

// Participles that follow the noun they describe ("Units ordered", "Deals won").
const PARTICIPLE = /^(?:\w+ed|won|lost|sold|given|taken|made|paid|seen|done|shipped|kept)$/i;
// Nouns ending in s that are singular.
const SINGULAR_S = new Set([
  "status",
  "analysis",
  "basis",
  "bonus",
  "gas",
  "news",
  "loss",
  "process",
  "access",
]);

/**
 * "was" or "were" for a KPI name, from its head noun: "New customers were 52",
 * "Units ordered were 34,861", "Gross sales were …", but "Net revenue was …"
 * and "Repeat rate was …". Brackets and symbols are ignored.
 */
export function wasWere(name: string): "was" | "were" {
  const words = name
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^A-Za-z\s-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let head = words[words.length - 1] ?? "";
  if (PARTICIPLE.test(head) && words.length > 1) head = words[words.length - 2] ?? head;
  const w = head.toLowerCase();
  return w.length > 2 && w.endsWith("s") && !w.endsWith("ss") && !SINGULAR_S.has(w) ? "were" : "was";
}

/**
 * "a" or "an" before a word or number as it is said: "an 85.8 pp gap",
 * "an 11% rise", "an hour", "a 5.2 pp gap", "a unit".
 */
export function article(next: string): "a" | "an" {
  const t = next.trim().replace(/^[+−-]/, "");
  // Numbers said with a vowel sound: anything starting with 8 (eight, eighty, 85.8), and eleven
  // or eighteen, alone or in thousands (11, 18, 11,000, 18,500).
  const int = (/^[\d,]+/.exec(t)?.[0] ?? "").replace(/,/g, "");
  if (int)
    return int.startsWith("8") || (/^1[18]/.test(int) && (int.length === 2 || int.length === 5)) ? "an" : "a";
  if (/^(hour|honest|honour|heir)/i.test(t)) return "an";
  if (/^(uni|use|usu|uti|one|eu)/i.test(t)) return "a";
  return /^[aeiou]/i.test(t) ? "an" : "a";
}
