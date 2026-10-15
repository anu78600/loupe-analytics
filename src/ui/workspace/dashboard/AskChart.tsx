"use client";

/**
 * "Ask for a chart" and "Your charts", one dialog opened from the dashboard
 * header.
 *
 * Ask: the user types what they want ("average customer rating by city",
 * "total sales and total profit by month") or clicks an example built from
 * their own columns. engine/charts/ask reads it into measures, a "by" and an
 * optional split, which stay editable here (pick another column, change the
 * aggregation, the chart type or top N). The designed chart(s) preview live
 * with the dashboard's filters, each with the reason for its type and every
 * choice made on the user's behalf, then "Add to dashboard" adds them as
 * custom charts. Nothing is added until the user asks.
 *
 * Your charts: every chart on the dashboard with a switch to show or hide
 * it, and Remove for charts the user added.
 *
 * With `edit`, the panel opens on that chart's picks: an added chart is
 * replaced in place, a recommended one gets a changed copy (the original
 * stays).
 */
import * as React from "react";
import { CornerDownLeft, MessageSquarePlus, Plus, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  askExamples,
  askFromSpec,
  defaultAgg,
  designAsk,
  readAsk,
  type AskAgg,
  type AskBy,
  type AskContext,
  type AskMeasure,
  type AskReading,
  type ChartAsk,
} from "@/engine/charts/ask";
import type { ChartData, ChartKind, ChartSpec } from "@/engine/charts/types";
import type { ColumnProfile } from "@/engine/profile/types";
import { allSpecs, useWorkspace } from "@/store/workspace";
import { engine } from "@/lib/engine-client";
import { useFmt, useThemeKey } from "@/ui/common/hooks";
import { EChart } from "@/ui/charts/EChart";
import { DataTable } from "@/ui/charts/DataTable";
import { buildOption, rendersWithECharts } from "@/ui/charts/options";
import { readChartTokens } from "@/ui/charts/tokens";
import { KIND_LABEL } from "@/ui/charts/ChartCard";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Input, Label } from "@/ui/primitives/input";
import { Skeleton } from "@/ui/primitives/misc";
import { Switch } from "@/ui/primitives/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/ui/primitives/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/primitives/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/primitives/dialog";

const AGG_NAME: Record<AskAgg, string> = {
  sum: "Total",
  avg: "Average",
  median: "Median",
  min: "Lowest",
  max: "Highest",
  count: "Rows",
  countDistinct: "Distinct count",
};

/** Chart types offered in the picker; the designer checks each against the data. */
const KINDS: ChartKind[] = [
  "hbar",
  "bar",
  "line",
  "area",
  "stackedBar",
  "donut",
  "treemap",
  "heatmap",
  "scatter",
  "geoTile",
  "table",
];

const isNumericMeasure = (c: ColumnProfile) =>
  c.storage === "number" && c.role !== "identifier" && c.role !== "dimension";

/** Columns that can be a category ("by" or split). */
const isCategory = (c: ColumnProfile) =>
  (c.storage === "string" || c.storage === "boolean" || (c.storage === "number" && c.role === "dimension")) &&
  c.role !== "text" &&
  c.distinct >= 2;

