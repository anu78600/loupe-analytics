/**
 * The open file, named: its real file name (and the sheet, for a workbook)
 * with "Your file" or "Demo data" beside it, so a dashboard built from an
 * upload is never mistaken for the demo. Shown in the workspace top bar and
 * in the Detect, Check & map and Dashboard headers.
 *
 * The name truncates to fit; the full name and sheet are in its tooltip.
 */
import { FileSpreadsheet } from "lucide-react";
import type { DatasetSummary } from "@/engine/session";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/primitives/badge";

export function FileIdentity({
  summary,
  size = "md",
  badge = true,
  className,
}: {
  summary: Pick<DatasetSummary, "fileName" | "isDemo" | "sheet">;
  size?: "sm" | "md";
  /** Whether to show the "Your file" / "Demo data" label. */
  badge?: boolean;
  className?: string;
}) {
  const full = summary.sheet ? `${summary.fileName} · sheet "${summary.sheet}"` : summary.fileName;
  return (
    <span className={cn("inline-flex max-w-full min-w-0 items-center gap-2", className)}>
      <FileSpreadsheet
        className={cn("shrink-0 text-accent", size === "sm" ? "size-3.5" : "size-4")}
        aria-hidden
      />
      <span
        className={cn("min-w-0 truncate font-medium text-fg", size === "sm" ? "text-xs" : "text-ui")}
        title={full}
      >
        {summary.fileName}
        {summary.sheet ? <span className="font-normal text-fg-subtle"> · {summary.sheet}</span> : null}
      </span>
      {badge ? (
        <Badge tone={summary.isDemo ? "accent" : "success"} className="shrink-0">
          {summary.isDemo ? "Demo data" : "Your file"}
        </Badge>
      ) : null}
    </span>
  );
}
