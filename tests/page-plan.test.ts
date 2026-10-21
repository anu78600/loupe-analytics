/**
 * The one-page dashboard designed from the data (version 49.0): a dashboard
 * that no industry leads (the general one, or an industry that explains few
 * of the columns) is titled from the data ("Passenger survival analysis") and
 * picks its charts by the plan's ranking, the highest-scored first, still
 * preferring charts about different things. An industry that fits strongly
 * keeps its title and today's picks exactly (tests/one-page.test.ts covers
 * those rules).
 */
import { describe, expect, it } from "vitest";
import {
  dataLed,
  defaultPageTitle,
  pickPageCharts,
  planRank,
  type PageRank,
} from "@/ui/workspace/dashboard/page/pagePlan";
import { Session } from "@/engine/session";
import type { ChartData, ChartKind, ChartSpec, ResolvedAxis } from "@/engine/charts/types";
import { rng } from "./helpers/layouts";

const TIME: ResolvedAxis = { kind: "time", column: "Date", grain: "month", label: "Date" };
const col = (column: string): ResolvedAxis => ({ kind: "column", column, label: column });

function spec(id: string, kind: ChartKind, x: ResolvedAxis, exec = true): ChartSpec {
  return {
    id,
    title: id,
    kind,
    section: "breakdown",
    x,
    measures: [{ id: "m", label: "Rate", format: "percent", direction: "higher" }],
    reason: "",
    alternatives: [],
    size: { w: 6, h: 4 },
    priority: 1,
    modes: exec ? ["executive", "analyst", "compact"] : ["analyst"],
    source: "domain",
  };
}

const data = (): ChartData => ({
  specId: "s",
  kind: "bar",
  categories: [{ label: "A", raw: "A" }],
  series: [{ id: "m", label: "Rate", values: [1], format: "percent" }],
  rows: [1],
  totals: [1],
  annotations: [],
  caption: "",
  altText: "",
  notes: [],
  empty: false,
  totalRows: 1,
});

function pick(specs: ChartSpec[], rank?: PageRank): string[] {
  return pickPageCharts(
    specs.map((s) => ({ id: s.id })),
    specs,
    Object.fromEntries(specs.map((s) => [s.id, data()])),
    5,
    rank,
  ).map((c) => c.spec.id);
}

describe("the page's title", () => {
  it("is read from the data when no industry leads, and the industry's when one fits strongly", () => {
    const understood = "Passenger survival analysis";
    expect(defaultPageTitle("Generic", { generic: true, roster: false, understood })).toBe(understood);
    expect(defaultPageTitle("Pharma", { generic: false, roster: false, weak: true, understood })).toBe(
      understood,
    );
    expect(defaultPageTitle("E-commerce", { generic: false, roster: false, understood })).toBe(
      "E-commerce performance dashboard",
    );
    expect(defaultPageTitle("HR & People", { generic: false, roster: true, understood })).toBe(
      "HR & People dashboard",
    );
    // Nothing better read from the data: the general title, as before.
    expect(defaultPageTitle("Generic", { generic: true, roster: false, understood: "  " })).toBe(
      "Performance dashboard",
    );
    expect(dataLed({ domain: { generic: true }, fit: { weak: false } })).toBe(true);
    expect(dataLed({ domain: { generic: false }, fit: { weak: true } })).toBe(true);
    expect(dataLed({ domain: { generic: false }, fit: { weak: false } })).toBe(false);
  });
});

describe("the page's charts by the plan", () => {
  const specs = [
    spec("trend", "line", TIME),
    spec("share", "donut", col("Channel")),
    spec("bySex", "bar", col("Sex")),
    spec("bySex2", "hbar", col("Sex")),
    spec("byClass", "bar", col("Pclass")),
    spec("byAge", "bar", col("Age"), false),
  ];
  const rank: PageRank = new Map([
    ["bySex", 0.9],
    ["bySex2", 0.85],
    ["byClass", 0.8],
    ["byAge", 0.6],
    ["trend", 0.5],
    ["share", 0.3],
  ]);

  it("leads with the highest-scored chart and keeps charts about different things", () => {
    // Not the trend first, not the executive choice first: the plan's order, one chart per subject first.
    expect(pick(specs, rank)).toEqual(["bySex", "byClass", "byAge", "trend", "share"]);
  });

  it("puts charts the plan doesn't score after the scored ones", () => {
    const mine = spec("mine", "bar", col("Embarked"));
    expect(pick([mine, ...specs.slice(0, 3)], rank)).toEqual(["bySex", "trend", "share", "mine"]);
  });

  it("keeps today's picks without a plan (an industry that fits strongly)", () => {
    expect(pick(specs)).toEqual(["trend", "share", "bySex", "byClass", "byAge"]);
  });

  it("reads only the charts' scores from the plan", () => {
    const r = planRank([
      { id: "a", type: "chart", score: 0.7 },
      { id: "k", type: "kpi", score: 0.9 },
    ]);
    expect([...(r ?? new Map())]).toEqual([["a", 0.7]]);
    expect(planRank([])).toBeUndefined();
    expect(planRank(undefined)).toBeUndefined();
  });
});

