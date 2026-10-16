"use client";

/**
 * Step 1, Upload: drop zone and file picker (CSV, TSV, TXT, PSV, TAB, XLSX,
 * XLSM, XLSB, XLS, ODS, JSON, NDJSON), demo datasets, loading progress, the
 * sheet picker for multi-sheet workbooks (empty sheets are not offered), the
 * large-file dialog (systematic sample, first rows or a column subset) and an
 * inline error banner. Parsing happens in the worker; nothing is uploaded.
 * One file is read at a time: dropping several says which one was opened.
 */
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  FileSpreadsheet,
  Lock,
  ShoppingBag,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { stepNumber, useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { SAMPLES } from "@/engine/samples/catalog";
import { formatBytes, formatCount } from "@/engine/core/format";
import type { LargeFileAssessment } from "@/engine/core/types";
import { FIRST_ROWS_LIMIT, LARGE_ROW_LIMIT } from "@/engine/parse/limits";
import { cn } from "@/lib/utils";
import { countOf, ordinal } from "@/ui/common/words";
import { openDemo } from "./Shell";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Checkbox, Eyebrow, Progress } from "@/ui/primitives/misc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/primitives/dialog";
import { LoupeMark } from "@/ui/brand/logo";

/** Every extension the parser reads (engine/parse fileKindFromName). */
const ACCEPT = ".csv,.tsv,.txt,.psv,.tab,.xlsx,.xlsm,.xlsb,.xls,.ods,.json,.ndjson,.jsonl";

export function UploadStep() {
  const loading = useWorkspace((s) => s.loading);
  const error = useWorkspace((s) => s.error);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 md:py-16">
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <LoadingPanel />
          </motion.div>
        ) : (
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="mb-8 max-w-2xl">
              <Eyebrow>Step {stepNumber("upload")} · Upload</Eyebrow>
              <h1 className="mt-3 font-display text-display-sm text-fg md:text-display">
                Bring a clean table.
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">
                Loupe profiles every column, recognises the industry and builds a dashboard with correct KPIs,
                SQL and DAX, all inside this browser tab.
              </p>
            </div>
            {error ? <ErrorBanner message={error} /> : null}
            <Dropzone />
            <SampleGrid />
            <p className="mt-8 flex items-center gap-2 text-ui text-fg-muted">
              <Lock className="size-3.5 text-accent" aria-hidden />
              Your data never leaves your browser. Files are read locally; the page&apos;s security policy
              blocks sending them anywhere.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
      <SheetPicker />
      <LargeFileDialog />
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mb-5 flex items-start gap-3 rounded-card border border-danger/30 bg-danger-soft px-4 py-3"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
      <div>
        <p className="text-sm font-medium text-fg">That file couldn&apos;t be read</p>
        <p className="mt-0.5 text-ui text-fg-muted">{message}</p>
      </div>
    </div>
  );
}

