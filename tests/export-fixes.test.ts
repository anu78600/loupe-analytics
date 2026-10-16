/**
 * The Export step as the user left the dashboard, and files that say what is
 * true (the Export audit's fixes):
 *
 * - KPI values read as on the dashboard's cards ("1.75L leads", "₹5.37Cr"),
 *   in the slides and the report alike (ui/common/kpiFormat);
 * - the slides and the report draw the charts under their Customise titles
 *   and leave out a chart that can't be drawn (a hidden column, a deleted
 *   KPI), saying why (export/exportCharts);
 * - the SQL check names KPIs as the user renamed them, and kpis.sql's
 *   example query and view count match the views it holds;
 * - a measure that clashes with a column keeps an acronym: "Total MRR";
 * - the Power BI package follows the dashboard in its config (titles, chart
 *   types, the user's own charts and their measures), says "Industry", and
 *   builds into its model every column the Export step asked about;
 * - a DuckDB that can't be downloaded fails in seconds, in words, instead of
 *   spinning for ever.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { Session, type ContextRequest } from "@/engine/session";
import type { ChartData, ChartSpec } from "@/engine/charts/types";
import { customSpec } from "@/engine/charts/recommend";
import type { ExportContext } from "@/engine/export/context";
import { fingerprintOf, type LoupeConfig } from "@/engine/export/config";
import { datePartColumns } from "@/engine/export/readme";
import { totalOf } from "@/engine/export/names";
import { formatKpi, kpiCompact } from "@/ui/common/kpiFormat";
import { exportCharts } from "@/ui/workspace/export/exportCharts";
import { DuckDbUnavailableError, startWithin } from "@/lib/duckdb";

const IN = { locale: "IN", currency: "INR" } as const;

/** A configured e-commerce demo session. */
function demo(extra: Partial<ContextRequest> = {}): Session {
  const s = new Session();
  const load = s.ingestSample("ecommerce");
  if (load.status !== "ok") throw new Error("demo did not load");
  s.configure({ domainId: "ecommerce", numberLocale: "IN", currency: null, ...extra });
  return s;
}

/** The snapshot every export generator reads (private on Session). */
const exportContext = (s: Session): ExportContext =>
  (s as unknown as { exportContext(): ExportContext }).exportContext();

/** The files of a Power BI zip as text, by path inside its folder. */
function unzip(zip: Uint8Array): (path: string) => string {
  const files = unzipSync(zip);
  return (path) => strFromU8(files[`loupe-powerbi/${path}`] ?? new Uint8Array());
}

describe("KPI values as the dashboard's cards write them", () => {
  it("makes money compact always, counts from one lakh, and a rate never", () => {
    expect(formatKpi(174867, "integer", IN)).toBe("1.75L");
    expect(formatKpi(159204102, "integer", IN)).toBe("15.9Cr");
    expect(formatKpi(53654021, "currency", IN)).toBe("₹5.37Cr");
    expect(formatKpi(4500, "currency", IN)).toBe("₹4.5K");
    expect(formatKpi(95000, "integer", IN)).toBe("95,000");
    expect(formatKpi(-250000, "number", IN)).toBe("−2.5L");
    expect(formatKpi(0.423, "percent", IN)).toBe("42.3%");
    expect(formatKpi(null, "integer", IN)).toBe("—");
    expect(formatKpi(174867, "integer", { locale: "INTL", currency: "USD" })).toBe("175K");
    expect(kpiCompact("percent", 5e6)).toBe(false);
    expect(kpiCompact("currency", 12)).toBe(true);
  });
});

