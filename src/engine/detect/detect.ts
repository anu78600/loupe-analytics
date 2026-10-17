/**
 * Explainable domain detection: name + value + structure scoring per domain
 * and sub-domain, with evidence. No black box: every point of confidence
 * traces back to matched columns, and every deduction names the columns a
 * rival industry explains instead (DomainCandidate.contrast).
 *
 * 1. Fit, per domain on its own. Fields are assigned to columns (match.ts); a
 *    sub-domain's coverage is the weight-averaged match score of its signal
 *    fields (0 when unmatched). Fit is the better of completeness = 0.75 ×
 *    best coverage + 0.25 × breadth (12 weighted points of assigned fields =
 *    full) and abundance = 0.5 × best coverage + 0.5 × vocabulary (20
 *    weighted points of step-2 evidence over all columns = full), minus small
 *    penalties for a missing date or measure, plus up to 0.06 for
 *    value-based matches.
 * 2. Distinctiveness, per column across all domains. A column's evidence for
 *    a domain is its best field match, weight × score, whether or not the
 *    one-to-one mapping kept that field (a second customer column is still
 *    vocabulary the domain knows), halved (GENERIC_EVIDENCE) when only a
 *    generic word such as "name" or "date" matched. A column that many
 *    domains can explain ("Order Date", "Status") says little about which
 *    one fits; one that few can explain (an AWB number, a coupon code) says a
 *    lot. Distinctiveness = 2 / (1 + number of domains with a field, or a
 *    KPI name, matching it).
 * 3. Contrast, per pair of domains. Against each rival, the share of the two
 *    domains' combined distinctive evidence that the rival explains better
 *    (column by column, so a field that is core to the rival but peripheral
 *    here counts too). The worst rival's share, scaled by that rival's fit
 *    and CONTRAST_WEIGHT, is deducted. A domain that explains only a generic
 *    subset of what a rival explains (logistics on a D2C order export, the
 *    e-commerce ad sub-domain on a Google Ads report) loses heavily; two
 *    domains that each explain distinctive columns the other cannot (a
 *    supply-chain export with both product and shipping data) both lose, so
 *    they stay close and the user is asked.
 *
 * KPI names count too. The tables analysts build carry an industry's
 * vocabulary in its KPI names rather than in field names: a summary's columns
 * are KPIs ("AUM (₹ Cr)", "GNPA %", "Collection Efficiency %") and a tall
 * scorecard names a metric on each row ("ARPU", "Occupancy %"). A measure
 * column's header, or a metric name of profile.tall, that matches a KPI's
 * name, short name or alias (nameSimilarity at least KPI_NAME_THRESHOLD, one
 * KPI per name and one name per KPI) adds KPI_WEIGHT × similarity to the
 * KPI's domain, exactly where a matched field's weight × score goes: the
 * column's evidence in step 1's vocabulary and in steps 2 and 3. It only
 * counts for a name none of the domain's fields match, so a transaction
 * table, whose columns the fields already explain, scores as before. It is
 * listed after the field evidence, as "<KPI> (KPI) ← <column>", or "←
 * Metric: ARPU" for a scorecard's metric name. A tall scorecard's value
 * columns named only with layout words ("Value", "Target", "YTD Actual") are
 * left out of field matching altogether (match.ts matchableColumns): they
 * hold every metric's figures, so their names say how the sheet is laid out,
 * not which industry it serves.
 *
 * Confidence = (fit − deduction) × 100, capped at 99. The guided manual flow
 * opens below CONFIDENCE_THRESHOLD or when the top two domains are within
 * AMBIGUITY_GAP points.
 *
 * The data shape (sub-domain) is chosen apart from the fit (pickShape): a
 * shape counts only when a field of its own matched, one no sibling shape
 * lists (an order ID alone does not make a returns file), and a file with an
 * event date of a transaction shape (an order date) is read as that
 * transaction table rather than as a roster of the things it mentions (a
 * sale-orders export is not a product catalogue).
 */
import type { DatasetProfile } from "@/engine/profile/types";
import { grainLabel } from "@/engine/profile/structure";
import { kpiLabel } from "@/engine/core/labels";
import type { DomainDef, SubDomainDef } from "@/registry/schema";
import {
  assignCandidates,
  matchableColumns,
  matchCandidates,
  matchKpiNames,
  namesToRead,
  type FieldAssignment,
  type KpiNameMatch,
  type NameToRead,
} from "./match";

