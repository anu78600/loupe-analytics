/** Pill-shaped status label with semantic tones; long text truncates within the pill. */
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  // Icons passed as children sit inside the truncating text span, where Tailwind's preflight would make
  // them block-level (icon above the word); keep them inline, nudged onto the text's centre line.
  "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border font-medium leading-none [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:inline-block [&_svg]:align-[-0.125em] [&_.truncate>svg]:mr-1",
  {
    variants: {
      tone: {
        neutral: "border-border-strong bg-surface-2 text-fg-muted",
        accent: "border-border-accent bg-accent-soft text-accent",
        success: "border-transparent bg-success-soft text-success",
        warning: "border-transparent bg-warning-soft text-warning",
        danger: "border-transparent bg-danger-soft text-danger",
        info: "border-transparent bg-info-soft text-info",
        outline: "border-border-strong bg-transparent text-fg-muted",
      },
      size: {
        sm: "h-5 px-2 text-xs",
        md: "h-6 px-2.5 text-ui",
      },
    },
    defaultVariants: { tone: "neutral", size: "sm" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Leading status dot in the tone's colour (decorative). */
  dot?: boolean;
}

export function Badge({ className, tone, size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
