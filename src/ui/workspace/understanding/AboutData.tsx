"use client";

/**
 * The story Detect tells about the data (version 49.0; in chapters since
 * 50.2): what Loupe read the table to be before anything is designed from
 * it. After the opening card each chapter is a flow/Chapter (an eyebrow, a
 * heading, its content), so the page reads as one account; the industry
 * chapter, a label on this reading, is DetectStep's.
 *
 * - AboutHero, "What this data is about": one card with the title an analyst
 *   would give the dashboard ("Wine quality analysis"), what one row is, a
 *   band of four figures (rows, columns, the dates the rows span, what the
 *   table is measured by) and two to four plain sentences, clamped to two
 *   lines with the rest on hover, focus or a long press (ClampText, version
 *   47.0's rule).
 * - OutcomeChapter: the outcome select at the end of the heading row
 *   (Loupe's choice, the other candidates and "No outcome"), its reason under
 *   the heading, and what moves it: the strongest drivers, each with its
 *   statistic and a strength bar, its sentence behind it (Brief). A change
 *   goes to the store's setOutcome, which reads the table again (or rebuilds
 *   the analysis once it is built), so the drivers follow it.
 * - ColumnsChapter: the columns grouped by kind as chips; each chip's menu
 *   reads the column as another kind ("Read as …"), through roleForKind and
 *   setRoleOverride. The outcome is set only by the select. A wide table
 *   folds each group to a few chips, with "Show all N columns".
 * - IssuesChapter, "Before you continue": up to three data issues, each with
 *   Review (to Check & map), or one line saying none were found.
 *
 * Every figure is the engine's (engine/understand, the health report);
 * aboutWords.ts words it.
 */
import * as React from "react";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Info,
  Loader2,
  RotateCcw,
} from "lucide-react";
import type { ColumnUnderstanding, DataUnderstanding, Driver } from "@/engine/understand/types";
import { KIND_LABEL, roleForKind } from "@/engine/understand/kinds";
import { formatCount, type NumberLocale } from "@/engine/core/format";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { Card } from "@/ui/primitives/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/primitives/dropdown-menu";
import { Brief, ClampText, InfoTip } from "@/ui/primitives/reveal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/ui/primitives/select";
import { Chapter } from "../flow/Chapter";
import {
  DRIVERS_SHOWN,
  FOLD_ABOVE,
  FOLDED_PER_GROUP,
  OUTCOME_TYPE_LABEL,
  dateTile,
  directionWords,
  groupColumns,
  issueRows,
  kindsLine,
  noProblemsLine,
  outcomeFromValue,
  outcomeOptions,
  outcomeValue,
  readAsKinds,
  statLabel,
  strengthPct,
  type IssueRow,
} from "./aboutWords";

/** A correction is being read (Detect) or built (once the analysis exists). */
const useBusy = () => useWorkspace((s) => s.understandingPending || s.configuring);

/**
 * "What this data is about", the story's opening: one card with the title, what one row is, a band
 * of four figures (rows, columns, the dates, what it is measured by) and the sentences.
 */
