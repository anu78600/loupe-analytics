"use client";

/**
 * Theme switcher: a dark/light/system segmented control, or (`compact`) one
 * icon button that flips between dark and light.
 *
 * The persisted preference and the resolved theme exist only in the browser,
 * so both are read through useSyncExternalStore with "dark" (the server
 * default) as the server snapshot: the server HTML and the first client
 * render agree, and the real values follow straight after hydration.
 */
import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useSettings, type ThemePreference } from "@/store/settings";
import { useHydrated, useThemeKey } from "@/ui/common/hooks";
import { Segmented } from "@/ui/primitives/segmented";
import { Button } from "@/ui/primitives/button";
import { Tooltip } from "@/ui/primitives/tooltip";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const hydrated = useHydrated();
  // The theme on screen ("system" already resolved); "dark" until hydrated.
  const resolved = useThemeKey();

  if (compact) {
    // Flip what is on screen, so a "system" preference flips the right way too.
    const next: ThemePreference = resolved === "light" ? "dark" : "light";
    const label = `Switch to ${next} theme`;
    return (
      <Tooltip content={label}>
        <Button variant="ghost" size="icon" aria-label={label} onClick={() => setTheme(next)}>
          {next === "dark" ? <Moon aria-hidden /> : <Sun aria-hidden />}
        </Button>
      </Tooltip>
    );
  }

  return (
    <Segmented<ThemePreference>
      ariaLabel="Theme"
      size="sm"
      value={hydrated ? theme : "dark"}
      onChange={setTheme}
      options={[
        { value: "dark", label: "", icon: <Moon aria-hidden />, title: "Dark" },
        { value: "light", label: "", icon: <Sun aria-hidden />, title: "Light" },
        { value: "system", label: "", icon: <Monitor aria-hidden />, title: "System" },
      ]}
    />
  );
}
