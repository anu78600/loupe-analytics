/**
 * Feedback (version 51.0): the message Loupe writes for a user's problem or
 * idea, the links that hand it to their own email, and what it may and may
 * not say about them.
 *
 * - The subject and body follow from a few choices (kind, topic, the user's
 *   words); Loupe's details are marked as removable, and left out when the
 *   user unticks them.
 * - The mailto: and Gmail links carry the message exactly, line breaks and
 *   accents included, to the owner's address.
 * - The details name the browser and system, never the user's own file:
 *   errors quoting it are scrubbed.
 * - Nothing in the feature sends anything itself: no fetch, beacon, socket
 *   or XHR, so the privacy rule (no network calls but DuckDB and the opt-in
 *   AI layer) holds.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  browserName,
  buildFeedback,
  DETAILS_HEADING,
  FEEDBACK_EMAIL,
  feedbackDetails,
  feedbackText,
  gmailUrl,
  mailtoUrl,
  TOPICS,
} from "@/lib/feedback";
import { scrubFileName } from "@/ui/workspace/feedbackPlace";

const DEVICE = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  width: 1440,
  height: 900,
  language: "en-GB",
  theme: "dark",
};

describe("the message", () => {
  it("goes to the owner's address", () => {
    expect(FEEDBACK_EMAIL).toBe("universe.airen@gmail.com");
  });

  it("is written from the kind, the topic and the user's words", () => {
    const e = buildFeedback({
      kind: "problem",
      topic: "A number looks wrong",
      message: "  Net revenue shows ₹0 after I filter by Website.  ",
      details: ["Loupe 51.0", "Step: Dashboard (one page)"],
    });
    expect(e.subject).toBe("Loupe feedback · Problem: A number looks wrong");
    expect(e.body).toBe(
      [
        "Problem: A number looks wrong",
        "",
        "Net revenue shows ₹0 after I filter by Website.",
        "",
        "—",
        DETAILS_HEADING,
        "• Loupe 51.0",
        "• Step: Dashboard (one page)",
      ].join("\n"),
    );
  });

  it("leaves a gap to write in, keeps the catch-all topic out of the subject, and drops unticked details", () => {
    const e = buildFeedback({ kind: "idea", topic: "Something else", message: "", details: [] });
    expect(e.subject).toBe("Loupe feedback · Idea");
    expect(e.body).toBe("Idea: Something else\n\n(Write here what happened or what you would like.)");
    expect(e.body).not.toContain(DETAILS_HEADING);
  });

  it("offers a catch-all last for each kind", () => {
    for (const list of Object.values(TOPICS)) expect(list.at(-1)).toBe("Something else");
  });
});

describe("the links", () => {
  const email = buildFeedback({
    kind: "idea",
    topic: "A chart I'd like",
    message: "A funnel & a café's sales, line one\nline two",
    details: [],
  });

  it("open the user's email app on the exact message, lines as CRLF", () => {
    const url = mailtoUrl(FEEDBACK_EMAIL, email);
    expect(url.startsWith(`mailto:${FEEDBACK_EMAIL}?subject=`)).toBe(true);
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(params.get("subject")).toBe(email.subject);
    expect(params.get("body")).toBe(email.body.replace(/\n/g, "\r\n"));
    // Spaces are %20, not "+", which some email apps would show as plus signs.
    expect(url).not.toContain("+");
  });

  it("open Gmail's compose page on it", () => {
    const url = new URL(gmailUrl(FEEDBACK_EMAIL, email));
    expect(url.origin + url.pathname).toBe("https://mail.google.com/mail/");
    expect(url.searchParams.get("to")).toBe(FEEDBACK_EMAIL);
    expect(url.searchParams.get("su")).toBe(email.subject);
    expect(url.searchParams.get("body")).toBe(email.body);
  });

  it("copy it whole, addressed", () => {
    expect(feedbackText(FEEDBACK_EMAIL, email)).toBe(
      `To: ${FEEDBACK_EMAIL}\nSubject: ${email.subject}\n\n${email.body}`,
    );
  });
});

describe("the details", () => {
  it("name the browser and system", () => {
    expect(browserName(DEVICE.userAgent)).toBe("Chrome 130 on Windows");
    expect(
      browserName(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.56",
      ),
    ).toBe("Edge 130 on Windows");
    expect(
      browserName(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari 18 on iOS");
    expect(browserName("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe(
      "Firefox 131 on Linux",
    );
    expect(browserName("")).toBe("Unknown browser on an unknown system");
  });

  it("put the version first, then where the user was, then the device", () => {
    expect(feedbackDetails("51.0", ["Step: Detect"], DEVICE)).toEqual([
      "Loupe 51.0",
      "Step: Detect",
      "Chrome 130 on Windows · window 1440 × 900 · en-GB · dark theme",
    ]);
  });

  it("never name the user's own file in an error they report", () => {
    expect(
      scrubFileName("Couldn't read Client salaries 2025.xlsx: bad header", "Client salaries 2025.xlsx"),
    ).toBe("Couldn't read your file: bad header");
    expect(scrubFileName("Sheet 1 of Client salaries 2025 is empty", "Client salaries 2025.xlsx")).toBe(
      "Sheet 1 of your file is empty",
    );
    expect(scrubFileName("No file", null)).toBe("No file");
  });
});

describe("privacy", () => {
  it("sends nothing itself: the feature hands the message to the user's own email", () => {
    for (const file of [
      "src/lib/feedback.ts",
      "src/ui/common/feedback/FeedbackDialog.tsx",
      "src/ui/common/feedback/FeedbackLink.tsx",
      "src/ui/common/feedback/store.ts",
      "src/ui/workspace/feedbackPlace.ts",
    ]) {
      const code = readFileSync(join(process.cwd(), file), "utf8");
      expect(code, file).not.toMatch(/\bfetch\s*\(|sendBeacon|XMLHttpRequest|new WebSocket|EventSource/);
    }
  });
});
