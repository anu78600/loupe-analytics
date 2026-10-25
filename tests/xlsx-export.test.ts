/**
 * The Excel workbook (version 56.0): read back with SheetJS, it holds the
 * Summary, one sheet per chart, the Data and the Dictionary; its KPI values
 * and chart values are the dashboard's own, in native number formats; the
 * Data sheet holds the rows behind the dashboard, so its revenue column adds
 * up to the Revenue KPI; and yes/no words stay words. Sales demo, default
 * period, as the app computes it.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { Session } from "@/engine/session";
import { defaultPreset, presetRange } from "@/engine/kpi/compute";
import type { Filter } from "@/engine/query/filter";
import { chartTable } from "@/engine/export/chartTable";
import { columnLetters, sheetNames, xlsxWorkbook } from "@/engine/export/xlsx";

function workbookOf(sample: string) {
  const session = new Session();
  const load = session.ingestSample(sample);
  if (load.status !== "ok") throw new Error(load.status);
  const ctx = session.configure({ domainId: sample, numberLocale: "INTL", currency: null });
  const range = ctx.dateBounds ? presetRange(defaultPreset(ctx.dateBounds), ctx.dateBounds) : null;
  const filters: Filter[] =
    range && ctx.dateColumn
      ? [{ kind: "dateRange", column: ctx.dateColumn, from: range.from, to: range.to }]
      : [];
  const ids = [...ctx.selection.hero, ...ctx.selection.supporting];
  const batch = session.kpiBatch(filters, ids, "INTL");
  const charts = ctx.charts
    .slice(0, 6)
    .map((spec) => ({ spec, data: session.chart(filters, { specId: spec.id }, "INTL") }));
  const kpis = ids.flatMap((id) => {
    const k = ctx.kpis.find((m) => m.id === id);
    return k ? [{ id, name: k.name, format: k.format, definition: k.definition }] : [];
  });
  const bytes = session.exportXlsx({
    filters,
    kpis,
    charts: charts.map((c) => ({ id: c.spec.id, title: c.spec.title })),
    title: "Sales dashboard",
    subtitle: "Demo",
    facts: [{ label: "Period", value: "Last 12 months" }],
    numberLocale: "INTL",
  });
  const book = XLSX.read(bytes, { type: "array", cellNF: true });
  return { session, ctx, filters, batch, charts, kpis, book };
}

describe("the sales demo's workbook", () => {
  const { ctx, filters, batch, charts, kpis, book } = workbookOf("sales");

  it("has the summary, a sheet per chart, the data and the dictionary", () => {
    expect(book.SheetNames[0]).toBe("Summary");
    expect(book.SheetNames.slice(-2)).toEqual(["Data", "Dictionary"]);
    expect(book.SheetNames).toHaveLength(charts.length + 3);
  });

  it("lists the dashboard's KPIs with their own values, in native formats", () => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Summary as XLSX.WorkSheet, { header: 1 });
    const head = rows.findIndex((r) => r[0] === "KPI");
    expect(head).toBeGreaterThan(0);
    kpis.forEach((k, i) => {
      const row = rows[head + 1 + i] as unknown[];
      expect(row[0]).toBe(k.name);
      const v = batch.values.find((x) => x.id === k.id)?.value ?? null;
      if (v === null) expect(row[1] ?? null).toBeNull();
      else expect(row[1] as number).toBeCloseTo(v, 9);
    });
    const ws = book.Sheets.Summary as XLSX.WorkSheet;
    const revenueRow = head + 1 + kpis.findIndex((k) => k.id === "revenue");
    expect(ws[`B${revenueRow + 1}`]?.z).toContain("#,##0.00");
  });

  it("gives each chart its values, as the chart CSV has them", () => {
    charts.forEach((c, i) => {
      if (!c.data) return;
      const t = chartTable(c.data);
      const ws = book.Sheets[book.SheetNames[i + 1] as string] as XLSX.WorkSheet;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true });
      // An empty header cell (a heatmap's corner) is left empty.
      expect(rows[3]).toEqual(t.header.map((h) => h || undefined));
      t.rows.forEach((r, j) => {
        r.slice(1).forEach((v, k) => {
          const got = (rows[4 + j] as unknown[])[k + 1];
          if (typeof v === "number") expect(got as number).toBeCloseTo(v, 9);
        });
      });
    });
  });

  it("holds the rows behind the dashboard, which add up to its revenue", () => {
    const amount = ctx.mapping.fields.amount as string;
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.Data as XLSX.WorkSheet);
    const rowsInView = filters.length ? data.length : -1;
    expect(rowsInView === -1 || rowsInView > 0).toBe(true);
    const total = data.reduce((s, r) => s + (typeof r[amount] === "number" ? (r[amount] as number) : 0), 0);
    const revenue = batch.values.find((v) => v.id === "revenue")?.value as number;
    expect(ctx.kpis.find((k) => k.id === "revenue")?.variantLabel).toBe("Revenue column");
    expect(total).toBeCloseTo(revenue, 4);
  });
});

describe("the workbook writer", () => {
  it("names sheets as Excel allows, uniquely", () => {
    expect(
      sheetNames([
        "Summary",
        "summary",
        "Sales: by region / month?",
        "Average length of stay by discharge month",
      ]),
    ).toEqual(["Summary", "summary (2)", "Sales by region month", "Average length of stay by…"]);
    expect(columnLetters(0)).toBe("A");
    expect(columnLetters(27)).toBe("AB");
  });

  it("keeps yes/no words as words, true/false as booleans, dates as dates and text as text", () => {
    const bytes = xlsxWorkbook([
      {
        name: "T",
        widths: [10, 10, 10, 10],
        styles: [undefined, undefined, "date", undefined],
        rows: [
          ["Paid", "Flag", "When", "Note"],
          ["Yes", true, 45658, "=SUM(A1)"],
        ],
        table: { headerRow: 1, columns: 4 },
      },
    ]);
    const ws = XLSX.read(bytes, { type: "array", cellNF: true }).Sheets.T as XLSX.WorkSheet;
    expect(ws.A2?.v).toBe("Yes");
    expect(ws.B2?.t).toBe("b");
    expect(ws.C2?.z).toBe("yyyy-mm-dd");
    expect(ws.D2?.t).toBe("s");
    expect(ws.D2?.f).toBeUndefined();
    expect(ws["!autofilter"]?.ref).toBe("A1:D2");
  });
});
