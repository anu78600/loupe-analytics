"use client";

/**
 * Presentation slides: the dashboard as landscape 16:9 images for a review
 * meeting, laid out the way an analyst builds a deck.
 *
 * - An overview slide: the period and what it is compared with, the
 *   headline KPIs, and the key takeaways, each pointing to the slide that
 *   shows it.
 * - Then the charts, section by section (Trend, Breakdowns, Drivers…), two
 *   or four to a slide. Each chart is led by its takeaway (ChartData.headline,
 *   computed from its data), with what it is about and its unit above. A
 *   table or a cohort grid gets a slide of its own.
 * - Every slide carries its section, its number ("4 / 19") and a source line
 *   (file, rows, period, filters).
 *
 * planSlides() (slidePlan.ts) decides the slides before anything is drawn,
 * so the Export card can say exactly how many images the dashboard takes.
 * Slides are laid out at 1920 × 1080 and drawn at 2× (3840 × 2160), then
 * saved as numbered PNGs in a zip, or as one landscape PDF. Charts and
 * tables are scaled up on a slide so their labels read from across a room.
 *
 * Type follows the app's families: Inter for every word and figure (KPI
 * values in .font-figures), Instrument Serif only for the slide's title, and
 * small uppercase labels in the eyebrow's recipe. Nothing the slide writes is
 * under 18 px (SLIDE_MIN_TEXT), and a presenting slide scales its charts and
 * tables so their own labels reach it too (zoomFor).
 */
import * as React from "react";
import {
  formatCount,
  formatDelta,
  formatPointDelta,
  isFlatChange,
  type FormatOptions,
} from "@/engine/core/format";
import { kpiLabel } from "@/engine/core/labels";
import type { KpiValue } from "@/engine/kpi/compute";
import type { KpiMeta } from "@/engine/session";
import { chartSubtitle, GRAIN_WORD, rendersWithECharts } from "@/ui/charts/options";
import { DataTable } from "@/ui/charts/DataTable";
import { Sparkline } from "@/ui/charts/Sparkline";
import { Wordmark } from "@/ui/brand/logo";
import { formatKpi } from "@/ui/common/kpiFormat";
import { downloadBlob } from "@/lib/utils";
import {
  APP_MIN_TEXT,
  CANVAS_EYEBROW,
  renderOffscreen,
  StaticChart,
  Zoomed,
  type ReportChart,
  type ReportInput,
} from "./report";
import { slideFileName, type Slide } from "./slidePlan";

/** Laid-out slide size; drawn at twice this. */
export const SLIDE_W = 1920;
export const SLIDE_H = 1080;

// ---------------------------------------------------------------- layout

/** Content height of a slide: 1080 less the padding, header and footer below. */
const CONTENT_H = SLIDE_H - 60 - 44 - 120 - 36 - 46;
/** Content width of a slide: 1920 less the side padding. */
const CONTENT_W = SLIDE_W - 160;

/**
 * The smallest text a slide writes, in laid-out pixels: a sixtieth of its
 * height, which still reads on a projector from the back of a room.
 */
const SLIDE_MIN_TEXT = 18;

/** The height of one line of slide text at SLIDE_MIN_TEXT (line height 1.5), for the table-fitting sums. */
const MIN_LINE = Math.ceil(SLIDE_MIN_TEXT * 1.5);

/**
 * How much a slide enlarges what it draws: a chart or table is laid out at
 * 1/zoom of its space and scaled up. On a presenting slide that takes the
 * app's smallest labels (11 px axis labels, a table's "Showing" line) to
 * SLIDE_MIN_TEXT. The compact deck's half-height rows can't: laid out that
 * small, a donut's labels collide and a dozen bars lose their names (the
 * eight-bar limit in slidePlan's needsFullHeight is measured at 1.3), so its
 * charts keep the zoom they had (11 px labels at about 14 px). It is read on
 * a screen, not across a room.
 */
