"use client";

/**
 * The workspace's top bar (version 50.1): slim, sticky, over the content
 * beside the sidebar.
 *
 * From 1024 px it holds where you are as a breadcrumb (the file, then the
 * phase and the step: "orders.csv › Prepare › Detect") and the actions that
 * belong to the whole workspace: search (Ctrl/⌘+K, the command palette),
 * start over, settings and the theme. The steps themselves are in the sidebar.
 *
 * Below 1024 px there is no sidebar: the bar shows the mark, the phase and
 * step, and the same actions (on phones the rarer ones fold into a menu),
 * and a second row lists the steps of the current phase, so with the bottom
 * bar's phases every step is two taps away. A line along its bottom edge
 * shows how far through the steps you are.
 */
import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Check,
  ChevronRight,
  Database,
  Moon,
  MoreHorizontal,
  RotateCcw,
  Search,
  Settings2,
  Sun,
} from "lucide-react";
import { STEPS, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { cn, isMac } from "@/lib/utils";
import { LoupeMark } from "@/ui/brand/logo";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { Kbd } from "@/ui/primitives/misc";
import { Tooltip } from "@/ui/primitives/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/primitives/dropdown-menu";
import { ThemeToggle } from "@/ui/common/theme-toggle";
import { useThemeKey } from "@/ui/common/hooks";
import { countOf } from "@/ui/common/words";
import { describeModel, modelLabel } from "@/engine/core/model";
import { confirmStartOver, stepEnabled } from "../Shell";
import { phaseOf, STEP_ICON, stepLabel } from "./phases";

/** No-op subscription: the platform never changes while the page is open. */
const subscribePlatform = () => () => {};

export function TopBar({
  onOpenCommand,
  onOpenSettings,
}: {
  onOpenCommand: () => void;
  onOpenSettings: () => void;
}) {
  const step = useWorkspace((s) => s.step);
  const hasData = useWorkspace((s) => Boolean(s.summary));
  const stepIndex = STEPS.findIndex((x) => x.id === step);
  const phase = phaseOf(step);
  // The platform is only known in the browser; the server render assumes non-Mac (Ctrl+K).
  const mac = React.useSyncExternalStore(subscribePlatform, isMac, () => false);

  return (
    <header className="no-print sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-3 px-4 md:px-6">
        <Link
          href="/"
          aria-label="Loupe home"
          className="shrink-0 rounded-control focus-visible:focus-ring lg:hidden"
        >
          <LoupeMark className="size-6" />
        </Link>

        {/* Below lg: the phase over the step. */}
        <div className="min-w-0 lg:hidden">
          <p className="eyebrow truncate text-fg-subtle">{phase.label}</p>
          <p className="truncate text-sm leading-5 font-semibold text-fg">{stepLabel(step)}</p>
        </div>

        <Breadcrumb />

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* A search field's look from lg, so the shortcut is learnt; an icon below that. */}
          <button
            type="button"
            onClick={onOpenCommand}
            className="hidden h-8 w-56 items-center gap-2 rounded-control border border-border bg-surface-raised-control px-2.5 text-ui text-fg-subtle shadow-card transition-colors duration-fast hover:border-border-hover hover:text-fg-muted focus-visible:focus-ring lg:flex xl:w-64"
          >
            <Search aria-hidden className="size-3.5 shrink-0" />
            {/* Name from content, so it includes the visible shortcut (WCAG 2.5.3 label in name). */}
            <span className="flex-1 text-left">Search</span>
            <span className="sr-only">, </span>
            <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>
            <Kbd>K</Kbd>
          </button>
          <Tooltip content="Search actions, charts and KPIs">
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenCommand}
              aria-label="Search"
              className="lg:hidden"
            >
              <Search aria-hidden />
            </Button>
          </Tooltip>
          {hasData ? (
            <Tooltip content="Start over (clears the data from memory)">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void confirmStartOver()}
                aria-label="Start over"
                className="max-sm:hidden"
              >
                <RotateCcw aria-hidden />
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip content="Settings">
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenSettings}
              aria-label="Settings"
              className="max-sm:hidden"
            >
              <Settings2 aria-hidden />
            </Button>
          </Tooltip>
          <span className="max-sm:hidden">
            <ThemeToggle compact />
          </span>
          <MoreMenu hasData={hasData} onOpenSettings={onOpenSettings} />
        </div>
      </div>

      <PhaseSteps />

      {/* How far through the steps you are, as a line along the bar's bottom edge. */}
      <motion.div
        aria-hidden
        className="absolute inset-x-0 -bottom-px h-px origin-left bg-[image:var(--accent-gradient)]"
        initial={false}
        animate={{ scaleX: hasData ? (stepIndex + 1) / STEPS.length : 0 }}
        transition={{ type: "spring", stiffness: 160, damping: 30 }}
      />
    </header>
  );
}

