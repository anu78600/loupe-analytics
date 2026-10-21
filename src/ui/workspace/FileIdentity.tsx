/**
 * The open file, named: its real file name (and the sheet, for a workbook)
 * with "Your file" or "Demo data" beside it, so a dashboard built from an
 * upload is never mistaken for the demo. Shown in the workspace top bar and
 * in the Detect, Check & map and Dashboard headers.
 *
 * The name truncates to fit; a cut name opens in full on hover, focus or a
 * long press (ClampText). A workbook read as joined sheets shows "Orders +
 * 2 sheets", with the joins behind an ⓘ.
 */
import { FileSpreadsheet } from "lucide-react";
import { describeModel, modelLabel } from "@/engine/core/model";
import type { DatasetSummary } from "@/engine/session";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/primitives/badge";
import { ClampText, InfoTip } from "@/ui/primitives/reveal";

export function FileIdentity({
  summary,
  size = "md",
  badge = true,
  className,
}: {
  summary: Pick<DatasetSummary, "fileName" | "isDemo" | "sheet" | "model">;
  size?: "sm" | "md";
  /** Whether to show the "Your file" / "Demo data" label. */
  badge?: boolean;
  className?: string;
}) {
  const sheet = summary.model ? modelLabel(summary.model) : summary.sheet;
  return (
    <span className={cn("inline-flex max-w-full min-w-0 items-center gap-2", className)}>
      <FileSpreadsheet
        className={cn("shrink-0 text-accent", size === "sm" ? "size-3.5" : "size-4")}
        aria-hidden
      />
      <ClampText className={cn("min-w-0 font-medium text-fg", size === "sm" ? "text-xs" : "text-ui")}>
        {summary.fileName}
        {sheet ? <span className="font-normal text-fg-subtle"> · {sheet}</span> : null}
      </ClampText>
      {summary.model ? (
        <InfoTip label="About the joined sheets">
          {summary.fileName} · {describeModel(summary.model)}
        </InfoTip>
      ) : null}
      {badge ? (
        <Badge tone={summary.isDemo ? "accent" : "success"} className="shrink-0">
          {summary.isDemo ? "Demo data" : "Your file"}
        </Badge>
      ) : null}
    </span>
  );
}