describe("the charts the slides and the report draw", () => {
  const s = demo({ hiddenColumns: ["Channel"] });
  const ctx = s.configure({
    domainId: "ecommerce",
    numberLocale: "IN",
    currency: null,
    hiddenColumns: ["Channel"],
  });
  const byChannel = customSpec({
    id: "custom_channel",
    title: "Net revenue by Channel",
    kind: "donut",
    x: { kind: "column", column: "Channel", label: "Channel" },
    measures: [{ id: "net_revenue", label: "Net revenue", format: "currency", direction: "higher" }],
  });
  const deletedKpi = customSpec({
    id: "custom_gone",
    title: "My KPI by courier",
    kind: "bar",
    x: { kind: "column", column: "Courier", label: "Courier" },
    measures: [{ id: "uk_deleted", label: "My KPI", format: "number", direction: "neutral" }],
  });
  const specs: ChartSpec[] = [...ctx.charts, byChannel, deletedKpi];
  const charts: Record<string, ChartData> = {};
  for (const spec of specs) {
    const data = s.chart([], { specId: spec.id, spec: spec.source === "custom" ? spec : undefined }, "IN");
    if (data) charts[spec.id] = data;
  }
  const out = exportCharts({
    widgets: [
      { id: "trend_revenue", w: 12 },
      { id: "revenue_by_category", w: 6, title: "  Category revenue  " },
      { id: "payment_mix", w: 6, hidden: true },
      { id: "trend_orders", w: 6 },
      { id: "custom_channel", w: 6 },
      { id: "custom_gone", w: 6 },
      { id: "rto_by_state", w: 6, kind: "bar" },
    ],
    specs,
    charts,
    mode: "executive",
  });

  it("draws the visible charts of the layout, in its order, under their Customise titles", () => {
    expect(out.charts.map((c) => c.spec.title)).toEqual([
      "Net revenue over time",
      "Category revenue",
      "RTO rate by state",
    ]);
    expect(out.charts[0]?.wide).toBe(true);
    // The chart type picked on the dashboard is the one drawn.
    expect(out.charts[2]?.kind).toBe("bar");
  });

  it("leaves out a chart that names a hidden column or a deleted KPI, and says why", () => {
    // The reason is the first sentence of the engine's own note on the chart.
    const firstSentence = (id: string) => /^.+?[.!?](?=\s|$)/.exec(charts[id]?.notes[0] ?? "")?.[0];
    expect(out.leftOut.map((c) => [c.title, c.why])).toEqual([
      ["Net revenue by Channel", `This chart uses "Channel", which you hid in Check & map.`],
      ["My KPI by courier", firstSentence("custom_gone")],
    ]);
    expect(out.leftOut[1]?.why).toBeTruthy();
  });
});

