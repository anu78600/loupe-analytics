"use client";

/**
 * Centred modal on Radix Dialog (focus trap, Escape to close, scroll lock),
 * with a close button unless `hideClose`. Content scrolls inside when taller
 * than the viewport. Always render a DialogTitle: Radix warns when a dialog
 * has no accessible title.
 *
 * Depth follows the token system: the dialog sits on the overlay plane
 * (--surface-overlay: white on light, the lightest plane in dark) with the
 * lift shadow, over the --overlay scrim, at the panel radius. It fades and
 * grows in from 96 % (CSS @starting-style, so nothing runs in JavaScript);
 * closing is instant.
 *
 * Focus has one mechanism for every dialog, sheet and the command palette
 * (useDialogFocus): it goes back to the control that opened the dialog, also
 * when the dialog was opened from state rather than a DialogTrigger. Two
 * props cover the rest: `initialFocus` says where focus starts, and
 * `returnFocus` where it goes when the opener has gone.
 */
import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

// ---------------------------------------------------------------- focus

/** The content of a Radix dialog, sheet or popover: all of them carry the role. */
const DIALOG = '[role="dialog"],[role="alertdialog"]';

/** How long after focus fell to the page the control that lost it still counts as a dialog's opener. */
const HANDOVER_MS = 1500;

/** The control focus goes back to, and the dialog it sat in when the dialog opened (null on the page). */
interface Opener {
  el: HTMLElement | null;
  host: Element | null;
}

/**
 * Each dialog's opener, keyed by the dialog's content element. When an opener leaves the page with
 * the dialog it sat in (Settings › Chart colours › Change closes Settings as Chart colours opens),
 * focus is handed on to where that dialog would have sent it, found here.
 */
const openers = new WeakMap<Element, Opener>();

/** The button of the Radix menu an element sits in (a menu is labelled by its trigger), or null. */
function menuTrigger(el: Element): HTMLElement | null {
  const id = el.closest('[role="menu"]')?.getAttribute("aria-labelledby");
  return id ? document.getElementById(id) : null;
}

/**
 * Read from the whole document, because by the time a dialog opens its opener may have gone:
 * - `menuOpener`, the menu behind the latest focus: a menu item that opens a dialog is gone by the
 *   time the dialog takes focus, so its menu's button stands in as the opener;
 * - `lastBlur`, the control that last lost focus to nothing, with the dialog it sat in and when. A
 *   dialog that closes as another opens is removed before the new one takes focus, and a button
 *   disabled while its work runs drops focus. Read while the element is still on the page
 *   (focusout fires before removal completes).
 */
let menuOpener: HTMLElement | null = null;
let lastBlur: (Opener & { at: number }) | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (e) => {
      menuOpener = e.target instanceof Element ? menuTrigger(e.target) : null;
    },
    true,
  );
  document.addEventListener(
    "focusout",
    (e) => {
      if (e.relatedTarget !== null || !(e.target instanceof HTMLElement)) return;
      const el = menuTrigger(e.target) ?? e.target;
      lastBlur = { el, host: el.closest(DIALOG), at: performance.now() };
    },
    true,
  );
}

/** The control that has focus as a dialog opens (Radix asks before it moves focus in), and its dialog. */
function openerNow(): Opener {
  const active = document.activeElement;
  let el: HTMLElement | null;
  if (active instanceof HTMLElement && active !== document.body)
    el = active.closest('[role="menu"]') ? (menuTrigger(active) ?? menuOpener) : active;
  else if (lastBlur && performance.now() - lastBlur.at < HANDOVER_MS)
    return { el: lastBlur.el, host: lastBlur.host };
  else el = menuOpener;
  return { el, host: el?.closest(DIALOG) ?? null };
}

/**
 * Where focus goes back to: the opener, or, when it left the page with the dialog it sat in, where
 * that dialog would have sent focus, and so on.
 */
function stillThere(start: Opener | null): Opener | null {
  let o = start;
  for (let i = 0; o && i < 8; i++) {
    if (o.el?.isConnected) return o;
    o = o.host ? (openers.get(o.host) ?? null) : null;
  }
  return null;
}

/**
 * Focuses `el` as soon as it can take focus (a button disabled while its work runs is enabled again
 * when the work ends), checking each frame for up to about 20 seconds. It gives up early when the
 * element leaves the page or the user has put focus somewhere else meanwhile.
 */
function focusWhenReady(el: HTMLElement, options?: FocusOptions, frames = 1200): void {
  if (!el.isConnected) return;
  const active = document.activeElement;
  if (active && active !== document.body && active !== el) return;
  if (!el.matches(":disabled")) {
    el.focus(options);
    return;
  }
  if (frames > 0) requestAnimationFrame(() => focusWhenReady(el, options, frames - 1));
}

/** Where focus starts when a dialog opens: see DialogFocusProps. */
export type InitialFocus =
  | "content"
  | React.RefObject<HTMLElement | null>
  | ((content: HTMLElement) => HTMLElement | null | undefined);

/** The focus props of DialogContent and SheetContent. */
export interface DialogFocusProps {
  /**
   * Where keyboard focus starts. Without it, Radix's default: the first control.
   * - A ref: that control, such as the safe answer of a question, so Enter never throws work away.
   * - `"content"`: the dialog itself, read from the top; Tab goes on to its first control. For a
   *   dialog whose first control is an ⓘ, which opens on keyboard focus (ui/primitives/reveal.tsx)
   *   and would pop its explanation over the dialog.
   * - A function, given the dialog's element: the control it returns, or the dialog itself for null.
   *   For a choice made as it opens (a text field with a mouse, the dialog itself on touch, where the
   *   field would raise the keyboard).
   */
  initialFocus?: InitialFocus;
  /**
   * Where focus goes on close when the control that opened the dialog can't take it back: that
   * control has left the page (a KPI's button deleted with the KPI), along with any dialog it sat in.
   * It is also the hand-over target of a dialog opened from code once focus had moved on (a question
   * asked when a button's work ends, the button disabled meanwhile). Focus waits while it is
   * disabled. Without it, focus falls to the page.
   */
  returnFocus?: React.RefObject<HTMLElement | null>;
}

