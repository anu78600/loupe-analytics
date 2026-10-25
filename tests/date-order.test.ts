/**
 * Dates out of order (version 54.1): a stay that ends before it starts is left
 * out of the length of stay rather than averaged in as a negative, in the
 * evaluator, SQL and DAX alike; Data health names such rows (and says when
 * swapping day and month would put them right) and a time axis that thins
 * out at its end. Checked on small made-up tables.
 */
import { describe, expect, it } from "vitest";
import { Session } from "@/engine/session";
import { rowExprSql } from "@/engine/compile/sql";
import { rowExprDax } from "@/engine/compile/dax";
import { wrapLabel } from "@/ui/charts/options";

async function sessionOf(lines: string[]) {
  const s = new Session();
  const load = await s.ingest(new Blob([lines.join("\n")]), "stays.csv", {});
  if (load.status !== "ok") throw new Error(load.status);
  return s;
}

// Six stays; E5 is discharged three days before it is admitted (a swapped 03/05 ↔ 05/03 would fix it).
const STAYS = [
  "Encounter ID,Date of Admission,Discharge Date,Department,Billing Amount",
  "E1,2024-01-10,2024-01-14,Cardiology,1200",
  "E2,2024-01-20,2024-01-22,Cardiology,800",
  "E3,2024-02-03,2024-02-09,Oncology,2500",
  "E4,2024-02-15,2024-02-15,Oncology,300",
  "E5,2024-05-03,2024-03-04,Surgery,900",
  "E6,2024-03-11,2024-03-16,Surgery,1500",
];

describe("a stay that ends before it starts", () => {
  it("is left out of the average length of stay", async () => {
    const s = await sessionOf(STAYS);
    const ctx = s.configure({ domainId: "healthcare", numberLocale: "INTL", currency: null });
    const alos = s.kpiBatch([], ["alos"], "INTL").values.find((v) => v.id === "alos");
    // (4 + 2 + 6 + 0 + 5) ÷ 5: E5 is not counted, and nothing is negative.
    expect(alos?.value).toBeCloseTo(17 / 5, 9);
    expect(ctx.kpis.find((k) => k.id === "alos")?.available).toBe(true);
  });

  it("is named in Data health, with the day/month hint", async () => {
    const s = await sessionOf(STAYS);
    const ctx = s.configure({ domainId: "healthcare", numberLocale: "INTL", currency: null });
    const issue = ctx.health.issues.find((i) => i.id === "order-Discharge Date");
    expect(issue?.count).toBe(1);
    expect(issue?.title).toBe('"Discharge Date" before "Date of Admission"');
    expect(ctx.health.checks.find((c) => c.id === "dates")?.passed).toBe(false);
  });

  it("is blank in SQL and DAX too", () => {
    const e = { daysBetween: ["a", "b"] as [string, string], inOrder: true as const };
    const sql = rowExprSql(e, { col: (f: string) => `"${f}"` } as Parameters<typeof rowExprSql>[1]);
    expect(sql).toBe(
      `CASE WHEN CAST("b" AS DATE) >= CAST("a" AS DATE) THEN (CAST("b" AS DATE) - CAST("a" AS DATE)) END`,
    );
    const dax = rowExprDax(e, { col: (f: string) => `T[${f}]` } as Parameters<typeof rowExprDax>[1]);
    expect(dax).toContain("INT ( T[b] ) < INT ( T[a] )");
  });
});

describe("a time axis that thins out at its end", () => {
  const month = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const rows = (tail: boolean) => {
    const out = ["Order ID,Order Date,Amount"];
    let id = 0;
    for (let k = 0; k < 24; k++)
      for (let d = 1; d <= 28; d++)
        out.push(`O${id++},${month(2022 + Math.floor(k / 12), (k % 12) + 1, d)},100`);
    if (tail) for (const m of [1, 2, 3]) out.push(`O${id++},${month(2024, m, 5)},100`);
    return out;
  };

  it("is flagged, with the month the data seems to end", async () => {
    const s = await sessionOf(rows(true));
    const ctx = s.configure({ domainId: "generic", numberLocale: "INTL", currency: null });
    const issue = ctx.health.issues.find((i) => i.id === "thin-tail-Order Date");
    expect(issue?.title).toBe("Data thins out after Dec 2023");
    expect(issue?.count).toBe(3);
  });

  it("is not flagged when every month is full", async () => {
    const s = await sessionOf(rows(false));
    const ctx = s.configure({ domainId: "generic", numberLocale: "INTL", currency: null });
    expect(ctx.health.issues.some((i) => i.id.startsWith("thin-tail-"))).toBe(false);
  });
});

it("breaks a range label after its dash, keeping each number whole", () => {
  expect(wrapLabel("100–150", 5)).toBe("100–\n150");
});
