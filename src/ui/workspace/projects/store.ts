/**
 * Saved projects (version 53.0): the list the upload page shows, the project
 * open now, and opening, deleting, downloading and importing them. Kept in
 * this browser (projects/db.ts); ProjectKeeper creates and saves them.
 *
 * Opening a project reads its file again (or generates its demo) the way it
 * was first read, then applies its saved settings (applyConfig), so the
 * dashboard comes back as it was left, on the step it was left on. While one
 * opens, `reopening` holds its id, so the keeper adds the load to it rather
 * than starting a new project.
 *
 * A .loupe file is a project to take elsewhere: a zip of the file as opened
 * and "loupe-project.json" (the project's facts and settings, never anything
 * else). It is checked before anything in it is used.
 *
 * Refreshing a project (version 55.0) gives its dashboard a new file, such as
 * next month's export: the file is read against the columns the dashboard was
 * built on (a renamed column keeps its saved name, parse/matchColumns.ts), the
 * saved settings are fitted to it (export/refresh.ts) and applied, the project
 * keeps the new file, and a report says what changed (refresh.ts). The
 * project as it was is held until the report closes, for "Undo".
 */
import { create } from "zustand";
import { toast } from "sonner";
import { z } from "zod";
import { configSchema } from "@/engine/export/config";
import { fitConfig } from "@/engine/export/refresh";
import { allSpecs, kpiLayoutOf, useWorkspace, STEPS, type Step } from "@/store/workspace";
import { buildConfig } from "@/store/config";
import { useSettings } from "@/store/settings";
import { engine } from "@/lib/engine-client";
import { downloadBlob } from "@/lib/utils";
import {
  clearProjects,
  deleteProject,
  getProject,
  listProjects,
  projectsSupported,
  putProject,
  storageUsed,
  updateProject,
  type ProjectMeta,
  type ProjectRecord,
} from "./db";
import { buildRefreshReport, type RefreshReport } from "./refresh";

/** The open project's id in this tab, so a reload opens it again (sessionStorage: this tab only). */
export const OPEN_PROJECT_KEY = "loupe-open-project";

interface ProjectsState {
  list: ProjectMeta[];
  /** Bytes the site keeps in this browser, when the browser says. */
  used: number | null;
  /** The project open now. */
  currentId: string | null;
  /** The id of a project being opened, so its load joins it. */
  reopening: string | null;
  /** A change not yet saved (a save runs a moment after the last change). */
  dirty: boolean;
  /** Set once storage fails, so it is said once and the app carries on without it. */
  unavailable: boolean;
  /** A project being refreshed: its id, the new file and the project as it was. */
  refreshing: { id: string; file: File; previous: ProjectRecord } | null;
  /** What the last refresh changed, shown until it is closed. */
  report: RefreshReport | null;
}

export const useProjects = create<ProjectsState>()(() => ({
  list: [],
  used: null,
  currentId: null,
  reopening: null,
  dirty: false,
  unavailable: !projectsSupported(),
  refreshing: null,
  report: null,
}));

/** Marks the project open in this tab, so a reload in it opens it again. */
export function setCurrent(id: string | null): void {
  useProjects.setState({ currentId: id });
  try {
    if (id) sessionStorage.setItem(OPEN_PROJECT_KEY, id);
    else sessionStorage.removeItem(OPEN_PROJECT_KEY);
  } catch {
    /* sessionStorage can be unavailable; the project is still kept, only a reload won't reopen it */
  }
}

/** Says once that the browser won't keep projects, then stops trying. */
export function storageFailed(e: unknown): void {
  if (useProjects.getState().unavailable) return;
  useProjects.setState({ unavailable: true, dirty: false });
  toast.error("This browser won't keep your project", {
    description: `${(e as Error)?.message ?? "Storage is unavailable"}. Everything still works; it just won't be here after a reload.`,
  });
}

