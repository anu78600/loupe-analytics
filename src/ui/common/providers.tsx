"use client";

/**
 * App-wide client providers, mounted once in the root layout: Framer Motion
 * honours the OS reduced-motion setting, one shared TooltipProvider (moving
 * between tooltips skips the delay), theme and chart-colour syncing, the
 * toast host, and the feedback dialog (feedback/FeedbackDialog.tsx), which
 * any page opens through useFeedback. Toasts sit on the overlay plane like menus and popovers
 * (--surface-overlay, the pop shadow, the card radius); their classes use `!`
 * so the design tokens override sonner's built-in styles.
 */
import * as React from "react";
import { Toaster } from "sonner";
import { MotionConfig } from "framer-motion";
import { TooltipProvider } from "@/ui/primitives/tooltip";
import { applyTheme, useSettings } from "@/store/settings";
import { applyChartTheme } from "@/ui/charts/palette/apply";
import { useChartThemePreview } from "@/ui/charts/palette/preview";
import { resolveTheme } from "@/ui/charts/palette/themes";
import { FeedbackDialog } from "./feedback/FeedbackDialog";

/** Applies the theme preference, and while it is "system", follows OS light/dark changes live. */
function ThemeSync() {
  const theme = useSettings((s) => s.theme);
  React.useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);
  return null;
}

/** Puts the chosen chart colours on the page (palette/apply.ts) whenever the setting changes. */
function ChartThemeSync() {
  const choice = useSettings((s) => s.chartTheme);
  // While the chart-colours panel previews a choice, the page shows it unsaved (palette/preview.ts).
  const draft = useChartThemePreview((s) => (s.live ? s.draft : null));
  React.useEffect(() => {
    applyChartTheme(resolveTheme(draft ?? choice), !draft);
  }, [choice, draft]);
  return null;
}

/** `version` is the current release (the layout reads the version log on the server), for the feedback's details. */
export function Providers({ children, version }: { children: React.ReactNode; version: string }) {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250} skipDelayDuration={150}>
        <ThemeSync />
        <ChartThemeSync />
        {children}
        <FeedbackDialog version={version} />
        <Toaster
          position="bottom-right"
          gap={8}
          // On phones toasts sit above the workspace's bottom bar (ui/workspace/shell/BottomBar.tsx).
          mobileOffset={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}
          toastOptions={{
            classNames: {
              toast:
                "!rounded-card !border !border-border !bg-surface-overlay !text-fg !shadow-pop !font-sans !text-ui",
              description: "!text-fg-muted",
              actionButton: "!bg-accent !text-accent-fg",
              // A status toast's icon in its status colour (the fill, which icons use).
              success: "[&_[data-icon]]:text-success",
              error: "[&_[data-icon]]:text-danger",
              warning: "[&_[data-icon]]:text-warning",
              info: "[&_[data-icon]]:text-info",
            },
          }}
        />
      </TooltipProvider>
    </MotionConfig>
  );
}
