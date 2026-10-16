"use client";

/**
 * "How this is calculated" for one KPI: definition, formula, the fields and
 * value meanings used, grain, filters and period, benchmark and pitfalls; a
 * time-intelligence tab (MTD, QTD, YTD, YoY, MoM, rolling windows, moving
 * average) computed in the worker; and the SQL and DAX with copy buttons. The
 * SQL is the card's own: the KPI over the card's period and filters, so it
 * returns the number on screen (Session.kpiCardSql).
 * Unavailable KPIs say what they need and suggest a substitute.
 */
import * as React from "react";
import { Check, Copy, Info, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { TimeIntelValue } from "@/engine/kpi/compute";
import { formatDelta, formatPointDelta, formatValue } from "@/engine/core/format";
import { formatRange } from "@/engine/core/dates";
import { PRESET_LABEL } from "@/engine/core/periods";
import { describeFilter } from "@/engine/query/filter";
import { formatDay } from "@/engine/core/dates";
import { useWorkspace } from "@/store/workspace";
import { engine } from "@/lib/engine-client";
import { copyText, cn } from "@/lib/utils";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/primitives/tabs";
import { useFmt } from "@/ui/common/hooks";
import { CodeLegend, HighlightedCode, languageOf } from "@/ui/common/code";
import { DeltaChip } from "./KpiCards";

/**
 * SQL or DAX in colour (ui/common/code.tsx), with what the colours mean and a
 * copy button. The language comes from the label ("DAX · measure"), else SQL.
 */
export function CodeBlock({ code, language, label }: { code: string; language: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="relative overflow-hidden rounded-control border border-border bg-bg-subtle">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-3 py-1.5">
        <span className="font-figures text-2xs tracking-[0.1em] text-fg-subtle uppercase">{language}</span>
        <CodeLegend className="mr-auto ml-2 hidden sm:flex" />
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            if (await copyText(code)) {
              setCopied(true);
              toast.success(`${label} copied`);
              setTimeout(() => setCopied(false), 1400);
            }
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre
        tabIndex={0}
        aria-label={`${label} code`}
        className="max-h-80 overflow-auto p-3 text-[11.5px] leading-relaxed text-fg focus-visible:outline-offset-[-2px]"
      >
        <HighlightedCode code={code} lang={languageOf(language)} />
      </pre>
    </div>
  );
}

export function KpiDetails({ kpiId }: { kpiId: string }) {
  const fmt = useFmt();
  const context = useWorkspace((s) => s.context);
  const batch = useWorkspace((s) => s.kpiBatch);
  const target = useWorkspace((s) => s.kpiTargets[kpiId]);
  const setTarget = useWorkspace((s) => s.setTarget);
  const preset = useWorkspace((s) => s.datePreset);
  const custom = useWorkspace((s) => s.customRange);
  const filtersFn = useWorkspace((s) => s.filters);
  const extraKpis = useWorkspace((s) => s.extraKpis);
  const toggleExtra = useWorkspace((s) => s.toggleExtraKpi);
  // Time-intelligence result tagged with the request it answers, so "loading" is derived, not stored.
  const [ti, setTi] = React.useState<{ key: string; values: TimeIntelValue[] } | null>(null);
  const meta = context?.kpis.find((k) => k.id === kpiId);
  const value = batch?.values.find((v) => v.id === kpiId);
  const filters = filtersFn();
  const filterKey = JSON.stringify(filters);

  const tiKey = `${kpiId}|${filterKey}`;
  React.useEffect(() => {
    if (!meta?.available) return;
    let alive = true;
    void engine()
      .timeIntel(kpiId, JSON.parse(filterKey))
      .then((values) => {
        if (alive) setTi({ key: `${kpiId}|${filterKey}`, values });
      });
    return () => {
      alive = false;
    };
  }, [kpiId, filterKey, meta?.available]);
  const tiLoading = Boolean(meta?.available) && ti?.key !== tiKey;
  // The SQL for the card's own rows, tagged with the request it answers like the time intelligence.
  const [cardSql, setCardSql] = React.useState<{
    key: string;
    value: { sql: string; filtered: boolean } | null;
  } | null>(null);
  React.useEffect(() => {
    if (!meta?.available) return;
    let alive = true;
    void engine()
      .kpiCardSql(kpiId, JSON.parse(filterKey))
      .then((value) => {
        if (alive) setCardSql({ key: `${kpiId}|${filterKey}`, value });
      });
    return () => {
      alive = false;
    };
  }, [kpiId, filterKey, meta?.available]);
  const sqlForCard = cardSql?.key === tiKey ? cardSql.value : null;
  // While a new request runs, keep showing the previous values rather than flashing empty.
  const tiValues = ti?.values ?? null;

  if (!context || !meta) return null;
  const period = preset === "custom" && custom ? formatRange(custom.from, custom.to) : PRESET_LABEL[preset];
  const nonAdditive = ["percent", "ratio"].includes(meta.format) || /÷|per |rate|average/i.test(meta.formula);
  const inStrip =
    context.selection.hero.includes(kpiId) ||
    context.selection.supporting.includes(kpiId) ||
    context.selection.columns.includes(kpiId);
  return (
    <div className="grid gap-5">
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="outline">{meta.group}</Badge>
          <Badge tone={meta.tier === "hero" ? "accent" : "neutral"}>{meta.tier}</Badge>
          {meta.direction !== "neutral" ? (
            <Badge tone="outline">
              {meta.direction === "higher" ? "Higher is better" : "Lower is better"}
            </Badge>
          ) : null}
        </div>
        <h2 className="mt-3 text-lg font-medium tracking-[-0.01em] text-fg">{meta.name}</h2>
        <p className="mt-1 text-ui leading-relaxed text-fg-muted">{meta.definition}</p>
        {meta.available && value ? (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <p className="tabular text-[32px] leading-none font-semibold tracking-[-0.03em] text-fg">
              {formatValue(value.value, meta.format, fmt)}
            </p>
            {value.currentLabel ? (
              <span className="text-2xs text-fg-muted">
                {value.currentLabel}:{" "}
                <span className="tabular text-fg">{formatValue(value.current, meta.format, fmt)}</span>
              </span>
            ) : null}
            <DeltaChip meta={meta} value={value} />
            <span className="text-2xs text-fg-subtle">{value.comparisonLabel}</span>
          </div>
        ) : null}
        {!meta.available ? (
          <p className="mt-3 flex gap-2 rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-ui text-fg">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            {meta.unavailableReason} {meta.substitute}
          </p>
        ) : null}
        {!inStrip && meta.available ? (
          <Button className="mt-3" size="sm" variant="secondary" onClick={() => toggleExtra(kpiId)}>
            {extraKpis.includes(kpiId) ? "Remove from dashboard" : "Add to dashboard"}
          </Button>
        ) : null}
      </div>

      <Tabs defaultValue="how">
        <TabsList>
          <TabsTrigger value="how">How it&apos;s calculated</TabsTrigger>
          <TabsTrigger value="time">Time intelligence</TabsTrigger>
          <TabsTrigger value="code">SQL & DAX</TabsTrigger>
        </TabsList>
        <TabsContent value="how" className="mt-4 grid gap-4">
          <Row label="Formula">{meta.formula}</Row>
          {meta.variantLabel ? (
            <Row label="Method used">
              {meta.variantLabel}
              {meta.caveat ? <span className="mt-1 block text-warning">Caveat: {meta.caveat}</span> : null}
            </Row>
          ) : null}
          {meta.fieldsUsed.length ? (
            <Row label="Columns used">
              <ul className="grid gap-1">
                {meta.fieldsUsed.map((f) => (
                  <li key={f.fieldId} className="flex items-center gap-1.5">
                    <span className="text-fg-muted">{f.label}</span>
                    <span className="text-fg-subtle">←</span>
                    <span className="font-figures text-fg">{f.column}</span>
                  </li>
                ))}
              </ul>
            </Row>
          ) : null}
          {meta.classesUsed.length ? (
            <Row label="Value meanings">
              <ul className="grid gap-1.5">
                {meta.classesUsed.map((c) => (
                  <li key={c.key}>
                    <span className="text-fg-muted">{c.label}: </span>
                    {c.values.length ? (
                      c.values.map((v) => (
                        <Badge key={v} className="mr-1">
                          {v}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-fg-subtle">none</span>
                    )}
                  </li>
                ))}
              </ul>
            </Row>
          ) : null}
          <Row label="Grain · filters · period">
            {context.grainLabel} ·{" "}
            {filters.filter((f) => f.kind !== "dateRange").length
              ? filters
                  .filter((f) => f.kind !== "dateRange")
                  .map((f) => describeFilter(f, formatDay))
                  .join("; ")
              : "no filters"}{" "}
            · {period}
          </Row>
          <Row label="Aggregation">
            {nonAdditive
              ? "A ratio: recomputed from its totals for every period and segment, never summed or averaged across rows."
              : "Additive: totals can be summed across segments and periods."}
          </Row>
          {meta.benchmark ? (
            <Row label="Indicative range">
              {meta.benchmark.low !== undefined && meta.benchmark.high !== undefined
                ? `${formatValue(meta.benchmark.low, meta.format, fmt)} – ${formatValue(meta.benchmark.high, meta.format, fmt)}. `
                : ""}
              {meta.benchmark.note} Not computed from your data.
            </Row>
          ) : null}
          <Row label="Target">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                className="h-8 w-40"
                defaultValue={target !== undefined ? (meta.format === "percent" ? target * 100 : target) : ""}
                placeholder={meta.format === "percent" ? "e.g. 15 (%)" : "Set a target"}
                aria-label={`Target for ${meta.name}`}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  if (!raw) return setTarget(kpiId, null);
                  const n = Number(raw);
                  setTarget(kpiId, meta.format === "percent" ? n / 100 : n);
                }}
              />
              <span className="text-2xs text-fg-subtle">Shown as progress on the card.</span>
            </div>
          </Row>
          {meta.pitfalls.length ? (
            <Row label="Watch out">
              <ul className="grid gap-1">
                {meta.pitfalls.map((p) => (
                  <li key={p} className="flex gap-1.5">
                    <Info className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
                    {p}
                  </li>
                ))}
              </ul>
            </Row>
          ) : null}
        </TabsContent>
        <TabsContent value="time" className="mt-4">
          {!meta.available ? (
            <p className="text-ui text-fg-muted">Unavailable for this data.</p>
          ) : !context.dateColumn ? (
            <p className="text-ui text-fg-muted">
              No date column is mapped, so time intelligence isn&apos;t available.
            </p>
          ) : tiLoading && !tiValues ? (
            <p className="flex items-center gap-2 text-ui text-fg-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Computing…
            </p>
          ) : (
            <table className="w-full text-ui">
              <tbody>
                {tiValues?.map((t) => (
                  <tr key={t.key} className="border-b border-border last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-normal text-fg-muted">
                      {t.label}
                      <span className="block text-2xs text-fg-subtle">{t.note ?? t.period}</span>
                    </th>
                    <td
                      className={cn(
                        "font-figures py-2 text-right",
                        t.value === null ? "text-fg-subtle" : "text-fg",
                      )}
                    >
                      {t.points
                        ? formatPointDelta(t.value, fmt.locale)
                        : t.percent
                          ? formatDelta(t.value, fmt.locale)
                          : formatValue(t.value, meta.format, fmt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-2xs text-fg-subtle">
            Relative to the end of the selected period. Ratios are recomputed for each window, never averaged.
          </p>
        </TabsContent>
        <TabsContent value="code" className="mt-4 grid gap-3">
          {sqlForCard ? (
            <CodeBlock
              code={sqlForCard.sql}
              language={sqlForCard.filtered ? "SQL · the card's rows" : "SQL · whole file"}
              label="SQL"
            />
          ) : meta.sql ? (
            <CodeBlock code={meta.sql} language="SQL · whole file" label="SQL" />
          ) : (
            <p className="text-ui text-fg-muted">No SQL for this KPI.</p>
          )}
          {meta.dax ? (
            <CodeBlock code={`${meta.daxName} =\n${meta.dax}`} language="DAX · measure" label="DAX" />
          ) : null}
          <p className="text-2xs text-fg-subtle">
            {sqlForCard && !sqlForCard.filtered && filters.length
              ? "This KPI counts each entity once, by its first-ever date, which a filtered query can't reproduce exactly, so this query is over the whole file. The card uses the period and filters you chose."
              : "This query returns the number on the card: the same definition over the same rows (the period and filters you chose). The DAX is the Power BI measure, which your report's slicers filter. Export › SQL re-runs the KPIs on your data in DuckDB."}
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <p className="text-2xs font-medium tracking-[0.1em] text-fg-subtle uppercase">{label}</p>
      <div className="text-ui leading-relaxed text-fg">{children}</div>
    </div>
  );
}
