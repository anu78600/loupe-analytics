"use client";

/**
 * Step 5, Questions & SQL. Business questions about the user's data, each
 * answered from the data with the SQL query that returns the same answer.
 *
 * Loupe suggests questions built from the file's own KPIs and columns
 * (suggestQuestions); the user can type their own ("Which city has the
 * highest average rating?"), read as they type (readQuestion). Each answer
 * card shows a one-line headline, the answer table and a chart, and the SQL
 * (engine/compile/questionSql.ts), with "Check this SQL on your data", which
 * runs it in DuckDB in this tab and compares every row with the answer. The
 * answers use the dashboard's date and filter selections, or the whole file.
 * Answered questions also go into the SQL PDF on the Export step.
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
} from "@/engine/charts/ask";
import { formatDay } from "@/engine/core/dates";
import { formatValue } from "@/engine/core/format";
import { describeFilter } from "@/engine/query/filter";
import type { QuestionAnswer } from "@/engine/session";
import { engine } from "@/lib/engine-client";
import { cn } from "@/lib/utils";
import { stepNumber, useWorkspace } from "@/store/workspace";
import { useFmt } from "@/ui/common/hooks";
import { Button } from "@/ui/primitives/button";
import { Card } from "@/ui/primitives/card";
import { Input, Label } from "@/ui/primitives/input";
import { Eyebrow } from "@/ui/primitives/misc";
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

export function QuestionsStep() {
  const context = useWorkspace((s) => s.context);
  const questions = useWorkspace((s) => s.questions);
  const loading = useWorkspace((s) => s.questionsLoading);
  const askQuestion = useWorkspace((s) => s.askQuestion);
  const setStep = useWorkspace((s) => s.setStep);
  const [text, setText] = React.useState("");
  const [scope, setScope] = React.useState<"dashboard" | "file">("dashboard");
  const actx = context as AskContext | null;
  const suggestions = React.useMemo(() => (actx ? suggestQuestions(actx) : []), [actx]);
  const reading = React.useMemo(() => (actx && text.trim() ? readQuestion(text, actx) : null), [actx, text]);
  if (!context || !actx) return null;
  const asked = new Set(questions.map((q) => q.question));

  const submit = () => {
    if (!reading) return;
    if (!reading.ask.measures.length) {
      toast.error("Name something to measure: a KPI or one of your columns, e.g. “total revenue by region”.");
      return;
    }
    void askQuestion({
      question: text.trim(),
      understood: `${reading.understood}${reading.ask.by.kind === "column" ? `, ${reading.order === "asc" ? "lowest" : "highest"} first` : ""}`,
      notes: [
        ...reading.notes,
        ...(reading.unmatched.length
          ? [`Not found in your file: ${reading.unmatched.map((u) => `"${u}"`).join(", ")}.`]
          : []),
      ],
      ask: reading.ask,
      order: reading.order,
      scope,
    });
    setText("");
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-8 md:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Step {stepNumber("questions")} · Questions & SQL</Eyebrow>
          <h1 className="mt-2 font-display text-display-sm text-fg">Ask your data a business question.</h1>
          <p className="mt-2 max-w-2xl text-ui text-fg-muted">
            Pick a question or type your own. Loupe answers it from your file and writes the SQL query that
            returns the same answer, which you can check right here.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setStep("insights")}>
          Continue to insights <ArrowRight aria-hidden />
        </Button>
      </div>

      <Card className="grid gap-4 p-5">
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
              id="question-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Which region has the highest revenue? How many orders by weekday?"
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" variant="primary" disabled={!text.trim() || loading}>
              {loading ? <Loader2 className="animate-spin" aria-hidden /> : <CornerDownLeft aria-hidden />}{" "}
              Answer with SQL
            </Button>
          </div>
          <p className="min-h-5 text-2xs text-fg-muted" aria-live="polite">
            {reading
              ? reading.ask.measures.length
                ? `Read as: ${reading.understood}${reading.ask.by.kind === "column" ? `, ${reading.order === "asc" ? "lowest" : "highest"} first` : ""}${reading.unmatched.length ? ` · not found: ${reading.unmatched.join(", ")}` : ""}`
                : `Nothing to measure found yet${reading.unmatched.length ? ` (not found: ${reading.unmatched.join(", ")})` : ""}.`
              : " "}
          </p>
        </form>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-2xs text-fg-muted">Answer with</span>
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
        {suggestions.length ? (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-2xs font-medium tracking-[0.12em] text-fg-subtle uppercase">
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
          questions.map((a) => <AnswerCard key={a.id} answer={a} ctx={actx} />)
        ) : (
          <Card className="flex items-start gap-3 p-6 text-ui text-fg-muted">
            <MessageSquareText className="mt-0.5 size-5 shrink-0 text-fg-subtle" aria-hidden />
            <p>
              No questions yet. Each answer comes with its SQL query, so you can run it on your own database
              too. They are all included in the SQL PDF on the Export step.
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

/** The dataset the DuckDB copy was loaded from, so each check after the first reuses it. */
let duckFor: string | null = null;

