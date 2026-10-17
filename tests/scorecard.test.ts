/**
 * Tall scorecards (version 42.0): a table with one metric per row ("Metric |
 * Month | Value | Target"), as analysts build MIS sheets, board packs, flash
 * reports and branch scorecards.
 *
 * Covered: structure.detectTallFormat finds the metric, value and id columns
 * of typical scorecards and leaves ordinary tables alone (transactions with a
 * category, expense heads, a department's target against actual, melted
 * months, every layout of the detection suite and every demo);
 * parse/pivot.ts turns the metrics into columns with every figure in exactly
 * one cell (rows, names, blanks, units, repeats, unreadable cells and number
 * formats); Session.pivot() and the store's pivot action adopt the result.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Column, Dataset, NumberColumn, StringColumn } from "@/engine/core/types";
import type { IngestOptions } from "@/engine/core/types";
import type { ContextRequest } from "@/engine/session";
import { Session } from "@/engine/session";
import { utc } from "@/engine/core/dates";
import { pivotDataset, pivotPlan } from "@/engine/parse/pivot";
import { unpivotDataset } from "@/engine/parse/unpivot";
import { profileDataset } from "@/engine/profile/profile";
import { detectTallFormat } from "@/engine/profile/structure";
import type { DatasetProfile, TallFormatInfo } from "@/engine/profile/types";
import { generateSample, SAMPLES } from "@/engine/samples";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { cell, column, parse } from "./helpers/dataset";
import { expandFixture, parseCsv, type LayoutSpec } from "./helpers/layouts";

// The store talks to a Session on this thread instead of a Web Worker (hoisted above the imports).
vi.mock("@/lib/engine-client", async () => {
  const { Session: Engine } = await import("@/engine/session");
  let session = new Engine();
  const api = {
    ingest: async (file: File, opts: IngestOptions) => session.ingest(file, file.name, opts),
    pivotPlan: async () => session.pivotPlan(),
    pivot: async () => session.pivot(),
    configure: async (req: ContextRequest) => session.configure(req),
    begin: async () => {},
    computeDashboard: async () => ({ aborted: true, ms: 0, rows: 0 }),
    insights: async () => [],
  };
  return {
    engine: () => api,
    resetEngine: () => {
      session = new Engine();
    },
    Comlink: { proxy: <T>(f: T): T => f },
  };
});

// ---------------------------------------------------------------- fixtures

/** A CSV line; cells with a comma are quoted. */
const line = (cells: ReadonlyArray<string | number>) =>
  cells.map((c) => (typeof c === "string" && c.includes(",") ? `"${c}"` : String(c))).join(",");

const round2 = (x: number) => Math.round(x * 100) / 100;

const BANK: ReadonlyArray<readonly [string, number]> = [
  ["CASA Ratio %", 42],
  ["Advances (₹ Cr)", 512],
  ["Deposits (₹ Cr)", 1200],
  ["Gross NPA %", 2.5],
  ["New Accounts", 150],
  ["Cross-sell Ratio", 1.8],
];
const MONTHS = ["2024-04", "2024-05", "2024-06"];
const BRANCHES = ["Andheri", "Borivali", "Thane", "Pune Camp"];

/** A figure that differs for every month, branch and metric, so a value in the wrong cell is caught. */
const figure = (m: number, b: number, k: number) =>
  round2((BANK[k] as readonly [string, number])[1] * (1 + 0.01 * (m + 1) + 0.001 * (b + 1)));

/**
 * A bank's monthly branch scorecard: Month | Branch | Metric | Value | Target,
 * one row per metric for each month and branch. `skip` leaves out one row
 * (month, branch, metric); `extra` columns are added per row.
 */
function bankCsv(
  opts: {
    skip?: readonly [number, number, number];
    extra?: { headers: string[]; cells: (m: number, b: number, k: number) => Array<string | number> };
  } = {},
): string {
  const lines = [line(["Month", "Branch", "Metric", "Value", "Target", ...(opts.extra?.headers ?? [])])];
  MONTHS.forEach((month, m) =>
    BRANCHES.forEach((branch, b) =>
      BANK.forEach(([metric, base], k) => {
        const [sm, sb, sk] = opts.skip ?? [-1, -1, -1];
        if (m === sm && b === sb && k === sk) return;
        lines.push(
          line([
            month,
            branch,
            metric,
            figure(m, b, k),
            round2(base * 1.1),
            ...(opts.extra?.cells(m, b, k) ?? []),
          ]),
        );
      }),
    ),
  );
  return lines.join("\n");
}

