/**
 * The projects kept in this browser (version 53.0), in IndexedDB: database
 * "loupe-projects", one store "projects" keyed by id. A record holds the file
 * as it was opened (a Blob; none for a demo, which is generated again from its
 * id), how it was read (the sheet, any sampling), the dashboard's settings
 * (LoupeConfig: every choice, no rows), the step it was on and when it was
 * saved. Nothing here goes over the network: the browser keeps it on this
 * device, and the user can delete one project or all of them.
 *
 * Every call fails softly where storage is unavailable (a private window,
 * blocked site data): it rejects, and the caller says so once.
 */
import type { IngestOptions } from "@/engine/core/types";
import type { LoupeConfig } from "@/engine/export/config";
import type { Step } from "@/store/workspace";

export interface ProjectMeta {
  id: string;
  /** The project's name: the dataset's name when it was opened. */
  name: string;
  fileName: string;
  /** A demo is kept by its id and generated again on opening. */
  sampleId?: string;
  rows: number;
  columns: number;
  /** The kept file's size in bytes (0 for a demo). */
  bytes: number;
  createdAt: number;
  savedAt: number;
  /** The step it was on when last saved. */
  step?: Step;
  /** Whether a dashboard was built (the config is kept). */
  built: boolean;
}

export interface ProjectRecord extends ProjectMeta {
  file?: Blob;
  options?: IngestOptions;
  config?: LoupeConfig | null;
}

const DB_NAME = "loupe-projects";
const STORE = "projects";

/** True when this browser offers IndexedDB at all. */
export function projectsSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

let opening: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("This browser's storage couldn't be opened."));
  }).catch((e: unknown) => {
    opening = null;
    throw e;
  });
  return opening;
}

/** Runs one request in a transaction and resolves with its result when the transaction completes. */
async function run<T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = make(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error("The project couldn't be saved."));
    tx.onabort = () => reject(tx.error ?? new Error("The project couldn't be saved: storage is full."));
  });
}

/** Every project's facts (no files), newest saved first. */
export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await run<ProjectRecord[]>("readonly", (s) => s.getAll() as IDBRequest<ProjectRecord[]>);
  return all
    .map(({ file: _file, options: _options, config: _config, ...meta }) => meta)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  return run<ProjectRecord | undefined>(
    "readonly",
    (s) => s.get(id) as IDBRequest<ProjectRecord | undefined>,
  );
}

export async function putProject(rec: ProjectRecord): Promise<void> {
  await run("readwrite", (s) => s.put(rec));
}

/** Merges `patch` into a kept project; does nothing when it was deleted meanwhile. */
export async function updateProject(id: string, patch: Partial<ProjectRecord>): Promise<void> {
  const rec = await getProject(id);
  if (rec) await putProject({ ...rec, ...patch, id });
}

export async function deleteProject(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
}

export async function clearProjects(): Promise<void> {
  await run("readwrite", (s) => s.clear());
}

/** Bytes this site keeps in the browser (projects, settings), when the browser says. */
export async function storageUsed(): Promise<number | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    return est?.usage ?? null;
  } catch {
    return null;
  }
}