/**
 * One reason a domain fits: a column matched to one of its fields, or a
 * column header or scorecard metric name matched to one of its KPIs. KPI
 * evidence has a `kpi:` field id and a "(KPI)" label, and comes after the
 * field evidence.
 */
export interface Evidence {
  fieldId: string;
  fieldLabel: string;
  /** The column, or "<metric column>: <metric>" for a scorecard's metric name. */
  column: string;
  score: number;
  via: FieldAssignment["via"];
  weight: number;
}

export interface SubDomainScore {
  id: string;
  name: string;
  /** Weight-averaged match score of the sub-domain's signal fields, 0–1. */
  coverage: number;
}

/** The deduction from step 3: which rival explains which distinctive columns this domain does not. */
export interface ContrastPenalty {
  /** Confidence points deducted (0 when no rival explains anything this domain cannot). */
  points: number;
  /** Rival domain id behind the deduction, or null. */
  rival: string | null;
  /** Columns the rival explains better, largest distinctiveness-weighted gap first (up to 6). */
  columns: string[];
}

export interface DomainCandidate {
  domainId: string;
  name: string;
  /** 0–99 (never 100). */
  confidence: number;
  /** Best-covered sub-domain; `subDomains` lists them all, best first. */
  subDomain: SubDomainScore;
  subDomains: SubDomainScore[];
  /** Matched fields, strongest (weight × score) first. */
  evidence: Evidence[];
  /** Signal fields of the best sub-domain that no column matched. */
  missingSignals: Array<{ fieldId: string; label: string }>;
  assignments: FieldAssignment[];
  /** What one row represents, from the best sub-domain ("row" when unknown). */
  grain: string;
  /** Points lost to a rival that explains distinctive columns this domain cannot. */
  contrast: ContrastPenalty;
}

export interface DetectionResult {
  candidates: DomainCandidate[];
  /** True when the guided manual flow should open automatically. */
  needsConfirmation: boolean;
  reason: string;
  structural: string[];
  /**
   * The data shape detection picks for every domain, not only the top
   * candidates: what "Auto (best match)" means when the user chooses another
   * industry.
   */
  shapes: Record<string, string>;
}

/** Below this confidence (%) the user is asked to confirm the domain. */
export const CONFIDENCE_THRESHOLD = 70;
/** When the top two domains are closer than this many points, the user chooses. */
export const AMBIGUITY_GAP = 10;
/**
 * Fraction of the rival-weighted contrast share deducted from a domain's fit:
 * a domain whose every distinctive column a fully fitting rival explains
 * better loses 40 points.
 */
export const CONTRAST_WEIGHT = 0.4;
/**
 * Share of a column's evidence kept when a domain matched it only through a
 * generic word ("Name" via "name", "Date" via "date"): such a match says the
 * column is an ordinary business column, not which industry the file is from.
 */
export const GENERIC_EVIDENCE = 0.5;

/**
 * A transaction shape whose own event date matched (an order date, a booking
 * date) is preferred to a roster shape without a matched date of its own,
 * unless the roster covers this many times more of its signals: an order-line
 * export always repeats product columns, so it reads as a product catalogue on
 * coverage alone.
 */
export const EVENT_SHAPE_PREFERENCE = 0.5;

/**
 * Weight of a KPI-name match, as for a core field: a column named after a
 * KPI ("GNPA %", "RevPAR") says as much about the industry as a column
 * matched to one of its main fields.
 */
export const KPI_WEIGHT = 2.5;

/** Step 1 of the score: one domain against the profile, without looking at the other domains. */
interface DomainFit {
  domain: DomainDef;
  assignments: FieldAssignment[];
  /** Headers and metric names matched to the domain's KPIs (match.ts matchKpiNames). */
  kpiMatches: KpiNameMatch[];
  /** The evidence keys the KPI matches explain, those none of the domain's fields match. */
  kpiKeys: Set<string>;
  /** Every sub-domain, the chosen one first (see pickShape). */
  subs: SubDomainScore[];
  best: SubDomainScore;
  sub: SubDomainDef | undefined;
  /** 0–1 before the contrast deduction. */
  fit: number;
  /**
   * Column → best field weight × match score over all of the domain's fields
   * (not only the assigned one); for a column no field matches, KPI_WEIGHT ×
   * similarity of a KPI-name match. A scorecard's metric name has a key of its own.
   */
  evidence: Map<string, number>;
}

