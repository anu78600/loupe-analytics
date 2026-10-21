"use client";

/**
 * Underline-style tabs (Radix): the active trigger gets a brass underline
 * that overlaps the list's bottom border. Keyboard focus is always visible:
 * the focus colour drawn inside the trigger (an inset ring, so a list that
 * scrolls sideways never clips it), and the focus ring around the panel,
 * which Radix puts in the tab order so a panel without controls can still be
 * reached.
 */
import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn("inline-flex items-center gap-1 border-b border-border", className)}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative -mb-px inline-flex h-9 items-center gap-1.5 rounded-t-sm border-b-2 border-transparent px-3 text-ui font-medium text-fg-muted transition-colors duration-fast outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset data-[state=active]:border-accent data-[state=active]:text-fg [&_svg]:size-3.5",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("rounded-card outline-none focus-visible:focus-ring", className)}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
