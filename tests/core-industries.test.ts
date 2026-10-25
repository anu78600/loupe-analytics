/**
 * The six core industries (roadmap 2.1, version 52.4): each is a registry
 * industry with its own demo, and every other registry industry is Beta. The
 * data-led dashboard ("generic") is neither.
 */
import { describe, expect, it } from "vitest";
import { CORE_DOMAIN_IDS, isBetaDomain } from "@/registry/core";
import { DOMAINS } from "@/registry";
import { SAMPLES } from "@/engine/samples/catalog";

describe("the core industries", () => {
  it("are six registry industries, each with a demo", () => {
    expect(CORE_DOMAIN_IDS).toHaveLength(6);
    const registry = new Set(DOMAINS.map((d) => d.id));
    const demos = new Set(SAMPLES.map((s) => s.id));
    for (const id of CORE_DOMAIN_IDS) {
      expect(registry.has(id), id).toBe(true);
      expect(demos.has(id), id).toBe(true);
    }
  });

  it("mark every other registry industry Beta, and never the data-led dashboard", () => {
    for (const d of DOMAINS) expect(isBetaDomain(d.id), d.id).toBe(!CORE_DOMAIN_IDS.includes(d.id));
    expect(isBetaDomain("generic")).toBe(false);
  });
});
