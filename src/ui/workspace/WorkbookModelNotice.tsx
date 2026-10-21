"use client";

/**
 * The notice on Detect when a workbook's sheets were joined into one table
 * (engine/parse/relate.ts): what joined on which key ("Orders joined with
 * Customers (on Customer ID) and Products (on Product ID): 3 sheets, 12,480
 * rows"), how many rows have a key a lookup doesn't hold, and which sheets
 * stayed out and why. "Use one sheet instead" opens the sheet picker for the
 * same file; the joined table stays until a sheet is chosen. Nothing shows
 * for a single sheet, a text file or a demo.
 */
import { Combine } from "lucide-react";
import { describeModel, modelSheetCount } from "@/engine/core/model";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { cn } from "@/lib/utils";
import { countOf } from "@/ui/common/words";
import { Button } from "@/ui/primitives/button";

export function WorkbookModelNotice({ className }: { className?: string }) {
  const model = useWorkspace((s) => s.summary?.model ?? null);
  const rows = useWorkspace((s) => s.summary?.rowCount ?? 0);
  const canPick = useWorkspace((s) => Boolean(s.lastFile));
  const pickOneSheet = useWorkspace((s) => s.pickOneSheet);
  const locale = useSettings((s) => s.numberLocale);
  if (!model) return null;
  const missing = model.joins.filter((j) => j.unmatched > 0);
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-card border border-info/30 bg-info-soft px-4 py-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 basis-64 items-start gap-2.5">
        <Combine className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <div className="min-w-0 text-sm text-fg">
          <p>
            <span className="font-medium">
              {describeModel(model)}: {countOf(modelSheetCount(model), "sheet", locale)},{" "}
              {countOf(rows, "row", locale)}.
            </span>{" "}
            Loupe joined the lookup sheets onto {model.fact} by their keys, so every {model.fact} row is kept
            once, with the lookups&apos; columns beside it.
          </p>
          {missing.length || model.left.length ? (
            <ul className="mt-1.5 grid gap-1 text-ui text-fg-muted">
              {missing.map((j) => (
                <li key={`m-${j.sheet}`}>
                  {countOf(j.unmatched, "row", locale)} {j.unmatched === 1 ? "has" : "have"} a {j.key} that
                  isn&apos;t in {j.sheet}; {j.unmatched === 1 ? "its" : "their"} {j.sheet} columns are blank.
                </li>
              ))}
              {model.left.map((l) => (
                <li key={`l-${l.sheet}`}>
                  Not joined: {l.sheet}, because {l.reason}.
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      {canPick ? (
        <Button size="sm" variant="secondary" className="shrink-0" onClick={() => void pickOneSheet()}>
          Use one sheet instead
        </Button>
      ) : null}
    </div>
  );
}
