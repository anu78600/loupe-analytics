/**
 * The Questions step as a conversation (version 50.4): the pure logic behind
 * the thread, kept apart from the components so it can be tested on its own.
 *
 * - The store keeps the questions newest first (store/workspace.ts, which the
 *   SQL PDF and the re-answering after a rebuild also read); the thread reads
 *   oldest first, so the newest answer sits last, by the composer.
 * - Follow-up chips are the file's own suggested questions
 *   (engine/charts/ask suggestQuestions, each built from its KPIs and columns,
 *   so each can be answered), less the ones already asked, in words or as
 *   the same request; the ones about the latest answer's measure from another
 *   angle come first, as an analyst's next question would.
 * - Each suggestion has a shape (a trend, a ranking, a weekday pattern…) that
 *   picks its icon on the empty thread's cards.
 */
import type { AskOrder, ChartAsk, SuggestedQuestion } from "@/engine/charts/ask";

/** What the thread needs of an answer (QuestionAnswer has these and more). */
export interface AskedQuestion {
  id: string;
  question: string;
  ask: ChartAsk;
  order: AskOrder;
  error?: string;
}

/** The thread in reading order: oldest first, the newest last. The store's own list is left as it is. */
export function threadOrder<T>(questions: readonly T[]): T[] {
  return [...questions].reverse();
}

/** One measure as a key: a KPI by its id, a column by its name and aggregation. */
function measureKey(m: ChartAsk["measures"][number]): string {
  return m.kind === "kpi" ? `kpi:${m.id}` : `col:${m.column}:${m.agg}`;
}

/** What the grouping is: nothing, a time grain, a date part or a column. */
function byKey(by: ChartAsk["by"]): string {
  switch (by.kind) {
    case "none":
      return "none";
    case "time":
      return `time:${by.column}:${by.grain}`;
    case "part":
      return `part:${by.column}:${by.part}`;
    case "column":
      return `column:${by.column}`;
  }
}

/**
 * A key for what an ask computes (its measures, grouping, split, top N, own
 * filters and order), so two phrasings of one request count as one question.
 */
export function askKey(ask: ChartAsk, order: AskOrder): string {
  return JSON.stringify([
    ask.measures.map(measureKey),
    byKey(ask.by),
    ask.split ?? null,
    ask.topN ?? null,
    ask.filters ?? [],
    ask.by.kind === "column" ? order : null,
  ]);
}

/** The questions answered so far (one that couldn't be answered can be asked again), as words and as requests. */
export function askedSoFar(questions: readonly AskedQuestion[]): { texts: Set<string>; keys: Set<string> } {
  const answered = questions.filter((q) => !q.error);
  return {
    texts: new Set(answered.map((q) => q.question)),
    keys: new Set(answered.map((q) => askKey(q.ask, q.order))),
  };
}

/**
 * Up to `max` follow-up questions after the latest answer: suggestions not
 * asked yet, in words or as the same request. Those about a measure of the
 * latest answer, seen another way, lead; the rest keep the suggestions'
 * order. None before the first answer: the empty thread shows the
 * suggestions themselves.
 */
export function followUps(
  suggestions: readonly SuggestedQuestion[],
  questions: readonly AskedQuestion[],
  max = 3,
): SuggestedQuestion[] {
  // The store's list is newest first.
  const latest = questions.find((q) => !q.error);
  if (!latest) return [];
  const { texts, keys } = askedSoFar(questions);
  const open = suggestions.filter((s) => !texts.has(s.text) && !keys.has(askKey(s.ask, s.order)));
  const latestMeasures = new Set(latest.ask.measures.map(measureKey));
  const related = (s: SuggestedQuestion) =>
    s.ask.measures.some((m) => latestMeasures.has(measureKey(m))) && byKey(s.ask.by) !== byKey(latest.ask.by);
  return [...open.filter(related), ...open.filter((s) => !related(s))].slice(0, max);
}

/** What kind of question an ask answers, for its icon. */
export type QuestionShape = "trend" | "ranking" | "lowest" | "top" | "weekday" | "hour" | "season" | "total";

export function questionShape(ask: ChartAsk, order: AskOrder): QuestionShape {
  const by = ask.by;
  if (by.kind === "time") return "trend";
  if (by.kind === "part") return by.part === "dow" ? "weekday" : by.part === "hour" ? "hour" : "season";
  if (by.kind === "none") return "total";
  if (order === "asc") return "lowest";
  return ask.topN ? "top" : "ranking";
}

/**
 * Where focus goes when the exchange `id` is removed: the exchange below it in
 * the thread, else the one above, else null (the question box).
 */
export function focusAfterRemove(ids: readonly string[], id: string): string | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return ids[i + 1] ?? ids[i - 1] ?? null;
}
