"use client";

/**
 * Styled Radix DropdownMenu. Content aligns to the trigger's end edge by
 * default, which suits icon buttons at the right of a header.
 * Items take an optional right-aligned `hint`; radio and checkbox items show
 * a accent check.
 *
 * The menu sits on the overlay plane (--surface-overlay with the pop shadow)
 * at the card radius; its items take the control radius (12 − 4 px of
 * padding), so the corners nest. It grows out of its trigger (Radix's
 * transform origin) from 96 % over 120 ms; the highlight moving between items
 * is instant, since arrowing through a menu is the most frequent action in it.
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
        "z-50 min-w-48 overflow-hidden rounded-card border border-border bg-surface-overlay p-1 text-fg shadow-pop outline-none",
        "origin-(--radix-dropdown-menu-content-transform-origin) scale-100 transition-[opacity,scale] duration-fast ease-out-quint starting:scale-96 starting:opacity-0",
        className,
      )}
      {...props}
    />
  </MenuPrimitive.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

// Icons inside items are greyed via [&_svg]:text-fg-subtle; the check marks
// below use `!text-accent` to override that and stay in the accent.
const itemClass =
  "relative flex cursor-default select-none items-center gap-2 rounded-control px-2 py-1.5 text-ui outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-hover data-[disabled]:opacity-disabled [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-subtle";

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

/** A divider between groups: the subtle line, quieter than the menu's own edge. */
export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <MenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border-subtle", className)} />;
}