/** Reads the kept projects into the list. */
export async function refreshProjects(): Promise<void> {
  if (useProjects.getState().unavailable) return;
  try {
    const [list, used] = await Promise.all([listProjects(), storageUsed()]);
    useProjects.setState({ list, used });
  } catch {
    useProjects.setState({ unavailable: true });
  }
}

/** Opens a kept project: its file read again (or its demo), its settings applied, its step shown. */
export async function openProject(id: string): Promise<void> {
  let rec: ProjectRecord | undefined;
  try {
    rec = await getProject(id);
  } catch (e) {
    storageFailed(e);
    return;
  }
  if (!rec) {
    sessionStorage.removeItem(OPEN_PROJECT_KEY);
    toast.error("That project is no longer kept in this browser.");
    void refreshProjects();
    return;
  }
  useProjects.setState({ reopening: id });
  const ws = useWorkspace.getState();
  try {
    if (rec.sampleId) await ws.loadSample(rec.sampleId);
    else if (rec.file)
      await ws.loadFile(new File([rec.file], rec.fileName, { type: rec.file.type }), rec.options ?? {});
    else throw new Error("The project holds no file.");
    if (!useWorkspace.getState().summary) return;
    if (rec.config) await useWorkspace.getState().applyConfig(rec.config);
    const step =
      rec.step && STEPS.some((s) => s.id === rec.step) ? rec.step : rec.config ? "dashboard" : "detect";
    useWorkspace.getState().setStep(step);
  } catch (e) {
    toast.error(`${rec.name} couldn't be opened`, { description: (e as Error).message });
  } finally {
    useProjects.setState({ reopening: null });
  }
}

export async function removeProject(id: string): Promise<void> {
  try {
    await deleteProject(id);
  } catch (e) {
    storageFailed(e);
    return;
  }
  if (useProjects.getState().currentId === id) {
    useProjects.setState({ currentId: null });
    sessionStorage.removeItem(OPEN_PROJECT_KEY);
  }
  await refreshProjects();
}

export async function clearAllProjects(): Promise<void> {
  try {
    await clearProjects();
  } catch (e) {
    storageFailed(e);
    return;
  }
  useProjects.setState({ currentId: null });
  sessionStorage.removeItem(OPEN_PROJECT_KEY);
  await refreshProjects();
}

// ---------------------------------------------------------------- refresh with a new file

/** The files a project can be refreshed with: the upload page's data files (not a .loupe project). */
const REFRESH_ACCEPT = ".csv,.tsv,.txt,.psv,.tab,.xlsx,.xlsm,.xlsb,.xls,.ods,.json,.ndjson,.jsonl";

/** Opens the file picker and refreshes the project with the file chosen ("Refresh with new data"). */
export function pickRefreshFile(id: string): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = REFRESH_ACCEPT;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void refreshProject(id, file);
  };
  input.click();
}

/**
 * Gives a project's dashboard a new file. The file is read against the dashboard's columns; the
 * keeper hands the load to finishRefresh, now or once a sheet or a large file's sampling is chosen.
 */
