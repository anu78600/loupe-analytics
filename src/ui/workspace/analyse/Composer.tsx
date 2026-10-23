"use client";

/**
 * The Questions step's composer (version 50.4): the box a question is typed
 * into, pinned to the foot of the page like the guided flow's dock (sticky,
 * glass, above the phone's bottom bar), with the way to send it as the
 * page's one primary button.
 *
 * - While a question is typed, the line under the box says how it reads
 *   ("Read as: Net revenue by Channel, highest first") or names the words
 *   nothing in the file matches, so the user can fix them before asking.
 * - Under that, "Answer with" picks the rows: the dashboard's date and filter
 *   selections, or the whole file; the rows used follow on one clamped line,
 *   with why a chart click is left out behind the ⓘ.
 *
 * FollowUpChips are the two or three follow-up questions that end the thread
 * once there are answers, just above the box (analyse/thread.ts followUps):
 * the file's own suggested questions not asked yet, the latest answer's
 * measure seen another way first. They stay in the thread rather than on the
 * pinned box, so they never cover the answers above it.
 */
import * as React from "react";
import { ArrowUp, CornerDownRight, Loader2 } from "lucide-react";
import type { QuestionReading, SuggestedQuestion } from "@/engine/charts/ask";
import { Button } from "@/ui/primitives/button";
import { Brief, ClampText, InfoTip } from "@/ui/primitives/reveal";
import { Segmented } from "@/ui/primitives/segmented";

export type Scope = "dashboard" | "file";

const quoted = (words: readonly string[]) => words.map((w) => `“${w}”`).join(", ");

export function Composer({
  text,
  onText,
  inputRef,
  reading,
  readAs,
  onSubmit,
  busy,
  scope,
  onScope,
  rowsLine,
  crossFilterNote,
}: {
  text: string;
  onText: (text: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** How the words typed so far read, or null while the box is empty. */
  reading: QuestionReading | null;
  readAs: (r: QuestionReading) => string;
  onSubmit: () => void;
  /** An answer is being worked out. */
  busy: boolean;
  scope: Scope;
  onScope: (scope: Scope) => void;
  /** "Rows used: …", for the scope chosen. */
  rowsLine: string;
  /** Why a chart click on the dashboard is left out of answers. */
  crossFilterNote: string;
}) {
  return (
    <div className="no-print sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 mt-6 lg:bottom-5">
      <form
        aria-label="Ask a question"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="rounded-panel border border-border bg-surface-overlay/90 shadow-lift backdrop-blur-xl transition-[border-color,box-shadow] duration-fast has-[input:focus-visible]:border-border-accent has-[input:focus-visible]:shadow-[var(--shadow-focus),var(--shadow-lift)]"
      >
        <div className="flex items-center gap-2 py-2 pr-2 pl-4">
          <label htmlFor="question-input" className="sr-only">
            Your question
          </label>
          <input
            ref={inputRef}
            id="question-input"
            value={text}
            onChange={(e) => onText(e.target.value)}
            placeholder="Ask about your data…"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="question-reading"
            className="h-10 min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-subtle"
          />
          <Button type="submit" variant="primary" disabled={!text.trim() || busy} className="max-sm:px-3">
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUp aria-hidden />}
            <span className="max-sm:sr-only">Ask</span>
          </Button>
        </div>
        {/* How the question reads while it is typed; announced politely. */}
        <p
          id="question-reading"
          aria-live="polite"
          className={reading ? "-mt-1 min-w-0 px-4 pb-2.5 text-xs" : "sr-only"}
        >
          {reading ? (
            <>
              <span className="text-fg-muted">
                {reading.ask.measures.length
                  ? `Read as: ${readAs(reading)}`
                  : "Nothing to measure found yet."}
              </span>
              {reading.unmatched.length ? (
                <span className="text-warning-text">
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
          ) : null}
        </p>
        <div className="flex min-w-0 items-center gap-x-3 gap-y-1.5 border-t border-border-subtle py-2 pr-3 pl-4">
          <span className="shrink-0 text-xs text-fg-subtle max-sm:sr-only">Answer with</span>
          <Segmented<Scope>
            ariaLabel="Which rows to use"
            size="sm"
            value={scope}
            onChange={onScope}
            className="shrink-0"
            options={[
              { value: "dashboard", label: "The dashboard's filters" },
              { value: "file", label: "The whole file" },
            ]}
          />
          {/* The rows in one clamped line; why a chart click is left out, and what narrows them, behind the ⓘ. */}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-xs text-fg-subtle sm:justify-start">
            <ClampText key={rowsLine} className="min-w-0 max-sm:hidden">
              {rowsLine}
            </ClampText>
            <InfoTip label="About the rows used">
              {rowsLine}. {crossFilterNote} A value or period the question names (“in 2026”) narrows the rows
              further.
            </InfoTip>
          </div>
        </div>
      </form>
    </div>
  );
}

/** The follow-up questions that end the thread: a row that wraps from sm and scrolls sideways on a phone. */
export function FollowUpChips({
  questions,
  busy,
  onAsk,
}: {
  questions: SuggestedQuestion[];
  busy: boolean;
  onAsk: (q: SuggestedQuestion) => void;
}) {
  if (!questions.length) return null;
  return (
    <div className="mt-8 sm:pl-11">
      <p id="follow-ups" className="eyebrow mb-2 text-fg-subtle">
        Ask next
      </p>
      <div
        role="group"
        aria-labelledby="follow-ups"
        className="flex [scrollbar-width:none] gap-2 overflow-x-auto max-sm:-mx-4 max-sm:[mask-image:linear-gradient(to_right,var(--bg)_calc(100%-2.5rem),transparent)] max-sm:px-4 sm:flex-wrap"
      >
        {questions.map((q) => (
          <button
            key={q.text}
            type="button"
            data-followup
            disabled={busy}
            onClick={() => onAsk(q)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-1 px-3 text-ui text-fg-muted shadow-card transition-[color,border-color] duration-fast hover:border-border-hover hover:text-fg focus-visible:focus-ring disabled:opacity-disabled"
          >
            <CornerDownRight className="size-3.5 text-fg-subtle" aria-hidden />
            {q.text}
          </button>
        ))}
      </div>
    </div>
  );
}
