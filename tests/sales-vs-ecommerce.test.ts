/**
 * Shop and B2B sales versus online shopping (version 42.0). A table of orders,
 * products, customers and amounts is what both industries have in common, so
 * it must not be claimed by e-commerce on its own. Each industry is told apart
 * by the columns only it has:
 * - Sales & Retail: a store, branch or outlet, a till or POS terminal, a
 *   cashier, the payment mode at the counter, a bill or invoice number, GST
 *   and HSN on a B2B invoice, a distributor's beat and salesman, and the
 *   summaries analysts build (store league tables, target vs achievement);
 * - E-commerce: delivery to the buyer (PIN code, shipping fee, courier, AWB,
 *   ship date, shipping method), cash on delivery, marketplaces and online
 *   channels, fulfilment by the marketplace.
 *
 * Covers whole layouts through the real pipeline (expandFixture → parse →
 * profile → detect, as tests/detect.test.ts does), the field rules behind
 * them, the Store & POS shape and its KPIs on a file small enough to work out
 * by hand, and the KPI aliases detection reads in summaries and scorecards.
 */
import { describe, expect, it } from "vitest";
import type { DetectionResult } from "@/engine/detect/detect";
import { MATCH_THRESHOLD, matchKpiNames, namesToRead, scoreField } from "@/engine/detect/match";
import { profileDataset } from "@/engine/profile/profile";
import type { ColumnProfile, DatasetProfile } from "@/engine/profile/types";
import { Session } from "@/engine/session";
import { getDomain } from "@/registry";
import type { DomainDef, FieldDef } from "@/registry/schema";
import { csvCell, detect, expandFixture, parseCsv, type LayoutSpec } from "./helpers/layouts";

const ROWS = 240;

async function detectLayout(spec: LayoutSpec): Promise<DetectionResult> {
  return detect(await parseCsv(expandFixture(spec, ROWS), spec.id)).detection;
}

const top = (d: DetectionResult) => d.candidates[0]?.domainId;
/** E-commerce is presented as the answer without asking: the failure this file guards against. */
const confidentlyEcommerce = (d: DetectionResult) => top(d) === "ecommerce" && !d.needsConfirmation;

const domain = (id: string): DomainDef => {
  const d = getDomain(id);
  if (!d) throw new Error(`no domain ${id}`);
  return d;
};
const field = (domainId: string, fieldId: string): FieldDef => {
  const f = domain(domainId).fields.find((x) => x.id === fieldId);
  if (!f) throw new Error(`no field ${domainId}.${fieldId}`);
  return f;
};

/** Parses a small CSV built from columns of values and profiles it. */
async function profileOf(cols: Record<string, readonly (string | number)[]>): Promise<DatasetProfile> {
  const names = Object.keys(cols);
  const n = Math.max(...names.map((k) => (cols[k] as readonly unknown[]).length));
  const lines = [names.map(csvCell).join(",")];
  for (let i = 0; i < n; i++)
    lines.push(
      names.map((k) => csvCell(String((cols[k] as readonly (string | number)[])[i] ?? ""))).join(","),
    );
  return profileDataset(await parseCsv(`${lines.join("\n")}\n`, "columns"));
}

const seq = (n: number, f: (i: number) => string | number) => Array.from({ length: n }, (_, i) => f(i));
const col = (p: DatasetProfile, name: string): ColumnProfile => {
  const c = p.columns.find((x) => x.name === name);
  if (!c) throw new Error(`no column ${name}`);
  return c;
};
const score = (p: DatasetProfile, domainId: string, fieldId: string, column: string) =>
  scoreField(field(domainId, fieldId), col(p, column)).score;

// ---------------------------------------------------------------- layouts

/** A grocery store's till export: one row per bill line, with store, counter, cashier and payment mode. */
const KIRANA_TILL: LayoutSpec = {
  id: "kirana-till",
  headers: [
    "Bill No",
    "Bill Date",
    "Store",
    "Counter",
    "Cashier",
    "Item Name",
    "Qty",
    "MRP",
    "Discount",
    "Net Amount",
    "Payment Mode",
  ],
  rows: [
    [
      "B-24017",
      "2025-03-01 10:14",
      "Andheri West",
      "C1",
      "Asha",
      "Basmati Rice 5kg",
      "1",
      "640",
      "20",
      "620",
      "Cash",
    ],
    [
      "B-24017",
      "2025-03-01 10:14",
      "Andheri West",
      "C1",
      "Asha",
      "Sunflower Oil 1L",
      "2",
      "180",
      "0",
      "360",
      "Cash",
    ],
    [
      "B-24018",
      "2025-03-01 10:21",
      "Andheri West",
      "C2",
      "Ravi",
      "Bath Soap 4-pack",
      "1",
      "220",
      "10",
      "210",
      "UPI",
    ],
    [
      "B-31092",
      "2025-03-01 18:40",
      "Bandra",
      "C1",
      "Meena",
      "Assam Tea 500g",
      "1",
      "280",
      "0",
      "280",
      "Card",
    ],
    ["B-31093", "2025-03-01 19:05", "Bandra", "C3", "Imran", "Cream Biscuits", "4", "40", "0", "160", "UPI"],
  ],
  ids: ["Bill No"],
};

