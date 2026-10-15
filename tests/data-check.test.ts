/**
 * The data check (step 3): a file with one of each problem is read, and every
 * problem is marked on the right cell, with the original text of cells that
 * couldn't be read. Each issue's view lists exactly the health issue's rows,
 * "rows to check" gathers them all, blanks in optional columns are not
 * flagged, and unreadable cells follow their rows through an unpivot.
 */
import { describe, expect, it } from "vitest";
import { Session } from "@/engine/session";
import { unreadableAt, type Dataset } from "@/engine/core/types";
import { unpivotDataset } from "@/engine/parse/unpivot";
import { column, parse } from "./helpers/dataset";

const CITIES = ["Delhi", "Mumbai", "Pune", "Chennai"];

/** 60 clean order lines, then the problems on known rows (0-based). */
function csv(): string {
  const rows: string[][] = [];
  for (let i = 0; i < 60; i++)
    rows.push([
      `OD${1000 + i}`,
      `2025-0${(i % 9) + 1}-${String((i % 27) + 1).padStart(2, "0")}`,
      String((i % 4) + 1),
      String(200 + (i % 7) * 10),
      String(10 + (i % 5)),
      String(400 + (i % 9) * 25),
      CITIES[i % 4] as string,
      String(20 + (i % 40)),
      i % 10 === 0 ? "SAVE10" : "",
    ]);
  (rows[3] as string[])[2] = "3x"; // unreadable quantity
  (rows[4] as string[])[1] = "2025-13-45"; // unreadable date
  (rows[5] as string[])[2] = "-2"; // negative quantity
  (rows[6] as string[])[1] = "2099-01-01"; // future date
  (rows[7] as string[])[1] = "1900-01-01"; // placeholder date
  (rows[8] as string[])[6] = "delhi"; // spelling variant
  (rows[9] as string[])[4] = "900"; // discount above the gross amount
  (rows[10] as string[])[7] = "150"; // impossible age
  rows[11] = [...(rows[2] as string[])]; // duplicate of row 2
  (rows[12] as string[])[6] = ""; // missing city in an otherwise filled column
  return [
    "Order ID,Order Date,Quantity,Unit Price,Discount Amount,Gross Amount,City,Customer Age,Coupon Code",
    ...rows.map((r) => r.join(",")),
  ].join("\n");
}

