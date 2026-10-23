"use client";

/**
 * Check & map's KPIs view: every KPI of the industry, grouped, with what it
 * is computed from, or why it can't be and what could stand in for it (its
 * substitute). Nothing is estimated: a KPI without its column says so.
 * Names can be changed here (KpiNameInput), as in Customise.
 */
import * as React from "react";
import { Check, CircleSlash } from "lucide-react";
import { useWorkspace } from "@/store/workspace";
import { Card } from "@/ui/primitives/card";
import { ClampText } from "@/ui/primitives/reveal";
import { KpiNameInput } from "../customise/KpiNameInput";

export function KpiAvailability() {
  const context = useWorkspace((s) => s.context);
  if (!context) return null;
  const visible = context.kpis.filter((k) => !k.hidden);
  const on = visible.filter((k) => k.available).length;
  const off = visible.length - on;
  const groups = [...new Set(visible.map((k) => k.group))];
  return (
    <div className="grid gap-4">
      <p className="text-ui text-fg-muted">
        <span className="font-figures text-fg">{on}</span> of{" "}
        <span className="font-figures text-fg">{visible.length}</span> can be computed from your columns
        {off ? `; ${off} ${off === 1 ? "needs a column" : "need a column"} your file doesn’t have` : ""}.
        Nothing is estimated.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <Card key={g} className="p-5">
            <h3 className="eyebrow text-fg-subtle">{g}</h3>
            <ul className="mt-3 grid gap-2.5">
              {visible
                .filter((k) => k.group === g)
                .map((k) => (
                  <li key={k.id} className="flex items-start gap-2.5">
                    {k.available ? (
                      <Check className="mt-1.5 size-4 shrink-0 text-success" aria-label="available" />
                    ) : (
                      <CircleSlash
                        className="mt-1.5 size-4 shrink-0 text-fg-subtle"
                        aria-label="unavailable"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <KpiNameInput id={k.id} name={k.name} title={k.definition} />
                      {k.available ? (
                        <ClampText className="px-1 text-xs text-fg-subtle">
                          {k.variantLabel ??
                            (k.fieldsUsed.length
                              ? `From ${[...new Set(k.fieldsUsed.map((f) => f.column))].join(", ")}`
                              : "")}
                          {k.caveat ? ` · ${k.caveat}` : ""}
                        </ClampText>
                      ) : (
                        <p className="px-1 text-xs text-fg-muted">
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
    </div>
  );
}
