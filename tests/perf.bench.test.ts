/**
 * Performance budget from the product spec: profiling 100,000 rows must take
 * under 3 seconds. Builds a realistic 100k-row order file in memory, then
 * times parse, profile, detection and a full dashboard computation. Set
 * LOUPE_BENCH=1 to also run a 1,000,000-row pass (reported, not asserted).
 * Timings are for Node on the build machine; browsers are usually within 2×.
 */
import { describe, expect, it } from "vitest";
import { Rng } from "@/engine/core/random";
import { profileDataset } from "@/engine/profile/profile";
import { detectDomain } from "@/engine/detect/detect";
import { DOMAINS } from "@/registry";
import { Session } from "@/engine/session";
import { parse } from "./helpers/dataset";

const STATES = [
  "Maharashtra",
  "Karnataka",
  "Delhi",
  "Tamil Nadu",
  "Gujarat",
  "West Bengal",
  "Telangana",
  "Uttar Pradesh",
];
const CATS = [
  "Apparel",
  "Footwear",
  "Home & Kitchen",
  "Electronics Accessories",
  "Beauty & Personal Care",
  "Sports & Fitness",
];
const STATUS = [
  "Delivered",
  "Delivered",
  "Delivered",
  "Delivered",
  "Shipped",
  "RTO",
  "Cancelled",
  "Returned",
];
const PAY = ["COD", "UPI", "Card", "Net Banking", "Wallet"];

function ordersCsv(rows: number): string {
  const rng = new Rng(7);
  const out = [
    "Order ID,Order Date,Customer ID,Customer State,Category,SKU,Quantity,Unit Price,Gross Amount,Discount,Net Amount,Payment Method,Order Status",
  ];
  const start = Date.UTC(2024, 0, 1);
  for (let i = 0; i < rows; i++) {
    const day = new Date(start + rng.int(0, 729) * 86_400_000).toISOString().slice(0, 10);
    const qty = rng.int(1, 4);
    const price = rng.int(199, 4999);
    const gross = qty * price;
    const disc = rng.chance(0.3) ? Math.round(gross * 0.1) : 0;
    out.push(
      [
        `O${100000 + Math.floor(i / 2)}`,
        day,
        `C${rng.int(1, rows / 4)}`,
        rng.pick(STATES),
        rng.pick(CATS),
        `SKU-${rng.int(1, 400)}`,
        qty,
        price,
        gross,
        disc,
        gross - disc,
        rng.pick(PAY),
        rng.pick(STATUS),
      ].join(","),
    );
  }
  return out.join("\n") + "\n";
}

async function run(rows: number) {
  const csv = ordersCsv(rows);
  const t0 = performance.now();
  const { ds } = await parse(csv, "orders.csv");
  const t1 = performance.now();
  const profile = profileDataset(ds);
  const t2 = performance.now();
  const detection = detectDomain(DOMAINS, profile);
  const t3 = performance.now();
  return {
    ds,
    profile,
    detection,
    parseMs: t1 - t0,
    profileMs: t2 - t1,
    detectMs: t3 - t2,
    mb: csv.length / 1024 / 1024,
  };
}

describe("performance budget", () => {
  it("profiles 100,000 rows in under 3 seconds", async () => {
    const r = await run(100_000);
    console.info(
      `[perf] 100k rows (${r.mb.toFixed(1)} MB): parse ${r.parseMs.toFixed(0)} ms, profile ${r.profileMs.toFixed(0)} ms, detect ${r.detectMs.toFixed(0)} ms`,
    );
    expect(r.ds.rowCount).toBe(100_000);
    expect(r.profileMs).toBeLessThan(3000);
    expect(r.detection.candidates[0]?.domainId).toBe("ecommerce");
  }, 120_000);

  it("computes a full dashboard for the 48k-row demo quickly", () => {
    const s = new Session();
    const t0 = performance.now();
    const load = s.ingestSample("ecommerce");
    if (load.status !== "ok") throw new Error(load.status);
    const ctx = s.configure({ domainId: "ecommerce", numberLocale: "IN", currency: null });
    const t1 = performance.now();
    const result = s.computeDashboard({
      filters: [],
      kpiIds: [...ctx.selection.hero, ...ctx.selection.supporting],
      charts: ctx.charts.map((c) => ({ specId: c.id })),
      numberLocale: "IN",
    });
    const t2 = performance.now();
    console.info(
      `[perf] demo load+profile+detect+configure ${(t1 - t0).toFixed(0)} ms; dashboard (${Object.keys(result.charts).length} charts, ${result.kpis.values.length} KPIs) ${(t2 - t1).toFixed(0)} ms`,
    );
    expect(t2 - t1).toBeLessThan(5000);
  }, 120_000);

  it.runIf(process.env.LOUPE_BENCH === "1")(
    "handles 1,000,000 rows (reported)",
    async () => {
      const r = await run(1_000_000);
      console.info(
        `[perf] 1M rows (${r.mb.toFixed(0)} MB): parse ${r.parseMs.toFixed(0)} ms, profile ${r.profileMs.toFixed(0)} ms, detect ${r.detectMs.toFixed(0)} ms`,
      );
      expect(r.ds.rowCount).toBe(1_000_000);
    },
    600_000,
  );
});
