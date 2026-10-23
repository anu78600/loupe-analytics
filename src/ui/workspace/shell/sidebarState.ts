"use client";

/**
 * Whether the workspace sidebar is the full list or the icon rail.
 *
 * By default the CSS decides (globals.css, .ws-sidebar): the full list from
 * 1280 px, the icon rail below that and on the canvas steps (Customise,
 * Dashboard), where the charts need the width. Once the user collapses or
 * expands it, that choice wins everywhere: it is written to
 * <html data-sidebar="open|closed"> and remembered in localStorage, and
 * sidebarBootScript puts it back before the first paint, so the sidebar
 * never jumps from one width to the other while the page loads.
 *
 * React only needs to know the width for what the CSS can't do (tooltips on
 * the rail's icons, the toggle's label), so useRailCollapsed measures the
 * sidebar after it mounts rather than guessing during render, which keeps the
 * server and client renders identical.
 */
import * as React from "react";

export const SIDEBAR_STORAGE_KEY = "loupe-sidebar";
/** Below this width the sidebar is the icon rail (the CSS container query uses the same 12rem). */
const RAIL_BELOW_PX = 192;

/** Inline, render-blocking: restores the user's choice before first paint (no width jump). */
export const sidebarBootScript = `(function(){try{var p=localStorage.getItem('${SIDEBAR_STORAGE_KEY}');if(p==='open'||p==='closed')document.documentElement.dataset.sidebar=p;}catch(e){}})();`;

/** Makes the user's choice stick: on <html> for the CSS, and in storage for the next visit. */
export function setSidebarOpen(open: boolean): void {
  const value = open ? "open" : "closed";
  document.documentElement.dataset.sidebar = value;
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, value);
  } catch {
    /* storage can be unavailable (private mode); the choice still holds for this view */
  }
}

/**
 * True while `ref`'s element is narrower than the full sidebar (the icon
 * rail). False until measured, as on the server.
 */
export function useRailCollapsed(ref: React.RefObject<HTMLElement | null>): boolean {
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCollapsed(entry.contentRect.width < RAIL_BELOW_PX);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return collapsed;
}
