/**
 * Chart takeaways (version 36.0): the one sentence under every chart's title,
 * and leading every figure in the slides and the PDF report, says what the
 * chart shows, from its own data. A trend compares complete periods only; a
 * share of the total is given only for a measure that adds up; a rate is
 * compared highest to lowest; "Others" never leads; where nothing can be
 * said honestly there is no sentence. Since the dashboard audit: a top-N
 * chart's lowest bar is the lowest "of those shown", a basket's first pair is
 * its strongest, a scatter says which way its link runs, daily and weekly
 * charts give their level and peak rather than comparing two single points,
 * and a 100% stack is read in shares.
 */
import { describe, expect, it } from "vitest";
import { chartHeadline, type HeadlineTraits } from "@/engine/charts/headline";
import { Session } from "@/engine/session";
import { SAMPLES } from "@/engine/samples/catalog";
import type { ChartData, ChartKind, ChartSpec } from "@/engine/charts/types";

const FMT = { locale: "IN" as const, currency: "INR" };
const SUM: HeadlineTraits = { additive: true, distinct: false };
const RATE: HeadlineTraits = { additive: false, distinct: false };
const MONTHS = ["Oct 2025", "Nov 2025", "Dec 2025"];

function spec(kind: ChartKind, over: Partial<ChartSpec> = {}): ChartSpec {
  return {
    id: "s",
    title: "t",
    kind,
    section: "breakdown",
    x: { kind: "column", column: "Category", label: "Category" },
    measures: [{ id: "m", label: "Revenue", format: "currency", direction: "higher" }],
    reason: "r",
    alternatives: [],
    size: { w: 6, h: 4 },
    priority: 1,
    modes: ["analyst"],
    source: "domain",
    ...over,
  };
}

function data(labels: string[], values: Array<number | null>, over: Partial<ChartData> = {}): ChartData {
  return {
    specId: "s",
    kind: "bar",
    categories: labels.map((label) => ({ label, raw: label })),
    series: [{ id: "m", label: "Revenue", values, format: "currency" }],
    rows: labels.map(() => 10),
    totals: [null],
    annotations: [],
    caption: "",
    altText: "",
    notes: [],
    empty: false,
    totalRows: 10 * labels.length,
    ...over,
  };
}

const overTime = (kind: ChartKind = "line") =>
  spec(kind, { section: "trend", x: { kind: "time", column: "Date", grain: "month", label: "Date" } });

describe("a trend", () => {
  it("compares the first and last periods and says where the peak is", () => {
    expect(chartHeadline(overTime(), data(MONTHS, [100, 90, 120], { kind: "line" }), FMT, SUM)).toMatch(
      /^Up 20\.0% from Oct 2025 to Dec 2025, ending at its peak of ₹120\.$/,
    );
    expect(chartHeadline(overTime(), data(MONTHS, [120, 90, 100], { kind: "line" }), FMT, SUM)).toMatch(
      /^Down 16\.7% from its peak of ₹120 in Oct 2025 to ₹100 in Dec 2025\.$/,
    );
    expect(chartHeadline(overTime(), data(MONTHS, [100, 130, 110], { kind: "line" }), FMT, SUM)).toMatch(
      /^Up 10\.0% from Oct 2025 to Dec 2025; peak ₹130 in Nov 2025\.$/,
    );
  });

  it("never reads an incomplete last period as a fall", () => {
    const d = data(MONTHS, [100, 120, 30], { kind: "line", partialLast: true });
    expect(chartHeadline(overTime(), d, FMT, SUM)).toMatch(/^Up 20\.0% from Oct 2025 to Nov 2025/);
  });

  it("gives a rate's change in percentage points", () => {
    const d = data(MONTHS, [0.1, 0.12, 0.08], { kind: "line" });
    d.series[0] = { ...d.series[0]!, format: "percent" };
    expect(chartHeadline(overTime(), d, FMT, RATE)).toMatch(
      /^Down 2\.0 pp from Oct 2025 to Dec 2025; peak 12/,
    );
  });

  it("calls a change under half a percent flat", () => {
    const d = data(MONTHS, [100, 100.2, 100.1], { kind: "line" });
    expect(chartHeadline(overTime(), d, FMT, SUM)).toMatch(/^Flat at about /);
  });

  it("says nothing with fewer than two complete periods", () => {
    const d = data(MONTHS.slice(0, 2), [100, 30], { kind: "line", partialLast: true });
    expect(chartHeadline(overTime(), d, FMT, SUM)).toBeNull();
  });

  it("gives a stacked chart's make-up in its latest complete period", () => {
    const s = overTime("stackedBar");
    const d = data(["Aug 2026", "Sep 2026"], [60, 49], {
      kind: "stackedBar",
      series: [
        { id: "a", label: "New customers", values: [60, 49], format: "integer" },
        { id: "b", label: "Returning customers", values: [40, 51], format: "integer" },
      ],
    });
    expect(chartHeadline(s, d, FMT, SUM)).toBe("In Sep 2026, returning customers made up 51% of the total.");
  });
});

