/**
 * Column roles for tables from any tool, country or language (version 41.0):
 * money from a currency mark in the header, money per unit, counts that are
 * neither money nor IDs, 0/1 flags by name, entity-named identifiers, shares
 * of a whole, places beyond India and the US, postcodes and free text.
 *
 * Each case calls inferRole directly with a small, realistic column. Plain
 * English headers take their tokens from names.tokenize; headers whose tokens
 * come from the shared vocabulary (a currency mark, a unit, a translation)
 * pass the canonical tokens names.tokenize writes for them, so these rules are
 * pinned on their own.
 */
import { describe, expect, it } from "vitest";
import { tokenize } from "@/engine/profile/names";
import { inferRole, type RoleDecision, type RoleInput } from "@/engine/profile/roles";
import type { NumericStats, PatternHit } from "@/engine/profile/types";

/** The statistics the role rules read (range, whole numbers, half steps); the rest are rough. */
function stats(values: readonly number[]): NumericStats {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const at = (q: number) => sorted[Math.floor(q * (sorted.length - 1))] as number;
  return {
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
    mean: sum / values.length,
    median: at(0.5),
    std: 0,
    q1: at(0.25),
    q3: at(0.75),
    skew: 0,
    sum,
    outliers: 0,
    zeros: values.filter((v) => v === 0).length,
    negatives: values.filter((v) => v < 0).length,
    integer: values.every((v) => Number.isInteger(v)),
    halfSteps: values.every((v) => Number.isInteger(v * 2)),
  };
}

/** `n` values spread evenly from `from` to `to`, rounded to `decimals` places. */
const spread = (from: number, to: number, decimals = 0, n = 120): number[] =>
  Array.from({ length: n }, (_, i) => Number((from + ((to - from) * i) / (n - 1)).toFixed(decimals)));

/** 0/1 values with both present, as a flag column holds. */
const zeroOne = Array.from({ length: 120 }, (_, i) => (i % 3 === 0 ? 1 : 0));

/** The role of a number column; tokens from names.tokenize unless given. */
function num(name: string, values: readonly number[], extra: Partial<RoleInput> = {}): RoleDecision {
  return inferRole({
    name,
    tokens: tokenize(name),
    storage: "number",
    rowCount: values.length,
    nonNull: values.length,
    distinct: new Set(values).size,
    numeric: stats(values),
    patterns: [],
    ...extra,
  });
}

interface TextShape {
  distinct: number;
  avgLength: number;
  rows?: number;
  spaceShare?: number;
  patterns?: PatternHit[];
  tokens?: string[];
  stateRegion?: RoleInput["stateRegion"];
}

/** The role of a text column described by its shape: distinct values, mean length, spaces and patterns. */
function text(name: string, shape: TextShape): RoleDecision {
  const rows = shape.rows ?? 240;
  return inferRole({
    name,
    tokens: shape.tokens ?? tokenize(name),
    storage: "string",
    rowCount: rows,
    nonNull: rows,
    distinct: shape.distinct,
    avgLength: shape.avgLength,
    spaceShare: shape.spaceShare ?? 0,
    patterns: shape.patterns ?? [],
    stateRegion: shape.stateRegion,
  });
}

const codes: PatternHit[] = [{ kind: "id", share: 1 }];

