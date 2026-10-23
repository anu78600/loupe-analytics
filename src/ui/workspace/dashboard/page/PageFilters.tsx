"use client";

/**
 * The one-page dashboard's filter bar (version 50.3): a row of pills under the
 * banner, in place of the slicer sidebar the page had. Each pill reads
 * "Channel · All"; narrowed to some values it takes the accent tint, reads
 * "Channel · Website +1" and has a × to clear it. A pill opens the filter it
 * stands for: the period pill the presets and the calendar years in the data,
 * with a custom range beside them (laid out as the All charts bar's period
 * is); a column's pill a popover with the column's values, a search and a
 * checkbox for each. The bar ends with "Clear all"
 * when a filter is set, and what the changes compare with at the right.
 *
 * In the download the bar is drawn once, as static pills, so a reader still
 * sees what was selected; with nothing to hover there, a pill names up to
 * three values ("Channel · Website, Mobile App"). Below lg the pills scroll
 * sideways in their own row and the comparison wraps under them.
 *
 * The values come from the analysis profile (hidden columns are never in it),
 * or, for a column the profile doesn't list in full, from the worker.
 */
import * as React from "react";
import { CalendarRange, Check, ChevronDown, Search, X } from "lucide-react";
import { formatRange, isoDate } from "@/engine/core/dates";
import { formatCount } from "@/engine/core/format";
import { friendly } from "@/engine/core/labels";
import { PRESET_LABEL, presetAvailable, presetRange, type DatePreset } from "@/engine/core/periods";
import type { ValueCount } from "@/engine/profile/types";
import { isRosterView, useWorkspace } from "@/store/workspace";
import { engine } from "@/lib/engine-client";
import { cn } from "@/lib/utils";
import { useFmt } from "@/ui/common/hooks";
import { Button } from "@/ui/primitives/button";
import { Input, Label } from "@/ui/primitives/input";
import { Checkbox } from "@/ui/primitives/misc";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/ui/primitives/popover";
import { InfoTip } from "@/ui/primitives/reveal";
import { pillValue, pillValueInFull, yearOf, yearRange, yearsIn } from "./pagePlan";

/** The date presets the period pill offers, as the filter rail does. */
const PRESETS: DatePreset[] = ["all", "last12m", "last6m", "last90d", "last30d", "ytd", "prevYear"];

/** A stable empty selection, so a selector doesn't return a new array on every read. */
const NONE: string[] = [];

/** The pill's outline: a raised key, or the accent tint when it narrows the page. */
function shell(narrowed: boolean, interactive: boolean) {
  return cn(
    "inline-flex h-8 max-w-full min-w-0 shrink-0 items-center rounded-full border text-ui transition-colors duration-fast",
    narrowed
      ? "border-border-accent bg-accent-soft text-accent-text"
      : cn("border-border bg-surface-raised-control shadow-card", interactive && "hover:border-border-hover"),
  );
}

/** The button inside a pill (the whole pill, bar the ×). */
const TRIGGER =
  "inline-flex h-full min-w-0 items-center gap-1.5 rounded-full pr-2.5 pl-3 text-left outline-none focus-visible:focus-ring data-[state=open]:[&>svg:last-child]:rotate-180";

/** "Label · value": the name in muted ink, the selection in the ink's medium weight. */
function PillText({ label, value, narrowed }: { label: string; value: string; narrowed: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
      <span className={narrowed ? "text-accent-text" : "text-fg-muted"}>{label}</span>
      <span aria-hidden className={narrowed ? "text-accent-text" : "text-fg-subtle"}>
        ·
      </span>
      <span className={cn("max-w-48 truncate font-medium", narrowed ? "text-accent-text" : "text-fg")}>
        {value}
      </span>
    </span>
  );
}

