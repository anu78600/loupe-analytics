/**
 * Honest when an industry doesn't fit (version 48.1, ui/workspace/industryFit.ts
 * and the workspace store): an industry chosen on Detect that detection
 * scores under 35% is warned about with how many columns it explains (only
 * an upper bound on its score when it is outside the top matches), never the
 * general dashboard or a good fit; the dashboard notice's line names the
 * mapped columns; and the notice's "Keep" lasts for the file, not the next one.
 */
import { describe, expect, it, vi } from "vitest";
import type { ContextRequest } from "@/engine/session";
import type { DomainCandidate } from "@/engine/detect/detect";
import { LOW_FIT, lowFitOf, lowFitWords, weakFitLine } from "@/ui/workspace/industryFit";
import { useWorkspace } from "@/store/workspace";

// Hoisted above the imports by vitest, so the store talks to this instead of a Web Worker.
vi.mock("@/lib/engine-client", async () => {
  const { Session } = await import("@/engine/session");
  let session = new Session();
  const api = {
    ingestSample: async (id: string) => session.ingestSample(id),
    configure: async (req: ContextRequest) => session.configure(req),
    begin: async () => {},
    // Dashboard refreshes are not under test; report them as superseded.
    computeDashboard: async () => ({ aborted: true, ms: 0, rows: 0 }),
    insights: async () => [],
  };
  return {
    engine: () => api,
    resetEngine: () => {
      session = new Session();
    },
    Comlink: { proxy: <T>(f: T): T => f },
  };
});

/** A top match as detection lists it: its score and the columns its fields matched. */
function candidate(domainId: string, confidence: number, columns: string[] = []): DomainCandidate {
  return {
    domainId,
    name: domainId,
    confidence,
    subDomain: { id: "s", name: "S", coverage: 0 },
    subDomains: [],
    evidence: columns.map((column, i) => ({
      fieldId: `f${i}`,
      fieldLabel: `Field ${i}`,
      column,
      score: 0.6,
      via: "name" as const,
      weight: 1,
    })),
    missingSignals: [],
    assignments: [],
    grain: "row",
    contrast: { points: 0, rival: null, columns: [] },
  };
}

const WINE = [
  "fixed acidity",
  "volatile acidity",
  "citric acid",
  "residual sugar",
  "chlorides",
  "free sulfur dioxide",
  "total sulfur dioxide",
  "density",
  "pH",
  "sulphates",
  "quality",
  "alcohol",
];

describe("an industry chosen on Detect", () => {
  it("is warned about under 35%, with the columns its fields matched", () => {
    const detection = {
      candidates: [
        candidate("hospitality", 10, ["total sulfur dioxide"]),
        candidate("finance", 6, ["total sulfur dioxide"]),
        // Two fields on one column, and a scorecard metric that is not a column of its own.
        candidate("pharma", 4, ["total sulfur dioxide", "total sulfur dioxide", "Metric: Net sales"]),
      ],
    };
    expect(lowFitOf(detection, "pharma", WINE)).toEqual({ score: 4, atMost: false, explained: 1 });
    expect(lowFitWords("Pharma", { score: 4, atMost: false, explained: 1 }, WINE.length, "INTL")).toEqual({
      headline: "Pharma explains 1 of 12 columns here.",
      full: "Pharma scores 4% for this file. Most of its KPIs can't be computed, and Loupe may misread columns. A general dashboard fits this table better.",
    });
    expect(lowFitWords("Pharma", { score: 0, atMost: false, explained: 0 }, 12, "INTL").headline).toBe(
      "Pharma explains none of the 12 columns here.",
    );
  });

  it("outside the top matches scores no more than the last of them", () => {
    const low = { candidates: [candidate("a", 12), candidate("b", 9), candidate("c", 4)] };
    expect(lowFitOf(low, "pharma", WINE)).toEqual({ score: 4, atMost: true, explained: null });
    expect(lowFitWords("Pharma", { score: 4, atMost: true, explained: null }, 12, "INTL")).toEqual({
      headline: "Pharma scores 4% or less here.",
      full: "Pharma isn't among the top matches for this file. Most of its KPIs can't be computed, and Loupe may misread columns. A general dashboard fits this table better.",
    });
    expect(lowFitWords("Pharma", { score: 0, atMost: true, explained: null }, 12, "INTL").headline).toBe(
      "Pharma scores 0% here.",
    );
    // When the last top match reaches the bar, an industry outside them may fit: no warning.
    const high = { candidates: [candidate("a", 90), candidate("b", 60), candidate("c", LOW_FIT)] };
    expect(lowFitOf(high, "pharma", WINE)).toBeNull();
  });

  it("is never warned about at 35% or more, nor as the general dashboard", () => {
    const detection = { candidates: [candidate("ecommerce", LOW_FIT, ["Order ID"]), candidate("retail", 3)] };
    expect(lowFitOf(detection, "ecommerce", ["Order ID"])).toBeNull();
    expect(lowFitOf(detection, "generic", ["Order ID"])).toBeNull();
    expect(lowFitOf({ candidates: [] }, "pharma", WINE)).toBeNull();
  });
});

describe("the dashboard's fit notice", () => {
  it("names the columns the industry maps, in the user's digit grouping", () => {
    expect(weakFitLine("Pharma", { mapped: 1, columns: 12 }, "INTL")).toBe(
      "Pharma fits few of your columns (1 of 12).",
    );
    expect(weakFitLine("Retail", { mapped: 2, columns: 1200 }, "INTL")).toBe(
      "Retail fits few of your columns (2 of 1,200).",
    );
    expect(weakFitLine("Pharma", { mapped: 0, columns: 12 }, "INTL")).toBe(
      "Pharma fits none of your columns (0 of 12).",
    );
  });

  it("is kept for the file it was kept on, and asks again for the next one", async () => {
    await useWorkspace.getState().loadSample("ecommerce");
    const s = useWorkspace.getState();
    await s.confirmDomain(s.domainId as string, s.subDomainId);
    expect(useWorkspace.getState().fitKept).toBeNull();
    useWorkspace.getState().keepFit("ecommerce");
    expect(useWorkspace.getState().fitKept).toBe("ecommerce");
    // Another file: the notice asks again.
    await useWorkspace.getState().loadSample("ecommerce");
    expect(useWorkspace.getState().fitKept).toBeNull();
    useWorkspace.getState().keepFit("ecommerce");
    useWorkspace.getState().startOver();
    expect(useWorkspace.getState().fitKept).toBeNull();
  });
});