async function profileOf(text: string, name = "t.csv"): Promise<{ ds: Dataset; profile: DatasetProfile }> {
  const { ds } = await parse(text, name);
  return { ds, profile: profileDataset(ds) };
}

/** Rows as CSV text. */
const csv = (rows: ReadonlyArray<ReadonlyArray<string | number>>) => rows.map(line).join("\n");

function numberCol(name: string, values: number[], extra: Partial<NumberColumn> = {}): NumberColumn {
  return {
    kind: "number",
    name,
    values: Float64Array.from(values),
    format: { integer: values.every(Number.isInteger), decimals: 2 },
    ...extra,
  };
}

function stringCol(name: string, values: Array<string | null>): StringColumn {
  const dict = [...new Set(values.filter((v): v is string => v !== null))];
  return {
    kind: "string",
    name,
    codes: Int32Array.from(values.map((v) => (v === null ? -1 : dict.indexOf(v)))),
    dict,
  };
}

function dataset(columns: Column[]): Dataset {
  const first = columns[0];
  const rowCount = !first ? 0 : first.kind === "string" ? first.codes.length : first.values.length;
  return {
    id: "t",
    name: "scorecard",
    rowCount,
    columns,
    source: { fileName: "scorecard.csv", kind: "csv", sizeBytes: 0, isDemo: false },
  };
}

/** Sum and count of the figures in some number columns: pivoting moves figures, it never adds or drops one. */
function totals(ds: Dataset, names: readonly string[]): { sum: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const name of names) {
    const c = column(ds, name);
    if (c.kind !== "number") throw new Error(`${name} is not a number column`);
    for (const v of c.values)
      if (v === v) {
        sum += v;
        count++;
      }
  }
  return { sum: round2(sum), count };
}

/** The pivoted row for one combination of id values. */
function rowWhere(ds: Dataset, match: Record<string, string | number>): number {
  for (let r = 0; r < ds.rowCount; r++)
    if (Object.entries(match).every(([name, v]) => cell(ds, name, r) === v)) return r;
  throw new Error(`No row ${JSON.stringify(match)}`);
}

// ---------------------------------------------------------------- detection

