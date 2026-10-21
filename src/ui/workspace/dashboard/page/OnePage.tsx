"use client";

/**
 * The one-page dashboard: the dashboard as a single landscape page, laid out
 * the way analysts build a report page for an executive.
 *
 * - A sidebar of slicers (the period, the main filters) that shows what is
 *   selected, and where the numbers come from.
 * - A banner with the page's title, what it covers, and the period and what
 *   the changes compare with.
 * - Six headline KPIs, each with an icon for its kind of measure, its value
 *   and its change.
 * - Five charts from the dashboard (pagePlan.ts picks and places them), each
 *   led by its takeaway.
 * - The key insights.
 *
 * In the app the page is live: the slicers filter everything, charts have
 * tooltips, the title can be renamed, and on a large screen the page keeps a
 * 16:9 shape that fits the window (it stacks on smaller ones). The same
 * component renders off-screen at 1280 × 720 for the download
 * (exportOnePage), so the image is the page on the screen. Every figure is
 * the dashboard's own: nothing here computes a number.
 *
 * On the live page, long text (takeaways, insights, the subtitle, the file
 * name) is clamped and opens in full on hover, focus or a long press
 * (ClampText, ui/primitives/reveal.tsx); an insight's sentence with its
 * figures is two lines. Below lg, where the sidebar's footnote is hidden,
 * the banner's ⓘ holds it (and on a phone "Data to"). The download keeps its
 * fixed layout.
 */
import * as React from "react";
import {
  Activity,
  Banknote,
  CalendarRange,
  Check,
  ChevronDown,
  Clock,
  Gauge,
  Hash,
  Lightbulb,
  MousePointerClick,
  Package,
  Percent,
  Receipt,
  Repeat,
  RotateCcw,
  Search,
  ShoppingCart,
  Star,
  Target,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  UserMinus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Insight } from "@/engine/insights/insights";
import type { KpiValue } from "@/engine/kpi/compute";
import type { KpiMeta } from "@/engine/session";
import { formatRange, formatDay } from "@/engine/core/dates";
import { formatCount, formatValue, type FormatOptions } from "@/engine/core/format";
import { formatKpi } from "@/ui/common/kpiFormat";
import { kpiLabel } from "@/engine/core/labels";
import { PRESET_LABEL, presetAvailable, type DatePreset } from "@/engine/core/periods";
import type { ValueCount } from "@/engine/profile/types";
import { allSpecs, isRosterView, kpiLayoutOf, useWorkspace } from "@/store/workspace";
import { engine } from "@/lib/engine-client";
import { cn, downloadBlob, exportFileName } from "@/lib/utils";
import { useAnimate, useChartThemeKey, useFmt } from "@/ui/common/hooks";
import { DomainIcon } from "@/ui/common/domain-icon";
import { EChart } from "@/ui/charts/EChart";
import { buildOption } from "@/ui/charts/options";
import { readChartTokens } from "@/ui/charts/tokens";
import { Checkbox } from "@/ui/primitives/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/primitives/popover";
import { ClampText, InfoTip } from "@/ui/primitives/reveal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/primitives/dropdown-menu";
import { DeltaChip, orderByGoal, sharedComparison } from "../KpiCards";
import { renderOffscreen, StaticChart } from "../../export/report";
import {
  defaultPageTitle,
  kpiIconName,
  pageKpiIds,
  pageSubtitle,
  pickPageCharts,
  placeCharts,
  slicerValue,
  yearOf,
  yearRange,
  yearsIn,
  type KpiIconName,
  type PlacedChart,
} from "./pagePlan";

/** The page's size when drawn for a download (16:9); the image is three times this. */
export const PAGE_W = 1280;
export const PAGE_H = 720;

/** The date presets a slicer offers, as the filter rail does. */
const PRESETS: DatePreset[] = ["all", "last12m", "last6m", "last90d", "last30d", "ytd", "prevYear"];

type State = ReturnType<typeof useWorkspace.getState>;

/** The workspace slices the page reads. */
type PageState = Pick<
  State,
  | "context"
  | "summary"
  | "kpiBatch"
  | "charts"
  | "widgets"
  | "customCharts"
  | "insights"
  | "datePreset"
  | "customRange"
  | "dimFilters"
  | "lastCompute"
  | "kpiLayout"
  | "extraKpis"
  | "business"
>;

