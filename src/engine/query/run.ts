/**
 * Aggregation queries: filters → grouping → measures, with top-N and a correctly recomputed "Others".
 *
 * Grouped charts, sparklines and insights all run through runQuery. Totals
 * are evaluated as one group over the rows that landed in some group (rows
 * whose time, bin or date-part key is blank drop out), never summed from the
 * groups; totalRows still counts every selected row.
 */
import type { Dataset } from "@/engine/core/types";
import type { Expr } from "./expr";
import { selectRowsCached, type Filter } from "./filter";
import { buildGrouping, compactRows, type GroupKey, type GroupLabel, type RowGetter } from "./groupby";
import { compileRowExpr, evaluate, type Resolver, type Scope } from "./evaluate";

export interface MeasureSpec {
  id: string;
  expr: Expr;
}

export interface AggQuery {
  filters: Filter[];
  groupBy: GroupKey[];
  measures: MeasureSpec[];
  /**
   * Keep the top N groups by measures[rankBy] (descending); fold the rest into "Others".
   * `others: false` drops the rest instead. `minRows` first sets aside groups
   * with fewer rows (counted in `suppressed`); when an Others bucket is
   * built, their rows are folded into it as well.
   */
  topN?: { n: number; rankBy: number; others: boolean; minRows?: number };
  /** Keep every combination of two keys (heatmaps). */
  dense?: boolean;
  /** Primary date column; date-range filters on it define the analysis period. */
  dateColumn?: string | null;
}

export interface ResultGroup {
  labels: GroupLabel[];
  /** One value per measure, in AggQuery.measures order (NaN = blank). */
  values: number[];
  rows: number;
  isOthers?: boolean;
  /** Number of original groups folded into "Others", including any set aside by minRows. */
  foldedGroups?: number;
}

export interface AggResult {
  groups: ResultGroup[];
  /** Each measure evaluated over all grouped rows as one group (not a sum of the groups). */
  totals: number[];
  /** Rows passing the filters, including any with no group. */
  totalRows: number;
  /** Groups dropped for having fewer rows than minRows (small-sample guard). */
  suppressed: number;
}

export const OTHERS_LABEL = "Others";

/**
 * Period context for newEntities: the start of the date-range filter on the
 * primary date column (on any date column when none is given) and the rows
 * passing every filter except date ranges. No date filter → unbounded period.
 */
export function periodScope(
  ds: Dataset,
  filters: readonly Filter[],
  dateColumn: string | null | undefined,
): {
  periodStart: number;
  rowsIgnoringDate: Int32Array | null;
} {
  const dateFilter = filters.find((f) => f.kind === "dateRange" && (!dateColumn || f.column === dateColumn));
  if (!dateFilter || dateFilter.kind !== "dateRange")
    return { periodStart: -Infinity, rowsIgnoringDate: null };
  return {
    periodStart: dateFilter.from,
    rowsIgnoringDate: selectRowsCached(ds, filters, true),
  };
}

