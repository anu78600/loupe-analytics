/**
 * The dashboard's plan (version 49.0): every chart and KPI of a configured
 * view, ranked by how much it tells, each with a one-sentence why. The
 * session returns the charts in this order (ContextResult.charts), so the
 * store lays the widgets out by it, and the one page leads with the
 * highest-scored chart when no industry fits strongly.
 *
 * Score = informativeness × relevance × confidence, each from 0 to 1:
 * - informativeness: what the chart shows, times how directly its form
 *   shows it. The outcome against other columns scores 0.5 + 0.5 × the
 *   strongest of their driver strengths (|r|, η or V, understand/drivers.ts;
 *   0 for a column that doesn't move it); the outcome on its own (its
 *   distribution, mix or trend) 0.7; anything else by its section: trend
 *   0.65, breakdown 0.6, drivers 0.55, the other columns 0.5, detail 0.35.
 *   The form: a table (or the detail section) × 0.5, a heatmap × 0.75,
 *   anything else × 1.
 * - relevance: 1 when the chart reads the outcome, 0.8 when it reads a
 *   driver (strength 0.1 or more), else 0.6; 1 for every chart when the
 *   table has no outcome.
 * - confidence: 1 for the charts built from the data (the generic
 *   dashboard, the charts of the other columns, "What moves …"); for a
 *   template's charts, the industry's detection confidence, × 0.6 when it
 *   fits the file weakly.
 * Diversity: walking down the scores, a chart comparing the same columns as
 * a higher one (whichever is on the axis: Fare by survival and survival by
 * Fare band) is halved, so two views of one comparison never lead together.
 *
 * When an industry fits strongly its template leads in its own order (its
 * authors ranked the charts by what the industry reads first; the demos
 * must not change): the recommended order is kept (the charts of the other
 * columns and "What moves …" in their sections, after the template's), and
 * the chart at position i of n scores confidence × (1 − i ÷ (n + 1)). KPIs
 * keep the selection's order (heroes first) and are scored with the formula
 * above, the tier standing for informativeness (hero 1, supporting 0.8,
 * other columns 0.6).
 */
import type { ChartSpec, ResolvedAxis } from "@/engine/charts/types";
import { friendly } from "@/engine/core/labels";
import type { Mapping } from "@/engine/detect/mapping";
import type { KpiResolutionMap, KpiSelection } from "@/engine/kpi/resolve";
import { fieldsOf } from "@/engine/query/expr";
import type { DataUnderstanding, Driver, PlannedAnalysis } from "./types";
import { MIN_STRENGTH } from "./drivers";

/** What planDashboard reads: the view's charts as recommended, its KPIs and the understanding. */
export interface PlanInput {
  /** The view's charts, in their recommended order (section, then priority). */
  charts: readonly ChartSpec[];
  selection: KpiSelection;
  /** The view's KPI resolutions, for the columns each KPI reads. */
  res: KpiResolutionMap;
  /** Field id → column, for the template's charts and KPIs. */
  mapping: Mapping;
  understanding: DataUnderstanding;
  /** True when the chosen industry fits strongly: its template leads in its own order. */
  industryLeads: boolean;
  /** The industry's detection confidence, 0–1; 1 for the generic dashboard. */
  confidence: number;
  /** True for the charts and KPIs built from the data rather than the industry's template. */
  fromData: (id: string) => boolean;
  /** Display name of a KPI (after the user's renames). */
  kpiName: (id: string) => string;
}

/** Informativeness of a chart that doesn't show the outcome, by its section. */
const SECTION_INFO: Record<ChartSpec["section"], number> = {
  trend: 0.65,
  breakdown: 0.6,
  drivers: 0.55,
  columns: 0.5,
  detail: 0.35,
};
/** Informativeness of the outcome on its own: its distribution, its mix of classes, its trend. */
const OUTCOME_ALONE = 0.7;
/**
 * How directly a chart's form shows its comparison: a table is for looking
 * values up, a heatmap spreads one comparison over two axes; bars, lines,
 * scatters and the rest show it at a glance.
 */
function formOf(spec: ChartSpec): number {
  if (spec.section === "detail" || spec.kind === "table") return 0.5;
  if (spec.kind === "heatmap") return 0.75;
  return 1;
}
const TIER_INFO = { hero: 1, supporting: 0.8, columns: 0.6 } as const;
/** A template's charts and KPIs count for this much less when the industry fits weakly. */
const WEAK_FIT_FACTOR = 0.6;

const round3 = (v: number) => Math.round(v * 1000) / 1000;
/** The first sentence of a text. */
const firstSentence = (s: string) => /^.*?[.!?](?=\s|$)/.exec(s.trim())?.[0] ?? s.trim();

/** The columns a field reference reads ("col:<name>" or a mapped field id). */
function columnOf(ref: string, mapping: Mapping): string | undefined {
  return ref.startsWith("col:") ? ref.slice(4) : mapping.fields[ref];
}

/** The columns a chart's axis reads. */
function axisColumns(a: ResolvedAxis | undefined, mapping: Mapping): string[] {
  if (!a) return [];
  if (a.kind === "time" || a.kind === "column" || a.kind === "part") return [a.column];
  if (a.kind === "bins") return [...fieldsOf(a.expr)].flatMap((f) => columnOf(f, mapping) ?? []);
  return [];
}

