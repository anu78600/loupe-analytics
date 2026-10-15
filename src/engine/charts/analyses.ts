/**
 * Customer and basket analyses: cohort retention, RFM segmentation, market basket.
 *
 * Cohort membership (each customer's first order) ignores the date filter, so
 * a customer acquired before the period is never "new"; activity, RFM and
 * baskets use the current selection. RFM scores are tie-aware quintiles and
 * segments come from the recency × frequency grid (monetary is reported, not
 * scored); a selection without dated customers yields no segments rather
 * than an error. Basket items are labelled with their values whatever the
 * column type. Field requirements are checked upstream in recommend.ts.
 */
import type { Column, Dataset } from "@/engine/core/types";
import { bucketLabel, DAY_MS, isoDate, isoDateTime, utc } from "@/engine/core/dates";
import { selectRows, type Filter } from "@/engine/query/filter";
import { entityCodes, type Resolver } from "@/engine/query/evaluate";
import { runQuery } from "@/engine/query/run";
import type { BasketPair, CohortRow, RfmSegment } from "./types";

// Absolute month number (year × 12 + month, UTC wall clock); monthStart inverts it.
const monthIndex = (t: number): number => {
  const d = new Date(t);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};
const monthStart = (idx: number): number => utc(Math.floor(idx / 12), (idx % 12) + 1, 1);

function col(ds: Dataset, name: string): Column {
  const c = ds.columns.find((x) => x.name === name);
  if (!c) throw new Error(`Column "${name}" not found`);
  return c;
}

// ---------------------------------------------------------------- cohorts

/**
 * Monthly cohort retention. Rows are the most recent `maxCohorts` first-order
 * months within the selection's date span; cell N is the share of the cohort
 * that ordered N months after its first month, null when that month lies
 * beyond the selection's last month.
 */
export function computeCohorts(
  ds: Dataset,
  filters: readonly Filter[],
  params: { customer: string; date: string },
  opts: { maxCohorts?: number; maxOffsets?: number } = {},
): { cohorts: CohortRow[]; notes: string[] } {
  const maxCohorts = opts.maxCohorts ?? 12;
  const maxOffsets = opts.maxOffsets ?? 12;
  const cust = entityCodes(col(ds, params.customer));
  const dateCol = col(ds, params.date);
  if (dateCol.kind !== "date") throw new Error("Cohort date must be a date column");
  const dates = dateCol.values;
  // First order per customer ignores the date filter (a customer acquired before the period is not "new").
  const base = selectRows(ds, filters, (f) => f.kind === "dateRange");
  // First month per customer; INT32 max = no dated order.
  const first = new Int32Array(cust.card).fill(2147483647);
  for (let i = 0; i < base.length; i++) {
    const r = base[i] as number;
    const k = cust.codes[r] as number;
    const d = dates[r] as number;
    if (k < 0 || d !== d) continue;
    const m = monthIndex(d);
    if (m < (first[k] as number)) first[k] = m;
  }
  const active = selectRows(ds, filters);
  let lastMonth = -1;
  let firstMonth = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < active.length; i++) {
    const d = dates[active[i] as number] as number;
    if (d !== d) continue;
    const m = monthIndex(d);
    if (m > lastMonth) lastMonth = m;
    if (m < firstMonth) firstMonth = m;
  }
  if (lastMonth < 0) return { cohorts: [], notes: ["No dated rows in the selection."] };
  const startCohort = Math.max(firstMonth, lastMonth - maxCohorts + 1);
  const nCohorts = lastMonth - startCohort + 1;
  // Sizes count every customer whose first month is in the window, taken from
  // the date-unfiltered rows, so month-0 retention can fall below 100% when
  // the date filter starts mid-month.
  const sizes = new Int32Array(nCohorts);
  for (let k = 0; k < cust.card; k++) {
    const c = (first[k] as number) - startCohort;
    if (c >= 0 && c < nCohorts) sizes[c] = (sizes[c] as number) + 1;
  }
  // A customer counts once per month offset, however many orders they placed.
  const offsets = maxOffsets + 1;
  const seen = new Uint8Array(cust.card * offsets);
  const counts = new Int32Array(nCohorts * offsets);
  for (let i = 0; i < active.length; i++) {
    const r = active[i] as number;
    const k = cust.codes[r] as number;
    const d = dates[r] as number;
    if (k < 0 || d !== d) continue;
    const c = (first[k] as number) - startCohort;
    if (c < 0 || c >= nCohorts) continue;
    const off = monthIndex(d) - (first[k] as number);
    if (off < 0 || off > maxOffsets) continue;
    const key = k * offsets + off;
    if (seen[key]) continue;
    seen[key] = 1;
    counts[c * offsets + off] = (counts[c * offsets + off] as number) + 1;
  }
  const cohorts: CohortRow[] = [];
  for (let c = 0; c < nCohorts; c++) {
    const size = sizes[c] as number;
    if (size === 0) continue;
    const m = startCohort + c;
    const retention: Array<number | null> = [];
    for (let off = 0; off <= maxOffsets; off++) {
      retention.push(m + off > lastMonth ? null : (counts[c * offsets + off] as number) / size);
    }
    cohorts.push({ cohort: monthStart(m), label: bucketLabel(monthStart(m), "month"), size, retention });
  }
  const notes = [
    "Each row is the customers whose first-ever order fell in that month; cells show the share who ordered again N months later.",
    "Blank cells are months that haven't happened yet, not zero retention. Compare cohorts on the same month offset.",
  ];
  return { cohorts, notes };
}

