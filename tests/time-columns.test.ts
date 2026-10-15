/**
 * Separate date and time columns. A time-of-day column ("20:15", "8:30 PM",
 * Excel time cells, or "1899-12-30 20:15:00" written by a tool that stores
 * times as date-times) is read as a time of day: never merged with the date
 * column, never shown with an 1899 date, never the dashboard's date, never
 * flagged as a placeholder date, and used for hour-of-day charts when the
 * date column has no times. Exports keep it a TIME.
 */
import { afterAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { DuckDBConnection } from "@duckdb/node-api";
import type { DateColumn } from "@/engine/core/types";
import { Session } from "@/engine/session";
import type { ExportContext } from "@/engine/export/context";
import { close, loadIntoDuckDB } from "./helpers/duck";
import { column, parse } from "./helpers/dataset";

const H = 3_600_000;
const M = 60_000;

const connections: DuckDBConnection[] = [];
afterAll(() => connections.forEach(close));

describe("reading time columns", () => {
  it("reads written times as times of day, next to a separate date column", async () => {
    const csv = [
      "Join Date,Join Time,Visitors",
      "2025-01-05,20:15,3",
      "2025-01-06,08:05:30,4",
      "2025-01-07,9:45 PM,5",
      "2025-01-08,12:00 AM,6",
    ].join("\n");
    const { ds } = await parse(csv, "joins.csv");
    const time = column(ds, "Join Time") as DateColumn;
    expect(time.kind).toBe("date");
    expect(time.timeOnly).toBe(true);
    expect([...time.values]).toEqual([20 * H + 15 * M, 8 * H + 5 * M + 30_000, 21 * H + 45 * M, 0]);
    // The date column is untouched: dates only, no time-of-day flag.
    const date = column(ds, "Join Date") as DateColumn;
    expect(date.timeOnly).toBeUndefined();
    expect(date.hasTime).toBe(false);
  });

  it("strips the 30 Dec 1899 that tools write in front of a time", async () => {
    const csv = [
      "Join Time,Visitors",
      "1899-12-30 20:15:00,1",
      "1899-12-30 06:40:00,2",
      "1899-12-30 13:05:00,3",
    ].join("\n");
    const { ds } = await parse(csv, "times.csv");
    const time = column(ds, "Join Time") as DateColumn;
    expect(time.timeOnly).toBe(true);
    expect([...time.values]).toEqual([20 * H + 15 * M, 6 * H + 40 * M, 13 * H + 5 * M]);
  });

  it("reads Excel time cells as times, not as 1899 dates", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["join_date", "join_time", "visitors"],
      [45662, 0.84375, 3],
      [45663, 0.25, 4],
      [45664, 0.5, 5],
    ]);
    for (const r of [2, 3, 4]) {
      (ws[`A${r}`] as XLSX.CellObject).z = "yyyy-mm-dd";
      (ws[`B${r}`] as XLSX.CellObject).z = "h:mm";
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const { ds } = await parse(new Uint8Array(buf), "joins.xlsx");
    const time = column(ds, "join_time") as DateColumn;
    expect(time.timeOnly).toBe(true);
    expect([...time.values]).toEqual([20 * H + 15 * M, 6 * H, 12 * H]);
    const date = column(ds, "join_date") as DateColumn;
    expect(date.timeOnly).toBeUndefined();
  });

  it("keeps a real date-time column as it is", async () => {
    const csv = ["Created,Visitors", "2025-01-05 20:15,1", "2025-01-06 08:05,2"].join("\n");
    const { ds } = await parse(csv, "stamps.csv");
    const created = column(ds, "Created") as DateColumn;
    expect(created.timeOnly).toBeUndefined();
    expect(created.hasTime).toBe(true);
  });
});

