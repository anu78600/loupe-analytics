"use client";

/** Segmented control on Radix ToggleGroup (arrow-key navigation) with a Framer Motion indicator that slides between options. */
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

/**
 * Single-select segmented control with a sliding indicator.
 * Always has a value: clicking the active option again does nothing.
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
  // Radix reports "" when the active item is clicked again (deselect); ignore it.
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      aria-label={ariaLabel}
      onValueChange={(v) => {
        if (v) onChange(v as T);
      }}
      className={cn(
        "relative inline-flex items-center gap-0.5 rounded-control border border-border bg-surface-2 p-0.5",
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
              "relative inline-flex items-center justify-center gap-1.5 rounded-[8px] font-medium transition-colors [&_svg]:size-3.5",
              size === "sm" ? "h-6 px-2 text-2xs" : "h-7 px-2.5 text-ui",
              active ? "text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-[8px] border border-border-strong bg-surface-1 shadow-card"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
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
