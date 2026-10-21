/**
 * Small browser helpers shared across the UI: class merging, downloads,
 * clipboard, slugs and platform detection. Downloads are built locally from
 * Blobs or data URLs; nothing is uploaded. The DOM helpers must only run in
 * the browser (event handlers or effects), never during server rendering.
 */
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge configured with the design system's custom scales
 * (globals.css @theme), so a later class wins over an earlier one of the same
 * kind. Without this it treats `text-ui` as a colour, so
 * `cn("text-ui", "text-fg-muted")` silently dropped the font size; it could
 * not resolve `rounded-card` against `rounded-[8px]`; and it kept both of
 * `duration-fast duration-slow` or `opacity-disabled opacity-50`, leaving the
 * stylesheet's order to decide. tests/theme-utilities.test.ts reads @theme
 * and fails for any name added there but not here.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      // T-shirt sizes (2xs, md…) are known to it already; the named ones are not.
      text: ["ui", "display-xs", "display-sm", "display-md", "display", "display-lg", "display-xl"],
      // The radius scale: xs 4, sm 6, control 8, card 12, panel 16 (xs and sm are t-shirt sizes it knows).
      radius: ["xs", "sm", "control", "card", "panel"],
      // Card, pop and lift per plane, and the focus ring as a shadow (shadow-focus, not a shadow colour).
      shadow: ["card", "pop", "lift", "focus"],
      ease: ["out-quint", "in-out-soft"],
      animate: ["shimmer", "fade-up", "pulse-soft"],
    },
    classGroups: {
      // Named steps, not numbers: interface motion 120 / 180 / 240 ms, and chart drawing.
      duration: [{ duration: ["fast", "base", "slow", "chart"] }],
      // The one disabled opacity, and the opacity of chart marks a selection leaves out.
      opacity: [{ opacity: ["disabled", "chart-dim"] }],
    },
  },
});

/** Merge class names, letting later Tailwind utilities win conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Trigger a browser download for a Blob or string payload. */
export function downloadBlob(data: Blob | string, fileName: string, mime = "text/plain;charset=utf-8"): void {
  const blob = typeof data === "string" ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers; give it a moment to start.
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Download a data URL (e.g. a chart PNG) under a file name. */
export function downloadDataUrl(dataUrl: string, fileName: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * File-name-safe slug: accents folded (NFKD, then combining marks removed),
 * lower case, runs of anything else collapsed to "-", at most 60 characters,
 * "loupe" when nothing is left.
 */
export function slugify(input: string): string {
  return (
    input
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "loupe"
  );
}

/**
 * A download's file name, the same pattern for every export:
 * "{dataset}_{artefact}_{YYYY-MM-DD}.{ext}", e.g.
 * "sales-orders_dashboard-report_2026-10-16.pdf". The dataset comes first so a
 * folder of exports groups by file; the local date says which run it is; the
 * artefact names match the files inside the Power BI package (measures, kpis,
 * data-dictionary…). Call it when the download happens, not during render.
 */
export function exportFileName(dataset: string | undefined, artefact: string, ext: string): string {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${slugify(dataset ?? "loupe")}_${slugify(artefact)}_${day}.${ext}`;
}

/** Copies to the clipboard; false when the Clipboard API is missing or permission is refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Apple platform check for shortcut labels (⌘ vs Ctrl). Safe during SSR, where it returns false. */
export const isMac = (): boolean =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
