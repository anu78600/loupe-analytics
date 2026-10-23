"use client";

/**
 * Step 6, Questions & SQL, as a conversation with an analyst (version 50.4).
 * Business questions about the user's data, each answered from the data
 * with the SQL query that returns the same answer.
 *
 * The page opens with the flow's StepHeader ("Analyse · Step 6 of 8"), with
 * the way on to the insights beside it. Below it, one centred column:
 * - the thread, oldest first (the store keeps the newest first, which the SQL
 *   PDF and the re-answering after a rebuild read; analyse/thread.ts): each
 *   question as the user's message and each answer as Loupe's
 *   (analyse/AnswerMessage.tsx: the sentence with the figures, the chart or
 *   table, the notes behind an ⓘ, the SQL folded, and the actions: copy and
 *   check the SQL, add the chart to the dashboard, edit, remove). A new answer
 *   scrolls into view; while one is worked out the question shows at once
 *   with a calm placeholder for its answer;
 * - before the first question, the file's suggested questions as cards
 *   (analyse/Suggestions.tsx);
 * - once there are answers, two or three follow-up questions as chips at the
 *   end of the thread, just above the composer;
 * - the composer pinned to the foot of the page (analyse/Composer.tsx): the
 *   box, the send button, which rows answer ("The dashboard's filters" or
 *   "The whole file") and the rows used.
 *
 * Loupe reads a typed question as it is typed (readQuestion). Values and
 * periods it names become its own filters. A question with words nothing in
 * the file matches is not answered: its answer names the words, because
 * answering the rest would answer another question; asking it again replaces
 * that answer. The answers use the dashboard's date and filter selections (a
 * chart's click-to-filter is not applied), or the whole file, and are
 * answered again in place when the analysis is rebuilt (the thread dims
 * meanwhile). Answered questions also go into the SQL PDF on the Export step.
 *
 * Text is kept short: the lead, the rows-used line and each answer's notes
 * are one line or an ⓘ, with the full words on hover, focus or a long press
 * (ui/primitives/reveal); long values are clamped and open in full when cut.
 */
import * as React from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  askMeasure,
  readQuestion,
  suggestQuestions,
  type AskContext,
  type ChartAsk,
  type QuestionReading,
  type SuggestedQuestion,
} from "@/engine/charts/ask";
import { formatDay } from "@/engine/core/dates";
import { describeFilter } from "@/engine/query/filter";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace";
import { Button } from "@/ui/primitives/button";
import { StepHeader } from "./flow/StepHeader";
import { Exchange, PendingExchange } from "./analyse/AnswerMessage";
import { Composer, FollowUpChips, type Scope } from "./analyse/Composer";
import { EmptyThread } from "./analyse/Suggestions";
import { focusAfterRemove, followUps, threadOrder } from "./analyse/thread";

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

