"use client";

/**
 * The workspace state machine (Zustand, main thread, not persisted): the six
 * steps Upload → Detect & confirm → Map → Dashboard → Insights → Export, the
 * user's overrides, the dashboard layout and filters, and the latest results
 * streamed back from the engine worker.
 *
 * The store never holds the dataset itself, only small results; every
 * computation goes through engine(). Three kinds of change, three paths:
 *  - Mapping, value-class, role, sub-domain and KPI-name changes call
 *    reconfigure(): the worker rebuilds the whole analysis context (KPI
 *    resolution, chart specs, SQL/DAX), then the dashboard refreshes.
 *  - Filter, drill, mode and widget changes call refresh(): a 90 ms
 *    debounced recompute of KPIs and visible charts; superseded requests are
 *    aborted in the worker and their late results ignored here.
 *  - Purely visual changes (selection, highlight, resizing, KPI targets)
 *    touch no engine state.
 * Everything derived from a dataset (including the business context, whose
 * `period` sets the trend grain) is reset when a new dataset is adopted, and
 * "Start over" returns the whole store to its initial state.
 */
import { create } from "zustand";
import { Comlink, engine, resetEngine } from "@/lib/engine-client";
import { formatCount, SUPPORTED_CURRENCIES } from "@/engine/core/format";
import type { IngestOptions, LargeFileAssessment, ParseReport } from "@/engine/core/types";
import type { HealthReport } from "@/engine/profile/quality";
import type { DatasetProfile, SemanticRole, Additivity } from "@/engine/profile/types";
import type { DetectionResult } from "@/engine/detect/detect";
import type { ContextResult, DatasetSummary, DomainListItem, LoadResult } from "@/engine/session";
import type { KpiBatch } from "@/engine/kpi/compute";
import type { ChartData, ChartKind, ChartSpec, LayoutMode } from "@/engine/charts/types";
import type { Filter } from "@/engine/query/filter";
import type { Insight } from "@/engine/insights/insights";
import type { IngestProgress } from "@/engine/parse";
import type { LoupeConfig } from "@/engine/export/config";
import { defaultPreset, presetRange, type DatePreset } from "@/engine/core/periods";
import { useSettings } from "./settings";

export type Step = "upload" | "detect" | "map" | "dashboard" | "insights" | "export";
export const STEPS: Array<{ id: Step; label: string }> = [
  { id: "upload", label: "Upload" },
  { id: "detect", label: "Detect & confirm" },
  { id: "map", label: "Map columns" },
  { id: "dashboard", label: "Dashboard" },
  { id: "insights", label: "Insights" },
  { id: "export", label: "Export" },
];

/**
 * Optional context the user gives about the business. `period` doubles as
 * the trend grain sent with every chart request ("day" … "quarter").
 */
export interface BusinessContext {
  model?: string;
  goal?: string;
  period?: string;
  notes?: string;
}

/** Trend grains `BusinessContext.period` may hold; anything else means "auto". */
const PERIOD_GRAINS = ["day", "week", "month", "quarter"] as const;
type PeriodGrain = (typeof PERIOD_GRAINS)[number];
const isPeriodGrain = (v: unknown): v is PeriodGrain =>
  typeof v === "string" && (PERIOD_GRAINS as readonly string[]).includes(v);

/**
 * A dashboard filter as filters() returns it. The cross-filter also names the
 * chart it came from (`sourceId`): that chart shows every category and
 * highlights the chosen one instead of filtering itself. The tag survives a
 * saved config, so a restored cross-filter keeps that exclusion. The engine
 * ignores the extra field.
 */
export type DashboardFilter = Filter | (Extract<Filter, { kind: "in" }> & { sourceId: string });

/** A chart's slot on the dashboard: spec id, grid size and per-chart overrides. */
export interface Widget {
  /** Chart spec id (built-in or custom). */
  id: string;
  w: number;
  h: number;
  /** Alternative chart kind; undefined means the spec's recommended kind. */
  kind?: ChartKind;
  topN?: number;
  /** Hidden widgets are skipped by refresh(), so their data goes stale until shown again. */
  hidden?: boolean;
}

/** Progress overlay state while loading, profiling or configuring. */
export interface LoadingState {
  phase: IngestProgress["phase"] | "generating" | "configuring";
  title: string;
  detail?: string;
  /** Percent (0–99) while reading or parsing a file; null = indeterminate. */
  progress: number | null;
  fileName?: string;
}

