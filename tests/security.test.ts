/**
 * Chart HTML-injection guard (src/ui/charts/options.ts).
 *
 * ECharts sets tooltip formatter output as innerHTML, and category, series,
 * measure and KPI names all come from the uploaded file (a generic KPI is
 * called "Total <column header>"). For every chart kind this builds options
 * from malicious names, then:
 *  - invokes every tooltip formatter with the params ECharts would pass
 *    (built from the option's own series data, per item or per axis index)
 *    and asserts the HTML has no live <img, <script or on…= handler while the
 *    names are still present, escaped;
 *  - invokes every other formatter (labels, axes, visual map, markers), which
 *    return plain text drawn on the canvas, to prove they run on such input;
 *  - renders the option with ECharts' SVG renderer (the vector export path,
 *    where label text becomes markup) and asserts the SVG is equally inert.
 * A second block runs the same checks on a crafted CSV taken through the real
 * engine (generic domain), so KPI names really embed the raw headers.
 */
import { describe, expect, it } from "vitest";
import type { EChartsCoreOption } from "echarts/core";
import echarts from "@/ui/charts/echarts-setup";
import { buildOption, escapeHtml } from "@/ui/charts/options";
import { readChartTokens } from "@/ui/charts/tokens";
import type { ChartData, ChartKind, ChartSpec } from "@/engine/charts/types";
import type { FormatOptions } from "@/engine/core/format";
import { Session } from "@/engine/session";

type Obj = Record<string, unknown>;
type Fn = (...args: unknown[]) => unknown;

const CAT = `Cat <img src=x onerror=alert('cat')>`;
const CAT2 = `Cat2 <script>alert('cat2')</script>`;
const SERIES = `Series <img src=x onerror=alert('series')>`;
const MEASURE = `Measure <script>alert('measure')</script>`;
/** What a generic-domain KPI over a crafted header is called. */
const KPI = `Total <img src=x onerror=alert('kpi')>`;
const ROWCAT = `Row <img src=x onerror=alert('row')>`;

/** Every chart kind; the type below fails to compile if a new kind is not listed here. */
const KINDS = [
  "line",
  "area",
  "bar",
  "hbar",
  "stackedBar",
  "donut",
  "treemap",
  "scatter",
  "histogram",
  "box",
  "heatmap",
  "funnel",
  "waterfall",
  "bullet",
  "cohort",
  "bump",
  "pareto",
  "geoTile",
  "table",
  "pie",
  "groupedBar",
  "stackedBar100",
  "stackedArea",
  "step",
  "lollipop",
  "dumbbell",
  "bubble",
  "radar",
  "gauge",
  "sunburst",
  "sankey",
  "calendar",
  "bigNumber",
] as const satisfies readonly ChartKind[];
type MissingKind = Exclude<ChartKind, (typeof KINDS)[number]>;
const allKindsListed: [MissingKind] extends [never] ? true : never = true;

const FMT: FormatOptions = { locale: "IN", currency: "INR" };
const TOKENS = readChartTokens();

/** The escaped form a name must take inside tooltip HTML (independent of the code under test). */
const escaped = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** No live markup: no <img or <script tag and no tag carrying an on…= event handler. */
function expectInert(markup: string, where: string): void {
  expect(markup, where).not.toMatch(/<img/i);
  expect(markup, where).not.toMatch(/<script/i);
  expect(markup, where).not.toMatch(/<[^>]*\bon[a-z]+\s*=/i);
}

function spec(kind: ChartKind, over: Partial<ChartSpec> = {}): ChartSpec {
  return {
    id: "evil",
    title: `Chart ${CAT}`,
    kind,
    section: "breakdown",
    x: { kind: "column", column: CAT, label: CAT },
    measures: [
      { id: "m1", label: KPI, format: "currency", direction: "higher" },
      { id: "m2", label: MEASURE, format: "number", direction: "higher" },
    ],
    reason: "test",
    alternatives: [],
    size: { w: 6, h: 4 },
    priority: 1,
    modes: ["analyst"],
    source: "generic",
    ...over,
  };
}

