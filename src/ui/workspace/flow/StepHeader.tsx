"use client";

/**
 * The header every redesigned step page opens with (version 50.2, the
 * guided flow): where the step sits ("Prepare · Step 2 of 8", the phase the
 * sidebar groups it under), the page's question or task as a display
 * heading, one short lead line with the full text behind it (Brief), and
 * room for a line of facts under it and for controls beside it.
 *
 * One component, so the pages of the flow read as one sequence rather than
 * as separate screens that each set their own header.
 */
import * as React from "react";
import { STEPS, stepNumber, type Step } from "@/store/workspace";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/ui/primitives/misc";
import { Brief } from "@/ui/primitives/reveal";
import { phaseOf } from "../shell/phases";

export function StepHeader({
  step,
  title,
  lead,
  leadFull,
  aside,
  children,
  className,
}: {
  step: Step;
  /** The page's heading: a question or a task ("What is this data about?"). */
  title: React.ReactNode;
  /** One short line under the heading. */
  lead?: React.ReactNode;
  /** The lead's full text, behind it (hover, focus, a long press or the ⓘ). */
  leadFull?: string;
  /** Controls beside the heading (at the end of the row; under it on a phone). */
  aside?: React.ReactNode;
  /** Anything under the lead: a facts line, a notice. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="max-w-3xl min-w-0">
        <Eyebrow>
          {phaseOf(step).label} · Step <span className="tabular">{stepNumber(step)}</span> of{" "}
          <span className="tabular">{STEPS.length}</span>
        </Eyebrow>
        <h1 className="mt-2 font-display text-display-sm text-balance text-fg">{title}</h1>
        {lead ? (
          <p className="mt-2 text-sm text-fg-muted">
            {leadFull ? (
              <Brief label="About this step" full={leadFull}>
                {lead}
              </Brief>
            ) : (
              lead
            )}
          </p>
        ) : null}
        {children}
      </div>
      {/* min-w-0 and max-w-full: long content beside the heading (a file name) wraps or truncates
          instead of widening the page. */}
      {aside ? <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{aside}</div> : null}
    </header>
  );
}
