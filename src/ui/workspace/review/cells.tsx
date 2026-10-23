"use client";

/**
 * The controls and values a review-table row is made of, shared by the
 * table (from md) and the column cards (on a phone), so both make the same
 * changes the same way:
 *
 * - EyeToggle: uses a column in the analysis or hides it (it stays in the
 *   file, the grid and every export; nothing computes from it);
 * - ReadAsSelect: the kind the column is read as, the role override the kind
 *   stands for (roleForKind), as Detect's chips set it, with Loupe's
 *   reading back for a column the user set;
 * - MatchSelect: the template field the column fills, on an industry's
 *   dashboard (useMatch, with Undo when the change takes from elsewhere);
 * - FeedsText: what the column feeds, or why it feeds nothing;
 * - HealthBadges: its problems as short badges, each opening the rows that
 *   show it (or the File report when the check can't list them);
 * - FeedsBadges: the counts with the names on hover (the Fields view).
 *
 * The selects are quiet in a row: no field until the row is hovered or the
 * select focused, so a table of them reads as values, not as a form.
 */
import * as React from "react";
import {
  Calendar,
  Clock,
  Eye,
  EyeOff,
  Hash,
  RotateCcw,
  Target,
  ToggleLeft,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { ColumnUse } from "@/engine/charts/columnUsage";
import type { ColumnProfile } from "@/engine/profile/types";
import { KIND_LABEL, roleForKind } from "@/engine/understand/kinds";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace";
import { Badge } from "@/ui/primitives/badge";
import { ClampText } from "@/ui/primitives/reveal";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/ui/primitives/select";
import { Tooltip } from "@/ui/primitives/tooltip";
import { kindLabel } from "../columnSummary";
import { feedsText, readAsOptions, type HealthBadge, type ReviewRow } from "./model";
import { useMatch } from "./useMatch";

const NONE = "__none__";
const RESET = "__reset__";

/**
 * A select that reads as a value in a table row: no field until the row is
 * hovered (group/row) or the select is focused or open. On a phone, where
 * nothing hovers, the field always shows.
 */
export const QUIET_TRIGGER = cn(
  "h-8 border-transparent bg-transparent px-2 group-hover/row:border-border-strong group-hover/row:bg-surface-2 data-[state=open]:border-border-hover data-[state=open]:bg-surface-2 max-md:border-border-strong max-md:bg-surface-2",
  // The chevron says it can be changed, at half strength until the row is hovered or the select used.
  "md:[&>svg]:opacity-50 md:group-hover/row:[&>svg]:opacity-100 md:focus-visible:[&>svg]:opacity-100 md:data-[state=open]:[&>svg]:opacity-100",
);

const STORAGE_ICON: Record<ColumnProfile["storage"], LucideIcon> = {
  number: Hash,
  date: Calendar,
  string: Type,
  boolean: ToggleLeft,
};

/** What a column holds: its storage's icon (the data grid's) and the kind of values, in words. */
export function TypeLabel({ column, className }: { column: ColumnProfile; className?: string }) {
  const Icon = column.role === "time" ? Clock : STORAGE_ICON[column.storage];
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-ui text-fg-muted", className)}>
      <Icon className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
      <span className="truncate">{kindLabel(column)}</span>
    </span>
  );
}

/**
 * The eye: whether the analysis uses the column. A switch, so it reads out as
 * "Use <column> in the analysis, on/off", as the old Use switch did.
 */
export function EyeToggle({ row }: { row: ReviewRow }) {
  const setHidden = useWorkspace((s) => s.setColumnsHidden);
  const off = row.status === "hidden";
  const name = row.column.name;
  return (
    <Tooltip
      content={
        off
          ? "Hidden: kept in your file, but nothing computes from it. Use it again."
          : "Hide it from every KPI, chart, filter and question. It stays in your file."
      }
    >
      <button
        type="button"
        role="switch"
        aria-checked={!off}
        aria-label={`Use ${name} in the analysis`}
        onClick={() => setHidden([name], !off)}
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-control transition-colors duration-fast hover:bg-surface-hover hover:text-fg focus-visible:focus-ring active:bg-surface-active",
          off ? "text-fg-subtle" : "text-fg-muted",
        )}
      >
        {off ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </Tooltip>
  );
}

