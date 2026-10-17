"use client";

/**
 * The industries' scrolling rows with a Pause button under them (WCAG 2.2.2:
 * anything that moves for more than five seconds can be paused). The rows
 * already hold still under the pointer and while a pill has keyboard focus;
 * the button is for touch screens and for anyone who wants them to stop.
 * Pausing marks the rows data-paused, which globals.css holds still. Under
 * reduced motion the rows don't move (they wrap instead), so the button is
 * hidden.
 *
 * The rows themselves are server-rendered and passed in as children.
 */
import * as React from "react";
import { Pause, Play } from "lucide-react";

export function MarqueeGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  const [paused, setPaused] = React.useState(false);
  return (
    <div className={className}>
      <div data-paused={paused ? "" : undefined} className="grid gap-3">
        {children}
      </div>
      <div className="mt-5 flex justify-center motion-reduce:hidden">
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? "Play the scrolling industries" : "Pause the scrolling industries"}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2/80 px-2.5 py-1 text-xs text-fg-muted transition-colors hover:text-fg"
        >
          {paused ? <Play className="size-3" aria-hidden /> : <Pause className="size-3" aria-hidden />}
          {paused ? "Play" : "Pause"}
        </button>
      </div>
    </div>
  );
}
