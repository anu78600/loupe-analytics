"use client";

/**
 * Step 3, Check & map (version 50.2, the guided flow): review how each
 * column was read, and fix it; the dashboard follows every change (each one
 * reconfigures the session in the worker).
 *
 * The page opens with the flow's StepHeader: the facts line under it says
 * what the file was read as (industry and data shape, rows and columns, the
 * date span and the grain; one clamped line on a phone), and the data-shape
 * select sits beside it. Then LearnedNotice when a learned rule is in use,
 * and the summary strip: KPIs available, columns used, rows to check and
 * data health, each opening where its answer is (review/SummaryStrip.tsx).
 * The hidden-columns notes follow: columns that look replaced by a cleaned
 * copy, and the columns the user hid (HiddenColumns).
 *
 * The main view is the review table (review/ReviewTable.tsx): one row per
 * column of the file, in file order, with the eye that hides it, what it
 * holds, the kind it is read as, the field it fills on an industry's
 * dashboard, what it feeds or why nothing reads it, and its health badges;
 * each row opens its details (why, value meanings, Remember …, role and
 * additivity under Advanced). Beside it, in a segmented control:
 * - Rows: the whole file with every problem marked (DataCheckPanel);
 * - KPIs: which KPIs the file supports and what the others need;
 * - Fields (industry dashboards): the mapping by field and value meanings;
 * - File report: how the file was read and its health score.
 * A health badge opens the Rows view on its rows, or the File report.
 *
 * The page ends with the flow's dock: where things stand ("26 of 28 columns
 * used · 37 of 39 KPIs"), "Open the dashboard" and "Customise first".
 *
 * Corrections made here are learned for files like this one
 * (store/learned.ts). Explanations are one short line with the full text
 * behind hover, a long press or the ⓘ (ui/primitives/reveal.tsx).
 */
import * as React from "react";
import { CalendarRange, Columns3, FileText, Gauge, ListTree, Rows3 } from "lucide-react";
import { formatRange } from "@/engine/core/dates";
import { formatCount } from "@/engine/core/format";
import { friendly } from "@/engine/core/labels";
import { useSettings } from "@/store/settings";
import { useWorkspace } from "@/store/workspace";
import { Button } from "@/ui/primitives/button";
import { Card } from "@/ui/primitives/card";
import { ClampText } from "@/ui/primitives/reveal";
import { Segmented, type SegmentedOption } from "@/ui/primitives/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/primitives/select";
import { DataCheckPanel } from "./DataCheckPanel";
import { FileIdentity } from "./FileIdentity";
import { FlowDock } from "./flow/FlowDock";
import { StepHeader } from "./flow/StepHeader";
import { HealthPanel, ParseReportPanel } from "./HealthPanel";
import { HiddenColumns } from "./HiddenColumns";
import { LearnedNotice } from "./LearnedNotice";
import { FieldsView } from "./review/FieldMapping";
import { KpiAvailability } from "./review/KpiAvailability";
import type { ReviewFilter } from "./review/model";
import { ReviewTable } from "./review/ReviewTable";
import { SummaryStrip } from "./review/SummaryStrip";
import { useCheckViews } from "./review/useCheckViews";
import { useMediaQuery } from "./review/useMediaQuery";
import { useReviewRows } from "./review/useReviewRows";

/** The page's views: the review table first, then the rest of what the step can show. */
type MapView = "columns" | "rows" | "kpis" | "fields" | "file";

