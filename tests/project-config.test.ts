/**
 * Saved projects (version 53.0) keep the dashboard's settings as a LoupeConfig
 * (store/config.ts buildConfig): the config parses back exactly, and it
 * carries the "Dates by" choice, which a reopened project applies again.
 */
import { describe, expect, it } from "vitest";
import { parseConfig, type LoupeConfig } from "@/engine/export/config";

const base: LoupeConfig = {
  app: "loupe",
  version: 1,
  createdAt: "2026-10-25T00:00:00.000Z",
  fingerprint: {
    fileName: "loans.csv",
    rowCount: 80,
    columns: [{ name: "issue_d", type: "date" }],
    hash: "x",
  },
  domainId: "generic",
  mappingOverrides: {},
  classOverrides: {},
  hiddenColumns: [],
  customKpis: [],
  roleOverrides: {},
  kpiRenames: {},
  kpiTargets: {},
  dashboard: { mode: "compact", view: "full", widgets: [], customCharts: [], datePreset: "all", filters: [] },
  settings: { numberLocale: "IN", currency: "" },
};

describe("a project's saved settings", () => {
  it("parse back exactly, with the date chosen by “Dates by”", () => {
    const saved = { ...base, primaryDate: "earliest_cr_line" };
    const { config, error } = parseConfig(JSON.stringify(saved));
    expect(error).toBeUndefined();
    expect(config?.primaryDate).toBe("earliest_cr_line");
    expect(config?.dashboard.mode).toBe("compact");
    expect(config?.settings.currency).toBe("");
  });

  it("still read a config saved before “Dates by” existed", () => {
    const { config } = parseConfig(JSON.stringify(base));
    expect(config?.primaryDate).toBeUndefined();
  });
});
