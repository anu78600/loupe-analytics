"use client";

/**
 * Right-hand inspector: details for the selected chart (why this chart,
 * alternatives, Top-N) and the chart builder, which creates custom charts from
 * any KPI or from an ad-hoc aggregate of any column (`agg:<fn>:<column>`),
 * offering only chart types that suit the data.
 */
import * as React from "react";
import { MessageSquarePlus, Plus } from "lucide-react";
import type { ChartKind, ChartMeasure, ChartSpec, ResolvedAxis } from "@/engine/charts/types";
import { aggMeasureLabel, customSpec, isKindCompatible } from "@/engine/charts/recommend";
import type { ColumnProfile } from "@/engine/profile/types";
import type { KpiFormat } from "@/registry/schema";
import { formatCount } from "@/engine/core/format";
import { allSpecs, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Input, Label } from "@/ui/primitives/input";
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
import { Eyebrow } from "@/ui/primitives/misc";
import { KIND_LABEL } from "@/ui/charts/ChartCard";
import { KpiDetails } from "./KpiDetails";
import { AskChartDialog } from "./AskChart";
import { askFromSpec } from "@/engine/charts/ask";
import { kpiLabel } from "@/engine/core/labels";

// Lowest and Highest, never Min and Max (the analyst standards' words).
const AGGS = [
  { id: "sum", label: "Sum" },
  { id: "avg", label: "Average" },
  { id: "median", label: "Median" },
  { id: "min", label: "Lowest" },
  { id: "max", label: "Highest" },
  { id: "countDistinct", label: "Count distinct" },
  { id: "count", label: "Count rows" },
] as const;

const KINDS: ChartKind[] = [
  "line",
  "area",
  "bar",
  "hbar",
  "stackedBar",
  "donut",
  "treemap",
  "scatter",
  "histogram",
  "heatmap",
  "pareto",
  "geoTile",
  "table",
];

/** Unique id for a user-built chart; called from the submit handler, never during render. */
function newCustomChartId(): string {
  return `custom_${Date.now().toString(36)}`;
}

/**
 * The inspector's content. It lives in the dashboard's side sheet, whose own
 * close button closes it; a second close here used to clear the selection
 * only, leaving the sheet open on the chart builder.
 */
export function Inspector() {
  const selected = useWorkspace((s) => s.selected);
  return (
    <div className="grid gap-4">
      <Eyebrow>
        {selected?.type === "kpi" ? "KPI" : selected?.type === "chart" ? "Chart" : "Build a chart"}
      </Eyebrow>
      {selected?.type === "kpi" ? (
        <KpiDetails kpiId={selected.id} />
      ) : selected?.type === "chart" ? (
        <ChartInspector id={selected.id} />
      ) : (
        <ChartBuilder />
      )}
    </div>
  );
}

