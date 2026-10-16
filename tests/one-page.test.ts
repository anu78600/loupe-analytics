/**
 * The one-page dashboard (version 37.0): what fits on one landscape page. The
 * main trend leads across two thirds of the width with a share of the whole
 * beside it, then three breakdowns about different things; the charts chosen
 * for executives come first; tables, cohorts and hidden or empty charts stay
 * off the page. Also the words around it: subtitle, title, KPI icons, slicer
 * values and calendar years.
 */
import { describe, expect, it } from "vitest";
import {
  defaultPageTitle,
  kpiIconName,
  pageKpiIds,
  pageSubtitle,
  pickPageCharts,
  placeCharts,
  slicerValue,
  yearOf,
  yearRange,
  yearsIn,
  type PageWidget,
} from "@/ui/workspace/dashboard/page/pagePlan";
import { Session } from "@/engine/session";
import { SAMPLES } from "@/engine/samples/catalog";
import type { ChartData, ChartKind, ChartSection, ChartSpec, ResolvedAxis } from "@/engine/charts/types";

const TIME: ResolvedAxis = { kind: "time", column: "Date", grain: "month", label: "Date" };
const col = (column: string): ResolvedAxis => ({ kind: "column", column, label: column });

function spec(
  id: string,
  kind: ChartKind,
  x: ResolvedAxis,
  over: { section?: ChartSection; exec?: boolean } = {},
): ChartSpec {
  return {
    id,
    title: id,
    kind,
    section: over.section ?? "breakdown",
    x,
    measures: [{ id: "m", label: "Revenue", format: "currency", direction: "higher" }],
    reason: "",
    alternatives: [],
    size: { w: 6, h: 4 },
    priority: 1,
    modes: over.exec === false ? ["analyst"] : ["executive", "analyst", "compact"],
    source: "domain",
  };
}

const data = (over: Partial<ChartData> = {}): ChartData => ({
  specId: "s",
  kind: "bar",
  categories: [{ label: "A", raw: "A" }],
  series: [{ id: "m", label: "Revenue", values: [1], format: "currency" }],
  rows: [1],
  totals: [1],
  annotations: [],
  caption: "",
  altText: "",
  notes: [],
  empty: false,
  totalRows: 1,
  ...over,
});

function pick(specs: ChartSpec[], widgets?: PageWidget[], charts?: Record<string, ChartData>) {
  const ws = widgets ?? specs.map((s) => ({ id: s.id }));
  const cs = charts ?? Object.fromEntries(specs.map((s) => [s.id, data()]));
  return pickPageCharts(ws, specs, cs).map((c) => c.spec.id);
}

describe("which charts go on the page", () => {
  const specs = [
    spec("byCategory", "hbar", col("Category")),
    spec("share", "donut", col("Channel")),
    spec("trend", "line", TIME, { section: "trend" }),
    spec("byState", "geoTile", col("State")),
    spec("byCategory2", "bar", col("Category")),
    spec("byPayment", "bar", col("Payment")),
    spec("table", "table", col("Product"), { section: "detail" }),
  ];

  it("leads with the trend, then a share of the whole, then breakdowns about new things", () => {
    expect(pick(specs)).toEqual(["trend", "share", "byCategory", "byState", "byPayment"]);
  });

  it("puts the charts chosen for executives first", () => {
    const s = [
      spec("a", "bar", col("A"), { exec: false }),
      spec("b", "bar", col("B")),
      spec("t", "line", TIME),
    ];
    expect(pick(s)).toEqual(["t", "b", "a"]);
  });

  it("leaves out hidden, empty, table-like and off-page charts", () => {
    const s = [
      spec("trend", "line", TIME, { section: "trend" }),
      spec("hidden", "bar", col("A")),
      spec("empty", "bar", col("B")),
      spec("cohort", "cohort", TIME),
      spec("basket", "bar", col("C")),
      spec("cols", "bar", col("D"), { section: "columns" }),
      spec("ok", "bar", col("E")),
    ];
    const charts = {
      ...Object.fromEntries(s.map((x) => [x.id, data()])),
      empty: data({ empty: true }),
      basket: data({ basket: { pairs: [], level: "x", orders: 0, multiItemOrders: 0 } }),
    };
    const widgets = s.map((x) => ({ id: x.id, hidden: x.id === "hidden" }));
    expect(pick(s, widgets, charts)).toEqual(["trend", "ok"]);
  });

  it("uses the kind and title the user chose", () => {
    const s = [spec("trend", "line", TIME), spec("b", "bar", col("B"))];
    const out = pickPageCharts([{ id: "trend" }, { id: "b", kind: "donut", title: "  My split " }], s, {
      trend: data(),
      b: data(),
    });
    expect(out[1]).toMatchObject({ kind: "donut", title: "My split" });
  });
});

