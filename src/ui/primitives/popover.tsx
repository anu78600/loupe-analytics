"use client";

/**
 * Styled Radix Popover: a portalled, collision-aware panel on the overlay
 * plane (--surface-overlay, pop shadow) at the card radius; 288px wide unless
 * overridden. It grows out of its trigger from 96 % over 120 ms.
 */
import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const PopoverContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={12}
      className={cn(
        "z-50 w-72 rounded-card border border-border bg-surface-overlay p-4 text-fg shadow-pop outline-none",
        "origin-(--radix-popover-content-transform-origin) scale-100 transition-[opacity,scale] duration-fast ease-out-quint starting:scale-96 starting:opacity-0",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = "PopoverContent";