interface WorkspaceState {
  step: Step;
  loading: LoadingState | null;
  error: string | null;
  /** File waiting on a user decision (sheet choice or large-file mode). */
  pendingFile: File | null;
  /** Last successfully loaded file and options, kept so it can be re-parsed (e.g. a date-order fix). */
  lastFile: File | null;
  lastOptions: IngestOptions;
  /** Sheet names to choose from; non-null only while a workbook awaits a choice. */
  sheets: string[] | null;
  /** Set while a large file awaits the user's sampling decision. */
  largeFile: LargeFileAssessment | null;

  summary: DatasetSummary | null;
  report: ParseReport | null;
  profile: DatasetProfile | null;
  health: HealthReport | null;
  detection: DetectionResult | null;
  domains: DomainListItem[];
  timings: Record<string, number>;

  /** Chosen domain; preset from detection ("generic" below 35% confidence). */
  domainId: string | null;
  subDomainId: string | null;
  business: BusinessContext;
  // Overrides sent to the worker on every configure (see ContextRequest).
  mappingOverrides: Record<string, string | null>;
  classOverrides: Record<string, string[]>;
  roleOverrides: Record<string, { role: SemanticRole; additivity?: Additivity }>;
  kpiRenames: Record<string, string>;
  /** UI-only KPI targets; never sent to the engine. */
  kpiTargets: Record<string, number>;
  /** Result of the last configure(); null until a domain is confirmed. */
  context: ContextResult | null;
  configuring: boolean;

  /** Layout mode; a chart is shown only when its spec lists this mode. */
  mode: LayoutMode;
  /** Dashboard order and sizes; also the order of the Power BI visual list. */
  widgets: Widget[];
  /** User-built charts. The worker does not know them, so their full spec is sent with each request. */
  customCharts: ChartSpec[];
  datePreset: DatePreset;
  /** Explicit range, used only when datePreset is "custom" (wall-clock epoch ms). */
  customRange: { from: number; to: number } | null;
  /** "in" filters from the filter rail, at most one per column. */
  dimFilters: Filter[];
  /** Click-to-filter from a chart; applies to every chart except `sourceId`, which highlights instead. */
  crossFilter: { column: string; value: string; sourceId: string } | null;
  /** Spec id → values clicked at each drill level. */
  drill: Record<string, string[]>;
  /** KPIs the user added beyond hero and supporting. */
  extraKpis: string[];

  // Latest results streamed from the worker.
  kpiBatch: KpiBatch | null;
  /** Spec id → data. Charts no longer requested keep their last data. */
  charts: Record<string, ChartData>;
  computing: boolean;
  lastCompute: { ms: number; rows: number } | null;
  /** null = not computed for the current filters; cleared whenever filters change. */
  insights: Insight[] | null;
  insightsLoading: boolean;
  /** What the inspector panel is editing. */
  selected: { type: "chart" | "kpi"; id: string } | null;
  /** Spec id briefly outlined after focusChart(). */
  highlight: string | null;

