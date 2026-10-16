/**
 * The Customise step's chart logic on real data (ui/workspace/customise:
 * chartDraft.ts, brokenCharts.ts):
 *
 * - "Edit data" keeps only a title the user typed: a recommended chart's
 *   own title, or a custom chart's automatic one, is dropped, so the title
 *   follows the data (a measure changed to Orders reads "Orders by …", a
 *   donut moved to Courier reads "… by courier"). It starts from the card as
 *   shown: its type and Top N.
 * - Automatic titles and labels read columns with spaces, in sentence case
 *   ("Total net sales by product category"), like the user KPI names.
 * - Horizontal bars start with the height their number needs (a top 15 gets
 *   six rows), following the bar count until the user picks a height.
 * - One of the user's charts that can't be drawn says why: a column hidden
 *   in Check & map, a KPI deleted or not computable; recommended charts are
 *   never flagged. The charts showing a KPI are found before it is deleted.
 */
import { describe, expect, it } from "vitest";
import type { ChartSpec } from "@/engine/charts/types";
import { aggregateLabel, ratioLabel, type UserKpi } from "@/engine/kpi/userKpis";
import { Session, type ContextRequest } from "@/engine/session";
import { chartProblem, chartsUsingKpi } from "@/ui/workspace/customise/brokenCharts";
import {
  barCount,
  buildSpec,
  columnsOf,
  draftFromSpec,
  followSize,
  newDraft,
  sizeFor,
  type Draft,
} from "@/ui/workspace/customise/chartDraft";

const REQ: ContextRequest = { domainId: "ecommerce", numberLocale: "IN", currency: null };
const built = (d: Draft, ctx: Parameters<typeof buildSpec>[1], id: string): ChartSpec => {
  const out = buildSpec(d, ctx, id);
  expect(out.problem).toBeNull();
  return out.spec as ChartSpec;
};

describe("Edit data", () => {
  const s = new Session();
  s.ingestSample("ecommerce");
  const ctx = s.configure(REQ);
  const cols = columnsOf(ctx);
  const recommended = (id: string) => ctx.charts.find((c) => c.id === id) as ChartSpec;

  it("drops a recommended chart's own title, so the title follows the data", () => {
    const d = draftFromSpec(recommended("revenue_by_state"), { w: 6, h: 5 }, ctx);
    expect(d.title).toBe("");
    const orders = built({ ...d, measures: [{ kind: "kpi", id: "orders" }] }, ctx, "copy");
    expect(orders.title).toBe("Orders by customer state");
  });

  it("keeps a title the user typed: a rename, or a custom chart's own", () => {
    const renamed = draftFromSpec(
      recommended("revenue_by_state"),
      { w: 6, h: 5, title: "Where we sell" },
      ctx,
    );
    expect(renamed.title).toBe("Where we sell");
    const donut: Draft = {
      ...newDraft("donut", ctx, cols),
      axis: { type: "column", column: "Channel" },
      measures: [{ kind: "kpi", id: "net_revenue" }],
    };
    const auto = built(donut, ctx, "custom_a");
    expect(auto.title).toBe("Net revenue by channel");
    // Reopened and moved to Courier: the automatic title follows.
    const again = draftFromSpec(auto, undefined, ctx);
    expect(again.title).toBe("");
    expect(built({ ...again, axis: { type: "column", column: "Courier" } }, ctx, "custom_a").title).toBe(
      "Net revenue by courier",
    );
    // A typed title stays through the same change.
    const typed = draftFromSpec(built({ ...donut, title: "Channel mix" }, ctx, "custom_b"), undefined, ctx);
    expect(typed.title).toBe("Channel mix");
    expect(built({ ...typed, axis: { type: "column", column: "Courier" } }, ctx, "custom_b").title).toBe(
      "Channel mix",
    );
  });

  it("starts from the card as shown: its type and Top N", () => {
    const d = draftFromSpec(recommended("channel_mix"), { w: 4, h: 4, kind: "donut", topN: 5 }, ctx);
    expect([d.kind, d.topN]).toEqual(["donut", 5]);
    expect(buildSpec(d, ctx, "x").problem).toBeNull();
  });

  it("gives horizontal bars the height their number needs", () => {
    const hbar = newDraft("hbar", ctx, cols);
    // 123 product names: the default top 15 is drawn, which takes six rows.
    const products = followSize(hbar, { ...hbar, axis: { type: "column", column: "Product Name" } }, cols);
    expect(barCount(products, cols)).toBe(15);
    expect(products.h).toBe(6);
    expect(followSize(products, { ...products, topN: 10 }, cols).h).toBe(5);
    expect(followSize(products, { ...products, topN: 5 }, cols).h).toBe(4);
    // A height the user chose stays.
    expect(followSize({ ...products, h: 3 }, { ...products, h: 3, topN: 5 }, cols).h).toBe(3);
    // More than ten named columns are drawn sideways, so a column chart gets the room too.
    expect([sizeFor("bar", 15).h, sizeFor("bar", 8).h, sizeFor("line").h, sizeFor("bigNumber").h]).toEqual([
      6, 4, 4, 3,
    ]);
  });
});

