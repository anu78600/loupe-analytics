"use client";

/**
 * Value meanings: which values of a mapped column count as what, for the
 * fields an industry gives value classes (an order status's "Returned
 * (RTO)", a payment mode's "Cash on delivery"). Each class lists its chosen
 * values; a popover of the column's values, with their row counts, changes
 * them (setClassOverride), and the KPIs that read the class follow.
 *
 * ValueMeanings lists every such field (the Fields view); ValueClasses is
 * one field's list, which a review-table row shows in its details.
 */
import * as React from "react";
import { ChevronDown, Tags } from "lucide-react";
import { phrase } from "@/engine/charts/ask";
import { formatCount } from "@/engine/core/format";
import { cn } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { useWorkspace } from "@/store/workspace";
import { Badge } from "@/ui/primitives/badge";
import { Card } from "@/ui/primitives/card";
import { Checkbox } from "@/ui/primitives/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/primitives/popover";

export function ValueMeanings({ className }: { className?: string }) {
  const context = useWorkspace((s) => s.context);
  if (!context) return null;
  const entries = Object.keys(context.domain.valueClasses).filter((field) => context.mapping.fields[field]);
  if (!entries.length)
    return (
      <p className={cn("text-sm text-fg-muted", className)}>
        Map a status or payment column to edit what its values mean.
      </p>
    );
  return (
    <div className={cn("grid gap-4 lg:grid-cols-2", className)}>
      {entries.map((fieldId) => {
        const column = context.mapping.fields[fieldId] as string;
        const label = context.domain.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
        return (
          <Card key={fieldId} className="p-5">
            <div className="flex items-center gap-2">
              <Tags className="size-4 text-accent" aria-hidden />
              <h3 className="text-sm font-medium text-fg">{label}</h3>
              <span className="min-w-0 truncate text-xs text-fg-subtle" title={column}>
                column “{column}”
              </span>
            </div>
            <ValueClasses fieldId={fieldId} className="mt-4" />
          </Card>
        );
      })}
    </div>
  );
}

/** One field's value classes, each with its values and the picker that changes them. */
export function ValueClasses({ fieldId, className }: { fieldId: string; className?: string }) {
  const context = useWorkspace((s) => s.context);
  const setClass = useWorkspace((s) => s.setClassOverride);
  const locale = useSettings((s) => s.numberLocale);
  if (!context) return null;
  const classes = context.domain.valueClasses[fieldId] ?? [];
  const column = context.mapping.fields[fieldId];
  if (!column || !classes.length) return null;
  const values = context.profile.columns.find((c) => c.name === column)?.categorical?.all ?? [];
  return (
    <ul className={cn("grid gap-3", className)}>
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
                  className="relative inline-flex min-h-8 max-w-[70%] flex-wrap items-center justify-end gap-1 rounded-control border border-border-strong bg-surface-2 px-2 py-1 text-left transition-colors hover:border-border-hover focus-visible:focus-ring data-[state=open]:border-border-hover"
                >
                  {/* Read out with what the values mean, not only as the values themselves. */}
                  <span className="sr-only">Values that mean {phrase(c.label)}: </span>
                  {chosen.length ? (
                    chosen.slice(0, 4).map((v, i) => (
                      // The space keeps the values apart when read out; between flex items it isn't drawn.
                      <React.Fragment key={v}>
                        {i ? " " : null}
                        <Badge tone="neutral" className="font-data">
                          {v}
                        </Badge>
                      </React.Fragment>
                    ))
                  ) : (
                    <span className="text-xs text-fg-subtle">
                      No values: KPIs needing this are unavailable
                    </span>
                  )}
                  {chosen.length > 4 ? (
                    <>
                      {" "}
                      <Badge>
                        +{chosen.length - 4}
                        <span className="sr-only"> more</span>
                      </Badge>
                    </>
                  ) : null}
                  <ChevronDown className="size-3.5 text-fg-subtle" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                aria-label={`Values of ${column} that mean ${phrase(c.label)}`}
                className="max-h-80 w-72 overflow-y-auto p-2"
              >
                <p className="px-2 pt-1 pb-1.5 text-xs text-fg-subtle">
                  Values of “{column}” that mean {phrase(c.label)}
                </p>
                {values.map((v) => {
                  const on = chosen.includes(v.value);
                  return (
                    <label
                      key={v.value}
                      className="flex cursor-pointer items-center gap-2 rounded-xs px-2 py-1.5 text-ui text-fg hover:bg-surface-hover"
                    >
                      <Checkbox
                        checked={on}
                        onCheckedChange={(x) =>
                          setClass(key, x ? [...chosen, v.value] : chosen.filter((y) => y !== v.value))
                        }
                      />
                      <span className="font-data min-w-0 flex-1 truncate" title={v.value}>
                        {v.value}
                      </span>
                      <span className="font-figures shrink-0 text-xs text-fg-subtle">
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
  );
}
