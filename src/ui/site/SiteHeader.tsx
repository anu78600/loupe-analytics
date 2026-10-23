"use client";

/**
 * Top navigation for the marketing pages (landing, glossary and version log).
 *
 * Transparent over the hero, then turns into a frosted bar with a hairline once
 * the page scrolls; a accent line along its bottom edge shows how far down the
 * page you are. A soft highlight (the hover state layer) slides between the
 * links under the pointer, and a accent underline marks the section you are
 * reading.
 *
 * The section links and the logo are SectionLinks: on the home page they
 * scroll in place (the logo back to the top), from another page they open the
 * home page at that section. While a scroll started by any section link runs,
 * the underline stays on its target instead of passing every section.
 *
 * Below the lg breakpoint the links collapse into a disclosure panel, which
 * closes on Escape, on a tap outside it and when a link is chosen. (Between md
 * and lg the six links would wrap.) The workspace (/app) has its own top bar
 * (ui/workspace/Shell).
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
import { onSectionScroll, SectionLink } from "./SectionLink";

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

export function SiteHeader() {
  const pathname = usePathname();
  const onHome = pathname === "/";
  const [scrolled, setScrolled] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [section, setSection] = React.useState<string | null>(null);
  const headerRef = React.useRef<HTMLElement>(null);
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

  // A section link anywhere on the page (here, the footer, the hero) has started a scroll.
  React.useEffect(
    () =>
      onSectionScroll((id) => {
        heading.current = id ?? "top";
        const release = () => {
          heading.current = null;
        };
        window.addEventListener("scrollend", release, { once: true });
        window.setTimeout(release, 1400);
        setSection(id && LINKED.has(id) ? id : null);
        setOpen(false);
      }),
    [],
  );

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

  // Close the mobile menu with Escape, or a tap or click anywhere outside the header.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  /** Which link reads as current: the section in view on the home page, the page itself elsewhere. */
  const currentOf = (href: string): "location" | "page" | undefined => {
    if (href === "/changelog") return pathname === "/changelog" ? "page" : undefined;
    return onHome && section === href.slice(2) ? "location" : undefined;
  };

  return (
    <header
      ref={headerRef}
      className={cn(
        "sticky top-0 z-50 border-b transition-[background-color,border-color,backdrop-filter] duration-slow",
        scrolled || open ? "glass border-border" : "border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <SectionLink href="/" aria-label="Loupe home" className="rounded-control">
          <Wordmark size="sm" />
        </SectionLink>
        <nav
          aria-label="Primary"
          className="hidden items-center gap-0.5 lg:flex"
          onPointerLeave={() => setHovered(null)}
        >
          {LINKS.map((l) => {
            const current = currentOf(l.href);
            return (
              <SectionLink
                key={l.href}
                href={l.href}
                aria-current={current}
                onPointerEnter={() => setHovered(l.href)}
                onFocus={() => setHovered(l.href)}
                onBlur={() => setHovered(null)}
                className={cn(
                  "relative rounded-control px-3 py-2 text-ui whitespace-nowrap transition-colors hover:text-fg",
                  current ? "text-fg" : "text-fg-muted",
                )}
              >
                {hovered === l.href ? (
                  <motion.span
                    layoutId="site-nav-hover"
                    aria-hidden
                    className="absolute inset-0 -z-10 rounded-control bg-surface-hover"
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
              </SectionLink>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {/* On touch screens the header's buttons are 44 px targets; from lg the pointer's 36 px. */}
          <span className="flex [&>button]:size-11 lg:[&>button]:size-9">
            <ThemeToggle compact />
          </span>
          <Button asChild variant="primary" size="sm" className="hidden sm:inline-flex">
            <Link href="/app">
              Open workspace <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 lg:hidden"
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
            // Solid, on the overlay plane like every menu: a frosted panel inside the frosted header
            // can't blur the page behind it.
            className="absolute inset-x-0 top-full border-y border-border bg-surface-overlay shadow-pop lg:hidden"
          >
            <div className="grid gap-1 px-4 py-3">
              {LINKS.map((l) => {
                const current = currentOf(l.href);
                return (
                  <SectionLink
                    key={l.href}
                    href={l.href}
                    aria-current={current}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex min-h-11 items-center justify-between rounded-control px-3 py-2.5 text-sm hover:bg-surface-hover hover:text-fg active:bg-surface-active",
                      current ? "bg-surface-selected text-fg" : "text-fg-muted",
                    )}
                  >
                    {l.label}
                    {current ? <span aria-hidden className="size-1.5 rounded-full bg-accent" /> : null}
                  </SectionLink>
                );
              })}
              <Button asChild variant="primary" size="md" className="mt-2 h-11">
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