type CheckState = { status: "idle" | "running" | "ok" | "differs" | "error"; message: string };

function AnswerCard({ answer: a, ctx }: { answer: QuestionAnswer; ctx: AskContext }) {
  const fmt = useFmt();
  const summary = useWorkspace((s) => s.summary);
  const removeQuestion = useWorkspace((s) => s.removeQuestion);
  const addCustomChart = useWorkspace((s) => s.addCustomChart);
  const focusChart = useWorkspace((s) => s.focusChart);
  const [check, setCheck] = React.useState<CheckState>({ status: "idle", message: "" });
  const chart = React.useMemo(() => {
    if (a.keyLabel === null || a.error || a.order === "asc") return null;
    return designAsk(a.ask, ctx, () => `q_${a.id}_chart`).charts[0]?.spec ?? null;
  }, [a, ctx]);
  const filters = a.filters.length
    ? a.filters.map((f) => describeFilter(f, formatDay)).join("; ")
    : "every row of your file";

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
        const seen = new Set<string>();
        for (const row of a.keyLabel === null ? res.rows.slice(0, 1) : res.rows) {
          const key = keyAt < 0 ? "null" : engineKey(row[keyAt] ?? null, a);
          seen.add(key);
          const e = a.keyLabel === null ? a.rows[0] : engineRows.get(key);
          a.measures.forEach((m, i) => {
            const at = res.columns.indexOf(m.label);
            if (at < 0) return;
            const v = row[at];
            const sqlValue = v === null || v === undefined ? null : Number(v);
            compared++;
            if (!e || !same(sqlValue, e.values[i] ?? null))
              problems.push(`${m.label} for ${String(row[keyAt] ?? "all rows")}`);
          });
        }
        // A group with no rows has no SQL row; the answer lists it with an empty value (0 or blank).
        if (a.keyLabel !== null)
          for (const [key, e] of engineRows)
            if (!seen.has(key) && !e.values.every((v) => v === null || v === 0))
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
    for (const c of out.charts) addCustomChart(c.spec);
    toast.success(
      out.charts.length === 1
        ? "Chart added to the dashboard"
        : `${out.charts.length} charts added to the dashboard`,
    );
    const last = out.charts[out.charts.length - 1];
    if (last) setTimeout(() => focusChart(last.spec.id), 200);
  };

  return (
    <Card className="grid gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium text-fg">{a.question}</h2>
          <p className="mt-1 text-2xs text-fg-muted">
            Read as: {a.understood} · Rows used: {filters}
          </p>
          {a.notes.map((n) => (
            <p key={n} className="mt-1 text-2xs text-fg-subtle">
              {n}
            </p>
          ))}
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Remove "${a.question}"`}
          onClick={() => removeQuestion(a.id)}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      {a.error ? (
        <p className="text-ui text-warning">{a.error}</p>
      ) : (
        <>
          {a.headline ? (
            <p className="rounded-card border border-border-accent bg-accent-soft px-4 py-3 text-ui text-fg">
              {a.headline}
            </p>
          ) : null}
          <div className={cn("grid gap-4", chart ? "lg:grid-cols-2" : "")}>
            <div className="max-h-[360px] overflow-auto rounded-card border border-border">
              <table className="w-full border-separate border-spacing-0 text-ui">
                <thead className="sticky top-0 bg-surface-2 text-left text-fg-muted">
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
                          className="border-b border-border px-3 py-1.5 text-left font-normal text-fg"
                        >
                          {r.label}
                        </th>
                      ) : null}
                      {r.values.map((v, i) => (
                        <td
                          key={i}
                          className="font-figures border-b border-border px-3 py-1.5 text-right text-fg"
                        >
                          {formatValue(v, a.measures[i]?.format ?? "number", fmt)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {a.more ? (
                <p className="px-3 py-2 text-2xs text-fg-subtle">
                  {a.more} more {a.more === 1 ? "group" : "groups"} ranked lower, not listed.
                </p>
              ) : null}
            </div>
            {chart ? <ChartPreview spec={chart} filters={a.filters} /> : null}
          </div>
          {a.sql ? <CodeBlock code={a.sql} language="SQL · DuckDB / PostgreSQL" label="SQL query" /> : null}
          {a.skipped.map((s) => (
            <p key={s.label} className="text-2xs text-fg-muted">
              No SQL for {s.label}: {s.reason}
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
                  "flex items-center gap-1.5 text-2xs",
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
