/**
 * The Insights step as a ranked feed (version 50.4): the pure logic behind
 * its tabs, its ranks, its impact bars and its keyboard selection, kept apart
 * from the components so it can be tested on its own.
 *
 * - The insights arrive ranked by impact (engine/insights, highest first).
 *   Each keeps that overall rank when the feed is narrowed to one kind.
 * - The tabs are "All" and each kind present, in the order of its
 *   best-ranked insight, each with its count.
 * - The impact bar draws the engine's own 0–100 score (Insight.impact); the
 *   width is clamped for drawing only, never rescaled or estimated.
 * - From xl the feed is a master list: the arrow keys move the selection
 *   one insight at a time (stopping at the ends), Home and End jump.
 */
import type { Insight, InsightKind } from "@/engine/insights/insights";

export type KindTab = { kind: InsightKind | "all"; count: number };

/** "All" and each kind present, in the order of its best-ranked insight, with counts. */
export function kindTabs(insights: readonly Pick<Insight, "kind">[]): KindTab[] {
  const counts = new Map<InsightKind, number>();
  for (const i of insights) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  return [{ kind: "all", count: insights.length }, ...[...counts].map(([kind, count]) => ({ kind, count }))];
}

/** The insights shown under a tab, each with its overall rank (1 = highest impact). */
export function rankedFeed<T extends Pick<Insight, "kind">>(
  insights: readonly T[],
  kind: InsightKind | "all",
): Array<{ insight: T; rank: number }> {
  return insights
    .map((insight, i) => ({ insight, rank: i + 1 }))
    .filter(({ insight }) => kind === "all" || insight.kind === kind);
}

/** The impact bar's width in percent: the engine's 0–100 score, clamped for drawing. */
export function impactPercent(impact: number): number {
  if (!Number.isFinite(impact)) return 0;
  return Math.min(100, Math.max(0, impact));
}

/**
 * The selection after a key press in the feed: ArrowDown and ArrowUp move
 * one insight (stopping at the ends), Home and End jump to the first and the
 * last. Null for any other key, or an empty feed.
 */
export function moveSelection(ids: readonly string[], current: string | null, key: string): string | null {
  if (!ids.length) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  switch (key) {
    case "ArrowDown":
      return ids[Math.min(ids.length - 1, at + 1)] ?? null;
    case "ArrowUp":
      return ids[Math.max(0, at < 0 ? 0 : at - 1)] ?? null;
    case "Home":
      return ids[0] ?? null;
    case "End":
      return ids[ids.length - 1] ?? null;
    default:
      return null;
  }
}
