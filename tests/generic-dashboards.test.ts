/**
 * Dashboards for tables no industry fits (version 44.0): the generic
 * fallback reads what the table is (detect/tableShape.ts) and builds KPIs
 * and charts that suit its shape (detect/generic.ts).
 *
 * Small realistic tables, one per shape, check the description, the KPI set
 * and the chart set: a time series never adds a temperature across dates, a
 * panel reads each country on its latest year, a survey counts the top two
 * boxes and works out NPS, a practice table gives its outcome rate and
 * averages its features, an event log counts events and users, a lookup
 * table counts what its attributes span. Every figure checked here is
 * worked out from the generator's own rows.
 *
 * Then a sweep over every benchmark layout no industry fits
 * (tests/fixtures/benchmark, `expect: null`): each gets a description, at
 * least 3 KPIs and 4 charts, SQL and DAX for every KPI, no sum of a column
 * that is never added up, and the engine's values back from DuckDB.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import { Session, type ContextResult } from "@/engine/session";
import type { ExportContext } from "@/engine/export/context";
import { fieldsOf, type Expr } from "@/engine/query/expr";
import { describeTable } from "@/engine/detect/tableShape";
import { profileDataset } from "@/engine/profile/profile";
import { close, loadIntoDuckDB, scalar } from "./helpers/duck";
import { expandFixture, parseCsv, type LayoutSpec } from "./helpers/layouts";

type Cell = string | number;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const csvOf = (rows: Cell[][]) =>
  rows
    .map((r) =>
      r
        .map((c) => (typeof c === "string" && /[,"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : String(c)))
        .join(","),
    )
    .join("\n");

const connections: DuckDBConnection[] = [];
afterAll(() => connections.forEach(close));

/** A session configured with the generic domain over `rows`. */
async function generic(rows: Cell[][], name: string, hiddenColumns: string[] = []) {
  const s = new Session();
  const load = await s.ingest(new Blob([csvOf(rows)]), `${name}.csv`, {});
  if (load.status !== "ok") throw new Error(`${name}: ${load.status}`);
  const ctx = s.configure({ domainId: "generic", numberLocale: "INTL", currency: null, hiddenColumns });
  return { s, ctx };
}

/** The KPIs a dashboard shows (hero, supporting and the column KPIs). */
const shownKpis = (ctx: ContextResult) =>
  [...ctx.selection.hero, ...ctx.selection.supporting, ...ctx.selection.columns].map(
    (id) => ctx.kpis.find((k) => k.id === id) as ContextResult["kpis"][number],
  );

/** Engine values of KPIs by name, over the whole file. */
function values(s: Session, ctx: ContextResult): Map<string, number | null> {
  const ids = ctx.kpis.filter((k) => k.available).map((k) => k.id);
  const batch = s.kpiBatch([], ids, "INTL");
  return new Map(
    batch.values.map(
      (v) => [ctx.kpis.find((k) => k.id === v.id)?.name ?? v.id, v.value] as [string, number | null],
    ),
  );
}

/** Every KPI that sums a column the profile says is never added up (a rate, a price, an age). */
function sumsOfNonAdditive(ec: ExportContext): string[] {
  const bad: string[] = [];
  const walk = (id: string, e: Expr) => {
    if ("agg" in e && e.agg === "sum")
      for (const f of fieldsOf(e.of)) {
        const column = ec.mapping.fields[f] ?? f.replace(/^col:/, "");
        const c = ec.profile.columns.find((x) => x.name === column);
        if (c && (c.additivity === "non-additive" || c.role === "rate" || c.role === "percentage"))
          bad.push(`${id} sums ${column}`);
      }
    if ("op" in e) e.args.forEach((a) => walk(id, a));
    if ("calc" in e) walk(id, e.calc);
    if ("atLatest" in e) walk(id, e.expr);
    if ("per" in e) walk(id, e.inner);
  };
  for (const r of ec.res.values()) if (r.available && r.variant) walk(r.def.id, r.variant.expr);
  return bad;
}

