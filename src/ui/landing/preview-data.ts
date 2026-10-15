/**
 * Build-time data for the landing page.
 *
 * Runs the real engine (the same Session the Web Worker uses) on the
 * deterministic e-commerce demo dataset while Next.js prerenders "/", and
 * returns a small, serialisable snapshot: detection result, column profile,
 * hero KPIs for three date presets, a revenue trend, category and state
 * breakdowns, insights, and one KPI's SQL/DAX. Nothing on the landing page is
 * typed in by hand. If the engine changes, the page changes with it.
 *
 * Server-only: it imports the full engine and registry. Do not import it from
 * a client component; pass its result down as props instead.
 */
import { Session, type ContextResult, type KpiMeta } from "@/engine/session";
import { presetRange, PRESET_LABEL, type DatePreset } from "@/engine/core/periods";
import {
  formatDelta,
  formatPointDelta,
  formatValue,
  type FormatOptions,
  type ValueFormat,
} from "@/engine/core/format";
import { INDIA_STATES, matchIndianState } from "@/engine/profile/geo";
import { generateSample } from "@/engine/samples";
import { SAMPLES } from "@/engine/samples/catalog";
import { ROLE_LABEL } from "@/engine/profile/types";
import type { Filter } from "@/engine/query/filter";
import type { ChartData } from "@/engine/charts/types";
import { DOMAINS } from "@/registry";

/** Date presets the hero preview can switch between. */
export const PREVIEW_PRESETS = ["last12m", "last6m", "last90d"] as const satisfies readonly DatePreset[];
export type PreviewPresetId = (typeof PREVIEW_PRESETS)[number];

export interface PreviewKpi {
  id: string;
  name: string;
  format: ValueFormat;
  value: number | null;
  display: string;
  deltaText: string;
  /** Sign of the change versus the comparison period. */
  change: "up" | "down" | "flat";
  /** Good/bad is judged against the KPI's direction (lower RTO is good). */
  tone: "good" | "bad" | "neutral";
  spark: number[];
}

export interface PreviewState {
  id: PreviewPresetId;
  label: string;
  periodLabel: string;
  comparisonLabel: string;
  rows: string;
  kpis: PreviewKpi[];
  trend: {
    title: string;
    labels: string[];
    values: number[];
    display: string[];
    peak: number;
    grain: string;
    partialLast: boolean;
  };
  categories: Array<{ label: string; display: string; share: number }>;
  states: Array<{ code: string; name: string; row: number; col: number; display: string; intensity: number }>;
  insights: Array<{ title: string; body: string; tone: string }>;
}

export interface LandingData {
  file: { name: string; rows: string; columns: number; generatedMs: number; profileMs: number };
  detection: {
    domain: string;
    subDomain: string;
    confidence: number;
    grain: string;
    evidence: Array<{ field: string; column: string }>;
    runnerUp: { name: string; confidence: number } | null;
    /** Top three industries with their confidence, as the Detect step shows them. */
    candidates: Array<{ name: string; confidence: number }>;
  };
  columns: Array<{ name: string; type: string; role: string }>;
  /** Every state/UT tile of the India tile map, so the outline reads even where there is no data. */
  tiles: Array<{ code: string; name: string; row: number; col: number }>;
  /** Actual size of each demo dataset, generated at build time. */
  samples: Record<string, { rows: string; columns: number }>;
  health: { score: number; grade: string };
  states: PreviewState[];
  showcase: {
    kpi: { name: string; definition: string; formula: string; sql: string; dax: string; daxName: string };
    chart: { title: string; reason: string };
    insight: { title: string; body: string; basis: string } | null;
    skipped: number;
  };
  registry: {
    domains: number;
    kpis: number;
    charts: number;
    list: Array<{
      id: string;
      name: string;
      tagline: string;
      icon: string;
      flagship: boolean;
      kpis: number;
      charts: number;
      areas: string[];
    }>;
  };
}

const LOCALE_OPTS: FormatOptions = { locale: "IN", currency: "INR" };

const STORAGE_LABEL: Record<string, string> = {
  number: "Number",
  date: "Date",
  string: "Text",
  boolean: "Yes/No",
};

function kpiTone(meta: KpiMeta, delta: number | null): PreviewKpi["tone"] {
  if (delta === null || !Number.isFinite(delta) || Math.abs(delta) < 1e-9 || meta.direction === "neutral")
    return "neutral";
  const up = delta > 0;
  return (meta.direction === "higher") === up ? "good" : "bad";
}

