"use client";

/**
 * Styled Radix Select. The list opens as a popper below the trigger (not
 * over it, Radix's default), at least as wide as the trigger and at most
 * 360px tall.
 */
import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & { size?: "sm" | "md" }
>(({ className, children, size = "md", ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex w-full items-center justify-between gap-2 rounded-control border border-border-strong bg-surface-2 px-3 text-left text-fg transition-[border-color,box-shadow] outline-none hover:border-border-accent focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] disabled:opacity-50 data-[placeholder]:text-fg-subtle [&>span]:truncate",
      size === "sm" ? "h-8 text-ui" : "h-9 text-sm",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

export const SelectContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      sideOffset={6}
      className={cn(
        "relative z-50 max-h-[min(var(--radix-select-content-available-height),360px)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[12px] border border-border-strong bg-surface-2 shadow-pop",
        "data-[state=open]:animate-[fade-up_160ms_var(--ease-out-quint)]",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport className="max-h-[inherit] overflow-y-auto p-1">
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = "SelectContent";

export const SelectLabel = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 pt-2 pb-1 text-2xs font-medium tracking-[0.08em] text-fg-subtle uppercase",
      className,
    )}
    {...props}
  />
));
SelectLabel.displayName = "SelectLabel";

/**
 * Option with a check mark when selected. `hint` is right-aligned secondary
 * text; it sits outside ItemText, so the trigger shows only `children`.
 */
export const SelectItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & { hint?: React.ReactNode }
>(({ className, children, hint, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default items-center gap-2 rounded-[8px] py-1.5 pr-2 pl-7 text-ui text-fg outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-surface-3",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex size-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="size-3.5 text-accent" aria-hidden />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    {hint ? <span className="ml-auto pl-3 text-2xs text-fg-subtle">{hint}</span> : null}
  </SelectPrimitive.Item>
));
SelectItem.displayName = "SelectItem";

export const SelectSeparator = ({ className }: { className?: string }) => (
  <SelectPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} />
);
