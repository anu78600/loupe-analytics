"use client";

/**
 * The Questions step before the first question (version 50.4): a calm,
 * centred invitation and the file's own suggested questions as cards
 * (engine/charts/ask suggestQuestions: built from its KPIs and columns, so
 * each can be answered). A card asks its question at once. Each card's icon
 * says what kind of question it is (a trend, a ranking, a weekday pattern…;
 * analyse/thread.ts questionShape). On a phone the first four are shown, so
 * the box stays in reach.
 */
import * as React from "react";
import {
  ArrowDownNarrowWide,
  ArrowRight,
  CalendarDays,
  CalendarRange,
  ChartColumn,
  Clock,
  ListOrdered,
  MessageSquareText,
  Sigma,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { SuggestedQuestion } from "@/engine/charts/ask";
import { cn } from "@/lib/utils";
import { Brief } from "@/ui/primitives/reveal";
import { questionShape, type QuestionShape } from "./thread";

const SHAPE_ICON: Record<QuestionShape, LucideIcon> = {
  trend: TrendingUp,
  ranking: ChartColumn,
  lowest: ArrowDownNarrowWide,
  top: ListOrdered,
  weekday: CalendarDays,
  hour: Clock,
  season: CalendarRange,
  total: Sigma,
};

export function EmptyThread({
  suggestions,
  busy,
  onAsk,
}: {
  suggestions: SuggestedQuestion[];
  busy: boolean;
  onAsk: (q: SuggestedQuestion) => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center pt-2 pb-6 text-center sm:py-10">
      <span className="grid size-12 place-items-center rounded-full border border-border-accent bg-accent-soft text-accent-text shadow-card max-sm:hidden">
        <MessageSquareText className="size-5" aria-hidden />
      </span>
      <h2 className="text-lg font-semibold text-fg sm:mt-4">What would you like to know?</h2>
      <p className="mt-1 text-sm text-fg-muted">
        <Brief
          label="About answers"
          full="Pick a question below or type your own. Each answer comes with its chart and the SQL query that returns it, so you can run it on your own database too. They all go into the SQL PDF on the Export step."
        >
          Pick one, or type your own below.
        </Brief>
      </p>
      {suggestions.length ? (
        <ul
          aria-label="Suggested questions"
          className={cn(
            "mt-6 grid w-full gap-2.5 text-left",
            // One suggestion sits centred; more fill two columns from sm.
            suggestions.length > 1 ? "sm:grid-cols-2" : "max-w-md",
          )}
        >
          {suggestions.map((q, i) => {
            const Icon = SHAPE_ICON[questionShape(q.ask, q.order)];
            return (
              <li key={q.text} className={cn("min-w-0", i >= 4 && "max-sm:hidden")}>
                <button
                  type="button"
                  data-suggestion
                  disabled={busy}
                  onClick={() => onAsk(q)}
                  className="group flex h-full w-full items-center gap-3 rounded-card border border-border bg-surface-1 p-3.5 text-left shadow-card transition-[border-color,box-shadow] duration-fast hover:border-border-hover hover:shadow-pop focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-disabled"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-control bg-surface-3 text-fg-muted transition-colors duration-fast group-hover:bg-accent-soft group-hover:text-accent-text">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 text-ui text-fg">{q.text}</span>
                  <ArrowRight
                    className="size-3.5 shrink-0 text-fg-subtle opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100"
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
