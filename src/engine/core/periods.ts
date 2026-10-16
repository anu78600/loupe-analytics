/**
 * Date-range presets resolved against the data's own last date (pure, UI-safe).
 *
 * Anchoring on the last date rather than today keeps presets meaningful for
 * historical files. Ranges are inclusive [from, to] in wall-clock ms, with
 * `to` the last millisecond of a day (endOfDay).
 *
 * Data recorded once per month, quarter or year (monthly MRR snapshots, a
 * P&L dated on the 1st) has no days to count: "last 30 days" of it holds one
 * snapshot and its comparison window another number of them. For such a
 * cadence the day presets are not offered, and when one is still active (a
 * saved layout) its window is widened to whole periods of the data.
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
  truncate,
  type TimeGrain,
} from "./dates";

export type DatePreset = "all" | "last12m" | "last6m" | "last90d" | "last30d" | "ytd" | "prevYear" | "custom";

/**
 * How a date column records time. "month", "quarter" and "year": every value
 * is midnight on the first day of such a period, so each row stands for the
 * whole period (monthly MRR snapshots, a P&L dated 1 Mar). "monthEnd": every
 * value is the last day of its month. "day": anything else.
 */
export type DateCadence = "year" | "quarter" | "month" | "monthEnd" | "day";

/** A date column's span, and its cadence when known (kpi/compute.ts dateBounds). */
export interface PresetBounds {
  min: number;
  max: number;
  cadence?: DateCadence;
}

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
 * The time grain one row of the data stands for: a month for monthly
 * snapshots (dated on the 1st or on the last day), a quarter or a year; null
 * for data with real days. Charts and sparklines never bucket such data more
 * finely, which would draw empty buckets between its snapshots.
 */
export function cadenceGrain(cadence: DateCadence | undefined): TimeGrain | null {
  switch (cadence) {
    case "month":
    case "monthEnd":
      return "month";
    case "quarter":
      return "quarter";
    case "year":
      return "year";
    default:
      return null;
  }
}

const GRAIN_ORDER: TimeGrain[] = ["day", "week", "month", "quarter", "year"];

/** The coarser of two grains ("week" and "month" → "month"); a null floor leaves `grain` as it is. */
export function atLeastGrain(grain: TimeGrain, floor: TimeGrain | null): TimeGrain {
  if (!floor) return grain;
  return GRAIN_ORDER.indexOf(floor) > GRAIN_ORDER.indexOf(grain) ? floor : grain;
}

/**
 * Resolves a preset to an inclusive range; null means no date filter ("all",
 * and "custom", whose range the caller holds). Month presets start on the 1st:
 * last12m is the last date's month plus the 11 before it. Ranges are clipped
 * to the first date, except prevYear, which is the whole calendar year before
 * the last date's year. For data with a month, quarter or year cadence a day
 * window starts at the beginning of the period it falls in, so it holds whole
 * snapshots (presetAvailable doesn't offer these presets for such data).
 */
export function presetRange(preset: DatePreset, bounds: PresetBounds): { from: number; to: number } | null {
  const end = endOfDay(bounds.max);
  const first = startOfDay(bounds.min);
  const coarse = cadenceGrain(bounds.cadence);
  const days = (n: number) => {
    const from = addDays(startOfDay(bounds.max), -(n - 1));
    return { from: Math.max(first, coarse ? truncate(from, coarse) : from), to: end };
  };
  switch (preset) {
    case "all":
    case "custom":
      return null;
    case "last12m":
      return { from: Math.max(first, startOfMonth(addMonths(bounds.max, -11))), to: end };
    case "last6m":
      return { from: Math.max(first, startOfMonth(addMonths(bounds.max, -5))), to: end };
    case "last90d":
      return days(90);
    case "last30d":
      return days(30);
    case "ytd":
      return { from: Math.max(first, startOfYear(bounds.max)), to: end };
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
 * prevYear needs some data before the last date's year. Day windows are not
 * offered for monthly, quarterly or yearly data (they would hold one snapshot,
 * or none), and six months is not offered for yearly data.
 */
export function presetAvailable(preset: DatePreset, bounds: PresetBounds): boolean {
  const spanDays = (bounds.max - bounds.min) / DAY_MS;
  const coarse = cadenceGrain(bounds.cadence);
  switch (preset) {
    case "last12m":
      return spanDays > 120;
    case "last6m":
      return spanDays > 60 && coarse !== "year";
    case "last90d":
      return spanDays > 30 && !coarse;
    case "last30d":
      return spanDays > 7 && !coarse;
    case "prevYear":
      return startOfYear(bounds.max) > bounds.min;
    default:
      return true;
  }
}

export function rangeLabel(r: { from: number; to: number }): string {
  return formatRange(r.from, r.to);
}