/** One sub-domain as pickShape weighs it. */
interface ShapeEvidence {
  score: SubDomainScore;
  /** A signal no sibling sub-domain lists matched (or the shape has no such signal to look for). */
  ownField: boolean;
  /** One of the shape's date signals matched. */
  dated: boolean;
  roster: boolean;
}

/** Signals of `sub` that no other sub-domain of `domain` lists. */
function ownSignals(domain: DomainDef, sub: SubDomainDef): string[] {
  const elsewhere = new Set(domain.subDomains.filter((s) => s !== sub).flatMap((s) => s.signals));
  return sub.signals.filter((f) => !elsewhere.has(f));
}

/**
 * Chooses the data shape and orders the rest after it. Only shapes with one of
 * their own fields matched are considered (all of them when none has one);
 * among those the best coverage wins, except that a roster shape without a
 * matched date of its own gives way to a transaction shape whose date matched,
 * when that one covers at least EVENT_SHAPE_PREFERENCE of the roster's
 * coverage. Returns the shapes in that order and the best coverage among the
 * considered shapes, which is what the domain's fit is built from.
 */
function pickShape(shapes: readonly ShapeEvidence[]): { order: SubDomainScore[]; coverage: number } {
  const byCoverage = [...shapes].sort((a, b) => b.score.coverage - a.score.coverage);
  const pool = byCoverage.some((s) => s.ownField) ? byCoverage.filter((s) => s.ownField) : byCoverage;
  let chosen = pool[0] as ShapeEvidence;
  if (chosen.roster && !chosen.dated) {
    const event = pool.find(
      (s) => !s.roster && s.dated && s.score.coverage >= EVENT_SHAPE_PREFERENCE * chosen.score.coverage,
    );
    if (event) chosen = event;
  }
  const rest = [...pool, ...byCoverage.filter((s) => !pool.includes(s))].filter((s) => s !== chosen);
  return { order: [chosen, ...rest].map((s) => s.score), coverage: pool[0]?.score.coverage ?? 0 };
}