export function AboutHero() {
  const u = useWorkspace((s) => s.understanding);
  const columns = useWorkspace((s) => s.summary?.columnCount);
  const hidden = useWorkspace((s) => s.hiddenColumns.length);
  const busy = useBusy();
  const locale = useSettings((s) => s.numberLocale);
  const titleId = React.useId();
  if (!u || columns === undefined) return null;
  const sentences = u.sentences.join(" ");
  const span = dateTile(u.time);
  const kinds = kindsLine(u.columns);
  return (
    <section aria-labelledby={titleId} aria-busy={busy || undefined}>
      <Card className="overflow-hidden">
        <div className="px-5 pt-6 pb-5 md:px-6">
          <p className="eyebrow flex items-center gap-2 text-fg-subtle">
            What this data is about
            {/* The section is aria-busy meanwhile; the spinner is only for the eye. */}
            {busy ? <Loader2 className="size-3 animate-spin text-accent" aria-hidden /> : null}
          </p>
          <h2 id={titleId} className="mt-2 font-display text-display-xs text-balance text-fg">
            {u.title}
          </h2>
          <p className="mt-1 text-md text-fg-muted">{u.subject.rowMeaning}</p>
        </div>
        {/* A band of figures across the card: four in a row from lg, two by two below it. */}
        {/* The dates and the outcome take more of the row than the two counts, so a range stays on one line. */}
        <dl className="grid grid-cols-2 border-y border-border-subtle lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.2fr)]">
          <Figure
            label="Rows"
            value={formatCount(u.subject.rows, locale)}
            caption={u.subject.plural}
            figure
          />
          <Figure
            label="Columns"
            value={formatCount(columns, locale)}
            caption={hidden ? `${kinds} · ${formatCount(hidden, locale)} hidden` : kinds}
            figure
            className="border-l border-border-subtle"
          />
          <Figure
            label="Dates"
            value={span ? keepDates(span.value) : "No dates"}
            caption={span?.caption ?? "No date column found"}
            quiet={!span}
            className="border-border-subtle max-lg:border-t lg:border-l"
          />
          <Figure
            label="Measured by"
            value={u.outcome?.column ?? "No outcome"}
            caption={u.outcome ? OUTCOME_TYPE_LABEL[u.outcome.type] : "Designed from its shape"}
            quiet={!u.outcome}
            className="border-l border-border-subtle max-lg:border-t"
          />
        </dl>
        {sentences ? (
          <div className="px-5 py-5 md:px-6">
            <ClampText key={sentences} lines={2} className="max-w-4xl text-sm text-fg-muted">
              {sentences}
            </ClampText>
          </div>
        ) : null}
      </Card>
    </section>
  );
}

/** "Oct 2024 – Sep 2026" breaks only at the dash: each date's month and year stay together. */
const keepDates = (range: string) =>
  range
    .split(" – ")
    .map((d) => d.replace(/ /g, "\u00a0"))
    .join(" – ");

/** One figure of the overview's band: a label, the value and a short caption. */
function Figure({
  label,
  value,
  caption,
  figure = false,
  quiet = false,
  className,
}: {
  label: string;
  value: string;
  caption: string;
  /** A count, set in the figures face. */
  figure?: boolean;
  /** Nothing to show (no dates, no outcome): the value in the muted ink. */
  quiet?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col px-5 py-4 md:px-6", className)}>
      <dt className="eyebrow text-fg-subtle">{label}</dt>
      <dd
        className={cn(
          "mt-1.5 text-xl font-semibold break-words",
          figure && "font-figures",
          quiet ? "text-fg-muted" : "text-fg",
        )}
      >
        {value}
      </dd>
      <dd className="mt-auto min-w-0 pt-0.5 text-xs text-fg-muted">
        <ClampText>{caption}</ClampText>
      </dd>
    </div>
  );
}

/** "What moves <outcome>": the outcome select and its reason, then the drivers. */
export function OutcomeChapter() {
  const u = useWorkspace((s) => s.understanding);
  const busy = useBusy();
  const locale = useSettings((s) => s.numberLocale);
  if (!u) return null;
  const outcome = u.outcome?.column ?? null;
  return (
    <Chapter
      eyebrow="Outcome"
      title={outcome ? `What moves ${outcome}` : "What it's measured by"}
      tip={
        outcome ? (
          <InfoTip label="About the drivers">
            How strongly each column moves with {outcome}, strongest first: r is a correlation between two
            numbers, η compares {outcome}&apos;s average across a column&apos;s groups, and V is the
            association between two sets of categories.
          </InfoTip>
        ) : null
      }
      sub={
        u.outcome ? (
          <ClampText key={u.outcome.why}>{u.outcome.why}</ClampText>
        ) : (
          <Brief
            label="About no outcome"
            full="With no outcome the dashboard is designed from the table's shape: its totals, trends and breakdowns. Pick a column with “Measured by” if the table is measured by one."
          >
            No outcome: designed from the table&apos;s shape.
          </Brief>
        )
      }
      aside={<OutcomePicker u={u} />}
      busy={busy}
    >
      <Card className={cn("p-5 transition-opacity duration-base md:p-6", busy && "opacity-60")}>
        <Drivers u={u} locale={locale} />
      </Card>
    </Chapter>
  );
}