/** A pill as the download draws it: the selection, without the controls. */
function StaticPill({
  label,
  value,
  narrowed = false,
  period = false,
}: {
  label: string;
  value: string;
  narrowed?: boolean;
  period?: boolean;
}) {
  return (
    <span className={cn(shell(narrowed, false), "gap-1.5 px-3")}>
      {period ? <CalendarRange className="size-3.5 shrink-0 text-fg-subtle" aria-hidden /> : null}
      <PillText label={label} value={value} narrowed={narrowed} />
    </span>
  );
}

/** The live period pill: the presets and the calendar years in the data, with a custom range beside them. */
function PeriodPill({ label }: { label: string }) {
  const context = useWorkspace((s) => s.context);
  const preset = useWorkspace((s) => s.datePreset);
  const custom = useWorkspace((s) => s.customRange);
  const setPreset = useWorkspace((s) => s.setDatePreset);
  const [open, setOpen] = React.useState(false);
  const radios = React.useRef<Array<HTMLButtonElement | null>>([]);
  const bounds = context?.dateBounds;
  if (!context?.dateColumn || !bounds) return <StaticPill label="Period" value="All rows" period />;
  const latest = new Date(bounds.max).getUTCFullYear();
  const year = preset === "custom" ? yearOf(custom) : null;
  const current = year ? `year:${year}` : `preset:${preset}`;
  const range =
    preset === "custom" && custom
      ? custom
      : (presetRange(preset, bounds) ?? { from: bounds.min, to: bounds.max });
  const years = yearsIn(bounds);
  // The presets, then the calendar years: one group of radios.
  const options = [
    ...PRESETS.filter((p) => presetAvailable(p, bounds)).map((p) => {
      const r = presetRange(p, bounds);
      return {
        key: `preset:${p}`,
        label: PRESET_LABEL[p],
        title: r ? formatRange(r.from, r.to) : undefined,
        choose: () => setPreset(p),
      };
    }),
    ...years.map((y) => ({
      key: `year:${y}`,
      label: y === latest ? `${y} to date` : String(y),
      title: undefined,
      // The year still running is "year to date", compared with the same months a year before.
      choose: () =>
        y === latest && presetAvailable("ytd", bounds) ? setPreset("ytd") : setPreset("custom", yearRange(y)),
    })),
  ];
  const firstYear = options.length - years.length;
  // Roving focus (the ARIA radio group pattern): only the chosen option, or the first while a custom
  // range is in force, is in the Tab order; the arrow keys move and choose as they go.
  const focusable = options.some((o) => o.key === current) ? current : options[0]?.key;
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const last = options.length - 1;
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
    radios.current[to]?.focus();
    options[to]?.choose();
  };
  const grain = context.domain.subDomains.find((s) => s.id === context.subDomainId)?.grain ?? "row";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className={shell(false, true)}>
          {/* Named by its own words ("Period · Last 12 months"), so the label is in the name (WCAG 2.5.3). */}
          <PopoverTrigger asChild>
            <button type="button" className={TRIGGER}>
              <CalendarRange className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
              <PillText label="Period" value={label} narrowed={false} />
              <ChevronDown
                className="size-3.5 shrink-0 text-fg-subtle transition-transform duration-fast"
                aria-hidden
              />
            </button>
          </PopoverTrigger>
        </span>
      </PopoverAnchor>
      {/* The presets beside the custom range, as the period pill of the All charts bar lays them out. */}
      <PopoverContent align="start" className="w-[30rem] max-w-[calc(100vw-1.5rem)] p-0" aria-label="Period">
        <div className="grid sm:grid-cols-[minmax(0,11.5rem)_minmax(0,1fr)]">
          <div className="border-b border-border-subtle p-2 sm:border-r sm:border-b-0">
            <div className="flex items-center gap-1.5 px-2 pt-1 pb-2">
              <span className="eyebrow text-fg-subtle">Period</span>
              {/* What a period means when each row is a person or thing, behind its ⓘ. */}
              {isRosterView(context) ? (
                <InfoTip label="About the period filter">
                  Each row is {/^[aeiou]/i.test(grain) ? "an" : "a"} {grain}: a date range keeps those whose{" "}
                  {friendly(context.dateColumn)} falls in it.
                </InfoTip>
              ) : null}
            </div>
            <div className="grid gap-0.5" role="radiogroup" aria-label="Period">
              {options.map((o, i) => {
                const active = o.key === current;
                return (
                  <React.Fragment key={o.key}>
                    {i === firstYear ? (
                      <span className="eyebrow block px-2 pt-3 pb-1 text-fg-subtle">Calendar year</span>
                    ) : null}
                    <button
                      ref={(el) => {
                        radios.current[i] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      tabIndex={o.key === focusable ? 0 : -1}
                      title={o.title}
                      onClick={() => {
                        o.choose();
                        setOpen(false);
                      }}
                      onKeyDown={(e) => onKey(e, i)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-ui outline-none focus-visible:focus-ring",
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
                      {o.label}
                    </button>
                  </React.Fragment>
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
            {/* Keyed by the active range, so the fields start from the period in force. */}
            <RangeForm
              key={`${range.from}:${range.to}`}
              bounds={bounds}
              initial={range}
              onApply={(r) => {
                setPreset("custom", r);
                setOpen(false);
              }}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** "2025-10-01" as that day's first millisecond (UTC wall clock, as the data's dates are). */
const parseIsoDay = (s: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/** From and To dates, seeded from the period in force and applied as a custom range. */
function RangeForm({
  bounds,
  initial,
  onApply,
}: {
  bounds: { min: number; max: number };
  initial: { from: number; to: number };
  onApply: (r: { from: number; to: number }) => void;
}) {
  const id = React.useId();
  const [from, setFrom] = React.useState(() => isoDate(initial.from));
  const [to, setTo] = React.useState(() => isoDate(initial.to));
  // Why the range wasn't applied, under the fields (never a silent no-op).
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="mt-2 grid gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        const a = parseIsoDay(from);
        const b = parseIsoDay(to);
        if (a === null || b === null) return setError("Enter both dates.");
        if (b < a) return setError("The To date is before the From date.");
        setError(null);
        // The end date is inclusive: to the last millisecond of that day.
        onApply({ from: a, to: b + 86_399_999 });
      }}
    >
      {(["from", "to"] as const).map((which) => (
        <div key={which} className="grid gap-1">
          <Label htmlFor={`${id}-${which}`} className="text-xs">
            {which === "from" ? "From" : "To"}
          </Label>
          <Input
            id={`${id}-${which}`}
            type="date"
            value={which === "from" ? from : to}
            min={isoDate(bounds.min)}
            max={isoDate(bounds.max)}
            onChange={(e) => {
              (which === "from" ? setFrom : setTo)(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className="h-8 w-full min-w-0 px-2 text-ui"
          />
        </div>
      ))}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="sm" variant="secondary" className="mt-1">
        Apply range
      </Button>
    </form>
  );
}

/** A live column pill: search, "All", and a checklist of the column's values with their counts. */
function DimPill({ column, label }: { column: string; label: string }) {
  const selected = useWorkspace((s) => {
    const f = s.dimFilters.find((x) => x.column === column);
    return f && f.kind === "in" ? f.values : NONE;
  });
  const setFilter = useWorkspace((s) => s.setDimFilter);
  const fmt = useFmt();
  const profileValues = useWorkspace(
    (s) => s.context?.profile.columns.find((c) => c.name === column)?.categorical?.all,
  );
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [remote, setRemote] = React.useState<ValueCount[] | null>(null);
  React.useEffect(() => {
    if (profileValues || !open) return;
    let alive = true;
    void engine()
      .columnValues(column, 200, q)
      .then((v) => alive && setRemote(v));
    return () => {
      alive = false;
    };
  }, [column, q, profileValues, open]);
  const values = (profileValues ?? remote ?? []).filter(
    (v) => !q || v.value.toLowerCase().includes(q.toLowerCase()),
  );
  const narrowed = selected.length > 0;
  return (
    <span className={shell(narrowed, true)} title={narrowed ? `${label}: ${selected.join(", ")}` : undefined}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={cn(TRIGGER, narrowed && "pr-1.5")}>
            <PillText label={label} value={pillValue(selected)} narrowed={narrowed} />
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 transition-transform duration-fast",
                narrowed ? "text-accent-text" : "text-fg-subtle",
              )}
              aria-hidden
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          collisionPadding={8}
          className="w-72 p-0"
          aria-label={`Filter by ${label}`}
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
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => setFilter(column, [])}
              className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-ui text-fg outline-none hover:bg-surface-hover focus-visible:focus-ring active:bg-surface-active"
            >
              <Check className={cn("size-3.5", narrowed ? "invisible" : "text-accent")} aria-hidden />
              All
            </button>
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
                    <span className="font-figures text-xs text-fg-subtle">
                      {formatCount(v.count, fmt.locale)}
                    </span>
                  ) : null}
                </label>
              );
            })}
            {!values.length ? <p className="px-2 py-3 text-ui text-fg-subtle">No matching values.</p> : null}
          </div>
        </PopoverContent>
      </Popover>
      {narrowed ? (
        <button
          type="button"
          onClick={() => setFilter(column, [])}
          aria-label={`Clear ${label}`}
          title={`Clear ${label}`}
          className="mr-1 grid size-6 shrink-0 place-items-center rounded-full text-accent-text outline-none hover:bg-surface-hover focus-visible:focus-ring active:bg-surface-active"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

/** The bar: the period, the main filters, "Clear all", and what the changes compare with. */
export function PageFilterBar({
  periodLabel,
  slicers,
  comparison,
  live,
}: {
  periodLabel: string;
  slicers: ReadonlyArray<{ column: string; label: string; values: string[] }>;
  /** "Change vs 1 Oct 2024 – 30 Sep 2025", or why there is no change to show. */
  comparison: string | null;
  live: boolean;
}) {
  const clear = useWorkspace((s) => s.clearFilters);
  // Offered when a column is filtered; the period has its own pill (clearing restores the default).
  const anyFilter = slicers.some((s) => s.values.length);
  return (
    <div
      role="group"
      aria-label="Page filters"
      className={cn("flex min-w-0 items-center gap-x-3 gap-y-2", live && "max-lg:flex-wrap")}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-2",
          // Below lg the pills scroll sideways in their own row; the padding keeps focus rings unclipped.
          live
            ? "max-lg:-my-1 max-lg:w-full max-lg:[scrollbar-width:none] max-lg:overflow-x-auto max-lg:py-1 lg:flex-wrap"
            : "flex-wrap",
        )}
      >
        {live ? <PeriodPill label={periodLabel} /> : <StaticPill label="Period" value={periodLabel} period />}
        {slicers.map((s) =>
          live ? (
            <DimPill key={s.column} column={s.column} label={s.label} />
          ) : (
            <StaticPill
              key={s.column}
              label={s.label}
              value={pillValueInFull(s.values)}
              narrowed={s.values.length > 0}
            />
          ),
        )}
        {live && anyFilter ? (
          <button
            type="button"
            onClick={clear}
            className="h-8 shrink-0 rounded-control px-2 text-ui font-medium text-fg-muted outline-none hover:bg-surface-hover hover:text-fg focus-visible:focus-ring active:bg-surface-active"
          >
            Clear all
          </button>
        ) : null}
      </div>
      <p
        className={cn(
          "tabular min-w-0 shrink-0 text-xs text-fg-subtle",
          live
            ? "lg:ml-auto lg:max-w-[40%] lg:truncate lg:text-right"
            : "ml-auto max-w-[40%] truncate text-right",
        )}
        title={comparison ?? undefined}
      >
        {comparison ?? "No comparison period"}
      </p>
    </div>
  );
}
