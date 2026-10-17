/**
 * Stateful analysis session (lives inside the Web Worker). Holds the dataset
 * and every derived artefact; the UI only ever receives small results.
 *
 * Lifecycle: ingest() / ingestSample() / unpivot() / pivot() → adopt()
 * (profile, health, domain detection) → configure() (domain + mapping +
 * overrides → KPI resolution, chart specs, SQL/DAX per KPI; hidden columns
 * leave the profile everything is built from) → kpiBatch() / chart() /
 * rowCount() / insights() / timeIntel() → export*(). Calling a method before
 * its stage throws ("No dataset loaded." / "No analysis context."), and
 * adopting a new dataset drops the context, so configure() must run again.
 *
 * One instance per worker (workers/engine.worker.ts). Every return value is
 * structured-cloned across the Comlink boundary, so results stay small; the
 * dataset itself only leaves as export bytes, which the worker transfers
 * instead of copying. Nothing in the engine touches the network.
 *
 * Dates are epoch milliseconds of the wall-clock time read from the file,
 * stored as if UTC (hence the getUTC* formatting). NaN is the null sentinel
 * in number and date columns, -1 in string codes and boolean values.
 */
import { generateCodeHtml } from "@/engine/export/codeHtml";
import { prettySql } from "@/engine/compile/sqlFormat";
import { exportKind } from "@/engine/core/booleans";
import type { Dataset, IngestOptions, LargeFileAssessment, ParseReport } from "@/engine/core/types";
import {
  formatDay,
  isoDate,
  isoDateTime,
  isoTime,
  todayWallClock,
  type TimeGrain,
} from "@/engine/core/dates";
import { currencySymbol, formatPlain, type FormatOptions, type NumberLocale } from "@/engine/core/format";
import { ingestFile, workbookSheets, type IngestProgress } from "@/engine/parse";
import { fileKindFromName } from "@/engine/parse";
import { profileDataset } from "@/engine/profile/profile";
import { assessHealth, type HealthReport } from "@/engine/profile/quality";
import { DataCheck, type CheckedRow, type CheckView } from "@/engine/profile/dataCheck";
import { withoutColumns } from "@/engine/profile/hidden";
import { replacedColumns, type ReplacedColumn } from "@/engine/profile/replaced";
import { applyRoleOverride } from "@/engine/profile/roles";
import type {
  Additivity,
  ColumnProfile,
  DatasetProfile,
  SemanticRole,
  TallFormatInfo,
  ValueCount,
} from "@/engine/profile/types";
import { detectDomain, type DetectionResult } from "@/engine/detect/detect";
import { assignFields, matchableColumns } from "@/engine/detect/match";
import { buildMapping, type Mapping } from "@/engine/detect/mapping";
import { buildGenericDomain, GENERIC_ID } from "@/engine/detect/generic";
import { grainLabel } from "@/engine/profile/structure";
import { friendly, friendlyStart } from "@/engine/core/labels";
import { resolveKpis, selectKpis, type KpiResolutionMap, type KpiSelection } from "@/engine/kpi/resolve";
import { columnExtras, isColumnId } from "@/engine/kpi/columnKpis";
import { isUserKpiId, userKpiExtras, type UserKpi } from "@/engine/kpi/userKpis";
import { makeDaxContext, makeResolver, makeSqlContext, type CompileNames } from "@/engine/kpi/context";
import {
  computeKpis,
  computeTimeIntel,
  dateBounds,
  evaluateMany,
  type KpiBatch,
  type TimeIntelValue,
} from "@/engine/kpi/compute";
import { kpiQuery, quoteIdent } from "@/engine/compile/sql";
import { exprDax } from "@/engine/compile/dax";
import type { Resolver } from "@/engine/query/evaluate";
import { describeFilter, type Filter, selectRowsCached } from "@/engine/query/filter";
import type { Expr } from "@/engine/query/expr";
import { customSpec, recommendCharts, type SkippedChart } from "@/engine/charts/recommend";
import { computeChartData, type DrillState } from "@/engine/charts/data";
import { specColumns } from "@/engine/charts/columnUsage";
import { askMeasure, axisFor, type AskContext, type AskOrder, type ChartAsk } from "@/engine/charts/ask";
import { answerHeadline, questionFilters, unplacedMessage } from "@/engine/charts/answer";
import { questionSql, type QuestionKey } from "@/engine/compile/questionSql";
import type { ChartData, ChartKind, ChartSpec } from "@/engine/charts/types";
import { generateInsights, type Insight, type InsightKpi } from "@/engine/insights/insights";
import { generateSample, SAMPLES } from "@/engine/samples";
import { compileNames } from "@/engine/export/names";
import type { ExportContext } from "@/engine/export/context";
import { buildPowerBiPackage, type PackageManifest } from "@/engine/export/powerbi";
import { dashboardCharts } from "@/engine/export/dashboardCharts";
import { generateSqlFile } from "@/engine/export/sqlFile";
import { dateRelColumn, generateDaxFile } from "@/engine/export/daxFile";
import { newColumnsFor, type NewColumn } from "@/engine/export/readme";
import { dictionaryCsv, dictionaryMarkdown } from "@/engine/export/dictionary";
import { datasetToCsvChunks, roundAggregate, tableToCsv } from "@/engine/export/csv";
import { unpivotDataset } from "@/engine/parse/unpivot";
import { pivotDataset, pivotPlan, pivotSummary, type PivotPlan } from "@/engine/parse/pivot";
import { DOMAINS, getDomain } from "@/registry";
import type { DomainDef, FieldDef, KpiFormat, SubDomainDef, ValueClassDef } from "@/registry/schema";
import type { DateCadence } from "@/engine/core/periods";

/** Headline facts about the loaded dataset, for the UI chrome. */
export interface DatasetSummary {
  id: string;
  name: string;
  fileName: string;
  /** The source's FileKind: "csv", "tsv", "xlsx", "xls", "json", "sample" or "derived". */
  kind: string;
  isDemo: boolean;
  sampleId?: string;
  rowCount: number;
  columnCount: number;
  /** Size of the source file in bytes; 0 for generated demo data. */
  sizeBytes: number;
  /** Workbooks only: the sheet that was read, shown next to the file name. */
  sheet?: string;
}

/** One entry of the domain picker (every registry domain, not just detected ones). */
export interface DomainListItem {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  flagship: boolean;
  subDomains: Array<{ id: string; name: string }>;
}

/**
 * Outcome of loading a file or sample. "needs-sheet" (a workbook with several
 * sheets and no `sheet` option) and "needs-decision" (a file too large to load
 * whole) mean nothing was adopted: ask the user, then call ingest() again with
 * the chosen IngestOptions. `timings` are milliseconds per phase.
 */
export type LoadResult =
  | {
      status: "ok";
      summary: DatasetSummary;
      report: ParseReport;
      profile: DatasetProfile;
      health: HealthReport;
      detection: DetectionResult;
      domains: DomainListItem[];
      timings: Record<string, number>;
      /** Columns that look replaced by a cleaned copy (profile/replaced.ts), offered in step 3 as columns to hide. */
      replaced: ReplacedColumn[];
    }
  | { status: "needs-decision"; assessment: LargeFileAssessment }
  | { status: "needs-sheet"; sheets: string[] };

/** User correction of a column's profiled semantic role (and optionally its additivity). */
export interface RoleOverride {
  role: SemanticRole;
  additivity?: Additivity;
}

/** Everything configure() needs; the UI rebuilds it from the workspace store on every reconfigure. */
export interface ContextRequest {
  /** Registry domain id; GENERIC_ID or an unknown id builds the profile-driven generic domain. */
  domainId: string;
  /** Ignored when it is not a sub-domain of the chosen domain (best coverage is used instead). */
  subDomainId?: string;
  /** Field id → column name; null forces the field unmapped. Ignored for the generic domain. */
  mappingOverrides?: Record<string, string | null>;
  /** "fieldId.classId" → raw values that belong to that class. Ignored for the generic domain. */
  classOverrides?: Record<string, string[]>;
  /** Column name → corrected role, applied on top of the original profile. */
  roleOverrides?: Record<string, RoleOverride>;
  /** KPI id → display name; also becomes the measure name in DAX/TMDL exports. */
  kpiRenames?: Record<string, string>;
  /**
   * Columns the user hid in step 3: they stay in the file, the data grid and
   * the exports, but no KPI, chart, filter, insight or question reads them.
   * Names not in the file are ignored, and so is a mapping override that
   * points at a hidden column (the field is matched again without it).
   */
  hiddenColumns?: string[];
  /**
   * KPIs the user built in the Customise step (kpi/userKpis.ts): they resolve,
   * compile to SQL and DAX and export like template KPIs. One that needs a
   * column not in the analysis is left out, with its reason in the result.
   */
  customKpis?: UserKpi[];
  numberLocale: NumberLocale;
  /** ISO 4217 code chosen by the user, or null to use the currency detected in the profile. */
  currency: string | null;
}

/** A KPI as the UI sees it: definition, availability and its compiled SQL/DAX. */
export interface KpiMeta {
  id: string;
  /** Display name, after kpiRenames. */
  name: string;
  short?: string;
  definition: string;
  formula: string;
  format: KpiFormat;
  direction: "higher" | "lower" | "neutral";
  tier: "hero" | "supporting" | "detail";
  group: string;
  /** Helper measure that other KPIs reference; never part of the display selection. */
  hidden: boolean;
  available: boolean;
  /** Label of the formula variant chosen for this mapping (KPIs can have fallbacks). */
  variantLabel?: string;
  caveat?: string;
  /** `column` is the original column name. */
  fieldsUsed: Array<{ fieldId: string; label: string; column: string }>;
  classesUsed: Array<{ key: string; label: string; values: string[] }>;
  /** Set when unavailable: why, and a suggested substitute. */
  unavailableReason?: string;
  substitute?: string;
  benchmark?: { low?: number; high?: number; note: string };
  pitfalls: string[];
  /** Undefined when the KPI is unavailable or could not be compiled to that language. */
  sql?: string;
  dax?: string;
  /** Collision-free measure name used in the DAX and TMDL exports. */
  daxName: string;
}

