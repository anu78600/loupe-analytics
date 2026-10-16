"use client";

/**
 * Links to a section of the home page ("/#how", "#privacy"), and "/" for its
 * top, used by the site header, the footer and the hero.
 *
 * On the home page they scroll there themselves (smoothly, unless motion is
 * reduced) instead of leaving it to the browser and Next's Link: both ignore a
 * click on a link whose #section is already in the address bar, and the next
 * click after such a no-op could be swallowed. The scroll clears the pinned
 * header (each section's scroll margin), keeps the address bar in step so the
 * link can be shared, and hands keyboard focus to the section. From another
 * page they are ordinary links that open the home page at that section.
 *
 * The site header listens (onSectionScroll), so its "you are here" underline
 * goes straight to the target instead of passing every section on the way.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Listener = (id: string | null) => void;
const listeners = new Set<Listener>();

/** Calls `listener` with the target (null for the top) whenever a section link starts a scroll. */
export function onSectionScroll(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The home-page section a link points at: "how" for "/#how" or "#how", null for "/", undefined otherwise. */
export function sectionOf(href: string): string | null | undefined {
  if (href === "/") return null;
  return /^\/?#([\w-]+)$/.exec(href)?.[1];
}

/** A plain left click, not one meant to open the link in a new tab or window. */
const isPlainClick = (e: React.MouseEvent) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Scrolls the home page to a section (or to the top for null) and keeps the address bar in step. */
export function scrollToSection(id: string | null): void {
  const el = id ? document.getElementById(id) : null;
  for (const listener of listeners) listener(id);
  const behavior: ScrollBehavior = calm() ? "auto" : "smooth";
  if (el && id) {
    el.scrollIntoView({ behavior, block: "start" });
    if (window.location.hash !== `#${id}`) window.history.pushState(null, "", `#${id}`);
    // Keyboard and screen-reader users carry on from the section they asked for.
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
  } else {
    window.scrollTo({ top: 0, behavior });
    if (window.location.hash) window.history.replaceState(null, "", "/");
  }
}

/** A Next Link that scrolls in place on the home page when it points at one of its sections. */
export function SectionLink({
  href,
  onClick,
  ...rest
}: Omit<React.ComponentProps<typeof Link>, "href"> & { href: string }) {
  const onHome = usePathname() === "/";
  return (
    <Link
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || !onHome || !isPlainClick(e)) return;
        const id = sectionOf(href);
        if (id === undefined || (id !== null && !document.getElementById(id))) return;
        e.preventDefault();
        scrollToSection(id);
      }}
      {...rest}
    />
  );
}