/** Smooth scrolling, unless the reader asked for less motion (read when it happens, never while rendering). */
const scrollBehaviour = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

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
  const [scope, setScope] = React.useState<Scope>("dashboard");
  // The question being answered, shown in the thread at once (the store adds it with its answer).
  const [pending, setPending] = React.useState<string | null>(null);
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
  const thread = React.useMemo(() => threadOrder(questions), [questions]);
  const chips = React.useMemo(() => followUps(suggestions, questions), [suggestions, questions]);

  // A new answer scrolls into view (not the ones already here when the page opened, nor one answered
  // again in place); so does the question just asked, with its placeholder.
  const known = React.useRef<Set<string> | null>(null);
  React.useEffect(() => {
    const ids = questions.map((q) => q.id);
    if (!known.current) {
      known.current = new Set(ids);
      return;
    }
    const fresh = ids.find((id) => !known.current?.has(id));
    known.current = new Set(ids);
    if (fresh)
      document
        .getElementById(`exchange-${fresh}`)
        ?.scrollIntoView({ block: "start", behavior: scrollBehaviour() });
  }, [questions]);
  React.useEffect(() => {
    if (pending)
      document
        .getElementById("exchange-pending")
        ?.scrollIntoView({ block: "end", behavior: scrollBehaviour() });
  }, [pending]);

  if (!context || !actx) return null;
  const rowsLine =
    scope === "dashboard"
      ? `Rows used: ${dashboardRows.length ? dashboardRows.join(" · ") : "every row (the dashboard has no filters)"}`
      : "Rows used: every row of your file";
  const crossFilterNote = crossFilter
    ? `The chart click on ${crossFilter.column}: ${crossFilter.value} is not applied to answers.`
    : "A chart click on the dashboard is never applied to answers.";
  // Answering again after a rebuild: the thread dims and says so.
  const updating = loading && !pending && questions.length > 0;

  const ask = (q: {
    question: string;
    understood: string;
    notes: string[];
    ask: ChartAsk;
    order: "asc" | "desc";
  }) => {
    setPending(q.question);
    void askQuestion({ ...q, scope }).finally(() => setPending(null));
  };

  const submit = () => {
    if (!reading || loading) return;
    if (!reading.ask.measures.length && !reading.unmatched.length) {
      toast.error("Name something to measure: a KPI or one of your columns, e.g. “total revenue by region”.");
      return;
    }
    const question = text.trim();
    // Asking again replaces an answer that couldn't be given for the same words.
    for (const q of questions) if (q.error && q.question === question) removeQuestion(q.id);
    ask({
      question,
      understood: readAs(reading),
      notes: reading.notes,
      // Words nothing matched go with the request, so the answer refuses it (and keeps refusing it).
      ask: reading.unmatched.length ? { ...reading.ask, unmatched: reading.unmatched } : reading.ask,
      order: reading.order,
    });
    setText("");
  };

  const askSuggested = (q: SuggestedQuestion) =>
    ask({
      question: q.text,
      understood: `${describeAsk(q.ask, actx)}${q.ask.by.kind === "column" ? `, ${q.order === "asc" ? "lowest" : "highest"} first` : ""}`,
      notes: [],
      ask: q.ask,
      order: q.order,
    });

  // Focus follows a removed exchange: the one below it, else the one above, else the question box.
  const remove = (id: string) => {
    const next = focusAfterRemove(
      thread.map((q) => q.id),
      id,
    );
    removeQuestion(id);
    requestAnimationFrame(() => {
      const target = next ? document.getElementById(`answer-${next}`) : inputRef.current;
      target?.focus();
    });
  };
  const edit = (question: string) => {
    setText(question);
    inputRef.current?.focus();
  };

  return (
    // The page fills the screen under the top bar (and above the phone's bottom bar), so the composer
    // rests at its foot even before the first question.
    <div className="mx-auto flex min-h-[calc(100dvh-10.5rem-env(safe-area-inset-bottom))] w-full max-w-[908px] flex-col px-4 pt-8 pb-3 md:px-6 lg:min-h-[calc(100dvh-3.5rem)] lg:pb-5">
      <StepHeader
        step="questions"
        className="mb-8"
        title="Ask your data a question"
        lead="Answered from your file, with the SQL behind it."
        leadFull="Pick a question or type your own. Loupe answers it from your file and writes the SQL query that returns the same answer, which you can check right here. Every answer also goes into the SQL PDF on the Export step."
        aside={
          <Button variant="secondary" onClick={() => setStep("insights")}>
            Continue to insights <ArrowRight aria-hidden />
          </Button>
        }
      />
      <section aria-label="Questions and answers" className="flex flex-1 flex-col">
        {updating ? (
          <p className="mb-4 flex items-center gap-2 text-xs text-fg-muted" role="status">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Answering again for the new definitions…
          </p>
        ) : null}
        {thread.length || pending ? (
          <ol
            aria-busy={loading}
            className={cn(
              "grid grid-cols-[minmax(0,1fr)] gap-10 transition-opacity duration-base",
              updating ? "opacity-disabled" : "",
            )}
          >
            {thread.map((a) => (
              <li key={a.id} id={`exchange-${a.id}`} className="scroll-mt-32 lg:scroll-mt-20">
                <Exchange answer={a} ctx={actx} onRemove={remove} onEdit={edit} />
              </li>
            ))}
            {pending ? (
              <li id="exchange-pending" className="scroll-mb-56">
                <PendingExchange text={pending} />
              </li>
            ) : null}
          </ol>
        ) : null}
        {thread.length && !pending ? (
          <FollowUpChips questions={chips} busy={loading} onAsk={askSuggested} />
        ) : null}
        {!thread.length && !pending ? (
          <EmptyThread suggestions={suggestions} busy={loading} onAsk={askSuggested} />
        ) : null}
      </section>
      <Composer
        text={text}
        onText={setText}
        inputRef={inputRef}
        reading={reading}
        readAs={readAs}
        onSubmit={submit}
        busy={loading}
        scope={scope}
        onScope={setScope}
        rowsLine={rowsLine}
        crossFilterNote={crossFilterNote}
      />
    </div>
  );
}
