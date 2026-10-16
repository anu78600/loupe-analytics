/**
 * Workspace store flows the upload audit found broken (src/store/workspace.ts),
 * with the worker client replaced by a real Session on this thread that
 * behaves like the worker: a progress message can arrive after the load's
 * result, and a dashboard refresh takes time. Covered: a late progress
 * message never reopens the loading state; reading dates the other way keeps
 * the user's settings and step; an industry chosen on Detect is built when
 * the user moves on, never later by surprise; confirming the same industry
 * keeps the layout; unproven dates follow where the user is, not the last
 * file; a currency belongs to its file; insights wait for the refresh that
 * the selection started; questions survive a Check & map change.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartRequest, ContextRequest, DashboardRequest, QuestionRequest } from "@/engine/session";
import type { IngestOptions } from "@/engine/core/types";
import type { IngestProgress } from "@/engine/parse";
import type { NumberLocale } from "@/engine/core/format";
import type { ChartData } from "@/engine/charts/types";
import type { KpiBatch } from "@/engine/kpi/compute";
import { readQuestion, type AskContext } from "@/engine/charts/ask";
import { assumeDayFirst, choiceChanged, kpiLayoutOf, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";

const hooks = vi.hoisted(() => {
  // A browser's storage, holding settings an older version wrote with a currency in them.
  const stored = new Map<string, string>([
    [
      "loupe-settings",
      JSON.stringify({ state: { currencyOverride: "EUR", numberLocale: "IN" }, version: 0 }),
    ],
  ]);
  globalThis.localStorage = {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, String(v)),
    removeItem: (k: string) => void stored.delete(k),
    clear: () => stored.clear(),
    key: (i: number) => [...stored.keys()][i] ?? null,
    get length() {
      return stored.size;
    },
  };
  return {
    stored,
    /** Send one more progress message after the load has returned, as a separate channel can. */
    lateProgress: false,
    /** How long a dashboard refresh takes in the "worker". */
    computeMs: 0,
    /** What the "worker" did, in order. */
    log: [] as string[],
    /** The day/month preference each load was sent. */
    dayFirst: [] as Array<boolean | undefined>,
  };
});

vi.mock("@/lib/engine-client", async () => {
  const { Session } = await import("@/engine/session");
  let session = new Session();
  let latest = 0;
  const api = {
    ingest: async (file: File, opts: IngestOptions, onProgress?: (p: IngestProgress) => void) => {
      hooks.dayFirst.push(opts.preferDayFirst);
      const res = await session.ingest(file, file.name, opts, onProgress);
      if (hooks.lateProgress && onProgress)
        setTimeout(() => onProgress({ phase: "detecting", loadedBytes: 0, totalBytes: 0, rows: 0 }), 0);
      return res;
    },
    ingestSample: async (id: string) => session.ingestSample(id),
    configure: async (req: ContextRequest) => session.configure(req),
    begin: async (id: number) => {
      latest = id;
    },
    // As the worker does: KPIs, then each chart, stopping when a newer request has begun.
    computeDashboard: async (
      req: DashboardRequest,
      id: number,
      onKpis?: (b: KpiBatch) => void,
      onChart?: (specId: string, d: ChartData) => void,
    ) => {
      latest = Math.max(latest, id);
      if (hooks.computeMs) await new Promise((r) => setTimeout(r, hooks.computeMs));
      onKpis?.(session.kpiBatch(req.filters, req.kpiIds, req.numberLocale));
      const rows = session.rowCount(req.filters);
      for (const c of req.charts as ChartRequest[]) {
        if (id !== latest) return { aborted: true, ms: 0, rows };
        const data = session.chart(req.filters, c, req.numberLocale);
        if (data) onChart?.(c.specId, data);
      }
      hooks.log.push(`computed ${req.filters.filter((f) => f.kind === "in").length} filters`);
      return { aborted: false, ms: 0, rows };
    },
    insights: async (locale: NumberLocale) => {
      hooks.log.push("insights");
      return session.insights(locale);
    },
    answerQuestion: async (req: QuestionRequest, locale: NumberLocale) => session.answerQuestion(req, locale),
  };
  return {
    engine: () => api,
    resetEngine: () => {
      session = new Session();
    },
    Comlink: { proxy: <T>(f: T): T => f },
  };
});

/** A small invoice file whose dates can be read either way (no day above 12). */
function invoices(): File {
  const lines = ["Invoice No,Invoice Date,Region,Amount,Units"];
  for (let i = 0; i < 120; i++)
    lines.push(
      `INV-${5000 + i},${1 + (i % 12)}/${1 + ((i * 5) % 12)}/2024,${["North", "South", "East", "West"][i % 4]},${(500 + ((i * 37) % 4500)).toFixed(2)},${1 + (i % 6)}`,
    );
  return new File([`${lines.join("\r\n")}\r\n`], "invoices.csv");
}

/** Lets queued timers and promise callbacks run. */
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** The currency override as the settings store came up from storage, before any test ran. */
const rehydratedCurrency = useSettings.getState().currencyOverride;