function toKpis(ctx: ContextResult, session: Session, filters: Filter[], ids: string[]): PreviewKpi[] {
  const batch = session.kpiBatch(filters, ids, "IN");
  return batch.values.flatMap((v) => {
    const meta = ctx.kpis.find((k) => k.id === v.id);
    if (!meta || v.value === null) return [];
    const isPercent = meta.format === "percent";
    const deltaText = isPercent ? formatPointDelta(v.deltaAbs, "IN") : formatDelta(v.delta, "IN");
    const d = isPercent ? v.deltaAbs : v.delta;
    const change = d === null || !Number.isFinite(d) || Math.abs(d) < 1e-9 ? "flat" : d > 0 ? "up" : "down";
    return [
      {
        id: v.id,
        name: meta.short ?? meta.name,
        format: meta.format,
        value: v.value,
        display: formatValue(v.value, meta.format, { ...LOCALE_OPTS, compact: true }),
        deltaText,
        change,
        tone: kpiTone(meta, isPercent ? v.deltaAbs : v.delta),
        spark: v.spark.map((p) => p.v ?? 0),
      },
    ];
  });
}

function seriesValues(data: ChartData | null): number[] {
  return (data?.series[0]?.values ?? []).map((v) => (v === null || !Number.isFinite(v) ? 0 : v));
}

