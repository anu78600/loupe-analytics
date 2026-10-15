"use client";

/**
 * Step 3, Check & map. First the whole file ("Your data", DataCheckPanel),
 * so the user can confirm the upload is right, with every problem marked.
 * Then the mapping: which column fills each domain field, what category
 * values mean (value classes, e.g. which order statuses count as RTO), each
 * column's role and additivity, and KPI names, with which KPIs are available
 * or what they still need. "File report" says how the file was read and its
 * health score. Every mapping change reconfigures the session in the worker
 * and regenerates the dashboard.
 *
 * The "Your columns" tab lists every column of the file with what it feeds
 * (KPIs, charts, filters), so it is visible that the dashboard is built from
 * the file's own columns and adds none.
 *
 * Any column can be hidden from the analysis (HiddenColumns above the tabs,
 * the eye on each grid header, the switch in "Your columns"), typically a raw
 * column kept beside its cleaned copy. It stays in the file; nothing
 * computes from it.
 */
import * as React from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleSlash,
  Columns3,
  EyeOff,
  Loader2,
  RotateCcw,
  Tags,
} from "lucide-react";
import { stepNumber, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { formatCount } from "@/engine/core/format";
import { ROLE_LABEL, type Additivity, type SemanticRole } from "@/engine/profile/types";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Card } from "@/ui/primitives/card";
import { Checkbox, Eyebrow } from "@/ui/primitives/misc";
import { Input } from "@/ui/primitives/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/primitives/popover";
import { Switch } from "@/ui/primitives/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/ui/primitives/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/primitives/tabs";
import { Tooltip } from "@/ui/primitives/tooltip";
import type { ColumnUse } from "@/engine/charts/columnUsage";
import { useColumnUsage } from "./useColumnUsage";
import { dataSummary } from "./columnSummary";
import { DataCheckPanel } from "./DataCheckPanel";
import { HealthPanel, ParseReportPanel } from "./HealthPanel";
import { HiddenColumns } from "./HiddenColumns";
import { useFileColumns } from "./useFileColumns";

const ROLES: SemanticRole[] = [
  "identifier",
  "datetime",
  "time",
  "dimension",
  "measure",
  "currency",
  "rate",
  "percentage",
  "geo",
  "text",
  "boolean",
];
const NONE = "__none__";

