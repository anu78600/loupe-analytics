"use client";

/**
 * Off-screen report rendering for the PDF report (and, through StaticChart
 * and renderOffscreen, the presentation slides in slides.tsx). Pages render
 * in the light theme at print resolution, charts use the same option builder
 * as the app, and every chart signals ECharts' "finished" before capture.
 *
 * The PDF reads like an analyst's report: a cover stating the period, what
 * the changes compare with and how recent the data is; the headline KPIs; an
 * executive summary whose insights cite their figures; numbered figures with
 * their unit, notes and source; and a glossary of every KPI shown.
 */
import * as React from "react";
import { createRoot } from "react-dom/client";
import type { EChartsType } from "echarts/core";
import type { ChartData, ChartKind, ChartSpec } from "@/engine/charts/types";
import type { HealthReport } from "@/engine/profile/quality";
import type { Insight } from "@/engine/insights/insights";
import type { FormatOptions } from "@/engine/core/format";
import { formatCount, formatDelta, formatPointDelta, formatValue, isFlatChange } from "@/engine/core/format";
import type { KpiValue } from "@/engine/kpi/compute";
import type { KpiMeta } from "@/engine/session";
import { buildOption, chartSubtitle, rendersWithECharts } from "@/ui/charts/options";
import { readChartTokens } from "@/ui/charts/tokens";
import { DataTable } from "@/ui/charts/DataTable";
import { loadECharts } from "@/ui/charts/EChart";
import { Wordmark } from "@/ui/brand/logo";
import { kpiLabel } from "@/engine/core/labels";

export interface ReportChart {
  spec: ChartSpec;
  data: ChartData;
  kind: ChartKind;
  /** Wider than half the dashboard: drawn across both columns of the PNG. */
  wide?: boolean;
}

export interface ReportInput {
  title: string;
  subtitle: string;
  fileName: string;
  isDemo: boolean;
  period: string;
  /** The preset's name ("Last 12 months"), or null for a custom range or all time. */
  periodName: string | null;
  /** What the changes compare with ("1 Oct 2024 – 30 Sep 2025"), or null. */
  comparison: string | null;
  /** The last date in the data, formatted. */
  dataTo: string | null;
  filters: string;
  rows: number;
  grain: string;
  generatedAt: string;
  hero: Array<{ meta: KpiMeta; value: KpiValue | undefined }>;
  supporting: Array<{ meta: KpiMeta; value: KpiValue | undefined }>;
  insights: Insight[];
  charts: ReportChart[];
  health: HealthReport | null;
  fmt: FormatOptions;
}

type EChartsModule = Awaited<ReturnType<typeof loadECharts>>;

const PendingContext = React.createContext<{ add: () => () => void; echarts: EChartsModule | null }>({
  add: () => () => {},
  echarts: null,
});

/** One chart drawn once, statically, at its laid-out size; signals the renderer when it has finished. */
export function StaticChart({
  chart,
  fmt,
  height,
  pixelRatio = 2,
}: {
  chart: ReportChart;
  fmt: FormatOptions;
  /** Height in pixels; without it the chart fills its parent (which must have a height). */
  height?: number;
  /** Canvas pixels per laid-out pixel: 2 for print, more when a slide scales the chart up. */
  pixelRatio?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const { add, echarts } = React.useContext(PendingContext);
  React.useLayoutEffect(() => {
    if (!ref.current || !echarts) return;
    const done = add();
    const inst: EChartsType = echarts.default.init(ref.current, undefined, {
      renderer: "canvas",
      devicePixelRatio: pixelRatio,
    });
    const option = buildOption({
      tokens: readChartTokens(ref.current),
      fmt,
      kind: chart.kind,
      spec: chart.spec,
      data: chart.data,
      animate: false,
      forExport: true,
      // Laid out off-screen at its real size, so labels are fitted to the width it is drawn at.
      width: ref.current.clientWidth || undefined,
    });
    let finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        done();
      }
    };
    inst.on("finished", finish);
    if (option) inst.setOption(option);
    else finish();
    const t = setTimeout(finish, 4000);
    return () => {
      clearTimeout(t);
      inst.dispose();
    };
  }, [chart, fmt, add, echarts, pixelRatio]);
  return <div ref={ref} style={{ width: "100%", height: height ?? "100%" }} />;
}

