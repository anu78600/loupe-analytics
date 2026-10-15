"use client";

/**
 * Side or bottom panel built on Radix Dialog (same focus trap and Escape
 * handling). The header with title and close button is built in; the body
 * scrolls on its own.
 */
import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

const sideClass = {
  right:
    "inset-y-0 right-0 h-full w-full max-w-[min(560px,100vw)] border-l data-[state=open]:animate-[sheet-in-right_320ms_var(--ease-out-quint)]",
  left: "inset-y-0 left-0 h-full w-full max-w-[min(420px,100vw)] border-r data-[state=open]:animate-[sheet-in-left_320ms_var(--ease-out-quint)]",
  bottom:
    "inset-x-0 bottom-0 max-h-[88dvh] w-full rounded-t-panel border-t data-[state=open]:animate-[sheet-in-bottom_320ms_var(--ease-out-quint)]",
} as const;

/**
 * `title` is required because Radix Dialog needs an accessible title. Without
 * a `description`, the title is repeated as a visually hidden one, which
 * keeps Radix's missing-description warning quiet.
 */
export const SheetContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> & {
    side?: keyof typeof sideClass;
    title: string;
    description?: React.ReactNode;
  }
>(({ className, children, side = "right", title, description, ...props }, ref) => (
  <SheetPrimitive.Portal>
    <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-[fade-up_200ms_var(--ease-out-quint)]" />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 flex flex-col border-border-strong bg-surface-1 shadow-lift outline-none",
        sideClass[side],
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div className="min-w-0">
          <SheetPrimitive.Title className="text-base font-medium tracking-[-0.01em] text-fg">
            {title}
          </SheetPrimitive.Title>
          {description ? (
            <SheetPrimitive.Description className="mt-1 text-ui text-fg-muted">
              {description}
            </SheetPrimitive.Description>
          ) : (
            <SheetPrimitive.Description className="sr-only">{title}</SheetPrimitive.Description>
          )}
        </div>
        <SheetPrimitive.Close
          className="-mr-1.5 rounded-[8px] p-1.5 text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg"
          aria-label="Close panel"
        >
          <X className="size-4" aria-hidden />
        </SheetPrimitive.Close>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </SheetPrimitive.Content>
  </SheetPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";