describe("the SQL check and kpis.sql say what is true", () => {
  it("names a renamed KPI as the user named it, in the check and in the example query", () => {
    const s = demo({ kpiRenames: { net_revenue: "Revenue kept" } });
    const bundle = s.verificationBundle();
    expect(bundle.queries.find((q) => q.id === "net_revenue")?.name).toBe("Revenue kept");
    const sql = s.exportSql();
    expect(sql).toContain(`2. Query any KPI view: SELECT * FROM "kpi_revenue_kept";`);
    expect(sql).not.toContain(`"kpi_net_revenue"`);
  });

  it("gives the first headline KPI's own view as the example, whatever the industry", () => {
    const s = new Session();
    const load = s.ingestSample("hr");
    if (load.status !== "ok") throw new Error("hr demo did not load");
    const ctx = s.configure({ domainId: "hr", numberLocale: "IN", currency: null });
    const first = ctx.selection.hero[0] as string;
    const view = `kpi_${(exportContext(s).names.measures.get(first) ?? first).toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    expect(s.exportSql()).toContain(`SELECT * FROM "${view}";`);
  });

  it("counts the KPI views the check verifies, and the helper views apart", () => {
    const s = demo();
    const sql = s.exportSql();
    const checked = s.verificationBundle().queries.length;
    const views = [...sql.matchAll(/^CREATE VIEW "(kpi_[^"]+)"/gm)].filter(
      (m) => !/_monthly(_base)?$/.test(m[1] as string),
    ).length;
    const helpers = [...sql.matchAll(/^-- ── .+ \(helper\) ─/gm)].length;
    expect(views - helpers).toBe(checked);
    expect(sql).toContain(
      `${checked} views, one per KPI, grouped by topic${helpers ? `, plus ${helpers} helper view${helpers === 1 ? "" : "s"}` : ""}`,
    );
  });
});

describe("measure names", () => {
  it("keeps an acronym or a name's own capitals after Total", () => {
    expect(totalOf("Revenue")).toBe("Total revenue");
    expect(totalOf("Net revenue")).toBe("Total net revenue");
    expect(totalOf("MRR")).toBe("Total MRR");
    expect(totalOf("A/B tests")).toBe("Total A/B tests");
    expect(totalOf("McDonald's sales")).toBe("Total McDonald's sales");
  });

  it("names the SaaS demo's MRR measure Total MRR in the model", () => {
    const s = new Session();
    const load = s.ingestSample("saas");
    if (load.status !== "ok") throw new Error("saas demo did not load");
    s.configure({ domainId: "saas", numberLocale: "IN", currency: null });
    const names = [...exportContext(s).names.measures.values()];
    expect(names).toContain("Total MRR");
    expect(s.exportDax()).toContain("[Total MRR]");
    expect(s.exportDax()).not.toMatch(/Total mRR/);
  });
});

describe("the Power BI package follows the dashboard", () => {
  const s = demo({ hiddenColumns: ["Payment Method"] });
  const ctx = s.configure({
    domainId: "ecommerce",
    numberLocale: "IN",
    currency: null,
    hiddenColumns: ["Payment Method"],
  });
  const discount = customSpec({
    id: "custom_discount",
    title: "Total Discount by Courier",
    kind: "bar",
    x: { kind: "column", column: "Courier", label: "Courier" },
    measures: [{ id: "agg:sum:Discount", label: "Total Discount", format: "currency", direction: "neutral" }],
  });
  const weekday = customSpec({
    id: "custom_ship_weekday",
    title: "Orders by ship weekday",
    kind: "bar",
    x: { kind: "part", column: "Ship Date", part: "dow", label: "Weekday" },
    measures: [{ id: "orders", label: "Orders", format: "integer", direction: "higher" }],
  });
  const refused = customSpec({
    id: "custom_payment",
    title: "Orders by payment method (mine)",
    kind: "bar",
    x: { kind: "column", column: "Payment Method", label: "Payment Method" },
    measures: [{ id: "orders", label: "Orders", format: "integer", direction: "higher" }],
  });
  const ids = [...ctx.charts.map((c) => c.id), discount.id, weekday.id, refused.id];
  const config: LoupeConfig = {
    app: "loupe",
    version: 1,
    createdAt: "2026-10-17T00:00:00.000Z",
    fingerprint: fingerprintOf("demo.csv", 1, []),
    domainId: "ecommerce",
    mappingOverrides: {},
    classOverrides: {},
    hiddenColumns: ["Payment Method"],
    customKpis: [],
    roleOverrides: {},
    kpiRenames: {},
    kpiTargets: {},
    dashboard: {
      mode: "analyst",
      widgets: [
        { id: "revenue_by_category", w: 6, h: 4, title: "Category revenue", kind: "donut" },
        { id: discount.id, w: 6, h: 4 },
        { id: weekday.id, w: 6, h: 4 },
        { id: refused.id, w: 6, h: 4 },
      ],
      customCharts: [discount, weekday, refused],
      datePreset: "all",
      filters: [],
    },
    settings: { numberLocale: "IN", currency: "INR" },
  };
  const pkg = s.exportPowerBi(JSON.stringify(config), ids);
  const text = unzip(pkg.zip);
  const readme = text("README.md");
  const table = text("Orders.SemanticModel/definition/tables/Orders.tmdl");

  it("lists the user's own charts and titles, with an ad-hoc value as a measure to add", () => {
    expect(readme).toMatch(/\*\*\d+\. Category revenue\*\*\n- Visual: Donut chart/);
    expect(readme).not.toContain("Net revenue by category**");
    expect(readme).toMatch(/\*\*\d+\. Total Discount by Courier\*\*/);
    expect(readme).toContain("- Values: [Total Discount] (a new measure: `Total Discount = SUM (");
    expect(readme).toMatch(/\*\*\d+\. Orders by ship weekday\*\*/);
  });

  it("leaves out a chart of the user's that names a hidden column", () => {
    expect(readme).not.toContain("Orders by payment method (mine)");
  });

  it("says Industry, not Domain", () => {
    expect(readme).toContain("Industry: **E-commerce");
    expect(readme).not.toContain("Domain:");
  });

  it("builds every column it asked about into the model", () => {
    const asked = pkg.manifest.newColumns.map((c) => c.name);
    expect(asked).toEqual([
      "order_date_day",
      "order_date_hour",
      "ship_date_weekday",
      "ship_date_weekday_number",
    ]);
    // The same list the Export step's question shows, for the same charts.
    expect(s.powerBiNewColumns(ids).map((c) => c.name)).toEqual(
      expect.arrayContaining(["order_date_day", "order_date_hour"]),
    );
    for (const name of asked) expect(table).toMatch(new RegExp(`^\\tcolumn ${name}$`, "m"));
    expect(table).toContain(
      `#"Added order_date_hour" = Table.AddColumn(WithDay, "order_date_hour", each if [order_date] = null then null else Time.Hour([order_date]), Int64.Type),`,
    );
    expect(table).toContain(`Text.Start(Date.DayOfWeekName([ship_date], "en-US"), 3)`);
    expect(table).toContain(`Date.DayOfWeek([ship_date], Day.Monday) + 1`);
    expect(table).toMatch(/column ship_date_weekday\n(\t\t.*\n)*?\t\tsortByColumn: ship_date_weekday_number/);
    expect(table).toMatch(/\tin\n\t+ {4}#"Added ship_date_weekday_number"\n/);
    // Path B says so; Path A still shows how to add them by hand.
    expect(readme).toContain(
      "The model already has the columns that Path A and the visual list below have you add by hand: `order_date_day`, `order_date_hour`, `ship_date_weekday`, `ship_date_weekday_number`.",
    );
    expect(readme).toContain("`order_date_hour = HOUR ( 'Orders'[order_date] )`");
  });

  it("adds none of them when the user says no", () => {
    const no = s.exportPowerBi(JSON.stringify(config), ids, true);
    expect(no.manifest.newColumns).toEqual([]);
    const noTable = unzip(no.zip)("Orders.SemanticModel/definition/tables/Orders.tmdl");
    expect(noTable).not.toMatch(/order_date_hour|ship_date_weekday|Table\.AddColumn/);
  });

  it("gives an added column a name no column or measure has", () => {
    const ec = exportContext(s);
    const taken = {
      ...ec,
      names: { ...ec.names, columns: new Map([...ec.names.columns, ["Order Date Hour", "order_date_hour"]]) },
    };
    expect(datePartColumns("Order Date", "hour", taken).map((c) => c.name)).toEqual(["order_date_hour_2"]);
  });
});

describe("starting DuckDB", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const worker = () => new EventTarget() as unknown as Worker;

  it("settles as the start does when it works or fails on its own", async () => {
    await expect(startWithin(Promise.resolve(7), worker(), 1000)).resolves.toBe(7);
    await expect(startWithin(Promise.reject(new Error("bad wasm")), worker(), 1000)).rejects.toThrow(
      "bad wasm",
    );
  });

  it("fails at once, in words, when the worker's script can't load", async () => {
    const w = worker();
    const start = startWithin(new Promise<void>(() => {}), w, 30_000);
    w.dispatchEvent(new Event("error"));
    await expect(start).rejects.toBeInstanceOf(DuckDbUnavailableError);
    await expect(start).rejects.toThrow(/couldn't be downloaded from cdn\.jsdelivr\.net/);
  });

  it("gives up after the timeout rather than waiting for ever", async () => {
    vi.useFakeTimers();
    const start = startWithin(new Promise<void>(() => {}), worker(), 30_000);
    const settled = expect(start).rejects.toBeInstanceOf(DuckDbUnavailableError);
    await vi.advanceTimersByTimeAsync(30_000);
    await settled;
  });
});