/** The columns a KPI reads (its own fields and the ones its refs read). */
function kpiColumns(id: string, input: PlanInput): string[] {
  const r = input.res.get(id);
  if (r) return r.fieldsUsed.flatMap((f) => columnOf(f, input.mapping) ?? []);
  // An ad-hoc measure: "agg:<agg>:<column>".
  const m = /^agg:\w+:(.*)$/.exec(id);
  return m?.[1] ? [m[1]] : [];
}

/** A statistic as analysts write it: "r = 0.44", "η = 0.41", "V = 0.32". */
function statOf(d: Driver): string {
  if (d.method === "correlation") return `r = ${d.value.toFixed(2).replace("-", "−")}`;
  return `${d.method === "association" ? "V" : "η"} = ${d.value.toFixed(2)}`;
}

/** The view's charts in plan order, and the plan: every chart and KPI with its score and why. */
export function planDashboard(input: PlanInput): { charts: ChartSpec[]; plan: PlannedAnalysis[] } {
  const u = input.understanding;
  const outcome = u.outcome?.column ?? null;
  const drivers = new Map(u.drivers.filter((d) => d.strength >= MIN_STRENGTH).map((d) => [d.column, d]));
  const relevance = (columns: readonly string[]) =>
    !outcome ? 1 : columns.includes(outcome) ? 1 : columns.some((c) => drivers.has(c)) ? 0.8 : 0.6;
  const confidenceOf = (id: string) =>
    input.fromData(id) ? 1 : input.confidence * (input.industryLeads ? 1 : WEAK_FIT_FACTOR);

  const scored = input.charts.map((spec, index) => {
    const axes = [...axisColumns(spec.x, input.mapping), ...axisColumns(spec.series, input.mapping)];
    const measured = spec.measures.flatMap((m) => kpiColumns(m.id, input));
    const columns = [...new Set([...axes, ...measured])];
    const withOutcome = outcome !== null && columns.includes(outcome);
    // What the chart sets against the outcome: its other columns, a time axis aside (a trend of the
    // outcome is the outcome on its own).
    const time = spec.x.kind === "time" || spec.x.kind === "part" ? spec.x.column : null;
    const others = columns.filter((c) => c !== outcome && c !== time);
    const driver = others
      .map((c) => drivers.get(c))
      .filter((d): d is Driver => d !== undefined)
      .sort((a, b) => b.strength - a.strength)[0];
    const info =
      (withOutcome
        ? others.length
          ? 0.5 + 0.5 * (driver?.strength ?? 0)
          : OUTCOME_ALONE
        : SECTION_INFO[spec.section]) * formOf(spec);
    const why =
      withOutcome && driver
        ? driver.sentence
        : withOutcome && outcome
          ? `It shows ${friendly(outcome)}, what the table is measured by. ${firstSentence(spec.reason)}`
          : firstSentence(spec.reason);
    return {
      spec,
      index,
      score: info * relevance(columns) * confidenceOf(spec.id),
      // The columns it compares, in any order: two views of one comparison share it.
      pair: [...columns].sort().join("|"),
      why,
    };
  });

  let ordered: typeof scored;
  if (input.industryLeads) {
    // The template's own order is its ranking, and the charts of the other columns and "What moves …"
    // keep their recommended places after its sections' charts: the demos read as they always have.
    const n = scored.length;
    scored.forEach((s, i) => (s.score = input.confidence * (1 - i / (n + 1))));
    ordered = scored;
  } else {
    ordered = [...scored].sort((a, b) => b.score - a.score || a.index - b.index);
    const seen = new Set<string>();
    for (const s of ordered) {
      if (seen.has(s.pair)) s.score *= 0.5;
      seen.add(s.pair);
    }
    ordered.sort((a, b) => b.score - a.score || a.index - b.index);
  }

  const chartPlan: PlannedAnalysis[] = ordered.map((s) => ({
    id: s.spec.id,
    type: "chart",
    source: input.fromData(s.spec.id) ? "data" : "industry",
    score: round3(s.score),
    why: s.why,
  }));

  const tiers: Array<[keyof typeof TIER_INFO, readonly string[]]> = [
    ["hero", input.selection.hero],
    ["supporting", input.selection.supporting],
    ["columns", input.selection.columns],
  ];
  const kpiPlan: PlannedAnalysis[] = tiers.flatMap(([tier, ids]) =>
    ids.map((id): PlannedAnalysis => {
      const columns = kpiColumns(id, input);
      const name = input.kpiName(id);
      const driver = columns.map((c) => drivers.get(c)).find((d) => d !== undefined);
      const why =
        outcome && columns.includes(outcome)
          ? `${name} reads ${friendly(outcome)}, what the table is measured by.`
          : driver
            ? `${name} reads ${friendly(driver.column)}, which moves with ${friendly(outcome ?? "")} (${statOf(driver)}).`
            : firstSentence(input.res.get(id)?.def.definition ?? name);
      return {
        id,
        type: "kpi",
        source: input.fromData(id) ? "data" : "industry",
        score: round3(TIER_INFO[tier] * relevance(columns) * confidenceOf(id)),
        why,
      };
    }),
  );
  return { charts: ordered.map((s) => s.spec), plan: [...chartPlan, ...kpiPlan] };
}
