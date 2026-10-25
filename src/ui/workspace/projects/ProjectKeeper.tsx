"use client";

/**
 * Keeps the open dataset as a project in this browser (version 53.0), with
 * nothing to press. Mounted once by Workspace, it watches the workspace:
 *
 * - A dataset loads: it becomes a project (the file as opened, how it was
 *   read), unless it is a project being opened, or the same file or demo
 *   already kept (that project is used again, not duplicated). Reading the
 *   same file again (another date order) stays the same project. A table
 *   made in the app from another (an unpivot) is kept as its source file.
 * - Anything changes: a moment after the last change (SAVE_AFTER), the
 *   dashboard's settings (buildConfig) and the step are saved, only when
 *   they differ from what was saved.
 * - The dataset closes (Start over): no project is open; it stays kept.
 *
 * The open project's id is in sessionStorage, so a reload in this tab opens
 * it again (Workspace). Nothing is kept while Settings › "Keep projects in
 * this browser" is off, and nothing leaves the browser.
 */
import * as React from "react";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { buildConfig } from "@/store/config";
import { getProject, putProject, updateProject, type ProjectRecord } from "./db";
import { OPEN_PROJECT_KEY, refreshProjects, storageFailed, useProjects } from "./store";

/** Saves run this long after the last change, so a burst of changes is one write. */
const SAVE_AFTER = 1500;

type WS = ReturnType<typeof useWorkspace.getState>;

function setCurrent(id: string | null) {
  useProjects.setState({ currentId: id });
  try {
    if (id) sessionStorage.setItem(OPEN_PROJECT_KEY, id);
    else sessionStorage.removeItem(OPEN_PROJECT_KEY);
  } catch {
    /* sessionStorage can be unavailable; the project is still kept, only a reload won't reopen it */
  }
}

/** The kept project this dataset already is (the same demo, or a file of the same name and size). */
function sameAs(s: WS): string | undefined {
  const sum = s.summary;
  if (!sum) return undefined;
  return useProjects
    .getState()
    .list.find((p) =>
      sum.isDemo
        ? p.sampleId === sum.sampleId
        : !p.sampleId && p.fileName === sum.fileName && p.bytes === (s.lastFile?.size ?? -1),
    )?.id;
}

async function onDataset(s: WS, prev: WS): Promise<void> {
  const sum = s.summary;
  if (!sum) return;
  const reopening = useProjects.getState().reopening;
  if (reopening) {
    setCurrent(reopening);
    return;
  }
  const current = useProjects.getState().currentId;
  // The same file read again, or a table made from it: still this project, read the new way.
  if (current && prev.summary && s.lastFile && s.lastFile === prev.lastFile) {
    await updateProject(current, { options: s.lastOptions, savedAt: Date.now() });
    return;
  }
  if (!sum.isDemo && !s.lastFile) return;
  const now = Date.now();
  const existing = sameAs(s);
  const old = existing ? await getProject(existing) : undefined;
  const rec: ProjectRecord = {
    id: existing ?? crypto.randomUUID(),
    name: sum.name,
    fileName: sum.fileName,
    ...(sum.isDemo && sum.sampleId ? { sampleId: sum.sampleId } : {}),
    rows: sum.rowCount,
    columns: sum.columnCount,
    bytes: sum.isDemo ? 0 : (s.lastFile?.size ?? sum.sizeBytes),
    createdAt: old?.createdAt ?? now,
    savedAt: now,
    step: s.step,
    built: false,
    ...(!sum.isDemo && s.lastFile ? { file: s.lastFile } : {}),
    options: s.lastOptions,
    config: null,
  };
  await putProject(rec);
  setCurrent(rec.id);
  await refreshProjects();
}

export function ProjectKeeper() {
  React.useEffect(() => {
    void refreshProjects();
    let timer: number | null = null;
    let lastSaved = "";

    const save = async () => {
      timer = null;
      const id = useProjects.getState().currentId;
      if (!id) {
        useProjects.setState({ dirty: false });
        return;
      }
      const s = useWorkspace.getState();
      const config = s.context ? buildConfig() : null;
      // What is saved, without its timestamp, so an unchanged dashboard isn't written again.
      const snapshot = JSON.stringify({ config: config && { ...config, createdAt: "" }, step: s.step, id });
      if (snapshot === lastSaved) {
        useProjects.setState({ dirty: false });
        return;
      }
      try {
        await updateProject(id, { config, step: s.step, savedAt: Date.now(), built: Boolean(config) });
        lastSaved = snapshot;
        useProjects.setState({ dirty: false });
        void refreshProjects();
      } catch (e) {
        storageFailed(e);
      }
    };
    const schedule = () => {
      useProjects.setState({ dirty: true });
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void save(), SAVE_AFTER);
    };

    const unsubscribe = useWorkspace.subscribe((s, prev) => {
      if (!useSettings.getState().keepProjects || useProjects.getState().unavailable) return;
      if (s.summary !== prev.summary) {
        if (!s.summary) {
          setCurrent(null);
          return;
        }
        if (s.summary.id !== prev.summary?.id) void onDataset(s, prev).then(schedule).catch(storageFailed);
        return;
      }
      if (useProjects.getState().currentId && !s.loading) schedule();
    });
    return () => {
      unsubscribe();
      if (timer) window.clearTimeout(timer);
    };
  }, []);
  return null;
}
