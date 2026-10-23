/**
 * The workspace's app shell (version 50.1, src/ui/workspace/shell): the eight
 * steps grouped into four phases, where a phase opens from the phone's bottom
 * bar, and the sidebar's width rules.
 *
 * - Every step is in exactly one phase, and the phases keep STEPS' order, so
 *   the sidebar, the breadcrumb and the command palette list the steps in the
 *   order the workspace walks them.
 * - A phase opens where the user last was in it, if that step can still be
 *   opened, else on its first step that can; with none, it doesn't open.
 * - The sidebar's remembered width is restored before first paint by a boot
 *   script that only ever sets data-sidebar to "open" or "closed", and the
 *   user's choice outranks the automatic widths in the stylesheet.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STEPS, type Step } from "@/store/workspace";
import { PHASES, phaseOf, phaseTarget, STEP_ICON, stepLabel } from "@/ui/workspace/shell/phases";
import { SIDEBAR_STORAGE_KEY, sidebarBootScript } from "@/ui/workspace/shell/sidebarState";

describe("the phases", () => {
  it("hold every step exactly once, in the workspace's order", () => {
    const listed = PHASES.flatMap((p) => p.steps);
    expect(listed).toEqual(STEPS.map((s) => s.id));
    expect(PHASES.map((p) => p.label)).toEqual(["Prepare", "Build", "Analyse", "Share"]);
  });

  it("name each step's phase, icon and label", () => {
    for (const s of STEPS) {
      expect(phaseOf(s.id).steps).toContain(s.id);
      expect(STEP_ICON[s.id]).toBeDefined();
      expect(stepLabel(s.id)).toBe(s.label);
    }
    expect(phaseOf("dashboard").id).toBe("build");
    expect(phaseOf("insights").id).toBe("analyse");
  });
});

describe("where a phase opens", () => {
  const prepare = PHASES[0];
  const analyse = PHASES[2];
  if (!prepare || !analyse) throw new Error("phases missing");
  const all = () => true;

  it("returns to the step last visited in the phase", () => {
    expect(phaseTarget(prepare, "map", all)).toBe("map");
    expect(phaseTarget(analyse, "insights", all)).toBe("insights");
  });

  it("falls back to the phase's first step that can be opened", () => {
    expect(phaseTarget(analyse, undefined, all)).toBe("questions");
    // A last step from another phase, or one that can't be opened any more, is ignored.
    expect(phaseTarget(analyse, "upload", all)).toBe("questions");
    const noIndustry = (s: Step) => s === "upload" || s === "detect" || s === "map";
    expect(phaseTarget(prepare, "map", (s) => s === "upload")).toBe("upload");
    expect(phaseTarget(analyse, "insights", noIndustry)).toBeNull();
  });
});

describe("the sidebar's width", () => {
  it("is restored before first paint, setting only data-sidebar to open or closed", () => {
    for (const stored of ["open", "closed", "wide", null]) {
      const dataset: Record<string, string> = {};
      const localStorage = { getItem: (k: string) => (k === SIDEBAR_STORAGE_KEY ? stored : null) };
      new Function("document", "localStorage", sidebarBootScript)(
        { documentElement: { dataset } },
        localStorage,
      );
      expect(dataset).toEqual(stored === "open" || stored === "closed" ? { sidebar: stored } : {});
    }
    // Storage that throws (private mode) leaves the page alone.
    expect(() =>
      new Function("document", "localStorage", sidebarBootScript)(
        { documentElement: { dataset: {} } },
        {
          getItem: () => {
            throw new Error("blocked");
          },
        },
      ),
    ).not.toThrow();
  });

  it("lets the user's choice outrank the automatic widths", () => {
    const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
    expect(css).toMatch(/\.ws-sidebar \{\s*width: 4rem;/);
    expect(css).toMatch(/\.ws-sidebar:not\(\[data-canvas\]\) \{\s*width: 15rem;/);
    // :root[data-sidebar] .ws-sidebar (0,3,0) beats .ws-sidebar:not([data-canvas]) (0,2,0).
    expect(css).toMatch(/:root\[data-sidebar="open"\] \.ws-sidebar \{\s*width: 15rem;/);
    expect(css).toMatch(/:root\[data-sidebar="closed"\] \.ws-sidebar \{\s*width: 4rem;/);
  });
});