/** An FMCG distributor's GST invoice register, billing retailers on salesmen's beats. */
const DISTRIBUTOR_INVOICES: LayoutSpec = {
  id: "distributor-invoices",
  headers: [
    "Invoice No",
    "Invoice Date",
    "Retailer Name",
    "GSTIN",
    "HSN Code",
    "Product",
    "Cases",
    "Rate",
    "Taxable Value",
    "CGST",
    "SGST",
    "Salesman",
    "Beat",
  ],
  rows: [
    [
      "INV/24-25/1041",
      "02-04-2024",
      "Shree Balaji Stores",
      "27AAEPB1234C1Z5",
      "3401",
      "Detergent Bar 200g",
      "12",
      "540.00",
      "6480.00",
      "583.20",
      "583.20",
      "Santosh",
      "Dadar East",
    ],
    [
      "INV/24-25/1042",
      "02-04-2024",
      "Laxmi General Store",
      "27AAKPL5678D1Z2",
      "3305",
      "Hair Oil 100ml",
      "5",
      "860.00",
      "4300.00",
      "387.00",
      "387.00",
      "Santosh",
      "Dadar East",
    ],
    [
      "INV/24-25/1043",
      "03-04-2024",
      "New Royal Mart",
      "27AAFCN9012E1Z8",
      "1905",
      "Glucose Biscuits",
      "20",
      "310.00",
      "6200.00",
      "558.00",
      "558.00",
      "Prakash",
      "Sion",
    ],
    [
      "INV/24-25/1044",
      "03-04-2024",
      "Om Sai Provision",
      "27ABCPO3456F1Z1",
      "3401",
      "Detergent Bar 200g",
      "8",
      "540.00",
      "4320.00",
      "388.80",
      "388.80",
      "Prakash",
      "Sion",
    ],
    [
      "INV/24-25/1045",
      "04-04-2024",
      "Ganesh Kirana",
      "27AAGPG7890G1Z4",
      "2106",
      "Instant Noodles",
      "15",
      "420.00",
      "6300.00",
      "567.00",
      "567.00",
      "Mahesh",
      "Kurla",
    ],
  ],
  unique: ["Invoice No"],
  ids: ["Retailer Name", "GSTIN"],
};

/** An area manager's weekly store league table: one row per store and week, no bills in it. */
const STORE_LEAGUE_TABLE: LayoutSpec = {
  id: "store-league-table",
  headers: ["Store", "Area", "Week Ending", "Sales £", "Sales LY £", "LFL %", "Transactions", "ATV £", "UPT"],
  rows: [
    ["Leeds Kirkstall", "North", "2025-03-02", "48210", "45120", "6.8", "6120", "7.88", "4.1"],
    ["York Haxby", "North", "2025-03-02", "39875", "40210", "-0.8", "5310", "7.51", "3.9"],
    ["Bristol Filton", "West", "2025-03-02", "52340", "49800", "5.1", "6480", "8.08", "4.3"],
    ["Bath Oldfield", "West", "2025-03-02", "31220", "30110", "3.7", "4205", "7.42", "3.8"],
    ["Leeds Kirkstall", "North", "2025-03-09", "47680", "46010", "3.6", "6040", "7.89", "4.0"],
  ],
};

/** A sales MIS: rep-wise monthly target vs achievement, the way a sales head reviews the team. */
const REP_TARGET_MIS: LayoutSpec = {
  id: "rep-target-mis",
  headers: ["Month", "Region", "Sales Officer", "Target (₹ Lakh)", "Achievement (₹ Lakh)", "Achievement %"],
  rows: [
    ["Apr-2024", "West", "Rahul Patil", "42.0", "39.5", "94.0"],
    ["Apr-2024", "West", "Sneha Kulkarni", "38.0", "41.2", "108.4"],
    ["Apr-2024", "North", "Amit Verma", "45.0", "40.1", "89.1"],
    ["May-2024", "North", "Pooja Arora", "36.0", "37.8", "105.0"],
    ["May-2024", "South", "Karthik Rao", "40.0", "35.6", "89.0"],
  ],
};