/** From lg: the file, the phase and the step. The file part says it all in its tooltip. */
function Breadcrumb() {
  const summary = useWorkspace((s) => s.summary);
  const sampled = useWorkspace((s) => Boolean(s.report?.sampling));
  const step = useWorkspace((s) => s.step);
  const locale = useSettings((s) => s.numberLocale);
  const phase = phaseOf(step);
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 flex-1 lg:block">
      <ol className="flex min-w-0 items-center gap-1.5 text-ui">
        {summary ? (
          <>
            <li
              className="flex min-w-0 items-center gap-2"
              title={`${summary.fileName}${summary.model ? ` · ${describeModel(summary.model)}` : summary.sheet ? ` · sheet "${summary.sheet}"` : ""} · ${countOf(summary.rowCount, "row", locale)}${sampled ? " (a sample of the file)" : ""}${summary.isDemo ? " · demo data" : ""}`}
            >
              <Database aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
              <span className="max-w-[260px] truncate font-medium text-fg">
                {summary.fileName}
                {summary.model || summary.sheet ? (
                  <span className="font-normal text-fg-subtle">
                    {" "}
                    · {summary.model ? modelLabel(summary.model) : summary.sheet}
                  </span>
                ) : null}
              </span>
              <Badge tone={summary.isDemo ? "accent" : "success"} className="shrink-0">
                {summary.isDemo ? "Demo data" : "Your file"}
              </Badge>
              {/* A sample is never mistaken for the whole file: totals describe the rows loaded. */}
              {sampled ? (
                <Badge tone="warning" className="shrink-0">
                  Sampled
                </Badge>
              ) : null}
              <span className="hidden shrink-0 text-xs whitespace-nowrap text-fg-subtle 2xl:inline">
                {countOf(summary.rowCount, "row", locale)}
              </span>
            </li>
            <li aria-hidden className="shrink-0 text-fg-disabled">
              <ChevronRight className="size-3.5" />
            </li>
          </>
        ) : null}
        <li className="shrink-0 text-fg-muted">{phase.label}</li>
        <li aria-hidden className="shrink-0 text-fg-disabled">
          <ChevronRight className="size-3.5" />
        </li>
        <li aria-current="page" className="shrink-0 font-medium text-fg">
          {stepLabel(step)}
        </li>
      </ol>
    </nav>
  );
}

/**
 * Below lg: the steps of the current phase as a row of pills under the bar
 * (none for a phase of one step). Paired with the bottom bar's phases.
 */
function PhaseSteps() {
  const step = useWorkspace((s) => s.step);
  const setStep = useWorkspace((s) => s.setStep);
  const hasData = useWorkspace((s) => Boolean(s.summary));
  const hasDomain = useWorkspace((s) => Boolean(s.domainId));
  const phase = phaseOf(step);
  const current = STEPS.findIndex((s) => s.id === step);
  if (phase.steps.length < 2) return null;
  return (
    <nav aria-label={`${phase.label} steps`} className="lg:hidden">
      <ul className="flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-4 pb-2.5 md:px-6">
        {phase.steps.map((id) => {
          const index = STEPS.findIndex((s) => s.id === id);
          const enabled = stepEnabled(id, hasData, hasDomain);
          const active = id === step;
          const done = hasData && index < current && enabled;
          const Icon = STEP_ICON[id];
          return (
            <li key={id} className="shrink-0">
              <button
                type="button"
                aria-current={active ? "step" : undefined}
                aria-disabled={enabled ? undefined : true}
                onClick={() => {
                  if (enabled) setStep(id);
                }}
                className={cn(
                  "relative inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-ui font-medium transition-colors duration-fast focus-visible:focus-ring",
                  active ? "border-border-accent text-accent-text" : "border-border text-fg-muted",
                  enabled ? (active ? "" : "hover:bg-surface-hover hover:text-fg") : "opacity-disabled",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="phase-step-active"
                    aria-hidden
                    className="absolute inset-0 rounded-full bg-surface-selected"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                ) : null}
                {done ? (
                  <Check aria-hidden className="relative size-3.5 text-success" strokeWidth={2.5} />
                ) : (
                  <Icon aria-hidden className="relative size-3.5" />
                )}
                <span className="relative">{stepLabel(id)}</span>
                {enabled ? null : (
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

/** On phones: settings, the theme and start over, folded into one menu. */
function MoreMenu({ hasData, onOpenSettings }: { hasData: boolean; onOpenSettings: () => void }) {
  const setTheme = useSettings((s) => s.setTheme);
  const resolved = useThemeKey();
  const next = resolved === "light" ? "dark" : "light";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="More actions" className="sm:hidden">
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem onSelect={onOpenSettings}>
          <Settings2 aria-hidden /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme(next)}>
          {next === "dark" ? <Moon aria-hidden /> : <Sun aria-hidden />} Switch to {next} theme
        </DropdownMenuItem>
        {hasData ? (
          <DropdownMenuItem onSelect={() => void confirmStartOver()}>
            <RotateCcw aria-hidden /> Start over
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
