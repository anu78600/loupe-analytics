"use client";

/**
 * Ctrl/⌘+K command palette (cmdk inside a Radix dialog): jump to steps,
 * charts and KPIs, switch layout mode, theme and number format, open settings
 * or the version log, and load demo data. PaletteBody subscribes to the
 * workspace store only while the palette is open, so it costs nothing when
 * closed.
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
  Search,
  Settings2,
  Sparkles,
  Sun,
} from "lucide-react";
import { SAMPLES } from "@/engine/samples/catalog";
import { allSpecs, STEPS, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";

const itemClass =
  "flex cursor-default select-none items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-ui text-fg outline-none data-[selected=true]:bg-surface-3 [&_svg]:size-4 [&_svg]:text-fg-subtle";
const groupHeading =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.1em] [&_[cmdk-group-heading]]:text-fg-subtle";

export function CommandPalette({
  open,
  onOpenChange,
  onOpenSettings,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onOpenSettings: () => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-overlay backdrop-blur-[2px]" />
        <DialogPrimitive.Content className="fixed top-[14vh] left-1/2 z-[70] w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-panel border border-border-strong bg-surface-1 shadow-lift outline-none">
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
        <Command.Input
          autoFocus
          placeholder="Search actions, charts, KPIs…"
          className="h-12 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
        />
      </div>
      <Command.List className="overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-ui text-fg-muted">No matches.</Command.Empty>
        <Command.Group heading="Go to" className={groupHeading}>
          {STEPS.map((s) => (
            <Command.Item
              key={s.id}
              value={`go ${s.label}`}
              className={itemClass}
              onSelect={() => run(() => ws.setStep(s.id))}
            >
              <LayoutGrid aria-hidden /> {s.label}
            </Command.Item>
          ))}
        </Command.Group>
        {specs.length ? (
          <Command.Group heading="Charts" className={groupHeading}>
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
          <Command.Group heading="KPIs" className={groupHeading}>
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
        <Command.Group heading="Actions" className={groupHeading}>
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
        <Command.Group heading="Demo data" className={groupHeading}>
          {SAMPLES.map((s) => (
            <Command.Item
              key={s.id}
              value={`sample demo ${s.name}`}
              className={itemClass}
              onSelect={() => run(() => void ws.loadSample(s.id))}
            >
              <Sparkles aria-hidden /> Load demo: {s.name}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command>
  );
}
