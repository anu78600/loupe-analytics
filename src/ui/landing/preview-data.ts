/**
 * Build-time data for the landing page.
 *
 * Runs the real engine (the same Session the Web Worker uses) on the
 * deterministic e-commerce demo dataset while Next.js prerenders "/", and
 * returns a small, serialisable snapshot. Nothing on the landing page is typed
 * in by hand: if the engine changes, the page changes with it.
 *
 * The hero's preview is the live demo's one-page dashboard, so the snapshot
 * builds it the way the workspace does: every KPI and chart the dashboard
 * computes on a refresh (Session.computeDashboard, as the store's refresh
 * asks for them), then the insights read from those results, and the page's
 * title, KPI tiles and four charts chosen by the one page's own plan
 * (ui/workspace/dashboard/page/pagePlan.ts). Each chart carries its takeaway
 * (engine/charts/headline.ts) and each KPI the icon and number style its
 * card uses, for three date presets the visitor can switch between.
 *
 * The rest feeds "How it works" and the feature tiles: the detection and the
 * reading of the data (what one row is, what moves the outcome), the column
 * profile, one KPI's SQL and DAX, one question answered with its SQL, and the
 * counts quoted from the registry and the chart catalogue.
 *
 * Server-only: it imports the full engine and registry. Do not import it from
 * a client component; pass its result down as props instead.
 */
import { Session, type ContextResult, type KpiMeta } from "@/engine/session";
import { presetRange, PRESET_LABEL, type DatePreset } from "@/engine/core/periods";
import { formatDay, MONTHS_SHORT } from "@/engine/core/dates";
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
import { KIND_LABEL } from "@/engine/understand/kinds";
import type { Filter } from "@/engine/query/filter";
import type { ChartData, ChartSpec } from "@/engine/charts/types";
import { readQuestion, type AskContext } from "@/engine/charts/ask";
import { DOMAINS } from "@/registry";
import { CHART_TYPES } from "@/engine/charts/catalogue";
import { friendly, kpiLabel } from "@/engine/core/labels";
import { kpiCompact } from "@/ui/common/kpiFormat";
import {
  dataLed,
  defaultPageTitle,
  kpiIconName,
  PAGE_CHARTS,
  pageKpiIds,
  pageSubtitle,
  pickPageCharts,
  placeCharts,
  planRank,
  type KpiIconName,
} from "@/ui/workspace/dashboard/page/pagePlan";

/** Date presets the hero preview can switch between. */
export const PREVIEW_PRESETS = ["last12m", "last6m", "last90d"] as const satisfies readonly DatePreset[];
export type PreviewPresetId = (typeof PREVIEW_PRESETS)[number];

export interface PreviewKpi {
  id: string;
  name: string;
  format: ValueFormat;
  value: number | null;
  display: string;
  /** Written in compact units, as the dashboard's KPI card writes this value (ui/common/kpiFormat). */
  compact: boolean;
  deltaText: string;
  /** Sign of the change versus the comparison period. */
  change: "up" | "down" | "flat";
  /** Good/bad is judged against the KPI's direction (lower RTO is good). */
  tone: "good" | "bad" | "neutral";
  /** The trend under the figure, one point per period (null where a period has no value). */
  spark: Array<number | null>;
  /** The last period is still running, so the sparkline draws it dashed. */
  partialLast: boolean;
  /** The icon on the KPI card's chip (pagePlan's kpiIconName). */
  icon: KpiIconName;
}

/** A chart card's head: its title and the one-sentence takeaway the engine wrote from its data. */
export interface PreviewHead {
  id: string;
  title: string;
  takeaway: string | null;
}

export interface PreviewInsight {
  title: string;
  body: string;
  tone: "positive" | "negative" | "neutral" | "warning";
  kind: string;
  /** The engine's ranking score, 0–100 (engine/insights). */
  impact: number;
  confidence: "high" | "medium" | "low";
}

