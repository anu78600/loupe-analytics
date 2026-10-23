"use client";

/**
 * Whether the feedback dialog is open, and what its opener knows (version
 * 51.0). Any part of the app opens it: the workspace sidebar, the phone's
 * "More" menu, the command palette, an error toast's "Report", the site
 * footer. The opener passes what it alone knows, such as the step and the
 * shape of the data, or the error a toast showed; the dialog adds the
 * version and the device (lib/feedback.ts).
 *
 * A store of its own with no other imports, so the marketing pages can open
 * the dialog without loading the workspace.
 */
import { create } from "zustand";
import type { FeedbackKind } from "@/lib/feedback";

export interface FeedbackRequest {
  /** Which kind the dialog opens on; a problem when not given. */
  kind?: FeedbackKind;
  /** A topic to start from ("Something looks broken" for a reported error). */
  topic?: string;
  /** Lines about where the user was and their data, from the opener. */
  place?: string[];
}

interface FeedbackState {
  open: boolean;
  request: FeedbackRequest;
  /** Counts the openings, so each one starts a fresh form (the dialog keys its form on it). */
  nonce: number;
  openFeedback: (request?: FeedbackRequest) => void;
  setOpen: (open: boolean) => void;
}

export const useFeedback = create<FeedbackState>()((set) => ({
  open: false,
  request: {},
  nonce: 0,
  openFeedback: (request = {}) => set((s) => ({ open: true, request, nonce: s.nonce + 1 })),
  setOpen: (open) => set({ open }),
}));

/** Opens the dialog from outside React (a toast's action). */
export function openFeedback(request?: FeedbackRequest): void {
  useFeedback.getState().openFeedback(request);
}