describe("a file with separate date and time columns", async () => {
  const rows = ["Order ID,Order Date,Order Time,Customer ID,Category,Quantity,Net Amount"];
  for (let i = 0; i < 300; i++) {
    const day = (i % 28) + 1;
    const month = (i % 9) + 1;
    const hour = (i * 7) % 24;
    rows.push(
      [
        `OD${10_000 + i}`,
        `2025-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        `${String(hour).padStart(2, "0")}:${String((i * 13) % 60).padStart(2, "0")}`,
        `C${100 + (i % 40)}`,
        ["Apparel", "Electronics", "Home"][i % 3],
        (i % 3) + 1,
        500 + ((i * 31) % 700),
      ].join(","),
    );
  }
  const s = new Session();
  const load = await s.ingest(new Blob([rows.join("\n")]), "orders.csv", {});
  if (load.status !== "ok") throw new Error(load.status);
  const ctx = s.configure({ domainId: "ecommerce", numberLocale: "INTL", currency: null });

  it("profiles the time as a time of day and never picks it as the date", () => {
    const p = ctx.profile.columns.find((c) => c.name === "Order Time");
    expect(p?.role).toBe("time");
    expect(p?.examples[0]).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(ctx.profile.primaryDate).toBe("Order Date");
    expect(ctx.dateColumn).toBe("Order Date");
    // The health check doesn't mistake the times for 1900 placeholder dates.
    expect(load.health.issues.some((i) => i.column === "Order Time")).toBe(false);
    // The data grid shows the time, not a date.
    const timeIdx = load.profile.columns.findIndex((c) => c.name === "Order Time");
    expect(s.rows(0, 1)[0]?.[timeIdx]).toMatch(/^\d{2}:\d{2}:00$/);
  });

  it("charts the hour of day from the time column", () => {
    const hourly = ctx.charts.filter((c) => c.x.kind === "part" && c.x.part === "hour");
    expect(hourly.length).toBeGreaterThan(0);
    for (const c of hourly) expect(c.x.kind === "part" && c.x.column).toBe("Order Time");
    expect(hourly[0]?.reason).toMatch(/separate Order Time column/);
    // Weekday still comes from the date column, so a weekday × hour heatmap reads both columns.
    const data = s.chart([], { specId: hourly[0]?.id as string }, "INTL");
    expect(data?.empty).toBeFalsy();
    expect(data?.categories.length).toBeGreaterThan(12);
  });

  it("exports it as a TIME, and the SQL still runs", async () => {
    const csv = new TextDecoder().decode(s.exportCsv(false));
    expect(csv.split(/\r?\n/)[1]).toMatch(/,\d{2}:\d{2}:00,/);
    const sql = s.exportSql();
    expect(sql).toMatch(/"order_time" TIME/);
    const ec = (s as unknown as { exportContext(): ExportContext }).exportContext();
    const bundle = s.verificationBundle();
    expect(bundle.columns.find((c) => c.name === "order_time")?.type).toBe("TIME");
    const conn = await loadIntoDuckDB(ec.ds, bundle.table, ec.names.columns);
    connections.push(conn);
    const got = (
      await conn.runAndReadAll(
        `SELECT MIN("order_time") AS lo, MAX("order_time") AS hi FROM "${bundle.table}"`,
      )
    ).getRowObjectsJson()[0];
    expect(String(got?.lo)).toMatch(/^0\d:\d{2}:00$/);
    expect(String(got?.hi)).toMatch(/^23:\d{2}:00$/);
  });
});

describe("a template without an hour chart", async () => {
  // Members with a join date and a separate join time; no template here charts hours of the day.
  const rows = ["member_id,join_date,join_time,city,plan,amount_paid"];
  const cities = ["Mumbai", "Delhi", "Pune", "Chennai"];
  for (let i = 0; i < 240; i++) {
    const mins = (i * 37) % 1440;
    rows.push(
      [
        `M${1000 + i}`,
        `2024-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
        `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`,
        cities[i % 4],
        ["Basic", "Plus", "Pro"][i % 3],
        299 + ((i * 53) % 900),
      ].join(","),
    );
  }
  const s = new Session();
  const load = await s.ingest(new Blob([rows.join("\n")]), "members.csv", {});
  if (load.status !== "ok") throw new Error(load.status);
  const top = load.detection.candidates[0];
  const ctx = s.configure({ domainId: top?.domainId ?? "generic", numberLocale: "INTL", currency: null });

  it("still charts the hour of day from the time column, adding up to its KPI", () => {
    const hourly = ctx.charts.find((c) => c.x.kind === "part" && c.x.part === "hour");
    expect(hourly, "an hour-of-day chart").toBeDefined();
    expect(hourly?.x.kind === "part" && hourly.x.column).toBe("join_time");
    const id = hourly?.measures[0]?.id as string;
    const card = s.kpiBatch([], [id], "INTL").values[0]?.value as number;
    const data = s.chart([], { specId: hourly?.id as string }, "INTL");
    const total = data?.series[0]?.values.reduce<number>((a, b) => a + (b ?? 0), 0) ?? NaN;
    expect(total).toBeCloseTo(card, 6);
    expect(ctx.dateColumn).toBe("join_date");
  });
});