function Dropzone() {
  const loadFile = useWorkspace((s) => s.loadFile);
  const input = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const depth = React.useRef(0);
  const take = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    // One table at a time: say which file was opened rather than silently dropping the others.
    const others = (files?.length ?? 1) - 1;
    if (others > 0)
      toast.message(`Opened ${f.name}`, {
        description: `Loupe reads one file at a time, so the other ${others === 1 ? "file was" : `${others} files were`} not opened.`,
      });
    void loadFile(f);
  };
  return (
    // The beam sits on a wrapper: the zone itself clips its overflow, which would cut the beam off.
    <div
      className={cn(
        "beam-border rounded-panel before:opacity-0 before:transition-opacity before:duration-500 hover:before:opacity-100",
        over && "before:opacity-100",
      )}
    >
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current++;
          setOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setOver(false);
          take(e.dataTransfer.files);
        }}
        className={cn(
          "group relative overflow-hidden rounded-panel border bg-surface-1 transition-[border-color,box-shadow,transform] duration-300 ease-[var(--ease-out-quint)]",
          over
            ? "scale-[1.006] border-accent shadow-[0_0_0_6px_var(--accent-soft),var(--shadow-lift)]"
            : "border-border-strong shadow-card hover:border-border-accent",
        )}
      >
        <div
          aria-hidden
          className={cn(
            "mesh pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500",
            over && "opacity-100",
          )}
        />
        <div className="relative flex flex-col items-center px-6 py-14 text-center md:py-20">
          <div className="relative mb-6 grid size-16 place-items-center">
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full border border-border-accent"
              animate={over ? { scale: [1, 1.35], opacity: [0.6, 0] } : { scale: 1, opacity: 0 }}
              transition={over ? { duration: 1.1, repeat: Infinity, ease: "easeOut" } : { duration: 0.2 }}
            />
            <span className="grid size-16 place-items-center rounded-full border border-border-strong bg-surface-2">
              <UploadCloud
                className={cn("size-6 transition-colors", over ? "text-accent" : "text-fg-muted")}
                aria-hidden
              />
            </span>
          </div>
          <p className="text-lg font-medium text-fg">
            {over ? "Release to analyse" : "Drop a file to begin"}
          </p>
          <p className="mt-1.5 text-ui text-fg-muted">
            CSV, TSV, Excel (.xlsx, .xls) or JSON · up to ~2 million rows
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" size="lg" onClick={() => input.current?.click()}>
              <FileSpreadsheet aria-hidden /> Choose a file
            </Button>
          </div>
          {/* Out of the tab order: the "Choose a file" button opens it, so it is one stop, not two. */}
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            tabIndex={-1}
            className="sr-only"
            aria-label="Choose a data file"
            onChange={(e) => {
              take(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="mt-8 flex flex-wrap justify-center gap-1.5">
            {[
              "Auto delimiter & encoding",
              "DD/MM vs MM/DD resolved",
              "Multi-sheet Excel",
              "₹ lakh/crore aware",
            ].map((t) => (
              <Badge key={t} tone="outline">
                {t}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SampleGrid() {
  // Asks first when the demo would replace the user's own file.
  const loadSample = (id: string) => openDemo(id, undefined, true);
  const flagship = SAMPLES.find((s) => s.flagship);
  const rest = SAMPLES.filter((s) => !s.flagship);
  return (
    <section aria-labelledby="samples-title" className="mt-10">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 id="samples-title" className="text-sm font-medium text-fg">
            No file handy? Explore with demo data
          </h2>
          <p className="mt-0.5 text-ui text-fg-muted">
            Generated deterministically, so every number is real for the demo, and clearly labelled as demo.
          </p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {flagship ? (
          <button
            type="button"
            onClick={() => void loadSample(flagship.id)}
            className="group relative overflow-hidden rounded-card border border-border-accent bg-surface-1 p-5 text-left shadow-card transition-[transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-accent md:row-span-2"
          >
            <div aria-hidden className="mesh absolute inset-0 opacity-70" />
            <div className="relative">
              <div className="flex items-center gap-2">
                <span className="grid size-9 place-items-center rounded-[10px] border border-border-accent bg-accent-soft">
                  <ShoppingBag className="size-4 text-accent" aria-hidden />
                </span>
                <Badge tone="accent">
                  <Sparkles aria-hidden /> Flagship
                </Badge>
              </div>
              <p className="mt-5 font-display text-[28px] leading-tight text-fg">{flagship.name}</p>
              <p className="mt-2 text-ui leading-relaxed text-fg-muted">{flagship.description}</p>
              <p className="mt-5 inline-flex items-center gap-1.5 text-ui font-medium text-accent">
                Open the demo{" "}
                <ArrowRight
                  className="size-3.5 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </p>
              <p className="font-figures mt-2 text-2xs text-fg-subtle">{flagship.approxRows}</p>
            </div>
          </button>
        ) : null}
        {rest.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => void loadSample(s.id)}
            className="group rounded-card border border-border bg-surface-1 p-4 text-left shadow-card transition-[transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-border-accent"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-fg">{s.name}</p>
              <ArrowRight
                className="size-3.5 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                aria-hidden
              />
            </div>
            <p className="mt-1 text-ui text-fg-muted">{s.description}</p>
            <p className="font-figures mt-2 text-2xs text-fg-subtle">{s.approxRows}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function LoadingPanel() {
  const loading = useWorkspace((s) => s.loading);
  if (!loading) return null;
  return (
    <div
      className="mx-auto flex max-w-xl flex-col items-center py-16 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="relative mb-8 grid size-24 place-items-center">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            aria-hidden
            className="absolute inset-0 rounded-full border border-border-accent"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: [0.6, 1.25], opacity: [0.7, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.7, ease: "easeOut" }}
          />
        ))}
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 6, repeat: Infinity, ease: "linear" }}>
          <LoupeMark className="size-14" />
        </motion.div>
      </div>
      {loading.fileName ? (
        <p className="font-figures mb-2 text-2xs text-fg-subtle">{loading.fileName}</p>
      ) : null}
      <p className="text-lg font-medium text-fg">{loading.title}</p>
      {loading.detail ? <p className="mt-1.5 text-ui text-fg-muted">{loading.detail}</p> : null}
      <div className="mt-6 w-64">
        {loading.progress !== null ? (
          <Progress value={loading.progress} label={loading.title} />
        ) : (
          <div className="skeleton h-1 rounded-full" />
        )}
      </div>
      <p className="mt-6 flex items-center gap-1.5 text-2xs text-fg-subtle">
        <Lock className="size-3" aria-hidden /> Processing locally in a background thread; the page stays
        responsive.
      </p>
    </div>
  );
}

function SheetPicker() {
  const sheets = useWorkspace((s) => s.sheets);
  const file = useWorkspace((s) => s.pendingFile);
  const choose = useWorkspace((s) => s.chooseSheet);
  return (
    <Dialog
      open={Boolean(sheets)}
      onOpenChange={(o) => (!o ? useWorkspace.setState({ sheets: null, pendingFile: null }) : undefined)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose a sheet</DialogTitle>
          <DialogDescription>
            {file?.name} has {sheets?.length} sheets. Loupe analyses one table at a time.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {sheets?.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => void choose(s)}
              className="flex items-center justify-between rounded-control border border-border bg-surface-2 px-3 py-2.5 text-left text-sm text-fg transition-colors hover:border-border-accent"
            >
              <span className="flex items-center gap-2">
                <FileSpreadsheet className="size-4 text-fg-subtle" aria-hidden />
                {s}
              </span>
              {i === 0 ? <Badge>First sheet</Badge> : null}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LargeFileDialog() {
  const a = useWorkspace((s) => s.largeFile);
  if (!a) return null;
  // Keyed by file, so the strategy and column choice start fresh for every new file.
  return <LargeFileDialogBody key={`${a.fileName}:${a.sizeBytes}`} a={a} />;
}

function LargeFileDialogBody({ a }: { a: LargeFileAssessment }) {
  const resolve = useWorkspace((s) => s.resolveLargeFile);
  const locale = useSettings((s) => s.numberLocale);
  const [mode, setMode] = React.useState<"sample" | "first" | "columns">("sample");
  const [cols, setCols] = React.useState<string[]>(a.columns);
  const every = a.recommendedSampleEvery;
  // Every figure in the dialog is written in the user's number format (never "21,99,992" beside "2.2M").
  const tooManyRows = a.estimatedRows > LARGE_ROW_LIMIT;
  return (
    <Dialog open onOpenChange={(o) => (!o ? void resolve(null) : undefined)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Large-file mode</DialogTitle>
          <DialogDescription>
            {a.fileName} is {formatBytes(a.sizeBytes)} with about{" "}
            {countOf(Math.round(a.estimatedRows), "row", locale)}
            {tooManyRows
              ? `, more than the ${formatCount(LARGE_ROW_LIMIT, locale)} a browser tab can analyse comfortably.`
              : `. ${a.reason}`}{" "}
            Choose how to continue; nothing is lost from the original file.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2" role="radiogroup" aria-label="Large file strategy">
          {[
            {
              id: "sample" as const,
              title: `Systematic sample: every ${ordinal(every)} row (recommended)`,
              body: `About ${countOf(Math.round(a.estimatedRows / every), "row", locale)} evenly spread across the whole file, so trends and shares stay representative. KPIs that count totals are labelled as sampled.`,
            },
            {
              id: "first" as const,
              title: `First ${countOf(FIRST_ROWS_LIMIT, "row", locale)}`,
              body: "Exact for the rows loaded, but biased if the file is sorted (e.g. by date).",
            },
            {
              id: "columns" as const,
              title: "Only the columns you need",
              body: "Load every row but fewer columns, which cuts memory roughly in proportion.",
            },
          ].map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={mode === o.id}
              onClick={() => setMode(o.id)}
              className={cn(
                "rounded-control border p-3 text-left transition-colors",
                mode === o.id
                  ? "border-accent bg-accent-soft"
                  : "border-border bg-surface-2 hover:border-border-accent",
              )}
            >
              <p className="text-sm font-medium text-fg">{o.title}</p>
              <p className="mt-0.5 text-ui text-fg-muted">{o.body}</p>
            </button>
          ))}
        </div>
        {mode === "columns" ? (
          <div className="max-h-48 overflow-y-auto rounded-control border border-border p-2">
            {a.columns.map((c) => (
              <label
                key={c}
                className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-ui text-fg hover:bg-surface-2"
              >
                <Checkbox
                  checked={cols.includes(c)}
                  onCheckedChange={(v) => setCols((prev) => (v ? [...prev, c] : prev.filter((x) => x !== c)))}
                />
                {c}
              </label>
            ))}
          </div>
        ) : null}
        <p className="text-2xs text-fg-subtle">
          Prefer the full file? Split it by date (e.g. one file per year) and analyse each part, or load it
          into DuckDB/BigQuery and export a summary table.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => void resolve(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={mode === "columns" && cols.length === 0}
            onClick={() =>
              void resolve(
                mode === "sample"
                  ? { sampleEvery: every }
                  : mode === "first"
                    ? { maxRows: FIRST_ROWS_LIMIT }
                    : { columns: cols },
              )
            }
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