/** The kind a column is read as, which the user can change; the outcome is chosen on Detect. */
export function ReadAsSelect({ row, className }: { row: ReviewRow; className?: string }) {
  const override = useWorkspace((s) => s.roleOverrides[row.column.name]);
  const setRole = useWorkspace((s) => s.setRoleOverride);
  const name = row.column.name;
  if (row.kind === "outcome")
    return (
      <Tooltip content="What the table is measured by. Choose another on Detect, under “Measured by”.">
        <span
          tabIndex={0}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-ui font-medium text-accent-text focus-visible:focus-ring",
            className,
          )}
        >
          <Target className="size-3.5 shrink-0" aria-hidden />
          {KIND_LABEL.outcome}
          <span className="sr-only">: what the table is measured by</span>
        </span>
      </Tooltip>
    );
  return (
    <Select
      value={row.kind}
      disabled={row.status === "hidden"}
      onValueChange={(v) => {
        if (v === RESET) return setRole(name, null);
        const option = readAsOptions(row.kind).find((k) => k.kind === v && k.settable);
        const o = option ? roleForKind(option.kind) : null;
        if (o) setRole(name, o.role, o.additivity, o.kind);
      }}
    >
      <SelectTrigger
        size="sm"
        className={cn(QUIET_TRIGGER, "w-full", className)}
        aria-label={`Read ${name} as${override ? " (set by you)" : ""}`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">
            <SelectValue />
          </span>
          {override ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Read as</SelectLabel>
          {readAsOptions(row.kind).map((k) => (
            <SelectItem key={k.kind} value={k.kind} disabled={!k.settable}>
              {k.label}
            </SelectItem>
          ))}
        </SelectGroup>
        {override ? (
          <>
            <SelectSeparator />
            <SelectItem value={RESET}>
              <span className="inline-flex items-center gap-1.5">
                <RotateCcw className="size-3.5 text-fg-subtle" aria-hidden /> Loupe&apos;s reading
              </span>
            </SelectItem>
          </>
        ) : null}
      </SelectContent>
    </Select>
  );
}

/** The template field a column fills (industry dashboards). */
export function MatchSelect({ row, className }: { row: ReviewRow; className?: string }) {
  const context = useWorkspace((s) => s.context);
  const manual = useWorkspace((s) => (row.field ? row.field.id in s.mappingOverrides : false));
  const match = useMatch();
  if (!context || context.domain.generic) return null;
  const name = row.column.name;
  const fields = [...context.domain.fields].sort(
    (a, b) => (b.core ? 1 : 0) - (a.core ? 1 : 0) || a.label.localeCompare(b.label),
  );
  const core = fields.filter((f) => f.core);
  const other = fields.filter((f) => !f.core);
  const item = (f: (typeof fields)[number]) => {
    const now = context.mapping.fields[f.id];
    return (
      <SelectItem key={f.id} value={f.id} hint={now && now !== name ? `now ${now}` : undefined}>
        {f.label}
      </SelectItem>
    );
  };
  return (
    <Select
      value={row.field?.id ?? NONE}
      disabled={row.status === "hidden"}
      onValueChange={(v) => match.forColumn(name, v === NONE ? null : v)}
    >
      <SelectTrigger
        size="sm"
        className={cn(QUIET_TRIGGER, "w-full", !row.field && "text-fg-subtle", className)}
        aria-label={`Field ${name} fills${manual ? " (set by you)" : ""}`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">
            <SelectValue />
          </span>
          {manual ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
        </span>
      </SelectTrigger>
      <SelectContent className="w-72">
        <SelectItem value={NONE}>Not matched</SelectItem>
        {core.length ? (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Core fields</SelectLabel>
              {core.map(item)}
            </SelectGroup>
          </>
        ) : null}
        {other.length ? (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Other fields</SelectLabel>
              {other.map(item)}
            </SelectGroup>
          </>
        ) : null}
      </SelectContent>
    </Select>
  );
}

/** What a column feeds, in one line, or why it feeds nothing. */
export function FeedsText({ row, className }: { row: ReviewRow; className?: string }) {
  if (row.status === "hidden")
    return <span className={cn("text-ui text-fg-subtle", className)}>Hidden · nothing reads it</span>;
  if (row.status === "unused")
    return (
      <span className={cn("block min-w-0", className)}>
        <span className="text-ui text-fg-subtle">Not used</span>
        {row.why ? <ClampText className="text-xs text-fg-subtle">{row.why.reason}</ClampText> : null}
      </span>
    );
  return (
    <ClampText lines={2} className={cn("text-ui text-fg-muted", className)}>
      {feedsText(row.use)}
    </ClampText>
  );
}

/**
 * A row's health: up to `max` badges and a count of the rest. A badge with
 * rows opens them in the Rows view; one the check can't list opens the File
 * report, which explains every issue.
 */
export function HealthBadges({
  row,
  max = 2,
  onOpen,
  className,
}: {
  row: ReviewRow;
  max?: number;
  /** Opens the Rows view on a check view, or the File report (null). */
  onOpen: (view: string | null) => void;
  className?: string;
}) {
  if (row.status === "hidden")
    return <span className={cn("text-ui text-fg-subtle", className)}>Not checked</span>;
  if (!row.health.length)
    return (
      <span className={cn("text-ui text-fg-subtle", className)}>
        <span aria-hidden>—</span>
        <span className="sr-only">No problems found</span>
      </span>
    );
  const shown = row.health.slice(0, max);
  const rest = row.health.length - shown.length;
  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {shown.map((b) => (
        <HealthBadgeButton key={b.id} badge={b} column={row.column.name} onOpen={onOpen} />
      ))}
      {rest > 0 ? (
        <Badge tone="outline">
          +{rest}
          <span className="sr-only"> more</span>
        </Badge>
      ) : null}
    </span>
  );
}

/** One health badge as a button, its full text in the tooltip. */
export function HealthBadgeButton({
  badge,
  column,
  onOpen,
}: {
  badge: HealthBadge;
  column: string;
  onOpen: (view: string | null) => void;
}) {
  return (
    <Tooltip content={badge.detail}>
      <button
        type="button"
        onClick={() => onOpen(badge.view ?? null)}
        aria-label={`${badge.label} in ${column}: ${badge.view ? "show the rows" : "open the File report"}`}
        className="max-w-full rounded-full transition-opacity duration-fast hover:opacity-80 focus-visible:focus-ring"
      >
        {/* Only a problem is coloured; what is merely worth knowing stays quiet. */}
        <Badge tone={badge.tone === "warning" ? "warning" : "neutral"} className="tabular">
          {badge.label}
        </Badge>
      </button>
    </Tooltip>
  );
}

/** Counts of what a column feeds, the names on hover; "Not used" when nothing reads it. */
export function FeedsBadges({ use }: { use: ColumnUse | undefined }) {
  if (!use || (!use.kpis.length && !use.charts.length && !use.filters.length))
    return <span className="text-xs text-fg-subtle">Not used</span>;
  const parts: Array<{ label: string; names: string[] }> = [];
  if (use.kpis.length)
    parts.push({ label: use.kpis.length === 1 ? "1 KPI" : `${use.kpis.length} KPIs`, names: use.kpis });
  if (use.charts.length)
    parts.push({
      label: use.charts.length === 1 ? "1 chart" : `${use.charts.length} charts`,
      names: use.charts,
    });
  if (use.filters.length) parts.push({ label: use.filters.join(", "), names: [] });
  return (
    <div className="flex flex-wrap gap-1">
      {parts.map((p) =>
        p.names.length ? (
          <Tooltip key={p.label} content={p.names.join(" · ")}>
            <button
              type="button"
              className="rounded-full focus-visible:focus-ring"
              aria-label={`${p.label}: ${p.names.join(", ")}`}
            >
              <Badge tone="outline">{p.label}</Badge>
            </button>
          </Tooltip>
        ) : (
          <Badge key={p.label} tone="outline">
            {p.label}
          </Badge>
        ),
      )}
    </div>
  );
}

/** The column's name with a few of its values under it, as written. */
export function NameCell({ row, className }: { row: ReviewRow; className?: string }) {
  const off = row.status === "hidden";
  const c = row.column;
  const examples = c.examples.slice(0, 3).join(", ");
  return (
    <span className={cn("block min-w-0", className)}>
      <span className="flex min-w-0 items-center gap-2">
        <ClampText className={cn("text-ui font-medium", off ? "text-fg-subtle" : "text-fg")}>
          {c.name}
        </ClampText>
        {off ? (
          <Badge tone="neutral" className="shrink-0">
            Hidden
          </Badge>
        ) : null}
      </span>
      {examples ? (
        <ClampText className="font-data mt-0.5 text-xs text-fg-subtle">{examples}</ClampText>
      ) : null}
    </span>
  );
}