describe("detecting a tall scorecard", () => {
  it("reads a bank's branch scorecard: metric, value and id columns", async () => {
    const { profile } = await profileOf(bankCsv());
    expect(profile.tall).toMatchObject({
      metricColumn: "Metric",
      metrics: BANK.map(([m]) => m),
      valueColumns: ["Value", "Target"],
      idColumns: ["Month", "Branch"],
    });
    expect(profile.tall?.suggestion).toContain(
      '6 metrics ("CASA Ratio %", "Advances (₹ Cr)", "Deposits (₹ Cr)"…)',
    );
    expect(profile.tall?.suggestion).toContain("one row per Month and Branch");
  });

  it("reads a telecom circle scorecard, leaving out the unit each metric is in", async () => {
    const kpis: Array<[string, string, number]> = [
      ["ARPU", "₹", 182],
      ["MOU", "min", 820],
      ["Churn", "%", 2.1],
      ["Subscribers", "Mn", 31.5],
      ["Data usage per sub", "GB", 19.4],
    ];
    const rows: Array<Array<string | number>> = [["Month", "Circle", "KPI", "Unit", "Value"]];
    MONTHS.forEach((month, m) =>
      ["Mumbai", "Delhi", "Kolkata"].forEach((circle, c) =>
        kpis.forEach(([kpi, unit, v]) =>
          rows.push([month, circle, kpi, unit, round2(v * (1 + m / 50 + c / 90))]),
        ),
      ),
    );
    const { profile } = await profileOf(csv(rows));
    expect(profile.tall).toMatchObject({
      metricColumn: "KPI",
      metrics: kpis.map(([k]) => k),
      valueColumns: ["Value"],
      idColumns: ["Month", "Circle"],
    });
  });

  it("reads a hotel GM's flash report: one period, the actual first, then the year to date, then what it is measured against", async () => {
    const { profile } = await profileOf(
      csv([
        ["Property", "KPI", "Budget", "Actual", "LY", "YTD Actual", "YTD Budget", "YTD LY"],
        ["Grand Bengaluru", "Occupancy %", 80, 78.2, 74.1, 76.5, 79, 72.3],
        ["Grand Bengaluru", "ADR (₹)", 8800, 8450, 7900, 8320, 8700, 7850],
        ["Grand Bengaluru", "RevPAR (₹)", 7040, 6608, 5854, 6365, 6873, 5676],
        ["Grand Bengaluru", "Rooms Sold", 5600, 5420, 5130, 31200, 32400, 29800],
        ["Grand Bengaluru", "Room Revenue (₹ Lakh)", 493, 458, 405, 2596, 2819, 2339],
        ["Grand Bengaluru", "Covers", 19000, 18200, 17600, 104000, 110000, 99000],
      ]),
    );
    expect(profile.tall).toMatchObject({
      metricColumn: "KPI",
      valueColumns: ["Actual", "YTD Actual", "Budget", "LY", "YTD Budget", "YTD LY"],
      // The one hotel stays a column of the pivoted row.
      idColumns: ["Property"],
    });
    expect(profile.tall?.suggestion).not.toContain("one row per");
  });

  it("reads a hospital's quality indicators, with the rate as the main value before its parts", async () => {
    const indicators = [
      "Hand hygiene compliance rate",
      "Bed occupancy rate",
      "Average length of stay (days)",
      "Medication errors per 1000 patient days",
      "Surgical site infection rate",
    ];
    const rows: Array<Array<string | number>> = [
      ["Month", "Quality Indicator", "Numerator", "Denominator", "Rate", "Benchmark"],
    ];
    ["Apr-24", "May-24", "Jun-24", "Jul-24"].forEach((month, m) =>
      indicators.forEach((ind, i) =>
        rows.push([month, ind, 40 + m + i, 50 + i, round2((40 + m + i) / (50 + i)), 0.9]),
      ),
    );
    const { profile } = await profileOf(csv(rows));
    expect(profile.tall).toMatchObject({
      metricColumn: "Quality Indicator",
      metrics: indicators,
      valueColumns: ["Rate", "Numerator", "Denominator", "Benchmark"],
      idColumns: ["Month"],
    });
  });

  it("reads a monthly MIS of P&L lines under Particulars, with the actual before the variance and budget", async () => {
    const lines = ["Revenue", "COGS", "Gross Profit", "Gross Margin %", "Employee cost", "EBITDA", "PAT"];
    const rows: Array<Array<string | number>> = [["Particulars", "Month", "Actual", "Variance", "Budget"]];
    MONTHS.forEach((month, m) =>
      lines.forEach((l, i) => rows.push([l, month, 100 + m + i, -5 - i, 105 + m + 2 * i])),
    );
    const { profile } = await profileOf(csv(rows));
    expect(profile.tall).toMatchObject({
      metricColumn: "Particulars",
      metrics: lines,
      valueColumns: ["Actual", "Variance", "Budget"],
      idColumns: ["Month"],
    });
  });

  it("reads KPIs by their names alone when the heading doesn't say, if the rows form a grid", async () => {
    const kpis = [
      "Net sales (₹ Lakh)",
      "Footfall",
      "Conversion %",
      "Average bill value (₹)",
      "Units per bill",
    ];
    const rows: Array<Array<string | number>> = [["Month", "Store", "Description", "Value"]];
    MONTHS.forEach((month, m) =>
      ["Koramangala", "Indiranagar", "Whitefield"].forEach((store, s) =>
        kpis.forEach((k, i) => rows.push([month, store, k, 10 * (i + 1) + m + s])),
      ),
    );
    const { profile } = await profileOf(csv(rows));
    expect(profile.tall).toMatchObject({ metricColumn: "Description", idColumns: ["Month", "Store"] });
  });

  it("keeps a branch's region as an id, and leaves out a row number, a RAG status and a heading row with no figures", async () => {
    const lines = [line(["S.No", "Month", "Region", "Branch", "Metric", "Value", "Target", "RAG"])];
    let n = 1;
    MONTHS.forEach((month, m) =>
      BRANCHES.forEach((branch, b) => {
        // A section heading, as an MIS sheet has: a name with no figures.
        lines.push(line([n++, month, b < 2 ? "West" : "South", branch, "ASSET QUALITY", "", "", ""]));
        BANK.forEach(([metric, base], k) =>
          lines.push(
            line([
              n++,
              month,
              b < 2 ? "West" : "South",
              branch,
              metric,
              figure(m, b, k),
              round2(base * 1.1),
              ["Green", "Amber", "Red"][(m + b + k) % 3] as string,
            ]),
          ),
        );
      }),
    );
    const { profile } = await profileOf(lines.join("\n"));
    expect(profile.tall).toMatchObject({
      metricColumn: "Metric",
      metrics: BANK.map(([m]) => m),
      idColumns: ["Month", "Region", "Branch"],
    });
    expect(profile.tall?.suggestion).toContain("one row per Month and Branch");
  });

  it("reads a named scorecard whose quarterly metrics come less often than its monthly ones", async () => {
    const rows: Array<Array<string | number>> = [["Month", "KPI", "Actual", "Target"]];
    for (let m = 1; m <= 12; m++) {
      const month = `2024-${String(m).padStart(2, "0")}`;
      rows.push([month, "Revenue (₹ Cr)", 10 + m, 12]);
      rows.push([month, "Headcount", 400 + m, 420]);
      if (m % 3 === 0) {
        rows.push([month, "Customer NPS", 40 + m, 50]);
        rows.push([month, "Attrition %", 12 - m / 3, 10]);
      }
    }
    const { profile } = await profileOf(csv(rows));
    expect(profile.tall).toMatchObject({
      metricColumn: "KPI",
      metrics: ["Revenue (₹ Cr)", "Headcount", "Customer NPS", "Attrition %"],
      idColumns: ["Month"],
    });
  });

  it("still reads a scorecard whose rows were redrawn at random, so no column set tells them apart", async () => {
    // A layout grown the way the benchmark grows its samples: every column drawn on its own.
    const spec: LayoutSpec = {
      id: "scorecard-redrawn",
      headers: ["Month", "Branch", "Metric", "Value", "Target"],
      rows: [
        ["Apr-24", "Andheri", "CASA Ratio %", "42.5", "45"],
        ["Apr-24", "Andheri", "Advances (₹ Cr)", "512", "550"],
        ["Apr-24", "Andheri", "Gross NPA %", "2.4", "2"],
        ["May-24", "Thane", "Deposits (₹ Cr)", "1210", "1300"],
        ["May-24", "Thane", "New Accounts", "148", "160"],
        ["Jun-24", "Borivali", "Cross-sell Ratio", "1.8", "2"],
      ],
    };
    const ds = await parseCsv(expandFixture(spec, 240), spec.id);
    expect(profileDataset(ds).tall).toMatchObject({
      metricColumn: "Metric",
      valueColumns: ["Value", "Target"],
    });
  });

  it("reads a wide scorecard only once its months are unpivoted into rows", async () => {
    const { ds, profile } = await profileOf(
      csv([
        ["Metric", "Apr-24", "May-24", "Jun-24"],
        ["Revenue (₹ Cr)", 12.5, 13.1, 13.8],
        ["EBITDA Margin %", 18.2, 18.9, 19.4],
        ["Headcount", 412, 420, 431],
      ]),
    );
    expect(profile.wide).not.toBeNull();
    expect(profile.tall).toBeNull();
    const long = unpivotDataset(ds, profile.wide as NonNullable<DatasetProfile["wide"]>);
    expect(profileDataset(long).tall).toMatchObject({
      metricColumn: "Metric",
      valueColumns: ["Value"],
      idColumns: ["Period"],
    });
  });
});

