/**
 * Chart recommendation: registry templates resolved against the actual mapped
 * columns, adapted by explicit rules, each adaptation recorded in the reason.
 *
 * A template is skipped, with a reason, when a measure is unavailable, an
 * axis field is unmapped or unusable (not a date, a single value), or an
 * analysis lacks its inputs. Adaptations: hour of day falls back to month
 * when the dates carry no time; a tile map falls back to bars without
 * state-level IN/US geography; a donut never shows more than six slices
 * (MAX_DONUT_SLICES, Others included), so with more categories it becomes
 * sorted bars (no topN) or shows the top five plus Others. A spec gets
 * `geoRegion` whenever its x column is a state-level IN/US column, so a tile
 * map alternative really can be drawn, and its alternatives keep only the
 * kinds isKindCompatible accepts. Analyses look up fixed field ids, so a
 * domain using them must define: rfm/cohort → customer_id and order_date
 * (order_id optional; net_revenue preferred as the monetary KPI); basket →
 * order_id and product_name or product_id.
 */
import type { DatasetProfile, ColumnProfile } from "@/engine/profile/types";
import type { Mapping } from "@/engine/detect/mapping";
import type { KpiResolutionMap } from "@/engine/kpi/resolve";
import { fieldsOf, type RowExpr } from "@/engine/query/expr";
import type { AxisDef, ChartKind, ChartTemplate, DomainDef, KpiFormat } from "@/registry/schema";
import {
  MAX_DONUT_SLICES,
  type ChartMeasure,
  type ChartSection,
  type ChartSpec,
  type LayoutMode,
  type ResolvedAxis,
} from "./types";
import { CHART_TYPES } from "./catalogue";

export interface RecommendInput {
  domain: DomainDef;
  mapping: Mapping;
  res: KpiResolutionMap;
  profile: DatasetProfile;
  subDomain?: string;
}

/** A template that could not be drawn, with the reason shown to the user. */
export interface SkippedChart {
  id: string;
  title: string;
  reason: string;
}

const colProfile = (profile: DatasetProfile, name: string | undefined): ColumnProfile | undefined =>
  name ? profile.columns.find((c) => c.name === name) : undefined;

/**
 * Display metadata for a measure id: the registry KPI's short name, format and
 * direction, or a label and format derived from an ad-hoc "agg:" id and the
 * column's profile. Unknown ids fall back to the raw id as a plain number.
 */
export function measureMeta(id: string, domain: DomainDef, profile: DatasetProfile): ChartMeasure {
  const k = domain.kpis.find((x) => x.id === id);
  if (k) return { id, label: k.short ?? k.name, format: k.format, direction: k.direction };
  const m = /^agg:(\w+):(.*)$/.exec(id);
  if (m) {
    const [, agg, column] = m as unknown as [string, string, string];
    const p = colProfile(profile, column);
    const label =
      agg === "count"
        ? "Rows"
        : agg === "countDistinct"
          ? `Distinct ${column}`
          : `${agg === "avg" ? "Average" : agg === "sum" ? "Total" : agg[0]?.toUpperCase() + agg.slice(1)} ${column}`;
    const format: KpiFormat =
      agg === "count" || agg === "countDistinct"
        ? "integer"
        : p?.role === "currency"
          ? "currency"
          : p?.role === "percentage" && p.percentScale === 1
            ? "percent"
            : "number";
    return { id, label, format, direction: "neutral" };
  }
  return { id, label: id, format: "number", direction: "neutral" };
}

/**
 * The separate time-of-day column that goes with `dateColumn` (e.g.
 * "Order Time" for "Order Date"): the one sharing a name word other than
 * date/time words, else the only time column in the file.
 */
export function timeColumnFor(
  profile: Pick<DatasetProfile, "columns">,
  dateColumn: string,
): ColumnProfile | undefined {
  const times = profile.columns.filter((c) => c.role === "time");
  if (times.length <= 1) return times[0];
  const generic = new Set(["date", "time", "dt", "datetime", "timestamp", "ts", "at", "on"]);
  const date = profile.columns.find((c) => c.name === dateColumn);
  const words = new Set((date?.tokens ?? []).filter((t) => !generic.has(t)));
  return times.find((c) => c.tokens.some((t) => words.has(t)));
}

