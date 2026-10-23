/**
 * The Export gallery's previews (version 50.4) show the real files in
 * miniature, so what they read must be what the files hold: the Power BI
 * model's table and measures as the TMDL model names them, the first KPI view
 * of kpis.sql with its true line numbers, the Date table's own name and
 * columns, a chart's shape from its own numbers, and the package's files
 * gathered by folder. Checked against the e-commerce demo's own exports.
 */
import { describe, expect, it } from "vitest";
import { Session } from "@/engine/session";
import type { ChartData, ChartKind } from "@/engine/charts/types";
import type { ExportContext } from "@/engine/export/context";
import { DATE_TABLE as ENGINE_DATE_TABLE, dateTableDax } from "@/engine/export/daxFile";
import { generateTmdl } from "@/engine/export/tmdl";
import {
  chartShape,
  DATE_TABLE,
  DATE_TABLE_COLUMNS,
  modelOutline,
  packageLines,
  sqlExcerpt,
  viewCounts,
} from "@/ui/workspace/export/gallery/excerpts";

const session = new Session();
const load = session.ingestSample("ecommerce");
if (load.status !== "ok") throw new Error("demo did not load");
const top = load.detection.candidates[0];
if (!top) throw new Error("demo was not detected");
session.configure({ domainId: top.domainId, numberLocale: "IN", currency: null });
const exportContext = (): ExportContext =>
  (session as unknown as { exportContext(): ExportContext }).exportContext();

/** The TMDL name as written ('Net revenue' or Orders), unquoted. */
const unquote = (name: string): string =>
  name.startsWith("'") ? name.slice(1, -1).replace(/''/g, "'") : name;

describe("the Power BI preview", () => {
  const outline = modelOutline(session.exportDax());

  it("names the data table and every measure as the model does", () => {
    const ec = exportContext();
    const files = generateTmdl(ec, "₹", "Model");
    const path = Object.keys(files).find((p) => p.endsWith(`/tables/${ec.names.table}.tmdl`));
    expect(path).toBeDefined();
    const measures = [...(files[path as string] as string).matchAll(/^\tmeasure (.+?) =$/gm)].map((m) =>
      unquote(m[1] as string),
    );
    expect(outline?.table).toBe(ec.names.table);
    expect(outline?.measures).toHaveLength(measures.length);
    expect(new Set(outline?.measures)).toEqual(new Set(measures));
    expect(outline?.measures).toContain("Net revenue");
  });

  it("reads quoted names back as written, and nothing from a file without measures", () => {
    const dax =
      "DEFINE\n    MEASURE 'O''Brien sales'[Net [after returns]]] = 1\n    MEASURE 'O''Brien sales'[Orders] = 2";
    expect(modelOutline(dax)).toEqual({
      table: "O'Brien sales",
      measures: ["Net [after returns]", "Orders"],
    });
    expect(modelOutline('// nothing to measure\nEVALUATE ROW ( "x", 1 )')).toBeNull();
  });

  it("names the Date table and its columns as the generator writes them", () => {
    expect(DATE_TABLE).toBe(ENGINE_DATE_TABLE);
    const dax = dateTableDax("Orders", "order_date");
    expect(dax).toContain("CALENDAR (");
    for (const c of DATE_TABLE_COLUMNS.slice(1)) expect(dax).toContain(`"${c}",`);
  });
});

