"use client";

/**
 * Data health and parse details. HealthPanel shows the 0–100 score, passed
 * checks and fixable issues. ParseReportPanel shows encoding, delimiter, the
 * header's line (or sheet row) and how each date column was read (DD/MM or
 * MM/DD, with the evidence), plus DateOrderSwitch, which re-reads the file
 * with the other order: straight away when nothing proves the order (no date
 * is lost either way), after a yes that says how many dates would become
 * blank when the order is proven or contested. The user's settings are kept
 * across the re-read.
 */
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { HealthReport } from "@/engine/profile/quality";
import type { DateFormatDecision, ParseReport } from "@/engine/core/types";
import { formatBytes, formatCount, type NumberLocale } from "@/engine/core/format";
import { blanksIfSwitched } from "@/engine/parse/dateOrder";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { countOf, ordinal } from "@/ui/common/words";
import { ConfidenceRing } from "./ConfidenceRing";
import { askConfirm } from "./confirm";

const SEVERITY = {
  critical: { icon: XCircle, tone: "text-danger", label: "Critical" },
  warning: { icon: AlertTriangle, tone: "text-warning", label: "Warning" },
  info: { icon: Info, tone: "text-info", label: "Note" },
} as const;

export function HealthPanel({ health, compact = false }: { health: HealthReport; compact?: boolean }) {
  return (
    <div className="grid gap-5 md:grid-cols-[auto_1fr]">
      <div className="flex flex-col items-center gap-3">
        <ConfidenceRing value={health.score} size={compact ? 96 : 128} label="health" />
        <Badge tone={health.score >= 90 ? "success" : health.score >= 75 ? "accent" : "warning"} size="md">
          {health.grade}
        </Badge>
      </div>
      <div className="min-w-0">
        <p className="text-sm text-fg">{health.summary}</p>
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {health.checks.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-ui">
              {c.passed ? (
                <CheckCircle2 className="size-3.5 text-success" aria-hidden />
              ) : (
                <AlertTriangle className="size-3.5 text-warning" aria-hidden />
              )}
              <span className={c.passed ? "text-fg-muted" : "text-fg"}>{c.label}</span>
              <span className="sr-only">{c.passed ? "passed" : "needs review"}</span>
            </li>
          ))}
        </ul>
        {health.issues.length ? (
          <ul className="mt-4 divide-y divide-border rounded-card border border-border">
            {health.issues.slice(0, compact ? 4 : 30).map((i) => {
              const s = SEVERITY[i.severity];
              return (
                <li key={i.id} className="flex gap-3 px-3.5 py-2.5">
                  <s.icon className={cn("mt-0.5 size-4 shrink-0", s.tone)} aria-hidden />
                  <div className="min-w-0">
                    <p className="text-ui font-medium text-fg">
                      <span className="sr-only">{s.label}: </span>
                      {i.title}
                    </p>
                    <p className="mt-0.5 text-ui leading-relaxed text-fg-muted">{i.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Re-reads the file with the other day/month order for one column. When some
 * dates exist only in the order chosen (13/05/2019 has no 13th month), it
 * first says how many would become blank and asks.
 */
export async function switchDateOrder(d: DateFormatDecision, locale: NumberLocale): Promise<void> {
  if (!d.alternative) return;
  const s = useWorkspace.getState();
  const blanks = blanksIfSwitched(d) ?? 0;
  if (blanks > 0) {
    const col = s.profile?.columns.find((c) => c.name === d.column);
    const filled = col ? (s.profile?.rowCount ?? 0) - col.nullCount : 0;
    const share = filled
      ? ` (${Math.round((blanks / filled) * 100)}% of ${formatCount(filled, locale)})`
      : "";
    const ok = await askConfirm({
      title: `Read “${d.column}” as ${d.alternative}?`,
      body: `${countOf(blanks, "date", locale)}${share} can only be ${d.format}: read as ${d.alternative} they are not real dates, so they would become blank.`,
      note: "The file is read again; your industry, mappings, hidden columns, KPIs and charts are kept.",
      confirmLabel: `Switch and blank ${countOf(blanks, "date", locale)}`,
      cancelLabel: `Keep ${d.format}`,
      tone: "danger",
    });
    if (!ok) return;
  }
  await s.setDateOrder(d.column, d.alternative.startsWith("MM") ? "MDY" : "DMY");
}

/** The button for switchDateOrder; nothing when the file can't be read again (a demo) or there is no other order. */
export function DateOrderSwitch({
  decision,
  className,
}: {
  decision: DateFormatDecision;
  className?: string;
}) {
  const canReload = useWorkspace((s) => Boolean(s.lastFile));
  const busy = useWorkspace((s) => Boolean(s.loading));
  const locale = useSettings((s) => s.numberLocale);
  if (!decision.alternative || !canReload) return null;
  const costly = (blanksIfSwitched(decision) ?? 0) > 0;
  return (
    <Button
      size="xs"
      variant={costly ? "ghost" : "outline"}
      className={className}
      disabled={busy}
      onClick={() => void switchDateOrder(decision, locale)}
    >
      Use {decision.alternative}
      {costly ? "…" : ""}
    </Button>
  );
}

/** Where the header was found, as the user would look for it: a line of a text file, a row of a sheet. */
function headerPlace(report: ParseReport): string {
  if (!report.headerDetected) return "None detected";
  if (report.kind === "json") return "Keys of each record";
  if (report.kind === "sample" || report.kind === "derived") return "Built in";
  return report.kind === "csv" || report.kind === "tsv"
    ? `Line ${report.headerRowIndex + 1}`
    : `Row ${report.headerRowIndex + 1}`;
}

export function ParseReportPanel({
  report,
  timings,
}: {
  report: ParseReport;
  timings: Record<string, number>;
}) {
  const locale = useSettings((s) => s.numberLocale);
  const facts: Array<[string, string]> = [
    ["File", report.fileName],
    ["Type", report.kind.toUpperCase()],
    ...(report.sizeBytes ? [["Size", formatBytes(report.sizeBytes)] as [string, string]] : []),
    ["Rows × columns", `${formatCount(report.rowCount, locale)} × ${report.columnCount}`],
    ...(report.encoding ? [["Encoding", report.encoding.toUpperCase()] as [string, string]] : []),
    ...(report.delimiter
      ? [
          [
            "Delimiter",
            report.delimiter === "\t"
              ? "Tab"
              : report.delimiter === ","
                ? "Comma"
                : report.delimiter === ";"
                  ? "Semicolon"
                  : "Pipe",
          ] as [string, string],
        ]
      : []),
    ...(report.sheet ? [["Sheet", report.sheet] as [string, string]] : []),
    ["Header", headerPlace(report)],
  ];
  const t = Object.entries(timings)
    .map(([k, v]) => `${k} ${v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`}`)
    .join(" · ");
  return (
    <div className="grid gap-5">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {facts.map(([k, v]) => (
          // The file's name gets two columns: it is the one fact long enough to be cut short.
          <div key={k} className={cn("min-w-0", k === "File" && "col-span-2")}>
            <dt className="eyebrow text-fg-subtle">{k}</dt>
            <dd className="truncate text-ui text-fg" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {report.sampling ? (
        <p className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-fg">
          Sampled: {formatCount(report.sampling.keptRows, locale)} of about{" "}
          {countOf(report.sampling.estimatedTotalRows, "row", locale)} (
          {report.sampling.strategy === "systematic" && report.sampling.every
            ? `every ${ordinal(report.sampling.every)} row`
            : "the first rows"}
          ). Totals describe the sample, not the whole file.
        </p>
      ) : null}
      {report.dateFormats.length ? (
        <div>
          <p className="mb-2 text-ui font-medium text-fg">Date formats</p>
          <ul className="divide-y divide-border rounded-card border border-border">
            {report.dateFormats.map((d) => (
              <li key={d.column} className="flex flex-wrap items-start justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-ui text-fg">
                    <span className="font-medium">{d.column}</span> read as{" "}
                    <span className="font-medium text-accent">{d.format}</span>
                    {d.ambiguous ? (
                      <Badge tone="warning" className="ml-2">
                        assumed
                      </Badge>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-ui text-fg-muted">{d.evidence}</p>
                </div>
                <DateOrderSwitch decision={d} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {report.warnings.length || report.columnNotes.length ? (
        <div>
          <p className="mb-2 text-ui font-medium text-fg">Notes</p>
          <ul className="grid gap-1.5 text-ui text-fg-muted">
            {report.warnings.map((w) => (
              <li key={w} className="flex gap-2">
                <Info className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
                {w}
              </li>
            ))}
            {report.columnNotes.map((n) => (
              <li key={n.column} className="flex gap-2">
                <Info className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
                <span>
                  <span className="text-fg">{n.column}:</span> {n.note}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {t ? <p className="text-xs text-fg-subtle">Timings: {t}</p> : null}
    </div>
  );
}