function zoomFor(chart: ReportChart, compact: boolean): number {
  if (!compact) return SLIDE_MIN_TEXT / APP_MIN_TEXT;
  return rendersWithECharts(chart.kind, chart.data) ? 1.3 : 1.1;
}

/** The first sentence of an insight's explanation, where its numbers are. */
function firstSentence(text: string): string {
  const t = text.trim();
  return /^.+?[.!?](?=\s|$)/.exec(t)?.[0] ?? t;
}

function SlideFrame({
  index,
  total,
  input,
  eyebrow,
  title,
  children,
}: {
  index: number;
  total: number;
  input: ReportInput;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  const filters = input.filters !== "None" ? ` · ${input.filters}` : "";
  return (
    <div
      data-slide
      className="relative flex flex-col overflow-hidden bg-bg font-sans text-fg"
      style={{ width: SLIDE_W, height: SLIDE_H, padding: "60px 80px 44px" }}
    >
      <header className="flex items-end justify-between gap-10" style={{ height: 120 }}>
        <div className="min-w-0">
          <p className={`text-[18px] text-accent ${CANVAS_EYEBROW}`}>{eyebrow}</p>
          <h2 className="mt-3 truncate font-display text-[50px] leading-[1.05] tracking-[-0.01em] text-fg">
            {title}
          </h2>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Wordmark size="sm" />
          <p className="text-[18px] text-fg-subtle">{input.title}</p>
        </div>
      </header>
      <div className="flex min-h-0 flex-col" style={{ marginTop: 36, height: CONTENT_H }}>
        {children}
      </div>
      <footer
        className="mt-auto flex items-center justify-between gap-8 border-t border-border pt-4 text-[18px] text-fg-subtle"
        style={{ height: 46 }}
      >
        <span className="min-w-0 truncate">
          Source: {input.fileName}, {formatCount(input.rows, input.fmt.locale)} rows ·{" "}
          {input.periodName ? `${input.periodName}: ` : ""}
          {input.period}
          {filters}
        </span>
        <span className="font-figures shrink-0">
          {index} / {total}
        </span>
      </footer>
    </div>
  );
}

/** One chart on a slide: what it is about and its unit, its takeaway, the chart, its note. */
function SlideChart({
  chart,
  fmt,
  width,
  height,
  compact,
}: {
  chart: ReportChart;
  fmt: FormatOptions;
  /** The card's width on the slide. */
  width: number;
  height: number;
  compact: boolean;
}) {
  const subtitle = chartSubtitle(chart.spec, chart.data, fmt, chart.kind);
  const note = !chart.data.empty ? chart.data.notes[0] : undefined;
  const headline = chart.data.headline && !chart.data.empty ? chart.data.headline : chart.spec.title;
  const zoom = zoomFor(chart, compact);
  // A chart fills whatever its takeaway leaves. A table shows as many rows as
  // fit: the card less its padding, label line, takeaway (one line or two, by
  // its length at about 0.55em a character), note (its 12px gap and one line),
  // and the table's header (37px) and "showing" line (32px), at 33px a row.
  const fontPx = compact ? 21 : 26;
  const lines = headline.length * fontPx * 0.55 > width - (compact ? 58 : 74) ? 2 : 1;
  const tableSpace =
    height -
    (compact ? 40 : 56) -
    MIN_LINE -
    (8 + lines * fontPx * 1.3) -
    (compact ? 14 : 20) -
    (note ? 12 + MIN_LINE + 1 : 0);
  const maxRows = Math.max(3, Math.floor((tableSpace / zoom - 37 - 32) / 33));
  return (
    <section
      className={`flex min-w-0 flex-1 flex-col rounded-[20px] border border-border bg-surface-1 ${compact ? "px-7 py-5" : "px-9 py-7"}`}
      style={{ height }}
    >
      <p className={`truncate text-[18px] text-fg-subtle ${CANVAS_EYEBROW}`}>
        {chart.spec.title}
        {subtitle ? ` · ${subtitle}` : ""}
      </p>
      <h3
        className={`mt-2 line-clamp-2 font-medium tracking-[-0.01em] text-fg ${compact ? "text-[21px] leading-[1.3]" : "text-[26px] leading-[1.3]"}`}
      >
        {headline}
      </h3>
      <div className={`relative min-h-0 flex-1 ${compact ? "mt-3.5" : "mt-5"}`}>
        {chart.data.empty ? (
          <p className="text-[18px] text-fg-subtle">{chart.data.notes[0] ?? "No data for this selection."}</p>
        ) : (
          <Zoomed zoom={zoom}>
            {rendersWithECharts(chart.kind, chart.data) ? (
              // Drawn with enough canvas pixels to stay sharp once scaled up and saved at 2×.
              <StaticChart chart={chart} fmt={fmt} pixelRatio={2 * zoom} />
            ) : (
              <DataTable spec={chart.spec} data={chart.data} fmt={fmt} maxRows={maxRows} print />
            )}
          </Zoomed>
        )}
      </div>
      {note ? <p className="truncate pt-3 text-[18px] text-fg-subtle">Note: {note}</p> : null}
    </section>
  );
}

/** The overview's KPI grid: three columns, or two for four KPIs (or fewer than three); always two rows deep. */
function kpiColumns(n: number): number {
  return n === 4 || n <= 2 ? 2 : 3;
}

/** Height of a KPI card's trend line on the overview. */
const SPARK_H = 104;

/** A headline KPI on the overview: name, value, its change with what it is measured from, and its trend. */
function SlideKpi({
  meta,
  value,
  fmt,
  width,
  sayWhyNoChange,
}: {
  meta: KpiMeta;
  value: KpiValue | undefined;
  fmt: FormatOptions;
  /** The card's inner width, so the trend line's drawing keeps its shape (a round end dot). */
  width: number;
  /**
   * Say why a KPI has no change. Off when the whole deck has no comparison
   * period: the overview says so once, not on every card.
   */
  sayWhyNoChange: boolean;
}) {
  const pct = meta.format === "percent";
  const change = pct ? value?.deltaAbs : value?.delta;
  const good =
    change === null || change === undefined || meta.direction === "neutral" || isFlatChange(change)
      ? null
      : change > 0 === (meta.direction === "higher");
  // Written as the dashboard's card writes it (₹3.13Cr, 1.75L, 42.3%), so a number reads the same on both.
  const show = (v: number | null | undefined) => formatKpi(v, meta.format, fmt);
  const spark = value?.spark.map((p) => p.v) ?? [];
  const grain = value ? GRAIN_WORD[value.sparkGrain] : undefined;
  return (
    <div className="flex min-h-0 flex-col rounded-[20px] border border-border bg-surface-1 px-7 py-6">
      <p className="truncate text-[18px] text-fg-muted">{kpiLabel(meta)}</p>
      <p className="font-figures mt-3 text-[50px] leading-none font-semibold tracking-[-0.025em] text-fg">
        {show(value?.value)}
      </p>
      {change !== null && change !== undefined ? (
        <p className="mt-4 line-clamp-2 text-[18px] leading-snug">
          {/* Over all time the change is the latest month's, so the card names that month and its value first. */}
          {value?.currentLabel ? (
            <span className="text-fg-subtle">
              {value.currentLabel} {show(value.current)}:{" "}
            </span>
          ) : null}
          <span
            className={`font-medium ${good === null ? "text-fg-muted" : good ? "text-success" : "text-danger"}`}
          >
            {pct ? formatPointDelta(change, fmt.locale) : formatDelta(change, fmt.locale)}
          </span>{" "}
          <span className="text-fg-subtle">
            {value?.currentLabel
              ? value.comparisonLabel
              : value?.previous !== null && value?.previous !== undefined
                ? `from ${show(value.previous)}`
                : ""}
          </span>
        </p>
      ) : sayWhyNoChange && value?.comparisonLabel ? (
        <p className="mt-4 line-clamp-2 text-[18px] leading-snug text-fg-subtle">{value.comparisonLabel}</p>
      ) : null}
      {/* The KPI's own trend, as on the dashboard's card (a dashed end when the last period is still open). */}
      {spark.filter((v) => v !== null && Number.isFinite(v)).length > 1 ? (
        <div className="mt-auto pt-4">
          <Sparkline
            values={spark}
            partialLast={value?.partialLast}
            height={Math.round((120 * SPARK_H) / width)}
            className="h-[104px]"
            strokeWidth={2.5}
          />
          {grain ? (
            <p className="mt-2 text-[18px] text-fg-subtle">
              {grain.charAt(0).toUpperCase()}
              {grain.slice(1)} trend
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function OverviewSlide({
  input,
  total,
  slideOf,
}: {
  input: ReportInput;
  total: number;
  /** The slide that shows a chart, for the takeaways' "slide 4". */
  slideOf: Map<string, number>;
}) {
  // Over all time the changes are the latest month's: the subtitle says which month, against which.
  const latest = input.hero.find((h) => h.value?.currentLabel)?.value?.currentLabel;
  const comparison = input.comparison
    ? latest
      ? `Changes compare ${latest} with ${input.comparison}`
      : `Compared with ${input.comparison}`
    : "No comparison period";
  const takeaways = input.insights.slice(0, 4);
  const kpis = input.hero.slice(0, 6);
  const cols = kpiColumns(kpis.length);
  // A card's inner width: the left three-fifths of the slide (less the 32px
  // gap), shared by the columns (20px gaps), less the card's padding and border.
  const cardInner = ((CONTENT_W - 32) * 0.6 - 20 * (cols - 1)) / cols - 58;
  return (
    <SlideFrame
      index={1}
      total={total}
      input={input}
      eyebrow={`${input.title} · performance review`}
      title={input.periodName ?? input.period}
    >
      {/* The dates behind a named period, what the changes compare with, and how fresh the data is. */}
      <p className="-mt-3 text-[18px] text-fg-muted">
        {input.periodName ? `${input.period} · ` : ""}
        {comparison}
        {input.dataTo ? ` · data up to ${input.dataTo}` : ""} · {formatCount(input.rows, input.fmt.locale)}{" "}
        rows
      </p>
      <div className="mt-8 grid min-h-0 flex-1 grid-cols-[1.5fr_1fr] gap-8">
        {/* Two rows of cards fill the height, each with its KPI's trend at the foot. */}
        <div
          className="grid min-h-0 gap-5"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: "repeat(2, minmax(0, 1fr))",
          }}
        >
          {kpis.map((h) => (
            <SlideKpi
              key={h.meta.id}
              meta={h.meta}
              value={h.value}
              fmt={input.fmt}
              width={cardInner}
              sayWhyNoChange={Boolean(input.comparison)}
            />
          ))}
        </div>
        <section className="flex min-h-0 flex-col rounded-[20px] border border-border bg-surface-1 px-9 py-8">
          <p className={`text-[18px] text-fg-subtle ${CANVAS_EYEBROW}`}>Key takeaways</p>
          {takeaways.length ? (
            <ol className="mt-6 grid min-h-0 content-start gap-6 overflow-hidden">
              {takeaways.map((t, i) => {
                const at = t.chartId ? slideOf.get(t.chartId) : undefined;
                // The finding, then the sentence with its numbers.
                const detail = firstSentence(t.body);
                return (
                  <li key={t.id} className="flex gap-4">
                    <span className="font-figures grid size-9 shrink-0 place-items-center rounded-full border border-border-accent bg-accent-soft text-[18px] font-medium text-accent">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-[20px] leading-snug font-medium text-fg">{t.title}</p>
                      {detail ? (
                        <p className="mt-1.5 line-clamp-2 text-[18px] leading-snug text-fg-muted">{detail}</p>
                      ) : null}
                      {at ? <p className="mt-1.5 text-[18px] text-fg-subtle">See slide {at}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-5 text-[18px] text-fg-muted">No takeaways stood out for this period.</p>
          )}
        </section>
      </div>
    </SlideFrame>
  );
}

/** Every slide, stacked, for rendering off-screen. */
export function SlideDeck({ input, slides }: { input: ReportInput; slides: Slide[] }) {
  const total = slides.length;
  const slideOf = new Map<string, number>();
  slides.forEach((s, i) => {
    if (s.kind === "charts") for (const row of s.rows) for (const c of row) slideOf.set(c.spec.id, i + 1);
  });
  return (
    <div className="flex flex-col">
      {slides.map((s, i) => {
        if (s.kind === "overview")
          return <OverviewSlide key="overview" input={input} total={total} slideOf={slideOf} />;
        const compact = s.rows.length > 1;
        const rowH = compact ? (CONTENT_H - 24) / 2 : CONTENT_H;
        return (
          <SlideFrame
            key={i}
            index={i + 1}
            total={total}
            input={input}
            eyebrow={`${s.title}${s.parts > 1 ? ` · ${s.part} of ${s.parts}` : ""}`}
            title={s.question}
          >
            <div className="flex flex-col gap-6">
              {s.rows.map((row, r) => (
                <div key={r} className="flex gap-6">
                  {row.map((c) => (
                    <SlideChart
                      key={c.spec.id}
                      chart={c}
                      fmt={input.fmt}
                      width={row.length > 1 ? (CONTENT_W - 24) / 2 : CONTENT_W}
                      height={rowH}
                      compact={compact}
                    />
                  ))}
                </div>
              ))}
            </div>
          </SlideFrame>
        );
      })}
    </div>
  );
}

/**
 * Draws every slide and saves them: numbered PNGs (3840 × 2160) in a zip
 * whose folder is named like it, or one landscape PDF. `baseName` is the file
 * name without its extension.
 */
export async function exportSlides(
  input: ReportInput,
  slides: Slide[],
  format: "png" | "pdf",
  baseName: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  onProgress?.("Laying out slides…");
  const { host, cleanup } = await renderOffscreen(<SlideDeck input={input} slides={slides} />, SLIDE_W);
  try {
    const nodes = [...host.querySelectorAll<HTMLElement>("[data-slide]")];
    const { toBlob, toJpeg } = await import("html-to-image");
    // The light theme's page colour (the slides' own background token), under anything transparent.
    const background = nodes[0] ? getComputedStyle(nodes[0]).backgroundColor : undefined;
    if (format === "png") {
      const files: Record<string, Uint8Array> = {};
      for (const [i, node] of nodes.entries()) {
        onProgress?.(`Drawing slide ${i + 1} of ${nodes.length}…`);
        const blob = await toBlob(node, { pixelRatio: 2, backgroundColor: background });
        if (!blob) throw new Error(`Slide ${i + 1} couldn't be drawn.`);
        files[`${baseName}/${slideFileName(slides[i] as Slide, i)}`] = new Uint8Array(
          await blob.arrayBuffer(),
        );
      }
      onProgress?.("Packing the images…");
      const { zipSync } = await import("fflate");
      // PNGs are already compressed: storing them is as small and much faster.
      const zip = zipSync(files, { level: 0 });
      downloadBlob(new Blob([zip as BlobPart], { type: "application/zip" }), `${baseName}.zip`);
    } else {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ unit: "pt", format: [960, 540], orientation: "landscape", compress: true });
      pdf.setProperties({ title: `${input.title} · slides`, subject: input.subtitle, creator: "Loupe" });
      for (const [i, node] of nodes.entries()) {
        onProgress?.(`Drawing slide ${i + 1} of ${nodes.length}…`);
        const img = await toJpeg(node, { pixelRatio: 2, quality: 0.92, backgroundColor: background });
        if (i > 0) pdf.addPage([960, 540], "landscape");
        pdf.addImage(img, "JPEG", 0, 0, 960, 540, undefined, "FAST");
      }
      pdf.save(`${baseName}.pdf`);
    }
  } finally {
    cleanup();
  }
}
