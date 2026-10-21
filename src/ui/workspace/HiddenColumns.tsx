"use client";

/**
 * Step 3's hidden-columns panel, above the tabs. It does two things.
 *
 * Suggestions: columns that look replaced by a cleaned copy, found on loading
 * (engine/profile/replaced.ts), such as Unit_Price next to Unit_Price_Clean
 * and the Reference_Price used to correct it. Each comes with its evidence
 * and a Hide button; there are also "Hide all" and "Not now". Nothing is
 * hidden until the user says so.
 *
 * The hidden list: every column the user hid, with Show to bring it back.
 * The note says what hiding means: the column stays in the file, the data
 * grid and the exports, but no KPI, chart, filter, insight or question reads
 * it. With neither, one line says how to hide a column. Each explanation is
 * one short line with the full text behind hover, a long press or its ⓘ
 * (ui/primitives/reveal.tsx).
 */
import * as React from "react";
import { ArrowRight, EyeOff, Sparkles } from "lucide-react";
import { useWorkspace } from "@/store/workspace";
import { Button } from "@/ui/primitives/button";
import { Brief, ClampText, InfoTip } from "@/ui/primitives/reveal";

export function HiddenColumns() {
  const replaced = useWorkspace((s) => s.replaced);
  const dismissed = useWorkspace((s) => s.replacedDismissed);
  const hidden = useWorkspace((s) => s.hiddenColumns);
  const fileOrder = useWorkspace((s) => s.profile?.columns);
  const setHidden = useWorkspace((s) => s.setColumnsHidden);
  const dismiss = useWorkspace((s) => s.dismissReplaced);
  // A suggestion is gone once its column is hidden, and moot when the user hid its replacement.
  const open = dismissed
    ? []
    : replaced.filter((r) => !hidden.includes(r.column) && !hidden.includes(r.keep));
  const list = (fileOrder ?? []).map((c) => c.name).filter((n) => hidden.includes(n));

  return (
    <section aria-label="Hidden columns" className="mb-5 grid gap-3">
      {open.length ? (
        <div className="rounded-card border border-border-accent bg-accent-soft p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 gap-2.5">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              <div className="min-w-0">
                <h2 className="text-sm font-medium text-fg">
                  {open.length === 1
                    ? "This column looks replaced by a cleaned copy"
                    : `These ${open.length} columns look replaced by cleaned copies`}
                </h2>
                <p className="mt-0.5 max-w-3xl text-sm text-fg-muted">
                  <Brief
                    label="About hiding replaced columns"
                    full={`Hide ${open.length === 1 ? "it" : "them"} and every KPI, chart and question uses the clean column instead. ${open.length === 1 ? "It stays" : "They stay"} in your file as a reference.`}
                  >
                    Hide {open.length === 1 ? "it" : "them"} to use the clean column instead.
                  </Brief>
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              {open.length > 1 ? (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    setHidden(
                      open.map((r) => r.column),
                      true,
                    )
                  }
                >
                  <EyeOff aria-hidden /> Hide all {open.length}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={dismiss}>
                Not now
              </Button>
            </div>
          </div>
          <ul className="mt-3 grid gap-2">
            {open.map((r) => (
              <li
                key={r.column}
                className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border bg-surface-1 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-ui">
                    <span className="font-medium text-fg">{r.column}</span>
                    <ArrowRight className="size-3.5 text-fg-subtle" aria-hidden />
                    <span className="sr-only">replaced by</span>
                    <span className="font-medium text-fg">{r.keep}</span>
                  </p>
                  <ClampText lines={2} className="mt-0.5 text-xs leading-relaxed text-fg-muted">
                    {r.reason}
                  </ClampText>
                </div>
                <Button
                  size="sm"
                  variant={open.length === 1 ? "primary" : "secondary"}
                  onClick={() => setHidden([r.column], true)}
                  aria-label={`Hide ${r.column}`}
                >
                  <EyeOff aria-hidden /> Hide
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {list.length ? (
        <div className="grid gap-2 rounded-card border border-border bg-surface-1 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-flex items-center gap-1.5 text-ui font-medium text-fg">
              <EyeOff className="size-4 text-fg-subtle" aria-hidden />
              Hidden from the analysis
              <InfoTip label="About hidden columns">
                {list.length === 1 ? "It stays" : "They stay"} in your file, in the grid and in every export
                as your reference, but no KPI, chart, filter, insight or question uses{" "}
                {list.length === 1 ? "it" : "them"}. Power BI gets {list.length === 1 ? "it" : "them"} as
                hidden columns.
              </InfoTip>
            </span>
            <ul className="flex flex-wrap gap-1.5">
              {list.map((c) => (
                <li
                  key={c}
                  className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-border-strong bg-surface-2 py-0.5 pr-0.5 pl-2.5 text-xs text-fg"
                >
                  <span className="min-w-0 truncate" title={c}>
                    {c}
                  </span>
                  <button
                    type="button"
                    onClick={() => setHidden([c], false)}
                    aria-label={`Use ${c} in the analysis again`}
                    className="rounded-full px-2 py-0.5 text-accent transition-colors hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none"
                  >
                    Show
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : !open.length ? (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-fg-subtle">
          <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <Brief
            label="About hiding a column"
            full="Keeping a raw column only as a reference for a cleaned one? Hide it with the eye button on its header below, or in Your columns: it stays in your file, and nothing is computed from it."
          >
            Hide a reference-only column with the eye on its header.
          </Brief>
        </p>
      ) : null}
    </section>
  );
}
