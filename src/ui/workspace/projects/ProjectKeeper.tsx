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
 * - A project is refreshed with a new file (version 55.0): the load
 *   finishes the refresh (finishRefresh) instead of becoming a project.
 *
 * The open project's id is in sessionStorage, so a reload in this tab opens
 * it again (Workspace). Nothing is kept while Settings › "Keep projects in
 * this browser" is off, and nothing leaves the browser.
 */
import * as React from "react";
import { allSpecs, kpiLayoutOf, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { buildConfig } from "@/store/config";
import { getProject, putProject, updateProject, type ProjectRecord, type ProjectShown } from "./db";
import { finishRefresh, refreshProjects, setCurrent, storageFailed, useProjects } from "./store";
import { RefreshReportDialog } from "./RefreshReport";

/** Saves run this long after the last change, so a burst of changes is one write. */
const SAVE_AFTER = 1500;

type WS = ReturnType<typeof useWorkspace.getState>;

/** The dashboard's KPIs and charts by name, and its last date: what a refresh compares with. */
function shownOf(s: WS): ProjectShown | undefined {
  const ctx = s.context;
  if (!ctx) return undefined;
  const layout = kpiLayoutOf(s);
  const kpiName = new Map(ctx.kpis.map((k) => [k.id, k.name]));
  const specs = new Map(allSpecs(s).map((c) => [c.id, c.title]));
  return {
    kpis: [...layout.hero, ...layout.supporting].map((id) => ({ id, name: kpiName.get(id) ?? id })),
    charts: s.widgets
      .filter((w) => !w.hidden && specs.has(w.id))
      .map((w) => ({ id: w.id, title: w.title ?? specs.get(w.id) ?? w.id })),
    ...(ctx.dateBounds ? { dataTo: ctx.dateBounds.max } : {}),
  };
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
  // A project's new file: the refresh applies its dashboard and reports what changed.
  const refreshing = useProjects.getState().refreshing;
  if (refreshing && s.lastFile === refreshing.file) {
    await finishRefresh();
    return;
  }
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
        await updateProject(id, {
          config,
          step: s.step,
          savedAt: Date.now(),
          built: Boolean(config),
          shown: config ? shownOf(s) : undefined,
        });
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
  return <RefreshReportDialog />;
}
