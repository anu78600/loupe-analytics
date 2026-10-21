"use client";

/**
 * Step 2, Detect. Leads with what the data is about (AboutData, version
 * 49.0): the dashboard's title as an analyst would name it, what one row is,
 * the outcome the table is measured by and what moves it, the columns by
 * kind with "Read as …", the data issues and the industry as a label. The
 * industry choice follows it: the top industries with confidence and the
 * evidence of which column matched which field (the table's structure is in
 * the reading, so the card no longer repeats it), then every column header
 * in the file with the kind of values it holds, how Loupe reads it (the
 * same kinds as the chips above) and what is in it. BusinessForm lets the
 * user set industry, data shape (sub-domain), business model, goal,
 * reporting period and currency:
 * the user's choice always overrides detection, and the card beside the form
 * describes that choice, not the best match. A changed choice is built when
 * the user moves on (Next, Skip, or any later step). "Next: check your data"
 * confirms and opens step 3 (Check & map), where the whole file is shown
 * with its problems marked. Also says how dates nothing could prove were
 * read (with a switch), and that the data is a sample when it is; hosts the
 * optional AI second opinion, the wide-format banner, whose unpivot adds
 * two columns and so asks first (useColumnConsent), and the scorecard
 * notice: a tall "Metric | Month | Value" table whose metrics can become
 * columns of their own. The worker plans that pivot first, so the dialog
 * names exactly the columns it adds and the ones it leaves out.
 *
 * Choosing an industry or shape goes through chooseIndustry, so it is learned
 * for files like this one once built; when a learned rule set the choice,
 * LearnedNotice says so, with Undo and Forget.
 *
 * An industry chosen although detection scores it under 35% (the bar below
 * which detection picks the general dashboard itself) gets a warning under
 * the Industry field, before the user moves on: how many of the file's
 * columns it explains, why that matters, and "Use a general dashboard"
 * (industryFit.ts). It never blocks the choice.
 *
 * Notes and hints are one short line each; the full sentence is behind
 * hover, a long press or its ⓘ (ui/primitives/reveal.tsx), and long values
 * (a column's contents, a tagline) are clamped with the whole text on demand.
 */
