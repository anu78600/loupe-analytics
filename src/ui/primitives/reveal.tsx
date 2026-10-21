"use client";
/**
 * Less text on screen, the rest one gesture away. Explanations, hints and
 * long values are shown short; the full text opens:
 * - on a desktop, on hover (after a short pause) or keyboard focus;
 * - on a phone or tablet, on a tap of the ⓘ button or a long press on the
 *   short text itself (touch has no hover).
 *
 * Three pieces share one behaviour (useReveal over a Radix Popover, so
 * Escape, outside clicks and focus return work everywhere):
 * - InfoTip: a small ⓘ button that holds the full text;
 * - Brief: short text shown, the full text behind it and its ⓘ;
 * - ClampText: text clamped to one or two lines that opens in full only
 *   when it was actually cut.
 */
import * as React from "react";
import { Info } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/** How long a finger must rest before the full text opens (the platform's long-press feel). */
const LONG_PRESS_MS = 450;
const HOVER_OPEN_MS = 180;
const HOVER_CLOSE_MS = 140;

/**
 * Open state plus the handlers that open it on mouse hover, keyboard focus,
 * tap and long press. A long press swallows the click that follows it, so
 * the press doesn't also toggle the popover shut.
 */
function useReveal() {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<number | null>(null);
  const pressed = React.useRef(false);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  React.useEffect(() => clear, []);
  const later = (next: boolean, ms: number) => {
    clear();
    timer.current = window.setTimeout(() => setOpen(next), ms);
  };
  const hover = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") later(true, HOVER_OPEN_MS);
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") later(false, HOVER_CLOSE_MS);
    },
  };
  const press = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") return;
      pressed.current = false;
      clear();
      timer.current = window.setTimeout(() => {
        pressed.current = true;
        setOpen(true);
      }, LONG_PRESS_MS);
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerMove: (e: React.PointerEvent) => {
      // A finger that scrolls is not a press.
      if (e.pointerType !== "mouse" && (Math.abs(e.movementX) > 6 || Math.abs(e.movementY) > 6)) clear();
    },
    onContextMenu: (e: React.MouseEvent) => {
      if (pressed.current) e.preventDefault();
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (pressed.current) {
        e.preventDefault();
        e.stopPropagation();
        pressed.current = false;
      }
    },
  };
  /**
   * The ⓘ button: keyboard focus opens it (only :focus-visible, so a dialog
   * moving focus doesn't), blur closes it, and a click or tap always opens it.
   * The click skips Radix's own toggle, which would otherwise shut a popover
   * that hover or focus had just opened, so a tap on Android showed nothing.
   */
  const trigger = {
    ...hover,
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      if (e.currentTarget.matches(":focus-visible")) setOpen(true);
    },
    onBlur: () => setOpen(false),
    onClick: (e: React.MouseEvent) => {
      e.preventDefault();
      clear();
      setOpen(true);
    },
  };
  return { open, setOpen, hover, press, clear, trigger };
}

