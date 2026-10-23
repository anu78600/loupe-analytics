/**
 * The workspace's eight steps grouped into four phases (version 50.1, the
 * redesign's app shell): Prepare (Upload, Detect, Check & map), Build
 * (Customise, Dashboard), Analyse (Questions & SQL, Insights) and Share
 * (Export). The sidebar lists the steps under their phase, the top bar names
 * the phase and step as a breadcrumb, and on phones the bottom bar switches
 * phase while a row under the top bar switches step within it.
 *
 * The steps themselves, their order and their gating stay where they were
 * (STEPS in the workspace store, stepEnabled in ../Shell.tsx); this file only
 * groups them, gives each an icon, and decides where a phase opens.
 */
import type { LucideIcon } from "lucide-react";
import {
  Blocks,
  ChartLine,
  CloudUpload,
  Database,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  MessageSquareText,
  ScanSearch,
  Send,
  Share2,
  SlidersHorizontal,
} from "lucide-react";
import { STEPS, type Step } from "@/store/workspace";

export type PhaseId = "prepare" | "build" | "analyse" | "share";

export interface Phase {
  id: PhaseId;
  label: string;
  /** What the phase is for, in a few words (its tooltip in the bottom bar and the sidebar). */
  hint: string;
  icon: LucideIcon;
  /** Its steps, in STEPS order. */
  steps: Step[];
}

export const PHASES: Phase[] = [
  {
    id: "prepare",
    label: "Prepare",
    hint: "Load a file, see what it is about, check its columns",
    icon: Database,
    steps: ["upload", "detect", "map"],
  },
  {
    id: "build",
    label: "Build",
    hint: "Choose the KPIs and charts, then read the dashboard",
    icon: Blocks,
    steps: ["customise", "dashboard"],
  },
  {
    id: "analyse",
    label: "Analyse",
    hint: "Ask questions in words or SQL, and read what stands out",
    icon: ChartLine,
    steps: ["questions", "insights"],
  },
  {
    id: "share",
    label: "Share",
    hint: "Power BI, SQL, a PDF report, slides and the data",
    icon: Send,
    steps: ["export"],
  },
];

/** Each step's icon, the same in the sidebar, the phone's step row and the command palette. */
export const STEP_ICON: Record<Step, LucideIcon> = {
  upload: CloudUpload,
  detect: ScanSearch,
  map: ListChecks,
  customise: SlidersHorizontal,
  dashboard: LayoutDashboard,
  questions: MessageSquareText,
  insights: Lightbulb,
  export: Share2,
};

/** The phase a step belongs to. */
export function phaseOf(step: Step): Phase {
  return PHASES.find((p) => p.steps.includes(step)) ?? (PHASES[0] as Phase);
}

/** A step's name as the step bar has always called it ("Check & map"). */
export function stepLabel(step: Step): string {
  return STEPS.find((s) => s.id === step)?.label ?? step;
}

/**
 * Where a phase opens when it is picked from the bottom bar: where the user
 * last was in it, if that step can still be opened, else its first step that
 * can. Null when none of its steps can be opened yet (no data, no industry).
 */
export function phaseTarget(
  phase: Phase,
  last: Step | undefined,
  enabled: (step: Step) => boolean,
): Step | null {
  if (last && phase.steps.includes(last) && enabled(last)) return last;
  return phase.steps.find(enabled) ?? null;
}
