/**
 * Dashboard row packing (WidgetGrid): every chart gets at least the width its
 * kind needs to stay legible, rows fill the full width with no holes, and
 * the cards on a row share one height. Pure, so it is unit-tested
 * (tests/layout.test.ts).
 */
import type { ChartKind } from "@/engine/charts/types";

/** Gap between widgets, px (the grid's gap-3). */
const GAP = 12;
const COLS = 12;

/**
 * Narrowest width, in px, at which each kind stays readable: axis labels
 * don't collide, a donut's labels aren't cut, a table shows its columns.
 */
const MIN_PX: Record<ChartKind, number> = {
  line: 420,
  area: 420,
  bar: 400,
  hbar: 360,
  stackedBar: 440,
  donut: 400,
  treemap: 420,
  scatter: 440,
  histogram: 400,
  box: 440,
  heatmap: 540,
  funnel: 400,
  waterfall: 440,
  bullet: 400,
  cohort: 600,
  bump: 520,
  pareto: 460,
  geoTile: 440,
  table: 560,
  pie: 400,
  groupedBar: 440,
  stackedBar100: 440,
  stackedArea: 440,
  step: 420,
  lollipop: 360,
  dumbbell: 400,
  bubble: 460,
  radar: 420,
  gauge: 300,
  sunburst: 400,
  sankey: 520,
  calendar: 620,
  bigNumber: 260,
};

/** A widget's place in the packed grid: its column span and the row height it shares. */
interface Placed {
  id: string;
  span: number;
  h: number;
}

/** A widget designed this wide (a table, a cohort grid) keeps a row of its own. */
const FULL = 10;
/** At most this many charts share a row, so each stays big enough to read. */
const MAX_PER_ROW = 4;

/**
 * Packs widgets into rows of 12 columns, keeping their order, in three steps:
 * 1. Rows: a widget joins the current row while every widget on it can
 *    still have at least its kind's readable width (`min`, measured against
 *    the grid's real width), up to MAX_PER_ROW; widgets designed full width
 *    (10+ columns) keep a row of their own.
 * 2. Balance: each run of widgets between full-width ones is packed again
 *    with an even number per row (at most ceil(widgets / rows)), so four
 *    charts read as two and two rather than three and one stretched across
 *    the page.
 * 3. Widths: each widget starts from its stored width; a row that is too
 *    wide narrows its widest widgets towards their minimums (never below),
 *    and the columns left over are shared out, so every row is exactly 12
 *    wide. Every widget on a row takes the row's tallest height.
 */
export function packRows(
  items: Array<{ id: string; w: number; h: number; kind: ChartKind }>,
  gridWidth: number,
): Placed[][] {
  const colW = gridWidth > 0 ? (gridWidth - GAP * (COLS - 1)) / COLS : 0;
  // Unknown width (first render) or a phone-sized grid: one chart per row.
  const narrow = colW <= 0 || gridWidth < 640;
  type Item = { id: string; h: number; min: number; pref: number; full: boolean };
  const prepared: Item[] = items.map((it) => {
    const min = narrow
      ? COLS
      : Math.max(3, Math.min(COLS, Math.ceil((MIN_PX[it.kind] + GAP) / (colW + GAP))));
    return {
      id: it.id,
      h: it.h,
      min,
      pref: Math.max(min, Math.min(COLS, it.w)),
      full: !narrow && it.w >= FULL,
    };
  });
  const fits = (row: Item[], it: Item, cap = MAX_PER_ROW) =>
    row.length < cap &&
    !it.full &&
    !row.some((p) => p.full) &&
    row.reduce((s, p) => s + p.min, 0) + it.min <= COLS;
  const greedy = (run: Item[], cap: number): Item[][] => {
    const out: Item[][] = [];
    for (const it of run) {
      const last = out[out.length - 1];
      if (last && fits(last, it, cap)) last.push(it);
      else out.push([it]);
    }
    return out;
  };

  // 1. Rows, run by run between full-width widgets (which keep a row of their own).
  // 2. Balance: each run is packed again with at most ceil(widgets / rows) per row,
  //    so six charts read as 2 + 2 + 2 rather than 3 + 2 + 1.
  const rows: Item[][] = [];
  let run: Item[] = [];
  const flush = () => {
    if (!run.length) return;
    const first = greedy(run, MAX_PER_ROW);
    // The same number of rows, with the widgets shared out as evenly as possible (7 → 3 + 2 + 2),
    // kept only if every row still fits; otherwise the plain packing stands.
    const r = first.length;
    const base = Math.floor(run.length / r);
    const even: Item[][] = [];
    let i = 0;
    for (let k = 0; k < r; k++) {
      const size = base + (k < run.length % r ? 1 : 0);
      even.push(run.slice(i, i + size));
      i += size;
    }
    const ok = even.every((row) => row.length <= MAX_PER_ROW && row.reduce((s, p) => s + p.min, 0) <= COLS);
    rows.push(...(ok ? even : first));
    run = [];
  };
  for (const it of prepared) {
    if (it.full) {
      flush();
      rows.push([it]);
    } else run.push(it);
  }
  flush();
  // 3. Widths.
  return rows.map((row) => {
    const spans = row.map((p) => p.pref);
    let over = spans.reduce((s, x) => s + x, 0) - COLS;
    while (over > 0) {
      // Narrow the widget with the most room above its minimum.
      let at = -1;
      row.forEach((p, i) => {
        if (
          (spans[i] as number) > p.min &&
          (at < 0 || (spans[i] as number) - p.min > (spans[at] as number) - (row[at] as Item).min)
        )
          at = i;
      });
      if (at < 0) break;
      spans[at] = (spans[at] as number) - 1;
      over--;
    }
    let left = COLS - spans.reduce((s, x) => s + x, 0);
    for (let i = 0; left > 0; i = (i + 1) % row.length, left--) spans[i] = (spans[i] as number) + 1;
    const h = Math.max(...row.map((p) => p.h));
    return row.map((p, i) => ({ id: p.id, span: spans[i] as number, h }));
  });
}
