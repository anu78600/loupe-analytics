/**
 * What switching a date column's day/month order would cost, as the parsers
 * report it. A module of its own (no parser code) so the File report can read
 * it without pulling the column builders into the page bundle; builder.ts
 * fills it in for every "nn/nn/yyyy" text column.
 */
import type { DateFormatDecision } from "@/engine/core/types";

/**
 * A day/month order decision as the parsers report it ("nn/nn/yyyy" text):
 * the DateFormatDecision plus what reading the column the other way would cost.
 */
export interface DayMonthDecision extends DateFormatDecision {
  /**
   * Dates that exist only in the order chosen (15/04/2025 read day-first), so
   * switching to `alternative` would blank them. 0 when nothing proves the
   * order, so either reading keeps every date.
   */
  blankIfSwitched: number;
}

/**
 * How many dates the other day/month order would blank, when the parsers
 * reported it (DayMonthDecision); null for decisions without an alternative.
 */
export function blanksIfSwitched(d: DateFormatDecision): number | null {
  return d.alternative !== undefined && "blankIfSwitched" in d && typeof d.blankIfSwitched === "number"
    ? d.blankIfSwitched
    : null;
}
