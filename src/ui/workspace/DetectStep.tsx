"use client";

/**
 * Step 2, Detect & confirm. Shows the top industries with confidence, the
 * evidence (which column matched which field) and the structure (grain, time
 * axis), with tabs for the data preview, data health and the parse report.
 * BusinessForm lets the user set industry, data shape (sub-domain), business
 * model, goal, reporting period and currency: the user's choice always
 * overrides detection and the dashboard regenerates instantly. Also hosts the
 * optional AI second opinion, and the wide-format banner, whose unpivot adds
 * two columns and so asks first (useColumnConsent).
 */
import * as React from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Columns3,
  Fingerprint,
  Gauge,
  ListChecks,
  Sparkles,
  Table2,
  Waypoints,
} from "lucide-react";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { SUPPORTED_CURRENCIES, currencySymbol, formatCount } from "@/engine/core/format";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Card } from "@/ui/primitives/card";
import { Label, Textarea } from "@/ui/primitives/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/ui/primitives/select";
import { Segmented } from "@/ui/primitives/segmented";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/primitives/tabs";
import { Eyebrow } from "@/ui/primitives/misc";
import { Tooltip } from "@/ui/primitives/tooltip";
import { DomainIcon } from "@/ui/common/domain-icon";
import { ConfidenceRing } from "./ConfidenceRing";
import { VirtualGrid } from "./VirtualGrid";
import { HealthPanel, ParseReportPanel } from "./HealthPanel";
import { useColumnConsent } from "./NewColumnsDialog";
import { unpivotColumnNames } from "@/engine/parse/unpivot";
import { AiDomainCheck } from "./AiSummary";

const MODELS = ["D2C brand", "Marketplace seller", "B2B", "Subscription", "Retail / offline", "Other"];
const GOALS = [
  { value: "growth", label: "Growth" },
  { value: "profit", label: "Profit" },
  { value: "retention", label: "Retention" },
  { value: "efficiency", label: "Efficiency" },
] as const;

