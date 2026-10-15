"use client";

/**
 * Step 3, Map columns. Edit which column fills each domain field, what
 * category values mean (value classes, e.g. which order statuses count as
 * RTO), each column's role and additivity, and KPI names, and see which KPIs
 * are available or what they still need. Every change reconfigures the
 * session in the worker and regenerates the dashboard.
 *
 * The "Your columns" tab lists every column of the file with what it feeds
 * (KPIs, charts, filters), so it is visible that the dashboard is built from
 * the file's own columns and adds none.
 */
import * as React from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleSlash,
  Columns3,
  Loader2,
  RotateCcw,
  Tags,
} from "lucide-react";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { formatCount, formatPlain } from "@/engine/core/format";
import { formatDay } from "@/engine/core/dates";
import { ROLE_LABEL, type Additivity, type ColumnProfile, type SemanticRole } from "@/engine/profile/types";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Card } from "@/ui/primitives/card";
import { Checkbox, Eyebrow } from "@/ui/primitives/misc";
import { Input } from "@/ui/primitives/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/primitives/popover";
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
          <Eyebrow>Step 3 · Map columns</Eyebrow>
          <h1 className="mt-2 font-display text-display-sm text-fg">Check how your columns were read.</h1>
          <p className="mt-2 max-w-2xl text-ui text-fg-muted">
            Change any mapping, value meaning or role; KPIs, SQL, DAX and charts regenerate instantly.
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
              <span className="text-fg-muted"> of {usage.total} columns used · none added</span>
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
      <Tabs defaultValue={context.domain.generic ? "roles" : "fields"}>
        <TabsList className="mb-5">
          {!context.domain.generic ? <TabsTrigger value="fields">Field mapping</TabsTrigger> : null}
          {!context.domain.generic && Object.keys(context.domain.valueClasses).length ? (
            <TabsTrigger value="values">Value meanings</TabsTrigger>
          ) : null}
          <TabsTrigger value="roles">Your columns</TabsTrigger>
          <TabsTrigger value="kpis">KPI availability</TabsTrigger>
        </TabsList>
        <TabsContent value="fields">
          <FieldMapping />
        </TabsContent>
        <TabsContent value="values">
          <ValueMeanings />
        </TabsContent>
        <TabsContent value="roles">
          {usage ? <ColumnsNote used={usage.used} total={usage.total} derived={usage.derived} /> : null}
          <ColumnRoles usage={usage?.usage ?? null} />
        </TabsContent>
        <TabsContent value="kpis">
          <KpiAvailability />
        </TabsContent>
      </Tabs>
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
function ColumnsNote({ used, total, derived }: { used: number; total: number; derived: boolean }) {
  return (
    <p className="mb-4 flex gap-2 rounded-card border border-border bg-surface-1 px-4 py-3 text-ui leading-relaxed text-fg-muted">
      <Columns3 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
      <span>
        <span className="text-fg">
          The dashboard is built from {used} of your {total} columns.
        </span>{" "}
        Loupe never adds a column on its own: every KPI, chart and filter below reads a column from your file
        {derived ? " (including the two unpivot columns you agreed to)" : ""}, and anything that would need a
        new one asks you first.
      </span>
    </p>
  );
}

/**
 * What the column actually holds, read from the profile: the range of a
 * number or date column, or the most common values of a text column, plus
 * how many values are distinct and how many cells are blank.
 */
function dataSummary(c: ColumnProfile): string {
  const parts: string[] = [];
  if (c.numeric) {
    const d = c.numeric.integer ? 0 : 2;
    parts.push(`${formatPlain(c.numeric.min, d, "INTL")} to ${formatPlain(c.numeric.max, d, "INTL")}`);
  } else if (c.temporal) {
    parts.push(`${formatDay(c.temporal.min)} to ${formatDay(c.temporal.max)}`);
  } else if (c.categorical?.top.length) {
    const top = c.categorical.top.slice(0, 3).map((v) => v.value);
    parts.push(`${top.join(", ")}${c.distinct > 3 ? "…" : ""}`);
  } else if (c.examples.length) parts.push(c.examples.slice(0, 3).join(", "));
  parts.push(`${c.distinct.toLocaleString("en-US")} distinct`);
  if (c.nullPct >= 0.005) parts.push(`${Math.round(c.nullPct * 100)}% blank`);
  return parts.join(" · ");
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
  if (!context) return null;
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-ui">
          <thead className="bg-surface-2 text-left text-fg-muted">
            <tr>
              {["Column", "In your data", "Used by", "Stored as", "Semantic role", "Aggregation", "Why"].map(
                (h) => (
                  <th key={h} scope="col" className="border-b border-border px-4 py-2.5 font-medium">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {context.profile.columns.map((c) => {
              const o = overrides[c.name];
              const numeric = c.storage === "number";
              return (
                <tr key={c.name} className="hover:bg-surface-2/60">
                  <td className="border-b border-border px-4 py-2 font-medium text-fg">{c.name}</td>
                  <td className="max-w-[240px] border-b border-border px-4 py-2 text-2xs leading-relaxed text-fg-muted">
                    <span className="line-clamp-2" title={dataSummary(c)}>
                      {dataSummary(c)}
                    </span>
                  </td>
                  <td className="border-b border-border px-4 py-1.5">
                    <UsedBy use={usage?.get(c.name)} />
                  </td>
                  <td className="border-b border-border px-4 py-2 text-fg-muted">{c.storage}</td>
                  <td className="border-b border-border px-4 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={c.role}
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
                      {o ? (
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