describe("a breakdown", () => {
  it("gives the leader's share of the total for a measure that adds up", () => {
    const d = data(["Apparel", "Footwear", "Beauty"], [50, 30, 20], { totals: [100] });
    expect(chartHeadline(spec("hbar"), d, FMT, SUM)).toBe("Apparel leads with ₹50, 50% of the total.");
  });

  it("compares a rate highest to lowest, with no share", () => {
    const d = data(["COD", "UPI", "Wallet"], [0.163, 0.022, 0.019], { totals: [0.08] });
    d.series[0] = { ...d.series[0]!, format: "percent" };
    const h = chartHeadline(spec("bar"), d, FMT, RATE);
    expect(h).toMatch(/^COD is highest at 16\.3%; Wallet is lowest at 1\.9%\.$/);
    expect(h).not.toContain("of the total");
  });

  it("never names Others as the leader", () => {
    const d = data(["Apparel", "Footwear", "Others"], [50, 30, 90], { totals: [170] });
    d.categories[2] = { label: "Others", raw: "__others__", isOthers: true };
    expect(chartHeadline(spec("hbar"), d, FMT, SUM)).toMatch(/^Apparel leads with/);
  });

  it("gives a donut's largest share of the slices it draws", () => {
    const d = data(["COD", "UPI", "Others"], [43, 32, 25], { kind: "donut" });
    d.categories[2] = { label: "Others", raw: "__others__", isOthers: true };
    expect(chartHeadline(spec("donut"), d, FMT, SUM)).toBe("COD is the largest share, at 43%.");
  });

  it("names only the first row of a table", () => {
    const d = data(["Sneakers", "Kurta"], [2_000_000, 1_600_000], { kind: "table", totals: [32_000_000] });
    expect(chartHeadline(spec("table"), d, FMT, SUM)).toBe(
      "Sneakers leads on revenue with ₹20L, 6% of the total.",
    );
  });

  it("uses the preposition a date part takes, and spells weekdays in full", () => {
    const s = spec("bar", { x: { kind: "part", column: "Date", part: "dow", label: "Weekday" } });
    const d = data(["Mon", "Sat"], [10, 30]);
    expect(chartHeadline(s, d, FMT, RATE)).toBe("Highest on Saturday (₹30); lowest on Monday (₹10).");
  });

  it("names the measure when the chart has several", () => {
    const d = data(["North", "South"], [10, 30], {
      series: [
        { id: "a", label: "Revenue", values: [10, 30], format: "currency" },
        { id: "b", label: "Cost", values: [5, 8], format: "currency" },
      ],
    });
    expect(chartHeadline(spec("groupedBar"), d, FMT, RATE)).toMatch(/^Revenue: south is highest at ₹30/i);
  });

  it("says nothing for an empty chart or a single-number one", () => {
    expect(chartHeadline(spec("bar"), data([], [], { empty: true }), FMT, SUM)).toBeNull();
    expect(chartHeadline(spec("bigNumber"), data(["All"], [5], { kind: "bigNumber" }), FMT, SUM)).toBeNull();
  });
});

