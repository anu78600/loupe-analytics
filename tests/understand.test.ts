/**
 * What Loupe understands about a table before it designs anything (version
 * 49.0, src/engine/understand): the outcome a table is measured by, the
 * columns that move it, what each column is, what one row is, what an
 * analyst would call the dashboard, and the sentences that say so.
 *
 * Each table is a practice layout with relationships planted on purpose
 * (tests/helpers/practice.ts): alcohol lifts a wine's quality, women
 * survived the Titanic, month-to-month contracts churn. The tests check that
 * Loupe finds them, and every number a sentence states is worked out again
 * here, straight from the generator's rows, and formatted the way the
 * sentence says it.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { formatValue } from "@/engine/core/format";
import { pearson } from "@/engine/core/stats";
import { Session } from "@/engine/session";
import { KIND_LABEL, SETTABLE_KINDS, roleForKind } from "@/engine/understand/kinds";
import type { ColumnKind, DataUnderstanding } from "@/engine/understand/types";
import * as P from "./helpers/practice";

type Rows = P.Practice["rows"];

/** A practice table loaded the way the app loads a file; the understanding comes with it. */
async function load(t: P.Practice, fileName = t.fileName) {
  const s = new Session();
  const l = await s.ingest(new Blob([t.csv]), fileName, {});
  if (l.status !== "ok") throw new Error(`${fileName}: ${l.status}`);
  return { s, u: l.understanding };
}

/** A column of a practice table's rows: numbers as numbers (blank as NaN), text as text. */
function values(rows: Rows, name: string): Array<number | string> {
  const j = (rows[0] as string[]).indexOf(name);
  if (j < 0) throw new Error(`No column ${name}`);
  return rows.slice(1).map((r) => r[j] as number | string);
}
const numbers = (rows: Rows, name: string) =>
  values(rows, name).map((v) => (v === "" ? NaN : typeof v === "number" ? v : Number(v)));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const present = (xs: number[]) => xs.filter((v) => v === v);

const pct = (v: number) => formatValue(v, "percent", { locale: "INTL", currency: "INR" });
/** How the sentences write a reading: 0 decimals from 100, 1 from 10, 2 from 1, else 3. */
const reading = (v: number) => {
  const a = Math.abs(v);
  return formatValue(v, "decimal", {
    locale: "INTL",
    currency: "INR",
    decimals: a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3,
  });
};
const money = (v: number) => formatValue(v, "currency", { locale: "INTL", currency: "INR" });
const rText = (r: number) => `r = ${r.toFixed(2).replace("-", "−")}`;
const kindOf = (u: DataUnderstanding, column: string) => u.columns.find((c) => c.name === column)?.kind;

/** Rate of yes in each group of a category column, for a 0/1 or yes/no outcome. */
function ratesBy(rows: Rows, group: string, outcome: string, yes: (v: number | string) => boolean) {
  const g = values(rows, group);
  const o = values(rows, outcome);
  const out = new Map<string, { yes: number; n: number }>();
  g.forEach((k, i) => {
    const key = String(k);
    const cur = out.get(key) ?? { yes: 0, n: 0 };
    cur.n++;
    if (yes(o[i] as number | string)) cur.yes++;
    out.set(key, cur);
  });
  return new Map([...out].map(([k, v]) => [k, v.yes / v.n]));
}

/** The R type-7 quantile of sorted numbers, as the quarters sentence uses. */
function quantile(sorted: number[], p: number): number {
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  return (
    (sorted[lo] as number) +
    (h - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)] as number) - (sorted[lo] as number))
  );
}

// ---------------------------------------------------------------- wine

