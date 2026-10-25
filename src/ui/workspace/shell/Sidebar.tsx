"use client";

/**
 * The workspace sidebar (version 50.1), from 1024 px wide: the wordmark, how
 * far through the steps you are, the eight steps under their four phases, and
 * links to the glossary and the version log, with the collapse toggle.
 *
 * It has two widths, set by CSS (.ws-sidebar in globals.css; sidebarState.ts
 * says when each applies): the full list, and an icon rail where each step is
 * its icon with its name in a tooltip. The sidebar is a size container, so
 * every label shows or hides with the width itself (@min-[12rem]/sidebar), and
 * on the rail a label stays as screen-reader text, so every item keeps its
 * name.
 *
 * Steps follow the step bar's gating (stepEnabled): one that can't be opened
 * yet stays focusable and says why ("Load data first"), rather than vanishing
 * from the keyboard order.
 */
import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { BookOpen, Check, History, MessageSquareHeart, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { STEPS, useWorkspace, type Step } from "@/store/workspace";
import { cn } from "@/lib/utils";
import { LoupeMark, Wordmark } from "@/ui/brand/logo";
import { Tooltip } from "@/ui/primitives/tooltip";
import { stepEnabled } from "../Shell";
import { PHASES, STEP_ICON, stepLabel } from "./phases";
import { setSidebarOpen, useRailCollapsed } from "./sidebarState";
import { openFeedback } from "@/ui/common/feedback/store";
import { workspacePlace } from "../feedbackPlace";

/** The steps where the charts need the width: the sidebar starts as the icon rail there. */
const CANVAS_STEPS: ReadonlySet<Step> = new Set<Step>(["customise", "dashboard"]);

/** Shown in place of a label on the rail, and on the full list for a step that can't be opened yet. */
function lockedReason(hasData: boolean): string {
  return hasData ? "Choose an industry first" : "Load data first";
}

export function Sidebar() {
  const ref = React.useRef<HTMLDivElement>(null);
  const rail = useRailCollapsed(ref);
  const step = useWorkspace((s) => s.step);
  const setStep = useWorkspace((s) => s.setStep);
  const hasData = useWorkspace((s) => Boolean(s.summary));
  const hasDomain = useWorkspace((s) => Boolean(s.domainId));
  const current = STEPS.findIndex((s) => s.id === step);

  return (
    // The column runs the page's whole height with its fill and edge; the panel inside stays in view
    // as the page scrolls.
    <div
      ref={ref}
      data-canvas={CANVAS_STEPS.has(step) || undefined}
      className="ws-sidebar no-print hidden shrink-0 border-r border-border bg-surface-1 transition-[width] duration-base ease-out-quint lg:block"
    >
      <aside
        aria-label="Workspace"
        className="@container/sidebar sticky top-0 flex h-dvh flex-col overflow-hidden"
      >
        {/* The same height as the top bar beside it, so their bottom edges meet in one line. */}
        <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
          <Link href="/" aria-label="Loupe home" className="rounded-control focus-visible:focus-ring">
            <span className="@min-[12rem]/sidebar:hidden">
              <LoupeMark className="size-7" />
            </span>
            <span className="hidden @min-[12rem]/sidebar:inline-flex">
              <Wordmark size="sm" />
            </span>
          </Link>
        </div>

        {hasData ? (
          <div className="hidden px-4 pt-4 @min-[12rem]/sidebar:block">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium text-fg-muted">
                Step <span className="tabular">{current + 1}</span> of{" "}
                <span className="tabular">{STEPS.length}</span>
              </span>
            </div>
            <div aria-hidden className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
              <motion.div
                className="h-full rounded-full bg-[image:var(--accent-gradient)]"
                initial={false}
                animate={{ width: `${((current + 1) / STEPS.length) * 100}%` }}
                transition={{ type: "spring", stiffness: 160, damping: 30 }}
              />
            </div>
          </div>
        ) : null}

        <nav
          aria-label="Workspace steps"
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3"
        >
          {PHASES.map((phase, p) => (
            <div key={phase.id} className={cn(p > 0 && "mt-4")}>
              <p
                id={`phase-${phase.id}`}
                className="eyebrow mb-1 hidden px-2.5 text-fg-subtle @min-[12rem]/sidebar:block"
              >
                {phase.label}
              </p>
              {/* On the rail the phases are told apart by a short rule instead of their names. */}
              {p > 0 ? (
                <span
                  aria-hidden
                  className="mx-auto mb-3 block h-px w-6 bg-border-strong @min-[12rem]/sidebar:hidden"
                />
              ) : null}
              <ul aria-labelledby={`phase-${phase.id}`} className="grid gap-0.5">
                {phase.steps.map((id) => {
                  const index = STEPS.findIndex((s) => s.id === id);
                  const enabled = stepEnabled(id, hasData, hasDomain);
                  const active = id === step;
                  const done = hasData && index < current && enabled;
                  const Icon = STEP_ICON[id];
                  const label = stepLabel(id);
                  const button = (
                    <button
                      type="button"
                      aria-current={active ? "step" : undefined}
                      aria-disabled={enabled ? undefined : true}
                      onClick={() => {
                        if (enabled) setStep(id);
                      }}
                      className={cn(
                        "relative flex h-9 w-full items-center justify-center gap-2.5 rounded-control px-2.5 text-ui font-medium transition-colors duration-fast focus-visible:focus-ring @min-[12rem]/sidebar:justify-start",
                        active ? "text-fg" : "text-fg-muted",
                        enabled
                          ? active
                            ? ""
                            : "hover:bg-surface-hover hover:text-fg"
                          : "cursor-not-allowed opacity-disabled",
                      )}
                    >
                      {active ? (
                        <motion.span
                          layoutId="sidebar-active"
                          aria-hidden
                          className="absolute inset-0 rounded-control bg-surface-selected"
                          transition={{ type: "spring", stiffness: 500, damping: 40 }}
                        >
                          <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" />
                        </motion.span>
                      ) : null}
                      <Icon
                        aria-hidden
                        className={cn(
                          "relative size-4 shrink-0",
                          active ? "text-accent-text" : done ? "text-fg-muted" : "",
                        )}
                      />
                      <span className="sr-only relative truncate @min-[12rem]/sidebar:not-sr-only">
                        {label}
                      </span>
                      {enabled ? null : <span className="sr-only">{`: ${lockedReason(hasData)}`}</span>}
                      <span
                        aria-hidden
                        className="relative ml-auto hidden shrink-0 @min-[12rem]/sidebar:inline-flex"
                      >
                        {done ? (
                          <Check className="size-3.5 text-success" strokeWidth={2.5} />
                        ) : (
                          <span className="tabular text-2xs text-fg-subtle">{index + 1}</span>
                        )}
                      </span>
                    </button>
                  );
                  // A tooltip names the step on the rail, and says why a step is locked on the full list.
                  const tip = rail
                    ? enabled
                      ? label
                      : `${label}: ${lockedReason(hasData)}`
                    : enabled
                      ? null
                      : lockedReason(hasData);
                  return (
                    <li key={id}>
                      {tip ? (
                        <Tooltip content={tip} side="right">
                          {button}
                        </Tooltip>
                      ) : (
                        button
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="grid shrink-0 gap-0.5 border-t border-border p-3">
          <Tooltip content={rail ? "Send feedback" : "A problem or an idea? Tell us"} side="right">
            <button
              type="button"
              onClick={() => openFeedback({ place: workspacePlace() })}
              className="flex h-9 w-full items-center justify-center gap-2.5 rounded-control px-2.5 text-ui text-fg-muted transition-colors duration-fast hover:bg-surface-hover hover:text-fg focus-visible:focus-ring @min-[12rem]/sidebar:justify-start"
            >
              <MessageSquareHeart aria-hidden className="size-4 shrink-0" />
              <span className="sr-only @min-[12rem]/sidebar:not-sr-only">Send feedback</span>
            </button>
          </Tooltip>
          <FooterLink href="/glossary" label="Glossary" rail={rail}>
            <BookOpen aria-hidden className="size-4 shrink-0" />
          </FooterLink>
          <FooterLink href="/changelog" label="What's new" rail={rail}>
            <History aria-hidden className="size-4 shrink-0" />
          </FooterLink>
          <Tooltip content={rail ? "Expand the sidebar" : "Collapse the sidebar"} side="right">
            <button
              type="button"
              onClick={() => setSidebarOpen(rail)}
              aria-label={rail ? "Expand the sidebar" : "Collapse the sidebar"}
              aria-expanded={!rail}
              className="flex h-9 w-full items-center justify-center gap-2.5 rounded-control px-2.5 text-ui text-fg-muted transition-colors duration-fast hover:bg-surface-hover hover:text-fg focus-visible:focus-ring @min-[12rem]/sidebar:justify-start"
            >
              {rail ? (
                <PanelLeftOpen aria-hidden className="size-4 shrink-0" />
              ) : (
                <PanelLeftClose aria-hidden className="size-4 shrink-0" />
              )}
              <span aria-hidden className="hidden @min-[12rem]/sidebar:inline">
                Collapse
              </span>
            </button>
          </Tooltip>
        </div>
      </aside>
    </div>
  );
}

/** A link in the sidebar's footer: its icon and name, or on the rail its icon with the name in a tooltip. */
function FooterLink({
  href,
  label,
  rail,
  children,
}: {
  href: string;
  label: string;
  rail: boolean;
  children: React.ReactNode;
}) {
  const link = (
    <Link
      href={href}
      className="flex h-9 items-center justify-center gap-2.5 rounded-control px-2.5 text-ui text-fg-muted transition-colors duration-fast hover:bg-surface-hover hover:text-fg focus-visible:focus-ring @min-[12rem]/sidebar:justify-start"
    >
      {children}
      <span className="sr-only @min-[12rem]/sidebar:not-sr-only">{label}</span>
    </Link>
  );
  return rail ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}
