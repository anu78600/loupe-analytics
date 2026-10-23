/**
 * Feedback (version 51.0): what a user's message about a problem or an idea
 * says, and how it reaches the owner, as pure functions (the dialog is
 * ui/common/feedback/FeedbackDialog.tsx).
 *
 * Loupe sends nothing itself (the privacy rule: no network calls but DuckDB
 * and the opt-in AI layer). Feedback opens the user's own email instead,
 * already written: through their email app (a mailto: link) or Gmail's
 * compose page in a new tab, or copied to paste anywhere. The user sees the
 * whole message and sends it, or not.
 *
 * To make it quick, the user only picks what it is about (a problem or an
 * idea, and a topic such as "A number looks wrong") and says it in their own
 * words; Loupe writes the rest: the subject, and, when the user leaves it
 * on, a short block of details that help reproduce a problem (the version,
 * where they were, the shape of their data, their browser and screen). The
 * details never hold the data's values, and never the name of the user's own
 * file (only a demo's name), because a file name can say what a business is.
 */

/** Where feedback goes: the owner's address. */
export const FEEDBACK_EMAIL = "universe.airen@gmail.com";

export type FeedbackKind = "problem" | "idea";

export const KIND_LABEL: Record<FeedbackKind, string> = {
  problem: "Report a problem",
  idea: "Suggest an idea",
};

/** The word that leads the subject line. */
const KIND_WORD: Record<FeedbackKind, string> = { problem: "Problem", idea: "Idea" };

/**
 * Ready-made topics, so a user can say what it is about in one tap and only
 * write the specifics. The last of each list is the catch-all.
 */
export const TOPICS: Record<FeedbackKind, readonly string[]> = {
  problem: [
    "A number looks wrong",
    "A column was read wrong",
    "The wrong industry was detected",
    "A chart is wrong or missing",
    "An export didn't work",
    "It's slow or stuck",
    "Something looks broken",
    "Something else",
  ],
  idea: [
    "A chart I'd like",
    "A KPI to add",
    "An industry to support",
    "Easier on my phone",
    "Another export format",
    "Something else",
  ],
};

/** What the message box asks, and an example of an answer, for each kind. */
export const PROMPT: Record<FeedbackKind, { label: string; placeholder: string }> = {
  problem: {
    label: "What happened, and what did you expect?",
    placeholder: "e.g. Net revenue shows ₹0 after I filter by Website; I expected the website's sales.",
  },
  idea: {
    label: "What would make Loupe better for you?",
    placeholder: "e.g. A funnel chart for my sales stages, from lead to won.",
  },
};

/**
 * Above this length a mailto: link may be cut short or refused by the email
 * app (Windows and some clients cap a link near 2,000 characters); the
 * dialog then offers Gmail or a copy instead.
 */
export const MAILTO_SAFE_LENGTH = 1900;

export interface FeedbackDraft {
  kind: FeedbackKind;
  /** The topic picked from TOPICS, if any. */
  topic: string | null;
  /** The user's own words. */
  message: string;
  /** Lines Loupe adds about the app, the data and the device (feedbackDetails), or none. */
  details: readonly string[];
}

/** The email Loupe writes: its subject and its plain-text body. */
export interface FeedbackEmail {
  subject: string;
  body: string;
}

/** Marks Loupe's part of the body, so the user knows they may delete it. */
export const DETAILS_HEADING = "Added by Loupe to help (you can delete this):";

/**
 * The email for a draft: "Loupe feedback · Problem: A number looks wrong",
 * then the user's words (or a gap to write in), then the details.
 */
export function buildFeedback(draft: FeedbackDraft): FeedbackEmail {
  const topic = draft.topic && draft.topic !== "Something else" ? draft.topic : null;
  const subject = `Loupe feedback · ${KIND_WORD[draft.kind]}${topic ? `: ${topic}` : ""}`;
  const lines: string[] = [];
  if (draft.topic) lines.push(`${KIND_WORD[draft.kind]}: ${draft.topic}`, "");
  const words = draft.message.trim();
  lines.push(words || "(Write here what happened or what you would like.)");
  if (draft.details.length) lines.push("", "—", DETAILS_HEADING, ...draft.details.map((d) => `• ${d}`));
  return { subject, body: lines.join("\n") };
}

/** A mailto: link that opens the user's email app on the message (line breaks as CRLF, as RFC 6068 asks). */
export function mailtoUrl(to: string, email: FeedbackEmail): string {
  const enc = (s: string) => encodeURIComponent(s.replace(/\r?\n/g, "\r\n"));
  return `mailto:${to}?subject=${enc(email.subject)}&body=${enc(email.body)}`;
}

/** Gmail's compose page on the message, for users without an email app. */
export function gmailUrl(to: string, email: FeedbackEmail): string {
  const p = new URLSearchParams({ view: "cm", fs: "1", to, su: email.subject, body: email.body });
  return `https://mail.google.com/mail/?${p.toString()}`;
}

/** The whole message as text, for "Copy": the address, the subject and the body. */
export function feedbackText(to: string, email: FeedbackEmail): string {
  return `To: ${to}\nSubject: ${email.subject}\n\n${email.body}`;
}

/** What the browser says about itself, read once when the dialog opens. */
export interface DeviceInfo {
  userAgent: string;
  width: number;
  height: number;
  language: string;
  /** The theme on screen. */
  theme: string;
}

/** "Chrome 130 on Windows": the browser and system named from a user-agent string. */
export function browserName(userAgent: string): string {
  const ua = userAgent;
  const version = (re: RegExp) => re.exec(ua)?.[1]?.split(".")[0];
  const browser = /Edg\//.test(ua)
    ? `Edge ${version(/Edg\/([\d.]+)/) ?? ""}`
    : /OPR\//.test(ua)
      ? `Opera ${version(/OPR\/([\d.]+)/) ?? ""}`
      : /Firefox\//.test(ua)
        ? `Firefox ${version(/Firefox\/([\d.]+)/) ?? ""}`
        : /Chrome\//.test(ua)
          ? `Chrome ${version(/Chrome\/([\d.]+)/) ?? ""}`
          : /Safari\//.test(ua)
            ? `Safari ${version(/Version\/([\d.]+)/) ?? ""}`
            : "Unknown browser";
  const system = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "an unknown system";
  return `${browser.trim()} on ${system}`;
}

/**
 * The details Loupe adds: the version and the page, any lines about where the
 * user was and their data (from the opener: the workspace knows the step and
 * the data's shape, a site page only its own name), and the device.
 */
export function feedbackDetails(version: string, place: readonly string[], device: DeviceInfo): string[] {
  return [
    `Loupe ${version}`,
    ...place,
    `${browserName(device.userAgent)} · window ${device.width} × ${device.height} · ${device.language} · ${device.theme} theme`,
  ];
}