describe("ordinary tables are not scorecards", () => {
  const notTall = async (text: string) => expect((await profileOf(text)).profile.tall).toBeNull();

  it("a transaction table with a category and an amount", async () => {
    const rows: Array<Array<string | number>> = [
      ["Date", "Order ID", "Category", "Product", "Quantity", "Amount"],
    ];
    const cats = ["Electronics", "Furniture", "Office Supplies"];
    for (let i = 0; i < 300; i++)
      rows.push([
        `2024-0${1 + (i % 9)}-1${i % 10}`,
        `ORD-${1000 + i}`,
        cats[i % 3] as string,
        `P${i % 17}`,
        1 + (i % 4),
        100 + i,
      ]);
    await notTall(csv(rows));
  });

  it("expense heads against budget: one unit, and their total means something", async () => {
    const heads = ["Salary", "Rent", "Travel", "Electricity", "Office Supplies", "Commission"];
    const rows: Array<Array<string | number>> = [["Month", "Expense Head", "Actual", "Budget"]];
    MONTHS.forEach((month, m) =>
      heads.forEach((h, i) => rows.push([month, h, 1000 * (i + 1) + m, 1100 * (i + 1)])),
    );
    await notTall(csv(rows));
  });

  it("each department's target against actual", async () => {
    const rows: Array<Array<string | number>> = [["Month", "Department", "Target", "Actual"]];
    MONTHS.forEach((month, m) =>
      ["Sales", "Accounts", "Customer Support", "Operations"].forEach((d, i) =>
        rows.push([month, d, 100 + i, 90 + m]),
      ),
    );
    await notTall(csv(rows));
  });

  it("sales by category and month", async () => {
    const rows: Array<Array<string | number>> = [["Month", "Category", "Net Sales", "Units"]];
    MONTHS.forEach((month, m) =>
      ["Apparel", "Footwear", "Accessories"].forEach((c, i) =>
        rows.push([month, c, 1000 + 10 * i + m, 10 + i]),
      ),
    );
    await notTall(csv(rows));
  });

  it("months melted into rows (pandas' variable and value)", async () => {
    const rows: Array<Array<string | number>> = [["Region", "variable", "value"]];
    ["North", "South"].forEach((r, i) =>
      ["Jan", "Feb", "Mar"].forEach((v, j) => rows.push([r, v, 5 + i + j])),
    );
    await notTall(csv(rows));
  });

  it("a trial balance under Particulars: its debits and credits add up", async () => {
    await notTall(
      csv([
        ["Particulars", "Debit", "Credit"],
        ["Cash", 100, 0],
        ["Sales", 0, 500],
        ["Purchases", 300, 0],
        ["Rent", 50, 0],
        ["Capital", 0, 250],
      ]),
    );
  });

  it("an order log whose offers carry a % or ₹: one order per row, not a grid of metrics", async () => {
    const offers = ["10% off", "Flat ₹100 off", "Free shipping"];
    const rows: Array<Array<string | number>> = [["Order Date", "Order ID", "Offer", "City", "Order Value"]];
    for (let i = 0; i < 240; i++)
      rows.push([
        `2024-0${1 + (i % 6)}-${10 + (i % 18)}`,
        `OD${5000 + i}`,
        offers[i % 3] as string,
        ["Pune", "Delhi", "Goa", "Agra"][i % 4] as string,
        400 + 7 * i,
      ]);
    await notTall(csv(rows));
  });

  it("a unit-of-measure column headed Measure", async () => {
    const rows: Array<Array<string | number>> = [
      ["Date", "Store", "Product", "Measure", "Qty", "Order Value"],
    ];
    for (let i = 0; i < 120; i++)
      rows.push([
        `2024-03-${10 + (i % 18)}`,
        ["S1", "S2"][i % 2] as string,
        `Item ${i % 9}`,
        ["kg", "pcs", "ltr"][i % 3] as string,
        1 + (i % 5),
        50 + i,
      ]);
    await notTall(csv(rows));
  });

  it("an ads export whose results are typed by an event code, beside many other measures", async () => {
    const rows: Array<Array<string | number>> = [
      [
        "Day",
        "Ad name",
        "Results",
        "Result indicator",
        "Reach",
        "Impressions",
        "Link clicks",
        "Amount spent (INR)",
      ],
    ];
    for (let i = 0; i < 60; i++)
      rows.push([
        `2024-09-${String(1 + (i % 28)).padStart(2, "0")}`,
        `Ad ${i % 7}`,
        10 + i,
        ["actions:lead", "actions:offsite_conversion.fb_pixel_purchase"][i % 2] as string,
        3000 + 11 * i,
        5000 + 13 * i,
        100 + i,
        900 + 3 * i,
      ]);
    await notTall(csv(rows));
  });

  it("no layout of the detection suite and no demo dataset", async () => {
    const file = JSON.parse(readFileSync(join(__dirname, "fixtures", "detection.json"), "utf8")) as {
      rowCount: number;
      fixtures: Array<LayoutSpec & { demo?: string }>;
    };
    const read: string[] = [];
    for (const f of file.fixtures) {
      const ds = f.demo ? generateSample(f.demo) : await parseCsv(expandFixture(f, file.rowCount), f.id);
      if (profileDataset(ds).tall) read.push(f.id);
    }
    for (const s of SAMPLES) if (profileDataset(generateSample(s.id)).tall) read.push(s.id);
    expect(read).toEqual([]);
  });
});