/** A D2C brand's order export: courier, AWB, delivery PIN code, COD or prepaid, marketplace channel. */
const D2C_ORDERS: LayoutSpec = {
  id: "d2c-orders",
  headers: [
    "Order ID",
    "Order Date",
    "SKU",
    "Product Name",
    "Quantity",
    "Selling Price",
    "Order Total",
    "Payment Method",
    "Channel",
    "Courier",
    "AWB Number",
    "Shipping Pincode",
    "Order Status",
  ],
  rows: [
    [
      "SO-10231",
      "2025-01-04 11:02",
      "TEE-BLK-M",
      "Cotton Tee Black M",
      "2",
      "499",
      "998",
      "Prepaid",
      "Website",
      "Delhivery",
      "1490811100231",
      "560034",
      "Delivered",
    ],
    [
      "SO-10232",
      "2025-01-04 12:40",
      "JGR-NVY-L",
      "Joggers Navy L",
      "1",
      "1299",
      "1299",
      "COD",
      "Amazon",
      "Blue Dart",
      "1490811100232",
      "411001",
      "RTO",
    ],
    [
      "SO-10233",
      "2025-01-05 09:15",
      "TEE-WHT-S",
      "Cotton Tee White S",
      "3",
      "499",
      "1497",
      "COD",
      "Flipkart",
      "Ekart",
      "1490811100233",
      "700091",
      "Delivered",
    ],
    [
      "SO-10234",
      "2025-01-05 16:30",
      "HD-GRY-XL",
      "Hoodie Grey XL",
      "1",
      "1799",
      "1799",
      "Prepaid",
      "Website",
      "Xpressbees",
      "1490811100234",
      "122002",
      "Returned",
    ],
    [
      "SO-10235",
      "2025-01-06 20:12",
      "TEE-BLK-L",
      "Cotton Tee Black L",
      "1",
      "499",
      "499",
      "COD",
      "Amazon",
      "Delhivery",
      "1490811100235",
      "380015",
      "Cancelled",
    ],
  ],
  unique: ["Order ID", "AWB Number"],
};

/** An order table with nothing but what shop and online sales share. */
const PLAIN_ORDERS: LayoutSpec = {
  id: "plain-orders",
  headers: ["Order ID", "Order Date", "Customer", "Product", "Quantity", "Amount"],
  rows: [
    ["10001", "2025-02-01", "Meera Iyer", "Desk Lamp", "1", "1450"],
    ["10002", "2025-02-01", "Arjun Nair", "Notebook Pack", "3", "540"],
    ["10003", "2025-02-02", "Divya Reddy", "Office Chair", "1", "8999"],
    ["10004", "2025-02-03", "Rohan Das", "Desk Lamp", "2", "2900"],
    ["10005", "2025-02-03", "Kabir Singh", "Whiteboard", "1", "2999"],
  ],
  unique: ["Order ID"],
  ids: ["Customer"],
};

describe("shop, POS and B2B tables are Sales & Retail", () => {
  it.each([
    ["a grocery till export", KIRANA_TILL],
    ["a distributor's GST invoice register", DISTRIBUTOR_INVOICES],
    ["a store league table", STORE_LEAGUE_TABLE],
    ["a rep-wise target vs achievement MIS", REP_TARGET_MIS],
  ] as const)("reads %s as sales, never confidently as e-commerce", async (_name, spec) => {
    const d = await detectLayout(spec);
    const summary = d.candidates.map((c) => `${c.domainId} ${c.confidence}`).join(", ");
    expect(top(d), summary).toBe("sales");
    expect(confidentlyEcommerce(d), summary).toBe(false);
  });

  it("reads the distributor's invoice register as invoice lines and the league table as store sales", async () => {
    expect((await detectLayout(DISTRIBUTOR_INVOICES)).shapes.sales).toBe("transactions");
    expect((await detectLayout(STORE_LEAGUE_TABLE)).shapes.sales).toBe("pos");
  });
});

