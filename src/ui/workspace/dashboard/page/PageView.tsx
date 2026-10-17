"use client";

/**
 * The dashboard step in its one-page view: a slim toolbar (the switch between
 * the one-page view and every chart, chart colours, and the page's download)
 * above the live page (OnePage.tsx). The page's insights are found as soon as
 * the view opens, and again whenever the selection changes them away.
 */
import * as React from "react";
import { toast } from "sonner";
import { Download, FileText, Loader2 } from "lucide-react";
import { useWorkspace } from "@/store/workspace";
import { useFmt } from "@/ui/common/hooks";
import { Button } from "@/ui/primitives/button";
import { Segmented } from "@/ui/primitives/segmented";
import { ChartColoursButton } from "../../ChartColours";
import { downloadOnePage, OnePage, usePageModel } from "./OnePage";

/** The switch between the one-page view and every chart; shown in both views' toolbars. */
export function ViewToggle() {
  const view = useWorkspace((s) => s.dashView);
  const setView = useWorkspace((s) => s.setDashView);
  return (
    <Segmented<"page" | "full">
      ariaLabel="Dashboard view"
      size="sm"
      value={view}
      onChange={setView}
      options={[
        { value: "page", label: "One page", title: "The dashboard on one landscape page, ready to present" },
        { value: "full", label: "All charts", title: "Every chart, by section" },
      ]}
    />
  );
}

export function PageView() {
  const fmt = useFmt();
  const title = useWorkspace((s) => s.pageTitle);
  const setTitle = useWorkspace((s) => s.setPageTitle);
  const insights = useWorkspace((s) => s.insights);
  const insightsLoading = useWorkspace((s) => s.insightsLoading);
  const loadInsights = useWorkspace((s) => s.loadInsights);
  const lastCompute = useWorkspace((s) => s.lastCompute);
  const computing = useWorkspace((s) => s.computing);
  const model = usePageModel(title);
  const [busy, setBusy] = React.useState<"png" | "pdf" | null>(null);
  // The insights strip needs the insights: asked for once per computed selection, so a load that
  // finds none doesn't ask again in a loop.
  const asked = React.useRef<unknown>(undefined);
  React.useEffect(() => {
    if (insights || insightsLoading || !lastCompute || asked.current === lastCompute) return;
    asked.current = lastCompute;
    void loadInsights();
  }, [insights, insightsLoading, lastCompute, loadInsights]);
  if (!model) return null;
  const download = async (format: "png" | "pdf") => {
    setBusy(format);
    try {
      await downloadOnePage(format, fmt);
      toast.success(format === "png" ? "Page downloaded as an image" : "Page downloaded as a PDF");
    } catch (e) {
      toast.error(`The page couldn't be made: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mx-auto w-full max-w-[1920px] px-4 py-4 md:px-6" aria-busy={computing}>
      <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <ViewToggle />
          <p className="hidden text-xs text-fg-subtle md:block">
            {computing ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin" aria-hidden /> Updating…
              </span>
            ) : (
              "Click the title to rename the page. The download is exactly this page."
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ChartColoursButton />
          <Button size="sm" variant="primary" onClick={() => void download("png")} disabled={Boolean(busy)}>
            {busy === "png" ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
            Download page
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void download("pdf")} disabled={Boolean(busy)}>
            {busy === "pdf" ? <Loader2 className="animate-spin" aria-hidden /> : <FileText aria-hidden />}
            PDF
          </Button>
        </div>
      </div>
      <OnePage model={model} live onRename={setTitle} />
    </div>
  );
}