/** Runs every KPI's SQL in DuckDB and returns the mismatches with the engine's whole-file values. */
async function duckMismatches(s: Session, limit = Infinity): Promise<string[]> {
  const ec = (s as unknown as { exportContext(): ExportContext }).exportContext();
  const bundle = s.verificationBundle();
  const conn = await loadIntoDuckDB(ec.ds, bundle.table, ec.names.columns);
  connections.push(conn);
  const out: string[] = [];
  for (const q of bundle.queries.slice(0, limit)) {
    const got = await scalar(conn, q.sql);
    const want = q.engine ?? NaN;
    const same =
      (Number.isNaN(got) && Number.isNaN(want)) || Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want));
    if (!same) out.push(`${q.id}: DuckDB ${got} vs engine ${want}`);
  }
  return out;
}

/** Every chart's data, computed the way the dashboard does. */
function chartData(s: Session, ctx: ContextResult) {
  return ctx.charts.map((c) => ({ spec: c, data: s.chart([], { specId: c.id }, "INTL") }));
}

// ---------------------------------------------------------------- shapes

describe("a time series", async () => {
  // 7 weather stations read daily for 400 days.
  const LOCATIONS = ["Albury", "Sydney", "Perth", "Darwin", "Hobart", "Cairns", "Melbourne"];
  const rows: Cell[][] = [["Date", "Location", "MinTemp", "MaxTemp", "Rainfall", "Humidity3pm"]];
  const minTemp = (d: number, j: number) => Number((10 + j * 2 + (d % 30) * 0.3).toFixed(1));
  for (let d = 0; d < 400; d++)
    LOCATIONS.forEach((l, j) => {
      const t = minTemp(d, j);
      rows.push([
        iso(Date.UTC(2024, 0, 1) + d * DAY),
        l,
        t.toFixed(1),
        (t + 9 + (d % 5)).toFixed(1),
        ((d * 7 + j * 3) % 11) * 0.4,
        30 + ((d + j * 5) % 50),
      ]);
    });
  const { s, ctx } = await generic(rows, "weather");
  const v = values(s, ctx);

  it("says what the table is", () => {
    expect(ctx.domain.subDomains[0]?.name).toBe("Time series");
    expect(ctx.domain.description).toBe(
      "Daily readings of 4 measures at 7 locations, 1 Jan 2024 – 3 Feb 2025",
    );
    expect(ctx.grainLabel).toBe("One row per location per date");
  });

  it("reads levels on the latest date and never adds them across dates", () => {
    const names = shownKpis(ctx).map((k) => k.name);
    expect(names).toEqual(
      expect.arrayContaining(["Locations", "Days", "Latest average MinTemp", "Total Rainfall"]),
    );
    for (const n of ["Total MinTemp", "Total MaxTemp", "Total Humidity3pm"]) expect(names).not.toContain(n);
    expect(v.get("Locations")).toBe(7);
    expect(v.get("Days")).toBe(400);
    // The 7 stations' readings on the last day, averaged.
    const last = LOCATIONS.map((_, j) => minTemp(399, j));
    expect(v.get("Latest average MinTemp")).toBeCloseTo(last.reduce((a, b) => a + b, 0) / 7, 9);
    expect(ctx.kpis.find((k) => k.name === "Latest average MinTemp")?.definition).toMatch(
      /never added across dates/,
    );
  });

  it("charts the trend, the seasons, the stations, the spread and the closest pair", () => {
    const byId = new Map(ctx.charts.map((c) => [c.id, c]));
    expect(byId.get("g_trend")).toMatchObject({ kind: "line", title: "Average MinTemp over time" });
    expect(byId.get("g_season")?.title).toBe("Average MinTemp by month of year");
    expect(byId.get("g_by_location")?.kind).toBe("hbar");
    expect(byId.get("g_hist")?.kind).toBe("histogram");
    // MaxTemp is MinTemp plus a few degrees: the pair that moves together most closely.
    expect(byId.get("g_scatter")?.title).toBe("MinTemp vs MaxTemp by Location");
    expect(byId.get("g_scatter")?.reason).toMatch(/r = 0\.\d\d/);
    for (const { spec, data } of chartData(s, ctx)) {
      expect(data?.empty, spec.id).toBe(false);
      if (spec.kind !== "table") expect(data?.headline, spec.id).toBeTruthy();
    }
  });

  it("leaves a hidden column out of every choice", async () => {
    const hidden = await generic(rows, "weather", ["MaxTemp"]);
    expect(hidden.ctx.domain.description).toBe(
      "Daily readings of 3 measures at 7 locations, 1 Jan 2024 – 3 Feb 2025",
    );
    expect(hidden.ctx.charts.find((c) => c.id === "g_scatter")?.title).not.toMatch(/MaxTemp/);
    expect(hidden.ctx.kpis.some((k) => k.fieldsUsed.some((f) => f.column === "MaxTemp"))).toBe(false);
  });

  it("matches DuckDB", async () => {
    expect(await duckMismatches(s)).toEqual([]);
  });
});

