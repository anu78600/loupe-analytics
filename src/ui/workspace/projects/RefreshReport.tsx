"use client";

/**
 * The refresh report (version 55.0): shown once a project's dashboard has
 * taken a new file (projects/store.ts refreshProject), it says what the new
 * file is (rows and how far its data runs, against before), how many of the
 * dashboard's KPIs and charts it kept, and what changed in its columns:
 * renamed ones (read under the dashboard's name, with how they were
 * recognised), missing ones, new ones and ones of another type, then
 * anything that couldn't be kept and why. "Undo" puts the project back as it
 * was, with its old file. Long lists show their first few names and a count.
 */
import * as React from "react";
import { ArrowRightLeft, CheckCircle2, CircleAlert, CircleMinus, CirclePlus, Undo2 } from "lucide-react";
import type { RenameHow } from "@/engine/core/types";
import { formatDay } from "@/engine/core/dates";
import { formatCount } from "@/engine/core/format";
import { useSettings } from "@/store/settings";
import { Button } from "@/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/primitives/dialog";
import { nothingChanged, type RefreshReport } from "./refresh";
import { undoRefresh, useProjects } from "./store";

/** Names shown in one list before "and N more". */
const SHOW = 6;

const HOW: Record<RenameHow, string> = {
  spelling: "same name, written differently",
  words: "same words",
  similar: "close spelling",
};

export function RefreshReportDialog() {
  const report = useProjects((p) => p.report);
  return (
    <Dialog open={report !== null} onOpenChange={(open) => !open && useProjects.setState({ report: null })}>
      {report ? <ReportBody report={report} /> : null}
    </Dialog>
  );
}

function ReportBody({ report: r }: { report: RefreshReport }) {
  const locale = useSettings((s) => s.numberLocale);
  const n = (x: number) => formatCount(x, locale);
  const c = r.changes;
  const same = nothingChanged(r);
  const lost = [...(r.kpis?.lost ?? []), ...(r.charts?.lost ?? [])];
  const facts = [
    `${n(r.rows)} rows${r.rows !== r.previousRows ? `, was ${n(r.previousRows)}` : ""}`,
    r.dataTo !== null
      ? `data to ${formatDay(r.dataTo)}${r.previousDataTo !== null && r.previousDataTo !== r.dataTo ? `, was ${formatDay(r.previousDataTo)}` : ""}`
      : null,
  ].filter(Boolean);
  return (
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>Refreshed with {r.fileName}</DialogTitle>
        <DialogDescription className="tabular">{facts.join(" · ")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 text-sm">
        {r.kpis || r.charts ? (
          <p className="tabular flex flex-wrap gap-x-4 gap-y-1 text-fg">
            {r.kpis ? (
              <span>
                <strong className="font-semibold">{n(r.kpis.kept)}</strong> of {n(r.kpis.total)} KPIs kept
              </span>
            ) : null}
            {r.charts ? (
              <span>
                <strong className="font-semibold">{n(r.charts.kept)}</strong> of {n(r.charts.total)} charts
                kept
              </span>
            ) : null}
            {!r.filters.length ? <span className="text-fg-muted">Filters and colours kept</span> : null}
          </p>
        ) : null}
        {same ? (
          <Line icon={CheckCircle2} tone="success">
            Same columns as before: every KPI, chart, filter and colour carried over.
          </Line>
        ) : null}
        {c.renamed.length ? (
          <Section
            icon={ArrowRightLeft}
            title="Renamed"
            note="Read under the dashboard's name, so nothing breaks."
          >
            {c.renamed.map((x) => (
              <li key={x.from}>
                <span className="font-data">“{x.from}”</span> as <span className="font-data">“{x.to}”</span>{" "}
                <span className="text-fg-subtle">({HOW[x.how]})</span>
              </li>
            ))}
          </Section>
        ) : null}
        {c.missing.length ? (
          <Section
            icon={CircleMinus}
            tone="warning"
            title="Missing"
            note="Not in the new file: anything that read them is left out."
          >
            {names(c.missing)}
          </Section>
        ) : null}
        {c.retyped.length ? (
          <Section
            icon={CircleAlert}
            tone="warning"
            title="Read differently"
            note="Check these in Data health."
          >
            {c.retyped.slice(0, SHOW).map((x) => (
              <li key={x.name}>
                <span className="font-data">“{x.name}”</span> is {typeName(x.now)} now, was {typeName(x.was)}
              </li>
            ))}
          </Section>
        ) : null}
        {c.added.length ? (
          <Section icon={CirclePlus} title="New" note="Not used yet: add them in Customise.">
            {names(c.added)}
          </Section>
        ) : null}
        {lost.length || r.filters.length ? (
          <Section icon={CircleAlert} tone="warning" title="Not kept">
            {lost.slice(0, SHOW).map((x) => (
              <li key={x.name}>
                {x.name} <span className="text-fg-subtle">· {x.reason}</span>
              </li>
            ))}
            {lost.length > SHOW ? <li className="text-fg-subtle">and {n(lost.length - SHOW)} more</li> : null}
            {r.filters.map((f) => (
              <li key={`filter-${f}`}>
                The filter on <span className="font-data">“{f}”</span>{" "}
                <span className="text-fg-subtle">· its column is missing</span>
              </li>
            ))}
          </Section>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => void undoRefresh()}>
          <Undo2 aria-hidden /> Undo refresh
        </Button>
        <Button onClick={() => useProjects.setState({ report: null })}>Done</Button>
      </DialogFooter>
    </DialogContent>
  );

  function names(list: string[]) {
    return (
      <>
        {list.slice(0, SHOW).map((x) => (
          <li key={x} className="font-data">
            “{x}”
          </li>
        ))}
        {list.length > SHOW ? <li className="text-fg-subtle">and {n(list.length - SHOW)} more</li> : null}
      </>
    );
  }
}

const typeName = (t: string) => (t === "string" ? "text" : t === "boolean" ? "yes/no" : t);

type Icon = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

function Line({ icon: I, tone, children }: { icon: Icon; tone: "success"; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-fg">
      <I
        className={tone === "success" ? "mt-0.5 size-4 shrink-0 text-success" : "mt-0.5 size-4 shrink-0"}
        aria-hidden
      />
      {children}
    </p>
  );
}

function Section({
  icon: I,
  title,
  note,
  tone,
  children,
}: {
  icon: Icon;
  title: string;
  note?: string;
  tone?: "warning";
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-1.5">
      <h3 className="flex items-center gap-1.5 font-medium text-fg">
        <I className={tone === "warning" ? "size-4 text-warning" : "size-4 text-fg-subtle"} aria-hidden />
        {title}
        {note ? <span className="font-normal text-fg-muted">· {note}</span> : null}
      </h3>
      <ul className="grid gap-1 pl-5.5 text-fg">{children}</ul>
    </section>
  );
}
