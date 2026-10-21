/**
 * Workbooks laid out as a small data model (parse/relate.ts): keys found
 * across name variants ("Customer ID" = "CustomerID", "prod_id", a bare "ID"
 * on a Stores sheet), the 90% rule, refusal of repeated and blank keys, a
 * snowflake (Products → Categories), the row count and the main sheet's
 * columns unchanged, "Customers · Region" on a name clash, unrelated sheets
 * going to the picker as before, the session round trip and the exports of
 * the joined table. Every workbook is built in memory with SheetJS.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { strFromU8, unzipSync } from "fflate";
import { describeModel } from "@/engine/core/model";
import type { Dataset } from "@/engine/core/types";
import { ingestWorkbookModel, workbookSheets } from "@/engine/parse";
import { ingestWorkbook } from "@/engine/parse/excel";
import { joinSheets, relateSheets, type SheetTable } from "@/engine/parse/relate";
import { Session } from "@/engine/session";
import { cell, column } from "./helpers/dataset";

type Rows = Array<Array<string | number | null>>;

/** An .xlsx file with one sheet per entry, in order. */
function book(sheets: Record<string, Rows>): Blob {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer]);
}

/** Each sheet read on its own, as the workbook parser reads it. */
async function tablesOf(sheets: Record<string, Rows>): Promise<SheetTable[]> {
  const buf = await book(sheets).arrayBuffer();
  const out: SheetTable[] = [];
  for (const sheet of Object.keys(sheets))
    out.push({ sheet, ds: (await ingestWorkbook(buf, "shop.xlsx", { sheet })).dataset });
  return out;
}

const N = 120;
const pad = (n: number, w = 3) => String(n).padStart(w, "0");

/** Orders: 120 rows, 20 customers, 10 products, 5 stores (numbered), a Region of their own. */
function orders(customer = (i: number) => `C${pad((i % 20) + 1)}`): Rows {
  return [
    ["Order ID", "Order Date", "Customer ID", "Product ID", "Store ID", "Region", "Quantity", "Revenue"],
    ...Array.from({ length: N }, (_, i) => [
      `O-${pad(i + 1, 4)}`,
      `2025-${pad((i % 12) + 1, 2)}-${pad((i % 27) + 1, 2)}`,
      customer(i),
      `P${pad((i % 10) + 1, 2)}`,
      (i % 5) + 1,
      i % 2 ? "North" : "South",
      (i % 4) + 1,
      100 + i * 3.5,
    ]),
  ];
}

/** Customers keyed "CustomerID" (one word), with a Region that clashes with the orders' own. */
function customers(count = 20): Rows {
  return [
    ["CustomerID", "Customer Name", "Segment", "Region"],
    ...Array.from({ length: count }, (_, i) => [
      `C${pad(i + 1)}`,
      `Customer ${i + 1}`,
      i % 3 ? "Retail" : "Corporate",
      i % 2 ? "East" : "West",
    ]),
  ];
}

/** Products keyed "prod_id", each in one of three categories. */
const products: Rows = [
  ["prod_id", "Product Name", "Category ID", "Unit Cost"],
  ...Array.from({ length: 10 }, (_, i) => [
    `P${pad(i + 1, 2)}`,
    `Product ${i + 1}`,
    `K${(i % 3) + 1}`,
    10 + i,
  ]),
];

const categories: Rows = [
  ["Category ID", "Category"],
  ["K1", "Furniture"],
  ["K2", "Technology"],
  ["K3", "Office Supplies"],
];

/** Stores keyed by a bare "ID" that the sheet's name explains. */
const stores: Rows = [
  ["ID", "Store Name", "City"],
  ...Array.from({ length: 5 }, (_, i) => [
    i + 1,
    `Store ${i + 1}`,
    ["Pune", "Delhi", "Mumbai", "Chennai", "Kolkata"][i] ?? "",
  ]),
];

const SHOP = {
  Orders: orders(),
  Customers: customers(),
  Products: products,
  Categories: categories,
  Stores: stores,
};

