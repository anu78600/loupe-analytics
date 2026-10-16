/**
 * Hidden columns (step 3, profile/hidden.ts) and the suggestions of which
 * columns to hide (profile/replaced.ts).
 *
 * The file is the one that prompted the feature: an order file whose
 * Unit_Price has bad values (-100), a Reference_Price used to correct them,
 * and the cleaned result, Unit_Price_Clean. Before hiding, the template
 * reads the raw Unit_Price (its name is the exact match), so gross sales
 * come out wrong. With Unit_Price and Reference_Price hidden:
 * - they stay in the dataset, the data grid and every export;
 * - no KPI, chart, filter, insight, question or AI payload reads them, and
 *   the field is matched to Unit_Price_Clean (even over an earlier manual
 *   mapping), so gross sales match a hand computation;
 * - the data check and the health score ignore their problems;
 * - Power BI marks them hidden and the README and dictionary say so.
 * Also covers the suggestions on their own, so ordinary column pairs
 * ("Customers" and "New_Customers") are not taken for raw and clean copies.
 */
import { describe, expect, it } from "vitest";
import { Session, type ContextRequest } from "@/engine/session";
import type { ExportContext } from "@/engine/export/context";
import { columnUsage } from "@/engine/charts/columnUsage";
import { customSpec } from "@/engine/charts/recommend";
import { buildPowerBiPackage } from "@/engine/export/powerbi";
import { generateTmdl } from "@/engine/export/tmdl";
import { dictionaryMarkdown } from "@/engine/export/dictionary";
import { generateReadme } from "@/engine/export/readme";
import { replacedColumns } from "@/engine/profile/replaced";
import { SAMPLES } from "@/engine/samples";

const CITIES = ["Pune", "Delhi", "Mumbai", "Chennai"];
const PRICES = [749, 599, 1499, 349, 799, 499, 299, 2199, 1299];
const ROWS = 300;
const BAD = (i: number) => i % 7 === 3;

/** Order lines: Unit_Price is -100 on every seventh row and discounted on every fifth; Unit_Price_Clean fixes the -100s from Reference_Price. */
function orders(): { csv: string; gross: number; rawGross: number } {
  const lines = ["Order_ID,Order_Date,City,Quantity,Unit_Price,Reference_Price,Unit_Price_Clean"];
  let gross = 0;
  let rawGross = 0;
  for (let i = 0; i < ROWS; i++) {
    const ref = PRICES[i % PRICES.length] as number;
    const qty = (i % 3) + 1;
    const sold = i % 5 === 0 ? Math.round(ref * 0.9) : ref;
    const raw = BAD(i) ? -100 : sold;
    const clean = BAD(i) ? ref : sold;
    gross += qty * clean;
    rawGross += qty * raw;
    const day = String((i % 28) + 1).padStart(2, "0");
    const month = String((i % 12) + 1).padStart(2, "0");
    lines.push([`OD${10000 + i}`, `2025-${month}-${day}`, CITIES[i % 4], qty, raw, ref, clean].join(","));
  }
  return { csv: lines.join("\n"), gross, rawGross };
}

const HIDE = ["Unit_Price", "Reference_Price"];