describe("wine: quality, a score on a short scale", async () => {
  const t = P.wine();
  const { s, u } = await load(t);
  const quality = numbers(t.rows, "quality");
  const alcohol = numbers(t.rows, "alcohol");

  it("finds the outcome and what moves it", () => {
    expect(u.outcome).toMatchObject({ column: "quality", type: "ordinal" });
    expect(u.drivers[0]).toMatchObject({ column: "alcohol", direction: "up", method: "correlation" });
    expect(u.drivers.find((d) => d.column === "density")?.direction).toBe("down");
    expect(u.drivers.length).toBeLessThanOrEqual(8);
    for (const d of u.drivers) expect(d.strength).toBeGreaterThanOrEqual(0.1);
    // Other plausible outcomes, the strongest numbers first.
    expect(u.outcome?.alternatives[0]).toBe("alcohol");
  });

  it("reads each column's kind, the rows and the title", () => {
    expect(kindOf(u, "alcohol")).toBe("measurement");
    expect(kindOf(u, "density")).toBe("measurement");
    expect(kindOf(u, "quality")).toBe("outcome");
    expect(u.subject).toMatchObject({
      noun: "wine sample",
      rowMeaning: "One row per wine sample",
      nounSource: "file name",
    });
    expect(u.title).toBe("Wine quality analysis");
    expect(u.industry).toBeNull();
  });

  it("states numbers that a direct recomputation gives", () => {
    const top = quality.map((q) => q >= 7);
    const high = mean(alcohol.filter((_, i) => top[i]));
    const low = mean(alcohol.filter((_, i) => !top[i]));
    const { r } = pearson(alcohol, quality);
    expect(u.drivers[0]?.sentence).toBe(
      `Wine samples rated 7 or above on quality average ${reading(high)} alcohol, against ${reading(low)} for the rest (${rText(r)}).`,
    );
    expect(u.drivers[0]?.value).toBeCloseTo(r, 12);
    const share = quality.filter((q) => q >= 7).length / quality.length;
    expect(u.sentences).toContain(
      `Rated on quality, ${Math.min(...quality)}–${Math.max(...quality)}; ${pct(share)} are 7 or above.`,
    );
    // Strong links are said to move closely with the outcome.
    expect(u.sentences).toContain(
      `Alcohol moves closely with quality (${rText(r)}), then density (${rText(u.drivers[1]?.value ?? 0)}).`,
    );
    expect(u.sentences[0]).toBe(
      `${formatValue(quality.length, "integer", { locale: "INTL", currency: "INR" })} wine samples, with 11 measures.`,
    );
  });

  it("lets the user choose the outcome, or none", () => {
    const alc = s.understand({ outcome: "alcohol" });
    expect(alc.outcome).toMatchObject({ column: "alcohol", type: "amount" });
    expect(alc.drivers.some((d) => d.column === "alcohol")).toBe(false);
    const none = s.understand({ outcome: null });
    expect(none.outcome).toBeNull();
    expect(none.drivers).toEqual([]);
    // The rows are still wine samples: the noun never depends on the outcome.
    expect(none.subject.noun).toBe("wine sample");
    expect(none.title).toBe("Wine samples at a glance");
    // A column that isn't in the file is ignored: Loupe chooses.
    expect(s.understand({ outcome: "no such column" }).outcome?.column).toBe("quality");
  });

  it("never reads a hidden column", () => {
    const hidden = s.understand({ hiddenColumns: ["alcohol"] });
    expect(hidden.columns.map((c) => c.name)).not.toContain("alcohol");
    expect(hidden.drivers.map((d) => d.column)).not.toContain("alcohol");
    expect(hidden.relations.flatMap((r) => [r.a, r.b])).not.toContain("alcohol");
    expect(hidden.outcome?.alternatives).not.toContain("alcohol");
    expect(hidden.sentences.join(" ")).not.toMatch(/alcohol/i);
    // A hidden column can't be the outcome either.
    expect(s.understand({ hiddenColumns: ["quality"], outcome: "quality" }).outcome?.column).not.toBe(
      "quality",
    );
  });

  it("names the rows from the sheet when the file name says nothing", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t.rows), "winequality-white");
    const blob = new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer]);
    const x = new Session();
    const l = await x.ingest(blob, "cleaned.xlsx", {});
    if (l.status !== "ok") throw new Error(l.status);
    expect(l.understanding.subject).toMatchObject({ noun: "wine sample", nounSource: "sheet name" });
    expect(l.understanding.title).toBe("Wine quality analysis");
    expect(x.understand({ outcome: null }).subject.noun).toBe("wine sample");
  });
});

// ---------------------------------------------------------------- Titanic

