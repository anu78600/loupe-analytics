/**
 * File import: delimiter, encoding and header sniffing; number styles;
 * whole-column date decisions (DD/MM vs MM/DD); JSON flattening; Excel;
 * lossless degradation of typed columns; multibyte text across chunk edges.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { utc } from "@/engine/core/dates";
import { parseNumber, isNullToken } from "@/engine/parse/values";
import { detectDelimiter, detectEncoding } from "@/engine/parse/sniff";
import { listSheets } from "@/engine/parse/excel";
import { cell, column, parse } from "./helpers/dataset";

describe("number parsing", () => {
  it("reads currency, grouping, accounting negatives and percentages", () => {
    expect(parseNumber("₹1,23,456.50")).toEqual({ value: 123456.5, currency: "INR" });
    expect(parseNumber("$1,234")?.value).toBe(1234);
    expect(parseNumber("$1,234")?.currency).toBe("USD");
    expect(parseNumber("(1,234)")?.value).toBe(-1234);
    expect(parseNumber("12.5%")).toMatchObject({ value: 0.125, percent: true });
    expect(parseNumber("-0.75")?.value).toBe(-0.75);
    expect(parseNumber("1.234,56", "comma")?.value).toBeCloseTo(1234.56, 10);
    expect(parseNumber("abc")).toBeNull();
  });

  it("reads space-grouped thousands whichever decimal mark follows", () => {
    expect(parseNumber("12 500,00")?.value).toBe(12500);
    expect(parseNumber("1 234 567.89")?.value).toBeCloseTo(1234567.89, 6);
    expect(parseNumber("€ 12 500,50")?.value).toBeCloseTo(12500.5, 6);
    expect(parseNumber("12 34 567")).toBeNull();
  });

  it("recognises blank tokens", () => {
    for (const t of ["", "  ", "NA", "N/A", "null", "-", "—"])
      expect(isNullToken(t), JSON.stringify(t)).toBe(true);
    expect(isNullToken("0")).toBe(false);
  });
});

describe("sniffing", () => {
  it("finds the delimiter", () => {
    expect(detectDelimiter("a;b;c\n1;2;3\n4;5;6\n")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3\n")).toBe("\t");
    expect(detectDelimiter("a|b|c\n1|2|3\n")).toBe("|");
    expect(detectDelimiter('name,city\n"Doe, Jane",Pune\n"Roe, Rick",Delhi\n')).toBe(",");
  });

  it("finds the encoding", () => {
    expect(detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("utf-8");
    expect(detectEncoding(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toBe("utf-16le");
    // "Café" in Windows-1252: 0xE9 is not valid UTF-8 on its own.
    expect(detectEncoding(new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x0a]))).toBe("windows-1252");
  });
});

describe("delimited files", () => {
  it("parses a semicolon file with European decimals", async () => {
    const { ds } = await parse("Produkt;Preis;Menge\nA;1.234,56;3\nB;99,90;1\n", "eu.csv");
    expect(cell(ds, "Preis", 0)).toBeCloseTo(1234.56, 10);
    expect(cell(ds, "Preis", 1)).toBeCloseTo(99.9, 10);
    expect(cell(ds, "Menge", 0)).toBe(3);
  });

  it("decodes Windows-1252 text", async () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode("name,city\n"),
      0x52,
      0x65,
      0x6e,
      0xe9,
      0x2c,
      0x50,
      0x61,
      0x72,
      0x69,
      0x73,
      0x0a,
    ]);
    const { ds } = await parse(bytes, "latin.csv");
    expect(cell(ds, "name", 0)).toBe("René");
  });

  it("keeps multibyte characters intact across 4 MB chunk boundaries", async () => {
    const lines = ["id,label,amount"];
    let size = 0;
    for (let i = 0; size < 9 * 1024 * 1024; i++) {
      const line = `${i},₹ कीमत ${i},₹${(i % 997) + 0.5}`;
      lines.push(line);
      size += line.length * 2;
    }
    const { ds } = await parse(lines.join("\n") + "\n", "big.csv");
    expect(ds.rowCount).toBe(lines.length - 1);
    const label = column(ds, "label");
    if (label.kind !== "string") throw new Error("label should be text");
    expect(label.dict.some((v) => v.includes("�"))).toBe(false);
    expect(cell(ds, "amount", 1000)).toBeCloseTo((1000 % 997) + 0.5, 10);
  }, 60_000);

  it("degrades a mostly-numeric column to text without losing values", async () => {
    const rows = ["code"];
    for (let i = 0; i < 90; i++) rows.push(String(100 + i));
    for (let i = 0; i < 10; i++) rows.push(`X-${i}`);
    const { ds } = await parse(rows.join("\n"), "codes.csv");
    const col = column(ds, "code");
    expect(col.kind).toBe("string");
    expect(cell(ds, "code", 0)).toBe("100");
    expect(cell(ds, "code", 95)).toBe("X-5");
  });
});

describe("header rows made of period labels (wide tables)", () => {
  it("treats month labels above numbers as a header", async () => {
    const { ds, report } = await parse(
      "Region,Jan 2024,Feb 2024,Mar 2024\nNorth,120,135,150\nSouth,90,95,99\n",
      "wide.csv",
    );
    expect(report.headerDetected).toBe(true);
    expect(ds.rowCount).toBe(2);
    expect(cell(ds, "Feb 2024", 0)).toBe(135);
  });

  it("treats ascending years above numbers as a header", async () => {
    const { ds } = await parse("Product,2022,2023,2024\nAlpha,10,12,15\nBeta,7,9,11\n", "years.csv");
    expect(ds.rowCount).toBe(2);
    expect(cell(ds, "2023", 1)).toBe(9);
  });
});

describe("dates: the whole column decides DD/MM vs MM/DD", () => {
  it("proves day-first when any day is above 12", async () => {
    const { ds, report } = await parse("d,v\n03/04/2025,1\n15/04/2025,2\n", "dmy.csv");
    expect(cell(ds, "d", 0)).toBe(utc(2025, 4, 3));
    expect(cell(ds, "d", 1)).toBe(utc(2025, 4, 15));
    expect(report.dateFormats.find((f) => f.column === "d")?.ambiguous).toBe(false);
  });

  it("proves month-first when any month position is above 12", async () => {
    const { ds } = await parse("d,v\n04/03/2025,1\n04/15/2025,2\n", "mdy.csv", { preferDayFirst: true });
    expect(cell(ds, "d", 0)).toBe(utc(2025, 4, 3));
    expect(cell(ds, "d", 1)).toBe(utc(2025, 4, 15));
  });

  it("falls back to the locale preference when nothing proves the order, and says so", async () => {
    const csv = "d,v\n03/04/2025,1\n05/06/2025,2\n";
    const dmy = await parse(csv, "a.csv", { preferDayFirst: true });
    expect(cell(dmy.ds, "d", 0)).toBe(utc(2025, 4, 3));
    expect(dmy.report.dateFormats.find((f) => f.column === "d")?.ambiguous).toBe(true);
    const mdy = await parse(csv, "a.csv", { preferDayFirst: false });
    expect(cell(mdy.ds, "d", 0)).toBe(utc(2025, 3, 4));
    const forced = await parse(csv, "a.csv", { preferDayFirst: true, dateOrderOverrides: { d: "MDY" } });
    expect(cell(forced.ds, "d", 0)).toBe(utc(2025, 3, 4));
  });

  it("reads ISO dates and month names", async () => {
    const { ds } = await parse("iso,named\n2025-04-03,3 Apr 2025\n2025-12-31,31 Dec 2025\n", "iso.csv");
    expect(cell(ds, "iso", 0)).toBe(utc(2025, 4, 3));
    expect(cell(ds, "named", 1)).toBe(utc(2025, 12, 31));
  });
});

describe("JSON", () => {
  it("flattens nested objects and reads wrapped arrays", async () => {
    const json = JSON.stringify({
      data: [
        { id: 1, customer: { city: "Pune" }, amount: 10 },
        { id: 2, customer: { city: "Delhi" }, amount: 20 },
      ],
    });
    const { ds } = await parse(json, "orders.json");
    const names = ds.columns.map((c) => c.name);
    expect(names.some((n) => /customer.*city/i.test(n))).toBe(true);
    expect(ds.rowCount).toBe(2);
  });

  it("reads line-delimited JSON", async () => {
    const { ds } = await parse('{"a":1,"b":"x"}\n{"a":2,"b":"y"}\n', "events.ndjson");
    expect(ds.rowCount).toBe(2);
    expect(cell(ds, "a", 1)).toBe(2);
  });
});

describe("Excel", () => {
  it("lists sheets and reads typed cells, including real dates", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Note"], ["cover sheet"]]), "Cover");
    const sheet = XLSX.utils.aoa_to_sheet(
      [
        ["Order Date", "Amount", "City"],
        // SheetJS stores JS dates by their local wall-clock time, which is what Excel shows.
        [new Date(2025, 3, 3), 1200.5, "Pune"],
        [new Date(2025, 3, 15), 80, "Delhi"],
      ],
      { cellDates: true },
    );
    XLSX.utils.book_append_sheet(wb, sheet, "Orders");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(listSheets(buf)).toEqual(["Cover", "Orders"]);
    const { ds } = await parse(new Uint8Array(buf), "book.xlsx", { sheet: "Orders" });
    expect(ds.rowCount).toBe(2);
    expect(cell(ds, "Amount", 0)).toBe(1200.5);
    expect(cell(ds, "Order Date", 1)).toBe(utc(2025, 4, 15));
  });
});
