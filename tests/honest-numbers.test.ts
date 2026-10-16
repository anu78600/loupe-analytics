/**
 * Small rules that keep figures honest across the app and its exports
 * (version 34.1): a change that prints as 0.0% is neutral rather than bad
 * news, the grain reads the same on the dashboard and in the data
 * dictionary, and a CSV meant for a spreadsheet starts with the UTF-8
 * byte-order mark Excel needs. The bigger 34.1 fixes are tested where they
 * live: the KPI card's SQL in questions.test.ts, percentage points in
 * consistency.test.ts and export.test.ts, "revenue" read as the Net revenue
 * KPI in questions.test.ts.
 */
import { describe, expect, it } from "vitest";
import { formatDelta, formatPointDelta, isFlatChange } from "@/engine/core/format";
import { grainLabel } from "@/engine/profile/structure";
import { UTF8_BOM } from "@/engine/export/csv";
import { Session } from "@/engine/session";

describe("a change that shows as zero", () => {
  it("is flat exactly when it prints as 0.0% or 0.0 pp", () => {
    for (const x of [0, 0.0004, -0.0004]) {
      expect(isFlatChange(x)).toBe(true);
      expect(formatDelta(x)).toBe("0.0%");
      expect(formatPointDelta(x)).toBe("0.0 pp");
    }
    for (const x of [0.0006, -0.0006]) {
      expect(isFlatChange(x)).toBe(false);
      expect(formatDelta(x)).not.toBe("0.0%");
      expect(formatPointDelta(x)).not.toBe("0.0 pp");
    }
  });
});

describe("the grain", () => {
  it("is the detected key when there is a real one, else the template's", () => {
    const key = (description: string, confidence = 0.9) => ({ columns: ["k"], description, confidence });
    expect(grainLabel(key("One row per order"), "order line")).toBe("One row per order");
    // A key that only numbers the rows says nothing about what a row is.
    expect(grainLabel(key("One row per row"), "order line")).toBe("One row per order line");
    expect(grainLabel(key("No unique key found: each row is likely an event", 0.35), "invoice line")).toBe(
      "One row per invoice line",
    );
    // With no template (the generic layout) the detected wording stands.
    expect(grainLabel(key("No unique key found: each row is likely an event", 0.35))).toBe(
      "No unique key found: each row is likely an event",
    );
  });

  it("reads the same on the dashboard and in the data dictionary", () => {
    for (const id of ["ecommerce", "sales"]) {
      const s = new Session();
      const load = s.ingestSample(id);
      if (load.status !== "ok") throw new Error(load.status);
      const top = load.detection.candidates[0];
      if (!top) throw new Error("not detected");
      const ctx = s.configure({ domainId: top.domainId, numberLocale: "INTL", currency: null });
      expect(s.exportDictionary("md"), id).toContain(` · ${ctx.grainLabel} · `);
    }
  });
});

describe("CSVs for a spreadsheet", () => {
  it("start with the UTF-8 byte-order mark", () => {
    expect([...new TextEncoder().encode(UTF8_BOM)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});
