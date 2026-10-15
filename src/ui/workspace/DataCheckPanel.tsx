"use client";

/**
 * Step 3's "Your data": the whole file, so the user can confirm the upload is
 * right before the dashboard, with every problem the data check found
 * (profile/dataCheck.ts). On the left, what to check: the rows to check, one
 * entry per problem found (cells that couldn't be read, values that break a
 * rule, repeated rows) and the blanks of each column; picking one filters
 * the grid to those rows. On the right, the grid with problem cells tinted
 * and explained in their tooltips.
 */
import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, Rows3 } from "lucide-react";
import type { CheckView } from "@/engine/profile/dataCheck";
import { formatCount } from "@/engine/core/format";
import { engine } from "@/lib/engine-client";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { Badge } from "@/ui/primitives/badge";
import { Skeleton } from "@/ui/primitives/misc";
import { VirtualGrid } from "./VirtualGrid";

const TONE_ICON = { warning: AlertTriangle, info: Info, neutral: Rows3 } as const;
const TONE_TEXT = { warning: "text-warning", info: "text-info", neutral: "text-fg-subtle" } as const;

export function DataCheckPanel() {
  const summary = useWorkspace((s) => s.summary);
  // The analysis profile carries the user's role changes; the detected one is used before there is one.
  const columns = useWorkspace((s) => (s.context?.profile ?? s.profile)?.columns);
  const health = useWorkspace((s) => s.health);
  const locale = useSettings((s) => s.numberLocale);
  const [state, setState] = React.useState<{ datasetId: string; views: CheckView[] } | null>(null);
  const [selected, setSelected] = React.useState("all");
  const datasetId = summary?.id ?? "";

  React.useEffect(() => {
    if (!datasetId) return;
    let live = true;
    void engine()
      .checkViews()
      .then((views) => {
        if (live) setState({ datasetId, views });
      });
    return () => {
      live = false;
    };
  }, [datasetId]);

  const views = state?.datasetId === datasetId ? state.views : null;
  if (!summary || !columns) return null;
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
              <span className="truncate text-ui text-fg">{v.label}</span>
              <span className="font-figures shrink-0 text-2xs text-fg-muted">
                {formatCount(v.rows, locale)}
              </span>
            </span>
            {v.id.startsWith("issue:") ? (
              <span className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-fg-subtle">{v.detail}</span>
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
          <p className="text-2xs font-medium tracking-[0.12em] text-fg-subtle uppercase">Your file</p>
          <p className="mt-1 text-ui text-fg">
            {formatCount(summary.rowCount, locale)} rows · {summary.columnCount} columns
          </p>
          {health ? (
            <p className="mt-1 flex items-center gap-2 text-ui text-fg-muted">
              Data health <Badge tone={health.score >= 90 ? "success" : "warning"}>{health.score}/100</Badge>
              {health.grade}
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
                <p className="mb-1 px-3 text-2xs font-medium tracking-[0.12em] text-fg-subtle uppercase">
                  Problems found
                </p>
                <ul className="grid grid-cols-1 gap-1">{issues.map(item)}</ul>
              </div>
            ) : null}
            {blanks.length ? (
              <details className="group">
                <summary className="cursor-pointer rounded-control px-3 py-1.5 text-2xs font-medium tracking-[0.12em] text-fg-subtle uppercase hover:text-fg">
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
          <ul className="flex flex-wrap gap-3 text-2xs text-fg-muted" aria-label="Legend">
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
            key={view.id}
            columns={columns}
            view={view.id}
            total={view.rows}
            className="h-[min(680px,72vh)]"
          />
        ) : (
          <Skeleton className="h-[min(680px,72vh)] w-full" />
        )}
      </section>
    </div>
  );
}
