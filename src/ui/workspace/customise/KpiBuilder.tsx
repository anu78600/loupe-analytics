"use client";

/**
 * "Build a KPI": a dialog that makes a KPI from the user's columns, either
 * one aggregate (a total, average, lowest, highest, median, distinct count
 * or number of rows) or a ratio of two (a ratio of totals, such as profit ÷
 * revenue). The name, number format and whether higher is better default
 * sensibly from the columns and can all be changed; a new KPI goes straight
 * into the headline row or the supporting tiles, or stays off the dashboard
 * until placed. Saved through the store (saveCustomKpi), so the engine
 * builds it like any template KPI (engine/kpi/userKpis.ts), SQL and DAX
 * included.
 */
import * as React from "react";
import { Divide } from "lucide-react";
import type { ColumnProfile } from "@/engine/profile/types";
import type { KpiFormat } from "@/registry/schema";
import {
  aggregateLabel,
  ratioLabel,
  slugOf,
  USER_KPI_PREFIX,
  type UserAgg,
  type UserAggregate,
  type UserKpi,
} from "@/engine/kpi/userKpis";
import { MAX_HEADLINE, kpiLayoutOf, useWorkspace } from "@/store/workspace";
import { Button } from "@/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/primitives/dialog";
import { Input, Label } from "@/ui/primitives/input";
import { Segmented } from "@/ui/primitives/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitives/select";

const AGGS: Array<{ id: UserAgg; label: string }> = [
  { id: "sum", label: "Total" },
  { id: "avg", label: "Average" },
  { id: "median", label: "Median" },
  { id: "min", label: "Lowest" },
  { id: "max", label: "Highest" },
  { id: "countDistinct", label: "Distinct count" },
  { id: "count", label: "Number of rows" },
];
const NUMERIC_AGGS: ReadonlySet<UserAgg> = new Set(["sum", "avg", "median", "min", "max"]);
const FORMATS: Array<{ id: KpiFormat; label: string }> = [
  { id: "currency", label: "Money" },
  { id: "number", label: "Number" },
  { id: "integer", label: "Whole number" },
  { id: "decimal", label: "Decimal" },
  { id: "percent", label: "Percentage" },
  { id: "ratio", label: "Ratio (×)" },
];
const NONE = "__none__";

/** The format a single aggregate reads in: money stays money, counts are whole numbers. */
function formatOf(a: UserAggregate, cols: ColumnProfile[]): KpiFormat {
  if (a.agg === "count" || a.agg === "countDistinct") return "integer";
  const c = cols.find((x) => x.name === a.column);
  if (c?.role === "currency") return "currency";
  if (c?.role === "percentage") return c.percentScale === 1 ? "percent" : "decimal";
  if (a.agg === "avg" || a.agg === "median") return "decimal";
  return c?.numeric?.integer ? "integer" : "number";
}

/** A ratio's natural format: money per count is money; like over like is a percentage; otherwise a decimal. */
function ratioFormat(top: KpiFormat, bottom: KpiFormat): KpiFormat {
  if (top === "currency" && bottom === "integer") return "currency";
  if (top === bottom && (top === "currency" || top === "number")) return "percent";
  return "decimal";
}

