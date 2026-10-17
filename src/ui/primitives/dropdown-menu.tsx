"use client";

/**
 * Styled Radix DropdownMenu. Content aligns to the trigger's end edge by
 * default, which suits icon buttons at the right of a header.
 * Items take an optional right-aligned `hint`; radio and checkbox items show
 * a brass check.
 */
import * as React from "react";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

export const DropdownMenuContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.Content>
>(({ className, sideOffset = 6, align = "end", ...props }, ref) => (
  <MenuPrimitive.Portal>
    <MenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      collisionPadding={12}
      className={cn(
        "z-50 min-w-48 overflow-hidden rounded-[12px] border border-border-strong bg-surface-2 p-1 text-fg shadow-pop",
        "data-[state=open]:animate-[fade-up_160ms_var(--ease-out-quint)]",
        className,
      )}
      {...props}
    />
  </MenuPrimitive.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

// Icons inside items are greyed via [&_svg]:text-fg-subtle; the check marks
// below use `!text-accent` to override that and stay brass.
const itemClass =
  "relative flex cursor-default select-none items-center gap-2 rounded-[8px] px-2 py-1.5 text-ui outline-none transition-colors data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-3 data-[disabled]:opacity-45 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-subtle";

export const DropdownMenuItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.Item> & { hint?: React.ReactNode }
>(({ className, children, hint, ...props }, ref) => (
  <MenuPrimitive.Item ref={ref} className={cn(itemClass, className)} {...props}>
    {children}
    {hint ? <span className="ml-auto pl-4 text-2xs text-fg-subtle">{hint}</span> : null}
  </MenuPrimitive.Item>
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuRadioItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <MenuPrimitive.RadioItem ref={ref} className={cn(itemClass, "pl-7", className)} {...props}>
    <span className="absolute left-2 flex size-3.5 items-center justify-center">
      <MenuPrimitive.ItemIndicator>
        <Check className="!text-accent" aria-hidden />
      </MenuPrimitive.ItemIndicator>
    </span>
    {children}
  </MenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";

export const DropdownMenuCheckboxItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <MenuPrimitive.CheckboxItem ref={ref} className={cn(itemClass, "pl-7", className)} {...props}>
    <span className="absolute left-2 flex size-3.5 items-center justify-center">
      <MenuPrimitive.ItemIndicator>
        <Check className="!text-accent" aria-hidden />
      </MenuPrimitive.ItemIndicator>
    </span>
    {children}
  </MenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label className={cn("eyebrow px-2 pt-2 pb-1 text-fg-subtle", className)} {...props} />
  );
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <MenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} />;
}