describe("the SQL preview", () => {
  const sql = session.exportSql();
  const lines = sql.split("\n");

  it("shows the first KPI view as the file has it, with its own line numbers", () => {
    const { start, lines: shown } = sqlExcerpt(sql, 12);
    expect(shown).toHaveLength(12);
    shown.forEach((line, i) => expect(line).toBe(lines[start - 1 + i]));
    // It opens on the KPI's rule line and reaches its CREATE VIEW.
    expect(shown[0]).toMatch(/^-- ── Net revenue /);
    expect(shown.some((l) => l.startsWith('CREATE VIEW "kpi_net_revenue" AS'))).toBe(true);
    expect(lines.findIndex((l) => /^CREATE VIEW "kpi_/.test(l))).toBeGreaterThan(start - 1);
  });

  it("shows the table for a file without KPI views", () => {
    const file = '-- kpis.sql\n\nCREATE TABLE "orders" (\n  "a" TEXT\n);';
    expect(sqlExcerpt(file, 3)).toEqual({ start: 3, lines: ['CREATE TABLE "orders" (', '  "a" TEXT', ");"] });
    expect(sqlExcerpt("-- nothing else", 3)).toEqual({ start: 1, lines: ["-- nothing else"] });
  });

  it("counts one view per KPI, helpers apart, as the file writes them", () => {
    const { kpis, helpers } = viewCounts(sql);
    const views = [...sql.matchAll(/^CREATE VIEW "(kpi_[^"]+)"/gm)].filter(
      (m) => !/_monthly(_base)?$/.test(m[1] as string),
    ).length;
    expect(kpis).toBeGreaterThan(10);
    expect(kpis + helpers).toBe(views);
  });
});

describe("a chart's shape on a slide or a report page", () => {
  const data = (values: Array<number | null>, series = 1): ChartData =>
    ({
      specId: "x",
      kind: "line",
      categories: values.map((_, i) => ({ raw: String(i), label: String(i) })),
      series: Array.from({ length: series }, (_, s) => ({
        id: `s${s}`,
        label: `S${s}`,
        values: values.map((v) => (v === null ? null : v * (s + 1))),
        format: "number" as const,
      })),
      rows: values.map(() => 1),
      totals: [null],
      annotations: [],
    }) as unknown as ChartData;
  const shape = (kind: ChartKind, d: ChartData, x = "column") =>
    chartShape({ kind, data: d, spec: { x: { kind: x } } });

  it("draws a trend as a line or an area from its own numbers", () => {
    expect(shape("line", data([1, 3, 2]), "time")).toEqual({ type: "line", values: [1, 3, 2] });
    expect(shape("area", data([1, 3, 2]), "time")).toEqual({ type: "area", values: [1, 3, 2] });
    // A stacked chart is drawn by its total.
    expect(shape("stackedArea", data([1, 3, 2], 2), "time")?.values).toEqual([3, 9, 6]);
    // One point is no line.
    expect(shape("line", data([5]), "time")).toBeNull();
    expect(shape("line", data([5, null]), "time")).toBeNull();
  });

  it("keeps a missing value missing: a gap in a line, no bar, never a zero", () => {
    expect(shape("line", data([1, null, 2]), "time")?.values).toEqual([1, null, 2]);
    expect(shape("bar", data([4, null, 1]))?.values).toEqual([4, null, 1]);
    expect(shape("stackedBar", data([null, 2], 2))?.values).toEqual([null, 6]);
  });

  it("turns a column chart of more than ten named categories horizontal, as the chart does", () => {
    const many = data(Array.from({ length: 12 }, (_, i) => 12 - i));
    expect(shape("bar", many)?.type).toBe("bars");
    expect(shape("bar", many)?.values).toHaveLength(6);
    expect(shape("bar", many, "time")?.type).toBe("columns");
    expect(shape("bar", data([4, 2, 1]))?.type).toBe("columns");
    expect(shape("hbar", data([4, 2, 1]))?.type).toBe("bars");
  });

  it("leaves a kind it can't draw plain", () => {
    for (const kind of ["donut", "geoTile", "heatmap", "funnel", "table"] as ChartKind[])
      expect(shape(kind, data([4, 2, 1]))).toBeNull();
    expect(shape("bar", data([]))).toBeNull();
  });
});

describe("the package's files", () => {
  it("lists top-level files one by one and each folder once, with its count and size", () => {
    const lines = packageLines({
      files: [
        { path: "README.md", bytes: 10 },
        { path: "Orders.SemanticModel/definition/model.tmdl", bytes: 5 },
        { path: "Orders.SemanticModel/definition/tables/Orders.tmdl", bytes: 7 },
        { path: "data.csv", bytes: 100 },
      ],
      totalBytes: 60,
      newColumns: [],
    });
    expect(lines).toEqual([
      { path: "README.md", bytes: 10, files: 1 },
      { path: "Orders.SemanticModel/", bytes: 12, files: 2 },
      { path: "data.csv", bytes: 100, files: 1 },
    ]);
  });
});