export interface PageModel {
  title: string;
  /** True when the title is the automatic one (shown until the user names the page). */
  autoTitle: boolean;
  subtitle: string;
  industry: { name: string; icon: string; shape: string | null };
  /** "Last 12 months", "2025", or a custom range. */
  periodLabel: string;
  /** The dates the period covers, "1 Oct 2025 – 30 Sep 2026". */
  periodRange: string | null;
  /**
   * What the changes compare with, as the banner says it ("Change vs 1 Oct
   * 2024 – 30 Sep 2025", "Change: Sep 2026 vs Sep 2025"), or why there are no
   * changes ("All employees in the file · no period comparison").
   */
  comparison: string | null;
  /** The no-change reason the banner states once, so a KPI tile doesn't repeat it. */
  sharedReason: string | undefined;
  dataTo: string | null;
  /** Dimension slicers: the first four filters, plus any other that is set. */
  slicers: Array<{ column: string; label: string; values: string[] }>;
  kpis: Array<{ meta: KpiMeta; value: KpiValue | undefined }>;
  charts: PlacedChart[];
  insights: Insight[];
  fileName: string;
  /** "28,621 of 49,037 rows" or "49,037 rows". */
  rows: string;
  isDemo: boolean;
  fmt: FormatOptions;
}

/**
 * The page from the workspace: the dashboard's own KPIs, charts and insights,
 * chosen and placed for one page. `title` is the user's name for the page.
 */
export function pageModel(s: PageState, fmt: FormatOptions, title?: string | null): PageModel | null {
  const ctx = s.context;
  if (!ctx || !s.summary) return null;
  const metas = new Map(ctx.kpis.map((k) => [k.id, k]));
  const values = new Map(s.kpiBatch?.values.map((v) => [v.id, v]) ?? []);
  const layout = kpiLayoutOf(s);
  // The user's own order stands as set; the recommended heroes follow the user's main goal.
  const hero = s.kpiLayout ? layout.hero : orderByGoal(layout.hero, metas, s.business.goal);
  const kpis = pageKpiIds(hero, layout.supporting)
    .map((id) => metas.get(id))
    .filter((m): m is KpiMeta => Boolean(m))
    .map((meta) => ({ meta, value: values.get(meta.id) }));
  const shape = ctx.domain.subDomains.find((x) => x.id === ctx.subDomainId)?.name ?? null;
  const roster = isRosterView(ctx);
  const year = s.datePreset === "custom" ? yearOf(s.customRange) : null;
  const periodLabel = year
    ? String(year)
    : s.datePreset === "custom" && s.customRange
      ? formatRange(s.customRange.from, s.customRange.to)
      : PRESET_LABEL[s.datePreset];
  const shared = s.kpiBatch ? sharedComparison(s.kpiBatch.values) : null;
  const filtered = new Map(
    s.dimFilters.filter((f) => f.kind === "in").map((f) => [f.column, f.kind === "in" ? f.values : []]),
  );
  const dims = ctx.dimensions;
  const shown = [...dims.slice(0, 4), ...dims.slice(4).filter((d) => filtered.has(d.column))];
  const inView = s.lastCompute?.rows;
  return {
    title: title?.trim() || defaultPageTitle(ctx.domain.name, { generic: ctx.domain.generic, roster }),
    autoTitle: !title?.trim(),
    subtitle: pageSubtitle(
      kpis.map((k) => k.meta.group),
      shape ?? ctx.domain.name,
    ),
    industry: { name: ctx.domain.name, icon: ctx.domain.icon, shape },
    periodLabel,
    periodRange: s.kpiBatch?.period?.label ?? null,
    comparison: !shared
      ? null
      : !shared.changes
        ? shared.label
        : shared.current
          ? `Change: ${shared.current} ${shared.label}`
          : `Change ${shared.label}`,
    sharedReason: shared && !shared.changes ? shared.label : undefined,
    dataTo: ctx.dateBounds ? formatDay(ctx.dateBounds.max) : null,
    slicers: shown.map((d) => ({ column: d.column, label: d.label, values: filtered.get(d.column) ?? [] })),
    kpis,
    charts: placeCharts(pickPageCharts(s.widgets, allSpecs(s), s.charts)),
    insights: (s.insights ?? []).slice(0, 3),
    fileName: s.summary.fileName,
    rows:
      inView !== undefined && inView !== s.summary.rowCount
        ? `${formatCount(inView, fmt.locale)} of ${formatCount(s.summary.rowCount, fmt.locale)} rows`
        : `${formatCount(s.summary.rowCount, fmt.locale)} rows`,
    isDemo: s.summary.isDemo,
    fmt,
  };
}