describe("a panel", async () => {
  const COUNTRIES = [
    "India",
    "Brazil",
    "Germany",
    "Kenya",
    "Japan",
    "Mexico",
    "Canada",
    "France",
    "Chile",
    "Egypt",
    "Nigeria",
    "Peru",
  ];
  const population = (i: number, y: number) => 1e7 * (i + 2) + (y - 2010) * 1e5;
  const rows: Cell[][] = [
    [
      "Country Name",
      "Year",
      "GDP (current US$)",
      "Population, total",
      "Life expectancy at birth, total (years)",
      "Inflation, consumer prices (annual %)",
    ],
  ];
  COUNTRIES.forEach((c, i) => {
    for (let y = 2010; y < 2020; y++)
      rows.push([
        c,
        y,
        (1e11 * (i + 1) * (1 + (y - 2010) * 0.03)).toFixed(0),
        population(i, y),
        (60 + i * 1.5 + (y - 2010) * 0.2 + (i % 3) * 0.7).toFixed(1),
        (2 + ((i + y) % 7) * 0.8).toFixed(1),
      ]);
  });
  const { s, ctx } = await generic(rows, "indicators");
  const v = values(s, ctx);

  it("says what the table is", () => {
    expect(ctx.domain.subDomains[0]?.name).toBe("Panel");
    expect(ctx.domain.description).toBe("12 countries × 10 years of 4 indicators, 2010 – 2019");
  });

  it("counts countries and years and averages each indicator on the latest year, never totalling it", () => {
    const names = shownKpis(ctx).map((k) => k.name);
    expect(names).toEqual(expect.arrayContaining(["Countries", "Years", "Latest average Population, total"]));
    expect(names.some((n) => /^Total /.test(n))).toBe(false);
    expect(v.get("Countries")).toBe(12);
    expect(v.get("Years")).toBe(10);
    const latest = COUNTRIES.map((_, i) => population(i, 2019));
    expect(v.get("Latest average Population, total")).toBeCloseTo(latest.reduce((a, b) => a + b, 0) / 12, 3);
  });

  it("shows each country's latest value, the country × year grid, the spread and the closest pair", () => {
    const byId = new Map(ctx.charts.map((c) => [c.id, c]));
    expect(byId.get("g_by_country_name")?.title).toBe("Latest average GDP (current US$) by Country Name");
    expect(byId.get("g_heatmap")).toMatchObject({
      kind: "heatmap",
      title: "Average GDP (current US$): Country Name × Year",
    });
    expect(byId.get("g_hist")?.kind).toBe("histogram");
    expect(byId.get("g_scatter")?.kind).toBe("scatter");
    // The years read in order across the grid.
    const grid = s.chart([], { specId: "g_heatmap" }, "INTL");
    expect(grid?.categories.map((c) => c.label)).toEqual([
      "2010",
      "2011",
      "2012",
      "2013",
      "2014",
      "2015",
      "2016",
      "2017",
      "2018",
      "2019",
    ]);
  });

  it("matches DuckDB", async () => {
    expect(await duckMismatches(s)).toEqual([]);
  });
});

