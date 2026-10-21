"use client";

/**
 * Optional AI layer UI (off by default; requests are built in lib/ai.ts).
 * PayloadPreviewDialog shows the exact JSON that will be sent, and nothing
 * leaves the browser until the user clicks Send. AiSummary writes an executive
 * summary from the computed insights and the headline KPIs (written as their
 * cards write them, aiSummaryPayload.ts) and flags any number in it that does
 * not appear in the payload that was sent. AiDomainCheck asks for a second opinion on the
 * detected industry. The API key stays in memory (store/settings.ts).
 */
import * as React from "react";
import { AlertTriangle, Bot, Loader2, Lock, Send, Sparkles } from "lucide-react";
import type { Insight } from "@/engine/insights/insights";
import { useSettings } from "@/store/settings";
import { useWorkspace } from "@/store/workspace";
import { engine } from "@/lib/engine-client";
import {
  domainPreview,
  runDomainCheck,
  runSummary,
  summaryPreview,
  unverifiedNumbers,
  type AiDomainOpinion,
  type AiRequestPreview,
  type AiSummary as AiSummaryResult,
} from "@/lib/ai";
import { Button } from "@/ui/primitives/button";
import { Badge } from "@/ui/primitives/badge";
import { Card } from "@/ui/primitives/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/primitives/dialog";
import { useFmt } from "@/ui/common/hooks";
import { summaryKpis } from "./aiSummaryPayload";

