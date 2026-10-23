"use client";

/**
 * Step 1, Upload: "Start with a clean table" (version 50.2, the guided flow).
 * From lg two columns: on the left the StepHeader and a tall drop zone (a
 * dashed edge that turns to the accent, tinted, while a file is dragged over
 * it; "Choose a file" as the page's one primary button; the formats, with
 * what the reader handles behind an ⓘ; and the privacy line), on the right
 * "Or open a demo", the demos as a compact list of cards (the industry's
 * icon, name, one line, rows and an arrow, the flagship marked). Under both,
 * a quiet "How it works" row: Upload → Understand → Review → Dashboard.
 * Below lg it is one column, the demos two to a row from sm.
 *
 * The drop zone and the file picker read CSV, TSV, TXT, PSV, TAB, XLSX,
 * XLSM, XLSB, XLS, ODS, JSON and NDJSON; parsing happens in the worker and
 * nothing is uploaded. One file is read at a time: dropping several says
 * which one was opened. Loading a file moves on to Detect by itself, so the
 * page has no next-step dock. Also here: loading progress (in place of the
 * page), errors inline, the sheet picker for multi-sheet workbooks whose
 * sheets don't join on shared keys (related sheets are joined instead; empty
 * sheets are not offered) and the large-file dialog (systematic sample,
 * first rows or a column subset). Explanations are one short line, with the
 * full text behind hover, a long press or the ⓘ (ui/primitives/reveal.tsx).
 */
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, FileSpreadsheet, Lock, Sparkles, UploadCloud } from "lucide-react";
import { useWorkspace } from "@/store/workspace";
import { useSettings } from "@/store/settings";
import { SAMPLES, type SampleInfo } from "@/engine/samples/catalog";
import { formatBytes, formatCount } from "@/engine/core/format";
import type { LargeFileAssessment } from "@/engine/core/types";
import { FIRST_ROWS_LIMIT, LARGE_ROW_LIMIT, MAX_MODEL_SHEETS } from "@/engine/parse/limits";
import { cn } from "@/lib/utils";
import { countOf, ordinal } from "@/ui/common/words";
import { DomainIcon } from "@/ui/common/domain-icon";
import { openDemo } from "./Shell";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Checkbox, Progress } from "@/ui/primitives/misc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/primitives/dialog";
import { LoupeMark } from "@/ui/brand/logo";
import { Brief, ClampText, InfoTip } from "@/ui/primitives/reveal";
import { StepHeader } from "./flow/StepHeader";
import { HOW_IT_WORKS, demoIcon } from "./flow/prepareWords";

/** What the reader handles by itself, behind the ⓘ on the formats line. */
const FEATURES = [
  "Auto delimiter & encoding",
  "DD/MM vs MM/DD resolved",
  "Related sheets joined",
  "₹ lakh/crore aware",
];

/** Every extension the parser reads (engine/parse fileKindFromName). */
const ACCEPT = ".csv,.tsv,.txt,.psv,.tab,.xlsx,.xlsm,.xlsb,.xls,.ods,.json,.ndjson,.jsonl";

export function UploadStep() {
  const loading = useWorkspace((s) => s.loading);
  const error = useWorkspace((s) => s.error);
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-8 pb-8 md:px-8 md:pt-10">
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
            {/* The drop zone grows to the demo list's height, so the two columns end together. */}
            <div className="grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
              <div className="flex min-w-0 flex-col">
                <StepHeader
                  step="upload"
                  title="Start with a clean table"
                  lead="One table in, a full dashboard out."
                  leadFull="Loupe reads every column, works out what the table measures and builds a dashboard with KPIs, charts, SQL and DAX, all inside this browser tab."
                />
                {error ? <ErrorBanner message={error} /> : null}
                <Dropzone />
              </div>
              <DemoList />
            </div>
            <HowItWorks />
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
      className="mb-4 flex items-start gap-3 rounded-card border border-danger-border bg-danger-soft px-4 py-3"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">That file couldn&apos;t be read</p>
        <p className="mt-0.5 text-sm break-words text-fg-muted">{message}</p>
      </div>
    </div>
  );
}

