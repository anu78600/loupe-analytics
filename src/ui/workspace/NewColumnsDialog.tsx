"use client";

/**
 * Asks before Loupe adds any column to the user's data. Loupe builds the
 * dashboard from the file's own columns; the only things that would add one
 * are unpivoting a wide layout and a few Power BI helpers (a date-only copy
 * of a datetime for the Date table, a calculated hour or weekday column for
 * one chart). Each of those goes through useColumnConsent().ask(), which
 * shows exactly which columns would be added (and replaced) and what happens
 * without them, then resolves to the user's answer.
 *
 * The "New columns" setting can be "ask" (the default) or "never". With
 * "never" no dialog opens: ask() resolves to false straight away and a toast
 * says nothing was added. There is deliberately no "always add".
 *
 * However it closes (an answer, Escape, the close button), focus goes back to
 * the control that asked, once that control can take it again: the caller's
 * button is often disabled while its work runs, and a dialog opened from
 * code has no Radix trigger to return to, so focus would otherwise fall to
 * the page. The Dialog primitive does this; the control that asked is its
 * `returnFocus`, for when focus had already left it as the dialog opened.
 *
 * What would be added and replaced stays in view; what a "no" keeps and how
 * to stop being asked are short lines with the full text behind their ⓘ, and
 * focus opens on the "no" button (`initialFocus`), ahead of them
 * (ui/primitives/reveal.tsx).
 */
import * as React from "react";
import { Columns3, Plus, Replace } from "lucide-react";
import { toast } from "sonner";
import { useSettings } from "@/store/settings";
import { Button } from "@/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/primitives/dialog";
import { Brief } from "@/ui/primitives/reveal";

/** One column that would be added. */
export interface ProposedColumn {
  name: string;
  /** What it is derived from (a column name or a short phrase). */
  source: string;
  /** Why it would be added, in plain language. */
  reason: string;
}

export interface ColumnRequest {
  title: string;
  /** What the action does and why it needs the columns. */
  intro: string;
  columns: ProposedColumn[];
  /** Existing columns the action would replace (unpivoting), if any. */
  replaces?: string[];
  /** What happens if the user says no. */
  ifNo: string;
  yesLabel: string;
  noLabel: string;
}

/**
 * ask() resolves to true (add the columns), false (don't add: build with the
 * user's columns only) or null (dialog dismissed: do nothing at all). An
 * empty `columns` list resolves to true without asking, since nothing would
 * be added. `opener` is the control that asked, where focus returns when the
 * dialog closes even if focus had already left it as the dialog opened (its
 * `returnFocus`); without it, the element that had focus when ask() was
 * called. Render `dialog` once in the calling component.
 */
export function useColumnConsent(): {
  ask: (req: ColumnRequest, opener?: HTMLElement | null) => Promise<boolean | null>;
  dialog: React.ReactNode;
} {
  const [pending, setPending] = React.useState<{
    req: ColumnRequest;
    resolve: (v: boolean | null) => void;
  } | null>(null);
  // The control that asked: where focus returns if it had already left that control as the dialog opened.
  const asker = React.useRef<HTMLElement | null>(null);

  const ask = React.useCallback(
    (req: ColumnRequest, opener?: HTMLElement | null): Promise<boolean | null> => {
      if (!req.columns.length) return Promise.resolve(true);
      // Read at call time rather than subscribing: the answer only matters when asking.
      if (useSettings.getState().newColumns === "never") {
        toast.message("No columns added", {
          description: "Settings → New columns is set to “Never add”, so Loupe used your columns only.",
        });
        return Promise.resolve(false);
      }
      const active = document.activeElement;
      asker.current = opener ?? (active instanceof HTMLElement && active !== document.body ? active : null);
      return new Promise((resolve) => setPending({ req, resolve }));
    },
    [],
  );

  const answer = (v: boolean | null) => {
    pending?.resolve(v);
    setPending(null);
  };

  const req = pending?.req;
  const noRef = React.useRef<HTMLButtonElement>(null);
  const dialog = (
    <Dialog open={Boolean(pending)} onOpenChange={(o) => (o ? undefined : answer(null))}>
      {req ? (
        // Focus starts on the "no" button, not on a note's ⓘ, which would open its popover over the dialog.
        <DialogContent className="max-w-xl" initialFocus={noRef} returnFocus={asker}>
          <DialogHeader>
            <DialogTitle>{req.title}</DialogTitle>
            <DialogDescription>{req.intro}</DialogDescription>
          </DialogHeader>
          <section aria-labelledby="new-cols-heading" className="grid gap-2">
            <h3 id="new-cols-heading" className="flex items-center gap-1.5 text-ui font-medium text-fg">
              <Plus className="size-3.5 text-accent" aria-hidden />
              {req.columns.length === 1 ? "1 new column" : `${req.columns.length} new columns`}
            </h3>
            <ul className="grid gap-1.5">
              {req.columns.map((c) => (
                <li key={c.name} className="rounded-control border border-border px-3 py-2">
                  <p className="text-ui font-medium text-fg">{c.name}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
                    From {c.source}: {c.reason}.
                  </p>
                </li>
              ))}
            </ul>
          </section>
          {req.replaces?.length ? (
            <section aria-labelledby="replaced-cols-heading" className="grid gap-2">
              <h3
                id="replaced-cols-heading"
                className="flex items-center gap-1.5 text-ui font-medium text-fg"
              >
                <Replace className="size-3.5 text-warning" aria-hidden />
                Replaces {req.replaces.length} of your columns
              </h3>
              <p className="text-xs leading-relaxed text-fg-muted">
                {req.replaces.slice(0, 12).join(", ")}
                {req.replaces.length > 12 ? ` and ${req.replaces.length - 12} more` : ""}
              </p>
            </section>
          ) : null}
          <p className="flex gap-2 rounded-control border border-border px-3 py-2 text-sm leading-relaxed text-fg-muted">
            <Columns3 className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
            <Brief label="If you say no" full={`If you say no, nothing is added. ${req.ifNo}`}>
              <span className="text-fg">If you say no, nothing is added.</span>
            </Brief>
          </p>
          <DialogFooter>
            <Button ref={noRef} variant="secondary" onClick={() => answer(false)}>
              {req.noLabel}
            </Button>
            <Button variant="primary" onClick={() => answer(true)}>
              {req.yesLabel}
            </Button>
          </DialogFooter>
          <p className="text-xs text-fg-subtle">
            <Brief
              label="How to stop being asked"
              full="To never be asked again and never add columns, choose “Never add” under Settings → New columns."
            >
              Never ask again: Settings → New columns.
            </Brief>
          </p>
        </DialogContent>
      ) : null}
    </Dialog>
  );
  return { ask, dialog };
}
