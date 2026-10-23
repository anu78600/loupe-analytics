"use client";

/**
 * The guided flow's next step (version 50.2): a small floating dock that
 * stays at the bottom of the screen while a step's page scrolls, with where
 * things stand on the left ("E-commerce · 99% match", "26 of 28 columns
 * used") and the way on at the right: the main action, and a second, quieter
 * one (skip ahead, or the optional step).
 *
 * It is sticky, not fixed, and the last thing on its page: at the end of the
 * page it rests in the flow under the content instead of covering it, and it
 * never needs to know how wide the sidebar is. On phones and tablets it
 * floats above the bottom bar of phases; there the status line gives way to
 * the buttons.
 */
import * as React from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/primitives/button";

export interface FlowAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function FlowDock({
  status,
  secondary,
  primary,
  busy = false,
  className,
}: {
  /** Where things stand, in a few words (hidden on phones). */
  status?: React.ReactNode;
  /** The quieter way on: skip ahead, or the optional step. */
  secondary?: FlowAction;
  /** The main way on. */
  primary: FlowAction;
  /** Shows a spinner while the analysis is being rebuilt. */
  busy?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "no-print sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 mt-10 lg:bottom-5",
        className,
      )}
    >
      <div
        role="region"
        aria-label="Next step"
        className="mx-auto flex max-w-3xl items-center gap-2 rounded-panel border border-border bg-surface-overlay/90 p-2 shadow-lift backdrop-blur-xl sm:gap-3 sm:pl-4"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 text-ui text-fg-muted max-sm:hidden">
          {busy ? (
            <Loader2 aria-label="Updating" className="size-4 shrink-0 animate-spin text-fg-subtle" />
          ) : null}
          <div className="min-w-0 truncate">{status}</div>
        </div>
        {secondary ? (
          <Button
            variant="ghost"
            onClick={secondary.onClick}
            disabled={secondary.disabled}
            className="max-sm:flex-1 max-sm:px-2"
          >
            {secondary.label}
          </Button>
        ) : null}
        <Button
          variant="primary"
          onClick={primary.onClick}
          disabled={primary.disabled}
          className="max-sm:flex-1"
        >
          {primary.label}
          <ArrowRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}