import { FileIdentity } from "./FileIdentity";
import * as React from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CalendarClock,
  Clock,
  Columns3,
  Hash,
  LayoutDashboard,
  Sparkles,
  TableColumnsSplit,
  ToggleLeft,
  Type,
  Waypoints,
} from "lucide-react";
import { toast } from "sonner";
import { engine } from "@/lib/engine-client";
import type { PivotPlan } from "@/engine/parse/pivot";
import { stepNumber, useWorkspace } from "@/store/workspace";
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
import { Eyebrow } from "@/ui/primitives/misc";
import { Tooltip } from "@/ui/primitives/tooltip";
import { Brief, ClampText, InfoTip } from "@/ui/primitives/reveal";
import { DomainIcon } from "@/ui/common/domain-icon";
import { ConfidenceRing } from "./ConfidenceRing";
import { dataSummary, kindLabel } from "./columnSummary";
import { useColumnConsent } from "./NewColumnsDialog";
import { unpivotColumnNames } from "@/engine/parse/unpivot";
import { ROLE_LABEL } from "@/engine/profile/types";
import { AiDomainCheck } from "./AiSummary";
import { DateOrderSwitch } from "./HealthPanel";
import { LearnedNotice } from "./LearnedNotice";
import { WorkbookModelNotice } from "./WorkbookModelNotice";
import { lowFitOf, lowFitWords, type LowFit } from "./industryFit";
import { AboutData } from "./understanding/AboutData";
import { KIND_LABEL } from "@/engine/understand/kinds";

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
  const unpivot = useWorkspace((s) => s.unpivot);
  const pivot = useWorkspace((s) => s.pivot);
  const loading = useWorkspace((s) => s.loading);
  // With a reading of the table, its panel says what one row is and counts the rows and columns.
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
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-8 md:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Step {stepNumber("detect")} · Detect</Eyebrow>
          <h1 className="mt-2 font-display text-display-sm text-fg">What kind of data is this?</h1>
          <FileIdentity summary={summary} className="mt-2" />
        </div>
        {understood ? null : (
          <p className="text-ui text-fg-muted">
            {countOf(summary.rowCount, "row", locale)} · {countOf(summary.columnCount, "column", locale)} ·{" "}
            {grain}
          </p>
        )}
      </div>
      <LearnedNotice className="mb-5" />
      <WorkbookModelNotice className="mb-5" />
      {sampling ? (
        <div
          role="note"
          className="mb-5 flex items-start gap-2.5 rounded-card border border-warning-border bg-warning-soft px-4 py-3"
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
          className="mb-5 grid gap-2 rounded-card border border-info-border bg-info-soft px-4 py-3"
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
      {profile.wide ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-card border border-info-border bg-info-soft px-4 py-3">
          <p className="text-sm text-fg">
            <span className="font-medium">Wide format detected.</span>{" "}
            <Brief label="About the wide format" full={profile.wide.suggestion}>
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
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-card border border-info-border bg-info-soft px-4 py-3"
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
      {consent.dialog}
      {/* What the data is about leads; the industry, a label on that reading, is chosen below it. */}
      <AboutData className="mb-5" />
      <div className="grid gap-5 lg:grid-cols-12">
        <DetectionCard />
        <BusinessForm />
      </div>
      <ColumnsInFile />
    </div>
  );
}

/**
 * What the industry choice rests on: the chosen candidate's confidence, data
 * shape and matched columns. The card follows the choice, not the ranking:
 * the best match says so; a lower-ranked candidate is "Your choice" with its
 * own evidence; an industry outside the top matches, or Generic, gets a card
 * of its own instead of the best match's evidence. Top matches lists only
 * industries that matched something; when none did, it says so. The table's
 * structure (what one row is, its dates, its kinds of column) is in the
 * reading above it (AboutData), so the card keeps to the industry; without
 * a reading it lists the structure as before.
 */
function DetectionCard() {
  const detection = useWorkspace((s) => s.detection);
  const domains = useWorkspace((s) => s.domains);
  const domainId = useWorkspace((s) => s.domainId);
  const chooseIndustry = useWorkspace((s) => s.chooseIndustry);
  const understood = useWorkspace((s) => s.understanding !== null);
  const top = detection?.candidates[0];
  if (!detection || !top) return null;
  const shown = detection.candidates.find((c) => c.domainId === domainId);
  const matches = detection.candidates.filter((c) => c.evidence.length > 0);
  return (
    <Card className="relative overflow-hidden p-6 lg:col-span-7">
      <div aria-hidden className="mesh pointer-events-none absolute inset-x-0 top-0 h-48 opacity-60" />
      <div className="relative">
        {detection.needsConfirmation ? (
          <div
            role="status"
            className="mb-5 flex items-start gap-2.5 rounded-control border border-warning-border bg-warning-soft px-3 py-2.5"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="text-sm text-fg">
              <span className="font-medium">Please confirm.</span> {detection.reason}{" "}
              <InfoTip label="How to confirm">
                Use the form <span className="lg:hidden">below</span>
                <span className="hidden lg:inline">on the right</span>; your choice always overrides
                detection.
              </InfoTip>
            </p>
          </div>
        ) : null}
        {shown ? (
          <CandidateDetail candidate={shown} best={shown.domainId === top.domainId} />
        ) : (
          <ChoiceDetail domain={domains.find((d) => d.id === domainId)} top={top} />
        )}

        {/* With a reading above and no industry matching anything, the list would only repeat the
            confirm notice, so it is left out. */}
        {understood && !matches.length ? null : (
          <div
            className={cn(
              "mt-6 grid gap-5 border-t border-border-subtle pt-5",
              !understood && "md:grid-cols-2",
            )}
          >
            <div>
              <p className="eyebrow mb-2 text-fg-subtle">Top matches</p>
              {/* Only industries that matched something: ranking ones that match nothing would name
                arbitrary industries as matches. */}
              {matches.length ? null : (
                <p className="text-ui text-fg-muted">None: no industry&apos;s fields match these columns.</p>
              )}
              <ul className="grid gap-2">
                {matches.map((c) => (
                  <li key={c.domainId}>
                    <button
                      type="button"
                      aria-pressed={c.domainId === domainId}
                      onClick={() => chooseIndustry(c.domainId, c.subDomain.id)}
                      className={cn(
                        "w-full rounded-control border px-3 py-2 text-left transition-colors",
                        c.domainId === domainId
                          ? "border-border-accent bg-surface-selected"
                          : "border-border hover:border-border-hover hover:bg-surface-hover",
                      )}
                    >
                      <div className="flex items-center justify-between text-ui">
                        <span className="text-fg">{c.name}</span>
                        <span className="font-figures text-fg-muted">{c.confidence}%</span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
                        <motion.div
                          className="h-full rounded-full bg-accent"
                          initial={{ width: 0 }}
                          animate={{ width: `${c.confidence}%` }}
                          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                        />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {understood ? null : (
              <div>
                <p className="eyebrow mb-2 text-fg-subtle">Structure</p>
                <ul className="grid gap-1.5 text-ui text-fg-muted">
                  {detection.structural.map((s) => (
                    <li key={s} className="flex gap-2">
                      <Columns3 className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
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
  // The reading above (AboutData) already says what the table holds in sentences: only its shape here.
  const understood = useWorkspace((s) => s.understanding !== null);
  const generic = !domain;
  const noFit = generic && top.confidence < 35;
  // With nothing matched at all, no industry is "closest".
  const closest = top.evidence.length ? `the closest, ${top.name}, scores ${top.confidence}%` : null;
  // What the table is, in one sentence, as the generic dashboard will say it (detect/tableShape.ts).
  const table = generic && profile ? describeTable(profile) : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-8 place-items-center rounded-control border border-border-accent bg-accent-soft">
          <DomainIcon name={domain?.icon ?? "table"} className="size-4 text-accent" />
        </span>
        <Badge tone="accent">{noFit ? "No industry fits" : "Your choice"}</Badge>
        {table && understood ? <Badge tone="neutral">{table.label}</Badge> : null}
      </div>
      <h2 className="font-display text-display-sm text-fg">{domain?.name ?? "Generic"}</h2>
      <p className="max-w-xl text-sm text-fg-muted">
        <Brief
          label="About this choice"
          full={
            generic
              ? `${noFit ? (closest ? `No industry matches this file well (${closest}), so the` : "No industry's fields match these columns, so the") : "The"} dashboard is built for the kind of table it is: KPIs and charts that suit its shape, with no industry's KPIs assumed. Pick an industry instead if one fits.`
              : "Not among the top matches for this file. Check & map shows which of its fields were found; KPIs that need a missing field will say so instead of guessing."
          }
        >
          {/* The badge and the confirm notice already say no industry fits: this line says what follows. */}
          {generic
            ? noFit && closest
              ? `Closest: ${top.name}, ${top.confidence}%. Built from your columns instead.`
              : "Built from your columns, no industry's KPIs assumed."
            : "Not a top match; missing fields will say so."}
        </Brief>
      </p>
      {table && !understood ? (
        <p className="max-w-xl text-sm text-fg">
          <span className="eyebrow mr-2 text-fg-subtle">{table.label}</span>
          {table.description}
        </p>
      ) : null}
    </div>
  );
}

/** A ranked candidate: confidence, data shape and the columns that matched its fields. */
function CandidateDetail({ candidate: shown, best }: { candidate: DomainCandidate; best: boolean }) {
  const domains = useWorkspace((s) => s.domains);
  const meta = domains.find((d) => d.id === shown.domainId);
  return (
    <>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <ConfidenceRing value={shown.confidence} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-control border border-border-accent bg-accent-soft">
              <DomainIcon name={meta?.icon ?? "table"} className="size-4 text-accent" />
            </span>
            <Badge tone="accent">{best ? "Best match" : "Your choice"}</Badge>
          </div>
          <h2 className="mt-3 font-display text-display-sm text-fg">{shown.name}</h2>
          <p className="mt-2 text-sm text-fg-muted">
            {shown.subDomain.name} · {Math.round(shown.subDomain.coverage * 100)}% of its key fields found ·
            grain: {shown.grain}
          </p>
        </div>
      </div>

      <div className="mt-6">
        <p className="eyebrow mb-2 text-fg-subtle">Evidence · matched columns</p>
        <motion.ul
          className="flex flex-wrap gap-1.5"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.03 } } }}
        >
          {shown.evidence.slice(0, 16).map((e) => (
            <motion.li
              key={e.fieldId}
              variants={{ hidden: { opacity: 0, y: 4 }, show: { opacity: 1, y: 0 } }}
            >
              <Tooltip
                content={`Matched by ${e.via === "name" ? "column name" : e.via === "values" ? "cell values" : "name and values"} · score ${(e.score * 100).toFixed(0)}`}
              >
                {/* Focusable, so the tooltip opens from the keyboard too. */}
                <span
                  tabIndex={0}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border-strong bg-surface-2 pr-3 pl-2.5 text-xs focus-visible:focus-ring"
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      e.score >= 0.9 ? "bg-success" : e.score >= 0.7 ? "bg-accent" : "bg-warning",
                    )}
                    aria-hidden
                  />
                  <span className="text-fg-muted">{e.fieldLabel}</span>
                  <span className="text-fg-subtle">←</span>
                  <span className="font-medium text-fg">{e.column}</span>
                  {e.via !== "name" ? (
                    <Sparkles className="size-3 text-accent" aria-label="value evidence" />
                  ) : null}
                </span>
              </Tooltip>
            </motion.li>
          ))}
        </motion.ul>
        {shown.missingSignals.length ? (
          <p className="mt-3 text-sm text-fg-subtle">
            Not found: {shown.missingSignals.map((m) => m.label).join(", ")}.{" "}
            <InfoTip label="About the fields not found">
              KPIs that need them will say so instead of guessing.
            </InfoTip>
          </p>
        ) : null}
      </div>
    </>
  );
}

function BusinessForm() {
  const domains = useWorkspace((s) => s.domains);
  const detection = useWorkspace((s) => s.detection);
  const domainId = useWorkspace((s) => s.domainId);
  const subDomainId = useWorkspace((s) => s.subDomainId);
  const business = useWorkspace((s) => s.business);
  const setBusiness = useWorkspace((s) => s.setBusiness);
  const confirm = useWorkspace((s) => s.confirmDomain);
  const chooseIndustry = useWorkspace((s) => s.chooseIndustry);
  const loading = useWorkspace((s) => s.loading);
  const currencyOverride = useSettings((s) => s.currencyOverride);
  const setCurrency = useSettings((s) => s.setCurrencyOverride);
  const profileCurrency = useWorkspace((s) => s.profile?.currency);
  const columns = useWorkspace((s) => s.profile?.columns);
  const domain = domains.find((d) => d.id === domainId);
  const emphasise = detection?.needsConfirmation;
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
  return (
    <Card
      className={cn(
        "p-6 lg:col-span-5",
        emphasise && "border-border-accent shadow-[0_0_0_4px_var(--accent-soft),var(--shadow-card)]",
      )}
    >
      <h2 className="text-base font-semibold text-fg">Tell us about your business</h2>
      <p className="mt-1 text-sm text-fg-muted">
        <Brief
          label="About this form"
          full="Detection is a starting point. Anything you set here wins: the dashboard is built from it as soon as you move on."
        >
          Anything you set here wins.
        </Brief>
      </p>
      {/* A container, so the goal and the two buttons lay out by the form's width rather than the
          screen's; its one track may shrink below its widest child, so nothing pushes the card wider. */}
      <form
        className="@container mt-5 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (domainId) void confirm(domainId, subDomainId, { goTo: "map" });
        }}
      >
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
            <InfoTip label="About the main goal">
              Orders the KPI strip around what you care about most.
            </InfoTip>
          </div>
          {/* Two by two in a narrow form (the 1024 px layout), one row of four where it fits. */}
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
          <Label htmlFor="notes">Anything else? (optional)</Label>
          <Textarea
            id="notes"
            placeholder="e.g. We sell handmade apparel on our site and Amazon; COD heavy in tier-2 cities."
            value={business.notes ?? ""}
            onChange={(e) => setBusiness({ notes: e.target.value })}
          />
        </div>
        <div className="mt-1 flex flex-col gap-2 @md:flex-row">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            // Grows only in the side-by-side row: in the stacked column a zero basis would squash it.
            className="@md:flex-1"
            disabled={!domainId || Boolean(loading)}
          >
            Next: check your data <ArrowRight aria-hidden />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            disabled={!domainId || Boolean(loading)}
            onClick={() => domainId && void confirm(domainId, subDomainId, { goTo: "dashboard" })}
          >
            Skip to dashboard
          </Button>
        </div>
      </form>
      <AiDomainCheck />
    </Card>
  );
}

/**
 * The inline warning under the Industry field for an industry that fits the file poorly (lowFitOf,
 * industryFit.ts): how many columns it explains (or, outside the top matches, its score at most),
 * with the rest of the reason behind the ⓘ, and a one-click switch to the general dashboard. The
 * choice stays the user's: Next works as before.
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

const KIND_ICON = { number: Hash, date: Calendar, string: Type, boolean: ToggleLeft } as const;

/**
 * Every column header of the file, with the kind of values it holds, how Loupe reads it and what is
 * in it (step 2). "Read as" names the same kinds as the chips in AboutData, with Loupe's reason on
 * hover or focus; a column hidden from the analysis says so; without a reading, the profiled role.
 */
function ColumnsInFile() {
  const profile = useWorkspace((s) => s.profile);
  const understanding = useWorkspace((s) => s.understanding);
  const hidden = useWorkspace((s) => s.hiddenColumns);
  // Subscribed, so the summaries follow a change of the number format.
  const locale = useSettings((s) => s.numberLocale);
  if (!profile) return null;
  const read = new Map(understanding?.columns.map((c) => [c.name, c]) ?? []);
  return (
    <Card className="mt-5 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-2 px-6 pt-5 pb-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-fg">
            <Columns3 className="size-4 text-accent" aria-hidden /> Columns in your file
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            <Brief
              label="About this table"
              full={`${
                profile.columns.length === 1
                  ? "1 column header, read from its values."
                  : `${profile.columns.length} column headers, each read from its values.`
              } Next, check the data itself row by row.`}
            >
              {profile.columns.length === 1
                ? "1 column header, read from its values."
                : `${profile.columns.length} column headers, each read from its values.`}
            </Brief>
          </p>
        </div>
      </div>
      {/* A named, focusable region: the table scrolls sideways on narrow screens, and keyboards can scroll it too. */}
      <div
        className="overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
        tabIndex={0}
        role="region"
        aria-label="Columns in your file"
      >
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-ui">
          <thead className="bg-surface-2 text-left text-fg-muted">
            <tr>
              {["#", "Column header", "Holds", "Read as", "In your data"].map((h) => (
                <th key={h} scope="col" className="border-y border-border px-4 py-2 text-xs font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {profile.columns.map((c, i) => {
              const Icon = c.role === "time" ? Clock : KIND_ICON[c.storage];
              const reading = read.get(c.name);
              const off = !reading && hidden.includes(c.name);
              const label = reading ? KIND_LABEL[reading.kind] : off ? "Hidden" : ROLE_LABEL[c.role];
              const why = reading
                ? reading.why
                : off
                  ? "Hidden: kept in your file, but nothing computes from it."
                  : c.roleReason;
              return (
                <tr key={c.name} className="hover:bg-surface-hover">
                  <td className="font-figures border-b border-border-subtle px-4 py-2 text-xs text-fg-subtle">
                    {i + 1}
                  </td>
                  <td className="border-b border-border-subtle px-4 py-2 font-medium text-fg">{c.name}</td>
                  <td className="border-b border-border-subtle px-4 py-2 text-fg-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon className="size-3.5 text-fg-subtle" aria-hidden /> {kindLabel(c)}
                    </span>
                  </td>
                  <td className="border-b border-border-subtle px-4 py-2">
                    <Tooltip content={why}>
                      {/* Focusable, so the reason opens from the keyboard too. */}
                      <span
                        tabIndex={0}
                        className={cn(
                          "cursor-default rounded-xs focus-visible:focus-ring",
                          off ? "text-fg-subtle" : "text-fg",
                        )}
                      >
                        {label}
                      </span>
                    </Tooltip>
                  </td>
                  <td className="font-data max-w-[420px] border-b border-border-subtle px-4 py-2 text-xs leading-relaxed text-fg-muted">
                    <ClampText lines={2}>{dataSummary(c, locale)}</ClampText>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
