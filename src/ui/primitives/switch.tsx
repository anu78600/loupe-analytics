"use client";

/**
 * On/off switch (Radix); turns accent when checked. Has the `peer` class so a sibling label can react
 * to its state. Its edge steps up to --border-hover under the pointer, keyboard focus draws the
 * focus ring, the thumb slides over the fast duration (120 ms), and a disabled switch takes the one
 * disabled opacity.
 */
import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export const Switch = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border-strong bg-surface-3 p-0.5 transition-colors duration-fast hover:border-border-hover focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-disabled data-[state=checked]:border-transparent data-[state=checked]:bg-accent",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block size-3.5 rounded-full bg-fg shadow-sm transition-transform duration-fast ease-out-quint data-[state=checked]:translate-x-4 data-[state=checked]:bg-accent-fg" />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