describe("money from the header", () => {
  it("reads a currency mark or code in the header as money", () => {
    const cases: Array<[string, string[]]> = [
      ["ADR (€)", ["adr", "money"]],
      ["GDP (current US$)", ["gdp", "current", "money"]],
      ["Monetary_GBP", ["monetary", "money"]],
      ["Receita Líquida (R$ mil)", ["revenue", "net", "money", "thousand"]],
      ["AUM (₹ Cr)", ["aum", "money", "crore"]],
    ];
    for (const [name, tokens] of cases)
      expect(num(name, spread(120, 98_000, 2), { tokens }).role, name).toBe("currency");
  });

  it("averages money per unit instead of calling it a rate", () => {
    const cases: Array<[string, number[], string[]?]> = [
      ["Cost per item", spread(12, 480, 2)],
      ["Cost Per Click (CPC)", spread(0.12, 4.8, 2)],
      ["Avg. CPC", spread(0.08, 0.95, 2)],
      ["Daily Rate", spread(102, 1499)],
      ["Average Order Value", spread(450, 3200, 2)],
      ["Rate per Sq.Ft. (₹)", spread(3200, 18_500), ["rate", "per", "sqft", "money"]],
      ["GDP per capita (current US$)", spread(260, 98_000, 1), ["gdp", "per", "capita", "current", "money"]],
      ["Avg Rent (₹/sq ft/month)", spread(45, 320, 1), ["average", "rent", "money", "per", "sqft", "month"]],
      // A currency mark before "/" reads as money per unit: rupees per litre.
      ["Dar (₹/Ltr)", spread(88, 112, 2), ["dar", "money", "per", "litre"]],
      ["Cost per Hour", spread(12, 480, 2)],
      ["Price per m²", spread(1800, 9600), ["price", "per", "sqm"]],
    ];
    for (const [name, values, tokens] of cases) {
      const d = num(name, values, tokens ? { tokens } : {});
      expect(d.role, name).toBe("currency");
      expect(d.additivity, name).toBe("non-additive");
      expect(d.defaultAgg, name).toBe("avg");
    }
  });

  it("keeps a ratio beside a money word a rate", () => {
    for (const name of ["Average Interest Rate", "Interest Rate", "Price Index", "Exchange Rate"])
      expect(num(name, spread(6.5, 96.4, 2)).role, name).toBe("rate");
  });

  it("lets a count word outrank a mark in the header, and a percent sign outrank both", () => {
    const orders = num("Number of Orders (USD)", spread(3, 940), {
      tokens: ["number", "of", "order", "money"],
    });
    expect(orders.role).toBe("measure");
    const share = num("Share of Revenue (%)", spread(2, 64, 1), {
      tokens: ["share", "of", "revenue", "percent"],
    });
    expect(share.role).toBe("percentage");
  });
});

describe("numbers that are not money", () => {
  it("doesn't read 'total' beside another noun as money", () => {
    for (const name of [
      "Total Orders",
      "Population, total",
      "Sessions - Total",
      "Total day minutes",
      "Total Recipients",
      "7 Day Total Orders (#)",
    ])
      expect(num(name, spread(3, 1840)).role, name).toBe("measure");
  });

  it("still reads a row's total and an order's or invoice's total as money", () => {
    for (const name of ["Total", "Grand Total", "Order Total", "Invoice Total"])
      expect(num(name, spread(120, 9800, 2)).role, name).toBe("currency");
  });

  it("reads a countable noun in the plural as a count, unless an amount word or symbol says money", () => {
    for (const name of ["Active Loans", "Claims", "Bills", "Payments", "Credits"]) {
      const d = num(name, spread(0, 340));
      expect(d.role, name).toBe("measure");
      expect(d.defaultAgg, name).toBe("sum");
    }
    expect(num("Loan Amount", spread(25_000, 900_000)).role).toBe("currency");
    expect(num("Claims", spread(1200, 98_000), { currencyFormat: "INR" }).role).toBe("currency");
    // Net additions of subscribers, in millions: a count, though written with decimals.
    const adds = num("MoM Net Adds (Mn)", spread(-0.4, 3.6, 2), {
      tokens: ["mo", "m", "net", "adds", "million"],
    });
    expect(adds.role).toBe("measure");
  });

  it("reads a quantity in a physical unit, or named as one, as a measure", () => {
    const units: Array<[string, string[]]> = [
      ["Budget Cement (MT)", ["budget", "cement", "tonne"]],
      ["Net Wt (gms)", ["net", "weight", "gram"]],
      ["Net Absorption (mn sq ft)", ["net", "absorption", "million", "sqft"]],
    ];
    for (const [name, tokens] of units)
      expect(num(name, spread(12, 4800, 1), { tokens }).role, name).toBe("measure");
    for (const name of ["Net Weight", "Sales Volume", "Loan_Amount_Term", "Loan Tenure (months)"])
      expect(num(name, spread(12, 480)).role, name).toBe("measure");
    // A unit as the denominator is money per unit; a money word as the head noun is money.
    const perKg = num("Price/kg", spread(18, 240, 2));
    expect(perKg.role).toBe("currency");
    expect(perKg.additivity).toBe("non-additive");
    expect(num("Volume Discount", spread(50, 4800, 2)).role).toBe("currency");
    // A unit before the "/" is the column's own: kilograms sold a month.
    expect(num("Sales (kg/month)", spread(120, 9800)).role).toBe("measure");
  });

  it("reads money words counted in days or hours as durations, but not a time of day", () => {
    for (const name of [
      "Credit Period (days)",
      "Credit Days",
      "Days Sales Outstanding",
      "Overtime Pay (hrs)",
    ])
      expect(num(name, spread(3, 120)).role, name).toBe("measure");
    expect(num("Days Sales Outstanding", spread(18, 96)).additivity).toBe("non-additive");
    // "Day" and "hour" alone say when the money was charged.
    for (const name of ["Total day charge", "Peak Hour Charge"])
      expect(num(name, spread(12, 480, 2)).role, name).toBe("currency");
  });

  it("reads 'value' as money only in a money context", () => {
    for (const name of ["Value", "Result Val"])
      expect(num(name, spread(0.2, 98.4, 1)).role, name).toBe("measure");
    for (const name of ["Order Value", "Deal Value", "close_value", "Closing Value"])
      expect(num(name, spread(120, 98_000, 2)).role, name).toBe("currency");
  });

  it("reads ARR beside a flight word as an arrival, not recurring revenue", () => {
    expect(num("ARR_DELAY", spread(-45, 380)).role).toBe("measure");
    expect(num("ARR", spread(12_000, 950_000)).role).toBe("currency");
  });

  it("reads a provident fund as money but a power factor as a number", () => {
    expect(num("PF", spread(1800, 12_000)).role).toBe("currency");
    expect(num("PF", spread(0.72, 0.99, 2)).role).not.toBe("currency");
  });
});

