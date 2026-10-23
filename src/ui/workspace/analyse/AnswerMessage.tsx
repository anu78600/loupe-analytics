"use client";

/**
 * One exchange of the Questions step's conversation (version 50.4): the
 * question as the user's message, then Loupe's answer as an analyst's.
 *
 * - The question sits on the right in a quiet bubble. It is the exchange's
 *   heading (focus lands on it after a removal), and its pencil puts the
 *   words back in the box to edit them.
 * - The answer leads with its one sentence, which carries the figures
 *   (Session.answerQuestion writes it from the rows), then how the question
 *   was read and the rows it used on one clamped line, with the reader's
 *   notes and any measure left out of the SQL behind the ⓘ.
 * - Then the evidence: one overall row as figures; groups as a chart of
 *   exactly the rows listed (no Others, no split) with its table a click
 *   away, or the table alone when no chart suits them.
 * - The SQL is folded behind "Show SQL" (coloured by ui/common/code through
 *   the dashboard's CodeBlock, which copies it too). The actions: copy the
 *   SQL, check it on the data in DuckDB in this tab (every value compared,
 *   analyse/sqlCheck.ts), add the chart to the dashboard, and remove.
 * - A question that couldn't be answered says why, kept in view; one with no
 *   rows says what to try.
 *
 * While an answer is being worked out, PendingExchange shows the question and
 * a calm "Reading your data…" with the answer's shape as placeholders.
 */
import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Code2,
  Copy,
  Database,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  SearchX,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { designAsk, type AskContext, type ChartAsk } from "@/engine/charts/ask";
import type { ChartSpec } from "@/engine/charts/types";
import { formatDay } from "@/engine/core/dates";
import { formatValue } from "@/engine/core/format";
import { columnDecimals } from "@/engine/core/together";
import { BLANK_LABEL, describeFilter, type Filter } from "@/engine/query/filter";
import type { QuestionAnswer } from "@/engine/session";
import { engine } from "@/lib/engine-client";
import { cn, copyText } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace";
import { useFmt } from "@/ui/common/hooks";
import { LoupeMark } from "@/ui/brand/logo";
import { Button } from "@/ui/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/primitives/dropdown-menu";
import { Skeleton } from "@/ui/primitives/misc";
import { Brief, ClampText, InfoTip } from "@/ui/primitives/reveal";
import { Segmented } from "@/ui/primitives/segmented";
import { CodeBlock } from "../dashboard/KpiDetails";
import { ChartView, useChartData } from "./AnswerChart";
import { checkVerdict, compareWithAnswer, sqlStatements, type CheckState, type SqlResult } from "./sqlCheck";

// ---------------------------------------------------------------- the two voices

