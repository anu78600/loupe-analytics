"use client";

/**
 * Ctrl/⌘+K command palette (cmdk inside a Radix dialog): jump to steps,
 * charts and KPIs, switch layout mode, theme and number format, open settings
 * or the version log, and load demo data. "Go to" follows the same gating as
 * the step bar (a step that needs data or an industry first is shown, but
 * cannot be chosen), and a demo asks before it replaces the user's own file.
 * PaletteBody subscribes to the workspace store only while the palette is
 * open, so it costs nothing when closed. It opens and closes without
 * animation (a keyboard action), and closing gives focus back to where it
 * was: it draws its own Radix dialog, with the dialog primitive's focus
 * handlers (useDialogFocus in ui/primitives/dialog.tsx).
 */
import * as React from "react";
import { Command } from "cmdk";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  FileDown,
  Hash,
  History,
  LayoutGrid,
  Moon,
  Palette,
  Search,
  Settings2,
  Sparkles,
  Sun,
} from "lucide-react";
import { SAMPLES } from "@/engine/samples/catalog";
import { allSpecs, STEPS, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { cn } from "@/lib/utils";
import { useDialogFocus } from "@/ui/primitives/dialog";
import { useChartColoursPanel } from "./ChartColours";
import { openDemo, stepEnabled } from "./Shell";

const itemClass =
  "flex cursor-default select-none items-center gap-2.5 rounded-control px-2.5 py-2 text-ui text-fg outline-none data-[selected=true]:bg-surface-hover [&_svg]:size-4 [&_svg]:text-fg-subtle";
const groupHeading =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5";

/**
 * A group's heading in the one small-label style (.eyebrow). cmdk renders the
 * heading in its own element, and .eyebrow is a plain utility class that a
 * Tailwind variant can't reach, so the label is passed in already styled.
 */
function heading(text: string) {
  return <span className="eyebrow text-fg-subtle">{text}</span>;
}

export function CommandPalette({
  open,
  onOpenChange,
  onOpenSettings,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onOpenSettings: () => void;
}) {
  const focus = useDialogFocus();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-overlay backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          {...focus}
          className="fixed top-[14vh] left-1/2 z-[70] w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-panel border border-border bg-surface-overlay shadow-lift outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search actions, charts and KPIs
          </DialogPrimitive.Description>
          <PaletteBody onClose={() => onOpenChange(false)} onOpenSettings={onOpenSettings} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PaletteBody({ onClose, onOpenSettings }: { onClose: () => void; onOpenSettings: () => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const locale = useSettings((s) => s.numberLocale);
  const setLocale = useSettings((s) => s.setNumberLocale);
  const run = (fn: () => void) => {
    onClose();
    setTimeout(fn, 10);
  };
  const specs = ws.context ? allSpecs(ws) : [];
  return (
    <Command label="Command palette" className="flex max-h-[60vh] flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4">
        <Search className="size-4 text-fg-subtle" aria-hidden />
        {/* Radix focuses it on open (no autoFocus, which would move focus before the dialog reads its opener). */}
        <Command.Input
          placeholder="Search actions, charts, KPIs…"
          className="h-12 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
        />
      </div>
      <Command.List className="overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-ui text-fg-muted">No matches.</Command.Empty>
        <Command.Group heading={heading("Go to")} className={groupHeading}>
          {STEPS.map((s) => {
            const enabled = stepEnabled(s.id, Boolean(ws.summary), Boolean(ws.domainId));
            return (
              <Command.Item
                key={s.id}
                value={`go ${s.label}`}
                disabled={!enabled}
                className={cn(itemClass, "data-[disabled=true]:opacity-disabled")}
                onSelect={() => run(() => ws.setStep(s.id))}
              >
                <LayoutGrid aria-hidden /> {s.label}
                {enabled ? null : (
                  <span className="ml-auto text-xs text-fg-subtle">
                    {ws.summary ? "Choose an industry first" : "Load data first"}
                  </span>
                )}
              </Command.Item>
            );
          })}
        </Command.Group>
        {specs.length ? (
          <Command.Group heading={heading("Charts")} className={groupHeading}>
            {specs.map((s) => (
              <Command.Item
                key={s.id}
                value={`chart ${s.title}`}
                className={itemClass}
                onSelect={() => run(() => ws.focusChart(s.id))}
              >
                <BarChart3 aria-hidden /> {s.title}
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}
        {ws.context ? (
          <Command.Group heading={heading("KPIs")} className={groupHeading}>
            {ws.context.kpis
              .filter((k) => k.available && !k.hidden)
              .map((k) => (
                <Command.Item
                  key={k.id}
                  value={`kpi ${k.name} ${k.short ?? ""}`}
                  className={itemClass}
                  onSelect={() =>
                    run(() => {
                      ws.setStep("dashboard");
                      ws.select({ type: "kpi", id: k.id });
                    })
                  }
                >
                  <Hash aria-hidden /> {k.name}
                </Command.Item>
              ))}
          </Command.Group>
        ) : null}
        <Command.Group heading={heading("Actions")} className={groupHeading}>
          {ws.context ? (
            <>
              {(["executive", "analyst", "compact"] as const).map((m) => (
                <Command.Item
                  key={m}
                  value={`layout ${m}`}
                  className={itemClass}
                  onSelect={() => run(() => ws.setMode(m))}
                >
                  <LayoutGrid aria-hidden /> Layout: {m}
                </Command.Item>
              ))}
              <Command.Item value="clear filters" className={itemClass} onSelect={() => run(ws.clearFilters)}>
                <LayoutGrid aria-hidden /> Clear all filters
              </Command.Item>
              <Command.Item
                value="export power bi pdf sql"
                className={itemClass}
                onSelect={() => run(() => ws.setStep("export"))}
              >
                <FileDown aria-hidden /> Export (Power BI, PDF, PNG, SQL)
              </Command.Item>
            </>
          ) : null}
          <Command.Item
            value="toggle theme dark light"
            className={itemClass}
            onSelect={() => run(() => setTheme(theme === "light" ? "dark" : "light"))}
          >
            {theme === "light" ? <Moon aria-hidden /> : <Sun aria-hidden />} Switch to{" "}
            {theme === "light" ? "dark" : "light"} theme
          </Command.Item>
          <Command.Item
            value="chart colours colors palette theme gradient brand"
            className={itemClass}
            onSelect={() => run(() => useChartColoursPanel.getState().setOpen(true))}
          >
            <Palette aria-hidden /> Chart colours
          </Command.Item>
          <Command.Item
            value="number format indian international lakh crore"
            className={itemClass}
            onSelect={() => run(() => setLocale(locale === "IN" ? "INTL" : "IN"))}
          >
            <Hash aria-hidden /> Number format: switch to{" "}
            {locale === "IN" ? "international (M/B)" : "Indian (lakh/crore)"}
          </Command.Item>
          <Command.Item value="settings ai" className={itemClass} onSelect={() => run(onOpenSettings)}>
            <Settings2 aria-hidden /> Open settings
          </Command.Item>
          <Command.Item
            value="version log changelog what changed"
            className={itemClass}
            onSelect={() => run(() => router.push("/changelog"))}
          >
            <History aria-hidden /> Open the version log
          </Command.Item>
        </Command.Group>
        <Command.Group heading={heading("Demo data")} className={groupHeading}>
          {SAMPLES.map((s) => (
            <Command.Item
              key={s.id}
              value={`sample demo ${s.name}`}
              className={itemClass}
              onSelect={() => run(() => void openDemo(s.id, undefined, true))}
            >
              <Sparkles aria-hidden /> Load demo: {s.name}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command>
  );
}
