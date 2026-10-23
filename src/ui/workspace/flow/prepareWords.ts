/**
 * The words of the Prepare phase's guided flow (version 50.2) that carry
 * logic, kept as plain functions so tests/prepare-flow.test.ts reads them
 * without the components:
 *
 * - each demo's industry icon on Upload: the registry's own icon for the
 *   industry the demo shows (the catalogue stays metadata only, and the
 *   registry stays out of the upload page's bundle, so the icon names are
 *   listed here and the test holds them to the registry);
 * - Upload's "How it works" row: the four steps from a file to a dashboard;
 * - the status line of Detect's next-step dock ("E-commerce · 99% match",
 *   "No industry fits · a general dashboard").
 *
 * Every figure in them is detection's; nothing here computes one.
 */
import type { DomainCandidate } from "@/engine/detect/detect";
import { LOW_FIT } from "../industryFit";

/** The registry icon (src/registry/domains/<id>.json "icon") of each demo's industry. */
export const DEMO_ICON: Readonly<Record<string, string>> = {
  ecommerce: "shopping-bag",
  sales: "receipt",
  marketing: "megaphone",
  saas: "repeat",
  finance: "landmark",
  hr: "users",
};

/** A demo's industry icon name for DomainIcon; a table for an industry not listed. */
export function demoIcon(domain: string): string {
  return DEMO_ICON[domain] ?? "table";
}

/** Upload's "How it works": the flow from a file to a dashboard, one short line a step. */
export const HOW_IT_WORKS: ReadonlyArray<{ name: string; line: string }> = [
  { name: "Upload", line: "A CSV, Excel or JSON table." },
  { name: "Understand", line: "Loupe reads every column." },
  { name: "Review", line: "Check how each one was read." },
  { name: "Dashboard", line: "KPIs, charts, SQL and DAX." },
];

/**
 * Where the industry choice stands, for the status of Detect's dock: a ranked industry with its
 * match, the general dashboard (because nothing fits, or by the user's choice), or an industry
 * chosen from outside the top matches. `name` names the chosen industry when it isn't ranked.
 */
export function detectStatus({
  domainId,
  candidates,
  name,
}: {
  domainId: string | null;
  candidates: ReadonlyArray<Pick<DomainCandidate, "domainId" | "name" | "confidence">>;
  name?: string;
}): string {
  if (!domainId) return "Choose an industry";
  if (domainId === "generic") {
    // Under LOW_FIT detection picks the general dashboard itself; above it, someone chose it.
    const top = candidates[0];
    return !top || top.confidence < LOW_FIT
      ? "No industry fits · a general dashboard"
      : "A general dashboard · your choice";
  }
  const ranked = candidates.find((c) => c.domainId === domainId);
  if (ranked) return `${ranked.name} · ${ranked.confidence}% match`;
  return `${name ?? domainId} · your choice`;
}
