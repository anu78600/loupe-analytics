"use client";

/**
 * Step 5, Questions & SQL. Business questions about the user's data, each
 * answered from the data with the SQL query that returns the same answer.
 *
 * Loupe suggests questions built from the file's own KPIs and columns
 * (suggestQuestions); the user can type their own ("Which city has the
 * highest average rating?", "net revenue in Maharashtra in 2026"), read as
 * they type (readQuestion). Values and periods a question names become its
 * own filters. A question with words nothing in the file matches is not
 * answered: its card names the words, because answering the rest would
 * answer another question. Each answer card shows a one-line headline, the
 * answer table and a chart of the same rows, and the SQL
 * (engine/compile/questionSql.ts), with "Check this SQL on your data",
 * which runs it in DuckDB in this tab and compares every row with the
 * answer. The answers use the dashboard's date and filter selections (said
 * beside the choice; a chart's click-to-filter is not applied), or the whole
 * file. A card can be put back in the box to edit it. Answered questions also
 * go into the SQL PDF on the Export step.
 *
 * Text is kept short (version 47.0): the intro, the rows-used note and each
 * card's notes are one line or an ⓘ, with the full words on hover, focus or
 * a long press (ui/primitives/reveal); long values (the reading, the
 * headline, an error) are clamped and open in full when cut.
 */
import * as React from "react";
import {
  ArrowRight,
  CheckCircle2,
  CornerDownLeft,
  Database,
  Lightbulb,
  Loader2,
  MessageSquareText,
  Pencil,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  askMeasure,
  designAsk,
  readQuestion,
  suggestQuestions,
  type AskContext,
  type ChartAsk,
  type QuestionReading,
} from "@/engine/charts/ask";
import { formatDay } from "@/engine/core/dates";
import { formatValue } from "@/engine/core/format";
import { columnDecimals } from "@/engine/core/together";
import { BLANK_LABEL, describeFilter, type Filter } from "@/engine/query/filter";
import type { QuestionAnswer } from "@/engine/session";
import { engine } from "@/lib/engine-client";
import { cn } from "@/lib/utils";
import { stepNumber, useWorkspace } from "@/store/workspace";
import { useFmt } from "@/ui/common/hooks";
import { Button } from "@/ui/primitives/button";
import { Card } from "@/ui/primitives/card";
import { Input, Label } from "@/ui/primitives/input";
import { Eyebrow } from "@/ui/primitives/misc";
import { Brief, ClampText, InfoTip } from "@/ui/primitives/reveal";
import { Segmented } from "@/ui/primitives/segmented";
import { CodeBlock } from "./dashboard/KpiDetails";
import { ChartPreview } from "./dashboard/AskChart";

/** "Revenue by Region", "Revenue and Gross profit by month", for a suggested question's ask. */
function describeAsk(ask: ChartAsk, ctx: AskContext): string {
  const what = ask.measures
    .map((m) => askMeasure(m, ctx)?.label)
    .filter(Boolean)
    .join(" and ");
  const by = ask.by;
  if (by.kind === "none") return what;
  if (by.kind === "time") return `${what} by ${by.grain === "auto" ? "period" : by.grain}`;
  if (by.kind === "part")
    return `${what} by ${by.part === "dow" ? "weekday" : by.part === "hour" ? "hour of day" : by.part === "month" ? "month of year" : "day of month"}`;
  return `${what} by ${by.column}`;
}

/** How a typed question was read, with its order and its own filters: "Net revenue by Channel, highest first · Order Date: 2026". */
function readAs(r: QuestionReading): string {
  return `${r.understood}${r.ask.by.kind === "column" ? `, ${r.order === "asc" ? "lowest" : "highest"} first` : ""}${r.filterLabels.length ? ` · ${r.filterLabels.join(" · ")}` : ""}`;
}

const quoted = (words: readonly string[]) => words.map((w) => `“${w}”`).join(", ");