describe("automatic names", () => {
  it("read columns with spaces, in sentence case", async () => {
    const lines = ["Order_ID,Order_Date,Product_Category,Customer_ID,Net_Sales"];
    for (let i = 0; i < 120; i++)
      lines.push(
        `O${1000 + i},2025-0${(i % 9) + 1}-1${i % 9},${["Toys", "Books", "Garden"][i % 3]},C${i % 40},${100 + i}`,
      );
    const s = new Session();
    const load = await s.ingest(new Blob([lines.join("\n")]), "sales_orders.csv", {});
    if (load.status !== "ok") throw new Error(load.status);
    const ctx = s.configure({ domainId: "generic", numberLocale: "INTL", currency: null });
    const cols = columnsOf(ctx);
    const spec = built(
      {
        ...newDraft("bar", ctx, cols),
        axis: { type: "column", column: "Product_Category" },
        split: null,
        measures: [{ kind: "column", column: "Net_Sales", agg: "sum" }],
      },
      ctx,
      "x",
    );
    expect(spec.title).toBe("Total net sales by product category");
    expect(spec.x.kind === "column" ? spec.x.label : "").toBe("Product Category");
    expect(spec.measures[0]?.label).toBe("Total net sales");
    // The KPIs the user builds are named the same way.
    expect(aggregateLabel({ agg: "countDistinct", column: "Customer_ID" })).toBe("Distinct customer ID");
    expect(aggregateLabel({ agg: "sum", column: "Total_Amount" })).toBe("Total amount");
    expect(aggregateLabel({ agg: "avg", column: "GST_Amount" })).toBe("Average GST amount");
    expect(
      ratioLabel({ agg: "sum", column: "Net_Sales" }, { agg: "countDistinct", column: "Order_ID" }),
    ).toBe("Total net sales ÷ distinct order ID");
  });
});

describe("charts that can't be drawn", () => {
  const kpi: UserKpi = {
    id: "uk_avg_ship",
    name: "Average shipping fee",
    value: { agg: "avg", column: "Shipping Fee" },
    format: "currency",
    direction: "neutral",
  };
  const s = new Session();
  s.ingestSample("ecommerce");
  const ctx = s.configure({ ...REQ, customKpis: [kpi] });
  const cols = columnsOf(ctx);
  const byChannel = built(
    {
      ...newDraft("donut", ctx, cols),
      axis: { type: "column", column: "Channel" },
      measures: [{ kind: "kpi", id: "net_revenue" }],
    },
    ctx,
    "custom_1",
  );
  const mine = built(
    {
      ...newDraft("bar", ctx, cols),
      axis: { type: "column", column: "Courier" },
      split: null,
      measures: [{ kind: "kpi", id: "uk_avg_ship" }],
    },
    ctx,
    "custom_2",
  );

  it("draw while everything they use is there", () => {
    expect(chartProblem(byChannel, ctx, [kpi])).toBeNull();
    expect(chartProblem(mine, ctx, [kpi])).toBeNull();
  });

  it("say which column was hidden", () => {
    const hidden = s.configure({ ...REQ, customKpis: [kpi], hiddenColumns: ["Channel"] });
    expect(chartProblem(byChannel, hidden, [kpi])).toMatch(/uses Channel, which you hid in Check & map/);
    // Recommended charts are rebuilt without it, so they are never flagged.
    for (const c of hidden.charts) expect(chartProblem(c, hidden, [kpi]), c.id).toBeNull();
    // A KPI whose column is hidden can't be computed: the chart names the column.
    const noFee = s.configure({ ...REQ, customKpis: [kpi], hiddenColumns: ["Shipping Fee"] });
    expect(chartProblem(mine, noFee, [kpi])).toMatch(
      /“Average shipping fee”, which reads Shipping Fee: you hid it/,
    );
  });

  it("say which KPI was deleted, and are found before it is", () => {
    expect(chartsUsingKpi([byChannel, mine], "uk_avg_ship").map((c) => c.id)).toEqual(["custom_2"]);
    const without = s.configure(REQ);
    expect(chartProblem(mine, without, [])).toMatch(/“Average shipping fee”, a KPI you deleted/);
    expect(chartProblem(byChannel, without, [])).toBeNull();
  });
});
