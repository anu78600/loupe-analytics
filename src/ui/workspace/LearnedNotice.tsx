"use client";

/**
 * The calm notice on Detect and Check & map when a rule Loupe learned from
 * the user's corrections on a file like this one is in use
 * (store/learned.ts, applied when the file loaded): it says what the rule
 * set ("industry E-commerce, 3 column roles, 1 hidden column"), with Undo
 * (take it back for this file; the rule stays for the next one) and Forget
 * (take it back and delete the rule). Nothing shows when no rule applied.
 * What the rule set stays in view; the lead-in is short, with the full
 * sentence behind its ⓘ.
 */
import { BookMarked } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/store/workspace";
import { describeApplied } from "@/store/learned";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/primitives/button";
import { InfoTip } from "@/ui/primitives/reveal";

export function LearnedNotice({ className }: { className?: string }) {
  const applied = useWorkspace((s) => s.learned?.applied ?? null);
  const undo = useWorkspace((s) => s.undoLearned);
  const forget = useWorkspace((s) => s.forgetLearned);
  if (!applied) return null;
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-info/30 bg-info-soft px-4 py-3",
        className,
      )}
    >
      <p className="flex min-w-0 flex-1 basis-64 items-start gap-2.5 text-sm text-fg">
        <BookMarked className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <span>
          <span className="font-medium">Learned from you:</span> {describeApplied(applied)}.{" "}
          <InfoTip label="About what Loupe learned">
            Using what you told Loupe last time for a file like this: {describeApplied(applied)}.
          </InfoTip>
        </span>
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            undo();
            toast("Not used for this file", { description: "Loupe still remembers it for the next one." });
          }}
        >
          Undo
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            forget();
            toast("Forgotten", { description: "Loupe won't use it again. You can teach it anew." });
          }}
        >
          Forget
        </Button>
      </div>
    </div>
  );
}