// ---------------------------------------------------------------- RFM

/** Suggested next step for each RFM segment. */
export const RFM_ACTIONS: Record<string, string> = {
  Champions: "Reward and ask for referrals; early access to launches.",
  "Loyal Customers": "Upsell higher-value products; loyalty perks.",
  "Potential Loyalists": "Offer membership or a second-purchase incentive.",
  "New Customers": "Onboard well: delivery experience, usage tips, first-repeat nudge.",
  Promising: "Build the habit with personalised recommendations.",
  "Need Attention": "Time-limited offers based on past purchases.",
  "About to Sleep": "Reactivation with relevant products before they lapse.",
  "At Risk": "Win-back campaign; ask what went wrong.",
  "Can't Lose Them": "High-value customers going quiet: personal outreach.",
  Hibernating: "Low-cost reminders; don't over-discount.",
  Lost: "Exclude from paid retargeting; occasional brand reminders only.",
};

/** RFM segment from recency and frequency scores (1–5). Rules are checked top-down, so their order matters. */
function segmentOf(r: number, f: number): string {
  if (r >= 4 && f >= 4) return "Champions";
  if (r >= 3 && f >= 3) return "Loyal Customers";
  if (r >= 4 && f >= 2) return "Potential Loyalists";
  if (r === 5 && f === 1) return "New Customers";
  if (r === 4 && f === 1) return "Promising";
  if (r === 3 && f >= 2) return "Need Attention";
  if (r === 3 && f === 1) return "About to Sleep";
  if (r === 1 && f >= 5) return "Can't Lose Them";
  if (r <= 2 && f >= 3) return "At Risk";
  if (r === 2) return "Hibernating";
  return "Lost";
}

/**
 * Tie-aware quintile score: equal values always share a score.
 * score = 1 + floor(5 × share of values strictly worse), clamped to 1–5;
 * with `higherIsBetter` false (recency) a smaller value is better.
 */
