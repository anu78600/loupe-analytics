"use client";

/**
 * Settings › "What Loupe has learned": every rule learned from the user's
 * corrections ("Files with columns Order ID, Order Date…: E-commerce; Net
 * Amount → Net revenue") and every word taught in Check & map, each with a
 * delete button; clear all (after a yes); export as a JSON file and import
 * one, so a team can share what Loupe knows. Imports are validated
 * (store/learned.ts parseLearned) and a malformed file changes nothing. The
 * one-line privacy note says what is kept: header names and choices only,
 * in this browser.
 */
import * as React from "react";
import { toast } from "sonner";
import { Download, Trash2, Upload } from "lucide-react";
import { columnsPreview, describeRule, exportLearned, useLearned } from "@/store/learned";
import { useSettings } from "@/store/settings";
import { downloadBlob, exportFileName } from "@/lib/utils";
import { countOf } from "@/ui/common/words";
import { Button } from "@/ui/primitives/button";
import { askConfirm } from "./confirm";

/** "3 Oct 2026", in the viewer's time zone (these are real moments, not dates from the data). */
const day = (t: number) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(t);

const usedText = (uses: number) =>
  uses === 0 ? "not used yet" : uses === 1 ? "used once" : `used ${uses} times`;

const ITEM =
  "flex items-start justify-between gap-3 rounded-card border border-border bg-surface-2 px-3 py-2.5";

export function LearnedSettings() {
  const rules = useLearned((s) => s.rules);
  const words = useLearned((s) => s.words);
  const removeRule = useLearned((s) => s.removeRule);
  const removeWord = useLearned((s) => s.removeWord);
  const clearAll = useLearned((s) => s.clearAll);
  const importJson = useLearned((s) => s.importJson);
  const locale = useSettings((s) => s.numberLocale);
  const input = React.useRef<HTMLInputElement>(null);
  const headingId = React.useId();
  const empty = !rules.length && !words.length;

  const exportFile = () =>
    downloadBlob(
      exportLearned(rules, words, Date.now()),
      exportFileName(undefined, "learned", "json"),
      "application/json",
    );
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const res = importJson(await file.text());
    if (input.current) input.current.value = "";
    if (!res.ok) {
      toast.error(res.error, { description: "Nothing was imported." });
      return;
    }
    toast.success(`Imported ${countOf(res.rules, "rule", locale)} and ${countOf(res.words, "word", locale)}`);
  };
  const clear = async () => {
    const ok = await askConfirm({
      title: "Forget everything Loupe has learned?",
      body: "Every rule and word goes from this browser. Files you open later are read from detection alone.",
      note: "Export first if you want to keep a copy.",
      confirmLabel: "Forget all",
      tone: "danger",
    });
    if (ok) clearAll();
  };

  return (
    <section className="grid gap-3" aria-labelledby={headingId}>
      <h3 id={headingId} className="eyebrow text-fg-subtle">
        What Loupe has learned
      </h3>
      <p className="text-xs text-fg-subtle">
        Stored only in this browser: header names and your choices (for value meanings, the category labels
        you picked), never cell values.
      </p>
      {empty ? (
        <p className="text-sm leading-relaxed text-fg-muted">
          Nothing yet. Correct the industry, a mapping, a value meaning or a column&apos;s role, or hide a
          column, and Loupe reuses it for files like that one, saying so each time.
        </p>
      ) : (
        <ul className="grid max-h-96 gap-2 overflow-y-auto" aria-label="Learned rules and words">
          {rules.map((r) => {
            const files = `Files with columns ${columnsPreview(r.columns)}`;
            return (
              <li key={r.id} className={ITEM}>
                <div className="min-w-0">
                  <p className="text-ui break-words text-fg">
                    {files}: {describeRule(r).join("; ")}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-subtle">
                    Learned {day(r.learnedAt)} · {usedText(r.uses)}
                  </p>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete: ${files}`}
                  onClick={() => removeRule(r.id)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            );
          })}
          {words.map((w) => (
            <li key={w.id} className={ITEM}>
              <div className="min-w-0">
                <p className="text-ui break-words text-fg">
                  “{w.header}” means {w.fieldLabel} ({w.domainName})
                </p>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  Learned {day(w.learnedAt)} · {usedText(w.uses)}
                </p>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete the word “${w.header}”`}
                onClick={() => removeWord(w.id)}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={exportFile} disabled={empty}>
          <Download aria-hidden /> Export
        </Button>
        <Button size="sm" variant="ghost" onClick={() => input.current?.click()}>
          <Upload aria-hidden /> Import
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void clear()} disabled={empty}>
          <Trash2 aria-hidden /> Clear all
        </Button>
        {/* Reached through the Import button, so it takes no tab stop of its own. */}
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Import what Loupe has learned"
          onChange={(e) => void importFile(e.target.files?.[0])}
        />
      </div>
    </section>
  );
}
