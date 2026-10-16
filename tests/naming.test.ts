/**
 * Names and wording (version 34.3): column names read with spaces, one
 * display name per KPI, grammar in generated sentences, measure names an
 * analyst would choose (no "(KPI)"), SQL views named after their measures,
 * one filter wording, export file names in one pattern, and reasons that
 * only promise an "Others" group when there are more groups than shown.
 */
import { describe, expect, it } from "vitest";
import {
  article,
  averageOf,
  friendly,
  friendlyStart,
  kpiLabel,
  totalOf,
  wasWere,
} from "@/engine/core/labels";
import { formatValue } from "@/engine/core/format";
import { describeFilter } from "@/engine/query/filter";
import { compileNames } from "@/engine/export/names";
import { viewNames } from "@/engine/export/sqlFile";
import { fitTopN } from "@/engine/charts/recommend";
import { exportFileName } from "@/lib/utils";
import { getDomain } from "@/registry";
import type { Dataset } from "@/engine/core/types";

describe("column names as people read them", () => {
  it("swap underscores for spaces and keep each word's case", () => {
    expect(friendly("New_order_date")).toBe("New order date");
    expect(friendly("GST_Amount")).toBe("GST Amount");
    expect(friendly("customer__ids ")).toBe("customer ids");
    expect(friendlyStart("customer_ids")).toBe("Customer ids");
  });

  it("never double a word: Total Amount stays Total Amount", () => {
    expect(totalOf("Total Amount")).toBe("Total Amount");
    expect(totalOf("Shipping_Fee")).toBe("Total Shipping Fee");
    expect(averageOf("Avg Price")).toBe("Avg Price");
    expect(averageOf("Unit_Price")).toBe("Average Unit Price");
  });

  it("give a KPI one display name, without its bracketed short form", () => {
    expect(kpiLabel({ name: "Gross sales (GMV)", short: "GMV" })).toBe("Gross sales");
    expect(kpiLabel({ name: "Net revenue" })).toBe("Net revenue");
  });
});

describe("grammar in generated sentences", () => {
  it.each([
    ["New customers", "were"],
    ["Units ordered", "were"],
    ["Gross sales (GMV)", "were"],
    ["Deals won", "were"],
    ["Net revenue", "was"],
    ["Repeat purchase rate", "was"],
    ["Gross margin %", "was"],
    ["Order status", "was"],
  ])("%s %s", (name, verb) => {
    expect(wasWere(name)).toBe(verb);
  });

  it.each([
    ["85.8 pp", "an"],
    ["8.2 pp", "an"],
    ["11%", "an"],
    ["18,500", "an"],
    ["110", "a"],
    ["5.2 pp", "a"],
    ["hour", "an"],
    ["unit", "a"],
    ["order", "an"],
  ])("%s takes '%s'", (next, a) => {
    expect(article(next)).toBe(a);
  });

  it("says 1 day, never 1 days", () => {
    expect(formatValue(1, "days", { locale: "INTL", currency: "INR", decimals: 0 })).toBe("1 day");
    expect(formatValue(2, "days", { locale: "INTL", currency: "INR", decimals: 0 })).toBe("2 days");
  });
});

describe("filters in one wording", () => {
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  it("reads 'Column: value' for every kind", () => {
    expect(describeFilter({ kind: "in", column: "Sales_Channel", values: ["Website"] }, day)).toBe(
      "Sales Channel: Website",
    );
    expect(
      describeFilter({ kind: "in", column: "Category", values: ["Apparel", "Footwear"], exclude: true }, day),
    ).toBe("Category: not Apparel, Footwear");
    expect(
      describeFilter(
        { kind: "dateRange", column: "order_date", from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 0, 31) },
        day,
      ),
    ).toBe("order date: 2026-01-01 – 2026-01-31");
  });
});

describe("export names", () => {
  const ds = (names: string[]): Dataset => ({
    id: "t",
    name: "t",
    rowCount: 0,
    columns: names.map((name) => ({
      kind: "number",
      name,
      values: new Float64Array(),
      format: { integer: false, decimals: 2 },
    })),
    source: { fileName: "t.csv", kind: "derived", sizeBytes: 0, isDemo: false },
  });
  const sales = getDomain("sales");

  it("name a measure that clashes with a column as an analyst would, never '(KPI)'", () => {
    if (!sales) throw new Error("no sales template");
    const names = compileNames(ds(["Revenue", "Invoices"]), sales);
    expect(names.measures.get("revenue")).toBe("Total revenue");
    expect(names.measures.get("invoices")).toBe("Total invoices");
    expect([...names.measures.values()].some((n) => n.includes("(KPI)"))).toBe(false);
  });

  it("let a measure share the table's name", () => {
    const ecommerce = getDomain("ecommerce");
    if (!ecommerce) throw new Error("no e-commerce template");
    const names = compileNames(ds(["Amount"]), ecommerce);
    expect(names.table).toBe("Orders");
    expect(names.measures.get("orders")).toBe("Orders");
  });

  it("name SQL views after their measures", () => {
    const views = viewNames(
      ["net_revenue", "gross_margin", "yc_avg_mrp", "dup"],
      new Map([
        ["net_revenue", "Net revenue"],
        ["gross_margin", "Gross margin %"],
        ["yc_avg_mrp", "Average MRP"],
        ["dup", "Net revenue"],
      ]),
    );
    expect([...views.values()]).toEqual([
      "kpi_net_revenue",
      "kpi_gross_margin_pct",
      "kpi_average_mrp",
      "kpi_net_revenue_2",
    ]);
  });

  it("give every download one pattern: dataset, artefact, date", () => {
    expect(exportFileName("Sales Orders Q3", "dashboard-report", "pdf")).toMatch(
      /^sales-orders-q3_dashboard-report_\d{4}-\d{2}-\d{2}\.pdf$/,
    );
    expect(exportFileName(undefined, "Net revenue by state", "png")).toMatch(
      /^loupe_net-revenue-by-state_\d{4}-\d{2}-\d{2}\.png$/,
    );
  });
});

describe("chart reasons", () => {
  it("only promise 'top 10 plus Others' when there are more than ten groups", () => {
    const a =
      "Comparing one measure across named categories: sorted bars keep labels readable. Top 10 plus Others.";
    expect(fitTopN(a, 6, 10)).toBe(
      "Comparing one measure across named categories: sorted bars keep labels readable.",
    );
    expect(fitTopN(a, 24, 10)).toBe(a);
    expect(fitTopN("Sorted bars, top 15 plus Others.", 4, 15)).toBe("Sorted bars.");
    expect(fitTopN("Sorted bars, top 10 plus Others, with drill-down to products.", 5, 10)).toBe(
      "Sorted bars, with drill-down to products.",
    );
  });
});
