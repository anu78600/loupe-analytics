"use client";

/**
 * The workspace state machine (Zustand, main thread, not persisted): the
 * steps in STEPS (Upload → Detect → Check & map → Customise → Dashboard →
 * Questions & SQL → Insights → Export), the
 * user's overrides, the dashboard layout and filters, and the latest results
 * streamed back from the engine worker.
 *
 * The store never holds the dataset itself, only small results; every
 * computation goes through engine(). Three kinds of change, three paths:
 *  - Mapping, value-class, role, sub-domain, hidden-column and KPI-name
 *    changes call reconfigure(): the worker rebuilds the whole analysis
 *    context (KPI resolution, chart specs, SQL/DAX), then the dashboard
 *    refreshes.
 *  - Filter, drill, mode and widget changes call refresh(): a 90 ms
 *    debounced recompute of KPIs and visible charts; superseded requests are
 *    aborted in the worker and their late results ignored here.
 *  - Purely visual changes (selection, highlight, resizing, KPI targets)
 *    touch no engine state.
 * Everything derived from a dataset (including the business context, whose
 * `period` sets the trend grain, and a currency chosen for it) is reset when a
 * new dataset is adopted, and "Start over" returns the whole store to its
 * initial state. Reading the same file again (a day/month order fix) keeps
 * the user's choices and rebuilds the analysis with them.
 *
 * Loads run one at a time and each has a token: progress messages travel on
 * their own channel and can arrive after the result, so once a load has
 * settled (or a newer one has started) its messages change nothing.
 *
 * Corrections are learned (store/learned.ts). When the user's own file is
 * adopted, a rule learned on a file like it sets the industry, mappings,
 * value meanings, roles and hidden columns the way the user's overrides
 * would (`learned.applied`, shown with Undo and Forget); each correction the
 * user makes afterwards (chooseIndustry then confirming, setSubDomain, the
 * override setters, setColumnsHidden) is recorded in that file's rule, in
 * the action itself. Demos neither learn nor apply anything, so they always
 * read the same way. Words taught in Check & map go with every file read.
 *
 * What the table is about (`understanding`, version 49.0) comes with the
 * load. On Detect, before the analysis is built, a correction that changes
 * that reading (the outcome, a column's kind, the hidden columns, the
 * industry) never builds the analysis: the worker reads the table again
 * (Session.understand) and the choice is built when the user moves on. Once
 * built, those corrections rebuild the analysis like any other, and each
 * configure's own understanding replaces the store's.
 */
import { create } from "zustand";
import { Comlink, engine, resetEngine } from "@/lib/engine-client";
import { formatCount, SUPPORTED_CURRENCIES } from "@/engine/core/format";
import type { IngestOptions, LargeFileAssessment, ParseReport } from "@/engine/core/types";
import type { HealthReport } from "@/engine/profile/quality";
import type { ReplacedColumn } from "@/engine/profile/replaced";
import type { UserKpi } from "@/engine/kpi/userKpis";
import type { DatasetProfile, SemanticRole, Additivity } from "@/engine/profile/types";
import type { DetectionResult } from "@/engine/detect/detect";
import type {
  ContextResult,
  DatasetSummary,
  DomainListItem,
  LoadResult,
  QuestionAnswer,
  RoleOverride,
} from "@/engine/session";
import type { ColumnKind, DataUnderstanding } from "@/engine/understand/types";
import type { AskOrder, ChartAsk } from "@/engine/charts/ask";
import type { KpiBatch } from "@/engine/kpi/compute";
import type { ChartData, ChartKind, ChartSpec, LayoutMode } from "@/engine/charts/types";
import type { Filter } from "@/engine/query/filter";
import type { Insight } from "@/engine/insights/insights";
import type { IngestProgress } from "@/engine/parse";
import type { LoupeConfig } from "@/engine/export/config";
import { defaultPreset, presetRange, type DatePreset } from "@/engine/core/periods";
import { useSettings } from "./settings";
import {
  applyRule,
  appliedNothing,
  findRule,
  headerKey,
  isEmptyRule,
  newRule,
  signatureOf,
  synonymsOf,
  teachClass,
  teachField,
  teachHidden,
  teachIndustry,
  teachRole,
  undoApplied,
  useLearned,
  type AppliedRule,
  type LearnedChoices,
  type LearnedRule,
} from "./learned";

export type Step =
  "upload" | "detect" | "map" | "customise" | "dashboard" | "questions" | "insights" | "export";
export const STEPS: Array<{ id: Step; label: string }> = [
  { id: "upload", label: "Upload" },
  { id: "detect", label: "Detect" },
  { id: "map", label: "Check & map" },
  { id: "customise", label: "Customise" },
  { id: "dashboard", label: "Dashboard" },
  { id: "questions", label: "Questions & SQL" },
  { id: "insights", label: "Insights" },
  { id: "export", label: "Export" },
];

/** 1-based position of a step, for the "Step N" headings (they follow STEPS, so adding a step renumbers them). */
export const stepNumber = (id: Step): number => STEPS.findIndex((s) => s.id === id) + 1;

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

/**
 * The KPIs on the dashboard, in order: the headline strip (at most
 * MAX_HEADLINE), the supporting tiles and the tiles of the "From your other
 * columns" section. Set in the Customise step; until then the engine's
 * recommendation (context.selection) is used.
 */
export interface KpiLayout {
  hero: string[];
  supporting: string[];
  columns: string[];
}
/** The headline strip lays out at most six cards (KpiCards STRIP_COLS). */
export const MAX_HEADLINE = 6;

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
  /** The user's own title (Customise step); the spec's title when unset. */
  title?: string;
}

/**
 * Learning for the loaded file (store/learned.ts): its header signature and
 * columns, the rule its corrections go to, and what a rule set on it.
 */
export interface LearnedFile {
  signature: string[];
  columns: string[];
  /** The rule this file teaches: the one found when it loaded, else the one its first correction made. */
  ruleId: string | null;
  /** What a learned rule set on this file, while it is in use; null when none applied, or after Undo or Forget. */
  applied: AppliedRule | null;
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
  /** Column → corrected role; a "Read as …" correction on Detect also carries the kind it stands for. */
  roleOverrides: Record<string, RoleOverride>;
  /**
   * The column the table is measured by (Detect's outcome select): undefined
   * lets Loupe choose, null means none, a column name is the user's choice.
   * Sent with every configure and understand request, saved with a config,
   * and cleared for a new file.
   */
  outcome: string | null | undefined;
  /**
   * What Loupe reads the table to be (engine/understand/types.ts), shown on
   * Detect as "What this data is about": from the load, read again by the
   * worker (Session.understand) when the outcome, a column's kind, the hidden
   * columns or the industry change before the analysis is built, and the
   * analysis's own (ContextResult.understanding) from each configure on.
   */
  understanding: DataUnderstanding | null;
  /** True while the worker reads the table again for a correction made on Detect (Session.understand). */
  understandingPending: boolean;
  /**
   * The outcome Loupe chose when the file loaded and its alternatives, so the
   * outcome select keeps offering them after the user picks another column or none.
   */
  outcomeChoices: string[];
  kpiRenames: Record<string, string>;
  /** UI-only KPI targets; never sent to the engine. */
  kpiTargets: Record<string, number>;
  /**
   * Columns the user hid in step 3, sent with every configure: they stay in
   * the file, the data grid and the exports, but nothing computes from them.
   */
  hiddenColumns: string[];
  /** Columns that look replaced by a cleaned copy (found on loading), offered in step 3 as columns to hide. */
  replaced: ReplacedColumn[];
  /** The user waved the suggestions away; they come back with the next file. */
  replacedDismissed: boolean;
  /** Learning from corrections on the loaded file; null for a demo or before a file is loaded. */
  learned: LearnedFile | null;
  /** The user picked an industry or data shape on Detect (chooseIndustry); confirming it learns it. */
  industryChosen: boolean;
  /**
   * The industry the user chose to keep on the dashboard although it explains few of the file's
   * columns (the fit notice's "Keep", ContextResult.fit): its notice stays away for this file, in
   * both views. Another industry asks again; a new file starts with none.
   */
  fitKept: string | null;
  /** Result of the last configure(); null until a domain is confirmed. */
  context: ContextResult | null;
  configuring: boolean;