function fitDomain(domain: DomainDef, profile: DatasetProfile, names: readonly NameToRead[]): DomainFit {
  // A tall scorecard's value columns are its layout, not the industry's vocabulary (matchableColumns).
  const candidates = matchCandidates(domain, matchableColumns(profile));
  const assignments = assignCandidates(candidates);
  const kpiMatches = matchKpiNames(domain, names);
  const byField = new Map(assignments.map((a) => [a.fieldId, a]));
  const weightOf = new Map(domain.fields.map((f) => [f.id, f.weight]));
  const dateFields = new Set(domain.fields.filter((f) => f.roles.includes("datetime")).map((f) => f.id));

  const shapes: ShapeEvidence[] = domain.subDomains.map((s) => {
    let got = 0;
    let total = 0;
    for (const f of s.signals) {
      const w = weightOf.get(f) ?? 1;
      total += w;
      const a = byField.get(f);
      if (a) got += w * a.score;
    }
    const own = ownSignals(domain, s);
    return {
      score: { id: s.id, name: s.name, coverage: total ? got / total : 0 },
      ownField: own.length === 0 || own.some((f) => byField.has(f)),
      dated: s.signals.some((f) => dateFields.has(f) && byField.has(f)),
      roster: s.timeModel === "roster",
    };
  });
  const picked = pickShape(shapes);
  const subs = picked.order;
  const best = subs[0] as SubDomainScore;

  // Column → best field weight × score over all fields, not only the assigned one; a match made only
  // through a generic word ("Name" via "name") counts at GENERIC_EVIDENCE.
  const evidence = new Map<string, number>();
  for (const c of candidates) {
    const v = c.weight * c.score * (c.generic ? GENERIC_EVIDENCE : 1);
    evidence.set(c.column, Math.max(evidence.get(c.column) ?? 0, v));
  }
  // A header or metric named after one of the domain's KPIs is its vocabulary too, weighted like a
  // core field. A column one of the domain's fields already explains keeps that field's evidence: in a
  // transaction table the fields say what the columns are, and a KPI name only adds where they can't.
  const kpiKeys = new Set<string>();
  for (const m of kpiMatches) {
    if (evidence.has(m.key)) continue;
    evidence.set(m.key, KPI_WEIGHT * m.score);
    kpiKeys.add(m.key);
  }

  // Two views of how well the domain fits, and the better one counts. Completeness: the best
  // coverage among the shapes that count (pickShape), plus breadth over the assigned fields (12
  // weighted points = full). Abundance: a file carrying a lot of the domain's vocabulary (20
  // weighted points over all of its columns) fits even when its table shape covers only part of a
  // sub-domain (a loan book without loan IDs, an admissions list without encounter IDs); a narrow
  // event log has little of either. The shape preference does not lower the fit: it decides how
  // the file is read, not whether the industry fits.
  const matchedWeight = assignments.reduce((s, a) => s + (weightOf.get(a.fieldId) ?? 1) * a.score, 0);
  const vocabularyWeight = [...evidence.values()].reduce((s, v) => s + v, 0);
  const completeness = 0.75 * picked.coverage + 0.25 * Math.min(1, matchedWeight / 12);
  const abundance = 0.5 * picked.coverage + 0.5 * Math.min(1, vocabularyWeight / 20);
  let fit = Math.max(completeness, abundance);

  // Structural sanity: transactional sub-domains need a time axis and a measure.
  const hasDate = profile.columns.some((c) => c.role === "datetime");
  const hasMeasure = profile.columns.some((c) => ["measure", "currency"].includes(c.role));
  const sub = domain.subDomains.find((s) => s.id === best.id);
  const needsTime = sub
    ? sub.signals.some((f) => domain.fields.find((d) => d.id === f)?.roles.includes("datetime"))
    : false;
  if (needsTime && !hasDate) fit -= 0.06;
  if (!hasMeasure) fit -= 0.04;
  // Value-level evidence (e.g. COD/RTO statuses) is a strong, domain-specific signal.
  const valueHits = assignments.filter((a) => a.via !== "name").length;
  fit += Math.min(0.06, valueHits * 0.03);

  return { domain, assignments, kpiMatches, kpiKeys, subs, best, sub, fit, evidence };
}

/** Step 2: 2 / (1 + number of domains whose fields matched the column), for every matched column. */
function distinctiveness(fits: readonly DomainFit[]): Map<string, number> {
  const claims = new Map<string, number>();
  for (const f of fits)
    for (const column of f.evidence.keys()) claims.set(column, (claims.get(column) ?? 0) + 1);
  return new Map([...claims].map(([column, k]) => [column, 2 / (1 + k)]));
}

/**
 * Step 3 for one pair: the share of the pair's distinctive evidence (each
 * column counted at the better of the two) that `rival` explains and `own`
 * does not, plus the columns behind it, largest gap first.
 */
function contrastShare(
  own: DomainFit,
  rival: DomainFit,
  spec: ReadonlyMap<string, number>,
): { share: number; columns: string[] } {
  let lost = 0;
  let total = 0;
  const losses: Array<[string, number]> = [];
  for (const column of new Set([...own.evidence.keys(), ...rival.evidence.keys()])) {
    const w = spec.get(column) ?? 0;
    const mine = own.evidence.get(column) ?? 0;
    const theirs = rival.evidence.get(column) ?? 0;
    total += w * Math.max(mine, theirs);
    if (theirs > mine) {
      lost += w * (theirs - mine);
      losses.push([column, w * (theirs - mine)]);
    }
  }
  losses.sort((a, b) => b[1] - a[1]);
  return { share: total ? lost / total : 0, columns: losses.map(([c]) => c) };
}

