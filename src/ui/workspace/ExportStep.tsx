"use client";

/**
 * Step 6, Export. Power BI package (zip), PDF report and dashboard PNG, the
 * SQL file with in-browser verification against DuckDB-WASM plus a small SQL
 * lab, the data dictionary, a cleaned CSV (formula-injection guard) and the
 * shareable config. buildConfig() captures the dashboard (domain, mapping,
 * overrides, layout, filters) without any data rows.
 *
 * The Power BI package and the DAX file are built from the file's own
 * columns. When one would add a column (a date-only copy of a datetime, or a
 * calculated hour/weekday column for a chart), the user is asked first
 * (powerBiConsent); on "no" it is built without adding anything.
 */
import * as React from "react";
import {
  BadgeCheck,
  BookText,
  CheckCircle2,
  Database,
  Download,
  FileArchive,
  FileCode2,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  Loader2,
  Play,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatBytes, formatValue } from "@/engine/core/format";
import { formatRange, formatDay } from "@/engine/core/dates";
import { PRESET_LABEL } from "@/engine/core/periods";
import { describeFilter } from "@/engine/query/filter";
import { compareFingerprints, fingerprintOf, parseConfig, type LoupeConfig } from "@/engine/export/config";
import type { PackageManifest } from "@/engine/export/powerbi";
import { allSpecs, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { engine } from "@/lib/engine-client";
import { downloadBlob, downloadDataUrl, slugify } from "@/lib/utils";
import type { VerificationResult } from "@/lib/duckdb";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Card } from "@/ui/primitives/card";
import { Eyebrow } from "@/ui/primitives/misc";
import { Switch } from "@/ui/primitives/switch";
import { Label, Textarea } from "@/ui/primitives/input";
import { useFmt } from "@/ui/common/hooks";
import { CodeBlock } from "./dashboard/KpiDetails";
import { exportDashboardPng, exportPdf, type ReportInput } from "./export/report";
import { useColumnConsent, type ColumnRequest, type ProposedColumn } from "./NewColumnsDialog";

/**
 * The question for a Power BI download that would add `columns`. What
 * happens without them depends on which kinds are involved: no Date table
 * without the date-only copy, and Power BI's own date hierarchy (or "not
 * built") for chart axes.
 */
