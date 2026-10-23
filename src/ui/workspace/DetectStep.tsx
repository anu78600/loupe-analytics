"use client";

/**
 * Step 2, Detect: the data's story first, the industry second (version 50.2,
 * the guided flow). Under the StepHeader ("Here's what Loupe understood") the
 * page reads as five chapters in one column (flow/Chapter):
 *
 * 1. What this data is about: one card with the reading's title, what one
 *    row is, a band of figures (rows, columns, dates, outcome) and its
 *    sentences (AboutHero).
 * 2. What it is measured by and what moves it (OutcomeChapter).
 * 3. How each column is read, by kind, with "Read as …" (ColumnsChapter).
 * 4. Which industry it belongs to: one card, the match on the left (the
 *    confidence ring, what the industry explains, the matched columns behind
 *    "See the N matched columns", and the top matches) and the choice on the
 *    right (industry, data shape, and the business model, goal, period,
 *    currency and notes folded under "More about your business"). The user's
 *    choice always overrides detection, and the left half describes that
 *    choice, not the best match.
 * 5. Before you continue: the top data issues, each with Review (to Check &
 *    map), or one line saying none were found (IssuesChapter).
 *
 * It ends with the next-step dock (flow/FlowDock): "Review columns" confirms
 * the choice and opens Check & map; "Skip to dashboard" builds and opens the
 * dashboard. A changed choice is built when the user moves on (the dock, or
 * any later step). The column-by-column table that used to close this page is
 * Check & map's review table now.
 *
 * Above the chapters, each said once: what a learned rule set (LearnedNotice),
 * how a workbook's sheets were joined, that the data is a sample, how dates
 * nothing could prove were read (with a switch), the wide-format banner,
 * whose unpivot adds two columns and so asks first (useColumnConsent), and the
 * scorecard notice: a tall "Metric | Month | Value" table whose metrics can
 * become columns of their own. The worker plans that pivot first, so the
 * dialog names exactly the columns it adds and the ones it leaves out.
 *
 * Choosing an industry or shape goes through chooseIndustry, so it is learned
 * for files like this one once built. An industry chosen although detection
 * scores it under 35% (the bar below which detection picks the general
 * dashboard itself) gets a warning under the Industry field: how many of the
 * file's columns it explains, why that matters, and "Use a general dashboard"
 * (industryFit.ts). It never blocks the choice.
 *
 * Notes and hints are one short line each; the full sentence is behind
 * hover, a long press or its ⓘ (ui/primitives/reveal.tsx), and long values
 * (a tagline, a reason) are clamped with the whole text on demand.
 */
import * as React from "react";
import { motion } from "framer-motion";
import { Collapsible } from "radix-ui";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  Columns3,
  LayoutDashboard,
  Sparkles,
  TableColumnsSplit,
  Waypoints,
} from "lucide-react";
import { toast } from "sonner";
import { engine } from "@/lib/engine-client";
import type { PivotPlan } from "@/engine/parse/pivot";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { SUPPORTED_CURRENCIES, currencySymbol, formatCount } from "@/engine/core/format";
import { grainLabel, listOf } from "@/engine/profile/structure";
import type { DomainCandidate } from "@/engine/detect/detect";
import { describeTable } from "@/engine/detect/tableShape";
import type { DomainListItem } from "@/engine/session";
import { cn } from "@/lib/utils";
import { countOf, ordinal } from "@/ui/common/words";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Card } from "@/ui/primitives/card";
import { Label, Textarea } from "@/ui/primitives/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/ui/primitives/select";
import { Segmented } from "@/ui/primitives/segmented";
import { Tooltip } from "@/ui/primitives/tooltip";
import { Brief, ClampText, InfoTip } from "@/ui/primitives/reveal";
import { DomainIcon } from "@/ui/common/domain-icon";
import { ConfidenceRing } from "./ConfidenceRing";
import { FileIdentity } from "./FileIdentity";
import { useColumnConsent } from "./NewColumnsDialog";
import { unpivotColumnNames } from "@/engine/parse/unpivot";
import { AiDomainCheck } from "./AiSummary";
import { DateOrderSwitch } from "./HealthPanel";
import { LearnedNotice } from "./LearnedNotice";
import { WorkbookModelNotice } from "./WorkbookModelNotice";
import { lowFitOf, lowFitWords, type LowFit } from "./industryFit";
import { AboutHero, ColumnsChapter, IssuesChapter, OutcomeChapter } from "./understanding/AboutData";
import { industryWords } from "./understanding/aboutWords";
import { Chapter } from "./flow/Chapter";
import { FlowDock } from "./flow/FlowDock";
import { StepHeader } from "./flow/StepHeader";
import { detectStatus } from "./flow/prepareWords";

