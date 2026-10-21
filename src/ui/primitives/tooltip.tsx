"use client";

/**
 * One-component tooltip over Radix Tooltip. Needs a TooltipProvider ancestor
 * (mounted once in ui/common/providers, which also sets the default delays).
 * It sits on the overlay plane (--surface-overlay, pop shadow) at the control
 * radius. Only the first tooltip of a run fades in (Radix's "delayed-open");
 * moving on to a neighbour's shows it at once, with no delay and no motion.
 */
import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;

/**
 * Wraps `children` (a single element that accepts a ref, used as the
 * trigger) and shows `content` in a portal. `delay` overrides the provider's
 * open delay. Layered above dialogs and popovers (z-60).
 */
export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  className,
  delay,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  delay?: number;
}) {
  return (
    <TooltipPrimitive.Root delayDuration={delay}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            "z-[60] max-w-72 rounded-control border border-border bg-surface-overlay px-2.5 py-1.5 text-xs text-fg shadow-pop",
            "transition-opacity duration-fast ease-out-quint data-[state=delayed-open]:starting:opacity-0",
            className,
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