function chartData(over: Partial<ChartData> = {}): ChartData {
  return {
    specId: "evil",
    kind: "bar",
    categories: [
      { label: CAT, raw: CAT },
      { label: CAT2, raw: CAT2 },
      { label: "Plain", raw: "Plain" },
      { label: "Others", raw: "__others__", isOthers: true },
    ],
    series: [
      { id: "m1", label: KPI, values: [120, 80, 55, 30], format: "currency" },
      { id: "m2", label: SERIES, values: [4, 3, 2, 1], format: "number" },
    ],
    rows: [10, 8, 5, 3],
    totals: [285, 10],
    annotations: [
      { index: 0, kind: "max", label: `Peak · ${CAT}` },
      { index: 2, kind: "min", label: "Low" },
    ],
    caption: CAT,
    altText: `Chart of ${CAT}`,
    notes: [],
    empty: false,
    totalRows: 26,
    ...over,
  };
}

const oneSeries = (d: ChartData): ChartData => ({ ...d, series: d.series.slice(0, 1) });
const timeX: ChartSpec["x"] = { kind: "time", column: "Order Date", grain: "month", label: "Order Date" };
const timeCats = [Date.UTC(2024, 0, 1), Date.UTC(2024, 1, 1), Date.UTC(2024, 2, 1), Date.UTC(2024, 3, 1)].map(
  (t, i) => ({ label: i === 1 ? CAT : `M${i}`, raw: t }),
);

/** Data split by a second category, as the engine returns it: a matrix and one series per split value. */
function splitData(): ChartData {
  const seriesCategories = [
    { label: ROWCAT, raw: ROWCAT },
    { label: SERIES, raw: SERIES },
    { label: "Others", raw: "__others__", isOthers: true },
  ];
  const matrix = [
    [5, 4, 3, 2],
    [2, 2, 1, 1],
    [1, 1, 1, null],
  ];
  return chartData({
    seriesCategories,
    matrix,
    series: seriesCategories.map((c, i) => ({
      id: String(c.raw),
      label: c.label,
      values: matrix[i] as Array<number | null>,
      format: "currency" as const,
    })),
  });
}

interface Fixture {
  name: string;
  /** Kinds drawn without a tooltip (a big number is all text): the names are checked in the SVG instead. */
  noTooltip?: boolean;
  kind: ChartKind;
  spec: ChartSpec;
  data: ChartData;
  /** Names that must appear, escaped, in the tooltips. */
  names: string[];
}

