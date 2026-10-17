/**
 * The dataset currency from a money column's header (version 41.0). Since
 * names.ts folds every currency sign, code and word into the one token
 * "money", the profiler asks nameCurrency for the actual currency, so a file
 * whose values carry no symbol still shows its amounts in the currency its
 * header names, not in the default rupees.
 */
import { describe, expect, it } from "vitest";
import { profileDataset } from "@/engine/profile/profile";
import { parseCsv } from "./helpers/layouts";

async function currencyOf(header: string): Promise<string> {
  const rows = Array.from({ length: 30 }, (_, i) => `${i + 1},${(120 + i * 7.5).toFixed(2)}`);
  const ds = await parseCsv([`Row,${header}`, ...rows].join("\n"), "currency");
  return profileDataset(ds).currency.code;
}

describe("the dataset currency from a header", () => {
  it.each([
    ["Amount (USD)", "USD"],
    ["Revenue_EUR", "EUR"],
    ["Salary (GBP)", "GBP"],
    ["Price in Dollars", "USD"],
    ["Price (₹)", "INR"],
    ["Receita (R$)", "BRL"],
    ["Montant (€)", "EUR"],
  ])("%s → %s", async (header, code) => {
    expect(await currencyOf(header)).toBe(code);
  });
});