describe("the data check", async () => {
  const s = new Session();
  const load = await s.ingest(new Blob([csv()]), "orders.csv", {});
  if (load.status !== "ok") throw new Error(load.status);
  const views = s.checkViews();
  const view = (id: string) => views.find((v) => v.id === id);
  const all = s.checkRows("all", 0, 1000).rows;
  const colIndex = (name: string) => load.profile.columns.findIndex((c) => c.name === name);
  const problemsAt = (row: number, col: string) =>
    all[row]?.problems.filter((p) => p.column === colIndex(col)) ?? [];

  it("keeps the original text of cells it couldn't read, and shows it", () => {
    expect(all[3]?.cells[colIndex("Quantity")]).toBe("3x");
    expect(problemsAt(3, "Quantity")[0]).toMatchObject({ kind: "unreadable" });
    expect(problemsAt(3, "Quantity")[0]?.note).toMatch(/the file says "3x"/);
    expect(problemsAt(4, "Order Date")[0]?.note).toMatch(/the file says "2025-13-45"/);
  });

  it("marks each rule on the right cell", () => {
    expect(problemsAt(5, "Quantity")[0]).toMatchObject({ kind: "value", note: "Below zero." });
    expect(problemsAt(6, "Order Date")[0]?.note).toBe("Dated after today.");
    expect(problemsAt(7, "Order Date")[0]?.note).toMatch(/1 Jan 1900/);
    expect(problemsAt(8, "City")[0]?.note).toMatch(/Spelled differently from "Delhi"/);
    expect(problemsAt(9, "Discount Amount")[0]?.note).toMatch(/Larger than "Gross Amount"/);
    expect(problemsAt(10, "Customer Age")[0]?.note).toMatch(/age below 0 or above 120/);
    expect(all[11]?.duplicateOf).toBe(2);
    expect(problemsAt(12, "City")[0]).toMatchObject({ kind: "blank" });
    // Blank coupon codes are expected (an optional field), so they are not marked.
    expect(all.some((r) => r.problems.some((p) => p.column === colIndex("Coupon Code")))).toBe(false);
    // A clean row has nothing marked.
    expect(all[20]?.problems).toEqual([]);
  });

  it("lists exactly the health issue's rows in each issue view", () => {
    for (const issue of load.health.issues) {
      const v = view(`issue:${issue.id}`);
      if (!v || issue.id.startsWith("variants-")) continue;
      expect(v.rows, issue.id).toBe(issue.count);
    }
    expect(view("issue:duplicates")?.rows).toBe(1);
    expect(view("issue:mixed-Quantity")?.rows).toBe(1);
    expect(view("issue:negative-Quantity")?.rows).toBe(1);
    expect(view("issue:future-Order Date")?.rows).toBe(1);
    expect(view("issue:variants-City")?.rows).toBe(1);
  });

  it("gathers every problem row under 'rows to check'", () => {
    const rows = s.checkRows("problems", 0, 100);
    expect(rows.total).toBe(view("problems")?.rows);
    expect(rows.rows.map((r) => r.index)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // Each row of a filtered view keeps its real row number.
    expect(s.checkRows("issue:duplicates", 0, 10).rows[0]?.index).toBe(11);
  });

  it("reads codes that start with letters as identifiers, never as places", () => {
    // "OD1003" once matched Odisha's code "OD" once its digits were dropped.
    expect(load.profile.columns.find((c) => c.name === "Order ID")?.role).toBe("identifier");
    expect(load.profile.columns.find((c) => c.name === "City")?.role).toBe("geo");
  });

  it("offers the blanks of each column, flagging only the probably missing ones", () => {
    expect(view("blank:City")).toMatchObject({ rows: 1, tone: "warning" });
    expect(view("blank:Coupon Code")?.tone).toBe("info");
  });
});

describe("unreadable cells through an unpivot", () => {
  it("follow their rows", () => {
    const num = (name: string, values: number[], unreadable?: { row: number; text: string }) => ({
      kind: "number" as const,
      name,
      values: Float64Array.from(values),
      format: { integer: true, decimals: 0 },
      ...(unreadable
        ? {
            unreadable: {
              rows: Int32Array.of(unreadable.row),
              codes: Int32Array.of(0),
              texts: [unreadable.text],
            },
          }
        : {}),
    });
    const ds: Dataset = {
      id: "wide",
      name: "wide",
      rowCount: 3,
      columns: [
        { kind: "string", name: "Region", codes: Int32Array.of(0, 1, 2), dict: ["North", "South", "East"] },
        num("Jan 24", [1, 4, 7]),
        num("Feb 24", [2, NaN, 8], { row: 1, text: "x5" }),
        num("Mar 24", [3, 6, 9]),
      ],
      source: { fileName: "wide.csv", kind: "csv", sizeBytes: 0, isDemo: false },
    } as Dataset;
    const long = unpivotDataset(ds, {
      columns: ["Jan 24", "Feb 24", "Mar 24"],
      idColumns: ["Region"],
      kind: "month",
      suggestion: "",
    });
    // South (row 1) × Feb (period 1) is row 1*3 + 1 = 4 of the long table.
    expect(unreadableAt(column(long, "Value").unreadable, 4)).toBe("x5");
    expect(column(long, "Value").unreadable?.rows.length).toBe(1);
  });

  it("are kept by the parser with their text", async () => {
    const lines = ["Order ID,Amount"];
    for (let i = 0; i < 40; i++) lines.push(`A${i},${i === 7 ? "12,5x" : 100 + i}`);
    const { ds } = await parse(lines.join("\n").replace("12,5x", '"12,5x"'), "amounts.csv");
    expect(unreadableAt(column(ds, "Amount").unreadable, 7)).toBe("12,5x");
    expect(unreadableAt(column(ds, "Amount").unreadable, 8)).toBeUndefined();
  });
});
