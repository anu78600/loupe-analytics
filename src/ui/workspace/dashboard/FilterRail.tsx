"use client";

/**
 * Dashboard filter rail: dataset card, date presets plus a custom range,
 * dimension filters (values fetched from the worker, searchable), active
 * filter chips including the cross-filter, and a data-health shortcut.
 * Filters live in the workspace store, which recomputes KPIs and charts in the
 * worker.
 */
import * as React from "react";
import { Check, ChevronDown, Filter as FilterIcon, Gauge, Search, X } from "lucide-react";
import { PRESET_LABEL, presetAvailable, presetRange, type DatePreset } from "@/engine/core/periods";
import { formatRange, isoDate } from "@/engine/core/dates";
import { formatCount } from "@/engine/core/format";
import type { ValueCount } from "@/engine/profile/types";
import { isRosterView, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { engine } from "@/lib/engine-client";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { Checkbox, Eyebrow, Separator } from "@/ui/primitives/misc";
import { Input, Label } from "@/ui/primitives/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/primitives/popover";
import { DomainIcon } from "@/ui/common/domain-icon";
import { friendly } from "@/engine/core/labels";

const PRESETS: DatePreset[] = ["all", "last12m", "last6m", "last90d", "last30d", "ytd", "prevYear"];

const parseIsoDay = (s: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

export function FilterRail({ onOpenHealth }: { onOpenHealth: () => void }) {
  const context = useWorkspace((s) => s.context);
  const summary = useWorkspace((s) => s.summary);
  const health = useWorkspace((s) => s.health);
  const locale = useSettings((s) => s.numberLocale);
  if (!context || !summary) return null;
  return (
    <div className="grid gap-5">
      <div className="rounded-card border border-border bg-surface-1 p-4">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-[9px] border border-border-accent bg-accent-soft">
            <DomainIcon name={context.domain.icon} className="size-4 text-accent" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-ui font-medium text-fg">{context.domain.name}</p>
            <p className="truncate text-2xs text-fg-subtle">
              {context.domain.subDomains.find((s) => s.id === context.subDomainId)?.name}
            </p>
          </div>
        </div>
        {/* The file's name heads the dashboard; here, its size and what one row is. */}
        <p className="font-figures mt-3 text-2xs text-fg-subtle" title={summary.fileName}>
          {formatCount(summary.rowCount, locale)} rows in the file · {context.grainLabel.toLowerCase()}
        </p>
        {summary.isDemo ? (
          <Badge tone="accent" className="mt-2">
            Demo data
          </Badge>
        ) : null}
      </div>
      <DateFilter />
      <DimensionFilters />
      <ActiveFilters />
      {health ? (
        <button
          type="button"
          onClick={onOpenHealth}
          className="flex items-center gap-3 rounded-card border border-border bg-surface-1 p-3 text-left transition-colors hover:border-border-accent"
        >
          <Gauge className="size-4 text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-ui text-fg">
              Data health <span className="font-figures">{health.score}</span>/100
            </p>
            <p className="truncate text-2xs text-fg-subtle">{health.issues[0]?.title ?? "No issues found"}</p>
          </div>
        </button>
      ) : null}
    </div>
  );
}

function DateFilter() {
  const context = useWorkspace((s) => s.context);
  const preset = useWorkspace((s) => s.datePreset);
  const custom = useWorkspace((s) => s.customRange);
  const setPreset = useWorkspace((s) => s.setDatePreset);
  const bounds = context?.dateBounds;
  if (!context?.dateColumn || !bounds) {
    return <p className="text-2xs text-fg-subtle">No date column mapped, so period filters are off.</p>;
  }
  const current =
    preset === "custom" && custom
      ? custom
      : (presetRange(preset, bounds) ?? { from: bounds.min, to: bounds.max });
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <Eyebrow>Period</Eyebrow>
        <span className="truncate text-2xs text-fg-subtle" title={`Dates from ${context.dateColumn}`}>
          by {friendly(context.dateColumn)}
        </span>
      </div>
      {isRosterView(context) ? (
        <p className="mt-1 text-2xs leading-relaxed text-fg-subtle">
          Each row is {/^[aeiou]/i.test(grainOf(context)) ? "an" : "a"} {grainOf(context)}: a date range keeps
          those whose {friendly(context.dateColumn)} falls in it.
        </p>
      ) : null}
      <div className="mt-2 grid gap-0.5" role="radiogroup" aria-label="Date range">
        {PRESETS.filter((p) => presetAvailable(p, bounds)).map((p) => {
          const r = presetRange(p, bounds);
          const active = preset === p;
          return (
            <div key={p}>
              {/* The range is in the tooltip and in the From/To fields below, not squeezed beside each option. */}
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPreset(p)}
                title={r ? formatRange(r.from, r.to) : undefined}
                className={cn(
                  "flex w-full items-center rounded-[8px] px-2.5 py-1.5 text-left text-ui transition-colors",
                  active ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <span className="flex items-center gap-2">
                  <Check
                    className={cn("size-3.5", active ? "text-accent" : "invisible")}
                    strokeWidth={2.5}
                    aria-hidden
                  />
                  {PRESET_LABEL[p]}
                </span>
              </button>
            </div>
          );
        })}
      </div>
      <Separator className="my-3" />
      {/* Keyed by the active range, so the inputs reset whenever the period changes elsewhere. */}
      <CustomRangeForm
        key={`${current.from}:${current.to}`}
        bounds={bounds}
        initial={current}
        onApply={(r) => setPreset("custom", r)}
      />
    </div>
  );
}

/** Editable from/to dates, seeded from the active range and applied as a custom period. */
function CustomRangeForm({
  bounds,
  initial,
  onApply,
}: {
  bounds: { min: number; max: number };
  initial: { from: number; to: number };
  onApply: (r: { from: number; to: number }) => void;
}) {
  const [from, setFrom] = React.useState(() => isoDate(initial.from));
  const [to, setTo] = React.useState(() => isoDate(initial.to));
  return (
    // One field per line: date inputs have a minimum width, and side by side they overflow the rail.
    <form
      className="grid grid-cols-1 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const a = parseIsoDay(from);
        const b = parseIsoDay(to);
        // The end date is inclusive: extend it to the last millisecond of that day.
        if (a !== null && b !== null && b >= a) onApply({ from: a, to: b + 86_399_999 });
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="from" className="text-2xs">
          From
        </Label>
        <Input
          id="from"
          type="date"
          value={from}
          min={isoDate(bounds.min)}
          max={isoDate(bounds.max)}
          onChange={(e) => setFrom(e.target.value)}
          className="h-8 w-full min-w-0 px-2 text-ui"
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="to" className="text-2xs">
          To
        </Label>
        <Input
          id="to"
          type="date"
          value={to}
          min={isoDate(bounds.min)}
          max={isoDate(bounds.max)}
          onChange={(e) => setTo(e.target.value)}
          className="h-8 w-full min-w-0 px-2 text-ui"
        />
      </div>
      <Button type="submit" size="sm" variant="secondary">
        Apply custom range
      </Button>
    </form>
  );
}

function DimensionFilters() {
  const context = useWorkspace((s) => s.context);
  if (!context?.dimensions.length) return null;
  return (
    <div>
      <Eyebrow>Filters</Eyebrow>
      <div className="mt-2 grid gap-1.5">
        {context.dimensions.slice(0, 7).map((d) => (
          <DimensionFilter key={d.column} column={d.column} label={d.label} distinct={d.distinct} />
        ))}
      </div>
    </div>
  );
}

function DimensionFilter({ column, label, distinct }: { column: string; label: string; distinct: number }) {
  const current = useWorkspace((s) => s.dimFilters.find((f) => f.column === column));
  const setFilter = useWorkspace((s) => s.setDimFilter);
  const locale = useSettings((s) => s.numberLocale);
  const profileValues = useWorkspace(
    (s) => s.context?.profile.columns.find((c) => c.name === column)?.categorical?.all,
  );
  const selected = current && current.kind === "in" ? current.values : [];
  const [q, setQ] = React.useState("");
  const [remote, setRemote] = React.useState<ValueCount[] | null>(null);
  React.useEffect(() => {
    if (profileValues) return;
    let alive = true;
    void engine()
      .columnValues(column, 200, q)
      .then((v) => alive && setRemote(v));
    return () => {
      alive = false;
    };
  }, [column, q, profileValues]);
  const values = (profileValues ?? remote ?? []).filter(
    (v) => !q || v.value.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-control border px-3 text-left text-ui transition-colors",
            selected.length
              ? "border-border-accent bg-accent-soft text-fg"
              : "border-border bg-surface-1 text-fg-muted hover:border-border-strong hover:text-fg",
          )}
        >
          <span className="truncate">{label}</span>
          <span className="flex shrink-0 items-center gap-1">
            {selected.length ? (
              <Badge tone="accent">{selected.length}</Badge>
            ) : (
              <span className="font-figures text-2xs text-fg-subtle">{distinct}</span>
            )}
            <ChevronDown className="size-3.5 text-fg-subtle" aria-hidden />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" className="w-72 p-0">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-3.5 text-fg-subtle" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}`}
            className="h-7 flex-1 bg-transparent text-ui text-fg outline-none placeholder:text-fg-subtle"
            aria-label={`Search ${label}`}
          />
          {selected.length ? (
            <Button size="xs" variant="ghost" onClick={() => setFilter(column, [])}>
              Clear
            </Button>
          ) : null}
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {values.slice(0, 200).map((v) => {
            const on = selected.includes(v.value);
            return (
              <label
                key={v.value}
                className="flex cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 text-ui text-fg hover:bg-surface-3"
              >
                <Checkbox
                  checked={on}
                  onCheckedChange={(x) =>
                    setFilter(column, x ? [...selected, v.value] : selected.filter((y) => y !== v.value))
                  }
                />
                <span className="flex-1 truncate">{v.value}</span>
                {v.count ? (
                  <span className="font-figures text-2xs text-fg-subtle">{formatCount(v.count, locale)}</span>
                ) : null}
              </label>
            );
          })}
          {!values.length ? <p className="px-2 py-3 text-ui text-fg-subtle">No matching values.</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ActiveFilters({ inline = false }: { inline?: boolean }) {
  const dims = useWorkspace((s) => s.dimFilters);
  const cross = useWorkspace((s) => s.crossFilter);
  const preset = useWorkspace((s) => s.datePreset);
  const custom = useWorkspace((s) => s.customRange);
  const setFilter = useWorkspace((s) => s.setDimFilter);
  const setCross = useWorkspace((s) => s.setCrossFilter);
  const setPreset = useWorkspace((s) => s.setDatePreset);
  const clear = useWorkspace((s) => s.clearFilters);
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
  if (preset === "custom" && custom)
    chips.push({ key: "date", label: formatRange(custom.from, custom.to), onRemove: () => setPreset("all") });
  for (const f of dims)
    if (f.kind === "in")
      chips.push({
        key: f.column,
        label: `${friendly(f.column)}: ${f.values.length > 2 ? `${f.values.length} selected` : f.values.join(", ")}`,
        onRemove: () => setFilter(f.column, []),
      });
  if (cross)
    chips.push({
      key: "cross",
      label: `${friendly(cross.column)}: ${cross.value}`,
      onRemove: () => setCross(cross.sourceId, cross.column, null),
    });
  if (!chips.length) return inline ? null : <p className="text-2xs text-fg-subtle">No filters applied.</p>;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", !inline && "")}>
      {!inline ? <FilterIcon className="size-3.5 text-fg-subtle" aria-hidden /> : null}
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex h-6 max-w-full items-center gap-1 rounded-full border border-border-accent bg-accent-soft pr-1 pl-2.5 text-2xs text-fg"
        >
          <span className="truncate">{c.label}</span>
          <button
            type="button"
            onClick={c.onRemove}
            className="grid size-4 place-items-center rounded-full hover:bg-surface-3"
            aria-label={`Remove filter ${c.label}`}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={clear}
        className="text-2xs text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}

/** What one row is in the active business area ("employee"), for plain-language hints. */
function grainOf(context: NonNullable<ReturnType<typeof useWorkspace.getState>["context"]>): string {
  return context.domain.subDomains.find((s) => s.id === context.subDomainId)?.grain ?? "row";
}
