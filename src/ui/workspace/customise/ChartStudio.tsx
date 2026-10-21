"use client";

/**
 * The Customise step's chart builder ("Create a chart").
 *
 * On the left, the gallery: every chart type that can be built from columns
 * (engine/charts/catalogue.ts), grouped by the question it answers, each
 * with its two lines (what it shows, the data it suits best). A type the
 * file can't feed says what it needs (a date column, a second category, a
 * state column…).
 *
 * On the right, the builder for the chosen type, asking only for what that
 * type needs: the axis (dates with a grain or a part of the date, a
 * category, numeric bands, or nothing for a single figure), a second
 * category when it splits the measure, the measures (KPIs, or a column with
 * an aggregation), Top N, a goal, the title, section and size. The real
 * chart, computed by the engine under the dashboard's filters, previews
 * below; a combination the type can't draw says why instead.
 *
 * Editing a chart starts from it as its card shows it (type and Top N
 * included): the user's own chart is changed in place; a recommended chart
 * is saved as the user's copy, in the original's place, and the original
 * hidden. Only a title the user typed carries over (chartDraft.ts), so a
 * chart whose data changes is never left with the old chart's title.
 *
 * Below the xl breakpoint the builder sits under the gallery, so picking a
 * type brings it into view (and moves focus to it).
 *
 * Text is kept short: a type's card shows its name and (from sm up) what it
 * shows; the data it suits is behind its ⓘ, and the builder's notes are one
 * line with the full text behind hover, a long press or the ⓘ
 * (ui/primitives/reveal.tsx). What a type needs, when the file can't feed
 * it, stays in view.
 */
import * as React from "react";
import { toast } from "sonner";
import { Check, Plus, X } from "lucide-react";
import type { ChartKind, ChartSection, ChartSpec } from "@/engine/charts/types";
import { CHART_GROUPS, CHART_TYPES, chartType } from "@/engine/charts/catalogue";
import type { AskAgg, AskMeasure } from "@/engine/charts/ask";
import type { DatePart, TimeGrain } from "@/engine/core/dates";
import type { ColumnProfile } from "@/engine/profile/types";
import type { ContextResult } from "@/engine/session";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace";
import { Button } from "@/ui/primitives/button";
import { Card } from "@/ui/primitives/card";
import { Input, Label } from "@/ui/primitives/input";
import { Segmented } from "@/ui/primitives/segmented";
import { Brief, InfoTip } from "@/ui/primitives/reveal";
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
import {
  adapt,
  AGGS,
  buildSpec,
  DEFAULT_TOP,
  draftFromSpec,
  firstCategory,
  followSize,
  GRAINS,
  lower,
  missing,
  newDraft,
  PARTS,
  splitFor,
  startingMeasures,
  TOPNS,
  columnsOf,
  type Columns,
  type Draft,
} from "./chartDraft";
import { ChartPreview } from "../dashboard/AskChart";
import { SECTIONS } from "../dashboard/sections";
import { CHART_ICON } from "./chartIcons";

// ---------------------------------------------------------------- the component

