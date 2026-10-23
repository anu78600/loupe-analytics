"use client";

/**
 * "Remember 'Net Amt' as Net revenue for future files": teaches Loupe the
 * header as a synonym of the field, so later files are mapped (and their
 * industry detected) with it. Once taught, it says so instead. Offered for
 * a column the user matched by hand to a registry field (those list
 * synonyms), on the user's own files (demos teach nothing): see
 * `canRemember`.
 */
import * as React from "react";
import { toast } from "sonner";
import { BookMarked, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLearned } from "@/store/learned";
import { useWorkspace } from "@/store/workspace";

/** Whether a field's column can be taught: matched by hand, to a field with synonyms, with learning on. */
export function useCanRemember(fieldId: string | undefined, column: string | undefined): boolean {
  const context = useWorkspace((s) => s.context);
  const manual = useWorkspace((s) => (fieldId ? fieldId in s.mappingOverrides : false));
  // Learning is on for the user's own files, not demos.
  const learning = useWorkspace((s) => Boolean(s.learned));
  if (!context || !fieldId || !column || context.domain.generic) return false;
  const field = context.domain.fields.find((f) => f.id === fieldId);
  return Boolean(manual && learning && field && field.synonyms.length > 0);
}

export function RememberWord({
  domainId,
  fieldId,
  label,
  column,
  className,
}: {
  domainId: string;
  fieldId: string;
  label: string;
  column: string;
  className?: string;
}) {
  const remember = useWorkspace((s) => s.rememberWord);
  const known = useLearned((s) =>
    s.words.some(
      (w) =>
        w.domainId === domainId && w.fieldId === fieldId && w.header.toLowerCase() === column.toLowerCase(),
    ),
  );
  if (known)
    return (
      <p className={cn("flex items-start gap-1.5 text-xs text-fg-subtle", className)}>
        <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
        Loupe knows “{column}” as {label} in future files.
      </p>
    );
  return (
    <button
      type="button"
      onClick={() => {
        remember(fieldId, column);
        toast.success(`Loupe will read “${column}” as ${label} in future files`, {
          description: "Stored in this browser only. Settings › What Loupe has learned lists it.",
        });
      }}
      className={cn(
        "flex items-start gap-1.5 rounded-control text-left text-xs text-accent-text underline-offset-4 hover:underline focus-visible:focus-ring",
        className,
      )}
    >
      <BookMarked className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      Remember “{column}” as {label} for future files
    </button>
  );
}