async function loadDemo(id = "ecommerce"): Promise<void> {
  await useWorkspace.getState().loadSample(id);
  const s = useWorkspace.getState();
  await s.confirmDomain(s.domainId as string, s.subDomainId);
  if (!useWorkspace.getState().context) throw new Error(`configure failed: ${useWorkspace.getState().error}`);
}

beforeEach(() => {
  hooks.lateProgress = false;
  hooks.computeMs = 0;
  hooks.log.length = 0;
  hooks.dayFirst.length = 0;
  useWorkspace.getState().startOver();
});

describe("loading", () => {
  it("ignores a progress message that arrives after the load's result", async () => {
    hooks.lateProgress = true;
    await useWorkspace.getState().loadFile(invoices());
    expect(useWorkspace.getState().step).toBe("detect");
    await settle();
    expect(useWorkspace.getState().loading).toBeNull();
  });

  it("assumes the day/month order from where the user is, never from the last file's number format", async () => {
    expect(assumeDayFirst("America/New_York")).toBe(false);
    expect(assumeDayFirst("Asia/Manila")).toBe(false);
    expect(assumeDayFirst("Asia/Kolkata")).toBe(true);
    expect(assumeDayFirst("Asia/Calcutta")).toBe(true);
    expect(assumeDayFirst("Europe/Berlin")).toBe(true);
    // A USD dataset switches the automatic number format to international; the next file reads the same.
    useSettings.getState().setNumberFormatAuto(true);
    useSettings.getState().applyAutoNumberLocale("USD");
    await useWorkspace.getState().loadFile(invoices());
    useSettings.getState().applyAutoNumberLocale("INR");
    await useWorkspace.getState().loadFile(invoices());
    expect(hooks.dayFirst).toEqual([assumeDayFirst(), assumeDayFirst()]);
  });

  it("drops the currency chosen for one file when another is loaded, on Start over, and from storage", async () => {
    // A currency an older version stored is not applied to whatever file comes next.
    expect(rehydratedCurrency).toBeNull();
    await loadDemo();
    useSettings.getState().setCurrencyOverride("EUR");
    await useWorkspace.getState().loadSample("hr");
    expect(useSettings.getState().currencyOverride).toBeNull();
    useSettings.getState().setCurrencyOverride("EUR");
    useWorkspace.getState().startOver();
    expect(useSettings.getState().currencyOverride).toBeNull();
    useSettings.getState().setCurrencyOverride("EUR");
    const saved = JSON.parse(hooks.stored.get("loupe-settings") ?? "{}") as {
      state?: Record<string, unknown>;
    };
    expect(saved.state).toBeDefined();
    expect(saved.state).not.toHaveProperty("currencyOverride");
    useSettings.getState().setCurrencyOverride(null);
  });

  it("opens a demo straight on the dashboard when asked", async () => {
    await useWorkspace.getState().loadSample("sales", { goTo: "dashboard" });
    const s = useWorkspace.getState();
    expect(s.step).toBe("dashboard");
    expect(s.context?.domain.id).toBe("sales");
    expect(s.summary?.sampleId).toBe("sales");
  });
});

describe("reading the dates the other way", () => {
  it("keeps the user's choices and step, and rebuilds the analysis with them", async () => {
    await useWorkspace.getState().loadFile(invoices());
    let s = useWorkspace.getState();
    expect(s.report?.dateFormats[0]).toMatchObject({ column: "Invoice Date", ambiguous: true });
    const domainId = s.domainId as string;
    await s.confirmDomain(domainId, s.subDomainId, { goTo: "map" });
    useWorkspace.getState().setColumnsHidden(["Units"], true);
    await vi.waitFor(() => expect(useWorkspace.getState().context?.hiddenColumns).toEqual(["Units"]));
    const layout = kpiLayoutOf(useWorkspace.getState());
    useWorkspace.getState().setKpiLayout({ ...layout, hero: [...layout.hero].reverse() });
    useWorkspace.getState().setMode("executive");
    useWorkspace.getState().setBusiness({ notes: "kept" });
    const ctx = useWorkspace.getState().context as AskContext;
    const q = readQuestion("Which region has the highest amount?", ctx);
    await useWorkspace.getState().askQuestion({
      question: "Which region has the highest amount?",
      understood: q.understood,
      notes: q.notes,
      ask: q.ask,
      order: q.order,
      scope: "file",
    });
    expect(useWorkspace.getState().questions).toHaveLength(1);

    const flip = s.report?.dateFormats[0]?.format === "DD/MM/YYYY" ? "MDY" : "DMY";
    await useWorkspace.getState().setDateOrder("Invoice Date", flip);
    s = useWorkspace.getState();
    expect(s.step).toBe("map");
    expect(s.loading).toBeNull();
    expect(s.report?.dateFormats[0]?.format).toBe(flip === "MDY" ? "MM/DD/YYYY" : "DD/MM/YYYY");
    expect(s.domainId).toBe(domainId);
    expect(s.hiddenColumns).toEqual(["Units"]);
    expect(s.context?.hiddenColumns).toEqual(["Units"]);
    expect(s.kpiLayout?.hero).toEqual([...layout.hero].reverse());
    expect(s.mode).toBe("executive");
    expect(s.business.notes).toBe("kept");
    // The question is answered again on the new dates, not dropped.
    await vi.waitFor(() => expect(useWorkspace.getState().questionsLoading).toBe(false));
    expect(useWorkspace.getState().questions).toHaveLength(1);
    expect(useWorkspace.getState().questions[0]?.error).toBeUndefined();
  });
});

