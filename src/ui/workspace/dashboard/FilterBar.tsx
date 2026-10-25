"use client";

/**
 * The dashboard's filter bar (version 50.3), in place of the 256 px filter
 * rail: a row of pills above the KPIs, so the charts get the page's width.
 *
 * - The period comes first. Its pill opens the presets (one radio group with
 *   roving focus: Tab reaches the chosen one, the arrow keys move and choose)
 *   beside a custom From/To range, which says so when its end is before its
 *   start instead of being ignored.
 * - Then a pill per main dimension ("Channel · All", "Channel · Website +1"),
 *   named by its column as every filter description names it, each opening its
 *   searchable value list. A chart click's cross-filter is a pill of its own.
 * - Pills that don't fit the row move into "All filters", measured rather
 *   than guessed: an invisible copy of the pills gives their widths, and a
 *   ResizeObserver recounts when the bar or a pill's text changes. On a phone
 *   the whole bar scrolls sideways inside itself instead, so every pill stays
 *   in reach.
 * - A narrowed pill takes the accent tint, with a × to clear it, and the bar
 *   ends with "Clear all" whenever anything is narrowed. The period counts as
 *   narrowed when it differs from the one the dashboard opens on (Clear all
 *   goes back to that one).
 * - At the right: what the KPI changes compare with ("vs 1 Oct 2024 – 30 Sep
 *   2025"; above the KPIs below lg) and the data-health entry ("Health 100"),
 *   which opens the existing report.
 *
 * The bar is sticky under the top bar from lg, on the canvas until it sticks;
 * then it takes the top bar's glass (an IntersectionObserver on a sentinel
 * above it says when). It sits above the charts and below every menu and
 * popover. Popovers sit on the overlay plane, as all of them do.
 *
 * `ActiveFilters`, the chips the Insights step shows above its list, lives
 * here too.
 */