export async function refreshProject(id: string, file: File): Promise<void> {
  // The keeper finishes a refresh, and it only runs while projects are kept.
  if (!useSettings.getState().keepProjects || useProjects.getState().unavailable) {
    toast.error("Projects aren't kept in this browser", {
      description:
        "Turn on “Keep projects in this browser” in Settings to refresh a dashboard with a new file.",
    });
    return;
  }
  let rec: ProjectRecord | undefined;
  try {
    rec = await getProject(id);
  } catch (e) {
    storageFailed(e);
    return;
  }
  if (!rec) {
    toast.error("That project is no longer kept in this browser.");
    void refreshProjects();
    return;
  }
  const ws = useWorkspace.getState();
  // The open project's latest settings, which the keeper may not have written yet.
  if (useProjects.getState().currentId === id && ws.context)
    rec = { ...rec, config: buildConfig() ?? rec.config };
  const config = rec.config;
  if (!config) {
    toast.error(`${rec.name} has no dashboard yet`, {
      description: "Open it and build its dashboard first; a new file then refreshes it.",
    });
    return;
  }
  // The same sheet as before, when the new workbook has one of that name; otherwise the user chooses.
  let sheet: string | undefined;
  const savedSheet = rec.options?.sheet;
  if (savedSheet) {
    const sheets = await engine()
      .listSheets(file)
      .catch(() => [] as string[]);
    if (sheets.includes(savedSheet)) sheet = savedSheet;
  }
  useProjects.setState({ refreshing: { id, file, previous: rec }, report: null });
  await ws.loadFile(file, {
    ...(sheet ? { sheet } : {}),
    ...(rec.options?.dateOrderOverrides ? { dateOrderOverrides: rec.options.dateOrderOverrides } : {}),
    matchColumns: config.fingerprint.columns,
  });
  // Nothing loaded (an unreadable file) and no choice pending: the refresh is over.
  const after = useWorkspace.getState();
  if (
    useProjects.getState().refreshing?.file === file &&
    !after.sheets &&
    !after.largeFile &&
    after.lastFile !== file
  )
    useProjects.setState({ refreshing: null });
}

/** The new file has loaded: the project takes it, the saved dashboard is fitted and applied, and the report is made. */
export async function finishRefresh(): Promise<void> {
  const r = useProjects.getState().refreshing;
  const ws = useWorkspace.getState();
  const sum = ws.summary;
  const config = r?.previous.config;
  if (!r || !sum || !config) return;
  setCurrent(r.id);
  const changes = ws.report?.matched ?? { renamed: [], missing: [], added: [], retyped: [], same: 0 };
  const fitted = fitConfig(config, changes);
  try {
    await updateProject(r.id, {
      file: r.file,
      fileName: sum.fileName,
      rows: sum.rowCount,
      columns: sum.columnCount,
      bytes: r.file.size,
      options: ws.lastOptions,
      savedAt: Date.now(),
    });
    await ws.applyConfig(fitted.config);
  } catch (e) {
    useProjects.setState({ refreshing: null });
    toast.error(`${r.previous.name} couldn't be refreshed`, { description: (e as Error).message });
    return;
  }
  const s = useWorkspace.getState();
  const ctx = s.context;
  const layout = kpiLayoutOf(s);
  const specs = new Set(allSpecs(s).map((c) => c.id));
  const report = buildRefreshReport(r.previous, changes, fitted, {
    fileName: sum.fileName,
    rows: sum.rowCount,
    dataTo: ctx?.dateBounds?.max ?? null,
    kpis: ctx?.kpis ?? [],
    customKpiIssues: ctx?.customKpiIssues ?? [],
    layout: [...layout.hero, ...layout.supporting],
    charts: s.widgets.filter((w) => !w.hidden && specs.has(w.id)).map((w) => w.id),
    skippedCharts: ctx?.skippedCharts ?? [],
  });
  useProjects.setState({ refreshing: null, report });
  void refreshProjects();
}

/** Puts the project back as it was before the refresh, with its old file, and opens it. */
export async function undoRefresh(): Promise<void> {
  const report = useProjects.getState().report;
  if (!report) return;
  useProjects.setState({ report: null });
  try {
    await putProject(report.previous);
  } catch (e) {
    storageFailed(e);
    return;
  }
  await openProject(report.previous.id);
  void refreshProjects();
}

// ---------------------------------------------------------------- .loupe files

const MANIFEST = "loupe-project.json";