describe("Titanic: survived, yes or no", async () => {
  const t = P.titanic();
  const { u } = await load(t);
  const survived = (v: number | string) => Number(v) === 1;

  it("finds the outcome and what moves it: Sex, then the class and the fare", () => {
    expect(u.outcome).toMatchObject({ column: "Survived", type: "binary" });
    expect(u.drivers[0]).toMatchObject({ column: "Sex", method: "group-means" });
    expect(u.drivers.map((d) => d.column).slice(1, 3)).toEqual(expect.arrayContaining(["Pclass"]));
    expect(u.drivers.find((d) => d.column === "Pclass")).toMatchObject({
      method: "group-means",
      direction: "down",
    });
    expect(u.outcome?.alternatives).toEqual(expect.arrayContaining(["Fare"]));
  });

  it("reads the IDs, the codes, the counts and the labels for what they are", () => {
    expect(kindOf(u, "PassengerId")).toBe("id");
    expect(kindOf(u, "Ticket")).toBe("id");
    // A name on every row is a label, never a group.
    expect(kindOf(u, "Name")).toBe("id");
    // A table of passengers: a 1–3 class code is a category, counts of relatives are averaged.
    expect(kindOf(u, "Pclass")).toBe("category");
    expect(kindOf(u, "SibSp")).toBe("measurement");
    expect(kindOf(u, "Parch")).toBe("measurement");
    expect(kindOf(u, "Sex")).toBe("category");
    expect(u.subject).toMatchObject({ noun: "passenger", nounSource: "entity column" });
    expect(u.title).toBe("Passenger survival analysis");
  });

  it("states numbers that a direct recomputation gives", () => {
    const rates = ratesBy(t.rows, "Sex", "Survived", survived);
    expect(u.drivers[0]?.sentence).toBe(
      `Survival differs most by Sex: female ${pct(rates.get("female") as number)}, male ${pct(rates.get("male") as number)}.`,
    );
    const all = values(t.rows, "Survived").map(survived);
    const yes = all.filter(Boolean).length;
    expect(u.sentences).toContain(
      `${pct(yes / all.length)} of passengers survived (${yes} of ${all.length}).`,
    );
    const byClass = ratesBy(t.rows, "Pclass", "Survived", survived);
    expect(u.drivers.find((d) => d.column === "Pclass")?.sentence).toBe(
      `Survival is highest where Pclass is 1 (${pct(byClass.get("1") as number)}) and lowest where it is 3 (${pct(byClass.get("3") as number)}).`,
    );
  });
});

// ---------------------------------------------------------------- Telco churn

describe("Telco: churn, yes or no", async () => {
  const t = P.telco();
  const { u } = await load(t);

  it("finds the outcome and what moves it: the contract, then tenure, downwards", () => {
    expect(u.outcome).toMatchObject({ column: "Churn", type: "binary" });
    expect(u.drivers[0]?.column).toBe("Contract");
    expect(u.drivers[1]).toMatchObject({ column: "tenure", direction: "down" });
    expect(kindOf(u, "customerID")).toBe("id");
    expect(kindOf(u, "SeniorCitizen")).toBe("flag");
    expect(u.title).toMatch(/^(Customer|Subscriber) churn analysis$/);
  });

  it("states numbers that a direct recomputation gives", () => {
    const rates = ratesBy(t.rows, "Contract", "Churn", (v) => v === "Yes");
    expect(u.drivers[0]?.sentence).toBe(
      `Churn is highest where Contract is Month-to-month (${pct(rates.get("Month-to-month") as number)}) and lowest where it is Two year (${pct(rates.get("Two year") as number)}).`,
    );
  });
});

// ---------------------------------------------------------------- IBM HR attrition

