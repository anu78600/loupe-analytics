"use client";

/**
 * "SQL and DAX" from a dashboard chart's menu (version 50.3): the definition
 * of each KPI the chart measures, as the query that computes it over the
 * chart's rows (the period and filters in view, Session.kpiCardSql, the same
 * query a KPI's own details show) and its Power BI measure. The chart then
 * splits that measure by its axis, which the dialog says in words; no query
 * is written here, only the engine's.
 *
 * Charts whose measures are not KPIs (an ad-hoc sum of a column) have no
 * entry in the menu, so the dialog always has something to show.
 */
import * as React from "react";
import type { ChartSpec } from "@/engine/charts/types";
import type { KpiMeta } from "@/engine/session";
import { useWorkspace } from "@/store/workspace";
import { engine } from "@/lib/engine-client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/primitives/dialog";
import { Skeleton } from "@/ui/primitives/misc";
import { CodeBlock } from "./KpiDetails";

/** The KPIs a chart measures that have a definition to show (available, so their SQL exists). */
export function chartKpis(spec: ChartSpec, kpis: readonly KpiMeta[]): KpiMeta[] {
  const out: KpiMeta[] = [];
  for (const m of spec.measures) {
    const k = kpis.find((x) => x.id === m.id);
    if (k?.available && !out.includes(k)) out.push(k);
  }
  return out;
}

/** "by month", "by Channel": what the chart splits its measure by, in words. */
function splitWords(spec: ChartSpec): string {
  const x = spec.x;
  if (x.kind === "none") return "";
  if (x.kind === "time") return "over time";
  return `by ${x.label.toLowerCase()}`;
}

export function ChartSqlDialog({
  spec,
  title,
  open,
  onOpenChange,
}: {
  spec: ChartSpec;
  /** The chart's title as shown (the user's own, when renamed). */
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const context = useWorkspace((s) => s.context);
  const kpis = context ? chartKpis(spec, context.kpis) : [];
  const split = splitWords(spec);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Read rather than filled in: it opens on itself, not on the first Copy button. */}
      <DialogContent className="max-w-3xl" initialFocus="content">
        <DialogHeader>
          <DialogTitle>SQL and DAX</DialogTitle>
          <DialogDescription>
            {kpis.length === 1 ? "The measure" : "The measures"} behind “{title}”, over the rows in view
            {split ? `; the chart splits ${kpis.length === 1 ? "it" : "them"} ${split}` : ""}.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <div className="grid gap-5">
            {kpis.map((k) => (
              <KpiCode key={k.id} meta={k} />
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** One KPI's query over the rows in view (asked of the worker) and its DAX measure. */
function KpiCode({ meta }: { meta: KpiMeta }) {
  const filtersFn = useWorkspace((s) => s.filters);
  const filterKey = JSON.stringify(filtersFn());
  // The answer tagged with the request it answers, so "loading" is derived rather than stored.
  const [sql, setSql] = React.useState<{
    key: string;
    value: { sql: string; filtered: boolean } | null;
  } | null>(null);
  React.useEffect(() => {
    let alive = true;
    void engine()
      .kpiCardSql(meta.id, JSON.parse(filterKey))
      .then((value) => {
        if (alive) setSql({ key: `${meta.id}|${filterKey}`, value });
      });
    return () => {
      alive = false;
    };
  }, [meta.id, filterKey]);
  const answer = sql?.key === `${meta.id}|${filterKey}` ? sql : null;
  const query = answer?.value?.sql ?? (answer ? meta.sql : null);
  return (
    <section className="grid gap-2" aria-label={meta.name}>
      <h3 className="text-md font-medium text-fg">{meta.name}</h3>
      {!answer ? (
        <Skeleton className="h-24 w-full rounded-control" />
      ) : query ? (
        <CodeBlock
          code={query}
          language={answer.value?.filtered === false ? "SQL · whole file" : "SQL · the rows in view"}
          label={`SQL for ${meta.name}`}
        />
      ) : (
        <p className="text-ui text-fg-muted">No SQL for this KPI.</p>
      )}
      {meta.dax ? (
        <CodeBlock
          code={`${meta.daxName} =\n${meta.dax}`}
          language="DAX · measure"
          label={`DAX for ${meta.name}`}
        />
      ) : null}
    </section>
  );
}
