"use client";

/**
 * The bottom bar on phones and tablets (below 1024 px, version 50.1): the
 * four phases, Prepare, Build, Analyse and Share, within the thumb's reach.
 * A phase opens where you last were in it (phaseTarget), and the steps inside
 * it are the row under the top bar. A phase whose steps can't be opened yet
 * (no data, no industry) stays visible, dimmed, and says why.
 *
 * It clears the home indicator on phones that have one
 * (env(safe-area-inset-bottom)), and the workspace pads its content by the
 * same height, so the bar never hides the end of a page.
 */
import * as React from "react";
import { useWorkspace, type Step } from "@/store/workspace";
import { cn } from "@/lib/utils";
import { stepEnabled } from "../Shell";
import { PHASES, phaseOf, phaseTarget, type PhaseId } from "./phases";

export function BottomBar() {
  const step = useWorkspace((s) => s.step);
  const setStep = useWorkspace((s) => s.setStep);
  const hasData = useWorkspace((s) => Boolean(s.summary));
  const hasDomain = useWorkspace((s) => Boolean(s.domainId));
  const active = phaseOf(step).id;
  // Where the user last was in each phase, so switching back returns there.
  const last = React.useRef<Partial<Record<PhaseId, Step>>>({});
  React.useEffect(() => {
    last.current[phaseOf(step).id] = step;
  }, [step]);
  const enabled = (id: Step) => stepEnabled(id, hasData, hasDomain);

  return (
    <nav
      aria-label="Workspace phases"
      className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface-glass pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-xl grid-cols-4">
        {PHASES.map((phase) => {
          const Icon = phase.icon;
          const current = phase.id === active;
          const open = phase.steps.some(enabled);
          return (
            <li key={phase.id}>
              <button
                type="button"
                aria-current={current ? "page" : undefined}
                aria-disabled={open ? undefined : true}
                onClick={() => {
                  const target = phaseTarget(phase, last.current[phase.id], enabled);
                  if (target) setStep(target);
                }}
                className={cn(
                  "flex h-full w-full flex-col items-center justify-center gap-1 rounded-control text-2xs font-medium transition-colors duration-fast focus-visible:focus-ring",
                  current ? "text-accent-text" : "text-fg-muted",
                  open ? (current ? "" : "hover:text-fg") : "opacity-disabled",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid h-7 w-12 place-items-center rounded-full transition-colors duration-fast",
                    current && "bg-accent-soft",
                  )}
                >
                  <Icon className="size-[18px]" />
                </span>
                {phase.label}
                {open ? null : (
                  <span className="sr-only">
                    {hasData ? ": choose an industry first" : ": load data first"}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