/** Runs the engine on the demo dataset and returns the landing-page snapshot. */
export function buildLandingData(): LandingData {
  const session = new Session();
  const load = session.ingestSample("ecommerce");
  if (load.status !== "ok") throw new Error("Demo dataset failed to load");
  const top = load.detection.candidates[0];
  if (!top) throw new Error("Demo dataset was not detected");
  const ctx = session.configure({ domainId: top.domainId, numberLocale: "IN", currency: null });
  if (!ctx.dateColumn || !ctx.dateBounds) throw new Error("Demo dataset has no date column");
  const dateColumn = ctx.dateColumn;
  const bounds = ctx.dateBounds;

  // The four KPIs that tell the D2C story best; fall back to the engine's own hero pick.
  const preferred = ["net_revenue", "orders", "aov", "rto_rate"].filter((id) =>
    ctx.kpis.some((k) => k.id === id && k.available),
  );
  const heroIds = [...preferred, ...ctx.selection.hero.filter((id) => !preferred.includes(id))].slice(0, 4);
  const trendSpec =
    ctx.charts.find((c) => c.id === "trend_revenue") ?? ctx.charts.find((c) => c.x.kind === "time");
  const categorySpec = ctx.charts.find((c) => c.id === "revenue_by_category");
  const stateSpec = ctx.charts.find((c) => c.id === "revenue_by_state");

  const states: PreviewState[] = PREVIEW_PRESETS.map((preset) => {
    const range = presetRange(preset, bounds);
    const filters: Filter[] = range
      ? [{ kind: "dateRange", column: dateColumn, from: range.from, to: range.to }]
      : [];
    const kpis = toKpis(ctx, session, filters, heroIds);
    const batch = session.kpiBatch(filters, heroIds, "IN");
    const grain = preset === "last90d" ? "week" : "month";
    const trend = trendSpec ? session.chart(filters, { specId: trendSpec.id, grain }, "IN") : null;
    const cats = categorySpec ? session.chart(filters, { specId: categorySpec.id }, "IN") : null;
    const geo = stateSpec ? session.chart(filters, { specId: stateSpec.id }, "IN") : null;
    // Insights read the most recent KPI batch and chart results held by the session.
    const insights = session
      .insights("IN")
      .filter((i) => i.kind !== "caveat")
      .slice(0, 3)
      .map((i) => ({ title: i.title, body: i.body, tone: i.tone }));

    // Drop leading buckets that start before the range (a week straddling the start date is partial).
    const firstFull =
      range && trend
        ? Math.max(
            0,
            trend.categories.findIndex((c) => typeof c.raw === "number" && c.raw >= range.from),
          )
        : 0;
    const trendValues = seriesValues(trend).slice(firstFull);
    const peak = trendValues.reduce((best, v, i, a) => (v > (a[best] ?? -Infinity) ? i : best), 0);
    const trendFormat = (trend?.series[0]?.format ?? "currency") as ValueFormat;

    const catValues = seriesValues(cats);
    const catTotal = catValues.reduce((a, b) => a + b, 0) || 1;
    const catFormat = (cats?.series[0]?.format ?? "currency") as ValueFormat;

    const geoValues = seriesValues(geo);
    const geoMax = Math.max(...geoValues, 1);
    const geoFormat = (geo?.series[0]?.format ?? "currency") as ValueFormat;

    return {
      id: preset,
      label: PRESET_LABEL[preset],
      periodLabel: batch.period?.label ?? "",
      comparisonLabel: batch.comparison?.label ?? "",
      rows: formatValue(session.rowCount(filters), "integer", LOCALE_OPTS),
      kpis,
      trend: {
        title: trendSpec?.title ?? "Trend",
        labels: (trend?.categories ?? []).slice(firstFull).map((c) => c.label),
        values: trendValues,
        display: trendValues.map((v) => formatValue(v, trendFormat, { ...LOCALE_OPTS, compact: true })),
        peak,
        grain,
        partialLast: Boolean(trend?.partialLast),
      },
      categories: (cats?.categories ?? []).slice(0, 6).map((c, i) => ({
        label: c.label,
        display: formatValue(catValues[i] ?? 0, catFormat, { ...LOCALE_OPTS, compact: true }),
        share: (catValues[i] ?? 0) / catTotal,
      })),
      states: (geo?.categories ?? []).flatMap((c, i) => {
        const def = matchIndianState(c.label);
        if (!def) return [];
        const value = geoValues[i] ?? 0;
        return [
          {
            code: def.code,
            name: def.name,
            row: def.tile[0],
            col: def.tile[1],
            display: formatValue(value, geoFormat, { ...LOCALE_OPTS, compact: true }),
            intensity: value / geoMax,
          },
        ];
      }),
      insights,
    };
  });

  // Showcase artefacts for the feature section: one auditable KPI, one chart rationale, one insight.
  const showcaseKpi =
    ctx.kpis.find((k) => k.id === "rto_rate" && k.available) ??
    ctx.kpis.find((k) => k.available && k.sql && k.dax);
  if (!showcaseKpi?.sql || !showcaseKpi.dax) throw new Error("No KPI with SQL and DAX to showcase");
  const showcaseChart = categorySpec ?? ctx.charts[0];
  const range12 = presetRange("last12m", bounds);
  session.kpiBatch(
    range12 ? [{ kind: "dateRange", column: dateColumn, from: range12.from, to: range12.to }] : [],
    [...ctx.selection.hero, ...ctx.selection.supporting],
    "IN",
  );
  const insight = session.insights("IN").find((i) => i.kind !== "caveat") ?? null;

  const runner = load.detection.candidates[1];
  return {
    file: {
      name: load.summary.fileName,
      rows: formatValue(load.summary.rowCount, "integer", LOCALE_OPTS),
      columns: load.summary.columnCount,
      generatedMs: load.timings.generate ?? 0,
      profileMs: load.timings.profile ?? 0,
    },
    detection: {
      domain: top.name,
      subDomain: top.subDomain.name,
      confidence: Math.round(top.confidence),
      grain: top.grain,
      evidence: top.evidence.slice(0, 6).map((e) => ({ field: e.fieldLabel, column: e.column })),
      runnerUp: runner ? { name: runner.name, confidence: Math.round(runner.confidence) } : null,
      candidates: load.detection.candidates
        .slice(0, 3)
        .map((c) => ({ name: c.name, confidence: Math.round(c.confidence) })),
    },
    columns: load.profile.columns.map((c) => ({
      name: c.name,
      type: STORAGE_LABEL[c.storage] ?? c.storage,
      role: ROLE_LABEL[c.role] ?? c.role,
    })),
    tiles: INDIA_STATES.map((s) => ({ code: s.code, name: s.name, row: s.tile[0], col: s.tile[1] })),
    samples: Object.fromEntries(
      SAMPLES.map((s) => {
        const ds = s.id === "ecommerce" ? null : generateSample(s.id);
        return [
          s.id,
          {
            rows: formatValue(ds ? ds.rowCount : load.summary.rowCount, "integer", LOCALE_OPTS),
            columns: ds ? ds.columns.length : load.summary.columnCount,
          },
        ];
      }),
    ),
    health: { score: load.health.score, grade: load.health.grade },
    states,
    showcase: {
      kpi: {
        name: showcaseKpi.name,
        definition: showcaseKpi.definition,
        formula: showcaseKpi.formula,
        sql: showcaseKpi.sql,
        dax: showcaseKpi.dax,
        daxName: showcaseKpi.daxName,
      },
      chart: { title: showcaseChart?.title ?? "", reason: showcaseChart?.reason ?? "" },
      insight: insight ? { title: insight.title, body: insight.body, basis: insight.basis } : null,
      skipped: ctx.skippedCharts.length,
    },
    registry: {
      domains: DOMAINS.length,
      kpis: DOMAINS.reduce((n, d) => n + d.kpis.length, 0),
      charts: DOMAINS.reduce((n, d) => n + d.charts.length, 0),
      list: DOMAINS.map((d) => ({
        id: d.id,
        name: d.name,
        tagline: d.tagline,
        icon: d.icon,
        flagship: Boolean(d.flagship),
        kpis: d.kpis.length,
        charts: d.charts.length,
        areas: d.subDomains.map((s) => s.name),
      })),
    },
  };
}
