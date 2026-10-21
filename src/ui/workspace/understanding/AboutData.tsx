"use client";

/**
 * "What this data is about" (version 49.0): the top of the Detect step, where
 * Loupe says what it read the table to be before anything is designed from
 * it. The industry choice follows it.
 *
 * - The title an analyst would give the dashboard ("Wine quality analysis"),
 *   what one row is with the counts and dates, and two to four plain
 *   sentences, clamped to two lines with the rest on hover, focus or a long
 *   press (ClampText, version 47.0's rule: less text on screen).
 * - The outcome the table is measured by, in a compact select: Loupe's choice,
 *   the other candidates and "No outcome". A change goes to the store's
 *   setOutcome, which reads the table again (or rebuilds the analysis once
 *   it is built), so the drivers follow it.
 * - What moves the outcome: the strongest drivers, each with its statistic
 *   and a strength bar, its sentence with the figures behind it (Brief).
 * - The columns grouped by kind as chips; each chip's menu reads the column
 *   as another kind ("Read as …"), through roleForKind and setRoleOverride.
 *   The outcome is set only by the select. A wide table folds each group to
 *   a few chips, with "Show all N columns".
 * - Up to three data issues, in the warning tokens.
 * - The industry as a label: its match and how many columns it explains,
 *   in the warning tone when too few for its template to lead. The cards
 *   below (DetectStep) hold its evidence and the choice itself.
 *
 * Every figure is the engine's (engine/understand); aboutWords.ts words it.
 */
import * as React from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronDown, Loader2, RotateCcw } from "lucide-react";
import type { ColumnUnderstanding, DataUnderstanding, Driver } from "@/engine/understand/types";
import { KIND_LABEL, roleForKind } from "@/engine/understand/kinds";
import type { NumberLocale } from "@/engine/core/format";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { cn } from "@/lib/utils";
import { DomainIcon } from "@/ui/common/domain-icon";
import { Badge } from "@/ui/primitives/badge";
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
import {
  DRIVERS_SHOWN,
  FOLD_ABOVE,
  FOLDED_PER_GROUP,
  OUTCOME_TYPE_LABEL,
  directionWords,
  groupColumns,
  industryWords,
  outcomeFromValue,
  outcomeOptions,
  outcomeValue,
  readAsKinds,
  rowLine,
  statLabel,
  strengthPct,
} from "./aboutWords";