/** The chosen domain's definition, trimmed to what the mapping and KPI screens need. */
export interface DomainSummary {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  entity: string;
  fields: FieldDef[];
  valueClasses: Record<string, ValueClassDef[]>;
  subDomains: SubDomainDef[];
  pitfalls: string[];
  generic: boolean;
}

/** A business question to answer (step 5); `id` is chosen by the caller. */
export interface QuestionRequest {
  id: string;
  question: string;
  /** How it was read, e.g. "Average Customer Rating by City". */
  understood: string;
  notes: string[];
  ask: ChartAsk;
  order: AskOrder;
  filters: Filter[];
}

/** The answer: rows computed by the engine, a headline, and the SQL returning the same rows. */
export interface QuestionAnswer {
  id: string;
  question: string;
  understood: string;
  notes: string[];
  order: AskOrder;
  ask: ChartAsk;
  filters: Filter[];
  measures: Array<{ id: string; label: string; format: KpiFormat }>;
  /** Heading of the group column (a column name, "Weekday", "Hour of day"); null for one overall row. */
  keyLabel: string | null;
  /** One row per group: its label, raw key (as in ChartCategory) and a value per measure. */
  rows: Array<{ label: string; raw: string | number | null; values: Array<number | null> }>;
  /** Groups ranked below the top N, not listed. */
  more: number;
  headline: string;
  /** "" when no measure has SQL (see `skipped`). */
  sql: string;
  skipped: Array<{ label: string; reason: string }>;
  error?: string;
}

/** Result of configure(): the resolved analysis context the dashboard is built from. */
export interface ContextResult {
  domain: DomainSummary;
  /** The sub-domain actually used (requested, else best signal coverage). */
  subDomainId: string;
  mapping: Mapping;
  /** Every KPI of the domain, available or not. */
  kpis: KpiMeta[];
  selection: KpiSelection;
  /** Recommended chart specs; the worker keeps the same list, so requests can refer to them by id. */
  charts: ChartSpec[];
  skippedCharts: SkippedChart[];
  /** Original name of the primary date column; null when there is none or it did not parse as dates. */
  dateColumn: string | null;
  /**
   * Min/max of dateColumn (wall-clock epoch ms), ignoring blanks, and how
   * often its dates fall (monthly snapshots, daily events): presets finer
   * than the cadence are not offered.
   */
  dateBounds: { min: number; max: number; cadence?: DateCadence } | null;
  /**
   * Profile after role overrides, without the hidden columns: the columns
   * every KPI, chart, filter and question can use.
   */
  profile: DatasetProfile;
  /** The hidden columns that exist in the file, in file order. */
  hiddenColumns: string[];
  /** Data health of the columns in use: problems in hidden columns are left out, so they don't lower the score. */
  health: HealthReport;
  /** The user's KPIs that couldn't be built, and why (a hidden or missing column, text where a number is needed). */
  customKpiIssues: Array<{ id: string; reason: string }>;
  grainLabel: string;
  /** Effective ISO 4217 currency (override or detected). */
  currency: string;
  /**
   * Columns offered in the filter rail: dimension, geo or boolean roles with
   * 2–500 distinct values and non-numeric storage, mapped domain fields first,
   * then by ascending cardinality.
   */
  dimensions: Array<{ column: string; label: string; distinct: number; geo?: string }>;
}

/** One chart to compute. Optional fields carry per-widget overrides from the dashboard. */
export interface ChartRequest {
  specId: string;
  /** Trend grain chosen by the user ("primary period"); time charts only. */
  grain?: TimeGrain;
  /** Full spec for custom charts, which the session does not know by id. */
  spec?: ChartSpec;
  /** Overrides the global filters for this chart (e.g. the cross-filter source ignores its own selection). */
  filters?: Filter[];
  /** Alternative chart kind chosen by the user. */
  kind?: ChartKind;
  topN?: number;
  drill?: DrillState;
}

/** Everything one dashboard refresh needs; see computeDashboard(). */
export interface DashboardRequest {
  filters: Filter[];
  /** KPIs to compute; unknown or unavailable ids are skipped silently. */
  kpiIds: string[];
  charts: ChartRequest[];
  numberLocale: NumberLocale;
}

/** `rows` is the filtered row count; `ms` the wall time of the whole computation. */
export interface DashboardResult {
  kpis: KpiBatch;
  charts: Record<string, ChartData>;
  rows: number;
  ms: number;
}

// A fresh mutable copy of the read-only registry array; the shared array itself is never handed out.
const DOMAIN_LIST = (): DomainDef[] => [...DOMAINS];

/** Display name of a KPI: the user's rename when it is not blank, else the registry name. */
const displayName = (renames: Readonly<Record<string, string>>, id: string, fallback: string): string =>
  renames[id]?.trim() || fallback;

// ---------------------------------------------------------------- AI payload masking

/** Street-type words; with a digit in the same value they mark an address ("12 MG Road", "Flat 4B, Sunrise Apartments"). */
const STREET_WORDS =
  /\b(?:street|st|road|rd|avenue|ave|lane|ln|boulevard|blvd|drive|highway|hwy|nagar|marg|colony|sector|block|apartments?|apt|flat|floor|house|plot|suite|building|bldg|tower|layout)\b/i;
const URL_LIKE =
  /\b(?:https?:\/\/|ftp:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|in|co|ai|app|dev|info|biz|me|us|uk|gov|edu|shop|store|xyz)\b/i;
const DATE_LIKE = /^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})$/;

