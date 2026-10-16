/**
 * "12 of 15 columns used": the columns left out can be named and explained
 * (engine/charts/columnUsage whyUnused), and a numbered place or thing ("Room
 * Number") is read as an ID, so it is never summed or averaged into a KPI.
 */
import { describe, expect, it } from "vitest";
import { Session } from "@/engine/session";
import { columnUsage, isUsed, whyUnused } from "@/engine/charts/columnUsage";
import type { ColumnProfile } from "@/engine/profile/types";

/** A hospital-admissions file shaped like the public healthcare dataset (15 columns). */
function hospitalCsv(rows: number): string {
  const lines = [
    "Name,Age,Gender,Blood Type,Medical Condition,Date of Admission,Doctor,Hospital,Insurance Provider,Billing Amount,Room Number,Admission Type,Discharge Date,Medication,Test Results",
  ];
  const pick = <T>(a: T[], i: number) => a[i % a.length] as T;
  for (let i = 0; i < rows; i++) {
    const day = (n: number) => new Date(Date.UTC(2020, 0, 1) + n * 86400000).toISOString().slice(0, 10);
    lines.push(
      [
        `Patient ${i}`,
        20 + (i % 60),
        pick(["Male", "Female"], i),
        pick(["A+", "A-", "B+", "B-", "O+", "O-"], i * 7),
        pick(["Cancer", "Obesity", "Diabetes", "Asthma"], i * 3),
        day(i % 900),
        `Dr ${i % 700}`,
        `Hospital ${i % 650}`,
        pick(["Aetna", "Cigna", "Medicare"], i * 5),
        (1000 + ((i * 7919) % 40000)).toFixed(2),
        101 + ((i * 37) % 400),
        pick(["Urgent", "Emergency", "Elective"], i * 11),
        day((i % 900) + 1 + (i % 20)),
        pick(["Aspirin", "Ibuprofen", "Lipitor"], i * 13),
        pick(["Normal", "Abnormal", "Inconclusive"], i * 17),
      ].join(","),
    );
  }
  return lines.join("\n");
}

describe("the columns a dashboard leaves out", () => {
  it("are named, each with a reason, and a room number is an ID", async () => {
    const s = new Session();
    const load = await s.ingest(new Blob([hospitalCsv(1500)]), "hospital.csv", {});
    if (load.status !== "ok") throw new Error(load.status);
    const top = load.detection.candidates[0];
    if (!top) throw new Error("not detected");
    const ctx = s.configure({ domainId: top.domainId, numberLocale: "INTL", currency: null });
    const room = ctx.profile.columns.find((c) => c.name === "Room Number");
    expect(room?.role).toBe("identifier");
    const usage = columnUsage(ctx, ctx.charts);
    const unused = ctx.profile.columns.filter((c) => !isUsed(usage.get(c.name))).map((c) => c.name);
    expect(unused).toEqual(expect.arrayContaining(["Doctor", "Hospital"]));
    for (const name of unused) {
      const c = ctx.profile.columns.find((x) => x.name === name) as ColumnProfile;
      const why = whyUnused(c, { dateColumn: ctx.dateColumn, locale: "INTL" });
      expect(why.reason.length, name).toBeGreaterThan(10);
    }
    const doctor = ctx.profile.columns.find((c) => c.name === "Doctor") as ColumnProfile;
    expect(whyUnused(doctor, { dateColumn: ctx.dateColumn, locale: "INTL" }).reason).toBe(
      "700 different values: too many to group or filter by.",
    );
  });

  it("explain each kind of column in plain words", () => {
    const base: ColumnProfile = {
      name: "Notes",
      storage: "string",
      role: "text",
      distinct: 900,
      nullPct: 0.1,
      unique: false,
    } as ColumnProfile;
    const why = (over: Partial<ColumnProfile>, extra: { mappedTo?: string } = {}) =>
      whyUnused({ ...base, ...over }, { dateColumn: "Order Date", locale: "INTL", ...extra }).reason;
    expect(why({ nullPct: 0.97 })).toBe("Almost empty: 97% of its rows are blank.");
    expect(why({ distinct: 1 })).toBe("The same value on every row, so there is nothing to compare.");
    expect(why({ name: "Ship_Date", role: "datetime", storage: "date" })).toBe(
      "A second date: periods, trends and the date filter follow Order Date.",
    );
    expect(why({ role: "identifier", unique: true })).toMatch(/^An ID that differs on every row/);
    expect(why({})).toBe("Free text with 900 different values: too varied to chart or filter by.");
    expect(why({ role: "dimension", distinct: 40 }, { mappedTo: "Channel" })).toMatch(/^Read as “Channel”/);
  });
});
