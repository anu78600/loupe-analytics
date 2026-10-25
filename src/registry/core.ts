/**
 * The six industries Loupe is built around (roadmap 2.1, version 52.4): each
 * has its demo, its reviewed KPI set and its place on the landing page. The
 * other templates stay and work; they are labelled Beta, and lean on the
 * data-led dashboard when they fit a file weakly. A plain list with no
 * registry import, so the interface can read it without loading every
 * template.
 */
export const CORE_DOMAIN_IDS: readonly string[] = [
  "ecommerce",
  "sales",
  "finance",
  "marketing",
  "saas",
  "hr",
];

/** True for a registry industry outside the core six (never for the data-led "generic" dashboard). */
export function isBetaDomain(id: string): boolean {
  return id !== "generic" && !CORE_DOMAIN_IDS.includes(id);
}
