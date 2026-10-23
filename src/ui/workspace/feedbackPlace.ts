"use client";

/**
 * What the workspace adds to a feedback message (version 51.0), so a user
 * reporting a problem only has to say what went wrong: the step they were
 * on (and the dashboard's view), the shape of their data, and how Loupe
 * read it. Read from the store when the dialog opens.
 *
 * Never a value from the data, and never the name of the user's own file
 * (only its type: a file name can say what a business is); a demo is named,
 * since it is Loupe's own. An error's text is passed through scrubFileName
 * first, because some errors quote the file they couldn't read.
 */
import { formatCount } from "@/engine/core/format";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import type { FeedbackRequest } from "@/ui/common/feedback/store";
import { SAMPLES } from "@/engine/samples/catalog";
import { stepLabel } from "./shell/phases";

/** `text` with every mention of the user's own file name replaced by "your file". */
export function scrubFileName(text: string, fileName: string | null | undefined): string {
  if (!fileName) return text;
  const stem = fileName.replace(/\.[a-z0-9]{1,5}$/i, "");
  let out = text.split(fileName).join("your file");
  if (stem.length >= 3) out = out.split(stem).join("your file");
  return out;
}

/** The workspace's lines for the feedback details: step, data and how it was read. */
export function workspacePlace(): string[] {
  const s = useWorkspace.getState();
  const locale = useSettings.getState().numberLocale;
  const lines: string[] = [];
  const view = s.step === "dashboard" ? (s.dashView === "page" ? " (one page)" : " (all charts)") : "";
  lines.push(`Step: ${stepLabel(s.step)}${view}`);
  const summary = s.summary;
  if (summary) {
    const ext = /\.([a-z0-9]{1,5})$/i.exec(summary.fileName)?.[1]?.toLowerCase();
    const demo = summary.isDemo ? SAMPLES.find((x) => x.id === summary.sampleId)?.name : undefined;
    const what = summary.isDemo
      ? `the “${demo ?? summary.fileName}” demo`
      : `your own file${ext ? ` (.${ext})` : ""}`;
    const sampled = s.report?.sampling ? " · a sample of the file" : "";
    lines.push(
      `Data: ${formatCount(summary.rowCount, locale)} rows × ${formatCount(summary.columnCount, locale)} columns · ${what}${sampled}`,
    );
  } else {
    lines.push("Data: none loaded yet");
  }
  const top = s.detection?.candidates[0];
  if (s.context) {
    const d = s.context.domain;
    const read = d.generic ? `a general dashboard (“${s.context.understanding.title}”)` : d.name;
    const weak = !d.generic && s.context.fit.weak ? " · fits few columns" : "";
    // Said once when the choice is what detection found; both when the user chose otherwise.
    const detected = !top
      ? ""
      : top.domainId === d.id
        ? ` (detected at ${top.confidence}%)`
        : ` · detected ${top.name} at ${top.confidence}%`;
    lines.push(`Read as: ${read}${weak}${detected}`);
  } else if (top) {
    lines.push(`Detected: ${top.name} at ${top.confidence}%`);
  }
  return lines;
}

/** Opens feedback on a problem from an error the user saw, with that error (scrubbed) in the details. */
export function reportError(message: string): FeedbackRequest {
  const s = useWorkspace.getState();
  // The open file, one waiting on a choice, or the last one loaded: an upload error may quote any.
  const names = [s.summary?.isDemo ? null : s.summary?.fileName, s.pendingFile?.name, s.lastFile?.name];
  const text = names.reduce<string>((t, n) => scrubFileName(t, n), message);
  return {
    kind: "problem",
    topic: "Something looks broken",
    place: [...workspacePlace(), `Error shown: ${text}`],
  };
}
