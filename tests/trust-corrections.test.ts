/**
 * Stage 1 of the roadmap, trust first (version 52.2), each case rebuilt from a
 * file of the public corpus or the owner's own:
 * - no currency symbol unless the file shows one (a Myanmar supermarket read
 *   as ₹), and the number format from the browser when it doesn't;
 * - a weakly fitting industry no longer leads with its own KPIs, and a
 *   detection under 40% that fills less than half the columns fits weakly;
 * - totals that must add up are tested (gross − discounts = revenue);
 * - the event date leads (issue_d, not earliest_cr_line), and "Dates by"
 *   switches it;
 * - amounts named by year are not counts; a numbered register is a label,
 *   nights stayed a count, a department not a US state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Session, fitOf, UNSURE_CONFIDENCE } from "@/engine/session";
import { currencySymbol, formatValue } from "@/engine/core/format";
import { browserNumberLocale } from "@/store/settings";
import { getDomain } from "@/registry";
import type { Mapping } from "@/engine/detect/mapping";
import type { DatasetProfile } from "@/engine/profile/types";

async function load(csv: string, name = "data.csv") {
  const s = new Session();
  const res = await s.ingest(new Blob([csv]), name, {});
  if (res.status !== "ok") throw new Error(res.status);
  return { s, res };
}

const date = (i: number) =>
  `2024-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`;

describe("currency and number format", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows no symbol when the file names no currency", async () => {
    const rows = ["Invoice ID,Date,Branch,Total"];
    for (let i = 0; i < 40; i++) rows.push(`INV-${i},${date(i)},${"ABC"[i % 3]},${100 + i}`);
    const { res } = await load(rows.join("\n"), "supermarket.csv");
    expect(res.profile.currency.code).toBe("");
    expect(currencySymbol("")).toBe("");
    expect(formatValue(1234567, "currency", { locale: "INTL", currency: "" })).toBe("1,234,567");
  });

  it("keeps ₹ when the values show it", async () => {
    const rows = ["Invoice ID,Date,Amount"];
    for (let i = 0; i < 40; i++) rows.push(`INV-${i},${date(i)},"₹${1000 + i * 37}"`);
    const { res } = await load(rows.join("\n"));
    expect(res.profile.currency.code).toBe("INR");
  });

  it("reads lakh and crore for an Indian browser, international otherwise", () => {
    vi.stubGlobal("navigator", { language: "en-IN" });
    expect(browserNumberLocale()).toBe("IN");
    vi.stubGlobal("navigator", { language: "hi" });
    expect(browserNumberLocale()).toBe("IN");
    vi.stubGlobal("navigator", { language: "en-GB" });
    expect(browserNumberLocale()).toBe("INTL");
  });
});

describe("an industry that fits weakly", () => {
  it("counts a low-confidence detection that fills less than half the columns as weak", () => {
    const domain = getDomain("telecom");
    if (!domain) throw new Error("no telecom");
    const columns = Array.from({ length: 7 }, (_, i) => ({ name: `c${i}`, nullPct: 0 }));
    const profile = { columns } as unknown as DatasetProfile;
    const core = domain.fields.filter((f) => f.core).slice(0, 3);
    const mapping = {
      fields: Object.fromEntries(core.map((f, i) => [f.id, `c${i}`])),
    } as unknown as Mapping;
    expect(fitOf(domain, mapping, profile).weak).toBe(false);
    expect(fitOf(domain, mapping, profile, UNSURE_CONFIDENCE - 2).weak).toBe(true);
    expect(fitOf(domain, mapping, profile, UNSURE_CONFIDENCE + 10).weak).toBe(false);
  });

  it("leads with the plan's KPIs, and the plan lists them in that order", async () => {
    const rows = ["Department,Month,Payroll Budget,Payroll Actual"];
    for (let i = 0; i < 36; i++)
      rows.push(`${["Sales", "Ops", "Tech"][i % 3]},${date(i)},${40 + (i % 3) * 10},${38 + (i % 7)}`);
    const { s } = await load(rows.join("\n"), "payroll.csv");
    const ctx = s.configure({ domainId: "hr", numberLocale: "INTL", currency: null });
    expect(ctx.fit.weak).toBe(true);
    expect(ctx.selection.hero.some((id) => id.startsWith("yc_"))).toBe(true);
    const kpis = ctx.plan.filter((p) => p.type === "kpi").map((p) => p.id);
    expect(kpis).toEqual([...ctx.selection.hero, ...ctx.selection.supporting, ...ctx.selection.columns]);
  });
});

describe("totals that must add up", () => {
  const sales = (net: (gross: number, disc: number) => number) => {
    const rows = ["Invoice ID,Date,Customer,Gross Amount,Discount Amount,Net Amount"];
    for (let i = 0; i < 60; i++) {
      const gross = 200 + ((i * 31) % 500);
      const disc = i % 4 ? 0 : 20;
      rows.push(`INV-${i},${date(i)},C${i % 9},${gross},${disc},${net(gross, disc)}`);
    }
    return rows.join("\n");
  };

  it("passes when gross − discounts gives revenue", async () => {
    const { s } = await load(
      sales((g, d) => g - d),
      "invoices.csv",
    );
    const ctx = s.configure({ domainId: "sales", numberLocale: "INTL", currency: null });
    expect(ctx.reconciliations).toEqual([expect.objectContaining({ ok: true, result: expect.any(String) })]);
  });

  it("flags the gap when the file's own columns disagree", async () => {
    const { s } = await load(
      sales((g) => g),
      "invoices.csv",
    );
    const ctx = s.configure({ domainId: "sales", numberLocale: "INTL", currency: null });
    const r = ctx.reconciliations[0];
    expect(r?.ok).toBe(false);
    expect((r?.actual ?? 0) - (r?.expected ?? 0)).toBe(15 * 20);
    expect(r?.columns).toEqual(expect.arrayContaining(["Gross Amount", "Discount Amount", "Net Amount"]));
  });

  it("tests nothing that holds by construction", async () => {
    const rows = ["Order ID,Date,Quantity,Unit Price,Discount %"];
    for (let i = 0; i < 40; i++) rows.push(`O-${i},${date(i)},${1 + (i % 4)},${10 + i},${(i % 3) * 0.1}`);
    const { s } = await load(rows.join("\n"), "orders.csv");
    const ctx = s.configure({ domainId: "sales", numberLocale: "INTL", currency: null });
    expect(ctx.reconciliations).toEqual([]);
  });
});

describe("the date the dashboard reads", () => {
  const loans = () => {
    const rows = ["id,earliest_cr_line,issue_d,loan_amnt,funded_amnt,grade"];
    for (let i = 0; i < 80; i++)
      rows.push(
        `${1000 + i},${1990 + (i % 20)}-01-01,${date(i)},${5000 + i * 50},${5000 + i * 50},${"ABC"[i % 3]}`,
      );
    return rows.join("\n");
  };

  it("leads with the event date, not the borrower's first credit line", async () => {
    const { res } = await load(loans(), "loans.csv");
    expect(res.profile.primaryDate).toBe("issue_d");
  });

  it("switches every date with Dates by", async () => {
    const { s } = await load(loans(), "loans.csv");
    const ctx = s.configure({
      domainId: "generic",
      numberLocale: "INTL",
      currency: null,
      primaryDate: "earliest_cr_line",
    });
    expect(ctx.dateColumn).toBe("earliest_cr_line");
    expect(ctx.dateField).toBeNull();
  });
});

describe("what a column is", () => {
  it("reads amounts named by year as amounts, not counts", async () => {
    const rows = ["Bezeichnung;2024;2025"];
    for (let i = 0; i < 12; i++)
      rows.push(`Position ${i};${(i % 2 ? -1 : 1) * (1000000 + i * 37000)};${(i % 3 ? 1 : -1) * 900000}`);
    const { s } = await load(rows.join("\n"), "haushalt.csv");
    const ctx = s.configure({ domainId: "generic", numberLocale: "INTL", currency: null });
    for (const k of ctx.kpis.filter((x) => /^Total 202/.test(x.name))) expect(k.format).not.toBe("integer");
  });

  it("reads a register as a label, nights as a count and a department as no place", async () => {
    const rows = ["transaction_id,register,stays_in_week_nights,reorderLevel,Department,amount"];
    for (let i = 0; i < 300; i++)
      rows.push(
        `${i},${1 + (i % 5)},${i % 8},${[0, 5, 10, 15, 20, 25, 30][i % 7]},${i % 3 ? "DE" : "Defra"},${(i * 7.3).toFixed(2)}`,
      );
    const { res } = await load(rows.join("\n"));
    const role = (n: string) => res.profile.columns.find((c) => c.name === n)?.role;
    expect(role("register")).toBe("dimension");
    expect(role("stays_in_week_nights")).toBe("measure");
    expect(role("reorderLevel")).toBe("measure");
    expect(role("Department")).not.toBe("geo");
  });
});
