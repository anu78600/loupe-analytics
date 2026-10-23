"use client";

/**
 * The feedback dialog (version 51.0), mounted once for every page by the
 * root Providers and opened through useFeedback (./store.ts).
 *
 * Three quick choices write most of the message: a problem or an idea, a
 * ready-made topic ("A number looks wrong"), and the user's own words, asked
 * for with an example. Loupe adds the details that help (lib/feedback.ts:
 * the version, where the user was, the shape of their data, their browser
 * and screen), which the user can see in full and leave out with one tick.
 *
 * Nothing is sent from Loupe: "Open in my email app" (a mailto: link), "Open
 * in Gmail" (Gmail's compose page in a new tab) and "Copy" each hand the
 * finished message to the user, who sends it. A message too long for a
 * mailto: link says so and leaves Gmail and Copy. Each opening starts a
 * fresh form (keyed on the store's nonce), so no state resets in an effect.
 */
import * as React from "react";
import { toast } from "sonner";
import { Bug, Check, ChevronRight, Copy, Lightbulb, Mail, ShieldCheck } from "lucide-react";
import {
  buildFeedback,
  FEEDBACK_EMAIL,
  feedbackDetails,
  feedbackText,
  gmailUrl,
  KIND_LABEL,
  MAILTO_SAFE_LENGTH,
  mailtoUrl,
  PROMPT,
  TOPICS,
  type DeviceInfo,
  type FeedbackKind,
} from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/primitives/dialog";
import { Label, Textarea } from "@/ui/primitives/input";
import { Checkbox } from "@/ui/primitives/misc";
import { Segmented } from "@/ui/primitives/segmented";
import { useFeedback, type FeedbackRequest } from "./store";

/** The longest message the box takes: room to explain, short enough for most email links. */
const MAX_MESSAGE = 1200;

export function FeedbackDialog({ version }: { version: string }) {
  const open = useFeedback((s) => s.open);
  const setOpen = useFeedback((s) => s.setOpen);
  const request = useFeedback((s) => s.request);
  const nonce = useFeedback((s) => s.nonce);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {open ? (
        <FeedbackForm key={nonce} version={version} request={request} onSent={() => setOpen(false)} />
      ) : null}
    </Dialog>
  );
}

/** What the browser says about itself and the theme on screen; read when the form first renders, which is always in the browser. */
function readDevice(): DeviceInfo {
  return {
    userAgent: navigator.userAgent,
    width: window.innerWidth,
    height: window.innerHeight,
    language: navigator.language,
    theme: document.documentElement.dataset.theme ?? "dark",
  };
}

function FeedbackForm({
  version,
  request,
  onSent,
}: {
  version: string;
  request: FeedbackRequest;
  onSent: () => void;
}) {
  const [kind, setKind] = React.useState<FeedbackKind>(request.kind ?? "problem");
  const [topic, setTopic] = React.useState<string | null>(request.topic ?? null);
  const [message, setMessage] = React.useState("");
  const [withDetails, setWithDetails] = React.useState(true);
  const [copied, setCopied] = React.useState(false);
  const [device] = React.useState(readDevice);
  const messageId = React.useId();
  const detailsId = React.useId();

  const details = withDetails ? feedbackDetails(version, request.place ?? [], device) : [];
  const email = buildFeedback({ kind, topic, message, details });
  const mailto = mailtoUrl(FEEDBACK_EMAIL, email);
  const tooLong = mailto.length > MAILTO_SAFE_LENGTH;
  const prompt = PROMPT[kind];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(feedbackText(FEEDBACK_EMAIL, email));
      setCopied(true);
      toast.success(`Copied. Paste it into an email to ${FEEDBACK_EMAIL}.`);
    } catch {
      toast.error("Copying isn't allowed here. Select the address below and write to it directly.");
    }
  };

  return (
    <DialogContent className="max-w-xl" initialFocus="content">
      <DialogHeader>
        <DialogTitle>Send feedback</DialogTitle>
        <DialogDescription>
          Pick what it&apos;s about and say it in a line or two. Loupe writes the rest.
        </DialogDescription>
      </DialogHeader>

      <Segmented<FeedbackKind>
        ariaLabel="Kind of feedback"
        value={kind}
        onChange={(k) => {
          setKind(k);
          setTopic(null);
        }}
        className="w-full [&>*]:flex-1"
        options={[
          { value: "problem", label: KIND_LABEL.problem, icon: <Bug aria-hidden /> },
          { value: "idea", label: KIND_LABEL.idea, icon: <Lightbulb aria-hidden /> },
        ]}
      />

      <fieldset className="min-w-0">
        <legend className="eyebrow mb-2 text-fg-subtle">What is it about?</legend>
        <div className="flex flex-wrap gap-1.5">
          {TOPICS[kind].map((t) => {
            const on = topic === t;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => setTopic(on ? null : t)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-ui transition-colors duration-fast focus-visible:focus-ring",
                  on
                    ? "border-border-accent bg-accent-soft text-accent-text"
                    : "border-border bg-surface-raised-control text-fg-muted hover:border-border-hover hover:text-fg",
                )}
              >
                {on ? <Check aria-hidden className="size-3.5" /> : null}
                {t}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor={messageId}>{prompt.label}</Label>
        <Textarea
          id={messageId}
          rows={4}
          maxLength={MAX_MESSAGE}
          placeholder={prompt.placeholder}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <p className="tabular text-right text-2xs text-fg-subtle" aria-live="polite">
          {message.length > MAX_MESSAGE * 0.8 ? `${MAX_MESSAGE - message.length} characters left` : ""}
        </p>
      </div>

      <div className="grid gap-2 rounded-card border border-border p-3">
        <div className="flex items-start gap-2.5">
          <Checkbox
            id={detailsId}
            checked={withDetails}
            onCheckedChange={(v) => setWithDetails(v === true)}
            className="mt-0.5"
          />
          <Label htmlFor={detailsId} className="leading-snug font-normal text-fg">
            Add details that help us fix it
            <span className="block text-xs text-fg-subtle">
              The version, where you were and your browser. Never your data&apos;s values or your file&apos;s
              name.
            </span>
          </Label>
        </div>
        {withDetails ? (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-sm text-xs font-medium text-accent-text focus-visible:focus-ring [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden
                className="size-3.5 transition-transform duration-fast group-open:rotate-90"
              />
              See what&apos;s added
            </summary>
            <ul className="mt-2 grid gap-1 rounded-control bg-surface-inset px-3 py-2 text-xs text-fg-muted">
              {details.map((d) => (
                <li key={d} className="break-words">
                  {d}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {tooLong ? (
        <p role="status" className="text-xs text-warning-text">
          This is too long for an email link. Open it in Gmail, or copy it into an email.
        </p>
      ) : null}

      <DialogFooter className="sm:items-center">
        <Button variant="ghost" onClick={() => void copy()}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button variant="secondary" asChild>
          <a
            href={gmailUrl(FEEDBACK_EMAIL, email)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onSent}
          >
            Open in Gmail
          </a>
        </Button>
        {tooLong ? null : (
          <Button variant="primary" asChild>
            <a href={mailto} onClick={onSent}>
              <Mail aria-hidden />
              Open in my email app
            </a>
          </Button>
        )}
      </DialogFooter>

      <p className="flex items-start gap-1.5 text-xs text-fg-subtle">
        <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
        <span>
          It opens in your own email, so nothing is sent until you press send. It goes to{" "}
          <span className="font-medium text-fg-muted select-all">{FEEDBACK_EMAIL}</span>.
        </span>
      </p>
    </DialogContent>
  );
}
