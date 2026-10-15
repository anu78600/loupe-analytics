/**
 * Dashboard row packing (src/ui/workspace/dashboard/layout.ts): every row
 * fills the 12 columns exactly (no holes), each chart gets at least the
 * width its kind needs at the grid's real width, the cards on a row share
 * one height, the order is kept, and a phone-sized grid shows one chart per
 * row.
 */
import { describe, expect, it } from "vitest";
import { packRows } from "@/ui/workspace/dashboard/layout";

const widget = (
  id: string,
  w: number,
  h: number,
  kind: "line" | "bar" | "donut" | "hbar" | "table" = "bar",
) => ({
  id,
  w,
  h,
  kind,
});

describe("packing dashboard rows", () => {
  it("fills every row exactly, with no holes", () => {
    // The layout from the user's screenshot: 8 + 4 on one row, then 6 + 4 + 4 that used to leave a gap.
    const rows = packRows(
      [
        widget("a", 8, 4, "line"),
        widget("b", 4, 4),
        widget("c", 6, 5, "hbar"),
        widget("d", 4, 5, "donut"),
        widget("e", 4, 5, "hbar"),
      ],
      1400,
    );
    for (const r of rows) expect(r.reduce((s, p) => s + p.span, 0)).toBe(12);
    expect(rows.flat().map((p) => p.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("keeps every chart at its readable width, side by side when two fit", () => {
    // At 900 px a column is about 64 px: a line chart and a donut both need 6 columns, so the
    // trend narrows from 8 to 6 and they share a row instead of each taking a whole one.
    const rows = packRows([widget("trend", 8, 4, "line"), widget("share", 4, 4, "donut")], 900);
    expect(rows.map((r) => r.map((p) => [p.id, p.span]))).toEqual([
      [
        ["trend", 6],
        ["share", 6],
      ],
    ]);
    // At 700 px they no longer both fit at a readable width, so the donut starts a new row.
    expect(packRows([widget("trend", 8, 4, "line"), widget("share", 4, 4, "donut")], 700)).toHaveLength(2);
    // A table designed full width keeps its own row.
    expect(packRows([widget("a", 6, 4), widget("t", 12, 6, "table")], 1400)).toHaveLength(2);
  });

  it("balances the last row instead of leaving one chart alone under a full row", () => {
    // At 1432 px three charts fit per row: four become two and two, five become three and two.
    const four = packRows(
      ["a", "b", "c", "d"].map((id) => widget(id, 6, 4)),
      1432,
    );
    expect(four.map((r) => r.length)).toEqual([2, 2]);
    const five = packRows(
      ["a", "b", "c", "d", "e"].map((id) => widget(id, 6, 4)),
      1432,
    );
    expect(five.map((r) => r.length)).toEqual([3, 2]);
    for (const r of [...four, ...five]) expect(r.reduce((s, p) => s + p.span, 0)).toBe(12);
  });

  it("balances the rows before a full-width table too", () => {
    // Seven charts then a full-width table: 3 + 2 + 2, then the table, never a chart left alone mid-page.
    const items = [
      ...["a", "b", "c", "d", "e", "f", "g"].map((id) => widget(id, 6, 4)),
      widget("t", 12, 6, "table"),
    ];
    expect(packRows(items, 1432).map((r) => r.length)).toEqual([3, 2, 2, 1]);
  });

  it("lines up the cards of a row at the tallest height", () => {
    const rows = packRows([widget("a", 6, 4), widget("b", 6, 5)], 1400);
    expect(rows[0]?.map((p) => p.h)).toEqual([5, 5]);
  });

  it("shows one chart per row on a narrow screen", () => {
    const rows = packRows([widget("a", 4, 4), widget("b", 4, 4), widget("c", 4, 4)], 500);
    expect(rows.map((r) => r.map((p) => p.span))).toEqual([[12], [12], [12]]);
  });
});
