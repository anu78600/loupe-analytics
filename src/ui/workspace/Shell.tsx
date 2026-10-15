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

export function Stepper() {
  const step = useWorkspace((s) => s.step);
  const setStep = useWorkspace((s) => s.setStep);
  const hasData = useWorkspace((s) => Boolean(s.summary));
  const hasDomain = useWorkspace((s) => Boolean(s.domainId));
  const currentIndex = STEPS.findIndex((s) => s.id === step);
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
                type="button"
                disabled={!enabled}
                aria-current={active ? "step" : undefined}
                onClick={() => setStep(s.id)}
                className={cn(
                  "relative inline-flex h-8 items-center gap-2 rounded-[9px] px-2.5 text-ui font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
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
                {/* Visually hidden on phones but always announced: the number badge is aria-hidden. */}
                {/* The outer span stays positioned so the label paints above the active-step pill. */}
                <span className="relative">
                  <span className="sr-only sm:not-sr-only">{s.label}</span>
                </span>
              </button>
              {i < STEPS.length - 1 ? (
                <span aria-hidden className="mx-0.5 hidden h-px w-3 bg-border-strong lg:block" />
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
        <span aria-hidden className="hidden h-5 w-px bg-border-strong md:block" />
        {summary ? (
          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <Database className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
            <span className="max-w-[220px] truncate text-ui text-fg" title={summary.fileName}>
              {summary.fileName}
            </span>
            <span className="font-figures text-2xs text-fg-subtle">
              {formatCount(summary.rowCount, locale)} rows
            </span>
            {summary.isDemo ? <Badge tone="accent">Demo data</Badge> : null}
          </div>
        ) : null}
        <div className="mx-auto min-w-0 flex-1 md:flex-none">
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
    </header>
  );
}