/** Binds a template axis (field ids) to mapped columns; `missing` names what is lacking, `note` records an adaptation. */
function resolveAxis(
  axis: AxisDef | undefined,
  mapping: Mapping,
  profile: DatasetProfile,
  domain: DomainDef,
): { axis?: ResolvedAxis; missing?: string; note?: string } {
  if (!axis) return {};
  const label = (fieldId: string) => domain.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
  if ("none" in axis) return { axis: { kind: "none" } };
  if ("time" in axis) {
    const column = mapping.fields[axis.time];
    if (!column) return { missing: label(axis.time) };
    const tp = colProfile(profile, column);
    if (tp?.storage !== "date" || tp.role === "time") return { missing: `${label(axis.time)} as a date` };
    return { axis: { kind: "time", column, grain: axis.grain ?? "auto", label: column } };
  }
  if ("field" in axis) {
    const column = mapping.fields[axis.field];
    if (!column) return { missing: label(axis.field) };
    const p = colProfile(profile, column);
    if (p && p.distinct < 2) return { missing: `${label(axis.field)} with more than one value` };
    return { axis: { kind: "column", column, label: column } };
  }
  if ("part" in axis) {
    const column = mapping.fields[axis.of];
    if (!column) return { missing: label(axis.of) };
    const p = colProfile(profile, column);
    // A time-of-day column has no weekday or month.
    if (p?.role === "time" && axis.part !== "hour") return { missing: `${label(axis.of)} as a date` };
    if (axis.part === "hour" && !p?.temporal?.hasTime) {
      // Dates without times, but the file keeps the time in its own column: the hour comes from there.
      const time = timeColumnFor(profile, column);
      if (time)
        return {
          axis: { kind: "part", column: time.name, part: "hour", label: "Hour of day" },
          note: `${column} has no time of day, so the hour comes from your separate ${time.name} column.`,
        };
      return {
        axis: { kind: "part", column, part: "month", label: "Month" },
        note: "The dates carry no time of day, so month replaces hour.",
      };
    }
    return {
      axis: {
        kind: "part",
        column,
        part: axis.part,
        label: axis.part === "dow" ? "Weekday" : axis.part === "hour" ? "Hour of day" : "Month",
      },
    };
  }
  const missing = [...fieldsOf(axis.bins as RowExpr)].filter((f) => !mapping.fields[f]);
  if (missing.length) return { missing: missing.map(label).join(", ") };
  return {
    axis: {
      kind: "bins",
      expr: axis.bins as RowExpr,
      count: axis.count ?? 10,
      format: axis.format ?? "number",
      label: axis.label,
    },
  };
}

/**
 * Layout modes for a template: its explicit `modes`, or else every mode for
 * high-priority charts (trend and breakdown ≤ 3, drivers ≤ 2) and analyst mode only for the rest.
 * Explicit modes are copied, so a spec never shares an array with the registry.
 */
function defaultModes(t: ChartTemplate): LayoutMode[] {
  if (t.modes) return [...t.modes];
  const exec =
    (t.section === "trend" && t.priority <= 3) ||
    (t.section === "breakdown" && t.priority <= 3) ||
    (t.section === "drivers" && t.priority <= 2);
  return exec ? ["executive", "analyst", "compact"] : ["analyst"];
}