  /** Layout mode; a chart is shown only when its spec lists this mode. */
  mode: LayoutMode;
  /**
   * How the dashboard step shows the dashboard: "page" is the one-page view
   * (a single landscape page, as an analyst builds one for an executive);
   * "full" is every chart, by section, in the layout mode above.
   */
  dashView: "page" | "full";
  /** The user's name for the one-page dashboard; null shows the automatic title. */
  pageTitle: string | null;
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
  /** KPIs the user added beyond hero and supporting (the KPI details' "Add to dashboard"). */
  extraKpis: string[];
  /** The user's own KPI layout from the Customise step; null = the recommended one. See kpiLayoutOf(). */
  kpiLayout: KpiLayout | null;
  /** KPIs the user built in the Customise step, sent with every configure. */
  customKpis: UserKpi[];

  // Latest results streamed from the worker.
  kpiBatch: KpiBatch | null;
  /** Spec id → data. Charts no longer requested keep their last data. */
  charts: Record<string, ChartData>;
  computing: boolean;
  lastCompute: { ms: number; rows: number } | null;
  /** null = not computed for the current filters; cleared whenever filters change. */
  insights: Insight[] | null;
  /**
   * True from the moment insights are asked for until they match the current
   * selection, the wait for a dashboard refresh included (see loadInsights).
   */
  insightsLoading: boolean;
  /**
   * Business questions asked in step 5, newest first, each with its answer,
   * SQL and the filters it was answered with. Cleared when the data or the
   * analysis is rebuilt, so an answer never outlives the definitions it used.
   */
  questions: QuestionAnswer[];
  questionsLoading: boolean;
  /** What the inspector panel is editing. */
  selected: { type: "chart" | "kpi"; id: string } | null;
  /** Spec id briefly outlined after focusChart(). */
  highlight: string | null;