/** Runs one aggregation: select rows, group, evaluate every measure per group and overall, then apply top-N. */
export function runQuery(ds: Dataset, res: Resolver, q: AggQuery): AggResult {
  const selected = selectRowsCached(ds, q.filters);
  const { periodStart, rowsIgnoringDate } = periodScope(ds, q.filters, q.dateColumn);
  const getters: Array<RowGetter | undefined> = q.groupBy.map((k) =>
    k.kind === "binExpr" ? compileRowExpr(k.expr, res) : undefined,
  );
  const grouping = buildGrouping(ds, q.groupBy, selected, { dense: q.dense, getters });
  const { rows, groupOf } = compactRows(selected, grouping.groupOf);

  // First-date context per dimension group (for "new customers by channel" etc.).
  // The date-free selection is grouped by the same key and its group ids are
  // translated to the main grouping's ids by raw key; values absent from the
  // date-filtered grouping map to -1 and are ignored. Keys that bucket time
  // are not dimensions: a time key, and a column key on a date column (which
  // groupby.ts buckets by day), give the grouping a periodStart, so first
  // dates stay global and each bucket's start is its period start. A per-day
  // first-date context would make every entity new on every day it appears.
  // Date parts (weekday, hour…) are not periods either and use the analysis
  // period's start.
  let ignoringDateGroups: Int32Array | null = null;
  const key0 = q.groupBy.length === 1 ? q.groupBy[0] : undefined;
  const singleDimKey = key0 !== undefined && key0.kind !== "datePart" && grouping.periodStart === null;
  if (rowsIgnoringDate && singleDimKey) {
    const g2 = buildGrouping(ds, q.groupBy, rowsIgnoringDate, { getters });
    const map = new Map<string, number>();
    grouping.labels.forEach((l, g) => map.set(String(l[0]?.raw ?? "∅"), g));
    const translate = g2.labels.map((l) => map.get(String(l[0]?.raw ?? "∅")) ?? -1);
    ignoringDateGroups = Int32Array.from(g2.groupOf, (g) => (g < 0 ? -1 : (translate[g] as number)));
  }

  // A time bucket's period starts at its own start or the filter's start,
  // whichever is later: the first bucket can be cut by the date filter.
  const scope: Scope = {
    periodStart,
    rowsIgnoringDate,
    ignoringDateGroups,
    periodStartByGroup: grouping.periodStart
      ? Float64Array.from(grouping.periodStart, (s) => Math.max(s, periodStart))
      : null,
  };
  const cache = new Map<string, Float64Array>();
  const values = q.measures.map((m) => evaluate(m.expr, res, scope, rows, groupOf, grouping.G, cache));
  const totalScope: Scope = {
    periodStart,
    rowsIgnoringDate,
    ignoringDateGroups: null,
    periodStartByGroup: null,
  };
  const totalCache = new Map<string, Float64Array>();
  const totals = q.measures.map(
    (m) => evaluate(m.expr, res, totalScope, rows, null, 1, totalCache)[0] as number,
  );

  let groups: ResultGroup[] = grouping.labels.map((labels, g) => ({
    labels,
    values: values.map((v) => v[g] as number),
    rows: grouping.rowCounts[g] as number,
  }));

  let suppressed = 0;
  if (q.topN) {
    const { n, rankBy, others, minRows } = q.topN;
    let eligible = groups.map((grp, g) => ({ grp, g }));
    if (minRows) {
      const before = eligible.length;
      eligible = eligible.filter((x) => x.grp.rows >= minRows);
      suppressed = before - eligible.length;
    }
    // Descending by the ranking measure; blank values sort last.
    const ranked = eligible.sort((a, b) => {
      const va = a.grp.values[rankBy] as number;
      const vb = b.grp.values[rankBy] as number;
      return (vb === vb ? vb : -Infinity) - (va === va ? va : -Infinity);
    });
    if (ranked.length > n) {
      const keep = ranked.slice(0, n);
      if (others) {
        // Recompute "Others" from its rows so ratios stay correct (never summed).
        // Kept groups map to slots 0..n-1 and every other group (including
        // those below minRows) to slot n, so one evaluation with n + 1 groups
        // yields Others. The first-date context is remapped the same way, so
        // Others is evaluated like one merged group, in the same context the
        // individual groups use: by a dimension, newEntities takes first dates
        // within the folded groups' rows (as each group does within its own);
        // by time buckets, the period starts at the earliest folded bucket.
        const slot = new Int32Array(grouping.G).fill(n);
        keep.forEach((x, i) => (slot[x.g] = i));
        const remapped = Int32Array.from(groupOf, (g) => slot[g] as number);
        const byGroup = scope.ignoringDateGroups;
        const startByGroup = scope.periodStartByGroup;
        let startBySlot: Float64Array | null = null;
        if (startByGroup) {
          startBySlot = new Float64Array(n + 1).fill(Infinity);
          for (let g = 0; g < grouping.G; g++) {
            const s = slot[g] as number;
            startBySlot[s] = Math.min(startBySlot[s] as number, startByGroup[g] as number);
          }
        }
        const scope2: Scope = {
          ...scope,
          ignoringDateGroups: byGroup
            ? Int32Array.from(byGroup, (g) => (g < 0 ? -1 : (slot[g] as number)))
            : null,
          periodStartByGroup: startBySlot,
        };
        const cache2 = new Map<string, Float64Array>();
        const vals2 = q.measures.map((m) => evaluate(m.expr, res, scope2, rows, remapped, n + 1, cache2));
        const othersRows =
          ranked.slice(n).reduce((s, x) => s + x.grp.rows, 0) +
          (minRows ? groups.filter((g) => g.rows < minRows).reduce((s, g) => s + g.rows, 0) : 0);
        groups = keep.map((x) => x.grp);
        groups.push({
          labels: q.groupBy.map(() => ({ label: OTHERS_LABEL, raw: "__others__" })),
          values: vals2.map((v) => v[n] as number),
          rows: othersRows,
          isOthers: true,
          // Groups set aside by minRows are folded into Others too, so they count here.
          foldedGroups: ranked.length - n + suppressed,
        });
      } else groups = keep.map((x) => x.grp);
    } else groups = ranked.map((x) => x.grp);
  }

  return { groups, totals, totalRows: selected.length, suppressed };
}
