/**
 * Workspace store behaviour around datasets and saved configs
 * (src/store/workspace.ts), with the worker client replaced by a real Session
 * on this thread: a saved cross-filter comes back as a cross-filter that
 * still exempts its source chart, the saved currency is restored without a
 * stray override, an unknown trend grain is dropped, the business context is
 * reset for a new dataset, and "Start over" forgets everything, the last
 * file included. Hiding a column drops the filters on it, the hidden list is
 * saved and restored with a config, and a new dataset starts with none.
 */
import { describe, expect, it, vi } from "vitest";
import type { ContextRequest } from "@/engine/session";
import { fingerprintOf, parseConfig, type LoupeConfig } from "@/engine/export/config";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";

// Hoisted above the imports by vitest, so the store talks to this instead of a Web Worker.
vi.mock("@/lib/engine-client", async () => {
  const { Session } = await import("@/engine/session");
  let session = new Session();
  const api = {
    ingestSample: async (id: string) => session.ingestSample(id),
    configure: async (req: ContextRequest) => session.configure(req),
    begin: async () => {},
    // Dashboard refreshes are not under test; report them as superseded.
    computeDashboard: async () => ({ aborted: true, ms: 0, rows: 0 }),
    insights: async () => [],
  };
  return {
    engine: () => api,
    resetEngine: () => {
      session = new Session();
    },
    Comlink: { proxy: <T>(f: T): T => f },
  };
});

/** The same object the Export step's buildConfig() writes. */
function savedConfig(over: (cfg: LoupeConfig) => void = () => {}): LoupeConfig {
  const s = useWorkspace.getState();
  const settings = useSettings.getState();
  if (!s.summary || !s.profile || !s.domainId) throw new Error("nothing loaded");
  const cfg: LoupeConfig = {
    app: "loupe",
    version: 1,
    createdAt: new Date().toISOString(),
    fingerprint: fingerprintOf(
      s.summary.fileName,
      s.summary.rowCount,
      s.profile.columns.map((c) => ({ name: c.name, type: c.storage })),
    ),
    domainId: s.domainId,
    subDomainId: s.subDomainId ?? undefined,
    business: s.business,
    mappingOverrides: s.mappingOverrides,
    classOverrides: s.classOverrides,
    roleOverrides: s.roleOverrides,
    hiddenColumns: s.hiddenColumns,
    kpiRenames: s.kpiRenames,
    kpiTargets: s.kpiTargets,
    dashboard: {
      mode: s.mode,
      widgets: s.widgets.map((w) => ({
        id: w.id,
        kind: w.kind,
        w: w.w,
        h: w.h,
        hidden: w.hidden,
        topN: w.topN,
      })),
      customCharts: s.customCharts,
      datePreset: s.datePreset,
      filters: s.filters(),
    },
    settings: {
      numberLocale: settings.numberLocale,
      currency: settings.currencyOverride ?? s.context?.currency ?? "INR",
    },
  };
  over(cfg);
  // Through JSON and the zod schema, exactly as a loaded file would be.
  const parsed = parseConfig(JSON.stringify(cfg));
  if (!parsed.config) throw new Error(parsed.error);
  return parsed.config;
}

async function loadDemo(): Promise<void> {
  await useWorkspace.getState().loadSample("ecommerce");
  const s = useWorkspace.getState();
  await s.confirmDomain(s.domainId as string, s.subDomainId);
  if (!useWorkspace.getState().context) throw new Error(`configure failed: ${useWorkspace.getState().error}`);
}

describe("saved configs", () => {
  it("restore a cross-filter with its source chart, and other filters as plain dimension filters", async () => {
    await loadDemo();
    const s = useWorkspace.getState();
    const source = s.context?.charts.find((c) => c.id === "revenue_by_category");
    expect(source).toBeDefined();
    s.setDimFilter("Channel", ["Website"]);
    s.setCrossFilter("revenue_by_category", "Category", "Electronics");
    const tagged = useWorkspace.getState().filters().at(-1);
    expect(tagged).toEqual({
      kind: "in",
      column: "Category",
      values: ["Electronics"],
      sourceId: "revenue_by_category",
    });

    const cfg = savedConfig();
    useWorkspace.getState().clearFilters();
    expect(useWorkspace.getState().crossFilter).toBeNull();

    await useWorkspace.getState().applyConfig(cfg);
    const after = useWorkspace.getState();
    expect(after.crossFilter).toEqual({
      column: "Category",
      value: "Electronics",
      sourceId: "revenue_by_category",
    });
    expect(after.dimFilters).toEqual([{ kind: "in", column: "Channel", values: ["Website"] }]);
    expect(after.filters().filter((f) => "sourceId" in f)).toHaveLength(1);
  });

  it("restore the saved currency, without leaving an override when it matches detection", async () => {
    await loadDemo();
    const detected = useWorkspace.getState().profile?.currency.code;
    expect(detected).toBe("INR");
    useSettings.getState().setCurrencyOverride(null);

    await useWorkspace.getState().applyConfig(savedConfig((c) => (c.settings.currency = "USD")));
    expect(useSettings.getState().currencyOverride).toBe("USD");
    expect(useWorkspace.getState().context?.currency).toBe("USD");

    await useWorkspace.getState().applyConfig(savedConfig((c) => (c.settings.currency = "INR")));
    expect(useSettings.getState().currencyOverride).toBeNull();
    expect(useWorkspace.getState().context?.currency).toBe("INR");

    // A code the app does not offer is not applied: it would be printed in every figure.
    await useWorkspace
      .getState()
      .applyConfig(savedConfig((c) => (c.settings.currency = "<img src=x onerror=alert(1)>")));
    expect(useSettings.getState().currencyOverride).toBeNull();
  });

  it("keep only a known trend grain", async () => {
    await loadDemo();
    await useWorkspace
      .getState()
      .applyConfig(savedConfig((c) => (c.business = { period: "week", notes: "kept" })));
    expect(useWorkspace.getState().business).toMatchObject({ period: "week", notes: "kept" });
    await useWorkspace.getState().applyConfig(savedConfig((c) => (c.business = { period: "fortnight" })));
    expect(useWorkspace.getState().business.period).toBeUndefined();
  });
});

