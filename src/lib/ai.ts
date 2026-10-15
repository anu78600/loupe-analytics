"use client";

/**
 * Optional AI layer (off by default). Bring your own Anthropic API key; it is
 * held in memory for this tab only. Requests contain only what the payload
 * preview shows: schema, aggregates, computed findings, and a tiny masked
 * sample, never the raw dataset.
 *
 * Calls go straight from the browser to api.anthropic.com through the
 * official SDK; there is no Loupe server in between. The preview object IS
 * the request: run*() sends exactly its model, system prompt and
 * JSON-serialised `user` payload, so what the user approved is what leaves.
 * Answers are parsed against zod schemas (structured outputs), and any number
 * in model text is treated as untrusted until found in the payload
 * (unverifiedNumbers).
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

/** Models offered in Settings; the first is the default (also the settings store's initial model). */
export const AI_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Default · most capable Opus" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Faster, lower cost" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "Fastest, lowest cost" },
] as const;

/** Exactly what will be sent, shown to the user for approval before any request. */
export interface AiRequestPreview {
  /** Display only; the SDK decides the actual URL. */
  endpoint: string;
  model: string;
  system: string;
  /** Sent as the single user message, JSON-serialised. */
  user: Record<string, unknown>;
}

const SUMMARY_SYSTEM = `You are a senior business analyst writing for a busy executive.
Summarise the computed findings you are given into a headline and 3 to 5 bullets.
Rules:
- Use only numbers that appear in the provided findings or KPI values, copied exactly as written. Never calculate, round, estimate or invent a figure.
- If the data does not support a statement, leave it out.
- Each bullet is one sentence of at most 30 words in plain business language, and lists the ids of the findings it draws on.
- Prefer what changed, why it matters, and what to look at next.`;

const DOMAIN_SYSTEM = `You classify business datasets into one industry from a fixed list, using only the column names, types, roles, summary statistics and masked sample provided.
Return the best-matching domain id (or "generic" if none fits), a confidence from 0 to 100, a one-paragraph rationale, and the column names that were decisive.`;

// Each bullet carries the ids of the findings it draws on, as the system prompt requires.
const SummarySchema = z.object({
  headline: z.string(),
  bullets: z
    .array(z.object({ text: z.string(), insightIds: z.array(z.string()) }))
    .min(1)
    .max(6),
});
export type AiSummary = z.infer<typeof SummarySchema>;

const DomainSchema = z.object({
  domainId: z.string(),
  confidence: z.number(),
  rationale: z.string(),
  decisiveColumns: z.array(z.string()),
});
export type AiDomainOpinion = z.infer<typeof DomainSchema>;

// A fresh client per request; nothing in this module keeps the key between calls.
// dangerouslyAllowBrowser: the SDK refuses to run in a browser without it,
// because a key in page memory is visible to any script on the page. Here
// the key is the user's own, kept in memory only and sent only to Anthropic.
function client(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
}

// Opus/Sonnet 5.5 opt into server-side refusal fallback: if the model's
// safety classifiers decline, the API re-runs the request on Anthropic's
// recommended fallback model ("default", routed by refusal category) instead
// of returning the refusal.
function supportsFallbacks(model: string): boolean {
  return model === "claude-opus-5-5" || model === "claude-sonnet-5-5";
}

// Most specific first: every SDK error class extends APIError, so it must come last.
function friendlyError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError)
    return new Error("The API key was rejected. Check it in Settings › AI layer.");
  if (e instanceof Anthropic.PermissionDeniedError)
    return new Error("This key doesn't have access to that model.");
  if (e instanceof Anthropic.RateLimitError)
    return new Error("Rate limited by the API. Wait a moment and try again.");
  if (e instanceof Anthropic.BadRequestError) return new Error(`The request was rejected: ${e.message}`);
  if (e instanceof Anthropic.APIConnectionError)
    return new Error("Couldn't reach api.anthropic.com. Check your connection or network policy.");
  if (e instanceof Anthropic.APIError) return new Error(`API error ${e.status ?? ""}: ${e.message}`);
  return e instanceof Error ? e : new Error(String(e));
}

