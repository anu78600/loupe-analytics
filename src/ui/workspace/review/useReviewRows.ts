"use client";

/**
 * The review table's rows (review/model.ts) for the current analysis: every
 * column of the file in file order, hidden ones included, with what it
 * feeds or why it feeds nothing, the kind it is read as, the field it fills
 * and its health badges. The summary strip, the filters and the table all
 * read this one list, so their counts always agree.
 *
 * A used or unused column comes from the analysis profile (with the user's
 * role changes, useFileColumns); its kind from the analysis's understanding.
 * A hidden column, which neither reads, falls back to the profile detected
 * on loading and the kind its role stands for.
 */
import * as React from "react";
import { isUsed, whyUnused } from "@/engine/charts/columnUsage";
import type { CheckView } from "@/engine/profile/dataCheck";
import { useSettings } from "@/store/settings";
import { useWorkspace } from "@/store/workspace";
import { useColumnUsage } from "../useColumnUsage";
import { useFileColumns } from "../useFileColumns";
import { healthBadges, kindFromRole, type ReviewRow } from "./model";

export function useReviewRows(views: readonly CheckView[] | null): ReviewRow[] | null {
  const context = useWorkspace((s) => s.context);
  const understanding = useWorkspace((s) => s.understanding);
  const health = useWorkspace((s) => s.health);
  const locale = useSettings((s) => s.numberLocale);
  const file = useFileColumns();
  const usage = useColumnUsage();
  return React.useMemo(() => {
    if (!context || !file || !usage) return null;
    // Column → the template field it fills: shown as "Matched to" on an industry's dashboard only
    // (the general one has no template), but it explains an unused column on both.
    const fieldOf = new Map<string, { id: string; label: string }>();
    for (const [fieldId, column] of Object.entries(context.mapping.fields))
      fieldOf.set(column, {
        id: fieldId,
        label: context.domain.fields.find((f) => f.id === fieldId)?.label ?? fieldId,
      });
    const read = new Map((understanding?.columns ?? []).map((c) => [c.name, c]));
    const issues = health?.issues ?? [];
    return file.columns.map((c): ReviewRow => {
      const mapped = fieldOf.get(c.name);
      const field = context.domain.generic ? undefined : mapped;
      if (file.hidden.has(c.name))
        return {
          column: c,
          status: "hidden",
          kind: kindFromRole(c),
          health: [],
          ...(field ? { field } : {}),
        };
      const u = read.get(c.name);
      const base = {
        column: c,
        kind: u?.kind ?? kindFromRole(c),
        ...(u ? { kindWhy: u.why } : {}),
        ...(field ? { field } : {}),
        health: healthBadges(c, issues, views, locale),
      };
      const use = usage.usage.get(c.name);
      if (isUsed(use)) return { ...base, status: "used", use };
      return {
        ...base,
        status: "unused",
        ...(use ? { use } : {}),
        why: whyUnused(c, { dateColumn: context.dateColumn, mappedTo: mapped?.label, locale }),
      };
    });
  }, [context, understanding, health, file, usage, views, locale]);
}
