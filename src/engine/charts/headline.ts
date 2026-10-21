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
 * gives the make-up of its latest complete period, and a 100% stack its
 * largest share. Where nothing can be said honestly, there is no headline.
 *
 * What a sentence may claim follows what the chart holds. On a chart that
 * draws only its top groups, the lowest bar is only the lowest of those
 * shown, and says so. Daily and weekly points are noisy, so two single days
 * are never compared: the sentence gives the level and the peak instead. A
 * scatter's link says which way it runs. Weekdays and months are spelt out
 * in full, as sentences write them.
 */
import { MONTHS_LONG, MONTHS_SHORT, WEEKDAYS_LONG, WEEKDAYS_SHORT } from "@/engine/core/dates";
import {
  formatCount,
  formatPlain,
  formatPointDelta,
  formatValue,
  type FormatOptions,
  type ValueFormat,
} from "@/engine/core/format";
import { wasWere } from "@/engine/core/labels";
import type { ChartCategory, ChartData, ChartSpec, ResolvedAxis } from "./types";

/** What the chart's first measure is, and what the chart holds, as far as the wording goes. */
export interface HeadlineTraits {
  /** It adds up across groups (a sum or a count), so a group's share of the total is meaningful. */
  additive: boolean;
  /** It counts distinct things: a group's share is of the distinct total ("31% of customers"). */
  distinct: boolean;
  /**
   * Set when the chart draws only some of its axis's groups (a top N, the rest
   * left out or folded into Others): how many it draws on their own, how many
   * there are, and whether the ones drawn are the highest by the first
   * measure. The lowest bar is then not the lowest overall.
   */
  groups?: { shown: number; total: number; rankedByValue: boolean };
}

/** The kinds whose one number is the whole chart: a sentence adds nothing. */
const SELF_EVIDENT = new Set(["bigNumber", "gauge", "bullet"]);
const STACKED = new Set(["stackedBar", "stackedBar100", "stackedArea"]);

/** A measure's name inside a sentence: "net revenue", but "MRR" and "ARPA" keep their capitals. */
function inSentence(label: string): string {
  const [first = "", ...rest] = label.split(" ");
  return /^[A-Z0-9%]{2,}$/.test(first) ? label : [first.toLowerCase(), ...rest].join(" ");
}

/** "rises" or "rise", as the measure's name takes it ("MRR rises", "Seats rise"). */
const verb = (name: string, stem: "rise" | "fall"): string => (wasWere(name) === "were" ? stem : `${stem}s`);

/**
 * A category of a date-part axis as a sentence names it, with its preposition:
 * "on Saturday", "at 20:00", "in March", "on day 15". Null for other axes.
 */