describe("HR: attrition, yes or no", async () => {
  const t = P.hrAttrition();
  const { u } = await load(t);

  it("finds the outcome and what moves it: overtime, then the job level", () => {
    expect(u.outcome).toMatchObject({ column: "Attrition", type: "binary" });
    expect(u.drivers.map((d) => d.column).slice(0, 2)).toEqual(["OverTime", "JobLevel"]);
    expect(kindOf(u, "EmployeeNumber")).toBe("id");
    expect(kindOf(u, "MonthlyIncome")).toBe("amount");
    expect(u.subject.noun).toBe("employee");
    expect(u.title).toBe("Employee attrition analysis");
  });

  it("never says a weak link moves the outcome", () => {
    const top = u.drivers[0];
    expect(top?.strength).toBeLessThan(0.3);
    expect(u.sentences).toContain(
      `No column moves closely with attrition; the strongest link is OverTime (η = ${top?.value.toFixed(2)}).`,
    );
  });

  it("states numbers that a direct recomputation gives", () => {
    const left = values(t.rows, "Attrition").filter((v) => v === "Yes").length;
    const n = t.rows.length - 1;
    expect(u.sentences).toContain(
      `${pct(left / n)} of employees left (${formatValue(left, "integer", { locale: "INTL", currency: "INR" })} of ${formatValue(n, "integer", { locale: "INTL", currency: "INR" })}).`,
    );
    const rates = ratesBy(t.rows, "OverTime", "Attrition", (v) => v === "Yes");
    expect(u.drivers[0]?.sentence).toBe(
      `Attrition differs by OverTime: Yes ${pct(rates.get("Yes") as number)}, No ${pct(rates.get("No") as number)}.`,
    );
  });
});

// ---------------------------------------------------------------- house prices

describe("houses: the sale price, an amount of each case", async () => {
  const t = P.housePrices();
  const { u } = await load(t);
  const price = numbers(t.rows, "SalePrice");
  const area = numbers(t.rows, "GrLivArea");

  it("finds the outcome and what moves it", () => {
    expect(u.outcome).toMatchObject({ column: "SalePrice", type: "amount" });
    const top = u.drivers.slice(0, 3).map((d) => d.column);
    expect(top).toEqual(expect.arrayContaining(["GrLivArea", "OverallQual", "Neighborhood"]));
    expect(u.drivers.find((d) => d.column === "GrLivArea")?.direction).toBe("up");
    expect(u.drivers.find((d) => d.column === "OverallQual")?.direction).toBe("up");
    expect(kindOf(u, "Id")).toBe("id");
    expect(kindOf(u, "OverallQual")).toBe("score");
    expect(u.subject).toMatchObject({ noun: "house", nounSource: "file name" });
    expect(u.title).toBe("House sale price analysis");
  });

  it("states numbers that a direct recomputation gives", () => {
    const sorted = [...area].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const top = mean(price.filter((_, i) => (area[i] as number) >= q3));
    const bottom = mean(price.filter((_, i) => (area[i] as number) <= q1));
    const { r } = pearson(area, price);
    expect(u.drivers.find((d) => d.column === "GrLivArea")?.sentence).toBe(
      `Sale price rises with GrLivArea (${rText(r)}): the top quarter by GrLivArea averages ${money(top)}, against ${money(bottom)} for the bottom quarter.`,
    );
    expect(u.sentences).toContain(`Measured by SalePrice: ${money(mean(price))} on average.`);
  });
});

// ---------------------------------------------------------------- order lines

describe("order lines: a table of transactions read by its money", async () => {
  const t = P.orderLines();
  const { s, u } = await load(t);

  it("reads the amount as the outcome and the category as what moves it, never the parts of a line", () => {
    expect(u.outcome).toMatchObject({ column: "Amount", type: "amount" });
    expect(u.drivers[0]?.column).toBe("Category");
    // Quantity and the unit price make up the amount: they are not drivers.
    expect(u.drivers.map((d) => d.column)).not.toEqual(expect.arrayContaining(["Quantity"]));
    expect(u.drivers.map((d) => d.column)).not.toContain("Unit Price");
    expect(kindOf(u, "Order ID")).toBe("id");
    expect(kindOf(u, "Order Date")).toBe("time");
    expect(kindOf(u, "Quantity")).toBe("amount");
    expect(u.time).toMatchObject({ column: "Order Date", grain: "day" });
    // Without an industry, the money's own name; with one that fits, the industry's performance.
    expect(s.understand({ domainId: "generic" }).title).toBe("Amount analysis");
  });
});

// ---------------------------------------------------------------- iris

