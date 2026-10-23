"use client";

/**
 * Check & map's Fields view, by template field (industry dashboards only):
 * which column fills each field Loupe looks for, how sure the match is, and
 * what the field feeds, with "Remember … for future files" under a field
 * matched by hand. Below it, Value meanings: which values of a status or
 * payment column mean what (ValueMeanings).
 *
 * The review table makes the same changes by column ("Matched to"); this
 * view keeps the field's side of it, so a field with no column is in sight.
 * A column fills one field at most: the list says which field a column
 * already fills, and taking it says which field lost it, with Undo
 * (useMatch).
 */
import * as React from "react";
import { ROLE_LABEL } from "@/engine/profile/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace";
import { Badge } from "@/ui/primitives/badge";
import { Card } from "@/ui/primitives/card";
import { ClampText } from "@/ui/primitives/reveal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/ui/primitives/select";
import { useColumnUsage } from "../useColumnUsage";
import { FeedsBadges } from "./cells";
import { RememberWord, useCanRemember } from "./RememberWord";
import { TD, TH } from "./table";
import { useMatch } from "./useMatch";
import { ValueMeanings } from "./ValueMeanings";

const NONE = "__none__";

export function FieldsView() {
  const context = useWorkspace((s) => s.context);
  if (!context) return null;
  const classes = Object.keys(context.domain.valueClasses).length > 0;
  return (
    <div className="grid gap-8">
      <section aria-labelledby="fields-mapping">
        <h2 id="fields-mapping" className="text-md font-semibold text-fg">
          Field mapping
        </h2>
        <p className="mt-1 text-xs text-fg-muted">
          The fields {context.domain.name} dashboards read, and the column filling each.
        </p>
        <FieldMapping className="mt-4" />
      </section>
      {classes ? (
        <section aria-labelledby="fields-values">
          <h2 id="fields-values" className="text-md font-semibold text-fg">
            Value meanings
          </h2>
          <p className="mt-1 text-xs text-fg-muted">Which values of a column count as what.</p>
          <ValueMeanings className="mt-4" />
        </section>
      ) : null}
    </div>
  );
}

function FieldMapping({ className }: { className?: string }) {
  const context = useWorkspace((s) => s.context);
  const overrides = useWorkspace((s) => s.mappingOverrides);
  const usage = useColumnUsage();
  const match = useMatch();
  if (!context) return null;
  // Column → the field it fills now.
  const fills = new Map(Object.entries(context.mapping.fields).map(([f, c]) => [c, f]));
  const fields = [...context.domain.fields].sort((a, b) => {
    const am = context.mapping.fields[a.id] ? 1 : 0;
    const bm = context.mapping.fields[b.id] ? 1 : 0;
    return (b.core ? 1 : 0) - (a.core ? 1 : 0) || bm - am || b.weight - a.weight;
  });
  const columns = context.profile.columns;
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-ui">
          <thead>
            <tr>
              <th scope="col" className={TH}>
                Field Loupe looks for
              </th>
              <th scope="col" className={TH}>
                Your column
              </th>
              <th scope="col" className={TH}>
                Match
              </th>
              <th scope="col" className={cn(TH, "text-right")}>
                Feeds
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => {
              const col = context.mapping.fields[f.id];
              const score = context.mapping.scores[f.id];
              const manual = f.id in overrides;
              return (
                <tr key={f.id} className="transition-colors duration-fast hover:bg-surface-hover">
                  <td className={cn(TD, "align-top")}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-fg">{f.label}</span>
                      {f.core ? <Badge tone="outline">core</Badge> : null}
                    </div>
                    {f.description ? (
                      <ClampText className="mt-0.5 max-w-[280px] text-xs text-fg-subtle">
                        {f.description}
                      </ClampText>
                    ) : null}
                  </td>
                  <td className={cn(TD, "align-top")}>
                    <Select
                      value={col ?? NONE}
                      onValueChange={(v) => match.forField(f.id, v === NONE ? null : v)}
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
                        {columns.map((c) => {
                          // A column another field uses is offered, saying which field would lose it.
                          const other = fills.get(c.name);
                          return (
                            <SelectItem
                              key={c.name}
                              value={c.name}
                              hint={
                                other && other !== f.id
                                  ? `${ROLE_LABEL[c.role]} · fills ${match.labelOf(other)}`
                                  : ROLE_LABEL[c.role]
                              }
                            >
                              {c.name}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {col ? <Teach fieldId={f.id} label={f.label} column={col} /> : null}
                  </td>
                  <td className={cn(TD, "align-top")}>
                    {col ? (
                      manual ? (
                        <Badge tone="accent">set by you</Badge>
                      ) : (
                        <Badge
                          tone={(score ?? 0) >= 0.9 ? "success" : (score ?? 0) >= 0.7 ? "accent" : "warning"}
                        >
                          <span className="tabular">{Math.round((score ?? 0) * 100)}%</span>
                        </Badge>
                      )
                    ) : (
                      <span className="text-xs text-fg-subtle">—</span>
                    )}
                  </td>
                  <td className={cn(TD, "align-top")}>
                    {col ? (
                      <div className="flex justify-end">
                        <FeedsBadges use={usage?.usage.get(col)} />
                      </div>
                    ) : (
                      // The select beside it already says "Not mapped": a dash, as in the Match column.
                      // `relative` keeps the screen-reader text inside the table's scroll area.
                      <p className="relative text-right text-xs text-fg-subtle">
                        <span aria-hidden>—</span>
                        <span className="sr-only">Feeds nothing: no column</span>
                      </p>
                    )}
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

/** "Remember … for future files" under a field matched by hand. */
function Teach({ fieldId, label, column }: { fieldId: string; label: string; column: string }) {
  const domainId = useWorkspace((s) => s.context?.domain.id ?? "");
  const can = useCanRemember(fieldId, column);
  if (!can) return null;
  return (
    <RememberWord
      domainId={domainId}
      fieldId={fieldId}
      label={label}
      column={column}
      className="mt-1.5 w-64"
    />
  );
}