/** The live page's model, rebuilt when anything it shows changes. */
export function usePageModel(title?: string | null): PageModel | null {
  const fmt = useFmt();
  // Each slice the page reads, so it follows filters, recomputes, renames and insights.
  const context = useWorkspace((s) => s.context);
  const summary = useWorkspace((s) => s.summary);
  const kpiBatch = useWorkspace((s) => s.kpiBatch);
  const charts = useWorkspace((s) => s.charts);
  const widgets = useWorkspace((s) => s.widgets);
  const customCharts = useWorkspace((s) => s.customCharts);
  const insights = useWorkspace((s) => s.insights);
  const datePreset = useWorkspace((s) => s.datePreset);
  const customRange = useWorkspace((s) => s.customRange);
  const dimFilters = useWorkspace((s) => s.dimFilters);
  const lastCompute = useWorkspace((s) => s.lastCompute);
  const kpiLayout = useWorkspace((s) => s.kpiLayout);
  const extraKpis = useWorkspace((s) => s.extraKpis);
  const business = useWorkspace((s) => s.business);
  return React.useMemo(
    () =>
      pageModel(
        // prettier-ignore
        { context, summary, kpiBatch, charts, widgets, customCharts, insights, datePreset, customRange, dimFilters, lastCompute, kpiLayout, extraKpis, business },
        fmt,
        title,
      ),
    // prettier-ignore
    [context, summary, kpiBatch, charts, widgets, customCharts, insights, datePreset, customRange, dimFilters, lastCompute, kpiLayout, extraKpis, business, fmt, title],
  );
}

// ---------------------------------------------------------------- pieces

const KPI_ICONS: Record<KpiIconName, LucideIcon> = {
  money: Banknote,
  profit: TrendingUp,
  cost: Receipt,
  pay: Wallet,
  orders: ShoppingCart,
  people: Users,
  loss: UserMinus,
  returns: RotateCcw,
  rating: Star,
  time: Clock,
  units: Package,
  traffic: MousePointerClick,
  conversion: Target,
  retention: Repeat,
  average: Gauge,
  percent: Percent,
  count: Hash,
};

/** A tint of one of the chart colours, mixed into the card surface (tokens only). */
const tint = (i: number, pct: number) =>
  `color-mix(in oklab, var(--chart-${(i % 8) + 1}) ${pct}%, var(--surface-1))`;