/**
 * The outcome select: Loupe's choice, the other candidates and "No outcome",
 * with the kind of outcome beside it.
 */
function OutcomePicker({ u }: { u: DataUnderstanding }) {
  const chosen = useWorkspace((s) => s.outcome);
  const remembered = useWorkspace((s) => s.outcomeChoices);
  const setOutcome = useWorkspace((s) => s.setOutcome);
  const id = React.useId();
  const options = outcomeOptions(u, chosen, remembered);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor={id} className="shrink-0 text-ui text-fg-muted">
        Measured by
      </label>
      <Select value={outcomeValue(chosen)} onValueChange={(v) => setOutcome(outcomeFromValue(v))}>
        <SelectTrigger id={id} size="sm" className="w-44 min-w-0 sm:w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} hint={o.hint}>
              {o.label}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value="none">No outcome</SelectItem>
        </SelectContent>
      </Select>
      {u.outcome ? (
        <Badge tone="neutral" className="shrink-0">
          {OUTCOME_TYPE_LABEL[u.outcome.type]}
        </Badge>
      ) : null}
    </div>
  );
}

/** What moves the outcome: the strongest drivers, each with its statistic, a strength bar and its sentence. */
function Drivers({ u, locale }: { u: DataUnderstanding; locale: NumberLocale }) {
  const outcome = u.outcome?.column ?? null;
  const top = u.drivers.slice(0, DRIVERS_SHOWN);
  if (!outcome)
    return <p className="text-sm text-fg-muted">Choose an outcome to see which columns move it.</p>;
  if (!top.length)
    return <p className="text-sm text-fg-muted">No other column moves {outcome} noticeably.</p>;
  return (
    <ol className="grid gap-4" aria-label={`What moves ${outcome}, strongest first`}>
      {top.map((d) => (
        <DriverRow key={d.column} driver={d} outcome={outcome} locale={locale} />
      ))}
    </ol>
  );
}

/** One driver: its name (the sentence behind it), the strength bar and the statistic; stacked on a phone. */
function DriverRow({
  driver: d,
  outcome,
  locale,
}: {
  driver: Driver;
  outcome: string;
  locale: NumberLocale;
}) {
  const Arrow = d.direction === "up" ? ArrowUpRight : d.direction === "down" ? ArrowDownRight : null;
  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_6rem]">
      <p className="min-w-0 text-ui break-words text-fg">
        <Brief full={d.sentence} label={`How ${d.column} moves with ${outcome}`}>
          <span className="font-medium">{d.column}</span>
        </Brief>
      </p>
      {/* After the statistic on a phone (a row of its own); between the name and it from md. */}
      <div
        aria-hidden
        className="order-last col-span-2 h-2 overflow-hidden rounded-full bg-surface-3 md:order-none md:col-span-1"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-slow ease-out-quint"
          style={{ width: `${strengthPct(d.strength)}%` }}
        />
      </div>
      <p className="tabular inline-flex items-center justify-end gap-1 text-xs text-fg-muted">
        {Arrow ? <Arrow className="size-3.5 text-fg-subtle" aria-hidden /> : null}
        <span className="sr-only">{directionWords(d, outcome)}, </span>
        {statLabel(d, locale)}
      </p>
    </li>
  );
}

/** "How each column is read": the columns grouped by kind, each chip opening its "Read as …" menu. */
export function ColumnsChapter() {
  const u = useWorkspace((s) => s.understanding);
  const busy = useBusy();
  if (!u) return null;
  return <ColumnKinds u={u} busy={busy} />;
}

/**
 * The columns grouped by kind as chips, folded on a wide table, each chip opening its "Read as …"
 * menu. Focus is kept where the keyboard was: "+N more" hands it to the first chip it reveals, and a
 * chip read as another kind moves to its new group once the table is read again, so focus follows it.
 */
