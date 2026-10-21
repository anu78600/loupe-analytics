"use client";

/**
 * A KPI's name as an inline text box, used wherever a KPI can be renamed
 * (Customise › KPIs, Check & map › KPI availability). It reads as text, with
 * a pencil as the cue that it can be changed; Enter or leaving the box
 * saves, Escape puts the name back.
 *
 * A template KPI is renamed (renameKpi): the name follows it everywhere,
 * exports included, and emptying the box gives it its own name back. A KPI
 * the user built takes the new name into its own definition
 * (saveCustomKpi), so its builder shows the same name as its card.
 */
import * as React from "react";
import { Pencil } from "lucide-react";
import { isUserKpiId } from "@/engine/kpi/userKpis";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace";
import { Input } from "@/ui/primitives/input";

export function KpiNameInput({
  id,
  name,
  title,
  className,
}: {
  id: string;
  /** The KPI's display name now (after any rename). */
  name: string;
  /** Hover text, such as the KPI's definition. */
  title?: string;
  className?: string;
}) {
  const renameKpi = useWorkspace((s) => s.renameKpi);
  const saveCustomKpi = useWorkspace((s) => s.saveCustomKpi);

  const commit = (input: HTMLInputElement) => {
    const v = input.value.trim();
    if (v === name) return;
    const s = useWorkspace.getState();
    const own = isUserKpiId(id) ? s.customKpis.find((k) => k.id === id) : undefined;
    if (!v) {
      // A renamed template KPI goes back to its own name; any other KPI keeps the one it has.
      if (!own && s.kpiRenames[id]) renameKpi(id, "");
      else input.value = name;
      return;
    }
    if (!own) return renameKpi(id, v);
    void saveCustomKpi({ ...own, name: v });
    // A rename saved for it earlier would still win over its own name, so it moves too.
    if (s.kpiRenames[id]) renameKpi(id, v);
  };

  return (
    // As wide as the name (field-sizing), so the pencil sits right after it, never beside a value.
    <span className={cn("relative inline-block max-w-full min-w-0 align-middle", className)}>
      <Input
        // Keyed by the name, so a change made elsewhere (the builder, a reset) shows here.
        key={name}
        defaultValue={name}
        aria-label={`Name for ${name}`}
        title={title}
        maxLength={120}
        onBlur={(e) => commit(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = name;
            e.currentTarget.blur();
          }
        }}
        className="peer [field-sizing:content] h-7 w-auto max-w-full min-w-[8ch] truncate border-transparent bg-transparent pr-6 pl-1 text-ui font-medium hover:border-border-hover"
      />
      <Pencil
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-1.5 size-3 -translate-y-1/2 text-fg-subtle peer-focus:hidden"
      />
    </span>
  );
}
