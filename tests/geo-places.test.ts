/**
 * Places beyond India and the US (version 41.0): the states and provinces of
 * Brazil, Canada, Australia and Mexico, country names in other languages and
 * ISO alpha-3 codes, UK postcodes, accented place names, and the rule that a
 * two-letter code written in lower case counts only in a column of many of
 * them (so "ok" in a status column is not Oklahoma).
 */
import { describe, expect, it } from "vitest";
import { isCountry, isCountryCode, isKnownCity, matchRegionState } from "@/engine/profile/geo";
import { detectStatePattern, detectStringPatterns, patternShare } from "@/engine/profile/patterns";
import type { ValueCount } from "@/engine/profile/types";

const vc = (pairs: Array<[string, number]>): ValueCount[] =>
  pairs.map(([value, count]) => ({ value, count }));
const total = (v: ValueCount[]) => v.reduce((n, x) => n + x.count, 0);

describe("states and provinces", () => {
  it("reads Brazil's UF codes and names, with or without accents", () => {
    const codes = vc([
      ["SP", 40],
      ["RJ", 25],
      ["MG", 20],
      ["PR", 10],
      ["RS", 5],
    ]);
    expect(detectStatePattern(codes, total(codes))).toEqual({ share: 1, region: "BR" });
    expect(matchRegionState("São Paulo", "BR")?.code).toBe("SP");
    expect(matchRegionState("Sao Paulo", "BR")?.code).toBe("SP");
    expect(matchRegionState("Paraná", "BR")?.code).toBe("PR");
  });

  it("reads Canadian provinces and Australian states", () => {
    const ca = vc([
      ["Ontario", 30],
      ["Quebec", 20],
      ["British Columbia", 10],
    ]);
    expect(detectStatePattern(ca, total(ca))?.region).toBe("CA");
    const au = vc([
      ["NSW", 30],
      ["VIC", 25],
      ["QLD", 15],
    ]);
    expect(detectStatePattern(au, total(au))?.region).toBe("AU");
  });

  it("reads Mexican states by name only, never the country", () => {
    expect(matchRegionState("Jalisco", "MX")?.name).toBe("Jalisco");
    expect(matchRegionState("Nuevo Leon", "MX")?.name).toBe("Nuevo León");
    expect(matchRegionState("México", "MX")).toBeUndefined();
    // Its ISO codes are also country codes ("COL" is Colombia) and are not matched.
    expect(matchRegionState("COL", "MX")).toBeUndefined();
  });

  it("keeps India first and the US for US codes, as before", () => {
    const india = vc([
      ["Maharashtra", 30],
      ["Karnataka", 20],
      ["Delhi", 10],
    ]);
    expect(detectStatePattern(india, total(india))?.region).toBe("IN");
    const us = vc([
      ["CA", 30],
      ["NY", 20],
      ["TX", 15],
      ["OR", 5],
    ]);
    expect(detectStatePattern(us, total(us))?.region).toBe("US");
  });

  it("doesn't read a status word as a state code", () => {
    const status = vc([
      ["ok", 62],
      ["cancelled_by_guest", 20],
      ["no_show", 18],
    ]);
    expect(detectStatePattern(status, total(status))).toBeNull();
  });

  it("still reads a cleaned-up column of lower-case codes", () => {
    const lower = vc([
      ["mh", 30],
      ["ka", 25],
      ["dl", 20],
      ["tn", 15],
    ]);
    expect(detectStatePattern(lower, total(lower))).toEqual({ share: 1, region: "IN" });
  });
});

describe("countries, cities and postcodes", () => {
  it("knows country names in their own and neighbouring languages", () => {
    for (const name of [
      "Deutschland",
      "Belgique",
      "España",
      "Brasil",
      "Österreich",
      "Türkiye",
      "Royaume-Uni",
    ])
      expect(isCountry(name), name).toBe(true);
  });

  it("knows ISO alpha-3 codes in either case, as a separate pattern", () => {
    expect(isCountryCode("IND")).toBe(true);
    expect(isCountryCode("bra")).toBe(true);
    expect(isCountryCode("XYZ")).toBe(false);
    const hits = detectStringPatterns(
      vc([
        ["IND", 10],
        ["BRA", 10],
        ["USA", 10],
      ]),
      30,
    );
    expect(patternShare(hits, "countrycode")).toBe(1);
    expect(patternShare(hits, "country")).toBe(0.3333333333333333);
  });

  it("knows more cities, including accented spellings", () => {
    for (const city of ["Curitiba", "Belo Horizonte", "Málaga", "Köln", "Sevilla", "Lyon"])
      expect(isKnownCity(city), city).toBe(true);
    // Everyday words that are also cities stay out.
    expect(isKnownCity("Reading")).toBe(false);
  });

  it("recognises UK postcodes", () => {
    const hits = detectStringPatterns(
      vc([
        ["BS1 4QA", 10],
        ["M4 5JD", 10],
        ["EC1A 1BB", 10],
      ]),
      30,
    );
    expect(patternShare(hits, "postcode")).toBe(1);
  });
});
