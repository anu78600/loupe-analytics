"use client";

/**
 * Motion building blocks for the landing page.
 *
 * - Reveal: fades, lifts and sharpens its content the first time it scrolls
 *   into view. It carries `data-reveal`, so the page's <noscript> rule shows
 *   it when JavaScript is off (Framer Motion renders it at opacity 0 until it
 *   hydrates).
 * - CountUp: a real figure from the build-time snapshot that counts up when it
 *   comes into view. The server HTML holds the final value, and screen readers
 *   always get the final value.
 * - Typewriter: types out a real text (SQL, DAX, a request) once active.
 * - Spotlight: a card whose border and surface catch a light that follows the
 *   pointer (the `spotlight` utility in globals.css).
 * - useCalm: whether the visitor asked for reduced motion, read so that the
 *   first client render matches the server HTML (Framer Motion's own hook
 *   reads it straight away, which breaks hydration for those visitors).
 * - useLive / useTicker: whether a graphic should be playing (in view, and the
 *   visitor hasn't asked for reduced motion), and a counter that steps while it
 *   is, so looping graphics stop off-screen.
 *
 * Framer Motion already follows the OS reduced-motion setting for transforms
 * (MotionConfig in ui/common/providers.tsx); the hooks here also stop loops
 * and typing, which are not transforms.
 */
import * as React from "react";
import { animate, motion, useInView, useMotionValue, useTransform } from "framer-motion";
import { formatValue, type ValueFormat } from "@/engine/core/format";
import { cn } from "@/lib/utils";

export const EASE = [0.22, 1, 0.36, 1] as const;
const FMT = { locale: "IN" as const, currency: "INR" };

const CALM_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeCalm(onChange: () => void): () => void {
  const mq = window.matchMedia(CALM_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * True when the visitor asked for reduced motion. False on the server and
 * while hydrating (so the markup matches), then the live setting.
 */
export function useCalm(): boolean {
  return React.useSyncExternalStore(
    subscribeCalm,
    () => window.matchMedia(CALM_QUERY).matches,
    () => false,
  );
}

/** Fades, lifts and sharpens its children into place the first time they scroll into view. */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 22,
  amount = 0.3,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  amount?: number;
}) {
  return (
    <motion.div
      data-reveal
      className={className}
      initial={{ opacity: 0, y, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount }}
      transition={{ duration: 0.85, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Whether a looping graphic should play: on screen, and motion not reduced. */
export function useLive<T extends Element>(amount = 0.35) {
  const ref = React.useRef<T>(null);
  const inView = useInView(ref, { amount });
  const reduce = useCalm();
  return { ref, inView, reduce, live: inView && !reduce };
}

/** A counter that goes up by one every `ms` while `running`; loops key their replays on it. */
export function useTicker(ms: number, running: boolean): number {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((t) => t + 1), ms);
    return () => window.clearInterval(id);
  }, [ms, running]);
  return tick;
}

/**
 * A real figure that counts up from zero the first time it is seen. Until
 * then (and in the server HTML) it shows the final value.
 */
export function CountUp({
  value,
  format = "integer",
  className,
}: {
  value: number;
  format?: ValueFormat;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useCalm();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => formatValue(format === "integer" ? Math.round(v) : v, format, FMT));
  React.useEffect(() => {
    if (!inView || reduce) return;
    mv.set(0);
    const controls = animate(mv, value, { duration: 1.6, ease: EASE });
    return () => controls.stop();
  }, [inView, reduce, value, mv]);
  return (
    <span ref={ref} className={className}>
      <motion.span aria-hidden>{text}</motion.span>
      <span className="sr-only">{formatValue(value, format, FMT)}</span>
    </span>
  );
}

/**
 * Types `text` out once `active` (whole at once under reduced motion), with a
 * blinking caret while it types. Assistive technology reads the whole text.
 */
export function Typewriter({
  text,
  active,
  charsPerSecond = 160,
  delay = 0,
  className,
}: {
  text: string;
  active: boolean;
  charsPerSecond?: number;
  delay?: number;
  className?: string;
}) {
  const reduce = useCalm();
  // The server HTML (and a page without JavaScript) shows the whole text.
  const count = useMotionValue(text.length);
  const shown = useTransform(count, (n) => text.slice(0, Math.round(n)));
  const caret = useTransform(count, (n) => (n < text.length ? 1 : 0));
  React.useEffect(() => {
    if (!active) return;
    if (reduce) {
      count.set(text.length);
      return;
    }
    count.set(0);
    const controls = animate(count, text.length, {
      duration: text.length / charsPerSecond,
      delay,
      ease: "linear",
    });
    return () => controls.stop();
  }, [active, text, charsPerSecond, delay, reduce, count]);
  return (
    <span className={className}>
      <span aria-hidden>
        <motion.span>{shown}</motion.span>
        {/* The caret shows while typing; the blink lives on an inner span so it can't override that. */}
        <motion.span style={{ opacity: caret }} className="ml-px inline-block translate-y-[0.15em]">
          <span className="block h-[1.05em] w-[2px] animate-[caret-blink_1s_steps(1)_infinite] bg-accent" />
        </motion.span>
      </span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

/** A surface that catches a light following the pointer (border and fill). */
export function Spotlight({
  children,
  className,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "li";
}) {
  const ref = React.useRef<HTMLDivElement & HTMLLIElement>(null);
  // Writes CSS variables straight to the element: no React render per pointer move.
  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <Tag ref={ref} onPointerMove={onMove} className={cn("spotlight", className)}>
      {children}
    </Tag>
  );
}
