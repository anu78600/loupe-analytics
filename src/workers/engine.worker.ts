/**
 * Engine worker: all parsing, profiling and computation happen here, off the UI thread.
 *
 * Exposes one Session through Comlink; lib/engine-client.ts creates the
 * worker lazily and wraps it. Arguments and results are structured-cloned,
 * so callbacks passed in (progress, KPI and chart streaming) must be wrapped
 * with Comlink.proxy() by the caller. Large binary results (zip, CSV bytes)
 * are transferred instead of copied, which leaves the worker's copy detached;
 * that is safe because the session does not keep them.
 *
 * The worker is single-threaded: a newer dashboard request can only be seen
 * while an older one is suspended at an await, which is why
 * computeDashboard() yields between charts.
 */
import * as Comlink from "comlink";
import {
  Session,
  type ChartRequest,
  type ContextRequest,
  type DashboardRequest,
  type QuestionRequest,
} from "@/engine/session";
import type { IngestOptions } from "@/engine/core/types";
import type { IngestProgress } from "@/engine/parse";
import type { ChartData } from "@/engine/charts/types";
import type { KpiBatch } from "@/engine/kpi/compute";
import type { NumberLocale } from "@/engine/core/format";
import type { Filter } from "@/engine/query/filter";

const session = new Session();
/** Id of the newest dashboard request seen; ids grow monotonically on the main thread. */
let latest = 0;

// A macrotask (not a microtask), so queued Comlink messages such as begin() can run in between.
const nextTick = () => new Promise<void>((r) => setTimeout(r, 0));

const api = {
  listSheets: (file: Blob) => session.listSheets(file),

  ingest: (file: File, opts: IngestOptions, onProgress?: (p: IngestProgress) => void) =>
    session.ingest(file, file.name, opts, onProgress),

  ingestSample: (id: string) => session.ingestSample(id),

  unpivot: () => session.unpivot(),

  /** What turning a scorecard's metrics into columns would add and leave out, so Detect can ask first. */
  pivotPlan: () => session.pivotPlan(),

  pivot: () => session.pivot(),

  configure: (req: ContextRequest) => session.configure(req),

  /** Marks a dashboard request as the newest; older in-flight requests stop at the next chart. */
  begin(id: number) {
    latest = id;
  },

  /**
   * Streams one dashboard refresh: KPIs through `onKpis`, then each chart
   * through `onChart` as soon as it is ready. Between charts it yields to
   * the event loop; if a newer request id has arrived meanwhile (via begin()
   * or another computeDashboard call) it stops and reports `aborted`. The KPI
   * batch itself is synchronous and never aborted.
   */
  async computeDashboard(
    req: DashboardRequest,
    id: number,
    onKpis?: (batch: KpiBatch) => void,
    onChart?: (specId: string, data: ChartData) => void,
  ): Promise<{ aborted: boolean; ms: number; rows: number }> {
    const t0 = performance.now();
    latest = Math.max(latest, id);
    // KPIs first so the hero strip updates immediately.
    onKpis?.(session.kpiBatch(req.filters, req.kpiIds, req.numberLocale));
    const rows = session.rowCount(req.filters);
    for (const c of req.charts) {
      await nextTick();
      // Superseded while yielding: stop; the newer run recomputes everything it needs.
      if (id !== latest) return { aborted: true, ms: Math.round(performance.now() - t0), rows };
      const data = session.chart(req.filters, c, req.numberLocale);
      if (data) onChart?.(c.specId, data);
    }
    return { aborted: false, ms: Math.round(performance.now() - t0), rows };
  },

  insights: (locale: NumberLocale) => session.insights(locale),

  /** KPI values for the Customise step's lists; unlike kpiBatch it leaves the dashboard's last results alone. */
  previewKpis: (filters: Filter[], kpiIds: string[]) => session.previewKpis(filters, kpiIds),

  /** One chart computed on its own, for the "Ask for a chart" preview (custom specs travel in `req.spec`). */
  previewChart: (filters: Filter[], req: ChartRequest, locale: NumberLocale) =>
    session.chart(filters, req, locale),

  timeIntel: (kpiId: string, filters: Filter[]) => session.timeIntel(kpiId, filters),
  kpiCardSql: (kpiId: string, filters: Filter[]) => session.kpiCardSql(kpiId, filters),

  rows: (start: number, count: number) => session.rows(start, count),

  /** Data check (step 3): the views with row counts, and a window of one view's rows with marked cells. */
  checkViews: () => session.checkViews(),
  checkRows: (viewId: string, start: number, count: number) => session.checkRows(viewId, start, count),

  sqlTableName: () => session.sqlTableName(),

  /** A business question (step 5): the engine's answer and the SQL that returns the same rows. */
  answerQuestion: (req: QuestionRequest, locale: NumberLocale) => session.answerQuestion(req, locale),

  columnValues: (column: string, limit?: number, search?: string) =>
    session.columnValues(column, limit, search),

  exportPowerBi(
    configJson: string,
    visibleSpecIds: string[],
    noNewColumns = false,
    reportTheme?: { name: string; json: string },
    folder?: string,
  ) {
    const out = session.exportPowerBi(configJson, visibleSpecIds, noNewColumns, reportTheme, folder);
    // Hand the zip's buffer over (zero-copy); a multi-megabyte clone would stall both threads.
    return Comlink.transfer(out, [out.zip.buffer]);
  },

  exportSql: () => session.exportSql(),

  exportDax: (noNewColumns = false) => session.exportDax(noNewColumns),
  /** Columns the Power BI package would add to the data for these charts, so the UI can ask first. */
  powerBiNewColumns: (visibleSpecIds: string[]) => session.powerBiNewColumns(visibleSpecIds),

  exportDictionary: (format: "csv" | "md") => session.exportDictionary(format),
  exportCodeHtml: (noNewColumns = false) => session.exportCodeHtml(noNewColumns),

  exportCsv(guard = true, ownHeaders = false) {
    const bytes = session.exportCsv(guard, ownHeaders);
    return Comlink.transfer(bytes, [bytes.buffer]);
  },

  chartCsv: (specId: string) => session.chartCsv(specId),

  verificationBundle() {
    const b = session.verificationBundle();
    return Comlink.transfer(b, [b.csv.buffer]);
  },

  aiPayload: () => session.aiPayload(),
};

/**
 * The worker's API as seen through Comlink.Remote (every method becomes async).
 * Import it with `import type` only: a value import would pull the worker
 * module, and its Comlink.expose(), into the page bundle.
 */
export type EngineApi = typeof api;

Comlink.expose(api);
