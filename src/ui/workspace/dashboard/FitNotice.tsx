"use client";

/**
 * The calm notice at the top of the dashboard, in both views, when the
 * industry it is built for explains few of the file's columns
 * (ContextResult.fit.weak, from Session.configure): "Pharma fits few of your
 * columns (1 of 12)", with "Use a general dashboard" (the dashboard is built
 * again for the kind of table this is, and the choice is learned like any
 * choice on Detect) and "Keep" (the notice goes for this file and industry,
 * in both views: the store's fitKept).
 *
 * When a remembered industry choice (store/learned.ts) put the industry
 * there, the notice says so and adds Forget, which takes back what the rule
 * set and deletes it, as the learned notice on Detect does. One short line on
 * screen (its words in industryFit.ts); why it matters is behind the ⓘ
 * (ui/primitives/reveal.tsx).
 */
import * as React from "react";
import { Puzzle } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/primitives/button";
import { Brief } from "@/ui/primitives/reveal";
import { weakFitLine } from "../industryFit";

/** Controls keyboard focus can land on, to hand focus on when the notice goes. */
const FOCUSABLE = "a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])";

export function FitNotice({ className }: { className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const context = useWorkspace((s) => s.context);
  const kept = useWorkspace((s) => s.fitKept);
  const remembered = useWorkspace((s) => s.learned?.applied?.industry ?? null);
  const busy = useWorkspace((s) => Boolean(s.loading));
  const chooseIndustry = useWorkspace((s) => s.chooseIndustry);
  const confirm = useWorkspace((s) => s.confirmDomain);
  const keepFit = useWorkspace((s) => s.keepFit);
  const forget = useWorkspace((s) => s.forgetLearned);
  const locale = useSettings((s) => s.numberLocale);
  const fit = context?.fit;
  // The general dashboard is built for the table itself, so it never fits "few" columns.
  if (!context || context.domain.generic || !fit?.weak || kept === context.domain.id) return null;
  const name = context.domain.name;
  const fromRule = remembered?.domainId === context.domain.id;
  // Keep removes the notice and the button with it: focus moves on to the next control on the page
  // (the view switch), rather than falling back to the top of the document.
  const keep = (domainId: string) => {
    const el = ref.current;
    const next = el
      ? Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).find(
          (x) => !el.contains(x) && Boolean(el.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING),
        )
      : undefined;
    next?.focus();
    keepFit(domainId);
  };
  const why = `Most of ${name}'s KPIs and charts need columns this file doesn't have, and the columns it did match may mean something else. A general dashboard is built for the kind of table this is.`;
  return (
    <div
      ref={ref}
      role="status"
      // The one-page view sizes its page to leave room for the notice (PageView).
      data-fit-notice=""
      className={cn(
        "no-print flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-info-border bg-info-soft px-4 py-2.5",
        className,
      )}
    >
      <p className="flex min-w-0 flex-1 basis-72 items-start gap-2.5 text-sm text-fg">
        <Puzzle className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <span>
          <span className="font-medium">{weakFitLine(name, fit, locale)}</span>{" "}
          {fromRule ? (
            <Brief
              label={`Why ${name} was used`}
              full={`${name} was used because you chose it for a file like this before. ${why} Forget stops Loupe using it for files like this.`}
            >
              Remembered from a file like this.
            </Brief>
          ) : (
            <Brief label="Why a general dashboard fits better" full={why}>
              A general dashboard fits better.
            </Brief>
          )}
        </span>
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            // As a choice on Detect: built at once, and learned for files like this one.
            chooseIndustry("generic", null);
            void confirm("generic", null, { goTo: "dashboard" });
          }}
        >
          Use a general dashboard
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => keep(context.domain.id)}>
          Keep
        </Button>
        {fromRule ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              forget();
              toast("Forgotten", { description: "Loupe won't use it again for files like this." });
            }}
          >
            Forget
          </Button>
        ) : null}
      </div>
    </div>
  );
}