describe("a survey", async () => {
  const SCALE = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];
  const QUESTIONS = ["I enjoy my work", "My manager supports me", "I see a future here"];
  const answer = (q: number, i: number) => SCALE[(i * (q + 2) + q) % 5] as string;
  const recommend = (i: number) => (i * 7) % 11;
  const rows: Cell[][] = [
    [
      "Timestamp",
      "Department",
      ...QUESTIONS,
      "Overall satisfaction (1-5)",
      "How likely are you to recommend us? (0-10)",
    ],
  ];
  for (let i = 0; i < 300; i++)
    rows.push([
      `2024-03-${String(1 + (i % 28)).padStart(2, "0")} ${String(8 + (i % 10)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:00`,
      ["Sales", "Support", "Engineering", "Finance"][i % 4] as string,
      ...QUESTIONS.map((_, q) => answer(q, i)),
      1 + ((i * 3) % 5),
      recommend(i),
    ]);
  const { s, ctx } = await generic(rows, "pulse_survey");
  const v = values(s, ctx);

  it("says what the table is", () => {
    expect(ctx.domain.subDomains[0]?.name).toBe("Survey");
    expect(ctx.domain.description).toBe("300 survey responses to 5 questions, 1–28 Mar 2024");
    expect(ctx.grainLabel).toBe("One row per response");
  });

  it("counts responses, the top two boxes, the average rating and NPS", () => {
    const names = shownKpis(ctx).map((k) => k.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Responses",
        "Net promoter score (NPS)",
        "I enjoy my work: % favourable",
        "Average Overall satisfaction (1-5)",
      ]),
    );
    expect(v.get("Responses")).toBe(300);
    const fav = (q: number) =>
      Array.from({ length: 300 }, (_, i) => answer(q, i)).filter(
        (a) => /agree$/i.test(a) && !/disagree/i.test(a),
      ).length / 300;
    QUESTIONS.forEach((q, i) => expect(v.get(`${q}: % favourable`)).toBeCloseTo(fav(i), 12));
    const scores = Array.from({ length: 300 }, (_, i) => recommend(i));
    const nps = (100 * (scores.filter((x) => x >= 9).length - scores.filter((x) => x <= 6).length)) / 300;
    expect(v.get("Net promoter score (NPS)")).toBeCloseTo(nps, 9);
    expect(v.get("Average Overall satisfaction (1-5)")).toBeCloseTo(3, 12);
    // The answers are never totalled: a 1–5 score adds up to nothing.
    expect(names.some((n) => /^Total /.test(n))).toBe(false);
  });

  it("charts each question's answers, the rating's spread and the top boxes by department", () => {
    const ids = ctx.charts.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining(["g_answers_i_enjoy_my_work", "g_hist", "g_by_department", "g_trend"]),
    );
    expect(ctx.charts.find((c) => c.id === "g_by_department")?.title).toBe(
      "I enjoy my work: % favourable by Department",
    );
    // One band per point of the 1–5 scale.
    const hist = s.chart([], { specId: "g_hist" }, "INTL");
    expect(hist?.categories.length).toBe(5);
  });

  it("matches DuckDB", async () => {
    expect(await duckMismatches(s)).toEqual([]);
  });
});

