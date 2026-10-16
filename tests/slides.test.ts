/**
 * Presentation slides (version 36.0): the deck is planned before it is drawn,
 * so the Export card can say how many landscape images the dashboard takes.
 * An overview first; then each section's charts in dashboard order, a wide
 * chart alone and the others in pairs, one row a slide for presenting or two
 * for a compact deck; a table or a cohort grid on a slide of its own; files
 * numbered so they sort in deck order. In the compact deck, horizontal bars
 * with more than eight categories get a full-height slide of their own, so
 * every bar keeps its name.
 */
import { describe, expect, it } from "vitest";
import {
  describeSlides,
  needsFullHeight,
  planSlides,
  slideFileName,
  type Slide,
} from "@/ui/workspace/export/slidePlan";
import type { ReportChart } from "@/ui/workspace/export/report";
import type { ChartData, ChartKind, ChartSection, ChartSpec } from "@/engine/charts/types";

function chart(id: string, section: ChartSection, kind: ChartKind = "bar", over: Partial<ReportChart> = {}) {
  const spec = { id, title: id, kind, section } as unknown as ChartSpec;
  const data = { specId: id, kind, empty: false } as unknown as ChartData;
  return { spec, data, kind, ...over } satisfies ReportChart;
}

/** A chart of `n` categories along an axis of `axis` kind (named columns by default). */
function bars(
  id: string,
  section: ChartSection,
  kind: ChartKind,
  n: number,
  axis: "column" | "time" = "column",
): ReportChart {
  const spec = { id, title: id, kind, section, x: { kind: axis } } as unknown as ChartSpec;
  const categories = Array.from({ length: n }, (_, i) => ({ label: `C${i}`, raw: i }));
  const data = { specId: id, kind, empty: false, categories } as unknown as ChartData;
  return { spec, data, kind };
}

/** Each chart slide as its rows of chart ids: "a+b", "c". */
const shape = (slides: Slide[]) =>
  slides.map((s) =>
    s.kind === "overview" ? "overview" : s.rows.map((r) => r.map((c) => c.spec.id).join("+")).join(" / "),
  );

describe("planSlides", () => {
  const dashboard = [
    chart("t1", "trend", "line", { wide: true }),
    chart("t2", "trend", "line"),
    chart("t3", "trend", "stackedBar"),
    chart("b1", "breakdown", "hbar"),
    chart("b2", "breakdown", "donut"),
    chart("b3", "breakdown", "hbar"),
    chart("d1", "drivers", "cohort"),
    chart("d2", "drivers", "bar"),
    chart("x1", "detail", "table"),
  ];

  it("opens with the overview, then two charts a slide in dashboard order", () => {
    expect(shape(planSlides(dashboard, 2))).toEqual([
      "overview",
      "t1",
      "t2+t3",
      "b1+b2",
      "b3",
      "d2",
      "d1",
      "x1",
    ]);
  });

  it("puts two rows on a compact slide", () => {
    expect(shape(planSlides(dashboard, 4))).toEqual([
      "overview",
      "t1 / t2+t3",
      "b1+b2 / b3",
      "d2",
      "d1",
      "x1",
    ]);
  });

  it("gives a table or a cohort grid a slide of its own, after the section's other charts", () => {
    const slides = planSlides(dashboard, 2).filter((s) => s.kind === "charts" && s.whole);
    expect(slides.map((s) => (s.kind === "charts" ? s.rows[0]?.[0]?.spec.id : ""))).toEqual(["d1", "x1"]);
  });

  it("titles each slide with its section, its question and its part", () => {
    const [, first, second] = planSlides(dashboard, 2);
    expect(first).toMatchObject({
      title: "Trend",
      question: "How the headline numbers move over time",
      part: 1,
      parts: 2,
    });
    expect(second).toMatchObject({ title: "Trend", part: 2, parts: 2 });
  });

  it("pairs a chart left waiting with the next one, across a wide chart", () => {
    const slides = planSlides(
      [chart("a", "trend"), chart("w", "trend", "line", { wide: true }), chart("b", "trend")],
      2,
    );
    expect(shape(slides)).toEqual(["overview", "w", "a+b"]);
  });

  it("keeps charts from an unknown section, under More charts", () => {
    const slides = planSlides([chart("c", "custom" as ChartSection)], 2);
    expect(slides[1]).toMatchObject({ title: "More charts", section: "other" });
  });

  it("is only the overview for a dashboard with no charts", () => {
    expect(planSlides([], 2)).toEqual([{ kind: "overview" }]);
  });
});

describe("horizontal bars with many categories in the compact deck", () => {
  const dashboard = [
    chart("t1", "trend", "line", { wide: true }),
    bars("b1", "breakdown", "hbar", 12),
    chart("b2", "breakdown", "donut"),
    chart("b3", "breakdown", "bar"),
    bars("b4", "breakdown", "hbar", 5),
  ];

  it("gives the chart a row of its own on a slide of its own, after the section's full slides", () => {
    expect(shape(planSlides(dashboard, 4))).toEqual(["overview", "t1", "b2+b3 / b4", "b1"]);
    // Alone on its slide, the row has the slide's full height: the deck draws one row at full height.
    const slide = planSlides(dashboard, 4)[3];
    expect(slide).toMatchObject({ kind: "charts", title: "Breakdowns", part: 2, parts: 2 });
    expect(slide?.kind === "charts" ? slide.rows.length : 0).toBe(1);
  });

  it("leaves the presenting deck as it was: every row there is already full height", () => {
    expect(shape(planSlides(dashboard, 2))).toEqual(["overview", "t1", "b1+b2", "b3+b4"]);
  });

  it("counts more than eight bars, and a column chart of more than ten names, which turns horizontal", () => {
    expect(needsFullHeight(bars("a", "breakdown", "hbar", 9))).toBe(true);
    expect(needsFullHeight(bars("a", "breakdown", "hbar", 8))).toBe(false);
    expect(needsFullHeight(bars("a", "breakdown", "lollipop", 12))).toBe(true);
    expect(needsFullHeight(bars("a", "breakdown", "bar", 12))).toBe(true);
    // Ten named columns stay columns; twelve months stay columns whatever their count.
    expect(needsFullHeight(bars("a", "breakdown", "bar", 10))).toBe(false);
    expect(needsFullHeight(bars("a", "trend", "bar", 12, "time"))).toBe(false);
  });

  it("keeps the four-chart slides full: the charts around it still pair and stack", () => {
    const slides = planSlides(
      [
        chart("a", "drivers"),
        chart("b", "drivers"),
        chart("c", "drivers"),
        bars("h", "drivers", "hbar", 15),
        chart("d", "drivers"),
      ],
      4,
    );
    expect(shape(slides)).toEqual(["overview", "a+b / c+d", "h"]);
  });
});

describe("the deck in words and file names", () => {
  const slides = planSlides(
    [
      chart("t1", "trend", "line", { wide: true }),
      chart("t2", "trend"),
      chart("b1", "breakdown"),
      chart("x1", "detail", "table"),
    ],
    2,
  );

  it("counts each section's slides", () => {
    expect(describeSlides(slides)).toBe("Overview · Trend 2 · Breakdowns · Detail");
  });

  it("numbers the files so they sort in deck order", () => {
    expect(slides.map((s, i) => slideFileName(s, i))).toEqual([
      "01-overview.png",
      "02-trend-1.png",
      "03-trend-2.png",
      "04-breakdowns.png",
      "05-detail.png",
    ]);
  });
});
