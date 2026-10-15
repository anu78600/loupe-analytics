"use client";

/**
 * One-component tooltip over Radix Tooltip. Needs a TooltipProvider ancestor
 * (mounted once in ui/common/providers, which also sets the default delays).
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
            "z-[60] max-w-72 rounded-[8px] border border-border-strong bg-surface-2 px-2.5 py-1.5 text-2xs leading-relaxed text-fg shadow-pop",
            "data-[state=delayed-open]:animate-[fade-up_140ms_var(--ease-out-quint)]",
            className,
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
