"use client";

/**
 * The Customise step's KPIs tab: the dashboard's KPI layout (kpiLayoutOf)
 * as three ordered lists (the headline row, the supporting tiles and the
 * "From your other columns" tiles), each KPI with its current value, its
 * group and formula. KPIs move up and down within a list and between lists,
 * leave the dashboard, or come back from the pool of KPIs not shown; the
 * headline row holds at most MAX_HEADLINE. KPIs that can't be computed with
 * this file are listed with what they need. "Build a KPI" (KpiBuilder)
 * makes new ones from any column; the user's own can be edited or deleted.
 * Any KPI on the dashboard can be renamed in place (KpiNameInput).
 *
 * Deleting one of the user's KPIs that their own charts show asks first,
 * naming those charts, and offers to delete them with it: without the KPI
 * they can't be drawn.
 *
 * The first change copies the recommended layout into the user's own
 * (setKpiLayout); from then on the dashboard shows exactly these lists.
 * Values come from previewKpis, which leaves the dashboard's last results
 * (and so its insights) untouched.
 *
 * Little text on screen: what each list is for, a KPI's definition and
 * formula, and the builder's explanation sit behind an ⓘ or a short line
 * (ui/primitives/reveal.tsx); on a phone a KPI's formula line is behind its ⓘ.
 */
import * as React from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, CircleSlash, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import type { ChartSpec } from "@/engine/charts/types";
import type { KpiValue } from "@/engine/kpi/compute";
import type { KpiMeta } from "@/engine/session";
import { isUserKpiId, type UserKpi } from "@/engine/kpi/userKpis";
import { formatValue } from "@/engine/core/format";
import { engine } from "@/lib/engine-client";
import { cn } from "@/lib/utils";
import { kpiLayoutOf, MAX_HEADLINE, useWorkspace, type KpiLayout } from "@/store/workspace";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Card } from "@/ui/primitives/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/primitives/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitives/select";
import { Tooltip } from "@/ui/primitives/tooltip";
import { Brief, ClampText, InfoTip } from "@/ui/primitives/reveal";
import { useFmt } from "@/ui/common/hooks";
import { chartsUsingKpi } from "./brokenCharts";
import { KpiBuilder } from "./KpiBuilder";
import { KpiNameInput } from "./KpiNameInput";

type Slot = keyof KpiLayout;
type Place = Slot | "off";

const SLOTS: Array<{ id: Slot; title: string; hint: string }> = [
  {
    id: "hero",
    title: "Headline row",
    hint: `The big cards at the top of the dashboard, up to ${MAX_HEADLINE}.`,
  },
  {
    id: "supporting",
    title: "Supporting KPIs",
    hint: "Compact tiles under the headline row (not in Executive mode).",
  },
  {
    id: "columns",
    title: "From your other columns",
    hint: "Tiles in the section for columns the industry template doesn't read.",
  },
];
const PLACE_LABEL: Record<Place, string> = {
  hero: "Headline row",
  supporting: "Supporting",
  columns: "Other columns",
  off: "Not shown",
};