/**
 * The drop zone: a dashed panel that takes a dropped file, with "Choose a file" for the picker.
 * While a file is over it, the edge turns to the accent, the panel takes the accent's tint and a
 * ring pulses round the icon (still under reduced motion: Framer's MotionConfig is set to "user").
 */
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
        "relative flex min-h-80 flex-1 flex-col items-center justify-center rounded-panel border border-dashed px-6 py-10 text-center transition-[border-color,background-color,box-shadow] duration-slow ease-out-quint",
        over
          ? "border-accent bg-accent-soft shadow-[0_0_0_4px_var(--accent-soft)]"
          : "border-border-hover bg-surface-1",
      )}
    >
      <div className="relative mb-5 grid size-14 place-items-center">
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full border border-border-accent"
          animate={over ? { scale: [1, 1.4], opacity: [0.7, 0] } : { scale: 1, opacity: 0 }}
          transition={over ? { duration: 1.1, repeat: Infinity, ease: "easeOut" } : { duration: 0.2 }}
        />
        <span
          className={cn(
            "grid size-14 place-items-center rounded-full border transition-colors duration-base",
            over ? "border-border-accent bg-surface-1" : "border-border bg-surface-2",
          )}
        >
          <UploadCloud
            className={cn("size-6 transition-colors duration-base", over ? "text-accent" : "text-fg-muted")}
            aria-hidden
          />
        </span>
      </div>
      <p className="text-lg font-semibold text-fg">{over ? "Release to open it" : "Drop a file here"}</p>
      <p className="mt-1 text-ui text-fg-muted">
        CSV, TSV, Excel or JSON · up to ~2 million rows{" "}
        <InfoTip label="What Loupe handles for you">{FEATURES.join(" · ")}</InfoTip>
      </p>
      <Button variant="primary" size="lg" className="mt-6" onClick={() => input.current?.click()}>
        <FileSpreadsheet aria-hidden /> Choose a file
      </Button>
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
      <p className="mt-6 flex items-center gap-2 text-xs text-fg-muted">
        <Lock className="size-3.5 shrink-0 text-success" aria-hidden />
        <Brief
          label="About privacy"
          full="Your data never leaves your browser. Files are read locally, and the page's security policy blocks sending them anywhere."
        >
          Stays in this browser: nothing is uploaded.
        </Brief>
      </p>
    </div>
  );
}

