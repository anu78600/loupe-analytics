"use client";

/**
 * Top navigation for the marketing pages (landing and version log).
 *
 * Transparent over the hero, then turns into a frosted bar with a hairline once
 * the page scrolls; a brass line along its bottom edge shows how far down the
 * page you are. A soft highlight slides between the links under the pointer.
 * Below the md breakpoint the links collapse into a disclosure panel. The
 * workspace (/app) has its own top bar (ui/workspace/Shell).
 */
import * as React from "react";
import Link from "next/link";
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

export function SiteHeader() {
  const [scrolled, setScrolled] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 220, damping: 32, restDelta: 0.001 });

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile menu with Escape.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-[background-color,border-color,backdrop-filter] duration-300",
        scrolled || open ? "glass border-border" : "border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="Loupe home" className="rounded-control">
          <Wordmark size="sm" />
        </Link>
        <nav
          aria-label="Primary"
          className="hidden items-center gap-0.5 md:flex"
          onPointerLeave={() => setHovered(null)}
        >
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onPointerEnter={() => setHovered(l.href)}
              onFocus={() => setHovered(l.href)}
              onBlur={() => setHovered(null)}
              className="relative rounded-control px-3 py-2 text-ui text-fg-muted transition-colors hover:text-fg"
            >
              {hovered === l.href ? (
                <motion.span
                  layoutId="site-nav-hover"
                  aria-hidden
                  className="absolute inset-0 -z-10 rounded-control bg-surface-2"
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                />
              ) : null}
              {l.label}
            </Link>
          ))}
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
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-border md:hidden"
          >
            <div className="grid gap-1 px-4 py-3">
              {LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-control px-3 py-2.5 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg"
                >
                  {l.label}
                </Link>
              ))}
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