function ChartBlock({
  chart,
  fmt,
  height,
  figure,
  source,
}: {
  chart: ReportChart;
  fmt: FormatOptions;
  height: number;
  /** Figure number in the report, which the insights cite. */
  figure?: number;
  /** Where the numbers come from: file, rows, period and filters. */
  source?: string;
}) {
  // As an analyst lays out a figure: number, title, unit; the chart; then its notes and source.
  const subtitle = chartSubtitle(chart.spec, chart.data, fmt, chart.kind);
  return (
    <section
      className="flex flex-col rounded-[14px] border border-border bg-surface-1 p-6"
      style={{ breakInside: "avoid" }}
    >
      {figure ? (
        <p className="text-[11.5px] font-medium tracking-[0.12em] text-fg-subtle uppercase">
          Figure {figure}
        </p>
      ) : null}
      <h3 className="mt-1 text-[19px] font-medium text-fg">{chart.spec.title}</h3>
      {/* What the figure shows, in a sentence computed from its data. */}
      {chart.data.headline && !chart.data.empty ? (
        <p className="mt-1 text-[15px] leading-snug text-fg">{chart.data.headline}</p>
      ) : null}
      {subtitle ? <p className="mt-1 text-[13px] text-fg-subtle">{subtitle}</p> : null}
      <div className="mt-4 min-h-0 flex-1">
        {chart.data.empty ? (
          <p className="text-[14px] text-fg-subtle">{chart.data.notes[0] ?? "No data for this selection."}</p>
        ) : rendersWithECharts(chart.kind, chart.data) ? (
          <StaticChart chart={chart} fmt={fmt} height={height} />
        ) : (
          <div style={{ height, overflow: "hidden" }}>
            {/* As many rows as the space holds (header and the "showing" line taken off), never a scrollbar. */}
            <DataTable
              spec={chart.spec}
              data={chart.data}
              fmt={fmt}
              maxRows={Math.max(3, Math.floor((height - 70) / 31))}
              print
            />
          </div>
        )}
      </div>
      <div className="mt-3 grid gap-1 text-[12px] leading-relaxed text-fg-subtle">
        {chart.data.notes.length && !chart.data.empty ? <p>Note: {chart.data.notes.join(" ")}</p> : null}
        {source ? <p>Source: {source}</p> : null}
      </div>
    </section>
  );
}

function KpiTile({ meta, value, fmt }: { meta: KpiMeta; value: KpiValue | undefined; fmt: FormatOptions }) {
  const pct = meta.format === "percent";
  const change = pct ? value?.deltaAbs : value?.delta;
  // A change that shows as 0.0% is neutral, as on the dashboard's cards, not bad news in red.
  const good =
    change === null || change === undefined || meta.direction === "neutral" || isFlatChange(change)
      ? null
      : change > 0 === (meta.direction === "higher");
  return (
    <div className="rounded-[14px] border border-border bg-surface-1 p-5">
      <p className="text-[14px] text-fg-muted">{kpiLabel(meta)}</p>
      <p className="mt-2 text-[34px] leading-none font-semibold tracking-[-0.02em] text-fg">
        {formatValue(value?.value ?? null, meta.format, { ...fmt, compact: meta.format === "currency" })}
      </p>
      {change !== null && change !== undefined ? (
        <p
          className={`mt-3 text-[13px] font-medium ${good === null ? "text-fg-muted" : good ? "text-success" : "text-danger"}`}
        >
          {value?.currentLabel ? (
            <span className="font-normal text-fg-muted">
              {value.currentLabel}{" "}
              {formatValue(value.current, meta.format, { ...fmt, compact: meta.format === "currency" })}:{" "}
            </span>
          ) : null}
          {pct ? formatPointDelta(change, fmt.locale) : formatDelta(change, fmt.locale)}{" "}
          {!value?.currentLabel && value?.previous !== null && value?.previous !== undefined ? (
            <span className="font-normal text-fg-subtle">
              from{" "}
              {formatValue(value.previous, meta.format, { ...fmt, compact: meta.format === "currency" })}{" "}
            </span>
          ) : null}
          <span className="font-normal text-fg-subtle">{value?.comparisonLabel}</span>
        </p>
      ) : (
        <p className="mt-3 text-[13px] text-fg-subtle">{value?.comparisonLabel ?? ""}</p>
      )}
    </div>
  );
}

