/**
 * Regression tests for data-import correctness fixes, one block per review
 * item: number style, date-name hints and day/month evidence, a deterministic
 * demo shuffle, unique headers, lossless fallback to text, health checks,
 * workbook dates and skipped columns, the UTF-16 row estimate, unpivot years
 * and names, late JSON keys, an unused export, exact date distinct counts.
 * Each block failed before its fix.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { Column, Dataset, DateColumn, NumberColumn, StringColumn } from "@/engine/core/types";
import { utc } from "@/engine/core/dates";
import { cleanHeaders } from "@/engine/parse/builder";
import * as dates from "@/engine/parse/dates";
import { cellValue } from "@/engine/parse/excel";
import { unpivotColumnNames, unpivotDataset } from "@/engine/parse/unpivot";
import { WallClockDate } from "@/engine/parse/values";
import { profileColumn, profileDataset } from "@/engine/profile/profile";
import { assessHealth } from "@/engine/profile/quality";
import { generateSample } from "@/engine/samples";
import { cell, column, parse } from "./helpers/dataset";

// ---------------------------------------------------------------- helpers

function numberCol(name: string, values: number[]): NumberColumn {
  return {
    kind: "number",
    name,
    values: Float64Array.from(values),
    format: { integer: values.every(Number.isInteger), decimals: 2 },
  };
}

function stringCol(name: string, values: string[]): StringColumn {
  const dict = [...new Set(values)];
  return { kind: "string", name, codes: Int32Array.from(values.map((v) => dict.indexOf(v))), dict };
}

function dateCol(name: string, values: number[]): DateColumn {
  return { kind: "date", name, values: Float64Array.from(values), hasTime: false, format: "YYYY-MM-DD" };
}

function dataset(columns: Column[]): Dataset {
  const first = columns[0];
  const rowCount = !first ? 0 : first.kind === "string" ? first.codes.length : first.values.length;
  return {
    id: "t",
    name: "t",
    rowCount,
    columns,
    source: { fileName: "t.csv", kind: "csv", sizeBytes: 0, isDemo: false },
  };
}

/** FNV-style hash over every column name and value, to compare whole datasets cheaply. */
function fingerprint(ds: Dataset): string {
  let h = 2166136261;
  const mix = (x: number) => {
    h = Math.imul(h ^ (x | 0), 16777619);
  };
  const f = new Float64Array(1);
  const u = new Uint32Array(f.buffer);
  for (const c of ds.columns) {
    for (let i = 0; i < c.name.length; i++) mix(c.name.charCodeAt(i));
    if (c.kind === "string") {
      for (const s of c.dict) for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
      for (const x of c.codes) mix(x);
    } else {
      for (const x of c.values) {
        f[0] = x;
        mix(u[0] as number);
        mix(u[1] as number);
      }
    }
  }
  return `${ds.rowCount}:${(h >>> 0).toString(16)}`;
}

const issueIds = (ds: Dataset) => assessHealth(ds, profileDataset(ds)).issues.map((i) => i.id);

// ---------------------------------------------------------------- 1. number style

describe("1. decimal separator detection", () => {
  it("reads three-decimal values such as 0.125 and 83.125 as decimals, not European thousands", async () => {
    const { ds } = await parse("item,rate\nA,0.125\nB,83.125\nC,12.375\nD,7.250\n", "rates.csv");
    expect(cell(ds, "rate", 0)).toBe(0.125);
    expect(cell(ds, "rate", 1)).toBe(83.125);
    expect(cell(ds, "rate", 3)).toBe(7.25);
  });

  it("prefers the dot when nothing settles it, and says so in the parse report", async () => {
    const { ds, report } = await parse("item,weight\nA,83.125\nB,12.375\nC,7.625\n", "weights.csv");
    expect(cell(ds, "weight", 0)).toBe(83.125);
    const note = report.columnNotes.find((n) => n.column === "weight");
    expect(note?.invalidCount).toBe(0);
    expect(note?.note).toContain("83.125");
  });

  it("still reads European numbers when separators or the values' distribution prove it", async () => {
    const { ds } = await parse(
      "Produkt;Preis;Menge;Lager\nA;1.234,56;1.250;1.234.567\nB;99,90;980;2.000.000\nC;5,00;15.000;3.500.250\n",
      "eu.csv",
    );
    expect(cell(ds, "Preis", 0)).toBeCloseTo(1234.56, 10);
    expect(cell(ds, "Preis", 1)).toBeCloseTo(99.9, 10);
    // Whole numbers next to "x.ddd" values ending in 0 fit thousands grouping, not a decimal format.
    expect(cell(ds, "Menge", 0)).toBe(1250);
    expect(cell(ds, "Menge", 2)).toBe(15000);
    expect(cell(ds, "Lager", 1)).toBe(2_000_000);
  });

  it("flags a column whose values contradict each other", async () => {
    const rows = ["item,price"];
    for (let i = 0; i < 30; i++) rows.push(`P${i},${i + 0.5}`);
    rows.push('Q,"4,5"');
    const { ds, report } = await parse(rows.join("\n"), "mixed.csv");
    expect(cell(ds, "price", 3)).toBe(3.5);
    const note = report.columnNotes.find((n) => n.column === "price");
    expect(note?.examples).toContain("4,5");
    expect(note?.note).toMatch(/decimal/i);
  });
});

