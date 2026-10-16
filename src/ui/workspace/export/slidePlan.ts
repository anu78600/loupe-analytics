/**
 * The plan of a presentation deck, decided before anything is drawn, so the
 * Export card can show the deck in miniature and say exactly how many images
 * the dashboard takes:
 *
 * - an overview slide (headline KPIs and key takeaways);
 * - then each dashboard section's charts (Trend, Breakdowns, Drivers…), in
 *   rows: a wide chart alone, the others in pairs; one row a slide for
 *   presenting (density 2) or two rows for a compact deck (density 4);
 * - a table or a cohort grid, read row by row, gets a slide of its own at
 *   the end of its section.
 *
 * slides.tsx draws the plan. Plain data and functions, tested in
 * tests/slides.test.ts.
 */
import type { ChartSection } from "@/engine/charts/types";
import { slugify } from "@/lib/utils";
import { SECTIONS } from "../dashboard/sections";
import type { ReportChart } from "./report";

/** Charts per slide: two for presenting (large and legible), four for a compact deck. */
export type SlideDensity = 2 | 4;

export type Slide =
  | { kind: "overview" }
  | {
      kind: "charts";
      section: ChartSection | "other";
      /** The section's name ("Trend") and the question it answers. */
      title: string;
      question: string;
      /** Which of the section's slides this is: "2 of 3". */
      part: number;
      parts: number;
      /** One or two rows, each one wide chart or up to two charts side by side. */
      rows: ReportChart[][];
      /** A chart that needs the whole slide to be read (a table, a cohort grid). */
      whole?: boolean;
    };

/** Tables and cohort grids are read row by row: they get a slide of their own. */
export function needsWholeSlide(c: ReportChart): boolean {
  return c.kind === "table" || c.kind === "cohort" || Boolean(c.data.cohorts?.length);
}

/**
 * The deck for `charts` (dashboard order): the overview, then each section's
 * charts in rows (a wide chart alone, others in pairs, a chart left waiting
 * for a partner taking the next one that comes), one row a slide at density 2
 * and two at density 4, then any whole-slide charts.
 */
export function planSlides(charts: ReportChart[], density: SlideDensity): Slide[] {
  const rowsPerSlide = density === 4 ? 2 : 1;
  const slides: Slide[] = [{ kind: "overview" }];
  const known = new Set<string>(SECTIONS.map((s) => s.id));
  const groups = [
    ...SECTIONS.map((s) => ({
      id: s.id as ChartSection | "other",
      title: s.title,
      question: s.blurb.replace(/\.$/, ""),
      charts: charts.filter((c) => c.spec.section === s.id),
    })),
    {
      id: "other" as const,
      title: "More charts",
      question: "The rest of the dashboard",
      charts: charts.filter((c) => !known.has(c.spec.section)),
    },
  ];
  for (const g of groups) {
    if (!g.charts.length) continue;
    const rows: ReportChart[][] = [];
    const whole: ReportChart[] = [];
    let pending: ReportChart | null = null;
    for (const c of g.charts) {
      if (needsWholeSlide(c)) whole.push(c);
      else if (c.wide) rows.push([c]);
      else if (pending) {
        rows.push([pending, c]);
        pending = null;
      } else pending = c;
    }
    if (pending) rows.push([pending]);
    const pages: Array<{ rows: ReportChart[][]; whole?: boolean }> = [];
    for (let i = 0; i < rows.length; i += rowsPerSlide) pages.push({ rows: rows.slice(i, i + rowsPerSlide) });
    for (const c of whole) pages.push({ rows: [[c]], whole: true });
    pages.forEach((p, i) =>
      slides.push({
        kind: "charts",
        section: g.id,
        title: g.title,
        question: g.question,
        part: i + 1,
        parts: pages.length,
        rows: p.rows,
        ...(p.whole ? { whole: true } : {}),
      }),
    );
  }
  return slides;
}

/** "Overview · Trend 2 · Breakdowns 3": the deck by section, for the Export card. */
export function describeSlides(slides: Slide[]): string {
  const parts: string[] = [];
  for (const s of slides) {
    if (s.kind === "overview") parts.push("Overview");
    else if (s.part === 1) parts.push(s.parts > 1 ? `${s.title} ${s.parts}` : s.title);
  }
  return parts.join(" · ");
}

/** "01-overview.png", "04-trend-2.png": numbered so they sort in deck order. */
export function slideFileName(slide: Slide, index: number): string {
  const n = String(index + 1).padStart(2, "0");
  if (slide.kind === "overview") return `${n}-overview.png`;
  return `${n}-${slugify(slide.title)}${slide.parts > 1 ? `-${slide.part}` : ""}.png`;
}
