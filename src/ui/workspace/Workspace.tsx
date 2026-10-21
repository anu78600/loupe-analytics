"use client";

/**
 * Client shell for /app. Switches between the steps (STEPS) with a short fade,
 * binds Ctrl/⌘+K, opens a demo from /app?sample=<id> (on a given step with
 * &step=<step>, e.g. dashboard), turns errors after the upload step into
 * toasts, asks before a reload or leaving the page would drop a loaded
 * dataset, hosts the confirmation dialog (askConfirm), and reconfigures the
 * session when the number format or currency changes (worker-side text such
 * as chart descriptions and exports depends on them).
 */
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { STEPS, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { openDemo, WorkspaceTopBar } from "./Shell";
import { UploadStep } from "./UploadStep";
import { DetectStep } from "./DetectStep";
import { MapStep } from "./MapStep";
import { DashboardStep } from "./dashboard/DashboardStep";
import { InsightsStep } from "./InsightsStep";
import { QuestionsStep } from "./QuestionsStep";
import { ExportStep } from "./ExportStep";
import { CommandPalette } from "./CommandPalette";
import { SettingsSheet } from "./SettingsSheet";
import { CustomiseStep } from "./customise/CustomiseStep";
import { ChartColoursSheet } from "./ChartColours";
import { ConfirmHost } from "./confirm";

export function Workspace({ version }: { version: string }) {
  const step = useWorkspace((s) => s.step);
  const error = useWorkspace((s) => s.error);
  const loading = useWorkspace((s) => s.loading);
  const hasContext = useWorkspace((s) => Boolean(s.context));
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  // Each step starts at the top (confirming on Detect used to land mid-dashboard).
  React.useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  // Cmd/Ctrl+K command palette
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Deep link: /app?sample=ecommerce opens a demo dataset straight away, and &step=dashboard opens
  // it on that step. The query then leaves the address bar, so a reload keeps the work instead of
  // reopening the demo; Next's own state for the history entry is kept (replacing it with null
  // left Back showing the landing page under /app).
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sample = params.get("sample");
    if (!sample) return;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    const step = params.get("step");
    const goTo = STEPS.find((s) => s.id === step)?.id;
    void openDemo(sample, goTo);
  }, []);

  // Nothing is stored: a reload or leaving the page drops the dataset and everything set up for
  // it, so the browser asks first while one is loaded. Not under automation (navigator.webdriver),
  // where nobody could answer and every scripted reload would stall.
  const hasData = useWorkspace((s) => Boolean(s.summary));
  React.useEffect(() => {
    if (!hasData || navigator.webdriver) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers ask only when returnValue is set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasData]);

  // Errors after the upload step surface as toasts (the upload step shows them inline).
  React.useEffect(() => {
    if (error && step !== "upload") {
      toast.error(error);
      useWorkspace.setState({ error: null });
    }
  }, [error, step]);

  // Number format and currency also affect worker-side text (alt text, insights, exports).
  const locale = useSettings((s) => s.numberLocale);
  const currency = useSettings((s) => s.currencyOverride);
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (useWorkspace.getState().context) void useWorkspace.getState().reconfigure();
  }, [locale, currency]);

  const view =
    step === "upload" || !useWorkspace.getState().summary ? (
      <UploadStep />
    ) : step === "detect" ? (
      <DetectStep />
    ) : step === "map" ? (
      <MapStep />
    ) : step === "customise" ? (
      hasContext ? (
        <CustomiseStep />
      ) : (
        <UploadStep />
      )
    ) : step === "dashboard" ? (
      hasContext ? (
        <DashboardStep />
      ) : (
        <UploadStep />
      )
    ) : step === "questions" ? (
      <QuestionsStep />
    ) : step === "insights" ? (
      <InsightsStep />
    ) : (
      <ExportStep />
    );

  return (
    <div className="relative isolate min-h-dvh bg-bg">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(60%_100%_at_50%_0%,var(--mesh-1),transparent_75%)] opacity-70"
      />
      <WorkspaceTopBar
        onOpenCommand={() => setCommandOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {/* One main landmark for every step (the skip link targets #main). */}
      <main id="main">
        <AnimatePresence mode="wait">
          <motion.div
            key={loading && step === "upload" ? "upload" : step}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {view}
          </motion.div>
        </AnimatePresence>
      </main>
      {loading && step !== "upload" ? (
        <div role="status" aria-live="polite" className="fixed inset-x-0 top-14 z-50 flex justify-center">
          <div className="mt-3 flex items-center gap-2.5 rounded-full border border-border bg-surface-overlay px-4 py-2 text-ui text-fg shadow-pop">
            <span className="size-2 animate-pulse rounded-full bg-accent" aria-hidden />
            {loading.title}
          </div>
        </div>
      ) : null}
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} version={version} />
      <ChartColoursSheet />
      <ConfirmHost />
    </div>
  );
}
