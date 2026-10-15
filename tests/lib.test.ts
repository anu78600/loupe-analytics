/**
 * Browser-side helpers in src/lib: the AI layer's number check
 * (unverifiedNumbers must not glue a unit onto the next word) and the SQL
 * lab's row cap (applied in SQL, so DuckDB stops early; the wrapper is run in
 * DuckDB here to prove ordering and trailing comments survive it).
 */
import { describe, expect, it } from "vitest";
import { DuckDBInstance } from "@duckdb/node-api";
import { unverifiedNumbers } from "@/lib/ai";
import { limitedQuery } from "@/lib/duckdb";

describe("unverifiedNumbers", () => {
  const payload = JSON.stringify({
    markets: 12,
    revenue: "₹12.5L",
    orders: "1,23,456",
    growth: "18.2%",
    aov: "₹2,240",
    lift: "3x",
  });

  it("does not read the first letter of the next word as a unit", () => {
    // Previously checked as "12M", "12B", "12L" and flagged although 12 is in the payload.
    expect(unverifiedNumbers("Sales grew in 12 Markets.", payload)).toEqual([]);
    expect(unverifiedNumbers("12 Bangalore stores beat target.", payload)).toEqual([]);
    expect(unverifiedNumbers("Spread over 12 Locations and 12 Kiosks.", payload)).toEqual([]);
    expect(unverifiedNumbers("12 Crore-plus buyers", payload)).toEqual([]);
  });

  it("still reads real units, and flags figures the payload lacks", () => {
    expect(unverifiedNumbers("Revenue reached ₹12.5L, up 18.2%.", payload)).toEqual([]);
    expect(unverifiedNumbers("Revenue reached ₹99.5L.", payload)).toEqual(["₹99.5L"]);
    expect(unverifiedNumbers("Growth was 41.7% at 3x the rate.", payload)).toEqual(["41.7%"]);
    // A unit really attached to the number is part of the figure, so 12M is not the payload's 12.
    expect(unverifiedNumbers("We reached 12M users.", payload)).toEqual(["12M"]);
    expect(unverifiedNumbers("We reached 12 M users.", payload)).toEqual(["12 M"]);
  });

  it("treats Indian and international grouping alike", () => {
    expect(unverifiedNumbers("1,23,456 orders, AOV ₹2,240", payload)).toEqual([]);
    expect(unverifiedNumbers("123,456 orders", payload)).toEqual([]);
  });

  it("returns tokens without stray spaces or trailing commas", () => {
    expect(unverifiedNumbers("Figures 77, 88 and 99.", payload)).toEqual(["77", "88", "99"]);
  });
});

describe("SQL lab row cap", () => {
  it("wraps the query so the LIMIT is applied in SQL", () => {
    expect(limitedQuery("SELECT * FROM t;", 200)).toBe(
      "SELECT * FROM (\nSELECT * FROM t\n) AS lab LIMIT 200",
    );
    expect(limitedQuery("  FROM t ;; \n", 10.7)).toBe("SELECT * FROM (\nFROM t\n) AS lab LIMIT 10");
    // A trailing line comment ends at the newline, before the closing parenthesis.
    expect(limitedQuery("SELECT 1 -- note", 5)).toBe("SELECT * FROM (\nSELECT 1 -- note\n) AS lab LIMIT 5");
  });

  it("returns the first rows in the query's own order, in DuckDB", async () => {
    const db = await DuckDBInstance.create(":memory:");
    const conn = await db.connect();
    try {
      const rows = (
        await conn.runAndReadAll(
          limitedQuery("SELECT range AS n FROM range(1000000) ORDER BY n DESC -- biggest first\n;", 3),
        )
      ).getRowObjectsJson();
      expect(rows.map((r) => Number(r.n))).toEqual([999_999, 999_998, 999_997]);
    } finally {
      conn.closeSync();
    }
  });
});
