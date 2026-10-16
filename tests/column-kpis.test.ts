/**
 * Columns the industry template doesn't know (kpi/columnKpis): a sales file
 * with extra "Customer Rating", "Q7" (a 1–5 scale with no telling name) and
 * "Shipping Fee" columns. Each is understood from its data and summarised
 * the right way (ratings averaged, never summed; fees totalled), gets a
 * trend and a breakdown chart, and stays out of the template's KPI slots.
 * Columns the template reads (Revenue, Cost, Quantity) get nothing extra;
 * Profit, which it recognises but computes as revenue − cost, gets the plain
 * total of the file's own column, saying why. Every
 * column KPI's SQL returns the engine's value in DuckDB, and its charts
 * agree with its card. Also covers the value-only rating rule on its own,
 * and, on the demos, a tile map of every state for totals by state and no
 * "over time" chart on a roster.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import { Session } from "@/engine/session";
import type { ExportContext } from "@/engine/export/context";
import { profileColumn } from "@/engine/profile/profile";
import { close, loadIntoDuckDB, scalar } from "./helpers/duck";

const REGIONS = ["North", "South", "East", "West"];
const PRODUCTS = ["Laptop", "Phone", "Tablet", "Monitor", "Router"];

/** 400 deterministic invoice lines over 2025. */
function csv(): string {
  const rows = [
    "Invoice No,Invoice Date,Region,Product,Quantity,Revenue,Cost,Profit,Customer Rating,Q7,Shipping Fee",
  ];
  for (let i = 0; i < 400; i++) {
    const month = (i % 12) + 1;
    const day = (i % 27) + 1;
    const qty = (i % 4) + 1;
    const revenue = 1000 + ((i * 37) % 900);
    const cost = Math.round(revenue * 0.62);
    const rating = (i * 7) % 10 === 0 ? "" : String(((i * 3) % 5) + 1);
    const q7 = String(((i * 5) % 5) + 1 === 5 && i % 3 ? 4 : ((i * 5 + i) % 5) + 1);
    const fee = 40 + (i % 6) * 10;
    rows.push(
      [
        `INV-${1000 + i}`,
        `2025-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        REGIONS[i % 4],
        PRODUCTS[(i * 3) % 5],
        qty,
        revenue,
        cost,
        revenue - cost,
        rating,
        q7,
        fee,
      ].join(","),
    );
  }
  return rows.join("\n");
}

const connections: DuckDBConnection[] = [];
afterAll(() => connections.forEach(close));

describe("columns the template doesn't use", async () => {
  const s = new Session();
  const load = await s.ingest(new Blob([csv()]), "invoices.csv", {});
  if (load.status !== "ok") throw new Error(load.status);
  const ctx = s.configure({ domainId: "sales", numberLocale: "INTL", currency: null });
  const role = (name: string) => ctx.profile.columns.find((c) => c.name === name);
  const kpi = (name: string) => ctx.kpis.find((k) => k.name === name);

  it("reads what each column is from its data", () => {
    expect(role("Customer Rating")?.role).toBe("rate");
    // No name to go on: the 1–5 scale in the values says it is a score.
    expect(role("Q7")).toMatchObject({ role: "rate", additivity: "non-additive", defaultAgg: "avg" });
    expect(role("Q7")?.roleReason).toMatch(/1–5 scale/);
    expect(role("Shipping Fee")?.role).toBe("currency");
  });

  it("summarises each one the right way, and only the ones the template doesn't read", () => {
    const ids = ctx.selection.columns;
    expect(ids.map((id) => ctx.kpis.find((k) => k.id === id)?.name).sort()).toEqual(
      ["Average Customer Rating", "Average Q7", "Total Profit", "Total Shipping Fee"].sort(),
    );
    expect(kpi("Average Customer Rating")).toMatchObject({
      formula: "Average of Customer Rating",
      format: "decimal",
    });
    expect(kpi("Total Shipping Fee")).toMatchObject({ formula: "Sum of Shipping Fee", format: "currency" });
    // The template recognises Profit but computes gross profit as revenue − cost; the file's own
    // Profit column still gets its plain total, and the definition says why.
    expect(kpi("Total Profit")?.definition).toMatch(
      /reads Profit as "Profit" but computes its own KPIs another way/,
    );
    // Columns the template does read (Revenue, Cost, Quantity) get nothing extra.
    for (const n of ["Total Revenue", "Total Cost", "Total Quantity"]) expect(kpi(n)).toBeUndefined();
    // Column KPIs never take the template's hero or supporting slots.
    for (const id of ids) {
      expect(ctx.selection.hero).not.toContain(id);
      expect(ctx.selection.supporting).not.toContain(id);
    }
    // The mapping screen still lists template fields only.
    expect(ctx.domain.fields.some((f) => f.id.startsWith("yc_"))).toBe(false);
  });

  it("charts them over time and by the most useful category, titled in sentence case", () => {
    const titles = ctx.charts.filter((c) => c.section === "columns").map((c) => c.title);
    expect(titles).toContain("Average customer rating over time");
    expect(titles).toContain("Average customer rating by region");
    expect(titles).toContain("Total shipping fee by region");
    // Acronyms keep their capitals ("Average Q7" stays as written).
    expect(titles.some((t) => t.startsWith("Average Q7"))).toBe(true);
  });

  it("matches DuckDB for every column KPI", async () => {
    const ec = (s as unknown as { exportContext(): ExportContext }).exportContext();
    const bundle = s.verificationBundle();
    const conn = await loadIntoDuckDB(ec.ds, bundle.table, ec.names.columns);
    connections.push(conn);
    const ours = bundle.queries.filter((q) => q.id.startsWith("yc_"));
    expect(ours.length).toBe(4);
    for (const q of ours) {
      const got = await scalar(conn, q.sql);
      expect(q.engine, q.id).not.toBeNull();
      expect(
        Math.abs(got - (q.engine as number)),
        `${q.id}: DuckDB ${got} vs engine ${q.engine}`,
      ).toBeLessThan(1e-9 * Math.max(1, Math.abs(got)));
    }
  });

  it("totals its charts to its cards", () => {
    const batch = s.kpiBatch([], ctx.selection.columns, "INTL");
    const fee = batch.values.find((v) => v.id === kpi("Total Shipping Fee")?.id)?.value as number;
    const spec = ctx.charts.find((c) => c.title === "Total shipping fee by region");
    const data = s.chart([], { specId: spec?.id as string }, "INTL");
    const total = data?.series[0]?.values.reduce<number>((a, b) => a + (b ?? 0), 0) ?? NaN;
    expect(total).toBeCloseTo(fee, 6);
    // An average is never summed: the card is the mean of the rated rows.
    const rating = batch.values.find((v) => v.id === kpi("Average Customer Rating")?.id)?.value as number;
    expect(rating).toBeGreaterThanOrEqual(1);
    expect(rating).toBeLessThanOrEqual(5);
  });
});

describe("the value-only rating rule", () => {
  const scale = (name: string, values: number[]) =>
    profileColumn(
      {
        kind: "number",
        name,
        values: Float64Array.from(values),
        format: { integer: values.every(Number.isInteger), decimals: 1 },
      },
      0,
      values.length,
    );
  const oneToFive = Array.from({ length: 60 }, (_, i) => (i % 5) + 1);

  it("averages an unnamed 1–5 or 0–10 scale", () => {
    expect(scale("Feedback", oneToFive)?.role).toBe("rate");
    expect(
      scale(
        "Q3",
        Array.from({ length: 60 }, (_, i) => i % 11),
      )?.role,
    ).toBe("rate");
    expect(
      scale(
        "Stars given",
        Array.from({ length: 60 }, (_, i) => 1 + (i % 9) / 2),
      )?.role,
    ).toBe("rate");
  });

  it("leaves quantities, other ranges and short columns alone", () => {
    expect(scale("Quantity", oneToFive)?.role).toBe("measure");
    expect(
      scale(
        "Q3",
        Array.from({ length: 60 }, (_, i) => (i % 6) + 1),
      )?.additivity,
    ).toBe("additive");
    expect(
      scale(
        "Q3",
        Array.from({ length: 60 }, (_, i) => ((i % 5) + 1) * 1.3),
      )?.additivity,
    ).toBe("additive");
    expect(scale("Q3", oneToFive.slice(0, 10))?.additivity).toBe("additive");
  });
});

describe("column charts on the demos", () => {
  const open = (sample: string) => {
    const s = new Session();
    const load = s.ingestSample(sample);
    if (load.status !== "ok") throw new Error(load.status);
    const top = load.detection.candidates[0];
    if (!top) throw new Error(`${sample}: not detected`);
    return { s, ctx: s.configure({ domainId: top.domainId, numberLocale: "IN", currency: null }) };
  };

  it("maps a total by state over every state, not a top 10 with the rest blank", () => {
    const { s, ctx } = open("ecommerce");
    const map = ctx.charts.find((c) => c.id === "yc_by_gst_amount");
    expect(map?.kind).toBe("geoTile");
    expect(map?.topN).toBeUndefined();
    expect(map?.reason).toMatch(/tile map of every state/);
    const data = s.chart([], { specId: map?.id as string }, "IN");
    expect(data?.categories.length).toBe(24);
  });

  it("draws no 'over time' chart for a roster, whose dates say when each person started", () => {
    const { ctx } = open("hr");
    const columns = ctx.charts.filter((c) => c.section === "columns");
    expect(columns.length).toBeGreaterThan(0);
    expect(columns.some((c) => c.x.kind === "time")).toBe(false);
  });
});
