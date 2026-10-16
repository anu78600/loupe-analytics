"use client";

/**
 * Top navigation for the marketing pages (landing and version log).
 *
 * Transparent over the hero, then turns into a frosted bar with a hairline once
 * the page scrolls; a brass line along its bottom edge shows how far down the
 * page you are. A soft highlight slides between the links under the pointer,
 * and a brass underline marks the section you are reading.
 *
 * On the home page the section links scroll there themselves (smoothly, unless
 * motion is reduced) instead of leaving it to the browser, which ignores a
 * click on a link whose #section is already in the address bar. They clear
 * the pinned bar (each section's scroll margin), keep the address bar in step
 * so the link can be shared, and hand keyboard focus to the section. From
 * another page they open the home page at that section. The logo scrolls the
 * home page back to the top.
 *
 * Below the md breakpoint the links collapse into a disclosure panel. The
 * workspace (/app) has its own top bar (ui/workspace/Shell).
 */
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useScroll, useSpring } from "framer-motion";
import { ArrowRight, Menu, X } from "lucide-react";
import { Wordmark } from "@/ui/brand/logo";
import { ThemeToggle } from "@/ui/common/theme-toggle";
import { Button } from "@/ui/primitives/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#features", label: "Features" },
  { href: "/#industries", label: "Industries" },
  { href: "/#privacy", label: "Privacy" },
  { href: "/#faq", label: "FAQ" },
  { href: "/changelog", label: "Version log" },
];

/** Home-page sections in page order; one without a link ("demo") clears the underline. */
const SECTIONS = ["how", "features", "industries", "privacy", "demo", "faq"];
const LINKED = new Set(LINKS.map((l) => l.href.slice(2)));

const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A plain left click, not one meant to open the link in a new tab or window. */
const isPlainClick = (e: React.MouseEvent) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export function SiteHeader() {
  const pathname = usePathname();
  const onHome = pathname === "/";
  const [scrolled, setScrolled] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [section, setSection] = React.useState<string | null>(null);
  // While a click's smooth scroll runs, the underline stays on its target instead of passing every section.
  const heading = React.useRef<string | null>(null);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 220, damping: 32, restDelta: 0.001 });

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The section under a reading line about a third of the way down the screen.
  React.useEffect(() => {
    if (!onHome) return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        if (heading.current) return;
        const id = SECTIONS.find((s) => seen.get(s)) ?? null;
        setSection(id && LINKED.has(id) ? id : null);
      },
      { rootMargin: "-34% 0px -65% 0px" },
    );
    for (const id of SECTIONS) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [onHome]);

  // Close the mobile menu with Escape.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /** Scrolls the home page to a section (or to the top for null) and keeps the address bar in step. */
  const scrollTo = (id: string | null) => {
    const el = id ? document.getElementById(id) : null;
    heading.current = id ?? "top";
    const release = () => {
      heading.current = null;
    };
    window.addEventListener("scrollend", release, { once: true });
    window.setTimeout(release, 1400);
    setSection(id);
    setOpen(false);
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
  };

  /** On the home page, section links and the logo scroll in place; elsewhere they navigate. */
  const onLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!onHome || !isPlainClick(e)) return;
    if (href === "/") {
      e.preventDefault();
      scrollTo(null);
      return;
    }
    const id = href.startsWith("/#") ? href.slice(2) : null;
    if (!id || !document.getElementById(id)) return;
    e.preventDefault();
    scrollTo(id);
  };

  /** Which link reads as current: the section in view on the home page, the page itself elsewhere. */
  const currentOf = (href: string): "location" | "page" | undefined => {
    if (href === "/changelog") return pathname === "/changelog" ? "page" : undefined;
    return onHome && section === href.slice(2) ? "location" : undefined;
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-[background-color,border-color,backdrop-filter] duration-300",
        scrolled || open ? "glass border-border" : "border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link
          href="/"
          aria-label="Loupe home"
          className="rounded-control"
          onClick={(e) => onLinkClick(e, "/")}
        >
          <Wordmark size="sm" />
        </Link>
        <nav
          aria-label="Primary"
          className="hidden items-center gap-0.5 md:flex"
          onPointerLeave={() => setHovered(null)}
        >
          {LINKS.map((l) => {
            const current = currentOf(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={current}
                onClick={(e) => onLinkClick(e, l.href)}
                onPointerEnter={() => setHovered(l.href)}
                onFocus={() => setHovered(l.href)}
                onBlur={() => setHovered(null)}
                className={cn(
                  "relative rounded-control px-3 py-2 text-ui transition-colors hover:text-fg",
                  current ? "text-fg" : "text-fg-muted",
                )}
              >
                {hovered === l.href ? (
                  <motion.span
                    layoutId="site-nav-hover"
                    aria-hidden
                    className="absolute inset-0 -z-10 rounded-control bg-surface-2"
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                  />
                ) : null}
                {current ? (
                  <motion.span
                    layoutId="site-nav-current"
                    aria-hidden
                    className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-[image:var(--accent-gradient)]"
                    transition={{ type: "spring", stiffness: 380, damping: 34 }}
                  />
                ) : null}
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle compact />
          <Button asChild variant="primary" size="sm" className="hidden sm:inline-flex">
            <Link href="/app">
              Open workspace <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X aria-hidden /> : <Menu aria-hidden />}
          </Button>
        </div>
      </div>
      <motion.div
        aria-hidden
        style={{ scaleX: progress }}
        className="absolute inset-x-0 -bottom-px h-px origin-left bg-[image:var(--accent-gradient)]"
      />
      <AnimatePresence initial={false}>
        {open ? (
          <motion.nav
            id="site-menu"
            aria-label="Mobile"
            // It floats over the page and fades and slides rather than growing to `height: auto`:
            // Framer Motion measures an auto height by resetting the scroll position, which would
            // cancel the smooth scroll a tapped link has just started.
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            // Solid: a frosted panel inside the frosted header can't blur the page behind it.
            className="absolute inset-x-0 top-full border-y border-border bg-bg shadow-pop md:hidden"
          >
            <div className="grid gap-1 px-4 py-3">
              {LINKS.map((l) => {
                const current = currentOf(l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    aria-current={current}
                    onClick={(e) => {
                      onLinkClick(e, l.href);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex items-center justify-between rounded-control px-3 py-2.5 text-sm hover:bg-surface-2 hover:text-fg",
                      current ? "bg-surface-2 text-fg" : "text-fg-muted",
                    )}
                  >
                    {l.label}
                    {current ? <span aria-hidden className="size-1.5 rounded-full bg-accent" /> : null}
                  </Link>
                );
              })}
              <Button asChild variant="primary" size="md" className="mt-2">
                <Link href="/app" onClick={() => setOpen(false)}>
                  Open workspace <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