describe("the industry chosen on Detect", () => {
  it("is built when the user moves on through the step bar, not ignored", async () => {
    await loadDemo("ecommerce");
    useWorkspace.getState().setStep("detect");
    useWorkspace.setState({ domainId: "hr", subDomainId: null });
    expect(choiceChanged(useWorkspace.getState())).toBe(true);
    useWorkspace.getState().setStep("dashboard");
    await vi.waitFor(() => expect(useWorkspace.getState().context?.domain.id).toBe("hr"));
    expect(useWorkspace.getState().step).toBe("dashboard");
    expect(choiceChanged(useWorkspace.getState())).toBe(false);
  });

  it("is never slipped in by an unrelated rebuild (a currency change)", async () => {
    await loadDemo("ecommerce");
    useWorkspace.getState().setKpiLayout({
      hero: kpiLayoutOf(useWorkspace.getState()).hero.slice(0, 2),
      supporting: [],
      columns: [],
    });
    useWorkspace.getState().setStep("detect");
    useWorkspace.setState({ domainId: "hr", subDomainId: null });
    await useWorkspace.getState().reconfigure();
    const s = useWorkspace.getState();
    // Built as confirming builds it: from the new industry's recommendation, on the same step.
    expect(s.context?.domain.id).toBe("hr");
    expect(s.kpiLayout).toBeNull();
    expect(s.step).toBe("detect");
  });

  it("keeps the layout and mode when the same industry is confirmed again, and resets them for another", async () => {
    await loadDemo("ecommerce");
    const s = useWorkspace.getState();
    const hero = kpiLayoutOf(s).hero.slice(0, 2);
    s.setKpiLayout({ hero, supporting: [], columns: [] });
    s.setMode("executive");
    s.setDimFilter("Channel", ["Website"]);
    await s.confirmDomain(s.domainId as string, s.subDomainId, { goTo: "map" });
    let now = useWorkspace.getState();
    expect(now.kpiLayout?.hero).toEqual(hero);
    expect(now.mode).toBe("executive");
    expect(now.dimFilters).toHaveLength(1);
    await now.confirmDomain("sales", null, { goTo: "map" });
    now = useWorkspace.getState();
    expect(now.context?.domain.id).toBe("sales");
    expect(now.kpiLayout).toBeNull();
    expect(now.mode).toBe("analyst");
    expect(now.dimFilters).toEqual([]);
  });
});

describe("insights", () => {
  it("wait for the refresh a filter change started, showing as loading meanwhile", async () => {
    await loadDemo("ecommerce");
    hooks.computeMs = 60;
    await settle(200);
    hooks.log.length = 0;
    useWorkspace.getState().setDimFilter("Channel", ["Website"]);
    // What the Insights step does when its insights are cleared.
    const load = useWorkspace.getState().loadInsights();
    expect(useWorkspace.getState().insightsLoading).toBe(true);
    expect(useWorkspace.getState().insights).toBeNull();
    await load;
    expect(hooks.log).toEqual(["computed 1 filters", "insights"]);
    expect(useWorkspace.getState().insightsLoading).toBe(false);
    expect(useWorkspace.getState().insights).not.toBeNull();
  });
});

describe("questions", () => {
  it("are answered again after a Check & map change instead of being cleared", async () => {
    await loadDemo("ecommerce");
    const ctx = useWorkspace.getState().context as AskContext;
    const text = "Which category has the highest net revenue?";
    const q = readQuestion(text, ctx);
    await useWorkspace.getState().askQuestion({
      question: text,
      understood: q.understood,
      notes: q.notes,
      ask: q.ask,
      order: q.order,
      scope: "file",
    });
    const before = useWorkspace.getState().questions[0];
    expect(before?.error).toBeUndefined();
    const first = ctx.kpis.find((k) => k.available && !k.hidden);
    useWorkspace.getState().renameKpi(first?.id as string, "Renamed KPI");
    await vi.waitFor(() =>
      expect(useWorkspace.getState().context?.kpis.some((k) => k.name === "Renamed KPI")).toBe(true),
    );
    await vi.waitFor(() => expect(useWorkspace.getState().questionsLoading).toBe(false));
    const after = useWorkspace.getState().questions;
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(before?.id);
    expect(after[0]?.rows.length).toBe(before?.rows.length);
  });
});
