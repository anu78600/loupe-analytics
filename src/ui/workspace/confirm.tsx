"use client";

/**
 * Asks before an action that throws work away or changes the user's data:
 * "Start over", opening a demo over the user's own file, reading a date
 * column in an order that blanks some of its dates. askConfirm() can be
 * called from anywhere (an event handler, an effect, a store action) and
 * resolves to the answer; ConfirmHost, mounted once by the workspace, shows
 * the dialog. One question at a time: asking again while one is open answers
 * the first one "no". Focus starts on the safe choice.
 */
import * as React from "react";
import { create } from "zustand";
import { Button } from "@/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/primitives/dialog";

export interface ConfirmRequest {
  title: string;
  /** What happens if the user goes ahead, in a sentence or two. */
  body: string;
  /** A second paragraph, for what is kept or how to undo. */
  note?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" when going ahead loses work or data. */
  tone?: "default" | "danger";
}

interface ConfirmState {
  request: ConfirmRequest | null;
  resolve: ((ok: boolean) => void) | null;
}

const useConfirmStore = create<ConfirmState>()(() => ({ request: null, resolve: null }));

/** Shows the question and resolves to true when the user confirms, false otherwise. */
export function askConfirm(request: ConfirmRequest): Promise<boolean> {
  useConfirmStore.getState().resolve?.(false);
  return new Promise((resolve) => useConfirmStore.setState({ request, resolve }));
}

function answer(ok: boolean): void {
  const { resolve } = useConfirmStore.getState();
  useConfirmStore.setState({ request: null, resolve: null });
  resolve?.(ok);
}

/** The dialog for askConfirm(); render once. */
export function ConfirmHost() {
  const request = useConfirmStore((s) => s.request);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => (!open ? answer(false) : undefined)}>
      {request ? (
        <DialogContent
          className="max-w-md"
          onOpenAutoFocus={(e) => {
            // The safe choice takes the focus, so Enter never throws work away by accident.
            e.preventDefault();
            cancelRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{request.title}</DialogTitle>
            <DialogDescription>{request.body}</DialogDescription>
          </DialogHeader>
          {request.note ? <p className="text-ui text-fg-muted">{request.note}</p> : null}
          <DialogFooter>
            <Button ref={cancelRef} variant="secondary" onClick={() => answer(false)}>
              {request.cancelLabel ?? "Cancel"}
            </Button>
            <Button variant={request.tone === "danger" ? "danger" : "primary"} onClick={() => answer(true)}>
              {request.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