const MODELS = ["D2C brand", "Marketplace seller", "B2B", "Subscription", "Retail / offline", "Other"];
const GOALS = [
  { value: "growth", label: "Growth" },
  { value: "profit", label: "Profit" },
  { value: "retention", label: "Retention" },
  { value: "efficiency", label: "Efficiency" },
] as const;

export function DetectStep() {
  const detection = useWorkspace((s) => s.detection);
  const profile = useWorkspace((s) => s.profile);
  const summary = useWorkspace((s) => s.summary);
  const report = useWorkspace((s) => s.report);
  const domainId = useWorkspace((s) => s.domainId);
  const subDomainId = useWorkspace((s) => s.subDomainId);
  const domains = useWorkspace((s) => s.domains);
  const confirm = useWorkspace((s) => s.confirmDomain);
  const unpivot = useWorkspace((s) => s.unpivot);
  const pivot = useWorkspace((s) => s.pivot);
  const loading = useWorkspace((s) => s.loading);
  const pending = useWorkspace((s) => s.understandingPending);
  // With a reading of the table, its chapters say what one row is and count the rows and columns.
  const understood = useWorkspace((s) => s.understanding !== null);
  const locale = useSettings((s) => s.numberLocale);
  const consent = useColumnConsent();
  // While the worker plans the pivot, so a second click doesn't open a second dialog.
  const [planning, setPlanning] = React.useState(false);
  if (!detection || !profile || !summary) return null;
  // The grain as the dashboard will word it: the chosen industry's assumption replaces a key that
  // only numbers the rows (never "One row per row").
  const chosen = detection.candidates.find((c) => c.domainId === domainId);
  // Generic has no template: what one row is comes from the table's shape (a response, a country per year).
  const shapeGrain = domainId === "generic" ? describeTable(profile).grain : null;
  const grain = grainLabel(
    profile.grain,
    chosen && chosen.grain !== "row" ? chosen.grain : (shapeGrain ?? undefined),
  );
  const sampling = report?.sampling;
  const unproven = report?.dateFormats.filter((d) => d.ambiguous) ?? [];
  const wide = profile.wide;
  // Unpivoting replaces the period columns with two new ones, so it only runs after a yes.
  const askUnpivot = async () => {
    if (!wide) return;
    const names = unpivotColumnNames(
      profile.columns.map((c) => c.name),
      wide,
    );
    const ok = await consent.ask({
      title: "Unpivot adds 2 columns",
      intro: `Unpivoting turns your ${wide.columns.length} period columns into rows, so each row holds one period and its value. The dashboard is then rebuilt from the new layout.`,
      columns: [
        {
          name: names.period,
          source: `the ${wide.columns.length} period headers`,
          reason: `the ${wide.kind === "year" ? "year" : "period"} each value belongs to`,
        },
        { name: names.value, source: "the period columns' cells", reason: "the number for that period" },
      ],
      replaces: wide.columns,
      ifNo: "Your columns stay exactly as they are, and the dashboard keeps using them.",
      yesLabel: "Unpivot and add 2 columns",
      noLabel: "Keep my columns",
    });
    if (ok) await unpivot();
  };
  const tall = profile.tall;
  // Turning metrics into columns replaces the metric and value columns with one column per metric, so it
  // too only runs after a yes. The worker works out the exact columns first.
  const askPivot = async (opener: HTMLElement) => {
    if (!tall) return;
    setPlanning(true);
    let plan: PivotPlan;
    try {
      plan = await engine().pivotPlan();
    } catch (e) {
      toast.error(`The scorecard couldn't be read: ${(e as Error).message}`);
      return;
    } finally {
      setPlanning(false);
    }
    const each = plan.kept.length ? ` for each ${listOf(plan.kept)}` : "";
    const rows = plan.kept.length
      ? `, with one row per ${listOf(plan.kept)} (${countOf(plan.rows, "row", locale)})`
      : plan.rows === 1
        ? ", all on one row"
        : `, on ${countOf(plan.rows, "row", locale)}`;
    const notes = [
      plan.unitColumn ? `Each metric's unit from "${plan.unitColumn}" goes into its column's name.` : "",
      plan.repeats
        ? `Where a metric appears more than once for the same ${plan.kept.length ? listOf(plan.kept) : "table"}, each repeat gets a row of its own.`
        : "",
      plan.skipped
        ? `${countOf(plan.skipped, "row", locale)} without a metric name or without figures ${plan.skipped === 1 ? "is" : "are"} left out${plan.lostFigures ? `, with ${countOf(plan.lostFigures, "figure", locale)} on them` : ""}.`
        : "",
    ].filter(Boolean);
    const ok = await consent.ask(
      {
        title: `Turning metrics into columns adds ${countOf(plan.columns.length, "column", locale)}`,
        intro: [
          `Each of the ${countOf(tall.metrics.length, "metric", locale)} in "${tall.metricColumn}" gets ${tall.valueColumns.length === 1 ? "a column" : "columns"} of its own${rows}. Every figure keeps its unit and lands in exactly one cell; nothing is added up. The dashboard is then rebuilt from the new layout.`,
          ...notes,
        ].join(" "),
        columns: plan.columns.map((c) => ({
          name: c.name,
          source: `"${c.value}" on the rows where ${tall.metricColumn} is "${c.metric}"`,
          reason: c.value === tall.valueColumns[0] ? `its figure${each}` : `its ${c.value} figure${each}`,
        })),
        replaces: plan.removed,
        ifNo: "Your columns stay exactly as they are, and the dashboard keeps using them.",
        yesLabel: `Add ${countOf(plan.columns.length, "column", locale)}`,
        noLabel: "Keep my layout",
      },
      opener,
    );
    if (ok) await pivot();
  };
  // Moving on confirms the choice (built now if it changed) and opens the step.
  const blocked = !domainId || Boolean(loading);
  const goTo = (step: "map" | "dashboard") => {
    if (domainId) void confirm(domainId, subDomainId, { goTo: step });
  };
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-8 pb-8 md:px-8 md:pt-10">
      <StepHeader
        step="detect"
        className="mb-8"
        title="Here's what Loupe understood"
        lead="Correct anything below; the dashboard follows."
        leadFull="Loupe reads the table before designing anything: what one row is, what the table is measured by and what moves it, how each column reads, and which industry it belongs to. Change anything below and the dashboard is built from your choice when you move on."
      >
        {/* From lg the top bar's breadcrumb names the file (shell/TopBar.tsx). */}
        <FileIdentity summary={summary} className="mt-3 lg:hidden" />
      </StepHeader>

      {/* Notices about how the file was read, each said once; the box vanishes when none applies. */}
      <div className="mb-8 grid gap-3 empty:hidden">
        <LearnedNotice />
        <WorkbookModelNotice />
        {sampling ? (
          <div
            role="note"
            className="flex items-start gap-2.5 rounded-card border border-warning-border bg-warning-soft px-4 py-3"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="text-sm text-fg">
              <span className="font-medium">A sample of the file.</span>{" "}
              <Brief
                label="About the sample"
                full={`${formatCount(sampling.keptRows, locale)} of about ${countOf(sampling.estimatedTotalRows, "row", locale)} were loaded (${
                  sampling.strategy === "systematic" && sampling.every
                    ? `every ${ordinal(sampling.every)} row`
                    : "the first rows"
                }). Totals describe these rows, not the whole file.`}
              >
                {formatCount(sampling.keptRows, locale)} of about{" "}
                {countOf(sampling.estimatedTotalRows, "row", locale)} loaded.
              </Brief>
            </p>
          </div>
        ) : null}
        {unproven.length ? (
          <div
            role="note"
            className="grid gap-2 rounded-card border border-info-border bg-info-soft px-4 py-3"
          >
            {unproven.map((d) => (
              <div key={d.column} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <p className="flex min-w-0 flex-1 items-start gap-2.5 text-sm text-fg">
                  <CalendarClock className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                  <span>
                    <span className="font-medium">
                      {d.column} read as {d.format}.
                    </span>{" "}
                    <Brief
                      label={`Why ${d.column} was read as ${d.format}`}
                      full={`${d.evidence} If these are ${d.alternative?.startsWith("MM") ? "month" : "day"}-first, switch now; you can also do it later in Check & map › File report.`}
                    >
                      Switch if they are {d.alternative?.startsWith("MM") ? "month" : "day"}-first.
                    </Brief>
                  </span>
                </p>
                <DateOrderSwitch decision={d} />
              </div>
            ))}
          </div>
        ) : null}
        {wide ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-info-border bg-info-soft px-4 py-3">
            <p className="text-sm text-fg">
              <span className="font-medium">Wide format detected.</span>{" "}
              <Brief label="About the wide format" full={wide.suggestion}>
                Unpivot it so trends work.
              </Brief>
            </p>
            <Button size="sm" variant="secondary" onClick={() => void askUnpivot()}>
              <Waypoints aria-hidden /> Unpivot (adds 2 columns)…
            </Button>
          </div>
        ) : null}
        {tall ? (
          <div
            role="note"
            className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-info-border bg-info-soft px-4 py-3"
          >
            {/* Grows beside the button on wide screens; below 16rem of room the button wraps underneath. */}
            <p className="min-w-[16rem] flex-1 text-sm text-fg">
              <span className="font-medium">This looks like a scorecard.</span>{" "}
              <Brief label="About the scorecard layout" full={tall.suggestion}>
                Its metrics can become columns.
              </Brief>
            </p>
            <Button
              size="sm"
              variant="secondary"
              disabled={planning || Boolean(loading)}
              onClick={(e) => void askPivot(e.currentTarget)}
            >
              <TableColumnsSplit aria-hidden /> Turn metrics into columns…
            </Button>
          </div>
        ) : null}
      </div>
      {consent.dialog}

      {/* The story: what the data is about leads; the industry, a label on that reading, follows it. */}
      <div className="flex flex-col gap-14">
        {understood ? (
          <AboutHero />
        ) : (
          <Chapter
            hero
            eyebrow="What this data is about"
            title="What kind of data is this?"
            sub={
              <span className="tabular">
                {countOf(summary.rowCount, "row", locale)} · {countOf(summary.columnCount, "column", locale)}{" "}
                · {grain}
              </span>
            }
          >
            <ul className="grid gap-1.5 text-sm text-fg-muted">
              {detection.structural.map((s) => (
                <li key={s} className="flex gap-2">
                  <Columns3 className="mt-1 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                  {s}
                </li>
              ))}
            </ul>
          </Chapter>
        )}
        <OutcomeChapter />
        <ColumnsChapter />
        <IndustryChapter />
        <IssuesChapter onReview={() => goTo("map")} disabled={blocked} />
      </div>

      <FlowDock
        status={detectStatus({
          domainId,
          candidates: detection.candidates,
          name: domains.find((d) => d.id === domainId)?.name,
        })}
        busy={pending || Boolean(loading)}
        secondary={{ label: "Skip to dashboard", onClick: () => goTo("dashboard"), disabled: blocked }}
        primary={{ label: "Review columns", onClick: () => goTo("map"), disabled: blocked }}
      />
    </div>
  );
}