/** What a .loupe file's manifest may hold; anything else in it is ignored. */
const manifestSchema = z.object({
  format: z.literal("loupe-project"),
  version: z.literal(1),
  name: z.string().min(1).max(200),
  fileName: z.string().min(1).max(260),
  sampleId: z.string().max(60).optional(),
  rows: z.number().nonnegative(),
  columns: z.number().nonnegative(),
  step: z.enum(STEPS.map((s) => s.id) as [Step, ...Step[]]).optional(),
  options: z
    .object({
      sheet: z.string().max(260).optional(),
      sampleEvery: z.number().positive().optional(),
      maxRows: z.number().positive().optional(),
      columns: z.array(z.string()).optional(),
      dateOrderOverrides: z.record(z.string(), z.enum(["DMY", "MDY"])).optional(),
      matchColumns: z
        .array(z.object({ name: z.string().max(500), type: z.string().max(20) }))
        .max(5000)
        .optional(),
    })
    .optional(),
  config: configSchema.nullable().optional(),
});

/** Saves a kept project as a .loupe file: the file as opened and its settings. */
export async function downloadProject(id: string): Promise<void> {
  const rec = await getProject(id).catch(() => undefined);
  if (!rec) return;
  const { zipSync, strToU8 } = await import("fflate");
  const manifest = {
    format: "loupe-project",
    version: 1,
    name: rec.name,
    fileName: rec.fileName,
    ...(rec.sampleId ? { sampleId: rec.sampleId } : {}),
    rows: rec.rows,
    columns: rec.columns,
    ...(rec.step ? { step: rec.step } : {}),
    ...(rec.options
      ? {
          options: {
            ...(rec.options.sheet ? { sheet: rec.options.sheet } : {}),
            ...(rec.options.sampleEvery ? { sampleEvery: rec.options.sampleEvery } : {}),
            ...(rec.options.maxRows ? { maxRows: rec.options.maxRows } : {}),
            ...(rec.options.columns ? { columns: rec.options.columns } : {}),
            ...(rec.options.dateOrderOverrides ? { dateOrderOverrides: rec.options.dateOrderOverrides } : {}),
            ...(rec.options.matchColumns ? { matchColumns: rec.options.matchColumns } : {}),
          },
        }
      : {}),
    config: rec.config ?? null,
  };
  const files: Record<string, Uint8Array> = { [MANIFEST]: strToU8(JSON.stringify(manifest, null, 2)) };
  if (rec.file) files[`data/${rec.fileName}`] = new Uint8Array(await rec.file.arrayBuffer());
  const zip = zipSync(files, { level: 6 });
  const safe = rec.name.replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(0, 80) || "project";
  downloadBlob(new Blob([zip as BlobPart], { type: "application/zip" }), `${safe}.loupe`);
}

/** Keeps a .loupe file's project in this browser and opens it. */
export async function importProjectFile(file: File): Promise<void> {
  try {
    const { unzipSync, strFromU8 } = await import("fflate");
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const raw = entries[MANIFEST];
    if (!raw) throw new Error("It isn't a Loupe project: it has no loupe-project.json.");
    const parsed = manifestSchema.safeParse(JSON.parse(strFromU8(raw)));
    if (!parsed.success) throw new Error("Its project details couldn't be read.");
    const m = parsed.data;
    const data = entries[`data/${m.fileName}`];
    if (!m.sampleId && !data) throw new Error("It holds no data file.");
    const now = Date.now();
    const rec: ProjectRecord = {
      id: crypto.randomUUID(),
      name: m.name,
      fileName: m.fileName,
      ...(m.sampleId ? { sampleId: m.sampleId } : {}),
      rows: m.rows,
      columns: m.columns,
      bytes: data?.byteLength ?? 0,
      createdAt: now,
      savedAt: now,
      ...(m.step ? { step: m.step } : {}),
      built: Boolean(m.config),
      ...(data ? { file: new Blob([data as BlobPart]) } : {}),
      ...(m.options ? { options: m.options } : {}),
      config: m.config ?? null,
    };
    await putProject(rec);
    await refreshProjects();
    await openProject(rec.id);
  } catch (e) {
    toast.error(`${file.name} couldn't be opened`, { description: (e as Error).message });
  }
}
