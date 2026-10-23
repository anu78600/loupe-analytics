/**
 * The Prepare phase's guided flow (version 50.2): the words of Upload and
 * Detect that carry logic (ui/workspace/flow/prepareWords.ts).
 *
 * - Each demo on Upload shows its industry's own registry icon, and every
 *   demo in the catalogue has one.
 * - "How it works" names the flow's four steps in order.
 * - Detect's next-step dock says where the industry choice stands: a ranked
 *   industry with its match, the general dashboard because nothing fits or
 *   by choice, or an industry chosen from outside the top matches.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLES } from "@/engine/samples/catalog";
import { LOW_FIT } from "@/ui/workspace/industryFit";
import { DEMO_ICON, HOW_IT_WORKS, demoIcon, detectStatus } from "@/ui/workspace/flow/prepareWords";

/** A registry industry's own icon name, read from its JSON. */
function registryIcon(domain: string): string {
  const file = join(__dirname, "..", "src", "registry", "domains", `${domain}.json`);
  return (JSON.parse(readFileSync(file, "utf8")) as { icon: string }).icon;
}

describe("Upload", () => {
  it("shows each demo with its industry's registry icon", () => {
    for (const s of SAMPLES) {
      expect(DEMO_ICON[s.domain], s.id).toBeDefined();
      expect(demoIcon(s.domain), s.id).toBe(registryIcon(s.domain));
    }
    expect(demoIcon("not-an-industry")).toBe("table");
  });

  it("walks through the flow's four steps, one short line each", () => {
    expect(HOW_IT_WORKS.map((s) => s.name)).toEqual(["Upload", "Understand", "Review", "Dashboard"]);
    for (const s of HOW_IT_WORKS) expect(s.line.length, s.name).toBeLessThanOrEqual(32);
  });
});

describe("Detect's dock", () => {
  const candidates = [
    { domainId: "ecommerce", name: "E-commerce", confidence: 99 },
    { domainId: "sales", name: "Sales & Retail", confidence: 70 },
  ];

  it("names a ranked industry with its match", () => {
    expect(detectStatus({ domainId: "ecommerce", candidates })).toBe("E-commerce · 99% match");
    expect(detectStatus({ domainId: "sales", candidates })).toBe("Sales & Retail · 70% match");
  });

  it("says when no industry fits, and when the general dashboard was chosen anyway", () => {
    const weak = [{ domainId: "pharma", name: "Pharma", confidence: LOW_FIT - 1 }];
    expect(detectStatus({ domainId: "generic", candidates: weak })).toBe(
      "No industry fits · a general dashboard",
    );
    expect(detectStatus({ domainId: "generic", candidates: [] })).toBe(
      "No industry fits · a general dashboard",
    );
    expect(detectStatus({ domainId: "generic", candidates })).toBe("A general dashboard · your choice");
  });

  it("names an industry chosen from outside the top matches, and asks for one when none is chosen", () => {
    expect(detectStatus({ domainId: "hr", candidates, name: "HR & People" })).toBe(
      "HR & People · your choice",
    );
    expect(detectStatus({ domainId: "hr", candidates })).toBe("hr · your choice");
    expect(detectStatus({ domainId: null, candidates })).toBe("Choose an industry");
  });
});