/** Resolves the domain's templates into ChartSpecs, sorted by section then priority, plus the skipped ones with reasons. */
export function recommendCharts(input: RecommendInput): { specs: ChartSpec[]; skipped: SkippedChart[] } {
  const { domain, mapping, res, profile, subDomain } = input;
  const specs: ChartSpec[] = [];
  const skipped: SkippedChart[] = [];
  const f = (id: string) => mapping.fields[id];

  for (const t of domain.charts) {
    if (t.subDomains) {
      if (subDomain && !t.subDomains.includes(subDomain)) continue;
    } else if (subDomain && domain.subDomains[0] && subDomain !== domain.subDomains[0].id) {
      // Untagged charts belong to the primary sub-domain; elsewhere keep them only if they work.
      // (Dropped silently here rather than listed as skipped.)
      if (!t.measures.every((m) => res.get(m)?.available)) continue;
    }
    const unavailable = t.measures.filter((m) => !res.get(m)?.available);
    if (unavailable.length) {
      const names = unavailable.map((m) => domain.kpis.find((k) => k.id === m)?.name ?? m);
      skipped.push({
        id: t.id,
        title: t.title,
        reason: `Needs ${names.join(", ")}, which can't be computed from this data.`,
      });
      continue;
    }
    const x = resolveAxis(t.x, mapping, profile, domain);
    const series = resolveAxis(t.series, mapping, profile, domain);
    if (x.missing || series.missing) {
      skipped.push({ id: t.id, title: t.title, reason: `Needs ${x.missing ?? series.missing}.` });
      continue;
    }
    let kind: ChartKind = t.kind;
    let reason = t.reason;
    let title = t.title;
    let topN = t.topN;
    if (x.note) {
      reason = `${reason} ${x.note}`;
      title = title.replace(/hour/i, "month");
    }
    const xCol = x.axis && x.axis.kind === "column" ? colProfile(profile, x.axis.column) : undefined;
    // Set for any state-level IN/US x column, not just tile maps, so a tile map alternative can be drawn.
    const geoRegion =
      xCol?.geoLevel === "state" && (xCol.geoRegion === "IN" || xCol.geoRegion === "US")
        ? xCol.geoRegion
        : undefined;
    if (kind === "geoTile" && !geoRegion) {
      kind = t.alternatives.find((a) => a !== "geoTile") ?? "hbar";
      reason = `${reason} No state-level geography was recognised, so a bar chart is used instead of a map.`;
    }
    // A donut keeps at most six slices, Others included (data.ts enforces the same cap).
    if (kind === "donut" && xCol && xCol.distinct > MAX_DONUT_SLICES) {
      const others = t.others ?? true;
      const fits = others ? MAX_DONUT_SLICES - 1 : MAX_DONUT_SLICES;
      if (!topN) {
        kind = "hbar";
        reason = `${reason} With ${xCol.distinct} categories a donut becomes unreadable, so sorted bars are used.`;
      } else if (topN > fits) {
        topN = fits;
        reason = `${reason} A donut keeps at most ${MAX_DONUT_SLICES} slices, so it shows the top ${fits}${others ? " and folds the rest into Others" : ""}.`;
      }
    }

    let analysisParams: ChartSpec["analysisParams"];
    if (t.analysis === "cohort" || t.analysis === "rfm") {
      const customer = f("customer_id");
      const date = f("order_date");
      if (!customer || !date) {
        skipped.push({ id: t.id, title: t.title, reason: "Needs a customer ID and an order date." });
        continue;
      }
      const cp = colProfile(profile, customer);
      if (cp && cp.distinct < 30) {
        skipped.push({
          id: t.id,
          title: t.title,
          reason: "Fewer than 30 customers is too few for a reliable segmentation.",
        });
        continue;
      }
      const span = colProfile(profile, date)?.temporal?.spanDays ?? 0;
      if (t.analysis === "cohort" && span < 90) {
        skipped.push({ id: t.id, title: t.title, reason: "Cohorts need at least three months of history." });
        continue;
      }
      analysisParams = {
        customer,
        date,
        order: f("order_id"),
        monetary: res.get("net_revenue")?.available ? "net_revenue" : t.measures[0],
      };
    }
    if (t.analysis === "basket") {
      const order = f("order_id");
      const item = f("product_name") ?? f("product_id");
      const op = colProfile(profile, order);
      if (!order || !item || !op) {
        skipped.push({ id: t.id, title: t.title, reason: "Needs an order ID and a product column." });
        continue;
      }
      if (profile.rowCount / Math.max(1, op.distinct) < 1.05) {
        skipped.push({
          id: t.id,
          title: t.title,
          reason: "Each order has a single line, so there are no product pairs to analyse.",
        });
        continue;
      }
      analysisParams = { order, item, itemLabel: f("product_name") ? "product" : "SKU" };
    }

    // Unmapped drill levels are dropped; drill-down needs at least two mapped levels.
    const drill = (t.drill ?? []).map((d) => f(d)).filter((c): c is string => Boolean(c));
    const spec: ChartSpec = {
      id: t.id,
      title,
      kind,
      section: t.section,
      x: x.axis as ResolvedAxis,
      series: series.axis,
      measures: t.measures.map((m) => measureMeta(m, domain, profile)),
      analysis: t.analysis,
      analysisParams,
      topN,
      others: t.others,
      minGroupRows: t.minGroupRows,
      drill: drill.length >= 2 ? drill : undefined,
      reason,
      alternatives: [],
      size: t.size,
      priority: t.priority,
      modes: defaultModes(t),
      source: domain.id === "generic" ? "generic" : "domain",
      geoRegion,
    };
    // Offer only kinds that can draw this spec (no tile map without state geography, no bars for a wide table).
    spec.alternatives = t.alternatives.filter(
      (a, i, all) => a !== kind && all.indexOf(a) === i && isKindCompatible(a, spec),
    );
    specs.push(spec);
  }
  const sectionOrder = { trend: 0, breakdown: 1, drivers: 2, columns: 3, detail: 4 } as const;
  specs.sort((a, b) => sectionOrder[a.section] - sectionOrder[b.section] || a.priority - b.priority);
  return { specs, skipped };
}

/** True when every measure has the first one's format: they can share one value axis (never two). */
function sameUnit(spec: ChartSpec): boolean {
  const f = spec.measures[0]?.format;
  return spec.measures.every((m) => m.format === f);
}

/**
 * Whether a chart kind can render a spec's data shape (drives the Alternatives
 * switcher and the chart builder). `categoryCount`, when known, is how many
 * categories the chart currently has; a donut or pie takes at most
 * MAX_DONUT_SLICES of them. Kinds drawn with one series per split value
 * accept a split with one measure, or 2+ measures in one unit.
 */