  // actions
  /**
   * Every step after Detect works on the analysis of the industry and data
   * shape chosen on Detect: navigating there builds it first when it is
   * missing, or when the choice changed since it was built.
   */
  setStep: (step: Step) => void;
  /**
   * Parses a file in the worker. Unproven day/month orders follow where the
   * user is (assumeDayFirst) unless `opts` says otherwise.
   */
  loadFile: (file: File, opts?: IngestOptions) => Promise<void>;
  /** Loads a demo; with `goTo` (a step after Detect) it also builds the detected industry and opens that step. */
  loadSample: (id: string, opts?: { goTo?: Step }) => Promise<void>;
  /**
   * Re-reads the last file with a day/month order fixed for one column. The
   * user's choices (industry, overrides, hidden columns, KPI layout, their
   * KPIs and charts, filters) are kept and the analysis is rebuilt with them,
   * on the step the user is on; asked questions are answered again.
   */
  setDateOrder: (column: string, order: "DMY" | "MDY") => Promise<void>;
  chooseSheet: (sheet: string) => Promise<void>;
  /**
   * For a workbook read as joined sheets: opens the sheet picker for the
   * same file, so the user can analyse one sheet instead. The joined table
   * stays until a sheet is chosen.
   */
  pickOneSheet: () => Promise<void>;
  /** Loads the pending large file with the chosen sampling options; null cancels. */
  resolveLargeFile: (opts: IngestOptions | null) => Promise<void>;
  /** Replaces the dataset with its long (unpivoted) form; overrides and layout reset. */
  unpivot: () => Promise<void>;
  /**
   * Replaces a tall scorecard with its pivoted form (one column per metric);
   * overrides and layout reset, as for unpivot.
   */
  pivot: () => Promise<void>;
  /** Terminates the worker (freeing the dataset), forgets the last file and returns the whole store to its initial state. */
  startOver: () => void;
  /**
   * Answers a business question in the worker and adds it to `questions`.
   * "dashboard" uses the dashboard's date and filter selections (not a
   * chart's click-to-filter); "file" uses every row.
   */
  askQuestion: (q: {
    question: string;
    understood: string;
    notes: string[];
    ask: ChartAsk;
    order: AskOrder;
    scope: "dashboard" | "file";
  }) => Promise<void>;
  removeQuestion: (id: string) => void;
  /**
   * Configures the domain and refreshes. Another industry or data shape than
   * the analysis had starts from its recommendation (filters, drill, mode, KPI
   * layout, answers); confirming the same one again keeps them. Errors land
   * in `error`; it does not throw.
   */
  confirmDomain: (domainId: string, subDomainId?: string | null, opts?: { goTo?: Step }) => Promise<void>;
  /**
   * The industry and data shape picked on Detect (null shape = Auto). Like
   * any choice there, it is built when the user moves on, and learned then;
   * the reading of the table is refreshed at once for its label.
   */
  chooseIndustry: (domainId: string, subDomainId: string | null) => void;
  /**
   * The outcome the table is measured by: undefined is Loupe's choice, null
   * none, a column name the user's. Rebuilds the analysis when one exists;
   * on Detect before that, reads the table again (built when the user moves on).
   */
  setOutcome: (outcome: string | null | undefined) => void;
  /** Refreshes only when `period` (the trend grain) is part of the patch. */
  setBusiness: (patch: Partial<BusinessContext>) => void;
  // setMappingOverride, setClassOverride, setRoleOverride, renameKpi and setSubDomain each trigger reconfigure().
  setMappingOverride: (fieldId: string, column: string | null) => void;
  /** Replaces every mapping override at once (the "Undo" of a mapping change) and reconfigures. */
  setMappingOverrides: (overrides: Record<string, string | null>) => void;
  setClassOverride: (key: string, values: string[]) => void;
  /**
   * null removes the override, restoring the detected role. `kind` is the
   * kind a "Read as …" correction stands for (understand/kinds.ts
   * roleForKind); a role set directly (Check & map) carries none. Before the
   * analysis is built (Detect), the table is read again instead of built.
   */
  setRoleOverride: (
    column: string,
    role: SemanticRole | null,
    additivity?: Additivity,
    kind?: ColumnKind,
  ) => void;
  /**
   * Hides columns from the analysis (or shows them again) and reconfigures
   * (before the analysis is built, reads the table again instead). Filters
   * on a newly hidden column are dropped, so no figure stays narrowed by it,
   * and a hidden column chosen as the outcome goes back to Loupe's choice.
   */
  setColumnsHidden: (columns: string[], hidden: boolean) => void;
  dismissReplaced: () => void;
  /** Takes back what a learned rule set on this file (the user's later changes stay); the rule is kept. */
  undoLearned: () => void;
  /** Takes back what a learned rule set on this file and deletes the rule. */
  forgetLearned: () => void;
  /** Keeps an industry that fits few of the file's columns: the dashboard's fit notice goes for it (fitKept). */
  keepFit: (domainId: string) => void;
  /**
   * Teaches Loupe that this column's header means this field, for every
   * future file ("Remember 'Net Amt' as Net revenue"). Registry fields only.
   */
  rememberWord: (fieldId: string, column: string) => void;
  renameKpi: (id: string, name: string) => void;
  /** null or a non-finite value clears the target. No refresh: targets are display-only. */
  setTarget: (id: string, value: number | null) => void;
  setSubDomain: (id: string) => void;
  /**
   * Re-runs configure in the worker with the current overrides, keeping the
   * layout of known charts, and answers the asked questions again under the
   * new definitions. An industry chosen on Detect but not built yet goes
   * through confirmDomain instead. Before any analysis is built it only reads
   * the table again (the Detect step builds on Next).
   */
  reconfigure: () => Promise<void>;
  setMode: (mode: LayoutMode) => void;
  setDashView: (view: "page" | "full") => void;
  /** Blank restores the automatic title. */
  setPageTitle: (title: string) => void;
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
  /** Adds a chart; `select` (default true) also opens it in the inspector, as the manual builder wants. */
  addCustomChart: (spec: ChartSpec, opts?: { select?: boolean }) => void;
  /** Custom charts are deleted; built-in charts are only hidden, so they can come back. */
  removeChart: (id: string) => void;
  toggleExtraKpi: (id: string) => void;
  /** Replaces the KPI layout (null goes back to the recommended one) and refreshes. */
  setKpiLayout: (layout: KpiLayout | null) => void;
  /** Adds or replaces (by id) a KPI the user built, placing a new one on the dashboard; reconfigures. */
  saveCustomKpi: (kpi: UserKpi, place?: "hero" | "supporting" | "none") => Promise<void>;
  /** Deletes a user-built KPI (and its place in the layout); reconfigures. */
  removeCustomKpi: (id: string) => void;
  /**
   * Back to the recommended dashboard: the KPI layout, and every chart's
   * visibility, size, type, Top N and title. Charts and KPIs the user built
   * are kept (and stay visible).
   */
  resetCustomisation: () => void;
  select: (sel: WorkspaceState["selected"]) => void;
  /** Switches to the dashboard, scrolls the chart into view and outlines it briefly. */
  focusChart: (id: string) => void;
  /** Debounced (90 ms) recompute of KPIs and visible charts; see the implementation for the abort protocol. */
  refresh: () => void;
  /**
   * Computes the insights for the current selection. They are read from the
   * worker's last dashboard results, so a pending or running refresh is waited
   * for (again if the selection changes meanwhile); `insightsLoading` is true
   * throughout. A second call while one runs joins it.
   */
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
    outcome: undefined,
    understanding: null,
    understandingPending: false,
    outcomeChoices: [],
    kpiRenames: {},
    kpiTargets: {},
    hiddenColumns: [],
    replaced: [],
    replacedDismissed: false,
    learned: null,
    industryChosen: false,
    fitKept: null,
    context: null,
    configuring: false,
    mode: "analyst",
    // The dashboard opens as the one-page view, the page to present; every chart is one click away.
    dashView: "page",
    pageTitle: null,
    widgets: [],
    customCharts: [],
    datePreset: "all",
    customRange: null,
    dimFilters: [],
    crossFilter: null,
    drill: {},
    extraKpis: [],
    kpiLayout: null,
    customKpis: [],
    kpiBatch: null,
    charts: {},
    computing: false,
    lastCompute: null,
    insights: null,
    insightsLoading: false,
    questions: [],
    questionsLoading: false,
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

/** Token of the newest file or demo load: progress and results of an older load change nothing. */
let loadSeq = 0;
/**
 * Loads run one after another, so the dataset the worker ends with is the one
 * the newest load adopted. Reset by "Start over", whose terminated worker
 * never answers the calls still queued.
 */
let loadChain: Promise<unknown> = Promise.resolve();

/** Bumped by every refresh(): insights computed before a newer dashboard result describe an older selection. */
let refreshGen = 0;
/** Settles once no dashboard refresh is pending or running; insights are read from the last one. */
let refreshIdle: Promise<void> = Promise.resolve();
let markRefreshIdle: (() => void) | null = null;

function refreshStarted(): void {
  refreshGen++;
  if (!markRefreshIdle) refreshIdle = new Promise<void>((resolve) => (markRefreshIdle = resolve));
}

function refreshSettled(): void {
  const settle = markRefreshIdle;
  markRefreshIdle = null;
  settle?.();
}

/** The insights load in progress (a second request joins it) and its token, retired by a new dataset. */
let insightsLoad: Promise<void> | null = null;
let insightsSeq = 0;
/** Token of the newest re-answering of the questions; an older one stops. */
let answerSeq = 0;
/**
 * Bumped whenever the store's understanding is replaced (a load, a configure, a new reading): a
 * reading asked for before that describes older choices and is dropped when it arrives.
 */
let understandSeq = 0;

/** The outcome Loupe chose and its alternatives, best first: what the outcome select always offers. */
function outcomeChoicesOf(u: DataUnderstanding | null | undefined): string[] {
  return u?.outcome ? [u.outcome.column, ...u.outcome.alternatives] : [];
}

/**
 * IANA time zones of the places that write dates month first: the United
 * States (with the legacy US/… and EST5EDT-style names) and the Philippines.
 */
const MONTH_FIRST_ZONE =
  /^(?:America\/(?:New_York|Detroit|Kentucky\/\w+|Indiana\/\w+|Chicago|Menominee|North_Dakota\/\w+|Denver|Boise|Phoenix|Los_Angeles|Anchorage|Juneau|Sitka|Metlakatla|Yakutat|Nome|Adak)|US\/\w+|Pacific\/Honolulu|Asia\/Manila|EST5EDT|CST6CDT|MST7MDT|PST8PDT)$/;

/**
 * The day/month order assumed for a date column nothing proves (no day above
 * 12): month first where dates are written that way, read from the device's
 * time zone, else day first, as most of the world writes them. It never
 * depends on an earlier file (the automatic number format does), so the same
 * file always reads the same way.
 */
export function assumeDayFirst(timeZone?: string): boolean {
  let zone = timeZone;
  if (zone === undefined) {
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    } catch {
      zone = "";
    }
  }
  return !MONTH_FIRST_ZONE.test(zone);
}