export function QuestionsStep() {
  const context = useWorkspace((s) => s.context);
  const questions = useWorkspace((s) => s.questions);
  const loading = useWorkspace((s) => s.questionsLoading);
  const askQuestion = useWorkspace((s) => s.askQuestion);
  const removeQuestion = useWorkspace((s) => s.removeQuestion);
  const setStep = useWorkspace((s) => s.setStep);
  // What "the dashboard's filters" stands for, said beside the choice.
  const datePreset = useWorkspace((s) => s.datePreset);
  const customRange = useWorkspace((s) => s.customRange);
  const dimFilters = useWorkspace((s) => s.dimFilters);
  const crossFilter = useWorkspace((s) => s.crossFilter);
  const [text, setText] = React.useState("");
  const [scope, setScope] = React.useState<"dashboard" | "file">("dashboard");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const actx = context as AskContext | null;
  const suggestions = React.useMemo(() => (actx ? suggestQuestions(actx) : []), [actx]);
  const reading = React.useMemo(() => (actx && text.trim() ? readQuestion(text, actx) : null), [actx, text]);
  const dashboardRows = React.useMemo(() => {
    void datePreset;
    void customRange;
    void dimFilters;
    void context;
    return useWorkspace
      .getState()
      .filters()
      .filter((f) => !("sourceId" in f))
      .map((f) => describeFilter(f, formatDay));
  }, [datePreset, customRange, dimFilters, context]);
  if (!context || !actx) return null;
  const rowsLine =
    scope === "dashboard"
      ? `Rows used: ${dashboardRows.length ? dashboardRows.join(" · ") : "every row (the dashboard has no filters)"}`
      : "Rows used: every row of your file";
  const asked = new Set(questions.filter((q) => !q.error).map((q) => q.question));

  const submit = () => {
    if (!reading) return;
    if (!reading.ask.measures.length && !reading.unmatched.length) {
      toast.error("Name something to measure: a KPI or one of your columns, e.g. “total revenue by region”.");
      return;
    }
    const question = text.trim();
    // Asking again replaces a card that couldn't be answered for the same words.
    for (const q of questions) if (q.error && q.question === question) removeQuestion(q.id);
    void askQuestion({
      question,
      understood: readAs(reading),
      notes: reading.notes,
      // Words nothing matched go with the request, so the answer refuses it (and keeps refusing it).
      ask: reading.unmatched.length ? { ...reading.ask, unmatched: reading.unmatched } : reading.ask,
      order: reading.order,
      scope,
    });
    setText("");
  };

  // Focus follows a removed card: the next card, else the one before, else the question box.
  const remove = (id: string) => {
    const i = questions.findIndex((q) => q.id === id);
    const next = questions[i + 1] ?? questions[i - 1];
    removeQuestion(id);
    requestAnimationFrame(() => {
      const target = next ? document.getElementById(`answer-${next.id}`) : inputRef.current;
      target?.focus();
    });
  };
  const edit = (question: string) => {
    setText(question);
    inputRef.current?.focus();
    inputRef.current?.scrollIntoView({ block: "center" });
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-8 md:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Step {stepNumber("questions")} · Questions & SQL</Eyebrow>
          <h1 className="mt-2 font-display text-display-sm text-fg">Ask your data a business question.</h1>
          <p className="mt-2 max-w-2xl text-sm text-fg-muted">
            <Brief
              label="About questions and SQL"
              full="Pick a question or type your own. Loupe answers it from your file and writes the SQL query that returns the same answer, which you can check right here."
            >
              Answered from your file, with SQL to check.
            </Brief>
          </p>
        </div>
        <Button variant="secondary" onClick={() => setStep("insights")}>
          Continue to insights <ArrowRight aria-hidden />
        </Button>
      </div>

      <Card className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 p-5">
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Label htmlFor="question-input">Your question</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              ref={inputRef}
              id="question-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Which region has the highest revenue?"
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" variant="primary" disabled={!text.trim() || loading}>
              {loading ? <Loader2 className="animate-spin" aria-hidden /> : <CornerDownLeft aria-hidden />}{" "}
              Answer with SQL
            </Button>
          </div>
          <p className="min-h-5 text-xs" aria-live="polite">
            {reading ? (
              <>
                <span className="text-fg-muted">
                  {reading.ask.measures.length
                    ? `Read as: ${readAs(reading)}`
                    : "Nothing to measure found yet."}
                </span>
                {reading.unmatched.length ? (
                  <span className="text-warning">
                    {" "}
                    ·{" "}
                    <Brief
                      label="Why it can't be answered yet"
                      full={`Not in your file: ${quoted(reading.unmatched)}. A question is answered only when every word is placed.`}
                    >
                      Not in your file: {quoted(reading.unmatched)}.
                    </Brief>
                  </span>
                ) : null}
              </>
            ) : (
              " "
            )}
          </p>
        </form>
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-fg-muted">Answer with</span>
            <Segmented<"dashboard" | "file">
              ariaLabel="Which rows to use"
              size="sm"
              value={scope}
              onChange={setScope}
              options={[
                { value: "dashboard", label: "The dashboard's filters" },
                { value: "file", label: "The whole file" },
              ]}
            />
          </div>
          {/* The rows in one clamped line; why a chart click is left out, and what narrows them, behind the ⓘ. */}
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
            <ClampText key={rowsLine} className="min-w-0">
              {rowsLine}
            </ClampText>
            <InfoTip label="About the rows used">
              {rowsLine}.{" "}
              {crossFilter
                ? `The chart click on ${crossFilter.column}: ${crossFilter.value} is not applied to answers.`
                : "A chart click on the dashboard is never applied to answers."}{" "}
              A value or period the question names (“in 2026”) narrows the rows further.
            </InfoTip>
          </div>
        </div>
        {suggestions.length ? (
          <div>
            <p className="eyebrow mb-2 flex items-center gap-1.5 text-fg-subtle">
              <Lightbulb className="size-3.5" aria-hidden /> Questions about your data
            </p>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {suggestions.map((q) => (
                <button
                  key={q.text}
                  type="button"
                  disabled={loading || asked.has(q.text)}
                  onClick={() =>
                    void askQuestion({
                      question: q.text,
                      understood: `${describeAsk(q.ask, actx)}${q.ask.by.kind === "column" ? `, ${q.order === "asc" ? "lowest" : "highest"} first` : ""}`,
                      notes: [],
                      ask: q.ask,
                      order: q.order,
                      scope,
                    })
                  }
                  className="rounded-card border border-border bg-surface-2 px-3 py-2.5 text-left text-ui text-fg transition-colors hover:border-border-accent focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none disabled:opacity-50"
                >
                  {q.text}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      <div className="mt-6 grid gap-5">
        {loading && !questions.length ? (
          <p className="flex items-center gap-2 text-ui text-fg-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Answering…
          </p>
        ) : null}
        {questions.length ? (
          questions.map((a) => (
            <AnswerCard key={a.id} answer={a} ctx={actx} onRemove={remove} onEdit={edit} />
          ))
        ) : (
          <Card className="flex items-start gap-3 p-6 text-sm text-fg-muted">
            <MessageSquareText className="mt-0.5 size-5 shrink-0 text-fg-subtle" aria-hidden />
            <p>
              <Brief
                label="About answers"
                full="No questions yet. Each answer comes with its SQL query, so you can run it on your own database too. They are all included in the SQL PDF on the Export step."
              >
                No questions yet. Each answer comes with its SQL.
              </Brief>
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- one answer

/** The SQL's group value in the engine's raw form: dates → bucket ms, ISO weekday and month (1-based) → 0-based. */
function engineKey(v: string | number | null, a: QuestionAnswer): string {
  if (v === null) return "null";
  const by = a.ask.by;
  if (by.kind === "time") {
    if (typeof v === "number") {
      // DuckDB-WASM may hand back epoch days, milliseconds or microseconds.
      const ms = v > 1e14 ? v / 1000 : v > 1e11 ? v : v * 86_400_000;
      return String(Math.round(ms));
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    return m ? String(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : v;
  }
  if (by.kind === "part") {
    const n = Number(v);
    return String(by.part === "dow" || by.part === "month" ? n - 1 : n);
  }
  return String(v);
}

const same = (x: number | null, y: number | null) =>
  x === null || y === null ? x === y : Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));

/** Blank or zero: what a group with no rows, or an empty "(blank)" group, holds. */
const empty = (v: number | null | undefined) => v === null || v === undefined || v === 0;

/** The dataset the DuckDB copy was loaded from, so each check after the first reuses it. */
let duckFor: string | null = null;

type CheckState = { status: "idle" | "running" | "ok" | "differs" | "error"; message: string };

function AnswerCard({
  answer: a,
  ctx,
  onRemove,
  onEdit,
}: {
  answer: QuestionAnswer;
  ctx: AskContext;
  onRemove: (id: string) => void;
  onEdit: (question: string) => void;
}) {
  const fmt = useFmt();
  const summary = useWorkspace((s) => s.summary);
  const addCustomChart = useWorkspace((s) => s.addCustomChart);
  const focusChart = useWorkspace((s) => s.focusChart);
  const [check, setCheck] = React.useState<CheckState>({ status: "idle", message: "" });
  // The chart draws the rows the table lists: a ranking's groups exactly (the lowest too, and no
  // Others), and no split, which an answer leaves out ("Add chart to dashboard" keeps it).
  const preview = React.useMemo(() => {
    if (a.keyLabel === null || a.error || !a.rows.length) return null;
    const by = a.ask.by;
    const ask: ChartAsk = { measures: a.ask.measures, by };
    if (by.kind !== "column") {
      const spec = designAsk(ask, ctx, () => `q_${a.id}_chart`).charts[0]?.spec;
      return spec ? { spec, filters: a.filters } : null;
    }
    const spec = designAsk({ ...ask, topN: a.rows.length, others: false }, ctx, () => `q_${a.id}_chart`)
      .charts[0]?.spec;
    const listed: Filter = {
      kind: "in",
      column: by.column,
      values: a.rows.map((r) => (r.raw === null ? BLANK_LABEL : String(r.raw))),
    };
    return spec ? { spec, filters: [...a.filters, listed] } : null;
  }, [a, ctx]);
  const rowsUsed = a.filters.length
    ? a.filters.map((f) => describeFilter(f, formatDay)).join("; ")
    : "every row of your file";
  const readLine = `Read as: ${a.understood} · Rows used: ${rowsUsed}`;
  // One precision per column: ₹663 beside ₹2,712, never ₹662.75.
  const decimals = a.measures.map((m, i) =>
    columnDecimals(
      a.rows.map((r) => r.values[i] ?? null),
      m.format,
    ),
  );

  const runCheck = async () => {
    setCheck({ status: "running", message: "Starting DuckDB…" });
    try {
      const duck = await import("@/lib/duckdb");
      if (duckFor !== summary?.id) {
        const bundle = await engine().verificationBundle();
        const conn = await duck.loadTable(bundle, (m) => setCheck({ status: "running", message: m }));
        await conn.close();
        duckFor = summary?.id ?? null;
      }
      setCheck({ status: "running", message: "Running the SQL…" });
      const statements = a.sql
        .split(/;\s*(?:\n|$)/)
        .map((x) =>
          x
            .split("\n")
            .filter((l) => !l.trim().startsWith("--"))
            .join("\n")
            .trim(),
        )
        .filter(Boolean);
      const engineRows = new Map(a.rows.map((r) => [r.raw === null ? "null" : String(r.raw), r]));
      let compared = 0;
      const problems: string[] = [];
      for (const stmt of statements) {
        const res = await duck.runSql(stmt, 100_000);
        const keyAt = a.keyLabel === null ? -1 : res.columns.indexOf(a.keyLabel);
        // The measures this statement returns: a measure with its own query is checked by that query.
        const here = a.measures
          .map((m, i) => ({ m, i, at: res.columns.indexOf(m.label) }))
          .filter((x) => x.at >= 0);
        const seen = new Set<string>();
        for (const row of a.keyLabel === null ? res.rows.slice(0, 1) : res.rows) {
          const raw = keyAt < 0 ? null : (row[keyAt] ?? null);
          const key = keyAt < 0 ? "null" : engineKey(raw, a);
          seen.add(key);
          const e = a.keyLabel === null ? a.rows[0] : engineRows.get(key);
          const values = here.map(({ at }) => {
            const v = row[at];
            return v === null || v === undefined ? null : Number(v);
          });
          // A group with nothing in it, or a blank group with no value, is left out of the answer.
          if (!e && values.every(empty)) continue;
          here.forEach(({ m, i }, j) => {
            compared++;
            if (!e || !same(values[j] ?? null, e.values[i] ?? null))
              problems.push(
                `${m.label} for ${raw === null ? (a.keyLabel === null ? "all rows" : BLANK_LABEL) : String(raw)}`,
              );
          });
        }
        // A group with no rows has no SQL row; the answer lists it with an empty value (0 or blank).
        if (a.keyLabel !== null)
          for (const [key, e] of engineRows)
            if (!seen.has(key) && !here.every(({ i }) => empty(e.values[i])))
              problems.push(`group ${e.label}`);
      }
      setCheck(
        problems.length
          ? {
              status: "differs",
              message: `DuckDB differs on ${problems.slice(0, 3).join(", ")}${problems.length > 3 ? "…" : ""}.`,
            }
          : {
              status: "ok",
              message: `DuckDB returned the same answer (${compared} value${compared === 1 ? "" : "s"} checked).`,
            },
      );
    } catch (e) {
      setCheck({ status: "error", message: `Couldn't run the check: ${(e as Error).message}` });
    }
  };

  const addChart = () => {
    const base = Date.now().toString(36);
    let i = 0;
    const out = designAsk(a.ask, ctx, () => `custom_${base}_${i++}`);
    for (const c of out.charts) addCustomChart(c.spec, { select: false });
    const own = a.ask.filters ?? [];
    toast.success(
      out.charts.length === 1
        ? "Chart added to the dashboard"
        : `${out.charts.length} charts added to the dashboard`,
      own.length
        ? {
            description: `It follows the dashboard's filters, not the question's own (${own.map((f) => describeFilter(f, formatDay)).join("; ")}): set them in the filter bar to match.`,
          }
        : undefined,
    );
    const last = out.charts[out.charts.length - 1];
    if (last) setTimeout(() => focusChart(last.spec.id), 200);
  };

  return (
    <Card className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={`answer-${a.id}`}
            tabIndex={-1}
            className="rounded-[4px] text-base font-semibold text-fg focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none"
          >
            {a.question}
          </h2>
          {/* How it was read, in one clamped line; the reader's notes behind the ⓘ. */}
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
            <ClampText key={readLine} className="min-w-0">
              {readLine}
            </ClampText>
            {a.notes.length ? (
              <InfoTip label="Notes on how the question was read">
                <ul className="grid gap-1">
                  {a.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </InfoTip>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Edit "${a.question}"`}
            onClick={() => onEdit(a.question)}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Remove "${a.question}"`}
            onClick={() => onRemove(a.id)}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
      {a.error ? (
        // Kept in view, two lines at most; the rest opens when cut.
        <ClampText key={a.error} lines={2} className="text-sm text-warning">
          {a.error}
        </ClampText>
      ) : !a.rows.length ? (
        <p className="rounded-card border border-border bg-surface-2 px-4 py-3 text-sm text-fg-muted">
          <Brief
            label="Why there is no answer"
            full={`No rows match ${a.filters.length ? `these filters (${rowsUsed})` : "this question"}, so there is nothing to answer. Widen the filters or ask about the whole file.`}
          >
            No rows match. Widen the filters or ask the whole file.
          </Brief>
        </p>
      ) : (
        <>
          {a.headline ? (
            <div className="rounded-card border border-border-accent bg-accent-soft px-4 py-3 text-sm text-fg">
              <ClampText key={a.headline} lines={2}>
                {a.headline}
              </ClampText>
            </div>
          ) : null}
          <div className={cn("grid gap-4", preview ? "lg:grid-cols-2" : "")}>
            <div
              tabIndex={0}
              role="region"
              aria-label={`Answer table: ${a.question}`}
              className="max-h-[360px] overflow-auto rounded-card border border-border focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none"
            >
              <table className="w-full border-separate border-spacing-0 text-ui">
                <thead className="sticky top-0 bg-surface-2 text-left text-xs text-fg-muted">
                  <tr>
                    {a.keyLabel !== null ? (
                      <th scope="col" className="border-b border-border px-3 py-2 font-medium">
                        {a.keyLabel}
                      </th>
                    ) : null}
                    {a.measures.map((m) => (
                      <th
                        key={m.id}
                        scope="col"
                        className="border-b border-border px-3 py-2 text-right font-medium"
                      >
                        {m.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {a.rows.map((r) => (
                    <tr key={`${r.raw}`} className="hover:bg-surface-2/60">
                      {a.keyLabel !== null ? (
                        <th
                          scope="row"
                          className="font-data border-b border-border px-3 py-1.5 text-left font-normal text-fg"
                        >
                          {r.label}
                        </th>
                      ) : null}
                      {r.values.map((v, i) => (
                        <td key={i} className="tabular border-b border-border px-3 py-1.5 text-right text-fg">
                          {formatValue(v, a.measures[i]?.format ?? "number", {
                            ...fmt,
                            ...(decimals[i] !== undefined ? { decimals: decimals[i] } : {}),
                          })}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {a.more ? (
                <p className="px-3 py-2 text-xs text-fg-subtle">
                  {a.more} more {a.more === 1 ? "group" : "groups"} with{" "}
                  {a.order === "asc" ? "higher" : "lower"} values, not listed.
                </p>
              ) : null}
            </div>
            {preview ? <ChartPreview spec={preview.spec} filters={preview.filters} /> : null}
          </div>
          {a.sql ? <CodeBlock code={a.sql} language="SQL · DuckDB / PostgreSQL" label="SQL query" /> : null}
          {a.skipped.map((s) => (
            <p key={s.label} className="text-xs text-fg-muted">
              <Brief label={`Why there is no SQL for ${s.label}`} full={`No SQL for ${s.label}: ${s.reason}`}>
                No SQL for {s.label}.
              </Brief>
            </p>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            {a.sql ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void runCheck()}
                disabled={check.status === "running"}
              >
                {check.status === "running" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Database aria-hidden />
                )}{" "}
                Check this SQL on your data
              </Button>
            ) : null}
            {a.keyLabel !== null ? (
              <Button variant="ghost" size="sm" onClick={addChart}>
                <Plus aria-hidden /> Add chart to dashboard
              </Button>
            ) : null}
            {check.status !== "idle" ? (
              <span
                className={cn(
                  "flex items-center gap-1.5 text-xs",
                  check.status === "ok"
                    ? "text-success"
                    : check.status === "running"
                      ? "text-fg-muted"
                      : "text-warning",
                )}
                aria-live="polite"
              >
                {check.status === "ok" ? <CheckCircle2 className="size-3.5" aria-hidden /> : null}
                {check.status === "differs" || check.status === "error" ? (
                  <XCircle className="size-3.5" aria-hidden />
                ) : null}
                {check.message}
              </span>
            ) : null}
          </div>
        </>
      )}
    </Card>
  );
}