function quintileScores(values: Float64Array, higherIsBetter: boolean): Int8Array {
  const n = values.length;
  const sorted = Float64Array.from(values).sort();
  const scores = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const v = values[i] as number;
    let lo = 0;
    let hi = n;
    // count strictly less (or strictly greater) than v
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((sorted[mid] as number) < v) lo = mid + 1;
      else hi = mid;
    }
    const less = lo;
    let lo2 = lo;
    let hi2 = n;
    while (lo2 < hi2) {
      const mid = (lo2 + hi2) >> 1;
      if ((sorted[mid] as number) <= v) lo2 = mid + 1;
      else hi2 = mid;
    }
    const greater = n - lo2;
    const better = higherIsBetter ? less : greater;
    scores[i] = Math.min(5, Math.max(1, 1 + Math.floor((5 * better) / Math.max(1, n))));
  }
  return scores;
}

/**
 * RFM over the customers in the selection. Recency is whole days from each
 * customer's last order to the latest order in the selection; frequency is
 * distinct orders (rows when no order id is mapped); monetary is the
 * `monetary` KPI per customer, blank counted as 0. Blank customer ids and
 * customers with no dated row are left out; when none is left, there are no
 * segments and `asOf` is NaN.
 */
export function computeRfm(
  ds: Dataset,
  resolver: Resolver,
  filters: readonly Filter[],
  dateColumn: string | null,
  params: { customer: string; date: string; order?: string; monetary: string },
): { segments: RfmSegment[]; asOf: number; customers: number; notes: string[] } {
  const q = runQuery(ds, resolver, {
    filters: [...filters],
    groupBy: [{ kind: "column", column: params.customer }],
    measures: [
      { id: "last", expr: { agg: "max", of: { field: `col:${params.date}` } } },
      {
        id: "freq",
        expr: params.order ? { agg: "countDistinct", of: `col:${params.order}` } : { agg: "count" },
      },
      { id: "money", expr: resolver.kpi(params.monetary) },
    ],
    dateColumn,
  });
  const groups = q.groups.filter((g) => g.labels[0]?.raw !== null && Number.isFinite(g.values[0] as number));
  const n = groups.length;
  // No dated customer: nothing to score, and no "as of" date to report.
  if (n === 0)
    return {
      segments: [],
      asOf: NaN,
      customers: 0,
      notes: ["No customer in this selection has a dated order."],
    };
  let asOf = -Infinity;
  for (const g of groups) asOf = Math.max(asOf, g.values[0] as number);
  const recency = Float64Array.from(
    groups,
    (g) => Math.floor(asOf / DAY_MS) - Math.floor((g.values[0] as number) / DAY_MS),
  );
  const freq = Float64Array.from(groups, (g) => g.values[1] as number);
  const money = Float64Array.from(groups, (g) =>
    Number.isFinite(g.values[2] as number) ? (g.values[2] as number) : 0,
  );
  const R = quintileScores(recency, false);
  const F = quintileScores(freq, true);
  const agg = new Map<string, { customers: number; revenue: number; r: number; f: number; m: number }>();
  let totalRevenue = 0;
  for (let i = 0; i < n; i++) {
    const seg = segmentOf(R[i] as number, F[i] as number);
    const a = agg.get(seg) ?? { customers: 0, revenue: 0, r: 0, f: 0, m: 0 };
    a.customers++;
    a.revenue += money[i] as number;
    a.r += recency[i] as number;
    a.f += freq[i] as number;
    a.m += money[i] as number;
    agg.set(seg, a);
    totalRevenue += money[i] as number;
  }
  const segments: RfmSegment[] = [...agg.entries()]
    .map(([segment, a]) => ({
      segment,
      customers: a.customers,
      customerShare: n ? a.customers / n : 0,
      revenue: a.revenue,
      revenueShare: totalRevenue ? a.revenue / totalRevenue : 0,
      avgRecency: a.r / a.customers,
      avgFrequency: a.f / a.customers,
      avgMonetary: a.m / a.customers,
      action: RFM_ACTIONS[segment] ?? "",
    }))
    .sort((a, b) => b.revenue - a.revenue);
  return {
    segments,
    asOf,
    customers: n,
    notes: [
      `Recency is measured to the last order date in the selection (${isoDate(asOf)}).`,
      "Scores are tie-aware quintiles (1–5); segments use the recency × frequency grid, monetary shown for context.",
    ],
  };
}