export function KpiBuilder({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: UserKpi | null;
}) {
  const context = useWorkspace((s) => s.context);
  const customKpis = useWorkspace((s) => s.customKpis);
  const saveCustomKpi = useWorkspace((s) => s.saveCustomKpi);
  const cols = React.useMemo(() => context?.profile.columns ?? [], [context]);
  const numeric = cols.filter((c) => c.storage === "number");
  const [ratio, setRatio] = React.useState(Boolean(editing?.per));
  const [value, setValue] = React.useState<UserAggregate>(
    editing?.value ?? { agg: numeric.length ? "sum" : "count", column: numeric[0]?.name ?? null },
  );
  const [per, setPer] = React.useState<UserAggregate>(editing?.per ?? { agg: "count", column: null });
  const [name, setName] = React.useState(editing?.name ?? "");
  const [format, setFormat] = React.useState<KpiFormat | "auto">(editing?.format ?? "auto");
  const [direction, setDirection] = React.useState<UserKpi["direction"]>(editing?.direction ?? "higher");
  const [place, setPlace] = React.useState<"hero" | "supporting" | "none">("supporting");
  const [saving, setSaving] = React.useState(false);
  if (!context) return null;

  const autoName = ratio ? ratioLabel(value, per) : aggregateLabel(value);
  const autoFormat = ratio ? ratioFormat(formatOf(value, cols), formatOf(per, cols)) : formatOf(value, cols);
  const ready = (a: UserAggregate) => a.agg === "count" || Boolean(a.column);
  const heroFull = kpiLayoutOf(useWorkspace.getState()).hero.length >= MAX_HEADLINE;

  const save = async () => {
    const finalName = name.trim() || autoName;
    let id = editing?.id;
    if (!id) {
      const base = `${USER_KPI_PREFIX}${slugOf(finalName)}`;
      id = base;
      for (let n = 2; customKpis.some((k) => k.id === id); n++) id = `${base}_${n}`;
    }
    setSaving(true);
    try {
      await saveCustomKpi(
        {
          id,
          name: finalName,
          value,
          ...(ratio ? { per } : {}),
          format: format === "auto" ? autoFormat : format,
          direction,
        },
        place === "none" ? "none" : place,
      );
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit “${editing.name}”` : "Build a KPI"}</DialogTitle>
          <DialogDescription>
            Computed from your columns over the rows in view, with its SQL and DAX written for you.
          </DialogDescription>
        </DialogHeader>
        <Segmented<"one" | "ratio">
          ariaLabel="Kind of KPI"
          value={ratio ? "ratio" : "one"}
          onChange={(v) => setRatio(v === "ratio")}
          options={[
            { value: "one", label: "One measure" },
            { value: "ratio", label: "Ratio of two" },
          ]}
        />
        <AggregatePicker
          label={ratio ? "Top: what to divide" : "What to measure"}
          value={value}
          onChange={setValue}
          cols={cols}
        />
        {ratio ? (
          <>
            <p className="flex items-center gap-2 text-xs text-fg-subtle">
              <Divide className="size-3.5" aria-hidden /> divided by (a ratio of totals, not an average of row
              ratios)
            </p>
            <AggregatePicker label="Bottom: what to divide by" value={per} onChange={setPer} cols={cols} />
          </>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="kpi-name">Name</Label>
          <Input
            id="kpi-name"
            value={name}
            placeholder={autoName}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Shown as</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as KpiFormat | "auto")}>
              <SelectTrigger aria-label="Number format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  Automatic ({FORMATS.find((f) => f.id === autoFormat)?.label.toLowerCase()})
                </SelectItem>
                {FORMATS.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>A rise is</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as UserKpi["direction"])}>
              <SelectTrigger aria-label="Whether higher is better">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="higher">Good (higher is better)</SelectItem>
                <SelectItem value="lower">Bad (lower is better)</SelectItem>
                <SelectItem value="neutral">Neither</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {editing ? null : (
          <div className="grid gap-1.5">
            <Label>Put it</Label>
            <Segmented<"hero" | "supporting" | "none">
              ariaLabel="Where the new KPI goes"
              value={place}
              onChange={setPlace}
              options={[
                {
                  value: "hero",
                  label: "Headline row",
                  title: heroFull ? `Full: it goes to Supporting until a headline place is free` : undefined,
                },
                { value: "supporting", label: "Supporting" },
                { value: "none", label: "Not yet" },
              ]}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ready(value) || (ratio && !ready(per)) || saving}
            onClick={() => void save()}
          >
            {editing ? "Save changes" : "Add KPI"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** An aggregation and the column it reads (numeric columns for totals and averages; any for distinct counts). */
function AggregatePicker({
  label,
  value,
  onChange,
  cols,
}: {
  label: string;
  value: UserAggregate;
  onChange: (a: UserAggregate) => void;
  cols: ColumnProfile[];
}) {
  const options =
    value.agg === "count"
      ? []
      : NUMERIC_AGGS.has(value.agg)
        ? cols.filter((c) => c.storage === "number")
        : cols;
  const setAgg = (agg: UserAgg) => {
    if (agg === "count") return onChange({ agg, column: null });
    const fits = (name: string | null) =>
      Boolean(name) && (!NUMERIC_AGGS.has(agg) || cols.find((c) => c.name === name)?.storage === "number");
    const column = fits(value.column)
      ? value.column
      : ((NUMERIC_AGGS.has(agg) ? cols.find((c) => c.storage === "number") : cols[0])?.name ?? null);
    onChange({ agg, column });
  };
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-ui font-medium text-fg-muted">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
        <Select value={value.agg} onValueChange={(v) => setAgg(v as UserAgg)}>
          <SelectTrigger aria-label={`${label}: aggregation`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGGS.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {value.agg === "count" ? (
          <p className="self-center text-xs text-fg-subtle">Counts every row in view.</p>
        ) : (
          <Select
            value={value.column ?? NONE}
            onValueChange={(v) => onChange({ ...value, column: v === NONE ? null : v })}
          >
            <SelectTrigger aria-label={`${label}: column`}>
              <SelectValue placeholder="Choose a column" />
            </SelectTrigger>
            <SelectContent>
              {options.length ? null : (
                <SelectItem value={NONE} disabled>
                  No numeric columns
                </SelectItem>
              )}
              {options.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </fieldset>
  );
}