function partPhrase(axis: ResolvedAxis | undefined, cat: ChartCategory): string | null {
  if (axis?.kind !== "part") return null;
  // The part's index (0 = Monday, 0 = January); a label alone ("Sat") is looked up.
  const index = (short: readonly string[]) =>
    typeof cat.raw === "number" ? cat.raw : short.indexOf(cat.label);
  switch (axis.part) {
    case "dow":
      return `on ${WEEKDAYS_LONG[index(WEEKDAYS_SHORT)] ?? cat.label}`;
    case "month":
      return `in ${MONTHS_LONG[index(MONTHS_SHORT)] ?? cat.label}`;
    case "hour":
      return `at ${cat.label}`;
    case "dom":
      return `on day ${cat.label}`;
  }
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
  // Whole percentages, except below 1%, where rounding would print "0%" for something that happened.
  const pct = (x: number) =>
    Math.abs(x) < 0.01 && x !== 0 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`;
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
    // Pairs are ranked by lift, so the first is the strongest pairing, not the most frequent one.
    const p = data.basket.pairs[0];
    return p
      ? `Strongest pairing: ${p.a} with ${p.b}, bought together ${p.lift.toFixed(1)}× more often than chance (${formatCount(p.orders, fmt.locale)} order${p.orders === 1 ? "" : "s"}).`
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
      ? `${last.label} ${wasWere(last.label) === "were" ? "are" : "is"} ${pct(last.fromFirst)} of ${inSentence(first.label)}.`
      : null;
  }
  if (data.points?.length && data.trendline) {
    const { r2, slope } = data.trendline;
    const [a, b] = spec.measures;
    // A flat or single-valued cloud has no fit (R² 0/0): nothing to say.
    if (!a || !b || !Number.isFinite(r2) || !Number.isFinite(slope)) return null;
    // Each point is a group's figures (a state, a band of values), not a single row, so the fit is
    // named as one across those groups: across rows the link can be far weaker.
    const groups = data.points.length;
    const fit = `(R² ${r2.toFixed(2)} across ${groups} ${groups === 1 ? "group" : "groups"})`;
    if (r2 < 0.2 || slope === 0) return `${a.label} and ${inSentence(b.label)} show no clear link ${fit}.`;
    // The second measure (y) moves with the first (x): which way says whether the link is good news.
    const x = inSentence(a.label);
    const how =
      slope > 0
        ? r2 >= 0.5
          ? `${verb(b.label, "rise")} with ${x}`
          : `tend${wasWere(b.label) === "were" ? "" : "s"} to rise with ${x}, loosely`
        : r2 >= 0.5
          ? `${verb(b.label, "fall")} as ${x} ${verb(a.label, "rise")}`
          : `tend${wasWere(b.label) === "were" ? "" : "s"} to fall as ${x} ${verb(a.label, "rise")}, loosely`;
    return `${b.label} ${how} ${fit}.`;
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
    // "on 27 Sep" for a day, "in the week of 6 Apr" for a week, "in Jan 2026" for longer periods.
    const when = (p: (typeof full)[number]) =>
      data.grain === "day"
        ? `on ${p.cat.label}`
        : data.grain === "week"
          ? `in the week of ${p.cat.label.replace(/^Wk of /, "")}`
          : `in ${p.cat.label}`;
    if (data.grain === "day" || data.grain === "week") {
      // Two single days or weeks are mostly noise ("up 162% from 1 Sep to 30 Sep"): the level and
      // the extremes say what such a chart shows. A sum or a count has a meaningful average per day
      // or week; a ratio or an average is given its range instead.
      const unit = data.grain;
      if (traits.additive || traits.distinct) {
        const mean = full.reduce((a, p) => a + p.value, 0) / full.length;
        return named(`${v(mean, f)} a ${unit} on average; peak ${v(peak.value, f)} ${when(peak)}.`);
      }
      const low = full.reduce((m, p) => (p.value < m.value ? p : m), first);
      return named(
        peak.value === low.value
          ? `${v(peak.value, f)} every ${unit} from ${first.cat.label} to ${last.cat.label}.`
          : `Ranges from ${v(low.value, f)} ${when(low)} to ${v(peak.value, f)} ${when(peak)}.`,
      );
    }
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
      // Grouped like every other figure: "Up 1,941%", never "Up 1941%".
      change =
        Math.abs(rel) < 0.005
          ? null
          : `${rel > 0 ? "Up" : "Down"} ${formatPlain(Math.abs(rel * 100), Math.abs(rel) >= 1 ? 0 : 1, fmt.locale)}%`;
    }
    if (!change)
      return named(
        `Flat at about ${v(last.value, f)} from ${first.cat.label} to ${last.cat.label}; peak ${v(peak.value, f)} ${when(peak)}.`,
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
      `${change} from ${first.cat.label} to ${last.cat.label}; peak ${v(peak.value, f)} ${when(peak)}.`,
    );
  }

  if (points.length === 1) {
    const only = points[0] as (typeof points)[number];
    return named(`${only.cat.label}: ${v(only.value, f)}.`);
  }
  const top = points.reduce((m, p) => (p.value > m.value ? p : m), points[0] as (typeof points)[number]);
  const bottom = points.reduce((m, p) => (p.value < m.value ? p : m), points[0] as (typeof points)[number]);

  if (x.kind === "part") {
    // "on Saturday", "at 20:00", "in March": the preposition and the full name the part takes.
    const at = (p: (typeof points)[number]) => partPhrase(x, p.cat) ?? p.cat.label;
    return named(`Highest ${at(top)} (${v(top.value, f)}); lowest ${at(bottom)} (${v(bottom.value, f)}).`);
  }
  if (data.kind === "donut" || data.kind === "pie") {
    // The share the donut itself shows: of the slices drawn, Others included.
    const sum = s.values.reduce<number>((a, x) => a + (x !== null && x > 0 ? x : 0), 0);
    return sum > 0 ? `${top.cat.label} is the largest share, at ${pct(top.value / sum)}.` : null;
  }
  // Only some groups drawn: the lowest of them is only the lowest of those shown, and when they
  // weren't picked by this measure, nor is the highest.
  const cut = traits.groups && traits.groups.shown < traits.groups.total ? traits.groups : null;
  const ofShown = cut ? ` of the ${cut.shown} shown` : "";
  const leaderOfShown = cut && !cut.rankedByValue ? ofShown : "";
  const share = shareOf(top.value);
  if (data.kind === "table")
    // A table lists the leaders, so its last row isn't "the lowest": only the first is named.
    return `${top.cat.label} leads on ${inSentence(s.label)}${leaderOfShown} with ${v(top.value, f)}${share ? `, ${share} of the total` : ""}.`;
  if (x.kind === "bins" && share)
    return named(`${top.cat.label} is the most common band: ${share} of the total.`);
  if (share)
    return named(`${top.cat.label} leads${leaderOfShown} with ${v(top.value, f)}, ${share} of the total.`);
  return named(
    cut
      ? `${top.cat.label} is highest${leaderOfShown} at ${v(top.value, f)}; ${bottom.cat.label} is lowest${ofShown}, at ${v(bottom.value, f)}.`
      : `${top.cat.label} is highest at ${v(top.value, f)}; ${bottom.cat.label} is lowest at ${v(bottom.value, f)}.`,
  );
}

/**
 * Two keys, not over time (a weekday × hour heatmap, grouped columns): the
 * largest cell, named as a sentence names it ("Highest on Saturday at 20:00
 * (471)"). A 100% stack is read in shares of each column, as it is drawn.
 */
function largestCell(
  spec: ChartSpec,
  data: ChartData,
  v: (x: number | null | undefined, f: ValueFormat) => string,
): string | null {
  const rows = data.seriesCategories ?? [];
  const f = (data.series[0]?.format ?? spec.measures[0]?.format ?? "number") as ValueFormat;
  const matrix = data.matrix ?? [];
  const shares = data.kind === "stackedBar100";
  // A column's whole, for a 100% stack: the sum of its parts (blanks as zero).
  const colTotal = (c: number) => matrix.reduce((sum, r) => sum + Math.max(0, r[c] ?? 0), 0);
  let best: { r: number; c: number; value: number } | null = null;
  matrix.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell === null || !Number.isFinite(cell) || rows[r]?.isOthers) return;
      const whole = shares ? colTotal(c) : 1;
      if (shares && !(whole > 0)) return;
      const value = shares ? cell / whole : cell;
      if (!best || value > best.value) best = { r, c, value };
    }),
  );
  if (!best) return null;
  const { r, c, value } = best as { r: number; c: number; value: number };
  const rowCat = rows[r];
  const colCat = data.categories[c];
  if (!rowCat || !colCat) return null;
  if (shares)
    return `The largest share is ${rowCat.label} in ${colCat.label}, at ${Math.round(value * 100)}%.`;
  const rowPart = partPhrase(spec.series, rowCat);
  const colPart = partPhrase(spec.x, colCat);
  if (rowPart && colPart) return `Highest ${rowPart} ${colPart} (${v(value, f)}).`;
  return `Highest: ${rowPart ? rowPart.replace(/^\w+ /, "") : rowCat.label}, ${colPart ? colPart.replace(/^\w+ /, "") : colCat.label} (${v(value, f)}).`;
}
