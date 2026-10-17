"use client";

/**
 * Workspace chrome: the top bar (wordmark, dataset summary, the step
 * Stepper, command palette and settings buttons) and step gating. Every step
 * after Upload needs a dataset; opening Check & map or a later step first
 * builds the analysis for the chosen industry (the store's setStep). "Start
 * over" asks first, since it drops the dataset and everything set up for it.
 */
import * as React from "react";
import Link from "next/link";
import { Check, Command, Database, RotateCcw, Settings2 } from "lucide-react";
import { motion } from "framer-motion";
import { STEPS, useWorkspace, type Step } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { cn, isMac } from "@/lib/utils";
import { LoupeMark, Wordmark } from "@/ui/brand/logo";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { Kbd } from "@/ui/primitives/misc";
import { Tooltip } from "@/ui/primitives/tooltip";
import { ThemeToggle } from "@/ui/common/theme-toggle";
import { countOf } from "@/ui/common/words";
import { SAMPLES } from "@/engine/samples/catalog";
import { askConfirm } from "./confirm";

/** Whether a step can be opened: Upload always; Detect and Check & map with data; the rest once an industry is chosen. */
export function stepEnabled(step: Step, hasData: boolean, hasDomain: boolean): boolean {
  if (step === "upload") return true;
  if (!hasData) return false;
  if (step === "detect" || step === "map") return true;
  return hasDomain;
}

/**
 * Opens a demo (from a link, the command palette or the demo cards), on
 * `goTo` when given. The store outlives a visit to the landing page, so the
 * demo may already be open: a link then only changes the step, keeping what
 * was set up for it, while `fresh` (an explicit "load this demo") loads it
 * again. Another demo is simply replaced; the user's own file only after a
 * yes.
 */
export async function openDemo(id: string, goTo?: Step, fresh = false): Promise<void> {
  const info = SAMPLES.find((s) => s.id === id);
  if (!info) return;
  const ws = useWorkspace.getState();
  if (!fresh && ws.summary?.sampleId === id) {
    if (goTo) ws.setStep(goTo);
    return;
  }
  if (ws.summary && !ws.summary.isDemo) {
    const ok = await askConfirm({
      title: `Open the “${info.name}” demo?`,
      body: `It replaces ${ws.summary.fileName} and everything you set up for it in this tab.`,
      note: "Your file itself stays on your computer, so you can upload it again at any time.",
      confirmLabel: "Open the demo",
      cancelLabel: "Keep my file",
      tone: "danger",
    });
    if (!ok) return;
  }
  await useWorkspace.getState().loadSample(id, { goTo });
}

/** "Start over", after a yes: it drops the dataset and everything set up for it. */
export async function confirmStartOver(): Promise<void> {
  const s = useWorkspace.getState();
  if (!s.summary) return;
  const ok = await askConfirm({
    title: "Start over?",
    body: s.summary.isDemo
      ? "This closes the demo and everything you set up for it: the industry, mappings, KPIs, charts and questions."
      : `This clears ${s.summary.fileName} from memory with everything you set up for it: the industry, mappings, hidden columns, KPIs, charts and questions.`,
    note: s.summary.isDemo ? undefined : "Your file itself stays on your computer.",
    confirmLabel: "Start over",
    cancelLabel: "Keep working",
    tone: "danger",
  });
  if (ok) useWorkspace.getState().startOver();
}

/**
 * The workspace steps. Eight steps don't fit every top bar, so the row
 * tightens as the screen narrows: connectors only on wide screens (2xl),
 * every label from xl, only the current step's label below that (the others
 * keep their number, a tooltip and their name for screen readers). If it
 * still doesn't fit, the row scrolls and keeps the current step in view; it
 * never pushes the buttons beside it off the screen. On phones the steps sit
 * closer and the row's edges fade, so a step half out of view reads as "more
 * this way" rather than as a number cut in two, and the current step is
 * scrolled to the middle.
 */
export function Stepper() {
  const step = useWorkspace((s) => s.step);
  const setStep = useWorkspace((s) => s.setStep);
  const hasData = useWorkspace((s) => Boolean(s.summary));
  const hasDomain = useWorkspace((s) => Boolean(s.domainId));
  const currentIndex = STEPS.findIndex((s) => s.id === step);
  const activeRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    const narrow = window.matchMedia("(max-width: 639px)").matches;
    activeRef.current?.scrollIntoView({ block: "nearest", inline: narrow ? "center" : "nearest" });
  }, [step]);
  return (
    <nav aria-label="Workspace steps" className="min-w-0">
      <ol className="flex [scrollbar-width:none] items-center gap-0.5 overflow-x-auto max-sm:[mask-image:linear-gradient(to_right,transparent,black_14px,black_calc(100%-14px),transparent)] max-sm:px-3">
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
                  "relative inline-flex h-8 items-center gap-1.5 rounded-[9px] px-2 text-ui font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 max-sm:px-1.5",
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
                    "tabular relative grid size-[18px] place-items-center rounded-full border text-2xs font-semibold",
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
  const sampled = useWorkspace((s) => Boolean(s.report?.sampling));
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
          // Takes whatever room the steps leave. The file's real name comes first and always shows
          // (it truncates); "Your file" or "Demo data" and the row count follow when there's room.
          // Each part sits on one 24px line and a part that doesn't fit wraps onto a second line,
          // which is clipped, so the summary never runs into the steps.
          <div
            className="hidden h-6 min-w-0 flex-1 basis-0 flex-wrap items-center gap-x-2.5 overflow-hidden lg:flex"
            title={`${summary.fileName}${summary.sheet ? ` · sheet "${summary.sheet}"` : ""} · ${countOf(summary.rowCount, "row", locale)}${sampled ? " (a sample of the file)" : ""}${summary.isDemo ? " · demo data" : ""}`}
          >
            <span className="inline-flex h-6 max-w-[280px] min-w-0 items-center gap-2">
              <Database className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
              <span className="truncate text-ui font-medium text-fg">
                {summary.fileName}
                {summary.sheet ? (
                  <span className="font-normal text-fg-subtle"> · {summary.sheet}</span>
                ) : null}
              </span>
            </span>
            <span className="flex h-6 shrink-0 items-center">
              <Badge tone={summary.isDemo ? "accent" : "success"}>
                {summary.isDemo ? "Demo data" : "Your file"}
              </Badge>
            </span>
            {/* A sample is never mistaken for the whole file: totals describe the rows loaded. */}
            {sampled ? (
              <span className="flex h-6 shrink-0 items-center">
                <Badge tone="warning">Sampled</Badge>
              </span>
            ) : null}
            <span className="h-6 shrink-0 text-xs leading-6 whitespace-nowrap text-fg-subtle">
              {countOf(summary.rowCount, "row", locale)}
            </span>
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
              // Wide screens only: below that the room goes to the file's name (Ctrl/⌘+K still works).
              className="hidden gap-1.5 text-fg-muted 2xl:inline-flex"
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
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void confirmStartOver()}
                aria-label="Start over"
              >
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