/**
 * "Which industry it belongs to": one card, the match on the left and the choice on the right.
 * The left half follows the choice, not the ranking: the best match says so; a lower-ranked
 * candidate is "Your choice" with its own evidence; an industry outside the top matches, or the
 * general dashboard, gets a description of its own instead of the best match's evidence. When
 * detection is unsure, the card asks to be confirmed, ringed in the accent.
 */
function IndustryChapter() {
  const detection = useWorkspace((s) => s.detection);
  const domains = useWorkspace((s) => s.domains);
  const domainId = useWorkspace((s) => s.domainId);
  if (!detection) return null;
  // Detection ranks every industry, so there is a best match; were there none, the choice stands alone.
  const top = detection.candidates[0];
  const shown = detection.candidates.find((c) => c.domainId === domainId);
  const confirmFirst = detection.needsConfirmation;
  return (
    <Chapter
      eyebrow="Industry"
      title="Which industry it belongs to"
      sub={
        <Brief
          label="About the industry"
          full="The industry decides which KPIs and charts lead the dashboard. Detection is a starting point: anything you set here wins, and the dashboard is built from it as soon as you move on."
        >
          Your choice always wins over detection.
        </Brief>
      }
    >
      <Card
        className={cn(
          "overflow-hidden",
          confirmFirst && "border-border-accent shadow-[0_0_0_4px_var(--accent-soft),var(--shadow-card)]",
        )}
      >
        {confirmFirst ? (
          <div
            role="status"
            className="flex items-start gap-2.5 border-b border-warning-border bg-warning-soft px-5 py-3 md:px-6"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="text-sm text-fg">
              <span className="font-medium">Please confirm.</span> {detection.reason}{" "}
              <InfoTip label="How to confirm">
                Use the fields <span className="lg:hidden">below</span>
                <span className="hidden lg:inline">on the right</span>; your choice always overrides
                detection.
              </InfoTip>
            </p>
          </div>
        ) : null}
        <div className="grid lg:grid-cols-12">
          {top ? (
            <div className="min-w-0 border-b border-border-subtle p-5 md:p-6 lg:col-span-7 lg:border-r lg:border-b-0">
              {shown ? (
                <CandidateDetail candidate={shown} best={shown.domainId === top.domainId} />
              ) : (
                <ChoiceDetail domain={domains.find((d) => d.id === domainId)} top={top} />
              )}
              <TopMatches />
            </div>
          ) : null}
          <div className={cn("flex min-w-0 flex-col p-5 md:p-6", top ? "lg:col-span-5" : "lg:col-span-12")}>
            <IndustryForm />
          </div>
        </div>
      </Card>
    </Chapter>
  );
}

