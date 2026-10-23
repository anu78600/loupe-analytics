/**
 * Check & map's review table (ui/workspace/review/model.ts, version 50.2):
 * each column's health badges, read from the data-health issues and the data
 * check's views, with the rows behind each where the check lists them; the
 * kinds a "Read as" select offers; the filters and the search, whose counts
 * agree with the rows; and the sentence a "Matched to" change says with its
 * Undo.
 */
import { describe, expect, it } from "vitest";
import type { ColumnUse } from "@/engine/charts/columnUsage";
import type { ColumnProfile } from "@/engine/profile/types";
import { Session } from "@/engine/session";
import {
  feedsText,
  filterCounts,
  healthBadges,
  kindFromRole,
  matchMessage,
  matchesQuery,
  needsALook,
  readAsOptions,
  visibleRows,
  type ReviewRow,
} from "@/ui/workspace/review/model";

describe("review table", async () => {
  const lines = ["Order ID,Order Date,Quantity,City,Coupon Code,Country,Notes"];
  const cities = ["Pune", "Delhi", "Surat", "Patna", "Agra"];
  for (let i = 0; i < 200; i++)
    lines.push(
      [
        `ORD${String(i).padStart(5, "0")}`,
        `2025-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
        // Three returns written as negative quantities.
        i % 67 === 5 ? -2 : 1 + (i % 4),
        // Six blanks in an otherwise filled column: probably missing.
        i % 33 === 7 ? "" : cities[i % 5],
        // Mostly blank: a coupon applies to some orders only.
        i % 4 === 0 ? `SAVE${i % 3}` : "",
        "India",
        i % 10 === 0 ? `note ${i}` : "",
      ].join(","),
    );
  const s = new Session();
  const load = await s.ingest(new Blob([lines.join("\n")]), "orders.csv", {});
  if (load.status !== "ok") throw new Error(load.status);
  const views = s.checkViews();
  const col = (name: string): ColumnProfile => {
    const c = load.profile.columns.find((x) => x.name === name);
    if (!c) throw new Error(name);
    return c;
  };
  const badges = (name: string, withViews = true) =>
    healthBadges(col(name), load.health.issues, withViews ? views : null, "INTL");

  it("names a column's problems in a few words, with the rows that show them", () => {
    const qty = badges("Quantity");
    expect(qty[0]).toMatchObject({
      label: "3 negative",
      tone: "warning",
      view: "issue:negative-Quantity",
      rows: 3,
    });
    const city = badges("City");
    expect(city).toEqual([
      expect.objectContaining({ label: "6 blanks", tone: "warning", view: "blank:City", rows: 6 }),
    ]);
    // A column of one value says so; it is worth knowing, not a problem.
    expect(badges("Country")).toEqual([expect.objectContaining({ label: "One value", tone: "info" })]);
  });

  it("speaks of blanks once, as a share when most of the column is blank", () => {
    const coupon = badges("Coupon Code");
    expect(coupon.filter((b) => /blank/.test(b.label))).toHaveLength(1);
    expect(coupon[0]?.label).toBe("75% blank");
    expect(coupon[0]?.view).toBe("blank:Coupon Code");
  });

  it("puts problems before what is merely worth knowing", () => {
    for (const c of load.profile.columns) {
      const tones = badges(c.name).map((b) => b.tone);
      expect(tones.join(",")).toBe(
        [...tones].sort((a, b) => (a === b ? 0 : a === "warning" ? -1 : 1)).join(","),
      );
    }
  });

  it("gives the badges without rows while the check is loading", () => {
    expect(badges("Quantity", false)[0]).toMatchObject({ label: "3 negative" });
    expect(badges("Quantity", false)[0]?.view).toBeUndefined();
    expect(badges("Order ID")).toEqual([]);
  });

  it("reads a role back as the kind it stands for", () => {
    expect(kindFromRole(col("Order ID"))).toBe("id");
    expect(kindFromRole(col("Order Date"))).toBe("time");
    expect(kindFromRole(col("City"))).toBe("place");
    expect(kindFromRole({ ...col("Quantity"), role: "measure", additivity: "non-additive" })).toBe(
      "measurement",
    );
    expect(kindFromRole({ ...col("Quantity"), role: "currency" })).toBe("amount");
    expect(kindFromRole({ ...col("Quantity"), role: "percentage" })).toBe("rate");
  });

  it("offers the kinds Detect offers, a date or the outcome first and not choosable", () => {
    expect(readAsOptions("category").every((o) => o.settable)).toBe(true);
    expect(readAsOptions("category").map((o) => o.label)).toContain("Measurement");
    const date = readAsOptions("time");
    expect(date[0]).toEqual({ kind: "time", label: "Date", settable: false });
    expect(readAsOptions("outcome")[0]?.settable).toBe(false);
  });

  it("says what a column feeds in one line", () => {
    const use: ColumnUse = { kpis: ["Revenue"], charts: ["A", "B"], filters: ["Date filter"] };
    expect(feedsText(use)).toBe("1 KPI · 2 charts · Date filter");
    expect(feedsText({ kpis: ["a", "b"], charts: [], filters: [] })).toBe("2 KPIs");
    expect(feedsText(undefined)).toBe("");
  });

  it("filters and searches the same rows its counts are taken from", () => {
    const row = (name: string, status: ReviewRow["status"], kind: ReviewRow["kind"]): ReviewRow => ({
      column: col(name),
      status,
      kind,
      health: status === "hidden" ? [] : badges(name),
    });
    const rows = [
      row("Order ID", "used", "id"),
      row("Quantity", "used", "amount"),
      row("City", "used", "place"),
      row("Country", "unused", "category"),
      { ...row("Notes", "hidden", "text"), field: { id: "notes", label: "Remarks" } },
    ];
    const counts = filterCounts(rows);
    expect(counts).toEqual({ all: 5, used: 3, unused: 1, hidden: 1, attention: 2 });
    for (const f of ["all", "used", "unused", "hidden", "attention"] as const)
      expect(visibleRows(rows, f, "")).toHaveLength(counts[f]);
    expect(rows.filter(needsALook).map((r) => r.column.name)).toEqual(["Quantity", "City"]);
    // By name, by the field it fills and by the kind it is read as; accents and case don't matter.
    expect(visibleRows(rows, "all", "qUANT").map((r) => r.column.name)).toEqual(["Quantity"]);
    expect(matchesQuery(rows[4] as ReviewRow, "remarks")).toBe(true);
    expect(visibleRows(rows, "all", "pláce").map((r) => r.column.name)).toEqual(["City"]);
    expect(visibleRows(rows, "used", "country")).toEqual([]);
  });

  it("words a Matched to change by what it took from where", () => {
    expect(
      matchMessage({ column: "Customer City", to: "State", from: "City", displaced: "Customer State" }),
    ).toBe(
      "“Customer City” now fills State in place of “Customer State”, so City has no column. Map another column to it, or undo.",
    );
    expect(matchMessage({ column: "Net Amt", to: "Net revenue", from: "Gross revenue" })).toBe(
      "“Net Amt” now fills Net revenue, so Gross revenue has no column. Map another column to it, or undo.",
    );
    expect(matchMessage({ column: "Net Amt", to: "Net revenue", displaced: "Amount" })).toBe(
      "“Net Amt” now fills Net revenue in place of “Amount”.",
    );
    // An unmatched column given an empty field took nothing: no toast.
    expect(matchMessage({ column: "Net Amt", to: "Net revenue" })).toBeNull();
    expect(matchMessage({ column: "Net Amt", to: null, from: "Net revenue" })).toMatch(
      /no longer fills Net revenue/,
    );
    expect(matchMessage({ column: "Net Amt", to: null })).toBeNull();
  });
});
