/**
 * The logic of Check & map's review table (version 50.2), kept apart from
 * React so it can be tested (tests/review-table.test.ts).
 *
 * The table has one row per column of the file, in file order. Each row
 * knows its status (used, not used with the reason, or hidden by the user),
 * the kind it is read as (the understanding's kinds, as Detect's chips name
 * them), the template field it fills, what it feeds, and its health badges:
 * short labels ("12 blanks", "Two scales") read from the data-health issues
 * and the data check's views, each pointing at the rows that show it where
 * the check can list them.
 *
 * The filters above the table (All, Used, Not used, Hidden, Needs a look) and
 * the search read the same rows, so the counts always agree with the table.
 * A "Matched to" change is worded here too: which field the column now
 * fills, which column it replaced there and which field it left empty.
 */
import type { ColumnUse, UnusedReason } from "@/engine/charts/columnUsage";
import { formatCount, type NumberLocale } from "@/engine/core/format";
import type { CheckView } from "@/engine/profile/dataCheck";
import type { HealthIssue } from "@/engine/profile/quality";
import type { ColumnProfile } from "@/engine/profile/types";
import { KIND_LABEL, SETTABLE_KINDS } from "@/engine/understand/kinds";
import type { ColumnKind } from "@/engine/understand/types";

export type ColumnStatus = "used" | "unused" | "hidden";

/** The table's filters: by status, or the columns with a problem worth a look. */
export type ReviewFilter = "all" | ColumnStatus | "attention";

/** One short health label on a row ("12 blanks"), with its full text and the rows that show it. */
export interface HealthBadge {
  /** The health issue's id, or "blank:<column>" for blanks no issue covers. */
  id: string;
  label: string;
  /** "warning" needs a look; "info" is worth knowing (the data grid's two tints). */
  tone: "warning" | "info";
  /** The whole explanation. */
  detail: string;
  /** The data-check view listing these rows (the Rows view opens on it), when the check has one. */
  view?: string;
  /** How many rows the view lists. */
  rows?: number;
}

/** One column of the file as the review table shows it. */
export interface ReviewRow {
  column: ColumnProfile;
  status: ColumnStatus;
  /** What it feeds (KPIs, charts, filters); absent for a hidden column. */
  use?: ColumnUse;
  /** Set for a column nothing reads: why, and what the user could do. */
  why?: UnusedReason;
  /** The kind it is read as. */
  kind: ColumnKind;
  /** Why Loupe reads it as that kind (the understanding's sentence), when the analysis has read it. */
  kindWhy?: string;
  /** The template field it fills, on an industry's dashboard. */
  field?: { id: string; label: string };
  health: HealthBadge[];
}

/** "2 KPIs · 5 charts · Date filter": what a used column feeds, in one line. */
export function feedsText(use: ColumnUse | undefined): string {
  if (!use) return "";
  const parts: string[] = [];
  if (use.kpis.length) parts.push(use.kpis.length === 1 ? "1 KPI" : `${use.kpis.length} KPIs`);
  if (use.charts.length) parts.push(use.charts.length === 1 ? "1 chart" : `${use.charts.length} charts`);
  if (use.filters.length) parts.push(...use.filters);
  return parts.join(" · ");
}

/**
 * The kind a column's role stands for, for a column the analysis hasn't read
 * (a hidden one, which the understanding leaves out): the inverse of
 * roleForKind, with a currency an amount and a percentage a rate.
 */
export function kindFromRole(c: ColumnProfile): ColumnKind {
  switch (c.role) {
    case "identifier":
      return "id";
    case "datetime":
    case "time":
      return "time";
    case "dimension":
      return "category";
    case "geo":
      return "place";
    case "text":
      return "text";
    case "boolean":
      return "flag";
    case "rate":
    case "percentage":
      return "rate";
    case "currency":
      return "amount";
    case "measure":
      return c.additivity === "non-additive" ? "measurement" : "amount";
  }
}

/**
 * The kinds a row's "Read as" select lists, in the order Detect's menu lists
 * them; the current kind first, not choosable, when it can't be set there
 * (a date, the outcome).
 */
export function readAsOptions(
  current: ColumnKind,
): Array<{ kind: ColumnKind; label: string; settable: boolean }> {
  const settable = SETTABLE_KINDS.map((kind) => ({ kind, label: KIND_LABEL[kind], settable: true }));
  return SETTABLE_KINDS.includes(current)
    ? settable
    : [{ kind: current, label: KIND_LABEL[current], settable: false }, ...settable];
}

/** "two" → "Two": the scales issue names its count in words. */
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The check prefix of an issue id ("pct-range" of "pct-range-Discount"). */
function prefixOf(issue: HealthIssue, column: string): string {
  const tail = `-${column}`;
  return issue.id.endsWith(tail) ? issue.id.slice(0, -tail.length) : issue.id;
}