describe("finding the relationships", () => {
  it("finds keys across name variants and picks the orders as the main sheet", async () => {
    const plan = relateSheets(await tablesOf(SHOP));
    expect(plan?.fact).toBe("Orders");
    const keys = Object.fromEntries(
      (plan?.joins ?? []).map((j) => [j.sheet, `${j.onto}.${j.key} = ${j.lookupKey}`]),
    );
    expect(keys).toEqual({
      Customers: "Orders.Customer ID = CustomerID",
      Products: "Orders.Product ID = prod_id",
      Stores: "Orders.Store ID = ID",
      Categories: "Products.Category ID = Category ID",
    });
    expect(plan?.left).toEqual([]);
  });

  it("joins a lookup holding at least 90% of the keys, and counts the rest", async () => {
    // 19 of 20 customers: the 6 orders of C020 (5% of them) have no customer row.
    const plan = relateSheets(await tablesOf({ Orders: orders(), Customers: customers(19) }));
    const join = plan?.joins.find((j) => j.sheet === "Customers");
    expect(join?.keyed).toBe(N);
    expect(join?.unmatched).toBe(N / 20);
    const tables = await tablesOf({ Orders: orders(), Customers: customers(19) });
    const { dataset, model } = joinSheets(tables, plan as NonNullable<typeof plan>);
    const missing = Array.from({ length: N }, (_, i) => i).filter(
      (i) => cell(dataset, "Customer ID", i) === "C020",
    );
    expect(missing).toHaveLength(N / 20);
    for (const i of missing) expect(cell(dataset, "Segment", i)).toBeNull();
    expect(model.joins[0]?.unmatched).toBe(N / 20);
  });

  it("refuses a lookup holding under 90% of the keys, and says why", async () => {
    // 17 of 20 customers: 15% of the orders would find nothing.
    const tables = await tablesOf({ Orders: orders(), Customers: customers(17), Products: products });
    const plan = relateSheets(tables);
    expect(plan?.joins.map((j) => j.sheet)).toEqual(["Products"]);
    expect(plan?.left).toEqual([
      {
        sheet: "Customers",
        reason: expect.stringMatching(/only 85% of the Customer ID values in Orders .*90% needed/),
      },
    ]);
  });

  it("never joins on a key that repeats or is blank", async () => {
    const repeated = customers();
    repeated.push(["C001", "Customer 1 again", "Retail", "East"]);
    const blank = customers();
    blank.push([null, "Nobody", "Retail", "East"]);
    for (const lookup of [repeated, blank]) {
      const plan = relateSheets(await tablesOf({ Orders: orders(), Customers: lookup, Products: products }));
      expect(plan?.joins.map((j) => j.sheet)).toEqual(["Products"]);
      expect(plan?.left[0]?.sheet).toBe("Customers");
    }
    const r1 = relateSheets(await tablesOf({ Orders: orders(), Customers: repeated, Products: products }));
    expect(r1?.left[0]?.reason).toMatch(/CustomerID isn't unique in Customers \("C001" is on 2 rows\)/);
    const r2 = relateSheets(await tablesOf({ Orders: orders(), Customers: blank, Products: products }));
    expect(r2?.left[0]?.reason).toMatch(/CustomerID is blank on 1 row of Customers/);
    // With nothing else to join, the workbook is not a model at all.
    expect(relateSheets(await tablesOf({ Orders: orders(), Customers: repeated }))).toBeNull();
  });

  it("joins a lookup of a lookup (a snowflake)", async () => {
    const tables = await tablesOf({ Orders: orders(), Products: products, Categories: categories });
    const plan = relateSheets(tables);
    const cat = plan?.joins.find((j) => j.sheet === "Categories");
    expect(cat).toMatchObject({ onto: "Products", key: "Category ID", depth: 2, unmatched: 0 });
    const { dataset } = joinSheets(tables, plan as NonNullable<typeof plan>);
    // P01 is in K1 (Furniture), P02 in K2, P03 in K3.
    for (let i = 0; i < N; i++) {
      const product = Number(String(cell(dataset, "Product ID", i)).slice(1));
      expect(cell(dataset, "Category", i)).toBe(
        ["Furniture", "Technology", "Office Supplies"][(product - 1) % 3],
      );
    }
  });

  it("doesn't take sheets of the same layout, or bare row numbers, for lookups", async () => {
    const jan = orders();
    const feb = orders().slice(0, 100);
    expect(relateSheets(await tablesOf({ Jan: jan, Feb: feb }))).toBeNull();
    const numbered: Rows = [
      ["ID", "Amount", "Date"],
      ...Array.from({ length: 50 }, (_, i) => [i + 1, i * 2, "2025-01-01"]),
    ];
    const more: Rows = [["ID", "Note"], ...Array.from({ length: 80 }, (_, i) => [i + 1, `n${i}`])];
    expect(relateSheets(await tablesOf({ Sales: numbered, Notes: more }))).toBeNull();
  });
});

describe("joining", () => {
  let joined: { dataset: Dataset; tables: SheetTable[] } | null = null;
  const get = async () => {
    if (!joined) {
      const tables = await tablesOf(SHOP);
      joined = {
        dataset: joinSheets(tables, relateSheets(tables) as NonNullable<ReturnType<typeof relateSheets>>)
          .dataset,
        tables,
      };
    }
    return joined;
  };

  it("keeps every main-sheet row exactly once and its columns untouched", async () => {
    const { dataset, tables } = await get();
    const fact = tables.find((t) => t.sheet === "Orders")?.ds as Dataset;
    expect(dataset.rowCount).toBe(N);
    expect(dataset.rowCount).toBe(fact.rowCount);
    // The main sheet's columns come first, as the same objects, so their values can't have changed.
    fact.columns.forEach((c, i) => expect(dataset.columns[i]).toBe(c));
    for (const c of dataset.columns) {
      const len = c.kind === "string" ? c.codes.length : c.values.length;
      expect(len).toBe(N);
    }
    expect(dataset.source.model?.fact).toBe("Orders");
  });

  it("names added columns plainly, prefixing the sheet on a clash, and drops the lookup keys", async () => {
    const { dataset } = await get();
    const names = dataset.columns.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Customer Name",
        "Segment",
        "Customers · Region",
        "Product Name",
        "Category ID",
        "Unit Cost",
        "Category",
        "Store Name",
        "City",
      ]),
    );
    expect(names.filter((n) => n === "Region")).toHaveLength(1);
    expect(names).not.toContain("CustomerID");
    expect(names).not.toContain("prod_id");
    expect(names).not.toContain("ID");
    // Values land on the right rows: order i belongs to customer (i % 20) + 1, store (i % 5) + 1.
    for (let i = 0; i < N; i++) {
      const c = (i % 20) + 1;
      expect(cell(dataset, "Customer Name", i)).toBe(`Customer ${c}`);
      expect(cell(dataset, "Customers · Region", i)).toBe((c - 1) % 2 ? "East" : "West");
      expect(cell(dataset, "Region", i)).toBe(i % 2 ? "North" : "South");
      expect(cell(dataset, "Store Name", i)).toBe(`Store ${(i % 5) + 1}`);
    }
    // A text column's dictionary holds only values that appear.
    const segment = column(dataset, "Segment");
    if (segment.kind !== "string") throw new Error("Segment should be text");
    expect([...segment.dict].sort()).toEqual(["Corporate", "Retail"]);
  });

  it("describes the join in words", async () => {
    const { dataset } = await get();
    expect(describeModel(dataset.source.model as NonNullable<Dataset["source"]["model"]>)).toBe(
      "Orders joined with Customers (on Customer ID = CustomerID), Products (on Product ID = prod_id) and Stores (on Store ID = ID); Products with Categories (on Category ID)",
    );
  });
});

