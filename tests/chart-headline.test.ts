/**
 * Chart takeaways (version 36.0): the one sentence under every chart's title,
 * and leading every figure in the slides and the PDF report, says what the
 * chart shows, from its own data. A trend compares complete periods only; a
 * share of the total is given only for a measure that adds up; a rate is
 * compared highest to lowest; "Others" never leads; where nothing can be
 * said honestly there is no sentence.
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

  it("uses the preposition a date part takes", () => {
    const s = spec("bar", { x: { kind: "part", column: "Date", part: "dow", label: "Weekday" } });
    const d = data(["Mon", "Sat"], [10, 30]);
    expect(chartHeadline(s, d, FMT, RATE)).toBe("Highest on Sat (₹30); lowest on Mon (₹10).");
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