export function DetectStep() {
  const detection = useWorkspace((s) => s.detection);
  const profile = useWorkspace((s) => s.profile);
  const summary = useWorkspace((s) => s.summary);
  const health = useWorkspace((s) => s.health);
  const report = useWorkspace((s) => s.report);
  const timings = useWorkspace((s) => s.timings);
  const unpivot = useWorkspace((s) => s.unpivot);
  const locale = useSettings((s) => s.numberLocale);
  const consent = useColumnConsent();
  if (!detection || !profile || !summary) return null;
  const wide = profile.wide;
  // Unpivoting replaces the period columns with two new ones, so it only runs after a yes.
  const askUnpivot = async () => {
    if (!wide) return;
    const names = unpivotColumnNames(
      profile.columns.map((c) => c.name),
      wide,
    );
    const ok = await consent.ask({
      title: "Unpivot adds 2 columns",
      intro: `Unpivoting turns your ${wide.columns.length} period columns into rows, so each row holds one period and its value. The dashboard is then rebuilt from the new layout.`,
      columns: [
        {
          name: names.period,
          source: `the ${wide.columns.length} period headers`,
          reason: `the ${wide.kind === "year" ? "year" : "period"} each value belongs to`,
        },
        { name: names.value, source: "the period columns' cells", reason: "the number for that period" },
      ],
      replaces: wide.columns,
      ifNo: "Your columns stay exactly as they are, and the dashboard keeps using them.",
      yesLabel: "Unpivot and add 2 columns",
      noLabel: "Keep my columns",
    });
    if (ok) await unpivot();
  };
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-8 md:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Step 2 · Detect & confirm</Eyebrow>
          <h1 className="mt-2 font-display text-display-sm text-fg">What kind of data is this?</h1>
        </div>
        <p className="font-figures text-ui text-fg-muted">
          {formatCount(summary.rowCount, locale)} rows · {summary.columnCount} columns ·{" "}
          {profile.grain.description}
        </p>
      </div>
      {profile.wide ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-card border border-info/30 bg-info-soft px-4 py-3">
          <p className="text-ui text-fg">
            <span className="font-medium">Wide format detected.</span> {profile.wide.suggestion}
          </p>
          <Button size="sm" variant="secondary" onClick={() => void askUnpivot()}>
            <Waypoints aria-hidden /> Unpivot (adds 2 columns)…
          </Button>
          {consent.dialog}
        </div>
      ) : null}
      <Tabs defaultValue="detect">
        <TabsList className="mb-5">
          <TabsTrigger value="detect">
            <Fingerprint aria-hidden /> Detection
          </TabsTrigger>
          <TabsTrigger value="preview">
            <Table2 aria-hidden /> Data preview
          </TabsTrigger>
          <TabsTrigger value="health">
            <Gauge aria-hidden /> Data health
            {health ? (
              <Badge className="ml-1" tone={health.score >= 90 ? "success" : "warning"}>
                {health.score}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="parse">
            <ListChecks aria-hidden /> Parse report
          </TabsTrigger>
        </TabsList>
        <TabsContent value="detect">
          <div className="grid gap-5 lg:grid-cols-12">
            <DetectionCard />
            <BusinessForm />
          </div>
        </TabsContent>
        <TabsContent value="preview">
          <VirtualGrid
            columns={profile.columns}
            rowCount={summary.rowCount}
            className="h-[min(640px,70vh)]"
          />
        </TabsContent>
        <TabsContent value="health">
          <Card className="p-6">{health ? <HealthPanel health={health} /> : null}</Card>
        </TabsContent>
        <TabsContent value="parse">
          <Card className="p-6">
            {report ? <ParseReportPanel report={report} timings={timings} /> : null}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DetectionCard() {
  const detection = useWorkspace((s) => s.detection);
  const domains = useWorkspace((s) => s.domains);
  const domainId = useWorkspace((s) => s.domainId);
  const top = detection?.candidates[0];
  if (!detection || !top) return null;
  const shown = detection.candidates.find((c) => c.domainId === domainId) ?? top;
  const meta = domains.find((d) => d.id === shown.domainId);
  return (
    <Card className="relative overflow-hidden p-6 lg:col-span-7">
      <div aria-hidden className="mesh pointer-events-none absolute inset-x-0 top-0 h-48 opacity-60" />
      <div className="relative">
        {detection.needsConfirmation ? (
          <div
            role="status"
            className="mb-5 flex items-start gap-2.5 rounded-control border border-warning/30 bg-warning-soft px-3 py-2.5"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="text-ui text-fg">
              <span className="font-medium">Please confirm.</span> {detection.reason} Use the form on the
              right; your choice always overrides detection.
            </p>
          </div>
        ) : null}
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <ConfidenceRing value={shown.confidence} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-[9px] border border-border-accent bg-accent-soft">
                <DomainIcon name={meta?.icon ?? "table"} className="size-4 text-accent" />
              </span>
              <Badge tone="accent">{shown.domainId === top.domainId ? "Best match" : "Your choice"}</Badge>
            </div>
            <h2 className="mt-3 font-display text-[40px] leading-none text-fg">{shown.name}</h2>
            <p className="mt-2 text-sm text-fg-muted">
              {shown.subDomain.name} · {Math.round(shown.subDomain.coverage * 100)}% of its key fields found ·
              grain: {shown.grain}
            </p>
          </div>
        </div>

        <div className="mt-6">
          <p className="mb-2 text-2xs font-medium tracking-[0.12em] text-fg-subtle uppercase">
            Evidence · matched columns
          </p>
          <motion.ul
            className="flex flex-wrap gap-1.5"
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.03 } } }}
          >
            {shown.evidence.slice(0, 16).map((e) => (
              <motion.li
                key={e.fieldId}
                variants={{ hidden: { opacity: 0, y: 4 }, show: { opacity: 1, y: 0 } }}
              >
                <Tooltip
                  content={`Matched by ${e.via === "name" ? "column name" : e.via === "values" ? "cell values" : "name and values"} · score ${(e.score * 100).toFixed(0)}`}
                >
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border-strong bg-surface-2 pr-3 pl-2.5 text-2xs">
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        e.score >= 0.9 ? "bg-success" : e.score >= 0.7 ? "bg-accent" : "bg-warning",
                      )}
                      aria-hidden
                    />
                    <span className="text-fg-muted">{e.fieldLabel}</span>
                    <span className="text-fg-subtle">←</span>
                    <span className="font-figures text-fg">{e.column}</span>
                    {e.via !== "name" ? (
                      <Sparkles className="size-3 text-accent" aria-label="value evidence" />
                    ) : null}
                  </span>
                </Tooltip>
              </motion.li>
            ))}
          </motion.ul>
          {shown.missingSignals.length ? (
            <p className="mt-3 text-ui text-fg-subtle">
              Not found: {shown.missingSignals.map((m) => m.label).join(", ")}. KPIs that need them will say
              so instead of guessing.
            </p>
          ) : null}
        </div>

        <div className="mt-6 grid gap-5 border-t border-border pt-5 md:grid-cols-2">
          <div>
            <p className="mb-2 text-2xs font-medium tracking-[0.12em] text-fg-subtle uppercase">
              Other candidates
            </p>
            <ul className="grid gap-2">
              {detection.candidates.map((c) => (
                <li key={c.domainId}>
                  <button
                    type="button"
                    onClick={() =>
                      useWorkspace.setState({ domainId: c.domainId, subDomainId: c.subDomain.id })
                    }
                    className={cn(
                      "w-full rounded-control border px-3 py-2 text-left transition-colors",
                      c.domainId === shown.domainId
                        ? "border-border-accent bg-accent-soft"
                        : "border-border hover:border-border-strong",
                    )}
                  >
                    <div className="flex items-center justify-between text-ui">
                      <span className="text-fg">{c.name}</span>
                      <span className="font-figures text-fg-muted">{c.confidence}%</span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
                      <motion.div
                        className="h-full rounded-full bg-accent"
                        initial={{ width: 0 }}
                        animate={{ width: `${c.confidence}%` }}
                        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-2xs font-medium tracking-[0.12em] text-fg-subtle uppercase">Structure</p>
            <ul className="grid gap-1.5 text-ui text-fg-muted">
              {detection.structural.map((s) => (
                <li key={s} className="flex gap-2">
                  <Columns3 className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Card>
  );
}

function BusinessForm() {
  const domains = useWorkspace((s) => s.domains);
  const detection = useWorkspace((s) => s.detection);
  const domainId = useWorkspace((s) => s.domainId);
  const subDomainId = useWorkspace((s) => s.subDomainId);
  const business = useWorkspace((s) => s.business);
  const setBusiness = useWorkspace((s) => s.setBusiness);
  const confirm = useWorkspace((s) => s.confirmDomain);
  const loading = useWorkspace((s) => s.loading);
  const currencyOverride = useSettings((s) => s.currencyOverride);
  const setCurrency = useSettings((s) => s.setCurrencyOverride);
  const profileCurrency = useWorkspace((s) => s.profile?.currency);
  const domain = domains.find((d) => d.id === domainId);
  const emphasise = detection?.needsConfirmation;
  const ranked = new Map(detection?.candidates.map((c) => [c.domainId, c.confidence]) ?? []);
  return (
    <Card
      className={cn(
        "p-6 lg:col-span-5",
        emphasise && "border-border-accent shadow-[0_0_0_4px_var(--accent-soft),var(--shadow-card)]",
      )}
    >
      <h2 className="text-base font-medium text-fg">Tell us about your business</h2>
      <p className="mt-1 text-ui text-fg-muted">
        Detection is a starting point. Anything you set here wins, and the dashboard regenerates instantly.
      </p>
      <form
        className="mt-5 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (domainId) void confirm(domainId, subDomainId);
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="industry">Industry</Label>
          <Select
            value={domainId ?? undefined}
            onValueChange={(v) => useWorkspace.setState({ domainId: v, subDomainId: null })}
          >
            <SelectTrigger id="industry">
              <SelectValue placeholder="Choose an industry" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Industries</SelectLabel>
                {domains.map((d) => (
                  <SelectItem
                    key={d.id}
                    value={d.id}
                    hint={ranked.has(d.id) ? `${ranked.get(d.id)}%` : undefined}
                  >
                    {d.name}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectItem value="generic">Generic (build from the data&apos;s structure)</SelectItem>
            </SelectContent>
          </Select>
          {domain ? <p className="text-2xs text-fg-subtle">{domain.tagline}</p> : null}
        </div>
        {domain && domain.subDomains.length > 1 ? (
          <div className="grid gap-1.5">
            <Label htmlFor="shape">Data shape</Label>
            <Select
              value={subDomainId ?? "auto"}
              onValueChange={(v) => useWorkspace.setState({ subDomainId: v === "auto" ? null : v })}
            >
              <SelectTrigger id="shape">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (best match)</SelectItem>
                {domain.subDomains.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="model">Business model</Label>
          <Select value={business.model ?? ""} onValueChange={(v) => setBusiness({ model: v })}>
            <SelectTrigger id="model">
              <SelectValue placeholder="Optional" />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Main goal</Label>
          <Segmented
            ariaLabel="Main goal"
            value={(business.goal as (typeof GOALS)[number]["value"]) ?? "growth"}
            onChange={(v) => setBusiness({ goal: v })}
            options={GOALS.map((g) => ({ value: g.value, label: g.label }))}
          />
          <p className="text-2xs text-fg-subtle">Orders the KPI strip around what you care about most.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="period">Primary period</Label>
            <Select
              value={business.period ?? "auto"}
              onValueChange={(v) => setBusiness({ period: v === "auto" ? undefined : v })}
            >
              <SelectTrigger id="period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="day">Daily</SelectItem>
                <SelectItem value="week">Weekly</SelectItem>
                <SelectItem value="month">Monthly</SelectItem>
                <SelectItem value="quarter">Quarterly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="currency">Currency</Label>
            <Select
              value={currencyOverride ?? "auto"}
              onValueChange={(v) => setCurrency(v === "auto" ? null : v)}
            >
              <SelectTrigger id="currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Detected: {profileCurrency?.code ?? "INR"}</SelectItem>
                {SUPPORTED_CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c} hint={currencySymbol(c).trim()}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {profileCurrency && !currencyOverride ? (
          <p className="-mt-2 text-2xs text-fg-subtle">Currency source: {profileCurrency.source}.</p>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="notes">Anything else? (optional)</Label>
          <Textarea
            id="notes"
            placeholder="e.g. We sell handmade apparel on our site and Amazon; COD heavy in tier-2 cities."
            value={business.notes ?? ""}
            onChange={(e) => setBusiness({ notes: e.target.value })}
          />
        </div>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="flex-1"
            disabled={!domainId || Boolean(loading)}
          >
            Confirm & build dashboard <ArrowRight aria-hidden />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            disabled={!domainId || Boolean(loading)}
            onClick={() => domainId && void confirm(domainId, subDomainId, { goTo: "map" })}
          >
            Review mapping
          </Button>
        </div>
      </form>
      <AiDomainCheck />
    </Card>
  );
}