const FIXTURES: Fixture[] = [
  // Cartesian kinds (and the kinds the cartesian builder draws) on a category axis, two series and one.
  ...(
    [
      "line",
      "area",
      "bar",
      "hbar",
      "stackedBar",
      "histogram",
      "box",
      "waterfall",
      "bullet",
      "bump",
      "groupedBar",
      "stackedBar100",
      "stackedArea",
      "step",
      "lollipop",
    ] as const
  ).flatMap((kind): Fixture[] => [
    { name: `${kind} · two series`, kind, spec: spec(kind), data: chartData(), names: [CAT, KPI, SERIES] },
    { name: `${kind} · one series`, kind, spec: spec(kind), data: oneSeries(chartData()), names: [CAT, KPI] },
  ]),
  // Time axes: peak/low markers, partial first and last buckets.
  ...(["line", "area", "bar"] as const).map((kind): Fixture => ({
    name: `${kind} · time axis`,
    kind,
    spec: spec(kind, { x: timeX }),
    data: oneSeries(
      chartData({ categories: timeCats, grain: "month", partialFirst: true, partialLast: true }),
    ),
    names: [CAT, KPI],
  })),
  {
    name: "stackedBar · segments",
    kind: "stackedBar",
    spec: spec("stackedBar", { series: { kind: "column", column: ROWCAT, label: ROWCAT } }),
    data: chartData({
      seriesCategories: [
        { label: ROWCAT, raw: ROWCAT },
        { label: SERIES, raw: SERIES },
        { label: "Others", raw: "__others__", isOthers: true },
      ],
      matrix: [
        [5, 4, 3, 2],
        [2, 2, 1, 1],
        [1, 1, 1, null],
      ],
    }),
    names: [CAT, ROWCAT, SERIES],
  },
  {
    name: "pareto",
    kind: "pareto",
    spec: spec("pareto", { analysis: "pareto" }),
    data: chartData({
      series: [
        { id: "share", label: KPI, values: [0.5, 0.3, 0.15, 0.05], format: "percent" },
        { id: "cum", label: SERIES, values: [0.5, 0.8, 0.95, 1], format: "percent" },
      ],
    }),
    names: [CAT, KPI, SERIES],
  },
  { name: "donut", kind: "donut", spec: spec("donut"), data: oneSeries(chartData()), names: [CAT, KPI] },
  { name: "pie", kind: "pie", spec: spec("pie"), data: oneSeries(chartData()), names: [CAT, KPI] },
  // Kinds that draw one series per value of a second category.
  ...(["line", "step", "stackedArea", "groupedBar", "stackedBar100", "radar"] as const).map(
    (kind): Fixture => ({
      name: `${kind} · split`,
      kind,
      spec: spec(kind, {
        series: { kind: "column", column: ROWCAT, label: ROWCAT },
        measures: [{ id: "m1", label: KPI, format: "currency", direction: "higher" }],
      }),
      data: splitData(),
      names: [CAT, ROWCAT, SERIES],
    }),
  ),
  {
    name: "dumbbell",
    kind: "dumbbell",
    spec: spec("dumbbell"),
    data: chartData(),
    names: [CAT, KPI, SERIES],
  },
  {
    name: "radar · measures",
    kind: "radar",
    spec: spec("radar", {
      measures: [
        { id: "m1", label: KPI, format: "currency", direction: "higher" },
        { id: "m2", label: MEASURE, format: "number", direction: "higher" },
        { id: "m3", label: ROWCAT, format: "number", direction: "higher" },
      ],
    }),
    data: chartData({
      series: [
        { id: "m1", label: KPI, values: [120, 80, 55, 30], format: "currency" },
        { id: "m2", label: MEASURE, values: [4, 3, 2, 1], format: "number" },
        { id: "m3", label: ROWCAT, values: [9, 7, 5, 3], format: "number" },
      ],
    }),
    names: [CAT, KPI, MEASURE, ROWCAT],
  },
  {
    name: "bubble",
    kind: "bubble",
    spec: spec("bubble", {
      measures: [
        { id: "m1", label: KPI, format: "currency", direction: "higher" },
        { id: "m2", label: MEASURE, format: "number", direction: "higher" },
        { id: "m3", label: ROWCAT, format: "number", direction: "higher" },
      ],
    }),
    data: chartData({
      points: [
        { label: CAT, x: 10, y: 4, size: 30 },
        { label: CAT2, x: 20, y: 7, size: 5 },
        { label: "Plain", x: 30, y: 9, size: null },
      ],
    }),
    names: [CAT, CAT2, KPI, MEASURE, ROWCAT],
  },
  {
    name: "sunburst",
    kind: "sunburst",
    spec: spec("sunburst"),
    data: chartData({
      tree: [
        {
          label: CAT,
          value: 70,
          children: [
            { label: ROWCAT, value: 40 },
            { label: CAT2, value: 30 },
          ],
        },
        { label: "Others", value: 10 },
      ],
    }),
    names: [CAT, ROWCAT, KPI],
  },
  {
    name: "sankey",
    kind: "sankey",
    spec: spec("sankey", {
      series: { kind: "column", column: ROWCAT, label: ROWCAT },
      measures: [{ id: "m1", label: KPI, format: "currency", direction: "higher" }],
    }),
    data: splitData(),
    names: [CAT, ROWCAT, KPI],
  },
  {
    name: "calendar",
    kind: "calendar",
    spec: spec("calendar", { x: { kind: "time", column: "Order Date", grain: "day", label: "Order Date" } }),
    data: oneSeries(
      chartData({
        categories: [0, 1, 2, 40].map((d) => ({
          label: `D${d}`,
          raw: Date.UTC(2024, 0, 1) + d * 86_400_000,
        })),
        grain: "day",
      }),
    ),
    names: [KPI],
  },
  {
    name: "gauge",
    kind: "gauge",
    spec: spec("gauge", { x: { kind: "none" }, target: 500 }),
    data: chartData({
      categories: [{ label: KPI, raw: "m1" }],
      series: [{ id: "m1", label: KPI, values: [420], format: "currency" }],
      rows: [26],
    }),
    names: [KPI],
  },
  {
    name: "bigNumber",
    kind: "bigNumber",
    noTooltip: true,
    spec: spec("bigNumber", { x: { kind: "none" }, target: 500 }),
    data: chartData({
      categories: [{ label: KPI, raw: "m1" }],
      series: [{ id: "m1", label: KPI, values: [420], format: "currency" }],
      rows: [26],
    }),
    names: [KPI],
  },
  {
    name: "treemap",
    kind: "treemap",
    spec: spec("treemap"),
    data: chartData({
      tree: [
        {
          label: CAT,
          value: 70,
          children: [
            { label: ROWCAT, value: 40 },
            { label: CAT2, value: 30 },
          ],
        },
        { label: "Others", value: 10 },
      ],
    }),
    names: [CAT, ROWCAT, KPI],
  },
  {
    name: "treemap · RFM",
    kind: "treemap",
    spec: spec("treemap", { analysis: "rfm" }),
    data: chartData({
      rfm: [
        {
          segment: CAT,
          customers: 120,
          customerShare: 0.6,
          revenue: 9000,
          revenueShare: 0.7,
          avgRecency: 12,
          avgFrequency: 3.2,
          avgMonetary: 75,
          action: CAT2,
        },
        {
          segment: ROWCAT,
          customers: 80,
          customerShare: 0.4,
          revenue: 3000,
          revenueShare: 0.3,
          avgRecency: 90,
          avgFrequency: 1.1,
          avgMonetary: 37,
          action: "Win back",
        },
      ],
    }),
    names: [CAT, ROWCAT],
  },
  {
    name: "heatmap",
    kind: "heatmap",
    spec: spec("heatmap", { series: { kind: "column", column: ROWCAT, label: ROWCAT } }),
    data: chartData({
      seriesCategories: [
        { label: ROWCAT, raw: ROWCAT },
        { label: SERIES, raw: SERIES },
      ],
      matrix: [
        [1, 2, null, 4],
        [5, null, 7, 8],
      ],
    }),
    names: [CAT, ROWCAT, KPI],
  },
  {
    name: "cohort",
    kind: "cohort",
    spec: spec("cohort", { analysis: "cohort", x: { kind: "none" } }),
    data: chartData({
      cohorts: [
        { cohort: Date.UTC(2024, 0, 1), label: CAT, size: 120, retention: [1, 0.4, 0.25] },
        { cohort: Date.UTC(2024, 1, 1), label: ROWCAT, size: 90, retention: [1, 0.35, null] },
      ],
    }),
    names: [CAT, ROWCAT],
  },
  {
    name: "funnel",
    kind: "funnel",
    spec: spec("funnel", { analysis: "funnel" }),
    data: chartData({
      funnel: [
        { label: CAT, value: 1000, fromPrev: null, fromFirst: 1 },
        { label: ROWCAT, value: 400, fromPrev: 0.4, fromFirst: 0.4 },
        { label: CAT2, value: 100, fromPrev: 0.25, fromFirst: 0.1 },
      ],
    }),
    names: [CAT, ROWCAT, CAT2],
  },
  {
    name: "geoTile",
    kind: "geoTile",
    spec: spec("geoTile", { geoRegion: "IN" }),
    data: oneSeries(
      chartData({
        categories: [
          { label: "MH", raw: "MH" },
          { label: "karnataka", raw: "karnataka" },
          { label: CAT, raw: CAT },
          { label: "Others", raw: "__others__", isOthers: true },
        ],
      }),
    ),
    names: [KPI],
  },
  {
    name: "scatter",
    kind: "scatter",
    spec: spec("scatter"),
    data: chartData({
      points: [
        { label: CAT, x: 10, y: 4 },
        { label: ROWCAT, x: 20, y: 7 },
        { label: CAT2, x: 30, y: 9 },
      ],
      trendline: { slope: 0.25, intercept: 1.7, r2: 0.97 },
    }),
    names: [CAT, ROWCAT, KPI, MEASURE],
  },
];