/** The popover panel holding the full text; hovering it keeps it open. */
function RevealContent({
  children,
  onPointerEnter,
  onPointerLeave,
  className,
}: {
  children: React.ReactNode;
  onPointerEnter: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  className?: string;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Focus going back to the trigger on close would open it again (it opens on focus).
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        className={cn(
          "z-[60] max-w-[min(20rem,calc(100vw-24px))] rounded-[10px] border border-border-strong bg-surface-2 px-3 py-2 text-xs text-fg shadow-pop",
          "data-[state=open]:animate-[fade-up_140ms_var(--ease-out-quint)]",
          className,
        )}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

/**
 * A small ⓘ button holding the full explanation. `label` names it for
 * screen readers ("About the health score"); the hit area is 24 px.
 */
export function InfoTip({
  children,
  label = "More information",
  className,
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  const r = useReveal();
  return (
    <PopoverPrimitive.Root open={r.open} onOpenChange={r.setOpen}>
      <PopoverPrimitive.Trigger
        type="button"
        aria-label={label}
        {...r.trigger}
        className={cn(
          "-m-1 inline-grid size-6 shrink-0 place-items-center rounded-full align-middle text-fg-subtle transition-colors hover:text-fg data-[state=open]:text-accent",
          className,
        )}
      >
        <Info className="size-3.5" aria-hidden />
      </PopoverPrimitive.Trigger>
      <RevealContent onPointerEnter={r.hover.onPointerEnter} onPointerLeave={r.hover.onPointerLeave}>
        {children}
      </RevealContent>
    </PopoverPrimitive.Root>
  );
}

/**
 * Short text on screen with the full text behind it: hover the text or its
 * ⓘ on a desktop, long-press the text or tap the ⓘ on touch. Use it for
 * step intros, hints and notes whose first words carry the meaning.
 */
export function Brief({
  full,
  children,
  label,
  className,
}: {
  /** The complete text, shown in the popover. */
  full: React.ReactNode;
  /** The short text shown on screen. */
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  const r = useReveal();
  return (
    <PopoverPrimitive.Root open={r.open} onOpenChange={r.setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <span className={cn("inline", className)}>
          <span
            {...r.hover}
            {...r.press}
            className="[-webkit-touch-callout:none] [@media(pointer:coarse)]:select-none"
          >
            {children}
          </span>{" "}
          <PopoverPrimitive.Trigger
            type="button"
            aria-label={label ?? "Read more"}
            {...r.trigger}
            className="-m-1 inline-grid size-6 place-items-center rounded-full align-middle text-fg-subtle transition-colors hover:text-fg data-[state=open]:text-accent"
          >
            <Info className="size-3.5" aria-hidden />
          </PopoverPrimitive.Trigger>
        </span>
      </PopoverPrimitive.Anchor>
      <RevealContent onPointerEnter={r.hover.onPointerEnter} onPointerLeave={r.hover.onPointerLeave}>
        {full}
      </RevealContent>
    </PopoverPrimitive.Root>
  );
}

/**
 * Text clamped to `lines` lines (1 or 2). Only when the clamp actually cut
 * something do hover, keyboard focus or a long press open the whole text, so
 * short values stay plain. The same element is rendered and measured in both
 * states (a ResizeObserver callback sets the state, never the effect itself).
 */
export function ClampText({
  children,
  lines = 1,
  className,
}: {
  children: React.ReactNode;
  lines?: 1 | 2;
  className?: string;
}) {
  const r = useReveal();
  const ref = React.useRef<HTMLSpanElement>(null);
  const [cut, setCut] = React.useState(false);
  // Plain text that changes in a box of the same size fires no resize, so a new text measures again.
  const textKey = typeof children === "string" ? children : null;
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() =>
      setCut(el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [textKey]);
  // min-w-0: inside a flex or grid parent, clamped text must not stretch that parent to its full width.
  const clampClass = lines === 1 ? "block min-w-0 truncate" : "min-w-0 line-clamp-2";
  return (
    <PopoverPrimitive.Root open={cut && r.open} onOpenChange={r.setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <span
          ref={ref}
          tabIndex={cut ? 0 : undefined}
          {...(cut ? { ...r.hover, ...r.press } : {})}
          onFocus={(e) => {
            if (cut && e.currentTarget.matches(":focus-visible")) r.setOpen(true);
          }}
          onBlur={() => r.setOpen(false)}
          className={cn(
            clampClass,
            cut &&
              "cursor-help rounded-[4px] [-webkit-touch-callout:none] [@media(pointer:coarse)]:select-none",
            className,
          )}
        >
          {children}
        </span>
      </PopoverPrimitive.Anchor>
      <RevealContent onPointerEnter={r.hover.onPointerEnter} onPointerLeave={r.hover.onPointerLeave}>
        {children}
      </RevealContent>
    </PopoverPrimitive.Root>
  );
}