/** Request for the executive summary of computed findings; show it to the user, then pass it to runSummary(). */
export function summaryPreview(model: string, payload: Record<string, unknown>): AiRequestPreview {
  return { endpoint: "https://api.anthropic.com/v1/messages", model, system: SUMMARY_SYSTEM, user: payload };
}

/** Request for a second opinion on the detected domain; the payload carries Session.aiPayload(). */
export function domainPreview(model: string, payload: Record<string, unknown>): AiRequestPreview {
  return { endpoint: "https://api.anthropic.com/v1/messages", model, system: DOMAIN_SYSTEM, user: payload };
}

/**
 * Sends `preview` and returns the schema-validated answer. Throws a
 * user-facing Error on refusal (after any fallback), truncation, schema
 * mismatch or any API/network failure.
 */
async function parseWith<T extends z.ZodType>(
  apiKey: string,
  preview: AiRequestPreview,
  schema: T,
  effort: "low" | "medium",
): Promise<z.infer<T>> {
  const c = client(apiKey);
  const isHaiku = preview.model.startsWith("claude-haiku");
  try {
    // Haiku 4.5 rejects the `effort` setting, so it only gets the output format.
    const res = await c.beta.messages.parse({
      model: preview.model,
      max_tokens: 8000,
      system: preview.system,
      messages: [{ role: "user", content: JSON.stringify(preview.user) }],
      ...(supportsFallbacks(preview.model)
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
      output_config: isHaiku
        ? { format: betaZodOutputFormat(schema) }
        : { effort, format: betaZodOutputFormat(schema) },
    });
    // Check stop_reason before trusting the output: a refusal that survives the fallback, or a cut-off answer, is not usable.
    if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
    if (res.stop_reason === "max_tokens")
      throw new Error("The response was cut off before it finished. Try again.");
    if (!res.parsed_output) throw new Error("The response didn't match the expected format.");
    return res.parsed_output as z.infer<T>;
  } catch (e) {
    throw friendlyError(e);
  }
}

/** Sends a summaryPreview() request (medium effort). */
export async function runSummary(apiKey: string, preview: AiRequestPreview): Promise<AiSummary> {
  return parseWith(apiKey, preview, SummarySchema, "medium");
}

/** Sends a domainPreview() request (low effort: a short classification). */
export async function runDomainCheck(apiKey: string, preview: AiRequestPreview): Promise<AiDomainOpinion> {
  return parseWith(apiKey, preview, DomainSchema, "low");
}

/**
 * A number in model text: optional currency prefix, digits with group commas
 * (never a trailing one, as in "12, 15") and decimals, then an optional unit
 * (%, ×, or pp, Cr, L, K, M, B, x). A letter unit counts only when no letter
 * or digit follows it, so "12 Markets" is the number 12 and a word, not
 * "12M". Spaces are matched only inside a token, never around it.
 */
const NUMBER_TOKEN =
  /(?:[₹$€£]\s?)?\d(?:[\d,]*\d)?(?:\.\d+)?(?:\s?(?:%|×|(?:pp|Cr|L|K|M|B|x)(?![\p{L}\p{N}])))?/gu;

/**
 * Numbers in AI text that don't appear in the payload are flagged, never trusted.
 * Tokens are a number with an optional currency prefix and unit suffix (see
 * NUMBER_TOKEN). Spaces and digit-group commas are ignored, so Indian and
 * international groupings compare equal, and the currency symbol may be
 * absent from the payload. Single-character tokens are skipped. A plain
 * substring test, so it can miss a fabricated number that happens to occur
 * inside a longer one.
 */
export function unverifiedNumbers(text: string, payloadText: string): string[] {
  const tokens = text.match(NUMBER_TOKEN) ?? [];
  const norm = (s: string) => s.replace(/[\s,]/g, "");
  const haystack = norm(payloadText);
  return tokens.filter((t) => {
    const n = norm(t);
    const bare = n.replace(/[₹$€£]/g, "");
    return bare.length > 1 && !haystack.includes(n) && !haystack.includes(bare);
  });
}
