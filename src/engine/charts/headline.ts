/**
 * A chart's takeaway: one sentence saying what the chart shows, written the
 * way an analyst titles a slide ("Up 12.7% from Oct 2025 to Sep 2026,
 * ending at its peak of ₹37.9L"). The dashboard shows it under each chart's
 * title, and the slides and the PDF report lead each figure with it.
 *
 * Every figure in it comes from the chart's own data, as drawn: a trend
 * compares the first and last complete periods (an incomplete one is never
 * read as a fall); a share of the total is given only for a measure that
 * adds up (a sum, a count or a distinct count, against the total evaluated
 * over all rows), while a donut's share is the one its slices show; a rate
 * or an average is compared highest to lowest; a stacked chart over time
 * gives the make-up of its latest complete period. Where nothing can be said
 * honestly, there is no headline.
 */
import { formatPointDelta, formatValue, type FormatOptions, type ValueFormat } from "@/engine/core/format";
import type { ChartData, ChartSpec } from "./types";

/** What the chart's first measure is, as far as the wording goes. */
export interface HeadlineTraits {
  /** It adds up across groups (a sum or a count), so a group's share of the total is meaningful. */
  additive: boolean;
  /** It counts distinct things: a group's share is of the distinct total ("31% of customers"). */
  distinct: boolean;
}

/** The kinds whose one number is the whole chart: a sentence adds nothing. */
const SELF_EVIDENT = new Set(["bigNumber", "gauge", "bullet"]);
const STACKED = new Set(["stackedBar", "stackedBar100", "stackedArea"]);

/** A measure's name inside a sentence: "net revenue", but "MRR" and "ARPA" keep their capitals. */
function inSentence(label: string): string {
  const [first = "", ...rest] = label.split(" ");
  return /^[A-Z0-9%]{2,}$/.test(first) ? label : [first.toLowerCase(), ...rest].join(" ");
}

