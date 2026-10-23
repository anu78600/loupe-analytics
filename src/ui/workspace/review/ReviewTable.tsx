"use client";

/**
 * Check & map's review table (version 50.2): one row per column of the
 * file, in file order, saying how Loupe read it and letting the user fix
 * it. From md it is a table (show/hide, the column with a few values, what
 * it holds, Read as, Matched to on an industry's dashboard, what it feeds,
 * its health); on a phone each column is a card with the same controls.
 *
 * Above it, filters (All, Used, Not used, Hidden, Needs a look) with their
 * counts and a search; below it, the "your columns only" note: everything
 * is built from the file's own columns, and Loupe adds none.
 *
 * Each row opens its details with its chevron (or a click on the row): why
 * it was read so, what it feeds in full, its problems, value meanings, and
 * its role and additivity under "Advanced" (RowDetails). The header sticks
 * under the top bar while the page scrolls, from lg, where the table fits
 * the page; between md and lg it scrolls sideways in its own box instead.
 */
import * as React from "react";
import { ChevronDown, Eye, Search } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace";
import { Card } from "@/ui/primitives/card";
import { Input } from "@/ui/primitives/input";
import { Brief } from "@/ui/primitives/reveal";
import { useColumnUsage } from "../useColumnUsage";
import { EyeToggle, FeedsText, HealthBadges, MatchSelect, NameCell, ReadAsSelect, TypeLabel } from "./cells";
import { filterCounts, visibleRows, type ReviewFilter, type ReviewRow } from "./model";
import { RowDetails } from "./RowDetails";
import { TH } from "./table";
import { useMediaQuery } from "./useMediaQuery";

const FILTERS: Array<{ value: ReviewFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "used", label: "Used" },
  { value: "unused", label: "Not used" },
  { value: "hidden", label: "Hidden" },
  { value: "attention", label: "Needs a look" },
];

/** What an empty table says, by filter. */
const EMPTY: Record<ReviewFilter, string> = {
  all: "No columns.",
  used: "No column feeds the dashboard yet.",
  unused: "Every column you kept feeds a KPI, a chart or a filter.",
  hidden: "No hidden columns. Hide one with its eye.",
  attention: "No column has a problem worth a look.",
};

/** Header and body cells of the review table: a little tighter than the Fields view's. */
const HEAD = cn(TH, "px-3 lg:sticky lg:top-14 lg:z-10");
const CELL = "border-b border-border-subtle px-3 py-3 align-middle";

