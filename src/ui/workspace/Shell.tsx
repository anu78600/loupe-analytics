"use client";

/**
 * What the workspace chrome shares: step gating, opening a demo and "Start
 * over". The chrome itself is in ./shell (version 50.1): the sidebar, the top
 * bar and the phone's bottom bar. Every step after Upload needs a dataset;
 * opening Check & map or a later step first builds the analysis for the
 * chosen industry (the store's setStep). "Start over" asks first, since it
 * drops the dataset and everything set up for it.
 */
import { useWorkspace, type Step } from "@/store/workspace";
import { SAMPLES } from "@/engine/samples/catalog";
import { askConfirm } from "./confirm";

/** Whether a step can be opened: Upload always; Detect and Check & map with data; the rest once an industry is chosen. */
export function stepEnabled(step: Step, hasData: boolean, hasDomain: boolean): boolean {
  if (step === "upload") return true;
  if (!hasData) return false;
  if (step === "detect" || step === "map") return true;
  return hasDomain;
}

/**
 * Opens a demo (from a link, the command palette or the demo cards), on
 * `goTo` when given. The store outlives a visit to the landing page, so the
 * demo may already be open: a link then only changes the step, keeping what
 * was set up for it, while `fresh` (an explicit "load this demo") loads it
 * again. Another demo is simply replaced; the user's own file only after a
 * yes.
 */
export async function openDemo(id: string, goTo?: Step, fresh = false): Promise<void> {
  const info = SAMPLES.find((s) => s.id === id);
  if (!info) return;
  const ws = useWorkspace.getState();
  if (!fresh && ws.summary?.sampleId === id) {
    if (goTo) ws.setStep(goTo);
    return;
  }
  if (ws.summary && !ws.summary.isDemo) {
    const ok = await askConfirm({
      title: `Open the “${info.name}” demo?`,
      body: `It replaces ${ws.summary.fileName} and everything you set up for it in this tab.`,
      note: "Your file itself stays on your computer, so you can upload it again at any time.",
      confirmLabel: "Open the demo",
      cancelLabel: "Keep my file",
      tone: "danger",
    });
    if (!ok) return;
  }
  await useWorkspace.getState().loadSample(id, { goTo });
}

/** "Start over", after a yes: it drops the dataset and everything set up for it. */
export async function confirmStartOver(): Promise<void> {
  const s = useWorkspace.getState();
  if (!s.summary) return;
  const ok = await askConfirm({
    title: "Start over?",
    body: s.summary.isDemo
      ? "This closes the demo and everything you set up for it: the industry, mappings, KPIs, charts and questions."
      : `This clears ${s.summary.fileName} from memory with everything you set up for it: the industry, mappings, hidden columns, KPIs, charts and questions.`,
    note: s.summary.isDemo ? undefined : "Your file itself stays on your computer.",
    confirmLabel: "Start over",
    cancelLabel: "Keep working",
    tone: "danger",
  });
  if (ok) useWorkspace.getState().startOver();
}
