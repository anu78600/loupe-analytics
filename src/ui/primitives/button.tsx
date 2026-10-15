/**
 * Button with design-token variants (primary = brass accent) and sizes (sm,
 * md and icon use the 10px control radius). `asChild` renders the child
 * element instead (e.g. a link) via Radix Slot; buttonVariants gives other
 * elements the same look.
 */
import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-[var(--ease-out-quint)]",
    "disabled:pointer-events-none disabled:opacity-45 active:translate-y-px",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-accent-fg shadow-[0_1px_0_0_rgb(255_255_255/0.25)_inset,0_1px_2px_rgb(0_0_0/0.3)] hover:bg-accent-strong",
        secondary:
          "border border-border-strong bg-surface-2 text-fg hover:border-border-accent hover:bg-surface-3",
        ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg",
        outline:
          "border border-border-strong bg-transparent text-fg hover:border-border-accent hover:bg-accent-soft",
        danger: "bg-danger text-white hover:opacity-90",
        link: "h-auto px-0 text-accent underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-7 rounded-[8px] px-2.5 text-2xs [&_svg]:size-3.5",
        sm: "h-8 rounded-control px-3 text-ui [&_svg]:size-4",
        md: "h-10 rounded-control px-4 text-sm [&_svg]:size-4",
        lg: "h-12 rounded-[12px] px-6 text-[15px] [&_svg]:size-[18px]",
        icon: "size-9 rounded-control [&_svg]:size-4",
        "icon-sm": "size-7 rounded-[8px] [&_svg]:size-3.5",
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
