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
 */
import { create } from "zustand";
import { toast } from "sonner";
import { z } from "zod";
import { configSchema } from "@/engine/export/config";
import { useWorkspace, STEPS, type Step } from "@/store/workspace";
import { downloadBlob } from "@/lib/utils";
import {
  clearProjects,
  deleteProject,
  getProject,
  listProjects,
  projectsSupported,
  putProject,
  storageUsed,
  type ProjectMeta,
  type ProjectRecord,
} from "./db";

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
}

export const useProjects = create<ProjectsState>()(() => ({
  list: [],
  used: null,
  currentId: null,
  reopening: null,
  dirty: false,
  unavailable: !projectsSupported(),
}));

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
