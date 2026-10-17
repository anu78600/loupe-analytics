"use client";

/**
 * Step 3's "Your data": the whole file, so the user can confirm the upload is
 * right before the dashboard, with every problem the data check found
 * (profile/dataCheck.ts). On the left, what to check: the rows to check, one
 * entry per problem found (cells that couldn't be read, values that break a
 * rule, repeated rows) and the blanks of each column; picking one filters
 * the grid to those rows. On the right, the grid with problem cells tinted
 * and explained in their tooltips.
 *
 * Each column header can hide its column from the analysis. Hidden columns
 * stay in the grid as the user's reference, dimmed, and the check leaves
 * them out: their problems neither mark cells nor count as rows to check.
 */
import { FileIdentity } from "./FileIdentity";
import * as React from "react";
import { AlertTriangle, CheckCircle2, EyeOff, Info, Rows3 } from "lucide-react";
import type { CheckView } from "@/engine/profile/dataCheck";
import { formatCount } from "@/engine/core/format";
import { engine } from "@/lib/engine-client";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { Badge } from "@/ui/primitives/badge";
import { Skeleton } from "@/ui/primitives/misc";
import { VirtualGrid } from "./VirtualGrid";
import { useFileColumns } from "./useFileColumns";

const TONE_ICON = { warning: AlertTriangle, info: Info, neutral: Rows3 } as const;
const TONE_TEXT = { warning: "text-warning", info: "text-info", neutral: "text-fg-subtle" } as const;

export function DataCheckPanel() {
  const summary = useWorkspace((s) => s.summary);
  // Every column of the file, with the user's role changes; hidden ones included (they stay in the grid).
  const file = useFileColumns();
  const setHidden = useWorkspace((s) => s.setColumnsHidden);
  const health = useWorkspace((s) => s.health);
  const locale = useSettings((s) => s.numberLocale);
  const [state, setState] = React.useState<{ key: string; views: CheckView[] } | null>(null);
  const [selected, setSelected] = React.useState("all");
  const datasetId = summary?.id ?? "";
  // The hidden columns the worker has applied: the views are fetched again once it has rebuilt without them.
  const applied = useWorkspace((s) => s.context?.hiddenColumns.join("\u0000") ?? "");
  const key = `${datasetId}|${applied}`;

  React.useEffect(() => {
    if (!datasetId) return;
    let live = true;
    void engine()
      .checkViews()
      .then((views) => {
        if (live) setState({ key, views });
      });
    return () => {
      live = false;
    };
  }, [datasetId, key]);

  const views = state?.key === key ? state.views : null;
  if (!summary || !file) return null;
  const hiddenNames = file.columns.filter((c) => file.hidden.has(c.name)).map((c) => c.name);
  const view = views?.find((v) => v.id === selected) ?? views?.[0];
  const toCheck = views?.find((v) => v.id === "problems");
  const issues = views?.filter((v) => v.id.startsWith("issue:")) ?? [];
  const blanks = views?.filter((v) => v.id.startsWith("blank:")) ?? [];

  const item = (v: CheckView) => {
    const Icon = TONE_ICON[v.tone];
    const active = view?.id === v.id;
    return (
      <li key={v.id}>
        <button
          type="button"
          onClick={() => setSelected(v.id)}
          aria-pressed={active}
          className={cn(
            "flex w-full items-start gap-2.5 rounded-control border px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none",
            active ? "border-border-accent bg-accent-soft" : "border-transparent hover:bg-surface-2",
          )}
        >
          <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_TEXT[v.tone])} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-ui text-fg" title={v.label}>
                {v.label}
              </span>
              <span className="font-figures shrink-0 text-xs text-fg-muted">
                {formatCount(v.rows, locale)}
              </span>
            </span>
            {v.id.startsWith("issue:") ? (
              <span className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-fg-subtle" title={v.detail}>
                {v.detail}
              </span>
            ) : null}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside aria-label="What to check" className="grid min-w-0 grid-cols-1 content-start gap-4">
        <div className="rounded-card border border-border bg-surface-1 p-4">
          <p className="eyebrow text-fg-subtle">{summary.isDemo ? "Demo file" : "Your file"}</p>
          <FileIdentity summary={summary} badge={false} className="mt-1.5" />
          <p className="mt-1 text-ui text-fg">
            {formatCount(summary.rowCount, locale)} rows · {summary.columnCount} columns
          </p>
          {health ? (
            <p className="mt-1 flex items-center gap-2 text-ui text-fg-muted">
              Data health <Badge tone={health.score >= 90 ? "success" : "warning"}>{health.score}/100</Badge>
              {health.grade}
            </p>
          ) : null}
          {hiddenNames.length ? (
            <p className="mt-2 flex items-start gap-2 text-ui text-fg-muted">
              <EyeOff className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
              <span>
                {hiddenNames.length === 1 ? "1 hidden column is" : `${hiddenNames.length} hidden columns are`}{" "}
                not checked: nothing computes from{" "}
                {hiddenNames.length === 1
                  ? `"${hiddenNames[0]}"`
                  : hiddenNames.map((h) => `"${h}"`).join(", ")}
                .
              </span>
            </p>
          ) : null}
          {toCheck ? (
            toCheck.rows ? (
              <p className="mt-2 flex items-start gap-2 text-ui text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {formatCount(toCheck.rows, locale)} {toCheck.rows === 1 ? "row needs" : "rows need"} a look.
              </p>
            ) : (
              <p className="mt-2 flex items-start gap-2 text-ui text-success">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                Every cell was read and no rule is broken.
              </p>
            )
          ) : null}
        </div>
        {views ? (
          <>
            <ul className="grid grid-cols-1 gap-1">
              {views.filter((v) => v.id === "all" || v.id === "problems").map(item)}
            </ul>
            {issues.length ? (
              <div>
                <p className="eyebrow mb-1 px-3 text-fg-subtle">Problems found</p>
                <ul className="grid grid-cols-1 gap-1">{issues.map(item)}</ul>
              </div>
            ) : null}
            {blanks.length ? (
              <details className="group">
                <summary className="eyebrow cursor-pointer rounded-control px-3 py-1.5 text-fg-subtle hover:text-fg">
                  Blank cells by column ({blanks.length})
                </summary>
                <ul className="mt-1 grid grid-cols-1 gap-1">{blanks.map(item)}</ul>
              </details>
            ) : null}
          </>
        ) : (
          <div className="grid gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
      </aside>
      <section aria-label="Your data" className="grid min-w-0 content-start gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-ui text-fg">
            {view ? (
              <>
                {view.label}
                <span className="text-fg-muted"> · {formatCount(view.rows, locale)} rows</span>
              </>
            ) : (
              "Loading…"
            )}
          </p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted" aria-label="Legend">
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded-[3px] border border-border bg-warning-soft" aria-hidden /> Needs
              a look (hover for why)
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded-[3px] border border-border bg-info-soft" aria-hidden /> Worth
              knowing
            </li>
          </ul>
        </div>
        {view ? (
          <VirtualGrid
            // A new hidden set changes which cells are marked, so the grid fetches its rows again.
            key={`${view.id}|${applied}`}
            columns={file.columns}
            view={view.id}
            total={view.rows}
            hidden={file.hidden}
            onToggleHidden={(column, hide) => setHidden([column], hide)}
            className="h-[min(680px,72vh)]"
          />
        ) : (
          <Skeleton className="h-[min(680px,72vh)] w-full" />
        )}
      </section>
    </div>
  );
}