describe("a labelled practice table", async () => {
  const survived = (i: number) => ((i * 7) % 5 < 2 ? 1 : 0);
  const rows: Cell[][] = [["PassengerId", "Survived", "Pclass", "Name", "Sex", "Age", "Fare", "Embarked"]];
  for (let i = 0; i < 400; i++)
    rows.push([
      i + 1,
      survived(i),
      1 + (i % 3),
      `Person ${i}, Mr. X`,
      i % 3 ? "male" : "female",
      i % 9 ? 5 + ((i * 13) % 70) : "",
      (7 + ((i * 37) % 500) / 3).toFixed(4),
      ["S", "C", "Q"][i % 3] as string,
    ]);
  const { s, ctx } = await generic(rows, "titanic");
  const v = values(s, ctx);

  it("says what the table is, with its outcome", () => {
    expect(ctx.domain.subDomains[0]?.name).toBe("Labelled table");
    expect(ctx.domain.description).toBe("400 rows with a yes/no outcome (Survived: 40.0% yes)");
  });

  // Version 49.0: the dashboard is read around the outcome, named after what it counts ("Survival
  // rate", from Survived), with the rows named after what they are (passengers, from PassengerId).
  it("gives the outcome rate and averages the features", () => {
    const names = shownKpis(ctx).map((k) => k.name);
    expect(names).toEqual(
      expect.arrayContaining(["Passengers", "Survival rate", "Survived", "Average Fare", "Average Age"]),
    );
    expect(names.some((n) => /^Total /.test(n))).toBe(false);
    expect(v.get("Survival rate")).toBeCloseTo(160 / 400, 12);
    expect(v.get("Survived")).toBe(160);
  });

  it("charts the rate by category and by band, and the features for yes against no", () => {
    const byId = new Map(ctx.charts.map((c) => [c.id, c]));
    const byCategory = ctx.charts.filter((c) => c.id.startsWith("g_by_"));
    expect(byCategory.length).toBeGreaterThanOrEqual(1);
    for (const c of byCategory) expect(c.title).toMatch(/^Survival rate by /);
    expect(byId.get("g_outcome_bands")?.measures[0]?.label).toBe("Survival rate");
    expect(ctx.charts.some((c) => c.id.startsWith("g_yesno_") && c.title.endsWith(" by Survived"))).toBe(
      true,
    );
  });

  it("reads a class outcome as each class's share", async () => {
    const SPECIES = ["setosa", "versicolor", "virginica"];
    const iris: Cell[][] = [["sepal_length", "sepal_width", "petal_length", "petal_width", "species"]];
    for (let i = 0; i < 150; i++) {
      const k = Math.floor(i / 50);
      iris.push([
        (4.5 + k + (i % 7) * 0.1).toFixed(1),
        (3 + (i % 5) * 0.1 - k * 0.2).toFixed(1),
        (1.4 + k * 2 + (i % 6) * 0.1).toFixed(1),
        (0.2 + k * 0.8 + (i % 4) * 0.1).toFixed(1),
        SPECIES[k] as string,
      ]);
    }
    const g = await generic(iris, "iris");
    expect(g.ctx.domain.description).toBe("150 rows labelled by species (3 classes)");
    const iv = values(g.s, g.ctx);
    expect(iv.get("Share of setosa")).toBeCloseTo(1 / 3, 12);
    expect(g.ctx.charts.map((c) => c.id)).toEqual(
      expect.arrayContaining(["g_classes", "g_class_sepal_length", "g_heatmap", "g_hist"]),
    );
    expect(await duckMismatches(g.s)).toEqual([]);
  });

  it("matches DuckDB", async () => {
    expect(await duckMismatches(s)).toEqual([]);
  });
});

describe("an event log", async () => {
  const TYPES = ["page_view", "click", "signup", "purchase", "logout"];
  const rows: Cell[][] = [["event_id", "user_id", "event_time", "event_type", "device", "duration_sec"]];
  for (let i = 0; i < 500; i++) {
    const t = Date.UTC(2024, 4, 1) + i * 2_520_000 + ((i * 7919) % 3600) * 1000;
    rows.push([
      `E${10000 + i}`,
      `U${100 + ((i * 17) % 60)}`,
      new Date(t).toISOString().slice(0, 19).replace("T", " "),
      TYPES[(i * 3) % 5] as string,
      ["mobile", "desktop", "tablet"][i % 3] as string,
      5 + ((i * 31) % 300),
    ]);
  }
  const { s, ctx } = await generic(rows, "events");
  const v = values(s, ctx);

  it("says what the table is", () => {
    expect(ctx.domain.subDomains[0]?.name).toBe("Event log");
    expect(ctx.domain.description).toBe("500 events, 1–15 May 2024, from 60 users");
  });

  it("counts events and the users they come from", () => {
    expect(v.get("Events")).toBe(500);
    expect(v.get("Distinct user id")).toBe(60);
    // A duration is averaged, never totalled.
    expect(v.has("Average duration sec")).toBe(true);
    expect(shownKpis(ctx).some((k) => k.name === "Total duration sec")).toBe(false);
  });

  it("charts events over time, by weekday and by type", () => {
    const ids = ctx.charts.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["g_trend", "g_weekday", "g_by_event_type", "g_by_device"]));
    expect(ctx.charts.find((c) => c.id === "g_trend")?.title).toBe("Events over time");
  });

  it("matches DuckDB", async () => {
    expect(await duckMismatches(s)).toEqual([]);
  });
});