/** Every function under a `formatter` key, with its path in the option tree ("tooltip.formatter", "series.0.label.formatter"…). */
function formatters(node: unknown, path = ""): Array<{ path: string; fn: Fn }> {
  if (Array.isArray(node)) return node.flatMap((v, i) => formatters(v, `${path}.${i}`));
  if (!node || typeof node !== "object") return [];
  return Object.entries(node as Obj).flatMap(([k, v]) => {
    const p = path ? `${path}.${k}` : k;
    return k === "formatter" && typeof v === "function" ? [{ path: p, fn: v as Fn }] : formatters(v, p);
  });
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

/** Item params as ECharts builds them for one series: every data item (tree children included). */
function seriesParams(s: Obj, seriesIndex: number): Obj[] {
  const out: Obj[] = [];
  const walk = (items: unknown[], trail: Obj[]) =>
    items.forEach((d, dataIndex) => {
      const item = (d && typeof d === "object" && !Array.isArray(d) ? d : { value: d }) as Obj;
      const path = [...trail, { name: item.name }];
      out.push({
        componentType: "series",
        seriesType: s.type,
        seriesIndex,
        seriesName: s.name,
        dataIndex,
        name: item.name,
        value: item.value,
        data: d,
        color: "#3c79d1",
        percent: 12.5,
        treePathInfo: path,
      });
      walk(asArray(item.children), path);
    });
  walk(asArray(s.data), []);
  return out;
}

/** Params for a formatter at `path`: what ECharts would call it with. */
function paramsFor(path: string, option: Obj): unknown[] {
  const series = asArray(option.series) as Obj[];
  if (path.startsWith("tooltip")) {
    const items = series.flatMap((s, i) => seriesParams(s, i));
    if ((option.tooltip as Obj | undefined)?.trigger !== "axis") return items;
    // Axis trigger: one list per category index, across every series; plus a lone param (ECharts passes one for a hovered marker).
    const count = Math.max(0, ...series.map((s) => asArray(s.data).length));
    const lists = Array.from({ length: count }, (_, i) =>
      series.map((s, seriesIndex) => seriesParams(s, seriesIndex)[i]).filter(Boolean),
    );
    return [...lists, ...items];
  }
  const marker = /^series\.(\d+)\.markPoint/.exec(path);
  if (marker)
    return asArray((asArray(series[Number(marker[1])]?.markPoint) as Obj[])[0]?.data).map((d) => ({
      ...(d as Obj),
      componentType: "markPoint",
    }));
  const own = /^series\.(\d+)\./.exec(path);
  if (own) {
    const s = series[Number(own[1])];
    return s ? seriesParams(s, Number(own[1])) : [];
  }
  // Axis ticks and the visual map format plain numbers.
  return [0, 1234.5, 98_76_543];
}

/** Renders an option the way the SVG export does (ECharts' server-side SVG renderer, no DOM). */
function renderSvg(option: EChartsCoreOption): string {
  const chart = echarts.init(null, undefined, { renderer: "svg", ssr: true, width: 720, height: 420 });
  try {
    chart.setOption(option);
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}

/** Runs every check on one option; returns the tooltip HTML so callers can look for the escaped names. */
function checkOption(option: EChartsCoreOption, where: string, tooltip = true): string {
  const tree = option as Obj;
  const all = formatters(tree);
  let tooltips = "";
  for (const { path, fn } of all) {
    const params = paramsFor(path, tree);
    for (const p of params) {
      const out = fn(p);
      if (path.startsWith("tooltip")) {
        expect(typeof out, `${where}: ${path}`).toBe("string");
        expectInert(out as string, `${where}: ${path}`);
        tooltips += out as string;
      } else {
        // Canvas text: only has to be text. The SVG check below covers how it is serialised.
        expect(["string", "number"], `${where}: ${path}`).toContain(typeof out);
      }
    }
  }
  // Every chart has a tooltip, except an all-text one (a big number), which has none to inject into.
  expect(
    all.some((f) => f.path.startsWith("tooltip")),
    `${where}: has a tooltip formatter`,
  ).toBe(tooltip);
  // No rich-text styles anywhere, so label text can never be read as rich markup either.
  expect(
    JSON.stringify(tree, (k, v: unknown) => (typeof v === "function" ? undefined : v)),
    `${where}: rich`,
  ).not.toMatch(/"rich"/);
  expectInert(renderSvg(option), `${where}: SVG`);
  return tooltips;
}

describe("chart tooltips escape data-derived text", () => {
  it("lists every chart kind", () => {
    expect(allKindsListed).toBe(true);
    const covered = new Set(FIXTURES.map((f) => f.kind));
    expect(KINDS.filter((k) => k !== "table" && !covered.has(k))).toEqual([]);
  });

  it("escapeHtml neutralises markup and quotes", () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe(
      "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;",
    );
  });

  for (const f of FIXTURES) {
    it(`${f.name}: tooltips, labels and SVG output are inert`, () => {
      for (const animate of [true, false]) {
        const option = buildOption({
          tokens: TOKENS,
          fmt: FMT,
          kind: f.kind,
          spec: f.spec,
          data: f.data,
          highlight: CAT,
          animate,
          forExport: !animate,
        });
        expect(option, f.name).not.toBeNull();
        const html = checkOption(option as EChartsCoreOption, f.name, !f.noTooltip);
        if (f.noTooltip) {
          // All text, no tooltip: the names reach the SVG as escaped text.
          expect(html, `${f.name}: no tooltips`).toBe("");
          const svg = renderSvg(option as EChartsCoreOption);
          for (const name of f.names) expect(svg, `${f.name}: ${name} drawn`).toContain(name.slice(0, 5));
          expect(svg, `${f.name}: markup escaped`).toContain("&lt;img");
          continue;
        }
        expect(html, `${f.name}: tooltips were produced`).not.toBe("");
        for (const name of f.names) expect(html, `${f.name}: ${name} shown escaped`).toContain(escaped(name));
      }
    });
  }

  it("tables never reach ECharts", () => {
    expect(
      buildOption({
        tokens: TOKENS,
        fmt: FMT,
        kind: "table",
        spec: spec("table"),
        data: chartData(),
        animate: false,
      }),
    ).toBeNull();
  });
});

describe("a crafted CSV through the real engine", () => {
  // Raw headers and values carrying markup; the generic domain names its KPIs after the headers.
  const HEADER_AMOUNT = `<img src=x onerror=alert('amount')>`;
  const HEADER_SEGMENT = `<script>alert('segment')</script>`;
  const VALUES = [
    `<img src=x onerror=alert(1)>`,
    `<svg onload=alert(2)>`,
    `<script>alert(3)</script>`,
    `Plain`,
  ];
  const STATES = ["MH", "KA", "DL", "TN", "GJ"];
  const lines = [`Order Date,${HEADER_AMOUNT},${HEADER_SEGMENT},State,Units`];
  for (let i = 0; i < 240; i++) {
    const day = new Date(Date.UTC(2024, 0, 1) + i * 2 * 86_400_000).toISOString().slice(0, 10);
    lines.push(
      `${day},${(100 + ((i * 37) % 250)).toFixed(2)},${VALUES[i % VALUES.length]},${STATES[i % STATES.length]},${1 + (i % 4)}`,
    );
  }

  it("charts of every kind stay inert", async () => {
    const session = new Session();
    const load = await session.ingest(new Blob([lines.join("\n")]), "crafted.csv", {});
    expect(load.status).toBe("ok");
    const ctx = session.configure({ domainId: "generic", numberLocale: "IN", currency: null });
    // The premise: KPI names really carry the raw header.
    expect(ctx.kpis.some((k) => k.name.includes("<img"))).toBe(true);
    let html = "";
    let checked = 0;
    for (const s of ctx.charts) {
      // As the dashboard does: the data is computed for the kind being drawn.
      for (const kind of new Set([s.kind, ...s.alternatives])) {
        const data = session.chart([], { specId: s.id, kind }, "IN");
        if (!data || data.empty) continue;
        const option = buildOption({
          tokens: TOKENS,
          fmt: FMT,
          kind,
          spec: s,
          data,
          animate: false,
          forExport: true,
        });
        if (!option) continue;
        html += checkOption(option, `${s.id} as ${kind}`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3);
    // The crafted names did reach the tooltips, escaped.
    expect(html).toContain(escaped(VALUES[0] as string));
    expect(html).toContain("&lt;img src=x onerror=alert(&#39;amount&#39;)&gt;");
  });
});
