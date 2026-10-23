"use client";

/**
 * The Export gallery's previews (version 50.4): each format in miniature,
 * drawn from the real dashboard and the real files, never from a stock
 * picture.
 *
 * - The files people share (the report, the slides, the insights) are white
 *   paper in the light theme in either app theme, because they download that
 *   way: the report as a fanned stack of A4 pages (the cover with one tile
 *   per headline KPI in front), the slides as a deck planned by planSlides
 *   (the opening overview large, the next slides beside it with their charts
 *   in their rows, each chart's shape drawn from its own numbers), the
 *   insights as the top of their page with the top three, ranked.
 * - The files people build on follow the app's theme: the Power BI model as
 *   its diagram (the data table and its measures named from measures.dax,
 *   the Date table and their relationship), the first KPI view of kpis.sql
 *   with its line numbers and the app's code colours, the first rows of the
 *   data as a sheet, and what the settings file remembers.
 *
 * Every preview is decorative (aria-hidden): the card's text says what the
 * file holds. Each one fills its stage, a size container, and sizes itself by
 * it (cqw, cqh), so it keeps its proportions from a phone to a wide screen. A
 * preview waiting for its file shows a skeleton of that file.
 */
import * as React from "react";
import {
  Calculator,
  CalendarDays,
  Lightbulb,
  Rows3,
  Table2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Insight } from "@/engine/insights/insights";
import { cn } from "@/lib/utils";
import { HighlightedCode } from "@/ui/common/code";
import { Skeleton } from "@/ui/primitives/misc";
import { firstSentence } from "../../dashboard/page/PageInsights";
import type { ReportChart } from "../report";
import type { Slide } from "../slidePlan";
import {
  chartShape,
  DATE_TABLE,
  DATE_TABLE_COLUMNS,
  type ChartShapeOf,
  type Excerpt,
  type ModelOutline,
} from "./excerpts";