export function MapStep() {
  const context = useWorkspace((s) => s.context);
  const configuring = useWorkspace((s) => s.configuring);
  const setStep = useWorkspace((s) => s.setStep);
  const setSubDomain = useWorkspace((s) => s.setSubDomain);
  const usage = useColumnUsage();
  if (!context) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center">
        <p className="text-sm text-fg-muted">
          Confirm an industry first so Loupe knows which fields to look for.
        </p>
        <Button className="mt-4" variant="secondary" onClick={() => setStep("detect")}>
          Back to detection
        </Button>
      </div>
    );
  }
  const visible = context.kpis.filter((k) => !k.hidden);
  const available = visible.filter((k) => k.available).length;
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-8 md:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Step {stepNumber("map")} · Check & map</Eyebrow>
          <h1 className="mt-2 font-display text-display-sm text-fg">
            Is this your data? Check it, then map it.
          </h1>
          <p className="mt-2 max-w-2xl text-ui text-fg-muted">
            Scroll the whole file to confirm it is right; anything that looks wrong is marked. Then check how
            the columns were read: change any mapping, value meaning or role and everything regenerates.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {configuring ? (
            <Loader2 className="size-4 animate-spin text-fg-subtle" aria-label="Updating" />
          ) : null}
          <div className="rounded-control border border-border bg-surface-1 px-3 py-1.5 text-ui">
            <span className="font-figures text-fg">{available}</span>
            <span className="text-fg-muted"> of {visible.length} KPIs available</span>
          </div>
          {usage ? (
            <div className="rounded-control border border-border bg-surface-1 px-3 py-1.5 text-ui">
              <span className="font-figures text-fg">{usage.used}</span>
              <span className="text-fg-muted">
                {" "}
                of {usage.total} columns used{usage.hidden ? ` · ${usage.hidden} hidden` : ""} · none added
              </span>
            </div>
          ) : null}
          {context.domain.subDomains.length > 1 ? (
            <Select value={context.subDomainId} onValueChange={setSubDomain}>
              <SelectTrigger className="w-56" size="sm" aria-label="Data shape">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {context.domain.subDomains.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button variant="primary" onClick={() => setStep("dashboard")}>
            Continue to dashboard <ArrowRight aria-hidden />
          </Button>
        </div>
      </div>
      <HiddenColumns />
      <Tabs defaultValue="data">
        <TabsList className="mb-5">
          <TabsTrigger value="data">Your data</TabsTrigger>
          {!context.domain.generic ? <TabsTrigger value="fields">Field mapping</TabsTrigger> : null}
          {!context.domain.generic && Object.keys(context.domain.valueClasses).length ? (
            <TabsTrigger value="values">Value meanings</TabsTrigger>
          ) : null}
          <TabsTrigger value="roles">Your columns</TabsTrigger>
          <TabsTrigger value="kpis">KPI availability</TabsTrigger>
          <TabsTrigger value="file">File report</TabsTrigger>
        </TabsList>
        <TabsContent value="data">
          <DataCheckPanel />
        </TabsContent>
        <TabsContent value="fields">
          <FieldMapping />
        </TabsContent>
        <TabsContent value="values">
          <ValueMeanings />
        </TabsContent>
        <TabsContent value="roles">
          {usage ? (
            <ColumnsNote
              used={usage.used}
              total={usage.total}
              hidden={usage.hidden}
              derived={usage.derived}
            />
          ) : null}
          <ColumnRoles usage={usage?.usage ?? null} />
        </TabsContent>
        <TabsContent value="kpis">
          <KpiAvailability />
        </TabsContent>
        <TabsContent value="file">
          <FileReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** How the file was read (encoding, header, date order, notes) and its data-health score and checks. */
function FileReport() {
  const health = useWorkspace((s) => s.health);
  const report = useWorkspace((s) => s.report);
  const timings = useWorkspace((s) => s.timings);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-6">{health ? <HealthPanel health={health} /> : null}</Card>
      <Card className="p-6">{report ? <ParseReportPanel report={report} timings={timings} /> : null}</Card>
    </div>
  );
}

function FieldMapping() {
  const context = useWorkspace((s) => s.context);
  const setOverride = useWorkspace((s) => s.setMappingOverride);
  const overrides = useWorkspace((s) => s.mappingOverrides);
  if (!context) return null;
  const usage = new Map<string, number>();
  for (const k of context.kpis)
    if (k.available && !k.hidden)
      for (const f of k.fieldsUsed) usage.set(f.fieldId, (usage.get(f.fieldId) ?? 0) + 1);
  const fields = [...context.domain.fields].sort((a, b) => {
    const am = context.mapping.fields[a.id] ? 1 : 0;
    const bm = context.mapping.fields[b.id] ? 1 : 0;
    return (b.core ? 1 : 0) - (a.core ? 1 : 0) || bm - am || b.weight - a.weight;
  });
  const columns = context.profile.columns;
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-ui">
          <thead className="bg-surface-2 text-left text-fg-muted">
            <tr>
              <th scope="col" className="border-b border-border px-4 py-2.5 font-medium">
                Field Loupe looks for
              </th>
              <th scope="col" className="border-b border-border px-4 py-2.5 font-medium">
                Your column
              </th>
              <th scope="col" className="border-b border-border px-4 py-2.5 font-medium">
                Match
              </th>
              <th scope="col" className="border-b border-border px-4 py-2.5 text-right font-medium">
                Used by
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => {
              const col = context.mapping.fields[f.id];
              const score = context.mapping.scores[f.id];
              const manual = f.id in overrides;
              return (
                <tr key={f.id} className="hover:bg-surface-2/60">
                  <td className="border-b border-border px-4 py-2.5 align-top">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-fg">{f.label}</span>
                      {f.core ? <Badge tone="outline">core</Badge> : null}
                    </div>
                    {f.description ? <p className="mt-0.5 text-2xs text-fg-subtle">{f.description}</p> : null}
                  </td>
                  <td className="border-b border-border px-4 py-2 align-top">
                    <Select
                      value={col ?? NONE}
                      onValueChange={(v) => setOverride(f.id, v === NONE ? null : v)}
                    >
                      <SelectTrigger
                        size="sm"
                        className={cn("w-64", !col && "text-fg-subtle")}
                        aria-label={`Column for ${f.label}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Not mapped</SelectItem>
                        <SelectSeparator />
                        {columns.map((c) => (
                          <SelectItem key={c.name} value={c.name} hint={ROLE_LABEL[c.role]}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="border-b border-border px-4 py-2.5 align-top">
                    {col ? (
                      manual ? (
                        <Badge tone="accent">set by you</Badge>
                      ) : (
                        <Badge
                          tone={(score ?? 0) >= 0.9 ? "success" : (score ?? 0) >= 0.7 ? "accent" : "warning"}
                        >
                          {Math.round((score ?? 0) * 100)}%
                        </Badge>
                      )
                    ) : (
                      <span className="text-2xs text-fg-subtle">—</span>
                    )}
                  </td>
                  <td className="font-figures border-b border-border px-4 py-2.5 text-right align-top text-fg-muted">
                    {usage.get(f.id) ?? 0} KPIs
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ValueMeanings() {
  const context = useWorkspace((s) => s.context);
  const setClass = useWorkspace((s) => s.setClassOverride);
  const locale = useSettings((s) => s.numberLocale);
  if (!context) return null;
  const entries = Object.entries(context.domain.valueClasses).filter(
    ([field]) => context.mapping.fields[field],
  );
  if (!entries.length)
    return (
      <p className="text-ui text-fg-muted">Map a status or payment column to edit what its values mean.</p>
    );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {entries.map(([fieldId, classes]) => {
        const column = context.mapping.fields[fieldId] as string;
        const label = context.domain.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
        const values = context.profile.columns.find((c) => c.name === column)?.categorical?.all ?? [];
        return (
          <Card key={fieldId} className="p-5">
            <div className="flex items-center gap-2">
              <Tags className="size-4 text-accent" aria-hidden />
              <h3 className="text-sm font-medium text-fg">{label}</h3>
              <span className="text-2xs text-fg-subtle">column “{column}”</span>
            </div>
            <ul className="mt-4 grid gap-3">
              {classes.map((c) => {
                const key = `${fieldId}.${c.id}`;
                const chosen = context.mapping.classes[key] ?? [];
                return (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-ui text-fg">{c.label}</span>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex min-h-8 max-w-[70%] flex-wrap items-center justify-end gap-1 rounded-control border border-border-strong bg-surface-2 px-2 py-1 text-left hover:border-border-accent"
                        >
                          {chosen.length ? (
                            chosen.slice(0, 4).map((v) => (
                              <Badge key={v} tone="neutral">
                                {v}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-2xs text-fg-subtle">
                              No values: KPIs needing this are unavailable
                            </span>
                          )}
                          {chosen.length > 4 ? <Badge>+{chosen.length - 4}</Badge> : null}
                          <ChevronDown className="size-3.5 text-fg-subtle" aria-hidden />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="max-h-80 w-72 overflow-y-auto p-2">
                        <p className="px-2 pt-1 pb-1.5 text-2xs text-fg-subtle">
                          Values of “{column}” that mean {c.label.toLowerCase()}
                        </p>
                        {values.map((v) => {
                          const on = chosen.includes(v.value);
                          return (
                            <label
                              key={v.value}
                              className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-ui text-fg hover:bg-surface-3"
                            >
                              <Checkbox
                                checked={on}
                                onCheckedChange={(x) =>
                                  setClass(
                                    key,
                                    x ? [...chosen, v.value] : chosen.filter((y) => y !== v.value),
                                  )
                                }
                              />
                              <span className="flex-1 truncate">{v.value}</span>
                              <span className="font-figures text-2xs text-fg-subtle">
                                {formatCount(v.count, locale)}
                              </span>
                            </label>
                          );
                        })}
                      </PopoverContent>
                    </Popover>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

/** States the "your columns only" rule above the column table. */
function ColumnsNote({
  used,
  total,
  hidden,
  derived,
}: {
  used: number;
  total: number;
  hidden: number;
  derived: boolean;
}) {
  return (
    <p className="mb-4 flex gap-2 rounded-card border border-border bg-surface-1 px-4 py-3 text-ui leading-relaxed text-fg-muted">
      <Columns3 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
      <span>
        <span className="text-fg">
          The dashboard is built from {used} of your {total} columns
          {hidden ? `; you hid ${hidden === 1 ? "1 column" : `${hidden} columns`}, which nothing reads` : ""}.
        </span>{" "}
        Loupe never adds a column on its own: every KPI, chart and filter below reads a column from your file
        {derived ? " (including the two unpivot columns you agreed to)" : ""}, and anything that would need a
        new one asks you first. Switch a column off to hide it from the analysis: it stays in your file.
      </span>
    </p>
  );
}

/** "Used by" cell: counts with the names in a tooltip, or "Not used". */
function UsedBy({ use }: { use: ColumnUse | undefined }) {
  if (!use || (!use.kpis.length && !use.charts.length && !use.filters.length))
    return <span className="text-2xs text-fg-subtle">Not used</span>;
  const parts: Array<{ label: string; names: string[] }> = [];
  if (use.kpis.length)
    parts.push({ label: use.kpis.length === 1 ? "1 KPI" : `${use.kpis.length} KPIs`, names: use.kpis });
  if (use.charts.length)
    parts.push({
      label: use.charts.length === 1 ? "1 chart" : `${use.charts.length} charts`,
      names: use.charts,
    });
  if (use.filters.length) parts.push({ label: use.filters.join(", "), names: [] });
  return (
    <div className="flex flex-wrap gap-1">
      {parts.map((p) =>
        p.names.length ? (
          <Tooltip key={p.label} content={p.names.join(" · ")}>
            <button
              type="button"
              className="rounded-[6px] focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none"
              aria-label={`${p.label}: ${p.names.join(", ")}`}
            >
              <Badge tone="outline">{p.label}</Badge>
            </button>
          </Tooltip>
        ) : (
          <Badge key={p.label} tone="outline">
            {p.label}
          </Badge>
        ),
      )}
    </div>
  );
}

function ColumnRoles({ usage }: { usage: Map<string, ColumnUse> | null }) {
  const context = useWorkspace((s) => s.context);
  const overrides = useWorkspace((s) => s.roleOverrides);
  const setRole = useWorkspace((s) => s.setRoleOverride);
  const setHidden = useWorkspace((s) => s.setColumnsHidden);
  // Every column of the file, hidden ones included, so a hidden column can be switched back on here.
  const file = useFileColumns();
  if (!context || !file) return null;
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1260px] border-separate border-spacing-0 text-ui">
          <thead className="bg-surface-2 text-left text-fg-muted">
            <tr>
              {[
                "Use",
                "Column",
                "In your data",
                "Used by",
                "Stored as",
                "Semantic role",
                "Aggregation",
                "Why",
              ].map((h) => (
                <th key={h} scope="col" className="border-b border-border px-4 py-2.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {file.columns.map((c) => {
              const o = overrides[c.name];
              const numeric = c.storage === "number";
              const off = file.hidden.has(c.name);
              return (
                <tr key={c.name} className={cn("hover:bg-surface-2/60", off && "bg-surface-2/50")}>
                  <td className="border-b border-border px-4 py-2">
                    <Tooltip
                      content={
                        off
                          ? "Hidden: kept in your file, but nothing computes from it. Switch on to use it again."
                          : "Switch off to hide this column from every KPI, chart, filter and question. It stays in your file."
                      }
                    >
                      {/* The tooltip marks its trigger with its own data-state, which would
                          override the switch's checked state, so it gets a wrapper. */}
                      <span className="inline-flex">
                        <Switch
                          checked={!off}
                          onCheckedChange={(on) => setHidden([c.name], !on)}
                          aria-label={`Use ${c.name} in the analysis`}
                        />
                      </span>
                    </Tooltip>
                  </td>
                  <td
                    className={cn(
                      "border-b border-border px-4 py-2 font-medium",
                      off ? "text-fg-subtle line-through" : "text-fg",
                    )}
                  >
                    {c.name}
                  </td>
                  <td className="max-w-[240px] border-b border-border px-4 py-2 text-2xs leading-relaxed text-fg-muted">
                    <span className="line-clamp-2" title={dataSummary(c)}>
                      {dataSummary(c)}
                    </span>
                  </td>
                  <td className="border-b border-border px-4 py-1.5">
                    {off ? (
                      <Badge tone="neutral">
                        <EyeOff aria-hidden /> Hidden
                      </Badge>
                    ) : (
                      <UsedBy use={usage?.get(c.name)} />
                    )}
                  </td>
                  <td className="border-b border-border px-4 py-2 text-fg-muted">{c.storage}</td>
                  <td className="border-b border-border px-4 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={c.role}
                        disabled={off}
                        onValueChange={(v) => setRole(c.name, v as SemanticRole, o?.additivity)}
                      >
                        <SelectTrigger size="sm" className="w-40" aria-label={`Role for ${c.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {o && !off ? (
                        <Tooltip content="Reset to detected">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Reset role for ${c.name}`}
                            onClick={() => setRole(c.name, null)}
                          >
                            <RotateCcw aria-hidden />
                          </Button>
                        </Tooltip>
                      ) : null}
                    </div>
                  </td>
                  <td className="border-b border-border px-4 py-1.5">
                    {numeric && ["measure", "currency", "rate", "percentage"].includes(c.role) ? (
                      <Select
                        value={c.additivity ?? "additive"}
                        disabled={off}
                        onValueChange={(v) => setRole(c.name, c.role, v as Additivity)}
                      >
                        <SelectTrigger size="sm" className="w-44" aria-label={`Aggregation for ${c.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="additive">Additive (sum)</SelectItem>
                          <SelectItem value="semi-additive">Semi-additive (latest)</SelectItem>
                          <SelectItem value="non-additive">Non-additive (average)</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-2xs text-fg-subtle">
                        {c.defaultAgg === "countDistinct"
                          ? "Count distinct"
                          : c.defaultAgg === "count"
                            ? "Count"
                            : "—"}
                      </span>
                    )}
                  </td>
                  <td className="max-w-[360px] border-b border-border px-4 py-2 text-2xs leading-relaxed text-fg-muted">
                    {c.roleReason}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function KpiAvailability() {
  const context = useWorkspace((s) => s.context);
  const rename = useWorkspace((s) => s.renameKpi);
  if (!context) return null;
  const visible = context.kpis.filter((k) => !k.hidden);
  const groups = [...new Set(visible.map((k) => k.group))];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map((g) => (
        <Card key={g} className="p-5">
          <h3 className="text-2xs font-medium tracking-[0.12em] text-fg-subtle uppercase">{g}</h3>
          <ul className="mt-3 grid gap-2.5">
            {visible
              .filter((k) => k.group === g)
              .map((k) => (
                <li key={k.id} className="flex items-start gap-2.5">
                  {k.available ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="available" />
                  ) : (
                    <CircleSlash className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-label="unavailable" />
                  )}
                  <div className="min-w-0 flex-1">
                    <Input
                      aria-label={`Name for ${k.name}`}
                      defaultValue={k.name}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== k.name) rename(k.id, v);
                      }}
                      className="h-7 border-transparent bg-transparent px-1 text-ui font-medium hover:border-border-strong"
                    />
                    {k.available ? (
                      <p className="px-1 text-2xs text-fg-subtle">
                        {k.variantLabel}
                        {k.caveat ? ` · ${k.caveat}` : ""}
                      </p>
                    ) : (
                      <p className="px-1 text-2xs text-fg-muted">
                        {k.unavailableReason} {k.substitute}
                      </p>
                    )}
                  </div>
                </li>
              ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
