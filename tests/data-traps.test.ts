/**
 * Traps in the data itself (version 51.5), each rebuilt from a real file the
 * computation audit ran:
 * - Rows whose values slid left (a Facebook ads export drops the two campaign
 *   ids from a third of its rows): moved back under their headers, so
 *   impressions are whole numbers again (parse/realign.ts).
 * - A placeholder for "no reading" (−200 in the UCI air-quality file) is read
 *   as blank; ordinary extremes are not (parse/traps.ts).
 * - Subtotal and total rows of a budget statement ("Saldo", "Summe") are left
 *   out, so nothing is counted twice; a product called "Total Gym" is not.
 * - Notes at the end of a file ("Total amount funded …") are left out.
 * - A pollutant reading ("NO2(GT)") is averaged, never summed.
 * - A chart over dates says how many rows had no date and were left out.
 */
import { describe, expect, it } from "vitest";
import type { Column } from "@/engine/core/types";
import { Session } from "@/engine/session";
import { ingestFile } from "@/engine/parse";

/** The file as read: the dataset and its parse report. */
async function read(csv: string, name = "data.csv") {
  const out = await ingestFile(new Blob([csv]), name, {});
  if (out.status !== "ok") throw new Error(out.status);
  return { ds: out.dataset, report: out.report };
}

async function session(csv: string, name: string) {
  const s = new Session();
  const res = await s.ingest(new Blob([csv]), name, {});
  if (res.status !== "ok") throw new Error(res.status);
  return s;
}

/** The values of a number column. */
function numbers(columns: readonly Column[], name: string): number[] {
  const c = columns.find((x) => x.name === name);
  if (c?.kind !== "number") throw new Error(`${name} is not a number column`);
  return [...c.values];
}

const date = (i: number) =>
  `2024-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`;

describe("rows whose values slid left", async () => {
  const rows = [
    "ad_id,reporting_start,campaign_id,fb_campaign_id,age,gender,interest,impressions,clicks,spent",
  ];
  let impressions = 0;
  for (let i = 0; i < 90; i++) {
    const imp = 1000 + i * 37;
    impressions += imp;
    const tail = `${["30-34", "35-39", "40-44"][i % 3]},${"MF"[i % 2]},${10 + (i % 20)},${imp},${i % 9},${(1.5 + i * 0.13).toFixed(2)}`;
    // Every third row lacks the two campaign ids, so its values sit two places to the left.
    rows.push(
      i % 3 === 0
        ? `${7000 + i},${date(i)},${tail},,`
        : `${7000 + i},${date(i)},${900 + (i % 4)},${10900 + (i % 4)},${tail}`,
    );
  }
  const { ds, report } = await read(rows.join("\n"), "ads.csv");

  it("moves them back under their headers, and says so", () => {
    expect(report.warnings.join(" ")).toMatch(/30 rows were missing campaign_id, fb_campaign_id/);
    expect(numbers(ds.columns, "impressions").reduce((a, b) => a + b, 0)).toBe(impressions);
    const age = ds.columns.find((c) => c.name === "age");
    expect(age?.kind === "string" && age.dict).toEqual(["30-34", "35-39", "40-44"]);
  });

  it("leaves a row that merely ends in blanks as it is", async () => {
    const plain = ["Order,Date,Amount,Quantity,Note"];
    for (let i = 0; i < 40; i++)
      plain.push(`O${i},${date(i)},${100 + i},${1 + (i % 4)},${i % 5 ? "" : "gift"}`);
    const { report: r } = await read(plain.join("\n"));
    expect(r.warnings.join(" ")).not.toMatch(/moved back/);
  });
});

describe("a placeholder for “no reading”", async () => {
  const rows = ["Date,CO(GT),Temperature,Change %"];
  let sum = 0;
  let n = 0;
  for (let i = 0; i < 200; i++) {
    const co = i % 10 === 0 ? -200 : 0.5 + (i % 23) * 0.4;
    if (co !== -200) {
      sum += co;
      n++;
    }
    rows.push(`${date(i)},${co},${-30 + (i % 61)},${i % 7 === 0 ? -100 : -95 + (i % 300)}`);
  }
  const { ds, report } = await read(rows.join("\n"), "air.csv");

  it("is read as blank, with a note", () => {
    const co = numbers(ds.columns, "CO(GT)").filter((x) => x === x);
    expect(co.length).toBe(n);
    expect(co.reduce((a, b) => a + b, 0)).toBeCloseTo(sum, 9);
    expect(report.columnNotes.find((c) => c.column === "CO(GT)")?.note).toMatch(/−200 appears 20 times/);
  });

  it("leaves ordinary extremes alone", () => {
    expect(numbers(ds.columns, "Temperature")).toContain(-30);
    expect(numbers(ds.columns, "Change %")).toContain(-100);
  });
});

