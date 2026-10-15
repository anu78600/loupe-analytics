"use client";

/**
 * Data health and parse details. HealthPanel shows the 0–100 score, passed
 * checks and fixable issues. ParseReportPanel shows encoding, delimiter, header
 * row and how each date column was read (DD/MM or MM/DD, with the evidence),
 * plus a switch that re-reads the file with the other order when the evidence
 * was ambiguous.
 */
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { HealthReport } from "@/engine/profile/quality";
import type { ParseReport } from "@/engine/core/types";
import { formatBytes, formatCount } from "@/engine/core/format";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { ConfidenceRing } from "./ConfidenceRing";

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

export function ParseReportPanel({
  report,
  timings,
}: {
  report: ParseReport;
  timings: Record<string, number>;
}) {
  const setDateOrder = useWorkspace((s) => s.setDateOrder);
  const canReload = useWorkspace((s) => Boolean(s.lastFile));
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
    ["Header", report.headerDetected ? `Row ${report.headerRowIndex + 1}` : "None detected"],
  ];
  const t = Object.entries(timings)
    .map(([k, v]) => `${k} ${v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`}`)
    .join(" · ");
  return (
    <div className="grid gap-5">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-2xs tracking-[0.1em] text-fg-subtle uppercase">{k}</dt>
            <dd className="truncate text-ui text-fg" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {report.sampling ? (
        <p className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-ui text-fg">
          Sampled: {formatCount(report.sampling.keptRows, locale)} of about{" "}
          {formatCount(report.sampling.estimatedTotalRows, locale)} rows (
          {report.sampling.strategy === "systematic" ? `every ${report.sampling.every}th row` : "first rows"}
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
                    <span className="font-figures text-accent">{d.format}</span>
                    {d.ambiguous ? (
                      <Badge tone="warning" className="ml-2">
                        assumed
                      </Badge>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-ui text-fg-muted">{d.evidence}</p>
                </div>
                {d.alternative && canReload ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      void setDateOrder(d.column, d.alternative?.startsWith("MM") ? "MDY" : "DMY")
                    }
                  >
                    Use {d.alternative}
                  </Button>
                ) : null}
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
      {t ? <p className="font-figures text-2xs text-fg-subtle">Timings: {t}</p> : null}
    </div>
  );
}
