/**
 * Date-range presets resolved against the data's own last date (pure, UI-safe).
 *
 * Anchoring on the last date rather than today keeps presets meaningful for
 * historical files. Ranges are inclusive [from, to] in wall-clock ms, with
 * `to` the last millisecond of a day (endOfDay).
 */
import {
  addDays,
  addMonths,
  DAY_MS,
  endOfDay,
  formatRange,
  startOfDay,
  startOfMonth,
  startOfYear,
} from "./dates";

export type DatePreset = "all" | "last12m" | "last6m" | "last90d" | "last30d" | "ytd" | "prevYear" | "custom";

export const PRESET_LABEL: Record<DatePreset, string> = {
  all: "All time",
  last12m: "Last 12 months",
  last6m: "Last 6 months",
  last90d: "Last 90 days",
  last30d: "Last 30 days",
  ytd: "Year to date",
  prevYear: "Previous year",
  custom: "Custom range",
};

/**
 * Resolves a preset to an inclusive range; null means no date filter ("all",
 * and "custom", whose range the caller holds). Month presets start on the 1st:
 * last12m is the last date's month plus the 11 before it. Ranges are clipped
 * to the first date, except prevYear, which is the whole calendar year before
 * the last date's year.
 */
export function presetRange(
  preset: DatePreset,
  bounds: { min: number; max: number },
): { from: number; to: number } | null {
  const end = endOfDay(bounds.max);
  switch (preset) {
    case "all":
    case "custom":
      return null;
    case "last12m":
      return { from: Math.max(startOfDay(bounds.min), startOfMonth(addMonths(bounds.max, -11))), to: end };
    case "last6m":
      return { from: Math.max(startOfDay(bounds.min), startOfMonth(addMonths(bounds.max, -5))), to: end };
    case "last90d":
      return { from: Math.max(startOfDay(bounds.min), addDays(startOfDay(bounds.max), -89)), to: end };
    case "last30d":
      return { from: Math.max(startOfDay(bounds.min), addDays(startOfDay(bounds.max), -29)), to: end };
    case "ytd":
      return { from: Math.max(startOfDay(bounds.min), startOfYear(bounds.max)), to: end };
    case "prevYear": {
      const y = startOfYear(bounds.max);
      return { from: addMonths(y, -12), to: y - 1 };
    }
  }
}

/** A full year compared with the year before when there is enough history; otherwise all time. */
export function defaultPreset(bounds: { min: number; max: number } | null): DatePreset {
  if (!bounds) return "all";
  // 30.44 = average days per month (365.25 / 12).
  const months = (bounds.max - bounds.min) / (30.44 * DAY_MS);
  return months >= 18 ? "last12m" : "all";
}

/**
 * Whether a preset is worth offering for the data's span: rolling windows
 * need the data to cover roughly a quarter to a third of the window, and
 * prevYear needs some data before the last date's year.
 */
export function presetAvailable(preset: DatePreset, bounds: { min: number; max: number }): boolean {
  const spanDays = (bounds.max - bounds.min) / DAY_MS;
  switch (preset) {
    case "last12m":
      return spanDays > 120;
    case "last6m":
      return spanDays > 60;
    case "last90d":
      return spanDays > 30;
    case "last30d":
      return spanDays > 7;
    case "prevYear":
      return startOfYear(bounds.max) > bounds.min;
    default:
      return true;
  }
}

export function rangeLabel(r: { from: number; to: number }): string {
  return formatRange(r.from, r.to);
}