describe("a lookup table", async () => {
  const REGIONS = ["Asia", "Europe", "Africa", "Americas", "Oceania"];
  const INCOME = ["Low income", "Lower middle income", "Upper middle income", "High income"];
  const rows: Cell[][] = [["Country Code", "Short Name", "Region", "Income Group", "Currency Unit"]];
  for (let i = 0; i < 120; i++)
    rows.push([
      `C${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`,
      `Country ${i}`,
      REGIONS[i % 5] as string,
      INCOME[(i * 3) % 4] as string,
      `Unit ${i % 40}`,
    ]);
  const { s, ctx } = await generic(rows, "country_lookup");
  const v = values(s, ctx);

  it("says what the table is and counts what its attributes span", () => {
    expect(ctx.domain.subDomains[0]?.name).toBe("Lookup table");
    expect(ctx.domain.description).toBe("Lookup table: 120 countries and their attributes");
    expect(v.get("Rows")).toBe(120);
    expect(v.get("Regions")).toBe(5);
    expect(v.get("Income groups")).toBe(4);
    expect(ctx.charts.length).toBeGreaterThanOrEqual(4);
  });

  it("matches DuckDB", async () => {
    expect(await duckMismatches(s)).toEqual([]);
  });
});

describe("the description, from the profile alone", () => {
  it("is the same sentence before and after the dashboard is built", async () => {
    const rows: Cell[][] = [["Month", "Revenue"]];
    for (let i = 0; i < 24; i++) rows.push([iso(Date.UTC(2024, 9 + i, 1)), i < 12 ? 100 : 150]);
    const ds = await parseCsv(csvOf(rows), "monthly");
    const shape = describeTable(profileDataset(ds));
    expect(shape).toMatchObject({
      kind: "timeSeries",
      description: "Monthly figures for Revenue, Oct 2024 – Sep 2026",
    });
    const { ctx } = await generic(rows, "monthly");
    expect(ctx.domain.description).toBe(shape.description);
    // Revenue adds up across months: it is totalled, and the months of the year show its seasons.
    expect(ctx.kpis.find((k) => k.name === "Total Revenue")?.available).toBe(true);
    expect(ctx.charts.map((c) => c.id)).toContain("g_season");
  });
});

// ---------------------------------------------------------------- the benchmark sweep

interface Fixture extends LayoutSpec {
  expect: string | string[] | null;
}
const DIR = join(__dirname, "fixtures", "benchmark");
const UNMATCHED: Fixture[] = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .flatMap((f) => (JSON.parse(readFileSync(join(DIR, f), "utf8")) as { fixtures: Fixture[] }).fixtures)
  .filter((f) => f.expect === null);

describe("every benchmark layout no industry fits", () => {
  it("has some", () => expect(UNMATCHED.length).toBeGreaterThanOrEqual(10));

  for (const layout of UNMATCHED)
    it(`${layout.id}: a described dashboard with KPIs that compile and match DuckDB`, async () => {
      const s = new Session();
      const load = await s.ingest(new Blob([expandFixture(layout, 240)]), `${layout.id}.csv`, {});
      if (load.status !== "ok") throw new Error(load.status);
      const ctx = s.configure({ domainId: "generic", numberLocale: "INTL", currency: null });
      expect(ctx.domain.description.length, "description").toBeGreaterThan(10);
      expect(ctx.domain.subDomains[0]?.description).toBe(ctx.domain.description);
      const shown = shownKpis(ctx).filter((k) => k.available);
      expect(shown.length, "KPIs").toBeGreaterThanOrEqual(3);
      expect(ctx.charts.length, "charts").toBeGreaterThanOrEqual(4);
      for (const k of ctx.kpis.filter((x) => x.available)) {
        expect(k.sql, `${k.id} SQL`).toBeTruthy();
        expect(k.dax, `${k.id} DAX`).toBeTruthy();
      }
      const ec = (s as unknown as { exportContext(): ExportContext }).exportContext();
      expect(sumsOfNonAdditive(ec)).toEqual([]);
      for (const { spec, data } of chartData(s, ctx))
        expect(data?.empty, `${spec.id}: ${data?.notes.join(" ")}`).toBe(false);
      expect(await duckMismatches(s, 12)).toEqual([]);
    });
});