  // actions
  /** Navigating to Dashboard/Insights/Export before a domain is configured confirms the current domain first. */
  setStep: (step: Step) => void;
  /** Parses a file in the worker. Day-first dates are preferred under the Indian number format unless `opts` says otherwise. */
  loadFile: (file: File, opts?: IngestOptions) => Promise<void>;
  loadSample: (id: string) => Promise<void>;
  /** Re-parses the last file with a day/month order fixed for one column; overrides and layout reset. */
  setDateOrder: (column: string, order: "DMY" | "MDY") => Promise<void>;
  chooseSheet: (sheet: string) => Promise<void>;
  /** Loads the pending large file with the chosen sampling options; null cancels. */
  resolveLargeFile: (opts: IngestOptions | null) => Promise<void>;
  /** Replaces the dataset with its long (unpivoted) form; overrides and layout reset. */
  unpivot: () => Promise<void>;
  /** Terminates the worker (freeing the dataset), forgets the last file and returns the whole store to its initial state. */
  startOver: () => void;
  /** Configures the domain, resets filters, drill and mode, then refreshes. Errors land in `error`; it does not throw. */
  confirmDomain: (domainId: string, subDomainId?: string | null, opts?: { goTo?: Step }) => Promise<void>;
  /** Refreshes only when `period` (the trend grain) is part of the patch. */
  setBusiness: (patch: Partial<BusinessContext>) => void;
  // setMappingOverride, setClassOverride, setRoleOverride, renameKpi and setSubDomain each trigger reconfigure().
  setMappingOverride: (fieldId: string, column: string | null) => void;
  setClassOverride: (key: string, values: string[]) => void;
  /** null removes the override, restoring the detected role. */
  setRoleOverride: (column: string, role: SemanticRole | null, additivity?: Additivity) => void;
  renameKpi: (id: string, name: string) => void;
  /** null or a non-finite value clears the target. No refresh: targets are display-only. */
  setTarget: (id: string, value: number | null) => void;
  setSubDomain: (id: string) => void;
  /** Re-runs configure in the worker with the current overrides, keeping the layout of known charts. */
  reconfigure: () => Promise<void>;
  setMode: (mode: LayoutMode) => void;
  /** `custom` is used only with the "custom" preset. */
  setDatePreset: (preset: DatePreset, custom?: { from: number; to: number }) => void;
  /** Replaces the column's filter; an empty list removes it. */
  setDimFilter: (column: string, values: string[]) => void;
  /** Toggles: the same column and value again (or null) clears the cross-filter. */
  setCrossFilter: (sourceId: string, column: string, value: string | null) => void;
  /** Clears dimension filters, cross-filter and drill, and restores the default date preset. */
  clearFilters: () => void;
  drillDown: (specId: string, value: string) => void;
  drillUp: (specId: string, levels?: number) => void;
  /** Refreshes only when the patch changes computed data (kind, top N, or un-hiding). */
  updateWidget: (id: string, patch: Partial<Widget>) => void;
  /** Drag-and-drop reorder: widget `from` takes the index widget `to` had. */
  moveWidget: (from: string, to: string) => void;
  addCustomChart: (spec: ChartSpec) => void;
  /** Custom charts are deleted; built-in charts are only hidden, so they can come back. */
  removeChart: (id: string) => void;
  toggleExtraKpi: (id: string) => void;
  select: (sel: WorkspaceState["selected"]) => void;
  /** Switches to the dashboard, scrolls the chart into view and outlines it briefly. */
  focusChart: (id: string) => void;
  /** Debounced (90 ms) recompute of KPIs and visible charts; see the implementation for the abort protocol. */
  refresh: () => void;
  /** Insights are computed from the worker's last refresh results, so call after refresh(). */
  loadInsights: () => Promise<void>;
  /** Restores a saved config onto the loaded file. Check the fingerprint first; this does not. */
  applyConfig: (cfg: LoupeConfig) => Promise<void>;
  /** Effective filter list: date range, dimension filters, then the cross-filter (tagged with its source chart). */
  filters: () => DashboardFilter[];
}

/** The store's data without its actions: what a new store starts with and "Start over" returns to. */
type WorkspaceData = {
  [
    K in keyof WorkspaceState as WorkspaceState[K] extends (...args: never[]) => unknown ? never : K
  ]: WorkspaceState[K];
};

/** Fresh initial data (new objects every call, so a reset never shares state with an earlier session). */
function initialData(): WorkspaceData {
  return {
    step: "upload",
    loading: null,
    error: null,
    pendingFile: null,
    lastFile: null,
    lastOptions: {},
    sheets: null,
    largeFile: null,
    summary: null,
    report: null,
    profile: null,
    health: null,
    detection: null,
    domains: [],
    timings: {},
    domainId: null,
    subDomainId: null,
    business: {},
    mappingOverrides: {},
    classOverrides: {},
    roleOverrides: {},
    kpiRenames: {},
    kpiTargets: {},
    context: null,
    configuring: false,
    mode: "analyst",
    widgets: [],
    customCharts: [],
    datePreset: "all",
    customRange: null,
    dimFilters: [],
    crossFilter: null,
    drill: {},
    extraKpis: [],
    kpiBatch: null,
    charts: {},
    computing: false,
    lastCompute: null,
    insights: null,
    insightsLoading: false,
    selected: null,
    highlight: null,
  };
}

/** A saved filter as a plain engine filter: the cross-filter tag is dropped. */
function plainFilter(f: LoupeConfig["dashboard"]["filters"][number]): Filter {
  if (f.kind !== "in") return f;
  const { sourceId: _source, ...plain } = f;
  return plain;
}

