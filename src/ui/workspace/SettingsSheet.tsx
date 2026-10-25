"use client";

/**
 * Settings sheet: theme and chart colours, number format (Indian lakh/crore or international)
 * and currency, whether Loupe may add columns (ask first or never), the
 * privacy statement, what Loupe has learned from the user's corrections
 * (LearnedSettings: list, delete, clear, export and import), the opt-in AI
 * layer (API key kept in memory only, model choice) and a link to the
 * version log. Each explanation is one short line, or an ⓘ beside its
 * label, with the full text behind hover, a long press or the ⓘ
 * (ui/primitives/reveal.tsx). Opened from the top bar or the command palette,
 * it gives focus back to where it was when it closes, also after it hands
 * over to Chart colours (the Sheet primitive's focus return, useDialogFocus
 * in ui/primitives/dialog.tsx).
 */
import * as React from "react";
import Link from "next/link";
import { Bot, History, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { useSettings, type NewColumnsPolicy, type NumberLocale } from "@/store/settings";
import { useWorkspace } from "@/store/workspace";
import { formatValue, SUPPORTED_CURRENCIES, currencySymbol } from "@/engine/core/format";
import { AI_MODELS } from "@/lib/ai";
import { Sheet, SheetContent } from "@/ui/primitives/sheet";
import { Segmented } from "@/ui/primitives/segmented";
import { Switch } from "@/ui/primitives/switch";
import { Input, Label } from "@/ui/primitives/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitives/select";
import { Badge } from "@/ui/primitives/badge";
import { Eyebrow, Separator } from "@/ui/primitives/misc";
import { ThemeToggle } from "@/ui/common/theme-toggle";
import { Brief, InfoTip } from "@/ui/primitives/reveal";
import { ChartColoursButton } from "./ChartColours";
import { LearnedSettings } from "./LearnedSettings";

/** `version` comes from the server page, so the client bundle doesn't carry the whole version log. */
export function SettingsSheet({
  open,
  onOpenChange,
  version,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  version: string;
}) {
  const locale = useSettings((s) => s.numberLocale);
  const setLocale = useSettings((s) => s.setNumberLocale);
  const auto = useSettings((s) => s.numberFormatAuto);
  const setAuto = useSettings((s) => s.setNumberFormatAuto);
  const applyAuto = useSettings((s) => s.applyAutoNumberLocale);
  const currency = useSettings((s) => s.currencyOverride);
  const setOverride = useSettings((s) => s.setCurrencyOverride);
  const defaultCurrency = useSettings((s) => s.defaultCurrency);
  const setDefaultCurrency = useSettings((s) => s.setDefaultCurrency);
  const hasFile = useWorkspace((s) => Boolean(s.profile));
  const newColumns = useSettings((s) => s.newColumns);
  const setNewColumns = useSettings((s) => s.setNewColumns);
  const ai = useSettings((s) => s.ai);
  const setAi = useSettings((s) => s.setAi);
  // "" when the file has no currency: amounts show with no symbol.
  const detected = useWorkspace((s) => s.profile?.currency.code ?? "");
  // Below this confidence the code is the default, not something found in the file.
  const evidence = useWorkspace((s) => (s.profile?.currency.confidence ?? 0) >= 0.5);
  const sampleCurrency = currency ?? detected;
  // A currency chosen for a file that shows none is remembered for the next such file.
  const setCurrency = (code: string | null) => {
    setOverride(code);
    if (hasFile && !detected) setDefaultCurrency(code);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" title="Settings" description="Preferences are stored in this browser only.">
        <div className="grid gap-7 p-6">
          <section className="grid gap-3">
            <Eyebrow>Appearance</Eyebrow>
            <div className="flex items-center justify-between">
              <Label>Theme</Label>
              <ThemeToggle />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <Label>Chart colours</Label>
                <InfoTip label="About chart colours">
                  Presets, your own colours, or a gradient from one colour.
                </InfoTip>
              </div>
              {/* The colours panel is a sheet of its own, so Settings closes first. */}
              <ChartColoursButton label="Change" onOpen={() => onOpenChange(false)} />
            </div>
          </section>
          <Separator />
          <section className="grid gap-3">
            <div className="flex items-center gap-1.5">
              <Eyebrow>Numbers & currency</Eyebrow>
              {auto ? (
                <InfoTip label="About the automatic number format">
                  Auto uses lakh/crore for rupee data and K/M/B otherwise.
                </InfoTip>
              ) : null}
            </div>
            <Segmented<NumberLocale | "auto">
              ariaLabel="Number format"
              value={auto ? "auto" : locale}
              onChange={(v) => {
                if (v === "auto") {
                  setAuto(true);
                  applyAuto(sampleCurrency);
                } else setLocale(v);
              }}
              options={[
                { value: "auto", label: "Auto" },
                { value: "IN", label: "Lakh/crore" },
                { value: "INTL", label: "International" },
              ]}
            />
            <p className="font-figures text-ui text-fg-muted">
              {formatValue(12345678.9, "currency", { locale, currency: sampleCurrency })} ·{" "}
              {formatValue(12345678.9, "currency", { locale, currency: sampleCurrency, compact: true })}
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor="settings-currency">Currency</Label>
              <Select value={currency ?? "auto"} onValueChange={(v) => setCurrency(v === "auto" ? null : v)}>
                <SelectTrigger id="settings-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    {evidence ? "Detected" : "Default"} ({detected || "no symbol"})
                  </SelectItem>
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c} hint={currencySymbol(c).trim()}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {defaultCurrency ? (
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
                  Files without a currency use {defaultCurrency}.
                  <button
                    type="button"
                    onClick={() => setDefaultCurrency(null)}
                    className="rounded-sm text-accent-text underline-offset-2 hover:underline focus-visible:focus-ring"
                  >
                    Forget
                  </button>
                </p>
              ) : null}
            </div>
          </section>
          <Separator />
          <section className="grid gap-3">
            <Eyebrow>New columns</Eyebrow>
            <Segmented<NewColumnsPolicy>
              ariaLabel="Adding columns to your data"
              value={newColumns}
              onChange={setNewColumns}
              options={[
                { value: "ask", label: "Ask first" },
                { value: "never", label: "Never add" },
              ]}
            />
            <p className="text-sm leading-relaxed text-fg-subtle">
              <Brief
                label="About new columns"
                full={`The dashboard uses only the columns in your file. Unpivoting a wide layout and a few Power BI helpers would add one; ${
                  newColumns === "ask"
                    ? "Loupe shows exactly which and waits for your yes."
                    : "with “Never add”, Loupe builds without them and adds nothing."
                }`}
              >
                {newColumns === "ask" ? "Loupe asks before adding any column." : "Loupe never adds a column."}
              </Brief>
            </p>
          </section>
          <Separator />
          <section className="grid gap-3">
            <Eyebrow>Privacy</Eyebrow>
            <p className="flex gap-2 text-sm leading-relaxed text-fg-muted">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <Brief
                label="About privacy"
                full={
                  <>
                    <span className="block">
                      Files are parsed and analysed in a background thread of this tab. There is no server and
                      no account. The page&apos;s Content-Security-Policy only allows network requests to the
                      DuckDB download (when you verify SQL) and, if you switch it on, the Anthropic API.
                    </span>
                    <span className="mt-1.5 block">
                      What Loupe learns from your corrections stays in this browser too, as header names and
                      your choices only, never cell values.
                    </span>
                  </>
                }
              >
                No server, no account: it all stays in this tab.
              </Brief>
            </p>
          </section>
          <Separator />
          <LearnedSettings />
          <Separator />
          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Eyebrow>AI layer</Eyebrow>
                <p className="mt-1 text-ui text-fg">Optional, off by default</p>
              </div>
              <Switch
                checked={ai.enabled}
                onCheckedChange={(v) => setAi({ enabled: v })}
                aria-label="Enable AI layer"
              />
            </div>
            <p className="text-sm leading-relaxed text-fg-muted">
              <Brief
                label="About the AI layer"
                full="Adds a second opinion on the industry and an executive summary written from the computed insights. Everything else works without it. Each request shows you the exact payload first; it contains schema, aggregates and a few masked rows, never your dataset."
              >
                Industry check and summary; you approve each payload.
              </Brief>
            </p>
            {ai.enabled ? (
              // Inside the sheet, a group sits on the overlay plane with a border only (docs/DESIGN.md).
              <div className="grid gap-3 rounded-card border border-border p-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="ai-key" className="flex items-center gap-1.5">
                    <KeyRound className="size-3.5" aria-hidden /> Anthropic API key
                  </Label>
                  <Input
                    id="ai-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="sk-ant-…"
                    value={ai.apiKey}
                    onChange={(e) => setAi({ apiKey: e.target.value.trim() })}
                  />
                  <p className="flex items-start gap-1.5 text-xs text-fg-subtle">
                    <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
                    <Brief
                      label="About your API key"
                      full="Kept in memory for this tab only; never saved or sent anywhere except api.anthropic.com."
                    >
                      Kept in memory for this tab only.
                    </Brief>
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ai-model" className="flex items-center gap-1.5">
                    <Bot className="size-3.5" aria-hidden /> Model
                  </Label>
                  <Select value={ai.model} onValueChange={(v) => setAi({ model: v })}>
                    <SelectTrigger id="ai-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AI_MODELS.map((m) => (
                        <SelectItem key={m.id} value={m.id} hint={m.note}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="flex items-center gap-1.5 text-xs leading-relaxed text-fg-subtle">
                  <Badge tone="outline">Refusal fallback on</Badge>
                  <InfoTip label="About refusal fallback">
                    Opus and Sonnet requests opt into server-side refusal fallback, so a declined request can
                    be completed by a fallback model instead of failing.
                  </InfoTip>
                </p>
              </div>
            ) : null}
          </section>
          <Separator />
          <section className="grid gap-2">
            <div className="flex items-center gap-1.5">
              <Eyebrow>About</Eyebrow>
              <InfoTip label="About the version log">
                Every step of building Loupe, as major and minor versions.
              </InfoTip>
            </div>
            <Link
              href="/changelog"
              className="flex items-center justify-between gap-3 rounded-card border border-border px-4 py-3 text-ui transition-colors hover:border-border-hover hover:bg-surface-hover active:bg-surface-active"
            >
              <span className="flex items-center gap-2 text-fg">
                <History className="size-4 text-fg-subtle" aria-hidden /> Version log
              </span>
              <span className="font-figures text-fg-subtle">v{version}</span>
            </Link>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