const PHASE_TITLE: Record<string, string> = {
  reading: "Reading file",
  parsing: "Parsing rows",
  finalizing: "Finalising columns",
  joining: "Joining related sheets",
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

/**
 * The data shape a request for `domainId` means: the one asked for, else the
 * one detection picked for that industry ("Auto (best match)"), else none
 * (the engine then ranks the shapes itself).
 */
function shapeFor(
  s: Pick<WorkspaceState, "detection">,
  domainId: string,
  subDomainId: string | null,
): string | null {
  return subDomainId ?? s.detection?.shapes[domainId] ?? null;
}

/** The industry and shape detection picks for a file: the best match from 35% confidence, else Generic. */
function detectedChoice(detection: DetectionResult): { domainId: string; subDomainId: string | null } {
  const top = detection.candidates[0];
  return {
    domainId: top && top.confidence >= 35 ? top.domainId : "generic",
    subDomainId: top?.subDomain.id ?? null,
  };
}

/** The choices a learned rule can set, as the store holds them. */
const choicesOf = (s: WorkspaceState): LearnedChoices => ({
  domainId: s.domainId,
  subDomainId: s.subDomainId,
  mappingOverrides: s.mappingOverrides,
  classOverrides: s.classOverrides,
  roleOverrides: s.roleOverrides,
  hiddenColumns: s.hiddenColumns,
});

/**
 * True when the industry or data shape chosen on Detect is not the one the
 * current analysis was built for (the choice is only remembered until the
 * next step is opened or Next is pressed).
 */
export function choiceChanged(
  s: Pick<WorkspaceState, "context" | "domainId" | "subDomainId" | "detection">,
): boolean {
  const ctx = s.context;
  if (!ctx || !s.domainId) return false;
  if (s.domainId !== ctx.domain.id) return true;
  const wanted = shapeFor(s, s.domainId, s.subDomainId);
  return wanted !== null && wanted !== ctx.subDomainId;
}

export const useWorkspace = create<WorkspaceState>()((set, get) => {
  // Retires everything still in flight for the current dataset: a pending or running dashboard
  // refresh (its results would land on the next one), an insights load and a re-answering.
  const retireRequests = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    requestSeq++;
    refreshSettled();
    insightsSeq++;
    insightsLoad = null;
    answerSeq++;
    understandSeq++;
  };

  // Reads the table again for the choices made so far on Detect, before the analysis is built: the
  // outcome, the kinds and roles set, the hidden columns and the industry (for its label). A reading
  // that arrives after a newer one (or after a configure, a load) is dropped.
  const refreshUnderstanding = async (): Promise<void> => {
    const s = get();
    if (!s.summary) return;
    const token = ++understandSeq;
    set({ understandingPending: true });
    try {
      const understanding = await engine().understand({
        outcome: s.outcome,
        roleOverrides: s.roleOverrides,
        hiddenColumns: s.hiddenColumns,
        domainId: s.domainId ?? undefined,
      });
      if (token === understandSeq) set({ understanding, understandingPending: false });
    } catch (e) {
      if (token === understandSeq) set({ understandingPending: false, error: toError(e) });
    }
  };

  // Records a correction in the loaded file's rule (store/learned.ts): the rule found when it loaded,
  // else a new one for its signature. A rule left with nothing in it is deleted. Nothing for a demo.
  // Runs inside the store's actions (event handlers), so the time is the moment of the correction.
  const teach = (change: (r: LearnedRule) => LearnedRule) => {
    const l = get().learned;
    if (!l) return;
    const now = Date.now();
    const store = useLearned.getState();
    const base = store.rules.find((r) => r.id === l.ruleId) ?? newRule(l.signature, l.columns, now);
    // The rule follows the latest file it was taught on.
    const next = { ...change({ ...base, signature: l.signature, columns: l.columns }), updatedAt: now };
    store.saveRule(next);
    set({ learned: { ...l, ruleId: isEmptyRule(next) ? null : next.id } });
  };

  // Learns the industry and data shape the user chose (`shape` null = Auto): nothing when it is what
  // detection picked, so a later file follows detection again.
  const teachChoice = (domainId: string, shape: string | null) => {
    const s = get();
    const ctx = s.context;
    if (!s.learned || !s.detection || !ctx || ctx.domain.id !== domainId) return;
    const detected = detectedChoice(s.detection);
    const autoShape =
      s.detection.shapes[domainId] ?? (domainId === detected.domainId ? detected.subDomainId : null);
    const same = domainId === detected.domainId && (shape === null || shape === autoShape);
    const shapeName = shape ? (ctx.domain.subDomains.find((x) => x.id === shape)?.name ?? null) : null;
    teach((r) =>
      teachIndustry(
        r,
        same ? null : { domainId, subDomainId: shape, name: ctx.domain.name, shape: shapeName },
      ),
    );
  };

  // Applies a LoadResult: either parks the file for a user decision, or
  // adopts the new dataset and resets everything derived from the old one,
  // the business context included (its period would otherwise set the trend
  // grain of an unrelated dataset) and the currency chosen for the old file
  // (`keepCurrency` for an unpivot, which reshapes the same file).
  const handleLoad = (res: LoadResult, file: File | null, keepCurrency = false) => {
    if (res.status === "needs-sheet") {
      set({ loading: null, sheets: res.sheets, pendingFile: file });
      return;
    }
    if (res.status === "needs-decision") {
      set({ loading: null, largeFile: res.assessment, pendingFile: file });
      return;
    }
    retireRequests();
    if (!keepCurrency) useSettings.getState().setCurrencyOverride(null);
    // The automatic number format follows this file's currency from Detect on, not the last file's.
    useSettings
      .getState()
      .applyAutoNumberLocale(useSettings.getState().currencyOverride ?? res.profile.currency.code);
    // What detection picks, then what a rule learned on a file like this one sets on top (the user's
    // own file only: a demo always reads the same way). A new file has no choices of its own yet.
    let choices: LearnedChoices = {
      ...detectedChoice(res.detection),
      mappingOverrides: {},
      classOverrides: {},
      roleOverrides: {},
      hiddenColumns: [],
    };
    let learned: LearnedFile | null = null;
    if (!res.summary.isDemo) {
      const learnedStore = useLearned.getState();
      const now = Date.now();
      const columns = res.profile.columns.map((c) => c.name);
      const signature = signatureOf(res.profile.columns);
      const found = findRule(learnedStore.rules, signature);
      let applied: AppliedRule | null = null;
      if (found) {
        const out = applyRule(
          found.rule,
          { columns, domains: [...res.domains.map((d) => d.id), "generic"] },
          choices,
        );
        if (!appliedNothing(out.applied)) {
          choices = out.choices;
          applied = out.applied;
          learnedStore.ruleUsed(found.rule.id, now);
        }
      }
      learnedStore.wordsSeen(new Set(res.profile.columns.map((c) => headerKey(c.tokens))), now);
      learned = { signature, columns, ruleId: found?.rule.id ?? null, applied };
    }
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
      domainId: choices.domainId,
      subDomainId: choices.subDomainId,
      business: {},
      mappingOverrides: choices.mappingOverrides,
      classOverrides: choices.classOverrides,
      roleOverrides: choices.roleOverrides,
      // A new file: Loupe chooses its outcome, and the reading is the one it came with.
      outcome: undefined,
      understanding: res.understanding ?? null,
      understandingPending: false,
      outcomeChoices: outcomeChoicesOf(res.understanding),
      kpiRenames: {},
      kpiTargets: {},
      hiddenColumns: choices.hiddenColumns,
      replaced: res.replaced,
      replacedDismissed: false,
      learned,
      industryChosen: false,
      fitKept: null,
      context: null,
      charts: {},
      kpiBatch: null,
      computing: false,
      insights: null,
      insightsLoading: false,
      questions: [],
      questionsLoading: false,
      dimFilters: [],
      crossFilter: null,
      drill: {},
      customCharts: [],
      extraKpis: [],
      kpiLayout: null,
      customKpis: [],
      // A new file gets the automatic page title again.
      pageTitle: null,
      selected: null,
      highlight: null,
      step: "detect",
    });
    // The reading that came with the load knows nothing of a learned rule's industry, roles or
    // hidden columns: read the table again with them.
    if (learned?.applied) void refreshUnderstanding();
  };

  // Adopts a re-read of the same file (a day/month order fixed): the data, its profile and
  // detection are new, but the user's choices stay, and the analysis is rebuilt with them on the
  // step the user is on. Asked questions are answered again on the new dates.
  const adoptReread = async (res: LoadResult) => {
    if (res.status !== "ok") {
      // The file was read before with these options, so it never asks again; nothing to adopt.
      set({ loading: null });
      return;
    }
    const before = get();
    retireRequests();
    set({
      error: null,
      summary: res.summary,
      report: res.report,
      profile: res.profile,
      health: res.health,
      detection: res.detection,
      domains: res.domains,
      timings: res.timings,
      replaced: res.replaced,
      understanding: res.understanding ?? null,
      understandingPending: false,
      outcomeChoices: outcomeChoicesOf(res.understanding),
      // Results computed from the old reading of the dates go.
      charts: {},
      kpiBatch: null,
      computing: false,
      insights: null,
      insightsLoading: false,
      questionsLoading: false,
    });
    if (!before.context || !before.domainId) {
      set({ loading: null });
      // Not built yet: the new reading of the table follows the choices made on Detect.
      void refreshUnderstanding();
      return;
    }
    // The worker dropped its analysis with the old copy of the data: build it again, same choices.
    set({
      loading: {
        phase: "configuring",
        title: "Rebuilding your analysis…",
        detail: "Same industry and settings, with the dates read the new way",
        progress: null,
      },
    });
    try {
      await configureNow(before.domainId, before.subDomainId);
      set({ loading: null });
      get().refresh();
      if (before.questions.length) await reanswer(before.questions);
    } catch {
      set({ loading: null });
    }
  };

  // Progress callback for one load, wrapped in Comlink.proxy so the worker can call back across the
  // thread boundary. It travels on the proxy's own message channel, so it can arrive after the
  // load's result: once the load has settled (close) or a newer load has started, it changes
  // nothing. Row counts follow the number-format setting (Indian or international grouping).
  const progressFor = (fileName: string, token: number) => {
    let open = true;
    const callback = Comlink.proxy((p: IngestProgress) => {
      if (!open || token !== loadSeq) return;
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
              : p.phase === "joining"
                ? "Matching keys between the sheets"
                : undefined;
      set({
        loading: {
          phase: p.phase,
          // The row count is in the detail line; the title names the phase only.
          title: `${PHASE_TITLE[p.phase] ?? "Working"}…`,
          detail,
          progress: pct,
          fileName,
        },
      });
    });
    return {
      callback,
      close: () => {
        open = false;
      },
    };
  };

  // Queues a load behind the ones before it (loadChain) and runs `work` with its token, unless a
  // newer load was asked for while it waited. `start` is the loading state shown meanwhile.
  const queueLoad = (start: LoadingState, work: (token: number) => Promise<void>): Promise<void> => {
    const token = ++loadSeq;
    set({ loading: start, error: null });
    const run = loadChain.then(() => (token === loadSeq ? work(token) : undefined));
    loadChain = run.catch(() => undefined);
    return run;
  };

  // Reads a file in the worker: a new dataset, or the same file again with other options ("reread").
  const readFile = (file: File, opts: IngestOptions, mode: "new" | "reread"): Promise<void> =>
    queueLoad(
      { phase: "reading", title: "Reading file…", progress: 0, fileName: file.name },
      async (token) => {
        const merged: IngestOptions = { preferDayFirst: assumeDayFirst(), ...opts };
        const progress = progressFor(file.name, token);
        try {
          // The words the user taught Loupe go with the file: detection and mapping read them as synonyms.
          const words = synonymsOf(useLearned.getState().words);
          const res = await engine().ingest(file, merged, progress.callback, words);
          progress.close();
          if (token !== loadSeq) return;
          if (res.status === "ok") set({ lastFile: file, lastOptions: merged });
          if (mode === "reread") await adoptReread(res);
          else handleLoad(res, file);
        } catch (e) {
          progress.close();
          if (token === loadSeq) set({ loading: null, error: toError(e) });
        }
      },
    );

  // Answers the asked questions again after the analysis was rebuilt, in place and in their order;
  // one that no longer applies comes back with its reason (QuestionAnswer.error). A later rebuild
  // supersedes this one.
  const reanswer = async (asked: readonly QuestionAnswer[]) => {
    const token = ++answerSeq;
    set({ questionsLoading: true });
    const locale = useSettings.getState().numberLocale;
    const fresh = new Map<string, QuestionAnswer>();
    try {
      for (const q of asked) {
        const answer = await engine().answerQuestion(
          {
            id: q.id,
            question: q.question,
            understood: q.understood,
            notes: q.notes,
            ask: q.ask,
            order: q.order,
            filters: q.filters,
          },
          locale,
        );
        if (token !== answerSeq) return;
        fresh.set(q.id, answer);
      }
      set((st) => ({ questions: st.questions.map((q) => fresh.get(q.id) ?? q), questionsLoading: false }));
    } catch (e) {
      if (token === answerSeq) set({ questionsLoading: false, error: toError(e) });
    }
  };

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
        // "Auto" means the shape detection picked for this industry, so every path reads it the same way.
        subDomainId: shapeFor(s, domainId, subDomainId) ?? undefined,
        mappingOverrides: s.mappingOverrides,
        classOverrides: s.classOverrides,
        roleOverrides: s.roleOverrides,
        kpiRenames: s.kpiRenames,
        hiddenColumns: s.hiddenColumns,
        customKpis: s.customKpis,
        outcome: s.outcome,
        numberLocale: settings.numberLocale,
        currency: settings.currencyOverride,
      });
      const specs = [...context.charts, ...s.customCharts];
      // A reading asked for before this configure describes older choices.
      understandSeq++;
      // Reconfiguring keeps the user's layout; the first configure after a
      // load starts from the specs' default sizes. The charts come in the plan's order.
      set({
        context,
        // The analysis's own reading of the table is authoritative from here on.
        understanding: context.understanding ?? null,
        understandingPending: false,
        // The health of the columns in use: problems in hidden columns no longer count.
        health: context.health,
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
      // Every step after Detect works on the analysis of the industry chosen on Detect, so it is
      // built first when missing, and rebuilt when the choice changed since (a change on Detect is
      // only remembered until then; applying it later, on an unrelated change, would surprise).
      if (step !== "upload" && step !== "detect" && s.domainId && (!s.context || choiceChanged(s))) {
        void get().confirmDomain(s.domainId, s.subDomainId, { goTo: step });
        return;
      }
      set({ step });
      if (step === "insights" && !s.insights) void get().loadInsights();
    },

    loadFile: (file, opts = {}) => readFile(file, opts, "new"),

    loadSample: (id, opts) =>
      queueLoad(
        {
          phase: "generating",
          title: "Generating demo data…",
          detail: "Deterministic, seeded and clearly labelled as demo",
          progress: null,
        },
        async (token) => {
          try {
            const res = await engine().ingestSample(id);
            if (token !== loadSeq) return;
            // A demo has no file to re-parse: forget any earlier one, or a date-order fix would reload it.
            if (res.status === "ok") set({ lastFile: null, lastOptions: {} });
            handleLoad(res, null);
          } catch (e) {
            if (token === loadSeq) set({ loading: null, error: toError(e) });
            return;
          }
          // A link such as /app?sample=sales&step=dashboard opens the demo on that step.
          const goTo = opts?.goTo;
          const s = get();
          if (goTo && goTo !== "upload" && goTo !== "detect" && s.domainId)
            await get().confirmDomain(s.domainId, s.subDomainId, { goTo });
        },
      ),

    setDateOrder: async (column, order) => {
      const s = get();
      if (!s.lastFile) return;
      await readFile(
        s.lastFile,
        {
          ...s.lastOptions,
          dateOrderOverrides: { ...(s.lastOptions.dateOrderOverrides ?? {}), [column]: order },
        },
        "reread",
      );
    },

    chooseSheet: async (sheet) => {
      const file = get().pendingFile;
      if (!file) return;
      set({ sheets: null });
      await readFile(file, { sheet }, "new");
    },

    pickOneSheet: async () => {
      const file = get().lastFile;
      if (!file) return;
      try {
        const sheets = await engine().listSheets(file);
        set({ sheets, pendingFile: file });
      } catch (e) {
        set({ error: toError(e) });
      }
    },

    resolveLargeFile: async (opts) => {
      const file = get().pendingFile;
      set({ largeFile: null });
      if (!file || !opts) {
        set({ pendingFile: null });
        return;
      }
      await readFile(file, opts, "new");
    },

    unpivot: () =>
      queueLoad({ phase: "profiling", title: "Unpivoting columns…", progress: null }, async (token) => {
        try {
          const res = await engine().unpivot();
          // The same file reshaped: the currency chosen for it stays.
          if (token === loadSeq) handleLoad(res, null, true);
        } catch (e) {
          if (token === loadSeq) set({ loading: null, error: toError(e) });
        }
      }),

    pivot: () =>
      queueLoad(
        { phase: "profiling", title: "Turning metrics into columns…", progress: null },
        async (token) => {
          try {
            const res = await engine().pivot();
            // The same file reshaped: the currency chosen for it stays.
            if (token === loadSeq) handleLoad(res, null, true);
          } catch (e) {
            if (token === loadSeq) set({ loading: null, error: toError(e) });
          }
        },
      ),

    startOver: () => {
      resetEngine();
      // Calls in flight on the old worker never settle: retire the dashboard request, the insights
      // and answers and any load, and start a fresh load queue (the old one would wait forever).
      retireRequests();
      loadSeq++;
      loadChain = Promise.resolve();
      // The currency chosen for this file goes with it.
      useSettings.getState().setCurrencyOverride(null);
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
      const before = get().context;
      try {
        await configureNow(domainId, subDomainId ?? null);
        const ctx = get().context;
        // Confirming the industry and data shape the analysis already has (Next on Detect after a
        // look back) keeps the user's layout, mode, filters and answers. Another industry has other
        // KPIs and charts, and another shape other headline KPIs: they start from the recommendation.
        const same =
          before !== null &&
          ctx !== null &&
          before.domain.id === ctx.domain.id &&
          before.subDomainId === ctx.subDomainId;
        set({
          loading: null,
          step: opts?.goTo ?? "dashboard",
          ...(same
            ? {}
            : {
                datePreset: defaultPresetFor(ctx),
                customRange: null,
                dimFilters: [],
                crossFilter: null,
                drill: {},
                insights: null,
                questions: [],
                mode: "analyst" as const,
                kpiLayout: null,
                extraKpis: [],
              }),
        });
        get().refresh();
        // An industry or shape the user picked on Detect is learned once it is built.
        if (get().industryChosen) {
          set({ industryChosen: false });
          teachChoice(domainId, subDomainId ?? null);
        }
        if (opts?.goTo === "insights") void get().loadInsights();
      } catch {
        set({ loading: null });
      }
    },

    chooseIndustry: (domainId, subDomainId) => {
      set({ domainId, subDomainId, industryChosen: true });
      // Built when the user moves on; the reading of the table names the chosen industry at once.
      void refreshUnderstanding();
    },

    setOutcome: (outcome) => {
      set({ outcome });
      void get().reconfigure();
    },

    setBusiness: (patch) => {
      set((s) => ({ business: { ...s.business, ...patch } }));
      if ("period" in patch && get().context) get().refresh();
    },

    setMappingOverride: (fieldId, column) => {
      set((s) => ({ mappingOverrides: { ...s.mappingOverrides, [fieldId]: column } }));
      const ctx = get().context;
      const label = ctx?.domain.fields.find((f) => f.id === fieldId)?.label;
      if (ctx && label) teach((r) => teachField(r, ctx.domain.id, fieldId, { column, label }));
      void get().reconfigure();
    },

    setMappingOverrides: (overrides) => {
      const before = get().mappingOverrides;
      set({ mappingOverrides: { ...overrides } });
      const ctx = get().context;
      if (ctx) {
        // Only the fields that changed: one set back to automatic is forgotten.
        const ids = new Set([...Object.keys(before), ...Object.keys(overrides)]);
        for (const id of ids) {
          const was = Object.hasOwn(before, id) ? before[id] : undefined;
          const now = Object.hasOwn(overrides, id) ? overrides[id] : undefined;
          if (was === now) continue;
          const label = ctx.domain.fields.find((f) => f.id === id)?.label ?? id;
          teach((r) => teachField(r, ctx.domain.id, id, now === undefined ? null : { column: now, label }));
        }
      }
      void get().reconfigure();
    },

    setClassOverride: (key, values) => {
      set((s) => ({ classOverrides: { ...s.classOverrides, [key]: values } }));
      const ctx = get().context;
      if (ctx) {
        const [fieldId = "", classId = ""] = key.split(".");
        const field = ctx.domain.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
        const cls = ctx.domain.valueClasses[fieldId]?.find((c) => c.id === classId)?.label ?? classId;
        teach((r) => teachClass(r, ctx.domain.id, key, { values, label: `${field} · ${cls}` }));
      }
      void get().reconfigure();
    },

    setRoleOverride: (column, role, additivity, kind) => {
      set((s) => {
        const next = { ...s.roleOverrides };
        if (role === null) delete next[column];
        else next[column] = { role, additivity, ...(kind ? { kind } : {}) };
        return { roleOverrides: next };
      });
      teach((r) =>
        teachRole(r, column, role === null ? null : { role, ...(additivity ? { additivity } : {}) }),
      );
      void get().reconfigure();
    },

    setColumnsHidden: (columns, hidden) => {
      set((s) => {
        const gone = new Set(hidden ? columns : []);
        return {
          hiddenColumns: hidden
            ? [...new Set([...s.hiddenColumns, ...columns])]
            : s.hiddenColumns.filter((c) => !columns.includes(c)),
          // A filter on a column that is now hidden would still narrow every figure, so it goes too.
          dimFilters: s.dimFilters.filter((f) => !gone.has(f.column)),
          crossFilter: s.crossFilter && gone.has(s.crossFilter.column) ? null : s.crossFilter,
          // Nothing is computed from a hidden column, so it can't be the outcome: Loupe chooses again.
          outcome: typeof s.outcome === "string" && gone.has(s.outcome) ? undefined : s.outcome,
        };
      });
      teach((r) => teachHidden(r, columns, hidden));
      void get().reconfigure();
    },

    dismissReplaced: () => set({ replacedDismissed: true }),

    undoLearned: () => {
      const s = get();
      const l = s.learned;
      if (!l?.applied || !s.detection) return;
      // Not a correction: the rule stays as it was, for the next file like this one.
      set({
        ...undoApplied(choicesOf(s), l.applied, detectedChoice(s.detection)),
        learned: { ...l, applied: null },
      });
      // Built at once when an analysis exists; on Detect before that, the choice is built on Next as
      // usual (reconfigure only reads the table again).
      void get().reconfigure();
    },

    forgetLearned: () => {
      const l = get().learned;
      if (!l) return;
      get().undoLearned();
      if (l.ruleId) useLearned.getState().removeRule(l.ruleId);
      set((s) => ({ learned: s.learned && { ...s.learned, ruleId: null, applied: null } }));
    },

    keepFit: (domainId) => set({ fitKept: domainId }),

    rememberWord: (fieldId, column) => {
      const s = get();
      const ctx = s.context;
      const field = ctx?.domain.fields.find((f) => f.id === fieldId);
      const col = s.profile?.columns.find((c) => c.name === column);
      // Registry fields list synonyms; the ones Loupe adds for the user's KPIs and columns list none.
      if (!ctx || !field || !field.synonyms.length || !col || ctx.domain.generic) return;
      useLearned.getState().addWord(
        {
          domainId: ctx.domain.id,
          domainName: ctx.domain.name,
          fieldId,
          fieldLabel: field.label,
          header: column,
          key: headerKey(col.tokens),
        },
        Date.now(),
      );
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
      const ctx = get().context;
      if (ctx) teachChoice(ctx.domain.id, id);
      void get().reconfigure();
    },

    reconfigure: async () => {
      const s = get();
      if (!s.summary) return;
      // Nothing built yet (Detect): a correction is never built behind the user's back. The reading
      // of the table follows it, and the choice is built when the user moves on.
      if (!s.context) {
        await refreshUnderstanding();
        return;
      }
      if (!s.domainId) return;
      // An industry chosen on Detect but not built yet is built the way confirming builds it (from
      // its recommendation), never slipped in by an unrelated change such as the currency.
      if (s.context && s.domainId !== s.context.domain.id) {
        await get().confirmDomain(s.domainId, s.subDomainId, { goTo: s.step });
        return;
      }
      try {
        await configureNow(s.domainId, s.subDomainId);
        get().refresh();
        // Mapping, roles and names changed: the insights are recomputed, and every question asked
        // is answered again under the new definitions rather than dropped.
        set({ insights: null });
        const asked = get().questions;
        if (asked.length) await reanswer(asked);
      } catch {
        /* error already in state */
      }
    },

    setMode: (mode) => {
      set({ mode });
      get().refresh();
    },

    setDashView: (dashView) => set({ dashView }),

    setPageTitle: (title) => set({ pageTitle: title.trim() || null }),

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

    addCustomChart: (spec, opts) => {
      set((s) => ({
        customCharts: [...s.customCharts, spec],
        widgets: [...s.widgets, { id: spec.id, w: spec.size.w, h: spec.size.h }],
        ...(opts?.select === false ? {} : { selected: { type: "chart" as const, id: spec.id } }),
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
      set((s) => {
        // With the user's own layout, "Add to dashboard" adds to (or removes from) its supporting tiles.
        if (s.kpiLayout) {
          const l = s.kpiLayout;
          const shown = [...l.hero, ...l.supporting, ...l.columns].includes(id);
          return {
            kpiLayout: shown
              ? {
                  hero: l.hero.filter((x) => x !== id),
                  supporting: l.supporting.filter((x) => x !== id),
                  columns: l.columns.filter((x) => x !== id),
                }
              : { ...l, supporting: [...l.supporting, id] },
          };
        }
        return {
          extraKpis: s.extraKpis.includes(id) ? s.extraKpis.filter((x) => x !== id) : [...s.extraKpis, id],
        };
      });
      get().refresh();
    },

    setKpiLayout: (layout) => {
      set({
        kpiLayout: layout && {
          hero: [...new Set(layout.hero)].slice(0, MAX_HEADLINE),
          supporting: [...new Set(layout.supporting)],
          columns: [...new Set(layout.columns)],
        },
      });
      get().refresh();
    },

    saveCustomKpi: async (kpi, place = "supporting") => {
      const s = get();
      const isNew = !s.customKpis.some((k) => k.id === kpi.id);
      set({
        customKpis: isNew ? [...s.customKpis, kpi] : s.customKpis.map((k) => (k.id === kpi.id ? kpi : k)),
      });
      if (isNew && place !== "none") {
        // A new KPI goes straight onto the dashboard where the user asked (headline only while there is room).
        const layout = kpiLayoutOf(get());
        const toHero = place === "hero" && layout.hero.length < MAX_HEADLINE;
        set({
          kpiLayout: {
            hero: toHero ? [...layout.hero, kpi.id] : layout.hero,
            supporting: toHero ? layout.supporting : [...layout.supporting, kpi.id],
            columns: layout.columns,
          },
        });
      }
      await get().reconfigure();
    },

    removeCustomKpi: (id) => {
      set((s) => ({
        customKpis: s.customKpis.filter((k) => k.id !== id),
        kpiLayout: s.kpiLayout && {
          hero: s.kpiLayout.hero.filter((x) => x !== id),
          supporting: s.kpiLayout.supporting.filter((x) => x !== id),
          columns: s.kpiLayout.columns.filter((x) => x !== id),
        },
        extraKpis: s.extraKpis.filter((x) => x !== id),
      }));
      void get().reconfigure();
    },

    resetCustomisation: () => {
      set((s) => {
        const custom = new Set(s.customCharts.map((c) => c.id));
        const specs = allSpecs(s);
        return {
          kpiLayout: null,
          extraKpis: [],
          // Recommended charts in their recommended order and sizes, then the user's own charts as they are.
          widgets: [
            ...widgetsFor(specs.filter((x) => !custom.has(x.id))),
            ...s.widgets.filter((w) => custom.has(w.id)).map((w) => ({ ...w, hidden: false })),
          ],
        };
      });
      get().refresh();
    },

    select: (selected) => set({ selected }),

    focusChart: (id) => {
      // Every chart is on the full dashboard (the one-page view holds only five), so a chart is
      // always focused there.
      set({ highlight: id, step: "dashboard", dashView: "full" });
      // The dashboard mounts only after the previous step's exit animation, so look for the chart
      // frame by frame (for up to about 2 s) rather than after a fixed delay, then bring it to the
      // middle of the screen. Charts above it can still grow as their data arrives, so its place is
      // checked once more after the scroll.
      const started = performance.now();
      const seek = () => {
        const el = document.getElementById(`chart-${id}`);
        if (!el) {
          if (performance.now() - started < 2000) requestAnimationFrame(seek);
          return;
        }
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
          const r = el.getBoundingClientRect();
          if (
            el.isConnected &&
            Math.abs(r.top + r.height / 2 - window.innerHeight / 2) > window.innerHeight / 4
          )
            el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 700);
      };
      requestAnimationFrame(seek);
      // Drop the highlight later unless another chart has been focused meanwhile.
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
      // Insights wait until the newest run has finished (refreshIdle).
      refreshStarted();
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(async () => {
        refreshTimer = null;
        const s = get();
        const ctx = s.context;
        if (!ctx) {
          refreshSettled();
          return;
        }
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
        const layout = kpiLayoutOf(s);
        const kpiIds = [...new Set([...layout.hero, ...layout.supporting, ...layout.columns])];
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
            // Settled unless another refresh was asked for meanwhile (that one settles it).
            if (!refreshTimer) refreshSettled();
            if (get().step === "insights") void get().loadInsights();
          }
        } catch (e) {
          if (id === requestSeq) {
            set({ computing: false, error: toError(e) });
            if (!refreshTimer) refreshSettled();
          }
        }
      }, 90);
    },

    askQuestion: async (q) => {
      if (!get().context) return;
      // The dashboard's own selections, without a chart's click-to-filter (tagged with its source).
      const filters: Filter[] =
        q.scope === "dashboard"
          ? get()
              .filters()
              .filter((f) => !("sourceId" in f))
          : [];
      set({ questionsLoading: true });
      try {
        const id = `q_${Date.now().toString(36)}_${get().questions.length}`;
        const answer = await engine().answerQuestion(
          {
            id,
            question: q.question,
            understood: q.understood,
            notes: q.notes,
            ask: q.ask,
            order: q.order,
            filters,
          },
          useSettings.getState().numberLocale,
        );
        set((s) => ({ questions: [answer, ...s.questions], questionsLoading: false }));
      } catch (e) {
        set({ questionsLoading: false, error: toError(e) });
      }
    },

    removeQuestion: (id) => set((s) => ({ questions: s.questions.filter((q) => q.id !== id) })),

    loadInsights: () => {
      if (!get().context) return Promise.resolve();
      if (insightsLoad) return insightsLoad;
      const token = ++insightsSeq;
      set({ insightsLoading: true });
      const run = async () => {
        try {
          for (;;) {
            // Insights are read from the worker's last dashboard results, so a refresh still pending
            // or running would make them describe the previous selection (after "Clear all", the
            // filtered one): wait for it, and once more if the selection changes while computing.
            await refreshIdle;
            const ctx = get().context;
            if (token !== insightsSeq) return;
            if (!ctx) break;
            const gen = refreshGen;
            const insights = await engine().insights(useSettings.getState().numberLocale);
            if (token !== insightsSeq) return;
            if (gen === refreshGen && get().context === ctx) {
              set({ insights, insightsLoading: false });
              return;
            }
          }
          set({ insightsLoading: false });
        } catch (e) {
          if (token === insightsSeq) set({ insightsLoading: false, error: toError(e) });
        } finally {
          if (token === insightsSeq) insightsLoad = null;
        }
      };
      insightsLoad = run();
      return insightsLoad;
    },

    applyConfig: async (cfg) => {
      // Restores the persisted settings first (number format, currency), then
      // the overrides, then configures. A configure error propagates to the caller.
      const settings = useSettings.getState();
      settings.setNumberLocale(cfg.settings.numberLocale);
      if (cfg.settings.chartTheme) settings.setChartTheme(cfg.settings.chartTheme);
      // The config stores the effective currency. Matching what this file
      // detects needs no override (so none outlives this file); a different,
      // supported code becomes the override. An unknown code is not applied:
      // the config is outside input and the code is printed in every figure.
      const detected = get().profile?.currency.code ?? null;
      if (cfg.settings.currency === detected) settings.setCurrencyOverride(null);
      else if (SUPPORTED_CURRENCIES.includes(cfg.settings.currency))
        settings.setCurrencyOverride(cfg.settings.currency);
      const business = cfg.business ?? {};
      set((s) => ({
        // The saved settings replace whatever a learned rule set, so its notice goes.
        learned: s.learned && { ...s.learned, applied: null },
        mappingOverrides: cfg.mappingOverrides,
        classOverrides: cfg.classOverrides,
        roleOverrides: cfg.roleOverrides,
        // A config saved before the outcome could be chosen has none: Loupe chooses, as it did then.
        outcome: cfg.outcome,
        kpiRenames: cfg.kpiRenames,
        kpiTargets: cfg.kpiTargets,
        hiddenColumns: cfg.hiddenColumns,
        customKpis: cfg.customKpis as UserKpi[],
        kpiLayout: cfg.kpiLayout ?? null,
        // The period becomes the trend grain sent to the engine, so only a known grain is kept.
        business: {
          model: business.model,
          goal: business.goal,
          period: isPeriodGrain(business.period) ? business.period : undefined,
          notes: business.notes,
        },
        customCharts: cfg.dashboard.customCharts as ChartSpec[],
      }));
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
                title: sv.title,
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
        // Configs saved before the one-page view have neither: keep the current view and the automatic title.
        ...(cfg.dashboard.view ? { dashView: cfg.dashboard.view } : {}),
        pageTitle: cfg.dashboard.pageTitle?.trim() || null,
        datePreset: cfg.dashboard.datePreset as DatePreset,
        customRange:
          cfg.dashboard.datePreset === "custom" && dateRange && dateRange.kind === "dateRange"
            ? { from: dateRange.from, to: dateRange.to }
            : null,
        dimFilters: savedFilters.filter((f) => f.kind !== "dateRange" && f !== cross).map(plainFilter),
        crossFilter,
        // The config does not record drill paths, and the old insights and answers describe other settings.
        drill: {},
        insights: null,
        questions: [],
        step: "dashboard",
      });
      get().refresh();
    },
  };
});

