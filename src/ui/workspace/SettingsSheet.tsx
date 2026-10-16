"use client";

/**
 * Settings sheet: theme and chart colours, number format (Indian lakh/crore or international)
 * and currency, whether Loupe may add columns (ask first or never), the
 * privacy statement, the opt-in AI layer (API key kept in
 * memory only, model choice) and a link to the version log.
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
import { ChartColoursButton } from "./ChartColours";

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
  const setCurrency = useSettings((s) => s.setCurrencyOverride);
  const newColumns = useSettings((s) => s.newColumns);
  const setNewColumns = useSettings((s) => s.setNewColumns);
  const ai = useSettings((s) => s.ai);
  const setAi = useSettings((s) => s.setAi);
  const detected = useWorkspace((s) => s.profile?.currency.code ?? "INR");
  const sampleCurrency = currency ?? detected;
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
              <div>
                <Label>Chart colours</Label>
                <p className="mt-0.5 text-2xs text-fg-subtle">
                  Presets, your own colours, or a gradient from one colour.
                </p>
              </div>
              {/* The colours panel is a sheet of its own, so Settings closes first. */}
              <ChartColoursButton label="Change" onOpen={() => onOpenChange(false)} />
            </div>
          </section>
          <Separator />
          <section className="grid gap-3">
            <Eyebrow>Numbers & currency</Eyebrow>
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
            {auto ? (
              <p className="text-2xs text-fg-subtle">
                Auto uses lakh/crore for rupee data and K/M/B otherwise.
              </p>
            ) : null}
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
                  <SelectItem value="auto">Detected ({detected})</SelectItem>
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c} hint={currencySymbol(c).trim()}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <p className="text-2xs leading-relaxed text-fg-subtle">
              The dashboard uses only the columns in your file. Unpivoting a wide layout and a few Power BI
              helpers would add one;{" "}
              {newColumns === "ask"
                ? "Loupe shows exactly which and waits for your yes."
                : "with “Never add”, Loupe builds without them and adds nothing."}
            </p>
          </section>
          <Separator />
          <section className="grid gap-3">
            <Eyebrow>Privacy</Eyebrow>
            <p className="flex gap-2 text-ui leading-relaxed text-fg-muted">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              Files are parsed and analysed in a background thread of this tab. There is no server and no
              account. The page&apos;s Content-Security-Policy only allows network requests to the DuckDB
              download (when you verify SQL) and, if you switch it on, the Anthropic API.
            </p>
          </section>
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
            <p className="text-ui leading-relaxed text-fg-muted">
              Adds a second opinion on the industry and an executive summary written from the computed
              findings. Everything else works without it. Each request shows you the exact payload first; it
              contains schema, aggregates and a few masked rows, never your dataset.
            </p>
            {ai.enabled ? (
              <div className="grid gap-3 rounded-card border border-border bg-surface-2 p-4">
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
                  <p className="flex items-center gap-1.5 text-2xs text-fg-subtle">
                    <Lock className="size-3" aria-hidden /> Kept in memory for this tab only; never saved or
                    sent anywhere except api.anthropic.com.
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
                <p className="text-2xs text-fg-subtle">
                  <Badge tone="outline">Refusal fallback on</Badge> Opus and Sonnet requests opt into
                  server-side refusal fallback, so a declined request can be completed by a fallback model
                  instead of failing.
                </p>
              </div>
            ) : null}
          </section>
          <Separator />
          <section className="grid gap-2">
            <Eyebrow>About</Eyebrow>
            <Link
              href="/changelog"
              className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface-2 px-4 py-3 text-ui transition-colors hover:border-border-accent"
            >
              <span className="flex items-center gap-2 text-fg">
                <History className="size-4 text-fg-subtle" aria-hidden /> Version log
              </span>
              <span className="font-figures text-fg-subtle">v{version}</span>
            </Link>
            <p className="text-2xs text-fg-subtle">
              Every step of building Loupe, as major and minor versions.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
