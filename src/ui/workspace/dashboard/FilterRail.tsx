"use client";

/**
 * Dashboard filter rail: dataset card, date presets plus a custom range,
 * dimension filters (values fetched from the worker, searchable), active
 * filter chips including the cross-filter, and a data-health shortcut.
 * Filters live in the workspace store, which recomputes KPIs and charts in the
 * worker.
 *
 * The presets are one radio group with roving focus: Tab reaches the chosen
 * one, the arrow keys (and Home and End) move between them and choose. A
 * custom range whose end is before its start says so instead of being
 * ignored. A filter's value list opens beside the rail on wide screens and
 * below its button in the phone's Filters sheet, so it is never off-screen.
 * Filters are named by their column, as the chips and every other filter
 * description name them ("Channel: Amazon").
 *
 * Hints are behind an ⓘ (a roster's period hint) and long values are
 * clamped to one line, opening in full on hover, focus or a long press
 * (ui/primitives/reveal.tsx).
 *
 * States follow the theme tokens: rows hover with the state layer, the
 * chosen preset and a filter in use take the selected tint, and the presets
 * change without a fade, because the arrow keys choose them. Beside the
 * dashboard the dataset card, the health shortcut and the filter buttons are
 * raised cards on the canvas; in the phone's Filters sheet (`inSheet`) they
 * sit on the overlay plane with a border only, as everything inside an
 * overlay does (docs/DESIGN.md, "Inside overlays").
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
import { ClampText, InfoTip } from "@/ui/primitives/reveal";
import { DomainIcon } from "@/ui/common/domain-icon";
import { friendly } from "@/engine/core/labels";

const PRESETS: DatePreset[] = ["all", "last12m", "last6m", "last90d", "last30d", "ytd", "prevYear"];

const parseIsoDay = (s: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

// The rail sits beside the dashboard from Tailwind's lg breakpoint; below it, in a sheet.
const WIDE = "(min-width: 1024px)";
function subscribeWide(onChange: () => void): () => void {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const wideNow = () => window.matchMedia(WIDE).matches;

/** True when the rail is beside the dashboard (a wide screen); false in the phone's Filters sheet. */
function useWideRail(): boolean {
  return React.useSyncExternalStore(subscribeWide, wideNow, () => true);
}

/** Raised beside the dashboard; inside the Filters sheet, on the overlay plane with its border only. */
const cardFill = (inSheet: boolean) => (inSheet ? "" : "bg-surface-1 shadow-card");

