/**
 * Counts and ordinals in words for the workspace chrome: "1 row" but
 * "2 rows", "every 3rd row". Counts use the user's digit grouping
 * (formatCount), so a figure reads the same as everywhere else on screen.
 */
import { formatCount, type NumberLocale } from "@/engine/core/format";

/** "1 row", "1,20,000 rows": the count in the user's grouping and the noun in the right number. */
export function countOf(n: number, noun: string, locale: NumberLocale, plural = `${noun}s`): string {
  return `${formatCount(n, locale)} ${n === 1 ? noun : plural}`;
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st, 22nd, 23rd. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const unit = n % 10;
  return `${n}${unit === 1 ? "st" : unit === 2 ? "nd" : unit === 3 ? "rd" : "th"}`;
}