describe("hiding the raw columns a cleaned column was built from", async () => {
  const data = orders();
  const s = new Session();
  const load = await s.ingest(new Blob([data.csv]), "orders.csv", {});
  if (load.status !== "ok") throw new Error(load.status);
  const req: ContextRequest = { domainId: "ecommerce", numberLocale: "INTL", currency: null };
  const before = s.configure(req);
  const gmvBefore = s.kpiBatch([], ["gross_sales"], "INTL").values.find((v) => v.id === "gross_sales");
  const ctx = s.configure({ ...req, hiddenColumns: HIDE });
  const gmv = s.kpiBatch([], ["gross_sales"], "INTL").values.find((v) => v.id === "gross_sales");

  it("suggests both columns, with the evidence", () => {
    expect(load.replaced.map((r) => [r.column, r.keep, r.evidence])).toEqual([
      ["Unit_Price", "Unit_Price_Clean", "name"],
      ["Reference_Price", "Unit_Price_Clean", "reference"],
    ]);
    const [price, reference] = load.replaced;
    expect(price?.reason).toMatch(/"Unit_Price_Clean" is the same name with "Clean" added/);
    // Only the rows where Unit_Price was -100 differ, so they match on 6 rows in 7.
    expect(price?.reason).toMatch(/match on 86% of the rows/);
    expect(price?.reason).toMatch(/data check marks problems in "Unit_Price" \(Negative prices/);
    expect(reference?.reason).toMatch(/"Reference_Price" is named as a reference/);
  });

  it("read the raw column before, which got gross sales wrong", () => {
    expect(before.mapping.fields.unit_price).toBe("Unit_Price");
    expect(gmvBefore?.value).toBeCloseTo(data.rawGross, 6);
  });

  it("then matches the field to the cleaned column, so gross sales are right", () => {
    expect(ctx.hiddenColumns).toEqual(HIDE);
    expect(ctx.mapping.fields.unit_price).toBe("Unit_Price_Clean");
    expect(gmv?.value).toBeCloseTo(data.gross, 6);
    // A manual mapping to a hidden column is dropped, not obeyed.
    const pinned = s.configure({
      ...req,
      hiddenColumns: HIDE,
      mappingOverrides: { unit_price: "Unit_Price" },
    });
    expect(pinned.mapping.fields.unit_price).toBe("Unit_Price_Clean");
  });

  it("builds no KPI, chart or filter from a hidden column", () => {
    const names = ctx.profile.columns.map((c) => c.name);
    for (const h of HIDE) expect(names).not.toContain(h);
    expect(Object.values(ctx.mapping.fields).filter((c) => HIDE.includes(c))).toEqual([]);
    for (const k of ctx.kpis) for (const f of k.fieldsUsed) expect(HIDE, k.id).not.toContain(f.column);
    expect(ctx.dimensions.map((d) => d.column).filter((c) => HIDE.includes(c))).toEqual([]);
    // Every chart's columns, KPI measures included.
    const usage = columnUsage(ctx, ctx.charts);
    for (const h of HIDE) expect(usage.has(h)).toBe(false);
    for (const spec of ctx.charts)
      expect(JSON.stringify(spec), spec.id).not.toMatch(/Unit_Price"|Reference_Price/);
    // The cleaned column now feeds the template (it was a your-column KPI before).
    expect(usage.get("Unit_Price_Clean")?.kpis.length).toBeGreaterThan(0);
  });

  it("keeps the data: every column is still in the dataset and the data grid", () => {
    // Row 1 is a discounted sale: Unit_Price 674 against a Reference_Price of 749.
    const first = s.rows(0, 1)[0] ?? [];
    expect(first).toHaveLength(7);
    expect(first.slice(4)).toEqual(["674", "749", "674"]);
  });

  it("refuses a chart or question built on a hidden column, and ignores its filters", () => {
    const spec = customSpec({
      id: "custom_ref",
      title: "Reference price by city",
      kind: "bar",
      x: { kind: "column", column: "City", label: "City" },
      measures: [
        {
          id: "agg:avg:Reference_Price",
          label: "Average Reference_Price",
          format: "currency",
          direction: "neutral",
        },
      ],
    });
    const chart = s.chart([], { specId: spec.id, spec }, "INTL");
    expect(chart?.empty).toBe(true);
    expect(chart?.notes.join(" ")).toMatch(/"Reference_Price", which you hid in Check & map/);

    const answer = s.answerQuestion(
      {
        id: "q1",
        question: "average unit price by city",
        understood: "Average Unit_Price by City",
        notes: [],
        ask: {
          measures: [{ kind: "column", column: "Unit_Price", agg: "avg" }],
          by: { kind: "column", column: "City" },
        },
        order: "desc",
        filters: [],
      },
      "INTL",
    );
    expect(answer.error).toMatch(/"Unit_Price", which you hid/);

    const filtered = s.kpiBatch(
      [{ kind: "in", column: "Reference_Price", values: ["749"] }],
      ["gross_sales"],
      "INTL",
    );
    expect(filtered.values.find((v) => v.id === "gross_sales")?.value).toBeCloseTo(data.gross, 6);
  });

  it("leaves hidden columns out of the data check and the health score", () => {
    expect(load.health.issues.some((i) => i.column === "Unit_Price")).toBe(true);
    expect(ctx.health.issues.some((i) => i.column && HIDE.includes(i.column))).toBe(false);
    expect(ctx.health.score).toBeGreaterThan(load.health.score);
    const views = s.checkViews();
    expect(views.some((v) => v.column && HIDE.includes(v.column))).toBe(false);
    expect(views.find((v) => v.id === "problems")?.rows).toBe(0);
    // A -100 row still shows its value, unmarked.
    const row = s.checkRows("all", 3, 1).rows[0];
    expect(row?.cells[4]).toBe("-100");
    expect(row?.problems).toEqual([]);
  });

  it("sends nothing about hidden columns to the AI layer", () => {
    const payload = JSON.stringify(s.aiPayload());
    expect(payload).not.toMatch(/Unit_Price"|Reference_Price/);
    expect(payload).toMatch(/Unit_Price_Clean/);
  });

  it("exports every column, with the hidden ones marked hidden", () => {
    const ec = (s as unknown as { exportContext(): ExportContext }).exportContext();
    expect(ec.hiddenColumns).toEqual(HIDE);
    const pkg = buildPowerBiPackage(ec, "{}");
    expect(pkg.manifest).toBeDefined();
    // In the model the columns stay, hidden from the report's field list; the clean one is not hidden.
    const tmdl = Object.values(generateTmdl(ec, "₹", ec.names.table)).join("\n");
    expect(tmdl).toMatch(/column unit_price\s+dataType: \w+\s+isHidden/);
    expect(tmdl).toMatch(/column reference_price\s+dataType: \w+\s+isHidden/);
    expect(tmdl).not.toMatch(/column unit_price_clean\s+dataType: \w+\s+isHidden/);
    const csvHeader = new TextDecoder().decode(s.exportCsv()).split("\n")[0];
    expect(csvHeader).toMatch(/unit_price,reference_price,unit_price_clean/);
    const readme = generateReadme(ec, ec.specs, "₹");
    expect(readme).toMatch(/## Hidden columns/);
    expect(readme).toMatch(/You hid `unit_price`, `reference_price` in Loupe/);
    expect(dictionaryMarkdown(ec)).toMatch(/\| Unit_Price \(hidden\) \|/);
  });

  it("uses a column again once it is shown", () => {
    const back = s.configure({ ...req, hiddenColumns: ["Reference_Price"] });
    expect(back.hiddenColumns).toEqual(["Reference_Price"]);
    expect(back.profile.columns.some((c) => c.name === "Unit_Price")).toBe(true);
    const none = s.configure(req);
    expect(none.hiddenColumns).toEqual([]);
    expect(none.health).toEqual(load.health);
  });
});

/** A small file from column name → values (all the same length). */
async function sessionOf(columns: Record<string, Array<string | number>>) {
  const names = Object.keys(columns);
  const n = (columns[names[0] as string] ?? []).length;
  const lines = [names.join(",")];
  for (let i = 0; i < n; i++) lines.push(names.map((c) => String(columns[c]?.[i] ?? "")).join(","));
  const s = new Session();
  const load = await s.ingest(new Blob([lines.join("\n")]), "t.csv", {});
  if (load.status !== "ok") throw new Error(load.status);
  return load.replaced.map((r) => [r.column, r.keep]);
}

const seq = (n: number, f: (i: number) => string | number) => Array.from({ length: n }, (_, i) => f(i));

describe("which columns look replaced", () => {
  it("pairs a raw column with its cleaned copy by name, when the data agrees", async () => {
    expect(
      await sessionOf({
        Region: seq(40, (i) => ["North", "South"][i % 2] as string),
        amount_raw: seq(40, (i) => (i % 9 === 0 ? -1 : 100 + i)),
        amount: seq(40, (i) => 100 + i),
      }),
    ).toEqual([["amount_raw", "amount"]]);
  });

  it("pairs text dates with their parsed copy", async () => {
    expect(
      await sessionOf({
        order_date: seq(40, (i) => (i % 2 ? `${(i % 28) + 1}/03/2025` : `March ${(i % 28) + 1} 2025`)),
        NEW_ORDER_DATE: seq(40, (i) => `2025-03-${String((i % 28) + 1).padStart(2, "0")}`),
        Sales: seq(40, (i) => 50 + i),
      }),
    ).toEqual([["order_date", "NEW_ORDER_DATE"]]);
  });

  it("leaves alone columns whose names differ by a marker but whose data doesn't agree", async () => {
    expect(
      await sessionOf({
        Month: seq(40, (i) => `2025-${String((i % 12) + 1).padStart(2, "0")}-01`),
        Customers: seq(40, (i) => 500 + i * 3),
        New_Customers: seq(40, (i) => 20 + (i % 7)),
      }),
    ).toEqual([]);
  });

  it("points a chain of copies at the cleanest one", async () => {
    expect(
      await sessionOf({
        Price_Raw: seq(40, (i) => (i % 4 === 0 ? -5 : 10 + i)),
        Price: seq(40, (i) => (i % 8 === 0 ? -5 : 10 + i)),
        Price_Clean: seq(40, (i) => 10 + i),
      }),
    ).toEqual([
      ["Price_Raw", "Price_Clean"],
      ["Price", "Price_Clean"],
    ]);
  });

  it("offers one of two identical columns, keeping the first", async () => {
    expect(
      await sessionOf({
        City: seq(40, (i) => ["Pune", "Delhi", "Agra"][i % 3] as string),
        Town: seq(40, (i) => ["Pune", "Delhi", "Agra"][i % 3] as string),
        Units: seq(40, (i) => i % 5),
      }),
    ).toEqual([["Town", "City"]]);
  });

  it("finds nothing to hide in the demo datasets", async () => {
    for (const sample of SAMPLES) {
      const s = new Session();
      const load = s.ingestSample(sample.id);
      if (load.status !== "ok") throw new Error(load.status);
      expect(load.replaced, sample.id).toEqual([]);
      // The pure function agrees with what the session returned.
      const ds = (s as unknown as { ds: Parameters<typeof replacedColumns>[0] }).ds;
      expect(replacedColumns(ds, load.profile, load.health)).toEqual([]);
    }
  });
});

describe("a KPI whose column is hidden", () => {
  it("says the column is hidden, not that the file lacks it", () => {
    const s = new Session();
    const load = s.ingestSample("ecommerce");
    if (load.status !== "ok") throw new Error(load.status);
    const top = load.detection.candidates[0];
    if (!top) throw new Error("not detected");
    const ctx = s.configure({
      domainId: top.domainId,
      numberLocale: "IN",
      currency: null,
      hiddenColumns: ["Order Status"],
    });
    const affected = ctx.kpis.filter((k) => !k.available && k.unavailableReason?.includes("Order Status"));
    expect(affected.length).toBeGreaterThan(0);
    for (const k of affected) {
      expect(k.unavailableReason, k.id).toMatch(/needs "Order Status", which you hid in Check & map\.$/);
      expect(k.substitute, k.id).toBe("Show the column again in Check & map to use this KPI.");
    }
    // No KPI points at Value meanings for a field it has no column for.
    for (const k of ctx.kpis.filter((x) => !x.available))
      if (k.substitute?.includes("Value meanings"))
        expect(k.unavailableReason ?? "", k.id).not.toMatch(/Order status/i);
  });
});