// ---------------------------------------------------------------- 2. date-name hints and day/month evidence

describe("2. date names and day/month evidence", () => {
  it("matches whole name tokens, not substrings", () => {
    for (const name of ["Ad Spend", "Vendor", "Width", "Monthly Revenue", "Weekend Sales", "Trend Score"]) {
      expect(dates.hasDateNameHint(name), name).toBe(false);
    }
    for (const name of [
      "Order Date",
      "created_at",
      "createdAt",
      "Order Dt",
      "DOB",
      "Month",
      "Ship Date",
      "updated",
    ]) {
      expect(dates.hasDateNameHint(name), name).toBe(true);
    }
  });

  it("keeps amounts in the Excel serial range as numbers", async () => {
    const rows = ["Ad Spend,Vendor Fee,Width,Monthly Revenue,Start Value"];
    for (let i = 0; i < 20; i++)
      rows.push([23456.5 + i, 34567 + i, 45678 + i, 56789 + i, 61234 + i].join(","));
    const { ds } = await parse(rows.join("\n"), "spend.csv");
    for (const name of ["Ad Spend", "Vendor Fee", "Width", "Monthly Revenue", "Start Value"])
      expect(column(ds, name).kind, name).toBe("number");
    expect(cell(ds, "Ad Spend", 0)).toBe(23456.5);
  });

  it("still reads Excel serials and Unix times under a name that says so", async () => {
    const { ds } = await parse(
      "Order Date,created_at,Amount\n45383,1711929600,10\n45384,1712016000,20\n",
      "serials.csv",
    );
    expect(cell(ds, "Order Date", 0)).toBe(utc(2024, 4, 1));
    expect(cell(ds, "created_at", 1)).toBe(utc(2024, 4, 2));
    // Money-like values (two decimals) under a date name are not read as date-times.
    expect(dates.detectNumericDateKind([45383.37, 45384.12, 45390.99], "Order Date")).toBeNull();
    expect(dates.detectNumericDateKind([45383.5416666667, 45384.25], "Order Date")).toBe("excel-serial");
  });

  it("needs a date-like name for code-like periods (YYYY-MM, Mon-YY), not for Mon-YYYY", async () => {
    const csv =
      "Batch,Code,Month,issue_d\nJan 25,2025-01,Jan 25,Dec-2015\nFeb 25,2025-02,Feb 25,Nov-2015\nMar 25,2025-03,Mar 25,Oct-2015\n";
    const { ds } = await parse(csv, "periods.csv");
    expect(column(ds, "Batch").kind).toBe("string");
    expect(column(ds, "Code").kind).toBe("string");
    expect(cell(ds, "Month", 0)).toBe(utc(2025, 1, 1));
    expect(cell(ds, "issue_d", 1)).toBe(utc(2015, 11, 1));
  });

  it("does not take an impossible date such as 45/03/2024 as proof of day-first order", async () => {
    const rows = ["d,v", "45/03/2024,0"];
    for (let i = 1; i <= 24; i++)
      rows.push(
        `${String((i % 12) + 1).padStart(2, "0")}/${String(((i + 3) % 12) + 1).padStart(2, "0")}/2025,${i}`,
      );
    const { ds, report } = await parse(rows.join("\n"), "dates.csv", { preferDayFirst: false });
    const decision = report.dateFormats.find((f) => f.column === "d");
    expect(decision?.ambiguous).toBe(true);
    expect(decision?.format).toBe("MM/DD/YYYY");
    expect(cell(ds, "d", 1)).toBe(utc(2025, 2, 5));
    expect(cell(ds, "d", 0)).toBeNull();
    expect(report.columnNotes.find((n) => n.column === "d")?.examples).toContain("45/03/2024");
  });
});

// ---------------------------------------------------------------- 3. deterministic demo data

