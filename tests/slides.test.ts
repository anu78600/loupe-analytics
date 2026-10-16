/**
 * Presentation slides (version 36.0): the deck is planned before it is drawn,
 * so the Export card can say how many landscape images the dashboard takes.
 * An overview first; then each section's charts in dashboard order, a wide
 * chart alone and the others in pairs, one row a slide for presenting or two
 * for a compact deck; a table or a cohort grid on a slide of its own; files
 * numbered so they sort in deck order.
 */
import { describe, expect, it } from "vitest";
import { describeSlides, planSlides, slideFileName, type Slide } from "@/ui/workspace/export/slidePlan";
import type { ReportChart } from "@/ui/workspace/export/report";
import type { ChartData, ChartKind, ChartSection, ChartSpec } from "@/engine/charts/types";

function chart(id: string, section: ChartSection, kind: ChartKind = "bar", over: Partial<ReportChart> = {}) {
  const spec = { id, title: id, kind, section } as unknown as ChartSpec;
  const data = { specId: id, kind, empty: false } as unknown as ChartData;
  return { spec, data, kind, ...over } satisfies ReportChart;
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