describe("online orders stay e-commerce", () => {
  it("reads a D2C order export with courier, AWB, COD and PIN code as e-commerce without asking", async () => {
    const d = await detectLayout(D2C_ORDERS);
    const summary = d.candidates.map((c) => `${c.domainId} ${c.confidence}`).join(", ");
    expect(top(d), summary).toBe("ecommerce");
    expect(d.needsConfirmation, summary).toBe(false);
  });

  it("does not claim a plain order table that shop and online sales both describe", async () => {
    const d = await detectLayout(PLAIN_ORDERS);
    const summary = d.candidates.map((c) => `${c.domainId} ${c.confidence}`).join(", ");
    expect(confidentlyEcommerce(d), summary).toBe(false);
  });
});

// ---------------------------------------------------------------- field rules

describe("the columns that tell them apart", () => {
  it("gives the counter's columns to Sales & Retail", async () => {
    const p = await profileOf({
      "Receipt Number": seq(60, (i) => `R-${5000 + i}`),
      Register: seq(60, (i) => `Till ${(i % 3) + 1}`),
      "Cashier Name": seq(60, (i) => ["Asha", "Ravi", "Meena"][i % 3] as string),
      "Tender Type": seq(60, (i) => ["Cash", "Card", "UPI"][i % 3] as string),
      "Customer Type": seq(60, (i) => ["Member", "Walk-in"][i % 2] as string),
      "HSN Code": seq(60, (i) => String(34011100 + (i % 23) * 1009)),
      "Beat Name": seq(60, (i) => ["Dadar East", "Sion", "Kurla"][i % 3] as string),
      CGST: seq(60, (i) => (12 + i * 0.75).toFixed(2)),
    });
    expect(score(p, "sales", "invoice_id", "Receipt Number")).toBeGreaterThanOrEqual(0.9);
    expect(score(p, "sales", "till", "Register")).toBeGreaterThanOrEqual(0.9);
    expect(score(p, "sales", "cashier", "Cashier Name")).toBeGreaterThanOrEqual(0.9);
    expect(score(p, "sales", "payment_mode", "Tender Type")).toBeGreaterThanOrEqual(0.9);
    expect(score(p, "sales", "customer_segment", "Customer Type")).toBeGreaterThanOrEqual(0.9);
    // A numeric code: a match whether it profiles as an identifier or a dimension.
    expect(score(p, "sales", "hsn_code", "HSN Code")).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(score(p, "sales", "beat", "Beat Name")).toBeGreaterThanOrEqual(0.9);
    expect(score(p, "sales", "tax_amount", "CGST")).toBeGreaterThanOrEqual(0.9);
  });

  it("does not read a bill, invoice or receipt number as an online order ID, or a store as a sales channel", async () => {
    const p = await profileOf({
      "Invoice No": seq(60, (i) => `INV-${1000 + i}`),
      "Bill No": seq(60, (i) => `B-${2000 + i}`),
      "Receipt Number": seq(60, (i) => `R-${3000 + i}`),
      "Invoice Date": seq(60, (i) => `2025-01-${String((i % 28) + 1).padStart(2, "0")}`),
      Store: seq(60, (i) => ["Andheri", "Bandra", "Thane"][i % 3] as string),
    });
    for (const c of ["Invoice No", "Bill No", "Receipt Number"])
      expect(score(p, "ecommerce", "order_id", c), c).toBeLessThan(MATCH_THRESHOLD);
    expect(score(p, "ecommerce", "order_date", "Invoice Date")).toBeLessThan(MATCH_THRESHOLD);
    expect(score(p, "ecommerce", "channel", "Store")).toBeLessThan(MATCH_THRESHOLD);
    expect(score(p, "sales", "store", "Store")).toBeGreaterThanOrEqual(0.9);
  });

  it("gives delivery to the buyer, COD and marketplaces to e-commerce", async () => {
    const p = await profileOf({
      "AWB Number": seq(60, (i) => `14908111${String(i).padStart(5, "0")}`),
      "Fulfillment Channel": seq(60, (i) => ["Amazon", "Merchant"][i % 2] as string),
      "Shipping Method": seq(60, (i) => ["Standard", "Express"][i % 2] as string),
      COD: seq(60, (i) => (i % 3 === 0 ? 1 : 0)),
      "Delivery Pincode": seq(60, (i) => String(560001 + (i % 40))),
      "Delivery Days": seq(60, (i) => 2 + (i % 6)),
      Marketplace: seq(60, (i) => ["Amazon", "Flipkart", "Website"][i % 3] as string),
    });
    expect(score(p, "ecommerce", "tracking_id", "AWB Number")).toBeGreaterThanOrEqual(0.9);
    expect(score(p, "ecommerce", "fulfilment_channel", "Fulfillment Channel")).toBeGreaterThanOrEqual(0.9);
    expect(score(p, "ecommerce", "shipping_method", "Shipping Method")).toBeGreaterThanOrEqual(0.9);
    expect(score(p, "ecommerce", "is_cod", "COD")).toBeGreaterThanOrEqual(0.9);
    expect(score(p, "ecommerce", "pincode", "Delivery Pincode")).toBeGreaterThanOrEqual(0.9);
    expect(score(p, "ecommerce", "delivery_days", "Delivery Days")).toBeGreaterThanOrEqual(0.9);
    expect(score(p, "ecommerce", "channel", "Marketplace")).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps look-alike columns out of fields they are not", async () => {
    const p = await profileOf({
      "Customer Country": seq(60, (i) => ["India", "Nepal", "Sri Lanka"][i % 3] as string),
      "Cancellation Reason": seq(60, (i) => ["Changed mind", "Late delivery", "Wrong size"][i % 3] as string),
      "Days for shipping": seq(60, (i) => 1 + (i % 6)),
      "Delivery Status": seq(60, (i) => ["Delivered", "In transit", "Late delivery"][i % 3] as string),
      "GST %": seq(60, (i) => [5, 12, 18][i % 3] as number),
    });
    // A customer's country is not the customer, a cancellation is not a return, a transit time is not a fee.
    expect(score(p, "ecommerce", "customer_id", "Customer Country")).toBeLessThan(MATCH_THRESHOLD);
    expect(score(p, "ecommerce", "return_reason", "Cancellation Reason")).toBeLessThan(MATCH_THRESHOLD);
    expect(score(p, "ecommerce", "shipping_fee", "Days for shipping")).toBeLessThan(MATCH_THRESHOLD);
    // A delivery status is not a CRM deal stage.
    expect(score(p, "sales", "stage", "Delivery Status")).toBeLessThan(MATCH_THRESHOLD);
  });

  it("reads payment values shared by every kind of shop as no evidence of the industry", () => {
    // Cash, card and UPI are paid at counters, online and in hospitals alike: Sales' payment mode is
    // matched by name only, so a pharmacy or restaurant register gets no value bonus from them.
    expect(field("sales", "payment_mode").valueHints).toBeUndefined();
    expect(field("ecommerce", "payment_method").valueHints).toEqual(
      expect.arrayContaining(["cod", "prepaid", "cash on delivery"]),
    );
  });
});