describe("3. demo data is generated the same way every time", () => {
  it("produces identical e-commerce data on two runs", () => {
    expect(fingerprint(generateSample("ecommerce"))).toBe(fingerprint(generateSample("ecommerce")));
  });

  it("does not depend on the JavaScript engine's sort algorithm", () => {
    const reference = fingerprint(generateSample("ecommerce"));
    const native = Array.prototype.sort;
    // Engines sort with different (valid) algorithms; a stable insertion sort stands in for another engine.
    function insertionSort<T>(this: T[], compare?: (a: T, b: T) => number): T[] {
      const cmp = compare ?? ((a: T, b: T) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
      for (let i = 1; i < this.length; i++) {
        const x = this[i] as T;
        let j = i - 1;
        for (; j >= 0 && cmp(this[j] as T, x) > 0; j--) this[j + 1] = this[j] as T;
        this[j + 1] = x;
      }
      return this;
    }
    let other: string;
    Array.prototype.sort = insertionSort;
    try {
      other = fingerprint(generateSample("ecommerce"));
    } finally {
      Array.prototype.sort = native;
    }
    expect(other).toBe(reference);
  });

  it("uses no comparator-based random sorts in the generators", () => {
    const dir = join(__dirname, "..", "src", "engine", "samples");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, file), "utf8");
      expect(src, file).not.toMatch(/sort\(\s*\(\s*\)\s*=>/);
      expect(src, file).not.toMatch(/sort\(\s*\([^)]*\)\s*=>[^;]*\b(rng|random)\b/i);
    }
  });
});

// ---------------------------------------------------------------- 4. headers

describe("4. header names", () => {
  it("makes repeated headers unique, also against suffixes already in the file", () => {
    expect(cleanHeaders(["A", "A", "A (2)"])).toEqual(["A", "A (3)", "A (2)"]);
    const names = cleanHeaders(["a", "A", "A (2)", "", "Column 4", "a (3)"]);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    expect(names[4]).toBe("Column 4");
  });
});

// ---------------------------------------------------------------- 5. lossless fallback to text

describe("5. fallback to text", () => {
  it("keeps every original value when a column degrades after 25,000 invalid cells", async () => {
    const lines = ["value"];
    for (let i = 0; i < 500_000; i++) lines.push(String(i));
    for (let i = 0; i < 27_000; i++) lines.push(`X-${i}`);
    const { ds } = await parse(lines.join("\n"), "mixed.csv");
    const col = column(ds, "value");
    expect(col.kind).toBe("string");
    expect(cell(ds, "value", 500_000 + 25_500)).toBe("X-25500");
    expect(cell(ds, "value", 499_999)).toBe("499999");
    if (col.kind === "string") expect(col.codes.some((c) => c < 0)).toBe(false);
  }, 120_000);
});

// ---------------------------------------------------------------- 6. health checks

describe("6. data health checks", () => {
  it("flags a literal 1900-01-01 placeholder", () => {
    const ds = dataset([
      dateCol("Signup Date", [utc(1900, 1, 1), utc(2024, 5, 1), utc(2024, 6, 1), utc(2024, 7, 1)]),
    ]);
    expect(issueIds(ds)).toContain("ancient-Signup Date");
  });

  it("flags out-of-range coordinates in columns named like coordinates", () => {
    const ds = dataset([
      numberCol("Latitude", [12.97, 19.07, 28.61, 95.5]),
      numberCol("Longitude", [77.59, 72.88, 77.21, 181.2]),
    ]);
    const ids = issueIds(ds);
    expect(ids).toContain("geo-Latitude");
    expect(ids).toContain("geo-Longitude");
  });

  it("judges ages in their own unit", () => {
    const ds = dataset([
      numberCol("Account Age (days)", [30, 400, 1200, 3650]),
      numberCol("Customer Age", [25, 34, 140, 52]),
      numberCol("Asset Age Days", [10, 50_000, 300, 20]),
    ]);
    const ids = issueIds(ds);
    expect(ids).not.toContain("age-Account Age (days)");
    expect(ids).toContain("age-Customer Age");
    expect(ids).toContain("age-Asset Age Days");
  });
});

// ---------------------------------------------------------------- 7. workbooks

describe("7. workbooks", () => {
  it("reads Date cells by their UTC clock time, whatever the local time zone", () => {
    const saved = process.env.TZ;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.env.TZ = "Asia/Kolkata";
    try {
      const v = cellValue({ t: "d", v: new Date(Date.UTC(2025, 3, 3, 10, 30)) }, false);
      expect(v).toBeInstanceOf(WallClockDate);
      expect((v as WallClockDate).ms).toBe(utc(2025, 4, 3, 10, 30));
      expect((v as WallClockDate).hasTime).toBe(true);
    } finally {
      process.env.TZ = saved ?? zone;
    }
  });

  it("reports skipped columns like delimited files do", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Region", "Amount", "Notes"],
        ["North", 10, "a"],
        ["South", 20, "b"],
      ]),
      "Data",
    );
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const { ds, report } = await parse(new Uint8Array(buf), "book.xlsx", { columns: ["Region", "Amount"] });
    expect(ds.columns.map((c) => c.name)).toEqual(["Region", "Amount"]);
    expect(report.skippedColumns).toEqual(["Notes"]);
  });
});

// ---------------------------------------------------------------- 8. row estimate