export function KpiPlanner() {
  const context = useWorkspace((s) => s.context);
  const kpiLayout = useWorkspace((s) => s.kpiLayout);
  const extraKpis = useWorkspace((s) => s.extraKpis);
  const setKpiLayout = useWorkspace((s) => s.setKpiLayout);
  const customKpis = useWorkspace((s) => s.customKpis);
  const removeCustomKpi = useWorkspace((s) => s.removeCustomKpi);
  const filterKey = useWorkspace((s) => JSON.stringify([s.datePreset, s.customRange, s.dimFilters]));
  const fmt = useFmt();
  const [values, setValues] = React.useState<{
    ctx: unknown;
    key: string;
    map: Map<string, KpiValue>;
  } | null>(null);
  const [builder, setBuilder] = React.useState<{ open: boolean; kpi: UserKpi | null }>({
    open: false,
    kpi: null,
  });
  // A KPI of the user's that their own charts show, waiting for "delete the charts too?".
  const [deleting, setDeleting] = React.useState<{ id: string; name: string; charts: ChartSpec[] } | null>(
    null,
  );

  // Every available KPI's value under the dashboard's filters, for the lists below.
  React.useEffect(() => {
    if (!context) return;
    let live = true;
    const ids = context.kpis.filter((k) => k.available && !k.hidden).map((k) => k.id);
    const filters = useWorkspace
      .getState()
      .filters()
      .filter((f) => !("sourceId" in f));
    void engine()
      .previewKpis(filters, ids)
      .then((b) => {
        if (live) setValues({ ctx: context, key: filterKey, map: new Map(b.values.map((v) => [v.id, v])) });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [context, filterKey]);

  if (!context) return null;
  const layout = kpiLayoutOf({ context, kpiLayout, extraKpis });
  const metas = new Map(context.kpis.map((k) => [k.id, k]));
  const valueOf = (id: string) => (values && values.ctx === context ? values.map.get(id) : undefined);
  const commit = (next: KpiLayout) => setKpiLayout(next);
  const move = (id: string, to: Place) => {
    const next: KpiLayout = {
      hero: layout.hero.filter((x) => x !== id),
      supporting: layout.supporting.filter((x) => x !== id),
      columns: layout.columns.filter((x) => x !== id),
    };
    if (to !== "off") next[to] = [...next[to], id];
    commit(next);
  };
  const shift = (slot: Slot, id: string, by: -1 | 1) => {
    const list = [...layout[slot]];
    const i = list.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j] as string, list[i] as string];
    commit({ ...layout, [slot]: list });
  };

  const shown = new Set([...layout.hero, ...layout.supporting, ...layout.columns]);
  const pool = context.kpis.filter((k) => k.available && !k.hidden && !shown.has(k.id));
  const groups = [...new Set(pool.map((k) => k.group))];
  const unavailable = context.kpis.filter((k) => !k.available && !k.hidden);
  const heroFull = layout.hero.length >= MAX_HEADLINE;
  const editUser = (id: string) =>
    setBuilder({ open: true, kpi: customKpis.find((k) => k.id === id) ?? null });
  // Deleting a KPI the user's charts show asks first; one no chart shows goes at once.
  const removeUser = (id: string) => {
    const s = useWorkspace.getState();
    const charts = chartsUsingKpi(s.customCharts, id);
    const name = metas.get(id)?.name ?? customKpis.find((k) => k.id === id)?.name ?? id;
    if (charts.length) setDeleting({ id, name, charts });
    else {
      removeCustomKpi(id);
      toast(`Deleted “${name}”`);
    }
  };

  return (
    // grid-cols-1 below lg: an implicit column would grow to the longest unbroken formula line.
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="grid min-w-0 grid-cols-1 content-start gap-5">
        {SLOTS.map((slot) => (
          <Card key={slot.id} className="p-4">
            {/* What the list is for is behind its ⓘ, not a line under every heading. */}
            <div className="mb-3 flex items-center gap-1.5">
              <h2 className="text-md font-medium text-fg">
                {slot.title}{" "}
                <span className="font-figures font-normal text-fg-subtle">
                  · {layout[slot.id].length}
                  {slot.id === "hero" ? ` of ${MAX_HEADLINE}` : ""}
                </span>
              </h2>
              <InfoTip label={`About ${slot.title}`}>{slot.hint}</InfoTip>
            </div>
            {layout[slot.id].length ? (
              <ol className="grid grid-cols-1 gap-1.5">
                {layout[slot.id].map((id, i) => {
                  const meta = metas.get(id);
                  if (!meta) return null;
                  return (
                    <KpiRow
                      key={id}
                      meta={meta}
                      value={valueOf(id)}
                      index={i}
                      count={layout[slot.id].length}
                      place={slot.id}
                      heroFull={heroFull}
                      onMove={(to) => move(id, to)}
                      onShift={(by) => shift(slot.id, id, by)}
                      onEdit={isUserKpiId(id) ? () => editUser(id) : undefined}
                      onDelete={isUserKpiId(id) ? () => removeUser(id) : undefined}
                      fmt={fmt}
                    />
                  );
                })}
              </ol>
            ) : (
              <p className="rounded-control border border-dashed border-border px-3 py-4 text-center text-xs text-fg-subtle">
                <Brief
                  full="Nothing here. Add KPIs from the list on the right."
                  label="How to fill this list"
                >
                  Nothing here yet.
                </Brief>
              </p>
            )}
          </Card>
        ))}
      </div>
      <aside aria-label="KPIs not on the dashboard" className="grid min-w-0 grid-cols-1 content-start gap-4">
        <Card className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-md font-medium text-fg">Build a KPI</h2>
              <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
                <Brief
                  label="About building a KPI"
                  full="From any column: a total, average, lowest, highest, median, distinct count or number of rows, or a ratio of two (such as profit ÷ revenue). Its SQL and DAX are written for you."
                >
                  From any column, SQL and DAX included.
                </Brief>
              </p>
            </div>
            <Button variant="primary" size="sm" onClick={() => setBuilder({ open: true, kpi: null })}>
              <Plus aria-hidden /> Build
            </Button>
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="text-md font-medium text-fg">
            Not on the dashboard{" "}
            <span className="font-figures font-normal text-fg-subtle">· {pool.length}</span>
          </h2>
          {pool.length ? (
            <div className="mt-3 grid grid-cols-1 gap-4">
              {groups.map((g) => (
                <div key={g}>
                  <p className="eyebrow mb-1.5 text-fg-subtle">{g}</p>
                  <ul className="grid grid-cols-1 gap-1.5">
                    {pool
                      .filter((k) => k.group === g)
                      .map((k) => (
                        <li
                          key={k.id}
                          className="flex items-center gap-2 rounded-control border border-border bg-surface-1 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-ui text-fg" title={k.definition}>
                              {k.name}
                            </p>
                            <p className="font-figures truncate text-xs text-fg-subtle">
                              {shownValue(valueOf(k.id), k, fmt)}
                            </p>
                          </div>
                          <Tooltip
                            content={
                              heroFull ? `The headline row holds ${MAX_HEADLINE}` : "Add to the headline row"
                            }
                          >
                            <span>
                              <Button
                                variant="secondary"
                                size="xs"
                                disabled={heroFull}
                                onClick={() => move(k.id, "hero")}
                                aria-label={`Add ${k.name} to the headline row`}
                              >
                                Headline
                              </Button>
                            </span>
                          </Tooltip>
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => move(k.id, "supporting")}
                            aria-label={`Add ${k.name} to the supporting KPIs`}
                          >
                            Supporting
                          </Button>
                          {isUserKpiId(k.id) ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Edit ${k.name}`}
                              onClick={() => editUser(k.id)}
                            >
                              <Pencil aria-hidden />
                            </Button>
                          ) : null}
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-fg-subtle">Every available KPI is on the dashboard.</p>
          )}
        </Card>
        {unavailable.length ? (
          <Card className="p-4">
            <details>
              <summary className="cursor-pointer text-md font-medium text-fg">
                Can&apos;t be computed with this file{" "}
                <span className="font-figures font-normal text-fg-subtle">· {unavailable.length}</span>
              </summary>
              <ul className="mt-3 grid grid-cols-1 gap-2">
                {unavailable.map((k) => (
                  <li key={k.id} className="flex items-start gap-2 text-xs leading-relaxed">
                    <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                    <span>
                      <span className="text-fg">{k.name}</span>
                      <span className="text-fg-muted"> · {k.unavailableReason}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </Card>
        ) : null}
        {context.customKpiIssues.length ? (
          <Card className="border-warning p-4">
            <p className="flex items-center gap-1.5 text-ui font-medium text-fg">
              <Sparkles className="size-4 text-warning" aria-hidden /> Your KPIs that can&apos;t be computed
              now
            </p>
            <ul className="mt-2 grid grid-cols-1 gap-1.5">
              {context.customKpiIssues.map((x) => (
                <li
                  key={x.id}
                  className="flex items-start justify-between gap-2 text-xs leading-relaxed text-fg-muted"
                >
                  <span>{x.reason}</span>
                  <Button variant="ghost" size="xs" onClick={() => removeUser(x.id)}>
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </aside>
      {/* Keyed by the KPI, so each opening starts from it (or a blank one). */}
      <KpiBuilder
        key={builder.kpi?.id ?? "new"}
        open={builder.open}
        editing={builder.kpi}
        onOpenChange={(open) => setBuilder((b) => ({ ...b, open }))}
      />
      <DeleteKpiDialog deleting={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

/**
 * "Delete “Average shipping fee”?" for a KPI the user's own charts show:
 * names the charts and offers to delete them with it (removeChart), or to
 * keep them, flagged in the chart list as unable to draw, for another
 * measure. Cancel keeps everything.
 */
function DeleteKpiDialog({
  deleting,
  onClose,
}: {
  deleting: { id: string; name: string; charts: ChartSpec[] } | null;
  onClose: () => void;
}) {
  const widgets = useWorkspace((s) => s.widgets);
  const removeCustomKpi = useWorkspace((s) => s.removeCustomKpi);
  const removeChart = useWorkspace((s) => s.removeChart);
  const charts = deleting?.charts ?? [];
  const n = charts.length;
  // The titles as the chart list and the dashboard show them (a rename included).
  const titles = charts.map((c) => widgets.find((w) => w.id === c.id)?.title?.trim() || c.title);
  const confirm = (withCharts: boolean) => {
    if (!deleting) return;
    removeCustomKpi(deleting.id);
    if (withCharts) for (const c of charts) removeChart(c.id);
    toast(
      withCharts
        ? `Deleted “${deleting.name}” and ${n === 1 ? "the chart" : `the ${n} charts`} showing it`
        : `Deleted “${deleting.name}”. ${n === 1 ? "Its chart is" : `Its ${n} charts are`} marked in Charts: choose another measure there.`,
    );
    onClose();
  };
  return (
    <Dialog
      open={Boolean(deleting)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
          <DialogDescription>
            {n === 1 ? "One of your charts shows it" : `${n} of your charts show it`}. Without the KPI{" "}
            {n === 1 ? "that chart" : "they"} can&apos;t be drawn.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1 rounded-control border border-border bg-surface-2 px-3 py-2 text-ui text-fg">
          {titles.map((t, i) => (
            <li key={charts[i]?.id ?? t} className="truncate">
              {t}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => confirm(false)}>
            Delete the KPI only
          </Button>
          <Button variant="danger" onClick={() => confirm(true)}>
            Delete it and {n === 1 ? "the chart" : `the ${n} charts`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A KPI's value as the dashboard shows it (compact money and counts), or a dash while loading. */
function shownValue(v: KpiValue | undefined, meta: KpiMeta, fmt: ReturnType<typeof useFmt>): string {
  if (!v) return "…";
  return formatValue(v.value, meta.format, {
    ...fmt,
    compact: meta.format !== "percent" && meta.format !== "ratio",
  });
}

function KpiRow({
  meta,
  value,
  index,
  count,
  place,
  heroFull,
  onMove,
  onShift,
  onEdit,
  onDelete,
  fmt,
}: {
  meta: KpiMeta;
  value: KpiValue | undefined;
  index: number;
  count: number;
  place: Slot;
  heroFull: boolean;
  onMove: (to: Place) => void;
  onShift: (by: -1 | 1) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  fmt: ReturnType<typeof useFmt>;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-control border border-border bg-surface-1 px-3 py-2 sm:flex-nowrap">
      <span className="font-figures w-5 shrink-0 text-2xs text-fg-subtle">{index + 1}</span>
      {/* A 12rem basis, so on a phone the controls wrap below the name rather than squeezing it to
          nothing (with a zero basis the row "fitted" whenever the value was short, as "8.1%"). */}
      <div className="min-w-0 grow basis-48">
        <div className="flex min-w-0 items-center gap-1.5">
          <KpiNameInput id={meta.id} name={meta.name} title={meta.definition} />
          {isUserKpiId(meta.id) ? <Badge tone="accent">yours</Badge> : null}
          {/* The definition (also on touch and keyboard) and, on a phone, the formula line below. */}
          <InfoTip label={`About ${meta.name}`}>
            {meta.definition ? <span className="block">{meta.definition}</span> : null}
            <span className="mt-1 block text-fg-muted">
              {meta.group} · {meta.formula}
            </span>
          </InfoTip>
        </div>
        {/* From sm up only: on a phone it is behind the ⓘ above. */}
        <ClampText className="hidden px-1 text-xs text-fg-subtle sm:block">
          {meta.group} · {meta.formula}
        </ClampText>
      </div>
      <span className={cn("font-figures shrink-0 text-ui", value ? "text-fg" : "text-fg-subtle")}>
        {shownValue(value, meta, fmt)}
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={index === 0}
          onClick={() => onShift(-1)}
          aria-label={`Move ${meta.name} up`}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={index === count - 1}
          onClick={() => onShift(1)}
          aria-label={`Move ${meta.name} down`}
        >
          <ArrowDown aria-hidden />
        </Button>
        <Select value={place} onValueChange={(v) => onMove(v as Place)}>
          <SelectTrigger size="sm" className="w-36" aria-label={`Where ${meta.name} shows`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["hero", "supporting", "columns", "off"] as const).map((p) => (
              <SelectItem key={p} value={p} disabled={p === "hero" && heroFull && place !== "hero"}>
                {PLACE_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {onEdit ? (
          <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Edit ${meta.name}`}>
            <Pencil aria-hidden />
          </Button>
        ) : null}
        {onDelete ? (
          <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={`Delete ${meta.name}`}>
            <Trash2 aria-hidden />
          </Button>
        ) : null}
      </div>
    </li>
  );
}