// ---------------------------------------------------------------- pivot

describe("pivotDataset", () => {
  it("makes one row per month and branch and one column per metric, every figure in its own cell", async () => {
    // Pune Camp has no "New Accounts" row in June: that cell stays blank.
    const { ds, profile } = await profileOf(bankCsv({ skip: [2, 3, 4] }));
    const tall = profile.tall as TallFormatInfo;
    const out = pivotDataset(ds, tall);
    const metricNames = BANK.map(([m]) => m);
    expect(out.rowCount).toBe(MONTHS.length * BRANCHES.length);
    expect(out.columns.map((c) => c.name)).toEqual([
      "Month",
      "Branch",
      ...metricNames,
      ...metricNames.map((m) => `${m} (Target)`),
    ]);
    expect(out.source.kind).toBe("derived");
    expect(out.name).toBe(`${ds.name} (pivoted)`);
    // A value lands in the right cell: Thane's advances in May.
    const thaneMay = rowWhere(out, { Month: utc(2024, 5, 1), Branch: "Thane" });
    expect(cell(out, "Advances (₹ Cr)", thaneMay)).toBe(figure(1, 2, 1));
    expect(cell(out, "Gross NPA % (Target)", thaneMay)).toBe(round2(2.5 * 1.1));
    const puneJune = rowWhere(out, { Month: utc(2024, 6, 1), Branch: "Pune Camp" });
    expect(cell(out, "New Accounts", puneJune)).toBeNull();
    expect(cell(out, "Gross NPA %", puneJune)).toBe(figure(2, 3, 3));
    // Nothing added, dropped or made up.
    expect(totals(out, metricNames)).toEqual(totals(ds, ["Value"]));
    expect(
      totals(
        out,
        metricNames.map((m) => `${m} (Target)`),
      ),
    ).toEqual(totals(ds, ["Target"]));
    // The plan the user agrees to names exactly the columns that come.
    const plan = pivotPlan(ds, tall);
    expect(plan.columns.map((c) => c.name)).toEqual(out.columns.slice(2).map((c) => c.name));
    expect(plan).toMatchObject({
      rows: 12,
      kept: ["Month", "Branch"],
      removed: ["Metric", "Value", "Target"],
    });
    expect(plan).toMatchObject({ repeats: 0, skipped: 0, lostFigures: 0, unitColumn: null });
  });

  it("profiles each new column from its own name and values", async () => {
    const { ds, profile } = await profileOf(bankCsv());
    const out = profileDataset(pivotDataset(ds, profile.tall as TallFormatInfo));
    const role = (name: string) => out.columns.find((c) => c.name === name)?.role;
    expect(role("Gross NPA %")).toBe("percentage");
    expect(role("Advances (₹ Cr)")).toBe("currency");
    expect(role("New Accounts")).toBe("measure");
    // The pivoted table is a plain table now.
    expect(out.tall).toBeNull();
  });

  it("writes each metric's unit from a Unit column into its column's name", async () => {
    const kpis: Array<[string, string, number]> = [
      ["ARPU", "₹", 182],
      ["Churn", "%", 2.1],
      ["Subscribers", "Mn", 31.5],
      ["Churn rate %", "%", 2.4],
      ["Members", "M", 4.2],
    ];
    const rows: Array<Array<string | number>> = [["Month", "Circle", "KPI", "Unit", "Value"]];
    MONTHS.forEach((month, m) =>
      ["Mumbai", "Delhi"].forEach((circle, c) =>
        kpis.forEach(([kpi, unit, v]) =>
          rows.push([month, circle, kpi, unit, round2(v * (1 + m / 50 + c / 90))]),
        ),
      ),
    );
    const { ds, profile } = await profileOf(csv(rows));
    const tall = profile.tall as TallFormatInfo;
    const plan = pivotPlan(ds, tall);
    expect(plan.unitColumn).toBe("Unit");
    // "Churn rate %" already says its unit; "Members" doesn't, though it holds the letter "m".
    expect(plan.columns.map((c) => c.name)).toEqual([
      "ARPU (₹)",
      "Churn (%)",
      "Subscribers (Mn)",
      "Churn rate %",
      "Members (M)",
    ]);
    expect(plan.removed).toEqual(["KPI", "Unit", "Value"]);
    const out = profileDataset(pivotDataset(ds, tall));
    expect(out.columns.find((c) => c.name === "Churn (%)")?.role).toBe("percentage");
    expect(out.columns.find((c) => c.name === "ARPU (₹)")?.role).toBe("currency");
  });

  it("gives a metric repeated for the same month and branch a row of its own, never adding the two", () => {
    const ds = dataset([
      stringCol("Branch", ["Andheri", "Andheri", "Andheri", "Thane", "Andheri"]),
      stringCol("Metric", [
        "Deposits (₹ Cr)",
        "CASA Ratio %",
        "Deposits (₹ Cr)",
        "Deposits (₹ Cr)",
        "CASA Ratio %",
      ]),
      numberCol("Value", [100, 0.4, 120, 90, 0.45]),
    ]);
    const tall: TallFormatInfo = {
      metricColumn: "Metric",
      metrics: ["Deposits (₹ Cr)", "CASA Ratio %"],
      valueColumns: ["Value"],
      idColumns: ["Branch"],
      suggestion: "",
    };
    const plan = pivotPlan(ds, tall);
    expect(plan).toMatchObject({ rows: 3, repeats: 2 });
    const out = pivotDataset(ds, tall);
    // Andheri's second Deposits and second CASA ratio share the second Andheri row; rows keep the order
    // the file first needs them in.
    expect([0, 1, 2].map((r) => cell(out, "Branch", r))).toEqual(["Andheri", "Andheri", "Thane"]);
    expect([0, 1, 2].map((r) => cell(out, "Deposits (₹ Cr)", r))).toEqual([100, 120, 90]);
    expect([0, 1, 2].map((r) => cell(out, "CASA Ratio %", r))).toEqual([0.4, 0.45, null]);
  });

  it("leaves out rows without a metric name and counts the figures on them", () => {
    const ds = dataset([
      stringCol("Month", ["Apr", "Apr", "Apr", "May", "May", "May"]),
      stringCol("Metric", ["Footfall", "Conversion %", null, "Footfall", "Conversion %", "Total"]),
      numberCol("Value", [1200, 0.12, 55, 1300, 0.14, NaN]),
    ]);
    const tall: TallFormatInfo = {
      metricColumn: "Metric",
      metrics: ["Footfall", "Conversion %"],
      valueColumns: ["Value"],
      idColumns: ["Month"],
      suggestion: "",
    };
    expect(pivotPlan(ds, tall)).toMatchObject({ rows: 2, skipped: 2, lostFigures: 1 });
    const out = pivotDataset(ds, tall);
    expect(out.columns.map((c) => c.name)).toEqual(["Month", "Footfall", "Conversion %"]);
    expect(cell(out, "Footfall", 1)).toBe(1300);
  });

  it("adds no column for a metric with no figure in a value column", () => {
    const ds = dataset([
      stringCol("Month", ["Apr", "Apr", "May", "May"]),
      stringCol("KPI", ["Revenue", "NPS", "Revenue", "NPS"]),
      numberCol("Actual", [10, 41, 12, 44]),
      numberCol("Target", [11, NaN, 11, NaN]),
    ]);
    const tall: TallFormatInfo = {
      metricColumn: "KPI",
      metrics: ["Revenue", "NPS"],
      valueColumns: ["Actual", "Target"],
      idColumns: ["Month"],
      suggestion: "",
    };
    expect(pivotPlan(ds, tall).columns.map((c) => c.name)).toEqual(["Revenue", "NPS", "Revenue (Target)"]);
  });

  it("keeps unreadable cells on the cell their figure would have filled", () => {
    const ds = dataset([
      stringCol("Month", ["Apr", "Apr", "May", "May"]),
      stringCol("KPI", ["Revenue", "NPS", "Revenue", "NPS"]),
      numberCol("Actual", [10, 41, NaN, 44], {
        unreadable: { rows: Int32Array.from([2]), codes: Int32Array.from([0]), texts: ["12,5x"] },
      }),
    ]);
    const tall: TallFormatInfo = {
      metricColumn: "KPI",
      metrics: ["Revenue", "NPS"],
      valueColumns: ["Actual"],
      idColumns: ["Month"],
      suggestion: "",
    };
    const revenue = column(pivotDataset(ds, tall), "Revenue");
    expect(revenue.unreadable && [...revenue.unreadable.rows]).toEqual([1]);
    expect(revenue.unreadable?.texts).toEqual(["12,5x"]);
  });

  it("marks a metric as a percentage when its cells were written with a % sign", async () => {
    const rows: Array<Array<string | number>> = [["Month", "Metric", "Value"]];
    MONTHS.forEach((month, m) => {
      rows.push([month, "Conversion", `${12 + m}.5%`]);
      rows.push([month, "Bounce", `${40 + m}.1%`]);
      rows.push([month, "Exit share", `${20 + m}.4%`]);
      rows.push([month, "Footfall", 1200 + m]);
    });
    const { ds, profile } = await profileOf(csv(rows));
    const out = pivotDataset(ds, profile.tall as TallFormatInfo);
    const format = (name: string) => (column(out, name) as NumberColumn).format;
    expect(format("Conversion")).toEqual({ integer: false, decimals: 1, percent: true });
    expect(format("Footfall")).toEqual({ integer: true, decimals: 0 });
    expect(cell(out, "Conversion", 1)).toBeCloseTo(0.135, 10);
  });

  it("never reuses an id column's name", () => {
    const ds = dataset([
      stringCol("Month", ["Apr", "Apr", "May", "May"]),
      stringCol("Metric", ["Month", "Revenue (₹ Cr)", "Month", "Revenue (₹ Cr)"]),
      numberCol("Value", [4, 10, 5, 12]),
    ]);
    const tall: TallFormatInfo = {
      metricColumn: "Metric",
      metrics: ["Month", "Revenue (₹ Cr)"],
      valueColumns: ["Value"],
      idColumns: ["Month"],
      suggestion: "",
    };
    expect(pivotDataset(ds, tall).columns.map((c) => c.name)).toEqual([
      "Month",
      "Month (2)",
      "Revenue (₹ Cr)",
    ]);
  });
});