/** A sheet of paper in the light theme, as the shared files are drawn. */
function Paper({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      data-theme="light"
      // Dimmed a little in the dark theme, as pictures are, so white paper doesn't glare.
      className={cn(
        "overflow-hidden bg-surface-1 text-fg shadow-card ring-1 ring-border dark:brightness-[0.88]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A line of text in outline: a rounded bar in a text colour. */
function Bar({ className }: { className?: string }) {
  return <span className={cn("block shrink-0 rounded-full", className)} />;
}

// ---------------------------------------------------------------- chart shapes

/** A chart's shape in its first chart colour, filling its box; a line skips the points with no value. */
function ChartShape({ shape }: { shape: ChartShapeOf | null }) {
  if (!shape) return <span className="block size-full rounded-[2px] bg-surface-2" />;
  const known = shape.values.filter((v): v is number => v !== null);
  const max = Math.max(...known, 0);
  const min = Math.min(...known, 0);
  const span = max - min || 1;
  const n = shape.values.length;
  if (shape.type === "bars") {
    return (
      <svg viewBox={`0 0 100 ${n * 10}`} preserveAspectRatio="none" className="block size-full">
        {shape.values.map((v, i) =>
          v !== null && v > 0 ? (
            <rect
              key={i}
              x={0}
              y={i * 10 + 2}
              width={(v / (max || 1)) * 100}
              height={6}
              rx={1}
              fill="var(--chart-1)"
            />
          ) : null,
        )}
      </svg>
    );
  }
  if (shape.type === "columns") {
    const w = 100 / n;
    return (
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="block size-full">
        {shape.values.map((v, i) => {
          if (v === null || v <= 0) return null;
          const h = (v / (max || 1)) * 40;
          return (
            <rect
              key={i}
              x={i * w + w * 0.18}
              y={40 - h}
              width={w * 0.64}
              height={h}
              rx={0.8}
              fill="var(--chart-1)"
            />
          );
        })}
      </svg>
    );
  }
  const pts = shape.values.flatMap((v, i) =>
    v === null ? [] : [`${((i / (n - 1)) * 100).toFixed(2)},${(38 - ((v - min) / span) * 34).toFixed(2)}`],
  );
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="block size-full">
      {shape.type === "area" ? (
        <polygon
          points={`${pts[0]?.split(",")[0] ?? 0},40 ${pts.join(" ")} ${pts.at(-1)?.split(",")[0] ?? 100},40`}
          fill="var(--chart-1)"
          opacity={0.18}
        />
      ) : null}
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** A chart on a page or slide: its title and takeaway in outline over its shape. */
function ChartBox({ chart, className }: { chart: ReportChart; className?: string }) {
  return (
    <span
      className={cn(
        "flex min-h-0 min-w-0 flex-col gap-[4%] rounded-[2px] bg-surface-1 p-[5%] ring-1 ring-border-subtle",
        className,
      )}
    >
      <Bar className="h-[7%] min-h-[2px] w-[55%] bg-fg/60" />
      <Bar className="h-[5%] min-h-[2px] w-[80%] bg-fg-subtle/30" />
      <span className="min-h-0 flex-1 pt-[4%]">
        <ChartShape shape={chartShape(chart)} />
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- report

/**
 * The report's cover in outline, laid out as exportPdf lays it out: the mark
 * and the file, the title and what it covers, the box of facts (period,
 * comparison, filters…), a tile per headline KPI three to a row, the
 * executive summary and the supporting KPIs in two columns.
 */
function CoverPage({ kpis }: { kpis: number }) {
  return (
    <span className="flex size-full flex-col gap-[3%] bg-bg px-[8%] py-[7%]">
      <span className="flex items-center justify-between border-b border-border-subtle pb-[3%]">
        <span className="flex w-1/2 items-center gap-[6%]">
          <span className="aspect-square w-[14%] rounded-full bg-accent" />
          <Bar className="h-[3px] w-[60%] bg-fg/70" />
        </span>
        <Bar className="h-[2px] w-[22%] bg-fg-subtle/40" />
      </span>
      <Bar className="mt-[3%] h-[2px] w-[28%] bg-fg-subtle/50" />
      <Bar className="h-[6px] w-[58%] bg-fg/80" />
      <Bar className="h-[2px] w-[62%] bg-fg-subtle/40" />
      <span className="grid grid-cols-3 gap-x-[6%] gap-y-[14%] rounded-[2px] bg-surface-1 p-[5%] ring-1 ring-border-subtle">
        {Array.from({ length: 6 }, (_, i) => (
          <Bar key={i} className="h-[2px] w-[80%] bg-fg-subtle/40" />
        ))}
      </span>
      <span className="grid grid-cols-3 gap-[4%]">
        {Array.from({ length: Math.min(6, Math.max(3, kpis)) }, (_, i) => (
          <span
            key={i}
            className="flex aspect-[3/2] flex-col justify-center gap-[14%] rounded-[2px] bg-surface-1 px-[10%] ring-1 ring-border-subtle"
          >
            <Bar className="h-[2px] w-[60%] bg-fg-subtle/50" />
            <Bar className="h-[4px] w-[78%] bg-fg/75" />
          </span>
        ))}
      </span>
      <span className="mt-[2%] flex flex-col gap-[4px]">
        {["w-full", "w-[94%]", "w-full", "w-[70%]"].map((w, i) => (
          <Bar key={i} className={cn("h-[2px] bg-fg-subtle/35", w)} />
        ))}
      </span>
      <span className="mt-auto grid grid-cols-2 gap-x-[8%] gap-y-[5px]">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="flex justify-between border-b border-border-subtle pb-[2px]">
            <Bar className="h-[2px] w-[50%] bg-fg-subtle/40" />
            <Bar className="h-[2px] w-[20%] bg-fg/60" />
          </span>
        ))}
      </span>
    </span>
  );
}

/** A figures page in outline: its header, then two numbered figures, drawn from the report's charts. */
function FiguresPage({ charts }: { charts: ReportChart[] }) {
  return (
    <span className="flex size-full flex-col gap-[4%] bg-bg px-[8%] py-[7%]">
      <span className="flex items-center justify-between border-b border-border-subtle pb-[3%]">
        <span className="aspect-square w-[7%] rounded-full bg-accent" />
        <Bar className="h-[2px] w-[22%] bg-fg-subtle/40" />
      </span>
      {[0, 1].map((i) => {
        const chart = charts[i];
        return chart ? (
          <ChartBox key={i} chart={chart} className="flex-1" />
        ) : (
          <span key={i} className="flex-1 rounded-[2px] bg-surface-1 ring-1 ring-border-subtle" />
        );
      })}
    </span>
  );
}

/**
 * The dashboard report as a fanned stack of A4 pages: the cover in front with
 * a tile per headline KPI, two pages of figures behind it (the report's first
 * charts), as many as the report has.
 */
export function ReportPreview({
  kpis,
  pages,
  charts,
}: {
  kpis: number;
  pages: number;
  charts: ReportChart[];
}) {
  const sheet = "absolute inset-0 rounded-[3px] transition-[translate,rotate] duration-slow ease-out-quint";
  return (
    <div aria-hidden className="absolute inset-0 grid place-items-center">
      <div className="relative aspect-[1/1.414] h-[80cqh]">
        {pages > 2 ? (
          <Paper
            className={cn(
              sheet,
              "origin-bottom -translate-x-[46%] -rotate-[7deg] motion-safe:group-hover:-translate-x-[54%] motion-safe:group-hover:-rotate-[9deg]",
            )}
          >
            <FiguresPage charts={charts.slice(2, 4)} />
          </Paper>
        ) : null}
        {pages > 1 ? (
          <Paper
            className={cn(
              sheet,
              "origin-bottom translate-x-[46%] rotate-[7deg] motion-safe:group-hover:translate-x-[54%] motion-safe:group-hover:rotate-[9deg]",
            )}
          >
            <FiguresPage charts={charts.slice(0, 2)} />
          </Paper>
        ) : null}
        <Paper className={cn(sheet, "shadow-pop")}>
          <CoverPage kpis={kpis} />
        </Paper>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- slides

/**
 * One slide in outline, laid out as slides.tsx draws it: its section over its
 * title, with the mark at the right; the overview's headline KPIs three to a
 * row beside its key takeaways, or the slide's charts in their rows; and the
 * source line and its number at the foot.
 */
function SlideFace({ slide, n, kpis }: { slide: Slide; n: number; kpis: number }) {
  return (
    <span className="flex size-full flex-col gap-[4%] bg-bg px-[5%] pt-[5%] pb-[4%]">
      <span className="flex items-start justify-between">
        <span className="flex w-1/2 flex-col gap-[5px]">
          <Bar className="h-[2px] w-[40%] bg-accent/70" />
          <Bar className="h-[5px] w-[90%] bg-fg/75" />
        </span>
        <span className="flex w-[14%] items-center gap-[10%]">
          <span className="aspect-square w-[24%] rounded-full bg-accent" />
          <Bar className="h-[2px] flex-1 bg-fg/50" />
        </span>
      </span>
      {slide.kind === "overview" ? (
        <span className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-[3%]">
          <span className="grid grid-cols-3 gap-[5%]">
            {Array.from({ length: Math.min(6, Math.max(3, kpis)) }, (_, i) => (
              <span
                key={i}
                className="flex flex-col justify-center gap-[12%] rounded-[2px] bg-surface-1 px-[10%] ring-1 ring-border-subtle"
              >
                <Bar className="h-[2px] w-[60%] bg-fg-subtle/50" />
                <Bar className="h-[4px] w-[78%] bg-fg/75" />
              </span>
            ))}
          </span>
          {/* The key takeaways, numbered. */}
          <span className="flex flex-col gap-[12%] rounded-[2px] bg-surface-1 p-[8%] ring-1 ring-border-subtle">
            {["w-[88%]", "w-[72%]", "w-[80%]"].map((w) => (
              <span key={w} className="flex items-center gap-[8%]">
                <span className="aspect-square w-[11%] shrink-0 rounded-full bg-accent-soft ring-1 ring-border-accent" />
                <Bar className={cn("h-[2px] bg-fg/55", w)} />
              </span>
            ))}
          </span>
        </span>
      ) : (
        <span className="flex min-h-0 flex-1 flex-col gap-[4%]">
          {slide.rows.map((row, r) => (
            <span key={r} className="flex min-h-0 flex-1 gap-[3%]">
              {row.map((c) => (
                <ChartBox key={c.spec.id} chart={c} className="flex-1" />
              ))}
            </span>
          ))}
        </span>
      )}
      <span className="flex items-center justify-between">
        <Bar className="h-[2px] w-[40%] bg-fg-subtle/40" />
        <span className="font-figures text-2xs leading-none text-fg-subtle">{n}</span>
      </span>
    </span>
  );
}

/**
 * The slides as a deck: the opening slide large, the next two beside it as a
 * strip, each laid out as planSlides lays it out (the overview, then each
 * slide's charts in their rows), and how many more follow. It follows the
 * options as they change.
 */
export function SlidesPreview({ slides, kpis }: { slides: Slide[]; kpis: number }) {
  const [first, ...rest] = slides;
  const strip = rest.slice(0, 2);
  const more = slides.length - 1 - strip.length;
  return (
    <div
      aria-hidden
      className="absolute inset-0 grid grid-cols-[minmax(0,1fr)_minmax(0,0.5fr)] items-center gap-[4cqw] px-[7cqw]"
    >
      {first ? (
        <Paper className="aspect-video rounded-[3px] shadow-pop transition-[translate] duration-slow ease-out-quint motion-safe:group-hover:-translate-y-[1.5cqh]">
          <SlideFace slide={first} n={1} kpis={kpis} />
        </Paper>
      ) : null}
      <span className="grid gap-[3.5cqw]">
        {strip.map((slide, i) => (
          <Paper key={i} className="aspect-video rounded-[3px]">
            <SlideFace slide={slide} n={i + 2} kpis={kpis} />
          </Paper>
        ))}
        {more > 0 ? (
          <span className="tabular -mt-[1cqw] text-2xs leading-none text-fg-subtle">+{more} more</span>
        ) : null}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- insights

const TONE: Record<Insight["tone"], { icon: LucideIcon; chip: string }> = {
  positive: { icon: TrendingUp, chip: "bg-success-soft text-success" },
  negative: { icon: TrendingDown, chip: "bg-danger-soft text-danger" },
  warning: { icon: TriangleAlert, chip: "bg-warning-soft text-warning" },
  neutral: { icon: Lightbulb, chip: "bg-accent-soft text-accent" },
};

/**
 * The insights as the top of their page: the three that rank highest, by
 * rank, each with its tone and title. A skeleton while they are found; a
 * line saying nothing stood out when none did.
 */
export function InsightsPreview({ insights }: { insights: Insight[] | null }) {
  return (
    <div aria-hidden className="absolute inset-x-[9cqw] top-[11cqh] bottom-0">
      <Paper className="flex h-full flex-col rounded-t-[4px] px-[6cqw] pt-[6cqh]">
        <span className="flex items-center justify-between">
          <Bar className="h-[1.6cqh] w-[26%] bg-fg/75" />
          <Bar className="h-[1.2cqh] w-[14%] bg-fg-subtle/40" />
        </span>
        {insights === null ? (
          <div className="mt-[4cqh] grid gap-[3.5cqh]">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-2.5">
                <Skeleton className="size-5 shrink-0 rounded-full" />
                <Skeleton className="h-2.5 flex-1 rounded-full" />
              </div>
            ))}
          </div>
        ) : insights.length ? (
          <ol className="mt-[2cqh]">
            {insights.slice(0, 3).map((ins, i) => {
              const tone = TONE[ins.tone];
              return (
                <li
                  key={ins.id}
                  className="flex items-start gap-2 border-b border-border-subtle py-[2.4cqh] last:border-b-0"
                >
                  <span className="font-figures w-3 shrink-0 pt-0.5 text-2xs text-fg-subtle">{i + 1}</span>
                  <span className={cn("grid size-5 shrink-0 place-items-center rounded-full", tone.chip)}>
                    <tone.icon className="size-3" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-fg">{ins.title}</span>
                    <span className="block truncate text-xs text-fg-subtle">{firstSentence(ins.body)}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <span className="grid flex-1 place-items-center pb-[6cqh] text-center text-xs text-fg-muted">
            Nothing stands out for this selection
          </span>
        )}
      </Paper>
    </div>
  );
}

// ---------------------------------------------------------------- Power BI

/** A table in the model view: its name with its icon, then a few of its fields. */
function ModelTable({
  name,
  icon: Icon,
  rows,
  more,
  className,
}: {
  name: string;
  icon: LucideIcon;
  rows: Array<{ icon: LucideIcon; label: string }>;
  more?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "block min-w-0 overflow-hidden rounded-control bg-surface-1 shadow-card ring-1 ring-border",
        className,
      )}
    >
      <span className="flex items-center gap-1.5 border-b border-border-subtle bg-surface-2 px-2.5 py-1.5">
        <Icon className="size-3.5 shrink-0 text-accent" />
        <span className="min-w-0 truncate text-xs font-medium text-fg">{name}</span>
      </span>
      <span className="grid gap-0.5 px-2.5 py-1.5">
        {rows.map((r) => (
          <span key={r.label} className="flex min-w-0 items-center gap-1.5 text-2xs text-fg-muted">
            <r.icon className="size-3 shrink-0 text-fg-subtle" />
            <span className="min-w-0 truncate">{r.label}</span>
          </span>
        ))}
        {more ? <span className="tabular truncate pt-0.5 text-2xs text-fg-subtle">{more}</span> : null}
      </span>
    </span>
  );
}

/**
 * The Power BI model as its diagram: the data table with its first measures
 * (named as measures.dax names them) and the count of the rest, the Date table
 * when the data has dates, and the one-to-many relationship between them. A
 * skeleton until the measures are read (`outline` undefined); a model without
 * a measure (null) shows the data table alone, named for what it holds.
 */
export function ModelPreview({
  outline,
  columns,
  dates,
}: {
  outline: ModelOutline | null | undefined;
  columns: number;
  dates: boolean;
}) {
  return (
    <div
      aria-hidden
      // The model view's canvas: a faint grid of dots behind the tables.
      className="absolute inset-0 grid place-items-center bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:14px_14px] px-[6cqw]"
    >
      {outline !== undefined ? (
        <span className="flex w-full items-center justify-center">
          <ModelTable
            name={outline?.table ?? "Your data"}
            icon={Table2}
            className="w-[50cqw] max-w-64"
            rows={(outline?.measures ?? []).slice(0, 3).map((m) => ({ icon: Calculator, label: m }))}
            more={`${outline ? outline.measures.length : "No"} measures · ${columns} columns`}
          />
          {dates ? (
            <>
              {/* The relationship: many rows to one date. */}
              <span className="relative h-px w-[12cqw] min-w-8 shrink-0 bg-border-strong">
                <span className="absolute -top-4 left-1 text-2xs leading-none text-fg-muted">*</span>
                <span className="absolute -top-4 right-1 text-2xs leading-none text-fg-muted">1</span>
              </span>
              <ModelTable
                name={DATE_TABLE}
                icon={CalendarDays}
                className="w-[28cqw] max-w-36"
                rows={DATE_TABLE_COLUMNS.slice(0, 3).map((c) => ({ icon: Rows3, label: c }))}
              />
            </>
          ) : null}
        </span>
      ) : (
        <div className="flex w-full items-center justify-center gap-[9cqw]">
          <Skeleton className="h-[52cqh] w-[46cqw] rounded-control" />
          <Skeleton className="h-[34cqh] w-[26cqw] rounded-control" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- SQL

/**
 * The first KPI view of kpis.sql, as the file has it: its line numbers, its
 * notes and the start of its CREATE VIEW, in the app's code colours, fading
 * out at the foot. Skeleton lines while the file is written.
 */
export function SqlPreview({ excerpt }: { excerpt: Excerpt | null }) {
  return (
    <div
      aria-hidden
      className="absolute inset-0 overflow-hidden [mask-image:linear-gradient(to_bottom,var(--bg)_62%,transparent)] px-[5cqw] pt-[6cqh]"
    >
      {excerpt ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-xs">
          <span className="tabular text-right text-fg-subtle select-none">
            {excerpt.lines.map((_, i) => (
              <span key={i} className="block">
                {excerpt.start + i}
              </span>
            ))}
          </span>
          <pre className="overflow-hidden whitespace-pre text-fg-muted">
            <HighlightedCode code={excerpt.lines.join("\n")} lang="sql" />
          </pre>
        </div>
      ) : (
        <div className="grid gap-2.5 pt-1">
          {[62, 88, 74, 40, 81, 56, 70].map((w, i) => (
            <Skeleton key={i} className="h-2.5 rounded-full" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- data

/**
 * The cleaned data's first rows as a sheet: the file's own headers (as the
 * cleaned CSV keeps them) over its first values as the data grid shows them,
 * running off the right edge. A skeleton while they are read.
 */
export function DataPreview({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<string | null>> | null;
}) {
  const cols = Math.min(6, headers.length);
  return (
    <div
      aria-hidden
      className="absolute inset-[5cqw] overflow-hidden rounded-control bg-surface-1 shadow-card ring-1 ring-border"
    >
      {rows ? (
        <table className="font-data w-max border-collapse text-left text-xs">
          <thead>
            <tr className="bg-surface-2">
              <th className="w-7 border-r border-b border-border-subtle" />
              {headers.slice(0, cols).map((h, j) => (
                <th
                  key={j}
                  className="border-r border-b border-border-subtle px-2.5 py-1.5 font-medium whitespace-nowrap text-fg"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="tabular border-r border-b border-border-subtle px-1.5 py-1.5 text-center text-2xs text-fg-subtle">
                  {i + 1}
                </td>
                {r.slice(0, cols).map((v, j) => (
                  <td
                    key={j}
                    className="max-w-48 truncate border-r border-b border-border-subtle px-2.5 py-1.5 whitespace-nowrap text-fg-muted"
                  >
                    {v ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="grid gap-3 p-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-3 rounded-full" />
          ))}
        </div>
      )}
      {/* The sheet runs on past its edge: the last column fades into it. */}
      <span className="pointer-events-none absolute inset-y-0 right-0 w-[22%] bg-[linear-gradient(to_left,var(--surface-1),transparent)]" />
    </div>
  );
}

// ---------------------------------------------------------------- settings

/** What the settings file remembers, as a short list of the dashboard's own facts. */
export function SettingsPreview({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div aria-hidden className="absolute inset-0 grid place-items-center p-[6cqw]">
      <dl className="grid w-full max-w-72 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-control bg-surface-1 shadow-card ring-1 ring-border">
        {items.map((it) => (
          <div
            key={it.label}
            className="flex items-baseline justify-between gap-3 border-b border-border-subtle px-3 py-1.5 last:border-b-0"
          >
            <dt className="shrink-0 text-2xs text-fg-subtle">{it.label}</dt>
            <dd className="tabular min-w-0 truncate text-xs font-medium text-fg">{it.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
