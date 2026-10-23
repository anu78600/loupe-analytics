"use client";

/**
 * Whether a media query matches, kept in step with the window
 * (useSyncExternalStore, so no effect sets state). The review table uses it
 * to draw a table from md and column cards on a phone, rather than both
 * hidden by CSS. `server` is the answer before the window exists; Check &
 * map only renders once a file is loaded in the browser, so it never shows.
 */
import * as React from "react";

export function useMediaQuery(query: string, server = true): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => server,
  );
}