/** The user's question, on the right. With an id it is the exchange's heading and takes focus. */
export function YouMessage({ id, text, onEdit }: { id?: string; text: string; onEdit?: () => void }) {
  return (
    <div className="group/you flex items-start justify-end gap-1.5 pl-8 sm:pl-20">
      {onEdit ? (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Edit "${text}"`}
          onClick={onEdit}
          className="mt-1.5 opacity-0 transition-opacity duration-fast group-focus-within/you:opacity-100 group-hover/you:opacity-100 [@media(pointer:coarse)]:opacity-100"
        >
          <Pencil aria-hidden />
        </Button>
      ) : null}
      <h2
        id={id ? `answer-${id}` : undefined}
        tabIndex={id ? -1 : undefined}
        className="min-w-0 rounded-panel rounded-tr-sm bg-surface-3 px-4 py-2.5 text-sm font-normal [overflow-wrap:anywhere] text-fg focus-visible:focus-ring"
      >
        <span className="sr-only">You asked: </span>
        {text}
      </h2>
    </div>
  );
}

/** Loupe's side of the exchange: its mark and name, then the answer. */
export function AnalystMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-border bg-surface-1 shadow-card max-sm:hidden"
      >
        <LoupeMark decorative className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-1.5 flex min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
          <LoupeMark decorative className="size-4 sm:hidden" />
          <span className="font-medium text-fg-muted">Loupe</span>
        </p>
        {children}
      </div>
    </div>
  );
}

/** The question just asked, and a calm placeholder in the shape of an answer while it is worked out. */
export function PendingExchange({ text }: { text: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <YouMessage text={text} />
      <AnalystMessage>
        <div
          role="status"
          className="grid gap-4 rounded-card border border-border bg-surface-1 p-4 shadow-card sm:p-5"
        >
          <p className="flex items-center gap-2.5 text-ui text-fg-muted">
            <span aria-hidden className="flex items-center gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1.5 animate-pulse-soft rounded-full bg-accent"
                  style={{ animationDelay: `${i * 0.3}s` }}
                />
              ))}
            </span>
            Reading your data…
          </p>
          <div aria-hidden className="grid gap-2">
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-3/5" />
          </div>
          <Skeleton className="h-44 w-full rounded-control" />
        </div>
      </AnalystMessage>
    </div>
  );
}

// ---------------------------------------------------------------- one exchange

/** The dataset the DuckDB copy was loaded from, so each check after the first reuses it. */
let duckFor: string | null = null;

/** Runs the answer's SQL in DuckDB in this tab and compares every value with the answer. */
function useSqlCheck(a: QuestionAnswer): [CheckState, () => Promise<void>] {
  const summary = useWorkspace((s) => s.summary);
  const [check, setCheck] = React.useState<CheckState>({ status: "idle", message: "" });
  const run = async () => {
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
      const results: SqlResult[] = [];
      for (const stmt of sqlStatements(a.sql)) results.push(await duck.runSql(stmt, 100_000));
      setCheck(checkVerdict(compareWithAnswer(a, results)));
    } catch (e) {
      setCheck({ status: "error", message: `Couldn't run the check: ${(e as Error).message}` });
    }
  };
  return [check, run];
}

export function Exchange({
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
  return (
    // One track that may shrink below its content, so a long line of SQL scrolls inside its box.
    <article aria-labelledby={`answer-${a.id}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <YouMessage id={a.id} text={a.question} onEdit={() => onEdit(a.question)} />
      <AnalystMessage>
        <AnswerCard answer={a} ctx={ctx} onRemove={onRemove} onEdit={onEdit} />
      </AnalystMessage>
    </article>
  );
}

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
  const addCustomChart = useWorkspace((s) => s.addCustomChart);
  const focusChart = useWorkspace((s) => s.focusChart);
  const [check, runCheck] = useSqlCheck(a);
  const [sqlOpen, setSqlOpen] = React.useState(false);
  const [view, setView] = React.useState<"chart" | "table">("chart");
  // The chart draws the rows the table lists: a ranking's groups exactly (the lowest too, and no
  // Others), and no split, which an answer leaves out ("Add to dashboard" keeps it).
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
  const notes = [...a.notes, ...a.skipped.map((s) => `No SQL for ${s.label}: ${s.reason}`)];
  const sqlId = `sql-${a.id}`;

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

  const copySql = async () => {
    if (await copyText(a.sql)) toast.success("SQL query copied");
  };

  const running = check.status === "running";

  // Couldn't be answered: why, in view (two lines, the rest when cut), and the way to fix it.
  if (a.error)
    return (
      <div className="rounded-card border border-border bg-surface-1 shadow-card">
        <div className="flex gap-3 p-4 sm:p-5">
          <span className="grid size-7 shrink-0 place-items-center rounded-control bg-warning-soft text-warning">
            <AlertTriangle className="size-3.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <ClampText key={a.error} lines={2} className="text-sm text-fg">
              {a.error}
            </ClampText>
          </div>
        </div>
        <div className="flex items-center gap-1 border-t border-border-subtle px-2.5 py-2 sm:px-3.5">
          <Button size="xs" variant="ghost" onClick={() => onEdit(a.question)}>
            <Pencil aria-hidden /> Edit the question
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Remove "${a.question}"`}
            onClick={() => onRemove(a.id)}
            className="ml-auto"
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
    );

  return (
    <div className="min-w-0 rounded-card border border-border bg-surface-1 shadow-card">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 p-4 sm:p-5">
        {!a.rows.length ? (
          <div className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-control bg-surface-3 text-fg-muted">
              <SearchX className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-ui font-medium text-fg">No rows match</p>
              <p className="mt-0.5 text-sm text-fg-muted">
                <Brief
                  label="Why there is no answer"
                  full={`No rows match ${a.filters.length ? `these filters (${rowsUsed})` : "this question"}, so there is nothing to answer. Widen the filters or ask about the whole file.`}
                >
                  Widen the filters or ask the whole file.
                </Brief>
              </p>
            </div>
          </div>
        ) : a.headline ? (
          // The answer itself: its sentence carries the figures. Two lines; the rest opens when cut.
          <ClampText key={a.headline} lines={2} className="text-md text-fg">
            {a.headline}
          </ClampText>
        ) : null}
        {/* How it was read and the rows it used, in one clamped line; the notes behind the ⓘ. */}
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-fg-subtle">
            <ClampText key={readLine} className="min-w-0">
              {readLine}
            </ClampText>
            {notes.length ? (
              <InfoTip label="Notes on how the question was read">
                <ul className="grid gap-1">
                  {notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </InfoTip>
            ) : null}
          </div>
          {preview ? (
            <Segmented<"chart" | "table">
              ariaLabel="Show the answer as"
              size="sm"
              value={view}
              onChange={setView}
              className="shrink-0"
              options={[
                { value: "chart", label: "Chart" },
                { value: "table", label: "Table" },
              ]}
            />
          ) : null}
        </div>
        {a.rows.length ? (
          a.keyLabel === null ? (
            <Figures answer={a} />
          ) : preview && view === "chart" ? (
            <AnswerPlot spec={preview.spec} filters={preview.filters} />
          ) : (
            <AnswerTable answer={a} />
          )
        ) : null}
        {a.more && a.rows.length ? (
          <p className="text-xs text-fg-subtle">
            {a.more} more {a.more === 1 ? "group" : "groups"} with {a.order === "asc" ? "higher" : "lower"}{" "}
            values, not listed.
          </p>
        ) : null}
      </div>
      {sqlOpen && a.sql ? (
        <div id={sqlId} className="border-t border-border-subtle px-4 py-3 sm:px-5">
          <CodeBlock code={a.sql} language="SQL · DuckDB / PostgreSQL" label="SQL query" />
        </div>
      ) : null}
      {/* The actions in one row: every one from sm; on a phone the rarer ones fold into the menu. */}
      <div className="flex items-center gap-1 border-t border-border-subtle px-2.5 py-2 sm:px-3.5">
        {a.sql ? (
          <Button
            size="xs"
            variant="ghost"
            aria-expanded={sqlOpen}
            aria-controls={sqlOpen ? sqlId : undefined}
            onClick={() => setSqlOpen((o) => !o)}
          >
            <Code2 aria-hidden /> {sqlOpen ? "Hide SQL" : "Show SQL"}
            <ChevronDown
              aria-hidden
              className={cn("transition-transform duration-fast", sqlOpen ? "rotate-180" : "")}
            />
          </Button>
        ) : a.rows.length ? (
          <span className="min-w-0 px-1.5 text-xs text-fg-subtle">
            <Brief
              label="Why there is no SQL"
              full={a.skipped.map((s) => `No SQL for ${s.label}: ${s.reason}`).join(" ")}
            >
              No SQL for this answer.
            </Brief>
          </span>
        ) : null}
        {a.sql ? (
          <>
            <Button size="xs" variant="ghost" onClick={() => void copySql()} className="max-sm:hidden">
              <Copy aria-hidden /> Copy SQL
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void runCheck()}
              disabled={running}
              className="max-sm:hidden"
            >
              {running ? <Loader2 className="animate-spin" aria-hidden /> : <Database aria-hidden />} Check on
              your data
            </Button>
          </>
        ) : null}
        {a.keyLabel !== null && a.rows.length ? (
          <Button size="xs" variant="ghost" onClick={addChart}>
            <Plus aria-hidden /> Add to dashboard
          </Button>
        ) : null}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Remove "${a.question}"`}
          onClick={() => onRemove(a.id)}
          className="ml-auto max-sm:hidden"
        >
          <Trash2 aria-hidden />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="More actions for this answer"
              className="ml-auto sm:hidden"
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {a.sql ? (
              <>
                <DropdownMenuItem onSelect={() => void copySql()}>
                  <Copy aria-hidden /> Copy SQL
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void runCheck()} disabled={running}>
                  <Database aria-hidden /> Check on your data
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem onSelect={() => onEdit(a.question)}>
              <Pencil aria-hidden /> Edit the question
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRemove(a.id)}>
              <Trash2 aria-hidden /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {check.status !== "idle" ? (
        <p
          aria-live="polite"
          className={cn(
            "flex items-start gap-1.5 border-t border-border-subtle px-4 py-2 text-xs sm:px-5",
            check.status === "ok"
              ? "text-success-text"
              : check.status === "running"
                ? "text-fg-muted"
                : "text-warning-text",
          )}
        >
          {check.status === "ok" ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : null}
          {check.status === "differs" || check.status === "error" ? (
            <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          ) : null}
          {check.status === "running" ? (
            <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" aria-hidden />
          ) : null}
          <span className="min-w-0">{check.message}</span>
        </p>
      ) : null}
    </div>
  );
}

/** The answer's chart, computed for the rows the answer used and drawn on the card. */
function AnswerPlot({ spec, filters }: { spec: ChartSpec; filters: Filter[] }) {
  const data = useChartData(spec, filters);
  return <ChartView spec={spec} data={data} className="h-60 sm:h-64" />;
}

/** One overall row: each measure as a figure. */
function Figures({ answer: a }: { answer: QuestionAnswer }) {
  const fmt = useFmt();
  const row = a.rows[0];
  if (!row) return null;
  return (
    <dl className={cn("grid gap-2", a.measures.length > 1 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-1")}>
      {a.measures.map((m, i) => {
        const v = row.values[i] ?? null;
        const decimals = columnDecimals([v], m.format);
        return (
          <div
            key={m.id}
            className="min-w-0 rounded-control border border-border-subtle bg-surface-2 px-3.5 py-3"
          >
            <dt className="truncate text-xs text-fg-muted">{m.label}</dt>
            <dd className="font-figures mt-1 text-2xl font-semibold text-fg">
              {formatValue(v, m.format, { ...fmt, ...(decimals !== undefined ? { decimals } : {}) })}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** The answer's rows: a group per row, a column per measure, one precision per column. */
function AnswerTable({ answer: a }: { answer: QuestionAnswer }) {
  const fmt = useFmt();
  // One precision per column: ₹663 beside ₹2,712, never ₹662.75.
  const decimals = a.measures.map((m, i) =>
    columnDecimals(
      a.rows.map((r) => r.values[i] ?? null),
      m.format,
    ),
  );
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={`Answer table: ${a.question}`}
      className="max-h-[360px] overflow-auto rounded-control border border-border focus-visible:focus-ring"
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
              <th key={m.id} scope="col" className="border-b border-border px-3 py-2 text-right font-medium">
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {a.rows.map((r) => (
            <tr key={`${r.raw}`} className="hover:bg-surface-hover">
              {a.keyLabel !== null ? (
                <th
                  scope="row"
                  className="font-data border-b border-border-subtle px-3 py-1.5 text-left font-normal text-fg"
                >
                  {r.label}
                </th>
              ) : null}
              {r.values.map((v, i) => (
                <td key={i} className="tabular border-b border-border-subtle px-3 py-1.5 text-right text-fg">
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
    </div>
  );
}