describe("0/1 flags by name", () => {
  it("reads a 0/1 column named for an event, a state or a yes/no question as a flag", () => {
    const cases: Array<[string, string[]?]> = [
      ["Machine failure"],
      ["Work_accident"],
      ["promotion_last_5years"],
      ["Termd"],
      ["viewed"],
      ["certified"],
      ["Exited"],
      ["Did Purchase"],
      ["Credit_History"],
      ["no_show_flg", ["noshow", "flag"]],
      ["¿En inventario?", ["en", "inventory"]],
    ];
    for (const [name, tokens] of cases)
      expect(num(name, zeroOne, tokens ? { tokens } : {}).role, name).toBe("boolean");
  });

  it("keeps a 0/1 count, amount or answer to 'how many' a number", () => {
    expect(num("Units Shipped", zeroOne).role).toBe("measure");
    expect(num("Late Fee", zeroOne).role).toBe("currency");
    expect(num("How many children?", zeroOne).role).toBe("measure");
  });

  it("needs both 0 and 1 for a flag read from the name alone", () => {
    expect(
      num(
        "viewed",
        zeroOne.map(() => 0),
      ).role,
    ).not.toBe("boolean");
  });
});

describe("identifiers and counts", () => {
  it("reads large whole numbers under an entity's bare name as its IDs", () => {
    const ids = spread(500_100, 517_000);
    const cases: Array<[string, string[]?]> = [
      ["Order"],
      ["Invoice"],
      ["Material"],
      ["Sales Order"],
      ["Billing Doc.", ["billing", "document"]],
    ];
    for (const [name, tokens] of cases)
      expect(num(name, ids, tokens ? { tokens } : {}).role, name).toBe("identifier");
    // In the plural, or as an event ("DELIVERED" tokenises to "delivery"), the name counts instead.
    expect(num("Orders", spread(1200, 9800)).role).toBe("measure");
    expect(num("DELIVERED", spread(1000, 98_000), { tokens: ["delivery"] }).role).toBe("measure");
    // Small numbers under an entity's name are not its IDs (a sort order).
    expect(num("Order", spread(1, 40)).role).not.toBe("identifier");
  });

  it("reads an ID word over codes stored as decimals as an identifier", () => {
    const pseudo = spread(1_197_596_843.1673, 2_097_596_843.1673, 4);
    expect(num("user_pseudo_id", pseudo).role).toBe("identifier");
  });

  it("never reads a count as an ID", () => {
    for (const name of [
      "# Customers",
      "Number of Employees",
      "Code Redemptions",
      "Key events",
      "tickets_created",
      "Ticket Count",
    ]) {
      const d = num(name, spread(3, 4800));
      expect(d.role, name).toBe("measure");
      expect(d.defaultAgg, name).toBe("sum");
    }
    // An ID word at the end, or an entity's number, still names an ID.
    for (const name of ["users_id", "Order No.", "Customer Number"])
      expect(num(name, spread(10_001, 10_240)).role, name).toBe("identifier");
  });

  it("reads entity-named and standard ID columns of codes as identifiers", () => {
    for (const name of ["Material", "PO Number", "number", "Accession Nbr", "UHID", "USUBJID", "MRN", "IMEI"])
      expect(text(name, { distinct: 180, avgLength: 11, patterns: codes }).role, name).toBe("identifier");
    // A type or category over codes is a category ("Tipo" tokenises to "type").
    expect(text("Tipo", { distinct: 120, avgLength: 6, patterns: codes, tokens: ["type"] }).role).toBe(
      "dimension",
    );
  });

  it("reads a ticket's name written as a sentence as text, not an ID", () => {
    expect(text("Ticket name", { distinct: 230, avgLength: 34, spaceShare: 1 }).role).toBe("text");
    expect(text("Ticket ID", { distinct: 230, avgLength: 10, patterns: codes }).role).toBe("identifier");
  });
});