/** A Titanic-like passenger list: survival planted on Sex, then class and age. Seeded, so it never changes. */
function passengers(n = 800): File {
  const r = rng(4901);
  const lines = ["PassengerId,Survived,Pclass,Name,Sex,Age,SibSp,Parch,Fare,Embarked"];
  for (let i = 0; i < n; i++) {
    const female = r() < 0.36;
    const pclass = r() < 0.25 ? 1 : r() < 0.35 ? 2 : 3;
    const age = Math.round(2 + r() * 70);
    const p =
      (female ? 0.74 : 0.19) + (pclass === 1 ? 0.12 : pclass === 3 ? -0.08 : 0) - (age > 50 ? 0.06 : 0);
    const survived = r() < Math.min(0.97, Math.max(0.02, p)) ? 1 : 0;
    const fare = (pclass === 1 ? 60 : pclass === 2 ? 20 : 8) + Math.round(r() * 3000) / 100;
    lines.push(
      [
        i + 1,
        survived,
        pclass,
        `"Passenger ${i + 1}, Mr"`,
        female ? "female" : "male",
        age,
        Math.floor(r() * 3),
        Math.floor(r() * 3),
        fare.toFixed(2),
        ["S", "C", "Q"][Math.floor(r() * 3)],
      ].join(","),
    );
  }
  return new File([`${lines.join("\n")}\n`], "titanic.csv", { type: "text/csv" });
}

/** Configures `domainId` on a loaded session and computes every chart, as the dashboard would. */
function build(s: Session, domainId: string) {
  const ctx = s.configure({ domainId, numberLocale: "INTL", currency: null });
  const out = s.computeDashboard({
    filters: [],
    kpiIds: [],
    charts: ctx.charts.map((c) => ({ specId: c.id })),
    numberLocale: "INTL",
  });
  const widgets = ctx.charts.map((c) => ({ id: c.id }));
  return { ctx, charts: out.charts, widgets };
}

describe("a page designed from the data", () => {
  it("is titled from the data and led by the plan's best chart", async () => {
    const s = new Session();
    const load = await s.ingest(passengers(), "titanic.csv", {});
    if (load.status !== "ok") throw new Error(load.status);
    const { ctx, charts, widgets } = build(s, "generic");
    expect(dataLed(ctx)).toBe(true);
    const title = defaultPageTitle(ctx.domain.name, {
      generic: ctx.domain.generic,
      roster: false,
      weak: ctx.fit.weak,
      understood: ctx.understanding.title,
    });
    expect(title).toBe(ctx.understanding.title);
    expect(title).toMatch(/surviv/i);
    // The plan names every chart of the result, and the page leads with the best-scored one it can show.
    const rank = planRank(ctx.plan);
    expect(ctx.charts.every((c) => rank?.has(c.id))).toBe(true);
    const page = pickPageCharts(widgets, ctx.charts, charts, 5, rank);
    expect(page.length).toBeGreaterThanOrEqual(3);
    const best = Math.max(...page.map((c) => rank?.get(c.spec.id) ?? -1));
    expect(rank?.get(page[0]?.spec.id ?? "")).toBe(best);
    // No two of its first three charts are about the same thing (pagePlan's own rule).
    const subject = (x: ResolvedAxis) =>
      x.kind === "time" || x.kind === "column"
        ? `${x.kind}:${x.column}`
        : `${x.kind}:${"label" in x ? x.label : ""}`;
    const subjects = page.slice(0, 3).map((c) => subject(c.spec.x));
    expect(new Set(subjects).size).toBe(subjects.length);
  });

  it("leaves a strong industry's page as it was", () => {
    const s = new Session();
    const load = s.ingestSample("ecommerce");
    if (load.status !== "ok") throw new Error(load.status);
    const { ctx, charts, widgets } = build(s, "ecommerce");
    expect(dataLed(ctx)).toBe(false);
    expect(
      defaultPageTitle(ctx.domain.name, {
        generic: false,
        roster: false,
        weak: ctx.fit.weak,
        understood: ctx.understanding.title,
      }),
    ).toBe("E-commerce performance dashboard");
    const page = pickPageCharts(widgets, ctx.charts, charts);
    expect(page[0]?.spec.x.kind).toBe("time");
  });
});