function Page({
  children,
  index,
  total,
  input,
}: {
  children: React.ReactNode;
  index: number;
  total: number;
  input: ReportInput;
}) {
  return (
    <div
      data-report-page
      className="relative flex flex-col bg-bg text-fg"
      style={{ width: 1240, height: 1754, padding: "72px 80px 64px" }}
    >
      <header className="flex items-center justify-between border-b border-border pb-5">
        <Wordmark size="md" />
        <div className="text-right">
          <p className="text-[13px] font-medium text-fg">{input.title}</p>
          <p className="text-[12px] text-fg-subtle">{input.fileName}</p>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col pt-8">{children}</div>
      <footer className="flex items-center justify-between border-t border-border pt-4 text-[11.5px] text-fg-subtle">
        <span>
          Generated locally by Loupe on {input.generatedAt}. Data never left the browser.
          {input.isDemo ? " Demo data, not real transactions." : ""}
        </span>
        <span>
          Page {index} of {total}
        </span>
      </footer>
    </div>
  );
}

export function ReportDocument({ input }: { input: ReportInput }) {
  const chartPages: ReportChart[][] = [];
  for (let i = 0; i < input.charts.length; i += 2) chartPages.push(input.charts.slice(i, i + 2));
  const total = 1 + chartPages.length + 1;
  // Figures are numbered in dashboard order; an insight about a chart cites its figure.
  const figureOf = new Map(input.charts.map((c, i) => [c.spec.id, i + 1]));
  const source = `${input.fileName}, ${formatCount(input.rows, input.fmt.locale)} rows, ${input.period}${input.filters !== "None" ? `; ${input.filters}` : ""}.`;
  const facts: Array<[string, string]> = [
    ["Period", input.periodName ? `${input.periodName}: ${input.period}` : input.period],
    ["Compared with", input.comparison ?? "No comparison"],
    ["Filters", input.filters],
    ["Rows analysed", formatCount(input.rows, input.fmt.locale)],
    ["Data up to", input.dataTo ?? "—"],
    ["Grain", input.grain],
  ];
  const glossary = [...input.hero, ...input.supporting.slice(0, 12)];
  return (
    <div className="flex flex-col gap-0 font-sans">
      <Page index={1} total={total} input={input}>
        <p className="text-[13px] font-medium tracking-[0.14em] text-fg-subtle uppercase">
          Performance report
        </p>
        <h1 className="mt-3 font-display text-[60px] leading-[1.02] text-fg">{input.title}</h1>
        <p className="mt-3 text-[18px] text-fg-muted">{input.subtitle}</p>
        <dl className="mt-7 grid grid-cols-3 gap-x-6 gap-y-4 rounded-[14px] border border-border bg-surface-1 p-5">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11.5px] tracking-[0.1em] text-fg-subtle uppercase">{k}</dt>
              <dd className="mt-1 text-[14px] text-fg">{v}</dd>
            </div>
          ))}
        </dl>
        <h2 className="mt-8 text-[15px] font-medium text-fg">Headline KPIs</h2>
        <div className="mt-3 grid grid-cols-3 gap-4">
          {input.hero.map((h) => (
            <KpiTile key={h.meta.id} meta={h.meta} value={h.value} fmt={input.fmt} />
          ))}
        </div>
        {input.insights.length ? (
          <>
            <h2 className="mt-8 text-[15px] font-medium text-fg">Executive summary</h2>
            <ol className="mt-3 grid gap-3">
              {input.insights.slice(0, 4).map((i, n) => {
                const fig = i.chartId ? figureOf.get(i.chartId) : undefined;
                return (
                  <li key={i.id} className="flex gap-3 text-[14px] leading-relaxed">
                    <span className="font-figures text-fg-subtle">{n + 1}.</span>
                    <span>
                      <span className="font-medium text-fg">{i.title}.</span>{" "}
                      <span className="text-fg-muted">{i.body}</span>
                      {fig ? <span className="text-fg-subtle"> (Figure {fig})</span> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        ) : null}
        {input.supporting.length ? (
          <>
            <h2 className="mt-8 text-[15px] font-medium text-fg">Supporting KPIs</h2>
            <div className="mt-3 grid grid-cols-2 gap-x-10">
              {input.supporting.slice(0, 12).map((s) => {
                const pct = s.meta.format === "percent";
                const change = pct ? s.value?.deltaAbs : s.value?.delta;
                return (
                  <div
                    key={s.meta.id}
                    className="flex items-baseline justify-between gap-4 border-b border-border py-2 text-[14px]"
                  >
                    <span className="min-w-0 truncate text-fg-muted">{kpiLabel(s.meta)}</span>
                    <span className="font-figures shrink-0 text-fg">
                      {formatValue(s.value?.value ?? null, s.meta.format, {
                        ...input.fmt,
                        compact: s.meta.format === "currency",
                      })}
                      {change !== null && change !== undefined ? (
                        <span className="ml-2 text-[12.5px] text-fg-subtle">
                          {pct
                            ? formatPointDelta(change, input.fmt.locale)
                            : formatDelta(change, input.fmt.locale)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
      </Page>
      {chartPages.map((pair, i) => (
        <Page key={i} index={i + 2} total={total} input={input}>
          <div className="grid h-full grid-rows-2 gap-6">
            {pair.map((c) => (
              <ChartBlock
                key={c.spec.id}
                chart={c}
                fmt={input.fmt}
                height={520}
                figure={figureOf.get(c.spec.id)}
                source={source}
              />
            ))}
          </div>
        </Page>
      ))}
      <Page index={total} total={total} input={input}>
        <h2 className="font-display text-[40px] text-fg">Appendix</h2>
        <h3 className="mt-6 text-[16px] font-medium text-fg">KPI glossary</h3>
        <dl className="mt-3 grid gap-2.5">
          {glossary.map((h) => (
            <div key={h.meta.id} className="text-[13px] leading-relaxed">
              <dt className="font-medium text-fg">{h.meta.name}</dt>
              <dd className="text-fg-muted">
                {h.meta.definition} Formula: {h.meta.formula}.
                {h.meta.caveat ? ` Caveat: ${h.meta.caveat}` : ""}
              </dd>
            </div>
          ))}
        </dl>
        {input.health ? (
          <>
            <h3 className="mt-8 text-[16px] font-medium text-fg">
              Data health: {input.health.score}/100 ({input.health.grade})
            </h3>
            <p className="mt-1 text-[14px] text-fg-muted">{input.health.summary}</p>
            <ul className="mt-4 grid gap-2.5">
              {input.health.issues.slice(0, 8).map((x) => (
                <li key={x.id} className="text-[13px]">
                  <span className="font-medium text-fg">{x.title}.</span>{" "}
                  <span className="text-fg-muted">{x.detail}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="mt-8 text-[12.5px] leading-relaxed text-fg-subtle">
          Every figure is computed from the file named above; nothing is estimated. Ratios are recomputed from
          their totals for every period and segment (never summed or averaged). Rates change in percentage
          points (pp). Benchmarks, where shown in the app, are indicative ranges and are not computed from
          this data.
        </p>
      </Page>
    </div>
  );
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Mounts a tree off-screen in the light theme and resolves once every chart has finished drawing. */
export async function renderOffscreen(
  node: React.ReactNode,
  width: number,
  opts: { transparent?: boolean } = {},
): Promise<{ host: HTMLDivElement; cleanup: () => void }> {
  const echarts = await loadECharts();
  const host = document.createElement("div");
  host.setAttribute("data-theme", "light");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "fixed",
    left: "-30000px",
    top: "0",
    width: `${width}px`,
    pointerEvents: "none",
    background: opts.transparent ? "transparent" : "",
  });
  document.body.appendChild(host);
  let pending = 0;
  const waiters: Array<() => void> = [];
  const add = () => {
    pending++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      pending--;
      if (pending === 0) waiters.splice(0).forEach((w) => w());
    };
  };
  const root = createRoot(host);
  root.render(<PendingContext.Provider value={{ add, echarts }}>{node}</PendingContext.Provider>);
  await frame();
  await frame();
  if (document.fonts?.ready) await document.fonts.ready;
  if (pending > 0) await new Promise<void>((r) => waiters.push(r));
  await frame();
  return {
    host,
    cleanup: () => {
      root.unmount();
      host.remove();
    },
  };
}

export async function exportPdf(
  input: ReportInput,
  fileName: string,
  onProgress?: (msg: string) => void,
): Promise<void> {
  onProgress?.("Laying out pages…");
  const { host, cleanup } = await renderOffscreen(<ReportDocument input={input} />, 1240);
  try {
    const [{ toJpeg }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
    const pages = [...host.querySelectorAll<HTMLElement>("[data-report-page]")];
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    pdf.setProperties({ title: input.title, subject: input.subtitle, creator: "Loupe" });
    for (let i = 0; i < pages.length; i++) {
      onProgress?.(`Rendering page ${i + 1} of ${pages.length}…`);
      const img = await toJpeg(pages[i] as HTMLElement, {
        pixelRatio: 2,
        quality: 0.9,
        backgroundColor: "#f7f6f2",
      });
      if (i > 0) pdf.addPage();
      pdf.addImage(img, "JPEG", 0, 0, 210, 297, undefined, "FAST");
    }
    pdf.save(fileName);
  } finally {
    cleanup();
  }
}