describe("rates and shares", () => {
  it("reads retention, attainment and completion as percentages", () => {
    const fraction = num("d1Retention", spread(0.18, 0.62, 3));
    expect(fraction.role).toBe("percentage");
    expect(fraction.percentScale).toBe(1);
    const points = num("D7 Retention", spread(8.5, 41.2, 1));
    expect(points.role).toBe("percentage");
    expect(points.percentScale).toBe(100);
    // Over target is still a share.
    expect(num("Target Attainment", spread(42, 128)).percentScale).toBe(100);
    expect(num("Course Completion", spread(0, 100)).role).toBe("percentage");
  });

  it("reads retention far above 100 as a count, and a completion time as a duration", () => {
    expect(num("Retention", spread(1200, 4800)).role).toBe("measure");
    expect(num("Completion Time", spread(5, 95)).role).toBe("measure");
  });

  it("reads a discount stored as fractions as a percentage, and as an amount otherwise", () => {
    const fraction = num("Discount", spread(0, 0.8, 2));
    expect(fraction.role).toBe("percentage");
    expect(fraction.percentScale).toBe(1);
    expect(num("Discount", spread(12.5, 4800, 2)).role).toBe("currency");
  });

  it("doesn't read years of service as a rating scale", () => {
    const years = Array.from({ length: 120 }, (_, i) => 1 + (i % 10));
    expect(num("length_of_service", years).role).toBe("measure");
    // A plain 1–5 column with no name to go on is still a scale.
    expect(
      num(
        "Q7",
        Array.from({ length: 120 }, (_, i) => 1 + (i % 5)),
      ).role,
    ).toBe("rate");
  });

  it("reads a meter index in a physical unit as a reading, not a ratio", () => {
    const d = num("Index relevé (m³)", spread(1200, 98_000), { tokens: ["index", "releve", "cubicmetre"] });
    expect(d.role).toBe("measure");
    expect(d.additivity).toBe("semi-additive");
  });
});

