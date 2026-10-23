"use client";

/**
 * Segmented control on Radix ToggleGroup (arrow-key navigation) with a Framer Motion indicator that slides between options.
 *
 * The track is a well (--surface-inset) and the chosen option a raised key on it
 * (--surface-raised-control, with the card shadow). Both tokens are set per theme: on light a
 * darker ink tint with the key in the cards' white; on dark, where depth is lightness, a black
 * step into whatever plane holds the control and a white step out of it, with the card shadow's lit
 * top edge. So the key stands up from its track on the canvas, on a card and inside a sheet alike,
 * with no theme-specific classes. Options sit at the small radius inside the track's control
 * radius (8 − 2 px of padding), so the corners nest.
 */
import * as React from "react";
import { ToggleGroup } from "radix-ui";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Native tooltip; also the accessible name when `label` is not a string (icon-only options). */
  title?: string;
}

const SLIDE = { type: "spring", stiffness: 500, damping: 38 } as const;
const INSTANT = { duration: 0 } as const;

/**
 * Single-select segmented control with a sliding indicator.
 * Always has a value: clicking the active option again does nothing. A choice made from the
 * keyboard moves the indicator at once (keyboard actions aren't animated); a click slides it.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: "sm" | "md";
  className?: string;
  ariaLabel: string;
}) {
  // Per-instance layoutId, so indicators never animate across separate controls.
  const id = React.useId();
  // How the last choice was made: from the keyboard, the indicator jumps rather than slides.
  const [keyboard, setKeyboard] = React.useState(false);
  // Radix reports "" when the active item is clicked again (deselect); ignore it.
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      aria-label={ariaLabel}
      onValueChange={(v) => {
        if (v) onChange(v as T);
      }}
      onKeyDown={() => setKeyboard(true)}
      onPointerDown={() => setKeyboard(false)}
      className={cn(
        "relative inline-flex items-center gap-0.5 rounded-control border border-border bg-surface-inset p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <ToggleGroup.Item
            key={opt.value}
            value={opt.value}
            title={opt.title}
            aria-label={typeof opt.label === "string" ? opt.label : opt.title}
            className={cn(
              "relative inline-flex items-center justify-center gap-1.5 rounded-sm font-medium transition-colors duration-fast focus-visible:focus-ring [&_svg]:size-3.5",
              size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-ui",
              active ? "text-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-sm border border-border-strong bg-surface-raised-control shadow-card"
                transition={keyboard ? INSTANT : SLIDE}
              />
            ) : null}
            <span className="relative inline-flex items-center gap-1.5">
              {opt.icon}
              {opt.label}
            </span>
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}