/**
 * The one focus mechanism behind DialogContent and SheetContent; spread its two handlers on a Radix
 * Dialog.Content that draws its own content (the command palette).
 *
 * Radix gives focus back only to its own Trigger, so a dialog opened from state (a card, a menu
 * item, a shortcut, code) left focus on <body> when it closed, and keyboard users had to start again
 * from the top of the page. Here the opener is read the moment Radix moves focus in, and on close
 * focus goes back to the first of these that is still on the page:
 * 1. the opener: the control that had focus (for a menu item, its menu's button; for focus that fell
 *    to the page a moment before, the control that lost it);
 * 2. when the opener left with the dialog it sat in, where that dialog would have returned focus,
 *    and so on (Settings › Change › Chart colours closes back to Settings' own opener);
 * 3. `returnFocus`.
 * A disabled control is waited for, unless the user has put focus elsewhere meanwhile; one disabled
 * inside a dialog that is still open (Settings › Clear all, once confirmed) hands focus to that
 * dialog instead, so it stays inside. A caller's own `onOpenAutoFocus` and `onCloseAutoFocus` run
 * first, and one that prevents the default keeps control.
 */
export function useDialogFocus({
  initialFocus,
  returnFocus,
  onOpenAutoFocus,
  onCloseAutoFocus,
}: DialogFocusProps & {
  onOpenAutoFocus?: (e: Event) => void;
  onCloseAutoFocus?: (e: Event) => void;
} = {}): { onOpenAutoFocus: (e: Event) => void; onCloseAutoFocus: (e: Event) => void } {
  const opener = React.useRef<Opener | null>(null);
  return {
    onOpenAutoFocus: (e) => {
      const from = openerNow();
      opener.current = from;
      const content = e.currentTarget;
      if (content instanceof Element) openers.set(content, from);
      onOpenAutoFocus?.(e);
      if (!initialFocus || e.defaultPrevented || !(content instanceof HTMLElement)) return;
      e.preventDefault();
      const to =
        initialFocus === "content"
          ? null
          : typeof initialFocus === "function"
            ? initialFocus(content)
            : initialFocus.current;
      (to ?? content).focus();
    },
    onCloseAutoFocus: (e) => {
      onCloseAutoFocus?.(e);
      const to = stillThere(opener.current);
      opener.current = null;
      if (e.defaultPrevented) return;
      if (to?.el) {
        // Radix would focus a Trigger, which a dialog opened from state doesn't have.
        e.preventDefault();
        const host = to.host instanceof HTMLElement && to.host.isConnected ? to.host : null;
        // The opener was in view when it opened the dialog, and the page can't scroll under a modal,
        // so it is still in view: no scrolling, the page stays where the user left it.
        if (host && to.el.matches(":disabled") && document.activeElement === document.body)
          host.focus({ preventScroll: true });
        else focusWhenReady(to.el, { preventScroll: true });
        return;
      }
      const fallback = returnFocus?.current;
      // Otherwise Radix's own: its Trigger, if it has one.
      if (!fallback?.isConnected) return;
      e.preventDefault();
      // Somewhere else on the page, which may need scrolling into view.
      focusWhenReady(fallback);
    },
  };
}

// ---------------------------------------------------------------- parts

/** The scrim: fades in over the slow duration (240 ms). */
export function DialogOverlay({ className }: { className?: string }) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] transition-opacity duration-slow ease-out-quint starting:opacity-0",
        className,
      )}
    />
  );
}

/** The dialog's panel; `initialFocus` and `returnFocus` are documented on DialogFocusProps. */
export const DialogContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & DialogFocusProps & { hideClose?: boolean }
>(
  (
    {
      className,
      children,
      hideClose,
      initialFocus,
      returnFocus,
      onOpenAutoFocus,
      onCloseAutoFocus,
      ...props
    },
    ref,
  ) => {
    const focus = useDialogFocus({ initialFocus, returnFocus, onOpenAutoFocus, onCloseAutoFocus });
    return (
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={ref}
          onOpenAutoFocus={focus.onOpenAutoFocus}
          onCloseAutoFocus={focus.onCloseAutoFocus}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-panel border border-border bg-surface-overlay p-6 text-fg shadow-lift outline-none",
            "scale-100 transition-[opacity,scale] duration-slow ease-out-quint starting:scale-96 starting:opacity-0",
            className,
          )}
          {...props}
        >
          {children}
          {hideClose ? null : (
            <DialogPrimitive.Close
              className="absolute top-4 right-4 rounded-control p-1.5 text-fg-subtle transition-colors duration-fast hover:bg-surface-hover hover:text-fg focus-visible:focus-ring active:bg-surface-active"
              aria-label="Close"
            >
              <X className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);
DialogContent.displayName = "DialogContent";

/** Right padding keeps long titles clear of the close button. */
export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 pr-8", className)} {...props} />;
}

/** Buttons stack in reverse on narrow screens (the last, usually primary, on top) and sit right-aligned in a row from `sm` up. */
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
  );
}

export const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold text-fg", className)} {...props} />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-fg-muted", className)} {...props} />
));
DialogDescription.displayName = "DialogDescription";