describe("where they sit", () => {
  const c = (id: string) => ({
    spec: spec(id, "bar", col(id)),
    data: data(),
    kind: "bar" as const,
    title: id,
  });
  const layout = (n: number) =>
    placeCharts(Array.from({ length: n }, (_, i) => c(`c${i}`))).map((p) => `${p.span}${p.tall ? "T" : ""}`);

  it("puts the lead across two thirds, its companion beside it, and shares the second row", () => {
    expect(layout(5)).toEqual(["4", "2", "2", "2", "2"]);
    expect(layout(4)).toEqual(["4", "2", "3", "3"]);
    expect(layout(3)).toEqual(["4", "2", "6"]);
    expect(layout(2)).toEqual(["4T", "2T"]);
    expect(layout(1)).toEqual(["6T"]);
    expect(layout(0)).toEqual([]);
  });
});

describe("the words around the page", () => {
  it("tops up the KPI row from the supporting KPIs, without repeats", () => {
    expect(pageKpiIds(["a", "b", "c", "d"], ["b", "e", "f", "g"])).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("says what the page covers from its KPIs' groups", () => {
    expect(
      pageSubtitle(["Revenue", "Revenue", "Orders", "Profitability", "Fulfilment", "Customers"], "x"),
    ).toBe("Revenue | Orders | Profitability | Fulfilment");
    expect(pageSubtitle(["Revenue", "Revenue"], "Orders & transactions")).toBe("Orders & transactions");
  });

  it("titles the page as an analyst would", () => {
    expect(defaultPageTitle("E-commerce", { generic: false, roster: false })).toBe(
      "E-commerce performance dashboard",
    );
    expect(defaultPageTitle("HR & People", { generic: false, roster: true })).toBe("HR & People dashboard");
    expect(defaultPageTitle("Generic", { generic: true, roster: false })).toBe("Performance dashboard");
  });

  it("gives each KPI an icon for its kind of measure", () => {
    const icon = (name: string, format: "currency" | "percent" | "integer" | "days" = "integer") =>
      kpiIconName({ name, format });
    expect(icon("Net revenue", "currency")).toBe("money");
    expect(icon("Orders")).toBe("orders");
    expect(icon("Customers")).toBe("people");
    expect(icon("Return rate", "percent")).toBe("returns");
    expect(icon("RTO rate", "percent")).toBe("returns");
    expect(icon("Gross margin %", "percent")).toBe("profit");
    expect(icon("Average order value", "currency")).toBe("average");
    expect(icon("Attrition rate", "percent")).toBe("loss");
    expect(icon("Average salary", "currency")).toBe("pay");
    expect(icon("Return on ad spend", "percent")).toBe("profit");
    expect(icon("Conversions")).toBe("conversion");
    expect(icon("Net revenue retention", "percent")).toBe("retention");
    expect(icon("Something else", "percent")).toBe("percent");
    expect(icon("Something else", "days")).toBe("time");
  });

  it("shows a slicer's selection the way a report page does", () => {
    expect(slicerValue([])).toBe("All");
    expect(slicerValue(undefined)).toBe("All");
    expect(slicerValue(["Apparel"])).toBe("Apparel");
    expect(slicerValue(["Apparel", "Footwear"])).toBe("Apparel, Footwear");
    expect(slicerValue(["a", "b", "c"])).toBe("3 selected");
  });

  it("offers the calendar years in the data and knows a range that is one", () => {
    const bounds = { min: Date.UTC(2024, 9, 1), max: Date.UTC(2026, 8, 30) };
    expect(yearsIn(bounds)).toEqual([2026, 2025, 2024]);
    expect(yearOf(yearRange(2025))).toBe(2025);
    expect(yearOf({ from: Date.UTC(2025, 0, 1), to: Date.UTC(2025, 5, 30) })).toBeNull();
    expect(yearOf(null)).toBeNull();
  });
});

describe("every demo", () => {
  it("fills a page with a lead chart over time and charts that read at a glance", () => {
    for (const sample of SAMPLES) {
      const s = new Session();
      const load = s.ingestSample(sample.id);
      if (load.status !== "ok") throw new Error(load.status);
      const top = load.detection.candidates[0];
      if (!top) throw new Error(`${sample.id}: not detected`);
      const ctx = s.configure({ domainId: top.domainId, numberLocale: "IN", currency: null });
      const out = s.computeDashboard({
        filters: [],
        kpiIds: [],
        charts: ctx.charts.map((c) => ({ specId: c.id })),
        numberLocale: "IN",
      });
      const page = pickPageCharts(
        ctx.charts.map((c) => ({ id: c.id })),
        ctx.charts,
        out.charts,
      );
      expect(page.length, sample.id).toBeGreaterThanOrEqual(3);
      // A dashboard over time leads with a trend; a roster may have none.
      if (ctx.charts.some((c) => c.x.kind === "time" && c.section === "trend"))
        expect(page[0]?.spec.x.kind, sample.id).toBe("time");
      for (const c of page) {
        expect(["table", "cohort", "heatmap", "calendar"], `${sample.id}/${c.spec.id}`).not.toContain(c.kind);
        expect(c.data.empty, `${sample.id}/${c.spec.id}`).toBe(false);
      }
    }
  });
});