/** An issue's short label, from its check and its count. */
function issueLabel(issue: HealthIssue, c: ColumnProfile, n: (x: number) => string): string {
  const count = issue.count ?? 0;
  switch (prefixOf(issue, c.name)) {
    case "scales": {
      const words = /Values on (\S+) scales/.exec(issue.title)?.[1];
      return words ? `${capitalise(words)} scales` : "Mixed scales";
    }
    case "mixed":
      return `${n(count)} unreadable`;
    case "negative":
      return `${n(count)} negative`;
    case "pct-range":
      return `${n(count)} over 100%`;
    case "age":
      return `${n(count)} impossible`;
    case "geo":
      return `${n(count)} out of range`;
    case "outliers":
      return "Heavy tail";
    case "future":
      return `${n(count)} in the future`;
    case "ancient":
      return `${n(count)} before 1900`;
    case "order":
      return `${n(count)} out of order`;
    case "empty":
      return "Empty";
    case "constant":
      return "One value";
    case "nulls":
      return `${Math.round(c.nullPct * 100)}% blank`;
    case "variants":
      return "Mixed spellings";
    default:
      // A check added later: its title without the column's name.
      return issue.title.replace(/\s+in\s+"[^"]*"$/, "");
  }
}

/**
 * A column's health badges, warnings first: one per data-health issue about
 * it, and its blank cells when no issue already speaks of them. A badge
 * names the data-check view that lists its rows when the check has one
 * (`views` is null while the check is still loading: the badges come
 * without their rows then). Hidden columns get none: nothing checks them.
 */
export function healthBadges(
  c: ColumnProfile,
  issues: readonly HealthIssue[],
  views: readonly CheckView[] | null,
  locale: NumberLocale,
): HealthBadge[] {
  const n = (x: number) => formatCount(x, locale);
  const byId = new Map((views ?? []).map((v) => [v.id, v]));
  const blankId = `blank:${c.name}`;
  const out: HealthBadge[] = [];
  let blanksSaid = false;
  for (const issue of issues) {
    if (issue.column !== c.name) continue;
    const prefix = prefixOf(issue, c.name);
    const blanks = prefix === "nulls" || prefix === "empty";
    if (blanks) blanksSaid = true;
    const view = byId.get(blanks ? blankId : `issue:${issue.id}`);
    out.push({
      id: issue.id,
      label: issueLabel(issue, c, n),
      tone: issue.severity === "info" ? "info" : "warning",
      detail: issue.detail,
      ...(view ? { view: view.id, rows: view.rows } : {}),
    });
  }
  if (!blanksSaid && c.nullCount > 0) {
    const view = byId.get(blankId);
    out.push({
      id: blankId,
      label: `${n(c.nullCount)} ${c.nullCount === 1 ? "blank" : "blanks"}`,
      // The check calls blanks in an otherwise filled column probably missing (a warning).
      tone: view?.tone === "warning" ? "warning" : "info",
      detail: view?.detail ?? `${n(c.nullCount)} blank ${c.nullCount === 1 ? "cell" : "cells"}.`,
      ...(view ? { view: view.id, rows: view.rows } : {}),
    });
  }
  // Warnings first; otherwise the order the health report ranks them in.
  return out
    .map((b, i) => ({ b, i }))
    .sort((x, y) => (x.b.tone === y.b.tone ? x.i - y.i : x.b.tone === "warning" ? -1 : 1))
    .map(({ b }) => b);
}

/** True when a row has a problem worth a look (the "Needs a look" filter). */
export function needsALook(row: ReviewRow): boolean {
  return row.status !== "hidden" && row.health.some((b) => b.tone === "warning");
}

/** Whether a row passes a filter. */
export function inFilter(row: ReviewRow, filter: ReviewFilter): boolean {
  if (filter === "all") return true;
  if (filter === "attention") return needsALook(row);
  return row.status === filter;
}

/** Lower case without accents, so "categoria" finds "Categoría". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Whether a row matches the search: its name, the field it fills or the kind it is read as. */
export function matchesQuery(row: ReviewRow, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  return [row.column.name, row.field?.label ?? "", KIND_LABEL[row.kind]].some((s) => fold(s).includes(q));
}

/** How many rows each filter shows. */
export function filterCounts(rows: readonly ReviewRow[]): Record<ReviewFilter, number> {
  const counts: Record<ReviewFilter, number> = {
    all: rows.length,
    used: 0,
    unused: 0,
    hidden: 0,
    attention: 0,
  };
  for (const r of rows) {
    counts[r.status] += 1;
    if (needsALook(r)) counts.attention += 1;
  }
  return counts;
}

/** The rows a filter and a search show, in file order. */
export function visibleRows(rows: readonly ReviewRow[], filter: ReviewFilter, query: string): ReviewRow[] {
  return rows.filter((r) => inFilter(r, filter) && matchesQuery(r, query));
}

/**
 * What a "Matched to" change did, in one sentence for its Undo toast, or
 * null when it took nothing from anywhere (an unmatched column given an
 * empty field). `to` is the field's label (null when the column was
 * unmatched), `from` the field the column filled before, `displaced` the
 * column that filled the new field before.
 */
export function matchMessage({
  column,
  to,
  from,
  displaced,
}: {
  column: string;
  to: string | null;
  from?: string;
  displaced?: string;
}): string | null {
  if (to === null)
    return from
      ? `“${column}” no longer fills ${from}, so ${from} has no column. Map another, or undo.`
      : null;
  if (!from && !displaced) return null;
  const head = `“${column}” now fills ${to}${displaced ? ` in place of “${displaced}”` : ""}`;
  return from ? `${head}, so ${from} has no column. Map another column to it, or undo.` : `${head}.`;
}