describe("subtotal and total rows", () => {
  const statement = [
    "Bezeichnung;2024;2025",
    "1.1 Gesamtbetrag der ordentlichen Erträge;146848500;150546440",
    "1.2 Gesamtbetrag der ordentlichen Aufwendungen;-156203910;-160511160",
    "1.3 Ordentliches Ergebnis (Saldo aus 1.1 und 1.2);-9355410;-9964720",
    "1.4 Außerordentliche Erträge;5505200;1125000",
    "1.5 Außerordentliche Aufwendungen;0;0",
    "1.6 Sonderergebnis (Saldo aus 1.4 und 1.5);5505200;1125000",
    "1.7 Gesamtergebnis (Summe aus 1.3 und 1.6);-3850210;-8839720",
  ];

  it("leaves out rows that sum the rows above them", async () => {
    const { ds, report } = await read(statement.join("\n"), "haushalt.csv");
    expect(ds.rowCount).toBe(4);
    expect(report.warnings.join(" ")).toMatch(/Left out 3 subtotal and total rows/);
    expect(numbers(ds.columns, "2025").reduce((a, b) => a + b, 0)).toBe(-8839720);
  });

  it("keeps a row whose label only happens to say total", async () => {
    const shop = ["Product,Units,Revenue"];
    for (let i = 0; i < 12; i++) shop.push(`${i === 6 ? "Total Gym" : `Item ${i}`},${3 + i},${(3 + i) * 25}`);
    const { ds } = await read(shop.join("\n"), "shop.csv");
    expect(ds.rowCount).toBe(12);
  });
});

describe("notes at the end of a file", async () => {
  const rows = ["id,issue_d,funded_amnt,grade,term"];
  for (let i = 0; i < 30; i++)
    rows.push(`${1000 + i},${date(i)},${5000 + i * 100},${"ABC"[i % 3]},36 months`);
  rows.push("Total amount funded in policy code 1: 460296150");
  const { ds, report } = await read(rows.join("\n"), "loans.csv");

  it("are not counted as rows of data", () => {
    expect(ds.rowCount).toBe(30);
    expect(report.warnings.join(" ")).toMatch(/Left out a note at the end of the file/);
  });
});

describe("a pollutant reading", async () => {
  const rows = ["Date,NO2(GT),PT08.S1(CO)"];
  // Hourly readings repeat: a column of mostly different whole numbers would read as an id.
  for (let i = 0; i < 120; i++) rows.push(`${date(i)},${40 + (i % 17)},${900 + (i % 23) * 7}`);
  const s = await session(rows.join("\n"), "sensors.csv");
  const ctx = s.configure({ domainId: "generic", numberLocale: "INTL", currency: null });

  it("is averaged, never summed", () => {
    for (const name of ["NO2(GT)", "PT08.S1(CO)"])
      expect(ctx.profile.columns.find((c) => c.name === name)?.additivity).toBe("non-additive");
  });
});

describe("a chart over dates", async () => {
  const rows = ["Invoice ID,Date,Customer,Amount"];
  for (let i = 0; i < 80; i++) rows.push(`INV-${i},${i % 10 === 3 ? "" : date(i)},C${i % 12},${100 + i * 3}`);
  const s = await session(rows.join("\n"), "sales.csv");
  const ctx = s.configure({ domainId: "sales", numberLocale: "INTL", currency: null });

  it("says how many rows had no date and were left out", () => {
    const spec = ctx.charts.find((c) => c.x.kind === "time");
    if (!spec) throw new Error("no chart over time");
    const data = s.chart([], { specId: spec.id }, "INTL");
    expect(data?.notes).toContain("8 rows with no Date are left out of this chart.");
  });
});
