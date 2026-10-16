/**
 * Getting data in, as the upload audit found it: headers with repeated or
 * blank labels (and Excel's trailing commas) keep their header row; empty,
 * header-only and non-table files are refused in words; pandas' JSON layouts
 * are read; "NA" stays a value in a text column; the day/month order decision
 * says what switching would cost; the grain and currency read from the
 * header; a yes/no column that only says "No" never shows TRUE; empty sheets
 * are not offered; the demo cards quote their real size. Each block failed
 * before its fix.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { blanksIfSwitched } from "@/engine/parse/dateOrder";
import { listDataSheets } from "@/engine/parse/excel";
import { workbookSheets } from "@/engine/parse";
import { profileDataset } from "@/engine/profile/profile";
import { grainLabel } from "@/engine/profile/structure";
import { generateSample, SAMPLES } from "@/engine/samples";
import { cell, column, parse } from "./helpers/dataset";

const csv = (header: string, rows: (i: number) => string, n = 60) =>
  [header, ...Array.from({ length: n }, (_, i) => rows(i))].join("\r\n") + "\r\n";

const refusal = async (content: string | Uint8Array, name: string): Promise<string> => {
  try {
    await parse(content, name);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`${name} was read`);
};

describe("header rows with repeated or blank labels", () => {
  it("keeps a header that repeats a label, numbering the repeat", async () => {
    const { ds, report } = await parse(
      csv(
        "Order ID,Order Date,Amount,Amount,Region",
        (i) => `O-${i},2025-02-${String(1 + (i % 28)).padStart(2, "0")},${100 + i},${10 + i},N`,
      ),
      "dup.csv",
    );
    expect(report.headerDetected).toBe(true);
    expect(ds.rowCount).toBe(60);
    expect(ds.columns.map((c) => c.name)).toEqual([
      "Order ID",
      "Order Date",
      "Amount",
      "Amount (2)",
      "Region",
    ]);
    expect(cell(ds, "Amount (2)", 0)).toBe(10);
    expect(report.warnings.join(" ")).toContain('"Amount" → "Amount (2)"');
  });

  it("keeps a header with blank cells, naming those columns and saying so", async () => {
    const { ds, report } = await parse(
      csv("Order ID,,Amount,,Region", (i) => `O-${i},2025-02-01,${100 + i},${i},N`),
      "blank.csv",
    );
    expect(report.headerDetected).toBe(true);
    expect(ds.rowCount).toBe(60);
    expect(ds.columns.map((c) => c.name)).toEqual(["Order ID", "Column 2", "Amount", "Column 4", "Region"]);
    expect(report.warnings.join(" ")).toMatch(/2 columns with no header were named "Column 2", "Column 4"/);
  });

  it("leaves out the empty, unnamed columns Excel's trailing commas add", async () => {
    const { ds, report } = await parse(
      csv("Order ID,Order Date,Amount,Region,,", (i) => `O-${i},2025-02-01,${100 + i},N,,`),
      "trailing.csv",
    );
    expect(report.headerDetected).toBe(true);
    expect(ds.rowCount).toBe(60);
    expect(ds.columns.map((c) => c.name)).toEqual(["Order ID", "Order Date", "Amount", "Region"]);
    expect(report.warnings.join(" ")).toMatch(/Left out 2 columns with no header and no values/);
  });

  it("still reads a row of repeated words as data, not as a header", async () => {
    const { report } = await parse(
      csv("Yes,Yes,No,Yes", () => "No,Yes,Yes,No", 20),
      "flags.csv",
    );
    expect(report.headerDetected).toBe(false);
  });

  it("names the line a header is on, blank lines and titles included", async () => {
    const { report } = await parse(
      `Monthly sales report\r\nGenerated 2025-05-01\r\n\r\n${csv("Txn ID,Txn Date,Store,Sales", (i) => `T-${i},2025-04-01,A,${50 + i}`, 20)}`,
      "titles.csv",
    );
    expect(report.headerRowIndex + 1).toBe(4);
    expect(report.warnings.join(" ")).toContain("its header is on line 4");
  });
});

describe("files that are not a table", () => {
  it("refuses an empty file, a header with no rows and a single cell", async () => {
    expect(await refusal("", "empty.csv")).toMatch(/empty/);
    expect(await refusal("\r\n\r\n", "blank.csv")).toMatch(/no rows/);
    expect(await refusal("Order ID,Order Date,Customer,Amount,Status\r\n", "header_only.csv")).toBe(
      "This file has column headers (Order ID, Order Date, Customer, Amount, Status) but no rows of data under them.",
    );
    expect(await refusal("a\n", "onecell.csv")).toMatch(/no rows of data/);
  });

  it("refuses an image, a PDF and binary content, saying what the file is", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48]);
    expect(await refusal(png, "chart.csv")).toMatch(/^This is an image, not a table\. It is named "\.csv"/);
    expect(await refusal("%PDF-1.4\n%âãÏÓ\n1 0 obj", "report.pdf")).toMatch(/^This is a PDF, not a table/);
    expect(await refusal(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 6, 0]), "book.csv")).toMatch(
      /give it the \.xlsx extension/,
    );
    expect(await refusal(new Uint8Array([1, 2, 3, 0, 5, 6, 7, 8]), "blob.dat")).toMatch(/binary data/);
  });

  it("says a damaged workbook couldn't be read, instead of 'no sheets'", async () => {
    const junk = new Uint8Array(3000).map((_, i) => (i * 7919) % 251);
    expect(await refusal(junk, "broken.xlsx")).toMatch(/^This workbook couldn't be read/);
  });

  it("refuses a JSON list of plain values, and counts entries that are not records", async () => {
    expect(await refusal("[1,2,3,4]", "primitives.json")).toMatch(/list of plain values \(\[1, 2, 3, …\]\)/);
    const { ds, report } = await parse(JSON.stringify([{ a: 1, b: "x" }, 7, { a: 2, b: "y" }]), "mixed.json");
    expect(ds.rowCount).toBe(2);
    expect(report.warnings.join(" ")).toMatch(/Left out 1 entry that is not a record/);
    expect(await refusal("{}", "nothing.json")).toMatch(/no fields/);
  });
});

describe("pandas' JSON layouts", () => {
  const frame = {
    date: {} as Record<string, string>,
    sales: {} as Record<string, number>,
    region: {} as Record<string, string>,
  };
  for (let i = 0; i < 40; i++) {
    frame.date[i] = `2025-01-${String(1 + (i % 28)).padStart(2, "0")}`;
    frame.sales[i] = 100 + i;
    frame.region[i] = i % 2 ? "S" : "N";
  }

  it('reads to_json() ("columns" orient) as one row per index, not one row of 120 columns', async () => {
    const { ds } = await parse(JSON.stringify(frame), "pandas_default.json");
    expect(ds.rowCount).toBe(40);
    expect(ds.columns.map((c) => c.name)).toEqual(["date", "sales", "region"]);
    expect(column(ds, "date").kind).toBe("date");
    expect(cell(ds, "sales", 39)).toBe(139);
  });

  it('reads the "index" and "split" orients', async () => {
    const byIndex = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [String(i), { sales: 10 + i, region: i % 2 ? "S" : "N" }]),
    );
    const a = await parse(JSON.stringify(byIndex), "index.json");
    expect(a.ds.rowCount).toBe(5);
    expect(cell(a.ds, "sales", 4)).toBe(14);
    const split = {
      columns: ["sales", "region"],
      index: [0, 1, 2],
      data: [
        [1, "N"],
        [2, "S"],
        [3, "N"],
      ],
    };
    const b = await parse(JSON.stringify(split), "split.json");
    // The first row is data: the header comes from "columns".
    expect(b.ds.rowCount).toBe(3);
    expect(cell(b.ds, "sales", 0)).toBe(1);
  });

  it("still reads a single record with nested objects as one row", async () => {
    const { ds } = await parse(
      JSON.stringify({ id: 7, customer: { city: "Pune", pin: "411001" } }),
      "one.json",
    );
    expect(ds.rowCount).toBe(1);
    expect(cell(ds, "customer.city", 0)).toBe("Pune");
  });
});

describe("blank spellings", () => {
  it('keep "NA" as a value in a text column, and read it as blank in a number column', async () => {
    const { ds } = await parse(
      csv(
        "Territory,Sales,Discount",
        (i) => `${["NA", "EMEA", "APAC"][i % 3]},${100 + i},${i % 2 ? "NA" : 5}`,
        30,
      ),
      "kaggle.csv",
    );
    expect(cell(ds, "Territory", 0)).toBe("NA");
    expect(cell(ds, "Discount", 1)).toBeNull();
    expect(cell(ds, "Discount", 0)).toBe(5);
  });
});

describe("the day/month order decision", () => {
  it("costs nothing to switch when nothing proves the order", async () => {
    const { report } = await parse(
      csv(
        "Invoice No,Invoice Date,Amount",
        (i) => `INV-${i},${1 + (i % 12)}/${1 + ((i * 5) % 12)}/2024,${100 + i}`,
      ),
      "ambiguous.csv",
    );
    const d = report.dateFormats[0];
    expect(d?.ambiguous).toBe(true);
    expect(d && blanksIfSwitched(d)).toBe(0);
    // The assumption is explained by where the user is, never by an earlier file's number format.
    expect(d?.evidence).toContain("as dates are written where you are");
    expect(d?.evidence).not.toContain("number format");
  });

  it("says how many dates a proven order would blank, and keeps that count when forced", async () => {
    const text = csv(
      "Emp Code,Date of Joining",
      (i) =>
        `E${i},${String(1 + ((i * 3) % 28)).padStart(2, "0")}-${String(1 + (i % 12)).padStart(2, "0")}-2019`,
    );
    const { report } = await parse(text, "hrms.csv");
    const d = report.dateFormats[0];
    expect(d?.format).toBe("DD/MM/YYYY");
    const proven = (d && blanksIfSwitched(d)) ?? 0;
    expect(proven).toBeGreaterThan(0);
    const forced = await parse(text, "hrms.csv", { dateOrderOverrides: { "Date of Joining": "MDY" } });
    const f = forced.report.dateFormats[0];
    expect(f?.format).toBe("MM/DD/YYYY");
    // Switching back restores them: none is real only month-first.
    expect(f && blanksIfSwitched(f)).toBe(0);
    expect(forced.ds.columns[1]?.kind).toBe("date");
  });
});

describe("what the profile reads from headers and values", () => {
  it("takes the currency from a symbol in a money column's name", async () => {
    const { ds } = await parse(
      csv("Belegnr;Betrag €;Menge", (i) => `B-${i};${1000 + i},50;${i % 9}`, 30),
      "eu.csv",
    );
    expect(profileDataset(ds).currency).toMatchObject({ code: "EUR", source: 'Column name "Betrag €"' });
  });

  it("shows only the values a yes/no column holds, and spells the other one like the file", async () => {
    const { ds } = await parse(
      csv("Id,Returned,Qty", (i) => `${i},No,${i}`, 20),
      "flags.csv",
    );
    const col = column(ds, "Returned");
    expect(col.kind).toBe("boolean");
    if (col.kind === "boolean") expect([col.trueLabel, col.falseLabel]).toEqual(["Yes", "No"]);
    expect(profileDataset(ds).columns.find((c) => c.name === "Returned")?.examples).toEqual(["No"]);
  });

  it("words a key that only numbers the rows without 'One row per row' or 'column 1'", () => {
    const g = (description: string) => ({ columns: ["Row ID"], description, confidence: 0.9 });
    expect(grainLabel(g("One row per row"))).toBe("Each row has its own Row ID");
    expect(grainLabel({ columns: ["Column 1"], description: "One row per column 1", confidence: 0.9 })).toBe(
      "Each row has its own Column 1",
    );
    expect(grainLabel(g("One row per row"), "invoice line")).toBe("One row per invoice line");
    expect(grainLabel(g("One row per order"))).toBe("One row per order");
  });
});

describe("workbooks", () => {
  it("offers only the sheets that hold something, and reads the first of them by default", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Blank");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Order ID", "Amount"],
        ...Array.from({ length: 10 }, (_, i) => [`O-${i}`, 100 + i]),
      ]),
      "Orders",
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[""]]), "Empty A1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(listDataSheets(buf)).toEqual(["Orders"]);
    expect(await workbookSheets(new Blob([buf]))).toEqual(["Orders"]);
    const { ds, report } = await parse(new Uint8Array(buf), "book.xlsx");
    expect(report.sheet).toBe("Orders");
    expect(ds.rowCount).toBe(10);
  });

  it("refuses a sheet with headers and no data rows", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Order ID", "Amount"]]), "Orders");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(await refusal(new Uint8Array(buf), "headers.xlsx")).toMatch(
      /Sheet "Orders" has column headers \(Order ID, Amount\) but no rows of data/,
    );
  });
});

describe("demo cards", () => {
  it("quote a size within 10% of the rows each demo really has", () => {
    for (const s of SAMPLES) {
      const m = /≈([\d.]+)(k?)/.exec(s.approxRows);
      expect(m, s.id).not.toBeNull();
      const quoted = Number(m?.[1]) * (m?.[2] ? 1000 : 1);
      const real = generateSample(s.id).rowCount;
      expect(Math.abs(quoted - real) / real, `${s.id}: ${s.approxRows} vs ${real}`).toBeLessThanOrEqual(0.1);
    }
  });
});
