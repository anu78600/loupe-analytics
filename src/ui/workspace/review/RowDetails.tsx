"use client";

/**
 * A review-table row's details, opened with its chevron: why Loupe reads
 * the column as it does (and what is in it), what it feeds in full (or why
 * nothing reads it), its health problems in full with the rows that show
 * them, and under "Advanced" its semantic role and how it adds up. A column
 * that fills a field with value classes shows that field's value meanings;
 * one matched by hand offers "Remember … for future files".
 */
import * as React from "react";
import { ArrowRight, EyeOff, RotateCcw } from "lucide-react";
import { ROLE_LABEL, type Additivity, type SemanticRole } from "@/engine/profile/types";
import { cn } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { useWorkspace } from "@/store/workspace";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitives/select";
import { Tooltip } from "@/ui/primitives/tooltip";
import { dataSummary } from "../columnSummary";
import type { ReviewRow } from "./model";
import { RememberWord, useCanRemember } from "./RememberWord";
import { ValueClasses } from "./ValueMeanings";

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

/** A details section: a small label over its content. */
function Section({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0", className)}>
      <h4 className="eyebrow text-fg-subtle">{label}</h4>
      <div className="mt-2 grid gap-1.5 text-ui text-fg-muted">{children}</div>
    </section>
  );
}

/** A list of names after its label ("KPIs: Revenue, Orders"). */
function Names({ label, names }: { label: string; names: string[] }) {
  if (!names.length) return null;
  return (
    <p className="leading-relaxed">
      <span className="text-fg">{label}</span> <span className="tabular text-fg-subtle">{names.length}</span>
      <span className="block text-xs leading-relaxed text-fg-muted">{names.join(" · ")}</span>
    </p>
  );
}

export function RowDetails({
  row,
  onOpen,
  className,
}: {
  row: ReviewRow;
  /** Opens the Rows view on a check view, or the File report (null). */
  onOpen: (view: string | null) => void;
  className?: string;
}) {
  const context = useWorkspace((s) => s.context);
  const setHidden = useWorkspace((s) => s.setColumnsHidden);
  const locale = useSettings((s) => s.numberLocale);
  const canRemember = useCanRemember(row.field?.id, row.column.name);
  const manual = useWorkspace((s) => (row.field ? row.field.id in s.mappingOverrides : false));
  if (!context) return null;
  const c = row.column;
  const off = row.status === "hidden";
  const fieldDef = row.field ? context.domain.fields.find((f) => f.id === row.field?.id) : undefined;
  const score = row.field ? context.mapping.scores[row.field.id] : undefined;
  const classes = row.field && !off ? (context.domain.valueClasses[row.field.id] ?? []) : [];
  return (
    <div className={cn("grid grid-cols-1 gap-6", className)}>
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2 xl:grid-cols-4">
        <Section label="Why this reading">
          <p className="leading-relaxed text-fg">{row.kindWhy ?? c.roleReason}</p>
          <p className="font-data text-xs leading-relaxed text-fg-subtle">{dataSummary(c, locale)}</p>
          {row.field && fieldDef ? (
            <p className="text-xs leading-relaxed">
              Fills <span className="text-fg">{fieldDef.label}</span>
              {manual ? ", set by you" : score !== undefined ? `, a ${Math.round(score * 100)}% match` : ""}.
            </p>
          ) : null}
          {canRemember && row.field && fieldDef ? (
            <RememberWord
              domainId={context.domain.id}
              fieldId={row.field.id}
              label={fieldDef.label}
              column={c.name}
              className="mt-1"
            />
          ) : null}
        </Section>
        <Section label="What it feeds">
          {off ? (
            <p className="leading-relaxed">
              Nothing: it&apos;s hidden. It stays in your file, the grid and every export.
            </p>
          ) : row.status === "unused" ? (
            <>
              <p className="leading-relaxed text-fg">{row.why?.reason}</p>
              {row.why?.hint ? <p className="text-xs leading-relaxed">{row.why.hint}</p> : null}
              <Button
                size="xs"
                variant="ghost"
                className="-ml-2 justify-self-start"
                onClick={() => setHidden([c.name], true)}
              >
                <EyeOff aria-hidden /> Hide it
              </Button>
            </>
          ) : (
            <>
              <Names label="KPIs" names={row.use?.kpis ?? []} />
              <Names label="Charts" names={row.use?.charts ?? []} />
              {row.use?.filters.length ? (
                <p>
                  <span className="text-fg">Filters</span>
                  <span className="block text-xs">{row.use.filters.join(" · ")}</span>
                </p>
              ) : null}
            </>
          )}
        </Section>
        <Section label="Health">
          {off ? (
            <p>Not checked: nothing computes from it.</p>
          ) : row.health.length ? (
            <ul className="grid gap-2.5">
              {row.health.map((b) => (
                <li key={b.id} className="grid gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={b.tone === "warning" ? "warning" : "neutral"} className="tabular">
                      {b.label}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => onOpen(b.view ?? null)}
                      className="inline-flex items-center gap-1 rounded-xs text-xs text-accent-text underline-offset-4 hover:underline focus-visible:focus-ring"
                    >
                      {b.view ? "Show the rows" : "File report"} <ArrowRight className="size-3" aria-hidden />
                    </button>
                  </span>
                  <span className="text-xs leading-relaxed">{b.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No problems found.</p>
          )}
        </Section>
        <Section label="Advanced">
          <Advanced row={row} />
        </Section>
      </div>
      {classes.length && row.field ? (
        <section className="min-w-0 border-t border-border-subtle pt-5">
          <h4 className="eyebrow text-fg-subtle">Value meanings · {row.field.label}</h4>
          <ValueClasses fieldId={row.field.id} className="mt-3 max-w-2xl" />
        </section>
      ) : null}
    </div>
  );
}

/** The column's semantic role and, for a measure, how it adds up across rows. */
function Advanced({ row }: { row: ReviewRow }) {
  const override = useWorkspace((s) => s.roleOverrides[row.column.name]);
  const setRole = useWorkspace((s) => s.setRoleOverride);
  const c = row.column;
  const off = row.status === "hidden";
  const measure = c.storage === "number" && ["measure", "currency", "rate", "percentage"].includes(c.role);
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <span className="text-xs text-fg-subtle">Semantic role</span>
        <span className="flex items-center gap-1.5">
          <Select
            value={c.role}
            disabled={off}
            onValueChange={(v) => setRole(c.name, v as SemanticRole, override?.additivity)}
          >
            <SelectTrigger size="sm" className="w-full max-w-56" aria-label={`Role for ${c.name}`}>
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
          {override && !off ? (
            <Tooltip content="Back to Loupe's reading">
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
        </span>
      </div>
      <div className="grid gap-1">
        <span className="text-xs text-fg-subtle">Adds up as</span>
        {measure ? (
          <Select
            value={c.additivity ?? "additive"}
            disabled={off}
            onValueChange={(v) => setRole(c.name, c.role, v as Additivity)}
          >
            {/* Wide enough for "Non-additive (average)" in full. */}
            <SelectTrigger size="sm" className="w-full max-w-56" aria-label={`Aggregation for ${c.name}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="additive">Additive (sum)</SelectItem>
              <SelectItem value="semi-additive">Semi-additive (latest)</SelectItem>
              <SelectItem value="non-additive">Non-additive (average)</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span className="text-ui text-fg-muted">
            {c.defaultAgg === "countDistinct" ? "Count distinct" : c.defaultAgg === "count" ? "Count" : "—"}
          </span>
        )}
      </div>
    </div>
  );
}
