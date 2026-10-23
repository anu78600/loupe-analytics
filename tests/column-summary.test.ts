/**
 * Column summaries (ui/workspace/columnSummary.ts), shown in Check & map's
 * review table and its row details: numbers follow the number-format
 * setting with a true minus sign, percentages read as percentages whether
 * stored as fractions ("22.39%" in the file) or as points, and years, IDs
 * and postal codes keep their digits as written.
 */
import { describe, expect, it } from "vitest";
import { Session } from "@/engine/session";
import { dataSummary, kindLabel } from "@/ui/workspace/columnSummary";

describe("column summaries", async () => {
  const lines = ["ORDERNUMBER,YEAR_ID,CTR,Conversion %,Spend,Pincode,Change,Fiscal Year"];
  for (let i = 0; i < 120; i++)
    lines.push(
      [
        10100 + i,
        2003 + (i % 3),
        `${(1.88 + (i % 24) * 0.89).toFixed(2)}%`,
        (i % 37) + 0.5,
        321000 + i * 56000,
        400001 + i * 37,
        i % 2 ? -1200.5 + i : 340 + i,
        2024,
      ].join(","),
    );
  const s = new Session();
  const load = await s.ingest(new Blob([lines.join("\n")]), "campaigns.csv", {});
  if (load.status !== "ok") throw new Error(load.status);
  const col = (name: string) => {
    const c = load.profile.columns.find((x) => x.name === name);
    if (!c) throw new Error(name);
    return c;
  };

  it("follow the number format, with a true minus sign", () => {
    expect(dataSummary(col("Spend"), "IN")).toMatch(/^3,21,000 to 69,85,000 · 120 distinct$/);
    expect(dataSummary(col("Spend"), "INTL")).toMatch(/^321,000 to 6,985,000 · 120 distinct$/);
    expect(dataSummary(col("Change"), "INTL")).toMatch(/^−1,199.50 to 458.00/);
  });

  it("read percentages as percentages, however they are stored", () => {
    // "22.39%" in the file is stored as a fraction; "Conversion %" holds points.
    expect(dataSummary(col("CTR"), "IN")).toMatch(/^1\.9% to 22\.4% · /);
    expect(dataSummary(col("Conversion %"), "IN")).toMatch(/^0\.5% to 36\.5% · /);
  });

  it("write years, IDs and postal codes without separators", () => {
    expect(dataSummary(col("YEAR_ID"), "IN")).toMatch(/^2003 to 2005 · 3 distinct$/);
    // One value is said once: "2024", not "2024 to 2024".
    expect(dataSummary(col("Fiscal Year"), "IN")).toBe("2024 · 1 distinct");
    expect(dataSummary(col("ORDERNUMBER"), "INTL")).toMatch(/^10100 to 10219 · /);
    expect(kindLabel(col("Spend"))).toBe("Whole number");
    expect(kindLabel(col("Change"))).toBe("Number");
  });
});