export function MapStep() {
  const context = useWorkspace((s) => s.context);
  const configuring = useWorkspace((s) => s.configuring);
  const setStep = useWorkspace((s) => s.setStep);
  const setSubDomain = useWorkspace((s) => s.setSubDomain);
  const summary = useWorkspace((s) => s.summary);
  const locale = useSettings((s) => s.numberLocale);
  const checkViews = useCheckViews();
  const rows = useReviewRows(checkViews);
  const [view, setView] = React.useState<MapView>("columns");
  const [filter, setFilter] = React.useState<ReviewFilter>("all");
  // The Rows view's open check view: all rows, the rows to check, one problem or one column's blanks.
  const [checkView, setCheckView] = React.useState("all");
  const phone = useMediaQuery("(max-width: 639px)", false);
  const viewsRef = React.useRef<HTMLDivElement>(null);
  if (!context) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center">
        <p className="text-sm text-fg-muted">
          Confirm an industry first so Loupe knows which fields to look for.
        </p>
        <Button className="mt-4" variant="secondary" onClick={() => setStep("detect")}>
          Back to detection
        </Button>
      </div>
    );
  }

  /** Shows a view, bringing its switcher into sight when the click came from far down the table. */
  const show = (next: MapView) => {
    setView(next);
    viewsRef.current?.scrollIntoView({ block: "nearest" });
  };
  /** A health badge or the strip: the Rows view on a check view, or the File report (null). */
  const openCheck = (id: string | null) => {
    if (id) setCheckView(id);
    show(id ? "rows" : "file");
  };

  const fieldsView = !context.domain.generic;
  const subName = context.domain.subDomains.find((s) => s.id === context.subDomainId)?.name;
  // What Loupe read the file as, in words: on a phone the facts line is one clamped line of this.
  const readAs = `${context.domain.name}${subName && !context.domain.generic ? ` · ${subName}` : ""}${context.domain.generic ? ` · ${context.domain.description}` : ""}`;
  const columnCount = rows?.length ?? summary?.columnCount ?? 0;
  const facts = [
    readAs,
    summary ? `${formatCount(summary.rowCount, locale)} rows · ${columnCount} columns` : "",
    context.dateColumn && context.dateBounds
      ? `${formatRange(context.dateBounds.min, context.dateBounds.max)} by ${friendly(context.dateColumn)}`
      : "",
    context.grainLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  const kpis = context.kpis.filter((k) => !k.hidden);
  const kpisOn = kpis.filter((k) => k.available).length;
  const used = rows?.filter((r) => r.status === "used").length ?? 0;

  const options: Array<SegmentedOption<MapView>> = [
    { value: "columns", label: "Columns", icon: phone ? undefined : <Columns3 aria-hidden /> },
    { value: "rows", label: "Rows", icon: phone ? undefined : <Rows3 aria-hidden /> },
    { value: "kpis", label: "KPIs", icon: phone ? undefined : <Gauge aria-hidden /> },
    ...(fieldsView
      ? [{ value: "fields" as const, label: "Fields", icon: phone ? undefined : <ListTree aria-hidden /> }]
      : []),
    { value: "file", label: "File report", icon: phone ? undefined : <FileText aria-hidden /> },
  ];

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-8 md:px-6 lg:py-10">
      <StepHeader
        step="map"
        title="Review how each column was read"
        lead="What you fix here, the dashboard follows."
        leadFull="Each column of your file, how Loupe read it and what it feeds. Change how a column is read, the field it fills or what its values mean, and the dashboard is rebuilt to match. Hide a column to leave it out: it stays in your file. Rows shows the whole file with every problem marked."
        aside={
          context.domain.subDomains.length > 1 ? (
            <span className="flex items-center gap-2">
              <span className="text-xs text-fg-subtle max-sm:sr-only">Data shape</span>
              <Select value={context.subDomainId} onValueChange={setSubDomain}>
                <SelectTrigger className="w-56" size="sm" aria-label="Data shape">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {context.domain.subDomains.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </span>
          ) : null
        }
      >
        {/* From lg the top bar's breadcrumb names the file (shell/TopBar.tsx). */}
        {summary ? <FileIdentity summary={summary} className="mt-3 lg:hidden" /> : null}
        {/* What Loupe read the file as: industry and shape, size, date span, grain. One clamped line on a phone. */}
        <ClampText className="mt-3 text-xs text-fg-subtle sm:hidden">{facts}</ClampText>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle max-sm:hidden">
          <span className="text-fg-muted">{readAs}</span>
          {summary ? (
            <span className="inline-flex items-center gap-1">
              <Rows3 className="size-3.5" aria-hidden />
              <span className="tabular">{formatCount(summary.rowCount, locale)}</span> rows ·{" "}
              <span className="tabular">{columnCount}</span> columns
            </span>
          ) : null}
          {context.dateColumn && context.dateBounds ? (
            <span className="inline-flex items-center gap-1">
              <CalendarRange className="size-3.5" aria-hidden />
              {formatRange(context.dateBounds.min, context.dateBounds.max)} by {friendly(context.dateColumn)}
            </span>
          ) : null}
          <span>{context.grainLabel}</span>
        </p>
      </StepHeader>
      <LearnedNotice className="mb-6" />
      <SummaryStrip
        rows={rows}
        views={checkViews}
        className="mb-8"
        onKpis={() => show("kpis")}
        onColumns={(anyUnused) => {
          setFilter(anyUnused ? "unused" : "all");
          show("columns");
        }}
        onRows={() => openCheck("problems")}
        onReport={() => show("file")}
      />
      <HiddenColumns className="mb-6" />
      <div ref={viewsRef} className="mb-4 max-w-full scroll-mt-20 overflow-x-auto lg:scroll-mt-24">
        <Segmented<MapView>
          ariaLabel="View"
          size={phone ? "sm" : "md"}
          value={view === "fields" && !fieldsView ? "columns" : view}
          onChange={setView}
          options={options}
        />
      </div>
      {view === "rows" ? (
        <DataCheckPanel views={checkViews} selected={checkView} onSelect={setCheckView} />
      ) : view === "kpis" ? (
        <KpiAvailability />
      ) : view === "fields" && fieldsView ? (
        <FieldsView />
      ) : view === "file" ? (
        <FileReport />
      ) : rows ? (
        <ReviewTable rows={rows} filter={filter} onFilter={setFilter} onOpen={openCheck} />
      ) : null}
      <FlowDock
        status={
          <>
            <span className="tabular text-fg">{used}</span> of{" "}
            <span className="tabular">{rows?.length ?? 0}</span> columns used ·{" "}
            <span className="tabular text-fg">{kpisOn}</span> of{" "}
            <span className="tabular">{kpis.length}</span> KPIs
          </>
        }
        busy={configuring}
        secondary={{ label: "Customise first", onClick: () => setStep("customise") }}
        primary={{ label: "Open the dashboard", onClick: () => setStep("dashboard") }}
      />
    </div>
  );
}

/** How the file was read (encoding, header, date order, notes) and its data-health score and checks. */
function FileReport() {
  const health = useWorkspace((s) => s.health);
  const report = useWorkspace((s) => s.report);
  const timings = useWorkspace((s) => s.timings);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-6">{health ? <HealthPanel health={health} /> : null}</Card>
      <Card className="p-6">{report ? <ParseReportPanel report={report} timings={timings} /> : null}</Card>
    </div>
  );
}