export function chartHeadline(
  spec: ChartSpec,
  data: ChartData,
  fmt: FormatOptions,
  traits: HeadlineTraits,
): string | null {
  if (data.empty || SELF_EVIDENT.has(data.kind)) return null;
  const v = (x: number | null | undefined, f: ValueFormat) =>
    formatValue(x ?? null, f, { ...fmt, compact: true });
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const total = data.totals[0];
  // A share of the total is honest only for a measure that adds up, against the total over all rows.
  const shareOf = (value: number): string | null =>
    (traits.additive || traits.distinct) && total !== null && total !== undefined && total > 0
      ? pct(value / total)
      : null;

  if (data.rfm?.length) {
    const top = [...data.rfm].sort((a, b) => b.revenueShare - a.revenueShare)[0];
    return top
      ? `${top.segment} hold ${pct(top.revenueShare)} of revenue from ${pct(top.customerShare)} of customers.`
      : null;
  }
  if (data.cohorts?.length) {
    const m1 = data.cohorts
      .map((c) => c.retention[1])
      .filter((x): x is number => x !== null && x !== undefined);
    if (m1.length < 2) return null;
    return `Month-1 retention ranges from ${(Math.min(...m1) * 100).toFixed(1)}% to ${(Math.max(...m1) * 100).toFixed(1)}% across ${data.cohorts.length} cohorts.`;
  }
  if (data.basket?.pairs.length) {
    const p = data.basket.pairs[0];
    return p
      ? `Most often bought together: ${p.a} with ${p.b} (${p.orders} orders, ${p.lift.toFixed(1)}× chance).`
      : null;
  }
  if (data.pareto) {
    const { topShare, topCount, itemCount, itemsForEighty } = data.pareto;
    return `The top ${topCount} of ${itemCount} items bring ${pct(topShare)} of the total; ${itemsForEighty} make up 80%.`;
  }
  if (data.funnel && data.funnel.length >= 2) {
    const first = data.funnel[0];
    const last = data.funnel[data.funnel.length - 1];
    return first && last && last.fromFirst !== null
      ? `${last.label} is ${pct(last.fromFirst)} of ${inSentence(first.label)}.`
      : null;
  }
  if (data.points?.length && data.trendline) {
    const r2 = data.trendline.r2;
    const [a, b] = spec.measures;
    if (!a || !b) return null;
    const strength = r2 >= 0.5 ? "move together" : r2 >= 0.2 ? "are loosely linked" : "show no clear link";
    return `${a.label} and ${inSentence(b.label)} ${strength} (R² ${r2.toFixed(2)}).`;
  }
  if ((data.kind === "treemap" || data.kind === "sunburst") && data.tree?.length) {
    const f = (data.series[0]?.format ?? spec.measures[0]?.format ?? "number") as ValueFormat;
    const parents = data.tree.filter(
      (n): n is typeof n & { value: number } => n.label !== "Others" && n.value !== null,
    );
    const top = parents.sort((a, b) => b.value - a.value)[0];
    if (!top) return null;
    const share = shareOf(top.value);
    const child = data.tree
      .flatMap((n) => n.children ?? [])
      .filter((c): c is typeof c & { value: number } => c.value !== null)
      .sort((a, b) => b.value - a.value)[0];
    return `${top.label} leads with ${v(top.value, f)}${share ? `, ${share} of the total` : ""}${child ? `; the largest single part is ${child.label} (${v(child.value, f)})` : ""}.`;
  }

  // Stacked over time: the make-up of the latest complete period, from a split or from several measures.
  const stackedParts =
    spec.x.kind === "time" && STACKED.has(data.kind)
      ? data.matrix && data.seriesCategories?.length
        ? data.seriesCategories.map((r, ri) => ({
            label: r.label,
            values: data.matrix?.[ri] ?? [],
            others: r.isOthers,
          }))
        : data.series.length > 1
          ? data.series.map((s) => ({ label: s.label, values: s.values, others: false }))
          : null
      : null;
  if (stackedParts) {
    const idx = data.categories.length - 1 - (data.partialLast ? 1 : 0);
    const when = data.categories[idx]?.label;
    const parts = stackedParts
      .map((p) => ({ ...p, value: p.values[idx] ?? null }))
      .filter((p): p is typeof p & { value: number } => p.value !== null && p.value > 0);
    const sum = parts.reduce((a, p) => a + p.value, 0);
    const lead = parts.filter((p) => !p.others).sort((a, b) => b.value - a.value)[0];
    return lead && sum > 0 && when
      ? `In ${when}, ${inSentence(lead.label)} made up ${pct(lead.value / sum)} of the total.`
      : null;
  }
  if (data.matrix && data.seriesCategories?.length) return largestCell(spec, data, v);

  const s = data.series[0];
  if (!s) return null;
  const f = s.format as ValueFormat;
  // With several measures the sentence is about the first, named: "New MRR: up 23.2%…".
  const named = (body: string) =>
    data.series.length > 1 && data.kind !== "table"
      ? `${s.label}: ${body.charAt(0).toLowerCase()}${body.slice(1)}`
      : body;
  // Others is a bundle of the rest, never "the leader".
  const points = s.values
    .map((value, i) => ({ value, i, cat: data.categories[i] }))
    .filter((p): p is { value: number; i: number; cat: NonNullable<typeof p.cat> } =>
      Boolean(p.cat && !p.cat.isOthers && p.value !== null && Number.isFinite(p.value)),
    );
  if (!points.length) return null;
  const x = spec.x;

  if (x.kind === "time") {
    // Only complete periods are compared: an incomplete last month is not a fall.
    const n = data.categories.length;
    const full = points.filter(
      (p) => !((data.partialFirst && p.i === 0) || (data.partialLast && p.i === n - 1)),
    );
    if (full.length < 2) return null;
    const first = full[0] as (typeof full)[number];
    const last = full[full.length - 1] as (typeof full)[number];
    const peak = full.reduce((m, p) => (p.value > m.value ? p : m), first);
    let change: string | null;
    if (f === "percent") {
      const diff = last.value - first.value;
      change =
        Math.abs(diff) < 0.0005
          ? null
          : `${diff > 0 ? "Up" : "Down"} ${formatPointDelta(Math.abs(diff), fmt.locale).replace(/^\+/, "")}`;
    } else if (first.value === 0) {
      return named(`From ${v(0, f)} in ${first.cat.label} to ${v(last.value, f)} in ${last.cat.label}.`);
    } else {
      const rel = (last.value - first.value) / Math.abs(first.value);
      change =
        Math.abs(rel) < 0.005
          ? null
          : `${rel > 0 ? "Up" : "Down"} ${Math.abs(rel * 100).toFixed(Math.abs(rel) >= 1 ? 0 : 1)}%`;
    }
    if (!change)
      return named(
        `Flat at about ${v(last.value, f)} from ${first.cat.label} to ${last.cat.label}; peak ${v(peak.value, f)} in ${peak.cat.label}.`,
      );
    if (peak.i === last.i)
      return named(
        `${change} from ${first.cat.label} to ${last.cat.label}, ending at its peak of ${v(peak.value, f)}.`,
      );
    if (peak.i === first.i)
      return named(
        `${change} from its peak of ${v(peak.value, f)} in ${first.cat.label} to ${v(last.value, f)} in ${last.cat.label}.`,
      );
    return named(
      `${change} from ${first.cat.label} to ${last.cat.label}; peak ${v(peak.value, f)} in ${peak.cat.label}.`,
    );
  }

  if (points.length === 1) {
    const only = points[0] as (typeof points)[number];
    return named(`${only.cat.label}: ${v(only.value, f)}.`);
  }
  const top = points.reduce((m, p) => (p.value > m.value ? p : m), points[0] as (typeof points)[number]);
  const bottom = points.reduce((m, p) => (p.value < m.value ? p : m), points[0] as (typeof points)[number]);

  if (x.kind === "part") {
    // "on Sat", "at 20:00", "in Mar": the preposition the part takes.
    const at = x.part === "hour" ? "at" : x.part === "month" ? "in" : "on";
    return named(
      `Highest ${at} ${top.cat.label} (${v(top.value, f)}); lowest ${at} ${bottom.cat.label} (${v(bottom.value, f)}).`,
    );
  }
  if (data.kind === "donut" || data.kind === "pie") {
    // The share the donut itself shows: of the slices drawn, Others included.
    const sum = s.values.reduce<number>((a, x) => a + (x !== null && x > 0 ? x : 0), 0);
    return sum > 0 ? `${top.cat.label} is the largest share, at ${pct(top.value / sum)}.` : null;
  }
  const share = shareOf(top.value);
  if (data.kind === "table")
    // A table lists the leaders, so its last row isn't "the lowest": only the first is named.
    return `${top.cat.label} leads on ${inSentence(s.label)} with ${v(top.value, f)}${share ? `, ${share} of the total` : ""}.`;
  if (x.kind === "bins" && share)
    return named(`${top.cat.label} is the most common band: ${share} of the total.`);
  if (share) return named(`${top.cat.label} leads with ${v(top.value, f)}, ${share} of the total.`);
  return named(
    `${top.cat.label} is highest at ${v(top.value, f)}; ${bottom.cat.label} is lowest at ${v(bottom.value, f)}.`,
  );
}

/** Two keys, not over time (a weekday × hour heatmap, grouped columns): the largest cell. */
function largestCell(
  spec: ChartSpec,
  data: ChartData,
  v: (x: number | null | undefined, f: ValueFormat) => string,
): string | null {
  const rows = data.seriesCategories ?? [];
  const f = (data.series[0]?.format ?? spec.measures[0]?.format ?? "number") as ValueFormat;
  let best: { r: number; c: number; value: number } | null = null;
  (data.matrix ?? []).forEach((row, r) =>
    row.forEach((value, c) => {
      if (value !== null && Number.isFinite(value) && (!best || value > best.value) && !rows[r]?.isOthers)
        best = { r, c, value };
    }),
  );
  if (!best) return null;
  const { r, c, value } = best as { r: number; c: number; value: number };
  const row = rows[r]?.label;
  const col = data.categories[c]?.label;
  return row && col ? `Highest: ${row}, ${col} (${v(value, f)}).` : null;
}
