/**
 * The colours shown on the page while the chart-colours panel is open
 * (version 52.0). The panel sets `draft` as the user chooses, so the
 * dashboard behind it redraws in those colours before anything is applied;
 * ChartThemeSync (ui/common/providers) paints `draft` over the setting
 * without saving it, and the panel clears it when it closes, which puts the
 * colours in use back. `live` is the panel's "Show on dashboard" switch.
 */
import { create } from "zustand";
import type { ChartThemeChoice } from "./themes";

export const useChartThemePreview = create<{
  draft: ChartThemeChoice | null;
  live: boolean;
  setDraft: (draft: ChartThemeChoice | null) => void;
  setLive: (live: boolean) => void;
}>()((set) => ({
  draft: null,
  live: true,
  setDraft: (draft) => set({ draft }),
  setLive: (live) => set({ live }),
}));
