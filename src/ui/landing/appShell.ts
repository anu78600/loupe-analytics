/**
 * The workspace's shell as the landing page draws it: its four phases and
 * eight steps with their icons (the sidebar rail, the phone's bottom bar and
 * "How it works"), and the icon on each kind of KPI card.
 *
 * The workspace's own list (ui/workspace/shell/phases.ts) reads its step
 * names from the workspace store, which would bring the store and the engine
 * client into this page's bundle, so the landing page keeps this copy;
 * tests/landing-data.test.ts fails if the two ever differ.
 */
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Banknote,
  Blocks,
  ChartLine,
  Clock,
  CloudUpload,
  Database,
  Gauge,
  Hash,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  MessageSquareText,
  MousePointerClick,
  Package,
  Percent,
  Receipt,
  Repeat,
  RotateCcw,
  ScanSearch,
  Send,
  Share2,
  ShoppingCart,
  SlidersHorizontal,
  Star,
  Target,
  TrendingUp,
  UserMinus,
  Users,
  Wallet,
} from "lucide-react";
import type { Step } from "@/store/workspace";
import type { KpiIconName } from "@/ui/workspace/dashboard/page/pagePlan";

export interface AppStep {
  id: Step;
  label: string;
  icon: LucideIcon;
}

export interface AppPhase {
  id: "prepare" | "build" | "analyse" | "share";
  label: string;
  icon: LucideIcon;
  steps: AppStep[];
}

export const APP_PHASES: AppPhase[] = [
  {
    id: "prepare",
    label: "Prepare",
    icon: Database,
    steps: [
      { id: "upload", label: "Upload", icon: CloudUpload },
      { id: "detect", label: "Detect", icon: ScanSearch },
      { id: "map", label: "Check & map", icon: ListChecks },
    ],
  },
  {
    id: "build",
    label: "Build",
    icon: Blocks,
    steps: [
      { id: "customise", label: "Customise", icon: SlidersHorizontal },
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    id: "analyse",
    label: "Analyse",
    icon: ChartLine,
    steps: [
      { id: "questions", label: "Questions & SQL", icon: MessageSquareText },
      { id: "insights", label: "Insights", icon: Lightbulb },
    ],
  },
  {
    id: "share",
    label: "Share",
    icon: Send,
    steps: [{ id: "export", label: "Export", icon: Share2 }],
  },
];

/** Each kind of measure's icon, as the dashboard's KPI cards show it (ui/workspace/dashboard/KpiCards). */
export const KPI_ICON: Record<KpiIconName, LucideIcon> = {
  money: Banknote,
  profit: TrendingUp,
  cost: Receipt,
  pay: Wallet,
  orders: ShoppingCart,
  people: Users,
  loss: UserMinus,
  returns: RotateCcw,
  rating: Star,
  time: Clock,
  units: Package,
  traffic: MousePointerClick,
  conversion: Target,
  retention: Repeat,
  average: Gauge,
  percent: Percent,
  count: Hash,
};

/** The fallback when a KPI's icon is unknown. */
export const KPI_ICON_FALLBACK: LucideIcon = Activity;

/**
 * The icon chip's colours on a KPI card: a soft tint of one of the chart colours mixed into the
 * card's surface, the icon in that colour (tokens only, as the dashboard draws it).
 */
export function chipStyle(i: number): { background: string; color: string } {
  const c = `var(--chart-${(i % 8) + 1})`;
  return { background: `color-mix(in oklab, ${c} 14%, var(--surface-1))`, color: c };
}