/**
 * The KPI layout in effect: the user's (Customise step) or the recommended
 * one (the engine's hero, supporting and column KPIs, plus any added from
 * the KPI details), keeping only KPIs that are available in the current
 * analysis (a remapping can take one away).
 */
export function kpiLayoutOf(s: Pick<WorkspaceState, "context" | "kpiLayout" | "extraKpis">): KpiLayout {
  const ctx = s.context;
  if (!ctx) return { hero: [], supporting: [], columns: [] };
  const available = new Set(ctx.kpis.filter((k) => k.available && !k.hidden).map((k) => k.id));
  const keep = (ids: string[]) => ids.filter((id) => available.has(id));
  if (s.kpiLayout)
    return {
      hero: keep(s.kpiLayout.hero),
      supporting: keep(s.kpiLayout.supporting),
      columns: keep(s.kpiLayout.columns),
    };
  const { hero, supporting, columns } = ctx.selection;
  const shown = new Set([...hero, ...supporting, ...columns]);
  return {
    hero: keep(hero),
    supporting: keep([...supporting, ...s.extraKpis.filter((k) => !shown.has(k))]),
    columns: keep(columns),
  };
}

/** Built-in plus custom chart specs, the list widgets are resolved against. */
export function allSpecs(s: Pick<WorkspaceState, "context" | "customCharts">): ChartSpec[] {
  return [...(s.context?.charts ?? []), ...s.customCharts];
}
