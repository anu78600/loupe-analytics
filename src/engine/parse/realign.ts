/**
 * Rows whose values slid left (version 51.5). Some exports drop empty fields
 * from a row instead of leaving them blank, so every later value lands under
 * the wrong header and the row ends in empty fields: in a Facebook ads file a
 * third of the rows lack the two campaign ids, so their spend sat under
 * Impressions (78,552,672.99 impressions) and their interests under Age.
 *
 * makeRealigner learns the shape of each column from the sampled rows (whole
 * numbers, decimals, dates, ranges like "30-34", single letters) where one
 * shape clearly leads. A row that ends in empty fields and breaks at least
 * two columns' shapes is moved right, with the empty fields put back where
 * they fit: the one position at which every value matches its column. A row
 * with no such single position is left as it is, so nothing is guessed.
 */

type Shape = "blank" | "int" | "dec" | "date" | "range" | "letter" | "text";

/** A column's shape leads when at least this share of its sampled values have it. */
const LEADING_SHARE = 0.6;
/** Columns with a known shape the row must break before a move is tried. */
const MIN_BROKEN = 2;

function shapeOf(cell: string | undefined): Shape {
  const t = (cell ?? "").trim();
  if (!t) return "blank";
  if (/^-?\d+$/.test(t)) return "int";
  if (/^-?\d*[.,]\d+$/.test(t)) return "dec";
  if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(t)) return "date";
  if (/^\d+\s*[-–]\s*\d+$/.test(t)) return "range";
  if (/^\p{L}$/u.test(t)) return "letter";
  return "text";
}

export interface Realigner {
  /** The row moved back under its headers, or null when it needs no move (or no single move fits). */
  (row: readonly string[]): string[] | null;
}

/** A realigner for rows `width` fields wide, learned from `sample`; null when no column has a leading shape. */
export function makeRealigner(sample: readonly (readonly string[])[], width: number): Realigner | null {
  const leading: Array<Shape | null> = [];
  for (let j = 0; j < width; j++) {
    const counts = new Map<Shape, number>();
    let n = 0;
    for (const row of sample) {
      const s = shapeOf(row[j]);
      if (s === "blank") continue;
      n++;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    let best: Shape | null = null;
    for (const [s, c] of counts) if (s !== "text" && c >= LEADING_SHARE * n && n >= 10) best = s;
    leading.push(best);
  }
  if (leading.filter(Boolean).length < MIN_BROKEN + 1) return null;
  const fits = (s: Shape, want: Shape | null) =>
    s === "blank" || want === null || s === want || (want === "dec" && s === "int");
  const broken = (row: readonly string[]) => {
    let n = 0;
    for (let j = 0; j < width; j++) if (!fits(shapeOf(row[j]), leading[j] as Shape | null)) n++;
    return n;
  };
  return (row) => {
    let trailing = 0;
    while (trailing < width && shapeOf(row[width - 1 - trailing]) === "blank") trailing++;
    if (trailing === 0 || trailing === width) return null;
    const before = broken(row);
    if (before < MIN_BROKEN) return null;
    const kept = Array.from({ length: width - trailing }, (_, j) => row[j] ?? "");
    let bestAt = -1;
    let ties = 0;
    for (let p = 0; p <= width - trailing; p++) {
      const moved = [...kept.slice(0, p), ...Array<string>(trailing).fill(""), ...kept.slice(p)];
      if (broken(moved) !== 0) continue;
      if (bestAt < 0) bestAt = p;
      ties++;
    }
    if (ties !== 1) return null;
    return [...kept.slice(0, bestAt), ...Array<string>(trailing).fill(""), ...kept.slice(bestAt)];
  };
}