export function AboutData({ className }: { className?: string }) {
  const u = useWorkspace((s) => s.understanding);
  const columns = useWorkspace((s) => s.summary?.columnCount);
  // A correction is being read (Detect) or built (once the analysis exists).
  const busy = useWorkspace((s) => s.understandingPending || s.configuring);
  const locale = useSettings((s) => s.numberLocale);
  const titleId = React.useId();
  if (!u || columns === undefined) return null;
  const sentences = u.sentences.join(" ");
  return (
    <Card role="region" aria-labelledby={titleId} aria-busy={busy} className={cn("p-5 md:p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-[1_1_22rem]">
          <p className="eyebrow flex items-center gap-2 text-fg-subtle">
            What this data is about
            {/* The region is aria-busy meanwhile; the spinner is only for the eye. */}
            {busy ? <Loader2 className="size-3 animate-spin text-accent" aria-hidden /> : null}
          </p>
          <h2 id={titleId} className="mt-2 font-display text-display-xs text-fg">
            {u.title}
          </h2>
          <p className="tabular mt-1 text-sm text-fg-muted">{rowLine(u, columns, locale)}</p>
          {sentences ? (
            <ClampText key={sentences} lines={2} className="mt-2 max-w-3xl text-sm text-fg">
              {sentences}
            </ClampText>
          ) : null}
        </div>
        <IndustryTag u={u} locale={locale} />
      </div>

      <div className="mt-5 grid gap-x-8 gap-y-5 border-t border-border-subtle pt-5 lg:grid-cols-12">
        <OutcomePicker u={u} className="lg:col-span-5" />
        <Drivers u={u} locale={locale} busy={busy} className="lg:col-span-7 lg:row-span-2" />
        <Issues issues={u.issues} className="lg:col-span-5 lg:self-start" />
      </div>

      <ColumnKinds u={u} className="mt-5 border-t border-border-subtle pt-5" />
    </Card>
  );
}

/**
 * The industry as a label on the reading: its name and icon, its match and
 * the columns it explains (warning tone when too few for it to lead), and
 * why behind the ⓘ.
 */
function IndustryTag({ u, locale }: { u: DataUnderstanding; locale: NumberLocale }) {
  const domainId = useWorkspace((s) => s.domainId);
  const domains = useWorkspace((s) => s.domains);
  const words = industryWords(u.industry, domainId, locale);
  const icon =
    u.industry && domainId !== "generic" ? domains.find((d) => d.id === u.industry?.id)?.icon : undefined;
  return (
    <div
      className={cn(
        "flex max-w-full min-w-0 items-start gap-2.5 rounded-control border px-3 py-2.5",
        words.weak ? "border-warning-border bg-warning-soft" : "border-border",
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-control border border-border-accent bg-accent-soft">
        <DomainIcon name={icon ?? "table"} className="size-4 text-accent" />
      </span>
      <div className="min-w-0">
        <p className="eyebrow text-fg-subtle">Industry</p>
        <p className="flex min-w-0 items-center gap-1 text-ui font-medium text-fg">
          <span className="truncate">{words.name}</span>
          <InfoTip label="About the industry">{words.full}</InfoTip>
        </p>
        <p className={cn("tabular text-xs", words.weak ? "text-warning-text" : "text-fg-muted")}>
          {words.detail}
        </p>
      </div>
    </div>
  );
}

/**
 * The outcome select: Loupe's choice, the other candidates and "No outcome",
 * with the kind of outcome beside it and the reason it was chosen below.
 */
function OutcomePicker({ u, className }: { u: DataUnderstanding; className?: string }) {
  const chosen = useWorkspace((s) => s.outcome);
  const remembered = useWorkspace((s) => s.outcomeChoices);
  const setOutcome = useWorkspace((s) => s.setOutcome);
  const id = React.useId();
  const options = outcomeOptions(u, chosen, remembered);
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={id} className="eyebrow block text-fg-subtle">
        Measured by
      </label>
      <div className="mt-2 flex min-w-0 items-center gap-2">
        <Select value={outcomeValue(chosen)} onValueChange={(v) => setOutcome(outcomeFromValue(v))}>
          <SelectTrigger id={id} size="sm" className="w-full max-w-64 min-w-0">
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
      {u.outcome ? (
        <ClampText key={u.outcome.why} className="mt-2 text-xs text-fg-muted">
          {u.outcome.why}
        </ClampText>
      ) : (
        <p className="mt-2 text-xs text-fg-muted">
          <Brief
            label="About no outcome"
            full="With no outcome the dashboard is designed from the table's shape: its totals, trends and breakdowns. Pick a column above if the table is measured by one."
          >
            No outcome: designed from the table&apos;s shape.
          </Brief>
        </p>
      )}
    </div>
  );
}

/** What moves the outcome: the strongest drivers, each with its statistic, a strength bar and its sentence. */
function Drivers({
  u,
  locale,
  busy,
  className,
}: {
  u: DataUnderstanding;
  locale: NumberLocale;
  busy: boolean;
  className?: string;
}) {
  const outcome = u.outcome?.column ?? null;
  const top = u.drivers.slice(0, DRIVERS_SHOWN);
  return (
    <div className={cn("min-w-0 transition-opacity duration-base", busy && "opacity-60", className)}>
      <p className="eyebrow text-fg-subtle">{outcome ? `What moves ${outcome}` : "What moves it"}</p>
      {!outcome ? (
        <p className="mt-2 text-sm text-fg-muted">Choose an outcome to see which columns move it.</p>
      ) : !top.length ? (
        <p className="mt-2 text-sm text-fg-muted">No other column moves {outcome} noticeably.</p>
      ) : (
        <ol className="mt-2.5 grid gap-3" aria-label={`What moves ${outcome}, strongest first`}>
          {top.map((d) => (
            <DriverRow key={d.column} driver={d} outcome={outcome} locale={locale} />
          ))}
        </ol>
      )}
    </div>
  );
}

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
    <li className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-ui break-words text-fg">
          <Brief full={d.sentence} label={`How ${d.column} moves with ${outcome}`}>
            <span className="font-medium">{d.column}</span>
          </Brief>
        </p>
        <p className="tabular inline-flex shrink-0 items-center gap-1 text-xs text-fg-muted">
          {Arrow ? <Arrow className="size-3.5 text-fg-subtle" aria-hidden /> : null}
          <span className="sr-only">{directionWords(d, outcome)}, </span>
          {statLabel(d, locale)}
        </p>
      </div>
      <div aria-hidden className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-slow ease-out-quint"
          style={{ width: `${strengthPct(d.strength)}%` }}
        />
      </div>
    </li>
  );
}

/** Up to three data issues in plain words, each one line with the whole sentence behind it. */
function Issues({ issues, className }: { issues: readonly string[]; className?: string }) {
  if (!issues.length) return null;
  return (
    <div
      role="note"
      aria-label="Data issues"
      className={cn(
        "grid min-w-0 gap-1.5 rounded-control border border-warning-border bg-warning-soft px-3 py-2.5",
        className,
      )}
    >
      {issues.slice(0, 3).map((issue) => (
        <p key={issue} className="flex min-w-0 items-start gap-2 text-sm text-fg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <ClampText className="min-w-0 flex-1">{issue}</ClampText>
        </p>
      ))}
    </div>
  );
}

/**
 * The columns grouped by kind as chips, folded on a wide table, each chip opening its "Read as …"
 * menu. Focus is kept where the keyboard was: "+N more" hands it to the first chip it reveals, and a
 * chip read as another kind moves to its new group once the table is read again, so focus follows it.
 */
function ColumnKinds({ u, className }: { u: DataUnderstanding; className?: string }) {
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
    <div className={cn("min-w-0", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="flex items-center gap-1.5">
          <span className="eyebrow text-fg-subtle">Columns by kind</span>
          <InfoTip label="About the column kinds">
            How Loupe reads each column. Open one to read it as another kind; what is built from it follows.
          </InfoTip>
        </p>
        {folds ? (
          <button
            type="button"
            aria-expanded={all}
            aria-controls={listId}
            onClick={() => setAll((v) => !v)}
            className="rounded-xs text-ui text-accent-text underline-offset-2 hover:underline focus-visible:focus-ring"
          >
            {all ? "Show fewer" : `Show all ${total} columns`}
          </button>
        ) : null}
      </div>
      <dl id={listId} ref={list} className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
        {groups.map((g) => (
          <React.Fragment key={g.kind}>
            <dt className="text-xs font-medium text-fg-muted sm:pt-1.5">
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
          </React.Fragment>
        ))}
      </dl>
    </div>
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
          className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border-strong bg-surface-2 pr-2 pl-3 text-xs text-fg transition-colors duration-fast hover:border-border-hover hover:bg-surface-hover focus-visible:focus-ring data-[state=open]:border-border-hover data-[state=open]:bg-surface-hover"
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