describe("8. large-file row estimate", () => {
  it("measures the sample in the file's own encoding, so UTF-16 is not counted twice", async () => {
    const rows = ["id,amount"];
    for (let i = 0; i < 100_000; i++) rows.push(`${100_000 + i},${(i % 1000) + 0.5}`);
    const text = `${rows.join("\n")}\n`;
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      bytes[2 + 2 * i] = c & 0xff;
      bytes[3 + 2 * i] = c >> 8;
    }
    const { report } = await parse(bytes, "utf16.csv", { maxRows: 10 });
    expect(report.encoding).toBe("utf-16le");
    const estimate = report.sampling?.estimatedTotalRows ?? 0;
    expect(estimate).toBeGreaterThan(90_000);
    expect(estimate).toBeLessThan(110_000);
  });
});

// ---------------------------------------------------------------- 9. unpivot

describe("9. unpivot", () => {
  it("pivots two-digit years at 50, like the parser", () => {
    const ds = dataset([
      stringCol("Region", ["North", "South"]),
      numberCol("Jan 99", [1, 2]),
      numberCol("Feb 99", [3, 4]),
      numberCol("Mar 99", [5, 6]),
    ]);
    const out = unpivotDataset(ds, {
      columns: ["Jan 99", "Feb 99", "Mar 99"],
      idColumns: ["Region"],
      kind: "month",
      suggestion: "",
    });
    const period = out.columns.find((c) => c.name === "Period");
    expect(period?.kind).toBe("date");
    if (period?.kind === "date")
      expect([...period.values.slice(0, 3)]).toEqual([utc(1999, 1, 1), utc(1999, 2, 1), utc(1999, 3, 1)]);
    const years = dataset([
      stringCol("Region", ["North"]),
      numberCol("FY98", [1]),
      numberCol("FY99", [2]),
      numberCol("FY00", [3]),
    ]);
    const byYear = unpivotDataset(years, {
      columns: ["FY98", "FY99", "FY00"],
      idColumns: ["Region"],
      kind: "year",
      suggestion: "",
    });
    const year = byYear.columns.find((c) => c.name === "Year");
    if (year?.kind !== "date") throw new Error("Year should be a date column");
    expect([...year.values]).toEqual([utc(1998, 1, 1), utc(1999, 1, 1), utc(2000, 1, 1)]);
  });

  it("does not reuse an existing column name for Period or Value", () => {
    const ds = dataset([
      stringCol("Period", ["A", "B"]),
      stringCol("value", ["x", "y"]),
      numberCol("Jan 24", [1, 2]),
      numberCol("Feb 24", [3, 4]),
      numberCol("Mar 24", [5, 6]),
    ]);
    const out = unpivotDataset(ds, {
      columns: ["Jan 24", "Feb 24", "Mar 24"],
      idColumns: ["Period", "value"],
      kind: "month",
      suggestion: "",
    });
    expect(out.columns.map((c) => c.name)).toEqual(["Period", "value", "Period (2)", "Value (2)"]);
    // The consent dialog names exactly the columns unpivoting will add.
    expect(
      unpivotColumnNames(
        ds.columns.map((c) => c.name),
        {
          columns: ["Jan 24", "Feb 24", "Mar 24"],
          idColumns: ["Period", "value"],
          kind: "month",
          suggestion: "",
        },
      ),
    ).toEqual({ period: "Period (2)", value: "Value (2)" });
  });
});

// ---------------------------------------------------------------- 10. JSON

describe("10. JSON", () => {
  it("keeps keys that first appear after record 10,000, typed from the records that have them", async () => {
    const records = Array.from({ length: 10_050 }, (_, i) =>
      i >= 10_020 ? { id: i, late: i * 2 } : { id: i },
    );
    const { ds } = await parse(JSON.stringify(records), "late.json");
    expect(column(ds, "late").kind).toBe("number");
    expect(cell(ds, "late", 10_030)).toBe(20_060);
    expect(cell(ds, "late", 5)).toBeNull();
  });
});

// ---------------------------------------------------------------- 11. unused export

describe("11. dead code", () => {
  it("no longer exports the unused MONTH_NAMES_FOR_WIDE", () => {
    expect(Object.keys(dates)).not.toContain("MONTH_NAMES_FOR_WIDE");
  });
});

// ---------------------------------------------------------------- 12. date distinct counts

describe("12. date profiling", () => {
  it("counts distinct timestamps exactly beyond 200,000", () => {
    const n = 250_000;
    const values = Array.from({ length: n }, (_, i) => utc(2020, 1, 1) + i * 60_000);
    const p = profileColumn({ ...dateCol("Event Time", values), hasTime: true }, 0, n);
    expect(p.distinct).toBe(n);
    expect(p.unique).toBe(true);
    expect(p.cardinality).toBe(1);
  });
});