// ---------------------------------------------------------------- session and store

describe("Session.pivot", () => {
  it("adopts the pivoted table as a new dataset, with a report of what was done", async () => {
    const s = new Session();
    const load = await s.ingest(new Blob([bankCsv()]), "branch-mis.csv", {});
    if (load.status !== "ok") throw new Error(load.status);
    expect(load.profile.tall?.metricColumn).toBe("Metric");
    const plan = s.pivotPlan();
    const res = s.pivot();
    if (res.status !== "ok") throw new Error(res.status);
    expect(res.summary).toMatchObject({ kind: "derived", rowCount: 12, columnCount: 14 });
    expect(res.profile.columns.map((c) => c.name)).toEqual([
      "Month",
      "Branch",
      ...plan.columns.map((c) => c.name),
    ]);
    expect(res.profile.tall).toBeNull();
    expect(res.report.warnings.at(-1)).toBe('Turned the 6 metrics in "Metric" into 12 columns, on 12 rows.');
    // Figures are where the file had them.
    const thaneMay = s.rows(0, 12).find((r) => r[0] === "2024-05-01" && r[1] === "Thane") as Array<
      string | null
    >;
    const advances = res.profile.columns.findIndex((c) => c.name === "Advances (₹ Cr)");
    expect(Number((thaneMay[advances] as string).replace(/,/g, ""))).toBe(figure(1, 2, 1));
    // The analysis builds on the new columns.
    const ctx = s.configure({ domainId: "generic", numberLocale: "INTL", currency: null });
    expect(ctx.profile.columns.some((c) => c.name === "Gross NPA %")).toBe(true);
    // Once pivoted there is no scorecard left to pivot.
    expect(() => s.pivot()).toThrow("No scorecard layout detected.");
  });

  it("notes the cells the new columns couldn't read, and drops notes about columns that are gone", async () => {
    // Eight months of three metrics: one unreadable cell in 24 keeps Value a number column.
    const rows: Array<Array<string | number>> = [["Month", "Metric", "Value"]];
    for (let m = 0; m < 8; m++) {
      const month = `2024-0${m + 1}`;
      rows.push([month, "Revenue (₹ Cr)", m === 1 ? "abc" : 12 + m]);
      rows.push([month, "EBITDA Margin %", 18 + m]);
      rows.push([month, "Headcount", 410 + m]);
    }
    const s = new Session();
    const load = await s.ingest(new Blob([csv(rows)]), "mis.csv", {});
    if (load.status !== "ok") throw new Error(load.status);
    expect(load.report.columnNotes.map((n) => n.column)).toEqual(["Value"]);
    const res = s.pivot();
    if (res.status !== "ok") throw new Error(res.status);
    expect(res.report.columnNotes).toEqual([
      {
        column: "Revenue (₹ Cr)",
        invalidCount: 1,
        examples: ["abc"],
        note: "1 value couldn't be read and was treated as blank.",
      },
    ]);
    // The data check points at the cell: February's revenue, on the second row.
    const view = s.checkViews().find((v) => v.label === 'Couldn\'t be read in "Revenue (₹ Cr)"');
    expect(view?.rows).toBe(1);
    const marked = s.checkRows(view?.id ?? "", 0, 5).rows[0];
    expect(marked?.index).toBe(1);
    expect(marked?.problems.map((p) => p.kind)).toEqual(["unreadable"]);
  });

  it("refuses a table that is no scorecard", async () => {
    const s = new Session();
    await s.ingest(new Blob(["Date,Amount\n2024-01-01,5\n2024-01-02,7\n"]), "t.csv", {});
    expect(() => s.pivotPlan()).toThrow("No scorecard layout detected.");
    expect(() => s.pivot()).toThrow("No scorecard layout detected.");
  });
});

describe("the store's pivot", () => {
  it("replaces the scorecard with its pivoted form and keeps the currency chosen for the file", async () => {
    await useWorkspace.getState().loadFile(new File([bankCsv()], "branch-mis.csv"));
    expect(useWorkspace.getState().profile?.tall?.metricColumn).toBe("Metric");
    useSettings.getState().setCurrencyOverride("INR");
    await useWorkspace.getState().pivot();
    const s = useWorkspace.getState();
    expect(s.error).toBeNull();
    expect(s.summary).toMatchObject({ kind: "derived", rowCount: 12 });
    expect(s.profile?.tall).toBeNull();
    expect(s.step).toBe("detect");
    expect(useSettings.getState().currencyOverride).toBe("INR");
  });
});

it("finds nothing in a table with fewer than two rows", () => {
  const ds = dataset([stringCol("Metric", ["Revenue"]), numberCol("Value", [10])]);
  expect(detectTallFormat(ds, profileDataset(ds).columns)).toBeNull();
});