/**
 * The industries that matched something, best first, each a button that chooses it. Industries
 * that match nothing aren't ranked (that would name arbitrary industries as matches); with a
 * reading above and nothing matched, the list is left out, since the confirm notice says so.
 */
function TopMatches() {
  const detection = useWorkspace((s) => s.detection);
  const domainId = useWorkspace((s) => s.domainId);
  const chooseIndustry = useWorkspace((s) => s.chooseIndustry);
  const understood = useWorkspace((s) => s.understanding !== null);
  const matches = detection?.candidates.filter((c) => c.evidence.length > 0) ?? [];
  // One match that is the one shown above would only repeat it.
  if (matches.length === 1 && matches[0]?.domainId === domainId) return null;
  if (!matches.length && understood) return null;
  return (
    <div className="mt-6 border-t border-border-subtle pt-5">
      <p className="eyebrow mb-2 text-fg-subtle">Top matches</p>
      {matches.length ? (
        <ul className="grid gap-1">
          {matches.map((c) => (
            <li key={c.domainId}>
              <button
                type="button"
                aria-pressed={c.domainId === domainId}
                onClick={() => chooseIndustry(c.domainId, c.subDomain.id)}
                className={cn(
                  "grid w-full grid-cols-[minmax(0,1fr)_3.5rem_2.75rem] items-center gap-3 rounded-control px-3 py-2 text-left text-ui transition-colors duration-fast focus-visible:focus-ring sm:grid-cols-[minmax(0,1fr)_minmax(4rem,9rem)_2.75rem]",
                  c.domainId === domainId
                    ? "bg-surface-selected text-fg"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                )}
              >
                <span className="truncate font-medium">{c.name}</span>
                <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <motion.span
                    className="block h-full rounded-full bg-accent"
                    initial={{ width: 0 }}
                    animate={{ width: `${c.confidence}%` }}
                    transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                  />
                </span>
                <span className="font-figures text-right">{c.confidence}%</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ui text-fg-muted">None: no industry&apos;s fields match these columns.</p>
      )}
    </div>
  );
}

/**
 * A chosen industry that is not among the top matches, or Generic (no
 * registry entry), which detection picks itself when no industry scores 35%:
 * no score or evidence of its own to show, so none is borrowed from the best
 * match.
 */
function ChoiceDetail({ domain, top }: { domain: DomainListItem | undefined; top: DomainCandidate }) {
  const profile = useWorkspace((s) => s.profile);
  // The reading above already says what the table holds in sentences: only its shape here.
  const understood = useWorkspace((s) => s.understanding !== null);
  const generic = !domain;
  const noFit = generic && top.confidence < 35;
  // With nothing matched at all, no industry is "closest".
  const closest = top.evidence.length ? `the closest, ${top.name}, scores ${top.confidence}%` : null;
  // What the table is, in one sentence, as the generic dashboard will say it (detect/tableShape.ts).
  const table = generic && profile ? describeTable(profile) : null;
  return (
    <div className="flex items-start gap-4">
      <span className="grid size-12 shrink-0 place-items-center rounded-card border border-border-accent bg-accent-soft">
        <DomainIcon name={domain?.icon ?? "table"} className="size-5 text-accent" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{noFit ? "No industry fits" : "Your choice"}</Badge>
          {table && understood ? <Badge tone="neutral">{table.label}</Badge> : null}
        </div>
        <h3 className="mt-2 text-2xl font-semibold text-fg">{domain?.name ?? "General dashboard"}</h3>
        <p className="mt-1 max-w-xl text-ui text-fg-muted">
          <Brief
            label="About this choice"
            full={
              generic
                ? `${noFit ? (closest ? `No industry matches this file well (${closest}), so the` : "No industry's fields match these columns, so the") : "The"} dashboard is built for the kind of table it is: KPIs and charts that suit its shape, with no industry's KPIs assumed. Pick an industry instead if one fits.`
                : "Not among the top matches for this file. Check & map shows which of its fields were found; KPIs that need a missing field will say so instead of guessing."
            }
          >
            {/* The badge already says no industry fits: this line says what follows. */}
            {generic
              ? noFit && closest
                ? `Closest: ${top.name}, ${top.confidence}%. Built from your columns instead.`
                : "Built from your columns, no industry's KPIs assumed."
              : "Not a top match; missing fields will say so."}
          </Brief>
        </p>
        {table && !understood ? (
          <p className="mt-2 max-w-xl text-sm text-fg">
            <span className="eyebrow mr-2 text-fg-subtle">{table.label}</span>
            {table.description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** "Order date" against "Order Date": a field and a column with the same name need saying only once. */
const sameName = (a: string, b: string) =>
  a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * A ranked candidate: its match as a ring, its name, what it explains of the file (the reading's
 * fit, once the reading is of this industry), its data shape, and the columns that matched its
 * fields, folded to a few with "+N more".
 */
function CandidateDetail({ candidate: shown, best }: { candidate: DomainCandidate; best: boolean }) {
  const domains = useWorkspace((s) => s.domains);
  const domainId = useWorkspace((s) => s.domainId);
  const industry = useWorkspace((s) => s.understanding?.industry ?? null);
  const locale = useSettings((s) => s.numberLocale);
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  const meta = domains.find((d) => d.id === shown.domainId);
  // The reading names the industry it was read with; while it is read again it may still be another's.
  const words = industry?.id === shown.domainId ? industryWords(industry, domainId, locale) : null;
  return (
    <>
      <div className="flex items-center gap-5">
        <ConfidenceRing value={shown.confidence} size={104} label="match" className="max-sm:hidden" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid size-7 place-items-center rounded-control border border-border-accent bg-accent-soft">
              <DomainIcon name={meta?.icon ?? "table"} className="size-3.5 text-accent" />
            </span>
            <Badge tone="accent">{best ? "Best match" : "Your choice"}</Badge>
            {/* The ring is left out on a phone: the match is said here instead. */}
            <span className="font-figures text-ui text-fg-muted sm:hidden">{shown.confidence}% match</span>
          </div>
          <h3 className="mt-2.5 text-2xl font-semibold text-fg">{shown.name}</h3>
          <p className="mt-1 text-ui text-fg-muted">
            {shown.subDomain.name} ·{" "}
            <span className="tabular">{Math.round(shown.subDomain.coverage * 100)}%</span> of its key fields
            found
          </p>
          {words?.explains ? (
            <p
              className={cn(
                "tabular mt-0.5 flex items-center gap-1 text-ui",
                words.weak ? "text-warning-text" : "text-fg-muted",
              )}
            >
              {words.explains}
              <InfoTip label="About what it explains">{words.full}</InfoTip>
            </p>
          ) : null}
        </div>
      </div>

      {/* The evidence, folded: Check & map's table says what each column fills, column by column. */}
      {shown.evidence.length ? (
        <div className="mt-5">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex min-h-6 items-center gap-1 rounded-xs text-ui font-medium text-accent-text hover:underline focus-visible:focus-ring"
          >
            {open ? "Hide the matched columns" : `See the ${shown.evidence.length} matched columns`}
            <ChevronDown
              className={cn("size-3.5 transition-transform duration-base", open && "rotate-180")}
              aria-hidden
            />
          </button>
          {open ? (
            <div id={listId} className="mt-3">
              <MatchedColumns candidate={shown} />
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** The columns that matched the industry's fields, as chips (how each matched on hover), and the fields not found. */
function MatchedColumns({ candidate: shown }: { candidate: DomainCandidate }) {
  return (
    <>
      <ul className="flex flex-wrap items-center gap-1.5">
        {shown.evidence.map((e) => (
          <li key={e.fieldId}>
            <Tooltip
              content={`${e.fieldLabel} · matched by ${e.via === "name" ? "column name" : e.via === "values" ? "cell values" : "name and values"} · score ${(e.score * 100).toFixed(0)}`}
            >
              {/* Focusable, so the tooltip opens from the keyboard too. */}
              <span
                tabIndex={0}
                className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-2 pr-3 pl-2.5 text-xs focus-visible:focus-ring"
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    e.score >= 0.9 ? "bg-success" : e.score >= 0.7 ? "bg-accent" : "bg-warning",
                  )}
                  aria-hidden
                />
                {sameName(e.fieldLabel, e.column) ? null : (
                  <>
                    <span className="truncate text-fg-muted">{e.fieldLabel}</span>
                    <span className="text-fg-subtle" aria-label="from">
                      ←
                    </span>
                  </>
                )}
                <span className="truncate font-medium text-fg">{e.column}</span>
                {e.via !== "name" ? (
                  <Sparkles className="size-3 shrink-0 text-accent" aria-label="value evidence" />
                ) : null}
              </span>
            </Tooltip>
          </li>
        ))}
      </ul>
      {shown.missingSignals.length ? (
        <p className="mt-3 text-ui text-fg-muted">
          Not found: {shown.missingSignals.map((m) => m.label).join(", ")}.{" "}
          <InfoTip label="About the fields not found">
            KPIs that need them will say so instead of guessing.
          </InfoTip>
        </p>
      ) : null}
    </>
  );
}

/**
 * The choice itself: industry and data shape in view, the rest (business model, goal, period,
 * currency, notes) folded under "More about your business", which says how many are set. Anything
 * set here wins over detection.
 */
function IndustryForm() {
  const domains = useWorkspace((s) => s.domains);
  const detection = useWorkspace((s) => s.detection);
  const domainId = useWorkspace((s) => s.domainId);
  const subDomainId = useWorkspace((s) => s.subDomainId);
  const business = useWorkspace((s) => s.business);
  const chooseIndustry = useWorkspace((s) => s.chooseIndustry);
  const currencyOverride = useSettings((s) => s.currencyOverride);
  const columns = useWorkspace((s) => s.profile?.columns);
  const domain = domains.find((d) => d.id === domainId);
  const ranked = new Map(detection?.candidates.map((c) => [c.domainId, c.confidence]) ?? []);
  // A registry industry detection scores under 35% for this file: warned about before moving on.
  const lowFit =
    domain && detection && columns
      ? lowFitOf(
          detection,
          domain.id,
          columns.map((c) => c.name),
        )
      : null;
  const set = [
    business.model,
    business.goal,
    business.period,
    business.notes?.trim(),
    currencyOverride,
  ].filter(Boolean).length;
  return (
    // A container, so the goal lays out by the panel's width rather than the screen's; a column that
    // fills the card's height from lg, so the folded fields sit at its foot, level with the top matches.
    <div className="@container flex min-w-0 flex-1 flex-col gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="industry">Industry</Label>
        <Select value={domainId ?? undefined} onValueChange={(v) => chooseIndustry(v, null)}>
          <SelectTrigger id="industry">
            <SelectValue placeholder="Choose an industry" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Industries</SelectLabel>
              {domains.map((d) => (
                <SelectItem
                  key={d.id}
                  value={d.id}
                  hint={ranked.has(d.id) ? `${ranked.get(d.id)}%` : undefined}
                >
                  {d.name}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectSeparator />
            <SelectItem value="generic">Generic (build from the data&apos;s structure)</SelectItem>
          </SelectContent>
        </Select>
        {domain ? <ClampText className="text-xs text-fg-subtle">{domain.tagline}</ClampText> : null}
      </div>
      {domain && lowFit && columns ? (
        <LowFitWarning
          name={domain.name}
          fit={lowFit}
          columns={columns.length}
          onGeneral={() => {
            chooseIndustry("generic", null);
            // The warning goes with the choice: focus stays on the field that now says Generic.
            document.getElementById("industry")?.focus();
          }}
        />
      ) : null}
      {domain && domain.subDomains.length > 1 ? (
        <div className="grid gap-1.5">
          <Label htmlFor="shape">Data shape</Label>
          <Select
            value={subDomainId ?? "auto"}
            onValueChange={(v) => domainId && chooseIndustry(domainId, v === "auto" ? null : v)}
          >
            <SelectTrigger id="shape">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (best match)</SelectItem>
              {domain.subDomains.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <Collapsible.Root className="border-t border-border-subtle pt-1 lg:mt-auto">
        <Collapsible.Trigger className="group flex w-full items-center justify-between gap-3 rounded-control py-2 text-left text-ui font-medium text-fg transition-colors duration-fast hover:text-accent-text focus-visible:focus-ring">
          <span>
            More about your business{" "}
            <span className="font-normal text-fg-subtle">
              {set ? <span className="tabular">· {set} set</span> : "(optional)"}
            </span>
          </span>
          <ChevronDown
            className="size-4 shrink-0 text-fg-subtle transition-transform duration-base group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </Collapsible.Trigger>
        <Collapsible.Content className="pt-3">
          <BusinessFields />
        </Collapsible.Content>
      </Collapsible.Root>
      <AiDomainCheck />
    </div>
  );
}

/** Business model, main goal, primary period, currency and notes: optional, each wins over detection. */
function BusinessFields() {
  const business = useWorkspace((s) => s.business);
  const setBusiness = useWorkspace((s) => s.setBusiness);
  const currencyOverride = useSettings((s) => s.currencyOverride);
  const setCurrency = useSettings((s) => s.setCurrencyOverride);
  const profileCurrency = useWorkspace((s) => s.profile?.currency);
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="model">Business model</Label>
        <Select value={business.model ?? ""} onValueChange={(v) => setBusiness({ model: v })}>
          <SelectTrigger id="model">
            <SelectValue placeholder="Optional" />
          </SelectTrigger>
          <SelectContent>
            {MODELS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center gap-1.5">
          <Label>Main goal</Label>
          <InfoTip label="About the main goal">Orders the KPI strip around what you care about most.</InfoTip>
        </div>
        {/* Two by two in a narrow panel (the 1024 px layout), one row of four where it fits. */}
        <Segmented
          ariaLabel="Main goal"
          className="grid w-full grid-cols-2 @md:grid-cols-4"
          value={(business.goal as (typeof GOALS)[number]["value"]) ?? "growth"}
          onChange={(v) => setBusiness({ goal: v })}
          options={GOALS.map((g) => ({ value: g.value, label: g.label }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="period">Primary period</Label>
          <Select
            value={business.period ?? "auto"}
            onValueChange={(v) => setBusiness({ period: v === "auto" ? undefined : v })}
          >
            <SelectTrigger id="period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="day">Daily</SelectItem>
              <SelectItem value="week">Weekly</SelectItem>
              <SelectItem value="month">Monthly</SelectItem>
              <SelectItem value="quarter">Quarterly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="currency">Currency</Label>
            {profileCurrency && !currencyOverride ? (
              <InfoTip label="Where the currency came from">
                Currency source: {profileCurrency.source}
                {/[.!?]$/.test(profileCurrency.source) ? "" : "."}
              </InfoTip>
            ) : null}
          </div>
          <Select
            value={currencyOverride ?? "auto"}
            onValueChange={(v) => setCurrency(v === "auto" ? null : v)}
          >
            <SelectTrigger id="currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* "Detected" only when the file showed a currency; otherwise it is the default. */}
              <SelectItem value="auto">
                {(profileCurrency?.confidence ?? 0) >= 0.5 ? "Detected" : "Default"}:{" "}
                {profileCurrency?.code ?? "INR"}
              </SelectItem>
              {SUPPORTED_CURRENCIES.map((c) => (
                <SelectItem key={c} value={c} hint={currencySymbol(c).trim()}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="notes">Anything else?</Label>
        <Textarea
          id="notes"
          placeholder="e.g. We sell handmade apparel on our site and Amazon; COD heavy in tier-2 cities."
          value={business.notes ?? ""}
          onChange={(e) => setBusiness({ notes: e.target.value })}
        />
      </div>
    </div>
  );
}

/**
 * The inline warning under the Industry field for an industry that fits the file poorly (lowFitOf,
 * industryFit.ts): how many columns it explains (or, outside the top matches, its score at most),
 * with the rest of the reason behind the ⓘ, and a one-click switch to the general dashboard. The
 * choice stays the user's: moving on works as before.
 */
function LowFitWarning({
  name,
  fit,
  columns,
  onGeneral,
}: {
  name: string;
  fit: LowFit;
  /** Columns in the file. */
  columns: number;
  onGeneral: () => void;
}) {
  const locale = useSettings((s) => s.numberLocale);
  const words = lowFitWords(name, fit, columns, locale);
  return (
    <div
      role="status"
      className="flex flex-col items-start gap-2 rounded-control border border-warning-border bg-warning-soft px-3 py-2.5"
    >
      <p className="flex items-start gap-2.5 text-sm text-fg">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span>
          <span className="font-medium">{words.headline}</span>{" "}
          <Brief label={`Why ${name} may not fit`} full={words.full}>
            A general dashboard fits better.
          </Brief>
        </span>
      </p>
      <Button type="button" size="sm" variant="secondary" className="ml-6.5" onClick={onGeneral}>
        <LayoutDashboard aria-hidden /> Use a general dashboard
      </Button>
    </div>
  );
}