export function FilterRail({
  onOpenHealth,
  inSheet = false,
}: {
  onOpenHealth: () => void;
  /** True in the phone's Filters sheet, where the rail's cards sit flat on the overlay plane. */
  inSheet?: boolean;
}) {
  const context = useWorkspace((s) => s.context);
  const summary = useWorkspace((s) => s.summary);
  const health = useWorkspace((s) => s.health);
  const locale = useSettings((s) => s.numberLocale);
  if (!context || !summary) return null;
  return (
    <div className="grid gap-5">
      <div className={cn("rounded-card border border-border p-4", cardFill(inSheet))}>
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-control border border-border-accent bg-accent-soft">
            <DomainIcon name={context.domain.icon} className="size-4 text-accent" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-ui font-medium text-fg">{context.domain.name}</p>
            <p className="truncate text-xs text-fg-subtle">
              {context.domain.subDomains.find((s) => s.id === context.subDomainId)?.name}
            </p>
          </div>
        </div>
        {/* The file's name heads the dashboard; here, its size and what one row is. */}
        {/* Two lines (it wraps, so it never widens the rail), the rest on hover, focus or a long press. */}
        <ClampText lines={2} className="tabular mt-3 text-xs text-fg-subtle">
          {formatCount(summary.rowCount, locale)} rows in the file · {context.grainLabel.toLowerCase()}
        </ClampText>
        {summary.isDemo ? (
          <Badge tone="accent" className="mt-2">
            Demo data
          </Badge>
        ) : null}
      </div>
      <DateFilter />
      <DimensionFilters inSheet={inSheet} />
      <ActiveFilters />
      {health ? (
        <button
          type="button"
          onClick={onOpenHealth}
          className={cn(
            "flex items-center gap-3 rounded-card border border-border p-3 text-left transition-colors duration-fast hover:border-border-hover",
            cardFill(inSheet),
          )}
        >
          <Gauge className="size-4 text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-ui text-fg">
              Data health <span className="font-figures">{health.score}</span>/100
            </p>
            <p className="truncate text-xs text-fg-subtle">{health.issues[0]?.title ?? "No issues found"}</p>
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
  const radios = React.useRef<Array<HTMLButtonElement | null>>([]);
  const bounds = context?.dateBounds;
  if (!context?.dateColumn || !bounds) {
    return <p className="text-xs text-fg-subtle">No date column mapped, so period filters are off.</p>;
  }
  const current =
    preset === "custom" && custom
      ? custom
      : (presetRange(preset, bounds) ?? { from: bounds.min, to: bounds.max });
  const offered = PRESETS.filter((p) => presetAvailable(p, bounds));
  // Roving focus (the ARIA radio group pattern): only the chosen preset, or the first when a custom
  // range is chosen, is in the Tab order; the arrow keys move between presets and choose as they go.
  const focusable = offered.includes(preset) ? preset : offered[0];
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const last = offered.length - 1;
    const to =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? i === last
          ? 0
          : i + 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? i === 0
            ? last
            : i - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (to === null) return;
    e.preventDefault();
    const next = offered[to];
    if (!next) return;
    radios.current[to]?.focus();
    setPreset(next);
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Eyebrow>Period</Eyebrow>
          {/* What a period means when each row is a person or thing, behind its ⓘ. */}
          {isRosterView(context) ? (
            <InfoTip label="About the period filter">
              Each row is {/^[aeiou]/i.test(grainOf(context)) ? "an" : "a"} {grainOf(context)}: a date range
              keeps those whose {friendly(context.dateColumn)} falls in it.
            </InfoTip>
          ) : null}
        </span>
        <span className="truncate text-xs text-fg-subtle" title={`Dates from ${context.dateColumn}`}>
          by {friendly(context.dateColumn)}
        </span>
      </div>
      <div className="mt-2 grid gap-0.5" role="radiogroup" aria-label="Date range">
        {offered.map((p, i) => {
          const r = presetRange(p, bounds);
          const active = preset === p;
          return (
            <div key={p}>
              {/* The range is in the tooltip and in the From/To fields below, not squeezed beside each option. */}
              <button
                ref={(el) => {
                  radios.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={p === focusable ? 0 : -1}
                onClick={() => setPreset(p)}
                onKeyDown={(e) => onKey(e, i)}
                title={r ? formatRange(r.from, r.to) : undefined}
                className={cn(
                  "flex w-full items-center rounded-control px-2.5 py-1.5 text-left text-ui",
                  active
                    ? "bg-surface-selected text-fg"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg active:bg-surface-active",
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
  // Why the range wasn't applied, shown under the fields (never a silent no-op).
  const [error, setError] = React.useState<string | null>(null);
  return (
    // One field per line: date inputs have a minimum width, and side by side they overflow the rail.
    <form
      className="grid grid-cols-1 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const a = parseIsoDay(from);
        const b = parseIsoDay(to);
        if (a === null || b === null) {
          setError("Enter both dates.");
          return;
        }
        if (b < a) {
          setError("The To date is before the From date.");
          return;
        }
        setError(null);
        // The end date is inclusive: extend it to the last millisecond of that day.
        onApply({ from: a, to: b + 86_399_999 });
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="from" className="text-xs">
          From
        </Label>
        <Input
          id="from"
          type="date"
          value={from}
          min={isoDate(bounds.min)}
          max={isoDate(bounds.max)}
          onChange={(e) => {
            setFrom(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "range-error" : undefined}
          className="h-8 w-full min-w-0 px-2 text-ui"
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="to" className="text-xs">
          To
        </Label>
        <Input
          id="to"
          type="date"
          value={to}
          min={isoDate(bounds.min)}
          max={isoDate(bounds.max)}
          onChange={(e) => {
            setTo(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "range-error" : undefined}
          className="h-8 w-full min-w-0 px-2 text-ui"
        />
      </div>
      {error ? (
        <p id="range-error" role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="sm" variant="secondary">
        Apply custom range
      </Button>
    </form>
  );
}

function DimensionFilters({ inSheet }: { inSheet: boolean }) {
  const context = useWorkspace((s) => s.context);
  if (!context?.dimensions.length) return null;
  return (
    <div>
      <Eyebrow>Filters</Eyebrow>
      <div className="mt-2 grid gap-1.5">
        {/* Named by the column, as the chips and every filter description name it ("Channel: Amazon");
            the industry's name for the field, when it differs, is in the tooltip. */}
        {context.dimensions.slice(0, 7).map((d) => (
          <DimensionFilter
            key={d.column}
            column={d.column}
            label={friendly(d.column)}
            hint={d.label !== friendly(d.column) ? d.label : undefined}
            distinct={d.distinct}
            inSheet={inSheet}
          />
        ))}
      </div>
    </div>
  );
}

function DimensionFilter({
  column,
  label,
  hint,
  distinct,
  inSheet,
}: {
  column: string;
  label: string;
  /** The industry's name for the field, when it differs from the column's. */
  hint?: string;
  distinct: number;
  inSheet: boolean;
}) {
  const current = useWorkspace((s) => s.dimFilters.find((f) => f.column === column));
  const setFilter = useWorkspace((s) => s.setDimFilter);
  const locale = useSettings((s) => s.numberLocale);
  const wide = useWideRail();
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
          title={hint}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-control border px-3 text-left text-ui transition-colors duration-fast",
            selected.length
              ? "border-border-accent bg-surface-selected text-fg"
              : cn(
                  "border-border text-fg-muted hover:border-border-hover hover:text-fg",
                  !inSheet && "bg-surface-1",
                ),
          )}
        >
          <span className="truncate">{label}</span>
          <span className="flex shrink-0 items-center gap-1">
            {selected.length ? (
              <Badge tone="accent">{selected.length}</Badge>
            ) : (
              <span className="font-figures text-xs text-fg-subtle">{distinct}</span>
            )}
            <ChevronDown className="size-3.5 text-fg-subtle" aria-hidden />
          </span>
        </button>
      </PopoverTrigger>
      {/* Beside the rail on a wide screen; below the button in the phone's sheet, where there is no
          room to the right (it opened off-screen there). Never wider than the screen. */}
      <PopoverContent
        align="start"
        side={wide ? "right" : "bottom"}
        className="w-72 max-w-[calc(100vw-1.5rem)] p-0"
      >
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
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
                className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-ui text-fg hover:bg-surface-hover active:bg-surface-active"
              >
                <Checkbox
                  checked={on}
                  onCheckedChange={(x) =>
                    setFilter(column, x ? [...selected, v.value] : selected.filter((y) => y !== v.value))
                  }
                />
                <span className="flex-1 truncate">{v.value}</span>
                {v.count ? (
                  <span className="font-figures text-xs text-fg-subtle">{formatCount(v.count, locale)}</span>
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
  if (!chips.length) return inline ? null : <p className="text-xs text-fg-subtle">No filters applied.</p>;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", !inline && "")}>
      {!inline ? <FilterIcon className="size-3.5 text-fg-subtle" aria-hidden /> : null}
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex h-6 max-w-full items-center gap-1 rounded-full border border-border-accent bg-accent-soft pr-1 pl-2.5 text-xs text-fg"
        >
          <span className="truncate">{c.label}</span>
          <button
            type="button"
            onClick={c.onRemove}
            className="grid size-4 place-items-center rounded-full hover:bg-surface-hover active:bg-surface-active"
            aria-label={`Remove filter ${c.label}`}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={clear}
        className="text-xs text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
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