describe("places", () => {
  it("names the country of the states and provinces it recognises", () => {
    const regions: Array<[RoleInput["stateRegion"], string]> = [
      ["BR", "Brazilian states"],
      ["CA", "Canadian provinces"],
      ["AU", "Australian states"],
      ["MX", "Mexican states"],
      ["US", "US states"],
      ["IN", "Indian states"],
    ];
    for (const [region, label] of regions) {
      const d = text("UF", {
        distinct: 12,
        avgLength: 2,
        patterns: [{ kind: "state", share: 1 }],
        stateRegion: region,
        tokens: ["state"],
      });
      expect(d.role, label).toBe("geo");
      expect(d.geoLevel, label).toBe("state");
      expect(d.geoRegion, label).toBe(region);
      expect(d.reason, label).toContain(label);
    }
  });

  it("never makes a status, stage or result a place", () => {
    const okAsOklahoma: PatternHit[] = [{ kind: "state", share: 0.62 }];
    for (const name of ["Status", "Booking Status", "Stage"])
      expect(
        text(name, { distinct: 3, avgLength: 8, patterns: okAsOklahoma, stateRegion: "US" }).role,
        name,
      ).toBe("dimension");
    const countries: PatternHit[] = [{ kind: "country", share: 0.7 }];
    expect(text("Result", { distinct: 4, avgLength: 6, patterns: countries }).role).toBe("dimension");
  });

  it("reads a place by its header when Loupe doesn't know the values", () => {
    for (const name of ["City", "County", "Village", "District", "Town"]) {
      const d = text(name, { distinct: 140, avgLength: 9 });
      expect(d.role, name).toBe("geo");
      expect(d.geoLevel, name).toBe("city");
    }
    const province = text("Provincia", { distinct: 40, avgLength: 9, tokens: ["province"] });
    expect(province.role).toBe("geo");
    expect(province.geoLevel).toBe("state");
    expect(province.geoRegion).toBeUndefined();
    // A classification of places is a category.
    for (const name of ["City Tier", "City_Category", "Zip Code Type"])
      expect(text(name, { distinct: 3, avgLength: 6 }).role, name).toBe("dimension");
  });

  it("reads postcodes, before the address rule", () => {
    const uk = text("Default Address Zip", {
      distinct: 180,
      avgLength: 7,
      spaceShare: 1,
      patterns: [{ kind: "postcode", share: 1 }],
    });
    expect(uk.role).toBe("geo");
    expect(uk.geoLevel).toBe("postal");
    expect(uk.geoRegion).toBeUndefined();
    const zip = text("Zip", { distinct: 120, avgLength: 5, patterns: [{ kind: "zip", share: 1 }] });
    expect(zip.geoRegion).toBe("US");
    // Canada's "K1A 0B1": a format Loupe doesn't check, under a postal name.
    expect(text("Postal Code", { distinct: 150, avgLength: 7, spaceShare: 1 }).geoLevel).toBe("postal");
    // Four-digit codes stored as numbers (Australia, Belgium, Switzerland).
    expect(num("Postcode", spread(3000, 3999)).geoLevel).toBe("postal");
    expect(num("Postal Votes", spread(1000, 4800)).role).toBe("measure");
  });

  it("reads ISO country codes as countries only under a country header", () => {
    const iso: PatternHit[] = [{ kind: "countrycode", share: 1 }];
    const country = text("country", { distinct: 40, avgLength: 3, patterns: iso });
    expect(country.role).toBe("geo");
    expect(country.geoLevel).toBe("country");
    expect(country.geoRegion).toBe("WORLD");
    expect(text("Grade", { distinct: 6, avgLength: 3, patterns: iso }).role).toBe("dimension");
  });

  it("reads misspelt and Spanish latitude and longitude", () => {
    for (const name of ["Lattitude", "Latitud"])
      expect(num(name, spread(-37.9, -37.6, 5)).geoLevel, name).toBe("latitude");
    for (const name of ["Longtitude", "Longitud"])
      expect(num(name, spread(144.8, 145.2, 5)).geoLevel, name).toBe("longitude");
  });
});

describe("free text", () => {
  it("reads narrations, actions taken, remarks and subjects as text", () => {
    expect(text("Narration", { distinct: 210, avgLength: 38, spaceShare: 0.2 }).role).toBe("text");
    // Written by people, so text even when a few remarks repeat.
    expect(text("Action Taken", { distinct: 6, avgLength: 28, spaceShare: 1 }).role).toBe("text");
    expect(text("Remarks", { distinct: 5, avgLength: 24, spaceShare: 1 }).role).toBe("text");
    expect(text("Objet", { distinct: 200, avgLength: 30, spaceShare: 1, tokens: ["subject"] }).role).toBe(
      "text",
    );
  });

  it("reads a handful of repeated reasons as categories, and varied ones as text", () => {
    expect(text("reason", { distinct: 6, avgLength: 22, spaceShare: 1 }).role).toBe("dimension");
    expect(text("Cancellation Reason", { distinct: 180, avgLength: 40, spaceShare: 1 }).role).toBe("text");
  });
});