describe("iris: the species, unordered classes", async () => {
  const t = P.iris();
  const { u } = await load(t);

  it("finds the classes and what sets them apart", () => {
    expect(u.outcome).toMatchObject({ column: "species", type: "class" });
    expect(u.drivers[0]).toMatchObject({ column: "petal_length", method: "group-means" });
    expect(u.title).toBe("Iris species analysis");
  });

  it("states numbers that a direct recomputation gives", () => {
    const species = values(t.rows, "species");
    const length = numbers(t.rows, "petal_length");
    const avg = (name: string) => mean(length.filter((_, i) => species[i] === name));
    const eta = u.drivers[0]?.value ?? 0;
    expect(u.drivers[0]?.sentence).toBe(
      `Petal length averages ${reading(avg("virginica"))} for virginica, against ${reading(avg("setosa"))} for setosa (η = ${eta.toFixed(2)}).`,
    );
    // η recomputed: √(between-group ÷ total sum of squares).
    const grand = mean(length);
    const total = length.reduce((a, v) => a + (v - grand) ** 2, 0);
    const between = ["setosa", "versicolor", "virginica"].reduce(
      (a, sp) => a + species.filter((x) => x === sp).length * (avg(sp) - grand) ** 2,
      0,
    );
    expect(eta).toBeCloseTo(Math.sqrt(between / total), 9);
  });
});

// ---------------------------------------------------------------- weather

describe("weather: rain tomorrow, yes or no, over days and places", async () => {
  const t = P.weather();
  const { u } = await load(t);

  it("finds the outcome and what moves it: humidity up, sunshine down", () => {
    expect(u.outcome).toMatchObject({ column: "RainTomorrow", type: "binary" });
    expect(u.drivers[0]).toMatchObject({ column: "Humidity3pm", direction: "up" });
    expect(u.drivers.find((d) => d.column === "Sunshine")?.direction).toBe("down");
    expect(kindOf(u, "Date")).toBe("time");
    expect(kindOf(u, "Location")).toBe("place");
    expect(u.time).toMatchObject({ column: "Date", grain: "day" });
  });

  it("states numbers that a direct recomputation gives", () => {
    const h = numbers(t.rows, "Humidity3pm");
    const rain = values(t.rows, "RainTomorrow").map((v) => (v === "Yes" ? 1 : 0));
    const { r } = pearson(h, rain);
    expect(u.drivers[0]?.sentence).toBe(
      `Rows with RainTomorrow = Yes average ${reading(mean(h.filter((_, i) => rain[i] === 1)))} Humidity3pm, against ${reading(mean(h.filter((_, i) => rain[i] === 0)))} for the rest (${rText(r)}).`,
    );
    expect(present(h).length).toBe(h.length);
  });
});

// ---------------------------------------------------------------- a lookup

describe("a lookup of country codes", async () => {
  const { u } = await load(P.countryCodes());

  it("has no outcome and no drivers", () => {
    expect(u.outcome).toBeNull();
    expect(u.drivers).toEqual([]);
    expect(u.subject.noun).toBe("country");
    expect(u.title).toBe("Countries at a glance");
  });
});

// ---------------------------------------------------------------- the kinds' API

describe("reading a column as a kind", () => {
  it("names every kind and sets a role for each settable one", () => {
    const kinds = Object.keys(KIND_LABEL) as ColumnKind[];
    expect(kinds).toHaveLength(11);
    expect(KIND_LABEL.flag).toBe("Yes/no");
    for (const k of SETTABLE_KINDS) expect(roleForKind(k), k).not.toBeNull();
    expect(roleForKind("outcome")).toBeNull();
    expect(roleForKind("time")).toBeNull();
    expect(roleForKind("amount")).toMatchObject({ role: "measure", additivity: "additive" });
    expect(roleForKind("measurement")).toMatchObject({ role: "measure", additivity: "non-additive" });
  });

  it("reads a column as the kind the user chose", async () => {
    const t = P.titanic();
    const { s } = await load(t);
    const o = roleForKind("amount");
    if (!o) throw new Error("amount sets a role");
    const u = s.understand({ roleOverrides: { Parch: o } });
    expect(u.columns.find((c) => c.name === "Parch")?.kind).toBe("amount");
    const score = roleForKind("score");
    if (!score) throw new Error("score sets a role");
    expect(
      s.understand({ roleOverrides: { Fare: score } }).columns.find((c) => c.name === "Fare")?.kind,
    ).toBe("score");
  });
});
