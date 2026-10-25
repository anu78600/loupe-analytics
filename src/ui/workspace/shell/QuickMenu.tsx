"use client";

/**
 * The quick menu (version 52.1): Loupe's own launcher in the bottom-right
 * corner of the workspace, where the framework's development badge used to
 * sit, as professional apps have one. A click, or "?" anywhere outside a
 * field, opens a panel with:
 * - search and commands (the Ctrl/⌘+K palette);
 * - quick actions for where the user is: a demo or a file before any data;
 *   with a dashboard, asking for a chart and managing the charts. Steps are
 *   the sidebar's job and chart colours the toolbar's and Settings', so none
 *   is repeated here (version 52.4: each place in the app has one job);
 * - help: the glossary and what's new (each in a new tab, so the data loaded
 *   here stays), feedback, and the keyboard shortcuts;
 * - the theme and settings, the version, and that the data never leaves the
 *   browser.
 * A dot on the launcher marks a version not seen yet (kept in this browser
 * only); opening the menu clears it.
 *
 * From lg only: below it phones and tablets have the bottom bar and the top
 * bar's menu. It rises above the guided flow's dock (data-flow-dock) so it
 * never covers the dock's buttons, toasts sit above it (Toaster offset in
 * ui/common/providers), and any sheet or dialog covers it.
 */
import * as React from "react";
import {
  BookOpen,
  ChevronDown,
  ExternalLink,
  Eye,
  FileUp,
  Megaphone,
  MessageSquareHeart,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useWorkspace, type Step } from "@/store/workspace";
import { useSettings, type ThemePreference } from "@/store/settings";
import { cn, isMac } from "@/lib/utils";
import { LoupeMark } from "@/ui/brand/logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/primitives/popover";
import { Segmented } from "@/ui/primitives/segmented";
import { Tooltip } from "@/ui/primitives/tooltip";
import { Kbd } from "@/ui/primitives/misc";
import { openFeedback } from "@/ui/common/feedback/store";
import { useAskChartPanel } from "../dashboard/AskChart";
import { openDemo } from "../Shell";
import { workspacePlace } from "../feedbackPlace";
import { pickRefreshFile, useProjects } from "../projects/store";

/** The last version whose menu the user opened, so a new one shows a dot (this browser only). */
const SEEN_KEY = "loupe-seen-version";
const noSubscribe = () => () => {};
const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};

interface Action {
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  run: () => void;
}

/** Quick actions for where the user is: no data yet, data being checked, or a dashboard built. */
function useActions(): Action[] {
  const hasData = useWorkspace((s) => Boolean(s.summary));
  const hasContext = useWorkspace((s) => Boolean(s.context));
  const project = useProjects((p) => p.currentId);
  const go = (step: Step) => () => useWorkspace.getState().setStep(step);
  if (!hasData)
    return [
      { label: "Upload a file", icon: FileUp, run: go("upload") },
      { label: "Try a demo", icon: Sparkles, run: () => void openDemo("ecommerce", "dashboard") },
    ];
  if (!hasContext) return [];
  const toDashboard = (then: () => void) => () => {
    useWorkspace.getState().setStep("dashboard");
    then();
  };
  return [
    {
      label: "Ask for a chart",
      icon: MessageSquarePlus,
      run: toDashboard(() => useAskChartPanel.getState().show("ask")),
    },
    {
      label: "Manage charts",
      icon: Eye,
      run: toDashboard(() => useAskChartPanel.getState().show("charts")),
    },
    // Next month's file into this dashboard (version 55.0); only for a project kept in this browser.
    ...(project
      ? [{ label: "Refresh with new data", icon: RefreshCw, run: () => pickRefreshFile(project) }]
      : []),
  ];
}