function powerBiConsent(
  columns: Array<ProposedColumn & { kind: "dateKey" | "datePart" }>,
  what: string,
): ColumnRequest {
  const n = columns.length;
  const noDateTable = columns.some((c) => c.kind === "dateKey");
  const parts = columns.some((c) => c.kind === "datePart");
  return {
    title: n === 1 ? `Add 1 column in the ${what}?` : `Add ${n} columns in the ${what}?`,
    intro: `Everything else is built from your own columns. These ${n === 1 ? "column is" : "columns are"} only added inside Power BI; your file and Loupe's numbers stay the same either way.`,
    columns,
    ifNo: [
      noDateTable
        ? "There is no Date table, so no time-intelligence measures (YTD, prior year, moving averages); every KPI measure is still included."
        : "",
      parts
        ? "Charts by month or day of month use Power BI's own date hierarchy, and charts by hour or weekday are listed as not built."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    yesLabel: n === 1 ? "Add the column" : `Add ${n} columns`,
    noLabel: "Don't add, use my columns only",
  };
}

function useReportInput(): () => ReportInput | null {
  const fmt = useFmt();
  return React.useCallback(() => {
    const s = useWorkspace.getState();
    const ctx = s.context;
    if (!ctx || !s.summary) return null;
    const metas = new Map(ctx.kpis.map((k) => [k.id, k]));
    const values = new Map(s.kpiBatch?.values.map((v) => [v.id, v]) ?? []);
    const specs = allSpecs(s);
    const visible = s.widgets.filter(
      (w) => !w.hidden && specs.find((x) => x.id === w.id)?.modes.includes(s.mode),
    );
    const charts = visible
      .map((w) => {
        const spec = specs.find((x) => x.id === w.id);
        const data = s.charts[w.id];
        return spec && data ? { spec, data, kind: w.kind ?? spec.kind } : null;
      })
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
    const dims = s.filters().filter((f) => f.kind !== "dateRange");
    return {
      title: ctx.domain.name,
      subtitle: `${ctx.domain.subDomains.find((x) => x.id === ctx.subDomainId)?.name ?? ""} · ${s.summary.fileName}`,
      fileName: s.summary.fileName,
      isDemo: s.summary.isDemo,
      period:
        s.datePreset === "custom" && s.customRange
          ? formatRange(s.customRange.from, s.customRange.to)
          : (s.kpiBatch?.period?.label ?? PRESET_LABEL[s.datePreset]),
      filters: dims.length ? dims.map((f) => describeFilter(f, formatDay)).join("; ") : "None",
      rows: s.lastCompute?.rows ?? s.summary.rowCount,
      grain: ctx.grainLabel,
      generatedAt: formatDay(Date.now()),
      hero: ctx.selection.hero
        .map((id) => ({
          meta: metas.get(id) as NonNullable<ReturnType<typeof metas.get>>,
          value: values.get(id),
        }))
        .filter((x) => x.meta),
      supporting: ctx.selection.supporting
        .map((id) => ({
          meta: metas.get(id) as NonNullable<ReturnType<typeof metas.get>>,
          value: values.get(id),
        }))
        .filter((x) => x.meta),
      insights: s.insights ?? [],
      charts,
      health: s.health,
      fmt,
    };
  }, [fmt]);
}

export function buildConfig(): LoupeConfig | null {
  const s = useWorkspace.getState();
  const settings = useSettings.getState();
  if (!s.summary || !s.profile || !s.domainId) return null;
  return {
    app: "loupe",
    version: 1,
    createdAt: new Date().toISOString(),
    fingerprint: fingerprintOf(
      s.summary.fileName,
      s.summary.rowCount,
      s.profile.columns.map((c) => ({ name: c.name, type: c.storage })),
    ),
    domainId: s.domainId,
    subDomainId: s.subDomainId ?? undefined,
    business: s.business,
    mappingOverrides: s.mappingOverrides,
    classOverrides: s.classOverrides,
    roleOverrides: s.roleOverrides,
    kpiRenames: s.kpiRenames,
    kpiTargets: s.kpiTargets,
    dashboard: {
      mode: s.mode,
      widgets: s.widgets.map((w) => ({
        id: w.id,
        kind: w.kind,
        w: w.w,
        h: w.h,
        hidden: w.hidden,
        topN: w.topN,
      })),
      customCharts: s.customCharts,
      datePreset: s.datePreset,
      filters: s.filters(),
    },
    settings: {
      numberLocale: settings.numberLocale,
      currency: settings.currencyOverride ?? s.context?.currency ?? "INR",
    },
  };
}

export function ExportStep() {
  const context = useWorkspace((s) => s.context);
  const summary = useWorkspace((s) => s.summary);
  if (!context || !summary) return null;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <div className="mb-6">
        <Eyebrow>Step 6 · Export</Eyebrow>
        <h1 className="mt-2 font-display text-display-sm text-fg">Take it anywhere.</h1>
        <p className="mt-2 max-w-2xl text-ui text-fg-muted">
          Every export is generated in this tab from the same definitions as the dashboard, so the numbers
          match everywhere.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <PowerBiCard />
        <ReportCard />
        <SqlCard />
        <MiscCard />
        <ConfigCard />
      </div>
    </div>
  );
}

function ExportCard({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`flex flex-col p-6 ${className ?? ""}`}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[11px] border border-border-accent bg-accent-soft">
          <Icon className="size-[18px] text-accent" />
        </span>
        <div>
          <h2 className="text-base font-medium text-fg">{title}</h2>
          <div className="mt-1 text-ui leading-relaxed text-fg-muted">{description}</div>
        </div>
      </div>
      <div className="mt-5 flex flex-1 flex-col">{children}</div>
    </Card>
  );
}

