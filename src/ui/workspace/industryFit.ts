/**
 * How well the chosen industry fits the file, in the words the workspace
 * uses for it, at two moments. On Detect, before anything is built,
 * detection's score says it: an industry scored under LOW_FIT gets an inline
 * warning saying how many of the columns it explains (DetectStep). On the
 * dashboard, the built analysis says it (ContextResult.fit, from
 * Session.configure): the fit notice names how many columns the industry
 * maps (FitNotice). Plain functions, so the logic and the words are tested
 * without the components (tests/industry-fit.test.ts).
 */
import type { DetectionResult } from "@/engine/detect/detect";
import { formatCount, type NumberLocale } from "@/engine/core/format";
import { countOf } from "@/ui/common/words";

/**
 * Detection score (%) under which a chosen industry is warned about: below it detection picks the
 * general dashboard itself (the workspace store's detectedChoice), so the user is choosing against it.
 */
export const LOW_FIT = 35;

/** How poorly a chosen industry fits the file, as far as detection knows; see lowFitOf. */
export interface LowFit {
  /** The industry's score, or (when it is not a top match) the lowest top match's: its score is at most this. */
  score: number;
  /** True when the industry is not among the top matches, so `score` is an upper bound. */
  atMost: boolean;
  /** How many of the file's columns its fields matched; null when unknown (not a top match). */
  explained: number | null;
}

/**
 * Whether the industry chosen on Detect fits the file poorly: scored under LOW_FIT by detection.
 * A top match brings its score and the columns its fields matched (detection's evidence, KPI names
 * read from a header included). Detection lists only the top three, best first, so an industry
 * outside them scores no more than the last one listed: under LOW_FIT when that one is. Null when
 * it may fit, and for the general dashboard.
 */
export function lowFitOf(
  detection: Pick<DetectionResult, "candidates">,
  domainId: string,
  columns: readonly string[],
): LowFit | null {
  if (domainId === "generic") return null;
  const ranked = detection.candidates.find((c) => c.domainId === domainId);
  if (ranked) {
    if (ranked.confidence >= LOW_FIT) return null;
    const names = new Set(columns);
    const explained = new Set(ranked.evidence.map((e) => e.column).filter((c) => names.has(c))).size;
    return { score: ranked.confidence, atMost: false, explained };
  }
  const last = detection.candidates.at(-1);
  if (!last || last.confidence >= LOW_FIT) return null;
  return { score: last.confidence, atMost: true, explained: null };
}

/**
 * The Detect warning in words: the line on screen ("Pharma explains 1 of 12 columns here.") and
 * the whole reason behind its ⓘ. Outside the top matches the columns it explains are unknown, so
 * the line gives its score at most instead.
 */
export function lowFitWords(
  name: string,
  fit: LowFit,
  columns: number,
  locale: NumberLocale,
): { headline: string; full: string } {
  const of = countOf(columns, "column", locale);
  const headline =
    fit.explained === null
      ? `${name} scores ${fit.score === 0 ? "0%" : `${fit.score}% or less`} here.`
      : fit.explained === 0
        ? `${name} explains none of the ${of} here.`
        : `${name} explains ${formatCount(fit.explained, locale)} of ${of} here.`;
  const why = fit.atMost
    ? `${name} isn't among the top matches for this file.`
    : `${name} scores ${fit.score}% for this file.`;
  return {
    headline,
    full: `${why} Most of its KPIs can't be computed, and Loupe may misread columns. A general dashboard fits this table better.`,
  };
}

/** The dashboard notice's line: "Pharma fits few of your columns (1 of 12)", or none of them. */
export function weakFitLine(
  name: string,
  fit: { mapped: number; columns: number },
  locale: NumberLocale,
): string {
  const of = `${formatCount(fit.mapped, locale)} of ${formatCount(fit.columns, locale)}`;
  return `${name} fits ${fit.mapped === 0 ? "none" : "few"} of your columns (${of}).`;
}
