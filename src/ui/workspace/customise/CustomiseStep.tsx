"use client";

/**
 * Step 4, Customise: full control over what the dashboard shows.
 * - KPIs (KpiPlanner): which KPIs are in the headline row, which are
 *   supporting tiles and which are "From your other columns" tiles, in what
 *   order, plus KPIs the user builds from any column (KpiBuilder).
 * - Charts (ChartList): per layout mode, which charts show, their order,
 *   size, title and type, and the data behind any of them.
 * - Create a chart (ChartStudio): a gallery of every chart type grouped by
 *   the question it answers, each with two lines on what it shows and the
 *   data it suits, and a builder that takes columns and measures and draws
 *   the real chart before it is added.
 * Every change reaches the dashboard straight away. "Back to recommended"
 * restores the recommended layout and keeps what the user built (with Undo).
 */
import * as React from "react";
import { toast } from "sonner";
import { ArrowRight, RotateCcw } from "lucide-react";
import type { ChartSpec } from "@/engine/charts/types";
import { allSpecs, kpiLayoutOf, stepNumber, useWorkspace } from "@/store/workspace";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Eyebrow } from "@/ui/primitives/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/primitives/tabs";
import { KpiPlanner } from "./KpiPlanner";
import { ChartList } from "./ChartList";
import { ChartStudio } from "./ChartStudio";

type Tab = "kpis" | "charts" | "create";

export function CustomiseStep() {
  const context = useWorkspace((s) => s.context);
  const setStep = useWorkspace((s) => s.setStep);
  const kpiLayout = useWorkspace((s) => s.kpiLayout);
  const extraKpis = useWorkspace((s) => s.extraKpis);
  const widgets = useWorkspace((s) => s.widgets);
  const customCharts = useWorkspace((s) => s.customCharts);
  const mode = useWorkspace((s) => s.mode);
  const [tab, setTab] = React.useState<Tab>("kpis");
  // The chart being edited in the builder; null builds a new one.
  const [editing, setEditing] = React.useState<ChartSpec | null>(null);
  if (!context) return null;

  const layout = kpiLayoutOf({ context, kpiLayout, extraKpis });
  const kpiCount = layout.hero.length + layout.supporting.length + layout.columns.length;
  const specs = allSpecs({ context, customCharts });
  const chartCount = widgets.filter(
    (w) => !w.hidden && specs.find((x) => x.id === w.id)?.modes.includes(mode),
  ).length;

  const reset = () => {
    const before = useWorkspace.getState();
    const snapshot = { kpiLayout: before.kpiLayout, widgets: before.widgets, extraKpis: before.extraKpis };
    before.resetCustomisation();
    toast("Back to the recommended KPIs and charts. Your own KPIs and charts are kept.", {
      action: {
        label: "Undo",
        onClick: () => {
          useWorkspace.setState(snapshot);
          useWorkspace.getState().refresh();
        },
      },
    });
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-8 md:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <Eyebrow>Step {stepNumber("customise")} · Customise</Eyebrow>
          <h1 className="mt-2 font-display text-display-sm text-fg">Make the dashboard yours.</h1>
          <p className="mt-2 text-ui text-fg-muted">
            Choose exactly which KPIs and charts it shows, in what order and how big; change any chart&apos;s
            type or data; and build new KPIs and charts from your columns. Everything applies straight away.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={reset}>
            <RotateCcw aria-hidden /> Back to recommended
          </Button>
          <Button variant="primary" onClick={() => setStep("dashboard")}>
            Continue to dashboard <ArrowRight aria-hidden />
          </Button>
        </div>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-5">
          <TabsTrigger value="kpis">
            KPIs <Badge className="ml-1.5">{kpiCount}</Badge>
          </TabsTrigger>
          <TabsTrigger value="charts">
            Charts <Badge className="ml-1.5">{chartCount}</Badge>
          </TabsTrigger>
          <TabsTrigger value="create" onClick={() => setEditing(null)}>
            Create a chart
          </TabsTrigger>
        </TabsList>
        <TabsContent value="kpis">
          <KpiPlanner />
        </TabsContent>
        <TabsContent value="charts">
          <ChartList
            onEdit={(spec) => {
              setEditing(spec);
              setTab("create");
            }}
            onCreate={() => {
              setEditing(null);
              setTab("create");
            }}
          />
        </TabsContent>
        <TabsContent value="create">
          {/* Keyed by the chart being edited, so each opening starts from that chart (or a blank one). */}
          <ChartStudio
            key={editing?.id ?? "new"}
            editing={editing}
            onDone={() => {
              setEditing(null);
              setTab("charts");
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
