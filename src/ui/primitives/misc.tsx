"use client";

/**
 * Small primitives: separator, skeleton, keyboard key, progress bar, checkbox, accordion and eyebrow
 * label. Radii come from the scale (xs for keys and checkboxes, control for skeleton blocks), a
 * separator is a divider (--border-subtle), and disabled controls take the one disabled opacity.
 */
import * as React from "react";
import {
  Checkbox as CheckboxPrimitive,
  Separator as SeparatorPrimitive,
  Accordion as AccordionPrimitive,
} from "radix-ui";
import { Check, ChevronDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export function Separator({
  className,
  orientation = "horizontal",
}: {
  className?: string;
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border-subtle",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
    />
  );
}

/** Loading placeholder; the shimmer comes from the global `.skeleton` class. Hidden from assistive tech. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("skeleton rounded-control", className)} {...props} />;
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-border-strong bg-surface-2 px-1 text-2xs font-medium text-fg-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Thin determinate progress bar; `value` is a percentage, clamped to 0–100, exposed as an ARIA progressbar. */
export function Progress({ value, className, label }: { value: number; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      aria-label={label}
      className={cn("relative h-1 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-slow ease-out-quint"
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

/**
 * Radix checkbox. The minus glyph for the indeterminate state is chosen from
 * the controlled `checked` prop, so indeterminate needs controlled use.
 */
export const Checkbox = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer grid size-4 shrink-0 place-items-center rounded-xs border border-border-strong bg-surface-2 transition-colors duration-fast hover:border-border-hover focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-disabled data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="text-accent-fg">
      {props.checked === "indeterminate" ? (
        <Minus className="size-3" strokeWidth={3} aria-hidden />
      ) : (
        <Check className="size-3" strokeWidth={3} aria-hidden />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";

export const Accordion = AccordionPrimitive.Root;

export function AccordionItem({ className, ...props }: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item className={cn("border-b border-border", className)} {...props} />;
}

export function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn(
          "group flex flex-1 items-center justify-between gap-6 rounded-sm py-5 text-left text-md font-medium text-fg transition-colors duration-fast hover:text-accent-text focus-visible:focus-ring",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown
          className="size-4 shrink-0 text-fg-subtle transition-transform duration-slow ease-out-quint group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

/**
 * Animated accordion panel. `className` styles the inner padded wrapper, not
 * the animated element, whose overflow clipping the open/close animation needs.
 */
export function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      className="overflow-hidden text-sm text-fg-muted data-[state=closed]:animate-[accordion-up_180ms_var(--ease-out-quint)] data-[state=open]:animate-[accordion-down_240ms_var(--ease-out-quint)]"
      {...props}
    >
      <div className={cn("pb-5 leading-relaxed", className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}

/** Small uppercase section label used throughout panels. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("eyebrow text-fg-subtle", className)}>{children}</p>;
}
