/**
 * How a KPI's number is written wherever it stands on its own: the
 * dashboard's cards, the presentation slides and the PDF report. One rule,
 * so a KPI reads the same in every place it appears ("1.75L leads" on the
 * dashboard is "1.75L leads" on the slide, never "1,74,867"):
 *
 * - money is always compact (₹3.13Cr, ₹45.2K);
 * - counts and other numbers are compact from 1,00,000 (1.75L, 15.9Cr);
 * - a rate is never compact (42.3%).
 *
 * Plain functions over engine/core/format, so they can be used outside React
 * and tested in node. Exact values (tooltips, data tables, exported files)
 * keep formatValue's plain form.
 */
import { formatValue, type FormatOptions } from "@/engine/core/format";
import type { KpiFormat } from "@/registry/schema";

/** One lakh: counts and other numbers turn compact from here (1,00,000 → 1L; 100,000 → 100K). */
const COMPACT_FROM = 100_000;

/** Whether a KPI value is written in compact units (see the file header for the rule). */
export function kpiCompact(format: KpiFormat, value: number | null | undefined): boolean {
  if (format === "percent") return false;
  if (format === "currency") return true;
  return value !== null && value !== undefined && Math.abs(value) >= COMPACT_FROM;
}

/**
 * A KPI value as the dashboard's card writes it: "₹3.13Cr", "1.75L", "42.3%",
 * "4.2 days". Missing values print as an em dash.
 */
export function formatKpi(value: number | null | undefined, format: KpiFormat, fmt: FormatOptions): string {
  return formatValue(value, format, { ...fmt, compact: kpiCompact(format, value) });
}
