/**
 * Which of the dashboard's charts the exports draw, and under what title.
 *
 * The slides, the PDF report and the Export card's counts all read
 * exportCharts(), so "24 charts" on the card is exactly what the files hold:
 *
 * - the charts visible in the current layout, in dashboard order;
 * - under the title the user gave them in Customise (Widget.title), as the
 *   dashboard shows them, else the recommended one;
 * - only charts that can be drawn: one the engine refused (it names a column
 *   hidden in Check & map, or a KPI that was deleted) or that has nothing to
 *   draw for the current selection is left out, with the reason, so the card
 *   can say "1 chart left out" instead of the deck holding a slide of text.
 *
 * Plain data and functions (no React), tested in tests/export-charts.test.ts.
 */
import type { ChartData, ChartKind, ChartSection, ChartSpec, LayoutMode } from "@/engine/charts/types";
import type { ReportChart } from "./report";

/** The parts of a dashboard widget the exports read (the store's Widget). */
export interface ExportWidget {
  id: string;
  w?: number;
  kind?: ChartKind;
  hidden?: boolean;
  /** The user's own title from Customise; blank means the spec's. */
  title?: string;
}

/** A chart on the dashboard that the exports leave out, and why, in a sentence. */
export interface LeftOutChart {
  id: string;
  title: string;
  /** Its dashboard section, so a file that leaves a whole section out doesn't list it. */
  section: ChartSection;
  why: string;
}

/** The chart's title as the dashboard shows it: the user's own when set, else the recommended one. */
export function shownTitle(spec: ChartSpec, widget: ExportWidget | undefined): string {
  return widget?.title?.trim() || spec.title;
}

/** The spec under its shown title (the same object when the title is unchanged). */
export function withShownTitle(spec: ChartSpec, widget: ExportWidget | undefined): ChartSpec {
  const title = shownTitle(spec, widget);
  return title === spec.title ? spec : { ...spec, title };
}

/** The first sentence of an engine note, where it says what is wrong. */
function firstSentence(text: string): string {
  const t = text.trim();
  return /^.+?[.!?](?=\s|$)/.exec(t)?.[0] ?? t;
}

/**
 * The charts the slides and the report draw, and those they leave out. A
 * chart that hasn't been computed yet (a refresh still running) is neither:
 * it simply isn't there yet.
 */
export function exportCharts(input: {
  widgets: readonly ExportWidget[];
  specs: readonly ChartSpec[];
  charts: Readonly<Record<string, ChartData>>;
  mode: LayoutMode;
}): { charts: ReportChart[]; leftOut: LeftOutChart[] } {
  const byId = new Map(input.specs.map((s) => [s.id, s]));
  const charts: ReportChart[] = [];
  const leftOut: LeftOutChart[] = [];
  for (const w of input.widgets) {
    const spec = byId.get(w.id);
    if (w.hidden || !spec?.modes.includes(input.mode)) continue;
    const data = input.charts[w.id];
    if (!data) continue;
    const shown = withShownTitle(spec, w);
    if (data.empty) {
      const note = data.notes.find((n) => n.trim());
      leftOut.push({
        id: w.id,
        title: shown.title,
        section: spec.section,
        why: note ? firstSentence(note) : "It has nothing to draw for this selection.",
      });
      continue;
    }
    // Wider than 6 of the 12 grid columns: it gets a whole row, as on the dashboard.
    charts.push({ spec: shown, data, kind: w.kind ?? spec.kind, wide: (w.w ?? spec.size.w) > 6 });
  }
  return { charts, leftOut };
}

/** "1 chart left out", "3 charts left out". */
export function leftOutLabel(n: number): string {
  return `${n} ${n === 1 ? "chart" : "charts"} left out`;
}