describe("reading a workbook", () => {
  it("leaves unrelated sheets to the picker, as before", async () => {
    const file = book({
      Orders: orders(),
      Budget: [
        ["Month", "Budget"],
        ["Jan", 100],
        ["Feb", 120],
      ],
    });
    expect(await ingestWorkbookModel(file, "plain.xlsx", await workbookSheets(file), {})).toBeNull();
    const res = await new Session().ingest(file, "plain.xlsx", {});
    expect(res).toEqual({ status: "needs-sheet", sheets: ["Orders", "Budget"] });
  });

  it("round-trips through the session: joined by default, one sheet on request", async () => {
    const file = book({ ...SHOP, Notes: [["Note"], ["Prices exclude tax"]] });
    const s = new Session();
    const res = await s.ingest(file, "shop.xlsx", {});
    if (res.status !== "ok") throw new Error(`expected a dataset, got ${res.status}`);
    expect(res.summary.rowCount).toBe(N);
    expect(res.summary.sheet).toBe("Orders");
    expect(res.summary.model?.joins.map((j) => j.sheet)).toEqual([
      "Customers",
      "Products",
      "Stores",
      "Categories",
    ]);
    expect(res.summary.model?.left).toEqual([
      { sheet: "Notes", reason: expect.stringContaining("no column matches") },
    ]);
    expect(res.report.rowCount).toBe(N);
    expect(res.report.warnings[0]).toBe(
      "Joined Orders joined with Customers (on Customer ID = CustomerID), Products (on Product ID = prod_id) and Stores (on Store ID = ID); Products with Categories (on Category ID): 5 sheets, 120 rows. Every Orders row is kept once.",
    );
    expect(res.report.warnings).toContain(
      "Not joined: Notes, because no column matches one in Orders or its lookups, by name and values.",
    );
    expect(res.profile.columns.map((c) => c.name)).toContain("Customers · Region");
    const top = res.detection.candidates[0];
    const ctx = s.configure({ domainId: top?.domainId ?? "generic", numberLocale: "INTL", currency: null });
    expect(ctx.domain.id).toBeTruthy();

    // "Use one sheet instead": the same file with a sheet chosen reads that sheet alone.
    const one = await s.ingest(file, "shop.xlsx", { sheet: "Orders" });
    if (one.status !== "ok") throw new Error("expected a dataset");
    expect(one.summary.model).toBeUndefined();
    expect(one.summary.columnCount).toBe(8);
    expect(one.summary.rowCount).toBe(N);
  });

  it("exports the joined table: CSV, SQL and a Power BI package that says it was joined", async () => {
    const file = book(SHOP);
    const s = new Session();
    const res = await s.ingest(file, "shop.xlsx", {});
    if (res.status !== "ok") throw new Error("expected a dataset");
    const top = res.detection.candidates[0];
    const ctx = s.configure({ domainId: top?.domainId ?? "generic", numberLocale: "INTL", currency: null });

    const csv = new TextDecoder().decode(s.exportCsv(true, true)).trim().split(/\r?\n/);
    expect(csv).toHaveLength(N + 1);
    expect(csv[0]).toContain("Customers · Region");
    expect(csv[0]).toContain("Category");

    const sql = s.exportSql();
    expect(sql).toContain("One table joined in Loupe from 5 sheets: Orders joined with Customers");
    for (const name of ["customers_region", "segment", "category", "store_name"])
      expect(sql).toContain(`"${name}"`);

    const files = unzipSync(
      s.exportPowerBi(
        JSON.stringify({ app: "loupe" }),
        ctx.charts.map((c) => c.id),
      ).zip,
    );
    const paths = Object.keys(files);
    const readme = strFromU8(files[paths.find((p) => p.endsWith("README.md")) as string] as Uint8Array);
    expect(readme).toContain("## Joined from 5 sheets");
    expect(readme).toContain("The package holds this joined table only, not the separate sheets");
    // One data table: no per-sheet tables and no relationships between sheets are claimed.
    const tables = paths.filter((p) => /\/tables\/[^/]+\.tmdl$/.test(p) && !p.endsWith("/Date.tmdl"));
    expect(tables).toHaveLength(1);
    const table = strFromU8(files[tables[0] as string] as Uint8Array);
    expect(table).toMatch(/^\/\/\/ Joined in Loupe from 5 sheets of shop\.xlsx/);
    const data = strFromU8(files[paths.find((p) => p.endsWith("/data.csv")) as string] as Uint8Array);
    expect(data.trim().split(/\r?\n/)).toHaveLength(N + 1);
  });
});

describe("a lookup sheet's figures", () => {
  it("are averaged, never summed, over the joined rows", async () => {
    const s = new Session();
    const res = await s.ingest(book(SHOP), "shop.xlsx", {});
    if (res.status !== "ok") throw new Error(`expected a dataset, got ${res.status}`);
    const cost = res.profile.columns.find((c) => c.name === "Unit Cost");
    expect(cost?.additivity).toBe("non-additive");
    expect(cost?.defaultAgg).toBe("avg");
    expect(cost?.roleReason).toContain("Products sheet");
  });
});
