"use client";

/**
 * User preferences, persisted to localStorage ("loupe-settings"): theme,
 * chart colours, Indian vs international number format, whether Loupe may add
 * columns to the data (ask first, or never) and the AI model. The AI toggle
 * and API key are deliberately not persisted: every reload starts with the AI
 * layer off and no key stored anywhere. The currency override lives here too
 * but belongs to the open file: it is never persisted, and the workspace
 * clears it when another file is loaded or on "Start over" (a currency chosen
 * for one file must not price the next one).
 *
 * The theme is also mirrored to its own key ("loupe-theme") so that
 * themeBootScript can apply it before React hydrates. On the client the
 * store rehydrates synchronously at creation, so components that render
 * persisted values must guard against server/client mismatches.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DEFAULT_CHART_THEME, sanitiseChoice, type ChartThemeChoice } from "@/ui/charts/palette/themes";

export type ThemePreference = "dark" | "light" | "system";
/** Same values as the engine's NumberLocale (engine/core/format); keep in sync. */
export type NumberLocale = "IN" | "INTL";
/**
 * Whether Loupe may add a column to the user's data (unpivoting, or a Power
 * BI helper column): "ask" shows exactly what would be added and waits for a
 * yes; "never" adds nothing and builds without it. There is no "always".
 */
export type NewColumnsPolicy = "ask" | "never";

export interface AiSettings {
  /** Opt-in per session: always false after a reload. */
  enabled: boolean;
  model: string;
  /** Held in memory for this tab only; never persisted. */
  apiKey: string;
}

interface SettingsState {
  theme: ThemePreference;
  /**
   * Chart colours: a preset, the user's own colours or one colour turned
   * into a gradient (ui/charts/palette). ChartThemeSync applies it to every
   * chart, report and export.
   */
  chartTheme: ChartThemeChoice;
  /** The number format in effect (what every formatter uses). */
  numberLocale: NumberLocale;
  /**
   * Automatic number format (the default): Indian lakh/crore grouping for
   * rupee data, international K/M/B otherwise, resolved per dataset by
   * applyAutoNumberLocale. Choosing a format explicitly turns it off.
   */
  numberFormatAuto: boolean;
  /**
   * ISO 4217 code chosen by the user for the open file; null = use the
   * detected currency. Not persisted; reset with each new file.
   */
  currencyOverride: string | null;
  newColumns: NewColumnsPolicy;
  ai: AiSettings;
  setTheme: (theme: ThemePreference) => void;
  /** Sanitised first: colours normalised, unknown shapes become the default. */
  setChartTheme: (choice: ChartThemeChoice) => void;
  /** Explicit choice: sets the format and turns automatic mode off. */
  setNumberLocale: (locale: NumberLocale) => void;
  setNumberFormatAuto: (on: boolean) => void;
  /** In automatic mode, picks the format for a dataset's currency; does nothing otherwise. */
  applyAutoNumberLocale: (currency: string) => void;
  setCurrencyOverride: (code: string | null) => void;
  setNewColumns: (policy: NewColumnsPolicy) => void;
  setAi: (patch: Partial<AiSettings>) => void;
}

export const THEME_STORAGE_KEY = "loupe-theme";

/**
 * Sets `data-theme` on <html> ("system" resolved against the OS setting at
 * call time) and remembers the preference for the boot script. Does not
 * follow later OS changes by itself; ThemeSync in ui/common/providers does.
 * No-op during server rendering.
 */
export function applyTheme(pref: ThemePreference): void {
  if (typeof document === "undefined") return;
  const resolved =
    pref === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : pref;
  document.documentElement.dataset.theme = resolved;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* storage can be unavailable (private mode); theme still applies for this view */
  }
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      chartTheme: DEFAULT_CHART_THEME,
      numberLocale: "IN",
      numberFormatAuto: true,
      currencyOverride: null,
      newColumns: "ask",
      ai: { enabled: false, model: "claude-opus-5-5", apiKey: "" },
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      setChartTheme: (choice) => set({ chartTheme: sanitiseChoice(choice) }),
      setNumberLocale: (numberLocale) => set({ numberLocale, numberFormatAuto: false }),
      setNumberFormatAuto: (numberFormatAuto) => set({ numberFormatAuto }),
      applyAutoNumberLocale: (currency) => {
        if (!get().numberFormatAuto) return;
        const want: NumberLocale = currency === "INR" ? "IN" : "INTL";
        if (get().numberLocale !== want) set({ numberLocale: want });
      },
      setCurrencyOverride: (currencyOverride) => set({ currencyOverride }),
      setNewColumns: (newColumns) => set({ newColumns }),
      setAi: (patch) => set((s) => ({ ai: { ...s.ai, ...patch } })),
    }),
    {
      name: "loupe-settings",
      storage: createJSONStorage(() => localStorage),
      // The API key is deliberately excluded from persistence. The AI toggle is
      // written as false too, so a stored settings blob can never re-enable it.
      // The currency override belongs to the open file, which a reload forgets.
      partialize: (s) => ({
        theme: s.theme,
        chartTheme: s.chartTheme,
        numberLocale: s.numberLocale,
        numberFormatAuto: s.numberFormatAuto,
        newColumns: s.newColumns,
        ai: { enabled: false, model: s.ai.model, apiKey: "" },
      }),
      // A stored chart theme is outside input (it could come from an older version): sanitise it.
      // A currency stored by an older version is ignored, or it would price every later file.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return { ...current, ...p, currencyOverride: null, chartTheme: sanitiseChoice(p.chartTheme) };
      },
    },
  ),
);

/**
 * Inline, render-blocking script that sets data-theme before first paint (no flash).
 * Must mirror applyTheme()'s resolution; any storage error falls back to dark.
 */
export const themeBootScript = `(function(){try{var p=localStorage.getItem('${THEME_STORAGE_KEY}')||'dark';var t=p==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):p;document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;