// ---------------------------------------------------------------- Store & POS KPIs

// Four bills in two stores. Revenue 620 + 360 + 210 + 280 + 160 + 110 = 1,740; units 1 + 2 + 1 + 1 + 4 + 2
// = 11. Bills: B1 cash, B2 UPI, B3 card, B4 UPI.
const TILL_CSV = `Bill No,Bill Date,Store,Till,Cashier,Item,Qty,Net Amount,Payment Mode
B1,2025-03-01 10:14,Andheri,T1,Asha,Rice 5kg,1,620,Cash
B1,2025-03-01 10:14,Andheri,T1,Asha,Oil 1L,2,360,Cash
B2,2025-03-01 10:21,Andheri,T2,Ravi,Soap,1,210,UPI
B3,2025-03-02 18:40,Bandra,T1,Meena,Tea 500g,1,280,Card
B3,2025-03-02 18:40,Bandra,T1,Meena,Biscuits,4,160,Card
B4,2025-03-02 19:05,Bandra,T1,Meena,Milk 1L,2,110,UPI
`;

async function posSession(csv: string, name: string) {
  const s = new Session();
  const load = await s.ingest(new Blob([csv]), name, {});
  if (load.status !== "ok") throw new Error(load.status);
  const ctx = s.configure({ domainId: "sales", subDomainId: "pos", numberLocale: "IN", currency: null });
  const value = (id: string): number => {
    const v = s.kpiBatch([], [id], "IN").values.find((x) => x.id === id);
    if (!v || v.value === null) throw new Error(`KPI ${id} is not available`);
    return v.value;
  };
  return { ctx, value };
}