function PowerBiCard() {
  const [busy, setBusy] = React.useState(false);
  const [manifest, setManifest] = React.useState<PackageManifest | null>(null);
  const summary = useWorkspace((s) => s.summary);
  const consent = useColumnConsent();
  const generate = async () => {
    const cfg = buildConfig();
    if (!cfg) return;
    setBusy(true);
    try {
      const s = useWorkspace.getState();
      const specs = allSpecs(s).filter((x) => x.source !== "custom");
      const visible = s.widgets
        .filter((w) => !w.hidden && specs.find((x) => x.id === w.id)?.modes.includes(s.mode))
        .map((w) => w.id);
      const extra = await engine().powerBiNewColumns(visible);
      const add = await consent.ask(powerBiConsent(extra, "Power BI package"));
      if (add === null) return;
      const out = await engine().exportPowerBi(JSON.stringify(cfg, null, 2), visible, !add);
      downloadBlob(
        new Blob([out.zip as BlobPart], { type: "application/zip" }),
        `${slugify(summary?.name ?? "loupe")}-powerbi.zip`,
      );
      setManifest(out.manifest);
      toast.success(
        extra.length && !add
          ? "Power BI package downloaded · no columns added"
          : "Power BI package downloaded",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ExportCard
      icon={FileArchive}
      title="Power BI package"
      description={
        <>
          Cleaned CSV, every measure in DAX (with display folders, format strings, a Date table and time
          intelligence), a TMDL semantic model, SQL, a data dictionary and a visual-by-visual build guide.{" "}
          <span className="text-fg">Not a .pbix:</span> only Power BI Desktop can write that binary, so this
          is the professional workaround. Rebuilding takes about five minutes with the README. Built from your
          own columns: if a part would need a new one, you&apos;re asked first.
        </>
      }
      className="lg:row-span-2"
    >
      {consent.dialog}
      <Button variant="primary" size="lg" onClick={() => void generate()} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />} Download .zip
      </Button>
      {manifest ? (
        <ul className="mt-5 divide-y divide-border rounded-card border border-border text-ui">
          {manifest.files.map((f) => (
            <li key={f.path} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="font-figures truncate text-fg">{f.path}</span>
              <span className="font-figures shrink-0 text-2xs text-fg-subtle">{formatBytes(f.bytes)}</span>
            </li>
          ))}
          <li className="flex justify-between px-3 py-2 text-2xs text-fg-muted">
            <span>Compressed total</span>
            <span className="font-figures">{formatBytes(manifest.totalBytes)}</span>
          </li>
        </ul>
      ) : (
        <ul className="mt-5 grid gap-1.5 text-ui text-fg-muted">
          {[
            "README.md: exact steps, two paths",
            "data.csv: snake_case headers, ISO dates",
            "measures.dax: paste into DAX query view",
            "*.SemanticModel/: TMDL for PBIP and Tabular Editor",
            "kpis.sql · data-dictionary.csv · loupe-config.json",
          ].map((t) => (
            <li key={t} className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
              {t}
            </li>
          ))}
        </ul>
      )}
    </ExportCard>
  );
}

function ReportCard() {
  const build = useReportInput();
  const summary = useWorkspace((s) => s.summary);
  const insights = useWorkspace((s) => s.insights);
  const loadInsights = useWorkspace((s) => s.loadInsights);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [transparent, setTransparent] = React.useState(false);
  const pdf = async () => {
    if (!insights) await loadInsights();
    const input = build();
    if (!input) return;
    setBusy("Preparing…");
    try {
      await exportPdf(input, `${slugify(summary?.name ?? "loupe")}-report.pdf`, setBusy);
      toast.success("PDF report downloaded");
    } catch (e) {
      toast.error(`PDF export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  const png = async () => {
    const input = build();
    if (!input) return;
    setBusy("Rendering dashboard…");
    try {
      const url = await exportDashboardPng(input, transparent);
      downloadDataUrl(
        url,
        `${slugify(summary?.name ?? "loupe")}-dashboard${transparent ? "-transparent" : ""}.png`,
      );
      toast.success("Dashboard PNG downloaded");
    } catch (e) {
      toast.error(`PNG export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <ExportCard
      icon={FileText}
      title="PDF report & PNG"
      description="A multi-page, print-safe report (light theme, A4): KPI summary, every visible chart with its reason, top findings, and a data-health appendix. Or the whole dashboard as one high-resolution image. Single charts export from each chart's menu."
    >
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void pdf()} disabled={Boolean(busy)}>
          <FileText aria-hidden /> PDF report
        </Button>
        <Button variant="secondary" onClick={() => void png()} disabled={Boolean(busy)}>
          <FileImage aria-hidden /> Dashboard PNG (2×)
        </Button>
      </div>
      <label className="mt-3 flex items-center gap-2 text-ui text-fg-muted">
        <Switch
          checked={transparent}
          onCheckedChange={setTransparent}
          aria-label="Transparent PNG background"
        />{" "}
        Transparent PNG background
      </label>
      {busy ? (
        <p className="mt-3 flex items-center gap-2 text-ui text-fg-muted" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {busy}
        </p>
      ) : null}
    </ExportCard>
  );
}

function SqlCard() {
  const fmt = useFmt();
  const [sql, setSql] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<VerificationResult[] | null>(null);
  const [lab, setLab] = React.useState("");
  const [labOut, setLabOut] = React.useState<{
    columns: string[];
    rows: Array<Array<string | number | null>>;
  } | null>(null);
  const summary = useWorkspace((s) => s.summary);
  const context = useWorkspace((s) => s.context);
  React.useEffect(() => {
    void engine().exportSql().then(setSql);
  }, [context]);
  const verify = async () => {
    setResults(null);
    setStatus("Preparing data…");
    try {
      const bundle = await engine().verificationBundle();
      const { verifySql } = await import("@/lib/duckdb");
      const r = await verifySql(bundle, setStatus);
      setResults(r);
      setLab(`SELECT * FROM "${bundle.table}" LIMIT 20`);
      const ok = r.filter((x) => x.match).length;
      toast[ok === r.length ? "success" : "warning"](`${ok} of ${r.length} KPI queries match the dashboard`);
    } catch (e) {
      toast.error(`DuckDB couldn't start: ${(e as Error).message}`);
    } finally {
      setStatus(null);
    }
  };
  const runLab = async () => {
    try {
      const { runSql } = await import("@/lib/duckdb");
      setLabOut(await runSql(lab));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const fmtKpi = (id: string, v: number | null) => {
    const k = context?.kpis.find((x) => x.id === id);
    return formatValue(v, k?.format ?? "number", fmt);
  };
  return (
    <ExportCard
      icon={FileCode2}
      title="SQL"
      description="A CREATE TABLE matching the detected schema, one view per KPI, monthly views with MoM/YoY, and RFM and cohort queries. Standard SQL with notes for PostgreSQL, MySQL and SQL Server."
    >
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            sql && downloadBlob(sql, `${slugify(summary?.name ?? "loupe")}-kpis.sql`, "application/sql")
          }
          disabled={!sql}
        >
          <Download aria-hidden /> Download .sql
        </Button>
        <Button variant="secondary" onClick={() => void verify()} disabled={Boolean(status)}>
          {status ? <Loader2 className="animate-spin" aria-hidden /> : <BadgeCheck aria-hidden />} Verify
          against your data
        </Button>
      </div>
      {status ? (
        <p className="mt-2 text-2xs text-fg-subtle">{status}</p>
      ) : (
        <p className="mt-2 text-2xs text-fg-subtle">
          Verification runs DuckDB-WASM in this tab (downloaded once from jsDelivr); your data still never
          leaves the browser.
        </p>
      )}
      {results ? (
        <div className="mt-4 max-h-64 overflow-auto rounded-card border border-border">
          <table className="w-full text-ui">
            <thead className="sticky top-0 bg-surface-2 text-left text-fg-muted">
              <tr>
                <th className="px-3 py-2 font-medium">KPI</th>
                <th className="px-3 py-2 text-right font-medium">Dashboard</th>
                <th className="px-3 py-2 text-right font-medium">DuckDB</th>
                <th className="px-3 py-2 font-medium">
                  <span className="sr-only">Match</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-1.5 text-fg">{r.name}</td>
                  <td className="font-figures px-3 py-1.5 text-right text-fg">{fmtKpi(r.id, r.engine)}</td>
                  <td className="font-figures px-3 py-1.5 text-right text-fg" title={r.error}>
                    {r.error ? "error" : fmtKpi(r.id, r.duckdb)}
                  </td>
                  <td className="px-3 py-1.5">
                    {r.match ? (
                      <CheckCircle2 className="size-4 text-success" aria-label="matches" />
                    ) : (
                      <XCircle className="size-4 text-danger" aria-label="differs" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {results ? (
        <div className="mt-4 grid gap-2">
          <Label htmlFor="sql-lab" className="flex items-center gap-1.5">
            <Database className="size-3.5" aria-hidden /> SQL lab (DuckDB)
          </Label>
          <Textarea
            id="sql-lab"
            value={lab}
            onChange={(e) => setLab(e.target.value)}
            className="font-mono text-2xs"
            rows={3}
          />
          <Button size="sm" variant="outline" className="justify-self-start" onClick={() => void runLab()}>
            <Play aria-hidden /> Run
          </Button>
          {labOut ? (
            <div className="max-h-56 overflow-auto rounded-control border border-border">
              <table className="w-full text-2xs">
                <thead className="sticky top-0 bg-surface-2">
                  <tr>
                    {labOut.columns.map((c) => (
                      <th key={c} className="px-2 py-1.5 text-left font-medium text-fg-muted">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {labOut.rows.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      {r.map((v, j) => (
                        <td key={j} className="font-figures max-w-[200px] truncate px-2 py-1 text-fg">
                          {v === null ? "∅" : String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
      {sql ? (
        <div className="mt-4">
          <CodeBlock
            code={
              sql.length > 6000
                ? `${sql.slice(0, 6000)}\n-- … ${(sql.length - 6000).toLocaleString("en-US")} more characters in the download`
                : sql
            }
            language="SQL · standard"
            label="SQL"
          />
        </div>
      ) : null}
    </ExportCard>
  );
}

function MiscCard() {
  const summary = useWorkspace((s) => s.summary);
  const base = slugify(summary?.name ?? "loupe");
  const consent = useColumnConsent();
  const dl = async (kind: "dax" | "dict-csv" | "dict-md" | "csv") => {
    try {
      if (kind === "dax") {
        // measures.dax has no visuals, so only the Date table's date-only helper can apply.
        const extra = await engine().powerBiNewColumns([]);
        const add = await consent.ask(powerBiConsent(extra, "DAX measures"));
        if (add === null) return;
        downloadBlob(await engine().exportDax(!add), `${base}-measures.dax`);
      }
      if (kind === "dict-csv")
        downloadBlob(
          await engine().exportDictionary("csv"),
          `${base}-data-dictionary.csv`,
          "text/csv;charset=utf-8",
        );
      if (kind === "dict-md")
        downloadBlob(
          await engine().exportDictionary("md"),
          `${base}-data-dictionary.md`,
          "text/markdown;charset=utf-8",
        );
      if (kind === "csv") {
        const bytes = await engine().exportCsv(true);
        downloadBlob(new Blob([bytes as BlobPart], { type: "text/csv;charset=utf-8" }), `${base}-clean.csv`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <ExportCard
      icon={BookText}
      title="Measures, dictionary & data"
      description="Individual files, if you only need one piece. CSV exports neutralise cells that spreadsheets could run as formulas."
    >
      {consent.dialog}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" onClick={() => void dl("dax")}>
          <FileCode2 aria-hidden /> measures.dax
        </Button>
        <Button variant="secondary" onClick={() => void dl("csv")}>
          <FileSpreadsheet aria-hidden /> Cleaned data (.csv)
        </Button>
        <Button variant="secondary" onClick={() => void dl("dict-csv")}>
          <FileSpreadsheet aria-hidden /> Data dictionary (.csv)
        </Button>
        <Button variant="secondary" onClick={() => void dl("dict-md")}>
          <BookText aria-hidden /> Data dictionary (.md)
        </Button>
      </div>
    </ExportCard>
  );
}

function ConfigCard() {
  const applyConfig = useWorkspace((s) => s.applyConfig);
  const summary = useWorkspace((s) => s.summary);
  const profile = useWorkspace((s) => s.profile);
  const input = React.useRef<HTMLInputElement>(null);
  const download = () => {
    const cfg = buildConfig();
    if (!cfg) return;
    downloadBlob(
      JSON.stringify(cfg, null, 2),
      `${slugify(summary?.name ?? "loupe")}.loupe.json`,
      "application/json",
    );
  };
  const load = async (file: File | undefined) => {
    if (!file || !summary || !profile) return;
    const { config, error } = parseConfig(await file.text());
    if (!config) {
      toast.error(error ?? "Invalid config");
      return;
    }
    const check = compareFingerprints(
      config.fingerprint,
      fingerprintOf(
        summary.fileName,
        summary.rowCount,
        profile.columns.map((c) => ({ name: c.name, type: c.storage })),
      ),
    );
    if (!check.ok) {
      toast.error(`This config was made for a different file. ${check.problems.slice(0, 2).join(" ")}`);
      return;
    }
    await applyConfig(config);
    toast.success(check.exact ? "Dashboard restored" : `Dashboard restored. ${check.problems[0] ?? ""}`);
  };
  return (
    <ExportCard
      icon={FileJson}
      title="Shareable config"
      description="Saves the domain, mapping, value meanings, roles, KPI names and targets, layout, custom charts and filters. Load it with the same file to get the same dashboard."
    >
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={download}>
          <Download aria-hidden /> Download config
        </Button>
        <Button variant="secondary" onClick={() => input.current?.click()}>
          <Upload aria-hidden /> Load config
        </Button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          aria-label="Load a Loupe config"
          onChange={(e) => void load(e.target.files?.[0])}
        />
      </div>
      <p className="mt-3 text-2xs text-fg-subtle">
        <Badge tone="outline">Privacy</Badge> No rows are included; only column names, settings, and the
        category labels used in filters and value meanings.
      </p>
    </ExportCard>
  );
}
