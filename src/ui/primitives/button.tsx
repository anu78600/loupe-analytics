/**
 * Button with design-token variants and sizes. Primary is the accent gradient
 * with a soft glow and a sheen that sweeps across on hover or keyboard focus
 * (the `sheen` utility in globals.css). `asChild` renders the child element
 * instead (e.g. a link) via Radix Slot; buttonVariants gives other elements
 * the same look.
 *
 * States follow the token system (docs/DESIGN.md): hover and press are state
 * layers (--surface-hover, --surface-active) laid over the fill rather than
 * swapped for another surface, so they read the same on any plane in either
 * theme; borders step up to --border-hover; keyboard focus is the focus-ring
 * utility (a 2px ring with a 2px gap); disabled is the one disabled opacity.
 * Radii come from the scale: sm (6px) for the small sizes, control (8px) for
 * the standard ones, card (12px) for the large call to action.
 */
import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The hover and pressed state layers drawn over a filled button's own colour (a translucent
 * gradient image sits above background-color), so a filled button lightens on dark and
 * darkens on light by the same step whatever surface it sits on.
 */
const STATE_LAYERS =
  "hover:[background-image:linear-gradient(var(--surface-hover),var(--surface-hover))] active:[background-image:linear-gradient(var(--surface-active),var(--surface-active))]";

const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium",
    "transition-[background-color,border-color,color,box-shadow,transform,filter] duration-fast ease-out-quint",
    "focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-disabled active:translate-y-px",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        // The accent gradient: a lit top edge (--sheen), a tight shadow and a glow in the accent.
        // Hover brightens it on dark (dark ink on periwinkle) and deepens it on light (white on
        // indigo), so the label always gains contrast.
        primary:
          "sheen bg-accent bg-[image:var(--accent-gradient)] text-accent-fg shadow-[inset_0_1px_0_0_var(--sheen),0_1px_2px_-1px_var(--glow-accent),0_8px_22px_-10px_var(--glow-accent)] hover:brightness-95 hover:shadow-[inset_0_1px_0_0_var(--sheen),0_0_0_1px_var(--border-accent),0_12px_32px_-10px_var(--glow-accent)] dark:hover:brightness-105",
        // A raised key (--surface-raised-control): white on light; on dark a translucent white
        // step, so it stands lighter than whatever it sits on (the canvas, a card, or a sheet on the
        // overlay plane, where a solid fill would look sunken).
        secondary: `border border-border-strong bg-surface-raised-control text-fg hover:border-border-hover ${STATE_LAYERS}`,
        ghost: "text-fg-muted hover:bg-surface-hover hover:text-fg active:bg-surface-active",
        outline:
          "border border-border-strong bg-transparent text-fg hover:border-border-hover hover:bg-surface-hover active:bg-surface-active",
        // Ink that reads on the danger fill in both themes: dark ink on dark's lighter red,
        // light ink on light's deeper red.
        danger: `bg-danger text-fg-inverse ${STATE_LAYERS}`,
        link: "h-auto px-0 text-accent-text underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-7 rounded-sm px-2.5 text-xs [&_svg]:size-3.5",
        sm: "h-8 rounded-control px-3 text-ui [&_svg]:size-4",
        md: "h-10 rounded-control px-4 text-sm [&_svg]:size-4",
        lg: "h-12 rounded-card px-6 text-md [&_svg]:size-[18px]",
        icon: "size-9 rounded-control [&_svg]:size-4",
        "icon-sm": "size-7 rounded-sm [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    // Default to type="button" so a button inside a form never submits by
    // accident; with asChild the child is not a <button>, so no type at all.
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? "button")}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