export function ChartStudio({ editing, onDone }: { editing: ChartSpec | null; onDone: () => void }) {
  const context = useWorkspace((s) => s.context);
  const widget = useWorkspace((s) => (editing ? s.widgets.find((w) => w.id === editing.id) : undefined));
  const addCustomChart = useWorkspace((s) => s.addCustomChart);
  const cols = React.useMemo(() => (context ? columnsOf(context) : null), [context]);
  const [draft, setDraft] = React.useState<Draft | null>(() =>
    editing && context ? draftFromSpec(editing, widget, context) : null,
  );
  const key = draft ? JSON.stringify(draft) : "";
  // The preview spec only changes when the draft does, so the preview isn't recomputed on every render.
  const built = React.useMemo(
    () => (draft && context ? buildSpec(JSON.parse(key) as Draft, context, "studio_preview") : null),
    [key, context, draft],
  );
  const builder = React.useRef<HTMLElement>(null);
  if (!context || !cols) return null;

  const pick = (kind: ChartKind) => {
    setDraft((d) =>
      d && d.kind !== kind ? adapt(d, kind, context, cols) : (d ?? newDraft(kind, context, cols)),
    );
    // Beside the gallery (xl and up) the builder is already in view; below it, it sits under every
    // type, thousands of pixels down on a phone, so it is brought into view once it has rendered.
    if (window.matchMedia("(min-width: 1280px)").matches) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => {
      const el = builder.current;
      el?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
      el?.querySelector<HTMLElement>("[data-builder-heading]")?.focus({ preventScroll: true });
    });
  };

  // Every edit in the builder keeps the height following the number of bars, until the user sets one.
  const edit: React.Dispatch<React.SetStateAction<Draft>> = (action) =>
    setDraft((d) => (d ? followSize(d, typeof action === "function" ? action(d) : action, cols) : d));

  const save = () => {
    if (!draft) return;
    // A fresh id per saved chart (in the click, not while rendering).
    const id = `custom_${Date.now().toString(36)}`;
    const out = buildSpec(draft, context, editing?.source === "custom" ? editing.id : id);
    if (!out.spec) return;
    const spec = out.spec;
    const ws = useWorkspace.getState();
    if (editing?.source === "custom") {
      // The card's own type, Top N and title were part of the draft, so the saved spec carries them now.
      useWorkspace.setState({
        customCharts: ws.customCharts.map((c) => (c.id === editing.id ? spec : c)),
        widgets: ws.widgets.map((w) =>
          w.id === editing.id
            ? { ...w, w: draft.w, h: draft.h, kind: undefined, topN: undefined, title: undefined }
            : w,
        ),
      });
      ws.refresh();
      toast.success(`Saved “${spec.title}”`);
    } else {
      addCustomChart(spec, { select: false });
      if (editing) {
        // The copy takes the original's place in the dashboard order; the original is hidden after it.
        ws.moveWidget(spec.id, editing.id);
        ws.updateWidget(editing.id, { hidden: true });
      }
      toast.success(
        editing
          ? `Saved “${spec.title}” as your chart; the original is hidden`
          : `Added “${spec.title}” to the dashboard`,
        {
          action: { label: "View", onClick: () => useWorkspace.getState().focusChart(spec.id) },
        },
      );
    }
    onDone();
  };

  const groups = CHART_GROUPS.map((g) => ({
    ...g,
    types: CHART_TYPES.filter((t) => t.group === g.id && t.buildable),
  })).filter((g) => g.types.length);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
      <section aria-label="Chart types" className="grid min-w-0 content-start gap-5">
        {editing ? (
          <p className="rounded-card border border-border-accent bg-accent-soft px-4 py-3 text-sm text-fg">
            Editing “{widget?.title?.trim() || editing.title}”.{" "}
            <span className="text-fg-muted">
              {editing.source === "custom" ? (
                "Your changes replace it."
              ) : (
                <Brief
                  label="How a recommended chart is edited"
                  full="It's a recommended chart, so your version is saved as a custom chart and the original is hidden."
                >
                  Saved as your copy; the original is hidden.
                </Brief>
              )}
            </span>
          </p>
        ) : null}
        {groups.map((g) => (
          <div key={g.id}>
            {/* The question each group answers: beside its title from sm up, behind the ⓘ on a phone. */}
            <h2 className="flex items-center gap-1.5 text-md font-medium text-fg">
              <span>
                {g.title} <span className="hidden font-normal text-fg-subtle sm:inline">· {g.question}</span>
              </span>
              <InfoTip label={`About ${g.title}`} className="sm:hidden">
                {g.question}
              </InfoTip>
            </h2>
            <ul role="list" className="mt-2 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
              {g.types.map((t) => {
                const why = missing(t, cols);
                const on = draft?.kind === t.kind;
                const Icon = CHART_ICON[t.kind];
                return (
                  // The ⓘ sits over the card's corner, beside the button rather than inside it (a button
                  // can't hold another).
                  <li key={t.kind} className="relative">
                    <button
                      type="button"
                      disabled={Boolean(why)}
                      aria-pressed={on}
                      onClick={() => pick(t.kind)}
                      className={cn(
                        "flex h-full w-full items-start gap-3 rounded-card border bg-surface-1 p-3 pr-10 text-left transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55",
                        on
                          ? "border-accent shadow-[0_0_0_3px_var(--accent-soft)]"
                          : "border-border hover:border-border-accent",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-control",
                          on ? "bg-accent text-accent-fg" : "bg-surface-3 text-accent",
                        )}
                      >
                        <Icon className="size-4.5" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-ui font-medium text-fg">
                          {t.name}
                          {on ? <Check className="size-3.5 text-accent" aria-hidden /> : null}
                        </span>
                        {/* What it shows, from sm up; what it suits is behind the ⓘ. */}
                        <span className="mt-0.5 hidden text-xs leading-relaxed text-fg-muted sm:block">
                          {t.shows}
                        </span>
                        {/* What the file lacks for this type stays in view. */}
                        {why ? (
                          <span className="block text-xs leading-relaxed text-warning">{why}.</span>
                        ) : null}
                      </span>
                    </button>
                    <span className="absolute top-3 right-3">
                      <InfoTip label={`About ${t.name}`}>
                        <span className="block">{t.shows}</span>
                        <span className="mt-1 block text-fg-muted">Best for: {lower(t.bestFor)}</span>
                      </InfoTip>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
      <aside
        ref={builder}
        aria-label="Chart builder"
        className="min-w-0 scroll-mt-20 xl:sticky xl:top-20 xl:self-start"
      >
        {draft ? (
          <Builder
            draft={draft}
            setDraft={edit}
            context={context}
            cols={cols}
            problem={built?.problem ?? null}
            preview={built?.spec ?? null}
            editing={editing}
            onSave={save}
            onCancel={onDone}
          />
        ) : (
          <Card className="grid place-items-center gap-2 p-10 text-center">
            <Plus className="size-6 text-fg-subtle" aria-hidden />
            <p className="text-md font-medium text-fg">Pick a chart type</p>
            <p className="max-w-xs text-sm leading-relaxed text-fg-muted">
              <Brief
                label="How the builder works"
                full="Each type says what it shows and what data it suits best. Choose one, then the columns and measures to draw; the real chart previews here before you add it."
              >
                The real chart previews here.
              </Brief>
            </p>
          </Card>
        )}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- the form

function Builder({
  draft: d,
  setDraft,
  context,
  cols,
  problem,
  preview,
  editing,
  onSave,
  onCancel,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  context: ContextResult;
  cols: Columns;
  problem: string | null;
  preview: ChartSpec | null;
  editing: ChartSpec | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = chartType(d.kind);
  const set = (patch: Partial<Draft>) => setDraft((x) => ({ ...x, ...patch }));
  const maxMeasures = d.split ? 1 : t.measures.max;
  const axisColumn = "column" in d.axis ? d.axis.column : null;
  // A category can't be split by itself: choosing the split's column for the axis moves the split.
  const unsplit = (column: string): Partial<Draft> =>
    d.split === column ? { split: splitFor(cols, column) } : {};
  const Icon = CHART_ICON[d.kind];
  const auto = preview?.title ?? "";
  return (
    <Card className="grid gap-4 p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-accent text-accent-fg">
          <Icon className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0">
          {/* Focus lands here after a type is picked on a narrow screen (ChartStudio.pick). */}
          <h2
            data-builder-heading
            tabIndex={-1}
            className="rounded-[6px] text-md font-medium text-fg focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none"
          >
            {t.name}
          </h2>
          <p className="text-xs leading-relaxed text-fg-muted">
            <Brief label={`About ${t.name}`} full={`${t.shows} Best for: ${lower(t.bestFor)}`}>
              {t.shows}
            </Brief>
          </p>
        </div>
      </div>

      {/* ---- axis */}
      {t.axis === "timeOrCategory" ? (
        <Segmented<"time" | "column">
          ariaLabel="Along the axis"
          size="sm"
          value={d.axis.type === "column" ? "column" : "time"}
          onChange={(v) => {
            const date = cols.dates.find((c) => c.name === context.dateColumn) ?? cols.dates[0];
            const cat = firstCategory(context, cols);
            if (v === "time" && date)
              set({ axis: { type: "time", column: date.name, grain: "auto" }, section: "trend" });
            if (v === "column" && cat)
              set({ axis: { type: "column", column: cat.name }, section: "breakdown", ...unsplit(cat.name) });
          }}
          options={[
            { value: "time", label: "Over time" },
            { value: "column", label: "By category" },
          ]}
        />
      ) : null}
      {d.axis.type === "time" || d.axis.type === "part" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date column">
            <Select
              value={
                d.axis.type === "time"
                  ? d.axis.column
                  : (cols.dates.find((c) => d.axis.type === "part" && c.name === d.axis.column)?.name ??
                    d.axis.column)
              }
              onValueChange={(v) =>
                set({
                  axis:
                    d.axis.type === "part"
                      ? { ...d.axis, column: v }
                      : { type: "time", column: v, grain: d.axis.type === "time" ? d.axis.grain : "auto" },
                })
              }
            >
              <SelectTrigger aria-label="Date column">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...cols.dates, ...(d.axis.type === "part" ? cols.times : [])].map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {d.kind === "calendar" ? (
            <p className="self-end pb-2 text-xs text-fg-subtle">One cell per day.</p>
          ) : (
            <Field label="Group by">
              <Select
                value={d.axis.type === "part" ? `part:${d.axis.part}` : d.axis.grain}
                onValueChange={(v) => {
                  const column = d.axis.type === "time" || d.axis.type === "part" ? d.axis.column : "";
                  set({
                    axis: v.startsWith("part:")
                      ? { type: "part", column, part: v.slice(5) as DatePart }
                      : {
                          type: "time",
                          column: cols.dates.some((c) => c.name === column)
                            ? column
                            : (cols.dates[0]?.name ?? column),
                          grain: v as TimeGrain | "auto",
                        },
                  });
                }}
              >
                <SelectTrigger aria-label="Group dates by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Period</SelectLabel>
                    {GRAINS.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {t.options?.includes("datePart") ? (
                    <>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>Part of the date</SelectLabel>
                        {PARTS.map((p) => (
                          <SelectItem key={p.id} value={`part:${p.id}`}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </>
                  ) : null}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
      ) : null}
      {d.axis.type === "column" ? (
        <Field
          label={
            d.kind === "geoTile" ? "State column" : d.kind === "sankey" ? "From (left side)" : "Category"
          }
        >
          <ColumnSelect
            value={d.axis.column}
            options={d.kind === "geoTile" ? cols.states : cols.categories}
            onChange={(v) => set({ axis: { type: "column", column: v }, ...unsplit(v) })}
            label="Category column"
          />
        </Field>
      ) : null}
      {d.axis.type === "bins" ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
          <Field label="Numeric column">
            <ColumnSelect
              value={d.axis.column}
              options={cols.numbers}
              onChange={(v) =>
                set({ axis: { type: "bins", column: v, count: d.axis.type === "bins" ? d.axis.count : 12 } })
              }
              label="Numeric column"
            />
          </Field>
          <Field label="Bands">
            <Select
              value={String(d.axis.count)}
              onValueChange={(v) => d.axis.type === "bins" && set({ axis: { ...d.axis, count: Number(v) } })}
            >
              <SelectTrigger aria-label="Number of bands">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[6, 8, 10, 12, 16, 20, 30].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} bands
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      ) : null}

      {/* ---- split */}
      {t.split !== "none" ? (
        <Field
          label={
            d.kind === "sankey"
              ? "To (right side)"
              : d.kind === "treemap" || d.kind === "sunburst"
                ? "Second level (optional)"
                : t.split === "required"
                  ? "Second category"
                  : "Split by (optional)"
          }
        >
          <Select
            value={d.split ?? "__none__"}
            onValueChange={(v) => {
              const split = v === "__none__" ? null : v;
              setDraft((x) => ({ ...x, split, measures: split ? x.measures.slice(0, 1) : x.measures }));
            }}
          >
            <SelectTrigger aria-label="Second category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {t.split === "optional" ? <SelectItem value="__none__">None</SelectItem> : null}
              {cols.splits
                .filter((c) => c.name !== axisColumn)
                .map((c) => (
                  <SelectItem key={c.name} value={c.name} hint={`${c.distinct} values`}>
                    {c.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {/* ---- measures */}
      <div className="grid gap-2">
        <Label>
          {d.kind === "funnel" ? "Stages, in order" : maxMeasures === 1 ? "Measure" : "Measures"}
          {d.kind === "scatter" || d.kind === "bubble" ? (
            <span className="font-normal text-fg-subtle">
              {" "}
              · across, up{d.kind === "bubble" ? ", size" : ""}
            </span>
          ) : null}
        </Label>
        {d.measures.map((m, i) => (
          <MeasureRow
            key={i}
            value={m}
            context={context}
            cols={cols}
            onChange={(v) =>
              setDraft((x) => ({ ...x, measures: x.measures.map((y, j) => (j === i ? v : y)) }))
            }
            onRemove={
              d.measures.length > t.measures.min
                ? () => setDraft((x) => ({ ...x, measures: x.measures.filter((_, j) => j !== i) }))
                : undefined
            }
            countOnly={d.kind === "histogram"}
          />
        ))}
        {d.measures.length < maxMeasures && d.kind !== "histogram" ? (
          <Button
            variant="outline"
            size="xs"
            className="justify-self-start"
            onClick={() =>
              setDraft((x) => ({
                ...x,
                measures: [
                  ...x.measures,
                  startingMeasures(context, cols, x.measures.length + 1).at(-1) as AskMeasure,
                ],
              }))
            }
          >
            <Plus aria-hidden /> Add a measure
          </Button>
        ) : null}
      </div>

      {/* ---- options */}
      <div className="grid gap-3 sm:grid-cols-2">
        {d.axis.type === "column" &&
        (t.options?.includes("topN") || ["hbar", "bar", "lollipop", "dumbbell", "table"].includes(d.kind)) ? (
          <Field label="Show">
            <Select
              value={d.topN ? String(d.topN) : "all"}
              onValueChange={(v) => set({ topN: v === "all" ? null : Number(v) })}
            >
              <SelectTrigger aria-label="How many categories">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Default (top {DEFAULT_TOP})</SelectItem>
                {TOPNS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    Top {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        {t.options?.includes("target") ? (
          <Field label={d.kind === "gauge" ? "Goal (the dial's full scale)" : "Goal (optional)"}>
            <Input
              inputMode="decimal"
              value={d.target}
              placeholder={d.kind === "gauge" ? "e.g. 5000000" : "Leave blank for none"}
              onChange={(e) => set({ target: e.target.value })}
              aria-label="Goal"
            />
          </Field>
        ) : null}
        <Field label="Section">
          <Select value={d.section} onValueChange={(v) => set({ section: v as ChartSection })}>
            <SelectTrigger aria-label="Dashboard section">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SECTIONS.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Width">
          <Select value={String(d.w)} onValueChange={(v) => set({ w: Number(v) })}>
            <SelectTrigger aria-label="Width">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                [3, "Quarter width"],
                [4, "Third width"],
                [6, "Half width"],
                [8, "Two thirds"],
                [12, "Full width"],
              ].map(([w, label]) => (
                <SelectItem key={w} value={String(w)}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Title">
        <Input
          value={d.title}
          placeholder={auto}
          onChange={(e) => set({ title: e.target.value })}
          aria-label="Title"
          maxLength={200}
        />
      </Field>

      {/* ---- preview */}
      {preview ? (
        <ChartPreview spec={preview} />
      ) : (
        <p className="rounded-control border border-warning bg-warning-soft px-3 py-2.5 text-ui leading-relaxed text-fg">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X aria-hidden /> {editing ? "Cancel" : "Close"}
        </Button>
        <Button variant="primary" size="sm" disabled={!preview} onClick={onSave}>
          {editing ? (editing.source === "custom" ? "Save changes" : "Save as my chart") : "Add to dashboard"}
        </Button>
      </div>
      {!editing ? (
        <p className="text-xs text-fg-subtle">
          <Brief
            label="About the preview"
            full="The preview uses the dashboard's filters; it is the chart you get."
          >
            Previewed with the dashboard&apos;s filters.
          </Brief>
        </p>
      ) : null}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="text-ui font-medium text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

function ColumnSelect({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: ColumnProfile[];
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder="Choose a column" />
      </SelectTrigger>
      <SelectContent>
        {options.map((c) => (
          <SelectItem
            key={c.name}
            value={c.name}
            hint={c.storage === "number" ? undefined : `${c.distinct} values`}
          >
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** One measure: a KPI, or a column with an aggregation (or a count of rows). */
function MeasureRow({
  value,
  context,
  cols,
  onChange,
  onRemove,
  countOnly,
}: {
  value: AskMeasure;
  context: ContextResult;
  cols: Columns;
  onChange: (m: AskMeasure) => void;
  onRemove?: () => void;
  countOnly?: boolean;
}) {
  if (countOnly)
    return (
      <p className="rounded-control border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted">
        Number of rows in each band.
      </p>
    );
  const kpis = context.kpis.filter((k) => k.available && !k.hidden);
  const groups = [...new Set(kpis.map((k) => k.group))];
  const source = value.kind === "kpi" ? `kpi:${value.id}` : "column";
  const agg = value.kind === "column" ? value.agg : "sum";
  const numericAgg = AGGS.find((a) => a.id === agg)?.numeric ?? true;
  const columnOptions = numericAgg ? cols.numbers : context.profile.columns;
  return (
    <div className="grid gap-2 rounded-control border border-border bg-surface-2 p-2 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="grid min-w-0 gap-2">
        <Select
          value={source}
          onValueChange={(v) =>
            onChange(
              v === "column"
                ? {
                    kind: "column",
                    column: cols.numbers[0]?.name ?? "",
                    agg: cols.numbers.length ? "sum" : "count",
                  }
                : { kind: "kpi", id: v.slice(4) },
            )
          }
        >
          <SelectTrigger aria-label="Measure">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="column">Summarise a column…</SelectItem>
            {groups.map((g) => (
              <SelectGroup key={g}>
                <SelectSeparator />
                <SelectLabel>{g}</SelectLabel>
                {kpis
                  .filter((k) => k.group === g)
                  .map((k) => (
                    <SelectItem key={k.id} value={`kpi:${k.id}`}>
                      {k.name}
                    </SelectItem>
                  ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        {value.kind === "column" ? (
          <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
            <Select
              value={value.agg}
              onValueChange={(v) => {
                const a = v as AskAgg;
                const needsNumber = AGGS.find((x) => x.id === a)?.numeric ?? true;
                const ok = !needsNumber || cols.numbers.some((c) => c.name === value.column);
                onChange({
                  kind: "column",
                  agg: a,
                  column: a === "count" ? "" : ok ? value.column : (cols.numbers[0]?.name ?? ""),
                });
              }}
            >
              <SelectTrigger aria-label="Aggregation">
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
              <p className="self-center text-xs text-fg-subtle">Counts the rows in each group.</p>
            ) : (
              <ColumnSelect
                value={value.column}
                options={columnOptions}
                onChange={(c) => onChange({ ...value, column: c })}
                label="Column to summarise"
              />
            )}
          </div>
        ) : null}
      </div>
      {onRemove ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          aria-label="Remove this measure"
          className="self-start"
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