describe("hidden columns", () => {
  /** Waits for the reconfigure that setColumnsHidden starts, until the analysis has `names` hidden. */
  const appliedHidden = (names: string[]) =>
    vi.waitFor(() =>
      expect([...(useWorkspace.getState().context?.hiddenColumns ?? [])].sort()).toEqual([...names].sort()),
    );

  it("hiding a column drops its filters and takes it out of the analysis", async () => {
    await loadDemo();
    const s = useWorkspace.getState();
    s.setDimFilter("Channel", ["Website"]);
    s.setCrossFilter("revenue_by_category", "Category", "Electronics");
    s.setColumnsHidden(["Channel", "Category"], true);
    expect(useWorkspace.getState().dimFilters).toEqual([]);
    expect(useWorkspace.getState().crossFilter).toBeNull();
    await appliedHidden(["Channel", "Category"]);
    const ctx = useWorkspace.getState().context;
    expect(ctx?.profile.columns.some((c) => c.name === "Channel" || c.name === "Category")).toBe(false);
    expect(ctx?.dimensions.some((d) => d.column === "Channel" || d.column === "Category")).toBe(false);
    // Showing one again brings it back.
    useWorkspace.getState().setColumnsHidden(["Channel"], false);
    await appliedHidden(["Category"]);
    expect(useWorkspace.getState().context?.dimensions.some((d) => d.column === "Channel")).toBe(true);
  });

  it("are saved with a config and restored from it; a new dataset starts with none", async () => {
    await loadDemo();
    useWorkspace.getState().setColumnsHidden(["Channel"], true);
    await appliedHidden(["Channel"]);
    const cfg = savedConfig();
    expect(cfg.hiddenColumns).toEqual(["Channel"]);
    useWorkspace.getState().setColumnsHidden(["Channel"], false);
    await appliedHidden([]);
    await useWorkspace.getState().applyConfig(cfg);
    expect(useWorkspace.getState().hiddenColumns).toEqual(["Channel"]);
    expect(useWorkspace.getState().context?.hiddenColumns).toEqual(["Channel"]);
    // A config saved before hiding existed has no list: nothing is hidden.
    const { hiddenColumns: _omit, ...older } = cfg;
    const parsed = parseConfig(JSON.stringify(older));
    expect(parsed.config?.hiddenColumns).toEqual([]);
    await useWorkspace.getState().loadSample("ecommerce");
    expect(useWorkspace.getState().hiddenColumns).toEqual([]);
    expect(useWorkspace.getState().replaced).toEqual([]);
  });
});

describe("datasets", () => {
  it("a new dataset starts with an empty business context", async () => {
    await loadDemo();
    useWorkspace.getState().setBusiness({ period: "quarter", goal: "growth" });
    await useWorkspace.getState().loadSample("ecommerce");
    expect(useWorkspace.getState().business).toEqual({});
  });

  it("a demo forgets the previously loaded file", async () => {
    useWorkspace.setState({ lastFile: new File(["a,b\n1,2"], "old.csv"), lastOptions: { sheet: "x" } });
    await useWorkspace.getState().loadSample("ecommerce");
    expect(useWorkspace.getState().lastFile).toBeNull();
    expect(useWorkspace.getState().lastOptions).toEqual({});
  });

  it("Start over returns the store to its initial state, the last file included", async () => {
    await loadDemo();
    useWorkspace.getState().setBusiness({ period: "week" });
    useWorkspace.setState({ lastFile: new File(["a"], "a.csv"), kpiTargets: { aov: 2000 } });
    useWorkspace.getState().startOver();
    const s = useWorkspace.getState();
    expect(s.step).toBe("upload");
    expect(s.lastFile).toBeNull();
    expect(s.business).toEqual({});
    expect(s.summary).toBeNull();
    expect(s.context).toBeNull();
    expect(s.kpiTargets).toEqual({});
    expect(s.widgets).toEqual([]);
    expect(s.crossFilter).toBeNull();
    expect(s.insightsLoading).toBe(false);
  });
});
