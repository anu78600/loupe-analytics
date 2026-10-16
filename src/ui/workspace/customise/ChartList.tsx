"use client";

/**
 * The Customise step's Charts tab: every chart of a layout mode, grouped by
 * dashboard section in dashboard order. For each: show or hide it, rename
 * it, change its type (every type that can draw its data, each with the
 * line on what it suits), its width and height, its place in the section,
 * and "Edit data" (the chart builder, prefilled; a recommended chart is
 * saved as the user's own copy). The user's own charts can be deleted;
 * recommended ones are only hidden, so they can come back.
 * Changes go through the store (updateWidget, moveWidget, removeChart), so
 * the dashboard follows at once.
 */
import * as React from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import type { ChartKind, ChartSpec, LayoutMode } from "@/engine/charts/types";
import { CHART_TYPES, chartType } from "@/engine/charts/catalogue";
import { isKindCompatible } from "@/engine/charts/recommend";
import { allSpecs, useWorkspace, type Widget } from "@/store/workspace";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Card } from "@/ui/primitives/card";
import { Input } from "@/ui/primitives/input";
import { Segmented } from "@/ui/primitives/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitives/select";
import { Switch } from "@/ui/primitives/switch";
import { Tooltip } from "@/ui/primitives/tooltip";
import { SECTIONS } from "../dashboard/DashboardStep";
import { CHART_ICON } from "./chartIcons";

const WIDTHS: Array<{ w: number; label: string }> = [
  { w: 3, label: "Quarter width" },
  { w: 4, label: "Third width" },
  { w: 6, label: "Half width" },
  { w: 8, label: "Two thirds" },
  { w: 12, label: "Full width" },
];
const HEIGHTS: Array<{ h: number; label: string }> = [
  { h: 3, label: "Short" },
  { h: 4, label: "Normal" },
  { h: 5, label: "Tall" },
  { h: 6, label: "Extra tall" },
];

/** Every type that can draw this chart's data: the recommended kind, then each buildable kind that fits. */
export function kindsFor(spec: ChartSpec, categoryCount?: number): ChartKind[] {
  const kinds = [spec.kind, ...CHART_TYPES.filter((t) => t.buildable).map((t) => t.kind)];
  return kinds.filter((k, i) => kinds.indexOf(k) === i && isKindCompatible(k, spec, categoryCount));
}

/** Analysis charts (cohorts, RFM, market basket) have inputs of their own: they can't be rebuilt from columns. */
export const editableSpec = (spec: ChartSpec) =>
  !spec.analysis || spec.analysis === "funnel" || spec.analysis === "pareto";

export function ChartList({ onEdit, onCreate }: { onEdit: (spec: ChartSpec) => void; onCreate: () => void }) {
  const context = useWorkspace((s) => s.context);
  const widgets = useWorkspace((s) => s.widgets);
  const customCharts = useWorkspace((s) => s.customCharts);
  const mode = useWorkspace((s) => s.mode);
  const setMode = useWorkspace((s) => s.setMode);
  if (!context) return null;
  const specs = allSpecs({ context, customCharts });
  const specOf = new Map(specs.map((s) => [s.id, s]));
  const rows = widgets
    .map((w) => ({ w, spec: specOf.get(w.id) }))
    .filter((r): r is { w: Widget; spec: ChartSpec } => Boolean(r.spec?.modes.includes(mode)));

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<LayoutMode>
            ariaLabel="Layout mode"
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: "executive", label: "Executive" },
              { value: "analyst", label: "Analyst" },
              { value: "compact", label: "Compact" },
            ]}
          />
          <p className="text-2xs text-fg-subtle">
            The charts of the {mode} layout, in dashboard order. Switch a chart off to hide it; it can come
            back.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={onCreate}>
          <Plus aria-hidden /> Create a chart
        </Button>
      </div>
      {SECTIONS.map((sec) => {
        const list = rows.filter((r) => r.spec.section === sec.id);
        if (!list.length) return null;
        return (
          <Card key={sec.id} className="p-4">
            <h2 className="mb-3 text-sm font-medium text-fg">
              {sec.title}{" "}
              <span className="font-normal text-fg-subtle">
                · {list.filter((r) => !r.w.hidden).length} of {list.length} shown
              </span>
            </h2>
            <ol className="grid gap-2">
              {list.map((r, i) => (
                <ChartRow
                  key={r.w.id}
                  widget={r.w}
                  spec={r.spec}
                  prev={list[i - 1]?.w.id}
                  next={list[i + 1]?.w.id}
                  onEdit={() => onEdit(r.spec)}
                />
              ))}
            </ol>
          </Card>
        );
      })}
    </div>
  );
}

