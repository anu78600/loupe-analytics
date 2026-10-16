"use client";

/**
 * App-wide client providers, mounted once in the root layout: Framer Motion
 * honours the OS reduced-motion setting, one shared TooltipProvider (moving
 * between tooltips skips the delay), theme and chart-colour syncing and the
 * toast host. Toast classes use `!` so the design tokens override sonner's
 * built-in styles.
 */
import * as React from "react";
import { Toaster } from "sonner";
import { MotionConfig } from "framer-motion";
import { TooltipProvider } from "@/ui/primitives/tooltip";
import { applyTheme, useSettings } from "@/store/settings";
import { applyChartTheme } from "@/ui/charts/palette/apply";
import { resolveTheme } from "@/ui/charts/palette/themes";

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
  React.useEffect(() => {
    applyChartTheme(resolveTheme(choice));
  }, [choice]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250} skipDelayDuration={150}>
        <ThemeSync />
        <ChartThemeSync />
        {children}
        <Toaster
          position="bottom-right"
          gap={8}
          toastOptions={{
            classNames: {
              toast:
                "!rounded-[12px] !border !border-border-strong !bg-surface-2 !text-fg !shadow-pop !font-sans !text-ui",
              description: "!text-fg-muted",
              actionButton: "!bg-accent !text-accent-fg",
            },
          }}
        />
      </TooltipProvider>
    </MotionConfig>
  );
}