// ---------------------------------------------------------------- market basket

/**
 * Display label for each entity code of an item column. Text codes index the
 * dictionary; for other types entityCodes numbers the distinct values in
 * first-seen row order, so each code is mapped back to the value of the
 * first row that carries it (numbers as written, dates as ISO, booleans by
 * their labels), never shown as the internal code.
 */
function itemLabels(col: Column, codes: Int32Array, card: number): (code: number) => string {
  switch (col.kind) {
    case "string":
      return (code) => col.dict[code] as string;
    case "boolean":
      return (code) => (code === 1 ? col.trueLabel : col.falseLabel);
    case "number":
    case "date": {
      const value = new Float64Array(card).fill(NaN);
      for (let r = 0; r < codes.length; r++) {
        const c = codes[r] as number;
        if (c >= 0 && value[c] !== value[c]) value[c] = col.values[r] as number;
      }
      const show =
        col.kind === "date"
          ? (v: number) => (col.hasTime ? isoDateTime(v) : isoDate(v))
          : (v: number) => String(v);
      return (code) => show(value[code] as number);
    }
  }
}

/**
 * Market-basket pairs over the selection. Items are deduplicated per order;
 * pairs are counted in orders with 2–20 distinct items (bigger orders still
 * count towards item totals but are skipped for pairs, bounding the quadratic
 * pair count); pairs seen in fewer than max(3, 0.05% of orders) orders are
 * dropped as noise. Sorted by lift, then by orders.
 */
export function computeBasket(
  ds: Dataset,
  filters: readonly Filter[],
  params: { order: string; item: string },
  maxPairs = 15,
): { pairs: BasketPair[]; orders: number; multiItemOrders: number; notes: string[] } {
  const rows = selectRows(ds, filters);
  const orders = entityCodes(col(ds, params.order));
  const itemCol = col(ds, params.item);
  const items = entityCodes(itemCol);
  const label = itemLabels(itemCol, items.codes, items.card);
  const byOrder = new Map<number, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as number;
    const o = orders.codes[r] as number;
    const it = items.codes[r] as number;
    if (o < 0 || it < 0) continue;
    const list = byOrder.get(o);
    if (list) {
      if (!list.includes(it)) list.push(it);
    } else byOrder.set(o, [it]);
  }
  const N = byOrder.size;
  const itemOrders = new Int32Array(items.card);
  const pairCounts = new Map<number, number>();
  let multi = 0;
  for (const list of byOrder.values()) {
    for (const it of list) itemOrders[it] = (itemOrders[it] as number) + 1;
    if (list.length < 2 || list.length > 20) continue;
    multi++;
    // Sorted, so a < b and key a * card + b names each unordered pair once.
    list.sort((a, b) => a - b);
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const key = (list[a] as number) * items.card + (list[b] as number);
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const minCount = Math.max(3, Math.ceil(N * 0.0005));
  const pairs: BasketPair[] = [];
  for (const [key, c] of pairCounts) {
    if (c < minCount) continue;
    const a = Math.floor(key / items.card);
    const b = key % items.card;
    const ca = itemOrders[a] as number;
    const cb = itemOrders[b] as number;
    pairs.push({
      a: label(a),
      b: label(b),
      orders: c,
      support: c / N,
      confidenceAB: c / ca,
      confidenceBA: c / cb,
      lift: (c * N) / (ca * cb),
    });
  }
  pairs.sort((x, y) => y.lift - x.lift || y.orders - x.orders);
  const notes = [
    `${multi.toLocaleString("en-US")} of ${N.toLocaleString("en-US")} orders have two or more different items.`,
    `Pairs bought together in fewer than ${minCount} orders are hidden as noise. Lift above 1 means the pair appears together more often than chance.`,
  ];
  return { pairs: pairs.slice(0, maxPairs), orders: N, multiItemOrders: multi, notes };
}