/** Id of the newest dashboard request; results tagged with an older id are dropped. */
let requestSeq = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

const PHASE_TITLE: Record<string, string> = {
  reading: "Reading file",
  parsing: "Parsing rows",
  finalizing: "Finalising columns",
  profiling: "Profiling columns",
  detecting: "Detecting the industry",
  generating: "Generating demo data",
  configuring: "Building your dashboard",
};

/** One widget per spec, in spec order; widgets already known keep their size and overrides. */
function widgetsFor(specs: ChartSpec[], previous: Widget[] = []): Widget[] {
  const prev = new Map(previous.map((w) => [w.id, w]));
  return specs.map((s) => prev.get(s.id) ?? { id: s.id, w: s.size.w, h: s.size.h });
}

const toError = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error:\s*/, "");

/** True when the active business area is a roster (one row per employee, customer, …); see SubDomainDef.timeModel. */
export function isRosterView(ctx: ContextResult | null): boolean {
  return ctx?.domain.subDomains.find((s) => s.id === ctx.subDomainId)?.timeModel === "roster";
}

/** Roster data opens on the whole file (a date range there selects a cohort); event data on recent activity. */
function defaultPresetFor(ctx: ContextResult | null): DatePreset {
  return isRosterView(ctx) ? "all" : defaultPreset(ctx?.dateBounds ?? null);
}