function ColumnKinds({ u, busy }: { u: DataUnderstanding; busy: boolean }) {
  const [all, setAll] = React.useState(false);
  const listId = React.useId();
  const list = React.useRef<HTMLDListElement>(null);
  // The group whose "+N more" was pressed, and the column just read as another kind.
  const revealed = React.useRef<string | null>(null);
  const moved = React.useRef<string | null>(null);
  const chips = () => [...(list.current?.querySelectorAll<HTMLElement>("[data-column]") ?? [])];
  React.useEffect(() => {
    const kind = revealed.current;
    revealed.current = null;
    if (!kind || !all) return;
    chips()
      .filter((el) => el.dataset.kind === kind)
      [FOLDED_PER_GROUP]?.focus();
  }, [all]);
  React.useEffect(() => {
    const name = moved.current;
    moved.current = null;
    // Only when its chip left the page with the focus on it (it moved to another group).
    if (!name || (document.activeElement && document.activeElement !== document.body)) return;
    chips()
      .find((el) => el.dataset.column === name)
      ?.focus();
  }, [u]);
  const total = u.columns.length;
  const folds = total > FOLD_ABOVE;
  const groups = groupColumns(u.columns, folds && !all ? FOLDED_PER_GROUP : Infinity);
  return (
    <Chapter
      eyebrow="Columns"
      title="How each column is read"
      sub={
        <Brief
          label="About the column kinds"
          full="How Loupe reads each column, from its values. Open one to read it as another kind; everything built from it follows."
        >
          Open one to read it as another kind.
        </Brief>
      }
      aside={
        folds ? (
          <button
            type="button"
            aria-expanded={all}
            aria-controls={listId}
            onClick={() => setAll((v) => !v)}
            className="inline-flex min-h-6 items-center gap-1 rounded-xs text-ui font-medium text-accent-text hover:underline focus-visible:focus-ring"
          >
            {all ? "Show fewer" : `Show all ${total} columns`}
            <ChevronDown
              className={cn("size-3.5 transition-transform duration-base", all && "rotate-180")}
              aria-hidden
            />
          </button>
        ) : null
      }
      busy={busy}
    >
      <Card className="px-5 py-2 md:px-6">
        <dl id={listId} ref={list} className="divide-y divide-border-subtle">
          {groups.map((g) => (
            <div
              key={g.kind}
              className="grid gap-x-6 gap-y-2 py-3.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start"
            >
              <dt className="text-ui font-medium text-fg sm:pt-1">
                {g.label}{" "}
                <span className="tabular font-normal text-fg-subtle">{g.columns.length + g.more}</span>
              </dt>
              <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
                {g.columns.map((c) => (
                  <KindChip
                    key={c.name}
                    column={c}
                    onCorrect={() => {
                      moved.current = c.name;
                    }}
                  />
                ))}
                {g.more ? (
                  <button
                    type="button"
                    aria-label={`+${g.more} more ${g.label.toLowerCase()}`}
                    onClick={() => {
                      revealed.current = g.kind;
                      setAll(true);
                    }}
                    className="tabular h-7 rounded-full px-2 text-xs text-fg-subtle hover:text-fg focus-visible:focus-ring"
                  >
                    +{g.more} more
                  </button>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </Chapter>
  );
}

/**
 * One column as a chip. Its menu says why Loupe reads it so, and reads it as
 * another kind (the role override the kind stands for); a column the user
 * set shows a dot and offers Loupe's reading back. The outcome's chip points
 * to the select instead.
 */
function KindChip({ column, onCorrect }: { column: ColumnUnderstanding; onCorrect: () => void }) {
  const override = useWorkspace((s) => s.roleOverrides[column.name]);
  const setRole = useWorkspace((s) => s.setRoleOverride);
  const whyId = React.useId();
  const outcome = column.kind === "outcome";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-column={column.name}
          data-kind={column.kind}
          aria-label={`${column.name}: ${KIND_LABEL[column.kind]}${override ? ", set by you" : ""}`}
          className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface-2 pr-2 pl-3 text-xs text-fg transition-colors duration-fast hover:border-border-hover hover:bg-surface-hover focus-visible:focus-ring data-[state=open]:border-border-hover data-[state=open]:bg-surface-hover"
        >
          <span className="truncate font-medium">{column.name}</span>
          {override ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
          <ChevronDown className="size-3 shrink-0 text-fg-subtle" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      {/* Held to the room the screen has (a phone has little above or below a chip); it scrolls inside. */}
      <DropdownMenuContent
        align="start"
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-64 overflow-y-auto"
        aria-describedby={whyId}
      >
        {/* The whole name (the chip may cut a long one) and why Loupe reads it so. */}
        <p className="px-2 pt-1.5 text-ui font-medium break-words text-fg">{column.name}</p>
        <p id={whyId} className="px-2 pt-0.5 pb-2 text-xs text-fg-muted">
          {column.why}
        </p>
        <DropdownMenuSeparator />
        {outcome ? (
          <p className="px-2 py-1.5 text-xs text-fg-muted">
            The outcome. Choose another with &ldquo;Measured by&rdquo;.
          </p>
        ) : (
          <>
            <DropdownMenuLabel>Read as</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={column.kind}
              onValueChange={(v) => {
                const kind = readAsKinds(column.kind).find((k) => k.kind === v && k.settable)?.kind;
                const o = kind ? roleForKind(kind) : null;
                if (!o) return;
                onCorrect();
                setRole(column.name, o.role, o.additivity, o.kind);
              }}
            >
              {readAsKinds(column.kind).map((k) => (
                <DropdownMenuRadioItem key={k.kind} value={k.kind} disabled={!k.settable}>
                  {k.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {override ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    onCorrect();
                    setRole(column.name, null);
                  }}
                >
                  <RotateCcw aria-hidden /> Back to Loupe&apos;s reading
                </DropdownMenuItem>
              </>
            ) : null}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SEVERITY: Record<
  IssueRow["severity"],
  { icon: typeof AlertTriangle; tint: string; ink: string; label: string }
> = {
  critical: { icon: AlertOctagon, tint: "bg-danger-soft", ink: "text-danger", label: "Problem" },
  warning: { icon: AlertTriangle, tint: "bg-warning-soft", ink: "text-warning", label: "Worth a look" },
  info: { icon: Info, tint: "bg-info-soft", ink: "text-info", label: "Note" },
};

/**
 * "Before you continue": the reading's data issues (at most three), each with Review, which opens
 * Check & map; or one line saying nothing was found.
 */
export function IssuesChapter({ onReview, disabled }: { onReview: () => void; disabled?: boolean }) {
  const u = useWorkspace((s) => s.understanding);
  const health = useWorkspace((s) => s.health);
  const locale = useSettings((s) => s.numberLocale);
  if (!u) return null;
  const rows = issueRows(u.issues, health?.issues ?? []);
  return (
    <Chapter
      eyebrow="Data health"
      title="Before you continue"
      sub={rows.length ? "Each one can be checked in Check & map." : undefined}
    >
      <Card className="divide-y divide-border-subtle">
        {rows.length ? (
          rows.map((r) => {
            const s = SEVERITY[r.severity];
            return (
              <div key={r.title} className="flex min-w-0 items-center gap-3 px-4 py-3.5 md:px-5">
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", s.tint)}>
                  <s.icon className={cn("size-4", s.ink)} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-words text-fg">
                    <span className="sr-only">{s.label}: </span>
                    {r.title}
                  </p>
                  {r.detail ? <ClampText className="text-xs text-fg-muted">{r.detail}</ClampText> : null}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onClick={onReview}
                  aria-label={`Review ${r.title} in Check & map`}
                >
                  Review
                </Button>
              </div>
            );
          })
        ) : (
          <p className="flex items-center gap-3 px-4 py-3.5 text-sm text-fg md:px-5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-success-soft">
              <CheckCircle2 className="size-4 text-success" aria-hidden />
            </span>
            {noProblemsLine(u.subject.rows, locale)}
          </p>
        )}
      </Card>
    </Chapter>
  );
}
