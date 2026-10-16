/**
 * Numbers printed side by side in one style. A sentence or a table column
 * that puts "₹662.75" next to "₹2.71K" reads as if the two were measured
 * differently: values shown together get one precision, chosen by the
 * largest of them. Used by the insights' sentences, the answers to business
 * questions (step 5) and their tables, on screen and in the PDFs.
 */
import { formatValue, type FormatOptions, type ValueFormat } from "./format";

const finiteOf = (values: ReadonlyArray<number | null | undefined>): number[] =>
  values.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));

/**
 * Decimals that print a whole column of a table at one precision: money in
 * whole units once any value reaches 1,000 (₹663 beside ₹2,712, not ₹662.75),
 * plain numbers with one decimal once any reaches 100. Undefined leaves the
 * format's own rule, which is already one precision (percent, ratio, days).
 */
export function columnDecimals(
  values: ReadonlyArray<number | null | undefined>,
  format: ValueFormat,
): number | undefined {
  const finite = finiteOf(values);
  if (!finite.length) return undefined;
  const max = Math.max(...finite.map((v) => Math.abs(v)));
  const whole = finite.every((v) => Number.isInteger(v));
  if (format === "currency") return max >= 1000 || whole ? 0 : 2;
  if (format === "number") return whole ? 0 : max >= 100 ? 1 : 2;
  return undefined;
}

/**
 * Formats values of one measure for a sentence, together: compact units as
 * every sentence uses them (₹50.3L, ₹2.71K), and a smaller value beside them
 * in whole units ("₹663 to ₹2.71K"), so neither carries more precision than
 * the other.
 */
export function formatTogether(
  values: ReadonlyArray<number | null | undefined>,
  format: ValueFormat,
  fmt: FormatOptions,
): string[] {
  const decimals = columnDecimals(values, format);
  return values.map((v) =>
    formatValue(v ?? null, format, {
      ...fmt,
      compact: true,
      ...(decimals !== undefined ? { decimals } : {}),
    }),
  );
}

/** One value for a sentence: compact, as formatTogether prints it alone. */
export const formatForSentence = (
  v: number | null | undefined,
  format: ValueFormat,
  fmt: FormatOptions,
): string => formatTogether([v], format, fmt)[0] as string;
