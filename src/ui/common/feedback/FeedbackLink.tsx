"use client";

/**
 * A "Send feedback" link for the marketing pages (version 51.0): it opens
 * the feedback dialog with the page it was opened from as its only detail
 * (the workspace adds more: ui/workspace/feedbackPlace.ts). A button, since
 * it opens a dialog rather than going anywhere; styled by its caller, so it
 * sits in a footer column like the links around it.
 */
import { usePathname } from "next/navigation";
import { openFeedback } from "./store";

/** The page's name as its navigation calls it. */
function pageName(pathname: string): string {
  if (pathname === "/") return "Home";
  if (pathname.startsWith("/glossary")) return "Glossary";
  if (pathname.startsWith("/changelog")) return "What's new";
  return pathname;
}

export function FeedbackLink({ className, children }: { className?: string; children?: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <button
      type="button"
      className={className}
      onClick={() => openFeedback({ place: [`Page: ${pageName(pathname)}`] })}
    >
      {children ?? "Send feedback"}
    </button>
  );
}