function ChartInspector({ id }: { id: string }) {
  const spec = useWorkspace((s) => allSpecs(s).find((x) => x.id === id));
  const data = useWorkspace((s) => s.charts[id]);
  // The kind the card is drawn as: the one picked in its switcher, else the recommended one.
  const drawnKind = useWorkspace((s) => s.widgets.find((w) => w.id === id)?.kind);
  const locale = useSettings((s) => s.numberLocale);
  if (!spec) return <p className="text-ui text-fg-muted">This chart is no longer available.</p>;
  const kind = drawnKind ?? spec.kind;
  return (
    <div className="grid gap-4">
      <div>
        <h3 className="text-lg font-semibold text-fg">{spec.title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-fg-muted">{spec.reason}</p>
      </div>
      <dl className="grid gap-2 text-ui">
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">Type</dt>
          <dd className="text-fg">
            {KIND_LABEL[kind]}
            {kind !== spec.kind ? (
              <span className="ml-1.5 text-xs text-fg-subtle">(recommended: {KIND_LABEL[spec.kind]})</span>
            ) : null}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">X axis</dt>
          <dd className="truncate text-fg">{spec.x.kind === "none" ? "—" : spec.x.label}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">Measures</dt>
          <dd className="truncate text-right text-fg">{spec.measures.map((m) => m.label).join(", ")}</dd>
        </div>
        {data ? (
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">Rows in view</dt>
            <dd className="tabular text-fg">{formatCount(data.totalRows, locale)}</dd>
          </div>
        ) : null}
      </dl>
      {data?.notes.length ? (
        <ul className="grid gap-1 rounded-control border border-border bg-surface-2 p-3 text-xs leading-relaxed text-fg-muted">
          {data.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      <div className="border-t border-border pt-4">
        <p className="mb-3 text-sm font-medium text-fg">
          {spec.source === "custom" ? "Edit this chart" : "Customise a copy"}
        </p>
        {/* The builder edits one measure; charts with several (or asked in words) change in the Ask panel. */}
        {(spec.measures.length > 1 || spec.reason.endsWith("Asked by you.")) && askFromSpec(spec) ? (
          <ChangeWithAsk spec={spec} />
        ) : (
          <ChartBuilder key={spec.id} base={spec} />
        )}
      </div>
    </div>
  );
}

/** Opens "Ask for a chart" on this chart's picks: an added chart is updated, a recommended one copied. */
function ChangeWithAsk({ spec }: { spec: ChartSpec }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="grid gap-2">
      <p className="text-xs leading-relaxed text-fg-muted">
        {spec.measures.length > 1
          ? `This chart shows ${spec.measures.length} measures; change any of them, or what they are shown by, in Ask for a chart.`
          : "Change the measure, what it is shown by, or the chart type in Ask for a chart."}
      </p>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <MessageSquarePlus aria-hidden /> {spec.source === "custom" ? "Change this chart" : "Change a copy"}
      </Button>
      <AskChartDialog open={open} onOpenChange={setOpen} edit={spec} />
    </div>
  );
}

function measureFromKpi(k: {
  id: string;
  name: string;
  short?: string;
  format: KpiFormat;
  direction: "higher" | "lower" | "neutral";
}): ChartMeasure {
  return { id: k.id, label: kpiLabel(k), format: k.format, direction: k.direction };
}

function aggMeasure(agg: string, col: ColumnProfile | undefined): ChartMeasure {
  const column = col?.name ?? "";
  // Named as the engine names the same aggregate ("Total Amount", "Lowest Price"), so a measure has one name.
  const label = aggMeasureLabel(agg, column);
  const format: KpiFormat =
    agg === "count" || agg === "countDistinct"
      ? "integer"
      : col?.role === "currency"
        ? "currency"
        : col?.role === "percentage" && col.percentScale === 1
          ? "percent"
          : "number";
  return { id: `agg:${agg}:${agg === "count" ? "" : column}`, label, format, direction: "neutral" };
}

function ChartBuilder({ base }: { base?: ChartSpec }) {
  const context = useWorkspace((s) => s.context);
  const addCustomChart = useWorkspace((s) => s.addCustomChart);
  const customCharts = useWorkspace((s) => s.customCharts);
  const columns = context?.profile.columns ?? [];
  const kpis = (context?.kpis ?? []).filter((k) => k.available && !k.hidden);
  const initialX =
    base && base.x.kind !== "none" && "column" in base.x
      ? base.x.column
      : (context?.dateColumn ?? columns.find((c) => c.role === "dimension")?.name ?? "");
  const [title, setTitle] = React.useState(
    base ? `${base.title}${base.source === "custom" ? "" : " (custom)"}` : "",
  );
  const [xCol, setXCol] = React.useState(initialX);
  const [grain, setGrain] = React.useState<"auto" | "day" | "week" | "month" | "quarter">("auto");
  // A column measure ("agg:avg:Rating") opens on "Aggregate a column…" with its column and aggregation.
  const baseAgg = /^agg:(sum|avg|median|min|max|countDistinct):(.+)$/.exec(base?.measures[0]?.id ?? "");
  const [measure, setMeasure] = React.useState<string>(
    baseAgg ? "__agg__" : (base?.measures[0]?.id ?? kpis[0]?.id ?? "agg:count:"),
  );
  const [aggCol, setAggCol] = React.useState<string>(
    baseAgg?.[2] ?? columns.find((c) => c.role === "currency" || c.role === "measure")?.name ?? "",
  );
  const [agg, setAgg] = React.useState<string>(baseAgg?.[1] ?? "sum");
  const [seriesCol, setSeriesCol] = React.useState<string>(
    base?.series && base.series.kind === "column" ? base.series.column : "",
  );
  const [topN, setTopN] = React.useState<number>(base?.topN ?? 10);
  const xProfile = columns.find((c) => c.name === xCol);

  // A time-of-day column has no calendar, so it groups by hour of day rather than over time.
  const x: ResolvedAxis = !xProfile
    ? { kind: "none" }
    : xProfile.role === "time"
      ? { kind: "part", column: xProfile.name, part: "hour", label: "Hour of day" }
      : xProfile.storage === "date"
        ? { kind: "time", column: xProfile.name, grain, label: xProfile.name }
        : xProfile.storage === "number" &&
            (xProfile.role === "measure" ||
              xProfile.role === "currency" ||
              xProfile.role === "rate" ||
              xProfile.role === "percentage")
          ? {
              kind: "bins",
              expr: { field: `col:${xProfile.name}` },
              count: 12,
              format:
                xProfile.role === "currency"
                  ? "currency"
                  : xProfile.role === "percentage" && xProfile.percentScale === 1
                    ? "percent"
                    : "number",
              label: `${xProfile.name} band`,
            }
          : { kind: "column", column: xProfile.name, label: xProfile.name };
  const series: ResolvedAxis | undefined = seriesCol
    ? { kind: "column", column: seriesCol, label: seriesCol }
    : undefined;
  const m: ChartMeasure =
    measure === "__agg__"
      ? aggMeasure(
          agg,
          columns.find((c) => c.name === aggCol),
        )
      : measureFromKpi(
          kpis.find((k) => k.id === measure) ?? {
            id: "agg:count:",
            name: "Rows",
            format: "integer",
            direction: "neutral",
          },
        );
  const draftBase = customSpec({
    id: "draft",
    title: title || "Custom chart",
    kind: "bar",
    x,
    series,
    measures: [m],
    topN,
    others: true,
  });
  const kinds = KINDS.filter((k) => isKindCompatible(k, draftBase));
  const [kind, setKind] = React.useState<ChartKind>(base?.kind ?? "bar");
  const effectiveKind = kinds.includes(kind) ? kind : (kinds[0] ?? "bar");

  const submit = () => {
    if (x.kind === "none") return;
    const id = base?.source === "custom" ? base.id : newCustomChartId();
    const spec = customSpec({
      id,
      title: title || `${m.label} by ${x.kind === "bins" ? x.label : x.label}`,
      kind: effectiveKind,
      x,
      series:
        effectiveKind === "heatmap" || effectiveKind === "stackedBar" || effectiveKind === "treemap"
          ? series
          : undefined,
      measures: [m],
      topN: x.kind === "column" ? topN : undefined,
      others: x.kind === "column",
    });
    if (base?.source === "custom") {
      useWorkspace.setState((s) => ({ customCharts: s.customCharts.map((c) => (c.id === id ? spec : c)) }));
      useWorkspace.getState().refresh();
    } else addCustomChart(spec);
  };

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="cb-title">Title</Label>
        <Input
          id="cb-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Optional"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cb-x">X axis / category</Label>
        <Select value={xCol} onValueChange={setXCol}>
          <SelectTrigger id="cb-x">
            <SelectValue placeholder="Choose a column" />
          </SelectTrigger>
          <SelectContent>
            {columns.map((c) => (
              <SelectItem
                key={c.name}
                value={c.name}
                hint={
                  c.role === "time"
                    ? "hour"
                    : c.storage === "date"
                      ? "time"
                      : c.storage === "number"
                        ? "bins"
                        : c.role
                }
              >
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {x.kind === "time" ? (
          <Select value={grain} onValueChange={(v) => setGrain(v as typeof grain)}>
            <SelectTrigger size="sm" aria-label="Time grain">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto grain</SelectItem>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="quarter">Quarter</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cb-measure">Measure</Label>
        <Select value={measure} onValueChange={setMeasure}>
          <SelectTrigger id="cb-measure">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>KPIs</SelectLabel>
              {kpis.map((k) => (
                <SelectItem key={k.id} value={k.id}>
                  {k.name}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectSeparator />
            <SelectItem value="__agg__">Aggregate a column…</SelectItem>
          </SelectContent>
        </Select>
        {measure === "__agg__" ? (
          <div className="grid grid-cols-2 gap-2">
            <Select value={agg} onValueChange={setAgg}>
              <SelectTrigger size="sm" aria-label="Aggregation">
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
            {agg !== "count" ? (
              <Select value={aggCol} onValueChange={setAggCol}>
                <SelectTrigger size="sm" aria-label="Column to aggregate">
                  <SelectValue placeholder="Column" />
                </SelectTrigger>
                <SelectContent>
                  {columns
                    .filter((c) => (agg === "countDistinct" ? true : c.storage === "number"))
                    .map((c) => (
                      <SelectItem key={c.name} value={c.name}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        ) : null}
        {measure === "__agg__" &&
        agg === "sum" &&
        ["rate", "percentage"].includes(columns.find((c) => c.name === aggCol)?.role ?? "") ? (
          <p className="text-xs text-warning">
            Summing a rate column is almost always wrong; prefer Average, or a KPI built from its parts.
          </p>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cb-series">Series / rows (optional)</Label>
        <Select
          value={seriesCol || "__none__"}
          onValueChange={(v) => setSeriesCol(v === "__none__" ? "" : v)}
        >
          <SelectTrigger id="cb-series">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {columns
              .filter((c) => c.storage === "string" && c.distinct <= 30 && c.name !== xCol)
              .map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="cb-kind">Chart type</Label>
          <Select value={effectiveKind} onValueChange={(v) => setKind(v as ChartKind)}>
            <SelectTrigger id="cb-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kinds.map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {x.kind === "column" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="cb-top">Top N</Label>
            <Select value={String(topN)} onValueChange={(v) => setTopN(Number(v))}>
              <SelectTrigger id="cb-top">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[5, 10, 15, 20, 30].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    Top {n} + Others
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      <Button type="submit" variant="primary" disabled={x.kind === "none"}>
        <Plus aria-hidden /> {base?.source === "custom" ? "Update chart" : "Add to dashboard"}
      </Button>
      {customCharts.length ? (
        <p className="text-xs text-fg-subtle">
          {customCharts.length} custom chart{customCharts.length > 1 ? "s" : ""} on this dashboard.{" "}
          <Badge>saved in config export</Badge>
        </p>
      ) : null}
    </form>
  );
}