describe("what a takeaway may claim (dashboard audit)", () => {
  it("calls the lowest of a top-N chart the lowest of those shown", () => {
    const d = data(["Jammu and Kashmir", "Uttarakhand", "Andhra Pradesh"], [0.204, 0.174, 0.095]);
    d.series[0] = { ...d.series[0]!, format: "percent" };
    const cut = { ...RATE, groups: { shown: 12, total: 24, rankedByValue: true } };
    expect(chartHeadline(spec("hbar"), d, FMT, cut)).toBe(
      "Jammu and Kashmir is highest at 20.4%; Andhra Pradesh is lowest of the 12 shown, at 9.5%.",
    );
    // Groups picked some other way than by this measure: the highest is only of those shown too.
    const byRows = { ...RATE, groups: { shown: 12, total: 24, rankedByValue: false } };
    expect(chartHeadline(spec("hbar"), d, FMT, byRows)).toMatch(
      /^Jammu and Kashmir is highest of the 12 shown/,
    );
    // Every group drawn: no qualifier.
    expect(chartHeadline(spec("hbar"), d, FMT, RATE)).toMatch(/Andhra Pradesh is lowest at 9\.5%\.$/);
  });

  it("names a basket's strongest pairing by lift, not as the most frequent", () => {
    const d = data([], [], {
      kind: "table",
      basket: {
        pairs: [
          {
            a: "Charger",
            b: "Earbuds",
            orders: 19,
            support: 0.001,
            confidenceAB: 0.2,
            confidenceBA: 0.1,
            lift: 5.8,
          },
          {
            a: "Kurta",
            b: "Jeans",
            orders: 29,
            support: 0.002,
            confidenceAB: 0.1,
            confidenceBA: 0.1,
            lift: 1.4,
          },
        ],
        level: "product",
        orders: 100,
        multiItemOrders: 40,
      },
    });
    expect(chartHeadline(spec("table"), d, FMT, SUM)).toBe(
      "Strongest pairing: Charger with Earbuds, bought together 5.8× more often than chance (19 orders).",
    );
  });

  it("says which way a scatter's link runs, and nothing without a fit", () => {
    const s = spec("scatter", {
      measures: [
        { id: "e", label: "Average engagement score", format: "decimal", direction: "higher" },
        { id: "a", label: "Attrition rate", format: "percent", direction: "lower" },
      ],
    });
    const pts = { kind: "scatter" as const, points: [{ label: "A", x: 1, y: 2 }] };
    const fall = data(["A"], [1], { ...pts, trendline: { slope: -0.06, intercept: 4.7, r2: 0.53 } });
    expect(chartHeadline(s, fall, FMT, RATE)).toBe(
      "Attrition rate falls as average engagement score rises (R² 0.53).",
    );
    const rise = data(["A"], [1], { ...pts, trendline: { slope: 0.4, intercept: 0, r2: 0.31 } });
    expect(chartHeadline(s, rise, FMT, RATE)).toBe(
      "Attrition rate tends to rise with average engagement score, loosely (R² 0.31).",
    );
    const none = data(["A"], [1], { ...pts, trendline: { slope: NaN, intercept: NaN, r2: NaN } });
    expect(chartHeadline(s, none, FMT, RATE)).toBeNull();
  });

  it("never compares two single days or weeks: the level and the peak instead", () => {
    const days = ["1 Sep", "2 Sep", "3 Sep", "4 Sep"];
    const s = spec("bar", {
      section: "trend",
      x: { kind: "time", column: "Date", grain: "auto", label: "Date" },
    });
    const d = data(days, [100, 300, 250, 130], { kind: "bar", grain: "day" });
    expect(chartHeadline(s, d, FMT, SUM)).toBe("₹195 a day on average; peak ₹300 on 2 Sep.");
    const weeks = ["Wk of 6 Apr", "Wk of 13 Apr", "Wk of 20 Apr"];
    const w = data(weeks, [0.2, 0.25, 0.22], { kind: "line", grain: "week" });
    w.series[0] = { ...w.series[0]!, format: "percent" };
    expect(chartHeadline(s, w, FMT, RATE)).toBe(
      "Ranges from 20.0% in the week of 6 Apr to 25.0% in the week of 13 Apr.",
    );
  });

  it("groups the digits of a large change and says 'in' a month", () => {
    const d = data(MONTHS, [10_000, 50_000, 204_100], { kind: "line" });
    expect(chartHeadline(overTime(), d, FMT, SUM)).toMatch(/^Up 1,941% from Oct 2025 to Dec 2025/);
    const peaked = data(MONTHS, [100, 300, 200], { kind: "line" });
    expect(chartHeadline(overTime(), peaked, FMT, SUM)).toMatch(/peak ₹300 in Nov 2025\.$/);
  });

  it("reads a 100% stack in shares of each column", () => {
    const d = data(["Sales", "Engineering"], [], {
      kind: "stackedBar100",
      seriesCategories: [
        { label: "Female", raw: "Female" },
        { label: "Male", raw: "Male" },
      ],
      matrix: [
        [30, 81],
        [70, 176],
      ],
    });
    const s = spec("stackedBar100", { series: { kind: "column", column: "Gender", label: "Gender" } });
    expect(chartHeadline(s, d, FMT, SUM)).toBe("The largest share is Male in Sales, at 70%.");
  });

  it("spells out a weekday and an hour in a heatmap's sentence", () => {
    const hours = ["19:00", "20:00"];
    const d = data(hours, [], {
      kind: "heatmap",
      categories: hours.map((label, i) => ({ label, raw: 19 + i })),
      seriesCategories: [
        { label: "Sat", raw: 5 },
        { label: "Sun", raw: 6 },
      ],
      matrix: [
        [120, 200],
        [150, 264],
      ],
    });
    d.series = [];
    const s = spec("heatmap", {
      x: { kind: "part", column: "Order Date", part: "hour", label: "Hour of day" },
      series: { kind: "part", column: "Order Date", part: "dow", label: "Weekday" },
      measures: [{ id: "m", label: "Orders", format: "integer", direction: "higher" }],
    });
    expect(chartHeadline(s, d, FMT, SUM)).toBe("Highest on Sunday at 20:00 (264).");
  });

  it("keeps a share under 1% from reading as 0%", () => {
    const d = data([], [], {
      kind: "funnel",
      funnel: [
        { label: "Impressions", value: 100_000, fromPrev: null, fromFirst: null },
        { label: "Conversions", value: 300, fromPrev: 0.003, fromFirst: 0.003 },
      ],
    });
    expect(chartHeadline(spec("bar", { analysis: "funnel" }), d, FMT, SUM)).toBe(
      "Conversions are 0.3% of impressions.",
    );
  });
});

describe("every demo", () => {
  it("gives every chart with something to say a one-sentence takeaway", () => {
    const missing: string[] = [];
    let said = 0;
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
      for (const c of ctx.charts) {
        const d = out.charts[c.id];
        if (!d || d.empty || ["bigNumber", "gauge", "bullet"].includes(d.kind)) continue;
        if (!d.headline) {
          missing.push(`${sample.id}/${c.id} (${d.kind})`);
          continue;
        }
        // One sentence, ending in a full stop, with no unformatted value in it.
        expect(d.headline, `${sample.id}/${c.id}`).toMatch(/^[^\n]+\.$/);
        expect(d.headline, `${sample.id}/${c.id}`).not.toMatch(/NaN|undefined|null|Infinity/);
        said++;
      }
    }
    expect(missing).toEqual([]);
    // Every demo's dashboard was read, not an empty list.
    expect(said).toBeGreaterThan(SAMPLES.length * 8);
  });
});