import * as React from "react";
import {
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter as FilterIcon,
  MousePointerClick,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  defaultPreset,
  PRESET_LABEL,
  presetAvailable,
  presetRange,
  type DatePreset,
} from "@/engine/core/periods";
import { formatRange, isoDate } from "@/engine/core/dates";
import { formatCount } from "@/engine/core/format";
import { friendly } from "@/engine/core/labels";
import type { ValueCount } from "@/engine/profile/types";
import { isRosterView, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { engine } from "@/lib/engine-client";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/primitives/button";
import { Checkbox } from "@/ui/primitives/misc";
import { Input, Label } from "@/ui/primitives/input";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/ui/primitives/popover";
import { InfoTip } from "@/ui/primitives/reveal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitives/select";
import { Tooltip } from "@/ui/primitives/tooltip";
import { ComparisonNote, sharedComparison } from "./KpiCards";

type Context = NonNullable<ReturnType<typeof useWorkspace.getState>["context"]>;

const PRESETS: DatePreset[] = ["all", "last12m", "last6m", "last90d", "last30d", "ytd", "prevYear"];

/** As many dimension filters as the rail offered: the ones the analysis ranks first. */
const MAX_DIMENSIONS = 7;

/** Space between pills, px (the row's gap-2). */
const GAP = 8;

const parseIsoDay = (s: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/** The period a fresh dashboard opens on: the whole file for a roster, recent activity otherwise. */
function defaultPeriod(context: Context | null): DatePreset {
  return isRosterView(context) ? "all" : defaultPreset(context?.dateBounds ?? null);
}

/** What one row is in the active business area ("employee"), for plain-language hints. */
function grainOf(context: Context): string {
  return context.domain.subDomains.find((s) => s.id === context.subDomainId)?.grain ?? "row";
}

/** "All", the value, or the first value and how many more ("Website +1"), as a slicer reads. */
function selectionText(values: readonly string[]): string {
  if (!values.length) return "All";
  return values.length === 1 ? (values[0] as string) : `${values[0]} +${values.length - 1}`;
}

// ---------------------------------------------------------------- the pill

const PILL =
  "inline-flex h-8 shrink-0 items-center rounded-full border text-ui whitespace-nowrap transition-colors duration-fast";
const PILL_IDLE =
  "border-border bg-surface-raised-control text-fg-muted shadow-card hover:border-border-hover";
const PILL_ON = "border-border-accent bg-accent-soft text-accent-text";

/** The words inside a pill: the label muted, the value in ink (both in the accent once narrowed). */
function PillFace({
  icon,
  label,
  value,
  narrowed,
  chevron = true,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: string;
  narrowed: boolean;
  chevron?: boolean;
}) {
  return (
    <>
      {icon}
      <span>{label}</span>
      {value !== undefined ? (
        <>
          <span aria-hidden className={narrowed ? "" : "text-fg-subtle"}>
            ·
          </span>
          <span className={cn("max-w-44 truncate font-medium", narrowed ? "" : "text-fg")}>{value}</span>
        </>
      ) : null}
      {chevron ? <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden /> : null}
    </>
  );
}

/**
 * One filter pill: a button that opens its popover, and, once narrowed, a ×
 * that clears it. The popover hangs from the whole pill, so it lines up with
 * its left edge.
 */
function FilterPill({
  label,
  value,
  icon,
  narrowed,
  onClear,
  title,
  open,
  onOpenChange,
  contentClassName,
  children,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  narrowed: boolean;
  onClear?: () => void;
  title?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  const clearable = narrowed && onClear;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <span className={cn(PILL, narrowed ? PILL_ON : PILL_IDLE)}>
          <PopoverTrigger asChild>
            <button
              type="button"
              title={title}
              className={cn(
                "inline-flex h-full items-center gap-1.5 rounded-full pl-3 focus-visible:focus-ring",
                clearable ? "pr-1.5" : "pr-2.5",
                !narrowed && "hover:text-fg",
              )}
            >
              <PillFace icon={icon} label={label} value={value} narrowed={narrowed} />
            </button>
          </PopoverTrigger>
          {clearable ? (
            <button
              type="button"
              onClick={onClear}
              aria-label={`Clear ${label}`}
              className="mr-1 grid size-6 place-items-center rounded-full hover:bg-surface-hover focus-visible:focus-ring active:bg-surface-active"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </span>
      </PopoverAnchor>
      <PopoverContent align="start" className={cn("w-72 max-w-[calc(100vw-1.5rem)] p-0", contentClassName)}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** A pill's shape without its controls, for measuring how wide it is (usePillFit). */
function PillGhost({ label, value, narrowed }: { label: string; value: string; narrowed: boolean }) {
  return (
    <span className={cn(PILL, narrowed ? PILL_ON : PILL_IDLE)}>
      <span className={cn("inline-flex items-center gap-1.5 pl-3", narrowed ? "pr-1.5" : "pr-2.5")}>
        <PillFace label={label} value={value} narrowed={narrowed} />
      </span>
      {narrowed ? <span className="mr-1 size-6" /> : null}
    </span>
  );
}

// ---------------------------------------------------------------- the bar

/**
 * How many dimension pills fit beside the always-shown ones, measured on the
 * pills' invisible copies; all of them on a phone, where the bar scrolls.
 * State is set in the observer's callback, never in the effect itself.
 */
function usePillFit(count: number) {
  const area = React.useRef<HTMLDivElement>(null);
  const fixed = React.useRef<HTMLDivElement>(null);
  const ghosts = React.useRef<HTMLDivElement>(null);
  const [fit, setFit] = React.useState(count);
  React.useEffect(() => {
    const a = area.current;
    const g = ghosts.current;
    if (!a || !g) return;
    const compute = () => {
      const items = Array.from(g.children) as HTMLElement[];
      // The last copy is the "All filters" pill, the room kept for it when some pills move into it.
      const more = items.pop();
      const n = items.length;
      if (!window.matchMedia("(min-width: 640px)").matches) {
        setFit(n);
        return;
      }
      // The area's padding (p-1, room for the focus ring inside its clip) isn't room for pills.
      const avail = a.clientWidth - 8 - (fixed.current ? fixed.current.offsetWidth + GAP : 0);
      const widths = items.map((el) => el.offsetWidth);
      const total = widths.reduce((s, w, i) => s + w + (i ? GAP : 0), 0);
      if (total <= avail) {
        setFit(n);
        return;
      }
      const reserve = (more?.offsetWidth ?? 0) + GAP;
      let used = 0;
      let k = 0;
      for (const w of widths) {
        const next = used + (k ? GAP : 0) + w;
        if (next + reserve > avail) break;
        used = next;
        k++;
      }
      setFit(k);
    };
    const ro = new ResizeObserver(compute);
    ro.observe(a);
    ro.observe(g);
    if (fixed.current) ro.observe(fixed.current);
    return () => ro.disconnect();
  }, [count]);
  return { area, fixed, ghosts, fit: Math.min(fit, count) };
}

/**
 * Whether the bar is stuck under the top bar: a sentinel just above it has
 * scrolled up behind the top bar (57 px: its 56 px and the hairline).
 */
function useStuck(): [React.RefCallback<HTMLDivElement>, boolean] {
  const [stuck, setStuck] = React.useState(false);
  const observer = React.useRef<IntersectionObserver | null>(null);
  const ref = React.useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!node) return;
    observer.current = new IntersectionObserver(
      ([entry]) => setStuck(Boolean(entry && !entry.isIntersecting && entry.boundingClientRect.top < 120)),
      { rootMargin: "-57px 0px 0px 0px", threshold: 0 },
    );
    observer.current.observe(node);
  }, []);
  return [ref, stuck];
}

export function FilterBar({ onOpenHealth }: { onOpenHealth: () => void }) {
  const context = useWorkspace((s) => s.context);
  const dimFilters = useWorkspace((s) => s.dimFilters);
  const cross = useWorkspace((s) => s.crossFilter);
  const preset = useWorkspace((s) => s.datePreset);
  const clear = useWorkspace((s) => s.clearFilters);
  // Whether there is a comparison (or a shared reason for none) to state at the bar's end.
  const compared = useWorkspace((s) => Boolean(s.kpiBatch && sharedComparison(s.kpiBatch.values)));
  const dims = (context?.dimensions ?? []).slice(0, MAX_DIMENSIONS);
  const { area, fixed, ghosts, fit } = usePillFit(dims.length);
  const [sentinel, stuck] = useStuck();
  if (!context) return null;
  const selected = (column: string) => {
    const f = dimFilters.find((x) => x.column === column);
    return f && f.kind === "in" ? f.values : [];
  };
  const narrowed =
    dimFilters.length > 0 ||
    cross !== null ||
    (Boolean(context.dateColumn) && preset !== defaultPeriod(context));
  const shown = dims.slice(0, fit);
  const rest = dims.slice(fit);
  return (
    <>
      <div ref={sentinel} aria-hidden className="-mb-px h-px" />
      <div
        role="region"
        aria-label="Filters"
        data-stuck={stuck ? "" : undefined}
        className="no-print relative z-30 border-b border-transparent transition-[background-color,border-color] duration-base lg:sticky lg:top-14 lg:data-stuck:border-border lg:data-stuck:bg-bg/85 lg:data-stuck:backdrop-blur-xl"
      >
        <div className="mx-auto w-full max-w-[1760px] px-4 md:px-6">
          {/* On a phone the whole row scrolls sideways inside itself, edge to edge. */}
          <div className="flex h-14 items-center gap-2 max-sm:-mx-4 max-sm:[scrollbar-width:none] max-sm:overflow-x-auto max-sm:px-4">
            <div
              ref={area}
              className="flex items-center gap-2 max-sm:shrink-0 sm:-m-1 sm:min-w-0 sm:flex-1 sm:overflow-hidden sm:p-1"
            >
              <div ref={fixed} className="flex shrink-0 items-center gap-2">
                <PeriodPill />
                <CrossFilterPill />
              </div>
              {shown.map((d) => (
                <DimensionPill
                  key={d.column}
                  column={d.column}
                  label={friendly(d.column)}
                  hint={d.label !== friendly(d.column) ? d.label : undefined}
                  values={selected(d.column)}
                />
              ))}
              {rest.length ? (
                <AllFiltersPill
                  dims={dims.map((d) => ({ column: d.column, label: friendly(d.column) }))}
                  hidden={rest.filter((d) => selected(d.column).length > 0).length}
                />
              ) : null}
            </div>
            {narrowed ? (
              <Button variant="ghost" size="sm" className="shrink-0 px-2.5" onClick={clear}>
                Clear all
              </Button>
            ) : null}
            {compared ? (
              <div className="hidden min-w-0 shrink items-center gap-3 lg:flex">
                <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
                <ComparisonNote />
              </div>
            ) : null}
            <HealthButton onOpen={onOpenHealth} />
          </div>
          {/* The pills' invisible copies, measured by usePillFit; the last is the "All filters" pill. */}
          <div
            ref={ghosts}
            aria-hidden
            className="pointer-events-none invisible absolute top-0 left-0 flex h-0 gap-2 overflow-hidden"
          >
            {dims.map((d) => (
              <PillGhost
                key={d.column}
                label={friendly(d.column)}
                value={selectionText(selected(d.column))}
                narrowed={selected(d.column).length > 0}
              />
            ))}
            <span className={cn(PILL, PILL_IDLE, "gap-1.5 px-3")}>
              <SlidersHorizontal className="size-3.5" />
              All filters
              <span className="w-5" />
              <ChevronDown className="size-3.5" />
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- the period

function PeriodPill() {
  const context = useWorkspace((s) => s.context);
  const preset = useWorkspace((s) => s.datePreset);
  const custom = useWorkspace((s) => s.customRange);
  const setPreset = useWorkspace((s) => s.setDatePreset);
  const [open, setOpen] = React.useState(false);
  const bounds = context?.dateBounds;
  if (!context?.dateColumn || !bounds) {
    return (
      <span
        className={cn(PILL, "border-dashed border-border px-3 text-fg-subtle")}
        title="No date column is mapped, so period filters are off."
      >
        <CalendarRange className="mr-1.5 size-3.5" aria-hidden />
        No date column
      </span>
    );
  }
  const fallback = defaultPeriod(context);
  const isCustom = preset === "custom" && custom;
  const value = isCustom ? formatRange(custom.from, custom.to) : PRESET_LABEL[preset];
  const range = isCustom ? custom : presetRange(preset, bounds);
  return (
    <FilterPill
      label="Period"
      value={value}
      icon={<CalendarRange className="size-3.5 shrink-0" aria-hidden />}
      narrowed={preset !== fallback}
      onClear={() => setPreset(fallback)}
      title={range ? `${formatRange(range.from, range.to)} · by ${friendly(context.dateColumn)}` : undefined}
      open={open}
      onOpenChange={setOpen}
      contentClassName="w-[min(30rem,calc(100vw-1.5rem))]"
    >
      <PeriodPanel context={context} onDone={() => setOpen(false)} />
    </FilterPill>
  );
}

/** The presets beside a custom From/To range (stacked on a phone). */
function PeriodPanel({ context, onDone }: { context: Context; onDone: () => void }) {
  const preset = useWorkspace((s) => s.datePreset);
  const custom = useWorkspace((s) => s.customRange);
  const setPreset = useWorkspace((s) => s.setDatePreset);
  const radios = React.useRef<Array<HTMLButtonElement | null>>([]);
  const bounds = context.dateBounds;
  if (!bounds || !context.dateColumn) return null;
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
    <div className="grid sm:grid-cols-[minmax(0,11.5rem)_minmax(0,1fr)]">
      <div className="border-b border-border-subtle p-2 sm:border-r sm:border-b-0">
        <div className="flex items-center gap-1.5 px-2 pt-1 pb-2">
          <span className="eyebrow text-fg-subtle">Period</span>
          {/* What a period means when each row is a person or thing, behind its ⓘ. */}
          {isRosterView(context) ? (
            <InfoTip label="About the period filter">
              Each row is {/^[aeiou]/i.test(grainOf(context)) ? "an" : "a"} {grainOf(context)}: a date range
              keeps those whose {friendly(context.dateColumn)} falls in it.
            </InfoTip>
          ) : null}
        </div>
        <div className="grid gap-0.5" role="radiogroup" aria-label="Date range">
          {offered.map((p, i) => {
            const r = presetRange(p, bounds);
            const active = preset === p;
            return (
              // The range is in the tooltip and in the From/To fields, not squeezed beside each option.
              <button
                key={p}
                ref={(el) => {
                  radios.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={p === focusable ? 0 : -1}
                onClick={() => {
                  setPreset(p);
                  onDone();
                }}
                onKeyDown={(e) => onKey(e, i)}
                title={r ? formatRange(r.from, r.to) : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-ui",
                  active
                    ? "bg-surface-selected text-fg"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg active:bg-surface-active",
                )}
              >
                <Check
                  className={cn("size-3.5 shrink-0", active ? "text-accent" : "invisible")}
                  strokeWidth={2.5}
                  aria-hidden
                />
                {PRESET_LABEL[p]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="eyebrow text-fg-subtle">Custom range</span>
          <span className="truncate text-xs text-fg-subtle" title={`Dates from ${context.dateColumn}`}>
            by {friendly(context.dateColumn)}
          </span>
        </div>
        {/* Keyed by the active range, so the fields reset whenever the period changes elsewhere. */}
        <CustomRangeForm
          key={`${current.from}:${current.to}`}
          bounds={bounds}
          initial={current}
          onApply={(r) => {
            setPreset("custom", r);
            onDone();
          }}
        />
        <DatesBy current={context.dateColumn} />
      </div>
    </div>
  );
}

/**
 * "Dates by" (version 52.2): the date column every period filter, KPI and time chart reads, offered when
 * the file has more than one (an order date and a ship date; a loan's issue date and its borrower's first
 * credit line). Choosing one reconfigures the dashboard on it (setDateColumn).
 */
function DatesBy({ current }: { current: string }) {
  const profile = useWorkspace((s) => s.profile);
  const hidden = useWorkspace((s) => s.hiddenColumns);
  const setDateColumn = useWorkspace((s) => s.setDateColumn);
  const options = (profile?.columns ?? [])
    .filter((c) => c.role === "datetime" && c.nullPct < 0.999 && !hidden.includes(c.name))
    .map((c) => c.name);
  if (options.length < 2 || !options.includes(current)) return null;
  return (
    <div className="mt-3 grid gap-1.5 border-t border-border-subtle pt-3">
      <Label htmlFor="dates-by" className="eyebrow text-fg-subtle">
        Dates by
      </Label>
      <Select value={current} onValueChange={setDateColumn}>
        <SelectTrigger id="dates-by">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((c) => (
            <SelectItem key={c} value={c}>
              {friendly(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
    // One field per line: date fields have a minimum width, and side by side they would not fit.
    <form
      className="mt-2 grid grid-cols-1 gap-2"
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
        <Label htmlFor="range-from" className="text-xs">
          From
        </Label>
        <Input
          id="range-from"
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
        <Label htmlFor="range-to" className="text-xs">
          To
        </Label>
        <Input
          id="range-to"
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
      <Button type="submit" size="sm" variant="secondary" className="mt-1">
        Apply range
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- dimensions

function DimensionPill({
  column,
  label,
  hint,
  values,
}: {
  column: string;
  label: string;
  /** The industry's name for the field, when it differs from the column's. */
  hint?: string;
  values: string[];
}) {
  const setFilter = useWorkspace((s) => s.setDimFilter);
  return (
    <FilterPill
      label={label}
      value={selectionText(values)}
      narrowed={values.length > 0}
      onClear={() => setFilter(column, [])}
      title={values.length > 1 ? `${label}: ${values.join(", ")}` : hint}
    >
      <DimensionValues column={column} label={label} />
    </FilterPill>
  );
}

/**
 * A dimension's values with their row counts, searchable, each a checkbox.
 * From the profile when it holds every value; otherwise asked of the worker
 * (up to 200, searched there).
 */
function DimensionValues({ column, label }: { column: string; label: string }) {
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
    <>
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <Search className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${label.toLowerCase()}`}
          className="h-7 min-w-0 flex-1 bg-transparent text-ui text-fg outline-none placeholder:text-fg-subtle"
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
    </>
  );
}

/**
 * Every dimension filter in one popover, for the pills that don't fit the
 * row: a list of filters with their values, each opening its value list in
 * place (with the way back at the top).
 */
function AllFiltersPill({
  dims,
  hidden,
}: {
  dims: Array<{ column: string; label: string }>;
  /** How many of the filters not shown as pills are narrowed. */
  hidden: number;
}) {
  const dimFilters = useWorkspace((s) => s.dimFilters);
  const [open, setOpen] = React.useState(false);
  const [column, setColumn] = React.useState<string | null>(null);
  const picked = dims.find((d) => d.column === column);
  const valuesOf = (c: string) => {
    const f = dimFilters.find((x) => x.column === c);
    return f && f.kind === "in" ? f.values : [];
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setColumn(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            PILL,
            hidden ? PILL_ON : PILL_IDLE,
            "gap-1.5 px-3 focus-visible:focus-ring",
            !hidden && "hover:text-fg",
          )}
        >
          <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden />
          All filters
          {hidden ? (
            <span className="font-figures grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-2xs text-accent-fg">
              {hidden}
              <span className="sr-only"> more narrowed</span>
            </span>
          ) : null}
          <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 max-w-[calc(100vw-1.5rem)] p-0">
        {picked ? (
          <>
            <button
              type="button"
              onClick={() => setColumn(null)}
              className="flex w-full items-center gap-1.5 border-b border-border-subtle px-3 py-2 text-left text-ui font-medium text-fg hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none focus-visible:ring-inset"
            >
              <ChevronLeft className="size-3.5 text-fg-subtle" aria-hidden />
              {picked.label}
            </button>
            <DimensionValues column={picked.column} label={picked.label} />
          </>
        ) : (
          <div className="p-1">
            <p className="eyebrow px-2 pt-1.5 pb-1 text-fg-subtle">Filters</p>
            {dims.map((d) => {
              const values = valuesOf(d.column);
              return (
                <button
                  key={d.column}
                  type="button"
                  onClick={() => setColumn(d.column)}
                  className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-ui hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none focus-visible:ring-inset active:bg-surface-active"
                >
                  <span className="min-w-0 flex-1 truncate text-fg-muted">{d.label}</span>
                  <span
                    className={cn(
                      "max-w-32 truncate",
                      values.length ? "font-medium text-accent-text" : "text-fg-subtle",
                    )}
                  >
                    {selectionText(values)}
                  </span>
                  <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The filter a click on a chart set ("Channel · Amazon"): no list of its own, only its ×. */
function CrossFilterPill() {
  const cross = useWorkspace((s) => s.crossFilter);
  const setCross = useWorkspace((s) => s.setCrossFilter);
  if (!cross) return null;
  const label = friendly(cross.column);
  return (
    <span className={cn(PILL, PILL_ON, "gap-1.5 pl-3")} title="Set by a click on a chart">
      <MousePointerClick className="size-3.5 shrink-0" aria-hidden />
      <span>{label}</span>
      <span aria-hidden>·</span>
      <span className="max-w-44 truncate font-medium">{cross.value}</span>
      <button
        type="button"
        onClick={() => setCross(cross.sourceId, cross.column, null)}
        aria-label={`Clear ${label}: ${cross.value}`}
        className="mr-1 grid size-6 place-items-center rounded-full hover:bg-surface-hover focus-visible:focus-ring active:bg-surface-active"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

/** "Health 100": the data-health score, opening the full report (the dashboard's dialog). */
function HealthButton({ onOpen }: { onOpen: () => void }) {
  const health = useWorkspace((s) => s.health);
  if (!health) return null;
  const tone = health.score >= 90 ? "bg-success" : health.score >= 75 ? "bg-accent" : "bg-warning";
  return (
    <Tooltip content={health.issues[0]?.title ?? "No issues found"}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Health ${health.score} of 100: open the data-health report`}
        className="inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-2.5 text-ui text-fg-muted transition-colors duration-fast hover:bg-surface-hover hover:text-fg focus-visible:focus-ring active:bg-surface-active"
      >
        <span aria-hidden className={cn("size-2 rounded-full", tone)} />
        Health <span className="font-figures font-medium text-fg">{health.score}</span>
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------- chips elsewhere

/**
 * The filters in use as removable chips, for pages that show the selection
 * without the bar (the Insights step). Inline it says nothing when there are
 * no filters; otherwise "No filters applied."
 */
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
    <div className="flex flex-wrap items-center gap-1.5">
      {!inline ? <FilterIcon className="size-3.5 text-fg-subtle" aria-hidden /> : null}
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex h-6 max-w-full items-center gap-1 rounded-full border border-border-accent bg-accent-soft pr-1 pl-2.5 text-xs text-accent-text"
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