function KpiTile({
  meta,
  value,
  index,
  fmt,
  sharedReason,
}: {
  meta: KpiMeta;
  value: KpiValue | undefined;
  index: number;
  fmt: FormatOptions;
  /** The no-change reason the banner states once (the tile then says nothing in its place). */
  sharedReason?: string;
}) {
  const Icon = KPI_ICONS[kpiIconName(meta)] ?? Activity;
  const v = value?.value ?? null;
  // Written as on the dashboard's cards, the slides and the report (formatKpi).
  const shown = value?.rows === 0 ? "—" : formatKpi(v, meta.format, fmt);
  // A headline figure is never cut short: past six characters the size steps down with the length,
  // so "R$607.07" or "CHF 1.2M" fits a sixth of the page as "₹607.07" does.
  const fit = Math.min(1, 6.5 / Math.max(6.5, shown.length));
  return (
    <div
      className="flex min-w-0 items-stretch gap-[0.55cqw] rounded-[12px] border border-border p-[max(8px,0.75cqw)]"
      style={{ background: tint(index, 7) }}
      title={`${meta.name}: ${formatValue(v, meta.format, fmt)}`}
    >
      <span
        className="grid size-[clamp(24px,2.2cqw,36px)] shrink-0 place-items-center self-start rounded-[9px]"
        style={{ background: tint(index, 20), color: `var(--chart-${(index % 8) + 1})` }}
      >
        <Icon className="size-[55%]" aria-hidden />
      </span>
      {/* The value and its change sit at the foot, so they line up across the row whatever the name's length. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Up to two lines, so a longer name ("Average tenure (years)") isn't cut off. 11 px on the
            1280 px download, with a small icon, so a name like "Average order value" keeps to one line
            there: a second line in any tile costs every chart on the page its height. */}
        <p className="line-clamp-2 text-[clamp(11px,0.88cqw,14px)] leading-tight font-medium text-fg-muted">
          {kpiLabel(meta)}
        </p>
        {/* Fluid with the page, 24 px on the 1280 px download; Inter's optical size tightens it. */}
        <p
          className="font-figures mt-auto truncate pt-[0.3cqw] text-[clamp(18px,1.88cqw,30px)] leading-none font-semibold text-fg"
          style={fit < 1 ? { fontSize: `calc(clamp(18px, 1.88cqw, 30px) * ${fit.toFixed(3)})` } : undefined}
        >
          {shown}
        </p>
        {value ? (
          // A flex row, so the line is the chip's own height rather than the body's line height.
          <div className="mt-[0.4cqw] flex min-w-0 overflow-hidden">
            <DeltaChip meta={meta} value={value} size="sm" shared={sharedReason} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A slicer as a report page draws one: its name above a box holding the selection. */
function SlicerBox({ label, value, open }: { label: string; value: string; open?: boolean }) {
  return (
    <span className="block min-w-0 text-left">
      <span className="eyebrow block truncate text-fg-subtle">{label}</span>
      <span
        className={cn(
          "mt-[3px] flex h-[clamp(26px,2.3cqw,34px)] min-w-0 items-center justify-between gap-2 rounded-[8px] border bg-surface-1 px-[9px] text-[clamp(11px,0.9cqw,14px)]",
          value === "All" ? "border-border text-fg-muted" : "border-border-accent text-fg",
          open && "border-accent",
        )}
      >
        <span className="truncate">{value}</span>
        <ChevronDown className="size-[1em] shrink-0 text-fg-subtle" aria-hidden />
      </span>
    </span>
  );
}

/** The live period slicer: the dashboard's presets and the calendar years in the data. */
function PeriodSlicer({ label }: { label: string }) {
  const bounds = useWorkspace((s) => s.context?.dateBounds);
  const preset = useWorkspace((s) => s.datePreset);
  const custom = useWorkspace((s) => s.customRange);
  const setPreset = useWorkspace((s) => s.setDatePreset);
  const [open, setOpen] = React.useState(false);
  if (!bounds) return <SlicerBox label="Period" value="All rows" />;
  const latest = new Date(bounds.max).getUTCFullYear();
  const year = preset === "custom" ? yearOf(custom) : null;
  const current = year ? `year:${year}` : preset === "custom" ? "custom" : `preset:${preset}`;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="block w-full rounded-[8px] text-left"
          aria-label={`Period: ${label}`}
        >
          <SlicerBox label="Period" value={label} open={open} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(v) => {
            const [kind, key] = v.split(":");
            if (kind === "preset") setPreset(key as DatePreset);
            else if (kind === "year") {
              const y = Number(key);
              // The year still running is "year to date", compared with the same months a year before.
              if (y === latest && presetAvailable("ytd", bounds)) setPreset("ytd");
              else setPreset("custom", yearRange(y));
            }
          }}
        >
          <DropdownMenuLabel>Period</DropdownMenuLabel>
          {PRESETS.filter((p) => presetAvailable(p, bounds)).map((p) => (
            <DropdownMenuRadioItem key={p} value={`preset:${p}`}>
              {PRESET_LABEL[p]}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Calendar year</DropdownMenuLabel>
          {yearsIn(bounds).map((y) => (
            <DropdownMenuRadioItem key={y} value={`year:${y}`}>
              {y === latest ? `${y} to date` : y}
            </DropdownMenuRadioItem>
          ))}
          {current === "custom" && custom ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuRadioItem value="custom" disabled>
                {formatRange(custom.from, custom.to)}
              </DropdownMenuRadioItem>
            </>
          ) : null}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A live dimension slicer: search, "All", and a checklist of the column's values with their counts. */
function DimSlicer({ column, label }: { column: string; label: string }) {
  const selected = useWorkspace((s) => {
    const f = s.dimFilters.find((x) => x.column === column);
    return f && f.kind === "in" ? f.values : NONE;
  });
  const setFilter = useWorkspace((s) => s.setDimFilter);
  const fmt = useFmt();
  const profileValues = useWorkspace(
    (s) => s.context?.profile.columns.find((c) => c.name === column)?.categorical?.all,
  );
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [remote, setRemote] = React.useState<ValueCount[] | null>(null);
  React.useEffect(() => {
    if (profileValues || !open) return;
    let alive = true;
    void engine()
      .columnValues(column, 200, q)
      .then((v) => alive && setRemote(v));
    return () => {
      alive = false;
    };
  }, [column, q, profileValues, open]);
  const values = (profileValues ?? remote ?? []).filter(
    (v) => !q || v.value.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="block w-full rounded-[8px] text-left"
          aria-label={`${label}: ${slicerValue(selected)}`}
        >
          <SlicerBox label={label} value={slicerValue(selected)} open={open} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        collisionPadding={8}
        className="w-72 p-0"
        aria-label={`Filter by ${label}`}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-3.5 text-fg-subtle" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}`}
            className="h-7 flex-1 bg-transparent text-ui text-fg outline-none placeholder:text-fg-subtle"
            aria-label={`Search ${label}`}
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          <button
            type="button"
            onClick={() => setFilter(column, [])}
            className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-ui text-fg hover:bg-surface-3"
          >
            <Check className={cn("size-3.5", selected.length ? "invisible" : "text-accent")} aria-hidden />
            All
          </button>
          {values.slice(0, 200).map((v) => {
            const on = selected.includes(v.value);
            return (
              <label
                key={v.value}
                className="flex cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 text-ui text-fg hover:bg-surface-3"
              >
                <Checkbox
                  checked={on}
                  onCheckedChange={(x) =>
                    setFilter(column, x ? [...selected, v.value] : selected.filter((y) => y !== v.value))
                  }
                />
                <span className="flex-1 truncate">{v.value}</span>
                {v.count ? (
                  <span className="font-figures text-xs text-fg-subtle">
                    {formatCount(v.count, fmt.locale)}
                  </span>
                ) : null}
              </label>
            );
          })}
          {!values.length ? <p className="px-2 py-3 text-ui text-fg-subtle">No matching values.</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A stable empty selection, so the selector above doesn't return a new array on every read. */
const NONE: string[] = [];

function Sidebar({ model, live }: { model: PageModel; live: boolean }) {
  const clear = useWorkspace((s) => s.clearFilters);
  // Offered when a filter is set; the period has its own slicer (clearing goes back to the default period).
  const anyFilter = model.slicers.some((s) => s.values.length);
  return (
    <aside
      aria-label="Page filters"
      className={cn(
        "flex min-w-0 flex-col gap-[max(8px,0.8cqw)] rounded-[14px] border border-border bg-surface-1 p-[max(10px,0.9cqw)]",
        live ? "lg:min-h-0" : "min-h-0",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid size-[clamp(26px,2.3cqw,34px)] shrink-0 place-items-center rounded-[9px] border border-border-accent bg-accent-soft">
          <DomainIcon name={model.industry.icon} className="size-[55%] text-accent" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[clamp(12px,1cqw,15px)] font-semibold text-fg">{model.industry.name}</p>
          {model.industry.shape ? (
            <p className="truncate text-[clamp(11px,0.88cqw,13px)] text-fg-subtle">{model.industry.shape}</p>
          ) : null}
        </div>
      </div>
      <div className={cn("grid gap-[max(7px,0.6cqw)]", live && "grid-cols-2 sm:grid-cols-3 lg:grid-cols-1")}>
        {live ? (
          <PeriodSlicer label={model.periodLabel} />
        ) : (
          <SlicerBox label="Period" value={model.periodLabel} />
        )}
        {model.slicers.map((s) =>
          live ? (
            <DimSlicer key={s.column} column={s.column} label={s.label} />
          ) : (
            <SlicerBox key={s.column} label={s.label} value={slicerValue(s.values)} />
          ),
        )}
      </div>
      {live && anyFilter ? (
        <button
          type="button"
          onClick={clear}
          className="self-start text-[clamp(12px,0.94cqw,14px)] text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
        >
          Clear filters
        </button>
      ) : null}
      {/* Where the numbers come from, as a report page's footnote. */}
      <div
        className={cn(
          "mt-auto min-w-0 border-t border-border pt-[0.6cqw] text-[clamp(11px,0.88cqw,13px)] leading-snug text-fg-subtle",
          live && "hidden lg:block",
        )}
      >
        {live ? (
          <ClampText key={model.fileName} className="font-medium text-fg-muted">
            {model.fileName}
          </ClampText>
        ) : (
          <p className="truncate font-medium text-fg-muted" title={model.fileName}>
            {model.fileName}
          </p>
        )}
        <p className="tabular">{model.rows}</p>
        {model.dataTo ? <p>Data to {model.dataTo}</p> : null}
        {model.isDemo ? <p>Demo data: not real</p> : null}
      </div>
    </aside>
  );
}

function Banner({
  model,
  live,
  onRename,
}: {
  model: PageModel;
  live: boolean;
  onRename?: (title: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  return (
    <header
      className="relative flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 overflow-hidden rounded-[14px] border border-border px-[max(14px,1.4cqw)] py-[max(10px,0.9cqw)]"
      style={{ background: `linear-gradient(105deg, ${tint(0, 16)} 0%, var(--surface-1) 64%)` }}
    >
      {/* The industry's icon as a faint watermark off the banner's right edge, as a report page's banner picture. */}
      <DomainIcon
        name={model.industry.icon}
        className="pointer-events-none absolute top-1/2 -right-[1.5cqw] size-[clamp(90px,10cqw,160px)] -translate-y-1/2 text-[var(--chart-1)] opacity-[0.06]"
      />
      <div className="relative min-w-0 flex-[1_1_320px]">
        {/* The serif at its smallest display size; a step up only on a page wider than 1440 px (a
            container query on the page, so the 1280 px download, drawn in this same window, never
            takes it). leading-tight, because truncate clips at the line box and would cut descenders.
            Below lg the live page stacks, so the title wraps there rather than losing its end. */}
        {onRename && editing ? (
          <input
            autoFocus
            defaultValue={model.autoTitle ? "" : model.title}
            placeholder={model.title}
            aria-label="Page title"
            onBlur={(e) => {
              onRename(e.currentTarget.value);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-full rounded-[8px] border border-border-accent bg-surface-1 px-2 font-display text-display-xs leading-tight text-fg outline-none @[90rem]:text-display-sm"
          />
        ) : onRename ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Rename this page"
            className="block max-w-full rounded-[8px] text-left font-display text-display-xs leading-tight text-fg hover:text-accent lg:truncate @[90rem]:text-display-sm"
          >
            {model.title}
          </button>
        ) : (
          <h2 className="truncate font-display text-display-xs leading-tight text-fg @[90rem]:text-display-sm">
            {model.title}
          </h2>
        )}
        {live ? (
          <ClampText key={model.subtitle} className="mt-[0.2cqw] text-[clamp(12px,1cqw,15px)] text-fg-muted">
            {model.subtitle}
          </ClampText>
        ) : (
          <p className="mt-[0.2cqw] truncate text-[clamp(12px,1cqw,15px)] text-fg-muted">{model.subtitle}</p>
        )}
      </div>
      <div
        className={cn(
          "relative min-w-0 text-[clamp(11.5px,0.92cqw,13.5px)] leading-snug text-fg-muted",
          live ? "text-left sm:text-right" : "text-right",
        )}
      >
        <p
          className={cn(
            "flex items-center gap-1.5 font-medium text-fg",
            live ? "sm:justify-end" : "justify-end",
          )}
        >
          <CalendarRange className="size-[1.1em] text-accent" aria-hidden />
          {model.periodLabel}
          {model.periodRange && model.periodRange !== model.periodLabel ? (
            <span className="tabular font-normal text-fg-muted">· {model.periodRange}</span>
          ) : null}
          {/* Below lg the sidebar's footnote (the file, its rows, how recent) is hidden: it is here. */}
          {live ? (
            <InfoTip label="About this data" className="font-normal lg:hidden">
              <span className="block font-medium">{model.fileName}</span>
              <span className="tabular block">{model.rows}</span>
              {model.dataTo ? <span className="block">Data to {model.dataTo}</span> : null}
              {model.isDemo ? <span className="block">Demo data: not real</span> : null}
            </InfoTip>
          ) : null}
        </p>
        {model.comparison ? <p className="tabular">{model.comparison}</p> : <p>No comparison period</p>}
        {/* On a phone, behind the ⓘ above. */}
        {model.dataTo ? (
          <p className={cn("tabular", live && "hidden sm:block")}>Data to {model.dataTo}</p>
        ) : null}
      </div>
    </header>
  );
}

/** One chart on the page: its title, its takeaway, and the chart (live, or drawn once for the download). */
function PageChartCard({ chart, live, fmt }: { chart: PlacedChart; live: boolean; fmt: FormatOptions }) {
  return (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-col rounded-[14px] border border-border bg-surface-1 p-[max(10px,0.85cqw)]",
        live
          ? "h-[320px] lg:[grid-column:span_var(--span)/span_var(--span)] lg:[grid-row:span_var(--rows)/span_var(--rows)] lg:h-auto"
          : "[grid-column:span_var(--span)/span_var(--span)] [grid-row:span_var(--rows)/span_var(--rows)]",
      )}
      style={{ "--span": chart.span, "--rows": chart.tall ? 2 : 1 } as React.CSSProperties}
      aria-label={chart.title}
    >
      <h3 className="truncate text-[clamp(13px,1.05cqw,16px)] leading-snug font-semibold text-fg">
        {chart.title}
      </h3>
      {chart.data.headline ? (
        live ? (
          <ClampText
            key={chart.data.headline}
            lines={2}
            className="mt-[2px] text-[clamp(12px,0.94cqw,14px)] leading-snug text-fg-muted"
          >
            {chart.data.headline}
          </ClampText>
        ) : (
          <p className="mt-[2px] line-clamp-2 text-[clamp(12px,0.94cqw,14px)] leading-snug text-fg-muted">
            {chart.data.headline}
          </p>
        )
      ) : null}
      <div className="relative mt-[0.4cqw] min-h-0 flex-1">
        <div className="absolute inset-0">
          {live ? (
            <LiveChart chart={chart} />
          ) : (
            <StaticChart
              chart={{ spec: chart.spec, data: chart.data, kind: chart.kind }}
              fmt={fmt}
              pixelRatio={3}
              presentation
            />
          )}
        </div>
      </div>
    </section>
  );
}

/** A live chart: tooltips, the theme's colours, laid out for its measured width. */
function LiveChart({ chart }: { chart: PlacedChart }) {
  const fmt = useFmt();
  const themeKey = useChartThemeKey();
  const animate = useAnimate();
  const ref = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Rounded to 20 px, so a resize redraws the chart only when its labels could change.
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round((entry?.contentRect.width ?? 0) / 20) * 20;
      const h = Math.round((entry?.contentRect.height ?? 0) / 20) * 20;
      if (w && h)
        setSize((prev) => (prev && prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const option = React.useMemo(() => {
    // themeKey is a dependency only: a theme change must re-read the CSS tokens.
    void themeKey;
    return buildOption({
      tokens: readChartTokens(),
      fmt,
      kind: chart.kind,
      spec: chart.spec,
      data: chart.data,
      animate,
      width: size?.width,
      height: size?.height,
      // Read without hovering: values on the points of a short trend, a donut's shares in a legend.
      presentation: true,
    });
  }, [chart, fmt, themeKey, animate, size]);
  return (
    <div ref={ref} className="h-full w-full">
      <EChart option={option} resetKey={`${chart.kind}-${themeKey}`} ariaLabel={chart.data.altText} />
    </div>
  );
}

const TONE_ICON: Record<Insight["tone"], LucideIcon> = {
  positive: TrendingUp,
  negative: TrendingDown,
  warning: TriangleAlert,
  neutral: Lightbulb,
};

/** The first sentence of an insight's explanation, where its numbers are. */
function firstSentence(text: string): string {
  const t = text.trim();
  return /^.+?[.!?](?=\s|$)/.exec(t)?.[0] ?? t;
}

function InsightStrip({ insights, live }: { insights: Insight[]; live: boolean }) {
  return (
    <section
      aria-label="Key insights"
      className={cn(
        "grid min-w-0 gap-[max(8px,0.8cqw)] rounded-[14px] border border-border bg-surface-1 p-[max(10px,0.85cqw)]",
        live ? "lg:grid-cols-[auto_repeat(3,minmax(0,1fr))]" : "grid-cols-[auto_repeat(3,minmax(0,1fr))]",
      )}
    >
      <p className="eyebrow flex items-center gap-1.5 self-center text-accent">
        <Lightbulb className="size-[1.3em]" aria-hidden />
        Key insights
      </p>
      {insights.length ? (
        insights.map((ins) => {
          const Icon = TONE_ICON[ins.tone];
          return (
            <div
              key={ins.id}
              className={cn(
                "flex min-w-0 gap-[0.6cqw]",
                live ? "lg:border-l lg:border-border lg:pl-[0.9cqw]" : "border-l border-border pl-[0.9cqw]",
              )}
            >
              <Icon
                className={cn(
                  "mt-[2px] size-[clamp(13px,1.05cqw,16px)] shrink-0",
                  ins.tone === "positive"
                    ? "text-success"
                    : ins.tone === "negative"
                      ? "text-danger"
                      : ins.tone === "warning"
                        ? "text-warning"
                        : "text-accent",
                )}
                aria-hidden
              />
              {live ? (
                // Live: the title on one line and the sentence with the figures on two, each opening in
                // full on hover, focus or a long press (the whole explanation is in the Insights step).
                <div className="min-w-0">
                  <ClampText
                    key={ins.title}
                    className="text-[clamp(12px,1cqw,15px)] leading-snug font-semibold text-fg"
                  >
                    {ins.title}
                  </ClampText>
                  <ClampText
                    key={ins.body}
                    lines={2}
                    className="text-[clamp(12px,0.94cqw,14px)] leading-snug text-fg-muted"
                  >
                    {firstSentence(ins.body)}
                  </ClampText>
                </div>
              ) : (
                <div className="min-w-0">
                  <p className="truncate text-[clamp(12px,1cqw,15px)] leading-snug font-semibold text-fg">
                    {ins.title}
                  </p>
                  {/* Three lines at 12 px hold the sentence with both of its figures ("… vs ₹2.23Cr in …"). */}
                  <p className="line-clamp-3 text-[clamp(12px,0.94cqw,14px)] leading-snug text-fg-muted">
                    {firstSentence(ins.body)}
                  </p>
                </div>
              )}
            </div>
          );
        })
      ) : (
        <p className="text-[clamp(12px,0.94cqw,14px)] text-fg-subtle lg:col-span-3">
          {live ? "Finding the key insights…" : "No insights stood out for this selection."}
        </p>
      )}
    </section>
  );
}

/**
 * The page. `live` in the app (slicers filter, charts have tooltips, the title
 * can be renamed); otherwise drawn once at PAGE_W × PAGE_H for the download.
 */
export function OnePage({
  model,
  live,
  onRename,
}: {
  model: PageModel;
  live: boolean;
  onRename?: (title: string) => void;
}) {
  const n = Math.max(1, model.kpis.length);
  return (
    <div
      data-page
      className={cn(
        "@container font-sans text-fg",
        live
          ? "flex flex-col gap-3 lg:mx-auto lg:grid lg:aspect-video lg:w-[min(100%,max(960px,calc((100dvh_-_168px)*16/9)))] lg:grid-cols-[minmax(180px,15%)_minmax(0,1fr)] lg:gap-[10px]"
          : "grid grid-cols-[200px_minmax(0,1fr)] gap-[10px] bg-bg p-[12px]",
      )}
      style={live ? undefined : { width: PAGE_W, height: PAGE_H }}
    >
      <Sidebar model={model} live={live} />
      <div
        className={cn(
          "min-w-0",
          live
            ? "flex flex-col gap-3 lg:grid lg:min-h-0 lg:grid-rows-[auto_auto_minmax(0,1fr)_auto] lg:gap-[10px]"
            : "grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-[10px]",
        )}
      >
        <Banner model={model} live={live} onRename={live ? onRename : undefined} />
        <section
          aria-label="Headline KPIs"
          className={cn(
            "grid gap-[10px]",
            live
              ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(var(--n),minmax(0,1fr))]"
              : "grid-cols-[repeat(var(--n),minmax(0,1fr))]",
          )}
          style={{ "--n": n } as React.CSSProperties}
        >
          {model.kpis.map((k, i) => (
            <KpiTile
              key={k.meta.id}
              meta={k.meta}
              value={k.value}
              index={i}
              fmt={model.fmt}
              sharedReason={model.sharedReason}
            />
          ))}
        </section>
        <div
          className={cn(
            "grid min-w-0 gap-[10px]",
            live ? "lg:min-h-0 lg:grid-cols-6 lg:grid-rows-2" : "min-h-0 grid-cols-6 grid-rows-2",
          )}
        >
          {model.charts.map((c) => (
            <PageChartCard key={c.spec.id} chart={c} live={live} fmt={model.fmt} />
          ))}
        </div>
        <InsightStrip insights={model.insights} live={live} />
      </div>
    </div>
  );
}

/**
 * Makes the page's file from the workspace as it stands: finds the insights
 * first if they haven't been, then draws and saves the page as
 * {dataset}_one-page-dashboard_{date}.png or .pdf.
 */
export async function downloadOnePage(format: "png" | "pdf", fmt: FormatOptions): Promise<void> {
  if (!useWorkspace.getState().insights) await useWorkspace.getState().loadInsights();
  const s = useWorkspace.getState();
  const model = pageModel(s, fmt, s.pageTitle);
  if (!model) throw new Error("There is no dashboard to draw yet.");
  const base = exportFileName(s.summary?.name, "one-page-dashboard", format).replace(/\.(png|pdf)$/, "");
  await exportOnePage(model, format, base);
}

/**
 * Draws the page once, off-screen in the light theme, and saves it: a 16:9
 * PNG at three times the page size (3840 × 2160), or one landscape PDF page.
 * `baseName` is the file name without its extension.
 */
export async function exportOnePage(
  model: PageModel,
  format: "png" | "pdf",
  baseName: string,
): Promise<void> {
  const { host, cleanup } = await renderOffscreen(<OnePage model={model} live={false} />, PAGE_W);
  try {
    const node = host.querySelector<HTMLElement>("[data-page]");
    if (!node) throw new Error("The page couldn't be laid out.");
    const { toBlob, toJpeg } = await import("html-to-image");
    // The light theme's page colour (the page's own background token), under anything transparent.
    const background = getComputedStyle(node).backgroundColor;
    if (format === "png") {
      const blob = await toBlob(node, { pixelRatio: 3, backgroundColor: background });
      if (!blob) throw new Error("The page couldn't be drawn.");
      downloadBlob(blob, `${baseName}.png`);
    } else {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ unit: "pt", format: [960, 540], orientation: "landscape", compress: true });
      pdf.setProperties({ title: model.title, subject: model.subtitle, creator: "Loupe" });
      const img = await toJpeg(node, { pixelRatio: 3, quality: 0.92, backgroundColor: background });
      pdf.addImage(img, "JPEG", 0, 0, 960, 540, undefined, "FAST");
      pdf.save(`${baseName}.pdf`);
    }
  } finally {
    cleanup();
  }
}