function candidate(f: DomainFit, contrast: ContrastPenalty): DomainCandidate {
  const { domain, assignments, best, sub } = f;
  const labelOf = new Map(domain.fields.map((x) => [x.id, x.label]));
  const weightOf = new Map(domain.fields.map((x) => [x.id, x.weight]));
  const byField = new Set(assignments.map((a) => a.fieldId));
  const kpiOf = new Map(domain.kpis.map((k) => [k.id, k]));
  // Capped at 99: a detection is never presented as certain.
  const confidence = Math.max(0, Math.min(99, Math.round(f.fit * 100 - contrast.points)));
  const fields: Evidence[] = assignments
    .map((a) => ({
      fieldId: a.fieldId,
      fieldLabel: labelOf.get(a.fieldId) ?? a.fieldId,
      column: a.column,
      score: a.score,
      via: a.via,
      weight: weightOf.get(a.fieldId) ?? 1,
    }))
    .sort((x, y) => y.weight * y.score - x.weight * x.score);
  // KPI names follow the fields, as counted in fitDomain: only names no field of the domain explains.
  // A metric name is a cell value of the metric column, so it is evidence from the values.
  const kpis: Evidence[] = f.kpiMatches
    .filter((m) => f.kpiKeys.has(m.key))
    .map((m) => {
      const k = kpiOf.get(m.kpiId);
      return {
        fieldId: `kpi:${m.kpiId}`,
        fieldLabel: `${k ? kpiLabel(k) : m.kpiId} (KPI)`,
        column: m.key,
        score: m.score,
        via: m.metric ? ("values" as const) : ("name" as const),
        weight: KPI_WEIGHT,
      };
    });
  const evidence = [...fields, ...kpis];
  const missingSignals = (sub?.signals ?? [])
    .filter((id) => !byField.has(id))
    .map((id) => ({ fieldId: id, label: labelOf.get(id) ?? id }));
  return {
    domainId: domain.id,
    name: domain.name,
    confidence,
    subDomain: best,
    subDomains: f.subs,
    evidence,
    missingSignals,
    assignments,
    grain: sub?.grain ?? "row",
    contrast,
  };
}

/** Scores every domain; returns the top three candidates, whether the user must confirm, and why. */
export function detectDomain(domains: readonly DomainDef[], profile: DatasetProfile): DetectionResult {
  const names = namesToRead(profile);
  const fits = domains.map((d) => fitDomain(d, profile, names));
  const spec = distinctiveness(fits);
  const candidates = fits
    .map((own) => {
      let worst: ContrastPenalty = { points: 0, rival: null, columns: [] };
      for (const rival of fits) {
        if (rival === own || rival.fit <= 0) continue;
        const { share, columns } = contrastShare(own, rival, spec);
        const points = 100 * CONTRAST_WEIGHT * share * Math.min(1, rival.fit);
        if (points > worst.points) worst = { points, rival: rival.domain.id, columns: columns.slice(0, 6) };
      }
      return candidate(own, { ...worst, points: Math.round(worst.points) });
    })
    .sort((a, b) => b.confidence - a.confidence);
  const top = candidates[0];
  const second = candidates[1];
  // The grain as the file shows it (no template's assumption here), worded so that a key which only
  // numbers the rows does not read "One row per row".
  const structural: string[] = [grainLabel(profile.grain)];
  if (profile.primaryDate) structural.push(`Time axis: ${profile.primaryDate}`);
  const measures = profile.columns.filter((c) => ["measure", "currency"].includes(c.role)).length;
  const dims = profile.columns.filter((c) => ["dimension", "geo"].includes(c.role)).length;
  structural.push(
    `${measures} measure${measures === 1 ? "" : "s"}, ${dims} dimension${dims === 1 ? "" : "s"}`,
  );

  let needsConfirmation = false;
  let reason = "";
  if (!top || top.confidence < CONFIDENCE_THRESHOLD) {
    needsConfirmation = true;
    reason = top
      ? `Best match is ${top.name} at ${top.confidence}%, below the ${CONFIDENCE_THRESHOLD}% bar, so please confirm.`
      : "No industry matched.";
  } else if (second && top.confidence - second.confidence < AMBIGUITY_GAP) {
    needsConfirmation = true;
    reason = `${top.name} (${top.confidence}%) and ${second.name} (${second.confidence}%) are within ${AMBIGUITY_GAP} points, so please choose.`;
  } else {
    const fields = top.evidence.filter((e) => !e.fieldId.startsWith("kpi:")).length;
    const kpis = top.evidence.length - fields;
    reason = `${top.name} matched ${fields} column${fields === 1 ? "" : "s"}${kpis ? ` and ${kpis} KPI name${kpis === 1 ? "" : "s"}` : ""} with ${top.confidence}% confidence.`;
  }
  const shapes = Object.fromEntries(candidates.map((c) => [c.domainId, c.subDomain.id]));
  return { candidates: candidates.slice(0, 3), needsConfirmation, reason, structural, shapes };
}