/** 7–15 digits written as one number, separators allowed (+91 98765 43210, (555) 123-4567); dates don't count. */
function looksLikePhone(v: string): boolean {
  for (const m of v.matchAll(/\+?\(?\d[\d\s().-]{5,}\d/g)) {
    const run = m[0].trim();
    if (DATE_LIKE.test(run)) continue;
    const digits = run.replace(/\D/g, "").length;
    if (digits >= 7 && digits <= 15) return true;
  }
  return false;
}

/**
 * Placeholder for a text value that looks like personal data, or null when it
 * looks clean. Checked in order: email, other @handles, web address, street
 * address, phone number, then any run of six or more digits (account, card,
 * national ID or postal numbers).
 */
function personalDataPlaceholder(v: string): string | null {
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(v)) return "«email»";
  if (/\w@|@\w/.test(v)) return "«handle»";
  if (URL_LIKE.test(v)) return "«url»";
  if (
    (/\d/.test(v) && STREET_WORDS.test(v)) ||
    /\b(?:flat|house|plot|door)\s*(?:no\b|number\b|#)|\bp\.?\s?o\.?\s?box\b/i.test(v)
  )
    return "«address»";
  if (looksLikePhone(v)) return "«phone»";
  if (/\d{6,}/.test(v)) return "«number»";
  return null;
}

/**
 * Name tokens of number columns holding personal numbers (phone, national ID)
 * rather than quantities. Card and account numbers are caught by their size
 * (ten digits or more) instead, since "card" or "contact" also name counts.
 */
const PERSONAL_NUMBER_TOKENS = new Set([
  "phone",
  "mobile",
  "telephone",
  "whatsapp",
  "fax",
  "aadhaar",
  "aadhar",
  "ssn",
  "passport",
  "iban",
]);
/** Name tokens of text columns that name people ("Sales Rep", "Customer Name", "Account Manager"). */
const PERSON_TOKENS = new Set([
  "customer",
  "client",
  "employee",
  "staff",
  "rep",
  "salesperson",
  "agent",
  "manager",
  "owner",
  "contact",
  "patient",
  "student",
  "user",
  "buyer",
  "seller",
  "person",
  "member",
  "recipient",
  "sender",
  "approver",
  "assignee",
  "reporter",
  "guest",
  "passenger",
  "borrower",
  "applicant",
  "candidate",
  "doctor",
  "teacher",
  "firstname",
  "lastname",
  "fullname",
  "username",
  "surname",
]);
/** Tokens that make a person-named column a category instead ("Customer Segment", "User Type", "Contact Method"). */
const CATEGORY_TOKENS = new Set([
  "segment",
  "type",
  "tier",
  "category",
  "group",
  "class",
  "level",
  "status",
  "region",
  "city",
  "state",
  "country",
  "zone",
  "channel",
  "source",
  "plan",
  "gender",
  "age",
  "band",
  "grade",
  "stage",
  "rating",
  "score",
  "count",
  "flag",
  "language",
  "industry",
  "department",
  "role",
  "title",
  "method",
  "mode",
  "medium",
  "preference",
  "reason",
]);
const BIRTH_TOKENS = new Set(["birthdate", "birth", "birthday", "dob"]);
/** Geo levels precise enough to locate a person: never sent, whatever the column's storage. */
const PRECISE_GEO = new Set(["postal", "latitude", "longitude", "address"]);

/** Most distinct values a text column may have and still be sent as a category. */
const AI_MAX_CATEGORIES = 50;

/** What leaves for one column: values kept, replaced by per-column pseudonyms, or masked. */
type AiTreatment = "keep" | "pseudonym" | "text" | "masked" | "birth";

/** How aiPayload() treats a column's values (see its JSDoc for the rules). */
function aiTreatment(c: ColumnProfile | undefined): AiTreatment {
  if (!c) return "masked";
  const has = (set: ReadonlySet<string>) => c.tokens.some((t) => set.has(t));
  if (c.storage === "boolean") return "keep";
  if (c.storage === "date") return has(BIRTH_TOKENS) ? "birth" : "keep";
  if (c.role === "identifier") return "pseudonym";
  if (c.geoLevel && PRECISE_GEO.has(c.geoLevel)) return c.role === "text" ? "text" : "masked";
  if (c.storage === "number") {
    // Whole numbers of ten digits or more are phone, card or account numbers, not quantities.
    const personal =
      has(PERSONAL_NUMBER_TOKENS) ||
      (c.role !== "currency" && Boolean(c.numeric?.integer) && Math.abs(c.numeric?.min ?? 0) >= 1e9);
    return personal ? "pseudonym" : "keep";
  }
  if (c.role === "text") return "text";
  if (has(PERSON_TOKENS) && !has(CATEGORY_TOKENS)) return "pseudonym";
  return c.distinct > AI_MAX_CATEGORIES ? "masked" : "keep";
}

/** Shown inside the AI payload, so the preview (and the model) says what the placeholders mean. */
const AI_PRIVACY_NOTE =
  "Anonymised before sending. Identifier and people-name columns are replaced by pseudonyms (ID-1, ID-2…; the same value always gets the same pseudonym) and their min/max are left out. " +
  `Free text, text columns with more than ${AI_MAX_CATEGORIES} distinct values, dates of birth, postal codes, coordinates and any value that looks like an email, phone number, web address, long number or street address are replaced by «…» placeholders. ` +
  `Categories with up to ${AI_MAX_CATEGORIES} values, numbers and dates are kept.`;

function summarize(ds: Dataset): DatasetSummary {
  return {
    id: ds.id,
    name: ds.name,
    fileName: ds.source.fileName,
    kind: ds.source.kind,
    isDemo: ds.source.isDemo,
    sampleId: ds.source.sampleId,
    rowCount: ds.rowCount,
    columnCount: ds.columns.length,
    sizeBytes: ds.source.sizeBytes,
    ...(ds.source.sheet ? { sheet: ds.source.sheet } : {}),
  };
}

/** Worker-side state built by configure(); everything later stages compute from. */
interface ActiveContext {
  domain: DomainDef;
  subDomainId: string;
  mapping: Mapping;
  res: KpiResolutionMap;
  selection: KpiSelection;
  specs: ChartSpec[];
  dateColumn: string | null;
  /** Evaluates KPI expressions against this dataset and mapping. */
  resolver: Resolver;
  /** Export-safe table, column and measure names shared by every export. */
  names: CompileNames;
  currency: string;
  /** Last locale the UI asked for; kpiBatch() keeps it current for the exports. */
  locale: NumberLocale;
  /** The request's KPI renames; insight text uses them like the KPI cards do. */
  kpiRenames: Record<string, string>;
}

/** The engine's single source of truth for one loaded dataset. See the file header for the call order. */
export class Session {
  private ds: Dataset | null = null;
  private report: ParseReport | null = null;
  /** Profile as detected; never mutated, so removing a role override restores detection. */
  private baseProfile: DatasetProfile | null = null;
  /** baseProfile with the current role overrides applied; every column of the file. */
  private profile: DatasetProfile | null = null;
  /** Columns the user hid (step 3), set by configure(): kept in the dataset, never read by the analysis. */
  private hidden: ReadonlySet<string> = new Set();
  /** `profile` without the hidden columns: what every KPI, chart, filter, insight and question is built from. */
  private active: DatasetProfile | null = null;
  /** Health of the whole file, as loaded. */
  private health: HealthReport | null = null;
  /**
   * The detected profile without the hidden columns, and their health, for
   * the data check and the health score; rebuilt when the hidden set changes.
   */
  private scoped: { ds: Dataset; key: string; profile: DatasetProfile; health: HealthReport } | null = null;
  /** The data check, tied to the dataset and checked columns it was built for. */
  private checker: { ds: Dataset; profile: DatasetProfile; check: DataCheck } | null = null;
  private ctx: ActiveContext | null = null;
  // Results of the most recent dashboard computation. insights() reads these
  // instead of recomputing, and chartCsv() exports exactly what is on screen.
  // adopt() and configure() reset all three, so nothing outlives its dataset or mapping.
  private lastCharts = new Map<string, ChartData>();
  private lastBatch: KpiBatch | null = null;
  private lastFilters: Filter[] = [];

  /** Forgets the last dashboard computation (chart cache, KPI batch and filters). */
  private resetLastResults(): void {
    this.lastCharts.clear();
    this.lastBatch = null;
    this.lastFilters = [];
  }

  private requireDs(): Dataset {
    if (!this.ds) throw new Error("No dataset loaded.");
    return this.ds;
  }

  private requireCtx(): ActiveContext {
    if (!this.ctx) throw new Error("No analysis context. Confirm a domain first.");
    return this.ctx;
  }

  /** Sheet names of a spreadsheet workbook, in workbook order. */
  async listSheets(file: Blob): Promise<string[]> {
    return workbookSheets(file);
  }

  /**
   * Parses a user file and, when it loads, profiles and detects it. Returns
   * "needs-sheet" or "needs-decision" without touching the current dataset.
   * `onProgress` is a Comlink proxy when called from the UI, so every call is
   * a cross-thread message.
   */
  async ingest(
    file: Blob,
    fileName: string,
    opts: IngestOptions,
    onProgress?: (p: IngestProgress) => void,
  ): Promise<LoadResult> {
    // Ask before guessing: a multi-sheet workbook needs an explicit sheet choice.
    if (fileKindFromName(fileName) === "workbook" && !opts.sheet) {
      const sheets = await workbookSheets(file);
      if (sheets.length > 1) return { status: "needs-sheet", sheets };
    }
    const t0 = performance.now();
    const out = await ingestFile(file, fileName, opts, onProgress);
    if (out.status === "needs-decision") return out;
    return this.adopt(out.dataset, out.report, { parse: Math.round(performance.now() - t0) }, onProgress);
  }

  /** Loads a deterministic generated demo dataset; its report carries a "demo data" warning. */
  ingestSample(id: string): LoadResult {
    const t0 = performance.now();
    const ds = generateSample(id);
    const info = SAMPLES.find((s) => s.id === id);
    const report: ParseReport = {
      fileName: ds.source.fileName,
      kind: "sample",
      sizeBytes: 0,
      rowCount: ds.rowCount,
      columnCount: ds.columns.length,
      headerRowIndex: 0,
      headerDetected: true,
      dateFormats: [],
      columnNotes: [],
      warnings: [
        `Demo data: generated deterministically for "${info?.name ?? id}". Not real customers or transactions.`,
      ],
      durationMs: Math.round(performance.now() - t0),
    };
    return this.adopt(ds, report, { generate: report.durationMs });
  }

  /**
   * Makes `ds` the current dataset: drops the analysis context and the last
   * dashboard results (charts, KPI batch, filters), then profiles, assesses
   * health and detects the domain. Adds the profile/health/detect durations
   * to `timings`.
   */
  private adopt(
    ds: Dataset,
    report: ParseReport,
    timings: Record<string, number>,
    onProgress?: (p: IngestProgress) => void,
  ): LoadResult {
    this.ds = ds;
    this.report = report;
    this.ctx = null;
    this.resetLastResults();
    const t1 = performance.now();
    onProgress?.({ phase: "profiling", loadedBytes: 0, totalBytes: 0, rows: ds.rowCount });
    this.baseProfile = profileDataset(ds);
    this.profile = this.baseProfile;
    // A new dataset starts with every column in use.
    this.active = this.baseProfile;
    this.hidden = new Set();
    this.scoped = null;
    timings.profile = Math.round(performance.now() - t1);
    const t2 = performance.now();
    this.health = assessHealth(ds, this.baseProfile, report);
    timings.health = Math.round(performance.now() - t2);
    const t3 = performance.now();
    onProgress?.({ phase: "detecting", loadedBytes: 0, totalBytes: 0, rows: ds.rowCount });
    const detection = detectDomain(DOMAIN_LIST(), this.baseProfile);
    timings.detect = Math.round(performance.now() - t3);
    const replaced = replacedColumns(ds, this.baseProfile, this.health);
    const domains = DOMAIN_LIST().map((d) => ({
      id: d.id,
      name: d.name,
      tagline: d.tagline,
      icon: d.icon,
      flagship: Boolean(d.flagship),
      subDomains: d.subDomains.map((s) => ({ id: s.id, name: s.name })),
    }));
    return {
      status: "ok",
      summary: summarize(ds),
      report,
      profile: this.baseProfile,
      health: this.health,
      detection,
      domains,
      timings,
      replaced,
    };
  }

  /**
   * Reshapes the wide-format columns found by profiling (e.g. one column per
   * month) into rows, then adopts the result as a new dataset, so the context
   * must be configured again. Throws when profiling found no wide format.
   */
  unpivot(): LoadResult {
    const ds = this.requireDs();
    const wide = this.baseProfile?.wide;
    if (!wide) throw new Error("No wide-format columns detected.");
    const next = unpivotDataset(ds, wide);
    const report: ParseReport = {
      ...(this.report as ParseReport),
      rowCount: next.rowCount,
      columnCount: next.columns.length,
      warnings: [
        ...(this.report?.warnings ?? []),
        `Unpivoted ${wide.columns.length} ${wide.kind} columns into rows.`,
      ],
    };
    return this.adopt(next, report, {});
  }

  /** The tall scorecard profiling found, or an error when it found none. */
  private requireTall(): TallFormatInfo {
    const tall = this.baseProfile?.tall;
    if (!tall) throw new Error("No scorecard layout detected.");
    return tall;
  }

  /**
   * What pivot() would do: the rows it makes, the columns it adds (exact
   * names) and leaves out, and the rows it can't place, so Detect can ask
   * first. Throws when profiling found no tall scorecard.
   */
  pivotPlan(): PivotPlan {
    return pivotPlan(this.requireDs(), this.requireTall());
  }

  /**
   * Turns the tall scorecard found by profiling (one metric per row) into one
   * column per metric (parse/pivot.ts), then adopts the result as a new
   * dataset, so the context must be configured again. The parse report keeps
   * the notes on the columns that stay, adds one for each new column with
   * cells the file had but that couldn't be read, and says what was done.
   * Throws when profiling found no tall scorecard.
   */
  pivot(): LoadResult {
    const ds = this.requireDs();
    const tall = this.requireTall();
    const plan = pivotPlan(ds, tall);
    const next = pivotDataset(ds, tall);
    const prev = this.report as ParseReport;
    const kept = new Set(plan.kept);
    const added = new Set(plan.columns.map((c) => c.name));
    const notes = next.columns
      .filter((c) => added.has(c.name) && c.unreadable?.rows.length)
      .map((c) => {
        const u = c.unreadable as NonNullable<typeof c.unreadable>;
        const count = u.rows.length;
        return {
          column: c.name,
          invalidCount: count,
          examples: u.texts.slice(0, 3),
          note: `${count.toLocaleString("en-US")} ${count === 1 ? "value" : "values"} couldn't be read and ${count === 1 ? "was" : "were"} treated as blank.`,
        };
      });
    const report: ParseReport = {
      ...prev,
      rowCount: next.rowCount,
      columnCount: next.columns.length,
      // Notes and date readings of columns that are gone would point at nothing.
      columnNotes: [...prev.columnNotes.filter((note) => kept.has(note.column)), ...notes],
      dateFormats: prev.dateFormats.filter((d) => kept.has(d.column)),
      warnings: [...prev.warnings, pivotSummary(plan, tall)],
    };
    return this.adopt(next, report, {});
  }

  /**
   * Builds the analysis context from scratch: role overrides → hidden
   * columns left out → domain and mapping → sub-domain → KPI resolution and
   * selection → chart specs → primary date column → export names → SQL and
   * DAX for every available KPI. Everything after the hidden columns works
   * from the profile without them, so nothing can be built from one.
   * A KPI that fails to compile gets `sql`/`dax` undefined rather than failing
   * the whole call. Clears the last dashboard results (charts, KPI batch and
   * filters) because spec ids, KPIs and columns may have changed.
   */
  configure(req: ContextRequest): ContextResult {
    const ds = this.requireDs();
    // Overrides apply to a copy; the detected profile stays untouched.
    let profile = this.baseProfile as DatasetProfile;
    if (req.roleOverrides && Object.keys(req.roleOverrides).length) {
      profile = {
        ...profile,
        columns: profile.columns.map((c) => {
          const o = req.roleOverrides?.[c.name];
          return o ? applyRoleOverride(c, o.role, o.additivity) : c;
        }),
      };
    }
    this.profile = profile;
    // Hidden columns stay in the dataset but leave the profile the analysis is built from. A mapping
    // override naming one is dropped by buildMapping (it only accepts columns of the profile it gets).
    this.hidden = new Set((req.hiddenColumns ?? []).filter((n) => ds.columns.some((c) => c.name === n)));
    const active = withoutColumns(ds, profile, this.hidden);
    this.active = active;
    let domain: DomainDef;
    let mapping: Mapping;
    if (req.domainId === GENERIC_ID || !getDomain(req.domainId)) {
      const g = buildGenericDomain(active);
      domain = g.domain;
      mapping = g.mapping;
    } else {
      domain = getDomain(req.domainId) as DomainDef;
      mapping = buildMapping(domain, active, assignFields(domain, matchableColumns(active)), {
        fields: req.mappingOverrides,
        classes: req.classOverrides,
      });
    }
    // Sub-domain: requested, else best coverage with this mapping. Coverage is
    // the share of the sub-domain's signal fields that are mapped, weighted by
    // each field's registry weight and by how confidently it was matched.
    const coverage = domain.subDomains.map((s) => {
      const w = (id: string) => domain.fields.find((f) => f.id === id)?.weight ?? 1;
      const total = s.signals.reduce((a, f) => a + w(f), 0);
      const got = s.signals.reduce(
        (a, f) => a + (mapping.fields[f] ? w(f) * (mapping.scores[f] ?? 1) : 0),
        0,
      );
      return { id: s.id, cov: total ? got / total : 0 };
    });
    const subDomainId =
      req.subDomainId && domain.subDomains.some((s) => s.id === req.subDomainId)
        ? req.subDomainId
        : (coverage.sort((a, b) => b.cov - a.cov)[0]?.id ?? domain.subDomains[0]?.id ?? "default");
    // Fields a hidden column would fill, matched on the whole profile: a KPI that needs one then
    // says the column is hidden, rather than asking for a column the file already has.
    const hiddenFields = new Map<string, string>();
    if (this.hidden.size && domain.id !== GENERIC_ID)
      for (const a of assignFields(domain, profile.columns))
        if (this.hidden.has(a.column) && !mapping.fields[a.fieldId]) hiddenFields.set(a.fieldId, a.column);
    let res = resolveKpis(domain, mapping, subDomainId, hiddenFields);

    // Primary date: first mapped date field among the sub-domain's signals, then any mapped date field.
    const sub = domain.subDomains.find((s) => s.id === subDomainId);
    const templateFields = domain.fields;
    const isDateField = (id: string) => templateFields.find((f) => f.id === id)?.roles[0] === "datetime";
    const dateField =
      sub?.signals.find((id) => isDateField(id) && mapping.fields[id]) ??
      templateFields.find((f) => f.roles[0] === "datetime" && mapping.fields[f.id])?.id;
    let dateColumn = dateField ? (mapping.fields[dateField] ?? null) : null;
    if (domain.id === GENERIC_ID) dateColumn = active.primaryDate;
    // A field can be mapped to a column that did not parse as dates; time logic needs real dates.
    // A time-of-day column is never the date axis either.
    const dateCol = dateColumn ? ds.columns.find((c) => c.name === dateColumn) : undefined;
    if (dateCol?.kind !== "date" || dateCol.timeOnly) dateColumn = null;

    // The user's own KPIs (Customise step) join the domain like template KPIs. They come after the
    // primary date is chosen (their identity fields must never become the date axis) and before the
    // column KPIs, so a column the user already summarises gets no automatic KPI as well.
    const mine = userKpiExtras(req.customKpis ?? [], active, mapping.fields);
    if (mine.kpis.length) {
      domain = {
        ...domain,
        fields: [...domain.fields, ...mine.fields],
        kpis: [...domain.kpis, ...mine.kpis],
      };
      mapping = {
        ...mapping,
        fields: { ...mapping.fields, ...mine.mapping },
        scores: { ...mapping.scores, ...Object.fromEntries(Object.keys(mine.mapping).map((f) => [f, 1])) },
      };
      res = resolveKpis(domain, mapping, subDomainId, hiddenFields);
    }

    // Measure columns that no KPI of this view reads get KPIs and charts of their own, computed
    // from the column the way its data says (totals, latest balances or averages; kpi/columnKpis).
    const extras = columnExtras({ domain, mapping, res, profile: active, subDomainId, dateColumn });
    if (extras.kpis.length || extras.charts.length) {
      domain = {
        ...domain,
        fields: [...domain.fields, ...extras.fields],
        kpis: [...domain.kpis, ...extras.kpis],
        charts: [...domain.charts, ...extras.charts],
      };
      mapping = {
        ...mapping,
        fields: { ...mapping.fields, ...extras.mapping },
        scores: { ...mapping.scores, ...Object.fromEntries(Object.keys(extras.mapping).map((f) => [f, 1])) },
      };
      res = resolveKpis(domain, mapping, subDomainId, hiddenFields);
    }
    const selection = selectKpis(res);
    const recommended = recommendCharts({
      domain,
      mapping,
      res,
      profile: active,
      subDomain: subDomainId,
    });
    const skipped = recommended.skipped;
    // One name per KPI: a renamed KPI is called by its new name in every chart's measures (legends,
    // table headers, "Why this chart") and in a default title that starts with its old name.
    const specs = recommended.specs.map((s) => {
      const measures = s.measures.map((m) => ({
        ...m,
        label: displayName(req.kpiRenames ?? {}, m.id, m.label),
      }));
      const was = s.measures[0]?.label;
      const now = measures[0]?.label;
      const title =
        was && now && was !== now && (s.title === was || s.title.startsWith(`${was} `))
          ? `${now}${s.title.slice(was.length)}`
          : s.title;
      return { ...s, title, measures };
    });

    const names = compileNames(ds, domain, req.kpiRenames);
    const resolver = makeResolver(ds, mapping, res);
    const currency = req.currency ?? profile.currency.code;
    const kpiRenames = { ...(req.kpiRenames ?? {}) };
    this.ctx = {
      domain,
      subDomainId,
      mapping,
      res,
      selection,
      specs,
      dateColumn,
      resolver,
      names,
      currency,
      locale: req.numberLocale,
      kpiRenames,
    };
    this.resetLastResults();

    // SQL uses the lower-cased table name, matching the .sql export and the
    // DuckDB verification (a lower-case quoted name also works unquoted in
    // PostgreSQL). DAX gets the Date table only when a primary date exists.
    const sqlCtx = makeSqlContext(ds, mapping, res, { ...names, table: names.table.toLowerCase() });
    const daxCtx = makeDaxContext(ds, mapping, res, names, { dateTable: dateColumn ? "Date" : null });
    const labelOf = new Map(domain.fields.map((f) => [f.id, f.label]));
    const classLabel = new Map<string, string>();
    for (const [field, list] of Object.entries(domain.valueClasses ?? {}))
      for (const c of list) classLabel.set(`${field}.${c.id}`, `${labelOf.get(field) ?? field} · ${c.label}`);
    const kpis: KpiMeta[] = [...res.values()].map((r) => {
      let sql: string | undefined;
      let dax: string | undefined;
      if (r.available && r.variant) {
        try {
          // Laid out for reading (the KPI details, PDFs and the readable SQL & DAX page).
          sql = prettySql(
            kpiQuery(r.variant.expr, { ...sqlCtx, table: quoteIdent(names.table.toLowerCase()) }),
          );
        } catch {
          sql = undefined;
        }
        try {
          dax = exprDax(r.variant.expr, daxCtx);
        } catch {
          dax = undefined;
        }
      }
      return {
        id: r.def.id,
        name: displayName(kpiRenames, r.def.id, r.def.name),
        short: r.def.short,
        definition: r.def.definition,
        formula: r.def.formula,
        format: r.def.format,
        direction: r.def.direction,
        tier: r.def.tier,
        group: r.def.group,
        hidden: Boolean(r.def.hidden || r.dependencyOnly),
        available: r.available,
        variantLabel: r.variant?.label,
        caveat: r.variant?.caveat,
        fieldsUsed: r.fieldsUsed.map((f) => ({
          fieldId: f,
          label: labelOf.get(f) ?? f,
          column: mapping.fields[f] ?? f.replace(/^col:/, ""),
        })),
        classesUsed: r.classesUsed.map((k) => ({
          key: k,
          label: classLabel.get(k) ?? k,
          values: mapping.classes[k] ?? [],
        })),
        unavailableReason: r.unavailableReason,
        substitute: r.substitute,
        benchmark: r.def.benchmark,
        pitfalls: r.def.pitfalls ?? [],
        sql,
        dax,
        daxName: names.measures.get(r.def.id) ?? r.def.name,
      };
    });
    const fieldLabel = new Map(Object.entries(mapping.fields).map(([f, c]) => [c, labelOf.get(f) ?? c]));
    const dimensions = active.columns
      .filter(
        (c) =>
          (c.role === "dimension" || c.role === "geo" || c.role === "boolean") &&
          c.distinct >= 2 &&
          c.distinct <= 500 &&
          c.storage !== "number",
      )
      .sort(
        (a, b) =>
          (fieldLabel.has(b.name) ? 1 : 0) - (fieldLabel.has(a.name) ? 1 : 0) || a.distinct - b.distinct,
      )
      .map((c) => ({
        column: c.name,
        label: fieldLabel.get(c.name) ?? friendlyStart(c.name),
        distinct: c.distinct,
        geo: c.geoLevel,
      }));
    return {
      domain: {
        id: domain.id,
        name: domain.name,
        tagline: domain.tagline,
        icon: domain.icon,
        entity: domain.entity,
        // The column and user KPIs' identity fields are internal: the mapping screen lists template fields only.
        fields: domain.fields.filter((f) => !isColumnId(f.id) && !isUserKpiId(f.id)),
        valueClasses: domain.valueClasses ?? {},
        subDomains: domain.subDomains,
        pitfalls: domain.pitfalls,
        generic: domain.id === GENERIC_ID,
      },
      subDomainId,
      mapping: {
        ...mapping,
        fields: Object.fromEntries(
          Object.entries(mapping.fields).filter(([f]) => !isColumnId(f) && !isUserKpiId(f)),
        ),
      },
      kpis,
      selection,
      charts: specs,
      skippedCharts: skipped,
      dateColumn,
      dateBounds: dateBounds(ds, dateColumn),
      profile: active,
      hiddenColumns: ds.columns.filter((c) => this.hidden.has(c.name)).map((c) => c.name),
      health: this.scope().health,
      customKpiIssues: mine.skipped,
      grainLabel: grainLabel(active.grain, domain.id !== GENERIC_ID ? sub?.grain : undefined),
      currency,
      dimensions,
    };
  }

  private fmt(locale: NumberLocale): FormatOptions {
    return { locale, currency: this.ctx?.currency ?? this.profile?.currency.code ?? "INR" };
  }

  /** `filters` without any on a hidden column: the UI never offers one, so this only guards older saved state. */
  private usable(filters: Filter[]): Filter[] {
    return this.hidden.size ? filters.filter((f) => !this.hidden.has(f.column)) : filters;
  }

  /** Hidden columns among `columns`, without repeats, in the order given. */
  private hiddenAmong(columns: Iterable<string>): string[] {
    return [...new Set(columns)].filter((c) => this.hidden.has(c));
  }

  /**
   * KPI values under `filters`, with the comparison period when a date range
   * is active. Unknown or unavailable ids are skipped. Remembers the batch and
   * filters for insights(), and the locale for the exports.
   */
  kpiBatch(allFilters: Filter[], kpiIds: string[], numberLocale: NumberLocale): KpiBatch {
    const ds = this.requireDs();
    const ctx = this.requireCtx();
    const filters = this.usable(allFilters);
    ctx.locale = numberLocale;
    const measures = kpiIds
      .map((id) => ctx.res.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r?.available && r.variant))
      .map((r) => ({ id: r.def.id, expr: r.variant?.expr as NonNullable<typeof r.variant>["expr"] }));
    const sub = ctx.domain.subDomains.find((s) => s.id === ctx.subDomainId);
    // Roster rows are standing entities: a date range picks a group of them
    // (e.g. people hired then), so no period-over-period change is shown.
    const ranged = filters.some((f) => f.kind === "dateRange" && f.column === ctx.dateColumn);
    const noComparisonReason =
      sub?.timeModel === "roster" && ctx.dateColumn
        ? ranged
          ? `${sub.grain[0]?.toUpperCase()}${sub.grain.slice(1)}s with ${ctx.dateColumn} in the range · no period comparison`
          : `All ${sub.grain}s in the file · no period comparison`
        : undefined;
    const kpis = computeKpis({
      ds,
      resolver: ctx.resolver,
      measures,
      filters,
      dateColumn: ctx.dateColumn,
      noComparisonReason,
    });
    this.lastBatch = kpis;
    this.lastFilters = filters;
    return kpis;
  }

  /**
   * KPI values for the Customise step's lists, with no side effects: unlike
   * kpiBatch() it doesn't become the batch insights() reads, so previewing
   * KPIs never changes what the dashboard's insights describe.
   */
  previewKpis(allFilters: Filter[], kpiIds: string[]): KpiBatch {
    const ds = this.requireDs();
    const ctx = this.requireCtx();
    const measures = kpiIds
      .map((id) => ctx.res.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r?.available && r.variant))
      .map((r) => ({ id: r.def.id, expr: r.variant?.expr as NonNullable<typeof r.variant>["expr"] }));
    return computeKpis({
      ds,
      resolver: ctx.resolver,
      measures,
      filters: this.usable(allFilters),
      dateColumn: ctx.dateColumn,
    });
  }

  /**
   * Data for one chart. `c.filters`, when given, replaces `filters` for this
   * chart only. Returns null for an unknown spec id. Computation errors never
   * throw: they come back as an empty ChartData with the message in `notes`,
   * so one broken chart cannot take down the dashboard. The result is cached
   * by spec id for insights() and chartCsv().
   */
  chart(filters: Filter[], c: ChartRequest, numberLocale: NumberLocale): ChartData | null {
    const ds = this.requireDs();
    const ctx = this.requireCtx();
    const spec = c.spec ?? ctx.specs.find((s) => s.id === c.specId);
    if (!spec) return null;
    let data: ChartData;
    try {
      // Recommended charts are built without hidden columns; a chart the user built earlier may name one.
      const hiddenUsed = c.spec
        ? this.hiddenAmong(
            specColumns(spec, (ref) => (ref.startsWith("col:") ? ref.slice(4) : ctx.mapping.fields[ref])),
          )
        : [];
      if (hiddenUsed.length)
        throw new Error(
          `This chart uses ${hiddenUsed.map((h) => `"${h}"`).join(" and ")}, which you hid in Check & map. Show the column again there, or remove this chart.`,
        );
      // The user's trend grain only applies when the spec leaves the grain to "auto".
      data = computeChartData({
        ds,
        resolver: ctx.resolver,
        spec,
        filters: this.usable(c.filters ?? filters),
        dateColumn: ctx.dateColumn,
        fmt: this.fmt(numberLocale),
        drill: c.drill,
        topN: c.topN,
        kind: c.kind,
        grain: spec.x.kind === "time" && spec.x.grain === "auto" ? c.grain : undefined,
      });
    } catch (e) {
      data = {
        specId: spec.id,
        kind: c.kind ?? spec.kind,
        categories: [],
        series: [],
        rows: [],
        totals: [],
        annotations: [],
        caption: "",
        altText: `${spec.title}: could not be computed.`,
        notes: [(e as Error).message],
        empty: true,
        totalRows: 0,
      };
    }
    this.lastCharts.set(c.specId, data);
    return data;
  }

  /** Rows passing `filters`, via the memoised selection cache (cheap for a filter set just used). */
  rowCount(filters: Filter[]): number {
    return selectRowsCached(this.requireDs(), this.usable(filters)).length;
  }

  /**
   * Synchronous all-in-one variant (tests, scripts). The worker exposes its
   * own streaming version that yields between charts and can be aborted.
   */
  computeDashboard(req: DashboardRequest, onChart?: (id: string, data: ChartData) => void): DashboardResult {
    const t0 = performance.now();
    const kpis = this.kpiBatch(req.filters, req.kpiIds, req.numberLocale);
    const charts: Record<string, ChartData> = {};
    for (const c of req.charts) {
      const data = this.chart(req.filters, c, req.numberLocale);
      if (!data) continue;
      charts[c.specId] = data;
      onChart?.(c.specId, data);
    }
    return { kpis, charts, rows: this.rowCount(req.filters), ms: Math.round(performance.now() - t0) };
  }

  /**
   * Rule-based insights for the hero and supporting KPIs, named as the user
   * renamed them. Works from the filters, KPI batch and chart data of the most
   * recent kpiBatch()/chart() calls rather than recomputing, so call it after
   * a dashboard refresh; before the first one after a load or configure() it
   * covers all rows with no comparison period.
   */
  insights(numberLocale: NumberLocale): Insight[] {
    const ds = this.requireDs();
    const ctx = this.requireCtx();
    const fmt = this.fmt(numberLocale);
    const ids = [...ctx.selection.hero, ...ctx.selection.supporting, ...ctx.selection.columns];
    const kpis: InsightKpi[] = ids
      .map((id) => ctx.res.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r?.available && r.variant))
      .map((r) => ({
        id: r.def.id,
        name: displayName(ctx.kpiRenames, r.def.id, r.def.name),
        expr: r.variant?.expr as NonNullable<typeof r.variant>["expr"],
        format: r.def.format,
        direction: r.def.direction,
        tier: r.def.tier,
      }));
    // Chart measure labels feed the driver insights, so they carry the renames too.
    const specs = ctx.specs.map((s) => ({
      ...s,
      measures: s.measures.map((m) => ({ ...m, label: displayName(ctx.kpiRenames, m.id, m.label) })),
    }));
    const m = ctx.mapping.fields;
    // Domain fields worth comparing segments on; when none is mapped (or the
    // domain is generic), fall back to a few low-cardinality text dimensions.
    const segmentFields = [
      "payment_method",
      "channel",
      "category",
      "state",
      "courier",
      "brand",
      "region",
      "segment",
      "customer_segment",
      "plan",
      "department",
      "campaign",
      "product_line",
      "priority",
    ];
    const labelOf = (fieldId: string) => ctx.domain.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
    let segments = segmentFields
      .filter((f) => m[f])
      .map((f) => ({ column: m[f] as string, label: labelOf(f) }));
    if (!segments.length || ctx.domain.id === GENERIC_ID) {
      segments = (this.active?.columns ?? [])
        .filter(
          (c) =>
            (c.role === "dimension" || c.role === "geo") &&
            c.storage === "string" &&
            c.distinct >= 2 &&
            c.distinct <= 30,
        )
        .slice(0, 5)
        // Insight sentences read the column with spaces ("customer_segment" → "customer segment").
        .map((c) => ({ column: c.name, label: friendly(c.name) }));
    }
    // Concentration ("top items' share"): the product column, else the
    // lowest-cardinality text identifier/dimension with 10–50,000 values.
    const conc =
      m.product_name ??
      m.product_id ??
      (this.active?.columns ?? [])
        .filter(
          (c) =>
            (c.role === "dimension" || c.role === "identifier") &&
            c.distinct >= 10 &&
            c.distinct <= 50_000 &&
            c.storage === "string",
        )
        .sort((a, b) => a.distinct - b.distinct)[0]?.name;
    // Order statuses classed as pending feed the "still in progress" insight.
    const pending = m.order_status ? (ctx.mapping.classes["order_status.pending"] ?? []) : [];
    return generateInsights({
      ds,
      resolver: ctx.resolver,
      filters: this.lastFilters,
      dateColumn: ctx.dateColumn,
      kpis,
      batch: this.lastBatch,
      segments,
      concentration: conc
        ? { column: conc, label: m.product_name || m.product_id ? "product" : friendly(conc) }
        : undefined,
      inProgress: m.order_status && pending.length ? { column: m.order_status, values: pending } : undefined,
      specs,
      chartData: this.lastCharts,
      fmt,
      roster: ctx.domain.subDomains.find((s) => s.id === ctx.subDomainId)?.timeModel === "roster",
    });
  }

  /**
   * MTD/QTD/YTD, YoY and MoM changes and rolling windows for one KPI, with
   * other (non-date) filters applied. Empty when the KPI is unavailable or
   * there is no primary date column.
   */
  /**
   * The SQL that returns the number a KPI card shows: the KPI's own query
   * over the card's rows (the dashboard's period and filters, written as the
   * WHERE the Questions step uses), so the SQL under a card can't disagree
   * with it. Without filters it is the KPI's whole-file query. A KPI that
   * counts entities by their first-ever date can't be filtered in SQL; it
   * then gets its whole-file query and `filtered: false`.
   */
  kpiCardSql(kpiId: string, allFilters: Filter[]): { sql: string; filtered: boolean } | null {
    const ds = this.requireDs();
    const ctx = this.requireCtx();
    const r = ctx.res.get(kpiId);
    if (!r?.available || !r.variant) return null;
    const filters = this.usable(allFilters);
    const name = displayName(ctx.kpiRenames, r.def.id, r.def.name);
    const sqlCtx = makeSqlContext(ds, ctx.mapping, ctx.res, {
      ...ctx.names,
      table: ctx.names.table.toLowerCase(),
    });
    const whole = () => {
      try {
        return prettySql(kpiQuery(r.variant?.expr as Expr, sqlCtx));
      } catch {
        return null;
      }
    };
    if (!filters.length) {
      const sql = whole();
      return sql ? { sql, filtered: false } : null;
    }
    const fmtDay = (t: number) => formatDay(t);
    const q = questionSql(
      {
        question: name,
        understood: name,
        header: [
          `${name}, for the rows on the card: ${filters.map((f) => describeFilter(f, fmtDay)).join("; ")}`,
        ],
        measures: [{ id: kpiId, label: name, expr: r.variant.expr }],
        key: { kind: "none" },
        keyLabel: "Value",
        filters,
        order: "desc",
      },
      ds,
      sqlCtx,
    );
    if (q.sql) return { sql: q.sql, filtered: true };
    const sql = whole();
    return sql ? { sql, filtered: false } : null;
  }

  timeIntel(kpiId: string, allFilters: Filter[]): TimeIntelValue[] {
    const ds = this.requireDs();
    const ctx = this.requireCtx();
    const filters = this.usable(allFilters);
    const r = ctx.res.get(kpiId);
    if (!r?.available || !r.variant || !ctx.dateColumn) return [];
    const df = filters.find((f) => f.kind === "dateRange" && f.column === ctx.dateColumn);
    const bounds = dateBounds(ds, ctx.dateColumn);
    // "As of" is the end of the selected range, capped at the last date in the
    // data (a range reaching into the future would otherwise make MTD empty);
    // with no range it is the last date in the data, else today.
    const asOf =
      df && df.kind === "dateRange"
        ? Math.min(df.to, bounds?.max ?? df.to)
        : (bounds?.max ?? todayWallClock());
    return computeTimeIntel(
      ds,
      ctx.resolver,
      r.variant.expr,
      filters,
      ctx.dateColumn,
      asOf,
      r.def.format === "percent",
    );
  }

  /**
   * A window of raw rows as display strings for the data preview: ISO dates,
   * numbers with international grouping and the column's decimals (capped at
   * 4), null for blanks. The window is clamped to the last row.
   */
  rows(start: number, count: number): Array<Array<string | null>> {
    const ds = this.requireDs();
    const out: Array<Array<string | null>> = [];
    const end = Math.min(ds.rowCount, start + count);
    for (let r = start; r < end; r++) out.push(ds.columns.map((_, j) => this.cellText(j, r)));
    return out;
  }

  /** One cell as display text (the preview's format), null for blank. */
  private cellText(column: number, r: number): string | null {
    const c = this.requireDs().columns[column];
    switch (c?.kind) {
      case "string": {
        const k = c.codes[r] as number;
        return k < 0 ? null : (c.dict[k] as string);
      }
      case "boolean": {
        const v = c.values[r] as number;
        return v < 0 ? null : v === 1 ? c.trueLabel : c.falseLabel;
      }
      case "date": {
        const v = c.values[r] as number;
        // `v === v` is false only for NaN, the blank sentinel.
        return v === v ? (c.timeOnly ? isoTime(v) : c.hasTime ? isoDateTime(v) : isoDate(v)) : null;
      }
      case "number": {
        const v = c.values[r] as number;
        return v === v ? formatPlain(v, Math.min(c.format.decimals, 4), "INTL") : null;
      }
      default:
        return null;
    }
  }

  /**
   * The detected profile without the hidden columns, and the health of the
   * columns left. With nothing hidden that is the profile and health found
   * on loading; otherwise health is assessed again over the columns in use
   * (duplicate rows still compare every column), once per hidden set.
   */
  private scope(): { profile: DatasetProfile; health: HealthReport } {
    const ds = this.requireDs();
    const key = [...this.hidden].sort().join("\u0000");
    if (!this.scoped || this.scoped.ds !== ds || this.scoped.key !== key) {
      const base = this.baseProfile as DatasetProfile;
      const profile = withoutColumns(ds, base, this.hidden);
      const report = this.report as ParseReport;
      const health =
        profile === base
          ? (this.health as HealthReport)
          : assessHealth(ds, profile, {
              ...report,
              columnNotes: report.columnNotes.filter((n) => !this.hidden.has(n.column)),
            });
      this.scoped = { ds, key, profile, health };
    }
    return this.scoped;
  }

  /** The data check of the loaded file (step 3) over the columns in use, built on first use. */
  private dataCheck(): DataCheck {
    const ds = this.requireDs();
    const { profile, health } = this.scope();
    if (!this.checker || this.checker.ds !== ds || this.checker.profile !== profile)
      this.checker = {
        ds,
        profile,
        check: new DataCheck(ds, profile, health, (c, r) => this.cellText(c, r)),
      };
    return this.checker.check;
  }

  /** Views of the data check (all rows, rows to check, one per issue, blanks per column) with row counts. */
  checkViews(): CheckView[] {
    return this.dataCheck().views();
  }

  /** A window of a data-check view: each row's cells as display text, its marked cells and any duplicate. */
  checkRows(viewId: string, start: number, count: number): { total: number; rows: CheckedRow[] } {
    return this.dataCheck().rows(viewId, start, count);
  }

  /**
   * What the question reader and chart designer need: the view's KPIs (with
   * the user's names), the columns, and the template's vocabulary. The same
   * shape as the ContextResult the UI holds, minus the internal column fields.
   */
  private askContext(): AskContext {
    const ctx = this.requireCtx();
    return {
      kpis: [...ctx.res.values()].map((r) => ({
        id: r.def.id,
        name: displayName(ctx.kpiRenames, r.def.id, r.def.name),
        short: r.def.short,
        format: r.def.format,
        direction: r.def.direction,
        available: r.available,
        hidden: Boolean(r.def.hidden || r.dependencyOnly),
      })),
      // Without the hidden columns, so a question can't be read as one of them.
      profile: this.active as DatasetProfile,
      domain: { fields: ctx.domain.fields.filter((f) => !isColumnId(f.id) && !isUserKpiId(f.id)) },
      mapping: {
        fields: Object.fromEntries(
          Object.entries(ctx.mapping.fields).filter(([f]) => !isColumnId(f) && !isUserKpiId(f)),
        ),
      },
      dateColumn: ctx.dateColumn,
    };
  }

  /**
   * A business question (step 5): the answer computed by the engine, a
   * one-line headline built from it, and the SQL that returns the same rows
   * (compile/questionSql.ts). Category answers are ranked by the first
   * measure (highest or lowest first) and cut to the ask's top N (10 by
   * default); time and date-part answers keep every period in order.
   */
  answerQuestion(req: QuestionRequest, numberLocale: NumberLocale): QuestionAnswer {
    const ds = this.requireDs();
    const ctx = this.requireCtx();
    const actx = this.askContext();
    const fmt = this.fmt(numberLocale);
    const measures = req.ask.measures
      .map((m) => askMeasure(m, actx))
      .filter((m): m is NonNullable<typeof m> => Boolean(m))
      .slice(0, 4);
    // The question's own rows ("in Maharashtra", "in 2026") on top of the dashboard's; one on the same
    // column replaces the dashboard's, and the card says so.
    const own = questionFilters(req.filters, req.ask.filters);
    const base = {
      id: req.id,
      question: req.question,
      understood: req.understood,
      notes: [
        ...req.notes,
        ...own.replaced
          .map(
            (f) =>
              `The question names its own ${friendly(f.column)}, used instead of the dashboard's (${describeFilter(f, formatDay)}).`,
          )
          .filter((n) => !req.notes.includes(n)),
      ],
      order: req.order,
      ask: req.ask,
      filters: own.filters,
      measures: measures.map((m) => ({ id: m.id, label: m.label, format: m.format })),
    };
    const failed = (error: string): QuestionAnswer => ({
      ...base,
      keyLabel: null,
      rows: [],
      more: 0,
      headline: "",
      sql: "",
      skipped: [],
      error,
    });
    // The question reader never offers a hidden column; an ask built before it was hidden may name one.
    const hiddenUsed = this.hiddenAmong([
      ...req.ask.measures.flatMap((m) => (m.kind === "column" ? [m.column] : [])),
      ...(req.ask.by.kind === "none" ? [] : [req.ask.by.column]),
      ...(req.ask.split ? [req.ask.split] : []),
      ...(req.ask.filters ?? []).map((f) => f.column),
    ]);
    if (hiddenUsed.length)
      return failed(
        `This question uses ${hiddenUsed.map((h) => `"${h}"`).join(" and ")}, which you hid in Check & map.`,
      );
    if (req.ask.unmatched?.length) return failed(unplacedMessage(req.ask.unmatched));
    if (!measures.length) return failed("Nothing in your file matches what to measure.");
    const exprs = measures.map((m) => ({ id: m.id, label: m.label, expr: ctx.resolver.kpi(m.id) }));
    let key: QuestionKey = { kind: "none" };
    let keyLabel: string | null = null;
    let rows: QuestionAnswer["rows"] = [];
    let more = 0;
    let headline = "";
    const by = req.ask.by;
    const filters = this.usable(own.filters);
    if (by.kind === "none") {
      const ev = evaluateMany(ds, ctx.resolver, exprs, filters, ctx.dateColumn);
      const values = measures.map((m) => {
        const v = ev.values.get(m.id);
        return v !== undefined && Number.isFinite(v) ? v : null;
      });
      rows = [{ label: "All rows", raw: null, values }];
      headline = answerHeadline({ by, order: req.order, measures, rows, fmt });
    } else {
      // Every group as a table (no top N, no Others), sorted by the first measure; ranked and cut below.
      const x = axisFor(by);
      const spec = customSpec({
        id: `question_${req.id}`,
        title: req.understood,
        kind: "table",
        x,
        measures,
        others: false,
      });
      const data = computeChartData({
        ds,
        resolver: ctx.resolver,
        spec,
        filters,
        dateColumn: ctx.dateColumn,
        fmt,
        kind: "table",
      });
      // The column read with spaces ("Customer state" for customer_state), as the table heading and the SQL's alias.
      keyLabel = x.kind === "part" || x.kind === "column" || x.kind === "time" ? x.label : null;
      const all = data.categories.map((c, i) => ({
        label: c.label,
        raw: c.raw,
        values: data.series.map((s) => s.values[i] ?? null),
      }));
      if (by.kind === "column") {
        const first = (r: (typeof all)[number]) => r.values[0] ?? null;
        all.sort((a, b) => {
          const x1 = first(a);
          const y1 = first(b);
          if (x1 === null) return y1 === null ? 0 : 1;
          if (y1 === null) return -1;
          return req.order === "asc" ? x1 - y1 : y1 - x1;
        });
        const limit = req.ask.topN ?? 10;
        rows = all.slice(0, limit);
        more = Math.max(0, all.length - limit);
        key = { kind: "column", column: by.column };
      } else {
        rows = all;
        key =
          by.kind === "time"
            ? {
                kind: "time",
                column: by.column,
                grain: data.grain ?? (by.grain === "auto" ? "month" : by.grain),
              }
            : { kind: "part", column: by.column, part: by.part };
      }
      headline = answerHeadline({ by, order: req.order, measures, rows, data, keyLabel, fmt });
    }
    const sqlCtx = makeSqlContext(ds, ctx.mapping, ctx.res, {
      ...ctx.names,
      table: ctx.names.table.toLowerCase(),
    });
    const q = questionSql(
      {
        question: req.question,
        understood: req.understood,
        measures: exprs,
        key,
        keyLabel: keyLabel ?? "Value",
        filters,
        order: req.order,
        limit: key.kind === "column" ? (req.ask.topN ?? 10) : undefined,
      },
      ds,
      sqlCtx,
    );
    return { ...base, keyLabel, rows, more, headline, sql: q.sql, skipped: q.skipped };
  }

  /**
   * Distinct values with counts for a filter picker, read from the profile
   * rather than rescanning rows. Columns with more than 250 distinct values
   * only have their top values profiled, so search covers those alone.
   * Boolean columns return their example values with a count of 0. `search`
   * is a case-insensitive substring match.
   */
  columnValues(column: string, limit = 200, search = ""): ValueCount[] {
    const p = this.profile?.columns.find((c) => c.name === column);
    const all =
      p?.categorical?.all ??
      p?.categorical?.top ??
      (p?.booleanStats ? p.examples.map((v) => ({ value: v, count: 0 })) : []);
    const s = search.trim().toLowerCase();
    return all.filter((v) => !s || v.value.toLowerCase().includes(s)).slice(0, limit);
  }

  // ---------------------------------------------------------------- exports

  /**
   * Columns the Power BI package for these charts would add, or ask the user
   * to add, to their data table (see newColumnsFor). Empty when it uses the
   * file's columns only. The UI asks before exporting with any of them.
   */
  powerBiNewColumns(visibleSpecIds: string[]): NewColumn[] {
    const ec = this.exportContext(false);
    return newColumnsFor(ec, this.orderedSpecs(ec.specs, visibleSpecIds));
  }

  /** Chart specs narrowed to `ids`, in that order (the dashboard as laid out). */
  private orderedSpecs(specs: ChartSpec[], ids: string[]): ChartSpec[] {
    const order = new Map(ids.map((id, i) => [id, i]));
    return specs
      .filter((s) => order.has(s.id))
      .sort((a, b) => (order.get(a.id) as number) - (order.get(b.id) as number));
  }

  /**
   * Snapshot shared by every export generator. KPI values are evaluated over
   * the whole, unfiltered dataset (exports describe the file, not the current
   * view); non-finite results become null. `generatedAt` is a UTC YYYY-MM-DD.
   * With `noNewColumns`, a primary date
   * that would need a helper column is dropped from Date-table duty
   * (`dateTableSkipped`), so no generator adds or asks for a column.
   */
  private exportContext(noNewColumns = false): ExportContext {
    const ds = this.requireDs();
    const ctx = this.requireCtx();
    const ids = [...ctx.res.values()]
      .filter((r) => r.available && r.variant)
      .map((r) => ({ id: r.def.id, expr: r.variant?.expr as NonNullable<typeof r.variant>["expr"] }));
    const ev = evaluateMany(ds, ctx.resolver, ids, [], ctx.dateColumn);
    const kpiValues = new Map<string, number | null>(
      ids.map((m) => [
        m.id,
        Number.isFinite(ev.values.get(m.id) as number) ? (ev.values.get(m.id) as number) : null,
      ]),
    );
    const ec: ExportContext = {
      ds,
      profile: this.profile as DatasetProfile,
      domain: ctx.domain,
      subDomain: ctx.domain.subDomains.find((s) => s.id === ctx.subDomainId),
      mapping: ctx.mapping,
      res: ctx.res,
      selection: ctx.selection,
      specs: ctx.specs,
      names: ctx.names,
      dateColumn: ctx.dateColumn,
      currency: ctx.currency,
      locale: ctx.locale,
      kpiValues,
      generatedAt: new Date().toISOString().slice(0, 10),
      ...(noNewColumns ? { noNewColumns: true } : {}),
      ...(this.hidden.size
        ? { hiddenColumns: ds.columns.filter((c) => this.hidden.has(c.name)).map((c) => c.name) }
        : {}),
    };
    if (noNewColumns && ec.dateColumn) {
      const clean = ec.names.columns.get(ec.dateColumn) ?? ec.dateColumn;
      if (dateRelColumn(ec) !== clean) {
        ec.dateTableSkipped = ec.dateColumn;
        ec.dateColumn = null;
      }
    }
    return ec;
  }

  /**
   * Power BI package as zip bytes. Chart specs are narrowed to
   * `visibleSpecIds`, in that order (the dashboard as laid out); they drive
   * the README's visual list and the RFM/cohort views in kpis.sql.
   * `configJson` is embedded verbatim as loupe-config.json, and the visual
   * list follows it: the user's own charts and their Customise titles,
   * chart types and Top N come from there (export/dashboardCharts.ts), so
   * the README describes the dashboard the config restores. A custom chart
   * the engine would refuse (a hidden column, a KPI that no longer resolves)
   * is left out. With `noNewColumns` the package adds no column (see
   * exportContext); otherwise `manifest.newColumns` lists the ones it adds.
   * `reportTheme` (the chart colours as a Power BI theme) is added as
   * loupe-theme.json. `folder` names the zip's top folder (the zip's own
   * name, so unzipping gives a folder that says what it holds).
   */
  exportPowerBi(
    configJson: string,
    visibleSpecIds: string[],
    noNewColumns = false,
    reportTheme?: { name: string; json: string },
    folder?: string,
  ): { zip: Uint8Array; manifest: PackageManifest } {
    const ec = this.exportContext(noNewColumns);
    const ctx = this.requireCtx();
    const canDraw = (spec: ChartSpec): boolean =>
      !this.hiddenAmong(
        specColumns(spec, (ref) => (ref.startsWith("col:") ? ref.slice(4) : ctx.mapping.fields[ref])),
      ).length &&
      spec.measures.every((m) => {
        try {
          ctx.resolver.kpi(m.id);
          return true;
        } catch {
          return false;
        }
      });
    ec.specs = this.orderedSpecs(dashboardCharts(ec.specs, configJson, canDraw), visibleSpecIds);
    if (reportTheme) ec.reportTheme = reportTheme;
    return buildPowerBiPackage(ec, configJson, folder);
  }

  /** The table name the SQL exports and business-question queries read (lower-case, unquoted). */
  sqlTableName(): string {
    return this.requireCtx().names.table.toLowerCase();
  }

  exportSql(): string {
    return generateSqlFile(this.exportContext());
  }

  exportDax(noNewColumns = false): string {
    const ec = this.exportContext(noNewColumns);
    // Text symbols carry a display space ("CHF ", "kr ", unknown codes), which must not reach a format string.
    return generateDaxFile(ec, currencySymbol(ec.currency).trim());
  }

  /**
   * Every KPI's SQL and DAX in colour, as one readable page (export/codeHtml.ts).
   * `noNewColumns` as for exportDax, so its DAX is the measures.dax the user gets.
   */
  exportCodeHtml(noNewColumns = false): string {
    const ec = this.exportContext(noNewColumns);
    return generateCodeHtml(ec, currencySymbol(ec.currency).trim());
  }

  exportDictionary(format: "csv" | "md"): string {
    const ec = this.exportContext();
    return format === "csv" ? dictionaryCsv(ec) : dictionaryMarkdown(ec);
  }

  /**
   * The whole dataset as UTF-8 CSV bytes (unfiltered). Headers use the
   * export-safe names once a context exists, the original names before.
   * `guard` applies the formula-injection guard; verificationBundle() turns
   * it off so DuckDB sees exactly the values the engine used.
   */
  exportCsv(guard = true, ownHeaders = false): Uint8Array {
    const ds = this.requireDs();
    // The cleaned-data download keeps the file's own headers (only the values are tidied); the SQL
    // and the DuckDB check read the export names that kpis.sql's CREATE TABLE uses.
    const names = ownHeaders ? undefined : this.ctx?.names.columns;
    const parts = datasetToCsvChunks(ds, { headers: names, guardInjection: guard });
    // Encode chunk by chunk and copy into one buffer, never building one giant string.
    const enc = new TextEncoder();
    const bytes = parts.map((p) => enc.encode(p));
    const out = new Uint8Array(bytes.reduce((s, b) => s + b.length, 0));
    let off = 0;
    for (const b of bytes) {
      out.set(b, off);
      off += b.length;
    }
    return out;
  }

  /**
   * CSV of a chart exactly as last computed (current filters, drill, top N),
   * shaped per analysis type. The first column is headed with the chart's
   * axis (the drilled level's column while drilled into), and computed
   * figures are rounded to 12 significant digits so float noise from summing
   * doesn't read as precision. Empty string when the chart has not been
   * computed since the last configure().
   */
  chartCsv(specId: string): string {
    const data = this.lastCharts.get(specId);
    if (!data) return "";
    const csv = (header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null>>) =>
      tableToCsv(
        header,
        rows.map((r) => r.map((c) => (typeof c === "number" ? roundAggregate(c) : c))),
      );
    if (data.rfm)
      return csv(
        [
          "Segment",
          "Customers",
          "Customer share",
          "Revenue",
          "Revenue share",
          "Average recency (days)",
          "Average frequency",
          "Average monetary value",
        ],
        data.rfm.map((s) => [
          s.segment,
          s.customers,
          s.customerShare,
          s.revenue,
          s.revenueShare,
          s.avgRecency,
          s.avgFrequency,
          s.avgMonetary,
        ]),
      );
    if (data.cohorts)
      return csv(
        ["Cohort", "Customers", ...(data.cohorts[0]?.retention.map((_, i) => `Month ${i}`) ?? [])],
        data.cohorts.map((c) => [c.label, c.size, ...c.retention]),
      );
    if (data.basket)
      return csv(
        ["Item A", "Item B", "Orders together", "Support", "Confidence A→B", "Confidence B→A", "Lift"],
        data.basket.pairs.map((p) => [p.a, p.b, p.orders, p.support, p.confidenceAB, p.confidenceBA, p.lift]),
      );
    if (data.matrix && data.seriesCategories) {
      return csv(
        ["", ...data.categories.map((c) => c.label)],
        data.seriesCategories.map((s, i) => [s.label, ...(data.matrix?.[i] ?? [])]),
      );
    }
    if (data.funnel)
      return csv(
        ["Stage", "Value", "From previous", "From first"],
        data.funnel.map((f) => [f.label, f.value, f.fromPrev, f.fromFirst]),
      );
    return csv(
      [data.axisLabel ?? "Category", ...data.series.map((s) => s.label), "Rows"],
      data.categories.map((c, i) => [
        c.label,
        ...data.series.map((s) => s.values[i] ?? null),
        data.rows[i] ?? null,
      ]),
    );
  }

  /**
   * Data + queries for verifying exported SQL in DuckDB-WASM on the main thread.
   * The CSV is unguarded and the column types are declared explicitly (no type
   * sniffing), so DuckDB reads the same values the engine computed from.
   * `engine` is the engine's value over the whole file (no period, no
   * filters: what the SQL views return), to compare against; KPIs whose SQL
   * fails to compile are left out. Each KPI carries the name the user gave it.
   */
  verificationBundle(): {
    csv: Uint8Array;
    table: string;
    columns: Array<{ name: string; type: string }>;
    queries: Array<{ id: string; name: string; sql: string; engine: number | null; format: KpiFormat }>;
  } {
    const ds = this.requireDs();
    const ctx = this.requireCtx();
    const ec = this.exportContext();
    const table = ctx.names.table.toLowerCase();
    const sqlCtx = makeSqlContext(ds, ctx.mapping, ctx.res, { ...ctx.names, table });
    const queries = [
      ...ctx.selection.hero,
      ...ctx.selection.supporting,
      ...ctx.selection.columns,
      ...ctx.selection.detail,
    ]
      .map((id) => ctx.res.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r?.available && r.variant))
      .flatMap((r) => {
        try {
          return [
            {
              id: r.def.id,
              name: displayName(ctx.kpiRenames, r.def.id, r.def.name),
              // The laid-out text, so the DuckDB check runs exactly what people read.
              sql: prettySql(
                kpiQuery(r.variant?.expr as NonNullable<typeof r.variant>["expr"], {
                  ...sqlCtx,
                  table: quoteIdent(table),
                }),
              ),
              engine: ec.kpiValues.get(r.def.id) ?? null,
              format: r.def.format,
            },
          ];
        } catch {
          return [];
        }
      });
    return {
      csv: this.exportCsv(false),
      table,
      columns: ds.columns.map((c) => ({
        name: ctx.names.columns.get(c.name) ?? c.name,
        type:
          c.kind === "number"
            ? "DOUBLE"
            : c.kind === "date"
              ? c.timeOnly
                ? "TIME"
                : c.hasTime
                  ? "TIMESTAMP"
                  : "DATE"
              : exportKind(c) === "boolean"
                ? "BOOLEAN"
                : "VARCHAR",
      })),
      queries,
    };
  }

  /**
   * Anonymised payload for the optional AI layer: schema, aggregated stats and
   * a small masked sample (8 rows), never raw data. Sent (as the AI domain
   * check's `dataset`) only after the user opts in and has seen the exact
   * payload. The same rules cover the sample and `topValues` (the five most
   * frequent values of category and geo columns):
   * - identifier columns, people-name text columns ("Sales Rep", "Customer
   *   Name") and personal number columns (phone, national ID, ten-digit whole
   *   numbers) get per-column pseudonyms, ID-1, ID-2… in order of appearance,
   *   so a repeated value stays visibly repeated; their stats and top values
   *   are not sent;
   * - free text, text columns with more than 50 distinct values, dates of
   *   birth and precise locations (postal codes, coordinates, addresses)
   *   are masked;
   * - any other text value that looks like an email, @handle, web address,
   *   street address, phone number or long digit run becomes a «…»
   *   placeholder, and long values are truncated;
   * - low-cardinality categories, numbers and dates are kept.
   * `privacy` states these rules inside the payload, and each column says
   * whether its values were kept, pseudonymised or masked.
   */
  aiPayload(): Record<string, unknown> {
    const ds = this.requireDs();
    // Columns the user hid are not part of the analysis, so they are not sent either.
    const profile = (this.active ?? this.profile) as DatasetProfile;
    const profileOf = new Map(profile.columns.map((c) => [c.name, c]));
    const treatment = new Map(ds.columns.map((c) => [c.name, aiTreatment(profileOf.get(c.name))]));
    const pseudonyms = new Map<string, Map<string, string>>();
    const pseudonym = (column: string, v: string): string => {
      let seen = pseudonyms.get(column);
      if (!seen) pseudonyms.set(column, (seen = new Map()));
      let p = seen.get(v);
      if (!p) seen.set(v, (p = `ID-${seen.size + 1}`));
      return p;
    };
    const cleanText = (v: string): string =>
      personalDataPlaceholder(v) ?? (v.length > 40 ? `${v.slice(0, 37)}…` : v);
    const mask = (column: string, storage: string, v: string | null): string | null => {
      if (v === null) return null;
      switch (treatment.get(column) ?? "masked") {
        case "keep":
          return storage === "string" ? cleanText(v) : v;
        case "pseudonym":
          return pseudonym(column, v);
        case "text":
          return personalDataPlaceholder(v) ?? "«text»";
        case "birth":
          return "«date of birth»";
        case "masked":
          return personalDataPlaceholder(v) ?? "«masked»";
      }
    };
    const sample = this.rows(0, Math.min(8, ds.rowCount)).map((row) =>
      Object.fromEntries(
        row.flatMap((v, j) => {
          const col = ds.columns[j];
          const name = col?.name ?? `c${j}`;
          return this.hidden.has(name) ? [] : [[name, mask(name, col?.kind ?? "string", v)] as const];
        }),
      ),
    );
    const sent = {
      keep: "kept",
      pseudonym: "pseudonymised",
      text: "masked",
      masked: "masked",
      birth: "masked",
    } as const;
    return {
      privacy: AI_PRIVACY_NOTE,
      rows: ds.rowCount,
      grain: profile.grain.description,
      columns: profile.columns.map((c) => {
        const t = treatment.get(c.name) ?? "masked";
        return {
          name: c.name,
          type: c.storage,
          role: c.role,
          values: sent[t],
          distinct: c.distinct,
          blankPct: Math.round(c.nullPct * 1000) / 10,
          stats:
            c.numeric && t === "keep"
              ? { min: c.numeric.min, max: c.numeric.max, mean: Math.round(c.numeric.mean * 100) / 100 }
              : undefined,
          topValues:
            t === "keep" && c.storage === "string" && (c.role === "dimension" || c.role === "geo")
              ? [...new Set(c.categorical?.top.slice(0, 5).map((v) => cleanText(v.value)))]
              : undefined,
        };
      }),
      sample,
    };
  }
}
