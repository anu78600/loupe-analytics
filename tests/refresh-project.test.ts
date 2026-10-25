/**
 * Refreshing a dashboard with next month's file (version 55.0): the new
 * file's columns are matched with the saved ones (a rename is taken only when
 * it is unambiguous, and the column is read under its saved name), the saved
 * settings drop what names a missing column, and the report counts what the
 * dashboard kept. Made-up tables only.
 */
import { describe, expect, it } from "vitest";
import { Session } from "@/engine/session";
import { compareColumns } from "@/engine/parse/matchColumns";
import { fitConfig } from "@/engine/export/refresh";
import type { LoupeConfig } from "@/engine/export/config";
import type { KpiMeta } from "@/engine/session";
import { buildRefreshReport, nothingChanged } from "@/ui/workspace/projects/refresh";
import type { ProjectRecord } from "@/ui/workspace/projects/db";

const col = (name: string, type = "string") => ({ name, type });

describe("matching next month's columns", () => {
  it("finds a column renamed by spelling, by words or by a close spelling", () => {
    const saved = [col("Order Date", "date"), col("Amt", "number"), col("Customer Name"), col("Region")];
    const now = [col("order_date", "date"), col("Amount", "number"), col("Custmer Name"), col("Area")];
    const c = compareColumns(saved, now);
    expect(c.renamed).toEqual([
      { from: "order_date", to: "Order Date", how: "spelling" },
      { from: "Amount", to: "Amt", how: "words" },
      { from: "Custmer Name", to: "Customer Name", how: "similar" },
    ]);
    // Another name in the same place is another column: never read as the old one.
    expect(c.missing).toEqual(["Region"]);
    expect(c.added).toEqual(["Area"]);
  });

  it("never guesses: two candidates, or another type, stay missing and new", () => {
    const saved = [col("Sales", "number"), col("Units", "number"), col("Notes")];
    const now = [col("Revenue", "number"), col("Volume", "number"), col("Notes", "number")];
    const c = compareColumns(saved, now);
    expect(c.renamed).toEqual([]);
    expect(c.missing).toEqual(["Sales", "Units"]);
    expect(c.added).toEqual(["Revenue", "Volume"]);
    expect(c.retyped).toEqual([{ name: "Notes", was: "string", now: "number" }]);
  });

  it("never matches names of different periods", () => {
    const c = compareColumns(
      [col("Sales 2024", "number"), col("Jan Target", "number")],
      [col("Sales 2025", "number"), col("Jun Target", "number")],
    );
    expect(c.renamed).toEqual([]);
    expect(c.missing).toEqual(["Sales 2024", "Jan Target"]);
  });

  it("is read under the saved name, and the report says what changed", async () => {
    const s = new Session();
    const csv = ["order_date,Amount,Region,Channel", "2025-11-03,120,North,Web", "2025-11-09,80,South,Store"];
    const load = await s.ingest(new Blob([csv.join("\n")]), "orders-nov.csv", {
      matchColumns: [col("Order Date", "date"), col("Amount", "number"), col("Region"), col("Segment")],
    });
    if (load.status !== "ok") throw new Error(load.status);
    expect(load.profile.columns.map((c) => c.name)).toEqual(["Order Date", "Amount", "Region", "Channel"]);
    expect(load.report.matched?.renamed).toEqual([{ from: "order_date", to: "Order Date", how: "spelling" }]);
    expect(load.report.matched?.missing).toEqual(["Segment"]);
    expect(load.report.matched?.added).toEqual(["Channel"]);
  });
});

const config: LoupeConfig = {
  app: "loupe",
  version: 1,
  createdAt: "2026-10-25T00:00:00.000Z",
  fingerprint: { fileName: "orders-oct.csv", rowCount: 2, columns: [], hash: "x" },
  domainId: "sales",
  mappingOverrides: { region: "Segment", rep: null, amount: "Amount" },
  classOverrides: {},
  hiddenColumns: ["Segment", "Notes"],
  customKpis: [],
  roleOverrides: { Segment: { role: "dimension" }, Amount: { role: "currency" }, Notes: { role: "text" } },
  outcome: "Segment",
  primaryDate: "Order Date",
  kpiRenames: {},
  kpiTargets: {},
  dashboard: {
    mode: "compact",
    view: "page",
    widgets: [],
    customCharts: [
      { id: "c1", title: "Sales by segment", x: { kind: "column", column: "Segment" } },
      { id: "c2", title: "Sales by region", x: { kind: "column", column: "Region" } },
    ],
    datePreset: "last12",
    filters: [
      { kind: "in", column: "Segment", values: ["SMB"] },
      { kind: "in", column: "Region", values: ["North"] },
    ],
  },
  settings: { numberLocale: "INTL", currency: "USD" },
};

describe("the saved dashboard on the new file", () => {
  const changes = {
    renamed: [],
    missing: ["Segment"],
    added: ["Channel"],
    retyped: [{ name: "Notes", was: "string", now: "number" }],
    same: 3,
  };

  it("keeps everything when nothing is missing", () => {
    const same = { renamed: [], missing: [], added: ["Channel"], retyped: [], same: 4 };
    expect(fitConfig(config, same).config).toBe(config);
  });

  it("takes off what names a missing column, and says which filters and charts", () => {
    const { config: fitted, filters, charts } = fitConfig(config, changes);
    expect(fitted.mappingOverrides).toEqual({ rep: null, amount: "Amount" });
    expect(fitted.roleOverrides).toEqual({ Amount: { role: "currency" } });
    expect(fitted.hiddenColumns).toEqual(["Notes"]);
    expect("outcome" in fitted).toBe(false);
    expect(fitted.primaryDate).toBe("Order Date");
    expect(fitted.dashboard.filters).toEqual([{ kind: "in", column: "Region", values: ["North"] }]);
    expect(fitted.dashboard.customCharts).toHaveLength(1);
    expect(filters).toEqual(["Segment"]);
    expect(charts).toEqual(["Sales by segment"]);
  });

  it("is reported with what it kept and why it lost the rest", () => {
    const previous: ProjectRecord = {
      id: "p",
      name: "Orders",
      fileName: "orders-oct.csv",
      rows: 900,
      columns: 5,
      bytes: 1,
      createdAt: 0,
      savedAt: 0,
      built: true,
      shown: {
        kpis: [
          { id: "revenue", name: "Revenue" },
          { id: "segment_share", name: "SMB share" },
        ],
        charts: [
          { id: "trend", title: "Revenue over time" },
          { id: "c1", title: "Sales by segment" },
        ],
        dataTo: Date.UTC(2025, 9, 31),
      },
    };
    const report = buildRefreshReport(previous, changes, fitConfig(config, changes), {
      fileName: "orders-nov.csv",
      rows: 950,
      dataTo: Date.UTC(2025, 10, 30),
      kpis: [{ id: "segment_share", unavailableReason: "Needs a segment column." } as KpiMeta],
      customKpiIssues: [],
      layout: ["revenue"],
      charts: ["trend"],
      skippedCharts: [],
    });
    expect(report.kpis).toEqual({
      kept: 1,
      total: 2,
      lost: [{ name: "SMB share", reason: "Needs a segment column." }],
    });
    expect(report.charts).toEqual({
      kept: 1,
      total: 2,
      lost: [{ name: "Sales by segment", reason: "It reads a column the new file doesn't have." }],
    });
    expect(report.previousDataTo).toBe(Date.UTC(2025, 9, 31));
    expect(nothingChanged(report)).toBe(false);
  });
});
