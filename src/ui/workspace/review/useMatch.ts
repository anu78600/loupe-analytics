"use client";

/**
 * Mapping changes from Check & map, by field (the Fields view: which column
 * fills this field) or by column (the review table's "Matched to": which
 * field this column fills). Both go through the store's mapping overrides,
 * which reconfigure the analysis and teach the file's learned rule.
 *
 * A column fills one field at most, so a change can take a column from
 * another field, or a field from another column. When it does, a toast says
 * so in one sentence (review/model.ts matchMessage), with Undo: the
 * overrides as they were, set back through the store's action so what Loupe
 * learned from the change is taken back too.
 */
import { toast } from "sonner";
import { useWorkspace } from "@/store/workspace";
import { matchMessage } from "./model";

export function useMatch() {
  const context = useWorkspace((s) => s.context);
  const setOverride = useWorkspace((s) => s.setMappingOverride);
  const labelOf = (fieldId: string) => context?.domain.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
  /** The field a column fills now. */
  const fieldOf = (column: string) =>
    Object.entries(context?.mapping.fields ?? {}).find(([, c]) => c === column)?.[0];

  const announce = (text: string | null, before: Record<string, string | null>) => {
    if (!text) return;
    toast.warning(text, {
      action: { label: "Undo", onClick: () => useWorkspace.getState().setMappingOverrides(before) },
    });
  };

  /** Fills `fieldId` with `column` (null: no column). */
  const forField = (fieldId: string, column: string | null) => {
    if (!context) return;
    const before = useWorkspace.getState().mappingOverrides;
    const from = column ? fieldOf(column) : undefined;
    setOverride(fieldId, column);
    if (!column || !from || from === fieldId) return;
    announce(matchMessage({ column, to: labelOf(fieldId), from: labelOf(from) }), before);
  };

  /** Has `column` fill `fieldId` (null: no field). */
  const forColumn = (column: string, fieldId: string | null) => {
    if (!context) return;
    const before = useWorkspace.getState().mappingOverrides;
    const from = fieldOf(column);
    if (fieldId === null) {
      if (!from) return;
      setOverride(from, null);
      announce(matchMessage({ column, to: null, from: labelOf(from) }), before);
      return;
    }
    if (fieldId === from) return;
    const displaced = context.mapping.fields[fieldId];
    setOverride(fieldId, column);
    announce(
      matchMessage({
        column,
        to: labelOf(fieldId),
        ...(from ? { from: labelOf(from) } : {}),
        ...(displaced && displaced !== column ? { displaced } : {}),
      }),
      before,
    );
  };

  return { forField, forColumn, labelOf };
}