describe("the Store & POS shape", () => {
  it("maps a till export and works its KPIs out exactly", async () => {
    const { ctx, value } = await posSession(TILL_CSV, "till.csv");
    expect(ctx.mapping.fields.invoice_id).toBe("Bill No");
    expect(ctx.mapping.fields.store).toBe("Store");
    expect(ctx.mapping.fields.till).toBe("Till");
    expect(ctx.mapping.fields.cashier).toBe("Cashier");
    expect(ctx.mapping.fields.payment_mode).toBe("Payment Mode");
    expect(ctx.mapping.classes["payment_mode.card_upi"]?.sort()).toEqual(["Card", "UPI"]);
    expect(ctx.mapping.classes["payment_mode.cash"]).toEqual(["Cash"]);
    expect(value("revenue")).toBe(1740);
    expect(value("bills")).toBe(4);
    // Ratios of sums: 1,740 ÷ 4 bills and 11 units ÷ 4 bills, never averages of bill totals.
    expect(value("avg_bill_value")).toBe(435);
    expect(value("units_per_bill")).toBe(2.75);
    expect(value("stores")).toBe(2);
    expect(value("sales_per_store")).toBe(870);
    // B2, B3 and B4 of the four bills were paid by card or UPI.
    expect(value("card_upi_share")).toBe(0.75);
  });

  it("counts bills from a store summary's own bill-count column", async () => {
    const csv = `Store,Week Ending,Sales,Transactions,Units
Leeds,2025-03-02,48000,6000,24600
York,2025-03-02,40000,5000,19500
Leeds,2025-03-09,47000,5900,23900
`;
    const { ctx, value } = await posSession(csv, "stores.csv");
    expect(ctx.mapping.fields.bill_count).toBe("Transactions");
    expect(value("bills")).toBe(16900);
    // Σ sales ÷ Σ bills = 135,000 ÷ 16,900, not the average of each row's sales per bill.
    expect(value("avg_bill_value")).toBeCloseTo(135000 / 16900, 10);
    expect(value("units_per_bill")).toBeCloseTo(68000 / 16900, 10);
  });

  it("has four to six hero KPIs and nothing scoped to it is a roster", () => {
    const sales = domain("sales");
    const pos = sales.subDomains.find((s) => s.id === "pos");
    expect(pos?.timeModel).toBeUndefined();
    const heroes = sales.kpis
      .filter((k) => k.tier === "hero" && k.subDomains?.includes("pos"))
      .map((k) => k.id);
    expect(heroes.length).toBeGreaterThanOrEqual(4);
    expect(heroes.length).toBeLessThanOrEqual(6);
    expect(heroes).toEqual(
      expect.arrayContaining(["revenue", "bills", "avg_bill_value", "units_per_bill", "sales_per_store"]),
    );
  });
});

// ---------------------------------------------------------------- KPI names

describe("the KPI names analysts use", () => {
  it("reads retail and sales MIS abbreviations as Sales & Retail KPIs", async () => {
    const p = await profileOf({
      "ATV (₹)": seq(40, (i) => 420 + i * 3.5),
      UPT: seq(40, (i) => (2.4 + (i % 9) / 10).toFixed(1)),
      "Achievement %": seq(40, (i) => (82 + (i % 30)).toFixed(1)),
      "Card %": seq(40, (i) => (0.4 + (i % 20) / 100).toFixed(2)),
      "Win Ratio": seq(40, (i) => (0.18 + (i % 12) / 100).toFixed(2)),
    });
    const matched = new Map(matchKpiNames(domain("sales"), namesToRead(p)).map((m) => [m.column, m.kpiId]));
    expect(matched.get("ATV (₹)")).toBe("avg_bill_value");
    expect(matched.get("UPT")).toBe("units_per_bill");
    expect(matched.get("Achievement %")).toBe("target_attainment");
    expect(matched.get("Card %")).toBe("card_upi_share");
    expect(matched.get("Win Ratio")).toBe("win_rate");
  });

  it("reads online-store abbreviations as e-commerce KPIs", async () => {
    const p = await profileOf({
      AOV: seq(40, (i) => 850 + i * 4),
      GMV: seq(40, (i) => 125000 + i * 900),
      "RTO %": seq(40, (i) => (0.08 + (i % 10) / 100).toFixed(2)),
      CVR: seq(40, (i) => (0.012 + (i % 8) / 1000).toFixed(3)),
      "OOS %": seq(40, (i) => (0.03 + (i % 6) / 100).toFixed(2)),
    });
    const matched = new Map(
      matchKpiNames(domain("ecommerce"), namesToRead(p)).map((m) => [m.column, m.kpiId]),
    );
    expect(matched.get("AOV")).toBe("aov");
    expect(matched.get("GMV")).toBe("gross_sales");
    expect(matched.get("RTO %")).toBe("rto_rate");
    expect(matched.get("CVR")).toBe("conversion_rate");
    expect(matched.get("OOS %")).toBe("stockout_rate");
  });
});