export interface PreviewState {
  id: PreviewPresetId;
  label: string;
  periodLabel: string;
  comparisonLabel: string;
  /** Rows in the selection, formatted. */
  rows: string;
  /** The one page's KPI tiles, in its order. */
  kpis: PreviewKpi[];
  trend: PreviewHead & {
    labels: string[];
    /** Start of each period (UTC ms), so the axis can print the year once per year. */
    starts: number[];
    values: number[];
    display: string[];
    peak: number;
    grain: string;
    /** The first period starts before the range, the last ends after the data: both drawn dashed. */
    partialFirst: boolean;
    partialLast: boolean;
  };
  /** The page's share-of-the-whole chart (a donut), when it has one. */
  mix:
    | (PreviewHead & {
        /** The chart's total, written as its centre writes it. */
        total: string;
        slices: Array<{ label: string; display: string; share: number; other: boolean }>;
      })
    | null;
  categoryHead: PreviewHead;
  categories: Array<{ label: string; display: string; share: number }>;
  stateHead: PreviewHead;
  states: Array<{ code: string; name: string; row: number; col: number; display: string; intensity: number }>;
  /** The dashboard's top insights for this selection, as its insights column lists them. */
  insights: PreviewInsight[];
  insightsTotal: number;
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
  /** What the Detect step reads from the data before any template (engine/understand). */
  understanding: {
    title: string;
    rowMeaning: string;
    /** "Oct 2024 – Sep 2026". */
    dates: string;
    outcome: string | null;
    /** The strongest drivers of the outcome, with their statistic (η, r or V). */
    drivers: Array<{ column: string; symbol: string; value: string; strength: number }>;
  };
  /** Each column with its storage type and how Check & map reads it ("Read as"). */
  columns: Array<{ name: string; type: string; readAs: string }>;
  /** Every state/UT tile of the India tile map, so the outline reads even where there is no data. */
  tiles: Array<{ code: string; name: string; row: number; col: number }>;
  /** Actual size of each demo dataset, generated at build time. */
  samples: Record<string, { rows: string; columns: number }>;
  health: { score: number; grade: string };
  /** Chart types the Customise step's chart builder offers (engine/charts/catalogue.ts). */
  chartTypes: number;
  /** The one-page dashboard the live demo opens on: its title, filter pills and charts. */
  dashboard: {
    title: string;
    subtitle: string;
    /** The industry's icon name (ui/common/domain-icon). */
    icon: string;
    /** The pills after the period, named by the file's own headers. */
    slicers: string[];
    dataTo: string;
    /** The page's four charts, in place order (pagePlan's pickPageCharts). */
    charts: string[];
  };
  states: PreviewState[];
  showcase: {
    kpi: { name: string; definition: string; formula: string; sql: string; dax: string; daxName: string };
    chart: { title: string; reason: string };
    insight: { title: string; body: string; basis: string } | null;
    skipped: number;
    /** A question asked in words, answered by the engine over the last 12 months, with its SQL. */
    question: {
      text: string;
      understood: string;
      answer: string;
      sql: string;
      rows: Array<{ label: string; display: string; share: number }>;
    } | null;
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

/** The statistic each way of measuring a driver reports (engine/understand Driver.method). */
const DRIVER_SYMBOL: Record<string, string> = { correlation: "r", "group-means": "η", association: "V" };

/** The question "How it works" asks: one the Questions step reads as "Net revenue by Category". */
const QUESTION = "Which category has the highest net revenue?";

function kpiTone(meta: KpiMeta, delta: number | null): PreviewKpi["tone"] {
  if (delta === null || !Number.isFinite(delta) || Math.abs(delta) < 1e-9 || meta.direction === "neutral")
    return "neutral";
  const up = delta > 0;
  return (meta.direction === "higher") === up ? "good" : "bad";
}

function toKpis(ctx: ContextResult, batch: ReturnType<Session["kpiBatch"]>, ids: string[]): PreviewKpi[] {
  const values = new Map(batch.values.map((v) => [v.id, v]));
  return ids.flatMap((id) => {
    const v = values.get(id);
    const meta = ctx.kpis.find((k) => k.id === id);
    if (!v || !meta || v.value === null) return [];
    const isPercent = meta.format === "percent";
    const deltaText = isPercent ? formatPointDelta(v.deltaAbs, "IN") : formatDelta(v.delta, "IN");
    const d = isPercent ? v.deltaAbs : v.delta;
    const change = d === null || !Number.isFinite(d) || Math.abs(d) < 1e-9 ? "flat" : d > 0 ? "up" : "down";
    const compact = kpiCompact(meta.format, v.value);
    return [
      {
        id,
        name: kpiLabel(meta),
        format: meta.format,
        value: v.value,
        display: formatValue(v.value, meta.format, { ...LOCALE_OPTS, compact }),
        compact,
        deltaText,
        change,
        tone: kpiTone(meta, d),
        spark: v.spark.map((p) => (p.v !== null && Number.isFinite(p.v) ? p.v : null)),
        partialLast: Boolean(v.partialLast),
        icon: kpiIconName(meta),
      },
    ];
  });
}

function seriesValues(data: ChartData | null | undefined): number[] {
  return (data?.series[0]?.values ?? []).map((v) => (v === null || !Number.isFinite(v) ? 0 : v));
}

const formatOf = (data: ChartData | null | undefined): ValueFormat =>
  (data?.series[0]?.format ?? "currency") as ValueFormat;

const compactOf = (v: number, f: ValueFormat) => formatValue(v, f, { ...LOCALE_OPTS, compact: true });

function headOf(spec: ChartSpec | undefined, data: ChartData | null | undefined): PreviewHead {
  return {
    id: spec?.id ?? "",
    title: spec?.title ?? "",
    takeaway: data && !data.empty ? (data.headline ?? null) : null,
  };
}

/** "Oct 2024 – Sep 2026", as the Detect step gives the span of the dates. */
function monthSpan(from: number, to: number): string {
  const m = (t: number) => `${MONTHS_SHORT[new Date(t).getUTCMonth()]} ${new Date(t).getUTCFullYear()}`;
  return `${m(from)} – ${m(to)}`;
}

let snapshot: LandingData | null = null;

/**
 * Runs the engine on the demo dataset and returns the landing-page snapshot. The demo data is
 * seeded, so the snapshot is the same every time: it is computed once per server process (the dev
 * server would otherwise run three dashboards on every request) and handed out read-only.
 */
export function buildLandingData(): LandingData {
  snapshot ??= computeLandingData();
  return snapshot;
}

function computeLandingData(): LandingData {
  const session = new Session();
  const load = session.ingestSample("ecommerce");
  if (load.status !== "ok") throw new Error("Demo dataset failed to load");
  const top = load.detection.candidates[0];
  if (!top) throw new Error("Demo dataset was not detected");
  const ctx = session.configure({ domainId: top.domainId, numberLocale: "IN", currency: null });
  if (!ctx.dateColumn || !ctx.dateBounds) throw new Error("Demo dataset has no date column");
  const dateColumn = ctx.dateColumn;
  const bounds = ctx.dateBounds;
  const metas = new Map(ctx.kpis.map((k) => [k.id, k]));
  const filtersOf = (preset: DatePreset): Filter[] => {
    const range = presetRange(preset, bounds);
    return range ? [{ kind: "dateRange", column: dateColumn, from: range.from, to: range.to }] : [];
  };

  // What a dashboard refresh computes (the store's refresh): the hero, supporting and column KPIs,
  // and every chart of the default layout. The insights then read these results, as they do live.
  const refreshKpis = [
    ...new Set([...ctx.selection.hero, ...ctx.selection.supporting, ...ctx.selection.columns]),
  ];
  const refreshCharts = ctx.charts.filter((s) => s.modes.includes("analyst")).map((s) => ({ specId: s.id }));
  // The one page's KPI tiles: the headline KPIs, topped up from the supporting ones.
  const pageKpis = pageKpiIds(ctx.selection.hero, ctx.selection.supporting).filter(
    (id) => metas.get(id)?.available,
  );
  const rank = dataLed(ctx) ? planRank(ctx.plan) : undefined;
  const specOf = (id: string) => ctx.charts.find((c) => c.id === id);

  // The page's charts, picked from the first preset's results; the same four for every preset, so
  // switching the range redraws them in place rather than swapping one for another.
  let pageCharts: string[] = [];
  const computed = PREVIEW_PRESETS.map((preset) => {
    const filters = filtersOf(preset);
    const res = session.computeDashboard({
      filters,
      kpiIds: refreshKpis,
      charts: refreshCharts,
      numberLocale: "IN",
    });
    const insights = session.insights("IN");
    if (!pageCharts.length) {
      const widgets = ctx.charts.map((s) => ({ id: s.id }));
      pageCharts = placeCharts(pickPageCharts(widgets, ctx.charts, res.charts, PAGE_CHARTS, rank)).map(
        (c) => c.spec.id,
      );
    }
    return { preset, res, insights };
  });

  // Each of the page's charts in the slot the preview draws it in: the trend over time, the share of
  // the whole, a ranked breakdown and the map. A chart of another kind would leave its slot empty,
  // which tests/landing-data.test.ts catches.
  const pageSpecs = pageCharts.map(specOf).filter((s): s is ChartSpec => Boolean(s));
  const trendSpec = pageSpecs.find((s) => s.x.kind === "time") ?? ctx.charts.find((c) => c.x.kind === "time");
  const mixSpec = pageSpecs.find((s) => s.kind === "donut" || s.kind === "pie");
  const stateSpec = pageSpecs.find((s) => s.kind === "geoTile") ?? specOf("revenue_by_state");
  const categorySpec =
    pageSpecs.find((s) => s !== trendSpec && s !== mixSpec && s !== stateSpec && s.x.kind === "column") ??
    specOf("revenue_by_category");

  const states: PreviewState[] = computed.map(({ preset, res, insights }) => {
    const trend = trendSpec ? res.charts[trendSpec.id] : undefined;
    const mix = mixSpec ? res.charts[mixSpec.id] : undefined;
    const cats = categorySpec ? res.charts[categorySpec.id] : undefined;
    const geo = stateSpec ? res.charts[stateSpec.id] : undefined;

    const trendValues = seriesValues(trend);
    const peak = trendValues.reduce((best, v, i, a) => (v > (a[best] ?? -Infinity) ? i : best), 0);
    const trendFormat = formatOf(trend);

    const catValues = seriesValues(cats);
    const catTotal = catValues.reduce((a, b) => a + b, 0) || 1;

    const mixValues = seriesValues(mix);
    const mixTotal = mixValues.reduce((a, b) => a + b, 0);

    const geoValues = seriesValues(geo);
    const geoMax = Math.max(...geoValues, 1);

    return {
      id: preset,
      label: PRESET_LABEL[preset],
      periodLabel: res.kpis.period?.label ?? "",
      comparisonLabel: res.kpis.comparison?.label ?? "",
      rows: formatValue(res.rows, "integer", LOCALE_OPTS),
      kpis: toKpis(ctx, res.kpis, pageKpis),
      trend: {
        ...headOf(trendSpec, trend),
        labels: (trend?.categories ?? []).map((c) => c.label),
        starts: (trend?.categories ?? []).map((c) => (typeof c.raw === "number" ? c.raw : 0)),
        values: trendValues,
        display: trendValues.map((v) => compactOf(v, trendFormat)),
        peak,
        grain: trend?.grain ?? "month",
        partialFirst: Boolean(trend?.partialFirst),
        partialLast: Boolean(trend?.partialLast),
      },
      mix:
        mix && !mix.empty && mixTotal > 0
          ? {
              ...headOf(mixSpec, mix),
              total: formatValue(mix.totals[0] ?? mixTotal, formatOf(mix), {
                ...LOCALE_OPTS,
                compact: false,
              }),
              slices: (mix.categories ?? []).map((c, i) => ({
                label: c.label,
                display: compactOf(mixValues[i] ?? 0, formatOf(mix)),
                share: (mixValues[i] ?? 0) / mixTotal,
                other: c.label === "Others",
              })),
            }
          : null,
      categoryHead: headOf(categorySpec, cats),
      categories: (cats?.categories ?? []).slice(0, 6).map((c, i) => ({
        label: c.label,
        display: compactOf(catValues[i] ?? 0, formatOf(cats)),
        share: (catValues[i] ?? 0) / catTotal,
      })),
      stateHead: headOf(stateSpec, geo),
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
            display: compactOf(value, formatOf(geo)),
            intensity: value / geoMax,
          },
        ];
      }),
      insights: insights.slice(0, 3).map((i) => ({
        title: i.title,
        body: i.body,
        tone: i.tone,
        kind: i.kind,
        impact: i.impact,
        confidence: i.confidence,
      })),
      insightsTotal: insights.length,
    };
  });

  // Showcase artefacts for the feature section: one auditable KPI, one chart rationale, one insight.
  const showcaseKpi =
    ctx.kpis.find((k) => k.id === "rto_rate" && k.available) ??
    ctx.kpis.find((k) => k.available && k.sql && k.dax);
  if (!showcaseKpi?.sql || !showcaseKpi.dax) throw new Error("No KPI with SQL and DAX to showcase");
  const showcaseChart = categorySpec ?? ctx.charts[0];
  const filters12 = filtersOf("last12m");
  session.kpiBatch(filters12, [...ctx.selection.hero, ...ctx.selection.supporting], "IN");
  const insight = session.insights("IN").find((i) => i.kind !== "caveat") ?? null;

  // A question in words, read and answered as the Questions step does, over the dashboard's period.
  const reading = readQuestion(QUESTION, ctx as AskContext);
  const answer = reading.ask.measures.length
    ? session.answerQuestion(
        {
          id: "landing",
          question: QUESTION,
          understood: reading.understood,
          notes: reading.notes,
          ask: reading.ask,
          order: reading.order,
          filters: filters12,
        },
        "IN",
      )
    : null;
  const answerFormat = (answer?.measures[0]?.format ?? "currency") as ValueFormat;
  const answerTotal = (answer?.rows ?? []).reduce((a, r) => a + (r.values[0] ?? 0), 0) || 1;

  const understanding = ctx.understanding;
  const shape = ctx.domain.subDomains.find((x) => x.id === ctx.subDomainId)?.name ?? null;
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
    understanding: {
      title: understanding?.title ?? top.name,
      rowMeaning: understanding?.subject.rowMeaning ?? `One row per ${top.grain}`,
      dates: monthSpan(bounds.min, bounds.max),
      outcome: understanding?.outcome?.column ?? null,
      drivers: (understanding?.drivers ?? []).slice(0, 3).map((d) => ({
        column: d.column,
        symbol: DRIVER_SYMBOL[d.method] ?? "r",
        value: d.value.toFixed(2),
        strength: Math.min(1, Math.abs(d.strength)),
      })),
    },
    columns: load.profile.columns.map((c) => {
      const kind = understanding?.columns.find((u) => u.name === c.name)?.kind;
      return {
        name: c.name,
        type: STORAGE_LABEL[c.storage] ?? c.storage,
        readAs: kind ? KIND_LABEL[kind] : (STORAGE_LABEL[c.storage] ?? c.storage),
      };
    }),
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
    chartTypes: CHART_TYPES.filter((t) => t.buildable).length,
    dashboard: {
      title: defaultPageTitle(ctx.domain.name, {
        generic: ctx.domain.generic,
        roster: false,
        weak: ctx.fit.weak,
        understood: understanding?.title,
      }),
      subtitle: pageSubtitle(
        pageKpis.map((id) => metas.get(id)?.group ?? ""),
        shape ?? ctx.domain.name,
      ),
      icon: ctx.domain.icon,
      slicers: ctx.dimensions.slice(0, 4).map((d) => friendly(d.column)),
      dataTo: formatDay(bounds.max),
      charts: pageCharts,
    },
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
      question:
        answer && !answer.error && answer.sql
          ? {
              text: QUESTION,
              understood: answer.understood,
              answer: answer.headline,
              sql: answer.sql,
              rows: answer.rows.slice(0, 4).map((r) => ({
                label: r.label,
                display: compactOf(r.values[0] ?? 0, answerFormat),
                share: (r.values[0] ?? 0) / answerTotal,
              })),
            }
          : null,
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