/** "Or open a demo": every demo as a compact card, the flagship first and marked. */
function DemoList() {
  // Asks first when the demo would replace the user's own file.
  const open = (id: string) => void openDemo(id, undefined, true);
  const demos = [...SAMPLES.filter((s) => s.flagship), ...SAMPLES.filter((s) => !s.flagship)];
  return (
    <section aria-labelledby="demos-title" className="min-w-0">
      <div className="mb-3 flex items-center gap-1.5">
        <h2 id="demos-title" className="eyebrow text-fg-subtle">
          Or open a demo
        </h2>
        <InfoTip label="About the demo data">
          Generated the same way every time, so every number is real for the demo, and it is labelled as demo
          data wherever it appears.
        </InfoTip>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {demos.map((s) => (
          <li key={s.id} className="min-w-0">
            <DemoCard sample={s} onOpen={() => open(s.id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One demo: its industry's icon, name, one line and size, and an arrow; the flagship in the accent,
 * marked "Recommended". A narrow card (two to a row on a tablet, a phone) keeps the size to its rows,
 * so the mark never cuts it.
 */
function DemoCard({ sample: s, onOpen }: { sample: SampleInfo; onOpen: () => void }) {
  const [rows, ...more] = s.approxRows.split(" · ");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group @container flex h-full w-full min-w-0 items-center gap-3 rounded-card border bg-surface-1 p-3 text-left shadow-card transition-[border-color,background-color,box-shadow] duration-base hover:border-border-hover focus-visible:focus-ring",
        s.flagship ? "border-border-accent" : "border-border",
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-control border",
          s.flagship ? "border-border-accent bg-accent-soft" : "border-border bg-surface-2",
        )}
      >
        <DomainIcon
          name={demoIcon(s.domain)}
          className={cn("size-4", s.flagship ? "text-accent" : "text-fg-muted")}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui font-medium text-fg">{s.name}</span>
        {/* One line; the whole of it is read out with the card, and shown on hover. */}
        <span title={s.description} className="mt-0.5 block truncate text-xs text-fg-muted">
          {s.description}
        </span>
        {/* The mark sits with the size, so a phone never cuts the name to make room for it. */}
        <span className="mt-1 flex min-w-0 items-center gap-2">
          <span className="tabular truncate text-xs text-fg-subtle">
            {rows}
            {more.length ? <span className="@max-[23rem]:hidden"> · {more.join(" · ")}</span> : null}
          </span>
          {s.flagship ? (
            <Badge tone="accent" className="shrink-0">
              <Sparkles aria-hidden /> Recommended
            </Badge>
          ) : null}
        </span>
      </span>
      <ArrowRight
        className="size-4 shrink-0 text-fg-subtle transition-[transform,color] duration-base group-hover:translate-x-0.5 group-hover:text-accent"
        aria-hidden
      />
    </button>
  );
}

/**
 * The quiet row under both columns: the four steps from a file to a dashboard. From lg they stand
 * in one row, each number joined to the next by a hairline; below it, two by two.
 */
function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="mt-8 border-t border-border-subtle pt-6">
      <h2 id="how-title" className="eyebrow text-fg-subtle">
        How it works
      </h2>
      <ol className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        {HOW_IT_WORKS.map((s, i) => (
          <li key={s.name} className="flex min-w-0 gap-3 lg:flex-col lg:gap-2">
            <div className="flex items-center gap-3">
              <span className="tabular grid size-6 shrink-0 place-items-center rounded-full border border-border bg-surface-1 text-2xs font-medium text-fg-muted">
                {i + 1}
              </span>
              {/* Reaches halfway into the gap, so it stops as far short of the next number as it starts. */}
              {i < HOW_IT_WORKS.length - 1 ? (
                <span aria-hidden className="hidden h-px flex-1 bg-border lg:-mr-3 lg:block" />
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="text-ui font-medium text-fg">{s.name}</p>
              <p className="text-xs text-fg-muted">{s.line}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function LoadingPanel() {
  const loading = useWorkspace((s) => s.loading);
  if (!loading) return null;
  return (
    <div
      className="mx-auto flex min-h-[28rem] max-w-xl flex-col items-center justify-center py-16 text-center"
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
        <ClampText className="mb-2 max-w-full text-xs text-fg-subtle">{loading.fileName}</ClampText>
      ) : null}
      <p className="text-lg font-semibold text-fg">{loading.title}</p>
      {loading.detail ? <p className="mt-1.5 text-ui text-fg-muted">{loading.detail}</p> : null}
      <div className="mt-6 w-64">
        {loading.progress !== null ? (
          <Progress value={loading.progress} label={loading.title} />
        ) : (
          <div className="skeleton h-1 rounded-full" />
        )}
      </div>
      <p className="mt-6 flex items-center gap-1.5 text-xs text-fg-subtle">
        <Lock className="size-3 shrink-0" aria-hidden />
        <Brief
          label="About processing"
          full="Processing locally in a background thread; the page stays responsive."
        >
          Processing locally, in the background.
        </Brief>
      </p>
    </div>
  );
}

function SheetPicker() {
  const sheets = useWorkspace((s) => s.sheets);
  const file = useWorkspace((s) => s.pendingFile);
  const choose = useWorkspace((s) => s.chooseSheet);
  // Opened from "Use one sheet instead": the same workbook is open as joined sheets.
  const joined = useWorkspace((s) => Boolean(s.summary?.model) && s.pendingFile === s.lastFile);
  return (
    <Dialog
      open={Boolean(sheets)}
      onOpenChange={(o) => (!o ? useWorkspace.setState({ sheets: null, pendingFile: null }) : undefined)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose a sheet</DialogTitle>
          <DialogDescription>
            {joined
              ? `Analyse one sheet of ${file?.name} on its own instead of the joined sheets. Cancel keeps the joined table.`
              : (sheets?.length ?? 0) > MAX_MODEL_SHEETS
                ? `${file?.name} has ${sheets?.length} sheets. Loupe analyses one table at a time.`
                : `${file?.name} has ${sheets?.length} sheets, and none of them looks up another by a shared key, so Loupe analyses one table at a time.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {sheets?.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => void choose(s)}
              className="flex items-center justify-between rounded-control border border-border px-3 py-2.5 text-left text-sm text-fg transition-colors hover:border-border-hover hover:bg-surface-hover focus-visible:focus-ring active:bg-surface-active"
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
                "rounded-control border p-3 text-left transition-colors focus-visible:focus-ring",
                mode === o.id
                  ? "border-accent bg-surface-selected"
                  : "border-border hover:border-border-hover hover:bg-surface-hover",
              )}
            >
              <p className="text-sm font-medium text-fg">{o.title}</p>
              <p className="mt-0.5 text-sm text-fg-muted">{o.body}</p>
            </button>
          ))}
        </div>
        {mode === "columns" ? (
          <div className="max-h-48 overflow-y-auto rounded-control border border-border p-2">
            {a.columns.map((c) => (
              <label
                key={c}
                className="flex items-center gap-2 rounded-xs px-1.5 py-1 text-ui text-fg hover:bg-surface-hover"
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
        <p className="text-xs text-fg-subtle">
          <Brief
            label="About loading the full file"
            full="Prefer the full file? Split it by date (e.g. one file per year) and analyse each part, or load it into DuckDB/BigQuery and export a summary table."
          >
            Prefer the full file? Split it first.
          </Brief>
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
