"use client";

/**
 * Workspace chrome: the top bar (wordmark, dataset summary, the step
 * Stepper, command palette and settings buttons) and step gating. Every step
 * after Upload needs a dataset; opening Check & map or a later step first
 * builds the analysis for the chosen industry (the store's setStep).
 */
import * as React from "react";
import Link from "next/link";
import { Check, Command, Database, RotateCcw, Settings2 } from "lucide-react";
import { motion } from "framer-motion";
import { STEPS, useWorkspace, type Step } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { formatCount } from "@/engine/core/format";
import { cn, isMac } from "@/lib/utils";
import { LoupeMark, Wordmark } from "@/ui/brand/logo";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { Kbd } from "@/ui/primitives/misc";
import { Tooltip } from "@/ui/primitives/tooltip";
import { ThemeToggle } from "@/ui/common/theme-toggle";

function stepEnabled(step: Step, hasData: boolean, hasDomain: boolean): boolean {
  if (step === "upload") return true;
  if (!hasData) return false;
  if (step === "detect" || step === "map") return true;
  return hasDomain;
}

/**
 * The workspace steps. Eight steps don't fit every top bar, so the row
 * tightens as the screen narrows: connectors only on wide screens (2xl),
 * every label from xl, only the current step's label below that (the others
 * keep their number, a tooltip and their name for screen readers). If it
 * still doesn't fit, the row scrolls and keeps the current step in view; it
 * never pushes the buttons beside it off the screen.
 */
export function Stepper() {
  const step = useWorkspace((s) => s.step);
  const setStep = useWorkspace((s) => s.setStep);
  const hasData = useWorkspace((s) => Boolean(s.summary));
  const hasDomain = useWorkspace((s) => Boolean(s.domainId));
  const currentIndex = STEPS.findIndex((s) => s.id === step);
  const activeRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [step]);
  return (
    <nav aria-label="Workspace steps" className="min-w-0">
      <ol className="flex [scrollbar-width:none] items-center gap-0.5 overflow-x-auto">
        {STEPS.map((s, i) => {
          const enabled = stepEnabled(s.id, hasData, hasDomain);
          const active = s.id === step;
          const done = i < currentIndex && enabled;
          return (
            <li key={s.id} className="flex shrink-0 items-center">
              <button
                ref={active ? activeRef : undefined}
                type="button"
                disabled={!enabled}
                aria-current={active ? "step" : undefined}
                title={s.label}
                onClick={() => setStep(s.id)}
                className={cn(
                  "relative inline-flex h-8 items-center gap-1.5 rounded-[9px] px-2 text-ui font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  active ? "text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="step-pill"
                    className="absolute inset-0 rounded-[9px] border border-border-strong bg-surface-2"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                ) : null}
                <span
                  className={cn(
                    "tabular relative grid size-[18px] place-items-center rounded-full border text-[10px] font-semibold",
                    active
                      ? "border-accent bg-accent text-accent-fg"
                      : done
                        ? "border-border-accent text-accent"
                        : "border-border-strong text-fg-subtle",
                  )}
                  aria-hidden
                >
                  {done ? <Check className="size-2.5" strokeWidth={3} /> : i + 1}
                </span>
                {/* Always announced (the number badge is aria-hidden); shown for the current step from sm, every step from xl. */}
                {/* The outer span stays positioned so the label paints above the active-step pill. */}
                <span className="relative">
                  <span className={cn("sr-only", active ? "sm:not-sr-only" : "xl:not-sr-only")}>
                    {s.label}
                  </span>
                </span>
              </button>
              {i < STEPS.length - 1 ? (
                <span aria-hidden className="mx-0.5 hidden h-px w-3 bg-border-strong 2xl:block" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** No-op subscription: the platform never changes while the page is open. */
const subscribePlatform = () => () => {};

export function WorkspaceTopBar({
  onOpenCommand,
  onOpenSettings,
}: {
  onOpenCommand: () => void;
  onOpenSettings: () => void;
}) {
  const summary = useWorkspace((s) => s.summary);
  const startOver = useWorkspace((s) => s.startOver);
  const stepIndex = useWorkspace((s) => STEPS.findIndex((x) => x.id === s.step));
  const locale = useSettings((s) => s.numberLocale);
  // The platform is only known in the browser; the server render assumes non-Mac (Ctrl+K).
  const mac = React.useSyncExternalStore(subscribePlatform, isMac, () => false);
  return (
    <header className="no-print sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1680px] items-center gap-3 px-4 md:px-6">
        <Link href="/" className="shrink-0 rounded-[8px]" aria-label="Loupe home">
          <span className="sm:hidden">
            <LoupeMark className="size-6" />
          </span>
          <span className="hidden sm:inline-flex">
            <Wordmark size="sm" />
          </span>
        </Link>
        <span aria-hidden className="hidden h-5 w-px shrink-0 bg-border-strong md:block" />
        {summary ? (
          // Takes whatever room the steps leave. Its parts are in order of importance and sit on one
          // 20px line: a part that doesn't fit wraps onto a second line, which is clipped, so the
          // summary shows what fits whole and never runs into the steps.
          <div
            className="hidden h-5 min-w-0 flex-1 basis-0 flex-wrap items-center gap-x-2 overflow-hidden min-[1360px]:flex"
            title={`${summary.fileName} · ${formatCount(summary.rowCount, locale)} rows`}
          >
            <span className="inline-flex h-5 shrink-0 items-center gap-2 whitespace-nowrap">
              <Database className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
              <span className="font-figures text-2xs text-fg-subtle">
                {formatCount(summary.rowCount, locale)} rows
              </span>
            </span>
            {summary.isDemo ? (
              <Badge tone="accent" className="shrink-0">
                Demo data
              </Badge>
            ) : null}
            <span className="h-5 max-w-[180px] truncate text-ui leading-5 text-fg">{summary.fileName}</span>
          </div>
        ) : null}
        <div className="mx-auto min-w-0">
          <Stepper />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip content="Command palette">
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenCommand}
              className="hidden gap-1.5 text-fg-muted lg:inline-flex"
            >
              {/* Name from content, so it includes the visible shortcut (WCAG 2.5.3 label in name). */}
              <span className="sr-only">Command palette, </span>
              <Command aria-hidden />
              <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd>K</Kbd>
            </Button>
          </Tooltip>
          {summary ? (
            <Tooltip content="Start over (clears the data from memory)">
              <Button variant="ghost" size="icon" onClick={startOver} aria-label="Start over">
                <RotateCcw aria-hidden />
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip content="Settings">
            <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label="Settings">
              <Settings2 aria-hidden />
            </Button>
          </Tooltip>
          <ThemeToggle compact />
        </div>
      </div>
      {/* How far through the steps you are, as a line along the bar's bottom edge. */}
      <motion.div
        aria-hidden
        className="absolute inset-x-0 -bottom-px h-px origin-left bg-[image:var(--accent-gradient)]"
        initial={false}
        animate={{ scaleX: summary ? (stepIndex + 1) / STEPS.length : 0 }}
        transition={{ type: "spring", stiffness: 160, damping: 30 }}
      />
    </header>
  );
}
