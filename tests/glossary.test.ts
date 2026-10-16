/**
 * The glossary (/glossary, version 38.0): its hand-written terms link only to
 * terms that exist, use the app's own words (rows, insights, Lowest and
 * Highest) in British spelling, and every level and section is filled; the
 * chart types cover the chart catalogue and the industry KPIs cover the
 * registry, so the glossary describes exactly what the app draws and
 * computes.
 */
import { describe, expect, it } from "vitest";
import { benchmarkText, chartGlossary, GLOSSARY, industryGlossary, TERM_BY_ID } from "@/content/glossary";
import { CHART_TYPES } from "@/engine/charts/catalogue";
import { DOMAINS } from "@/registry";

const terms = GLOSSARY.flatMap((s) => s.terms);

describe("the hand-written terms", () => {
  it("have unique ids and names", () => {
    expect(new Set(terms.map((t) => t.id)).size).toBe(terms.length);
    expect(new Set(terms.map((t) => t.term.toLowerCase())).size).toBe(terms.length);
  });

  it("link only to terms that exist, never to themselves", () => {
    for (const t of terms)
      for (const r of t.related ?? []) {
        expect(TERM_BY_ID.has(r), `${t.id} → ${r}`).toBe(true);
        expect(r, t.id).not.toBe(t.id);
      }
  });

  it("are all written out, as sentences", () => {
    for (const t of terms) {
      expect(t.short.length, t.id).toBeGreaterThan(10);
      expect(t.body.length, t.id).toBeGreaterThan(20);
      for (const text of [t.short, t.body, t.example ?? "", t.inLoupe ?? ""].filter(Boolean))
        expect(text, t.id).toMatch(/[.!?”)\]]$/);
    }
  });

  it("fill every section and every level", () => {
    for (const s of GLOSSARY) expect(s.terms.length, s.id).toBeGreaterThanOrEqual(5);
    for (const level of ["beginner", "intermediate", "advanced"] as const)
      expect(terms.filter((t) => t.level === level).length, level).toBeGreaterThanOrEqual(15);
  });

  it("use the app's words, in British spelling", () => {
    for (const t of terms) {
      // Alternative names live in `aka`; the explanations use the app's own words. (The term that
      // explains Lowest and Highest names Min and Max to say they aren't used.)
      const text = [t.short, t.body, t.example ?? "", t.inLoupe ?? ""].join(" ");
      if (t.id !== "lowest-highest") expect(text, t.id).not.toMatch(/\b(records?|findings?|Avg|Min|Max)\b/);
      expect(text, t.id).not.toMatch(/\b(analyz|color|behavior|center|organiz|normaliz|favorite)/i);
    }
  });
});

describe("the chart types", () => {
  it("cover every chart in the catalogue, once, in its words", () => {
    const listed = chartGlossary().flatMap((g) => g.charts);
    expect(listed.map((c) => c.kind).sort()).toEqual(CHART_TYPES.map((c) => c.kind).sort());
    for (const c of listed) {
      const source = CHART_TYPES.find((x) => x.kind === c.kind);
      expect(c.shows).toBe(source?.shows);
      expect(c.bestFor).toBe(source?.bestFor);
    }
  });
});

describe("the industry KPIs", () => {
  const industries = industryGlossary(DOMAINS);

  it("cover every industry and every KPI it shows, with the registry's own definitions", () => {
    expect(industries.map((i) => i.id)).toEqual(DOMAINS.map((d) => d.id));
    for (const d of DOMAINS) {
      const i = industries.find((x) => x.id === d.id);
      const shown = d.kpis.filter((k) => !k.hidden);
      expect(i?.kpiCount, d.id).toBe(shown.length);
      const listed = new Map(i?.groups.flatMap((g) => g.kpis).map((k) => [k.id, k]));
      for (const k of shown) {
        const g = listed.get(k.id);
        expect(g, `${d.id}/${k.id}`).toBeDefined();
        expect(g?.definition).toBe(k.definition);
        expect(g?.formula).toBe(k.formula);
        expect(g?.direction).toBe(k.direction);
      }
      // Helper measures stay out.
      for (const k of d.kpis.filter((x) => x.hidden)) expect(listed.has(k.id), `${d.id}/${k.id}`).toBe(false);
    }
  });

  it("names the data shapes a KPI is limited to, and only then", () => {
    for (const d of DOMAINS) {
      const i = industries.find((x) => x.id === d.id);
      for (const k of i?.groups.flatMap((g) => g.kpis) ?? []) {
        const def = d.kpis.find((x) => x.id === k.id);
        if (!def?.subDomains || def.subDomains.length >= d.subDomains.length)
          expect(k.shapes, k.id).toEqual([]);
        else expect(k.shapes.length, k.id).toBe(def.subDomains.length);
      }
    }
  });

  it("writes a benchmark in its KPI's units, with its note", () => {
    expect(benchmarkText({ low: 0.3, high: 0.6, note: "Indicative." }, "percent")).toBe(
      "30%–60%. Indicative.",
    );
    expect(benchmarkText({ low: 4, high: 7, note: "Acute care." }, "days")).toBe("4–7 days. Acute care.");
    expect(benchmarkText({ high: 0.05, note: "Healthy." }, "percent")).toBe("Up to 5%. Healthy.");
    expect(benchmarkText({ low: 2, note: "Break-even." }, "ratio")).toBe("2× or more. Break-even.");
    // A money range carries no currency in the registry, so only the note is given.
    expect(benchmarkText({ low: 100, high: 200, note: "Typical." }, "currency")).toBe("Typical.");
    expect(benchmarkText(undefined, "percent")).toBeUndefined();
  });
});
