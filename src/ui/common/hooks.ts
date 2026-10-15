"use client";

/** Shared UI hooks: number formatting options, hydration and theme signals, reduced motion and count-up animation. */
import * as React from "react";
import { useReducedMotion } from "framer-motion";
import type { FormatOptions } from "@/engine/core/format";
import { useSettings } from "@/store/settings";
import { useWorkspace } from "@/store/workspace";

/**
 * Formatting options for the UI: the chosen number locale and the currency
 * (user override, else the configured or detected one, else INR). Memoised,
 * so it is safe as a dependency.
 */
export function useFmt(): FormatOptions {
  const locale = useSettings((s) => s.numberLocale);
  const override = useSettings((s) => s.currencyOverride);
  const detected = useWorkspace((s) => s.context?.currency ?? s.profile?.currency.code ?? "INR");
  const currency = override ?? detected;
  return React.useMemo(() => ({ locale, currency }), [locale, currency]);
}

const noSubscription = () => () => {};

/**
 * False while rendering on the server and while hydrating, true from then on.
 * Gate browser-only values (persisted settings, media queries) behind it so
 * the first client render matches the server HTML; React re-renders with
 * `true` straight after hydration. Components mounted later see `true` at once.
 */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

// The resolved theme lives in <html data-theme> (set by the boot script before
// paint, then by applyTheme()); a MutationObserver reports every change,
// including OS switches while the preference is "system".
function subscribeTheme(onChange: () => void): () => void {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}
const themeSnapshot = () => document.documentElement.dataset.theme ?? "dark";
const serverTheme = () => "dark";

/**
 * The resolved theme ("dark" | "light"), so canvas charts re-read CSS tokens
 * when it changes. "dark" (the server default) during server rendering and
 * hydration, then the live value.
 */
export function useThemeKey(): string {
  return React.useSyncExternalStore(subscribeTheme, themeSnapshot, serverTheme);
}

/** False when the user prefers reduced motion. */
export function useAnimate(): boolean {
  const reduce = useReducedMotion();
  return !reduce;
}

/**
 * Count-up for figures; respects reduced motion and never shifts layout (tabular figures).
 *
 * Animates (cubic ease-out over `duration` ms) from the value currently on
 * screen: 0 on mount, so the final figure never flashes before the count
 * starts, and wherever an interrupted animation had got to when the target
 * changes mid-way, so it never jumps back. With reduced motion the target is
 * returned directly. null and non-finite targets pass straight through.
 * During hydration the motion preference is not yet trusted (the server
 * cannot know it), so the first client render matches the server's 0.
 */
export function useCountUp(target: number | null, duration = 700): number | null {
  const animate = useAnimate();
  const hydrated = useHydrated();
  const moving = animate || !hydrated;
  // The animated value; only ever set from animation frames, never synchronously in the effect.
  const [frame, setFrame] = React.useState(0);
  // What is on screen right now: the origin of the next animation.
  const shown = React.useRef(0);
  const finite = target !== null && Number.isFinite(target);
  React.useEffect(() => {
    if (!moving || target === null || !Number.isFinite(target)) return;
    const origin = shown.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const v = origin + (target - origin) * (1 - Math.pow(1 - t, 3));
      shown.current = v;
      setFrame(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, moving, duration]);
  if (!finite || !moving) return target;
  return frame;
}