export function PayloadPreviewDialog({
  preview,
  open,
  onCancel,
  onSend,
  sending,
}: {
  preview: AiRequestPreview | null;
  open: boolean;
  onCancel: () => void;
  onSend: () => void;
  sending: boolean;
}) {
  const json = React.useMemo(() => (preview ? JSON.stringify(preview.user, null, 2) : ""), [preview]);
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onCancel() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review what will be sent</DialogTitle>
          <DialogDescription>
            This exact payload goes to {preview?.endpoint} using your API key and model{" "}
            <span className="font-medium text-fg">{preview?.model}</span>. No raw rows are included, only what
            you see below.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <p className="eyebrow mb-1 text-fg-subtle">Instructions</p>
            <pre
              tabIndex={0}
              aria-label="Instructions sent to the model"
              className="max-h-32 overflow-auto rounded-control border border-border bg-bg-subtle p-3 font-mono text-xs leading-relaxed text-fg-muted"
            >
              {preview?.system}
            </pre>
          </div>
          <div>
            <p className="eyebrow mb-1 text-fg-subtle">
              Payload · {new Blob([json]).size.toLocaleString("en-US")} bytes
            </p>
            <pre
              tabIndex={0}
              aria-label="Payload sent to the model"
              className="max-h-72 overflow-auto rounded-control border border-border bg-bg-subtle p-3 font-mono text-xs leading-relaxed text-fg"
            >
              {json}
            </pre>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSend} disabled={sending}>
            {sending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} Send to Claude
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AiSummary({ insights }: { insights: Insight[] }) {
  const ai = useSettings((s) => s.ai);
  const context = useWorkspace((s) => s.context);
  const batch = useWorkspace((s) => s.kpiBatch);
  const business = useWorkspace((s) => s.business);
  const fmt = useFmt();
  const [preview, setPreview] = React.useState<AiRequestPreview | null>(null);
  // The payload last sent: the summary's figures are checked against it, KPI values included.
  const [sent, setSent] = React.useState<AiRequestPreview | null>(null);
  const [sending, setSending] = React.useState(false);
  const [result, setResult] = React.useState<AiSummaryResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const build = () => {
    if (!context) return;
    // As the cards write them: changes with a true minus, rates in percentage points, each with its base.
    const kpis = summaryKpis(batch?.values ?? [], context.kpis, context.selection.hero, fmt);
    setPreview(
      summaryPreview(ai.model, {
        industry: context.domain.name,
        businessModel: business.model ?? null,
        goal: business.goal ?? null,
        notes: business.notes || null,
        period: batch?.period?.label ?? null,
        kpis,
        findings: insights.slice(0, 10).map((i) => ({ id: i.id, title: i.title, detail: i.body })),
      }),
    );
  };

  const send = async () => {
    if (!preview) return;
    if (!ai.apiKey) {
      setError("Add your Anthropic API key in Settings › AI layer first.");
      setPreview(null);
      return;
    }
    setSending(true);
    setError(null);
    try {
      setResult(await runSummary(ai.apiKey, preview));
      setSent(preview);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
      setPreview(null);
    }
  };

  // Figures are verified against what was sent (KPI lines and insights), not against the insights alone.
  const payloadText = JSON.stringify((preview ?? sent)?.user ?? insights.map((i) => [i.title, i.body]));
  return (
    <Card className="mb-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-9 place-items-center rounded-[10px] border border-border-accent bg-accent-soft">
            <Bot className="size-4 text-accent" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-medium text-fg">Executive summary</p>
            <p className="text-ui text-fg-muted">
              Optional. Claude rewrites the computed insights as a brief; you review the exact payload first.
            </p>
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={build} disabled={sending}>
          {sending ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}{" "}
          {result ? "Rewrite" : "Write with Claude"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 flex gap-2 text-ui text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
        </p>
      ) : null}
      {result ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-md font-medium text-fg">{result.headline}</p>
          <ul className="mt-3 grid gap-2">
            {result.bullets.map((b, i) => {
              const bad = unverifiedNumbers(b.text, payloadText);
              return (
                <li key={i} className="flex gap-2 text-sm leading-relaxed text-fg">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                  <span>
                    {b.text}
                    {bad.length ? (
                      <Badge tone="warning" className="ml-2">
                        unverified: {bad.join(", ")}
                      </Badge>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-fg-subtle">
            <Lock className="mt-0.5 size-3 shrink-0" aria-hidden /> Written by {ai.model} from the headline
            KPIs and the insights below. Figures not found in what was sent are flagged as unverified.
          </p>
        </div>
      ) : null}
      <PayloadPreviewDialog
        preview={preview}
        open={Boolean(preview)}
        onCancel={() => setPreview(null)}
        onSend={() => void send()}
        sending={sending}
      />
    </Card>
  );
}

export function AiDomainCheck() {
  const ai = useSettings((s) => s.ai);
  const domains = useWorkspace((s) => s.domains);
  const [preview, setPreview] = React.useState<AiRequestPreview | null>(null);
  const [sending, setSending] = React.useState(false);
  const [opinion, setOpinion] = React.useState<AiDomainOpinion | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  if (!ai.enabled) return null;
  const build = async () => {
    const dataset = await engine().aiPayload();
    setPreview(
      domainPreview(ai.model, {
        domains: [
          ...domains.map((d) => ({ id: d.id, name: d.name, description: d.tagline })),
          { id: "generic", name: "Generic", description: "None of the above" },
        ],
        dataset,
      }),
    );
  };
  const send = async () => {
    if (!preview) return;
    if (!ai.apiKey) {
      setError("Add your Anthropic API key in Settings › AI layer first.");
      setPreview(null);
      return;
    }
    setSending(true);
    setError(null);
    try {
      setOpinion(await runDomainCheck(ai.apiKey, preview));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
      setPreview(null);
    }
  };
  const match = opinion ? domains.find((d) => d.id === opinion.domainId) : undefined;
  return (
    <div className="mt-4 rounded-control border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-ui text-fg">
          <Bot className="size-4 text-accent" aria-hidden /> Second opinion from Claude
        </p>
        <Button size="xs" variant="outline" onClick={() => void build()} disabled={sending}>
          {sending ? <Loader2 className="animate-spin" aria-hidden /> : null} Ask
        </Button>
      </div>
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      {opinion ? (
        <div className="mt-2 text-ui">
          <p className="text-fg">
            {match?.name ?? (opinion.domainId === "generic" ? "Generic" : opinion.domainId)} ·{" "}
            <span className="font-figures">{Math.round(opinion.confidence)}%</span>
          </p>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">{opinion.rationale}</p>
          {match || opinion.domainId === "generic" ? (
            <Button
              size="xs"
              variant="secondary"
              className="mt-2"
              onClick={() => useWorkspace.getState().chooseIndustry(opinion.domainId, null)}
            >
              Use this industry
            </Button>
          ) : null}
        </div>
      ) : null}
      <PayloadPreviewDialog
        preview={preview}
        open={Boolean(preview)}
        onCancel={() => setPreview(null)}
        onSend={() => void send()}
        sending={sending}
      />
    </div>
  );
}
