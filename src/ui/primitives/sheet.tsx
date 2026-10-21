"use client";

/**
 * Side or bottom panel built on Radix Dialog (same focus trap and Escape
 * handling). The header with title and close button is built in; the body
 * scrolls on its own.
 *
 * Like a dialog it sits on the overlay plane (--surface-overlay) with the lift
 * shadow, over the --overlay scrim, and slides in over the slow duration
 * (240 ms); a bottom sheet takes the panel radius on its top corners. Focus
 * works as a dialog's (useDialogFocus in dialog.tsx): it goes back to the
 * control that opened the sheet, also when it was opened from state, and
 * `initialFocus` and `returnFocus` (DialogFocusProps) say where it starts and
 * where it goes when that control has gone.
 */
import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDialogFocus, type DialogFocusProps } from "./dialog";

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

const sideClass = {
  right:
    "inset-y-0 right-0 h-full w-full max-w-[min(560px,100vw)] border-l data-[state=open]:animate-[sheet-in-right_240ms_var(--ease-out-quint)]",
  left: "inset-y-0 left-0 h-full w-full max-w-[min(420px,100vw)] border-r data-[state=open]:animate-[sheet-in-left_240ms_var(--ease-out-quint)]",
  bottom:
    "inset-x-0 bottom-0 max-h-[88dvh] w-full rounded-t-panel border-t data-[state=open]:animate-[sheet-in-bottom_240ms_var(--ease-out-quint)]",
} as const;

/**
 * `title` is required because Radix Dialog needs an accessible title. Without
 * a `description`, the title is repeated as a visually hidden one, which
 * keeps Radix's missing-description warning quiet. `initialFocus` and
 * `returnFocus` work as on DialogContent (DialogFocusProps in dialog.tsx).
 */
export const SheetContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> &
    DialogFocusProps & {
      side?: keyof typeof sideClass;
      title: string;
      description?: React.ReactNode;
    }
>(
  (
    {
      className,
      children,
      side = "right",
      title,
      description,
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
      <SheetPrimitive.Portal>
        <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay transition-opacity duration-slow ease-out-quint starting:opacity-0" />
        <SheetPrimitive.Content
          ref={ref}
          onOpenAutoFocus={focus.onOpenAutoFocus}
          onCloseAutoFocus={focus.onCloseAutoFocus}
          className={cn(
            "fixed z-50 flex flex-col border-border bg-surface-overlay text-fg shadow-lift outline-none",
            sideClass[side],
            className,
          )}
          {...props}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
            <div className="min-w-0">
              <SheetPrimitive.Title className="text-base font-semibold text-fg">{title}</SheetPrimitive.Title>
              {description ? (
                <SheetPrimitive.Description className="mt-1 text-ui text-fg-muted">
                  {description}
                </SheetPrimitive.Description>
              ) : (
                <SheetPrimitive.Description className="sr-only">{title}</SheetPrimitive.Description>
              )}
            </div>
            <SheetPrimitive.Close
              className="-mr-1.5 rounded-control p-1.5 text-fg-subtle transition-colors duration-fast hover:bg-surface-hover hover:text-fg focus-visible:focus-ring active:bg-surface-active"
              aria-label="Close panel"
            >
              <X className="size-4" aria-hidden />
            </SheetPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </SheetPrimitive.Content>
      </SheetPrimitive.Portal>
    );
  },
);
SheetContent.displayName = "SheetContent";