export function ReviewTable({
  rows,
  filter,
  onFilter,
  onOpen,
}: {
  rows: ReviewRow[];
  filter: ReviewFilter;
  onFilter: (f: ReviewFilter) => void;
  /** Opens the Rows view on a check view, or the File report (null). */
  onOpen: (view: string | null) => void;
}) {
  const generic = useWorkspace((s) => s.context?.domain.generic ?? true);
  const wide = useMediaQuery("(min-width: 768px)");
  // "What it holds" needs the room the page has from about 1360 px; below that the row reads well without it.
  const typeCol = useMediaQuery("(min-width: 1360px)");
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() => new Set());
  const ids = React.useId();
  const counts = filterCounts(rows);
  const shown = visibleRows(rows, filter, query);
  const toggle = (name: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const empty = query.trim() ? `No column matches “${query.trim()}”.` : EMPTY[filter];

  const toolbar = (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        wide ? "border-b border-border px-3 py-3" : "mb-3",
      )}
    >
      <FilterChips value={filter} onChange={onFilter} counts={counts} />
      <div className={cn("relative", wide ? "w-64" : "w-full")}>
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search columns"
          aria-label="Search columns"
          className="h-8 pl-8 text-ui"
        />
      </div>
    </div>
  );

  if (!wide)
    return (
      <div>
        {toolbar}
        {shown.length ? (
          <ul className="grid grid-cols-1 gap-3" aria-label="Your columns">
            {shown.map((row, i) => (
              <ColumnCard
                key={row.column.name}
                row={row}
                generic={generic}
                open={open.has(row.column.name)}
                onToggle={() => toggle(row.column.name)}
                detailsId={`${ids}-c${i}`}
                onOpen={onOpen}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-card border border-dashed border-border-strong px-4 py-8 text-center text-ui text-fg-muted">
            {empty}
          </p>
        )}
        <ColumnsNote className="mt-4" />
      </div>
    );

  // Every column of the table, for the cells that span them all.
  const span = 6 + (generic ? 0 : 1) + (typeCol ? 1 : 0);
  return (
    <Card className="overflow-clip">
      {toolbar}
      {/* relative: screen-reader text (absolutely placed) stays inside the box that scrolls sideways. */}
      <div className="relative max-lg:overflow-x-auto">
        <table className="w-full table-fixed border-separate border-spacing-0 text-ui max-lg:min-w-[860px]">
          <caption className="sr-only">How each column of your file was read</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(HEAD, "w-12 pr-0 pl-4")}>
                {/* The eye's own tooltip says what hiding does; the header only names the column. */}
                <Eye className="size-3.5 text-fg-subtle" aria-hidden />
                <span className="sr-only">In use</span>
              </th>
              <th scope="col" className={HEAD}>
                Column
              </th>
              {typeCol ? (
                <th scope="col" className={cn(HEAD, "w-36")}>
                  Type
                </th>
              ) : null}
              <th scope="col" className={cn(HEAD, "w-36 xl:w-40")}>
                Read as
              </th>
              {generic ? null : (
                <th scope="col" className={cn(HEAD, "w-40 xl:w-44")}>
                  Matched to
                </th>
              )}
              <th scope="col" className={HEAD}>
                Feeds
              </th>
              <th scope="col" className={cn(HEAD, "w-40 xl:w-48")}>
                Health
              </th>
              <th scope="col" className={cn(HEAD, "w-12")}>
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => {
              const name = row.column.name;
              const isOpen = open.has(name);
              const detailsId = `${ids}-t${i}`;
              return (
                <React.Fragment key={name}>
                  <tr
                    className={cn(
                      "group/row transition-colors duration-fast",
                      isOpen ? "bg-surface-2" : "hover:bg-surface-hover",
                      row.status === "hidden" && !isOpen && "bg-surface-2",
                    )}
                    // A click on the row's own space opens it; its controls keep their clicks.
                    onClick={(e) => {
                      if (
                        (e.target as HTMLElement).closest("button, a, input, [role=combobox], [role=switch]")
                      )
                        return;
                      toggle(name);
                    }}
                  >
                    <td className={cn(CELL, "pr-0 pl-2", isOpen && "border-b-transparent")}>
                      <EyeToggle row={row} />
                    </td>
                    <td className={cn(CELL, "cursor-pointer", isOpen && "border-b-transparent")}>
                      <NameCell row={row} />
                    </td>
                    {typeCol ? (
                      <td className={cn(CELL, isOpen && "border-b-transparent")}>
                        <TypeLabel column={row.column} />
                      </td>
                    ) : null}
                    <td className={cn(CELL, "px-1", isOpen && "border-b-transparent")}>
                      <ReadAsSelect row={row} />
                    </td>
                    {generic ? null : (
                      <td className={cn(CELL, "px-1", isOpen && "border-b-transparent")}>
                        <MatchSelect row={row} />
                      </td>
                    )}
                    <td className={cn(CELL, "cursor-pointer", isOpen && "border-b-transparent")}>
                      <FeedsText row={row} />
                    </td>
                    <td className={cn(CELL, isOpen && "border-b-transparent")}>
                      <HealthBadges row={row} onOpen={onOpen} />
                    </td>
                    <td className={cn(CELL, "pr-2 pl-0 text-right", isOpen && "border-b-transparent")}>
                      <ExpandButton
                        open={isOpen}
                        controls={detailsId}
                        name={name}
                        onClick={() => toggle(name)}
                      />
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr id={detailsId} className="bg-surface-2">
                      <td colSpan={span} className="border-b border-border-subtle px-3 pt-1 pb-6 pl-15">
                        <RowDetails row={row} onOpen={onOpen} />
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
            {shown.length ? null : (
              <tr>
                <td colSpan={span} className="px-4 py-10 text-center text-ui text-fg-muted">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ColumnsNote className="px-4 py-3" />
    </Card>
  );
}

/** The chevron that opens a row's details. */
function ExpandButton({
  open,
  controls,
  name,
  onClick,
}: {
  open: boolean;
  controls: string;
  name: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      aria-label={`Details of ${name}`}
      onClick={onClick}
      className="inline-grid size-8 place-items-center rounded-control text-fg-subtle transition-colors duration-fast hover:bg-surface-hover hover:text-fg focus-visible:focus-ring active:bg-surface-active"
    >
      <ChevronDown
        className={cn("size-4 transition-transform duration-base ease-out-quint", open && "rotate-180")}
        aria-hidden
      />
    </button>
  );
}

/** A column as a card, on a phone: its name and values, the two selects side by side, then what it feeds and its health. */
function ColumnCard({
  row,
  generic,
  open,
  onToggle,
  detailsId,
  onOpen,
}: {
  row: ReviewRow;
  generic: boolean;
  open: boolean;
  onToggle: () => void;
  detailsId: string;
  onOpen: (view: string | null) => void;
}) {
  return (
    <li
      className={cn(
        "min-w-0 rounded-card border border-border bg-surface-1 shadow-card",
        row.status === "hidden" && "bg-surface-2",
      )}
    >
      <div className="flex items-start gap-1 py-2 pr-2 pl-1">
        <EyeToggle row={row} />
        <NameCell row={row} className="min-w-0 flex-1 pt-1.5" />
        <ExpandButton open={open} controls={detailsId} name={row.column.name} onClick={onToggle} />
      </div>
      <div className="grid grid-cols-1 gap-3 border-t border-border-subtle p-3">
        <dl className="grid grid-cols-2 gap-2">
          <div className="grid min-w-0 gap-1">
            <dt className="text-xs text-fg-subtle">Read as</dt>
            <dd className="min-w-0">
              <ReadAsSelect row={row} />
            </dd>
          </div>
          {generic ? null : (
            <div className="grid min-w-0 gap-1">
              <dt className="text-xs text-fg-subtle">Matched to</dt>
              <dd className="min-w-0">
                <MatchSelect row={row} />
              </dd>
            </div>
          )}
        </dl>
        {/* What it feeds, and its health only when there is something to say. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <FeedsText row={row} className="min-w-0 flex-1" />
          {row.health.length ? <HealthBadges row={row} max={3} onOpen={onOpen} /> : null}
        </div>
      </div>
      {open ? (
        <div id={detailsId} className="border-t border-border-subtle px-3 pt-4 pb-5">
          <RowDetails row={row} onOpen={onOpen} />
        </div>
      ) : null}
    </li>
  );
}

/** The filters, as quiet chips with their counts; arrow keys move between them (a Radix toggle group). */
function FilterChips({
  value,
  onChange,
  counts,
}: {
  value: ReviewFilter;
  onChange: (f: ReviewFilter) => void;
  counts: Record<ReviewFilter, number>;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => {
        // Radix reports "" when the chosen chip is clicked again: a filter is always chosen.
        if (v) onChange(v as ReviewFilter);
      }}
      aria-label="Show columns"
      className="-mx-1 flex max-w-full flex-wrap items-center gap-1"
    >
      {FILTERS.map((f) => (
        <ToggleGroup.Item
          key={f.value}
          value={f.value}
          className="group inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-ui font-medium text-fg-muted transition-colors duration-fast hover:bg-surface-hover hover:text-fg focus-visible:focus-ring active:bg-surface-active data-[state=on]:bg-surface-selected data-[state=on]:text-fg"
        >
          {f.value === "attention" && counts.attention ? (
            <span aria-hidden className="size-1.5 rounded-full bg-warning" />
          ) : null}
          {f.label}
          <span className="tabular text-xs text-fg-subtle group-data-[state=on]:text-accent-text">
            {counts[f.value]}
          </span>
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

/**
 * "Built from 26 of your 28 columns; none added": the dashboard reads only
 * the file's own columns, with the whole rule behind it.
 */
function ColumnsNote({ className }: { className?: string }) {
  const usage = useColumnUsage();
  if (!usage) return null;
  const { used, total, hidden, derived } = usage;
  return (
    <p className={cn("text-xs text-fg-subtle", className)}>
      <Brief
        label="About your columns"
        full={
          <>
            The dashboard is built from {used} of your {total} columns
            {hidden
              ? `; you hid ${hidden === 1 ? "1 column" : `${hidden} columns`}, which nothing reads`
              : ""}
            . Loupe never adds a column on its own: every KPI, chart and filter reads a column from your file
            {derived ? " (including the two unpivot columns you agreed to)" : ""}, and anything that would
            need a new one asks you first. Hide a column with its eye: it stays in your file.
          </>
        }
      >
        Built from <span className="tabular">{used}</span> of your <span className="tabular">{total}</span>{" "}
        columns{hidden ? `, ${hidden} hidden` : ""}; none added.
      </Brief>
    </p>
  );
}