export const useWorkspace = create<WorkspaceState>()((set, get) => {
  // Applies a LoadResult: either parks the file for a user decision, or
  // adopts the new dataset and resets everything derived from the old one,
  // the business context included (its period would otherwise set the trend
  // grain of an unrelated dataset).
  const handleLoad = (res: LoadResult, file: File | null) => {
    if (res.status === "needs-sheet") {
      set({ loading: null, sheets: res.sheets, pendingFile: file });
      return;
    }
    if (res.status === "needs-decision") {
      set({ loading: null, largeFile: res.assessment, pendingFile: file });
      return;
    }
    const top = res.detection.candidates[0];
    set({
      loading: null,
      error: null,
      sheets: null,
      largeFile: null,
      summary: res.summary,
      report: res.report,
      profile: res.profile,
      health: res.health,
      detection: res.detection,
      domains: res.domains,
      timings: res.timings,
      domainId: top && top.confidence >= 35 ? top.domainId : "generic",
      subDomainId: top?.subDomain.id ?? null,
      business: {},
      mappingOverrides: {},
      classOverrides: {},
      roleOverrides: {},
      kpiRenames: {},
      kpiTargets: {},
      context: null,
      charts: {},
      kpiBatch: null,
      insights: null,
      dimFilters: [],
      crossFilter: null,
      drill: {},
      customCharts: [],
      extraKpis: [],
      selected: null,
      step: "detect",
    });
  };

  // Wrapped in Comlink.proxy so the worker can call back across the thread boundary.
  // Row counts follow the number-format setting (Indian or international grouping).
  const onProgress = (fileName: string) =>
    Comlink.proxy((p: IngestProgress) => {
      const rows = formatCount(p.rows, useSettings.getState().numberLocale);
      const pct =
        p.totalBytes > 0 && (p.phase === "parsing" || p.phase === "reading")
          ? Math.min(99, (p.loadedBytes / p.totalBytes) * 100)
          : null;
      const detail =
        p.phase === "parsing"
          ? `${rows} rows so far`
          : p.phase === "profiling"
            ? `${rows} rows · types, roles, keys and hierarchies`
            : p.phase === "detecting"
              ? "Scoring 16 industries against your columns"
              : undefined;
      set({
        loading: {
          phase: p.phase,
          title: `${PHASE_TITLE[p.phase] ?? "Working"}${p.phase === "profiling" ? ` ${rows} rows` : ""}…`,
          detail,
          progress: pct,
          fileName,
        },
      });
    });

  // Sends the current overrides to the worker and stores the new context.
  // Sets `error` and rethrows on failure, so callers can stop their flow.
  const configureNow = async (domainId: string, subDomainId: string | null) => {
    const s = get();
    // Automatic number format follows the dataset's currency (lakh/crore for INR, K/M/B otherwise),
    // resolved before configuring so the worker formats with it from the start.
    useSettings
      .getState()
      .applyAutoNumberLocale(useSettings.getState().currencyOverride ?? s.profile?.currency.code ?? "INR");
    const settings = useSettings.getState();
    set({ configuring: true });
    try {
      const context = await engine().configure({
        domainId,
        subDomainId: subDomainId ?? undefined,
        mappingOverrides: s.mappingOverrides,
        classOverrides: s.classOverrides,
        roleOverrides: s.roleOverrides,
        kpiRenames: s.kpiRenames,
        numberLocale: settings.numberLocale,
        currency: settings.currencyOverride,
      });
      const specs = [...context.charts, ...s.customCharts];
      // Reconfiguring keeps the user's layout; the first configure after a
      // load starts from the specs' default sizes.
      set({
        context,
        configuring: false,
        domainId,
        subDomainId: context.subDomainId,
        widgets: widgetsFor(specs, s.context ? s.widgets : []),
      });
    } catch (e) {
      set({ configuring: false, error: toError(e) });
      throw e;
    }
  };

  return {
    ...initialData(),

    setStep: (step) => {
      const s = get();
      if ((step === "dashboard" || step === "insights" || step === "export") && !s.context && s.domainId) {
        void get().confirmDomain(s.domainId, s.subDomainId, { goTo: step });
        return;
      }
      set({ step });
      if (step === "insights" && !s.insights) void get().loadInsights();
    },

    loadFile: async (file, opts = {}) => {
      set({
        loading: { phase: "reading", title: "Reading file…", progress: 0, fileName: file.name },
        error: null,
      });
      try {
        const merged: IngestOptions = {
          preferDayFirst: useSettings.getState().numberLocale === "IN",
          ...opts,
        };
        const res = await engine().ingest(file, merged, onProgress(file.name));
        if (res.status === "ok") set({ lastFile: file, lastOptions: merged });
        handleLoad(res, file);
      } catch (e) {
        set({ loading: null, error: toError(e) });
      }
    },

    loadSample: async (id) => {
      set({
        loading: {
          phase: "generating",
          title: "Generating demo data…",
          detail: "Deterministic, seeded and clearly labelled as demo",
          progress: null,
        },
        error: null,
      });
      try {
        const res = await engine().ingestSample(id);
        // A demo has no file to re-parse: forget any earlier one, or a date-order fix would reload it.
        if (res.status === "ok") set({ lastFile: null, lastOptions: {} });
        handleLoad(res, null);
      } catch (e) {
        set({ loading: null, error: toError(e) });
      }
    },

    setDateOrder: async (column, order) => {
      const s = get();
      if (!s.lastFile) return;
      await get().loadFile(s.lastFile, {
        ...s.lastOptions,
        dateOrderOverrides: { ...(s.lastOptions.dateOrderOverrides ?? {}), [column]: order },
      });
    },

    chooseSheet: async (sheet) => {
      const file = get().pendingFile;
      if (!file) return;
      set({ sheets: null });
      await get().loadFile(file, { sheet });
    },

    resolveLargeFile: async (opts) => {
      const file = get().pendingFile;
      set({ largeFile: null });
      if (!file || !opts) {
        set({ pendingFile: null });
        return;
      }
      await get().loadFile(file, opts);
    },

    unpivot: async () => {
      set({ loading: { phase: "profiling", title: "Unpivoting columns…", progress: null } });
      try {
        handleLoad(await engine().unpivot(), null);
      } catch (e) {
        set({ loading: null, error: toError(e) });
      }
    },

    startOver: () => {
      resetEngine();
      // Calls in flight on the old worker never settle; drop a pending refresh
      // and retire the current request id so nothing from the old session lands.
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = null;
      requestSeq++;
      // Everything goes, the last file (and its reference to the user's data) included.
      set(initialData());
    },

    confirmDomain: async (domainId, subDomainId, opts) => {
      set({
        loading: {
          phase: "configuring",
          title: "Building your dashboard…",
          detail: "Resolving KPIs, compiling SQL and DAX, choosing charts",
          progress: null,
        },
      });
      try {
        await configureNow(domainId, subDomainId ?? null);
        const ctx = get().context;
        set({
          loading: null,
          step: opts?.goTo ?? "dashboard",
          datePreset: defaultPresetFor(ctx),
          customRange: null,
          dimFilters: [],
          crossFilter: null,
          drill: {},
          insights: null,
          mode: "analyst",
        });
        get().refresh();
        if (opts?.goTo === "insights") void get().loadInsights();
      } catch {
        set({ loading: null });
      }
    },

    setBusiness: (patch) => {
      set((s) => ({ business: { ...s.business, ...patch } }));
      if ("period" in patch && get().context) get().refresh();
    },

    setMappingOverride: (fieldId, column) => {
      set((s) => ({ mappingOverrides: { ...s.mappingOverrides, [fieldId]: column } }));
      void get().reconfigure();
    },

    setClassOverride: (key, values) => {
      set((s) => ({ classOverrides: { ...s.classOverrides, [key]: values } }));
      void get().reconfigure();
    },

    setRoleOverride: (column, role, additivity) => {
      set((s) => {
        const next = { ...s.roleOverrides };
        if (role === null) delete next[column];
        else next[column] = { role, additivity };
        return { roleOverrides: next };
      });
      void get().reconfigure();
    },

    renameKpi: (id, name) => {
      set((s) => ({ kpiRenames: { ...s.kpiRenames, [id]: name } }));
      void get().reconfigure();
    },

    setTarget: (id, value) =>
      set((s) => {
        const next = { ...s.kpiTargets };
        if (value === null || !Number.isFinite(value)) delete next[id];
        else next[id] = value;
        return { kpiTargets: next };
      }),

    setSubDomain: (id) => {
      set({ subDomainId: id });
      void get().reconfigure();
    },

    reconfigure: async () => {
      const s = get();
      if (!s.domainId || !s.summary) return;
      try {
        await configureNow(s.domainId, s.subDomainId);
        get().refresh();
        set({ insights: null });
      } catch {
        /* error already in state */
      }
    },

    setMode: (mode) => {
      set({ mode });
      get().refresh();
    },

    setDatePreset: (preset, custom) => {
      set({ datePreset: preset, customRange: preset === "custom" ? (custom ?? null) : null, insights: null });
      get().refresh();
    },

    setDimFilter: (column, values) => {
      set((s) => ({
        dimFilters: [
          ...s.dimFilters.filter((f) => f.column !== column),
          ...(values.length ? [{ kind: "in" as const, column, values }] : []),
        ],
        insights: null,
      }));
      get().refresh();
    },

    setCrossFilter: (sourceId, column, value) => {
      set((s) => ({
        crossFilter:
          value === null || (s.crossFilter?.column === column && s.crossFilter.value === value)
            ? null
            : { column, value, sourceId },
        insights: null,
      }));
      get().refresh();
    },

    clearFilters: () => {
      const ctx = get().context;
      set({
        dimFilters: [],
        crossFilter: null,
        datePreset: defaultPresetFor(ctx),
        customRange: null,
        drill: {},
        insights: null,
      });
      get().refresh();
    },

    drillDown: (specId, value) => {
      set((s) => ({ drill: { ...s.drill, [specId]: [...(s.drill[specId] ?? []), value] } }));
      get().refresh();
    },

    drillUp: (specId, levels = 1) => {
      set((s) => ({
        drill: {
          ...s.drill,
          [specId]: (s.drill[specId] ?? []).slice(0, Math.max(0, (s.drill[specId]?.length ?? 0) - levels)),
        },
      }));
      get().refresh();
    },

    updateWidget: (id, patch) => {
      const before = get().widgets.find((w) => w.id === id);
      set((s) => ({ widgets: s.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
      if (patch.kind !== undefined || patch.topN !== undefined || (patch.hidden === false && before?.hidden))
        get().refresh();
    },

    moveWidget: (from, to) =>
      set((s) => {
        const list = [...s.widgets];
        const a = list.findIndex((w) => w.id === from);
        const b = list.findIndex((w) => w.id === to);
        if (a < 0 || b < 0) return {};
        const [item] = list.splice(a, 1);
        list.splice(b, 0, item as Widget);
        return { widgets: list };
      }),

    addCustomChart: (spec) => {
      set((s) => ({
        customCharts: [...s.customCharts, spec],
        widgets: [...s.widgets, { id: spec.id, w: spec.size.w, h: spec.size.h }],
        selected: { type: "chart", id: spec.id },
      }));
      get().refresh();
    },

    removeChart: (id) =>
      set((s) => ({
        customCharts: s.customCharts.filter((c) => c.id !== id),
        widgets: s.customCharts.some((c) => c.id === id)
          ? s.widgets.filter((w) => w.id !== id)
          : s.widgets.map((w) => (w.id === id ? { ...w, hidden: true } : w)),
        selected: s.selected?.id === id ? null : s.selected,
      })),

    toggleExtraKpi: (id) => {
      set((s) => ({
        extraKpis: s.extraKpis.includes(id) ? s.extraKpis.filter((x) => x !== id) : [...s.extraKpis, id],
      }));
      get().refresh();
    },

    select: (selected) => set({ selected }),

    focusChart: (id) => {
      set({ highlight: id, step: "dashboard" });
      // Give the dashboard a moment to render before scrolling; drop the
      // highlight later unless another chart has been focused meanwhile.
      setTimeout(() => {
        document.getElementById(`chart-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);
      setTimeout(() => {
        if (get().highlight === id) set({ highlight: null });
      }, 2600);
    },

    filters: () => {
      const s = get();
      const out: DashboardFilter[] = [];
      const ctx = s.context;
      if (ctx?.dateColumn && ctx.dateBounds) {
        const range = s.datePreset === "custom" ? s.customRange : presetRange(s.datePreset, ctx.dateBounds);
        if (range) out.push({ kind: "dateRange", column: ctx.dateColumn, from: range.from, to: range.to });
      }
      out.push(...s.dimFilters);
      // Tagged with its source chart: refresh() leaves it out for that chart, and a saved config keeps the tag.
      if (s.crossFilter)
        out.push({
          kind: "in",
          column: s.crossFilter.column,
          values: [s.crossFilter.value],
          sourceId: s.crossFilter.sourceId,
        });
      return out;
    },

    refresh: () => {
      // Trailing debounce: a burst of changes (e.g. several quick filter
      // clicks) costs one recompute, read from the state at fire time.
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(async () => {
        const s = get();
        const ctx = s.context;
        if (!ctx) return;
        // Abort protocol: every run gets a new id. begin(id) tells the worker
        // this run is the newest, so an older in-flight run stops at its next
        // chart; any result tagged with an older id is ignored below.
        const id = ++requestSeq;
        const filters = s.filters();
        const allSpecs = [...ctx.charts, ...s.customCharts];
        // Only charts on screen are computed: not hidden and part of the current layout mode.
        const visible = s.widgets.filter(
          (w) => !w.hidden && allSpecs.find((x) => x.id === w.id)?.modes.includes(s.mode),
        );
        // filters() tags the cross-filter with its source chart, so dropping tagged entries removes exactly it.
        const withoutCross = filters.filter((f) => !("sourceId" in f));
        const charts = visible.map((w) => {
          const spec = allSpecs.find((x) => x.id === w.id) as ChartSpec;
          return {
            specId: w.id,
            // The worker knows built-in specs by id; custom specs travel in full.
            spec: spec.source === "custom" ? spec : undefined,
            kind: w.kind,
            topN: w.topN,
            drill: s.drill[w.id]?.length ? { path: s.drill[w.id] as string[] } : undefined,
            grain: isPeriodGrain(s.business.period) ? s.business.period : undefined,
            // A chart never filters itself when it is the source of the cross-filter; it highlights instead.
            filters: s.crossFilter?.sourceId === w.id ? withoutCross : undefined,
          };
        });
        const kpiIds = [
          ...ctx.selection.hero,
          ...ctx.selection.supporting,
          ...ctx.selection.columns,
          ...s.extraKpis.filter(
            (k) =>
              !ctx.selection.hero.includes(k) &&
              !ctx.selection.supporting.includes(k) &&
              !ctx.selection.columns.includes(k),
          ),
        ];
        set({ computing: true });
        const api = engine();
        await api.begin(id);
        // Results stream back through proxied callbacks as each part is ready.
        // An aborted run leaves `computing` alone: the newer run owns it.
        try {
          const res = await api.computeDashboard(
            { filters, kpiIds, charts, numberLocale: useSettings.getState().numberLocale },
            id,
            Comlink.proxy((batch: KpiBatch) => {
              if (id === requestSeq) set({ kpiBatch: batch });
            }),
            Comlink.proxy((specId: string, data: ChartData) => {
              if (id === requestSeq) set((st) => ({ charts: { ...st.charts, [specId]: data } }));
            }),
          );
          if (id === requestSeq && !res.aborted) {
            set({ computing: false, lastCompute: { ms: res.ms, rows: res.rows } });
            if (get().step === "insights") void get().loadInsights();
          }
        } catch (e) {
          if (id === requestSeq) set({ computing: false, error: toError(e) });
        }
      }, 90);
    },

    loadInsights: async () => {
      if (!get().context) return;
      set({ insightsLoading: true });
      try {
        const insights = await engine().insights(useSettings.getState().numberLocale);
        set({ insights, insightsLoading: false });
      } catch (e) {
        set({ insightsLoading: false, error: toError(e) });
      }
    },

    applyConfig: async (cfg) => {
      // Restores the persisted settings first (number format, currency), then
      // the overrides, then configures. A configure error propagates to the caller.
      const settings = useSettings.getState();
      settings.setNumberLocale(cfg.settings.numberLocale);
      // The config stores the effective currency. Matching what this file
      // detects needs no override (so none outlives this file); a different,
      // supported code becomes the override. An unknown code is not applied:
      // the config is outside input and the code is printed in every figure.
      const detected = get().profile?.currency.code ?? null;
      if (cfg.settings.currency === detected) settings.setCurrencyOverride(null);
      else if (SUPPORTED_CURRENCIES.includes(cfg.settings.currency))
        settings.setCurrencyOverride(cfg.settings.currency);
      const business = cfg.business ?? {};
      set({
        mappingOverrides: cfg.mappingOverrides,
        classOverrides: cfg.classOverrides,
        roleOverrides: cfg.roleOverrides,
        kpiRenames: cfg.kpiRenames,
        kpiTargets: cfg.kpiTargets,
        // The period becomes the trend grain sent to the engine, so only a known grain is kept.
        business: {
          model: business.model,
          goal: business.goal,
          period: isPeriodGrain(business.period) ? business.period : undefined,
          notes: business.notes,
        },
        customCharts: cfg.dashboard.customCharts as ChartSpec[],
      });
      await configureNow(cfg.domainId, cfg.subDomainId ?? null);
      // Saved widgets come first in their saved order with their saved
      // overrides; charts the config does not mention keep defaults, at the end.
      const widgets = get().widgets;
      const saved = new Map(cfg.dashboard.widgets.map((w, i) => [w.id, { ...w, i }]));
      const ordered = [...widgets]
        .sort((a, b) => (saved.get(a.id)?.i ?? 999) - (saved.get(b.id)?.i ?? 999))
        .map((w) => {
          const sv = saved.get(w.id);
          return sv
            ? {
                id: w.id,
                w: sv.w,
                h: sv.h,
                kind: sv.kind as ChartKind | undefined,
                topN: sv.topN,
                hidden: sv.hidden,
              }
            : w;
        });
      // The saved date range only matters for a "custom" preset; named presets
      // are recomputed against the data. The cross-filter was saved tagged
      // with its source chart and comes back as a cross-filter, so that chart
      // still highlights instead of filtering itself. Every other saved filter
      // becomes a dimension filter (as does a cross-filter from a config saved
      // before the tag existed, which cannot say where it came from).
      const savedFilters = cfg.dashboard.filters;
      const dateRange = savedFilters.find((f) => f.kind === "dateRange");
      const cross = savedFilters.find(
        (f) => f.kind === "in" && f.sourceId !== undefined && f.values.length === 1,
      );
      const crossFilter =
        cross?.kind === "in" && cross.sourceId !== undefined && cross.values[0] !== undefined
          ? { column: cross.column, value: cross.values[0], sourceId: cross.sourceId }
          : null;
      set({
        widgets: ordered,
        mode: cfg.dashboard.mode,
        datePreset: cfg.dashboard.datePreset as DatePreset,
        customRange:
          cfg.dashboard.datePreset === "custom" && dateRange && dateRange.kind === "dateRange"
            ? { from: dateRange.from, to: dateRange.to }
            : null,
        dimFilters: savedFilters.filter((f) => f.kind !== "dateRange" && f !== cross).map(plainFilter),
        crossFilter,
        // The config does not record drill paths, and the old insights describe other filters.
        drill: {},
        insights: null,
        step: "dashboard",
      });
      get().refresh();
    },
  };
});

/** Built-in plus custom chart specs, the list widgets are resolved against. */
export function allSpecs(s: Pick<WorkspaceState, "context" | "customCharts">): ChartSpec[] {
  return [...(s.context?.charts ?? []), ...s.customCharts];
}
