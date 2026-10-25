"use client";

/**
 * "Recent projects" on the upload page (version 53.0): every dataset kept in
 * this browser, newest first, each with what it is and when it was saved;
 * Open brings it back as it was left, and its menu downloads it as a .loupe
 * file or deletes it. Under the list: that it stays in this browser, how much
 * the browser keeps, and "Clear all". Shown only when something is kept.
 *
 * A project with a dashboard can take a new file (version 55.0), such as next
 * month's export: "Refresh with new data" in its menu, or the file dropped on
 * its row. The dashboard opens on the new file with every chart, KPI, filter
 * and colour it can keep, and a report of what changed (RefreshReport.tsx).
 */
import * as React from "react";
import { Download, FolderOpen, History, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { formatBytes, formatCount } from "@/engine/core/format";
import { cn } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { Button } from "@/ui/primitives/button";
import { InfoTip } from "@/ui/primitives/reveal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/primitives/dropdown-menu";
import { askConfirm } from "../confirm";
import {
  clearAllProjects,
  downloadProject,
  openProject,
  pickRefreshFile,
  refreshProject,
  removeProject,
  useProjects,
} from "./store";
import type { ProjectMeta } from "./db";

const subscribe = () => () => {};

/** "just now", "5 min ago", "3 h ago", "2 days ago", then the date. */
function ago(t: number, now: number): string {
  const min = Math.round((now - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 8) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function RecentProjects() {
  const list = useProjects((p) => p.list);
  const used = useProjects((p) => p.used);
  const unavailable = useProjects((p) => p.unavailable);
  const locale = useSettings((s) => s.numberLocale);
  // The time is read in the browser only, so the server's page never differs from the first paint.
  const now = React.useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / 60000) * 60000,
    () => 0,
  );
  if (unavailable || !list.length) return null;
  return (
    <section aria-labelledby="recent-projects" className="mt-6 min-w-0">
      <div className="mb-2 flex items-center gap-1.5">
        <h2 id="recent-projects" className="eyebrow text-fg-subtle">
          Recent projects
        </h2>
        <InfoTip label="About your projects">
          Each file you open is kept here with its dashboard, so it opens again as you left it. They are kept
          in this browser only and never uploaded. Turn this off in Settings on a shared computer.
        </InfoTip>
      </div>
      <ul className="grid gap-1.5">
        {list.slice(0, 8).map((p) => (
          <ProjectRow key={p.id} project={p} when={now ? ago(p.savedAt, now) : ""} locale={locale} />
        ))}
      </ul>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
        <span>
          Kept in this browser only{used !== null ? ` · ${formatBytes(used)} used` : ""}
          {list.length > 8 ? ` · ${list.length} projects` : ""}
        </span>
        <button
          type="button"
          className="rounded-sm font-medium text-accent-text underline-offset-2 hover:underline focus-visible:focus-ring"
          onClick={async () => {
            const ok = await askConfirm({
              title: "Clear every project?",
              body: `This deletes the ${list.length === 1 ? "project" : `${list.length} projects`} kept in this browser, with their dashboards. Your files on your computer stay as they are.`,
              confirmLabel: "Clear all",
              cancelLabel: "Keep them",
              tone: "danger",
            });
            if (ok) await clearAllProjects();
          }}
        >
          Clear all
        </button>
      </p>
    </section>
  );
}

function ProjectRow({
  project: p,
  when,
  locale,
}: {
  project: ProjectMeta;
  when: string;
  locale: "IN" | "INTL";
}) {
  const [busy, setBusy] = React.useState(false);
  // A data file dragged over a project with a dashboard: dropping it refreshes that dashboard.
  const [over, setOver] = React.useState(false);
  const takesFiles = (e: React.DragEvent) => p.built && e.dataTransfer.types.includes("Files");
  return (
    <li
      onDragOver={(e) => {
        if (!takesFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!takesFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file && !/\.loupe$/i.test(file.name)) void refreshProject(p.id, file);
      }}
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-card border bg-surface-1 py-2 pr-2 pl-3 transition-[border-color,box-shadow] duration-fast",
        over ? "border-accent shadow-[0_0_0_3px_var(--accent-soft)]" : "border-border",
      )}
    >
      <History className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui font-medium text-fg" title={p.fileName}>
          {p.name}
          {p.sampleId && !/demo/i.test(p.name) ? (
            <span className="font-normal text-fg-subtle"> · demo</span>
          ) : null}
        </p>
        <p className="tabular truncate text-xs text-fg-muted">
          {over ? "Drop to refresh its dashboard with this file · " : ""}
          {formatCount(p.rows, locale)} rows
          {p.bytes ? ` · ${formatBytes(p.bytes)}` : ""}
          {p.built ? " · dashboard" : ""}
          {when ? ` · saved ${when}` : ""}
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await openProject(p.id);
          } finally {
            setBusy(false);
          }
        }}
      >
        <FolderOpen aria-hidden /> Open
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`More for ${p.name}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {p.built ? (
            <DropdownMenuItem onSelect={() => pickRefreshFile(p.id)}>
              <RefreshCw aria-hidden /> Refresh with new data…
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => void downloadProject(p.id)}>
            <Download aria-hidden /> Download as .loupe
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={async () => {
              const ok = await askConfirm({
                title: `Delete ${p.name}?`,
                body: "This deletes the project and its dashboard from this browser. The file on your computer stays as it is.",
                confirmLabel: "Delete",
                cancelLabel: "Keep it",
                tone: "danger",
              });
              if (ok) await removeProject(p.id);
            }}
          >
            <Trash2 aria-hidden /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