export function QuickMenu({
  version,
  onOpenCommand,
  onOpenSettings,
}: {
  version: string;
  onOpenCommand: () => void;
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [acknowledged, setAcknowledged] = React.useState(false);
  // The server render and the first paint assume the version is seen, so no dot flashes in.
  const seen = React.useSyncExternalStore(noSubscribe, readSeen, () => version);
  const fresh = seen !== version && !acknowledged;
  const mac = React.useSyncExternalStore(noSubscribe, isMac, () => false);
  const actions = useActions();
  const hasData = useWorkspace((s) => Boolean(s.summary));
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);

  const toggle = (next: boolean) => {
    setOpen(next);
    if (next && fresh) {
      setAcknowledged(true);
      try {
        localStorage.setItem(SEEN_KEY, version);
      } catch {
        /* storage can be unavailable (private mode); the dot then shows again next visit */
      }
    }
  };

  // "?" opens and closes it, as in most apps, unless the user is typing or another dialog is open.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('[role="dialog"][data-state="open"]:not([data-quick-menu])')) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <Popover open={open} onOpenChange={toggle}>
      <Tooltip content="Quick menu">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Quick menu${fresh ? ", new version" : ""}`}
            aria-keyshortcuts="?"
            className={cn(
              "no-print fixed right-5 bottom-5 z-40 hidden size-11 items-center justify-center rounded-full border border-border bg-surface-overlay text-fg shadow-lift transition-[transform,bottom,box-shadow] duration-base ease-out-quint hover:-translate-y-0.5 hover:border-border-hover focus-visible:focus-ring lg:flex",
              // Above the guided flow's dock, so the dock's buttons are never covered.
              "[:root:has([data-flow-dock])_&]:bottom-24",
            )}
          >
            {open ? (
              <ChevronDown aria-hidden className="size-5" />
            ) : (
              <LoupeMark decorative className="size-6" />
            )}
            {fresh ? (
              <span
                aria-hidden
                className="absolute top-0.5 right-0.5 size-2.5 rounded-full bg-accent ring-2 ring-surface-overlay"
              />
            ) : null}
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        data-quick-menu
        aria-label="Quick menu"
        className="flex max-h-[calc(100dvh-6rem)] w-[22rem] flex-col overflow-hidden p-0"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <LoupeMark decorative className="size-5" />
          <span className="text-sm font-semibold text-fg">Loupe</span>
          <span className="tabular ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-2xs text-fg-muted">
            v{version}
          </span>
        </div>
        <div className="grid min-h-0 gap-4 overflow-y-auto px-3 py-3">
          <button
            type="button"
            onClick={run(onOpenCommand)}
            className="flex h-9 items-center gap-2 rounded-control border border-border bg-surface-raised-control px-2.5 text-ui text-fg-subtle shadow-card transition-colors duration-fast hover:border-border-hover hover:text-fg-muted focus-visible:focus-ring"
          >
            <Search aria-hidden className="size-4 shrink-0" />
            <span className="flex-1 text-left">Search or run a command</span>
            <span className="sr-only">, </span>
            <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>
            <Kbd>K</Kbd>
          </button>

          {actions.length ? (
            <section aria-labelledby="quick-actions" className="grid gap-2">
              <h2 id="quick-actions" className="eyebrow px-1 text-fg-subtle">
                {hasData ? "Quick actions" : "Get started"}
              </h2>
              <div className="grid grid-cols-2 gap-1.5">
                {actions.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={run(a.run)}
                    className="flex min-w-0 items-center gap-2.5 rounded-control border border-border px-2.5 py-2 text-left text-ui text-fg transition-colors duration-fast hover:border-border-hover hover:bg-surface-hover focus-visible:focus-ring"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent-text">
                      <a.icon aria-hidden className="size-4" />
                    </span>
                    <span className="min-w-0 truncate">{a.label}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section aria-labelledby="quick-help" className="grid gap-1">
            <h2 id="quick-help" className="eyebrow px-1 pb-1 text-fg-subtle">
              Help
            </h2>
            <HelpLink href="/glossary" icon={BookOpen} label="Glossary" hint="Every term, explained" />
            <HelpLink href="/changelog" icon={Megaphone} label="What's new" hint={`Version ${version}`} />
            <HelpButton
              icon={MessageSquareHeart}
              label="Send feedback"
              hint="Report a problem or suggest an idea"
              onClick={run(() => openFeedback({ place: workspacePlace() }))}
            />
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-control bg-surface-2 px-2.5 py-2 text-xs text-fg-muted">
              <span className="inline-flex items-center gap-1">
                <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>
                <Kbd>K</Kbd> search
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>?</Kbd> this menu
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>Esc</Kbd> close
              </span>
            </div>
          </section>
        </div>
        <div className="grid gap-2.5 border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Segmented<ThemePreference>
              ariaLabel="Theme"
              size="sm"
              value={theme}
              onChange={setTheme}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "Auto" },
              ]}
            />
            <button
              type="button"
              onClick={run(onOpenSettings)}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-ui text-fg-muted transition-colors duration-fast hover:bg-surface-hover hover:text-fg focus-visible:focus-ring"
            >
              <Settings2 aria-hidden className="size-4" /> Settings
            </button>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
            <ShieldCheck aria-hidden className="size-3.5 text-success" />
            Your data stays in this browser.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A help page, opened in a new tab so the data loaded here stays. */
function HelpLink({
  href,
  icon: Icon,
  label,
  hint,
}: {
  href: string;
  icon: Action["icon"];
  label: string;
  hint: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="group flex items-center gap-2.5 rounded-control px-2 py-1.5 text-ui text-fg transition-colors duration-fast hover:bg-surface-hover focus-visible:focus-ring"
    >
      <Icon aria-hidden className="size-4 shrink-0 text-fg-subtle" />
      <span className="min-w-0 flex-1">
        {label}
        <span className="block truncate text-xs text-fg-muted">{hint}</span>
      </span>
      <ExternalLink aria-hidden className="size-3.5 shrink-0 text-fg-disabled group-hover:text-fg-subtle" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function HelpButton({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: Action["icon"];
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-control px-2 py-1.5 text-left text-ui text-fg transition-colors duration-fast hover:bg-surface-hover focus-visible:focus-ring"
    >
      <Icon aria-hidden className="size-4 shrink-0 text-fg-subtle" />
      <span className="min-w-0 flex-1">
        {label}
        <span className="block truncate text-xs text-fg-muted">{hint}</span>
      </span>
    </button>
  );
}