function ChartRow({
  widget: w,
  spec,
  prev,
  next,
  onEdit,
}: {
  widget: Widget;
  spec: ChartSpec;
  prev?: string;
  next?: string;
  onEdit: () => void;
}) {
  const updateWidget = useWorkspace((s) => s.updateWidget);
  const moveWidget = useWorkspace((s) => s.moveWidget);
  const removeChart = useWorkspace((s) => s.removeChart);
  const categoryCount = useWorkspace((s) => s.charts[spec.id]?.categories.length);
  const kind = w.kind ?? spec.kind;
  const Icon = CHART_ICON[kind];
  const kinds = kindsFor(spec, categoryCount);
  const title = w.title?.trim() || spec.title;
  const own = spec.source === "custom";
  const widthLabel = WIDTHS.find((x) => x.w === w.w)?.label ?? `${w.w} of 12 columns`;
  return (
    <li
      className={cn(
        "grid gap-2 rounded-control border border-border bg-surface-1 px-3 py-2.5 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center",
        w.hidden && "bg-surface-2/60",
      )}
    >
      <div className="flex items-center gap-2.5">
        <Switch
          checked={!w.hidden}
          onCheckedChange={(on) => updateWidget(w.id, { hidden: !on })}
          aria-label={`Show ${title} on the dashboard`}
        />
        <Icon className={cn("size-4 shrink-0", w.hidden ? "text-fg-subtle" : "text-accent")} aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Input
            // Keyed by the title, so a change from elsewhere (reset, undo) shows here.
            key={title}
            defaultValue={title}
            aria-label={`Title of ${title}`}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== title) updateWidget(w.id, { title: v && v !== spec.title ? v : undefined });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className={cn(
              "h-8 min-w-0 border-transparent bg-transparent px-1.5 text-ui font-medium hover:border-border-strong",
              w.hidden && "text-fg-subtle",
            )}
          />
          {own ? <Badge tone="accent">yours</Badge> : null}
        </div>
        <p className="truncate px-1.5 text-2xs text-fg-subtle" title={chartType(kind).bestFor}>
          {chartType(kind).name}: {chartType(kind).bestFor}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 lg:flex-nowrap">
        <Select
          value={kind}
          onValueChange={(v) => updateWidget(w.id, { kind: v === spec.kind ? undefined : (v as ChartKind) })}
        >
          <SelectTrigger size="sm" className="w-44" aria-label={`Chart type of ${title}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kinds.map((k) => (
              <SelectItem key={k} value={k} hint={k === spec.kind ? "recommended" : undefined}>
                {chartType(k).name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(w.w)} onValueChange={(v) => updateWidget(w.id, { w: Number(v) })}>
          <SelectTrigger size="sm" className="w-36" aria-label={`Width of ${title}`}>
            <SelectValue>{widthLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {WIDTHS.map((x) => (
              <SelectItem key={x.w} value={String(x.w)}>
                {x.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(w.h)} onValueChange={(v) => updateWidget(w.id, { h: Number(v) })}>
          <SelectTrigger size="sm" className="w-28" aria-label={`Height of ${title}`}>
            <SelectValue>{HEIGHTS.find((x) => x.h === w.h)?.label ?? `Height ${w.h}`}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {HEIGHTS.map((x) => (
              <SelectItem key={x.h} value={String(x.h)}>
                {x.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!prev}
          onClick={() => prev && moveWidget(w.id, prev)}
          aria-label={`Move ${title} up`}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!next}
          onClick={() => next && moveWidget(w.id, next)}
          aria-label={`Move ${title} down`}
        >
          <ArrowDown aria-hidden />
        </Button>
        {editableSpec(spec) ? (
          <Tooltip
            content={own ? "Change its columns and measures" : "Change its data: saved as your own copy"}
          >
            <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Edit the data of ${title}`}>
              <Pencil aria-hidden />
            </Button>
          </Tooltip>
        ) : null}
        {own ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => removeChart(w.id)}
            aria-label={`Delete ${title}`}
          >
            <Trash2 aria-hidden />
          </Button>
        ) : null}
      </div>
    </li>
  );
}