export function isKindCompatible(kind: ChartKind, spec: ChartSpec, categoryCount?: number): boolean {
  const x = spec.x.kind;
  const m = spec.measures.length;
  const split = Boolean(spec.series);
  const series = (min: number, max: number) => (split ? m === 1 : m >= min && m <= max && sameUnit(spec));
  if (spec.analysis === "cohort") return kind === "cohort" || kind === "table";
  if (spec.analysis === "rfm") return kind === "treemap" || kind === "hbar" || kind === "table";
  if (spec.analysis === "basket") return kind === "table" || kind === "hbar";
  if (spec.analysis === "funnel") return kind === "funnel" || kind === "bar";
  switch (kind) {
    case "line":
    case "area":
      return (x === "time" || x === "part" || x === "bins") && m <= 4;
    case "step":
      return (x === "time" || x === "part") && series(1, 4);
    case "stackedArea":
      return (x === "time" || x === "part") && series(2, 4);
    case "calendar":
      return x === "time" && m === 1 && !split;
    case "groupedBar":
      return (x === "time" || x === "column" || x === "part") && series(2, 4);
    case "stackedBar100":
      return (x === "time" || x === "column" || x === "part") && (m >= 2 || split);
    case "lollipop":
      return x === "column" && m === 1 && !split;
    case "dumbbell":
      return x === "column" && series(2, 2);
    case "radar":
      return x === "column" && (split ? m === 1 : m >= 3 && m <= 8);
    case "pie":
      return (
        x === "column" &&
        m === 1 &&
        !split &&
        (categoryCount === undefined || categoryCount <= MAX_DONUT_SLICES)
      );
    case "sunburst":
      return x === "column" && m === 1;
    case "bubble":
      return x === "column" && m === 3 && !split;
    case "sankey":
      return x === "column" && spec.series?.kind === "column" && m === 1;
    case "bigNumber":
    case "gauge":
      return x === "none" && m === 1;
    case "bar":
      return x !== "none" && m <= 4;
    case "hbar":
      return x === "column" && m <= 2;
    case "stackedBar":
      return (x === "time" || x === "column" || x === "part") && (m >= 2 || Boolean(spec.series));
    case "donut":
      return x === "column" && m === 1 && (categoryCount === undefined || categoryCount <= MAX_DONUT_SLICES);
    case "treemap":
      return x === "column" && m === 1;
    case "scatter":
      return x === "column" && m >= 2;
    case "histogram":
      return x === "bins";
    case "heatmap":
      return Boolean(spec.series) && m === 1;
    case "pareto":
      return x === "column" && m === 1;
    case "geoTile":
      return x === "column" && Boolean(spec.geoRegion) && m === 1;
    case "table":
      return x !== "none";
    case "funnel":
    case "cohort":
    case "waterfall":
    case "bullet":
    case "bump":
    case "box":
      return false;
  }
}

/**
 * Builds a user-defined chart (chart builder, Ask for a chart). Section and
 * size default from the axis; the alternatives offered in the chart's type
 * switcher are every buildable kind that can draw the same data.
 */
export function customSpec(opts: {
  id: string;
  title: string;
  kind: ChartKind;
  x: ResolvedAxis;
  series?: ResolvedAxis;
  measures: ChartMeasure[];
  topN?: number;
  others?: boolean;
  section?: ChartSection;
  size?: { w: number; h: number };
  /** Goal for a gauge or big number, in the measure's units. */
  target?: number;
  /** State-level geography of the x column, for the tile map. */
  geoRegion?: "IN" | "US";
  /** A funnel built from stage measures. */
  analysis?: "funnel";
}): ChartSpec {
  const spec: ChartSpec = {
    id: opts.id,
    title: opts.title,
    kind: opts.kind,
    section: opts.section ?? (opts.x.kind === "time" ? "trend" : "breakdown"),
    x: opts.x,
    series: opts.series,
    measures: opts.measures,
    topN: opts.topN,
    others: opts.others,
    reason: "Configured by you.",
    alternatives: [],
    size: opts.size ?? { w: 6, h: 4 },
    priority: 50,
    modes: ["executive", "analyst", "compact"],
    source: "custom",
    ...(opts.target !== undefined && Number.isFinite(opts.target) ? { target: opts.target } : {}),
    ...(opts.geoRegion ? { geoRegion: opts.geoRegion } : {}),
    ...(opts.analysis ? { analysis: opts.analysis } : {}),
  };
  spec.alternatives = CHART_TYPES.filter(
    (t) => t.buildable && t.kind !== spec.kind && isKindCompatible(t.kind, spec),
  ).map((t) => t.kind);
  return spec;
}
