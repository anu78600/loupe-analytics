/** 404 page: a calm dead end with the two places people usually want to go. */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LoupeMark } from "@/ui/brand/logo";

export default function NotFound() {
  return (
    <main id="main" className="relative isolate grid min-h-dvh place-items-center px-4">
      <div aria-hidden className="mesh absolute inset-0 -z-10 opacity-70" />
      <div className="max-w-md text-center">
        <LoupeMark className="mx-auto size-12" />
        <p className="font-figures mt-6 text-2xs tracking-[0.14em] text-fg-subtle uppercase">404</p>
        <h1 className="mt-2 font-display text-[40px] leading-tight text-fg">Nothing to examine here.</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">
          This page doesn&apos;t exist. Your data, as always, stayed in your browser.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/app"
            className="inline-flex items-center gap-2 rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg hover:bg-accent-strong"
          >
            Open the workspace <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center rounded-control border border-border-strong px-4 py-2.5 text-sm text-fg hover:border-border-accent"
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