export function AskChartDialog({
  open,
  onOpenChange,
  initialTab = "ask",
  edit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: "ask" | "charts";
  /** A chart to change instead of starting from a blank question. */
  edit?: ChartSpec;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Your charts</DialogTitle>
          <DialogDescription>
            Ask for a chart in your own words, or choose which charts to keep. Everything is computed from
            your columns.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed on open so each opening starts from the requested tab with a fresh question. */}
        {open ? (
          <Tabs defaultValue={initialTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="ask">
                <Sparkles aria-hidden /> Ask for a chart
              </TabsTrigger>
              <TabsTrigger value="charts">Keep or remove charts</TabsTrigger>
            </TabsList>
            <TabsContent value="ask">
              <AskPanel edit={edit} onDone={() => onOpenChange(false)} />
            </TabsContent>
            <TabsContent value="charts">
              <ManageCharts />
            </TabsContent>
          </Tabs>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** The dashboard-header button that opens the dialog. */
export function AskChartButton() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <MessageSquarePlus aria-hidden /> Ask for a chart
      </Button>
      <AskChartDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

// ---------------------------------------------------------------- ask

function AskPanel({ onDone, edit }: { onDone: () => void; edit?: ChartSpec }) {
  const context = useWorkspace((s) => s.context);
  const addCustomChart = useWorkspace((s) => s.addCustomChart);
  const focusChart = useWorkspace((s) => s.focusChart);
  const [text, setText] = React.useState("");
  const [reading, setReading] = React.useState<AskReading | null>(null);
  const [ask, setAsk] = React.useState<ChartAsk | null>(() => (edit ? askFromSpec(edit) : null));
  const replacing = edit?.source === "custom";
  const actx = context as AskContext | null;
  const examples = React.useMemo(() => (actx ? askExamples(actx) : []), [actx]);
  // Preview ids are fixed; real ids are made when the charts are added.
  const design = React.useMemo(() => {
    if (!actx || !ask) return null;
    let i = 0;
    return designAsk(ask, actx, () => `ask_preview_${i++}`);
  }, [actx, ask]);
  if (!actx) return null;

  const run = (phrase: string) => {
    const r = readAsk(phrase, actx);
    setText(phrase);
    setReading(r);
    setAsk(r.ask);
  };
  const add = () => {
    if (!ask) return;
    // Fresh ids at the moment of adding (an event handler, so the clock may be read).
    const base = Date.now().toString(36);
    let i = 0;
    const out = designAsk(ask, actx, () => `custom_${base}_${i++}`);
    const [first, ...rest] = out.charts;
    if (replacing && edit && first) {
      // The changed chart keeps its place and id; any extra chart (another unit) is added after it.
      const spec = { ...first.spec, id: edit.id };
      useWorkspace.setState((s) => ({
        customCharts: s.customCharts.map((c) => (c.id === edit.id ? spec : c)),
      }));
      useWorkspace.getState().refresh();
      for (const c of rest) addCustomChart(c.spec);
    } else for (const c of out.charts) addCustomChart(c.spec);
    const last =
      replacing && edit && !rest.length ? { spec: { id: edit.id } } : out.charts[out.charts.length - 1];
    toast.success(
      replacing
        ? "Chart updated"
        : out.charts.length === 1
          ? "Chart added to the dashboard"
          : `${out.charts.length} charts added to the dashboard`,
    );
    onDone();
    if (last) setTimeout(() => focusChart(last.spec.id), 200);
  };

  return (
    <div className="grid gap-5">
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) run(text);
        }}
      >
        <Label htmlFor="ask-input">What do you want to see?</Label>
        <div className="flex gap-2">
          <Input
            id="ask-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. average customer rating by city, or total sales and total profit by month"
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" variant="primary" disabled={!text.trim()}>
            <CornerDownLeft aria-hidden /> Design it
          </Button>
        </div>
        {examples.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-2xs text-fg-subtle">From your columns:</span>
            {examples.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => run(e)}
                className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-2xs text-fg-muted transition-colors hover:border-border-accent hover:text-fg focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none"
              >
                {e}
              </button>
            ))}
          </div>
        ) : null}
      </form>

      {reading ? (
        <div
          className="grid gap-1.5 rounded-card border border-border bg-surface-2 px-4 py-3 text-ui"
          aria-live="polite"
        >
          <p className="text-fg">
            <span className="text-fg-muted">Understood: </span>
            {reading.understood}
          </p>
          {reading.unmatched.length ? (
            <p className="text-warning">
              Not found in your file: {reading.unmatched.map((u) => `"${u}"`).join(", ")}. Pick the column
              below instead.
            </p>
          ) : null}
          {reading.notes.map((n) => (
            <p key={n} className="text-2xs leading-relaxed text-fg-muted">
              {n}
            </p>
          ))}
        </div>
      ) : null}

      <AskEditor ask={ask ?? { measures: [], by: { kind: "none" } }} ctx={actx} onChange={setAsk} />

      {design ? (
        <div className="grid gap-3">
          {design.error ? <p className="text-ui text-fg-muted">{design.error}</p> : null}
          {design.notes.map((n) => (
            <p key={n} className="text-2xs leading-relaxed text-fg-muted">
              {n}
            </p>
          ))}
          <div className="grid gap-3 md:grid-cols-2">
            {design.charts.map((c) => (
              <ChartPreview
                key={c.spec.id + JSON.stringify(c.spec.measures) + c.spec.kind}
                spec={c.spec}
                why={c.why}
              />
            ))}
          </div>
          {design.charts.length ? (
            <div className="flex justify-end">
              <Button variant="primary" onClick={add}>
                <Plus aria-hidden />{" "}
                {replacing
                  ? "Update chart"
                  : `Add ${design.charts.length === 1 ? "chart" : `${design.charts.length} charts`} to dashboard`}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The ask as editable picks: measures (with aggregation), by, split, chart type and top N. */
function AskEditor({
  ask,
  ctx,
  onChange,
}: {
  ask: ChartAsk;
  ctx: AskContext;
  onChange: (a: ChartAsk) => void;
}) {
  const columns = ctx.profile.columns;
  const kpis = ctx.kpis.filter((k) => k.available && !k.hidden);
  const date = ctx.dateColumn ? columns.find((c) => c.name === ctx.dateColumn) : undefined;
  const timeCol = columns.find((c) => c.role === "time");
  const hourColumn = timeCol?.name ?? (date?.temporal?.hasTime ? date.name : undefined);
  const categories = columns.filter(isCategory);

  const measureValue = (m: AskMeasure) =>
    m.kind === "kpi" ? `kpi:${m.id}` : m.agg === "count" ? "rows" : `col:${m.column}`;
  const setMeasure = (i: number, value: string) => {
    const next = [...ask.measures];
    if (value.startsWith("kpi:")) next[i] = { kind: "kpi", id: value.slice(4) };
    else if (value === "rows") next[i] = { kind: "column", column: "", agg: "count" };
    else {
      const c = columns.find((x) => x.name === value.slice(4));
      if (c) next[i] = { kind: "column", column: c.name, agg: defaultAgg(c) };
    }
    onChange({ ...ask, measures: next });
  };
  const byValue = (b: AskBy) =>
    b.kind === "none"
      ? "none"
      : b.kind === "time"
        ? `time:${b.grain}`
        : b.kind === "part"
          ? `part:${b.part}`
          : `col:${b.column}`;
  const setBy = (v: string) => {
    let by: AskBy = { kind: "none" };
    if (v.startsWith("time:") && date) by = { kind: "time", column: date.name, grain: v.slice(5) as never };
    else if (v === "part:hour" && hourColumn) by = { kind: "part", column: hourColumn, part: "hour" };
    else if (v.startsWith("part:") && date)
      by = { kind: "part", column: date.name, part: v.slice(5) as never };
    else if (v.startsWith("col:")) by = { kind: "column", column: v.slice(4) };
    onChange({ ...ask, by });
  };

  return (
    <fieldset className="grid gap-4 rounded-card border border-border p-4">
      <legend className="px-1 text-2xs font-medium tracking-[0.12em] text-fg-subtle uppercase">
        Your picks
      </legend>
      <div className="grid gap-2">
        <Label>Measure</Label>
        {ask.measures.map((m, i) => {
          const c =
            m.kind === "column" && m.agg !== "count" ? columns.find((x) => x.name === m.column) : undefined;
          return (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select value={measureValue(m)} onValueChange={(v) => setMeasure(i, v)}>
                <SelectTrigger size="sm" className="w-64" aria-label={`Measure ${i + 1}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>KPIs</SelectLabel>
                    {kpis.map((k) => (
                      <SelectItem key={k.id} value={`kpi:${k.id}`}>
                        {k.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>Your columns</SelectLabel>
                    <SelectItem value="rows">Rows (count)</SelectItem>
                    {columns
                      .filter((x) => x.role !== "datetime" && x.role !== "time")
                      .map((x) => (
                        <SelectItem key={x.name} value={`col:${x.name}`} hint={x.role}>
                          {x.name}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {c && m.kind === "column" ? (
                <Select
                  value={m.agg}
                  onValueChange={(v) => {
                    const next = [...ask.measures];
                    next[i] = { ...m, agg: v as AskAgg };
                    onChange({ ...ask, measures: next });
                  }}
                >
                  <SelectTrigger size="sm" className="w-40" aria-label={`How to combine ${c.name}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(isNumericMeasure(c)
                      ? (["sum", "avg", "median", "min", "max", "countDistinct"] as AskAgg[])
                      : (["countDistinct"] as AskAgg[])
                    )
                      .filter(
                        (a) =>
                          !(
                            a === "sum" &&
                            (c.role === "rate" || c.role === "percentage" || c.additivity === "non-additive")
                          ),
                      )
                      .map((a) => (
                        <SelectItem key={a} value={a}>
                          {AGG_NAME[a]}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove measure ${i + 1}`}
                onClick={() => onChange({ ...ask, measures: ask.measures.filter((_, j) => j !== i) })}
              >
                <X aria-hidden />
              </Button>
            </div>
          );
        })}
        {ask.measures.length < 4 ? (
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onChange({
                  ...ask,
                  measures: [
                    ...ask.measures,
                    kpis[0] ? { kind: "kpi", id: kpis[0].id } : { kind: "column", column: "", agg: "count" },
                  ],
                })
              }
            >
              <Plus aria-hidden /> Add a measure
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor="ask-by">By</Label>
          <Select value={byValue(ask.by)} onValueChange={setBy}>
            <SelectTrigger id="ask-by" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Choose for me</SelectItem>
              {date ? (
                <SelectGroup>
                  <SelectLabel>Time ({date.name})</SelectLabel>
                  <SelectItem value="time:auto">Over time</SelectItem>
                  <SelectItem value="time:day">By day</SelectItem>
                  <SelectItem value="time:week">By week</SelectItem>
                  <SelectItem value="time:month">By month</SelectItem>
                  <SelectItem value="time:quarter">By quarter</SelectItem>
                  <SelectItem value="time:year">By year</SelectItem>
                  <SelectItem value="part:dow">By weekday</SelectItem>
                  <SelectItem value="part:month">By month of year</SelectItem>
                </SelectGroup>
              ) : null}
              {hourColumn ? <SelectItem value="part:hour">By hour of day ({hourColumn})</SelectItem> : null}
              <SelectGroup>
                <SelectLabel>Your categories</SelectLabel>
                {categories.map((c) => (
                  <SelectItem key={c.name} value={`col:${c.name}`} hint={`${c.distinct}`}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ask-split">Split by</Label>
          <Select
            value={ask.split ?? "none"}
            onValueChange={(v) => {
              const { split: _drop, ...rest } = ask;
              void _drop;
              onChange(v === "none" ? rest : { ...rest, split: v });
            }}
          >
            <SelectTrigger id="ask-split" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No split</SelectItem>
              {categories
                .filter((c) => c.distinct <= 30)
                .map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ask-kind">Chart type</Label>
          <Select
            value={ask.kind ?? "auto"}
            onValueChange={(v) => {
              const { kind: _drop, ...rest } = ask;
              void _drop;
              onChange(v === "auto" ? rest : { ...rest, kind: v as ChartKind });
            }}
          >
            <SelectTrigger id="ask-kind" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Recommended</SelectItem>
              {KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ask-top">Show</Label>
          <Select value={String(ask.topN ?? 10)} onValueChange={(v) => onChange({ ...ask, topN: Number(v) })}>
            <SelectTrigger id="ask-top" size="sm" disabled={ask.by.kind !== "column"}>
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
      </div>
    </fieldset>
  );
}

/** One designed chart computed with the dashboard's filters, drawn small, with the reason for its type. */
function ChartPreview({ spec, why }: { spec: ChartSpec; why: string }) {
  const fmt = useFmt();
  const themeKey = useThemeKey();
  const [data, setData] = React.useState<ChartData | null | undefined>(undefined);
  React.useEffect(() => {
    let live = true;
    const filters = useWorkspace.getState().filters();
    engine()
      .previewChart(filters, { specId: spec.id, spec }, fmt.locale)
      .then((d) => {
        if (live) setData(d);
      })
      .catch(() => {
        if (live) setData(null);
      });
    return () => {
      live = false;
    };
  }, [spec, fmt.locale]);
  const option = React.useMemo(() => {
    void themeKey;
    if (!data || data.empty || !rendersWithECharts(spec.kind, data)) return null;
    return buildOption({ tokens: readChartTokens(), fmt, kind: spec.kind, spec, data, animate: false });
  }, [data, spec, fmt, themeKey]);
  return (
    <figure className="grid gap-2 rounded-card border border-border bg-surface-1 p-3">
      <figcaption className="flex items-start justify-between gap-2">
        <span className="text-ui font-medium text-fg">{spec.title}</span>
        <Badge tone="outline">{KIND_LABEL[spec.kind]}</Badge>
      </figcaption>
      {data === undefined ? (
        <Skeleton className="h-52 w-full" />
      ) : !data || data.empty ? (
        <p className="grid h-52 place-items-center text-ui text-fg-muted">
          {data?.notes[0] ?? "No data for the current filters."}
        </p>
      ) : option ? (
        <EChart
          option={option}
          resetKey={`${spec.kind}:${spec.id}`}
          ariaLabel={spec.title}
          className="h-52 w-full"
        />
      ) : (
        <DataTable spec={spec} data={data} fmt={fmt} maxRows={8} className="max-h-52 overflow-auto" />
      )}
      <p className="text-2xs leading-relaxed text-fg-muted">{why}</p>
      {data?.notes.map((n) => (
        <p key={n} className="text-2xs leading-relaxed text-fg-subtle">
          {n}
        </p>
      ))}
    </figure>
  );
}

// ---------------------------------------------------------------- keep or remove

function ManageCharts() {
  const context = useWorkspace((s) => s.context);
  const customCharts = useWorkspace((s) => s.customCharts);
  const widgets = useWorkspace((s) => s.widgets);
  const mode = useWorkspace((s) => s.mode);
  const updateWidget = useWorkspace((s) => s.updateWidget);
  const removeChart = useWorkspace((s) => s.removeChart);
  if (!context) return null;
  const specs = allSpecs({ context, customCharts });
  const byId = new Map(specs.map((s) => [s.id, s]));
  const rows = widgets
    .map((w) => ({ w, spec: byId.get(w.id) }))
    .filter((r): r is { w: typeof r.w; spec: ChartSpec } => Boolean(r.spec));
  const shown = rows.filter((r) => !r.w.hidden).length;
  return (
    <div className="grid gap-3">
      <p className="text-ui text-fg-muted">
        {shown} of {rows.length} charts shown. Hidden charts keep their settings; switch them back on any
        time.
      </p>
      <ul className="max-h-[52vh] divide-y divide-border overflow-y-auto rounded-card border border-border">
        {rows.map(({ w, spec }) => {
          const custom = spec.source === "custom";
          const inMode = spec.modes.includes(mode);
          return (
            <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-ui text-fg">{spec.title}</p>
                <p className="text-2xs text-fg-subtle">
                  {KIND_LABEL[w.kind ?? spec.kind]}
                  {custom
                    ? " · added by you"
                    : spec.section === "columns"
                      ? " · from your other columns"
                      : ""}
                  {inMode ? "" : ` · not in ${mode} layout`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  checked={!w.hidden}
                  onCheckedChange={(on) => updateWidget(w.id, { hidden: !on })}
                  aria-label={`Show ${spec.title}`}
                />
                {custom ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${spec.title}`}
                    onClick={() => removeChart(w.id)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
